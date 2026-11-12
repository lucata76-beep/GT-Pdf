// Scena dei TRATTI rettilinei del PDF per Intersezione e Perpendicolare (V3.2b, CP7d): dai segmenti di `PdfGeometry` (src/pdf/geometry.ts, spazio utente) ai tratti nel FOGLIO mostrato
// (pt fisici, origine in alto a sinistra, /Rotate, CropBox e UserUnit gia' applicati: la stessa formula di `PageGeometry.userToSheet` usata da src/pdf/snapPoints.ts) con un indice
// spaziale. Modulo PURO: niente DOM, niente PDF.js.
//
// Regole (SCELTE DELL'ASSISTENTE-CODE per CP7d, dichiarate e da confermare; le soglie sono valori di PARTENZA non tarati sui PDF dell'utente):
//  - entrano solo i tratti rettilinei dei percorsi VISIBILI (`pathVisible` = 1: un livello spento non da' tratti); i riempimenti e `endPath` non sono nei dati di `PdfGeometry`.
//    NON le cubiche (nessuna Intersezione o Perpendicolare con le curve del PDF in questa tappa);
//  - un tratto piu' corto di MIN_SEGMENT_PT (pt FISICI del foglio, gli stessi di CP7b) e' quasi un punto e resta FUORI dalla scena;
//  - la scena contiene la parte del tratto che sta SUL FOGLIO: un estremo fuori dal foglio di meno di PAGE_MARGIN_PT si riporta sul bordo (come i punti di CP7b), un tratto che esce dal
//    foglio si RITAGLIA sul bordo (Liang-Barsky), un tratto tutto fuori e' scartato; un tratto ritagliato sotto MIN_SEGMENT_PT e' scartato. Cosi' ogni tratto sta dentro l'area della griglia
//    e Intersezione e Perpendicolare non danno mai un punto fuori dalla pagina (il clic sarebbe rifiutato). I tratti dentro il foglio non sono toccati: gli estremi sono UGUALI AL BIT a
//    quelli dei punti Estremo di CP7b;
//  - indice: UNA griglia uniforme sul foglio, con ogni tratto registrato in OGNI cella che attraversa (percorso colonna per colonna: per ogni colonna le righe fra le due ordinate del tratto
//    sui bordi della colonna), con un margine di REG_EPS pt (registrazione CONSERVATIVA: i tratti orizzontali o verticali sul bordo di una cella stanno in tutte e due le celle, e un tratto
//    che passa per un angolo di cella in tutte e quattro). Il lato della cella parte da SEGMENT_GRID_CELL_PT e RADDOPPIA (fino a SEGMENT_GRID_MAX_CELL_PT) se le voci registrate sarebbero
//    piu' di `maxRefs` (tratti lunghi attraversano molte celle); se non basta neppure alla cella massima la scena e' «fitta» e non si costruisce (stato dichiarato da `snapPage.ts`);
//  - risultato IDENTICO alla scansione lineare `scanSegmentsNear`, sequenza compresa: l'indice sceglie solo quali tratti provare (un insieme che contiene sempre quelli vicini), poi applica
//    lo STESSO predicato (`segmentNearPoint`, snapExtra.ts) e ordina gli indici in modo crescente senza doppioni; l'ordine conta perche' `findSnap` tiene il primo fra due candidati alla
//    stessa distanza e dello stesso tipo.
//
// Memoria per tratto: 4 Float64 (32 byte) + il percorso (4 byte) + 4 byte per ogni voce di cella (di solito 1-3 voci per tratto corto) + le offset delle celle. Costruzione: due passaggi
// sui tratti (conteggio e riempimento, in stile CSR come `PointGrid`), senza oggetti per tratto.
import { type PdfSegmentSource, segmentNearPoint } from '../geometry/snapExtra';
import type { PdfGeometry } from './geometry';
import { MIN_SEGMENT_PT, PAGE_MARGIN_PT, type SheetMap } from './snapPoints';

