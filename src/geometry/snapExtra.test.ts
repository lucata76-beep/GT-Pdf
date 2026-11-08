// Candidati calcolati dello snap (CP6f): Intersezione, Quadrante, Perpendicolare, Tangente. Casi a risultato noto calcolato a mano o con una formula indipendente.
import { describe, expect, it } from 'vitest';
import type { ArcObject, CircleObject, CoverObject, DimensionObject, LineObject, PageObject, TextObject } from '../model/model';
import { PageGeometry, type Pt, type UserPoint } from './page';
import {
  ANGLE_EPS,
  PARALLEL_EPS,
  PARAM_EPS,
  type Prim,
  SAME_POINT_EPS,
  TOUCH_REL,
  buildSnapScene,
  extraCandidates,
  footOnSegment,
  footsOnCircle,
  inArc,
  intersectCircleCircle,
  intersectSegCircle,
  intersectSegSeg,
  quadrantPoints,
  tangentPoints,
} from './snapExtra';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rotCrop = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const seg = (id: number, a: UserPoint, b: UserPoint): LineObject => ({ id, kind: 'segment', points: [a, b], stroke: { ...stroke } });
const poly = (id: number, pts: UserPoint[]): LineObject => ({ id, kind: 'polyline', points: pts, stroke: { ...stroke } });
const circle = (id: number, c: UserPoint, edge: UserPoint): CircleObject => ({ id, kind: 'circle', p1: c, p2: edge, stroke: { ...stroke } });
const arc = (id: number, a: UserPoint, b: UserPoint, c: UserPoint): ArcObject => ({ id, kind: 'arc', p1: a, p2: b, p3: c, stroke: { ...stroke } });
const near = (a: Pt, b: Pt, tol = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const S = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
const C = (cx: number, cy: number, r: number) => ({ cx, cy, r });

type Cand = { x: number; y: number; kind: string };
/** Tutti i candidati calcolati di una scena, senza scarto per distanza (raggio infinito). */
function all(objects: PageObject[], geom: PageGeometry, kinds: Parameters<typeof extraCandidates>[3], anchor: Pt | null = null): Cand[] {
  const out: Cand[] = [];
  extraCandidates(buildSnapScene(objects, geom), { x: 0, y: 0 }, Number.POSITIVE_INFINITY, kinds, anchor, (x, y, kind) => out.push({ x, y, kind }));
  return out;
}

describe('tolleranze dichiarate', () => {
  it(`valori`, () => {
    expect(PARAM_EPS).toBe(1e-9);
    expect(PARALLEL_EPS).toBe(1e-9);
    expect(TOUCH_REL).toBe(1e-9);
    expect(ANGLE_EPS).toBe(1e-9);
    expect(SAME_POINT_EPS).toBe(1e-9);
  });
});

describe('Intersezione: tratto-tratto', () => {
  it(`incrocio: un punto, calcolato a mano`, () => {
    const p = intersectSegSeg(S(0, 0, 10, 10), S(0, 10, 10, 0));
    near(p as Pt, { x: 5, y: 5 });
    // retta (0,0)-(30,0) e (10,-5)-(10,5): in (10, 0)
    near(intersectSegSeg(S(0, 0, 30, 0), S(10, -5, 10, 5)) as Pt, { x: 10, y: 0 });
  });
  it(`estremo comune: un punto (estremi compresi)`, () => {
    near(intersectSegSeg(S(0, 0, 10, 0), S(10, 0, 10, 10)) as Pt, { x: 10, y: 0 });
    near(intersectSegSeg(S(0, 0, 10, 0), S(5, 0, 5, 5)) as Pt, { x: 5, y: 0 }); // a T: l'estremo del secondo sta sul primo
  });
  it(`paralleli e sovrapposti: nessuno; tratti che non si raggiungono (niente prolungamenti): nessuno`, () => {
    expect(intersectSegSeg(S(0, 0, 10, 0), S(0, 5, 10, 5))).toBeNull();
    expect(intersectSegSeg(S(0, 0, 10, 0), S(5, 0, 15, 0))).toBeNull(); // sovrapposti
    expect(intersectSegSeg(S(0, 0, 10, 0), S(0, 0, 10, 0))).toBeNull(); // coincidenti
    expect(intersectSegSeg(S(0, 0, 4, 4), S(0, 10, 10, 0))).toBeNull(); // le rette si incontrano in (5,5), fuori dal primo
    expect(intersectSegSeg(S(0, 0, 0, 0), S(-1, 0, 1, 0))).toBeNull(); // tratto di lunghezza nulla
  });
  it(`il tratto vale fra i suoi estremi con la tolleranza del parametro (1e-9 della lunghezza)`, () => {
    // il secondo tratto finisce a 1e-10 dal primo: si tocca; a 1e-6: no
    expect(intersectSegSeg(S(0, 0, 10, 0), S(5, 1e-10, 5, 5))).not.toBeNull();
    expect(intersectSegSeg(S(0, 0, 10, 0), S(5, 1e-6, 5, 5))).toBeNull();
  });
});

describe('Intersezione: tratto-cerchio', () => {
  const c = C(0, 0, 5);
  it(`due punti: la corda y = 3`, () => {
    const r = intersectSegCircle(S(-10, 3, 10, 3), c);
    expect(r).toHaveLength(2);
    const xs = r.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-4, 12);
    expect(xs[1]).toBeCloseTo(4, 12);
    r.forEach((p) => expect(p.y).toBeCloseTo(3, 12));
  });
  it(`tangente: UN punto (y = 5), anche con scarto di calcolo di 1e-10; a 1e-6 no (nessuno)`, () => {
    const t = intersectSegCircle(S(-10, 5, 10, 5), c);
    expect(t).toHaveLength(1);
    near(t[0] as Pt, { x: 0, y: 5 });
    expect(intersectSegCircle(S(-10, 5 + 1e-10, 10, 5 + 1e-10), c)).toHaveLength(1);
    expect(intersectSegCircle(S(-10, 5 + 1e-6, 10, 5 + 1e-6), c)).toHaveLength(0);
    expect(intersectSegCircle(S(-10, 5 - 1e-6, 10, 5 - 1e-6), c)).toHaveLength(2); // appena dentro: due punti vicinissimi
  });
  it(`un estremo dentro e l\'altro fuori: un punto; tratto tutto dentro o che non arriva: nessuno`, () => {
    const one = intersectSegCircle(S(0, 0, 10, 0), c);
    expect(one).toHaveLength(1);
    near(one[0] as Pt, { x: 5, y: 0 });
    expect(intersectSegCircle(S(-1, 0, 1, 0), c)).toHaveLength(0); // tutto dentro
    expect(intersectSegCircle(S(6, -10, 6, 10), c)).toHaveLength(0); // lontano
    expect(intersectSegCircle(S(-10, 0, -6, 0), c)).toHaveLength(0); // la retta lo taglia ma il tratto non arriva
  });
  it(`tratto nullo: nessuno`, () => {
    expect(intersectSegCircle(S(5, 0, 5, 0), c)).toHaveLength(0);
  });
});

