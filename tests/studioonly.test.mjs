// Run by smoke.cjs. A person on the owner's STUDIO_ONLY_EMAILS list can use Studio and nothing else, and
// that is enforced on the SERVER (hiding the menu is not a control). Drives the real requireSession,
// blocked(), the projects handler and /api/access against a stubbed Supabase.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
process.env.VOLT_ADMIN_EMAIL = "joel@smesouthafrica.co.za";
process.env.STUDIO_ONLY_EMAILS = " Omega@SMESouthAfrica.co.za , someone.else@smesouthafrica.co.za ";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.ALLOWED_EMAIL_EXTRA;
delete process.env.ALLOW_UNCONFIRMED_EMAIL;

const OK = "2026-09-01T00:00:00Z";
const USERS = {
  omega: { id: "u-omega", email: "omega@smesouthafrica.co.za", email_confirmed_at: OK },
  thabo: { id: "u-thabo", email: "thabo@smesouthafrica.co.za", email_confirmed_at: OK },
  joel: { id: "u-joel", email: "joel@smesouthafrica.co.za", email_confirmed_at: OK },
};
const ROWS = {
  bk: { id: "bk", type: "brandkit", title: "Brand Kit", data: { brands: [] } },
  em: { id: "em", type: "email", title: "Tuesday draft", data: { secret: "newsletter body" } },
  os: { id: "os", type: "orgsettings", title: "Volt module settings", data: { modules: {} } },
};
let writes = 0;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.hostname !== "stub.supabase.co") return json(200, {});
  if (u.pathname === "/auth/v1/user") { const t = String((init.headers && init.headers.Authorization) || "").slice(7); return USERS[t] ? json(200, USERS[t]) : json(401, {}); }
  if (u.pathname.startsWith("/rest/v1/org")) return json(200, [{ id: "org-1" }]);
  if (u.pathname.startsWith("/rest/v1/member")) return json(200, [{ user_id: "x" }]);
  if (u.pathname.startsWith("/rest/v1/project")) {
    if ((init.method || "GET") !== "GET") { writes++; return json(200, [{ id: "new", type: "brandkit" }]); }
    const idm = /[?&]id=eq\.([^&]+)/.exec(u.search), tm = /[?&]type=eq\.([^&]+)/.exec(u.search);
    let rows = Object.values(ROWS);
    if (idm) rows = rows.filter((r) => r.id === decodeURIComponent(idm[1]));
    if (tm) rows = rows.filter((r) => r.type === decodeURIComponent(tm[1]));
    return json(200, rows);
  }
  return json(200, []);
};

const { requireSession, isStudioOnlyEmail, studioOnlyAllows, authStatus } = await imp("api/_guard.js");
const projects = (await imp("api/projects.js")).default;
const access = (await imp("api/_routes/access.js")).default;

let pass = 0, fail = 0;
const expect = (name, cond, detail) => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + "  → " + JSON.stringify(detail).slice(0, 300)); } };
let ip = 0;
const mkReq = (user, method, url, body, query) => ({ method, url, body, query: query || {}, headers: Object.assign({ origin: "https://tshephos-lab.vercel.app" }, user ? { authorization: "Bearer " + user } : {}), socket: { remoteAddress: "10.1.0." + (++ip) } });
async function run(handler, req) {
  let status = 0, payload = null; const headers = {};
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(c) { status = c; return this; }, json(b) { payload = b; return this; }, end() { return this; } };
  await handler(req, res);
  return { status, body: payload, headers };
}

// ---- the list (case and spaces don't matter; nobody else is on it)
expect("the list matches whatever the case and spacing", isStudioOnlyEmail("OMEGA@smesouthafrica.co.za") && isStudioOnlyEmail("someone.else@smesouthafrica.co.za"), null);
expect("…and nobody else", !isStudioOnlyEmail("thabo@smesouthafrica.co.za") && !isStudioOnlyEmail("") && !isStudioOnlyEmail(null), null);

