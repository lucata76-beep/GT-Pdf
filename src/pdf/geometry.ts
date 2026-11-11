// Estrattore della geometria di una pagina PDF (V3.0, CP7a): legge l'elenco di operazioni di PDF.js (page.getOperatorList()) e ne ricava i tratti dei percorsi
// nello SPAZIO UTENTE del file (lo stesso degli oggetti dell'app: indipendente da zoom, /Rotate e CropBox), piu' le misure per pagina.
//
// Modulo PURO: niente DOM, niente PDF.js importato (la tabella OPS e la funzione di visibilita' dei livelli arrivano dal chiamante), niente `src/pdf/loader.ts`.
// NIENTE snap, niente uso nell'editor o nel visore: serve alla scheda "Geometria PDF" della pagina Diagnostica (src/diag/page.ts), per MISURARE i PDF reali.
//
// FORMATO LETTO (pdfjs-dist 6.5.438, build legacy; formato interno NON documentato da PDF.js: va riletto a ogni aggiornamento della libreria):
//  - `OPS.constructPath` ha argomenti [codicePittura, [Float32Array | null], riquadro | null]. Percorso vuoto: [codicePittura, [null], null].
//  - Il Float32Array e' una sequenza di comandi: 0 moveTo (2 numeri), 1 lineTo (2), 2 curva cubica (6), 3 curva quadratica (4), 4 closePath (0).
//    Un `re` arriva gia' scomposto (moveTo, tre lineTo, closePath; se largo o alto 0: moveTo, lineTo, closePath); `v` e `y` arrivano come cubiche.
//  - Le coordinate sono nello spazio locale: vanno portate nello spazio utente con la matrice corrente (save, restore, transform, paintFormXObjectBegin/End,
//    beginAnnotation/endAnnotation).
//  - Il contenuto di un livello spento e' NELL'elenco: i marcatori (beginMarkedContent, beginMarkedContentProps, endMarkedContent) vanno seguiti tutti e tre.
//
// I cinque codici dei comandi sono `DrawOPS` di PDF.js: definita in node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs (riga 5814) e in
// node_modules/pdfjs-dist/legacy/build/pdf.mjs (riga 6377), e NON esportata (letto a runtime: 'DrawOPS' in pdfjs e' false). Quindi sono ricopiati qui.
// Se un aggiornamento di PDF.js cambia il formato, i test di src/pdf/geometry.test.ts ("sentinella") falliscono con "aggiornare src/pdf/geometry.ts".

/** DrawOPS di PDF.js 6.5.438 (ricopiati: la costante NON e' esportata). */
export const DRAW_MOVE_TO = 0;
export const DRAW_LINE_TO = 1;
export const DRAW_CURVE_TO = 2;
export const DRAW_QUAD_TO = 3;
export const DRAW_CLOSE = 4;

/** Tipo di pittura di un percorso. `endPath` non disegna (`n`, e il ritaglio `W n`). */
export type PaintKind = 'stroke' | 'fill' | 'fillStroke' | 'endPath';

/** Tabella OPS di PDF.js (nome -> codice). */
export type OpsTable = Readonly<Record<string, number>>;

/** Limite di sicurezza predefinito: numeri (comandi e coordinate) letti dai Float32Array dei percorsi. Vedi `ExtractInput.maxCoords`. */
export const DEFAULT_MAX_COORDS = 10_000_000;

/** Tolleranze della regola del cerchio (pt utente): assoluta + relativa al raggio; per i punti a meta' delle cubiche una relativa piu' larga (k = 0.55 da' 1.2e-3 del raggio). */
export const CIRCLE_TOL_ABS = 0.002;
export const CIRCLE_TOL_REL = 5e-4;
export const CIRCLE_MID_REL = 2e-3;
/** Un sottopercorso senza closePath e' "chiuso per coincidenza" se l'ultimo punto dista dal primo meno di cosi' (pt utente). */
export const CLOSE_COINCIDENCE = 1e-3;
/** Contenitori dell'istogramma delle lunghezze dei segmenti rettilinei (pt utente): sotto 0,01; 0,01-0,1; 0,1-1; 1-10; 10 e oltre. */
export const LENGTH_EDGES = [0.01, 0.1, 1, 10] as const;
/** Contenitori dei sottopercorsi chiusi di sole cubiche: 1, 2, 3, 4, 5-8, oltre 8 cubiche. */
export const CUBIC_BUCKETS = 6;
/** Poligono fitto: sottopercorso chiuso con almeno cosi' tanti lineTo e nessuna cubica. */
export const DENSE_POLYGON_LINETO = 12;
/**
 * Contenitori della distanza fra l'ultimo e il primo punto dei sottopercorsi di sole cubiche con 4 cubiche (misura di CP7c, pt utente; limite superiore INCLUSO, come `<=` di
 * CLOSE_COINCIDENCE): fino a 1e-4; fino a 1e-3 (= CLOSE_COINCIDENCE: chiusi per coincidenza); fino a 5e-3; fino a 5e-2; fino a 0,5; oltre.
 */
export const GAP_EDGES = [1e-4, CLOSE_COINCIDENCE, 5e-3, 5e-2, 0.5] as const;
/** Contenitori dei sottopercorsi misti per numero di lineTo (CP7c): 0 (solo con quadratiche), 1, 2, 3-4, 5-8, oltre 8. */
export const LINETO_BUCKETS = 6;

export interface ExtractInput {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
  ops: OpsTable;
  /** `optionalContentConfig.isVisible` nel browser. Chiamata solo con dati non null (null: visibile, come fa PDF.js). */
  isLayerVisible: (data: unknown) => boolean;
  /** Limite di sicurezza: dopo questo numero di numeri letti dai Float32Array si smette di leggere i percorsi (le conte delle operazioni restano complete). */
  maxCoords?: number;
}

/** Conte per tipo di operazione (sempre su TUTTA la pagina, anche se il limite scatta). */
export interface OpCounts {
  total: number;
  constructPath: number;
  /** Tutte le operazioni immagine: paintImageXObject, paintInlineImageXObject (e Group), paintImageXObjectRepeat, paintImageMaskXObject (e Group, Repeat), paintSolidColorImageMask. */
  imageOps: number;
  /** showText e le tre varianti (showSpacedText, nextLineShowText, nextLineSetSpacingShowText). */
  showText: number;
  shadingFill: number;
  /** Operatori colore con pattern, per nome come compaiono (setFillColorN, setStrokeColorN), senza leggerne il contenuto. */
  patternColorOps: Record<string, number>;
  forms: number;
  annotations: number;
}

