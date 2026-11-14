// Snap sul PDF, per pagina (V3.1, CP7b; Estremo delle curve V3.2a, CP7c; Intersezione e Perpendicolare sui tratti V3.2b, CP7d; Centro e Quadrante degli anelli V3.3a, CP7f): lettura asincrona dei tratti rettilinei e delle curve di UNA
// pagina (`getOperatorList`, `getOptionalContentConfig`), estrazione (src/pdf/geometry.ts), punti di snap (src/pdf/snapPoints.ts), indice spaziale dei punti (src/pdf/pointIndex.ts) e, dal
// CP7d, scena dei tratti con il suo indice (src/pdf/segmentIndex.ts), con lo STATO della pagina, i messaggi e la cache delle ultime N pagine.
//
// Niente DOM. `page.cleanup()` solo DOPO l'estrazione e solo perche' il documento e' dedicato (vedi sotto): sul documento del visore non va MAI chiamata da qui.
// Il documento da passare a `loadPdfSnap` NON e' quello del visore ma una seconda istanza sugli stessi byte (`opsDocument` di src/pdf/loader.ts): una `getOperatorList()` in
// parallelo a un `render()` della stessa pagina dello stesso documento da' un elenco sbagliato se la pagina ha annotazioni con un aspetto proprio (misurato in Chromium).
// I punti stanno in una cache NOSTRA, indipendente da PDF.js: l'esportazione chiama `page.cleanup()` e `doc.cleanup()` sul documento del visore.
// Mai eccezioni verso l'app: ogni errore (di PDF.js o dell'estrazione) diventa lo stato `unavailable`; la pagina resta usabile e lo snap sugli oggetti disegnati non cambia.
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type OpsTable, extractGeometry } from './geometry';
import { PointGrid } from './pointIndex';
import { type RingPointStats, RingSource, buildRingPoints, ringCount } from './ringPoints';
import { SEGMENT_GRID_MAX_CELL_PT, type SegmentGrid, type SegmentSceneStats, buildSegmentScene } from './segmentIndex';
import { type SheetMap, buildSnapPoints, visibleCubicCount, visibleLineCount } from './snapPoints';

/**
 * TETTO PROVVISORIO di primitive VISIBILI per pagina: tratti rettilinei PIU' cubiche (CP7c: ognuna conta 1, SCELTA DELL'ASSISTENTE-CODE da confermare; ragione e numeri in docs/PIANO.md,
 * decisione 114). Sopra, lo snap sul PDF di quella pagina e' spento (e il messaggio dice quanti tratti e curve ha la pagina e qual e' il tetto).
 * Valore scelto da Code in CP7b misurando nel browser (Chromium, NON iPhone) con scripts/perf-cp7b.cjs (decisione 111): con l'indice `findSnap` resta sotto 4 ms anche a 600.000 tratti;
 * a limitare e' il blocco una tantum della lettura (estrazione, punti e indice, in fasi separate) e la memoria. In CP7c NON e' cambiato (rimisurato con curve: scripts/perf-cp7c.cjs).
 * L'utente lo ritara alla fine con i suoi PDF densi.
 */
export const SNAP_MAX_SEGMENTS = 300_000;
/** Limite di sicurezza dell'estrazione per lo snap (numeri letti dai Float32Array dei percorsi): sopra, la pagina e' «troppo grande» e lo snap PDF e' spento (la geometria sarebbe parziale). */
export const SNAP_MAX_COORDS = 4_000_000;
/** Quante pagine tiene la cache per documento (le ultime usate). */
export const SNAP_CACHE_PAGES = 3;

export interface SnapLoadTimings {
  /** `getOperatorList()` in ms (comprende la lettura della pagina se il visore non l'aveva gia' chiesta). */
  opListMs: number;
  extractMs: number;
  pointsMs: number;
  indexMs: number;
  /** CP7d: costruzione della scena dei tratti (ritaglio, conteggio, indice); assente se non e' stata costruita (nessun tratto visibile). */
  sceneMs?: number;
  /** CP7f: punti Centro e Quadrante degli anelli e loro indice; assente se non e' stato riconosciuto nessun anello. */
  ringsMs?: number;
}

/** Perche' una pagina non ha tratti ne' curve da agganciare. */
export type AbsentWhy = 'image' | 'hidden' | 'none';

