// Volt — TikTok publishing (Content Posting API, direct post). © 2026 Tshepho Joel.
//
// WHY THIS LOOKS DIFFERENT FROM instagram.js/facebook.js. Meta hands out a token by pasting one
// into a form — no OAuth dance needed because Meta's Graph API Explorer does the OAuth for you.
// TikTok has no equivalent: Volt itself must be the OAuth client. So this file, uniquely among the
// three, owns a real authorization-code flow (authstart -> TikTok's consent screen -> callback).
//
// THE ONE THING THAT WILL BREAK THIS IF FORGOTTEN: TikTok's refresh_token ROTATES. Every call to
// the refresh endpoint returns a NEW refresh_token that may differ from the one just used — the old
// one may already be dead. Unlike Meta's Page token (stored once, never touched again), every
// refresh here MUST overwrite both stored tokens, or the org silently loses the connection the next
// time a refresh is attempted with a now-stale refresh_token.
// https://developers.tiktok.com/doc/oauth-user-access-token-management
//
// AUDIT GATE. Until TikTok approves this app for the `video.publish` scope in production, every
// post from it is forced SELF_ONLY (private) — there is no parameter that overrides this, and no
// self-account exemption. See SETUP-TIKTOK.md. The code path below is identical before and after
// approval; only what TikTok actually does with it changes.
//
// PULL_FROM_URL, NOT FILE_UPLOAD. TikTok can fetch the video itself from a public URL Volt already
// hosts (same as Instagram's media_url pattern) — one call, no chunked PUT of video bytes through a
// serverless function that would blow past Vercel's execution-time budget. The trade-off is a
// one-time domain verification of whatever host serves Volt's exported videos (TikTok Developer
// portal -> app -> Verified Domains) — unrelated to OAuth, done once, see SETUP-TIKTOK.md.
//
//   GET  /v2/auth/authorize/                         (browser redirect, not a server call)
//   POST /v2/oauth/token/                             code -> {access_token, refresh_token}
//   POST /v2/oauth/token/                             grant_type=refresh_token -> NEW pair
//   GET  /v2/user/info/                               fields=... -> display name, avatar
//   POST /v2/post/publish/creator_info/query/         -> allowed privacy_level values
//   POST /v2/post/publish/video/init/                 source=PULL_FROM_URL -> {publish_id}
//   POST /v2/post/publish/status/fetch/                publish_id -> PROCESSING_DOWNLOAD | ... | PUBLISH_COMPLETE | FAILED

import crypto from "crypto";
import { blocked, sbRest, sbBase, encryptSecret, decryptSecret } from "../_guard.js";

const PROVIDER = "tiktok";
const AUTH_BASE = "https://www.tiktok.com";
const API_BASE = "https://open.tiktokapis.com";
const SCOPES = "user.info.basic,video.publish";
const MAX_ATTEMPTS = 3;

function redirectUri() {
  return process.env.TIKTOK_REDIRECT_URI || "https://tshephos-lab.vercel.app/api/tiktok";
}

