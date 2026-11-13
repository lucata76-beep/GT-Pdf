// Prove unitarie della misura degli archi (V3.2c, CP7e) a livello dell'estrattore (src/pdf/geometry.ts) e delle righe di «Copia misura» (src/pdf/geometryMeasure.ts): sottopercorsi di sole
// cubiche (aperti e chiusi, da 1 a 8 cubiche; oltre solo contati) e poligoni fitti (da 12 a 256 vertici; oltre solo contati). I valori attesi vengono da costruzioni note (raggio e angolo scelti
// QUI, arco con l'approssimazione standard di Bezier calcolata in arcTestUtils.ts) e dallo scostamento VERO delle cubiche calcolato per campionamento fitto: nessun numero atteso viene dal
// codice provato. L'adattamento del cerchio e' provato a parte in circleFit.test.ts. Le prove di CP7a e CP7c non sono toccate.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { ANGLE_MARGIN, type ArcBucket, absClass, angleClass, relClass } from './arcStats';
import { arcChain, arcCubic, pdfChain, pdfPolygon, polygonOnCircle, rng, trueMaxRelDeviation } from './arcTestUtils';
import { ARC_MAX_CUBICS, ARC_MAX_VERTICES } from './circleFit';
import {
  CIRCLE_MID_REL,
  CIRCLE_TOL_ABS,
  CIRCLE_TOL_REL,
  DRAW_CLOSE,
  DRAW_CURVE_TO,
  DRAW_LINE_TO,
  DRAW_MOVE_TO,
  DRAW_QUAD_TO,
  type GeometryStats,
  type ShapeStats,
  extractGeometry,
  withinCp7aTolerance,
} from './geometry';
import { measureLines, measurePage, measureText, readDocLayers } from './geometryMeasure';
import { makePdf } from './geometryTestUtils';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
type Op = [string, unknown];
const DEG = Math.PI / 180;
const path = (paint: string, cmds: number[]): Op => ['constructPath', [OPS[paint], [cmds], null]];
function run(list: Op[], visible: (d: unknown) => boolean = () => true): GeometryStats {
  const r = extractGeometry({ fnArray: list.map(([n]) => OPS[n] as number), argsArray: list.map(([, a]) => a), ops: OPS, isLayerVisible: visible });
  if (!r.ok) throw new Error(r.reason);
  return r.stats;
}
const M = (x: number, y: number): number[] => [DRAW_MOVE_TO, x, y];
const Lt = (x: number, y: number): number[] => [DRAW_LINE_TO, x, y];
const C = (a: number, b: number, c: number, d: number, e: number, f: number): number[] => [DRAW_CURVE_TO, a, b, c, d, e, f];
const Q = (a: number, b: number, c: number, d: number): number[] => [DRAW_QUAD_TO, a, b, c, d];
const Z: number[] = [DRAW_CLOSE];
const cat = (...p: number[][]): number[] => p.flat();
/** Comandi di una catena di cubiche (la prima parte dal suo primo punto). */
function chainCmds(chain: number[][], close = false): number[] {
  const c0 = chain[0] as number[];
  return cat(M(c0[0] as number, c0[1] as number), ...chain.map((c) => C(c[2] as number, c[3] as number, c[4] as number, c[5] as number, c[6] as number, c[7] as number)), close ? Z : []);
}
/** Comandi di un poligono: moveTo, lineTo per gli altri vertici, e (`repeatFirst`) un lineTo finale che torna al primo; `close`: closePath. */
function polyCmds(pts: { x: number; y: number }[], close: boolean, repeatFirst = false): number[] {
  const p0 = pts[0] as { x: number; y: number };
  return cat(M(p0.x, p0.y), ...pts.slice(1).map((p) => Lt(p.x, p.y)), repeatFirst ? Lt(p0.x, p0.y) : [], close ? Z : []);
}
const only = <T>(a: (T | null)[]): T[] => a.filter((x): x is T => x !== null);
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

/** Limiti dell'errore di raggio e angolo di una catena esatta: scostamento VERO delle cubiche (campionamento fitto) amplificato dal condizionamento dell'arco (relativo del raggio: 8 / angolo^2 al primo ordine). */
function bounds(chain: number[][], cx: number, cy: number, r: number, deg: number): { relR: number; angDeg: number } {
  const eps = Math.max(...chain.map((c) => trueMaxRelDeviation(cx, cy, r, c, 4000)));
  const th = Math.min(deg * DEG, Math.PI);
  const A = Math.max(1, 8 / (th * th));
  return { relR: eps * A + 1e-9, angDeg: (3 * eps * A + 1e-9) / DEG };
}

