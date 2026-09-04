/* Volt — real auth + per-user keys (v2, Supabase). © 2026 Tshepho Joel.
   Loaded on EVERY page (web + desktop). Gates the app on a real account, attaches the
   session token to every /api call, and on desktop passes the user's own provider keys.
   The public APP_KEY is retired — the server now requires a valid login instead. */
(function () {
  "use strict";

  /* ---------- brand config (Volt / Vantly) ----------
     ONE deployed codebase, TWO commercial identities. Which brand is active is decided at RUNTIME
     from the hostname this script is running on — never a build step, since these are plain static
     files served as-is (no bundler). Volt is the unconditional default: any hostname that isn't
     recognised as Vantly's falls straight through to today's exact Volt config, so Volt's own
     install (web + desktop, which serves pages from a local 127.0.0.1 origin, never this hostname)
     is byte-for-byte unaffected by any of this.
     Everything brand-specific lives HERE — visual chrome (gate/rail/settings text), which Supabase
     project owns the account data, and which deployment answers /api calls (see the fetch patch
     below) — so bringing up a new commercial brand is "add a row here", not "edit 15 files".
     VANTLY IS NOT LIVE YET: supabaseUrl/supabaseAnon/apiHost are deliberately blank placeholders
     until the Vantly Supabase + Vercel projects exist (Joel's own account-level steps — this repo
     has no ability to create either). Left blank on purpose rather than falling back to Volt's
     credentials: silently authenticating Vantly signups against VOLT's Supabase project would mix
     a future paying customer's data into Joel's own internal org — the one thing this whole
     multi-brand approach exists to avoid. Blank creds show a clear "not configured" gate instead of
     a broken or (worse) silently-wrong one. Fill in the three blanks below once those exist.
  */
  var BRANDS = {
    volt: {
      name: "Volt", wordmark: "Volt.", mark: "V",
      tagline: "SME South Africa’s marketing suite.",
      emailPlaceholder: "you@smesouthafrica.co.za",
      favicon: "", // unset = keep whatever <link rel=icon> each page already declares
      supabaseUrl: "https://ltnjjsadcvqmtczbtxii.supabase.co",
      supabaseAnon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0bmpqc2FkY3ZxbXRjemJ0eGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDgyODIsImV4cCI6MjA5NzcyNDI4Mn0.3sUeA0nITk1BqPQZGrgluHqQNHm9jP6KlrRrsZG3Tps",
      apiHost: "https://tshephos-lab.vercel.app",
    },
    vantly: {
      name: "Vantly", wordmark: "Vantly", mark: "V",
      tagline: "Your vantage point.",
      emailPlaceholder: "you@yourcompany.com",
      favicon: "",
      supabaseUrl: "https://wxiaumhgjzysivzaryuu3.supabase.co",
      supabaseAnon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aWF1bWhnanp5c2l2emFyeXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTEzODQsImV4cCI6MjEwNDA2NzM4NH0.EqmA8lDopq9ElNjnt2x5webSTueJ77FEyyiHrq9G-E8",
      apiHost: "https://vantly-xi.vercel.app", // update this once the real vantly.* domain is connected
    },
  };
  function detectBrand() {
    try {
      var h = String(location.hostname || "").toLowerCase();
      if (h.indexOf("vantly") !== -1) return BRANDS.vantly;
    } catch (e) {}
    return BRANDS.volt;
  }
  var BRAND = detectBrand();
  // Deliberately NOT "|| BRANDS.volt.supabaseUrl" — an unconfigured Vantly must fail closed with a
  // clear message (see init()), never silently authenticate against Volt's real production project.
  var SUPABASE_URL = BRAND.supabaseUrl;
  var SUPABASE_ANON = BRAND.supabaseAnon;
  var BRAND_READY = !!(SUPABASE_URL && SUPABASE_ANON);
  var KEYS_LS = "volt_keys_v1";
  var sb = null, session = null;

  var KEYS = {
    gemini:     { label: "Google Gemini", sub: "Primary AI + captions + images · free", url: "https://aistudio.google.com/apikey" },
    gemini2:    { label: "Google Gemini (2nd key)", sub: "A 2nd Gemini key from ANOTHER Google account = separate free quota", url: "https://aistudio.google.com/apikey" },
    groq:       { label: "Groq", sub: "Fast AI fallback + Whisper captions · free", url: "https://console.groq.com/keys" },
    cerebras:   { label: "Cerebras", sub: "Very fast AI fallback · free tier", url: "https://cloud.cerebras.ai/" },
    openrouter: { label: "OpenRouter", sub: "AI fallback, many free models · free key", url: "https://openrouter.ai/keys" },
    mistral:    { label: "Mistral", sub: "AI fallback · free tier", url: "https://console.mistral.ai/api-keys/" },
    openai:     { label: "OpenAI", sub: "AI fallback (uses your credits)", url: "https://platform.openai.com/api-keys" },
    postiz:     { label: "Postiz", sub: "Live analytics, top posts & scheduling", url: "https://postiz.com" },
    kit:        { label: "Kit", sub: "Newsletters + email stats", url: "https://app.kit.com/account_settings/developer_settings" },
    wpUrl:      { label: "WordPress site URL", sub: "Hosts images (Studio → Scheduler, Email uploads)", url: "https://wordpress.org", ph: "https://smesouthafrica.co.za" },
    wpUser:     { label: "WordPress username", sub: "Your WP login username", url: "" },
    wpKey:      { label: "WordPress application password", sub: "WP → Users → Profile → Application Passwords", url: "https://wordpress.org/documentation/article/application-passwords/" },
  };
  // Providers that feed the AI failover chain (order = try order). Others (postiz/kit) are service keys.
  var AI_PROVIDERS = ["gemini", "gemini2", "groq", "cerebras", "openrouter", "mistral", "openai"];

  function isDesktop() { return !!window.voltNative; }

  /* ---------- same-origin asset URLs ----------
     Studio/Video/Freeform fetch external images (brand logos, featured images, scraped og:images)
     and hand the BYTES to the canvas worker. Cross-origin fetch needs CORS headers, and the place
     most of these actually live — WordPress uploads — sends none. It only ever worked because the
     desktop shell ran with webSecurity OFF, which is a real hole: remote pages executing with
     same-origin enforcement disabled, on a machine holding the user's API keys.
     voltAsset() routes those loads through /api/scrape?img=1 so they arrive from OUR origin. Then
     nothing depends on webSecurity being off and it can be turned back on.
     Pass-through (never proxied): data:/blob: URLs, and anything already on this origin. */
  window.voltAsset = function (url) {
    var u = String(url || "");
    if (!u || /^(data:|blob:)/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) return u;                       // relative — already ours
    try { if (new URL(u, location.href).origin === location.origin) return u; } catch (e) {}
    // volt-auth.js ships byte-identical to every target (build-sync does NOT rewrite it), so the
    // base is resolved at runtime: origin-relative when we're already on a Volt origin — which
    // keeps preview deployments and local dev working — and absolute otherwise.
    var ours = /(^|\.)tshephos-lab[^.]*\.vercel\.app$/.test(location.hostname)
            || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    var base = ours ? "/api/scrape" : "https://tshephos-lab.vercel.app/api/scrape";
    return base + "?img=1&url=" + encodeURIComponent(u);
  };
  function getKeys() { try { return JSON.parse(localStorage.getItem(KEYS_LS) || "{}"); } catch (e) { return {}; } }
  function saveKeys(k) { try { localStorage.setItem(KEYS_LS, JSON.stringify(k)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function firstName(email) { var n = String(email || "").split("@")[0].split(/[._-]+/)[0]; return n ? n.charAt(0).toUpperCase() + n.slice(1) : "there"; }

  /* ---------- fetch patch: attach the session token (+ desktop keys) to backend calls ---------- */
  function ollamaCfg() { try { return JSON.parse(localStorage.getItem("volt_ollama") || "{}"); } catch (e) { return {}; } }
  // Volt Brain beacon — record what the user does with generated content. Fire-and-forget,
  // never blocks or errors a user action. Goes through the patched fetch (adds the Bearer).
  window.voltEvent = function (contentId, event, detail) {
    try {
      fetch("https://tshephos-lab.vercel.app/api/brain", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "event", contentId: contentId || null, event: event, detail: detail || {} }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  };
  /* ---------- crash reporting: a break for ANY user is visible to us, not just the one who hits it.
     Fire-and-forget, deduped, capped — never interferes with the page. ---------- */
  (function () {
    var sent = {}, count = 0, MAX = 8;
    function report(kind, msg, extra) {
      try {
        msg = String(msg || "").slice(0, 300);
        if (!msg || count >= MAX) return;
        var key = kind + "|" + msg;
        if (sent[key]) return;
        sent[key] = 1; count++;
        var page = (location.pathname.split("/").pop() || "index.html");
        fetch("https://tshephos-lab.vercel.app/api/brain", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "event", contentId: null, event: "client_error",
            detail: Object.assign({ kind: kind, message: msg, page: page, ua: navigator.userAgent.slice(0, 120) }, extra || {}) }),
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    }
    window.addEventListener("error", function (e) {
      report("error", e && e.message, { src: e && e.filename ? String(e.filename).split("/").pop() : "", line: e && e.lineno });
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      report("unhandledrejection", r && (r.message || r), {});
    });
    window.voltReportError = report;
  })();

  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
    // Local AI: when enabled on desktop, run Copy/Email generation on the user's Ollama.
    // Server builds the prompt + parses the result; only the LLM call runs locally (free).
    // Returns a Promise<Response> or null (null = use the normal cloud path).
    var runOllama = function (input, init, body, cfg) {
      return _fetch(input, Object.assign({}, init, { body: JSON.stringify(Object.assign({}, body, { mode: "build" })) }))
        .then(function (br) { if (!br.ok) return br; return br.json().then(function (built) {
          return window.voltNative.ollama({ url: cfg.url, model: cfg.model || "llama3.1", system: built.system, prompt: built.prompt, temperature: built.temperature })
            .then(function (out) {
              if (!out || !out.ok) return _fetch(input, init); // graceful fallback to cloud
              return _fetch(input, Object.assign({}, init, { body: JSON.stringify({ task: body.task, mode: "parse", raw: out.text }) }));
            });
        }); })
        .catch(function () { return _fetch(input, init); });
    };
    var maybeOllama = function (url, input, init) {
      if (!isDesktop() || !(window.voltNative && typeof window.voltNative.ollama === "function")) return null;
      var cfg = ollamaCfg(); if (!cfg.on) return null;
      if (!/\/api\/generate\b/.test(url)) return null;
      var bodyStr = (init && typeof init.body === "string") ? init.body : null; if (!bodyStr) return null;
      var body; try { body = JSON.parse(bodyStr); } catch (e) { return null; }
      var task = (body && body.task) || "copy";
      if (task !== "copy" && task !== "email") return null; // v1: only these run locally
      return runOllama(input, init, body, cfg);
    };
    // Every page on this codebase hardcodes its API calls as an ABSOLUTE
    // "https://tshephos-lab.vercel.app/api/..." URL rather than a relative "/api/...". That's
    // deliberate, not an oversight — the desktop app serves these same pages from a local
    // 127.0.0.1 server (see webSecurity's own comment elsewhere), where a relative path would hit
    // the wrong origin entirely. So a brand-aware deployment can't fix this by editing 15 files'
    // worth of URL constants to be relative; it has to rewrite the HOST at the one place every one
    // of those calls already passes through on its way out. A no-op for Volt (its apiHost equals
    // the literal already baked into every page) and for desktop (never Vantly's hostname).
    var API_REWRITE_FROM = BRANDS.volt.apiHost;
    var API_REWRITE_TO = (BRAND !== BRANDS.volt && BRAND.apiHost) ? BRAND.apiHost : null;
    function rewriteApiHost(input) {
      if (!API_REWRITE_TO) return input;
      if (typeof input === "string" && input.indexOf(API_REWRITE_FROM) === 0) {
        return API_REWRITE_TO + input.slice(API_REWRITE_FROM.length);
      }
      if (input && typeof input === "object" && typeof input.url === "string" && input.url.indexOf(API_REWRITE_FROM) === 0) {
        return new Request(API_REWRITE_TO + input.url.slice(API_REWRITE_FROM.length), input);
      }
      return input;
    }
    window.fetch = function (input, init) {
      input = rewriteApiHost(input);
      var url = (typeof input === "string") ? input : ((input && input.url) || "");
      if (/\/api\//.test(url)) {
        init = init || {};
        var h = new Headers(init.headers || (typeof input !== "string" && input.headers) || {});
        if (session && session.access_token) h.set("Authorization", "Bearer " + session.access_token);
        if (isDesktop()) {
          h.set("x-client", "desktop");
          var k = getKeys();
          if (k.gemini) h.set("x-gemini-key", String(k.gemini).trim());
          if (k.gemini2) h.set("x-gemini-key-2", String(k.gemini2).trim());
          if (k.groq) h.set("x-groq-key", String(k.groq).trim());
          if (k.cerebras) h.set("x-cerebras-key", String(k.cerebras).trim());
          if (k.openrouter) h.set("x-openrouter-key", String(k.openrouter).trim());
          if (k.mistral) h.set("x-mistral-key", String(k.mistral).trim());
          if (k.openai) h.set("x-openai-key", String(k.openai).trim());
          if (k.postiz) h.set("x-postiz-key", String(k.postiz).trim());
          if (k.postizUrl) h.set("x-postiz-url", String(k.postizUrl).trim());
          if (k.kit) h.set("x-kit-key", String(k.kit).trim());
          if (k.wpUrl) h.set("x-wp-url", String(k.wpUrl).trim());
          if (k.wpUser) h.set("x-wp-user", String(k.wpUser).trim());
          if (k.wpKey) h.set("x-wp-key", String(k.wpKey).trim());
        }
        init.headers = h;
      }
      var oll = maybeOllama(url, input, init);
      if (oll) return oll;
      return _fetch(input, init);
    };
  }

  /* ---------- styles ---------- */
  var CSS = '' +
    '#va-gate,#va-modal,#va-reset,#va-welcome{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(6,7,10,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-modal,#va-reset,#va-welcome{z-index:100001;}' +
    '.va-tips{display:flex;flex-direction:column;gap:14px;margin:2px 0 6px;}' +
    '.va-tip{display:flex;gap:13px;align-items:flex-start;}' +
    '.va-tip-i{width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:10px;background:#0D0F15;border:1px solid rgba(255,255,255,.1);color:#B6FF3D;font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;}' +
    '.va-tip-h{font-weight:700;font-size:14.5px;color:#ECEEF3;}' +
    '.va-tip-s{font-size:12.5px;color:#888F9D;line-height:1.45;}' +
    '.va-forgot{display:block;width:100%;margin-top:12px;background:none;border:none;color:#7FC8FF;font-family:"JetBrains Mono",monospace;font-size:11.5px;letter-spacing:.03em;cursor:pointer;text-align:center;}' +
    '.va-forgot:hover{color:#B6FF3D;text-decoration:underline;}' +
    '.va-card{width:100%;max-width:430px;background:linear-gradient(180deg,#14171F,#0f1218);border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:30px;box-shadow:0 30px 80px -30px rgba(0,0,0,.9);color:#ECEEF3;}' +
    '.va-logo{font-family:"Unbounded","Plus Jakarta Sans",sans-serif;font-weight:800;font-size:32px;letter-spacing:-.02em;margin:0;}.va-logo .d{color:#B6FF3D;}' +
    '.va-sub{color:#888F9D;font-size:14px;margin:6px 0 20px;line-height:1.5;}' +
    '.va-lbl{display:block;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888F9D;font-weight:700;margin:14px 0 6px;}' +
    '.va-input{width:100%;box-sizing:border-box;background:#0D0F15;border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:12px 13px;color:#ECEEF3;font-family:inherit;font-size:14.5px;outline:none;transition:border-color .15s;}' +
    '.va-input:focus{border-color:#B6FF3D;}' +
    '.va-row{display:flex;gap:10px;margin-top:18px;}' +
    '.va-btn{flex:1;font-family:inherit;font-weight:800;font-size:14.5px;border:none;border-radius:11px;padding:13px;cursor:pointer;transition:transform .1s,opacity .15s;}' +
    '.va-btn:active{transform:translateY(1px);}.va-btn:disabled{opacity:.5;cursor:not-allowed;}' +
    '.va-primary{background:#B6FF3D;color:#0A0B0F;}.va-ghost{background:transparent;border:1px solid rgba(255,255,255,.14);color:#ECEEF3;}' +
    '.va-ghost:hover{border-color:#FF7C7C;color:#FF7C7C;}' +
    '.va-err{color:#FF7C7C;font-size:12.5px;margin-top:12px;min-height:14px;}' +
    '.va-foot{text-align:center;color:#4f5562;font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.05em;margin:18px 0 0;}' +
    '.va-keys{margin-top:20px;border-top:1px solid rgba(255,255,255,.09);padding-top:16px;}.va-keys-h{font-weight:800;font-size:14px;margin:0 0 4px;}.va-keys-note{color:#5B616D;font-size:12px;line-height:1.5;margin:0 0 14px;}' +
    '.va-field{margin-bottom:13px;}.va-field .nm{font-weight:700;font-size:13.5px;color:#ECEEF3;}.va-field .pw{font-size:11px;color:#5B616D;font-weight:400;}.va-get{font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;color:#B6FF3D;text-decoration:none;float:right;}' +
    '.va-saved{color:#57E39A;font-size:12.5px;margin-top:10px;min-height:14px;text-align:center;}' +
    '#va-badge{position:fixed;top:14px;right:16px;z-index:90000;display:flex;align-items:center;gap:8px;background:rgba(20,23,31,.85);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.12);border-radius:100px;padding:5px 6px 5px 13px;font-family:"Plus Jakarta Sans",sans-serif;}' +
    '#va-badge .who{font-size:12.5px;font-weight:700;color:#ECEEF3;}' +
    '#va-refresh,#va-gear{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#0D0F15;color:#B6FF3D;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .18s;}' +
    '#va-refresh:hover{background:#B6FF3D;color:#0A0B0F;transform:rotate(90deg);}#va-gear:hover{background:#B6FF3D;color:#0A0B0F;}' +
    '#va-toast{position:fixed;top:58px;right:16px;z-index:99999;background:#14171F;border:1px solid rgba(182,255,61,.4);color:#ECEEF3;font-family:"Plus Jakarta Sans",sans-serif;font-size:13px;font-weight:700;padding:10px 14px;border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.7);opacity:0;transition:opacity .2s;}#va-toast.show{opacity:1;}' +
    // ---- Volt left rail — the app's only navigation surface. Collapsed it is 72px of icons;
    // hovering expands it to 232px AS AN OVERLAY (position:fixed, so the page never reflows),
    // revealing group headers and full labels. Two real problems drove this shape:
    //   1. HEIGHT. The old 50px labelled tiles + 4 footer tiles needed 928px of vertical space.
    //      A 1366x768 laptop has ~660px, so ~5 modules sat below the fold — and because the
    //      scrollbar was hidden (width:0) nothing on screen hinted they existed. Now ~570px.
    //   2. SCENT. 11 modules in one flat column said nothing about which tool did what; they are
    //      now grouped Create / Design / Video / Publish / Measure.
    // Guide, Settings and Check-for-updates moved into the account menu, where people look for
    // them anyway — that is what bought the height back without hiding any module.
    'body{padding-left:72px !important;}' +
    '.topbar,.nav-tabs,#va-badge{display:none !important;}' +
    '#va-rail{position:fixed;left:0;top:0;bottom:0;width:72px;z-index:90000;background:linear-gradient(180deg,#0e1016,#0a0b0f);border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;padding:12px 10px 10px;overflow-y:auto;overflow-x:hidden;transition:width .18s cubic-bezier(.2,.7,.2,1);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-rail:hover{width:232px;box-shadow:24px 0 60px -30px rgba(0,0,0,.9);}' +
    '#va-rail::-webkit-scrollbar{width:0;}' +
    '#va-rail .r-logo{display:flex;align-items:center;gap:10px;height:32px;padding:0 7px;margin-bottom:8px;text-decoration:none;flex:none;overflow:hidden;}' +
    '#va-rail .r-logo .m{width:30px;height:30px;flex:none;border-radius:9px;background:#B6FF3D;color:#0A0B0F;display:grid;place-items:center;font-family:"Unbounded",system-ui;font-weight:800;font-size:16px;}' +
    '#va-rail .r-logo .lb{font-family:"Unbounded",system-ui;font-weight:800;font-size:16px;color:#ECEEF3;white-space:nowrap;opacity:0;transition:opacity .14s;}' +
    '#va-rail:hover .r-logo .lb{opacity:1;}' +
    '.r-grp{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#4E5563;padding:0 9px;white-space:nowrap;opacity:0;height:0;overflow:hidden;transition:opacity .14s;flex:none;}' +
    '#va-rail:hover .r-grp{opacity:1;height:22px;line-height:26px;}' +
    '.r-gap{height:8px;flex:none;}#va-rail:hover .r-gap{height:2px;}' +
    '.r-tile{position:relative;display:flex;align-items:center;gap:12px;height:36px;padding:0 9px;border-radius:10px;color:#8C93A2;cursor:pointer;text-decoration:none;flex:none;transition:background .13s,color .13s;}' +
    '.r-tile .ic{width:20px;height:20px;flex:none;display:block;}.r-tile .ic svg{width:20px;height:20px;display:block;}' +
    '.r-tile .lb{font-size:13.5px;font-weight:600;white-space:nowrap;opacity:0;transition:opacity .14s;}' +
    '.r-tile .lb em{font-style:normal;font-weight:400;color:#5B616D;}' +
    '#va-rail:hover .r-tile .lb{opacity:1;}' +
    '.r-tile:hover{background:rgba(255,255,255,.06);color:#ECEEF3;}' +
    '.r-tile.on{background:rgba(182,255,61,.13);color:#B6FF3D;}' +
    '.r-tile.on::before{content:"";position:absolute;left:-10px;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:#B6FF3D;}' +
    '#va-rail .r-spacer{flex:1;min-height:6px;}' +
    '#va-rail .r-av{display:flex;align-items:center;gap:11px;height:40px;padding:0 6px;border-radius:10px;cursor:pointer;flex:none;}' +
    '#va-rail .r-av:hover{background:rgba(255,255,255,.06);}' +
    '#va-rail .r-av .cir{width:30px;height:30px;flex:none;border-radius:50%;background:linear-gradient(135deg,#B6FF3D,#57E39A);color:#0A0B0F;display:grid;place-items:center;font-weight:800;font-size:12.5px;font-family:"Unbounded",sans-serif;}' +
    '#va-rail .r-av .lb{font-size:12.5px;font-weight:600;color:#B9BFCB;white-space:nowrap;opacity:0;transition:opacity .14s;}' +
    '#va-rail:hover .r-av .lb{opacity:1;}' +
    // The account menu is appended to BODY, not into the rail: the rail is a scrolling box, and a
    // popover nested inside one gets clipped by its own overflow.
    '#va-pop{position:fixed;left:8px;z-index:90001;width:212px;background:#161A22;border:1px solid rgba(255,255,255,.13);border-radius:13px;padding:6px;box-shadow:0 20px 50px -14px rgba(0,0,0,.85);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-pop .em{font-size:11px;color:#5B616D;padding:5px 10px 7px;font-family:"JetBrains Mono",monospace;overflow:hidden;text-overflow:ellipsis;}' +
    '#va-pop a,#va-pop button{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 10px;border-radius:9px;color:#C3C9D4;font-size:13px;font-weight:600;text-decoration:none;background:none;border:none;cursor:pointer;font-family:inherit;text-align:left;}' +
    '#va-pop a svg,#va-pop button svg{width:17px;height:17px;flex:none;}' +
    '#va-pop a:hover,#va-pop button:hover{background:rgba(255,255,255,.07);color:#ECEEF3;}' +
    '#va-pop .sep{height:1px;background:rgba(255,255,255,.09);margin:5px 4px;}' +
    '@media(max-width:640px){body{padding-left:0 !important;padding-bottom:62px !important;}#va-rail{flex-direction:row;align-items:center;top:auto;bottom:0;width:100% !important;height:62px;padding:0 6px;border-right:none;border-top:1px solid rgba(255,255,255,.08);overflow-x:auto;overflow-y:hidden;box-shadow:none !important;}#va-rail .r-logo,#va-rail .r-spacer,.r-grp,.r-gap{display:none !important;}.r-tile{height:48px;min-width:54px;justify-content:center;padding:0 10px;}.r-tile .lb,#va-rail .r-av .lb{display:none;}.r-tile.on::before{left:8px;right:8px;top:auto;bottom:2px;width:auto;height:3px;border-radius:3px 3px 0 0;}#va-pop{left:8px;right:8px;width:auto;}}';

  function injectCSS() { if (document.getElementById("va-style")) return; var st = document.createElement("style"); st.id = "va-style"; st.textContent = CSS; document.head.appendChild(st); }

  // The one page-chrome detail volt-auth.js doesn't itself draw: each page's own <title>Volt —
  // X</title>. Rewriting it here (rather than editing every page's <head>) keeps this file the
  // single place a new brand gets wired up. Zero-op for Volt — every page's title already reads
  // "Volt — X", so the replace is a no-op string-for-itself swap, and the early return skips it
  // entirely anyway. BRAND.favicon is blank for both brands today (no icon asset made yet for
  // either); the hook is wired and ready for whenever one is supplied.
  function applyBrandChrome() {
    if (BRAND === BRANDS.volt) return;
    try {
      if (document.title && /^Volt\b/.test(document.title)) document.title = document.title.replace(/^Volt\b/, BRAND.name);
    } catch (e) {}
    if (BRAND.favicon) {
      try {
        var link = document.querySelector('link[rel="icon"]') || document.createElement("link");
        link.rel = "icon"; link.href = BRAND.favicon;
        if (!link.parentNode) document.head.appendChild(link);
      } catch (e) {}
    }
  }

  /* ---------- sign-in gate ---------- */
  function showGate(errMsg) {
    injectCSS();
    if (errMsg === "SETUP_INCOMPLETE") errMsg = BRAND.name + " isn’t fully set up yet — its Supabase project hasn’t been connected. Expected before launch, not a bug.";
    document.documentElement.style.overflow = "hidden";
    var g = document.getElementById("va-gate");
    if (!g) {
      g = document.createElement("div"); g.id = "va-gate";
      g.innerHTML =
        '<div class="va-card">' +
          '<p class="va-logo">' + esc(BRAND.wordmark.replace(/\.$/, "")) + (BRAND.wordmark.slice(-1) === "." ? '<span class="d">.</span>' : "") + '</p>' +
          '<p class="va-sub">' + esc(BRAND.tagline) + ' Sign in, or create an account to continue.</p>' +
          '<label class="va-lbl" for="va-email">Email</label>' +
          '<input class="va-input" id="va-email" type="email" autocomplete="username" placeholder="' + esc(BRAND.emailPlaceholder) + '" />' +
          '<label class="va-lbl" for="va-pw">Password</label>' +
          '<input class="va-input" id="va-pw" type="password" autocomplete="current-password" placeholder="6+ characters" />' +
          '<div class="va-err" id="va-err"></div>' +
          '<div class="va-row"><button class="va-btn va-primary" id="va-in">Sign in</button><button class="va-btn va-ghost" id="va-up">Create account</button></div>' +
          '<button class="va-forgot" id="va-forgot">Forgot password?</button>' +
          '<p class="va-foot">' + (BRAND === BRANDS.volt ? "For SME South Africa internal use." : "Powered by " + esc(BRAND.name) + ".") + '</p>' +
        '</div>';
      document.body.appendChild(g);
      var email = document.getElementById("va-email"), pw = document.getElementById("va-pw"), err = document.getElementById("va-err");
      var inB = document.getElementById("va-in"), upB = document.getElementById("va-up");
      function busy(on) { inB.disabled = on; upB.disabled = on; }
      function fail(m) { err.textContent = m || ""; busy(false); }
      inB.addEventListener("click", function () {
        if (!sb) return; busy(true); err.textContent = "Signing in…";
        sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value })
          .then(function (r) { if (r.error) fail(r.error.message); }).catch(function (e) { fail(e.message); });
      });
      upB.addEventListener("click", function () {
        if (!sb) return;
        // A handful of individually-named personal addresses get their own private workspace (see
        // ALLOWED_EMAIL_EXTRA in api/_guard.js, which is the real enforcement — this is just the
        // matching client-side message so sign-up doesn't reject an address the server would accept).
        // Volt-only: Vantly is a commercial product open to any email, so this pre-flight check (a
        // nicer message, not the real gate — that's ALLOWED_EMAIL_DOMAIN server-side) only applies
        // to Volt's own domain-restricted internal deployment.
        if (BRAND === BRANDS.volt) {
          var EXTRA_ALLOWED = ["joelbosega@gmail.com"];
          var typed = email.value.trim().toLowerCase();
          if (!/@smesouthafrica\.co\.za$/i.test(typed) && EXTRA_ALLOWED.indexOf(typed) === -1) { fail("Please use your @smesouthafrica.co.za work email."); return; }
        }
        busy(true); err.textContent = "Creating account…";
        sb.auth.signUp({ email: email.value.trim(), password: pw.value })
          .then(function (r) { if (r.error) fail(r.error.message); else if (!r.data.session) fail("Account made — now click Sign in."); })
          .catch(function (e) { fail(e.message); });
      });
      pw.addEventListener("keydown", function (e) { if (e.key === "Enter") inB.click(); });
      var fgB = document.getElementById("va-forgot");
      fgB.addEventListener("click", function () {
        if (!sb) return;
        var em = email.value.trim();
        if (!em) { fail("Type your email above first, then tap Forgot password."); email.focus(); return; }
        busy(true); err.style.color = ""; err.textContent = "Sending reset link…";
        sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname })
          .then(function (r) {
            busy(false);
            if (r.error) { err.style.color = "#FF7C7C"; err.textContent = r.error.message; }
            else { err.style.color = "#57E39A"; err.textContent = "Check " + em + " for a reset link (check spam too)."; }
          })
          .catch(function (e) { fail(e.message); });
      });
      setTimeout(function () { email.focus(); }, 50);
    }
    if (errMsg) { var el = document.getElementById("va-err"); if (el) el.textContent = errMsg; }
  }

  /* ---------- set a new password (arrives here from the recovery email link) ---------- */
  function showReset() {
    injectCSS();
    var g = document.getElementById("va-gate"); if (g) g.remove();
    if (document.getElementById("va-reset")) return;
    document.documentElement.style.overflow = "hidden";
    var m = document.createElement("div"); m.id = "va-reset";
    m.innerHTML =
      '<div class="va-card">' +
        '<p class="va-logo">' + esc(BRAND.wordmark.replace(/\.$/, "")) + (BRAND.wordmark.slice(-1) === "." ? '<span class="d">.</span>' : "") + '</p>' +
        '<p class="va-sub">Set a new password for your account.</p>' +
        '<label class="va-lbl" for="va-newpw">New password</label>' +
        '<input class="va-input" id="va-newpw" type="password" autocomplete="new-password" placeholder="6+ characters" />' +
        '<div class="va-err" id="va-rerr"></div>' +
        '<div class="va-row"><button class="va-btn va-primary" id="va-setpw">Update password</button></div>' +
      '</div>';
    document.body.appendChild(m);
    var np = document.getElementById("va-newpw"), rerr = document.getElementById("va-rerr"), setB = document.getElementById("va-setpw");
    setB.addEventListener("click", function () {
      var p = np.value || "";
      if (p.length < 6) { rerr.style.color = "#FF7C7C"; rerr.textContent = "Use at least 6 characters."; return; }
      setB.disabled = true; rerr.style.color = ""; rerr.textContent = "Updating…";
      sb.auth.updateUser({ password: p }).then(function (r) {
        if (r.error) { setB.disabled = false; rerr.style.color = "#FF7C7C"; rerr.textContent = r.error.message; return; }
        try { history.replaceState(null, "", location.pathname); } catch (e) {}
        m.remove(); showToast("✓ Password updated — you're in."); showApp();
      }).catch(function (e) { setB.disabled = false; rerr.style.color = "#FF7C7C"; rerr.textContent = e.message; });
    });
    np.addEventListener("keydown", function (e) { if (e.key === "Enter") setB.click(); });
    setTimeout(function () { np.focus(); }, 50);
  }

  /* ---------- left rail + account menu ---------- */
  // Inline SVG, not emoji: emoji render at different weights/colours per OS and font, so the rail
  // looked like a different product on every machine. These inherit currentColor, so the active
  // and hover states actually apply to the icon.
  var RAIL_ICON = {
    search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="M15.8 15.8l4.4 4.4"/>',
    create:'<path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>',
    copy:'<path d="M14.5 4.5l5 5M4 20l1-4.2L15.6 5.2a1.7 1.7 0 012.4 0l.8.8a1.7 1.7 0 010 2.4L8.2 19 4 20z"/>',
    campaign:'<path d="M13 2.5L4.5 13.2h6.2L10 21.5l8.9-11H12z"/>',
    studio:'<path d="M12 2.8l8.5 4.6L12 12 3.5 7.4z"/><path d="M3.5 12L12 16.6 20.5 12M3.5 16.4L12 21l8.5-4.6"/>',
    freeform:'<path d="M9.5 14.5c-1.6.6-2 2.4-2.6 3.6-.5.9-1.3 1.2-2.4 1.3.9-.6 1-1.6 1.4-2.5.5-1.3 1.4-2.6 3.1-2.9z"/><path d="M11 13.2L19.4 4.8a1.9 1.9 0 012.7 2.7l-8.4 8.4"/>',
    video:'<rect x="2.8" y="5.2" width="18.4" height="13.6" rx="2.4"/><path d="M10 9.6l4.8 2.7-4.8 2.7z"/>',
    smartclip:'<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
    transcribe:'<rect x="3.5" y="3" width="17" height="18" rx="2.3"/><path d="M7.5 8.5h9M7.5 12.5h9M7.5 16.5h5"/>',
    email:'<rect x="2.6" y="4.8" width="18.8" height="14.4" rx="2.3"/><path d="M3.4 6.6l8.6 6 8.6-6"/>',
    schedule:'<rect x="3.2" y="5" width="17.6" height="16" rx="2.3"/><path d="M3.2 10h17.6M8.5 3v4M15.5 3v4"/>',
    stats:'<path d="M3.5 20.5h17"/><path d="M6.8 20.5v-6.2M11.6 20.5V7.4M16.4 20.5v-9.4"/>',
    guide:'<path d="M4 5.2A2.2 2.2 0 016.2 3H19v15.6H6.2A2.2 2.2 0 004 20.8z"/><path d="M4 18.6h15"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.1 14.9a1.5 1.5 0 00.3 1.7l.1.1a1.9 1.9 0 11-2.7 2.7l-.1-.1a1.5 1.5 0 00-2.6 1.1v.2a1.9 1.9 0 01-3.8 0v-.1a1.5 1.5 0 00-2.6-1.1l-.1.1a1.9 1.9 0 11-2.7-2.7l.1-.1a1.5 1.5 0 00-1.1-2.6H3.8a1.9 1.9 0 010-3.8h.1a1.5 1.5 0 001.1-2.6l-.1-.1a1.9 1.9 0 112.7-2.7l.1.1a1.5 1.5 0 002.6-1.1V3.8a1.9 1.9 0 013.8 0v.1a1.5 1.5 0 002.6 1.1l.1-.1a1.9 1.9 0 112.7 2.7l-.1.1a1.5 1.5 0 001.1 2.6h.2a1.9 1.9 0 010 3.8h-.1a1.5 1.5 0 00-1.4.8z"/>',
    refresh:'<path d="M20.4 12a8.4 8.4 0 11-2.5-6"/><path d="M20.5 4.3v5.1h-5.1"/>',
    exit:'<path d="M9.5 20.5H5.2A2.2 2.2 0 013 18.3V5.7a2.2 2.2 0 012.2-2.2h4.3"/><path d="M16 16.5l4.5-4.5L16 7.5M20.5 12H9.5"/>'
  };
  function railSvg(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (RAIL_ICON[k] || "") + '</svg>';
  }
  // GROUPED, but note the name. build-sync.cjs regexes for this exact declaration and fails the
  // build if a routable page's href is missing from inside it, so: keep the variable named
  // RAIL_TILES, keep every href a literal here, and do NOT repeat that declaration's opening
  // text anywhere above this line — the guard's match is non-greedy, so an earlier copy of it
  // (in a comment, say) captures a few characters instead of this array and the check silently
  // passes for every page. That exact mistake was made and caught while writing this rail.
  var RAIL_TILES = [
    { h: "Create",  items: [ { t: "Create", i: "create", href: "home.html" }, { t: "Copy", i: "copy", href: "index.html" }, { t: "Campaign", i: "campaign", href: "campaign.html" } ] },
    { h: "Design",  items: [ { t: "Studio", i: "studio", href: "studio.html" }, { t: "Freeform", i: "freeform", href: "freeform.html" } ] },
    { h: "Video",   items: [ { t: "Video", i: "video", href: "video.html" }, { t: "SmartClip", i: "smartclip", href: "smartclip.html" }, { t: "Transcribe", i: "transcribe", href: "videotok.html" } ] },
    { h: "Publish", items: [ { t: "Email", i: "email", href: "email.html" }, { t: "Schedule", i: "schedule", href: "schedule.html" } ] },
    { h: "Measure", items: [ { t: "Stats", i: "stats", href: "analytics.html" } ] }
  ];
  function closeRailPop() { var p = document.getElementById("va-pop"); if (p) p.remove(); }
  function toggleRailPop(anchor) {
    if (document.getElementById("va-pop")) { closeRailPop(); return; }
    var mail = (session && session.user && session.user.email) || "";
    var p = document.createElement("div"); p.id = "va-pop";
    p.innerHTML =
      '<div class="em">' + esc(mail) + "</div>" +
      '<a href="guide.html">' + railSvg("guide") + "Guide</a>" +
      '<button type="button" id="vp-set">' + railSvg("gear") + "Settings</button>" +
      '<button type="button" id="vp-upd">' + railSvg("refresh") + "Check for updates</button>" +
      '<div class="sep"></div>' +
      '<button type="button" id="vp-out">' + railSvg("exit") + "Sign out</button>";
    document.body.appendChild(p);
    // Anchor above the avatar, but never off the top of a short window.
    var r = anchor.getBoundingClientRect(), h = p.offsetHeight;
    p.style.top = Math.max(8, Math.min(r.top - h - 6, window.innerHeight - h - 8)) + "px";
    var b = function (id) { return document.getElementById(id); };
    if (b("vp-set")) b("vp-set").addEventListener("click", function () { closeRailPop(); showSettings(); });
    if (b("vp-upd")) b("vp-upd").addEventListener("click", function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); });
    if (b("vp-out")) b("vp-out").addEventListener("click", function () { closeRailPop(); if (sb) sb.auth.signOut(); });
    setTimeout(function () {
      document.addEventListener("mousedown", function onDoc(e) {
        var pop = document.getElementById("va-pop");
        if (!pop) { document.removeEventListener("mousedown", onDoc); return; }
        if (!pop.contains(e.target) && !anchor.contains(e.target)) { closeRailPop(); document.removeEventListener("mousedown", onDoc); }
      });
    }, 0);
  }
  function showBadge() { // builds the left rail — the app's only navigation surface
    injectCSS();
    var old = document.getElementById("va-rail"); if (old) old.remove();
    closeRailPop();
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (here === "") here = "index.html";
    var kbd = isMac() ? "⌘K" : "Ctrl K";
    var rail = document.createElement("aside"); rail.id = "va-rail";
    var html =
      '<a class="r-logo" href="home.html" title="' + esc(BRAND.name) + '"><span class="m">' + esc(BRAND.mark) + '</span><span class="lb">' + esc(BRAND.wordmark) + '</span></a>' +
      '<div class="r-tile" id="r-cmdk" title="Command menu (' + kbd + ')"><span class="ic">' + railSvg("search") + '</span><span class="lb">Search <em>' + kbd + "</em></span></div>";
    RAIL_TILES.forEach(function (g) {
      html += '<div class="r-gap"></div><div class="r-grp">' + g.h + "</div>";
      g.items.forEach(function (x) {
        html += '<a class="r-tile' + (x.href.toLowerCase() === here ? " on" : "") + '" href="' + x.href + '" title="' + x.t + '"><span class="ic">' + railSvg(x.i) + '</span><span class="lb">' + x.t + "</span></a>";
      });
    });
    var who = firstName(session && session.user && session.user.email) || "Account";
    html += '<div class="r-spacer"></div>' +
      '<div class="r-av" id="r-av" title="Account"><span class="cir">' + esc(who.charAt(0).toUpperCase()) + '</span><span class="lb">' + esc(who) + "</span></div>";
    rail.innerHTML = html;
    document.body.appendChild(rail);
    var byId = function (id) { return document.getElementById(id); };
    if (byId("r-av")) byId("r-av").addEventListener("click", function (e) { e.stopPropagation(); toggleRailPop(byId("r-av")); });
    if (byId("r-cmdk")) byId("r-cmdk").addEventListener("click", function () { if (window.voltOpenCommand) window.voltOpenCommand(); });
  }
  function showToast(msg) {
    injectCSS();
    var t = document.createElement("div"); t.id = "va-toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 30);
    setTimeout(function () { t.classList.remove("show"); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  /* ---------- desktop update notifier (WP-plugin style) ---------- */
  var VERSION_URL = "https://tshephos-lab.vercel.app/version.json";
  function cmpVer(a, b) { // -1 a<b, 0 equal, 1 a>b (major.minor.patch)
    var pa = String(a || "0").split("."), pb = String(b || "0").split(".");
    for (var i = 0; i < 3; i++) { var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0; if (x > y) return 1; if (x < y) return -1; }
    return 0;
  }
  function maybeUpdateCheck() {
    // Only the desktop shell needs manual updating — web pages are always live from Vercel.
    if (!isDesktop() || typeof window.voltNative.getVersion !== "function") return;
    var cur = null;
    Promise.resolve(window.voltNative.getVersion())
      .then(function (v) { cur = v; return fetch(VERSION_URL + "?ts=" + Date.now(), { cache: "no-store" }); })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !cur || !info.desktopVersion) return;
        if (cmpVer(info.desktopVersion, cur) <= 0) return; // already current
        var dis = null; try { dis = localStorage.getItem("volt_update_dismissed"); } catch (e) {}
        if (dis === info.desktopVersion) return; // user chose "Later" for this exact version
        showUpdateBanner(cur, info.desktopVersion, info.download || "", info.notes || "");
      })
      .catch(function () {});
  }
  function showUpdateBanner(cur, latest, url, notes) {
    if (document.getElementById("va-update-bar")) return;
    if (!document.getElementById("va-ub-style")) {
      var st = document.createElement("style"); st.id = "va-ub-style";
      st.textContent =
        "#va-update-bar{position:fixed;top:0;left:72px;right:0;z-index:9998;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;background:linear-gradient(90deg,#1A1E28,#14171F);border-bottom:1px solid var(--border-2,rgba(255,255,255,.14));font-family:var(--fb,system-ui);font-size:13px;color:var(--text,#ECEEF3)}" +
        "body.va-has-update{padding-top:42px}" +
        "#va-update-bar .va-ub-cur{color:var(--faint,#5B616D)}" +
        "#va-update-bar .va-ub-actions{display:flex;align-items:center;gap:8px;flex:none}" +
        "#va-update-bar .va-ub-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        "#va-update-bar .va-ub-btn{background:var(--accent,#B6FF3D);color:#0A0B0F;text-decoration:none;font-weight:600;padding:5px 12px;border-radius:8px;font-size:12px;white-space:nowrap}" +
        "#va-update-bar .va-ub-x{background:transparent;border:1px solid var(--border-2,rgba(255,255,255,.14));color:var(--dim,#888F9D);padding:5px 10px;border-radius:8px;cursor:pointer;font-size:12px}" +
        "@media(max-width:760px){#va-update-bar{left:0}}";
      document.head.appendChild(st);
    }
    var bar = document.createElement("div"); bar.id = "va-update-bar";
    bar.innerHTML =
      '<span class="va-ub-txt">✨ ' + esc(BRAND.name) + ' <b>' + esc(latest) + "</b> is available" + (notes ? " — " + esc(notes) : "") + ' <span class="va-ub-cur">(you have ' + esc(cur) + ")</span></span>" +
      '<span class="va-ub-actions">' +
        (url ? '<a class="va-ub-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Download update ↗</a>' : "") +
        '<button class="va-ub-x" id="va-ub-x">Later</button>' +
      "</span>";
    document.body.appendChild(bar);
    document.body.classList.add("va-has-update");
    var x = document.getElementById("va-ub-x");
    if (x) x.addEventListener("click", function () { try { localStorage.setItem("volt_update_dismissed", latest); } catch (e) {} bar.remove(); document.body.classList.remove("va-has-update"); });
  }

  /* ---------- content update notifier (for a tab left open across a deploy) ---------- */
  // "Web pages are always live from Vercel" is only true for a page that reloads. A tab left open
  // all day is running whatever JS was current when it loaded — Studio's field registry, a bug
  // fix, anything — and nothing ever told it a newer version had shipped. This polls a timestamp
  // build-sync.cjs stamps on every successful sync and, if it has moved on since THIS tab loaded,
  // offers a one-click refresh. Shares va-update-bar with the desktop shell notifier above so the
  // two can never stack — whichever has something to say fires first and wins.
  var CONTENT_VERSION_URL = "build-version.json";
  var CONTENT_POLL_MS = 4 * 60 * 1000;
  var _contentBuiltAt = null, _contentDismissed = false, _contentPollT = null;
  function maybeContentUpdateCheck() {
    fetch(CONTENT_VERSION_URL + "?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !info.builtAt) return;
        if (_contentBuiltAt == null) { _contentBuiltAt = info.builtAt; return; } // baseline: what THIS tab is running
        if (info.builtAt <= _contentBuiltAt || _contentDismissed) return;
        if (document.getElementById("va-update-bar")) return; // desktop shell notice takes priority
        showContentUpdateBanner();
      })
      .catch(function () {});
  }
  function showContentUpdateBanner() {
    if (document.getElementById("va-update-bar")) return;
    if (!document.getElementById("va-ub-style")) {
      // Same stylesheet the desktop notifier defines (same class names) — write it if this page
      // reaches an update before that one ever has.
      var st = document.createElement("style"); st.id = "va-ub-style";
      st.textContent =
        "#va-update-bar{position:fixed;top:0;left:72px;right:0;z-index:9998;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;background:linear-gradient(90deg,#1A1E28,#14171F);border-bottom:1px solid var(--border-2,rgba(255,255,255,.14));font-family:var(--fb,system-ui);font-size:13px;color:var(--text,#ECEEF3)}" +
        "body.va-has-update{padding-top:42px}" +
        "#va-update-bar .va-ub-cur{color:var(--faint,#5B616D)}" +
        "#va-update-bar .va-ub-actions{display:flex;align-items:center;gap:8px;flex:none}" +
        "#va-update-bar .va-ub-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        "#va-update-bar .va-ub-btn{background:var(--accent,#B6FF3D);color:#0A0B0F;text-decoration:none;font-weight:600;padding:5px 12px;border-radius:8px;font-size:12px;white-space:nowrap;border:none;cursor:pointer;font-family:inherit;}" +
        "#va-update-bar .va-ub-x{background:transparent;border:1px solid var(--border-2,rgba(255,255,255,.14));color:var(--dim,#888F9D);padding:5px 10px;border-radius:8px;cursor:pointer;font-size:12px}" +
        "@media(max-width:760px){#va-update-bar{left:0}}";
      document.head.appendChild(st);
    }
    var bar = document.createElement("div"); bar.id = "va-update-bar";
    bar.innerHTML =
      '<span class="va-ub-txt">✨ ' + esc(BRAND.name) + ' has been updated since you opened this page</span>' +
      '<span class="va-ub-actions">' +
        '<button class="va-ub-btn" id="va-ub-refresh">Refresh now</button>' +
        '<button class="va-ub-x" id="va-ub-x">Later</button>' +
      "</span>";
    document.body.appendChild(bar);
    document.body.classList.add("va-has-update");
    var go = document.getElementById("va-ub-refresh");
    if (go) go.addEventListener("click", function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); });
    var x = document.getElementById("va-ub-x");
    if (x) x.addEventListener("click", function () {
      _contentDismissed = true; // this tab; a reload (or a genuinely newer build later) can ask again
      bar.remove(); document.body.classList.remove("va-has-update");
    });
  }

  /* ---------- Sleep mode (Jarvis-style ambient screen after inactivity) ---------- */
  /* ==================================================================
     SLEEP / STANDBY UI  —  SAFE TO EDIT (visual only)
     Everything between this fence and the "END SLEEP UI" fence is the
     standby screen's look & feel. You (or Gemini) can freely restyle the
     canvas rain, console log, reactor and CSS here WITHOUT touching the
     rest of volt-auth.js. Do NOT rename these functions — they're called
     from init and the Settings > Sleep pane:
        getSleepCfg / setSleepCfg / initSleep / scheduleSleep
        onActivity  / showSleep(force) / hideSleep
     Keep #va-sleep as the root overlay id, and keep the wake behaviour
     (onActivity) intact so the screen dismisses on mouse/key.
     ================================================================== */
  var _sleepT = null, _sleepWired = false, _sleepRainT = null, _sleepLogT = null, _sleepResize = null, _sleepLogI = 0;
  // Fake "brain" telemetry — the lines that scroll in the standby console.
  // Purely cosmetic flavour text; tweak freely. {n}/{p} get random numbers.
  var SLEEP_LOG = [
    "core ▸ booting volt.intelligence …",
    "brain ▸ loading model weights …… ok",
    "brain ▸ analyzing {n} posts",
    "brain ▸ ranking ad angles — {p} candidates",
    "brain ▸ scoring hooks — top {p}%",
    "learn ▸ +{p} signals from live performance",
    "vision ▸ synthesising supporting image …",
    "queue ▸ {p} posts scheduled this week",
    "kit ▸ open-rate model refreshed",
    "stats ▸ recomputing engagement curve",
    "core ▸ all systems nominal — standby"
  ];
  function _sn(a, b) { return Math.floor(a + Math.random() * (b - a)); }
  function getSleepCfg() { try { return JSON.parse(localStorage.getItem("volt_sleep") || "{}"); } catch (e) { return {}; } }
  function setSleepCfg(c) { try { localStorage.setItem("volt_sleep", JSON.stringify(c)); } catch (e) {} }
  function initSleep() {
    if (!_sleepWired) {
      _sleepWired = true;
      ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"].forEach(function (ev) {
        window.addEventListener(ev, onActivity, true);
      });
    }
    scheduleSleep();
  }
  function scheduleSleep() {
    clearTimeout(_sleepT);
    var cfg = getSleepCfg();
    if (!cfg.on) return;
    var ms = Math.max(1, parseInt(cfg.mins, 10) || 5) * 60000;
    _sleepT = setTimeout(showSleep, ms);
  }
  function onActivity() {
    if (document.getElementById("va-sleep")) hideSleep();
    else scheduleSleep();
  }
  // Matrix-style falling code rain, throttled to ~18fps to stay GPU-light.
  function startRain() {
    var cv = document.getElementById("va-sleep-rain"); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var glyphs = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈ0123456789<>[]{}=+*/#$%⚡◇VOLT";
    var fs = 16, cols = 0, drops = [];
    function resize() {
      cv.width = window.innerWidth; cv.height = window.innerHeight;
      cols = Math.ceil(cv.width / fs);
      drops = []; for (var i = 0; i < cols; i++) drops[i] = Math.random() * -60;
    }
    resize(); _sleepResize = resize; window.addEventListener("resize", resize);
    var last = 0;
    function frame(ts) {
      _sleepRainT = requestAnimationFrame(frame);
      if (ts - last < 55) return; last = ts;
      ctx.fillStyle = "rgba(6,7,10,.14)"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.font = "600 " + fs + "px 'JetBrains Mono',monospace";
      for (var i = 0; i < cols; i++) {
        var ch = glyphs.charAt(Math.floor(Math.random() * glyphs.length));
        var x = i * fs, y = drops[i] * fs;
        if (drops[i] > 0 && Math.random() > 0.985) ctx.fillStyle = "rgba(236,238,243,.92)"; // bright lead glyph
        else ctx.fillStyle = "rgba(182,255,61," + (0.22 + Math.random() * 0.5).toFixed(2) + ")";
        ctx.fillText(ch, x, y);
        if (y > cv.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.6;
      }
    }
    _sleepRainT = requestAnimationFrame(frame);
  }
  function stopRain() {
    if (_sleepRainT) { cancelAnimationFrame(_sleepRainT); _sleepRainT = null; }
    if (_sleepResize) { window.removeEventListener("resize", _sleepResize); _sleepResize = null; }
  }
  function pushLog() {
    var box = document.getElementById("va-sleep-log"); if (!box) return;
    var raw = SLEEP_LOG[_sleepLogI % SLEEP_LOG.length]; _sleepLogI++;
    var line = raw.replace(/\{n\}/g, _sn(400, 2400).toLocaleString()).replace(/\{p\}/g, _sn(3, 42));
    var parts = line.split(" ▸ ");
    var html = parts.length > 1 ? '<span class="mut">' + esc(parts[0]) + "</span> ▸ " + esc(parts.slice(1).join(" ▸ ")) : esc(line);
    var d = document.createElement("div"); d.className = "ln"; d.innerHTML = html;
    box.appendChild(d);
    while (box.children.length > 6) box.removeChild(box.firstChild);
  }
  function showSleep(force) {
    var cfg = getSleepCfg(); if ((!cfg.on && force !== true) || document.getElementById("va-sleep")) return;
    if (document.getElementById("vk-ov") && document.getElementById("vk-ov").classList.contains("open")) return; // don't cover the command palette
    if (!document.getElementById("va-sleep-style")) {
      var st = document.createElement("style"); st.id = "va-sleep-style";
      st.textContent =
        "#va-sleep{position:fixed;inset:0;z-index:100010;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:none;opacity:0;transition:opacity .8s ease;overflow:hidden;" +
          "background:radial-gradient(circle at 50% 42%,rgba(8,15,10,.82),rgba(5,6,9,.97) 72%);}" +
        "#va-sleep.on{opacity:1;}" +
        "#va-sleep-rain{position:fixed;inset:0;z-index:0;opacity:.55;}" +
        "#va-sleep .vs-scan{position:fixed;inset:0;z-index:1;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.14) 0 1px,transparent 1px 3px);mix-blend-mode:overlay;animation:vsflick 6s steps(60) infinite;}" +
        "#va-sleep .vs-corner{position:fixed;width:52px;height:52px;z-index:2;border:2px solid rgba(182,255,61,.5);}" +
        "#va-sleep .vs-corner.tl{top:30px;left:30px;border-right:0;border-bottom:0;}#va-sleep .vs-corner.tr{top:30px;right:30px;border-left:0;border-bottom:0;}" +
        "#va-sleep .vs-corner.bl{bottom:30px;left:30px;border-right:0;border-top:0;}#va-sleep .vs-corner.br{bottom:30px;right:30px;border-left:0;border-top:0;}" +
        "#va-sleep .vs-stage{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;}" +
        "#va-sleep .vs-reactor{width:96px;height:96px;filter:drop-shadow(0 0 26px rgba(182,255,61,.5));}" +
        "#va-sleep .ring{fill:none;transform-origin:100px 100px;}" +
        "#va-sleep .r1{stroke:rgba(182,255,61,.55);stroke-width:1.5;stroke-dasharray:6 10;animation:vjspin 9s linear infinite;}" +
        "#va-sleep .r2{stroke:rgba(127,200,255,.6);stroke-width:1.5;stroke-dasharray:2 7;animation:vjspin 5s linear infinite reverse;}" +
        "#va-sleep .r3{stroke:rgba(182,255,61,.7);stroke-width:2;stroke-dasharray:46 14;animation:vjspin 16s linear infinite;}" +
        "#va-sleep .core{fill:rgba(182,255,61,.1);stroke:rgba(182,255,61,.95);stroke-width:2;transform-origin:100px 100px;animation:vjpulse 2s ease-in-out infinite;}" +
        "#va-sleep .vs-word{font-family:var(--fd,'Unbounded',system-ui);font-weight:800;font-size:32px;letter-spacing:4px;color:#fff;margin-top:14px;text-shadow:0 0 30px rgba(182,255,61,.35);animation:vsglitch 5.5s steps(1) infinite;}#va-sleep .vs-word span{color:var(--accent,#B6FF3D);}" +
        "#va-sleep .vs-console{margin-top:24px;width:min(520px,86vw);height:150px;overflow:hidden;border:1px solid rgba(182,255,61,.2);border-radius:12px;background:rgba(9,13,11,.5);padding:13px 16px;font-family:'JetBrains Mono',var(--fm,monospace);font-size:12.5px;line-height:1.68;color:rgba(182,255,61,.82);box-shadow:inset 0 0 44px rgba(182,255,61,.05);display:flex;flex-direction:column;justify-content:flex-end;}" +
        "#va-sleep .vs-console .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85;animation:vsln .45s ease both;}" +
        "#va-sleep .vs-console .ln .mut{color:rgba(127,200,255,.72);}" +
        "#va-sleep .vs-console .prompt{opacity:.9;color:rgba(236,238,243,.85);}" +
        "#va-sleep .vs-console .cur{display:inline-block;width:8px;height:13px;background:var(--accent,#B6FF3D);margin-left:5px;vertical-align:-2px;animation:vscur 1s steps(1) infinite;}" +
        "#va-sleep .vs-standby{font-family:var(--fm,monospace);font-size:11px;letter-spacing:4px;text-transform:uppercase;color:var(--accent,#B6FF3D);margin-top:22px;opacity:.75;animation:vspulse 3s ease-in-out infinite;}" +
        "@keyframes vspulse{0%,100%{opacity:.4;}50%{opacity:.85;}}" +
        "@keyframes vsln{from{opacity:0;transform:translateY(5px);}to{opacity:.85;transform:none;}}" +
        "@keyframes vscur{50%{opacity:0;}}" +
        "@keyframes vsflick{0%,100%{opacity:.5;}48%{opacity:.5;}49%{opacity:.2;}50%{opacity:.7;}51%{opacity:.35;}}" +
        "@keyframes vsglitch{0%,92%,100%{text-shadow:0 0 30px rgba(182,255,61,.35);}93%{text-shadow:-2px 0 rgba(127,200,255,.9),2px 0 rgba(182,255,61,.9);}96%{text-shadow:2px 0 rgba(127,200,255,.9),-2px 0 rgba(182,255,61,.9);}}" +
        "@keyframes vjspin{to{transform:rotate(360deg);}}@keyframes vjpulse{0%,100%{opacity:.6;}50%{opacity:1;}}";
      document.head.appendChild(st);
    }
    var o = document.createElement("div"); o.id = "va-sleep";
    o.innerHTML =
      '<canvas id="va-sleep-rain"></canvas>' +
      '<div class="vs-scan"></div>' +
      '<div class="vs-corner tl"></div><div class="vs-corner tr"></div><div class="vs-corner bl"></div><div class="vs-corner br"></div>' +
      '<div class="vs-stage">' +
        '<svg class="vs-reactor" viewBox="0 0 200 200" aria-hidden="true">' +
          '<circle class="ring r3" cx="100" cy="100" r="86"></circle><circle class="ring r1" cx="100" cy="100" r="68"></circle>' +
          '<circle class="ring r2" cx="100" cy="100" r="50"></circle><circle class="core" cx="100" cy="100" r="30"></circle>' +
          '<circle cx="100" cy="100" r="6" fill="var(--accent,#B6FF3D)"></circle></svg>' +
        '<div class="vs-word">VOLT<span>_</span></div>' +
        '<div class="vs-console"><div id="va-sleep-log"></div>' +
          '<div class="ln prompt"><span class="mut">volt@brain</span>:~<span class="cur"></span></div></div>' +
        '<div class="vs-standby">◇ Standby — move to wake</div>' +
      '</div>';
    document.body.appendChild(o);
    startRain();
    _sleepLogI = 0; pushLog(); pushLog();
    _sleepLogT = setInterval(pushLog, 1600);
    requestAnimationFrame(function () { o.classList.add("on"); });
  }
  function hideSleep() {
    var o = document.getElementById("va-sleep"); if (!o) return;
    stopRain();
    clearInterval(_sleepLogT); _sleepLogT = null;
    o.style.opacity = "0"; setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 800);
  }
  /* ================= END SLEEP UI ================= */

  /* ---------- settings (keys on desktop + sign out) ---------- */
  function keyFieldsHTML() {
    var k = getKeys();
    var out = '<div class="va-keys"><p class="va-keys-h">Your API keys</p><p class="va-keys-note">Studio needs no key. Add as many AI keys as you like — ' + esc(BRAND.name) + ' tries them top-to-bottom and auto-falls-over to the next when one is rate-limited or out of quota. More keys = fewer interruptions.</p>';
    ["gemini", "gemini2", "groq", "cerebras", "openrouter", "mistral", "openai", "postiz", "kit", "wpUrl", "wpUser", "wpKey"].forEach(function (id) {
      var i = KEYS[id];
      var link = i.url ? '<a class="va-get" href="' + i.url + '" target="_blank" rel="noopener">' + (/wordpress|postiz/i.test(i.url) ? "Guide ↗" : "Get key ↗") + '</a>' : "";
      var ph = i.ph || ("Paste your " + i.label + (/wordpress|username/i.test(i.label) ? "" : " key"));
      out += '<div class="va-field"><div><span class="nm">' + i.label + ' <span class="pw">· ' + esc(i.sub) + '</span></span>' + link + '</div>' +
        '<input class="va-input" id="va-k-' + id + '" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(ph) + '" value="' + esc(k[id] || "") + '" style="margin-top:6px;" /></div>';
    });
    out += '<div class="va-field"><span class="nm">Postiz API URL <span class="pw">· blank = cloud</span></span><input class="va-input" id="va-k-postizUrl" type="text" autocomplete="off" placeholder="https://api.postiz.com/public/v1" value="' + esc(k.postizUrl || "") + '" style="margin-top:6px;" /></div></div>';
    return out;
  }
  function ollamaFieldsHTML() {
    var c = ollamaCfg();
    return '<div class="va-keys" style="margin-top:16px;">' +
      '<p class="va-keys-h">Local AI <span style="font-size:11px;color:#57E39A;font-weight:700;letter-spacing:.04em;">FREE · OFFLINE</span></p>' +
      '<p class="va-keys-note">Run Copy &amp; Email on your own machine with <b style="color:#ECEEF3;">Ollama</b> — no API cost, fully private. Install it from ollama.com, run <code style="color:#B6FF3D;">ollama pull llama3.1</code>, then switch this on. If it can’t reach Ollama it quietly falls back to the cloud.</p>' +
      '<label class="va-field" style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input type="checkbox" id="va-oll-on" ' + (c.on ? "checked" : "") + ' style="width:18px;height:18px;accent-color:#B6FF3D;"><span class="nm">Use local AI for Copy &amp; Email</span></label>' +
      '<div class="va-field"><span class="nm">Model</span><input class="va-input" id="va-oll-model" type="text" autocomplete="off" spellcheck="false" placeholder="llama3.1" value="' + esc(c.model || "") + '" style="margin-top:6px;" /></div>' +
      '<div class="va-field"><span class="nm">Ollama URL <span class="pw">· blank = localhost</span></span><input class="va-input" id="va-oll-url" type="text" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:11434" value="' + esc(c.url || "") + '" style="margin-top:6px;" /></div>' +
      '</div>';
  }
  function saveOllama() {
    var on = document.getElementById("va-oll-on"), m = document.getElementById("va-oll-model"), u = document.getElementById("va-oll-url");
    try { localStorage.setItem("volt_ollama", JSON.stringify({ on: !!(on && on.checked), model: (m && m.value.trim()) || "", url: (u && u.value.trim()) || "" })); } catch (e) {}
  }
  /* ---------- plan & usage (Phase C billing) ---------- */
  var BILL_API = "https://tshephos-lab.vercel.app/api/billing";
  function loadBilling() {
    var box = document.getElementById("va-bill");
    if (!box) return;
    box.innerHTML = '<p class="va-keys-note" style="margin:12px 0 2px;">Loading plan…</p>';
    fetch(BILL_API + "?action=usage").then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (o) {
      if (!o.ok) { box.innerHTML = ""; return; }
      var j = o.j;
      // An UNCAPPED plan gets a plain count, not a progress bar. Showing "320 / 150" with a red
      // bar announced a limit that does not exist and cannot be collected on — it read as a
      // warning when the number is only there so you can watch cost.
      var capped = j.limit > 0;
      var pct = capped ? Math.min(100, Math.round((j.used / j.limit) * 100)) : 0;
      var html = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.09);">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888F9D;">Plan &amp; usage</span>' +
        '<span style="font-size:12px;color:#ECEEF3;font-weight:700;">' + esc(j.label) + '</span></div>';
      if (capped) {
        html += '<div style="font-size:12px;color:#888F9D;margin-bottom:6px;">' + j.used + ' / ' + j.limit + ' AI generations this month</div>' +
          '<div style="height:7px;border-radius:99px;background:#1A1E28;overflow:hidden;margin-bottom:8px;"><i style="display:block;height:100%;width:' + pct + '%;background:' + (pct >= 90 ? "#FF7C7C" : "#B6FF3D") + ';"></i></div>';
      } else {
        html += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px;">' +
          '<span style="font-family:\'Unbounded\',system-ui;font-size:26px;font-weight:800;color:#ECEEF3;line-height:1;">' + j.used + '</span>' +
          '<span style="font-size:12px;color:#888F9D;">AI generations this month</span></div>' +
          '<p class="va-keys-note" style="margin:6px 0 0;">No limit — this is here so you can see what you’re using, not to cap you.</p>';
      }
      if (j.billingReady) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">';
        ["starter", "pro"].forEach(function (p) { if (p !== j.plan) html += '<button class="va-btn va-ghost va-up" data-plan="' + p + '" style="flex:1;">Upgrade to ' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>'; });
        html += "</div>";
      } else if (capped && !j.enforced) {
        html += '<p class="va-keys-note" style="margin:2px 0 0;">Usage is tracked; limits aren’t enforced yet.</p>';
      }
      html += '<div id="va-bill-status" style="font-size:12px;color:#7FC8FF;margin-top:8px;"></div></div>';
      box.innerHTML = html;
      [].forEach.call(box.querySelectorAll(".va-up"), function (b) { b.addEventListener("click", function () { upgrade(b.dataset.plan); }); });
    }).catch(function () { box.innerHTML = ""; });
  }
  function upgrade(plan) {
    var st = document.getElementById("va-bill-status");
    if (st) st.textContent = "Starting secure checkout…";
    fetch(BILL_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", plan: plan }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.authorization_url) { window.open(j.authorization_url, "_blank", "noopener"); if (st) st.textContent = "Complete payment in the new tab, then reopen Settings."; }
        else if (st) st.textContent = (j && j.error) || "Could not start checkout.";
      }).catch(function () { if (st) st.textContent = "Network error — try again."; });
  }
  function ensureAcctStyle() {
    if (document.getElementById("va-acct-style")) return;
    var st = document.createElement("style"); st.id = "va-acct-style";
    st.textContent =
      "#va-modal .va-acct{display:flex;width:min(760px,94vw);height:min(560px,88vh);background:var(--surface,#14171F);border:1px solid var(--border-2,rgba(255,255,255,.14));border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55);font-family:var(--fb,system-ui);}" +
      ".va-acct-nav{width:210px;flex:none;background:#0D0F15;border-right:1px solid var(--border,rgba(255,255,255,.09));padding:18px 14px;display:flex;flex-direction:column;gap:4px;}" +
      ".va-acct-me{display:flex;align-items:center;gap:11px;padding:6px 6px 16px;margin-bottom:8px;border-bottom:1px solid var(--border,rgba(255,255,255,.09));}" +
      ".va-acct-av{width:40px;height:40px;flex:none;border-radius:50%;background:linear-gradient(135deg,#B6FF3D,#57E39A);color:#0A0B0F;font-family:var(--fd,system-ui);font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}" +
      ".va-acct-me .nm{font-weight:700;font-size:14px;color:var(--text,#ECEEF3);}.va-acct-me .em{font-size:11px;color:var(--dim,#888F9D);overflow:hidden;text-overflow:ellipsis;max-width:130px;white-space:nowrap;}" +
      ".va-tab{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:0;color:var(--dim,#888F9D);font-family:var(--fb,system-ui);font-size:13.5px;font-weight:600;padding:10px 12px;border-radius:10px;cursor:pointer;transition:all .14s;}" +
      ".va-tab:hover{background:rgba(255,255,255,.05);color:var(--text,#ECEEF3);}" +
      ".va-tab.active{background:rgba(182,255,61,.12);color:var(--accent,#B6FF3D);}" +
      ".va-tab-out{margin-top:auto;color:var(--low,#FF7C7C);}.va-tab-out:hover{background:rgba(255,124,124,.1);color:var(--low,#FF7C7C);}" +
      ".va-acct-body{flex:1;padding:26px 28px;overflow-y:auto;position:relative;}" +
      ".va-acct-x{position:absolute;top:16px;right:18px;background:transparent;border:0;color:var(--dim,#888F9D);font-size:18px;cursor:pointer;line-height:1;}" +
      ".va-acct-x:hover{color:var(--text,#ECEEF3);}" +
      ".va-pane[hidden]{display:none;}" +
      ".va-pane-h{font-family:var(--fd,system-ui);font-weight:800;font-size:20px;color:var(--text,#ECEEF3);margin:0 0 4px;}" +
      ".va-pane-sub{font-size:13px;color:var(--dim,#888F9D);margin:0 0 20px;line-height:1.5;}" +
      ".va-info-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.09));font-size:13.5px;}" +
      ".va-info-row .l{color:var(--dim,#888F9D);}.va-info-row .r{color:var(--text,#ECEEF3);font-weight:600;}" +
      ".va-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;font-size:14px;color:var(--text,#ECEEF3);}" +
      "@media(max-width:640px){#va-modal .va-acct{flex-direction:column;height:min(90vh,760px);}.va-acct-nav{width:auto;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--border,rgba(255,255,255,.09));}.va-tab-out{margin-top:0;}.va-acct-me{width:100%;}}";
    document.head.appendChild(st);
  }
  function acctVal(id) { var el = document.getElementById("va-k-" + id); return el ? el.value.trim() : ""; }
  function sleepPaneHTML() {
    var cfg = getSleepCfg();
    var opts = [1, 2, 5, 10, 15, 30].map(function (n) { return '<option value="' + n + '"' + ((parseInt(cfg.mins, 10) || 5) === n ? " selected" : "") + '>' + n + " minute" + (n > 1 ? "s" : "") + "</option>"; }).join("");
    return '<p class="va-pane-h">🌙 Sleep mode</p>' +
      '<p class="va-pane-sub">When you go idle, ' + esc(BRAND.name) + ' drops into an ambient standby screen — a live clock and glowing reactor, great as a desk display. Any mouse move or key press wakes it instantly.</p>' +
      '<label class="va-toggle-row"><span>Enable sleep mode</span><input type="checkbox" id="va-sleep-on"' + (cfg.on ? " checked" : "") + ' style="width:18px;height:18px;accent-color:#B6FF3D;cursor:pointer;"></label>' +
      '<div class="va-field" style="margin-top:6px;"><span class="nm">Sleep after</span><select class="va-input" id="va-sleep-mins" style="margin-top:6px;cursor:pointer;">' + opts + "</select></div>" +
      '<button class="va-btn va-ghost" id="va-sleep-preview" style="margin-top:14px;">▶ Preview standby screen</button>';
  }
  function accountPaneHTML(email) {
    var org = (session && session.user && (session.user.user_metadata && session.user.user_metadata.org)) || "";
    var appv = (isDesktop() && window.voltNative && window.voltNative.isDesktop) ? "Desktop app" : "Web";
    return '<p class="va-pane-h">👤 Account</p>' +
      '<p class="va-pane-sub">You\'re signed in to ' + esc(BRAND.name) + '. Manage your keys, sleep mode and usage from the tabs on the left.</p>' +
      '<div class="va-info-row"><span class="l">Email</span><span class="r">' + esc(email) + '</span></div>' +
      (org ? '<div class="va-info-row"><span class="l">Organisation</span><span class="r">' + esc(org) + '</span></div>' : "") +
      '<div class="va-info-row"><span class="l">Running on</span><span class="r">' + appv + '</span></div>' +
      '<div style="margin-top:20px;border-top:1px solid var(--border,rgba(255,255,255,.09));padding-top:18px;">' +
        '<button class="va-btn va-ghost" id="va-cp-toggle" style="width:100%;">🔒 Change password</button>' +
        '<div id="va-cp-fields" hidden style="margin-top:12px;">' +
          '<input class="va-input" id="va-cp-new" type="password" placeholder="New password (min 6 characters)" autocomplete="new-password" spellcheck="false" style="margin-bottom:8px;">' +
          '<input class="va-input" id="va-cp-confirm" type="password" placeholder="Confirm new password" autocomplete="new-password" spellcheck="false">' +
          '<button class="va-btn va-primary" id="va-cp-save" style="width:100%;margin-top:10px;">Update password</button>' +
          '<div class="va-saved" id="va-cp-msg" style="margin-top:8px;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="va-row" style="margin-top:22px;"><button class="va-btn va-primary" id="va-signout-2" style="background:var(--low,#FF7C7C);border-color:var(--low,#FF7C7C);color:#0A0B0F;">🚪 Sign out</button></div>';
  }
  function showSettings(initialTab) {
    injectCSS(); ensureAcctStyle();
    if (document.getElementById("va-modal")) return;
    var email = esc(session && session.user && session.user.email || "");
    var initial = ((email.charAt(0) || "V")).toUpperCase();
    var m = document.createElement("div"); m.id = "va-modal";
    m.innerHTML =
      '<div class="va-acct">' +
        '<div class="va-acct-nav">' +
          '<div class="va-acct-me"><div class="va-acct-av">' + initial + '</div><div class="va-acct-meta"><div class="nm">' + (esc(firstName(email)) || "Your account") + '</div><div class="em">' + email + "</div></div></div>" +
          '<button class="va-tab active" data-tab="account">👤 Account</button>' +
          (isDesktop() ? '<button class="va-tab" data-tab="keys">🔑 API Keys</button>' : "") +
          '<button class="va-tab" data-tab="sleep">🌙 Sleep Mode</button>' +
          '<button class="va-tab" data-tab="billing">💳 Usage &amp; Billing</button>' +
          '<button class="va-tab va-tab-out" id="va-signout">🚪 Sign out</button>' +
        "</div>" +
        '<div class="va-acct-body">' +
          '<button class="va-acct-x" id="va-close">✕</button>' +
          '<div class="va-pane" data-pane="account">' + accountPaneHTML(email) + "</div>" +
          (isDesktop() ? '<div class="va-pane" data-pane="keys" hidden><p class="va-pane-h">🔑 API Keys</p>' + keyFieldsHTML() + '<button class="va-btn va-primary" id="va-save" style="width:100%;margin-top:8px;">Save keys</button><div class="va-saved" id="va-saved"></div>' + ollamaFieldsHTML() + "</div>" : "") +
          '<div class="va-pane" data-pane="sleep" hidden>' + sleepPaneHTML() + "</div>" +
          '<div class="va-pane" data-pane="billing" hidden><p class="va-pane-h">💳 Usage &amp; Billing</p><div id="va-bill"></div></div>' +
        "</div>" +
      "</div>";
    document.body.appendChild(m);
    loadBilling();
    // Tab switching.
    function selectTab(name) {
      m.querySelectorAll(".va-tab[data-tab]").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-tab") === name); });
      m.querySelectorAll(".va-pane[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== name; });
    }
    m.querySelectorAll(".va-tab[data-tab]").forEach(function (t) { t.addEventListener("click", function () { selectTab(t.getAttribute("data-tab")); }); });
    if (initialTab) selectTab(initialTab);
    // Keys save + Ollama.
    ["va-oll-on", "va-oll-model", "va-oll-url"].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener("change", saveOllama); });
    var save = document.getElementById("va-save");
    if (save) save.addEventListener("click", function () {
      saveKeys({ gemini: acctVal("gemini"), gemini2: acctVal("gemini2"), groq: acctVal("groq"), cerebras: acctVal("cerebras"), openrouter: acctVal("openrouter"), mistral: acctVal("mistral"), openai: acctVal("openai"), postiz: acctVal("postiz"), postizUrl: acctVal("postizUrl"), kit: acctVal("kit"), wpUrl: acctVal("wpUrl"), wpUser: acctVal("wpUser"), wpKey: acctVal("wpKey") });
      var s = document.getElementById("va-saved"); if (s) { s.textContent = "Saved ✓"; setTimeout(function () { s.textContent = ""; }, 1500); }
    });
    // Sleep controls.
    function saveSleep() { var on = document.getElementById("va-sleep-on"), mn = document.getElementById("va-sleep-mins"); setSleepCfg({ on: !!(on && on.checked), mins: parseInt(mn && mn.value, 10) || 5 }); scheduleSleep(); }
    var so = document.getElementById("va-sleep-on"); if (so) so.addEventListener("change", saveSleep);
    var sm = document.getElementById("va-sleep-mins"); if (sm) sm.addEventListener("change", saveSleep);
    var sp = document.getElementById("va-sleep-preview"); if (sp) sp.addEventListener("click", function () { m.remove(); setTimeout(function () { showSleep(true); }, 120); });
    // Close + sign out.
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.getElementById("va-close").addEventListener("click", function () { m.remove(); });
    function doSignOut() { if (sb) sb.auth.signOut(); m.remove(); }
    document.getElementById("va-signout").addEventListener("click", doSignOut);
    var so2 = document.getElementById("va-signout-2"); if (so2) so2.addEventListener("click", doSignOut);
    // Change password.
    var cpT = document.getElementById("va-cp-toggle");
    if (cpT) cpT.addEventListener("click", function () { var f = document.getElementById("va-cp-fields"); if (f) { f.hidden = !f.hidden; if (!f.hidden) { var n = document.getElementById("va-cp-new"); if (n) n.focus(); } } });
    var cpS = document.getElementById("va-cp-save");
    if (cpS) cpS.addEventListener("click", function () {
      var np = document.getElementById("va-cp-new"), cf = document.getElementById("va-cp-confirm"), msg = document.getElementById("va-cp-msg");
      var p = (np && np.value) || "", c = (cf && cf.value) || "";
      function setMsg(t, ok) { if (msg) { msg.textContent = t; msg.style.color = ok ? "#57E39A" : "#FF7C7C"; } }
      if (p.length < 6) return setMsg("Password must be at least 6 characters.");
      if (p !== c) return setMsg("Those passwords don’t match.");
      if (!sb) return setMsg("Not connected — try again.");
      cpS.disabled = true; setMsg("Updating…", true);
      sb.auth.updateUser({ password: p }).then(function (r) {
        cpS.disabled = false;
        if (r && r.error) return setMsg(r.error.message || "Couldn’t update password.");
        setMsg("✓ Password updated.", true);
        if (np) np.value = ""; if (cf) cf.value = "";
      }).catch(function (e) { cpS.disabled = false; setMsg((e && e.message) || "Something went wrong."); });
    });
  }

  /* ---------- app shown / hidden ---------- */
  /* ---------- command palette (Ctrl/Cmd-K) — jump to any tool, run any action ---------- */
  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || ""); }
  var CMDK_CSS =
    '#vk-ov{position:fixed;inset:0;z-index:100050;display:none;align-items:flex-start;justify-content:center;padding:13vh 20px 20px;background:rgba(6,7,10,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#vk-ov.open{display:flex;}' +
    '#vk{width:100%;max-width:560px;background:linear-gradient(180deg,#171a22,#111319);border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 40px 100px -30px rgba(0,0,0,.9);overflow:hidden;animation:vkin .16s ease;}' +
    '@keyframes vkin{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:none;}}' +
    '@media(prefers-reduced-motion:reduce){#vk{animation:none;}}' +
    '#vk-in{width:100%;box-sizing:border-box;border:none;background:transparent;color:#ECEEF3;font-family:inherit;font-size:17px;padding:18px 20px;outline:none;border-bottom:1px solid rgba(255,255,255,.09);}' +
    '#vk-in::placeholder{color:#5B616D;}' +
    '#vk-list{max-height:46vh;overflow-y:auto;padding:8px;}' +
    '.vk-item{display:flex;align-items:center;gap:13px;padding:10px 13px;border-radius:11px;cursor:pointer;}' +
    '.vk-item .vk-e{width:22px;text-align:center;font-size:16px;flex:none;}' +
    '.vk-item .vk-t{font-size:14.5px;color:#ECEEF3;font-weight:600;line-height:1.2;}' +
    '.vk-item .vk-s{font-size:12px;color:#888F9D;line-height:1.3;}' +
    '.vk-item.sel{background:rgba(182,255,61,.14);}.vk-item.sel .vk-t{color:#B6FF3D;}' +
    '.vk-empty{padding:22px;text-align:center;color:#5B616D;font-size:13px;}' +
    '#vk-foot{display:flex;gap:16px;padding:9px 16px;border-top:1px solid rgba(255,255,255,.09);color:#5B616D;font-family:"JetBrains Mono",monospace;font-size:10.5px;}' +
    '#vk-foot b{color:#888F9D;font-weight:700;}' +
    '#va-cmdk{font-family:"JetBrains Mono",monospace;font-size:10.5px;font-weight:700;color:#888F9D;background:#0D0F15;border:1px solid rgba(255,255,255,.14);border-radius:100px;padding:0 10px;height:30px;cursor:pointer;transition:all .18s;}' +
    '#va-cmdk:hover{color:#0A0B0F;background:#B6FF3D;border-color:#B6FF3D;}';

  // Pages can add their own commands: window.voltRegisterCommand({title, sub, emoji, run})
  window.voltRegisterCommand = function (c) { (window.__voltCmds = window.__voltCmds || []).push(c); };

  // Actions for the current tool — detected by which buttons exist + are enabled on this page.
  function pageCommands() {
    var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var defs = {
      "": [["gen", "Generate ad angles", "✨"], ["saveDraftBtn", "Save this brief", "💾"]],
      "index.html": [["gen", "Generate ad angles", "✨"], ["saveDraftBtn", "Save this brief", "💾"]],
      "analytics.html": [["run", "Analyze performance", "📊"]],
      "email.html": [["run", "Build the email", "✉️"], ["kitBtn", "Send to Kit", "📤"], ["saveDraftBtn", "Save draft", "💾"]],
      "video.html": [["capBtn", "Generate captions", "💬"], ["exportBtn", "Export the short", "⬇️"]],
      "smartclip.html": [["scan", "Find the moments", "🎯"], ["frameAll", "Auto-frame every clip", "🎞"], ["sendSel", "Send selected to the editor", "→"]],
      "studio.html": [["btn-download", "Download HD PNG", "🖼️"], ["btn-download-all", "Resize to all 3 formats", "✨"], ["btn-download-zip", "Export all 6 slides (ZIP)", "🗂️"]]
    };
    var list = defs[page] || [], out = [];
    list.forEach(function (a) {
      var el = document.getElementById(a[0]);
      if (el && !el.disabled) out.push({ title: a[1], sub: "This tool", emoji: a[2], run: function () { var b = document.getElementById(a[0]); if (b) b.click(); } });
    });
    return out;
  }
  function baseCommands() {
    var tools = [
      { t: "Copy Lab", s: "Write ranked ad angles", e: "✍️", href: "index.html" },
      { t: "Campaign", s: "One brief → whole campaign", e: "⚡", href: "campaign.html" },
      { t: "Studio", s: "Design graphics", e: "🎨", href: "studio.html" },
      { t: "Stats", s: "Performance & insights", e: "📊", href: "analytics.html" },
      { t: "Email", s: "Build a newsletter", e: "✉️", href: "email.html" },
      { t: "Video", s: "Make a short", e: "🎬", href: "video.html" },
      { t: "Guide", s: "How to use " + BRAND.name, e: "📖", href: "guide.html" }
    ];
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var cmds = tools.filter(function (x) { return x.href.toLowerCase() !== here; })
      .map(function (x) { return { title: "Go to " + x.t, sub: x.s, emoji: x.e, run: function () { location.href = x.href; } }; });
    cmds.push({ title: "Settings & API keys", sub: "Manage your account", emoji: "⚙️", run: showSettings });
    cmds.push({ title: "Check for updates", sub: "Reload the latest version", emoji: "↻", run: function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); } });
    cmds.push({ title: "Sign out", sub: "", emoji: "🚪", run: function () { if (sb) sb.auth.signOut(); } });
    return pageCommands().concat(window.__voltCmds || []).concat(cmds);
  }
  function vkScore(q, s) {
    s = s.toLowerCase(); q = (q || "").trim().toLowerCase();
    if (!q) return 50;
    var idx = s.indexOf(q); if (idx >= 0) return 100 - idx;
    var qi = 0; for (var i = 0; i < s.length && qi < q.length; i++) { if (s[i] === q[qi]) qi++; }
    return qi === q.length ? 1 : -1;
  }
  var cmdkReady = false, vkSel = 0, vkItems = [];
  function initCmdK() {
    if (cmdkReady) return; cmdkReady = true;
    var st = document.createElement("style"); st.id = "va-cmdk-style"; st.textContent = CMDK_CSS; document.head.appendChild(st);
    var ov = document.createElement("div"); ov.id = "vk-ov";
    ov.innerHTML = '<div id="vk"><input id="vk-in" type="text" placeholder="Search ' + esc(BRAND.name) + ' — jump to a tool or run an action…" autocomplete="off" spellcheck="false" /><div id="vk-list"></div><div id="vk-foot"><span><b>↑↓</b> move</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div></div>';
    document.body.appendChild(ov);
    var inp = document.getElementById("vk-in"), list = document.getElementById("vk-list");
    function closeK() { ov.classList.remove("open"); }
    function openK() { ov.classList.add("open"); inp.value = ""; vkSel = 0; render(""); setTimeout(function () { inp.focus(); }, 20); }
    window.voltOpenCommand = openK;
    function render(q) {
      var scored = [];
      baseCommands().forEach(function (c) { var sc = vkScore(q, c.title + " " + (c.sub || "")); if (sc >= 0) scored.push({ c: c, sc: sc }); });
      scored.sort(function (a, b) { return b.sc - a.sc; });
      vkItems = scored.map(function (x) { return x.c; });
      if (vkSel >= vkItems.length) vkSel = 0;
      if (!vkItems.length) { list.innerHTML = '<div class="vk-empty">No matches.</div>'; return; }
      list.innerHTML = vkItems.map(function (c, i) {
        return '<div class="vk-item' + (i === vkSel ? " sel" : "") + '" data-i="' + i + '"><span class="vk-e">' + (c.emoji || "•") + '</span><div><div class="vk-t">' + esc(c.title) + "</div>" + (c.sub ? '<div class="vk-s">' + esc(c.sub) + "</div>" : "") + "</div></div>";
      }).join("");
    }
    function setSel(i) { vkSel = i; var els = list.querySelectorAll(".vk-item"); for (var k = 0; k < els.length; k++) els[k].classList.toggle("sel", k === i); var s = els[i]; if (s) s.scrollIntoView({ block: "nearest" }); }
    function run(i) { var c = vkItems[i]; if (!c) return; closeK(); try { c.run(); } catch (e) {} }
    inp.addEventListener("input", function () { vkSel = 0; render(inp.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel(Math.min(vkItems.length - 1, vkSel + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel(Math.max(0, vkSel - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); run(vkSel); }
      else if (e.key === "Escape") { e.preventDefault(); closeK(); }
    });
    list.addEventListener("click", function (e) { var it = e.target.closest(".vk-item"); if (it) run(parseInt(it.dataset.i, 10)); });
    list.addEventListener("mousemove", function (e) { var it = e.target.closest(".vk-item"); if (it) { var i = parseInt(it.dataset.i, 10); if (i !== vkSel) setSel(i); } });
    ov.addEventListener("click", function (e) { if (e.target === ov) closeK(); });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (ov.classList.contains("open")) closeK(); else openK(); }
    });
  }

  /* ---------- module RESULTS persistence ----------
     The field autosave below only restores what you TYPED. This keeps what a module
     GENERATED (campaign results, copy angles, email body…) so leaving a tool and coming
     back doesn't start you from scratch. Per-module key, TTL'd, size-capped. */
  var STATE_TTL_DAYS = 14, STATE_MAX = 400000; // ~400KB per module
  window.voltState = {
    key: function (name) { return "volt_state_" + String(name || (location.pathname.split("/").pop() || "index")).toLowerCase(); },
    save: function (name, data) {
      try {
        if (data == null) return this.clear(name);
        var s = JSON.stringify({ t: Date.now(), v: data });
        if (s.length > STATE_MAX) return false;       // too big — skip rather than blow the quota
        localStorage.setItem(this.key(name), s);
        return true;
      } catch (e) { return false; }
    },
    load: function (name, maxAgeDays) {
      try {
        var raw = localStorage.getItem(this.key(name));
        if (!raw) return null;
        var d = JSON.parse(raw);
        if (!d || d.v == null) return null;
        var age = (Date.now() - (d.t || 0)) / 86400000;
        if (age > (maxAgeDays || STATE_TTL_DAYS)) { this.clear(name); return null; }
        return d.v;
      } catch (e) { return null; }
    },
    savedAt: function (name) {
      try { var d = JSON.parse(localStorage.getItem(this.key(name)) || "null"); return d && d.t ? new Date(d.t) : null; } catch (e) { return null; }
    },
    clear: function (name) { try { localStorage.removeItem(this.key(name)); } catch (e) {} return true; },
  };

  /* ---------- org settings: which modules / designs are retired ----------
     Written only by the owner (server-enforced in api/projects.js), READ by everyone — this is
     where the reading half happens. Cached so nav doesn't flicker on load; refreshed in the
     background. Retiring hides a thing from the pickers; it never deletes anything. */
  var OS_LS = "volt_orgsettings";
  function orgSettings() {
    try { var c = JSON.parse(localStorage.getItem(OS_LS) || "null"); return (c && c.v) || {}; } catch (e) { return {}; }
  }
  window.voltOrgSettings = orgSettings;
  function retired(group, key) {
    var s = orgSettings();
    return !!(s && s[group] && s[group][key] === false);
  }
  window.voltRetired = retired;
  function applyOrgSettings() {
    var s = orgSettings();
    // Business News SA (Studio's editorial family) is OFF by default for every org, opt-IN rather
    // than the opt-OUT the loop below uses for every other family — checked unconditionally, ahead
    // of the early-return, since a brand-new org with zero saved settings at all must still not
    // show it. Everything else here defaults ON; this one key alone defaults off.
    if (!(s && s.premium && s.premium.bizsa === true)) {
      var bizEl = document.getElementById("ct-bizsa"); if (bizEl) bizEl.style.display = "none";
    }
    if (!s || (!s.modules && !s.themes && !s.premium)) return;
    // nav tabs + rail entries for retired modules
    Object.keys(s.modules || {}).forEach(function (k) {
      if (s.modules[k] !== false) return;
      var sel = 'a[href="' + k + '.html"]';
      [].forEach.call(document.querySelectorAll(sel), function (a) {
        if (a.classList.contains("tab") || a.classList.contains("nav-tab") || a.classList.contains("r-t")) a.style.display = "none";
      });
    });
    // Studio theme buttons (#theme-classic…) and premium content types (#ct-funding…)
    Object.keys(s.themes || {}).forEach(function (k) {
      if (s.themes[k] === false) { var el = document.getElementById("theme-" + k); if (el) el.style.display = "none"; }
    });
    Object.keys(s.premium || {}).forEach(function (k) {
      if (s.premium[k] === false) { var el = document.getElementById("ct-" + k); if (el) el.style.display = "none"; }
    });
    announceRetired(s);
    try { document.dispatchEvent(new CustomEvent("volt:orgsettings", { detail: s })); } catch (e) {}
  }
  // Tell the team WHY something vanished — once per retired design, not on every load. Without
  // this a design silently disappears and people assume the tool broke.
  var RETIRE_SEEN = "volt_retire_seen_v1";
  var RETIRE_LABEL = {
    classic: { n: "Classic", why: "our primary red", to: "Navy" },
    navy: { n: "Navy", why: "the navy look", to: "Classic" },
    cinematic: { n: "Cinematic", why: "the full-bleed look", to: "another design" },
    modern: { n: "Modern", why: "the light look", to: "another design" },
    editorial: { n: "Editorial", why: "the paper look", to: "another design" },
    bold: { n: "Bold", why: "the oversized-type look", to: "another design" }
  };
  function announceRetired(s) {
    if (!s || !s.themes) return;
    var seen = {};
    try { seen = JSON.parse(localStorage.getItem(RETIRE_SEEN) || "{}"); } catch (e) {}
    var fresh = Object.keys(s.themes).filter(function (k) { return s.themes[k] === false && !seen[k]; });
    if (!fresh.length) return;
    var k = fresh[0], meta = RETIRE_LABEL[k] || { n: k, why: "that design", to: "another design" };
    fresh.forEach(function (x) { seen[x] = Date.now(); });
    try { localStorage.setItem(RETIRE_SEEN, JSON.stringify(seen)); } catch (e) {}
    // A 2.6s toast is too easy to miss for something that changes what the team can use —
    // this stays until it's dismissed.
    setTimeout(function () {
      if (document.getElementById("va-retire")) return;
      var n = document.createElement("div");
      n.id = "va-retire";
      n.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:100060;max-width:390px;" +
        "background:linear-gradient(180deg,#14171F,#11141b);border:1px solid rgba(182,255,61,.35);" +
        "border-radius:14px;padding:16px 18px;box-shadow:0 18px 44px rgba(0,0,0,.55);" +
        "font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#ECEEF3;font-size:13.5px;line-height:1.55;";
      n.innerHTML =
        '<div style="font-weight:800;margin-bottom:6px;">🎨 ' + meta.n + ' has been retired</div>' +
        '<div style="color:#888F9D;">' + meta.why.charAt(0).toUpperCase() + meta.why.slice(1) +
        ' has been used a lot lately — time to switch things up. Studio now opens on <b style="color:#B6FF3D;">' +
        meta.to + '</b>.</div>' +
        '<div style="color:#5B616D;font-size:12px;margin-top:8px;">Nothing you\'ve already made has changed.</div>' +
        '<button style="margin-top:12px;background:#B6FF3D;color:#0A0B0F;border:none;border-radius:9px;' +
        'padding:8px 15px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;">Got it</button>';
      n.querySelector("button").onclick = function () { n.remove(); };
      document.body.appendChild(n);
    }, 900);
  }
  window.voltApplyOrgSettings = applyOrgSettings;
  function refreshOrgSettings() {
    fetch("https://tshephos-lab.vercel.app/api/projects?type=orgsettings")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var row = d && (d.projects || [])[0];
        if (!row) return;
        return fetch("https://tshephos-lab.vercel.app/api/projects?id=" + row.id)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (full) {
            var v = full && full.project && full.project.data;
            if (!v) return;
            try { localStorage.setItem(OS_LS, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {}
            applyOrgSettings();
          });
      })
      .catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyOrgSettings);
  else applyOrgSettings();
  window.addEventListener("load", applyOrgSettings);
  window.addEventListener("volt:ready", refreshOrgSettings);

  /* ---------- universal autosave — never lose typed work ----------
     Text fields alone were not enough. A user would generate an email, edit it in the preview,
     set up a Studio design or a Video look, come back and find it gone — because none of that
     lives in an <input>. Autosave now covers four things:
       1. text inputs / textareas / selects with an id   (as before)
       2. checkboxes + radios                            (toggles: caption bg, show-footer, ...)
       3. [contenteditable][id]                          (the email preview editor)
       4. registered MODULE STATE via window.voltRegisterAutosave — each tool hands over a
          snapshot of its own state object, which is where the real work actually is.
     It also flushes on tab-hide and pagehide, because a debounce does not fire if you close fast. */
  function autosaveKey() { return "volt_autosave_" + (location.pathname.split("/").pop() || "index").toLowerCase(); }
  function autosaveSkip(el) {
    if (!el || !el.id || /^(va-|vk-)/.test(el.id)) return true;
    return el.hasAttribute("data-no-save");
  }
  function autosaveFields() {
    return [].slice.call(document.querySelectorAll("input[id],textarea[id],select[id]")).filter(function (el) {
      if (autosaveSkip(el)) return false;
      if (el.tagName === "INPUT") {
        var t = (el.type || "text").toLowerCase();
        if (["password", "file", "button", "submit", "reset", "hidden"].indexOf(t) >= 0) return false;
      }
      return true;
    });
  }
  function autosaveToggles() {
    return autosaveFields().filter(function (el) {
      var t = (el.type || "").toLowerCase(); return t === "checkbox" || t === "radio";
    });
  }
  function autosaveValueFields() {
    return autosaveFields().filter(function (el) {
      var t = (el.type || "").toLowerCase(); return t !== "checkbox" && t !== "radio";
    });
  }
  function autosaveEditables() {
    return [].slice.call(document.querySelectorAll("[contenteditable][id]")).filter(function (el) {
      return !autosaveSkip(el) && el.getAttribute("contenteditable") !== "false";
    });
  }

  // Module-state registry. A page calls this once with a snapshot()/restore() pair; snapshot must
  // return something JSON-serialisable, restore receives it back verbatim on the next load.
  var autosaveMods = {};
  window.voltRegisterAutosave = function (name, handlers) {
    if (!name || !handlers || typeof handlers.snapshot !== "function" || typeof handlers.restore !== "function") return;
    autosaveMods[name] = handlers;
    // A page may register AFTER the restore pass has already run (its init is async, or it waits
    // for fonts/worker). Catch it up immediately instead of silently losing the snapshot.
    if (autosaveRestored) {
      var saved = autosaveStored();
      if (saved && saved.mods && saved.mods[name] != null) {
        try { if (handlers.restore(saved.mods[name]) !== false) showToast("↩ Restored your unsaved work"); } catch (e) {}
      }
    }
  };
  function autosaveStored() {
    var raw; try { raw = localStorage.getItem(autosaveKey()); } catch (e) { return null; }
    if (!raw) return null; try { return JSON.parse(raw); } catch (e) { return null; }
  }

  var autosaveT, autosaveOn = false, autosaveRestored = false;
  function saveAutosave() {
    if (!autosaveOn) return;
    var m = {}, c = {}, e2 = {}, mods = {};
    autosaveValueFields().forEach(function (el) { if (el.value) m[el.id] = el.value; });
    autosaveToggles().forEach(function (el) { c[el.id] = !!el.checked; });
    autosaveEditables().forEach(function (el) { if (el.innerHTML && el.innerHTML.trim()) e2[el.id] = el.innerHTML; });
    Object.keys(autosaveMods).forEach(function (k) {
      try { var s = autosaveMods[k].snapshot(); if (s != null) mods[k] = s; } catch (err) {}
    });
    var payload = { t: Date.now(), m: m, c: c, e: e2, mods: mods };
    var empty = !Object.keys(m).length && !Object.keys(e2).length && !Object.keys(mods).length;
    try {
      if (empty) localStorage.removeItem(autosaveKey());
      else localStorage.setItem(autosaveKey(), JSON.stringify(payload));
    } catch (err) {
      // Quota blown (a Video look or a big email body can be large) — drop module state and retry
      // with just the fields, so a big snapshot never costs the user their typed copy too.
      try { localStorage.setItem(autosaveKey(), JSON.stringify({ t: payload.t, m: m, c: c, e: e2, mods: {} })); } catch (e3) {}
    }
  }
  function flushAutosave() { clearTimeout(autosaveT); saveAutosave(); }
  function restoreAutosave() {
    if (autosaveRestored) return; autosaveRestored = true;
    var data = autosaveStored();
    if (!data) return; var n = 0;
    var fire = function (el) { try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} };
    // Text: only fill fields that are currently EMPTY — never clobber a tool's defaults or a hand-off.
    if (data.m) autosaveValueFields().forEach(function (el) {
      var val = data.m[el.id];
      if (val != null && val !== "" && !el.value) { el.value = val; fire(el); n++; }
    });
    // Toggles: restore only when it DIFFERS from the current state, so we don't fire needless events.
    if (data.c) autosaveToggles().forEach(function (el) {
      var val = data.c[el.id];
      if (typeof val === "boolean" && el.checked !== val) { el.checked = val; fire(el); n++; }
    });
    // Editable regions: same empty-only rule, measured on text content so whitespace markup
    // from the editor doesn't read as "already has content".
    if (data.e) autosaveEditables().forEach(function (el) {
      var val = data.e[el.id];
      if (val && !(el.textContent || "").trim()) { el.innerHTML = val; n++; }
    });
    // Module state LAST — a tool's restore() typically re-renders from the fields above.
    if (data.mods) Object.keys(autosaveMods).forEach(function (k) {
      if (data.mods[k] == null) return;
      try { if (autosaveMods[k].restore(data.mods[k]) !== false) n++; } catch (err) {}
    });
    if (n) showToast("↩ Restored your unsaved work");
  }
  function initAutosave() {
    if (autosaveOn) return; autosaveOn = true;
    var touch = function (e) {
      var el = e && e.target; if (el && el.id && /^(va-|vk-)/.test(el.id)) return;
      clearTimeout(autosaveT); autosaveT = setTimeout(saveAutosave, 600);
    };
    document.addEventListener("input", touch, true);
    document.addEventListener("change", touch, true);          // selects, checkboxes, radios
    // The email/Studio editors mutate the DOM and JS state without any input event — a heartbeat
    // is the only thing that reliably catches "generated a draft then walked away".
    setInterval(function () { if (document.visibilityState !== "hidden") saveAutosave(); }, 15000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushAutosave(); });
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", flushAutosave);
    window.voltAutosaveNow = flushAutosave;                     // pages can force a save after a generate
    if (document.readyState === "complete") setTimeout(restoreAutosave, 250);
    else window.addEventListener("load", function () { setTimeout(restoreAutosave, 250); });
  }

  /* ---------- first-run onboarding (shows once) ---------- */
  function vaTip(icon, h, s) { return '<div class="va-tip"><span class="va-tip-i">' + icon + '</span><div><div class="va-tip-h">' + h + '</div><div class="va-tip-s">' + s + '</div></div></div>'; }
  function maybeOnboard() {
    var done; try { done = localStorage.getItem("volt_onboarded_v1"); } catch (e) {}
    if (done) return;
    if (document.getElementById("va-welcome")) return;
    injectCSS();
    var m = document.createElement("div"); m.id = "va-welcome";
    m.innerHTML = '<div class="va-card">' +
      '<p class="va-logo">' + esc(BRAND.wordmark.replace(/\.$/, "")) + (BRAND.wordmark.slice(-1) === "." ? '<span class="d">.</span>' : "") + '</p>' +
      '<p class="va-sub" style="margin-bottom:18px;">Welcome, ' + esc(firstName(session && session.user && session.user.email)) + '. Your AI marketing suite — copy, graphics, video, email and the numbers, all in one place.</p>' +
      '<div class="va-tips">' +
        vaTip("🎨", "Set your brand once", "Do it in Studio — every tool then uses your colours, logo and voice.") +
        vaTip(isMac() ? "⌘" : "^K", "Jump anywhere, instantly", "Press " + (isMac() ? "⌘K" : "Ctrl K") + " from any tool to switch or run an action.") +
        vaTip("💾", "Never lose your work", "Everything you type autosaves — reload and it's still there.") +
      '</div>' +
      '<div class="va-row"><button class="va-btn va-primary" id="va-welcome-go">Start creating</button></div>' +
    '</div>';
    document.body.appendChild(m);
    document.getElementById("va-welcome-go").addEventListener("click", function () {
      try { localStorage.setItem("volt_onboarded_v1", "1"); } catch (e) {}
      m.remove();
    });
  }

  /* ---------- personalized "Jarvis" welcome (everyone) ---------- */
  // How each person is addressed. The owner keeps "Master"; teammates are greeted formally by
  // honorific + surname. Supabase gives us an email and nothing else, so a surname has to be
  // recorded here (or arrive as `first.last@`) — it cannot be guessed from "karabo@...".
  //
  // Deliberately NO default honorific for people who aren't listed: guessing "Mr" from a name or
  // an email would misgender real colleagues, so unknown users are greeted by first name until
  // they're added below. Adding a teammate is one line.
  var PEOPLE = {
    "joel@smesouthafrica.co.za":   { name: "Joel", title: "Master" },
    "karabo@smesouthafrica.co.za": { surname: "Kgophane", title: "Mr" },
  };
  function greetingName(em) {
    var who = PEOPLE[em];
    if (who) {
      var label = who.surname || who.name || firstName(em);
      return (who.title ? who.title + " " : "") + label;
    }
    // `first.last@domain` carries a real surname — use it, but still without an assumed honorific.
    var local = String(em).split("@")[0], parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length > 1) {
      var last = parts[parts.length - 1];
      return last.charAt(0).toUpperCase() + last.slice(1);
    }
    return firstName(em);
  }
  function maybeGreetOwner() {
    try {
      var em = (session && session.user && session.user.email ? String(session.user.email) : "").toLowerCase();
      if (!em) return;
      if (sessionStorage.getItem("volt_greeted")) return; // once per app session
      sessionStorage.setItem("volt_greeted", "1");
      showOwnerGreeting("Welcome back, " + greetingName(em));
    } catch (e) {}
  }
  function showOwnerGreeting(text) {
    if (!document.getElementById("va-jarvis-style")) {
      var st = document.createElement("style"); st.id = "va-jarvis-style";
      st.textContent =
        // Backdrop: dark + faint HUD grid.
        "#va-jarvis{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity .45s ease;" +
          "background:radial-gradient(circle at 50% 42%,rgba(12,20,16,.92),rgba(8,9,12,.985)),repeating-linear-gradient(0deg,rgba(182,255,61,.05) 0 1px,transparent 1px 42px),repeating-linear-gradient(90deg,rgba(182,255,61,.05) 0 1px,transparent 1px 42px);backdrop-filter:blur(7px);}" +
        "#va-jarvis.show{opacity:1;}" +
        // HUD corner brackets.
        "#va-jarvis .vj-corner{position:fixed;width:46px;height:46px;border:2px solid rgba(182,255,61,.55);opacity:0;transition:opacity .6s ease .1s;}" +
        "#va-jarvis.show .vj-corner{opacity:1;}" +
        "#va-jarvis .vj-corner.tl{top:26px;left:26px;border-right:0;border-bottom:0;}#va-jarvis .vj-corner.tr{top:26px;right:26px;border-left:0;border-bottom:0;}" +
        "#va-jarvis .vj-corner.bl{bottom:26px;left:26px;border-right:0;border-top:0;}#va-jarvis .vj-corner.br{bottom:26px;right:26px;border-left:0;border-top:0;}" +
        // Arc reactor.
        "#va-jarvis .vj-reactor{width:180px;height:180px;filter:drop-shadow(0 0 22px rgba(182,255,61,.4));opacity:0;transform:scale(.7);transition:all .7s cubic-bezier(.2,.9,.3,1.2);}" +
        "#va-jarvis.show .vj-reactor{opacity:1;transform:scale(1);}" +
        "#va-jarvis .ring{fill:none;transform-origin:100px 100px;}" +
        "#va-jarvis .r1{stroke:rgba(182,255,61,.55);stroke-width:1.5;stroke-dasharray:6 10;animation:vjspin 9s linear infinite;}" +
        "#va-jarvis .r2{stroke:rgba(127,200,255,.6);stroke-width:1.5;stroke-dasharray:2 7;animation:vjspin 5s linear infinite reverse;}" +
        "#va-jarvis .r3{stroke:rgba(182,255,61,.7);stroke-width:2;stroke-dasharray:46 14;animation:vjspin 14s linear infinite;}" +
        "#va-jarvis .core{fill:rgba(182,255,61,.1);stroke:rgba(182,255,61,.95);stroke-width:2;transform-origin:100px 100px;animation:vjpulse 1.7s ease-in-out infinite;}" +
        "#va-jarvis .dot{fill:var(--accent,#B6FF3D);}" +
        // Boot lines + welcome.
        "#va-jarvis .vj-boot{margin-top:26px;text-align:center;font-family:var(--fm,monospace);font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:var(--accent,#B6FF3D);line-height:2;}" +
        "#va-jarvis .vj-line{opacity:0;animation:vjline .5s ease forwards;}" +
        "#va-jarvis .vj-hi{font-family:var(--fd,'Unbounded',system-ui);font-weight:800;font-size:clamp(30px,5.5vw,52px);color:#fff;margin:20px 0 6px;text-align:center;opacity:0;animation:vjhi .8s cubic-bezier(.2,.9,.3,1.1) forwards 1.4s;text-shadow:0 0 30px rgba(182,255,61,.35);}" +
        "#va-jarvis .vj-sub{font-family:var(--fb,system-ui);font-size:14px;color:var(--dim,#888F9D);opacity:0;animation:vjfade .7s ease forwards 1.9s;letter-spacing:.5px;}" +
        "@keyframes vjspin{to{transform:rotate(360deg);}}" +
        "@keyframes vjpulse{0%,100%{opacity:.6;}50%{opacity:1;}}" +
        "@keyframes vjline{from{opacity:0;transform:translateY(6px);}to{opacity:.9;transform:translateY(0);}}" +
        "@keyframes vjhi{from{opacity:0;transform:translateY(12px) scale(.96);filter:blur(4px);}to{opacity:1;transform:none;filter:blur(0);}}" +
        "@keyframes vjfade{to{opacity:1;}}";
      document.head.appendChild(st);
    }
    var o = document.createElement("div"); o.id = "va-jarvis";
    o.innerHTML =
      '<div class="vj-corner tl"></div><div class="vj-corner tr"></div><div class="vj-corner bl"></div><div class="vj-corner br"></div>' +
      '<svg class="vj-reactor" viewBox="0 0 200 200" aria-hidden="true">' +
        '<circle class="ring r3" cx="100" cy="100" r="86"></circle>' +
        '<circle class="ring r1" cx="100" cy="100" r="68"></circle>' +
        '<circle class="ring r2" cx="100" cy="100" r="50"></circle>' +
        '<circle class="core" cx="100" cy="100" r="30"></circle>' +
        '<circle class="dot" cx="100" cy="100" r="6"></circle>' +
      '</svg>' +
      '<div class="vj-boot">' +
        '<div class="vj-line" style="animation-delay:.25s">◇ ' + esc(BRAND.name) + ' Intelligence — Online</div>' +
        '<div class="vj-line" style="animation-delay:.65s">▸ Calibrating modules … OK</div>' +
        '<div class="vj-line" style="animation-delay:1.05s">▸ Secure session verified</div>' +
      '</div>' +
      '<div class="vj-hi">' + esc(text) + '</div>' +
      '<div class="vj-sub">All systems ready.</div>';
    document.body.appendChild(o);
    o.addEventListener("click", function () { dismiss(); });
    requestAnimationFrame(function () { o.classList.add("show"); });
    function dismiss() { if (!o.parentNode) return; o.style.opacity = "0"; setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 450); }
    setTimeout(dismiss, 4200);
  }

  function showApp() {
    var g = document.getElementById("va-gate"); if (g) g.remove();
    document.documentElement.style.overflow = "";
    showBadge();
    initCmdK();
    initAutosave();
    maybeOnboard();
    maybeUpdateCheck();
    maybeContentUpdateCheck();
    if (!_contentPollT) _contentPollT = setInterval(maybeContentUpdateCheck, CONTENT_POLL_MS);
    maybeGreetOwner();
    initSleep();
    // Signal pages that a session is ready, so they can load per-account data (Phase B).
    window.voltSession = session;
    try { window.dispatchEvent(new Event("volt:ready")); } catch (e) {}
    var f = null; try { f = localStorage.getItem("volt_just_updated"); } catch (e) {}
    if (f) { try { localStorage.removeItem("volt_just_updated"); } catch (e) {} showToast("✓ You're on the latest version"); }
  }

  /* ---------- init ---------- */
  function loadSb(cb) {
    if (window.supabase && window.supabase.createClient) return cb();
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    s.onload = cb;
    s.onerror = function () { showGate("Couldn’t load sign-in. Check your connection and reload."); };
    document.head.appendChild(s);
  }
  function init() {
    injectCSS();
    applyBrandChrome();
    if (!BRAND_READY) { showGate("SETUP_INCOMPLETE"); return; } // fail closed, never touch Volt's real project
    showGate(); // show immediately so nothing flashes unauthenticated
    loadSb(function () {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      var recovering = /type=recovery/.test(location.hash || "");
      sb.auth.getSession().then(function (r) {
        session = r.data.session;
        if (recovering) showReset();
        else if (session) showApp();
        sb.auth.onAuthStateChange(function (_e, s) {
          session = s;
          if (_e === "PASSWORD_RECOVERY") { showReset(); return; }
          if (s) showApp(); else showGate();
        });
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