// ---------------------------------------------------------------------------------------------
// State signing. The OAuth callback is a plain browser GET redirect from TikTok — it carries none
// of Volt's own session (no Authorization header on a top-level navigation), so the org id has to
// travel inside `state`, tamper-proof and short-lived. HMAC over SECRETS_MASTER_KEY (already the
// key protecting every other org secret) rather than a second key to manage.
// ---------------------------------------------------------------------------------------------
function signState(orgId) {
  const key = process.env.SECRETS_MASTER_KEY || "";
  const payload = JSON.stringify({ orgId, exp: Date.now() + 10 * 60000 });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(b64).digest("base64url");
  return b64 + "." + sig;
}
function verifyState(state) {
  const key = process.env.SECRETS_MASTER_KEY || "";
  const [b64, sig] = String(state || "").split(".");
  if (!b64 || !sig) return null;
  const want = crypto.createHmac("sha256", key).update(b64).digest("base64url");
  // Constant-time compare — this gates who a stored credential gets attributed to.
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (!payload.orgId || !payload.exp || Date.now() > payload.exp) return null;
    return payload.orgId;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------------------------
async function tt(path, body) {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  const err = data && data.error;
  if (!r.ok || (err && err.code && err.code !== "ok")) {
    const msg = (err && (err.message || err.log_id)) || ("TikTok API error (" + r.status + ")");
    throw Object.assign(new Error(msg), { status: r.status, ttCode: err && err.code });
  }
  return data;
}
async function ttAuthed(path, token, body) {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", Authorization: "Bearer " + token },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  const err = data && data.error;
  if (!r.ok || (err && err.code && err.code !== "ok")) {
    const msg = (err && (err.message || err.log_id)) || ("TikTok API error (" + r.status + ")");
    throw Object.assign(new Error(msg), { status: r.status, ttCode: err && err.code });
  }
  return data.data || data;
}

// ---------------------------------------------------------------------------------------------
// Credentials — its own org_secret row (provider "tiktok"). Unlike Facebook riding on Instagram's
// row, this is a genuinely separate account/auth entirely, so it gets a genuinely separate row.
// ---------------------------------------------------------------------------------------------
async function loadCreds(orgId) {
  const rows = await sbRest("org_secret?select=ciphertext&limit=1&org_id=eq." + encodeURIComponent(orgId) + "&provider=eq." + PROVIDER);
  if (!rows || !rows[0] || !rows[0].ciphertext) return null;
  try { return JSON.parse(decryptSecret(rows[0].ciphertext)); } catch (e) { return null; }
}
async function saveCreds(orgId, creds) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const H = { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const body = JSON.stringify({ ciphertext: encryptSecret(JSON.stringify(creds)) });
  const filter = "org_id=eq." + encodeURIComponent(orgId) + "&provider=eq." + PROVIDER;
  const p = await fetch(sbBase() + "/rest/v1/org_secret?" + filter, {
    method: "PATCH", headers: Object.assign({}, H, { Prefer: "return=representation" }), body,
  });
  const patched = p.ok ? await p.json().catch(() => []) : [];
  if (patched && patched.length) return true;
  const i = await fetch(sbBase() + "/rest/v1/org_secret", {
    method: "POST", headers: H,
    body: JSON.stringify({ org_id: orgId, provider: PROVIDER, ciphertext: encryptSecret(JSON.stringify(creds)) }),
  });
  return i.ok;
}
async function clearCreds(orgId) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(sbBase() + "/rest/v1/org_secret?org_id=eq." + encodeURIComponent(orgId) + "&provider=eq." + PROVIDER, {
    method: "DELETE", headers: { apikey: svc, Authorization: "Bearer " + svc },
  });
  return r.ok;
}

// Refresh if the access token is due (or overdue) to expire. ALWAYS re-saves both tokens on a
// successful refresh — see the header comment on why the returned refresh_token cannot be assumed
// to equal the one just used.
async function ensureFreshToken(orgId, creds) {
  if (creds.expiresAt && Date.now() < creds.expiresAt - 5 * 60000) return creds;   // still good for 5+ more minutes
  const d = await tt("/v2/oauth/token/", {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
  });
  const next = Object.assign({}, creds, {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,   // may differ from creds.refreshToken — always take the new one
    expiresAt: Date.now() + (Number(d.expires_in) || 86400) * 1000,
    refreshExpiresAt: Date.now() + (Number(d.refresh_expires_in) || 31536000) * 1000,
  });
  await saveCreds(orgId, next);
  return next;
}

// ---------------------------------------------------------------------------------------------
async function checkVideo(url) {
  if (!/^https:\/\//i.test(url)) return "The video needs a public https:// address.";
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!head.ok) return "That video URL returned " + head.status + " — TikTok cannot download it.";
    const ct = String(head.headers.get("content-type") || "").toLowerCase();
    if (ct && !/^video\//.test(ct)) return "That URL didn't return a video (" + ct.split(";")[0] + ").";
  } catch (e) { return "TikTok has to download the video from that URL and it could not be reached."; }
  return null;
}

