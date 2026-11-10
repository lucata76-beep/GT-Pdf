// Misura per pagina della geometria di un PDF (V3.0, CP7a): chiama page.getOperatorList() (tempi, stesso oggetto la seconda volta), passa l'elenco all'estrattore
// (src/pdf/geometry.ts), classifica la pagina, legge i livelli del documento e compone il testo di "Copia misura".
// NIENTE snap, niente uso nell'editor o nel visore: lo usa solo la scheda "Geometria PDF" della pagina Diagnostica (src/diag/geometryCard.ts).
// Mai eccezioni verso la scheda: ogni errore (di PDF.js o dell'estrazione) torna come { ok: false, reason }.
import { OPS, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fmt, fmtTrim } from '../geometry/numbers';
import { BYTES_PER_CUBIC, BYTES_PER_LINE, DEFAULT_MAX_COORDS, type GeometryStats, type OpsTable, type PdfGeometry, extractGeometry } from './geometry';

/** Massimo di pagine di "Misura tutte le pagine" (le altre non si misurano: la scheda lo dice). */
export const MAX_PAGES = 200;

export type PageClass = 'vettoriale' | 'scansione' | 'mista' | 'vuota' | 'altro';

/**
 * Classe della pagina (regola MIA, dichiarata; i "candidati" sono i percorsi stroke e fillStroke):
 *  - vettoriale: almeno un candidato e nessuna operazione immagine;
 *  - mista: almeno un'operazione immagine e almeno un percorso (candidato oppure solo riempimenti e ritagli);
 *  - scansione: 0 percorsi e almeno un'operazione immagine;
 *  - vuota: nessun percorso, nessuna immagine, nessun testo, nessuna sfumatura (`sh`);
 *  - altro: gli altri casi (solo testo, solo riempimenti o ritagli, sfumature; senza candidati ne' immagini). Classe aggiunta da me.
 * Se il limite di sicurezza e' scattato la classe e' calcolata su quanto letto fin li' (la conta delle operazioni e' invece completa).
 */
export function classifyPage(s: GeometryStats): PageClass {
  const cand = s.byPaint.stroke + s.byPaint.fillStroke;
  const img = s.ops.imageOps;
  const noPaths = s.truncated ? s.ops.constructPath === 0 : s.ops.constructPath - s.emptyPaths === 0;
  if (cand > 0) return img > 0 ? 'mista' : 'vettoriale';
  if (img > 0) return noPaths ? 'scansione' : 'mista';
  if (noPaths && s.ops.showText === 0 && s.ops.shadingFill === 0) return 'vuota';
  return 'altro';
}

export interface PageMeta {
  pageNo: number;
  /** Pagine del documento. */
  numPages: number;
  rotate: number;
  view: [number, number, number, number];
  userUnit: number;
  /** Dimensioni della vista (con Rotate e CropBox applicati), in pt. */
  widthPt: number;
  heightPt: number;
}

export interface DocLayers {
  /** Gruppi OCG del documento. */
  groups: number;
  /** Quanti spenti nella configurazione predefinita. */
  off: number;
}

export interface Timings {
  /** Primo getOperatorList() in ms. */
  firstMs: number;
  /** true se prima del primo si e' potuto liberare l'elenco gia' in memoria (page.cleanup() ha risposto true): il tempo include la lettura del contenuto della pagina. */
  fresh: boolean;
  secondMs: number;
  /** Il secondo getOperatorList() ha restituito lo STESSO oggetto. */
  sameObject: boolean;
  extractMs: number;
}

export interface HeapMeasure {
  /** performance.memory.usedJSHeapSize prima e dopo, in byte (SOLO Chromium). */
  before: number;
  after: number;
}

export interface PageMeasure {
  meta: PageMeta;
  pageClass: PageClass;
  stats: GeometryStats;
  /** Byte delle primitive memorizzate. */
  geometryBytes: number;
  nLines: number;
  nCubics: number;
  nPaths: number;
  timings: Timings;
  /** null: performance.memory non esiste (non e' Chromium). */
  heap: HeapMeasure | null;
}

export type MeasureResult = { ok: true; measure: PageMeasure } | { ok: false; reason: string; meta: PageMeta | null };

export interface MeasureDeps {
  now?: () => number;
  heapUsed?: () => number | null;
  ops?: OpsTable;
  maxCoords?: number;
  /** Dopo la misura libera l'elenco di operazioni della pagina (page.cleanup()): per "Misura tutte le pagine", per non tenere in memoria l'elenco di ogni pagina. */
  release?: boolean;
}

