/* Volt — long-form transcription. © 2026 Tshepho Joel.
 *
 * Turns a whole recording into word-level timings WITHOUT playing it. This was proven in the
 * Transcribe page and lived only there; SmartClip needs the same thing on a 25-minute podcast,
 * so it moved here rather than being written a second time.
 *
 * WHY NOT REAL TIME
 * video.html's caption path plays the clip through Web Audio and records it — fine for a 40s
 * short, absurd for a 25-minute episode. decodeAudioData + OfflineAudioContext resamples the
 * entire file to 16 kHz mono in a few seconds, and Whisper's native rate is 16 kHz anyway, so
 * nothing is lost.
 *
 * WHY 90-SECOND CHUNKS
 * 16-bit mono at 16 kHz is ~1.83 MB/min. Vercel caps a serverless request body at 4.5 MB and
 * base64 inflates by ~1.37x, so a chunk has to stay near 3 MB of WAV — about 90 seconds. Each
 * part's word timings are shifted by its offset and stitched back into one timeline.
 *
 * The real-time capture is kept ONLY as a fallback for containers the browser cannot decode
 * (some .mov). It is the slow path and it says so.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoltSTT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TARGET_SR = 16000, CHUNK_SEC = 90;
  // Whisper can only PIN Afrikaans and English; the other nine SA languages are not in its
  // language set, so anything else is sent as '' and auto-detected — its best available path
  // for Setswana/Zulu/Xhosa and for the code-switching that is normal on this content.
  var PINNABLE = { af: 1, en: 1 };

  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  // Float32 mono samples -> 16-bit PCM WAV Blob (what Whisper/Groq want).
  function encodeWav(samples, sr) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    var ws = function (o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, n * 2, true);
    var o = 44;
    for (var i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // Decode the file's audio and downmix + resample to 16 kHz mono. Throws for containers
  // decodeAudioData cannot handle; the caller falls back to real time.
  function decodeMono16k(blobOrFile) {
    return Promise.resolve(blobOrFile.arrayBuffer()).then(function (ab) {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      return ac.decodeAudioData(ab).then(function (decoded) {
        try { ac.close(); } catch (e) { }
        var len = Math.max(1, Math.ceil(decoded.duration * TARGET_SR));
        var off = new OfflineAudioContext(1, len, TARGET_SR);
        var src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
        return off.startRendering().then(function (r) { return r.getChannelData(0); });
      }, function (e) { try { ac.close(); } catch (_) { } throw e; });
    });
  }

  function sendAudio(api, blob, mime, lang) {
    return blobToB64(blob).then(function (b64) {
      return fetch(api + '/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: b64, mime: mime, language: lang || '' })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) throw new Error('Please sign in.');
        if (r.status === 413) throw new Error('That part of the audio is too large — try a shorter clip.');
        if (!r.ok) throw new Error((d && (d.message || d.error)) || 'Transcription failed.');
        return d;
      });
    });
  }

  // Real-time fallback. NOT muted: a muted element feeds the source node silence, which is what
  // once fed Whisper a track of nothing. Routed only to the recorder, never to the speakers, so
  // it stays silent to the user while still carrying real audio.
  function realtimeCapture(api, file, lang) {
    var v = document.createElement('video'); v.src = URL.createObjectURL(file);
    return new Promise(function (res, rej) {
      v.addEventListener('loadedmetadata', res, { once: true });
      v.addEventListener('error', function () { rej(new Error('Could not read that video.')); }, { once: true });
    }).then(function () {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var src = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination();
      src.connect(dest);
      var mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm';
      var rec = new MediaRecorder(dest.stream, { mimeType: mime }), chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var stopped = new Promise(function (r) { rec.onstop = r; });
      v.currentTime = 0; rec.start();
      return v.play().then(function () {
        return new Promise(function (r) { v.addEventListener('ended', r, { once: true }); });
      }).then(function () {
        rec.stop(); return stopped;
      }).then(function () {
        try { ac.close(); } catch (e) { }
        var blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size < 800) throw new Error('No audio captured — does this clip have sound?');
        return sendAudio(api, blob, 'audio/webm', lang);
      });
    });
  }

  /**
   * transcribe(fileOrBlob, opts) -> Promise<{ words:[{word,start,end}], text, realtime:boolean }>
   * opts: { api, lang, onProgress(msg, pct) }
   * Word timings are on the SOURCE timeline, from 0, regardless of how many parts it took.
   */
  function transcribe(file, opts) {
    opts = opts || {};
    var api = opts.api || '/api';
    var lang = PINNABLE[opts.lang] ? opts.lang : '';
    var say = opts.onProgress || function () { };
    var words = [];
    say('Extracting audio…', 2);
    return decodeMono16k(file).catch(function () { return null; }).then(function (samples) {
      if (samples && samples.length > TARGET_SR * 0.5) {
        var per = CHUNK_SEC * TARGET_SR, parts = Math.ceil(samples.length / per);
        var chain = Promise.resolve();
        var _loop = function (i) {
          chain = chain.then(function () {
            say(parts > 1 ? ('Transcribing part ' + (i + 1) + ' of ' + parts + '…') : 'Transcribing audio…',
              5 + Math.round((i / parts) * 90));
            var slice = samples.subarray(i * per, Math.min(samples.length, (i + 1) * per));
            return sendAudio(api, encodeWav(slice, TARGET_SR), 'audio/wav', lang).then(function (d) {
              var offset = i * CHUNK_SEC;
              (d.words || []).forEach(function (w) {
                if (w && w.word) words.push({ word: w.word, start: (w.start || 0) + offset, end: (w.end || 0) + offset });
              });
            });
          });
        };
        for (var i = 0; i < parts; i++) _loop(i);
        return chain.then(function () { return false; });
      }
      say('Reading the audio in real time (this format needs it)…', 5);
      return realtimeCapture(api, file, lang).then(function (d) {
        (d.words || []).forEach(function (w) { if (w && w.word) words.push({ word: w.word, start: w.start || 0, end: w.end || 0 }); });
        return true;
      });
    }).then(function (wasRealtime) {
      words = words.filter(function (w) { return w && w.word && w.word.trim(); });
      if (!words.length) throw new Error('No speech detected in that video.');
      say('Transcribed ✓', 100);
      return { words: words, text: words.map(function (w) { return w.word.trim(); }).join(' '), realtime: wasRealtime };
    });
  }

  return { transcribe: transcribe, encodeWav: encodeWav, decodeMono16k: decodeMono16k, TARGET_SR: TARGET_SR, CHUNK_SEC: CHUNK_SEC };
}));
