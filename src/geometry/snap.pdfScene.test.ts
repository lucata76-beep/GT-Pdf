// `findSnap` con i TRATTI del disegno del PDF (CP7d, V3.2b): Intersezione. `extra.pdfSegments` (scena di src/pdf/segmentIndex.ts). I valori attesi NON vengono dal codice provato: l'incontro
// di due tratti e' ricalcolato qui con la regola di Cramer sulle coordinate (Float32, come quelle di PDF.js) e portato nel foglio con le formule del foglio scritte qui (pagina non
// ruotata: x' = x, y' = altezza - y); i test su PDF veri con /Rotate, CropBox e UserUnit usano PDF.js e stanno in src/pdf/segmentScenePdf.test.ts.
// Senza `pdfSegments` il risultato e' quello di CP7c (i test esistenti di snap*.test.ts e snapExtra.test.ts restano invariati e passano).
import { describe, expect, it } from 'vitest';
import type { CircleObject, LineObject, PageObject } from '../model/model';
import { SegmentGrid, buildSegmentScene, scanSegmentsNear } from '../pdf/segmentIndex';
import { type Seg, lineGeometry, rng } from '../pdf/segmentTestUtils';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { type SnapKinds, findSnap } from './snap';
import { PDF_MAX_NEAR, type PdfSegmentSource } from './snapExtra';

const H = 800;
const flat = new PageGeometry({ view: [0, 0, 600, H], rotate: 0, userUnit: 1 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const seg = (id: number, a: UserPoint, b: UserPoint): LineObject => ({ id, kind: 'segment', points: [a, b], stroke: { ...stroke } });
const ONLY = (...k: (keyof SnapKinds)[]): SnapKinds => Object.fromEntries(k.map((x) => [x, true]));
/** La scena del PDF di una pagina non ruotata di 600 x 800 pt. */
const scene = (segs: Seg[], opts: { path?: number[]; visible?: boolean[] } = {}): SegmentGrid => {
  const { grid } = buildSegmentScene(lineGeometry(segs, opts), flat);
  if (!grid) throw new Error('scena assente');
  return grid;
};
/** Il punto (x, y) dello spazio utente di una pagina non ruotata e non ritagliata, nel foglio: (x, H - y). */
const sh = (x: number, y: number): SheetPoint => ({ x, y: H - y });
const f32 = (s: Seg): Seg => Array.from(new Float32Array(s)) as Seg;
/** Incontro di due tratti (spazio utente) con la regola di Cramer; null se paralleli o fuori dai tratti (con una tolleranza piccola sul parametro). */
function cramer(a: Seg, b: Seg): { x: number; y: number } | null {
  const [x1, y1, x2, y2] = f32(a);
  const [x3, y3, x4, y4] = f32(b);
  // x1 + t (x2 - x1) = x3 + u (x4 - x3), y1 + t (y2 - y1) = y3 + u (y4 - y3)
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
const close = (a: SheetPoint, b: SheetPoint, tol = 1e-6): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const nudge = (p: SheetPoint, dx: number, dy: number): SheetPoint => ({ x: p.x + dx, y: p.y + dy });

describe('senza tratti del PDF: come prima', () => {
  const objs: PageObject[] = [seg(1, P(100, 100), P(300, 300)), seg(2, P(100, 300), P(300, 100))];
  const raw = nudge(sh(200, 200), 2, -1);
  it('`pdfSegments` assente, undefined o null: lo stesso risultato; una scena VUOTA di tratti non cambia nulla', () => {
    const base = findSnap(objs, flat, raw, 10, ONLY('intersection'));
    expect(base?.kind).toBe('intersection');
    close(base!.point, sh(200, 200), 1e-9);
    expect(findSnap(objs, flat, raw, 10, ONLY('intersection'), [], {})).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('intersection'), [], { pdfSegments: undefined })).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('intersection'), [], { pdfSegments: null })).toEqual(base);
    const empty = buildSegmentScene(lineGeometry([]), flat);
    expect(empty.grid).toBeNull();
    expect(findSnap(objs, flat, raw, 10, ONLY('intersection'), [], { pdfSegments: empty.grid })).toEqual(base);
  });
  it('tratti del PDF lontani dal cursore: il risultato e\' quello degli oggetti', () => {
    const far = scene([[10, 10, 50, 40], [10, 40, 50, 10]]);
    expect(findSnap(objs, flat, raw, 10, ONLY('intersection'), [], { pdfSegments: far })).toEqual(findSnap(objs, flat, raw, 10, ONLY('intersection')));
  });
});

