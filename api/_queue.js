// Volt — scheduled-post queue helpers shared by the Instagram, Facebook and TikTok drains.
// © 2026 Tshepho Joel. Underscore-prefixed on purpose: not a serverless function.
//
// A drain CLAIMS a row (pending → publishing) before it publishes, which is what stops two
// overlapping runs double-posting. The cost of that design: if the function dies after the claim
// (timeout, crash, a deploy rolling), the row sits in 'publishing' forever — the drain only selects
// 'pending', so nothing ever looks at it again. The post may or may not have gone out, and nobody is
// told. reapStuck() turns that silent loss into a VISIBLE error on the Schedule calendar.
//
// It deliberately does NOT retry. For Instagram especially, "stuck" can mean the post is already
// live and only the bookkeeping failed; an automatic retry would then post it twice. The honest
// state is "interrupted — check the platform", and a person decides.

import { sbPatch, db } from "./_guard.js";

export const STUCK_MINUTES = 15;     // far longer than any real publish (IG polls ~40 s at most)
export const OVERDUE_MINUTES = 10;   // a due post still pending this long means the drain isn't running
export const QUEUES = { instagram: "ig_queue", facebook: "fb_queue", tiktok: "tiktok_queue" };

export async function reapStuck(table, minutes = STUCK_MINUTES) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  const rows = await sbPatch(table, "status=eq.publishing&updated_at=lt." + encodeURIComponent(cutoff), {
    status: "error",
    error: "Publishing was interrupted before it finished. Check the platform to see whether it went out before posting again.",
    updated_at: new Date().toISOString(),
  });
  return Array.isArray(rows) ? rows.length : 0;
}

// One org's view of its queues. `unreachable` means the database call itself failed — which is a
// different (and worse) state than "no posts waiting".
export async function queueHealth(orgId, now = Date.now()) {
  const store = db(orgId);
  const iso = (ms) => encodeURIComponent(new Date(ms).toISOString());
  const out = {};
  for (const [name, table] of Object.entries(QUEUES)) {
    const overdue = await store.select(table, "select=id,run_at&status=eq.pending&run_at=lt." + iso(now - OVERDUE_MINUTES * 60000) + "&order=run_at.asc&limit=100");
    const stuck = await store.select(table, "select=id&status=eq.publishing&updated_at=lt." + iso(now - STUCK_MINUTES * 60000) + "&limit=100");
    const errors = await store.select(table, "select=id&status=eq.error&updated_at=gt." + iso(now - 24 * 3600000) + "&limit=100");
    if (overdue === null || stuck === null || errors === null) { out[name] = { unreachable: true }; continue; }
    out[name] = {
      overdue: overdue.length,
      oldestOverdueMinutes: overdue.length ? Math.round((now - new Date(overdue[0].run_at).getTime()) / 60000) : 0,
      stuck: stuck.length,
      errors24h: errors.length,
    };
  }
  const all = Object.values(out);
  const summary = {
    overdue: all.reduce((n, q) => n + (q.overdue || 0), 0),
    oldestOverdueMinutes: all.reduce((m, q) => Math.max(m, q.oldestOverdueMinutes || 0), 0),
    stuck: all.reduce((n, q) => n + (q.stuck || 0), 0),
    errors24h: all.reduce((n, q) => n + (q.errors24h || 0), 0),
    unreachable: all.some((q) => q.unreachable),
  };
  summary.healthy = !summary.unreachable && summary.overdue === 0 && summary.stuck === 0;
  return { queues: out, summary };
}