describe('archi esatti di sole cubiche: raggio e angolo noti entro lo scostamento calcolato indipendentemente', () => {
  const radii = [0.5, 10, 500];
  // [angolo totale, cubiche]: ogni cubica copre al piu' 90 gradi, salvo i casi di una cubica oltre 90 (120 e 180 in una o due)
  const cases: [number, number][] = [
    [30, 1],
    [60, 1],
    [90, 1],
    [120, 2],
    [180, 2],
    [180, 1],
    [270, 3],
    [330, 4],
  ];
  for (const r of radii) {
    for (const [deg, parts] of cases) {
      for (const closePath of [false, true]) {
        it(`raggio ${r}, ${deg} gradi in ${parts} cubica/che, ${closePath ? 'con closePath (chiuso)' : 'senza closePath (aperto)'}`, () => {
          const [cx, cy] = [300, 400];
          const chain = arcChain(cx, cy, r, 20, deg, parts);
          const s = run([path('stroke', chainCmds(chain, closePath))]);
          const b = bounds(chain, cx, cy, r, deg);
          for (const g of [s.shapesAll, s.shapesCand]) {
            const slots = closePath ? g.arcs.cubicClosed : g.arcs.cubicOpen;
            const other = closePath ? g.arcs.cubicOpen : g.arcs.cubicClosed;
            expect(only(other)).toHaveLength(0);
            expect(only(slots)).toHaveLength(1);
            const bk = slots[parts - 1] as ArcBucket;
            expect(bk).toBeTruthy();
            expect(bk.subpaths).toBe(1);
            expect(bk.arcs).toBe(1);
            expect(bk.straight).toBe(0);
            expect(bk.units).toBe(parts);
            expect(Math.abs((bk.radiusMin as number) - r) / r).toBeLessThanOrEqual(b.relR);
            expect(Math.abs((bk.angleMin as number) - deg)).toBeLessThanOrEqual(b.angDeg);
            // la classe dell'angolo e quella dello scostamento sono coerenti con i valori misurati
            expect(bk.angleHist[angleClass(bk.angleMin as number)]).toBe(1);
            expect(bk.relHist[relClass(bk.relMax)]).toBe(1);
            expect(bk.absHist[absClass(bk.absMax)]).toBe(1);
            expect(bk.relMax).toBeLessThan(0.02);
            expect(bk.tanMeasured).toBe(1);
            expect(bk.jointMax === -1 ? parts === 1 : bk.jointMax < 1e-6).toBe(true);
          }
        });
      }
    }
  }
  it('360 gradi in 4 cubiche: chiuso (con closePath o per coincidenza); l\'angolo e\' «circa 360»', () => {
    for (const close of [false, true]) {
      const chain = arcChain(300, 400, 25, 0, 360, 4);
      const s = run([path('stroke', chainCmds(chain, close))]);
      const bk = s.shapesCand.arcs.cubicClosed[3] as ArcBucket;
      expect(bk.arcs).toBe(1);
      expect(Math.abs((bk.angleMin as number) - 360)).toBeLessThan(0.1);
      expect(bk.angleHist[5]).toBe(1); // «circa 360»
      // il raggio medio dei punti sta fra il minimo e il massimo dello scostamento VERO della cubica standard di 90 gradi (~2.7e-4, calcolato con il campionamento fitto)
      expect(Math.abs((bk.radiusMin as number) - 25) / 25).toBeLessThanOrEqual(trueMaxRelDeviation(0, 0, 25, arcCubic(0, 0, 25, 0, Math.PI / 2)));
      expect(bk.withinCp7a).toBe(1);
      expect(s.shapesCand.circles4).toBe(1); // la regola di CP7a (invariata) riconosce lo stesso cerchio
    }
  });
  it('le classi degli angoli: 30 (fino a 90), 90 (fino a 90, con il margine), 120 e 180 (fino a 180), 270 (fino a 270), 330 (meno di 360), 360 (circa 360)', () => {
    const idx = (deg: number, parts: number): number => {
      const s = run([path('stroke', chainCmds(arcChain(300, 400, 40, 5, deg, parts), true))]);
      const hist = (s.shapesCand.arcs.cubicClosed[parts - 1] as ArcBucket).angleHist;
      return hist.findIndex((n) => n === 1);
    };
    expect(idx(8, 1)).toBe(0);
    expect(idx(30, 1)).toBe(1);
    expect(idx(90, 1)).toBe(1);
    expect(idx(120, 2)).toBe(2);
    expect(idx(180, 2)).toBe(2);
    expect(idx(270, 3)).toBe(3);
    expect(idx(330, 4)).toBe(4);
    expect(idx(360, 4)).toBe(5);
    expect(ANGLE_MARGIN).toBe(0.5);
  });
});

