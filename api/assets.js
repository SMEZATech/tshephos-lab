// Volt — free design-asset search proxy (Freeform's Canva-style asset panel). © 2026 Tshepho Joel.
// GET ?kind=photos|gifs|icons&q=<query>
//
// Providers (all free tiers, keys optional — keyless fallbacks mean the panel ALWAYS works):
//   photos: Unsplash (UNSPLASH_ACCESS_KEY) → Pexels (PEXELS_API_KEY) → Openverse (no key)
//   gifs:   Giphy (GIPHY_API_KEY) — returns a friendly note when no key is set
//   icons:  Iconify (no key)
// Normalized response: { provider, results: [{ thumb, full, alt, credit }] }

import { blocked } from "./_guard.js";

const J = (r) => r.ok ? r.json() : Promise.reject(new Error("upstream " + r.status));

async function photos(q) {
  const uKey = process.env.UNSPLASH_ACCESS_KEY;
  if (uKey) {
    try {
      const d = await J(await fetch("https://api.unsplash.com/search/photos?per_page=24&query=" + encodeURIComponent(q), {
        headers: { Authorization: "Client-ID " + uKey } }));
      const results = (d.results || []).map((p) => ({
        thumb: p.urls && p.urls.small, full: p.urls && (p.urls.regular || p.urls.full),
        alt: p.alt_description || "", credit: (p.user && p.user.name ? p.user.name + " · Unsplash" : "Unsplash"),
      })).filter((x) => x.thumb && x.full);
      if (results.length) return { provider: "unsplash", results };
    } catch (e) {}
  }
  const pKey = process.env.PEXELS_API_KEY;
  if (pKey) {
    try {
      const d = await J(await fetch("https://api.pexels.com/v1/search?per_page=24&query=" + encodeURIComponent(q), {
        headers: { Authorization: pKey } }));
      const results = (d.photos || []).map((p) => ({
        thumb: p.src && p.src.medium, full: p.src && (p.src.large2x || p.src.large),
        alt: p.alt || "", credit: (p.photographer ? p.photographer + " · Pexels" : "Pexels"),
      })).filter((x) => x.thumb && x.full);
      if (results.length) return { provider: "pexels", results };
    } catch (e) {}
  }
  // Keyless: Openverse (CC images) — has started requiring auth for some anon traffic, so tolerate failure
  try {
    const d = await J(await fetch("https://api.openverse.org/v1/images/?page_size=24&q=" + encodeURIComponent(q), {
      headers: { "User-Agent": "VoltMarketing/1.0 (smesouthafrica.co.za)" } }));
    const results = (d.results || []).map((p) => ({
      thumb: p.thumbnail || p.url, full: p.url,
      alt: p.title || "", credit: (p.creator ? p.creator + " · Openverse (CC)" : "Openverse (CC)"),
    })).filter((x) => x.thumb && x.full);
    if (results.length) return { provider: "openverse", results };
  } catch (e) {}
  // Keyless FLOOR: Wikimedia Commons — open API, no key, no auth, ever
  const cd = await J(await fetch("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(q) + "&gsrnamespace=6&gsrlimit=24&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=400&format=json&origin=*", {
    headers: { "User-Agent": "VoltMarketing/1.0 (smesouthafrica.co.za)" } }));
  const pages = (cd.query && cd.query.pages) ? Object.values(cd.query.pages) : [];
  return {
    provider: "wikimedia",
    results: pages.map((p) => {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !/\.(jpe?g|png|webp)$/i.test(ii.url || "")) return null;
      const artist = ii.extmetadata && ii.extmetadata.Artist && String(ii.extmetadata.Artist.value || "").replace(/<[^>]+>/g, "").slice(0, 40);
      return { thumb: ii.thumburl || ii.url, full: ii.url, alt: String(p.title || "").replace(/^File:/, ""),
               credit: (artist ? artist + " · " : "") + "Wikimedia Commons" };
    }).filter(Boolean),
  };
}

async function gifs(q) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return { provider: "none", results: [], note: "GIFs need a free Giphy key — add GIPHY_API_KEY in Vercel (developers.giphy.com)." };
  const d = await J(await fetch("https://api.giphy.com/v1/gifs/search?limit=24&api_key=" + key + "&q=" + encodeURIComponent(q)));
  return {
    provider: "giphy",
    results: (d.data || []).map((g) => ({
      thumb: g.images && g.images.fixed_width && g.images.fixed_width.url,
      full: g.images && ((g.images.original && g.images.original.url) || (g.images.downsized_large && g.images.downsized_large.url)),
      alt: g.title || "", credit: "Giphy",
    })).filter((x) => x.thumb && x.full),
  };
}

async function icons(q) {
  const d = await J(await fetch("https://api.iconify.design/search?limit=32&query=" + encodeURIComponent(q)));
  return {
    provider: "iconify",
    results: (d.icons || []).map((name) => {
      const [prefix, icon] = String(name).split(":");
      if (!prefix || !icon) return null;
      const base = "https://api.iconify.design/" + prefix + "/" + icon + ".svg";
      return { thumb: base + "?height=64", full: base + "?height=512", alt: name, credit: "Iconify" };
    }).filter(Boolean),
  };
}

export default async function handler(req, res) {
  if (await blocked(req, res, { methods: "GET, OPTIONS", method: "GET", id: "assets", limit: 60, windowSec: 60 })) return;
  try {
    const q = String(req.query.q || "").trim().slice(0, 80);
    const kind = String(req.query.kind || "photos").toLowerCase();
    if (!q) return res.status(400).json({ error: "Add a search term." });
    const out = kind === "gifs" ? await gifs(q) : kind === "icons" ? await icons(q) : await photos(q);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json(out);
  } catch (err) {
    return res.status(502).json({ error: "Asset search failed — " + ((err && err.message) || "upstream error") });
  }
}
