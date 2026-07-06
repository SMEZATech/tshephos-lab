// Volt — AI image generation. © 2026 Tshepho Joel.
// POST { prompt, aspect } → { image: "data:image/png;base64,..." }
// Uses the desktop's own Gemini key (x-gemini-key) or the server env key.
//
// Two backends:
//   • imagen-*                 → :predict          — higher quality, needs a PAID Gemini tier
//   • gemini *image* models    → :generateContent  — free tier; we try several known ids because
//                                the available name varies by key/region. If none work we return
//                                the key's actual image-capable models so IMAGE_MODEL can be set.
// Aspect ratio: Imagen takes it as a real parameter; the Gemini image models have no such knob,
// so we steer it through the prompt instead.

import { blocked, meter, logContent } from "./_guard.js";

const ASPECTS = { "1:1": "a perfect square 1:1", "3:4": "a portrait 3:4", "4:3": "a landscape 4:3", "9:16": "a tall vertical 9:16 (full-frame mobile)", "16:9": "a wide 16:9" };

// Tried in order (after any IMAGE_MODEL override). First that returns an image wins.
const GEMINI_IMAGE_CANDIDATES = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-preview-image-generation",
];
const G_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const notFound = (status, msg) => status === 404 || /not found|not supported|is not found|does not exist/i.test(msg || "");

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

    const override = process.env.IMAGE_MODEL || "";

    // ---- Paid Imagen path (only when explicitly configured) ----
    if (/imagen/i.test(override)) {
      const r = await fetch(G_BASE + override + ":predict", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status === 403 ? 403 : 502).json({ error: (data && data.error && data.error.message) || ("Image service error " + r.status) });
      const pred = data && data.predictions && data.predictions[0];
      const b64 = pred && (pred.bytesBase64Encoded || pred.image);
      if (!b64) return res.status(502).json({ error: "No image came back — try rewording the prompt." });
      return res.status(200).json({ image: "data:" + ((pred && pred.mimeType) || "image/png") + ";base64," + b64 });
    }

    // ---- Free Gemini image path — try candidate model ids until one works ----
    const steered = prompt + " — composed as " + ASPECTS[aspect] + " image. Do not render any text, words, letters, logos or watermarks in the image.";
    const candidates = [override, ...GEMINI_IMAGE_CANDIDATES].filter((m, i, a) => m && a.indexOf(m) === i);
    let b64 = "", mime = "image/png", usedModel = "", lastErr = "";
    for (const m of candidates) {
      const r = await fetch(G_BASE + m + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: steered }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || ("Image service error " + r.status);
        if (notFound(r.status, msg)) { lastErr = msg; continue; } // wrong id for this key → try next
        return res.status(r.status === 403 ? 403 : 502).json({ error: msg }); // real error (quota, safety) → surface
      }
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const imgPart = parts.find((p) => p && p.inlineData && p.inlineData.data);
      if (imgPart) { b64 = imgPart.inlineData.data; mime = imgPart.inlineData.mimeType || "image/png"; usedModel = m; break; }
      lastErr = "the model replied without an image";
    }

    if (!b64) {
      // Help pin the right model: report the image-capable models this key actually exposes.
      let available = [];
      try {
        const lr = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": key } });
        const ld = await lr.json().catch(() => ({}));
        available = (ld.models || [])
          .filter((mm) => /image/i.test(mm.name || "") && (mm.supportedGenerationMethods || []).some((x) => /generateContent|predict/i.test(x)))
          .map((mm) => String(mm.name || "").replace("models/", ""))
          .slice(0, 10);
      } catch (_) {}
      const hint = available.length ? (" Set IMAGE_MODEL in Vercel to one of: " + available.join(", ")) : " No image-capable model is enabled on this Gemini key.";
      return res.status(502).json({ error: "Couldn't generate an image (" + (lastErr || "no model worked") + ")." + hint, availableImageModels: available });
    }

    const contentId = await logContent(req.volt && req.volt.orgId, {
      tool: "image", input: { prompt, aspect }, output: {}, provider: "gemini", model: usedModel,
      userId: req.volt && req.volt.user && req.volt.user.id,
    });
    return res.status(200).json({ image: "data:" + mime + ";base64," + b64, contentId, model: usedModel });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