describe('casi negativi', () => {
  it('un cerchio sotto una cm con scala NON uniforme (2:1) non e\' un cerchio: l\'estrazione applica la cm alle coordinate (diventa un\'ellisse di semiassi 2R e R)', () => {
    const chain = arcChain(150, 400, 50, 0, 360, 4);
    const s = run([['transform', [2, 0, 0, 1, 0, 0]], path('stroke', chainCmds(chain, true))]);
    const bk = s.shapesCand.arcs.cubicClosed[3] as ArcBucket;
    expect(bk.arcs).toBe(1);
    // l'ellisse 2R x R: il cerchio ai minimi quadrati ha raggio ~ (2R + R) / 2 = 1.5 R e gli scostamenti arrivano a ~ R / 2 = 0.33 del raggio adattato
    expect(bk.relMax).toBeGreaterThan(0.2);
    expect(Math.abs((bk.radiusMin as number) - 75) / 75).toBeLessThan(0.05);
    expect(bk.withinCp7a).toBe(0);
    expect(s.shapesCand.circles4).toBe(0); // anche per la regola di CP7a
    // controllo: la stessa catena con scala uniforme 2:2 e' un cerchio di raggio 100
    const u = run([['transform', [2, 0, 0, 2, 0, 0]], path('stroke', chainCmds(chain, true))]);
    const ub = u.shapesCand.arcs.cubicClosed[3] as ArcBucket;
    expect(ub.relMax).toBeLessThan(1e-3);
    expect(Math.abs((ub.radiusMin as number) - 100) / 100).toBeLessThan(1e-3);
    expect(ub.withinCp7a).toBe(1);
    // e con una rotazione (che conserva le distanze) resta un cerchio di raggio 50
    const a = 0.6;
    const rot = run([['transform', [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 10, 20]], path('stroke', chainCmds(chain, true))]);
    const rb = rot.shapesCand.arcs.cubicClosed[3] as ArcBucket;
    expect(Math.abs((rb.radiusMin as number) - 50) / 50).toBeLessThan(1e-3);
    expect(rb.withinCp7a).toBe(1);
  });
  it('una S di due cubiche con flesso non e\' un arco: scostamento relativo grande, giunto a tangente continua', () => {
    const c1 = arcCubic(0, 0, 50, 0, 90 * DEG);
    const [jx, jy] = [c1[6] as number, c1[7] as number];
    const c2 = arcCubic(2 * jx, 2 * jy, 50, 270 * DEG, -90 * DEG);
    const s = run([path('stroke', chainCmds([c1, c2]))]);
    const bk = s.shapesCand.arcs.cubicOpen[1] as ArcBucket;
    expect(bk.subpaths).toBe(1);
    expect(bk.withinCp7a).toBe(0);
    // S con simmetria puntuale: raggio adattato enorme -> «quasi rettilinea» per la soglia, ma NON piatta (contata fra i «non piatti»)
    expect(bk.straight).toBe(1);
    expect(bk.bent).toBe(1);
    expect(bk.arcs).toBe(0);
  });
  it('una cubica con i punti di controllo allineati: quasi rettilinea (o a raggio non determinabile se esattamente allineata), contata a parte', () => {
    const s = run([path('stroke', cat(M(0, 0), C(10, 0, 20, 0, 30, 0))), path('stroke', cat(M(0, 10), C(10, 10.04, 20, 10.04, 30, 10))), path('stroke', cat(M(0, 20), C(10, 22, 20, 22, 30, 20)))]);
    const bk = s.shapesCand.arcs.cubicOpen[0] as ArcBucket;
    expect(bk.subpaths).toBe(3);
    expect(bk.straight).toBe(2); // allineata esattamente (non determinabile) e con sagitta 0.03 (raggio ~ 3750: oltre 100 x la diagonale, 3000)
    expect(bk.undetermined).toBe(1);
    expect(bk.bent).toBe(0); // entrambe piatte
    expect(bk.arcs).toBe(1); // sagitta 1.5: raggio ~ 75, e' un arco per la soglia
    expect(sum(bk.relHist)).toBe(1); // i quasi rettilinei NON entrano negli istogrammi
    expect(sum(bk.radiusHist)).toBe(1);
  });
  it('una cubica di corda 0 (cappio) e un sottopercorso con un cappio dentro non danno NaN e rientrano nei conti', () => {
    const s = run([path('stroke', cat(M(100, 100), C(120, 140, 140, 140, 100, 100)))]);
    const bk = s.shapesCand.arcs.cubicClosed[0] as ArcBucket; // chiuso per coincidenza (ultimo = primo)
    expect(bk.subpaths).toBe(1);
    for (const v of [bk.relMax, bk.absMax, bk.angleMin ?? 0, bk.radiusMin ?? 0]) expect(Number.isFinite(v)).toBe(true);
    expect(s.cubicChordZero).toBe(1);
  });
  it('un poligono fitto con i vertici su un cerchio e uno irregolare', () => {
    const rnd = rng(3);
    const irr = Array.from({ length: 14 }, (_, i) => ({ x: 300 + (40 + rnd() * 30) * Math.cos(i * 0.45), y: 400 + (40 + rnd() * 30) * Math.sin(i * 0.45) }));
    const circ = polygonOnCircle(300, 400, 60, 14, 7);
    const s = run([path('stroke', polyCmds(circ, true)), path('stroke', polyCmds(irr, true))]);
    const bk = s.shapesCand.arcs.poly[0] as ArcBucket; // 14 vertici: contenitore 12-16
    expect(bk.subpaths).toBe(2);
    expect(bk.arcs).toBe(2);
    expect(bk.units).toBe(28);
    expect(bk.relHist[0]).toBe(1); // il regolare: scostamento ai livelli degli arrotondamenti (fino a 1e-5)
    expect(bk.relMax).toBeGreaterThan(0.05); // l'irregolare
    expect(bk.withinCp7a).toBe(1);
  });
});