/** Lato di partenza delle celle (pt fisici del foglio): come la griglia dei punti (`GRID_CELL_PT` di pointIndex.ts); con 10 px a 1.33 px/pt il raggio del mouse e' ~7.5 pt. */
export const SEGMENT_GRID_CELL_PT = 8;
/** Lato massimo delle celle (si raddoppia da SEGMENT_GRID_CELL_PT fin qui se le voci sarebbero troppe). */
export const SEGMENT_GRID_MAX_CELL_PT = 64;
/** Massimo di celle della griglia (come `GRID_MAX_CELLS` di pointIndex.ts): su un foglio enorme le celle si ingrandiscono. */
export const SEGMENT_GRID_MAX_CELLS = 1 << 22;
/**
 * TETTO PROVVISORIO delle voci di cella (un tratto che attraversa k celle ne ha k): 6.000.000 = 24 MB di indici (Uint32). Sopra, anche con le celle da SEGMENT_GRID_MAX_CELL_PT, la
 * scena dei tratti NON si costruisce per quella pagina (Estremo e Punto medio del PDF restano). SCELTA DI CODE, da confermare: numeri in docs/PIANO.md, decisione 117.
 */
export const SEGMENT_MAX_REFS = 6_000_000;
/** Margine (pt) con cui si registra un tratto nelle celle: copre gli errori di arrotondamento del percorso colonna per colonna e della divisione per il lato della cella. */
const REG_EPS = 1e-6;
/** Byte per tratto senza le voci di cella: 4 Float64 e l'indice del percorso. */
export const BYTES_PER_SEGMENT = 36;

export interface SegmentSceneStats {
  /** Tratti rettilinei dei percorsi candidati (visibili o no). */
  segments: number;
  /** Fra questi, quelli dentro un livello spento. */
  hidden: number;
  /** Tratti visibili sotto MIN_SEGMENT_PT (nel foglio, prima del ritaglio): fuori dalla scena. */
  tiny: number;
  /** Tratti visibili tutti fuori dal foglio (o ritagliati sotto MIN_SEGMENT_PT): fuori dalla scena. */
  outside: number;
  /** Tratti visibili che escono dal foglio e sono stati ritagliati sul bordo (restano nella scena). */
  clipped: number;
  /** Tratti nella scena. */
  kept: number;
  /** Voci di cella registrate (un tratto che attraversa k celle ne ha k), con la cella scelta; 0 se la scena e' fitta e non si e' costruita. */
  refs: number;
  /** Lato delle celle scelto (pt); 0 se la scena e' fitta. */
  cellPt: number;
  /** Celle della griglia (0 se fitta). */
  cells: number;
  /** Byte della scena (tratti, percorsi, voci e offset); 0 se fitta. */
  bytes: number;
  /** La scena NON e' stata costruita: le voci sarebbero state piu' di `maxRefs` anche con le celle da SEGMENT_GRID_MAX_CELL_PT (`refs` e' allora le voci che avrebbe avuto alla cella massima). */
  dense: boolean;
  /** Il tetto delle voci con cui e' stata costruita (o rifiutata). */
  maxRefs: number;
}

export interface SegmentSceneResult {
  /** L'indice, o null se non ci sono tratti nella scena o se e' fitta (vedi `stats.dense`). */
  grid: SegmentGrid | null;
  stats: SegmentSceneStats;
}

export interface BuildSegmentSceneOptions {
  /** Tetto delle voci di cella (predefinito SEGMENT_MAX_REFS). */
  maxRefs?: number;
  /** Lato di partenza delle celle (predefinito SEGMENT_GRID_CELL_PT). */
  cellPt?: number;
}

type EmitSegment = (id: number, path: number, x1: number, y1: number, x2: number, y2: number) => void;

/**
 * Riferimento: scansione lineare di tutti i tratti, nell'ordine dell'array. E' la DEFINIZIONE del risultato dell'indice: `SegmentGrid.forEachNear` deve produrre la stessa sequenza (provato
 * da un test differenziale). Stessa uscita: chiama `emit` per i tratti entro `radius` da (x, y) e restituisce true; con piu' di `max` NON emette nulla e restituisce false.
 */
export function scanSegmentsNear(xy: Float64Array, path: Uint32Array, n: number, x: number, y: number, radius: number, max: number, emit: EmitSegment): boolean {
  if (!(radius > 0)) return true;
  const r2 = radius * radius;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = 4 * i;
    if (segmentNearPoint(xy[o] as number, xy[o + 1] as number, xy[o + 2] as number, xy[o + 3] as number, x, y, radius, r2)) count++;
  }
  if (count > max) return false;
  if (count === 0) return true;
  for (let i = 0; i < n; i++) {
    const o = 4 * i;
    const a = xy[o] as number;
    const b = xy[o + 1] as number;
    const c = xy[o + 2] as number;
    const d = xy[o + 3] as number;
    if (segmentNearPoint(a, b, c, d, x, y, radius, r2)) emit(i, path[i] as number, a, b, c, d);
  }
  return true;
}

const clampCell = (v: number, n: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v);

