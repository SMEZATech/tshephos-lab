// Run by smoke.cjs. Drives the REAL api/_routes/copyuse.js handler against a stubbed Supabase, through every rule.
import { pathToFileURL } from "node:url";

process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
process.env.VOLT_ADMIN_EMAIL = "joel@smesouthafrica.co.za";
delete process.env.UPSTASH_REDIS_REST_URL;

const USERS = {
  joel: { id: "u-joel", email: "joel@smesouthafrica.co.za" },
  thabo: { id: "u-thabo", email: "thabo@smesouthafrica.co.za" },
};
let TABLE_EXISTS = true;
let rows = []; // studio_copy_use
let clock = Date.parse("2026-09-28T09:00:00Z");
const realNow = Date.now; Date.now = () => clock;

function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }
function filterRows(qs) {
  const p = new URLSearchParams(qs);
  let out = rows.slice();
  for (const [k, v] of p) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v === "not.is.null") out = out.filter((r) => r[k] != null);
  }
  const ord = p.get("order");
  if (ord === "created_at.desc") out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lim = Number(p.get("limit") || 0); if (lim) out = out.slice(0, lim);
  return out;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname === "/auth/v1/user") {
    const tok = String(init.headers.Authorization).slice(7);
    return USERS[tok] ? json(200, USERS[tok]) : json(401, {});
  }
  if (u.pathname.startsWith("/rest/v1/org")) return json(200, [{ id: "org-1" }]);
  if (u.pathname.startsWith("/rest/v1/member")) return json(200, [{ org_id: "org-1" }]);
  if (u.pathname === "/rest/v1/studio_copy_use") {
    if (!TABLE_EXISTS) return json(404, { code: "42P01", message: 'relation "studio_copy_use" does not exist' });
    if ((init.method || "GET") === "POST") {
      const row = Object.assign({ id: "r" + rows.length, created_at: new Date(clock).toISOString() }, JSON.parse(init.body));
      rows.push(row); return json(201, [row]);
    }
    return json(200, filterRows(u.search.slice(1)));
  }
  return json(200, []);
};

const mod = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL("../api/_routes/copyuse.js", import.meta.url).href);
const handler = mod.default;

async function call(user, method, { query = {}, body } = {}) {
  let status = 0, payload = null;
  const req = { method, headers: { authorization: "Bearer " + user, origin: "https://tshephos-lab.vercel.app" }, query, body, socket: { remoteAddress: "1.2.3.4" } };
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(b) { payload = b; return this; }, end() { return this; },
  };
  await handler(req, res);
  return { status, body: payload };
}
const item = (over = {}) => Object.assign({ brand: "sme", family: "funding", dir: "b", size: "portrait", hash: "abc123def", variant: "funding.b.01", source: "single" }, over);
const record = (user, items, override) => call(user, "POST", { body: { action: "record", items, ...(override ? { override: true } : {}) } });

let pass = 0, fail = 0;
function expect(name, cond, detail) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail)); } }

// 1. First download of a copy on a size is recorded.
let r = await record("thabo", [item()]);
expect("first download is recorded", r.status === 200 && r.body.recorded === 1, r);

// 2. Same copy, same size, SAME person, 20 minutes later → grace (lost file / failed save).
clock += 20 * 60 * 1000;
r = await record("thabo", [item()]);
expect("same person within the hour → allowed as regrace", r.status === 200 && r.body.regrace === true, r);

// 3. Same copy, same size, DIFFERENT person → blocked, and says who/when.
r = await record("joel", [item()]);
expect("teammate re-using it → 409 ALREADY_USED", r.status === 409 && r.body.code === "ALREADY_USED", r);
expect("the block names who published it", r.body && r.body.conflicts && r.body.conflicts[0].by === "thabo@smesouthafrica.co.za", r);

// 4. Same copy, DIFFERENT size → fair game.
r = await record("joel", [item({ size: "landscape" })]);
expect("same copy on another size → allowed", r.status === 200, r);

// 5. Same person, but past the grace hour → blocked (this is the laziness case).
clock += 2 * 60 * 60 * 1000;
r = await record("thabo", [item()]);
expect("same person two hours later → blocked", r.status === 409, r);

// 6. Owner override: non-owner is refused outright; owner succeeds and the row is flagged.
r = await record("thabo", [item()], true);
expect("non-owner cannot override → 403", r.status === 403, r);
r = await record("joel", [item()], true);
expect("owner override → allowed", r.status === 200 && r.body.override === true, r);
expect("override row is flagged in the log", rows[rows.length - 1].override === true, rows[rows.length - 1]);

// 7. A different brand's identical copy is independent (SME vs Serv).
r = await record("thabo", [item({ brand: "serv-123" })]);
expect("same copy under another brand → allowed", r.status === 200, r);

