// Volt — saved projects (Phase B persistence). © 2026 Tshepho Joel.
// Per-account storage for any tool's work (email drafts, copy, video looks, brand kits…).
// Auth: a valid Supabase session is required; ALL access goes through db(orgId), which
// injects the org scope automatically — an unscoped query cannot be expressed here (H1).
//
//   GET  ?type=email            → list this org's projects of that type (id,type,title,updated_at)
//   GET  ?id=<uuid>             → fetch one project (full data)
//   POST {op:"save", id?, type, title, data}  → insert (no id) or update (with id)
//   POST {op:"delete", id}      → delete

import { setCors, rateLimit, requireSession, db, workspaceInfo } from "./_guard.js";

const enc = (v) => encodeURIComponent(String(v));

// Org settings are owner-only to WRITE (everyone reads them — that is how enforcement works).
// VOLT_ADMIN_EMAIL (or VANTLY_ADMIN_EMAIL, whichever this deployment set — see below) is
// comma-separated so the same person can own settings in more than one org (e.g. a private
// per-person workspace alongside the shared team one — see ALLOWED_EMAIL_EXTRA in _guard.js)
// without this ever granting cross-org access: each email still only ever resolves to its OWN org
// via resolveOrg(), so listing a second address here can't let it touch someone else's.
//
// VANTLY_ADMIN_EMAIL checked first, not VOLT_ADMIN_EMAIL || VANTLY_ADMIN_EMAIL: this is one
// shared codebase running as two brands (see volt-auth.js's BRANDS table), and "VOLT_" in a
// variable name Vantly's own Vercel project depends on reads as exactly the leftover coupling
// this whole multi-brand approach exists to avoid — Vantly's deployment gets its own cleanly
// named variable, full stop, not a brand-specific override bolted onto Volt's name.
const isAdmin = (s) => {
  const email = String((s && s.user && s.user.email) || "").toLowerCase();
  const raw = process.env.VANTLY_ADMIN_EMAIL || process.env.VOLT_ADMIN_EMAIL || "joel@smesouthafrica.co.za";
  const list = String(raw).toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  return list.includes(email);
};

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
  const store = db(s.orgId);

  try {
    if (req.method === "GET") {
      // ?who=1 — which workspace am I in, who else is in it, and is anything split across a
      // duplicate? Saved looks, drafts and brand kits are ALL org-scoped, so "my colleague's look
      // doesn't show up" has exactly one root cause worth checking first, and there was no way to
      // check it. Read-only, and it never reports another org's contents — only how many rows are
      // stranded there, which is what you need to decide whether to merge.
      if (req.query && req.query.who) {
        return res.status(200).json({ you: s.user.email, ...(await workspaceInfo(s.user, s.orgId)) });
      }
      const id = req.query && req.query.id;
      if (id) {
        const rows = (await store.select("project", "select=*&id=eq." + enc(id))) || [];
        if (!rows[0]) return res.status(404).json({ error: "Not found." });
        return res.status(200).json({ project: rows[0] });
      }
      const type = req.query && req.query.type;
      const q = "select=id,type,title,updated_at&order=updated_at.desc" + (type ? "&type=eq." + enc(type) : "");
      const rows = (await store.select("project", q)) || [];
      return res.status(200).json({ projects: rows });
    }

    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const op = String(body.op || "save");

    if (op === "delete") {
      if (!body.id) return res.status(400).json({ error: "Missing id." });
      const cur = (await store.select("project", "select=type&id=eq." + enc(body.id))) || [];
      if (cur[0] && cur[0].type === "orgsettings" && !isAdmin(s)) {
        return res.status(403).json({ error: "Only the account owner can change module settings." });
      }
      await store.remove("project", "id=eq." + enc(body.id));
      return res.status(200).json({ ok: true });
    }

    // save (upsert)
    const type = String(body.type || "").slice(0, 40);
    const title = String(body.title || "Untitled").slice(0, 200);
    const data = (body.data && typeof body.data === "object") ? body.data : {};
    if (!type) return res.status(400).json({ error: "Missing type." });

    // Org settings (which modules/designs are live) are OWNER-ONLY. Everyone in the org must be
    // able to READ them — that's how enforcement works on every page — but only the owner writes.
    // Enforced here, server-side: hiding the admin page in the UI would not be a control.
    let effectiveType = type;
    if (body.id) {
      // An update sends the id, not the type — so read the stored type, or a non-owner could
      // edit the settings row simply by omitting type.
      const cur = (await store.select("project", "select=type&id=eq." + enc(body.id))) || [];
      if (cur[0] && cur[0].type) effectiveType = cur[0].type;
    }
    if (effectiveType === "orgsettings" && !isAdmin(s)) {
      return res.status(403).json({ error: "Only the account owner can change module settings." });
    }
    if (JSON.stringify(data).length > 600000) return res.status(413).json({ error: "That project is too large to save." });

    const rows = body.id
      ? await store.update("project", "id=eq." + enc(body.id), { title, data, updated_at: new Date().toISOString() })
      : await store.insert("project", { type, title, data, created_by: s.user.id });
    if (!rows || !rows[0]) return res.status(502).json({ error: "Could not save — try again." });
    return res.status(200).json({ project: rows[0] });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Projects error" });
  }
}