describe('Intersezione: cerchio-cerchio', () => {
  it(`due punti: (0,0,r5) e (8,0,r5) -> (4, +-3)`, () => {
    const r = intersectCircleCircle(C(0, 0, 5), C(8, 0, 5));
    expect(r).toHaveLength(2);
    const ys = r.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-3, 12);
    expect(ys[1]).toBeCloseTo(3, 12);
    r.forEach((p) => expect(p.x).toBeCloseTo(4, 12));
  });
  it(`tangenti esterni e interni: UN punto`, () => {
    const ext = intersectCircleCircle(C(0, 0, 5), C(10, 0, 5));
    expect(ext).toHaveLength(1);
    near(ext[0] as Pt, { x: 5, y: 0 });
    const int = intersectCircleCircle(C(0, 0, 5), C(3, 0, 2));
    expect(int).toHaveLength(1);
    near(int[0] as Pt, { x: 5, y: 0 });
    expect(intersectCircleCircle(C(0, 0, 5), C(10 + 1e-10, 0, 5))).toHaveLength(1); // scarto di calcolo sotto la tolleranza
    expect(intersectCircleCircle(C(0, 0, 5), C(10 + 1e-5, 0, 5))).toHaveLength(0); // appena separati
    expect(intersectCircleCircle(C(0, 0, 5), C(10 - 1e-5, 0, 5))).toHaveLength(2); // appena sovrapposti
  });
  it(`concentrici, coincidenti, disgiunti, uno dentro l\'altro: nessuno`, () => {
    expect(intersectCircleCircle(C(1, 1, 5), C(1, 1, 3))).toHaveLength(0);
    expect(intersectCircleCircle(C(1, 1, 5), C(1, 1, 5))).toHaveLength(0);
    expect(intersectCircleCircle(C(0, 0, 5), C(20, 0, 5))).toHaveLength(0);
    expect(intersectCircleCircle(C(0, 0, 10), C(1, 0, 2))).toHaveLength(0);
  });
});