describe('Intersezione fra due tratti del PDF', () => {
  // due diagonali che NON si incrociano a meta' (nessuna e' un Punto medio): A (100,100)-(400,250), B (150,300)-(350,50)
  const A: Seg = [100, 100, 400, 250];
  const B: Seg = [150, 300, 350, 50];
  const want = cramer(A, B)!;
  const src = scene([A, B]);
  it('il punto e\' quello del calcolo indipendente (regola di Cramer) e il tipo e\' Intersezione', () => {
    const exp = sh(want.x, want.y);
    for (const d of [[0, 0], [3, 2], [-4, 5], [6, -6]] as const) {
      const h = findSnap([], flat, nudge(exp, d[0], d[1]), 10, ONLY('intersection'), [], { pdfSegments: src });
      expect(h?.kind).toBe('intersection');
      close(h!.point, exp, 1e-6);
    }
  });
  it('raggio: bordo compreso; appena oltre, niente', () => {
    const exp = sh(want.x, want.y);
    expect(findSnap([], flat, nudge(exp, 10, 0), 10, ONLY('intersection'), [], { pdfSegments: src })?.kind).toBe('intersection');
    expect(findSnap([], flat, nudge(exp, 10.001, 0), 10, ONLY('intersection'), [], { pdfSegments: src })).toBeNull();
  });
  it('interruttore Intersezione spento (o solo Estremo e Punto medio): nessun candidato calcolato dal PDF; con l\'Intersezione sola c\'e\'', () => {
    const raw = sh(want.x, want.y);
    expect(findSnap([], flat, raw, 10, ONLY('end', 'mid', 'center', 'quadrant', 'tangent', 'perpendicular'), [], { pdfSegments: src })).toBeNull();
    expect(findSnap([], flat, raw, 10, ONLY('end', 'mid'), [], { pdfSegments: src })).toBeNull();
    expect(findSnap([], flat, raw, 10, ONLY('intersection'), [], { pdfSegments: src })?.kind).toBe('intersection');
  });
  it('niente prolungamenti: due tratti che si incrocerebbero oltre i loro estremi non danno nulla', () => {
    const s = scene([[100, 100, 200, 100], [300, 50, 300, 150]]); // la verticale incontrerebbe la retta della prima a x = 300, oltre il suo estremo
    expect(findSnap([], flat, sh(300, 100), 10, ONLY('intersection'), [], { pdfSegments: s })).toBeNull();
  });
  it('paralleli, anche SOVRAPPOSTI o collineari: nessuna Intersezione', () => {
    const s = scene([[100, 100, 400, 100], [150, 100, 350, 100], [100, 150, 400, 150], [380, 100, 500, 100]]);
    for (const p of [sh(250, 100), sh(390, 100), sh(150, 100), sh(250, 125)]) expect(findSnap([], flat, p, 12, ONLY('intersection'), [], { pdfSegments: s })).toBeNull();
  });
  it('incrocio a T (l\'estremo di un tratto SUL'+"'"+'altro): con Estremo acceso vince l\'Estremo; con la sola Intersezione c\'e\' l\'Intersezione nello stesso punto', () => {
    const s = scene([[100, 200, 400, 200], [250, 100, 250, 200]]); // la verticale finisce esattamente sull'orizzontale
    const t = sh(250, 200);
    const withEnd = findSnap([], flat, nudge(t, 2, 1), 10, ONLY('end', 'mid', 'intersection'), [], { pdfSegments: s, pdf: { forEachNear: (_x, _y, _r, end, _m, emit) => end && emit(t.x, t.y, 'end') } });
    expect(withEnd?.kind).toBe('end');
    const only = findSnap([], flat, nudge(t, 2, 1), 10, ONLY('intersection'), [], { pdfSegments: s });
    expect(only?.kind).toBe('intersection');
    close(only!.point, t, 1e-9);
  });
  it('le Intersezioni di un incrocio multiplo: ognuna si aggancia nel proprio punto', () => {
    const grid: Seg[] = [];
    for (let i = 0; i < 4; i++) grid.push([50, 100 + i * 70, 550, 100 + i * 70 + 13], [100 + i * 120, 50, 100 + i * 120 + 17, 650]);
    const s = scene(grid);
    let n = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const p = cramer(grid[2 * i]!, grid[2 * j + 1]!)!;
        const h = findSnap([], flat, nudge(sh(p.x, p.y), 1.5, -2), 10, ONLY('intersection'), [], { pdfSegments: s });
        expect(h?.kind).toBe('intersection');
        close(h!.point, sh(p.x, p.y), 1e-6);
        n++;
      }
    }
    expect(n).toBe(16);
  });
});

