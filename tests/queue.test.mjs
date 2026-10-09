// Run by smoke.cjs. The scheduled-posting safety net, against a stubbed Supabase:
//   · a row stuck in 'publishing' becomes a visible error (not a silent loss)
//   · a database outage makes the drain FAIL (it used to report success while posting nothing)
//   · /api/queuehealth reports overdue / stuck / unreachable correctly
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
process.env.VOLT_ADMIN_EMAIL = "joel@smesouthafrica.co.za";
process.env.CRON_SECRET = "cron-secret";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.ALLOWED_EMAIL_EXTRA;

const USERS = { thabo: { id: "u-thabo", email: "thabo@smesouthafrica.co.za", email_confirmed_at: "2026-09-01T00:00:00Z" } };
let calls = [];
let mode = { igReadFails: false, queues: {} };   // queues: { table: { pending:[], publishing:[], error:[] } }
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ url: String(url), method: init.method || "GET", body: init.body });
  if (u.hostname !== "stub.supabase.co") return json(200, {});
  if (u.pathname === "/auth/v1/user") { const t = String(init.headers.Authorization || "").slice(7); return USERS[t] ? json(200, USERS[t]) : json(401, {}); }
  if (u.pathname.startsWith("/rest/v1/org")) return json(200, [{ id: "org-1" }]);
  if (u.pathname.startsWith("/rest/v1/member")) return json(200, [{ user_id: "x" }]);
  const table = u.pathname.replace("/rest/v1/", "");
  if (/_queue$/.test(table)) {
    if (mode.missing && mode.missing[table] && (init.method || "GET") !== "POST") return json(404, { code: "PGRST205", message: "Could not find the table" });
    if (table === "ig_queue" && mode.igReadFails && (init.method || "GET") === "GET") return json(500, { message: "db down" });
    if ((init.method || "GET") === "PATCH") return json(200, []);
    const q = (mode.queues && mode.queues[table]) || {};
    const status = (u.search.match(/status=eq\.([a-z]+)/) || [])[1];
    return json(200, q[status] || []);
  }
  return json(200, []);
};

let pass = 0, fail = 0;
function expect(name, cond, detail) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail)); } }
async function call(handler, user, { method = "POST", query = {}, body, headers = {} } = {}) {
  let status = 0, payload = null;
  const req = { method, query, body, headers: { authorization: user ? "Bearer " + user : "", origin: "https://tshephos-lab.vercel.app", ...headers }, socket: { remoteAddress: "9.9.9.9" } };
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { payload = b; return this; }, send(b) { payload = b; return this; }, end() { return this; } };
  await handler(req, res);
  return { status, body: payload };
}

const ig = (await imp("api/_routes/instagram.js")).default;
const fb = (await imp("api/_routes/facebook.js")).default;
const tt = (await imp("api/_routes/tiktok.js")).default;
const qh = (await imp("api/_routes/queuehealth.js")).default;
const drain = (h) => call(h, null, { method: "POST", query: { action: "drain" }, body: {}, headers: { "x-volt-cron": "cron-secret" } });

console.log("Stuck rows:");
for (const [name, h, table] of [["Instagram", ig, "ig_queue"], ["Facebook", fb, "fb_queue"], ["TikTok", tt, "tiktok_queue"]]) {
  calls = []; mode = { igReadFails: false, queues: {} };
  const r = await drain(h);
  const reap = calls.find((c) => c.method === "PATCH" && c.url.includes(table) && c.url.includes("status=eq.publishing") && c.url.includes("updated_at=lt."));
  const body = reap && JSON.parse(reap.body);
  expect(name + " drain reaps rows stuck in 'publishing' (turns them into a visible error, never a retry that could double-post)",
    r.status === 200 && !!reap && body.status === "error" && /interrupted/i.test(body.error), { status: r.status, reap: !!reap, body });
}

console.log("Database outage:");
calls = []; mode = { igReadFails: true, queues: {} };
let r = await drain(ig);
expect("when the queue can't be read the drain FAILS (502) instead of reporting success with nothing posted", r.status === 502, r);
mode.igReadFails = false;
r = await drain(ig);
expect("…and runs normally once the database is back", r.status === 200 && r.body.checked === 0, r);

console.log("A platform that was never set up:");
calls = []; mode = { igReadFails: false, queues: {}, missing: { fb_queue: true, tiktok_queue: true } };
r = await drain(fb);
expect("a missing queue table is a SETUP state, not an outage: drain answers 200 and says what to run", r.status === 200 && /fb_queue\.sql/.test(r.body.notSetUp || ""), r);
r = await drain(ig);
expect("…Instagram, whose table exists, is untouched", r.status === 200 && r.body.checked === 0 && !r.body.notSetUp, r);
r = await call(qh, "thabo", { method: "GET" });
expect("queue health lists them as notSetUp and stays HEALTHY (no false outage banner)", r.body.summary.healthy === true && r.body.summary.unreachable === false && r.body.summary.notSetUp.join() === "facebook,tiktok", r.body.summary);
mode = { igReadFails: false, queues: {} };

console.log("Queue health:");
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
mode = { igReadFails: false, queues: {} };
r = await call(qh, "thabo", { method: "GET" });
expect("all quiet → healthy", r.status === 200 && r.body.summary.healthy === true && r.body.summary.overdue === 0, r.body);
mode = { igReadFails: false, queues: { ig_queue: { pending: [{ id: "a", run_at: ago(45) }], publishing: [{ id: "b" }], error: [{ id: "c" }] } } };
r = await call(qh, "thabo", { method: "GET" });
expect("an overdue post and a stuck row are both reported", r.body.summary.overdue === 1 && r.body.summary.stuck === 1 && r.body.summary.errors24h === 1 && r.body.summary.healthy === false, r.body.summary);
expect("…with how late the oldest one is", r.body.summary.oldestOverdueMinutes >= 44 && r.body.summary.oldestOverdueMinutes <= 46, r.body.summary);
mode = { igReadFails: true, queues: {} };
r = await call(qh, "thabo", { method: "GET" });
expect("an unreadable database is reported as UNREACHABLE (not as 'nothing waiting')", r.body.summary.unreachable === true && r.body.summary.healthy === false, r.body.summary);
r = await call(qh, null, { method: "GET" });
expect("unauthenticated callers are refused", r.status === 401, r);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
