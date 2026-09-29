// Unit tests for app/copy-rotation.js (the selection + blocking rules). Run by smoke.cjs.
const path = require('path'), fs = require('fs');
// This repo is "type": "module", so require() of a plain .js would parse it as ESM. The file is UMD —
// evaluate it with a CommonJS-shaped module object instead.
function loadUMD(file) { const m = { exports: {} }; new Function('module', 'exports', fs.readFileSync(file, 'utf8'))(m, m.exports); return m.exports; }
const R = loadUMD(process.argv[2] || path.join(__dirname, '..', 'copy-rotation.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' → ' + JSON.stringify(d)); } };

const pool = [1, 2, 3, 4].map(i => ({ id: 'x.a.0' + i, f: { head: 'Head ' + i, cta: 'Go ' + i + ' →' } }));
const H = R.poolHashes(pool);
const t0 = Date.parse('2026-09-01T10:00:00Z');
const use = (i, size, at, mine) => ({ dir: 'a', size, hash: H[i], variant: pool[i].id, at: new Date(at).toISOString(), by: 'thabo@x', mine: !!mine });

// fingerprint ignores url, case and spacing — but not wording
ok('url is not part of the copy', R.hashCopy({ head: 'Hi', url: 'a.co' }) === R.hashCopy({ head: 'Hi', url: 'b.co' }));
ok('case/spacing ignored', R.hashCopy({ head: 'Fuel  your GROWTH.' }) === R.hashCopy({ head: 'fuel your growth.' }));
ok('different wording = different copy', R.hashCopy({ head: 'Fuel your growth.' }) !== R.hashCopy({ head: 'Fuel your growth!' }));
ok('field order irrelevant', R.hashCopy({ a: '1', b: '2' }) === R.hashCopy({ b: '2', a: '1' }));
ok('hash format fits the API (a-z0-9, 6-32)', H.every(h => /^[a-z0-9]{6,32}$/.test(h)), H);
ok('4 variants → 4 distinct hashes', new Set(H).size === 4);

// nothing used → first variant
let idx = R.indexUses([]);
let p = R.pick(pool, idx, 'a', 'portrait');
ok('fresh pool → variant 1, 4 fresh', p.index === 0 && p.fresh === 4 && !p.exhausted, p);

// variant 1 used on portrait → portrait gets 2, landscape still gets 1
idx = R.indexUses([use(0, 'portrait', t0)]);
ok('used on portrait → portrait serves variant 2', R.pick(pool, idx, 'a', 'portrait').index === 1);
ok('…but landscape still serves variant 1', R.pick(pool, idx, 'a', 'landscape').index === 0);
ok('a different direction is unaffected', R.pick(pool, idx, 'b', 'portrait').index === 0);

// "Next copy" skips used ones and wraps
idx = R.indexUses([use(0, 'portrait', t0), use(2, 'portrait', t0)]);
ok('next after 1 skips used 2 → 3 is index 3 (0-based)', R.pick(pool, idx, 'a', 'portrait', 1).index === 3);
ok('next after 3 wraps to 1 (0-based index 1)', R.pick(pool, idx, 'a', 'portrait', 3).index === 1);

// only the current one is unused → next stays on it rather than jumping to a used one
idx = R.indexUses([use(0, 'portrait', t0), use(2, 'portrait', t0), use(3, 'portrait', t0)]);
let q = R.pick(pool, idx, 'a', 'portrait', 1);
ok('only current unused → stays, not exhausted', q.index === 1 && !q.exhausted, q);

// exhausted → least recently used, and flagged
idx = R.indexUses([use(0, 'portrait', t0 + 3e6), use(1, 'portrait', t0 + 1e6), use(2, 'portrait', t0 + 4e6), use(3, 'portrait', t0 + 2e6)]);
q = R.pick(pool, idx, 'a', 'portrait');
ok('exhausted → oldest published (variant 2) comes back', q.exhausted && q.index === 1 && q.fresh === 0, q);
q = R.pick(pool, idx, 'a', 'portrait', 1);
ok('exhausted + next → next-oldest, never the one on screen', q.exhausted && q.index === 3, q);

// status: blocked vs grace
const now = t0 + 10 * 60 * 1000;
idx = R.indexUses([use(0, 'portrait', t0, false)]);
let s = R.status(pool[0].f, idx, 'a', 'portrait', pool, now);
ok("teammate's copy on this size → blocked", s.blocked && !s.grace && s.variantIndex === 0, s);
idx = R.indexUses([use(0, 'portrait', t0, true)]);
s = R.status(pool[0].f, idx, 'a', 'portrait', pool, now);
ok('my own copy 10 min ago → grace, not blocked', s.grace && !s.blocked, s);
s = R.status(pool[0].f, idx, 'a', 'portrait', pool, t0 + 61 * 60 * 1000);
ok('my own copy 61 min ago → blocked', s.blocked, s);
s = R.status({ head: 'Something I typed', cta: 'Go →' }, idx, 'a', 'portrait', pool, now);
ok('custom copy → not blocked, not a library variant', !s.blocked && s.variantIndex === -1, s);
s = R.status(pool[0].f, idx, 'a', 'square', pool, now);
ok('same copy, other size → not blocked', !s.blocked, s);

// exhausted pool: a used library copy becomes recyclable; custom copy never does
idx = R.indexUses([0, 1, 2, 3].map(i => use(i, 'portrait', t0 - 9e6 + i, false)));
s = R.status(pool[0].f, idx, 'a', 'portrait', pool, now);
ok('spent pool → used library copy is recyclable, not blocked', s.recyclable && !s.blocked && s.exhausted, s);
idx = R.indexUses([use(0, 'portrait', t0 - 9e6, false)]);
s = R.status(pool[0].f, idx, 'a', 'portrait', pool, now);
ok('pool NOT spent → used copy is blocked, not recyclable', s.blocked && !s.recyclable, s);
idx = R.indexUses([{ dir: 'a', size: 'portrait', hash: R.hashCopy({ head: 'Mine', cta: 'x' }), at: new Date(t0).toISOString(), mine: false },
  ...[0, 1, 2, 3].map(i => use(i, 'portrait', t0 - 9e6 + i, false))]);
s = R.status({ head: 'Mine', cta: 'x' }, idx, 'a', 'portrait', pool, now);
ok('custom copy is never recyclable, even with a spent pool', s.blocked && !s.recyclable, s);

// the latest use wins when the same hash appears more than once
idx = R.indexUses([use(0, 'portrait', t0, true), use(0, 'portrait', t0 - 9e6, false)]);
ok('latest use is the one that counts', R.lastUse(idx, 'a', 'portrait', H[0]).mine === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
