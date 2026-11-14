// `findSnap` con gli anelli del disegno del PDF (CP7f, V3.3a): `extra.pdfRings`. Senza sorgente il risultato e' quello di prima (i test esistenti di snap.test.ts, snap.v2b.test.ts,
// snap.extra.test.ts, snap.pdf.test.ts e snap.pdfScene*.test.ts restano invariati e passano); con la sorgente: Centro e Quadrante trovati entro il raggio (bordo compreso) e non oltre, gli
// interruttori Centro e Quadrante, la priorita' fra tipi (Estremo prima del Quadrante), la parita' di distanza e di tipo (vince l'oggetto disegnato, anche per il Quadrante degli oggetti,
// calcolato dopo), e un confronto differenziale fra l'indice e la scansione lineare a livello di `findSnap`.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { CircleObject, PageObject } from '../model/model';
import { arcChain, rng } from '../pdf/arcTestUtils';
import { DRAW_CLOSE, DRAW_CURVE_TO, DRAW_MOVE_TO, extractGeometry } from '../pdf/geometry';
import { scanNear } from '../pdf/pointIndex';
import { buildRingSource } from '../pdf/ringPoints';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { type PdfRingSource, type PdfSnapSource, type SnapKinds, findSnap } from './snap';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const flat = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const circle = (id: number, p1: UserPoint, p2: UserPoint): CircleObject => ({ id, kind: 'circle', p1, p2, stroke: { ...stroke } });
const ONLY = (...k: ('end' | 'mid' | 'center' | 'quadrant')[]): SnapKinds => Object.fromEntries(k.map((x) => [x, true]));

/** Una pagina 600 x 800 con i cerchi dati (centro utente x, y e raggio): estrazione con il riconoscimento e sorgente degli anelli. */
function ringsOf(circles: [number, number, number][]): { source: PdfRingSource; sheetCenters: SheetPoint[] } {
  const cmds: number[] = [];
  for (const [cx, cy, r] of circles) {
    const chain = arcChain(cx, cy, r, 0, 360, 4);
    const c0 = chain[0] as number[];
    cmds.push(DRAW_MOVE_TO, c0[0] as number, c0[1] as number);
    for (const c of chain) cmds.push(DRAW_CURVE_TO, c[2] as number, c[3] as number, c[4] as number, c[5] as number, c[6] as number, c[7] as number);
    cmds.push(DRAW_CLOSE);
  }
  const r = extractGeometry({ fnArray: [OPS['constructPath'] as number], argsArray: [[OPS['stroke'], [new Float32Array(cmds)], null]], ops: OPS, isLayerVisible: () => true, recognizeArcs: true });
  if (!r.ok) throw new Error(r.reason);
  const rs = buildRingSource(r.geometry, flat);
  return { source: rs.source, sheetCenters: circles.map(([cx, cy]) => flat.userToSheet(P(cx, cy))) };
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol: number): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const fakeRings = (pts: [number, number, 'center' | 'quadrant'][]): PdfRingSource => ({
  forEachNear: (x, y, radius, center, quadrant, emit) => {
    for (const [px, py, k] of pts) if ((k === 'center' ? center : quadrant) && Math.hypot(px - x, py - y) <= radius) emit(px, py, k);
  },
});

describe('senza sorgente degli anelli: come prima', () => {
  const objs: PageObject[] = [circle(1, P(100, 100), P(120, 100))];
  const raw = flat.userToSheet(P(103, 100));
  it('extra assente, vuoto, con pdfRings undefined o null: lo stesso risultato', () => {
    const base = findSnap(objs, flat, raw, 10, ONLY('end', 'mid', 'center', 'quadrant'));
    expect(base?.kind).toBe('center');
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid', 'center', 'quadrant'), [], {})).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid', 'center', 'quadrant'), [], { pdfRings: undefined })).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid', 'center', 'quadrant'), [], { pdfRings: null })).toEqual(base);
  });
});

