/* Prototyper UI: polls the screen, shows the next swap in the app window and
   draws it over the game. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var LEVELS = Solver.LEVELS, LETTERS = ["A", "B", "C", "D", "E"];
  var POLL_MS = 300, OVERLAY_GROUP = "prototyper", OVERLAY_MS = 6000;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window etc. */ } }
  };
  var tracker = Tracker.create(store);
  var learned = []; try { learned = JSON.parse(store.get("prototyper.learned.v2") || "[]") || []; } catch (e) { learned = []; }
  var manual = false, picks = [], manualArr = null, view = { state: "idle" }, hint = null, lastRead = null;
  var overlaySig = "", overlayAt = 0, autoScale = 1, scaleAge = 999, idleReads = 0;

  /* ---------- rendering ---------- */
  function status(msg, warn) { var el = $("status"); el.textContent = msg; el.className = warn ? "warn" : ""; }

  function tile(module, slot, cls, icons) {
    var d = document.createElement("div");
    d.className = "tile " + (cls || "");
    d.dataset.slot = slot;
    var n = document.createElement("span"); n.className = "num"; n.textContent = slot + 1; d.appendChild(n);
    if (icons && icons[module]) { var im = document.createElement("img"); im.src = icons[module]; im.alt = "module " + LETTERS[module]; d.appendChild(im); }
    else { var l = document.createElement("span"); l.className = "letter"; l.textContent = LETTERS[module]; d.appendChild(l); }
    return d;
  }

  function render() {
    var v = view, box = $("tiles"), arr = manual ? (manualArr || v.arr || [0, 1, 2, 3, 4]) : v.arr;
    document.body.classList.toggle("manual", manual);
    $("mode").textContent = manual ? "Read screen" : "Manual";
    box.innerHTML = "";
    var rec = v.rec, swapped = manual && manualArr && v.arr && manualArr.join("") !== v.arr.join("");
    if (arr) {
      arr.forEach(function (m, s) {
        var cls = "";
        if (v.state === "done" && !swapped) cls = "done";
        else if (picks.indexOf(s) >= 0) cls = "pick";
        else if (rec && rec.swap && !swapped && rec.swap.indexOf(s) >= 0) cls = "swap";
        else if (v.pending) cls = "dim";
        box.appendChild(tile(m, s, cls, manual ? null : v.icons));
      });
    }

    var ins = $("instruction"), det = $("detail");
    ins.className = "";
    if (manual && v.state === "manual-start") {
      ins.textContent = "What does the game say now?";
      det.textContent = "Call the modules A–E from left to right as they are right now, then click the rating shown under “Optimisation”.";
    } else if (swapped) {
      ins.textContent = "Now click the new rating";
      det.textContent = "You swapped slots " + diffSlots(v.arr, manualArr).join(" and ") + ". Click the rating the game shows for this order.";
    } else if (v.state === "done") {
      ins.className = "done"; ins.textContent = "Perfect — press Invent";
      det.textContent = "Solved after trying " + (v.history ? v.history.length : 1) + " order" + (v.history && v.history.length === 1 ? "" : "s") + ".";
    } else if ((v.state === "tracking") && rec && rec.swap) {
      ins.innerHTML = "Drag slot <b>" + (rec.swap[0] + 1) + "</b> onto slot <b>" + (rec.swap[1] + 1) + "</b>";
      if (rec.fallback) det.textContent = "Working without the model: trying orders that haven't been seen yet.";
      else {
        var bits = [];
        bits.push(rec.solutions === 1 ? "The solution is known" : rec.solutions + " orders still possible");
        if (rec.pPerfect >= 0.005) bits.push(Math.round(rec.pPerfect * 100) + "% chance this swap is Perfect");
        if (isFinite(rec.estimate)) bits.push("about " + Math.max(1, Math.round(rec.estimate)) + " swap" + (Math.round(rec.estimate) > 1 ? "s" : "") + " to go");
        det.textContent = bits.join(" · ");
      }
    } else {
      ins.innerHTML = "&nbsp;"; det.innerHTML = "&nbsp;";
    }

    /* rating buttons: show what was read; click to correct (or, in manual mode, to enter) */
    var rb = $("ratingbtns"); rb.innerHTML = "";
    var showRating = manual || v.state === "tracking" || v.state === "done";
    $("ratingrow").style.display = showRating ? "" : "none";
    LEVELS.forEach(function (name, lv) {
      var b = document.createElement("button");
      b.textContent = name;
      if (!swapped && v.level === lv && v.state !== "manual-start") b.className = "on";
      b.addEventListener("click", function () { onRating(lv); });
      rb.appendChild(b);
    });
    var hintEl = $("ratinghint");
    if (!showRating) hintEl.innerHTML = "&nbsp;";
    else if (manual) hintEl.textContent = swapped ? "" : "Click two tiles to swap them, then the rating you get. Clicking a rating without swapping corrects the current one.";
    else if (v.levelHow === "shape") hintEl.textContent = "Read from the screen. Wrong? Click the right one and it will be remembered.";
    else if (v.levelHow === "you" || v.levelHow === "learned") hintEl.textContent = "Rating as you taught it.";
    else hintEl.textContent = "";

    var ban = $("banner");
    if (v.contradiction) {
      ban.style.display = "";
      ban.innerHTML = "<b>The ratings seen so far can't all be true together.</b> One was probably misread (check “Orders tried” below), or the game changed how it scores. Still guiding you by trial; “Reset this puzzle” starts clean.";
    } else ban.style.display = "none";

    var hist = $("history"); hist.innerHTML = "";
    (v.history || []).forEach(function (h, i) {
      var li = document.createElement("li");
      if (v.arr && h[0].join("") === v.arr.join("")) li.className = "cur";
      li.innerHTML = h[0].map(function (m) { return LETTERS[m]; }).join(" ") + " — <span class='lv" + h[1] + "'>" + LEVELS[h[1]] + "</span>";
      hist.appendChild(li);
    });
    $("historycount").textContent = v.history && v.history.length ? "(" + v.history.length + ")" : "";
  }

  function diffSlots(a, b) { var out = []; for (var i = 0; i < 5; i++) if (a[i] !== b[i]) out.push(i + 1); return out; }

  /* ---------- overlay on the game ---------- */
  /* capture pixels -> screen pixels (Windows display scaling); "auto" measures the black band in the capture */
  function overlayFactor() { var c = $("ovscale").value; return c === "auto" ? autoScale : +c; }
  function overlayOk() { return window.alt1 && alt1.permissionOverlay && $("overlay").checked; }
  function clearOverlay() {
    if (!window.alt1 || !alt1.permissionOverlay || !overlaySig) return;
    try { alt1.overLaySetGroup(OVERLAY_GROUP); alt1.overLayClearGroup(OVERLAY_GROUP); alt1.overLaySetGroup(""); } catch (e) { /* older Alt1 */ }
    overlaySig = "";
  }
  function drawOverlay() {
    var v = view;
    if (!overlayOk() || manual || !v.slots || !(v.state === "tracking" || v.state === "done") || v.pending) { clearOverlay(); return; }
    var k = overlayFactor();
    var sig = v.state + "|" + (v.rec && v.rec.swap ? v.rec.swap.join("-") : "") + "|" + v.slots[0].x + "," + v.slots[0].y + "|" + k;
    var S = v.slots.map(function (q) { return { x: Math.round(q.x * k), y: Math.round(q.y * k), w: Math.round(q.w * k), h: Math.round(q.h * k) }; });
    var now = Date.now();
    if (sig === overlaySig && now - overlayAt < OVERLAY_MS - 1500) return;
    try {
      alt1.overLaySetGroup(OVERLAY_GROUP);
      if (alt1.overLayFreezeGroup) alt1.overLayFreezeGroup(OVERLAY_GROUP);
      alt1.overLayClearGroup(OVERLAY_GROUP);
      var green = A1lib.mixColor(60, 230, 110), gold = A1lib.mixColor(255, 200, 60);
      var mid = S[2].x + S[2].w / 2, top = S[0].y;
      if (v.state === "done") {
        alt1.overLayTextEx("Perfect - press Invent", gold, 16, Math.round(mid), top - 26, OVERLAY_MS, "", true, true);
      } else if (v.rec && v.rec.swap) {
        var a = S[v.rec.swap[0]], b = S[v.rec.swap[1]];
        [a, b].forEach(function (s) { alt1.overLayRect(green, s.x - 2, s.y - 2, s.w + 4, s.h + 4, OVERLAY_MS, 3); });
        var ax = Math.round(a.x + a.w / 2), bx = Math.round(b.x + b.w / 2), y = top - 12;
        alt1.overLayLine(green, 3, ax, a.y - 3, ax, y, OVERLAY_MS);
        alt1.overLayLine(green, 3, ax, y, bx, y, OVERLAY_MS);
        alt1.overLayLine(green, 3, bx, y, bx, b.y - 3, OVERLAY_MS);
        alt1.overLayTextEx("swap", green, 14, Math.round((ax + bx) / 2), y - 14, OVERLAY_MS, "", true, true);
      }
      if (alt1.overLayRefreshGroup) alt1.overLayRefreshGroup(OVERLAY_GROUP);
      alt1.overLaySetGroup("");
      overlaySig = sig; overlayAt = now;
    } catch (e) { /* overlay is a nicety - never let it stop the app */ }
  }

  /* ---------- screen loop ---------- */
  var REASONS = {
    "no-alt1": "Not running inside Alt1 — manual mode only.",
    "no-permission": "Give this app screen-capture permission in Alt1 (spanner icon on the app window).",
    "loading": "Loading templates…",
    "no-rs": "Alt1 can't see the RuneScape window.",
    "no-window": "Open a discovery at an Inventor's workbench — waiting for the module row.",
    "clipped": "The Discovery window is partly off-screen.",
    "moving": "Modules moving…",
    "settling": "Reading…",
    "no-rating": "Found the module row but can't read the Optimisation rating — open “reader debug” and send me the capture.",
    "lookalike": "Two modules look identical to me — use manual mode for this one."
  };
  function tick() {
    if (manual) return;
    var r;
    /* the whole-capture search (any interface scale) is the expensive path: only every 5th idle read */
    var deep = !hint && (idleReads++ % 5 === 0);
    try { r = Reader.read(learned, hint, deep); } catch (e) { status("Read failed: " + (e && e.message || e), true); return; }
    lastRead = r;
    hint = r.origin ? { x0: r.origin.x0, y0: r.origin.y0, s: r.origin.s } : null;
    if (hint) idleReads = 0;
    if (r.origin && r.img && ++scaleAge > 100) { scaleAge = 0; try { autoScale = Reader.overlayScale(r.img); } catch (e) { autoScale = 1; } }
    view = tracker.feed(r);
    if (view.needIcons && r.img) {
      try {
        var icons = [];
        view.arr.forEach(function (m, s) { icons[m] = Reader.slotImage(r.img, r.slots[s]); });
        tracker.setIcons(icons); view.icons = icons;
      } catch (e) { /* letters will do */ }
    }
    if (view.state === "idle" || view.state === "waiting") status(REASONS[view.reason] || "Waiting…", view.reason === "no-permission" || view.reason === "no-rating");
    else if (view.state === "done") status("Blueprint solved.");
    else status(view.result === "corrected" ? "This order read differently than before — using the new rating." : "Tracking this blueprint (" + view.history.length + " order" + (view.history.length === 1 ? "" : "s") + " seen).");
    render(); drawOverlay();
  }

  /* ---------- input ---------- */
  function onRating(lv) {
    if (manual) {
      var cur = tracker.manualState();
      if (cur.state === "manual-start") view = tracker.manual([0, 1, 2, 3, 4], lv);
      else if (manualArr && manualArr.join("") !== cur.arr.join("")) view = tracker.manual(manualArr, lv);
      else view = tracker.correct(lv) || cur;
      manualArr = view.arr.slice(); picks = [];
      render(); return;
    }
    if (!(view.state === "tracking" || view.state === "done") || view.level === lv) return;
    /* remember what this word looks like so it is read correctly from now on */
    if (view.word && view.word.ratio) {
      var wd = view.word;
      learned = learned.filter(function (t) { return !(!!t.gap === !!wd.gap && Math.abs(t.ratio - wd.ratio) <= 0.035 && Math.abs(t.hue - wd.hue) <= 18); });
      learned.push({ level: lv, ratio: wd.ratio, gap: !!wd.gap, hue: wd.hue });
      learned = learned.slice(-12);
      store.set("prototyper.learned.v2", JSON.stringify(learned));
    }
    var nv = tracker.correct(lv);
    if (nv) { view = nv; overlaySig = ""; render(); drawOverlay(); }
  }

  $("tiles").addEventListener("click", function (ev) {
    if (!manual) return;
    var t = ev.target.closest(".tile"); if (!t) return;
    var cur = tracker.manualState(); if (cur.state === "manual-start") return;
    var s = +t.dataset.slot, i = picks.indexOf(s);
    if (i >= 0) picks.splice(i, 1); else picks.push(s);
    if (picks.length === 2) {
      manualArr = (manualArr || cur.arr).slice();
      var x = manualArr[picks[0]]; manualArr[picks[0]] = manualArr[picks[1]]; manualArr[picks[1]] = x;
      picks = [];
    }
    render();
  });

  $("mode").addEventListener("click", function () { setManual(!manual); });
  function setManual(on) {
    manual = on; picks = []; hint = null;
    if (manual) { clearOverlay(); view = tracker.manualState(); manualArr = view.arr.slice(); status("Manual mode: you tell me the ratings."); }
    else { view = { state: "idle" }; manualArr = null; status("Looking for the Discovery window…"); }
    render();
  }

  $("reset").addEventListener("click", function () {
    tracker.reset(); picks = []; overlaySig = overlaySig || "x"; clearOverlay();
    if (manual) { view = tracker.manualState(); manualArr = view.arr.slice(); } else view = { state: "idle" };
    status("Puzzle forgotten — starting fresh."); render();
  });
  $("ovscale").addEventListener("change", function () { store.set("prototyper.ovscale", $("ovscale").value); overlaySig = ""; });
  $("overlay").addEventListener("change", function () { store.set("prototyper.overlay", $("overlay").checked ? "1" : "0"); if (!$("overlay").checked) { overlaySig = overlaySig || "x"; clearOverlay(); } else overlaySig = ""; });

  $("dbg").addEventListener("click", function (ev) {
    ev.preventDefault();
    var out = $("dbgout");
    if (out.style.display !== "none") { out.style.display = "none"; return; }
    out.style.display = ""; out.textContent = "";
    var lines = [], r = lastRead;
    lines.push("alt1: " + !!window.alt1 + (window.alt1 ? "  pixel: " + !!alt1.permissionPixel + "  overlay: " + !!alt1.permissionOverlay + "  rsLinked: " + !!alt1.rsLinked : ""));
    if (r) {
      lines.push("read: " + (r.error ? "error " + r.error : "slot frames at " + r.origin.x + "," + r.origin.y + ", interface scale x" + r.origin.s.toFixed(3) + ", found by " + r.origin.via));
      if (!r.error) {
        lines.push("rating: " + (r.level === undefined ? "unreadable" : LEVELS[r.level] + " (" + r.levelHow + ")") + "   empty slots: " + r.empty + "   blueprint: " + r.title);
        lines.push("capture " + (r.img ? r.img.width + "x" + r.img.height : "?") + "   overlay scale: x" + overlayFactor() + " (auto measured x" + autoScale + ")");
        lines.push("slot contrast: " + r.fps.map(function (f) { return f.contrast.toFixed(0); }).join(" "));
        if (r.word) { lines.push("rating word: " + r.word.w + "px, width ratio " + r.word.ratio.toFixed(3) + ", hue " + Math.round(r.word.hue) + ", two words " + r.word.gap + ", first-letter ink " + r.word.pg.toFixed(2)); r.word.rows.forEach(function (row) { lines.push(row); }); }
      }
    } else lines.push("no read yet");
    lines.push("learned rating words: " + learned.length);
    out.textContent = lines.join("\n") + "\n";
    if (r && r.img && r.img.toData) {
      try {
        var full = r.img.toData(), cv = document.createElement("canvas");
        cv.width = full.width; cv.height = full.height; cv.getContext("2d").putImageData(full, 0, 0);
        var a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "prototyper-capture.png"; a.textContent = "Download this capture (PNG)";
        out.appendChild(a);
      } catch (e) { out.appendChild(document.createTextNode("(capture export failed: " + e.message + ")")); }
    }
  });

  /* ---------- boot ---------- */
  $("overlay").checked = store.get("prototyper.overlay") !== "0";
  $("ovscale").value = store.get("prototyper.ovscale") || "auto";
  render();
  if (window.alt1) {
    alt1.identifyAppUrl("./appconfig.json");
    Reader.init().then(function () {
      status("Looking for the Discovery window…");
      setInterval(tick, POLL_MS); tick();
    }, function (e) { status("Couldn't load templates: " + e.message, true); setManual(true); });
    window.addEventListener("beforeunload", function () { overlaySig = overlaySig || "x"; clearOverlay(); });
  } else {
    $("mode").style.display = "none"; Array.prototype.forEach.call(document.querySelectorAll(".toggle"), function (el) { el.style.display = "none"; });
    setManual(true);
    status("Not running inside Alt1 — manual mode. Add it to Alt1 to have the screen read for you.");
  }

  window.Prototyper = { tick: tick, setManual: setManual, _view: function () { return view; } };
})();
