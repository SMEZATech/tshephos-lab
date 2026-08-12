// Volt — Studio canvas engine (Web Worker). © 2026 Tshepho Joel.
//
// This is the ONE place any Studio design is drawn: `renderSlide` for the Creative themes and
// `drawPremium`/`drawLandscape` for the premium content types. It produces BOTH the on-screen
// preview (scale 1) and the exported PNG (scale 2+), so preview drift is structurally impossible.
//
// It used to live inline in studio.html as <script id="worker-src">, turned into a Blob at runtime.
// It is now a real file, which means:
//   - studio.html drops ~2,000 lines and the engine can be read and diffed on its own
//   - the render tests load it DIRECTLY instead of regexing it back out of a 2,500-line HTML file,
//     which was brittle and broke for reasons that had nothing to do with the designs
// Moving it required the desktop's offline fallback to be served over http://127.0.0.1 instead of
// file:// — a worker created from a file:// URL is blocked, which is why this waited for that change
// (see startOfflineServer in main.js).
//
// INVARIANTS worth not re-breaking (details at each helper):
//   - never assume PC.navy is dark or PC.paper is light; both come from the active Brand Kit.
//     Use pInk/pSubInk/pSolid/pAccentText, never a hardcoded pair.
//   - premium designs are authored at 1080x1080; all vertical metrics go through pGeom/pV/pT.
//   - a design with a bottom-pinned pButton must use pFootAt(), not pFoot().
//   - `r.trace` is an opt-in draw log used by the render tests. Keep primitives recording into it.

'use strict';

// ============ A. DEPENDENCIES ============
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

let BRAND = {
    red:   '#9c1c1f',
    navy:  '#0a2c3d',
    black: '#000000',
    white: '#ffffff',
    gray:  '#f8fafc',
    cta:   'Read Insight',
    url:   'smesouthafrica.co.za'
};
// Darken/lighten a #rrggbb by a ratio (-1..1). Used to derive the premium deep-shade from the brand.
function shadeHex(hex, ratio) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(ratio < 0 ? v * (1 + ratio) : v + (255 - v) * ratio)));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
// Apply per-render brand overrides (colours + cta + url); white/black/gray stay structural.
function applyBrandToWorker(b) {
    if (!b) return;
    if (b.primary)   BRAND.red  = b.primary;
    if (b.secondary) BRAND.navy = b.secondary;
    // Premium designs paint from PC, NOT from BRAND — without this every premium design stays
    // locked to SME's colours no matter which Brand Kit is active.
    if (b.primary)   PC.red  = b.primary;
    if (b.secondary) { PC.navy = b.secondary; PC.navy2 = shadeHex(b.secondary, -0.38); }
    if (b.cta)       BRAND.cta  = b.cta;
    if (b.url)       BRAND.url  = b.url;
}

// 24x24 SVG path data (Heroicons-style)
const ICON = {
    chevronDouble: 'M13 5l7 7-7 7M5 5l7 7-7 7',
    arrowRight:    'M14 5l7 7m0 0l-7 7m7-7H3',
    book:          'M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5V19.5',
    globe:         'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9'
};

// ============ B. FONT LOADING (idempotent — load once per worker lifetime) ============
let _fontsLoaded = false;
async function loadFonts(fontBuffers) {
    if (_fontsLoaded || !fontBuffers || Object.keys(fontBuffers).length === 0) return;
    const promises = [];
    for (const key of Object.keys(fontBuffers)) {
        const { family, weight, buffer } = fontBuffers[key];
        const face = new FontFace(family, buffer, { weight: String(weight) });
        promises.push(face.load().then(f => self.fonts.add(f)).catch(() => {}));
    }
    await Promise.all(promises);
    _fontsLoaded = true;
}

// ============ C. IMAGE DECODING ============
async function blobToBitmap(blob) {
    if (!blob) return null;
    try { return await createImageBitmap(blob); }
    catch (err) { return null; }
}

// ============ D. CANVAS RENDERER ENGINE ============
class CanvasRenderer {
    constructor(logicalW, logicalH, scale) {
        this.scale = scale;
        this.w = logicalW;
        this.h = logicalH;
        // HIGH-DPI: backing store is logical * scale (e.g., 1200*3 = 3600px wide)
        this.canvas = new OffscreenCanvas(logicalW * scale, logicalH * scale);
        this.ctx = this.canvas.getContext('2d');
        // All subsequent draws happen in logical coordinates
        this.ctx.scale(scale, scale);
        this.ctx.textBaseline = 'top';
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        // DRAW TRACE (opt-in, off by default = zero cost). When enabled, the primitives below
        // record what they drew and where. That turns "the canvas has ink on it" — which passed
        // every one of the invisible-button / buried-footer / dead-space bugs — into exact
        // assertions the render tests can make. See smoke.html.
        this.trace = null;
    }
    // Records go in LOGICAL canvas coordinates, which means the current ctx transform has to be
    // applied first. Without this, anything drawn inside a translate/rotate — the resources/A guide
    // mockup draws its cover text around the origin, so y is NEGATIVE — logged coordinates that
    // exist nowhere on the canvas, and every assertion silently mis-read that design. The base
    // high-DPI scale is divided back out so records stay in 1080-space, not 3240-space.
    _tr(kind, rec) {
        if (!this.trace) return;
        let m = null;
        try { m = this.ctx.getTransform(); } catch (e) { }
        if (m && rec && typeof rec.x === 'number') {
            const s = this.scale || 1;
            const px = (x, y) => ({ x: (m.a * x + m.c * y + m.e) / s, y: (m.b * x + m.d * y + m.f) / s });
            const w = rec.w || 0, h = rec.h || 0;
            const c = [px(rec.x, rec.y), px(rec.x + w, rec.y), px(rec.x, rec.y + h), px(rec.x + w, rec.y + h)];
            const xs = c.map(p => p.x), ys = c.map(p => p.y);
            rec = Object.assign({}, rec, {
                x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
                w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
                h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
            });
        }
        this.trace.push(Object.assign({ kind }, rec));
    }

    // --- Primitives ---
    fillBg(color) { this.ctx.fillStyle = color; this.ctx.fillRect(0, 0, this.w, this.h); this._tr('fill', { x: 0, y: 0, w: this.w, h: this.h, color, bg: true }); }
    rect(x, y, w, h, color) { this.ctx.fillStyle = color; this.ctx.fillRect(x, y, w, h); this._tr('fill', { x, y, w, h, color }); }

    roundRectPath(x, y, w, h, radii) {
        const ctx = this.ctx;
        let tl, tr, br, bl;
        if (typeof radii === 'number') { tl = tr = br = bl = radii; }
        else { tl = radii.tl || 0; tr = radii.tr || 0; br = radii.br || 0; bl = radii.bl || 0; }
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        ctx.lineTo(x + bl, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
        ctx.lineTo(x, y + tl);
        ctx.quadraticCurveTo(x, y, x + tl, y);
        ctx.closePath();
    }

    fillRoundRect(x, y, w, h, radii, color) {
        this.ctx.save();
        this.roundRectPath(x, y, w, h, radii);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.restore();
        this._tr('fill', { x, y, w, h, color });
    }

    strokeLine(x1, y1, x2, y2, color, width, cap) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (cap) ctx.lineCap = cap;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    // Draw image with CSS "cover" sizing + focal point (matches background-size:cover)
    drawCover(img, dx, dy, dW, dH, focalX, focalY, clipRadii, opacity) {
        if (!img) return;
        const fx = focalX === undefined ? 0.5 : focalX;
        const fy = focalY === undefined ? 0.5 : focalY;
        const op = opacity === undefined ? 1 : opacity;
        const ctx = this.ctx;
        const iW = img.width, iH = img.height;
        const sc = Math.max(dW / iW, dH / iH);
        const sW = dW / sc;
        const sH = dH / sc;
        const sX = (iW - sW) * fx;
        const sY = (iH - sH) * fy;
        ctx.save();
        if (op < 1) ctx.globalAlpha = op;
        if (clipRadii) {
            this.roundRectPath(dx, dy, dW, dH, clipRadii);
            ctx.clip();
        }
        ctx.drawImage(img, sX, sY, sW, sH, dx, dy, dW, dH);
        ctx.restore();
        this._tr('image', { x: dx, y: dy, w: dW, h: dH });
    }

    // "contain" — centered, aspect preserved
    drawContain(img, dx, dy, dW, dH, opts) {
        if (!img) return null;
        this._tr('image', { x: dx, y: dy, w: dW, h: dH });
        opts = opts || {};
        const ctx = this.ctx;
        const iW = img.width, iH = img.height;
        const sc = Math.min(dW / iW, dH / iH);
        const sW = iW * sc;
        const sH = iH * sc;
        const sX = dx + (dW - sW) / 2;
        const sY = dy + (dH - sH) / 2;
        ctx.save();
        if (opts.filter) ctx.filter = opts.filter;
        if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
        ctx.drawImage(img, sX, sY, sW, sH);
        ctx.restore();
        return { x: sX, y: sY, w: sW, h: sH };
    }

    // Composite tint (e.g., navy multiply over image)
    tintRect(x, y, w, h, color, alpha, blend) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalCompositeOperation = blend || 'multiply';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    }

    // Linear gradient fill (direction = 'top'|'bottom'|'left'|'right'|'br'|'tr')
    linearGradient(x, y, w, h, stops, direction) {
        const ctx = this.ctx;
        let x1, y1, x2, y2;
        switch (direction) {
            case 'top':    x1=x;   y1=y+h; x2=x;   y2=y;   break;
            case 'bottom': x1=x;   y1=y;   x2=x;   y2=y+h; break;
            case 'right':  x1=x;   y1=y;   x2=x+w; y2=y;   break;
            case 'left':   x1=x+w; y1=y;   x2=x;   y2=y;   break;
            case 'br':     x1=x;   y1=y;   x2=x+w; y2=y+h; break;
            case 'tr':     x1=x;   y1=y+h; x2=x+w; y2=y;   break;
            default:       x1=x;   y1=y+h; x2=x;   y2=y;
        }
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        stops.forEach(s => grad.addColorStop(s[0], s[1]));
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        // Traced as a fill with NO single colour: a gradient backdrop is a real surface (so it must
        // hide the fill beneath it from the contrast check) but its colour varies across the box,
        // so contrast against it can't be decided from the log. Untraced, the check kept reading
        // straight through to the page background and inventing white-on-white failures.
        this._tr('fill', { x, y, w, h, color: null, gradient: true, stops: stops.map(s => s[1]) });
    }

    // Radial "blur glow" (Modern theme + carousel cover)
    radialGlow(cx, cy, radius, colorRgba, transparentRgba) {
        const ctx = this.ctx;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, colorRgba);
        grad.addColorStop(1, transparentRgba);
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        ctx.restore();
    }

    // --- Icons via Path2D + SVG path data ---
    drawIconPath(pathData, x, y, sizePx, color, strokeWidth, lineCap) {
        const ctx = this.ctx;
        const path = new Path2D(pathData);
        const sc = sizePx / 24;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sc, sc);
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth || 2;
        ctx.lineCap = lineCap || 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
        ctx.restore();
    }

    // --- TEXT ENGINE ---
    setFont(font) {
        const { family, weight, size, style } = font;
        this.ctx.font = (style || 'normal') + ' ' + weight + ' ' + size + 'px "' + family + '", sans-serif';
    }

    // Greedy word-wrap with char-level fallback for overlong tokens
    wrap(text, font, maxWidth) {
        this.setFont(font);
        const ctx = this.ctx;
        const paragraphs = String(text || '').split(/\n/);
        const out = [];
        for (const para of paragraphs) {
            const words = para.split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;
            let cur = '';
            for (const w of words) {
                const cand = cur ? cur + ' ' + w : w;
                if (ctx.measureText(cand).width <= maxWidth) {
                    cur = cand;
                } else {
                    if (cur) { out.push(cur); cur = ''; }
                    if (ctx.measureText(w).width > maxWidth) {
                        // Char-level overflow handling
                        let part = '';
                        for (const ch of w) {
                            const t = part + ch;
                            if (ctx.measureText(t).width > maxWidth) {
                                if (part) out.push(part);
                                part = ch;
                            } else {
                                part = t;
                            }
                        }
                        cur = part;
                    } else {
                        cur = w;
                    }
                }
            }
            if (cur) out.push(cur);
        }
        return out;
    }

    computeBlockHeight(numLines, size, lineHeightMul) {
        return numLines * size * (lineHeightMul || 1.1);
    }

    // Binary-search the largest font size where wrapped text fits W×H
    fitFontSize(text, fontBase, maxW, maxH, lineHeightMul, opts) {
        opts = opts || {};
        // The caller's `min` is a PREFERENCE, not a hard floor — text must never overflow/clip.
        // Always allow shrinking down to a low hard floor so a long title fits the box instead of being cut.
        const minS = Math.min(opts.min !== undefined ? opts.min : 8, opts.floor !== undefined ? opts.floor : 12);
        const maxS = opts.max !== undefined ? opts.max : 500;
        if (!text || !String(text).trim()) return { size: minS, lines: [], totalH: 0 };

        // Wrap to a hair inside the box so a font-metric quirk (e.g. faux-bold when a weight
        // isn't fully loaded in the export worker) can't push a line past the edge.
        const wrapW = maxW * 0.97;
        const tryFit = (sz) => {
            const lines = this.wrap(text, { ...fontBase, size: sz }, wrapW);
            const totalH = this.computeBlockHeight(lines.length, sz, lineHeightMul);
            return { fits: totalH <= maxH, lines, totalH };
        };

        let res;
        const top = tryFit(maxS);
        if (top.fits) { res = { size: maxS, lines: top.lines, totalH: top.totalH }; }
        else {
            const bot = tryFit(minS);
            if (!bot.fits) { res = { size: minS, lines: bot.lines, totalH: bot.totalH }; }
            else {
                let lo = minS, hi = maxS, bestSize = minS, bestLines = bot.lines, bestH = bot.totalH;
                while (hi - lo > 1) {
                    const mid = (lo + hi) >> 1;
                    const r = tryFit(mid);
                    if (r.fits) { lo = mid; bestSize = mid; bestLines = r.lines; bestH = r.totalH; }
                    else { hi = mid; }
                }
                res = { size: bestSize, lines: bestLines, totalH: bestH };
            }
        }

        // Final width guard: re-measure the widest line at the chosen size; if it STILL exceeds
        // the box (the cause of the export overflow), scale the whole title down so it fits.
        this.setFont({ ...fontBase, size: res.size });
        let widest = 0;
        for (const l of res.lines) { const w = this.ctx.measureText(l).width; if (w > widest) widest = w; }
        if (widest > maxW && res.size > 8) {
            const ns = Math.max(8, Math.floor(res.size * (maxW / widest)));
            const lines = this.wrap(text, { ...fontBase, size: ns }, wrapW);
            res = { size: ns, lines, totalH: this.computeBlockHeight(lines.length, ns, lineHeightMul) };
        }
        return res;
    }

    drawLines(lines, font, x, y, boxW, opts) {
        opts = opts || {};
        const ctx = this.ctx;
        this.setFont(font);
        // BREAK ANYTHING THAT DOES NOT FIT.
        //
        // drawLines was documented as taking lines that are ALREADY broken, and its width argument
        // only aligned them. Every call site that handed it a raw string — a headline, a subline, a
        // bullet label — therefore ran off the canvas the moment the copy was longer than the
        // fixture's. The render suite could not see it because it had no overflow check; adding one
        // surfaced 42 designs across nine families doing exactly this.
        //
        // Wrapping here rather than at 42 call sites means the failure cannot come back through a
        // new design that forgets. A caller that pre-wrapped is unaffected: its lines already fit,
        // so this is a no-op for them. A line that grows is caught by the occlusion check, which is
        // strictly better than text leaving the frame.
        if (boxW > 0) {
            const fitted = [];
            for (const ln of lines) {
                const str = String(ln == null ? '' : ln);
                if (!str || ctx.measureText(str).width <= boxW) { fitted.push(str); continue; }
                const parts = this.wrap(str, font, boxW);
                this.setFont(font);                       // wrap() re-sets the font; put ours back
                for (const p of parts) fitted.push(p);
            }
            lines = fitted;
        }
        const align = opts.align || 'left';
        const lineH = font.size * (opts.lineHeight || 1.1);
        ctx.save();
        ctx.fillStyle = opts.color || '#000000';
        if (opts.shadow) {
            ctx.shadowColor = opts.shadow.color;
            ctx.shadowBlur = opts.shadow.blur || 0;
            ctx.shadowOffsetX = opts.shadow.x || 0;
            ctx.shadowOffsetY = opts.shadow.y || 0;
        }
        if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.strokeWidth || 6; ctx.lineJoin = 'round'; ctx.miterLimit = 2; }
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const w = ctx.measureText(line).width;
            let lx = x;
            if (align === 'center') lx = x + (boxW - w) / 2;
            else if (align === 'right') lx = x + boxW - w;
            if (opts.stroke) ctx.strokeText(line, lx, y + i * lineH); // outline first, fill on top (meme style)
            ctx.fillText(line, lx, y + i * lineH);
            // Per-LINE box (not the nominal box): a right-aligned or centred line occupies only its
            // own width, and that is what has to be contrast- and overlap-checked.
            if (this.trace && String(line).trim()) {
                this._tr('text', { x: lx, y: y + i * lineH, w, h: font.size, size: font.size,
                                   color: opts.color || '#000000', text: String(line).slice(0, 60),
                                   stroke: !!opts.stroke });
            }
        }
        ctx.restore();
    }

    textWidth(text, font) {
        this.setFont(font);
        return this.ctx.measureText(String(text)).width;
    }

    drawTag(text, font, padX, padY, x, y, opts) {
        opts = opts || {};
        const ctx = this.ctx;
        this.setFont(font);
        const m = ctx.measureText(String(text));
        const tagW = m.width + padX * 2;
        const tagH = font.size + padY * 2;
        const radii = opts.radii !== undefined ? opts.radii : 0;
        this.fillRoundRect(x, y, tagW, tagH, radii, opts.bg || '#ffffff');
        if (opts.borderColor) {
            ctx.save();
            this.roundRectPath(x, y, tagW, tagH, radii);
            ctx.strokeStyle = opts.borderColor;
            ctx.lineWidth = opts.borderWidth || 1;
            ctx.stroke();
            ctx.restore();
        }
        ctx.save();
        ctx.fillStyle = opts.fg || '#000000';
        ctx.textBaseline = 'top';
        ctx.fillText(String(text), x + padX, y + padY);
        ctx.restore();
        return { width: tagW, height: tagH };
    }

    setShadow(color, blur, offsetX, offsetY) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = blur;
        this.ctx.shadowOffsetX = offsetX;
        this.ctx.shadowOffsetY = offsetY;
    }

    async toBlob(type, quality) {
        return await this.canvas.convertToBlob({ type: type || 'image/png', quality: quality === undefined ? 0.95 : quality });
    }
}

