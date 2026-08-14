/* Volt — render guardrails. © 2026 Tshepho Joel.
 *
 * WHAT THIS IS, AND WHY IT IS ITS OWN FILE.
 *
 * The canvas engine can report every text and fill it drew (the draw trace — see studio-engine.js
 * `_tr`). These functions turn that log into judgements: is this text readable on what it sits on,
 * does it run off the canvas, is it buried under Instagram's reply bar, is there a headline at all.
 *
 * Every one of them exists because of a design that SHIPPED broken. They are not theoretical
 * quality rules — they are the accumulated scar tissue of real bugs:
 *   - an invisible CTA label (red on navy, 1.13:1) that read fine to whoever built it
 *   - a story CTA pinned at y=1820, underneath the reply bar, un-tappable
 *   - a bullet label that ran off the right edge because drawLines ALIGNS to a width, never wraps
 *   - a landscape banner with no headline because that direction stored it under `category`
 *   - a portrait design whose content stopped two-thirds down, the rest empty
 *
 * They used to live inline inside smoke.html, which meant only the test suite could see them. That
 * is exactly backwards: the person who most needs to be told "this text is now unreadable" is the
 * person MOVING it, at the moment they move it — not a CI run later. Extracting them here lets the
 * render suite AND the live Studio editor hold designs to one identical standard, from one
 * definition that cannot drift between them.
 *
 * Two entry points, same rules:
 *   assertDesign(trace, W, H) -> { error, warn }   strings; what the render suite wants
 *   reviewDesign(trace, W, H) -> [ finding, ... ]  structured + located; what a live editor wants
 *
 * No DOM, no canvas, no network — pure functions over the trace array, so it runs in a page, in a
 * worker, or in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VoltRenderChecks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function lum(hex) {
        var h = String(hex || '').replace('#', '').trim();
        if (h.length !== 6) return null;
        var n = parseInt(h, 16); if (!isFinite(n)) return null;
        var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
            var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function contrast(a, b) {
        var la = lum(a), lb = lum(b);
        if (la == null || lb == null) return null;
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function covers(box, t) {
        return box.x <= t.x + 1 && box.y <= t.y + 1 &&
               box.x + box.w >= t.x + t.w - 1 && box.y + box.h >= t.y + t.h - 1;
    }

    // The surface a given text actually sits on: walk BACKWARDS to the last fill drawn before it
    // that fully contains it. Shared by the contrast check and the live editor's "what would this
    // land on if I dropped it here" probe.
    function surfaceUnder(trace, i) {
        var t = trace[i];
        for (var j = i - 1; j >= 0; j--) {
            var f = trace[j];
            if (!covers(f, t)) continue;
            // A gradient or a photo IS the surface — it hides whatever is under it — but its colour
            // varies, so stop the walk and decide nothing rather than reading through to the page bg.
            if (f.kind === 'image' || (f.kind === 'fill' && f.gradient)) return null;
            if (f.kind === 'fill') return f.color;
        }
        return null;
    }

    // 1) TEXT MUST BE READABLE ON WHAT IT SITS ON.
    function findContrast(trace) {
        var out = [];
        for (var i = 0; i < trace.length; i++) {
            var t = trace[i];
            if (t.kind !== 'text' || t.stroke) continue;   // outlined meme text is legible by construction
            if (t.size < 30) continue;                     // body/eyebrow scale — judged, not asserted
            var bg = surfaceUnder(trace, i);
            if (!bg) continue;                             // gradient / image backdrop — not decidable
            var c = contrast(t.color, bg);
            if (c == null) continue;                       // rgba() or a named colour — skip rather than guess
            // Two bars. Real copy must clear 3.0 (the large-text standard). A single decorative glyph —
            // an outsized quote mark, a tick in a badge — only has to be VISIBLE, so it clears 1.5:
            // that still catches the badge that vanished at 1.13 without failing SME's own red-on-navy
            // watermark at 1.80, which is a deliberate brand choice and not a defect.
            var isGlyph = String(t.text || '').trim().length <= 2;
            var bar = isGlyph ? 1.5 : 3.0;
            if (c < bar) out.push({
                rule: 'contrast', severity: 'error', box: t,
                text: t.text,
                message: '"' + t.text + '" ' + t.color + ' on ' + bg + ' = ' + c.toFixed(2) + ':1 (needs ' + bar + ')',
                short: 'Hard to read here (' + c.toFixed(1) + ':1)'
            });
        }
        return out;
    }

    // 2) NOTHING MAY BE PRINTED OVER SOMETHING DRAWN LATER. Catches a footer landing inside the CTA.
    function findOcclusion(trace) {
        var out = [];
        for (var i = 0; i < trace.length; i++) {
            var t = trace[i]; if (t.kind !== 'text') continue;
            for (var j = i + 1; j < trace.length; j++) {
                var f = trace[j]; if (f.kind !== 'fill' || f.bg) continue;
                var ox = Math.max(0, Math.min(t.x + t.w, f.x + f.w) - Math.max(t.x, f.x));
                var oy = Math.max(0, Math.min(t.y + t.h, f.y + f.h) - Math.max(t.y, f.y));
                if (t.w * t.h > 0 && (ox * oy) / (t.w * t.h) > 0.55) {
                    out.push({
                        rule: 'occlusion', severity: 'warn', box: t, text: t.text,
                        message: '"' + t.text + '" buried under a later fill',
                        short: 'Covered by something drawn after it'
                    });
                    break;
                }
            }
        }
        return out;
    }

    // 3) NO SLAB OF DEAD CANVAS. The portrait letterbox bug was exactly this: content stopped
    //    two-thirds down and the rest was empty. Measured against the real content extent.
    function findDeadSpace(trace, W, H) {
        var top = Infinity, bottom = -Infinity;
        for (var i = 0; i < trace.length; i++) {
            var r = trace[i];
            if (r.bg) continue;                       // the full-canvas background isn't content
            // Images count. Leaving them out made every landscape design report "25% dead space
            // above" because the logo at the top is an image, not a fill.
            if (r.kind !== 'text' && r.kind !== 'fill' && r.kind !== 'image') continue;
            top = Math.min(top, r.y); bottom = Math.max(bottom, r.y + r.h);
        }
        if (!isFinite(top)) return [{ rule: 'empty', severity: 'warn', box: null, message: 'nothing drawn', short: 'Nothing drawn' }];
        var below = (H - bottom) / H, above = top / H;
        if (below > 0.22) return [{
            rule: 'deadspace', severity: 'warn', box: { x: 0, y: bottom, w: W, h: H - bottom },
            message: 'dead space: ' + Math.round(below * 100) + '% of the canvas below the last element',
            short: Math.round(below * 100) + '% empty at the bottom'
        }];
        if (above > 0.22) return [{
            rule: 'deadspace', severity: 'warn', box: { x: 0, y: 0, w: W, h: top },
            message: 'dead space: ' + Math.round(above * 100) + '% above the first element',
            short: Math.round(above * 100) + '% empty at the top'
        }];
        return [];
    }

    // 4) THE LOGO MUST NEVER CROWD THE COPY. Reported on funding/C: the first heading sat right
    //    under the mark. Fixing one design per report is a losing game, so the clearance is a rule
    //    the whole engine is held to. 30px on a 1080 canvas is the minimum that reads as deliberate.
    function findLogoClearance(trace, W) {
        var MIN = Math.max(24, Math.round(W * 0.028));
        var logos = trace.filter(function (r) { return r.kind === 'image' && r.y < W * 0.18 && r.h <= W * 0.09; });
        if (!logos.length) return [];
        var out = [];
        for (var k = 0; k < logos.length; k++) {
            var lg = logos[k], lgBottom = lg.y + lg.h, lgL = lg.x, lgR = lg.x + lg.w;
            for (var i = 0; i < trace.length; i++) {
                var t = trace[i];
                if (t.kind !== 'text') continue;
                if (t.y < lgBottom) continue;                       // above or beside the mark, not below
                if (t.y - lgBottom >= MIN) continue;                // enough air
                var overlapsX = (t.x < lgR + W * 0.04) && (t.x + t.w > lgL - W * 0.04);
                if (overlapsX) out.push({
                    rule: 'logoclearance', severity: 'error', box: t, text: t.text,
                    message: '"' + t.text + '" is ' + Math.round(t.y - lgBottom) + 'px under the logo (needs ' + MIN + ')',
                    short: 'Too close under the logo'
                });
            }
        }
        return out;
    }

    // 5) NOTHING MAY SIT UNDER INSTAGRAM'S CHROME. A 9:16 canvas is shared with the platform: the
    //    profile row owns the top ~190px of 1920 and the reply bar owns the bottom ~260px, opaquely.
    //    The first funding story pinned its CTA at y=1820 — a button nobody could see, let alone tap.
    //    This is an ERROR, not a warning: unlike overflow it does not depend on how long the copy is,
    //    and there is no reading of it that is acceptable. Full-bleed backgrounds and images are
    //    exempt — bleeding art THROUGH the chrome is correct; only type has to stay clear.
    function findStorySafeZone(trace, W, H) {
        if (H / W < 1.7) return [];
        var top = Math.round(H * 0.099), bot = Math.round(H * 0.135), out = [];
        for (var i = 0; i < trace.length; i++) {
            var r = trace[i];
            if (r.bg) continue;
            if (r.kind !== 'text') continue;                 // fills may bleed; type may not
            if (r.y < top) out.push({
                rule: 'safezone', severity: 'error', box: r, text: r.text,
                message: '"' + String(r.text || '').slice(0, 30) + '" sits ' + Math.round(top - r.y) + 'px into the top chrome',
                short: 'Hidden behind the profile row'
            });
            else if (r.y + r.h > H - bot) out.push({
                rule: 'safezone', severity: 'error', box: r, text: r.text,
                message: '"' + String(r.text || '').slice(0, 30) + '" sits ' + Math.round((r.y + r.h) - (H - bot)) + 'px into the reply bar',
                short: 'Hidden behind the reply bar'
            });
        }
        return out;
    }

    // 6) NOTHING MAY RUN OFF THE CANVAS. pBullet handed drawLines a single unwrapped string — its
    //    width argument only ALIGNS, it does not break — so a long bullet label ran off the right
    //    edge. Every family used it and nothing flagged it, because the fixture copy was short
    //    enough to fit. Text that leaves the frame is unambiguous, so this is an ERROR.
    //    A small tolerance absorbs glyph overhang (italic tails, accents) at the measured edge.
    function findOverflow(trace, W, H) {
        var out = [], tol = Math.max(4, W * 0.006);
        for (var i = 0; i < trace.length; i++) {
            var r = trace[i];
            if (r.kind !== 'text' || r.bg) continue;
            var msg = null, short = null;
            if (r.x < -tol) { msg = 'starts ' + Math.round(-r.x) + 'px off the left'; short = 'Off the left edge'; }
            else if (r.x + r.w > W + tol) { msg = 'runs ' + Math.round(r.x + r.w - W) + 'px past the right edge'; short = 'Off the right edge'; }
            else if (r.y + r.h > H + tol) { msg = 'runs ' + Math.round(r.y + r.h - H) + 'px past the bottom'; short = 'Off the bottom edge'; }
            if (msg) out.push({
                rule: 'overflow', severity: 'error', box: r, text: r.text,
                message: '"' + String(r.text || '').slice(0, 26) + '" ' + msg, short: short
            });
        }
        return out;
    }

    // 7) A DESIGN MUST HAVE A HEADLINE. findpros.c rendered a wide banner with no headline at all
    //    because that direction stores it under `category`, which drawLandscape never read.
    //
    //    THE SIZE HEURISTIC WAS NOT ENOUGH, and glossary/a and /b proved it: they shipped as an
    //    eyebrow over empty space, and this check passed them, because the CTA button's 32px label
    //    cleared the "largest text >= 28px" bar. Size cannot distinguish a headline from a button.
    //    Where the engine has TAGGED the headline (r.as('headline', ...)) that guess is replaced by
    //    a fact: the draw code knows what it is drawing. Untagged renders keep the old heuristic, so
    //    tagging can be rolled out design by design without every untagged one failing meanwhile.
    function findHeadline(trace) {
        var texts = trace.filter(function (r) { return r.kind === 'text'; });
        if (!texts.length) return [{ rule: 'headline', severity: 'error', box: null, message: 'no text was drawn at all', short: 'Nothing written' }];
        var tagged = trace.some(function (r) { return r.role; });
        if (tagged) {
            var head = texts.filter(function (r) { return r.role === 'headline' && String(r.text || '').trim(); });
            if (!head.length) return [{
                rule: 'headline', severity: 'error', box: null,
                message: 'no headline was drawn (this design has a tagged layout, and the headline slot came out empty)',
                short: 'No headline'
            }];
            return [];
        }
        var biggest = texts.reduce(function (m, r) { return Math.max(m, r.size || 0); }, 0);
        // Absolute, not relative to canvas width: a landscape banner's headline is legitimately
        // smaller than a portrait one, and keying off width made editorial/landscape a false failure.
        if (biggest < 28) return [{
            rule: 'headline', severity: 'error', box: null,
            message: 'no headline-sized text (largest is ' + biggest + 'px)', short: 'No headline'
        }];
        return [];
    }

    // Every finding, located, most severe first. This is what a live editor wants: not "the design
    // is bad" but "THIS element, HERE, for THIS reason" — so it can be pointed at on the canvas.
    function reviewDesign(trace, W, H) {
        if (!trace || !trace.length) return [];
        var all = []
            .concat(findHeadline(trace))
            .concat(findContrast(trace))
            .concat(findLogoClearance(trace, W))
            .concat(findStorySafeZone(trace, W, H))
            .concat(findOverflow(trace, W, H))
            .concat(findOcclusion(trace))
            .concat(findDeadSpace(trace, W, H));
        return all.sort(function (a, b) {
            if (a.severity === b.severity) return 0;
            return a.severity === 'error' ? -1 : 1;
        });
    }

    // ERRORS fail the build. WARNINGS are reported and counted but don't. The split is deliberate:
    // contrast and "is there a headline" are unambiguous defects, whereas dead space and occlusion
    // depend on how long the copy is — with deliberately-long test copy they flag real overflow risk
    // that isn't a bug in the shipped defaults. Promote them once the designs are tuned for
    // worst-case copy; leaving them as hard failures now would just teach everyone to ignore red.
    //
    // Order is preserved from the original inline implementation so the suite's reported reason for
    // a given failure does not change: headline, contrast, logo clearance, safe zone, overflow.
    function assertDesign(trace, W, H) {
        if (!trace || !trace.length) return { error: '', warn: '' };
        var first = function (list) { return list.length ? list[0].message : ''; };
        var contrastBad = findContrast(trace), overflowBad = findOverflow(trace, W, H),
            logoBad = findLogoClearance(trace, W), zoneBad = findStorySafeZone(trace, W, H),
            headBad = findHeadline(trace), occBad = findOcclusion(trace), deadBad = findDeadSpace(trace, W, H);
        var err = first(headBad)
            || (contrastBad.length ? 'unreadable text — ' + contrastBad.slice(0, 2).map(function (f) { return f.message; }).join('; ') : '')
            || (logoBad.length ? 'logo crowds the copy — ' + logoBad.slice(0, 2).map(function (f) { return f.message; }).join('; ') : '')
            || (zoneBad.length ? 'under Instagram chrome — ' + zoneBad.slice(0, 2).map(function (f) { return f.message; }).join('; ') : '')
            || (overflowBad.length ? 'text leaves the canvas — ' + overflowBad.slice(0, 2).map(function (f) { return f.message; }).join('; ') : '');
        var warn = (occBad.length ? occBad.slice(0, 2).map(function (f) { return f.message; }).join('; ') : '')
            || first(deadBad);
        return { error: err, warn: warn };
    }

    return {
        lum: lum, contrast: contrast, covers: covers, surfaceUnder: surfaceUnder,
        findContrast: findContrast, findOcclusion: findOcclusion, findDeadSpace: findDeadSpace,
        findLogoClearance: findLogoClearance, findStorySafeZone: findStorySafeZone,
        findOverflow: findOverflow, findHeadline: findHeadline,
        reviewDesign: reviewDesign, assertDesign: assertDesign
    };
}));
