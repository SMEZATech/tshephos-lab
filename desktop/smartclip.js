/* Volt — SmartClip scoring engine. © 2026 Tshepho Joel.
 *
 * Finds the moments worth cutting out of a long recording, from word-level timings alone.
 * No DOM, no network, no AI — pure functions over an array of {word, start, end}. That is
 * deliberate: it makes the whole thing testable in Node (see sc-test.cjs), it costs nothing
 * to run, and it means the timestamps are MEASURED rather than generated.
 *
 * WHY NOT JUST ASK THE MODEL FOR TIMESTAMPS
 * Because it invents them. Hand a 25-minute transcript to an LLM and ask for "the best 45
 * seconds" and it will return times that look plausible and land mid-sentence, or on a passage
 * that is thirty seconds from where it claims. Every boundary here comes from the word timings.
 * The model's job (a later, optional pass) is only to RANK and TITLE candidates that already
 * have clean edges — it can be wrong about which clip is best without producing a broken cut.
 *
 * WHAT IT OPTIMISES FOR, AND WHY THOSE THINGS
 * A clip fails for boring reasons long before it fails for interesting ones:
 *   - it opens on "So it's basically that same problem" and nobody knows what "it" is
 *   - it ends mid-sentence
 *   - there is four seconds of dead air in the middle
 *   - it is a great point with no specific in it, so there is nothing to remember
 * Those are all measurable. The scorer is mostly a machine for not making them.
 *
 * The context is SME South Africa's own numbers: across 614 Instagram posts in twelve months
 * the median post reached 114 people and the top 10% carried 82% of ALL reach. Hit rate is the
 * whole game, so this is tuned to return FEW confident clips rather than many plausible ones —
 * a thin list you trust beats a long one you have to audit.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmartClip = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- tunables
  var DEFAULTS = {
    minLen: 18,          // under ~18s there is no room for a hook AND a payoff
    maxLen: 60,          // past 60s retention falls off a cliff on every platform we post to
    sweetLo: 22,         // the band Volt's own export tip recommends, and it holds up
    sweetHi: 45,
    maxGap: 2.2,         // dead air inside a clip, in seconds, before it reads as a mistake
    minGapBetween: 20,   // seconds of separation between picks, so five clips aren't one moment
    count: 6,
    // A QUALITY FLOOR, not a ranking. Greedy selection alone will happily return the least-bad
    // sixty seconds of a recording that has three good moments in it — the first run of this
    // test picked a passage scoring 2 ("Right, so let us take a short break there") purely
    // because nothing else was left unoverlapped. A clip nobody would post is worse than a
    // shorter list: it teaches you to audit the output, and then you stop trusting any of it.
    //
    // 25 is derived, not guessed. The minimum publishable clip is: opens cleanly (+3), holds
    // one specific (+3 at worst), ends on a complete thought (+8), steady pace (+4), lands in
    // the 22-45s band (+10) = 28. Anything below 25 is missing one of those outright.
    minScore: 25
  };

  // A sentence must not START on a word that points at something the viewer never saw. This is
  // the single most common way an auto-cut clip is unusable, and it costs nothing to detect.
  var DANGLING = /^(so|and|but|because|which|that|this|these|those|it|its|he|she|they|them|his|her|their|then|there|also|anyway|however|therefore|thus|yet|plus|again)\b/i;
  // Openers that earn attention on their own. Not a virality model — just "does this stand up
  // with no preceding context".
  var STRONG_OPEN = [
    { re: /^(what|why|how|when|who|where|which)\b.*\?/i, pts: 14, label: 'opens on a question' },
    { re: /^(if you|when you|most people|nobody|no one|everyone|every founder|the biggest|the worst|the first|the one thing|here'?s|listen)\b/i, pts: 12, label: 'opens on a direct address' },
    { re: /^(don'?t|stop|never|always|start|forget|avoid|check)\b/i, pts: 10, label: 'opens on an instruction' },
    { re: /^[^.?!]{0,40}\b(mistake|myth|truth|secret|problem|reason|difference|lesson)\b/i, pts: 9, label: 'names a mistake or a lesson' },
    { re: /^\s*(R\s?\d|\d)/i, pts: 8, label: 'opens on a number' }
  ];
  // A specific is what survives the scroll. Rand amounts and SA institutions are in here because
  // that is what this audience's content is actually about.
  var SPECIFIC = [
    { re: /\bR\s?\d[\d\s.,]*(m|k|million|billion)?\b/i, pts: 9, label: 'a rand figure' },
    { re: /\b\d+([.,]\d+)?\s?(%|per ?cent|percent)/i, pts: 8, label: 'a percentage' },
    { re: /\b\d[\d\s,]*\s?(million|billion|thousand)\b/i, pts: 7, label: 'a large number' },
    { re: /\b(SARS|CIPC|B-?BBEE|BEE|NCR|SEDA|SEFA|IDC|NYDA|CIDB|POPIA|VAT|UIF|PAYE)\b/, pts: 7, label: 'a named institution or rule' },
    { re: /\b(\d{1,2}) (days?|weeks?|months?|years?)\b/i, pts: 5, label: 'a timeframe' },
    { re: /\b(19|20)\d{2}\b/, pts: 4, label: 'a year' },
    { re: /\b\d+\b/, pts: 3, label: 'a number' }
  ];
  // Story and turn markers. A clip with one of these has a shape; without one it is commentary.
  var SHAPE = [
    { re: /\b(i (was|had|remember|realised|realized|learned|started|lost|failed))\b/i, pts: 8, label: 'first-hand story' },
    { re: /\b(the (mistake|problem|reason|difference)|what (nobody|no one|most people) (tells?|know)|turns out|actually)\b/i, pts: 7, label: 'a turn' },
    { re: /\b(so (what|here'?s)|the (point|lesson|takeaway) is|which means)\b/i, pts: 6, label: 'lands a point' }
  ];
  // Filler is not fatal, but a passage that is mostly filler is not a highlight.
  var FILLER = /\b(um+|uh+|erm+|you know|i mean|kind of|sort of|like,? |basically|literally|obviously)\b/gi;

  // ---------------------------------------------------------------- sentences
  // Whisper attaches punctuation to words, so terminal punctuation is the primary boundary and a
  // long pause is the fallback. Both are needed: transcripts of natural speech routinely run for
  // twenty words without a full stop, and a speaker who pauses has ended a thought whether or not
  // the model wrote a full stop.
  function toSentences(words, pauseBreak) {
    pauseBreak = pauseBreak || 0.62;
    var out = [], cur = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || !w.word) continue;
      if (!cur) cur = { words: [], start: w.start, end: w.end, text: '' };
      var gapBefore = cur.words.length ? (w.start - cur.end) : 0;
      if (cur.words.length && gapBefore > pauseBreak) {
        out.push(finish(cur));
        cur = { words: [], start: w.start, end: w.end, text: '' };
      }
      cur.words.push(w);
      cur.end = w.end;
      if (/[.!?]["')\]]?\s*$/.test(w.word)) { out.push(finish(cur)); cur = null; }
    }
    if (cur && cur.words.length) out.push(finish(cur));
    return out;
  }
  function finish(s) {
    s.text = s.words.map(function (w) { return w.word; }).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
    s.terminal = /[.!?]["')\]]?$/.test(s.text);
    s.dur = Math.max(0, s.end - s.start);
    return s;
  }

  // Largest silence anywhere inside a run of sentences, including the joins between them.
  function biggestGap(sents, a, b) {
    var g = 0;
    for (var i = a; i <= b; i++) {
      var s = sents[i];
      for (var j = 1; j < s.words.length; j++) g = Math.max(g, s.words[j].start - s.words[j - 1].end);
      if (i < b) g = Math.max(g, sents[i + 1].start - s.end);
    }
    return g;
  }

  // ---------------------------------------------------------------- scoring
  function scoreRun(sents, a, b, o) {
    var first = sents[a], last = sents[b];
    var dur = last.end - first.start;
    var text = ''; for (var i = a; i <= b; i++) text += (i > a ? ' ' : '') + sents[i].text;
    var why = [], score = 0;
    var add = function (pts, label) { if (pts) { score += pts; why.push({ label: label, points: pts }); } };

    // --- the opener carries the clip, so it is scored on its own, not as part of the bulk ---
    var opener = first.text;
    var hooked = false;
    for (var k = 0; k < STRONG_OPEN.length; k++) {
      if (STRONG_OPEN[k].re.test(opener)) { add(STRONG_OPEN[k].pts, STRONG_OPEN[k].label); hooked = true; break; }
    }
    if (DANGLING.test(opener)) {
      // The clip opens pointing at something the viewer never saw. This is the difference between
      // a clip you can post and one you have to re-cut by hand, so it outweighs anything else.
      add(-22, 'opens on "' + opener.split(/\s+/)[0] + '" — refers to something the viewer missed');
    } else if (!hooked) {
      add(3, 'opens cleanly');
    }

    // --- a specific is what the viewer remembers; only the best one counts, not a pile of digits
    for (var s = 0; s < SPECIFIC.length; s++) {
      if (SPECIFIC[s].re.test(text)) { add(SPECIFIC[s].pts, 'contains ' + SPECIFIC[s].label); break; }
    }
    if (!/\d/.test(text) && !/\b(SARS|CIPC|B-?BBEE|NCR|VAT)\b/.test(text)) add(-6, 'no specific — nothing concrete to hold on to');

    // --- shape: does anything actually happen ---
    for (var h = 0; h < SHAPE.length; h++) {
      if (SHAPE[h].re.test(text)) { add(SHAPE[h].pts, SHAPE[h].label); break; }
    }

    // --- it has to END, or the viewer is left hanging ---
    if (last.terminal) add(8, 'ends on a complete thought'); else add(-14, 'ends mid-sentence');

    // --- dead air ---
    var gap = biggestGap(sents, a, b);
    if (gap > o.maxGap) add(-Math.min(18, Math.round((gap - o.maxGap) * 9)), Math.round(gap * 10) / 10 + 's of silence inside');

    // --- pace. Both extremes are bad and for different reasons: too slow is dead weight, too
    //     fast is usually the speaker reading a list nobody can follow.
    var wc = 0; for (var q = a; q <= b; q++) wc += sents[q].words.length;
    var wps = dur > 0 ? wc / dur : 0;
    if (wps < 1.6) add(-8, 'slow delivery (' + wps.toFixed(1) + ' words/sec)');
    else if (wps > 4.2) add(-5, 'rushed (' + wps.toFixed(1) + ' words/sec)');
    else add(4, 'steady pace');

    // --- filler density ---
    var fill = (text.match(FILLER) || []).length;
    var fillRatio = wc ? fill / wc : 0;
    if (fillRatio > 0.09) add(-Math.round(fillRatio * 60), 'heavy filler');

    // --- length. A triangle over the sweet band rather than a cliff, so a 47s clip is not
    //     punished as if it were a 90s one.
    if (dur >= o.sweetLo && dur <= o.sweetHi) add(10, 'good length (' + Math.round(dur) + 's)');
    else {
      var off = dur < o.sweetLo ? (o.sweetLo - dur) : (dur - o.sweetHi);
      add(-Math.min(10, Math.round(off * 0.7)), Math.round(dur) + 's — outside the 22–45s band');
    }

    return { start: first.start, end: last.end, dur: dur, text: text, score: score, why: why, a: a, b: b };
  }

  // ---------------------------------------------------------------- selection
  // Every contiguous run of sentences inside the length window is a candidate. For a 25-minute
  // recording that is a few thousand runs — trivial to score, and exhaustive beats clever here.
  function candidates(sents, o) {
    var out = [];
    for (var a = 0; a < sents.length; a++) {
      for (var b = a; b < sents.length; b++) {
        var dur = sents[b].end - sents[a].start;
        if (dur < o.minLen) continue;
        if (dur > o.maxLen) break;
        out.push(scoreRun(sents, a, b, o));
      }
    }
    return out;
  }

  // Greedy, non-overlapping, with real separation. Without the separation you get five clips from
  // the same ninety seconds — technically the highest-scoring answer, and useless as a week of
  // content.
  function pick(cands, o) {
    var sorted = cands.filter(function (c) { return c.score >= o.minScore; })
                      .sort(function (x, y) { return y.score - x.score; });
    var taken = [];
    for (var i = 0; i < sorted.length && taken.length < o.count; i++) {
      var c = sorted[i], clash = false;
      for (var j = 0; j < taken.length; j++) {
        var t = taken[j];
        if (c.start < t.end + o.minGapBetween && t.start < c.end + o.minGapBetween) { clash = true; break; }
      }
      if (!clash) taken.push(c);
    }
    return taken.sort(function (x, y) { return x.start - y.start; });
  }

  /**
   * find(words, opts) -> [{ start, end, dur, text, score, why:[{label,points}] }]
   * Sorted by position in the recording, not by score, because that is the order you review in.
   * `rank` carries the score order for anyone who wants it.
   * MAY RETURN FEWER THAN `count`, OR NOTHING AT ALL. That is the feature: a recording with two
   * good moments should hand back two, and a rambling one should hand back none and say so.
   */
  function find(words, opts) {
    var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in (opts || {})) if (opts[k2] != null) o[k2] = opts[k2];
    if (o.maxLen < o.minLen) o.maxLen = o.minLen;
    var sents = toSentences(words || []);
    if (!sents.length) return [];
    var picked = pick(candidates(sents, o), o);
    var byScore = picked.slice().sort(function (x, y) { return y.score - x.score; });
    picked.forEach(function (p) {
      p.rank = byScore.indexOf(p) + 1;
      delete p.a; delete p.b;
    });
    return picked;
  }

  return { find: find, toSentences: toSentences, DEFAULTS: DEFAULTS, _score: scoreRun, _candidates: candidates };
}));
