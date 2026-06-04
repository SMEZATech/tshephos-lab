// Volt — image upload proxy → WordPress media library. © 2026 Tshepho Joel.
// Hosts an uploaded email image on infrastructure you own, returning a public URL
// that survives in sent emails (data-URLs get stripped by Gmail/Outlook).
//
// Web: set WP_URL, WP_USER, WP_APP_PASSWORD in Vercel, then redeploy.
// Desktop: the app sends x-client:desktop + x-wp-url / x-wp-user / x-wp-key.
// In WordPress: Users → Profile → Application Passwords → add one for "Volt".

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key, x-client, x-wp-url, x-wp-user, x-wp-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const APP_KEY = process.env.APP_KEY;
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isDesktop = req.headers["x-client"] === "desktop";
  const wpUrl = (isDesktop ? req.headers["x-wp-url"] : process.env.WP_URL) || "";
  const wpUser = (isDesktop ? req.headers["x-wp-user"] : process.env.WP_USER) || "";
  const wpKey = (isDesktop ? req.headers["x-wp-key"] : process.env.WP_APP_PASSWORD) || "";
  if (!wpUrl || !wpUser || !wpKey) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: isDesktop
        ? "Add your WordPress URL, username and application password in ⚙ Settings to host images."
        : "Image hosting isn’t set up. Add WP_URL, WP_USER, WP_APP_PASSWORD in Vercel, then redeploy.",
    });
  }

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const dataBase64 = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const filename = String(body.filename || "image.png").replace(/[^\w.\-]+/g, "_").slice(-80) || "image.png";
    const contentType = String(body.contentType || "image/png");
    if (!dataBase64) return res.status(400).json({ error: "No image data." });

    const buf = Buffer.from(dataBase64, "base64");
    if (!buf.length) return res.status(400).json({ error: "Image data was empty or invalid." });

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
