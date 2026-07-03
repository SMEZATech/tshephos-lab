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
  function showBadge() {
    injectCSS();
    var old = document.getElementById("va-badge"); if (old) old.remove();
    var b = document.createElement("div"); b.id = "va-badge";
    b.innerHTML = '<span class="who">' + esc(firstName(session && session.user && session.user.email)) + '</span>' +
      '<button id="va-cmdk" title="Command menu">' + (isMac() ? "⌘K" : "Ctrl K") + '</button>' +
      '<button id="va-refresh" title="Check for updates">↻</button><button id="va-gear" title="Settings">⚙</button>';
    document.body.appendChild(b);
    document.getElementById("va-gear").addEventListener("click", showSettings);
    document.getElementById("va-refresh").addEventListener("click", function () { try { localStorage.setItem("volt_just_updated", "1"); } catch (e) {} location.reload(); });
    var ck = document.getElementById("va-cmdk"); if (ck) ck.addEventListener("click", function () { if (window.voltOpenCommand) window.voltOpenCommand(); });
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
      "audit.html": [["run", "Run the audit", "🔍"]],
      "analytics.html": [["run", "Analyze performance", "📊"]],
      "email.html": [["run", "Build the email", "✉️"], ["kitBtn", "Send to Kit", "📤"], ["saveDraftBtn", "Save draft", "💾"]],
      "video.html": [["capBtn", "Generate captions", "💬"], ["exportBtn", "Export the short", "⬇️"], ["hlBtn", "Find best moments", "✂️"]],
      "studio.html": [["btn-download", "Download HD PNG", "🖼️"], ["btn-download-zip", "Export all 6 slides (ZIP)", "🗂️"]]
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
      { t: "Audit", s: "Audit a profile", e: "🔍", href: "audit.html" },
      { t: "Analytics", s: "Performance & insights", e: "📊", href: "analytics.html" },
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

  function showApp() {
    var g = document.getElementById("va-gate"); if (g) g.remove();
    document.documentElement.style.overflow = "";
    showBadge();
    initCmdK();
    initAutosave();
    maybeOnboard();
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
