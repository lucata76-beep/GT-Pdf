// Snap sul PDF, per pagina (V3.1, CP7b): lettura asincrona dei tratti rettilinei di UNA pagina (`getOperatorList`, `getOptionalContentConfig`), estrazione (src/pdf/geometry.ts), punti di snap
// (src/pdf/snapPoints.ts) e indice spaziale (src/pdf/pointIndex.ts), con lo STATO della pagina, i messaggi e la cache delle ultime N pagine.
//
// Niente DOM. NIENTE `page.cleanup()`: nell'editor la pagina e' del visore (a differenza di `measurePage`, la misura di Diagnostica, che la libera per misurare una lettura «fresca»).
// I punti stanno in una cache NOSTRA, indipendente dall'elenco di operazioni di PDF.js: l'esportazione chiama `page.cleanup()` e `doc.cleanup()` e quell'elenco sparisce.
// Mai eccezioni verso l'app: ogni errore (di PDF.js o dell'estrazione) diventa lo stato `unavailable`; la pagina resta usabile e lo snap sugli oggetti disegnati non cambia.
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type OpsTable, extractGeometry } from './geometry';
import { PointGrid } from './pointIndex';
import { type SheetMap, buildSnapPoints, visibleLineCount } from './snapPoints';

/**
 * TETTO PROVVISORIO di tratti rettilinei VISIBILI per pagina: sopra, lo snap sul PDF di quella pagina e' spento (e il messaggio dice quanti tratti ha la pagina e qual e' il tetto).
 * Scelto da Code misurando nel browser (Chromium, NON iPhone) con scripts/perf-cp7b.cjs: vedi docs/PIANO.md (decisione 111). L'utente lo ritara alla fine con i suoi PDF densi.
 */
export const SNAP_MAX_SEGMENTS = 150_000;
/** Limite di sicurezza dell'estrazione per lo snap (numeri letti dai Float32Array dei percorsi): sopra, la pagina e' «troppo grande» e lo snap PDF e' spento (la geometria sarebbe parziale). */
export const SNAP_MAX_COORDS = 3_000_000;
/** Quante pagine tiene la cache per documento (le ultime usate). */
export const SNAP_CACHE_PAGES = 3;

export interface SnapLoadTimings {
  /** `getOperatorList()` in ms (comprende la lettura della pagina se il visore non l'aveva gia' chiesta). */
  opListMs: number;
  extractMs: number;
  pointsMs: number;
  indexMs: number;
}

/** Perche' una pagina non ha tratti da agganciare. */
export type AbsentWhy = 'image' | 'hidden' | 'none';

/** Stato dello snap sul PDF di una pagina. «In corso» e' tenuto dall'app (la lettura e' asincrona). */
export type PdfSnapState =
  | { kind: 'ready'; source: PointGrid; segments: number; nEnd: number; nMid: number; bytes: number; timings: SnapLoadTimings }
  /** Nessun tratto rettilineo visibile: scansione o immagine (`image`), tratti solo in livelli spenti (`hidden`), solo testo, curve o riempimenti (`none`). */
  | { kind: 'absent'; why: AbsentWhy; segments: number }
  /** `ok: false` dell'estrattore, errore di PDF.js o formato non riconosciuto. */
  | { kind: 'unavailable'; reason: string }
  /** Piu' tratti visibili del tetto. */
  | { kind: 'dense'; segments: number; cap: number }
  /** Il limite di sicurezza dell'estrazione e' scattato: la geometria sarebbe parziale. */
  | { kind: 'truncated' };

export interface SnapLoadDeps {
  ops?: OpsTable;
  maxSegments?: number;
  maxCoords?: number;
  now?: () => number;
  /** Cede il controllo al browser fra una fase e l'altra (predefinito: un giro del ciclo degli eventi). */
  yieldToUi?: () => Promise<void>;
}

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const defaultYield = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Legge una pagina e ne costruisce lo stato dello snap sul PDF. `sheet` e' la geometria del foglio di QUELLA pagina (non quella del visore, che puo' essere gia' un'altra pagina).
 * Non lancia mai. La lettura di PDF.js e' asincrona; l'estrazione, i punti e l'indice sono sincroni (fasi separate da un cedimento al browser).
 */
