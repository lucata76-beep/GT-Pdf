// Prove unitarie del riconoscimento degli anelli del PDF (V3.3a, CP7f): `extractGeometry` con `recognizeArcs` (src/pdf/geometry.ts) e i punti Centro e Quadrante nel foglio
// (src/pdf/ringPoints.ts). I valori attesi sono calcolati QUI da costruzioni note (arcChain di arcTestUtils.ts, con le coordinate arrotondate a Float32 come le da' PDF.js) e con un metodo
// INDIPENDENTE dal codice provato: i quadranti attesi si ricavano campionando fittamente l'arco VERO, portandolo nel foglio con `PageGeometry` e guardando quali dei quattro angoli del foglio
// (0, 90, 180 e 270 gradi) i campioni coprono: nessun segno del verso, nessun angolo di partenza e nessuna formula degli angoli dell'app.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, describe, expect, it } from 'vitest';
import { PageGeometry, type PageSpec } from '../geometry/page';
import { arcChain, polygonOnCircle, trueMaxRelDeviation } from './arcTestUtils';
import { DRAW_CLOSE, DRAW_CURVE_TO, DRAW_LINE_TO, DRAW_MOVE_TO, DRAW_QUAD_TO, type GeometryStats, type PdfGeometry, circleFrom4Cubics, extractGeometry, withinCp7aTolerance } from './geometry';
import { type RingPoints, buildRingPoints, buildRingSource, ringCount } from './ringPoints';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
type Op = [string, unknown];
const DEG = Math.PI / 180;
const f32 = (cmds: number[]): Float32Array => new Float32Array(cmds); // come PDF.js: i numeri dei percorsi sono Float32
const path = (paint: string, cmds: number[]): Op => ['constructPath', [OPS[paint], [f32(cmds)], null]];
const M = (x: number, y: number): number[] => [DRAW_MOVE_TO, x, y];
const Lt = (x: number, y: number): number[] => [DRAW_LINE_TO, x, y];
const C = (a: number, b: number, c: number, d: number, e: number, f: number): number[] => [DRAW_CURVE_TO, a, b, c, d, e, f];
const Q = (a: number, b: number, c: number, d: number): number[] => [DRAW_QUAD_TO, a, b, c, d];
const Z: number[] = [DRAW_CLOSE];
const cat = (...p: number[][]): number[] => p.flat();
function chainCmds(chain: number[][], close = false): number[] {
  const c0 = chain[0] as number[];
  return cat(M(c0[0] as number, c0[1] as number), ...chain.map((c) => C(c[2] as number, c[3] as number, c[4] as number, c[5] as number, c[6] as number, c[7] as number)), close ? Z : []);
}
const polyCmds = (pts: { x: number; y: number }[], close = true): number[] => cat(M((pts[0] as { x: number }).x, (pts[0] as { y: number }).y), ...pts.slice(1).map((p) => Lt(p.x, p.y)), close ? Z : []);

interface Extracted {
  g: PdfGeometry;
  stats: GeometryStats;
}
function extract(list: Op[], opts: { visible?: (d: unknown) => boolean; measureArcs?: boolean; recognizeArcs?: boolean } = {}): Extracted {
  const r = extractGeometry({
    fnArray: list.map(([n]) => OPS[n] as number),
    argsArray: list.map(([, a]) => a),
    ops: OPS,
    isLayerVisible: opts.visible ?? (() => true),
    ...(opts.measureArcs ? { measureArcs: true } : {}),
    ...(opts.recognizeArcs === false ? {} : { recognizeArcs: true }),
  });
  if (!r.ok) throw new Error(r.reason);
  return { g: r.geometry, stats: r.stats };
}
const sheetOf = (spec: PageSpec): PageGeometry => new PageGeometry(spec);
const A: PageSpec = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1 };

