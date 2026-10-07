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
    await ctx.close();
  }
  for (const [label, dl] of [['a tampered update link (other host) is replaced with the real releases page', 'https://evil.example/Volt-Setup.exe'], ['a javascript: update link is neutralised', 'javascript:alert(1)']]) {
    const { ctx, page } = await open('a@smesouthafrica.co.za', json(200, {}), async (p) => {
      await p.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ desktopVersion: '9.9.9', download: dl, notes: 't' }) }));
      await p.addInitScript(() => { window.voltNative = { getVersion: () => '1.0.0' }; });
    });
    await page.goto(base + '/home.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-ub-btn', { timeout: 20000 });
    expect(label, (await page.evaluate(() => document.querySelector('.va-ub-btn').href)) === 'https://github.com/SMEZATech/tshephos-lab/releases/latest');
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
    expect('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('browser tests errored: ' + e.message); srv.close(); process.exit(1); });
