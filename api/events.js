// Volt — content event beacon (the flywheel's labels). © 2026 Tshepho Joel.
// POST { contentId?, event, detail? } → content_event. Best-effort: always 200, never
// errors the client (this must never interrupt a user action).

import { blocked, logEvent } from "./_guard.js";

export default async function handler(req, res) {
  if (await blocked(req, res, { id: "events", limit: 200, windowSec: 60 })) return;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const event = String(body.event || "").trim();
    if (event) {
      const detail = (body.detail && typeof body.detail === "object") ? body.detail : {};
      await logEvent(req.volt && req.volt.orgId, body.contentId || null, event, detail);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
