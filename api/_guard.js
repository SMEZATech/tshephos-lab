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
  const rl = await rateLimit(req, { id, limit, windowSec });
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (!rl.ok) { res.status(429).json({ error: "Too many requests — please slow down and try again in a minute." }); return true; }
  // Auth is a real Supabase session, full stop. If the Supabase env is missing we FAIL CLOSED
  // (503) rather than silently reverting to the old public app-key path (which was fully open
  // when APP_KEY was also unset). The legacy app-key branch is retired.
  if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)) {
    res.status(503).json({ error: "Auth isn't configured on the server.", code: "AUTH_NOT_CONFIGURED" });
    return true;
  }
  const s = await requireSession(req);
  if (s.error) { res.status(401).json({ error: "Please sign in to continue.", code: s.error }); return true; }
  req.volt = { user: s.user, orgId: s.orgId };
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
async function sbWrite(table, body) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(sbBase() + "/rest/v1/" + table, {
    method: "POST",
    headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : null;
}
async function ensureMember(orgId, userId, role) {
  const m = await sbRest("member?select=user_id&limit=1&org_id=eq." + encodeURIComponent(orgId) + "&user_id=eq." + encodeURIComponent(userId));
  if (!(m && m[0])) await sbWrite("member", { org_id: orgId, user_id: userId, role: role || "member" });
}
// Resolve the caller's org, keyed by EMAIL DOMAIN so a team shares ONE workspace (drafts, brand
// kit, Brain). First same-domain user anchors the org; later same-domain users join it.
async function resolveOrg(user) {
  const email = String(user.email || "");
  const domain = (email.split("@")[1] || "").toLowerCase();
  // 1) An org already keyed to this domain? Join it.
  if (domain) {
    const dom = await sbRest("org?select=id&limit=1&name=eq." + encodeURIComponent(domain));
    const orgId = dom && dom[0] && dom[0].id;
    if (orgId) { await ensureMember(orgId, user.id); return orgId; }
  }
  // 2) User already has a (legacy per-user) org? Adopt it as the domain workspace — keeps their data.
  const mine = await sbRest("member?select=org_id&limit=1&user_id=eq." + encodeURIComponent(user.id));
  const existing = mine && mine[0] && mine[0].org_id;
  if (existing) {
    if (domain) await sbPatch("org", "id=eq." + encodeURIComponent(existing), { name: domain });
    return existing;
  }
  // 3) Brand-new: create the shared domain org + owner membership.
  const orgRows = await sbWrite("org", { name: domain || email || "My Org" });
  const orgId = orgRows && orgRows[0] && orgRows[0].id;
  if (!orgId) return null;
  await sbWrite("member", { org_id: orgId, user_id: user.id, role: "owner" });
  return orgId;
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
  // Only org-domain accounts may use the API — protects the shared provider keys / budget.
  // Configurable via ALLOWED_EMAIL_DOMAIN (set to "" to allow any, e.g. when commercialising).
  const allow = (process.env.ALLOWED_EMAIL_DOMAIN != null ? process.env.ALLOWED_EMAIL_DOMAIN : "smesouthafrica.co.za").toLowerCase();
  if (allow && !String(user.email || "").toLowerCase().endsWith("@" + allow)) return { error: "NOT_AUTHORIZED" };
  const orgId = await resolveOrg(user); // domain-keyed shared workspace (team sees each other's work)
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

// ===== Phase C (billing + metering) — additive. Records usage on every metered call;
// only ENFORCES limits when BILLING_ENFORCE="1", so the live app is never blocked until
// you opt in. Everything below fails OPEN on error. =====

// Plan catalog. aiLimit = generations/month (-1 = unlimited). priceZar = monthly price.
// FREE IS UNLIMITED ON PURPOSE. There is no billing wired up (no Paystack key, BILLING_ENFORCE
// off), so a 150/month cap could never be collected on — all it did was render an alarming
// over-limit bar at 320/150 in Settings and imply a restriction that does not exist. Usage is
// still metered on every call, because the number is worth seeing (cost control, and it is the
// input to any future pricing). Put a real number back here only when billing is actually live.
const PLANS = {
  free:      { label: "Free",      aiLimit: -1,   priceZar: 0 },
  starter:   { label: "Starter",   aiLimit: 1500, priceZar: 299 },
  pro:       { label: "Pro",       aiLimit: 6000, priceZar: 799 },
  unlimited: { label: "Unlimited", aiLimit: -1,   priceZar: 0 }, // internal / comped
};

async function sbPatch(table, filter, body) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(sbBase() + "/rest/v1/" + table + "?" + filter, {
    method: "PATCH",
    headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : null;
}
async function recordUsage(orgId, kind, units, userId, meta) {
  // The usage_event table has NO user_id column — including it made PostgREST 400 the entire
  // insert (silently, via sbWrite→null + an empty catch), so usage NEVER recorded and the meter
  // sat at 0. Org-scoped attribution is all billing needs. (userId kept in the signature for
  // callers; add a user_id column + migration if per-user tracking is wanted later.)
  try {
    const row = {
      org_id: orgId, kind: kind || "ai", units: units || 1,
      tool: (meta && meta.tool) || kind || null,
      provider: (meta && meta.provider) || null,
      model: (meta && meta.model) || null,
    };
    const ok = await sbWrite("usage_event", row);
    if (!ok) console.warn("[usage] recordUsage write failed for org", orgId, "kind", kind);
    return ok;
  } catch (e) { console.warn("[usage] recordUsage threw", e && e.message); return null; }
}
async function getOrgPlan(orgId) {
  try {
    const rows = await sbRest("org?select=plan&limit=1&id=eq." + encodeURIComponent(orgId));
    return (rows && rows[0] && rows[0].plan) || "free";
  } catch (e) { return "free"; }
}
async function setOrgPlan(orgId, plan) {
  if (!PLANS[plan]) return null;
  return sbPatch("org", "id=eq." + encodeURIComponent(orgId), { plan });
}
async function monthUsage(orgId) {
  // Fast path: a single SQL aggregate (org_month_usage RPC from brain.sql) — no row scan.
  try {
    const svc = process.env.SUPABASE_SERVICE_KEY;
    const r = await fetch(sbBase() + "/rest/v1/rpc/org_month_usage", {
      method: "POST", headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" },
      body: JSON.stringify({ p_org: orgId }),
    });
    if (r.ok) { const v = await r.json(); const n = Number(Array.isArray(v) ? v[0] : v); if (Number.isFinite(n)) return n; }
  } catch (e) {}
  // Fallback (until the RPC migration is applied): the old row scan.
  try {
    const d = new Date();
    const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const rows = await sbRest("usage_event?select=units&org_id=eq." + encodeURIComponent(orgId) + "&created_at=gte." + encodeURIComponent(since) + "&limit=20000");
    if (!rows) return 0;
    return rows.reduce((a, r) => a + (Number(r.units) || 1), 0);
  } catch (e) { return 0; }
}
// Call AFTER blocked() (so req.volt is set). Returns true if the request should STOP
// (over quota → 402). Records the usage either way. No-op in app-key mode (no orgId).
async function meter(req, res, opts = {}) {
  try {
    const orgId = req.volt && req.volt.orgId;
    if (!orgId) return false;
    const units = opts.units || 1;
    const userId = req.volt.user && req.volt.user.id;
    await recordUsage(orgId, opts.kind || "ai", units, userId, { tool: opts.kind, provider: opts.provider || (process.env.LLM_PROVIDER || "gemini"), model: opts.model }); // awaited so the write isn't dropped on return
    if (process.env.BILLING_ENFORCE !== "1") return false;
    const plan = await getOrgPlan(orgId);
    const def = PLANS[plan] || PLANS.free;
    if (def.aiLimit < 0) return false; // unlimited
    const used = await monthUsage(orgId);
    if (used > def.aiLimit) {
      res.status(402).json({ error: "Monthly limit reached on the " + def.label + " plan. Upgrade to keep generating.", code: "PLAN_LIMIT", used, limit: def.aiLimit, plan });
      return true;
    }
    return false;
  } catch (e) { return false; } // fail OPEN — billing must never take the app down
}

// ===== Org-scoped DB access (H1) — every call REQUIRES an orgId and injects org_id=eq.,
// so an endpoint physically cannot issue an unscoped query. Use for ALL per-org tables. =====
function db(orgId) {
  if (!orgId) throw new Error("db() requires an orgId");
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const base = sbBase() + "/rest/v1/";
  const scope = "org_id=eq." + encodeURIComponent(orgId);
  return {
    async select(table, query) {
      const r = await fetch(base + table + "?" + scope + (query ? "&" + query : ""), { headers: H });
      return r.ok ? r.json() : null;
    },
    async insert(table, row) {
      const r = await fetch(base + table, { method: "POST", headers: Object.assign({}, H, { Prefer: "return=representation" }), body: JSON.stringify(Object.assign({ org_id: orgId }, row)) });
      return r.ok ? r.json() : null;
    },
    async update(table, extra, patch) {
      const r = await fetch(base + table + "?" + scope + (extra ? "&" + extra : ""), { method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
      return r.ok ? r.json() : null;
    },
    async remove(table, extra) {
      const r = await fetch(base + table + "?" + scope + (extra ? "&" + extra : ""), { method: "DELETE", headers: H });
      return r.ok;
    },
  };
}

// ===== Volt Brain (data flywheel) — best-effort logging. NEVER throws / blocks the request. =====
// Log one AI generation → content_item. Returns the new id (or null).
async function logContent(orgId, item = {}) {
  try {
    if (!orgId) return null;
    const rows = await sbWrite("content_item", {
      org_id: orgId,
      tool: String(item.tool || "").slice(0, 40),
      brand_id: item.brandId || null,
      input: item.input || {},
      output: item.output || {},
      model: item.model || null,
      provider: item.provider || null,
      created_by: item.userId || null,
    });
    return (rows && rows[0] && rows[0].id) || null;
  } catch (e) { return null; }
}
// Log what the human did with a generation → content_event.
async function logEvent(orgId, contentId, event, detail) {
  try {
    if (!orgId || !event) return;
    await sbWrite("content_event", { org_id: orgId, content_id: contentId || null, event: String(event).slice(0, 40), detail: detail || {} });
  } catch (e) {}
}
// Upsert a real-world outcome (from Postiz) → post_metric.
async function recordMetric(orgId, m = {}) {
  try {
    if (!orgId || !m.external_id) return;
    const svc = process.env.SUPABASE_SERVICE_KEY;
    await fetch(sbBase() + "/rest/v1/post_metric", {
      method: "POST",
      headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        org_id: orgId, platform: m.platform || null, external_id: String(m.external_id),
        posted_text: (m.posted_text || "").slice(0, 4000),
        likes: m.likes | 0, comments: m.comments | 0, shares: m.shares | 0, impressions: m.impressions | 0,
        engagement: Number(m.engagement) || 0, published_at: m.published_at || null,
      }),
    });
  } catch (e) {}
}

export { setCors, appKeyOk, rateLimit, clientIp, isAllowedOrigin, blocked, requireSession, getOrgKey, encryptSecret, decryptSecret, sbRest, sbBase, sbWrite, sbPatch, PLANS, meter, recordUsage, getOrgPlan, setOrgPlan, monthUsage, logContent, logEvent, recordMetric, db };