/**
 * Conta (`items` null: `tab[id + 1]++`) o registra (`items`: `items[tab[id]++] = i`) le celle toccate dal tratto `i`, con il margine REG_EPS. Restituisce quante. Tutto il percorso e' una
 * funzione sola dei quattro numeri del tratto e del lato della cella, quindi conteggio e riempimento danno le stesse celle.
 */
function walkCells(xy: Float64Array, i: number, c: number, nx: number, ny: number, tab: Uint32Array, items: Uint32Array | null): number {
  const o = 4 * i;
  const x1 = xy[o] as number;
  const y1 = xy[o + 1] as number;
  const x2 = xy[o + 2] as number;
  const y2 = xy[o + 3] as number;
  const minX = x1 < x2 ? x1 : x2;
  const maxX = x1 < x2 ? x2 : x1;
  const minY = y1 < y2 ? y1 : y2;
  const maxY = y1 < y2 ? y2 : y1;
  const inv = 1 / c;
  const cx0 = clampCell(Math.floor((minX - REG_EPS) * inv), nx);
  const cx1 = clampCell(Math.floor((maxX + REG_EPS) * inv), nx);
  const dx = x2 - x1;
  const flat = cx0 === cx1 || Math.abs(dx) < 1e-12; // una colonna sola o quasi verticale: tutte le righe del riquadro
  const slope = flat ? 0 : (y2 - y1) / dx;
  let total = 0;
  for (let cx = cx0; cx <= cx1; cx++) {
    let ylo = minY;
    let yhi = maxY;
    if (!flat) {
      // le ordinate del tratto sui due bordi della colonna (allargata di REG_EPS e ristretta al tratto)
      let sx0 = cx * c - REG_EPS;
      let sx1 = (cx + 1) * c + REG_EPS;
      if (sx0 < minX) sx0 = minX;
      if (sx1 > maxX) sx1 = maxX;
      const ya = y1 + (sx0 - x1) * slope;
      const yb = y1 + (sx1 - x1) * slope;
      ylo = ya < yb ? ya : yb;
      yhi = ya < yb ? yb : ya;
      if (ylo < minY) ylo = minY;
      else if (ylo > maxY) ylo = maxY;
      if (yhi > maxY) yhi = maxY;
      else if (yhi < minY) yhi = minY;
    }
    const cy0 = clampCell(Math.floor((ylo - REG_EPS) * inv), ny);
    const cy1 = clampCell(Math.floor((yhi + REG_EPS) * inv), ny);
    for (let cy = cy0; cy <= cy1; cy++) {
      const id = cy * nx + cx;
      if (items) items[tab[id]!++] = i;
      else tab[id + 1]!++;
      total++;
    }
  }
  return total;
}

/** La griglia di tratti: indice spaziale e sorgente `PdfSegmentSource`. Si costruisce con `buildSegmentScene`. */
export class SegmentGrid implements PdfSegmentSource {
  /** Byte della scena: tratti, percorsi, voci e offset delle celle (esclusi i buffer di lavoro). */
  readonly bytes: number;
  private scratch = new Uint32Array(256);

  constructor(
    /** x1, y1, x2, y2 per tratto, nel foglio, ritagliati sul foglio. */
    readonly xy: Float64Array,
    /** Indice del percorso del PDF di ogni tratto. */
    readonly path: Uint32Array,
    readonly n: number,
    readonly width: number,
    readonly height: number,
    readonly cellPt: number,
    readonly nx: number,
    readonly ny: number,
    private readonly cellStart: Uint32Array,
    private readonly items: Uint32Array,
  ) {
    this.bytes = xy.byteLength + path.byteLength + cellStart.byteLength + items.byteLength;
  }

  /** Voci di cella registrate. */
  get refs(): number {
    return this.items.length;
  }

