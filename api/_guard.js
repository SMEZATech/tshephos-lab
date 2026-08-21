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
// Every logging helper (logContent/logEvent/recordMetric/recordUsage) fails OPEN — a logging
// failure must never break a generation. The cost of that is invisibility: if the brain tables were
// never created, every insert has been returning null forever and nothing anywhere says so. These
// counters are the cheapest possible fix — the write still fails open, but it now leaves a trace
// that /api/brain?action=diag can report. Per warm instance and non-durable, which is fine: they
// answer "is this broken RIGHT NOW", not "how much have we lost".
const _writeStats = Object.create(null);
function noteWrite(table, ok, detail) {
  const s = _writeStats[table] || (_writeStats[table] = { ok: 0, fail: 0, lastError: null });
  if (ok) s.ok++;
  else { s.fail++; if (detail) s.lastError = String(detail).slice(0, 300); }
}
function writeStats() { return _writeStats; }

async function sbWrite(table, body) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  try {
    const r = await fetch(sbBase() + "/rest/v1/" + table, {
      method: "POST",
      headers: { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      // Keep the reason: "relation \"content_item\" does not exist" is the difference between
      // "the schema was never applied" and "one row was malformed", and guessing wastes days.
      noteWrite(table, false, await r.text().catch(() => "HTTP " + r.status));
      return null;
    }
    noteWrite(table, true);
    return r.json();
  } catch (e) {
    noteWrite(table, false, (e && e.message) || "network error");
    return null;
  }
}
async function ensureMember(orgId, userId, role) {
  const m = await sbRest("member?select=user_id&limit=1&org_id=eq." + encodeURIComponent(orgId) + "&user_id=eq." + encodeURIComponent(userId));
  if (!(m && m[0])) await sbWrite("member", { org_id: orgId, user_id: userId, role: role || "member" });
}
// Resolve the caller's org, keyed by EMAIL DOMAIN so a team shares ONE workspace (drafts, brand
// kit, Brain). First same-domain user anchors the org; later same-domain users join it.
// Free-mail providers are NOT organisations. Keying a workspace to the email domain is right for a
// company domain — everyone on @smesouthafrica.co.za should share drafts, brand kit and the Brain —
// but catastrophic for @gmail.com, where it would put every unrelated customer in ONE workspace
// seeing each other's work. Most of the SA SME market runs on free mail, so this is a hard blocker
// on ever charging for Volt. It's fixed now because it is far cheaper before there is data to
// migrate than after: today every user is on the company domain, so this branch is a no-op for
// them and changes nothing about who can sign in (that's ALLOWED_EMAIL_DOMAIN, untouched).
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.za", "ymail.com", "icloud.com", "me.com", "aol.com",
  "protonmail.com", "proton.me", "zoho.com", "mail.com", "gmx.com", "webmail.co.za", "vodamail.co.za",
]);
// The org KEY: a company domain shares one workspace; free mail gets a private per-user workspace.
// Prefixed so a free-mail key can never collide with a real domain name.
function orgKeyFor(user) {
  const email = String(user.email || "").toLowerCase();
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (!domain || FREEMAIL.has(domain)) return "user:" + user.id;
  return domain;
}

