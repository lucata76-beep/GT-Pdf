// Prove della scena dei tratti del PDF su PDF VERI letti con PDF.js (build legacy, come l'app), in Node (CP7d): Intersezione e Perpendicolare per /Rotate 0 e 90, CropBox e UserUnit 2.5,
// riempimenti, tracciati-e-riempiti, livelli, pagine senza tratti, stati di `loadPdfSnap` (pronto con scena, fitta, curve sole) e i 7 PDF di prova.
// I valori attesi NON vengono dal codice provato: l'incontro di due tratti e' calcolato qui nello spazio utente con la regola di Cramer e portato nel foglio con
// `viewport.convertToViewportPoint` di PDF.js (non con `PageGeometry`); per i PDF di prova dalle coordinate di scripts/make-test-pdfs.mjs (drawSheet). Tolleranza dichiarata: 1e-3 pt
// (il Float32 di PDF.js sposta le coordinate di ~3e-5 pt su A3, ~1e-4 con UserUnit 2.5).
import { PDFDocument, PDFName, PDFNumber, degrees } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { findSnap } from '../geometry/snap';
import { extraCandidates } from '../geometry/snapExtra';
import { type PdfGeometry, extractGeometry } from './geometry';
import { makePdf } from './geometryTestUtils';
import { type SegmentGrid, buildSegmentScene } from './segmentIndex';
import { type PdfSnapState, loadPdfSnap, pdfSnapLogLine, pdfSnapNote } from './snapPage';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const MM = 72 / 25.4;
const TOL = 1e-3;
type Pt = { x: number; y: number };

async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
}
interface Page {
  geometry: PdfGeometry;
  sheet: PageGeometry;
  /** Conversione utente -> foglio di PDF.js (indipendente da `PageGeometry`). */
  toSheet: (x: number, y: number) => Pt;
  scene: SegmentGrid | null;
  stats: ReturnType<typeof buildSegmentScene>['stats'];
}
async function readPage(bytes: Uint8Array, pageNo = 1): Promise<Page> {
  const doc = await open(bytes);
  const page = await doc.getPage(pageNo);
  const ol = await page.getOperatorList();
  const cfg = await doc.getOptionalContentConfig();
  const res = extractGeometry({ fnArray: ol.fnArray, argsArray: ol.argsArray, ops: OPS, isLayerVisible: (d) => cfg.isVisible(d as never) });
  if (!res.ok) throw new Error(res.reason);
  const sheet = new PageGeometry({ view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit });
  const vp = page.getViewport({ scale: 1 });
  const built = buildSegmentScene(res.geometry, sheet);
  return {
    geometry: res.geometry,
    sheet,
    toSheet: (x, y) => {
      const [sx, sy] = vp.convertToViewportPoint(x, y) as [number, number];
      return { x: sx, y: sy };
    },
    scene: built.grid,
    stats: built.stats,
  };
}
/** Incontro di due tratti nello spazio utente con la regola di Cramer (coordinate Float32 come quelle di PDF.js). */
function cramer(a: [number, number, number, number], b: [number, number, number, number]): Pt | null {
  const [x1, y1, x2, y2] = Array.from(new Float32Array(a));
  const [x3, y3, x4, y4] = Array.from(new Float32Array(b));
  const a11 = x2 - x1;
  const a12 = -(x4 - x3);
  const a21 = y2 - y1;
  const a22 = -(y4 - y3);
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-9) return null;
  const r1 = x3 - x1;
  const r2 = y3 - y1;
  const t = (r1 * a22 - a12 * r2) / det;
  const u = (a11 * r2 - r1 * a21) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}
