#!/usr/bin/env node
/**
 * Volt — video export A/V sync test (real browser, real exporter).
 *
 * The website used to export by recording the live canvas with MediaRecorder, which stamps each frame
 * with the wall clock at the moment the recorder sampled it and mixes the sound live, so speech drifted
 * against the picture (a quarter of a second on a laptop, ~1 s on a heavy source). The web export now
 * stamps every frame itself with WebCodecs. This test proves it with a clip that has a white flash and
 * a 1 kHz beep starting together every 2 s (tests/fixtures/flashbeep.webm, flashes at 1, 3, 5, 7, 9 s):
 *   1. export it through video.html's real exporter;
 *   2. decode the EXPORTED file in the browser and find when each flash and each beep begins;
 *   3. the offset between them must stay under 50 ms (the fixture itself reads ~9 ms, which is the
 *      measuring floor), and the file must have come from the frame-exact path.
 * Cases: a plain export with an intro card; a tightened pause cut out (every jump is a seek); an edited
 * clip that plays a later line first and then jumps back; two clips on the timeline; the muxer
 * unreachable (must fall back to the recorder); Cancel (the page must come back); and the recorder
 * itself, for scale and to prove the kill-switch still works.
 *
 * Needs Playwright + internet (the muxer loads from jsdelivr with an integrity hash). Like the other
 * Playwright checks it is skipped locally when Playwright is missing and fails in CI.
 *
 * Usage: node tests/av-sync.test.cjs                  (the synced pages in this repo)
 *   AV_ROOT=<dir>      test another folder, e.g. volt-desktop/app before syncing
 *   AV_CASES=a,b       only these: web, web-skips, web-pieces, web-clips, web-throttled, muxer-blocked, cancel, recorder, fixture
 *   AV_GPU=1           use this machine's GPU instead of the software renderer (what a real laptop has)
 *   AV_FIXTURE=<file>  another flash+beep clip (e.g. a heavy long-GOP one), AV_FORMAT=9x16 for a full-size output,
 *                      AV_TRIM_START / AV_TRIM_END, AV_THROTTLE=6 (CPU slowdown for web-throttled)
 *   AV_SAVE=<prefix>   keep the exported files, AV_DEBUG=1 print every onset
 */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(process.env.AV_ROOT || path.join(__dirname, '..'));
const FIXTURE = path.resolve(process.env.AV_FIXTURE || path.join(__dirname, 'fixtures', 'flashbeep.webm'));
let chromium;
try { ({ chromium } = require(path.join(path.resolve(__dirname, '..'), 'node_modules', 'playwright'))); }
catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) {
  if (process.env.CI) { console.log('x playwright is missing in CI'); process.exit(1); }
  console.log('· A/V sync test SKIPPED — playwright not installed'); process.exit(0);
} }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.webm': 'video/webm' };
const STUB = `window.supabase={createClient:function(){var u={id:'u1',email:'x@y.z'},s={user:u,access_token:'x',expires_at:9999999999};return {auth:{getSession:function(){return Promise.resolve({data:{session:s}})},onAuthStateChange:function(){return {data:{subscription:{unsubscribe(){}}}}},signOut:function(){return Promise.resolve()}}}}};`;

// Runs in the page: when does each flash (picture) and each beep (sound) begin in this file?
async function analyzeInPage(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const ac = new AudioContext(); const ab = await ac.decodeAudioData(buf.slice(0)); ac.close();
  const x = ab.getChannelData(0), sr = ab.sampleRate; let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const th = peak * 0.3, win = Math.round(sr * 0.004), beeps = []; let lastLoud = -1e9;
  for (let i = 0; i < x.length; i += win) {
    let m = 0; for (let j = i; j < Math.min(x.length, i + win); j++) { const a = Math.abs(x[j]); if (a > m) m = a; }
    if (m > th) { if (i - lastLoud > sr * 0.5) beeps.push(i / sr); lastLoud = i; }
  }
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', () => rej(new Error('video would not load')), { once: true }); v.src = url; });
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); cx.canvas.width = 16; cx.canvas.height = 9;
  const frames = [];
  await new Promise((res) => {
    const cb = (n, m) => { cx.drawImage(v, 0, 0, 16, 9); const d = cx.getImageData(0, 0, 16, 9).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; frames.push([m.mediaTime, s / (d.length / 4)]); v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb); v.onended = res; v.playbackRate = 0.5; v.play();   // half speed: at full speed the analysis video itself drops frames and blurs the onsets
    setTimeout(res, 120000);
  });
  const flashes = []; let prev = 0;
  for (const [t, l] of frames) { if (l > 128 && prev <= 128) flashes.push(t); prev = l; }
  return { beeps, flashes, frames: frames.length, dur: ab.duration };
}