describe('poligoni fitti: vertici, contenitori e tetto', () => {
  const circ = (n: number): { x: number; y: number }[] => polygonOnCircle(300, 400, 80, n, 11);
  it('contenitori per numero di vertici: 13 (12 lineTo + closePath) e 12 (12 lineTo, l\'ultimo torna al primo) in 12-16; 17-24; 25-32; 33-64; 65-128; 129-256', () => {
    const list: [number, boolean, boolean, number][] = [
      // [vertici del poligono, closePath, ultimo lineTo torna al primo, contenitore atteso]
      [13, true, false, 0],
      [12, false, true, 0],
      [12, true, true, 0],
      [16, true, false, 0],
      [17, true, false, 1],
      [24, true, false, 1],
      [25, true, false, 2],
      [32, true, false, 2],
      [33, true, false, 3],
      [64, true, false, 3],
      [65, true, false, 4],
      [128, true, false, 4],
      [129, true, false, 5],
      [256, true, false, 5],
    ];
    for (const [n, close, repeat, bucket] of list) {
      const s = run([path('stroke', polyCmds(circ(n), close, repeat))]);
      const g = s.shapesCand;
      expect(g.denseClosedPolygons).toBe(1);
      const bk = g.arcs.poly[bucket] as ArcBucket;
      expect(bk, `n ${n}, contenitore ${bucket}`).toBeTruthy();
      expect(bk.units).toBe(n); // vertici distinti: l'ultimo lineTo che torna al primo non e' un vertice in piu'
      expect(g.arcs.polyVertices).toBe(n);
      expect(bk.arcs).toBe(1);
      expect(bk.relMax).toBeLessThan(1e-10);
      expect(Math.abs((bk.radiusMin as number) - 80)).toBeLessThan(1e-8);
      expect(Math.abs((bk.angleMin as number) - 360)).toBeLessThan(1e-6);
      expect(bk.angleHist[5]).toBe(1);
      expect(g.arcs.polySkipped.subpaths).toBe(0);
    }
  });
  it('oltre 256 vertici: solo contati (poligono e vertici), nessuna misura', () => {
    const s = run([path('stroke', polyCmds(circ(257), true)), path('stroke', polyCmds(circ(300), true)), path('stroke', polyCmds(circ(20), true))]);
    const g = s.shapesCand;
    expect(g.denseClosedPolygons).toBe(3);
    expect(g.arcs.polySkipped).toEqual({ subpaths: 2, units: 557 });
    expect(g.arcs.polyVertices).toBe(577);
    expect(sum(only(g.arcs.poly).map((b) => b.subpaths))).toBe(1);
  });
  it('un poligono con 11 lineTo (meno di 12) o aperto non e\' fitto: nessuna misura; un poligono fitto con quadratiche o cubiche non e\' un poligono', () => {
    const p12 = circ(12); // 11 lineTo + closePath: non fitto (servono almeno 12 lineTo)
    const open = circ(20); // 19 lineTo senza closePath e ultimo punto lontano dal primo: aperto
    const withCubic = cat(polyCmds(circ(14), false), C(10, 10, 20, 20, 30, 30), Z);
    const s = run([path('stroke', polyCmds(p12, true)), path('stroke', polyCmds(open, false)), path('stroke', withCubic)]);
    expect(s.shapesCand.denseClosedPolygons).toBe(0);
    expect(only(s.shapesCand.arcs.poly)).toHaveLength(0);
    expect(s.shapesCand.arcs.polyVertices).toBe(0);
  });
  it('un percorso solo riempito (fill) non e\' candidato: conta fra «tutti i percorsi», non fra i candidati', () => {
    const s = run([path('fill', polyCmds(circ(20), true)), path('fill', chainCmds(arcChain(100, 100, 20, 0, 360, 4), true)), path('fillStroke', polyCmds(circ(20), true))]);
    expect(s.shapesAll.arcs.polyVertices).toBe(40);
    expect(s.shapesCand.arcs.polyVertices).toBe(20);
    expect(sum(only(s.shapesAll.arcs.cubicClosed).map((b) => b.subpaths))).toBe(1);
    expect(only(s.shapesCand.arcs.cubicClosed)).toHaveLength(0);
  });
});

