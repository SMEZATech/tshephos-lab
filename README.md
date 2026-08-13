# Tshepho's Lab

> **⚠️ This README describes an early, single-tool version of the project.** Volt has since
> grown into an 11-tool suite (Copy, Campaign, Studio, Freeform, Video, SmartClip, Transcribe,
> Email, Schedule, Stats) with real auth (Supabase) and a routed API — the deploy steps below
> (Gemini-key-only, no auth) are no longer how this repo actually runs. For current architecture
> and state, read **[`BLUEPRINT.html`](BLUEPRINT.html)** first. This file is kept as-is rather
> than rewritten blind; happy to rebuild it properly in its own session once BLUEPRINT.html's
> env-var/setup section has been verified end-to-end.

An ad creative engine: drop in an offer and get a ranked batch of ad angles, each written and graded on hook, clarity, and urgency. Runs on a **free** AI API key — no ongoing cost.

© 2026 Tshepho Joel. All rights reserved.

---

## What's inside

```
tshephos-lab/
├── index.html        # the app (UI + logic, no build step)
├── api/generate.js   # serverless proxy — holds your API key, calls the model
├── package.json
└── README.md
```

The browser never sees your API key. The front-end calls `/api/generate`, and the serverless function adds the key server-side and talks to the model. That keeps the key private even though the app is public.

---

## Run it for free in ~5 minutes

### 1. Get a free Gemini API key
- Go to **Google AI Studio** → create an API key. No credit card required, no expiry.
- The free tier (Gemini Flash) gives roughly **1,500 requests/day** — plenty for this tool.

### 2. Deploy to Vercel (free)
**Option A — drag & drop:** zip this folder and drop it on [vercel.com/new](https://vercel.com/new).

**Option B — CLI:**
```bash
npm i -g vercel
cd tshephos-lab
vercel
```

### 3. Add your key as an environment variable
In Vercel: **Project → Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | your key from step 1 |

Redeploy. Done — the engine is live.

### Local development
```bash
npm i -g vercel
vercel dev          # serves index.html + the /api function locally
```
Set `GEMINI_API_KEY` in a `.env` file or via `vercel env`.

---

## Swap the engine (one variable)

The proxy is provider-agnostic. Change the `LLM_PROVIDER` env var and add the matching key:

| `LLM_PROVIDER` | Required key | Optional model var | Default model |
|----------------|--------------|--------------------|---------------|
| `gemini` *(default)* | `GEMINI_API_KEY` | `GEMINI_MODEL` | `gemini-2.5-flash` |
| `claude` | `CLAUDE_API_KEY` | `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` |
| `groq` | `GROQ_API_KEY` | `GROQ_MODEL` | `llama-3.3-70b-versatile` |

No code changes — just env vars. *(If a provider renames a model, set the model var to the current name.)*

---

## Good to know

- **Privacy:** on Gemini's **free** tier, your inputs and outputs may be used to improve Google's models. Fine for generic ad copy — for confidential client data, use a paid tier or Google Vertex AI, which don't train on your data.
- **Capacity:** the free tier (~1,500 runs/day) is built for one user. If you open it to multiple clients, you'll hit daily caps — upgrade the tier or rotate providers.
- **Cost:** Gemini free key + Vercel free tier + this static front-end = **$0** to run.

---

## Alternative host

Prefer Cloudflare? The static `index.html` works on **Cloudflare Pages**, with `api/generate.js` adapted to a **Cloudflare Pages Function** (same logic, `env.GEMINI_API_KEY` instead of `process.env`).
