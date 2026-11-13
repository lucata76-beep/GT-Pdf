// Misura per pagina della geometria di un PDF (V3.0, CP7a; righe in piu' su cerchi e archi V3.2a, CP7c; misura degli archi V3.2c, CP7e): chiama page.getOperatorList() (tempi, stesso oggetto la seconda volta), passa
// l'elenco all'estrattore (src/pdf/geometry.ts), classifica la pagina, legge i livelli del documento e compone il testo di "Copia misura".
// NIENTE snap, niente uso nell'editor o nel visore: lo usa solo la scheda "Geometria PDF" della pagina Diagnostica (src/diag/geometryCard.ts).
// Mai eccezioni verso la scheda: ogni errore (di PDF.js o dell'estrazione) torna come { ok: false, reason }.
import { OPS, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fmt, fmtTrim } from '../geometry/numbers';
import { ABS_EDGES, ANGLE_EDGES, ANGLE_MARGIN, type ArcBucket, type ArcSkipped, REL_EDGES, RADIUS_EDGES, TAN_EDGES, VERTEX_BUCKETS } from './arcStats';
import { ARC_MAX_CUBICS, ARC_MAX_VERTICES, BENT_FRACTION, STRAIGHT_RATIO } from './circleFit';
import {
  BYTES_PER_CUBIC,
  BYTES_PER_LINE,
  CIRCLE_MID_REL,
  CIRCLE_TOL_ABS,
  CIRCLE_TOL_REL,
  DEFAULT_MAX_COORDS,
  GAP_EDGES,
  type GeometryStats,
  type OpsTable,
  type PdfGeometry,
  type ShapeStats,
  extractGeometry,
} from './geometry';

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

// ------------------------------------------------------------------------------------------------ misura degli archi (CP7e)
const sci = (v: number): string => (v === 0 ? '0' : v.toExponential(2));
const num = (v: number): string => fmtTrim(v, 6);
const joinHist = (labels: string[], hist: number[]): string => labels.map((l, i) => `${l}: ${n0(hist[i] ?? 0)}`).join(' · ');
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
const upTo = (edges: readonly number[], f: (e: number) => string, last: string): string[] => [...edges.map((e) => `fino a ${f(e)}`), last];
const REL_LABELS = upTo(REL_EDGES, num, `oltre ${num(REL_EDGES[REL_EDGES.length - 1]!)}`);
const ABS_LABELS = upTo(ABS_EDGES, num, `oltre ${num(ABS_EDGES[ABS_EDGES.length - 1]!)}`);
const TAN_LABELS = upTo(TAN_EDGES, num, `oltre ${num(TAN_EDGES[TAN_EDGES.length - 1]!)}`);
const RADIUS_LABELS = [`sotto ${num(RADIUS_EDGES[0]!)}`, ...RADIUS_EDGES.slice(0, -1).map((e, i) => `${num(e)}-${num(RADIUS_EDGES[i + 1]!)}`), `${num(RADIUS_EDGES[RADIUS_EDGES.length - 1]!)} e oltre`];
const ANGLE_LABELS = [...ANGLE_EDGES.map((e) => `fino a ${e}`), 'meno di 360', 'circa 360', 'oltre 360'];
const VERTEX_LABELS = ['12-16', '17-24', '25-32', '33-64', '65-128', '129-256'];
const verdict = (ok: boolean): string => (ok ? 'il conto torna' : 'IL CONTO NON TORNA');