/** Un arco VERO di prova: centro e raggio (unita' utente PRIMA della cm), angolo di partenza e angolo coperto in gradi (positivo = antiorario con Y verso l'alto), numero di cubiche. */
interface Spec {
  cx: number;
  cy: number;
  r: number;
  start: number;
  sweep: number;
  parts: number;
  close?: boolean;
}
/** La matrice cm [a b c d e f] come la scrive PDF (x' = a x + c y + e), da applicare ai punti prima del foglio. */
type Cm = readonly [number, number, number, number, number, number];
const applyCm = (m: Cm, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Gli attesi nel foglio, calcolati senza il codice dell'app: centro e raggio (con la cm e il foglio) e quali dei quattro quadranti sono coperti dai campioni dell'arco vero. */
function expected(s: Spec, spec: PageSpec, cm: Cm = [1, 0, 0, 1, 0, 0]): { cx: number; cy: number; r: number; quadrants: Set<number> } {
  const g = sheetOf(spec);
  const [ux, uy] = applyCm(cm, s.cx, s.cy);
  const c = g.userToSheet({ x: ux, y: uy });
  const kcm = Math.sqrt(Math.abs(cm[0] * cm[3] - cm[1] * cm[2])); // scala uniforme della cm
  const r = s.r * kcm * spec.userUnit;
  const quadrants = new Set<number>();
  const steps = Math.max(2, Math.ceil(Math.abs(s.sweep) / 0.02));
  const angles: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (s.start + (s.sweep * i) / steps) * DEG;
    const [px, py] = applyCm(cm, s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a));
    const q = g.userToSheet({ x: px, y: py });
    angles.push((Math.atan2(q.y - c.y, q.x - c.x) * 180) / Math.PI);
  }
  for (const q of [0, 90, 180, 270]) {
    const target = q > 180 ? q - 360 : q;
    let best = Infinity;
    for (const a of angles) {
      const d = Math.abs(((a - target + 540) % 360) - 180);
      if (d < best) best = d;
    }
    if (best <= 0.05) quadrants.add(q);
  }
  return { cx: c.x, cy: c.y, r, quadrants };
}
/** I quattro punti del foglio per angolo (0, 90, 180, 270) attorno a un centro e raggio dati. */
const quadPoint = (cx: number, cy: number, r: number, q: number): [number, number] => (q === 0 ? [cx + r, cy] : q === 90 ? [cx, cy + r] : q === 180 ? [cx - r, cy] : [cx, cy - r]);

/** Confronta i punti trovati con gli attesi: stesso numero, ogni punto atteso ha il suo entro la tolleranza. */
function expectPoints(rp: RingPoints, exp: { cx: number; cy: number; r: number; quadrants: Set<number> }, tol: number, label: string): void {
  const xy = rp.points.xy;
  expect(rp.stats.centers, label).toBe(1);
  expect(rp.points.nEnd, label).toBe(1);
  expect(Math.hypot((xy[0] as number) - exp.cx, (xy[1] as number) - exp.cy), `${label}: centro`).toBeLessThanOrEqual(tol);
  expect(rp.stats.quadrants, `${label}: quadranti trovati`).toBe(exp.quadrants.size);
  const found: [number, number][] = [];
  for (let i = 0; i < rp.points.nMid; i++) found.push([xy[2 * (1 + i)] as number, xy[2 * (1 + i) + 1] as number]);
  for (const q of exp.quadrants) {
    const [qx, qy] = quadPoint(exp.cx, exp.cy, exp.r, q);
    expect(found.some(([x, y]) => Math.hypot(x - qx, y - qy) <= tol), `${label}: quadrante a ${q} gradi`).toBe(true);
  }
}

/** Tolleranza del centro e dei quadranti: lo scostamento VERO della cubica (campionamento fitto) amplificato dal condizionamento dell'arco (8 / angolo^2), come in geometryArcs.test.ts, per 3 volte + il Float32. */
function tolFor(s: Spec, chain: number[][], scale: number): number {
  const eps = Math.max(...chain.map((c) => trueMaxRelDeviation(s.cx, s.cy, s.r, c, 4000)));
  const th = Math.min(Math.abs(s.sweep) * DEG, Math.PI);
  const amp = Math.max(1, 8 / (th * th));
  return (3 * eps * amp * s.r + 2e-5 * Math.max(Math.abs(s.cx), Math.abs(s.cy), s.r)) * scale + 1e-9;
}