describe('tetto sulle cubiche e sottopercorsi in uno stesso percorso', () => {
  it('8 cubiche si misurano, 9 e oltre solo si contano (con le loro cubiche)', () => {
    const eight = arcChain(300, 400, 40, 0, 320, 8);
    const nine = arcChain(300, 400, 40, 0, 320, 9);
    const twelve = arcChain(300, 400, 40, 0, 320, 12);
    const s = run([path('stroke', chainCmds(eight)), path('stroke', chainCmds(nine)), path('stroke', chainCmds(twelve, true))]);
    const g = s.shapesCand;
    expect((g.arcs.cubicOpen[7] as ArcBucket).arcs).toBe(1);
    expect(g.arcs.cubicOpenSkipped).toEqual({ subpaths: 1, units: 9 });
    expect(g.arcs.cubicClosedSkipped).toEqual({ subpaths: 1, units: 12 });
    expect(ARC_MAX_CUBICS).toBe(8);
    expect(g.arcs.cubicOpen).toHaveLength(8);
  });
  it('piu\' sottopercorsi nello stesso percorso: ognuno nel suo contenitore e stato', () => {
    const cmds = cat(
      chainCmds(arcChain(100, 100, 30, 0, 360, 4), true), // chiuso, 4 cubiche
      chainCmds(arcChain(200, 100, 30, 0, 90, 1)), // aperto, 1
      chainCmds(arcChain(300, 100, 30, 0, 180, 2)), // aperto, 2
      polyCmds(polygonOnCircle(400, 100, 30, 15), true), // poligono di 15 vertici
      cat(M(500, 100), Lt(510, 100), C(520, 100, 530, 110, 530, 120)), // misto: non e' misurato
    );
    const s = run([path('stroke', cmds)]);
    const g = s.shapesCand;
    expect(sum(only(g.arcs.cubicClosed).map((b) => b.subpaths))).toBe(1);
    expect((g.arcs.cubicClosed[3] as ArcBucket).subpaths).toBe(1);
    expect((g.arcs.cubicOpen[0] as ArcBucket).subpaths).toBe(1);
    expect((g.arcs.cubicOpen[1] as ArcBucket).subpaths).toBe(1);
    expect(sum(only(g.arcs.poly).map((b) => b.subpaths))).toBe(1);
    expect(g.openMixed.subpaths).toBe(1);
    expect(g.arcs.polyVertices).toBe(15);
  });
  it('sottopercorsi dopo un closePath nello stesso percorso: ognuno parte dal primo punto e si misura per conto suo', () => {
    const a = arcChain(100, 100, 30, 0, 90, 1);
    const cmds = cat(chainCmds(a, true), C(110, 110, 120, 120, 130, 130)); // dopo `h` un'altra cubica: nuovo sottopercorso dal primo punto
    const s = run([path('stroke', cmds)]);
    expect(sum(only(s.shapesCand.arcs.cubicClosed).map((b) => b.subpaths))).toBe(1);
    expect(sum(only(s.shapesCand.arcs.cubicOpen).map((b) => b.subpaths))).toBe(1);
  });
  it('sottopercorsi con quadratiche o con lineTo non sono di sole cubiche: nessuna misura', () => {
    const s = run([path('stroke', cat(M(0, 0), Q(5, 5, 10, 0), C(12, 2, 14, 2, 16, 0))), path('stroke', cat(M(0, 0), Lt(5, 5), C(6, 6, 7, 7, 8, 8)))]);
    expect(only(s.shapesCand.arcs.cubicOpen)).toHaveLength(0);
    expect(only(s.shapesCand.arcs.cubicClosed)).toHaveLength(0);
  });
  it('livello spento: la misura conta anche il contenuto spento, come le altre misure (i segmenti dentro livelli spenti sono contati a parte)', () => {
    const s = run(
      [['beginMarkedContentProps', ['OC', { type: 'OCG', id: 'x' }]], path('stroke', chainCmds(arcChain(300, 400, 40, 0, 360, 4), true)), ['endMarkedContent', null]],
      () => false,
    );
    expect(s.layers.hiddenCandidatePaths).toBe(1);
    expect((s.shapesCand.arcs.cubicClosed[3] as ArcBucket).arcs).toBe(1);
    expect(s.shapesCand.circles4).toBe(1);
  });
});

