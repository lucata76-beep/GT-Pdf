// File progetto (.json): oggetti e scale di un PDF, senza il PDF (decisione 3 di docs/PIANO.md; formato e limiti: decisioni 28 e seguenti).
//
// Principi:
//  - SCRITTURA a lista bianca, tipo per tipo, scritta a mano: l'oggetto interno del modello non si serializza com'e' (un campo in piu' nel modello non
//    finisce nel file senza che qui lo si decida).
//  - LETTURA stretta: il file arriva da fuori. Si costruiscono NUOVI oggetti leggendo solo i campi della lista bianca (con `hasOwnProperty`): i campi
//    sconosciuti si ignorano senza copiarli, `__proto__`, `constructor` e simili non arrivano mai sugli oggetti. Tipi, intervalli, limiti di numero e di
//    lunghezza, colori, tipi di linea, forme, caratteri dei testi: tutto controllato, con messaggi in italiano che dicono dove ("pagina 2, oggetto 5: ...").
//  - Coordinate nello spazio utente PDF (pt), mai pixel di schermo; la scala e' `mmPerPt` a precisione piena (N e l'etichetta si ricavano).
//  - Numeri: `JSON.stringify` scrive il numero piu' breve che si rilegge identico (round-trip esatto dei double).
//  - Non si salvano: cronologia annulla/ripeti, selezione, strumento attivo, zoom, dimensione dell'interfaccia, ORTO e interruttori di snap (Estremo, Punto medio,
//    Centro) e la griglia (accesa e passo) (CP6a: stato della sessione, non del lavoro).
//  - VERSIONE (decisioni 65, 70 e 93 di docs/PIANO.md): la scrittura e' sempre versione 4; la lettura accetta 1, 2, 3 e 4. La versione 2 aggiunge i tipi 'circle' e 'arc';
//    un file di versione 1 che li contiene e' rifiutato (in 1 non esistono). La versione 3 (CP6d) aggiunge il campo di pagina `origin` ({x, y} nello spazio utente
//    oppure null, OBBLIGATORIO come `scale`): un file di versione 1 o 2 che lo contiene e' rifiutato (in 1 e 2 non esiste). La versione 4 (CP6g) aggiunge il tipo di quota
//    'angular' (oggetto 'dim' con `dim: "angular"`: stessi campi delle altre quote, nessun campo nuovo; p1 e p2 un punto per lato, a il vertice, b il punto di mezzo
//    dell'arco): un file di versione 1, 2 o 3 che lo contiene e' rifiutato (in 1-3 non esiste). Il resto del formato e' identico: un progetto salvato prima si apre
//    uguale e, riscritto, e' di versione 4 (con `origin: null` se veniva dalla 1 o dalla 2).
import { angularUserProblem } from '../geometry/angular';
import { ARC_PROBLEM_TEXT, arcProblem } from '../geometry/arc';
import { COVER_TYPES, type CoverKind } from '../geometry/cover';
import { type DimType, DIM_TYPES } from '../geometry/dimension';
import type { UserPoint } from '../geometry/page';
import type { PageScale } from '../geometry/scale';
import { DIM_TEXT_MAX_LENGTH, TEXT_MAX_LENGTH, validateDimText, validateFreeText } from '../geometry/annotationText';
import { TEXT_MAX_PT, TEXT_MIN_PT } from '../model/textStyle';
import type { ArcObject, CircleObject, CoverObject, DimensionObject, LineObject, PageObject, TextObject } from '../model/model';
import { LINE_STYLES, type LineStyleId, WIDTH_MAX_PT, WIDTH_MIN_PT, parseHexColor } from '../model/stroke';

export const PROJECT_FORMAT = 'gt-pdf-project';
/** La versione che si scrive (sempre questa). */
export const PROJECT_VERSION = 4;
/** Le versioni che si leggono. */
export const READABLE_VERSIONS: readonly number[] = [1, 2, 3, 4];
/** Il campo di pagina `origin` esiste dalla versione 3. */
const ORIGIN_SINCE = 3;
/** Il tipo di quota 'angular' esiste dalla versione 4. */
const ANGULAR_SINCE = 4;
/** Il file di versione 1 non ha cerchi e archi (introdotti dalla 2). */
const V1_KINDS = ['segment', 'polyline', 'text', 'dim', 'cover'] as const;
const V2_KINDS = [...V1_KINDS, 'circle', 'arc'] as const;