/** Conte dei comandi di un gruppo di percorsi. */
export interface PathTotals {
  paths: number;
  /** Sottopercorsi = comandi moveTo (piu' gli inizi impliciti): anche un moveTo seguito da un altro moveTo (pdf-lib ne scrive due per ogni linea). */
  subpaths: number;
  /** Fra i sottopercorsi, quelli senza alcun tratto (solo un punto). */
  emptySubpaths: number;
  lineTo: number;
  cubic: number;
  quad: number;
  /** Comandi closePath. */
  close: number;
  /** closePath che ha aggiunto un segmento rettilineo (punto corrente diverso dal primo del sottopercorso): quel segmento conta come segmento rettilineo. */
  closeSegments: number;
  /** closePath senza segmento (punto corrente uguale al primo, o nessun sottopercorso). */
  closeNoSegment: number;
}

/** Sottopercorsi MISTI (CP7c): con almeno una cubica e almeno un altro tratto (lineTo o quadratica). Una per gruppo e per stato (aperti, chiusi). */
export interface MixedStats {
  subpaths: number;
  /** Cubiche, lineTo e quadratiche che contengono. */
  cubics: number;
  lineTo: number;
  quad: number;
  /** Per numero di cubiche: [1, 2, 3, 4, 5-8, oltre 8]. */
  byCubics: number[];
  /** Per numero di lineTo: [0, 1, 2, 3-4, 5-8, oltre 8] (lo 0 solo se contengono quadratiche). */
  byLineTo: number[];
}

/** Sottopercorsi di sole cubiche con ESATTAMENTE 4 cubiche, aperti o chiusi (CP7c): quanto distano l'ultimo e il primo punto e se somigliano a un cerchio ignorando la chiusura. */
export interface FourCubicStats {
  /** Sottopercorsi di sole cubiche (nessun lineTo, nessuna quadratica) con esattamente 4 cubiche. */
  subpaths: number;
  /** Fra questi, quelli aperti (senza closePath e con l'ultimo punto a piu' di CLOSE_COINCIDENCE dal primo). */
  open: number;
  /** Distanza fra l'ultimo punto della quarta cubica e il primo della prima (pt utente), per GAP_EDGES: [<=1e-4, <=1e-3, <=5e-3, <=5e-2, <=0.5, oltre]. */
  gapHist: number[];
  gapMin: number | null;
  gapMax: number | null;
  /** Quanti rispettano la regola del cerchio SENZA la condizione di chiusura (`circleFrom4Cubics(c, false)`), e il loro scostamento massimo (pt utente; senza la distanza di chiusura), 0 se nessuno. */
  circleNoClose: number;
  circleNoCloseMaxDev: number;
}

/** Forma dei sottopercorsi (cerchi e archi): una per gruppo (tutti i percorsi; solo stroke e fillStroke). */
export interface ShapeStats {
  /** Sottopercorsi chiusi composti SOLO da cubiche, per numero di cubiche: [1, 2, 3, 4, 5-8, oltre 8]. */
  closedCubicOnly: number[];
  /** Fra quelli da 4 cubiche, quanti rispettano la regola del cerchio. */
  circles4: number;
  /** Scostamento massimo (pt utente) fra i cerchi riconosciuti, 0 se nessuno. */
  circles4MaxDev: number;
  /** Sottopercorsi chiusi con almeno DENSE_POLYGON_LINETO lineTo e nessuna cubica. */
  denseClosedPolygons: number;
  /** Cubiche in sottopercorsi aperti. */
  cubicsInOpen: number;
  /** Sottopercorsi chiusi solo per coincidenza dell'ultimo punto con il primo (nessun closePath). */
  closedByCoincidence: number;
  // ---- CP7c (misura in piu': che cosa sono le cubiche dei sottopercorsi aperti). Le definizioni sono nelle righe di `measureLines` e in docs/PIANO.md.
  /** Cubiche dei sottopercorsi chiusi di sole cubiche (somma dei `closedCubicOnly` per cubica). */
  closedCubicOnlyCubics: number;
  /** Sottopercorsi APERTI di sole cubiche, per numero di cubiche: [1, 2, 3, 4, 5-8, oltre 8], e le cubiche che contengono. */
  openCubicOnly: number[];
  openCubicOnlyCubics: number;
  /** Sottopercorsi con cubiche E lineTo (o quadratiche), aperti e chiusi. */
  openMixed: MixedStats;
  closedMixed: MixedStats;
  /** Sottopercorsi di sole cubiche con 4 cubiche. */
  four: FourCubicStats;
}

export interface LayerStats {
  /** Marcatori OC (beginMarkedContentProps con tag "OC"). */
  ocMarkers: number;
  ocgMarkers: number;
  ocmdMarkers: number;
  /** Marcatori OC di tipo OCMD che risultano spenti secondo isLayerVisible. */
  ocmdHidden: number;
  /** Marcatori OC con dati null (PDF.js non ha letto il gruppo): trattati come visibili (come fa PDF.js). */
  ocNull: number;
  /** Marcatori OC con dati di un tipo diverso da OCG e OCMD. */
  ocOther: number;
  /** isLayerVisible ha lanciato un errore: il marcatore e' trattato come visibile. */
  ocErrors: number;
  /** Profondita' massima della pila dei marcatori (BMC, BDC con o senza OC). */
  maxDepth: number;
  /** endMarkedContent senza apertura (tollerato). */
  emcUnderflow: number;
  /** Marcatori ancora aperti a fine pagina. */
  unclosedMarkers: number;
  /** Percorsi (di ogni tipo) dentro un livello spento. */
  hiddenPaths: number;
  hiddenCandidatePaths: number;
  /** Segmenti (rettilinei e cubici) dei candidati dentro un livello spento. */
  hiddenCandidateSegments: number;
}

