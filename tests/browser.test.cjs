// Real-browser checks of the sign-in behaviour and the email-preview sandbox. Run by CI AFTER Playwright
// is installed (ci.yml); skipped with a notice if Playwright isn't available locally.
//
// The REAL volt-auth.js and pages run; only Supabase's JS client and the /api are stubbed.
//   node tests/browser.test.cjs
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const WEB = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('· browser tests SKIPPED: playwright not installed'); process.exit(0); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const stub = (email) => `window.supabase={createClient:function(){var u={id:'u1',email:'${email}'},s={user:u,access_token:'x',expires_at:9999999999},cbs=[],out=false;
return {auth:{getSession:function(){return Promise.resolve({data:{session:out?null:s}})},onAuthStateChange:function(cb){cbs.push(cb);return {data:{subscription:{unsubscribe(){}}}}},
signOut:function(){out=true;window.__signedOut=true;cbs.forEach(function(cb){cb('SIGNED_OUT',null)});return Promise.resolve()}}}}};`;

let pass = 0, fail = 0;
const expect = (name, cond, detail) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '  → ' + JSON.stringify(detail)); } };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const open = async (email, apiHandler, extra) => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    // volt-auth.js pins the real Supabase library with a Subresource Integrity hash, so the browser
    // (rightly) refuses our stub. For THESE tests only, drop the integrity line before the page sees
    // it; a separate smoke.cjs check guarantees the shipping file still carries it.
    await page.route('**/volt-auth.js*', async (r) => {
      const resp = await r.fetch(); const t = (await resp.text()).replace(/s\.integrity\s*=\s*"sha384-[^"]*";/, '');
      r.fulfill({ response: resp, body: t });
    });
    await page.route('**/*supabase*', r => r.fulfill({ contentType: 'text/javascript', body: stub(email) }));
    await page.route('**/api/**', apiHandler);
    if (extra) await extra(page);
    return { ctx, page, errors };
  };
  const json = (status, body) => (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  console.log('Sign-in behaviour (browser):');
  {
    const { ctx, page } = await open('someone@gmail.com', json(401, { error: 'Please sign in to continue.', code: 'NOT_AUTHORIZED' }));
    await page.goto(base + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#va-gate', { timeout: 20000 });
    const msg = await page.evaluate(() => (document.getElementById('va-err') || {}).textContent || '');
    expect('an account the server refuses lands on the sign-in screen with an invite-only message, not a broken app', /invite-only/i.test(msg), msg);
    expect('…and is signed out', await page.evaluate(() => !!window.__signedOut));
    await ctx.close();
  }
  {
    const { ctx, page } = await open('a@smesouthafrica.co.za', json(401, { code: 'EMAIL_UNCONFIRMED' }));
    await page.goto(base + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#va-gate', { timeout: 20000 });
    expect('an unconfirmed email is told to confirm it', /confirm your email/i.test(await page.evaluate(() => (document.getElementById('va-err') || {}).textContent || '')));
    await ctx.close();
  }
  for (const [label, handler] of [['a normal session is untouched', json(200, {})], ['an unrelated 401 (NO_SESSION) does NOT sign anyone out', json(401, { code: 'NO_SESSION' })]]) {
    const { ctx, page } = await open('a@smesouthafrica.co.za', handler);
    await page.goto(base + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#va-rail', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(3500);
    expect(label, !(await page.evaluate(() => !!document.getElementById('va-gate'))));
    if (label === 'a normal session is untouched') expect("Volt's rail does not link to Vantly's Brand Kit page", await page.evaluate(() => !document.querySelector('#va-rail a[href="brand-kit.html"]')));
    await ctx.close();
  }
  for (const [label, dl] of [['a tampered update link (other host) is replaced with the real releases page', 'https://evil.example/Volt-Setup.exe'], ['a javascript: update link is neutralised', 'javascript:alert(1)']]) {
    const { ctx, page } = await open('a@smesouthafrica.co.za', json(200, {}), async (p) => {
      await p.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ desktopVersion: '9.9.9', download: dl, notes: 't' }) }));
      await p.addInitScript(() => { window.voltNative = { getVersion: () => '1.0.0' }; });
    });
    await page.goto(base + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-ub-btn:not(#va-fb-go)', { timeout: 20000 });
    { const href = await page.evaluate(() => document.querySelector('.va-ub-btn:not(#va-fb-go)').href); expect(label, href === 'https://github.com/SMEZATech/tshephos-lab/releases/latest', href); }
    await ctx.close();
  }

  console.log('Scheduler health banner (browser):');
  for (const [label, summary, want] of [
    ['a late post shows a warning banner on Schedule', { healthy: false, overdue: 2, oldestOverdueMinutes: 190, stuck: 0, errors24h: 0, unreachable: false }, /2 scheduled posts are running late.*190 min/s],
    ['an interrupted post is flagged so nobody re-posts blindly', { healthy: false, overdue: 0, oldestOverdueMinutes: 0, stuck: 1, errors24h: 0, unreachable: false }, /interrupted while publishing/i],
    ['an unreachable database is flagged', { healthy: false, overdue: 0, oldestOverdueMinutes: 0, stuck: 0, errors24h: 0, unreachable: true }, /can.t be read/i],
    ['a healthy scheduler shows NOTHING', { healthy: true, overdue: 0, oldestOverdueMinutes: 0, stuck: 0, errors24h: 0, unreachable: false }, null],
  ]) {
    const { ctx, page, errors } = await open('a@smesouthafrica.co.za', json(200, {}), async (p) => {
      await p.route('**/api/queuehealth*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, summary }) }));
    });
    await page.goto(base + '/schedule.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#va-rail', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(2500);
    const b = await page.evaluate(() => { const el = document.getElementById('qhBanner'); return el ? { shown: getComputedStyle(el).display !== 'none', text: el.textContent } : null; });
    expect(label, b && (want ? (b.shown && want.test(b.text)) : !b.shown) && errors.length === 0, { b, errors });
    await ctx.close();
  }

  console.log('Studio render worker (browser):');
  {
    // Both of these FAILED on the old engine (verified against it): a Creative post rendered differently
    // after a premium Story export, and an overlapping Creative request came back with the Story's image.
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(base + '/welcome.html', { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const w = new Worker('/studio-engine.js'); let seq = 0;
      const post = (payload) => new Promise((resolve, reject) => {
        const id = ++seq, p = Object.assign({}, payload, { id });
        const on = (ev) => { const m = ev.data; if (m.id !== undefined && m.id !== id) return; if (m.type === 'done') { w.removeEventListener('message', on); resolve(m); } else if (m.type === 'error') { w.removeEventListener('message', on); reject(new Error(m.message)); } };
        w.addEventListener('message', on); w.postMessage(p);
      });
      const brand = { primary: '#9c1c1f', secondary: '#0a2c3d', cta: 'Read Insight', url: 'smesouthafrica.co.za' };
      const creative = () => ({ type: 'render-single', state: { campaign: 'standard', format: 'square', theme: 'editorial', showFooter: true, currentSlide: 0, slides: ['x'], title: 'Hello world headline', tag: 'TAG', stat: '1', author: 'a', pollOpts: ['a', 'b', 'c'], focalX: .5, focalY: .5, userScale: 1 }, brand, slideIdx: 0, featuredBlob: null, logoBlob: null, fontBuffers: {}, scale: 0.3, filename: 't.png' });
      const story = () => ({ type: 'render-premium', brand, fontBuffers: {}, logoWhiteBlob: null, logoColorBlob: null, premType: 'funding', dir: 'a', vals: {}, w: 1080, h: 1920, scale: 0.3, filename: 's.png' });
      const hash = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let h = 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]) >>> 0; return h; };
      const dims = async (blob) => { const bmp = await createImageBitmap(blob); const d = bmp.width + 'x' + bmp.height; bmp.close(); return d; };
      const a = await post(creative()); await post(story()); const b = await post(creative());
      const [s, c] = await Promise.all([post(story()), post(creative())]);
      const out = { same: (await hash(a.blob)) === (await hash(b.blob)), story: await dims(s.blob), creative: await dims(c.blob) };
      w.terminate(); return out;
    });
    expect('a Creative post renders identically before and after a premium Story export (no leaked safe-zone)', r.same === true, r);
    expect('overlapping renders each get their own result (the worker tags replies with the request id)', r.story === '324x576' && r.creative === '324x324', r);
    await ctx.close();
  }

  console.log('Designs curated per brand (browser):');
  {
    const { ctx, page, errors } = await open('a@smesouthafrica.co.za', json(200, {}));
    await page.goto(base + '/studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ct-funding', { state: 'attached', timeout: 20000 });
    const w = await page.$('#va-welcome-go'); if (w) await w.click();
    await page.waitForTimeout(800);
    const state = () => page.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
      const b = document.getElementById('ct-outside');
      return { funding: vis('ct-funding'), podcast: vis('ct-podcast'), providers: vis('ct-providers'), findpros: vis('ct-findpros'), toggle: b ? b.textContent : '', toggleShown: !!b && !b.classList.contains('hidden') };
    });
    let r = await state();
    expect('SME South Africa shows its own designs (Funding, Podcast…)', r.funding && r.podcast, r);
    expect('…and hides the Serv marketplace designs', !r.providers && !r.findpros, r);
    expect('…with a "Show designs outside" option that says how many', r.toggleShown && /Show designs outside SME South Africa \(2\)/.test(r.toggle), r);
    await page.click('#ct-outside');
    r = await state();
    expect('"Show designs outside" reveals them, marked as made for another brand', r.providers && r.findpros && /Hide designs outside/.test(r.toggle), r);
    await page.click('#ct-outside');
    await page.evaluate(() => {
      localStorage.setItem('volt_brands_v1', JSON.stringify([{ id: 'sme', name: 'SME South Africa', primary: '#9c1c1f', secondary: '#0a2c3d', tag: 't', cta: 'c', url: 'u' }, { id: 'serv1', name: 'Serv', primary: '#3d1152', secondary: '#e9e9ec', tag: 't', cta: 'c', url: 'serv.co.za' }]));
      localStorage.setItem('volt_active_brand', 'serv1'); applyBrand();
    });
    r = await state();
    expect('a brand named Serv shows only the marketplace designs', r.providers && r.findpros && !r.funding && !r.podcast, r);
    await page.evaluate(() => { const b = loadBrands(); b[1].designs = ['funding']; localStorage.setItem('volt_brands_v1', JSON.stringify(b)); applyBrand(); });
    r = await state();
    expect('a curated list on the brand overrides the defaults', r.funding && !r.providers && !r.podcast, r);
    const boxes = await page.evaluate(() => { openBrandKit(); const c = [...document.querySelectorAll('#bk-designs input')]; return { n: c.length, checked: c.filter(i => i.checked).map(i => i.value) }; });
    expect('the Brand Kit editor lists every design, ticking only the ones curated for this brand', boxes.n === 14 && boxes.checked.join() === 'funding', boxes);
    expect('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('Email preview sandbox (browser):');
  {
    const { ctx, page, errors } = await open('a@smesouthafrica.co.za', json(200, {}));
    await page.goto(base + '/email.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#frame', { state: 'attached', timeout: 20000 });
    const w = await page.$('#va-welcome-go'); if (w) await w.click();
    await page.waitForTimeout(800);
    const r = await page.evaluate(async () => {
      const frame = document.getElementById('frame'); window.__pwned = null;
      frame.srcdoc = previewDoc('<div class="volt-editable"><p>Hello</p><img src="x" onerror="window.top.__pwned=\'onerror\'"><script>window.top.__pwned=\'script\'</script></div>');
      await new Promise(res => setTimeout(res, 1200));
      const out = { sandbox: frame.getAttribute('sandbox'), pwned: window.__pwned };
      try {
        const doc = frame.contentDocument; wireEditableFrame(frame);
        const ed = doc.querySelector('.volt-editable'); out.editable = ed.getAttribute('contenteditable');
        ed.innerHTML = '<p>edited</p>'; ed.dispatchEvent(new Event('input', { bubbles: true })); out.synced = state.editedContent;
      } catch (e) { out.err = e.message; }
      return out;
    });
    expect('the preview frame is sandboxed', r.sandbox === 'allow-same-origin', r);
    expect('HTML injected into the preview (onerror / <script>) does NOT execute', r.pwned === null, r);
    expect('inline editing still works inside the sandboxed preview', r.editable === 'true' && r.synced === '<p>edited</p>', r);
    const pf = await page.evaluate(() => {
      lastFragment = assemble('<p>Hello</p>', false);
      const has = () => preflightRun().some(x => x.level === 'fail' && x.area === 'Footer');
      const normal = has();
      const orig = window.previewDoc;
      window.previewDoc = (f) => orig(f).replace(/unsubscribe/gi, 'x');
      const stripped = has();
      window.previewDoc = orig;
      return { normal, stripped };
    });
    expect('pre-flight does not flag the normal footer', pf.normal === false, pf);
    expect('pre-flight BLOCKS an email whose footer has lost its unsubscribe link', pf.stripped === true, pf);
    expect('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ---- SMESA 2026 rebrand gate, in the real pages. /api/rebrand is answered from api/_rebrand/ on
  // disk for the previewer and 403 for everyone else — exactly the two answers the server gives.
  console.log('Rebrand 2026 gate (browser):');
  {
    const R26 = JSON.stringify((await import(require('url').pathToFileURL(path.join(WEB, 'api', '_rebrand', 'index.js')).href)).definitions());
    const api = (allowed) => (r) => {
      const u = r.request().url();
      if (/\/api\/rebrand/.test(u)) return allowed ? r.fulfill({ status: 200, contentType: 'application/json', body: R26 }) : r.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"REBRAND_PREVIEW_ONLY"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    };
    // brand26/ assets are fetched by absolute URL; serve them from this checkout.
    const assets = async (p) => p.route('https://tshephos-lab.vercel.app/brand26/**', r => r.fulfill({ path: path.join(WEB, 'brand26', r.request().url().split('/brand26/')[1]) }));
    for (const [who, email, allowed] of [['Joel', 'joel@smesouthafrica.co.za', true], ['a teammate', 'thabo@smesouthafrica.co.za', false]]) {
      const s = await open(email, api(allowed), assets);
      await s.page.goto(base + '/studio.html', { waitUntil: 'domcontentloaded' });
      await s.page.waitForSelector('#va-rail', { state: 'attached', timeout: 20000 });
      await s.page.waitForTimeout(allowed ? 9000 : 5000);
      const st = await s.page.evaluate(() => ({
        fam: !!document.getElementById('ct-r26funding'), pill: !!document.querySelector('#ct-r26funding .r26-pill'),
        n: document.querySelectorAll('.r26-fam').length,
        kit: (typeof loadBrands === 'function') ? loadBrands().some(b => b.id === 'sme26') : null,
        stored: (() => { try { return (localStorage.getItem('volt_brands_v1') || '').indexOf('sme26') >= 0; } catch (e) { return false; } })() }));
      if (allowed) {
        expect('Studio, ' + who + ': nine 2026 families appear, each with the 2026 · Preview pill', st.n === 9 && st.pill, st);
        expect('Studio, ' + who + ': the "SME South Africa 2026" kit is offered', st.kit === true, st);
        expect('Studio, ' + who + ': …and is never written into the shared Brand Kit', st.stored === false, st);
        const ok = await s.page.evaluate(async () => { setActiveBrandId('sme26'); applyBrand(); setContentType('r26funding');
          const d = await premPost({ type: 'render-premium', brand: brandPayload(), fontBuffers: fontBuffers, premType: 'r26funding', dir: 'a', vals: premVals, w: 1080, h: 1350, scale: 1, trace: true });
          const rc = VoltRenderChecks.assertDesign(d.trace, 1080, 1350);
          return { type: state.contentType, bytes: d.blob && d.blob.size, head: (d.trace || []).some(t => t.role === 'headline' && /R5 million/.test(t.text)), err: rc.error || null,
                   stored: (localStorage.getItem('volt_brands_v1') || '').indexOf('sme26') >= 0 }; });
        expect('Studio, ' + who + ': a 2026 family renders through the page worker and passes render-checks', ok.type === 'r26funding' && ok.bytes > 10000 && ok.head && !ok.err, ok);
        expect('Studio, ' + who + ': choosing the 2026 kit still writes nothing to the shared Brand Kit', ok.stored === false, ok);
      } else {
        expect('Studio, ' + who + ': no 2026 family, no 2026 kit', !st.fam && st.n === 0 && st.kit === false, st);
      }
      await s.page.goto(base + '/email.html', { waitUntil: 'domcontentloaded' });
      await s.page.waitForSelector('#va-rail', { state: 'attached', timeout: 20000 });
      await s.page.waitForTimeout(5000);
      const em = await s.page.evaluate(() => ({ opts: [].map.call(document.querySelectorAll('#shellVariant option'), o => o.value).filter(v => /^t26/.test(v)),
        tpl: typeof TEMPLATES === 'object' ? Object.keys(TEMPLATES).filter(k => /^t26/.test(k)).length : -1 }));
      if (allowed) {
        expect('Email, ' + who + ': five 2026 templates in the picker', em.opts.length === 5 && em.tpl === 5, em);
        const out = await s.page.evaluate(() => { const sv = document.getElementById('shellVariant'); sv.value = 't26funding'; sv.dispatchEvent(new Event('change'));
          loadStarter(); r26RenderPanel(); const f = assemble(state.body || '', false);
          return { jak: /Plus Jakarta Sans/.test(f), oswald: /Oswald|Roboto/.test(f), unsub: /\{\{ unsubscribe_url \}\}/.test(f), sections: (f.match(/data-s26=/g) || []).length,
                   panel: document.getElementById('r26Panel').style.display, rows: document.querySelectorAll('#r26Sections [data-r26="up"]').length }; });
        expect('Email, ' + who + ': the Funding Weekly starter assembles in 2026 type, no Oswald/Roboto, merge tags intact', out.jak && !out.oswald && out.unsub && out.sections >= 6, out);
        expect('Email, ' + who + ': the 2026 panel lists its sections for reordering', out.panel === 'block' && out.rows === out.sections, out);
        const mv = await s.page.evaluate(() => { const before = [].map.call(document.querySelectorAll('#r26Sections span'), x => x.textContent);
          document.querySelector('#r26Sections [data-r26="down"][data-i="0"]').click();
          const after = [].map.call(document.querySelectorAll('#r26Sections span'), x => x.textContent); return { before: before.slice(0, 2), after: after.slice(0, 2) }; });
        expect('Email, ' + who + ': ▼ moves a section down', mv.before[0] === mv.after[1] && mv.before[1] === mv.after[0], mv);
      } else {
        expect('Email, ' + who + ': no 2026 template anywhere', em.opts.length === 0 && em.tpl === 0, em);
      }
      expect('no page errors (' + who + ')', s.errors.length === 0, s.errors);
      await s.ctx.close();
    }
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('browser tests errored: ' + e.message); srv.close(); process.exit(1); });
