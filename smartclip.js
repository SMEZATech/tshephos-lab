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

  // ================================================================ v2: EDITED CLIPS
  // Studied from OpusClip's cut of Gary Manzini's webinar (Nov 2026, 39 clips). Two editing moves
  // separate a clip that feels produced from one that feels trimmed, and both are measurable:
  //
  // 1. THE COLD OPEN. Six of Opus's top seven clips do not start where the speaker started. The
  //    strongest single line in the passage, usually the conclusion ("If there's one control you'd
  //    need to enable today, let it be MFA"), plays FIRST for 3-8 seconds, then the clip cuts back
  //    to the setup. The line is also left in its natural place, so the argument still reads.
  // 2. THE TANGENT CUT. Asides ("Um, so, call it…"), self-corrections and dead air between
  //    sentences come out. A clip becomes 2-6 PIECES of the recording, not one stretch.
  //
  // A v2 clip therefore carries `pieces: [{start, end}]` in PLAY order. `start`/`end` stay as the
  // span of the recording it draws on, and `dur` is the edited length the viewer sees. Every piece
  // boundary is a word edge, so nothing is ever cut mid-syllable.

  // Words that can be shaved off the FRONT of a hook line without changing what it says.
  var HOOK_LEAD = /^(um+|uh+|erm+|so|and|but|now|okay|ok|well|like|yeah|right|also|then|because|basically|actually|obviously|look|listen|again|anyway)[,.]?$/i;
  // What makes a line work with no setup at all. Not a virality model: a line has to be a complete,
  // self-contained claim, and these are the shapes that carry one.
  // Checked against the cold opens OpusClip actually chose for Gary Manzini's webinar: "Attackers only
  // need to compromise one account to reach many organizations quickly", "If there's one control you'd
  // need to enable today, let it be MFA", "only 3 percent feel they have enough money", "If you
  // remember nothing else from today, just remember lock, store, train and check".
  var PUNCH = [
    { re: /\b(if there'?s one|the (one|single|biggest|number one|first|only) (thing|control|step|rule|mistake|reason)|if you remember (nothing|one thing)|nothing else)\b/i, pts: 12 },
    { re: /\b(remember|never|always|stop|don'?t|make sure|enable|turn on|check)\b/i, pts: 6 },
    { re: /\b(rule of thumb|the (point|lesson|takeaway|truth|reality) is|bottom line)\b/i, pts: 8 },
    { re: /\d\s?(%|per ?cent\b|percent\b)|\bR\s?\d/i, pts: 8 },                 // NB: no \b after "%" (not a word char)
    { re: /\b(need to|needs to|must|have to|has to)\b/i, pts: 4 },
    { re: /\b(compromis\w*|hack\w*|steal\w*|stolen|fake|fraud\w*|scam\w*|breach\w*|ransom\w*|cripple\w*|kill\w*|destroy\w*|cost\w*|los(e|es|ing|t)|leak\w*|block\w*|protect\w*|sav(e|es|ing)|impersonat\w*|copy|copies)\b/i, pts: 6 },
    { re: /\b(attackers?|criminals?|scammers?|hackers?|customers?|money|cash|business(es)?|budget\w*)\b/i, pts: 3 },
    { re: /\b(only|every|all|most|biggest|worst|nobody|no one|everyone|many)\b/i, pts: 3 },
    { re: /\byou(r)?\b/i, pts: 2 }
  ];
  var NO_HOOK_START = /^(it|its|it'?s|this|that|these|those|they|them|he|she|which|there|here|the other|another|let'?s|let me|i don'?t|i'?m (going|gonna)|we'?ll|today|in this|as i (said|mentioned)|once you|as we|as you)\b/i;
  // A hook must CLAIM something. Talk about the talk ("I don't like going into detail", "let's look at
  // five ways") is not a hook however short it is; these are the meta-commentary shapes to refuse.
  var META = /\b(going into detail|next slide|this (slide|session|webinar|section)|we('| wi)ll (cover|look|talk|speak)|let'?s (look|move|talk|speak)|as you can see|spoke about (earlier|before))\b/i;

  function stripLead(words) {
    var i = 0;
    while (i < words.length - 4 && HOOK_LEAD.test(words[i].word.replace(/[,.]+$/, ''))) i++;
    return words.slice(i);
  }
  // Score one sentence as a cold open. Returns null if it cannot stand alone.
  function hookOf(sent, next, minPts) {
    if (minPts == null) minPts = 12;
    // A pause can split one thought in two ("If there's one control you'd need to enable today," /
    // "let it be MFA."). Join it back when the first half did not end the sentence.
    if (next && !sent.terminal && next.words.length <= 12 && (next.start - sent.end) < 1.2)
      sent = { words: sent.words.concat(next.words), terminal: next.terminal };
    // A sentence that STARTS lower-case was split mid-thought by a pause: it has no beginning to lead with.
    if (/^[a-z]/.test(String((sent.words[0] && sent.words[0].word) || ''))) return null;
    var ws = stripLead(sent.words);
    if (ws.length < 5 || ws.length > 28) return null;
    var dur = ws[ws.length - 1].end - ws[0].start;
    if (dur < 1.6 || dur > 9.5) return null;
    var text = ws.map(function (w) { return w.word; }).join(' ');
    if (NO_HOOK_START.test(text) || DANGLING.test(text)) return null;
    if (!sent.terminal) return null;
    var fill = (text.match(FILLER) || []).length;
    if (fill > 1 || META.test(text)) return null;
    // a line that points back at something unseen in its first words cannot open a clip
    if (/\b(these|those|this one|that one)\b/i.test(ws.slice(0, 6).map(function (w) { return w.word; }).join(' '))) return null;
    var pts = 0;
    for (var k = 0; k < PUNCH.length; k++) if (PUNCH[k].re.test(text)) pts += PUNCH[k].pts;
    if (pts < Math.min(9, minPts)) return null;   // the substance has to be there before shortness counts
    if (ws.length <= 14) pts += 3;            // short is punchy
    return pts >= minPts ? { start: ws[0].start, end: ws[ws.length - 1].end, text: text, pts: pts } : null;
  }
  // Is this sentence an aside the clip is better without? Only ever true for INTERIOR sentences.
  function isAside(sent) {
    var wc = sent.words.length;
    var fill = (sent.text.match(FILLER) || []).length;
    var content = sent.words.filter(function (w) { return !/^(um+|uh+|erm+|so|and|but|okay|ok|well|like|yeah|right|you|know|i|mean)[,.]?$/i.test(w.word); }).length;
    return (wc <= 6 && content <= 2) || (wc && fill / wc >= 0.34);
  }
  // Turn a run of sentences into play-ordered pieces: asides dropped, silences > 0.9s cut out.
  function bodyPieces(sents, a, b) {
    var keep = [];
    for (var i = a; i <= b; i++) {
      if (i > a && i < b && isAside(sents[i])) continue;
      keep.push(sents[i]);
    }
    var pieces = [], cur = null;
    keep.forEach(function (s, k) {
      var prev = keep[k - 1];
      var contiguous = prev && sents.indexOf(s) === sents.indexOf(prev) + 1 && (s.start - prev.end) <= 0.9;
      if (cur && contiguous) { cur.end = s.end; }
      else { if (cur) pieces.push(cur); cur = { start: s.start, end: s.end }; }
    });
    if (cur) pieces.push(cur);
    return pieces;
  }
  function piecesDur(p) { var d = 0; for (var i = 0; i < p.length; i++) d += p[i].end - p[i].start; return d; }

  // Build the edited version of a scored run: tangent cut, then a cold open if the passage has a
  // line strong enough to lead with. Rescored so an edit only wins if it is genuinely better.
  function edit(sents, c, o) {
    var pieces = bodyPieces(sents, c.a, c.b);
    var out = { pieces: pieces, hook: null, score: c.score, why: c.why.slice() };
    // Whisper capitalises the start of a sentence. A body that opens lower-case was split on a pause
    // mid-sentence ("to your mail account..."), the same failure as a dangling pronoun.
    if (/^[a-z]/.test(sents[c.a].text.replace(/^[^A-Za-z]+/, ''))) { out.score -= 12; out.why.push({ label: 'starts mid-sentence', points: -12 }); }
    var removed = (c.end - c.start) - piecesDur(pieces);
    if (removed > 0.8) { out.score += Math.min(8, Math.round(removed)); out.why.push({ label: 'tangents and dead air cut (' + removed.toFixed(1) + 's)', points: Math.min(8, Math.round(removed)) }); }
    // dead air was penalised on the uncut run; the pieces no longer contain it
    c.why.forEach(function (w) { if (/silence inside/.test(w.label)) { out.score -= w.points; } });
    if (o.hooks !== false && piecesDur(pieces) >= 14) {
      var best = null;
      for (var i = c.a + 1; i <= c.b; i++) {
        var h = hookOf(sents[i], i < c.b ? sents[i + 1] : null);
        if (h && (!best || h.pts > best.pts)) best = h;
      }
      // A cold open must ADD something: not a line the clip already opens on.
      if (best && best.start - c.start > 4) {
        out.hook = best;
        out.pieces = [{ start: best.start, end: best.end }].concat(pieces);
        var bonus = Math.min(14, Math.round(best.pts * 0.7));
        out.score += bonus; out.why.push({ label: 'cold open: "' + best.text.slice(0, 60) + '"', points: bonus });
        // With the hook giving context first, a soft body opener costs less.
        c.why.forEach(function (w) { if (/refers to something the viewer missed/.test(w.label)) { out.score += 12; } });
      }
    }
    out.body = pieces;
    // The lines a smarter judge may choose between: everything that can stand alone as an opener (a
    // looser bar than the regex's own pick), best-scoring first. Timings are the engine's; the judge only
    // chooses WHICH measured line leads, so it can never produce a bad cut.
    out.options = [];
    if (o.hooks !== false && piecesDur(pieces) >= 14) {
      for (var j = c.a + 1; j <= c.b; j++) {
        var oh = hookOf(sents[j], j < c.b ? sents[j + 1] : null, 0);
        if (oh && oh.start - c.start > 4) out.options.push(oh);
      }
      out.options.sort(function (x, y) { return y.pts - x.pts; });
      out.options = out.options.slice(0, 6);
    }
    out.dur = piecesDur(out.pieces);
    return out;
  }
  // Put a chosen line first. Returns the clip, or null if the line cannot open it (not one of its options).
  function applyHook(clip, opt) {
    if (!clip || !clip.body || !opt || !(opt.start - clip.start > 4)) return null;
    clip.pieces = [{ start: opt.start, end: opt.end }].concat(clip.body);
    clip.hook = opt.text; clip.coldLine = opt.text; clip.dur = piecesDur(clip.pieces); clip.pickedBy = 'judge';
    return clip;
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
    var cands;
    if (o.edit) {
      // v2: long-form is allowed to be long. Opus's best-scoring clips ran 60-130s; the stories
      // need room. The sweet band follows the window the caller asked for.
      // Opus's median clip was ~39s and its long ones were its best stories, so the band rewards
      // 25-60s and a long clip has to win on substance, not on length.
      if (!opts || opts.sweetHi == null) { o.sweetLo = Math.max(o.minLen + 4, 22); o.sweetHi = Math.min(o.maxLen, 60); }
      if (!opts || opts.minGapBetween == null) o.minGapBetween = 4;
      if (!o.count) {   // auto: about one clip per 90s of recording, 4-40
        var total = sents[sents.length - 1].end - sents[0].start;
        o.count = Math.max(4, Math.min(40, Math.round(total / 90)));
      }
      var raw = candidates(sents, o).filter(function (c) { return c.score >= o.minScore - 12; })
                                   .sort(function (x, y) { return y.score - x.score; })
                                   .slice(0, Math.max(60, o.count * 25));
      cands = raw.map(function (c) {
        var e = edit(sents, c, o);
        c.score = e.score; c.why = e.why; c.pieces = e.pieces; c.dur = e.dur; c.body = e.body; c.options = e.options;
        if (e.hook) c.hook = e.hook.text;
        return c;
      });
    } else cands = candidates(sents, o);
    var picked = pick(cands, o);
    var byScore = picked.slice().sort(function (x, y) { return y.score - x.score; });
    picked.forEach(function (p) {
      p.rank = byScore.indexOf(p) + 1;
      delete p.a; delete p.b;
    });
    return picked;
  }

  // Map a time on the EDITED clip to a time in the recording. pieces are in play order.
  function srcAt(pieces, t) {
    var acc = 0;
    for (var i = 0; i < pieces.length; i++) {
      var d = pieces[i].end - pieces[i].start;
      if (t < acc + d || i === pieces.length - 1) return { src: pieces[i].start + Math.max(0, Math.min(d, t - acc)), i: i };
      acc += d;
    }
    return { src: pieces.length ? pieces[0].start : 0, i: 0 };
  }
  // The words a viewer hears, re-timed onto the edited clip's own clock (hook words appear twice
  // when the hook is also left in its natural place — that is the point).
  function wordsFor(words, pieces) {
    var out = [], acc = 0;
    pieces.forEach(function (p) {
      words.forEach(function (w) {
        if (w.end > p.start + 0.01 && w.start < p.end - 0.01)
          out.push({ word: w.word, start: acc + Math.max(0, w.start - p.start), end: acc + Math.min(p.end - p.start, w.end - p.start) });
      });
      acc += p.end - p.start;
    });
    return out;
  }
  return { find: find, toSentences: toSentences, DEFAULTS: DEFAULTS, srcAt: srcAt, wordsFor: wordsFor, piecesDur: piecesDur, applyHook: applyHook,
           _score: scoreRun, _candidates: candidates, _hookOf: hookOf, _bodyPieces: bodyPieces };
}));
