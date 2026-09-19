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
console.log("reader (real Alt1 capture: 2560x1351 buffer, game at native size inside it)");
Reader._setAnchors(G.ANCHORS.map(function (a) { return { img: loadPng.fromDataUrl(a.png), dx: a.dx, dy: a.dy }; }));
function toRef(img) { var d = new A1lib.ImageData(img.width, img.height); d.data.set(img.data); return new A1lib.ImgRefData(d, 0, 0); }
function clone(img) { return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }; }
/* exchange the artwork of two slots, as the game does when you drag one module onto another */
function swapSlots(img, origin, i, j) {
  var out = clone(img), S = G.SLOT_SIZE;
  for (var y = 1; y < S - 1; y++) for (var x = 1; x < S - 1; x++) for (var c = 0; c < 4; c++) {
    var pi = ((origin.y + y) * img.width + origin.x + G.PITCH * i + x) * 4 + c;
    var pj = ((origin.y + y) * img.width + origin.x + G.PITCH * j + x) * 4 + c;
    out.data[pi] = img.data[pj]; out.data[pj] = img.data[pi];
  }
  return out;
}
var cap = loadPng(path.join(__dirname, "capture-satisfactory.png"));
var capRefA = toRef(cap), A = Reader.readRef(capRefA, []), reads = [];
ok("window found by the pixel templates: first slot frame at 964,625, scale 1", !A.error && A.origin.x === 964 && A.origin.y === 625 && A.origin.s === 1 && A.origin.via === "template", A.error || JSON.stringify(A.origin));
if (!A.error) {
  ok("rating read as Satisfactory", A.level === 4, A.level + " " + JSON.stringify(A.word && { ratio: A.word.ratio, hue: A.word.hue }));
  ok("rating colour is orange (hue " + Math.round(A.word.hue) + ")", A.word.hue > 20 && A.word.hue < 40);
  ok("five distinct modules present", A.empty === 0 && Reader.distinct(A.fps));
  ok("blueprint hash made", !!A.title, A.title);
  ok("slot rectangles are 50px boxes 70px apart", A.slots[1].x - A.slots[0].x === 70 && A.slots[0].w === 50 && A.slots[0].x === 964 && A.slots[0].y === 625);
  ok("Windows scaling detected from the black band: overlay x1.25", Reader.overlayScale(capRefA) === 1.25, Reader.overlayScale(capRefA));
  var B = Reader.readRef(toRef(swapSlots(cap, A.origin, 0, 3)), [], A.origin);
  ok("after a swap the window is followed from its last position", !B.error && B.origin.x === 964 && B.origin.via === "tracking", B.error || JSON.stringify(B.origin));
  var m = Reader.matchSlots(B.fps, A.fps);
  ok("modules tracked through a swap of slots 1 and 4", m && m.arr.join("") === "31204", m && m.arr.join(""));
  ok("tracking is confident (worst match " + (m ? m.worst.toFixed(3) : "-") + ")", m && m.worst > 0.93);
  ok("same blueprint -> same hash", A.title === B.title);
  var moving = clone(cap); /* a slot emptied mid-drag: paint slot 3 with flat parchment */
  for (var yy = 2; yy < 48; yy++) for (var xx = 2; xx < 48; xx++) { var q = ((625 + yy) * cap.width + 964 + 140 + xx) * 4; moving.data[q] = 214; moving.data[q + 1] = 170; moving.data[q + 2] = 100; }
  ok("an emptied slot is reported as empty", Reader.readRef(toRef(moving), []).empty === 1);
  reads = [A, B];
  A.level = 4; B.level = 2;
}
/* other game interface scales: enlarge / shrink the capture and find everything again without templates */
function resize(img, f) {
  var W = Math.round(2056 * f), H = Math.round(1089 * f), o = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var sx = (x + 0.5) / f - 0.5, sy = (y + 0.5) / f - 0.5, x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    for (var c = 0; c < 3; c++) {
      var a = img.data[(y0 * img.width + x0) * 4 + c], b = img.data[(y0 * img.width + x1) * 4 + c], cc = img.data[(y1 * img.width + x0) * 4 + c], d = img.data[(y1 * img.width + x1) * 4 + c];
      o.data[(y * W + x) * 4 + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
    }
    o.data[(y * W + x) * 4 + 3] = 255;
  }
  return o;
}
if (!A.error) [0.9, 1.25, 1.5, 2].forEach(function (f) {
  var big = resize(cap, f), R1 = Reader.readRef(toRef(big), [], null, true);
  ok("interface scale x" + f + ": found by whole-capture search, scale measured " + (R1.origin ? R1.origin.s.toFixed(3) : "-"), !R1.error && R1.origin.via === "search" && Math.abs(R1.origin.s - f) < 0.01 * f && Math.abs(R1.origin.x0 - 964 * f) < 2 && Math.abs(R1.origin.y0 - 625 * f) < 2, R1.error || JSON.stringify(R1.origin));
  if (R1.error) return;
  ok("interface scale x" + f + ": Satisfactory read, five distinct modules", R1.level === 4 && R1.empty === 0 && Reader.distinct(R1.fps), R1.level + " ratio " + (R1.word && R1.word.ratio));
  var R2 = Reader.readRef(toRef(resize(swapSlots(cap, A.origin, 1, 4), f)), [], R1.origin), m2 = !R2.error && Reader.matchSlots(R2.fps, R1.fps);
  ok("interface scale x" + f + ": a swap of slots 2 and 5 is tracked, same blueprint hash", m2 && m2.arr.join("") === "04231" && R2.title === R1.title && R2.origin.via === "tracking", R2.error || JSON.stringify(m2));
});
ok("without the deep flag an enlarged window is not searched for (cheap idle reads)", Reader.readRef(toRef(resize(cap, 1.5)), [], null, false).error === "no-window");
ok("a capture without the window -> no-window", Reader.readRef(toRef({ width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4) }), [], null, true).error === "no-window");

