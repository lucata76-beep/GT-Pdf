// Prove unitarie dei punti di snap dei tratti rettilinei del PDF (src/pdf/snapPoints.ts), in Node, con la build LEGACY di PDF.js (quella dell'app).
// I valori attesi NON vengono dal codice provato: (1) per i 7 PDF di public/test-pdfs dalle coordinate di scripts/make-test-pdfs.mjs (drawSheet: rettangolo, assi, quota,
// riferimento di 100 mm) portate nel foglio con `viewport.convertToViewportPoint` di PDF.js (non con `PageGeometry`); (2) per le altre pagine da un calcolo diretto scritto qui.
// Tolleranze dichiarate: 1e-3 pt (= MERGE_TOL_PT) contro le coordinate di disegno (il Float32 di PDF.js sposta di ~3e-5 pt su A3), 1e-9 pt contro il calcolo diretto sugli stessi
// Float32. Niente file nuovi in public/: i PDF con UserUnit, livelli e altro si costruiscono qui con @cantoo/pdf-lib.
import { PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { type PdfGeometry, extractGeometry } from './geometry';
import { makePdf } from './geometryTestUtils';
import { BYTES_PER_POINT, MERGE_TOL_PT, MIN_SEGMENT_PT, PAGE_MARGIN_PT, type SnapPoints, buildSnapPoints, visibleLineCount } from './snapPoints';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const MM = 72 / 25.4;
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
  pts: SnapPoints;
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
  return { geometry: res.geometry, sheet, pdfjsToSheet: (x, y) => vp.convertToViewportPoint(x, y) as [number, number], vp, pts: buildSnapPoints(res.geometry, sheet) };
}
const endsOf = (p: SnapPoints): [number, number][] => Array.from({ length: p.nEnd }, (_, i) => [p.xy[2 * i]!, p.xy[2 * i + 1]!]);
const midsOf = (p: SnapPoints): [number, number][] => Array.from({ length: p.nMid }, (_, i) => [p.xy[2 * (p.nEnd + i)]!, p.xy[2 * (p.nEnd + i) + 1]!]);
const sortPts = (a: [number, number][]): [number, number][] => [...a].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
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

// ------------------------------------------------------------------ calcolo indipendente dalle coordinate di scripts/make-test-pdfs.mjs
type Seg = [number, number, number, number];
/** I 12 segmenti di drawSheet nello spazio utente (rettangolo: 4 con la chiusura; assi: 2; quota: 3; riferimento: 3). */
function sheetSegments(x: number, y: number, w: number, h: number): Seg[] {
  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const qy = cy - r - 18;
  const ry = y + 62;
  const rx = x + 28;
  const a: [number, number] = [x + 10, y + 10];
  const b: [number, number] = [x + w - 10, y + 10];
  const c: [number, number] = [x + w - 10, y + h - 10];
  const d: [number, number] = [x + 10, y + h - 10];
  return [
    [...a, ...b],
    [...b, ...c],
    [...c, ...d],
    [...d, ...a],
    [cx - r * 1.15, cy, cx + r * 1.15, cy],
    [cx, cy - r * 1.15, cx, cy + r * 1.15],
    [cx - r, qy, cx + r, qy],
    [cx - r, qy - 4, cx - r, qy + 4],
    [cx + r, qy - 4, cx + r, qy + 4],
    [rx, ry, rx + 100 * MM, ry],
    [rx, ry - 6, rx, ry + 6],
    [rx + 100 * MM, ry - 6, rx + 100 * MM, ry + 6],
  ];
}
/** Estremi e punti medi attesi (nel foglio, con la conversione di PDF.js), con i coincidenti uniti entro `tol` come fa la costruzione. */
function expectedFromSegments(segs: Seg[], toSheet: (x: number, y: number) => [number, number], tol: number): { ends: [number, number][]; mids: [number, number][] } {
  const uniq = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of list) if (!out.some((q) => Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol)) out.push(p);
    return out;
  };
  const ends: [number, number][] = [];
  const mids: [number, number][] = [];
  for (const [x0, y0, x1, y1] of segs) {
    const a = toSheet(x0, y0);
    const b = toSheet(x1, y1);
    ends.push(a, b);
    mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return { ends: uniq(ends), mids: uniq(mids) };
}
/** Calcolo diretto da `lineXY` (Float32 letti da PDF.js) con la conversione di PDF.js: nessun filtro tranne i livelli spenti; per confrontare gli stessi numeri. */
function directFromGeometry(g: PdfGeometry, toSheet: (x: number, y: number) => [number, number], tol: number): { ends: [number, number][]; mids: [number, number][] } {
  const segs: Seg[] = [];
  for (let i = 0; i < g.nLines; i++) {
    if (g.pathVisible[g.linePath[i]!] !== 1) continue;
    segs.push([g.lineXY[4 * i]!, g.lineXY[4 * i + 1]!, g.lineXY[4 * i + 2]!, g.lineXY[4 * i + 3]!]);
  }
  return expectedFromSegments(segs, toSheet, tol);
}

