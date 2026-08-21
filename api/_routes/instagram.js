// Volt — Instagram publishing (stories, feed posts, reels). © 2026 Tshepho Joel.
//
// WHY DIRECT, NOT THROUGH POSTIZ. The Schedule page was built entirely on Postiz: it had a
// "✨ Story" button that sent settings.post_type="story" to a third-party scheduler and hoped.
// Two problems with that as the story path. Postiz's hosted API is a paid plan (Volt is free-tier
// only), and self-hosting it means running and babysitting another service. More importantly it
// puts a black box between Volt and the one API call that actually matters — when a story fails
// to publish you get Postiz's opinion of why, not Instagram's.
//
// Instagram's own Content Publishing API does stories natively, costs nothing, and is the thing
// Postiz would have been calling anyway. So Volt calls it.
//
//   POST /{ig-id}/media          media_type=STORIES & image_url=...   -> { id: creationId }
//   GET  /{creationId}           fields=status_code                   -> IN_PROGRESS | FINISHED | ERROR
//   POST /{ig-id}/media_publish  creation_id=...                      -> { id: mediaId }
//
// THREE CONSTRAINTS THAT DECIDE THE DESIGN:
//
//  1. The image must be at a PUBLIC URL. Instagram fetches it server-side; you cannot upload bytes.
//     Volt already hosts images publicly (api/_routes/upload.js -> Supabase public bucket), so the
//     Studio -> Schedule path already produces exactly the kind of URL this needs.
//
//  2. Stories are JPEG ONLY. Studio exports PNG. A PNG URL is accepted by /media and then fails
//     at publish with a message that does not mention the format, so this checks the real
//     Content-Type up front and says so plainly. The client converts to JPEG before uploading.
//
//  3. 100 API-published posts per rolling 24 hours, stories included. Worth reading BEFORE
//     publishing (/content_publishing_limit) so a hit quota is a clear message and not a failure.
//
// SCHEDULING. Vercel's Hobby tier allows one cron run per DAY, which cannot honour "post at 17:00".
// So the queue lives in Supabase and a GitHub Actions workflow (free, 5-minute granularity) pokes
// ?action=drain. See .github/workflows/ig-drain.yml. Nothing is published from the browser, so a
// scheduled story goes out whether or not anyone has Volt open.

import { blocked, sbRest, sbBase, encryptSecret, decryptSecret, recordMetric } from "../_guard.js";