/* ---------------- tracker ---------------- */
console.log("tracker");
(function () {
  if (reads.length !== 2) return;
  var mem = {}, storage = { get: function (k) { return mem[k] || null; }, set: function (k, v) { mem[k] = v; } };
  var T = app.Tracker.create(storage), A = reads[0], B = reads[1];
  function frame(src, over) { var f = { slots: src.slots, fps: src.fps, empty: 0, level: src.level, levelHow: "shape", title: src.title, word: src.word }; Object.keys(over || {}).forEach(function (k) { f[k] = over[k]; }); return f; }
  var v = T.feed(frame(A)); ok("first sight: not trusted yet", v.state === "waiting");
  T.feed(frame(A)); v = T.feed(frame(A));
  ok("third identical read: tracking with a swap to make", v.state === "tracking" && v.rec.swap.length === 2 && v.history.length === 1, v.state);
  v = T.feed(frame(A, { empty: 1 })); ok("a slot empty mid-drag: waits, records nothing", v.state === "waiting");
  /* modules moved but the rating text still shows the old value for one read, then updates */
  T.feed(frame(B, { level: 4 })); T.feed(frame(B)); T.feed(frame(B)); v = T.feed(frame(B));
  ok("stale rating for a single read never reaches the solver", v.history.length === 2 && v.history[1][1] === 2 && v.state === "tracking", JSON.stringify(v.history));
  /* same order later shows a different rating: the newer one wins */
  T.feed(frame(A, { level: 3 })); T.feed(frame(A, { level: 3 })); v = T.feed(frame(A, { level: 3 }));
  ok("re-read of a known order with a new rating corrects history", v.result === "corrected" && v.history[0][1] === 3 && v.history.length === 2, v.result);
  v = T.correct(4); ok("manual correction puts it back", v.level === 4 && v.history[0][1] === 4);
  var T2 = app.Tracker.create(storage);
  T2.feed(frame(A)); T2.feed(frame(A)); v = T2.feed(frame(A));
  ok("a new tracker resumes the saved puzzle", v.history.length === 2, v.history.length);
  T2.reset(); T2.feed(frame(A)); T2.feed(frame(A)); v = T2.feed(frame(A));
  ok("reset forgets it", v.history.length === 1);
  v = T2.feed(frame(A, { title: "other" })); ok("another blueprint = another session", v.state === "waiting");
})();

