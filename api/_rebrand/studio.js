// Volt — SMESA 2026 Studio families (gated; see index.js). © 2026 Tshepho Joel.
//
// Nine families from the approved concepts (rebrand-2026/SMESA-Rebrand-2026-Concepts.html), drawn on
// the ONE Studio engine: r26Engine below is stringified, posted into studio-engine.js's worker
// ('install-r26') and evaluated there, so it calls the worker's own CanvasRenderer — the same code
// path for preview, export and the render tests. Nothing here runs in Node; Node only reads it.
//
// Rules the code holds itself to (from the 2026 CI):
//   · Plus Jakarta Sans 700–800 for headings/UI, Inter 400–500 for body. No Oswald.
//   · Only the CI neutrals. Navy is a surface, ink is text. Orange is never small text.
//   · The accent gradient is the ONE hero CTA per design (plus the gradient emphasis word).
//   · Official lockups only, never recoloured: reversed on dark, light on light, cube where the
//     wordmark can't stay legible. They come from the install message, not from the Brand Kit, so
//     a 2026 design can never pick up another brand's logo.
//   · Wrap one word of a headline in *stars* to set it in the accent gradient (the concept's .grad).
// Authored at 1080 wide; vertical rhythm flexes so 1:1, 4:5 and 9:16 all render natively, and the
// story size keeps type out of Instagram's top 190 / bottom 260px. Landscape uses one shared layout
// per family (see drawLand) — the concepts don't define one.

const D = (name, fields) => ({ name, fields });

export const STUDIO_FAMILIES = {
  r26funding: { label: "Funding Alert", emoji: "⚡", photo: null, dirs: {
    a: D("Funding Alert", { pill: "Funding Alert", kicker: "Applications open · Gauteng", head: "R5 million for *women-led* manufacturers",
      sub: "Working capital and equipment finance, with a 12-month repayment holiday.",
      f1k: "Amount", f1v: "Up to R5m", f2k: "Trading", f2v: "2+ years", f3k: "Closes", f3v: "30 Nov",
      cta: "Apply Now", url: "smesouthafrica.co.za/funding" }),
  } },
  r26article: { label: "Article card", emoji: "📰", photo: "Article photo", dirs: {
    a: D("Article card", { pill: "Operations", head: "Compliance basics every small business must know",
      sub: "Tax registration, BEE and labour law: a no-jargon guide to staying on the right side of the rules.",
      author: "Thabo Molefe", meta: "8 April 2026 · 5 min read" }),
  } },
  r26number: { label: "The Number", emoji: "📊", photo: null, dirs: {
    a: D("The Number", { pill: "By the numbers", big: "73%", head: "of SA small businesses never apply for funding they qualify for.",
      source: "Source: SME South Africa, State of SA Small Business 2026" }),
  } },
  r26quote: { label: "Pull-Quote", emoji: "❝", photo: "Speaker photo (optional)", dirs: {
    a: D("The Pull-Quote", { quote: "You don't need more funding. You need a business a funder can actually say *yes* to.",
      author: "Jenna Sprenger", authorRole: "Founder & CEO, Fundrr", cta: "Read the full story →" }),
  } },
  r26founder: { label: "Founder Focus cover", emoji: "🧑‍💼", photo: "Founder portrait", dirs: {
    a: D("The Cover", { issue: "Issue 18 · Oct 2026", pill: "Interview", name: "Naledi Cele", role: "Founder & CEO, Kasi Wash",
      sub: "From one machine in a backyard to twelve sites in three provinces.", cta: "Read the interview →" }),
  } },
  r26summit: { label: "Funding Summit", emoji: "🎟️", photo: null, dirs: {
    a: D("Save the date", { kicker: "Save the date", head: "Funding *Summit* 2027",
      sub: "South Africa's biggest day for SME funding: lenders, investors and founders in one room.",
      s1v: "14", s1k: "May", s2v: "40+", s2k: "Funders", s3v: "2k", s3k: "Founders", s4v: "JHB", s4k: "Sandton",
      cta: "Get Early-Bird Tickets", url: "smesouthafrica.co.za/summit" }),
  } },
  r26weekly: { label: "The Weekly", emoji: "✉", photo: null, dirs: {
    a: D("Issue promo", { date: "12 Jun 2026", pill: "The Weekly", issue: "Issue #142", head: "The R0 marketing stack that actually converts",
      i1: "The five free tools SA founders actually keep", i2: "The WhatsApp funnel that beat paid ads", i3: "Channels that quietly waste your time",
      cta: "Subscribe free", link: "Read issue →" }),
  } },
  r26carousel: { label: "Carousel", emoji: "🎠", photo: null, dirs: {
    a: D("Cover", { kicker: "Funding-ready · A 5-part guide", head: "5 documents every *funder* asks for", swipe: "Swipe to start" }),
    b: D("Item", { pill: "Document 2 of 5", num: "02", head: "Management accounts",
      sub: "Six months, signed off. Lenders trust these over a business plan every time, because they show how the business actually runs.",
      tip: "Tip: a free cash-flow template is in Resources." }),
    c: D("CTA", { head: "Get the full *funding pack*", sub: "All five templates, free for members.", cta: "Join for Free →", save: "Save", share: "Share" }),
  } },
  r26aws: { label: "Ask · Win · Share", emoji: "💬", photo: null, dirs: {
    a: D("Ask · Win · Share", { label: "Community", head: "Members are the *cast*, not the audience.",
      ask: "\"Has anyone used invoice finance for a first big order?\"", win: "\"Landed our first retail listing this week!\"",
      share: "\"The supplier contract template that saved me R40k\"", cta: "Join the conversation →", url: "smesouthafrica.co.za" }),
  } },
};

export const FIELD_LABELS = {
  f1k: "Fact 1 label", f1v: "Fact 1", f2k: "Fact 2 label", f2v: "Fact 2", f3k: "Fact 3 label", f3v: "Fact 3",
  s1v: "Tile 1", s1k: "Tile 1 label", s2v: "Tile 2", s2k: "Tile 2 label", s3v: "Tile 3", s3k: "Tile 3 label", s4v: "Tile 4", s4k: "Tile 4 label",
  source: "Source line", date: "Date", link: "Text link", num: "Big numeral", tip: "Tip strip", swipe: "Swipe prompt",
  save: "Save label", share: "Share label", ask: "Ask", win: "Win",
};

export function studioEngineSource() {
  return "(" + r26Engine.toString() + ")();";
}

