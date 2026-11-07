// Oggetti e scala della sessione, in memoria (nessun localStorage/IndexedDB: il lavoro si salva con File > Salva con nome, in un file .json).
// Coordinate nello spazio utente PDF (pt), indipendenti dallo zoom. Si modifica solo tramite comandi (History).
import { type CoverDef, coverInfo } from '../geometry/cover';
import { type DimensionDef, dimInfo } from '../geometry/dimension';
import type { UserPoint } from '../geometry/page';
import type { PageScale } from '../geometry/scale';
import type { Command } from './history';
import type { LineStyleId, Stroke } from './stroke';

/** Retta = segmento a 2 punti; Linea = spezzata a 2 o piu' punti. Stesso tipo di dati, stessa esportazione. */
export type LineKind = 'segment' | 'polyline';

export interface LineObject {
  id: number;
  kind: LineKind;
  /** Almeno 2 punti nello spazio utente PDF. */
  points: UserPoint[];
  stroke: Stroke;
}

/**
 * Testo di una riga. `at` e' l'angolo in basso a sinistra della linea di base nello spazio utente (come `drawText` di PDF);
 * il testo e' sempre dritto sul foglio mostrato: la rotazione per l'esportazione e' `PageGeometry.uprightAngleDeg`.
 */
export interface TextObject {
  id: number;
  kind: 'text';
  at: UserPoint;
  /** Solo caratteri di Helvetica/WinAnsi (vedi geometry/textMetrics). */
  text: string;
  /** Corpo del carattere in pt FISICI del foglio (come gli spessori: in CP5 si divide per UserUnit). */
  textPt: number;
  color: string;
}

/**
 * Quota: punti misurati e linea di quota nello spazio utente (`DimensionDef`); frecce, linee di estensione e badge si
 * ricavano con `layoutDimension`. `valueText` null = valore automatico dalla scala della pagina (segue le ricalibrazioni);
 * altrimenti il testo digitato, mostrato com'e'. Colore e spessore valgono per linee e frecce; `textPt` e' il corpo dell'etichetta.
 */
export interface DimensionObject extends DimensionDef {
  id: number;
  kind: 'dim';
  valueText: string | null;
  color: string;
  widthPt: number;
  textPt: number;
}

/**
 * Copertura bianca (senza bordo): sta SEMPRE sotto linee, quote e testi, qualunque sia l'ordine di creazione
 * (`drawOrder`). Nessuna proprieta' modificabile. Punti e significato: vedi `geometry/cover`.
 */
export interface CoverObject extends CoverDef {
  id: number;
  kind: 'cover';
}

/**
 * Cerchio (V2b, CP6c; NON la Copertura circolare bianca): oggetto a linea con lo stesso tratto della Retta. Si salvano i punti indicati, non centro, raggio o
 * angoli (spostare = cambiare tutti i punti): `p1` e' il centro, `p2` un punto sul bordo (il raggio e' la distanza). Geometria in `geometry/arc`.
 */
export interface CircleObject {
  id: number;
  kind: 'circle';
  p1: UserPoint;
  p2: UserPoint;
  stroke: Stroke;
}

/** Arco di cerchio per tre punti: `p1` inizio, `p2` un punto sull'arco (solo di passaggio: non e' un candidato dello snap), `p3` fine. Tratto come la Retta. */
export interface ArcObject {
  id: number;
  kind: 'arc';
  p1: UserPoint;
  p2: UserPoint;
  p3: UserPoint;
  stroke: Stroke;
}

/**
 * Perche' Cerchio e Arco sono tipi a se' e non due `kind` di `LineObject`: `isLine` (retta e linea) decide disegno, snap, selezione ed esportazione di una
 * spezzata, e un cerchio che passasse da li' verrebbe disegnato e agganciato come una spezzata senza alcun errore di compilazione. Con tipi distinti
 * `tsc` segnala ogni punto che li ignora; quello che hanno in comune (il tratto) e' `hasStroke`.
 */
