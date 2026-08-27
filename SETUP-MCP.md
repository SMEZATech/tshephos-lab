# Connecting AI tools to Volt (MCP) — setup

Volt exposes an [MCP](https://modelcontextprotocol.io) server so Claude Desktop, Claude Code, or
any other MCP-compatible AI tool can generate on-brand content — ad copy, newsletter section copy,
and reading the saved Brand Kit — without leaving that tool. It costs nothing and needs no Meta/
Google-style app review; you mint your own key from inside Volt.

**Generate-only.** A connected AI tool can draft content and read your Brand Kit. It cannot publish
a post, touch a setting, or change anything about the account. If that scope ever needs to grow
(e.g. letting a tool publish directly), that's a deliberate, separate decision — not something a
key upgrade silently grants.

**Not included yet:** generating an actual Studio design image. Studio's canvas renderer runs
inside a browser Worker (OffscreenCanvas), not on the server, so there's no server-side renderer
for an MCP tool to call today. Copy and Brand Kit access work now; image generation would need a
real headless-rendering service, which is a separate build.

---

## 1. Generate a key

In Volt → **Admin → 🔌 AI Tools (MCP)** → **Generate key**. The raw key (`sk_volt_...`) is shown
**once** — copy it immediately. Losing it just means generating a new one (which revokes the old
one automatically; only one key is active per account at a time).

---

## 2. Point your MCP client at Volt

**Endpoint:** `https://tshephos-lab.vercel.app/api/mcp`
**Auth header:** `Authorization: Bearer <your key>`
**Transport:** Streamable HTTP (the current MCP remote-server standard) — a single POST per call,
no local process to install or keep running.

### Claude Code

```bash
claude mcp add --transport http volt https://tshephos-lab.vercel.app/api/mcp \
  --header "Authorization: Bearer sk_volt_..."
```

### Claude Desktop

Settings → Connectors → Add custom connector → URL `https://tshephos-lab.vercel.app/api/mcp`,
Authorization header `Bearer sk_volt_...`.

### Any other MCP client

Same three facts as above (endpoint, header, Streamable HTTP) — every MCP client's config just
asks for those in a different shape.

---

## 3. What's available

Three tools, once connected:

- **`get_brand_kit`** — reads your saved Brand Kit(s): colours, tagline, CTA, URL, and each
  brand's voice/tone description, plus which one is active. Call this first so anything generated
  by hand in the chat matches the real voice.
- **`generate_ad_copy`** — several ad/post copy variations (framework, headline, body, CTA,
  hashtags, 1-10 scores), automatically written in the active Brand Kit's voice.
- **`generate_email_copy`** — the body HTML for one newsletter section from a brief, in the
  newsletter's established voice. Never invents facts, links or figures beyond what you give it.

---

## Rotating or revoking

Same Admin card: **Rotate key** replaces the active key (old one stops working immediately —
update every connected tool). **Revoke** disables access entirely until you generate a new one.