  forEachNear(x: number, y: number, radius: number, max: number, emit: EmitSegment): boolean {
    if (!(radius > 0) || this.n === 0) return true;
    // Il quadrato del raggio, un po' piu' largo per l'errore di arrotondamento di x +- r: nessun tratto entro il raggio puo' avere il punto piu' vicino fuori dalle celle toccate.
    const pad = radius * (1 + 1e-12) + 1e-9;
    const x0 = x - pad;
    const x1 = x + pad;
    const y0 = y - pad;
    const y1 = y + pad;
    if (x1 < 0 || x0 > this.width || y1 < 0 || y0 > this.height) return true;
    const c = this.cellPt;
    const cx0 = Math.max(0, Math.floor(x0 / c));
    const cx1 = Math.min(this.nx - 1, Math.floor(x1 / c));
    const cy0 = Math.max(0, Math.floor(y0 / c));
    const cy1 = Math.min(this.ny - 1, Math.floor(y1 / c));
    const r2 = radius * radius;
    const xy = this.xy;
    let sc = this.scratch;
    let k = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.nx;
      for (let cx = cx0; cx <= cx1; cx++) {
        const id = row + cx;
        const e = this.cellStart[id + 1] as number;
        for (let j = this.cellStart[id] as number; j < e; j++) {
          const i = this.items[j] as number;
          const o = 4 * i;
          if (!segmentNearPoint(xy[o] as number, xy[o + 1] as number, xy[o + 2] as number, xy[o + 3] as number, x, y, radius, r2)) continue;
          if (k === sc.length) {
            const bigger = new Uint32Array(sc.length * 2);
            bigger.set(sc);
            this.scratch = sc = bigger;
          }
          sc[k++] = i;
        }
      }
    }
    if (k === 0) return true;
    // un tratto che attraversa piu' celle toccate e' stato trovato piu' volte: ordine crescente e senza doppioni, come la scansione lineare
    if (k > 1) {
      sc.subarray(0, k).sort();
      let m = 1;
      for (let j = 1; j < k; j++) if (sc[j] !== sc[m - 1]) sc[m++] = sc[j] as number;
      k = m;
    }
    if (k > max) return false;
    for (let j = 0; j < k; j++) {
      const i = sc[j] as number;
      const o = 4 * i;
      emit(i, this.path[i] as number, xy[o] as number, xy[o + 1] as number, xy[o + 2] as number, xy[o + 3] as number);
    }
    return true;
  }
}

/** Quanti nx x ny dara' una griglia di lato `c` sul foglio (come `PointGrid`: le celle si ingrandiscono se sarebbero troppe). */
function gridOf(w: number, h: number, c: number): { c: number; nx: number; ny: number } {
  let cc = c > 0 ? c : SEGMENT_GRID_CELL_PT;
  if (Math.ceil(w / cc) * Math.ceil(h / cc) > SEGMENT_GRID_MAX_CELLS) cc = Math.sqrt((w * h) / SEGMENT_GRID_MAX_CELLS) * 1.0001;
  return { c: cc, nx: Math.max(1, Math.ceil(w / cc)), ny: Math.max(1, Math.ceil(h / cc)) };
}

/** Il risultato di `clipToSheet`: x1, y1, x2, y2. */
const clipped = new Float64Array(4);

/**
 * Porta il tratto sul foglio [0, w] x [0, h] (risultato in `clipped`): gli estremi fuori dal foglio di al piu' PAGE_MARGIN_PT si riportano sul bordo (come i punti Estremo di CP7b), poi il
 * resto si ritaglia (Liang-Barsky). false se il tratto sta tutto fuori dal foglio.
 */
