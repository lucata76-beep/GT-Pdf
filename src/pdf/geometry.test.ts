// Prove unitarie dell'estrattore (src/pdf/geometry.ts) in Node, con la build LEGACY di PDF.js (quella dell'app: src/pdf/loader.ts).
// I PDF sintetici sono generati qui con @cantoo/pdf-lib (operatori scritti a mano) e letti con PDF.js, un altro lettore: i valori attesi si calcolano QUI con un
// calcolo indipendente dal codice dell'estrattore. Tolleranza sulle coordinate: 1e-4 pt (PDF.js tiene i percorsi in Float32: errore misurato 1.5e-5 pt su A4).
// Niente file nuovi in public/: i 7 PDF di prova sono quelli di public/test-pdfs.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BYTES_PER_CUBIC,
  BYTES_PER_LINE,
  CIRCLE_TOL_ABS,
  DEFAULT_MAX_COORDS,
  DRAW_CLOSE,
  DRAW_CURVE_TO,
  DRAW_LINE_TO,
  DRAW_MOVE_TO,
  DRAW_QUAD_TO,
  type ExtractResult,
  type GeometryStats,
  type PdfGeometry,
  circleFrom4Cubics,
  cubicBucket,
  extractGeometry,
  lengthBucket,
} from './geometry';
import { makePdf } from './geometryTestUtils';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
/** I 7 PDF di public/test-pdfs. Il progetto non ha i tipi di Node (nessun @types/node): il modulo si carica con un nome in variabile (come src/geometry/snap.test.ts). */
async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}
const TOL = 1e-4;
const near = (a: number, b: number, tol = TOL): boolean => Math.abs(a - b) <= tol;
const MM = 72 / 25.4;
const A4: [number, number] = [595.276, 841.89];
const A3L: [number, number] = [1190.551, 841.89];

// ------------------------------------------------------------------ lettura con PDF.js
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
interface Read {
  doc: PDFDocumentProxy;
  fn: number[];
  args: unknown[];
  isVisible: (d: unknown) => boolean;
  res: ExtractResult;
}
async function read(bytes: Uint8Array, pageNo = 1, getOpts: Record<string, unknown> = {}, maxCoords?: number): Promise<Read> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  const doc = await task.promise;
  const page = await doc.getPage(pageNo);
  const ol = await page.getOperatorList(getOpts);
  const cfg = await doc.getOptionalContentConfig();
  const isVisible = (d: unknown): boolean => cfg.isVisible(d as never);
  const res = extractGeometry({ fnArray: ol.fnArray, argsArray: ol.argsArray, ops: OPS, isLayerVisible: isVisible, maxCoords });
  return { doc, fn: ol.fnArray, args: ol.argsArray, isVisible, res };
}
function must(r: ExtractResult): { geometry: PdfGeometry; stats: GeometryStats } {
  if (!r.ok) throw new Error(`estrazione fallita: ${r.reason}`);
  return r;
}
type Seg = [number, number, number, number];
const lines = (g: PdfGeometry): Seg[] => Array.from({ length: g.nLines }, (_, i) => [g.lineXY[i * 4]!, g.lineXY[i * 4 + 1]!, g.lineXY[i * 4 + 2]!, g.lineXY[i * 4 + 3]!]);
const cubics = (g: PdfGeometry): number[][] => Array.from({ length: g.nCubics }, (_, i) => Array.from(g.cubicXY.subarray(i * 8, i * 8 + 8)));
const segNear = (a: Seg, b: Seg, tol = TOL): boolean => a.every((v, i) => near(v, b[i]!, tol));
function expectLines(got: Seg[], want: Seg[], tol = TOL): void {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => expect(segNear(got[i]!, w, tol), `segmento ${i}: letto ${JSON.stringify(got[i])}, atteso ${JSON.stringify(w)}`).toBe(true));
}
/** Punto trasformato da una matrice [a b c d e f] (formula indipendente dall'estrattore). */
const ap = (m: number[], p: [number, number]): [number, number] => [m[0]! * p[0] + m[2]! * p[1] + m[4]!, m[1]! * p[0] + m[3]! * p[1] + m[5]!];
const f6 = (n: number): string => n.toFixed(10);

// ------------------------------------------------------------------ elenchi finti (per i casi che PDF.js non produce o scarta)
type Op = [string, unknown];
const path = (paint: string, cmds: number[]): Op => ['constructPath', [OPS[paint], [cmds], null]];
const fake = (list: Op[], over: { visible?: (d: unknown) => boolean; maxCoords?: number; ops?: Record<string, number> } = {}): ExtractResult =>
  extractGeometry({
    fnArray: list.map(([n]) => (over.ops ?? OPS)[n] as number),
    argsArray: list.map(([, a]) => a),
    ops: over.ops ?? OPS,
    isLayerVisible: over.visible ?? (() => true),
    maxCoords: over.maxCoords,
  });
const M = (x: number, y: number): number[] => [DRAW_MOVE_TO, x, y];
const Lt = (x: number, y: number): number[] => [DRAW_LINE_TO, x, y];
const C = (a: number, b: number, c: number, d: number, e: number, f: number): number[] => [DRAW_CURVE_TO, a, b, c, d, e, f];
const Q = (a: number, b: number, c: number, d: number): number[] => [DRAW_QUAD_TO, a, b, c, d];
const Z: number[] = [DRAW_CLOSE];
const cat = (...p: number[][]): number[] => p.flat();
const KAPPA = 0.5522847498307936;
/** Cerchio di centro (cx, cy) e raggio r in 4 cubiche da 90 gradi (come pdf-lib). `ccw = false` lo scrive in senso orario. */
function circle(cx: number, cy: number, r: number, opts: { ccw?: boolean; kappa?: number; close?: boolean } = {}): number[] {
  const k = (opts.kappa ?? KAPPA) * r;
  const s = opts.ccw === false ? -1 : 1;
  const cs = [1, 0, -1, 0]; // cos e sin dei multipli di 90 gradi, esatti
  const sn = [0, 1, 0, -1];
  const pt = (i: number): [number, number] => [cx + r * cs[i % 4]!, cy + s * r * sn[i % 4]!];
  const tg = (i: number): [number, number] => [-sn[i % 4]!, s * cs[i % 4]!]; // direzione della tangente al crescere dell'angolo
  const out = [...M(...pt(0))];
  for (let i = 0; i < 4; i++) {
    const p0 = pt(i);
    const p1 = pt(i + 1);
    const t0 = tg(i);
    const t1 = tg(i + 1);
    out.push(...C(p0[0] + k * t0[0], p0[1] + k * t0[1], p1[0] - k * t1[0], p1[1] - k * t1[1], p1[0], p1[1]));
  }
  if (opts.close !== false) out.push(...Z);
  return out;
}

const fixMsg = (what: string): string => `Il formato dell'elenco di operazioni di PDF.js e' cambiato (${what}): aggiornare src/pdf/geometry.ts`;