async function newPage(browser, base, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.route('**/volt-auth.js*', async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, body: (await resp.text()).replace(/s\.integrity\s*=\s*"sha384-[^"]*";/, '') }); });
  await page.route('**/*supabase*', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (opts.blockMuxer) await page.route('**/cdn.jsdelivr.net/**', r => r.abort());   // offline / blocked: must fall back to the recorder
  if (opts.recorder) await page.addInitScript(() => { try { localStorage.setItem('volt_export_recorder', '1'); } catch (e) {} });
  await page.goto(base + '/video.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#videoFile', { state: 'attached' });
  await page.waitForTimeout(2500);
  await page.setInputFiles('#videoFile', FIXTURE);
  await page.waitForFunction(() => state.loaded, null, { timeout: 20000 });
  if (opts.extra) { await page.setInputFiles('#clipFile', FIXTURE); await page.waitForFunction(() => extraClips.length && extraClips[0].ready, null, { timeout: 20000 }); }
  await page.waitForTimeout(1000);
  await page.evaluate((o) => {
    // A tiny output unless a real format was asked for: this is a timing test, and a software-rendered
    // CI canvas spends most of its time painting pixels nobody looks at.
    if (o.format) setFormat(o.format); else { FMT['1x1'].w = 360; FMT['1x1'].h = 360; setFormat('1x1'); }
    state.exportFmt = 'webm'; state.introOn = !!o.intro; state.outroOn = false; state.captionsOn = false;
    state.trimStart = o.trimStart; state.trimEnd = o.trimEnd;
    // tightened pauses (source seconds from trimStart) and an edited clip (absolute source seconds, play order)
    if (o.skips) { state.skips = o.skips; state.skipTotal = o.skips.reduce((s, k) => s + (k.e - k.s), 0); }
    if (o.pieces) state.pieces = o.pieces;
    if (o.extra) { extraClips[0].trimStart = o.extra[0]; extraClips[0].trimEnd = o.extra[1]; }
    try { updateTrimRead(); } catch (e) {}
  }, { format: opts.format, intro: opts.intro, trimStart: opts.trimStart, trimEnd: opts.trimEnd, skips: opts.skips, pieces: opts.pieces, extra: opts.extra });
  return { ctx, page, errors };
}

async function measureFile(browser, base, file) {
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.route('**/__out.webm', r => r.fulfill({ contentType: 'video/webm', body: fs.readFileSync(file) }));
  await p2.goto(base + '/__blank.html');
  const m = await p2.evaluate(analyzeInPage, base + '/__out.webm');
  await ctx2.close();
  const n = Math.min(m.beeps.length, m.flashes.length);
  const offs = []; for (let i = 0; i < n; i++) offs.push(m.beeps[i] - m.flashes[i]);   // + = sound late, picture ahead; - = picture late
  return { beeps: m.beeps.length, flashes: m.flashes.length, offs, raw: m };
}

async function exportAndMeasure(browser, base, opts) {
  const { ctx, page, errors } = await newPage(browser, base, opts);
  if (opts.throttle > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle }); }
  const dl = page.waitForEvent('download', { timeout: 240000 });
  const t0 = Date.now();
  await page.evaluate(() => { window.__p = exportShort('avtest'); });
  const d = await dl; const out = path.join(require('os').tmpdir(), 'volt-avtest-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.webm');
  await d.saveAs(out);
  if (process.env.AV_SAVE) fs.copyFileSync(out, process.env.AV_SAVE + '-' + opts.name + '.webm');
  const took = (Date.now() - t0) / 1000;
  const used = await page.evaluate(() => state._lastExport || null);
  await ctx.close();
  const size = fs.statSync(out).size;
  if (opts.measure === false) { try { fs.unlinkSync(out); } catch (e) {} return { took, used, errors, size, beeps: 0, flashes: 0, offs: [], raw: { beeps: [], flashes: [] } }; }
  const m = await measureFile(browser, base, out); try { fs.unlinkSync(out); } catch (e) {}
  return Object.assign({ took, used, errors, size }, m);
}