export type PageObject = LineObject | CircleObject | ArcObject | TextObject | DimensionObject | CoverObject;

export const isLine = (o: PageObject): o is LineObject => o.kind === 'segment' || o.kind === 'polyline';
/** Cerchio o Arco. */
export const isCurve = (o: PageObject): o is CircleObject | ArcObject => o.kind === 'circle' || o.kind === 'arc';
/** Oggetti con un tratto (tipo di linea, colore, spessore): retta, linea, cerchio, arco. */
export const hasStroke = (o: PageObject): o is LineObject | CircleObject | ArcObject => isLine(o) || isCurve(o);

/** Nome breve per l'annulla/ripeti e i messaggi. */
export function objectLabel(o: PageObject): string {
  switch (o.kind) {
    case 'segment':
      return 'Retta';
    case 'polyline':
      return 'Linea';
    case 'circle':
      return 'Cerchio';
    case 'arc':
      return 'Arco';
    case 'text':
      return 'Testo';
    case 'cover':
      return coverInfo(o.shape).label;
    default:
      return dimInfo(o.dim).label;
  }
}
const KIND_NOUN: Record<PageObject['kind'], string> = { segment: 'retta', polyline: 'linea', circle: 'cerchio', arc: 'arco', text: 'testo', dim: 'quota', cover: 'copertura' };
export const objectNoun = (o: PageObject): string => KIND_NOUN[o.kind];

/** Proprieta' di un oggetto: ognuno ha solo le sue (retta, linea, cerchio, arco: tipo, colore, spessore; testo: colore, corpo; quota: colore, spessore, corpo; copertura: nessuna). */
export interface ObjectProps {
  style?: LineStyleId;
  color?: string;
  widthPt?: number;
  textPt?: number;
}

export function propsOf(o: PageObject): ObjectProps {
  if (hasStroke(o)) return { style: o.stroke.style, color: o.stroke.color, widthPt: o.stroke.widthPt };
  if (o.kind === 'text') return { color: o.color, textPt: o.textPt };
  if (o.kind === 'cover') return {};
  return { color: o.color, widthPt: o.widthPt, textPt: o.textPt };
}

/** Le proprieta' dell'oggetto con `patch` applicato, limitato a quelle che l'oggetto ha (le altre chiavi di `patch` si ignorano). */
export function patchedProps(o: PageObject, patch: ObjectProps): ObjectProps {
  const b = propsOf(o);
  const after: ObjectProps = {};
  if (b.style !== undefined) after.style = patch.style ?? b.style;
  if (b.color !== undefined) after.color = patch.color ?? b.color;
  if (b.widthPt !== undefined) after.widthPt = patch.widthPt ?? b.widthPt;
  if (b.textPt !== undefined) after.textPt = patch.textPt ?? b.textPt;
  return after;
}

export const propsEqual = (a: ObjectProps, b: ObjectProps): boolean => a.style === b.style && a.color === b.color && a.widthPt === b.widthPt && a.textPt === b.textPt;

function assignProps(o: PageObject, p: ObjectProps): void {
  if (hasStroke(o)) {
    o.stroke = { style: p.style ?? o.stroke.style, color: p.color ?? o.stroke.color, widthPt: p.widthPt ?? o.stroke.widthPt };
    return;
  }
  if (o.kind === 'cover') return;
  if (p.color !== undefined) o.color = p.color;
  if (p.textPt !== undefined) o.textPt = p.textPt;
  if (o.kind === 'dim' && p.widthPt !== undefined) o.widthPt = p.widthPt;
}