const near = (a: Pt, b: Pt, tol = TOL): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
/** Tutte le Intersezioni di una scena (raggio enorme: serve che i tratti siano pochi): i punti, senza doppioni. */
function allIntersections(p: Page): Pt[] {
  const out: Pt[] = [];
  if (!p.scene) return out;
  extraCandidates({ prims: [] }, { x: p.sheet.width / 2, y: p.sheet.height / 2 }, 1e6, { intersection: true }, null, (x, y) => out.push({ x, y }), p.scene);
  const uniq: Pt[] = [];
  for (const q of out) if (!uniq.some((u) => Math.hypot(u.x - q.x, u.y - q.y) < 1e-6)) uniq.push(q);
  return uniq;
}
const A = [80, 100, 420, 300] as [number, number, number, number];
const B = [120, 400, 380, 80] as [number, number, number, number];
async function twoLines(setup: (page: ReturnType<PDFDocument['addPage']>) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([600, 800]);
  setup(page);
  page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: A[2], y: A[3] }, thickness: 1 });
  page.drawLine({ start: { x: B[0], y: B[1] }, end: { x: B[2], y: B[3] }, thickness: 1 });
  return doc.save({ useObjectStreams: false });
}

describe('Intersezione fra due tratti del PDF, per /Rotate, CropBox e UserUnit (contro PDF.js)', () => {
  const want = cramer(A, B)!;
  const variants: [string, (p: ReturnType<PDFDocument['addPage']>) => void][] = [
    ['/Rotate 0', () => undefined],
    ['/Rotate 90', (p) => p.setRotation(degrees(90))],
    ['/Rotate 180', (p) => p.setRotation(degrees(180))],
    ['/Rotate 270', (p) => p.setRotation(degrees(270))],
    ['CropBox (50, 50, 400, 500)', (p) => p.setCropBox(50, 50, 400, 500)],
    ['/Rotate 90 con CropBox', (p) => (p.setRotation(degrees(90)), p.setCropBox(50, 50, 400, 500))],
    ['UserUnit 2.5', (p) => p.node.set(PDFName.of('UserUnit'), PDFNumber.of(2.5))],
    ['UserUnit 2.5, /Rotate 90 e CropBox', (p) => (p.node.set(PDFName.of('UserUnit'), PDFNumber.of(2.5)), p.setRotation(degrees(90)), p.setCropBox(50, 50, 400, 500))],
  ];
  for (const [name, setup] of variants) {
    it(`${name}: l'Intersezione e' dove PDF.js porta l'incontro calcolato nello spazio utente, e il marcatore e' di tipo Intersezione`, async () => {
      const p = await readPage(await twoLines(setup));
      expect(p.stats.kept).toBe(2);
      const exp = p.toSheet(want.x, want.y);
      const pts = allIntersections(p);
      expect(pts).toHaveLength(1);
      near(pts[0]!, exp);
      for (const d of [[0, 0], [3, 2], [-5, 4]] as const) {
        const h = findSnap([], p.sheet, { x: exp.x + d[0], y: exp.y + d[1] }, 10, { intersection: true }, [], { pdfSegments: p.scene });
        expect(h?.kind).toBe('intersection');
        near(h!.point, exp);
        // all'inserimento: lo stesso incontro nello spazio utente
        const back = p.sheet.sheetToUser(h!.point);
        near(back, want);
      }
    });
  }

  it('Perpendicolare dall\'ancora a un tratto: il piede e\' quello calcolato nello spazio utente e portato nel foglio da PDF.js (anche con /Rotate 90, CropBox e UserUnit 2.5)', async () => {
    for (const [name, setup] of variants) {
      const p = await readPage(await twoLines(setup));
      const anchor = { x: 300, y: 450 };
      // piede su A: proiezione nello spazio utente
      const [x1, y1, x2, y2] = Array.from(new Float32Array(A));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = ((anchor.x - x1) * dx + (anchor.y - y1) * dy) / (dx * dx + dy * dy);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
      const foot = { x: x1 + t * dx, y: y1 + t * dy };
      const exp = p.toSheet(foot.x, foot.y);
      // la perpendicolare dall'ancora a B potrebbe cadere vicino: il candidato piu' vicino al cursore e' quello su A
      const h = findSnap([], p.sheet, { x: exp.x + 1, y: exp.y - 1 }, 6, { perpendicular: true }, [], { pdfSegments: p.scene, anchor });
      expect(h?.kind, name).toBe('perpendicular');
      near(h!.point, exp);
    }
  });
});