describe('i 7 PDF di prova: Estremo e Punto medio contro le coordinate di scripts/make-test-pdfs.mjs', () => {
  const SINGLE: [string, number, number, number, number, [number, number]?][] = [
    // file, x, y, w, h (riquadro visibile dello spazio utente)
    ['a4-vettoriale.pdf', 0, 0, A4[0], A4[1]],
    ['a3-vettoriale.pdf', 0, 0, 1190.551, 841.89],
    ['a4-rotate90.pdf', 0, 0, A4[0], A4[1]],
    ['a4-cropbox.pdf', 50, 50, 400, 550],
  ];
  for (const [file, x, y, w, h] of SINGLE) {
    it(`${file}: 20 Estremi e 11 Punti medi nelle posizioni del disegno (tolleranza 1e-3 pt)`, async () => {
      const p = await readPage(await loadTestPdf(file));
      const want = expectedFromSegments(sheetSegments(x, y, w, h), p.pdfjsToSheet, MERGE_TOL_PT);
      // 12 segmenti: 4 + 2 + 3 + 3; 24 estremi per tratto -> 20 distinti; i punti medi dei due assi coincidono al centro -> 11
      expect(want.ends).toHaveLength(20);
      expect(want.mids).toHaveLength(11);
      expect(p.geometry.nLines).toBe(12);
      expect(p.pts.nEnd).toBe(20);
      expect(p.pts.nMid).toBe(11);
      expectSamePoints(endsOf(p.pts), want.ends, 1e-3, 'Estremi');
      expectSamePoints(midsOf(p.pts), want.mids, 1e-3, 'Punti medi');
      expect(p.pts.stats).toEqual({ segments: 12, hiddenSegments: 0, tinySegments: 0, outsidePoints: 0, mergedEnd: 4, mergedMid: 1 });
      expect(p.pts.width).toBeCloseTo(p.vp.width, 9);
      expect(p.pts.height).toBeCloseTo(p.vp.height, 9);
      expect(p.pts.bytes).toBe(31 * BYTES_PER_POINT);
    });
    it(`${file}: lo stesso risultato del calcolo diretto sugli stessi Float32 (tolleranza 1e-9 pt) e ogni punto sta dentro il foglio`, async () => {
      const p = await readPage(await loadTestPdf(file));
      const d = directFromGeometry(p.geometry, p.pdfjsToSheet, MERGE_TOL_PT);
      expectSamePoints(endsOf(p.pts), d.ends, 1e-9, 'Estremi');
      expectSamePoints(midsOf(p.pts), d.mids, 1e-9, 'Punti medi');
      for (let i = 0; i < p.pts.nEnd + p.pts.nMid; i++) {
        expect(p.pts.xy[2 * i]!).toBeGreaterThanOrEqual(0);
        expect(p.pts.xy[2 * i]!).toBeLessThanOrEqual(p.vp.width);
        expect(p.pts.xy[2 * i + 1]!).toBeGreaterThanOrEqual(0);
        expect(p.pts.xy[2 * i + 1]!).toBeLessThanOrEqual(p.vp.height);
      }
    });
  }

  it('a4-rotate90.pdf e a4-cropbox.pdf: le dimensioni del foglio sono quelle di PageGeometry e il riferimento di 100 mm e\' lungo 100 mm sul foglio', async () => {
    for (const file of ['a4-rotate90.pdf', 'a4-cropbox.pdf']) {
      const p = await readPage(await loadTestPdf(file));
      expect(p.pts.width).toBeCloseTo(p.sheet.width, 9);
      expect(p.pts.height).toBeCloseTo(p.sheet.height, 9);
      // il riferimento di 100 mm e le sue due tacche: tre coppie di Estremi a 100 mm (distanza in pt fisici = 100 * 72 / 25.4), e solo la coppia centrale ha il Punto medio fra i due
      const e = endsOf(p.pts);
      const m = midsOf(p.pts);
      let found = 0;
      let withMid = 0;
      for (let i = 0; i < e.length; i++) {
        for (let j = i + 1; j < e.length; j++) {
          if (Math.abs(Math.hypot(e[i]![0] - e[j]![0], e[i]![1] - e[j]![1]) - 100 * MM) >= 1e-3) continue;
          found++;
          const mx = (e[i]![0] + e[j]![0]) / 2;
          const my = (e[i]![1] + e[j]![1]) / 2;
          if (m.some((q) => Math.abs(q[0] - mx) < 1e-3 && Math.abs(q[1] - my) < 1e-3)) withMid++;
        }
      }
      expect(found, file).toBe(3);
      expect(withMid, file).toBe(1); // solo il tratto centrale ha il Punto medio fra i due; le tacche no
    }
  });

  it('misto-3-pagine.pdf: ogni pagina ha i suoi punti (A4, A3 orizzontale, A4 con /Rotate 90)', async () => {
    const bytes = await loadTestPdf('misto-3-pagine.pdf');
    const boxes: [number, number][] = [A4, [1190.551, 841.89], A4];
    for (let n = 1; n <= 3; n++) {
      const p = await readPage(bytes, n);
      const [w, h] = boxes[n - 1]!;
      const want = expectedFromSegments(sheetSegments(0, 0, w, h), p.pdfjsToSheet, MERGE_TOL_PT);
      expectSamePoints(endsOf(p.pts), want.ends, 1e-3, `pagina ${n}, Estremi`);
      expectSamePoints(midsOf(p.pts), want.mids, 1e-3, `pagina ${n}, Punti medi`);
    }
  });

  it('a4-annotazioni.pdf: i punti del disegno di base ci sono tutti, ci sono quelli delle annotazioni e coincidono con il calcolo diretto', async () => {
    const p = await readPage(await loadTestPdf('a4-annotazioni.pdf'));
    const base = expectedFromSegments(sheetSegments(0, 0, A4[0], A4[1]), p.pdfjsToSheet, MERGE_TOL_PT);
    const ends = endsOf(p.pts);
    const mids = midsOf(p.pts);
    for (const w of base.ends) expect(ends.some((g) => Math.abs(g[0] - w[0]) <= 1e-3 && Math.abs(g[1] - w[1]) <= 1e-3), `Estremo di base (${w})`).toBe(true);
    for (const w of base.mids) expect(mids.some((g) => Math.abs(g[0] - w[0]) <= 1e-3 && Math.abs(g[1] - w[1]) <= 1e-3), `Punto medio di base (${w})`).toBe(true);
    expect(p.geometry.nLines).toBeGreaterThan(12); // 25 lineTo e 11 chiusure in 20 percorsi (CP7a): i tratti delle annotazioni (timbro, campo, casella) sono candidati
    expect(p.pts.nEnd).toBeGreaterThan(20);
    expect(p.pts.nMid).toBeGreaterThan(11);
    const d = directFromGeometry(p.geometry, p.pdfjsToSheet, MERGE_TOL_PT);
    expectSamePoints(ends, d.ends, 1e-9, 'Estremi');
    expectSamePoints(mids, d.mids, 1e-9, 'Punti medi');
  });

  it('a4-scansione.pdf: nessun tratto, nessun punto', async () => {
    const p = await readPage(await loadTestPdf('a4-scansione.pdf'));
    expect(p.geometry.nLines).toBe(0);
    expect(p.pts.nEnd).toBe(0);
    expect(p.pts.nMid).toBe(0);
    expect(p.pts.xy.length).toBe(0);
    expect(p.pts.bytes).toBe(0);
  });
});

