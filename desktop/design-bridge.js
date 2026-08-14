/* Volt — Studio → Freeform bridge. © 2026 Tshepho Joel.
 *
 * THE GAP THIS CLOSES.
 *
 * Studio produces a finished, on-brand, render-checked design — and then it is a PNG. If you want
 * to move one line two centimetres, there has never been anywhere to go. Freeform exists and is a
 * real editor (Fabric.js: drag, resize, retype, recolour), but it opens BLANK. So the honest answer
 * to "I just want to nudge this one thing" was: rebuild it from scratch, or open Canva. That is the
 * whole reason a colleague with Volt installed still reaches for Canva, and no amount of new
 * templates fixes it — the problem is that the good output is a dead end.
 *
 * HOW IT WORKS, AND WHY THIS WAY.
 *
 * A design is handed over as two things the engine can already produce:
 *
 *   1. THE PLATE — the design rendered with `textless: true`. Every gradient, glow, photo, logo,
 *      pill and button is painted exactly as it ships; only the type is withheld. It becomes a
 *      locked background image, so the art is pixel-identical to what was approved. No attempt is
 *      made to re-draw a radial glow out of primitives and hope it matches.
 *
 *   2. THE TYPE — the draw trace from that same render, which now carries family, weight, size,
 *      colour, alignment and position per line. Each becomes a real editable Fabric textbox sitting
 *      exactly where the engine put it.
 *
 * Rendering ONCE and reusing the trace from that very render is deliberate: plate and text come
 * from a single layout pass, so they cannot disagree. Two renders could drift on any input that
 * varies (a re-fit font size, a wrapped line) and the text would land off its own artwork.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE (v1): the logo, photos and the background art are part of the
 * plate. Text is what people actually want to nudge, and shipping that honestly beats shipping a
 * half-working "everything is editable" that puts the logo through a resize it was never laid out
 * for. Swap the photo in Studio and hand over again.
 *
 * No DOM and no Fabric dependency here — this returns plain descriptors, so it is testable in Node
 * and both pages build their own objects from it.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VoltDesignBridge = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var HANDOFF_KEY = 'volt_design_handoff_v1';

    // Consecutive traced lines that are plainly one paragraph — same font, same size, same colour,
    // same left edge, stacked at their own line height — are merged back into ONE textbox.
    //
    // The trace records a line at a time because that is how the engine paints. Handing that over
    // literally would turn a three-line headline into three separate objects that have to be moved
    // together by hand and can be pulled apart by accident. Merging restores the thing the user
    // thinks they are editing: a headline.
    function groupLines(texts) {
        var out = [], cur = null;
        for (var i = 0; i < texts.length; i++) {
            var t = texts[i];
            if (cur && sameRun(cur, t)) { cur.lines.push(t.text); cur.h = (t.y + t.h) - cur.y; continue; }
            cur = {
                x: t.x, y: t.y, w: t.w, h: t.h,
                lines: [t.text], size: t.size, color: t.color,
                family: t.family, weight: t.weight, align: t.align || 'left',
                lineHeight: t.lineHeight || 1.1, role: t.role || null, stroke: !!t.stroke
            };
            out.push(cur);
        }
        // A merged run's box has to span the WIDEST line, not the first one — a centred headline
        // whose second line is longer would otherwise be boxed too narrow and re-wrap on load.
        for (var k = 0; k < out.length; k++) {
            var g = out[k];
            if (g.lines.length > 1) {
                var widest = g.w;
                for (var j = 0; j < texts.length; j++) {
                    if (texts[j].y >= g.y && texts[j].y < g.y + g.h && sameStyle(g, texts[j]))
                        widest = Math.max(widest, texts[j].w);
                }
                g.w = widest;
            }
            g.text = g.lines.join('\n');
            delete g.lines;
        }
        return out;
    }
    function sameStyle(a, b) {
        return a.size === b.size && a.color === b.color && a.family === b.family && a.weight === b.weight;
    }
    function sameRun(cur, t) {
        if (!sameStyle(cur, t)) return false;
        var expected = cur.y + cur.h;                       // where the next line of this run would sit
        var step = cur.size * (cur.lineHeight || 1.1);
        var gap = t.y - expected;
        // Within one line-height of the previous line's bottom, and starting at the same edge.
        // Centred text moves its left edge per line, so compare CENTRES when it is centred.
        if (gap < -step * 0.6 || gap > step * 0.75) return false;
        if ((cur.align || 'left') === 'center') return Math.abs((cur.x + cur.w / 2) - (t.x + t.w / 2)) <= Math.max(6, cur.size * 0.6);
        return Math.abs(cur.x - t.x) <= Math.max(4, cur.size * 0.25);
    }

    // trace -> { width, height, background, objects[] }. `plate` is a data URL of the textless
    // render; when absent the caller gets the text objects alone, which is still enough to inspect.
    function toScene(trace, W, H, plate) {
        var texts = [];
        for (var i = 0; i < (trace || []).length; i++) {
            var r = trace[i];
            if (r.kind === 'text' && String(r.text || '').trim()) texts.push(r);
        }
        var groups = groupLines(texts);
        var objects = groups.map(function (g) {
            return {
                type: 'textbox',
                text: g.text,
                left: g.x, top: g.y,
                width: Math.max(24, Math.ceil(g.w) + Math.ceil(g.size * 0.25)),  // a hair of slack so it cannot re-wrap on load
                fontSize: g.size,
                fill: g.color,
                fontFamily: g.family || 'Oswald',
                fontWeight: g.weight || '400',
                textAlign: g.align || 'left',
                lineHeight: g.lineHeight || 1.1,
                role: g.role || null
            };
        });
        return { width: W, height: H, plate: plate || null, objects: objects };
    }

    // The handoff itself. localStorage rather than a query string: a plate is a multi-hundred-KB
    // data URL and would blow any URL length limit. Written immediately before the navigation and
    // cleared by the reader, so a stale design can never be picked up by a later visit.
    function stash(scene, meta) {
        var payload = { at: Date.now(), meta: meta || {}, scene: scene };
        try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload)); return true; }
        catch (e) { return false; }   // quota — caller reports it rather than navigating to nothing
    }
    function take() {
        var raw = null;
        try { raw = localStorage.getItem(HANDOFF_KEY); } catch (e) { return null; }
        if (!raw) return null;
        try { localStorage.removeItem(HANDOFF_KEY); } catch (e) { }
        var p = null;
        try { p = JSON.parse(raw); } catch (e) { return null; }
        // A handoff is a navigation that should already have happened. Anything older than a few
        // minutes is a tab someone left open, not an intent.
        if (!p || !p.scene || (Date.now() - (p.at || 0)) > 5 * 60 * 1000) return null;
        return p;
    }

    return { toScene: toScene, groupLines: groupLines, stash: stash, take: take, HANDOFF_KEY: HANDOFF_KEY };
}));
