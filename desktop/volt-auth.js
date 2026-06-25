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
    gemini: { label: "Google Gemini", sub: "Powers Copy, Audit, Analytics, Email & video copy", url: "https://aistudio.google.com/apikey" },
    groq:   { label: "Groq", sub: "Powers auto-captions in Video", url: "https://console.groq.com/keys" },
    postiz: { label: "Postiz", sub: "Live analytics & top posts", url: "https://postiz.com" },
    kit:    { label: "Kit", sub: "Send newsletters to Kit as drafts", url: "https://app.kit.com/account_settings/developer_settings" },
  };

  function isDesktop() { return !!window.voltNative; }
  function getKeys() { try { return JSON.parse(localStorage.getItem(KEYS_LS) || "{}"); } catch (e) { return {}; } }
  function saveKeys(k) { try { localStorage.setItem(KEYS_LS, JSON.stringify(k)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function firstName(email) { var n = String(email || "").split("@")[0].split(/[._-]+/)[0]; return n ? n.charAt(0).toUpperCase() + n.slice(1) : "there"; }

  /* ---------- fetch patch: attach the session token (+ desktop keys) to backend calls ---------- */
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
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
          if (k.groq) h.set("x-groq-key", String(k.groq).trim());
          if (k.postiz) h.set("x-postiz-key", String(k.postiz).trim());
          if (k.postizUrl) h.set("x-postiz-url", String(k.postizUrl).trim());
          if (k.kit) h.set("x-kit-key", String(k.kit).trim());
          if (k.wpUrl) h.set("x-wp-url", String(k.wpUrl).trim());
          if (k.wpUser) h.set("x-wp-user", String(k.wpUser).trim());
          if (k.wpKey) h.set("x-wp-key", String(k.wpKey).trim());
        }
        init.headers = h;
      }
      return _fetch(input, init);
    };
  }

  /* ---------- styles ---------- */
  var CSS = '' +
    '#va-gate,#va-modal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(6,7,10,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
    '#va-modal{z-index:100001;}' +
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
    '#va-toast{position:fixed;top:58px;right:16px;z-index:99999;background:#14171F;border:1px solid rgba(182,255,61,.4);color:#ECEEF3;font-family:"Plus Jakarta Sans",sans-serif;font-size:13px;font-weight:700;padding:10px 14px;border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.7);opacity:0;transition:opacity .2s;}#va-toast.show{opacity:1;}';

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
      setTimeout(function () { email.focus(); }, 50);
    }
    if (errMsg) { var el = document.getElementById("va-err"); if (el) el.textContent = errMsg; }
  }

  /* ---------- badge + toast ---------- */
  function showBadge() {
    injectCSS();
    var old = document.getElementById("va-badge"); if (old) old.remove();
    var b = document.createElement("div"); b.id = "va-badge";
    b.innerHTML = '<span class="who">' + esc(firstName(session && session.user && session.user.email)) + '</span>' +
      '<button id="va-refresh" title="Check for updates">↻</button><button id="va-gear" title="Settings">⚙</button>';
    document.body.appendChild(b);
    document.getElementById("va-gear").addEventListener("click", showSettings);
    document.getElementById("va-refresh").addEventListener("click", function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); });
  }
  function showToast(msg) {
    injectCSS();
    var t = document.createElement("div"); t.id = "va-toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 30);
    setTimeout(function () { t.classList.remove("show"); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  /* ---------- settings (keys on desktop + sign out) ---------- */
  function keyFieldsHTML() {
    var k = getKeys();
    var out = '<div class="va-keys"><p class="va-keys-h">Your API keys</p><p class="va-keys-note">Studio needs no key. Each other tool uses its matching key.</p>';
    ["gemini", "groq", "postiz", "kit"].forEach(function (id) {
      var i = KEYS[id];
      out += '<div class="va-field"><div><span class="nm">' + i.label + ' <span class="pw">· ' + esc(i.sub) + '</span></span><a class="va-get" href="' + i.url + '" target="_blank" rel="noopener">Get key ↗</a></div>' +
        '<input class="va-input" id="va-k-' + id + '" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your ' + i.label + ' key" value="' + esc(k[id] || "") + '" style="margin-top:6px;" /></div>';
    });
    out += '<div class="va-field"><span class="nm">Postiz API URL <span class="pw">· blank = cloud</span></span><input class="va-input" id="va-k-postizUrl" type="text" autocomplete="off" placeholder="https://api.postiz.com/public/v1" value="' + esc(k.postizUrl || "") + '" style="margin-top:6px;" /></div></div>';
    return out;
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
      '<div id="va-bill"></div>' +
      '<div class="va-row"><button class="va-btn va-ghost" id="va-signout">Sign out</button><button class="va-btn va-ghost" id="va-close" style="color:#888F9D;">Close</button></div></div>';
    document.body.appendChild(m);
    loadBilling();
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    var save = document.getElementById("va-save");
    if (save) save.addEventListener("click", function () {
      function v(id) { var el = document.getElementById("va-k-" + id); return el ? el.value.trim() : ""; }
      saveKeys({ gemini: v("gemini"), groq: v("groq"), postiz: v("postiz"), postizUrl: v("postizUrl"), kit: v("kit"), wpUrl: getKeys().wpUrl, wpUser: getKeys().wpUser, wpKey: getKeys().wpKey });
      var s = document.getElementById("va-saved"); if (s) { s.textContent = "Saved ✓"; setTimeout(function () { s.textContent = ""; }, 1500); }
    });
    document.getElementById("va-close").addEventListener("click", function () { m.remove(); });
    document.getElementById("va-signout").addEventListener("click", function () { if (sb) sb.auth.signOut(); m.remove(); });
  }

  /* ---------- app shown / hidden ---------- */
  function showApp() {
    var g = document.getElementById("va-gate"); if (g) g.remove();
    document.documentElement.style.overflow = "";
    showBadge();
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
      sb.auth.getSession().then(function (r) {
        session = r.data.session;
        if (session) showApp();
        sb.auth.onAuthStateChange(function (_e, s) { session = s; if (s) showApp(); else showGate(); });
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
