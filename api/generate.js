// Tshepho's Lab — © 2026 Tshepho Joel. All rights reserved.
// Serverless proxy. Keeps your API key on the server, never in the browser.
// Provider is set with the LLM_PROVIDER env var: "gemini" (default) | "claude" | "groq".

const SYSTEM =
  "You are an elite direct-response performance-marketing copywriter and a brutally honest creative strategist. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const PLATFORM_HINT = {
  Meta: "Meta feed (FB/IG): scroll-stopping, conversational, native, emotionally resonant.",
  Google: "Google Search: high-intent, benefit-led, concise; headline reads like the answer.",
  LinkedIn: "LinkedIn: credible, professional, insight-driven, low-hype.",
  TikTok: "TikTok: native, punchy, trend-aware, hook in the first 3 words.",
};

function buildPrompt({ offer, audience, platform, count, winnerAngle }) {
  const hint = PLATFORM_HINT[platform] || PLATFORM_HINT.Meta;
  const isGoogle = (platform || "") === "Google";
  const task = winnerAngle
    ? `Produce ${count} NEW variations that riff on this winning angle with fresh hooks: "${winnerAngle}".`
    : `Produce ${count} variations, each using a DISTINCT copywriting framework/angle (e.g. PAS, AIDA, Before-After-Bridge, curiosity gap, bold claim, social proof, pattern interrupt, problem-first).`;
  const hashtagRule = isGoogle
    ? `- hashtags: this is Google Search, which does NOT use hashtags. Return an empty array [].`
    : `- hashtags: return 4-6 specific, relevant hashtags as plain words WITHOUT the "#" symbol and with no spaces (e.g. "SMEFunding", "SmallBusinessSA"). Mix broad and niche tags.`;
  return `OFFER / PRODUCT:
${offer}

TARGET AUDIENCE:
${audience || "broad consumer audience"}

PLATFORM:
${platform || "Meta"} — ${hint}

TASK:
${task}

RULES:
- headline <= 12 words, punchy.
- body <= 26 words.
- cta <= 5 words.
- framework = the named angle used (<= 4 words).
${hashtagRule}
- Score each 1-10 (integers) on hook, clarity, urgency. Grade like a tough media buyer — use the full range, do NOT give everything 8s.

Return ONLY minified JSON, no markdown, no commentary, exactly this shape:
{"variations":[{"framework":"","headline":"","body":"","cta":"","hashtags":[],"scores":{"hook":0,"clarity":0,"urgency":0}}]}`;
}

function safeParse(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch (err) {}
  }
  return null;
}

const clampScore = (n) => {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 5;
  return Math.max(1, Math.min(10, x));
};

const cleanTags = (arr) =>
  Array.isArray(arr)
    ? arr.slice(0, 8)
        .map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "").slice(0, 30))
        .filter(Boolean)
    : [];

// ---- providers ----
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 4096, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Gemini request failed");
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("");
}

async function callClaude(prompt) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error("CLAUDE_API_KEY is not set");
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Claude request failed");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Groq request failed");
  return data?.choices?.[0]?.message?.content || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { offer, audience, platform, count = 5, winnerAngle } = body;
    if (!offer || !String(offer).trim()) return res.status(400).json({ error: "Missing offer" });

    const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
    const prompt = buildPrompt({ offer, audience, platform, count, winnerAngle });

    let text;
    if (provider === "claude") text = await callClaude(prompt);
    else if (provider === "groq") text = await callGroq(prompt);
    else text = await callGemini(prompt);

    const parsed = safeParse(text);
    if (!parsed || !Array.isArray(parsed.variations) || !parsed.variations.length) {
      return res.status(502).json({ error: "Model returned no usable variations — try again." });
    }

    const variations = parsed.variations.slice(0, 12).map((v) => ({
      framework: String(v.framework || "Angle").slice(0, 40),
      headline: String(v.headline || "").slice(0, 160),
      body: String(v.body || "").slice(0, 400),
      cta: String(v.cta || "").slice(0, 40),
      hashtags: cleanTags(v.hashtags),
      scores: {
        hook: clampScore(v.scores && v.scores.hook),
        clarity: clampScore(v.scores && v.scores.clarity),
        urgency: clampScore(v.scores && v.scores.urgency),
      },
    }));

    return res.status(200).json({ variations });
  } catch (err) {
    return res.status(500).json({ error: (err && err.message) || "Server error" });
  }
}