// ====================================================================================================================================
describe('sentinella: il formato di PDF.js e i codici copiati (se fallisce: aggiornare src/pdf/geometry.ts)', () => {
  const fix = fixMsg;

  it("un PDF minimo con un percorso noto dà esattamente i codici attesi e la forma degli argomenti di constructPath", async () => {
    const r = await read(await makePdf({ content: '10 20 m 30 40 l 50 60 70 80 90 100 c h S' }));
    expect(r.fn.length, fix("il percorso minimo non e' piu' una sola operazione")).toBe(1);
    expect(r.fn[0], fix('codice di OPS.constructPath')).toBe(91);
    expect(OPS['constructPath'], fix('codice di OPS.constructPath')).toBe(91);
    expect(OPS['stroke'], fix('codice di OPS.stroke')).toBe(20);
    expect(OPS['endPath'], fix('codice di OPS.endPath')).toBe(28);
    const a = r.args[0] as unknown[];
    expect(Array.isArray(a) && a.length === 3, fix('constructPath non ha piu\' tre argomenti')).toBe(true);
    expect(a[0], fix('il primo argomento non e\' il codice di pittura (20 = stroke)')).toBe(20);
    expect(Array.isArray(a[1]) && (a[1] as unknown[]).length === 1 && (a[1] as unknown[])[0] instanceof Float32Array, fix('il secondo argomento non e\' [Float32Array]')).toBe(true);
    expect(a[2] instanceof Float32Array && (a[2] as Float32Array).length === 4, fix('il terzo argomento non e\' un riquadro Float32Array di 4 numeri')).toBe(true);
    const buf = Array.from((a[1] as Float32Array[])[0]!);
    // 0 moveTo, 1 lineTo, 2 curva cubica, 4 closePath: i cinque codici DrawOPS (non esportati da PDF.js)
    expect(buf, fix('i codici DrawOPS 0 moveTo, 1 lineTo, 2 curveTo, 4 closePath non sono piu\' questi')).toEqual([0, 10, 20, 1, 30, 40, 2, 50, 60, 70, 80, 90, 100, 4]);
    expect([DRAW_MOVE_TO, DRAW_LINE_TO, DRAW_CURVE_TO, DRAW_QUAD_TO, DRAW_CLOSE], fix('le costanti DrawOPS copiate in src/pdf/geometry.ts non sono piu\' 0, 1, 2, 3, 4')).toEqual([0, 1, 2, 3, 4]);
    const g = must(r.res);
    expect(g.stats.paths).toBe(1);
    expect(g.stats.byPaint.stroke).toBe(1);
    expect(g.stats.all.close).toBe(1);
    expect(g.geometry.nLines).toBe(2); // lineTo e chiusura
    expect(g.geometry.nCubics).toBe(1);
  });

  it('percorso vuoto: [codice, [null], null]', async () => {
    const r = await read(await makePdf({ content: 'S 1 1 m 2 2 l S' }));
    const a = r.args[0] as unknown[];
    if (r.fn[0] === OPS['constructPath']) {
      expect(a[1], fix("il percorso vuoto non e' piu' [null]")).toEqual([null]);
      expect(a[2], fix("il percorso vuoto non ha piu' il riquadro null")).toBeNull();
    }
    const g = must(r.res);
    expect(g.stats.paths + g.stats.emptyPaths).toBe(g.stats.ops.constructPath);
  });

  it('percorso senza dati in un PDF vero: S da solo e n da solo diventano [codice, [null], null] e sono contati a parte', async () => {
    const r = await read(await makePdf({ content: 'S\n1 1 m 2 2 l S\nn' }));
    const paths = r.fn.map((f, i) => [f, r.args[i] as unknown[]] as const).filter(([f]) => f === OPS['constructPath']);
    expect(paths.map(([, a]) => [a[0], a[1] instanceof Array && (a[1] as unknown[])[0] === null, a[2]]), fixMsg("il percorso vuoto non e' piu' [codice, [null], null]")).toEqual([
      [20, true, null],
      [20, false, expect.anything()],
      [28, true, null],
    ]);
    const g = must(r.res);
    expect(g.stats.emptyPaths).toBe(2);
    expect(g.stats.paths).toBe(1);
    expect(g.stats.ops.constructPath).toBe(3);
  });

  it("DrawOPS non e' esportata da PDF.js (se un giorno lo fosse, deve avere gli stessi valori)", () => {
    const exported = (pdfjs as unknown as Record<string, unknown>)['DrawOPS'] as Record<string, number> | undefined;
    if (exported) expect(exported, fix('DrawOPS ora e\' esportata: si possono togliere le costanti copiate')).toEqual({ moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 });
  });

  it('la vecchia forma [[operatori], argomenti] risponde { ok: false } con un motivo leggibile', () => {
    const old = extractGeometry({ fnArray: [OPS['constructPath']!], argsArray: [[[OPS['moveTo']!, OPS['lineTo']!], [0, 0, 10, 10], [0, 0, 10, 10]]], ops: OPS, isLayerVisible: () => true });
    expect(old.ok).toBe(false);
    if (!old.ok) {
      expect(old.reason).toContain('aggiornare src/pdf/geometry.ts');
      expect(old.reason).toContain('constructPath');
    }
  });

  it('codice di comando sconosciuto, comando troncato, codice di pittura sconosciuto, argomenti di forma diversa: { ok: false }', () => {
    const cases: [string, ExtractResult][] = [
      ['comando 9', fake([path('stroke', [...M(0, 0), 9, 1, 1])])],
      ['comando troncato', fake([path('stroke', [...M(0, 0), DRAW_LINE_TO, 1])])],
      ['pittura 999', fake([['constructPath', [999, [M(0, 0)], null]]])],
      ['due argomenti', fake([['constructPath', [OPS['stroke'], [M(0, 0)]]]])],
      ['secondo argomento non e\' un array', fake([['constructPath', [OPS['stroke'], new Float32Array(3), null]]])],
      ['due percorsi in un\'operazione', fake([['constructPath', [OPS['stroke'], [M(0, 0), M(1, 1)], null]]])],
      ['dati non numerici', fake([['constructPath', [OPS['stroke'], ['abc'], null]]])],
      ['valore non numerico nel percorso', fake([path('stroke', [DRAW_MOVE_TO, 0, 'x' as unknown as number])])],
      ['argomenti non array', fake([['constructPath', undefined]])],
      ['transform non e\' una matrice', fake([['transform', [1, 0, 0]]])],
      ['transform con una stringa', fake([['transform', [1, 0, 0, 1, 0, 'x']]])],
      ['beginMarkedContentProps senza tag', fake([['beginMarkedContentProps', [5, null]]])],
      ['beginAnnotation senza matrici', fake([['beginAnnotation', ['id', [0, 0, 1, 1]]]])],
      ['paintFormXObjectBegin senza array', fake([['paintFormXObjectBegin', null]])],
      ['paintFormXObjectBegin con matrice di 3 numeri', fake([['paintFormXObjectBegin', [[1, 2, 3], null]]])],
    ];
    for (const [name, r] of cases) {
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason, name).toContain('aggiornare src/pdf/geometry.ts');
    }
  });

  it("una versione di PDF.js senza uno dei nomi di OPS usati risponde { ok: false } e non lancia", () => {
    const { constructPath, ...without } = OPS;
    void constructPath;
    const r = extractGeometry({ fnArray: [], argsArray: [], ops: without, isLayerVisible: () => true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('OPS.constructPath');
    const r2 = extractGeometry({ fnArray: [1, 2], argsArray: [], ops: OPS, isLayerVisible: () => true });
    expect(r2.ok).toBe(false);
  });

  it('non lancia mai: ingressi inattesi danno { ok: false }', () => {
    const cases: unknown[] = [null, undefined, 5, { fnArray: null }, { fnArray: [1], argsArray: [1], ops: null }, { fnArray: [OPS['constructPath']], argsArray: [{ get length(): number { throw new Error('x'); } }], ops: OPS }];
    for (const c of cases) {
      let r: ExtractResult | undefined;
      expect(() => {
        r = extractGeometry(c as never);
      }).not.toThrow();
      expect(r?.ok).toBe(false);
    }
    const t = fake([['transform', [1, 0, 0, 1, 0, 0]], ['beginMarkedContentProps', ['OC', { type: 'OCG', id: 'x' }]], path('stroke', cat(M(0, 0), Lt(1, 1)))], {
      visible: () => {
        throw new Error('boom');
      },
    });
    const ok = must(t);
    expect(ok.stats.layers.ocErrors).toBe(1); // l'errore di isLayerVisible non butta via la misura: il marcatore conta come visibile
    expect(ok.geometry.pathVisible[0]).toBe(1);
  });

  it('operazioni sconosciute e non geometriche sono ignorate', () => {
    const r = must(fake([['setFont', ['f', 12]], ['showText', [[]]], ['paintImageXObject', ['img', 1, 1]], path('stroke', cat(M(0, 0), Lt(5, 0)))]));
    expect(r.stats.ops.total).toBe(4);
    expect(r.stats.paths).toBe(1);
  });
});

// ====================================================================================================================================
describe('coordinate nello spazio utente (confronto con un calcolo indipendente, 1e-4 pt)', () => {
  it('matrice con rotazione, scala e traslazione dentro q ... cm ... Q annidati', async () => {
    const th = (30 * Math.PI) / 180;
    const m1 = [2, 0, 0, 3, 10, 20]; // scala e traslazione
    const m2 = [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th), 5, 7]; // rotazione di 30 gradi e traslazione
    const content = `q ${m1.map(f6).join(' ')} cm q ${m2.map(f6).join(' ')} cm 0 0 m 100 0 l 100 50 l S Q 5 5 m 8 9 l S Q 1 1 m 2 2 l S`;
    const r = must((await read(await makePdf({ content }))).res);
    const local = (p: [number, number]): [number, number] => ap(m1, ap(m2, p)); // prima m2, poi m1
    const [a, b, c] = [local([0, 0]), local([100, 0]), local([100, 50])];
    expectLines(lines(r.geometry), [
      [a[0], a[1], b[0], b[1]],
      [b[0], b[1], c[0], c[1]],
      [...ap(m1, [5, 5]), ...ap(m1, [8, 9])] as Seg, // dopo Q resta solo m1
      [1, 1, 2, 2], // dopo il secondo Q, identita'
    ]);
    expect(r.stats.cand.paths).toBe(3);
  });

  it('form XObject con matrice, anche annidata', async () => {
    const outer = [1, 0, 0, 1, 100, 200];
    const f1 = [0, 1, -1, 0, 3, 4]; // rotazione di 90 gradi
    const f2 = [2, 0, 0, 2, 1, 1];
    const bytes = await makePdf({
      content: `q ${outer.join(' ')} cm /F1 Do Q 7 7 m 8 8 l S`,
      forms: {
        F2: { content: '0 0 m 10 0 l 10 5 l S', matrix: f2 },
        F1: { content: '0 0 m 1 0 l S q 1 0 0 1 20 30 cm /F2 Do Q', matrix: f1, uses: { F2: 'F2' } },
      },
    });
    const r = must((await read(bytes)).res);
    const toUser = (p: [number, number]): [number, number] => ap(outer, ap(f1, p));
    const f2User = (p: [number, number]): [number, number] => ap(outer, ap(f1, ap([1, 0, 0, 1, 20, 30], ap(f2, p))));
    const a0 = toUser([0, 0]);
    const a1 = toUser([1, 0]);
    const b0 = f2User([0, 0]);
    const b1 = f2User([10, 0]);
    const b2 = f2User([10, 5]);
    expectLines(lines(r.geometry), [
      [a0[0], a0[1], a1[0], a1[1]],
      [b0[0], b0[1], b1[0], b1[1]],
      [b1[0], b1[1], b2[0], b2[1]],
      [7, 7, 8, 8], // dopo la form la matrice e' tornata come prima
    ]);
    expect(r.stats.ops.forms).toBe(2);
  });

  it('re con larghezza e altezza negative; re di larghezza o altezza 0', async () => {
    const r = must((await read(await makePdf({ content: '100 100 -30 -20 re S 5 5 0 10 re S 20 20 10 0 re S' }))).res);
    expectLines(lines(r.geometry), [
      [100, 100, 70, 100],
      [70, 100, 70, 80],
      [70, 80, 100, 80],
      [100, 80, 100, 100], // il segmento di chiusura conta come segmento
      [5, 5, 5, 15],
      [5, 15, 5, 5], // re con larghezza 0: moveTo, lineTo, closePath
      [20, 20, 30, 20],
      [30, 20, 20, 20],
    ]);
    expect(r.stats.all.lineTo).toBe(3 + 1 + 1);
    expect(r.stats.all.close).toBe(3);
    expect(r.stats.all.closeSegments).toBe(3); // tutti e tre chiudono con un segmento (anche i re larghi o alti 0: moveTo, lineTo, closePath)
    expect(r.stats.all.closeNoSegment).toBe(0);
  });

  it('v e y arrivano come cubiche; la chiusura aggiunge un segmento rettilineo', async () => {
    const r = must((await read(await makePdf({ content: '0 0 m 10 10 20 20 30 0 c 40 10 50 0 v 60 10 70 0 y h S' }))).res);
    expect(cubics(r.geometry).map((c) => c.map((v) => Math.round(v * 1e4) / 1e4))).toEqual([
      [0, 0, 10, 10, 20, 20, 30, 0],
      [30, 0, 30, 0, 40, 10, 50, 0], // v: il primo punto di controllo e' il punto corrente
      [50, 0, 60, 10, 70, 0, 70, 0], // y: il secondo punto di controllo e' il punto finale
    ]);
    expectLines(lines(r.geometry), [[70, 0, 0, 0]]);
    expect(r.stats.all.cubic).toBe(3);
    expect(r.stats.all.closeSegments).toBe(1);
  });

  it('ritaglio W n: non entra fra i tratti ma conta come endPath', async () => {
    const r = must((await read(await makePdf({ content: '0 0 10 10 re W n 20 20 m 30 30 l S' }))).res);
    expect(r.stats.byPaint).toEqual({ stroke: 1, fill: 0, fillStroke: 0, endPath: 1 });
    expect(r.stats.all.paths).toBe(2);
    expect(r.stats.cand.paths).toBe(1);
    expectLines(lines(r.geometry), [[20, 20, 30, 30]]);
  });

  it('tratteggio: un solo tratto (il tratteggio sta in setDash)', async () => {
    const r = must((await read(await makePdf({ content: '[3 2] 0 d 0 0 m 100 0 l S' }))).res);
    expectLines(lines(r.geometry), [[0, 0, 100, 0]]);
    expect(r.stats.cand.paths).toBe(1);
  });

  it('tipi di pittura: stroke, fill, fillStroke (e le varianti con chiusura e eo)', async () => {
    const content = ['0 0 m 1 1 l S', '0 0 m 1 1 l 1 0 l s', '0 0 m 1 1 l 1 0 l f', '0 0 m 1 1 l 1 0 l f*', '0 0 m 1 1 l 1 0 l B', '0 0 m 1 1 l 1 0 l B*', '0 0 m 1 1 l 1 0 l b', '0 0 m 1 1 l 1 0 l b*', '0 0 5 5 re n'].join('\n');
    const r = must((await read(await makePdf({ content }))).res);
    expect(r.stats.byPaint).toEqual({ stroke: 2, fill: 2, fillStroke: 4, endPath: 1 });
    expect(r.stats.all.paths).toBe(9);
    expect(r.stats.cand.paths).toBe(6);
    expect(r.geometry.nPaths).toBe(6);
    expect(Array.from(r.geometry.pathPaint)).toEqual([1, 1, 2, 2, 2, 2]);
    // chiusure: s, b e b* aggiungono un closePath
    expect(r.stats.all.close).toBe(3 + 1 /* il re */);
  });

  it('rotazione della pagina: le coordinate restano nello spazio utente (a4-rotate90 uguale a a4-vettoriale)', async () => {
    const content = '10 10 m 100 10 l 100 50 l S';
    const a = must((await read(await makePdf({ content, rotate: 0 }))).res);
    const b = must((await read(await makePdf({ content, rotate: 90 }))).res);
    expect(Array.from(b.geometry.lineXY)).toEqual(Array.from(a.geometry.lineXY));
  });

  it('percorso senza punto corrente (lineTo senza moveTo): inizia dal punto indicato, come il canvas', () => {
    const r = must(fake([path('stroke', cat(Lt(3, 3), Lt(5, 3), Lt(5, 8)))]));
    expect(r.stats.noCurrentPoint).toBe(1);
    expectLines(lines(r.geometry), [
      [3, 3, 5, 3],
      [5, 3, 5, 8],
    ]);
    expect(r.stats.all.subpaths).toBe(1);
  });

  it('dopo closePath un lineTo continua dal primo punto, in un nuovo sottopercorso', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), Lt(10, 0), Lt(10, 10), Z, Lt(20, 20)))]));
    expect(r.stats.all.subpaths).toBe(2);
    expectLines(lines(r.geometry), [
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 0],
      [0, 0, 20, 20],
    ]);
  });

  it('quadratica: contata come quadratica e memorizzata come cubica esatta', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), Q(30, 60, 60, 0)))]));
    expect(r.stats.all.quad).toBe(1);
    expect(r.stats.all.cubic).toBe(0);
    expect(cubics(r.geometry)).toEqual([[0, 0, 20, 40, 40, 40, 60, 0]]);
  });

  it('coordinate non finite: percorso contato a parte e non letto', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), Lt(NaN, 1))), path('stroke', cat(M(0, 0), Lt(Infinity, 1))), path('stroke', cat(M(0, 0), Lt(1, 1))), ['transform', [NaN, 0, 0, 1, 0, 0]], path('stroke', cat(M(0, 0), Lt(1, 1)))]));
    expect(r.stats.nonFinitePaths).toBe(3);
    expect(r.stats.paths).toBe(1);
    expect(r.geometry.nLines).toBe(1);
    expect(r.stats.cand.paths).toBe(1);
  });

  it('save e restore: un restore senza save e\' tollerato e contato', () => {
    const r = must(fake([['restore', null], ['save', null], ['transform', [1, 0, 0, 1, 10, 0]], path('stroke', cat(M(0, 0), Lt(1, 0))), ['restore', null], path('stroke', cat(M(0, 0), Lt(1, 0)))]));
    expect(r.stats.restoreUnderflow).toBe(1);
    expectLines(lines(r.geometry), [
      [10, 0, 11, 0],
      [0, 0, 1, 0],
    ]);
  });
});

