// Punti di snap dei tratti rettilinei e delle curve del PDF (V3.1, CP7b; Estremo delle curve V3.2a, CP7c): dai segmenti e dalle cubiche di `PdfGeometry` (src/pdf/geometry.ts, spazio
// utente) ai punti Estremo e Punto medio nel FOGLIO mostrato (pt fisici, origine in alto a sinistra, /Rotate, CropBox e UserUnit gia' applicati), con la stessa conversione degli
// oggetti disegnati (`PageGeometry.userToSheet`).
//
// Modulo PURO: niente DOM, niente PDF.js, niente indice (l'indice spaziale e' in src/pdf/pointIndex.ts).
//
// Regole (SCELTE DELL'ASSISTENTE-CODE per CP7b e CP7c, dichiarate e da confermare; le soglie sono valori di PARTENZA non tarati sui PDF dell'utente):
//  - entrano solo i segmenti dei percorsi VISIBILI (`pathVisible` = 1: un livello spento non da' punti): i rettilinei (`lineXY`) e, con `opts.curves` (CP7c), gli ESTREMI delle
//    cubiche (`cubicXY`; le quadratiche sono gia' cubiche): il punto iniziale e il punto finale di OGNI cubica sono un Estremo, senza riconoscere cerchi o archi (nessuna
//    interpretazione). Quindi anche i giunti di una catena di cubiche (i quattro quadranti di un cerchio di pdf-lib) sono un Estremo, come gli angoli interni di una spezzata.
//    Il Punto medio delle cubiche NON c'e' (ambiguo: parametro, corda o arco). Senza `opts.curves` (predefinito) il risultato e' IDENTICO a CP7b;
//  - Estremo = i due estremi di ogni tratto; Punto medio = il centro di ogni tratto, calcolato nel FOGLIO in doppia precisione come gli oggetti disegnati
//    (`(a + b) / 2` dei due estremi gia' convertiti: vedi `visitCandidates` di src/geometry/snap.ts);
//  - un tratto piu' corto di MIN_SEGMENT_PT (pt FISICI del foglio) e' quasi un punto: niente Punto medio e un solo Estremo (il primo punto; il secondo dista meno di 0.01 pt); lo stesso
//    per una cubica la cui CORDA (distanza fra primo e ultimo punto) e' sotto MIN_SEGMENT_PT: un solo Estremo;
//  - i punti coincidenti si UNISCONO (i tratti di una spezzata condividono gli estremi): due punti dello stesso tipo a distanza <= MERGE_TOL_PT (pt fisici) sono uno solo, il
//    primo (il punto che resta non e' una media: e' uno dei due, spostato al piu' di 1e-3 pt); un Estremo e un Punto medio nella stessa posizione restano due punti (tipi diversi).
//    L'unione vale anche FRA tratti e curve (un raccordo fra due rette non da' due punti dove le rette e la curva si toccano) e fra cubiche consecutive (un cerchio da 4 cubiche da'
//    4 Estremi, non 8). I tratti rettilinei si leggono PRIMA delle cubiche: dove un Estremo di una cubica coincide con quello di un tratto resta quello del tratto, e i punti dei soli
//    tratti sono gli stessi, nello stesso ordine, che senza curve;
//  - un punto fuori dal foglio di piu' di PAGE_MARGIN_PT non si vede e non e' un candidato; entro il margine si riporta sul bordo (il Float32 di PDF.js sposta di ~1e-6 pt un
//    bordo disegnato esattamente sul bordo del foglio: senza riportarlo il punto agganciato sarebbe «fuori dalla pagina» e il clic rifiutato).
//
// Struttura: UN Float64Array `xy` (x0, y0, x1, y1, ...) con prima i `nEnd` Estremi poi i `nMid` Punti medi; 16 byte per punto (doppia precisione: la conversione nel foglio
// non aggiunge errore a quello del Float32 di PDF.js, 2.8e-5 pt sui PDF di prova di formato A3, misurato in CP7a). L'ordine degli Estremi e' quello dei tratti nel PDF e poi quello
// delle cubiche; quello dei Punti medi e' quello dei tratti.
import type { PdfGeometry } from './geometry';

