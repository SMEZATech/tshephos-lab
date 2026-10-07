// Run by smoke.cjs. The always-on daily AI ceiling (api/_guard.js): the backstop that applies even
// when billing is off, so a runaway loop or a leaked session can't spend the shared keys without limit.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
delete process.env.DAILY_AI_CEILING;
delete process.env.BILLING_ENFORCE;
const guard = await import(pathToFileURL(path.join(ROOT, "api/_guard.js")).href);

let usageToday = 0, dbDown = false, inserts = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (dbDown) throw new Error("network down");
  if (u.hostname === "stub.supabase.co" && u.pathname === "/rest/v1/usage_event") {
    if ((init.method || "GET") === "POST") { inserts++; return { ok: true, status: 201, json: async () => [{}] }; }
    return { ok: true, status: 200, json: async () => (usageToday ? [{ units: usageToday }] : []) };
  }
  return { ok: true, status: 200, json: async () => [] };
};
const mkRes = () => { const r = { status: 0, body: null, setHeader() {}, status_(c) { this.status = c; return this; } }; r.status = function (c) { r._s = c; return r; }; r.json = function (b) { r.body = b; return r; }; return r; };
const company = { id: "u1", email: "thabo@smesouthafrica.co.za" };
const personal = { id: "u2", email: "me@gmail.com" };
let seq = 0; const org = () => "org-" + (++seq);
const run = async (orgId, user) => { const res = mkRes(); const stopped = await guard.meter({ volt: { orgId, user } }, res, { kind: "generate" }); return { stopped, status: res._s, body: res.body }; };

let pass = 0, fail = 0;
function expect(name, cond, detail) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail)); } }

console.log("Daily ceiling:");
usageToday = 0;
let o = org(); let r;
for (let i = 0; i < 20; i++) r = await run(o, company);
expect("a normal busy stretch (20 requests) is untouched", r.stopped === false, r);

process.env.DAILY_AI_CEILING = "3"; o = org();
const a = await run(o, company), b = await run(o, company), c = await run(o, company);
expect("with a ceiling of 3: requests 1 and 2 pass, request 3 is stopped with 429", !a.stopped && !b.stopped && c.stopped && c.status === 429 && c.body.code === "DAILY_CAP", { a, b, c });
expect("…and the message says when it resets and who to ask", /02:00 SAST/.test(c.body.error) && /owner/i.test(c.body.error), c.body);
delete process.env.DAILY_AI_CEILING;

console.log("Counts across serverless instances:");
usageToday = 1500; o = org();
r = await run(o, company);
expect("a company workspace already at its daily total in the DATABASE (another instance counted it) is stopped", r.stopped && r.body.limit === 1500, r);
usageToday = 400; o = org();
r = await run(o, company);
expect("…400 requests is a normal day for a company workspace", r.stopped === false, r);
o = org(); r = await run(o, personal);
expect("a single-person (personal address) workspace has a lower ceiling of 400", r.stopped && r.body.limit === 400, r);

console.log("Overrides and failure modes:");
process.env.DAILY_AI_CEILING = "9000"; usageToday = 5000; o = org();
r = await run(o, company);
expect("DAILY_AI_CEILING in the environment overrides the default", r.stopped === false, r);
delete process.env.DAILY_AI_CEILING; usageToday = 0;
dbDown = true; o = org(); r = await run(o, company); dbDown = false;
expect("if the database is down the limiter FAILS OPEN (it must never take the app down)", r.stopped === false, r);
expect("a request with no workspace is not metered", (await guard.meter({ volt: {} }, mkRes(), {})) === false);

console.log("MCP (no request/response to hand in):");
usageToday = 1500; o = org();
expect("meterOrg stops an over-ceiling workspace", (await guard.meterOrg(o, { kind: "mcp" })) === true);
usageToday = 0; o = org();
expect("…and lets a normal one through", (await guard.meterOrg(o, { kind: "mcp" })) === false);
expect("…recording the usage either way", inserts > 0, inserts);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
