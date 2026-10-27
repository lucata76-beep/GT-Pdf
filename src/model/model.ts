// Oggetti e scala della sessione, in memoria (nessun localStorage/IndexedDB: il salvataggio .json arriva in CP5).
// Coordinate nello spazio utente PDF (pt), indipendenti dallo zoom. Si modifica solo tramite comandi (History).
import type { PageScale } from '../geometry/scale';
import type { UserPoint } from '../geometry/page';
import type { Command } from './history';
import type { Stroke } from './stroke';

/** Retta = segmento a 2 punti; Linea = spezzata a 2 o piu' punti. Stesso tipo di dati, stessa esportazione. */
export type LineKind = 'segment' | 'polyline';

export interface LineObject {
  id: number;
  kind: LineKind;
  /** Almeno 2 punti nello spazio utente PDF. */
  points: UserPoint[];
  stroke: Stroke;
}

interface PageData {
  objects: LineObject[];
  scale: PageScale | null;
}

export class DocumentModel {
  private pages = new Map<number, PageData>();
  private nextId = 1;
  private listeners = new Set<() => void>();

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

  objects(page: number): readonly LineObject[] {
    return this.pages.get(page)?.objects ?? [];
  }
  get(page: number, id: number): LineObject | undefined {
    return this.objects(page).find((o) => o.id === id);
  }
  /** L'ultimo oggetto della pagina (l'ultimo disegnato, in cima). */
  last(page: number): LineObject | undefined {
    return this.objects(page).at(-1);
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

  insert(page: number, obj: LineObject, index?: number): void {
    const list = this.data(page).objects;
    list.splice(index ?? list.length, 0, obj);
    this.emit();
  }
  /** Toglie l'oggetto e dice dove stava (per rimetterlo allo stesso posto). */
  take(page: number, id: number): { obj: LineObject; index: number } | null {
    const list = this.data(page).objects;
    const index = list.findIndex((o) => o.id === id);
    if (index < 0) return null;
    const [obj] = list.splice(index, 1);
    this.emit();
    return obj ? { obj, index } : null;
  }
  setStroke(page: number, id: number, stroke: Stroke): void {
    const o = this.get(page, id);
    if (!o) return;
    o.stroke = { ...stroke };
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

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

// ---- Comandi ----
export class AddObject implements Command<DocumentModel> {
  readonly label: string;
  constructor(
    readonly page: number,
    private readonly obj: LineObject,
  ) {
    this.label = obj.kind === 'segment' ? 'Retta' : 'Linea';
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
    private readonly obj: LineObject,
  ) {
    this.label = `Cancella ${obj.kind === 'segment' ? 'retta' : 'linea'}`;
  }
  apply(m: DocumentModel): void {
    const t = m.take(this.page, this.obj.id);
    if (t) this.index = t.index;
  }
  revert(m: DocumentModel): void {
    m.insert(this.page, this.obj, this.index >= 0 ? this.index : undefined);
  }
}

export class SetStroke implements Command<DocumentModel> {
  readonly label = 'Proprietà linea';
  constructor(
    readonly page: number,
    private readonly id: number,
    private readonly before: Stroke,
    private readonly after: Stroke,
  ) {}
  apply(m: DocumentModel): void {
    m.setStroke(this.page, this.id, this.after);
  }
  revert(m: DocumentModel): void {
    m.setStroke(this.page, this.id, this.before);
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