describe('arco: dentro e fuori lo sweep', () => {
  // sweep positivo = senso orario sullo schermo (Y in giu'): da 0 a 90 gradi = in basso a destra
  const a = { cx: 0, cy: 0, a0: 0, sweep: Math.PI / 2, full: false };
  it(`inArc`, () => {
    expect(inArc(a, 4, 3)).toBe(true); // 36.9 gradi
    expect(inArc(a, -4, 3)).toBe(false); // 143 gradi
    expect(inArc(a, 5, 0)).toBe(true); // l'estremo di partenza
    expect(inArc(a, 0, 5)).toBe(true); // l'estremo di arrivo
    expect(inArc(a, 4, -3)).toBe(false); // -36.9 gradi
    expect(inArc({ ...a, full: true }, -4, -3)).toBe(true);
    // sweep negativo: da 0 a -90 gradi = in alto a destra
    const n = { cx: 0, cy: 0, a0: 0, sweep: -Math.PI / 2, full: false };
    expect(inArc(n, 4, -3)).toBe(true);
    expect(inArc(n, 4, 3)).toBe(false);
    // attraversa -180/180: da 135 a 225 gradi (sweep 90)
    const w = { cx: 0, cy: 0, a0: (3 * Math.PI) / 4, sweep: Math.PI / 2, full: false };
    expect(inArc(w, -5, 0)).toBe(true);
    expect(inArc(w, 5, 0)).toBe(false);
  });
  it(`tratto e arco: solo gli incontri dentro lo sweep`, () => {
    // cerchio (0,0) r5 e l'arco da 0 a 90 gradi (in basso a destra) per i punti (5,0), (3.5355,3.5355), (0,5)
    const o = arc(1, P(5, 0), P(5 * Math.SQRT1_2, 5 * Math.SQRT1_2), P(0, 5));
    // in questo spazio la pagina e' piatta: y utente sale, y foglio scende. Si lavora direttamente nel foglio con la scena costruita a mano:
    const scene = { prims: [mkRing(0, 0, 5, 0, Math.PI / 2, false), mkSeg(1, -10, 3, 10, 3)] };
    const out: Cand[] = [];
    extraCandidates(scene, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, { intersection: true }, null, (x, y, kind) => out.push({ x, y, kind }));
    expect(out).toHaveLength(1); // (4,3) e' nell'arco, (-4,3) no
    near(out[0] as Pt, { x: 4, y: 3 }, 1e-12);
    void o;
  });
});

function mkSeg(owner: number, x1: number, y1: number, x2: number, y2: number, idx = 0): Prim {
  return { t: 0, minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2), x1, y1, x2, y2, cx: 0, cy: 0, r: 0, a0: 0, sweep: 0, full: true, quadOnly: false, owner, idx };
}
function mkRing(cx: number, cy: number, r: number, a0: number, sweep: number, full: boolean, quadOnly = false, owner = 0): Prim {
  return { t: 1, minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r, x1: 0, y1: 0, x2: 0, y2: 0, cx, cy, r, a0, sweep, full, quadOnly, owner, idx: 0 };
}