// ============ E. LAYOUT RENDERERS ============
const Layouts = {

    // ----- STANDARD: CLASSIC -----
    // Navy — the calmer counterpart to Classic. Identical layout, brand colours swapped, so the
    // panel reads SME navy with red as the accent. Exists because leaning on one red look for
    // every post makes the brand feel repetitive; this gives the same structure a second identity.
    navy(r, s, assets) {
        const red = BRAND.red, navy = BRAND.navy;
        BRAND.red = navy; BRAND.navy = red;
        try { Layouts.classic(r, s, assets); }
        finally { BRAND.red = red; BRAND.navy = navy; }
    },
    classic(r, s, assets) {
        const W = r.w, H = r.h;
        const isLand = s.format === 'landscape';
        r.fillBg(BRAND.red);

        let imgX, imgY, imgW, imgH, radii;
        if (isLand) {
            imgX = 0; imgY = 0; imgW = W * 0.45; imgH = H;
            radii = { tl: 0, tr: 60, br: 60, bl: 0 };
        } else {
            imgX = 0; imgY = 0; imgW = W; imgH = H * 0.55;
            radii = { tl: 0, tr: 0, br: 60, bl: 60 };
        }
        r.fillRoundRect(imgX, imgY, imgW, imgH, radii, '#1e293b');
        if (assets.featured) {
            r.drawCover(assets.featured, imgX, imgY, imgW, imgH, s.focalX, s.focalY, radii);
            r.ctx.save();
            r.roundRectPath(imgX, imgY, imgW, imgH, radii);
            r.ctx.clip();
            r.tintRect(imgX, imgY, imgW, imgH, BRAND.navy, 0.2, 'multiply');
            r.ctx.restore();
        }

        const contentX = isLand ? imgW : 0;
        const contentY = isLand ? 0 : imgH;
        const contentW = isLand ? W - imgW : W;
        const contentH = isLand ? H : H - imgH;
        const pad = 64;
        const innerX = contentX + pad;
        const innerY = contentY + pad;
        const innerW = contentW - pad * 2;

        const headerH = 48;
        if (assets.logo) r.drawContain(assets.logo, innerX, innerY, 160, headerH);
        const tagFont = { family: 'Roboto', weight: '700', size: 18 };
        const tagText = String(s.tag || '').toUpperCase();
        const tagPad = 24;
        const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
        const tagH = tagFont.size + 24;
        r.drawTag(tagText, tagFont, tagPad, 12, innerX + innerW - tagW, innerY + (headerH - tagH) / 2,
            { radii: 4, bg: BRAND.white, fg: BRAND.red });

        const footerH = s.showFooter ? 80 : 0;
        const footerY = contentY + contentH - pad - pSafeB() - footerH;
        const titleTop = innerY + headerH + 24;
        const titleBoxH = footerY - titleTop - 24;

        const ceilingBase = isLand ? 65 : (s.format === 'portrait' ? 95 : 80);
        const ceiling = ceilingBase * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.1,
            { max: ceiling, min: 22 });
        const titleY = titleTop + (titleBoxH - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, innerX, titleY, innerW,
            { align: 'left', color: BRAND.white, lineHeight: 1.1 });

        if (s.showFooter) {
            r.strokeLine(innerX, footerY, innerX + innerW, footerY, 'rgba(255,255,255,0.25)', 1);
            r.drawIconPath(ICON.book, innerX, footerY + 24, 26, BRAND.white, 2.2);
            r.drawLines([BRAND.cta.toUpperCase()], { family: 'Oswald', weight: '700', size: 22 }, innerX + 40, footerY + 22, 240, { color: BRAND.white });
            const urlText = BRAND.url;
            const urlFont = { family: 'Roboto', weight: '700', size: 18 };
            const urlW = r.textWidth(urlText, urlFont);
            r.drawIconPath(ICON.globe, innerX + innerW - urlW - 36, footerY + 24, 26, BRAND.white, 2.5);
            r.drawLines([urlText], urlFont, innerX + innerW - urlW, footerY + 26, urlW, { color: BRAND.white });
        }
    },

    // ----- STANDARD: CINEMATIC -----
    cinematic(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.black);
        if (assets.featured) r.drawCover(assets.featured, 0, 0, W, H, s.focalX, s.focalY, 0, 0.9);
        r.linearGradient(0, 0, W, H, [
            [0, 'rgba(10,44,61,0.2)'],
            [0.5, 'rgba(10,44,61,0.8)'],
            [1, 'rgba(10,44,61,1)']
        ], 'bottom');

        const pad = 64;
        const tagFont = { family: 'Roboto', weight: '700', size: 18 };
        r.drawTag(String(s.tag || '').toUpperCase(), tagFont, 24, 12, pad, pad,
            { radii: 4, bg: BRAND.red, fg: BRAND.white, borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1 });
        if (assets.logo) r.drawContain(assets.logo, W - pad - 200, pad, 200, 48);

        const footerH = s.showFooter ? 80 : 0;
        const titleBoxY = pad + 96;
        const titleBoxH = H - titleBoxY - footerH - pad - 24;
        const ceiling = (s.format === 'portrait' ? 95 : (s.format === 'square' ? 80 : 65)) * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, W - pad * 2, titleBoxH, 1.05,
            { max: ceiling, min: 24 });
        const titleY = titleBoxY + titleBoxH - fit.totalH;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, pad, titleY, W - pad * 2,
            { align: 'left', color: BRAND.white, lineHeight: 1.05,
              shadow: { color: 'rgba(0,0,0,0.6)', blur: 20, x: 0, y: 4 } });

        if (s.showFooter) {
            const footerY = H - pad - pSafeB() - footerH + 24;
            r.strokeLine(pad, footerY, W - pad, footerY, 'rgba(255,255,255,0.25)', 1);
            r.drawIconPath(ICON.book, pad, footerY + 24, 26, BRAND.white, 2.2);
            r.drawLines([BRAND.cta.toUpperCase()], { family: 'Oswald', weight: '700', size: 22 }, pad + 40, footerY + 22, 240, { color: BRAND.white });
            const urlText = BRAND.url;
            const urlFont = { family: 'Roboto', weight: '700', size: 18 };
            const urlW = r.textWidth(urlText, urlFont);
            r.drawIconPath(ICON.globe, W - pad - urlW - 36, footerY + 24, 26, BRAND.white, 2.5);
            r.drawLines([urlText], urlFont, W - pad - urlW, footerY + 26, urlW, { color: BRAND.white });
        }
    },

    // ----- STANDARD: MODERN -----
    modern(r, s, assets) {
        const W = r.w, H = r.h;
        const isLand = s.format === 'landscape';
        r.fillBg(BRAND.navy);
        r.radialGlow(W * 1.05, H * 0.05, 800, 'rgba(156,28,31,0.40)', 'rgba(156,28,31,0)');

        const pad = 48;
        const gap = 32;
        let imgX, imgY, imgW, imgH, txtX, txtY, txtW, txtH;
        if (isLand) {
            imgX = pad; imgY = pad; imgW = W * 0.4 - gap; imgH = H - pad * 2;
            txtX = imgX + imgW + gap; txtY = pad; txtW = W - txtX - pad; txtH = H - pad * 2;
        } else {
            imgX = pad; imgY = pad; imgW = W - pad * 2; imgH = H * 0.45;
            txtX = pad; txtY = imgY + imgH + gap; txtW = W - pad * 2; txtH = H - txtY - pad;
        }
        r.fillRoundRect(imgX, imgY, imgW, imgH, 16, '#1e293b');
        if (assets.featured) r.drawCover(assets.featured, imgX, imgY, imgW, imgH, s.focalX, s.focalY, 16);

        r.fillRoundRect(txtX, txtY, txtW, txtH, 16, BRAND.white);
        const ipad = 48;
        const innerX = txtX + ipad;
        const innerY = txtY + ipad;
        const innerW = txtW - ipad * 2;
        const innerH = txtH - ipad * 2;

        const headerH = 40;
        if (assets.logo) r.drawContain(assets.logo, innerX, innerY, 140, headerH,
            { filter: 'grayscale(1) brightness(0)', alpha: 0.8 });
        const tagFont = { family: 'Roboto', weight: '700', size: 16 };
        const tagText = String(s.tag || '').toUpperCase();
        const tagPad = 24;
        const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
        const tagH = tagFont.size + 24;
        r.drawTag(tagText, tagFont, tagPad, 12, innerX + innerW - tagW, innerY + (headerH - tagH) / 2,
            { radii: 4, bg: BRAND.red, fg: BRAND.white });

        const footerH = s.showFooter ? 70 : 0;
        // 44, not 24: the headline was landing ~29px under the mark, which reads as touching it.
        const headGap = 44;
        const titleTop = innerY + headerH + headGap;
        const titleBoxH = innerH - headerH - headGap - footerH - 24;
        const ceilingBase = isLand ? 65 : (s.format === 'portrait' ? 95 : 80);
        const ceiling = ceilingBase * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.1,
            { max: ceiling, min: 22 });
        const titleY = titleTop + (titleBoxH - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, innerX, titleY, innerW,
            { align: 'left', color: BRAND.navy, lineHeight: 1.1 });

        if (s.showFooter) {
            const footerY = innerY + innerH - footerH + 16;
            r.strokeLine(innerX, footerY, innerX + innerW, footerY, '#e2e8f0', 1);
            r.drawIconPath(ICON.book, innerX, footerY + 22, 24, BRAND.navy, 2.2);
            r.drawLines([BRAND.cta.toUpperCase()], { family: 'Oswald', weight: '700', size: 20 }, innerX + 36, footerY + 20, 240, { color: BRAND.navy });
            const urlText = BRAND.url;
            const urlFont = { family: 'Roboto', weight: '700', size: 16 };
            const urlW = r.textWidth(urlText, urlFont);
            r.drawIconPath(ICON.globe, innerX + innerW - urlW - 34, footerY + 22, 24, BRAND.navy, 2.5);
            r.drawLines([urlText], urlFont, innerX + innerW - urlW, footerY + 22, urlW, { color: BRAND.navy });
        }
    },

    // ----- CAROUSEL: COVER (slide 0) -----
    // ----- STANDARD: EDITORIAL (clean magazine, off-white) -----
    editorial(r, s, assets) {
        const W = r.w, H = r.h;
        const isLand = s.format === 'landscape';
        r.fillBg('#fcf7f8');
        const pad = Math.round(W * 0.075);
        const innerX = pad, innerW = W - pad * 2;
        const tagFont = { family: 'Roboto', weight: '700', size: Math.round(W * 0.0175) };
        const tag = r.drawTag(String(s.tag || '').toUpperCase(), tagFont, 22, 12, innerX, pad, { radii: 4, bg: BRAND.red, fg: BRAND.white });
        if (assets.logo) r.drawContain(assets.logo, innerX + innerW - 150, pad + 2, 150, 42, { filter: 'grayscale(1) brightness(0)', alpha: 0.82 });
        const imgY = pad + Math.max(tag.height, 48) + 28;
        const footerH = s.showFooter ? 64 : 0;
        // Reserve room for the HEADLINE before sizing the image. A fixed 50% image band is fine on
        // a 1080-tall canvas but on landscape (628) it left a NEGATIVE title box, so fitFontSize
        // collapsed the headline to its 22px floor and ran it into the footer. The image now yields
        // whatever the headline needs, down to a 22%-of-canvas floor of its own.
        const minTitle = Math.round(H * (isLand ? 0.30 : 0.24));
        const roomForImg = H - imgY - 44 - minTitle - pad - footerH - 12;
        const imgH = Math.max(Math.round(H * 0.22), Math.min(Math.round(H * (isLand ? 0.5 : 0.40)), roomForImg));
        r.fillRoundRect(innerX, imgY, innerW, imgH, 20, '#1e293b');
        if (assets.featured) r.drawCover(assets.featured, innerX, imgY, innerW, imgH, s.focalX, s.focalY, 20);
        r.rect(innerX, imgY + imgH + 22, Math.round(innerW * 0.16), 6, BRAND.red);
        const titleTop = imgY + imgH + 44;
        const titleBoxH = Math.max(40, H - titleTop - pad - footerH - 12);
        const ceiling = (s.format === 'portrait' ? 86 : (s.format === 'square' ? 74 : 60)) * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(), { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.08, { max: ceiling, min: 22 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, innerX, titleTop, innerW, { align: 'left', color: BRAND.navy, lineHeight: 1.08 });
        if (s.showFooter) {
            const fy = H - pad - pSafeB() - footerH + 26;
            r.strokeLine(innerX, fy, innerX + innerW, fy, 'rgba(10,44,61,0.15)', 1);
            const urlFont = { family: 'Roboto', weight: '700', size: Math.round(W * 0.0175) };
            const urlW = r.textWidth(BRAND.url, urlFont);
            r.drawIconPath(ICON.globe, innerX + innerW - urlW - 34, fy + 26, 22, BRAND.red, 2.5);
            r.drawLines([BRAND.url], urlFont, innerX + innerW - urlW, fy + 28, urlW, { color: BRAND.navy });
            r.drawIconPath(ICON.book, innerX, fy + 24, 22, BRAND.red, 2.2);
            r.drawLines([BRAND.cta.toUpperCase()], { family: 'Oswald', weight: '700', size: Math.round(W * 0.02) }, innerX + 34, fy + 24, innerW - 34, { align: 'left', color: BRAND.red });
        }
    },

    // ----- STANDARD: BOLD (typographic statement, brand red) -----
    bold(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.red);
        r.radialGlow(W * -0.05, H * 1.05, 820, 'rgba(10,44,61,0.55)', 'rgba(10,44,61,0)');
        const pad = Math.round(W * 0.08);
        const innerX = pad, innerW = W - pad * 2;
        if (assets.logo) r.drawContain(assets.logo, innerX, pad, 160, 46);
        const tagFont = { family: 'Roboto', weight: '700', size: Math.round(W * 0.0175) };
        const tagText = String(s.tag || '').toUpperCase();
        const tagW = r.textWidth(tagText, tagFont) + 44;
        r.drawTag(tagText, tagFont, 22, 12, innerX + innerW - tagW, pad + 2, { radii: 4, bg: BRAND.white, fg: BRAND.red });
        const hasImg = !!assets.featured;
        const footerH = s.showFooter ? 58 : 0;
        const stripH = hasImg ? Math.round(H * 0.22) : 0;
        const stripY = H - pad - pSafeB() - footerH - stripH;
        if (hasImg) {
            r.fillRoundRect(innerX, stripY, innerW, stripH, 16, '#1e293b');
            r.drawCover(assets.featured, innerX, stripY, innerW, stripH, s.focalX, s.focalY, 16);
        }
        const titleTop = pad + 116;
        const titleBoxH = (hasImg ? stripY - 28 : (H - pad - pSafeB() - footerH)) - titleTop;
        const ceiling = (s.format === 'portrait' ? 128 : (s.format === 'square' ? 104 : 84)) * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(), { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.02, { max: ceiling, min: 28 });
        const titleY = titleTop + Math.max(0, (titleBoxH - fit.totalH) / 2);
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, innerX, titleY, innerW, { align: 'left', color: BRAND.white, lineHeight: 1.02 });
        if (s.showFooter) {
            const fy = H - pad - pSafeB() - footerH + 22;
            r.drawIconPath(ICON.globe, innerX, fy + 24, 22, BRAND.white, 2.5);
            r.drawLines([BRAND.url], { family: 'Roboto', weight: '700', size: Math.round(W * 0.0175) }, innerX + 34, fy + 26, 600, { color: BRAND.white });
        }
    },

    carouselCover(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.navy);
        r.radialGlow(W + 100, -100, 900, 'rgba(156,28,31,0.40)', 'rgba(156,28,31,0)');

        const pad = 80;
        const innerW = W - pad * 2;
        const headerH = 64;
        if (assets.logo) r.drawContain(assets.logo, pad, pad, 220, headerH);
        const tagFont = { family: 'Roboto', weight: '700', size: 22 };
        const tagText = String(s.tag || '').toUpperCase();
        const tagPad = 26;
        const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
        const tagH = tagFont.size + 26;
        r.drawTag(tagText, tagFont, tagPad, 13, W - pad - tagW, pad + (headerH - tagH) / 2,
            { radii: 4, bg: BRAND.red, fg: BRAND.white, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 });

        const footerH = s.showFooter ? 90 : 0;
        const footerY = H - pad - pSafeB() - footerH;
        const titleTop = pad + headerH + 50;
        const titleBoxH = footerY - titleTop - 50;

        const ceiling = 110 * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.05,
            { max: ceiling, min: 28 });
        const titleY = titleTop + (titleBoxH - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, pad, titleY, innerW,
            { align: 'left', color: BRAND.white, lineHeight: 1.05,
              shadow: { color: 'rgba(0,0,0,0.4)', blur: 14, x: 0, y: 4 } });

        if (s.showFooter) {
            r.rect(pad, footerY, innerW, 4, BRAND.red);
            const circleR = 28;
            const cx = pad + circleR;
            const cy = footerY + 28 + circleR;
            r.fillRoundRect(cx - circleR, cy - circleR, circleR * 2, circleR * 2, circleR, BRAND.white);
            r.drawIconPath(ICON.arrowRight, cx - 18, cy - 18, 36, BRAND.red, 3);
            r.drawLines(['SWIPE TO READ'], { family: 'Oswald', weight: '700', size: 26 }, pad + circleR * 2 + 24, cy - 18, 400, { color: BRAND.white });
        }
    },

    // ----- CAROUSEL: BODY (slides 1-4) -----
    carouselBody(r, s, assets, slideIdx) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.white);
        r.rect(0, 0, 16, H, BRAND.red);

        const pad = 80;
        const innerX = 16 + pad;
        const innerW = W - innerX - pad;

        // Slide counter at 50% opacity
        const counterText = '0' + slideIdx + ' / 05';
        const counterFont = { family: 'Oswald', weight: '700', size: 44 };
        r.ctx.save();
        r.ctx.globalAlpha = 0.5;
        r.drawLines([counterText], counterFont, innerX, pad, 400, { color: BRAND.red });
        r.ctx.restore();

        const footerH = s.showFooter ? 60 : 0;
        const footerY = H - pad - pSafeB() - footerH;
        const titleTop = pad + counterFont.size * 1.2 + 40;
        const titleBoxH = footerY - titleTop - 40;

        const ceiling = 80 * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.1,
            { max: ceiling, min: 22 });
        const titleY = titleTop + (titleBoxH - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, innerX, titleY, innerW,
            { align: 'left', color: BRAND.navy, lineHeight: 1.1 });

        if (s.showFooter) {
            r.strokeLine(innerX, footerY, W - pad, footerY, '#e2e8f0', 2);
            if (assets.logo) r.drawContain(assets.logo, innerX, footerY + 16, 140, 40,
                { filter: 'grayscale(1) brightness(0)', alpha: 0.5 });
            const swipeText = 'SWIPE →';
            const swipeFont = { family: 'Roboto', weight: '700', size: 20 };
            const swipeW = r.textWidth(swipeText, swipeFont);
            r.drawLines([swipeText], swipeFont, W - pad - swipeW, footerY + 24, swipeW, { color: '#94a3b8' });
        }
    },

    // ----- CAROUSEL: CTA (slide 5) -----
    carouselCta(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.red);

        const pad = 80;
        const logoH = 96;
        const ctaH = s.showFooter ? 100 : 0;
        const titleSpace = H - pad * 2 - logoH - 48 - ctaH - 48;
        const stackTotal = logoH + 48 + titleSpace + 48 + ctaH;
        let cursorY = (H - stackTotal) / 2;

        if (assets.logo) r.drawContain(assets.logo, (W - 280) / 2, cursorY, 280, logoH);
        cursorY += logoH + 48;

        const ceiling = 90 * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, W - pad * 2, titleSpace, 1.05,
            { max: ceiling, min: 26 });
        const titleY = cursorY + (titleSpace - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, pad, titleY, W - pad * 2,
            { align: 'center', color: BRAND.white, lineHeight: 1.05,
              shadow: { color: 'rgba(0,0,0,0.3)', blur: 16, x: 0, y: 4 } });
        cursorY += titleSpace + 48;

        if (s.showFooter) {
            const ctaText = BRAND.cta.toUpperCase();
            const ctaFont = { family: 'Oswald', weight: '700', size: 40 };
            const ctaPad = 60;
            const ctaW = r.textWidth(ctaText, ctaFont) + ctaPad * 2;
            const ctaCardX = (W - ctaW) / 2;
            r.ctx.save();
            r.setShadow('rgba(0,0,0,0.3)', 24, 0, 12);
            r.fillRoundRect(ctaCardX, cursorY, ctaW, ctaH, 12, BRAND.white);
            r.ctx.restore();
            const textY = cursorY + (ctaH - ctaFont.size) / 2 + 2;
            r.drawLines([ctaText], ctaFont, ctaCardX, textY, ctaW, { align: 'center', color: BRAND.navy });
        }
    },

    // ----- POLL -----
    poll(r, s, assets) {
        const W = r.w, H = r.h;
        r.linearGradient(0, 0, W, H, [[0, BRAND.navy], [1, '#111827']], 'br');

        const pad = 64;
        const cardX = pad, cardY = pad;
        const cardW = W - pad * 2, cardH = H - pad * 2;
        r.ctx.save();
        r.setShadow('rgba(0,0,0,0.4)', 30, 0, 12);
        r.fillRoundRect(cardX, cardY, cardW, cardH, 40, '#1e293b');
        r.ctx.restore();
        r.ctx.save();
        r.roundRectPath(cardX, cardY, cardW, cardH, 40);
        r.ctx.strokeStyle = '#475569';
        r.ctx.lineWidth = 1;
        r.ctx.stroke();
        r.ctx.restore();

        const ipad = 64;
        const innerX = cardX + ipad;
        const innerW = cardW - ipad * 2;
        let cursorY = cardY + ipad;

        const tagFont = { family: 'Roboto', weight: '700', size: 18 };
        const tagText = String(s.tag || '').toUpperCase();
        const tagPad = 28;
        const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
        const tagH = tagFont.size + 28;
        r.drawTag(tagText, tagFont, tagPad, 14, cardX + (cardW - tagW) / 2, cursorY,
            { radii: tagH / 2, bg: BRAND.red, fg: BRAND.white, borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1 });
        cursorY += tagH + 36;

        const titleBoxH = 280;
        const ceiling = 64 * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, innerW, titleBoxH, 1.15,
            { max: ceiling, min: 24 });
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, innerX, cursorY, innerW,
            { align: 'center', color: BRAND.white, lineHeight: 1.15,
              shadow: { color: 'rgba(0,0,0,0.5)', blur: 10, x: 0, y: 4 } });
        cursorY += fit.totalH + 48;

        const opts = (s.pollOpts || []).filter(x => x && String(x).trim());
        const optH = 80, optGap = 20;
        for (let i = 0; i < opts.length; i++) {
            const oy = cursorY + i * (optH + optGap);
            r.ctx.save();
            r.setShadow('rgba(0,0,0,0.15)', 8, 0, 4);
            r.fillRoundRect(innerX, oy, innerW, optH, 14, BRAND.white);
            r.ctx.restore();
            const optFont = { family: 'Roboto', weight: '700', size: 28 };
            r.drawLines([opts[i]], optFont, innerX + 32, oy + (optH - optFont.size) / 2, innerW - 96, { color: BRAND.navy });
            const circleR = 16;
            const cxC = innerX + innerW - 32 - circleR;
            const cyC = oy + optH / 2;
            r.ctx.save();
            r.ctx.strokeStyle = '#cbd5e1';
            r.ctx.lineWidth = 3;
            r.ctx.beginPath();
            r.ctx.arc(cxC, cyC, circleR, 0, Math.PI * 2);
            r.ctx.stroke();
            r.ctx.restore();
        }
    },

    // ----- WHATSAPP -----
    whatsapp(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.navy);
        if (assets.featured) r.drawCover(assets.featured, 0, 0, W, H, s.focalX, s.focalY, 0, 0.35);
        r.linearGradient(0, 0, W, H, [
            [0, 'rgba(10,44,61,0.4)'],
            [1, 'rgba(10,44,61,0.95)']
        ], 'bottom');

        const pad = 64;
        const tagFont = { family: 'Roboto', weight: '700', size: 26 };
        const tagText = String(s.tag || '').toUpperCase();
        const tagPad = 30;
        const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
        const tagH = tagFont.size + 32;
        r.drawTag(tagText, tagFont, tagPad, 16, (W - tagW) / 2, pad + 40,
            { radii: tagH / 2, bg: BRAND.red, fg: BRAND.white, borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1 });

        const titleBoxH = 700;
        const titleBoxY = (H - titleBoxH) / 2;
        const ceiling = 100 * s.userScale * 1.4;
        const fit = r.fitFontSize(String(s.title || '').toUpperCase(),
            { family: 'Oswald', weight: '700' }, W - pad * 2, titleBoxH, 1.1,
            { max: ceiling, min: 28 });
        const titleY = titleBoxY + (titleBoxH - fit.totalH) / 2;
        r.drawLines(fit.lines.map(l => l.toUpperCase()),
            { family: 'Oswald', weight: '700', size: fit.size }, pad, titleY, W - pad * 2,
            { align: 'center', color: BRAND.white, lineHeight: 1.1,
              shadow: { color: 'rgba(0,0,0,0.85)', blur: 16, x: 2, y: 4 } });

        if (s.showFooter && assets.logo) {
            r.ctx.save();
            r.ctx.globalAlpha = 0.9;
            r.drawContain(assets.logo, (W - 320) / 2, H - pad - pSafeB() - 110, 320, 70);
            r.ctx.restore();
        }
    },

    // ----- STAT SPOTLIGHT -----
    statSpotlight(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.navy);
        r.radialGlow(W * 0.95, H * 0.08, Math.max(W, H) * 0.85, 'rgba(156,28,31,0.40)', 'rgba(156,28,31,0)');

        const pad = Math.round(W * 0.07);
        const innerW = W - pad * 2;

        const headerH = 56;
        if (assets.logo) r.drawContain(assets.logo, pad, pad, 180, headerH);
        const tagFont = { family: 'Roboto', weight: '700', size: Math.max(16, Math.round(W * 0.018)) };
        const tagText = String(s.tag || '').toUpperCase();
        if (tagText) {
            const tagPad = 24;
            const tagW = r.textWidth(tagText, tagFont) + tagPad * 2;
            const tagH = tagFont.size + 24;
            r.drawTag(tagText, tagFont, tagPad, 12, W - pad - tagW, pad + (headerH - tagH) / 2,
                { radii: 4, bg: BRAND.red, fg: BRAND.white, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 });
        }

        const footerH = s.showFooter ? 80 : 0;
        const footerY = H - pad - pSafeB() - footerH;
        const blockTop = pad + headerH + 30;
        const blockBottom = footerY - 30;
        const blockH = blockBottom - blockTop;

        const statText = String(s.stat || '').trim() || '—';
        const ctxText = String(s.title || '').trim();

        const statBoxH = blockH * (ctxText ? 0.62 : 0.88);
        const statCeil = Math.min(W, H) * 0.42 * (s.userScale || 1) * 1.4;
        const statFit = r.fitFontSize(statText, { family: 'Oswald', weight: '700' }, innerW, statBoxH, 1.0, { max: statCeil, min: 40 });

        let ctxFit = { size: 0, lines: [], totalH: 0 };
        if (ctxText) {
            const ctxBoxH = blockH * 0.34;
            const ctxCeil = Math.min(W, H) * 0.055 * (s.userScale || 1) * 1.4;
            ctxFit = r.fitFontSize(ctxText, { family: 'Roboto', weight: '700' }, innerW, ctxBoxH, 1.2, { max: ctxCeil, min: 18 });
        }

        const gap = ctxText ? 28 : 0;
        const stackH = statFit.totalH + gap + ctxFit.totalH;
        let cy = blockTop + (blockH - stackH) / 2;

        r.drawLines(statFit.lines, { family: 'Oswald', weight: '700', size: statFit.size }, pad, cy, innerW,
            { align: 'center', color: BRAND.white, lineHeight: 1.0, shadow: { color: 'rgba(0,0,0,0.35)', blur: 18, x: 0, y: 6 } });
        cy += statFit.totalH + gap;
        if (ctxText) {
            r.drawLines(ctxFit.lines, { family: 'Roboto', weight: '700', size: ctxFit.size }, pad, cy, innerW,
                { align: 'center', color: 'rgba(255,255,255,0.92)', lineHeight: 1.2 });
        }

        if (s.showFooter) {
            r.rect(pad, footerY, innerW, 4, BRAND.red);
            r.drawIconPath(ICON.book, pad, footerY + 24, 26, BRAND.white, 2.2);
            r.drawLines([BRAND.cta.toUpperCase()], { family: 'Oswald', weight: '700', size: 22 }, pad + 40, footerY + 22, 260, { color: BRAND.white });
            const urlText = BRAND.url;
            const urlFont = { family: 'Roboto', weight: '700', size: 18 };
            const urlW = r.textWidth(urlText, urlFont);
            r.drawIconPath(ICON.globe, W - pad - urlW - 36, footerY + 24, 26, BRAND.white, 2.5);
            r.drawLines([urlText], urlFont, W - pad - urlW, footerY + 26, urlW, { color: BRAND.white });
        }
    },

    // ----- QUOTE / TESTIMONIAL -----
    quote(r, s, assets) {
        const W = r.w, H = r.h;
        r.fillBg(BRAND.navy);
        r.radialGlow(W * 0.05, H * 0.95, Math.max(W, H) * 0.75, 'rgba(156,28,31,0.35)', 'rgba(156,28,31,0)');

        const pad = Math.round(W * 0.08);
        const innerW = W - pad * 2;

        const headerH = 52;
        const tagFont = { family: 'Roboto', weight: '700', size: Math.max(16, Math.round(W * 0.018)) };
        const tagText = String(s.tag || '').toUpperCase();
        if (tagText) {
            const tagPad = 24;
            r.drawTag(tagText, tagFont, tagPad, 12, pad, pad, { radii: 4, bg: BRAND.red, fg: BRAND.white });
        }
        if (assets.logo) r.drawContain(assets.logo, W - pad - 170, pad, 170, headerH);

        const qmFont = { family: 'Oswald', weight: '700', size: Math.round(W * 0.18) };
        r.drawLines(['\u201C'], qmFont, pad - Math.round(W * 0.012), pad + headerH, innerW,
            { align: 'left', color: BRAND.red, lineHeight: 1 });

        const footerH = s.showFooter ? 70 : 0;
        const footerY = H - pad - pSafeB() - footerH;

        const authorText = String(s.author || '').trim();
        const authorFont = { family: 'Roboto', weight: '700', size: Math.max(16, Math.round(W * 0.024)) };
        const authorBlockH = authorText ? authorFont.size + 28 : 0;

        const quoteTop = pad + headerH + Math.round(W * 0.15);
        const quoteBottom = footerY - authorBlockH - 16;
        const quoteBoxH = Math.max(60, quoteBottom - quoteTop);
        const quoteText = String(s.title || '').trim();
        const qCeil = Math.min(W, H) * 0.085 * (s.userScale || 1) * 1.4;
        const qFit = r.fitFontSize(quoteText, { family: 'Oswald', weight: '700' }, innerW, quoteBoxH, 1.18, { max: qCeil, min: 22 });
        const qy = quoteTop + (quoteBoxH - qFit.totalH) / 2;
        r.drawLines(qFit.lines, { family: 'Oswald', weight: '700', size: qFit.size }, pad, qy, innerW,
            { align: 'left', color: BRAND.white, lineHeight: 1.18 });

        if (authorText) {
            const ay = qy + qFit.totalH + 26;
            r.strokeLine(pad, ay + authorFont.size / 2, pad + 36, ay + authorFont.size / 2, BRAND.red, 3, 'round');
            r.drawLines([authorText], authorFont, pad + 50, ay, innerW - 50, { align: 'left', color: 'rgba(255,255,255,0.9)' });
        }

        if (s.showFooter) {
            r.strokeLine(pad, footerY, W - pad, footerY, 'rgba(255,255,255,0.2)', 1);
            const urlText = BRAND.url;
            const urlFont = { family: 'Roboto', weight: '700', size: 18 };
            const urlW = r.textWidth(urlText, urlFont);
            r.drawIconPath(ICON.globe, pad, footerY + 22, 24, BRAND.white, 2.5);
            r.drawLines([urlText], urlFont, pad + 34, footerY + 24, urlW, { color: BRAND.white });
        }
    },

    // ----- MEME (full-frame photo + classic white/black-outline top & bottom text) -----
    meme(r, s, assets) {
        const W = r.w, H = r.h;
        if (assets.featured) r.drawCover(assets.featured, 0, 0, W, H, s.focalX, s.focalY, 0, 1);
        else r.fillBg('#111111');
        const pad = Math.round(W * 0.05);
        const boxW = W - pad * 2;
        // Typography scale applies here too — meme was the ONE layout ignoring userScale, so the
        // slider appeared dead. The band grows with the text (capped at 38% per band so the top
        // and bottom can never collide) and the type ceiling scales with it.
        const us = Math.max(0.6, Math.min(1.4, s.userScale || 1));
        const boxH = Math.round(H * Math.max(0.14, Math.min(0.38, 0.26 * us)));
        const maxSize = Math.round(H * 0.13 * us);
        const fontBase = { family: 'Oswald', weight: '900' };
        const drawBand = (text, atBottom) => {
            if (!text || !text.trim()) return;
            const fit = r.fitFontSize(String(text).toUpperCase(), fontBase, boxW, boxH, 1.05, { max: maxSize, min: 24 });
            if (!fit.lines.length) return;
            // The renderer runs with textBaseline='top', so y is the TOP of the first line.
            // The old '+ size * 0.82' compensated for a baseline that isn't in play and pushed
            // the bottom band clean off the canvas — hence the cut-off last line.
            const y0 = atBottom ? (H - pad - pSafeB() - fit.totalH) : (pad + pSafeT());
            r.drawLines(fit.lines, { ...fontBase, size: fit.size }, pad, y0, boxW, {
                align: 'center', color: '#ffffff',
                stroke: '#000000', strokeWidth: Math.max(6, Math.round(fit.size * 0.14)),
                shadow: { color: 'rgba(0,0,0,0.5)', blur: 12, x: 0, y: 4 }, lineHeight: 1.05
            });
        };
        drawBand(s.memeTop, false);
        drawBand(s.memeBottom, true);
    }
};

