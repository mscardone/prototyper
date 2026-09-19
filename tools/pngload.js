/* Load a PNG into the {width,height,data} shape the alt1 libraries expect. */
var fs = require("fs"), PNG = require("pngjs").PNG;
module.exports = function loadPng(path) {
  var p = PNG.sync.read(fs.readFileSync(path));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
};
module.exports.fromDataUrl = function (url) {
  var p = PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
};