/** I punti che definiscono la posizione dell'oggetto (copie), nell'ordine fisso del tipo: spostare = cambiarli tutti. */
export function pointsOf(o: PageObject): UserPoint[] {
  if (isLine(o)) return o.points.map((p) => ({ ...p }));
  switch (o.kind) {
    case 'text':
      return [{ ...o.at }];
    case 'cover':
    case 'circle':
      return [{ ...o.p1 }, { ...o.p2 }];
    case 'arc':
      return [{ ...o.p1 }, { ...o.p2 }, { ...o.p3 }];
    default:
      return [{ ...o.p1 }, { ...o.p2 }, { ...o.a }, { ...o.b }];
  }
}

function assignPoints(o: PageObject, pts: readonly UserPoint[]): void {
  const at = (i: number): UserPoint => ({ ...(pts[i] as UserPoint) });
  if (isLine(o)) {
    o.points = pts.map((p) => ({ ...p }));
    return;
  }
  switch (o.kind) {
    case 'text':
      o.at = at(0);
      break;
    case 'cover':
    case 'circle':
      o.p1 = at(0);
      o.p2 = at(1);
      break;
    case 'arc':
      o.p1 = at(0);
      o.p2 = at(1);
      o.p3 = at(2);
      break;
    default:
      o.p1 = at(0);
      o.p2 = at(1);
      o.a = at(2);
      o.b = at(3);
  }
}

/**
 * Una copia profonda dell'oggetto con un id nuovo e, se `pts` e' dato, questi punti al posto degli originali (stesso ordine di `pointsOf`). Proprieta' (tratto, colore,
 * corpo, valueText) e tipo restano quelli dell'originale: servono a Duplica e a "Mantieni l'originale" (CP6e).
 */
export function cloneObject(o: PageObject, id: number, pts?: readonly UserPoint[]): PageObject {
  const copy = JSON.parse(JSON.stringify(o)) as PageObject;
  copy.id = id;
  if (pts) assignPoints(copy, pts);
  return copy;
}

/**
 * Ordine di disegno, dal fondo al primo piano: prima le coperture (nell'ordine di creazione), poi linee, cerchi, archi, testi e quote
 * (nell'ordine di creazione, tutti nello stesso strato). Cosi' una copertura sta sotto tutto, anche se e' stata disegnata dopo.
 */
export function drawOrder(objects: readonly PageObject[]): PageObject[] {
  return [...objects.filter((o) => o.kind === 'cover'), ...objects.filter((o) => o.kind !== 'cover')];
}

interface PageData {
  objects: PageObject[];
  scale: PageScale | null;
  /**
   * Origine delle coordinate relative (CP6d, decisione 58): un punto nello spazio utente, o null. Come la scala e' un dato della PAGINA e non un oggetto: non si
   * seleziona, non si trascina, non si cancella con lo strumento Cancella, non entra nell'ordine di disegno e non si esporta.
   */
  origin: UserPoint | null;
}

export class DocumentModel {
  private pages = new Map<number, PageData>();
  private nextId = 1;
  private listeners = new Set<() => void>();
  private revision = 0;

  /**
   * Numero di cambiamenti dall'inizio della sessione: sale a ogni modifica (anche annulla/ripeti). Serve a dire se ci sono modifiche dall'ultimo
   * salvataggio del progetto (5c): si confronta con il valore memorizzato al salvataggio o all'apertura.
   */
  get version(): number {
    return this.revision;
  }

  private data(page: number): PageData {
    let d = this.pages.get(page);
    if (!d) {
      d = { objects: [], scale: null, origin: null };
      this.pages.set(page, d);
    }
    return d;
  }

  newId(): number {
    return this.nextId++;
  }

  objects(page: number): readonly PageObject[] {
    return this.pages.get(page)?.objects ?? [];
  }
  get(page: number, id: number): PageObject | undefined {
    return this.objects(page).find((o) => o.id === id);
  }
  scale(page: number): PageScale | null {
    return this.pages.get(page)?.scale ?? null;
  }
  /** L'origine della pagina (copia), o null. */
  origin(page: number): UserPoint | null {
    const o = this.pages.get(page)?.origin;
    return o ? { x: o.x, y: o.y } : null;
  }