export interface GeometryStats {
  ops: OpCounts;
  /** Percorsi con dati letti (esclusi i vuoti e quelli oltre il limite o non finiti). */
  paths: number;
  emptyPaths: number;
  byPaint: Record<PaintKind, number>;
  all: PathTotals;
  /** I soli percorsi stroke e fillStroke (i candidati dello snap di V3.1). */
  cand: PathTotals;
  /** Segmenti rettilinei dei candidati (lineTo e chiusure con segmento). Istogramma per LENGTH_EDGES: [<0.01, 0.01-0.1, 0.1-1, 1-10, >=10]. */
  lineHist: number[];
  lineMin: number | null;
  lineMax: number | null;
  /** CP7c: segmenti rettilinei dei candidati di lunghezza ESATTAMENTE 0 (stanno nel primo contenitore di `lineHist`: gli altri sono fra 0 escluso e 0,01). */
  lineZero: number;
  /** CP7c: corde delle cubiche dei candidati (distanza fra primo e ultimo punto, pt utente; le quadratiche non entrano): istogramma per LENGTH_EDGES come `lineHist`, minimo, massimo, e quante di lunghezza ESATTAMENTE 0. */
  cubicChordHist: number[];
  cubicChordMin: number | null;
  cubicChordMax: number | null;
  cubicChordZero: number;
  shapesAll: ShapeStats;
  shapesCand: ShapeStats;
  layers: LayerStats;
  /** Percorsi con coordinate non finite (NaN o Infinity): non letti. */
  nonFinitePaths: number;
  /** lineTo o curve senza punto corrente: il tratto inizia dal punto indicato (come fa il canvas). */
  noCurrentPoint: number;
  /** restore senza save (tollerato). */
  restoreUnderflow: number;
  /** Numeri letti dai Float32Array dei percorsi (comandi e coordinate). */
  coordsRead: number;
  /** Se il limite di sicurezza e' scattato: dove. */
  truncated: { atOp: number; ofOps: number; limit: number } | null;
}

/** Primitive dei candidati (percorsi stroke e fillStroke) nello spazio utente, in array tipizzati. */
export interface PdfGeometry {
  nPaths: number;
  /** 1 = stroke, 2 = fillStroke. */
  pathPaint: Uint8Array;
  /** 1 = visibile, 0 = dentro un livello spento. */
  pathVisible: Uint8Array;
  nLines: number;
  /** x0, y0, x1, y1 per segmento rettilineo. */
  lineXY: Float32Array;
  /** Indice del percorso di ogni segmento rettilineo. */
  linePath: Uint32Array;
  nCubics: number;
  /** x0, y0, c1x, c1y, c2x, c2y, x1, y1 per cubica (le quadratiche sono convertite in cubiche esatte). */
  cubicXY: Float32Array;
  cubicPath: Uint32Array;
  /** Byte occupati dai sei array. */
  bytes: number;
}

export type ExtractResult = { ok: true; geometry: PdfGeometry; stats: GeometryStats } | { ok: false; reason: string };

/** Byte per segmento rettilineo (4 x Float32 + 1 x Uint32) e per cubica (8 x Float32 + 1 x Uint32). */
export const BYTES_PER_LINE = 20;
export const BYTES_PER_CUBIC = 36;

const FIX = 'aggiornare src/pdf/geometry.ts';

// ------------------------------------------------------------------ azioni per codice di operazione
const A_SAVE = 1;
const A_RESTORE = 2;
const A_TRANSFORM = 3;
const A_PATH = 4;
const A_BMC = 5;
const A_BDC = 6;
const A_EMC = 7;
const A_FORM_BEGIN = 8;
const A_FORM_END = 9;
const A_ANN_BEGIN = 10;
const A_ANN_END = 11;
const A_IMAGE = 20;
const A_TEXT = 21;
const A_SHADING = 22;
const A_COLORN_FILL = 23;
const A_COLORN_STROKE = 24;

const REQUIRED = [
  'save',
  'restore',
  'transform',
  'constructPath',
  'stroke',
  'closeStroke',
  'fill',
  'eoFill',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
  'endPath',
  'beginMarkedContent',
  'beginMarkedContentProps',
  'endMarkedContent',
  'paintFormXObjectBegin',
  'paintFormXObjectEnd',
  'beginAnnotation',
  'endAnnotation',
] as const;
const IMAGE_NAMES = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
  'paintSolidColorImageMask',
];
const TEXT_NAMES = ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'];

function newTotals(): PathTotals {
  return { paths: 0, subpaths: 0, emptySubpaths: 0, lineTo: 0, cubic: 0, quad: 0, close: 0, closeSegments: 0, closeNoSegment: 0 };
}
function newMixed(): MixedStats {
  return { subpaths: 0, cubics: 0, lineTo: 0, quad: 0, byCubics: new Array<number>(CUBIC_BUCKETS).fill(0), byLineTo: new Array<number>(LINETO_BUCKETS).fill(0) };
}
function newShapes(): ShapeStats {
  return {
    closedCubicOnly: new Array<number>(CUBIC_BUCKETS).fill(0),
    circles4: 0,
    circles4MaxDev: 0,
    denseClosedPolygons: 0,
    cubicsInOpen: 0,
    closedByCoincidence: 0,
    closedCubicOnlyCubics: 0,
    openCubicOnly: new Array<number>(CUBIC_BUCKETS).fill(0),
    openCubicOnlyCubics: 0,
    openMixed: newMixed(),
    closedMixed: newMixed(),
    four: { subpaths: 0, open: 0, gapHist: new Array<number>(GAP_EDGES.length + 1).fill(0), gapMin: null, gapMax: null, circleNoClose: 0, circleNoCloseMaxDev: 0 },
  };
}
function newLayers(): LayerStats {
  return {
    ocMarkers: 0,
    ocgMarkers: 0,
    ocmdMarkers: 0,
    ocmdHidden: 0,
    ocNull: 0,
    ocOther: 0,
    ocErrors: 0,
    maxDepth: 0,
    emcUnderflow: 0,
    unclosedMarkers: 0,
    hiddenPaths: 0,
    hiddenCandidatePaths: 0,
    hiddenCandidateSegments: 0,
  };
}