// 8. Batch (carousel) is all-or-nothing: one used slide blocks the file and logs NOTHING.
const before = rows.length;
r = await record("thabo", [item({ dir: "a", hash: "fresh00001" }), item()]);
expect("batch with one used slide → 409", r.status === 409, r);
expect("…and nothing from that batch was logged", rows.length === before, { before, after: rows.length });

// 9. Malformed input is rejected, not stored.
r = await record("thabo", [item({ size: "billboard" })]);
expect("unknown size → 400", r.status === 400, r);
r = await record("thabo", [item({ hash: "NOT A HASH" })]);
expect("bad hash → 400", r.status === 400, r);

// 10. GET for a family returns uses, flags which are mine, and tells the client if it's the owner.
r = await call("joel", "GET", { query: { brand: "sme", family: "funding" } });
expect("GET family → uses + owner flag", r.status === 200 && r.body.owner === true && r.body.uses.length > 0, r.body && { owner: r.body.owner, n: r.body.uses && r.body.uses.length });
r = await call("thabo", "GET", { query: { brand: "sme", family: "funding" } });
expect("non-owner sees owner:false", r.body.owner === false, r.body.owner);

// 11. Summary only returns library variants (for pool-status in Admin).
rows.push({ id: "custom", org_id: "org-1", brand_key: "sme", family: "webinar", dir: "a", size: "square", copy_hash: "zzzzzz1", variant_id: null, created_at: new Date(clock).toISOString() });
r = await call("joel", "GET", { query: { action: "summary" } });
expect("summary excludes custom (non-library) copy", r.status === 200 && r.body.uses.every((u) => u.variant), r.body);

// 12. Unauthenticated → 401.
r = await call("nobody", "GET", { query: { brand: "sme", family: "funding" } });
expect("no session → 401", r.status === 401, r);

// 12b. Recycling. Pool of 3 on funding.c/square: publish all three, then the oldest may come back
//      ONLY with recycle:true AND only because the log proves the pool is spent.
clock += 3 * 60 * 60 * 1000;
const c = (n, extra) => item(Object.assign({ dir: "c", size: "square", variant: "funding.c.0" + n, hash: "cccccc0" + n }, extra || {}));
r = await record("joel", [c(1)]); r = await record("joel", [c(2)]);
clock += 2 * 60 * 60 * 1000;
r = await record("thabo", [c(1, { recycle: true, poolSize: 3 })]);
expect("recycle while the pool is NOT spent (2 of 3 used) → blocked", r.status === 409, r);
r = await record("thabo", [c(3)]);
expect("third copy → recorded, pool now spent", r.status === 200, r);
r = await record("thabo", [c(1)]);
expect("oldest copy WITHOUT the recycle flag → still blocked", r.status === 409, r);
r = await record("thabo", [c(1, { recycle: true, poolSize: 3 })]);
expect("oldest copy with recycle once the pool IS spent → allowed", r.status === 200 && r.body.recycled === true, r);
expect("recycled row is flagged in the log", rows[rows.length - 1].recycled === true, rows[rows.length - 1]);
r = await record("thabo", [c(9, { hash: "nonlib001", variant: null, recycle: true, poolSize: 3 })]);
expect("recycle flag on non-library copy is ignored (first use just records)", r.status === 200 && !r.body.recycled, r);

// 13. Table not created yet → 503 NOT_CONFIGURED (Studio then fails open).
TABLE_EXISTS = false;
r = await record("thabo", [item({ hash: "brandnew01" })]);
expect("missing table → 503 NOT_CONFIGURED", r.status === 503 && r.body.error === "NOT_CONFIGURED", r);

// 11. Design usage: Creative exports are counted (never blocked) and the aggregate ranks designs.
TABLE_EXISTS = true; rows = [];
const track = (user, items) => call(user, "POST", { body: { action: "track", items } });
r = await track("thabo", [{ brand: "sme", dir: "editorial", size: "square" }, { brand: "sme", dir: "editorial", size: "portrait" }]);
expect("tracking Creative exports records one row per size", r.status === 200 && r.body.tracked === 2 && rows.length === 2 && rows.every((x) => x.family === "creative"), r);
r = await track("thabo", [{ brand: "sme", dir: "editorial", size: "square" }]);
expect("tracking the SAME theme+size again is never blocked", r.status === 200, r);
r = await track("thabo", [{ brand: "sme", dir: "x y", size: "square" }]);
expect("a malformed track item is rejected", r.status === 400, r);
r = await track("thabo", [{ brand: "sme", dir: "navy", size: "banner" }]);
expect("an unknown size is rejected", r.status === 400, r);
await record("thabo", [item({ hash: "usage0001" })]);
r = await call("thabo", "GET", { query: { action: "designs" } });
expect("the design-usage aggregate ranks Creative editorial first with 3 uses", r.status === 200 && r.body.designs[0].family === "creative" && r.body.designs[0].dir === "editorial" && r.body.designs[0].uses === 3 && r.body.total === 4, r.body);

Date.now = realNow;
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