// ====================================================================================================================================
describe('livelli (contenuto opzionale)', () => {
  const ocgs = [
    { key: 'Loff', name: 'spento', on: false },
    { key: 'Lon', name: 'acceso', on: true },
  ];
  const p = (n: number): string => `${n} ${n} m ${n + 1} ${n + 1} l S`;

  it('livello spento e acceso, anche annidati: spento dentro acceso, acceso dentro spento, BMC dentro BDC /OC', async () => {
    const content = [
      '/OC /Loff BDC', p(1), '/OC /Lon BDC', p(2), 'EMC', '/Foo BMC', p(3), 'EMC', 'EMC',
      '/OC /Lon BDC', p(4), '/OC /Loff BDC', p(5), 'EMC', '/Span <</MCID 3>> BDC', p(6), 'EMC', 'EMC',
      p(7),
    ].join('\n');
    const { res, doc } = await read(await makePdf({ content, ocgs }));
    const r = must(res);
    // p1 spento; p2 acceso dentro spento = spento; p3 BMC dentro spento = spento; p4 acceso; p5 spento dentro acceso; p6 BDC non-OC dentro acceso = visibile; p7 fuori
    expect(Array.from(r.geometry.pathVisible)).toEqual([0, 0, 0, 1, 0, 1, 1]);
    const L = r.stats.layers;
    expect(L.ocMarkers).toBe(4);
    expect(L.ocgMarkers).toBe(4);
    expect(L.ocmdMarkers).toBe(0);
    expect(L.maxDepth).toBe(2);
    expect(L.hiddenPaths).toBe(4);
    expect(L.hiddenCandidatePaths).toBe(4);
    expect(L.hiddenCandidateSegments).toBe(4);
    expect(L.unclosedMarkers).toBe(0);
    expect(L.emcUnderflow).toBe(0);
    const cfg = await doc.getOptionalContentConfig();
    expect([...cfg].length).toBe(2); // gruppi OCG del documento
    expect([...cfg].filter(([, g]) => !g.visible).length).toBe(1); // spenti nella configurazione predefinita
  });

  it('OCMD: contati e valutati con isVisible (AllOn con un gruppo spento = spento; AnyOn = acceso)', async () => {
    const content = ['/OC /Mall BDC', p(1), 'EMC', '/OC /Many BDC', p(2), 'EMC', '/OC /Mnoff BDC', p(3), 'EMC'].join('\n');
    const { res } = await read(
      await makePdf({
        content,
        ocgs,
        ocmds: [
          { key: 'Mall', groups: ['Loff', 'Lon'], policy: 'AllOn' },
          { key: 'Many', groups: ['Loff', 'Lon'], policy: 'AnyOn' },
          { key: 'Mnoff', groups: ['Loff', 'Lon'], policy: 'AllOff' },
        ],
      }),
    );
    const r = must(res);
    // AllOn(spento, acceso) = falso; AnyOn = vero; AllOff(spento, acceso) = falso
    expect(Array.from(r.geometry.pathVisible)).toEqual([0, 1, 0]);
    expect(r.stats.layers.ocmdMarkers).toBe(3);
    expect(r.stats.layers.ocmdHidden).toBe(2);
  });

  it('OCMD con espressione di visibilita\' (/VE): And(acceso, Not(spento)) visibile, And(spento, acceso) spento', async () => {
    const content = ['/OC /V1 BDC', p(1), 'EMC', '/OC /V2 BDC', p(2), 'EMC', '/OC /V3 BDC', p(3), 'EMC'].join('\n');
    const { res } = await read(
      await makePdf({
        content,
        ocgs,
        ocmds: [
          { key: 'V1', ve: ['And', 'Lon', ['Not', 'Loff']] },
          { key: 'V2', ve: ['And', 'Loff', 'Lon'] },
          { key: 'V3', ve: ['Or', 'Loff', 'Lon'] },
        ],
      }),
    );
    const r = must(res);
    expect(Array.from(r.geometry.pathVisible)).toEqual([1, 0, 1]);
    expect(r.stats.layers.ocmdMarkers).toBe(3);
    expect(r.stats.layers.ocmdHidden).toBe(1);
  });

  it('marcatore /OC con una proprieta\' che non esiste: PDF.js emette dati null (provato su un PDF vero), visibile e contato', async () => {
    const real = await read(await makePdf({ content: `/OC /Nope BDC ${p(1)} EMC`, ocgs }));
    const i = real.fn.indexOf(OPS['beginMarkedContentProps']!);
    expect(real.args[i]).toEqual(['OC', null]);
    const r = must(real.res);
    expect(r.stats.layers.ocNull).toBe(1);
    expect(r.geometry.pathVisible[0]).toBe(1);
  });

  it('marcatori OC con dati null: trattati come visibili e contati', () => {
    const r = must(fake([['beginMarkedContentProps', ['OC', null]], path('stroke', cat(M(0, 0), Lt(1, 1))), ['endMarkedContent', null]], { visible: () => false }));
    expect(r.stats.layers.ocNull).toBe(1);
    expect(r.stats.layers.ocMarkers).toBe(1);
    expect(r.geometry.pathVisible[0]).toBe(1); // come PDF.js: isVisible(null) e' true
  });

  it('endMarkedContent senza apertura: tollerato e contato (PDF.js lo scarta gia\' nei PDF; qui con un elenco finto)', async () => {
    const fk = must(fake([['endMarkedContent', null], path('stroke', cat(M(0, 0), Lt(1, 1))), ['endMarkedContent', null], ['beginMarkedContent', [{ name: 'X' }]], path('stroke', cat(M(2, 2), Lt(3, 3)))]));
    expect(fk.stats.layers.emcUnderflow).toBe(2);
    expect(fk.stats.layers.unclosedMarkers).toBe(1);
    expect(fk.stats.paths).toBe(2);
    // in un PDF vero PDF.js non emette l'EMC di troppo
    const real = await read(await makePdf({ content: `${p(1)} EMC ${p(2)} EMC EMC` }));
    expect(real.fn.includes(OPS['endMarkedContent']!)).toBe(false);
    expect(must(real.res).stats.paths).toBe(2);
  });

  it('marcatore non chiuso a fine pagina: contato; tipo di dati sconosciuto: contato e valutato', () => {
    const r = must(fake([['beginMarkedContentProps', ['OC', { type: 'Altro' }]], path('stroke', cat(M(0, 0), Lt(1, 1)))], { visible: (d) => (d as { type: string }).type !== 'Altro' }));
    expect(r.stats.layers.unclosedMarkers).toBe(1);
    expect(r.stats.layers.ocOther).toBe(1);
    expect(r.geometry.pathVisible[0]).toBe(0);
  });

  it('marcatori non OC (BDC con MCID, BMC): visibili e contano nella profondita\'', () => {
    const r = must(fake([['beginMarkedContent', [{ name: 'A' }]], ['beginMarkedContentProps', ['Span', 3]], ['beginMarkedContentProps', ['P', null]], path('stroke', cat(M(0, 0), Lt(1, 1))), ['endMarkedContent', null], ['endMarkedContent', null], ['endMarkedContent', null]]));
    expect(r.stats.layers.maxDepth).toBe(3);
    expect(r.stats.layers.ocMarkers).toBe(0);
    expect(r.geometry.pathVisible[0]).toBe(1);
  });

  it('percorsi fill dentro un livello spento: contati fra i percorsi spenti ma non fra i candidati', async () => {
    const content = ['/OC /Loff BDC', '0 0 5 5 re f', p(1), '0 0 5 5 re n', 'EMC'].join('\n');
    const r = must((await read(await makePdf({ content, ocgs }))).res);
    expect(r.stats.layers.hiddenPaths).toBe(3);
    expect(r.stats.layers.hiddenCandidatePaths).toBe(1);
  });

  it('form con livello: il contenuto della form eredita la visibilita\' del marcatore', async () => {
    const bytes = await makePdf({
      content: '/OC /Loff BDC /F1 Do EMC /F1 Do',
      ocgs,
      forms: { F1: { content: '0 0 m 1 1 l S' } },
    });
    const r = must((await read(bytes)).res);
    expect(Array.from(r.geometry.pathVisible)).toEqual([0, 1]);
  });
});