// =================================================================================================
// Everything below runs INSIDE studio-engine.js's worker. It may use the worker's globals
// (CanvasRenderer instances passed in as `r`, self.R26_ASSETS set by the install handler) and
// nothing from this module's scope.
// =================================================================================================
function r26Engine() {
  "use strict";
  try { importScripts("brand-2026.js"); } catch (e) { /* tokens inlined below as the fallback */ }
  const T = self.VoltBrand2026 || { red: "#DC183C", orange: "#FF9900", navy: "#0C1F31", ink: "#121A21", muted: "#6A7581",
    border: "#E7EBEF", slate: "#F0F5F9", bg: "#FCFCFC", green: "#29A37A", greenTint: "#E4F5EE", amber: "#AE6B0A",
    amberTint: "#FFF1E0", redTint: "#FDECEF" };
  const J = "Plus Jakarta Sans", I = "Inter";
  const WHITE = "#ffffff";
  const ART = () => self.R26_ASSETS || {};
  const ARROW = "M5 12h14M13 6l6 6-6 6";

  // ---------------------------------------------------------------- geometry
  function geo(r) {
    const W = r.w, H = r.h, k = W / 1080;
    const story = H / W > 1.7;
    const pad = Math.round(84 * k);
    return { W, H, k, pad, story, land: W > H * 1.2,
      top: story ? 250 : pad,                    // first type line
      bot: story ? H - 300 : H - pad };          // last type line's bottom
  }
  const F = (family, weight, size) => ({ family, weight: String(weight), size: Math.round(size) });

  // ---------------------------------------------------------------- surfaces
  // CSS 115deg hero, navy → wine. The 115% stop is resolved to its colour at 100% (canvas stops
  // can't exceed 1). Traced as navy: it IS navy over most of the canvas and white type clears it.
  function hero(r) {
    const c = r.ctx, W = r.w, H = r.h, a = 115 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const L = Math.abs(W * dx) + Math.abs(H * dy), cx = W / 2, cy = H / 2;
    const g = c.createLinearGradient(cx - dx * L / 2, cy - dy * L / 2, cx + dx * L / 2, cy + dy * L / 2);
    g.addColorStop(0, "#0C1F31"); g.addColorStop(0.5, "#0C1F31"); g.addColorStop(0.8, "#2b1626"); g.addColorStop(1, "#4b1a2b");
    c.save(); c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
    r._tr("fill", { x: 0, y: 0, w: W, h: H, color: "#0C1F31", bg: true });
    dots(r);
  }
  function warm(r) {
    const c = r.ctx, W = r.w, H = r.h, g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#FFF8EE"); g.addColorStop(1, "#FDEFF2");
    c.save(); c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
    r._tr("fill", { x: 0, y: 0, w: W, h: H, color: "#FFF8EE", bg: true });
  }
  // The 22px dot grid. Built once as a tile, laid as a pattern — never per-dot.
  let _dotTile = null;
  function dots(r) {
    if (!_dotTile) {
      _dotTile = new OffscreenCanvas(44, 44);
      const x = _dotTile.getContext("2d");
      x.fillStyle = "rgba(255,255,255,0.05)"; x.beginPath(); x.arc(2, 2, 2, 0, Math.PI * 2); x.fill();
    }
    const c = r.ctx; c.save(); c.scale(0.5, 0.5); c.fillStyle = c.createPattern(_dotTile, "repeat");
    c.fillRect(0, 0, r.w * 2, r.h * 2); c.restore();
  }
  // A blurred blob (CSS filter:blur(80px)) as a radial falloff — no ctx.filter, ever.
  function glow(r, cx, cy, d, rgb, alpha) {
    const c = r.ctx, R = d / 2 + 90, g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, "rgba(" + rgb + "," + alpha + ")");
    g.addColorStop(Math.max(0.01, Math.min(0.95, (d / 2 - 40) / R)), "rgba(" + rgb + "," + (alpha * 0.85) + ")");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    c.save(); c.fillStyle = g; c.fillRect(cx - R, cy - R, R * 2, R * 2); c.restore();
  }
  const RED = "220,24,60", ORANGE = "255,153,0";
  function accentGrad(c, x, y, w, h) {
    const g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#DC183C"); g.addColorStop(1, "#FF9900"); return g;
  }
  // The concept's photo placeholder — used whenever no photo is loaded, so the design still reads.
  function photo(r, x, y, w, h, img, clip, fy) {
    const c = r.ctx;
    c.save();
    if (clip === "circle") { c.beginPath(); c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); c.clip(); }
    else if (clip) { r.roundRectPath(x, y, w, h, clip); c.clip(); }
    else { c.beginPath(); c.rect(x, y, w, h); c.clip(); }      // the glows must never leave the photo box
    if (img) {
      const sc = Math.max(w / img.width, h / img.height), sw = w / sc, sh = h / sc;
      c.drawImage(img, (img.width - sw) * 0.5, (img.height - sh) * (fy == null ? 0.4 : fy), sw, sh, x, y, w, h);
    } else {
      const g = c.createLinearGradient(x, y, x + w * 0.55, y + h);
      g.addColorStop(0, "#3a4f66"); g.addColorStop(0.48, "#22344a"); g.addColorStop(1, "#2b1d2a");
      c.fillStyle = g; c.fillRect(x, y, w, h);
      glow(r, x + w * 0.78, y + h * 0.18, Math.max(w, h) * 0.7, ORANGE, 0.22);
      glow(r, x + w * 0.15, y + h * 0.9, Math.max(w, h) * 0.7, RED, 0.24);
      c.strokeStyle = "rgba(255,255,255,0.035)"; c.lineWidth = 2;
      for (let s = -h; s < w + h; s += 26) { c.beginPath(); c.moveTo(x + s, y); c.lineTo(x + s - h, y + h); c.stroke(); }
    }
    c.restore();
    r._tr("image", { x, y, w, h });
  }

  // ---------------------------------------------------------------- type
  // Rich text: "*word*" runs are set in the accent gradient. Lines are arrays of {t, g} tokens.
  function tokens(s) {
    const out = [];
    String(s == null ? "" : s).split(/(\*[^*]+\*)/).forEach((seg) => {
      if (!seg) return;
      const g = /^\*[^*]+\*$/.test(seg), t = g ? seg.slice(1, -1) : seg;
      t.split(/(\s+)/).forEach((w) => { if (w) out.push({ t: w, g, sp: /^\s+$/.test(w) }); });
    });
    return out;
  }
  const plain = (s) => String(s == null ? "" : s).replace(/\*/g, "");
  function setF(r, font, ls) { r.setFont(font); try { r.ctx.letterSpacing = (ls || 0) + "px"; r.ctx.fontKerning = "normal"; } catch (e) {} }
  function unsetLs(r) { try { r.ctx.letterSpacing = "0px"; } catch (e) {} }
  function tw(r, s, font, ls) { setF(r, font, ls); const w = r.ctx.measureText(String(s)).width; unsetLs(r); return w; }
  function wrapRich(r, s, font, maxW, ls) {
    const toks = tokens(s), lines = []; let cur = [], curW = 0;
    setF(r, font, ls);
    const m = (t) => r.ctx.measureText(t).width;
    // Spaces are kept exactly where the copy had them, so "*cast*, not" stays "cast, not".
    for (const tk of toks) {
      if (tk.sp) { if (cur.length) { cur.push({ t: " ", sp: true, g: false }); curW += m(" "); } continue; }
      const w = m(tk.t);
      if (cur.length && curW + w > maxW) {
        while (cur.length && cur[cur.length - 1].sp) cur.pop();
        if (cur.length) lines.push(cur);
        cur = []; curW = 0;
      }
      cur.push(tk); curW += w;
    }
    while (cur.length && cur[cur.length - 1].sp) cur.pop();
    if (cur.length) lines.push(cur);
    unsetLs(r);
    return lines;
  }
  // Largest size in [min,max] whose wrap fits maxW × maxH (and never breaks inside a word).
  function fit(r, s, fam, wt, maxW, maxH, lh, lsEm, max, min, maxLines) {
    let lo = Math.max(10, Math.floor(min)), hi = Math.floor(max), best = null;
    const tryS = (sz) => {
      const font = F(fam, wt, sz), ls = lsEm * sz, lines = wrapRich(r, s, font, maxW, ls);
      const widest = Math.max(0, ...lines.map((l) => tw(r, l.map((t) => t.t).join(""), font, ls)));
      const ok = lines.length * sz * lh <= maxH && widest <= maxW + 1 && (!maxLines || lines.length <= maxLines);
      return { ok, font, ls, lines, h: lines.length * sz * lh, size: sz, lh };
    };
    const top = tryS(hi); if (top.ok) return top;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1, t = tryS(mid); if (t.ok) { lo = mid; best = t; } else hi = mid; }
    return best || tryS(lo);
  }
  // Draw fitted/wrapped lines. CSS half-leading is applied so a block sits where the concept's
  // line box puts it. Each line is traced once, in its base colour (a gradient run has no single
  // colour to contrast-check, which is fine: the gradient only ever sits on a dark or warm surface).
  function drawRich(r, b, x, y, boxW, color, align) {
    const c = r.ctx, size = b.font.size, lh = b.lh || 1.1, half = (lh - 1) / 2 * size;
    setF(r, b.font, b.ls);
    c.save(); c.textBaseline = "top";
    b.lines.forEach((line, i) => {
      const ly = y + i * size * lh + half;
      const widths = line.map((t) => c.measureText(t.t).width), w = widths.reduce((a, v) => a + v, 0);
      let lx = x; if (align === "center") lx = x + (boxW - w) / 2; else if (align === "right") lx = x + boxW - w;
      // gradient runs: one gradient per contiguous run, spanning the run's own box
      let cx = lx;
      for (let j = 0; j < line.length; j++) {
        const t = line[j];
        if (t.g) {
          let k = j, rw = 0; while (k < line.length && (line[k].g || (line[k].sp && line[k + 1] && line[k + 1].g))) { rw += widths[k]; k++; }
          c.fillStyle = accentGrad(c, cx, ly, rw, size);
          for (let q = j; q < k; q++) { if (!r.suppressText) c.fillText(line[q].t, cx, ly); cx += widths[q]; }
          j = k - 1; continue;
        }
        c.fillStyle = color; if (!r.suppressText) c.fillText(t.t, cx, ly); cx += widths[j];
      }
      const txt = line.map((t) => t.t).join("");
      if (txt.trim()) r._tr("text", { x: lx, y: ly, w, h: size, size, color, text: txt, family: b.font.family, weight: b.font.weight, align: align || "left", lineHeight: lh });
    });
    c.restore(); unsetLs(r);
    return b.h;
  }
  // One line, no wrap, optional tracking (em) and uppercase. Returns its width.
  function line(r, s, font, x, y, color, o) {
    o = o || {};
    let t = String(s == null ? "" : s); if (o.upper) t = t.toUpperCase();
    if (!t.trim()) return 0;
    const ls = (o.ls || 0) * font.size;
    // Never leave the box: shrink to fit the width it was given.
    if (o.maxW) { const w0 = tw(r, t, font, ls); if (w0 > o.maxW) font = F(font.family, font.weight, Math.max(10, Math.floor(font.size * o.maxW / w0))); }
    setF(r, font, (o.ls || 0) * font.size);
    const c = r.ctx, w = c.measureText(t).width;
    let lx = x; if (o.align === "center") lx = x - w / 2; else if (o.align === "right") lx = x - w;
    c.save(); c.textBaseline = "top";
    c.fillStyle = o.grad ? accentGrad(c, lx, y, w, font.size) : color;
    if (!r.suppressText) c.fillText(t, lx, y);
    c.restore(); unsetLs(r);
    r._tr("text", { x: lx, y, w, h: font.size, size: font.size, color: o.grad ? null : color, text: t, family: font.family, weight: font.weight, align: o.align || "left", lineHeight: 1 });
    return w;
  }
  // Plain wrapped paragraph (body copy) — wraps, never shrinks below `min`, clamps to maxLines.
  function para(r, s, fam, wt, size, maxW, lh, color, x, y, o) {
    o = o || {};
    if (!plain(s).trim()) return 0;
    const b = fit(r, plain(s), fam, wt, maxW, o.maxH || 99999, lh, o.ls || 0, size, o.min || size * 0.7, o.maxLines || 0);
    return drawRich(r, b, x, y, maxW, color, o.align);
  }
  function measurePara(r, s, fam, wt, size, maxW, lh, o) {
    o = o || {};
    if (!plain(s).trim()) return 0;
    return fit(r, plain(s), fam, wt, maxW, o.maxH || 99999, lh, o.ls || 0, size, o.min || size * 0.7, o.maxLines || 0).h;
  }

  // ---------------------------------------------------------------- components
  function pill(r, s, x, y, o) {
    o = o || {};
    const size = o.size || 24, font = F(J, 800, size), padX = o.padX || 22, padY = o.padY || 16, gap = 12;
    const t = String(s || "").toUpperCase(); if (!t.trim()) return { w: 0, h: 0 };
    const icon = o.bolt ? Math.round(size * 0.92) : 0;
    const w = tw(r, t, font, size * 0.12) + padX * 2 + (icon ? icon * 0.8 + gap : 0), h = size + padY * 2;
    const px = o.align === "right" ? x - w : x;
    if (o.glass) {
      r.fillRoundRect(px, y, w, h, 12, "rgba(255,255,255,0.1)");
    } else r.fillRoundRect(px, y, w, h, 12, o.bg || T.red);
    let tx = px + padX;
    if (icon) {
      const c = r.ctx, s2 = icon / 28; c.save(); c.translate(tx, y + (h - icon) / 2); c.scale(s2, s2);
      c.fillStyle = T.orange; c.fill(new Path2D("M13 0L0 16h9l-3 12L22 10h-9z")); c.restore();
      tx += icon * 0.8 + gap;
    }
    line(r, t, font, tx, y + padY + size * 0.04, o.fg || WHITE, { ls: 0.12 });
    return { w, h, x: px };
  }
  // kind: 'acc' (the one hero CTA), 'red', 'navy'. Returns the box.
  function button(r, s, x, y, o) {
    o = o || {};
    const size = o.size || 34, font = F(J, 800, size), padX = o.padX || 44, padY = o.padY || 30;
    let label = String(s || "").trim(); if (!label) return { w: 0, h: 0 };
    const arrow = o.arrow !== false && !/[→>]\s*$/.test(label);
    const aw = arrow ? size + 16 : 0;
    let w = tw(r, label, font) + padX * 2 + aw;
    if (o.maxW && w > o.maxW) { const k = o.maxW / w; return button(r, s, x, y, Object.assign({}, o, { size: Math.floor(size * k), padX: Math.floor(padX * k), padY: Math.floor(padY * k), maxW: 0 })); }
    const h = size + padY * 2, bx = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
    const c = r.ctx;
    r.as("cta", () => {
      c.save();
      if (o.kind === "acc") { c.shadowColor = "rgba(220,24,60,0.45)"; c.shadowBlur = 50; c.shadowOffsetY = 20; }
      r.roundRectPath(bx, y, w, h, 12);
      c.fillStyle = o.kind === "acc" ? accentGrad(c, bx, y, w, h) : (o.kind === "navy" ? T.navy : T.red);
      c.fill(); c.restore();
      r._tr("fill", o.kind === "acc" ? { x: bx, y, w, h, color: null, gradient: true } : { x: bx, y, w, h, color: o.kind === "navy" ? T.navy : T.red });
      line(r, label, font, bx + padX, y + padY + size * 0.02, WHITE);
      if (arrow) r.drawIconPath(ARROW, bx + w - padX - size, y + (h - size) / 2, size, WHITE, 2.6);
    });
    return { x: bx, y, w, h };
  }
  function logo(r, kind, x, y, w, align) {
    const img = ART()[kind]; if (!img) return { w: 0, h: 0 };
    const h = w * img.height / img.width, lx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    r.ctx.drawImage(img, lx, y, w, h);
    r._tr("image", { x: lx, y, w, h });
    return { w, h, x: lx };
  }
  function monogram(r, name, cx, cy, d) {
    const c = r.ctx, ini = String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "SA";
    c.save(); c.beginPath(); c.arc(cx, cy, d / 2, 0, Math.PI * 2); c.fillStyle = accentGrad(c, cx - d / 2, cy - d / 2, d, d); c.fill(); c.restore();
    r._tr("fill", { x: cx - d / 2, y: cy - d / 2, w: d, h: d, color: null, gradient: true });
    const f = F(J, 800, d * 0.37); line(r, ini, f, cx, cy - f.size * 0.55, WHITE, { align: "center" });
  }
  function ring(r, img, cx, cy, d) {
    const c = r.ctx; c.save(); c.beginPath(); c.arc(cx, cy, d / 2, 0, Math.PI * 2); c.fillStyle = accentGrad(c, cx - d / 2, cy - d / 2, d, d); c.fill(); c.restore();
    const inner = d - d * 0.09; photo(r, cx - inner / 2, cy - inner / 2, inner, inner, img, "circle", 0.3);
  }
  function hr(r, x1, x2, y, color, w) { r.strokeLine(x1, y, x2, y, color, w || 2); }

  // ================================================================== FAMILIES
  // ---- S1 Funding Alert ------------------------------------------------------------------------
  function funding(r, v) {
    const g = geo(r), { W, H, k, pad } = g;
    hero(r);
    glow(r, W - 110 * k, 90 * k, 620 * k, RED, 0.35);
    glow(r, 60 * k, H - 40 * k, 560 * k, ORANGE, 0.18);
    // top row: lockup + series badge
    const lg = logo(r, "rev", pad, g.top, 270 * k);
    pill(r, v.pill, W - pad, g.top + (lg.h - (24 * k + 32 * k)) / 2, { size: 24 * k, padX: 22 * k, padY: 16 * k, bg: T.green, bolt: true, align: "right" });
    // bottom row: the one hero CTA + url
    const bh = 34 * k + 60 * k, by = g.bot - bh;
    const b = button(r, v.cta, pad, by, { kind: "acc", size: 34 * k, padX: 44 * k, padY: 30 * k });
    if (v.url) line(r, v.url, F(J, 600, 26 * k), W - pad, by + (bh - 26 * k) / 2, "rgba(255,255,255,0.55)", { align: "right", maxW: W - pad * 2 - b.w - 40 * k });
    // middle stack, measured then placed
    const iw = W - pad * 2;
    const facts = [[v.f1k, v.f1v], [v.f2k, v.f2v], [v.f3k, v.f3v]].filter((f) => plain(f[1]).trim());
    const stripH = facts.length ? 131 * k : 0;
    const kick = plain(v.kicker).trim() ? 26 * k : 0;
    const subH = measurePara(r, v.sub, I, 400, 34 * k, Math.min(iw, 820 * k), 1.5, { maxLines: 3 });
    const top0 = g.top + lg.h, space = by - top0;
    const fixed = kick + (kick ? 30 * k : 0) + (subH ? 34 * k + subH : 0) + (stripH ? 74 * k + stripH : 0);
    const head = fit(r, v.head, J, 800, iw, Math.max(80, space - fixed - 120 * k), 1.0, -0.03, (g.story ? 124 : 112) * k, 52 * k, 4);
    const stackH = fixed + head.h;
    let y = top0 + Math.max(50 * k, (space - stackH) * 0.58);
    if (kick) { line(r, v.kicker, F(J, 800, 26 * k), pad, y, T.orange, { ls: 0.14, upper: true, maxW: iw }); y += kick + 30 * k; }
    r.as("headline", () => drawRich(r, head, pad, y, iw, WHITE)); y += head.h;
    if (subH) { y += 34 * k; para(r, v.sub, I, 400, 34 * k, Math.min(iw, 820 * k), 1.5, "rgba(255,255,255,0.75)", pad, y, { maxLines: 3 }); y += subH; }
    if (stripH) {
      y += 74 * k;
      r.fillRoundRect(pad, y, iw, stripH, 16 * k, "rgba(255,255,255,0.07)");
      const c = r.ctx; c.save(); r.roundRectPath(pad, y, iw, stripH, 16 * k); c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = 1.5; c.stroke(); c.restore();
      const cw = iw / facts.length;
      facts.forEach((f, i) => {
        const fx = pad + cw * i;
        if (i) r.strokeLine(fx, y, fx, y + stripH, "rgba(255,255,255,0.12)", 1.5);
        line(r, f[0], F(J, 700, 19 * k), fx + 30 * k, y + 28 * k, "rgba(255,255,255,0.55)", { ls: 0.12, upper: true, maxW: cw - 50 * k });
        line(r, f[1], F(J, 800, 40 * k), fx + 30 * k, y + 59 * k, i === facts.length - 1 ? T.orange : WHITE, { maxW: cw - 50 * k });
      });
    }
  }

  // ---- S2 Article card -------------------------------------------------------------------------
  function article(r, v, a) {
    const g = geo(r), { W, H, k } = g, px = 72 * k;
    r.fillBg(WHITE);
    const iw = W - px * 2;
    // footer (byline) pinned to the bottom
    const footH = 76 * k, fy = g.bot + (g.story ? 0 : 20 * k) - footH;
    // text block measured first; the photo takes what is left (never less than 30%, never above 55%)
    const subH = measurePara(r, v.sub, I, 400, 32 * k, iw, 1.55, { maxLines: 3 });
    const headProbe = fit(r, v.head, J, 800, iw, 3 * 76 * k * 1.06, 1.06, -0.025, 76 * k, 48 * k, 3);
    const textH = 64 * k + headProbe.h + (subH ? 26 * k + subH : 0) + 40 * k + 34 * k;
    const ph = Math.round(Math.max(H * 0.3, Math.min(H * 0.55, fy - textH)));
    photo(r, 0, 0, W, ph, a.featured, null, 0.4);
    pill(r, v.pill, 64 * k, Math.max(64 * k, g.story ? 230 : 0), { size: 24 * k, padX: 22 * k, padY: 16 * k });
    let y = ph + 64 * k;
    const head = fit(r, v.head, J, 800, iw, Math.max(60 * k, fy - 34 * k - 40 * k - y - (subH ? 26 * k + subH : 0)), 1.06, -0.025, 76 * k, 44 * k, 4);
    r.as("headline", () => drawRich(r, head, px, y, iw, T.ink)); y += head.h;
    if (subH) { y += 26 * k; para(r, v.sub, I, 400, 32 * k, iw, 1.55, T.muted, px, y, { maxLines: 3 }); }
    hr(r, px, W - px, fy - 34 * k, T.border, 2);
    monogram(r, v.author, px + footH / 2, fy + footH / 2, footH);
    const tx = px + footH + 22 * k, cube = 64 * k;
    line(r, v.author, F(J, 700, 30 * k), tx, fy + 6 * k, T.ink, { maxW: iw - footH - cube - 60 * k });
    line(r, v.meta, F(I, 400, 25 * k), tx, fy + 44 * k, T.muted, { maxW: iw - footH - cube - 60 * k });
    const cimg = ART().cube; if (cimg) logo(r, "cube", W - px, fy + (footH - cube * cimg.height / cimg.width) / 2, cube, "right");
  }

  // ---- S3 The Number ---------------------------------------------------------------------------
  function number(r, v) {
    const g = geo(r), { W, H, k, pad } = g, c = r.ctx;
    warm(r);
    c.save(); c.lineWidth = 2;
    c.strokeStyle = "rgba(220,24,60,0.12)"; c.beginPath(); c.arc(W + 160 * k - 310 * k, -160 * k + 310 * k, 310 * k, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(255,153,0,0.18)"; c.beginPath(); c.arc(W + 60 * k - 210 * k, -60 * k + 210 * k, 210 * k, 0, Math.PI * 2); c.stroke();
    c.restore();
    const iw = W - pad * 2;
    const p = pill(r, v.pill, pad, g.top, { size: 24 * k, padX: 22 * k, padY: 16 * k, bg: T.redTint, fg: T.red });
    // bottom: source + light lockup
    const lw = 230 * k, limg = ART().light, lh = limg ? lw * limg.height / limg.width : 0;
    const by = g.bot - Math.max(lh, 68 * k);
    logo(r, "light", W - pad, g.bot - lh, lw, "right");
    para(r, v.source, I, 500, 24 * k, iw - lw - 60 * k, 1.4, T.muted, pad, g.bot - measurePara(r, v.source, I, 500, 24 * k, iw - lw - 60 * k, 1.4, { maxLines: 3 }), { maxLines: 3 });
    const top0 = g.top + p.h, space = by - top0;
    const headH = measurePara(r, v.head, J, 700, 50 * k, Math.min(iw, 820 * k), 1.2, { maxLines: 4 });
    const big = fit(r, v.big, J, 800, iw, Math.max(120 * k, space - headH - 160 * k), 0.9, -0.05, (g.story ? 460 : 400) * k, 120 * k, 1);
    const stackH = big.h + 20 * k + headH;
    let y = top0 + Math.max(50 * k, Math.min(70 * k + (space - stackH - 70 * k) * 0.35, space - stackH - 30 * k));
    if (g.story) y = top0 + (space - stackH) * 0.45;
    big.lines = big.lines.map((l) => l.map((t) => Object.assign({}, t, { g: true })));
    r.as("headline", () => drawRich(r, big, pad - 6 * k, y, iw, T.red)); y += big.h + 20 * k;
    para(r, v.head, J, 700, 50 * k, Math.min(iw, 820 * k), 1.2, T.ink, pad, y, { maxLines: 4 });
  }

  // ---- S4 Pull-Quote ---------------------------------------------------------------------------
  function quote(r, v, a) {
    const g = geo(r), { W, H, k } = g, pad = 88 * k, c = r.ctx;
    hero(r);
    glow(r, 100 * k, 100 * k, 560 * k, RED, 0.35);
    glow(r, W - 60 * k, H - 100 * k, 520 * k, ORANGE, 0.18);
    const iw = W - pad * 2;
    // bottom block: speaker row, rule, lockup + link
    const lw = 240 * k, rimg = ART().rev, lh = rimg ? lw * rimg.height / rimg.width : 89 * k;
    const blockH = 110 * k + 44 * k + 40 * k + lh;
    const bt = g.bot - blockH;
    ring(r, a.featured, pad + 55 * k, bt + 55 * k, 110 * k);
    const nx = pad + 110 * k + 26 * k;
    line(r, v.author, F(J, 800, 36 * k), nx, bt + 14 * k, WHITE, { maxW: iw - 140 * k });
    line(r, v.authorRole, F(I, 400, 27 * k), nx, bt + 60 * k, "rgba(255,255,255,0.55)", { maxW: iw - 140 * k });
    hr(r, pad, W - pad, bt + 110 * k + 44 * k, "rgba(255,255,255,0.14)", 1.5);
    const ly = bt + 110 * k + 44 * k + 40 * k;
    logo(r, "rev", pad, ly, lw);
    line(r, v.cta, F(J, 700, 28 * k), W - pad, ly + (lh - 28 * k) / 2, WHITE, { align: "right", maxW: iw - lw - 40 * k });
    // quote mark + quote
    const qy = g.story ? g.top : 96 * k, qs = 1 * k;
    c.save(); c.translate(pad, qy); c.scale(qs, qs);
    c.fillStyle = accentGrad(c, 0, 0, 150, 120);
    c.fill(new Path2D("M0 120V70C0 30 22 6 62 0l6 18C46 26 36 42 36 62h30v58H0zm84 0V70c0-40 22-64 62-70l4 18c-22 8-32 24-32 44h30v58H84z"));
    c.restore();
    r._tr("fill", { x: pad, y: qy, w: 150 * k, h: 120 * k, color: null, gradient: true });
    const y = qy + 120 * k + 64 * k;
    const q = fit(r, v.quote, J, 700, iw, Math.max(100, bt - 60 * k - y), 1.14, -0.025, (g.story ? 96 : 88) * k, 44 * k, 0);
    r.as("headline", () => drawRich(r, q, pad, y, iw, WHITE));
  }

  // ---- S5 Founder Focus cover --------------------------------------------------------------------
  function founder(r, v, a) {
    const g = geo(r), { W, H, k } = g, pad = 72 * k, c = r.ctx;
    r.fillBg(T.navy);
    photo(r, 0, 0, W, H, a.featured, null, 0.25);
    // the CI's required scrim for any mark over a photo
    const s = c.createLinearGradient(0, 0, 0, H);
    s.addColorStop(0, "rgba(12,31,49,0.55)"); s.addColorStop(0.26, "rgba(12,31,49,0)"); s.addColorStop(0.46, "rgba(12,31,49,0)");
    s.addColorStop(0.78, "rgba(12,31,49,0.92)"); s.addColorStop(1, "#0C1F31");
    c.save(); c.fillStyle = s; c.fillRect(0, 0, W, H); c.restore();
    r._tr("fill", { x: 0, y: 0, w: W, h: H, color: null, gradient: true });
    const iw = W - pad * 2, ty = g.story ? g.top - 40 : pad;
    // masthead
    const f1 = F(J, 800, 30 * k), w1 = tw(r, "FOUNDER ", f1, 0.22 * f1.size);
    line(r, "FOUNDER ", f1, pad, ty, WHITE, { ls: 0.22 });
    line(r, "FOCUS", f1, pad + w1, ty, WHITE, { ls: 0.22, grad: true });
    line(r, v.issue, F(J, 700, 22 * k), W - pad, ty + 4 * k, "rgba(255,255,255,0.75)", { ls: 0.12, upper: true, align: "right", maxW: iw - w1 - 160 * k });
    // bottom stack, measured from the bottom up
    const lw = 220 * k, rimg = ART().rev, lh = rimg ? lw * rimg.height / rimg.width : 81 * k;
    const footH = 36 * k + lh;
    const subH = measurePara(r, v.sub, I, 400, 36 * k, Math.min(iw, 880 * k), 1.45, { maxLines: 3 });
    const nameTxt = String(v.name || "").trim().replace(/\s+/, "\n");
    const nm = fit(r, nameTxt, J, 800, iw, 2 * 132 * k * 0.94, 0.94, -0.035, 132 * k, 64 * k, 2);
    const pillH = plain(v.pill).trim() ? 56 * k : 0;
    const stackH = pillH + (pillH ? 34 * k : 0) + nm.h + 22 * k + 28 * k + (subH ? 30 * k + subH : 0) + 48 * k + footH;
    let y = g.bot - stackH;
    if (pillH) { pill(r, v.pill, pad, y, { size: 24 * k, padX: 22 * k, padY: 16 * k }); y += pillH + 34 * k; }
    r.as("headline", () => drawRich(r, nm, pad, y, iw, WHITE)); y += nm.h + 22 * k;
    line(r, v.role, F(J, 500, 28 * k), pad, y, T.orange, { ls: 0.06, upper: true, maxW: iw }); y += 28 * k;
    if (subH) { y += 30 * k; para(r, v.sub, I, 400, 36 * k, Math.min(iw, 880 * k), 1.45, "rgba(255,255,255,0.8)", pad, y, { maxLines: 3 }); y += subH; }
    y += 48 * k;
    hr(r, pad, W - pad, y, "rgba(255,255,255,0.16)", 1.5); y += 36 * k;
    logo(r, "rev", pad, y, lw);
    line(r, v.cta, F(J, 700, 28 * k), W - pad, y + (lh - 28 * k) / 2, WHITE, { align: "right", maxW: iw - lw - 40 * k });
  }

  // ---- S6 Funding Summit (save the date) ---------------------------------------------------------
  function summit(r, v) {
    const g = geo(r), { W, H, k } = g, pad = 90 * k, iw = W - pad * 2, cx = W / 2;
    hero(r);
    glow(r, W - 100 * k, 200 * k, 800 * k, RED, 0.35);
    glow(r, 50 * k, H - 550 * k, 700 * k, ORANGE, 0.18);
    // bottom: the one CTA + url
    const urlH = plain(v.url).trim() ? 26 * k + 34 * k : 0;
    const bh = 40 * k + 72 * k, by = g.bot - urlH - bh;
    button(r, v.cta, cx, by, { kind: "acc", size: 40 * k, padX: 60 * k, padY: 36 * k, align: "center", maxW: iw });
    if (urlH) line(r, v.url, F(J, 600, 26 * k), cx, by + bh + 34 * k, "rgba(255,255,255,0.55)", { align: "center", maxW: iw });
    // stack: badge, kicker, head, sub, tiles
    const tiles = [[v.s1v, v.s1k], [v.s2v, v.s2k], [v.s3v, v.s3k], [v.s4v, v.s4k]].filter((t) => plain(t[0]).trim());
    const tileH = tiles.length ? 168 * k : 0;
    const simg = ART().summit;
    const space = by - g.top - 60 * k;
    const badgeW = Math.min(700 * k, g.story ? 700 * k : (H < 1200 ? 380 * k : 520 * k));
    const badgeH = simg ? badgeW * simg.height / simg.width : 0;
    const subH = measurePara(r, v.sub, I, 400, 38 * k, iw, 1.5, { maxLines: g.story ? 3 : 2 });
    const gapA = g.story ? 110 * k : 50 * k, gapT = g.story ? 80 * k : 44 * k;
    const fixed = badgeH + gapA + 30 * k + 34 * k + (subH ? 44 * k + subH : 0) + (tileH ? gapT + tileH : 0);
    const head = fit(r, v.head, J, 800, iw, Math.max(90 * k, space - fixed), 0.95, -0.04, 150 * k, 56 * k, 3);
    const stackH = fixed + head.h;
    let y = g.top + Math.max(0, (space - stackH) * (g.story ? 0.3 : 0.4));
    if (simg) { logo(r, "summit", cx, y, badgeW, "center"); y += badgeH + gapA; }
    else y += gapA;
    line(r, v.kicker, F(J, 800, 30 * k), cx, y, T.orange, { ls: 0.22, upper: true, align: "center", maxW: iw }); y += 30 * k + 34 * k;
    r.as("headline", () => drawRich(r, head, pad, y, iw, WHITE, "center")); y += head.h;
    if (subH) { y += 44 * k; para(r, v.sub, I, 400, 38 * k, iw, 1.5, "rgba(255,255,255,0.75)", pad, y, { align: "center", maxLines: g.story ? 3 : 2 }); y += subH; }
    if (tileH) {
      y += gapT;
      const gap = 18 * k, tw4 = (iw - gap * (tiles.length - 1)) / tiles.length;
      tiles.forEach((t, i) => {
        const tx = pad + i * (tw4 + gap);
        r.fillRoundRect(tx, y, tw4, tileH, 16 * k, "rgba(255,255,255,0.07)");
        const c = r.ctx; c.save(); r.roundRectPath(tx, y, tw4, tileH, 16 * k); c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = 1.5; c.stroke(); c.restore();
        line(r, t[0], F(J, 800, 76 * k), tx + tw4 / 2, y + 30 * k, WHITE, { align: "center", maxW: tw4 - 24 * k });
        line(r, t[1], F(J, 700, 20 * k), tx + tw4 / 2, y + 118 * k, "rgba(255,255,255,0.55)", { ls: 0.14, upper: true, align: "center", maxW: tw4 - 20 * k });
      });
    }
  }

  // ---- S7 The Weekly ----------------------------------------------------------------------------
  function weekly(r, v) {
    const g = geo(r), { W, H, k } = g, c = r.ctx;
    r.fillBg(WHITE);
    const colW = 220 * k;
    r.rect(0, 0, colW, H, T.slate);
    r.rect(colW, 0, 2 * k, H, T.border);
    r.rect(colW + 2 * k, 0, 6 * k, H, T.red);
    // date strip
    const parts = String(v.date || "").trim().split(/\s+/).filter(Boolean);
    parts.forEach((p, i) => line(r, p, F(J, 700, 26 * k), 56 * k, g.top + i * 34 * k, T.muted, { ls: 0.1, upper: true, maxW: colW - 70 * k }));
    const cimg = ART().cube, cw = 96 * k;
    if (cimg) logo(r, "cube", 56 * k, g.bot + (g.story ? 0 : 8 * k) - cw * cimg.height / cimg.width, cw);
    // content column
    const x = colW + 8 * k + 70 * k, iw = W - x - 76 * k;
    const p = pill(r, v.pill, x, g.top, { size: 24 * k, padX: 22 * k, padY: 16 * k, bg: T.navy });
    line(r, v.issue, F(J, 700, 26 * k), x + p.w + 14 * k, g.top + (p.h - 26 * k) / 2, T.muted, { maxW: iw - p.w - 14 * k });
    // bottom: red button + text link
    const bh = 30 * k + 52 * k, by = g.bot - bh;
    const b = button(r, v.cta, x, by, { kind: "red", size: 30 * k, padX: 38 * k, padY: 26 * k, arrow: false, maxW: iw * 0.62 });
    line(r, v.link, F(J, 700, 26 * k), x + b.w + 24 * k, by + (b.h - 26 * k) / 2, T.red, { maxW: iw - b.w - 24 * k });
    // teasers + headline, measured
    const items = [v.i1, v.i2, v.i3].filter((s) => plain(s).trim());
    const tint = [[T.redTint, T.red], [T.greenTint, T.green], [T.amberTint, T.amber]];
    const itW = iw - 44 * k - 22 * k;
    const itemHs = items.map((s) => Math.max(44 * k, measurePara(r, s, I, 500, 30 * k, itW, 1.4, { maxLines: 2 })));
    const listH = itemHs.reduce((a2, b2) => a2 + b2, 0) + Math.max(0, items.length - 1) * 26 * k;
    const top0 = g.top + p.h, space = by - top0;
    const head = fit(r, v.head, J, 800, iw, Math.max(80 * k, space - listH - 56 * k - 50 * k - 50 * k), 1.06, -0.025, 72 * k, 40 * k, 4);
    const stackH = head.h + (items.length ? 50 * k + listH : 0);
    let y = top0 + Math.max(40 * k, Math.min(56 * k + (space - stackH - 56 * k - 50 * k) * 0.3, space - stackH - 40 * k));
    r.as("headline", () => drawRich(r, head, x, y, iw, T.ink)); y += head.h + 50 * k;
    items.forEach((s, i) => {
      r.fillRoundRect(x, y, 44 * k, 44 * k, 12 * k, tint[i][0]);
      line(r, String(i + 1), F(J, 800, 24 * k), x + 22 * k, y + 10 * k, tint[i][1], { align: "center" });
      para(r, s, I, 500, 30 * k, itW, 1.4, T.ink, x + 44 * k + 22 * k, y, { maxLines: 2 });
      y += itemHs[i] + 26 * k;
    });
    c.textBaseline = "top";
  }

  // ---- S8 Carousel ------------------------------------------------------------------------------
  function carousel(r, dir, v) {
    const g = geo(r), { W, H, k } = g, pad = 88 * k, iw = W - pad * 2;
    if (dir === "b") {
      r.fillBg(T.bg);
      const p = pill(r, v.pill, pad, g.top, { size: 24 * k, padX: 22 * k, padY: 16 * k, bg: T.redTint, fg: T.red });
      const cimg = ART().cube, cw = 70 * k;
      if (cimg) logo(r, "cube", W - pad, g.top + (p.h - cw * cimg.height / cimg.width) / 2, cw, "right");
      // tip strip pinned to the bottom
      const tipH = plain(v.tip).trim() ? Math.max(116 * k, measurePara(r, v.tip, I, 600, 30 * k, iw - 68 * k - 78 * k, 1.35, { maxLines: 2 }) + 60 * k) : 0;
      const ty = g.bot - tipH;
      if (tipH) {
        r.fillRoundRect(pad, ty, iw, tipH, 16 * k, T.greenTint);
        const c = r.ctx; c.save(); c.beginPath(); c.arc(pad + 34 * k + 28 * k, ty + tipH / 2, 28 * k, 0, Math.PI * 2); c.fillStyle = T.green; c.fill(); c.restore();
        r.drawIconPath("M5 12l5 5L20 7", pad + 34 * k + 13 * k, ty + tipH / 2 - 15 * k, 30 * k, WHITE, 3);
        const th = measurePara(r, v.tip, I, 600, 30 * k, iw - 68 * k - 78 * k, 1.35, { maxLines: 2 });
        para(r, v.tip, I, 600, 30 * k, iw - 68 * k - 78 * k, 1.35, T.ink, pad + 34 * k + 56 * k + 22 * k, ty + (tipH - th) / 2, { maxLines: 2 });
      }
      const top0 = g.top + p.h, space = (tipH ? ty - 40 * k : g.bot) - top0;
      const subH = measurePara(r, v.sub, I, 400, 36 * k, iw, 1.55, { maxLines: 4 });
      const num = fit(r, v.num, J, 800, iw, Math.max(120 * k, space * 0.42), 0.9, -0.05, (g.story ? 340 : 300) * k, 120 * k, 1);
      const head = fit(r, v.head, J, 800, iw, Math.max(70 * k, space - num.h - 20 * k - (subH ? 30 * k + subH : 0) - 90 * k), 1.05, -0.025, 80 * k, 44 * k, 3);
      const stackH = num.h + 20 * k + head.h + (subH ? 30 * k + subH : 0);
      let y = top0 + Math.max(40 * k, Math.min(90 * k, space - stackH - 20 * k));
      if (g.story) y = top0 + (space - stackH) * 0.4;
      num.lines = num.lines.map((l) => l.map((t) => Object.assign({}, t, { g: true })));
      drawRich(r, num, pad - 8 * k, y, iw, T.red); y += num.h + 20 * k;
      r.as("headline", () => drawRich(r, head, pad, y, iw, T.ink)); y += head.h;
      if (subH) { y += 30 * k; para(r, v.sub, I, 400, 36 * k, iw, 1.55, T.muted, pad, y, { maxLines: 4 }); }
      return;
    }
    if (dir === "c") {
      warm(r);
      const cx = W / 2;
      const limg = ART().light, lw = 300 * k, lh = limg ? lw * limg.height / limg.width : 0;
      const ly = g.story ? g.top : 136 * k;
      logo(r, "light", cx, ly, lw, "center");
      const actH = 28 * k, ay = g.bot - actH;
      const items = [[v.save, "M12 20.5l-1.4-1.3C5.4 14.5 2 11.4 2 7.6 2 4.5 4.4 2 7.5 2c1.7 0 3.4.8 4.5 2.1C13.1 2.8 14.8 2 16.5 2 19.6 2 22 4.5 22 7.6c0 3.8-3.4 6.9-8.6 11.6L12 20.5z"],
                     [v.share, "M7 17L17 7M9 7h8v8"]].filter((it) => plain(it[0]).trim());
      const f = F(J, 700, 28 * k);
      const ws = items.map((it) => tw(r, it[0], f) + 40 * k), tot = ws.reduce((a2, b2) => a2 + b2, 0) + Math.max(0, items.length - 1) * 40 * k;
      let ax = cx - tot / 2;
      items.forEach((it, i) => { r.drawIconPath(it[1], ax, ay, 28 * k, T.ink, 2.2); line(r, it[0], f, ax + 40 * k, ay, T.ink); ax += ws[i] + 40 * k; });
      const top0 = ly + lh, space = ay - 60 * k - top0;
      const subH = measurePara(r, v.sub, I, 400, 36 * k, iw, 1.55, { maxLines: 3 });
      const bh = 34 * k + 60 * k;
      const head = fit(r, v.head, J, 800, iw, Math.max(80 * k, space - (subH ? 30 * k + subH : 0) - 70 * k - bh - 80 * k), 1.04, -0.03, 92 * k, 48 * k, 4);
      const stackH = head.h + (subH ? 30 * k + subH : 0) + 70 * k + bh;
      let y = top0 + Math.max(50 * k, (space - stackH) * 0.55);
      r.as("headline", () => drawRich(r, head, pad, y, iw, T.ink, "center")); y += head.h;
      if (subH) { y += 30 * k; para(r, v.sub, I, 400, 36 * k, iw, 1.55, T.muted, pad, y, { align: "center", maxLines: 3 }); y += subH; }
      button(r, v.cta, cx, y + 70 * k, { kind: "acc", size: 34 * k, padX: 44 * k, padY: 30 * k, align: "center", maxW: iw });
      return;
    }
    // a — cover
    hero(r);
    glow(r, W - 100 * k, H - 140 * k, 600 * k, RED, 0.35);
    const lg = logo(r, "rev", pad, g.story ? g.top : 96 * k, 250 * k);
    const by = g.bot - 96 * k;
    line(r, v.swipe, F(J, 700, 28 * k), pad, by + 34 * k, "rgba(255,255,255,0.75)", { maxW: iw - 140 * k });
    const c = r.ctx, cd = 96 * k, ccx = W - pad - cd / 2, ccy = by + cd / 2;
    c.save(); c.beginPath(); c.arc(ccx, ccy, cd / 2, 0, Math.PI * 2); c.fillStyle = accentGrad(c, ccx - cd / 2, ccy - cd / 2, cd, cd); c.fill(); c.restore();
    r._tr("fill", { x: ccx - cd / 2, y: by, w: cd, h: cd, color: null, gradient: true });
    r.drawIconPath(ARROW, ccx - 22 * k, ccy - 22 * k, 44 * k, WHITE, 2.6);
    const top0 = (g.story ? g.top : 96 * k) + lg.h, space = by - 60 * k - top0;
    const head = fit(r, v.head, J, 800, iw, Math.max(100 * k, space - 26 * k - 30 * k - 60 * k), 0.98, -0.035, (g.story ? 128 : 118) * k, 56 * k, 5);
    const stackH = 26 * k + 30 * k + head.h;
    let y = top0 + Math.max(60 * k, Math.min(190 * k, (space - stackH) * 0.62));
    if (g.story) y = top0 + (space - stackH) * 0.5;
    line(r, v.kicker, F(J, 800, 26 * k), pad, y, T.orange, { ls: 0.16, upper: true, maxW: iw }); y += 26 * k + 30 * k;
    r.as("headline", () => drawRich(r, head, pad, y, iw, WHITE));
  }

  // ---- S9 Ask · Win · Share ---------------------------------------------------------------------
  function aws(r, v) {
    const g = geo(r), { W, H, k } = g, pad = 80 * k, iw = W - pad * 2, c = r.ctx;
    r.fillBg(WHITE);
    const lg = logo(r, "light", pad, g.top, 230 * k);
    line(r, v.label, F(J, 700, 22 * k), W - pad, g.top + (lg.h - 22 * k) / 2, T.muted, { ls: 0.14, upper: true, align: "right", maxW: iw - 260 * k });
    // bottom row
    const bh = 30 * k + 52 * k, by = g.bot - bh;
    const b = button(r, v.cta, pad, by, { kind: "red", size: 30 * k, padX: 38 * k, padY: 26 * k, arrow: false, maxW: iw * 0.66 });
    line(r, v.url, F(J, 600, 24 * k), W - pad, by + (b.h - 24 * k) / 2, T.muted, { align: "right", maxW: iw - b.w - 30 * k });
    // cards
    const cards = [["● Ask", v.ask, T.red, T.red], ["● Win", v.win, T.green, T.green], ["● Share", v.share, T.orange, T.amber]].filter((x) => plain(x[1]).trim());
    const labW = 160 * k, txW = iw - 32 * k * 2 - 8 * k - labW - 26 * k;
    const ch = cards.map((x) => Math.max(36 * k, measurePara(r, x[1], I, 500, 30 * k, txW, 1.35, { maxLines: 3 })) + 56 * k);
    const cardsH = ch.reduce((a2, b2) => a2 + b2, 0) + Math.max(0, cards.length - 1) * 22 * k;
    const top0 = g.top + lg.h, space = by - top0;
    const head = fit(r, v.head, J, 800, iw, Math.max(70 * k, space - cardsH - 56 * k - 70 * k - 40 * k), 1.04, -0.025, 76 * k, 40 * k, 3);
    const stackH = head.h + 56 * k + cardsH;
    let y = top0 + Math.max(40 * k, Math.min(70 * k, (space - stackH) * 0.5));
    if (g.story || H > 1200) y = top0 + Math.max(60 * k, (space - stackH) * 0.45);
    r.as("headline", () => drawRich(r, head, pad, y, iw, T.ink)); y += head.h + 56 * k;
    cards.forEach((x, i) => {
      const h = ch[i];
      r.fillRoundRect(pad, y, iw, h, 16 * k, WHITE);
      c.save(); r.roundRectPath(pad + 1, y + 1, iw - 2, h - 2, 16 * k); c.strokeStyle = T.border; c.lineWidth = 2 * k; c.stroke(); c.restore();
      c.save(); r.roundRectPath(pad, y, iw, h, 16 * k); c.clip(); c.fillStyle = x[2]; c.fillRect(pad, y, 8 * k, h); c.restore();
      line(r, x[0], F(J, 800, 22 * k), pad + 8 * k + 32 * k, y + (h - 22 * k) / 2, x[3], { ls: 0.14, upper: true, maxW: labW });
      const th = measurePara(r, x[1], I, 500, 30 * k, txW, 1.35, { maxLines: 3 });
      para(r, x[1], I, 500, 30 * k, txW, 1.35, T.ink, pad + 8 * k + 32 * k + labW + 26 * k, y + (h - th) / 2, { maxLines: 3 });
      y += h + 22 * k;
    });
  }

  // ---- Landscape (1200×628): one shared layout. The concepts are portrait/square/story only, so
  // this maps each family's fields onto a split banner rather than inventing nine new designs.
  function drawLand(r, type, dir, v, a) {
    const W = r.w, H = r.h, k = H / 628, pad = 56 * k, c = r.ctx;
    const light = type === "r26number" || type === "r26weekly" || type === "r26aws" || (type === "r26carousel" && dir !== "a") || type === "r26article";
    if (light) { if (type === "r26number" || type === "r26carousel") warm(r); else r.fillBg(WHITE); }
    else { hero(r); glow(r, W - 80 * k, 60 * k, 520 * k, RED, 0.35); glow(r, 60 * k, H, 420 * k, ORANGE, 0.18); }
    const ink = light ? T.ink : WHITE, sub = light ? T.muted : "rgba(255,255,255,0.75)";
    const pick = (...ks) => { for (const kk of ks) if (plain(v[kk]).trim()) return v[kk]; return ""; };
    const head = pick(type === "r26quote" ? "quote" : "head", "name", "head");
    const tag = pick("pill", "kicker", "label", "issue");
    const body = pick("sub", "authorRole", "role", "source");
    const cta = pick("cta", "link", "swipe");
    const hasPhoto = type === "r26article" || type === "r26founder" || type === "r26quote";
    const rightW = hasPhoto || type === "r26number" || type === "r26carousel" && dir === "b" ? W * 0.38 : 0;
    const iw = W - pad * 2 - (rightW ? rightW : 0);
    if (hasPhoto) photo(r, W - rightW, 0, rightW, H, a.featured, null, 0.3);
    const lg = logo(r, light ? "light" : "rev", pad, pad, 190 * k);
    let y = pad + lg.h + 34 * k;
    if (plain(tag).trim()) {
      const p = pill(r, tag, pad, y, light ? { size: 18 * k, padX: 16 * k, padY: 12 * k, bg: T.redTint, fg: T.red } : { size: 18 * k, padX: 16 * k, padY: 12 * k, bg: type === "r26funding" ? T.green : T.red, bolt: type === "r26funding" });
      y += p.h + 22 * k;
    }
    const bh = 26 * k + 44 * k, by = H - pad - bh;
    const bodyH = measurePara(r, body, I, 400, 22 * k, iw, 1.45, { maxLines: 2 });
    const hb = fit(r, head, J, 800, iw, Math.max(50 * k, by - 30 * k - (bodyH ? 16 * k + bodyH : 0) - y), 1.04, -0.025, 64 * k, 28 * k, 4);
    r.as("headline", () => drawRich(r, hb, pad, y, iw, ink)); y += hb.h;
    if (bodyH) { y += 16 * k; para(r, body, I, 400, 22 * k, iw, 1.45, sub, pad, y, { maxLines: 2 }); }
    if (plain(cta).trim()) button(r, cta, pad, by, { kind: type === "r26weekly" || type === "r26aws" ? "red" : "acc", size: 26 * k, padX: 32 * k, padY: 22 * k, maxW: iw });
    else line(r, v.url || "smesouthafrica.co.za", F(J, 600, 22 * k), pad, H - pad - 22 * k, light ? T.muted : "rgba(255,255,255,0.55)", { maxW: iw });
    if (type === "r26number" || (type === "r26carousel" && dir === "b")) {
      const big = fit(r, type === "r26number" ? v.big : v.num, J, 800, rightW - pad, H - pad * 2, 0.9, -0.05, 260 * k, 80 * k, 1);
      big.lines = big.lines.map((l) => l.map((t) => Object.assign({}, t, { g: true })));
      drawRich(r, big, W - rightW, (H - big.h) / 2, rightW - pad, T.red, "center");
    }
    c.textBaseline = "top";
  }

  const FAM = {
    r26funding: (r, d, v) => funding(r, v),
    r26article: (r, d, v, a) => article(r, v, a),
    r26number: (r, d, v) => number(r, v),
    r26quote: (r, d, v, a) => quote(r, v, a),
    r26founder: (r, d, v, a) => founder(r, v, a),
    r26summit: (r, d, v) => summit(r, v),
    r26weekly: (r, d, v) => weekly(r, v),
    r26carousel: (r, d, v) => carousel(r, d, v),
    r26aws: (r, d, v) => aws(r, v),
  };
  self.R26_DRAW = function (r, type, dir, v, a) {
    if (!FAM[type]) return false;
    r.ctx.textBaseline = "top";
    if (r.w > r.h * 1.2) drawLand(r, type, dir, v || {}, a || {});
    else FAM[type](r, dir, v || {}, a || {});
    return true;
  };
}
