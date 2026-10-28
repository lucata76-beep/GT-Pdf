// Genera i PDF di prova FITTIZI in public/test-pdfs/. Nessun disegno reale.
// Ogni foglio riporta un segmento di riferimento di 100 mm esatti (283,46 pt) per provare la calibrazione.
// Risultato riproducibile: date e produttore fissi.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFString, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'test-pdfs');
mkdirSync(out, { recursive: true });

const A4 = [595.276, 841.89];
const A3L = [1190.551, 841.89];
const MM = 72 / 25.4;

async function newDoc() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('GT-Pdf test fixtures');
  doc.setCreator('GT-Pdf scripts/make-test-pdfs.mjs');
  doc.setTitle('PDF di prova fittizio');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc;
}

// Disegno fittizio (flangia generica) dentro il rettangolo visibile `box`.
function drawSheet(page, font, bold, box, label) {
  const black = rgb(0.1, 0.1, 0.1);
  const thin = { thickness: 0.6, color: black };
  const { x, y, w, h } = box;
  page.drawRectangle({ x: x + 10, y: y + 10, width: w - 20, height: h - 20, borderColor: black, borderWidth: 1.2 });

  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: black, borderWidth: 1.4 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.42, borderColor: black, borderWidth: 1.4 });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    page.drawCircle({ x: cx + dx * r * 0.72, y: cy + dy * r * 0.72, size: r * 0.09, borderColor: black, borderWidth: 1 });
  }
  const dash = { ...thin, dashArray: [10, 3, 2, 3], dashPhase: 0 };
  page.drawLine({ start: { x: cx - r * 1.15, y: cy }, end: { x: cx + r * 1.15, y: cy }, ...dash });
  page.drawLine({ start: { x: cx, y: cy - r * 1.15 }, end: { x: cx, y: cy + r * 1.15 }, ...dash });

  // Quota fittizia (non e' una quota dell'app).
  const qy = cy - r - 18;
  page.drawLine({ start: { x: cx - r, y: qy }, end: { x: cx + r, y: qy }, ...thin });
  page.drawLine({ start: { x: cx - r, y: qy - 4 }, end: { x: cx - r, y: qy + 4 }, ...thin });
  page.drawLine({ start: { x: cx + r, y: qy - 4 }, end: { x: cx + r, y: qy + 4 }, ...thin });
  page.drawText('Ø 120 ±0.1', { x: cx - 26, y: qy + 5, size: 10, font });

  // Riferimento di 100 mm esatti, per la calibrazione della scala.
  const ry = y + 62;
  const rx = x + 28;
  page.drawLine({ start: { x: rx, y: ry }, end: { x: rx + 100 * MM, y: ry }, thickness: 1.2, color: black });
  page.drawLine({ start: { x: rx, y: ry - 6 }, end: { x: rx, y: ry + 6 }, thickness: 1.2, color: black });
  page.drawLine({ start: { x: rx + 100 * MM, y: ry - 6 }, end: { x: rx + 100 * MM, y: ry + 6 }, thickness: 1.2, color: black });
  page.drawText('RIFERIMENTO 100 mm', { x: rx, y: ry + 10, size: 8, font });

  page.drawText('DISEGNO FITTIZIO - GT-Pdf', { x: x + 28, y: y + h - 34, size: 12, font: bold, color: black });
  page.drawText(label, { x: x + 28, y: y + h - 50, size: 9, font, color: black });
}

async function fonts(doc) {
  return [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];
}

async function single(name, size, label, setup) {
  const doc = await newDoc();
  const [font, bold] = await fonts(doc);
  const page = doc.addPage(size);
  const box = setup ? setup(page) : { x: 0, y: 0, w: size[0], h: size[1] };
  drawSheet(page, font, bold, box, label);
  writeFileSync(join(out, name), await doc.save({ useObjectStreams: false }));
}

// --- Scansione sintetica: pagina fatta di sola immagine in scala di grigi (150 dpi) ---
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function pngGray(w, h, pix) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    Buffer.from(pix.buffer, y * w, w).copy(raw, y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profondita'
  ihdr[9] = 0; // scala di grigi
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function scanImage(w, h) {
  const pix = new Uint8Array(w * h);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / w, dy = (y - h / 2) / h;
      pix[y * w + x] = 246 - Math.round(14 * (dx * dx + dy * dy) * 4); // leggera ombreggiatura ai bordi
    }
  }
  const dot = (x, y, r, v) => {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const px = Math.round(x + i), py = Math.round(y + j);
        if (px >= 0 && px < w && py >= 0 && py < h && i * i + j * j <= r * r) pix[py * w + px] = Math.min(pix[py * w + px], v);
      }
  };
  const line = (x0, y0, x1, y1, r, v) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 0; k <= n; k++) dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r, v);
  };
  const circle = (cx, cy, rad, r, v) => {
    const n = Math.ceil(2 * Math.PI * rad);
    for (let k = 0; k < n; k++) dot(cx + rad * Math.cos((2 * Math.PI * k) / n), cy + rad * Math.sin((2 * Math.PI * k) / n), r, v);
  };
  line(60, 60, w - 60, 60, 2, 40); line(w - 60, 60, w - 60, h - 60, 2, 40);
  line(w - 60, h - 60, 60, h - 60, 2, 40); line(60, h - 60, 60, 60, 2, 40);
  circle(w / 2, h * 0.45, 330, 2, 35);
  circle(w / 2, h * 0.45, 140, 2, 35);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) circle(w / 2 + dx * 240, h * 0.45 + dy * 240, 22, 2, 35);
  line(w / 2 - 380, h * 0.45, w / 2 + 380, h * 0.45, 1, 90);
  line(w / 2, h * 0.45 - 380, w / 2, h * 0.45 + 380, 1, 90);
  // 100 mm a 150 dpi = 590,55 px
  line(120, h - 200, 120 + 590.55, h - 200, 3, 30);
  line(120, h - 214, 120, h - 186, 3, 30);
  line(120 + 590.55, h - 214, 120 + 590.55, h - 186, 3, 30);
  for (let k = 0; k < w * h * 0.002; k++) dot(rnd() * w, rnd() * h, 1, 120 + Math.floor(rnd() * 80)); // macchioline
  return pix;
}

