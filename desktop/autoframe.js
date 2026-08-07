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
    wMotion: 1.00,     // a speaking head is the moving thing in the frame
    wSkin:   0.55,     // supportive, never decisive — see the limitation note above
    wDetail: 0.45,
    smooth:  0.14,     // how fast the crop may follow. Low = calm, high = whippy.
    deadzone: 0.035,   // ignore drift smaller than this, or the crop hunts on a still subject
    maxStep: 0.020,    // hard cap on movement per sample. No whip pans, ever.
    minConfidence: 0.18
  };

  // Column scores from one frame's pixels. `rgba` is Uint8ClampedArray (w*h*4), `prev` is the
  // previous frame's luma (Float32Array w*h) or null on the first frame.
  // Returns { cols: Float32Array(w), luma: Float32Array(w*h) }.
  function frameColumns(rgba, w, h, prev, opts) {
    var o = opts || DEFAULTS;
    var luma = new Float32Array(w * h);
    var motion = new Float32Array(w);
    var skin = new Float32Array(w);
    var detail = new Float32Array(w);
    var i, x, y, p, r, g, b, Y, Cb, Cr;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x; p = i * 4;
        r = rgba[p]; g = rgba[p + 1]; b = rgba[p + 2];
        Y = 0.299 * r + 0.587 * g + 0.114 * b;
        luma[i] = Y;
        if (prev) motion[x] += Math.abs(Y - prev[i]);
        Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        // Classic bounds, deliberately wide. Narrow bounds look precise and fail on real people.
        if (Cb >= 77 && Cb <= 133 && Cr >= 130 && Cr <= 178 && Y > 40 && Y < 240) skin[x] += 1;
        if (x > 0) detail[x] += Math.abs(Y - luma[i - 1]);
      }
    }
    var cols = new Float32Array(w);
    var mMax = 0, sMax = 0, dMax = 0;
    for (x = 0; x < w; x++) {
      if (motion[x] > mMax) mMax = motion[x];
      if (skin[x] > sMax) sMax = skin[x];
      if (detail[x] > dMax) dMax = detail[x];
    }
    for (x = 0; x < w; x++) {
      cols[x] = (mMax ? motion[x] / mMax : 0) * o.wMotion
              + (sMax ? skin[x] / sMax : 0) * o.wSkin
              + (dMax ? detail[x] / dMax : 0) * o.wDetail;
    }
    return { cols: cols, luma: luma };
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
    var out = [], cur = 0.5, started = false;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var target = (s.confidence >= o.minConfidence) ? s.x : 0.5;   // unsure -> centre, not a guess
      if (!started) { cur = target; started = true; }
      else {
        var d = target - cur;
        if (Math.abs(d) > o.deadzone) {
          var step = d * o.smooth;
          if (step > o.maxStep) step = o.maxStep;
          if (step < -o.maxStep) step = -o.maxStep;
          cur += step;
        }
      }
      if (cur < 0) cur = 0; if (cur > 1) cur = 1;
      out.push({ t: s.t, x: Math.round(cur * 1000) / 1000 });
    }
    return out;
  }

  // Read the path at an arbitrary time (linear between samples). This is what the renderer calls
  // per frame, so it has to be cheap and defined everywhere — including before the first sample
  // and after the last.
  function xAt(path, t) {
    if (!path || !path.length) return 0.5;
    if (t <= path[0].t) return path[0].x;
    var last = path[path.length - 1];
    if (t >= last.t) return last.x;
    for (var i = 1; i < path.length; i++) {
      if (path[i].t >= t) {
        var a = path[i - 1], b = path[i];
        var f = (b.t - a.t) ? (t - a.t) / (b.t - a.t) : 0;
        return a.x + (b.x - a.x) * f;
      }
    }
    return last.x;
  }

  // How much of the source width survives a crop to the target aspect. 16:9 -> 9:16 keeps ~32%,
  // which is why a fixed centre crop misses a speaker who is not dead centre.
  function cropFraction(srcW, srcH, outW, outH) {
    if (!srcW || !srcH || !outW || !outH) return 1;
    var srcAR = srcW / srcH, outAR = outW / outH;
    return outAR >= srcAR ? 1 : Math.max(0.05, Math.min(1, outAR / srcAR));
  }

  return {
    frameColumns: frameColumns,
    subjectX: subjectX,
    smoothPath: smoothPath,
    xAt: xAt,
    cropFraction: cropFraction,
    DEFAULTS: DEFAULTS
  };
}));