// ============ F. SLIDE DISPATCHER ============
function renderSlide(state, slideIdx, assets, scale, trace) {
    let w, h;
    if (state.campaign === 'poll') { w = 1080; h = 1080; }
    else if (state.campaign === 'whatsapp') { w = 1080; h = 1350; }
    else {
        if (state.format === 'landscape') { w = 1200; h = 628; }
        else if (state.format === 'square') { w = 1080; h = 1080; }
        else if (state.format === 'story') { w = 1080; h = 1920; }   // IG/FB story, 9:16
        else { w = 1080; h = 1350; }
    }

    const r = new CanvasRenderer(w, h, scale);
    if (trace) r.trace = [];

    if (state.campaign === 'standard') {
        if (state.theme === 'cinematic')      Layouts.cinematic(r, state, assets);
        else if (state.theme === 'modern')    Layouts.modern(r, state, assets);
        else if (state.theme === 'editorial') Layouts.editorial(r, state, assets);
        else if (state.theme === 'bold')      Layouts.bold(r, state, assets);
        else if (state.theme === 'navy')      Layouts.navy(r, state, assets);
        else                                  Layouts.classic(r, state, assets);
    } else if (state.campaign === 'carousel') {
        const slideText = state.slides[slideIdx] || '';
        const slideState = { ...state, title: slideText };
        if (slideIdx === 0)      Layouts.carouselCover(r, slideState, assets);
        else if (slideIdx === 5) Layouts.carouselCta(r, slideState, assets);
        else                     Layouts.carouselBody(r, slideState, assets, slideIdx);
    } else if (state.campaign === 'poll') {
        Layouts.poll(r, state, assets);
    } else if (state.campaign === 'whatsapp') {
        Layouts.whatsapp(r, state, assets);
    } else if (state.campaign === 'stat') {
        Layouts.statSpotlight(r, state, assets);
    } else if (state.campaign === 'quote') {
        Layouts.quote(r, state, assets);
    } else if (state.campaign === 'meme') {
        Layouts.meme(r, state, assets);
    }

    return r;
}

// ============ G. MESSAGE HANDLER ============
// ============ PREMIUM CONTENT-TYPE RENDERER (canvas engine; 1080x1080) ============
// Renders the same designs shown in the preview, natively on canvas → clean PNG export (no taint).
const PC = { navy:'#0a2c3d', navy2:'#061f2b', red:'#9c1c1f', off:'#fcf7f8', ink:'#0f172a', slate:'#475569', line:'#e2e8f0', paper:'#ffffff', cbd:'#cbd5e1', f8:'#f8fafc', white:'#ffffff' };
// ---- Brand-safe contrast ----------------------------------------------------------------
// PC's colours come from the ACTIVE Brand Kit, so "navy" may not be dark and "paper" may not be
// light. Never assume: derive readable text from the real background luminance (WCAG relative
// luminance + contrast ratio). One brand with a light secondary was enough to prove the point —
// it rendered white text on a near-white panel.
function pLum(hex) {
    const h = String(hex || '').replace('#', '').trim();
    if (h.length !== 6) return 0;
    const n = parseInt(h, 16);
    if (!isFinite(n)) return 0;
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function pContrast(a, b) {
    const la = pLum(a), lb = pLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function pIsLight(hex) { return pLum(hex) > 0.42; }
function pRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '').trim();
    if (h.length !== 6) return 'rgba(0,0,0,' + alpha + ')';
    const n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}
function pInk(bg) { return pIsLight(bg) ? PC.ink : PC.white; }           // body/heading on bg
function pSubInk(bg) { return pIsLight(bg) ? PC.slate : PC.cbd; }        // secondary text on bg
function pOn(bg, whenDark, whenLight) { return pIsLight(bg) ? whenLight : whenDark; }
function pShade(hex, ratio) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.max(0, Math.min(255, Math.round(ratio < 0 ? v * (1 + ratio) : v + (255 - v) * ratio)));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---- Premium geometry (dimension-awareness) ---------------------------------------------
// Every premium design is AUTHORED at 1080x1080. When the canvas is taller (portrait 1080x1350)
// the old code rendered the square and letterboxed it with stretched edge rows — which read as a
// floating box with flat dead bands, and still carried the square's own slack between the copy
// and the bottom-pinned CTA. Instead we now render NATIVELY at W x H and scale the VERTICAL
// rhythm (pads, gaps, block heights, type ceilings) by k = H/W. Horizontal metrics and text
// wrapping are untouched, so nothing re-wraps unexpectedly — the design just breathes into the
// extra height. At square (k = 1) every value is identical to before, so square is a no-op.
let PG = null;
function pGeom(W, H) {
    // STORY SAFE ZONES. A 9:16 canvas is not a blank canvas — Instagram and Facebook paint their
    // own UI over the top and bottom of it. The profile row and progress bars own roughly the top
    // 190px of 1920, and the reply bar plus "Send message" field own the bottom 260px, opaquely.
    // Everything Volt draws is deliberate, so nothing it draws should land under that chrome: the
    // first funding story rendered its CTA button at y=1820, entirely behind the reply bar.
    // These insets are reserved at the top and bottom of every 9:16 design and at no other size.
    const story = (H / W) >= 1.7;
    const safeTop = story ? Math.round(H * 0.099) : 0;   // ~190px of 1920
    const safeBot = story ? Math.round(H * 0.135) : 0;   // ~260px of 1920
    // The rhythm is measured against the space a design may actually USE, not the raw canvas.
    // 1.32 was the ceiling when portrait (1.25) was the tallest canvas; deriving k from H alone
    // then gave every story a top-down flow budgeted for 1920px of room while its CTA was pinned
    // 260px higher, and the two met in the middle — the bullets ended up under the button. Story
    // lays out on a 1080x1470 stage, so k lands at 1.36, close to portrait.
    const k = Math.max(0.9, Math.min(1.85, (H - safeTop - safeBot) / W));
    PG = {
        k: k,
        safeTop: safeTop,
        safeBot: safeBot,
        story: story,
        pad:  Math.round(82  * Math.min(1.20, k)),   // frame padding
        btn:  Math.round(112 * Math.min(1.14, k)),   // pButton height
        pill: Math.round(64  * Math.min(1.10, k)),   // pPill height
        bul:  Math.round(58  * Math.min(1.10, k)),   // pBullet box
        v: n => Math.round(n * k),                       // vertical gap / block height
        t: n => Math.round(n * (1 + (k - 1) * 0.55))     // type ceiling — grows, but gently
    };
    return PG;
}
function pV(n) { return PG ? PG.v(n) : Math.round(n); }
function pT(n) { return PG ? PG.t(n) : Math.round(n); }
function pPad()  { return PG ? PG.pad  : 82; }
// Reserved chrome. Both are 0 at every size except 9:16, so adding them to an anchor is a no-op
// for landscape/square/portrait and the only correct answer for a story.
function pSafeT() { return PG ? PG.safeTop : 0; }
function pSafeB() { return PG ? PG.safeBot : 0; }
// The y a design's first element may occupy. pLogo already uses it; anything else pinned to the
// top of the frame (the podcast masthead) has to use it too or it renders under the profile row.
function pTop()   { return pPad() + pSafeT(); }
function pBtnH() { return PG ? PG.btn  : 112; }

