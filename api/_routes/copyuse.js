// Volt — Studio copy rotation log. © 2026 Tshepho Joel.
//
// THE RULE: the same copy never ships twice on the same design + size + brand. A design is a
// (family, direction) pair — Funding › Pain-Point Hook — and "size" is the export format, so a copy
// used on Portrait stays fair game on Landscape until Landscape has used it too.
//
// Why server-side: the Variety Coach that already existed kept its history in each person's own
// localStorage, so one teammate could never see what another had already published — which is the
// exact loophole this closes. Every download is checked HERE against the whole workspace's log,
// then written to it; the browser's own check is only there to explain the block before it happens.
//
//   GET  ?brand=&family=     → { owner, uses:[{dir,size,hash,variant,at,by,mine}] }  (one family)
//   GET  ?action=summary     → { uses:[{brand,family,dir,size,variant,at}] }   library pool status
//   GET  ?action=recent      → { uses:[…last 60 downloads…] }                  audit trail (Admin)
//   POST { action:'record', items:[{brand,family,dir,size,hash,variant,source}], override? }
//        → 200 { ok, recorded } | 409 { code:'ALREADY_USED', conflicts:[{family,dir,size,at,by}] }
//
// Two deliberate exceptions to the rule (Joel's call, 2026-09-28):
//   · GRACE — the same person may re-download the same copy within an hour of their own last
//     download of it. A failed save or a lost file is not the laziness this exists to stop.
//   · OVERRIDE — the workspace owner (isOwner) may knowingly re-publish; the row is flagged.
// A batch (the carousel ZIP) is all-or-nothing: one blocked slide blocks the file, nothing is logged.
// And one case that isn't an exception but would otherwise be a dead end: when every copy in a
// design's library has been published on a size, the oldest is RECYCLED (Joel's call — recycle and
// flag, don't block the design). The server verifies the pool really is spent before allowing it.
//
// Not configured yet (the SQL hasn't been run) → 503 NOT_CONFIGURED. Studio then FAILS OPEN with a
// local-only guard and says so — a missing table must never stop the team shipping work.

import { blocked, db, isOwner } from "../_guard.js";

const TABLE = "studio_copy_use";
const GRACE_MS = 60 * 60 * 1000;
const SIZES = new Set(["landscape", "square", "portrait", "story",
  "motion-landscape", "motion-square", "motion-portrait", "motion-story"]);
const SOURCES = new Set(["single", "story", "carousel", "motion"]);
const enc = (v) => encodeURIComponent(String(v));
const slug = (v) => { const s = String(v == null ? "" : v).trim(); return /^[A-Za-z0-9_.:-]{1,60}$/.test(s) ? s : null; };
const hashOk = (v) => /^[a-z0-9]{6,32}$/.test(String(v || ""));

function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  const brand = slug(it.brand), family = slug(it.family), dir = slug(it.dir);
  const size = String(it.size || ""), hash = String(it.hash || "");
  if (!brand || !family || !dir || !SIZES.has(size) || !hashOk(hash)) return null;
  const variant = it.variant ? slug(it.variant) : null;
  const source = SOURCES.has(it.source) ? it.source : "single";
  // recycle: the client says every copy in this design's library has been used on this size, so
  // the oldest is coming back. Only meaningful for a library variant; verified below against the log.
  const poolSize = Number(it.poolSize);
  const recycle = !!it.recycle && !!variant && Number.isInteger(poolSize) && poolSize >= 1 && poolSize <= 200;
  return { brand, family, dir, size, hash, variant, source, recycle, poolSize: recycle ? poolSize : 0 };
}