// Cancel part-way: the export must report not-ok, download nothing, and hand the page back.
async function cancelCase(browser, base) {
  const { ctx, page } = await newPage(browser, base, { trimStart: 2, trimEnd: 12 });
  let downloaded = false; page.on('download', () => { downloaded = true; });
  await page.evaluate(() => { window.__p = exportShort('canceltest'); });
  await page.waitForFunction(() => state.fastExporting === true, null, { timeout: 30000 }); await page.waitForTimeout(2500);
  await page.evaluate(() => { _fxAbort = true; });
  const res = await page.evaluate(() => window.__p);
  await page.waitForTimeout(500);
  const ui = await page.evaluate(() => ({ busy: state.fastExporting, btnDisabled: document.getElementById('exportBtn').disabled, cancelShown: getComputedStyle(document.getElementById('fxCancel')).display !== 'none', label: document.getElementById('exportLbl').textContent }));
  await ctx.close();
  return { res, ui, downloaded };
}

(async () => {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (rel === '__blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><body>x</body>'); }
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'].concat(process.env.AV_GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization'] : []) });
  let fail = 0;
  const expect = (name, cond, detail) => { if (cond) console.log('  ok   ' + name); else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + JSON.stringify(detail) : '')); } };
  const stat = (a) => { const s = a.slice().sort((x, y) => x - y); return { n: a.length, mean: a.reduce((p, c) => p + c, 0) / (a.length || 1), min: s[0], max: s[s.length - 1] }; };
  const fmt = (st) => 'n=' + st.n + ' mean ' + (st.mean * 1000).toFixed(0) + ' ms, range ' + (st.min * 1000).toFixed(0) + '…' + (st.max * 1000).toFixed(0) + ' ms';
  // The fixture flashes for 0.2 s at 1, 3, 5, 7, 9 ... s. Every trim starts in the dark.
  const T = { trimStart: +(process.env.AV_TRIM_START || 2), trimEnd: +(process.env.AV_TRIM_END || 8) };
  const CASES = {
    'web':           Object.assign({ want: 3, intro: true }, T),                                          // flashes at 3, 5, 7 s, behind an intro card
    // A 2 s pause cut out of the middle: the flash at 5 s is removed and 7 s plays 2 s earlier. The jump is a seek.
    'web-skips':     { trimStart: 0, trimEnd: 8, skips: [{ s: 3.5, e: 5.5, cumBefore: 0 }], want: 3 },
    // An edited clip that plays a later line first, then jumps BACK: 8.5-10 s (flash at 9), then 2-6 s (3, 5).
    'web-pieces':    { trimStart: 0, trimEnd: 12, pieces: [{ start: 8.5, end: 10 }, { start: 2, end: 6 }], want: 3 },
    // Two clips joined with the default crossfade: each plays its own 2-5 s (flash at 3 s).
    'web-clips':     { trimStart: 2, trimEnd: 5, extra: [2, 5], want: 2 },
    'web-throttled': Object.assign({ want: 3, throttle: +(process.env.AV_THROTTLE || 6) }, T),            // a slow machine; meaningful on a real GPU (AV_GPU=1)
    'muxer-blocked': Object.assign({ blockMuxer: true, want: 3 }, T),
    'recorder':      Object.assign({ recorder: true, want: 3 }, T),
  };
  try {
    console.log('Video export A/V sync (' + path.basename(FIXTURE) + '):');
    const cases = process.env.AV_CASES ? process.env.AV_CASES.split(',') : ['web', 'web-skips', 'web-pieces', 'web-clips', 'muxer-blocked', 'cancel', 'recorder'];
    for (const name of cases) {
      if (name === 'fixture') {   // calibration: how far apart are flash and beep in the SOURCE file itself?
        const m = await measureFile(browser, base, FIXTURE);
        console.log('  · fixture itself: ' + fmt(stat(m.offs))); continue;
      }
      if (name === 'cancel') {
        const c = await cancelCase(browser, base);
        console.log('  · cancel: ' + JSON.stringify(c));
        expect('cancel: the export reports not-ok and nothing is downloaded', c.res && c.res.ok === false && !c.downloaded, c);
        expect('cancel: the page is usable again (button enabled, no spinner, cancel hidden)', !c.ui.busy && !c.ui.btnDisabled && !c.ui.cancelShown && !/Recording|frame/.test(c.ui.label), c.ui);
        continue;
      }
      if (!CASES[name]) { fail++; console.log('  FAIL unknown case ' + name); continue; }
      const o = Object.assign({ name, format: process.env.AV_FORMAT, measure: !!process.env.AV_CASES || !/^(muxer-blocked|recorder)$/.test(name) }, CASES[name]);
      const r = await exportAndMeasure(browser, base, o);
      const st = stat(r.offs), want = o.want;
      if (process.env.AV_DEBUG || r.beeps !== r.flashes) { console.log('    beeps   ' + r.raw.beeps.map(x => x.toFixed(3)).join(' ')); console.log('    flashes ' + r.raw.flashes.map(x => x.toFixed(3)).join(' ')); }
      console.log('  · ' + name + ': ' + (o.measure ? fmt(st) + '; ' + r.beeps + ' beeps, ' + r.flashes + ' flashes; ' : 'file ' + Math.round(r.size / 1024) + ' KB; ') + r.took.toFixed(1) + ' s to export; path ' + (r.used ? r.used.path : 'recorder')
        + (r.used && process.env.AV_DEBUG ? ' ' + JSON.stringify(r.used.prof, (k, v) => typeof v === 'number' ? Math.round(v) : v) : '') + (r.used ? ' [stalls ' + r.used.stalls + ', seeks ' + r.used.seeks + ', decoder-dropped ' + r.used.dropped + ']' : ''));
      if (name === 'muxer-blocked') {
        expect('muxer unreachable: falls back to the recorder and still writes a file', !r.used && r.size > 20000 && (!o.measure || (r.beeps >= want - 1 && r.flashes >= want - 1)), { used: r.used, size: r.size, beeps: r.beeps, flashes: r.flashes });
        continue;
      }
      if (name === 'recorder') {
        expect('recorder kill-switch (volt_export_recorder) uses the recorder and still writes a file', !r.used && r.size > 20000 && (!o.measure || (r.beeps >= want - 1 && r.flashes >= want - 1)), { used: r.used, size: r.size, beeps: r.beeps, flashes: r.flashes });
        if (o.measure) console.log('  · for scale: the recorder this replaces was ' + (Math.abs(st.mean) * 1000).toFixed(0) + ' ms out on this machine');
        continue;
      }
      expect(name + ': written by the frame-exact path, not the recorder', r.used && r.used.path === 'webcodecs', r.used);
      expect(name + ': every flash has its beep (' + want + ')', r.beeps === r.flashes && r.flashes === want, { beeps: r.beeps, flashes: r.flashes });
      expect(name + ': mean offset under 50 ms', Math.abs(st.mean) < 0.05, st);
      expect(name + ': no single flash more than 80 ms off', Math.max(Math.abs(st.min), Math.abs(st.max)) < 0.08, st);
      expect(name + ': no page errors', !r.errors.length, r.errors);
    }
  } catch (e) { fail++; console.log('  FAIL harness threw: ' + (e && e.stack || e)); }
  await browser.close(); srv.close();
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
