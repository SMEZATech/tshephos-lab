// Volt — Facebook Page publishing. © 2026 Tshepho Joel.
//
// RIDES ON THE INSTAGRAM CONNECTION. This is not a second integration: it's the same Meta app,
// the same connected Page, the same stored token — Facebook Page posting only ever needed one more
// scope (pages_manage_posts) requested at connect time, confirmed self-serve at Standard Access
// exactly like instagram_business_content_publish was (not gated like LinkedIn's company-page
// posting turned out to be). So there is no separate "Connect Facebook" button asking for a token
// Volt already has — this reads the identical org_secret row via instagram.js's loadCreds() and
// posts with creds.pageId + creds.token through the same graph() helper.
//
// SIMPLER THAN INSTAGRAM ON PURPOSE. Facebook's Page feed/photos endpoints publish synchronously —
// no media-container-then-poll-then-publish dance, no JPEG-only restriction, no daily quota Meta
// will disclose a number for (their own docs describe an engagement-scaled formula instead, so
// there is nothing honest to show a user as "12/quota used today" the way Instagram's card does).
//   POST /{page-id}/feed     message=...                     -> { id: "pageId_postId" }
//   POST /{page-id}/photos   url=...&caption=...              -> { id, post_id }

import { blocked, sbRest, sbBase, recordMetric } from "../_guard.js";
import { graph, loadCreds } from "./instagram.js";

const MAX_ATTEMPTS = 3;

function svcH() {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
}

// A public https image URL is all Facebook needs — no format restriction like Instagram's
// story-must-be-JPEG rule, so this is a lighter check than instagram.js's checkMedia.
async function checkImage(url) {
  if (!/^https:\/\//i.test(url)) return "The image needs a public https:// address.";
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!head.ok) return "That image URL returned " + head.status + " — Facebook cannot download it.";
    const ct = String(head.headers.get("content-type") || "").toLowerCase();
    if (ct && !/^image\//.test(ct)) return "That URL didn't return an image (" + ct.split(";")[0] + ").";
  } catch (e) { return "Facebook has to download the image from that URL and it could not be reached."; }
  return null;
}

async function publishNow(creds, item) {
  if (!creds.pageId) {
    throw Object.assign(new Error(
      "This connection doesn't have a Facebook Page id yet — reconnect on the Schedule page (Instagram card) to pick it up."
    ), { status: 400 });
  }
  const message = String(item.message || "").slice(0, 63206);   // Facebook's own feed post cap
  const imageUrl = String(item.image_url || "");

  // Page Stories: upload the photo UNPUBLISHED, then hand its id to photo_stories. Two calls, no
  // caption support (Facebook Stories carry no text overlay via this API) — https://developers.
  // facebook.com/docs/page-stories-api/. There's no video_stories equivalent here (it's a chunked
  // upload_phase flow, a materially bigger job) — Story publishing from Volt is photo-only for now.
  if (item.kind === "story") {
    if (!imageUrl) throw Object.assign(new Error("A Facebook Story needs an image."), { status: 400 });
    const bad = await checkImage(imageUrl);
    if (bad) throw Object.assign(new Error(bad), { status: 400 });
    const photo = await graph("/" + creds.pageId + "/photos", { url: imageUrl, published: "false", access_token: creds.token }, "POST");
    const photoId = photo && photo.id;
    if (!photoId) throw new Error("Facebook did not return a photo id for the story.");
    const out = await graph("/" + creds.pageId + "/photo_stories", { photo_id: photoId, access_token: creds.token }, "POST");
    return { postId: (out && (out.post_id || out.id)) || null };
  }

  const isPhoto = item.kind === "photo" && !!imageUrl;
  if (isPhoto) {
    const bad = await checkImage(imageUrl);
    if (bad) throw Object.assign(new Error(bad), { status: 400 });
    const out = await graph("/" + creds.pageId + "/photos", { url: imageUrl, caption: message, access_token: creds.token }, "POST");
    return { postId: (out && (out.post_id || out.id)) || null };
  }
  if (!message) throw Object.assign(new Error("Write something to post first."), { status: 400 });
  const out = await graph("/" + creds.pageId + "/feed", { message, access_token: creds.token }, "POST");
  return { postId: (out && out.id) || null };
}

