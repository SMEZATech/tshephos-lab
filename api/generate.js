// Tshepho's Lab — © 2026 Tshepho Joel. All rights reserved.
// Serverless proxy. Keeps your API key on the server, never in the browser.
// Provider is set with the LLM_PROVIDER env var: "gemini" (default) | "claude" | "groq".

const SYSTEM =
  "You are an elite direct-response performance-marketing copywriter and a brutally honest creative strategist. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_AUDIT =
  "You are an elite social media strategist and brand auditor with a decade optimising profiles for reach, follows and conversions. " +
  "You are constructive but brutally honest, and you base every judgement only on what the user supplies — never invent facts. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_ANALYTICS =
  "You are an elite performance-marketing analyst and social media strategist. You read period metrics, compare them to realistic platform benchmarks " +
  "(always acknowledging that healthy ranges vary by account size and niche), and give honest, decision-ready analysis. " +
  "You base everything only on the numbers supplied — never invent data. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_EMAIL =
  "You are the body writer for SME South Africa's weekly email newsletter. You write ONLY the inner body HTML — never the header, footer, greeting, or promo banners (those are fixed and added separately). " +
  "Audience: South African small-business owners. Voice: warm, practical, encouraging, plain English, skimmable. " +
  "You output HTML fragments using ONLY these patterns, with no <html>, <head>, <body> or <style> tags: " +
  "intro paragraph as <p class=\"intro-text\" style=\"margin-bottom: 0;\">...</p>; section headings as <h2>Title Case Heading</h2>; body copy as <p>...</p>; " +
  "in-text links as <a href=\"URL\" target=\"_blank\">anchor</a>; a Related Reading box as <div class=\"related-reading\"><span>📚 Related Reading:</span> <a href=\"URL\" class=\"related-link\">Title</a></div>; " +
  "an image (only when an image URL is explicitly supplied) as <img src=\"URL\" alt=\"...\" class=\"newsletter-image\">; and a divider between sections as " +
  "<hr style=\"border: 0; border-top: 2px dashed #e2e8f0; margin: 25px 0;\">. " +
  "Structure: one intro paragraph, then 2-3 sections, each = <h2> + optional image + 1-2 <p> + optional Related Reading box, separated by the dashed <hr>. " +
  "CRITICAL: NEVER invent or guess URLs, links, dates, prices, statistics or Related Reading titles. Use ONLY links and facts present in the user's brief. If a section has no link, simply omit the link and the Related Reading box. " +
  "Do NOT write a greeting or sign-off. Return ONLY the raw HTML fragment starting with the intro paragraph — no markdown, no code fences, no commentary.";

const PLATFORM_HINT = {
  Meta: "Meta feed (FB/IG): scroll-stopping, conversational, native, emotionally resonant.",
  Google: "Google Search: high-intent, benefit-led, concise; headline reads like the answer.",
  LinkedIn: "LinkedIn: credible, professional, insight-driven, low-hype.",
  TikTok: "TikTok: native, punchy, trend-aware, hook in the first 3 words.",
};

