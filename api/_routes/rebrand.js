// Volt — SMESA 2026 rebrand preview. © 2026 Tshepho Joel.
//
// THE GATE. Every 2026 template (the "SME South Africa 2026" Brand Kit, the Studio families, the five
// mailers, the video package) is DEFINED here, server-side, in api/_rebrand/ — never in app/*.js,
// because anything in the page bundle is readable by anyone who opens devtools on the deployed site.
// A UI-only hide is not a gate. Pages fetch this after sign-in and only show the 2026 options if it
// answers 200.
//
//   GET /api/rebrand  → 200 { version, kit, studio, email, video }   previewer only (isRebrandPreviewer)
//                     → 403 { code:'REBRAND_PREVIEW_ONLY' }            everyone else, INCLUDING no session
//
// No session gets 403, not the usual 401, on purpose: the answer to "can I see the 2026 templates"
// is the same no whether you are signed out or signed in as someone else, and a distinct status
// would only tell a caller which of the two to try next.
//
// Release: see isRebrandPreviewer in _guard.js — one flag, or one env var.

import { setCors, rateLimit, requireSession, isRebrandPreviewer } from "../_guard.js";
import { definitions } from "../_rebrand/index.js";

export default async function handler(req, res) {
  setCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  // Per-person content: never let a CDN or shared cache hand Joel's answer to the next caller.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Origin, Authorization");
  const rl = await rateLimit(req, { id: "rebrand", limit: 30, windowSec: 60 });
  if (!rl.ok) return res.status(429).json({ error: "Too many requests — try again in a minute." });

  const deny = () => res.status(403).json({ error: "Not available.", code: "REBRAND_PREVIEW_ONLY" });
  const s = await requireSession(req);           // fails closed: missing Supabase env → error → 403
  if (s.error || !isRebrandPreviewer(s)) return deny();
  return res.status(200).json(definitions());
}