  objectCount(): number {
    let n = 0;
    for (const d of this.pages.values()) n += d.objects.length;
    return n;
  }
  scaleCount(): number {
    let n = 0;
    for (const d of this.pages.values()) if (d.scale) n++;
    return n;
  }
  originCount(): number {
    let n = 0;
    for (const d of this.pages.values()) if (d.origin) n++;
    return n;
  }
  /** Vero se c'e' qualcosa che andrebbe perso chiudendo il documento: oggetti, scale e origini (anche la sola origine chiede conferma, come la sola scala). */
  get hasContent(): boolean {
    return this.objectCount() > 0 || this.scaleCount() > 0 || this.originCount() > 0;
  }

  insert(page: number, obj: PageObject, index?: number): void {
    const list = this.data(page).objects;
    list.splice(index ?? list.length, 0, obj);
    this.emit();
  }
  /** Toglie l'oggetto e dice dove stava (per rimetterlo allo stesso posto). */
  take(page: number, id: number): { obj: PageObject; index: number } | null {
    const list = this.data(page).objects;
    const index = list.findIndex((o) => o.id === id);
    if (index < 0) return null;
    const [obj] = list.splice(index, 1);
    this.emit();
    return obj ? { obj, index } : null;
  }
  setProps(page: number, id: number, props: ObjectProps): void {
    const o = this.get(page, id);
    if (!o) return;
    assignProps(o, props);
    this.emit();
  }
  setPoints(page: number, id: number, pts: readonly UserPoint[]): void {
    const o = this.get(page, id);
    if (!o) return;
    assignPoints(o, pts);
    this.emit();
  }
  /**
   * Sostituisce i punti di piu' oggetti con UN SOLO cambiamento (un `emit`, una salita di `revision`): le trasformazioni di CP6e. Gli id che non ci sono si ignorano.
   * Indicizza una volta gli oggetti della pagina: il costo e' lineare nel numero di oggetti e non quadratico.
   */
  setPointsMany(page: number, entries: ReadonlyArray<{ id: number; pts: readonly UserPoint[] }>): void {
    const byId = new Map<number, PageObject>();
    for (const o of this.objects(page)) byId.set(o.id, o);
    for (const e of entries) {
      const o = byId.get(e.id);
      if (o) assignPoints(o, e.pts);
    }
    this.emit();
  }
  /** Aggiunge piu' oggetti in fondo all'elenco (nell'ordine dato) con un solo cambiamento. */
  insertMany(page: number, objs: readonly PageObject[]): void {
    this.data(page).objects.push(...objs);
    this.emit();
  }
  /** Toglie piu' oggetti con un solo cambiamento e dice dove stava ciascuno (indici nell'elenco di PRIMA, in ordine crescente), per rimetterli al loro posto. */
  takeMany(page: number, ids: readonly number[]): { obj: PageObject; index: number }[] {
    const d = this.data(page);
    const want = new Set(ids);
    const taken: { obj: PageObject; index: number }[] = [];
    const kept: PageObject[] = [];
    d.objects.forEach((o, index) => {
      if (want.has(o.id)) taken.push({ obj: o, index });
      else kept.push(o);
    });
    d.objects = kept;
    this.emit();
    return taken;
  }
  /**
   * Rimette piu' oggetti ciascuno al suo indice (quelli restituiti da `takeMany`), con un solo cambiamento. Costo lineare: ricostruisce l'elenco una volta sola.
   * Gli indici sono quelli dell'elenco di prima della cancellazione; l'elenco attuale deve essere quello di subito dopo (la cronologia e' lineare).
   */
  insertAt(page: number, entries: ReadonlyArray<{ obj: PageObject; index: number }>): void {
    const d = this.data(page);
    const sorted = [...entries].sort((a, b) => a.index - b.index);
    const out: PageObject[] = [];
    let k = 0;
    let rest = 0;
    const total = d.objects.length + sorted.length;
    for (let pos = 0; pos < total; pos++) {
      const e = sorted[k];
      if (e && e.index === pos) {
        out.push(e.obj);
        k++;
      } else if (rest < d.objects.length) out.push(d.objects[rest++] as PageObject);
      else if (e) {
        out.push(e.obj); // indice oltre la fine: in fondo
        k++;
      }
    }
    d.objects = out;
    this.emit();
  }
  setScale(page: number, scale: PageScale | null): void {
    this.data(page).scale = scale ? { ...scale } : null;
    this.emit();
  }
  setOrigin(page: number, origin: UserPoint | null): void {
    this.data(page).origin = origin ? { x: origin.x, y: origin.y } : null;
    this.emit();
  }