/** performance.memory esiste solo in Chromium (non standard). */
function chromiumHeap(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return m && typeof m.usedJSHeapSize === 'number' ? m.usedJSHeapSize : null;
}

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Gruppi OCG del documento e quanti spenti nella configurazione predefinita (solo numeri, nessun nome). */
export async function readDocLayers(doc: PDFDocumentProxy): Promise<DocLayers | null> {
  try {
    const cfg = await doc.getOptionalContentConfig();
    let groups = 0;
    let off = 0;
    for (const [, g] of cfg as unknown as Iterable<[string, { visible?: boolean }]>) {
      groups++;
      if (g.visible === false) off++;
    }
    return { groups, off };
  } catch {
    return null;
  }
}

function pageMeta(page: PDFPageProxy, pageNo: number, numPages: number): PageMeta {
  const vp = page.getViewport({ scale: 1 });
  return { pageNo, numPages, rotate: page.rotate, view: [page.view[0]!, page.view[1]!, page.view[2]!, page.view[3]!], userUnit: page.userUnit, widthPt: vp.width, heightPt: vp.height };
}

/**
 * Misura una pagina. Il primo getOperatorList() parte dopo page.cleanup() (che libera l'elenco gia' letto dal visore, se possibile): cosi' il tempo comprende la lettura
 * della pagina. Il secondo chiede lo stesso elenco: PDF.js restituisce lo stesso oggetto. L'estrazione e' sincrona (bloccante per il tempo indicato).
 */