describe('anelli riconosciuti: centro, raggio e quadranti attesi (calcolati nel test)', () => {
  const R = 40;
  const base: Spec[] = [
    { cx: 300, cy: 400, r: R, start: 0, sweep: 360, parts: 4, close: true }, // cerchio intero
    { cx: 200, cy: 300, r: R, start: 20, sweep: 30, parts: 1 },
    { cx: 200, cy: 300, r: R, start: 50, sweep: 60, parts: 1 },
    { cx: 200, cy: 300, r: R, start: 100, sweep: 90, parts: 1 }, // da 100 a 190: contiene 180
    { cx: 200, cy: 300, r: R, start: 10, sweep: 100, parts: 2 }, // da 10 a 110: contiene 90
    { cx: 200, cy: 300, r: R, start: 30, sweep: 180, parts: 2 }, // da 30 a 210: contiene 90 e 180
    { cx: 200, cy: 300, r: R, start: 45, sweep: 270, parts: 3 }, // da 45 a 315: 90, 180, 270
    { cx: 200, cy: 300, r: R, start: 80, sweep: -100, parts: 2 }, // orario da 80 a -20: contiene 0
    { cx: 200, cy: 300, r: R, start: 340, sweep: 60, parts: 1 }, // attraversa 0: da 340 a 40
    { cx: 200, cy: 300, r: R, start: 200, sweep: -160, parts: 2 }, // orario da 200 a 40: 90 e 180
  ];
  const pages: [string, PageSpec][] = [
    ['/Rotate 0', A],
    ['/Rotate 90', { view: [0, 0, 600, 800], rotate: 90, userUnit: 1 }],
    ['/Rotate 180', { view: [0, 0, 600, 800], rotate: 180, userUnit: 1 }],
    ['/Rotate 270', { view: [0, 0, 600, 800], rotate: 270, userUnit: 1 }],
    ['UserUnit 2.5', { view: [0, 0, 600, 800], rotate: 0, userUnit: 2.5 }],
    ['CropBox e /Rotate 90', { view: [50, 50, 550, 750], rotate: 90, userUnit: 1 }],
  ];
  for (const [pname, spec] of pages) {
    for (const s of base) {
      it(`${pname}: arco da ${s.start} gradi, ${s.sweep} gradi in ${s.parts} cubica/che${s.close ? ' (cerchio intero chiuso)' : ''}`, () => {
        const chain = arcChain(s.cx, s.cy, s.r, s.start, s.sweep, s.parts);
        const { g, stats } = extract([path('stroke', chainCmds(chain, s.close))]);
        expect(ringCount(g)).toBe(1);
        expect((g.rings as NonNullable<typeof g.rings>).full[0]).toBe(s.close ? 1 : 0);
        const rp = buildRingPoints(g, sheetOf(spec));
        const exp = expected(s, spec);
        expectPoints(rp, exp, tolFor(s, chain, spec.userUnit), `${pname}`);
        // il raggio non e' un punto, ma e' dentro i quadranti: nei cerchi interi tutti e quattro
        if (s.close) expect(rp.stats.quadrants).toBe(4);
        expect(rp.stats.rings).toBe(1);
        expect(rp.stats.circles).toBe(s.close ? 1 : 0);
        expect(rp.stats.arcs).toBe(s.close ? 0 : 1);
        expect(stats.shapesCand.arcs.cubicOpen.every((b) => b === null)).toBe(true); // la misura (CP7e) non e' accesa: nessuna statistica `arcs`
      });
    }
  }
  it('un arco da 10 a 100 gradi ha solo il quadrante a 90; un cerchio intero ne ha 4 (a ogni raggio)', () => {
    const arc = arcChain(300, 400, 25, 10, 90, 1);
    const rp1 = buildRingPoints(extract([path('stroke', chainCmds(arc))]).g, sheetOf(A));
    expect(rp1.stats.quadrants).toBe(1);
    // una pagina grande: il cerchio di raggio 500 deve starci per intero (altrimenti i suoi quadranti sono fuori dal foglio e si scartano: e' provato nel test sui bordi)
    const big: PageSpec = { view: [0, 0, 2000, 2000], rotate: 0, userUnit: 1 };
    for (const r of [0.5, 10, 500]) {
      const rp = buildRingPoints(extract([path('stroke', chainCmds(arcChain(1000, 1000, r, 0, 360, 4), true))]).g, sheetOf(big));
      expect(rp.stats.circles).toBe(1);
      expect(rp.stats.quadrants).toBe(4);
      expect(Math.hypot((rp.points.xy[0] as number) - 1000, (rp.points.xy[1] as number) - 1000)).toBeLessThan(5e-4 * r + 2e-4);
    }
  });
  it('sotto una cm con scala uniforme e rotazione e con un ribaltamento: centro e quadranti del foglio coerenti', () => {
    const cms: [string, Cm][] = [
      ['scala 2:2', [2, 0, 0, 2, 10, 20]],
      ['rotazione di 30 gradi e scala 0.5', [0.5 * Math.cos(30 * DEG), 0.5 * Math.sin(30 * DEG), -0.5 * Math.sin(30 * DEG), 0.5 * Math.cos(30 * DEG), 100, 50]],
      ['ribaltamento di Y', [1, 0, 0, -1, 0, 700]],
      ['ribaltamento di X e scala 1.5', [-1.5, 0, 0, 1.5, 600, 0]],
      ['rotazione di 90 gradi e ribaltamento', [0, 1, 1, 0, 0, 0]],
    ];
    for (const [name, cm] of cms) {
      for (const s of [
        { cx: 150, cy: 250, r: 30, start: 20, sweep: 160, parts: 2 },
        { cx: 150, cy: 250, r: 30, start: 0, sweep: 360, parts: 4, close: true },
        { cx: 150, cy: 250, r: 30, start: 300, sweep: -100, parts: 2 },
      ] as Spec[]) {
        const chain = arcChain(s.cx, s.cy, s.r, s.start, s.sweep, s.parts);
        const { g } = extract([['transform', cm], path('stroke', chainCmds(chain, s.close))]);
        expect(ringCount(g), name).toBe(1);
        const rp = buildRingPoints(g, sheetOf(A));
        const kcm = Math.sqrt(Math.abs(cm[0] * cm[3] - cm[1] * cm[2]));
        expectPoints(rp, expected(s, A, cm), tolFor(s, chain, kcm), `${name}, arco da ${s.start} di ${s.sweep}`);
      }
    }
  });
});