// ---------------------------------------------------------------------------------------------
// Queue — a near-exact mirror of ig_queue's atomic-claim pattern (see instagram.js for the "why":
// two overlapping drain runs must not both publish the same row).
// ---------------------------------------------------------------------------------------------
// Time-bounded, not row-count-bounded — see the matching comment in instagram.js's queueList().
async function queueList(orgId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  return (await sbRest(
    "fb_queue?select=id,kind,message,image_url,run_at,status,attempts,fb_post_id,error&org_id=eq." +
    encodeURIComponent(orgId) + "&run_at=gte." + encodeURIComponent(since) + "&order=run_at.asc&limit=300"
  )) || [];
}
async function claim(id) {
  const r = await fetch(sbBase() + "/rest/v1/fb_queue?id=eq." + encodeURIComponent(id) + "&status=eq.pending", {
    method: "PATCH",
    headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
    body: JSON.stringify({ status: "publishing", updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows && rows[0] ? rows[0] : null;
}
async function finish(id, patch) {
  await fetch(sbBase() + "/rest/v1/fb_queue?id=eq." + encodeURIComponent(id), {
    method: "PATCH", headers: svcH(),
    body: JSON.stringify(Object.assign({ updated_at: new Date().toISOString() }, patch)),
  });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || (req.body && req.body.action) || "status").toLowerCase();

  // ---- CRON: publish everything due. Same shared secret as Instagram's drain, same reasoning —
  // nobody is signed in when this fires, so it's gated on the secret rather than a session.
  if (action === "drain") {
    const given = String((req.query && req.query.key) || req.headers["x-volt-cron"] || "");
    const want = process.env.CRON_SECRET || "";
    if (!want) return res.status(503).json({ error: "CRON_SECRET is not set — scheduled posting is off." });
    if (given !== want) return res.status(401).json({ error: "Bad cron key" });

    const now = new Date().toISOString();
    const due = (await sbRest(
      "fb_queue?select=id,org_id,kind,message,image_url,run_at,attempts&status=eq.pending&run_at=lte." +
      encodeURIComponent(now) + "&order=run_at.asc&limit=20"
    )) || [];
    const done = [];
    for (const row of due) {
      const mine = await claim(row.id);
      if (!mine) continue;
      try {
        const creds = await loadCreds(row.org_id);
        if (!creds || !creds.token) throw new Error("Facebook is not connected for this workspace.");
        const out = await publishNow(creds, row);
        await finish(row.id, { status: "done", fb_post_id: out.postId, error: null });
        done.push({ id: row.id, ok: true, postId: out.postId });
        try { await recordMetric(row.org_id, { platform: "facebook", external_id: out.postId, posted_text: row.message || "", published_at: new Date().toISOString() }); } catch (e) {}
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await finish(row.id, {
          status: giveUp ? "error" : "pending",
          attempts,
          error: String((e && e.message) || "Publish failed").slice(0, 400),
        });
        done.push({ id: row.id, ok: false, error: (e && e.message) || "failed", attempts, giveUp });
      }
    }
    return res.status(200).json({ ok: true, checked: due.length, results: done });
  }

  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method, id: "facebook", limit: 30, windowSec: 60 })) return;
  const orgId = req.volt && req.volt.orgId;
  if (!orgId) return res.status(401).json({ error: "Please sign in." });

  try {
    const creds = await loadCreds(orgId);

    if (action === "status") {
      if (!creds || !creds.token || !creds.pageId) {
        return res.status(200).json({ connected: false, ready: !!(creds && creds.pageId), queue: orgId ? await queueList(orgId) : [] });
      }
      let page = null, err = null;
      try {
        page = await graph("/" + creds.pageId, { fields: "id,name,picture,fan_count", access_token: creds.token });
      } catch (e) { err = (e && e.message) || "Token check failed"; }
      return res.status(200).json({
        connected: !err, error: err,
        page: page ? { id: page.id, name: page.name, picture: (page.picture && page.picture.data && page.picture.data.url) || "", followers: page.fan_count } : { id: creds.pageId },
        queue: await queueList(orgId),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!creds || !creds.token) return res.status(400).json({ error: "Connect Instagram first (Schedule page) — Facebook Page posting uses that same connection." });
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");

    if (action === "publish") {
      const kind = body.kind === "story" ? "story" : (body.kind === "photo" ? "photo" : "post");
      const out = await publishNow(creds, { kind, message: body.message, image_url: body.imageUrl });
      try { await recordMetric(orgId, { platform: "facebook", external_id: out.postId, posted_text: String(body.message || ""), published_at: new Date().toISOString() }); } catch (e) {}
      // Record it exactly like a drained scheduled post so it shows up in Schedule's history too —
      // "Post now" previously left zero trace here, which is why a published post never appeared.
      try {
        await fetch(sbBase() + "/rest/v1/fb_queue", {
          method: "POST", headers: svcH(),
          body: JSON.stringify({
            org_id: orgId, kind, message: String(body.message || "").slice(0, 63206),
            image_url: kind !== "post" ? String(body.imageUrl || "") : null,
            run_at: new Date().toISOString(), status: "done", fb_post_id: out.postId,
          }),
        });
      } catch (e) { /* history is best-effort — the publish itself already succeeded */ }
      return res.status(200).json({ ok: true, postId: out.postId });
    }

    if (action === "schedule") {
      const at = new Date(body.at || 0);
      if (isNaN(at.getTime())) return res.status(400).json({ error: "That date and time isn’t valid." });
      if (at.getTime() < Date.now() - 60000) return res.status(400).json({ error: "That time is in the past." });
      const kind = body.kind === "story" ? "story" : (body.kind === "photo" ? "photo" : "post");
      if (kind === "story" || kind === "photo") {
        const bad = await checkImage(String(body.imageUrl || ""));
        if (bad) return res.status(400).json({ error: bad });
      } else if (!String(body.message || "").trim()) {
        return res.status(400).json({ error: "Write something to post first." });
      }
      const r = await fetch(sbBase() + "/rest/v1/fb_queue", {
        method: "POST", headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
        body: JSON.stringify({
          org_id: orgId, kind, message: String(body.message || "").slice(0, 63206),
          image_url: kind !== "post" ? String(body.imageUrl || "") : null,
          run_at: at.toISOString(), status: "pending",
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return res.status(502).json({ error: "Could not save to the queue. Has the fb_queue table been created? " + t.slice(0, 160) });
      }
      const rows = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, item: rows && rows[0], cron: !!process.env.CRON_SECRET });
    }

    if (action === "cancel") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(sbBase() + "/rest/v1/fb_queue?id=eq." + encodeURIComponent(id) + "&org_id=eq." + encodeURIComponent(orgId) + "&status=in.(pending,error,publishing)", {
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
    return res.status(status).json({ error: (err && err.message) || "Facebook error" });
  }
}
