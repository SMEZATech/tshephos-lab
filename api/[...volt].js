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

const ROUTES = { kit, image, upload, scrape, assets, billing, paystack, brain };

export default async function handler(req, res) {
  // Vercel gives the catch-all its segments under the filename's param. Guard the shape rather
  // than trusting it: a bad path must 404, never throw a 500 that looks like an outage.
  const seg = req.query && req.query.volt;
  const name = String((Array.isArray(seg) ? seg[0] : seg) || "").toLowerCase();
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;

  if (!fn) {
    return res.status(404).json({ error: "Unknown endpoint", endpoint: name || null, available: Object.keys(ROUTES) });
  }
  // Each handler still owns its own auth, CORS and rate limit (they all start with blocked() or
  // setCors()), so routing deliberately adds no policy of its own — one place to reason about it.
  return fn(req, res);
}
