// Volt — server-side article/image fetcher. © 2026 Tshepho Joel.
// Replaces flaky public CORS proxies: fetches the page (or image) server-side with a real browser
// User-Agent (bypasses most bot blocks) and returns it from OUR origin, so the canvas can use the
// bytes and no cross-origin fetch is needed. This is what lets the desktop shell run with
// webSecurity ON — WordPress uploads send no CORS headers, so fetching them directly only ever
// worked because same-origin enforcement was off.
//
// NOW SESSION-GATED. It used to be a deliberate "public utility" with no auth, which made it an
// open proxy: anyone could pipe arbitrary content through this project's bandwidth, rate-limited
// only per-IP. Every real caller (Studio auto-fill, brand logos, featured images) is a signed-in
// org user, so requiring a session costs nothing and closes the abuse surface.
//
// `?img=1` additionally refuses anything that isn't an image and caches hard — used for the asset
// path, where returning HTML would only ever be a redirect page or an error.

import { blocked } from "../_guard.js";
import { isPrivateHost, safeFetch } from "../_net.js";

export default async function handler(req, res) {
  // blocked() does CORS, session auth and rate limiting, and fails CLOSED.
  if (await blocked(req, res, { methods: "GET, OPTIONS", method: "GET", id: "scrape", limit: 60, windowSec: 60 })) return;

  const wantImage = String((req.query && req.query.img) || "") === "1";
  const target = String((req.query && req.query.url) || "");
  let u;
  try { u = new URL(target); } catch { return res.status(400).json({ error: "Invalid URL." }); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: "Only http/https URLs are allowed." });
  if (isPrivateHost(u.hostname)) return res.status(400).json({ error: "That host isn't allowed." });   // fast path; safeFetch re-checks every hop

  try {
    const { res: r, buf } = await safeFetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, { maxBytes: 8 * 1024 * 1024, timeoutMs: 10000 });
    if (!r.ok) return res.status(502).json({ error: "Could not fetch the page (" + r.status + ")." });

    const ct = r.headers.get("content-type") || (wantImage ? "application/octet-stream" : "text/html; charset=utf-8");
    // In image mode, anything that isn't an image is a redirect/consent/error page, never the asset
    // we asked for — say so instead of handing the canvas a chunk of HTML to choke on.
    if (wantImage && !/^image\//i.test(ct)) return res.status(415).json({ error: "That URL didn't return an image (" + ct.split(";")[0] + ")." });

    res.setHeader("Content-Type", ct);
    // Brand logos and featured images don't change; a long immutable cache keeps this off the
    // critical path (and off the bandwidth bill) after the first load.
    res.setHeader("Cache-Control", wantImage ? "public, max-age=86400, immutable" : "public, max-age=300");
    return res.status(200).send(buf);
  } catch (err) {
    const m = String((err && err.message) || "");
    if (m === "TOO_LARGE") return res.status(413).json({ error: "Resource too large." });
    if (m === "HOST_NOT_ALLOWED" || m === "BAD_PROTOCOL") return res.status(400).json({ error: "That host isn't allowed." });
    if (m === "TOO_MANY_REDIRECTS") return res.status(502).json({ error: "That link redirects too many times." });
    const msg = (err && err.name === "AbortError") ? "The site took too long to respond." : "Cannot reach that site.";
    return res.status(502).json({ error: msg });
  }
}
