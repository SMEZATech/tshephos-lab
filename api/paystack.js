// Volt — Paystack webhook (Phase C). © 2026 Tshepho Joel.
// Set this URL in Paystack Dashboard → Settings → API Keys & Webhooks:
//   https://tshephos-lab.vercel.app/api/paystack
//
// Security: we verify the x-paystack-signature HMAC when the raw body is available,
// AND (authoritatively) re-verify the transaction with Paystack before upgrading — so a
// forged payload can't grant a plan. No auth/session here (Paystack calls it server→server).

import crypto from "crypto";
import { PLANS, setOrgPlan } from "./_guard.js";

function rawBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", () => resolve(""));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const sk = process.env.PAYSTACK_SECRET_KEY;
  if (!sk) { res.status(200).json({ received: true, note: "billing not configured" }); return; }

  // Get the event. Vercel may have pre-parsed JSON into req.body; otherwise read the stream.
  let evt = req.body, raw = "";
  if (!evt || typeof evt !== "object") {
    raw = await rawBody(req);
    try { evt = JSON.parse(raw || "{}"); } catch (_) { evt = {}; }
  }
  // Best-effort signature check (only possible with the raw body).
  if (raw) {
    try {
      const sig = crypto.createHmac("sha512", sk).update(raw).digest("hex");
      if (sig !== req.headers["x-paystack-signature"]) { res.status(401).json({ error: "bad signature" }); return; }
    } catch (_) {}
  }

  try {
    if (evt && evt.event === "charge.success" && evt.data) {
      const ref = evt.data.reference;
      // Authoritative re-verify with our secret key — never trust the payload alone.
      const v = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), { headers: { Authorization: "Bearer " + sk } });
      const j = await v.json();
      if (j && j.status && j.data && j.data.status === "success") {
        const md = j.data.metadata || {};
        if (md.orgId && md.plan && PLANS[md.plan]) await setOrgPlan(md.orgId, md.plan);
      }
    }
  } catch (e) { /* swallow — always 200 so Paystack doesn't retry-storm */ }

  res.status(200).json({ received: true });
}