describe('scena', () => {
  it(`Retta, Linea (un tratto per segmento), Cerchio, Arco e Copertura circolare; non le altre coperture, ne\' quote, ne\' testi`, () => {
    const cover = (shape: CoverObject['shape']): CoverObject => ({ id: 9, kind: 'cover', shape, p1: P(10, 10), p2: P(30, 30) });
    const dim: DimensionObject = { id: 10, kind: 'dim', dim: 'aligned', p1: P(0, 0), p2: P(10, 0), a: P(0, 5), b: P(10, 5), valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 };
    const text: TextObject = { id: 11, kind: 'text', at: P(5, 5), text: 'x', textPt: 10, color: '#D32F2F' };
    const objs: PageObject[] = [
      seg(1, P(0, 0), P(10, 0)),
      poly(2, [P(0, 0), P(10, 0), P(10, 10), P(0, 10)]),
      circle(3, P(50, 50), P(60, 50)),
      arc(4, P(100, 100), P(110, 110), P(120, 100)),
      cover('circle'),
      cover('rect'),
      cover('square'),
      dim,
      text,
    ];
    const sc = buildSnapScene(objs, flat);
    expect(sc.prims.filter((p) => p.t === 0)).toHaveLength(1 + 3);
    expect(sc.prims.filter((p) => p.t === 1)).toHaveLength(3);
    expect(sc.prims.filter((p) => p.quadOnly)).toHaveLength(1);
    expect(sc.prims.filter((p) => p.t === 1 && !p.full)).toHaveLength(1);
    // i tratti della Linea hanno lo stesso `owner` e indici 0, 1, 2
    const tracts = sc.prims.filter((p) => p.t === 0 && p.owner === 1);
    expect(tracts.map((p) => p.idx)).toEqual([0, 1, 2]);
  });
  it(`i riquadri sono in pt del foglio (con /Rotate 90 e CropBox)`, () => {
    const sc = buildSnapScene([seg(1, P(100, 100), P(200, 100))], rotCrop);
    const a = rotCrop.userToSheet(P(100, 100));
    const b = rotCrop.userToSheet(P(200, 100));
    const p = sc.prims[0] as Prim;
    expect(p.minX).toBeCloseTo(Math.min(a.x, b.x), 9);
    expect(p.maxY).toBeCloseTo(Math.max(a.y, b.y), 9);
  });
});

describe('Intersezione: Linea, tratti adiacenti e non adiacenti', () => {
  it(`"8": i tratti 0 e 2 si incrociano in (5,5); i tratti adiacenti si toccano nel vertice e NON danno Intersezione (e' un Estremo)`, () => {
    const o = poly(1, [P(0, 0), P(10, 10), P(10, 0), P(0, 10)]);
    const c = all([o], flat, { intersection: true });
    expect(c).toHaveLength(1);
    const e = flat.sheetToUser({ x: (c[0] as Cand).x, y: (c[0] as Cand).y });
    near(e, { x: 5, y: 5 }, 1e-9);
  });
  it(`una Linea chiusa: primo e ultimo tratto si toccano nel vertice di chiusura (non adiacenti per indice): un candidato, in quel vertice`, () => {
    const o = poly(1, [P(0, 0), P(10, 0), P(10, 10), P(0, 0)]);
    const c = all([o], flat, { intersection: true });
    expect(c).toHaveLength(1);
    near(flat.sheetToUser(c[0] as Pt), { x: 0, y: 0 }, 1e-9);
  });
  it(`due oggetti diversi: Retta e Linea si incrociano; due Rette parallele no`, () => {
    expect(all([seg(1, P(0, 0), P(10, 10)), seg(2, P(0, 10), P(10, 0))], flat, { intersection: true })).toHaveLength(1);
    expect(all([seg(1, P(0, 0), P(10, 0)), seg(2, P(0, 5), P(10, 5))], flat, { intersection: true })).toHaveLength(0);
  });
  it(`Retta e Cerchio (2), Retta e Arco (solo dentro lo sweep), Cerchio e Cerchio (2), Arco e Cerchio`, () => {
    // nel foglio piatto y utente sale: il cerchio (100,100) r 20 e la retta orizzontale y = 112 (corda)
    const cc = circle(1, P(100, 100), P(120, 100));
    const line = seg(2, P(50, 112), P(150, 112));
    const c = all([cc, line], flat, { intersection: true });
    expect(c).toHaveLength(2);
    const users = c.map((q) => flat.sheetToUser(q)).sort((a, b) => a.x - b.x);
    expect(users[0]?.x).toBeCloseTo(100 - 16, 9); // sqrt(20^2 - 12^2) = 16
    expect(users[1]?.x).toBeCloseTo(100 + 16, 9);
    const c2 = all([circle(1, P(100, 100), P(120, 100)), circle(2, P(130, 100), P(150, 100))], flat, { intersection: true });
    expect(c2).toHaveLength(2);
    expect(flat.sheetToUser(c2[0] as Pt).x).toBeCloseTo(115, 9);
    // arco: meta' superiore del cerchio (da (80,100) a (120,100) passando per (100,120)): incontra la retta y=112 solo a destra? gli incontri sono a x = 84 e 116, entrambi sulla meta' alta
    const half = arc(3, P(80, 100), P(100, 120), P(120, 100));
    const c3 = all([half, line], flat, { intersection: true });
    expect(c3).toHaveLength(2);
    const c4 = all([half, seg(4, P(50, 90), P(150, 90))], flat, { intersection: true });
    expect(c4).toHaveLength(0); // y = 90 incontra il cerchio nella meta' bassa, fuori dall'arco
  });
  it(`con /Rotate 90 e CropBox l\'incrocio e\' lo stesso punto della pagina (similitudine): calcolo indipendente nello spazio utente`, () => {
    const a = seg(1, P(100, 100), P(300, 300));
    const b = seg(2, P(100, 300), P(300, 100));
    const c = all([a, b], rotCrop, { intersection: true });
    expect(c).toHaveLength(1);
    near(c[0] as Pt, rotCrop.userToSheet(P(200, 200)), 1e-9);
  });
});