describe('Centro e Quadrante degli anelli del PDF', () => {
  // un cerchio utente a (300, 400) di raggio 40 su una pagina alta 800: nel foglio il centro e' (300, 400) e i quadranti (340,400) (300,440) (260,400) (300,360)
  const { source } = ringsOf([[300, 400, 40]]);
  const sheetC = flat.userToSheet(P(300, 400));
  it('il Centro entro il raggio (bordo compreso) e non oltre', () => {
    const hit = findSnap([], flat, { x: sheetC.x + 4, y: sheetC.y }, 5, ONLY('center'), [], { pdfRings: source });
    expect(hit?.kind).toBe('center');
    near(hit?.point as SheetPoint, sheetC, 0.05);
    expect(findSnap([], flat, { x: sheetC.x + 6, y: sheetC.y }, 5, ONLY('center'), [], { pdfRings: source })).toBeNull();
    // bordo compreso: a distanza esattamente uguale al raggio (con il centro del PDF esattamente nel punto trovato)
    const exact = findSnap([], flat, { x: sheetC.x, y: sheetC.y }, 1e-3, ONLY('center'), [], { pdfRings: source });
    expect(exact?.kind).toBe('center');
  });
  it('il Quadrante: a destra, in basso, a sinistra e in alto del foglio mostrato, entro il raggio e non oltre', () => {
    for (const [dx, dy] of [
      [40, 0],
      [0, 40],
      [-40, 0],
      [0, -40],
    ] as const) {
      const hit = findSnap([], flat, { x: sheetC.x + dx + 2, y: sheetC.y + dy - 1 }, 5, ONLY('quadrant'), [], { pdfRings: source });
      expect(hit?.kind, `quadrante ${dx},${dy}`).toBe('quadrant');
      near(hit?.point as SheetPoint, { x: sheetC.x + dx, y: sheetC.y + dy }, 0.05);
      expect(findSnap([], flat, { x: sheetC.x + dx + 8, y: sheetC.y + dy }, 5, ONLY('quadrant'), [], { pdfRings: source })).toBeNull();
    }
  });
  it('gli interruttori: con Centro spento non c\'e\' il Centro del PDF, con Quadrante spento non ci sono i Quadranti; con tutti e due spenti (e gli altri accesi) niente', () => {
    const atCenter = { x: sheetC.x + 1, y: sheetC.y };
    const atQuad = { x: sheetC.x + 41, y: sheetC.y };
    expect(findSnap([], flat, atCenter, 5, ONLY('center'), [], { pdfRings: source })?.kind).toBe('center');
    expect(findSnap([], flat, atCenter, 5, ONLY('quadrant'), [], { pdfRings: source })).toBeNull();
    expect(findSnap([], flat, atQuad, 5, ONLY('quadrant'), [], { pdfRings: source })?.kind).toBe('quadrant');
    expect(findSnap([], flat, atQuad, 5, ONLY('center'), [], { pdfRings: source })).toBeNull();
    expect(findSnap([], flat, atCenter, 5, ONLY('end', 'mid'), [], { pdfRings: source })).toBeNull();
    // «PDF» spento = nessuna sorgente: nulla
    expect(findSnap([], flat, atCenter, 5, ONLY('center', 'quadrant'), [], { pdfRings: null })).toBeNull();
  });
  it('un anello non e\' un oggetto: non cambia gli oggetti passati e senza interruttori acceso nulla viene offerto', () => {
    const objs: PageObject[] = [];
    findSnap(objs, flat, { x: sheetC.x, y: sheetC.y }, 5, ONLY('center'), [], { pdfRings: source });
    expect(objs).toHaveLength(0);
    expect(findSnap([], flat, { x: sheetC.x, y: sheetC.y }, 5, {}, [], { pdfRings: source })).toBeNull();
  });
});