/** Stato dello snap sul PDF di una pagina. «In corso» e' tenuto dall'app (la lettura e' asincrona). */
export type PdfSnapState =
  | {
      kind: 'ready';
      source: PointGrid;
      /** Tratti rettilinei visibili. */
      segments: number;
      /** Cubiche visibili (CP7c; assente = 0). */
      curves?: number;
      hiddenSegments: number;
      /** Estremi in tutto (dei tratti e delle curve) e, fra questi, quelli dovuti alle sole curve (CP7c; assente = 0). */
      nEnd: number;
      endsFromCurves?: number;
      nMid: number;
      /** Byte dei punti e della loro griglia (CP7b); la scena dei tratti ha i suoi in `sceneStats.bytes`. */
      bytes: number;
      timings: SnapLoadTimings;
      /**
       * CP7d: i TRATTI rettilinei per Intersezione e Perpendicolare. `scene` e' la sorgente (assente se la pagina non ha tratti o se la scena e' fitta); `sceneStats` i conti, e se la
       * scena e' fitta (`sceneStats.dense`) Intersezione e Perpendicolare del PDF sono spente per questa pagina mentre Estremo e Punto medio restano. Assenti = come in CP7c.
       */
      scene?: SegmentGrid;
      sceneStats?: SegmentSceneStats;
      /**
       * CP7f: Centro e Quadrante degli ANELLI (archi e cerchi di sole cubiche riconosciuti con il riferimento di CP7a): la sorgente per `findSnap` (`SnapExtra.pdfRings`), i conti e i byte che
       * restano in memoria (punti e indice degli anelli; NON compresi in `bytes`; i buffer usati durante l'estrazione, `ringStats.ringBytes`, si liberano). Assenti se il riconoscimento era
       * spento o non c'e' nessun anello (visibile o in un livello spento).
       */
      rings?: RingSource;
      ringStats?: RingPointStats;
      ringBytes?: number;
    }
  /** Nessun tratto e nessuna curva visibile: scansione o immagine (`image`), tratti e curve solo in livelli spenti (`hidden`), solo testo o riempimenti (`none`). `curves` solo se ci sono cubiche (visibili o no). */
  | { kind: 'absent'; why: AbsentWhy; segments: number; curves?: number }
  /** `ok: false` dell'estrattore, errore di PDF.js o formato non riconosciuto. */
  | { kind: 'unavailable'; reason: string }
  /** Piu' primitive visibili (tratti piu' curve) del tetto. `curves` solo se ci sono cubiche visibili. */
  | { kind: 'dense'; segments: number; cap: number; curves?: number }
  /** Il limite di sicurezza dell'estrazione e' scattato: la geometria sarebbe parziale. */
  | { kind: 'truncated' };

