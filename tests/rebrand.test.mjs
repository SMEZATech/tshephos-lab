// Run by smoke.cjs. Drives the REAL api/_routes/rebrand.js handler against a stubbed Supabase:
// the SMESA 2026 templates reach Joel and nobody else — not a teammate, not a signed-out caller,
// not a bad token — and release is the one switch it claims to be.
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.REBRAND_2026_EMAILS;
delete process.env.REBRAND_2026_OPEN;

const USERS = {
  joel: { id: "u-joel", email: "Joel@SMESouthAfrica.co.za", email_confirmed_at: "2026-01-01" },
  thabo: { id: "u-thabo", email: "thabo@smesouthafrica.co.za", email_confirmed_at: "2026-01-01" },
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname === "/auth/v1/user") {
    const tok = String((init.headers && init.headers.Authorization) || "").slice(7);
    return USERS[tok] ? json(200, USERS[tok]) : json(401, {});
  }
  if (u.pathname.startsWith("/rest/v1/org")) return json(200, [{ id: "org-1" }]);
  if (u.pathname.startsWith("/rest/v1/member")) return json(200, [{ org_id: "org-1" }]);
  return json(200, []);
};

const handler = (await import(new URL("../api/_routes/rebrand.js", import.meta.url).href)).default;
let ip = 0;
async function call(user, method = "GET") {
  let status = 0, payload = null; const headers = {};
  const req = { method, headers: Object.assign({ origin: "https://tshephos-lab.vercel.app" }, user ? { authorization: "Bearer " + user } : {}), query: {}, socket: { remoteAddress: "10.0.0." + (++ip) } };
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(c) { status = c; return this; }, json(b) { payload = b; return this; }, end() { return this; } };
  await handler(req, res);
  return { status, body: payload, headers };
}

let pass = 0, fail = 0;
function expect(name, cond, detail) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail).slice(0, 300)); } }

let r = await call("joel");
expect("Joel (any letter case) gets the definitions", r.status === 200 && r.body.kit && r.body.kit.id === "sme26" && Object.keys(r.body.studio.families).length === 9, r.status);
expect("…with every template surface present", r.body && r.body.studio.engine.length > 1000 && typeof r.body.email.source === "string" && typeof r.body.video.source === "string", null);
expect("…and it is never cacheable", r.headers["cache-control"] === "private, no-store", r.headers);

r = await call("thabo");
expect("a teammate on the same domain gets 403", r.status === 403 && r.body.code === "REBRAND_PREVIEW_ONLY" && !r.body.kit, r);
r = await call(null);
expect("no session gets 403 (not 401)", r.status === 403 && !r.body.kit, r);
r = await call("forged-token");
expect("an invalid token gets 403", r.status === 403, r);
r = await call("joel", "POST");
expect("only GET is served", r.status === 405, r);

process.env.REBRAND_2026_EMAILS = "thabo@smesouthafrica.co.za, someone@smesouthafrica.co.za";
r = await call("thabo");
expect("widening REBRAND_2026_EMAILS releases to the named people", r.status === 200, r.status);
r = await call("joel");
expect("…and the list is the list (Joel not in it → 403)", r.status === 403, r.status);
delete process.env.REBRAND_2026_EMAILS;

process.env.REBRAND_2026_OPEN = "1";
r = await call("thabo");
expect("REBRAND_2026_OPEN=1 releases to every signed-in user", r.status === 200, r.status);
r = await call(null);
expect("…but still never to a signed-out caller", r.status === 403, r.status);
delete process.env.REBRAND_2026_OPEN;

const SUPA = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
r = await call("joel");
expect("missing Supabase config fails CLOSED (403)", r.status === 403, r.status);
process.env.SUPABASE_URL = SUPA;

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