describe('percorsi, sottopercorsi e livelli', () => {
  it('tratti consecutivi dello stesso percorso che si toccano nel vertice: nessuna Intersezione li\' (e' + "'" + ' un Estremo)', () => {
    // una L (due tratti, stesso percorso, il secondo parte dove finisce il primo) e un rettangolo (4 tratti: anche la chiusura sul primo vertice)
    const s = scene([[100, 100, 300, 100], [300, 100, 300, 250], [400, 100, 500, 100], [500, 100, 500, 200], [500, 200, 400, 200], [400, 200, 400, 100]], { path: [0, 0, 1, 1, 1, 1] });
    for (const v of [sh(300, 100), sh(500, 100), sh(500, 200), sh(400, 200), sh(400, 100)]) {
      expect(findSnap([], flat, nudge(v, 1, 1), 8, ONLY('intersection'), [], { pdfSegments: s }), `vertice ${JSON.stringify(v)}`).toBeNull();
    }
  });
  it('due tratti di percorsi DIVERSI che si toccano nel vertice: Intersezione li\' (come due Rette disegnate); con l\'Estremo acceso vince l\'Estremo', () => {
    const s = scene([[100, 100, 300, 100], [300, 100, 300, 250]], { path: [0, 1] });
    const v = sh(300, 100);
    const h = findSnap([], flat, nudge(v, 1, 1), 8, ONLY('intersection'), [], { pdfSegments: s });
    expect(h?.kind).toBe('intersection');
    close(h!.point, v, 1e-9);
  });
  it('tratti di uno stesso percorso che si incrociano lontano dagli estremi: Intersezione (il confronto salta solo i tratti con un estremo in comune)', () => {
    const s = scene([[100, 100, 400, 250], [150, 300, 350, 50]], { path: [3, 3] });
    const p = cramer([100, 100, 400, 250], [150, 300, 350, 50])!;
    expect(findSnap([], flat, sh(p.x, p.y), 5, ONLY('intersection'), [], { pdfSegments: s })?.kind).toBe('intersection');
  });
  it('un tratto in un livello spento non da\' candidati (neppure con l\'altro tratto visibile)', () => {
    const s = scene([[100, 100, 400, 250], [150, 300, 350, 50]], { path: [0, 1], visible: [true, false] });
    const p = cramer([100, 100, 400, 250], [150, 300, 350, 50])!;
    expect(findSnap([], flat, sh(p.x, p.y), 10, ONLY('intersection'), [], { pdfSegments: s })).toBeNull();
  });
  it('un tratto sotto la soglia (quasi un punto) non e\' in scena e non da\' Intersezioni', () => {
    const s = scene([[100, 100, 400, 100], [250, 100.001, 250, 99.999], [250, 50, 250, 150]]);
    const hit = findSnap([], flat, sh(250, 100), 5, ONLY('intersection'), [], { pdfSegments: s });
    expect(hit?.kind).toBe('intersection'); // fra il primo e il terzo
    expect(buildSegmentScene(lineGeometry([[100, 100, 400, 100], [250, 100.001, 250, 99.999], [250, 50, 250, 150]]), flat).stats.tiny).toBe(1);
  });
});