/** Contenitore dell'istogramma per la lunghezza `len` (pt utente). */
export function lengthBucket(len: number): number {
  return len < LENGTH_EDGES[0] ? 0 : len < LENGTH_EDGES[1] ? 1 : len < LENGTH_EDGES[2] ? 2 : len < LENGTH_EDGES[3] ? 3 : 4;
}
/** Contenitore dei sottopercorsi chiusi di sole cubiche per numero di cubiche (>= 1): [1, 2, 3, 4, 5-8, oltre 8]. */
export function cubicBucket(n: number): number {
  return n <= 4 ? n - 1 : n <= 8 ? 4 : 5;
}
/** Contenitore dei sottopercorsi misti per numero di lineTo (>= 0): [0, 1, 2, 3-4, 5-8, oltre 8]. */
export function lineToBucket(n: number): number {
  return n <= 2 ? n : n <= 4 ? 3 : n <= 8 ? 4 : 5;
}
/** Contenitore della distanza fra ultimo e primo punto (pt utente), limite superiore incluso: vedi GAP_EDGES. */
export function gapBucket(d: number): number {
  return d <= GAP_EDGES[0] ? 0 : d <= GAP_EDGES[1] ? 1 : d <= GAP_EDGES[2] ? 2 : d <= GAP_EDGES[3] ? 3 : d <= GAP_EDGES[4] ? 4 : 5;
}

/**
 * Regola del cerchio (misura, NON una primitiva): `c` contiene quattro cubiche consecutive (x0, y0, c1x, c1y, c2x, c2y, x1, y1 ciascuna, 32 numeri); i 4 punti di fine
 * stanno a 90 gradi su una circonferenza: l'ultimo coincide con il primo, A e C (primo punto e fine della seconda) e B e D (fine della prima e della terza) sono estremi di due
 * diametri con lo stesso centro e la stessa lunghezza, perpendicolari; e il punto a meta' di ogni cubica sta a distanza ~raggio dal centro, dalla parte della corda.
 * Restituisce lo scostamento massimo (pt utente) se la regola e' rispettata, altrimenti null.
 * `needClosed` (predefinito true: la regola di CP7a, invariata): con `false` la condizione di chiusura (l'ultimo punto coincide con il primo) NON si controlla e lo scostamento di
 * chiusura non entra nel massimo restituito (CP7c: per capire se un sottopercorso aperto di 4 cubiche e' un cerchio la cui chiusura dista un poco piu' di CLOSE_COINCIDENCE).
 */
export function circleFrom4Cubics(c: ArrayLike<number>, needClosed = true): number | null {
  const ax = c[0] as number;
  const ay = c[1] as number;
  const bx = c[6] as number;
  const by = c[7] as number;
  const cx = c[14] as number;
  const cy = c[15] as number;
  const dx = c[22] as number;
  const dy = c[23] as number;
  const ex = c[30] as number;
  const ey = c[31] as number;
  const o1x = (ax + cx) / 2;
  const o1y = (ay + cy) / 2;
  const o2x = (bx + dx) / 2;
  const o2y = (by + dy) / 2;
  const r1 = Math.hypot(cx - ax, cy - ay) / 2;
  const r2 = Math.hypot(dx - bx, dy - by) / 2;
  const r = (r1 + r2) / 2;
  if (!(r > 0)) return null;
  const tol = CIRCLE_TOL_ABS + CIRCLE_TOL_REL * r;
  const tolMid = tol + CIRCLE_MID_REL * r;
  const devClose = Math.hypot(ex - ax, ey - ay);
  const devCenter = Math.hypot(o1x - o2x, o1y - o2y);
  const devR = Math.abs(r1 - r2);
  // perpendicolarita': lo spostamento di B dalla posizione a 90 gradi vale ~ r * cos(angolo) = |(A-O).(B-O)| / r
  const devPerp = Math.abs((ax - o1x) * (bx - o1x) + (ay - o1y) * (by - o1y)) / r;
  if ((needClosed && devClose > tol) || devCenter > tol || devR > tol || devPerp > tol) return null;
  let devMid = 0;
  for (let k = 0; k < 4; k++) {
    const o = k * 8;
    const mx = ((c[o] as number) + 3 * (c[o + 2] as number) + 3 * (c[o + 4] as number) + (c[o + 6] as number)) / 8;
    const my = ((c[o + 1] as number) + 3 * (c[o + 3] as number) + 3 * (c[o + 5] as number) + (c[o + 7] as number)) / 8;
    const dev = Math.abs(Math.hypot(mx - o1x, my - o1y) - r);
    if (dev > tolMid) return null;
    // dalla parte della corda (e non dall'arco opposto)
    const chx = ((c[o] as number) + (c[o + 6] as number)) / 2 - o1x;
    const chy = ((c[o + 1] as number) + (c[o + 7] as number)) / 2 - o1y;
    if ((mx - o1x) * chx + (my - o1y) * chy <= 0) return null;
    if (dev > devMid) devMid = dev;
  }
  return Math.max(needClosed ? devClose : 0, devCenter, devR, devPerp, devMid);
}

// ------------------------------------------------------------------ matrici (x' = a x + c y + e, y' = b x + d y + f)
type Mat = [number, number, number, number, number, number];
/** ctm := ctm x m (come ctx.transform del canvas e Util.transform di PDF.js): la matrice m si applica per prima. */
function concat(ctm: Mat, m: ArrayLike<number>): void {
  const [a, b, c, d, e, f] = ctm;
  const m0 = m[0] as number;
  const m1 = m[1] as number;
  const m2 = m[2] as number;
  const m3 = m[3] as number;
  ctm[0] = a * m0 + c * m1;
  ctm[1] = b * m0 + d * m1;
  ctm[2] = a * m2 + c * m3;
  ctm[3] = b * m2 + d * m3;
  ctm[4] = a * (m[4] as number) + c * (m[5] as number) + e;
  ctm[5] = b * (m[4] as number) + d * (m[5] as number) + f;
}
const isMatrix = (m: unknown): m is ArrayLike<number> => {
  if (m === null || typeof m !== 'object' || !('length' in m) || (m as ArrayLike<number>).length !== 6) return false;
  for (let i = 0; i < 6; i++) if (typeof (m as ArrayLike<number>)[i] !== 'number') return false;
  return true;
};

// ------------------------------------------------------------------ memorizzazione compatta
function grow32(a: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  let cap = a.length;
  while (cap < need) cap *= 2;
  const b = new Float32Array(cap);
  b.set(a);
  return b;
}
function growU32(a: Uint32Array<ArrayBuffer>, need: number): Uint32Array<ArrayBuffer> {
  let cap = a.length;
  while (cap < need) cap *= 2;
  const b = new Uint32Array(cap);
  b.set(a);
  return b;
}
function growU8(a: Uint8Array<ArrayBuffer>, need: number): Uint8Array<ArrayBuffer> {
  let cap = a.length;
  while (cap < need) cap *= 2;
  const b = new Uint8Array(cap);
  b.set(a);
  return b;
}

