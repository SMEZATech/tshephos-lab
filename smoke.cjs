#!/usr/bin/env node
// Volt — static smoke test. Fast, no network: node --check every serverless function and
// every page's last inline script. Run before pushing:  node smoke.cjs
// Optional live contract check: node smoke.cjs https://tshephos-lab.vercel.app
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
let fail = 0;

// Vercel Hobby plan caps Serverless Functions at 12 (underscore-prefixed files/dirs don't count).
// We sat at exactly 12/12 until the router landed; anything from 10 up is worth saying out loud,
// because the deploy failure you get at 13 looks nothing like the change that caused it.
const fnCount = fs.readdirSync('api').filter(n => n.endsWith('.js') && !n.startsWith('_')).length;
console.log('Serverless functions: ' + fnCount + '/12'
  + (fnCount > 12 ? '  x OVER VERCEL HOBBY LIMIT — deploys will FAIL' : (fnCount >= 10 ? '  ! close to the cap — fold new endpoints into api/_routes/' : '')));
if (fnCount > 12) fail++;

console.log('Backend (api/*.js):');
const apiFiles = fs.readdirSync('api').filter(n => n.endsWith('.js')).map(n => 'api/' + n)
  .concat(fs.existsSync('api/_routes') ? fs.readdirSync('api/_routes').filter(n => n.endsWith('.js')).map(n => 'api/_routes/' + n) : []);
for (const f of apiFiles) {
  try { cp.execSync('node --check "' + f + '"', { stdio: 'pipe' }); console.log('  ok ' + f); }
  catch (e) { fail++; console.error('  x ' + f + '\n    ' + String(e.stderr || e.message).split('\n').slice(0, 2).join('\n    ')); }
}

// Every module in api/_routes/ must be registered in the router, or it is a dead endpoint that
// 404s with no other symptom. Cheap check, catches an easy mistake.
if (fs.existsSync('api/_routes')) {
  const router = fs.existsSync('api/[...volt].js') ? fs.readFileSync('api/[...volt].js', 'utf8') : '';
  const unregistered = fs.readdirSync('api/_routes').filter(n => n.endsWith('.js'))
    .map(n => n.replace(/\.js$/, ''))
    .filter(n => !new RegExp('\\b' + n + '\\b').test(router));
  if (unregistered.length) { fail++; console.error('  x api/_routes not wired into the router: ' + unregistered.join(', ')); }
  else console.log('  ok router registers every _routes module');

  // ROUTER RESOLUTION — this shipped broken. The router originally trusted req.query.volt, which
  // Vercel does NOT populate for plain (non-Next) Node functions, so in production every routed
  // endpoint 404'd. The test at the time passed the param in by hand, so it validated the exact
  // assumption that was wrong. This drives it the way Vercel actually does: URL only, NO query.
  const routerNames = (router.match(/const ROUTES = \{([^}]*)\}/) || [, ''])[1]
    .split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
  const nameFn = (router.match(/function endpointName\(req\)[\s\S]*?\n\}/) || [])[0];
  if (!nameFn) { fail++; console.error('  x router: endpointName() not found'); }
  else {
    const endpointName = new Function('return ' + nameFn.replace(/^function /, 'function ') + '; ')
      ? new Function(nameFn + '; return endpointName;')() : null;
    const cases = routerNames.map(n => ['/api/' + n, n])
      .concat([['/api/kit?action=x', 'kit'], ['/api/nope', 'nope'], ['/api/', ''], ['', '']]);
    const bad = cases.filter(([url, want]) => endpointName({ url, query: {} }) !== want)
      .map(([url, want]) => url + ' -> "' + endpointName({ url, query: {} }) + '" (want "' + want + '")');
    if (bad.length) { fail++; console.error('  x router resolves the wrong endpoint from the URL:\n      ' + bad.join('\n      ')); }
    else console.log('  ok router resolves all ' + routerNames.length + ' endpoints from the URL alone (no query param)');
  }
}

// Duplicate ids. A dead-simple check that would have caught a real bug: video.html had TWO
// id="pauseBtn" (transport Pause and "Tighten pauses"), so $('#pauseBtn') always returned the first
// and the second handler silently overwrote the first — Volt shipped with no working Pause button.
console.log('Duplicate element ids:');
for (const f of fs.readdirSync('.').filter(n => /\.html$/.test(n))) {
  // Static markup ONLY. Script blocks hold template literals that legitimately repeat an id across
  // mutually-exclusive templates (email.html has three shells each opening <div id="body">), and
  // only one is ever in the DOM. Same reason build-sync's tag-balance check strips scripts.
  const html = fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
  const seen = Object.create(null), dupes = [];
  for (const m of html.matchAll(/\sid="([A-Za-z][\w:.-]*)"/g)) {
    const id = m[1];
    if (seen[id]) { if (dupes.indexOf(id) < 0) dupes.push(id); } else seen[id] = 1;
  }
  if (dupes.length) { fail++; console.error('  x ' + f + ': ' + dupes.join(', ')); }
  else console.log('  ok ' + f);
}

