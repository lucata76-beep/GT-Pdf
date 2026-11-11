// Indice spaziale dei soli punti di snap del PDF (V3.1, CP7b): una GRIGLIA UNIFORME sul foglio (pt fisici), costruita una volta per pagina da `SnapPoints` (src/pdf/snapPoints.ts).
// Zoom e spostamento non la toccano (il raggio dello snap, in pt del foglio, e' l'unica cosa che cambia fra una interrogazione e l'altra).
//
// Perche' una griglia: i punti stanno in un rettangolo noto (il foglio), il raggio di cattura (10 px / zoom col mouse, 22 col dito) e' piccolo contro il foglio, e la costruzione e'
// lineare (ordinamento per conteggio, senza ordinare i punti). Gli oggetti DISEGNATI non la usano: restano a scansione lineare come in CP6a-CP6f (decisione 5 di CP6f, docs/PIANO.md).
//
// Risultato IDENTICO alla scansione lineare, anche nei pareggi: `forEachNear` chiama `emit` per i soli punti entro il raggio (stessa disuguaglianza di `consider` di
// src/geometry/snap.ts: dx^2 + dy^2 <= r^2, bordo compreso), nello STESSO ORDINE della scansione lineare `scanNear` (indice crescente: prima gli Estremi, poi i Punti medi, nell'ordine
// dei tratti del PDF). L'ordine conta: `consider` tiene il PRIMO fra due candidati alla stessa distanza e dello stesso tipo, e il confronto con la tolleranza di parita' non e' transitivo.
// Per questo le celle toccate dal quadrato del raggio si raccolgono e si ordinano per indice (ordinamento numerico di un Uint32Array, senza allocazioni per interrogazione).
import type { PdfSnapSource } from '../geometry/snap';
import type { SnapPoints } from './snapPoints';

/** Lato delle celle della griglia, pt fisici del foglio (VALORE DI PARTENZA scelto da Code, misurato in scripts/perf-cp7b.cjs; con 10 px a 1.33 px/pt il raggio del mouse e' ~7.5 pt). */
export const GRID_CELL_PT = 8;
/** Massimo di celle: se il foglio ne darebbe di piu', le celle si ingrandiscono (un foglio di 20000 x 20000 pt con celle da 8 pt sarebbe di 6.2 milioni di celle). */
export const GRID_MAX_CELLS = 1 << 22;

type Emit = (x: number, y: number, kind: 'end' | 'mid') => void;

/**
 * Riferimento: scansione lineare di tutti i punti, nell'ordine dell'array. Chiama `emit` per i punti dei tipi richiesti entro `radius` (bordo compreso) da (x, y). E' la definizione
 * del risultato dell'indice: `PointGrid.forEachNear` deve produrre la stessa sequenza (provato da un test differenziale).
 */
export function scanNear(p: SnapPoints, x: number, y: number, radius: number, end: boolean, mid: boolean, emit: Emit): void {
  if (!(radius > 0)) return;
  const r2 = radius * radius;
  const n = p.nEnd + p.nMid;
  const xy = p.xy;
  for (let i = 0; i < n; i++) {
    const isEnd = i < p.nEnd;
    if (isEnd ? !end : !mid) continue;
    const px = xy[2 * i] as number;
    const py = xy[2 * i + 1] as number;
    const dx = px - x;
    const dy = py - y;
    if (dx * dx + dy * dy > r2) continue;
    emit(px, py, isEnd ? 'end' : 'mid');
  }
}

export class PointGrid implements PdfSnapSource {
  /** Lato effettivo delle celle (pt) e loro numero per riga e per colonna. */
  readonly cellPt: number;
  readonly nx: number;
  readonly ny: number;
  /** Byte della struttura (offset delle celle e indici dei punti; esclusi i punti e il buffer di lavoro). */
  readonly bytes: number;
  private readonly cellStart: Uint32Array;
  private readonly items: Uint32Array;
  private scratch = new Uint32Array(256);