function pPill(r, x, y, text, bg, fg) {
    const h = PG ? PG.pill : 64;
    const fs = Math.round(30 * (h / 64));
    const f = { family: 'Oswald', weight: '700', size: fs };
    const t = String(text || '').toUpperCase(), padX = 34;
    const w = r.textWidth(t, f) + padX * 2;
    r.fillRoundRect(x, y, w, h, h / 2, bg);
    r.drawLines([t], f, x + padX, y + (h - fs) / 2, w, { color: fg });
    return h;
}
function pButton(r, x, y, w, text, bg, fg) {
    const h = pBtnH(), fs = Math.round(40 * Math.min(1.1, h / 112));
    const f = { family: 'Oswald', weight: '700', size: fs };
    r.fillRoundRect(x, y, w, h, 22, bg);
    r.drawLines([String(text || '').toUpperCase()], f, x, y + (h - fs) / 2, w, { color: fg, align: 'center' });
    return h;
}
// A LIST THAT KNOWS WHEN TO STOP. Items are drawn only while they fit above `limitY`; the rest
// are dropped rather than stacked under the CTA. Long copy at a square dimension is where this
// bites — the same three bullets that fit a portrait card run into the button on a 1080x1080.
function pBullets(r, x, y, items, boxColor, txtColor, limitY, gap) {
    const s = PG ? PG.bul : 58;
    let drawn = 0;
    for (const it of items) {
        if (!it) continue;
        if (limitY && y + s > limitY) break;      // no room left: stop, do not overlap the button
        y += pBullet(r, x, y, String(it), boxColor, txtColor) + (gap == null ? pV(18) : gap);
        drawn++;
    }
    return { y, drawn };
}
function pBullet(r, x, y, text, boxColor, txtColor) {
    const s = PG ? PG.bul : 58, fs = Math.round(40 * Math.min(1.08, s / 58));
    r.fillRoundRect(x, y, s, s, 16, boxColor);
    r.drawLines(['✓'], { family: 'Oswald', weight: '900', size: Math.round(s * 0.586) }, x, y + s * 0.2, s, { color: '#fff', align: 'center' });
    // WRAP. drawLines takes lines that are ALREADY broken — its width argument only aligns them —
    // so handing it one long string ran the label off the right edge of the canvas. Short test
    // copy ("First supporting point") never reached the edge, which is why every family shipped
    // with this and nothing flagged it until a real webinar takeaway was long enough to fall off.
    const font = { family: 'Roboto', weight: '400', size: fs };
    const boxW = r.w - x - s - 28 - pPad();
    const lines = r.wrap(String(text || ''), font, boxW);
    const th = lines.length * fs * 1.3;
    r.drawLines(lines, font, x + s + 28, y + Math.max(0, (s - th) / 2), boxW, { color: txtColor, lineHeight: 1.3 });
    return Math.max(s, th);
}
function drawPremium(r, type, dir, v, assets) {
    r.ctx.textBaseline = 'top';
    v = v || {}; assets = assets || {};
    pGeom(r.w, r.h);                                  // set the vertical rhythm for this canvas
    if (type === 'funding')   return drawFunding(r, dir, v, assets);
    if (type === 'solutions') return drawSolutions(r, dir, v, assets);
    if (type === 'newsletter') return drawNewsletter(r, dir, v, assets);
    if (type === 'resources') return drawResources(r, dir, v, assets);
    if (type === 'providers') return drawProviders(r, dir, v, assets);
    if (type === 'findpros')  return drawFindPros(r, dir, v, assets);
    if (type === 'podcast')   return drawPodcast(r, dir, v, assets);
    if (type === 'merch')     return drawMerch(r, dir, v, assets);
    if (type === 'feature')   return drawFeature(r, dir, v, assets);
    if (type === 'hub')       return drawHub(r, dir, v, assets);
    if (type === 'glossary')  return drawGlossary(r, dir, v, assets);
    if (type === 'webinar')   return drawWebinar(r, dir, v, assets);
    r.fillBg(PC.navy); // safety fallback
}

// ===================== SME HUB · GLOSSARY · WEBINARS =====================
// Three sections of the site that had no way to be posted about. Each family is built around what
// that section actually DOES, not around a generic "promote a page" layout:
//
//   hub       the Hub sells MEMBERSHIP, and its own gating is the argument — the site literally
//             shows guests a locked panel. That tension is the post.
//   glossary  a definition is the most shareable unit SME South Africa publishes: one term, plain
//             English, saveable. It wants to look like a dictionary card, not an advert.
//   webinar   a session sells on WHEN and WHO. A date with no time is not a registration prompt,
//             so every direction carries the full when, the format, and one clear action.

// ---- SME HUB -----------------------------------------------------------------------------------
function drawHub(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') {
        // THE LOCK. The Hub's own paywall, drawn honestly: the thing you cannot see is the offer.
        // Blurring a headline is a cliché; naming what sits behind it is an argument.
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
        r.radialGlow(W, 0, 520, 'rgba(156,28,31,0.26)', 'rgba(156,28,31,0)');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogo(r, a, PC.navy);
        y += pPill(r, pad, y, v.pill || 'Members only', acc.fill, acc.on) + pV(30);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(240), 1.06, { max: pT(80), min: 40 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.06 });
        y += fit.totalH + pV(26);
        // The locked list. Ticks would say "you have these"; locks say "you do not, yet".
        [v.i1, v.i2, v.i3, v.i4].forEach(function (it) {
            if (!it) return;
            const s = PG ? PG.bul : 58;
            r.fillRoundRect(pad, y, s, s, 16, 'rgba(255,255,255,0.10)');
            r.drawLines(['🔒'], { family: 'Roboto', weight: '700', size: Math.round(s * 0.46) }, pad, y + s * 0.24, s, { color: acc.text, align: 'center' });
            r.drawLines([String(it)], { family: 'Roboto', weight: '500', size: 36 }, pad + s + 28, y + (s - 36) / 2, iW - s - 28, { color: PC.cbd });
            y += s + pV(20);
        });
        pFootAt(r, btnY - pV(34), v.url || '', v.count || '', false, acc.text);
        pButton(r, pad, btnY, iW, v.cta || 'Join the community →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') {
        // SOCIAL PROOF. One number, and the sentence that makes it mean something.
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy);
        r.rect(0, 0, W, 22, acc.fill);
        let y = pLogo(r, a, PC.paper) + pV(14);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text });
        y += pV(50);
        const bigFit = r.fitFontSize(String(v.big || ''), { family: 'Oswald', weight: '900' }, iW, pV(200), 1, { max: pT(170), min: 60 });
        r.drawLines(bigFit.lines, { family: 'Oswald', weight: '900', size: bigFit.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1 });
        y += bigFit.totalH + pV(12);
        r.drawLines([String(v.bigLabel || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 34 }, pad, y, iW, { color: acc.text });
        y += pV(56);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: PC.slate, lineHeight: 1.4 });
        y += sub.length * 38 * 1.4 + pV(26);
        pBullets(r, pad, y, [v.i1, v.i2, v.i3], acc.fill, pInk(PC.paper), btnY - pV(40));
        { const c2 = pSolid(PC.paper, PC.navy, PC.red); pButton(r, pad, btnY, iW, v.cta || 'Join free →', c2.fill, c2.on); }
        pFootAt(r, btnY - pV(30), v.url || '', '', true, acc.text);
        return;
    }

    // A: THE MEMBERSHIP CARD. What you get, in the order a founder cares about.
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
    r.radialGlow(0, H, 560, 'rgba(156,28,31,0.30)', 'rgba(156,28,31,0)');
    const acc = pSolid(PC.navy, PC.red, PC.paper);
    let y = pLogo(r, a, PC.navy);
    r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text });
    y += pV(52);
    const fitA = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(250), 1.05, { max: pT(84), min: 40 });
    r.drawLines(fitA.lines, { family: 'Oswald', weight: '700', size: fitA.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.05 });
    y += fitA.totalH + pV(20);
    const subA = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
    r.drawLines(subA, { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: PC.cbd, lineHeight: 1.4 });
    y += subA.length * 38 * 1.4 + pV(30);
    pBullets(r, pad, y, [v.i1, v.i2, v.i3, v.i4], acc.fill, '#ffffff', btnY - pV(40));
    pFootAt(r, btnY - pV(34), v.url || '', v.price || '', false, acc.text);
    pButton(r, pad, btnY, iW, v.cta || 'Join the community →', acc.fill, acc.on);
}

// ---- GLOSSARY ----------------------------------------------------------------------------------
function drawGlossary(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') {
        // THE CORRECTION. Most glossary terms are words people already use wrongly, and "you think
        // it means X" earns a stop in a way "here is a definition" never does.
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogo(r, a, PC.navy);
        y += pPill(r, pad, y, v.pill || 'Plain English', acc.fill, acc.on) + pV(28);
        const tFit = r.fitFontSize(String(v.term || '').toUpperCase(), { family: 'Oswald', weight: '900' }, iW, pV(150), 1.02, { max: pT(96), min: 44 });
        r.drawLines(tFit.lines, { family: 'Oswald', weight: '900', size: tFit.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.02 });
        y += tFit.totalH + pV(34);
        // Two panels: the assumption, then the fact. The second is the brand colour so the eye
        // lands on the answer rather than the misconception.
        const panelW = iW, ph = pV(150);
        r.fillRoundRect(pad, y, panelW, ph, 20, 'rgba(255,255,255,0.06)');
        r.drawLines([String(v.mythLabel || 'What people think').toUpperCase()], { family: 'Oswald', weight: '700', size: 26 }, pad + 26, y + 22, panelW - 52, { color: PC.cbd });
        { const w1 = r.wrap(String(v.myth || ''), { family: 'Roboto', weight: '500', size: 34 }, panelW - 52);
          r.drawLines(w1.slice(0, 3), { family: 'Roboto', weight: '500', size: 34 }, pad + 26, y + 62, panelW - 52, { color: pInk(PC.navy), lineHeight: 1.32 }); }
        y += ph + pV(18);
        r.fillRoundRect(pad, y, panelW, ph, 20, pRgba(acc.fill, 0.92));
        r.drawLines([String(v.truthLabel || 'What it actually means').toUpperCase()], { family: 'Oswald', weight: '700', size: 26 }, pad + 26, y + 22, panelW - 52, { color: pRgba(acc.on, 0.8) });
        { const w2 = r.wrap(String(v.truth || ''), { family: 'Roboto', weight: '700', size: 34 }, panelW - 52);
          r.drawLines(w2.slice(0, 3), { family: 'Roboto', weight: '700', size: 34 }, pad + 26, y + 62, panelW - 52, { color: acc.on, lineHeight: 1.32 }); }
        pFootAt(r, btnY - pV(30), v.url || '', '', false, acc.text);
        pButton(r, pad, btnY, iW, v.cta || 'Read the full definition →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') {
        // THREE AT A TIME. A saveable mini-reference; the format people screenshot.
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.navy, PC.red);
        r.rect(0, 0, W, 22, pSolid(PC.paper, PC.red, PC.navy).fill);
        let y = pLogo(r, a, PC.paper) + pV(10);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: pAccentText(PC.paper, PC.red) });
        y += pV(50);
        const hFit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(170), 1.05, { max: pT(70), min: 36 });
        r.drawLines(hFit.lines, { family: 'Oswald', weight: '700', size: hFit.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.05 });
        y += hFit.totalH + pV(30);
        // Each entry is "term — definition" on a ruled row: the shape of a reference, not a list.
        [[v.t1, v.d1], [v.t2, v.d2], [v.t3, v.d3]].forEach(function (pair) {
            if (!pair[0]) return;
            r.rect(pad, y, 10, pV(76), acc.fill);
            r.drawLines([String(pair[0]).toUpperCase()], { family: 'Oswald', weight: '700', size: 38 }, pad + 30, y, iW - 30, { color: pInk(PC.paper) });
            const dw = r.wrap(String(pair[1] || ''), { family: 'Roboto', weight: '400', size: 32 }, iW - 30);
            r.drawLines(dw.slice(0, 2), { family: 'Roboto', weight: '400', size: 32 }, pad + 30, y + 46, iW - 30, { color: PC.slate, lineHeight: 1.3 });
            y += pV(76) + Math.max(0, (dw.length - 1)) * 20 + pV(28);
        });
        { const c2 = pSolid(PC.paper, PC.red, PC.navy); pButton(r, pad, btnY, iW, v.cta || 'Browse the glossary →', c2.fill, c2.on); }
        pFootAt(r, btnY - pV(30), v.url || '', '', true, acc.fill);
        return;
    }

    // A: THE DEFINITION CARD. One term, one plain-English definition, and why it matters. This is
    // the whole product of the glossary in a single frame — no scroll, no click, nothing withheld.
    r.fillBg(PC.paper);
    const acc = pSolid(PC.paper, PC.navy, PC.red);
    const accT = pAccentText(PC.paper, PC.red);
    r.rect(0, 0, W, 26, pSolid(PC.paper, PC.red, PC.navy).fill);
    let y = pLogo(r, a, PC.paper) + pV(12);
    r.drawLines([String(v.eyebrow || 'Business glossary').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: accT });
    y += pV(46);
    const tf = r.fitFontSize(String(v.term || '').toUpperCase(), { family: 'Oswald', weight: '900' }, iW, pV(170), 1.02, { max: pT(104), min: 46 });
    r.drawLines(tf.lines, { family: 'Oswald', weight: '900', size: tf.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.02 });
    y += tf.totalH + pV(10);
    r.strokeLine(pad, y, pad + Math.min(iW, W * 0.28), y, acc.fill, 8);
    y += pV(30);
    { const df = r.fitFontSize(String(v.definition || ''), { family: 'Roboto', weight: '400' }, iW, pV(300), 1.38, { max: 42, min: 26 });
      r.drawLines(df.lines, { family: 'Roboto', weight: '400', size: df.size }, pad, y, iW, { color: PC.ink, lineHeight: 1.38 });
      y += df.totalH + pV(30); }
    if (v.why) {
        // A definition tells you what a word means; this line tells you why to care. Panelled so it
        // reads as commentary rather than more of the definition.
        const ww = r.wrap(String(v.why), { family: 'Roboto', weight: '500', size: 34 }, iW - 52);
        const bh = 44 + ww.length * 34 * 1.32 + 22;
        r.fillRoundRect(pad, y, iW, bh, 20, pRgba(acc.fill, 0.07));
        r.rect(pad, y, 10, bh, acc.fill);
        r.drawLines([String(v.whyLabel || 'Why it matters').toUpperCase()], { family: 'Oswald', weight: '700', size: 26 }, pad + 30, y + 20, iW - 52, { color: accT });
        r.drawLines(ww, { family: 'Roboto', weight: '500', size: 34 }, pad + 30, y + 56, iW - 52, { color: PC.ink, lineHeight: 1.32 });
    }
    { const c2 = pSolid(PC.paper, PC.red, PC.navy); pButton(r, pad, btnY, iW, v.cta || 'More terms, plain English →', c2.fill, c2.on); }
    pFootAt(r, btnY - pV(30), v.url || '', '', true, accT);
}