describe('Quadrante', () => {
  it(`i quattro punti: destra, basso, sinistra, alto del foglio`, () => {
    expect(quadrantPoints(C(10, 20, 5))).toEqual([
      { x: 15, y: 20 },
      { x: 10, y: 25 },
      { x: 5, y: 20 },
      { x: 10, y: 15 },
    ]);
  });
  it(`cerchio: 4; con /Rotate 90 sono i quadranti del foglio MOSTRATO, non quelli dello spazio utente`, () => {
    const o = circle(1, P(200, 300), P(220, 300));
    const c = all([o], rotCrop, { quadrant: true });
    expect(c).toHaveLength(4);
    const ctr = rotCrop.userToSheet(P(200, 300));
    const rS = Math.hypot(rotCrop.userToSheet(P(220, 300)).x - ctr.x, rotCrop.userToSheet(P(220, 300)).y - ctr.y);
    const want = [{ x: ctr.x + rS, y: ctr.y }, { x: ctr.x, y: ctr.y + rS }, { x: ctr.x - rS, y: ctr.y }, { x: ctr.x, y: ctr.y - rS }];
    want.forEach((w, i) => near(c[i] as Pt, w, 1e-9));
    // e il punto "destra" del foglio NON e' (200+20, 300) dello spazio utente: con /Rotate 90 e' un altro punto utente
    const userRight = rotCrop.sheetToUser(want[0] as Pt);
    expect(Math.hypot(userRight.x - 220, userRight.y - 300)).toBeGreaterThan(1);
    expect(Math.hypot(userRight.x - 200, userRight.y - 300)).toBeCloseTo(20, 9);
  });
  it(`arco: solo i quadranti dentro lo sweep (da -30 a +120 gradi: 0 e 90; non 180 e 270)`, () => {
    const rad = (d: number): number => (d * Math.PI) / 180;
    const sc = { prims: [mkRing(0, 0, 10, rad(-30), rad(150), false)] };
    const out: Cand[] = [];
    extraCandidates(sc, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, { quadrant: true }, null, (x, y, kind) => out.push({ x, y, kind }));
    expect(out).toHaveLength(2);
    near(out[0] as Pt, { x: 10, y: 0 }, 1e-12);
    near(out[1] as Pt, { x: 0, y: 10 }, 1e-12);
  });
  it(`Copertura circolare: 4; rettangolo e quadrato: nessuno; la Copertura circolare non da\' ne\' Intersezione ne\' Perpendicolare ne\' Tangente`, () => {
    const cc: CoverObject = { id: 1, kind: 'cover', shape: 'circle', p1: P(100, 100), p2: P(120, 100) };
    expect(all([cc], flat, { quadrant: true })).toHaveLength(4);
    expect(all([{ id: 2, kind: 'cover', shape: 'rect', p1: P(0, 0), p2: P(50, 50) } as CoverObject], flat, { quadrant: true })).toHaveLength(0);
    expect(all([cc, seg(2, P(50, 110), P(150, 110))], flat, { intersection: true })).toHaveLength(0);
    expect(all([cc], flat, { perpendicular: true, tangent: true }, { x: 500, y: 500 })).toHaveLength(0);
  });
});

