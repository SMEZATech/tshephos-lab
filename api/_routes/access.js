// Volt — what may this person open? © 2026 Tshepho Joel.
//
//   GET /api/access  → 200 { studioOnly: boolean }   signed-in callers
//                    → 401                           signed out
//
// The owner can limit named people to Studio (STUDIO_ONLY_EMAILS, see _guard.js). The server already
// refuses every other tool for them; this only lets the page show the right menu and send them to
// Studio instead of letting them walk into a wall of 403s. Per-person, so never cacheable.

import { setCors, rateLimit, requireSession } from "../_guard.js";

export default async function handler(req, res) {
  setCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Origin, Authorization");
  const rl = await rateLimit(req, { id: "access", limit: 60, windowSec: 60 });
  if (!rl.ok) return res.status(429).json({ error: "Too many requests — try again in a minute." });
  const s = await requireSession(req);
  if (s.error) return res.status(401).json({ error: "Please sign in to continue.", code: s.error });
  return res.status(200).json({ studioOnly: !!s.studioOnly });
}
