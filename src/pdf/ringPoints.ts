// Punti di snap degli ANELLI del PDF (V3.3a, CP7f): dagli anelli riconosciuti in `PdfGeometry.rings` (src/pdf/geometry.ts: archi e cerchi di sole cubiche con raggio determinato e dentro il
// riferimento di CP7a, spazio utente) ai punti Centro e Quadrante nel FOGLIO mostrato (pt fisici, origine in alto a sinistra, /Rotate, CropBox e UserUnit gia' applicati).
//
// Modulo PURO: niente DOM, niente PDF.js. L'indice spaziale e' quello dei punti del PDF (`PointGrid`, src/pdf/pointIndex.ts): i Centri stanno al posto degli Estremi e i Quadranti al posto dei
// Punti medi, dietro l'adattatore `RingSource` che li chiama «center» e «quadrant».
//
// Regole (SCELTE DI CODE per CP7f, dichiarate e da confermare):
//  - Centro = il centro del cerchio adattato (quello di `measureCubicChain`, in doppia precisione, riportato nel foglio); Quadrante = i punti a 0, 90, 180 e 270 gradi del foglio MOSTRATO
//    (`quadrantPoints` di src/geometry/snapExtra.ts: destra, basso, sinistra, alto) che cadono nell'arco coperto (`inArc`); nel cerchio intero tutti e quattro. Nessun Centro o Quadrante dei
//    poligoni fitti ne' delle catene non riconosciute;
//  - il foglio e' una similitudine dello spazio utente (rotazione di un multiplo di 90 gradi, scala UserUnit, ribaltamento di Y): centro e raggio si riportano con la matrice (raggio = r x
//    radice di |det|), l'angolo di partenza e' l'angolo del vettore di partenza trasformato dalla parte lineare, e il verso dell'angolo coperto cambia segno con il ribaltamento (det < 0): le
//    convenzioni sono quelle di `SheetArc` (src/geometry/arc.ts), cosi' si riusano `inArc` e `quadrantPoints`;
//  - un Quadrante che coincide con un estremo di un arco puo' cadere appena fuori dall'arco per l'arrotondamento dei nodi (Float32 di PDF.js, errore dell'ordine di 1e-6 rad o piu'): l'arco
//    si allarga di RING_ANGLE_EPS ad ogni estremo (1e-4 rad, circa 0.006 gradi) SOLO per questa prova; ANGLE_EPS degli oggetti disegnati (1e-9 rad) e' pensato per numeri in doppia precisione;
//  - solo i percorsi VISIBILI (`pathVisible` = 1: un livello spento non da' punti); un punto fuori dal foglio di piu' di PAGE_MARGIN_PT e' scartato, entro il margine si riporta sul bordo
//    (la stessa regola dei punti dei tratti di CP7b);
//  - nessuna deduplicazione: due anelli concentrici danno due Centri nello stesso punto.
import type { PdfRingSource } from '../geometry/snap';
import { inArc, quadrantPoints } from '../geometry/snapExtra';
import { type PdfGeometry, RING_STRIDE } from './geometry';
import { PointGrid } from './pointIndex';
import { PAGE_MARGIN_PT, type SheetMap, type SnapPoints } from './snapPoints';

/** Margine angolare (rad) ad ogni estremo di un arco per decidere se un Quadrante vi cade: copre l'arrotondamento Float32 dei nodi; NON e' una soglia di riconoscimento. */
export const RING_ANGLE_EPS = 1e-4;

export interface RingPointStats {
  /** Anelli riconosciuti VISIBILI, e fra questi i cerchi interi e gli archi. */
  rings: number;
  circles: number;
  arcs: number;
  /** Anelli riconosciuti dentro un livello spento (nessun punto). */
  hiddenRings: number;
  /** Centri e Quadranti che restano (nel foglio) e punti scartati perche' fuori dal foglio. */
  centers: number;
  quadrants: number;
  outsidePoints: number;
  /** Byte degli anelli in `PdfGeometry.rings`. */
  ringBytes: number;
}

export interface RingPoints {
  /** Stessa struttura dei punti dei tratti: i Centri come «Estremi» (`nEnd`) e i Quadranti come «Punti medi» (`nMid`), per riusare `PointGrid`. `stats` e' sempre zero. */
  points: SnapPoints;
  stats: RingPointStats;
  /** Byte di `points.xy`. */
  bytes: number;
}

/** Anelli riconosciuti in tutto (visibili o no); 0 se il riconoscimento non c'era. */
export const ringCount = (g: PdfGeometry): number => g.rings?.n ?? 0;

/** Parte lineare e matrice della trasformazione utente -> foglio: quella di `PageGeometry.matrix` o, se manca, ricavata da `userToSheet` su tre punti. */
function matrixOf(sheet: SheetMap): readonly [number, number, number, number, number, number] {
  if (sheet.matrix) return sheet.matrix;
  const o = sheet.userToSheet({ x: 0, y: 0 });
  const ex = sheet.userToSheet({ x: 1, y: 0 });
  const ey = sheet.userToSheet({ x: 0, y: 1 });
  return [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y];
}