console.log('Pages (last inline script):');
for (const f of fs.readdirSync('.').filter(n => /\.html$/.test(n))) {
  const html = fs.readFileSync(f, 'utf8');
  const m = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(s => s.trim());
  const js = m[m.length - 1] || '';
  if (!js) continue;
  const tmp = path.join(os.tmpdir(), 'volt-smoke.js'); fs.writeFileSync(tmp, js);
  try { cp.execSync('node --check "' + tmp + '"', { stdio: 'pipe' }); console.log('  ok ' + f); }
  catch (e) { fail++; console.error('  x ' + f + ' (JS)'); }
}

// COPY ROTATION. The rule "the same copy never ships twice on the same design + size + brand" lives
// in three places that must agree: the selection logic (copy-rotation.js), the server log
// (api/_routes/copyuse.js) and the written library (copy-library.js). Each has a test here.
console.log('Copy rotation:');
for (const t of ['tests/copy-rotation.test.cjs', 'tests/copyuse.test.mjs', 'tests/security.test.mjs', 'tests/queue.test.mjs', 'tests/ai.test.mjs', 'tests/meter.test.mjs']) {
  try {
    const out = cp.execSync('node "' + t + '"', { stdio: 'pipe' }).toString().trim().split('\n').pop();
    console.log('  ok ' + t + ' — ' + out);
  } catch (e) { fail++; console.error('  x ' + t + '\n    ' + String(e.stdout || '').split('\n').filter(l => /FAIL/.test(l)).join('\n    ')); }
}
// The library, checked against studio.html's own PREMIUM registry:
//   · every pool is a real family.direction; copy 01 IS that direction's default, word for word
//   · every copy has exactly the direction's fields (url excluded — that comes from the Brand Kit)
//   · ids are family.dir.NN in order (the log stores ids; order is meaning), 30 per pool
//   · no two copies in a pool are the same copy (same fingerprint = the rotation would skip one)
//   · no empty field, and no field wildly longer than the default (the render suite is the real
//     fit test; this catches the obvious case in a second instead of a minute)
(function checkLibrary() {
  if (!fs.existsSync('copy-library.js') || !fs.existsSync('copy-rotation.js')) { fail++; console.error('  x copy-library.js / copy-rotation.js missing — run npm run sync'); return; }
  const load = (f) => { const m = { exports: {} }; new Function('module', 'exports', fs.readFileSync(f, 'utf8'))(m, m.exports); return m.exports; };
  const LIB = load('copy-library.js'), R = load('copy-rotation.js');
  // Pull the PREMIUM literal out of studio.html with a string-aware brace walk, then evaluate it.
  const src = fs.readFileSync('studio.html', 'utf8'), at = src.indexOf('const PREMIUM = {');
  let PREMIUM = null;
  if (at >= 0) {
    let i = src.indexOf('{', at), depth = 0, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      // Comments hold apostrophes ("Joel's", "don't") that would otherwise open a phantom string.
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') depth++;
      else if (c === '}' && !--depth) break;
    }
    try { PREMIUM = new Function('return ' + src.slice(src.indexOf('{', at), i + 1))(); } catch (e) { /* reported below */ }
  }
  if (!PREMIUM) { fail++; console.error('  x could not read PREMIUM from studio.html'); return; }
  const problems = [];
  let variants = 0;
  for (const key of Object.keys(LIB)) {
    const [fam, dir] = key.split('.'), d = PREMIUM[fam] && PREMIUM[fam].dirs[dir];
    if (!d) { problems.push(key + ': not a PREMIUM family.direction'); continue; }
    const seed = Object.assign({}, d.fields); delete seed.url;
    const keys = Object.keys(seed).sort().join(',');
    const pool = LIB[key];
    if (pool.length !== 30) problems.push(key + ': ' + pool.length + ' copies (want 30)');
    const hashes = R.poolHashes(pool);
    if (new Set(hashes).size !== hashes.length) problems.push(key + ': two copies are the same copy');
    if (R.hashCopy(pool[0].f) !== R.hashCopy(seed) || JSON.stringify(pool[0].f) !== JSON.stringify(seed)) problems.push(key + ': copy 01 is not the design\'s default copy');
    pool.forEach((v, i) => {
      variants++;
      if (v.id !== key + '.' + String(i + 1).padStart(2, '0')) problems.push(key + ': copy ' + (i + 1) + ' has id ' + v.id);
      if (Object.keys(v.f).sort().join(',') !== keys) problems.push(v.id + ': fields differ from the design (' + Object.keys(v.f).join(',') + ')');
      for (const k of Object.keys(v.f)) {
        const s = String(v.f[k] || '').trim(), lim = Math.max(Math.round(String(seed[k] || '').length * 1.35), String(seed[k] || '').length + 6);
        if (!s) problems.push(v.id + '.' + k + ': empty');
        else if (s.length > lim) problems.push(v.id + '.' + k + ': ' + s.length + ' chars (default is ' + String(seed[k]).length + ', limit ' + lim + ')');
      }
    });
  }
  if (problems.length) { fail++; console.error('  x copy-library.js:\n      ' + problems.slice(0, 40).join('\n      ') + (problems.length > 40 ? '\n      …and ' + (problems.length - 40) + ' more' : '')); }
  else console.log('  ok copy-library.js — ' + Object.keys(LIB).length + ' designs, ' + variants + ' copies, all match the registry');
})();

