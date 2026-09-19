/* Screen reading for the Discovery window (100% interface scale).

   1. locate the window: pixel templates of the two ends of the module strip
   2. fingerprint the artwork in each of the five slots (so modules can be
      followed as they move - no icon library needed)
   3. read "Optimisation: <level>": the coloured text is isolated by saturation,
      the fixed "Optimisation:" prefix is template-matched to find the line, and
      the word after it is classified by template, then by shape rules
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
  function rowsToMask(rows) {
    var h = rows.length, w = rows[0].length, m = new Uint8Array(w * h), n = 0;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) if (rows[j].charAt(i) === "#") { m[j * w + i] = 1; n++; }
    return { w: w, h: h, m: m, n: n };
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
  /* overlap score (intersection / union) of template t placed at (x,y) in mask */
  function iou(mask, t, x, y) {
    var inter = 0, extra = 0;
    for (var j = 0; j < t.h; j++) {
      var my = y + j;
      for (var i = 0; i < t.w; i++) {
        var mx = x + i;
        var v = (mx >= 0 && my >= 0 && mx < mask.w && my < mask.h) ? mask.m[my * mask.w + mx] : 0;
        var tv = t.m[j * t.w + i];
        if (v && tv) inter++; else if (v && !tv) extra++;
      }
    }
    return inter / (t.n + extra);
  }

  var prefixT = null, wordT = null, glyphT = null;
  function templates() {
    if (prefixT) return;
    prefixT = rowsToMask(G.PREFIX);
    wordT = G.WORDS.map(function (w) { var t = rowsToMask(w.rows); t.level = w.level; return t; });
    glyphT = {}; Object.keys(G.GLYPHS).forEach(function (k) { glyphT[k] = rowsToMask(G.GLYPHS[k]); });
  }

  function findPrefix(mask) {
    templates();
    var best = null;
    for (var y = 0; y + prefixT.h <= mask.h; y++) for (var x = 0; x + prefixT.w <= mask.w; x++) {
      /* cheap reject: the template's first set pixel must be set */
      if (!mask.m[(y + G.PREFIX_PROBE[1]) * mask.w + x + G.PREFIX_PROBE[0]]) continue;
      var s = iou(mask, prefixT, x, y);
      if (!best || s > best.score) best = { x: x, y: y, score: s };
    }
    return best && best.score >= 0.85 ? best : null;
  }

  /* the word after the prefix: columns until a gap wider than any word space */
  function extractWord(mask, px, py) {
    var h = prefixT.h, x = px + G.WORD_DX, x0 = -1, lastInk = -1, gapMax = 0, gap = 0, j;
    for (; x < mask.w; x++) {
      var ink = false;
      for (j = 0; j < h; j++) if (mask.m[(py + j) * mask.w + x]) { ink = true; break; }
      if (ink) { if (x0 < 0) x0 = x; else if (gap > gapMax) gapMax = gap; lastInk = x; gap = 0; }
      else { gap++; if (gap > 14) break; }
    }
    if (x0 < 0) return null;
    var w = lastInk - x0 + 1;
    return { x: x0, y: py, w: w, h: h, gapMax: gapMax, rows: maskToRows(mask, x0, py, w, h) };
  }

  function bestShift(wm, t) {
    var b = 0;
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) { var s = iou(wm, t, dx, dy); if (s > b) b = s; }
    return b;
  }

  /* -> {level, how: "learned"|"template"|"shape", score} or null.
     learned = [{level, rows}] the user corrected earlier (exact look wins). */
  function classifyWord(word, learned) {
    templates();
    var wm = rowsToMask(word.rows), i, s;
    wm.n = wm.n || 1;
    var lists = [[learned || [], "learned"], [wordT, "template"]];
    for (var li = 0; li < lists.length; li++) {
      var best = null;
      for (i = 0; i < lists[li][0].length; i++) {
        var t = lists[li][0][i];
        if (!t.m) { var lvl = t.level; t = rowsToMask(t.rows); t.level = lvl; }
        if (Math.abs(t.w - wm.w) > 3) continue;
        s = bestShift(wm, t);
        if (!best || s > best.score) best = { level: t.level, how: lists[li][1], score: s };
      }
      if (best && best.score >= 0.88) return best;
    }
    /* shape rules for the words there is no template for yet */
    if (word.gapMax >= 6) return { level: 2, how: "shape", score: 0.6 };              /* two words: Very good */
    var p = bestShift(wmHead(wm, glyphT.P.w + 1), glyphT.P);
    var gHead = bestShift(wmHead(wm, glyphT.G.w + 1), glyphT.G);
    if (gHead >= 0.8) return { level: 3, how: "shape", score: gHead };                /* G... : Good */
    if (p >= 0.8) return { level: word.w < G.POOR_MAX_W ? 5 : 0, how: "shape", score: p }; /* P... : Poor / Perfect */
    if (word.w >= G.SATISFACTORY_MIN_W) return { level: 4, how: "shape", score: 0.5 };
    if (word.w >= G.EXCELLENT_MIN_W) return { level: 1, how: "shape", score: 0.5 };
    return null;
  }
  function wmHead(wm, w) {
    w = Math.min(w, wm.w);
    var m = new Uint8Array(w * wm.h), n = 0;
    for (var j = 0; j < wm.h; j++) for (var i = 0; i < w; i++) if (wm.m[j * wm.w + i]) { m[j * w + i] = 1; n++; }
    return { w: w, h: wm.h, m: m, n: n };
  }

  /* ---------- slot artwork fingerprints ---------- */
  var FP_N = 18; /* 54px inner square -> 18x18 cells */
  function fingerprint(buf, bx, by) {
    var f = new Float32Array(FP_N * FP_N), x0 = bx + G.SLOT_INSET, y0 = by + G.SLOT_INSET, sum = 0, i, j;
    for (j = 0; j < FP_N; j++) for (i = 0; i < FP_N; i++) {
      var t = 0;
      for (var v = 0; v < 3; v++) for (var u = 0; u < 3; u++) {
        var p = ((y0 + j * 3 + v) * buf.width + x0 + i * 3 + u) * 4;
        t += 0.299 * buf.data[p] + 0.587 * buf.data[p + 1] + 0.114 * buf.data[p + 2];
      }
      f[j * FP_N + i] = t / 9; sum += t / 9;
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

  /* ---------- blueprint identity ---------- */
  function titleHash(buf, ox, oy) {
    var T = G.TITLE, hsh = 2166136261 >>> 0, ink = 0;
    for (var j = 0; j < T.h; j++) for (var i = 0; i < T.w; i++) {
      var p = ((oy + T.dy + j) * buf.width + ox + T.dx + i) * 4;
      var on = (0.299 * buf.data[p] + 0.587 * buf.data[p + 1] + 0.114 * buf.data[p + 2]) >= 150 ? 1 : 0;
      ink += on;
      hsh = Math.imul(hsh ^ (on + 1), 16777619) >>> 0;
    }
    return ink < 40 ? null : hsh.toString(36);
  }

  /* ---------- one full read of a buffer whose strip origin is at (ox,oy) ---------- */
  function readBuffer(buf, ox, oy, learned) {
    var out = { slots: [], fps: [], empty: 0 };
    for (var s = 0; s < 5; s++) {
      var bx = ox + G.SLOT_X[s], by = oy + G.SLOT_Y;
      out.slots.push({ x: bx, y: by, w: G.SLOT_SIZE, h: G.SLOT_SIZE });
      var f = fingerprint(buf, bx, by);
      if (f.contrast < G.EMPTY_CONTRAST) out.empty++;
      out.fps.push(f);
    }
    var R = G.TEXT, mask = satMask(buf, ox + R.dx, oy + R.dy, R.w, R.h);
    var pre = findPrefix(mask);
    if (pre) {
      out.textAt = { x: ox + R.dx + pre.x, y: oy + R.dy + pre.y };
      var word = extractWord(mask, pre.x, pre.y);
      if (word) {
        out.word = word;
        var c = classifyWord(word, learned);
        if (c) { out.level = c.level; out.levelHow = c.how; out.levelScore = c.score; }
      }
    }
    out.title = titleHash(buf, ox, oy);
    return out;
  }

  /* the rectangle (relative to the strip origin) that readBuffer touches */
  function box() {
    var x0 = Math.min(G.TEXT.dx, G.TITLE.dx, 0) - 2, y0 = Math.min(G.TITLE.dy, 0) - 2;
    var x1 = Math.max(G.TEXT.dx + G.TEXT.w, G.TITLE.dx + G.TITLE.w, G.SLOT_X[4] + G.SLOT_SIZE) + 2;
    var y1 = G.TEXT.dy + G.TEXT.h + 2;
    return { dx: x0, dy: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* locate + read on an Alt1 ImgRef (a handle: pixels are materialised with read()) */
  function readRef(img, learned, hint) {
    var origin = null, i, hits;
    /* look where the window was last time first - a tiny search instead of the whole client */
    for (i = 0; hint && i < anchors.length && !origin; i++) {
      var a = anchors[i], sx = Math.max(0, hint.x + a.dx - 4), sy = Math.max(0, hint.y + a.dy - 4);
      var sw = Math.min(img.width - sx, a.img.width + 8), sh = Math.min(img.height - sy, a.img.height + 8);
      if (sw < a.img.width || sh < a.img.height) continue;
      hits = A1lib.ImageDetect.findSubimage(img, a.img, sx, sy, sw, sh);
      if (hits.length) origin = { x: hits[0].x - a.dx, y: hits[0].y - a.dy, via: i };
    }
    for (i = 0; i < anchors.length && !origin; i++) {
      hits = A1lib.ImageDetect.findSubimage(img, anchors[i].img);
      if (hits.length) origin = { x: hits[0].x - anchors[i].dx, y: hits[0].y - anchors[i].dy, via: i };
    }
    if (!origin) return { error: "no-window" };
    var b = box(), rx = origin.x + b.dx, ry = origin.y + b.dy;
    if (rx < 0 || ry < 0 || rx + b.w > img.width || ry + b.h > img.height) return { error: "clipped", origin: origin };
    var buf = img.read(rx, ry, b.w, b.h);
    var r = readBuffer(buf, -b.dx, -b.dy, learned);
    /* back to capture coordinates */
    r.slots.forEach(function (s) { s.x += rx; s.y += ry; });
    if (r.textAt) { r.textAt.x += rx; r.textAt.y += ry; }
    r.origin = origin;
    return r;
  }

  function read(learned, hint) {
    if (!window.alt1) return { error: "no-alt1" };
    if (!alt1.permissionPixel) return { error: "no-permission" };
    if (!anchors) return { error: "loading" };
    if (!alt1.rsLinked) return { error: "no-rs" };
    var img = api._capture(), r = readRef(img, learned, hint);
    r.img = img;
    return r;
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
    init: init, read: read, readRef: readRef, readBuffer: readBuffer, box: box,
    satMask: satMask, maskToRows: maskToRows, rowsToMask: rowsToMask, iou: iou,
    findPrefix: findPrefix, extractWord: extractWord, classifyWord: classifyWord,
    fingerprint: fingerprint, similarity: similarity, matchSlots: matchSlots, distinct: distinct,
    titleHash: titleHash, slotImage: slotImage,
    _setAnchors: function (list) { anchors = list; }
  };
  return api;
});