// ---- requireSession: the allow-list, by route
const sess = async (user, url, body) => requireSession(mkReq(user, "POST", url, body));
for (const route of ["projects", "copyuse", "scrape", "image", "upload", "access"]) {
  const s = await sess("omega", "/api/" + route + "?x=1");
  expect("Studio-only person may use /api/" + route, !s.error && s.studioOnly === true, s);
}
for (const route of ["brain", "billing", "instagram", "facebook", "tiktok", "mcp", "kit", "assets", "paystack", "queuehealth", "rebrand", "transcribe", "postiz", "whoami", "something-new"]) {
  const s = await sess("omega", "/api/" + route);
  expect("…but not /api/" + route, s.error === "STUDIO_ONLY" && authStatus(s) === 403, s);
}
expect("generate: only Studio's article-autofill tasks", (await sess("omega", "/api/generate", { task: "insightcards" })).studioOnly === true && !(await sess("omega", "/api/generate", { task: "roundupinsight" })).error, null);
for (const task of ["copy", "angles", "email", "coldopen", "", undefined]) expect("generate task " + JSON.stringify(task) + " is refused", (await sess("omega", "/api/generate", { task })).error === "STUDIO_ONLY", task);
expect("generate with a JSON-string body is read too", (await sess("omega", "/api/generate", JSON.stringify({ task: "insightcards" }))).studioOnly === true && (await sess("omega", "/api/generate", "{not json")).error === "STUDIO_ONLY", null);
expect("a router path without /api is read too", (await requireSession(mkReq("omega", "GET", "/brain"))).error === "STUDIO_ONLY" && !(await requireSession(mkReq("omega", "GET", "/scrape"))).error, null);
expect("an odd or empty URL is refused for her (closed by default)", (await requireSession(mkReq("omega", "GET", ""))).error === "STUDIO_ONLY" && (await requireSession(mkReq("omega", "GET", "/api/"))).error === "STUDIO_ONLY", null);

// ---- everyone else is untouched
for (const who of ["thabo", "joel"]) {
  const a = await sess(who, "/api/brain"), b = await sess(who, "/api/generate", { task: "copy" });
  expect(who + " is not limited: brain and any generate task still work", !a.error && !b.error && !a.studioOnly, { a, b });
}

// ---- /api/access
let r = await run(access, mkReq("omega", "GET", "/api/access"));
expect("/api/access tells her she is Studio-only, and is never cacheable", r.status === 200 && r.body.studioOnly === true && r.headers["cache-control"] === "private, no-store", r);
r = await run(access, mkReq("thabo", "GET", "/api/access"));
expect("…and tells everyone else they are not", r.status === 200 && r.body.studioOnly === false, r);
r = await run(access, mkReq(null, "GET", "/api/access"));
expect("…and a signed-out caller gets 401", r.status === 401, r);

// ---- /api/projects: the Brand Kit and settings, read-only, nothing else
const P = (user, method, query, body) => run(projects, mkReq(user, method, "/api/projects", body, query));
r = await P("omega", "GET", { type: "brandkit" });
expect("she can list the Brand Kit", r.status === 200 && r.body.projects.length === 1, r);
r = await P("omega", "GET", { type: "orgsettings" });
expect("…and the module settings", r.status === 200, r);
r = await P("omega", "GET", { type: "email" });
expect("…but not email drafts (403)", r.status === 403 && r.body.code === "STUDIO_ONLY", r);
r = await P("omega", "GET", {});
expect("…and an unfiltered list is refused", r.status === 403, r);
r = await P("omega", "GET", { id: "bk" });
expect("she can open the Brand Kit by id", r.status === 200 && r.body.project.type === "brandkit", r);
r = await P("omega", "GET", { id: "em" });
expect("…but opening an email draft by id looks like 'not found'", r.status === 404 && !JSON.stringify(r.body).includes("newsletter body"), r);
r = await P("omega", "GET", { who: "1" });
expect("…and the workspace listing (?who) is refused", r.status === 403, r);
writes = 0;
r = await P("omega", "POST", {}, { op: "save", type: "brandkit", title: "x", data: { brands: [] } });
expect("she cannot save the shared Brand Kit", r.status === 403 && writes === 0, { r, writes });
r = await P("omega", "POST", {}, { op: "delete", id: "bk" });
expect("…or delete anything", r.status === 403 && writes === 0, { r, writes });
r = await P("thabo", "GET", { type: "email" });
expect("a normal teammate still lists email drafts", r.status === 200 && r.body.projects.length === 1, r);
r = await P("thabo", "POST", {}, { op: "save", type: "brandkit", title: "x", data: { brands: [] } });
expect("…and still saves the Brand Kit", r.status === 200, r);

// ---- the switch itself: unset the env var and she is an ordinary member again
delete process.env.STUDIO_ONLY_EMAILS;
expect("with the list emptied she is an ordinary member again", !(await sess("omega", "/api/brain")).error, null);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