// ---- WEBINARS / EVENTS -------------------------------------------------------------------------
function drawWebinar(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') {
        // THE SPEAKER. People register for a person before they register for a topic.
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W, H, 520, 'rgba(156,28,31,0.24)', 'rgba(156,28,31,0)');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogo(r, a, PC.navy);
        y += pPill(r, pad, y, v.pill || 'Free webinar', acc.fill, acc.on) + pV(26);
        // Speaker photo if there is one; a lettered disc if not, so the layout never has a hole.
        const ps = pV(220);
        if (a.featured) {
            r.ctx.save(); r.roundRectPath(pad, y, ps, ps, ps / 2); r.ctx.clip();
            r.drawCover(a.featured, pad, y, ps, ps, 0.5, 0.35, 0, 1); r.ctx.restore();
        } else {
            r.fillRoundRect(pad, y, ps, ps, ps / 2, pRgba(acc.fill, 0.9));
            r.drawLines([String(v.speaker || 'S').trim().charAt(0).toUpperCase()], { family: 'Oswald', weight: '700', size: Math.round(ps * 0.42) }, pad, y + ps * 0.26, ps, { color: acc.on, align: 'center' });
        }
        y += ps + pV(26);
        r.drawLines([String(v.speaker || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 46 }, pad, y, iW, { color: pInk(PC.navy) });
        y += pV(56);
        if (v.role) { r.drawLines([String(v.role)], { family: 'Roboto', weight: '400', size: 34 }, pad, y, iW, { color: PC.cbd }); y += pV(50); }
        const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(200), 1.06, { max: pT(66), min: 34 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, iW, { color: acc.text, lineHeight: 1.06 });
        pFootAt(r, btnY - pV(34), (v.date || '') + (v.time ? '  ·  ' + v.time : ''), v.format || '', false, acc.text);
        pButton(r, pad, btnY, iW, v.cta || 'Save your seat →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') {
        // WHAT YOU WILL LEARN. The objection to a free webinar is never price, it is time.
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.navy, PC.red);
        const accT = pAccentText(PC.paper, PC.red);
        r.rect(0, 0, W, 24, pSolid(PC.paper, PC.red, PC.navy).fill);
        let y = pLogo(r, a, PC.paper) + pV(12);
        r.drawLines([String(v.eyebrow || 'In this session').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: accT });
        y += pV(48);
        const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(220), 1.05, { max: pT(74), min: 38 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.05 });
        y += hf.totalH + pV(30);
        y = pBullets(r, pad, y, [v.i1, v.i2, v.i3], acc.fill, pInk(PC.paper), btnY - pV(150), pV(20)).y + pV(10);
        // The when, given its own weight — a session with no time is not a registration prompt.
        if (v.date) {
            const bh = pV(110);
            r.fillRoundRect(pad, Math.min(y, btnY - pV(46) - bh), iW, bh, 18, pRgba(acc.fill, 0.08));
            const by = Math.min(y, btnY - pV(46) - bh);
            r.drawLines([String(v.date).toUpperCase()], { family: 'Oswald', weight: '700', size: 40 }, pad + 28, by + 20, iW - 56, { color: pInk(PC.paper) });
            r.drawLines([[v.time, v.format].filter(Boolean).join('  ·  ')], { family: 'Roboto', weight: '400', size: 30 }, pad + 28, by + 68, iW - 56, { color: PC.slate });
        }
        { const c2 = pSolid(PC.paper, PC.red, PC.navy); pButton(r, pad, btnY, iW, v.cta || 'Register free →', c2.fill, c2.on); }
        pFootAt(r, btnY - pV(30), v.url || '', '', true, accT);
        return;
    }

    // ---- ON DEMAND (D/E/F) ---------------------------------------------------------------------
    // A past session sells on something completely different from an upcoming one. Upcoming trades
    // on WHEN and scarcity: a date, a seat, a deadline. Once it has happened, the date is the one
    // thing working AGAINST you — "18 June 2026" on a card in August reads as expired, not as
    // archive. So on-demand leads with the CONTENT and demotes the date to a credential.
    //
    // The library is also the bigger asset: dozens of past sessions against one upcoming, and every
    // one of them is a permanent, re-postable thing that never goes out of date.
    if (dir === 'd') {
        // WATCH THE REPLAY. Runtime replaces the date, because the only question left is "how long
        // is this going to take me".
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
        r.radialGlow(W, 0, 500, 'rgba(156,28,31,0.22)', 'rgba(156,28,31,0)');
        const accD = pSolid(PC.navy, PC.red, PC.paper);
        let yD = pLogo(r, a, PC.navy);
        yD += pPill(r, pad, yD, v.pill || 'On demand', accD.fill, accD.on) + pV(28);
        // A play mark: the one piece of furniture that says "this is a recording" without a word.
        { const s2 = pV(96);
          r.fillRoundRect(pad, yD, s2, s2, s2 / 2, pRgba('#ffffff', 0.10));
          r.ctx.save(); r.ctx.fillStyle = accD.text; r.ctx.beginPath();
          r.ctx.moveTo(pad + s2 * 0.40, yD + s2 * 0.29); r.ctx.lineTo(pad + s2 * 0.72, yD + s2 * 0.5);
          r.ctx.lineTo(pad + s2 * 0.40, yD + s2 * 0.71); r.ctx.closePath(); r.ctx.fill(); r.ctx.restore();
          yD += s2 + pV(26); }
        const fD = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(260), 1.05, { max: pT(80), min: 38 });
        r.drawLines(fD.lines, { family: 'Oswald', weight: '700', size: fD.size }, pad, yD, iW, { color: pInk(PC.navy), lineHeight: 1.05 });
        yD += fD.totalH + pV(22);
        if (v.speaker) {
            r.drawLines([('With ' + v.speaker).toUpperCase()], { family: 'Oswald', weight: '700', size: 36 }, pad, yD, iW, { color: PC.cbd });
            yD += pV(46);
            if (v.role) r.drawLines([String(v.role)], { family: 'Roboto', weight: '400', size: 30 }, pad, yD, iW, { color: pSubInk(PC.navy) });
        }
        // Runtime left, recorded-date right and quiet: a credential, not a deadline.
        pFootAt(r, btnY - pV(34), v.runtime || '', v.recorded ? ('Recorded ' + v.recorded) : '', false, accD.text);
        pButton(r, pad, btnY, iW, v.cta || 'Watch the replay →', accD.fill, accD.on);
        return;
    }

    if (dir === 'e') {
        // THE TAKEAWAY. A past session's best asset is the sentence somebody actually said in it.
        // This is the same reason the podcast family has a pull-quote: quotes travel, adverts do not.
        r.fillBg(PC.paper);
        const accE = pSolid(PC.paper, PC.red, PC.navy);
        r.rect(0, 0, W, 22, accE.fill);
        let yE = pLogo(r, a, PC.paper) + pV(10);
        r.drawLines([String(v.eyebrow || 'From the session').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, yE, iW, { color: accE.text });
        yE += pV(52);
        r.drawLines(['“'], { family: 'Oswald', weight: '900', size: pT(150) }, pad - 10, yE, iW, { color: accE.text, lineHeight: 1 });
        yE += pV(92);
        const qE = r.fitFontSize(String(v.quote || ''), { family: 'Oswald', weight: '700' }, iW, Math.max(pV(200), btnY - pV(210) - yE), 1.14, { max: pT(72), min: 32 });
        r.drawLines(qE.lines, { family: 'Oswald', weight: '700', size: qE.size }, pad, yE, iW, { color: pInk(PC.paper), lineHeight: 1.14 });
        yE += qE.totalH + pV(30);
        if (v.speaker) {
            r.drawLines([String(v.speaker).toUpperCase()], { family: 'Oswald', weight: '700', size: 40 }, pad, yE, iW, { color: pInk(PC.paper) });
            yE += pV(48);
            if (v.role) r.drawLines([String(v.role)], { family: 'Roboto', weight: '400', size: 30 }, pad, yE, iW, { color: PC.slate });
        }
        pFootAt(r, btnY - pV(30), v.url || '', v.runtime || '', true, accE.text);
        { const c2 = pSolid(PC.paper, PC.navy, PC.red); pButton(r, pad, btnY, iW, v.cta || 'Watch the full session →', c2.fill, c2.on); }
        return;
    }

    if (dir === 'f') {
        // MISSED IT. The honest recovery post, and the one that works on a library: the session is
        // over, nothing is lost, here is the whole thing. It leads on what was covered because that
        // is the only thing a reader who was not there can evaluate.
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        const accF = pSolid(PC.navy, PC.red, PC.paper);
        let yF = pLogo(r, a, PC.navy);
        yF += pPill(r, pad, yF, v.pill || 'Missed it?', accF.fill, accF.on) + pV(28);
        const fF = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(230), 1.05, { max: pT(74), min: 36 });
        r.drawLines(fF.lines, { family: 'Oswald', weight: '700', size: fF.size }, pad, yF, iW, { color: pInk(PC.navy), lineHeight: 1.05 });
        yF += fF.totalH + pV(18);
        { const sw = r.wrap(String(v.sub || 'The full session is up. Nothing gated, nothing expired.'), { family: 'Roboto', weight: '400', size: 34 }, iW);
          r.drawLines(sw, { family: 'Roboto', weight: '400', size: 34 }, pad, yF, iW, { color: PC.cbd, lineHeight: 1.4 });
          yF += sw.length * 34 * 1.4 + pV(30); }
        r.drawLines([String(v.coveredLabel || 'What it covered').toUpperCase()], { family: 'Oswald', weight: '700', size: 28 }, pad, yF, iW, { color: accF.text });
        yF += pV(44);
        // Three takeaways is the point of this direction, so the spacing is tightened to make room
        // for three WRAPPED labels rather than letting the fit-guard quietly drop the last one.
        pBullets(r, pad, yF, [v.i1, v.i2, v.i3], accF.fill, '#ffffff', btnY - pV(38), pV(12));
        pFootAt(r, btnY - pV(34), v.runtime || '', v.recorded ? ('Recorded ' + v.recorded) : '', false, accF.text);
        pButton(r, pad, btnY, iW, v.cta || 'Watch it now →', accF.fill, accF.on);
        return;
    }
    // A: THE SESSION CARD. Date first, because that is the decision — everything else is detail.
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
    r.radialGlow(0, 0, 540, 'rgba(156,28,31,0.24)', 'rgba(156,28,31,0)');
    const acc = pSolid(PC.navy, PC.red, PC.paper);
    let y = pLogo(r, a, PC.navy);
    { const t = String(v.format || 'Online').toUpperCase();
      const f = { family: 'JetBrains Mono', weight: '700', size: 26 };
      const tw = r.textWidth(t, f), bh = pV(50);
      r.fillRoundRect(W - pad - tw - 40, pTop() - 10, tw + 40, bh, bh / 2, pRgba('#ffffff', 0.12));
      r.drawLines([t], f, W - pad - tw - 40, pTop() - 10 + (bh - 26) / 2, tw + 40, { color: PC.cbd, align: 'center' }); }
    y += pPill(r, pad, y, v.pill || 'Free webinar', acc.fill, acc.on) + pV(30);
    // The date block: big, unmissable, and the reason the card exists.
    const df = r.fitFontSize(String(v.date || '').toUpperCase(), { family: 'Oswald', weight: '900' }, iW, pV(130), 1, { max: pT(86), min: 40 });
    r.drawLines(df.lines, { family: 'Oswald', weight: '900', size: df.size }, pad, y, iW, { color: acc.text, lineHeight: 1 });
    y += df.totalH + pV(8);
    if (v.time) { r.drawLines([String(v.time).toUpperCase()], { family: 'Oswald', weight: '700', size: 40 }, pad, y, iW, { color: PC.cbd }); y += pV(52); }
    r.strokeLine(pad, y, pad + Math.min(iW, W * 0.24), y, acc.fill, 8);
    y += pV(30);
    const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(260), 1.05, { max: pT(78), min: 38 });
    r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.05 });
    y += hf.totalH + pV(22);
    if (v.speaker) {
        r.drawLines([('With ' + v.speaker).toUpperCase()], { family: 'Oswald', weight: '700', size: 36 }, pad, y, iW, { color: PC.cbd });
        y += pV(46);
        if (v.role) r.drawLines([String(v.role)], { family: 'Roboto', weight: '400', size: 30 }, pad, y, iW, { color: pSubInk(PC.navy) });
    }
    pFootAt(r, btnY - pV(34), v.url || '', v.seats || '', false, acc.text);
    pButton(r, pad, btnY, iW, v.cta || 'Register free →', acc.fill, acc.on);
}

// ===================== B2B MARKETPLACE FAMILIES =====================
// A marketplace has two audiences and they need opposite arguments, so they get their own
// families rather than being bent out of the publisher designs:
//   providers → supply side: "list your company", leads, no commission
//   findpros  → demand side: "get quotes", vetted experts, speed
// Deliberately brand-agnostic: every colour comes from PC (which derives from the ACTIVE Brand
// Kit), so Serv renders in Serv's colours and any future marketplace brand works unchanged.

// ---- Brand-safe fills -------------------------------------------------------------------
// PC.navy / PC.paper come from the ACTIVE Brand Kit, so "navy on paper" is NOT guaranteed to be
// dark-on-light. Serv's brand (light secondary) rendered a white CTA with near-white text and an
// invisible verification badge. pSolid() picks whichever brand colour actually reads against the
// background, and always returns a legible label colour with it.
function pSolid(bgRef, prefer, alt) {
    // 1.35 is the bar for a SOLID BLOCK, not for text: a filled shape only has to be
    // distinguishable from its background, and its label gets its own colour from pInk(). Holding
    // fills to a text-grade ratio threw away SME's own red-on-navy (1.42) — which is the brand.
    const MIN = 1.35, a = prefer, b = alt || PC.red;
    const fill = pContrast(a, bgRef) >= MIN ? a : (pContrast(b, bgRef) >= MIN ? b : pInk(bgRef));
    // .fill = block colour, .on = label on that block, .text = the same accent used as TYPE
    return { fill: fill, on: pInk(fill), text: pAccentText(bgRef, fill) };
}
// TEXT in the accent colour needs a real contrast ratio, which a solid fill does not. SME red on
// SME navy is 1.42 — fine as a block, unreadable as a headline. Lighten (or darken) the accent
// until it clears 3.0 against the background; give up and use plain ink if it never does.
function pAccentText(bgRef, accent) {
    let c = accent || PC.red;
    if (pContrast(c, bgRef) >= 3) return c;
    const dir = pIsLight(bgRef) ? -1 : 1;                 // dark bg -> lighten, light bg -> darken
    for (let i = 1; i <= 8; i++) {
        const t = pShade(c, dir * i * 0.1);
        if (pContrast(t, bgRef) >= 3) return t;
    }
    return pInk(bgRef);
}

// Supply side — recruit service providers onto the marketplace.
function drawProviders(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') { // Leads counter — the "what you get" proof
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W, 0, 560, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogo(r, a, PC.navy);
        y += pPill(r, pad, y, v.pill || 'For service providers', acc.fill, acc.on) + pV(34);
        const big = String(v.big || '150+');
        const bigF = { family: 'Oswald', weight: '900', size: pT(190) };
        r.drawLines([big], bigF, pad, y, iW, { color: pInk(PC.navy) }); y += pT(190) + pV(15);
        r.drawLines([String(v.bigLabel || 'categories of buyers looking right now').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 34 }, pad, y, iW, { color: acc.text }); y += pV(70);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(200), 1.05, { max: pT(74), min: 40 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.05 });
        pButton(r, pad, btnY, iW, v.cta || 'List your company →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') { // Zero commission — the money argument, light and confident
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy), cta = pSolid(PC.paper, PC.navy, PC.red);
        r.rect(0, 0, W, 22, acc.fill);
        let y = pLogo(r, a, PC.paper) + pV(10);
        r.drawLines([String(v.eyebrow || 'Zero commission').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(62);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(300), 1.03, { max: pT(104), min: 48 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.03 });
        y += fit.totalH + pV(28);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: pSubInk(PC.paper), lineHeight: 1.42 });
        y += sub.length * 40 * 1.42 + pV(40);
        pBullets(r, pad, y, [v.i1, v.i2, v.i3], acc.fill, pInk(PC.paper), btnY - pV(40), pV(82) - (PG ? PG.bul : 58));
        pButton(r, pad, btnY, iW, v.cta || 'Claim your listing →', cta.fill, cta.on);
        return;
    }

    // A: The pitch — headline + three reasons to join, dark and direct
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
    r.radialGlow(0, H, 520, 'rgba(156,28,31,0.30)', 'rgba(156,28,31,0)');
    const accA = pSolid(PC.navy, PC.red, PC.paper);
    let y = pLogo(r, a, PC.navy);
    // The URL rides on the logo line, top-right. At the bottom it collided with the third bullet,
    // which grows down towards the pinned CTA and leaves no reliable footer band.
    r.drawLines([String(v.url || '')], { family: 'Oswald', weight: '700', size: 28 }, pad, pad + 12, iW, { color: pSubInk(PC.navy), align: 'right' });
    y += pPill(r, pad, y, v.pill || 'Grow your business', accA.fill, accA.on) + pV(34);
    const fitA = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(300), 1.04, { max: pT(96), min: 46 });
    r.drawLines(fitA.lines, { family: 'Oswald', weight: '700', size: fitA.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.04 });
    y += fitA.totalH + pV(26);
    const subA = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
    r.drawLines(subA, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: pSubInk(PC.navy), lineHeight: 1.42 });
    y += subA.length * 40 * 1.42 + pV(38);
    pBullets(r, pad, y, [v.i1, v.i2, v.i3], accA.fill, pInk(PC.navy), btnY - pV(40), pV(82) - (PG ? PG.bul : 58));
    pButton(r, pad, btnY, iW, v.cta || 'List your company →', accA.fill, accA.on);
}

// Demand side — get businesses requesting quotes from vetted providers.
function drawFindPros(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') { // Verified badge — trust is the differentiator
        r.fillBg(PC.paper);
        // The badge and the CTA must both survive a light brand secondary — derive, never assume.
        const badge = pSolid(PC.paper, PC.navy, PC.red), acc = pSolid(PC.paper, PC.red, PC.navy);
        const top = pLogoC(r, a, PC.paper) + pV(12);
        // MEASURE the whole stack, then centre it between the logo and the CTA. Flowing straight
        // down from the logo is what left a slab of dead canvas above the button in portrait.
        const bs = pV(190);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(240), 1.04, { max: pT(84), min: 44 });
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
        const stackH = bs + pV(34) + pV(60) + fit.totalH + pV(26) + sub.length * 38 * 1.4;
        let y = top + Math.max(0, (btnY - pV(48) - top - stackH) / 2);
        const bx = (W - bs) / 2;
        r.fillRoundRect(bx, y, bs, bs, bs / 2, badge.fill);
        r.drawLines(['✓'], { family: 'Oswald', weight: '900', size: Math.round(bs * 0.63) }, bx, y + bs * 0.16, bs, { color: badge.on, align: 'center' });
        y += bs + pV(34);
        r.drawLines([String(v.eyebrow || 'Manually verified').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, 0, y, W, { color: acc.text, align: 'center' }); y += pV(60);
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: pInk(PC.paper), align: 'center', lineHeight: 1.04 });
        y += fit.totalH + pV(26);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: pSubInk(PC.paper), align: 'center', lineHeight: 1.4 });
        pButton(r, pad, btnY, iW, v.cta || 'Get instant quotes →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') { // Category spotlight — concrete: this service, this many experts
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        const strip = pSolid(PC.navy, PC.red, PC.paper);
        // The CTA sat on a hardcoded white fill with a PC.navy label — on a light brand secondary
        // that was white-on-white. Both fill and label are now derived.
        const cta = pSolid(PC.navy, PC.paper, PC.red);
        const top = pLogo(r, a, PC.navy);
        const footY = btnY - pV(52);
        // Measure first, then centre the stack in the space between the logo and the footer/CTA.
        const fitC = r.fitFontSize(String(v.category || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(260), 1.02, { max: pT(118), min: 52 });
        const subC = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
        const stripH = pV(132);
        const stackH = pV(60) + fitC.totalH + pV(30) + stripH + pV(34) + subC.length * 38 * 1.4;
        let y = top + Math.max(0, (footY - pV(26) - top - stackH) / 2);
        r.drawLines([String(v.eyebrow || 'Looking for').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: pSubInk(PC.navy) }); y += pV(60);
        r.drawLines(fitC.lines, { family: 'Oswald', weight: '700', size: fitC.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.02 });
        y += fitC.totalH + pV(30);
        // expert-count strip
        r.fillRoundRect(pad, y, iW, stripH, 26, strip.fill);
        r.drawLines([String(v.count || '40+ vetted experts').toUpperCase()],
            { family: 'Oswald', weight: '700', size: pT(46) }, pad, y + (stripH - pT(46)) / 2, iW, { color: strip.on, align: 'center' });
        y += stripH + pV(34);
        r.drawLines(subC, { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: pSubInk(PC.navy), lineHeight: 1.4 });
        pButton(r, pad, btnY, iW, v.cta || 'Compare quotes →', cta.fill, cta.on);
        pFootAt(r, footY, v.url || '', '', false);   // above the CTA, not printed across it
        return;
    }

    // A: Ask once, compare many — the core marketplace promise
    r.fillBg(PC.paper);
    const accA = pSolid(PC.paper, PC.red, PC.navy), bulA = pSolid(PC.paper, PC.navy, PC.red);
    r.rect(0, 0, 26, H, accA.fill);
    let y = pLogo(r, a, PC.paper) + pV(8);
    r.drawLines([String(v.eyebrow || 'One request. Many quotes.').toUpperCase()],
        { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: accA.text }); y += pV(62);
    const fitA = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(300), 1.03, { max: pT(100), min: 46 });
    r.drawLines(fitA.lines, { family: 'Oswald', weight: '700', size: fitA.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.03 });
    y += fitA.totalH + pV(26);
    const subA = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
    r.drawLines(subA, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: pSubInk(PC.paper), lineHeight: 1.42 });
    y += subA.length * 40 * 1.42 + pV(36);
    [v.i1, v.i2, v.i3].forEach(t => { if (t) { pBullet(r, pad, y, t, bulA.fill, pInk(PC.paper)); y += pV(82); } });
    pButton(r, pad, btnY, iW, v.cta || 'Get instant quotes →', accA.fill, accA.on);
}