// Ask TikTok which privacy levels THIS creator/app pair is currently allowed to post with. Before
// audit approval, SELF_ONLY is the only option that will actually appear — surfacing that directly
// beats a generic "invalid privacy_level" error at publish time.
async function creatorInfo(token) {
  return ttAuthed("/v2/post/publish/creator_info/query/", token, {});
}

async function publishNow(creds, item) {
  const info = await creatorInfo(creds.accessToken);
  const allowed = info.privacy_level_options || [];
  const wantLevel = item.privacyLevel && allowed.includes(item.privacyLevel) ? item.privacyLevel
    : (allowed.includes("SELF_ONLY") ? "SELF_ONLY" : (allowed[0] || "SELF_ONLY"));

  const videoUrl = String(item.video_url || "");
  if (!videoUrl) throw Object.assign(new Error("Nothing to publish — no video."), { status: 400 });
  const bad = await checkVideo(videoUrl);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });

  const out = await ttAuthed("/v2/post/publish/video/init/", creds.accessToken, {
    post_info: {
      title: String(item.caption || "").slice(0, 2200),
      privacy_level: wantLevel,
      disable_duet: false, disable_stitch: false, disable_comment: false,
    },
    source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
  });
  const publishId = out && out.publish_id;
  if (!publishId) throw new Error("TikTok did not return a publish id.");
  return { publishId, privacyLevel: wantLevel, note: wantLevel === "SELF_ONLY" ? "Posted privately — TikTok restricts unaudited apps to private posts until review clears. See Admin → Connections." : null };
}

async function pollOnce(creds, publishId) {
  const out = await ttAuthed("/v2/post/publish/status/fetch/", creds.accessToken, { publish_id: publishId });
  return { status: out && out.status, failReason: out && out.fail_reason };
}

