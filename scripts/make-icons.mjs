// Draws the app icons (a white heart on a pink-lavender gradient) straight into PNGs,
// no image libraries needed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inHeart = (x, y) => (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
// Fraction of a pixel covered by the heart, with 4x4 supersampling.
function coverage(px, py, size, scale) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const u = (px + (i + 0.5) / 4) / size - 0.5;
    const v = (py + (j + 0.5) / 4) / size - 0.5;
    if (inHeart(u * scale, -v * scale + 0.12)) hit++;
  }
  return hit / 16;
}
const mix = (a, b, t) => Math.round(a + (b - a) * t);

function icon(size, scale) {
  const c1 = [255, 143, 184], c2 = [176, 150, 255];
  return png(size, (x, y) => {
    const t = (x + y) / (2 * size);
    const bg = [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
    const h = coverage(x, y, size, scale);
    return [mix(bg[0], 255, h), mix(bg[1], 255, h), mix(bg[2], 255, h), 255];
  });
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 3.4));
writeFileSync('public/icons/icon-512.png', icon(512, 3.4));
writeFileSync('public/icons/maskable-512.png', icon(512, 4.4));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 3.4));
// Monochrome badge for the Android status bar: white heart on transparent.
writeFileSync('public/icons/badge-96.png', png(96, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, 96, 2.9))]));
console.log('icons written to public/icons/');