async function scan() {
  const w = 1240, h = 1754; // A4 a 150 dpi
  const png = pngGray(w, h, scanImage(w, h));
  const doc = await newDoc();
  const page = doc.addPage([(w * 72) / 150, (h * 72) / 150]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  writeFileSync(join(out, 'a4-scansione.pdf'), await doc.save({ useObjectStreams: false }));
}

await single('a4-vettoriale.pdf', A4, 'A4 verticale, vettoriale, font standard non incorporati');
await single('a3-vettoriale.pdf', A3L, 'A3 orizzontale, vettoriale');
await single('a4-rotate90.pdf', A4, 'A4 con /Rotate 90', (page) => {
  page.setRotation(degrees(90));
  return { x: 0, y: 0, w: A4[0], h: A4[1] };
});
await single('a4-cropbox.pdf', A4, 'A4 con CropBox [50 50 450 600]', (page) => {
  page.setCropBox(50, 50, 400, 550);
  return { x: 50, y: 50, w: 400, h: 550 };
});
await scan();

// Documento di 3 pagine per provare la navigazione tra pagine.
{
  const doc = await newDoc();
  const [font, bold] = await fonts(doc);
  const p1 = doc.addPage(A4);
  drawSheet(p1, font, bold, { x: 0, y: 0, w: A4[0], h: A4[1] }, 'Pagina 1 di 3 - A4 verticale');
  const p2 = doc.addPage(A3L);
  drawSheet(p2, font, bold, { x: 0, y: 0, w: A3L[0], h: A3L[1] }, 'Pagina 2 di 3 - A3 orizzontale');
  const p3 = doc.addPage(A4);
  p3.setRotation(degrees(90));
  drawSheet(p3, font, bold, { x: 0, y: 0, w: A4[0], h: A4[1] }, 'Pagina 3 di 3 - A4 con /Rotate 90');
  writeFileSync(join(out, 'misto-3-pagine.pdf'), await doc.save({ useObjectStreams: false }));
}

// Pagina con annotazioni FITTIZIE per provare "Appiattito" (5b): un timbro con aspetto proprio, un campo di testo compilato, una casella spuntata e un
// collegamento sul titolo (https://example.com/, dominio riservato). Nell'esportazione appiattita timbro, campo e casella diventano parte dell'immagine e il collegamento sparisce.
{
  const doc = await newDoc();
  const [font, bold] = await fonts(doc);
  const page = doc.addPage(A4);
  drawSheet(page, font, bold, { x: 0, y: 0, w: A4[0], h: A4[1] }, 'A4 con annotazioni fittizie: timbro, campo, casella, collegamento');
  const ctx = doc.context;
  const stampAp = ctx.register(
    ctx.stream('1 0 0 RG 2 w 1 1 168 38 re S 1 0 0 rg BT /Helv 14 Tf 10 14 Td (TIMBRO FITTIZIO) Tj ET', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 170, 40],
      Resources: { Font: { Helv: font.ref } },
    }),
  );
  page.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [380, 760, 550, 800], AP: { N: stampAp }, F: 4, Contents: PDFString.of('Timbro fittizio') })));
  page.node.addAnnot(
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [28, 795, 220, 810], Border: [0, 0, 0], F: 4, A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') } })),
  );
  const form = doc.getForm();
  const field = form.createTextField('campo-prova');
  field.setText('Campo compilato (fittizio)');
  field.addToPage(page, { x: 28, y: 700, width: 220, height: 24, font });
  const box = form.createCheckBox('casella-prova');
  box.check();
  box.addToPage(page, { x: 270, y: 700, width: 24, height: 24 });
  writeFileSync(join(out, 'a4-annotazioni.pdf'), await doc.save({ useObjectStreams: false }));
}

const index = [
  { file: 'a4-vettoriale.pdf', titolo: 'A4 vettoriale', note: 'font standard non incorporati (prova gli asset di PDF.js)' },
  { file: 'a3-vettoriale.pdf', titolo: 'A3 vettoriale', note: 'pagina grande: 17.403.188 px a 300 dpi' },
  { file: 'a4-rotate90.pdf', titolo: 'A4 con /Rotate 90', note: 'vista ruotata' },
  { file: 'a4-cropbox.pdf', titolo: 'A4 con CropBox', note: 'area visibile 400 x 550 pt' },
  { file: 'a4-scansione.pdf', titolo: 'A4 scansione (immagine)', note: 'sola immagine in grigi, 150 dpi' },
  { file: 'misto-3-pagine.pdf', titolo: '3 pagine miste', note: 'A4, A3, A4 ruotata' },
  { file: 'a4-annotazioni.pdf', titolo: 'A4 con annotazioni', note: 'timbro, campo di testo, casella e collegamento fittizi (per Appiattito)' },
];
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log('PDF di prova scritti in', out);