// ---- Listening-platform marks ------------------------------------------------------------
// Drawn as VECTOR PATHS, not fetched images: the export canvas must stay untainted (webSecurity
// is deliberately off in the desktop shell, and a cross-origin logo would break toBlob), and this
// also means the marks are crisp at any export scale and work offline.
// Each drawer fills a `s`-sized square at (x,y) and returns the width it consumed.
function pmSpotify(r, x, y, s) {
    const c = r.ctx, cx = x + s / 2, cy = y + s / 2;
    c.save();
    c.fillStyle = '#1DB954'; c.beginPath(); c.arc(cx, cy, s / 2, 0, Math.PI * 2); c.fill();
    // Three concentric sound waves, widest at the top. The radii must be spaced further apart than
    // the stroke widths or the three arcs merge into one blob — which is exactly what happened.
    c.strokeStyle = '#ffffff'; c.lineCap = 'round';
    const oy = cy + s * 0.26;
    [[0.40, 0.074, 0.80, 0.20], [0.29, 0.062, 0.76, 0.24], [0.19, 0.050, 0.72, 0.28]].forEach(function (w) {
        c.lineWidth = s * w[1];
        c.beginPath();
        c.arc(cx, oy, s * w[0], -Math.PI * w[2], -Math.PI * w[3]);
        c.stroke();
    });
    c.restore();
    return s;
}
function pmYouTube(r, x, y, s) {
    const c = r.ctx, w = s * 1.42, h = s * 0.99, ry = y + (s - h) / 2;
    c.save();
    c.fillStyle = '#FF0000'; r.roundRectPath(x, ry, w, h, h * 0.28); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath();
    c.moveTo(x + w * 0.40, ry + h * 0.26);
    c.lineTo(x + w * 0.40, ry + h * 0.74);
    c.lineTo(x + w * 0.67, ry + h * 0.50);
    c.closePath(); c.fill();
    c.restore();
    return w;
}
function pmApple(r, x, y, s) {
    const c = r.ctx, cx = x + s / 2, cy = y + s / 2;
    c.save();
    // purple disc + a simple microphone glyph (capsule head, stand, base)
    c.fillStyle = '#9933CC'; c.beginPath(); c.arc(cx, cy, s / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    r.roundRectPath(cx - s * 0.10, cy - s * 0.30, s * 0.20, s * 0.34, s * 0.10); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = s * 0.062; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy - s * 0.06, s * 0.19, 0, Math.PI); c.stroke();
    c.beginPath(); c.moveTo(cx, cy + s * 0.13); c.lineTo(cx, cy + s * 0.26); c.stroke();
    c.beginPath(); c.moveTo(cx - s * 0.13, cy + s * 0.29); c.lineTo(cx + s * 0.13, cy + s * 0.29); c.stroke();
    c.restore();
    return s;
}
// Renders the marks the user actually listed (matching on name) with an "ON" label, left-aligned
// at (x,y). Returns the total width drawn. Unknown names are skipped rather than guessed at.
const PLATFORM_MARKS = [
    { re: /spot/i,                 draw: pmSpotify },
    { re: /apple|itunes|podcasts?$/i, draw: pmApple },
    { re: /you\s*-?\s*tube|yt/i,   draw: pmYouTube }
];
function pPlatforms(r, x, y, s, list, labelColor) {
    const names = String(list == null ? 'Spotify · Apple Podcasts · YouTube' : list)
        .split(/[·,|/]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    const drawers = [];
    names.forEach(function (n) {
        for (let i = 0; i < PLATFORM_MARKS.length; i++) {
            if (PLATFORM_MARKS[i].re.test(n) && drawers.indexOf(PLATFORM_MARKS[i].draw) === -1) {
                drawers.push(PLATFORM_MARKS[i].draw); return;
            }
        }
    });
    if (!drawers.length) return 0;
    const lf = { family: 'Roboto', weight: '700', size: Math.round(s * 0.46) };
    const lw = r.textWidth('LISTEN ON', lf);
    r.drawLines(['LISTEN ON'], lf, x, y + (s - lf.size) / 2, lw + 4, { color: labelColor });
    let cx = x + lw + s * 0.55;
    drawers.forEach(function (d) { cx += d(r, cx, y, s) + s * 0.32; });
    return cx - x;
}

// ===================== PODCAST =====================
// Built from smesouthafrica.co.za/podcast — show identity + episode + guest + where to listen.
// Guest photo is optional: when a Featured Image is loaded it's used, otherwise each direction
// falls back to a typographic composition so the design never looks broken.
function drawPodcast(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') { // Guest pull-quote — the format that actually travels on social
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy);
        r.rect(0, 0, W, 22, acc.fill);
        let y = pLogo(r, a, PC.paper) + pV(10);
        r.drawLines([String(v.eyebrow || 'On the podcast').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(56);
        r.drawLines(['“'], { family: 'Oswald', weight: '900', size: pT(150) }, pad - 10, y, iW, { color: acc.text, lineHeight: 1 });
        y += pV(96);
        // The quote owns the space between the mark and the attribution block at the bottom.
        const attrH = pV(150);
        const qBox = Math.max(pV(200), btnY - pV(40) - attrH - y);
        const qFit = r.fitFontSize(String(v.quote || ''), { family: 'Oswald', weight: '700' }, iW, qBox, 1.14, { max: pT(76), min: 34 });
        r.drawLines(qFit.lines, { family: 'Oswald', weight: '700', size: qFit.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.14 });
        // attribution — photo chip when we have one, initial disc otherwise
        const ay = btnY - pV(40) - attrH + pV(20), ds = pV(104);
        if (a.featured) { r.ctx.save(); r.roundRectPath(pad, ay, ds, ds, ds / 2); r.ctx.clip(); r.drawCover(a.featured, pad, ay, ds, ds, 0.5, 0.4, 0, 1); r.ctx.restore(); }
        else {
            const disc = pSolid(PC.paper, PC.navy, PC.red);
            r.fillRoundRect(pad, ay, ds, ds, ds / 2, disc.fill);
            r.drawLines([String(v.guest || 'G').trim().charAt(0).toUpperCase()], { family: 'Oswald', weight: '700', size: Math.round(ds * 0.44) }, pad, ay + ds * 0.26, ds, { color: disc.on, align: 'center' });
        }
        r.drawLines([String(v.guest || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 38 }, pad + ds + 30, ay + pV(12), iW - ds - 30, { color: pInk(PC.paper) });
        r.drawLines([String(v.role || '')], { family: 'Roboto', weight: '400', size: 32 }, pad + ds + 30, ay + pV(58), iW - ds - 30, { color: pSubInk(PC.paper) });
        pButton(r, pad, btnY, iW, v.cta || 'Hear the full episode →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') { // Now playing — audiogram poster, centred, with a waveform
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W / 2, 0, 620, 'rgba(156,28,31,0.30)', 'rgba(156,28,31,0)');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogoC(r, a, PC.navy) + pV(8);
        r.drawLines([String(v.eyebrow || 'Now playing').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, 0, y, W, { color: acc.text, align: 'center' }); y += pV(58);
        r.drawLines([String(v.show || 'SME Podcast').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 34 }, 0, y, W, { color: pSubInk(PC.navy), align: 'center' }); y += pV(74);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(300), 1.06, { max: pT(92), min: 42 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, 0, y, W, { color: pInk(PC.navy), align: 'center', lineHeight: 1.06 });
        y += fit.totalH + pV(30);
        if (v.guest) { r.drawLines(['WITH ' + String(v.guest).toUpperCase()], { family: 'Oswald', weight: '700', size: 36 }, 0, y, W, { color: acc.text, align: 'center' }); y += pV(70); }
        // Waveform — deterministic pseudo-random so the same episode always renders identically.
        const bars = 41, bw = Math.round(iW / (bars * 1.9)), gapW = (iW - bars * bw) / (bars - 1);
        const wh = pV(150), wy = Math.min(y + pV(30), btnY - pV(110) - wh);   // clears the platforms footer
        for (let i = 0; i < bars; i++) {
            const t = i / (bars - 1);
            const amp = 0.28 + 0.72 * Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.55) * 0.4) * (0.55 + 0.45 * Math.sin(Math.PI * t));
            const bh = Math.max(6, Math.round(wh * amp));
            r.fillRoundRect(pad + i * (bw + gapW), wy + (wh - bh) / 2, bw, bh, bw / 2, i % 3 === 0 ? acc.fill : pOn(PC.navy, 'rgba(255,255,255,0.34)', 'rgba(0,0,0,0.24)'));
        }
        pButton(r, pad, btnY, iW, v.cta || 'Listen now →', acc.fill, acc.on);
        // Platform LOGOS bottom-left, the site bottom-right — both clear of the pinned CTA.
        { const ms = pV(50); pPlatforms(r, pad, btnY - pV(26) - ms, ms, v.platforms, pSubInk(PC.navy)); }
        pFootAt(r, btnY - pV(50), '', String(v.url || ''), false, pSubInk(PC.navy));
        return;
    }

    // A: Episode card — show identity, episode number, title, guest, where to listen
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'b');
    r.radialGlow(0, H, 560, 'rgba(156,28,31,0.32)', 'rgba(156,28,31,0)');
    const acc = pSolid(PC.navy, PC.red, PC.paper);
    let y = pLogo(r, a, PC.navy);
    // Show name rides TOP-RIGHT on the logo line — a masthead, not a pill in the content column,
    // so the episode title starts higher and reads as the headline it is. (No emoji: Oswald has no
    // glyph for it and it rendered as tofu.)
    { const showT = String(v.show || 'SME Podcast').toUpperCase();
      const sf = { family: 'Oswald', weight: '700', size: 32 };
      const sw = r.textWidth(showT, sf), bh = pV(58);
      const my = pTop() - 12;
      r.fillRoundRect(W - pad - sw - 44, my, sw + 44, bh, bh / 2, acc.fill);
      r.drawLines([showT], sf, W - pad - sw - 44, my + (bh - 32) / 2, sw + 44, { color: acc.on, align: 'center' }); }
    if (v.tagline) { r.drawLines([String(v.tagline).toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: pSubInk(PC.navy) }); y += pV(52); }
    if (v.ep) { r.drawLines([String(v.ep).toUpperCase()], { family: 'Roboto', weight: '700', size: 30 }, pad, y, iW, { color: acc.text }); y += pV(50); }
    r.rect(pad, y, 120, 10, acc.fill); y += pV(34);
    // Guest photo (optional) sits to the right of the title column so the layout works either way.
    const hasPic = !!a.featured, ps = pV(300);
    const colW = hasPic ? iW - ps - 40 : iW;
    const fitA = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, colW, pV(330), 1.05, { max: pT(hasPic ? 74 : 90), min: 38 });
    r.drawLines(fitA.lines, { family: 'Oswald', weight: '700', size: fitA.size }, pad, y, colW, { color: pInk(PC.navy), lineHeight: 1.05 });
    if (hasPic) {
        r.ctx.save(); r.roundRectPath(W - pad - ps, y, ps, ps, 28); r.ctx.clip();
        r.drawCover(a.featured, W - pad - ps, y, ps, ps, 0.5, 0.4, 0, 1); r.ctx.restore();
    }
    y += Math.max(fitA.totalH, hasPic ? ps : 0) + pV(28);
    if (v.guest) {
        r.drawLines([String(v.guest).toUpperCase()], { family: 'Oswald', weight: '700', size: 42 }, pad, y, iW, { color: pInk(PC.navy) }); y += pV(50);
        if (v.role) r.drawLines([String(v.role)], { family: 'Roboto', weight: '400', size: 32 }, pad, y, iW, { color: pSubInk(PC.navy) });
    }
    // Real platform marks instead of a text list — the logos are what people scan for.
    { const ms = pV(52); pPlatforms(r, pad, btnY - pV(30) - ms, ms, v.platforms, pSubInk(PC.navy)); }
    pButton(r, pad, btnY, iW, v.cta || 'Listen now →', acc.fill, acc.on);
}

// ===================== FEATURE STORY =====================
// Replaces hero-photo + gradient + headline, which is the auto-generated OG-image look and reads as
// "this is a link" rather than "this is worth reading". What editorial publishers actually push to
// social is type-first: pull-quotes, single numbers, short numbered stacks. Photography is DEMOTED
// to a deliberate element (direction D) rather than a backdrop that type sits on top of.
// The site sits on the LOGO line, top-right. Bottom-left crowded it against the attribution and
// the CTA in every feature direction; up here it can never collide with anything that grows.
function pUrlTop(r, url, bgRef) {
    const t = String(url || ''); if (!t) return;
    const pad = pPad();
    r.drawLines([t], { family: 'Oswald', weight: '700', size: 28 }, pad, pad + 12, r.w - pad * 2, { color: pSubInk(bgRef), align: 'right' });
}