describe('nessun anello (le forme che NON si riconoscono)', () => {
  const count = (list: Op[], opts?: Parameters<typeof extract>[1]): number => ringCount(extract(list, opts).g);
  it('poligoni fitti su un cerchio di 24 e di 64 vertici: nessun anello', () => {
    expect(count([path('stroke', polyCmds(polygonOnCircle(300, 400, 60, 24)))])).toBe(0);
    expect(count([path('stroke', polyCmds(polygonOnCircle(300, 400, 60, 64)))])).toBe(0);
  });
  it('una S (due archi opposti): nessun anello; un cerchio sotto una cm 2:1 (ellisse): nessun anello', () => {
    const c1 = arcChain(0, 0, 50, 0, 90, 1)[0] as number[];
    const [jx, jy] = [c1[6] as number, c1[7] as number];
    const c2 = arcChain(2 * jx, 2 * jy, 50, 270, -90, 1)[0] as number[];
    expect(count([path('stroke', chainCmds([c1, c2]))])).toBe(0);
    expect(count([['transform', [2, 0, 0, 1, 0, 0]], path('stroke', chainCmds(arcChain(150, 400, 50, 0, 360, 4), true))])).toBe(0);
    // la stessa catena senza la cm e' un cerchio: il controllo dice che la cm e' la causa
    expect(count([path('stroke', chainCmds(arcChain(150, 400, 50, 0, 360, 4), true))])).toBe(1);
  });
  it('una cubica quasi rettilinea (raggio oltre 100 volte la diagonale): nessun anello', () => {
    expect(count([path('stroke', cat(M(0, 100), C(10, 100.04, 20, 100.04, 30, 100)))])).toBe(0);
    expect(count([path('stroke', cat(M(0, 100), C(10, 100, 20, 100, 30, 100)))])).toBe(0); // allineata: raggio non determinabile
  });
  it('una catena di 9 cubiche: nessun anello; di 8: si', () => {
    expect(count([path('stroke', chainCmds(arcChain(300, 400, 40, 0, 320, 9)))])).toBe(0);
    expect(count([path('stroke', chainCmds(arcChain(300, 400, 40, 0, 320, 8)))])).toBe(1);
    expect(count([path('stroke', chainCmds(arcChain(300, 400, 40, 0, 360, 12), true))])).toBe(0);
  });
  it('un sottopercorso misto (lineTo e cubiche: rettangolo con gli angoli arrotondati) e le quadratiche: nessun anello', () => {
    const rounded = cat(M(100, 100), Lt(200, 100), C(210, 100, 220, 110, 220, 120), Lt(220, 200), C(220, 210, 210, 220, 200, 220), Lt(100, 220), Z);
    expect(count([path('stroke', rounded)])).toBe(0);
    expect(count([path('stroke', cat(M(0, 0), Q(5, 5, 10, 0), C(12, 2, 14, 2, 16, 0)))])).toBe(0);
    expect(count([path('stroke', cat(M(0, 0), Q(5, 5, 10, 0)))])).toBe(0);
  });
  it('un percorso solo riempito (non candidato) o solo di ritaglio: nessun anello; fillStroke si', () => {
    const c = chainCmds(arcChain(300, 400, 40, 0, 360, 4), true);
    expect(count([path('fill', c)])).toBe(0);
    expect(count([path('endPath', c)])).toBe(0);
    expect(count([path('fillStroke', c)])).toBe(1);
    expect(count([path('stroke', c)])).toBe(1);
  });
  it('un arco in un livello spento: riconosciuto dall\'estrattore ma senza punti (conta come «in livelli spenti»); acceso: i suoi punti', () => {
    const arc = path('stroke', chainCmds(arcChain(300, 400, 40, 0, 360, 4), true));
    const off = extract([['beginMarkedContentProps', ['OC', { type: 'OCG', id: 'x' }]], arc, ['endMarkedContent', null]], { visible: () => false });
    expect(ringCount(off.g)).toBe(1);
    const rpOff = buildRingPoints(off.g, sheetOf(A));
    expect(rpOff.stats).toMatchObject({ rings: 0, hiddenRings: 1, centers: 0, quadrants: 0 });
    expect(rpOff.points.nEnd + rpOff.points.nMid).toBe(0);
    const on = extract([['beginMarkedContentProps', ['OC', { type: 'OCG', id: 'x' }]], arc, ['endMarkedContent', null]], { visible: () => true });
    expect(buildRingPoints(on.g, sheetOf(A)).stats).toMatchObject({ rings: 1, hiddenRings: 0, centers: 1, quadrants: 4 });
  });
  it('un anello fuori dal foglio: il centro e i quadranti oltre il margine si scartano, quelli entro il margine si riportano sul bordo', () => {
    // cerchio con il centro a x = 700 (foglio largo 600), raggio 50: nessun punto dentro. Poi un cerchio con il centro sul bordo destro (x = 600): centro sul bordo
    const out = buildRingPoints(extract([path('stroke', chainCmds(arcChain(700, 400, 50, 0, 360, 4), true))]).g, sheetOf(A));
    expect(out.stats.centers).toBe(0);
    expect(out.stats.outsidePoints).toBeGreaterThanOrEqual(1);
    const edge = buildRingPoints(extract([path('stroke', chainCmds(arcChain(600, 400, 50, 0, 360, 4), true))]).g, sheetOf(A));
    expect(edge.stats.centers).toBe(1);
    expect(edge.points.xy[0]).toBeLessThanOrEqual(600);
    expect(edge.stats.quadrants).toBe(3); // il quadrante a destra sta a 650: fuori
  });
});