const AUDIT_HINT = {
  Instagram: "150-char bio, keyword-rich name field for search, one strategic link (or link-in-bio), highlights, a consistent visual grid, a clear niche and an explicit CTA.",
  LinkedIn: "The headline (220 chars) is prime real estate; the About section should tell a credible story with proof; use Featured; post consistently; professional but human voice.",
  Facebook: "Clear page name and category, a complete About with a CTA button and link, consistent value-led posts, and visible social proof / reviews.",
  TikTok: "A tight niche, a searchable name, a bio with a hook plus CTA and link, consistent content pillars, and trend-awareness.",
  X: "A concise bio with keywords and a CTA, a pinned post, a consistent voice, a link, and a clear niche focus.",
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

function buildAuditPrompt({ platform, handle, bio, captions, goal }) {
  const p = platform || "Instagram";
  const hint = AUDIT_HINT[p] || AUDIT_HINT.Instagram;
  return `You are auditing a ${p} profile for a business / brand.

HANDLE / NAME:
${handle || "(not provided)"}

BIO / ABOUT TEXT:
${bio || "(not provided)"}

RECENT CAPTIONS / POSTS (may be blank, one idea per line):
${captions || "(not provided)"}

PRIMARY GOAL:
${goal || "grow the right audience and drive profile actions (link clicks, follows, enquiries)"}

${p} BEST-PRACTICE CONTEXT:
${hint}

TASK:
Audit this profile like a senior social media strategist. Grade HONESTLY across the full 0-100 range — do NOT inflate, and do not give everything the same score. Base every point strictly on what was supplied; where something is missing, treat the gap itself as the finding rather than inventing facts.

Return ONLY minified JSON, no markdown, no commentary, exactly this shape:
{"overall":0,"verdict":"","dimensions":[{"label":"","score":0,"note":""}],"wins":[""],"risks":[""],"opportunities":[""],"actions":[""],"bioRewrite":"","captionIdeas":[""]}

REQUIREMENTS:
- overall: integer 0-100 reflecting the whole profile.
- verdict: ONE sentence, <= 22 words.
- dimensions: 5 to 7 items relevant to ${p} (e.g. Bio clarity, Value proposition, Call-to-action, Searchability / keywords, Caption quality, Brand voice & consistency, Hashtag strategy). Each: score 0-100 integer, note <= 18 words.
- wins, risks, opportunities: 2 to 4 items each, each <= 22 words and specific to what was supplied.
- actions: 3 to 5 prioritised, concrete "do this now" steps, each <= 24 words, ordered by impact.
- bioRewrite: a stronger ready-to-paste bio for ${p}, respecting typical limits (Instagram/TikTok ~150 chars, LinkedIn headline ~220 chars). Concrete and on-platform.
- captionIdeas: 2 to 3 scroll-stopping caption hook lines tailored to this brand, each <= 16 words.`;
}

function buildAnalyticsPrompt({ platform, period, summary, notes, goal }) {
  const p = platform || "Instagram";
  return `You are analysing ${p} performance for the period: ${period || "the reporting period"}.

METRICS (as supplied by the user; a dash means not provided):
${summary || "(none provided)"}

NOTES / CONTEXT:
${notes || "(none)"}

PRIMARY GOAL:
${goal || "grow the right audience and drive profile actions (clicks, follows, enquiries)"}

TASK:
Analyse this like a senior performance-marketing analyst. Compare the figures to realistic ${p} benchmarks, but explicitly account for the fact that healthy ranges vary by account size and niche — never imply one universal number is law. Grade the period HONESTLY 0-100. Base everything strictly on the supplied numbers; if a metric is missing, do not invent it — note the gap instead.

Return ONLY minified JSON, no markdown, no commentary, exactly this shape:
{"overall":0,"verdict":"","benchmarks":[{"metric":"","you":"","typical":"","read":""}],"wins":[""],"risks":[""],"opportunities":[""],"actions":[""]}

REQUIREMENTS:
- overall: integer 0-100 for the period's health.
- verdict: ONE sentence, <= 24 words.
- benchmarks: 3 to 6 rows for the most important metrics supplied. "you" = the user's figure as a short string; "typical" = a realistic ${p} range; "read" = <= 12 words (e.g. "above benchmark", "in line", "below — needs work").
- wins, risks, opportunities: 2 to 4 items each, each <= 22 words and specific to the numbers.
- actions: 3 to 5 prioritised, concrete steps, each <= 24 words, ordered by impact.`;
}

function buildBestPostsPrompt({ platform, postsText, goal }) {
  const p = platform || "Instagram";
  return `You are analysing the TOP-PERFORMING ${p} posts for a brand, already ranked by engagement (highest first).

TOP POSTS:
${postsText || "(none)"}

PRIMARY GOAL:
${goal || "grow reach and engagement and drive profile actions"}

TASK:
Act as a senior content strategist. Look ACROSS these winners and find what they share — format, topic, hook style, length, tone, posting pattern — then turn it into a concrete, repeatable playbook. Base everything ONLY on the posts shown; if the signal is thin, say so rather than inventing.

Return ONLY minified JSON, no markdown, no commentary, exactly this shape:
{"verdict":"","patterns":[""],"doMore":[""],"doLess":[""],"nextPosts":[""]}

REQUIREMENTS:
- verdict: ONE sentence on what's driving the best posts, <= 24 words.
- patterns: 2 to 4 specific common threads among the top posts, each <= 20 words.
- doMore: 2 to 3 concrete things to repeat, each <= 20 words.
- doLess: 1 to 3 things to stop or fix, each <= 20 words.
- nextPosts: 2 to 3 ready-to-make post ideas modelled on the winners, each <= 18 words.`;
}

function buildEmailPrompt({ brief }) {
  return `Write this week's SME South Africa newsletter BODY from the brief below. Follow the house style and rules exactly, and use ONLY the links and facts that appear in the brief.

BRIEF:
${brief}

Return only the HTML fragment, starting with the intro paragraph. No greeting, no footer, no promo banners, no code fences, no commentary.`;
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

const clamp100 = (n) => {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 50;
  return Math.max(0, Math.min(100, x));
};
const strList = (a, n, len) =>
  Array.isArray(a) ? a.slice(0, n).map((s) => String(s == null ? "" : s).trim().slice(0, len)).filter(Boolean) : [];

// ---- providers ----
async function callGemini(prompt, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system || SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: Object.assign(
      { temperature: opts.temperature != null ? opts.temperature : 0.9, maxOutputTokens: opts.maxTokens || 4096, thinkingConfig: { thinkingBudget: 0 } },
      opts.json === false ? {} : { responseMimeType: "application/json" }
    ),
  });
  let lastErr;
  // Gemini occasionally returns 503 "overloaded / high demand". Retry a couple of times before surfacing it.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 700 * attempt));
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: payload,
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || "").join("");
    }
    const msg = (data && data.error && data.error.message) || ("Gemini request failed (" + r.status + ")");
    lastErr = new Error(msg);
    if (!(r.status === 503 || r.status === 429 || /overload|high demand|unavailable|try again/i.test(msg))) break;
  }
  throw lastErr || new Error("Gemini request failed");
}

