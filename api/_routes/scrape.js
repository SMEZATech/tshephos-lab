// Volt — server-side article/image fetcher for Studio's Auto-Fill. © 2026 Tshepho Joel.
// Replaces flaky public CORS proxies: fetches the page (or image) server-side with a real
// browser User-Agent (bypasses most bot blocks) and returns it with permissive CORS so the
// canvas can use images untainted. Public utility — no app key, but rate-limited + SSRF-guarded.

import { setCors, rateLimit } from "../_guard.js";

function isPrivateHost(host) {
  host = String(host || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":")) return true; // raw IPv6 (covers ::1, etc.)
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;                          // multicast / reserved
  }
  return false;
}

export default async function handler(req, res) {
  setCors(req, res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const rl = await rateLimit(req, { id: "scrape", limit: 20, windowSec: 60 });
  if (!rl.ok) return res.status(429).json({ error: "Too many requests — slow down and try again shortly." });

  const target = String((req.query && req.query.url) || "");
  let u;
  try { u = new URL(target); } catch { return res.status(400).json({ error: "Invalid URL." }); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: "Only http/https URLs are allowed." });
  if (isPrivateHost(u.hostname)) return res.status(400).json({ error: "That host isn't allowed." });

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(tid);
    if (!r.ok) return res.status(502).json({ error: "Could not fetch the page (" + r.status + ")." });

    const ct = r.headers.get("content-type") || "text/html; charset=utf-8";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: "Resource too large." });

    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(buf);
  } catch (err) {
    const msg = (err && err.name === "AbortError") ? "The site took too long to respond." : "Cannot reach that site.";
    return res.status(502).json({ error: msg });
  }
}
