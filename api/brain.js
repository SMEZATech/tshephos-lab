// Volt Brain — the insight compiler + reader. © 2026 Tshepho Joel.
//   GET  ?action=insights  → { summary, updatedAt, postCount }   (computes on first view / when stale)
//   POST {action:"refresh"} → force a recompute now
// Distils an org's real post outcomes (post_metric) + edit patterns (content_event) into a
// small, plain-English insight block. Costs ~one Gemini Flash call per refresh (pennies).
// Everything is per-org, service-role only. This is the compounding, un-copyable asset.

import { blocked, sbRest, sbBase } from "./_guard.js";

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
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method === "POST" ? "POST" : "GET", id: "brain", limit: 20, windowSec: 60 })) return;
  try {
    const orgId = req.volt && req.volt.orgId;
    const key = (req.headers["x-gemini-key"] && String(req.headers["x-gemini-key"])) || process.env.GEMINI_API_KEY;
    const enc = encodeURIComponent(orgId);
    const rows = (await sbRest("org_insight?select=data,updated_at&org_id=eq." + enc + "&kind=eq.summary&limit=1")) || [];
    const existing = rows[0];
    const ageDays = existing ? (Date.now() - new Date(existing.updated_at).getTime()) / 86400000 : Infinity;

    const force = req.method === "POST";
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
