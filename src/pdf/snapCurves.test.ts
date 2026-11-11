// Prove unitarie dell'Estremo delle curve (V3.2a, CP7c: `buildSnapPoints(g, sheet, { curves: true })` di src/pdf/snapPoints.ts), in Node, con la build LEGACY di PDF.js (quella dell'app).
// I valori attesi NON vengono dal codice provato: (1) per i PDF di prova di public/test-pdfs dalle formule di scripts/make-test-pdfs.mjs (drawSheet: sei cerchi, ognuno con quattro
// punti sugli assi) portate nel foglio con `viewport.convertToViewportPoint` di PDF.js (non con `PageGeometry`); (2) per i PDF sintetici da un calcolo scritto qui o dalla stessa
// conversione di PDF.js. Tolleranze dichiarate: 1e-3 pt (= MERGE_TOL_PT) contro le coordinate di disegno (il Float32 di PDF.js sposta di ~3e-5 pt su A3), 1e-9 pt contro il
// calcolo diretto sugli stessi Float32. Senza `curves` il risultato e' quello di CP7b (provato qui e da tutti i test di snapPoints.test.ts, che non sono stati toccati).
import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { DRAW_MOVE_TO, DRAW_QUAD_TO, type PdfGeometry, extractGeometry } from './geometry';
import { makePdf } from './geometryTestUtils';
import { PointGrid, scanNear } from './pointIndex';
import { BYTES_PER_POINT, MERGE_TOL_PT, type SnapPoints, buildSnapPoints, visibleCubicCount, visibleLineCount } from './snapPoints';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const A4: [number, number] = [595.276, 841.89];

async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}

// ------------------------------------------------------------------ lettura con PDF.js
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
interface Page {
  geometry: PdfGeometry;
  sheet: PageGeometry;
  /** Conversione utente -> foglio di PDF.js (indipendente da `PageGeometry`). */
  pdfjsToSheet: (x: number, y: number) => [number, number];
  vp: { width: number; height: number };
  /** Con le curve. */
  pts: SnapPoints;
  /** Senza le curve (come CP7b). */
  linesOnly: SnapPoints;
}
async function readPage(bytes: Uint8Array, pageNo = 1): Promise<Page> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  const doc = await task.promise;
  const page = await doc.getPage(pageNo);
  const ol = await page.getOperatorList();
  const cfg = await doc.getOptionalContentConfig();
  const res = extractGeometry({ fnArray: ol.fnArray, argsArray: ol.argsArray, ops: OPS, isLayerVisible: (d) => cfg.isVisible(d as never) });
  if (!res.ok) throw new Error(res.reason);
  const sheet = new PageGeometry({ view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit });
  const vp = page.getViewport({ scale: 1 });
  return {
    geometry: res.geometry,
    sheet,
    pdfjsToSheet: (x, y) => vp.convertToViewportPoint(x, y) as [number, number],
    vp,
    pts: buildSnapPoints(res.geometry, sheet, { curves: true }),
    linesOnly: buildSnapPoints(res.geometry, sheet),
  };
}
const endsOf = (p: SnapPoints): [number, number][] => Array.from({ length: p.nEnd }, (_, i) => [p.xy[2 * i]!, p.xy[2 * i + 1]!]);
/** Stesso insieme di punti entro `tol` (ogni atteso ha esattamente un punto vicino e viceversa). */
function expectSamePoints(got: [number, number][], want: [number, number][], tol: number, what: string): void {
  expect(got.length, `${what}: numero di punti`).toBe(want.length);
  const used = new Set<number>();
  for (const w of want) {
    const i = got.findIndex((g, k) => !used.has(k) && Math.abs(g[0] - w[0]) <= tol && Math.abs(g[1] - w[1]) <= tol);
    expect(i, `${what}: nessun punto vicino a (${w[0].toFixed(4)}, ${w[1].toFixed(4)})`).toBeGreaterThanOrEqual(0);
    used.add(i);
  }
}

