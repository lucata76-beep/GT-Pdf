// Annulla/ripeti con il pattern command. Ogni azione e' un comando con `apply` (esegui e ripeti) e `revert` (annulla).
// Dopo una nuova azione la pila "ripeti" si azzera.

export interface Command<M> {
  /** Testo per la barra di stato (es. "Linea"). */
  readonly label: string;
  /** Pagina interessata (da 1): l'app la mostra dopo un annulla/ripeti. */
  readonly page: number;
  apply(model: M): void;
  revert(model: M): void;
}

export class History<M> {
  private undoStack: Command<M>[] = [];
  private redoStack: Command<M>[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly model: M) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Etichette dei prossimi comandi da annullare / ripetere (per i suggerimenti). */
  get nextUndo(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get nextRedo(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Esegue un nuovo comando: lo mette nella pila e azzera "ripeti". */
  exec(cmd: Command<M>): void {
    cmd.apply(this.model);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.emit();
  }

  undo(): Command<M> | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.revert(this.model);
    this.redoStack.push(cmd);
    this.emit();
    return cmd;
  }

  redo(): Command<M> | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply(this.model);
    this.undoStack.push(cmd);
    this.emit();
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
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
