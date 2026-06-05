/* Volt Desktop — sign-in gate + per-user API keys. © 2026 Tshepho Joel.
   Loaded on every desktop page. Gates on an @smesouthafrica.co.za email, stores the
   user's own API keys locally, attaches them to every backend call, and blocks key-tools
   (with clear instructions) while letting key-free tools like Studio run.            */
(function () {
  "use strict";

  var LS = "volt_session_v1";
  var ORG = "@smesouthafrica.co.za";

  var KEYS = {
    gemini: {
      label: "Google Gemini",
      sub: "Powers Copy, Audit, Analytics, Email & video post-copy",
      url: "https://aistudio.google.com/apikey",
      how: "Sign in with Google, click \u201CCreate API key\u201D, then paste it here.",
    },
    groq: {
      label: "Groq",
      sub: "Powers auto-captions in the Video tool",
      url: "https://console.groq.com/keys",
      how: "Create a free account, open \u201CAPI Keys\u201D, click \u201CCreate API Key\u201D.",
    },
    postiz: {
      label: "Postiz",
      sub: "Powers Live analytics & Top posts",
      url: "https://postiz.com",
      how: "In Postiz, open Settings \u2192 Public API and copy your key + API URL.",
    },
    kit: {
      label: "Kit",
      sub: "Send newsletters to Kit (ConvertKit) as drafts",
      url: "https://app.kit.com/account_settings/developer_settings",
      how: "In Kit \u2192 Settings \u2192 Developer, create a V4 API key and paste it here.",
    },
  };

  function ses() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }
  function wipe() { try { localStorage.removeItem(LS); } catch (e) {} }
  function getKeys() { var s = ses() || {}; return s.keys || {}; }
  function validEmail(e) { e = String(e || "").trim().toLowerCase(); return e.length > ORG.length && /^[^@\s]+@/.test(e) && e.slice(-ORG.length) === ORG; }
  function firstName(e) {
    var n = String(e || "").split("@")[0].split(/[._-]+/)[0];
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : "there";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- fetch patch: attach the user's keys to backend calls, block if missing ---------- */
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = (typeof input === "string") ? input : ((input && input.url) || "");
      if (/\/api\//.test(url)) {
        var k = getKeys(), need = null;
        if (/\/api\/generate/.test(url)) need = "gemini";
        else if (/\/api\/transcribe/.test(url)) need = "groq";
        else if (/\/api\/postiz/.test(url)) need = "postiz";
        else if (/\/api\/kit/.test(url)) need = "kit";
        if (need && !(k[need] && String(k[need]).trim())) {
          var i = KEYS[need];
          return Promise.reject(new Error(i.label + " API key required. Click \u2699 (top-right) \u2192 add your " + i.label + " key. Get one at " + i.url));
        }
        init = init || {};
        var h = new Headers(init.headers || {});
        h.set("x-client", "desktop");
        if (k.gemini) h.set("x-gemini-key", String(k.gemini).trim());
        if (k.groq) h.set("x-groq-key", String(k.groq).trim());
        if (k.postiz) h.set("x-postiz-key", String(k.postiz).trim());
        if (k.postizUrl) h.set("x-postiz-url", String(k.postizUrl).trim());
        if (k.kit) h.set("x-kit-key", String(k.kit).trim());
        if (k.wpUrl) h.set("x-wp-url", String(k.wpUrl).trim());
        if (k.wpUser) h.set("x-wp-user", String(k.wpUser).trim());
        if (k.wpKey) h.set("x-wp-key", String(k.wpKey).trim());
        init.headers = h;
      }
      return _fetch(input, init);
    };
  }

  /* ---------- styles ---------- */
  var CSS = '' +
    '#va-gate,#va-modal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;' +
      'background:rgba(6,7,10,.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-modal{z-index:100001;}' +
    '.va-card{width:100%;max-width:540px;max-height:92vh;overflow-y:auto;background:linear-gradient(180deg,#14171F,#0f1218);border:1px solid rgba(255,255,255,.1);' +
      'border-radius:22px;padding:30px;box-shadow:0 30px 80px -30px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.05);color:#ECEEF3;}' +
    '.va-logo{font-family:"Unbounded","Plus Jakarta Sans",sans-serif;font-weight:800;font-size:34px;letter-spacing:-.02em;margin:0;}' +
    '.va-logo .d{color:#B6FF3D;}' +
    '.va-sub{color:#888F9D;font-size:14px;margin:6px 0 22px;line-height:1.5;}' +
    '.va-lbl{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888F9D;font-weight:700;margin:0 0 7px;}' +
    '.va-input{width:100%;box-sizing:border-box;background:#0D0F15;border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:12px 13px;color:#ECEEF3;' +
      'font-family:"Plus Jakarta Sans",sans-serif;font-size:14.5px;outline:none;transition:border-color .15s,box-shadow .15s;}' +
    '.va-input::placeholder{color:#565c68;}' +
    '.va-input:focus{border-color:#B6FF3D;box-shadow:0 0 0 4px rgba(182,255,61,.14);}' +
    '.va-err{color:#FF7C7C;font-size:12.5px;margin-top:6px;min-height:14px;}' +
    '.va-keys{margin-top:20px;border-top:1px solid rgba(255,255,255,.09);padding-top:18px;}' +
    '.va-keys-h{font-weight:800;font-size:15px;margin:0 0 4px;}' +
    '.va-keys-note{color:#5B616D;font-size:12.5px;line-height:1.5;margin:0 0 16px;}' +
    '.va-field{margin-bottom:16px;}' +
    '.va-field .row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;}' +
    '.va-field .nm{font-weight:700;font-size:14px;color:#ECEEF3;}' +
    '.va-field .pw{font-size:11.5px;color:#5B616D;}' +
    '.va-get{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;color:#B6FF3D;text-decoration:none;white-space:nowrap;border:1px solid rgba(182,255,61,.3);border-radius:8px;padding:4px 9px;}' +
    '.va-get:hover{background:rgba(182,255,61,.1);}' +
    '.va-how{color:#888F9D;font-size:12px;margin:7px 0 0;line-height:1.45;}' +
    '.va-btn{display:block;width:100%;margin-top:22px;font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;font-size:15.5px;color:#0A0B0F;background:#B6FF3D;border:none;border-radius:13px;padding:15px;cursor:pointer;transition:transform .12s,background .15s,opacity .15s;}' +
    '.va-btn:hover{background:#a3ec2b;transform:translateY(-1px);}' +
    '.va-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}' +
    '.va-foot{text-align:center;color:#4f5562;font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.05em;margin:18px 0 0;}' +
    '.va-row2{display:flex;gap:10px;margin-top:8px;}' +
    '.va-ghost{flex:1;background:transparent;border:1px solid rgba(255,255,255,.14);color:#ECEEF3;border-radius:11px;padding:13px;font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;font-size:14px;cursor:pointer;}' +
    '.va-ghost:hover{border-color:#FF7C7C;color:#FF7C7C;}' +
    '#va-badge{position:fixed;top:14px;right:16px;z-index:90000;display:flex;align-items:center;gap:8px;background:rgba(20,23,31,.85);backdrop-filter:blur(6px);' +
      'border:1px solid rgba(255,255,255,.12);border-radius:100px;padding:5px 6px 5px 13px;font-family:"Plus Jakarta Sans",sans-serif;}' +
    '#va-badge .who{font-size:12.5px;font-weight:700;color:#ECEEF3;}' +
    '#va-gear{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#0D0F15;color:#B6FF3D;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .14s;}' +
    '#va-gear:hover{background:#B6FF3D;color:#0A0B0F;}' +
    '.va-saved{color:#57E39A;font-size:12.5px;margin-top:10px;min-height:14px;text-align:center;}' +
    '#va-refresh{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#0D0F15;color:#B6FF3D;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .18s;margin-right:2px;}' +
    '#va-refresh:hover{background:#B6FF3D;color:#0A0B0F;transform:rotate(90deg);}' +
    '#va-toast{position:fixed;top:58px;right:16px;z-index:99999;background:#14171F;border:1px solid rgba(182,255,61,.4);color:#ECEEF3;font-family:"Plus Jakarta Sans",sans-serif;font-size:13px;font-weight:700;padding:10px 14px;border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.7);opacity:0;transform:translateY(-6px);transition:opacity .2s,transform .2s;}' +
    '#va-toast.show{opacity:1;transform:none;}';

  function injectCSS() {
    if (document.getElementById("va-style")) return;
    var st = document.createElement("style"); st.id = "va-style"; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- key fields (shared by gate + settings) ---------- */
  function keyFieldsHTML(prefix, vals) {
    vals = vals || {};
    var out = '<div class="va-keys"><p class="va-keys-h">Your API keys</p>' +
      '<p class="va-keys-note">Studio works without keys. Every other tool needs its matching key \u2014 add them now or later via \u2699 Settings.</p>';
    ["gemini", "groq", "postiz", "kit"].forEach(function (id) {
      var i = KEYS[id];
      out += '<div class="va-field">' +
        '<div class="row"><span class="nm">' + i.label + ' <span class="pw">\u00B7 ' + esc(i.sub) + '</span></span>' +
        '<a class="va-get" href="' + i.url + '" target="_blank" rel="noopener">Get key \u2197</a></div>' +
        '<input class="va-input" id="' + prefix + '-' + id + '" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your ' + i.label + ' key" value="' + esc(vals[id] || "") + '" />' +
        '<p class="va-how">' + i.how + '</p>' +
        '</div>';
    });
    // Postiz API URL (only relevant with a Postiz key)
    out += '<div class="va-field">' +
      '<div class="row"><span class="nm">Postiz API URL <span class="pw">\u00B7 leave blank for Postiz cloud</span></span></div>' +
      '<input class="va-input" id="' + prefix + '-postizUrl" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.postiz.com/public/v1" value="' + esc(vals.postizUrl || "") + '" /></div>';
    // WordPress (email image hosting) \u2014 all three needed for uploads to host
    out += '<div class="va-field">' +
      '<div class="row"><span class="nm">WordPress \u2014 email image hosting <span class="pw">\u00B7 optional</span></span></div>' +
      '<input class="va-input" id="' + prefix + '-wpUrl" type="text" autocomplete="off" spellcheck="false" placeholder="Site URL \u2014 https://smesouthafrica.co.za" value="' + esc(vals.wpUrl || "") + '" style="margin-bottom:8px;" />' +
      '<input class="va-input" id="' + prefix + '-wpUser" type="text" autocomplete="off" spellcheck="false" placeholder="WordPress username" value="' + esc(vals.wpUser || "") + '" style="margin-bottom:8px;" />' +
      '<input class="va-input" id="' + prefix + '-wpKey" type="text" autocomplete="off" spellcheck="false" placeholder="Application password" value="' + esc(vals.wpKey || "") + '" />' +
      '<p class="va-how">In WordPress: Users \u2192 Profile \u2192 Application Passwords \u2192 add one for \u201CVolt\u201D.</p>' +
      '</div></div>';
    return out;
  }
  function readKeyFields(prefix) {
    function v(id) { var el = document.getElementById(prefix + "-" + id); return el ? el.value.trim() : ""; }
    return { gemini: v("gemini"), groq: v("groq"), postiz: v("postiz"), postizUrl: v("postizUrl"), kit: v("kit"), wpUrl: v("wpUrl"), wpUser: v("wpUser"), wpKey: v("wpKey") };
  }

  /* ---------- sign-in gate ---------- */
  function showGate() {
    injectCSS();
    if (document.getElementById("va-gate")) return;
    var existing = ses() || {};
    var gate = document.createElement("div");
    gate.id = "va-gate";
    gate.innerHTML =
      '<div class="va-card">' +
        '<p class="va-logo">Volt<span class="d">.</span></p>' +
        '<p class="va-sub">SME South Africa\u2019s in-house marketing suite. Sign in with your work email to continue.</p>' +
        '<label class="va-lbl" for="va-email">Work email</label>' +
        '<input class="va-input" id="va-email" type="email" autocomplete="off" spellcheck="false" placeholder="you' + ORG + '" value="' + esc(existing.email || "") + '" />' +
        '<div class="va-err" id="va-email-err"></div>' +
        keyFieldsHTML("va-gate", existing.keys || {}) +
        '<button class="va-btn" id="va-enter" disabled>Enter Volt</button>' +
        '<p class="va-foot">For SME South Africa internal use only.</p>' +
      '</div>';
    document.body.appendChild(gate);
    document.documentElement.style.overflow = "hidden";

    var email = document.getElementById("va-email");
    var err = document.getElementById("va-email-err");
    var btn = document.getElementById("va-enter");
    function check() {
      var ok = validEmail(email.value);
      btn.disabled = !ok;
      err.textContent = (email.value && !ok) ? ("Use your " + ORG + " email address.") : "";
    }
    email.addEventListener("input", check);
    email.addEventListener("keydown", function (e) { if (e.key === "Enter" && !btn.disabled) btn.click(); });
    check();
    btn.addEventListener("click", function () {
      if (!validEmail(email.value)) { check(); return; }
      save({ email: email.value.trim().toLowerCase(), keys: readKeyFields("va-gate"), at: Date.now() });
      gate.remove();
      document.documentElement.style.overflow = "";
      showBadge();
    });
    setTimeout(function () { email.focus(); }, 50);
  }

  /* ---------- top-right badge ---------- */
  function showBadge() {
    injectCSS();
    var old = document.getElementById("va-badge"); if (old) old.remove();
    var s = ses() || {};
    var b = document.createElement("div");
    b.id = "va-badge";
    b.innerHTML = '<span class="who">' + esc(firstName(s.email)) + '</span><button id="va-refresh" title="Check for updates">\u21bb</button><button id="va-gear" title="Settings">\u2699</button>';
    document.body.appendChild(b);
    document.getElementById("va-gear").addEventListener("click", showSettings);
    document.getElementById("va-refresh").addEventListener("click", function () {
      try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {}
      location.reload();
    });
  }

  /* ---------- settings modal ---------- */
  function showSettings() {
    injectCSS();
    if (document.getElementById("va-modal")) return;
    var s = ses() || {};
    var m = document.createElement("div");
    m.id = "va-modal";
    m.innerHTML =
      '<div class="va-card">' +
        '<p class="va-logo" style="font-size:24px;">Settings</p>' +
        '<p class="va-sub" style="margin-bottom:16px;">Signed in as <b style="color:#ECEEF3;">' + esc(s.email || "") + '</b></p>' +
        keyFieldsHTML("va-set", s.keys || {}) +
        '<button class="va-btn" id="va-save">Save keys</button>' +
        '<div class="va-saved" id="va-saved"></div>' +
        '<div class="va-row2"><button class="va-ghost" id="va-signout">Sign out</button><button class="va-ghost" id="va-close" style="border-color:rgba(255,255,255,.14);color:#888F9D;">Close</button></div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.getElementById("va-save").addEventListener("click", function () {
      var cur = ses() || {};
      cur.keys = readKeyFields("va-set"); save(cur);
      document.getElementById("va-saved").textContent = "Saved \u2713";
      setTimeout(function () { var el = document.getElementById("va-saved"); if (el) el.textContent = ""; }, 1600);
    });
    document.getElementById("va-close").addEventListener("click", function () { m.remove(); });
    document.getElementById("va-signout").addEventListener("click", function () {
      wipe(); m.remove(); location.reload();
    });
  }

  /* ---------- init ---------- */
  function showToast(msg) {
    injectCSS();
    var old = document.getElementById("va-toast"); if (old) old.parentNode.removeChild(old);
    var t = document.createElement("div"); t.id = "va-toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 30);
    setTimeout(function () { t.classList.remove("show"); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }
  function init() {
    var s = ses();
    if (s && validEmail(s.email)) {
      showBadge();
      var f = null; try { f = localStorage.getItem("volt_just_updated"); } catch (e) {}
      if (f) { try { localStorage.removeItem("volt_just_updated"); } catch (e) {} showToast("✓ You're on the latest version"); }
    } else showGate();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
