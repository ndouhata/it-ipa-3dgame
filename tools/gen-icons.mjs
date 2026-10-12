// PWAアイコン(PNG)を外部依存なしで生成する。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
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
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// 背景: 紺のグラデーション / 中央: 3つに分かれる金色の光（負荷分散のモチーフ）
const pixel = (u, v) => {
  const bg = [14 + 20 * v, 20 + 30 * v, 36 + 50 * v];
  const nodes = [[0.5, 0.3], [0.28, 0.7], [0.72, 0.7]];
  const near = (x, y, r) => (u - x) ** 2 + (v - y) ** 2 < r * r;
  const onLine = (x1, y1, x2, y2, w) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
    return (u - x1 - t * dx) ** 2 + (v - y1 - t * dy) ** 2 < w * w;
  };
  if (nodes.some(([x, y]) => near(x, y, 0.1))) return [245, 200, 90];
  if (onLine(0.5, 0.3, 0.28, 0.7, 0.025) || onLine(0.5, 0.3, 0.72, 0.7, 0.025) || onLine(0.5, 0.3, 0.5, 0.75, 0.025)) return [200, 160, 70];
  return bg.map(Math.round);
};
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, pixel));
console.log('icons generated');
