/* Optional accounts for the Library Catalogue (Supabase Auth + two RLS-protected tables).
   Signed-out visitors make no Supabase requests: vendor/supabase.js is only loaded when someone
   clicks Sign in, or a saved session / sign-in redirect is already present.
   All user data is written with textContent. Nothing here logs tokens. */
(function () {
  "use strict";

  var CFG = window.CATALOGUE_CONFIG || {};
  var LIMITS = { searches: 200, entries: 1000 };
  var REF = (/^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(CFG.SUPABASE_URL || "") || [])[1] || "";
  var STORE_PREFIX = "sb-" + REF + "-auth-token";
  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var sb = null, loading = null;
  var user = null;
  var saved = new Map();   // entry_id -> row
  var searches = [];       // newest first
  var mode = "signin";     // or "signup"
  var lastFocus = null, openEl = null;
  var pendingNote = "";

  /* —— helpers —— */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }
  function C() { return window.LibraryCatalogue || null; }
  function entries() { var c = C(); return c && c.entries ? c.entries() : []; }
  function entryById(id) { var l = entries(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function redirectUrl() { return location.origin + location.pathname; }
  function say(node, text, isErr) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("err", !!isErr);
    clearTimeout(node._t);
    if (text && !isErr) node._t = setTimeout(function () { node.textContent = ""; }, 4000);
  }

  function friendly(err) {
    var e = err || {};
    var code = String(e.code || e.error_code || "");
    var msg = String(e.message || e.msg || e.error_description || "");
    var status = Number(e.status || 0);
    if ((typeof navigator !== "undefined" && navigator.onLine === false) || /failed to fetch|networkerror|load failed|network request failed/i.test(msg))
      return "You look to be offline. Check your connection and try again.";
    if (status === 429 || /rate.?limit|too many/i.test(code + " " + msg)) return "Too many tries in a short time. Wait a minute and try again.";
    if (e.hint === "ROW_CAP" || /row cap reached/i.test(msg)) {
      return /saved_entries/.test(msg) ? "You've saved the most tools allowed (1,000). Remove some to save more."
        : "You've saved the most searches allowed (200). Delete some to save more.";
    }
    if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) return "Confirm your email first. Check your inbox for the link.";
    if (code === "user_already_exists" || /already registered/i.test(msg)) return "That email already has an account. Sign in instead.";
    if (code === "weak_password" || /password should/i.test(msg)) return "Pick a longer password (at least 8 characters).";
    if (code === "email_address_not_authorized" || /not authorized/i.test(msg)) return "Sign-in emails can't be sent to that address yet. Try again later.";
    if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(msg)) return "That email address doesn't look right.";
    if (code === "provider_disabled" || /provider is not enabled/i.test(msg)) return "That sign-in method isn't switched on yet.";
    if (code === "42501" || /row-level security|permission denied|jwt/i.test(msg)) return "Your session has ended. Sign in again.";
    if (code === "23505") return "Already saved.";
    return "Something went wrong. Try again.";
  }

  function hasStoredSession() {
    if (!REF) return false;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(STORE_PREFIX) === 0) return true;
      }
    } catch (err) { return false; }
    return false;
  }
  function isAuthRedirect() {
    var q = new URLSearchParams(location.search);
    return q.has("code") || q.has("error_description");
  }
  function cleanAuthParams() {
    var q = new URLSearchParams(location.search), touched = false;
    ["code", "error", "error_code", "error_description"].forEach(function (k) { if (q.has(k)) { q.delete(k); touched = true; } });
    if (!touched) return;
    var s = q.toString();
    history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
  }

  /* —— lazy client —— */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to fetch")); };
      document.head.appendChild(s);
    });
  }
  function client() {
    if (sb) return Promise.resolve(sb);
    if (loading) return loading;
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY) return Promise.reject(new Error("Accounts aren't set up."));
    var ready = window.supabase && window.supabase.createClient ? Promise.resolve() : loadScript("vendor/supabase.js");
    loading = ready.then(function () {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      sb.auth.onAuthStateChange(function (event, session) {
        // Defer: supabase-js advises against awaiting other calls inside this callback.
        setTimeout(function () { setUser(session && session.user ? session.user : null); }, 0);
      });
      return sb.auth.getSession().then(function (r) {
        cleanAuthParams();
        if (r && r.error) say(els.msg, friendly(r.error), true);
        setUser(r && r.data && r.data.session ? r.data.session.user : null);
        return sb;
      });
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* —— state —— */
  function setUser(u) {
    var prev = user ? user.id : null;
    user = u;
    if ((u ? u.id : null) === prev) { paintHeader(); return; }
    saved = new Map(); searches = [];
    var c = C();
    if (!u && c) c.state.savedOnly = false;
    paintHeader();
    paintSaveButtons();
    if (c && c.loaded) c.refresh();
    if (u) {
      if (openEl === els.auth) { closeModal(); }
      loadAll();
    }
  }

  function loadAll() {
    if (!sb || !user) return Promise.resolve();
    return Promise.all([
      sb.from("saved_entries").select("entry_id,name,source_url,created_at").order("created_at", { ascending: false }).limit(LIMITS.entries),
      sb.from("saved_searches").select("id,label,query,filters,prompt,created_at").order("created_at", { ascending: false }).limit(LIMITS.searches)
    ]).then(function (res) {
      var bad = res[0].error || res[1].error;
      if (bad) { say(els.msg, friendly(bad), true); return; }
      saved = new Map();
      (res[0].data || []).forEach(function (r) { saved.set(r.entry_id, r); });
      searches = res[1].data || [];
      paintSaveButtons();
      paintLibrary();
      var c = C(); if (c && c.loaded && c.state.savedOnly) c.refresh();
    }, function (err) { say(els.msg, friendly(err), true); });
  }

  /* —— header —— */
  function paintHeader() {
    var on = !!user;
    els.email.hidden = !on;
    els.email.textContent = on ? (user.email || "Signed in") : "";
    els.signin.hidden = on;
    els.signout.hidden = !on;
    els.library.hidden = !on;
    els.savedOnly.hidden = !on;
    var c = C(), pressed = !!(c && c.state.savedOnly);
    els.savedOnly.setAttribute("aria-pressed", pressed ? "true" : "false");
    els.savedOnly.classList.toggle("on", pressed);
  }

  /* —— save toggles on cards —— */
  function cardEntry(card) {
    var d = card.querySelector(".draft[data-i]");
    var l = entries();
    if (d) { var e = l[Number(d.getAttribute("data-i"))]; if (e) return e; }
    var id = card.getAttribute("data-id");
    return id ? entryById(id) : null;
  }
  function paintSave(btn) {
    var on = saved.has(btn.getAttribute("data-entry"));
    btn.textContent = on ? "★ Saved" : "☆ Save";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("on", on);
  }
  function decorate(root) {
    var cards = (root || document).querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i], foot = card.querySelector(".card-foot");
      if (!foot || foot.querySelector(".save")) continue;
      var e = cardEntry(card);
      if (!e) continue;
      var b = el("button", "btn btn-ghost save");
      b.type = "button";
      b.setAttribute("data-entry", e.id);
      b.setAttribute("aria-label", "Save " + e.name);
      paintSave(b);
      foot.insertBefore(b, foot.firstChild);
    }
  }
  function paintSaveButtons() {
    var bs = document.querySelectorAll(".card .save");
    for (var i = 0; i < bs.length; i++) paintSave(bs[i]);
  }

  function toggleSave(btn) {
    var id = btn.getAttribute("data-entry");
    if (!user) { openAuth("Sign in to save tools. It's optional, and nothing is saved until you do."); return; }
    var e = entryById(id) || { id: id, name: id, url: "" };
    var was = saved.has(id);
    var row = { entry_id: id, name: String(e.name || "").slice(0, 300), source_url: safeUrl(e.url) || null };
    if (!was && saved.size >= LIMITS.entries) { say(els.msg, friendly({ message: "row cap reached: saved_entries" }), true); return; }
    // optimistic, rolled back on error
    if (was) saved.delete(id); else saved.set(id, Object.assign({ created_at: new Date().toISOString() }, row));
    paintSaveButtons(); paintLibrary();
    btn.disabled = true;
    var q = was
      ? sb.from("saved_entries").delete().eq("entry_id", id)
      : sb.from("saved_entries").upsert(row, { onConflict: "user_id,entry_id", ignoreDuplicates: true });
    return Promise.resolve(q).then(function (r) {
      if (r && r.error) throw r.error;
      var c = C(); if (c && c.state.savedOnly) c.refresh();
    }).catch(function (err) {
      if (was) saved.set(id, row); else saved.delete(id);
      say(els.msg, friendly(err), true);
      paintSaveButtons(); paintLibrary();
    }).then(function () { btn.disabled = false; });
  }

  /* —— saved searches —— */
  function currentView() {
    var c = C(), s = c ? c.state : {};
    var hp = new URLSearchParams(location.hash.replace(/^#/, ""));
    var filters = {};
    ["type", "need", "licence", "tag"].forEach(function (k) { if (s[k]) filters[k] = String(s[k]).slice(0, 200); });
    filters.sort = s.sort === "rank" || s.sort === "name" ? s.sort : "best";
    return {
      query: s.q ? String(s.q).slice(0, 500) : null,
      filters: filters,
      prompt: hp.get("p") ? hp.get("p").slice(0, 2000) : null
    };
  }
  function defaultLabel(v) {
    var bits = [];
    if (v.query) bits.push(v.query);
    if (v.prompt) bits.push(v.prompt.length > 60 ? v.prompt.slice(0, 57) + "…" : v.prompt);
    ["type", "need", "licence", "tag"].forEach(function (k) { if (v.filters[k]) bits.push(k + ": " + v.filters[k]); });
    var s = bits.join(" · ") || "All tools";
    return s.length > 120 ? s.slice(0, 119) + "…" : s;
  }
  function describe(v) {
    var bits = [];
    if (v.query) bits.push("Search “" + v.query + "”");
    if (v.prompt) bits.push("Project “" + (v.prompt.length > 80 ? v.prompt.slice(0, 77) + "…" : v.prompt) + "”");
    ["type", "need", "licence", "tag"].forEach(function (k) { if (v.filters && v.filters[k]) bits.push(k + " " + v.filters[k]); });
    if (v.filters && v.filters.sort && v.filters.sort !== "best") bits.push("sorted by " + v.filters.sort);
    return bits.join(", ") || "Whole catalogue";
  }

  function openSaveSearch() {
    if (!user) { openAuth("Sign in to save searches. It's optional, and nothing is saved until you do."); return; }
    var v = currentView();
    els.saveForm._view = v;
    els.saveSummary.textContent = describe(v);
    els.saveLabel.value = defaultLabel(v);
    say(els.saveStatus, "");
    openModal(els.save, els.saveLabel);
  }
  function submitSaveSearch(ev) {
    ev.preventDefault();
    var v = els.saveForm._view || currentView();
    var label = els.saveLabel.value.trim().slice(0, 120);
    if (!label) { say(els.saveStatus, "Give it a name.", true); return; }
    if (searches.length >= LIMITS.searches) { say(els.saveStatus, friendly({ message: "row cap reached: saved_searches" }), true); return; }
    els.saveSubmit.disabled = true;
    return Promise.resolve(sb.from("saved_searches").insert({ label: label, query: v.query, filters: v.filters, prompt: v.prompt }).select("id,label,query,filters,prompt,created_at").single())
      .then(function (r) {
        if (r && r.error) throw r.error;
        if (r && r.data) searches.unshift(r.data);
        paintLibrary();
        closeModal();
        say(els.msg, "Saved “" + label + "”. Find it in My library.");
      })
      .catch(function (err) { say(els.saveStatus, friendly(err), true); })
      .then(function () { els.saveSubmit.disabled = false; });
  }
  function restore(s) {
    var p = new URLSearchParams(), f = s.filters || {};
    if (s.query) p.set("q", s.query);
    ["type", "need", "licence", "tag"].forEach(function (k) { if (f[k]) p.set(k, String(f[k])); });
    if (f.sort === "rank" || f.sort === "name") p.set("sort", f.sort);
    if (s.prompt) p.set("p", s.prompt);
    var c = C(); if (c) { c.state.savedOnly = false; paintHeader(); }
    var h = p.toString();
    history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : ""));
    var ev;
    try { ev = new HashChangeEvent("hashchange"); } catch (err) { ev = document.createEvent("Event"); ev.initEvent("hashchange", false, false); }
    window.dispatchEvent(ev); // app.js and recommend.js both re-read the hash
    closeModal();
    var top = document.getElementById(s.prompt ? "rec" : "q");
    if (top && top.scrollIntoView) top.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function deleteSearch(s, btn) {
    btn.disabled = true;
    return Promise.resolve(sb.from("saved_searches").delete().eq("id", s.id)).then(function (r) {
      if (r && r.error) throw r.error;
      searches = searches.filter(function (x) { return x.id !== s.id; });
      paintLibrary();
    }).catch(function (err) { btn.disabled = false; say(els.libStatus, friendly(err), true); });
  }

  /* —— My library —— */
  function paintLibrary() {
    if (!els.libSearches) return;
    clear(els.libSearches); clear(els.libTools);
    els.libSCount.textContent = "(" + searches.length + ")";
    els.libTCount.textContent = "(" + saved.size + ")";
    if (!searches.length) els.libSearches.appendChild(el("li", "lib-empty", "No saved searches yet. Use “Save this search” above the results."));
    searches.forEach(function (s) {
      var li = el("li", "lib-item");
      var main = el("button", "linkbtn lib-open", s.label);
      main.type = "button";
      main.addEventListener("click", function () { restore(s); });
      li.appendChild(main);
      li.appendChild(el("span", "lib-sub", describe(s)));
      var del = el("button", "btn btn-ghost lib-del", "Delete");
      del.type = "button"; del.setAttribute("aria-label", "Delete saved search " + s.label);
      del.addEventListener("click", function () { deleteSearch(s, del); });
      li.appendChild(del);
      els.libSearches.appendChild(li);
    });
    if (!saved.size) els.libTools.appendChild(el("li", "lib-empty", "No saved tools yet. Press ☆ Save on any card."));
    saved.forEach(function (r, id) {
      var e = entryById(id);
      var name = (e && e.name) || r.name || id;
      var url = safeUrl((e && e.url) || r.source_url);
      var li = el("li", "lib-item");
      if (url) {
        var a = el("a", "lib-open", name);
        a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
        li.appendChild(a);
      } else li.appendChild(el("span", "lib-open", name));
      if (e) li.appendChild(el("span", "lib-sub", e.type + (e.need ? " · " + e.need : "")));
      var row = el("div", "lib-actions");
      var cp = el("button", "btn btn-ghost lib-draft", "Draft into skill");
      cp.type = "button";
      var note = el("span", "copied"); note.setAttribute("role", "status");
      cp.addEventListener("click", function () {
        var t = "Draft into skill: " + name + " (" + (url || "no link") + ")";
        var copy = C() && C().copy;
        (copy ? copy(t) : Promise.resolve(false)).then(function (ok) {
          note.textContent = ok ? "Copied. Paste into the Library Scout chat." : "Copy failed. Text: " + t;
          clearTimeout(note._t); note._t = setTimeout(function () { note.textContent = ""; }, ok ? 3500 : 10000);
        });
      });
      var rm = el("button", "btn btn-ghost lib-del", "Remove");
      rm.type = "button"; rm.setAttribute("aria-label", "Remove " + name);
      rm.setAttribute("data-entry", id);
      rm.addEventListener("click", function () { toggleSave(rm); });
      row.appendChild(cp); row.appendChild(rm); row.appendChild(note);
      li.appendChild(row);
      els.libTools.appendChild(li);
    });
  }

  /* —— modals —— */
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll("button, a[href], input, textarea, select"), function (n) {
      return !n.disabled && !n.hidden && !(n.closest && n.closest("[hidden]"));
    });
  }
  function openModal(overlay, focusEl) {
    if (openEl && openEl !== overlay) closeModal(true);
    if (!openEl) lastFocus = document.activeElement;
    openEl = overlay;
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    var f = focusEl || focusables(overlay)[0];
    if (f && f.focus) setTimeout(function () { f.focus(); }, 0);
  }
  function closeModal(keepFocus) {
    if (!openEl) return;
    openEl.hidden = true;
    openEl = null;
    document.body.classList.remove("modal-open");
    if (!keepFocus && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }

  function setMode(m) {
    mode = m;
    var up = m === "signup";
    els.authTitle.textContent = up ? "Create an account" : "Sign in";
    els.authSubmit.textContent = up ? "Create account" : "Sign in";
    els.authSwapText.textContent = up ? "Have an account?" : "No account yet?";
    els.authSwap.textContent = up ? "Sign in" : "Create one";
    els.authPassword.setAttribute("autocomplete", up ? "new-password" : "current-password");
    say(els.authStatus, "");
  }
  function openAuth(note, preload) {
    pendingNote = note || "";
    els.authNote.textContent = pendingNote;
    els.authNote.hidden = !pendingNote;
    els.google.hidden = CFG.GOOGLE_ENABLED !== true;
    els.authOr.hidden = CFG.GOOGLE_ENABLED !== true;
    setMode("signin");
    openModal(els.auth, els.authEmail);
    // From the Sign in button, load the client now so the first submit is quick.
    // From a Save click, wait until the visitor actually signs in.
    if (preload) client().catch(function (err) { say(els.authStatus, friendly(err), true); });
  }

  function busy(on) { [els.authSubmit, els.authMagic, els.google].forEach(function (b) { b.disabled = on; }); }
  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function submitAuth(ev) {
    ev.preventDefault();
    var email = els.authEmail.value.trim(), pw = els.authPassword.value;
    if (!emailOk(email)) { say(els.authStatus, "Enter your email address.", true); els.authEmail.focus(); return; }
    if (!pw) { say(els.authStatus, "Enter a password, or use the magic link.", true); els.authPassword.focus(); return; }
    if (mode === "signup" && pw.length < 8) { say(els.authStatus, "Pick a longer password (at least 8 characters).", true); return; }
    busy(true); say(els.authStatus, mode === "signup" ? "Creating your account…" : "Signing in…");
    return client().then(function (c) {
      return mode === "signup"
        ? c.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: redirectUrl() } })
        : c.auth.signInWithPassword({ email: email, password: pw });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      els.authPassword.value = "";
      if (mode === "signup" && !(r && r.data && r.data.session)) {
        say(els.authStatus, "Check your email for a link to confirm your account, then sign in.");
        els.authStatus._t && clearTimeout(els.authStatus._t);
      } else {
        setUser(r && r.data ? r.data.user || (r.data.session && r.data.session.user) : null);
      }
    }).catch(function (err) { say(els.authStatus, friendly(err), true); })
      .then(function () { busy(false); });
  }
  function magicLink() {
    var email = els.authEmail.value.trim();
    if (!emailOk(email)) { say(els.authStatus, "Enter your email address first.", true); els.authEmail.focus(); return; }
    busy(true); say(els.authStatus, "Sending…");
    return client().then(function (c) {
      return c.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      say(els.authStatus, "Check your email for a sign-in link. It works in this browser.");
      clearTimeout(els.authStatus._t);
    }).catch(function (err) { say(els.authStatus, friendly(err), true); })
      .then(function () { busy(false); });
  }
  function google() {
    if (CFG.GOOGLE_ENABLED !== true) return;
    busy(true);
    return client().then(function (c) {
      return c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl() } });
    }).then(function (r) { if (r && r.error) throw r.error; })
      .catch(function (err) { say(els.authStatus, friendly(err), true); busy(false); });
  }
  function signOut() {
    if (!sb) { setUser(null); return; }
    return Promise.resolve(sb.auth.signOut()).then(function (r) {
      if (r && r.error) throw r.error;
    }).catch(function () { /* local session is cleared either way */ }).then(function () {
      closeModal(true);
      setUser(null);
      say(els.msg, "Signed out.");
    });
  }

  /* —— wiring —— */
  function bind() {
    els.signin.addEventListener("click", function () { openAuth("", true); });
    els.signout.addEventListener("click", signOut);
    els.library.addEventListener("click", function () { paintLibrary(); openModal(els.lib); });
    els.saveSearch.addEventListener("click", openSaveSearch);
    els.recSave.addEventListener("click", openSaveSearch);
    els.savedOnly.addEventListener("click", function () {
      var c = C(); if (!c) return;
      c.state.savedOnly = !c.state.savedOnly;
      paintHeader();
      c.refresh();
    });
    var clearBtn = $("clear");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      var c = C(); if (c && c.state.savedOnly) { c.state.savedOnly = false; paintHeader(); c.refresh(); }
    }, true);
    els.authForm.addEventListener("submit", submitAuth);
    els.authMagic.addEventListener("click", magicLink);
    els.google.addEventListener("click", google);
    els.authSwap.addEventListener("click", function () { setMode(mode === "signup" ? "signin" : "signup"); els.authEmail.focus(); });
    els.saveForm.addEventListener("submit", submitSaveSearch);
    [els.auth, els.save, els.lib].forEach(function (o) {
      o.addEventListener("click", function (ev) {
        if (ev.target === o || (ev.target.closest && ev.target.closest("[data-close]"))) closeModal();
      });
    });
    document.addEventListener("keydown", function (ev) {
      if (!openEl) return;
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeModal(); return; }
      if (ev.key === "Tab") {
        var f = focusables(openEl); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    }, true);
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".card .save") : null;
      if (b) toggleSave(b);
    });
    // Show the recommender's save button only when there is a prompt result.
    var recOut = $("rec-out");
    var watch = function () {
      decorate(document);
      if (recOut) els.recSave.hidden = recOut.hidden;
    };
    if (window.MutationObserver) {
      var mo = new MutationObserver(watch);
      ["grid", "rec-out"].forEach(function (id) { var n = $(id); if (n) mo.observe(n, id === "rec-out" ? { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] } : { childList: true, subtree: true }); });
    }
    document.addEventListener("catalogue:ready", watch);
    watch();
  }

  function init() {
    els.email = $("acct-email"); els.signin = $("acct-signin"); els.signout = $("acct-signout"); els.library = $("acct-library");
    els.msg = $("acct-msg"); els.saveSearch = $("save-search"); els.recSave = $("rec-save"); els.savedOnly = $("saved-only");
    els.auth = $("auth-modal"); els.authTitle = $("auth-title"); els.authNote = $("auth-note"); els.google = $("auth-google"); els.authOr = $("auth-or");
    els.authForm = $("auth-form"); els.authEmail = $("auth-email"); els.authPassword = $("auth-password");
    els.authSubmit = $("auth-submit"); els.authMagic = $("auth-magic"); els.authSwap = $("auth-swap"); els.authSwapText = $("auth-swap-text"); els.authStatus = $("auth-status");
    els.save = $("save-modal"); els.saveForm = $("save-form"); els.saveLabel = $("save-label"); els.saveSubmit = $("save-submit"); els.saveSummary = $("save-summary"); els.saveStatus = $("save-status");
    els.lib = $("library"); els.libStatus = $("lib-status"); els.libSearches = $("lib-searches"); els.libTools = $("lib-tools"); els.libSCount = $("lib-s-count"); els.libTCount = $("lib-t-count");
    if (!els.signin || !els.auth) return;
    var c = C(); if (c && c.hooks) c.hooks.isSaved = function (id) { return saved.has(id); };
    bind();
    paintHeader();
    if (hasStoredSession() || isAuthRedirect()) client().catch(function (err) { say(els.msg, friendly(err), true); });
  }

  window.LibraryAccount = {
    _client: function () { return client(); },
    user: function () { return user; },
    saved: function () { return Array.from(saved.keys()); },
    searches: function () { return searches.slice(); },
    friendly: friendly
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