describe('riferimento delle tolleranze di CP7a', () => {
  it('withinCp7aTolerance: nodi entro 0.002 pt + 5e-4 x raggio, punti a meta\' curva entro in piu\' 2e-3 x raggio', () => {
    const r = 100;
    const tol = CIRCLE_TOL_ABS + CIRCLE_TOL_REL * r;
    expect(withinCp7aTolerance(true, r, tol, tol + CIRCLE_MID_REL * r)).toBe(true);
    expect(withinCp7aTolerance(true, r, tol * 1.0001, 0)).toBe(false);
    expect(withinCp7aTolerance(true, r, 0, (tol + CIRCLE_MID_REL * r) * 1.0001)).toBe(false);
    expect(withinCp7aTolerance(false, r, 0, 0)).toBe(false);
  });
  it('un cerchio di 4 cubiche passa il riferimento a ogni raggio; una cubica da 180 gradi (scostamento ~1e-2) no; una da 120 gradi (~1e-3) si\': la tolleranza di meta\' curva e\' 2e-3 x raggio', () => {
    for (const r of [0.5, 10, 500]) {
      const s = run([path('stroke', chainCmds(arcChain(300, 400, r, 0, 360, 4), true))]);
      expect((s.shapesCand.arcs.cubicClosed[3] as ArcBucket).withinCp7a).toBe(1);
    }
    const s = run([path('stroke', chainCmds(arcChain(300, 400, 100, 0, 180, 1), true)), path('stroke', chainCmds(arcChain(300, 400, 100, 0, 120, 1), true))]);
    const bk = s.shapesCand.arcs.cubicClosed[0] as ArcBucket;
    expect(bk.subpaths).toBe(2);
    expect(bk.withinCp7a).toBe(1); // solo quella da 120 gradi
  });
});