  clear(): void {
    this.pages.clear();
    this.emit();
  }

  /**
   * Sostituisce tutto il contenuto con quello di un progetto letto da file (gia' validato). Un solo cambiamento. Il prossimo id diventa maggiore
   * del massimo letto (e mai minore di quello in uso: gli id non si riusano in una sessione).
   */
  restore(pages: ReadonlyArray<{ page: number; scale: PageScale | null; origin?: UserPoint | null; objects: readonly PageObject[] }>): void {
    this.pages.clear();
    let maxId = 0;
    for (const p of pages) {
      const origin = p.origin ?? null;
      if (p.objects.length === 0 && p.scale === null && origin === null) continue; // una pagina con la sola origine si tiene
      this.pages.set(p.page, { objects: [...p.objects], scale: p.scale ? { ...p.scale } : null, origin: origin ? { x: origin.x, y: origin.y } : null });
      for (const o of p.objects) if (o.id > maxId) maxId = o.id;
    }
    this.nextId = Math.max(this.nextId, maxId + 1);
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}

// ---- Comandi ----
export class AddObject implements Command<DocumentModel> {
  readonly label: string;
  constructor(
    readonly page: number,
    private readonly obj: PageObject,
  ) {
    this.label = objectLabel(obj);
  }
  apply(m: DocumentModel): void {
    m.insert(this.page, this.obj);
  }
  revert(m: DocumentModel): void {
    m.take(this.page, this.obj.id);
  }
}

export class RemoveObject implements Command<DocumentModel> {
  readonly label: string;
  private index = -1;
  constructor(
    readonly page: number,
    private readonly obj: PageObject,
  ) {
    this.label = `Cancella ${objectNoun(obj)}`;
  }
  apply(m: DocumentModel): void {
    const t = m.take(this.page, this.obj.id);
    if (t) this.index = t.index;
  }
  revert(m: DocumentModel): void {
    m.insert(this.page, this.obj, this.index >= 0 ? this.index : undefined);
  }
}

export class SetProps implements Command<DocumentModel> {
  readonly label = 'Proprietà oggetto';
  constructor(
    readonly page: number,
    private readonly id: number,
    private readonly before: ObjectProps,
    private readonly after: ObjectProps,
  ) {}
  apply(m: DocumentModel): void {
    m.setProps(this.page, this.id, this.after);
  }
  revert(m: DocumentModel): void {
    m.setProps(this.page, this.id, this.before);
  }
}

/** Sposta un oggetto: sostituisce tutti i suoi punti (prima/dopo salvati, cosi' annulla e ripeti sono esatti). */
export class MoveObject implements Command<DocumentModel> {
  readonly label: string;
  private readonly id: number;
  private readonly before: UserPoint[];
  private readonly after: UserPoint[];
  constructor(
    readonly page: number,
    obj: PageObject,
    dx: number,
    dy: number,
  ) {
    this.id = obj.id;
    this.label = `Sposta ${objectNoun(obj)}`;
    this.before = pointsOf(obj);
    this.after = this.before.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  apply(m: DocumentModel): void {
    m.setPoints(this.page, this.id, this.after);
  }
  revert(m: DocumentModel): void {
    m.setPoints(this.page, this.id, this.before);
  }
}

/** Quello che cambia per un oggetto in una trasformazione: i suoi punti prima e dopo (valori ESATTI, cosi' Annulla restituisce quelli di prima). */
export interface PointChange {
  id: number;
  before: readonly UserPoint[];
  after: readonly UserPoint[];
}

/** Il testo "retta" / "3 oggetti" per le etichette dei comandi su piu' oggetti. */
export const countLabel = (objs: readonly PageObject[]): string => (objs.length === 1 ? objectNoun(objs[0] as PageObject) : `${objs.length} oggetti`);

/**
 * Trasformazione di N oggetti (CP6e): UN comando = UN passo di Annulla e di Ripeti e UN solo cambiamento del modello, qualunque sia N. Come `MoveObject` salva i punti
 * prima e dopo, quindi Annulla e Ripeti sono esatti. `label` lo sceglie l'app ("Sposta 3 oggetti", "Specchia retta").
 */
export class TransformObjects implements Command<DocumentModel> {
  constructor(
    readonly page: number,
    readonly label: string,
    private readonly changes: readonly PointChange[],
  ) {}
  apply(m: DocumentModel): void {
    m.setPointsMany(
      this.page,
      this.changes.map((c) => ({ id: c.id, pts: c.after })),
    );
  }
  revert(m: DocumentModel): void {
    m.setPointsMany(
      this.page,
      this.changes.map((c) => ({ id: c.id, pts: c.before })),
    );
  }
}

/**
 * Aggiunta di N oggetti gia' costruiti (le copie di CP6e): gli id sono assegnati UNA volta, alla creazione del comando (`model.newId()`), non in `apply`, cosi' Ripeti
 * reinserisce gli STESSI oggetti con gli stessi id. Vanno in fondo all'elenco nell'ordine dato.
 */
export class AddObjects implements Command<DocumentModel> {
  constructor(
    readonly page: number,
    readonly label: string,
    private readonly objs: readonly PageObject[],
  ) {}
  apply(m: DocumentModel): void {
    m.insertMany(this.page, this.objs);
  }
  revert(m: DocumentModel): void {
    m.takeMany(
      this.page,
      this.objs.map((o) => o.id),
    );
  }
}

/** Cancellazione di N oggetti (Canc con una selezione multipla): un solo passo di Annulla, che li rimette ognuno al suo posto nell'elenco. */
export class RemoveObjects implements Command<DocumentModel> {
  readonly label: string;
  private entries: { obj: PageObject; index: number }[] = [];
  constructor(
    readonly page: number,
    private readonly objs: readonly PageObject[],
  ) {
    this.label = `Cancella ${countLabel(objs)}`;
  }
  apply(m: DocumentModel): void {
    this.entries = m.takeMany(
      this.page,
      this.objs.map((o) => o.id),
    );
  }
  revert(m: DocumentModel): void {
    m.insertAt(this.page, this.entries);
  }
}

export class SetScale implements Command<DocumentModel> {
  readonly label = 'Scala';
  constructor(
    readonly page: number,
    private readonly before: PageScale | null,
    private readonly after: PageScale,
  ) {}
  apply(m: DocumentModel): void {
    m.setScale(this.page, this.after);
  }
  revert(m: DocumentModel): void {
    m.setScale(this.page, this.before);
  }
}

/** Imposta, sposta o toglie l'origine di una pagina (CP6d): un solo passo di Annulla e di Ripeti per ogni cambio. */
export class SetOrigin implements Command<DocumentModel> {
  readonly label: string;
  constructor(
    readonly page: number,
    private readonly before: UserPoint | null,
    private readonly after: UserPoint | null,
  ) {
    this.label = after === null ? 'Rimuovi origine' : before === null ? 'Imposta origine' : 'Sposta origine';
  }
  apply(m: DocumentModel): void {
    m.setOrigin(this.page, this.after);
  }
  revert(m: DocumentModel): void {
    m.setOrigin(this.page, this.before);
  }
}