const V = process.env.IG_API_VERSION || "v23.0";
const G = "https://graph.facebook.com/" + V;
const PROVIDER = "instagram";
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------------------------
async function graph(path, params, method) {
  const qs = new URLSearchParams(params || {}).toString();
  const url = G + path + (method === "POST" ? "" : (qs ? "?" + qs : ""));
  const init = method === "POST"
    ? { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs }
    : {};
  const r = await fetch(url, init);
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!r.ok) {
    const e = (data && data.error) || {};
    // Meta's messages are usually the useful part; its codes are what you search for.
    const msg = e.error_user_msg || e.message || ("Instagram API error (" + r.status + ")");
    throw Object.assign(new Error(msg), { status: r.status, igCode: e.code, igSub: e.error_subcode, igType: e.type });
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Per-org credentials. Stored in org_secret, encrypted with SECRETS_MASTER_KEY (same envelope as
// every other org secret) — a long-lived Instagram token is exactly as sensitive as an API key.
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
  // PATCH first, INSERT if it matched nothing. Deliberately not an upsert: that needs a unique
  // constraint on (org_id, provider) which this table may not have, and a silent 409 here would
  // look exactly like a working save.
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

// ---------------------------------------------------------------------------------------------
// Connect: turn whatever token the user pasted into a usable {igUserId, token, username}.
// Accepts a Page token or a User token and finds the Instagram account itself, because "which of
// these four tokens do I paste" is the single most common way this setup goes wrong.
// ---------------------------------------------------------------------------------------------
async function resolveAccount(token, explicitIgId, explicitPageId) {
  // THE ROBUST OVERRIDE. Proven twice on a real account: /me/accounts AND the /me/businesses walk
  // can both come back empty for a Page the token can nonetheless query directly by id without any
  // trouble at all — the access was granted in a shape neither enumeration endpoint surfaces. Once
  // you know the Page id works (Explorer will tell you), asking Volt to enumerate anything is
  // strictly worse than just handing it the id. This is also the ONLY path that reliably returns
  // the Page's own access_token — `?fields=access_token` on a Page node the user token can act on
  // returns it directly, sidestepping discovery instead of hoping some other endpoint surfaces it.
  if (explicitPageId) {
    const page = await graph("/" + encodeURIComponent(explicitPageId), {
      fields: "id,name,access_token,instagram_business_account{id,username}", access_token: token,
    });
    if (!page || !page.instagram_business_account || !page.instagram_business_account.id) {
      throw Object.assign(new Error(
        "That Page doesn't have an Instagram Business account linked (or this token can't see it). Check Page Settings → Linked accounts → Instagram."
      ), { status: 400 });
    }
    return {
      igUserId: String(page.instagram_business_account.id),
      username: page.instagram_business_account.username || "",
      page: page.name || "", pageId: String(page.id),
      pageToken: page.access_token || "",   // may be absent if this token itself lacks admin rights on the Page
      via: "explicit-page",
    };
  }
  if (explicitIgId) {
    // NOTE: this path cannot discover a Page id or a Page token — Instagram's own node has no
    // reverse link back to the Facebook Page that owns it. It stores exactly the token you pasted,
    // which is fine for Instagram alone but means Facebook Page posting stays unavailable until a
    // Page id is supplied too (via explicitPageId, above — the one to reach for if you want both).
    const me = await graph("/" + encodeURIComponent(explicitIgId), { fields: "id,username,name", access_token: token });
    return { igUserId: String(me.id), username: me.username || me.name || "", via: "explicit" };
  }
  // A Page token: /me is the Page ITSELF (its own numeric id — this is also the Facebook Page id
  // Facebook Page posting needs), and it carries instagram_business_account for the linked account.
  try {
    const me = await graph("/me", { fields: "id,name,instagram_business_account{id,username}", access_token: token });
    if (me && me.instagram_business_account && me.instagram_business_account.id) {
      return { igUserId: String(me.instagram_business_account.id), username: me.instagram_business_account.username || "", page: me.name || "", pageId: String(me.id), via: "page-token" };
    }
  } catch (e) { /* fall through to the account list */ }
  // A User token: walk the Pages and take the first with an Instagram account attached.
  const list = await graph("/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", access_token: token });
  let pages = (list && list.data) || [];
  let hit = pages.find((p) => p && p.instagram_business_account && p.instagram_business_account.id);

  // /me/accounts ONLY lists Pages the personal profile administers DIRECTLY. A Page owned by a
  // BUSINESS PORTFOLIO — which is how Meta sets up most Pages now, and which the app-creation
  // wizard itself pushes you toward by requiring a Business Portfolio to attach the app to — does
  // not show up there at all, even with a correctly-scoped, fully-permissioned token. Confirmed
  // directly: /me/accounts returned an empty array for a token whose OWN consent screen said
  // "1 Page selected," while querying that Page's id directly returned its instagram_business_account
  // with no trouble. So: walk the Business Portfolios the token can see and check the Pages owned
  // (or shared as a client) inside each one.
  if (!hit) {
    try {
      const biz = await graph("/me/businesses", { fields: "id,name", limit: "25", access_token: token });
      for (const b of (biz && biz.data) || []) {
        for (const edge of ["owned_pages", "client_pages"]) {
          try {
            const bp = await graph("/" + b.id + "/" + edge, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", access_token: token });
            const found = ((bp && bp.data) || []).find((p) => p && p.instagram_business_account && p.instagram_business_account.id);
            if (found) { hit = found; pages = pages.concat((bp && bp.data) || []); break; }
          } catch (e) { /* this business may not expose this edge to this token — try the next */ }
        }
        if (hit) break;
      }
    } catch (e) { /* /me/businesses itself can fail for a token with no business at all — fine, fall through */ }
  }

  if (!hit) {
    throw Object.assign(new Error(
      "That token works, but no Instagram Business account is attached to any Page it can see — including inside your Business Portfolios. In Meta Business Suite, link your Instagram account to your Facebook Page, and make sure it is a Business or Creator account (not Personal)."
    ), { status: 400 });
  }
  return {
    igUserId: String(hit.instagram_business_account.id),
    username: hit.instagram_business_account.username || "",
    page: hit.name || "",
    pageId: String(hit.id),
    // The PAGE token is the one to keep: Page tokens derived from a long-lived user token do not
    // expire, whereas the user token itself does. Storing the user token is why these integrations
    // mysteriously stop working after 60 days.
    pageToken: hit.access_token || "",
    via: "user-token",
  };
}

// How long has this token got? Surfaced in the UI so an expiry is something you SEE coming.
async function tokenInfo(token) {
  try {
    const app = process.env.FB_APP_ID, sec = process.env.FB_APP_SECRET;
    if (!app || !sec) return { expiresAt: null, note: "Set FB_APP_ID + FB_APP_SECRET to monitor token expiry." };
    const d = await graph("/debug_token", { input_token: token, access_token: app + "|" + sec });
    const x = (d && d.data) || {};
    return {
      expiresAt: x.expires_at ? new Date(x.expires_at * 1000).toISOString() : null,  // 0 = never
      neverExpires: x.expires_at === 0,
      scopes: x.scopes || [],
      valid: !!x.is_valid,
    };
  } catch (e) { return { expiresAt: null, note: (e && e.message) || "Could not read token info." }; }
}

// ---------------------------------------------------------------------------------------------
// The media URL has to be something Instagram itself can fetch. Checking it here converts three
// different opaque Meta failures ("Media upload has failed", code 9004) into one plain sentence.
// ---------------------------------------------------------------------------------------------
async function checkMedia(url, kind) {
  if (!/^https:\/\//i.test(url)) {
    return "The image needs a public https:// address. Upload it in Schedule (or send it from Studio) and Volt will host it.";
  }
  let head;
  try {
    head = await fetch(url, { method: "HEAD", redirect: "follow" });
  } catch (e) {
    return "Instagram has to download the image from that URL and it could not be reached.";
  }
  if (!head.ok) return "That image URL returned " + head.status + " — Instagram cannot download it.";
  const ct = String(head.headers.get("content-type") || "").toLowerCase();
  if (kind === "reel") {
    if (ct && !/^video\//.test(ct)) return "A reel needs a video URL (got " + ct + ").";
    return null;
  }
  // Stories are JPEG-only. This is the constraint that silently breaks PNG exports.
  if (/png/.test(ct)) {
    return "Instagram only accepts JPEG for stories, and that image is a PNG. Re-send it from Studio — Volt converts story images to JPEG automatically.";
  }
  if (ct && !/jpe?g/.test(ct)) return "Instagram needs a JPEG image for this (got " + ct + ").";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Publish. Container -> wait -> publish. Images are usually FINISHED immediately; reels are not,
// so the wait is real and bounded rather than optimistic.
// ---------------------------------------------------------------------------------------------
async function publishNow(creds, item) {
  const { igUserId, token } = creds;
  const kind = item.kind === "post" ? "post" : (item.kind === "reel" ? "reel" : "story");
  const mediaUrl = String(item.image_url || item.video_url || "");
  if (!mediaUrl) throw Object.assign(new Error("Nothing to publish — no image."), { status: 400 });

  const bad = await checkMedia(mediaUrl, kind);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });

  const params = { access_token: token };
  if (kind === "story") { params.media_type = "STORIES"; params.image_url = mediaUrl; }
  else if (kind === "reel") { params.media_type = "REELS"; params.video_url = mediaUrl; if (item.caption) params.caption = item.caption; }
  else { params.image_url = mediaUrl; if (item.caption) params.caption = item.caption; }

  const container = await graph("/" + igUserId + "/media", params, "POST");
  const creationId = container && container.id;
  if (!creationId) throw new Error("Instagram did not return a media container id.");

  // Wait for the container. A story image is normally ready at once; giving up after ~40s is
  // better than a serverless function timing out with the post in an unknown state.
  const deadline = Date.now() + 40000;
  for (;;) {
    const st = await graph("/" + creationId, { fields: "status_code,status", access_token: token });
    const code = String((st && st.status_code) || "").toUpperCase();
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error("Instagram rejected the media" + (st && st.status ? ": " + st.status : "") + ".");
    }
    if (Date.now() > deadline) throw new Error("Instagram is still processing the media — it was not published. Try again in a minute.");
    await new Promise((r) => setTimeout(r, 2500));
  }

  const out = await graph("/" + igUserId + "/media_publish", { creation_id: creationId, access_token: token }, "POST");
  return { mediaId: (out && out.id) || null, kind };
}

async function quota(creds) {
  try {
    const d = await graph("/" + creds.igUserId + "/content_publishing_limit", { fields: "config,quota_usage", access_token: creds.token });
    const row = (d && d.data && d.data[0]) || {};
    return { used: row.quota_usage != null ? row.quota_usage : null, limit: (row.config && row.config.quota_total) || 100 };
  } catch (e) { return { used: null, limit: 100 }; }
}

// ---------------------------------------------------------------------------------------------
// Reporting. Two tiers, on purpose: likes/comments/media metadata come off the plain Media
// endpoint and need only `instagram_basic` — the scope every connection already has — so ranked
// top posts work from the day you connect. Reach/saves/profile-views need `instagram_manage_insights`,
// a scope not requested during the original connect (publishing and reading insights are separate
// grants in Meta's model). Rather than make the whole report depend on a scope most connections
// won't have yet, each insights call is attempted and quietly omitted on failure — the report shows
// whatever it can, then documents what unlocks with the wider connection.
// ---------------------------------------------------------------------------------------------

// Same shape as api/postiz.js's `analytics` action (`{days, metrics:[{label,latest,first,
// percentageChange,points}]}`), on purpose: analytics.html's whole dashboard (KPI cards, deltas,
// sparkline points) already knows how to render exactly that shape for a Postiz channel. Returning
// it unchanged means the direct Instagram connection becomes just ANOTHER channel to that page
// instead of a second reporting UI to build and keep in sync.
async function accountAnalytics(creds, days) {
  const metrics = [];
  // follower_count is its own metric family (needs metric_type=time_series explicitly on current
  // API versions); reach/profile_views vary by version on whether metric_type is required at all,
  // so each is tried bare first and, only on a 400, retried with metric_type=time_series. Two tries,
  // not a guess baked into the URL — the same "verify, don't assume the shape" discipline as
  // everywhere else this file touches a Graph endpoint whose exact contract isn't in front of us.
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  async function tryMetric(name, extra) {
    const base = { metric: name, period: "day", since: String(since), until: String(until), access_token: creds.token };
    try { return await graph("/" + creds.igUserId + "/insights", Object.assign({}, base, extra), "GET"); }
    catch (e) {
      if (extra && extra.metric_type) throw e;   // already tried the fallback; let it fail upward
      return graph("/" + creds.igUserId + "/insights", Object.assign({}, base, { metric_type: "time_series" }), "GET");
    }
  }
  for (const name of ["reach", "profile_views"]) {
    try {
      const d = await tryMetric(name);
      const row = (d && d.data && d.data[0]) || {};
      const points = (row.values || []).map((v) => ({ date: v.end_time, total: Number(v.value) })).filter((p) => Number.isFinite(p.total));
      if (!points.length) continue;
      const latest = points[points.length - 1].total, first = points[0].total;
      metrics.push({
        label: name === "reach" ? "Reach" : "Profile views",
        latest, first,
        percentageChange: first ? ((latest - first) / first) * 100 : null,
        points,
      });
    } catch (e) { /* this account may not have instagram_manage_insights yet — omit, don't fail the report */ }
  }
  // Follower count and media count come straight off the account object — always available.
  try {
    const acc = await graph("/" + creds.igUserId, { fields: "followers_count,media_count", access_token: creds.token });
    if (acc.followers_count != null) metrics.push({ label: "Followers", latest: acc.followers_count, first: null, percentageChange: null, points: [] });
    if (acc.media_count != null) metrics.push({ label: "Total posts", latest: acc.media_count, first: null, percentageChange: null, points: [] });
  } catch (e) { /* account read itself failing means the token is bad — status action already surfaces that */ }
  return { days, metrics, insightsAvailable: metrics.some((m) => m.label === "Reach" || m.label === "Profile views") };
}

// Same shape as api/postiz.js's `topposts` action (`{days, topPosts:[{id,content,publishDate,url,
// metrics,engagement}]}`) for the identical reason — analytics.html's top-posts card, best-time-to-
// post chart and playbook AI call all already consume that shape unmodified.
async function topPosts(creds, orgId, days, limit) {
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  const list = await graph("/" + creds.igUserId + "/media", {
    fields: "id,caption,timestamp,permalink,like_count,comments_count,media_product_type",
    limit: "50", access_token: creds.token,
  });
  let posts = ((list && list.data) || []).filter((p) => p && p.timestamp && new Date(p.timestamp).getTime() / 1000 >= since);

  // Base engagement from fields every connection already has (instagram_basic). Reach/saves layer
  // on top, best-effort, per post — one post's insights failing must not blank the other nine.
  posts = await Promise.all(posts.map(async (p) => {
    let reach = null, saved = null;
    try {
      const ins = await graph("/" + p.id + "/insights", { metric: "reach,saved", access_token: creds.token });
      for (const row of (ins && ins.data) || []) {
        const v = row.values && row.values[0] && row.values[0].value;
        if (row.name === "reach") reach = v; else if (row.name === "saved") saved = v;
      }
    } catch (e) { /* pre-instagram_manage_insights connection, or a media type Meta doesn't support insights for */ }
    const likes = p.like_count || 0, comments = p.comments_count || 0;
    const engagement = likes + comments + (saved || 0);
    const metrics = [{ label: "Likes", value: likes }, { label: "Comments", value: comments }];
    if (reach != null) metrics.push({ label: "Reach", value: reach });
    if (saved != null) metrics.push({ label: "Saved", value: saved });
    return {
      id: p.id,
      content: String(p.caption || "").slice(0, 200),
      publishDate: p.timestamp || "",
      url: p.permalink || "",
      metrics, engagement,
    };
  }));

  posts.sort((a, b) => b.engagement - a.engagement);
  posts = posts.slice(0, limit);

  // Volt Brain: the SAME table postiz.js's topposts writes into, so real Instagram outcomes
  // strengthen Studio's Strategy Proxy regardless of which of the two publishing paths posted them.
  try {
    const orgId = creds.orgId;
    if (orgId) {
      await Promise.all(posts.map((p) => recordMetric(orgId, {
        platform: "instagram", external_id: p.id, posted_text: p.content, published_at: p.publishDate || null,
        likes: (p.metrics.find((m) => m.label === "Likes") || {}).value || 0,
        comments: (p.metrics.find((m) => m.label === "Comments") || {}).value || 0,
        shares: 0, impressions: (p.metrics.find((m) => m.label === "Reach") || {}).value || 0,
        engagement: p.engagement,
      })));
    }
  } catch (e) { /* best-effort — never break the report */ }

  return { days, topPosts: posts };
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------
function svcH() {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
}
// A TIME window, not a row-count cap. Schedule now shows published history alongside what's
// upcoming (see buildUnifiedItems() in schedule.html) — a plain "most recent 60 rows, oldest
// first" would let old published posts silently crowd out something scheduled further ahead once
// total volume passed 60. Bounding by date means both sides of "now" are always represented.
async function queueList(orgId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  return (await sbRest(
    "ig_queue?select=id,kind,image_url,caption,run_at,status,attempts,ig_media_id,error&org_id=eq." +
    encodeURIComponent(orgId) + "&run_at=gte." + encodeURIComponent(since) + "&order=run_at.asc&limit=300"
  )) || [];
}
// ATOMIC CLAIM. The drain runs every 5 minutes and a publish can take longer than one run, so a
// row must be taken off the queue before it is published, not after. PATCH ... status=eq.pending
// only matches for whoever gets there first; if the representation comes back empty, someone else
// already claimed it. This is the whole double-post guard.
async function claim(id) {
  const r = await fetch(sbBase() + "/rest/v1/ig_queue?id=eq." + encodeURIComponent(id) + "&status=eq.pending", {
    method: "PATCH",
    headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
    body: JSON.stringify({ status: "publishing", updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows && rows[0] ? rows[0] : null;
}
async function finish(id, patch) {
  await fetch(sbBase() + "/rest/v1/ig_queue?id=eq." + encodeURIComponent(id), {
    method: "PATCH", headers: svcH(),
    body: JSON.stringify(Object.assign({ updated_at: new Date().toISOString() }, patch)),
  });
}

// ---------------------------------------------------------------------------------------------
export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || (req.body && req.body.action) || "status").toLowerCase();

  // ---- CRON: publish everything due. No user session (nobody is logged in at 06:00), so it is
  // gated on a shared secret instead. Deliberately the only action that skips requireSession.
  if (action === "drain") {
    const given = String((req.query && req.query.key) || req.headers["x-volt-cron"] || "");
    const want = process.env.CRON_SECRET || "";
    if (!want) return res.status(503).json({ error: "CRON_SECRET is not set — scheduled posting is off." });
    if (given !== want) return res.status(401).json({ error: "Bad cron key" });

    const now = new Date().toISOString();
    const due = (await sbRest(
      "ig_queue?select=id,org_id,kind,image_url,caption,run_at,attempts&status=eq.pending&run_at=lte." +
      encodeURIComponent(now) + "&order=run_at.asc&limit=20"
    )) || [];
    const done = [];
    for (const row of due) {
      const mine = await claim(row.id);
      if (!mine) continue;                                  // another run got it
      try {
        const creds = await loadCreds(row.org_id);
        if (!creds || !creds.token) throw new Error("Instagram is not connected for this workspace.");
        const out = await publishNow(creds, row);
        await finish(row.id, { status: "done", ig_media_id: out.mediaId, error: null });
        done.push({ id: row.id, ok: true, mediaId: out.mediaId });
        try { await recordMetric(row.org_id, { platform: "instagram", external_id: out.mediaId, posted_text: row.caption || "", published_at: new Date().toISOString() }); } catch (e) {}
      } catch (e) {
        const attempts = (row.attempts || 0) + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        // Back to pending so the next run retries — unless it has failed enough times that
        // retrying is just noise. A permanently stuck row is worse than a visible failure.
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

  // blocked() does CORS, rate limiting AND the Supabase session, and hands back req.volt.orgId —
  // so every action below this line is already authenticated and org-scoped.
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method, id: "instagram", limit: 30, windowSec: 60 })) return;
  const orgId = req.volt && req.volt.orgId;
  if (!orgId) return res.status(401).json({ error: "Please sign in." });

  try {
    // ---- Is this workspace connected, and to what?
    if (action === "status") {
      const creds = await loadCreds(orgId);
      if (!creds || !creds.token) {
        return res.status(200).json({
          connected: false,
          apiVersion: V,
          cron: !!process.env.CRON_SECRET,
          queue: await queueList(orgId),
        });
      }
      let account = null, err = null;
      try {
        account = await graph("/" + creds.igUserId, { fields: "id,username,name,profile_picture_url,followers_count", access_token: creds.token });
      } catch (e) { err = (e && e.message) || "Token check failed"; }
      const ti = await tokenInfo(creds.token);
      return res.status(200).json({
        connected: !err,
        error: err,
        apiVersion: V,
        cron: !!process.env.CRON_SECRET,
        account: account ? { id: account.id, username: account.username, name: account.name, picture: account.profile_picture_url, followers: account.followers_count } : { id: creds.igUserId, username: creds.username || "" },
        token: ti,
        quota: err ? null : await quota(creds),
        queue: await queueList(orgId),
        // The same connection also carries the Facebook Page — see facebook.js. `ready` needs BOTH
        // the Page id (only present since the pageId field was added; an older connection needs a
        // reconnect to pick it up) AND the pages_manage_posts scope, which has to be requested up
        // front — Meta doesn't allow silently upgrading an existing token's scopes.
        facebook: { pageId: creds.pageId || null, ready: !!(creds.pageId && (ti.scopes || []).includes("pages_manage_posts")) },
      });
    }

    // ---- Reporting. Same response shapes as api/postiz.js's analytics/topposts (see the two
    // functions above for why) — this is what lets analytics.html treat the direct connection as
    // just another channel rather than needing a second dashboard built for it.
    if (action === "analytics" || action === "topposts") {
      const creds = await loadCreds(orgId);
      if (!creds || !creds.token) return res.status(400).json({ error: "Instagram isn't connected yet." });
      const days = Math.max(1, Math.min(90, parseInt((req.query && req.query.days) || "30", 10) || 30));
      if (action === "analytics") return res.status(200).json(await accountAnalytics(creds, days));
      const limit = Math.max(1, Math.min(20, parseInt((req.query && req.query.limit) || "6", 10) || 6));
      return res.status(200).json(await topPosts(creds, orgId, days, limit));
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");

    // ---- Connect / re-connect
    if (action === "connect") {
      const token = String(body.token || "").trim();
      if (!token) return res.status(400).json({ error: "Paste your access token." });
      const acct = await resolveAccount(token, String(body.igUserId || "").trim() || null, String(body.pageId || "").trim() || null);
      // Prefer the Page token when we found one — see resolveAccount: it is the one that lasts.
      const keep = acct.pageToken || token;
      // Prove it can actually see the account with the token we are about to store, so "Connected"
      // never means "we stored something and hoped".
      const me = await graph("/" + acct.igUserId, { fields: "id,username", access_token: keep });
      // pageId rides along on the SAME connection — it's what api/_routes/facebook.js needs to post
      // to the Page's own feed/photos, using this exact token (Facebook Page posting is "the same
      // Page token, one more scope", not a separate auth flow — see facebook.js's header comment).
      const ok = await saveCreds(orgId, { igUserId: acct.igUserId, token: keep, username: me.username || acct.username || "", pageId: acct.pageId || null });
      if (!ok) return res.status(502).json({ error: "Could not save the connection. Is SECRETS_MASTER_KEY set in Vercel?" });
      return res.status(200).json({ ok: true, account: { id: me.id, username: me.username || "" }, via: acct.via, page: acct.page || null, token: await tokenInfo(keep) });
    }

    if (action === "disconnect") {
      await clearCreds(orgId);
      return res.status(200).json({ ok: true });
    }

    const creds = await loadCreds(orgId);
    if (!creds || !creds.token) return res.status(400).json({ error: "Instagram isn’t connected yet — connect it on the Schedule page first." });

    // ---- Publish right now
    if (action === "publish") {
      const q = await quota(creds);
      if (q.used != null && q.limit && q.used >= q.limit) {
        return res.status(429).json({ error: "Instagram's 24-hour publishing limit is used up (" + q.used + "/" + q.limit + "). Try again later." });
      }
      const out = await publishNow(creds, {
        kind: body.type, image_url: body.imageUrl, video_url: body.videoUrl,
        caption: String(body.caption || "").slice(0, 2200),
      });
      try { await recordMetric(orgId, { platform: "instagram", external_id: out.mediaId, posted_text: String(body.caption || ""), published_at: new Date().toISOString() }); } catch (e) {}
      return res.status(200).json({ ok: true, mediaId: out.mediaId, kind: out.kind, quota: await quota(creds) });
    }

    // ---- Schedule for later
    if (action === "schedule") {
      const at = new Date(body.at || 0);
      if (isNaN(at.getTime())) return res.status(400).json({ error: "That date and time isn’t valid." });
      if (at.getTime() < Date.now() - 60000) return res.status(400).json({ error: "That time is in the past." });
      const kind = body.type === "post" ? "post" : (body.type === "reel" ? "reel" : "story");
      const url = String(body.imageUrl || body.videoUrl || "");
      if (!url) return res.status(400).json({ error: "Pick an image first." });
      // Validate NOW rather than at 06:00 tomorrow. A scheduled story that fails silently in the
      // night because the URL was a PNG is the worst version of this feature.
      const bad = await checkMedia(url, kind);
      if (bad) return res.status(400).json({ error: bad });
      const r = await fetch(sbBase() + "/rest/v1/ig_queue", {
        method: "POST", headers: Object.assign({}, svcH(), { Prefer: "return=representation" }),
        body: JSON.stringify({
          org_id: orgId, kind, image_url: kind === "reel" ? null : url, video_url: kind === "reel" ? url : null,
          caption: String(body.caption || "").slice(0, 2200), run_at: at.toISOString(), status: "pending",
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return res.status(502).json({ error: "Could not save to the queue. Has the ig_queue table been created? " + t.slice(0, 160) });
      }
      const rows = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, item: rows && rows[0], cron: !!process.env.CRON_SECRET });
    }

    // ---- Cancel a queued item
    if (action === "cancel") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "Missing id" });
      // 'publishing' is cancellable on purpose. If the function dies between media_publish
      // succeeding and the row being marked done, that row stays 'publishing' forever. Auto-resetting
      // it to pending would risk publishing the same story twice, which is worse than a stuck row —
      // so it stays put, stays VISIBLE on the queue, and a human can clear it.
      const r = await fetch(sbBase() + "/rest/v1/ig_queue?id=eq." + encodeURIComponent(id) + "&org_id=eq." + encodeURIComponent(orgId) + "&status=in.(pending,error,publishing)", {
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
    return res.status(status).json({
      error: (err && err.message) || "Instagram error",
      igCode: (err && err.igCode) || null,
      apiVersion: V,
    });
  }
}

// Facebook Page posting rides on this EXACT connection — same Meta app, same Page, same token,
// just one more scope (pages_manage_posts) requested at connect time. Rather than a second
// credential store and a second "Connect" button asking for a token Volt already has, facebook.js
// reads the identical org_secret row (provider "instagram" — it's really "the Meta connection")
// via this loadCreds, and posts with creds.pageId + creds.token through the same graph() helper.
export { graph, loadCreds };