function clipToSheet(ax: number, ay: number, bx: number, by: number, w: number, h: number): boolean {
  const lim = PAGE_MARGIN_PT;
  if (ax >= -lim && ax <= w + lim && ay >= -lim && ay <= h + lim) {
    ax = ax < 0 ? 0 : ax > w ? w : ax;
    ay = ay < 0 ? 0 : ay > h ? h : ay;
  }
  if (bx >= -lim && bx <= w + lim && by >= -lim && by <= h + lim) {
    bx = bx < 0 ? 0 : bx > w ? w : bx;
    by = by < 0 ? 0 : by > h ? h : by;
  }
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  // (p, q) per i quattro bordi: x >= 0, x <= w, y >= 0, y <= h
  for (let k = 0; k < 4; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dy : dy;
    const q = k === 0 ? ax : k === 1 ? w - ax : k === 2 ? ay : h - ay;
    if (p === 0) {
      if (q < 0) return false; // parallelo al bordo e fuori
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  const nax = ax + t0 * dx;
  const nay = ay + t0 * dy;
  const nbx = ax + t1 * dx;
  const nby = ay + t1 * dy;
  clipped[0] = nax < 0 ? 0 : nax > w ? w : nax;
  clipped[1] = nay < 0 ? 0 : nay > h ? h : nay;
  clipped[2] = nbx < 0 ? 0 : nbx > w ? w : nbx;
  clipped[3] = nby < 0 ? 0 : nby > h ? h : nby;
  return true;
}

/**
 * Costruisce la scena dei tratti rettilinei visibili e il suo indice. Non lancia: una geometria senza tratti da' `grid: null` e `kept: 0`. Costo lineare nel numero di tratti (e nelle voci
 * di cella). Con `stats.dense` la scena non c'e' (`grid: null`): vedi SEGMENT_MAX_REFS.
 */
export function buildSegmentScene(g: PdfGeometry, sheet: SheetMap, opts: BuildSegmentSceneOptions = {}): SegmentSceneResult {
  const w = sheet.width;
  const h = sheet.height;
  const nL = g.nLines;
  const maxRefs = opts.maxRefs ?? SEGMENT_MAX_REFS;
  const stats: SegmentSceneStats = { segments: nL, hidden: 0, tiny: 0, outside: 0, clipped: 0, kept: 0, refs: 0, cellPt: 0, cells: 0, bytes: 0, dense: false, maxRefs };
  const xyAll = new Float64Array(nL * 4);
  const pathAll = new Uint32Array(nL);
  const m = sheet.matrix;
  const inp = { x: 0, y: 0 };
  const min2 = MIN_SEGMENT_PT * MIN_SEGMENT_PT;
  let n = 0;
  let l1 = 0; // somma di |dx| + |dy| dei tratti tenuti: serve a stimare le voci di cella

  for (let i = 0; i < nL; i++) {
    const pathId = g.linePath[i] as number;
    if (g.pathVisible[pathId] !== 1) {
      stats.hidden++;
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
      // la stessa formula, nello stesso ordine, di buildSnapPoints (gli estremi sono uguali al bit a quelli dei punti Estremo)
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
    let dx = bx - ax;
    let dy = by - ay;
    if (dx * dx + dy * dy < min2) {
      stats.tiny++;
      continue;
    }
    if (!(ax >= 0 && ax <= w && ay >= 0 && ay <= h && bx >= 0 && bx <= w && by >= 0 && by <= h)) {
      // almeno un estremo fuori dal foglio: ritaglio sul foglio (vedi `clipToSheet`)
      if (!clipToSheet(ax, ay, bx, by, w, h)) {
        stats.outside++;
        continue;
      }
      ax = clipped[0] as number;
      ay = clipped[1] as number;
      bx = clipped[2] as number;
      by = clipped[3] as number;
      dx = bx - ax;
      dy = by - ay;
      if (dx * dx + dy * dy < min2) {
        stats.outside++;
        continue;
      }
      stats.clipped++;
    }
    const q = 4 * n;
    xyAll[q] = ax;
    xyAll[q + 1] = ay;
    xyAll[q + 2] = bx;
    xyAll[q + 3] = by;
    pathAll[n] = pathId;
    l1 += Math.abs(dx) + Math.abs(dy);
    n++;
  }
  stats.kept = n;
  if (n === 0) return { grid: null, stats };

  const xy = n === nL ? xyAll : xyAll.slice(0, 4 * n);
  const path = n === nL ? pathAll : pathAll.slice(0, n);

  // lato della cella: il piu' piccolo (da quello di partenza, raddoppiando) per cui la STIMA delle voci (n + somma(|dx| + |dy|) / lato) sta nel tetto; poi si conta davvero
  let c = opts.cellPt && opts.cellPt > 0 ? opts.cellPt : SEGMENT_GRID_CELL_PT;
  while (c < SEGMENT_GRID_MAX_CELL_PT && n + l1 / c > maxRefs) c *= 2;
  for (;;) {
    const gr = gridOf(w, h, c);
    const nCells = gr.nx * gr.ny;
    const start = new Uint32Array(nCells + 1);
    let refs = 0;
    for (let i = 0; i < n; i++) refs += walkCells(xy, i, gr.c, gr.nx, gr.ny, start, null);
    if (refs > maxRefs) {
      if (c < SEGMENT_GRID_MAX_CELL_PT) {
        c *= 2;
        continue;
      }
      stats.dense = true;
      stats.refs = refs;
      return { grid: null, stats };
    }
    for (let k = 0; k < nCells; k++) start[k + 1] = (start[k + 1] as number) + (start[k] as number);
    const fill = start.slice(0, nCells); // posizione di scrittura di ogni cella: i tratti di una cella restano in ordine di indice
    const items = new Uint32Array(refs);
    for (let i = 0; i < n; i++) walkCells(xy, i, gr.c, gr.nx, gr.ny, fill, items);
    const grid = new SegmentGrid(xy, path, n, w, h, gr.c, gr.nx, gr.ny, start, items);
    stats.refs = refs;
    stats.cellPt = gr.c;
    stats.cells = nCells;
    stats.bytes = grid.bytes;
    return { grid, stats };
  }
}
