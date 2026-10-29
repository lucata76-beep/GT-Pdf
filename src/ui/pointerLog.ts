// Registro degli ultimi eventi puntatore del visore (CP5d): serve a vedere sul telefono se un puntatore "fantasma" resta nella mappa
// (un pointerup o un pointercancel mai arrivato), che farebbe passare da un dito a una modalita' pinch.
// Non cambia il comportamento del visore: registra soltanto.
export interface PointerLike {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
}

export class PointerLog {
  private readonly rows: string[] = [];
  private readonly t0 = performance.now();

  constructor(readonly capacity = 30) {}

  private push(text: string): void {
    this.rows.push(`${((performance.now() - this.t0) / 1000).toFixed(2)}s ${text}`);
    if (this.rows.length > this.capacity) this.rows.shift();
  }

  /** Un evento puntatore: tipo, id, tipo di puntatore, primario (P) o no (S), dimensione della mappa DOPO l'evento e id presenti. */
  note(kind: string, e: PointerLike, size: number, ids: readonly number[], extra = ''): void {
    this.push(`${kind} id=${e.pointerId} ${e.pointerType} ${e.isPrimary ? 'P' : 'S'} n=${size} [${ids.join(',')}]${extra ? ` ${extra}` : ''}`);
  }

  /** Un fatto che non e' un evento puntatore (pagina in secondo piano, mappa svuotata...). */
  mark(text: string): void {
    this.push(`· ${text}`);
  }

  get entries(): readonly string[] {
    return this.rows;
  }
}
