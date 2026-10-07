// Volt — scheduled-posting health. © 2026 Tshepho Joel.
//
// GET /api/queuehealth → { summary: { healthy, overdue, oldestOverdueMinutes, stuck, errors24h, unreachable }, queues }
//
// Why this exists: scheduled posts are published by an external trigger hitting the drain endpoints.
// If that trigger stops (or runs hours late, which GitHub's scheduler does), nothing in the product
// said so — a dead scheduler looked identical to a healthy one with nothing due. The signal that
// needs no heartbeat table is the posts themselves: a post whose time has passed and is STILL pending
// proves the drain isn't keeping up. Schedule and Health both read this.

import { blocked } from "../_guard.js";
import { queueHealth } from "../_queue.js";

export default async function handler(req, res) {
  if (await blocked(req, res, { methods: "GET, OPTIONS", method: "GET", id: "queuehealth", limit: 60, windowSec: 60 })) return;
  try {
    const h = await queueHealth(req.volt.orgId);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(Object.assign({ ok: true }, h));
  } catch (err) {
    return res.status(502).json({ error: (err && err.message) || "Could not read the queue health." });
  }
}