// SECRET SCAN. This repo is PUBLIC and served as a website, so a committed key is a published key.
// (The GitHub gitleaks action needs a paid licence for organisations; this covers the formats that
// actually matter here.) The Supabase ANON key and Google Fonts keys are public by design: a JWT is
// only flagged if its payload says service_role.
console.log('Secret scan (tracked files):');
(function secretScan() {
  let files;
  try { files = cp.execSync('git ls-files', { stdio: 'pipe' }).toString().split('\n').filter(Boolean); }
  catch (e) { console.log('  · skipped (not a git checkout)'); return; }
  const SKIP = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|exe|bin|pdf|mp4|webm|mp3|svg)$/i;
  const PATTERNS = [
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['Stripe/Paystack live secret', /\b(?:sk_live|rk_live)_[A-Za-z0-9]{16,}/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Groq key', /\bgsk_[A-Za-z0-9]{30,}/],
    ['Resend key', /\bre_[A-Za-z0-9]{20,}/],
  ];
  const hits = [];
  for (const f of files) {
    if (SKIP.test(f) || f.startsWith('node_modules/') || f.startsWith('tests/')) continue;
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    if (txt.length > 3e6) continue;
    for (const [name, re] of PATTERNS) if (re.test(txt)) hits.push(f + ': ' + name);
    for (const m of txt.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      try { const p = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); if (p && p.role === 'service_role') hits.push(f + ': Supabase SERVICE-ROLE key'); } catch (e) { /* not a JWT */ }
    }
  }
  if (hits.length) { fail++; console.error('  x possible secret(s) committed to a PUBLIC repo:\n      ' + hits.join('\n      ')); }
  else console.log('  ok no secrets found in ' + files.length + ' tracked files');
})();

// SUPPLY CHAIN. The sign-in library (which holds every user's session) loads from a third-party CDN on
// every page. It must be pinned to an exact version AND carry an integrity hash, or a compromised
// release reaches everyone instantly. (Other CDN scripts — the Tailwind runtime — can't be hashed;
// that is tracked in the audit as "replace with built CSS".)
console.log('Supply chain:');
(function supplyChain() {
  const f = 'volt-auth.js';
  if (!fs.existsSync(f)) { console.log('  · skipped'); return; }
  const t = fs.readFileSync(f, 'utf8');
  const floating = /supabase-js@\d+\/dist/.test(t);                 // "@2/" with no minor.patch
  const pinned = /supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.min\.js/.test(t);
  const hashed = /s\.integrity\s*=\s*"sha384-[A-Za-z0-9+\/=]{60,}"/.test(t) && /crossOrigin\s*=\s*"anonymous"/.test(t);
  if (floating || !pinned || !hashed) { fail++; console.error('  x volt-auth.js: supabase-js must be pinned to an exact version with an SRI hash (floating=' + floating + ', pinned=' + pinned + ', hashed=' + hashed + ')'); }
  else console.log('  ok supabase-js is pinned to an exact version with an integrity hash');
})();

// Optional: verify the live API rejects unauthenticated requests (fail-closed).
const base = process.argv[2];
async function live() {
  console.log('Live contract check @ ' + base + ':');
  const cases = [['/api/generate', 'POST'], ['/api/projects', 'GET'], ['/api/image', 'POST']];
  for (const [p, method] of cases) {
    try {
      const r = await fetch(base.replace(/\/+$/, '') + p, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      const ok = r.status === 401 || r.status === 503;
      console.log((ok ? '  ok ' : '  x  ') + p + ' → ' + r.status + (ok ? ' (rejects unauth)' : ' (EXPECTED 401/503!)'));
      if (!ok) fail++;
    } catch (e) { console.error('  x ' + p + ' → ' + e.message); fail++; }
  }
}

(async () => {
  if (base && /^https?:\/\//.test(base)) await live();
  if (fail) { console.error('\nx ' + fail + ' check(s) failed.'); process.exit(1); }
  console.log('\nok all checks passed.');
})();
