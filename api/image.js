// Volt — AI image generation (Gemini Imagen). © 2026 Tshepho Joel.
// POST { prompt, aspect } → { image: "data:image/png;base64,..." }
// Uses the desktop's own Gemini key (x-gemini-key) or the server env key.
// Note: image generation needs a Gemini key with Imagen access (a paid tier). If the key
// can't generate images, the provider's error is surfaced verbatim.

import { blocked, meter, logContent } from "./_guard.js";

const ASPECTS = { "1:1": 1, "3:4": 1, "4:3": 1, "9:16": 1, "16:9": 1 };

export default async function handler(req, res) {
  if (await blocked(req, res, { id: "image", limit: 12, windowSec: 60 })) return;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "").trim().slice(0, 800);
    if (!prompt) return res.status(400).json({ error: "Describe the image first." });
    const aspect = ASPECTS[body.aspect] ? body.aspect : "1:1";

    const key = (req.headers["x-gemini-key"] && String(req.headers["x-gemini-key"])) || process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: "Image generation needs a Gemini key.", code: "NOT_CONFIGURED" });

    if (await meter(req, res, { kind: "image" })) return; // count usage (won't block unless BILLING_ENFORCE=1)

    const model = process.env.IMAGE_MODEL || "imagen-3.0-generate-002";
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":predict";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("Image service error " + r.status);
      return res.status(r.status === 403 ? 403 : 502).json({ error: msg });
    }
    const pred = data && data.predictions && data.predictions[0];
    const b64 = pred && (pred.bytesBase64Encoded || pred.image);
    if (!b64) return res.status(502).json({ error: "No image came back — try rewording the prompt." });
    const mime = (pred && pred.mimeType) || "image/png";
    const contentId = await logContent(req.volt && req.volt.orgId, {
      tool: "image", input: { prompt, aspect }, output: {}, provider: "gemini", model,
      userId: req.volt && req.volt.user && req.volt.user.id,
    });
    return res.status(200).json({ image: "data:" + mime + ";base64," + b64, contentId });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
