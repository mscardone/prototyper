/* Plays the solver against every possible puzzle (all 7200 hidden states, the
   start arrangement is arbitrary by symmetry) and compares it with the usual
   "try each pair, keep it if the rating improves, otherwise put it back" method.
     npm run simulate                                                        */
var path = require("path");
var Solver = require(path.join(__dirname, "../src/solver.js"));
var I = Solver._internals();
var NB = I.NB, LV = I.LV, NP = I.NP, NH = I.NH;

function solverStats() {
  var total = 0, max = 0, hist = {}, perStart = [];
  function rec(a, S, depth) {
    if (!S.length) return;
    var k = I.chooseSwap(a, S).k, b = NB[a][k], parts = I.split(S, b), d = depth + 1;
    if (parts[0].length) { hist[d] = (hist[d] || 0) + parts[0].length; total += d * parts[0].length; if (d > max) max = d; }
    for (var L = 1; L < 6; L++) rec(b, parts[L], d);
  }
  var all = []; for (var i = 0; i < NH; i++) all.push(i);
  var parts = I.split(all, 0);
  for (var L = 1; L < 6; L++) {
    var before = total; rec(0, parts[L], 0);
    perStart.push({ start: Solver.LEVELS[L], puzzles: parts[L].length, avg: (total - before) / parts[L].length });
  }
  return { avg: total / (NH - parts[0].length), max: max, hist: hist, perStart: perStart };
}

function pairMethodStats() {
  var total = 0, n = 0, max = 0;
  for (var h = 0; h < NH; h++) {
    var a = 0, moves = 0, guard = 0;
    if (LV[h * NP + a] === 0) continue;
    outer: while (guard++ < 200) {
      for (var k = 0; k < 10; k++) {
        var b = NB[a][k]; moves++;
        if (LV[h * NP + b] < LV[h * NP + a]) { a = b; if (LV[h * NP + a] === 0) break outer; break; }
        moves++; /* put it back */
      }
    }
    total += moves; n++; if (moves > max) max = moves;
  }
  return { avg: total / n, max: max };
}

if (require.main === module) {
  var t0 = Date.now();
  var s = solverStats(), p = pairMethodStats();
  console.log("Prototyper solver : avg " + s.avg.toFixed(2) + " swaps, worst case " + s.max);
  s.perStart.forEach(function (r) { console.log("   starting from " + (r.start + "            ").slice(0, 13) + r.avg.toFixed(2) + "  (" + r.puzzles + " puzzles)"); });
  console.log("   swaps needed -> puzzles: " + JSON.stringify(s.hist));
  console.log("Try-every-pair    : avg " + p.avg.toFixed(2) + " swaps, worst case " + p.max);
  console.log("(" + (Date.now() - t0) + " ms)");
}
module.exports = { solverStats: solverStats, pairMethodStats: pairMethodStats };