/* ---------------- rating words ---------------- */
console.log("rating words (scale-free: checked on Windows screenshots enlarged to 125%)");
function findLine(img) { /* whole-image search region below the strip is not known for snips: use the lower half */
  return Reader.readRating(img, 300, Math.round(img.height * 0.85), 330, Math.round(img.height * 0.15) - 2, []);
}
var snipVG = loadPng(path.join(__dirname, "snip125-verygood.png")), snipPF = loadPng(path.join(__dirname, "snip125-perfect.png"));
var rVG = findLine(snipVG), rPF = findLine(snipPF);
ok("'Very Good' (yellow, two words) -> Very good", rVG && rVG.level === 2 && rVG.word.gap && Math.abs(rVG.word.hue - 60) < 8, JSON.stringify(rVG && rVG.word && { r: rVG.word.ratio, hue: rVG.word.hue }));
ok("'Perfect' (green) -> Perfect, ratio " + (rPF ? rPF.word.ratio.toFixed(2) : "-"), rPF && rPF.level === 0 && Math.abs(rPF.word.hue - 120) < 8, JSON.stringify(rPF && rPF.word && { r: rPF.word.ratio, hue: rPF.word.hue, pg: rPF.word.pg }));
/* build lines that were never photographed by moving pixel columns around */
function compose(parts, hgt) { /* parts: [img, x0, x1] column ranges or a number = blank columns */
  var W = 40, H2 = hgt + 20; parts.forEach(function (p) { W += typeof p === "number" ? p : p[2] - p[1] + 1; });
  var out = { width: W, height: H2, data: new Uint8ClampedArray(W * H2 * 4) }, cx = 20;
  for (var i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  parts.forEach(function (p) {
    if (typeof p === "number") { cx += p; return; }
    for (var x = p[1]; x <= p[2]; x++, cx++) for (var y = 0; y < hgt; y++) for (var c = 0; c < 3; c++) out.data[((y + 10) * W + cx) * 4 + c] = p[0].data[((p[3] + y) * p[0].width + x) * 4 + c];
  });
  return out;
}
if (rVG && rPF) {
  var vy = rVG.word.y, py = rPF.word.y, hh = rVG.word.h, preX0 = rVG.at.x, vx = rVG.word.x, px = rPF.word.x;
  /* columns of single letters inside the words, from the ink profile */
  function letters(r) { var out = [], s = -1, rows = r.word.rows; for (var x = 0; x <= r.word.w; x++) { var ink = x < r.word.w && rows.some(function (row) { return row.charAt(x) === "#"; }); if (ink) { if (s < 0) s = x; } else if (s >= 0) { out.push([s, x - 1]); s = -1; } } return out; }
  var LV = letters(rVG), LP = letters(rPF);
  var goodFirst = LV.filter(function (l) { return l[0] > rVG.word.w * 0.45; })[0][0];
  var prefix = [snipVG, preX0, vx - 7, vy];
  var good = compose([prefix, 7, [snipVG, vx + goodFirst, vx + rVG.word.w - 1, vy]], hh);
  var c1 = Reader.readRating(good, 0, 0, good.width, good.height, []);
  ok("'Good' (cut out of 'Very Good') -> Good", c1 && c1.level === 3, JSON.stringify(c1 && c1.word && { r: c1.word.ratio, pg: c1.word.pg }));
  var Pl = LP[0], oo = LV.filter(function (l) { return l[0] > goodFirst; }).slice(0, 2), rr = LP[2];
  var poor = compose([prefix, 7, [snipPF, px + Pl[0], px + Pl[1], py], 2, [snipVG, vx + oo[0][0], vx + oo[1][1], vy], 2, [snipPF, px + rr[0], px + rr[1], py]], hh);
  var c2 = Reader.readRating(poor, 0, 0, poor.width, poor.height, []);
  ok("'Poor' (assembled from P + oo + r) -> Poor", c2 && c2.level === 5, JSON.stringify(c2 && c2.word && { r: c2.word.ratio, pg: c2.word.pg }));
}
ok("a 0.62-ratio single word -> Excellent", Reader.classifyRating({ ratio: 0.62, gap: false, hue: 60, pg: 0.4 }, []).level === 1);
ok("real 'Satisfactory' features -> Satisfactory", Reader.classifyRating({ ratio: 0.896, gap: false, hue: 30, pg: 0.5 }, []).level === 4);
var lc = Reader.classifyRating({ ratio: 0.62, gap: false, hue: 50, pg: 0.4 }, [{ level: 3, ratio: 0.63, gap: false, hue: 52 }]);
ok("a user correction (learned look) beats the rules", lc.level === 3 && lc.how === "learned", JSON.stringify(lc));

/* optional: a capture passed on the command line */
var extra = process.argv[2];
if (extra) {
  console.log("capture " + extra);
  var cap = loadPng(extra), capData = new A1lib.ImageData(cap.width, cap.height);
  capData.data.set(cap.data);
  var capRef = new A1lib.ImgRefData(capData, 0, 0);
  var rr = Reader.readRef(capRef, [], null, true);
  if (rr.error) console.log("  not found: " + rr.error);
  else {
    console.log("  first slot frame at " + rr.origin.x + "," + rr.origin.y + ", interface scale x" + rr.origin.s.toFixed(3) + " (found by " + rr.origin.via + ")");
    console.log("  level: " + (rr.level === undefined ? "unreadable" : Solver.LEVELS[rr.level] + " via " + rr.levelHow) + (rr.word ? ", word/prefix width " + rr.word.ratio.toFixed(3) + ", hue " + Math.round(rr.word.hue) + ", two words: " + rr.word.gap : ""));
    console.log("  overlay scale for Windows display scaling: x" + Reader.overlayScale(capRef));
    if (rr.word) rr.word.rows.forEach(function (row) { console.log("    " + row); });
    console.log("  empty slots: " + rr.empty + ", modules distinct: " + Reader.distinct(rr.fps) + ", blueprint hash " + rr.title);
  }
}

console.log("\n" + (checks - fails) + "/" + checks + " checks passed");
process.exit(fails ? 1 : 0);
