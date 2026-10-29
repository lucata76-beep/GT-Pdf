// "Modifiche non salvate" (PARTE 4 di CP5c): ci sono modifiche se la versione del modello e' diversa da quella dell'ultimo salvataggio o dell'apertura.
// Si considera SALVATO quando la consegna del file progetto e' andata a buon fine per quanto l'app puo' saperlo: share() si risolve (il foglio si e' chiuso:
// non dice che il file sia arrivato in File) oppure parte lo Scarica (il click non dice se il download e' riuscito). NON VERIFICATO su iPhone.
// Esporta PDF NON conta come salvataggio del progetto.
export class SavedMark {
  private mark = 0;
  constructor(private readonly current: () => number) {}

  /** Il modello e' appena stato caricato o azzerato (apertura di un PDF o di un progetto): niente di cio' che c'e' ora e' "non salvato". */
  reset(): void {
    this.mark = this.current();
  }

  /** Il progetto e' stato consegnato: `version` e' la versione del modello al momento in cui il file e' stato generato. */
  markSaved(version: number): void {
    this.mark = version;
  }

  /** Vero se il modello e' cambiato dopo l'ultimo salvataggio o l'apertura. */
  get dirty(): boolean {
    return this.current() !== this.mark;
  }
}