/**
 * Limiti di lettura. Scelti per essere larghi rispetto all'uso previsto (un progetto di 124 pagine con circa 2000 oggetti pesa meno di 1 MB) e stretti
 * abbastanza da non far esaurire la memoria a un file ostile o rotto: 10 volte gli oggetti dell'uso previsto, e una dimensione che con ~400 byte per
 * oggetto (una quota) lascia il doppio di margine. `JSON.parse` di 16 MiB costruisce alcune decine di MB di oggetti: sta in un iPhone (NON VERIFICATO).
 */
export const LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  pages: 10_000,
  objectsPerPage: 10_000,
  objectsTotal: 20_000,
  pointsPerLine: 2_000,
  /** Coordinate nello spazio utente PDF: una pagina di PDF arriva a 14400 pt (200 in); qui un margine largo. */
  coordAbs: 1_000_000,
  nameChars: 255,
  appChars: 64,
  /** mm reali per pt del foglio: da ingrandimenti enormi a riduzioni enormi. */
  mmPerPtMin: 1e-6,
  mmPerPtMax: 1e6,
  userUnitMax: 1_000_000,
  id: 2_147_483_647,
} as const;

export interface ProjectPdfInfo {
  name: string;
  /** Byte del PDF aperto (mai modificati). */
  size: number;
  /** SHA-256 in 64 caratteri esadecimali minuscoli, o null se il browser non ha `crypto.subtle`. */
  sha256: string | null;
}

export interface ProjectPage {
  /** Da 1, in ordine. */
  number: number;
  /** Area visibile (MediaBox ∩ CropBox) nello spazio utente e geometria: servono a controllare, alla riapertura, che la pagina sia la stessa. */
  view: [number, number, number, number];
  rotate: number;
  userUnit: number;
  scale: PageScale | null;
  /** Origine delle coordinate relative (CP6d): punto nello spazio utente, o null. */
  origin: UserPoint | null;
  /** Nell'ordine del modello (= ordine di creazione). */
  objects: PageObject[];
}

export interface Project {
  /** Versione dell'app che ha scritto il file (App > Versione): solo informativa. */
  app: string;
  pdf: ProjectPdfInfo;
  pages: ProjectPage[];
}

// ------------------------------------------------------------------------------------------------------------------------------------
// Scrittura
// ------------------------------------------------------------------------------------------------------------------------------------
const pt = (p: UserPoint): { x: number; y: number } => ({ x: p.x, y: p.y });

/** Un oggetto con i soli campi del suo tipo (lista bianca). */
export function objectToJson(o: PageObject): Record<string, unknown> {
  switch (o.kind) {
    case 'segment':
    case 'polyline':
      return { id: o.id, kind: o.kind, points: o.points.map(pt), stroke: { style: o.stroke.style, color: o.stroke.color, widthPt: o.stroke.widthPt } };
    case 'text':
      return { id: o.id, kind: 'text', at: pt(o.at), text: o.text, textPt: o.textPt, color: o.color };
    case 'dim':
      return { id: o.id, kind: 'dim', dim: o.dim, p1: pt(o.p1), p2: pt(o.p2), a: pt(o.a), b: pt(o.b), valueText: o.valueText, color: o.color, widthPt: o.widthPt, textPt: o.textPt };
    case 'cover':
      return { id: o.id, kind: 'cover', shape: o.shape, p1: pt(o.p1), p2: pt(o.p2) };
    case 'circle':
      return { id: o.id, kind: 'circle', p1: pt(o.p1), p2: pt(o.p2), stroke: { style: o.stroke.style, color: o.stroke.color, widthPt: o.stroke.widthPt } };
    case 'arc':
      return { id: o.id, kind: 'arc', p1: pt(o.p1), p2: pt(o.p2), p3: pt(o.p3), stroke: { style: o.stroke.style, color: o.stroke.color, widthPt: o.stroke.widthPt } };
  }
}