async function callClaude(prompt, opts = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error("CLAUDE_API_KEY is not set");
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens || 2000, system: opts.system || SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Claude request failed");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function callGroq(prompt, opts = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: opts.temperature != null ? opts.temperature : 0.9,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: opts.system || SYSTEM }, { role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || "Groq request failed");
  return data?.choices?.[0]?.message?.content || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional app-key guard. Enforced ONLY if APP_KEY is set in the environment;
  // unset = open (backwards compatible). Send it from the client as the "x-app-key" header.
  const APP_KEY = process.env.APP_KEY;
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
    const callProvider = (prompt, opts) =>
      provider === "claude" ? callClaude(prompt, opts)
      : provider === "groq" ? callGroq(prompt, opts)
      : callGemini(prompt, opts);

    const task = String(body.task || "copy").toLowerCase();

    // ---- Profile Audit ----
    if (task === "audit") {
      const { platform, handle, bio, captions, goal } = body;
      if ((!bio || !String(bio).trim()) && (!captions || !String(captions).trim())) {
        return res.status(400).json({ error: "Add a bio or some captions to audit." });
      }
      const aPrompt = buildAuditPrompt({ platform, handle, bio, captions, goal });
      const aText = await callProvider(aPrompt, { system: SYSTEM_AUDIT, temperature: 0.6, maxTokens: 4096 });
      const ap = safeParse(aText);
      const dims = Array.isArray(ap && ap.dimensions)
        ? ap.dimensions.slice(0, 8).map((d) => ({
            label: String((d && d.label) || "").slice(0, 40),
            score: clamp100(d && d.score),
            note: String((d && d.note) || "").slice(0, 180),
          })).filter((d) => d.label)
        : [];
      if (!ap || !dims.length) {
        return res.status(502).json({ error: "Model returned an unusable audit — try again." });
      }
      const audit = {
        overall: clamp100(ap.overall),
        verdict: String(ap.verdict || "").slice(0, 220),
        dimensions: dims,
        wins: strList(ap.wins, 5, 220),
        risks: strList(ap.risks, 5, 220),
        opportunities: strList(ap.opportunities, 5, 220),
        actions: strList(ap.actions, 6, 260),
        bioRewrite: String(ap.bioRewrite || "").slice(0, 400),
        captionIdeas: strList(ap.captionIdeas, 4, 180),
      };
      return res.status(200).json({ audit });
    }

    // ---- Performance Analytics ----
    if (task === "analytics") {
      const { platform, period, summary, notes, goal } = body;
      if (!summary || !String(summary).trim()) {
        return res.status(400).json({ error: "Add at least one metric to analyse." });
      }
      const anPrompt = buildAnalyticsPrompt({ platform, period, summary, notes, goal });
      const anText = await callProvider(anPrompt, { system: SYSTEM_ANALYTICS, temperature: 0.5, maxTokens: 4096 });
      const an = safeParse(anText);
      const benches = Array.isArray(an && an.benchmarks)
        ? an.benchmarks.slice(0, 8).map((b) => ({
            metric: String((b && b.metric) || "").slice(0, 40),
            you: String((b && b.you) || "").slice(0, 40),
            typical: String((b && b.typical) || "").slice(0, 60),
            read: String((b && b.read) || "").slice(0, 60),
          })).filter((b) => b.metric)
        : [];
      if (!an || (!benches.length && !(Array.isArray(an.actions) && an.actions.length))) {
        return res.status(502).json({ error: "Model returned an unusable analysis — try again." });
      }
      const analytics = {
        overall: clamp100(an.overall),
        verdict: String(an.verdict || "").slice(0, 240),
        benchmarks: benches,
        wins: strList(an.wins, 5, 220),
        risks: strList(an.risks, 5, 220),
        opportunities: strList(an.opportunities, 5, 220),
        actions: strList(an.actions, 6, 260),
      };
      return res.status(200).json({ analytics });
    }

    // ---- Best-posts playbook ----
    if (task === "bestposts") {
      const { platform, posts, goal } = body;
      const arr = Array.isArray(posts) ? posts : [];
      if (!arr.length) return res.status(400).json({ error: "No posts to analyse." });
      const postsText = arr.slice(0, 12).map((p, i) => {
        const mets = Array.isArray(p.metrics)
          ? p.metrics.filter((m) => m && m.value != null).map((m) => m.label + " " + m.value).join(", ")
          : "";
        return (i + 1) + '. "' + String((p && p.content) || "(no caption)").slice(0, 180) + '" — '
          + (mets || "no metrics")
          + (p && p.engagement != null ? (" (engagement " + p.engagement + ")") : "");
      }).join("\n");
      const text = await callProvider(buildBestPostsPrompt({ platform, postsText, goal }), { system: SYSTEM_ANALYTICS, temperature: 0.6, maxTokens: 2048 });
      const bp = safeParse(text);
      if (!bp) return res.status(502).json({ error: "Model returned an unusable analysis — try again." });
      const bestposts = {
        verdict: String(bp.verdict || "").slice(0, 240),
        patterns: strList(bp.patterns, 4, 200),
        doMore: strList(bp.doMore, 4, 200),
        doLess: strList(bp.doLess, 4, 200),
        nextPosts: strList(bp.nextPosts, 4, 200),
      };
      return res.status(200).json({ bestposts });
    }

    // ---- Newsletter email body ----
    if (task === "email") {
      const { brief } = body;
      if (!brief || !String(brief).trim()) return res.status(400).json({ error: "Missing brief" });
      const text = await callProvider(buildEmailPrompt({ brief }), { system: SYSTEM_EMAIL, json: false, temperature: 0.7, maxTokens: 3000 });
      let html = String(text || "").replace(/```html\s*/gi, "").replace(/```/g, "").trim();
      if (!html) return res.status(502).json({ error: "Model returned an empty body — try again." });
      return res.status(200).json({ emailBody: html });
    }

    // ---- Ad copy (default) ----
    const { offer, audience, platform, count = 5, winnerAngle } = body;
    if (!offer || !String(offer).trim()) return res.status(400).json({ error: "Missing offer" });

    const prompt = buildPrompt({ offer, audience, platform, count, winnerAngle });
    const text = await callProvider(prompt);

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