/** Sotto questa lunghezza (pt fisici del foglio) un tratto e' un punto: niente Punto medio, un solo Estremo. Con UserUnit 1 coincide con il primo contenitore dell'istogramma di CP7a (< 0.01 pt utente). */
export const MIN_SEGMENT_PT = 0.01;
/** Due punti dello stesso tipo a questa distanza o meno (pt fisici) sono un punto solo (il primo). */
export const MERGE_TOL_PT = 0.001;
/** Lato delle celle della tabella di unione: 16 x MERGE_TOL_PT (pt fisici): il quadrato di ricerca (lato 2 x MERGE_TOL_PT) tocca quasi sempre una cella sola. */
const CELL_PT = 16 * MERGE_TOL_PT;
/** Un punto fuori dal foglio di piu' di cosi' (pt fisici) e' scartato; entro il margine e' riportato sul bordo. */
export const PAGE_MARGIN_PT = 0.01;
/** Byte per punto di `SnapPoints.xy` (due Float64). */
export const BYTES_PER_POINT = 16;

/** Il minimo che serve del foglio: dimensioni e conversione utente -> foglio (`PageGeometry` la soddisfa). */
export interface SheetMap {
  readonly width: number;
  readonly height: number;
  userToSheet(p: { x: number; y: number }): { x: number; y: number };
  /** Se c'e', la trasformazione come [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f), la stessa formula di `userToSheet` senza allocare un oggetto per punto. */
  readonly matrix?: readonly [number, number, number, number, number, number];
}

export interface SnapPointStats {
  /** Tratti rettilinei dei percorsi candidati (visibili o no). */
  segments: number;
  /** Fra questi, quelli dentro un livello spento (nessun punto). */
  hiddenSegments: number;
  /** Tratti visibili sotto MIN_SEGMENT_PT. */
  tinySegments: number;
  /** Punti scartati perche' fuori dal foglio. */
  outsidePoints: number;
  /** Punti uniti a uno gia' presente, per tipo. */
  mergedEnd: number;
  mergedMid: number;
}

/** Conti delle cubiche (solo con `opts.curves`): quante, quante nascoste, quante troppo piccole, e che fine hanno fatto i loro Estremi. */
export interface CurvePointStats {
  /** Cubiche dei percorsi candidati (visibili o no). */
  cubics: number;
  /** Fra queste, quelle dentro un livello spento (nessun punto). */
  hiddenCubics: number;
  /** Cubiche visibili con corda sotto MIN_SEGMENT_PT (un solo Estremo). */
  tinyCubics: number;
  /** Estremi di cubiche scartati perche' fuori dal foglio. */
  outsidePoints: number;
  /** Estremi di cubiche uniti a uno gia' presente (di un tratto o di un'altra cubica). */
  mergedEnd: number;
  /** Estremi che RESTANO e che vengono da una cubica (non uniti a un tratto o a una cubica precedente): i punti dovuti alle curve. */
  endsFromCurves: number;
}

export interface BuildSnapOptions {
  /** Aggiunge gli Estremi delle cubiche (V3.2a, CP7c). Predefinito: no (solo i tratti rettilinei, come in CP7b). */
  curves?: boolean;
}

export interface SnapPoints {
  /** Foglio mostrato (pt fisici): lo stesso con cui sono stati calcolati i punti. */
  width: number;
  height: number;
  /** x, y per punto, nel foglio: prima i `nEnd` Estremi, poi i `nMid` Punti medi. */
  xy: Float64Array;
  nEnd: number;
  nMid: number;
  stats: SnapPointStats;
  /** Presente solo se i punti delle cubiche sono stati chiesti (`opts.curves`): i loro conti. `stats` riguarda i soli tratti rettilinei, come in CP7b. */
  curves?: CurvePointStats;
  /** Byte di `xy`. */
  bytes: number;
}

/** Quanti tratti rettilinei VISIBILI ha la geometria (quelli che danno punti); serve al tetto di primitive prima di costruire. */
export function visibleLineCount(g: PdfGeometry): number {
  let n = 0;
  for (let i = 0; i < g.nLines; i++) if (g.pathVisible[g.linePath[i] as number] === 1) n++;
  return n;
}

/** Quante cubiche VISIBILI ha la geometria (quelle che danno Estremi): per il tetto di primitive, come `visibleLineCount`. */
export function visibleCubicCount(g: PdfGeometry): number {
  let n = 0;
  for (let i = 0; i < g.nCubics; i++) if (g.pathVisible[g.cubicPath[i] as number] === 1) n++;
  return n;
}

const nextPow2 = (n: number): number => {
  let p = 16;
  while (p < n) p *= 2;
  return p;
};

/**
 * Tabella a indirizzamento aperto per unire i punti coincidenti (indice + 1; 0 = vuoto), una per tipo, senza allocazioni per punto. I punti sono ordinati in celle di lato
 * 16 x MERGE_TOL_PT; per un punto nuovo si guardano le (al piu' 4, quasi sempre 1) celle che toccano il quadrato di lato 2 x MERGE_TOL_PT attorno a lui e si unisce al primo punto gia' presente a
 * distanza <= MERGE_TOL_PT. (Provato su a4-vettoriale.pdf: le coordinate con tre decimali, come 297.638, stanno esattamente sul bordo di una cella da 0.001 pt e il Float32 le sposta di
 * 4e-6 pt: con un confronto "stessa cella" due punti coincidenti non si univano.)
 */
