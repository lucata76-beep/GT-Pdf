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

export type PageObject = LineObject | TextObject | DimensionObject | CoverObject;

export const isLine = (o: PageObject): o is LineObject => o.kind === 'segment' || o.kind === 'polyline';

/** Nome breve per l'annulla/ripeti e i messaggi. */
export function objectLabel(o: PageObject): string {
  switch (o.kind) {
    case 'segment':
      return 'Retta';
    case 'polyline':
      return 'Linea';
    case 'text':
      return 'Testo';
    case 'cover':
      return coverInfo(o.shape).label;
    default:
      return dimInfo(o.dim).label;
  }
}
const KIND_NOUN: Record<PageObject['kind'], string> = { segment: 'retta', polyline: 'linea', text: 'testo', dim: 'quota', cover: 'copertura' };
export const objectNoun = (o: PageObject): string => KIND_NOUN[o.kind];

/** Proprieta' di un oggetto: ognuno ha solo le sue (linea: tipo, colore, spessore; testo: colore, corpo; quota: colore, spessore, corpo; copertura: nessuna). */
export interface ObjectProps {
  style?: LineStyleId;
  color?: string;
  widthPt?: number;
  textPt?: number;
}

export function propsOf(o: PageObject): ObjectProps {
  if (isLine(o)) return { style: o.stroke.style, color: o.stroke.color, widthPt: o.stroke.widthPt };
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
  if (isLine(o)) {
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
      return [{ ...o.p1 }, { ...o.p2 }];
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
      o.p1 = at(0);
      o.p2 = at(1);
      break;
    default:
      o.p1 = at(0);
      o.p2 = at(1);
      o.a = at(2);
      o.b = at(3);
  }
}

/**
 * Ordine di disegno, dal fondo al primo piano: prima le coperture (nell'ordine di creazione), poi linee, testi e quote
 * (nell'ordine di creazione). Cosi' una copertura sta sotto tutto, anche se e' stata disegnata dopo.
 */
export function drawOrder(objects: readonly PageObject[]): PageObject[] {
  return [...objects.filter((o) => o.kind === 'cover'), ...objects.filter((o) => o.kind !== 'cover')];
}

interface PageData {
  objects: PageObject[];
  scale: PageScale | null;
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
      d = { objects: [], scale: null };
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
  /** Vero se c'e' qualcosa che andrebbe perso chiudendo il documento. */
  get hasContent(): boolean {
    return this.objectCount() > 0 || this.scaleCount() > 0;
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
  setScale(page: number, scale: PageScale | null): void {
    this.data(page).scale = scale ? { ...scale } : null;
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
  restore(pages: ReadonlyArray<{ page: number; scale: PageScale | null; objects: readonly PageObject[] }>): void {
    this.pages.clear();
    let maxId = 0;
    for (const p of pages) {
      if (p.objects.length === 0 && p.scale === null) continue;
      this.pages.set(p.page, { objects: [...p.objects], scale: p.scale ? { ...p.scale } : null });
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
