// Volt Brain — the insight compiler + reader. © 2026 Tshepho Joel.
//   GET  ?action=insights  → { summary, updatedAt, postCount }   (computes on first view / when stale)
//   POST {action:"refresh"} → force a recompute now
// Distils an org's real post outcomes (post_metric) + edit patterns (content_event) into a
// small, plain-English insight block. Costs ~one Gemini Flash call per refresh (pennies).
// Everything is per-org, service-role only. This is the compounding, un-copyable asset.

import { blocked, sbRest, sbBase, logEvent, writeStats } from "../_guard.js";

const STALE_DAYS = 7;
const MIN_POSTS = 5;

async function gemini(prompt, key) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Gemini error");
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || "").join("");
}

async function upsertInsight(orgId, kind, data) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  await fetch(sbBase() + "/rest/v1/org_insight", {
    method: "POST",
    headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ org_id: orgId, kind, data, window_days: 120, updated_at: new Date().toISOString() }),
  });
}

async function compute(orgId, key) {
  const enc = encodeURIComponent(orgId);
  const posts = (await sbRest("post_metric?select=posted_text,engagement,likes,impressions&org_id=eq." + enc + "&order=engagement.desc&limit=40")) || [];
  if (posts.length < MIN_POSTS) {
    await upsertInsight(orgId, "summary", { status: "learning", note: "Volt is still gathering data. Keep publishing and checking Analytics — insights unlock after ~" + MIN_POSTS + " tracked posts.", postCount: posts.length });
    return { status: "learning", postCount: posts.length };
  }
  const top = posts.slice(0, Math.min(12, Math.ceil(posts.length / 2)));
  const bottom = posts.slice(-Math.min(12, Math.floor(posts.length / 2)));
  const fmt = (arr) => arr.map((p, i) => (i + 1) + ". [eng " + Math.round(p.engagement || 0) + "] " + String(p.posted_text || "").slice(0, 160)).join("\n");
  const prompt =
    "You are a performance-marketing analyst. Below are a brand's BEST and WORST performing social posts by real engagement.\n\n" +
    "TOP PERFORMERS:\n" + fmt(top) + "\n\nWORST PERFORMERS:\n" + fmt(bottom) + "\n\n" +
    "Extract concrete, specific patterns THIS brand's audience responds to. Base every claim on the evidence above — no generic advice. " +
    'Return JSON only: {"do_more":["short specific tactic", ...3-5], "do_less":["short specific tactic", ...2-4], "hooks":["angle/hook style that worked", ...2-3], "hashtags":["#tag that appears in winners", ...0-5], "evidence":"one sentence citing the data (e.g. based on N posts)"}';
  const raw = await gemini(prompt, key);
  let parsed;
  try { parsed = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim()); } catch (e) { parsed = null; }
  if (!parsed) { await upsertInsight(orgId, "summary", { status: "learning", note: "Couldn't distil insights this time — try refreshing.", postCount: posts.length }); return { status: "error" }; }
  const summary = {
    status: "ready",
    postCount: posts.length,
    do_more: (parsed.do_more || []).slice(0, 6).map(String),
    do_less: (parsed.do_less || []).slice(0, 5).map(String),
    hooks: (parsed.hooks || []).slice(0, 4).map(String),
    hashtags: (parsed.hashtags || []).slice(0, 6).map(String),
    evidence: String(parsed.evidence || "").slice(0, 200),
  };
  await upsertInsight(orgId, "summary", summary);
  return summary;
}

