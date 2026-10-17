/**
 * Decodes the office preview PNG and prints a coarse color-mapped map so the
 * scene structure can be verified from a terminal.
 * Usage: node tools/inspect-preview.mjs [path]
 */
import zlib from "node:zlib";
import fs from "node:fs";

const file = process.argv[2] ?? "preview-out/office-preview.png";
const buf = fs.readFileSync(file);

// --- minimal PNG decode ---
let pos = 8;
let width = 0,
  height = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
  } else if (type === "IDAT") idat.push(data);
  else if (type === "IEND") break;
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const px = Buffer.alloc(width * height * 4);
const stride = width * 4;
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const out = px.subarray(y * stride, (y + 1) * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? out[x - 4] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
    let v = row[x];
    if (filter === 1) v = (v + a) & 255;
    else if (filter === 2) v = (v + b) & 255;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    out[x] = v;
  }
}

const at = (x, y) => {
  const i = (y * width + x) * 4;
  return [px[i], px[i + 1], px[i + 2]];
};

// classify pixel → char by nearest reference color
const REFS = [
  ["#", [233, 226, 207]], // wall
  ["=", [198, 187, 163]], // wall shade
  [".", [147, 165, 182]], // carpet
  [",", [217, 212, 199]], // tile
  ["D", [160, 106, 63]], // wood
  ["d", [124, 79, 44]], // wood dark
  ["S", [159, 216, 232]], // screen on
  ["s", [46, 52, 56]], // screen off
  ["N", [30, 42, 58]], // navy
  ["B", [255, 255, 255]], // white / bubble
  ["K", [240, 200, 160]], // skin
  ["G", [63, 125, 68]], // green
  ["R", [224, 85, 85]], // red
  ["A", [216, 195, 74]], // amber
  ["W", [79, 155, 214]], // water blue
  ["M", [185, 194, 201]], // metal/plastic
  ["m", [127, 138, 146]], // metal dark
  ["F", [138, 107, 82]], // sofa
];

function classify(r, g, b) {
  let best = "?",
    bd = Infinity;
  for (const [ch, [rr, gg, bb]] of REFS) {
    const d = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (d < bd) {
      bd = d;
      best = ch;
    }
  }
  return best;
}

const ZOOM = Number(process.env.ZOOM ?? 1);
const COLS = 36 * ZOOM,
  ROWS = 22 * ZOOM;
const sx = width / COLS,
  sy = height / ROWS;

// Region mode: file tx ty tw th → 1px-per-char dump of that tile region
if (process.argv.length >= 6) {
  const tx = Number(process.argv[3]) * 16;
  const ty = Number(process.argv[4]) * 16;
  const tw = Number(process.argv[5]) * 16;
  const th = Number(process.argv[6]) * 16;
  for (let y = ty; y < Math.min(ty + th, height); y++) {
    let line = "";
    for (let x = tx; x < Math.min(tx + tw, width); x++) {
      const [r, g, b] = at(x, y);
      line += classify(r, g, b);
    }
    console.log(line);
  }
  process.exit(0);
}
const counts = {};
let grid = "";
for (let ry = 0; ry < ROWS; ry++) {
  let line = "";
  for (let rx = 0; rx < COLS; rx++) {
    const x = Math.min(width - 1, Math.floor((rx + 0.5) * sx));
    const y = Math.min(height - 1, Math.floor((ry + 0.5) * sy));
    const [r, g, b] = at(x, y);
    const ch = classify(r, g, b);
    counts[ch] = (counts[ch] ?? 0) + 1;
    line += ch;
  }
  grid += line + "\n";
}
console.log(`PNG ${width}x${height}\n`);
console.log(grid);
console.log("color usage:", Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "));
