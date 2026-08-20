// Volt — API router. © 2026 Tshepho Joel.
//
// WHY THIS EXISTS: Vercel's Hobby tier caps a project at 12 serverless functions and api/ had
// exactly 12. The next endpoint would have failed the deploy, with an error that looks nothing
// like the change that caused it — and every future capability (publish-to-Postiz, webhooks, share
// links, per-user auth) was blocked behind an unplanned refactor.
//
// The eight smallest handlers now live in api/_routes/ (the leading underscore keeps Vercel from
// routing them) and this ONE catch-all dispatches to them. 12 functions -> 5.
//
// PUBLIC URLS ARE UNCHANGED. Vercel resolves static routes before dynamic ones, so /api/generate
// still hits api/generate.js while /api/kit falls through to here. No client, no desktop build and
// no saved integration had to change — which is the whole point, because the desktop app loads its
// pages from this deployment and a URL change would have broken every installed copy at once.
//
// The four hot or heavy endpoints stay as their own functions on purpose: generate and transcribe
// are the expensive paths and deserve their own cold-start and duration budget, and keeping them
// isolated means a fault in a rarely-used proxy cannot take generation down with it.

import kit from "./_routes/kit.js";
import image from "./_routes/image.js";
import upload from "./_routes/upload.js";
import scrape from "./_routes/scrape.js";
import assets from "./_routes/assets.js";
import billing from "./_routes/billing.js";
import paystack from "./_routes/paystack.js";
import brain from "./_routes/brain.js";
import instagram from "./_routes/instagram.js";

const ROUTES = { kit, image, upload, scrape, assets, billing, paystack, brain, instagram };

// Resolve the endpoint name (e.g. "kit" for /api/kit). Vercel is SUPPOSED to expose the catch-all
// segments under the filename's param (req.query.volt), but for plain (non-Next) Node functions it
// does NOT reliably populate it — in production it arrived empty, so every routed endpoint 404'd
// with "Unknown endpoint" (kit/scrape/image/upload/billing/brain/...). So the URL path is the
// source of truth: take the segment right after "/api/". The param is kept as a fast path for the
// environments that do bind it. Guard the shape either way: a bad path must 404, never 500.
function endpointName(req) {
  const seg = req && req.query && req.query.volt;
  let name = Array.isArray(seg) ? seg[0] : seg;
  if (!name) {
    const path = String((req && req.url) || "").split("?")[0];
    const parts = path.split("/").filter(Boolean); // "/api/kit" -> ["api","kit"]
    const i = parts.indexOf("api");
    name = i >= 0 ? parts[i + 1] : parts[0];        // also handles a "/kit" form (no /api prefix)
  }
  return String(name || "").toLowerCase();
}

export default async function handler(req, res) {
  const name = endpointName(req);
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;

  if (!fn) {
    return res.status(404).json({ error: "Unknown endpoint", endpoint: name || null, available: Object.keys(ROUTES) });
  }
  // Each handler still owns its own auth, CORS and rate limit (they all start with blocked() or
  // setCors()), so routing deliberately adds no policy of its own — one place to reason about it.
  return fn(req, res);
}