describe('il riconoscimento e\' spento di serie; con la misura una sola misura serve a tutti e due', () => {
  const list: Op[] = [
    path('stroke', chainCmds(arcChain(300, 400, 40, 0, 360, 4), true)),
    path('stroke', chainCmds(arcChain(100, 100, 30, 0, 150, 2))),
    path('stroke', polyCmds(polygonOnCircle(300, 400, 60, 20))),
    path('fillStroke', cat(M(0, 0), Lt(5, 5), C(6, 6, 7, 7, 8, 8), Z)),
    path('stroke', chainCmds(arcChain(300, 400, 40, 0, 320, 9))),
  ];
  const strip = (s: GeometryStats): unknown => JSON.parse(JSON.stringify(s));
  it('senza `recognizeArcs` non c\'e\' `rings` e tutte le statistiche sono identiche; con il flag le primitive memorizzate non cambiano', () => {
    const off = extract(list, { recognizeArcs: false });
    const on = extract(list);
    expect(off.g.rings).toBeUndefined();
    expect(on.g.rings).toBeDefined();
    expect(strip(off.stats)).toEqual(strip(on.stats));
    expect(on.g.bytes).toBe(off.g.bytes);
    expect(Array.from(on.g.cubicXY)).toEqual(Array.from(off.g.cubicXY));
    expect(Array.from(on.g.lineXY)).toEqual(Array.from(off.g.lineXY));
    expect(on.g.nCubics).toBe(off.g.nCubics);
    expect(ringCount(on.g)).toBe(2); // il cerchio e l'arco di 150 gradi; il misto, il poligono e le 9 cubiche no
  });
  it('con `measureArcs` e `recognizeArcs` insieme: le statistiche della misura sono quelle della sola misura, gli anelli quelli del solo riconoscimento', () => {
    const only = extract(list, { measureArcs: true, recognizeArcs: false });
    const both = extract(list, { measureArcs: true });
    expect(strip(both.stats)).toEqual(strip(only.stats));
    expect(Array.from((both.g.rings as NonNullable<typeof both.g.rings>).xy)).toEqual(Array.from((extract(list).g.rings as NonNullable<typeof both.g.rings>).xy));
    expect(ringCount(both.g)).toBe(2);
  });
  it('gli stessi numeri della misura: l\'anello e\' un\'arco/cerchio che `withinCp7aTolerance` accetta, e solo allora', () => {
    // un cerchio standard (4 cubiche da 90 gradi) e' accettato; una cubica da 180 gradi (scostamento ~1e-2) no
    expect(ringCount(extract([path('stroke', chainCmds(arcChain(300, 400, 100, 0, 360, 4), true))]).g)).toBe(1);
    expect(ringCount(extract([path('stroke', chainCmds(arcChain(300, 400, 100, 0, 180, 1)))]).g)).toBe(0);
    expect(withinCp7aTolerance(false, 100, 0, 0)).toBe(false);
    expect(circleFrom4Cubics(arcChain(300, 400, 100, 0, 360, 4).flat())).not.toBeNull(); // la regola di CP7a, invariata
  });
  it('Float32: lo stesso anello letto da numeri arrotondati a Float32 (come li da\' PDF.js) e da numeri in doppia precisione', () => {
    const chain = arcChain(300, 400, 20, 15, 200, 3);
    const f32g = extract([path('stroke', chainCmds(chain))]).g;
    const f64g = (() => {
      const r = extractGeometry({
        fnArray: [OPS['constructPath'] as number],
        argsArray: [[OPS['stroke'], [chainCmds(chain)], null]],
        ops: OPS,
        isLayerVisible: () => true,
        recognizeArcs: true,
      });
      if (!r.ok) throw new Error(r.reason);
      return r.geometry;
    })();
    expect(ringCount(f32g)).toBe(1);
    expect(ringCount(f64g)).toBe(1);
    const a = f32g.rings as NonNullable<typeof f32g.rings>;
    const b = f64g.rings as NonNullable<typeof f64g.rings>;
    expect(Math.hypot((a.xy[0] as number) - (b.xy[0] as number), (a.xy[1] as number) - (b.xy[1] as number))).toBeLessThan(1e-3);
    expect(Math.abs((a.xy[2] as number) - (b.xy[2] as number))).toBeLessThan(1e-3);
  });
});

