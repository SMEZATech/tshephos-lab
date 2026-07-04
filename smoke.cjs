#!/usr/bin/env node
// Volt — static smoke test. Fast, no network: node --check every serverless function and
// every page's last inline script. Run before pushing:  node smoke.cjs
// Optional live contract check: node smoke.cjs https://tshephos-lab.vercel.app
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
let fail = 0;

console.log('Backend (api/*.js):');
for (const f of fs.readdirSync('api').filter(n => n.endsWith('.js'))) {
  try { cp.execSync('node --check "api/' + f + '"', { stdio: 'pipe' }); console.log('  ok ' + f); }
  catch (e) { fail++; console.error('  x ' + f + '\n    ' + String(e.stderr || e.message).split('\n').slice(0, 2).join('\n    ')); }
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