const isNumArray = (v: unknown): v is ArrayLike<number> => v !== null && typeof v === 'object' && typeof (v as ArrayLike<number>).length === 'number';

/**
 * Legge l'elenco di operazioni di una pagina. Non lancia MAI: un formato diverso da quello atteso restituisce `{ ok: false, reason }`
 * (la `reason` dice "aggiornare src/pdf/geometry.ts" quando il formato non e' piu' quello di PDF.js 6.5.438).
 */
export function extractGeometry(input: ExtractInput): ExtractResult {
  try {
    return extract(input);
  } catch (e) {
    return { ok: false, reason: `Errore imprevisto nell'estrazione della geometria (${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}): ${FIX}.` };
  }
}

function extract(input: ExtractInput): ExtractResult {
  const { fnArray, argsArray, ops, isLayerVisible } = input;
  const limit = input.maxCoords ?? DEFAULT_MAX_COORDS;
  const nOps = fnArray.length;
  if (nOps !== argsArray.length) return { ok: false, reason: `Elenco di operazioni incoerente: ${nOps} codici e ${argsArray.length} argomenti (${FIX}).` };
  for (const name of REQUIRED) {
    if (typeof ops[name] !== 'number') return { ok: false, reason: `OPS.${name} non esiste in questa versione di PDF.js (${FIX}).` };
  }
  const O = ops as Record<string, number>;

  // ---- tabella codice -> azione
  const action = new Uint8Array(256);
  const set = (name: string, act: number): void => {
    const code = O[name];
    if (typeof code === 'number' && code >= 0 && code < 256) action[code] = act;
  };
  set('save', A_SAVE);
  set('restore', A_RESTORE);
  set('transform', A_TRANSFORM);
  set('constructPath', A_PATH);
  set('beginMarkedContent', A_BMC);
  set('beginMarkedContentProps', A_BDC);
  set('endMarkedContent', A_EMC);
  set('paintFormXObjectBegin', A_FORM_BEGIN);
  set('paintFormXObjectEnd', A_FORM_END);
  set('beginAnnotation', A_ANN_BEGIN);
  set('endAnnotation', A_ANN_END);
  for (const n of IMAGE_NAMES) set(n, A_IMAGE);
  for (const n of TEXT_NAMES) set(n, A_TEXT);
  set('shadingFill', A_SHADING);
  set('setFillColorN', A_COLORN_FILL);
  set('setStrokeColorN', A_COLORN_STROKE);

  // ---- codici di pittura
  const paintOf = new Map<number, PaintKind>([
    [O['stroke'] as number, 'stroke'],
    [O['closeStroke'] as number, 'stroke'],
    [O['fill'] as number, 'fill'],
    [O['eoFill'] as number, 'fill'],
    [O['fillStroke'] as number, 'fillStroke'],
    [O['eoFillStroke'] as number, 'fillStroke'],
    [O['closeFillStroke'] as number, 'fillStroke'],
    [O['closeEOFillStroke'] as number, 'fillStroke'],
    [O['endPath'] as number, 'endPath'],
  ]);
  // rawFillPath (OPS 94) esiste solo nei glifi Type3 (compileType3Glyph: letto nel sorgente, NON provato su un PDF): se compare nell'elenco di una pagina e' un riempimento.
  if (typeof O['rawFillPath'] === 'number') paintOf.set(O['rawFillPath'], 'fill');

  // ---- conte per tipo di operazione (su tutta la pagina)
  const opc: OpCounts = { total: nOps, constructPath: 0, imageOps: 0, showText: 0, shadingFill: 0, patternColorOps: {}, forms: 0, annotations: 0 };
  let colorNFill = 0;
  let colorNStroke = 0;
  for (let i = 0; i < nOps; i++) {
    const fn = fnArray[i];
    if (typeof fn !== 'number') return { ok: false, reason: `Codice di operazione non numerico all'indice ${i} (${FIX}).` };
    const a = fn >= 0 && fn < 256 ? (action[fn] as number) : 0;
    if (a === 0) continue;
    if (a === A_PATH) opc.constructPath++;
    else if (a === A_IMAGE) opc.imageOps++;
    else if (a === A_TEXT) opc.showText++;
    else if (a === A_SHADING) opc.shadingFill++;
    else if (a === A_COLORN_FILL) colorNFill++;
    else if (a === A_COLORN_STROKE) colorNStroke++;
    else if (a === A_FORM_BEGIN) opc.forms++;
    else if (a === A_ANN_BEGIN) opc.annotations++;
  }
  if (colorNFill) opc.patternColorOps['setFillColorN'] = colorNFill;
  if (colorNStroke) opc.patternColorOps['setStrokeColorN'] = colorNStroke;

  // ---- statistiche e memoria
  const stats: GeometryStats = {
    ops: opc,
    paths: 0,
    emptyPaths: 0,
    byPaint: { stroke: 0, fill: 0, fillStroke: 0, endPath: 0 },
    all: newTotals(),
    cand: newTotals(),
    lineHist: [0, 0, 0, 0, 0],
    lineMin: null,
    lineMax: null,
    lineZero: 0,
    cubicChordHist: [0, 0, 0, 0, 0],
    cubicChordMin: null,
    cubicChordMax: null,
    cubicChordZero: 0,
    shapesAll: newShapes(),
    shapesCand: newShapes(),
    layers: newLayers(),
    nonFinitePaths: 0,
    noCurrentPoint: 0,
    restoreUnderflow: 0,
    coordsRead: 0,
    truncated: null,
  };
  const L = stats.layers;
  let pathPaint = new Uint8Array(1024);
  let pathVisible = new Uint8Array(1024);
  let lineXY = new Float32Array(4096);
  let linePath = new Uint32Array(1024);
  let cubicXY = new Float32Array(4096);
  let cubicPath = new Uint32Array(512);
  let nPaths = 0;
  let nLines = 0;
  let nCubics = 0;

  // ---- stato grafico
  const ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: Mat[] = [];
  const markers: boolean[] = []; // true = visibile
  let hidden = 0; // marcatori spenti aperti

  // ---- stato del percorso corrente
  const cub = new Float64Array(32); // prime 4 cubiche del sottopercorso (per la regola del cerchio)

  const pushMarker = (visible: boolean): void => {
    markers.push(visible);
    if (!visible) hidden++;
    if (markers.length > L.maxDepth) L.maxDepth = markers.length;
  };

  for (let i = 0; i < nOps; i++) {
    const fn = fnArray[i] as number;
    const act = fn >= 0 && fn < 256 ? (action[fn] as number) : 0;
    if (act === 0 || act >= A_IMAGE) continue;
    const args = argsArray[i];
    switch (act) {
      case A_SAVE:
        stack.push([ctm[0], ctm[1], ctm[2], ctm[3], ctm[4], ctm[5]]);
        break;
      case A_RESTORE: {
        const m = stack.pop();
        if (m) {
          ctm[0] = m[0];
          ctm[1] = m[1];
          ctm[2] = m[2];
          ctm[3] = m[3];
          ctm[4] = m[4];
          ctm[5] = m[5];
        } else stats.restoreUnderflow++;
        break;
      }
      case A_TRANSFORM:
        if (!isMatrix(args)) return { ok: false, reason: `transform: gli argomenti non sono una matrice di 6 numeri (indice ${i}; ${FIX}).` };
        concat(ctm, args);
        break;
      case A_FORM_BEGIN: {
        // [matrice | null, riquadro | null]
        if (!Array.isArray(args)) return { ok: false, reason: `paintFormXObjectBegin: argomenti di forma diversa da [matrice, riquadro] (indice ${i}; ${FIX}).` };
        stack.push([ctm[0], ctm[1], ctm[2], ctm[3], ctm[4], ctm[5]]);
        const m = (args as unknown[])[0];
        if (m !== null && m !== undefined) {
          if (!isMatrix(m)) return { ok: false, reason: `paintFormXObjectBegin: la matrice non e' di 6 numeri (indice ${i}; ${FIX}).` };
          concat(ctm, m);
        }
        break;
      }
      case A_FORM_END: {
        const m = stack.pop();
        if (m) {
          ctm[0] = m[0];
          ctm[1] = m[1];
          ctm[2] = m[2];
          ctm[3] = m[3];
          ctm[4] = m[4];
          ctm[5] = m[5];
        } else stats.restoreUnderflow++;
        break;
      }
      case A_ANN_BEGIN: {
        // [id, riquadro, transform, matrice, hasOwnCanvas, ...]: PDF.js riporta lo stato iniziale (matrice di base) e applica transform e matrice.
        if (!Array.isArray(args) || !isMatrix(args[2]) || !isMatrix(args[3])) return { ok: false, reason: `beginAnnotation: argomenti di forma diversa da [id, riquadro, transform, matrice, ...] (indice ${i}; ${FIX}).` };
        stack.length = 0;
        ctm[0] = 1;
        ctm[1] = 0;
        ctm[2] = 0;
        ctm[3] = 1;
        ctm[4] = 0;
        ctm[5] = 0;
        concat(ctm, args[2]);
        concat(ctm, args[3]);
        break;
      }
      case A_ANN_END:
        stack.length = 0;
        ctm[0] = 1;
        ctm[1] = 0;
        ctm[2] = 0;
        ctm[3] = 1;
        ctm[4] = 0;
        ctm[5] = 0;
        break;
      case A_BMC:
        pushMarker(true);
        break;
      case A_BDC: {
        if (!Array.isArray(args) || typeof args[0] !== 'string') return { ok: false, reason: `beginMarkedContentProps: argomenti di forma diversa da [tag, dati] (indice ${i}; ${FIX}).` };
        if (args[0] !== 'OC') {
          pushMarker(true);
          break;
        }
        L.ocMarkers++;
        const data = args[1];
        if (data === null || data === undefined) {
          L.ocNull++;
          pushMarker(true);
          break;
        }
        const type = (data as { type?: unknown }).type;
        if (type === 'OCG') L.ocgMarkers++;
        else if (type === 'OCMD') L.ocmdMarkers++;
        else L.ocOther++;
        let visible = true;
        try {
          visible = isLayerVisible(data) !== false;
        } catch {
          L.ocErrors++;
        }
        if (!visible && type === 'OCMD') L.ocmdHidden++;
        pushMarker(visible);
        break;
      }
      case A_EMC: {
        const v = markers.pop();
        if (v === undefined) L.emcUnderflow++;
        else if (!v) hidden--;
        break;
      }
      case A_PATH: {
        // [codicePittura, [Float32Array | null], riquadro | null]
        if (!Array.isArray(args) || args.length !== 3 || typeof args[0] !== 'number' || !Array.isArray(args[1]) || args[1].length !== 1) {
          return { ok: false, reason: `constructPath: argomenti di forma diversa da [codicePittura, [Float32Array | null], riquadro | null] (indice ${i}; ${FIX}).` };
        }
        const paint = paintOf.get(args[0]);
        if (paint === undefined) return { ok: false, reason: `constructPath: codice di pittura sconosciuto ${String(args[0])} (indice ${i}; ${FIX}).` };
        const buf = args[1][0] as unknown;
        if (buf === null) {
          stats.emptyPaths++;
          break;
        }
        if (!isNumArray(buf)) return { ok: false, reason: `constructPath: i dati del percorso non sono una sequenza di numeri (indice ${i}; ${FIX}).` };
        const n = buf.length;
        if (stats.coordsRead + n > limit) {
          stats.truncated = { atOp: i, ofOps: nOps, limit };
          i = nOps; // esce dal ciclo
          break;
        }
        // ---- controllo del formato e dei numeri prima di leggere (un percorso non valido non lascia tracce a meta')
        let finite = true;
        for (let k = 0; k < n; ) {
          const code = buf[k++] as number;
          let need: number;
          if (code === DRAW_MOVE_TO || code === DRAW_LINE_TO) need = 2;
          else if (code === DRAW_CURVE_TO) need = 6;
          else if (code === DRAW_QUAD_TO) need = 4;
          else if (code === DRAW_CLOSE) need = 0;
          else return { ok: false, reason: `constructPath: codice di comando sconosciuto ${String(code)} nel percorso all'indice ${i} (DrawOPS: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath; ${FIX}).` };
          if (k + need > n) return { ok: false, reason: `constructPath: comando ${code} troncato nel percorso all'indice ${i} (${FIX}).` };
          for (let j = 0; j < need; j++) {
            const v = buf[k + j] as number;
            if (typeof v !== 'number') return { ok: false, reason: `constructPath: valore non numerico nel percorso all'indice ${i} (${FIX}).` };
            if (!Number.isFinite(v)) finite = false;
          }
          k += need;
        }
        stats.coordsRead += n;
        if (!finite || !ctm.every(Number.isFinite)) {
          stats.nonFinitePaths++;
          break;
        }
        // ---- lettura
        const cand = paint === 'stroke' || paint === 'fillStroke';
        const vis = hidden === 0;
        stats.paths++;
        stats.byPaint[paint]++;
        const tAll = stats.all;
        const tCand = stats.cand;
        tAll.paths++;
        if (cand) tCand.paths++;
        if (!vis) {
          L.hiddenPaths++;
          if (cand) L.hiddenCandidatePaths++;
        }
        const pathIdx = nPaths;
        if (cand) {
          if (nPaths + 1 > pathPaint.length) {
            pathPaint = growU8(pathPaint, nPaths + 1);
            pathVisible = growU8(pathVisible, nPaths + 1);
          }
          pathPaint[nPaths] = paint === 'stroke' ? 1 : 2;
          pathVisible[nPaths] = vis ? 1 : 0;
          nPaths++;
        }
        const [ma, mb, mc, md, me, mf] = ctm;
        let hasCur = false; // c'e' un sottopercorso aperto
        let cx = 0;
        let cy = 0;
        let sx = 0;
        let sy = 0;
        let subLines = 0;
        let subCubics = 0;
        let subQuads = 0;
        let subClosedCmd = false;
        let subSegs = 0;
        const endSub = (): void => {
          if (!hasCur) return;
          if (subSegs === 0) {
            hasCur = false;
            tAll.emptySubpaths++;
            if (cand) tCand.emptySubpaths++;
            return;
          }
          let closed = subClosedCmd;
          let byCoinc = false;
          if (!closed && Math.hypot(cx - sx, cy - sy) <= CLOSE_COINCIDENCE) {
            closed = true;
            byCoinc = true;
          }
          const groups: ShapeStats[] = cand ? [stats.shapesAll, stats.shapesCand] : [stats.shapesAll];
          for (const g of groups) {
            if (byCoinc) g.closedByCoincidence++;
            if (!closed) g.cubicsInOpen += subCubics;
            else if (subCubics > 0 && subLines === 0 && subQuads === 0) {
              g.closedCubicOnly[cubicBucket(subCubics)]!++;
              if (subCubics === 4) {
                const dev = circleFrom4Cubics(cub);
                if (dev !== null) {
                  g.circles4++;
                  if (dev > g.circles4MaxDev) g.circles4MaxDev = dev;
                }
              }
            } else if (subCubics === 0 && subQuads === 0 && subLines >= DENSE_POLYGON_LINETO) g.denseClosedPolygons++;
          }
          // ---- CP7c: che cosa contengono i sottopercorsi con cubiche (apertura e chiusura come sopra: closePath o coincidenza dell'ultimo punto)
          if (subCubics > 0) {
            const cubicOnly = subLines === 0 && subQuads === 0;
            const four = cubicOnly && subCubics === 4;
            // 4 cubiche: il primo punto della prima e l'ultimo della quarta (le prime 4 cubiche stanno in `cub`: qui sono tutte)
            const gap = four ? Math.hypot((cub[30] as number) - (cub[0] as number), (cub[31] as number) - (cub[1] as number)) : 0;
            const noClose = four ? circleFrom4Cubics(cub, false) : null;
            for (const g of groups) {
              if (cubicOnly) {
                if (closed) g.closedCubicOnlyCubics += subCubics;
                else {
                  g.openCubicOnly[cubicBucket(subCubics)]!++;
                  g.openCubicOnlyCubics += subCubics;
                }
                if (four) {
                  const f = g.four;
                  f.subpaths++;
                  if (!closed) f.open++;
                  f.gapHist[gapBucket(gap)]!++;
                  if (f.gapMin === null || gap < f.gapMin) f.gapMin = gap;
                  if (f.gapMax === null || gap > f.gapMax) f.gapMax = gap;
                  if (noClose !== null) {
                    f.circleNoClose++;
                    if (noClose > f.circleNoCloseMaxDev) f.circleNoCloseMaxDev = noClose;
                  }
                }
              } else {
                const m = closed ? g.closedMixed : g.openMixed;
                m.subpaths++;
                m.cubics += subCubics;
                m.lineTo += subLines;
                m.quad += subQuads;
                m.byCubics[cubicBucket(subCubics)]!++;
                m.byLineTo[lineToBucket(subLines)]!++;
              }
            }
          }
          hasCur = false;
        };
        const addLine = (x0: number, y0: number, x1: number, y1: number): void => {
          subSegs++;
          if (!cand) return;
          const len = Math.hypot(x1 - x0, y1 - y0);
          stats.lineHist[lengthBucket(len)]!++;
          if (len === 0) stats.lineZero++;
          if (stats.lineMin === null || len < stats.lineMin) stats.lineMin = len;
          if (stats.lineMax === null || len > stats.lineMax) stats.lineMax = len;
          if (!vis) L.hiddenCandidateSegments++;
          const o = nLines * 4;
          if (o + 4 > lineXY.length) {
            lineXY = grow32(lineXY, o + 4);
            linePath = growU32(linePath, nLines + 1);
          }
          lineXY[o] = x0;
          lineXY[o + 1] = y0;
          lineXY[o + 2] = x1;
          lineXY[o + 3] = y1;
          linePath[nLines] = pathIdx;
          nLines++;
        };
        const addCubic = (x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number): void => {
          if (subCubics < 4) {
            const o = subCubics * 8;
            cub[o] = x0;
            cub[o + 1] = y0;
            cub[o + 2] = c1x;
            cub[o + 3] = c1y;
            cub[o + 4] = c2x;
            cub[o + 5] = c2y;
            cub[o + 6] = x1;
            cub[o + 7] = y1;
          }
          subCubics++;
          subSegs++;
          if (!cand) return;
          const chord = Math.hypot(x1 - x0, y1 - y0);
          stats.cubicChordHist[lengthBucket(chord)]!++;
          if (chord === 0) stats.cubicChordZero++;
          if (stats.cubicChordMin === null || chord < stats.cubicChordMin) stats.cubicChordMin = chord;
          if (stats.cubicChordMax === null || chord > stats.cubicChordMax) stats.cubicChordMax = chord;
          if (!vis) L.hiddenCandidateSegments++;
          const o = nCubics * 8;
          if (o + 8 > cubicXY.length) {
            cubicXY = grow32(cubicXY, o + 8);
            cubicPath = growU32(cubicPath, nCubics + 1);
          }
          cubicXY[o] = x0;
          cubicXY[o + 1] = y0;
          cubicXY[o + 2] = c1x;
          cubicXY[o + 3] = c1y;
          cubicXY[o + 4] = c2x;
          cubicXY[o + 5] = c2y;
          cubicXY[o + 6] = x1;
          cubicXY[o + 7] = y1;
          cubicPath[nCubics] = pathIdx;
          nCubics++;
        };
        const start = (x: number, y: number): void => {
          hasCur = true;
          cx = sx = x;
          cy = sy = y;
          subLines = 0;
          subCubics = 0;
          subQuads = 0;
          subClosedCmd = false;
          subSegs = 0;
          tAll.subpaths++;
          if (cand) tCand.subpaths++;
        };
        for (let k = 0; k < n; ) {
          const code = buf[k++] as number;
          if (code === DRAW_MOVE_TO) {
            endSub();
            const x = buf[k++] as number;
            const y = buf[k++] as number;
            start(ma * x + mc * y + me, mb * x + md * y + mf);
          } else if (code === DRAW_LINE_TO) {
            const x = buf[k++] as number;
            const y = buf[k++] as number;
            const tx = ma * x + mc * y + me;
            const ty = mb * x + md * y + mf;
            tAll.lineTo++;
            if (cand) tCand.lineTo++;
            if (!hasCur) {
              stats.noCurrentPoint++;
              start(tx, ty);
            } else {
              if (subClosedCmd) {
                // dopo closePath il tratto continua dal primo punto, in un nuovo sottopercorso
                endSub();
                start(sx, sy);
              }
              addLine(cx, cy, tx, ty);
              subLines++;
              cx = tx;
              cy = ty;
            }
          } else if (code === DRAW_CURVE_TO || code === DRAW_QUAD_TO) {
            const isCubic = code === DRAW_CURVE_TO;
            const x1 = buf[k++] as number;
            const y1 = buf[k++] as number;
            let x2 = 0;
            let y2 = 0;
            if (isCubic) {
              x2 = buf[k++] as number;
              y2 = buf[k++] as number;
            }
            const x = buf[k++] as number;
            const y = buf[k++] as number;
            const t1x = ma * x1 + mc * y1 + me;
            const t1y = mb * x1 + md * y1 + mf;
            const tx = ma * x + mc * y + me;
            const ty = mb * x + md * y + mf;
            if (isCubic) {
              tAll.cubic++;
              if (cand) tCand.cubic++;
            } else {
              tAll.quad++;
              if (cand) tCand.quad++;
            }
            if (!hasCur) {
              stats.noCurrentPoint++;
              start(t1x, t1y);
            } else if (subClosedCmd) {
              endSub();
              start(sx, sy);
            }
            if (isCubic) {
              const t2x = ma * x2 + mc * y2 + me;
              const t2y = mb * x2 + md * y2 + mf;
              addCubic(cx, cy, t1x, t1y, t2x, t2y, tx, ty);
            } else {
              // quadratica -> cubica esatta (grado elevato): c1 = p0 + 2/3 (q - p0), c2 = p + 2/3 (q - p)
              subQuads++;
              subSegs++;
              if (cand) {
                const c1x = cx + (2 / 3) * (t1x - cx);
                const c1y = cy + (2 / 3) * (t1y - cy);
                const c2x = tx + (2 / 3) * (t1x - tx);
                const c2y = ty + (2 / 3) * (t1y - ty);
                if (!vis) L.hiddenCandidateSegments++;
                const o = nCubics * 8;
                if (o + 8 > cubicXY.length) {
                  cubicXY = grow32(cubicXY, o + 8);
                  cubicPath = growU32(cubicPath, nCubics + 1);
                }
                cubicXY[o] = cx;
                cubicXY[o + 1] = cy;
                cubicXY[o + 2] = c1x;
                cubicXY[o + 3] = c1y;
                cubicXY[o + 4] = c2x;
                cubicXY[o + 5] = c2y;
                cubicXY[o + 6] = tx;
                cubicXY[o + 7] = ty;
                cubicPath[nCubics] = pathIdx;
                nCubics++;
              }
            }
            cx = tx;
            cy = ty;
          } else {
            // DRAW_CLOSE
            tAll.close++;
            if (cand) tCand.close++;
            if (!hasCur || subSegs === 0) {
              tAll.closeNoSegment++;
              if (cand) tCand.closeNoSegment++;
              if (hasCur) subClosedCmd = true;
              continue;
            }
            if (cx !== sx || cy !== sy) {
              addLine(cx, cy, sx, sy);
              tAll.closeSegments++;
              if (cand) tCand.closeSegments++;
              cx = sx;
              cy = sy;
            } else {
              tAll.closeNoSegment++;
              if (cand) tCand.closeNoSegment++;
            }
            subClosedCmd = true;
          }
        }
        endSub();
        break;
      }
    }
  }
  if (!stats.truncated) L.unclosedMarkers = markers.length;

  const geometry: PdfGeometry = {
    nPaths,
    pathPaint: pathPaint.slice(0, nPaths),
    pathVisible: pathVisible.slice(0, nPaths),
    nLines,
    lineXY: lineXY.slice(0, nLines * 4),
    linePath: linePath.slice(0, nLines),
    nCubics,
    cubicXY: cubicXY.slice(0, nCubics * 8),
    cubicPath: cubicPath.slice(0, nCubics),
    bytes: 0,
  };
  geometry.bytes = geometry.pathPaint.byteLength + geometry.pathVisible.byteLength + geometry.lineXY.byteLength + geometry.linePath.byteLength + geometry.cubicXY.byteLength + geometry.cubicPath.byteLength;
  return { ok: true, geometry, stats };
}
