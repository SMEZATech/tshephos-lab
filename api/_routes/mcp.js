// Volt — MCP (Model Context Protocol) server. © 2026 Tshepho Joel.
// Lets any MCP-compatible AI tool (Claude Desktop, Claude Code, ChatGPT, …) connect to Volt and
// generate on-brand content: ad/post copy, newsletter section copy, and reading the saved Brand
// Kit so a connected tool writes in the real voice instead of guessing.
//
// DELIBERATELY GENERATE-ONLY. No tool here can publish a post, change a setting, or touch account
// state — an AI tool holding this key can draft content, never act on Joel's behalf on a live
// platform. See BLUEPRINT.html's MCP entry for why that line was drawn there.
//
// Studio's canvas designs are NOT exposed here either, and that's a real architectural limit, not
// a scope choice: studio-engine.js draws on an OffscreenCanvas inside a browser Worker — there is
// no server-side renderer to call. Exposing "generate a Studio image" over MCP would need an
// actual headless-rendering service (e.g. running the engine under node-canvas or a headless
// browser), which is a real, separate build — flagged as a future item, not silently promised.
//
// AUTH: not a Supabase session — an MCP client can't do a browser OAuth dance against Supabase.
// A separate long-lived personal API key instead (sql/api_key.sql), minted from
// Admin → AI Tools (MCP). One key per org, hashed at rest, shown once at creation.
//
// TRANSPORT: MCP "Streamable HTTP", stateless mode. Every call is one JSON-RPC 2.0 request
// answered with one JSON-RPC response — no SSE stream, no session id. This server never needs to
// push anything to the client unprompted, so the stateful half of the spec doesn't apply; the spec
// explicitly allows a server that only needs request/response to skip it.
// Client setup: POST https://tshephos-lab.vercel.app/api/mcp, header
// Authorization: Bearer <key>. See SETUP-MCP.md.

import crypto from "crypto";
import { setCors, blocked, rateLimit, sbRest, sbWrite, sbPatch, logContent } from "../_guard.js";
import { chatComplete, resolveLlmKeys, llmOrder } from "../_ai.js";
import { SYSTEM, SYSTEM_EMAIL, buildPrompt, buildEmailPrompt, safeParse } from "../generate.js";

const PROTOCOL_VERSION = "2025-06-18";
const KEY_PREFIX = "sk_volt_";

const clampScore = (n) => { const x = Math.round(Number(n)); return Number.isFinite(x) ? Math.max(1, Math.min(10, x)) : 5; };
const cleanTags = (arr) => Array.isArray(arr) ? arr.slice(0, 8).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "").slice(0, 30)).filter(Boolean) : [];

const TOOLS = [
  {
    name: "generate_ad_copy",
    description: "Generate several on-brand ad/social post copy variations (framework, headline, body, CTA, hashtags, 1-10 scores). Uses this Volt account's active Brand Kit voice automatically — call get_brand_kit first if you want to see it.",
    inputSchema: {
      type: "object",
      properties: {
        offer: { type: "string", description: "What's being promoted — the product, service, article or event." },
        audience: { type: "string", description: "Who this is for, e.g. \"South African SME owners in retail\"." },
        platform: { type: "string", description: "Target platform: Meta, Instagram, Facebook, LinkedIn, or Google." },
        count: { type: "integer", minimum: 1, maximum: 12, description: "How many variations to generate (default 5)." },
      },
      required: ["offer"],
    },
  },
  {
    name: "generate_email_copy",
    description: "Generate the body HTML for one SME South Africa newsletter section from a brief. Returns a plain HTML fragment (h2/p/a tags only, no <html>/<head>/<body>) in the newsletter's established voice — never invents facts, links or figures beyond the brief.",
    inputSchema: {
      type: "object",
      properties: { brief: { type: "string", description: "What this section should cover — topic, key points, and any real links or facts to include." } },
      required: ["brief"],
    },
  },
  {
    name: "get_brand_kit",
    description: "Read this Volt account's saved Brand Kit(s) — colours, tagline, CTA, URL and a voice/tone description for each brand, plus which one is active. Call this before writing copy by hand so it matches the real brand voice instead of guessing.",
    inputSchema: { type: "object", properties: {} },
  },
];