// ---------------------------------------------------------------------------------------------
// Queue — same shape as ig_queue/fb_queue (time-bounded list, atomic claim) so Schedule's
// buildUnifiedItems() can merge it in identically. Publishing itself only needs to get as far as
// TikTok ACCEPTING the video (publish_id issued) to count as "done" here — full processing on
// TikTok's side can outlast a single drain run, and status is checkable separately.
// ---------------------------------------------------------------------------------------------
function svcH() {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
}
async function queueList(orgId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  return (await sbRest(
    "tiktok_queue?select=id,video_url,caption,run_at,status,attempts,tt_publish_id,error&org_id=eq." +
    encodeURIComponent(orgId) + "&run_at=gte." + encodeURIComponent(since) + "&order=run_at.asc&limit=300"
  )) || [];
}
async function claim(id) {
  const r = await fetch(sbBase() + "/rest/v1/tiktok_queue?id=eq." + encodeURIComponent(id) + "&status=eq.pending", {
    method: "PATCH",
    headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
    body: JSON.stringify({ status: "publishing", updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows && rows[0] ? rows[0] : null;
}
async function finish(id, patch) {
  await fetch(sbBase() + "/rest/v1/tiktok_queue?id=eq." + encodeURIComponent(id), {
    method: "PATCH", headers: svcH(),
    body: JSON.stringify(Object.assign({ updated_at: new Date().toISOString() }, patch)),
  });
}

// ---------------------------------------------------------------------------------------------
export default async function handler(req, res) {
  const q = req.query || {};
  const action = String(q.action || (req.body && req.body.action) || "status").toLowerCase();

  // ---- OAuth callback. A plain browser GET redirect from TikTok — no Volt session, org id lives
  // in `state` (see signState/verifyState above). Never JSON here: this is a page navigation.
  if (req.method === "GET" && q.code) {
    const orgId = verifyState(q.state);
    if (!orgId) { res.writeHead(302, { Location: "/admin.html?tiktok=error&msg=" + encodeURIComponent("That connection link expired — try Connect again.") }); return res.end(); }
    try {
      const d = await tt("/v2/oauth/token/", {
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code: String(q.code), grant_type: "authorization_code", redirect_uri: redirectUri(),
      });
      const creds = {
        accessToken: d.access_token, refreshToken: d.refresh_token,
        expiresAt: Date.now() + (Number(d.expires_in) || 86400) * 1000,
        refreshExpiresAt: Date.now() + (Number(d.refresh_expires_in) || 31536000) * 1000,
        openId: d.open_id || "",
      };
      let username = "";
      try {
        const info = await ttAuthed("/v2/user/info/?fields=display_name,avatar_url", creds.accessToken, {});
        username = (info && info.user && info.user.display_name) || "";
      } catch (e) { /* posting still works without the display name */ }
      creds.username = username;
      const ok = await saveCreds(orgId, creds);
      if (!ok) { res.writeHead(302, { Location: "/admin.html?tiktok=error&msg=" + encodeURIComponent("Could not save the connection.") }); return res.end(); }
      res.writeHead(302, { Location: "/admin.html?tiktok=connected" }); return res.end();
    } catch (e) {
      res.writeHead(302, { Location: "/admin.html?tiktok=error&msg=" + encodeURIComponent((e && e.message) || "TikTok sign-in failed.") });
      return res.end();
    }
  }

  // ---- CRON: publish everything due. Same shared secret and atomic-claim pattern as Instagram/
  // Facebook's drain — nobody is signed in when this fires.
  if (action === "drain") {
    const given = String(q.key || req.headers["x-volt-cron"] || "");
    const want = process.env.CRON_SECRET || "";
    if (!want) return res.status(503).json({ error: "CRON_SECRET is not set — scheduled posting is off." });
    if (given !== want) return res.status(401).json({ error: "Bad cron key" });

    const now = new Date().toISOString();
    const due = (await sbRest(
      "tiktok_queue?select=id,org_id,video_url,caption,run_at,attempts&status=eq.pending&run_at=lte." +
      encodeURIComponent(now) + "&order=run_at.asc&limit=20"
    )) || [];
    const done = [];
    for (const row of due) {
      const mine = await claim(row.id);
      if (!mine) continue;
      try {
        let creds = await loadCreds(row.org_id);
        if (!creds || !creds.accessToken) throw new Error("TikTok is not connected for this workspace.");
        creds = await ensureFreshToken(row.org_id, creds);
        const out = await publishNow(creds, { video_url: row.video_url, caption: row.caption });
        await finish(row.id, { status: "done", tt_publish_id: out.publishId, error: null });
        done.push({ id: row.id, ok: true, publishId: out.publishId });
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await finish(row.id, { status: giveUp ? "error" : "pending", attempts, error: String((e && e.message) || "Publish failed").slice(0, 400) });
        done.push({ id: row.id, ok: false, error: (e && e.message) || "failed", attempts, giveUp });
      }
    }
    return res.status(200).json({ ok: true, checked: due.length, results: done });
  }

  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method, id: "tiktok", limit: 30, windowSec: 60 })) return;
  const orgId = req.volt && req.volt.orgId;
  if (!orgId) return res.status(401).json({ error: "Please sign in." });

  try {
    // ---- Start the OAuth dance. Returns a URL for the client to navigate to — this can't just be
    // a redirect from here, because the browser needs to actually land on TikTok's own domain.
    if (action === "authstart") {
      if (!process.env.TIKTOK_CLIENT_KEY) return res.status(503).json({ error: "TikTok isn't configured yet — TIKTOK_CLIENT_KEY is missing." });
      const state = signState(orgId);
      const url = AUTH_BASE + "/v2/auth/authorize/?" + new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY, scope: SCOPES, response_type: "code",
        redirect_uri: redirectUri(), state,
      }).toString();
      return res.status(200).json({ url });
    }

    if (action === "status") {
      let creds = await loadCreds(orgId);
      if (!creds || !creds.accessToken) return res.status(200).json({ connected: false, queue: await queueList(orgId) });
      let account = null, err = null, privacyOptions = [];
      try {
        creds = await ensureFreshToken(orgId, creds);
        const info = await ttAuthed("/v2/user/info/?fields=display_name,avatar_url", creds.accessToken, {});
        account = { username: (info.user && info.user.display_name) || creds.username || "", picture: (info.user && info.user.avatar_url) || "" };
        const ci = await creatorInfo(creds.accessToken);
        privacyOptions = ci.privacy_level_options || [];
      } catch (e) { err = (e && e.message) || "Token check failed"; }
      return res.status(200).json({
        connected: !err, error: err,
        account: account || { username: creds.username || "" },
        auditApproved: !privacyOptions.length ? null : !(privacyOptions.length === 1 && privacyOptions[0] === "SELF_ONLY"),
        privacyOptions,
        queue: await queueList(orgId),
      });
    }

    if (action === "disconnect") { await clearCreds(orgId); return res.status(200).json({ ok: true }); }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");

    let creds = await loadCreds(orgId);
    if (!creds || !creds.accessToken) return res.status(400).json({ error: "TikTok isn't connected yet — connect it on Admin → Connections first." });
    creds = await ensureFreshToken(orgId, creds);

    if (action === "publish") {
      const out = await publishNow(creds, { video_url: body.videoUrl, caption: body.caption, privacyLevel: body.privacyLevel });
      try {
        await fetch(sbBase() + "/rest/v1/tiktok_queue", {
          method: "POST", headers: svcH(),
          body: JSON.stringify({ org_id: orgId, video_url: String(body.videoUrl || ""), caption: String(body.caption || "").slice(0, 2200), run_at: new Date().toISOString(), status: "done", tt_publish_id: out.publishId }),
        });
      } catch (e) { /* history is best-effort — the publish itself already succeeded */ }
      return res.status(200).json({ ok: true, publishId: out.publishId, privacyLevel: out.privacyLevel, note: out.note });
    }

    if (action === "schedule") {
      const at = new Date(body.at || 0);
      if (isNaN(at.getTime())) return res.status(400).json({ error: "That date and time isn't valid." });
      if (at.getTime() < Date.now() - 60000) return res.status(400).json({ error: "That time is in the past." });
      const bad = await checkVideo(String(body.videoUrl || ""));
      if (bad) return res.status(400).json({ error: bad });
      const r = await fetch(sbBase() + "/rest/v1/tiktok_queue", {
        method: "POST", headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
        body: JSON.stringify({ org_id: orgId, video_url: String(body.videoUrl || ""), caption: String(body.caption || "").slice(0, 2200), run_at: at.toISOString(), status: "pending" }),
      });
      if (!r.ok) { const t = await r.text().catch(() => ""); return res.status(502).json({ error: "Could not save to the queue. Has the tiktok_queue table been created? " + t.slice(0, 160) }); }
      const rows = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, item: rows && rows[0], cron: !!process.env.CRON_SECRET });
    }

    if (action === "pollstatus") {
      const id = String(body.publishId || "");
      if (!id) return res.status(400).json({ error: "Missing publishId" });
      const out = await pollOnce(creds, id);
      return res.status(200).json({ ok: true, status: out.status, failReason: out.failReason });
    }

    if (action === "cancel") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(sbBase() + "/rest/v1/tiktok_queue?id=eq." + encodeURIComponent(id) + "&org_id=eq." + encodeURIComponent(orgId) + "&status=in.(pending,error,publishing)", {
        method: "PATCH", headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
        body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }),
      });
      const rows = r.ok ? await r.json().catch(() => []) : [];
      if (!rows || !rows.length) return res.status(404).json({ error: "That item is no longer cancellable." });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action", action });
  } catch (err) {
    const status = err && err.status === 400 ? 400 : (err && (err.status === 401 || err.status === 403) ? 401 : 502);
    return res.status(status).json({ error: (err && err.message) || "TikTok error", ttCode: (err && err.ttCode) || null });
  }
}