describe('UserUnit diverso da 1', () => {
  it('UserUnit 2.5: i punti sono in pt FISICI del foglio (gli unitari utente per 2.5) e coincidono con la conversione di PDF.js', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2.5));
    page.drawLine({ start: { x: 40, y: 50 }, end: { x: 240, y: 50 }, thickness: 1 });
    page.drawLine({ start: { x: 40, y: 50 }, end: { x: 40, y: 150 }, thickness: 1 });
    const p = await readPage(await doc.save({ useObjectStreams: false }));
    expect(p.sheet.userUnit).toBe(2.5);
    expect(p.pts.width).toBeCloseTo(1000, 9); // 400 unita' x 2.5
    expect(p.pts.height).toBeCloseTo(750, 9);
    // estremi: (40,50), (240,50), (40,150) -> nel foglio (100, 750 - 125), (600, 625), (100, 375); l'estremo (40,50) e' comune ai due tratti: unito
    expectSamePoints(endsOf(p.pts), [[100, 625], [600, 625], [100, 375]], 1e-3, 'Estremi');
    expectSamePoints(midsOf(p.pts), [[350, 625], [100, 500]], 1e-3, 'Punti medi');
    const d = directFromGeometry(p.geometry, p.pdfjsToSheet, MERGE_TOL_PT);
    expectSamePoints(endsOf(p.pts), d.ends, 1e-9, 'Estremi (PDF.js)');
    expectSamePoints(midsOf(p.pts), d.mids, 1e-9, 'Punti medi (PDF.js)');
  });

  it('UserUnit 2.5: la soglia dei tratti piccoli e\' in pt FISICI (0.005 unita\' utente = 0.0125 pt: tratto vero; 0.003 unita\' = 0.0075 pt: quasi un punto)', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([400, 300]);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2.5));
    page.drawLine({ start: { x: 100, y: 100 }, end: { x: 100.005, y: 100 }, thickness: 1 }); // 0.0125 pt fisici
    page.drawLine({ start: { x: 200, y: 100 }, end: { x: 200.003, y: 100 }, thickness: 1 }); // 0.0075 pt fisici
    const p = await readPage(await doc.save({ useObjectStreams: false }));
    expect(p.pts.stats.tinySegments).toBe(1);
    expect(p.pts.nMid).toBe(1);
    expect(p.pts.nEnd).toBe(3); // due estremi del primo, uno solo del secondo
  });
});