/** Le righe di un contenitore (stato e numero di cubiche, o numero di vertici): scostamenti, raggio, angolo e, per le catene, tangenti. */
function bucketLines(head: string, b: ArcBucket, tangents: boolean): string[] {
  const out: string[] = [];
  out.push(`${head}: sottopercorsi ${n0(b.subpaths)} (raggio determinato ${n0(b.arcs)}, quasi rettilinei ${n0(b.straight)}, di cui raggio non determinabile ${n0(b.undetermined)} e non piatti ${n0(b.bent)}${b.straight - b.undetermined > 0 ? `; piattezza massima ${sci(b.flatMax)}` : ''}); scostamento massimo RELATIVO (scostamento diviso raggio), ${joinHist(REL_LABELS, b.relHist)} (massimo ${sci(b.relMax)})`);
  out.push(
    `${head}: scostamento massimo ASSOLUTO (pt utente), ${joinHist(ABS_LABELS, b.absHist)} (massimo ${sci(b.absMax)}); entro le tolleranze di CP7a (riferimento): ${n0(b.withinCp7a)} su ${n0(b.arcs)}`,
  );
  out.push(
    `${head}: raggio (pt utente), ${joinHist(RADIUS_LABELS, b.radiusHist)}; minimo e massimo ${b.radiusMin === null ? 'nessuno' : `${num(b.radiusMin)} e ${num(b.radiusMax ?? 0)}`}; angolo coperto (gradi), ${joinHist(ANGLE_LABELS, b.angleHist)}; minimo e massimo ${b.angleMin === null ? 'nessuno' : `${fmtTrim(b.angleMin, 4)} e ${fmtTrim(b.angleMax ?? 0, 4)}`}`,
  );
  if (tangents) {
    out.push(
      `${head}: scostamento delle tangenti dal cerchio negli estremi delle cubiche (gradi), ${joinHist(TAN_LABELS, b.tanHist)} (misurato su ${n0(b.tanMeasured)} di ${n0(b.arcs)}; massimo ${sci(b.tanMax)}); salto massimo della tangente nei giunti (gradi): ${b.jointMax < 0 ? 'nessun giunto misurato' : sci(b.jointMax)}`,
    );
  }
  return out;
}

/** Somma delle classi dei contenitori di un gruppo, per istogramma. */
function classSums(buckets: (ArcBucket | null)[]): { rel: number; abs: number; radius: number; angle: number; tan: number; tanMeasured: number; arcs: number; straight: number; undetermined: number; bent: number; subpaths: number; units: number } {
  const r = { rel: 0, abs: 0, radius: 0, angle: 0, tan: 0, tanMeasured: 0, arcs: 0, straight: 0, undetermined: 0, bent: 0, subpaths: 0, units: 0 };
  for (const b of buckets) {
    if (!b) continue;
    r.rel += sum(b.relHist);
    r.abs += sum(b.absHist);
    r.radius += sum(b.radiusHist);
    r.angle += sum(b.angleHist);
    r.tan += sum(b.tanHist);
    r.tanMeasured += b.tanMeasured;
    r.arcs += b.arcs;
    r.straight += b.straight;
    r.undetermined += b.undetermined;
    r.bent += b.bent;
    r.subpaths += b.subpaths;
    r.units += b.units;
  }
  return r;
}

/**
 * Le righe della misura degli archi (CP7e), per gruppo di percorsi: sottopercorsi di sole cubiche (aperti e chiusi, da 1 a ARC_MAX_CUBICS cubiche) e poligoni fitti. Un contenitore senza
 * sottopercorsi non ha righe; i totali e i conti ci sono sempre. SOLA MISURA: nessuna riga dice che un gruppo «e'» un arco o un cerchio.
 */
