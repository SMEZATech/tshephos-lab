// Volt — Phase A auth test endpoint. © 2026 Tshepho Joel.
// Verifies the caller's Supabase session and returns who they are + their org id.
// Used by /auth-test.html to prove the sign-in → JWT → server chain works end-to-end
// BEFORE we gate the whole app on it. Touches nothing in the live app.

import { setCors, rateLimit, requireSession } from "./_guard.js";

export default async function handler(req, res) {
  setCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const rl = await rateLimit(req, { id: "whoami", limit: 30, windowSec: 60 });
  if (!rl.ok) return res.status(429).json({ error: "Too many requests." });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ ok: false, error: "Supabase env vars not set in Vercel (SUPABASE_URL / SUPABASE_SERVICE_KEY)." });
  }

  const s = await requireSession(req);
  if (s.error) return res.status(401).json({ ok: false, error: s.error });

  return res.status(200).json({
    ok: true,
    email: s.user.email || null,
    userId: s.user.id,
    orgId: s.orgId,
  });
}
