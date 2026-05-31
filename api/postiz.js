// Volt — Postiz analytics proxy. © 2026 Tshepho Joel. All rights reserved.
// Keeps your Postiz API key on the server, never in the browser.
//
// Set these env vars in Vercel (Project Settings → Environment Variables), then redeploy:
//   POSTIZ_API_KEY  — your Postiz public API key
//   POSTIZ_API_URL  — the API base of your instance, INCLUDING the version path:
//                       self-hosted : https://YOUR-POSTIZ-DOMAIN/api/public/v1
//                       hosted cloud: https://api.postiz.com/public/v1
//
// Docs: https://docs.postiz.com/public-api

function baseUrl() {
  const b = process.env.POSTIZ_API_URL || "https://api.postiz.com/public/v1";
  return String(b).replace(/\/+$/, "");
}

async function postizGet(path) {
  const key = process.env.POSTIZ_API_KEY;
  if (!key) throw Object.assign(new Error("POSTIZ_API_KEY is not set"), { code: "NOT_CONFIGURED" });
  const r = await fetch(baseUrl() + path, { headers: { Authorization: key } });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!r.ok) {
    const msg =
      (data && data.message) ||
      (typeof data === "string" ? data.slice(0, 200) : "") ||
      ("Postiz request failed (" + r.status + ")");
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.POSTIZ_API_KEY) {
      return res.status(503).json({
        error: "NOT_CONFIGURED",
        message: "Postiz isn't connected. Add POSTIZ_API_URL + POSTIZ_API_KEY in Vercel, then redeploy.",
      });
    }

    const q = req.query || {};
    const action = String(q.action || "channels");

    // List the social channels connected inside Postiz
    if (action === "channels") {
      const list = await postizGet("/integrations");
      const arr = Array.isArray(list) ? list : (list && (list.integrations || list.data)) || [];
      const channels = arr
        .map((c) => ({
          id: c.id || c.integrationId || c._id || "",
          name: c.name || c.displayName || c.profile || "Channel",
          platform: c.identifier || c.providerIdentifier || c.provider || c.type || "",
          picture: (c.picture && (c.picture.path || c.picture)) || c.avatar || "",
          disabled: !!c.disabled,
        }))
        .filter((c) => c.id);
      return res.status(200).json({ channels });
    }

    // Pull platform analytics for one channel over a look-back window
    if (action === "analytics") {
      const id = String(q.id || "");
      const days = Math.max(1, Math.min(365, parseInt(q.days || "30", 10) || 30));
      if (!id) return res.status(400).json({ error: "Missing channel id" });

      const raw = await postizGet("/analytics/" + encodeURIComponent(id) + "?date=" + days);
      const series = Array.isArray(raw) ? raw : (raw && raw.analytics) || [];
      const metrics = series
        .map((m) => {
          const data = Array.isArray(m.data) ? m.data : [];
          const nums = data.map((d) => Number(d.total)).filter((n) => Number.isFinite(n));
          const latest = nums.length ? nums[nums.length - 1] : null;
          const first = nums.length ? nums[0] : null;
          let pc =
            m.percentageChange != null && Number.isFinite(Number(m.percentageChange))
              ? Number(m.percentageChange)
              : null;
          if (pc == null && first != null && first !== 0 && latest != null) {
            pc = ((latest - first) / first) * 100;
          }
          return {
            label: String(m.label || "Metric"),
            latest,
            first,
            percentageChange: pc,
            points: data
              .map((d) => ({ date: d.date, total: Number(d.total) }))
              .filter((d) => Number.isFinite(d.total)),
          };
        })
        .filter((m) => m.label);
      return res.status(200).json({ days, metrics });
    }

    // Rank a channel's recent published posts by engagement (frugal: 1 list + capped per-post calls)
    if (action === "topposts") {
      const integ = String(q.id || "");
      const days = Math.max(1, Math.min(365, parseInt(q.days || "30", 10) || 30));
      const limit = Math.max(1, Math.min(10, parseInt(q.limit || "6", 10) || 6));
      const end = new Date();
      const start = new Date(end.getTime() - days * 86400000);
      const list = await postizGet(
        "/posts?startDate=" + encodeURIComponent(start.toISOString()) + "&endDate=" + encodeURIComponent(end.toISOString())
      );
      let posts = (list && (list.posts || list.data)) || [];
      if (!Array.isArray(posts)) posts = [];
      if (integ) posts = posts.filter((p) => p && p.integration && p.integration.id === integ);
      // keep published posts only (skip queued/draft/error)
      posts = posts.filter((p) => p && (p.releaseURL || (p.state && !["QUEUE", "DRAFT", "ERROR"].includes(String(p.state).toUpperCase()))));
      posts.sort((a, b) => new Date(b.publishDate || 0) - new Date(a.publishDate || 0));
      posts = posts.slice(0, limit);

      const engKeys = /like|comment|share|save|reaction|repost|retweet|favorite|engag/i;
      const enriched = await Promise.all(
        posts.map(async (p) => {
          let metrics = [];
          try {
            const a = await postizGet("/analytics/post/" + encodeURIComponent(p.id) + "?date=" + days);
            const series = Array.isArray(a) ? a : (a && a.analytics) || [];
            metrics = series
              .map((m) => {
                const data = Array.isArray(m.data) ? m.data : [];
                const nums = data.map((d) => Number(d.total)).filter((n) => Number.isFinite(n));
                return { label: String(m.label || ""), value: nums.length ? nums[nums.length - 1] : null };
              })
              .filter((m) => m.label);
          } catch (e) {
            metrics = [];
          }
          const engagement = metrics
            .filter((m) => engKeys.test(m.label) && m.value != null)
            .reduce((s, m) => s + m.value, 0);
          return {
            id: p.id,
            content: String(p.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
            publishDate: p.publishDate || "",
            url: p.releaseURL || "",
            metrics,
            engagement,
          };
        })
      );
      enriched.sort((a, b) => b.engagement - a.engagement);
      return res.status(200).json({ days, topPosts: enriched });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    if (err && err.code === "NOT_CONFIGURED") {
      return res.status(503).json({ error: "NOT_CONFIGURED", message: err.message });
    }
    const auth = err && (err.status === 401 || err.status === 403);
    return res.status(auth ? 401 : 502).json({ error: (err && err.message) || "Postiz error" });
  }
}