describe('quali tratti entrano: riempimenti, tracciati e riempiti, livelli', () => {
  it('un percorso `fill` non da\' tratti (neanche i lati del rettangolo); `fillStroke` si', async () => {
    const content = [
      '0.6 g 100 100 200 100 re f', // riempimento: i lati NON sono tratti
      '0 G 50 150 m 350 150 l S', // tratto che attraversa il riempimento a x = 100 e x = 300
      '1 0 0 rg 0 G 100 300 200 100 re B', // riempimento e contorno: i lati SONO tratti
      '50 350 m 350 350 l S', // tratto che attraversa il contorno a x = 100 e x = 300
    ].join('\n');
    const p = await readPage(await makePdf({ content, mediabox: [600, 800] }));
    const xs = allIntersections(p)
      .map((q) => p.sheet.sheetToUser(q))
      .sort((a, b) => a.x - b.x);
    // il rettangolo `B` ha 4 lati (+ la chiusura gia' compresa) e il tratto ne attraversa 2: 2 incontri a y = 350; il riempimento nessuno
    expect(xs).toHaveLength(2);
    near(xs[0]!, { x: 100, y: 350 });
    near(xs[1]!, { x: 300, y: 350 });
    expect(p.stats.kept).toBe(1 + 4 + 1); // il tratto del fill non c'e': 1 (S) + 4 (B) + 1 (S)
  });
  it('un livello spento non da\' tratti (l\'altro tratto resta, ma da solo non ha incontri); un livello acceso si', async () => {
    const content = ['/OC /on BDC 100 100 m 500 300 l S EMC', '/OC /off BDC 100 300 m 500 100 l S EMC', '/OC /on BDC 150 80 m 450 340 l S EMC'].join('\n');
    const p = await readPage(
      await makePdf({
        content,
        mediabox: [600, 800],
        ocgs: [
          { key: 'on', name: 'A', on: true },
          { key: 'off', name: 'B', on: false },
        ],
      }),
    );
    expect(p.stats).toMatchObject({ segments: 3, hidden: 1, kept: 2 });
    const pts = allIntersections(p);
    expect(pts).toHaveLength(1);
    const want = cramer([100, 100, 500, 300], [150, 80, 450, 340])!;
    near(pts[0]!, p.toSheet(want.x, want.y));
  });
  it('un tratto sotto la soglia di 0.01 pt non e\' in scena (`tiny`), a 0.05 pt si', async () => {
    const p = await readPage(await makePdf({ content: '100 100 m 100.005 100 l S\n200 200 m 200.05 200 l S', mediabox: [600, 800] }));
    expect(p.stats).toMatchObject({ segments: 2, tiny: 1, kept: 1 });
  });
  it('pagina con solo testo e riempimenti (nessun tratto): scena assente e nessuna eccezione', async () => {
    const p = await readPage(await makePdf({ content: '0.5 g 10 10 100 100 re f\nBT /F1 12 Tf 20 20 Td (x) Tj ET', mediabox: [600, 800] }));
    expect(p.scene).toBeNull();
    expect(p.stats).toMatchObject({ segments: 0, kept: 0 });
    expect(findSnap([], p.sheet, { x: 50, y: 50 }, 10, { intersection: true, perpendicular: true }, [], { pdfSegments: p.scene, anchor: { x: 1, y: 1 } })).toBeNull();
  });
});