export default async function handler(req, res) {
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method === "POST" ? "POST" : "GET", id: "brain", limit: 200, windowSec: 60 })) return;
  try {
    const orgId = req.volt && req.volt.orgId;
    const body = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {})) : {};

    // Content-event beacon (folded in from the old /api/events). Best-effort, always 200.
    if (req.method === "POST" && body.action === "event") {
      try {
        const ev = String(body.event || "").trim();
        if (ev) await logEvent(orgId, body.contentId || null, ev, (body.detail && typeof body.detail === "object") ? body.detail : {});
      } catch (e) {}
      return res.status(200).json({ ok: true });
    }

    // ---- Data-pipeline diagnostic ----------------------------------------------------------
    // The whole defensible asset is the per-org performance history, and every writer fails OPEN,
    // so "the schema was never applied" and "everything is fine" looked identical from the outside.
    // This probes each table directly and reports whether it EXISTS and how many rows this org has,
    // plus this instance's write successes/failures. Read-only, no AI spend.
    if (req.method === "GET" && String(req.query.action || "") === "diag") {
      const enc = encodeURIComponent(orgId);
      const TABLES = ["content_item", "content_event", "post_metric", "org_insight", "usage_event"];
      const svc = process.env.SUPABASE_SERVICE_KEY;
      const probe = async (t) => {
        try {
          // HEAD + Prefer: count=exact gives the row count in Content-Range without pulling rows.
          // No `select=` on purpose: org_insight is keyed on (org_id, kind) and has NO id column,
          // so asking for one made PostgREST 400 and this probe reported a table that exists as
          // MISSING — the check inventing the very failure it was built to detect.
          const r = await fetch(sbBase() + "/rest/v1/" + t + "?org_id=eq." + enc, {
            method: "HEAD",
            headers: { apikey: svc, Authorization: "Bearer " + svc, Prefer: "count=exact", Range: "0-0" },
          });
          if (!r.ok) return { table: t, exists: false, rows: null, error: "HTTP " + r.status };
          const cr = r.headers.get("content-range") || "";      // e.g. "0-0/412"
          const n = parseInt((cr.split("/")[1] || ""), 10);
          return { table: t, exists: true, rows: isFinite(n) ? n : null };
        } catch (e) { return { table: t, exists: false, rows: null, error: (e && e.message) || "error" }; }
      };
      const tables = await Promise.all(TABLES.map(probe));
      const missing = tables.filter((t) => !t.exists).map((t) => t.table);
      const empty = tables.filter((t) => t.exists && t.rows === 0).map((t) => t.table);
      return res.status(200).json({
        ok: missing.length === 0,
        // The one-line answer to "is the moat actually filling up?"
        verdict: missing.length ? "SCHEMA MISSING — run supabase/brain.sql"
               : (tables.find((t) => t.table === "content_item" && t.rows === 0) ? "Schema present but NOTHING has been recorded yet"
               : "Recording"),
        tables, missing, empty,
        writes: writeStats(),   // per warm instance: what this lambda has managed to write
      });
    }

    // Recent client-side crashes for this org — so a break for ANY user is visible in /health.html
    // instead of waiting for someone to report it. Read-only, no AI spend.
    if (req.method === "GET" && String(req.query.action || "") === "errors") {
      const enc0 = encodeURIComponent(orgId);
      const rows = (await sbRest(
        "content_event?select=detail,created_at&org_id=eq." + enc0 +
        "&event=eq.client_error&order=created_at.desc&limit=50")) || [];
      const seen = new Map();
      for (const r of rows) {
        const d = (r && r.detail) || {};
        const k = String(d.page || "") + "|" + String(d.message || "");
        if (!k.trim() || k === "|") continue;
        const cur = seen.get(k);
        if (cur) { cur.count++; continue; }
        seen.set(k, { page: String(d.page || ""), message: String(d.message || "").slice(0, 240),
          src: String(d.src || ""), line: d.line || null, lastAt: r.created_at, count: 1 });
      }
      return res.status(200).json({ errors: Array.from(seen.values()).slice(0, 20) });
    }

    const key = (req.headers["x-gemini-key"] && String(req.headers["x-gemini-key"])) || process.env.GEMINI_API_KEY;
    const enc = encodeURIComponent(orgId);
    const rows = (await sbRest("org_insight?select=data,updated_at&org_id=eq." + enc + "&kind=eq.summary&limit=1")) || [];
    const existing = rows[0];
    const ageDays = existing ? (Date.now() - new Date(existing.updated_at).getTime()) / 86400000 : Infinity;

    const force = req.method === "POST" && body.action === "refresh";
    if ((force || !existing || ageDays > STALE_DAYS)) {
      if (!key) {
        if (existing) return res.status(200).json({ summary: existing.data, updatedAt: existing.updated_at });
        return res.status(503).json({ error: "Insights need a Gemini key.", code: "NOT_CONFIGURED" });
      }
      const summary = await compute(orgId, key);
      return res.status(200).json({ summary, updatedAt: new Date().toISOString() });
    }
    return res.status(200).json({ summary: existing.data, updatedAt: existing.updated_at });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
