/* Volt — FootageFix. © 2026 Tshepho Joel.
 *
 * Rescues stage footage where the speaker stands in front of a projector screen.
 *
 * WHAT GOES WRONG ON STAGE
 * The camera exposes for the whole frame. When half the frame is a white slide, three things happen
 * at once, and fixing any one of them alone makes the others look worse:
 *   1. HAZE. Screen light floods the lens, so nothing is black any more. Measured on the Summit
 *      Shorts: the darkest 1% of pixels sat at blue 0.68. The whole picture looks washed out.
 *   2. CAST. The projector light falls on the speaker too, so skin and clothes go cyan.
 *   3. EXPOSURE. The screen is near-white and the speaker is dark against it.
 *
 * WHAT THIS DOES (in that order, per pixel, on the GPU)
 *   Clear haze      per-channel black point, measured from the frame itself.
 *   Remove cast     partial grey-world white balance, measured on the DARKER half of the frame (the
 *                   speaker and the room), never on the screen, which really is that colour.
 *   Tame screen     local tone mapping: a blurred low-res luminance map says "this region is bright",
 *                   and only pixels that are themselves bright get pulled down. The gate matters:
 *                   without it the blur bleeds the screen's brightness onto the face standing in front
 *                   of it and darkens exactly the thing we want to see. The screen also loses most of
 *                   its colour, so a cyan wall becomes a quiet grey-blue backdrop.
 *   Lift faces      shadows come up, by pixel and by region, then a soft shoulder instead of clipping.
 *
 * Every number is MEASURED per frame (and smoothed over time), so a clip that cuts from a dark stage
 * to a bright slide gets the right fix on both sides of the cut. The four sliders are "how much",
 * not "what": on clean footage the measurements come out neutral and the filter does very little.
 *
 * HONEST LIMITS: this cannot separate the person from the screen (no segmentation model; Volt ships
 * no ML framework, see autoframe.js). A face that is only a few code values above black has no
 * detail to recover, and lifting it lifts the noise with it. Fix it on set if you can: light the
 * speaker, dim the slides.
 *
 * measure() is pure and runs in Node (see fx-fix-test.cjs). The renderer needs WebGL.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FootageFix = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { screen: 0.6, face: 0.5, cast: 0.7, haze: 0.7 };
  var LR = 0.2126, LG = 0.7152, LB = 0.0722;
  var LOG_MIN = -12;            // base map stores log2(Y) in [-12, 0] as 0..255

  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var LIN = new Float32Array(256);
  for (var i = 0; i < 256; i++) LIN[i] = lin(i / 255);

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // rgba: Uint8ClampedArray of a SMALL copy of the frame (about 96 px wide). amt: the four sliders.
  // Returns everything the shader needs: black point, channel gains and a blurred log-luminance map.
  function measure(rgba, w, h, amt) {
    amt = amt || DEFAULTS;
    var n = w * h, hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), p;
    for (p = 0; p < n; p++) { hr[rgba[p * 4]]++; hg[rgba[p * 4 + 1]]++; hb[rgba[p * 4 + 2]]++; }
    function pct(hist, q) { var want = n * q, acc = 0; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v / 255; } return 1; }
    // Black point: the darkest 1% per channel. Capped so a genuinely bright frame (a white slide
    // filling the shot) can't be crushed to grey mud.
    var haze = clamp01(amt.haze);
    var bp = [pct(hr, 0.01), pct(hg, 0.01), pct(hb, 0.01)].map(function (v) { return Math.min(v, 0.75) * haze; });

    // Dehazed linear copy, plus luminance for the percentile that picks "the darker half".
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), Y = new Float32Array(n);
    var lut = [0, 1, 2].map(function (c) {
      var t = new Float32Array(256), b = bp[c];
      for (var v = 0; v < 256; v++) t[v] = lin(clamp01((v / 255 - b) / (1 - b)));
      return t;
    });
    for (p = 0; p < n; p++) {
      R[p] = lut[0][rgba[p * 4]]; G[p] = lut[1][rgba[p * 4 + 1]]; B[p] = lut[2][rgba[p * 4 + 2]];
      Y[p] = LR * R[p] + LG * G[p] + LB * B[p];
    }
    var sorted = Float32Array.from(Y).sort();
    var cut = sorted[Math.floor(n * 0.55)];
    var mr = 0, mg = 0, mb = 0, k = 0, y0 = 0;
    for (p = 0; p < n; p++) if (Y[p] > 0.004 && Y[p] < cut) {
      mr += R[p]; mg += G[p]; mb += B[p]; k++;
      y0 += LR * LIN[rgba[p * 4]] + LG * LIN[rgba[p * 4 + 1]] + LB * LIN[rgba[p * 4 + 2]];   // same pixels, before the fix
    }
    var gain = [1, 1, 1];
    if (k > n * 0.02) {
      mr /= k; mg /= k; mb /= k;
      var avg = (mr + mg + mb) / 3, cast = clamp01(amt.cast);
      // Grey-world on the darker half, at partial strength and limited to ±60%: a stage lit
      // deliberately warm should stay a bit warm.
      gain = [mr, mg, mb].map(function (m) { var g = avg / Math.max(m, 1e-4); g = Math.max(0.6, Math.min(1.6, g)); return 1 + (g - 1) * cast; });
      var l = LR * gain[0] + LG * gain[1] + LB * gain[2];
      gain = gain.map(function (g) { return g / l; });
    }
    // Exposure give-back. Clearing haze subtracts light from EVERYTHING, and on a stage the speaker
    // is often the darkest thing in frame, so the fix that rescues the screen would sink the face.
    // Measure the darker half before and after, and hand that brightness back to non-screen pixels.
    var expo = 1;
    if (k > n * 0.02) {
      var y1 = LR * mr * gain[0] + LG * mg * gain[1] + LB * mb * gain[2];
      expo = Math.max(1, Math.min(4, (y0 / k) / Math.max(y1, 1e-4)));
    }
    // Base map: log2 luminance after the cast fix, box-blurred over ~3% of the frame width.
    var logY = new Float32Array(n);
    for (p = 0; p < n; p++) logY[p] = Math.log2(Math.max(1e-4, LR * R[p] * gain[0] + LG * G[p] * gain[1] + LB * B[p] * gain[2]));
    // (the base map is measured before the give-back: it describes where the screen IS)
    var base = boxBlur(boxBlur(logY, w, h, Math.max(1, Math.round(w * 0.025))), w, h, Math.max(1, Math.round(w * 0.025)));
    var bright = 0; for (p = 0; p < n; p++) if (logY[p] > -1.2) bright++;
    return { w: w, h: h, bp: bp, gain: gain, expo: expo, base: base, bright: bright / n };
  }

  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, s, c;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0;
      for (var dx = -r; dx <= r; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue; s += src[y * w + xx]; c++; }
      tmp[y * w + x] = s / c;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0;
      for (var dy = -r; dy <= r; dy++) { var yy = y + dy; if (yy < 0 || yy >= h) continue; s += tmp[yy * w + x]; c++; }
      out[y * w + x] = s / c;
    }
    return out;
  }

  // Exponential smoothing across frames so the fix doesn't pump as the speaker moves.
  function blend(prev, next, a) {
    if (!prev || prev.w !== next.w || prev.h !== next.h) return next;
    var m = function (x, y) { return x + (y - x) * a; };
    var base = new Float32Array(next.base.length);
    for (var i = 0; i < base.length; i++) base[i] = m(prev.base[i], next.base[i]);
    return { w: next.w, h: next.h, bp: next.bp.map(function (v, i) { return m(prev.bp[i], v); }),
             gain: next.gain.map(function (v, i) { return m(prev.gain[i], v); }), expo: m(prev.expo, next.expo), base: base, bright: m(prev.bright, next.bright) };
  }

  var VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var FS = [
    'precision highp float;',
    'uniform sampler2D uSrc, uBase; uniform vec3 uBp, uGain; uniform float uScreen, uFace, uExpo; varying vec2 v;',
    'vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }',
    'vec3 toSrgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }',
    'float th(float x){ float e = exp(2.0 * x); return (e - 1.0) / (e + 1.0); }',
    'const vec3 L = vec3(0.2126, 0.7152, 0.0722); const vec3 L6 = vec3(0.299, 0.587, 0.114); const float P = -2.6;',
    'void main(){',
    '  vec3 c = texture2D(uSrc, v).rgb;',
    '  c = clamp((c - uBp) / (1.0 - uBp), 0.0, 1.0);',                       // clear haze
    '  vec3 lin = toLin(c);',
    '  float bb = texture2D(uBase, v).r * 12.0 - 12.0;',
    '  float ly0 = log2(max(dot(lin * uGain, L), 1e-4));',
    '  float scr = clamp((mix(bb, ly0, 0.4) + 3.2) / 1.8, 0.0, 1.0);',       // 1 = the screen, 0 = speaker and room
    '  lin *= mix(uGain, vec3(1.0), scr);',                                   // remove cast from the people, not the slide
    '  lin *= mix(1.0, uExpo, (1.0 - scr) * smoothstep(-8.0, -5.0, ly0));',  // mid-tones (faces) get their light back; blacks stay black
    '  float ly = log2(max(dot(lin, L), 1e-4));',
    '  float b = mix(bb, ly, 0.4);',                                          // a little of the pixel cuts halos
    '  float over = max(b - P, 0.0), under = max(P - b, 0.0);',
    '  float bright = clamp((ly + 3.2) / 1.8, 0.0, 1.0);',                    // only bright pixels get pulled down
    '  float g = -uScreen * 0.7 * over * bright + uFace * 0.35 * under',
    '          + uFace * 0.75 * clamp(P - ly, 0.0, 3.0) * clamp((ly + 7.0) / 2.0, 0.0, 1.0);',
    '  vec3 o = lin * exp2(g);',
    '  float yo = dot(o, L);',
    '  if (yo > 0.8) o *= (0.8 + 0.2 * th((yo - 0.8) / 0.2)) / yo;',          // shoulder, not a clip
    '  vec3 s = toSrgb(o);',
    '  float hw = clamp((b - P) / 2.5, 0.0, 1.0) * uScreen;',                 // quiet the screen colour
    '  float lh = dot(s, L6); s = lh + (s - lh) * (1.0 - 0.8 * hw);',
    '  float lg = dot(s, L6); vec3 d = s - lg; float sat = max(max(abs(d.r), abs(d.g)), abs(d.b));',
    '  s = lg + d * (1.0 + 0.25 * (1.0 - clamp(sat * 3.0, 0.0, 1.0)));',      // gentle vibrance for skin
    '  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  // One GL context, reused. Returns null when WebGL is unavailable; callers then skip the fix.
  function Renderer() {
    if (typeof document === 'undefined') return null;
    var cv = document.createElement('canvas');
    var gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    function tex(unit) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var tSrc = tex(0), tBase = tex(1);
    gl.uniform1i(gl.getUniformLocation(pr, 'uSrc'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'uBase'), 1);
    var U = {}; ['uBp', 'uGain', 'uScreen', 'uFace', 'uExpo'].forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    var baseBytes = null;

    // src: the canvas (or image) to fix. m: from measure()/blend(). Returns the fixed canvas.
    this.render = function (src, m, amt) {
      var w = src.width, h = src.height;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tSrc);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
      if (!baseBytes || baseBytes.length !== m.w * m.h) baseBytes = new Uint8Array(m.w * m.h);
      // measure() rows run top-down; flip here so the base map lines up with the flipped source.
      for (var y = 0; y < m.h; y++) for (var x = 0; x < m.w; x++) {
        var val = (m.base[y * m.w + x] - LOG_MIN) / -LOG_MIN;
        baseBytes[(m.h - 1 - y) * m.w + x] = Math.max(0, Math.min(255, Math.round(val * 255)));
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tBase);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, m.w, m.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, baseBytes);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.uniform3fv(U.uBp, m.bp); gl.uniform3fv(U.uGain, m.gain); gl.uniform1f(U.uExpo, m.expo || 1);
      gl.uniform1f(U.uScreen, clamp01(amt.screen)); gl.uniform1f(U.uFace, clamp01(amt.face));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return cv;
    };
  }

  // Browser convenience: fix a 2D context in place. Holds its own GL renderer, probe canvas and the
  // smoothed measurement. `t` is the media time, used to reset smoothing across seeks and cuts.
  function Fixer() {
    var r = null, failed = false, probe = null, pctx = null, last = null, lastT = -1;
    this.apply = function (ctx, amt, t) {
      if (failed) return false;
      try { if (!r) { r = new Renderer(); if (!r.render) { failed = true; return false; } } }
      catch (e) { failed = true; console.warn('[FootageFix] WebGL unavailable:', e && e.message); return false; }
      var c = ctx.canvas, pw = 96, ph = Math.max(16, Math.round(96 * c.height / c.width));
      if (!probe) { probe = document.createElement('canvas'); pctx = probe.getContext('2d', { willReadFrequently: true }); }
      if (probe.width !== pw || probe.height !== ph) { probe.width = pw; probe.height = ph; last = null; }
      pctx.drawImage(c, 0, 0, pw, ph);
      var m = measure(pctx.getImageData(0, 0, pw, ph).data, pw, ph, amt);
      var jump = lastT < 0 || t == null || Math.abs(t - lastT) > 0.6;
      last = jump ? m : blend(last, m, 0.2);
      lastT = t == null ? -1 : t;
      ctx.drawImage(r.render(c, last, amt), 0, 0);
      return true;
    };
    this.reset = function () { last = null; lastT = -1; };
    this.available = function () { return !failed; };
  }

  return { DEFAULTS: DEFAULTS, measure: measure, blend: blend, Renderer: Renderer, Fixer: Fixer, FS: FS };
}));
