// Volt — SMESA 2026 video package (gated; see index.js). © 2026 Tshepho Joel.
//
// The four cards from the approved concepts (rebrand-2026 gallery, section 03): intro title card,
// speaker lower-third, captions + progress, outro. r26Video is stringified and evaluated by
// video.html after /api/rebrand answers 200. It registers VIDEO_TEMPLATES.smesa26 and returns the
// draw hooks video.html consults when that template is active (window.R26V).
//
// Follows the Funding Summit template's patterns, and its two hard lessons:
//   · PERFORMANCE: no per-frame ctx.filter. The hero surface (gradient + dot grid) and the blurred
//     glows are baked ONCE per frame size into offscreen canvases; each frame only drawImage()s
//     them. A per-frame blur cost ~400ms/frame at 4K and wrecked a Summit export.
//   · FONTS: canvas never fetches a web font on its own, so Jakarta/Inter are requested on apply.
// Runs in the page's global scope: it uses video.html's own ctx, W, H, state, segT/eoc/eob,
// roundRect and $ — the same ones every other card uses, so preview and export can't diverge.

export function videoSource() {
  return "return (" + r26Video.toString() + ")(R26CTX);";   // NOT `ctx`: that name is the page's canvas context
}

function r26Video(R) {
  "use strict";
  const J = '"Plus Jakarta Sans", Inter, sans-serif', I = 'Inter, "Plus Jakarta Sans", sans-serif';
  const RED = "#DC183C", ORANGE = "#FF9900", NAVY = "#0C1F31";
  const KEY = "smesa26";
  const assets = R.assets || {};

  // ---------------------------------------------------------------- fonts + assets
  function loadFonts() {
    if (!document.querySelector("link[data-r26v]")) {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.setAttribute("data-r26v", "1");
      l.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap";
      document.head.appendChild(l);
    }
    if (document.fonts && document.fonts.load)
      ['800 40px "Plus Jakarta Sans"', '700 40px "Plus Jakarta Sans"', '600 40px "Plus Jakarta Sans"', "400 40px Inter", "500 40px Inter", "600 40px Inter"]
        .forEach((f) => document.fonts.load(f).catch(() => {}));
  }
  const logo = new Image(); logo.decoding = "async";
  // Same-origin path when this page is served by Volt itself (web, hosted desktop, local test server):
  // the lockup ships in /brand26/, so no proxy hop and no tainted canvas. Anywhere else: voltAsset.
  if (assets.logo) {
    let src = assets.logo;
    try { const u2 = new URL(assets.logo); if (/(^|\.)tshephos-lab[^.]*\.vercel\.app$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) src = u2.pathname; else if (typeof window.voltAsset === "function") src = window.voltAsset(assets.logo); } catch (e) {}
    logo.src = src;
  }
  const logoOk = () => logo.complete && logo.naturalWidth > 0;

  // ---------------------------------------------------------------- baked layers (once per size)
  let bakedFor = "", heroCv = null, glowR = null, glowO = null;
  function bake() {
    const k = W + "x" + H; if (k === bakedFor) return;
    bakedFor = k;
    heroCv = document.createElement("canvas"); heroCv.width = W; heroCv.height = H;
    const h = heroCv.getContext("2d"), a = 115 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const L = Math.abs(W * dx) + Math.abs(H * dy);
    const g = h.createLinearGradient(W / 2 - dx * L / 2, H / 2 - dy * L / 2, W / 2 + dx * L / 2, H / 2 + dy * L / 2);
    g.addColorStop(0, NAVY); g.addColorStop(0.5, NAVY); g.addColorStop(0.8, "#2b1626"); g.addColorStop(1, "#4b1a2b");
    h.fillStyle = g; h.fillRect(0, 0, W, H);
    const step = 22 * u(), tile = document.createElement("canvas"); tile.width = tile.height = Math.max(4, Math.round(step));
    const tx = tile.getContext("2d"); tx.fillStyle = "rgba(255,255,255,0.05)"; tx.beginPath(); tx.arc(1, 1, Math.max(0.8, u()), 0, 7); tx.fill();
    h.fillStyle = h.createPattern(tile, "repeat"); h.fillRect(0, 0, W, H);
    const sprite = (rgb, alpha) => {
      const d = 512, c = document.createElement("canvas"); c.width = c.height = d;
      const x = c.getContext("2d"), rg = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
      rg.addColorStop(0, "rgba(" + rgb + "," + alpha + ")"); rg.addColorStop(0.55, "rgba(" + rgb + "," + (alpha * 0.8) + ")"); rg.addColorStop(1, "rgba(" + rgb + ",0)");
      x.fillStyle = rg; x.fillRect(0, 0, d, d); return c;
    };
    glowR = sprite("220,24,60", 0.35); glowO = sprite("255,153,0", 0.18);
  }
  // one unit: 1 at 1080×1920, scales down for square / landscape so the stack always fits
  function u() { return Math.min(W / 1080, H / 1350); }
  function hero(drift) {
    bake();
    ctx.drawImage(heroCv, 0, 0);
    const U = u(), dxy = Math.sin((drift || 0) * Math.PI * 2);
    // concept: red 820px blob at right -300 / top -260, orange 700px at left -300 / bottom -200 (+ blur)
    const r = 1100 * U, o = 1000 * U;
    ctx.drawImage(glowR, W - 110 * U - r / 2 - dxy * 40 * U, 150 * U - r / 2 + dxy * 30 * U, r, r);
    ctx.drawImage(glowO, 50 * U - o / 2 + dxy * 40 * U, H - 150 * U - o / 2 - dxy * 30 * U, o, o);
  }
  function accent(x, y, w, h) { const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, RED); g.addColorStop(1, ORANGE); return g; }
  // wrap with *word* gradient emphasis (same convention as the Studio families)
  function rich(text, font, maxW) {
    ctx.font = font;
    const toks = []; String(text || "").split(/(\*[^*]+\*)/).forEach((seg) => { if (!seg) return; const g = /^\*[^*]+\*$/.test(seg); (g ? seg.slice(1, -1) : seg).split(/(\s+)/).forEach((t) => { if (t) toks.push({ t, g, sp: /^\s+$/.test(t) }); }); });
    const lines = []; let cur = [], cw = 0;
    for (const tk of toks) {
      if (tk.sp) { if (cur.length) { cur.push({ t: " ", sp: true }); cw += ctx.measureText(" ").width; } continue; }
      const w = ctx.measureText(tk.t).width;
      if (cur.length && cw + w > maxW) { while (cur.length && cur[cur.length - 1].sp) cur.pop(); lines.push(cur); cur = []; cw = 0; }
      cur.push(tk); cw += w;
    }
    while (cur.length && cur[cur.length - 1].sp) cur.pop(); if (cur.length) lines.push(cur);
    return lines;
  }
  function fitRich(text, weight, family, maxW, maxH, maxPx, minPx, lh) {
    let s = Math.round(maxPx);
    for (let i = 0; i < 30; i++) {
      const f = weight + " " + s + "px " + family, ls = rich(text, f, maxW);
      ctx.font = f; const wide = Math.max(0, ...ls.map((l) => l.reduce((a, t) => a + ctx.measureText(t.t).width, 0)));
      if ((ls.length * s * lh <= maxH && wide <= maxW) || s <= minPx) return { lines: ls, size: s, font: f, h: ls.length * s * lh, lh };
      s = Math.max(minPx, Math.round(s * 0.93));
    }
  }
  function drawRich(b, x, y, maxW, align, color, sweep) {
    ctx.save(); ctx.font = b.font; ctx.textBaseline = "top"; ctx.textAlign = "left";
    b.lines.forEach((l, i) => {
      const ws = l.map((t) => ctx.measureText(t.t).width), tot = ws.reduce((a, v) => a + v, 0);
      let cx = align === "center" ? x + (maxW - tot) / 2 : x; const ly = y + i * b.size * b.lh;
      l.forEach((t, j) => {
        if (t.g) {
          // the gradient word "sweeps once": the gradient window slides across it on entrance
          const off = (1 - (sweep == null ? 1 : sweep)) * ws[j] * 2;
          const g = ctx.createLinearGradient(cx - off, ly, cx - off + ws[j] * (sweep == null ? 1 : 2), ly);
          g.addColorStop(0, RED); g.addColorStop(sweep == null ? 1 : 0.5, ORANGE); if (sweep != null) g.addColorStop(1, RED);
          ctx.fillStyle = g;
        } else ctx.fillStyle = color;
        ctx.fillText(t.t, cx, ly); cx += ws[j];
      });
    });
    ctx.restore();
  }
  const field = (id) => { const el = $("#" + id); return el ? String(el.value || "").trim() : ""; };
  const rise = (p, a, b, dist) => ({ a: eoc(segT(p, a, b)), dy: (1 - eoc(segT(p, a, b))) * (dist || 60) * u() });
  function initials(n) { return String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("") || "SA"; }

  // ---------------------------------------------------------------- V1 intro title card
  function intro(p) {
    const U = u(), pad = 96 * U, iw = W - pad * 2;
    hero(p * 0.5);
    const kicker = field("r26Kicker") || "SME South Africa";
    const title = field("introTitle") || "How to scale with *minimal capital*";
    const sp = field("nameName"), role = field("nameTitle");
    // measure the stack: logo, kicker, title, rule, speaker
    const lw = 330 * U, lh = logoOk() ? lw * logo.naturalHeight / logo.naturalWidth : 0;
    const t = fitRich(title, "800", J, iw, H * 0.34, 132 * U, 56 * U, 0.98);
    const spH = sp ? 130 * U : 0;
    const gap1 = Math.min(200 * U, H * 0.08), gap2 = 40 * U, gap3 = 70 * U, gap4 = Math.min(180 * U, H * 0.07);
    const total = lh + gap1 + 28 * U + gap2 + t.h + gap3 + 10 * U + (spH ? gap4 + spH : 0);
    let y = Math.max(H * 0.12, (H - total) / 2 - H * 0.02);
    ctx.save();
    let r = rise(p, 0, 0.14); ctx.globalAlpha = r.a;
    if (lh) ctx.drawImage(logo, pad, y + r.dy, lw, lh);
    y += lh + gap1;
    r = rise(p, 0.04, 0.2); ctx.globalAlpha = r.a;
    ctx.font = "800 " + Math.round(28 * U) + "px " + J; ctx.fillStyle = ORANGE; ctx.textBaseline = "top"; ctx.textAlign = "left";
    try { ctx.letterSpacing = Math.round(28 * U * 0.2) + "px"; } catch (e) {}
    ctx.fillText(kicker.toUpperCase(), pad, y + r.dy);
    try { ctx.letterSpacing = "0px"; } catch (e) {}
    y += 28 * U + gap2;
    r = rise(p, 0.07, 0.26); ctx.globalAlpha = r.a;
    drawRich(t, pad, y + r.dy, iw, "left", "#ffffff", eoc(segT(p, 0.2, 0.55)));
    y += t.h + gap3;
    ctx.globalAlpha = 1;
    const gw = 300 * U * eoc(segT(p, 0.14, 0.34)) * (1 - eoc(segT(p, 0.92, 1)));
    if (gw > 0) { ctx.fillStyle = accent(pad, y, 300 * U, 10 * U); roundRect(pad, y, gw, 10 * U, 5 * U); ctx.fill(); }
    y += 10 * U;
    if (sp) {
      y += gap4;
      r = rise(p, 0.17, 0.36); ctx.globalAlpha = r.a;
      const d = 130 * U, cx = pad + d / 2, cy = y + d / 2 + r.dy;
      ctx.fillStyle = accent(cx - d / 2, cy - d / 2, d, d); ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, 7); ctx.fill();
      ctx.fillStyle = NAVY; ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 6 * U, 0, 7); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.font = "800 " + Math.round(d * 0.34) + "px " + J; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(initials(sp), cx, cy + 2);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.font = "800 " + Math.round(46 * U) + "px " + J; ctx.fillStyle = "#ffffff"; ctx.fillText(sp, pad + d + 30 * U, cy - (role ? 46 * U : 23 * U));
      if (role) { ctx.font = "500 " + Math.round(30 * U) + "px " + I; ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillText(role, pad + d + 30 * U, cy + 8 * U); }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- V2 speaker lower-third
  function nameTag(ct) {
    if (ct < 0 || ct > 5.0) return true;
    const nm = field("nameName"); if (!nm) return true;
    const title = field("nameTitle"), pillTxt = field("r26Kicker");
    const U = u(), a = ct < 0.35 ? eoc(ct / 0.35) : ct > 4.5 ? Math.max(0, (5.0 - ct) / 0.5) : 1;
    const fsN = Math.round(58 * U), fsT = Math.round(30 * U), padL = 36 * U, padR = 44 * U, spine = 16 * U;
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = "800 " + fsN + "px " + J; const nW = ctx.measureText(nm).width;
    ctx.font = "600 " + fsT + "px " + I; const tW = title ? ctx.measureText(title).width : 0;
    const bw = Math.min(W - 144 * U, spine + padL + Math.max(nW, tW) + padR), bh = 34 * U * 2 + fsN * 1.1 + (title ? 8 * U + fsT * 1.4 : 0);
    const bx = 72 * U, pillH = pillTxt ? 22 * U + 32 * U : 0;
    // sits in the safe band ABOVE the caption zone, rising in
    const baseY = (state.capPos === "bottom" ? H * 0.70 : H * 0.84) - bh - (pillTxt ? pillH + 22 * U : 0);
    const by = baseY + (1 - a) * 40 * U;
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 60 * U; ctx.shadowOffsetY = 30 * U;
    ctx.fillStyle = "rgba(12,31,49,0.92)"; roundRect(bx, by, bw, bh, 16 * U); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.save(); roundRect(bx, by, bw, bh, 16 * U); ctx.clip(); ctx.fillStyle = accent(bx, by, spine, bh); ctx.fillRect(bx, by, spine, bh); ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#ffffff";
    ctx.font = "800 " + fsN + "px " + J; ctx.fillText(nm, bx + spine + padL, by + 34 * U, bw - spine - padL - padR);
    if (title) { ctx.font = "600 " + fsT + "px " + I; ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillText(title, bx + spine + padL, by + 34 * U + fsN * 1.1 + 8 * U, bw - spine - padL - padR); }
    if (pillTxt) {
      const ps = Math.round(22 * U); ctx.font = "800 " + ps + "px " + J;
      try { ctx.letterSpacing = Math.round(ps * 0.12) + "px"; } catch (e) {}
      const pw = ctx.measureText(pillTxt.toUpperCase()).width + 44 * U, py = by + bh + 22 * U;
      ctx.fillStyle = RED; roundRect(bx, py, pw, pillH, 12 * U); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.fillText(pillTxt.toUpperCase(), bx + 22 * U, py + 16 * U);
      try { ctx.letterSpacing = "0px"; } catch (e) {}
    }
    ctx.restore();
    return true;
  }

  // ---------------------------------------------------------------- V3 captions
  // Sentence-case Jakarta 800 with a soft shadow (not an outline); the spoken word lights up in a
  // red pill with white type. Size, position and the nudge slider are the existing controls.
  function captions(ct) {
    const line = state.lines.find((L) => ct >= L.start - 0.06 && ct <= L.end + 0.30);
    if (!line) return true;
    const fs = Math.round(W * ({ S: 0.048, M: 0.059, L: 0.072 }[state.capSize] || 0.059));
    let e = Math.max(0, Math.min(1, (ct - line.start + 0.06) / 0.16)); e = e * e * (3 - 2 * e);
    ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, (1 - e) * fs * 0.45);
    ctx.font = "800 " + fs + "px " + J; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const maxW = W * 0.86, sp = ctx.measureText(" ").width, rows = [[]]; let rw = 0;
    for (const w of line.words) { const txt = String(w.word), ww = ctx.measureText(txt).width;
      if (rw + ww > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push({ w, txt, ww }); rw += ww + sp; }
    const lh = fs * 1.32, blockH = rows.length * lh;
    const presetY = state.capPos === "top" ? H * 0.16 : state.capPos === "middle" ? H * 0.50 : H * 0.78;
    const baseY = Math.max(H * 0.10, Math.min(H * 0.92, presetY + (state.capOffset || 0) / 100 * H));
    let y = baseY - blockH / 2 + lh / 2;
    for (const row of rows) {
      const tot = row.reduce((a, c) => a + c.ww, 0) + sp * (row.length - 1); let x = W / 2 - tot / 2;
      for (const c of row) {
        const active = ct >= c.w.start - 0.02 && ct <= c.w.end + 0.02, cx = x + c.ww / 2;
        if (active) {
          const bw = c.ww + fs * 0.5;
          ctx.fillStyle = RED; roundRect(cx - bw / 2, y - fs * 0.64, bw, fs * 1.28, Math.min(12 * u() * 1.6, fs * 0.22)); ctx.fill();
          ctx.fillStyle = "#ffffff"; ctx.fillText(c.txt, cx, y);
        } else {
          ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = fs * 0.28; ctx.shadowOffsetY = fs * 0.06;
          ctx.fillStyle = "#ffffff"; ctx.fillText(c.txt, cx, y);
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        }
        x += c.ww + sp;
      }
      y += lh;
    }
    ctx.restore();
    return true;
  }
  // accent-gradient progress bar (lime is retired)
  function progress(p) {
    const h = Math.max(6, Math.round(H * 0.00625));
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(0, H - h, W, h);
    ctx.fillStyle = accent(0, H - h, W, h); ctx.fillRect(0, H - h, W * p, h);
    return true;
  }

  // ---------------------------------------------------------------- V4 outro
  function outro(p) {
    const U = u(), pad = 96 * U, iw = W - pad * 2, cx = W / 2;
    hero(p * 0.6);
    const head = field("outroHead") || "Build. Grow. *Thrive.*";
    const sub = field("outroSub") || "Funding, events and the tools to scale, in SA’s largest SME community.";
    const cta = field("r26Cta") || "Join for Free";
    const url = (state.brand && state.brand.url) || "smesouthafrica.co.za";
    const lw = Math.min(560 * U, W * 0.62), lh = logoOk() ? lw * logo.naturalHeight / logo.naturalWidth : 0;
    const t = fitRich(head, "800", J, iw, H * 0.2, 100 * U, 48 * U, 1.02);
    ctx.font = "400 " + Math.round(38 * U) + "px " + I;
    const subB = fitRich(sub, "400", I, iw, H * 0.14, 38 * U, 24 * U, 1.5);
    const bfs = Math.round(42 * U), bh = bfs + 76 * U;
    const g1 = Math.min(170 * U, H * 0.07), g2 = 36 * U, g3 = Math.min(90 * U, H * 0.045);
    const total = lh + g1 + t.h + g2 + subB.h + g3 + bh;
    let y = Math.max(H * 0.1, (H - total) / 2 - H * 0.03);
    ctx.save();
    // A: lockup pops in
    const pa = eob(segT(p, 0.1, 0.26)), aa = eoc(segT(p, 0.1, 0.2));
    if (lh && aa > 0) { ctx.globalAlpha = aa; const s = 0.86 + 0.14 * pa; ctx.drawImage(logo, cx - lw * s / 2, y + lh * (1 - s) / 2, lw * s, lh * s); }
    y += lh + g1;
    let r = rise(p, 0.15, 0.32); ctx.globalAlpha = r.a;
    drawRich(t, pad, y + r.dy, iw, "center", "#ffffff");
    y += t.h + g2;
    r = rise(p, 0.18, 0.36); ctx.globalAlpha = r.a;
    drawRich(subB, pad, y + r.dy, iw, "center", "rgba(255,255,255,0.75)");
    y += subB.h + g3;
    // the ONE accent CTA, popping in
    const ba = eoc(segT(p, 0.23, 0.36)), bs = 0.86 + 0.14 * eob(segT(p, 0.23, 0.4));
    if (ba > 0) {
      ctx.globalAlpha = ba; ctx.font = "800 " + bfs + "px " + J;
      const label = /[→>]\s*$/.test(cta) ? cta : cta + " →";
      const bw = ctx.measureText(label).width + 120 * U;
      ctx.save(); ctx.translate(cx, y + bh / 2); ctx.scale(bs, bs);
      ctx.shadowColor = "rgba(220,24,60,0.45)"; ctx.shadowBlur = 50 * U; ctx.shadowOffsetY = 20 * U;
      ctx.fillStyle = accent(-bw / 2, -bh / 2, bw, bh); roundRect(-bw / 2, -bh / 2, bw, bh, 12 * U); ctx.fill();
      ctx.shadowColor = "transparent"; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 2 * U); ctx.restore();
    }
    // url
    r = rise(p, 0.27, 0.42); ctx.globalAlpha = r.a;
    ctx.font = "600 " + Math.round(34 * U) + "px " + J; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(url, cx, Math.min(H - 300 * (H / 1920), H * 0.9) + r.dy);
    ctx.restore();
    // the skewed white light-wipe that reveals the card (a nod to the Summit package's white bar)
    const k = segT(p, 0, 0.16);
    if (k > 0 && k < 1) {
      const e = k * k * (3 - 2 * k), bw = Math.max(W, H) * 0.24, x = -bw * 1.5 + e * (W + bw * 3);
      ctx.save(); ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.beginPath();
      const sk = H * Math.tan(12 * Math.PI / 180);
      ctx.moveTo(x + sk / 2, 0); ctx.lineTo(x + bw + sk / 2, 0); ctx.lineTo(x + bw - sk / 2, H); ctx.lineTo(x - sk / 2, H); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- registration
  VIDEO_TEMPLATES[KEY] = {
    label: "SME South Africa 2026",
    note: "2026 · Preview — only you can see this until release. Hero title card, glass speaker lower-third, Jakarta captions with a red active-word pill, accent progress bar, light-wipe outro with one gradient CTA. Wrap one word in *stars* for the gradient.",
    apply: { introOn: true, outroOn: true, outroDur: 4.0, nameOn: true, captionsOn: true, hookOn: false,
      progressOn: true, brandFlashOn: false, markOn: false, waveOn: false, qaOn: false,
      capPos: "bottom", capSize: "M", capBg: "box", capColor: RED, capsOn: false, capFont: "sans", look: "natural" },
  };
  return { key: KEY, introDur: 2.8, loadFonts, intro, outro, nameTag, captions, progress };
}