describe('Intersezione fra un tratto del PDF e un oggetto disegnato', () => {
  const pdfLine: Seg = [100, 200, 500, 260];
  const s = scene([pdfLine]);
  it('una Retta disegnata che incrocia il tratto del PDF: l\'Intersezione e\' nel punto atteso (Cramer)', () => {
    const o = seg(1, P(250, 100), P(300, 400));
    const p = cramer(pdfLine, [250, 100, 300, 400])!;
    const h = findSnap([o], flat, nudge(sh(p.x, p.y), 3, 3), 10, ONLY('intersection'), [], { pdfSegments: s });
    expect(h?.kind).toBe('intersection');
    close(h!.point, sh(p.x, p.y), 1e-6);
    // senza la scena del PDF non c'e' niente
    expect(findSnap([o], flat, nudge(sh(p.x, p.y), 3, 3), 10, ONLY('intersection'))).toBeNull();
  });
  it('una Linea (due tratti) disegnata: le Intersezioni sono con i tratti che incrociano la linea del PDF, e il vertice della Linea no', () => {
    const o: LineObject = { id: 2, kind: 'polyline', points: [P(150, 100), P(300, 400), P(450, 100)], stroke: { ...stroke } };
    for (const [a, b] of [[[150, 100, 300, 400], pdfLine], [[300, 400, 450, 100], pdfLine]] as const) {
      const p = cramer(a as Seg, b as Seg)!;
      const h = findSnap([o], flat, nudge(sh(p.x, p.y), 2, -2), 10, ONLY('intersection'), [], { pdfSegments: s });
      expect(h?.kind).toBe('intersection');
      close(h!.point, sh(p.x, p.y), 1e-6);
    }
    expect(findSnap([o], flat, sh(300, 400), 10, ONLY('intersection'), [], { pdfSegments: s })).toBeNull(); // il vertice e' un Estremo, lontano dalla linea del PDF
  });
  it('un Cerchio disegnato che incrocia il tratto del PDF: i due punti di incontro (calcolo indipendente: formula del segmento e del cerchio)', () => {
    const c: CircleObject = { id: 3, kind: 'circle', p1: P(300, 230), p2: P(380, 230), stroke: { ...stroke } }; // centro (300, 230), raggio 80
    // la retta del PDF: y = 200 + (x - 100) * 60/400; si cerca x con (x - 300)^2 + (y - 230)^2 = 80^2
    const k = 60 / 400;
    const a = 1 + k * k;
    const b0 = -300 + k * (200 - 100 * k - 230);
    const cc = 300 * 300 + (200 - 100 * k - 230) ** 2 - 80 * 80;
    const disc = Math.sqrt(b0 * b0 - a * cc);
    const xs = [(-b0 - disc) / a, (-b0 + disc) / a];
    for (const x of xs) {
      const y = 200 + (x - 100) * k;
      const h = findSnap([c], flat, nudge(sh(x, y), 2, 2), 10, ONLY('intersection'), [], { pdfSegments: s });
      expect(h?.kind).toBe('intersection');
      close(h!.point, sh(x, y), 1e-4);
    }
  });
  it('un Arco disegnato: l\'Intersezione c\'e\' solo dentro il suo sweep (la retta del PDF passa dal centro: un incontro per mezzo cerchio)', () => {
    // retta del PDF: y = 200 + (x - 100) * 0.15, passa per il centro (300, 230); i due incontri col cerchio di raggio 80 sono (300 -+ d, 230 -+ 0.15 d), d = 80 / sqrt(1 + 0.15^2)
    const d = 80 / Math.sqrt(1 + 0.15 * 0.15);
    const up = sh(300 + d, 230 + 0.15 * d); // nel mezzo cerchio ALTO (y utente maggiore del centro)
    const low = sh(300 - d, 230 - 0.15 * d); // nel mezzo cerchio BASSO
    const hit = (o: PageObject, at: SheetPoint): boolean => findSnap([o], flat, at, 3, ONLY('intersection'), [], { pdfSegments: s })?.kind === 'intersection';
    const high: PageObject = { id: 4, kind: 'arc', p1: P(380, 230), p2: P(300, 310), p3: P(220, 230), stroke: { ...stroke } }; // da destra a sinistra passando sopra
    const lower: PageObject = { id: 5, kind: 'arc', p1: P(220, 230), p2: P(300, 150), p3: P(380, 230), stroke: { ...stroke } }; // da sinistra a destra passando sotto
    expect(hit(high, up)).toBe(true);
    expect(hit(high, low)).toBe(false);
    expect(hit(lower, low)).toBe(true);
    expect(hit(lower, up)).toBe(false);
  });
  it('a parita\' di distanza e di tipo vince l\'oggetto disegnato: un\'Intersezione fra due oggetti e una fra un oggetto e un tratto del PDF a meno di 1e-9 pt', () => {
    const a = seg(1, P(0, 100), P(300, 100));
    const b = seg(2, P(150, 0), P(150, 200));
    const ob = sh(150, 100); // incontro dei due oggetti, nel foglio
    // una sorgente finta: un tratto verticale a x = 150 + 5e-10 (nel foglio), che incontra l'oggetto `a` a 5e-10 pt dall'incontro degli oggetti
    const fake: PdfSegmentSource = { forEachNear: (_x, _y, _r, _max, emit) => (emit(0, 0, ob.x + 5e-10, ob.y - 50, ob.x + 5e-10, ob.y + 50), true) };
    const raw = nudge(ob, 3, 0); // il punto del PDF e' PIU' VICINO di 5e-10 pt: dentro la tolleranza di parita'
    const h = findSnap([a, b], flat, raw, 10, ONLY('intersection'), [], { pdfSegments: fake });
    expect(h?.kind).toBe('intersection');
    expect(h!.point).toEqual(ob); // esattamente il punto degli oggetti
    // piu' vicino di 1e-8 pt: non e' piu' una parita'
    const fake2: PdfSegmentSource = { forEachNear: (_x, _y, _r, _max, emit) => (emit(0, 0, ob.x + 1e-8, ob.y - 50, ob.x + 1e-8, ob.y + 50), true) };
    expect(findSnap([a, b], flat, raw, 10, ONLY('intersection'), [], { pdfSegments: fake2 })!.point.x).toBeCloseTo(ob.x + 1e-8, 12);
  });
  it('una Copertura circolare (solo Quadrante) non da\' Intersezione con il PDF', () => {
    const cover: PageObject = { id: 6, kind: 'cover', shape: 'circle', p1: P(300, 230), p2: P(380, 230) };
    const k = 60 / 400;
    const x = 300 - 78;
    const y = 200 + (x - 100) * k;
    expect(findSnap([cover], flat, sh(x, y), 12, ONLY('intersection'), [], { pdfSegments: s })).toBeNull();
  });
});

