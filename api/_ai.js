// Volt — multi-provider LLM failover. © 2026 Tshepho Joel.
// Tries free AI providers in order; if one errors (rate limit, quota, bad key, overload) it
// falls over to the next provider that has a key. Add a key → it automatically joins the chain.
//
// Keys: the desktop sends per-user keys as headers (x-<provider>-key); the web falls back to
// Vercel env (<PROVIDER>_API_KEY). Order is configurable via LLM_ORDER (comma list) or the
// single legacy LLM_PROVIDER; anything unlisted is appended so there's always a fallback.

// OpenAI-compatible providers (same /chat/completions schema) — only the base URL + model differ.
const OAI = {
  groq:       { base: "https://api.groq.com/openai/v1",   env: "GROQ_MODEL",       def: "llama-3.3-70b-versatile",                json: true,  label: "Groq" },
  cerebras:   { base: "https://api.cerebras.ai/v1",        env: "CEREBRAS_MODEL",   def: "llama-3.3-70b",                          json: true,  label: "Cerebras" },
  openrouter: { base: "https://openrouter.ai/api/v1",      env: "OPENROUTER_MODEL", def: "meta-llama/llama-3.3-70b-instruct:free", json: false, label: "OpenRouter" },
  mistral:    { base: "https://api.mistral.ai/v1",         env: "MISTRAL_MODEL",    def: "mistral-small-latest",                   json: true,  label: "Mistral" },
  openai:     { base: "https://api.openai.com/v1",         env: "OPENAI_MODEL",     def: "gpt-4o-mini",                            json: true,  label: "OpenAI" },
};

// Default try-order: most reliable free providers first, flaky-free (OpenRouter's :free models)
// near the end, paid (openai) last.
const DEFAULT_ORDER = ["gemini", "gemini2", "groq", "cerebras", "mistral", "openrouter", "openai"];

function hdr(req, name) { try { return req && req.headers && req.headers[name] ? String(req.headers[name]).trim() : ""; } catch (e) { return ""; } }

function resolveLlmKeys(req) {
  return {
    gemini:     hdr(req, "x-gemini-key")     || process.env.GEMINI_API_KEY     || "",
    gemini2:    hdr(req, "x-gemini-key-2")   || process.env.GEMINI_API_KEY_2   || "",
    groq:       hdr(req, "x-groq-key")       || process.env.GROQ_API_KEY       || "",
    cerebras:   hdr(req, "x-cerebras-key")   || process.env.CEREBRAS_API_KEY   || "",
    openrouter: hdr(req, "x-openrouter-key") || process.env.OPENROUTER_API_KEY || "",
    mistral:    hdr(req, "x-mistral-key")    || process.env.MISTRAL_API_KEY    || "",
    openai:     hdr(req, "x-openai-key")     || process.env.OPENAI_API_KEY     || "",
    claude:     hdr(req, "x-claude-key")     || process.env.CLAUDE_API_KEY     || "",
  };
}

function llmOrder() {
  const raw = String(process.env.LLM_ORDER || process.env.LLM_PROVIDER || "").toLowerCase().trim();
  if (!raw) return DEFAULT_ORDER.slice();
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return wanted.concat(DEFAULT_ORDER.filter((p) => !wanted.includes(p))); // listed first, defaults as fallback
}

async function callGemini(key, { system, prompt, temperature, maxTokens, json }) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system || "" }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: Object.assign(
      { temperature: temperature != null ? temperature : 0.9, maxOutputTokens: maxTokens || 4096, thinkingConfig: { thinkingBudget: 0 } },
      json === false ? {} : { responseMimeType: "application/json" }
    ),
  });
  // Gemini free tier throws transient 503 "overloaded" / 429 quote-per-minute — retry a couple
  // of times with backoff before giving up and letting the chain fall over to the next provider.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 600 * attempt));
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: payload });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      return { text: parts.map((p) => p.text || "").join(""), model };
    }
    const msg = (data && data.error && data.error.message) || ("Gemini " + r.status);
    lastErr = new Error(msg); lastErr.status = r.status;
    if (!(r.status === 503 || r.status === 429 || /overload|unavailable|exhausted|try again|high demand|resource/i.test(msg))) break;
  }
  throw lastErr || new Error("Gemini request failed");
}

async function callOpenAICompat(name, key, { system, prompt, temperature, maxTokens, json }) {
  const cfg = OAI[name];
  const model = process.env[cfg.env] || cfg.def;
  const bodyObj = {
    model,
    temperature: temperature != null ? temperature : 0.9,
    max_tokens: maxTokens || 4096,
    messages: [{ role: "system", content: system || "" }, { role: "user", content: prompt }],
  };
  if (cfg.json && json !== false) bodyObj.response_format = { type: "json_object" };
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + key };
  if (name === "openrouter") { headers["HTTP-Referer"] = "https://tshephos-lab.vercel.app"; headers["X-Title"] = "Volt"; }
  const r = await fetch(cfg.base + "/chat/completions", { method: "POST", headers, body: JSON.stringify(bodyObj) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const m = data && data.error && (data.error.message || data.error); const e = new Error((typeof m === "string" ? m : null) || (cfg.label + " " + r.status)); e.status = r.status; throw e; }
  return { text: (((data.choices || [])[0] || {}).message || {}).content || "", model };
}

