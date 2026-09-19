/* Screen reading for the Discovery window, at any interface scale.

   1. locate the window: pixel templates of the module strip's ends (instant, native
      size only), else a whole-capture search for the strip's shape; either way the
      ten slot-frame lines are then fitted for exact position AND scale
   2. fingerprint the artwork in each of the five slots (so modules can be
      followed as they move - no icon library needed)
   3. read "Optimisation: <rating>": the coloured text is isolated by saturation
      and the rating word is classified by scale-free features (width relative to
      "Optimisation:", one word or two, colour, first letter) - no font needed
   4. hash the blueprint's title/description so progress is kept per blueprint

   Everything geometric lives in src/anchor.js (written by tools/make-anchor.js).
   Pure functions take a plain {width,height,data} RGBA buffer so node can test
   them; read() is the only part that talks to Alt1. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.Reader = factory(root.A1lib, root.ProtoAnchor);
})(this, function (A1lib, G) {
  "use strict";

  var anchors = null; /* [{img, dx, dy}] - dx,dy = template position relative to the strip origin */

  function init() {
    return Promise.all(G.ANCHORS.map(function (a) {
      return A1lib.ImageDetect.imageDataFromUrl(a.png).then(function (img) { return { img: img, dx: a.dx, dy: a.dy }; });
    })).then(function (list) { anchors = list; return true; });
  }

  /* ---------- coloured-text mask ---------- */
  function isSat(d, p) {
    var r = d[p], g = d[p + 1], b = d[p + 2];
    var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    return mx >= 150 && mx - mn >= 110;
  }
  function satMask(buf, x, y, w, h) {
    var m = new Uint8Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= buf.width || sy >= buf.height) continue;
      if (isSat(buf.data, (sy * buf.width + sx) * 4)) m[j * w + i] = 1;
    }
    return { w: w, h: h, m: m };
  }
  function maskToRows(mask, x, y, w, h) {
    var rows = [];
    for (var j = 0; j < h; j++) {
      var s = "";
      for (var i = 0; i < w; i++) s += (x + i < mask.w && y + j < mask.h && mask.m[(y + j) * mask.w + x + i]) ? "#" : ".";
      rows.push(s);
    }
    return rows;
  }
  /* ---------- the rating line: "Optimisation: <word>" ----------
     Scale-free on purpose: the line is found as the first run of coloured rows,
     split into tokens at word-sized gaps, and the word is described by
       ratio = its width / the width of "Optimisation:"   (font-size independent)
       gap   = is it two words?                            (only "Very Good" is)
       hue   = the text colour                             (the game colours ratings)
       pg    = ink in the lower right of the first letter  (G has it, P does not)  */
  function readRating(buf, rx, ry, rw, rh, learned) {
    var mask = satMask(buf, rx, ry, rw, rh), w = mask.w, h = mask.h, m = mask.m, x, y, n;
    var top = -1, bot = -1;
    for (y = 0; y < h && top < 0; y++) { n = 0; for (x = 0; x < w; x++) n += m[y * w + x]; if (n >= 3) top = y; }
    if (top < 0) return null;
    function rowInk(yy) { if (yy >= h) return 0; var c = 0; for (var i = 0; i < w; i++) c += m[yy * w + i]; return c; }
    bot = top;
    while (bot + 1 < h && (rowInk(bot + 1) > 0 || rowInk(bot + 2) > 0)) bot++;
    while (bot > top && rowInk(bot) === 0) bot--;
    var H = bot - top + 1;
    if (H < 7 || H > 70) return null;
    var cols = [];
    for (x = 0; x < w; x++) { n = 0; for (y = top; y <= bot; y++) n += m[y * w + x]; cols.push(n); }
    var minGap = Math.max(3, Math.round(0.25 * H)), tokens = [], start = -1, gap = 0;
    for (x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0) { gap++; if (gap >= minGap || x === w) { tokens.push([start, x - gap]); start = -1; } }
    }
    if (tokens.length < 2) return null;
    var pre = tokens[0], preW = pre[1] - pre[0] + 1;
    if (preW / H < 5.2 || preW / H > 8.2) return null;          /* not "Optimisation:" */
    var first = tokens[1][0], last = tokens[tokens.length - 1][1], wordW = last - first + 1;
    /* colour of the word */
    var sr = 0, sg = 0, sb = 0, cnt = 0;
    for (y = top; y <= bot; y++) for (x = first; x <= last; x++) if (m[y * w + x]) {
      var p = ((ry + y) * buf.width + rx + x) * 4; sr += buf.data[p]; sg += buf.data[p + 1]; sb += buf.data[p + 2]; cnt++;
    }
    sr /= cnt; sg /= cnt; sb /= cnt;
    var mx = Math.max(sr, sg, sb), mn = Math.min(sr, sg, sb), hue = 0;
    if (mx > mn) {
      if (mx === sr) hue = 60 * (((sg - sb) / (mx - mn)) % 6); else if (mx === sg) hue = 60 * ((sb - sr) / (mx - mn) + 2); else hue = 60 * ((sr - sg) / (mx - mn) + 4);
      if (hue < 0) hue += 360;
    }
    /* first letter: ink in its lower-right part (between 50% and 80% of the capital height) */
    var gEnd = first; while (gEnd + 1 <= last && cols[gEnd + 1]) gEnd++;
    var capH = Math.round(H * 0.74), gx0 = Math.round(first + (gEnd - first + 1) * 0.55), ink = 0, area = 0;
    for (y = top + Math.round(capH * 0.5); y <= top + Math.round(capH * 0.8); y++) for (x = gx0; x <= gEnd; x++) { area++; ink += m[y * w + x]; }
    var word = {
      x: rx + first, y: ry + top, w: wordW, h: H, ratio: wordW / preW, gap: tokens.length > 2, hue: hue, pg: area ? ink / area : 0,
      rows: maskToRows(mask, first, top, wordW, H)
    };
    var c = classifyRating(word, learned);
    return { word: word, level: c ? c.level : undefined, how: c ? c.how : undefined, at: { x: rx + pre[0], y: ry + top } };
  }

  function hueDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  /* -> {level, how: "learned"|"shape"} or null.  learned = [{level, ratio, gap, hue}] from the user's corrections */
  function classifyRating(word, learned) {
    var best = null;
    (learned || []).forEach(function (t) {
      if (!!t.gap !== !!word.gap || Math.abs(t.ratio - word.ratio) > 0.035 || hueDiff(t.hue, word.hue) > 18) return;
      var d = Math.abs(t.ratio - word.ratio);
      if (!best || d < best.d) best = { level: t.level, how: "learned", d: d };
    });
    if (best) return best;
    var r = word.ratio;
    if (word.gap) return { level: 2, how: "shape" };                          /* Very Good */
    if (r < 0.43) return { level: word.pg > 0.2 ? 3 : 5, how: "shape" };      /* Good / Poor */
    if (r < 0.57) return { level: 0, how: "shape" };                          /* Perfect */
    if (r < 0.70) return { level: 1, how: "shape" };                          /* Excellent */
    if (r < 1.05) return { level: 4, how: "shape" };                          /* Satisfactory */
    return null;
  }

  /* ---------- geometry ----------
     Everything is measured from L0 = the top-left corner of the first slot's
     frame, in "native" pixels (game interface scaling 100%), and multiplied by
     the measured scale s.  The slot frames make a very regular pattern - ten
     thin dark vertical lines at 0,49,70,119,...,329 native px - and that
     pattern is what gives both the exact position and the exact scale. */
  var LINES = []; (function () { for (var i = 0; i < 5; i++) { LINES.push(i * G.PITCH); LINES.push(i * G.PITCH + G.LINE_SPAN); } })();

  function lumAt(buf, x, y) { var p = (y * buf.width + x) * 4; return 0.299 * buf.data[p] + 0.587 * buf.data[p + 1] + 0.114 * buf.data[p + 2]; }

  /* mean luminance of each column (or row) of a rectangle */
  function profile(buf, xa, ya, xb, yb, alongX) {
    xa = Math.max(0, Math.round(xa)); ya = Math.max(0, Math.round(ya)); xb = Math.min(buf.width - 1, Math.round(xb)); yb = Math.min(buf.height - 1, Math.round(yb));
    var n = alongX ? xb - xa + 1 : yb - ya + 1, out = new Float32Array(Math.max(0, n)), x, y, t;
    if (alongX) for (x = xa; x <= xb; x++) { t = 0; for (y = ya; y <= yb; y++) t += lumAt(buf, x, y); out[x - xa] = t / (yb - ya + 1); }
    else for (y = ya; y <= yb; y++) { t = 0; for (x = xa; x <= xb; x++) t += lumAt(buf, x, y); out[y - ya] = t / (xb - xa + 1); }
    return { v: out, from: alongX ? xa : ya };
  }
  /* how line-like the profile is at position p: brighter side neighbour minus the darkest value on the line */
  function lineness(pr, p, sc) {
    var i = Math.round(p) - pr.from, k = Math.floor(sc / 2), d = Math.max(3, Math.round(3 * sc)), v = 1e9, j;
    if (i - d < 0 || i + d >= pr.v.length) return -50;
    for (j = i - k; j <= i + k; j++) if (pr.v[j] < v) v = pr.v[j];
    return Math.max(pr.v[i - d], pr.v[i + d]) - v;
  }
  function scoreX(pr, x0, sc) { var t = 0, good = 0; for (var i = 0; i < LINES.length; i++) { var q = lineness(pr, x0 + LINES[i] * sc, sc); t += q; if (q >= 12) good++; } return { mean: t / LINES.length, good: good }; }

  /* fit position + scale of the slot frames near a guess {x0,y0,s}; tol = how far to look (fraction of scale / native px) */
  function fitFrames(buf, guess, tolS, tolPx) {
    var s0 = guess.s, H = G.SLOT_SIZE * s0, best = null, sc, x0, y0;
    var prX = profile(buf, guess.x0 - (tolPx + 12) * s0, guess.y0 + 0.2 * H, guess.x0 + (LINES[9] + tolPx + 12) * s0, guess.y0 + 0.8 * H, true);
    var stepS = Math.max(0.002, tolS / 12);
    for (sc = s0 * (1 - tolS); sc <= s0 * (1 + tolS) + 1e-9; sc += s0 * stepS) {
      for (x0 = guess.x0 - tolPx * s0; x0 <= guess.x0 + tolPx * s0; x0 += 0.5) {
        var q = scoreX(prX, x0, sc);
        if (!best || q.mean > best.mean) best = { mean: q.mean, good: q.good, x0: x0, s: sc };
      }
    }
    if (!best || best.mean < 22 || best.good < 8) return null;
    /* rows: average over the insides of all five boxes, look for the top and bottom frame lines */
    var prY = null, acc = null, i, n = 0;
    for (i = 0; i < 5; i++) {
      var xa = best.x0 + (i * G.PITCH + 8) * best.s, xb = best.x0 + (i * G.PITCH + G.LINE_SPAN - 8) * best.s;
      var pr = profile(buf, xa, guess.y0 - (tolPx + 12) * s0, xb, guess.y0 + (G.LINE_SPAN + tolPx + 12) * s0, false);
      if (!acc) { acc = pr; } else for (var k = 0; k < acc.v.length && k < pr.v.length; k++) acc.v[k] += pr.v[k];
      n++;
    }
    for (i = 0; i < acc.v.length; i++) acc.v[i] /= n;
    prY = acc;
    var by = null;
    for (y0 = guess.y0 - tolPx * s0; y0 <= guess.y0 + tolPx * s0; y0 += 0.5) {
      var a = lineness(prY, y0, best.s), b = lineness(prY, y0 + G.LINE_SPAN * best.s, best.s), m = Math.min(a, b);
      if (!by || m > by.m) by = { m: m, y0: y0 };
    }
    if (!by || by.m < 12) return null;
    /* at (practically) native size, snap to whole pixels so every read is pixel-identical */
    if (Math.abs(best.s - 1) < 0.004) return { x0: Math.round(best.x0), y0: Math.round(by.y0), s: 1, score: best.mean };
    return { x0: best.x0, y0: by.y0, s: best.s, score: best.mean };
  }

  /* whole-capture search for parchment-coloured rectangles shaped like the module strip */
  function isParchment(d, p) { var r = d[p], g = d[p + 1], b = d[p + 2]; return r > 140 && g > 75 && b < 150 && r - b > 55 && r >= g; }
  function findCandidates(buf) {
    var W = buf.width >> 1, H = buf.height >> 1, m = new Uint8Array(W * H), x, y, out = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (isParchment(buf.data, ((y * 2) * buf.width + x * 2) * 4)) m[y * W + x] = 1;
    var stack = new Int32Array(W * H);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (m[y * W + x] !== 1) continue;
      var sp = 0, xa = x, xb = x, ya = y, yb = y, cnt = 0;
      stack[sp++] = y * W + x; m[y * W + x] = 2;
      while (sp) {
        var q = stack[--sp], qx = q % W, qy = (q - qx) / W; cnt++;
        if (qx < xa) xa = qx; if (qx > xb) xb = qx; if (qy < ya) ya = qy; if (qy > yb) yb = qy;
        if (qx > 0 && m[q - 1] === 1) { m[q - 1] = 2; stack[sp++] = q - 1; }
        if (qx < W - 1 && m[q + 1] === 1) { m[q + 1] = 2; stack[sp++] = q + 1; }
        if (qy > 0 && m[q - W] === 1) { m[q - W] = 2; stack[sp++] = q - W; }
        if (qy < H - 1 && m[q + W] === 1) { m[q + W] = 2; stack[sp++] = q + W; }
      }
      var w = xb - xa + 1, h = yb - ya + 1;
      if (w * 2 < 120 || w / h < 4.0 || w / h > 7.2 || cnt / (w * h) < 0.4) continue;
      out.push({ x: xa * 2, y: ya * 2, w: w * 2, h: h * 2 });
    }
    return out.sort(function (a, b) { return b.w - a.w; }).slice(0, 24);
  }
  /* scale-free locate: candidates -> frame fit.  The parchment is G.PARCH (native) wide and starts G.PARCH_DX left of L0. */
  function locate(buf) {
    var cands = findCandidates(buf), best = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], s0 = c.w / G.PARCH_W;
      var fit = fitFrames(buf, { x0: c.x + G.PARCH_DX * s0, y0: c.y + G.PARCH_DY * s0, s: s0 }, 0.09, 9);
      if (fit) fit = fitFrames(buf, fit, 0.012, 2) || fit;     /* second, finer pass */
      if (fit && (!best || fit.score > best.score)) best = fit;
    }
    return best;
  }

  /* ---------- slot artwork fingerprints (14x14 cells over the inside of the box, any scale) ---------- */
  var FP_N = 14;
  function fingerprint(buf, bx, by, sc) {
    sc = sc || 1;
    var f = new Float32Array(FP_N * FP_N), x0 = bx + G.SLOT_INSET * sc, y0 = by + G.SLOT_INSET * sc, cell = (G.SLOT_SIZE - 2 * G.SLOT_INSET) * sc / FP_N, sum = 0, i, j;
    for (j = 0; j < FP_N; j++) for (i = 0; i < FP_N; i++) {
      var xa = Math.round(x0 + i * cell), xb = Math.max(xa, Math.round(x0 + (i + 1) * cell) - 1), ya = Math.round(y0 + j * cell), yb = Math.max(ya, Math.round(y0 + (j + 1) * cell) - 1), t = 0;
      for (var y = ya; y <= yb; y++) for (var x = xa; x <= xb; x++) t += lumAt(buf, x, y);
      t /= (xb - xa + 1) * (yb - ya + 1);
      f[j * FP_N + i] = t; sum += t;
    }
    var mean = sum / f.length, ss = 0;
    for (i = 0; i < f.length; i++) { f[i] -= mean; ss += f[i] * f[i]; }
    var norm = Math.sqrt(ss) || 1;
    for (i = 0; i < f.length; i++) f[i] /= norm;
    f.contrast = Math.sqrt(ss / f.length); /* flat parchment = no module in the slot */
    return f;
  }
  function similarity(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /* which stored module sits in each slot -> arrangement, or null if not a clean permutation */
  function matchSlots(fps, refs) {
    var arr = [], used = {}, worst = 1;
    for (var s = 0; s < 5; s++) {
      var bi = -1, bs = -2;
      for (var m = 0; m < 5; m++) { var v = similarity(fps[s], refs[m]); if (v > bs) { bs = v; bi = m; } }
      if (used[bi] || bs < G.MATCH_MIN) return null;
      used[bi] = 1; arr.push(bi); if (bs < worst) worst = bs;
    }
    return { arr: arr, worst: worst };
  }
  function distinct(fps) {
    var mx = -1;
    for (var i = 0; i < 5; i++) for (var j = i + 1; j < 5; j++) mx = Math.max(mx, similarity(fps[i], fps[j]));
    return mx < G.DISTINCT_MAX;
  }

  /* ---------- blueprint identity: hash of the bright text in the title box, sampled on the native grid ---------- */
  function titleHash(buf, x0, y0, sc) {
    sc = sc || 1;
    var T = G.TITLE, hsh = 2166136261 >>> 0, ink = 0;
    for (var j = 0; j < T.h; j++) for (var i = 0; i < T.w; i++) {
      var x = Math.round(x0 + (T.dx + i) * sc), y = Math.round(y0 + (T.dy + j) * sc), on = 0;
      if (x >= 0 && y >= 0 && x < buf.width && y < buf.height) on = lumAt(buf, x, y) >= 150 ? 1 : 0;
      ink += on;
      hsh = Math.imul(hsh ^ (on + 1), 16777619) >>> 0;
    }
    return ink < 40 ? null : hsh.toString(36);
  }

  /* ---------- one full read of a buffer, frames at L0 = (x0,y0), scale sc ---------- */
  function readBuffer(buf, x0, y0, sc, learned) {
    var out = { slots: [], fps: [], empty: 0, scale: sc };
    for (var s = 0; s < 5; s++) {
      var bx = x0 + s * G.PITCH * sc, by = y0;
      out.slots.push({ x: Math.round(bx), y: Math.round(by), w: Math.round(G.SLOT_SIZE * sc), h: Math.round(G.SLOT_SIZE * sc) });
      var f = fingerprint(buf, bx, by, sc);
      if (f.contrast < G.EMPTY_CONTRAST) out.empty++;
      out.fps.push(f);
    }
    var R = G.TEXT, rating = readRating(buf, Math.round(x0 + R.dx * sc), Math.round(y0 + R.dy * sc), Math.round(R.w * sc), Math.round(R.h * sc), learned);
    if (rating) {
      out.textAt = rating.at; out.word = rating.word;
      if (rating.level !== undefined) { out.level = rating.level; out.levelHow = rating.how; }
    }
    out.title = titleHash(buf, x0, y0, sc);
    return out;
  }

  /* the rectangle (native px relative to L0) that a read touches */
  function box() {
    var x0 = Math.min(G.TEXT.dx, G.TITLE.dx, 0) - 16, y0 = Math.min(G.TITLE.dy, 0) - 4;
    var x1 = Math.max(G.TEXT.dx + G.TEXT.w, G.TITLE.dx + G.TITLE.w, 4 * G.PITCH + G.SLOT_SIZE) + 16;
    var y1 = G.TEXT.dy + G.TEXT.h + 4;
    return { dx: x0, dy: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* locate + read on an Alt1 ImgRef (a handle: pixels are materialised with read()).
     hint = {x0,y0,s} from the previous read; deep = allow the whole-capture search. */
  function readRef(img, learned, hint, deep) {
    var guess = null, via = "", i, hits, b = box();
    function region(g) {
      var rx = Math.floor(g.x0 + b.dx * g.s), ry = Math.floor(g.y0 + b.dy * g.s), rw = Math.ceil(b.w * g.s), rh = Math.ceil(b.h * g.s);
      if (rx < 0 || ry < 0 || rx + rw > img.width || ry + rh > img.height) return null;
      return { rx: rx, ry: ry, buf: img.read(rx, ry, rw, rh) };
    }
    function tryAt(g, tolS, tolPx) {
      var R = region(g); if (!R) return "clipped";
      var fit = fitFrames(R.buf, { x0: g.x0 - R.rx, y0: g.y0 - R.ry, s: g.s }, tolS, tolPx);
      if (!fit) return null;
      var r = readBuffer(R.buf, fit.x0, fit.y0, fit.s, learned);
      r.slots.forEach(function (sl) { sl.x += R.rx; sl.y += R.ry; });
      if (r.textAt) { r.textAt.x += R.rx; r.textAt.y += R.ry; }
      r.origin = { x0: fit.x0 + R.rx, y0: fit.y0 + R.ry, s: fit.s, x: Math.round(fit.x0 + R.rx), y: Math.round(fit.y0 + R.ry) };
      return r;
    }
    var res = null;
    if (hint) { res = tryAt(hint, 0, 0); if (!res) res = tryAt(hint, 0.006, 3); via = "tracking"; } /* unchanged position first: identical reads stay identical */
    if (!res || res === "clipped") {
      /* native-size fast path: exact pixel templates of the strip's ends (Alt1 searches these natively) */
      for (i = 0; anchors && i < anchors.length && !guess; i++) {
        hits = A1lib.ImageDetect.findSubimage(img, anchors[i].img);
        if (hits.length) guess = { x0: hits[0].x - anchors[i].dx + G.L0_DX, y0: hits[0].y - anchors[i].dy + G.L0_DY, s: 1 };
      }
      if (guess) { res = tryAt(guess, 0.006, 3); via = "template"; }
    }
    if ((!res || res === "clipped") && deep) {
      /* any interface scale: look at the whole capture */
      var full = img.read(0, 0, img.width, img.height), loc = locate(full);
      if (loc) { res = tryAt(loc, 0.006, 3); via = "search"; }
    }
    if (res === "clipped") return { error: "clipped" };
    if (!res) return { error: "no-window" };
    res.origin.via = via;
    return res;
  }

  function read(learned, hint, deep) {
    if (!window.alt1) return { error: "no-alt1" };
    if (!alt1.permissionPixel) return { error: "no-permission" };
    if (!anchors) return { error: "loading" };
    if (!alt1.rsLinked) return { error: "no-rs" };
    var img = api._capture(), r = readRef(img, learned, hint, deep);
    r.img = img;
    return r;
  }

  /* everything the debug panel wants to know about why a capture was or wasn't read */
  function diagnose(img) {
    var d = { size: img.width + "x" + img.height, anchors: anchors ? anchors.length : 0, templateHits: [], candidates: null, located: null, error: null };
    try {
      (anchors || []).forEach(function (a, i) { var h = A1lib.ImageDetect.findSubimage(img, a.img); d.templateHits.push("template " + i + ": " + h.length + " hit" + (h.length === 1 ? "" : "s") + (h.length ? " @" + h[0].x + "," + h[0].y : "")); });
      var full = img.read(0, 0, img.width, img.height), c = findCandidates(full), loc = locate(full);
      d.candidates = c.length + " strip-shaped areas" + (c.length ? ", widest " + c[0].w + "x" + c[0].h + " @" + c[0].x + "," + c[0].y : "");
      d.located = loc ? "frames @" + loc.x0.toFixed(1) + "," + loc.y0.toFixed(1) + " scale x" + loc.s.toFixed(3) + " (score " + loc.score.toFixed(0) + ")" : "no frame pattern found";
    } catch (e) { d.error = String(e && e.message || e); }
    return d;
  }

  /* Windows display scaling: the game can render at the logical size inside a
     physical-size capture (black band right and bottom).  Things then appear on
     screen bigger than in the capture by this factor - the overlay needs it. */
  function overlayScale(img) {
    function dark(d, i) { return d.data[i] <= 10 && d.data[i + 1] <= 10 && d.data[i + 2] <= 10; }
    var W = img.width, H = img.height, cw = 0, ch = 0, k, i, d;
    for (k = 1; k <= 3; k++) {                       /* three rows, three columns */
      d = img.read(0, Math.round(H * 0.12 * k), W, 1);
      for (i = W - 1; i >= 0 && dark(d, i * 4); i--) { /* walk in from the right */ }
      if (i + 1 > cw) cw = i + 1;
      d = img.read(Math.round(W * 0.12 * k), 0, 1, H);
      for (i = H - 1; i >= 0 && dark(d, i * 4); i--) { /* walk up from the bottom */ }
      if (i + 1 > ch) ch = i + 1;
    }
    if (cw < 100 || ch < 100 || W - cw < 40 || H - ch < 40) return 1;   /* no black band */
    var f = (W / cw + H / ch) / 2, snaps = [1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
    for (k = 0; k < snaps.length; k++) if (Math.abs(f - snaps[k]) < 0.04) return snaps[k];
    return Math.round(f * 100) / 100;
  }

  /* PNG data-url of one slot's artwork, for showing the modules in the app */
  function slotImage(img, slot) {
    var d = img.toData ? img.toData(slot.x, slot.y, slot.w, slot.h) : null;
    if (!d) return null;
    var cv = document.createElement("canvas"); cv.width = d.width; cv.height = d.height;
    cv.getContext("2d").putImageData(d, 0, 0);
    return cv.toDataURL("image/png");
  }

  var api = {
    _capture: function () { return A1lib.captureHoldFullRs(); }, /* tests swap this out */
    init: init, read: read, diagnose: diagnose, readRef: readRef, readBuffer: readBuffer, box: box, locate: locate, fitFrames: fitFrames, findCandidates: findCandidates,
    satMask: satMask, maskToRows: maskToRows, readRating: readRating, classifyRating: classifyRating, overlayScale: overlayScale,
    fingerprint: fingerprint, similarity: similarity, matchSlots: matchSlots, distinct: distinct,
    titleHash: titleHash, slotImage: slotImage,
    _setAnchors: function (list) { anchors = list; }
  };
  return api;
});
