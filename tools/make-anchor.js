/* Cuts the pixel templates + geometry in src/anchor.js out of reference
   screenshots of the Discovery window (100% interface scale, lossless PNG).

     node tools/make-anchor.js            print diagnostics only
     node tools/make-anchor.js --write    also rewrite src/anchor.js

   References (test/): shot-verygood.png is the master - REF.origin is the
   top-left corner of the module strip in it.  Every extra shot listed in
   EXTRA contributes a whole-word template for the level it shows, so to teach
   the reader a new level word: drop a screenshot in test/, add it to EXTRA,
   run with --write. */
var fs = require("fs"), path = require("path"), PNG = require("pngjs").PNG;
var root = path.join(__dirname, "..");
var loadPng = require("./pngload.js");
var R = require(path.join(root, "src/reader.js"))(null, {});

var REF = { file: "test/shot-verygood.png", origin: [404, 474], level: 2 };
var EXTRA = [
  { file: "test/shot-perfect.png", level: 0 }
  /* { file: "test/shot-excellent.png", level: 1 }, ... */
];

var GEO = {
  SLOT_X: [20, 108, 195, 283, 370], SLOT_Y: 14, SLOT_SIZE: 62, SLOT_INSET: 4,
  TEXT: { dx: -60, dy: 170, w: 330, h: 70 },
  TITLE: { dx: 131, dy: -416, w: 320, h: 95 },
  MATCH_MIN: 0.8, DISTINCT_MAX: 0.75, EMPTY_CONTRAST: 6
};
var ANCHOR_BOXES = [ { dx: 0, dy: 0, w: 24, h: 14 }, { dx: 429, dy: 0, w: 24, h: 14 } ];

function crop(img, x, y, w, h) {
  var o = new PNG({ width: w, height: h });
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var p = ((y + j) * img.width + x + i) * 4, q = (j * w + i) * 4;
    o.data[q] = img.data[p]; o.data[q + 1] = img.data[p + 1]; o.data[q + 2] = img.data[p + 2]; o.data[q + 3] = 255;
  }
  return o;
}
function findExact(img, needle) {
  for (var y = 0; y + needle.height <= img.height; y++) for (var x = 0; x + needle.width <= img.width; x++) {
    var ok = true;
    for (var j = 0; j < needle.height && ok; j++) for (var i = 0; i < needle.width; i++) {
      var p = ((y + j) * img.width + x + i) * 4, q = (j * needle.width + i) * 4;
      if (Math.abs(img.data[p] - needle.data[q]) + Math.abs(img.data[p + 1] - needle.data[q + 1]) + Math.abs(img.data[p + 2] - needle.data[q + 2]) > 12) { ok = false; break; }
    }
    if (ok) return [x, y];
  }
  return null;
}

/* the first coloured text line inside the TEXT box, split into tokens at gaps >= 5px */
function textLine(img, origin) {
  var T = GEO.TEXT, mask = R.satMask(img, origin[0] + T.dx, origin[1] + T.dy, T.w, T.h);
  var rowInk = [], j, i;
  for (j = 0; j < mask.h; j++) { var n = 0; for (i = 0; i < mask.w; i++) n += mask.m[j * mask.w + i]; rowInk.push(n); }
  var top = rowInk.findIndex(function (n) { return n > 0; }), bot = top;
  while (bot + 1 < mask.h && (rowInk[bot + 1] > 0 || rowInk[bot + 2] > 0)) bot++;
  var cols = [];
  for (i = 0; i < mask.w; i++) { var c = 0; for (j = top; j <= bot; j++) c += mask.m[j * mask.w + i]; cols.push(c > 0); }
  var runs = [], start = -1, gap = 0;
  for (i = 0; i <= mask.w; i++) {
    if (i < mask.w && cols[i]) { if (start < 0) start = i; gap = 0; }
    else if (start >= 0) { gap++; if (gap >= 5 || i === mask.w) { runs.push([start, i - gap]); start = -1; } }
  }
  return { mask: mask, top: top, bot: bot, runs: runs, cols: cols };
}
function letterWidths(cols, x0, x1) {
  var out = [], s = -1;
  for (var i = x0; i <= x1 + 1; i++) { if (i <= x1 && cols[i]) { if (s < 0) s = i; } else if (s >= 0) { out.push(i - s); s = -1; } }
  return out;
}

var ref = loadPng(path.join(root, REF.file));
var line = textLine(ref, REF.origin);
var H = line.bot - line.top + 1;
var pre = line.runs[0];
console.log("reference text line rows " + line.top + "-" + line.bot + " (h=" + H + "), tokens " + JSON.stringify(line.runs));
var PREFIX = R.maskToRows(line.mask, pre[0], line.top, pre[1] - pre[0] + 1, H);
var probe = [PREFIX[0].length ? 0 : 0, 0];
outer: for (var pj = 0; pj < H; pj++) for (var pi = 0; pi < PREFIX[pj].length; pi++) if (PREFIX[pj].charAt(pi) === "#") { probe = [pi, pj]; break outer; }
var WORD_DX = pre[1] - pre[0] + 1 + 3;

