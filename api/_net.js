// Volt — outbound-request safety. © 2026 Tshepho Joel.
//
// Several routes fetch a URL a signed-in user supplied (the article/image scraper, the WordPress
// upload). Without care that is a server-side request forgery (SSRF) primitive: point it at
// http://169.254.169.254/ (the cloud metadata service) or an internal host and the server will
// happily call it for you. The first version of the scraper checked the hostname once, up front —
// which is bypassed by (a) a public URL that 302-redirects to a private one and (b) a public-looking
// DNS name that resolves to a private address. Both are closed here:
//
//   · EVERY hop of a redirect chain is re-validated (redirects are followed by hand, max 4).
//   · The hostname is RESOLVED and every returned address must be public.
//   · The body is read as a stream and abandoned the moment it passes the byte cap, instead of
//     being buffered whole and measured afterwards.
//
// Known limit, stated plainly: there is a tiny window between our DNS lookup and fetch()'s own
// lookup (DNS rebinding). Closing that needs a pinned-IP dispatcher; this narrows the hole from
// "trivial" to "needs a hostile authoritative DNS server racing the request", and the callers are
// all session-gated and rate-limited. Underscore-prefixed on purpose: not a serverless function.

import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home.arpa"];

export function isPrivateIp(ip) {
  ip = String(ip || "").toLowerCase().trim();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
    if (a === 169 && b === 254) return true;               // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;                 // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
    if (a >= 224) return true;                             // multicast / reserved / broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4-mapped
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^f[cd]/.test(ip)) return true;                    // unique local fc00::/7
    if (/^fe[89ab]/.test(ip)) return true;                 // link-local fe80::/10
    if (/^ff/.test(ip)) return true;                       // multicast
    return false;
  }
  return true; // not an IP at all: caller passed junk — treat as unsafe
}

// Cheap, synchronous, no DNS: literal hosts that are obviously internal.
export function isPrivateHost(host) {
  host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

// Throws unless the host is public AND everything it resolves to is public.
export async function assertPublicHost(host, lookup = (h) => dns.lookup(h, { all: true })) {
  if (isPrivateHost(host)) throw new Error("HOST_NOT_ALLOWED");
  if (net.isIP(String(host).replace(/^\[|\]$/g, ""))) return;          // a public literal IP: done
  let addrs;
  try { addrs = await lookup(host); } catch { throw new Error("HOST_UNRESOLVABLE"); }
  if (!addrs || !addrs.length) throw new Error("HOST_UNRESOLVABLE");
  if (addrs.some((a) => isPrivateIp(a.address || a))) throw new Error("HOST_NOT_ALLOWED");
}

// fetch() with every redirect hop validated and the body capped. Returns { res, buf }.
// opts: { maxBytes, maxRedirects, timeoutMs, lookup, fetchImpl }
export async function safeFetch(url, init = {}, opts = {}) {
  const { maxBytes = 8 * 1024 * 1024, maxRedirects = 4, timeoutMs = 10000, lookup, fetchImpl = fetch } = opts;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = new URL(url);
    for (let hop = 0; ; hop++) {
      if (!/^https?:$/.test(current.protocol)) throw new Error("BAD_PROTOCOL");
      await assertPublicHost(current.hostname, lookup);
      const res = await fetchImpl(current.toString(), { ...init, redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= maxRedirects) throw new Error("TOO_MANY_REDIRECTS");
        try { await res.body?.cancel?.(); } catch { /* ignore */ }
        current = new URL(res.headers.get("location"), current);     // resolves relative redirects
        continue;
      }
      const chunks = []; let total = 0;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("TOO_LARGE"); }
          chunks.push(Buffer.from(value));
        }
      } else {
        const b = Buffer.from(await res.arrayBuffer());
        if (b.length > maxBytes) throw new Error("TOO_LARGE");
        chunks.push(b);
      }
      return { res, buf: Buffer.concat(chunks), url: current.toString() };
    }
  } finally {
    clearTimeout(tid);
  }
}