export async function loadPdfSnap(doc: PDFDocumentProxy, pageNo: number, sheet: SheetMap, deps: SnapLoadDeps = {}): Promise<PdfSnapState> {
  const now = deps.now ?? ((): number => performance.now());
  const pause = deps.yieldToUi ?? defaultYield;
  const cap = deps.maxSegments ?? SNAP_MAX_SEGMENTS;
  try {
    const page = await doc.getPage(pageNo);
    const config = await doc.getOptionalContentConfig();
    const t0 = now();
    const ol = await page.getOperatorList();
    const t1 = now();
    await pause();
    const t2 = now();
    const res = extractGeometry({
      fnArray: ol.fnArray,
      argsArray: ol.argsArray,
      ops: deps.ops ?? (OPS as unknown as OpsTable),
      isLayerVisible: (data) => config.isVisible(data as never),
      maxCoords: deps.maxCoords ?? SNAP_MAX_COORDS,
    });
    const t3 = now();
    if (!res.ok) return { kind: 'unavailable', reason: res.reason };
    if (res.stats.truncated) return { kind: 'truncated' };
    const g = res.geometry;
    const visible = visibleLineCount(g);
    if (visible === 0) {
      const why: AbsentWhy = g.nLines > 0 ? 'hidden' : res.stats.ops.imageOps > 0 && res.stats.ops.constructPath === 0 ? 'image' : 'none';
      return { kind: 'absent', why, segments: g.nLines };
    }
    if (visible > cap) return { kind: 'dense', segments: visible, cap };
    await pause();
    const t4 = now();
    const pts = buildSnapPoints(g, sheet);
    const t5 = now();
    if (pts.nEnd + pts.nMid === 0) return { kind: 'absent', why: 'none', segments: g.nLines }; // tutti i punti fuori dal foglio
    await pause();
    const t6 = now();
    const grid = new PointGrid(pts);
    const t7 = now();
    return {
      kind: 'ready',
      source: grid,
      segments: visible,
      nEnd: pts.nEnd,
      nMid: pts.nMid,
      bytes: pts.bytes + grid.bytes,
      timings: { opListMs: t1 - t0, extractMs: t3 - t2, pointsMs: t5 - t4, indexMs: t7 - t6 },
    };
  } catch (e) {
    return { kind: 'unavailable', reason: errText(e) };
  }
}

const n0 = (n: number): string => new Intl.NumberFormat('it-IT').format(n);

/**
 * Il messaggio da dire UNA volta per pagina quando lo snap sul PDF non c'e' (riga dei messaggi dell'app e registro di Diagnostica; mai il nome del file). `null` per `ready`.
 * Dice sempre che gli oggetti disegnati si agganciano come prima.
 */
export function pdfSnapNote(state: PdfSnapState, pageNo: number): string | null {
  const tail = 'Gli oggetti disegnati si agganciano come sempre.';
  switch (state.kind) {
    case 'ready':
      return null;
    case 'absent':
      return state.why === 'image'
        ? `Pagina ${pageNo}: è un'immagine (scansione): non ci sono linee del PDF da agganciare. ${tail}`
        : state.why === 'hidden'
          ? `Pagina ${pageNo}: le linee del PDF sono tutte in livelli spenti: niente da agganciare. ${tail}`
          : `Pagina ${pageNo}: nessuna linea rettilinea visibile da agganciare nel PDF (solo testo, curve o riempimenti). ${tail}`;
    case 'dense':
      return `Pagina ${pageNo}: troppo fitta per l'aggancio al PDF (${n0(state.segments)} tratti, tetto ${n0(state.cap)}): spento per questa pagina. ${tail}`;
    case 'truncated':
      return `Pagina ${pageNo}: il disegno è troppo grande per essere letto per intero: aggancio al PDF spento per questa pagina (una lettura parziale agganciherebbe solo una parte). ${tail}`;
    case 'unavailable':
      return `Pagina ${pageNo}: aggancio al PDF non disponibile (lettura del disegno non riuscita). ${tail}`;
  }
}

/** Riga per il registro di Diagnostica (senza nome del file): i numeri della pagina e, se manca, il motivo. */
export function pdfSnapLogLine(state: PdfSnapState, pageNo: number): string {
  switch (state.kind) {
    case 'ready': {
      const t = state.timings;
      return `Snap PDF, pagina ${pageNo}: pronto, ${n0(state.nEnd)} estremi e ${n0(state.nMid)} punti medi da ${n0(state.segments)} tratti (${(state.bytes / 1048576).toFixed(2)} MB; lettura ${t.opListMs.toFixed(0)} ms, estrazione ${t.extractMs.toFixed(0)} ms, punti ${t.pointsMs.toFixed(0)} ms, indice ${t.indexMs.toFixed(0)} ms)`;
    }
    case 'absent':
      return `Snap PDF, pagina ${pageNo}: assente (${state.why === 'image' ? 'immagine' : state.why === 'hidden' ? 'solo livelli spenti' : 'nessun tratto rettilineo'}; tratti letti ${n0(state.segments)})`;
    case 'dense':
      return `Snap PDF, pagina ${pageNo}: spento, ${n0(state.segments)} tratti sopra il tetto di ${n0(state.cap)}`;
    case 'truncated':
      return `Snap PDF, pagina ${pageNo}: spento, lettura del disegno interrotta dal limite di sicurezza`;
    case 'unavailable':
      return `Snap PDF, pagina ${pageNo}: non disponibile: ${state.reason}`;
  }
}

/** Cache delle ultime `max` pagine usate (la meno usata esce per prima). Indipendente da PDF.js. */
export class PageCache<T> {
  private readonly m = new Map<number, T>();
  constructor(readonly max: number = SNAP_CACHE_PAGES) {}
  get(n: number): T | undefined {
    const v = this.m.get(n);
    if (v === undefined) return undefined;
    this.m.delete(n); // la rimette in coda: e' la piu' recente
    this.m.set(n, v);
    return v;
  }
  has(n: number): boolean {
    return this.m.has(n);
  }
  set(n: number, v: T): void {
    this.m.delete(n);
    this.m.set(n, v);
    while (this.m.size > this.max) {
      const oldest = this.m.keys().next();
      if (oldest.done) break;
      this.m.delete(oldest.value);
    }
  }
  clear(): void {
    this.m.clear();
  }
  get size(): number {
    return this.m.size;
  }
  /** Le pagine in cache, dalla meno alla piu' recente. */
  pages(): number[] {
    return [...this.m.keys()];
  }
}