describe('priorita\' e parita\'', () => {
  it('a parita\' di distanza fra tipi diversi vince la priorita\': l\'Estremo del PDF batte il Quadrante di un anello nello stesso punto (qualunque sia l\'ordine di arrivo)', () => {
    const pdf: PdfSnapSource = { forEachNear: (x, y, r, end, _m, emit) => end && Math.hypot(340 - x, 400 - y) <= r && emit(340, 400, 'end') };
    const rings = fakeRings([[340, 400, 'quadrant']]);
    const hit = findSnap([], flat, { x: 343, y: 400 }, 5, ONLY('end', 'quadrant'), [], { pdf, pdfRings: rings });
    expect(hit?.kind).toBe('end');
    // l'Estremo spento: resta il Quadrante
    expect(findSnap([], flat, { x: 343, y: 400 }, 5, ONLY('quadrant'), [], { pdf, pdfRings: rings })?.kind).toBe('quadrant');
    // il Centro dell'anello nello stesso punto del Centro di un oggetto disegnato: stesso tipo, vince l'oggetto (vedi sotto)
  });
  it('a parita\' di distanza e di tipo vince l\'oggetto disegnato: il Centro di un cerchio disegnato batte il Centro di un anello a 4e-10 pt', () => {
    const objs: PageObject[] = [circle(1, P(100, 100), P(120, 100))]; // centro utente (100, 100) = foglio (100, 700)
    const c = flat.userToSheet(P(100, 100));
    const rings = fakeRings([[c.x + 4e-10, c.y, 'center']]);
    const hit = findSnap(objs, flat, { x: c.x - 3, y: c.y }, 10, ONLY('center'), [], { pdfRings: rings });
    expect(hit?.kind).toBe('center');
    expect(hit?.point.x).toBe(c.x); // quello dell'oggetto (non quello spostato di 4e-10)
  });
  it('lo stesso per il Quadrante: l\'oggetto disegnato (calcolato DOPO i punti del PDF) vince sul Quadrante di un anello a 4e-10 pt', () => {
    const objs: PageObject[] = [circle(1, P(100, 100), P(120, 100))]; // raggio 20: quadrante a destra (120, 700)
    const c = flat.userToSheet(P(100, 100));
    const rings = fakeRings([[c.x + 20 + 4e-10, c.y, 'quadrant']]);
    const hit = findSnap(objs, flat, { x: c.x + 23, y: c.y }, 10, ONLY('quadrant'), [], { pdfRings: rings });
    expect(hit?.kind).toBe('quadrant');
    expect(hit?.point.x).toBe(c.x + 20);
  });
  it('un candidato piu\' vicino batte un altro tipo piu\' lontano, di qualunque origine (l\'ordine non e\' una priorita\' globale)', () => {
    const objs: PageObject[] = [circle(1, P(100, 100), P(120, 100))];
    const c = flat.userToSheet(P(100, 100));
    const rings = fakeRings([[c.x + 2, c.y, 'center']]); // un Centro del PDF in c.x + 2; il punto in c.x + 1.8: il Centro del PDF e' a 0.2 pt, quello disegnato a 1.8 pt
    const hit = findSnap(objs, flat, { x: c.x + 1.8, y: c.y }, 10, ONLY('center'), [], { pdfRings: rings });
    expect(hit?.point.x).toBe(c.x + 2);
    // e dall'altra parte (a c.x + 0.2) vince quello disegnato
    expect(findSnap(objs, flat, { x: c.x + 0.2, y: c.y }, 10, ONLY('center'), [], { pdfRings: rings })?.point.x).toBe(c.x);
  });
});

describe('confronto differenziale: indice e scansione lineare danno lo stesso risultato', () => {
  it('300 anelli casuali e 600 punti casuali (anche vicinissimi a un centro o a un quadrante): stesso risultato di findSnap', () => {
    const rnd = rng(77);
    const circles: [number, number, number][] = Array.from({ length: 300 }, () => [40 + rnd() * 520, 40 + rnd() * 720, 1 + rnd() * 30]);
    const { source } = ringsOf(circles);
    const rs = buildRingSource(
      (() => {
        const cmds: number[] = [];
        for (const [cx, cy, r] of circles) {
          const chain = arcChain(cx, cy, r, 0, 360, 4);
          const c0 = chain[0] as number[];
          cmds.push(DRAW_MOVE_TO, c0[0] as number, c0[1] as number);
          for (const c of chain) cmds.push(DRAW_CURVE_TO, c[2] as number, c[3] as number, c[4] as number, c[5] as number, c[6] as number, c[7] as number);
          cmds.push(DRAW_CLOSE);
        }
        const r = extractGeometry({ fnArray: [OPS['constructPath'] as number], argsArray: [[OPS['stroke'], [new Float32Array(cmds)], null]], ops: OPS, isLayerVisible: () => true, recognizeArcs: true });
        if (!r.ok) throw new Error(r.reason);
        return r.geometry;
      })(),
      flat,
    );
    const pts = rs.points;
    const linear: PdfRingSource = { forEachNear: (x, y, r, c, q, emit) => scanNear(pts, x, y, r, c, q, (px, py, k) => emit(px, py, k === 'end' ? 'center' : 'quadrant')) };
    expect(source).toBeDefined();
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      const base = i % 3 === 0 ? ((): SheetPoint => ({ x: 20 + rnd() * 560, y: 20 + rnd() * 760 }))() : (() => {
        const k = Math.floor(rnd() * pts.xy.length) >> 1;
        return { x: (pts.xy[2 * k] as number) + (rnd() - 0.5) * 6, y: (pts.xy[2 * k + 1] as number) + (rnd() - 0.5) * 6 };
      })();
      for (const kinds of [ONLY('center'), ONLY('quadrant'), ONLY('center', 'quadrant', 'end')]) {
        const a = findSnap([], flat, base, 7, kinds, [], { pdfRings: rs.source });
        const b = findSnap([], flat, base, 7, kinds, [], { pdfRings: linear });
        expect(a).toEqual(b);
        if (a) hits++;
      }
    }
    expect(hits).toBeGreaterThan(300); // le prove cercano davvero qualcosa
  });
});