// ====================================================================================================================================
describe('annotazioni e scansioni', () => {

  it('annotazioni con l\'impostazione predefinita: 20 percorsi contro 15 con DISABLE; coordinate dell\'annotazione nello spazio utente della pagina', async () => {
    const bytes = await loadTestPdf('a4-annotazioni.pdf');
    const on = must((await read(bytes)).res);
    const off = must((await read(bytes, 1, { annotationMode: pdfjs.AnnotationMode.DISABLE })).res);
    expect(on.stats.paths).toBe(20);
    expect(off.stats.paths).toBe(15);
    expect(on.stats.ops.annotations).toBe(3);
    expect(off.stats.ops.annotations).toBe(0);
    // Timbro: Rect [380 760 550 800], BBox [0 0 170 40], tratto "1 1 168 38 re" nell'aspetto -> (381, 761)-(549, 799) sulla pagina
    const ls = lines(on.geometry);
    const has = (s: Seg): boolean => ls.some((l) => segNear(l, s));
    expect(has([381, 761, 549, 761])).toBe(true);
    expect(has([549, 761, 549, 799])).toBe(true);
    expect(has([549, 799, 381, 799])).toBe(true);
    expect(has([381, 799, 381, 761])).toBe(true);
    // Campo di testo: Rect [27.5 699.5 248.5 724.5]; catena di matrici dell'aspetto: transform (27.5, 699.5), poi (0.5, 24.5) e un ribaltamento in Y;
    // il bordo "0 0 220 24 re" diventa (28, 724)-(248, 724)-(248, 700)-(28, 700) (calcolo a mano, indipendente dall'estrattore)
    expect(has([28, 724, 248, 724])).toBe(true);
    expect(has([248, 724, 248, 700])).toBe(true);
    expect(has([248, 700, 28, 700])).toBe(true);
    expect(has([28, 700, 28, 724])).toBe(true);
  });

  it('scansione: 0 percorsi, una sola operazione immagine (8 operazioni)', async () => {
    const r = must((await read(await loadTestPdf('a4-scansione.pdf'))).res);
    expect(r.stats.paths).toBe(0);
    expect(r.stats.ops.constructPath).toBe(0);
    expect(r.stats.ops.imageOps).toBe(1);
    expect(r.stats.ops.total).toBe(8);
    expect(r.geometry.nLines + r.geometry.nCubics).toBe(0);
  });
});