export interface SnapLoadDeps {
  ops?: OpsTable;
  maxSegments?: number;
  /** CP7d: tetto delle voci di cella della scena dei tratti (predefinito SEGMENT_MAX_REFS). */
  maxSceneRefs?: number;
  maxCoords?: number;
  now?: () => number;
  /** Cede il controllo al browser fra una fase e l'altra (predefinito: un giro del ciclo degli eventi). */
  yieldToUi?: () => Promise<void>;
  /** CP7f: riconoscimento degli anelli (Centro e Quadrante degli archi e cerchi); predefinito: acceso. `false` serve alle misure di costo e alle prove (come prima di CP7f). */
  recognizeArcs?: boolean;
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
      ...(deps.recognizeArcs === false ? {} : { recognizeArcs: true }),
    });
    const t3 = now();
    // Il documento e' dedicato alle letture dello snap (non e' quello del visore): l'elenco di operazioni, finito il suo lavoro, si libera (memoria). I punti sono nella nostra cache.
    try {
      page.cleanup();
    } catch {
      /* nessun effetto sul risultato */
    }
    if (!res.ok) return { kind: 'unavailable', reason: res.reason };
    if (res.stats.truncated) return { kind: 'truncated' };
    const g = res.geometry;
    const visibleLines = visibleLineCount(g);
    const visibleCurves = visibleCubicCount(g);
    if (visibleLines + visibleCurves === 0) {
      const why: AbsentWhy = g.nLines + g.nCubics > 0 ? 'hidden' : res.stats.ops.imageOps > 0 && res.stats.ops.constructPath === 0 ? 'image' : 'none';
      return g.nCubics > 0 ? { kind: 'absent', why, segments: g.nLines, curves: g.nCubics } : { kind: 'absent', why, segments: g.nLines };
    }
    if (visibleLines + visibleCurves > cap) return visibleCurves > 0 ? { kind: 'dense', segments: visibleLines, cap, curves: visibleCurves } : { kind: 'dense', segments: visibleLines, cap };
    await pause();
    const t4 = now();
    const pts = buildSnapPoints(g, sheet, { curves: true });
    const t5 = now();
    // CP7f: Centro e Quadrante degli anelli (solo se ne sono stati riconosciuti): i punti nel foglio nella fase dei punti, l'indice in quella dell'indice (nessun cedimento in piu')
    const tr0 = now();
    const rp = ringCount(g) > 0 ? buildRingPoints(g, sheet) : null;
    let ringsMs = now() - tr0;
    const ringPoints = rp ? rp.stats.centers + rp.stats.quadrants : 0;
    if (pts.nEnd + pts.nMid === 0 && ringPoints === 0) return g.nCubics > 0 ? { kind: 'absent', why: 'none', segments: g.nLines, curves: g.nCubics } : { kind: 'absent', why: 'none', segments: g.nLines }; // tutti i punti fuori dal foglio
    await pause();
    const t6 = now();
    const grid = new PointGrid(pts);
    const t7 = now();
    let ringState: { source: RingSource; stats: RingPointStats; bytes: number } | null = null;
    if (rp) {
      const tr1 = now();
      const rgrid = new PointGrid(rp.points);
      ringState = { source: new RingSource(rgrid), stats: rp.stats, bytes: rp.bytes + rgrid.bytes }; // come `bytes`: solo cio' che resta in memoria (i buffer di estrazione degli anelli, `stats.ringBytes`, si liberano con la geometria)
      ringsMs += now() - tr1;
    }
    // CP7d: la scena dei tratti (solo se ce ne sono di visibili: con sole curve non c'e' nulla da confrontare)
    let sceneRes: ReturnType<typeof buildSegmentScene> | null = null;
    let sceneMs: number | undefined;
    if (visibleLines > 0) {
      await pause();
      const t8 = now();
      sceneRes = buildSegmentScene(g, sheet, deps.maxSceneRefs === undefined ? {} : { maxRefs: deps.maxSceneRefs });
      sceneMs = now() - t8;
    }
    return {
      kind: 'ready',
      source: grid,
      segments: visibleLines,
      curves: visibleCurves,
      hiddenSegments: pts.stats.hiddenSegments,
      nEnd: pts.nEnd,
      endsFromCurves: pts.curves?.endsFromCurves ?? 0,
      nMid: pts.nMid,
      bytes: pts.bytes + grid.bytes,
      timings: {
        opListMs: t1 - t0,
        extractMs: t3 - t2,
        pointsMs: t5 - t4,
        indexMs: t7 - t6,
        ...(sceneMs === undefined ? {} : { sceneMs }),
        ...(ringState ? { ringsMs } : {}),
      },
      ...(sceneRes ? { sceneStats: sceneRes.stats, ...(sceneRes.grid ? { scene: sceneRes.grid } : {}) } : {}),
      ...(ringState ? { rings: ringState.source, ringStats: ringState.stats, ringBytes: ringState.bytes } : {}),
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
      // CP7d: lo stato e' pronto (Estremo e Punto medio ci sono) ma la scena dei tratti e' troppo fitta: Intersezione e Perpendicolare del PDF sono spente per questa pagina
      return state.sceneStats?.dense
        ? `Pagina ${pageNo}: troppi tratti lunghi e fitti per l'Intersezione e la Perpendicolare sul PDF (${n0(state.sceneStats.kept)} tratti, ${n0(state.sceneStats.refs)} voci di indice, tetto ${n0(state.sceneStats.maxRefs)}): spente per questa pagina; l'Estremo e il Punto medio del PDF restano. ${tail}`
        : null;
    case 'absent':
      return state.why === 'image'
        ? `Pagina ${pageNo}: è un'immagine (scansione): non ci sono linee del PDF da agganciare. ${tail}`
        : state.why === 'hidden'
          ? `Pagina ${pageNo}: le linee e le curve del PDF sono tutte in livelli spenti: niente da agganciare. ${tail}`
          : `Pagina ${pageNo}: nessuna linea né curva visibile da agganciare nel PDF (solo testo o riempimenti). ${tail}`;
    case 'dense':
      return state.curves
        ? `Pagina ${pageNo}: troppo fitta per l'aggancio al PDF (${n0(state.segments)} tratti e ${n0(state.curves)} curve, tetto ${n0(state.cap)} fra tratti e curve): spento per questa pagina. ${tail}`
        : `Pagina ${pageNo}: troppo fitta per l'aggancio al PDF (${n0(state.segments)} tratti, tetto ${n0(state.cap)}): spento per questa pagina. ${tail}`;
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
      // La prima parte e' quella di CP7b (estremi e punti medi dei tratti rettilinei); con le curve si aggiunge una frase: gli estremi dovuti alle curve e quanti sono in tutto.
      const curves = state.curves ?? 0;
      const fromCurves = state.endsFromCurves ?? 0;
      const lineEnds = state.nEnd - fromCurves;
      const curveText = curves > 0 ? `; curve: ${n0(fromCurves)} estremi da ${n0(curves)} cubiche (${n0(state.nEnd)} estremi in tutto)` : '';
      // CP7d: la scena dei tratti (Intersezione e Perpendicolare): tratti, celle, voci, byte e tempo di costruzione; o il motivo per cui non c'e'
      const sc = state.sceneStats;
      const sceneText = !sc
        ? ''
        : sc.dense
          ? `; scena dei tratti: spenta (${n0(sc.kept)} tratti, ${n0(sc.refs)} voci di indice con celle da ${SEGMENT_GRID_MAX_CELL_PT} pt, tetto ${n0(sc.maxRefs)})`
          : `; scena dei tratti: ${n0(sc.kept)} tratti (${n0(sc.clipped)} ritagliati sul foglio, ${n0(sc.outside)} fuori dal foglio), celle da ${sc.cellPt} pt, ${n0(sc.refs)} voci, ${(sc.bytes / 1048576).toFixed(2)} MB, ${(t.sceneMs ?? 0).toFixed(0)} ms`;
      // CP7f: gli anelli (archi e cerchi riconosciuti per Centro e Quadrante), solo se ce n'e' almeno uno (visibile o in un livello spento): i numeri da confrontare con il calcolo atteso
      const rs = state.ringStats;
      const ringText =
        rs && rs.rings + rs.hiddenRings > 0
          ? `; anelli: ${n0(rs.rings)} riconosciuti (${n0(rs.circles)} cerchi, ${n0(rs.arcs)} archi), ${n0(rs.centers)} centri e ${n0(rs.quadrants)} quadranti nel foglio${rs.hiddenRings > 0 ? `, ${n0(rs.hiddenRings)} in livelli spenti` : ''} (${((state.ringBytes ?? 0) / 1048576).toFixed(2)} MB, ${(t.ringsMs ?? 0).toFixed(0)} ms)`
          : '';
      return `Snap PDF, pagina ${pageNo}: pronto, ${n0(lineEnds)} estremi e ${n0(state.nMid)} punti medi da ${n0(state.segments)} tratti${curveText} (${(state.bytes / 1048576).toFixed(2)} MB; lettura ${t.opListMs.toFixed(0)} ms, estrazione ${t.extractMs.toFixed(0)} ms, punti ${t.pointsMs.toFixed(0)} ms, indice ${t.indexMs.toFixed(0)} ms)${sceneText}${ringText}`;
    }
    case 'absent':
      return `Snap PDF, pagina ${pageNo}: assente (${state.why === 'image' ? 'immagine' : state.why === 'hidden' ? 'solo livelli spenti' : 'nessun tratto né curva'}; tratti letti ${n0(state.segments)}${state.curves ? `, cubiche lette ${n0(state.curves)}` : ''})`;
    case 'dense':
      return state.curves
        ? `Snap PDF, pagina ${pageNo}: spento, ${n0(state.segments)} tratti e ${n0(state.curves)} curve sopra il tetto di ${n0(state.cap)}`
        : `Snap PDF, pagina ${pageNo}: spento, ${n0(state.segments)} tratti sopra il tetto di ${n0(state.cap)}`;
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
  /** Legge senza cambiare l'ordine di uso (per le letture frequenti, come a ogni movimento del mouse). */
  peek(n: number): T | undefined {
    return this.m.get(n);
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