describe('livelli (OCG e OCMD)', () => {
  it('livello acceso, spento e annidati: solo i tratti visibili danno punti', async () => {
    const content = [
      '/OC /on BDC 10 10 m 110 10 l S EMC', // acceso
      '/OC /off BDC 10 20 m 110 20 l S EMC', // spento
      '/OC /on BDC /OC /off BDC 10 30 m 110 30 l S EMC EMC', // acceso con dentro uno spento: spento
      '/OC /off BDC /OC /on BDC 10 40 m 110 40 l S EMC EMC', // spento con dentro uno acceso: spento
      '/OC /on BDC /OC /on BDC 10 50 m 110 50 l S EMC EMC', // acceso dentro acceso: visibile
      '10 60 m 110 60 l S', // fuori da ogni livello
    ].join('\n');
    const p = await readPage(
      await makePdf({
        content,
        mediabox: [200, 100],
        ocgs: [
          { key: 'on', name: 'Acceso', on: true },
          { key: 'off', name: 'Spento', on: false },
        ],
      }),
    );
    expect(p.geometry.nLines).toBe(6);
    expect(visibleLineCount(p.geometry)).toBe(3);
    expect(p.pts.stats.hiddenSegments).toBe(3);
    expect(p.pts.nEnd).toBe(6);
    expect(p.pts.nMid).toBe(3);
    const ys = midsOf(p.pts).map((m) => 100 - m[1]).sort((a, b) => a - b); // y utente dei punti medi
    expect(ys.map((y) => Math.round(y))).toEqual([10, 50, 60]);
  });

  it('OCMD con politica AllOff: la visibilita\' viene da PDF.js (isVisible), non da una regola nostra', async () => {
    const p = await readPage(
      await makePdf({
        content: '/OC /m BDC 10 10 m 110 10 l S EMC\n10 20 m 110 20 l S',
        mediabox: [200, 100],
        ocgs: [{ key: 'off', name: 'Spento', on: false }],
        ocmds: [{ key: 'm', groups: ['off'], policy: 'AllOff' }],
      }),
    );
    expect(p.geometry.nLines).toBe(2);
    expect(p.pts.nMid).toBe(2); // il gruppo e' spento e la politica AllOff vuole tutti spenti: visibile
    const q = await readPage(
      await makePdf({
        content: '/OC /m BDC 10 10 m 110 10 l S EMC\n10 20 m 110 20 l S',
        mediabox: [200, 100],
        ocgs: [{ key: 'off', name: 'Spento', on: false }],
        ocmds: [{ key: 'm', groups: ['off'], policy: 'AnyOn' }],
      }),
    );
    expect(q.pts.nMid).toBe(1); // AnyOn con il gruppo spento: nascosto
  });
});