function arcLines(label: string, x: ShapeStats): string[] {
  const out: string[] = [];
  const A = x.arcs;
  for (const [state, stateWord, slots, skipped, reported, reportedCubics] of [
    ['APERTI', 'aperti', A.cubicOpen, A.cubicOpenSkipped, sum(x.openCubicOnly), x.openCubicOnlyCubics],
    ['CHIUSI', 'chiusi', A.cubicClosed, A.cubicClosedSkipped, sum(x.closedCubicOnly), x.closedCubicOnlyCubics],
  ] as [string, string, (ArcBucket | null)[], ArcSkipped, number, number][]) {
    const s = classSums(slots);
    out.push(
      `archi, sottopercorsi ${state} di sole cubiche, ${label}: ${n0(reported)} = misurati ${n0(s.subpaths)} (raggio determinato ${n0(s.arcs)}, quasi rettilinei ${n0(s.straight)}, di cui raggio non determinabile ${n0(s.undetermined)} e non piatti ${n0(s.bent)}) + oltre ${ARC_MAX_CUBICS} cubiche non misurati ${n0(skipped.subpaths)}; cubiche: misurate ${n0(s.units)} + non misurate ${n0(skipped.units)} = ${n0(s.units + skipped.units)}`,
    );
    slots.forEach((b, i) => {
      if (b) out.push(...bucketLines(`archi ${state}, ${i + 1} ${i === 0 ? 'cubica' : 'cubiche'}, ${label}`, b, true));
    });
    out.push(
      `archi, conto dei sottopercorsi ${state} di sole cubiche, ${label}: somma delle classi (scostamento relativo ${n0(s.rel)}, assoluto ${n0(s.abs)}, raggio ${n0(s.radius)}, angolo ${n0(s.angle)}, tangenti ${n0(s.tan)} + non misurate ${n0(s.arcs - s.tanMeasured)}) = raggio determinato ${n0(s.arcs)}; ${n0(s.arcs)} + quasi rettilinei ${n0(s.straight)} + oltre ${ARC_MAX_CUBICS} cubiche ${n0(skipped.subpaths)} = ${n0(s.arcs + s.straight + skipped.subpaths)}; sottopercorsi ${stateWord} di sole cubiche già riportati ${n0(reported)} (${verdict(s.rel === s.arcs && s.abs === s.arcs && s.radius === s.arcs && s.angle === s.arcs && s.tan + s.arcs - s.tanMeasured === s.arcs && s.arcs + s.straight + skipped.subpaths === reported)})`,
    );
    out.push(
      `archi, conto delle cubiche misurate e non misurate, ${state}, ${label}: ${n0(s.units)} + ${n0(skipped.units)} = ${n0(s.units + skipped.units)}; cubiche dei sottopercorsi ${stateWord} di sole cubiche già riportate ${n0(reportedCubics)} (${verdict(s.units + skipped.units === reportedCubics)})`,
    );
  }
  const poly = classSums(A.poly);
  out.push(
    `archi, poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), ${label}: ${n0(x.denseClosedPolygons)} = misurati ${n0(poly.subpaths)} (raggio determinato ${n0(poly.arcs)}, quasi rettilinei ${n0(poly.straight)}, di cui raggio non determinabile ${n0(poly.undetermined)} e non piatti ${n0(poly.bent)}) + oltre ${ARC_MAX_VERTICES} vertici non misurati ${n0(A.polySkipped.subpaths)}; vertici (punto iniziale e estremi dei lineTo, senza l'ultimo se coincide con il primo): misurati ${n0(poly.units)} + non misurati ${n0(A.polySkipped.units)} = ${n0(poly.units + A.polySkipped.units)}`,
  );
  A.poly.forEach((b, i) => {
    if (b) out.push(...bucketLines(`archi, poligoni fitti, ${VERTEX_LABELS[i]} vertici, ${label}`, b, false));
  });
  out.push(
    `archi, conto dei poligoni fitti, ${label}: somma delle classi (scostamento relativo ${n0(poly.rel)}, assoluto ${n0(poly.abs)}, raggio ${n0(poly.radius)}, angolo ${n0(poly.angle)}) = raggio determinato ${n0(poly.arcs)}; ${n0(poly.arcs)} + quasi rettilinei ${n0(poly.straight)} + oltre ${ARC_MAX_VERTICES} vertici ${n0(A.polySkipped.subpaths)} = ${n0(poly.arcs + poly.straight + A.polySkipped.subpaths)}; poligoni fitti già riportati ${n0(x.denseClosedPolygons)} (${verdict(poly.rel === poly.arcs && poly.abs === poly.arcs && poly.radius === poly.arcs && poly.angle === poly.arcs && poly.arcs + poly.straight + A.polySkipped.subpaths === x.denseClosedPolygons)})`,
  );
  out.push(
    `archi, conto dei vertici misurati e non misurati, poligoni fitti, ${label}: ${n0(poly.units)} + ${n0(A.polySkipped.units)} = ${n0(poly.units + A.polySkipped.units)}; vertici di tutti i poligoni fitti contati a parte ${n0(A.polyVertices)} (${verdict(poly.units + A.polySkipped.units === A.polyVertices)})`,
  );
  return out;
}

