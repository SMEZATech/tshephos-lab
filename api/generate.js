// Tshepho's Lab — © 2026 Tshepho Joel. All rights reserved.
// Serverless proxy. Keeps your API key on the server, never in the browser.
// Providers auto-fail-over across every configured free AI key (see _ai.js). Order is set with
// LLM_ORDER (comma list) or the legacy single LLM_PROVIDER; unlisted providers are appended.

import { blocked, meter, logContent, sbRest } from "./_guard.js";
import { chatComplete, resolveLlmKeys, llmOrder } from "./_ai.js";

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
  "If the brief contains Kit merge fields written as {{ ... }} (e.g. {{ subscriber.industry }}), reproduce them EXACTLY and unchanged in the body — treat them as literal placeholders; never alter, translate, remove, or wrap them. " +
  "Do NOT write a greeting or sign-off. Return ONLY the raw HTML fragment starting with the intro paragraph — no markdown, no code fences, no commentary.";

const SYSTEM_WEEKLYACTION =
  "You are an engagement strategist for SME South Africa's weekly newsletter to South African small-business owners. " +
  "You design the 'Weekly Action' — one small, concrete step a reader can take THIS WEEK, drawn directly from the email's content, plus a low-friction one-tap poll to spark replies from a fatigued list. " +
  "Keep it practical, encouraging, plain South African English; base it ONLY on the email content (never invent facts, figures, deadlines or offers). " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_SUBJECTS =
  "You are an email subject-line strategist for SME South Africa's weekly newsletter to South African small-business owners. " +
  "The list is ~50% cold/fatigued, so your job is to WIN THE OPEN and re-earn attention — high curiosity and clear value, never clickbait or false promises. " +
  "You write in warm, plain, credible South African English. " +
  "CRITICAL: base every subject ONLY on the actual email content provided — never invent facts, numbers, names, offers or urgency that isn't in the content. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_VIDEOCOPY =
  "You are a senior social media copywriter for SME South Africa, a platform for South African small-business owners and entrepreneurs. " +
  "You write scroll-stopping copy to accompany short vertical video clips repurposed from webinars. " +
  "You base the copy ONLY on the supplied transcript — never invent facts, names, statistics, dates, offers or links. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_YTMETA =
  "You are a YouTube SEO strategist. From a video transcript you write metadata that maximises click-through and watch time WITHOUT clickbait or false claims. " +
  "Base everything ONLY on the transcript — never invent facts, names, numbers or links. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_HIGHLIGHTS =
  "You are a senior short-form video editor who finds the most clip-worthy moments in long talks and webinars for vertical social shorts. " +
  "You pick self-contained, punchy moments that open on a strong hook and end on a satisfying payoff or punchline. " +
  "You base everything ONLY on the supplied transcript and timestamps — never invent words, and never return a time outside the transcript. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_ARTICLE =
  "You are a skilled editor who turns spoken talks, sermons, webinars and interviews into clear, engaging written articles. " +
  "You keep the speaker's subject matter, message and voice faithfully — you adopt the transcript's own topic and tone rather than forcing an unrelated agenda. " +
  "You clean up speech (remove filler, repetition and transcription glitches), organise the ideas into a logical flow with subheadings, and write in polished, readable prose. " +
  "You base everything ONLY on the supplied transcript — never invent facts, names, quotes, numbers, scripture references or links that are not supported by it. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

const SYSTEM_TXEMAIL =
  "You are an email copywriter who turns a talk or sermon transcript into a warm, well-structured email that shares its core message with an audience who could not attend. " +
  "You stay faithful to the transcript's topic, message and voice, and never invent facts, names, quotes, numbers, scripture references or links not supported by it. " +
  "You write a compelling subject line and preheader and a clean, skimmable body. " +
  "You ALWAYS return only valid, minified JSON matching the requested schema exactly — never any prose, markdown, or code fences.";

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

function buildWeeklyActionPrompt({ content }) {
  return `Here is the email that is going out to South African small-business owners.

EMAIL CONTENT:
"""
${content}
"""

Design ONE "Weekly Action" for this email — a single small step the reader can take this week, drawn straight from the content above. Make it genuinely doable in a few minutes, not a big project.

Rules: base it ONLY on the content — never invent facts, numbers, deadlines or offers. Warm, practical South African English. The poll options are for a one-tap reply (lowest friction), so keep them short.

Return ONLY minified JSON with this exact shape:
{"title":"a short action title, under 60 characters (e.g. Check your VAT registration status)","body":"1 to 2 sentences telling them exactly what to do this week and why it matters","poll":["2 to 4 very short one-tap reply options a reader could pick, each under 22 characters"]}`;
}