function rpcOk(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } }; }
function toolResult(id, text) { return rpcOk(id, { content: [{ type: "text", text: String(text) }], isError: false }); }
function toolError(id, message) { return rpcOk(id, { content: [{ type: "text", text: String(message) }], isError: true }); }

async function resolveApiKey(raw) {
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = await sbRest("api_key?select=id,org_id,user_id,revoked_at&limit=1&key_hash=eq." + encodeURIComponent(hash));
  const row = rows && rows[0];
  if (!row || row.revoked_at) return null;
  await sbPatch("api_key", "id=eq." + encodeURIComponent(row.id), { last_used_at: new Date().toISOString() });
  return { orgId: row.org_id, userId: row.user_id };
}

async function activeBrandVoice(orgId) {
  try {
    const rows = await sbRest("project?select=data&org_id=eq." + encodeURIComponent(orgId) + "&type=eq.brandkit&limit=1");
    const data = rows && rows[0] && rows[0].data;
    const brands = (data && Array.isArray(data.brands)) ? data.brands : [];
    const active = brands.find((b) => b && b.id === data.active) || brands[0];
    return active && active.voice ? String(active.voice).slice(0, 800) : "";
  } catch (e) { return ""; }
}

async function callTool(req, msg, ctx) {
  const name = msg.params && msg.params.name;
  const args = (msg.params && msg.params.arguments) || {};

  if (name === "get_brand_kit") {
    const rows = await sbRest("project?select=data,updated_at&org_id=eq." + encodeURIComponent(ctx.orgId) + "&type=eq.brandkit&limit=1");
    const data = rows && rows[0] && rows[0].data;
    if (!data || !Array.isArray(data.brands) || !data.brands.length) {
      return toolResult(msg.id, "No Brand Kit saved yet for this account — set one up in Volt → Studio → Brand Kit.");
    }
    return toolResult(msg.id, JSON.stringify(data, null, 2));
  }

  if (name === "generate_ad_copy") {
    const offer = String(args.offer || "").trim();
    if (!offer) return toolError(msg.id, "Missing required argument: offer");
    const count = Math.max(1, Math.min(12, Number(args.count) || 5));
    const brandVoice = await activeBrandVoice(ctx.orgId);
    const voiceNote = brandVoice ? "\n\nBRAND VOICE — write ALL copy in exactly this voice and tone (embody it, don't describe it): " + brandVoice : "";
    const prompt = buildPrompt({ offer, audience: args.audience, platform: args.platform, count }) + voiceNote;
    const out = await chatComplete({ system: SYSTEM, prompt, temperature: 0.85, json: true }, resolveLlmKeys(req), llmOrder());
    const parsed = safeParse(out.text);
    const variations = Array.isArray(parsed && parsed.variations)
      ? parsed.variations.slice(0, count).map((v) => ({
          framework: String((v && v.framework) || "Angle").slice(0, 40),
          headline: String((v && v.headline) || "").slice(0, 160),
          body: String((v && v.body) || "").slice(0, 400),
          cta: String((v && v.cta) || "").slice(0, 40),
          hashtags: cleanTags(v && v.hashtags),
          scores: {
            hook: clampScore(v && v.scores && v.scores.hook),
            clarity: clampScore(v && v.scores && v.scores.clarity),
            urgency: clampScore(v && v.scores && v.scores.urgency),
          },
        })).filter((v) => v.headline)
      : [];
    if (!variations.length) return toolError(msg.id, "Model returned no usable copy — try again.");
    await logContent(ctx.orgId, { tool: "mcp:generate_ad_copy", input: { offer, audience: args.audience, platform: args.platform }, output: { count: variations.length }, provider: out.provider, model: out.model, userId: ctx.userId });
    return toolResult(msg.id, JSON.stringify({ variations }, null, 2));
  }

  if (name === "generate_email_copy") {
    const brief = String(args.brief || "").trim();
    if (!brief) return toolError(msg.id, "Missing required argument: brief");
    const out = await chatComplete({ system: SYSTEM_EMAIL, prompt: buildEmailPrompt({ brief }), temperature: 0.7 }, resolveLlmKeys(req), llmOrder());
    await logContent(ctx.orgId, { tool: "mcp:generate_email_copy", input: { brief: brief.slice(0, 200) }, output: { chars: out.text.length }, provider: out.provider, model: out.model, userId: ctx.userId });
    return toolResult(msg.id, out.text);
  }

  return rpcErr(msg.id, -32602, "Unknown tool: " + name);
}