describe('regole di costruzione su elenchi di tratti scritti a mano', () => {
  const flat = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
  /** Geometria di prova: `segs` sono (x0, y0, x1, y1) nello spazio utente; `path[i]` il percorso, `vis[p]` la visibilita' del percorso p. */
  function geom(segs: Seg[], path?: number[], vis?: number[]): PdfGeometry {
    const nPaths = Math.max(1, ...(path ?? [0]).map((x) => x + 1));
    const lineXY = new Float32Array(segs.flat());
    return {
      nPaths,
      pathPaint: new Uint8Array(nPaths).fill(1),
      pathVisible: Uint8Array.from(vis ?? new Array<number>(nPaths).fill(1)),
      nLines: segs.length,
      lineXY,
      linePath: Uint32Array.from(path ?? segs.map(() => 0)),
      nCubics: 0,
      cubicXY: new Float32Array(0),
      cubicPath: new Uint32Array(0),
      bytes: 0,
    };
  }
  const E = (p: SnapPoints): [number, number][] => sortPts(endsOf(p));
  const Mi = (p: SnapPoints): [number, number][] => sortPts(midsOf(p));

  it('un tratto: due Estremi e un Punto medio, nel foglio (Y verso il basso) e in doppia precisione', () => {
    const p = buildSnapPoints(geom([[100, 200, 300, 600]]), flat);
    expect(E(p)).toEqual([[100, 600], [300, 200]]);
    expect(Mi(p)).toEqual([[200, 400]]);
    expect(p.nEnd).toBe(2);
    expect(p.nMid).toBe(1);
    expect(p.xy).toBeInstanceOf(Float64Array);
    expect(p.xy.length).toBe(6);
    expect(p.bytes).toBe(3 * BYTES_PER_POINT);
    // l'ordine in xy: prima gli Estremi (nell'ordine dei tratti), poi i Punti medi
    expect(Array.from(p.xy)).toEqual([100, 600, 300, 200, 200, 400]);
  });

  it('il Punto medio e\' la media DEGLI ESTREMI GIA\' NEL FOGLIO in doppia precisione (non una somma di Float32)', () => {
    const a = 0.1; // non esatto in Float32: lineXY lo arrotonda
    const b = 0.7;
    const g = geom([[a, a, b, b + 100]]);
    const fa = Math.fround(a);
    const fb = Math.fround(b);
    const fb100 = Math.fround(b + 100);
    const p = buildSnapPoints(g, flat);
    const sa = flat.userToSheet({ x: fa, y: fa });
    const sb = flat.userToSheet({ x: fb, y: fb100 });
    const m = midsOf(p)[0]!;
    expect(m[0]).toBe((sa.x + sb.x) / 2);
    expect(m[1]).toBe((sa.y + sb.y) / 2);
  });

  it('i punti coincidenti si uniscono (spezzata e chiusura), per tipo; un Estremo e un Punto medio nello stesso punto restano due', () => {
    // spezzata 0-1-2 e ritorno a 0 (triangolo): 3 Estremi distinti, 3 Punti medi
    const tri = geom([[10, 10, 110, 10], [110, 10, 60, 100], [60, 100, 10, 10]]);
    const p = buildSnapPoints(tri, flat);
    expect(p.nEnd).toBe(3);
    expect(p.nMid).toBe(3);
    expect(p.stats.mergedEnd).toBe(3);
    // il Punto medio di (0,0)-(20,0) cade sull'Estremo di (10,0)-(10,30): stessa posizione, tipi diversi
    const q = buildSnapPoints(geom([[0, 0, 20, 0], [10, 0, 10, 30]]), flat);
    expect(q.nEnd).toBe(4);
    expect(q.nMid).toBe(2);
    expect(E(q)).toContainEqual([10, 800]);
    expect(Mi(q)).toContainEqual([10, 800]);
  });

  it('coincidenti entro MERGE_TOL_PT: uniti (il primo resta); piu\' lontani: due punti', () => {
    const same = buildSnapPoints(geom([[10, 10, 100, 10], [100, 10, 100, 90], [100.0003, 10.0002, 150, 10]]), flat);
    expect(same.nEnd).toBe(4); // (10,10), (100,10) unito con (100.0003, 10.0002), (100,90), (150,10)
    expect(E(same)).toContainEqual([100, 790]);
    const apart = buildSnapPoints(geom([[10, 10, 100, 10], [100.01, 10, 150, 10]]), flat);
    expect(apart.nEnd).toBe(4);
    expect(MERGE_TOL_PT).toBeLessThan(0.01);
  });

  it('coordinate con tre decimali sul bordo di una cella (297.638 = meta\' di A4 e il Float32 che la sposta di 4e-6 pt): uniti lo stesso', () => {
    // regressione trovata provando a4-vettoriale.pdf: i Punti medi dei due assi coincidono al centro della pagina ma differiscono di ~4e-6 pt per l'arrotondamento Float32
    const x = 297.638;
    const p = buildSnapPoints(geom([[x - 100, 400, x + 100, 400], [x, 300, x, 500]]), flat);
    const fx = Math.fround(x);
    expect(p.nMid).toBe(1);
    expect(Math.abs(Math.fround(x - 100) / 2 + Math.fround(x + 100) / 2 - fx)).toBeLessThan(1e-4);
    expect(p.stats.mergedMid).toBe(1);
    // e a destra e a sinistra del bordo di ogni cella da 4 x MERGE_TOL_PT: sempre uniti entro la tolleranza
    for (let k = 0; k < 200; k++) {
      const base = 100 + k * 0.004; // ogni bordo di cella
      const q = buildSnapPoints(geom([[base - 0.0004, 50, 450, 50], [base + 0.0004, 50, 300, 300]]), flat); // due punti a 0.0008 pt, uno per parte del bordo
      expect(q.stats.mergedEnd, `bordo ${base}`).toBe(1);
    }
  });

  it('tratto di lunghezza 0 e sotto soglia: un solo Estremo e nessun Punto medio; sopra soglia: due Estremi e un Punto medio', () => {
    const zero = buildSnapPoints(geom([[50, 50, 50, 50]]), flat);
    expect(zero.nEnd).toBe(1);
    expect(zero.nMid).toBe(0);
    expect(zero.stats.tinySegments).toBe(1);
    const tiny = buildSnapPoints(geom([[50, 50, 50.009, 50]]), flat);
    expect(tiny.nEnd).toBe(1);
    expect(tiny.nMid).toBe(0);
    expect(Math.hypot(0.009, 0)).toBeLessThan(MIN_SEGMENT_PT);
    const ok = buildSnapPoints(geom([[50, 50, 50.02, 50]]), flat);
    expect(ok.nEnd).toBe(2);
    expect(ok.nMid).toBe(1);
    // un punto isolato (tratto nullo) coperto da un altro Estremo: nessuna aggiunta
    const covered = buildSnapPoints(geom([[50, 50, 80, 50], [50, 50, 50, 50]]), flat);
    expect(covered.nEnd).toBe(2);
    expect(covered.stats.mergedEnd).toBe(1);
  });

  it('tratti in percorsi nascosti: nessun punto; contati', () => {
    const p = buildSnapPoints(geom([[0, 0, 10, 0], [0, 10, 10, 10], [0, 20, 10, 20]], [0, 1, 1], [1, 0]), flat);
    expect(p.nEnd).toBe(2);
    expect(p.nMid).toBe(1);
    expect(p.stats.hiddenSegments).toBe(2);
    expect(visibleLineCount(geom([[0, 0, 10, 0], [0, 10, 10, 10], [0, 20, 10, 20]], [0, 1, 1], [1, 0]))).toBe(1);
  });

  it('punti fuori dal foglio: scartati oltre il margine; entro il margine riportati sul bordo (il Float32 non li fa uscire dal foglio)', () => {
    // il tratto da (-100, 100) a (100, 100): l'estremo sinistro e' fuori (scartato), il medio (0, ...) cade sul bordo: resta
    const a = buildSnapPoints(geom([[-100, 100, 100, 100]]), flat);
    expect(E(a)).toEqual([[100, 700]]);
    expect(Mi(a)).toEqual([[0, 700]]);
    expect(a.stats.outsidePoints).toBe(1);
    // bordo disegnato sul bordo del foglio, con l'errore di un Float32: 600.0001 e -0.0001 (entro PAGE_MARGIN_PT) -> sul bordo, dentro il foglio
    const edge = buildSnapPoints(geom([[-0.0001, 0.0001, 600.0001, 0.0001]]), flat);
    const [e1, e2] = E(edge);
    expect(e1![0]).toBe(0);
    expect(e2![0]).toBe(600);
    for (const e of E(edge)) {
      expect(flat.contains({ x: e[0], y: e[1] })).toBe(true);
    }
    expect(edge.stats.outsidePoints).toBe(0);
    // oltre il margine: scartato
    const out = buildSnapPoints(geom([[600 + PAGE_MARGIN_PT * 2, 100, 600 + 50, 100]]), flat);
    expect(out.nEnd).toBe(0);
    expect(out.nMid).toBe(0);
    expect(out.stats.outsidePoints).toBe(3);
  });

  it('nessun tratto: zero punti, nessun errore', () => {
    const p = buildSnapPoints(geom([]), flat);
    expect(p.nEnd + p.nMid).toBe(0);
    expect(p.xy.length).toBe(0);
  });

  it('molti tratti: lo stesso numero di punti e un tempo ragionevole (300.000 tratti)', () => {
    const n = 300000;
    const segs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i % 600) + 0.25;
      const y = Math.floor(i / 600) * 1.5 + 0.25;
      segs.push(x, y, x + 0.5, y);
    }
    const nSeg = n;
    const g: PdfGeometry = {
      nPaths: 1,
      pathPaint: new Uint8Array(1).fill(1),
      pathVisible: new Uint8Array(1).fill(1),
      nLines: nSeg,
      lineXY: new Float32Array(segs),
      linePath: new Uint32Array(nSeg),
      nCubics: 0,
      cubicXY: new Float32Array(0),
      cubicPath: new Uint32Array(0),
      bytes: 0,
    };
    const flatBig = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
    const t0 = performance.now();
    const p = buildSnapPoints(g, flatBig);
    const ms = performance.now() - t0;
    expect(p.nMid).toBe(n);
    expect(p.nEnd).toBe(2 * n); // nessun estremo comune: x e x + 0.5 di tratti vicini non coincidono (passo 1)
    expect(ms).toBeLessThan(5000);
  });
});
