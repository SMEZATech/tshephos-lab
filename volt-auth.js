/* Volt — real auth + per-user keys (v2, Supabase). © 2026 Tshepho Joel.
   Loaded on EVERY page (web + desktop). Gates the app on a real account, attaches the
   session token to every /api call, and on desktop passes the user's own provider keys.
   The public APP_KEY is retired — the server now requires a valid login instead. */
(function () {
  "use strict";

  var SUPABASE_URL = "https://ltnjjsadcvqmtczbtxii.supabase.co";
  var SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0bmpqc2FkY3ZxbXRjemJ0eGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDgyODIsImV4cCI6MjA5NzcyNDI4Mn0.3sUeA0nITk1BqPQZGrgluHqQNHm9jP6KlrRrsZG3Tps";
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
    window.fetch = function (input, init) {
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
    // ---- Volt left rail (Canva-style module switcher) — replaces the top tabs + account pill,
    // centrally, so every page gets it. body padding-left clears the fixed rail; the three
    // layout archetypes (Studio flex, centered .wrap, Email) all reflow cleanly. ----
    'body{padding-left:76px !important;}' +
    '.topbar,.nav-tabs,#va-badge{display:none !important;}' +
    '#va-rail{position:fixed;left:0;top:0;bottom:0;width:76px;z-index:90000;background:linear-gradient(180deg,#0d0f15,#0a0b0f);border-right:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;align-items:center;padding:14px 0 12px;gap:4px;overflow-y:auto;overflow-x:hidden;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-rail::-webkit-scrollbar{width:0;}' +
    '#va-rail .r-logo{font-family:"Unbounded","Segoe UI",system-ui;font-weight:800;font-size:21px;color:#ECEEF3;margin-bottom:8px;text-decoration:none;}#va-rail .r-logo b{color:#B6FF3D;}' +
    '.r-tile{width:52px;height:50px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#8A91A0;cursor:pointer;text-decoration:none;transition:background .15s,color .15s,box-shadow .15s;border:1px solid transparent;flex:none;}' +
    '.r-tile .ic{font-size:18px;line-height:1;}.r-tile .lb{font-family:"JetBrains Mono",monospace;font-size:8px;letter-spacing:.02em;text-transform:uppercase;}' +
    '.r-tile:hover{background:rgba(255,255,255,.06);color:#ECEEF3;}' +
    '.r-tile.on{background:#B6FF3D;color:#0A0B0F;box-shadow:0 6px 16px -6px rgba(182,255,61,.5);}.r-tile.on .lb{color:#0A0B0F;}' +
    '#va-rail .r-spacer{flex:1;min-height:8px;}' +
    '#va-rail .r-av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#B6FF3D,#57E39A);color:#0A0B0F;font-weight:800;font-family:"Unbounded",sans-serif;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;margin-top:4px;flex:none;}' +
    '@media(max-width:640px){body{padding-left:0 !important;}#va-rail{flex-direction:row;top:auto;bottom:0;width:100%;height:58px;padding:0 8px;border-right:none;border-top:1px solid rgba(255,255,255,.09);gap:2px;overflow-x:auto;}#va-rail .r-logo,#va-rail .r-spacer{display:none;}.r-tile{height:46px;width:48px;}}';

  function injectCSS() { if (document.getElementById("va-style")) return; var st = document.createElement("style"); st.id = "va-style"; st.textContent = CSS; document.head.appendChild(st); }

  /* ---------- sign-in gate ---------- */
  function showGate(errMsg) {
    injectCSS();
    document.documentElement.style.overflow = "hidden";
    var g = document.getElementById("va-gate");
    if (!g) {
      g = document.createElement("div"); g.id = "va-gate";
      g.innerHTML =
        '<div class="va-card">' +
          '<p class="va-logo">Volt<span class="d">.</span></p>' +
          '<p class="va-sub">SME South Africa’s marketing suite. Sign in, or create an account to continue.</p>' +
          '<label class="va-lbl" for="va-email">Email</label>' +
          '<input class="va-input" id="va-email" type="email" autocomplete="username" placeholder="you@smesouthafrica.co.za" />' +
          '<label class="va-lbl" for="va-pw">Password</label>' +
          '<input class="va-input" id="va-pw" type="password" autocomplete="current-password" placeholder="6+ characters" />' +
          '<div class="va-err" id="va-err"></div>' +
          '<div class="va-row"><button class="va-btn va-primary" id="va-in">Sign in</button><button class="va-btn va-ghost" id="va-up">Create account</button></div>' +
          '<button class="va-forgot" id="va-forgot">Forgot password?</button>' +
          '<p class="va-foot">For SME South Africa internal use.</p>' +
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
        if (!/@smesouthafrica\.co\.za$/i.test(email.value.trim())) { fail("Please use your @smesouthafrica.co.za work email."); return; }
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
        '<p class="va-logo">Volt<span class="d">.</span></p>' +
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

  /* ---------- badge + toast ---------- */
  var RAIL_TILES = [
    { t: "Create", e: "✦", href: "home.html" },
    { t: "Copy", e: "✍️", href: "index.html" },
    { t: "Campaign", e: "⚡", href: "campaign.html" },
    { t: "Studio", e: "🎨", href: "studio.html" },
    { t: "Freeform", e: "🖌️", href: "freeform.html" },
    { t: "Video", e: "🎬", href: "video.html" },
    { t: "Transcribe", e: "📝", href: "videotok.html" },
    { t: "Email", e: "✉️", href: "email.html" },
    { t: "Schedule", e: "📅", href: "schedule.html" },
    { t: "Stats", e: "📊", href: "analytics.html" },
  ];
  function showBadge() { // now builds the left rail (the Canva-style module switcher)
    injectCSS();
    var old = document.getElementById("va-rail"); if (old) old.remove();
    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (here === "") here = "index.html";
    var rail = document.createElement("aside"); rail.id = "va-rail";
    var tiles = RAIL_TILES.map(function (x) {
      return '<a class="r-tile' + (x.href.toLowerCase() === here ? " on" : "") + '" href="' + x.href + '"><span class="ic">' + x.e + '</span><span class="lb">' + x.t + '</span></a>';
    }).join("");
    rail.innerHTML =
      '<a class="r-logo" href="home.html" title="Volt">V<b>.</b></a>' + tiles +
      '<div class="r-spacer"></div>' +
      '<div class="r-tile" id="r-cmdk" title="Command menu (' + (isMac() ? "⌘K" : "Ctrl K") + ')"><span class="ic">⌘</span><span class="lb">Menu</span></div>' +
      '<a class="r-tile' + ("guide.html" === here ? " on" : "") + '" href="guide.html"><span class="ic">📖</span><span class="lb">Guide</span></a>' +
      '<div class="r-tile" id="r-refresh" title="Check for updates"><span class="ic">↻</span><span class="lb">Update</span></div>' +
      '<div class="r-tile" id="r-settings" title="Settings"><span class="ic">⚙️</span><span class="lb">Set</span></div>' +
      '<div class="r-av" id="r-av" title="' + esc(session && session.user && session.user.email) + '">' + esc((firstName(session && session.user && session.user.email) || "?").charAt(0).toUpperCase()) + '</div>';
    document.body.appendChild(rail);
    var byId = function (id) { return document.getElementById(id); };
    if (byId("r-settings")) byId("r-settings").addEventListener("click", showSettings);
    if (byId("r-av")) byId("r-av").addEventListener("click", showSettings);
    if (byId("r-cmdk")) byId("r-cmdk").addEventListener("click", function () { if (window.voltOpenCommand) window.voltOpenCommand(); });
    if (byId("r-refresh")) byId("r-refresh").addEventListener("click", function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); });
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
        "#va-update-bar{position:fixed;top:0;left:76px;right:0;z-index:9998;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;background:linear-gradient(90deg,#1A1E28,#14171F);border-bottom:1px solid var(--border-2,rgba(255,255,255,.14));font-family:var(--fb,system-ui);font-size:13px;color:var(--text,#ECEEF3)}" +
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
      '<span class="va-ub-txt">✨ Volt <b>' + esc(latest) + "</b> is available" + (notes ? " — " + esc(notes) : "") + ' <span class="va-ub-cur">(you have ' + esc(cur) + ")</span></span>" +
      '<span class="va-ub-actions">' +
        (url ? '<a class="va-ub-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Download update ↗</a>' : "") +
        '<button class="va-ub-x" id="va-ub-x">Later</button>' +
      "</span>";
    document.body.appendChild(bar);
    document.body.classList.add("va-has-update");
    var x = document.getElementById("va-ub-x");
    if (x) x.addEventListener("click", function () { try { localStorage.setItem("volt_update_dismissed", latest); } catch (e) {} bar.remove(); document.body.classList.remove("va-has-update"); });
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
    var out = '<div class="va-keys"><p class="va-keys-h">Your API keys</p><p class="va-keys-note">Studio needs no key. Add as many AI keys as you like — Volt tries them top-to-bottom and auto-falls-over to the next when one is rate-limited or out of quota. More keys = fewer interruptions.</p>';
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
      var lim = (j.limit < 0) ? "∞" : j.limit;
      var pct = (j.limit > 0) ? Math.min(100, Math.round((j.used / j.limit) * 100)) : 0;
      var html = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.09);">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888F9D;">Plan &amp; usage</span>' +
        '<span style="font-size:12px;color:#ECEEF3;font-weight:700;">' + esc(j.label) + '</span></div>' +
        '<div style="font-size:12px;color:#888F9D;margin-bottom:6px;">' + j.used + ' / ' + lim + ' AI generations this month</div>';
      if (j.limit > 0) html += '<div style="height:7px;border-radius:99px;background:#1A1E28;overflow:hidden;margin-bottom:8px;"><i style="display:block;height:100%;width:' + pct + '%;background:' + (pct >= 90 ? "#FF7C7C" : "#B6FF3D") + ';"></i></div>';
      if (j.billingReady) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        ["starter", "pro"].forEach(function (p) { if (p !== j.plan) html += '<button class="va-btn va-ghost va-up" data-plan="' + p + '" style="flex:1;">Upgrade to ' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>'; });
        html += "</div>";
      } else if (!j.enforced) {
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
      '<p class="va-pane-sub">When you go idle, Volt drops into an ambient standby screen — a live clock and glowing reactor, great as a desk display. Any mouse move or key press wakes it instantly.</p>' +
      '<label class="va-toggle-row"><span>Enable sleep mode</span><input type="checkbox" id="va-sleep-on"' + (cfg.on ? " checked" : "") + ' style="width:18px;height:18px;accent-color:#B6FF3D;cursor:pointer;"></label>' +
      '<div class="va-field" style="margin-top:6px;"><span class="nm">Sleep after</span><select class="va-input" id="va-sleep-mins" style="margin-top:6px;cursor:pointer;">' + opts + "</select></div>" +
      '<button class="va-btn va-ghost" id="va-sleep-preview" style="margin-top:14px;">▶ Preview standby screen</button>';
  }
  function accountPaneHTML(email) {
    var org = (session && session.user && (session.user.user_metadata && session.user.user_metadata.org)) || "";
    var appv = (isDesktop() && window.voltNative && window.voltNative.isDesktop) ? "Desktop app" : "Web";
    return '<p class="va-pane-h">👤 Account</p>' +
      '<p class="va-pane-sub">You\'re signed in to Volt. Manage your keys, sleep mode and usage from the tabs on the left.</p>' +
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
      "video.html": [["capBtn", "Generate captions", "💬"], ["exportBtn", "Export the short", "⬇️"], ["hlBtn", "Find best moments", "✂️"]],
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
      { t: "Guide", s: "How to use Volt", e: "📖", href: "guide.html" }
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
    ov.innerHTML = '<div id="vk"><input id="vk-in" type="text" placeholder="Search Volt — jump to a tool or run an action…" autocomplete="off" spellcheck="false" /><div id="vk-list"></div><div id="vk-foot"><span><b>↑↓</b> move</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div></div>';
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
    try { document.dispatchEvent(new CustomEvent("volt:orgsettings", { detail: s })); } catch (e) {}
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

  /* ---------- universal autosave — never lose typed work ---------- */
  function autosaveKey() { return "volt_autosave_" + (location.pathname.split("/").pop() || "index").toLowerCase(); }
  function autosaveFields() {
    return [].slice.call(document.querySelectorAll("input[id],textarea[id],select[id]")).filter(function (el) {
      if (/^(va-|vk-)/.test(el.id)) return false;
      if (el.hasAttribute("data-no-save")) return false;
      if (el.tagName === "INPUT") {
        var t = (el.type || "text").toLowerCase();
        if (["password", "file", "range", "color", "checkbox", "radio", "button", "submit", "reset", "hidden"].indexOf(t) >= 0) return false;
      }
      return true;
    });
  }
  var autosaveT, autosaveOn = false;
  function saveAutosave() {
    var m = {}; autosaveFields().forEach(function (el) { if (el.value) m[el.id] = el.value; });
    try { if (Object.keys(m).length) localStorage.setItem(autosaveKey(), JSON.stringify({ t: Date.now(), m: m })); else localStorage.removeItem(autosaveKey()); } catch (e) {}
  }
  function restoreAutosave() {
    var raw; try { raw = localStorage.getItem(autosaveKey()); } catch (e) { return; }
    if (!raw) return; var data; try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.m) return; var n = 0;
    // Only fill fields that are currently EMPTY — never clobber a tool's defaults or a hand-off.
    autosaveFields().forEach(function (el) {
      var val = data.m[el.id];
      if (val != null && val !== "" && !el.value) {
        el.value = val;
        try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
        n++;
      }
    });
    if (n) showToast("↩ Restored your unsaved edits");
  }
  function initAutosave() {
    if (autosaveOn) return; autosaveOn = true;
    document.addEventListener("input", function (e) {
      var el = e.target; if (!el || !el.id || /^(va-|vk-)/.test(el.id)) return;
      clearTimeout(autosaveT); autosaveT = setTimeout(saveAutosave, 600);
    }, true);
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
      '<p class="va-logo">Volt<span class="d">.</span></p>' +
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
  // Special titles by email; everyone else is greeted by the name in their email address.
  var OWNERS = {
    "joel@smesouthafrica.co.za": { name: "Joel", title: "Master" },
  };
  function maybeGreetOwner() {
    try {
      var em = (session && session.user && session.user.email ? String(session.user.email) : "").toLowerCase();
      if (!em) return;
      if (sessionStorage.getItem("volt_greeted")) return; // once per app session
      sessionStorage.setItem("volt_greeted", "1");
      var who = OWNERS[em];
      var name = who ? ((who.title ? who.title + " " : "") + who.name) : firstName(em);
      showOwnerGreeting("Welcome back, " + name);
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
        '<div class="vj-line" style="animation-delay:.25s">◇ Volt Intelligence — Online</div>' +
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
