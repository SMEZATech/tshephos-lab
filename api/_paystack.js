// Shared Paystack payment check (used by the webhook and the return-page verify).
// A transaction only upgrades a plan if what was actually PAID matches that plan: currency ZAR and
// at least the plan's price in cents. Without this, any successful transaction carrying
// metadata.plan (a price change, a test charge, a cheaper old plan) would grant the plan.
import { PLANS } from "./_guard.js";

export function paymentMatchesPlan(data, planId) {
  const def = PLANS[planId];
  if (!data || !def || !(def.priceZar > 0)) return false;
  if (String(data.currency || "").toUpperCase() !== "ZAR") return false;
  return Number(data.amount) >= Math.round(def.priceZar * 100);
}