/** Il testo JSON del progetto. Un numero non finito diventerebbe `null` nel JSON: la rilettura immediata (`verifyProjectText`) lo intercetta. */
export function serializeProject(p: Project): string {
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app: p.app,
    pdf: { name: p.pdf.name, size: p.pdf.size, sha256: p.pdf.sha256 },
    pages: p.pages.map((g) => ({
      number: g.number,
      view: [g.view[0], g.view[1], g.view[2], g.view[3]],
      rotate: g.rotate,
      userUnit: g.userUnit,
      scale: g.scale ? { mmPerPt: g.scale.mmPerPt } : null,
      origin: g.origin ? pt(g.origin) : null,
      objects: g.objects.map(objectToJson),
    })),
  });
}

// ------------------------------------------------------------------------------------------------------------------------------------
// Lettura stretta
// ------------------------------------------------------------------------------------------------------------------------------------
export type ParseResult = { ok: true; project: Project; objectCount: number; scaleCount: number; originCount: number; maxId: number } | { ok: false; error: string };

class Invalid extends Error {}
const bad = (where: string, msg: string): never => {
  throw new Invalid(where ? `${where}: ${msg}` : msg);
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Legge solo proprieta' PROPRIE (mai dalla catena dei prototipi). */
const own = (o: Rec, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function num(v: unknown, where: string, what: string, min: number, max: number, unit = ''): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(where, `${what} deve essere un numero.`);
  if (v < min || v > max) return bad(where, `${what} (${v}) fuori dall'intervallo ${min}–${max}${unit}.`);
  return v;
}
function int(v: unknown, where: string, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) return bad(where, `${what} deve essere un numero intero.`);
  if (v < min || v > max) return bad(where, `${what} (${v}) fuori dall'intervallo ${min}–${max}.`);
  return v;
}
function str(v: unknown, where: string, what: string): string {
  return typeof v === 'string' ? v : bad(where, `${what} deve essere un testo.`);
}
function rec(v: unknown, where: string, what: string): Rec {
  return isRec(v) ? v : bad(where, `${what} deve essere un oggetto.`);
}
function arr(v: unknown, where: string, what: string): unknown[] {
  return Array.isArray(v) ? v : bad(where, `${what} deve essere un elenco.`);
}
function point(v: unknown, where: string, what: string): UserPoint {
  const r = rec(v, where, what);
  const c = LIMITS.coordAbs;
  return { x: num(own(r, 'x'), where, `${what}.x`, -c, c, ' pt'), y: num(own(r, 'y'), where, `${what}.y`, -c, c, ' pt') };
}
function color(v: unknown, where: string, what = 'colore'): string {
  const t = typeof v === 'string' ? parseHexColor(v) : null;
  // `parseHexColor` accetta anche senza "#": nel file il colore e' sempre "#RRGGBB"
  if (t === null || typeof v !== 'string' || !v.startsWith('#')) return bad(where, `${what} deve essere "#RRGGBB".`);
  return t;
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], where: string, what: string): T => {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) return bad(where, `${what} non valido (ammessi: ${allowed.join(', ')}).`);
  return v as T;
};

const LINE_STYLE_IDS = LINE_STYLES.map((s) => s.id) as readonly LineStyleId[];
const COVER_SHAPES = COVER_TYPES.map((c) => c.id) as readonly CoverKind[];
const DIM_KINDS = DIM_TYPES.map((d) => d.id) as readonly DimType[];

/** Il tratto di retta, linea, cerchio e arco: tipo di linea, colore, spessore. */
function readStroke(raw: unknown, where: string): LineObject['stroke'] {
  const s = rec(raw, where, 'stroke');
  return {
    style: oneOf(own(s, 'style'), LINE_STYLE_IDS, where, 'tipo di linea'),
    color: color(own(s, 'color'), where),
    widthPt: num(own(s, 'widthPt'), where, 'spessore', WIDTH_MIN_PT, WIDTH_MAX_PT, ' pt'),
  };
}