export async function measurePage(doc: PDFDocumentProxy, pageNo: number, deps: MeasureDeps = {}): Promise<MeasureResult> {
  const now = deps.now ?? ((): number => performance.now());
  const heapUsed = deps.heapUsed ?? chromiumHeap;
  let meta: PageMeta | null = null;
  let page: PDFPageProxy | null = null;
  try {
    page = await doc.getPage(pageNo);
    meta = pageMeta(page, pageNo, doc.numPages);
    const config = await doc.getOptionalContentConfig();
    const heapBefore = heapUsed();
    const fresh = page.cleanup();
    const t0 = now();
    const ol = await page.getOperatorList();
    const t1 = now();
    const ol2 = await page.getOperatorList();
    const t2 = now();
    const res = extractGeometry({
      fnArray: ol.fnArray,
      argsArray: ol.argsArray,
      ops: deps.ops ?? (OPS as unknown as OpsTable),
      isLayerVisible: (data) => config.isVisible(data as never),
      maxCoords: deps.maxCoords ?? DEFAULT_MAX_COORDS,
    });
    const t3 = now();
    if (!res.ok) return { ok: false, reason: res.reason, meta };
    const heapAfter = heapUsed();
    const g: PdfGeometry = res.geometry;
    return {
      ok: true,
      measure: {
        meta,
        pageClass: classifyPage(res.stats),
        stats: res.stats,
        geometryBytes: g.bytes,
        nLines: g.nLines,
        nCubics: g.nCubics,
        nPaths: g.nPaths,
        timings: { firstMs: t1 - t0, fresh, secondMs: t2 - t1, sameObject: ol2 === ol, extractMs: t3 - t2 },
        heap: heapBefore !== null && heapAfter !== null ? { before: heapBefore, after: heapAfter } : null,
      },
    };
  } catch (e) {
    return { ok: false, reason: errText(e), meta };
  } finally {
    if (deps.release && page) {
      try {
        page.cleanup();
      } catch {
        /* nessun effetto sulla misura */
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ testo
const n0 = (n: number): string => String(n);
const mb = (bytes: number): string => `${fmt(bytes / 1048576, 1)} MB`;
const pair = (label: string, value: number): string => `${label} ${n0(value)}`;

/** Segmenti (tutti i percorsi): lineTo, chiusure con segmento, cubiche, quadratiche. */
export function allSegments(s: GeometryStats): number {
  return s.all.lineTo + s.all.closeSegments + s.all.cubic + s.all.quad;
}

/** Riga di sintesi di una pagina (percorsi, segmenti, millisecondi) per "Misura tutte le pagine": i millisecondi sono primo getOperatorList piu' estrazione. */
export function summaryRow(m: PageMeasure): string {
  const s = m.stats;
  const ms = m.timings.firstMs + m.timings.extractMs;
  return `pagina ${m.meta.pageNo}: ${m.pageClass} · percorsi ${n0(s.all.paths)} · segmenti ${n0(allSegments(s))} · ${fmt(ms, 0)} ms · Rotate ${m.meta.rotate} · ${fmtTrim(m.meta.widthPt, 1)} x ${fmtTrim(m.meta.heightPt, 1)} pt${s.truncated ? ' · LIMITE' : ''}`;
}

/** Le righe di una misura, una per voce (i numeri sempre con "."). */
export function measureLines(m: PageMeasure, layers: DocLayers | null): string[] {
  const s = m.stats;
  const t = m.timings;
  const meta = m.meta;
  const lines: string[] = [];
  lines.push(`pagina: ${meta.pageNo} di ${meta.numPages}`);
  lines.push(`Rotate: ${meta.rotate}`);
  lines.push(`vista: [${meta.view.map((v) => fmtTrim(v, 3)).join(' ')}] = ${fmtTrim(meta.widthPt, 2)} x ${fmtTrim(meta.heightPt, 2)} pt (dimensioni con Rotate e CropBox)`);
  lines.push(`UserUnit: ${fmtTrim(meta.userUnit, 4)}`);
  lines.push(`classe della pagina: ${m.pageClass}`);
  lines.push(`operazioni totali: ${n0(s.ops.total)}`);
  lines.push(`constructPath: ${n0(s.ops.constructPath)} (percorsi con dati ${n0(s.paths)}, vuoti ${n0(s.emptyPaths)})`);
  lines.push(`operazioni immagine (tutte): ${n0(s.ops.imageOps)}`);
  lines.push(`showText (e varianti): ${n0(s.ops.showText)}`);
  lines.push(`shadingFill: ${n0(s.ops.shadingFill)}`);
  const pat = Object.entries(s.ops.patternColorOps);
  lines.push(`operatori colore con pattern: ${pat.length ? pat.map(([k, v]) => `${k} ${n0(v)}`).join(', ') : 'nessuno'}`);
  lines.push(`form XObject (paintFormXObjectBegin): ${n0(s.ops.forms)}`);
  lines.push(`annotazioni disegnate (beginAnnotation): ${n0(s.ops.annotations)}`);
  lines.push(`percorsi per pittura: stroke ${n0(s.byPaint.stroke)}, fill ${n0(s.byPaint.fill)}, fillstroke ${n0(s.byPaint.fillStroke)}, endPath ${n0(s.byPaint.endPath)}`);
  const totals = (label: string, x: GeometryStats['all']): string =>
    `${label}: percorsi ${n0(x.paths)}, sottopercorsi ${n0(x.subpaths)} (senza tratti ${n0(x.emptySubpaths)}), lineTo ${n0(x.lineTo)}, cubiche ${n0(x.cubic)}, quadratiche ${n0(x.quad)}, chiusure ${n0(x.close)} (con segmento ${n0(x.closeSegments)}, senza ${n0(x.closeNoSegment)})`;
  lines.push(totals('tutti i percorsi', s.all));
  lines.push(totals('candidati (stroke e fillstroke)', s.cand));
  const h = s.lineHist;
  lines.push(`segmenti rettilinei dei candidati (lineTo e chiusure con segmento): ${n0(m.nLines)}`);
  lines.push(`lunghezza dei segmenti rettilinei (pt utente): sotto 0.01: ${n0(h[0]!)} · 0.01-0.1: ${n0(h[1]!)} · 0.1-1: ${n0(h[2]!)} · 1-10: ${n0(h[3]!)} · 10 e oltre: ${n0(h[4]!)}`);
  lines.push(`lunghezza minima e massima dei segmenti rettilinei (pt utente): ${s.lineMin === null ? 'nessun segmento' : `${fmtTrim(s.lineMin, 4)} e ${fmtTrim(s.lineMax ?? 0, 4)}`}`);
  for (const [label, x] of [
    ['tutti i percorsi', s.shapesAll],
    ['candidati', s.shapesCand],
  ] as const) {
    const b = x.closedCubicOnly;
    lines.push(`sottopercorsi chiusi di sole cubiche, ${label}, per numero di cubiche: 1: ${n0(b[0]!)} · 2: ${n0(b[1]!)} · 3: ${n0(b[2]!)} · 4: ${n0(b[3]!)} · 5-8: ${n0(b[4]!)} · oltre 8: ${n0(b[5]!)}`);
    lines.push(`di 4 cubiche che rispettano la regola del cerchio, ${label}: ${n0(x.circles4)} (scostamento massimo ${fmtTrim(x.circles4MaxDev, 5)} pt)`);
    lines.push(`poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), ${label}: ${n0(x.denseClosedPolygons)}`);
    lines.push(`cubiche in sottopercorsi aperti, ${label}: ${n0(x.cubicsInOpen)}`);
    lines.push(`sottopercorsi chiusi solo per coincidenza dell'ultimo punto (senza chiusura), ${label}: ${n0(x.closedByCoincidence)}`);
  }
  lines.push(`livelli del documento: gruppi OCG ${layers ? n0(layers.groups) : 'non letti'}, spenti nella configurazione predefinita ${layers ? n0(layers.off) : 'non letti'}`);
  const L = s.layers;
  lines.push(`marcatori OC: ${n0(L.ocMarkers)} (OCG ${n0(L.ocgMarkers)}, OCMD ${n0(L.ocmdMarkers)} di cui spenti ${n0(L.ocmdHidden)}, dati null ${n0(L.ocNull)}, altri tipi ${n0(L.ocOther)}, errori di isVisible ${n0(L.ocErrors)})`);
  lines.push(`profondita' massima dei marcatori: ${n0(L.maxDepth)}`);
  lines.push(`endMarkedContent senza apertura: ${n0(L.emcUnderflow)}; marcatori non chiusi a fine pagina: ${n0(L.unclosedMarkers)}`);
  lines.push(`dentro livelli spenti: percorsi ${n0(L.hiddenPaths)} (candidati ${n0(L.hiddenCandidatePaths)}), segmenti dei candidati ${n0(L.hiddenCandidateSegments)}`);
  lines.push(`percorsi con coordinate non finite (NaN, Infinity): ${n0(s.nonFinitePaths)}`);
  lines.push(`${pair('lineTo o curve senza punto corrente:', s.noCurrentPoint)}; ${pair('restore senza save:', s.restoreUnderflow)}`);
  lines.push(`numeri nei Float32Array dei percorsi (comandi e coordinate): ${n0(s.coordsRead)}`);
  lines.push(
    `primitive memorizzate: ${n0(m.nPaths)} percorsi candidati, ${n0(m.nLines)} segmenti rettilinei (${BYTES_PER_LINE} byte l'uno), ${n0(m.nCubics)} cubiche (${BYTES_PER_CUBIC} byte l'una) = ${n0(m.geometryBytes)} byte stimati (${mb(m.geometryBytes)})`,
  );
  lines.push(`primo getOperatorList: ${fmt(t.firstMs, 1)} ms (${t.fresh ? "elenco liberato prima: comprende la lettura della pagina" : "l'elenco era in uso (visore o render in corso): puo' essere gia' in memoria"})`);
  lines.push(`secondo getOperatorList: ${fmt(t.secondMs, 2)} ms, stesso oggetto: ${t.sameObject ? 'si' : 'no'}`);
  lines.push(`estrazione: ${fmt(t.extractMs, 1)} ms`);
  lines.push(
    m.heap
      ? `heap JS (performance.memory, solo Chromium): prima ${mb(m.heap.before)}, dopo ${mb(m.heap.after)}`
      : 'heap JS (performance.memory, solo Chromium): non disponibile',
  );
  lines.push(
    s.truncated
      ? `limite di sicurezza: SCATTATO all'operazione ${n0(s.truncated.atOp)} di ${n0(s.truncated.ofOps)} (limite ${n0(s.truncated.limit)} numeri; letti ${n0(s.coordsRead)}): i percorsi dopo non sono stati letti, le conte delle operazioni sono complete`
      : `limite di sicurezza: non scattato (limite ${n0(DEFAULT_MAX_COORDS)} numeri)`,
  );
  return lines;
}

/**
 * Testo di "Copia misura": SENZA nome del file, testi o metadati del documento (titolo, autore, produttore). Versione dell'app, versione di PDF.js, poi le righe di una
 * misura (pagina, Rotate, vista, UserUnit incluse). Con piu' pagine misurate: prima una riga di sintesi per pagina.
 */
export function measureText(buildId: string, measures: PageMeasure[], selected: PageMeasure, layers: DocLayers | null): string {
  const out: string[] = [`GT-Pdf ${buildId} · misura geometria PDF · PDF.js ${pdfjsVersion}`];
  if (measures.length > 1) {
    out.push(`pagine misurate: ${n0(measures.length)} di ${n0(selected.meta.numPages)}`);
    for (const m of measures) out.push(summaryRow(m));
    out.push(`--- dettaglio della pagina ${selected.meta.pageNo} ---`);
  }
  out.push(...measureLines(selected, layers));
  return out.join('\n');
}