// Which org a caller belongs to. This decides whether two colleagues on the same domain see each
// other's saved looks, drafts and brand kit — so a wrong answer here looks like "the feature is
// broken", never like an auth bug.
//
// THE ORDER MATTERS, and it did not used to:
//   - The lookup was `limit=1` with no ordering. Postgres does not promise a stable row for that,
//     so with two orgs sharing a key, two users could resolve to DIFFERENT workspaces on the same
//     domain — and each would see an empty list where the other's work should be.
//   - Step 2 ADOPTED a pre-keying org and renamed it to the domain key without first checking
//     whether an org with that key already existed. That is how a duplicate gets created in the
//     first place: user A anchors "smesouthafrica.co.za", user B's older personal org is renamed
//     to "smesouthafrica.co.za" too, and now the domain has two workspaces.
//
// Fixed by making the choice deterministic (OLDEST org with the key always wins) and by checking
// the domain org BEFORE adopting a personal one. Nothing is deleted or merged here — that would
// move data without asking. `workspaceInfo()` reports duplicates so they can be merged on purpose.
async function resolveOrg(user) {
  const email = String(user.email || "");
  const key = orgKeyFor(user);
  // 1) An org already keyed this way? Join the OLDEST one, always. Deterministic beats whichever
  //    row the database felt like returning.
  const found = await sbRest("org?select=id&order=created_at.asc&limit=1&name=eq." + encodeURIComponent(key));
  const foundId = found && found[0] && found[0].id;
  if (foundId) { await ensureMember(foundId, user.id); return foundId; }

  // 2) User already has an org from before this keying existed? Adopt it — never orphan their data.
  //    Safe to rename now: step 1 established that no org holds this key yet.
  const mine = await sbRest("member?select=org_id&limit=1&user_id=eq." + encodeURIComponent(user.id));
  const existing = mine && mine[0] && mine[0].org_id;
  if (existing) {
    await sbPatch("org", "id=eq." + encodeURIComponent(existing), { name: key });
    return existing;
  }
  // 3) Brand-new.
  const orgRows = await sbWrite("org", { name: key || email || "My Org" });
  const orgId = orgRows && orgRows[0] && orgRows[0].id;
  if (!orgId) return null;
  await sbWrite("member", { org_id: orgId, user_id: user.id, role: "owner" });
  return orgId;
}

// Who am I sharing with, and is anything split? Everything saved in Volt is org-scoped, so when a
// colleague's work does not appear the question is always "are we in the same workspace" — and
// until now there was no way to answer it except by guessing.
// Reports the resolved workspace, how many people are in it, and — the part that matters — whether
// more than one org claims this domain, with how much work is stranded in the others.
async function workspaceInfo(user, orgId) {
  const key = orgKeyFor(user);
  const out = { workspace: key, orgId: orgId, members: null, duplicates: 0, strandedProjects: 0 };
  try {
    const mem = await sbRest("member?select=user_id&org_id=eq." + encodeURIComponent(orgId));
    out.members = Array.isArray(mem) ? mem.length : null;
    const orgs = await sbRest("org?select=id,created_at&order=created_at.asc&name=eq." + encodeURIComponent(key));
    if (Array.isArray(orgs) && orgs.length > 1) {
      out.duplicates = orgs.length - 1;
      for (const o of orgs) {
        if (!o || o.id === orgId) continue;
        const rows = await sbRest("project?select=id&org_id=eq." + encodeURIComponent(o.id));
        out.strandedProjects += Array.isArray(rows) ? rows.length : 0;
      }
    }
  } catch (e) { out.error = (e && e.message) || "lookup failed"; }
  return out;
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
  const email = String(user.email || "").toLowerCase();
  const allow = (process.env.ALLOWED_EMAIL_DOMAIN != null ? process.env.ALLOWED_EMAIL_DOMAIN : "smesouthafrica.co.za").toLowerCase();
  // A handful of individually-named personal addresses can also sign in, on top of the domain
  // gate above — not instead of it. Each one lands on a FREEMAIL key (see orgKeyFor) and gets its
  // own private, single-person workspace, invisible to the domain's shared org — the mechanism a
  // private client's work is kept separate from the shared team workspace without a second app.
  const extra = new Set(String(process.env.ALLOWED_EMAIL_EXTRA || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean));
  if (allow && !email.endsWith("@" + allow) && !extra.has(email)) return { error: "NOT_AUTHORIZED" };
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

export { setCors, appKeyOk, rateLimit, clientIp, isAllowedOrigin, blocked, requireSession, getOrgKey, encryptSecret, decryptSecret, sbRest, sbBase, sbWrite, sbPatch, PLANS, meter, recordUsage, getOrgPlan, setOrgPlan, monthUsage, logContent, logEvent, recordMetric, db, writeStats, workspaceInfo };