function readObject(raw: unknown, where: string, ids: Set<number>, version: number): PageObject {
  const r = rec(raw, where, 'l\'oggetto');
  const id = int(own(r, 'id'), where, 'id', 1, LIMITS.id);
  if (ids.has(id)) bad(where, `id ${id} gia' usato da un altro oggetto.`);
  ids.add(id);
  const kinds = version >= 2 ? V2_KINDS : V1_KINDS;
  const rawKind = own(r, 'kind');
  if ((rawKind === 'circle' || rawKind === 'arc') && version < 2) bad(where, `un progetto di versione ${version} non ha ${rawKind === 'circle' ? 'cerchi' : 'archi'}: sono della versione 2.`);
  const kind = oneOf(rawKind, kinds, where, 'kind');
  switch (kind) {
    case 'segment':
    case 'polyline': {
      const pts = arr(own(r, 'points'), where, 'points').map((p, i) => point(p, where, `points[${i}]`));
      if (kind === 'segment' && pts.length !== 2) bad(where, 'una retta ha esattamente 2 punti.');
      if (pts.length < 2) bad(where, 'una linea ha almeno 2 punti.');
      if (pts.length > LIMITS.pointsPerLine) bad(where, `troppi punti (${pts.length}, massimo ${LIMITS.pointsPerLine}).`);
      const o: LineObject = { id, kind, points: pts, stroke: readStroke(own(r, 'stroke'), where) };
      return o;
    }
    case 'circle': {
      const p1 = point(own(r, 'p1'), where, 'p1');
      const p2 = point(own(r, 'p2'), where, 'p2');
      if (p1.x === p2.x && p1.y === p2.y) bad(where, 'un cerchio ha il raggio maggiore di zero: p1 (centro) e p2 (punto sul bordo) coincidono.');
      const o: CircleObject = { id, kind: 'circle', p1, p2, stroke: readStroke(own(r, 'stroke'), where) };
      return o;
    }
    case 'arc': {
      const p1 = point(own(r, 'p1'), where, 'p1');
      const p2 = point(own(r, 'p2'), where, 'p2');
      const p3 = point(own(r, 'p3'), where, 'p3');
      const problem = arcProblem(p1, p2, p3);
      if (problem) bad(where, `arco non valido: ${ARC_PROBLEM_TEXT[problem]}`);
      const o: ArcObject = { id, kind: 'arc', p1, p2, p3, stroke: readStroke(own(r, 'stroke'), where) };
      return o;
    }
    case 'text': {
      const text = str(own(r, 'text'), where, 'text');
      const e = validateFreeText(text);
      if (e !== null) bad(where, `testo non valido: ${e}`);
      const o: TextObject = {
        id,
        kind: 'text',
        at: point(own(r, 'at'), where, 'at'),
        text,
        textPt: num(own(r, 'textPt'), where, 'corpo del testo', TEXT_MIN_PT, TEXT_MAX_PT, ' pt'),
        color: color(own(r, 'color'), where),
      };
      return o;
    }
    case 'dim': {
      if (own(r, 'dim') === 'angular' && version < ANGULAR_SINCE) bad(where, `un progetto di versione ${version} non ha le quote angolari: sono della versione ${ANGULAR_SINCE}.`);
      const vt = own(r, 'valueText');
      let valueText: string | null = null;
      if (vt !== null) {
        valueText = str(vt, where, 'valueText');
        const e = validateDimText(valueText);
        if (e !== null) bad(where, `valore della quota non valido: ${e}`);
      }
      const o: DimensionObject = {
        id,
        kind: 'dim',
        dim: oneOf(own(r, 'dim'), DIM_KINDS, where, 'tipo di quota'),
        p1: point(own(r, 'p1'), where, 'p1'),
        p2: point(own(r, 'p2'), where, 'p2'),
        a: point(own(r, 'a'), where, 'a'),
        b: point(own(r, 'b'), where, 'b'),
        valueText,
        color: color(own(r, 'color'), where),
        widthPt: num(own(r, 'widthPt'), where, 'spessore', WIDTH_MIN_PT, WIDTH_MAX_PT, ' pt'),
        textPt: num(own(r, 'textPt'), where, 'corpo del testo', TEXT_MIN_PT, TEXT_MAX_PT, ' pt'),
      };
      if (o.dim === 'angular') {
        const problem = angularUserProblem(o);
        if (problem !== null) bad(where, `quota angolare non valida: ${problem}`);
      }
      return o;
    }
    default: {
      const o: CoverObject = { id, kind: 'cover', shape: oneOf(own(r, 'shape'), COVER_SHAPES, where, 'forma'), p1: point(own(r, 'p1'), where, 'p1'), p2: point(own(r, 'p2'), where, 'p2') };
      return o;
    }
  }
}

