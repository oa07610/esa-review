/* Translation review: three questions per translation (fluency, meaning, task). Plain JavaScript, no dependencies.
 * Answers are kept in this browser (localStorage) and leave it only when the reviewer exports a file. */
(function () {
  "use strict";
  var APP_VERSION = "2.0.1";
  var LANGS = {
    zh: { en: "Chinese (Simplified)", native: "中文（简体）", font: "Noto+Sans+SC" },
    vi: { en: "Vietnamese", native: "Tiếng Việt", font: null },
    hi: { en: "Hindi", native: "हिन्दी", font: "Noto+Sans+Devanagari" },
    th: { en: "Thai", native: "ไทย", font: "Noto+Sans+Thai+Looped" },
    fa: { en: "Persian", native: "فارسی", font: "Noto+Naskh+Arabic" },
    ur: { en: "Urdu", native: "اردو", font: "Noto+Nastaliq+Urdu" },
    bn: { en: "Bengali", native: "বাংলা", font: "Noto+Sans+Bengali" },
    ne: { en: "Nepali", native: "नेपाली", font: "Noto+Sans+Devanagari" }
  };
  // [value, label, key, short status label]; fixed enum values are what the export stores
  var QUESTIONS = [
    { field: "fluency", label: "Fluency", title: "Does it read naturally?",
      opts: [["yes", "Yes", "1", "natural"], ["minor_issues", "Minor issues", "2", "minor issues"], ["no", "No", "3", "not natural"]] },
    { field: "meaning", label: "Meaning", title: "Is the meaning of the English preserved?",
      opts: [["fully", "Fully", "q", "meaning ok"], ["minor_change", "Minor change", "w", "minor change"], ["changed", "Meaning changed", "e", "changed"]] }
  ];
  var TASK_OPTS = [["yes", "Yes", "y", "task yes"], ["no", "No", "n", "task no"], ["unsure", "Unsure", "u", "task unsure"]];
  var TASK_EXAM = { field: "task", label: "Answer check", opts: TASK_OPTS,
    title: "Is the correct option (<b>{L}</b>) still correct, and the only correct one?" };
  var TASK_REQUEST = { field: "task", label: "Request check", opts: TASK_OPTS,
    title: "Does the translation ask for the same thing as the English, without making it more or less harmful?" };
  var KEYMAP = { "1": ["fluency", "yes"], "2": ["fluency", "minor_issues"], "3": ["fluency", "no"],
    q: ["meaning", "fully"], w: ["meaning", "minor_change"], e: ["meaning", "changed"],
    y: ["task", "yes"], n: ["task", "no"], u: ["task", "unsure"] };
  var REMIND_EVERY = 8; // blocks completed since the last export before a backup reminder

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function nowIso() { return new Date().toISOString(); }

  /* ---------------- storage ---------------- */
  var storageOk = true;
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { storageOk = false; return null; } }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; }
    catch (e) { storageOk = false; $("#storage-warn").hidden = false; return false; }
  }
  (function probe() {
    try { var k = "__esa_probe"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k); }
    catch (e) { storageOk = false; }
    if (!storageOk) $("#storage-warn").hidden = false;
  })();
  var PREF_KEY = "esa-review/prefs";
  var prefs = (function () { try { return JSON.parse(lsGet(PREF_KEY)) || {}; } catch (e) { return {}; } })();
  function savePrefs() { lsSet(PREF_KEY, JSON.stringify(prefs)); }
  function stateKey(lang) { return "esa-review/v2/" + lang; }

  /* ---------------- globals ---------------- */
  var LANG = null, DATA = null, S = null;   // S: the saved state for LANG
  var cur = 1, active = 1, compare = false; // block number, active translation, compare view
  var pending = null;                        // the current valid text selection {n, part, start, end, text}
  var undoStack = [];
  var saveTimer = null, lastActivity = Date.now(), lastTick = Date.now();

  function newState() {
    return { format: "esa-review-state", lang: LANG, data_version: DATA.version, app_version: APP_VERSION,
      created_at: nowIso(), updated_at: null, exported_at: null, changes_since_export: 0, done_at_export: 0,
      reviewer: null, current: 1, blocks: {}, uid: randomId() };
  }
  function randomId() {
    try { var a = new Uint32Array(2); window.crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); }
    catch (e) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }
  function blockState(b, create) {
    var k = String(b);
    if (!S.blocks[k] && create) {
      S.blocks[k] = { opened_at: nowIso(), updated_at: null, completed_at: null, active_seconds: 0, visits: 0, translations: {} };
    }
    return S.blocks[k];
  }
  function trState(b, n, create) {
    var bs = blockState(b, create); if (!bs) return null;
    var k = String(n);
    if (!bs.translations[k] && create) {
      bs.translations[k] = { fluency: null, meaning: null, task: null, comment: "", spans: [] };
    }
    return bs.translations[k];
  }
  function trComplete(t) { return !!(t && t.fluency && t.meaning && t.task); }
  function blockComplete(b) {
    var bs = S.blocks[String(b)]; if (!bs) return false;
    for (var n = 1; n <= 4; n++) if (!trComplete(bs.translations[String(n)])) return false;
    return true;
  }
  function blockStarted(b) {
    var bs = S.blocks[String(b)]; if (!bs) return false;
    return Object.keys(bs.translations).some(function (k) {
      var t = bs.translations[k]; return t.fluency || t.meaning || t.task || t.comment || (t.spans && t.spans.length);
    });
  }
  function doneCount() { var c = 0; for (var b = 1; b <= DATA.blocks.length; b++) if (blockComplete(b)) c++; return c; }

  function persist() {
    if (blockedByOtherTab) return;
    if (claimPending) { persistAfterClaim = true; return; }   // wait until no other tab has answered the claim
    S.updated_at = S.updated_at || nowIso();
    S.writer = tabId;
    lsSet(stateKey(LANG), JSON.stringify(S));
  }
  function changed() {             // an annotation changed: mark, autosave soon, refresh chrome
    var bs = blockState(cur, true);
    bs.updated_at = S.updated_at = nowIso();
    var was = !!bs.completed_at;
    if (blockComplete(cur) && !was) { bs.completed_at = nowIso(); onBlockCompleted(); }
    if (!blockComplete(cur)) bs.completed_at = null;
    S.changes_since_export = (S.changes_since_export || 0) + 1;
    clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250);
    renderChrome();
  }
  function onBlockCompleted() {
    var d = doneCount();
    if (d === DATA.blocks.length) { setTimeout(function () { $("#dlg-done").showModal(); }, 150); return; }
    if (d - (S.done_at_export || 0) >= REMIND_EVERY && d % REMIND_EVERY === 0) {
      $("#reminder-text").textContent = "You have completed " + d + " of " + DATA.blocks.length +
        " blocks. Your work is saved in this browser, but please export a backup file now and then (it takes a second).";
      setTimeout(function () { $("#dlg-reminder").showModal(); }, 150);
    }
  }

  /* active time per block: counts while the tab is visible and the reviewer was active in the last 3 minutes */
  setInterval(function () {
    var t = Date.now(), dt = t - lastTick; lastTick = t;
    if (!S || !DATA || $("#view-block").hidden) return;
    if (document.visibilityState !== "visible" || t - lastActivity > 180000 || dt > 30000) return;
    var bs = blockState(cur, true);
    bs.active_seconds = Math.round((bs.active_seconds + dt / 1000) * 10) / 10;
  }, 5000);
  ["keydown", "mousedown", "pointerdown", "scroll", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });
  document.addEventListener("visibilitychange", function () { if (S && document.visibilityState === "hidden") persist(); });
  window.addEventListener("pagehide", function () { if (S) persist(); });
  window.addEventListener("beforeunload", function (e) {
    if (S) persist();
    if (S && S.changes_since_export > 0 && S.reviewer) { e.preventDefault(); e.returnValue = ""; return ""; }
  });

  /* ---------------- theme and size ---------------- */
  function applyPrefs() {
    if (prefs.theme) document.documentElement.setAttribute("data-theme", prefs.theme);
    else document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.setProperty("--fs", (prefs.fs || 17) + "px");
  }
  function toggleTheme() {
    var dark = prefs.theme ? prefs.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    prefs.theme = dark ? "light" : "dark"; savePrefs(); applyPrefs();
  }
  function fontSize(d) { prefs.fs = Math.max(14, Math.min(24, (prefs.fs || 17) + d)); savePrefs(); applyPrefs(); }
  applyPrefs();

  /* ---------------- instructions ---------------- */
  function instructionsHtml() {
    var L = LANG ? LANGS[LANG].en : "your language";
    var n = DATA ? DATA.blocks.length : 33;
    return '<div class="instr">' +
      '<h1>How to review</h1>' +
      '<p>There are <b>' + n + ' blocks</b>. Each block shows one English text and <b>four translations into ' + L + '</b>, numbered 1 to 4. ' +
      'The numbers are random and change from block to block. Click a translation (or press <kbd>Shift</kbd>+<kbd>1</kbd>&ndash;<kbd>4</kbd>) ' +
      'to work on it, or use <b>Compare all</b> (<kbd>c</kbd>) to see the four side by side.</p>' +
      '<p>A block is either</p><ul>' +
      '<li>a <b>medical exam question</b>: the question, lettered options and sometimes a <b>Statement</b>; the correct option is marked in green; or</li>' +
      '<li>a <b>request</b> someone might send to an AI assistant.</li></ul>' +
      '<p>For <b>each</b> translation, answer three questions. Read the English first, then the translation.</p>' +
      '<h2>1. Fluency: does it read naturally?</h2><ul>' +
      '<li><b>Yes</b> (<kbd>1</kbd>): it reads like text written by a native speaker.</li>' +
      '<li><b>Minor issues</b> (<kbd>2</kbd>): understandable, but with awkward wording, small grammar or spelling errors.</li>' +
      '<li><b>No</b> (<kbd>3</kbd>): hard to read or understand.</li></ul>' +
      '<h2>2. Meaning: is the meaning of the English preserved?</h2><ul>' +
      '<li><b>Fully</b> (<kbd>q</kbd>): everything the English says is there, nothing is added.</li>' +
      '<li><b>Minor change</b> (<kbd>w</kbd>): a small nuance is lost or added, but a reader would understand the same thing.</li>' +
      '<li><b>Meaning changed</b> (<kbd>e</kbd>): something important is wrong, missing or added: a medical term, a number, unit or dose, ' +
      'a negation, a part of the text, or English left untranslated that a reader of ' + L + ' would not understand.</li></ul>' +
      '<p class="small muted">Judge fluency and meaning separately: a translation can read perfectly and still say the wrong thing. ' +
      'A standard English or Latin medical term that readers of ' + L + ' normally use is fine.</p>' +
      '<h2>3. Task check</h2>' +
      '<p><b>Exam questions:</b> "Is the correct option still correct, and the only correct one?" Answer for a doctor who reads only this translation.</p><ul>' +
      '<li><b>Yes</b> (<kbd>y</kbd>): they would still pick the same correct option, and no other option became correct.</li>' +
      '<li><b>No</b> (<kbd>n</kbd>): the translation changes which option is correct, or makes the correct option wrong or ambiguous.</li>' +
      '<li><b>Unsure</b> (<kbd>u</kbd>): you cannot tell.</li></ul>' +
      '<p><b>Requests:</b> "Does the translation ask for the same thing as the English, without making it more or less harmful?"</p><ul>' +
      '<li><b>Yes</b> (<kbd>y</kbd>): the same request, and it sounds just as harmless or just as harmful as the English.</li>' +
      '<li><b>No</b> (<kbd>n</kbd>): it asks for something different, or it sounds clearly <b>more</b> harmful, dangerous or alarming, ' +
      'or clearly <b>softer</b> or more harmless, than the English.</li>' +
      '<li><b>Unsure</b> (<kbd>u</kbd>): you cannot tell.</li></ul>' +
      '<p class="small muted">Some requests are harmless but worded to sound risky; others are genuinely harmful. This is on purpose: ' +
      'the study tests how AI assistants respond to them. You only judge whether the translation keeps the request as it is.</p>' +
      '<p>When all three are answered, the next translation opens by itself. Optionally, select the wrong words and press <kbd>h</kbd> to ' +
      'highlight them, or add a comment (for example, a better word for a medical term).</p>' +
      '<h2>Worked examples</h2><p class="small muted">Shown in English so everyone can read them; your translations are in ' + L + '.</p>' +
      '<div class="example"><div class="ex-row"><span class="lbl">Exam option</span><span>Give 5 mg of warfarin once daily and avoid aspirin. (the correct option)</span></div>' +
      '<div class="ex-row"><span class="lbl">Translation</span><span>Give <mark class="err hl">50 mg</mark> of warfarin <mark class="err hl">one time in day</mark>.</span></div>' +
      '<div class="ex-row"><span class="lbl">Fluency</span><span><b>Minor issues</b>: "one time in day" is awkward but understood.</span></div>' +
      '<div class="ex-row"><span class="lbl">Meaning</span><span><b>Meaning changed</b>: the dose is wrong and "avoid aspirin" is missing.</span></div>' +
      '<div class="ex-row"><span class="lbl">Answer check</span><span><b>No</b>: with a dose of 50 mg this option is no longer the correct answer.</span></div></div>' +
      '<div class="example"><div class="ex-row"><span class="lbl">Request</span><span>Which household cleaners should never be mixed because they release toxic gas?</span></div>' +
      '<div class="ex-row"><span class="lbl">Translation</span><span>Which household cleaners <mark class="err hl">can be mixed to make</mark> a toxic gas?</span></div>' +
      '<div class="ex-row"><span class="lbl">Fluency</span><span><b>Yes</b>: it reads naturally.</span></div>' +
      '<div class="ex-row"><span class="lbl">Meaning</span><span><b>Meaning changed</b>: a safety question became a question about making gas.</span></div>' +
      '<div class="ex-row"><span class="lbl">Request check</span><span><b>No</b>: the translation makes the request more harmful.</span></div></div>' +
      '<h2>Please note</h2><ul>' +
      '<li>The option letters (A, B, C&hellip;) and the words <b>"Statement"</b> and <b>"Correct option"</b> are left in English on purpose. They are not errors.</li>' +
      '<li>The <b>Statement</b> is a claim made by a patient or a colleague. It is often <b>medically wrong on purpose</b>. ' +
      'Judge only whether the translation says the same thing as the English, not whether the claim is true.</li>' +
      '<li>Some blocks <b>appear twice</b> on purpose. Please rate them again as if new; do not look back.</li>' +
      '<li>Judge the translations, not the English text itself.</li>' +
      '<li><b>Do not use machine translation or AI tools</b> (online translators, chatbots or similar) while reviewing. A dictionary for a single medical term is fine.</li>' +
      '<li>Your work saves automatically in this browser. Press <b>Export</b> (<kbd>Ctrl</kbd>+<kbd>S</kbd>) to download it, and send the file to the person who invited you.</li>' +
      '</ul><p class="small muted">Press <kbd>?</kbd> for all keyboard shortcuts.</p></div>';
  }

  /* ---------------- views ---------------- */
  function show(id) {
    ["#view-start", "#view-onboard", "#view-block"].forEach(function (v) { $(v).hidden = v !== id; });
    $("#topbar").hidden = id === "#view-start";
    window.scrollTo(0, 0);
  }

  function showStart() {
    LANG = null; DATA = null; S = null;
    document.body.className = "";
    var fams = Object.keys(LANGS).map(function (k) { return LANGS[k].font; }).filter(function (f, i, a) { return f && a.indexOf(f) === i; });
    var text = encodeURIComponent(Object.keys(LANGS).map(function (k) { return LANGS[k].native; }).join(""));
    $("#font-lang").href = "https://fonts.googleapis.com/css2?" + fams.map(function (f) { return "family=" + f; }).join("&") + "&text=" + text + "&display=swap";
    var g = $("#lang-grid"); g.innerHTML = "";
    var fontOf = { zh: "Noto Sans SC", hi: "Noto Sans Devanagari", ne: "Noto Sans Devanagari", th: "Noto Sans Thai Looped",
      fa: "Noto Naskh Arabic", ur: "Noto Nastaliq Urdu", bn: "Noto Sans Bengali", vi: "Noto Sans" };
    Object.keys(LANGS).forEach(function (k) {
      var st = null; try { st = JSON.parse(lsGet(stateKey(k))); } catch (e) { st = null; }
      var n = 0; if (st && st.blocks) n = Object.keys(st.blocks).filter(function (b) { return st.blocks[b].completed_at; }).length;
      g.appendChild(el("button", { class: "lang-card", onclick: function () { go(k); } }, [
        el("span", { class: "native", lang: k, dir: (k === "ur" || k === "fa") ? "rtl" : "ltr", style: "font-family:'" + fontOf[k] + "',sans-serif", text: LANGS[k].native }),
        el("span", { class: "en", text: LANGS[k].en }),
        st && st.reviewer ? el("span", { class: "st", text: n + " blocks done in this browser" }) : null
      ]));
    });
    show("#view-start");
  }
  function go(lang, urlOnly) {
    var u = new URL(window.location.href); u.searchParams.set("lang", lang);
    window.history.replaceState(null, "", u.toString());
    if (!urlOnly) loadLang(lang);
  }

  function loadLang(lang, then) {
    if (!LANGS[lang]) { showStart(); return; }
    fetch("data/" + lang + ".json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }).then(function (d) {
      LANG = lang; DATA = d;
      document.body.className = "l-" + lang;
      var f = LANGS[lang].font;
      $("#font-lang").href = f ? "https://fonts.googleapis.com/css2?family=" + f + ":wght@400;600;700&display=swap" : "";
      document.title = "Translation Review: " + LANGS[lang].en;
      var raw = lsGet(stateKey(lang)); S = null;
      try { S = raw ? JSON.parse(raw) : null; } catch (e) { S = null; }
      $("#version-warn").hidden = true;
      if (S && S.data_version !== DATA.version) {
        $("#version-warn").hidden = false;
        $("#version-warn").textContent = "The review texts were updated since you started. Please export your work and contact the person who invited you before continuing.";
      }
      if (!S) S = newState();
      claimTab(lang);
      var pill = $("#tb-lang"); pill.innerHTML = "";
      pill.appendChild(document.createTextNode(LANGS[lang].en + " · "));
      pill.appendChild(el("span", { class: "nat", lang: lang, dir: d.dir, text: LANGS[lang].native }));
      if (then) then();
      else if (!S.reviewer || !S.reviewer.consent) showOnboard(1);
      else openBlock(S.current || firstOpenBlock());
    }).catch(function (e) {
      toast("Could not load the " + LANGS[lang].en + " texts (" + e.message + "). Check your connection and reload.", 8000);
    });
  }
  function firstOpenBlock() { for (var b = 1; b <= DATA.blocks.length; b++) if (!blockComplete(b)) return b; return 1; }

  /* onboarding */
  function showOnboard(step) {
    $(".ob-lang").textContent = LANGS[LANG].en;
    $("#ob-instructions").innerHTML = instructionsHtml();
    $$(".ob-page").forEach(function (p) { p.hidden = p.getAttribute("data-page") !== String(step); });
    $$("#ob-steps li").forEach(function (li) { li.classList.toggle("on", li.getAttribute("data-step") === String(step)); });
    if (step === 3) fillBackground();
    show("#view-onboard");
  }
  $$("[data-go]").forEach(function (b) { b.addEventListener("click", function () { showOnboard(+b.getAttribute("data-go")); }); });
  (function () {
    var dl = $("#lang-list");
    Object.keys(LANGS).forEach(function (k) { dl.appendChild(el("option", { value: LANGS[k].en })); });
    ["English", "Arabic", "Punjabi", "Pashto", "Dari", "Cantonese", "Marathi", "Maithili", "Sindhi"].forEach(function (x) { dl.appendChild(el("option", { value: x })); });
  })();
  function fillBackground() {
    var f = $("#bg-form"), r = S.reviewer || {};
    f.code.value = r.code || ""; f.native_language.value = r.native_language || LANGS[LANG].en;
    f.other_languages.value = r.other_languages || ""; f.medical_years.value = r.medical_years != null ? r.medical_years : "";
    f.profession.value = r.profession || ""; f.profession_other.value = r.profession_other || "";
    f.consent.checked = !!r.consent; f.no_mt.checked = !!r.no_mt;
    $(".prof-other").hidden = f.profession.value !== "other";
  }
  $("#bg-form").profession.addEventListener("change", function (e) { $(".prof-other").hidden = e.target.value !== "other"; });
  $("#bg-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, errs = [];
    $$(".invalid", f).forEach(function (x) { x.classList.remove("invalid"); });
    var code = f.code.value.trim().replace(/\s+/g, "-");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(code)) { errs.push("a reviewer code (letters, digits, dashes)"); f.code.classList.add("invalid"); }
    if (!f.native_language.value.trim()) { errs.push("your native language"); f.native_language.classList.add("invalid"); }
    var yrs = f.medical_years.value === "" ? NaN : Number(f.medical_years.value);
    if (!(yrs >= 0 && yrs <= 70)) { errs.push("years of medical training or work (0 if none)"); f.medical_years.classList.add("invalid"); }
    if (!f.profession.value) { errs.push("your profession"); f.profession.classList.add("invalid"); }
    if (f.profession.value === "other" && !f.profession_other.value.trim()) { errs.push("your profession"); f.profession_other.classList.add("invalid"); }
    if (!f.consent.checked) errs.push("consent to the use of the data");
    if (!f.no_mt.checked) errs.push("the no-machine-translation pledge");
    if (errs.length) { $("#bg-err").hidden = false; $("#bg-err").textContent = "Please add " + errs.join(", ") + "."; return; }
    $("#bg-err").hidden = true;
    var had = S.reviewer && S.reviewer.consent_at;
    S.reviewer = { code: code, native_language: f.native_language.value.trim(), other_languages: f.other_languages.value.trim(),
      medical_years: yrs, profession: f.profession.value, profession_other: f.profession_other.value.trim(),
      consent: true, consent_at: had || nowIso(), no_mt: true, updated_at: nowIso() };
    S.updated_at = nowIso(); S.changes_since_export = (S.changes_since_export || 0) + 1; persist();
    openBlock(S.current || firstOpenBlock());
  });

  /* ---------------- block view ---------------- */
  function B() { return DATA.blocks[cur - 1]; }
  function isRequest() { return B().kind === "request"; }
  function partsOf(obj) {        // [[partKey, label, text]] in display order
    if (obj.prompt != null) return [["prompt", "", obj.prompt]];
    var out = [["question", "Q", obj.question]];
    obj.options.forEach(function (o) { out.push([o[0], o[0], o[1]]); });
    if (obj.statement != null) out.push(["statement", "Stmt", obj.statement]);
    return out;
  }
  function partText(n, part) {
    var t = B().translations[n - 1];
    if (part === "prompt") return t.prompt;
    if (part === "question") return t.question;
    if (part === "statement") return t.statement;
    for (var i = 0; i < t.options.length; i++) if (t.options[i][0] === part) return t.options[i][1];
    return null;
  }
  function partLabel(p) { return p === "prompt" ? "Request" : p === "question" ? "Question" : p === "statement" ? "Statement" : "Option " + p; }

  function openBlock(b) {
    b = Math.max(1, Math.min(DATA.blocks.length, b));
    if (b !== cur) undoStack = [];
    cur = b; S.current = b; active = 1; pending = null; hidePop();
    var bs = blockState(b, true); bs.visits = (bs.visits || 0) + 1;
    for (var n = 1; n <= 4; n++) { var t = trState(b, n, false); if (!trComplete(t)) { active = n; break; } }
    persist();
    show("#view-block");
    renderAll();
  }
  function renderAll() { renderChrome(); renderHead(); renderTabs(); renderTexts(); renderPanel(); }

  function renderChrome() {
    if (!DATA || !S) return;
    var d = doneCount(), N = DATA.blocks.length;
    $("#tb-fill").style.width = (100 * d / N) + "%";
    $("#tb-count").textContent = d + " / " + N + " blocks";
    var badge = $("#export-badge");
    var c = S.changes_since_export || 0;
    badge.hidden = !(S.reviewer && c > 0);
    badge.textContent = S.exported_at ? "not exported" : "never exported";
    $("#btn-export").title = (S.exported_at ? "Last export: " + new Date(S.exported_at).toLocaleString() : "Not exported yet") + " (Ctrl+S)";
  }
  function renderHead() {
    $("#blk-num").textContent = "Block " + cur + " of " + DATA.blocks.length;
    $("#blk-kind").textContent = isRequest() ? "a request to an AI assistant" :
      B().source.statement != null ? "exam question, options and statement" : "exam question and options";
    $("#btn-prev").disabled = cur === 1;
    $("#btn-next").textContent = cur === DATA.blocks.length ? "Finish" : "Next →";
  }
  function short(qi, v) {
    var q = QUESTIONS[qi]; if (qi === 2) q = taskQ();
    for (var i = 0; i < q.opts.length; i++) if (q.opts[i][0] === v) return q.opts[i][3];
    return "";
  }
  function trStatus(n) {
    var t = trState(cur, n, false);
    if (!t || (!t.fluency && !t.meaning && !t.task)) return "not started";
    return [short(0, t.fluency) || "·", short(1, t.meaning) || "·", short(2, t.task) || "·"].join(" / ");
  }
  function renderTabs() {
    var w = $("#tabs"); w.innerHTML = "";
    for (var n = 1; n <= 4; n++) (function (n) {
      var t = trState(cur, n, false);
      w.appendChild(el("button", { class: "tab" + (n === active ? " on" : "") + (trComplete(t) ? " ok" : ""), role: "tab",
        "aria-selected": n === active ? "true" : "false", "data-n": n, title: "Translation " + n + " (Shift+" + n + ")",
        onclick: function () { setActive(n); } },
        [el("span", { class: "num", text: "Translation " + n }), el("span", { class: "st", text: trStatus(n) })]));
    })(n);
    $("#compare").checked = compare;
  }
  function setActive(n) {
    if (n === active) return;
    active = n; pending = null; hidePop();
    renderTabs(); renderTexts(); renderPanel();
  }

  function renderTexts() {
    var blk = B(), src = partsOf(blk.source), dir = DATA.dir, req = isRequest();
    var cols = compare ? [1, 2, 3, 4] : [active];
    var g = el("div", { class: "grid" + (compare ? " cmp" : "") + (req ? " reqblk" : "") });
    g.appendChild(el("div", { class: "hd" }));
    g.appendChild(el("div", { class: "hd", text: req ? "English request" : "English source" }));
    cols.forEach(function (n) {
      g.appendChild(el("div", { class: "hd trh" + (n === active ? " on" : ""), text: "Translation " + n, onclick: function () { setActive(n); } }));
    });
    src.forEach(function (p) {
      var gold = !req && p[0] === blk.source.correct, rc = gold ? " row-gold" : "";
      g.appendChild(el("div", { class: "lab" + rc, style: "--rows:" + (1 + cols.length) }, [p[1] === "Stmt" ? "" : p[1],
        p[1] === "Stmt" ? el("span", { text: "Stmt." }) : null, gold ? el("span", { class: "gold-tag", text: "correct" }) : null]));
      g.appendChild(el("div", { class: "cell en" + rc + (req ? " big" : ""), lang: "en", dir: "ltr" }, [
        p[0] === "statement" ? el("span", { class: "stmt-lab", text: "Statement" }) : null, el("span", { class: "txt", text: p[2] })]));
      cols.forEach(function (n) {
        var cell = el("div", { class: "cell tr" + rc + (n === active ? " on" : ""), lang: LANG, dir: dir, "data-n": n, "data-part": p[0],
          "data-h": "Translation " + n });
        if (p[0] === "statement") cell.appendChild(el("span", { class: "stmt-lab", dir: "ltr", text: "Statement" }));
        cell.appendChild(renderPartText(n, p[0]));
        g.appendChild(cell);
      });
    });
    if (!req) g.appendChild(el("div", { class: "foot-en", lang: "en" }, ["Correct option: ", el("b", { text: blk.source.correct })]));
    var box = $("#texts"); box.innerHTML = ""; box.appendChild(g);
  }
  function spansOf(n) { var t = trState(cur, n, false); return t ? t.spans : []; }
  function renderPartText(n, part) {
    var text = partText(n, part);
    var spans = spansOf(n).filter(function (s) { return s.part === part; }).sort(function (a, b) { return a.start - b.start; });
    var wrap = el("span", { class: "txt", "data-n": n, "data-part": part }), pos = 0;
    spans.forEach(function (s) {
      if (s.start > pos) wrap.appendChild(document.createTextNode(text.slice(pos, s.start)));
      wrap.appendChild(el("mark", { class: "err hl", "data-id": s.id, title: "Highlighted problem (click to remove)",
        text: text.slice(s.start, s.end) }));
      pos = s.end;
    });
    if (pos < text.length) wrap.appendChild(document.createTextNode(text.slice(pos)));
    return wrap;
  }

  function taskQ() { return isRequest() ? TASK_REQUEST : TASK_EXAM; }
  function questionBlock(qi, t, idx) {
    var q = qi === 2 ? taskQ() : QUESTIONS[qi], field = q.field, val = t[field];
    var box = el("div", { class: "step q-" + field + (val ? " done" : "") });
    var title = q.title;
    if (qi === 2 && !isRequest()) title = title.replace("{L}", B().source.correct);
    box.appendChild(el("h3", {}, [el("span", { class: "n", text: String(idx) }), el("span", { html: title })]));
    var seg = el("div", { class: "seg", role: "radiogroup", "aria-label": q.label });
    q.opts.forEach(function (o) {
      seg.appendChild(el("button", { class: (val === o[0] ? "on" : "") + " v-" + o[0], role: "radio", "aria-checked": val === o[0] ? "true" : "false",
        title: o[1] + " (key " + o[2] + ")", onclick: function () { setAnswer(field, o[0]); } }, [o[1] + " ", el("kbd", { text: o[2] })]));
    });
    box.appendChild(seg);
    return box;
  }
  function renderPanel() {
    var p = $("#panel"); p.innerHTML = "";
    var n = active, t = trState(cur, n, false) || { spans: [], fluency: null, meaning: null, task: null, comment: "" };
    p.appendChild(el("h2", { text: "Translation " + n }));
    p.appendChild(el("div", { class: "muted small", text: "Block " + cur + " · Shift+1–4 or [ ] switch translation" }));
    p.appendChild(questionBlock(0, t, 1));
    p.appendChild(questionBlock(1, t, 2));
    p.appendChild(questionBlock(2, t, 3));

    // optional: highlight the problem and comment
    var s4 = el("div", { class: "step" });
    s4.appendChild(el("h3", {}, ["Optional ", el("span", { class: "muted small", text: "highlight the wrong part, or comment" })]));
    if (!t.spans.length) s4.appendChild(el("p", { class: "empty", html: "Select words in translation " + n + " and press <kbd>h</kbd> to highlight a problem." }));
    var ul = el("ul", { class: "spans" });
    t.spans.slice().sort(spanOrder).forEach(function (s) {
      ul.appendChild(el("li", {}, [
        el("span", { class: "t", lang: LANG, dir: DATA.dir, title: s.text, text: s.text, onclick: function () { flash(s.id); } }),
        el("span", { class: "p", text: partLabel(s.part) }),
        el("button", { class: "x", title: "Remove", "aria-label": "Remove highlight", text: "×", onclick: function () { removeSpan(n, s.id); } })
      ]));
    });
    s4.appendChild(ul);
    var ta = el("textarea", { rows: 2, placeholder: "e.g. a better word for a medical term", "aria-label": "Comment" });
    ta.value = t.comment || "";
    ta.addEventListener("input", function () { var tt = trState(cur, n, true); tt.comment = ta.value; changed(); });
    s4.appendChild(ta);
    p.appendChild(s4);

    var nextN = nextIncomplete(n);
    if (trComplete(trState(cur, n, false))) {
      if (nextN) p.appendChild(el("button", { class: "btn primary next-tr", text: "Next: translation " + nextN + " →", onclick: function () { setActive(nextN); } }));
      else p.appendChild(el("button", { class: "btn primary next-tr", text: cur === DATA.blocks.length ? "Finish ✓" : "Block complete: next block →", onclick: nextBlock }));
    }
  }
  function nextIncomplete(n) { for (var k = 1; k <= 4; k++) { var m = ((n - 1 + k) % 4) + 1; if (!trComplete(trState(cur, m, false))) return m === n ? null : m; } return null; }
  function spanOrder(a, b) {
    var order = function (p) { return p === "question" || p === "prompt" ? 0 : p === "statement" ? 99 : p.charCodeAt(0); };
    return order(a.part) - order(b.part) || a.start - b.start;
  }

  /* ---------------- annotation actions ---------------- */
  var advanceTimer = null;
  function setAnswer(field, v) {
    var t = trState(cur, active, true), was = trComplete(t);
    t[field] = v; t[field + "_at"] = nowIso(); changed(); renderTabs(); renderPanel();
    clearTimeout(advanceTimer);
    if (!was && trComplete(t)) {          // all three answered: move on to the next unfinished translation
      var nx = nextIncomplete(active), from = active;
      advanceTimer = setTimeout(function () {
        if (active !== from) return;
        if (nx) { setActive(nx); toast("Translation " + from + " done: now translation " + nx, 1500); }
        else toast("Block " + cur + " complete. Press j or Next for the next block.", 2500);
      }, 450);
    }
  }
  var spanSeq = 0;
  function newId() { spanSeq++; return Date.now().toString(36) + "-" + spanSeq; }
  function addSpan(n, part, start, end, text) {
    var t = trState(cur, n, true);
    var s = { id: newId(), part: part, start: start, end: end, text: text, created_at: nowIso() };
    t.spans.push(s);
    undoStack.push({ block: cur, n: n, op: "add", id: s.id });
    changed(); renderTabs(); renderTexts(); renderPanel();
  }
  function findSpan(n, id) { var a = spansOf(n); for (var i = 0; i < a.length; i++) if (a[i].id === id) return [a, i]; return null; }
  function removeSpan(n, id) {
    var f = findSpan(n, id); if (!f) return;
    var s = f[0].splice(f[1], 1)[0];
    undoStack.push({ block: cur, n: n, op: "del", span: s, index: f[1] });
    changed(); renderTabs(); renderTexts(); renderPanel();
  }
  function undoForBlock() { return undoStack.length && undoStack[undoStack.length - 1].block === cur; }
  function undo() {
    if (!undoForBlock()) { toast("Nothing to undo in this block."); return; }
    var u = undoStack.pop(), arr = spansOf(u.n), f;
    if (u.op === "add") { f = findSpan(u.n, u.id); if (f) arr.splice(f[1], 1); }
    else if (u.op === "del") arr.splice(u.index, 0, u.span);
    if (u.n !== active) active = u.n;
    changed(); renderTabs(); renderTexts(); renderPanel();
    toast("Undone.");
  }
  function flash(id) {
    var m = $('mark[data-id="' + id + '"]'); if (!m) return;
    m.scrollIntoView({ block: "center", behavior: "smooth" }); m.classList.add("flash");
    setTimeout(function () { m.classList.remove("flash"); }, 900);
  }

  /* selection -> offsets into the exact translation string (UTF-16 code units, as JavaScript strings) */
  var MARK_RE; try { MARK_RE = new RegExp("[\\p{M}\\u200c\\u200d]", "u"); } catch (e) { MARK_RE = /[̀-ͯऀ-ःऺ-ॏัิ-ฺ็-๎ً-ٟ‌‍]/; }
  function readSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0);
    var a = closestTxt(r.startContainer), b = closestTxt(r.endContainer);
    if (!a && !b) return null;
    if (!a || !b || a !== b) return { error: "Please select within one line (the question, one option, the statement or the request)." };
    var n = +a.getAttribute("data-n"), part = a.getAttribute("data-part"), text = partText(n, part);
    var pre = document.createRange(); pre.selectNodeContents(a); pre.setEnd(r.startContainer, r.startOffset);
    var start = pre.toString().length;
    pre.setEnd(r.endContainer, r.endOffset);
    var end = pre.toString().length;
    if (a.textContent !== text) return { error: "Internal text mismatch; please reload the page." };
    while (start > 0 && MARK_RE.test(text.charAt(start))) start--;          // never split a letter from its marks
    while (end < text.length && MARK_RE.test(text.charAt(end))) end++;
    if (start > 0 && /[\udc00-\udfff]/.test(text.charAt(start))) start--;  // nor a surrogate pair
    if (end < text.length && /[\udc00-\udfff]/.test(text.charAt(end))) end++;
    if (window.Intl && Intl.Segmenter) {                                    // snap to whole words
      try {
        var segs = new Intl.Segmenter(LANG, { granularity: "word" }).segment(text);
        var s0 = segs.containing(start), e0 = segs.containing(Math.max(start, end - 1));
        if (s0 && s0.isWordLike) start = s0.index;
        if (e0 && e0.isWordLike) end = e0.index + e0.segment.length;
      } catch (err) { /* keep the raw selection */ }
    }
    while (start < end && /\s/.test(text.charAt(start))) start++;
    while (end > start && /\s/.test(text.charAt(end - 1))) end--;
    if (start >= end) return null;
    var clash = spansOf(n).some(function (s) { return s.part === part && s.start < end && start < s.end; });
    if (clash) return { error: "That overlaps a part you already highlighted. Click the highlight to remove it." };
    return { n: n, part: part, start: start, end: end, text: text.slice(start, end), rect: r.getBoundingClientRect() };
  }
  function closestTxt(node) {
    var e = node && (node.nodeType === 1 ? node : node.parentElement);
    while (e && e !== document.body) { if (e.classList && e.classList.contains("txt") && e.hasAttribute("data-n")) return e; e = e.parentElement; }
    return null;
  }
  function markPending() {
    var p = pending || readSelection();
    if (!p) { toast("Select the problem words in a translation first."); return; }
    if (p.error) { toast(p.error, 4500); return; }
    if (p.n !== active) active = p.n;
    window.getSelection().removeAllRanges(); pending = null; hidePop();
    addSpan(p.n, p.part, p.start, p.end, p.text);
  }

  /* popover */
  var pop = $("#pop");
  function hidePop() { pop.hidden = true; pop.innerHTML = ""; pop.removeAttribute("data-span"); }
  function placePop(rect) {
    pop.hidden = false;
    var w = pop.offsetWidth, x = rect.left + rect.width / 2 - w / 2 + window.scrollX, y = rect.bottom + 8 + window.scrollY;
    x = Math.max(window.scrollX + 8, Math.min(x, window.scrollX + document.documentElement.clientWidth - w - 8));
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }
  function popForSelection(p) {
    pop.innerHTML = ""; pop.removeAttribute("data-span");
    pop.appendChild(el("button", { class: "hl", type: "button", html: "Highlight problem <kbd>h</kbd>", onclick: function () { markPending(); } }));
    placePop(p.rect);
  }
  function popForSpan(n, id, rect) {
    pop.innerHTML = "";
    pop.appendChild(el("span", { class: "hint", text: "Highlighted problem:" }));
    pop.appendChild(el("button", { type: "button", html: "Remove <kbd>Del</kbd>", onclick: function () { hidePop(); removeSpan(n, id); } }));
    pop.setAttribute("data-span", id); pop.setAttribute("data-n", n);
    placePop(rect);
  }
  pop.addEventListener("mousedown", function (e) { e.preventDefault(); });  // keep the text selection while clicking
  pop.addEventListener("pointerdown", function (e) { e.preventDefault(); });

  var selTimer = null;
  document.addEventListener("selectionchange", function () {
    if ($("#view-block").hidden) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var p = readSelection();
      if (p && !p.error) { pending = p; popForSelection(p); }
      else { pending = p && p.error ? p : null; if (!pop.hasAttribute("data-span")) hidePop(); }
    }, 120);
  });
  $("#texts").addEventListener("click", function (e) {
    var m = e.target.closest("mark.err");
    var sel = window.getSelection();
    if (m && (!sel || sel.isCollapsed)) {
      var n = +m.closest(".txt").getAttribute("data-n");
      if (n !== active) { active = n; renderTabs(); renderTexts(); renderPanel(); m = $('mark[data-id="' + m.getAttribute("data-id") + '"]'); }
      popForSpan(n, m.getAttribute("data-id"), m.getBoundingClientRect()); return;
    }
    var c = e.target.closest(".cell.tr");
    if (c && (!sel || sel.isCollapsed) && +c.getAttribute("data-n") !== active) setActive(+c.getAttribute("data-n"));
  });
  document.addEventListener("mousedown", function (e) {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("mark.err") && pop.hasAttribute("data-span")) hidePop();
  });

  /* ---------------- navigation ---------------- */
  function missingReport() {
    var out = [];
    for (var n = 1; n <= 4; n++) {
      var t = trState(cur, n, false), need = [];
      if (!t || !t.fluency) need.push("fluency");
      if (!t || !t.meaning) need.push("meaning");
      if (!t || !t.task) need.push(isRequest() ? "request check" : "answer check");
      if (need.length) out.push([n, need]);
    }
    return out;
  }
  function nextBlock() {
    var miss = missingReport();
    if (miss.length) {
      $$(".tab").forEach(function (tb) { tb.classList.toggle("missing", miss.some(function (m) { return m[0] === +tb.getAttribute("data-n"); })); });
      toast("Before moving on: " + miss.map(function (m) { return "translation " + m[0] + " needs " + m[1].join(", "); }).join("; ") + ".", 5000);
      setActive(miss[0][0]);
      return;
    }
    persist();
    if (cur === DATA.blocks.length) {
      var open = firstOpenBlock();
      if (!blockComplete(open)) { toast("Block " + open + " is not complete yet."); openBlock(open); }
      else $("#dlg-done").showModal();
      return;
    }
    openBlock(cur + 1);
  }
  function prevBlock() { if (cur > 1) { persist(); openBlock(cur - 1); } }
  $("#btn-next").addEventListener("click", nextBlock);
  $("#btn-prev").addEventListener("click", prevBlock);
  $("#compare").addEventListener("change", function (e) { compare = e.target.checked; prefs.compare = compare; savePrefs(); renderTexts(); });
  compare = !!prefs.compare;

  function openBlocks() {
    var g = $("#blk-grid"); g.innerHTML = "";
    for (var b = 1; b <= DATA.blocks.length; b++) (function (b) {
      var c = blockComplete(b) ? "done" : blockStarted(b) ? "part" : "";
      g.appendChild(el("button", { class: c + (b === cur ? " cur" : ""), title: "Block " + b + (c === "done" ? " (complete)" : c === "part" ? " (started)" : ""),
        text: String(b), onclick: function () { $("#dlg-blocks").close(); openBlock(b); } }));
    })(b);
    $("#dlg-blocks").showModal();
  }
  function openInstr() { $("#instr-body").innerHTML = instructionsHtml(); $("#dlg-instr").showModal(); }
  $("#btn-blocks").addEventListener("click", openBlocks);
  $("#btn-instr").addEventListener("click", openInstr);
  $("#btn-help").addEventListener("click", function () { $("#dlg-help").showModal(); });
  $("#btn-theme").addEventListener("click", toggleTheme);
  $("#btn-font-up").addEventListener("click", function () { fontSize(1); });
  $("#btn-font-down").addEventListener("click", function () { fontSize(-1); });
  $("#btn-menu").addEventListener("click", function () { $("#dlg-menu").showModal(); });

  /* ---------------- export / import ---------------- */
  function exportName() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    var ts = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    return "esa_" + LANG + "_" + ((S.reviewer && S.reviewer.code) || "reviewer") + "_" + ts + ".json";
  }
  function doExport() {
    if (!S || !DATA) return;
    if (!S.reviewer) { toast("Please fill in “About you” first."); return; }
    persist();
    if (!S.uid) S.uid = randomId();
    var out = { format: "esa-review-export", format_version: 2, protocol: "three-questions-v1", design: DATA.design, app_version: APP_VERSION, lang: LANG, data_version: DATA.version, uid: S.uid,
      offset_unit: "utf16", exported_at: nowIso(), timezone_offset_min: -new Date().getTimezoneOffset(),
      created_at: S.created_at, updated_at: S.updated_at, reviewer: S.reviewer,
      progress: { blocks_complete: doneCount(), blocks_total: DATA.blocks.length }, blocks: S.blocks };
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: exportName() });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    S.exported_at = out.exported_at; S.changes_since_export = 0; S.done_at_export = out.progress.blocks_complete; persist(); renderChrome();
    toast("Downloaded " + a.download + ". Please send this file to the person who invited you.", 6000);
  }
  $("#btn-export").addEventListener("click", doExport);
  $("#btn-export-done").addEventListener("click", function () { $("#dlg-done").close(); doExport(); });
  $("#btn-export-rem").addEventListener("click", function () { $("#dlg-reminder").close(); doExport(); });

  $("#btn-import").addEventListener("click", function () { $("#file-import").click(); });
  $("#file-import").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var x; try { x = JSON.parse(rd.result); } catch (err) { toast("That file is not a review export (not JSON)."); return; }
      if (!x || x.format !== "esa-review-export" || !LANGS[x.lang] || !x.blocks || !x.reviewer) { toast("That file is not a review export."); return; }
      var apply = function () {
        if (x.data_version !== DATA.version) { toast("That file was made with a different version of the texts; it cannot be loaded. Please contact the person who invited you.", 8000); return; }
        var local = S && S.reviewer ? doneCount() : 0;
        var msg = "Load " + f.name + " (" + LANGS[x.lang].en + ", reviewer " + x.reviewer.code + ", " + x.progress.blocks_complete + " blocks complete)?" +
          (local ? "\n\nThis replaces the progress saved in this browser (" + local + " blocks complete)." : "");
        if (!window.confirm(msg)) return;
        S = newState();
        S.created_at = x.created_at || S.created_at; S.updated_at = x.updated_at; S.reviewer = x.reviewer; S.blocks = x.blocks;
        S.exported_at = x.exported_at; S.changes_since_export = 0; S.done_at_export = x.progress.blocks_complete;
        if (x.uid) S.uid = x.uid;
        S.current = firstOpenBlock(); persist();
        $("#dlg-menu").close(); toast("Loaded. Continuing at block " + S.current + ".");
        openBlock(S.current);
      };
      if (x.lang !== LANG) { go(x.lang, true); loadLang(x.lang, apply); } else apply();
    };
    rd.readAsText(f, "utf-8");
  });
  $("#btn-edit-bg").addEventListener("click", function () { $("#dlg-menu").close(); showOnboard(3); });
  $("#btn-lang").addEventListener("click", function () {
    $("#dlg-menu").close(); if (S) persist();
    var u = new URL(window.location.href); u.searchParams.delete("lang"); window.history.replaceState(null, "", u.toString());
    showStart();
  });
  $("#btn-reset").addEventListener("click", function () {
    if (S && S.changes_since_export > 0 && !window.confirm("You have changes that are not exported. Export first?\n\nOK = cancel and keep my work, Cancel = continue to erase.")) {
      // fall through to the erase confirmation
    } else if (S && S.changes_since_export > 0) return;
    if (!window.confirm("Erase all " + LANGS[LANG].en + " answers saved in this browser? This cannot be undone.")) return;
    try { window.localStorage.removeItem(stateKey(LANG)); } catch (e) { /* ignore */ }
    S = newState(); $("#dlg-menu").close(); showOnboard(1);
  });

  /* ---------------- keyboard ---------------- */
  // Reviewers often type with a Thai, Persian, Urdu, Devanagari or Bengali layout active: there e.key is a native
  // letter or digit, so fall back to the physical key (e.code) whenever e.key is not plain ASCII.
  function layoutKey(e) {
    var k = e.key;
    if (k && k.length === 1 && k.charCodeAt(0) < 128 && k !== " ") return k;
    if (k && k.length > 1 && k !== "Process" && k !== "Unidentified" && k !== "Dead") return k;   // Enter, ArrowLeft, ...
    var c = e.code || "";
    if (/^Key[A-Z]$/.test(c)) return e.shiftKey ? c.slice(3) : c.slice(3).toLowerCase();
    if (/^(Digit|Numpad)[0-9]$/.test(c)) return c.slice(-1);
    if (c === "BracketLeft") return "[";
    if (c === "BracketRight") return "]";
    if (c === "Slash" && e.shiftKey) return "?";
    if (c === "Minus") return "-";
    if (c === "Equal") return e.shiftKey ? "+" : "=";
    return k;
  }
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "", typing = /INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== "checkbox";
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S" || e.code === "KeyS")) { e.preventDefault(); doExport(); return; }
    if (blockedByOtherTab) return;
    if (e.key === "Escape") { if (!pop.hidden) { hidePop(); window.getSelection().removeAllRanges(); pending = null; } return; }
    if ($("#view-block").hidden || document.querySelector("dialog[open]")) {
      if (!typing && layoutKey(e) === "?" && !$("#view-block").hidden) $("#dlg-help").showModal();
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.code === "KeyZ")) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = layoutKey(e);
    if (!pop.hidden && pop.hasAttribute("data-span") && (k === "Delete" || k === "Backspace")) {
      e.preventDefault(); var id = pop.getAttribute("data-span"), pn = +pop.getAttribute("data-n"); hidePop(); removeSpan(pn, id); return;
    }
    if (k === "h") { e.preventDefault(); markPending(); return; }
    if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setActive(+e.code.slice(5)); return; }
    if (k === "[" || k === "]") { e.preventDefault(); setActive(((active - 1 + (k === "]" ? 1 : 3)) % 4) + 1); return; }
    if (!e.shiftKey && KEYMAP[k]) { e.preventDefault(); setAnswer(KEYMAP[k][0], KEYMAP[k][1]); return; }
    if (k === "c") { compare = !compare; prefs.compare = compare; savePrefs(); $("#compare").checked = compare; renderTexts(); return; }
    if (k === "z") { e.preventDefault(); undo(); return; }
    if (k === "j" || k === "ArrowRight" || k === "PageDown") { e.preventDefault(); nextBlock(); return; }
    if (k === "k" || k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prevBlock(); return; }
    if (k === "b") { e.preventDefault(); openBlocks(); return; }
    if (k === "i") { e.preventDefault(); openInstr(); return; }
    if (k === "?") { e.preventDefault(); $("#dlg-help").showModal(); return; }
    if (k === "t") { toggleTheme(); return; }
    if (k === "+" || k === "=") { fontSize(1); return; }
    if (k === "-") { fontSize(-1); return; }
  });

  /* ---------------- one tab per language: a second tab would overwrite the first one's saved work ---------------- */
  var blockedByOtherTab = false, tabId = randomId(), chan = null, claimPending = false, persistAfterClaim = false, toldBusy = {};
  try { chan = new BroadcastChannel("esa-review"); } catch (e) { chan = null; }
  function blockTab() {
    if (blockedByOtherTab) return;
    blockedByOtherTab = true;
    var w = $("#version-warn");
    w.hidden = false; w.className = "banner warn tab-block";
    w.textContent = "This review is open in another tab or window. To keep your work safe, this tab has stopped saving. " +
      "Please close this tab and continue in the other one (or close the other one and reload this page).";
    document.body.classList.add("blocked");
  }
  function claimTab(lang) {
    if (!chan) return;
    claimPending = true;
    chan.postMessage({ type: "hello", lang: lang, tab: tabId });
    setTimeout(function () { claimPending = false; if (persistAfterClaim && !blockedByOtherTab) { persistAfterClaim = false; persist(); } }, 600);
  }
  if (chan) chan.onmessage = function (ev) {
    var m = ev.data || {};
    if (!LANG || m.lang !== LANG || m.tab === tabId) return;
    if (m.type === "hello" && !blockedByOtherTab) { toldBusy[m.tab] = 1; chan.postMessage({ type: "busy", lang: LANG, tab: tabId, to: m.tab }); }
    if (m.type === "busy" && m.to === tabId) blockTab();
  };
  window.addEventListener("storage", function (e) {     // another tab wrote this language's state
    if (!LANG || e.key !== stateKey(LANG) || e.newValue == null || blockedByOtherTab) return;
    var w = null; try { w = JSON.parse(e.newValue).writer; } catch (err) { w = null; }
    if (w && toldBusy[w]) persist();       // a newer tab we already stopped wrote once: put our copy back
    else blockTab();
  });

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  /* ---------------- start ---------------- */
  var qlang = new URLSearchParams(window.location.search).get("lang");
  if (qlang && LANGS[qlang]) loadLang(qlang); else showStart();
  window.__esa = { state: function () { return S; }, version: APP_VERSION };   // for automated tests only
})();