class MergeTable {
  private readonly slots: Uint32Array;
  private readonly mask: number;
  constructor(maxPoints: number) {
    const size = nextPow2(maxPoints * 2); // fattore di carico al piu' 0.5
    this.slots = new Uint32Array(size);
    this.mask = size - 1;
  }
  private slotOf(ix: number, iy: number): number {
    let h = Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iy | 0, 0x85ebca77);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h & this.mask;
  }
  /** Indice del punto gia' presente (fra i primi `count` di `xy`) a distanza <= MERGE_TOL_PT da (x, y), o -1 se non c'e': in quel caso registra il punto `count` (da scrivere subito in `xy`). */
  find(xy: Float64Array, count: number, x: number, y: number): number {
    const tol = MERGE_TOL_PT;
    const tol2 = tol * tol;
    const inv = 1 / CELL_PT;
    const x0 = Math.floor((x - tol) * inv);
    const x1 = Math.floor((x + tol) * inv);
    const y0 = Math.floor((y - tol) * inv);
    const y1 = Math.floor((y + tol) * inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        let slot = this.slotOf(ix, iy);
        for (;;) {
          const v = this.slots[slot] as number;
          if (v === 0) break;
          const i = v - 1;
          const dx = (xy[2 * i] as number) - x;
          const dy = (xy[2 * i + 1] as number) - y;
          if (dx * dx + dy * dy <= tol2) return i;
          slot = (slot + 1) & this.mask;
        }
      }
    }
    // nessun punto vicino: si registra nella catena della cella del punto
    let slot = this.slotOf(Math.floor(x * inv), Math.floor(y * inv));
    while (this.slots[slot] !== 0) slot = (slot + 1) & this.mask;
    this.slots[slot] = count + 1;
    return -1;
  }
}

/**
 * Costruisce i punti dei tratti rettilinei visibili e, con `opts.curves`, gli Estremi delle cubiche visibili. Non lancia: una geometria senza tratti da' zero punti.
 * Costo lineare nel numero di tratti e di cubiche.
 */
