// Volt — saved projects (Phase B persistence). © 2026 Tshepho Joel.
// Per-account storage for any tool's work (email drafts, copy, video jobs, brand kits…).
// Auth: a valid Supabase session is required; everything is scoped to the user's org.
//
//   GET  ?type=email            → list this org's projects of that type (id,type,title,updated_at)
//   GET  ?id=<uuid>             → fetch one project (full data)
//   POST {op:"save", id?, type, title, data}  → insert (no id) or update (with id)
//   POST {op:"delete", id}      → delete

import { setCors, rateLimit, requireSession } from "./_guard.js";

export default async function handler(req, res) {
  setCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rl = await rateLimit(req, { id: "projects", limit: 60, windowSec: 60 });
  if (!rl.ok) return res.status(429).json({ error: "Too many requests — slow down a moment." });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: "Storage isn’t configured." });
  }
  const s = await requireSession(req);
  if (s.error) return res.status(401).json({ error: "Please sign in to continue.", code: s.error });
  const orgId = s.orgId;

  const SB = process.env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/project";
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const orgFilter = "org_id=eq." + encodeURIComponent(orgId);

  try {
    if (req.method === "GET") {
      const id = req.query && req.query.id;
      if (id) {
        const r = await fetch(SB + "?select=*&" + orgFilter + "&id=eq." + encodeURIComponent(String(id)), { headers: H });
        const rows = r.ok ? await r.json() : [];
        if (!rows[0]) return res.status(404).json({ error: "Not found." });
        return res.status(200).json({ project: rows[0] });
      }
      const type = req.query && req.query.type;
      let q = SB + "?select=id,type,title,updated_at&order=updated_at.desc&" + orgFilter;
      if (type) q += "&type=eq." + encodeURIComponent(String(type));
      const r = await fetch(q, { headers: H });
      return res.status(200).json({ projects: r.ok ? await r.json() : [] });
    }

    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const op = String(body.op || "save");

    if (op === "delete") {
      if (!body.id) return res.status(400).json({ error: "Missing id." });
      await fetch(SB + "?id=eq." + encodeURIComponent(String(body.id)) + "&" + orgFilter, { method: "DELETE", headers: H });
      return res.status(200).json({ ok: true });
    }

    // save (upsert)
    const type = String(body.type || "").slice(0, 40);
    const title = String(body.title || "Untitled").slice(0, 200);
    const data = (body.data && typeof body.data === "object") ? body.data : {};
    if (!type) return res.status(400).json({ error: "Missing type." });
    if (JSON.stringify(data).length > 600000) return res.status(413).json({ error: "That project is too large to save." });

    let r;
    if (body.id) {
      r = await fetch(SB + "?id=eq." + encodeURIComponent(String(body.id)) + "&" + orgFilter, {
        method: "PATCH",
        headers: { ...H, Prefer: "return=representation" },
        body: JSON.stringify({ title, data, updated_at: new Date().toISOString() }),
      });
    } else {
      r = await fetch(SB, {
        method: "POST",
        headers: { ...H, Prefer: "return=representation" },
        body: JSON.stringify({ org_id: orgId, type, title, data, created_by: s.user.id }),
      });
    }
    const rows = r.ok ? await r.json() : null;
    if (!rows || !rows[0]) return res.status(502).json({ error: "Could not save — try again." });
    return res.status(200).json({ project: rows[0] });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Projects error" });
  }
}
