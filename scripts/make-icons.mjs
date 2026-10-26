// Genera le icone PNG (schermata Home / manifest) in public/icons/.
// Simbolo: segno di quota (linea con frecce e due linee di estensione), bianco su #A43700.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const BG = [0xa4, 0x37, 0x00];
const FG = [0xff, 0xff, 0xff];

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const tri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / d;
  const v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
};
const t = 0.028; // semi-spessore
const shapes = [
  rect(0.2 - t, 0.28, 0.2 + t, 0.72), // linea di estensione sinistra
  rect(0.8 - t, 0.28, 0.8 + t, 0.72), // linea di estensione destra
  rect(0.2, 0.5 - t, 0.8, 0.5 + t), // linea di quota
  tri(0.2, 0.5, 0.36, 0.41, 0.36, 0.59), // freccia sinistra
  tri(0.8, 0.5, 0.64, 0.41, 0.64, 0.59), // freccia destra
];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t4 = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t4, data])));
  return Buffer.concat([len, t4, data, crc]);
};

function render(size) {
  const SS = 4; // supersampling 4x4
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const px = (x + (i + 0.5) / SS) / size;
          const py = (y + (j + 0.5) / SS) / size;
          if (shapes.some((s) => s(px, py))) hit++;
        }
      const a = hit / (SS * SS);
      for (let c = 0; c < 3; c++) raw[y * (size * 3 + 1) + 1 + x * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) writeFileSync(join(out, `icon-${size}.png`), render(size));
console.log('Icone scritte in', out);
