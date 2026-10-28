import { OPS, Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDimension } from '../geometry/dimension';
import { type Layout, layoutDimension } from '../geometry/layout';
import { PageGeometry, type PageSpec, type SheetPoint } from '../geometry/page';
import type { CoverObject, DimensionObject, LineObject, PageObject, TextObject } from '../model/model';
import { dashPattern } from '../model/stroke';
import { type Matrix, IDENTITY, multiply } from './contentState';
import { type ExportPage, exportCoverSimple } from './coverSimple';
import { ExportError, describeExportError } from './errors';
import { verifyExport } from './verify';

import * as fx from '../../scripts/export-fixtures.mjs';

/** SHA-256 dei byte (Web Crypto, presente in Node e nel browser). */
const sha = async (b: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');
const RED = '#D32F2F';
const BLUE = '#1565C0';
const FULL: PageSpec = { view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 };
const page = (spec: PageSpec, objects: PageObject[], scale: ExportPage['scale'] = null): ExportPage => ({ spec, objects, scale });
let nextId = 1;
const cover = (shape: CoverObject['shape'], p1: { x: number; y: number }, p2: { x: number; y: number }): CoverObject => ({ id: nextId++, kind: 'cover', shape, p1, p2 });
const segment = (pts: { x: number; y: number }[], style: LineObject['stroke']['style'] = 'solid', widthPt = 1, color = RED): LineObject => ({
  id: nextId++,
  kind: 'segment',
  points: pts,
  stroke: { style, color, widthPt },
});
const text = (at: { x: number; y: number }, t: string, textPt = 10, color = BLUE): TextObject => ({ id: nextId++, kind: 'text', at, text: t, textPt, color });

// In PDF.js 6 il documento si distrugge dal task di caricamento: li teniamo e li chiudiamo a fine prova.
const tasks: { destroy(): Promise<void> }[] = [];
const open = async (bytes: Uint8Array): Promise<PDFDocumentProxy> => {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
};
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
/** PDF.js numera i font per documento (g_d1_f1, g_d2_f1...): per confrontare due documenti si toglie il numero. */
const stable = (v: unknown): string => JSON.stringify(v).replace(/g_d\d+_/g, 'g_dN_');

// ---- Lettura delle primitive scritte, con PDF.js (un altro lettore, non il nostro codice) ----
interface Prim {
  paint: 'fill' | 'stroke' | 'fillStroke';
  /** Punti nello spazio utente dopo la matrice corrente; per i cerchi anche i punti di arrivo delle curve. */
  pts: SheetPoint[];
  curves: number;
  closed: boolean;
  fill: string;
  stroke: string;
  width: number;
  dash: number[];
  ctm: Matrix;
}
interface State {
  fill: string;
  stroke: string;
  width: number;
  dash: number[];
  ctm: Matrix;
}
async function primitives(doc: PDFDocumentProxy, pageNo = 1): Promise<{ prims: Prim[]; opsSeen: string[] }> {
  const p = await doc.getPage(pageNo);
  const ol = await p.getOperatorList();
  const names = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
  let st: State = { fill: '#000000', stroke: '#000000', width: 1, dash: [], ctm: IDENTITY };
  const stack: State[] = [];
  const prims: Prim[] = [];
  const opsSeen: string[] = [];
  ol.fnArray.forEach((fn, i) => {
    const args = ol.argsArray[i] as unknown[];
    opsSeen.push(names[fn] as string);
    switch (fn) {
      case OPS.save:
        stack.push({ ...st });
        break;
      case OPS.restore: {
        const prev = stack.pop();
        if (prev) st = prev; // a pila vuota i lettori ignorano il Q
        break;
      }
      case OPS.transform:
        st = { ...st, ctm: multiply(args as unknown as Matrix, st.ctm) };
        break;
      case OPS.setFillRGBColor:
        st = { ...st, fill: args[0] as string };
        break;
      case OPS.setStrokeRGBColor:
        st = { ...st, stroke: args[0] as string };
        break;
      case OPS.setLineWidth:
        st = { ...st, width: args[0] as number };
        break;
      case OPS.setDash:
        st = { ...st, dash: [...((args[0] as number[]) ?? [])] };
        break;
      case OPS.constructPath: {
        const paint = args[0] as number;
        const data = Array.from(Object.values((args[1] as Record<string, number>[])[0] as Record<string, number>));
        const pts: SheetPoint[] = [];
        let curves = 0;
        let closed = false;
        const tf = (x: number, y: number): SheetPoint => ({ x: st.ctm[0] * x + st.ctm[2] * y + st.ctm[4], y: st.ctm[1] * x + st.ctm[3] * y + st.ctm[5] });
        for (let k = 0; k < data.length; ) {
          const code = data[k++] as number;
          if (code === 0 || code === 1) pts.push(tf(data[k++] as number, data[k++] as number));
          else if (code === 2) {
            k += 4;
            pts.push(tf(data[k++] as number, data[k++] as number));
            curves++;
          } else if (code === 3) {
            k += 2;
            pts.push(tf(data[k++] as number, data[k++] as number));
            curves++;
          } else if (code === 4) closed = true;
        }
        const kind = paint === OPS.fill ? 'fill' : paint === OPS.stroke ? 'stroke' : paint === OPS.fillStroke ? 'fillStroke' : null;
        if (kind) prims.push({ paint: kind, pts, curves, closed, fill: st.fill, stroke: st.stroke, width: st.width, dash: st.dash, ctm: st.ctm });
        break;
      }
      default:
    }
  });
  return { prims, opsSeen };
}
const items = async (doc: PDFDocumentProxy, pageNo = 1): Promise<{ str: string; m: number[] }[]> => {
  const tc = await (await doc.getPage(pageNo)).getTextContent();
  return tc.items.filter((i) => 'str' in i && i.str.trim() !== '').map((i) => ({ str: (i as { str: string }).str, m: (i as { transform: number[] }).transform }));
};
/** PDF.js tiene le coordinate dei tracciati in float32: tolleranza 0.0005 pt (il layout e' in double). */
const near = (a: SheetPoint, b: SheetPoint, digits = 3): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('esportazione "Copertura semplice": originale, pagine senza oggetti', () => {
  it('i byte in ingresso sono identici prima e dopo, il file in uscita e\' diverso e si riapre', async () => {
    const bytes = await fx.dirtyPdf('clean');
    const before = await sha(bytes);
    const len = bytes.length;
    const r = await exportCoverSimple(bytes, [page(FULL, [cover('rect', { x: 100, y: 600 }, { x: 200, y: 640 }), text({ x: 120, y: 300 }, 'FORO')])]);
    expect(await sha(bytes)).toBe(before);
    expect(bytes.length).toBe(len);
    expect(await sha(r.bytes)).not.toBe(before);
    expect(r.bytes).not.toBe(bytes);
    expect(r.touchedPages).toBe(1);
    expect(r.objectCount).toBe(2);
    const doc = await open(r.bytes);
    expect(doc.numPages).toBe(1);
  });

  it('le pagine senza oggetti restano identiche (stesso elenco di operatori e di testi), quelle con oggetti cambiano', async () => {
    const bytes = await fx.build({ pages: [{ raw: 'BT /F1 12 Tf 50 700 Td (Pagina uno) Tj ET 10 10 100 50 re S' }, { raw: 'BT /F1 12 Tf 50 700 Td (Pagina due) Tj ET' }, { raw: '1 0 0 -1 0 842 cm BT /F1 12 Tf 50 700 Td (Pagina tre) Tj ET' }] });
    const r = await exportCoverSimple(bytes, [page(FULL, []), page(FULL, [segment([{ x: 10, y: 10 }, { x: 90, y: 90 }])]), page(FULL, [])]);
    expect(r.touchedPages).toBe(1);
    const a = await open(bytes);
    const b = await open(r.bytes);
    for (const n of [1, 3]) {
      const oa = await (await a.getPage(n)).getOperatorList();
      const ob = await (await b.getPage(n)).getOperatorList();
      expect(stable(ob.fnArray), `pagina ${n}`).toBe(stable(oa.fnArray));
      expect(stable(ob.argsArray), `pagina ${n}`).toBe(stable(oa.argsArray));
    }
    const o2a = await (await a.getPage(2)).getOperatorList();
    const o2b = await (await b.getPage(2)).getOperatorList();
    expect(o2b.fnArray.length).toBeGreaterThan(o2a.fnArray.length);
  });

  it('rifiuta se PDF.js e la libreria di scrittura contano pagine diverse', async () => {
    const bytes = await fx.build({ pages: [{ raw: '' }, { raw: '' }] });
    await expect(exportCoverSimple(bytes, [page(FULL, [segment([{ x: 0, y: 0 }, { x: 5, y: 5 }])])])).rejects.toMatchObject({ code: 'mismatch' });
  });

  it('rifiuta se la geometria della pagina non coincide (area visibile, rotazione, UserUnit)', async () => {
    const bytes = await fx.build({ pages: [{ raw: '', rotate: 90 }] });
    await expect(exportCoverSimple(bytes, [page({ ...FULL, rotate: 0 }, [segment([{ x: 0, y: 0 }, { x: 5, y: 5 }])])])).rejects.toMatchObject({ code: 'mismatch' });
    await expect(exportCoverSimple(bytes, [page({ ...FULL, rotate: 90, view: [0, 0, 500, 800] }, [segment([{ x: 0, y: 0 }, { x: 5, y: 5 }])])])).rejects.toMatchObject({ code: 'mismatch' });
  });
});

describe('ordine, coperture e testo sotto le coperture', () => {
  it('le coperture vengono scritte prima di tutto il resto, anche se create dopo; tra loro nell\'ordine di creazione', async () => {
    const bytes = await fx.dirtyPdf('clean');
    const objs = [segment([{ x: 50, y: 50 }, { x: 150, y: 80 }]), cover('rect', { x: 100, y: 100 }, { x: 160, y: 140 }), text({ x: 120, y: 300 }, 'SOPRA'), cover('circle', { x: 300, y: 300 }, { x: 330, y: 300 })];
    const r = await exportCoverSimple(bytes, [page(FULL, objs)]);
    const doc = await open(r.bytes);
    const { prims, opsSeen } = await primitives(doc);
    const mine = prims.filter((p) => p.fill === '#ffffff' || p.stroke === '#d32f2f');
    expect(mine.map((p) => `${p.paint}:${p.fill === '#ffffff' ? 'bianco' : 'rosso'}`)).toEqual(['fill:bianco', 'fill:bianco', 'stroke:rosso']);
    // il testo viene dopo l'ultima copertura
    const lastCover = opsSeen.lastIndexOf('constructPath', opsSeen.indexOf('beginText', opsSeen.lastIndexOf('showText') - 8));
    expect(lastCover).toBeGreaterThan(-1);
  });

  it('coperture: rettangolo con angoli in qualunque ordine, quadrato, cerchio (quattro curve di centro e raggio giusti)', async () => {
    const bytes = await fx.dirtyPdf('clean');
    const r = await exportCoverSimple(bytes, [page(FULL, [cover('rect', { x: 300, y: 500 }, { x: 100, y: 400 }), cover('square', { x: 50, y: 50 }, { x: 150, y: 150 }), cover('circle', { x: 400, y: 300 }, { x: 430, y: 340 })])]);
    const doc = await open(r.bytes);
    const white = (await primitives(doc)).prims.filter((p) => p.fill === '#ffffff');
    expect(white).toHaveLength(3);
    const [rect, sq, circ] = white as [Prim, Prim, Prim];
    for (const p of [rect, sq]) {
      expect(p.paint).toBe('fill');
      expect(p.closed).toBe(true);
      expect(p.pts).toHaveLength(4);
    }
    expect([Math.min(...rect.pts.map((p) => p.x)), Math.min(...rect.pts.map((p) => p.y)), Math.max(...rect.pts.map((p) => p.x)), Math.max(...rect.pts.map((p) => p.y))]).toEqual([100, 400, 300, 500]);
    expect([Math.min(...sq.pts.map((p) => p.x)), Math.max(...sq.pts.map((p) => p.x)), Math.min(...sq.pts.map((p) => p.y)), Math.max(...sq.pts.map((p) => p.y))]).toEqual([50, 150, 50, 150]);
    expect(circ.curves).toBe(4);
    const R = 50; // distanza (400,300)-(430,340)
    const ends = circ.pts.slice(1); // punti di arrivo delle curve
    near(circ.pts[0] as SheetPoint, { x: 400 + R, y: 300 });
    near(ends[0] as SheetPoint, { x: 400, y: 300 + R });
    near(ends[1] as SheetPoint, { x: 400 - R, y: 300 });
    near(ends[2] as SheetPoint, { x: 400, y: 300 - R });
    near(ends[3] as SheetPoint, { x: 400 + R, y: 300 });
  });

  it('il testo del PDF sotto una copertura resta nel file ed e\' estraibile (promessa di "Copertura semplice")', async () => {
    const bytes = await fx.dirtyPdf('clean'); // "TESTO ORIGINALE" a (110, 650), 12 pt
    const r = await exportCoverSimple(bytes, [page(FULL, [cover('rect', { x: 100, y: 640 }, { x: 260, y: 670 }), text({ x: 300, y: 650 }, 'Ø25.40 ±0.1 90°')])]);
    const doc = await open(r.bytes);
    const found = (await items(doc)).map((i) => i.str);
    expect(found).toContain('TESTO ORIGINALE');
    expect(found).toContain('Ø25.40 ±0.1 90°');
    const white = (await primitives(doc)).prims.filter((p) => p.fill === '#ffffff');
    expect(white).toHaveLength(1);
  });
});

describe('linee: colore, spessore, tipo di linea, UserUnit', () => {
  it('colore, spessore, pattern e punti di ogni tipo di linea (e polilinea a piu\' punti)', async () => {
    const bytes = await fx.dirtyPdf('clean');
    const pts = [{ x: 50, y: 50 }, { x: 150, y: 80 }, { x: 200, y: 40 }];
    const r = await exportCoverSimple(bytes, [page(FULL, [segment(pts.slice(0, 2), 'solid', 2), segment(pts, 'dashed', 0.25, '#1565C0'), segment(pts.slice(0, 2), 'dashdot', 3, '#2E7D32')])]);
    const doc = await open(r.bytes);
    const lines = (await primitives(doc)).prims.filter((p) => p.paint === 'stroke' && p.stroke !== '#000000');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ stroke: '#d32f2f', width: 2, dash: [] });
    expect(lines[0]?.pts).toEqual(pts.slice(0, 2));
    expect(lines[1]).toMatchObject({ stroke: '#1565c0', width: 0.25 });
    expect(lines[1]?.dash).toEqual(dashPattern('dashed', 0.25));
    expect(lines[1]?.pts).toEqual(pts);
    expect(lines[2]).toMatchObject({ stroke: '#2e7d32', width: 3 });
    expect(lines[2]?.dash).toEqual(dashPattern('dashdot', 3));
  });

  it('UserUnit 2.5: spessori e pattern dividono per UserUnit (la linea resta di 1 pt fisico), i punti restano nello spazio utente', async () => {
    const bytes = await fx.build({ pages: [{ raw: '', userUnit: 2.5 }] });
    const spec: PageSpec = { ...FULL, userUnit: 2.5 };
    const r = await exportCoverSimple(bytes, [page(spec, [segment([{ x: 10, y: 10 }, { x: 90, y: 10 }], 'dashed', 1)])]);
    const doc = await open(r.bytes);
    const ln = (await primitives(doc)).prims.find((p) => p.stroke === '#d32f2f');
    expect(ln?.width).toBeCloseTo(1 / 2.5, 9);
    expect(ln?.dash.map((d) => d * 2.5)).toEqual(dashPattern('dashed', 1).map((d) => expect.closeTo(d, 9)));
    expect(ln?.pts).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }]);
  });
});

