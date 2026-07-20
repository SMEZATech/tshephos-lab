// Volt — send a TEST copy of the newsletter to yourself before it ever reaches Kit.
// © 2026 Tshepho Joel. All rights reserved.
//
// Why this exists: the Kit path creates a DRAFT, so the only way to see the real thing in a real
// inbox (Outlook especially) was to push to Kit first. This lets the draft be finalised in Volt.
//
// Provider: Resend free tier (3,000/month, 100/day — no cost).
//   Set RESEND_API_KEY in Vercel.
//   Optional: RESEND_FROM (e.g. "SME South Africa <newsletter@smesouthafrica.co.za>").
//   Without a verified domain Resend only allows its sandbox sender (onboarding@resend.dev),
//   which can deliver to the account owner's own address — enough to proof a template.
// Desktop sends its own key via x-resend-key.

import { blocked } from "./_guard.js";

const MAX_RECIPIENTS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  // Deliberately tight: this endpoint puts mail in real inboxes.
  if (await blocked(req, res, { id: "sendtest", limit: 10, windowSec: 300 })) return;

  const isDesktop = req.headers["x-client"] === "desktop";
  const key = (isDesktop ? req.headers["x-resend-key"] : process.env.RESEND_API_KEY) || "";
  if (!key) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: isDesktop
        ? "Add your Resend API key in ⚙ Settings to send test emails."
        : "Test sending isn't set up yet. Add a free RESEND_API_KEY in Vercel (resend.com — 3,000 emails/month free), then redeploy.",
    });
  }

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");

    const to = (Array.isArray(body.to) ? body.to : String(body.to || "").split(","))
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, MAX_RECIPIENTS);
    if (!to.length) return res.status(400).json({ error: "Add at least one email address to send the test to." });
    const bad = to.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) return res.status(400).json({ error: "That doesn't look like a valid email address: " + bad[0] });

    const html = String(body.html || "").trim();
    if (!html) return res.status(400).json({ error: "Build the email first — there's nothing to send." });
    const subject = String(body.subject || "").trim();
    if (!subject) return res.status(400).json({ error: "Add an email subject before sending a test." });

    const from = process.env.RESEND_FROM || "Volt Test <onboarding@resend.dev>";
    // Always mark it, so a test can never be mistaken for the real send.
    const testSubject = "[TEST] " + subject;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: testSubject,
        html,
        ...(body.previewText ? { text: String(body.previewText).slice(0, 300) } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = (data && (data.message || data.error && (data.error.message || data.error))) || ("Send failed (" + r.status + ")");
      // Resend's most common free-tier tripwire — explain it instead of echoing a raw API error.
      if (/domain is not verified|only send testing emails/i.test(String(msg))) {
        return res.status(400).json({
          error: "Resend won't deliver to that address yet. Until smesouthafrica.co.za is verified in Resend, test sends only reach the Resend account owner's own email. Verify the domain in Resend → Domains (then set RESEND_FROM) to send to anyone.",
        });
      }
      return res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({ error: String(msg).slice(0, 300) });
    }

    return res.status(200).json({ ok: true, id: (data && data.id) || null, to, from });
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Test send error" });
  }
}