async function handleRpc(req, res, msg) {
  const rl = await rateLimit(req, { id: "mcp-rpc", limit: 60, windowSec: 60 });
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  if (!rl.ok) return res.status(429).json({ error: "Too many requests — please slow down and try again in a minute." });

  const auth = req.headers["authorization"] || "";
  const rawKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const ctx = rawKey ? await resolveApiKey(rawKey) : null;
  if (!ctx) {
    return res.status(401).json({ error: "Missing or invalid API key. Generate one in Volt → Admin → AI Tools (MCP), then set it as the Authorization: Bearer header." });
  }

  // A notification (no id) gets no JSON-RPC response by spec — just acknowledge receipt.
  if (msg.id === undefined || msg.id === null) { res.status(202).end(); return; }

  try {
    if (msg.method === "initialize") {
      return res.status(200).json(rpcOk(msg.id, {
        protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "volt", title: "Volt Marketing Suite", version: "1.0.0" },
      }));
    }
    if (msg.method === "ping") return res.status(200).json(rpcOk(msg.id, {}));
    if (msg.method === "tools/list") return res.status(200).json(rpcOk(msg.id, { tools: TOOLS }));
    if (msg.method === "tools/call") return res.status(200).json(await callTool(req, msg, ctx));
    return res.status(200).json(rpcErr(msg.id, -32601, "Method not found: " + msg.method));
  } catch (e) {
    return res.status(200).json(rpcErr(msg.id, -32603, (e && e.message) || "Internal error"));
  }
}

// ---- Key management (normal Supabase session auth — same as every other Volt page) ----
export default async function handler(req, res) {
  if (req.method === "POST") {
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) { body = {}; }
    if (body && body.jsonrpc === "2.0") {
      setCors(req, res, "POST, OPTIONS");
      return handleRpc(req, res, body);
    }
    req._parsedBody = body; // avoid re-parsing below
  }

  // blocked() only checks a single exact method, so GET/POST/OPTIONS are all let through manually
  // here — passing req.method itself as the expected method would make the check a no-op for
  // EVERY verb. OPTIONS still has to reach blocked() below (it's what answers the CORS preflight).
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "OPTIONS") {
    setCors(req, res, "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method, id: "mcp-admin", limit: 20, windowSec: 60 })) return;

  try {
    if (req.method === "GET") {
      const rows = await sbRest("api_key?select=label,created_at,last_used_at,revoked_at&order=created_at.desc&limit=1&org_id=eq." + encodeURIComponent(req.volt.orgId));
      const row = rows && rows[0] && !rows[0].revoked_at ? rows[0] : null;
      return res.status(200).json({ key: row ? { label: row.label, created_at: row.created_at, last_used_at: row.last_used_at } : null });
    }

    const body = req._parsedBody || {};
    const op = String(body.op || "");
    if (op === "create" || op === "rotate") {
      // Revoke any existing key first — one active key per org keeps "who can call the API" a
      // single answerable question, and rotating is the only way to invalidate a leaked key.
      await sbPatch("api_key", "org_id=eq." + encodeURIComponent(req.volt.orgId) + "&revoked_at=is.null", { revoked_at: new Date().toISOString() });
      const raw = KEY_PREFIX + crypto.randomBytes(24).toString("hex");
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const rows = await sbWrite("api_key", { org_id: req.volt.orgId, user_id: req.volt.user.id, key_hash: hash, label: String(body.label || "Default").slice(0, 60) });
      if (!rows || !rows[0]) return res.status(502).json({ error: "Could not create a key — try again." });
      return res.status(200).json({ key: raw, created_at: rows[0].created_at }); // shown ONCE, never retrievable again
    }
    if (op === "revoke") {
      await sbPatch("api_key", "org_id=eq." + encodeURIComponent(req.volt.orgId) + "&revoked_at=is.null", { revoked_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown op." });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "MCP admin error" });
  }
}
