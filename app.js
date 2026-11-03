/* Library Catalogue: static, no framework, no API calls. Reads data.json. */
(function () {
  "use strict";

  var PAGE = 100;
  var FACETS = ["type", "need", "licence"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  var all = [];
  var maxRank = 1;
  var state = { q: "", type: "", need: "", licence: "", tag: "", sort: "best", limit: PAGE };
  var current = [];
  var terms = [];
  var termRe = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function fmt(n) { return Number(n).toLocaleString("en-GB"); }

  function hl(text) {
    text = String(text == null ? "" : text);
    if (!termRe) return esc(text);
    var parts = text.split(termRe);
    var out = "";
    for (var i = 0; i < parts.length; i++) out += i % 2 ? "<mark>" + esc(parts[i]) + "</mark>" : esc(parts[i]);
    return out;
  }

  function safeUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }

  function prep(e, i) {
    var tags = Array.isArray(e.tags) ? e.tags.map(String) : [];
    var x = {
      i: i,
      id: String(e.id || i),
      rank: typeof e.rank === "number" ? e.rank : null,
      name: String(e.name || e.id || ""),
      type: String(e.type || "other"),
      need: String(e.need || tags[0] || ""),
      tags: tags,
      summary: String(e.summary || ""),
      use_when: String(e.use_when || ""),
      author: String(e.author || ""),
      licence: String(e.licence || "none stated"),
      url: safeUrl(e.url)
    };
    x.l = {
      name: x.name.toLowerCase(),
      tags: x.tags.join(" ").toLowerCase(),
      summary: x.summary.toLowerCase(),
      use: x.use_when.toLowerCase(),
      author: x.author.toLowerCase()
    };
    return x;
  }

  /* —— search —— */
  function score(e) {
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], l = e.l, ts = 0;
      if (l.name === t) ts += 14; else if (l.name.indexOf(t) === 0) ts += 10; else if (l.name.indexOf(t) >= 0) ts += 8;
      if (e.tags.indexOf(t) >= 0) ts += 6; else if (l.tags.indexOf(t) >= 0) ts += 4;
      if (e.need === t) ts += 2;
      if (l.summary.indexOf(t) >= 0) ts += 3;
      if (l.use.indexOf(t) >= 0) ts += 2;
      if (l.author.indexOf(t) >= 0) ts += 3;
      if (!ts) return 0; // every word must match somewhere
      s += ts;
    }
    return s;
  }

  function passes(e, skip) {
    if (skip !== "type" && state.type && e.type !== state.type) return false;
    if (skip !== "need" && state.need && e.need !== state.need) return false;
    if (skip !== "licence" && state.licence && e.licence !== state.licence) return false;
    if (state.tag && e.tags.indexOf(state.tag) < 0) return false;
    return true;
  }

  function byRank(a, b) {
    var ra = a.rank == null ? Infinity : a.rank, rb = b.rank == null ? Infinity : b.rank;
    return ra - rb || a.name.localeCompare(b.name, "en-GB");
  }

  function compute() {
    terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    termRe = terms.length ? new RegExp("(" + terms.slice().sort(function (a, b) { return b.length - a.length; }).map(reEsc).join("|") + ")", "gi") : null;
    var matched = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      e._s = terms.length ? score(e) : 1;
      if (e._s) matched.push(e);
    }
    // facet counts: search + every other filter
    var counts = {};
    FACETS.forEach(function (f) {
      var c = {};
      matched.forEach(function (e) { if (passes(e, f)) c[e[f]] = (c[e[f]] || 0) + 1; });
      counts[f] = c;
    });
    current = matched.filter(function (e) { return passes(e, null); });
    if (state.sort === "name") current.sort(function (a, b) { return a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || byRank(a, b); });
    else if (state.sort === "best" && terms.length) current.sort(function (a, b) { return best(b) - best(a) || byRank(a, b); });
    else current.sort(byRank);
    return counts;
  }
  function best(e) { return e._s + 6 * (1 - ((e.rank == null ? maxRank : e.rank) - 1) / maxRank); }

  /* —— render —— */
  function renderFacets(counts) {
    FACETS.forEach(function (f) {
      var c = counts[f], sel = els[f], total = 0;
      Object.keys(c).forEach(function (k) { total += c[k]; });
      var keys = Object.keys(c).filter(function (k) { return k; });
      if (state[f] && keys.indexOf(state[f]) < 0) keys.push(state[f]);
      keys.sort(function (a, b) { return (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      var html = '<option value="">All (' + fmt(total) + ")</option>";
      keys.forEach(function (k) {
        html += '<option value="' + esc(k) + '">' + esc(k) + " (" + fmt(c[k] || 0) + ")</option>";
      });
      sel.innerHTML = html;
      sel.value = state[f];
    });
    els.sort.value = state.sort;
  }

  function card(e) {
    var name = hl(e.name);
    var title = e.url
      ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + name + '<span class="ext" aria-hidden="true">↗</span></a>'
      : name;
    var tags = e.tags.map(function (t) {
      return '<button type="button" class="tag' + (t === state.tag ? " on" : "") + '" data-tag="' + esc(t) + '">' + hl(t) + "</button>";
    }).join("");
    return '<article class="card" data-id="' + esc(e.id) + '">' +
      '<div class="card-head"><span class="rank" title="Rank">#' + (e.rank == null ? "–" : e.rank) + '</span><h2 class="name">' + title + "</h2></div>" +
      '<div class="meta"><span class="pill type">' + esc(e.type) + "</span>" +
      (e.need ? '<span class="pill" title="Need">' + esc(e.need) + "</span>" : "") +
      '<span class="pill" title="Licence">' + esc(e.licence) + "</span></div>" +
      (e.summary ? '<p class="summary">' + hl(e.summary) + "</p>" : "") +
      (e.use_when ? '<p class="use"><b>Use when:</b> ' + hl(e.use_when) + "</p>" : "") +
      (e.author ? '<p class="byline">By ' + hl(e.author) + "</p>" : "") +
      (tags ? '<div class="tags">' + tags + "</div>" : "") +
      '<div class="card-foot"><button type="button" class="btn btn-ghost draft" data-i="' + e.i + '">Draft into skill</button>' +
      '<span class="copied" role="status" aria-live="polite"></span></div>' +
      "</article>";
  }

  function renderList() {
    var shown = Math.min(state.limit, current.length);
    var html = "";
    for (var i = 0; i < shown; i++) html += card(current[i]);
    els.grid.innerHTML = html;
    els.count.textContent = all.length ? "Showing " + fmt(shown) + " of " + fmt(current.length) : "";
    els.empty.hidden = current.length > 0;
    if (!all.length) els.empty.textContent = "Catalogue is empty.";
    else if (!current.length) els.empty.textContent = "No matches. Try fewer words or clear the filters.";
    els.more.hidden = shown >= current.length;
    els.showMore.textContent = "Show more (" + fmt(Math.min(PAGE, current.length - shown)) + ")";
    if (state.tag) {
      els.activeTag.hidden = false;
      els.activeTag.innerHTML = 'Tag: <b>' + esc(state.tag) + '</b><button type="button" class="tag on" id="untag" aria-label="Remove tag filter">×</button>';
    } else {
      els.activeTag.hidden = true;
      els.activeTag.innerHTML = "";
    }
  }

  function render() { renderFacets(compute()); renderList(); }

  /* —— hash state —— */
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ""));
    state.q = p.get("q") || "";
    state.type = p.get("type") || "";
    state.need = p.get("need") || "";
    state.licence = p.get("licence") || "";
    state.tag = p.get("tag") || "";
    var s = p.get("sort");
    state.sort = s === "rank" || s === "name" ? s : "best";
    state.limit = PAGE;
    if (els.q.value !== state.q) els.q.value = state.q;
  }
  function writeHash() {
    var p = new URLSearchParams();
    ["q", "type", "need", "licence", "tag"].forEach(function (k) { if (state[k]) p.set(k, state[k]); });
    if (state.sort !== "best") p.set("sort", state.sort);
    var h = p.toString();
    var url = location.pathname + location.search + (h ? "#" + h : "");
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
  }
  function update() { state.limit = PAGE; writeHash(); render(); }

  /* —— copy —— */
  function draftText(e) { return "Draft into skill: " + e.name + " (" + (e.url || "no link") + ")"; }
  function fallbackCopy(t) {
    var ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallbackCopy(t); });
    }
    return Promise.resolve(fallbackCopy(t));
  }
  function onDraft(btn) {
    var e = all[Number(btn.getAttribute("data-i"))];
    if (!e) return;
    var note = btn.parentNode.querySelector(".copied");
    copy(draftText(e)).then(function (ok) {
      note.textContent = ok ? "Copied. Paste into the Library Scout chat." : "Copy failed. Text: " + draftText(e);
      clearTimeout(note._t);
      note._t = setTimeout(function () { note.textContent = ""; }, ok ? 3500 : 10000);
    });
  }

  /* —— wiring —— */
  function bind() {
    var timer;
    els.q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = els.q.value.trim(); update(); }, 120);
    });
    els.q.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { els.q.value = ""; state.q = ""; update(); }
    });
    FACETS.forEach(function (f) {
      els[f].addEventListener("change", function () { state[f] = els[f].value; update(); });
    });
    els.sort.addEventListener("change", function () { state.sort = els.sort.value; update(); });
    els.clear.addEventListener("click", function () {
      state.q = ""; state.type = ""; state.need = ""; state.licence = ""; state.tag = ""; state.sort = "best";
      els.q.value = "";
      update();
    });
    els.showMore.addEventListener("click", function () { state.limit += PAGE; renderList(); });
    els.showAll.addEventListener("click", function () { state.limit = Infinity; renderList(); });
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-tag], .draft, #untag") : null;
      if (!t) return;
      if (t.id === "untag") { state.tag = ""; update(); }
      else if (t.classList.contains("draft")) onDraft(t);
      else { var v = t.getAttribute("data-tag"); state.tag = state.tag === v ? "" : v; update(); }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var a = document.activeElement, tag = a && a.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return;
      ev.preventDefault();
      els.q.focus();
      els.q.select();
    });
    window.addEventListener("hashchange", function () { readHash(); render(); });
  }

  function setUpdated(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
    els.updated.textContent = m ? " Updated " + Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] + "." : "";
  }

  function init() {
    ["q", "grid", "count", "empty", "more", "clear", "updated"].forEach(function (k) { els[k] = $(k); });
    els.type = $("f-type"); els.need = $("f-need"); els.licence = $("f-licence"); els.sort = $("f-sort");
    els.showMore = $("show-more"); els.showAll = $("show-all"); els.activeTag = $("active-tag");
    readHash();
    bind();
    fetch("data.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var list = d && Array.isArray(d.entries) ? d.entries : [];
        all = list.filter(function (e) { return e && (e.name || e.id); }).map(prep);
        all.forEach(function (e) { if (e.rank != null && e.rank > maxRank) maxRank = e.rank; });
        setUpdated(d && d.updated);
        render();
      })
      .catch(function () { all = []; render(); });
  }

  window.LibraryCatalogue = { state: state, draftText: function (i) { return draftText(all[i]); }, current: function () { return current; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
