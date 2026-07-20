// Volt — image upload proxy → WordPress media library. © 2026 Tshepho Joel.
// Hosts an uploaded email image on infrastructure you own, returning a public URL
// that survives in sent emails (data-URLs get stripped by Gmail/Outlook).
//
// Web: set WP_URL, WP_USER, WP_APP_PASSWORD in Vercel, then redeploy.
// Desktop: the app sends x-client:desktop + x-wp-url / x-wp-user / x-wp-key.
// In WordPress: Users → Profile → Application Passwords → add one for "Volt".

import { blocked, sbBase } from "./_guard.js";

const BUCKET = "volt-media";

// Free image hosting on the Supabase project we already run — no extra service, no WordPress
// required. Public bucket so Postiz/Gmail can fetch the URL. Auto-creates the bucket once.
async function supabaseUpload(buf, filename, contentType, orgId) {
  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!svc) return null;
  const base = sbBase();
  if (!base) return null;
  const h = { apikey: svc, Authorization: "Bearer " + svc };

  // Ensure the public bucket exists (idempotent — 400/409 "already exists" is fine).
  try {
    await fetch(base + "/storage/v1/bucket", {
      method: "POST", headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 10485760 }),
    });
  } catch (e) {}

  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-60) || "image.png";
  const path = (orgId ? String(orgId).slice(0, 40) : "shared") + "/" +
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "-" + safe;

  const up = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + encodeURI(path), {
    method: "POST", headers: { ...h, "Content-Type": contentType, "x-upsert": "true" }, body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => "");
    throw new Error("Storage upload failed (" + up.status + ")" + (t ? ": " + t.slice(0, 160) : ""));
  }
  return base + "/storage/v1/object/public/" + BUCKET + "/" + encodeURI(path);
}

export default async function handler(req, res) {
  if (await blocked(req, res, { id: "upload", limit: 15, windowSec: 60 })) return;

  const isDesktop = req.headers["x-client"] === "desktop";
  const wpUrl = (isDesktop ? req.headers["x-wp-url"] : process.env.WP_URL) || "";
  const wpUser = (isDesktop ? req.headers["x-wp-user"] : process.env.WP_USER) || "";
  const wpKey = (isDesktop ? req.headers["x-wp-key"] : process.env.WP_APP_PASSWORD) || "";
  const wpReady = !!(wpUrl && wpUser && wpKey);

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const dataBase64 = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const filename = String(body.filename || "image.png").replace(/[^\w.\-]+/g, "_").slice(-80) || "image.png";
    const contentType = String(body.contentType || "image/png");
    if (!dataBase64) return res.status(400).json({ error: "No image data." });
    if (!/^image\//i.test(contentType)) return res.status(400).json({ error: "Only image files can be uploaded." });

    const buf = Buffer.from(dataBase64, "base64");
    if (!buf.length) return res.status(400).json({ error: "Image data was empty or invalid." });
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Image too large — please use one under 5 MB." });

    // No WordPress configured → host it on Supabase Storage instead of refusing the upload.
    if (!wpReady) {
      const orgId = req.volt && req.volt.orgId;
      const url = await supabaseUpload(buf, filename, contentType, orgId);
      if (url) return res.status(200).json({ ok: true, url, host: "supabase" });
      return res.status(503).json({
        error: "NOT_CONFIGURED",
        message: "Image hosting isn’t available — set SUPABASE_SERVICE_KEY (or WordPress creds) in Vercel.",
      });
    }

    const base = String(wpUrl).replace(/\/+$/, "");
    const auth = "Basic " + Buffer.from(wpUser + ":" + wpKey).toString("base64");
    const r = await fetch(base + "/wp-json/wp/v2/media", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": contentType,
        "Content-Disposition": 'attachment; filename="' + filename + '"',
      },
      body: buf,
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }

    if (!r.ok) {
      // WordPress rejected it — fall back to Supabase Storage rather than failing the upload.
      try {
        const url = await supabaseUpload(buf, filename, contentType, req.volt && req.volt.orgId);
        if (url) return res.status(200).json({ ok: true, url, host: "supabase", note: "WordPress rejected the upload; hosted on Volt storage instead." });
      } catch (e) {}
      const msg =
        (data && (data.message || data.code)) ||
        (typeof data === "string" ? data.slice(0, 220) : "") ||
        ("WordPress upload failed (" + r.status + ")");
      const isAuth = r.status === 401 || r.status === 403;
      return res.status(isAuth ? 401 : 502).json({ error: msg });
    }

    const url = (data && (data.source_url || (data.guid && data.guid.rendered))) || "";
    if (!url) return res.status(502).json({ error: "Upload succeeded but no URL was returned." });
    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Upload error" });
  }
}