function buildSubjectsPrompt({ theme, content }) {
  return `Here is the email that is about to go out (theme first, then the body text).

THEME / BRIEF:
"""
${theme || "(not supplied — infer from the body)"}
"""

EMAIL BODY:
"""
${content}
"""

Write 5 subject-line options for this exact email, each a DIFFERENT angle so the user can pick the vibe:
1. curiosity — an open loop that makes them need to know
2. clear-benefit — the concrete win, stated plainly
3. question — a question the reader would answer "yes, that's me"
4. number/list — a specific number or list framing
5. contrarian — a mild pattern-interrupt or myth-bust

For EACH subject also write a matching preview text (the inbox snippet) that COMPLEMENTS the subject — it must add new information, never just repeat the subject.

Rules: base everything ONLY on the email content above — never invent facts, numbers, names or urgency. Warm, credible South African English. No clickbait. Subjects ideally 40-55 characters; preview text ideally 85-100 characters. Emojis optional and sparing (at most one).

Return ONLY minified JSON with this exact shape:
{"subjects":[{"angle":"curiosity","text":"the subject line","preview":"the complementary preview text"}]}`;
}

function buildEmailPrompt({ brief }) {
  return `Write this week's SME South Africa newsletter BODY from the brief below. Follow the house style and rules exactly, and use ONLY the links and facts that appear in the brief.

BRIEF:
${brief}

Return only the HTML fragment, starting with the intro paragraph. No greeting, no footer, no promo banners, no code fences, no commentary.`;
}

const VIDEO_PLATFORM_HINT = {
  LinkedIn: "LinkedIn: professional, insight-led, credible; a strong first line; minimal emojis; 1-3 niche hashtags is plenty.",
  Instagram: "Instagram: warm and conversational; a few emojis ok; punchy short lines; CTA to watch/save/share.",
  Facebook: "Facebook: friendly community tone; clear value; CTA to watch or share; light on hashtags.",
  X: "X/Twitter: concise and punchy; a strong standalone hook line; very few hashtags.",
  TikTok: "TikTok: native and casual, trend-aware; hook in the first 3 words; CTA to follow for more.",
};

function buildVideoCopyPrompt({ transcript, platform }) {
  const p = VIDEO_PLATFORM_HINT[platform] ? platform : "LinkedIn";
  const hint = VIDEO_PLATFORM_HINT[p];
  return `A short vertical video clip has been cut from an SME South Africa webinar. Below is its transcript.

TRANSCRIPT:
"""
${transcript}
"""

Write a social post to publish ALONGSIDE this video on ${p}. Audience: South African business owners and entrepreneurs. Tone: practical, energetic, credible, low hype. Write the caption in the SAME language as the transcript (do not translate to English); keep hashtags conventional. Base everything ONLY on the transcript — do not invent facts, names, numbers, dates, offers or links.

Return ONLY minified JSON with this exact shape:
{"caption":"2 to 4 short punchy lines of post copy, value-first, using \\n for line breaks, ending with a soft CTA to watch or follow; do NOT put hashtags inside the caption","hashtags":["8 to 12 relevant hashtags, no # symbol and no spaces"],"hooks":["3 alternative on-screen hook lines, each 4 to 8 words, designed to stop the scroll if overlaid on the opening of the video"],"imagePrompt":"a vivid, detailed prompt IN ENGLISH for an AI image generator to create one scroll-stopping visual that supports this post — describe the subject, setting, composition, style (default: photorealistic editorial photography), mood and lighting; feature South African people/context where relevant; the image must contain NO text, words, logos or watermarks"}

Platform guidance: ${hint}`;
}

