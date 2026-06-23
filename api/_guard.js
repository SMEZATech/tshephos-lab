// Volt — shared API security guard. © 2026 Tshepho Joel.
// Underscore prefix → Vercel does NOT expose this as an endpoint; it's a helper only.
//
// Provides: CORS with an origin allow-list, the optional app-key check, and rate
// limiting. Rate limiting uses Upstash Redis (durable, global) when configured, and
// otherwise falls back to a best-effort in-memory limiter per warm instance.
//
// To enable DURABLE rate limiting (recommended), create a free Upstash Redis DB and add:
//   UPSTASH_REDIS_REST_URL    and    UPSTASH_REDIS_REST_TOKEN
// in Vercel → Settings → Environment Variables, then redeploy.

import crypto from "crypto";

const ALLOWED_HEADERS =
  "Content-Type, Authorization, x-app-key, x-client, x-gemini-key, x-groq-key, x-postiz-key, x-postiz-url, x-kit-key, x-wp-url, x-wp-user, x-wp-key";

function isAllowedOrigin(o) {
  if (!o) return false;
  if (/^https:\/\/tshephos-lab[\w-]*\.vercel\.app$/.test(o)) return true; // prod + preview deploys
  if (/^http:\/\/localhost(:\d+)?$/.test(o)) return true;                 // local dev
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(o)) return true;
  return false;
}

// Reflect the request origin only when it's on the allow-list; otherwise pin to prod.
// Note: the desktop app runs with webSecurity disabled, so CORS never blocks it — this
// only stops other websites' browser JS from calling the API with the public app key.
function setCors(req, res, methods) {
  const o = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", isAllowedOrigin(o) ? o : "https://tshephos-lab.vercel.app");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods || "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
}

function appKeyOk(req) {
  const APP_KEY = process.env.APP_KEY;
  if (!APP_KEY) return true; // unset = open (backwards compatible)
  return req.headers["x-app-key"] === APP_KEY;
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

const _mem = new Map(); // key -> { count, reset }

// Returns { ok, remaining, limit }. Never throws — on any backend error it fails OPEN
// (allows the request) so a limiter outage can't take the app down.
async function rateLimit(req, opts = {}) {
  const { id = "api", limit = 30, windowSec = 60 } = opts;
  const key = "rl:" + id + ":" + clientIp(req);
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      const r = await fetch(url.replace(/\/+$/, "") + "/pipeline", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, windowSec, "NX"]]),
      });
      const data = await r.json();
      const n = Number(Array.isArray(data) && data[0] && (data[0].result != null ? data[0].result : data[0])) || 0;
      return { ok: n <= limit, remaining: Math.max(0, limit - n), limit };
    } catch (e) {
      // fall through to in-memory
    }
  }

  const now = Date.now();
  let e = _mem.get(key);
  if (!e || e.reset < now) e = { count: 0, reset: now + windowSec * 1000 };
  e.count++;
  _mem.set(key, e);
  if (_mem.size > 5000) { for (const [k, v] of _mem) if (v.reset < now) _mem.delete(k); }
  return { ok: e.count <= limit, remaining: Math.max(0, limit - e.count), limit };
}

// One-call gate: handles OPTIONS, method, app-key and rate limit. Returns true if the
// handler should STOP (response already sent), false if it should proceed.
async function blocked(req, res, { methods = "POST, OPTIONS", method = "POST", id = "api", limit = 30, windowSec = 60 } = {}) {
  setCors(req, res, methods);
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  if (req.method !== method) { res.status(405).json({ error: "Method not allowed" }); return true; }
  if (!appKeyOk(req)) { res.status(401).json({ error: "Unauthorized" }); return true; }
  const rl = await rateLimit(req, { id, limit, windowSec });
  res.setHeader("X-RateLimit-Limit", String(rl.limit));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (!rl.ok) { res.status(429).json({ error: "Too many requests — please slow down and try again in a minute." }); return true; }
  return false;
}

// ===== Phase A (auth) helpers — additive. blocked() above is unchanged (still app-key mode)
// until the flip, so the live app is untouched. These power /api/whoami and, later, /api/keys. =====

function sbBase() { return (process.env.SUPABASE_URL || "").replace(/\/+$/, ""); }
async function sbRest(path) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(sbBase() + "/rest/v1/" + path, { headers: { apikey: svc, Authorization: "Bearer " + svc } });
  return r.ok ? r.json() : null;
}

// Verify the caller's Supabase session JWT → { user, orgId } or { error }.
async function requireSession(req) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return { error: "AUTH_NOT_CONFIGURED" };
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "NO_SESSION" };
  const ur = await fetch(sbBase() + "/auth/v1/user", {
    headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + token },
  });
  if (!ur.ok) return { error: "INVALID_SESSION" };
  const user = await ur.json();
  if (!user || !user.id) return { error: "INVALID_SESSION" };
  const rows = await sbRest("member?select=org_id&limit=1&user_id=eq." + encodeURIComponent(user.id));
  const orgId = rows && rows[0] && rows[0].org_id;
  if (!orgId) return { error: "NO_ORG" };
  return { user, orgId };
}

// ---- per-org encrypted key storage (AES-256-GCM; used by /api/keys and at the flip) ----
function masterKey() {
  const buf = Buffer.from(process.env.SECRETS_MASTER_KEY || "", "base64");
  if (buf.length !== 32) throw new Error("SECRETS_MASTER_KEY must be 32 bytes (base64).");
  return buf;
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decryptSecret(b64) {
  const raw = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
async function getOrgKey(orgId, provider) {
  const rows = await sbRest("org_secret?select=ciphertext&limit=1&org_id=eq." + encodeURIComponent(orgId) + "&provider=eq." + encodeURIComponent(provider));
  if (!rows || !rows[0] || !rows[0].ciphertext) return null;
  try { return decryptSecret(rows[0].ciphertext); } catch (e) { return null; }
}

export { setCors, appKeyOk, rateLimit, clientIp, isAllowedOrigin, blocked, requireSession, getOrgKey, encryptSecret, decryptSecret, sbRest };
