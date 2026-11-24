/* Generates the extension icons (half light / half dark circle) without any dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LIGHT = [250, 248, 240];
const DARK = [24, 26, 34];
const RING = [79, 124, 255];
const SS = 4; // supersampling

function pixel(x, y, size) {
  const acc = [0, 0, 0, 0];
  const c = size / 2;
  const outer = size / 2 - 0.5;
  const ring = Math.max(1.2, size / 14);
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS;
      const py = y + (sy + 0.5) / SS;
      const d = Math.hypot(px - c, py - c);
      if (d > outer) continue;
      const col = d > outer - ring ? RING : px < c ? LIGHT : DARK;
      acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255;
    }
  }
  const n = acc[3] / 255;
  return n ? [acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / (SS * SS)].map(Math.round) : [0, 0, 0, 0];
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(out, `icon${size}.png`), png(size, pixel));
console.log('icons written to', out);
