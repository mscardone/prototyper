/* Turns a stream of screen reads into solver observations.

   - one session per blueprint (keyed by the title hash), saved to storage so a
     half-solved puzzle survives closing the window or Alt1
   - the five modules are whatever artwork was in the slots the first time the
     blueprint was seen (module 0-4 = slots left to right at that moment)
   - a reading only counts once the same (order, rating) has been seen on three
     consecutive reads (~1s), so half-finished drags never reach the solver
   - if the same order ever shows a different rating than before, the newer
     reading wins and the solver is rebuilt from the corrected history

   storage = {get(key) -> string|null, set(key, string)}; pure otherwise. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.Tracker = factory(root.Solver, root.Reader);
})(this, function (Solver, Reader) {
  "use strict";

  var STORE_KEY = "prototyper.sessions.v1", KEEP = 8, STABLE_READS = 3, REMATCH_AFTER = 8;

  function create(storage) {
    var sessions = {}, cur = null, lastKey = null, stable = 0, misses = 0, view = { state: "idle" };
    try { sessions = JSON.parse(storage.get(STORE_KEY) || "{}") || {}; } catch (e) { sessions = {}; }

    function save() {
      var keys = Object.keys(sessions).sort(function (a, b) { return (sessions[b].t || 0) - (sessions[a].t || 0); });
      keys.slice(KEEP).forEach(function (k) { delete sessions[k]; });
      try { storage.set(STORE_KEY, JSON.stringify(sessions)); } catch (e) { /* full or blocked: carry on in memory */ }
    }

    function rebuild(sess) {
      sess.recCache = null;
      sess.solver = Solver.create();
      sess.status = "ok";
      sess.history.forEach(function (h) { var r = sess.solver.observe(h[0], h[1]); if (r === "contradiction") sess.status = r; });
    }

    function open(id) {
      if (cur && cur.id === id) return cur;
      var s = sessions[id];
      if (!s) s = sessions[id] = { refs: null, icons: null, history: [], t: Date.now() };
      cur = { id: id, data: s, history: s.history, refs: s.refs ? s.refs.map(function (r) { return Float32Array.from(r); }) : null };
      rebuild(cur);
      lastKey = null; stable = 0; misses = 0; view = { state: "idle" };
      return cur;
    }

    function startPuzzle(fps) {
      cur.refs = fps.map(function (f) { return Float32Array.from(f); });
      cur.data.refs = fps.map(function (f) { return Array.prototype.map.call(f, function (v) { return Math.round(v * 1000) / 1000; }); });
      cur.data.icons = null;
      cur.history.length = 0;
      rebuild(cur);
      cur.needIcons = true;
    }

    function record(arr, level) {
      var res = cur.solver.observe(arr, level);
      if (res === "repeat") return res;
      if (res === "conflict") {
        cur.history.forEach(function (h) { if (h[0].join("") === arr.join("")) h[1] = level; });
        rebuild(cur);
        res = "corrected";
      } else {
        cur.history.push([arr.slice(), level]);
        if (res === "contradiction") cur.status = res;
      }
      cur.data.t = Date.now();
      save();
      return res;
    }

    function makeView(arr, level, extra) {
      var v = { state: "tracking", arr: arr.slice(), level: level, session: cur.id, icons: cur.data.icons, moves: Math.max(0, cur.history.length - 1), history: cur.history };
      /* recommend() can take a moment - only redo it when something changed */
      var ck = arr.join("") + "|" + cur.history.length + "|" + level;
      if (!cur.recCache || cur.recCache.key !== ck) cur.recCache = { key: ck, rec: cur.solver.recommend(arr) };
      v.rec = cur.recCache.rec;
      if (v.rec.done) v.state = "done";
      if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
      return v;
    }

    /* one screen read (Reader.read result) -> what the app should show */
    function feed(r) {
      if (r.error) { lastKey = null; stable = 0; return (view = { state: "idle", reason: r.error }); }
      var sess = open(r.title || "untitled");
      /* the step before the puzzle: modules still on the sheet, track empty, no rating yet */
      if (r.empty === 5 && r.level === undefined) { lastKey = null; stable = 0; return (view = { state: "waiting", reason: "place", slots: r.slots }); }
      if (r.empty > 0) { lastKey = null; stable = 0; return (view = { state: "waiting", reason: "moving", slots: r.slots }); }
      var asked = false;
      if (r.level === undefined) {
        /* rating unreadable: if the modules can still be followed, ask the user for the rating
           once per order (and reuse what they said when that order is seen again) */
        if (!sess.refs && Reader.distinct(r.fps)) startPuzzle(r.fps);
        var mm = sess.refs ? Reader.matchSlots(r.fps, sess.refs) : null, known;
        if (!mm) { lastKey = null; stable = 0; return (view = { state: "waiting", reason: "no-rating", slots: r.slots }); }
        sess.history.forEach(function (h) { if (h[0].join("") === mm.arr.join("")) known = h[1]; });
        if (known === undefined) {
          lastKey = null; stable = 0;
          return (view = { state: "ask", reason: "no-rating", arr: mm.arr, slots: r.slots, icons: sess.data.icons, history: sess.history, needIcons: !!sess.needIcons });
        }
        r = Object.assign({}, r, { level: known, levelHow: "you" }); asked = true;
      }
      if (!sess.refs) {
        if (!Reader.distinct(r.fps)) return (view = { state: "waiting", reason: "lookalike", slots: r.slots });
        startPuzzle(r.fps);
      }
      var m = Reader.matchSlots(r.fps, sess.refs);
      if (!m) {
        lastKey = null; stable = 0;
        /* different artwork for a while = a different puzzle behind the same title */
        if (++misses >= REMATCH_AFTER && Reader.distinct(r.fps)) { startPuzzle(r.fps); misses = 0; }
        return (view = { state: "waiting", reason: "moving", slots: r.slots });
      }
      misses = 0;
      var key = m.arr.join("") + ":" + r.level;
      if (key === lastKey) stable++; else { lastKey = key; stable = 1; }
      if (stable < STABLE_READS) {
        if (view.state === "tracking" || view.state === "done") { view.slots = r.slots; view.pending = true; return view; }
        return (view = { state: "waiting", reason: "settling", slots: r.slots });
      }
      var res = stable === STABLE_READS ? record(m.arr, r.level) : "repeat";
      view = makeView(m.arr, r.level, { slots: r.slots, levelHow: r.levelHow, word: r.word, result: res, needIcons: !!sess.needIcons, contradiction: sess.status === "contradiction" });
      return view;
    }

    /* the user says the rating on screen is really `level`: fix the newest entry */
    function correct(level) {
      if (!cur || !cur.history.length || !view.arr) return null;
      var key = view.arr.join(""), hit = null;
      cur.history.forEach(function (h) { if (h[0].join("") === key) hit = h; });
      if (!hit) return null;
      hit[1] = level;
      rebuild(cur); save();
      lastKey = null; stable = 0;
      return (view = makeView(hit[0], level, { slots: view.slots, levelHow: "you", manual: view.manual, contradiction: cur.status === "contradiction" }));
    }

    /* the user tells us the rating for the order on screen (used when it can't be read) */
    function supply(level) {
      if (!cur || view.state !== "ask" || !view.arr) return null;
      var arr = view.arr, slots = view.slots;
      record(arr, level);
      return (view = makeView(arr, level, { slots: slots, levelHow: "you", contradiction: cur.status === "contradiction" }));
    }

    function setIcons(list) { if (cur) { cur.data.icons = list; cur.needIcons = false; save(); } }

    function reset() {
      if (!cur) return;
      delete sessions[cur.id]; save();
      cur = null; lastKey = null; stable = 0; view = { state: "idle" };
    }

    /* manual mode: no screen reading, the user reports order + rating */
    function manual(arr, level) {
      open("manual");
      if (!cur.refs) { cur.refs = []; }
      var res = record(arr, level);
      return (view = makeView(arr, level, { result: res, manual: true, contradiction: cur.status === "contradiction" }));
    }
    function manualState() {
      open("manual");
      if (!cur.history.length) return { state: "manual-start", arr: [0, 1, 2, 3, 4] };
      var last = cur.history[cur.history.length - 1];
      return makeView(last[0], last[1], { manual: true, contradiction: cur.status === "contradiction" });
    }

    return { feed: feed, correct: correct, supply: supply, setIcons: setIcons, reset: reset, manual: manual, manualState: manualState, view: function () { return view; } };
  }

  return { create: create };
});