async function callClaude(key, { system, prompt, maxTokens }) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens || 2000, system: system || "", messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data && data.error && data.error.message) || ("Claude " + r.status)); e.status = r.status; throw e; }
  return { text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""), model };
}

async function callOne(name, key, opts) {
  if (name === "gemini" || name === "gemini2") return callGemini(key, opts);
  if (name === "claude") return callClaude(key, opts);
  if (OAI[name]) return callOpenAICompat(name, key, opts);
  throw new Error("Unknown AI provider: " + name);
}

// Try each keyed provider in order. Returns { text, provider, model }. Throws if all fail.
async function chatComplete(opts, keys, order) {
  const chain = (order && order.length ? order : DEFAULT_ORDER).filter((p) => keys && keys[p]);
  if (!chain.length) { const e = new Error("No AI key configured. Add a Gemini, Groq, Cerebras, OpenRouter, Mistral or OpenAI key in Settings."); e.code = "NO_AI_KEY"; throw e; }
  let lastErr; const tried = [];
  for (const name of chain) {
    tried.push(name);
    try {
      const out = await callOne(name, keys[name], opts);
      if (out && out.text && out.text.trim()) return { text: out.text, provider: name, model: out.model };
      lastErr = new Error(name + " returned an empty response");
    } catch (e) { lastErr = e; } // any failure → fall over to the next provider
  }
  // All providers failed — give a clean, human message (never the raw upstream/quota dump).
  const detail = (lastErr && lastErr.message) ? lastErr.message : "";
  const isLimit = /rate limit|quota|exceeded|too many|429|per day|\bTPD\b|\bRPD\b|resource has been exhausted/i.test(detail);
  const retry = (detail.match(/try again in\s+([0-9hms.\s]+?)[.)]/i) || [])[1];
  let msg;
  if (isLimit) {
    msg = "You’ve reached today’s free AI limit" + (retry ? " — it resets in about " + retry.trim() : "") +
      ". Add another free key (a 2nd Gemini, Groq or Cerebras) in Settings to keep going — or come back a bit later. Your saved drafts are still available.";
  } else {
    msg = "AI is busy right now — every provider was unavailable for a moment. Wait a minute and try again, or add another free key in Settings.";
  }
  const e = new Error(msg);
  e.code = isLimit ? "RATE_LIMIT" : "ALL_PROVIDERS_FAILED";
  throw e;
}

// ---- Provider / model availability probe ---------------------------------------------------
// Model ids are pinned defaults (gemini-2.5-flash, llama-3.3-70b-versatile, …) and providers retire
// models on roughly annual cycles. When that happens the only signal today is a user complaint.
// This lists each provider's CURRENTLY AVAILABLE models and checks the pinned id is still among
// them. It uses the free list endpoints — no generation, no tokens, no spend — so it is safe to run
// on every health check.
const LIST_URL = {
  gemini:     () => "https://generativelanguage.googleapis.com/v1beta/models",
  gemini2:    () => "https://generativelanguage.googleapis.com/v1beta/models",
  groq:       () => OAI.groq.base + "/models",
  cerebras:   () => OAI.cerebras.base + "/models",
  openrouter: () => OAI.openrouter.base + "/models",
  mistral:    () => OAI.mistral.base + "/models",
  openai:     () => OAI.openai.base + "/models",
};
function pinnedModel(p) {
  if (p === "gemini" || p === "gemini2") return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const c = OAI[p];
  return c ? (process.env[c.env] || c.def) : null;
}
async function probeProviders(req) {
  const keys = resolveLlmKeys(req);
  const order = llmOrder();
  const out = [];
  await Promise.all(order.map(async (p) => {
    const key = keys[p];
    const model = pinnedModel(p);
    if (!key) { out.push({ provider: p, configured: false, model }); return; }
    const url = LIST_URL[p] && LIST_URL[p]();
    if (!url) { out.push({ provider: p, configured: true, model, reachable: null, note: "no list endpoint" }); return; }
    try {
      const headers = (p === "gemini" || p === "gemini2") ? { "x-goog-api-key": key } : { Authorization: "Bearer " + key };
      const r = await fetch(url, { headers });
      if (!r.ok) { out.push({ provider: p, configured: true, model, reachable: false, error: "HTTP " + r.status }); return; }
      const d = await r.json().catch(() => ({}));
      // Gemini returns {models:[{name:"models/gemini-2.5-flash"}]}, OpenAI-compatible {data:[{id}]}
      const ids = (d.models || d.data || []).map((m) => String(m.id || m.name || "").replace(/^models\//, ""));
      const has = ids.some((id) => id === model || id.startsWith(model));
      out.push({ provider: p, configured: true, model, reachable: true, modelAvailable: has, modelCount: ids.length });
    } catch (e) {
      out.push({ provider: p, configured: true, model, reachable: false, error: (e && e.message) || "network error" });
    }
  }));
  // Keep the caller's failover order — "which one serves first" is the useful reading.
  out.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  const live = out.filter((p) => p.configured && p.reachable && p.modelAvailable !== false);
  return {
    order,
    providers: out,
    configured: out.filter((p) => p.configured).length,
    healthy: live.length,
    retired: out.filter((p) => p.configured && p.modelAvailable === false).map((p) => p.provider + ":" + p.model),
  };
}

export { chatComplete, resolveLlmKeys, llmOrder, DEFAULT_ORDER, probeProviders };