/** Costruisce i punti Centro e Quadrante degli anelli visibili di `g`. Non lancia: senza anelli (o senza `g.rings`) da' zero punti. Costo lineare nel numero di anelli. */
export function buildRingPoints(g: PdfGeometry, sheet: SheetMap): RingPoints {
  const w = sheet.width;
  const h = sheet.height;
  const rg = g.rings;
  const n = rg?.n ?? 0;
  const stats: RingPointStats = { rings: 0, circles: 0, arcs: 0, hiddenRings: 0, centers: 0, quadrants: 0, outsidePoints: 0, ringBytes: rg?.bytes ?? 0 };
  const centers = new Float64Array(n * 2);
  const quads = new Float64Array(n * 8);
  let nC = 0;
  let nQ = 0;
  const lim = PAGE_MARGIN_PT;
  const inside = (x: number, y: number): boolean => x >= -lim && x <= w + lim && y >= -lim && y <= h + lim;
  const clampX = (x: number): number => (x < 0 ? 0 : x > w ? w : x);
  const clampY = (y: number): number => (y < 0 ? 0 : y > h ? h : y);
  if (rg && n > 0) {
    const [a, b, c, d, e, f] = matrixOf(sheet);
    const det = a * d - b * c;
    const scale = Math.sqrt(Math.abs(det));
    const flip = det < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      if (g.pathVisible[rg.path[i] as number] !== 1) {
        stats.hiddenRings++;
        continue;
      }
      const o = i * RING_STRIDE;
      const ucx = rg.xy[o] as number;
      const ucy = rg.xy[o + 1] as number;
      const ur = rg.xy[o + 2] as number;
      const ua0 = rg.xy[o + 3] as number;
      const usw = rg.xy[o + 4] as number;
      const full = rg.full[i] === 1;
      stats.rings++;
      if (full) stats.circles++;
      else stats.arcs++;
      // nel foglio: centro con la matrice, raggio con la scala, angolo di partenza dal vettore trasformato, verso con il segno del determinante
      const cx = a * ucx + c * ucy + e;
      const cy = b * ucx + d * ucy + f;
      const r = ur * scale;
      const vx = a * Math.cos(ua0) + c * Math.sin(ua0);
      const vy = b * Math.cos(ua0) + d * Math.sin(ua0);
      const a0 = Math.atan2(vy, vx);
      const sweep = usw * flip;
      if (inside(cx, cy)) {
        centers[2 * nC] = clampX(cx);
        centers[2 * nC + 1] = clampY(cy);
        nC++;
      } else stats.outsidePoints++;
      // l'arco si allarga di RING_ANGLE_EPS a ogni estremo solo per decidere i Quadranti (il cerchio intero non ne ha bisogno)
      const sgn = sweep >= 0 ? 1 : -1;
      const wide = full ? { cx, cy, a0, sweep, full: true } : { cx, cy, a0: a0 - sgn * RING_ANGLE_EPS, sweep: sweep + sgn * 2 * RING_ANGLE_EPS, full: false };
      for (const q of quadrantPoints({ cx, cy, r })) {
        if (!inArc(wide, q.x, q.y)) continue;
        if (!inside(q.x, q.y)) {
          stats.outsidePoints++;
          continue;
        }
        quads[2 * nQ] = clampX(q.x);
        quads[2 * nQ + 1] = clampY(q.y);
        nQ++;
      }
    }
  }
  const xy = new Float64Array((nC + nQ) * 2);
  xy.set(centers.subarray(0, nC * 2), 0);
  xy.set(quads.subarray(0, nQ * 2), nC * 2);
  stats.centers = nC;
  stats.quadrants = nQ;
  const zero = { segments: 0, hiddenSegments: 0, tinySegments: 0, outsidePoints: 0, mergedEnd: 0, mergedMid: 0 };
  return { points: { width: w, height: h, xy, nEnd: nC, nMid: nQ, stats: zero, bytes: xy.byteLength }, stats, bytes: xy.byteLength };
}

/**
 * La sorgente degli anelli per `findSnap` (`SnapExtra.pdfRings`): un adattatore su `PointGrid` che chiama «center» i Centri (gli «Estremi» della griglia) e «quadrant» i Quadranti (i suoi
 * «Punti medi»), nello stesso ordine dell'indice dei punti (prima i Centri, poi i Quadranti). Non e' un oggetto: non si seleziona, non si cancella, non entra nel modello ne' nel file progetto.
 */
export class RingSource implements PdfRingSource {
  private cur: ((x: number, y: number, kind: 'center' | 'quadrant') => void) | null = null;
  private readonly relay = (x: number, y: number, kind: 'end' | 'mid'): void => {
    if (this.cur) this.cur(x, y, kind === 'end' ? 'center' : 'quadrant');
  };
  constructor(readonly grid: PointGrid) {}
  forEachNear(x: number, y: number, radius: number, center: boolean, quadrant: boolean, emit: (x: number, y: number, kind: 'center' | 'quadrant') => void): void {
    this.cur = emit;
    try {
      this.grid.forEachNear(x, y, radius, center, quadrant, this.relay);
    } finally {
      this.cur = null;
    }
  }
}

/** Costruisce punti e indice in un colpo solo (comodo per le prove); l'app li costruisce in fasi separate (src/pdf/snapPage.ts). */
export function buildRingSource(g: PdfGeometry, sheet: SheetMap): { source: RingSource; stats: RingPointStats; points: SnapPoints; bytes: number } {
  const rp = buildRingPoints(g, sheet);
  const grid = new PointGrid(rp.points);
  return { source: new RingSource(grid), stats: rp.stats, points: rp.points, bytes: rp.bytes + grid.bytes };
}
