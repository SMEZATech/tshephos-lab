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
    postiz:     { label: "Postiz", sub: "Live analytics & top posts", url: "https://postiz.com" },
    kit:        { label: "Kit", sub: "Send newsletters to Kit as drafts", url: "https://app.kit.com/account_settings/developer_settings" },
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
    { t: "Studio", e: "🎨", href: "studio.html" },
    { t: "Freeform", e: "🖌️", href: "freeform.html" },
    { t: "Video", e: "🎬", href: "video.html" },
    { t: "Transcribe", e: "📝", href: "videotok.html" },
    { t: "Email", e: "✉️", href: "email.html" },
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

  /* ---------- settings (keys on desktop + sign out) ---------- */
  function keyFieldsHTML() {
    var k = getKeys();
    var out = '<div class="va-keys"><p class="va-keys-h">Your API keys</p><p class="va-keys-note">Studio needs no key. Add as many AI keys as you like — Volt tries them top-to-bottom and auto-falls-over to the next when one is rate-limited or out of quota. More keys = fewer interruptions.</p>';
    ["gemini", "gemini2", "groq", "cerebras", "openrouter", "mistral", "openai", "postiz", "kit"].forEach(function (id) {
      var i = KEYS[id];
      out += '<div class="va-field"><div><span class="nm">' + i.label + ' <span class="pw">· ' + esc(i.sub) + '</span></span><a class="va-get" href="' + i.url + '" target="_blank" rel="noopener">Get key ↗</a></div>' +
        '<input class="va-input" id="va-k-' + id + '" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your ' + i.label + ' key" value="' + esc(k[id] || "") + '" style="margin-top:6px;" /></div>';
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
  function showSettings() {
    injectCSS();
    if (document.getElementById("va-modal")) return;
    var m = document.createElement("div"); m.id = "va-modal";
    m.innerHTML = '<div class="va-card"><p class="va-logo" style="font-size:22px;">Settings</p>' +
      '<p class="va-sub" style="margin-bottom:14px;">Signed in as <b style="color:#ECEEF3;">' + esc(session && session.user && session.user.email) + '</b></p>' +
      (isDesktop() ? keyFieldsHTML() + '<button class="va-btn va-primary" id="va-save" style="width:100%;margin-top:8px;">Save keys</button><div class="va-saved" id="va-saved"></div>' : '<p class="va-keys-note" style="margin:0 0 8px;">Keys are managed centrally on the web app.</p>') +
      (isDesktop() ? ollamaFieldsHTML() : '') +
      '<div id="va-bill"></div>' +
      '<div class="va-row"><button class="va-btn va-ghost" id="va-signout">Sign out</button><button class="va-btn va-ghost" id="va-close" style="color:#888F9D;">Close</button></div></div>';
    document.body.appendChild(m);
    loadBilling();
    ["va-oll-on", "va-oll-model", "va-oll-url"].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener("change", saveOllama); });
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    var save = document.getElementById("va-save");
    if (save) save.addEventListener("click", function () {
      function v(id) { var el = document.getElementById("va-k-" + id); return el ? el.value.trim() : ""; }
      saveKeys({ gemini: v("gemini"), gemini2: v("gemini2"), groq: v("groq"), cerebras: v("cerebras"), openrouter: v("openrouter"), mistral: v("mistral"), openai: v("openai"), postiz: v("postiz"), postizUrl: v("postizUrl"), kit: v("kit"), wpUrl: getKeys().wpUrl, wpUser: getKeys().wpUser, wpKey: getKeys().wpKey });
      var s = document.getElementById("va-saved"); if (s) { s.textContent = "Saved ✓"; setTimeout(function () { s.textContent = ""; }, 1500); }
    });
    document.getElementById("va-close").addEventListener("click", function () { m.remove(); });
    document.getElementById("va-signout").addEventListener("click", function () { if (sb) sb.auth.signOut(); m.remove(); });
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

  /* ---------- personalized "Jarvis" welcome (owner-only for now) ---------- */
  // Roll-out: add more emails here (lowercase) → each gets their own greeting. Empty title = plain "Welcome back".
  var OWNERS = {
    "adops@adclickafrica.com": { name: "Joel", title: "Master" },
  };
  function maybeGreetOwner() {
    try {
      var em = (session && session.user && session.user.email ? String(session.user.email) : "").toLowerCase();
      var who = OWNERS[em];
      if (!who) return;
      if (sessionStorage.getItem("volt_greeted")) return; // once per app session
      sessionStorage.setItem("volt_greeted", "1");
      var hi = "Welcome back, " + (who.title ? who.title + " " : "") + who.name;
      showOwnerGreeting(hi);
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