function wordRows(ln, preRun) {
  var first = ln.runs[1][0], last = ln.runs[ln.runs.length - 1][1];
  return { rows: R.maskToRows(ln.mask, first, ln.top, last - first + 1, H), first: first, last: last };
}
var words = [], glyphs = {};
var w0 = wordRows(line); words.push({ level: REF.level, rows: w0.rows });
var widths = { prefix: letterWidths(line.cols, pre[0], pre[1]), ref: letterWidths(line.cols, w0.first, w0.last) };
console.log("letter widths  Optimisation: " + widths.prefix.join(" ") + "   |  " + "Very Good: " + widths.ref.join(" "));
/* G = first letter of the second word of "Very Good" */
var gRun = line.runs[2], gW = letterWidths(line.cols, gRun[0], gRun[1])[0];
glyphs.G = R.maskToRows(line.mask, gRun[0], line.top, gW, H);

var originsOk = true;
var anchorPngs = ANCHOR_BOXES.map(function (b) { return crop(ref, REF.origin[0] + b.dx, REF.origin[1] + b.dy, b.w, b.h); });
var extraOrigins = [];
EXTRA.forEach(function (e) {
  var img = loadPng(path.join(root, e.file));
  var hit = findExact(img, anchorPngs[0]), hit2 = findExact(img, anchorPngs[1]);
  if (!hit || !hit2 || hit2[0] - hit[0] !== ANCHOR_BOXES[1].dx || hit2[1] !== hit[1]) { console.log("!! anchors not found consistently in " + e.file, hit, hit2); originsOk = false; return; }
  var ln = textLine(img, hit);
  if (ln.bot - ln.top + 1 !== H) console.log("!! line height differs in " + e.file + ": " + (ln.bot - ln.top + 1));
  var wr = wordRows(ln);
  words.push({ level: e.level, rows: wr.rows });
  var lw = letterWidths(ln.cols, wr.first, wr.last);
  console.log(e.file + ": origin " + hit + ", text rows " + ln.top + "-" + ln.bot + ", word width " + wr.rows[0].length + ", letters " + lw.join(" "));
  if (e.level === 0) glyphs.P = R.maskToRows(ln.mask, wr.first, ln.top, lw[0], H);
  extraOrigins.push({ file: e.file, origin: hit });
});

console.log("word widths: " + words.map(function (w) { return w.level + "=" + w.rows[0].length; }).join(", "));

/* slot fingerprint separation */
var G2 = Object.assign({}, GEO);
var Rg = require(path.join(root, "src/reader.js"))(null, G2);
function fps(img, o) { return GEO.SLOT_X.map(function (sx) { return Rg.fingerprint(img, o[0] + sx, o[1] + GEO.SLOT_Y); }); }
var fa = fps(ref, REF.origin);
console.log("slot contrast (ref): " + fa.map(function (f) { return f.contrast.toFixed(1); }).join(" "));
var same = [];
for (var a = 0; a < 5; a++) for (var b2 = a + 1; b2 < 5; b2++) same.push(Rg.similarity(fa[a], fa[b2]));
console.log("different modules, max similarity: " + Math.max.apply(null, same).toFixed(3));
extraOrigins.forEach(function (e) {
  var fb = fps(loadPng(path.join(root, e.file)), e.origin);
  console.log("similarity matrix vs " + e.file + " (rows = ref slots):");
  fa.forEach(function (f) { console.log("   " + fb.map(function (g) { return Rg.similarity(f, g).toFixed(2); }).join("  ")); });
});

if (process.argv.indexOf("--write") >= 0 && originsOk) {
  if (!glyphs.P) throw new Error("need a Perfect screenshot for the P glyph");
  var out = "/* GENERATED by tools/make-anchor.js from the screenshots in test/ - do not hand-edit.\n" +
    "   Coordinates are relative to the top-left corner of the module strip. */\n" +
    "(function (root, factory) {\n  if (typeof module === \"object\" && module.exports) module.exports = factory();\n  else root.ProtoAnchor = factory();\n})(this, function () {\n  return " +
    JSON.stringify(Object.assign({
      ANCHORS: ANCHOR_BOXES.map(function (b, i) { return { dx: b.dx, dy: b.dy, png: "data:image/png;base64," + PNG.sync.write(anchorPngs[i]).toString("base64") }; })
    }, GEO, {
      WORD_DX: WORD_DX, PREFIX_PROBE: probe,
      POOR_MAX_W: 50, EXCELLENT_MIN_W: 66, SATISFACTORY_MIN_W: 90,
      PREFIX: PREFIX, WORDS: words, GLYPHS: glyphs
    }), null, 1).replace(/\n/g, "\n  ") + ";\n});\n";
  fs.writeFileSync(path.join(root, "src/anchor.js"), out);
  console.log("wrote src/anchor.js (" + out.length + " bytes)");
}