describe('quote e testi su ogni pagina: /Rotate 0, 90, 180, 270, CropBox, UserUnit 1 e 2.5', () => {
  for (const rotate of [0, 90, 180, 270]) {
    for (const userUnit of [1, 2.5]) {
      it(`/Rotate ${rotate}, UserUnit ${userUnit}: linee, frecce, badge e testi nel posto e dritti come sul foglio`, async () => {
        const crop: [number, number, number, number] = [50, 50, 400, 550];
        const bytes = await fx.build({ pages: [{ raw: '', rotate, userUnit, crop }] });
        const spec: PageSpec = { view: [50, 50, 450, 600], rotate, userUnit };
        const g = new PageGeometry(spec);
        const def = buildDimension('horizontal', [{ x: 100, y: 200 }, { x: 300, y: 210 }, { x: 200, y: 150 }].map((p) => g.sheetToUser(p)), g);
        if (!def) throw new Error('quota degenere');
        const dim: DimensionObject = { id: nextId++, kind: 'dim', ...def, valueText: null, color: RED, widthPt: 1, textPt: 10 };
        const scale = { mmPerPt: 0.5 };
        const t = text(g.sheetToUser({ x: 120, y: 300 }), 'Ø25.40 R12 ±0.1 90°', 12, BLUE);
        const r = await exportCoverSimple(bytes, [page(spec, [t, dim], scale)]);
        const doc = await open(r.bytes);
        const p = await doc.getPage(1);
        const vp = p.getViewport({ scale: 1 });
        // layout atteso, sul foglio
        const label = '100.00';
        const lay: Layout = layoutDimension({ ...def, color: RED, widthPt: 1, textPt: 10 }, g, label);
        const { prims } = await primitives(doc);
        const red = prims.filter((q) => q.stroke === '#d32f2f' || q.fill === '#d32f2f');
        const toSheet = (q: SheetPoint): SheetPoint => {
          const m = vp.transform;
          return { x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] };
        };
        // linee (quota + estensione): stroke
        const strokes = red.filter((q) => q.paint === 'stroke');
        expect(strokes).toHaveLength(lay.lines.length);
        lay.lines.forEach((ln, i) => {
          const q = strokes[i] as Prim;
          ln.pts.forEach((s, k) => near(toSheet(q.pts[k] as SheetPoint), s)); // PDF.js (viewport) riporta i punti utente dove li ha calcolati il layout
          expect(q.width * userUnit).toBeCloseTo(ln.widthPt, 9);
          expect(q.dash).toEqual([]);
        });
        // frecce: poligoni pieni
        const arrows = red.filter((q) => q.paint === 'fill');
        expect(arrows).toHaveLength(lay.arrows.length);
        lay.arrows.forEach((a, i) => (arrows[i] as Prim).pts.forEach((s, k) => near(toSheet(s), a.pts[k] as SheetPoint)));
        // badge: riempimento bianco e bordo colorato, 0.5 pt fisici
        const boxes = prims.filter((q) => q.paint === 'fillStroke');
        expect(boxes).toHaveLength(1);
        const box = boxes[0] as Prim;
        expect(box.fill).toBe('#ffffff');
        expect(box.stroke).toBe('#d32f2f');
        expect(box.width * userUnit).toBeCloseTo(0.5, 9);
        const rc = lay.boxes[0]?.rect as { x: number; y: number; w: number; h: number };
        const sheetBox = box.pts.map(toSheet);
        expect(Math.min(...sheetBox.map((q) => q.x))).toBeCloseTo(rc.x, 3);
        expect(Math.max(...sheetBox.map((q) => q.x))).toBeCloseTo(rc.x + rc.w, 3);
        expect(Math.min(...sheetBox.map((q) => q.y))).toBeCloseTo(rc.y, 3);
        expect(Math.max(...sheetBox.map((q) => q.y))).toBeCloseTo(rc.y + rc.h, 3);
        // testi: posizione, dritti, corpo in pt fisici
        const its = await items(doc);
        for (const [str, at, size] of [
          ['Ø25.40 R12 ±0.1 90°', { x: 120, y: 300 }, 12],
          [label, { x: lay.texts[0]?.x as number, y: lay.texts[0]?.y as number }, 10],
        ] as const) {
          const it0 = its.find((i) => i.str === str);
          expect(it0, `testo letto: ${its.map((i) => i.str).join('|')}`).toBeDefined();
          const m = Util.transform(vp.transform, it0?.m as number[]);
          expect(m[4]).toBeCloseTo(at.x, 3);
          expect(m[5]).toBeCloseTo(at.y, 3);
          expect(Math.abs(m[1] as number)).toBeLessThan(1e-6);
          expect(Math.abs(m[2] as number)).toBeLessThan(1e-6);
          expect(m[0]).toBeCloseTo(size, 3);
          expect(Math.abs(m[3] as number)).toBeCloseTo(size, 3);
        }
      });
    }
  }

  it('quota con valore digitato: il testo e\' quello digitato; quota automatica senza scala: "?" e avviso', async () => {
    const bytes = await fx.dirtyPdf('clean');
    const g = new PageGeometry(FULL);
    const def = buildDimension('aligned', [{ x: 100, y: 100 }, { x: 300, y: 120 }, { x: 200, y: 60 }], g);
    if (!def) throw new Error('quota degenere');
    const typed: DimensionObject = { id: nextId++, kind: 'dim', ...def, valueText: 'Ø8 ±0.1', color: RED, widthPt: 1, textPt: 10 };
    const auto: DimensionObject = { id: nextId++, kind: 'dim', ...def, valueText: null, color: RED, widthPt: 1, textPt: 10 };
    const r1 = await exportCoverSimple(bytes, [page(FULL, [typed])]);
    expect(r1.warnings).toEqual([]);
    const d1 = await open(r1.bytes);
    expect((await items(d1)).map((i) => i.str)).toContain('Ø8 ±0.1');
    const r2 = await exportCoverSimple(bytes, [page(FULL, [auto], null)]);
    expect(r2.warnings.map((w) => w.code)).toEqual(['dimension-without-value']);
    const d2 = await open(r2.bytes);
    expect((await items(d2)).map((i) => i.str)).toContain('?');
    const r3 = await exportCoverSimple(bytes, [page(FULL, [auto], { mmPerPt: 0.5 })]);
    const d3 = await open(r3.bytes);
    expect((await items(d3)).map((i) => i.str)).toContain('100.50'); // distanza (100,100)-(300,120) = 200.998 pt x 0.5 mm/pt
  });
});