describe('troppi vicini, pagina vuota, dati inaspettati', () => {
  it(`piu' di PDF_MAX_NEAR (${PDF_MAX_NEAR}) tratti entro il raggio: nessun candidato calcolato dal PDF; esattamente PDF_MAX_NEAR: i candidati ci sono`, () => {
    const mk = (n: number): Seg[] => {
      const out: Seg[] = [[100, 300, 500, 300]]; // un tratto che incrocia tutti gli altri
      for (let i = 1; i < n; i++) out.push([300 + i * 0.01, 250, 300 + i * 0.01, 350]);
      return out;
    };
    const at = sh(300, 300);
    const atMax = scene(mk(PDF_MAX_NEAR));
    expect(findSnap([], flat, at, 10, ONLY('intersection'), [], { pdfSegments: atMax })?.kind).toBe('intersection');
    const over = scene(mk(PDF_MAX_NEAR + 1));
    expect(findSnap([], flat, at, 10, ONLY('intersection'), [], { pdfSegments: over })).toBeNull();
    // un raggio piu' piccolo (zoom piu' alto): i vicini sono meno di PDF_MAX_NEAR e l'Intersezione torna
    expect(findSnap([], flat, nudge(at, 1.0, 0), 1, ONLY('intersection'), [], { pdfSegments: over })?.kind).toBe('intersection');
  });
  it('una sorgente che restituisce false (troppi vicini) o che non emette nulla: nessuna eccezione e nessun candidato', () => {
    const no: PdfSegmentSource = { forEachNear: () => false };
    const none: PdfSegmentSource = { forEachNear: () => true };
    const o = seg(1, P(100, 100), P(300, 300));
    expect(findSnap([o], flat, sh(200, 200), 10, ONLY('intersection'), [], { pdfSegments: no })).toBeNull();
    expect(findSnap([o], flat, sh(200, 200), 10, ONLY('intersection'), [], { pdfSegments: none })).toBeNull();
  });
});

