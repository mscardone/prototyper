/* Headless checks: solver model + policy, and the whole screen-reading pipeline
   against the reference screenshots in test/.
     npm test                       everything
     npm test path/to/capture.png   also reads that capture and prints what it sees */
var path = require("path"), fs = require("fs");
var app = require("../tools/loadapp.js");
var Solver = app.Solver, Reader = app.Reader, G = app.Anchor, A1lib = app.A1lib, loadPng = app.loadPng;
var fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) console.log("  ok   " + name);
  else { fails++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---------------- solver ---------------- */
console.log("solver model");
var I = Solver._internals();
ok("7200 distinguishable hypotheses", I.NH === 7200, I.NH);
ok("10 swaps, 120 arrangements", Solver.SWAPS.length === 10 && Solver.PERMS.length === 120);
ok("swap distance: identity 0, one swap 1, 5-cycle 4",
  Solver.swapDistance([0,1,2,3,4],[0,1,2,3,4]) === 0 && Solver.swapDistance([0,1,2,3,4],[1,0,2,3,4]) === 1 && Solver.swapDistance([0,1,2,3,4],[1,2,3,4,0]) === 4);

/* Scott's two screenshots: gear,belt,piston,chain,cog = Very good; piston,belt,cog,chain,gear = Perfect */
var s = Solver.create();
ok("screenshot 1 fits the model", s.observe([0,1,2,3,4], 2) === "ok" && s.count() > 0, s.count());
ok("screenshot 2 (Perfect) fits the model too", s.observe([2,1,4,3,0], 0) === "ok" && s.count() > 0, s.count());
ok("recommend() reports done on Perfect", s.recommend([2,1,4,3,0]).done === true);
s = Solver.create(); s.observe([0,1,2,3,4], 2);
ok("same reading twice = repeat", s.observe([0,1,2,3,4], 2) === "repeat");
ok("different reading for same order = conflict", s.observe([0,1,2,3,4], 4) === "conflict");

/* play puzzles through the public API exactly as the app does */
function play(levelOf, maxSwaps) {
  var st = Solver.create(), arr = [0,1,2,3,4], swaps = 0;
  st.observe(arr, levelOf(arr));
  while (swaps < maxSwaps) {
    var r = st.recommend(arr);
    if (r.done) return { swaps: swaps, broken: st.isBroken() };
    var t = arr[r.swap[0]]; arr[r.swap[0]] = arr[r.swap[1]]; arr[r.swap[1]] = t;
    swaps++;
    st.observe(arr, levelOf(arr));
  }
  return { swaps: Infinity };
}
function modelPuzzle(rho, mu) {
  return function (arr) { var t = 0; for (var i = 0; i < 5; i++) t += Math.abs(rho[i] - mu[arr[i]]); return t >= 10 ? 5 : t / 2; };
}
var seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function shuffled() { var a = [0,1,2,3,4]; for (var i = 4; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
console.log("solver play-throughs");
var total = 0, worst = 0, N = 150, bad = 0;
for (var g = 0; g < N; g++) { var res = play(modelPuzzle(shuffled(), shuffled()), 20); if (res.swaps === Infinity || res.broken) bad++; else { total += res.swaps; worst = Math.max(worst, res.swaps); } }
ok(N + " random puzzles all solved without leaving the model", bad === 0, bad + " failed");
ok("average swaps under 7.5 (got " + (total / N).toFixed(2) + ")", total / N < 7.5);
ok("worst case <= 13 swaps (got " + worst + ")", worst <= 13);

/* a game that does NOT follow the model: rating = number of misplaced modules */
var secret = [3,0,4,1,2];
var odd = play(function (arr) { var m = 0; for (var i = 0; i < 5; i++) if (arr[i] !== secret[i]) m++; return Math.min(5, m); }, 150);
ok("off-model game still gets solved by the fallback (" + odd.swaps + " swaps)", odd.swaps < 150 && odd.broken === true);

/* ---------------- reader ---------------- */
console.log("reader");
var shots = [
  { file: "shot-verygood.png", level: 2 },
  { file: "shot-perfect.png", level: 0 }
];
function anchorsFromData() {
  return G.ANCHORS.map(function (a) { return { img: loadPng.fromDataUrl(a.png), dx: a.dx, dy: a.dy }; });
}
Reader._setAnchors(anchorsFromData());
var reads = shots.map(function (sh) {
  var img = loadPng(path.join(__dirname, sh.file));
  /* paste into a bigger "client" so the search has to find it, and go through the ImgRef path Alt1 uses */
  var W = 1500, H = 1000, offx = 333, offy = 121;
  var big = new A1lib.ImageData(W, H);
  for (var i = 0; i < W * H; i++) { big.data[i * 4] = (i * 7) % 90; big.data[i * 4 + 1] = (i * 13) % 90; big.data[i * 4 + 2] = (i * 3) % 90; big.data[i * 4 + 3] = 255; }
  for (var y = 0; y < img.height; y++) for (var x = 0; x < img.width; x++) {
    var p = (y * img.width + x) * 4, q = ((y + offy) * W + x + offx) * 4;
    big.data[q] = img.data[p]; big.data[q + 1] = img.data[p + 1]; big.data[q + 2] = img.data[p + 2]; big.data[q + 3] = 255;
  }
  var r = Reader.readRef(new A1lib.ImgRefData(big, 0, 0), []);
  ok(sh.file + ": window found", !r.error, r.error);
  if (r.error) return null;
  ok(sh.file + ": level read as " + Solver.LEVELS[sh.level] + " by template", r.level === sh.level && r.levelHow === "template", r.level + "/" + r.levelHow);
  ok(sh.file + ": five modules present", r.empty === 0 && Reader.distinct(r.fps));
  ok(sh.file + ": blueprint hash made", !!r.title, r.title);
  return r;
}).filter(Boolean);
if (reads.length === 2) {
  ok("same blueprint -> same hash in both shots", reads[0].title === reads[1].title, reads[0].title + " vs " + reads[1].title);
  var m = Reader.matchSlots(reads[1].fps, reads[0].fps);
  ok("modules tracked between shots: piston,belt,cog,chain,gear", m && m.arr.join("") === "21430", m && m.arr.join(""));
  ok("tracking is confident (worst match " + (m ? m.worst.toFixed(3) : "-") + ")", m && m.worst > 0.95);
  var st = Solver.create();
  ok("read -> solver: both observations accepted", st.observe([0,1,2,3,4], reads[0].level) === "ok" && st.observe(m.arr, reads[1].level) === "ok");
  ok("slot rectangles are 62px boxes 87-88px apart", reads[0].slots[1].x - reads[0].slots[0].x === 88 && reads[0].slots[0].w === 62);
}

/* ---------------- tracker ---------------- */
console.log("tracker");
(function () {
  if (reads.length !== 2) return;
  var mem = {}, storage = { get: function (k) { return mem[k] || null; }, set: function (k, v) { mem[k] = v; } };
  var T = app.Tracker.create(storage), A = reads[0], B = reads[1];
  function frame(src, over) { var f = { slots: src.slots, fps: src.fps, empty: 0, level: src.level, levelHow: "template", title: src.title }; Object.keys(over || {}).forEach(function (k) { f[k] = over[k]; }); return f; }
  var v = T.feed(frame(A)); ok("first sight: not trusted yet", v.state === "waiting");
  T.feed(frame(A)); v = T.feed(frame(A));
  ok("third identical read: tracking with a swap to make", v.state === "tracking" && v.rec.swap.length === 2 && v.history.length === 1, v.state);
  v = T.feed(frame(A, { empty: 1 })); ok("a slot empty mid-drag: waits, records nothing", v.state === "waiting");
  /* modules moved but the rating text still shows the old value for one read, then updates */
  T.feed(frame(B, { level: 2 })); T.feed(frame(B)); T.feed(frame(B)); v = T.feed(frame(B));
  ok("stale rating for a single read never reaches the solver", v.history.length === 2 && v.history[1][1] === 0 && v.state === "done", JSON.stringify(v.history));
  /* same order later shows a different rating: the newer one wins */
  T.feed(frame(A, { level: 3 })); T.feed(frame(A, { level: 3 })); v = T.feed(frame(A, { level: 3 }));
  ok("re-read of a known order with a new rating corrects history", v.result === "corrected" && v.history[0][1] === 3 && v.history.length === 2, v.result);
  v = T.correct(2); ok("manual correction puts it back", v.level === 2 && v.history[0][1] === 2);
  var T2 = app.Tracker.create(storage);
  T2.feed(frame(A)); T2.feed(frame(A)); v = T2.feed(frame(A));
  ok("a new tracker resumes the saved puzzle", v.history.length === 2 && v.rec.solutions === 1, v.history.length);
  T2.reset(); T2.feed(frame(A)); T2.feed(frame(A)); v = T2.feed(frame(A));
  ok("reset forgets it", v.history.length === 1);
  v = T2.feed(frame(A, { title: "other" })); ok("another blueprint = another session", v.state === "waiting");
})();

/* level words there is no screenshot of yet: check the shape rules on synthetic words */
console.log("level word rules");
function rowsSlice(rows, x0, w) { return rows.map(function (r) { return (r + Array(w + 1).join(".")).substr(x0, w); }); }
function concat(list, gap) { return list[0].map(function (_, j) { return list.map(function (rows) { return rows[j]; }).join(Array(gap + 1).join(".")); }); }
function word(rows) {
  var w = rows[0].length, gapMax = 0, gap = 0, started = false;
  for (var x = 0; x < w; x++) { var ink = rows.some(function (r) { return r.charAt(x) === "#"; }); if (ink) { if (started && gap > gapMax) gapMax = gap; gap = 0; started = true; } else gap++; }
  return { w: w, h: rows.length, gapMax: gapMax, rows: rows };
}
var VG = G.WORDS.filter(function (w) { return w.level === 2; })[0].rows, PF = G.WORDS.filter(function (w) { return w.level === 0; })[0].rows;
var goodStart = VG[0].length - 1; /* find "Good": the part after the widest gap */
(function () { var gap = 0, best = 0, at = 0; for (var x = 0; x < VG[0].length; x++) { var ink = VG.some(function (r) { return r.charAt(x) === "#"; }); if (ink) { if (gap > best) { best = gap; at = x; } gap = 0; } else gap++; } goodStart = at; })();
var GOOD = rowsSlice(VG, goodStart, VG[0].length - goodStart);
var c = Reader.classifyWord(word(GOOD), []);
ok("'Good' (cut from 'Very Good') -> Good", c && c.level === 3, JSON.stringify(c));
var P = G.GLYPHS.P, oo = rowsSlice(GOOD, G.GLYPHS.G[0].length + 2, 19), r_ = rowsSlice(PF, 19, 6);
c = Reader.classifyWord(word(concat([P, oo, r_], 2)), []);
ok("'Poor' (assembled from P + oo + r) -> Poor", c && c.level === 5, JSON.stringify(c));
c = Reader.classifyWord(word(rowsSlice(G.PREFIX, 0, 74)), []);
ok("74px single word not starting with P/G -> Excellent", c && c.level === 1, JSON.stringify(c));
c = Reader.classifyWord(word(rowsSlice(G.PREFIX, 0, 101)), []);
ok("101px single word not starting with P/G -> Satisfactory", c && c.level === 4, JSON.stringify(c));
c = Reader.classifyWord(word(rowsSlice(G.PREFIX, 0, 74)), [{ level: 4, rows: rowsSlice(G.PREFIX, 0, 74) }]);
ok("a user correction (learned word) beats the rules", c && c.level === 4 && c.how === "learned", JSON.stringify(c));

/* optional: a capture passed on the command line */
var extra = process.argv[2];
if (extra) {
  console.log("capture " + extra);
  var cap = loadPng(extra), capData = new A1lib.ImageData(cap.width, cap.height);
  capData.data.set(cap.data);
  var capRef = new A1lib.ImgRefData(capData, 0, 0);
  var rr = Reader.readRef(capRef, []);
  if (rr.error) console.log("  not found: " + rr.error);
  else {
    console.log("  strip origin " + rr.origin.x + "," + rr.origin.y + " (anchor " + rr.origin.via + ")");
    console.log("  level: " + (rr.level === undefined ? "unreadable" : Solver.LEVELS[rr.level] + " via " + rr.levelHow + " (" + rr.levelScore.toFixed(2) + ")") + ", word width " + (rr.word ? rr.word.w : "-"));
    if (rr.word) rr.word.rows.forEach(function (row) { console.log("    " + row); });
    console.log("  empty slots: " + rr.empty + ", modules distinct: " + Reader.distinct(rr.fps) + ", blueprint hash " + rr.title);
  }
}

console.log("\n" + (checks - fails) + "/" + checks + " checks passed");
process.exit(fails ? 1 : 0);
