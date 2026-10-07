// Run by smoke.cjs. The AI provider chain's time budget, cooldown and retry rules, against fake providers.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.AI_CALL_TIMEOUT_MS = "250";       // so "hangs forever" is testable in a quarter of a second
process.env.AI_TOTAL_DEADLINE_MS = "900";
const ai = await import(pathToFileURL(path.join(ROOT, "api/_ai.js")).href);
const origWarn = console.warn; let warns = []; console.warn = (...a) => { warns.push(a.join(" ")); };

// A scriptable fake of the providers' HTTP APIs. Each behaviour is keyed by hostname.
let hits = {}; let behave = {};
const ok = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }], candidates: [{ content: { parts: [{ text }] } }] }) });
const err = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) });
globalThis.fetch = (url, init = {}) => {
  const host = new URL(url).hostname; hits[host] = (hits[host] || 0) + 1;
  const b = behave[host] || (() => ok("fine"));
  return new Promise((resolve, reject) => {
    if (init.signal) init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    Promise.resolve(b()).then(resolve, reject);
  });
};
const GEMINI = "generativelanguage.googleapis.com", GROQ = "api.groq.com", CEREBRAS = "api.cerebras.ai";
const keys = { gemini: "k1", groq: "k2", cerebras: "k3" };
const opts = { system: "s", prompt: "p" };
const reset = () => { hits = {}; behave = {}; warns = []; ai._aiCooldown.clear(); };

let pass = 0, fail = 0;
function expect(name, cond, detail) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail)); } }

console.log("Time budget:");
reset(); behave[GEMINI] = () => new Promise(() => {});           // accepts the connection, never answers
let t0 = Date.now(); let r = await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("a provider that hangs forever is cut off and the next one answers", r.provider === "groq" && Date.now() - t0 < 700, { provider: r.provider, ms: Date.now() - t0 });

reset(); behave[GEMINI] = () => new Promise(() => {}); behave[GROQ] = () => new Promise(() => {}); behave[CEREBRAS] = () => new Promise(() => {});
t0 = Date.now(); let e1 = null; try { await ai.chatComplete(opts, keys, ["gemini", "groq", "cerebras"]); } catch (e) { e1 = e; }
expect("if EVERY provider hangs it ends with the friendly 'AI is busy' error, not a platform timeout", e1 && e1.code === "ALL_PROVIDERS_FAILED" && /busy/i.test(e1.message) && Date.now() - t0 < 1500, { code: e1 && e1.code, ms: Date.now() - t0 });

console.log("Retries and cooldown:");
reset(); behave[GEMINI] = () => err(429, "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 250 per day");
r = await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("a spent DAILY quota is not retried (it can't recover in 600 ms)", hits[GEMINI] === 1 && r.provider === "groq", { geminiHits: hits[GEMINI], provider: r.provider });

reset(); let n = 0; behave[GEMINI] = () => (++n < 2 ? err(503, "The model is overloaded. Please try again later.") : ok("recovered"));
r = await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("a momentary overload IS still retried", r.provider === "gemini" && hits[GEMINI] === 2, { hits: hits[GEMINI], provider: r.provider });

reset(); behave[GEMINI] = () => err(429, "quota exceeded, limit: 250 per day");
await ai.chatComplete(opts, keys, ["gemini", "groq"]); hits = {};
r = await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("a provider that just hit its limit is SKIPPED on the next request (no hammering a dead provider)", !hits[GEMINI] && r.provider === "groq", { hits, provider: r.provider });

reset(); behave[GEMINI] = () => err(429, "quota exceeded per day"); behave[GROQ] = () => err(503, "overloaded");
let e2 = null; try { await ai.chatComplete(opts, { gemini: "k", groq: "k" }, ["gemini", "groq"]); } catch (e) { e2 = e; }
hits = {}; behave[GEMINI] = () => ok("back"); behave[GROQ] = () => ok("back");
r = await ai.chatComplete(opts, { gemini: "k", groq: "k" }, ["gemini", "groq"]);
expect("when EVERY provider is cooling down they are all still tried (never a dead end)", !!r.text && (hits[GEMINI] || hits[GROQ]), { hits, provider: r.provider });

reset(); behave[GEMINI] = () => err(400, "API key not valid");
r = await ai.chatComplete(opts, keys, ["gemini", "groq"]); hits = {};
await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("a bad-request failure is NOT put on cooldown (only limits/overload/timeouts are)", hits[GEMINI] === 1, hits);

console.log("Observability:");
reset(); behave[GEMINI] = () => err(429, "quota exceeded per day");
await ai.chatComplete(opts, keys, ["gemini", "groq"]);
expect("each failure is logged with the provider and status, and never with a key or the prompt", warns.some((w) => /\[ai\] gemini failed: 429/.test(w)) && !warns.some((w) => /k1|k2|"p"/.test(w)), warns);

console.warn = origWarn;
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
