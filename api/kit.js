// Volt — Kit (ConvertKit) proxy. © 2026 Tshepho Joel. All rights reserved.
// Creates a DRAFT broadcast in Kit from the newsletter HTML, so it can be reviewed
// and sent from inside Kit. The Kit key stays on the server (web) or is supplied by
// the desktop app per-user via the x-kit-key header.
//
// Web: set KIT_API_KEY in Vercel (Project Settings → Environment Variables), then redeploy.
// Desktop: the app sends x-client:desktop + x-kit-key:<user key>.
// Get a V4 API key in Kit → Settings → Developer (Advanced → API Keys).
// Docs: https://developers.kit.com/api-reference/broadcasts/create-a-broadcast

import { blocked } from "./_guard.js";

const KIT_BASE = "https://api.kit.com/v4";
const KIT_URL = KIT_BASE + "/broadcasts";

const MAX_TEST_RECIPIENTS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Send a TEST copy of the newsletter to a real inbox, BEFORE anything reaches Kit — so the draft
// can be finalised inside Volt. Lives here rather than in its own api/ file because Vercel's Hobby
// plan caps a deployment at 12 Serverless Functions and we were exactly at the ceiling; both
// concerns are "get this newsletter delivered", so they belong together.
// Provider: Resend free tier (3,000/month, 100/day). RESEND_API_KEY (+ optional RESEND_FROM) in
// Vercel; desktop supplies x-resend-key.
async function handleTestSend(req, res, body) {
  const isDesktop = req.headers["x-client"] === "desktop";
  const key = (isDesktop ? req.headers["x-resend-key"] : process.env.RESEND_API_KEY) || "";
  if (!key) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: isDesktop
        ? "Add your Resend API key in ⚙ Settings to send test emails."
        : "Test sending isn't set up yet. Add RESEND_API_KEY in Vercel (resend.com — 3,000 emails/month free), then redeploy.",
    });
  }

  const to = (Array.isArray(body.to) ? body.to : String(body.to || "").split(","))
    .map((s) => String(s || "").trim()).filter(Boolean).slice(0, MAX_TEST_RECIPIENTS);
  if (!to.length) return res.status(400).json({ error: "Add at least one email address to send the test to." });
  const bad = to.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return res.status(400).json({ error: "That doesn't look like a valid email address: " + bad[0] });

  const html = String(body.html || "").trim();
  if (!html) return res.status(400).json({ error: "Build the email first — there's nothing to send." });
  const subject = String(body.subject || "").trim();
  if (!subject) return res.status(400).json({ error: "Add an email subject before sending a test." });

  const from = process.env.RESEND_FROM || "Volt Test <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: "[TEST] " + subject,   // never mistakable for the real send
        html,
        ...(body.previewText ? { text: String(body.previewText).slice(0, 300) } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && (data.message || (data.error && (data.error.message || data.error)))) || ("Send failed (" + r.status + ")");
      if (/domain is not verified|only send testing emails/i.test(String(msg))) {
        return res.status(400).json({
          error: "Resend won't deliver to that address yet. Until your sending domain is verified in Resend, test sends only reach the Resend account owner's own email. Verify the domain in Resend → Domains, then set RESEND_FROM.",
        });
      }
      return res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({ error: String(msg).slice(0, 300) });
    }
    return res.status(200).json({ ok: true, id: (data && data.id) || null, to, from });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Test send error" });
  }
}

export default async function handler(req, res) {
  if (req.method !== "OPTIONS" && req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (await blocked(req, res, { methods: "GET, POST, OPTIONS", method: req.method, id: "kit", limit: 20, windowSec: 60 })) return;

  // Test send is its own path — it needs the Resend key, not the Kit key, so branch before
  // the Kit key check below (otherwise a Kit-less account could never send a test).
  if (req.method === "POST") {
    let early = {};
    try { early = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}"); } catch (e) {}
    if (String(early.action || "") === "test") return handleTestSend(req, res, early);
  }

  // Resolve the Kit API key: desktop sends its own; web falls back to the env key.
  const isDesktop = req.headers["x-client"] === "desktop";
  const kitKey = isDesktop ? req.headers["x-kit-key"] : process.env.KIT_API_KEY;
  if (!kitKey) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: isDesktop
        ? "Add your Kit API key in ⚙ Settings to send to Kit."
        : "Kit isn't connected. Add KIT_API_KEY in Vercel, then redeploy.",
    });
  }

  const kitHeaders = { "Content-Type": "application/json", Accept: "application/json", "X-Kit-Api-Key": kitKey };

  // ---- Read: recent broadcasts + their open/click stats (Stats module) ----
  if (req.method === "GET") {
    try {
      const lr = await fetch(KIT_URL + "?per_page=30", { headers: kitHeaders });
      const ld = await lr.json().catch(() => ({}));
      if (!lr.ok) {
        const auth = lr.status === 401 || lr.status === 403;
        return res.status(auth ? 401 : 502).json({ error: (ld && (ld.message || ld.error)) || ("Kit request failed (" + lr.status + ")") });
      }
      let list = (ld && ld.broadcasts) || [];
      // Sent newsletters only, most recent first, capped (each needs its own stats call).
      list = list.filter((b) => b && (b.published_at || b.send_at)).slice(0, 8);
      const withStats = await Promise.all(list.map(async (b) => {
        let st = {};
        try {
          const sr = await fetch(KIT_URL + "/" + b.id + "/stats", { headers: kitHeaders });
          const sd = await sr.json().catch(() => ({}));
          st = (sd && sd.broadcast && sd.broadcast.stats) || (sd && sd.stats) || {};
        } catch (e) {}
        return {
          id: b.id, subject: b.subject || "(no subject)",
          sentAt: b.send_at || b.published_at || null,
          recipients: st.recipients != null ? st.recipients : null,
          openRate: st.open_rate != null ? st.open_rate : null,
          clickRate: st.click_rate != null ? st.click_rate : null,
          unsubscribes: st.unsubscribes != null ? st.unsubscribes : null,
        };
      }));
      return res.status(200).json({ broadcasts: withStats });
    } catch (err) {
      return res.status(502).json({ error: (err && err.message) || "Kit read error" });
    }
  }

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const html = String(body.html || "").trim();
    const subject = String(body.subject || "").trim();
    const previewText = String(body.previewText || body.preview_text || "").trim();
    if (!html) return res.status(400).json({ error: "Missing email HTML." });
    if (!subject) return res.status(400).json({ error: "Add an email subject before sending to Kit." });

    // send_at:null + public:false → a DRAFT the user finalises (audience, schedule) inside Kit.
    const payload = {
      subject,
      preview_text: previewText,
      description: subject,
      content: html,
      public: false,
      published_at: null,
      send_at: null,
    };

    const r = await fetch(KIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Kit-Api-Key": kitKey },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }

    if (!r.ok) {
      const msg =
        (data && (data.message || (Array.isArray(data.errors) ? data.errors.join("; ") : data.error))) ||
        (typeof data === "string" ? data.slice(0, 300) : "") ||
        ("Kit request failed (" + r.status + ")");
      const auth = r.status === 401 || r.status === 403;
      return res.status(auth ? 401 : 502).json({ error: msg });
    }

    const b = (data && data.broadcast) || data || {};
    return res.status(200).json({
      ok: true,
      id: b.id || null,
      publicUrl: b.public_url || null,
    });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Kit error" });
  }
}
