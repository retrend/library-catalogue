/* Library Catalogue: "Describe your project" recommender.
   Fully client-side keyword ranking (BM25F-style) over the loaded catalogue. No API calls.
   The engine (createEngine) has no DOM use so it can be tested in Node. */
(function (root) {
  "use strict";

  var STOP = {};
  ("a an and are as at be been but by can could do does for from get got have has help i i'd i'll i'm im " +
    "in into is it its it's just like make me my need needs of on or our out over so some something " +
    "that the their them then there these they this to up us use using want wants we we're with without " +
    "would you your yours also any all more most new best good great tool tools thing things way ways " +
    "lot lots very really able looking start starting trying try going project projects stuff am will " +
    "which what when where who how about around via per each every much many other than too own etc")
    .split(" ").forEach(function (w) { STOP[w] = 1; });

  // Light stemmer: enough to join clip/clips/clipping, caption/captions/captioning, post/posting.
  function stem(w) {
    if (w.length <= 3) return w;
    var s = w;
    if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + "y";
    else if (/(ss|us|is)$/.test(s)) { /* keep: business, status, analysis */ }
    else if (/(sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
    else if (/s$/.test(s)) s = s.slice(0, -1);
    if (/ing$/.test(s) && s.length > 5) { s = s.slice(0, -3); if (/(.)\1$/.test(s) && !/(ll|ss|ff)$/.test(s)) s = s.slice(0, -1); }
    else if (/ed$/.test(s) && s.length > 4) { s = s.slice(0, -2); if (/(.)\1$/.test(s) && !/(ll|ss|ff)$/.test(s)) s = s.slice(0, -1); }
    if (/e$/.test(s) && s.length > 4) s = s.slice(0, -1);
    return s;
  }

  function words(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[’']/g, "").match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) || [];
  }
  // Document tokens: hyphenated tags give both the whole tag and its parts.
  function docTokens(text) {
    var out = [];
    String(text == null ? "" : text).toLowerCase().split(/[\s,;:()/]+/).forEach(function (chunk) {
      if (!chunk) return;
      var c = chunk.replace(/^[^a-z0-9]+|[^a-z0-9+#]+$/g, "");
      if (c.indexOf("-") > 0) out.push(c);
      words(c.replace(/-/g, " ")).forEach(function (w) { if (!STOP[w]) out.push(stem(w)); });
    });
    return out;
  }

  // Intent groups. Any word in a group pulls in the others at lower weight. need: catalogue needs it points to.
  var GROUPS = [
    // Making short videos and cutting clips out of long ones are different jobs, so they're separate groups.
    { need: ["video"], w: "short shorts reel reels short-form vertical" },
    { need: ["video"], w: "clip clips clipping cut cuts cutting highlight highlights repurpose repurposing" },
    { need: ["video", "audio"], w: "caption captions captioning subtitle subtitles srt transcript transcripts transcription transcribe" },
    { need: ["seo"], w: "seo ranking rankings rank serp keyword keywords organic search-console technical-seo" },
    // "campaign" is left out on purpose: most campaigns aren't paid ads.
    { need: ["ads"], w: "ads ad paid meta-ads google-ads ppc creative creatives sponsored boost boosted" },
    // Newsletters and member emails are kept apart from cold outreach.
    { need: ["email"], w: "email emails newsletter newsletters edm mailchimp member-email inbox deliverability" },
    { need: ["outreach", "email"], w: "outreach cold cold-email prospecting prospect prospects leads lead-gen sequence sequences pitch pitching" },
    { need: ["photo", "video"], w: "thumbnail thumbnails cover" },
    { need: ["photo"], w: "photo photos photography photograph photographs image images retouch retouching raw lightroom darktable colour color grading" },
    { need: ["local-seo", "social"], w: "venue venues club clubs clubhouse golf hospitality restaurant restaurants cafe bar pub" },
    { need: ["content", "marketing"], w: "testimonial testimonials case-study proof" },
    { need: ["content", "video"], w: "script scripts scriptwriting copywriting copy" },
    { need: ["content", "social", "video"], w: "hook hooks opener viral" },
    { need: ["audio"], w: "podcast podcasts episode episodes audio" },
    { need: ["video"], w: "video videos edit editing editor footage youtube film filming vertical davinci resolve capcut premiere" },
    { need: ["audio", "video"], w: "voiceover voice tts narration dubbing dub voice-cloning" },
    { need: ["social"], w: "social posting post posts schedule scheduling scheduler publish publishing instagram linkedin tiktok twitter" },
    { need: ["social", "content"], w: "plan calendar content-calendar planning strategy" },
    { need: ["local-seo"], w: "local gbp maps reviews local-seo citations directories" },
    { need: ["ai-search"], w: "ai-search geo aeo llm chatgpt perplexity gemini claude chatbot chatbots llms-txt citation cited answer-engine visibility" },
    { need: ["analytics"], w: "analytics ga4 tracking track report reporting dashboard metrics utm utms attribution short-link performance results" },
    { need: ["backlinks"], w: "backlink backlinks link-building links pr" },
    { need: ["content"], w: "landing landing-pages cro conversion signup" },
    { need: ["content", "seo"], w: "blog blogs article articles post-writing writing" },
    { need: ["research"], w: "competitor competitors competitive research spy" },
    { need: ["social", "marketing"], w: "ugc creator creators influencer influencers" },
    { need: ["video", "marketing"], w: "launch promo demo product-video product-hunt" },
    { need: ["video"], w: "motion motion-graphics animation animated explainer remotion" },
    { need: ["audio"], w: "music song sound sfx" }
  ];
  // Broad words that appear in almost every marketing tool: they still count, but at low weight.
  var WEAK = {};
  "campaign campaigns promote promoting promotion promotions marketing market business".split(" ").forEach(function (w) { WEAK[stem(w)] = 1; });
  // Promotion prompts: venue/back-office software (need "business") is rarely what the user is asking for.
  var PROMO = {};
  "promote promoting promotion promotions marketing market campaign campaigns advertise advertising".split(" ").forEach(function (w) { PROMO[stem(w)] = 1; });
  var NEED_WORDS = { video: 1, seo: 1, social: 1, content: 1, ads: 1, email: 1, outreach: 1, photo: 1, audio: 1, analytics: 1, marketing: 1, research: 1, automation: 1, scraping: 1, backlinks: 1 };

  var groupOf = {}; // stemmed word -> [group index]
  var SHOW = {}; // stemmed group word -> readable word
  GROUPS.forEach(function (g, gi) {
    g.stems = g.w.split(" ").map(function (w) { var st = w.indexOf("-") > 0 ? w : stem(w); if (!SHOW[st]) SHOW[st] = w; return st; });
    g.label = g.w.split(" ")[0];
    g.stems.forEach(function (s) { (groupOf[s] = groupOf[s] || []).push(gi); });
  });

  // Prompt -> weighted query terms. Each term remembers which prompt words it came from.
  function parsePrompt(prompt) {
    var raw = String(prompt == null ? "" : prompt).toLowerCase();
    var terms = {}; // stem -> { w, from: {word:1}, concept }
    var concepts = []; // one per distinct prompt word
    function add(t, w, word, ci, direct) {
      var x = terms[t];
      if (!x) x = terms[t] = { t: t, w: 0, from: {}, concepts: {}, show: SHOW[t] || word };
      if (w > x.w) x.w = w;
      if (direct) x.show = word;
      x.from[word] = direct ? 1 : (x.from[word] || 2);
      x.concepts[ci] = 1;
    }
    var seen = {};
    var toks = [];
    raw.split(/[\s,;:()/!?"]+/).forEach(function (chunk) {
      var c = chunk.replace(/^[^a-z0-9]+|[^a-z0-9+#]+$/g, "");
      if (!c) return;
      if (c.indexOf("-") > 0) toks.push({ word: c, s: c });
      words(c.replace(/-/g, " ")).forEach(function (w) { if (!STOP[w] && w.length > 1) toks.push({ word: w, s: stem(w) }); });
    });
    toks.forEach(function (tk) {
      if (seen[tk.s]) return;
      seen[tk.s] = 1;
      var ci = concepts.length;
      concepts.push({ word: tk.word, s: tk.s, groups: groupOf[tk.s] || [] });
      add(tk.s, WEAK[tk.s] ? 0.35 : 1, tk.word, ci, true);
      (groupOf[tk.s] || []).forEach(function (gi) {
        GROUPS[gi].stems.forEach(function (s2) { if (s2 !== tk.s) add(s2, 0.45, tk.word, ci, false); });
      });
    });
    return { terms: Object.keys(terms).map(function (k) { return terms[k]; }), concepts: concepts };
  }

  // Fields and their weights. need = first tag.
  var FIELDS = [
    { k: "name", w: 2.6, b: 0.5 },
    { k: "need", w: 3.2, b: 0 },
    { k: "tags", w: 2.2, b: 0.5 },
    { k: "summary", w: 1.0, b: 0.75 },
    { k: "use", w: 1.3, b: 0.75 }
  ];
  var K1 = 1.2;

  function createEngine(entries) {
    var docs = [];
    var avg = {};
    var df = {};
    var maxRank = 1;
    FIELDS.forEach(function (f) { avg[f.k] = 0; });
    (entries || []).forEach(function (e) {
      if (typeof e.rank === "number" && e.rank > maxRank) maxRank = e.rank;
      var tags = Array.isArray(e.tags) ? e.tags : [];
      var need = String(e.need || tags[0] || "");
      var f = {
        name: docTokens(e.name),
        need: docTokens(need),
        tags: docTokens(tags.slice(need === tags[0] ? 1 : 0).join(" ")),
        summary: docTokens(e.summary),
        use: docTokens(e.use_when)
      };
      var tf = {}, uniq = {};
      FIELDS.forEach(function (fd) {
        var m = tf[fd.k] = {};
        f[fd.k].forEach(function (t) { m[t] = (m[t] || 0) + 1; uniq[t] = 1; });
        avg[fd.k] += f[fd.k].length;
      });
      Object.keys(uniq).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      docs.push({ e: e, need: need, tf: tf, len: { name: f.name.length, need: f.need.length, tags: f.tags.length, summary: f.summary.length, use: f.use.length } });
    });
    var N = docs.length || 1;
    FIELDS.forEach(function (f) { avg[f.k] = avg[f.k] / N || 1; });
    function idf(t) { var n = df[t] || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); }

    function scoreDoc(d, q) {
      var s = 0, hit = {}, cov = {};
      for (var i = 0; i < q.terms.length; i++) {
        var qt = q.terms[i], tfw = 0;
        for (var j = 0; j < FIELDS.length; j++) {
          var fd = FIELDS[j], c = d.tf[fd.k][qt.t];
          if (c) tfw += fd.w * c / (1 - fd.b + fd.b * d.len[fd.k] / avg[fd.k]);
        }
        if (!tfw) continue;
        s += qt.w * idf(qt.t) * tfw * (K1 + 1) / (tfw + K1);
        Object.keys(qt.from).forEach(function (wd) {
          if (qt.from[wd] === 1) hit[wd] = "";
          else if (hit[wd] == null) hit[wd] = qt.show;
        });
        Object.keys(qt.concepts).forEach(function (c) { cov[c] = 1; });
      }
      // hit: prompt word -> "" (matched as written) or the related word it matched through
      return { s: s, hit: hit, cov: Object.keys(cov).length };
    }

    function rankBoost(e) {
      var r = typeof e.rank === "number" ? e.rank : maxRank;
      return 1 + 0.35 * (1 - (r - 1) / maxRank);
    }

    function recommend(prompt, opts) {
      opts = opts || {};
      var q = parsePrompt(prompt);
      if (!q.terms.length) return { empty: true, prompt: String(prompt || ""), concepts: [], best: [], needs: [], total: 0 };
      var nc = q.concepts.length || 1;
      var promo = q.concepts.some(function (c) { return PROMO[c.s]; });
      var scored = [];
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i], r = scoreDoc(d, q);
        if (!r.s) continue;
        // rank boost: up to +35% for the top of the catalogue; coverage: more of the prompt matched scores higher
        scored.push({ e: d.e, need: d.need, hit: r.hit, score: r.s * rankBoost(d.e) * (0.6 + 0.4 * r.cov / nc) * (promo && d.need === "business" ? 0.5 : 1) });
      }
      scored.sort(function (a, b) {
        return b.score - a.score || ((a.e.rank == null ? 1e9 : a.e.rank) - (b.e.rank == null ? 1e9 : b.e.rank));
      });

      // Infer needs: weight of the top results in each need, plus needs the prompt names outright.
      var needScore = {}, order = [];
      var top = scored.slice(0, 30), topS = top.length ? top[0].score : 1;
      top.forEach(function (x, k) {
        if (!x.need) return;
        if (needScore[x.need] == null) { needScore[x.need] = 0; order.push(x.need); }
        needScore[x.need] += x.score / topS * (1 - k / 40);
      });
      var hinted = {};
      q.concepts.forEach(function (c) {
        if (NEED_WORDS[c.s] || NEED_WORDS[c.word]) hinted[NEED_WORDS[c.s] ? c.s : c.word] = 2;
        c.groups.forEach(function (gi) {
          GROUPS[gi].need.forEach(function (n, k) { hinted[n] = Math.max(hinted[n] || 0, k === 0 ? 1.5 : 0.6); });
        });
      });
      var avail = {};
      scored.forEach(function (x) { avail[x.need] = (avail[x.need] || 0) + 1; });
      Object.keys(hinted).forEach(function (n) {
        if (!avail[n]) return;
        if (needScore[n] == null) { needScore[n] = 0; order.push(n); }
        needScore[n] += hinted[n];
      });
      var bestIn = {};
      scored.forEach(function (x) { if (bestIn[x.need] == null) bestIn[x.need] = x.score; });
      var needList = order.filter(function (n) { return needScore[n] > 0; })
        .sort(function (a, b) { return needScore[b] - needScore[a]; });
      var lead = needList.length ? needScore[needList[0]] : 0;
      // Keep a need if it carries real weight in the top results, or the prompt asks for it
      // and the library has a strong entry for it.
      needList = needList.filter(function (n, k) {
        return k === 0 || needScore[n] >= 0.35 * lead || (hinted[n] >= 1.5 && bestIn[n] >= 0.45 * topS);
      }).slice(0, 3);

      function item(x) { return { entry: x.e, score: x.score, matched: Object.keys(x.hit), why: why(x) }; }
      var bestX = scored.slice(0, opts.best || 8);
      // Measurement is easy to crowd out of a long prompt: if the prompt asks to track or measure
      // (analytics hinted) and no analytics tool made the list, it takes the slot of the lowest-scoring
      // item from a need that already holds 3 or more.
      if (hinted.analytics >= 1.5 && bestIn.analytics != null && !bestX.some(function (x) { return x.need === "analytics"; })) {
        var cnt = {};
        bestX.forEach(function (x) { cnt[x.need] = (cnt[x.need] || 0) + 1; });
        for (var k = bestX.length - 1; k >= 0; k--) {
          if (cnt[bestX[k].need] >= 3) { bestX[k] = scored.filter(function (x) { return x.need === "analytics"; })[0]; break; }
        }
      }
      var best = bestX.map(item);
      var needs = needList.map(function (n) {
        return { need: n, items: scored.filter(function (x) { return x.need === n; }).slice(0, opts.perNeed || 3).map(item) };
      }).filter(function (g) { return g.items.length; });
      return { empty: false, prompt: String(prompt), concepts: q.concepts.map(function (c) { return c.word; }), best: best, needs: needs, total: scored.length };
    }

    return { recommend: recommend, size: docs.length };
  }

  function why(x) {
    var parts = [];
    var ws = Object.keys(x.hit).slice(0, 5).map(function (w) { return x.hit[w] ? w + " (via " + x.hit[w] + ")" : w; });
    if (ws.length) parts.push("Matches " + ws.join(", ") + ".");
    if (x.e.use_when) parts.push("Use when: " + x.e.use_when);
    return parts.join(" ");
  }

  function shortlistText(res) {
    if (!res || res.empty) return "";
    var lines = ["Tool shortlist for: " + res.prompt.replace(/\s+/g, " ").trim(), ""];
    var seen = {};
    function line(it, prefix) {
      var e = it.entry;
      return prefix + e.name + " - " + (e.url || "no link");
    }
    lines.push("Best overall");
    res.best.forEach(function (it, k) { seen[it.entry.id] = 1; lines.push(line(it, (k + 1) + ". ")); });
    res.needs.forEach(function (g) {
      lines.push("", "For " + g.need);
      g.items.forEach(function (it) { lines.push(line(it, "- ")); });
    });
    return lines.join("\n");
  }

  var api = { createEngine: createEngine, parsePrompt: parsePrompt, stem: stem, shortlistText: shortlistText, GROUPS: GROUPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LibraryRecommendEngine = api;
})(typeof window !== "undefined" ? window : globalThis);

/* —— UI —— every node is built with createElement and textContent, never from HTML strings. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var R = window.LibraryRecommendEngine;
  var els = {}, engine = null, engineFor = null, last = null;
  var EMPTY_MSG = "Describe your project first, e.g. \u201cI'm launching a podcast and need clips, captions and a posting plan\u201d.";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Licences worth a second look before you reuse or build on the tool.
  function licenceNote(lic) {
    if (/none stated/i.test(lic)) return "no licence stated, so you have no right to reuse the code";
    if (/AGPL/i.test(lic)) return "AGPL: if you run it as a service for others, you must share your changes";
    if (/GPL/i.test(lic)) return "GPL: anything you distribute that includes it must also be GPL";
    if (/noncommercial|non-commercial|\bNC\b|-NC-/i.test(lic)) return "non-commercial use only";
    if (/commercial service/i.test(lic)) return "hosted service: its terms of use and plan limits apply";
    if (/remotion|paid|commercial|proprietary/i.test(lic)) return "may need a paid licence for company use";
    if (/BUSL|Business Source|Elastic|PolyForm|LicenseRef-/i.test(lic)) return "source-available with limits; read the terms before company use";
    return "";
  }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }

  function getEngine() {
    var C = window.LibraryCatalogue, list = C && C.entries ? C.entries() : [];
    if (engine && engineFor === list) return engine;
    engineFor = list;
    engine = R.createEngine(list);
    return engine;
  }

  function card(it) {
    var e = it.entry;
    var a = el("article", "card rec-card");
    var head = el("div", "card-head");
    head.appendChild(el("span", "rank", "#" + (e.rank == null ? "\u2013" : e.rank))).title = "Rank";
    var h = el("h4", "name");
    var url = safeUrl(e.url);
    if (url) {
      var link = el("a", null, e.name);
      link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      var ext = el("span", "ext", "\u2197"); ext.setAttribute("aria-hidden", "true");
      link.appendChild(ext);
      h.appendChild(link);
    } else h.textContent = e.name;
    head.appendChild(h);
    a.appendChild(head);
    var meta = el("div", "meta");
    meta.appendChild(el("span", "pill type", e.type));
    if (e.need) meta.appendChild(el("span", "pill", e.need)).title = "Need";
    var lic = e.licence || "none stated", note = licenceNote(lic);
    var lp = meta.appendChild(el("span", note ? "pill warn" : "pill", lic));
    lp.title = note ? "Licence: " + note : "Licence";
    var tips = (window.LibraryCatalogue && window.LibraryCatalogue.tips) || {};
    if (tips[e.type]) meta.firstChild.title = tips[e.type];
    if (e.low_trust) meta.appendChild(el("span", "pill flag", "low trust")).title = tips.low_trust || "";
    if (e.archived) meta.appendChild(el("span", "pill flag", "archived")).title = tips.archived || "";
    a.appendChild(meta);
    if (e.summary) a.appendChild(el("p", "summary", e.summary));
    if (it.why) {
      var w = el("p", "why");
      w.appendChild(el("b", null, "Why: "));
      w.appendChild(document.createTextNode(it.why));
      a.appendChild(w);
    }
    var foot = el("div", "card-foot");
    var b = el("button", "btn btn-ghost draft", "Draft into skill");
    b.type = "button";
    b.setAttribute("data-i", String(e.i)); // handled by app.js's click listener
    foot.appendChild(b);
    var note = el("span", "copied"); note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite");
    foot.appendChild(note);
    a.appendChild(foot);
    return a;
  }

  function group(title, sub, items) {
    var g = el("section", "rec-group");
    var hd = el("div", "rec-group-head");
    hd.appendChild(el("h3", null, title));
    if (sub) hd.appendChild(el("span", "rec-sub", sub));
    g.appendChild(hd);
    var grid = el("div", "grid rec-grid");
    items.forEach(function (it) { grid.appendChild(card(it)); });
    g.appendChild(grid);
    return g;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function show(res) {
    last = res;
    clear(els.out);
    els.clearBtn.hidden = !res;
    if (!res) { els.out.hidden = true; els.msg.textContent = ""; return; }
    if (res.empty) { els.out.hidden = true; els.msg.textContent = EMPTY_MSG; return; }
    if (!res.best.length) {
      els.out.hidden = true;
      els.msg.textContent = "Nothing in the library matched that. Try naming the work, e.g. clips, captions, SEO, ads, email, thumbnails.";
      return;
    }
    var needNames = res.needs.map(function (g) { return g.need; });
    els.msg.textContent = (needNames.length ? "Your project touches: " + needNames.join(", ") + ". " : "") + "Picked from " + res.total + " related tools.";
    var bar = el("div", "rec-bar");
    var cp = el("button", "btn btn-ghost", "Copy shortlist");
    cp.type = "button"; cp.id = "rec-copy";
    var cpNote = el("span", "copied"); cpNote.id = "rec-copy-note"; cpNote.setAttribute("role", "status");
    cp.addEventListener("click", function () {
      var t = R.shortlistText(last);
      var copy = window.LibraryCatalogue && window.LibraryCatalogue.copy;
      (copy ? copy(t) : Promise.resolve(false)).then(function (ok) {
        cpNote.textContent = ok ? "Shortlist copied." : "Copy failed.";
        clearTimeout(cpNote._t);
        cpNote._t = setTimeout(function () { cpNote.textContent = ""; }, 3500);
      });
    });
    bar.appendChild(cp); bar.appendChild(cpNote);
    els.out.appendChild(bar);
    els.out.appendChild(group("Best overall", "Top " + res.best.length, res.best));
    res.needs.forEach(function (g) { els.out.appendChild(group("For " + g.need, "Top " + g.items.length + " in this need", g.items)); });
    els.out.hidden = false;
  }

  function hashParams() { return new URLSearchParams(location.hash.replace(/^#/, "")); }
  function writeP(p) {
    var hp = hashParams();
    if (p) hp.set("p", p); else hp.delete("p");
    var h = hp.toString();
    var url = location.pathname + location.search + (h ? "#" + h : "");
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
  }

  function run(prompt, opts) {
    prompt = String(prompt == null ? "" : prompt).trim().slice(0, 2000);
    if (!prompt) { writeP(""); show({ empty: true }); return null; }
    writeP(prompt);
    var res = getEngine().recommend(prompt);
    show(res);
    if (opts && opts.scroll && els.out.scrollIntoView) els.out.scrollIntoView({ behavior: "smooth", block: "start" });
    return res;
  }

  function fromHash() {
    var p = hashParams().get("p") || "";
    if (p === (last && !last.empty ? last.prompt : "")) return;
    els.prompt.value = p;
    if (p) run(p); else show(null);
  }

  function init() {
    els.form = document.getElementById("rec-form");
    if (!els.form) return;
    els.prompt = document.getElementById("rec-prompt");
    els.msg = document.getElementById("rec-msg");
    els.out = document.getElementById("rec-out");
    els.clearBtn = document.getElementById("rec-clear");
    els.form.addEventListener("submit", function (ev) { ev.preventDefault(); run(els.prompt.value, { scroll: false }); });
    els.prompt.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); run(els.prompt.value); }
    });
    els.clearBtn.addEventListener("click", function () { els.prompt.value = ""; writeP(""); show(null); els.prompt.focus(); });
    window.addEventListener("hashchange", function () { if (window.LibraryCatalogue && window.LibraryCatalogue.loaded) fromHash(); });
    var start = function () { engine = null; fromHash(); };
    if (window.LibraryCatalogue && window.LibraryCatalogue.loaded) start();
    else document.addEventListener("catalogue:ready", start);
  }

  window.LibraryRecommend = { run: run, last: function () { return last; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