describe('i PDF di prova: le Intersezioni di drawSheet (scripts/make-test-pdfs.mjs) sono quelle calcolate dalle sue coordinate', () => {
  /**
   * drawSheet: assi a croce al centro, quota con due tacche, riferimento di 100 mm con due tacche; le coordinate sono quelle del generatore (nello spazio utente). Incontri: gli assi fra
   * loro, la quota con le sue due tacche, il riferimento con le sue due tacche e, SE l'asse verticale (che va da cy - 1.15 r a cy + 1.15 r) arriva alla quota (qy = cy - r - 18, cioe'
   * quando 0.15 r >= 18, r >= 120), la quota con l'asse verticale: 5 o 6 incontri secondo il foglio.
   */
  function expected(x: number, y: number, w: number, h: number): Pt[] {
    const cx = x + w / 2;
    const cy = y + h * 0.58;
    const r = Math.min(w, h) * 0.27;
    const qy = cy - r - 18;
    const ry = y + 62;
    const rx = x + 28;
    const out = [
      { x: cx, y: cy }, // gli assi (si incrociano nei loro punti medi)
      { x: cx - r, y: qy }, // la quota e la sua tacca sinistra
      { x: cx + r, y: qy }, // la quota e la sua tacca destra
      { x: rx, y: ry }, // il riferimento e la sua tacca sinistra
      { x: rx + 100 * MM, y: ry }, // il riferimento e la sua tacca destra
    ];
    if (r >= 120) out.push({ x: cx, y: qy }); // la quota e l'asse verticale (A4, A3 e A4 ruotata; non il foglio ritagliato, dove r = 108)
    return out;
  }
  for (const [file, box] of [
    ['a4-vettoriale.pdf', [0, 0, 595.276, 841.89]],
    ['a3-vettoriale.pdf', [0, 0, 1190.551, 841.89]],
    ['a4-rotate90.pdf', [0, 0, 595.276, 841.89]],
    ['a4-cropbox.pdf', [50, 50, 400, 550]],
  ] as [string, [number, number, number, number]][]) {
    it(`${file}: le Intersezioni, ognuna nel punto calcolato e portato nel foglio da PDF.js; nessun'altra`, async () => {
      const p = await readPage(await loadTestPdf(file));
      const pts = allIntersections(p);
      const want = expected(...box).map((u) => p.toSheet(u.x, u.y));
      expect(pts).toHaveLength(want.length); // 6 per A4, A3 e A4 ruotata; 5 per il foglio ritagliato
      expect(want.length).toBe(file === 'a4-cropbox.pdf' ? 5 : 6);
      for (const w of want) {
        const hit = pts.filter((q) => Math.hypot(q.x - w.x, q.y - w.y) < TOL);
        expect(hit, `atteso (${w.x.toFixed(3)}, ${w.y.toFixed(3)})`).toHaveLength(1);
      }
    });
  }
});

