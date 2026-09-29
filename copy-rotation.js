// Volt — Studio copy rotation. © 2026 Tshepho Joel.
//
// THE RULE: the same copy never ships twice on the same design + size + brand. A "design" is a
// family + direction (Funding › Pain-Point Hook); a copy used on Portrait is still fair game on
// Landscape until Landscape has used it too.
//
// This file is the pure logic (fingerprinting, choosing the next copy, deciding if the copy on
// screen is already spent) plus a thin client for /api/copyuse. It runs in the browser AND in Node,
// on purpose: smoke.cjs unit-tests the selection rules directly, so "which copy comes next" is a
// tested fact rather than something only a person clicking through Studio would ever notice.
//
// Where fresh copy comes from is NOT decided here. Promotional designs (Funding, Hub, Serv…) have a
// written library in copy-library.js; content designs (webinars, quotes, founders, glossary…) get
// their copy from the real event or article. Both go through the same guard.
//
// The server is the authority. Everything here that says "blocked" is an explanation shown before
// the download — /api/copyuse re-checks the whole workspace's log and has the final word. If that
// log isn't reachable (SQL not run yet, offline), this falls back to a guard kept in this browser
// and says so, rather than stopping the team from shipping.

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoltCopyRotation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API = 'https://tshephos-lab.vercel.app/api/copyuse';
  var GRACE_MS = 60 * 60 * 1000;       // must match api/_routes/copyuse.js
  var NON_COPY = { url: true };        // the brand's address, not copy — never part of the fingerprint
  var LOCAL_KEY = 'volt_copy_use_local_v1';

  // ---- fingerprinting ---------------------------------------------------------------------------
  // Case and spacing are ignored, so re-typing the same line with an extra space is still the same
  // copy. Anything more than that counts as new copy — this stops laziness, not a determined person.
  function copyKeys(vals) {
    return Object.keys(vals || {}).filter(function (k) { return !NON_COPY[k]; }).sort();
  }
  function norm(v) { return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function fingerprint(vals) {
    return copyKeys(vals).map(function (k) { return k + '=' + norm(vals[k]); }).join('␞');
  }
  // cyrb53: a fast, well-distributed 53-bit string hash. Not cryptographic, and doesn't need to be.
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function hashCopy(vals) {
    var s = cyrb53(fingerprint(vals)).toString(36);
    while (s.length < 8) s = '0' + s;
    return s;
  }
  // Pools are static, so each variant's hash is computed once, not on every keystroke.
  var _poolHashes = typeof WeakMap === 'function' ? new WeakMap() : null;
  function poolHashes(pool) {
    if (!pool) return [];
    if (_poolHashes && _poolHashes.has(pool)) return _poolHashes.get(pool);
    var h = pool.map(function (v) { return hashCopy(v.f); });
    if (_poolHashes) _poolHashes.set(pool, h);
    return h;
  }

  // ---- the usage index --------------------------------------------------------------------------
  // uses: [{dir,size,hash,variant,at,by,mine}] for ONE brand + family → dir → size → hash → last use.
  function indexUses(uses) {
    var idx = {};
    (uses || []).forEach(function (u) {
      if (!u || !u.dir || !u.size || !u.hash) return;
      var d = idx[u.dir] || (idx[u.dir] = {});
      var s = d[u.size] || (d[u.size] = {});
      var t = typeof u.at === 'number' ? u.at : (Date.parse(u.at) || 0);
      var cur = s[u.hash];
      if (!cur || t > cur.at) s[u.hash] = { at: t, by: u.by || '', mine: !!u.mine };
    });
    return idx;
  }
  function lastUse(idx, dir, size, hash) {
    var d = idx && idx[dir], s = d && d[size];
    return (s && s[hash]) || null;
  }
  function inGrace(use, now) { return !!use && use.mine && ((now || Date.now()) - use.at) < GRACE_MS; }
  function countFresh(pool, idx, dir, size) {
    var h = poolHashes(pool), n = 0;
    for (var i = 0; i < h.length; i++) if (!lastUse(idx, dir, size, h[i])) n++;
    return n;
  }

  // ---- choosing the copy ------------------------------------------------------------------------
  // Deterministic, so two teammates opening the same design see the same next copy: the first
  // variant (in library order) not yet published on this size. `after` = the index currently on
  // screen, for "Next copy" — the search starts just past it and wraps. When every variant has been
  // published on this size the pool is exhausted and the least-recently-published comes back
  // (Joel's call: recycle the oldest and flag it, rather than block the design outright).
  function pick(pool, idx, dir, size, after) {
    if (!pool || !pool.length) return null;
    var n = pool.length, h = poolHashes(pool);
    var start = (after == null || after < 0) ? -1 : after;
    for (var step = 1; step <= n; step++) {
      var i = (start + step + n) % n;
      if (i === start && start >= 0) continue;          // "next" must actually move if it can
      if (!lastUse(idx, dir, size, h[i])) {
        return { index: i, variant: pool[i], exhausted: false, fresh: countFresh(pool, idx, dir, size) };
      }
    }
    if (start >= 0 && !lastUse(idx, dir, size, h[start])) {
      return { index: start, variant: pool[start], exhausted: false, fresh: countFresh(pool, idx, dir, size) };
    }
    var best = -1, bestAt = Infinity;
    for (var j = 0; j < n; j++) {
      if (n > 1 && j === start) continue;
      var u = lastUse(idx, dir, size, h[j]), t = u ? u.at : 0;
      if (t < bestAt) { bestAt = t; best = j; }
    }
    if (best < 0) best = 0;
    return { index: best, variant: pool[best], exhausted: true, fresh: 0, lastAt: bestAt };
  }

  // What the status line says about the copy that's on screen right now.
  // recyclable: a library copy that HAS been used here, but every copy in the pool has, so it's the
  // oldest coming back round — allowed (the server verifies the pool really is spent). A custom or
  // autofilled copy is never recyclable: only the library has a "round" to come back around.
  function status(vals, idx, dir, size, pool, now) {
    var hash = hashCopy(vals);
    var use = lastUse(idx, dir, size, hash);
    var grace = inGrace(use, now);
    var vi = -1;
    if (pool) { var h = poolHashes(pool); vi = h.indexOf(hash); }
    var fresh = pool ? countFresh(pool, idx, dir, size) : null;
    var exhausted = !!pool && pool.length > 0 && fresh === 0;
    var recyclable = !!use && !grace && exhausted && vi >= 0;
    return {
      hash: hash, use: use, grace: grace, recyclable: recyclable, exhausted: exhausted,
      blocked: !!use && !grace && !recyclable,
      variantIndex: vi, poolSize: pool ? pool.length : 0, fresh: fresh,
    };
  }

  // ---- client for /api/copyuse, with a browser-local fallback ---------------------------------
  var cache = {};   // 'brand|family' → { promise, data:{uses,owner,shared,reason} }
  function key(brand, family) { return brand + '|' + family; }
  function enc(v) { return encodeURIComponent(String(v)); }

  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') || []; } catch (e) { return []; } }
  function writeLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a.slice(-3000))); } catch (e) {} }
  function localUses(brand, family) {
    return readLocal().filter(function (u) { return u.brand === brand && u.family === family; })
      .map(function (u) { return { dir: u.dir, size: u.size, hash: u.hash, variant: u.variant, at: u.at, by: 'you (this browser)', mine: true }; });
  }
  // A download that happened while the shared log was unreachable is kept here, marked pending, and
  // sent to the server the next time it answers — so an outage doesn't quietly leave holes in it.
  function rememberLocal(items) {
    var a = readLocal(), now = Date.now();
    items.forEach(function (it) { a.push({ brand: it.brand, family: it.family, dir: it.dir, size: it.size, hash: it.hash, variant: it.variant || null, source: it.source, at: now, pending: true }); });
    writeLocal(a);
  }
  function flushPending() {
    var a = readLocal(), pending = a.filter(function (u) { return u.pending; });
    if (!pending.length) return;
    var items = pending.slice(0, 20).map(function (u) { return { brand: u.brand, family: u.family, dir: u.dir, size: u.size, hash: u.hash, variant: u.variant, source: u.source || 'single' }; });
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'record', items: items }) })
      .then(function (r) {
        // 200 = logged; 409 = the server already had it (someone else, or an earlier flush). Either
        // way it's accounted for — only a real failure keeps it pending for next time.
        if (r.ok || r.status === 409) {
          var sent = pending.slice(0, 20);
          writeLocal(readLocal().map(function (u) { return sent.some(function (s) { return s.at === u.at && s.hash === u.hash && s.size === u.size; }) ? Object.assign({}, u, { pending: false }) : u; }));
        }
      }).catch(function () {});
  }

  function load(brand, family, force) {
    var k = key(brand, family);
    if (!force && cache[k] && cache[k].promise) return cache[k].promise;
    var entry = { promise: null, data: null };
    entry.promise = fetch(API + '?brand=' + enc(brand) + '&family=' + enc(family), { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
      .then(function (x) {
        if (x.r.ok) { flushPending(); return { uses: x.b.uses || [], owner: !!x.b.owner, shared: true }; }
        return { uses: localUses(brand, family), owner: false, shared: false, reason: x.b.error || ('HTTP ' + x.r.status) };
      })
      .catch(function () { return { uses: localUses(brand, family), owner: false, shared: false, reason: 'offline' }; })
      .then(function (d) { entry.data = d; return d; });
    cache[k] = entry;
    return entry.promise;
  }
  function data(brand, family) { var e = cache[key(brand, family)]; return (e && e.data) || null; }
  // Fold a successful download into the cached log straight away, so the status line flips to
  // "published" the moment the file is saved, without waiting for a refetch.
  function noteInCache(items) {
    var now = Date.now();
    items.forEach(function (it) {
      var d = data(it.brand, it.family);
      if (d) d.uses.unshift({ dir: it.dir, size: it.size, hash: it.hash, variant: it.variant || null, at: now, by: 'you', mine: true });
    });
  }

  function record(items, override) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'record', items: items, override: !!override }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
      .then(function (x) {
        if (x.r.ok) { noteInCache(items); return { ok: true, shared: true, regrace: !!x.b.regrace, override: !!x.b.override }; }
        if (x.r.status === 409) return { ok: false, blocked: true, conflicts: x.b.conflicts || [], owner: !!x.b.owner };
        if (x.r.status === 403) return { ok: false, forbidden: true, error: x.b.error || 'Not allowed.' };
        rememberLocal(items); noteInCache(items);
        return { ok: true, shared: false, reason: x.b.error || ('HTTP ' + x.r.status) };
      })
      .catch(function () { rememberLocal(items); noteInCache(items); return { ok: true, shared: false, reason: 'offline' }; });
  }

  return {
    API: API, GRACE_MS: GRACE_MS,
    hashCopy: hashCopy, fingerprint: fingerprint, poolHashes: poolHashes,
    indexUses: indexUses, lastUse: lastUse, inGrace: inGrace, countFresh: countFresh,
    pick: pick, status: status,
    load: load, data: data, record: record,
  };
});
