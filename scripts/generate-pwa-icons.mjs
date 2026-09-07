import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../frontend/public');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function insideRoundRect(x, y, left, top, right, bottom, radius) {
  if (x >= left + radius && x < right - radius && y >= top && y < bottom) return true;
  if (y >= top + radius && y < bottom - radius && x >= left && x < right) return true;
  const corners = [
    [left + radius, top + radius],
    [right - radius - 1, top + radius],
    [left + radius, bottom - radius - 1],
    [right - radius - 1, bottom - radius - 1],
  ];
  return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
}

function paint(x, y, size) {
  const s = size / 32;
  const bg = [0x21, 0x42, 0x83];
  const paper = [0xf4, 0xf4, 0xf5];
  const accent = [0x28, 0x7b, 0xde];
  if (insideRoundRect(x, y, 0, 0, size, size, Math.round(7 * s))) {
    const calLeft = Math.round(5 * s);
    const calTop = Math.round(9 * s);
    const calRight = Math.round(27 * s);
    const calBottom = Math.round(27 * s);
    if (insideRoundRect(x, y, calLeft, calTop, calRight, calBottom, Math.round(2 * s))) {
      if (y < Math.round(14 * s)) return accent;
      const dots = [
        [11, 19],
        [16, 19],
        [21, 19],
        [11, 24],
        [16, 24],
      ];
      for (const [dx, dy] of dots) {
        const cx = Math.round(dx * s);
        const cy = Math.round(dy * s);
        if ((x - cx) ** 2 + (y - cy) ** 2 <= (1.6 * s) ** 2) return bg;
      }
      return paper;
    }
    const rings = [
      [10.5, 8],
      [21.5, 8],
    ];
    for (const [dx, dy] of rings) {
      const cx = Math.round(dx * s);
      const cy = Math.round(dy * s);
      if (x >= cx - Math.round(1.6 * s) && x <= cx + Math.round(1.6 * s) && y >= cy - Math.round(4 * s) && y <= cy + Math.round(2 * s)) {
        return paper;
      }
    }
    return bg;
  }
  return [0x2b, 0x2b, 0x2b];
}

function writePng(filePath, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y, size);
      const i = y * stride + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(filePath, png);
}

writePng(join(publicDir, 'icon-192.png'), 192);
writePng(join(publicDir, 'icon-512.png'), 512);
writePng(join(publicDir, 'apple-touch-icon.png'), 180);
console.log('Wrote PWA icons to frontend/public');