  constructor(
    private readonly pts: SnapPoints,
    cellPt: number = GRID_CELL_PT,
  ) {
    const w = Math.max(pts.width, 1e-9);
    const h = Math.max(pts.height, 1e-9);
    let c = cellPt > 0 ? cellPt : GRID_CELL_PT;
    if (Math.ceil(w / c) * Math.ceil(h / c) > GRID_MAX_CELLS) c = Math.sqrt((w * h) / GRID_MAX_CELLS) * 1.0001;
    this.cellPt = c;
    this.nx = Math.max(1, Math.ceil(w / c));
    this.ny = Math.max(1, Math.ceil(h / c));
    const nCells = this.nx * this.ny;
    const n = pts.nEnd + pts.nMid;
    const start = new Uint32Array(nCells + 1);
    const cellOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const id = this.cellId(pts.xy[2 * i] as number, pts.xy[2 * i + 1] as number);
      cellOf[i] = id;
      start[id + 1]!++;
    }
    for (let k = 0; k < nCells; k++) start[k + 1] = (start[k + 1] as number) + (start[k] as number);
    const fill = start.slice(0, nCells); // posizione di scrittura di ogni cella
    const items = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const id = cellOf[i] as number;
      items[fill[id] as number] = i; // gli indici di una cella restano crescenti: i punti si scorrono in ordine
      fill[id]!++;
    }
    this.cellStart = start;
    this.items = items;
    this.bytes = start.byteLength + items.byteLength;
  }

  get nPoints(): number {
    return this.pts.nEnd + this.pts.nMid;
  }
  get nEnd(): number {
    return this.pts.nEnd;
  }
  get nMid(): number {
    return this.pts.nMid;
  }
  /** I punti (la stessa struttura con cui e' costruita la griglia): serve ai confronti con la scansione lineare. */
  get points(): SnapPoints {
    return this.pts;
  }

  private cellId(x: number, y: number): number {
    const cx = Math.min(this.nx - 1, Math.max(0, Math.floor(x / this.cellPt)));
    const cy = Math.min(this.ny - 1, Math.max(0, Math.floor(y / this.cellPt)));
    return cy * this.nx + cx;
  }

  forEachNear(x: number, y: number, radius: number, end: boolean, mid: boolean, emit: Emit): void {
    if (!(radius > 0) || (!end && !mid)) return;
    const pts = this.pts;
    const xy = pts.xy;
    const r2 = radius * radius;
    // Il quadrato del raggio, un po' piu' largo per l'errore di arrotondamento di x +- r (nessun punto entro il raggio puo' stare fuori dalle celle toccate).
    const pad = radius * (1 + 1e-12) + 1e-9;
    const x0 = x - pad;
    const x1 = x + pad;
    const y0 = y - pad;
    const y1 = y + pad;
    if (x1 < 0 || x0 > pts.width || y1 < 0 || y0 > pts.height) return;
    const c = this.cellPt;
    const cx0 = Math.max(0, Math.floor(x0 / c));
    const cx1 = Math.min(this.nx - 1, Math.floor(x1 / c));
    const cy0 = Math.max(0, Math.floor(y0 / c));
    const cy1 = Math.min(this.ny - 1, Math.floor(y1 / c));
    const nEnd = pts.nEnd;
    let n = 0;
    let sc = this.scratch;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.nx;
      for (let cx = cx0; cx <= cx1; cx++) {
        const id = row + cx;
        const e = this.cellStart[id + 1] as number;
        for (let k = this.cellStart[id] as number; k < e; k++) {
          const i = this.items[k] as number;
          if (i < nEnd ? !end : !mid) continue;
          const dx = (xy[2 * i] as number) - x;
          const dy = (xy[2 * i + 1] as number) - y;
          if (dx * dx + dy * dy > r2) continue;
          if (n === sc.length) {
            const bigger = new Uint32Array(sc.length * 2);
            bigger.set(sc);
            this.scratch = sc = bigger;
          }
          sc[n++] = i;
        }
      }
    }
    if (n === 0) return;
    if (n > 1) sc.subarray(0, n).sort(); // numerico, in sito: l'ordine dell'array di punti, come la scansione lineare
    for (let k = 0; k < n; k++) {
      const i = sc[k] as number;
      emit(xy[2 * i] as number, xy[2 * i + 1] as number, i < nEnd ? 'end' : 'mid');
    }
  }
}