export function buildSnapPoints(g: PdfGeometry, sheet: SheetMap, opts: BuildSnapOptions = {}): SnapPoints {
  const w = sheet.width;
  const h = sheet.height;
  const nL = g.nLines;
  const withCurves = opts.curves === true;
  const nC = withCurves ? g.nCubics : 0;
  const stats: SnapPointStats = { segments: nL, hiddenSegments: 0, tinySegments: 0, outsidePoints: 0, mergedEnd: 0, mergedMid: 0 };
  const cs: CurvePointStats = { cubics: nC, hiddenCubics: 0, tinyCubics: 0, outsidePoints: 0, mergedEnd: 0, endsFromCurves: 0 };
  const ends = new Float64Array(nL * 4 + nC * 4); // al piu' 2 Estremi per tratto e per cubica
  const mids = new Float64Array(nL * 2);
  const endTable = new MergeTable(nL * 2 + nC * 2);
  const midTable = new MergeTable(nL);
  let nEnd = 0;
  let nMid = 0;
  const inp = { x: 0, y: 0 };
  const lim = PAGE_MARGIN_PT;

  /** Il punto sta nel foglio (con margine)? Quelli dentro il margine si riportano sul bordo con `clampX` e `clampY`. */
  const inside = (x: number, y: number): boolean => x >= -lim && x <= w + lim && y >= -lim && y <= h + lim;
  const clampX = (x: number): number => (x < 0 ? 0 : x > w ? w : x);
  const clampY = (y: number): number => (y < 0 ? 0 : y > h ? h : y);
  const addEnd = (x: number, y: number): void => {
    if (!inside(x, y)) {
      stats.outsidePoints++;
      return;
    }
    const cx = clampX(x);
    const cy = clampY(y);
    if (endTable.find(ends, nEnd, cx, cy) >= 0) {
      stats.mergedEnd++;
      return;
    }
    ends[2 * nEnd] = cx;
    ends[2 * nEnd + 1] = cy;
    nEnd++;
  };
  /** Come `addEnd`, per un Estremo di cubica (stessa tabella di unione: l'unione vale anche con i tratti); i conti vanno in `cs`. */
  const addCurveEnd = (x: number, y: number): void => {
    if (!inside(x, y)) {
      cs.outsidePoints++;
      return;
    }
    const cx = clampX(x);
    const cy = clampY(y);
    if (endTable.find(ends, nEnd, cx, cy) >= 0) {
      cs.mergedEnd++;
      return;
    }
    ends[2 * nEnd] = cx;
    ends[2 * nEnd + 1] = cy;
    nEnd++;
    cs.endsFromCurves++;
  };
  const addMid = (x: number, y: number): void => {
    if (!inside(x, y)) {
      stats.outsidePoints++;
      return;
    }
    const cx = clampX(x);
    const cy = clampY(y);
    if (midTable.find(mids, nMid, cx, cy) >= 0) {
      stats.mergedMid++;
      return;
    }
    mids[2 * nMid] = cx;
    mids[2 * nMid + 1] = cy;
    nMid++;
  };

  const m = sheet.matrix;
  const min2 = MIN_SEGMENT_PT * MIN_SEGMENT_PT;
  for (let i = 0; i < nL; i++) {
    if (g.pathVisible[g.linePath[i] as number] !== 1) {
      stats.hiddenSegments++;
      continue;
    }
    const o = i * 4;
    const ux0 = g.lineXY[o] as number;
    const uy0 = g.lineXY[o + 1] as number;
    const ux1 = g.lineXY[o + 2] as number;
    const uy1 = g.lineXY[o + 3] as number;
    let ax: number;
    let ay: number;
    let bx: number;
    let by: number;
    if (m) {
      // la stessa formula di PageGeometry.userToSheet, senza un oggetto per punto
      ax = (m[0] as number) * ux0 + (m[2] as number) * uy0 + (m[4] as number);
      ay = (m[1] as number) * ux0 + (m[3] as number) * uy0 + (m[5] as number);
      bx = (m[0] as number) * ux1 + (m[2] as number) * uy1 + (m[4] as number);
      by = (m[1] as number) * ux1 + (m[3] as number) * uy1 + (m[5] as number);
    } else {
      inp.x = ux0;
      inp.y = uy0;
      const a = sheet.userToSheet(inp);
      inp.x = ux1;
      inp.y = uy1;
      const b = sheet.userToSheet(inp);
      ax = a.x;
      ay = a.y;
      bx = b.x;
      by = b.y;
    }
    addEnd(ax, ay);
    const dx = bx - ax;
    const dy = by - ay;
    if (dx * dx + dy * dy < min2) {
      stats.tinySegments++;
      continue;
    }
    addEnd(bx, by);
    addMid((ax + bx) / 2, (ay + by) / 2);
  }

  // ---- cubiche (CP7c): il punto iniziale e quello finale di ogni cubica visibile, dopo tutti i tratti
  for (let i = 0; i < nC; i++) {
    if (g.pathVisible[g.cubicPath[i] as number] !== 1) {
      cs.hiddenCubics++;
      continue;
    }
    const o = i * 8;
    const ux0 = g.cubicXY[o] as number;
    const uy0 = g.cubicXY[o + 1] as number;
    const ux1 = g.cubicXY[o + 6] as number;
    const uy1 = g.cubicXY[o + 7] as number;
    let ax: number;
    let ay: number;
    let bx: number;
    let by: number;
    if (m) {
      ax = (m[0] as number) * ux0 + (m[2] as number) * uy0 + (m[4] as number);
      ay = (m[1] as number) * ux0 + (m[3] as number) * uy0 + (m[5] as number);
      bx = (m[0] as number) * ux1 + (m[2] as number) * uy1 + (m[4] as number);
      by = (m[1] as number) * ux1 + (m[3] as number) * uy1 + (m[5] as number);
    } else {
      inp.x = ux0;
      inp.y = uy0;
      const a = sheet.userToSheet(inp);
      inp.x = ux1;
      inp.y = uy1;
      const b = sheet.userToSheet(inp);
      ax = a.x;
      ay = a.y;
      bx = b.x;
      by = b.y;
    }
    addCurveEnd(ax, ay);
    const dx = bx - ax;
    const dy = by - ay;
    if (dx * dx + dy * dy < min2) {
      cs.tinyCubics++; // corda sotto soglia (anche estremi coincidenti): un solo Estremo
      continue;
    }
    addCurveEnd(bx, by);
  }

  const xy = new Float64Array((nEnd + nMid) * 2);
  xy.set(ends.subarray(0, nEnd * 2), 0);
  xy.set(mids.subarray(0, nMid * 2), nEnd * 2);
  return withCurves ? { width: w, height: h, xy, nEnd, nMid, stats, curves: cs, bytes: xy.byteLength } : { width: w, height: h, xy, nEnd, nMid, stats, bytes: xy.byteLength };
}