describe('Perpendicolare', () => {
  it(`su un tratto: il piede dentro il tratto; fuori dal tratto nessuno`, () => {
    near(footOnSegment(S(0, 0, 10, 0), 4, 5) as Pt, { x: 4, y: 0 });
    near(footOnSegment(S(0, 0, 10, 10), 0, 10) as Pt, { x: 5, y: 5 }); // da (0,10) sulla diagonale
    expect(footOnSegment(S(0, 0, 10, 0), 15, 5)).toBeNull();
    expect(footOnSegment(S(0, 0, 10, 0), -2, 3)).toBeNull();
    near(footOnSegment(S(0, 0, 10, 0), 10, 5) as Pt, { x: 10, y: 0 }); // il piede cade sull'estremo (coincide con l'Estremo)
    expect(footOnSegment(S(3, 3, 3, 3), 0, 0)).toBeNull();
  });
  it(`su un cerchio: i due punti sulla retta per il centro e il punto; centro: nessuno`, () => {
    const f = footsOnCircle(C(0, 0, 5), 10, 0);
    expect(f).toHaveLength(2);
    near(f[0] as Pt, { x: 5, y: 0 });
    near(f[1] as Pt, { x: -5, y: 0 });
    expect(footsOnCircle(C(2, 2, 5), 2, 2)).toHaveLength(0);
    const g = footsOnCircle(C(0, 0, 5), 3, 4); // punto dentro: gli stessi due punti sulla retta per il centro
    near(g[0] as Pt, { x: 3, y: 4 });
  });
  it(`senza punto di partenza nessun candidato; con, via la scena: tratto, cerchio, arco (solo i piedi dentro lo sweep)`, () => {
    const line = seg(1, P(0, 0), P(100, 0));
    expect(all([line], flat, { perpendicular: true }, null)).toHaveLength(0);
    const A = flat.userToSheet(P(40, 30));
    const c = all([line], flat, { perpendicular: true }, A);
    expect(c).toHaveLength(1);
    near(flat.sheetToUser(c[0] as Pt), { x: 40, y: 0 }, 1e-9);
    // cerchio (0,0) r5 nel foglio e punto (10,10): i due piedi stanno a +-45 gradi
    const sc = { prims: [mkRing(0, 0, 5, 0, Math.PI / 2, false)] }; // arco 0..90 gradi (basso a destra)
    const out: Cand[] = [];
    extraCandidates(sc, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, { perpendicular: true }, { x: 10, y: 10 }, (x, y, kind) => out.push({ x, y, kind }));
    expect(out).toHaveLength(1); // 45 gradi dentro, 225 gradi fuori
    near(out[0] as Pt, { x: 5 * Math.SQRT1_2, y: 5 * Math.SQRT1_2 }, 1e-12);
  });
  it(`il punto di partenza sul tratto: il piede coincide con lui e non si offre`, () => {
    const line = seg(1, P(0, 0), P(100, 0));
    const A = flat.userToSheet(P(40, 0));
    expect(all([line], flat, { perpendicular: true }, A)).toHaveLength(0);
  });
  it(`con /Rotate 90 e CropBox: il piede e\' lo stesso punto della pagina (calcolo indipendente nello spazio utente)`, () => {
    const line = seg(1, P(100, 100), P(300, 160));
    const Au = P(180, 260);
    const A = rotCrop.userToSheet(Au);
    const c = all([line], rotCrop, { perpendicular: true }, A);
    expect(c).toHaveLength(1);
    // piede nello spazio utente: proiezione di Au sulla retta
    const dx = 200;
    const dy = 60;
    const t = ((Au.x - 100) * dx + (Au.y - 100) * dy) / (dx * dx + dy * dy);
    near(c[0] as Pt, rotCrop.userToSheet(P(100 + t * dx, 100 + t * dy)), 1e-9);
  });
});