// ====================================================================================================================================
describe('i 7 PDF di prova (public/test-pdfs): conteggi e coordinate di scripts/make-test-pdfs.mjs', () => {

  /** Geometria attesa di drawSheet() (scripts/make-test-pdfs.mjs) per il rettangolo visibile (x, y, w, h), nell'ordine in cui e' disegnata. */
  function sheet(x: number, y: number, w: number, h: number): { lines: Seg[]; circles: { cx: number; cy: number; r: number }[] } {
    const cx = x + w / 2;
    const cy = y + h * 0.58;
    const r = Math.min(w, h) * 0.27;
    const rw = w - 20;
    const qy = cy - r - 18;
    const ry = y + 62;
    const rx = x + 28;
    const rx2 = rx + 100 * MM;
    return {
      lines: [
        // rettangolo (pdf-lib lo scrive con cm di traslazione e di ribaltamento in Y): parte dall'angolo in alto a sinistra (x + 10, y + h - 10), tre lineTo, chiusura
        [x + 10, y + h - 10, x + 10 + rw, y + h - 10],
        [x + 10 + rw, y + h - 10, x + 10 + rw, y + 10],
        [x + 10 + rw, y + 10, x + 10, y + 10],
        [x + 10, y + 10, x + 10, y + h - 10],
        // assi tratteggiati
        [cx - r * 1.15, cy, cx + r * 1.15, cy],
        [cx, cy - r * 1.15, cx, cy + r * 1.15],
        // quota fittizia
        [cx - r, qy, cx + r, qy],
        [cx - r, qy - 4, cx - r, qy + 4],
        [cx + r, qy - 4, cx + r, qy + 4],
        // riferimento di 100 mm
        [rx, ry, rx2, ry],
        [rx, ry - 6, rx, ry + 6],
        [rx2, ry - 6, rx2, ry + 6],
      ],
      circles: [
        { cx, cy, r },
        { cx, cy, r: r * 0.42 },
        ...[
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map(([dx, dy]) => ({ cx: cx + dx! * r * 0.72, cy: cy + dy! * r * 0.72, r: r * 0.09 })),
      ],
    };
  }
  /** Centro e raggio di un cerchio di 4 cubiche, dai punti di fine (A e C opposti). */
  function circleOf(cs: number[][]): { cx: number; cy: number; r: number } {
    const a = [cs[0]![0]!, cs[0]![1]!];
    const c = [cs[1]![6]!, cs[1]![7]!];
    return { cx: (a[0]! + c[0]!) / 2, cy: (a[1]! + c[1]!) / 2, r: Math.hypot(c[0]! - a[0]!, c[1]! - a[1]!) / 2 };
  }
  function checkSheet(r: { geometry: PdfGeometry; stats: GeometryStats }, box: [number, number, number, number]): void {
    const want = sheet(...box);
    expectLines(lines(r.geometry), want.lines);
    const cs = cubics(r.geometry);
    expect(cs.length).toBe(24);
    want.circles.forEach((w, i) => {
      const got = circleOf(cs.slice(i * 4, i * 4 + 4));
      expect(near(got.cx, w.cx) && near(got.cy, w.cy) && near(got.r, w.r), `cerchio ${i}: letto ${JSON.stringify(got)}, atteso ${JSON.stringify(w)}`).toBe(true);
    });
    // cerchi di pdf-lib: 6 riconosciuti, 4 cubiche chiuse ciascuno
    for (const g of [r.stats.shapesAll, r.stats.shapesCand]) {
      expect(g.circles4).toBe(6);
      expect(g.closedCubicOnly).toEqual([0, 0, 0, 6, 0, 0]);
      expect(g.circles4MaxDev).toBeLessThan(1e-3);
      expect(g.denseClosedPolygons).toBe(0);
      expect(g.cubicsInOpen).toBe(0);
    }
  }
  const SHEET_STATS = { ops: 160, paths: 15, lineTo: 11, cubic: 24, close: 7, showText: 4 };
  function checkSheetCounts(r: { geometry: PdfGeometry; stats: GeometryStats }): void {
    expect(r.stats.ops.total).toBe(SHEET_STATS.ops);
    expect(r.stats.ops.constructPath).toBe(SHEET_STATS.paths);
    expect(r.stats.byPaint).toEqual({ stroke: 15, fill: 0, fillStroke: 0, endPath: 0 });
    expect(r.stats.all.lineTo).toBe(SHEET_STATS.lineTo);
    expect(r.stats.all.cubic).toBe(SHEET_STATS.cubic);
    expect(r.stats.all.quad).toBe(0);
    expect(r.stats.all.close).toBe(SHEET_STATS.close);
    expect(r.stats.ops.showText).toBe(SHEET_STATS.showText);
    expect(r.stats.ops.imageOps).toBe(0);
    expect(r.stats.all.subpaths).toBe(23); // pdf-lib scrive `m` due volte per ogni linea: 8 sottopercorsi di un solo punto
    expect(r.stats.all.emptySubpaths).toBe(8);
    expect(r.stats.cand).toEqual(r.stats.all); // tutti i percorsi sono stroke
    expect(r.stats.nonFinitePaths).toBe(0);
    expect(r.stats.truncated).toBeNull();
    expect(r.stats.layers.ocMarkers).toBe(0);
    expect(r.geometry.nLines).toBe(12);
    expect(r.geometry.nCubics).toBe(24);
  }

  it('a4-vettoriale.pdf', async () => {
    const r = must((await read(await loadTestPdf('a4-vettoriale.pdf'))).res);
    checkSheetCounts(r);
    checkSheet(r, [0, 0, A4[0], A4[1]]);
    // riferimento di 100 mm: 283.46 pt
    const ref = lines(r.geometry)[9]!;
    expect(near(Math.hypot(ref[2] - ref[0], ref[3] - ref[1]), 100 * MM)).toBe(true);
    // byte per segmento
    expect(r.geometry.bytes).toBe(r.geometry.nPaths * 2 + r.geometry.nLines * BYTES_PER_LINE + r.geometry.nCubics * BYTES_PER_CUBIC);
  });
  it('a3-vettoriale.pdf', async () => {
    const r = must((await read(await loadTestPdf('a3-vettoriale.pdf'))).res);
    checkSheetCounts(r);
    checkSheet(r, [0, 0, A3L[0], A3L[1]]);
  });
  it('a4-cropbox.pdf: le coordinate restano nello spazio utente del file (il CropBox non le sposta)', async () => {
    const r = must((await read(await loadTestPdf('a4-cropbox.pdf'))).res);
    checkSheetCounts(r);
    checkSheet(r, [50, 50, 400, 550]);
  });
  it('a4-rotate90.pdf: uguale a a4-vettoriale.pdf in coordinate utente', async () => {
    const a = must((await read(await loadTestPdf('a4-vettoriale.pdf'))).res);
    const b = must((await read(await loadTestPdf('a4-rotate90.pdf'))).res);
    checkSheetCounts(b);
    expect(Array.from(b.geometry.lineXY)).toEqual(Array.from(a.geometry.lineXY));
    expect(Array.from(b.geometry.cubicXY)).toEqual(Array.from(a.geometry.cubicXY));
    expect(b.stats).toEqual(a.stats);
  });
  it('misto-3-pagine.pdf: ogni pagina, con la sua dimensione', async () => {
    const bytes = await loadTestPdf('misto-3-pagine.pdf');
    const boxes: [number, number, number, number][] = [
      [0, 0, A4[0], A4[1]],
      [0, 0, A3L[0], A3L[1]],
      [0, 0, A4[0], A4[1]],
    ];
    for (let n = 1; n <= 3; n++) {
      const r = must((await read(bytes, n)).res);
      checkSheetCounts(r);
      checkSheet(r, boxes[n - 1]!);
    }
  });
  it('a4-annotazioni.pdf: 225 operazioni, 20 percorsi (17 stroke, 2 fillStroke, 1 endPath), 25 lineTo, 24 cubiche, 11 chiusure', async () => {
    const r = must((await read(await loadTestPdf('a4-annotazioni.pdf'))).res);
    expect(r.stats.ops.total).toBe(225);
    expect(r.stats.ops.constructPath).toBe(20);
    expect(r.stats.byPaint).toEqual({ stroke: 17, fill: 0, fillStroke: 2, endPath: 1 });
    expect(r.stats.all.lineTo).toBe(25);
    expect(r.stats.all.cubic).toBe(24);
    expect(r.stats.all.close).toBe(11);
    expect(r.stats.cand.paths).toBe(19); // stroke e fillStroke
    expect(r.stats.ops.showText).toBe(6);
  });
  it('a4-scansione.pdf: 0 percorsi', async () => {
    const r = must((await read(await loadTestPdf('a4-scansione.pdf'))).res);
    expect(r.stats.all.paths).toBe(0);
    expect(r.geometry.nPaths).toBe(0);
  });
});

// ====================================================================================================================================
describe('statistiche (casi a valore noto)', () => {
  it('conte per tipo di operazione: immagini (tutte), showText e varianti, shading, operatori colore con pattern, form, annotazioni', () => {
    const list: Op[] = [
      ['paintImageXObject', ['i', 1, 1]],
      ['paintInlineImageXObject', [{}]],
      ['paintImageMaskXObject', [{}]],
      ['paintSolidColorImageMask', []],
      ['paintImageXObjectRepeat', ['i', 1, 1, 1, 1]],
      ['showText', [[]]],
      ['showText', [[]]],
      ['showSpacedText', [[]]],
      ['nextLineShowText', [[]]],
      ['shadingFill', ['s']],
      ['setFillColorN', ['TilingPattern']],
      ['setFillColorN', ['RadialAxial']],
      ['setStrokeColorN', ['Mesh']],
      ['setFillRGBColor', [1, 2, 3]],
      ['paintFormXObjectBegin', [null, null]],
      ['paintFormXObjectEnd', null],
      ['beginAnnotation', ['a', [0, 0, 1, 1], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], false]],
      ['endAnnotation', null],
      path('stroke', cat(M(0, 0), Lt(1, 1))),
    ];
    const r = must(fake(list));
    expect(r.stats.ops).toEqual({
      total: list.length,
      constructPath: 1,
      imageOps: 5,
      showText: 4,
      shadingFill: 1,
      patternColorOps: { setFillColorN: 2, setStrokeColorN: 1 },
      forms: 1,
      annotations: 1,
    });
  });

  it('sottopercorsi, lineTo, cubiche, quadratiche, chiusure: tutto e poi solo i candidati (stroke e fillStroke)', () => {
    const r = must(
      fake([
        path('stroke', cat(M(0, 0), Lt(10, 0), Lt(10, 10), Z, M(20, 20), Lt(30, 30))), // 2 sottopercorsi, 3 lineTo, 1 chiusura con segmento
        path('fill', cat(M(0, 0), C(1, 1, 2, 2, 3, 3), Q(1, 1, 2, 2), Z)), // 1 cubica, 1 quadratica, chiusura con segmento
        path('fillStroke', cat(M(0, 0), Lt(5, 0), Z)),
        path('endPath', cat(M(0, 0), Lt(5, 5), Lt(0, 5), Z)),
      ]),
    );
    expect(r.stats.byPaint).toEqual({ stroke: 1, fill: 1, fillStroke: 1, endPath: 1 });
    expect(r.stats.all).toEqual({ paths: 4, subpaths: 5, emptySubpaths: 0, lineTo: 3 + 0 + 1 + 2, cubic: 1, quad: 1, close: 4, closeSegments: 4, closeNoSegment: 0 });
    expect(r.stats.cand).toEqual({ paths: 2, subpaths: 3, emptySubpaths: 0, lineTo: 4, cubic: 0, quad: 0, close: 2, closeSegments: 2, closeNoSegment: 0 });
    // segmenti rettilinei dei candidati: 4 lineTo e 2 segmenti di chiusura
    expect(r.geometry.nLines).toBe(6);
    expect(r.geometry.nPaths).toBe(2);
  });

  it('chiusura senza segmento: punto corrente uguale al primo, o sottopercorso vuoto', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), Lt(5, 0), Lt(0, 0), Z, M(9, 9), Z))]));
    expect(r.stats.all.close).toBe(2);
    expect(r.stats.all.closeSegments).toBe(0);
    expect(r.stats.all.closeNoSegment).toBe(2);
    expect(r.geometry.nLines).toBe(2);
  });

  it('istogramma delle lunghezze: valori ai bordi dei contenitori (sotto 0.01; 0.01-0.1; 0.1-1; 1-10; 10 e oltre), minimo e massimo; solo i candidati', () => {
    const lens = [0, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50];
    const cmds = lens.flatMap((l) => cat(M(0, 0), Lt(l, 0)));
    const r = must(fake([path('stroke', cmds), path('fill', cat(M(0, 0), Lt(0.001, 0), Lt(500, 0))), path('endPath', cat(M(0, 0), Lt(0.001, 0)))]));
    expect(r.stats.lineHist).toEqual([2, 2, 2, 2, 2]);
    expect(r.stats.lineMin).toBe(0);
    expect(r.stats.lineMax).toBe(50);
    expect([0, 0.00999, 0.01, 0.0999, 0.1, 0.999, 1, 9.999, 10, 1e6].map(lengthBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    // il segmento di chiusura entra nell'istogramma con la sua lunghezza
    const c = must(fake([path('stroke', cat(M(0, 0), Lt(3, 0), Lt(3, 4), Z))]));
    expect(c.stats.lineHist).toEqual([0, 0, 0, 3, 0]); // 3, 4 e il ritorno di 5, tutti fra 1 e 10
    expect(c.stats.lineMin).toBe(3);
    expect(c.stats.lineMax).toBe(5);
    const none = must(fake([path('stroke', cat(M(0, 0), C(1, 1, 2, 2, 3, 3)))]));
    expect(none.stats.lineMin).toBeNull();
    expect(none.stats.lineMax).toBeNull();
  });

  it('percorsi chiusi di sole cubiche per numero di cubiche (1, 2, 3, 4, 5-8, oltre 8)', () => {
    const loop = (n: number): number[] => {
      const out = [...M(0, 0)];
      for (let i = 1; i <= n; i++) out.push(...C(i, 5, i + 1, -5, i + 2, 0)); // non e' un cerchio
      out.push(...Z);
      return out;
    };
    const list = [1, 2, 3, 4, 5, 8, 9, 20].map((n) => path('stroke', loop(n)));
    const r = must(fake(list));
    expect(r.stats.shapesAll.closedCubicOnly).toEqual([1, 1, 1, 1, 2, 2]);
    expect(r.stats.shapesCand.closedCubicOnly).toEqual([1, 1, 1, 1, 2, 2]);
    expect(r.stats.shapesAll.circles4).toBe(0); // l'unico da 4 non rispetta la regola
    expect([1, 2, 3, 4, 5, 8, 9, 100].map(cubicBucket)).toEqual([0, 1, 2, 3, 4, 4, 5, 5]);
    // un fill conta fra "tutti" ma non fra i candidati
    const f = must(fake([path('fill', loop(2)), path('stroke', loop(3))]));
    expect(f.stats.shapesAll.closedCubicOnly).toEqual([0, 1, 1, 0, 0, 0]);
    expect(f.stats.shapesCand.closedCubicOnly).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('regola del cerchio: 4 cubiche da 90 gradi (antiorario e orario, ruotato e scalato, kappa 0.55) si riconoscono; ellisse, quadrato, 3 cubiche e arco aperto no', () => {
    const yes = [circle(50, 50, 20), circle(50, 50, 20, { ccw: false }), circle(-3, 7, 0.4), circle(1000, 2000, 300), circle(50, 50, 20, { kappa: 0.55 }), circle(50, 50, 20, { close: false })];
    const r = must(fake(yes.map((c) => path('stroke', c))));
    expect(r.stats.shapesAll.circles4).toBe(6);
    expect(r.stats.shapesAll.closedCubicOnly).toEqual([0, 0, 0, 6, 0, 0]); // il sesto senza `h` e' chiuso per coincidenza
    expect(r.stats.shapesAll.closedByCoincidence).toBe(1);
    // ellisse (non uniforme): con la matrice
    const ell = must(fake([['transform', [2, 0, 0, 1, 0, 0]], path('stroke', circle(50, 50, 20))]));
    expect(ell.stats.shapesAll.circles4).toBe(0);
    // cerchio con matrice di rotazione e scala uniforme: resta un cerchio
    const th = 0.7;
    const rot = must(fake([['transform', [3 * Math.cos(th), 3 * Math.sin(th), -3 * Math.sin(th), 3 * Math.cos(th), 11, -4]], path('stroke', circle(5, 6, 2))]));
    expect(rot.stats.shapesAll.circles4).toBe(1);
    // quadrato scritto con 4 cubiche (punti di controllo sugli angoli): non e' un cerchio
    const sq = cat(M(10, 0), C(10, 10, 10, 10, 0, 10), C(-10, 10, -10, 10, -10, 0), C(-10, -10, -10, -10, 0, -10), C(10, -10, 10, -10, 10, 0), Z);
    expect(must(fake([path('stroke', sq)])).stats.shapesAll.circles4).toBe(0);
    // rombo con punti di controllo sui lati: diagonali perpendicolari ma archi che non stanno sulla circonferenza
    const rh = cat(M(10, 0), C(7, 3, 5, 5, 0, 10), C(-5, 5, -7, 3, -10, 0), C(-7, -3, -5, -5, 0, -10), C(5, -5, 7, -3, 10, 0), Z);
    expect(must(fake([path('stroke', rh)])).stats.shapesAll.circles4).toBe(0);
    // curve dalla parte opposta (archi rovesciati verso il centro)
    const inv = cat(M(20, 0), C(20, -KAPPA * 20, KAPPA * 20, -20, 0, -20), C(-KAPPA * 20, 20, -20, KAPPA * 20, -20, 0), C(-20, KAPPA * 20, -KAPPA * 20, 20, 0, 20), C(KAPPA * 20, -20, 20, -KAPPA * 20, 20, 0), Z);
    expect(must(fake([path('stroke', inv)])).stats.shapesAll.circles4).toBe(0);
    // tre cubiche e una linea, o 4 cubiche aperte con il punto finale lontano
    const open = circle(0, 0, 10, { close: false }).slice(0, 3 + 3 * 7);
    const o = must(fake([path('stroke', open)]));
    expect(o.stats.shapesAll.cubicsInOpen).toBe(3);
    expect(o.stats.shapesAll.circles4).toBe(0);
  });

  it('circleFrom4Cubics: scostamento riportato e tolleranza', () => {
    const perfect = circle(0, 0, 10, { close: false });
    const mk = (): number[] => {
      // le quattro cubiche come x0 y0 c1 c2 x1 y1
      const out: number[] = [];
      let px = perfect[1]!;
      let py = perfect[2]!;
      for (let i = 0; i < 4; i++) {
        const o = 3 + i * 7 + 1;
        out.push(px, py, perfect[o]!, perfect[o + 1]!, perfect[o + 2]!, perfect[o + 3]!, perfect[o + 4]!, perfect[o + 5]!);
        px = perfect[o + 4]!;
        py = perfect[o + 5]!;
      }
      return out;
    };
    const base = mk();
    const dev = circleFrom4Cubics(base);
    expect(dev).not.toBeNull();
    expect(dev!).toBeLessThan(0.01);
    // spostando un punto di fine di piu' della tolleranza (0.002 + 0.0005 r = 0.007 con r = 10) il cerchio non e' piu' riconosciuto
    const bad = base.slice();
    bad[6] = bad[6]! + 0.5; // il punto di fine della prima cubica si sposta di 0.5 pt (la tolleranza e' 0.007 pt con r = 10)
    expect(circleFrom4Cubics(bad)).toBeNull();
    expect(CIRCLE_TOL_ABS).toBeGreaterThan(0);
  });

  it('poligoni fitti: chiusi con almeno 12 lineTo e nessuna cubica (11 no, 12 si)', () => {
    const poly = (n: number): number[] => {
      const out = [...M(0, 0)];
      for (let i = 1; i <= n; i++) out.push(...Lt(i, (i % 2) * 3));
      out.push(...Z);
      return out;
    };
    const r = must(fake([path('stroke', poly(11)), path('stroke', poly(12)), path('stroke', poly(30)), path('fill', poly(40)), path('stroke', cat(M(0, 0), ...Array.from({ length: 12 }, (_, i) => Lt(i + 1, 1))))]));
    expect(r.stats.shapesCand.denseClosedPolygons).toBe(2);
    expect(r.stats.shapesAll.denseClosedPolygons).toBe(3);
  });

  it('cubiche in percorsi aperti', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), C(1, 2, 3, 4, 5, 0), C(6, 2, 7, 4, 8, 0))), path('stroke', cat(M(0, 0), C(1, 2, 3, 4, 5, 0), Lt(0, 0), Z)), path('fill', cat(M(0, 0), C(1, 2, 3, 4, 5, 5)))]));
    expect(r.stats.shapesCand.cubicsInOpen).toBe(2);
    expect(r.stats.shapesAll.cubicsInOpen).toBe(3);
  });

  it('limite di sicurezza: oltre il limite si smette di leggere i percorsi, le conte delle operazioni restano complete e lo si dichiara', () => {
    const one = cat(M(0, 0), Lt(1, 1), Lt(2, 2)); // 9 numeri
    const list: Op[] = [path('stroke', one), path('stroke', one), ['paintImageXObject', ['i']], path('stroke', one), path('stroke', one), ['showText', [[]]]];
    const full = must(fake(list));
    expect(full.stats.truncated).toBeNull();
    expect(full.stats.coordsRead).toBe(36);
    const r = must(fake(list, { maxCoords: 20 }));
    expect(r.stats.truncated).toEqual({ atOp: 3, ofOps: 6, limit: 20 });
    expect(r.stats.paths).toBe(2); // letti fin qui
    expect(r.stats.coordsRead).toBe(18);
    expect(r.stats.ops.total).toBe(6);
    expect(r.stats.ops.constructPath).toBe(4); // la conta delle operazioni e' su tutta la pagina
    expect(r.stats.ops.imageOps).toBe(1);
    expect(r.stats.ops.showText).toBe(1);
    expect(r.geometry.nLines).toBe(4);
    expect(DEFAULT_MAX_COORDS).toBe(10_000_000);
  });

  it('ordine dei numeri: byte per segmento (20 per un segmento rettilineo, 36 per una cubica) nella struttura delle primitive', () => {
    const r = must(fake([path('stroke', cat(M(0, 0), Lt(1, 1), C(1, 2, 3, 4, 5, 6)))]));
    expect(r.geometry.lineXY.byteLength + r.geometry.linePath.byteLength).toBe(BYTES_PER_LINE);
    expect(r.geometry.cubicXY.byteLength + r.geometry.cubicPath.byteLength).toBe(BYTES_PER_CUBIC);
    expect(r.geometry.bytes).toBe(2 + BYTES_PER_LINE + BYTES_PER_CUBIC);
    // dopo la crescita dei buffer gli array sono tagliati alla misura esatta
    const many = must(fake([path('stroke', cat(M(0, 0), ...Array.from({ length: 5000 }, (_, i) => Lt(i, i))))]));
    expect(many.geometry.nLines).toBe(5000);
    expect(many.geometry.lineXY.length).toBe(5000 * 4);
    expect(many.geometry.linePath.length).toBe(5000);
  });

  it('nessuna modifica degli argomenti in ingresso', () => {
    const buf = new Float32Array(cat(M(0, 0), Lt(1, 1)));
    const copy = Array.from(buf);
    const args = [OPS['stroke'], [buf], null];
    must(fake([['constructPath', args]]));
    expect(Array.from(buf)).toEqual(copy);
    expect(args.length).toBe(3);
  });
});