function drawFeature(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') { // THE NUMBER — one stat, no decoration. The number IS the artwork.
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy);
        r.rect(0, 0, W, 22, acc.fill);
        const top = pLogo(r, a, PC.paper) + pV(10);
        const label = r.wrap(String(v.bigLabel || '').toUpperCase(), { family: 'Oswald', weight: '700', size: pT(40) }, iW);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 36 }, iW);
        // The number is sized to the space actually left over, so it is always the loudest thing on
        // the canvas without ever pushing the claim off the bottom.
        const reserve = pV(52) + label.length * pT(40) * 1.12 + pV(30) + sub.length * 36 * 1.42;
        const numBox = Math.max(pV(200), btnY - pV(60) - top - reserve);
        const nf = r.fitFontSize(String(v.big || ''), { family: 'Oswald', weight: '900' }, iW, numBox, 0.9, { max: pT(400), min: 90 });
        let y = top + Math.max(0, (btnY - pV(52) - top - (nf.totalH + reserve)) / 2);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(52);
        r.drawLines(nf.lines, { family: 'Oswald', weight: '900', size: nf.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 0.9 });
        y += nf.totalH + pV(6);
        r.drawLines(label, { family: 'Oswald', weight: '700', size: pT(40) }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.12 });
        y += label.length * pT(40) * 1.12 + pV(30);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 36 }, pad, y, iW, { color: pSubInk(PC.paper), lineHeight: 1.42 });
        pUrlTop(r, v.url, PC.paper);
        pButton(r, pad, btnY, iW, v.cta || 'Read the breakdown', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') { // THE STACK — numbered takeaways. Reads as substance, not as a link.
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        // +pV(26): the eyebrow was crowding the logo. A, B and D each add their own gap; C had none.
        let y = pLogo(r, a, PC.navy) + pV(26);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(56);
        const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(220), 1.03, { max: pT(88), min: 42 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.03 });
        y += hf.totalH + pV(40);
        const items = [v.i1, v.i2, v.i3].filter(Boolean);
        // Rows share whatever space is left, so three long takeaways compress instead of running
        // into the CTA.
        const room = (btnY - pV(46)) - y;
        const rowH = items.length ? Math.min(pV(190), Math.floor(room / items.length)) : 0;
        const numF = { family: 'Oswald', weight: '900', size: pT(66) };
        items.forEach((t, i) => {
            const ry = y + i * rowH;
            r.drawLines([String(i + 1)], numF, pad, ry, pV(90), { color: acc.text });
            const tx = pad + pV(96), tw = iW - pV(96);
            const lines = r.wrap(String(t), { family: 'Roboto', weight: '500', size: 38 }, tw).slice(0, 3);
            r.drawLines(lines, { family: 'Roboto', weight: '500', size: 38 }, tx, ry + pV(6), tw, { color: pInk(PC.navy), lineHeight: 1.34 });
            if (i < items.length - 1) r.strokeLine(pad, ry + rowH - pV(20), W - pad, ry + rowH - pV(20), pOn(PC.navy, 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.12)'), 2);
        });
        pUrlTop(r, v.url, PC.navy);
        pButton(r, pad, btnY, iW, v.cta || 'Read the full story', acc.fill, acc.on);
        return;
    }

    if (dir === 'd') { // EDITORIAL SPLIT — type leads; the photo earns a panel instead of being a backdrop.
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy);
        const wide = W > H * 1.2;
        // Portrait/square: the photo is a band at the BOTTOM. Landscape: a column on the RIGHT.
        // Either way the type owns ~60% and never sits on top of the image.
        const picW = wide ? Math.round(W * 0.40) : W;
        const picH = wide ? H : Math.round(H * 0.34);
        const picX = wide ? W - picW : 0, picY = wide ? 0 : H - picH;
        if (a.featured) r.drawCover(a.featured, picX, picY, picW, picH, 0.5, 0.45, 0, 1);
        else r.linearGradient(picX, picY, picW, picH, [[0, PC.navy], [1, PC.navy2]], 'br');
        const colW = (wide ? W - picW - pad * 2 - pV(24) : iW);
        const bottomLimit = wide ? (H - pad - pSafeB()) : picY - pV(34);
        let y = pLogo(r, a, PC.paper) + pV(6);
        r.rect(pad, y, 96, 10, acc.fill); y += pV(30);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, colW, { color: acc.text }); y += pV(50);
        const bylineH = v.byline ? pV(44) : 0;
        const subLines = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 36 }, colW);
        const ctaH = pV(56);
        const headBox = Math.max(pV(160), bottomLimit - y - subLines.length * 36 * 1.42 - bylineH - ctaH - pV(40));
        const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, colW, headBox, 1.02, { max: pT(104), min: 40 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, colW, { color: pInk(PC.paper), lineHeight: 1.02 });
        y += hf.totalH + pV(24);
        r.drawLines(subLines, { family: 'Roboto', weight: '400', size: 36 }, pad, y, colW, { color: pSubInk(PC.paper), lineHeight: 1.42 });
        y += subLines.length * 36 * 1.42 + pV(18);
        if (v.byline) { r.drawLines([String(v.byline)], { family: 'Roboto', weight: '700', size: 28 }, pad, y, colW, { color: pSubInk(PC.paper) }); y += pV(44); }
        // A text CTA, not a button: a button on an editorial card reads like an ad.
        r.drawLines([String(v.cta || 'Read the story').toUpperCase()], { family: 'Oswald', weight: '700', size: pT(34) }, pad, Math.min(y, bottomLimit - pV(40)), colW, { color: acc.text });
        pUrlTop(r, v.url, PC.paper);
        return;
    }

    // A: THE PULL-QUOTE — the format that actually travels. One sentence, oversized, attributed.
    r.fillBg(PC.paper);
    const acc = pSolid(PC.paper, PC.red, PC.navy);
    r.rect(0, 0, 26, H, acc.fill);
    const top = pLogo(r, a, PC.paper) + pV(6);
    const attrH = pV(120);
    const quoteMarkS = pT(150);
    const qBox = Math.max(pV(220), btnY - pV(46) - attrH - (top + quoteMarkS * 0.62));
    // Set in sentence case, NOT caps: a full sentence in all-caps stops being readable, and a quote
    // is meant to read as speech.
    const qf = r.fitFontSize(String(v.quote || ''), { family: 'Oswald', weight: '700' }, iW, qBox, 1.16, { max: pT(84), min: 34 });
    let y = top;
    r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: acc.text });
    y += pV(52);
    r.drawLines(['“'], { family: 'Oswald', weight: '900', size: quoteMarkS }, pad - pV(12), y, iW, { color: acc.fill, lineHeight: 1 });
    y += quoteMarkS * 0.62;
    r.drawLines(qf.lines, { family: 'Oswald', weight: '700', size: qf.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.16 });
    // Attribution: a circular crop when there is a photo, otherwise a rule + name. Never an empty avatar.
    const ay = btnY - pV(46) - attrH + pV(26), ds = pV(96);
    if (a.featured) {
        r.ctx.save(); r.roundRectPath(pad, ay, ds, ds, ds / 2); r.ctx.clip();
        r.drawCover(a.featured, pad, ay, ds, ds, 0.5, 0.4, 0, 1); r.ctx.restore();
        r.drawLines([String(v.author || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 36 }, pad + ds + 28, ay + pV(14), iW - ds - 28, { color: pInk(PC.paper) });
        r.drawLines([String(v.authorRole || '')], { family: 'Roboto', weight: '400', size: 30 }, pad + ds + 28, ay + pV(58), iW - ds - 28, { color: pSubInk(PC.paper) });
    } else {
        r.rect(pad, ay + pV(10), pV(70), 8, acc.fill);
        r.drawLines([String(v.author || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 36 }, pad + pV(92), ay, iW - pV(92), { color: pInk(PC.paper) });
        r.drawLines([String(v.authorRole || '')], { family: 'Roboto', weight: '400', size: 30 }, pad + pV(92), ay + pV(44), iW - pV(92), { color: pSubInk(PC.paper) });
    }
    pUrlTop(r, v.url, PC.paper);
    pButton(r, pad, btnY, iW, v.cta || 'Read the full story', acc.fill, acc.on);
}

// ===================== MERCH / STORE =====================
// Built from smesouthafrica.co.za/shop — product, price, and the two things that close a sale
// online in SA: shipping reach and payment trust.
function drawMerch(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();

    if (dir === 'b') { // Price hero — bold typographic, no photo needed
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W, H, 540, 'rgba(156,28,31,0.28)', 'rgba(156,28,31,0)');
        const acc = pSolid(PC.navy, PC.red, PC.paper);
        let y = pLogo(r, a, PC.navy);
        r.drawLines([String(v.eyebrow || 'Built for founders').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(60);
        const pf = r.fitFontSize(String(v.price || 'R120'), { family: 'Oswald', weight: '900' }, iW, pV(220), 1.0, { max: pT(210), min: 90 });
        r.drawLines(pf.lines, { family: 'Oswald', weight: '900', size: pf.size }, pad, y, iW, { color: pInk(PC.navy), lineHeight: 1.0 });
        y += pf.totalH + pV(16);
        const nf = r.fitFontSize(String(v.name || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(160), 1.04, { max: pT(70), min: 34 });
        r.drawLines(nf.lines, { family: 'Oswald', weight: '700', size: nf.size }, pad, y, iW, { color: acc.text, lineHeight: 1.04 });
        y += nf.totalH + pV(34);
        [v.i1, v.i2, v.i3].forEach(t => { if (t) { pBullet(r, pad, y, t, acc.fill, pInk(PC.navy)); y += pV(82); } });
        r.drawLines([String(v.trust || 'SA-wide shipping · Secure checkout')],
            { family: 'Roboto', weight: '700', size: 28 }, pad, btnY - pV(52), iW, { color: pSubInk(PC.navy) });
        pButton(r, pad, btnY, iW, v.cta || 'Shop the collection →', acc.fill, acc.on);
        return;
    }

    if (dir === 'c') { // The collection — three products with prices, catalogue-style
        r.fillBg(PC.paper);
        const acc = pSolid(PC.paper, PC.red, PC.navy), cta = pSolid(PC.paper, PC.navy, PC.red);
        r.rect(0, 0, W, 22, acc.fill);
        let y = pLogo(r, a, PC.paper) + pV(10);
        r.drawLines([String(v.eyebrow || 'The store is open').toUpperCase()],
            { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: acc.text }); y += pV(58);
        const hf = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(200), 1.03, { max: pT(96), min: 44 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, y, iW, { color: pInk(PC.paper), lineHeight: 1.03 });
        y += hf.totalH + pV(40);
        // "Name | Price" rows — name left, price right, hairline between. Reads like a real list.
        const rowH = pV(104);
        [v.p1, v.p2, v.p3].forEach(item => {
            if (!item) return;
            const parts = String(item).split('|');
            const nm = (parts[0] || '').trim(), pr = (parts[1] || '').trim();
            r.rect(pad, y, 10, rowH - pV(28), acc.fill);
            r.drawLines([nm.toUpperCase()], { family: 'Oswald', weight: '700', size: 40 }, pad + 32, y + pV(8), iW - 32 - pV(180), { color: pInk(PC.paper) });
            if (pr) r.drawLines([pr], { family: 'Oswald', weight: '700', size: 44 }, pad, y + pV(6), iW, { color: acc.text, align: 'right' });
            r.strokeLine(pad, y + rowH - pV(18), W - pad, y + rowH - pV(18), pOn(PC.paper, 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.10)'), 2);
            y += rowH;
        });
        r.drawLines([String(v.trust || 'SA-wide shipping · Secure checkout')],
            { family: 'Roboto', weight: '700', size: 28 }, pad, btnY - pV(52), iW, { color: pSubInk(PC.paper) });
        pButton(r, pad, btnY, iW, v.cta || 'Shop the collection →', cta.fill, cta.on);
        return;
    }

    // A: Product drop — photo on top, price + name card below. The classic commerce post.
    r.fillBg(PC.paper);
    const accA = pSolid(PC.paper, PC.red, PC.navy);
    // The PHOTO yields to the COPY, not the other way round. Measure the text block first and give
    // the image whatever is left (capped at ~52% of the frame). A fixed 560px band pushed the
    // description off portrait entirely.
    const hasPic = !!a.featured;
    const priceF = { family: 'Oswald', weight: '700', size: pT(52) };
    const priceT = String(v.price || '');
    const chipW = priceT ? r.textWidth(priceT, priceF) + 52 : 0;
    const nameW = iW - (chipW ? chipW + 30 : 0);
    const nfA = r.fitFontSize(String(v.name || '').toUpperCase(), { family: 'Oswald', weight: '700' }, nameW, pV(190), 1.03, { max: pT(78), min: 36 });
    const subAll = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
    // Without a photo the name lives INSIDE the panel, so the block below it is only the sub.
    const textH = pV(44) + (hasPic ? nfA.totalH + pV(22) : 0) + Math.min(3, subAll.length) * 38 * 1.4 + pV(28);
    const imgH = Math.max(pV(300), Math.min(Math.round(H * (hasPic ? 0.52 : 0.6)), btnY - pV(52) - textH));
    if (hasPic) r.drawCover(a.featured, 0, 0, W, imgH, 0.5, 0.5, 0, 1);
    else {
        // No product shot yet: the NAME becomes the visual and is not repeated below, so the
        // panel reads as a deliberate typographic drop rather than a placeholder with a caption.
        r.linearGradient(0, 0, W, imgH, [[0, PC.navy], [1, PC.navy2]], 'br');
        const hf = r.fitFontSize(String(v.name || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, imgH - pV(180), 1.04, { max: pT(92), min: 40 });
        r.drawLines(hf.lines, { family: 'Oswald', weight: '700', size: hf.size }, pad, (imgH - hf.totalH) / 2, iW, { color: pInk(PC.navy), align: 'center', lineHeight: 1.04 });
    }
    // Brand mark over the photo, top-left — a product post with no logo is somebody else's product.
    { const lg = a.logoW; if (lg) { r.ctx.save(); r.ctx.shadowColor = 'rgba(0,0,0,0.55)'; r.ctx.shadowBlur = 18; r.drawContain(lg, pad, pad - 8, 176, 50, { }); r.ctx.restore(); } }
    // kicker pill floats over the image, bottom-left — anchors the drop without hiding the product
    pPill(r, pad, imgH - (PG ? PG.pill : 64) - pV(28), v.kicker || 'New drop', accA.fill, accA.on);
    let y = imgH + pV(44);
    if (hasPic) {
        r.drawLines(nfA.lines, { family: 'Oswald', weight: '700', size: nfA.size }, pad, y, nameW, { color: pInk(PC.paper), lineHeight: 1.03 });
        // price chip, right-aligned on the first line of the name — only when a price is given
        if (priceT) {
            const ch = pT(52) + 34;
            r.fillRoundRect(W - pad - chipW, y - pV(6), chipW, ch, 14, accA.fill);
            r.drawLines([priceT], priceF, W - pad - chipW, y - pV(6) + 17, chipW, { color: accA.on, align: 'center' });
        }
        y += nfA.totalH + pV(22);
    }
    // The trust line is pinned above the CTA, so the sub only gets the lines that actually fit —
    // otherwise a long description printed straight through it.
    const trustY = btnY - pV(52);
    const subFits = Math.max(0, Math.floor((trustY - pV(16) - y) / (38 * 1.4)));
    r.drawLines(subAll.slice(0, subFits), { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: pSubInk(PC.paper), lineHeight: 1.4 });
    r.drawLines([String(v.trust || 'SA-wide shipping · Secure checkout')],
        { family: 'Roboto', weight: '700', size: 28 }, pad, trustY, iW, { color: pSubInk(PC.paper) });
    pButton(r, pad, btnY, iW, v.cta || 'Shop the collection →', accA.fill, accA.on);
}
// Dedicated LANDSCAPE (LinkedIn 1200x628) layout — a real horizontal banner, not a squeezed square.
// Generic across all content types: logo, kicker, headline, sub, CTA laid out wide, with the design's
// colour family. Flow + fitFontSize + a bottom-anchored button guarantee no overlap.
function drawLandscape(r, type, dir, v, a) {
    const W = r.w, H = r.h, pad = 70, key = type + '.' + dir;
    r.ctx.textBaseline = 'top';
    const light = ['solutions.c', 'newsletter.b', 'resources.b', 'providers.c', 'findpros.a', 'findpros.b', 'podcast.b', 'merch.a', 'merch.c', 'feature.a', 'feature.b', 'feature.d'].indexOf(key) !== -1;
    const red = ['funding.b', 'newsletter.c'].indexOf(key) !== -1;
    // The background colour comes from the BRAND (PC.navy === brand secondary), so it is not safe
    // to assume it's dark — a brand with a light secondary produced white-on-white. Text colour is
    // therefore derived from the actual background luminance, for every brand, forever.
    let bgRef, accent = pOn(PC.red, PC.off, '#ff6b4a'), barC = PC.red, btnBg = PC.red;
    if (red) { r.linearGradient(0, 0, W, H, [[0, PC.red], [1, pShade(PC.red, -0.2)]], 'br'); r.radialGlow(0, H, 440, 'rgba(10,44,61,0.4)', 'rgba(10,44,61,0)'); bgRef = PC.red; barC = PC.navy; btnBg = PC.navy; accent = pOn(PC.red, PC.off, PC.off); }
    else if (light) { r.fillBg(PC.paper); bgRef = PC.paper; barC = PC.red; btnBg = PC.red; accent = PC.red; }
    else { r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br'); r.radialGlow(W, 0, 460, 'rgba(156,28,31,0.28)', 'rgba(156,28,31,0)'); bgRef = PC.navy; }
    const txt = pInk(bgRef), subC = pSubInk(bgRef), logo = pIsLight(bgRef) ? a.logoC : a.logoW;
    // keep the kicker legible too — an accent that vanishes into the background is no accent
    if (pContrast(accent, bgRef) < 2.2) accent = pInk(bgRef);
    if (pContrast(barC, bgRef) < 1.6) barC = pInk(bgRef);
    if (logo) r.drawContain(logo, pad, pad, 200, 50, { });
    const kicker = String(v.eyebrow || v.pill || v.show || '').toUpperCase();
    // Some designs carry their headline under another key (findpros.c = category, merch = name,
    // podcast.b = quote). Missing them here rendered a banner with NO headline at all.
    const title = String(v.head || v.quote || v.category || v.name || v.big || '').toUpperCase();
    // Secondary line: the design's own concrete proof, not just the generic sub.
    const sub = String(v.sub || v.count || v.price || v.guest || '');
    const cta = v.cta || '';
    // A product/guest shot earns a right-hand image panel — a wide banner with a photo out-performs
    // a wall of type, and the text column narrows so nothing collides.
    const hasPic = !!a.featured;
    const picW = hasPic ? Math.round(W * 0.34) : 0;
    if (hasPic) {
        r.drawCover(a.featured, W - picW, 0, picW, H, 0.5, 0.45, 0, 1);
        // Blend the photo's left edge INTO the background, painting only INSIDE the photo. Fading
        // the other way (a bg-coloured wash reaching leftwards) laid a flat colour over the page's
        // own gradient and produced a hard vertical step. The stop is the bg's own RGB at alpha 0 —
        // 'rgba(0,0,0,0)' would interpolate through black and grey the seam.
        const fadeW = 150;
        r.linearGradient(W - picW, 0, fadeW, H, [[0, pRgba(bgRef, 1)], [1, pRgba(bgRef, 0)]], 'right');
    }
    const colW = (hasPic ? W - picW - pad * 2 - 30 : Math.round(W * 0.9) - pad);
    const btnY = H - pad - pSafeB() - 92;
    let y = pad + 84;
    if (kicker) { r.drawLines([kicker], { family: 'Oswald', weight: '700', size: 30 }, pad, y, colW, { color: accent }); y += 46; }
    r.rect(pad, y, 110, 10, barC); y += 30;
    const availH = Math.max(120, btnY - y - 100);   // reserve ~100 for the sub, so nothing hits the button
    const fit = r.fitFontSize(title, { family: 'Oswald', weight: '700' }, colW, availH, 1.03, { max: 92, min: 34 });
    r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, colW, { color: txt, lineHeight: 1.03 }); y += fit.totalH + 16;
    if (sub) { const sl = r.wrap(sub, { family: 'Roboto', weight: '400', size: 32 }, colW).slice(0, 2); r.drawLines(sl, { family: 'Roboto', weight: '400', size: 32 }, pad, y, colW, { color: subC, lineHeight: 1.35 }); }
    let btnW = 0;
    if (cta) { const f = { family: 'Oswald', weight: '700', size: 32 }, t = String(cta).toUpperCase(); btnW = r.textWidth(t, f) + 76; r.fillRoundRect(pad, btnY, btnW, 80, 12, btnBg); r.drawLines([t], f, pad, btnY + 24, btnW, { color: pInk(btnBg), align: 'center' }); }
    // The brand's own site, not a hardcoded one — this was still saying smesouthafrica.co.za on
    // creatives made for another brand. It sits on the rail to the RIGHT of the CTA, shrinking to
    // fit; if even 18px won't fit it is dropped rather than printed over the button.
    const urlT = String(v.url || BRAND.url || '');
    if (urlT) {
        const railX = pad + btnW + 24, railW = (pad + (hasPic ? colW : W - pad * 2)) - railX;
        let us = 26;
        while (us > 18 && r.textWidth(urlT, { family: 'Oswald', weight: '700', size: us }) > railW) us -= 2;
        if (r.textWidth(urlT, { family: 'Oswald', weight: '700', size: us }) <= railW)
            r.drawLines([urlT], { family: 'Oswald', weight: '700', size: us }, railX, btnY + 40 - us / 2, railW, { color: subC, align: 'right' });
    }
}
// SME logo top-left (light=true → colour logo for light backgrounds; else white). Returns the y to
// start content below the logo, so every premium creative is branded like the default creative.
// `on` is the background the logo sits on: pass the actual colour (preferred — the colour logo is
// then chosen from real luminance, which matters because PC.navy comes from the Brand Kit and may
// be light) or a boolean for the legacy call style.
function pLogoPick(assets, on) {
    const light = (typeof on === 'string') ? pIsLight(on) : !!on;
    return light ? assets.logoC : assets.logoW;
}
// LOGO CLEARANCE. The mark sits at pad-8 with a 50px box, so it ends at pad+42. Returning
// pad+50+pV(20) left barely 28px of air and the first heading read as if it were touching the logo.
// The gap lives here, once, so every family gets it — the alternative is fixing one design per
// report forever. Enforced by the render tests (checkLogoClearance in smoke.html).
const LOGO_GAP = 46;
function pLogo(r, assets, on) {
    const pad = pTop(), lg = pLogoPick(assets, on);
    if (lg) r.drawContain(lg, pPad(), pad - 8, 176, 50, { });
    return pad + 50 + pV(LOGO_GAP);
}
function pLogoC(r, assets, on) {
    const W = r.w, pad = pTop(), lg = pLogoPick(assets, on);
    if (lg) r.drawContain(lg, (W - 200) / 2, pad - 8, 200, 54, { });
    return pad + 54 + pV(LOGO_GAP - 6);   // centred marks read slightly tighter, so a touch less
}
// shared premium helpers
function pChip(r, x, y, text, bg, fg) {
    const f = { family: 'Roboto', weight: '700', size: 28 }, t = String(text || '');
    const padX = 22, padY = 12, h = 28 + padY * 2, w = r.textWidth(t, f) + padX * 2;
    r.fillRoundRect(x, y, w, h, 12, bg); r.drawLines([t], f, x + padX, y + padY, w, { color: fg }); return { w, h };
}
function pBorderItem(r, x, y, w, bold, text, bar) {
    r.rect(x, y, 10, 76, bar);
    r.drawLines([String(bold || '')], { family: 'Roboto', weight: '700', size: 36 }, x + 30, y + 2, w - 30, { color: '#0a2c3d' });
    const wr = r.wrap(String(text || ''), { family: 'Roboto', weight: '400', size: 34 }, w - 30);
    r.drawLines(wr, { family: 'Roboto', weight: '400', size: 34 }, x + 30, y + 44, w - 30, { color: '#1e293b', lineHeight: 1.3 });
}
function pFoot(r, leftText, rightText, light, rightColor) { pFootAt(r, r.h - pPad() - pSafeB() - 30, leftText, rightText, light, rightColor); }
// Explicit-y variant. Designs whose CTA is pinned to the bottom (btnY) must put their footer ABOVE
// the button — pFoot's default y lands inside it, which is how "serv.co.za" ended up printed
// across the Compare Quotes button.
function pFootAt(r, y, leftText, rightText, light, rightColor) {
    const pad = pPad(), iW = r.w - pad * 2;
    r.drawLines([String(leftText || '')], { family: 'Oswald', weight: '700', size: 28 }, pad, y, iW - 200, { color: light ? PC.slate : 'rgba(255,255,255,0.7)' });
    if (rightText) r.drawLines([String(rightText)], { family: 'Oswald', weight: '700', size: 28 }, pad, y, iW, { color: rightColor || PC.red, align: 'right' });
}
function drawFunding(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();
    if (dir === 'b') {
        r.linearGradient(0, 0, W, H, [[0, PC.red], [1, '#7d1518']], 'br');
        r.radialGlow(0, H, 500, 'rgba(10,44,61,0.45)', 'rgba(10,44,61,0)');
        let y = pLogo(r, a, PC.red);   // this direction's background is the brand PRIMARY, not navy
        r.drawLines([String(v.pill || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: PC.off }); y += pV(58);
        const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(260), 1.04, { max: pT(86), min: 42 });
        r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: PC.white, lineHeight: 1.04 }); y += fit.totalH + pV(22);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: PC.off, lineHeight: 1.45 });
        const cardH = pV(200), cardY = btnY - pV(40) - cardH;
        r.fillRoundRect(pad, cardY, iW, cardH, 30, PC.paper);
        r.drawLines([String(v.cardk || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad + 40, cardY + pV(38), iW - 80, { color: PC.red });
        r.drawLines([String(v.cardh || '')], { family: 'Oswald', weight: '700', size: 50 }, pad + 40, cardY + pV(82), iW - 80, { color: pInk(PC.paper) });
        r.drawLines([String(v.cards || '')], { family: 'Roboto', weight: '400', size: 34 }, pad + 40, cardY + pV(146), iW - 80, { color: PC.slate });
        { const cta = pSolid(PC.paper, PC.navy, PC.red); pButton(r, pad, btnY, iW, v.cta, cta.fill, cta.on); } return;
    }
    if (dir === 'c') {
        // Big Number — research-driven: concrete number + trust + speed + urgent CTA (out-converts a generic estimator).
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W / 2, H, 620, 'rgba(156,28,31,0.32)', 'rgba(156,28,31,0)');
        let y = pLogoC(r, a, PC.navy) + pV(4);
        r.drawLines(['BUSINESS FUNDING'], { family: 'Oswald', weight: '700', size: 30 }, 0, y, W, { color: PC.off, align: 'center' }); y += pV(66);
        // hero number
        r.drawLines(['UP TO'], { family: 'Oswald', weight: '700', size: 34 }, 0, y, W, { color: 'rgba(255,255,255,0.55)', align: 'center' }); y += pV(44);
        const bf = r.fitFontSize(String(v.big || 'R5 Million').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(200), 1.0, { max: pT(168), min: 80 });
        r.drawLines(bf.lines, { family: 'Oswald', weight: '700', size: bf.size }, 0, y, W, { color: '#fff', align: 'center', lineHeight: 1.0 }); y += bf.totalH + pV(18);
        r.drawLines(r.wrap(String(v.head || ''), { family: 'Oswald', weight: '700', size: 44 }, iW), { family: 'Oswald', weight: '700', size: 44 }, 0, y, W, { color: '#ffffff', align: 'center', lineHeight: 1.1 });
        // speed chip (pill, centered)
        y = btnY - pV(190);
        { const t = String(v.speed || '').toUpperCase(), f = { family: 'Oswald', weight: '700', size: 26 }, w = r.textWidth(t, f) + 60; r.fillRoundRect((W - w) / 2, y, w, 58, 29, 'rgba(255,255,255,0.08)'); r.ctx.save(); r.ctx.strokeStyle = 'rgba(0,224,143,0.7)'; r.ctx.lineWidth = 2; r.roundRectPath((W - w) / 2, y, w, 58, 29); r.ctx.stroke(); r.ctx.restore(); r.drawLines([t], f, (W - w) / 2, y + 16, w, { color: '#00e08f', align: 'center' }); }
        // trust line
        r.drawLines([String(v.trust || '')], { family: 'Roboto', weight: '700', size: 28 }, 0, btnY - pV(96), W, { color: 'rgba(255,255,255,0.7)', align: 'center' });
        pButton(r, pad + 40, btnY, iW - 80, v.cta, PC.red, PC.white); return;
    }
    // A: The Product Spec (navy)
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
    r.radialGlow(W, 0, 470, 'rgba(156,28,31,0.28)', 'rgba(156,28,31,0)');
    let y = pLogo(r, a, PC.navy);
    y += pPill(r, pad, y, v.pill, PC.red, PC.white) + pV(34);
    const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(240), 1.02, { max: pT(96), min: 46 });
    r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: PC.white, lineHeight: 1.02 }); y += fit.totalH + pV(20);
    const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
    r.drawLines(sub, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: PC.cbd, lineHeight: 1.4 }); y += sub.length * 40 * 1.4 + pV(30);
    // The bullet stack grows with the copy above it, so with a long sub it used to run underneath
    // the CTA. Tighten the step to whatever actually fits between here and the button, and stop
    // rather than draw a bullet that would be buried.
    {
        const items = [v.b1, v.b2, v.b3].filter(Boolean);
        if (items.length) {
            const room = (btnY - pV(52)) - pV(16) - y;
            const step = Math.max(PG ? PG.bul + 8 : 66, Math.min(pV(84), Math.floor(room / items.length)));
            items.forEach(b => { if (y + step <= btnY - pV(52)) { pBullet(r, pad, y, b, PC.red, PC.f8); y += step; } });
        }
    }
    pButton(r, pad, btnY - pV(52), iW, v.cta, PC.red, PC.white);
    r.strokeLine(pad, H - pad - pSafeB() - 44, W - pad, H - pad - pSafeB() - 44, 'rgba(255,255,255,0.1)', 2);
    r.drawLines([String(v.url || '')], { family: 'Oswald', weight: '700', size: 28 }, pad, H - pad - pSafeB() - 30, iW, { color: 'rgba(255,255,255,0.7)' });
}
function drawSolutions(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();
    if (dir === 'b') { // The Verdict — head-to-head comparison (unique split composition)
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        let y = pLogo(r, a, PC.navy);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: '#ff6b4a' }); y += pV(54);
        r.drawLines(r.wrap(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700', size: 60 }, iW), { family: 'Oswald', weight: '700', size: 60 }, pad, y, iW, { color: PC.white, lineHeight: 1.06 }); y += pV(150);
        // split VS panel
        const panelY = y, panelH = pV(230), mid = W / 2, gap = 14;
        r.fillRoundRect(pad, panelY, mid - pad - gap, panelH, 22, 'rgba(255,255,255,0.06)');
        r.fillRoundRect(mid + gap, panelY, mid - pad - gap, panelH, 22, PC.red);
        r.drawLines([String(v.vsLeft || 'A')], { family: 'Oswald', weight: '700', size: 68 }, pad, panelY + (panelH - 68) / 2, mid - pad - gap, { color: PC.white, align: 'center' });
        r.drawLines([String(v.vsRight || 'B')], { family: 'Oswald', weight: '700', size: 68 }, mid + gap, panelY + (panelH - 68) / 2, mid - pad - gap, { color: PC.white, align: 'center' });
        r.fillRoundRect(mid - 46, panelY + panelH / 2 - 46, 92, 92, 46, '#fff');
        r.drawLines(['VS'], { family: 'Oswald', weight: '700', size: 40 }, mid - 46, panelY + panelH / 2 - 26, 92, { color: pInk('#ffffff'), align: 'center' });
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 36 }, iW);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 36 }, pad, panelY + panelH + pV(34), iW, { color: PC.cbd, lineHeight: 1.4, align: 'center' });
        pButton(r, pad + 40, btnY, iW - 80, v.cta, PC.red, PC.white); return;
    }
    if (dir === 'c') { // Rated Pick — light review card with a star rating (unique)
        r.fillBg(PC.paper);
        let y = pLogo(r, a, PC.paper);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: PC.red }); y += pV(56);
        const cardH = Math.min(pV(470), btnY - pV(40) - y); r.fillRoundRect(pad, y, iW, cardH, 30, '#ffffff');
        r.ctx.save(); r.ctx.strokeStyle = PC.line; r.ctx.lineWidth = 2; r.roundRectPath(pad, y, iW, cardH, 30); r.ctx.stroke(); r.ctx.restore();
        let cy = y + 40;
        // name + big rating badge
        r.drawLines([String(v.name || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 50 }, pad + 40, cy, iW - 260, { color: pInk('#ffffff'), lineHeight: 1.05 });
        r.fillRoundRect(W - pad - 40 - 150, cy - 4, 150, 96, 18, PC.navy);
        r.drawLines([String(v.rating || '4.8')], { family: 'Oswald', weight: '700', size: 52 }, W - pad - 40 - 150, cy + 8, 150, { color: '#fff', align: 'center' });
        r.drawLines(['★★★★★'], { family: 'Roboto', weight: '700', size: 22 }, W - pad - 40 - 150, cy + 64, 150, { color: '#FFC857', align: 'center' });
        cy += pV(108);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 34 }, iW - 80);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 34 }, pad + 40, cy, iW - 80, { color: PC.slate, lineHeight: 1.4 }); cy += sub.length * 34 * 1.4 + pV(20);
        [[v.pro1, true], [v.pro2, true], [v.con1, false]].forEach(row => { if (!row[0]) return;
            r.fillRoundRect(pad + 40, cy, 48, 48, 12, row[1] ? PC.red : PC.slate);
            r.drawLines([row[1] ? '✓' : 'x'], { family: 'Oswald', weight: '900', size: 28 }, pad + 40, cy + 10, 48, { color: '#fff', align: 'center' });
            r.drawLines([String(row[0])], { family: 'Roboto', weight: '500', size: 34 }, pad + 40 + 68, cy + 6, iW - 200, { color: row[1] ? '#1e293b' : '#64748b' }); cy += pV(64); });
        pButton(r, pad, btnY, iW, v.cta, PC.red, PC.white); return;
    }
    // A: Editorial Deep Dive (navy) — content/authority. Eyebrow given breathing room from the logo;
    // no author byline; a proper CTA button.
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, '#041219']], 'br');
    r.radialGlow(W, 0, 470, 'rgba(156,28,31,0.22)', 'rgba(156,28,31,0)');
    let y = pLogo(r, a, PC.navy) + pV(30);   // extra gap so the eyebrow isn't crowding the logo
    r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, pad, y, iW, { color: '#ff6b4a' }); y += pV(58);
    r.rect(pad, y, 120, 12, PC.red); y += pV(34);
    const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(320), 1.08, { max: pT(88), min: 44 });
    r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, pad, y, iW, { color: PC.white, lineHeight: 1.08 }); y += fit.totalH + pV(22);
    const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
    r.drawLines(sub, { family: 'Roboto', weight: '400', size: 40 }, pad, y, iW, { color: PC.cbd, lineHeight: 1.5 });
    pButton(r, pad, btnY, iW, v.cta, PC.red, PC.white);
    r.drawLines([String(v.url || '')], { family: 'Oswald', weight: '700', size: 26 }, pad, btnY - pV(52), iW, { color: 'rgba(255,255,255,0.6)' }); return;
}
function drawNewsletter(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();
    if (dir === 'b') { // This Week Inside (light)
        r.fillBg(PC.paper);
        let y = pLogo(r, a, PC.paper);
        pPill(r, pad, y, v.pill, PC.red, PC.white);
        r.drawLines([String(v.issue || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y + 16, iW, { color: PC.slate, align: 'right' }); y += pV(96);
        r.drawLines([String(v.head || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 54 }, pad, y, iW, { color: pInk(PC.paper) }); y += pV(86);
        [v.i1, v.i2, v.i3].forEach(it => { if (it) { const p = String(it).split('|'); pBorderItem(r, pad, y, iW, p[0] || '', p[1] || '', PC.red); y += pV(98); } });
        { const cta = pSolid(PC.paper, PC.navy, PC.red); pButton(r, pad, btnY, iW, v.cta, cta.fill, cta.on); } return;
    }
    if (dir === 'c') { // Social Proof (red, centered)
        r.linearGradient(0, 0, W, H, [[0, PC.red], [1, '#7d1518']], 'br');
        const top = pLogoC(r, a, PC.red) + pV(6);   // red background here, not navy
        // The capture field + fine print are BOTTOM-ANCHORED, and the proof stack above is CENTRED
        // in what's left. Flowing straight down from the logo left ~500px of dead red in portrait.
        const boxH = pV(96), metaH = pV(54);
        const boxY = H - pad - pSafeB() - metaH - boxH;
        const bf = r.fitFontSize(String(v.big || ''), { family: 'Oswald', weight: '700' }, iW, pV(190), 1.0, { max: pT(150), min: 70 });
        const stackH = pV(92) + bf.totalH + pV(22) + 46;
        let y = top + Math.max(0, (boxY - pV(40) - top - stackH) / 2);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 34 }, 0, y, W, { color: PC.off, align: 'center' }); y += pV(92);
        r.drawLines(bf.lines, { family: 'Oswald', weight: '700', size: bf.size }, 0, y, W, { color: '#fff', align: 'center', lineHeight: 1.0 }); y += bf.totalH + pV(22);
        r.drawLines([String(v.sub || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 46 }, 0, y, W, { color: PC.off, align: 'center' });
        r.fillRoundRect(pad, boxY, iW, boxH, 16, '#fff');
        r.drawLines([String(v.placeholder || '')], { family: 'Roboto', weight: '400', size: 36 }, pad + 30, boxY + (boxH - 36) / 2, iW - 240, { color: '#94a3b8' });
        { const jb = pSolid('#ffffff', PC.navy, PC.red);
          r.fillRoundRect(pad + iW - 196, boxY + 14, 182, boxH - 28, 12, jb.fill);
          r.drawLines([String(v.btn || 'Join').toUpperCase()], { family: 'Oswald', weight: '700', size: 34 }, pad + iW - 196, boxY + (boxH - 34) / 2, 182, { color: jb.on, align: 'center' }); }
        r.drawLines([String(v.meta || '')], { family: 'Roboto', weight: '400', size: 30 }, 0, boxY + boxH + pV(20), W, { color: PC.off, align: 'center' }); return;
    }
    // A: #1 Hero (navy, centered)
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
    r.radialGlow(0, 0, 470, 'rgba(156,28,31,0.25)', 'rgba(156,28,31,0)');
    let y = pLogoC(r, a, PC.navy) + pV(10);
    r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 32 }, 0, y, W, { color: PC.off, align: 'center' }); y += pV(74);
    const fit = r.fitFontSize(String(v.head || '').toUpperCase(), { family: 'Oswald', weight: '700' }, iW, pV(300), 1.05, { max: pT(104), min: 50 });
    r.drawLines(fit.lines, { family: 'Oswald', weight: '700', size: fit.size }, 0, y, W, { color: PC.white, align: 'center', lineHeight: 1.05 }); y += fit.totalH + pV(22);
    const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 40 }, iW);
    r.drawLines(sub, { family: 'Roboto', weight: '400', size: 40 }, 0, y, W, { color: PC.cbd, align: 'center', lineHeight: 1.4 });
    // CTA + meta bottom-anchored (same reason as dir c) so the hero never floats in dead space.
    const metaY = H - pad - pSafeB() - pV(34);
    pButton(r, pad + 40, metaY - pV(22) - pBtnH(), iW - 80, v.cta, PC.red, PC.white);
    r.drawLines([String(v.meta || '')], { family: 'Roboto', weight: '400', size: 30 }, 0, metaY, W, { color: '#94a3b8', align: 'center' }); return;
}
function drawResources(r, dir, v, a) {
    const W = r.w, H = r.h, pad = pPad(), iW = W - pad * 2, btnY = H - pad - pSafeB() - pBtnH();
    if (dir === 'b') { // Checklist (light)
        r.fillBg(PC.paper); r.rect(0, 0, W, 26, PC.red);
        let y = pLogo(r, a, PC.paper);
        r.drawLines([String(v.eyebrow || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 30 }, pad, y, iW, { color: PC.red }); y += pV(52);
        r.drawLines([String(v.head || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 54 }, pad, y, iW, { color: pInk(PC.paper) }); y += pV(92);
        [[v.i1, true], [v.i2, true], [v.i3, true], [v.locked, false]].forEach(it => {
            if (!it[0]) return;
            if (it[1]) { r.fillRoundRect(pad, y, 58, 58, 16, PC.red); r.drawLines(['✓'], { family: 'Oswald', weight: '900', size: 34 }, pad, y + 12, 58, { color: '#fff', align: 'center' }); }
            else { r.ctx.save(); r.ctx.strokeStyle = '#cbd5e1'; r.ctx.lineWidth = 4; r.roundRectPath(pad, y, 58, 58, 16); r.ctx.stroke(); r.ctx.restore(); }
            r.drawLines([String(it[0])], { family: 'Roboto', weight: it[1] ? '500' : '400', size: 38 }, pad + 86, y + 10, iW - 100, { color: it[1] ? '#1e293b' : '#64748b' }); y += pV(84);
        });
        { const cta = pSolid(PC.paper, PC.navy, PC.red); pButton(r, pad, btnY, iW, v.cta, cta.fill, cta.on); } return;
    }
    if (dir === 'c') { // Bold FREE (navy)
        r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
        r.radialGlow(W, H, 480, 'rgba(156,28,31,0.25)', 'rgba(156,28,31,0)');
        let y = pLogo(r, a, PC.navy);
        const bigS = pT(180);
        r.ctx.save(); r.ctx.strokeStyle = 'rgba(255,255,255,0.22)'; r.ctx.lineWidth = 5; r.setFont({ family: 'Oswald', weight: '700', size: bigS }); r.ctx.textBaseline = 'top'; r.ctx.strokeText(String(v.big || 'FREE'), pad, y); r.ctx.restore(); y += bigS;
        r.drawLines([String(v.head || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 56 }, pad, y, iW, { color: '#fff' }); y += pV(78);
        const sub = r.wrap(String(v.sub || ''), { family: 'Roboto', weight: '400', size: 38 }, iW);
        r.drawLines(sub, { family: 'Roboto', weight: '400', size: 38 }, pad, y, iW, { color: PC.cbd, lineHeight: 1.4 }); y += sub.length * 38 * 1.4 + pV(26);
        [v.i1, v.i2, v.i3].forEach(it => { if (it) { r.drawLines(['→'], { family: 'Oswald', weight: '700', size: 40 }, pad, y, 50, { color: PC.red }); r.drawLines([String(it)], { family: 'Roboto', weight: '400', size: 38 }, pad + 56, y + 2, iW - 56, { color: PC.f8 }); y += pV(58); } });
        pButton(r, pad, btnY, iW, v.cta, PC.red, PC.white); return;
    }
    // A: Guide Mockup (navy, rotated cover, centered) — cover text kept inside the card
    r.linearGradient(0, 0, W, H, [[0, PC.navy], [1, PC.navy2]], 'br');
    let y = pLogoC(r, a, PC.navy);
    { const t = String(v.pill || 'FREE DOWNLOAD').toUpperCase(), f = { family: 'Oswald', weight: '700', size: 30 }, w = r.textWidth(t, f) + 68; r.fillRoundRect((W - w) / 2, y, w, 62, 31, PC.red); r.drawLines([t], f, (W - w) / 2, y + 16, w, { color: '#fff', align: 'center' }); } y += pV(92);
    // The mockup card scales with the canvas so portrait doesn't leave a hole around it.
    const ck = PG ? PG.k : 1;
    r.ctx.save(); r.ctx.translate(W / 2, y + 165 * ck); r.ctx.rotate(-5 * Math.PI / 180);
    const cw = Math.round(360 * ck), chh = Math.round(300 * ck), ci = 34; r.ctx.shadowColor = 'rgba(0,0,0,0.55)'; r.ctx.shadowBlur = 55; r.ctx.shadowOffsetY = 26;
    r.fillRoundRect(-cw / 2, -chh / 2, cw, chh, 16, '#fff'); r.ctx.shadowColor = 'transparent';
    r.rect(-cw / 2 + ci, -chh / 2 + ci, 76, 12, PC.red);
    r.drawLines(r.wrap(String(v.coverTitle || '').toUpperCase(), { family: 'Oswald', weight: '700', size: 38 }, cw - ci * 2), { family: 'Oswald', weight: '700', size: 38 }, -cw / 2 + ci, -chh / 2 + ci + 30, cw - ci * 2, { color: pInk('#ffffff'), lineHeight: 1.1 });
    r.drawLines(r.wrap(String(v.coverSub || ''), { family: 'Roboto', weight: '400', size: 22 }, cw - ci * 2), { family: 'Roboto', weight: '400', size: 22 }, -cw / 2 + ci, chh / 2 - ci - 46, cw - ci * 2, { color: PC.slate, lineHeight: 1.3 });
    r.ctx.restore(); y += Math.round(350 * ck);
    r.drawLines([String(v.head || '').toUpperCase()], { family: 'Oswald', weight: '700', size: 54 }, 0, y, W, { color: '#fff', align: 'center' });
    pButton(r, pad, btnY, iW, v.cta, PC.red, PC.white); return;
}

self.onmessage = async (e) => {
    const msg = e.data;
    try {
        applyBrandToWorker(msg.brand);
        if (msg.type === 'render-premium') {
            await loadFonts(msg.fontBuffers);
            const logoW = await blobToBitmap(msg.logoWhiteBlob);
            const logoC = await blobToBitmap(msg.logoColorBlob);
            const featured = await blobToBitmap(msg.featuredBlob);
            const W = msg.w || 1080, H = msg.h || 1080, scale = msg.scale || 2;
            const r = new CanvasRenderer(W, H, scale);
            if (msg.trace) r.trace = [];      // render tests ask for the draw log; production never does
            if (W > H * 1.2) {
                drawLandscape(r, msg.premType, msg.dir, msg.vals, { logoW, logoC, featured });
            } else {
                // Square AND portrait both render NATIVELY at the real canvas size. Portrait used to
                // be a square render letterboxed with stretched edge rows — it read as a floating
                // card inside flat bands. drawPremium() now scales its own vertical rhythm to the
                // canvas (see pGeom), so the design is full-bleed at every dimension.
                drawPremium(r, msg.premType, msg.dir, msg.vals, { logoW, logoC, featured });
            }
            const blob = await r.toBlob('image/png', 1.0);
            if (logoW) logoW.close(); if (logoC) logoC.close(); if (featured) featured.close();
            self.postMessage({ type: 'done', blob, filename: msg.filename || 'SME_premium.png', trace: r.trace || null });
            return;
        }
        if (msg.type === 'render-single') {
            self.postMessage({ type: 'progress', percent: 5,  label: 'Loading fonts' });
            await loadFonts(msg.fontBuffers);

            self.postMessage({ type: 'progress', percent: 20, label: 'Decoding images' });
            const featured = await blobToBitmap(msg.featuredBlob);
            const logo     = await blobToBitmap(msg.logoBlob);
            const assets   = { featured, logo };

            self.postMessage({ type: 'progress', percent: 55, label: 'Rendering canvas' });
            const slideIdx = msg.slideIdx !== undefined ? msg.slideIdx : 0;
            const r = renderSlide(msg.state, slideIdx, assets, msg.scale || 3, msg.trace);

            self.postMessage({ type: 'progress', percent: 85, label: 'Encoding PNG' });
            const blob = await r.toBlob('image/png', 1.0);

            self.postMessage({ type: 'progress', percent: 100, label: 'Done' });
            self.postMessage({ type: 'done', blob, filename: msg.filename || 'SME_Graphic.png', trace: r.trace || null });

            if (featured) featured.close();
            if (logo) logo.close();
            return;
        }

        if (msg.type === 'render-carousel-zip') {
            self.postMessage({ type: 'progress', percent: 3, label: 'Loading fonts' });
            await loadFonts(msg.fontBuffers);

            self.postMessage({ type: 'progress', percent: 8, label: 'Decoding images' });
            const featured = await blobToBitmap(msg.featuredBlob);
            const logo     = await blobToBitmap(msg.logoBlob);
            const assets   = { featured, logo };

            const numSlides = 6;
            const zip = new JSZip();
            for (let i = 0; i < numSlides; i++) {
                const pct = 10 + Math.round((i / numSlides) * 78);
                self.postMessage({ type: 'progress', percent: pct, label: 'Rendering slide ' + (i + 1) + '/' + numSlides });
                const r = renderSlide(msg.state, i, assets, msg.scale || 3);
                const blob = await r.toBlob('image/png', 1.0);
                const buf  = await blob.arrayBuffer();
                zip.file('SME_Carousel_Slide_' + (i + 1) + '.png', buf);
            }

            self.postMessage({ type: 'progress', percent: 92, label: 'Compressing ZIP' });
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });

            self.postMessage({ type: 'progress', percent: 100, label: 'Done' });
            self.postMessage({ type: 'done', blob: zipBlob, filename: msg.filename || 'SME_Carousel.zip' });

            if (featured) featured.close();
            if (logo) logo.close();
            return;
        }
    } catch (err) {
        self.postMessage({
            type: 'error',
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : ''
        });
    }
};