describe('stato grafico del contenuto originale: non deve influire su cio\' che si scrive', () => {
  const objs = (): PageObject[] => [cover('rect', { x: 200, y: 500 }, { x: 300, y: 560 }), segment([{ x: 50, y: 50 }, { x: 150, y: 80 }], 'dashed'), text({ x: 120, y: 300 }, 'FORO')];
  const KINDS: fx.DirtyKind[] = ['clean', 'matrix-left', 'flip-left', 'open-q', 'stray-q', 'invisible-text'];
  for (const kind of KINDS) {
    it(`contenuto "${kind}": matrice identica, stato di partenza standard e testo al posto`, async () => {
      const bytes = await fx.dirtyPdf(kind);
      const r = await exportCoverSimple(bytes, [page(FULL, objs())]);
      const doc = await open(r.bytes);
      const { prims } = await primitives(doc);
      const white = prims.find((p) => p.fill === '#ffffff');
      const red = prims.find((p) => p.stroke === '#d32f2f');
      expect(white, 'copertura scritta').toBeDefined();
      expect(white?.ctm).toEqual(IDENTITY);
      expect(red?.ctm).toEqual(IDENTITY);
      expect(white?.pts[0]).toEqual({ x: 200, y: 500 });
      const mine = (await items(doc)).find((i) => i.str === 'FORO');
      expect(mine?.m).toEqual([10, 0, 0, 10, 120, 300]);
      const original = (await items(doc)).find((i) => i.str === 'TESTO ORIGINALE');
      expect(original, 'il testo originale resta').toBeDefined();
    });
  }

  it('i casi sporchi che pdf-lib da solo non basta a isolare (q aperto, Q in piu\') segnalano la correzione; quelli puliti no', async () => {
    const warn = async (kind: fx.DirtyKind): Promise<string[]> => (await exportCoverSimple(await fx.dirtyPdf(kind), [page(FULL, objs())])).warnings.map((w) => w.code);
    expect(await warn('clean')).toEqual([]);
    expect(await warn('matrix-left')).toEqual([]);
    expect(await warn('flip-left')).toEqual([]);
    expect(await warn('invisible-text')).toEqual([]);
    expect(await warn('open-q')).toEqual(['content-unbalanced']);
    expect(await warn('stray-q')).toEqual(['content-unbalanced']);
  });

  it('il contenuto originale non cambia: stesse coordinate del testo e dei riquadri di prima', async () => {
    for (const kind of ['matrix-left', 'open-q', 'stray-q'] as const) {
      const bytes = await fx.dirtyPdf(kind);
      const a = await open(bytes);
      const before = await items(a);
      const r = await exportCoverSimple(bytes, [page(FULL, objs())]);
      const b = await open(r.bytes);
      const after = (await items(b)).filter((i) => i.str === 'TESTO ORIGINALE');
      expect(after.map((i) => i.m), kind).toEqual(before.filter((i) => i.str === 'TESTO ORIGINALE').map((i) => i.m));
    }
  });
});