/**
 * Legge e valida il testo di un file progetto. Mai eccezioni: l'esito dice se e' valido e, se no, perche' (primo errore, con la posizione).
 * Non controlla che il PDF corrisponda (`matchPages`): solo che il file sia un progetto valido.
 */
export function parseProject(text: string): ParseResult {
  try {
    return parseOrThrow(text);
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: `Il file non si puo' leggere (${e instanceof Error ? e.name : 'errore'}).` };
  }
}

function parseOrThrow(text: string): ParseResult {
  if (text.length > LIMITS.fileBytes) bad('', `Il file e' troppo grande (oltre ${LIMITS.fileBytes / 1024 / 1024} MB): non e' un progetto di GT-Pdf.`);
  if (text.trim() === '') bad('', 'Il file e\' vuoto.');
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return bad('', 'Il file non e\' un JSON valido: non e\' un progetto di GT-Pdf.');
  }
  if (!isRec(root)) return bad('', 'Il file non e\' un progetto di GT-Pdf (la radice non e\' un oggetto).');
  if (own(root, 'format') !== PROJECT_FORMAT) return bad('', `Il file non e' un progetto di GT-Pdf (manca format = "${PROJECT_FORMAT}").`);
  const version = own(root, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version)) return bad('', 'La versione del progetto non e\' un numero intero.');
  if (!READABLE_VERSIONS.includes(version)) {
    return bad('', version > PROJECT_VERSION ? `Il progetto e' di una versione piu' recente (${version}): questa app legge le versioni 1, 2, 3 e 4. Aggiorna l'app.` : `Versione del progetto ${version} non supportata: questa app legge le versioni 1, 2, 3 e 4.`);
  }
  const app = str(own(root, 'app'), '', 'app');
  if (app.length > LIMITS.appChars) bad('', `app: massimo ${LIMITS.appChars} caratteri.`);
  const pdfRaw = rec(own(root, 'pdf'), '', 'pdf');
  const name = str(own(pdfRaw, 'name'), 'pdf', 'name');
  if (name.length > LIMITS.nameChars) bad('pdf', `name: massimo ${LIMITS.nameChars} caratteri.`);
  const size = int(own(pdfRaw, 'size'), 'pdf', 'size', 0, 2 ** 40);
  const shaRaw = own(pdfRaw, 'sha256');
  let sha256: string | null = null;
  if (shaRaw !== null) {
    if (typeof shaRaw !== 'string' || !/^[0-9a-fA-F]{64}$/.test(shaRaw)) bad('pdf', 'sha256 deve essere null o 64 caratteri esadecimali.');
    sha256 = (shaRaw as string).toLowerCase();
  }
  const pagesRaw = arr(own(root, 'pages'), '', 'pages');
  if (pagesRaw.length < 1) bad('', 'Il progetto non ha pagine.');
  if (pagesRaw.length > LIMITS.pages) bad('', `Troppe pagine (${pagesRaw.length}, massimo ${LIMITS.pages}).`);

  const ids = new Set<number>();
  const pages: ProjectPage[] = [];
  let objectCount = 0;
  let scaleCount = 0;
  let originCount = 0;
  let maxId = 0;
  pagesRaw.forEach((pr, i) => {
    const where = `pagina ${i + 1}`;
    const g = rec(pr, where, 'la pagina');
    const number = int(own(g, 'number'), where, 'number', 1, LIMITS.pages);
    if (number !== i + 1) bad(where, `number deve essere ${i + 1} (le pagine sono in ordine), trovato ${number}.`);
    const c = LIMITS.coordAbs;
    const v = arr(own(g, 'view'), where, 'view');
    if (v.length !== 4) bad(where, 'view deve avere 4 numeri.');
    const view = v.map((x) => num(x, where, 'view', -c, c, ' pt')) as [number, number, number, number];
    if (!(view[2] > view[0] && view[3] > view[1])) bad(where, 'view: l\'area visibile deve avere larghezza e altezza positive.');
    const rotate = own(g, 'rotate');
    if (typeof rotate !== 'number' || ![0, 90, 180, 270].includes(rotate)) bad(where, 'rotate deve essere 0, 90, 180 o 270.');
    const userUnit = num(own(g, 'userUnit'), where, 'userUnit', 1e-6, LIMITS.userUnitMax);
    const sc = own(g, 'scale');
    if (sc === undefined) bad(where, 'manca scale (oggetto o null).');
    let scale: PageScale | null = null;
    if (sc !== null) {
      const sr = rec(sc, where, 'scale');
      scale = { mmPerPt: num(own(sr, 'mmPerPt'), where, 'scala (mmPerPt)', LIMITS.mmPerPtMin, LIMITS.mmPerPtMax) };
      scaleCount++;
    }
    // origin: dalla versione 3 e' obbligatorio (oggetto o null, come scale); in 1 e 2 non esiste e un file che lo contiene e' rifiutato
    let origin: UserPoint | null = null;
    const hasOrigin = Object.prototype.hasOwnProperty.call(g, 'origin');
    if (version < ORIGIN_SINCE) {
      if (hasOrigin) bad(where, `un progetto di versione ${version} non ha l'origine: e' della versione ${ORIGIN_SINCE}.`);
    } else {
      const og = own(g, 'origin');
      if (og === undefined) bad(where, 'manca origin (punto o null).');
      if (og !== null) {
        origin = point(og, where, 'origin');
        originCount++;
      }
    }
    const list = arr(own(g, 'objects'), where, 'objects');
    if (list.length > LIMITS.objectsPerPage) bad(where, `troppi oggetti (${list.length}, massimo ${LIMITS.objectsPerPage} per pagina).`);
    objectCount += list.length;
    if (objectCount > LIMITS.objectsTotal) bad(where, `troppi oggetti nel progetto (oltre ${LIMITS.objectsTotal}).`);
    const objects = list.map((o, k) => {
      const ob = readObject(o, `pagina ${i + 1}, oggetto ${k + 1}`, ids, version);
      if (ob.id > maxId) maxId = ob.id;
      return ob;
    });
    pages.push({ number, view, rotate: rotate as number, userUnit, scale, origin, objects });
  });
  return { ok: true, project: { app, pdf: { name, size, sha256 }, pages }, objectCount, scaleCount, originCount, maxId };
}

/**
 * Rilettura del file appena generato (stesso codice della riapertura): deve essere valido e, riscritto, dare ESATTAMENTE lo stesso testo
 * (la lettura non perde, non aggiunge e non cambia nulla). Restituisce null se tutto torna, altrimenti il motivo.
 */
export function verifyProjectText(text: string, expected: { pages: number; objects: number; scales: number; origins: number }): string | null {
  const r = parseProject(text);
  if (!r.ok) return r.error;
  if (r.project.pages.length !== expected.pages || r.objectCount !== expected.objects || r.scaleCount !== expected.scales || r.originCount !== expected.origins) {
    return `Riletto ${r.project.pages.length} pagine, ${r.objectCount} oggetti, ${r.scaleCount} scale e ${r.originCount} origini invece di ${expected.pages}, ${expected.objects}, ${expected.scales} e ${expected.origins}.`;
  }
  if (serializeProject(r.project) !== text) return 'Il file riletto e riscritto non e\' identico a quello generato.';
  return null;
}

export const TEXT_LIMITS = { free: TEXT_MAX_LENGTH, dim: DIM_TEXT_MAX_LENGTH } as const;
