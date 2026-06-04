// Volt — Kit (ConvertKit) proxy. © 2026 Tshepho Joel. All rights reserved.
// Creates a DRAFT broadcast in Kit from the newsletter HTML, so it can be reviewed
// and sent from inside Kit. The Kit key stays on the server (web) or is supplied by
// the desktop app per-user via the x-kit-key header.
//
// Web: set KIT_API_KEY in Vercel (Project Settings → Environment Variables), then redeploy.
// Desktop: the app sends x-client:desktop + x-kit-key:<user key>.
// Get a V4 API key in Kit → Settings → Developer (Advanced → API Keys).
// Docs: https://developers.kit.com/api-reference/broadcasts/create-a-broadcast

const KIT_URL = "https://api.kit.com/v4/broadcasts";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key, x-client, x-kit-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional app-key guard (enforced only if APP_KEY is set) — backwards compatible.
  const APP_KEY = process.env.APP_KEY;
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Resolve the Kit API key: desktop sends its own; web falls back to the env key.
  const isDesktop = req.headers["x-client"] === "desktop";
  const kitKey = isDesktop ? req.headers["x-kit-key"] : process.env.KIT_API_KEY;
  if (!kitKey) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: isDesktop
        ? "Add your Kit API key in ⚙ Settings to send to Kit."
        : "Kit isn't connected. Add KIT_API_KEY in Vercel, then redeploy.",
    });
  }

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const html = String(body.html || "").trim();
    const subject = String(body.subject || "").trim();
    const previewText = String(body.previewText || body.preview_text || "").trim();
    if (!html) return res.status(400).json({ error: "Missing email HTML." });
    if (!subject) return res.status(400).json({ error: "Add an email subject before sending to Kit." });

    // send_at:null + public:false → a DRAFT the user finalises (audience, schedule) inside Kit.
    const payload = {
      subject,
      preview_text: previewText,
      description: subject,
      content: html,
      public: false,
      published_at: null,
      send_at: null,
    };

    const r = await fetch(KIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Kit-Api-Key": kitKey },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }

    if (!r.ok) {
      const msg =
        (data && (data.message || (Array.isArray(data.errors) ? data.errors.join("; ") : data.error))) ||
        (typeof data === "string" ? data.slice(0, 300) : "") ||
        ("Kit request failed (" + r.status + ")");
      const auth = r.status === 401 || r.status === 403;
      return res.status(auth ? 401 : 502).json({ error: msg });
    }

    const b = (data && data.broadcast) || data || {};
    return res.status(200).json({
      ok: true,
      id: b.id || null,
      publicUrl: b.public_url || null,
    });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Kit error" });
  }
}