describe('annotazioni, moduli, firme: cosa fa la libreria di scrittura', () => {
  it('annotazione con aspetto proprio: resta nel file con lo stesso rettangolo; con una copertura sulla pagina si segnala che sta SOPRA', async () => {
    const bytes = await fx.build({ pages: [{ raw: '0 0 1 rg 100 100 300 300 re f', stamp: { x: 150, y: 150, w: 100, h: 40 } }] });
    const rCover = await exportCoverSimple(bytes, [page(FULL, [cover('rect', { x: 140, y: 140 }, { x: 260, y: 200 })])]);
    expect(rCover.warnings.map((w) => w.code)).toEqual(['annotations-over-cover']);
    const doc = await open(rCover.bytes);
    const ann = await (await doc.getPage(1)).getAnnotations();
    expect(ann).toHaveLength(1);
    expect(ann[0]?.rect).toEqual([150, 150, 250, 190]);
    const rLine = await exportCoverSimple(bytes, [page(FULL, [segment([{ x: 10, y: 10 }, { x: 50, y: 50 }])])]);
    expect(rLine.warnings).toEqual([]); // senza coperture nessun avviso
  });
});

describe('errori: file che la libreria di scrittura non legge', () => {
  const one = (): ExportPage[] => [page(FULL, [segment([{ x: 10, y: 10 }, { x: 50, y: 50 }])])];
  it('non e\' un PDF / vuoto / solo intestazione: ExportError "unreadable" con messaggio in italiano', async () => {
    const good = await fx.dirtyPdf('clean');
    const bad: Record<string, Uint8Array> = {
      vuoto: new Uint8Array(0),
      'non un PDF': new TextEncoder().encode('Questo non e un PDF'),
      'solo intestazione': good.slice(0, 8),
    };
    for (const [name, bytes] of Object.entries(bad)) {
      const err = await exportCoverSimple(bytes, one()).catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(ExportError);
      expect((err as ExportError).code, name).toBe('unreadable');
      const d = describeExportError(err);
      expect(d.title).toBe('PDF non esportabile');
      expect(d.message).toContain('nulla è stato perso');
      expect(d.detail.length).toBeGreaterThan(5);
    }
  });

  it('PDF cifrato con password utente: ExportError "encrypted"; i byte di ingresso non cambiano', async () => {
    const bytes = await fx.build({ pages: [{ raw: 'BT /F1 12 Tf 50 700 Td (X) Tj ET' }], encrypt: { userPassword: 'segreta' } });
    const h = await sha(bytes);
    const err = await exportCoverSimple(bytes, one()).catch((e: unknown) => e);
    expect((err as ExportError).code).toBe('encrypted');
    expect(describeExportError(err).message).toContain('protetto da password');
    expect(await sha(bytes)).toBe(h);
  });

  for (const algorithm of ['AES-256', 'AES-128', 'RC4-128']) {
    it(`PDF con sole restrizioni del proprietario (${algorithm}, utente vuoto): si esporta, PDF.js riapre il risultato senza password, i byte in ingresso non cambiano`, async () => {
      const bytes = await fx.build({ pages: [{ raw: 'BT /F1 12 Tf 50 700 Td (TESTO CIFRATO) Tj ET' }], encrypt: { algorithm } });
      const h = await sha(bytes);
      const r = await exportCoverSimple(bytes, [page(FULL, [text({ x: 100, y: 100 }, 'AGGIUNTO')])]);
      expect(await sha(bytes)).toBe(h);
      const doc = await open(r.bytes);
      const s = (await items(doc)).map((i) => i.str);
      expect(s).toContain('TESTO CIFRATO');
      expect(s).toContain('AGGIUNTO');
    });
  }

  it('errore di memoria o di scrittura: classificati e senza perdita (messaggi distinti)', () => {
    const mem = describeExportError(Object.assign(new RangeError('Array buffer allocation failed'), {}));
    expect(mem.title).toBe('Memoria insufficiente');
    const gen = describeExportError(new Error('boom'));
    expect(gen.title).toBe('Esportazione non riuscita');
    expect(gen.message).toContain('nulla è stato perso');
  });
});

describe('controllo del file generato', () => {
  it('un file valido passa; byte casuali, pagine in meno o geometria diversa no', async () => {
    const bytes = await fx.build({ pages: [{ raw: '' }, { raw: '', rotate: 90 }] });
    const specs: PageSpec[] = [FULL, { ...FULL, rotate: 90 }];
    const v = await verifyExport(bytes, specs);
    expect(v.pageCount).toBe(2);
    await expect(verifyExport(new Uint8Array(200).fill(7), specs)).rejects.toMatchObject({ code: 'verify' });
    await expect(verifyExport(bytes, specs.slice(0, 1))).rejects.toMatchObject({ code: 'verify' });
    await expect(verifyExport(bytes, [FULL, { ...FULL, rotate: 0 }])).rejects.toMatchObject({ code: 'verify' });
  });
});
