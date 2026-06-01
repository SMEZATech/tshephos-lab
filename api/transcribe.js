// Volt — Transcription proxy. © 2026 Tshepho Joel. All rights reserved.
// Keeps your Groq API key on the server. Returns word-level timestamps for captions.
//
// Set this env var in Vercel (Project Settings → Environment Variables), then redeploy:
//   GROQ_API_KEY   — your Groq API key (free tier at console.groq.com)
// Optional:
//   GROQ_STT_MODEL — defaults to "whisper-large-v3-turbo"
//
// The client sends JSON: { audio: "<base64>", mime: "audio/webm", language?: "en" }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional app-key guard (enforced only when APP_KEY is set).
  const APP_KEY = process.env.APP_KEY;
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "NOT_CONFIGURED", message: "Captions need a Groq key. Add GROQ_API_KEY in Vercel and redeploy." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { audio, mime, language } = body;
    if (!audio) return res.status(400).json({ error: "No audio supplied" });

    const buf = Buffer.from(audio, "base64");
    if (!buf.length) return res.status(400).json({ error: "Empty audio" });

    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime || "audio/webm" }), "clip.webm");
    form.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("language", language || "en");
    form.append("temperature", "0");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form,
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("Transcription failed (" + r.status + ")");
      return res.status(r.status).json({ error: msg });
    }

    // Normalise word timestamps. Fall back to segment-level if word-level is absent.
    let words = [];
    if (Array.isArray(data.words) && data.words.length) {
      words = data.words.map((w) => ({
        word: String(w.word || "").trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
      })).filter((w) => w.word);
    } else if (Array.isArray(data.segments)) {
      // crude per-segment fallback: spread words evenly across each segment
      data.segments.forEach((seg) => {
        const segWords = String(seg.text || "").trim().split(/\s+/).filter(Boolean);
        const s = Number(seg.start) || 0, e = Number(seg.end) || s;
        const step = segWords.length ? (e - s) / segWords.length : 0;
        segWords.forEach((w, i) => words.push({ word: w, start: s + i * step, end: s + (i + 1) * step }));
      });
    }

    return res.status(200).json({ text: data.text || "", words });
  } catch (err) {
    return res.status(500).json({ error: (err && err.message) || "Server error" });
  }
}