function buildYtMetaPrompt({ transcript }) {
  return `Below is a video transcript (it may include timestamps like [1:23] or "1:23").

TRANSCRIPT:
"""
${transcript}
"""

Write YouTube metadata based ONLY on this transcript. Do not invent facts, names, numbers or links. Write titles, description and chapter titles in the SAME language as the transcript (do not translate to English).

Return ONLY minified JSON with this exact shape:
{"titles":["3 title options, each under 70 characters, specific and curiosity-driven but honest — no ALL CAPS, no clickbait"],"description":"a 3 to 5 short-paragraph description: a strong first two lines that work as the search snippet, then what the video covers and who it's for; plain text with \\n line breaks; no hashtags block","tags":["12 to 15 lowercase keyword tags a viewer might search, no # symbol"],"chapters":[{"time":"M:SS","title":"chapter title"}]}

Chapters: if the transcript has timestamps, use them for the chapter start times; otherwise infer 4 to 8 logical sections and estimate reasonable times. The FIRST chapter MUST be {"time":"0:00","title":"Intro"}. Order chapters by time.`;
}

function buildArticlePrompt({ transcript }) {
  return `Below is a transcript of a spoken talk (it may include timestamps like [1:23]). Turn it into a polished written article.

TRANSCRIPT:
"""
${transcript}
"""

Write a complete, publish-ready article that faithfully captures this talk's message, topic and voice. Remove filler, false starts, repetition and transcription glitches; fix grammar; organise the ideas into a clear flow with subheadings. Base everything ONLY on the transcript — do NOT invent facts, names, quotes, numbers, scripture references or links. Ignore the timestamps in the final prose. Write the article in the SAME language as the transcript (do not translate to English).

Requirements:
- The body MUST be AT LEAST 800 words (aim for 900 to 1300). Do not pad with fluff — expand by fully developing the ideas actually present in the transcript.
- Use simple HTML in the body: <p> paragraphs and <h2> subheadings only (no <html>, <head>, <h1>, inline styles, images or links).
- Open with a strong hook, develop the key points under 3 to 6 subheadings, and end with a clear takeaway.

Return ONLY minified JSON with this exact shape:
{"title":"a compelling article title, under 80 characters","dek":"a one-sentence standfirst that summarises the article, under 160 characters","body":"the full article as HTML using only <p> and <h2> tags, at least 800 words","tags":["5 to 8 lowercase topic tags, no # symbol"]}`;
}

function buildTxEmailPrompt({ transcript }) {
  return `Below is a transcript of a spoken talk (it may include timestamps like [1:23]). Turn it into an email that shares its message with people who could not attend.

TRANSCRIPT:
"""
${transcript}
"""

Write a warm, skimmable email that faithfully conveys this talk's core message, topic and voice. Base everything ONLY on the transcript — do NOT invent facts, names, quotes, numbers, scripture references or links. Ignore the timestamps in the final copy. Write the email in the SAME language as the transcript (do not translate to English).

Requirements:
- Body is simple HTML using only <p> paragraphs, <h2> subheadings and optionally one <blockquote> pull-quote (no <html>, <head>, images, inline styles or links).
- Roughly 250 to 450 words: a friendly opening, 2 to 4 short sections covering the key points, and a closing line. Do not invent a call-to-action link or event details.

Return ONLY minified JSON with this exact shape:
{"subject":"a compelling subject line under 60 characters","preview":"a preheader / preview line, 40 to 90 characters","body":"the email body as HTML using only <p>, <h2> and optionally one <blockquote>"}`;
}

