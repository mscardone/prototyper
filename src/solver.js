/* Prototyper solver - the Invention discovery ordering puzzle.

   The game's model (RuneScape wiki, "Discovery"): when a blueprint is generated
   each of the five slots gets a hidden rank 1-5 and each of the five modules
   gets a hidden rank 1-5.  An arrangement scores
        total = sum over slots |rank(slot) - rank(module in that slot)|
   and the interface only shows the bucket:
        0 Perfect, 2 Excellent, 4 Very good, 6 Good, 8 Satisfactory, 10/12 Poor.
   Slot ranks are NOT left-to-right, so there are 120 x 120 hidden states; the
   mirror image (rank r -> 6-r on both sides) scores identically, leaving 7200
   distinguishable hypotheses.

   Every (arrangement, level) you have seen filters those hypotheses.  The next
   swap is chosen to minimise the expected number of swaps still needed:
   for every arrangement b we could go and look at,
        cost(b) = swaps to reach b + E[ h(what is left after seeing b's level) ]
        h       = expected swap distance to the solution + ALPHA * entropy(bits)
   and once few hypotheses remain, each of the 10 swaps is instead scored by
   playing that policy out to the end (exact expected swaps of the follow-up).
   tools/simulate.js measures the result over every possible puzzle.

   Arrangements are arrays a[slot] = module id (0-4).  Levels are 0 (Perfect)
   to 5 (Poor).  Works as a browser global (window.Solver) and a node module. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Solver = factory();
})(this, function () {
  "use strict";

  var LEVELS = ["Perfect", "Excellent", "Very good", "Good", "Satisfactory", "Poor"];
  var XP_PCT = [100, 80, 70, 60, 40, 20];
  var ALPHA = 0.75;          /* weight of the entropy term in h */
  var ROLLOUT_MAX = 300;     /* play the policy out when this few hypotheses remain */

  /* ---- permutations of 5, swaps, swap distance ---- */
  var PERMS = [], PKEY = {};
  (function gen(a, k) {
    if (k === 5) { PKEY[a.join("")] = PERMS.length; PERMS.push(a.slice()); return; }
    for (var i = k; i < 5; i++) {
      var t = a[k]; a[k] = a[i]; a[i] = t;
      gen(a, k + 1);
      t = a[k]; a[k] = a[i]; a[i] = t;
    }
  })([0, 1, 2, 3, 4], 0);
  var NP = PERMS.length; /* 120 */

  var SWAPS = [];
  for (var si = 0; si < 5; si++) for (var sj = si + 1; sj < 5; sj++) SWAPS.push([si, sj]);

  var NB = PERMS.map(function (p) {
    return SWAPS.map(function (s) {
      var q = p.slice(); q[s[0]] = p[s[1]]; q[s[1]] = p[s[0]];
      return PKEY[q.join("")];
    });
  });

  /* minimum swaps between two arrangements = 5 - cycles of the relabelling */
  var DIST = PERMS.map(function (p) {
    return PERMS.map(function (q) {
      var m = [0, 0, 0, 0, 0], seen = [0, 0, 0, 0, 0], c = 0, s, i, j;
      for (s = 0; s < 5; s++) m[p[s]] = q[s];
      for (i = 0; i < 5; i++) {
        if (seen[i]) continue;
        c++; j = i;
        while (!seen[j]) { seen[j] = 1; j = m[j]; }
      }
      return 5 - c;
    });
  });

  /* ---- hypotheses: LV[h*120 + a] = level hypothesis h shows for arrangement a ---- */
  var NH = 0, LV = null, TARGET = null;
  function build() {
    if (LV) return;
    var keep = PERMS.filter(function (rho) {
      /* drop the mirror image: keep rho if it sorts before (4 - rho) */
      for (var s = 0; s < 5; s++) { if (rho[s] !== 4 - rho[s]) return rho[s] < 4 - rho[s]; }
      return true;
    });
    NH = keep.length * NP;
    LV = new Uint8Array(NH * NP);
    TARGET = new Uint8Array(NH);
    var h = 0;
    for (var r = 0; r < keep.length; r++) {
      var rho = keep[r];
      for (var m = 0; m < NP; m++, h++) {
        var mu = PERMS[m];
        for (var a = 0; a < NP; a++) {
          var p = PERMS[a], t = 0;
          for (var s = 0; s < 5; s++) t += Math.abs(rho[s] - mu[p[s]]);
          var lv = t >= 10 ? 5 : t >> 1;
          LV[h * NP + a] = lv;
          if (lv === 0) TARGET[h] = a;
        }
      }
    }
  }

  function arrIndex(arr) {
    var k = PKEY[arr.join("")];
    if (k === undefined) throw new Error("not an arrangement of modules 0-4: " + arr);
    return k;
  }

  /* split hypotheses by the level they predict for arrangement b */
  function split(S, b) {
    var out = [[], [], [], [], [], []];
    for (var i = 0; i < S.length; i++) out[LV[S[i] * NP + b]].push(S[i]);
    return out;
  }

  var cnt = new Int32Array(NP);
  function h(S, b) {
    if (!S.length) return 0;
    var d = 0, i, used = [];
    for (i = 0; i < S.length; i++) {
      var t = TARGET[S[i]];
      d += DIST[b][t];
      if (cnt[t]++ === 0) used.push(t);
    }
    var H = 0;
    for (i = 0; i < used.length; i++) {
      var pr = cnt[used[i]] / S.length;
      H -= pr * Math.log(pr) / Math.LN2;
      cnt[used[i]] = 0;
    }
    return d / S.length + ALPHA * H;
  }

  /* expected h after looking at arrangement b; Infinity when b tells us nothing */
  function queryValue(S, b) {
    var parts = split(S, b), c = 0;
    for (var L = 1; L < 6; L++) {
      var p = parts[L];
      if (!p.length) continue;
      if (p.length === S.length) return Infinity;
      c += h(p, b) * p.length / S.length;
    }
    return c;
  }

  /* heuristic policy: index (0-9) of the swap to make at arrangement a */
  function greedySwap(a, S) {
    var qv = new Float64Array(NP), best = -1, bv = Infinity, b, k;
    for (b = 0; b < NP; b++) {
      qv[b] = b === a ? Infinity : queryValue(S, b);
      var c = DIST[a][b] + qv[b];
      if (c < bv - 1e-9) { bv = c; best = b; }
    }
    if (best < 0) return { k: 0, value: Infinity };
    if (DIST[a][best] === 1) return { k: NB[a].indexOf(best), value: bv, goal: best };
    /* several swaps away: step towards it through the most informative stop */
    var bk = -1, kv = Infinity;
    for (k = 0; k < 10; k++) {
      var m = NB[a][k];
      if (DIST[m][best] !== DIST[a][best] - 1) continue;
      var v = qv[m] === Infinity ? 99 : qv[m];
      if (v < kv) { kv = v; bk = k; }
    }
    return { k: bk, value: bv, goal: best };
  }

  /* total swaps the heuristic policy needs, summed over every hypothesis in S */
  var rollMemo = {};
  function greedyCost(a, S) {
    if (!S.length) return 0;
    var key = S.length <= 40 ? a + ":" + S.join(",") : null;
    if (key && rollMemo[key] !== undefined) return rollMemo[key];
    var k = greedySwap(a, S).k, b = NB[a][k], parts = split(S, b), t = S.length;
    for (var L = 1; L < 6; L++) t += greedyCost(b, parts[L]);
    if (key) rollMemo[key] = t;
    return t;
  }

  function chooseSwap(a, S) {
    var g = greedySwap(a, S);
    if (S.length > ROLLOUT_MAX) return g;
    var bk = -1, bv = Infinity;
    for (var k = 0; k < 10; k++) {
      var b = NB[a][k], parts = split(S, b), t = S.length;
      for (var L = 1; L < 6; L++) t += greedyCost(b, parts[L]);
      if (t < bv - 1e-9) { bv = t; bk = k; }
    }
    return { k: bk, value: bv / S.length, goal: g.goal };
  }

  /* ---- public state machine ---- */
  function create() {
    build();
    rollMemo = {};
    var S = [], seen = {}, order = [], broken = false;
    for (var i = 0; i < NH; i++) S.push(i);

    /* record what the game showed for an arrangement.
       returns "ok" | "repeat" | "conflict" (same arrangement, different level
       than before) | "contradiction" (no hypothesis fits any more) */
    function observe(arr, level) {
      var a = arrIndex(arr);
      if (!(level >= 0 && level <= 5)) throw new Error("bad level " + level);
      if (seen[a] !== undefined) return seen[a] === level ? "repeat" : "conflict";
      seen[a] = level; order.push([arr.slice(), level]);
      if (broken) return "contradiction";
      var next = [];
      for (var i = 0; i < S.length; i++) if (LV[S[i] * NP + a] === level) next.push(S[i]);
      S = next;
      if (!S.length) { broken = true; return "contradiction"; }
      return "ok";
    }

    function targets() {
      var c = {}, out = [];
      S.forEach(function (hh) { c[TARGET[hh]] = (c[TARGET[hh]] || 0) + 1; });
      Object.keys(c).forEach(function (t) { out.push({ arr: PERMS[t].slice(), p: c[t] / S.length }); });
      return out.sort(function (x, y) { return y.p - x.p; });
    }

    /* model-free fallback (only if the game ever stops matching the wiki model):
       climb towards better levels, never revisiting an arrangement */
    function fallbackSwap(a) {
      var bestA = a, k;
      Object.keys(seen).forEach(function (s) { if (seen[s] < seen[bestA]) bestA = +s; });
      if (bestA !== a) {
        for (k = 0; k < 10; k++) if (DIST[NB[a][k]][bestA] === DIST[a][bestA] - 1) return k;
      }
      for (k = 0; k < 10; k++) if (seen[NB[a][k]] === undefined) return k;
      /* every neighbour tried: head for the nearest arrangement not seen yet */
      var goal = -1, gd = 99;
      for (var b = 0; b < NP; b++) if (seen[b] === undefined && DIST[a][b] < gd) { gd = DIST[a][b]; goal = b; }
      if (goal >= 0) for (k = 0; k < 10; k++) if (DIST[NB[a][k]][goal] === gd - 1) return k;
      return 0;
    }

    /* what to do at arrangement arr (its level must have been observed) */
    function recommend(arr) {
      var a = arrIndex(arr);
      if (seen[a] === undefined) throw new Error("observe this arrangement first");
      if (seen[a] === 0) return { done: true, swap: null, hypotheses: S.length, solutions: 1 };
      var k, out;
      if (broken) {
        k = fallbackSwap(a);
        return { done: false, fallback: true, swap: SWAPS[k].slice(), after: PERMS[NB[a][k]].slice(), hypotheses: 0, solutions: 0 };
      }
      var c = chooseSwap(a, S);
      k = c.k;
      var b = NB[a][k], win = 0;
      for (var i = 0; i < S.length; i++) if (LV[S[i] * NP + b] === 0) win++;
      var tg = targets();
      out = {
        done: false, fallback: false,
        swap: SWAPS[k].slice(),            /* slot indices to exchange */
        after: PERMS[b].slice(),           /* arrangement once swapped */
        pPerfect: win / S.length,          /* chance this very swap finishes it */
        estimate: c.value,                 /* rough expected swaps left, this one included */
        hypotheses: S.length,
        solutions: tg.length,              /* distinct orders still possible */
        best: tg[0]
      };
      return out;
    }

    return {
      observe: observe, recommend: recommend, targets: targets,
      history: function () { return order.map(function (o) { return [o[0].slice(), o[1]]; }); },
      count: function () { return S.length; },
      isBroken: function () { return broken; },
      _cands: function () { return S; }
    };
  }

  return {
    LEVELS: LEVELS, XP_PCT: XP_PCT, SWAPS: SWAPS, PERMS: PERMS,
    create: create, arrIndex: arrIndex,
    swapDistance: function (x, y) { return DIST[arrIndex(x)][arrIndex(y)]; },
    _internals: function () { build(); return { NB: NB, DIST: DIST, LV: LV, TARGET: TARGET, NH: NH, NP: NP, split: split, chooseSwap: chooseSwap, greedySwap: greedySwap }; }
  };
});
