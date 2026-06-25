// Volt — billing + usage endpoint (Phase C). © 2026 Tshepho Joel.
// Auth: requires a Supabase session (same model as the rest of the API).
//
//   GET  ?action=usage            → { plan, label, used, limit, priceZar, enforced, period }
//   GET  ?action=plans            → { plans: [{id,label,aiLimit,priceZar}] }
//   POST {action:"subscribe", plan}→ { authorization_url, reference }  (Paystack init, ZAR)
//   GET  ?action=verify&reference=→ { ok, plan }  (verify a returned Paystack txn, upgrade)
//
// Dormant until env is set: needs SUPABASE_* (auth) + PAYSTACK_SECRET_KEY (paid plans).
// Reading usage works with just Supabase; subscribe/verify need Paystack.

import { setCors, requireSession, PLANS, monthUsage, getOrgPlan, setOrgPlan } from "./_guard.js";

const PAYSTACK = "https://api.paystack.co";

export default async function handler(req, res) {
  setCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const s = await requireSession(req);
  if (s.error) { res.status(401).json({ error: "Please sign in to manage billing.", code: s.error }); return; }
  const orgId = s.orgId;
  const action = (req.query && req.query.action) || (req.body && req.body.action) || "usage";
  const sk = process.env.PAYSTACK_SECRET_KEY;

  try {
    if (req.method === "GET" && action === "plans") {
      const plans = Object.keys(PLANS).map((id) => ({ id, label: PLANS[id].label, aiLimit: PLANS[id].aiLimit, priceZar: PLANS[id].priceZar }));
      return res.status(200).json({ plans });
    }

    if (req.method === "GET" && action === "usage") {
      const plan = await getOrgPlan(orgId);
      const def = PLANS[plan] || PLANS.free;
      const used = await monthUsage(orgId);
      const d = new Date();
      return res.status(200).json({
        plan, label: def.label, used, limit: def.aiLimit, priceZar: def.priceZar,
        enforced: process.env.BILLING_ENFORCE === "1",
        billingReady: !!sk,
        period: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 7),
      });
    }

    if (req.method === "GET" && action === "verify") {
      if (!sk) return res.status(503).json({ error: "Billing not configured.", code: "NOT_CONFIGURED" });
      const ref = req.query && req.query.reference;
      if (!ref) return res.status(400).json({ error: "Missing reference." });
      const v = await fetch(PAYSTACK + "/transaction/verify/" + encodeURIComponent(ref), { headers: { Authorization: "Bearer " + sk } });
      const j = await v.json();
      if (j && j.status && j.data && j.data.status === "success") {
        const md = j.data.metadata || {};
        const plan = md.plan;
        const vorg = md.orgId || orgId;
        if (plan && PLANS[plan]) await setOrgPlan(vorg, plan);
        return res.status(200).json({ ok: true, plan });
      }
      return res.status(200).json({ ok: false, status: (j && j.data && j.data.status) || "unknown" });
    }

    if (req.method === "POST" && action === "subscribe") {
      if (!sk) return res.status(503).json({ error: "Billing not configured — add PAYSTACK_SECRET_KEY in Vercel.", code: "NOT_CONFIGURED" });
      const plan = req.body && req.body.plan;
      const def = PLANS[plan];
      if (!def || def.priceZar <= 0) return res.status(400).json({ error: "Choose a paid plan." });
      const base = process.env.APP_BASE_URL || "https://tshephos-lab.vercel.app";
      const init = await fetch(PAYSTACK + "/transaction/initialize", {
        method: "POST",
        headers: { Authorization: "Bearer " + sk, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: s.user.email,
          amount: Math.round(def.priceZar * 100), // ZAR → cents
          currency: "ZAR",
          metadata: { orgId, plan, userId: s.user.id },
          callback_url: base + "/billing-return.html",
        }),
      });
      const j = await init.json();
      if (!j || !j.status) return res.status(502).json({ error: (j && j.message) || "Could not start checkout." });
      return res.status(200).json({ authorization_url: j.data.authorization_url, reference: j.data.reference });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
