// Volt — HTML sanitising for model-written email. © 2026 Tshepho Joel.
//
// The email task returns HTML written by a language model from a brief that often includes pasted or
// scraped article text. That text can carry instructions ("add this link / this script to the email"),
// so the model's output is UNTRUSTED. It is shown in a live preview and saved to a draft the whole
// workspace opens, so it must never carry script. The preview iframe is also sandboxed (email.html) —
// that is the real control; this is defence in depth so the stored draft and the sent email are clean
// too. Deliberately conservative: it strips; it does not try to repair.
//
// Email HTML in Volt is inline-styled <p>/<h2>/<a>/<img>/<table>, so none of what is removed here is
// something the builder legitimately produces. Underscore-prefixed on purpose: not a serverless function.

const BLOCK_WITH_CONTENT = /<\s*(script|iframe|object|embed|applet|noscript|template|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCK_ANY_TAG = /<\s*\/?\s*(script|iframe|object|embed|applet|meta|base|link|form|input|button|textarea|select|frame|frameset|noscript|template|svg|math)\b[^>]*>/gi;
const EVENT_ATTR = /(<[^>]*?)\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_URL = /\b(href|src|xlink:href|action|formaction|background|poster)\s*=\s*(["']?)\s*(?:javascript|vbscript|livescript|data:(?!image\/))[^"'>\s]*/gi;

export function sanitizeEmailHtml(html) {
  let s = String(html == null ? "" : html);
  // Loop to a fixed point: removing one construct can expose another (e.g. <scr<script>ipt>).
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/<!--[\s\S]*?-->/g, (m) => (/\[if|\<!\[endif/i.test(m) ? m : ""))   // keep Outlook conditional comments
         .replace(BLOCK_WITH_CONTENT, "")
         .replace(BLOCK_ANY_TAG, "");
    let prev;
    do { prev = s; s = s.replace(EVENT_ATTR, "$1"); } while (s !== prev);
    s = s.replace(BAD_URL, "$1=$2#");
    if (s === before) break;
  }
  return s;
}