describe('stato della pagina (loadPdfSnap): scena dei tratti, tetto, messaggi, registro', () => {
  const noYield = async (): Promise<void> => undefined;
  async function stateOf(bytes: Uint8Array, deps: Parameters<typeof loadPdfSnap>[3] = {}): Promise<PdfSnapState> {
    const doc = await open(bytes);
    const pg = await doc.getPage(1);
    const sheet = new PageGeometry({ view: pg.view as [number, number, number, number], rotate: pg.rotate, userUnit: pg.userUnit });
    return loadPdfSnap(doc, 1, sheet, { yieldToUi: noYield, ...deps });
  }
  const ready = (s: PdfSnapState): Extract<PdfSnapState, { kind: 'ready' }> => {
    if (s.kind !== 'ready') throw new Error(`stato ${s.kind}`);
    return s;
  };

  it('a4-vettoriale.pdf: pronto con la scena di 12 tratti, il tempo della scena e i punti di prima (44 Estremi e 11 Punti medi) invariati', async () => {
    const s = ready(await stateOf(await loadTestPdf('a4-vettoriale.pdf')));
    expect(s.segments).toBe(12);
    expect(s.nEnd).toBe(44);
    expect(s.nMid).toBe(11);
    expect(s.sceneStats).toMatchObject({ segments: 12, kept: 12, hidden: 0, tiny: 0, outside: 0, clipped: 0, dense: false });
    expect(s.scene?.n).toBe(12);
    expect(s.sceneStats!.bytes).toBe(s.scene!.bytes);
    expect(s.sceneStats!.cellPt).toBe(8);
    expect(s.timings.sceneMs).toBeGreaterThanOrEqual(0);
    expect(pdfSnapNote(s, 1)).toBeNull(); // niente da dire
    const line = pdfSnapLogLine(s, 1);
    expect(line).toContain('scena dei tratti: 12 tratti');
    expect(line).toMatch(/celle da 8 pt, \d+ voci, 0\.0\d MB, \d+ ms/);
    expect(line).not.toMatch(/a4-vettoriale/); // mai il nome del file
  });
  it('sopra il tetto delle voci: la scena e\' spenta, Estremo e Punto medio restano, il messaggio e il registro lo dicono (una frase, senza il nome del file)', async () => {
    const s = ready(await stateOf(await loadTestPdf('a4-vettoriale.pdf'), { maxSceneRefs: 5 }));
    expect(s.sceneStats).toMatchObject({ dense: true, kept: 12, maxRefs: 5, cellPt: 0, bytes: 0 });
    expect(s.sceneStats!.refs).toBeGreaterThan(5);
    expect(s.scene).toBeUndefined();
    expect(s.nEnd).toBe(44); // i punti ci sono ancora
    const note = pdfSnapNote(s, 1)!;
    expect(note).toMatch(/^Pagina 1: troppi tratti lunghi e fitti per l'Intersezione e la Perpendicolare sul PDF/);
    expect(note).toContain("l'Estremo e il Punto medio del PDF restano");
    expect(note).toContain('Gli oggetti disegnati si agganciano come sempre.');
    expect(pdfSnapLogLine(s, 1)).toContain('scena dei tratti: spenta (12 tratti');
  });
  it('una pagina di sole curve: pronta con i punti delle curve e SENZA scena (nessun tratto da confrontare)', async () => {
    const s = ready(await stateOf(await makePdf({ content: '100 100 m 140 100 140 140 100 140 c 60 140 60 100 100 100 c S', mediabox: [300, 300] })));
    expect(s.segments).toBe(0);
    expect(s.curves).toBe(2);
    expect(s.scene).toBeUndefined();
    expect(s.sceneStats).toBeUndefined();
    expect(s.timings.sceneMs).toBeUndefined();
    expect(pdfSnapLogLine(s, 1)).not.toContain('scena dei tratti');
  });
  it('troncata, non disponibile, assente: nessuna scena e nessuna eccezione', async () => {
    const bytes = await makePdf({ content: '10 10 m 100 100 l S\n10 20 m 100 200 l S', mediabox: [300, 300] });
    const trunc = await stateOf(bytes, { maxCoords: 4 });
    expect(trunc.kind).toBe('truncated');
    expect('scene' in trunc).toBe(false);
    const bad = await stateOf(bytes, { ops: {} });
    expect(bad.kind).toBe('unavailable');
    expect('scene' in bad).toBe(false);
    const absent = await stateOf(await makePdf({ content: '0.5 g 10 10 100 100 re f', mediabox: [300, 300] }));
    expect(absent.kind).toBe('absent');
    expect('scene' in absent).toBe(false);
    // l'app passa `pdfSegments: null` quando lo stato non e' pronto o la scena manca: nessun candidato e nessuna eccezione
    expect(findSnap([], new PageGeometry({ view: [0, 0, 300, 300], rotate: 0, userUnit: 1 }), { x: 50, y: 50 }, 10, { intersection: true, perpendicular: true }, [], { pdfSegments: null, anchor: { x: 1, y: 1 } })).toBeNull();
  });
  it('una pagina con un tratto che esce dal foglio: ritagliato nella scena (stats.clipped), uno tutto fuori no (stats.outside)', async () => {
    const s = ready(await stateOf(await makePdf({ content: '-100 100 m 400 100 l S\n-50 -50 m -10 -10 l S\n10 10 m 50 50 l S', mediabox: [300, 300] })));
    expect(s.sceneStats).toMatchObject({ segments: 3, kept: 2, clipped: 1, outside: 1 });
  });
});