describe('RingSource: l\'indice dei punti degli anelli', () => {
  it('Centri e Quadranti entro il raggio, nell\'ordine (prima i Centri), con la tipologia giusta; nulla oltre il raggio', () => {
    const rs = buildRingSource(extract([path('stroke', chainCmds(arcChain(300, 400, 40, 0, 360, 4), true))]).g, sheetOf(A));
    const got: [number, number, string][] = [];
    // il centro nel foglio: (300, 800 - 400); raggio 40
    rs.source.forEachNear(300, 400, 5, true, true, (x, y, k) => got.push([x, y, k]));
    expect(got.map((p) => p[2])).toEqual(['center']);
    got.length = 0;
    rs.source.forEachNear(340, 400, 3, true, true, (x, y, k) => got.push([x, y, k]));
    expect(got.map((p) => p[2])).toEqual(['quadrant']);
    got.length = 0;
    rs.source.forEachNear(300, 400, 5, false, true, (x, y, k) => got.push([x, y, k]));
    expect(got).toHaveLength(0); // solo Quadranti richiesti: il Centro non c'e'
    rs.source.forEachNear(320, 400, 5, true, true, (x, y, k) => got.push([x, y, k]));
    expect(got).toHaveLength(0); // a 20 pt dal centro e dai quadranti
    // tutti e cinque in un raggio grande: centro prima
    rs.source.forEachNear(300, 400, 100, true, true, (x, y, k) => got.push([x, y, k]));
    expect(got.map((p) => p[2])).toEqual(['center', 'quadrant', 'quadrant', 'quadrant', 'quadrant']);
  });
});

