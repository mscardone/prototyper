/* Loads the browser-side sources into node so they can be tested headlessly. */
var path = require("path");
var root = path.join(__dirname, "..");
global.window = global;
var A1lib = require(path.join(root, "vendor/a1lib.js"));
var Anchor = require(path.join(root, "src/anchor.js"));
var Reader = require(path.join(root, "src/reader.js"))(A1lib, Anchor);
var Solver = require(path.join(root, "src/solver.js"));
module.exports = {
  Tracker: require(path.join(root, "src/tracker.js"))(Solver, Reader),
  root: root, A1lib: A1lib, Anchor: Anchor, Reader: Reader,
  Solver: Solver,
  loadPng: require("./pngload.js")
};