/** Le identita' dei conti: i sottopercorsi e le cubiche misurati + non misurati sono i totali che le righe di CP7c gia' riportano. */
function checkBalances(g: ShapeStats): void {
  const A = g.arcs;
  const subs = (slots: (ArcBucket | null)[]): number => sum(only(slots).map((b) => b.subpaths));
  const units = (slots: (ArcBucket | null)[]): number => sum(only(slots).map((b) => b.units));
  expect(subs(A.cubicOpen) + A.cubicOpenSkipped.subpaths).toBe(sum(g.openCubicOnly));
  expect(subs(A.cubicClosed) + A.cubicClosedSkipped.subpaths).toBe(sum(g.closedCubicOnly));
  expect(units(A.cubicOpen) + A.cubicOpenSkipped.units).toBe(g.openCubicOnlyCubics);
  expect(units(A.cubicClosed) + A.cubicClosedSkipped.units).toBe(g.closedCubicOnlyCubics);
  expect(subs(A.poly) + A.polySkipped.subpaths).toBe(g.denseClosedPolygons);
  expect(units(A.poly) + A.polySkipped.units).toBe(A.polyVertices);
  for (const b of only([...A.cubicOpen, ...A.cubicClosed, ...A.poly])) {
    expect(b.arcs + b.straight).toBe(b.subpaths);
    expect(b.undetermined).toBeLessThanOrEqual(b.straight);
    for (const h of [b.relHist, b.absHist, b.radiusHist, b.angleHist]) expect(sum(h)).toBe(b.arcs);
    expect(sum(b.tanHist)).toBe(b.tanMeasured);
    expect(b.tanMeasured).toBeLessThanOrEqual(b.arcs);
  }
}
describe('i conti tornano (prova a caso con generatore deterministico)', () => {
  it('300 sottopercorsi casuali (cubiche 1-12, aperte e chiuse, poligoni 3-300 vertici, misti, quadratiche, cubiche degeneri) in percorsi di vari tipi', () => {
    const rnd = rng(2024);
    const list: Op[] = [];
    const paints = ['stroke', 'fill', 'fillStroke', 'endPath'];
    for (let p = 0; p < 60; p++) {
      const cmds: number[] = [];
      for (let k = 0; k < 5; k++) {
        const kind = Math.floor(rnd() * 6);
        const [cx, cy] = [rnd() * 500, rnd() * 700];
        if (kind === 0) cmds.push(...chainCmds(arcChain(cx, cy, 1 + rnd() * 100, rnd() * 360, 20 + rnd() * 340, 1 + Math.floor(rnd() * 12)), rnd() < 0.5));
        else if (kind === 1) cmds.push(...polyCmds(polygonOnCircle(cx, cy, 5 + rnd() * 80, 3 + Math.floor(rnd() * 300)), rnd() < 0.7, rnd() < 0.3));
        else if (kind === 2) cmds.push(...cat(M(cx, cy), Lt(cx + 5, cy), C(cx + 7, cy, cx + 9, cy + 2, cx + 9, cy + 4), rnd() < 0.5 ? Z : []));
        else if (kind === 3) cmds.push(...cat(M(cx, cy), Q(cx + 4, cy + 4, cx + 8, cy), C(cx + 9, cy, cx + 10, cy, cx + 11, cy)));
        else if (kind === 4) cmds.push(...cat(M(cx, cy), C(cx, cy, cx, cy, cx, cy))); // cubica con tutti i punti coincidenti
        else cmds.push(...cat(M(cx, cy), C(cx + 10, cy, cx + 20, cy, cx + 30, cy))); // allineata
      }
      list.push(path(paints[p % 4] as string, cmds));
    }
    const s = run(list);
    checkBalances(s.shapesAll);
    checkBalances(s.shapesCand);
    expect(sum(only(s.shapesAll.arcs.cubicOpen).map((b) => b.subpaths)) + sum(only(s.shapesAll.arcs.cubicClosed).map((b) => b.subpaths))).toBeGreaterThan(20);
    expect(s.shapesAll.denseClosedPolygons).toBeGreaterThan(5);
  });
});