export default async function handler(req, res) {
  const method = req.method === "GET" ? "GET" : "POST";
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method, id: "copyuse", limit: 90, windowSec: 60 })) return;
  const { user, orgId } = req.volt;
  const s = { user };
  const store = db(orgId);
  const q = req.query || {};

  try {
    if (req.method === "GET") {
      if (q.action === "summary") {
        const rows = await store.select(TABLE, "select=brand_key,family,dir,size,variant_id,created_at&variant_id=not.is.null&order=created_at.desc&limit=5000");
        if (rows == null) return notConfigured(res);
        return res.status(200).json({ uses: rows.map((r) => ({ brand: r.brand_key, family: r.family, dir: r.dir, size: r.size, variant: r.variant_id, at: r.created_at })) });
      }
      if (q.action === "recent") {
        const rows = await store.select(TABLE, "select=brand_key,family,dir,size,variant_id,source,override,regrace,recycled,user_email,created_at&order=created_at.desc&limit=60");
        if (rows == null) return notConfigured(res);
        return res.status(200).json({ uses: rows });
      }
      const brand = slug(q.brand), family = slug(q.family);
      if (!brand || !family) return res.status(400).json({ error: "brand and family are required." });
      const rows = await store.select(TABLE,
        "select=dir,size,copy_hash,variant_id,created_at,user_email,user_id&brand_key=eq." + enc(brand) +
        "&family=eq." + enc(family) + "&order=created_at.desc&limit=2000");
      if (rows == null) return notConfigured(res);
      return res.status(200).json({
        owner: isOwner(s),
        uses: rows.map((r) => ({ dir: r.dir, size: r.size, hash: r.copy_hash, variant: r.variant_id, at: r.created_at, by: r.user_email || "", mine: r.user_id === user.id })),
      });
    }

    // ---- POST: record a download (or refuse it)
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    if (body.action !== "record") return res.status(400).json({ error: "Unknown action." });
    const raw = Array.isArray(body.items) ? body.items : [];
    if (!raw.length || raw.length > 20) return res.status(400).json({ error: "Send between 1 and 20 items." });
    const items = raw.map(cleanItem);
    if (items.some((x) => !x)) return res.status(400).json({ error: "One of the items is malformed." });
    const wantOverride = body.override === true;
    const owner = isOwner(s);
    if (wantOverride && !owner) return res.status(403).json({ error: "Only the workspace owner can override a used copy." });

    const now = Date.now();
    const decisions = [];
    for (const it of items) {
      const prior = await store.select(TABLE,
        "select=created_at,user_email,user_id&brand_key=eq." + enc(it.brand) + "&family=eq." + enc(it.family) +
        "&dir=eq." + enc(it.dir) + "&size=eq." + enc(it.size) + "&copy_hash=eq." + enc(it.hash) +
        "&order=created_at.desc&limit=1");
      if (prior == null) return notConfigured(res);
      const last = prior[0];
      if (!last) { decisions.push({ it, regrace: false, override: false }); continue; }
      const mineRecent = last.user_id === user.id && (now - new Date(last.created_at).getTime()) < GRACE_MS;
      if (mineRecent) { decisions.push({ it, regrace: true, override: false }); continue; }
      if (it.recycle) {
        // Recycling is only allowed when the pool really is spent on this size: the log must show
        // at least poolSize DIFFERENT library copies already published here. Otherwise it's just a
        // repeat wearing a "recycle" label, and gets blocked like any other.
        const used = await store.select(TABLE,
          "select=variant_id&brand_key=eq." + enc(it.brand) + "&family=eq." + enc(it.family) +
          "&dir=eq." + enc(it.dir) + "&size=eq." + enc(it.size) + "&variant_id=not.is.null&limit=2000");
        if (used == null) return notConfigured(res);
        const distinct = new Set(used.map((u) => u.variant_id)).size;
        if (distinct >= it.poolSize) { decisions.push({ it, regrace: false, override: false, recycled: true }); continue; }
      }
      if (wantOverride) { decisions.push({ it, regrace: false, override: true }); continue; }
      decisions.push({ it, conflict: { family: it.family, dir: it.dir, size: it.size, at: last.created_at, by: last.user_email || "" } });
    }

    const conflicts = decisions.filter((d) => d.conflict).map((d) => d.conflict);
    if (conflicts.length) return res.status(409).json({ code: "ALREADY_USED", owner, conflicts, error: "This copy has already been published on that size." });

    let recorded = 0;
    for (const d of decisions) {
      const row = await store.insert(TABLE, {
        brand_key: d.it.brand, family: d.it.family, dir: d.it.dir, size: d.it.size, copy_hash: d.it.hash,
        variant_id: d.it.variant, source: d.it.source, override: d.override, regrace: d.regrace, recycled: !!d.recycled,
        user_id: user.id, user_email: user.email || null,
      });
      if (row == null) return notConfigured(res);
      recorded++;
    }
    return res.status(200).json({ ok: true, recorded, regrace: decisions.some((d) => d.regrace), override: decisions.some((d) => d.override), recycled: decisions.some((d) => d.recycled) });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Copy log error" });
  }
}

function notConfigured(res) {
  return res.status(503).json({ error: "NOT_CONFIGURED", message: "The shared copy log isn't set up yet — run sql/studio_copy_use.sql in Supabase." });
}