/** PDF di una pagina con un contenuto scritto a mano, /Rotate, CropBox e UserUnit a scelta (pdf-lib). */
async function curvePdf(content: string, o: { size?: [number, number]; rotate?: number; crop?: [number, number, number, number]; userUnit?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(o.size ?? [400, 300]);
  if (o.rotate) page.setRotation(degrees(o.rotate));
  if (o.crop) page.setCropBox(...o.crop);
  if (o.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(o.userUnit));
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(content)));
  return doc.save({ useObjectStreams: false });
}

// ------------------------------------------------------------------ calcolo indipendente dalle formule di scripts/make-test-pdfs.mjs
/** I 24 punti dei sei cerchi di drawSheet (spazio utente): grande, interno (0.42), quattro piccoli (0.09) a 0.72 r dal centro; ogni cerchio ha un punto per quadrante. */
function sheetCirclePoints(x: number, y: number, w: number, h: number): [number, number][] {
  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const circles: [number, number, number][] = [
    [cx, cy, r],
    [cx, cy, r * 0.42],
    ...([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [cx + dx * r * 0.72, cy + dy * r * 0.72, r * 0.09] as [number, number, number]),
  ];
  const out: [number, number][] = [];
  for (const [ccx, ccy, rr] of circles) out.push([ccx - rr, ccy], [ccx, ccy - rr], [ccx + rr, ccy], [ccx, ccy + rr]);
  return out;
}

describe('i PDF di prova con cerchi: i quattro punti di ogni cerchio contro le formule di scripts/make-test-pdfs.mjs', () => {
  const SINGLE: [string, number, number, number, number][] = [
    ['a4-vettoriale.pdf', 0, 0, A4[0], A4[1]],
    ['a3-vettoriale.pdf', 0, 0, 1190.551, 841.89],
    ['a4-rotate90.pdf', 0, 0, A4[0], A4[1]],
    ['a4-cropbox.pdf', 50, 50, 400, 550],
    ['a4-annotazioni.pdf', 0, 0, A4[0], A4[1]],
  ];
  for (const [file, x, y, w, h] of SINGLE) {
    it(`${file}: 24 cubiche, 24 Estremi in piu' (4 per cerchio, non 8) nelle posizioni del disegno (1e-3 pt); i punti dei tratti e i Punti medi sono quelli di CP7b`, async () => {
      const p = await readPage(await loadTestPdf(file));
      const circles = sheetCirclePoints(x, y, w, h).map(([ux, uy]) => p.pdfjsToSheet(ux, uy));
      expect(circles).toHaveLength(24);
      expect(p.geometry.nCubics).toBeGreaterThanOrEqual(24);
      const base = endsOf(p.linesOnly);
      const ends = endsOf(p.pts);
      // i punti dei soli tratti: gli stessi, nello stesso ordine, di prima
      expect(ends.length).toBe(base.length + p.pts.curves!.endsFromCurves);
      for (let i = 0; i < base.length; i++) {
        expect(ends[i]![0]).toBe(base[i]![0]);
        expect(ends[i]![1]).toBe(base[i]![1]);
      }
      expect(Array.from(p.pts.xy.subarray(2 * p.pts.nEnd))).toEqual(Array.from(p.linesOnly.xy.subarray(2 * p.linesOnly.nEnd))); // i Punti medi: gli stessi
      expect(p.pts.nMid).toBe(p.linesOnly.nMid);
      // i punti in piu' sono quelli dei cerchi (e, nell'annotazione, quelli delle sue eventuali curve: nessuna oltre ai 24 sui PDF senza altre curve)
      const extra = ends.slice(base.length);
      if (file !== 'a4-annotazioni.pdf') {
        expect(p.geometry.nCubics).toBe(24);
        expect(extra).toHaveLength(24);
      }
      for (const c of circles) expect(ends.some((e) => Math.hypot(e[0] - c[0], e[1] - c[1]) <= 1e-3), `Estremo del cerchio vicino a (${c[0].toFixed(3)}, ${c[1].toFixed(3)})`).toBe(true);
      expect(p.pts.curves).toMatchObject({ cubics: p.geometry.nCubics, hiddenCubics: 0, tinyCubics: 0, outsidePoints: 0 });
      if (file !== 'a4-annotazioni.pdf') {
        // 24 cubiche = 48 estremi di cubica: 24 restano, 24 sono giunti uniti (ogni cerchio: 8 estremi -> 4 punti)
        expect(p.pts.curves).toMatchObject({ endsFromCurves: 24, mergedEnd: 24 });
        expect(p.pts.nEnd).toBe(44);
        expect(p.pts.bytes).toBe((44 + 11) * BYTES_PER_POINT);
      }
    });
    it(`${file}: lo stesso risultato del calcolo diretto sugli stessi Float32 (1e-9 pt) e ogni punto sta dentro il foglio`, async () => {
      const p = await readPage(await loadTestPdf(file));
      const g = p.geometry;
      const want: [number, number][] = [];
      const push = (q: [number, number]): void => {
        if (!want.some((e) => Math.abs(e[0] - q[0]) <= MERGE_TOL_PT && Math.abs(e[1] - q[1]) <= MERGE_TOL_PT)) want.push(q);
      };
      for (let i = 0; i < g.nLines; i++) {
        if (g.pathVisible[g.linePath[i]!] !== 1) continue;
        push(p.pdfjsToSheet(g.lineXY[4 * i]!, g.lineXY[4 * i + 1]!));
        push(p.pdfjsToSheet(g.lineXY[4 * i + 2]!, g.lineXY[4 * i + 3]!));
      }
      for (let i = 0; i < g.nCubics; i++) {
        if (g.pathVisible[g.cubicPath[i]!] !== 1) continue;
        push(p.pdfjsToSheet(g.cubicXY[8 * i]!, g.cubicXY[8 * i + 1]!));
        push(p.pdfjsToSheet(g.cubicXY[8 * i + 6]!, g.cubicXY[8 * i + 7]!));
      }
      expectSamePoints(endsOf(p.pts), want, 1e-9, 'Estremi');
      for (let i = 0; i < p.pts.nEnd + p.pts.nMid; i++) {
        expect(p.pts.xy[2 * i]!).toBeGreaterThanOrEqual(0);
        expect(p.pts.xy[2 * i]!).toBeLessThanOrEqual(p.vp.width);
        expect(p.pts.xy[2 * i + 1]!).toBeGreaterThanOrEqual(0);
        expect(p.pts.xy[2 * i + 1]!).toBeLessThanOrEqual(p.vp.height);
      }
    });
  }

  it('misto-3-pagine.pdf: ogni pagina ha i suoi 24 punti dei cerchi (A4, A3 orizzontale, A4 con /Rotate 90)', async () => {
    const bytes = await loadTestPdf('misto-3-pagine.pdf');
    const boxes: [number, number][] = [A4, [1190.551, 841.89], A4];
    for (let n = 1; n <= 3; n++) {
      const p = await readPage(bytes, n);
      const [w, h] = boxes[n - 1]!;
      const ends = endsOf(p.pts);
      const circles = sheetCirclePoints(0, 0, w, h).map(([ux, uy]) => p.pdfjsToSheet(ux, uy));
      for (const c of circles) expect(ends.some((e) => Math.hypot(e[0] - c[0], e[1] - c[1]) <= 1e-3), `pagina ${n}: Estremo del cerchio vicino a (${c[0].toFixed(3)}, ${c[1].toFixed(3)})`).toBe(true);
      expect(p.pts.nEnd).toBe(44);
      expect(p.pts.nMid).toBe(11);
    }
  });

  it('a4-scansione.pdf: nessuna cubica, nessun punto (la scansione e\' un\'immagine)', async () => {
    const p = await readPage(await loadTestPdf('a4-scansione.pdf'));
    expect(p.geometry.nCubics).toBe(0);
    expect(p.pts.nEnd).toBe(0);
    expect(p.pts.curves).toEqual({ cubics: 0, hiddenCubics: 0, tinyCubics: 0, outsidePoints: 0, mergedEnd: 0, endsFromCurves: 0 });
  });
});

describe('una cubica singola: gli estremi nel foglio (Rotate, CropBox, UserUnit)', () => {
  // cubica da (50, 60) a (250, 90) con due punti di controllo: i punti di controllo NON sono punti di snap
  const CUBIC = '50 60 m 80 160 180 180 250 90 c S';
  const EXPECT_CTRL = 'i punti di controllo non danno punti';

  it('Rotate 0, pagina 400 x 300: (50, 240) e (250, 210) a mano, e come PDF.js; nessun Punto medio', async () => {
    const p = await readPage(await curvePdf(CUBIC));
    expect(p.geometry.nCubics).toBe(1);
    expect(p.geometry.nLines).toBe(0);
    expectSamePoints(endsOf(p.pts), [[50, 240], [250, 210]], 1e-9, 'Estremi');
    expectSamePoints(endsOf(p.pts), [p.pdfjsToSheet(50, 60), p.pdfjsToSheet(250, 90)], 1e-9, 'Estremi (PDF.js)');
    expect(p.pts.nMid, 'il Punto medio delle curve non c\'e\' (ambiguo)').toBe(0);
    expect(p.pts.nEnd, EXPECT_CTRL).toBe(2);
    expect(p.pts.curves).toEqual({ cubics: 1, hiddenCubics: 0, tinyCubics: 0, outsidePoints: 0, mergedEnd: 0, endsFromCurves: 2 });
    expect(p.linesOnly.nEnd, 'senza `curves` nessun punto: come CP7b').toBe(0);
    expect(p.linesOnly.curves).toBeUndefined();
  });

  it('Rotate 90: il foglio e\' 300 x 400 e gli estremi coincidono con la conversione di PDF.js (non con PageGeometry)', async () => {
    const p = await readPage(await curvePdf(CUBIC, { rotate: 90 }));
    expect(p.pts.width).toBeCloseTo(300, 9);
    expect(p.pts.height).toBeCloseTo(400, 9);
    expectSamePoints(endsOf(p.pts), [p.pdfjsToSheet(50, 60), p.pdfjsToSheet(250, 90)], 1e-9, 'Estremi');
    // a mano: con /Rotate 90 l'asse x utente va verso il basso del foglio e l'asse y verso destra: (x, y) -> (y, x)
    expectSamePoints(endsOf(p.pts), [[60, 50], [90, 250]], 1e-9, 'Estremi (a mano)');
  });

  it('CropBox [50 50 450 600]: l\'origine del foglio e\' l\'angolo del CropBox', async () => {
    const p = await readPage(await curvePdf('100 100 m 150 300 300 300 400 200 c S', { size: [600, 800], crop: [50, 50, 400, 550] }));
    expect(p.pts.width).toBeCloseTo(400, 9);
    expect(p.pts.height).toBeCloseTo(550, 9);
    // (100, 100) -> (100 - 50, 600 - 100) = (50, 500); (400, 200) -> (350, 400)
    expectSamePoints(endsOf(p.pts), [[50, 500], [350, 400]], 1e-9, 'Estremi');
    expectSamePoints(endsOf(p.pts), [p.pdfjsToSheet(100, 100), p.pdfjsToSheet(400, 200)], 1e-9, 'Estremi (PDF.js)');
  });

  it('CropBox con /Rotate 90', async () => {
    const p = await readPage(await curvePdf('100 100 m 150 300 300 300 400 200 c S', { size: [600, 800], crop: [50, 50, 400, 550], rotate: 90 }));
    expect(p.pts.width).toBeCloseTo(550, 9);
    expect(p.pts.height).toBeCloseTo(400, 9);
    expectSamePoints(endsOf(p.pts), [p.pdfjsToSheet(100, 100), p.pdfjsToSheet(400, 200)], 1e-9, 'Estremi (PDF.js)');
  });

  it('UserUnit 2.5: i punti sono in pt FISICI del foglio (gli unitari utente per 2.5) e coincidono con PDF.js', async () => {
    const p = await readPage(await curvePdf(CUBIC, { userUnit: 2.5 }));
    expect(p.sheet.userUnit).toBe(2.5);
    expect(p.pts.width).toBeCloseTo(1000, 9);
    expect(p.pts.height).toBeCloseTo(750, 9);
    // (50, 60) -> (125, 750 - 150) = (125, 600); (250, 90) -> (625, 750 - 225) = (625, 525)
    expectSamePoints(endsOf(p.pts), [[125, 600], [625, 525]], 1e-9, 'Estremi');
    expectSamePoints(endsOf(p.pts), [p.pdfjsToSheet(50, 60), p.pdfjsToSheet(250, 90)], 1e-9, 'Estremi (PDF.js)');
  });

  it('UserUnit 2.5: la soglia della corda e\' in pt FISICI (0.005 unita\' utente = 0.0125 pt: cubica vera, 2 Estremi; 0.003 unita\' = 0.0075 pt: quasi un punto, 1 Estremo)', async () => {
    const p = await readPage(
      await curvePdf('100 100 m 100.001 100.002 100.004 100.002 100.005 100 c S\n200 100 m 200.001 100.002 200.002 100.002 200.003 100 c S', { userUnit: 2.5 }),
    );
    expect(p.geometry.nCubics).toBe(2);
    expect(p.pts.curves).toMatchObject({ tinyCubics: 1, endsFromCurves: 3 });
    expect(p.pts.nEnd).toBe(3);
  });
});

describe('unione dei coincidenti fra curve e tratti, e fra cubiche consecutive', () => {
  it('un cerchio da 4 cubiche (pdf-lib drawCircle) da\' 4 Estremi, non 8: i giunti si uniscono', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([400, 300]);
    page.drawCircle({ x: 200, y: 150, size: 80, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    const p = await readPage(await doc.save({ useObjectStreams: false }));
    expect(p.geometry.nCubics).toBe(4);
    expect(p.pts.nEnd).toBe(4);
    expect(p.pts.nMid).toBe(0);
    // i quattro punti sugli assi: (120, 150), (200, 70), (280, 150), (200, 230) nello spazio utente -> nel foglio y' = 300 - y
    expectSamePoints(endsOf(p.pts), [[120, 150], [200, 230], [280, 150], [200, 70]], 1e-3, 'Estremi del cerchio');
    expect(p.pts.curves).toMatchObject({ cubics: 4, endsFromCurves: 4, mergedEnd: 4 });
  });

  it('arco aperto di una sola cubica: 2 Estremi; catena aperta di 3 cubiche: 4 Estremi (i 2 giunti uniti)', async () => {
    const a = await readPage(await curvePdf('100 100 m 100 150 150 200 200 200 c S'));
    expect(a.geometry.nCubics).toBe(1);
    expect(a.pts.nEnd).toBe(2);
    const b = await readPage(await curvePdf('100 100 m 100 150 150 200 200 200 c 250 200 300 150 300 100 c 300 50 250 0 200 0 c S'));
    expect(b.geometry.nCubics).toBe(3);
    expect(b.pts.nEnd).toBe(4);
    expect(b.pts.curves).toMatchObject({ endsFromCurves: 4, mergedEnd: 2 });
  });

  it('raccordo fra due rette (retta, cubica, retta): i punti di contatto sono UNO solo, non due', async () => {
    // retta (100,100)-(200,100); cubica (200,100)-(230,130); retta (230,130)-(230,200)
    const p = await readPage(await curvePdf('100 100 m 200 100 l 220 100 230 110 230 130 c 230 200 l S'));
    expect(p.geometry.nLines).toBe(2);
    expect(p.geometry.nCubics).toBe(1);
    expect(p.pts.nEnd).toBe(4); // (100,100) (200,100) (230,130) (230,200): i due estremi della cubica sono gia' Estremi delle rette
    expectSamePoints(endsOf(p.pts), [[100, 200], [200, 200], [230, 170], [230, 100]], 1e-3, 'Estremi');
    expect(p.pts.curves).toMatchObject({ cubics: 1, endsFromCurves: 0, mergedEnd: 2 });
    expect(p.pts.nMid).toBe(2); // i soli Punti medi delle due rette: nessuno per la cubica
    // senza curve: gli stessi 4 punti
    expect(p.linesOnly.nEnd).toBe(4);
  });

  it('la cubica e i tratti si toccano a meno di 1e-3 pt: un punto solo (resta quello del tratto); a piu\' di 1e-3 pt: due', async () => {
    const near = await readPage(await curvePdf('100 100 m 200 100 l S 200.0005 100 m 230 110 240 130 250 150 c S'));
    expect(near.geometry.nLines).toBe(1);
    expect(near.geometry.nCubics).toBe(1);
    expect(near.pts.nEnd).toBe(3);
    expect(near.pts.curves).toMatchObject({ mergedEnd: 1, endsFromCurves: 1 });
    const far = await readPage(await curvePdf('100 100 m 200 100 l S 200.002 100 m 230 110 240 130 250 150 c S'));
    expect(far.pts.nEnd).toBe(4);
    expect(far.pts.curves).toMatchObject({ mergedEnd: 0, endsFromCurves: 2 });
  });

  it('il punto che resta e\' quello del tratto: il tratto si legge prima della cubica anche se nel PDF viene dopo', async () => {
    const p = await readPage(await curvePdf('200.0005 100 m 230 110 240 130 250 150 c S 100 100 m 200 100 l S'));
    const e = endsOf(p.pts);
    expect(e).toHaveLength(3);
    // i primi due sono gli estremi del tratto (nell'ordine del PDF: (100, 100) poi (200, 100)): l'Estremo (200.0005, 100) della cubica si e' unito a quello del tratto
    expect(e[0]![0]).toBeCloseTo(100, 6);
    expect(e[1]![0]).toBeCloseTo(200, 6);
    expect(e[2]![0]).toBeCloseTo(250, 6);
  });
});

describe('visibilita\' e tipo di pittura', () => {
  const OCGS = [
    { key: 'on', name: 'Acceso', on: true },
    { key: 'off', name: 'Spento', on: false },
  ];
  it('cubiche in un livello spento: nessun punto; acceso, o fuori da ogni livello: punti', async () => {
    const content = [
      '/OC /on BDC 10 10 m 20 40 60 40 70 10 c S EMC', // acceso: 2 punti
      '/OC /off BDC 10 60 m 20 90 60 90 70 60 c S EMC', // spento: niente
      '/OC /on BDC /OC /off BDC 10 110 m 20 140 60 140 70 110 c S EMC EMC', // spento dentro un acceso: niente
      '10 160 m 20 190 60 190 70 160 c S', // fuori da ogni livello: 2 punti
    ].join('\n');
    const p = await readPage(await makePdf({ content, mediabox: [200, 300], ocgs: OCGS }));
    expect(p.geometry.nCubics).toBe(4);
    expect(visibleCubicCount(p.geometry)).toBe(2);
    expect(p.pts.curves).toMatchObject({ cubics: 4, hiddenCubics: 2, endsFromCurves: 4 });
    expect(p.pts.nEnd).toBe(4);
    const ys = endsOf(p.pts).map((e) => 300 - e[1]).sort((a, b) => a - b); // y utente
    expect(ys.map((y) => Math.round(y))).toEqual([10, 10, 160, 160]);
  });

  it('livello spento con soli cubiche e nient\'altro: nessun punto (e le rette dello stesso livello restano come prima)', async () => {
    const p = await readPage(await makePdf({ content: '/OC /off BDC 10 10 m 20 40 60 40 70 10 c S 10 10 m 110 10 l S EMC', mediabox: [200, 100], ocgs: OCGS }));
    expect(p.geometry.nCubics).toBe(1);
    expect(p.geometry.nLines).toBe(1);
    expect(p.pts.nEnd).toBe(0);
    expect(p.pts.curves).toMatchObject({ hiddenCubics: 1 });
    expect(p.pts.stats.hiddenSegments).toBe(1);
  });

  it('riempimento (f) e fillStroke (B): la cubica di un riempimento non da\' punti, quella di un fillStroke si', async () => {
    const fill = await readPage(await curvePdf('10 10 m 20 40 60 40 70 10 c f'));
    expect(fill.geometry.nCubics).toBe(0); // un riempimento non e' un candidato dello snap
    expect(fill.pts.nEnd).toBe(0);
    const fillStroke = await readPage(await curvePdf('10 10 m 20 40 60 40 70 10 c B'));
    expect(fillStroke.geometry.nCubics).toBe(1);
    expect(fillStroke.pts.nEnd).toBe(2);
    const stroke = await readPage(await curvePdf('10 10 m 20 40 60 40 70 10 c S'));
    expect(stroke.pts.nEnd).toBe(2);
    const endPath = await readPage(await curvePdf('10 10 m 20 40 60 40 70 10 c n'));
    expect(endPath.pts.nEnd).toBe(0);
  });
});

describe('filtri: corda sotto soglia, estremi coincidenti, fuori dal foglio', () => {
  it('cubica con corda sotto 0.01 pt: un solo Estremo; con corda 0.0125 pt: due', async () => {
    const tiny = await readPage(await curvePdf('100 100 m 100.001 100.002 100.004 100.002 100.005 100 c S'));
    expect(tiny.pts.nEnd).toBe(1);
    expect(tiny.pts.curves).toMatchObject({ tinyCubics: 1, endsFromCurves: 1 });
    const ok = await readPage(await curvePdf('100 100 m 100.003 100.004 100.01 100.004 100.0125 100 c S'));
    expect(ok.pts.nEnd).toBe(2);
    expect(ok.pts.curves).toMatchObject({ tinyCubics: 0, endsFromCurves: 2 });
  });

  it('cubica con gli estremi coincidenti (un cappio): un solo Estremo, anche se i punti di controllo sono lontani', async () => {
    const p = await readPage(await curvePdf('100 100 m 150 200 50 200 100 100 c S'));
    expect(p.geometry.nCubics).toBe(1);
    expect(p.pts.nEnd).toBe(1);
    expect(p.pts.curves).toMatchObject({ tinyCubics: 1, endsFromCurves: 1 });
  });

  it('estremi fuori dal foglio: oltre 0.01 pt scartati; entro 0.01 pt riportati sul bordo', async () => {
    // pagina 400 x 300: la cubica va da (-50, 100) (fuori) a (200, 100); un'altra da (400.005, 50) (dentro il margine) a (300, 50)
    const p = await readPage(await curvePdf('-50 100 m 0 150 100 150 200 100 c S 400.005 50 m 380 80 340 80 300 50 c S'));
    expect(p.geometry.nCubics).toBe(2);
    expect(p.pts.curves).toMatchObject({ outsidePoints: 1 });
    expect(p.pts.nEnd).toBe(3);
    const e = endsOf(p.pts);
    expect(e.some((q) => Math.abs(q[0] - 400) < 1e-9 && Math.abs(q[1] - 250) < 1e-9), 'il punto a 0.005 pt dal bordo e\' riportato sul bordo (400, 250)').toBe(true);
    expect(e.some((q) => Math.abs(q[0] - 200) < 1e-3 && Math.abs(q[1] - 200) < 1e-3)).toBe(true);
  });
});

describe('quadratica convertita', () => {
  it('una quadratica (DrawOPS 3), gia\' portata a cubica dall\'estrattore, da\' i suoi due estremi (e nessun punto di controllo)', () => {
    // percorso a mano: moveTo (10, 10), curva quadratica con controllo (50, 90) e fine (90, 10), stroke
    const fn = [OPS['constructPath']!];
    const args: unknown[] = [[OPS['stroke']!, [Float32Array.from([DRAW_MOVE_TO, 10, 10, DRAW_QUAD_TO, 50, 90, 90, 10])], null]];
    const res = extractGeometry({ fnArray: fn, argsArray: args, ops: OPS, isLayerVisible: () => true });
    if (!res.ok) throw new Error(res.reason);
    expect(res.geometry.nCubics).toBe(1);
    expect(res.stats.cand.quad).toBe(1);
    const sheet = new PageGeometry({ view: [0, 0, 100, 100], rotate: 0, userUnit: 1 });
    const pts = buildSnapPoints(res.geometry, sheet, { curves: true });
    expectSamePoints(endsOf(pts), [[10, 90], [90, 90]], 1e-9, 'Estremi');
    expect(pts.nMid).toBe(0);
  });
});

describe('contatori e utilita\'', () => {
  it('visibleCubicCount e visibleLineCount contano per livello; le cubiche non cambiano i tratti', async () => {
    const p = await readPage(await loadTestPdf('a4-vettoriale.pdf'));
    expect(visibleLineCount(p.geometry)).toBe(12);
    expect(visibleCubicCount(p.geometry)).toBe(24);
  });

  it('senza cubiche (o senza `curves`) il risultato e\' identico, byte per byte, a quello di CP7b', async () => {
    for (const content of ['10 10 m 110 10 l 110 60 l S', '10 10 m 20 40 60 40 70 10 c 100 100 l S']) {
      const p = await readPage(await makePdf({ content, mediabox: [200, 100] }));
      const plain = buildSnapPoints(p.geometry, p.sheet);
      const off = buildSnapPoints(p.geometry, p.sheet, { curves: false });
      expect(Array.from(off.xy)).toEqual(Array.from(plain.xy));
      expect(off.stats).toEqual(plain.stats);
      expect(off.curves).toBeUndefined();
    }
    const flat = await readPage(await makePdf({ content: '10 10 m 110 10 l 110 60 l S', mediabox: [200, 100] }));
    expect(Array.from(flat.pts.xy)).toEqual(Array.from(flat.linesOnly.xy)); // nessuna cubica: con `curves` lo stesso array
    expect(flat.pts.stats).toEqual(flat.linesOnly.stats);
    expect(flat.pts.curves).toEqual({ cubics: 0, hiddenCubics: 0, tinyCubics: 0, outsidePoints: 0, mergedEnd: 0, endsFromCurves: 0 });
  });

  it('la griglia dei punti con le curve da\' lo stesso risultato della scansione lineare (differenziale, 3000 interrogazioni)', async () => {
    const p = await readPage(await loadTestPdf('a4-vettoriale.pdf'));
    const grid = new PointGrid(p.pts);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let hits = 0;
    for (let k = 0; k < 3000; k++) {
      // meta' delle interrogazioni vicino a un punto (per avere risultati), meta' a caso nel foglio
      const i = Math.floor(rnd() * (p.pts.nEnd + p.pts.nMid));
      const nearPt = rnd() < 0.5;
      const x = nearPt ? p.pts.xy[2 * i]! + (rnd() - 0.5) * 6 : rnd() * p.vp.width;
      const y = nearPt ? p.pts.xy[2 * i + 1]! + (rnd() - 0.5) * 6 : rnd() * p.vp.height;
      const r = 0.5 + rnd() * 12;
      const end = rnd() < 0.8;
      const mid = rnd() < 0.8;
      const a: string[] = [];
      const b: string[] = [];
      grid.forEachNear(x, y, r, end, mid, (px, py, kind) => a.push(`${px},${py},${kind}`));
      scanNear(p.pts, x, y, r, end, mid, (px, py, kind) => b.push(`${px},${py},${kind}`));
      expect(a).toEqual(b);
      hits += a.length;
    }
    expect(hits).toBeGreaterThan(500);
  });
});