// Tabella per il resoconto (NON un'asserzione): quali archi standard rientrano in `withinCp7aTolerance`, calcolata dal codice, con 1 cubica e con piu' cubiche.
describe('tabella: archi standard (approssimazione di Bezier) accettati o no dal riferimento di CP7a', () => {
  const rows: string[] = [];
  const angles = [15, 30, 45, 60, 90, 120, 150, 180];
  for (const deg of angles) {
    for (const parts of [1, 2, 3, 4]) {
      if (parts > 1 && deg / parts < 15) continue; // sotto 15 gradi per cubica non ha senso
      if (parts > 1 && deg <= 90 && parts > 2) continue;
      it(`${deg} gradi in ${parts} ${parts === 1 ? 'cubica' : 'cubiche'}`, () => {
        const s: Spec = { cx: 300, cy: 400, r: 50, start: 20, sweep: deg, parts };
        const { g } = extract([path('stroke', chainCmds(arcChain(s.cx, s.cy, s.r, s.start, s.sweep, s.parts)))]);
        const ok = ringCount(g) === 1;
        const eps = Math.max(...arcChain(s.cx, s.cy, s.r, s.start, s.sweep, s.parts).map((c) => trueMaxRelDeviation(s.cx, s.cy, s.r, c, 4000)));
        rows.push(`| ${deg} gradi | ${parts} | ${eps.toExponential(2)} | ${ok ? 'si' : 'NO'} |`);
        expect(typeof ok).toBe('boolean');
      });
    }
  }
  afterAll(() => {
    console.log(['', '| arco | cubiche | scostamento VERO massimo (relativo) | anello riconosciuto |', '|---|---|---|---|', ...rows].join('\n'));
  });
});
