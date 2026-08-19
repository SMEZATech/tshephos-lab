/* Volt — Motion. © 2026 Tshepho Joel.
 *
 * Turns a finished Studio design into a short animated post.
 *
 * WHY THIS AND NOT A VIDEO GENERATOR. Text-to-video (Veo, Runway, Kling, Sora) is paid per second
 * of output, with no free tier at usable quality, and Volt's hard rule is free-tier only. But the
 * thing that actually outperforms on a feed is not synthetic footage — it is MOTION. A static card
 * and the same card with its type animating in are the same design; one of them stops the scroll.
 * That is buildable from what Volt already has, for nothing.
 *
 * IT REUSES THE HANDOFF, EXACTLY. design-bridge.js already turns a design into (a) a plate — the
 * artwork with the type withheld — and (b) the position, font, size and colour of every line. That
 * is precisely what an animator needs: a backdrop to hold still and a set of elements to move
 * independently. Nothing here re-implements a design; it moves the one the engine already drew.
 *
 * DETERMINISTIC, NOT WALL-CLOCK. Every frame is computed from its index, so the render does not
 * care how fast the machine is — the same design produces byte-identical timing on a slow laptop
 * and a fast desktop. The video editor's own real-time recorder taught this lesson the hard way.
 *
 * No DOM assumptions beyond a canvas 2D context, so the same code drives a live preview, a
 * MediaRecorder capture, and (on desktop) a frame-by-frame ffmpeg encode.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VoltMotion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // --- easing -------------------------------------------------------------------------------
    var E = {
        linear: function (t) { return t; },
        outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
        outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
        // A little overshoot. Used sparingly — on type it reads as a wobble, on a badge it reads
        // as confidence.
        outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
        inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    };
    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    // Normalise an absolute time into a sub-range, then ease it.
    function seg(t, a, b, ease) {
        if (b <= a) return t >= b ? 1 : 0;
        return (ease || E.outCubic)(clamp01((t - a) / (b - a)));
    }

    // --- styles -------------------------------------------------------------------------------
    // Each style says how ONE element enters, given its index in the stack. Keeping entrance
    // per-element (rather than animating the whole card) is what makes it read as designed motion
    // instead of a slideshow transition.
    var STYLES = {
        rise: {
            label: 'Rise',
            hint: 'Lines lift into place, one after another. The safe, always-appropriate one.',
            enter: function (p, i, ctx) { return { alpha: p, dx: 0, dy: (1 - p) * ctx.H * 0.045, scale: 1 }; },
            ease: E.outCubic, stagger: 0.10
        },
        sweep: {
            label: 'Sweep',
            hint: 'Type slides in from the left. Reads fast and editorial.',
            enter: function (p, i, ctx) { return { alpha: p, dx: (1 - p) * -ctx.W * 0.10, dy: 0, scale: 1 }; },
            ease: E.outQuint, stagger: 0.08
        },
        pop: {
            label: 'Pop',
            hint: 'Each element scales up with a little overshoot. Loud — good for offers and prices.',
            enter: function (p, i, ctx) { return { alpha: clamp01(p * 1.6), dx: 0, dy: 0, scale: 0.86 + 0.14 * p }; },
            ease: E.outBack, stagger: 0.09
        },
        settle: {
            label: 'Settle',
            hint: 'Everything fades up together, then the headline drifts. Calm, premium.',
            enter: function (p, i, ctx) { return { alpha: p, dx: 0, dy: (1 - p) * ctx.H * 0.012, scale: 1 }; },
            ease: E.inOutCubic, stagger: 0.035
        }
    };
    function styleKeys() { return Object.keys(STYLES); }

    // --- the plan -----------------------------------------------------------------------------
    // A design's elements come out of design-bridge in draw order, which is reading order: eyebrow,
    // headline, sub, bullets, CTA. Animating them in that order is why this looks authored.
    //
    // The CTA is deliberately held back a beat longer than the stagger would give it. The ask
    // should land after the point has been made, not alongside it.
    function plan(scene, opts) {
        opts = opts || {};
        var dur = Math.max(2, Math.min(15, opts.duration || 5));
        var style = STYLES[opts.style] || STYLES.rise;
        var objs = (scene.objects || []).slice();
        var n = objs.length;
        // Entrances have to finish inside the first ~55% so the design is READ, held whole, and
        // still has room to leave. A 12-element design with a fixed stagger would otherwise still
        // be arriving as the clip ends.
        var lastStart = Math.min(0.55, style.stagger * Math.max(0, n - 1));
        var perStagger = n > 1 ? lastStart / (n - 1) : 0;
        var enterLen = 0.30;
        var items = objs.map(function (o, i) {
            var isCta = (o.role === 'cta') || /^(read|shop|get|join|register|watch|download|browse|unlock|save|book)\b/i.test(String(o.text || '').trim());
            var start = i * perStagger + (isCta ? 0.10 : 0);
            return { obj: o, start: start, end: Math.min(0.92, start + enterLen), isCta: isCta };
        });
        return {
            duration: dur, fps: Math.max(12, Math.min(60, opts.fps || 30)),
            style: style, styleKey: STYLES[opts.style] ? opts.style : 'rise',
            items: items,
            // A gentle push on the plate for the whole clip. Static artwork behind moving type
            // reads as a slideshow; 3% of drift over five seconds reads as a camera.
            plateZoom: opts.plateZoom === false ? 0 : 0.03,
            outFrom: 0.93
        };
    }

    function frameCount(p) { return Math.max(1, Math.round(p.duration * p.fps)); }

    // --- drawing ------------------------------------------------------------------------------
    // Draw ONE frame at normalised time t (0..1). ctx is a 2D context sized W x H. `plate` is any
    // drawable image (the textless render); pass null and the background is simply skipped.
    function drawFrame(ctx, t, p, scene, plate) {
        var W = scene.width, H = scene.height;
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);

        // Whole-frame exit. Fading the composed card out is better than fading each element: the
        // design leaves as the one thing it was.
        var outP = p.outFrom < 1 ? seg(t, p.outFrom, 1, E.linear) : 0;
        ctx.globalAlpha = 1 - outP;

        if (plate) {
            var z = 1 + p.plateZoom * E.inOutCubic(clamp01(t));
            var dw = W * z, dh = H * z;
            ctx.drawImage(plate, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }

        for (var i = 0; i < p.items.length; i++) {
            var it = p.items[i], o = it.obj;
            var prog = seg(t, it.start, it.end, p.style.ease);
            if (prog <= 0) continue;
            var m = p.style.enter(prog, i, { W: W, H: H });
            ctx.save();
            ctx.globalAlpha = (1 - outP) * clamp01(m.alpha);
            var cx = o.left + o.width / 2, cy = o.top + (o.fontSize || 16) / 2;
            ctx.translate(cx + m.dx, cy + m.dy);
            if (m.scale !== 1) ctx.scale(m.scale, m.scale);
            ctx.translate(-cx, -cy);
            drawTextBlock(ctx, o);
            ctx.restore();
        }
        ctx.restore();
    }

    // Mirrors the engine's own text layout: baseline 'top', per-line alignment inside the element's
    // box, the same line height. Anything else and the animated version would not sit where the
    // still one does, which is the whole promise of animating a design you already approved.
    function drawTextBlock(ctx, o) {
        var size = o.fontSize || 16;
        var lh = size * (o.lineHeight || 1.1);
        var lines = String(o.text == null ? '' : o.text).split('\n');
        ctx.fillStyle = o.fill || '#ffffff';
        ctx.textBaseline = 'top';
        ctx.font = (o.fontWeight || '400') + ' ' + size + 'px "' + (o.fontFamily || 'Oswald') + '", sans-serif';
        var align = o.textAlign || 'left';
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line) continue;
            var x = o.left;
            if (align === 'center' || align === 'right') {
                var w = ctx.measureText(line).width;
                x = align === 'center' ? o.left + (o.width - w) / 2 : o.left + o.width - w;
            }
            ctx.fillText(line, x, o.top + i * lh);
        }
    }

    // Every face this scene needs, so a caller can await them before the first frame. Fabric taught
    // this lesson: text measured against a fallback keeps that measurement, and the design arrives
    // wrong even though the right font loaded a moment later.
    function fontFaces(scene) {
        var out = {};
        (scene.objects || []).forEach(function (o) {
            out[(o.fontWeight || '400') + ' ' + Math.max(12, Math.round(o.fontSize || 16)) + 'px "' + (o.fontFamily || 'Oswald') + '"'] = 1;
        });
        return Object.keys(out);
    }
    function loadFonts(scene) {
        if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
        return Promise.all(fontFaces(scene).map(function (f) {
            return document.fonts.load(f).catch(function () { return null; });
        }));
    }

    return {
        STYLES: STYLES, styleKeys: styleKeys, plan: plan, frameCount: frameCount,
        drawFrame: drawFrame, drawTextBlock: drawTextBlock,
        fontFaces: fontFaces, loadFonts: loadFonts,
        ease: E, seg: seg
    };
}));
