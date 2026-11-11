// Punti di snap dei tratti rettilinei del PDF (V3.1, CP7b): dai segmenti di `PdfGeometry` (src/pdf/geometry.ts, spazio utente) ai punti Estremo e Punto medio nel FOGLIO
// mostrato (pt fisici, origine in alto a sinistra, /Rotate, CropBox e UserUnit gia' applicati), con la stessa conversione degli oggetti disegnati (`PageGeometry.userToSheet`).
//
// Modulo PURO: niente DOM, niente PDF.js, niente indice (l'indice spaziale e' in src/pdf/pointIndex.ts).
//
// Regole (SCELTE DELL'ASSISTENTE-CODE per CP7b, dichiarate e da confermare; le soglie sono valori di PARTENZA non tarati sui PDF dell'utente):
//  - entrano solo i segmenti dei percorsi VISIBILI (`pathVisible` = 1: un livello spento non da' punti) e solo i rettilinei (`lineXY`): le cubiche NON entrano in questa tappa;
//  - Estremo = i due estremi di ogni tratto; Punto medio = il centro di ogni tratto, calcolato nel FOGLIO in doppia precisione come gli oggetti disegnati
//    (`(a + b) / 2` dei due estremi gia' convertiti: vedi `visitCandidates` di src/geometry/snap.ts);
//  - un tratto piu' corto di MIN_SEGMENT_PT (pt FISICI del foglio) e' quasi un punto: niente Punto medio e un solo Estremo (il primo punto; il secondo dista meno di 0.01 pt);
//  - i punti coincidenti si UNISCONO (i tratti di una spezzata condividono gli estremi): due punti dello stesso tipo a distanza <= MERGE_TOL_PT (pt fisici) sono uno solo, il
//    primo (il punto che resta non e' una media: e' uno dei due, spostato al piu' di 1e-3 pt); un Estremo e un Punto medio nella stessa posizione restano due punti (tipi diversi);
//  - un punto fuori dal foglio di piu' di PAGE_MARGIN_PT non si vede e non e' un candidato; entro il margine si riporta sul bordo (il Float32 di PDF.js sposta di ~1e-6 pt un
//    bordo disegnato esattamente sul bordo del foglio: senza riportarlo il punto agganciato sarebbe «fuori dalla pagina» e il clic rifiutato).
//
// Struttura: UN Float64Array `xy` (x0, y0, x1, y1, ...) con prima i `nEnd` Estremi poi i `nMid` Punti medi; 16 byte per punto (doppia precisione: la conversione nel foglio
// non aggiunge errore a quello del Float32 di PDF.js, 2.8e-5 pt sui PDF di prova di formato A3, misurato in CP7a). L'ordine dei punti e' quello dei tratti nel PDF.
import type { PdfGeometry } from './geometry';

/** Sotto questa lunghezza (pt fisici del foglio) un tratto e' un punto: niente Punto medio, un solo Estremo. Con UserUnit 1 coincide con il primo contenitore dell'istogramma di CP7a (< 0.01 pt utente). */
export const MIN_SEGMENT_PT = 0.01;
/** Due punti dello stesso tipo a questa distanza o meno (pt fisici) sono un punto solo (il primo). */
export const MERGE_TOL_PT = 0.001;
/** Lato delle celle della tabella di unione: 4 x MERGE_TOL_PT (pt fisici). */
const CELL_PT = 4 * MERGE_TOL_PT;
/** Un punto fuori dal foglio di piu' di cosi' (pt fisici) e' scartato; entro il margine e' riportato sul bordo. */
export const PAGE_MARGIN_PT = 0.01;
/** Byte per punto di `SnapPoints.xy` (due Float64). */
export const BYTES_PER_POINT = 16;

/** Il minimo che serve del foglio: dimensioni e conversione utente -> foglio (`PageGeometry` la soddisfa). */
export interface SheetMap {
  readonly width: number;
  readonly height: number;
  userToSheet(p: { x: number; y: number }): { x: number; y: number };
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

export interface SnapPoints {
  /** Foglio mostrato (pt fisici): lo stesso con cui sono stati calcolati i punti. */
  width: number;
  height: number;
  /** x, y per punto, nel foglio: prima i `nEnd` Estremi, poi i `nMid` Punti medi. */
  xy: Float64Array;
  nEnd: number;
  nMid: number;
  stats: SnapPointStats;
  /** Byte di `xy`. */
  bytes: number;
}

/** Quanti tratti rettilinei VISIBILI ha la geometria (quelli che danno punti); serve al tetto di primitive prima di costruire. */
export function visibleLineCount(g: PdfGeometry): number {
  let n = 0;
  for (let i = 0; i < g.nLines; i++) if (g.pathVisible[g.linePath[i] as number] === 1) n++;
  return n;
}

const nextPow2 = (n: number): number => {
  let p = 16;
  while (p < n) p *= 2;
  return p;
};

/**
 * Tabella a indirizzamento aperto per unire i punti coincidenti (indice + 1; 0 = vuoto), una per tipo, senza allocazioni per punto. I punti sono ordinati in celle di lato
 * 4 x MERGE_TOL_PT; per un punto nuovo si guardano le (al piu' 4) celle che toccano il quadrato di lato 2 x MERGE_TOL_PT attorno a lui e si unisce al primo punto gia' presente a
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
 * Costruisce i punti dei tratti rettilinei visibili. Non lancia: una geometria senza tratti da' zero punti. Costo lineare nel numero di tratti.
 */
export function buildSnapPoints(g: PdfGeometry, sheet: SheetMap): SnapPoints {
  const w = sheet.width;
  const h = sheet.height;
  const nL = g.nLines;
  const stats: SnapPointStats = { segments: nL, hiddenSegments: 0, tinySegments: 0, outsidePoints: 0, mergedEnd: 0, mergedMid: 0 };
  const ends = new Float64Array(nL * 4); // al piu' 2 Estremi per tratto
  const mids = new Float64Array(nL * 2);
  const endTable = new MergeTable(nL * 2);
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

  for (let i = 0; i < nL; i++) {
    if (g.pathVisible[g.linePath[i] as number] !== 1) {
      stats.hiddenSegments++;
      continue;
    }
    const o = i * 4;
    inp.x = g.lineXY[o] as number;
    inp.y = g.lineXY[o + 1] as number;
    const a = sheet.userToSheet(inp);
    inp.x = g.lineXY[o + 2] as number;
    inp.y = g.lineXY[o + 3] as number;
    const b = sheet.userToSheet(inp);
    addEnd(a.x, a.y);
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT_PT) {
      stats.tinySegments++;
      continue;
    }
    addEnd(b.x, b.y);
    addMid((a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  const xy = new Float64Array((nEnd + nMid) * 2);
  xy.set(ends.subarray(0, nEnd * 2), 0);
  xy.set(mids.subarray(0, nMid * 2), nEnd * 2);
  return { width: w, height: h, xy, nEnd, nMid, stats, bytes: xy.byteLength };
}
