/* Volt — AutoFrame. © 2026 Tshepho Joel.
 *
 * Keeps the speaker in shot when a landscape recording is cropped to portrait.
 *
 * THIS IS THE DIFFERENCE BETWEEN A CLIP AND A CUT.
 * Trimming a 16:9 podcast to 9:16 with a fixed centre crop puts the host's shoulder in frame while
 * they talk off the left edge. That is why an auto-cut clip looks auto-cut. What the platforms do
 * well is not finding the moment — it is following the person through it.
 *
 * WHY NOT A FACE DETECTOR
 * The Shape Detection API (window.FaceDetector) is Chrome-only, unshipped on most platforms, and
 * silently absent rather than throwing. A model (MediaPipe, TF.js) is tens of megabytes over the
 * network into a page with a strict CSP, and Volt deliberately ships no framework. So this uses
 * three cheap signals that agree on a talking head and are computed from pixels we already have:
 *
 *   MOTION   frame-to-frame luma difference per column. A person speaking moves; a backdrop does not.
 *   SKIN     YCbCr chroma likelihood. Broad bounds on purpose — see the honesty note below.
 *   DETAIL   horizontal edge energy. Faces carry more local contrast than a wall or a curtain.
 *
 * Individually each is fooled easily (a moving plant, a wooden door in skin range, a bookshelf full
 * of detail). Together, on a framed talking head, they agree. Where they DON'T agree the tracker
 * says so — every result carries a confidence, and low confidence falls back to centre rather than
 * guessing, because a centred crop is merely ordinary while a confidently wrong one is unusable.
 *
 * HONEST LIMITATION: the skin term uses a fixed YCbCr range, which is a decades-old heuristic that
 * performs less consistently on very dark and very light skin, and under strong colour casts. It is
 * ONE of three terms and the lowest-weighted; motion and detail carry the tracker for exactly this
 * reason. If a future build can afford a real face model, replace the skin term first.
 *
 * No DOM, no network: takes raw luma/chroma arrays, returns numbers. Testable in Node — see
 * af-test.cjs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoFrame = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    // MOTION IS THE SPEAKER SIGNAL and the others are supporting evidence. Measured on real
    // podcast footage, a bookshelf and a potted plant carry more DETAIL than a face does, and at
    // equal weighting the crop drifted onto the set dressing between phrases. Motion is the one
    // term only a person produces.
    wMotion: 1.55,
    wSkin:   0.55,     // supportive, never decisive — see the limitation note above
    wDetail: 0.28,
    smooth:  0.14,     // how fast the crop may follow. Low = calm, high = whippy.
    deadzone: 0.035,   // ignore drift smaller than this, or the crop hunts on a still subject
    maxStep: 0.020,    // hard cap on movement per sample. No whip pans, ever.
    minConfidence: 0.18,
    // Median confidence across the whole clip, below which there is no subject worth following
    // and the crop stays wide and centred. Real podcast footage measures ~0.72; per-frame random
    // noise ~0.24. The midpoint is deliberately nearer the noise end: holding centre on a clip
    // that had a subject costs you a nicer crop, while zooming into nothing costs you the clip.
    clipConfidence: 0.38,
    // Mean absolute luma change across the whole frame, above which this is a different SHOT
    // rather than the same subject moving. A talking head measures a few percent between samples.
    cutChange: 0.085,
    // How much taller than the DETECTED BAND the frame should be.
    //
    // The detected band is not the whole person — motion and skin peak on the FACE, so what comes
    // back is roughly head-sized. Measured on real podcast footage the band was ~15% of frame
    // height while the speaker occupied ~60%. At 1.55 the crop framed her face and cut the top of
    // her head off. A head-and-shoulders portrait is about three and a half times the face.
    subjectFill: 3.4,
    // Never zoom past this, however small the subject looks. Beyond ~2.2x on a 720p source the
    // crop is upscaling more than it is framing, and on this footage 2.6x was already inside the
    // face rather than around it.
    maxZoom: 2.2,
    // Lift the subject out of dead centre by this fraction of the frame height. A face in the
    // exact middle with empty space above it is the signature of an automatic crop.
    headroom: 0.11
  };

  // Per-COLUMN and per-ROW scores from one frame's pixels. `rgba` is Uint8ClampedArray (w*h*4),
  // `prev` is the previous frame's luma (Float32Array w*h) or null on the first frame.
  //
  // Rows matter as much as columns, and leaving them out is what made the first version produce
  // headless clips: cropping 16:9 to 9:16 by taking a FULL-HEIGHT strip keeps the entire room
  // height, so on a wide shot the subject is small, the frame is mostly floor and ceiling, and
  // the face can sit at the very top edge or outside it. A professional auto-reframe crops to the
  // subject and zooms; it does not slide a full-height window sideways.
  function frameSignals(rgba, w, h, prev, opts) {
    var o = opts || DEFAULTS;
    var luma = new Float32Array(w * h);
    var mC = new Float32Array(w), sC = new Float32Array(w), dC = new Float32Array(w);
    var mR = new Float32Array(h), sR = new Float32Array(h), dR = new Float32Array(h);
    var i, x, y, p, r, g, b, Y, Cb, Cr, mv, dv;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x; p = i * 4;
        r = rgba[p]; g = rgba[p + 1]; b = rgba[p + 2];
        Y = 0.299 * r + 0.587 * g + 0.114 * b;
        luma[i] = Y;
        if (prev) { mv = Math.abs(Y - prev[i]); mC[x] += mv; mR[y] += mv; }
        Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        // Classic bounds, deliberately wide. Narrow bounds look precise and fail on real people.
        if (Cb >= 77 && Cb <= 133 && Cr >= 130 && Cr <= 178 && Y > 40 && Y < 240) { sC[x] += 1; sR[y] += 1; }
        if (x > 0) { dv = Math.abs(Y - luma[i - 1]); dC[x] += dv; dR[y] += dv; }
      }
    }
    var mix = function (m, sk, d, n) {
      var out = new Float32Array(n), mm = 0, sm = 0, dm = 0, k;
      for (k = 0; k < n; k++) { if (m[k] > mm) mm = m[k]; if (sk[k] > sm) sm = sk[k]; if (d[k] > dm) dm = d[k]; }
      for (k = 0; k < n; k++) {
        out[k] = (mm ? m[k] / mm : 0) * o.wMotion + (sm ? sk[k] / sm : 0) * o.wSkin + (dm ? d[k] / dm : 0) * o.wDetail;
      }
      return out;
    };
    // How much the WHOLE frame changed. A talking head moves a few percent between samples; a cut
    // to another camera changes almost everything. This is what tells the tracker it is looking at
    // a different shot rather than a subject who teleported.
    var change = 0;
    if (prev) { var tot = 0; for (i = 0; i < luma.length; i++) tot += Math.abs(luma[i] - prev[i]); change = tot / (luma.length * 255); }
    return { cols: mix(mC, sC, dC, w), rows: mix(mR, sR, dR, h), luma: luma, change: change };
  }
  // Back-compat: the original name returned columns only.
  function frameColumns(rgba, w, h, prev, opts) {
    var r = frameSignals(rgba, w, h, prev, opts);
    return { cols: r.cols, luma: r.luma };
  }

  // Where is the subject in this frame? Returns { x: 0..1, confidence: 0..1 }.
  //
  // A plain argmax picks a single noisy column, so the score is first blurred, then the centre of
  // mass is taken over the columns near the peak — the middle of the person, not the brightest
  // pixel on their collar. Confidence is how much the peak region stands out from the rest: a
  // uniform frame (nothing moving, no subject) scores near zero and the caller holds centre.
  function subjectX(cols, cropFrac) {
    var w = cols.length;
    if (!w) return { x: 0.5, confidence: 0 };
    var k = Math.max(1, Math.round(w * 0.06));          // blur radius ~6% of width
    var sm = new Float32Array(w), i, j, s, n;
    for (i = 0; i < w; i++) {
      s = 0; n = 0;
      for (j = Math.max(0, i - k); j <= Math.min(w - 1, i + k); j++) { s += cols[j]; n++; }
      sm[i] = s / n;
    }
    var peak = 0, peakI = 0, mean = 0;
    for (i = 0; i < w; i++) { mean += sm[i]; if (sm[i] > peak) { peak = sm[i]; peakI = i; } }
    mean /= w;
    if (peak <= 0) return { x: 0.5, confidence: 0 };

    // Centre of mass over the band that would actually be in shot, weighted by how far each column
    // is above the mean — background columns contribute nothing rather than dragging the centre.
    var half = Math.max(2, Math.round(w * (cropFrac || 0.5) * 0.5));
    var lo = Math.max(0, peakI - half), hi = Math.min(w - 1, peakI + half);
    var num = 0, den = 0, v;
    for (i = lo; i <= hi; i++) { v = Math.max(0, sm[i] - mean); num += i * v; den += v; }
    var cx = den > 0 ? (num / den) : peakI;
    var confidence = Math.max(0, Math.min(1, (peak - mean) / (peak || 1)));
    return { x: (cx + 0.5) / w, confidence: confidence };
  }

  // Extent of the subject along one axis: where the signal rises above the background, expressed
  // as a centre and a half-width in normalised units. Used for the vertical axis, where "how tall
  // is the person" decides how far to zoom.
  function extent(sig) {
    var n = sig.length;
    if (!n) return { c: 0.5, half: 0.5, peak: 0, mean: 0 };
    var k = Math.max(1, Math.round(n * 0.06)), sm = new Float32Array(n), i, j, a, cnt;
    for (i = 0; i < n; i++) {
      a = 0; cnt = 0;
      for (j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) { a += sig[j]; cnt++; }
      sm[i] = a / cnt;
    }
    var peak = 0, mean = 0;
    for (i = 0; i < n; i++) { mean += sm[i]; if (sm[i] > peak) peak = sm[i]; }
    mean /= n;
    if (peak <= 0) return { c: 0.5, half: 0.5, peak: 0, mean: 0 };
    // Half-way between the mean and the peak is a stable threshold: it does not move when the
    // whole frame gets brighter, and it does not collapse onto one hot pixel.
    var thr = mean + (peak - mean) * 0.45;
    var lo = -1, hi = -1, num = 0, den = 0, v;
    for (i = 0; i < n; i++) {
      if (sm[i] >= thr) { if (lo < 0) lo = i; hi = i; }
      v = Math.max(0, sm[i] - mean); num += i * v; den += v;
    }
    if (lo < 0) { lo = 0; hi = n - 1; }
    var c = den > 0 ? (num / den) : ((lo + hi) / 2);

    // CONCENTRATION: how much of the signal's energy falls inside one window, against how much a
    // FLAT signal would put there. Uniform noise scores ~1 however contrasty it looks; a real
    // subject packs several times its share into one place. This is the measure that separates
    // "nothing is here" from "something wide is here", which peak-over-mean cannot do — grain has
    // a peak above its mean too, and reading that as confidence made the crop zoom into noise.
    var wf = 0.34, wn = Math.max(1, Math.round(n * wf));
    var run = 0, best = 0, tot = 0, e = [];
    for (i = 0; i < n; i++) { e.push(Math.max(0, sm[i] - mean)); tot += e[i]; }
    for (i = 0; i < n; i++) {
      run += e[i];
      if (i >= wn) run -= e[i - wn];
      if (run > best) best = run;
    }
    var conc = tot > 0 ? (best / tot) : 0;
    return { c: (c + 0.5) / n, half: Math.max(0.04, ((hi - lo) / 2 + 0.5) / n),
             peak: peak, mean: mean, conc: conc, uniform: wf };
  }

  /**
   * The crop BOX for this frame: where to put a window of the output aspect ratio over the source.
   * Returns { x, y, zoom, confidence } with x/y the box CENTRE in 0..1 of the source, and zoom the
   * factor by which the box is smaller than the largest window that fits (1 = widest, >1 = tighter).
   *
   * The vertical rule is what makes it look shot rather than cropped: a head belongs about a third
   * of the way down, not in the middle. Framing the detected subject dead-centre gives you the
   * classic amateur result — a face in the middle with dead space above and a chin on the bottom
   * edge — so the box is biased upward by a fraction of its own height.
   */
  function subjectBox(sig, srcW, srcH, outW, outH, opts) {
    var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in (opts || {})) if (opts[k2] != null) o[k2] = opts[k2];
    var ex = extent(sig.cols), ey = extent(sig.rows);
    var srcAR = srcW / srcH, outAR = outW / outH;
    // The widest window of the output aspect that still fits inside the source, in source units.
    var maxH = outAR >= srcAR ? (srcW / outAR) : srcH;
    var maxW = maxH * outAR;

    // How tall does the subject need the window to be? Their detected height plus headroom and a
    // little body, clamped so we never zoom past the point where the source has the pixels.
    var subjH = Math.max(0.10, ey.half * 2) * srcH;
    var wantH = subjH * o.subjectFill;
    var h = Math.max(maxH / o.maxZoom, Math.min(maxH, wantH));
    var w = h * outAR;
    var zoom = maxH / h;

    var cx = ex.c * srcW, cy = ey.c * srcH;
    cy -= h * o.headroom;                    // lift the subject out of dead centre
    // Keep the window inside the frame.
    cx = Math.max(w / 2, Math.min(srcW - w / 2, cx));
    cy = Math.max(h / 2, Math.min(srcH - h / 2, cy));

    // CONFIDENCE has to survive noise, and (peak - mean) / peak does not: random grain still has
    // a peak above its mean, so pure noise read as 90% confident and the crop zoomed into it.
    // A real subject is not just bright, it is CONCENTRATED — its above-threshold band covers a
    // small part of the axis. Noise crosses the threshold everywhere. So contrast is multiplied by
    // how tightly the signal is packed, and a diffuse frame collapses to near zero however
    // contrasty it looks.
    var conf = function (e) {
      if (!(e.peak > 0) || !(e.conc > 0)) return 0;
      // How many times better than a flat signal is this concentration? 1x is noise, 2x+ is a
      // subject. Scaled so 1.0 -> 0 and 2.6 -> 1.
      var rel = e.conc / e.uniform;
      return Math.max(0, Math.min(1, (rel - 1) / 1.6));
    };
    return {
      x: cx / srcW, y: cy / srcH, zoom: zoom,
      confidence: Math.max(0, Math.min(1, Math.min(conf(ex), conf(ey))))
    };
  }

  // Turn a box into the source rectangle to draw from. One place computes this so preview,
  // download and the editor cannot disagree about what the crop is.
  function cropRect(box, srcW, srcH, outW, outH) {
    var outAR = outW / outH, srcAR = srcW / srcH;
    var maxH = outAR >= srcAR ? (srcW / outAR) : srcH;
    var z = Math.max(1, Math.min(DEFAULTS.maxZoom, (box && box.zoom) || 1));
    var h = maxH / z, w = h * outAR;
    var cx = ((box && box.x) != null ? box.x : 0.5) * srcW;
    var cy = ((box && box.y) != null ? box.y : 0.5) * srcH;
    var sx = Math.max(0, Math.min(srcW - w, cx - w / 2));
    var sy = Math.max(0, Math.min(srcH - h, cy - h / 2));
    return { sx: sx, sy: sy, sw: w, sh: h };
  }

  /**
   * Smooth a sequence of per-sample observations into a crop path you can actually watch.
   * Raw per-frame positions jitter, and a crop that jitters is worse than one that never moves —
   * the viewer sees the CAMERA instead of the person.
   *
   * samples: [{ t, x, confidence }]  ->  [{ t, x }]
   */
  function smoothPath(samples, opts) {
    var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in (opts || {})) if (opts[k2] != null) o[k2] = opts[k2];
    // MEDIAN FILTER FIRST, then decide. Measured on real podcast footage the raw per-frame
    // position jitters 0.070 and the zoom flaps between 1.0x and 2.6x on alternating frames — a
    // crop driven straight from that would pump in and out once a second. A median of five kills
    // single-frame outliers while leaving a real speaker change intact (that change persists over
    // many frames, so it survives the median), and takes the same footage down to 0.022.
    //
    // The first sample also has no motion term at all — there is no previous frame to difference
    // against — so it is the least reliable one and gets dropped rather than anchoring the path.
    var src = samples.length > 4 ? samples.slice(1) : samples.slice();
    var med = function (arr, key, i, w) {
      var lo = Math.max(0, i - w), hi = Math.min(arr.length - 1, i + w), v = [];
      for (var k = lo; k <= hi; k++) v.push(arr[k][key] != null ? arr[k][key] : (key === 'zoom' ? 1 : 0.5));
      v.sort(function (a, b) { return a - b; });
      return v[Math.floor(v.length / 2)];
    };
    var W = 2;   // median of five
    var filtered = src.map(function (s, i) {
      return { t: s.t, x: med(src, 'x', i, W), y: med(src, 'y', i, W), zoom: med(src, 'zoom', i, W),
               confidence: med(src, 'confidence', i, W), change: s.change || 0 };
    });

    // A CLIP-LEVEL GATE on the MEDIAN CONFIDENCE, not on jitter.
    //
    // Jitter was the obvious choice and it does not work: median filtering pulls per-frame noise
    // down to 0.045 while real footage sits at 0.022, and those bands are too close to separate
    // safely — a threshold between them would be a coin toss on any clip that is slightly worse
    // than average. Confidence separates cleanly on the same material: real podcast footage
    // medians 0.72, per-frame noise medians 0.24. One clip-level decision, made on the measure
    // that actually discriminates, rather than a delicately tuned one that nearly does.
    var confs = filtered.map(function (s) { return s.confidence; }).sort(function (a, b) { return a - b; });
    var medConf = confs.length ? confs[Math.floor(confs.length / 2)] : 0;
    var chasingNoise = medConf < o.clipConfidence;
    samples = filtered;

    // SHOTS, not one continuous take.
    //
    // Real podcasts cut between a wide two-shot and close-ups. Treating that as one shot produced
    // a clip whose opening second framed a potted plant: the anchor was the median over the whole
    // clip, which the close-up frames dominated, and it was simply wrong for the wide shot at the
    // top. Worse, easing across a cut is meaningless — the subject did not move, the camera did.
    // So the path is segmented at cuts, each shot gets its OWN anchor, and the crop snaps at the
    // boundary instead of gliding through it.
    var cuts = [0];
    for (var ci = 1; ci < filtered.length; ci++) {
      if ((filtered[ci].change || 0) > o.cutChange) cuts.push(ci);
    }
    var segOf = new Array(filtered.length), segIdx = 0;
    for (var si = 0; si < filtered.length; si++) {
      if (segIdx + 1 < cuts.length && si >= cuts[segIdx + 1]) segIdx++;
      segOf[si] = segIdx;
    }
    var midIn = function (seg, key, dflt) {
      var v = [];
      for (var q = 0; q < filtered.length; q++) {
        if (segOf[q] !== seg) continue;
        if (filtered[q].confidence < o.minConfidence) continue;
        v.push(filtered[q][key] != null ? filtered[q][key] : dflt);
      }
      v.sort(function (a, b) { return a - b; });
      return v.length ? v[Math.floor(v.length / 2)] : dflt;
    };
    var anchors = cuts.map(function (_, seg) {
      return chasingNoise ? { x: 0.5, y: 0.5, zoom: 1 }
                          : { x: midIn(seg, 'x', 0.5), y: midIn(seg, 'y', 0.5), zoom: midIn(seg, 'zoom', 1) };
    });

    var out = [], cur = { x: 0.5, y: 0.5, zoom: 1 }, started = false, lastSeg = -1;
    // Vertical and zoom move SLOWER than horizontal. A crop that slides sideways reads as a camera
    // following someone; one that bobs up and down or breathes in and out reads as a fault.
    var rate = { x: o.smooth, y: o.smooth * 0.6, zoom: o.smooth * 0.45 };
    var cap = { x: o.maxStep, y: o.maxStep * 0.6, zoom: o.maxStep * 1.5 };
    var dead = { x: o.deadzone, y: o.deadzone * 1.4, zoom: o.deadzone * 1.2 };
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var sure = s.confidence >= o.minConfidence && !chasingNoise;
      // Unsure -> a safe, wide, centred frame rather than a confident guess.
      var target = sure ? { x: s.x, y: s.y != null ? s.y : 0.5, zoom: s.zoom != null ? s.zoom : 1 }
                        : { x: 0.5, y: 0.5, zoom: 1 };
      // OPEN WHERE THE CLIP SETTLES, do not ease into it.
      //
      // The path is computed offline, so unlike a live camera operator we already know where the
      // subject spends the clip. Starting at the first sample and creeping there at the step cap
      // meant three seconds of the wrong framing at the top of every clip — measured on real
      // footage, the opening second was a potted plant. The first frame is the one that decides
      // whether anyone watches the rest, so it starts on the answer: the median of the confident
      // samples, which for a clip with one dominant speaker IS that speaker.
      // Snap at a cut (and at the very first frame): the camera changed, so easing across it would
      // spend a second of the new shot pointing at where the old one's subject used to be.
      var seg = segOf[i];
      if (!started || seg !== lastSeg) {
        var a = anchors[seg] || { x: 0.5, y: 0.5, zoom: 1 };
        cur = { x: a.x, y: a.y, zoom: a.zoom };
        started = true; lastSeg = seg;
      }
      else {
        ['x', 'y', 'zoom'].forEach(function (a) {
          var d = target[a] - cur[a];
          if (Math.abs(d) > dead[a]) {
            var step = d * rate[a];
            if (step > cap[a]) step = cap[a];
            if (step < -cap[a]) step = -cap[a];
            cur[a] += step;
          }
        });
      }
      cur.x = Math.max(0, Math.min(1, cur.x));
      cur.y = Math.max(0, Math.min(1, cur.y));
      cur.zoom = Math.max(1, Math.min(o.maxZoom, cur.zoom));
      out.push({ t: s.t, x: Math.round(cur.x * 1000) / 1000, y: Math.round(cur.y * 1000) / 1000,
                 zoom: Math.round(cur.zoom * 1000) / 1000 });
    }
    return out;
  }

  // Read the path at an arbitrary time (linear between samples). This is what the renderer calls
  // per frame, so it has to be cheap and defined everywhere — including before the first sample
  // and after the last.
  function boxAt(path, t) {
    if (!path || !path.length) return { x: 0.5, y: 0.5, zoom: 1 };
    var pick = function (p) { return { x: p.x, y: p.y != null ? p.y : 0.5, zoom: p.zoom != null ? p.zoom : 1 }; };
    if (t <= path[0].t) return pick(path[0]);
    var last = path[path.length - 1];
    if (t >= last.t) return pick(last);
    for (var i = 1; i < path.length; i++) {
      if (path[i].t >= t) {
        var a = pick(path[i - 1]), b = pick(path[i]);
        var f = (path[i].t - path[i - 1].t) ? (t - path[i - 1].t) / (path[i].t - path[i - 1].t) : 0;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, zoom: a.zoom + (b.zoom - a.zoom) * f };
      }
    }
    return pick(last);
  }
  function xAt(path, t) { return boxAt(path, t).x; }

  // How much of the source width survives a crop to the target aspect. 16:9 -> 9:16 keeps ~32%,
  // which is why a fixed centre crop misses a speaker who is not dead centre.
  function cropFraction(srcW, srcH, outW, outH) {
    if (!srcW || !srcH || !outW || !outH) return 1;
    var srcAR = srcW / srcH, outAR = outW / outH;
    return outAR >= srcAR ? 1 : Math.max(0.05, Math.min(1, outAR / srcAR));
  }

  return {
    frameSignals: frameSignals,
    frameColumns: frameColumns,
    subjectX: subjectX,
    subjectBox: subjectBox,
    cropRect: cropRect,
    extent: extent,
    smoothPath: smoothPath,
    boxAt: boxAt,
    xAt: xAt,
    cropFraction: cropFraction,
    DEFAULTS: DEFAULTS
  };
}));
