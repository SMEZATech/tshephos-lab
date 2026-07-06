// Volt — AI image generation. © 2026 Tshepho Joel.
// POST { prompt, aspect } → { image: "data:image/png;base64,..." }
// Uses the desktop's own Gemini key (x-gemini-key) or the server env key.
//
// Two backends, chosen by IMAGE_MODEL:
//   • gemini-2.0-flash*image*   → :generateContent  — works on the FREE Gemini tier (default)
//   • imagen-*                  → :predict          — higher quality, needs a PAID Gemini tier
// Aspect ratio: Imagen takes it as a real parameter; the free Gemini model has no such knob,
// so we steer it through the prompt instead.

import { blocked, meter, logContent } from "./_guard.js";

const ASPECTS = { "1:1": "a perfect square 1:1", "3:4": "a portrait 3:4", "4:3": "a landscape 4:3", "9:16": "a tall vertical 9:16 (full-frame mobile)", "16:9": "a wide 16:9" };

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

    const model = process.env.IMAGE_MODEL || "gemini-2.0-flash-preview-image-generation";
    const base = "https://generativelanguage.googleapis.com/v1beta/models/" + model;
    const isImagen = /imagen/i.test(model);

    let b64 = "", mime = "image/png";
    if (isImagen) {
      // Paid Imagen path — native aspectRatio parameter.
      const r = await fetch(base + ":predict", {
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
      b64 = pred && (pred.bytesBase64Encoded || pred.image);
      mime = (pred && pred.mimeType) || "image/png";
    } else {
      // Free Gemini Flash image path — steer aspect via the prompt, read image from inlineData.
      const steered = prompt + " — composed as " + ASPECTS[aspect] + " image. Do not render any text, words, letters, logos or watermarks in the image.";
      const r = await fetch(base + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: steered }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || ("Image service error " + r.status);
        return res.status(r.status === 403 ? 403 : 502).json({ error: msg });
      }
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const imgPart = parts.find((p) => p && p.inlineData && p.inlineData.data);
      if (imgPart) { b64 = imgPart.inlineData.data; mime = imgPart.inlineData.mimeType || "image/png"; }
    }

    if (!b64) return res.status(502).json({ error: "No image came back — try rewording the prompt." });
    const contentId = await logContent(req.volt && req.volt.orgId, {
      tool: "image", input: { prompt, aspect }, output: {}, provider: "gemini", model,
      userId: req.volt && req.volt.user && req.volt.user.id,
    });
    return res.status(200).json({ image: "data:" + mime + ";base64," + b64, contentId });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