describe('righe di «Copia misura» (PDF sintetico costruito con pdf-lib e letto con PDF.js)', () => {
  const tasks: { destroy(): Promise<void> }[] = [];
  afterEach(async () => {
    while (tasks.length) await tasks.pop()?.destroy();
  });
  async function lines(content: string, meta?: { title?: string }): Promise<{ lines: string[]; text: string }> {
    const bytes = await makePdf({ content, meta });
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
    tasks.push(task);
    const doc: PDFDocumentProxy = await task.promise;
    const layers = await readDocLayers(doc);
    const r = await measurePage(doc, 1);
    if (!r.ok) throw new Error(r.reason);
    return { lines: measureLines(r.measure, layers), text: measureText('prova', [r.measure], r.measure, layers) };
  }
  const content = [
    `${pdfChain(arcChain(100, 600, 40, 0, 360, 4), true)} S`,
    `${pdfChain(arcChain(250, 600, 25, 30, 90, 1))} S`,
    `${pdfChain(arcChain(350, 600, 25, 30, 180, 2))} S`,
    `${pdfChain(arcChain(450, 600, 25, 30, 180, 2))} f`,
    `${pdfPolygon(polygonOnCircle(100, 400, 50, 24), true)} S`,
    `${pdfChain(arcChain(300, 400, 25, 0, 320, 9))} S`,
    '0 0 m 10 0 l 20 10 20 20 30 30 c S',
  ].join('\n');
  it('le righe nuove ci sono, cominciano tutte con «archi», senza nome del file ne\' metadati, e tutti i conti tornano', async () => {
    const { lines: ls, text } = await lines(content, { title: 'SEGRETO-TITOLO' });
    const arc = ls.filter((l) => l.startsWith('archi'));
    expect(arc.length).toBeGreaterThan(20);
    expect(arc.some((l) => /IL CONTO NON TORNA/.test(l))).toBe(false);
    // per ciascun gruppo (tutti i percorsi, candidati): sottopercorsi aperti e chiusi (2 conti ciascuno), poligoni fitti (2 conti)
    expect(arc.filter((l) => /il conto torna/.test(l))).toHaveLength(12);
    expect(text).not.toContain('SEGRETO-TITOLO');
    expect(text.split('\n').every((l) => l.trim().length > 0 && /[:·]/.test(l))).toBe(true);
    expect(/\d,\d/.test(text)).toBe(false); // numeri sempre con il punto
    // numeri noti: candidati (stroke) = 1 chiuso da 4 cubiche, 1 aperto da 1, 1 aperto da 2, 1 aperto da 9 (solo contato); «tutti» ha in piu' il riempimento da 2 aperto
    expect(arc).toContain('archi, sottopercorsi CHIUSI di sole cubiche, candidati: 1 = misurati 1 (raggio determinato 1, quasi rettilinei 0, di cui raggio non determinabile 0 e non piatti 0) + oltre 8 cubiche non misurati 0; cubiche: misurate 4 + non misurate 0 = 4');
    expect(arc.some((l) => l.startsWith('archi, sottopercorsi APERTI di sole cubiche, candidati: 3 = misurati 2') && l.includes('oltre 8 cubiche non misurati 1; cubiche: misurate 3 + non misurate 9 = 12'))).toBe(true);
    expect(arc.some((l) => l.startsWith('archi, sottopercorsi APERTI di sole cubiche, tutti i percorsi: 4 = misurati 3'))).toBe(true);
    expect(arc.some((l) => l.startsWith('archi, poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), candidati: 1 = misurati 1') && l.includes('vertici (punto iniziale e estremi dei lineTo, senza l\'ultimo se coincide con il primo): misurati 24 + non misurati 0 = 24'))).toBe(true);
    expect(arc.some((l) => l.startsWith('archi APERTI, 2 cubiche, candidati: sottopercorsi 1 (raggio determinato 1'))).toBe(true);
    expect(arc.some((l) => /^archi APERTI, 2 cubiche, candidati: sottopercorsi 1 \(raggio determinato 1, quasi rettilinei 0, di cui raggio non determinabile 0 e non piatti 0\);/.test(l))).toBe(true);
    expect(arc.some((l) => l.startsWith('archi, poligoni fitti, 17-24 vertici, candidati: sottopercorsi 1'))).toBe(true);
  });
  it('definizioni: dichiarano il metodo, i tetti, la soglia dei quasi rettilinei e il margine degli angoli', async () => {
    const { lines: ls } = await lines(content);
    const defs = ls.filter((l) => l.startsWith('archi (CP7e') || l.startsWith('archi, definizioni') || l.startsWith('archi, quasi rettilinei') || l.startsWith('archi, riferimento di CP7a'));
    expect(defs).toHaveLength(4);
    const all = defs.join('\n');
    for (const w of ['minimi quadrati', 't = 0.25, 0.5 e 0.75', `${ARC_MAX_CUBICS} cubiche`, `${ARC_MAX_VERTICES} vertici`, 'oltre 100 volte la diagonale', 'non piatti', 'margine degli angoli 0.5 gradi', 'NON la regola del cerchio']) expect(all).toContain(w);
    expect(all).not.toMatch(/\b(e' un arco|sono archi|raccord|tangente sul PDF)/i);
  });
  it('la pagina senza cubiche ne\' poligoni fitti ha le righe nuove con zeri e i conti tornano', async () => {
    const { lines: ls } = await lines('10 10 m 50 50 l S');
    const arc = ls.filter((l) => l.startsWith('archi'));
    expect(arc.length).toBeGreaterThan(10);
    expect(arc.some((l) => /IL CONTO NON TORNA/.test(l))).toBe(false);
    expect(arc.filter((l) => /il conto torna/.test(l))).toHaveLength(12);
    expect(arc.filter((l) => /^archi (APERTI|CHIUSI), /.test(l))).toHaveLength(0); // nessun contenitore: nessuna riga per cubiche
  });
});