function buildHighlightsPrompt({ transcript, count, minLen, maxLen, totalDur }) {
  return `A timestamped transcript of a webinar/talk is below. Timestamps are in SECONDS (start-end).

TRANSCRIPT:
"""
${transcript}
"""

The segment runs from 0 to ${totalDur} seconds.

TASK:
Find the ${count} most clip-worthy moments to cut as standalone vertical shorts. Each must be self-contained, open on a strong hook and end on a satisfying payoff, punchline or takeaway. Favour bold claims, surprising insights, practical tips, story beats or emotional lines. Aim for clips about ${minLen}-${maxLen} seconds long. Base everything ONLY on the transcript — never invent words.

Return ONLY minified JSON, no markdown, no commentary, exactly this shape:
{"highlights":[{"start":0,"end":0,"title":"","hook":"","reason":"","score":0}]}

REQUIREMENTS:
- start, end: numbers in SECONDS taken from the transcript timestamps; ${minLen} <= (end - start) <= ${maxLen}; both within 0..${totalDur}; clips must NOT overlap each other.
- title: <= 6 words naming the moment.
- hook: a scroll-stopping on-screen hook line for the clip's opening, 4-8 words, true to the moment.
- reason: why it will perform as a short, <= 16 words.
- score: integer 1-100 for how clip-worthy it is — use the FULL range and rank honestly, do not give everything the same score.
Order by score, highest first. Return at most ${count} (fewer if the transcript is too short to support more).`;
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

// ---- Providers live in _ai.js (multi-provider failover chain). ----

// ---- Local AI (Ollama) helpers: build the prompt for a task, and parse a raw completion.
// These reuse the SAME builders + sanitisers as the cloud path (single source of truth).
function buildForTask(task, body, voiceNote) {
  if (task === "copy") {
    const { offer, audience, platform, count = 5, winnerAngle } = body;
    if (!offer || !String(offer).trim()) return { error: "Missing offer" };
    return { system: SYSTEM, prompt: buildPrompt({ offer, audience, platform, count, winnerAngle }) + voiceNote, json: true, temperature: 0.85 };
  }
  if (task === "email") {
    const { brief } = body;
    if (!brief || !String(brief).trim()) return { error: "Missing brief" };
    return { system: SYSTEM_EMAIL, prompt: buildEmailPrompt({ brief }) + voiceNote, json: false, temperature: 0.7 };
  }
  return null; // task not supported for local AI (falls back to cloud on the client)
}
function parseForTask(task, text) {
  if (task === "copy") {
    const parsed = safeParse(text);
    if (!parsed || !Array.isArray(parsed.variations) || !parsed.variations.length) return { error: "Local model returned no usable variations — try again (or use a bigger model)." };
    const variations = parsed.variations.slice(0, 12).map((v) => ({
      framework: String(v.framework || "Angle").slice(0, 40),
      headline: String(v.headline || "").slice(0, 160),
      body: String(v.body || "").slice(0, 400),
      cta: String(v.cta || "").slice(0, 40),
      hashtags: cleanTags(v.hashtags),
      scores: { hook: clampScore(v.scores && v.scores.hook), clarity: clampScore(v.scores && v.scores.clarity), urgency: clampScore(v.scores && v.scores.urgency) },
    }));
    return { data: { variations } };
  }
  if (task === "email") {
    const html = String(text || "").replace(/```html\s*/gi, "").replace(/```/g, "").trim();
    if (!html) return { error: "Local model returned an empty email — try again." };
    return { data: { emailBody: html } };
  }
  return { error: "Unsupported task for local AI." };
}

export default async function handler(req, res) {
  if (await blocked(req, res, { id: "generate", limit: 30, windowSec: 60 })) return;
  if (await meter(req, res, { kind: "generate" })) return;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    // Multi-provider failover: try every configured free AI key in order; if one is rate-limited,
    // out of quota or down, fall over to the next. `provider` tracks whichever one actually served
    // (used for usage logging below).
    const llmKeys = resolveLlmKeys(req);
    const order = llmOrder();
    let provider = order.find((p) => llmKeys[p]) || "gemini";
    const callProvider = async (prompt, opts = {}) => {
      const out = await chatComplete(
        { system: opts.system || SYSTEM, prompt, temperature: opts.temperature, maxTokens: opts.maxTokens, json: opts.json },
        llmKeys, order
      );
      provider = out.provider;
      return out.text;
    };

    const task = String(body.task || "copy").toLowerCase();

    // Optional brand voice (from Studio → Brand Kit). Embodied in copy + email prompts.
    const brandVoice = String(body.brandVoice || "").slice(0, 800).trim();
    const voiceNote = brandVoice
      ? "\n\nBRAND VOICE — write ALL copy in exactly this voice and tone (embody it, don't describe it): " + brandVoice
      : "";

    // Volt Brain: inject what THIS org's real performance data has taught us (like voiceNote).
    let brainNote = "";
    try {
      const oid = req.volt && req.volt.orgId;
      if (oid && (task === "copy" || task === "email")) {
        const rows = await sbRest("org_insight?select=data&org_id=eq." + encodeURIComponent(oid) + "&kind=eq.summary&limit=1");
        const s = rows && rows[0] && rows[0].data;
        if (s && s.status === "ready") {
          const parts = [];
          if (s.do_more && s.do_more.length) parts.push("DO MORE (proven for this audience): " + s.do_more.join("; "));
          if (s.do_less && s.do_less.length) parts.push("AVOID (underperformed): " + s.do_less.join("; "));
          if (s.hooks && s.hooks.length) parts.push("Hook styles that landed: " + s.hooks.join("; "));
          if (parts.length) brainNote = "\n\nWHAT WORKS FOR THIS BRAND (from real performance data — weight heavily): " + parts.join(" | ");
        }
      }
    } catch (e) {}
    const promptExtras = voiceNote + brainNote;
    // Per-org publication identity — so email/video copy isn't hardcoded to "SME South Africa".
    const publication = String(body.publication || "").slice(0, 200).trim();
    const pubNote = publication ? "\n\nPUBLICATION IDENTITY — write this AS \"" + publication + "\" for their own audience; do NOT reference any other company or publication." : "";

    // ---- Local AI (Ollama) two-phase: server builds the prompt + parses the result;
    // the desktop app runs the actual generation on the user's local Ollama (free, offline).
    // Cloud path below is completely untouched.
    if (body.mode === "build") {
      const b = buildForTask(task, body, promptExtras);
      if (!b) return res.status(400).json({ error: "Local AI isn't wired for this tool yet." });
      if (b.error) return res.status(400).json({ error: b.error });
      return res.status(200).json(b);
    }
    if (body.mode === "parse") {
      const p = parseForTask(task, String(body.raw || ""));
      if (p.error) return res.status(p.status || 502).json({ error: p.error });
      return res.status(200).json(p.data);
    }

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
      const text = await callProvider(buildEmailPrompt({ brief }) + promptExtras + pubNote, { system: SYSTEM_EMAIL, json: false, temperature: 0.7, maxTokens: 3000 });
      let html = String(text || "").replace(/```html\s*/gi, "").replace(/```/g, "").trim();
      if (!html) return res.status(502).json({ error: "Model returned an empty body — try again." });
      const contentId = await logContent(req.volt && req.volt.orgId, {
        tool: "email", input: { brief: String(brief).slice(0, 2000) }, output: { emailBody: html.slice(0, 8000) },
        provider, model: process.env.GEMINI_MODEL || "gemini-2.5-flash", userId: req.volt && req.volt.user && req.volt.user.id,
      });
      return res.status(200).json({ emailBody: html, contentId });
    }

    // ---- Newsletter subject-line + preview-text options (re-engagement) ----
    if (task === "subjects") {
      const theme = String(body.theme || body.brief || "").slice(0, 2000);
      const content = String(body.content || body.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
      if (!content && !theme) return res.status(400).json({ error: "Build the email first, then suggest subjects." });
      const text = await callProvider(buildSubjectsPrompt({ theme, content }) + promptExtras, { system: SYSTEM_SUBJECTS, temperature: 0.85, maxTokens: 1200 });
      const sp = safeParse(text);
      const arr = Array.isArray(sp && sp.subjects) ? sp.subjects : [];
      const subjects = arr.map((s) => ({
        angle: String((s && s.angle) || "").slice(0, 24),
        text: String((s && s.text) || "").slice(0, 140),
        preview: String((s && s.preview) || "").slice(0, 160),
      })).filter((s) => s.text).slice(0, 6);
      if (!subjects.length) return res.status(502).json({ error: "Couldn't draft subject lines — try again." });
      return res.status(200).json({ subjects });
    }

    // ---- Newsletter Weekly Action suggestion (reads the email, proposes the ritual) ----
    if (task === "weeklyaction") {
      const content = String(body.content || body.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
      if (!content) return res.status(400).json({ error: "Build the email first, then suggest a Weekly Action." });
      const text = await callProvider(buildWeeklyActionPrompt({ content }) + promptExtras, { system: SYSTEM_WEEKLYACTION, temperature: 0.7, maxTokens: 600 });
      const wa = safeParse(text);
      if (!wa || !wa.title) return res.status(502).json({ error: "Couldn't draft a Weekly Action — try again." });
      const weeklyAction = {
        title: String(wa.title || "").slice(0, 100),
        body: String(wa.body || "").slice(0, 400),
        poll: strList(wa.poll, 4, 30),
      };
      return res.status(200).json({ weeklyAction });
    }

    // ---- Video → social post copy ----
    if (task === "videocopy") {
      const { transcript, platform } = body;
      if (!transcript || !String(transcript).trim()) {
        return res.status(400).json({ error: "No transcript — generate captions first." });
      }
      const text = await callProvider(
        buildVideoCopyPrompt({ transcript: String(transcript).slice(0, 6000), platform }),
        { system: SYSTEM_VIDEOCOPY, temperature: 0.7, maxTokens: 1200 }
      );
      const vp = safeParse(text);
      if (!vp) return res.status(502).json({ error: "Model returned unusable copy — try again." });
      const hashtags = Array.isArray(vp.hashtags)
        ? vp.hashtags.slice(0, 12).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "").slice(0, 30)).filter(Boolean)
        : [];
      const videocopy = {
        caption: String(vp.caption || "").slice(0, 1200),
        hashtags,
        hooks: strList(vp.hooks, 4, 80),
        imagePrompt: String(vp.imagePrompt || "").slice(0, 800),
      };
      if (!videocopy.caption && !videocopy.hashtags.length) {
        return res.status(502).json({ error: "Model returned empty copy — try again." });
      }
      return res.status(200).json({ videocopy });
    }

    // ---- VideoTok: YouTube metadata (titles/description/tags/chapters) from a transcript ----
    if (task === "ytmeta") {
      const { transcript } = body;
      if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: "Add a transcript first." });
      const text = await callProvider(
        buildYtMetaPrompt({ transcript: String(transcript).slice(0, 12000) }),
        { system: SYSTEM_YTMETA, temperature: 0.6, maxTokens: 1800 }
      );
      const m = safeParse(text);
      if (!m) return res.status(502).json({ error: "Model returned unusable metadata — try again." });
      const ytmeta = {
        titles: strList(m.titles, 3, 100),
        description: String(m.description || "").slice(0, 5000),
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 15).map((t) => String(t).replace(/^#/, "").trim().slice(0, 40)).filter(Boolean) : [],
        chapters: Array.isArray(m.chapters) ? m.chapters.slice(0, 20).map((c) => ({ time: String((c && c.time) || "").slice(0, 8), title: String((c && c.title) || "").slice(0, 100) })).filter((c) => c.title) : [],
      };
      if (!ytmeta.titles.length && !ytmeta.description) return res.status(502).json({ error: "Empty metadata — try again." });
      await logContent(req.volt && req.volt.orgId, { tool: "ytmeta", input: { len: String(transcript).length }, output: ytmeta, provider, model: process.env.GEMINI_MODEL || "gemini-2.5-flash", userId: req.volt && req.volt.user && req.volt.user.id });
      return res.status(200).json({ ytmeta });
    }

    // ---- Transcribe: full written article (>=800 words) from a transcript ----
    if (task === "article") {
      const { transcript } = body;
      if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: "Add a transcript first." });
      const cleanBody = (h) => String(h || "").replace(/```[a-z]*|```/gi, "").replace(/<(?!\/?(?:p|h2|h3|ul|ol|li|blockquote|strong|em|br)\b)[^>]*>/gi, "").trim();
      const wordCount = (h) => (String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().match(/\S+/g) || []).length;
      const basePrompt = buildArticlePrompt({ transcript: String(transcript).slice(0, 14000) });
      // Up to 2 attempts: if the model under-runs the 800-word floor, retry once with an explicit nudge.
      let article = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const shortNote = attempt === 0 ? "" :
          `\n\nYOUR PREVIOUS ATTEMPT WAS ONLY ${article.words} WORDS — TOO SHORT. Rewrite it LONGER, at least 800 words (aim 1000+), by more fully developing the ideas already in the transcript. Do not add invented facts.`;
        const text = await callProvider(basePrompt + shortNote + promptExtras, { system: SYSTEM_ARTICLE, temperature: 0.6, maxTokens: 4096 });
        const a = safeParse(text);
        if (!a) { if (attempt) break; else continue; }
        const cand = {
          title: String(a.title || "").slice(0, 120),
          dek: String(a.dek || "").slice(0, 200),
          body: cleanBody(a.body).slice(0, 20000),
          tags: Array.isArray(a.tags) ? a.tags.slice(0, 8).map((t) => String(t).replace(/^#/, "").trim().slice(0, 40)).filter(Boolean) : [],
        };
        cand.words = wordCount(cand.body);
        // Keep the longer of the two attempts so a retry never makes things worse.
        if (!article || cand.words > article.words) article = cand;
        if (cand.words >= 800) break;
      }
      if (!article || !article.body || article.words < 200) return res.status(502).json({ error: "Article came back too short — try again." });
      await logContent(req.volt && req.volt.orgId, { tool: "article", input: { len: String(transcript).length }, output: { title: article.title, words: article.words }, provider, model: process.env.GEMINI_MODEL || "gemini-2.5-flash", userId: req.volt && req.volt.user && req.volt.user.id });
      return res.status(200).json({ article });
    }

    // ---- Transcribe: email newsletter from a transcript ----
    if (task === "transcriptemail") {
      const { transcript } = body;
      if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: "Add a transcript first." });
      const cleanBody = (h) => String(h || "").replace(/```[a-z]*|```/gi, "").replace(/<(?!\/?(?:p|h2|h3|ul|ol|li|blockquote|strong|em|br)\b)[^>]*>/gi, "").trim();
      const text = await callProvider(
        buildTxEmailPrompt({ transcript: String(transcript).slice(0, 14000) }) + promptExtras,
        { system: SYSTEM_TXEMAIL, temperature: 0.7, maxTokens: 2200 }
      );
      const e = safeParse(text);
      if (!e) return res.status(502).json({ error: "Model returned an unusable email — try again." });
      const email = {
        subject: String(e.subject || "").slice(0, 120),
        preview: String(e.preview || "").slice(0, 160),
        body: cleanBody(e.body).slice(0, 12000),
      };
      if (!email.subject && !email.body) return res.status(502).json({ error: "Email came back empty — try again." });
      await logContent(req.volt && req.volt.orgId, { tool: "transcriptemail", input: { len: String(transcript).length }, output: { subject: email.subject }, provider, model: process.env.GEMINI_MODEL || "gemini-2.5-flash", userId: req.volt && req.volt.user && req.volt.user.id });
      return res.status(200).json({ email });
    }

    // ---- Auto-highlight: rank the most clip-worthy moments from a timestamped transcript ----
    if (task === "highlights") {
      const { transcript, count, minLen, maxLen, totalDur } = body;
      if (!transcript || !String(transcript).trim()) {
        return res.status(400).json({ error: "No transcript — generate captions first." });
      }
      const n = Math.max(1, Math.min(8, parseInt(count, 10) || 4));
      const lo = Math.max(5, Math.min(60, parseInt(minLen, 10) || 15));
      const hi = Math.max(lo + 3, Math.min(120, parseInt(maxLen, 10) || 40));
      const dur = Math.max(0, Number(totalDur) || 0);
      const text = await callProvider(
        buildHighlightsPrompt({ transcript: String(transcript).slice(0, 12000), count: n, minLen: lo, maxLen: hi, totalDur: Math.round(dur) || 0 }),
        { system: SYSTEM_HIGHLIGHTS, temperature: 0.5, maxTokens: 1600 }
      );
      const hp = safeParse(text);
      const arr = Array.isArray(hp && hp.highlights) ? hp.highlights : [];
      const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
      const highlights = arr
        .map((h) => {
          let s = num(h && h.start), e = num(h && h.end);
          if (s == null || e == null) return null;
          s = Math.max(0, s); e = Math.max(s + 1, e);
          if (dur) { s = Math.min(s, dur); e = Math.min(e, dur); }
          if (e - s < 1) return null;
          return {
            start: Math.round(s * 10) / 10,
            end: Math.round(e * 10) / 10,
            title: String((h && h.title) || "").slice(0, 60),
            hook: String((h && h.hook) || "").slice(0, 90),
            reason: String((h && h.reason) || "").slice(0, 160),
            score: clamp100(h && h.score),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, n);
      if (!highlights.length) {
        return res.status(502).json({ error: "Couldn't find clear highlights — try a longer or clearer clip." });
      }
      return res.status(200).json({ highlights });
    }

    // ---- Ad copy (default) ----
    const { offer, audience, platform, count = 5, winnerAngle } = body;
    if (!offer || !String(offer).trim()) return res.status(400).json({ error: "Missing offer" });

    const prompt = buildPrompt({ offer, audience, platform, count, winnerAngle }) + promptExtras;
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

    const contentId = await logContent(req.volt && req.volt.orgId, {
      tool: "copy",
      input: { offer, audience, platform, winnerAngle },
      output: { variations },
      provider, model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      userId: req.volt && req.volt.user && req.volt.user.id,
    });
    return res.status(200).json({ variations, contentId });
  } catch (err) {
    return res.status(500).json({ error: (err && err.message) || "Server error" });
  }
}