describe('Tangente', () => {
  it(`da un punto esterno: due punti, con il raggio perpendicolare alla tangente (prova indipendente, 1e-9)`, () => {
    const c = C(0, 0, 5);
    const A = { x: 13, y: 0 };
    const t = tangentPoints(c, A.x, A.y);
    expect(t).toHaveLength(2);
    const ys = t.map((q) => q.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-60 / 13, 12);
    expect(ys[1]).toBeCloseTo(60 / 13, 12);
    t.forEach((q) => {
      expect(Math.hypot(q.x - c.cx, q.y - c.cy)).toBeCloseTo(5, 12); // sul cerchio
      expect((q.x - c.cx) * (q.x - A.x) + (q.y - c.cy) * (q.y - A.y)).toBeCloseTo(0, 9); // raggio perpendicolare alla tangente
      expect(q.x).toBeCloseTo(25 / 13, 12);
    });
  });
  it(`prova indipendente su 200 casi casuali (centri, raggi e punti qualsiasi)`, () => {
    let s = 12345;
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 200; i++) {
      const c = C(rnd() * 400 - 200, rnd() * 400 - 200, 1 + rnd() * 100);
      const A = { x: rnd() * 600 - 300, y: rnd() * 600 - 300 };
      const d = Math.hypot(A.x - c.cx, A.y - c.cy);
      const t = tangentPoints(c, A.x, A.y);
      if (d <= c.r + 1e-9 * Math.max(1, c.r)) {
        expect(t).toHaveLength(0);
        continue;
      }
      expect(t).toHaveLength(2);
      for (const q of t) {
        expect(Math.abs(Math.hypot(q.x - c.cx, q.y - c.cy) - c.r)).toBeLessThan(1e-9);
        expect(Math.abs((q.x - c.cx) * (q.x - A.x) + (q.y - c.cy) * (q.y - A.y))).toBeLessThan(1e-7); // tolleranza sul prodotto (scala 1e4)
        // la lunghezza della tangente e' sqrt(d^2 - r^2)
        expect(Math.abs(Math.hypot(q.x - A.x, q.y - A.y) - Math.sqrt(d * d - c.r * c.r))).toBeLessThan(1e-9);
      }
    }
  });
  it(`dentro, sul cerchio, nel centro: nessuno`, () => {
    expect(tangentPoints(C(0, 0, 5), 3, 0)).toHaveLength(0);
    expect(tangentPoints(C(0, 0, 5), 5, 0)).toHaveLength(0);
    expect(tangentPoints(C(0, 0, 5), 0, 0)).toHaveLength(0);
    expect(tangentPoints(C(0, 0, 5), 5 + 1e-10, 0)).toHaveLength(0); // sul cerchio entro la tolleranza
    expect(tangentPoints(C(0, 0, 5), 5 + 1e-4, 0)).toHaveLength(2);
  });
  it(`non sui tratti; sull\'arco solo i punti dentro lo sweep; senza punto di partenza nessuno`, () => {
    expect(all([seg(1, P(0, 0), P(100, 0))], flat, { tangent: true }, flat.userToSheet(P(50, 50)))).toHaveLength(0);
    const sc = { prims: [mkRing(0, 0, 5, 0, Math.PI / 2, false)] };
    const out: Cand[] = [];
    // da (13,0) i punti sono (25/13, +-60/13): solo (25/13, +60/13) sta nell'arco 0..90 gradi (basso a destra, y > 0)
    extraCandidates(sc, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, { tangent: true }, { x: 13, y: 0 }, (x, y, kind) => out.push({ x, y, kind }));
    expect(out).toHaveLength(1);
    near(out[0] as Pt, { x: 25 / 13, y: 60 / 13 }, 1e-12);
    const none: Cand[] = [];
    extraCandidates(sc, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, { tangent: true }, null, (x, y, kind) => none.push({ x, y, kind }));
    expect(none).toHaveLength(0);
  });
  it(`con /Rotate 90 e CropBox: i punti di tangenza sono quelli della pagina (calcolo indipendente nello spazio utente)`, () => {
    const o = circle(1, P(200, 300), P(250, 300)); // r 50
    const Au = P(400, 300);
    const c = all([o], rotCrop, { tangent: true }, rotCrop.userToSheet(Au));
    expect(c).toHaveLength(2);
    const d = 200;
    const phi = Math.acos(50 / d);
    const want = [P(200 + 50 * Math.cos(phi), 300 + 50 * Math.sin(phi)), P(200 + 50 * Math.cos(phi), 300 - 50 * Math.sin(phi))].map((u) => rotCrop.userToSheet(u));
    const got = [...c].sort((a, b) => a.x - b.x || a.y - b.y);
    const exp = [...want].sort((a, b) => a.x - b.x || a.y - b.y);
    got.forEach((g, i) => near(g, exp[i] as Pt, 1e-9));
  });
});