describe('oracolo indipendente: scene casuali, la scena del PDF contro il calcolo di Cramer su tutte le coppie', () => {
  it('2.000 interrogazioni: l\'Intersezione piu\' vicina (solo Intersezione attiva) e\' quella attesa, con tutte le coppie confrontate a forza bruta', () => {
    const r = rng(2024);
    let checked = 0;
    for (let scenario = 0; scenario < 8; scenario++) {
      const segs: Seg[] = [];
      for (let i = 0; i < 150; i++) {
        const x = 30 + r() * 540;
        const y = 30 + r() * 740;
        const len = 40 + r() * 210;
        const a = r() * Math.PI * 2;
        segs.push([x, y, Math.min(590, Math.max(10, x + Math.cos(a) * len)), Math.min(790, Math.max(10, y + Math.sin(a) * len))]);
      }
      const src = scene(segs, { path: segs.map((_, i) => i) }); // un percorso per tratto: nessun tratto e' saltato per un estremo in comune
      const all: { x: number; y: number }[] = [];
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
        const p = cramer(segs[i]!, segs[j]!);
        if (p) all.push(p);
      }
      expect(all.length).toBeGreaterThan(150);
      for (let q = 0; q < 250; q++) {
        const base = all[Math.floor(r() * all.length)]!;
        const raw = nudge(sh(base.x, base.y), (r() - 0.5) * 24, (r() - 0.5) * 24);
        const radius = [4, 8, 12][q % 3]!;
        let best: SheetPoint | null = null;
        let bestD = Infinity;
        for (const p of all) {
          const s = sh(p.x, p.y);
          const d = Math.hypot(s.x - raw.x, s.y - raw.y);
          if (d <= radius && d < bestD) {
            bestD = d;
            best = s;
          }
        }
        const got = findSnap([], flat, raw, radius, ONLY('intersection'), [], { pdfSegments: src });
        if (!best) expect(got).toBeNull();
        else {
          expect(got?.kind).toBe('intersection');
          close(got!.point, best, 1e-5); // l'unico piu' vicino; due incontri a distanza uguale entro 1e-9 sono praticamente impossibili con numeri casuali
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
});

describe('indice contro scansione lineare, a livello di findSnap (Intersezione, anche con oggetti e Estremo)', () => {
  it('stessa risposta con la scansione lineare dei tratti (10.000 interrogazioni, anche nei pareggi e con il tetto di vicini)', () => {
    const r = rng(77);
    const segs: Seg[] = [];
    for (let i = 0; i < 1200; i++) {
      const x = 20 + r() * 560;
      const y = 20 + r() * 760;
      if (i % 4 === 0) segs.push([25 * Math.round(x / 25), 25 * Math.round(y / 25), 25 * Math.round(x / 25) + 25, 25 * Math.round(y / 25)]);
      else segs.push([x, y, x + (r() - 0.5) * 80, y + (r() - 0.5) * 80]);
    }
    const g = scene(segs, { path: segs.map((_, i) => Math.floor(i / 3)) }); // gruppi di 3 tratti per percorso: alcuni condividono un estremo
    const lin: PdfSegmentSource = { forEachNear: (x, y, rad, max, emit) => scanSegmentsNear(g.xy, g.path, g.n, x, y, rad, max, emit) };
    const objs: PageObject[] = Array.from({ length: 30 }, (_, i) => seg(i + 1, P(20 + r() * 560, 20 + r() * 760), P(20 + r() * 560, 20 + r() * 760)));
    let hits = 0;
    for (let i = 0; i < 10000; i++) {
      const s = segs[Math.floor(r() * segs.length)]!;
      const around = i % 3 === 0 ? P(s[0], s[1]) : i % 3 === 1 ? P((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) : P(r() * 600, r() * 800);
      const raw = nudge(sh(around.x, around.y), (r() - 0.5) * 16, (r() - 0.5) * 16);
      const radius = [2, 5, 10, 22][i % 4]!;
      const kinds = [ONLY('intersection'), ONLY('intersection', 'end', 'mid'), ONLY('intersection', 'center')][i % 3]!;
      const a = findSnap(objs, flat, raw, radius, kinds, [], { pdfSegments: g });
      const b = findSnap(objs, flat, raw, radius, kinds, [], { pdfSegments: lin });
      expect(a, `interrogazione ${i}`).toEqual(b);
      if (a) hits++;
    }
    expect(hits).toBeGreaterThan(2000);
  }, 60000);
});