/** Le righe che spiegano la misura degli archi (una volta sola, prima di quelle dei gruppi). */
function arcDefinitionLines(): string[] {
  return [
    `archi (CP7e, SOLA MISURA: nessuna tolleranza decisa, nessun gruppo riconosciuto): cerchio adattato ai minimi quadrati della distanza dai punti; punti delle catene di cubiche: nodi (estremi e giunti) e, per ogni cubica, t = 0.25, 0.5 e 0.75; punti dei poligoni fitti: tutti i vertici`,
    `archi, definizioni: scostamento = distanza massima dei punti dal cerchio adattato, assoluto in pt utente e relativo (diviso il raggio); angolo coperto = somma degli angoli fra punti consecutivi visti dal centro (poligoni: il lato di chiusura conta solo se non e' piu' ampio degli altri lati, altrimenti e' una corda che chiude un arco); tangenti = angolo fra la tangente della cubica e quella del cerchio negli estremi delle cubiche e, nei giunti, salto fra tangente uscente ed entrante`,
    `archi, quasi rettilinei: raggio oltre ${STRAIGHT_RATIO} volte la diagonale del riquadro dei punti (angolo coperto sotto circa 0.57 gradi) oppure raggio non determinabile; contati a parte, fuori dagli istogrammi; fra loro «non piatti» = punti a piu' dell'${BENT_FRACTION * 100}% della diagonale dalla retta ai minimi quadrati (per esempio una S: ha un cerchio adattato enorme ma non e' una retta); tetti: ${ARC_MAX_CUBICS} cubiche per sottopercorso e ${ARC_MAX_VERTICES} vertici per poligono (oltre sono solo contati: ${VERTEX_BUCKETS} contenitori di vertici); limiti superiori inclusi (il raggio: escluso), margine degli angoli ${ANGLE_MARGIN} gradi`,
    `archi, riferimento di CP7a (NON la regola del cerchio, che vale solo per 4 cubiche): tolleranza ${CIRCLE_TOL_ABS} pt + ${CIRCLE_TOL_REL} x raggio per i nodi e, a meta' curva (t = 0.5), in piu' ${CIRCLE_MID_REL} x raggio, applicata allo scostamento dal cerchio adattato`,
  ];
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
  // ---- CP7c: i segmenti sotto 0.01 divisi (lunghezza esattamente 0 e lunghezza fra 0 escluso e 0.01) e le corde delle cubiche
  lines.push(`segmenti rettilinei dei candidati sotto 0.01 pt utente, divisi: lunghezza esattamente 0: ${n0(s.lineZero)} · fra 0 (escluso) e 0.01: ${n0(h[0]! - s.lineZero)}`);
  const ch = s.cubicChordHist;
  lines.push(
    `corde delle cubiche dei candidati (distanza fra primo e ultimo punto, pt utente; le quadratiche non entrano): sotto 0.01: ${n0(ch[0]!)} · 0.01-0.1: ${n0(ch[1]!)} · 0.1-1: ${n0(ch[2]!)} · 1-10: ${n0(ch[3]!)} · 10 e oltre: ${n0(ch[4]!)}`,
  );
  lines.push(`corde delle cubiche dei candidati sotto 0.01 pt utente, divise: lunghezza esattamente 0: ${n0(s.cubicChordZero)} · fra 0 (escluso) e 0.01: ${n0(ch[0]! - s.cubicChordZero)}`);
  lines.push(`corda minima e massima delle cubiche dei candidati (pt utente): ${s.cubicChordMin === null ? 'nessuna cubica' : `${fmtTrim(s.cubicChordMin, 4)} e ${fmtTrim(s.cubicChordMax ?? 0, 4)}`}`);
  for (const [label, x] of [
    ['tutti i percorsi', s.shapesAll],
    ['candidati', s.shapesCand],
  ] as const) {
    const b = x.closedCubicOnly;
    lines.push(`sottopercorsi chiusi di sole cubiche, ${label}, per numero di cubiche: 1: ${n0(b[0]!)} · 2: ${n0(b[1]!)} · 3: ${n0(b[2]!)} · 4: ${n0(b[3]!)} · 5-8: ${n0(b[4]!)} · oltre 8: ${n0(b[5]!)}`);
    lines.push(`di 4 cubiche che rispettano la regola del cerchio, ${label}: ${n0(x.circles4)} (scostamento massimo ${fmtTrim(x.circles4MaxDev, 6)} pt)`);
    lines.push(`poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), ${label}: ${n0(x.denseClosedPolygons)}`);
    lines.push(`cubiche in sottopercorsi aperti, ${label}: ${n0(x.cubicsInOpen)}`);
    lines.push(`sottopercorsi chiusi solo per coincidenza dell'ultimo punto (senza chiusura), ${label}: ${n0(x.closedByCoincidence)}`);
    // ---- CP7c: che cosa contengono i sottopercorsi con cubiche. Aperto = senza closePath e con l'ultimo punto a piu' di 0.001 pt dal primo; chiuso = closePath o ultimo punto entro 0.001 pt.
    // "Di sole cubiche" = nessun lineTo e nessuna quadratica; "misto" = almeno una cubica e almeno un lineTo o una quadratica.
    const o = x.openCubicOnly;
    lines.push(
      `sottopercorsi APERTI di sole cubiche, ${label}, per numero di cubiche: 1: ${n0(o[0]!)} · 2: ${n0(o[1]!)} · 3: ${n0(o[2]!)} · 4: ${n0(o[3]!)} · 5-8: ${n0(o[4]!)} · oltre 8: ${n0(o[5]!)} (cubiche che contengono: ${n0(x.openCubicOnlyCubics)})`,
    );
    for (const [state, mx] of [
      ['APERTI', x.openMixed],
      ['CHIUSI', x.closedMixed],
    ] as const) {
      const c = mx.byCubics;
      const l = mx.byLineTo;
      lines.push(
        `sottopercorsi ${state} misti (cubiche e lineTo o quadratiche), ${label}: ${n0(mx.subpaths)} (cubiche ${n0(mx.cubics)}, lineTo ${n0(mx.lineTo)}, quadratiche ${n0(mx.quad)}); per numero di cubiche: 1: ${n0(c[0]!)} · 2: ${n0(c[1]!)} · 3: ${n0(c[2]!)} · 4: ${n0(c[3]!)} · 5-8: ${n0(c[4]!)} · oltre 8: ${n0(c[5]!)}`,
      );
      lines.push(`sottopercorsi ${state} misti, ${label}, per numero di lineTo: 0: ${n0(l[0]!)} · 1: ${n0(l[1]!)} · 2: ${n0(l[2]!)} · 3-4: ${n0(l[3]!)} · 5-8: ${n0(l[4]!)} · oltre 8: ${n0(l[5]!)}`);
    }
    const parts = x.closedCubicOnlyCubics + x.openCubicOnlyCubics + x.openMixed.cubics + x.closedMixed.cubics;
    const total = label === 'candidati' ? s.cand.cubic : s.all.cubic;
    lines.push(
      `conto delle cubiche, ${label}: chiusi di sole cubiche ${n0(x.closedCubicOnlyCubics)} + aperti di sole cubiche ${n0(x.openCubicOnlyCubics)} + aperti misti ${n0(x.openMixed.cubics)} + chiusi misti ${n0(x.closedMixed.cubics)} = ${n0(parts)}; cubiche dei percorsi ${n0(total)} (${parts === total ? 'il conto torna' : 'IL CONTO NON TORNA'})`,
    );
    lines.push(
      `conto delle cubiche in sottopercorsi aperti, ${label}: aperti di sole cubiche ${n0(x.openCubicOnlyCubics)} + aperti misti ${n0(x.openMixed.cubics)} = ${n0(x.openCubicOnlyCubics + x.openMixed.cubics)}; riga "cubiche in sottopercorsi aperti" ${n0(x.cubicsInOpen)} (${x.openCubicOnlyCubics + x.openMixed.cubics === x.cubicsInOpen ? 'il conto torna' : 'IL CONTO NON TORNA'})`,
    );
    const f = x.four;
    const g = f.gapHist;
    lines.push(
      `sottopercorsi di sole cubiche con 4 cubiche (aperti o chiusi), ${label}: ${n0(f.subpaths)} (aperti ${n0(f.open)}); distanza fra ultimo e primo punto (pt utente): fino a ${GAP_EDGES[0]}: ${n0(g[0]!)} · fino a ${GAP_EDGES[1]}: ${n0(g[1]!)} · fino a ${GAP_EDGES[2]}: ${n0(g[2]!)} · fino a ${GAP_EDGES[3]}: ${n0(g[3]!)} · fino a ${GAP_EDGES[4]}: ${n0(g[4]!)} · oltre ${GAP_EDGES[4]}: ${n0(g[5]!)}`,
    );
    lines.push(
      `distanza minima e massima fra ultimo e primo punto dei sottopercorsi di sole cubiche con 4 cubiche, ${label} (pt utente): ${f.gapMin === null ? 'nessuno' : `${fmtTrim(f.gapMin, 6)} e ${fmtTrim(f.gapMax ?? 0, 6)}`}`,
    );
    lines.push(
      `di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, ${label}: ${n0(f.circleNoClose)} su ${n0(f.subpaths)} (scostamento massimo ${fmtTrim(f.circleNoCloseMaxDev, 6)} pt, chiusura esclusa; tolleranza ${CIRCLE_TOL_ABS} pt + ${CIRCLE_TOL_REL} x raggio)`,
    );
  }
  // ---- CP7e: misura degli archi (righe nuove, in coda a quelle di CP7c)
  lines.push(...arcDefinitionLines());
  for (const [label, x] of [
    ['tutti i percorsi', s.shapesAll],
    ['candidati', s.shapesCand],
  ] as const) {
    lines.push(...arcLines(label, x));
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
