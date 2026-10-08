// Run by smoke.cjs. Paystack webhook: a payment only upgrades a plan if it matches (ZAR, >= price),
// and transient failures answer 503 so Paystack retries instead of the customer paying for nothing.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
delete process.env.UPSTASH_REDIS_REST_URL;
let pass = 0, fail = 0;
const expect = (n, c, d) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + "  → " + JSON.stringify(d)); } };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
let verifyReply, dbOk = true, patches = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.hostname === "api.paystack.co") { if (verifyReply instanceof Error) throw verifyReply; return verifyReply; }
  if (init.method === "PATCH") { patches.push(JSON.parse(init.body)); return dbOk ? json(200, [{}]) : json(500, {}); }
  return json(200, {});
};
const handler = (await imp("api/_routes/paystack.js")).default;
const run = async (data) => {
  let out = { status: 0, body: null }; patches = [];
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: "POST", headers: {}, body: { event: "charge.success", data: { reference: "r1" } } }, res);
  out.patches = patches; return out;
};
const paid = (over) => json(200, { status: true, data: Object.assign({ status: "success", amount: 29900, currency: "ZAR", metadata: { orgId: "o1", plan: "starter" } }, over) });

verifyReply = paid(); let r = await run();
expect("a correct ZAR payment upgrades the plan", r.status === 200 && r.patches.length === 1 && r.patches[0].plan === "starter", r);
verifyReply = paid({ amount: 100 }); r = await run();
expect("an underpayment does NOT upgrade", r.status === 200 && r.patches.length === 0, r);
verifyReply = paid({ currency: "USD" }); r = await run();
expect("a payment in another currency does NOT upgrade", r.status === 200 && r.patches.length === 0, r);
verifyReply = paid({ metadata: { orgId: "o1", plan: "unlimited" } }); r = await run();
expect("a comped plan can't be bought (price 0)", r.status === 200 && r.patches.length === 0, r);
verifyReply = new Error("network down"); r = await run();
expect("Paystack unreachable → 503 so it retries", r.status === 503, r);
verifyReply = json(502, {}); r = await run();
expect("Paystack 5xx → 503 so it retries", r.status === 503, r);
verifyReply = paid(); dbOk = false; r = await run(); dbOk = true;
expect("our database failing → 503 so it retries", r.status === 503, r);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
