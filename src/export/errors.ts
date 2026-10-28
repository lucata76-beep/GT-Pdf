// Errori dell'esportazione e loro testo per l'utente. Il lavoro (oggetti, scala, cronologia) non viene mai toccato dall'esportazione:
// un errore lascia tutto com'era e il dialogo resta aperto per riprovare o chiudere.

export type ExportErrorCode =
  /** La libreria di scrittura non riesce a leggere il PDF (struttura non interpretabile, intestazione assente, ...). */
  | 'unreadable'
  /** Il PDF e' cifrato con password: non previsto in questa versione. */
  | 'encrypted'
  /** PDF.js e la libreria di scrittura non vedono le stesse pagine: non si scrive nulla a occhi chiusi. */
  | 'mismatch'
  /** Errore scrivendo gli oggetti o salvando il nuovo PDF. */
  | 'write'
  /** Il file generato non supera il controllo di lettura. */
  | 'verify'
  /** Memoria esaurita. */
  | 'memory';

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  /** Pagina (da 1) a cui si riferisce l'errore, se e' di una pagina. */
  readonly page: number | undefined;
  constructor(code: ExportErrorCode, message: string, cause?: unknown, page?: number) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.page = page;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Nome e messaggio originali (in inglese: vengono dalle librerie), accorciati: servono a chi deve riferire il problema. */
export function technicalDetail(e: unknown): string {
  let name = (e as { name?: string } | null)?.name ?? 'Errore';
  // le librerie lanciano spesso `Error` semplici di una sottoclasse con nome proprio (es. PDFArrayIsNotRectangleError): il nome della classe dice di piu'
  const ctor = (e as { constructor?: { name?: string } } | null)?.constructor?.name;
  if (name === 'Error' && ctor && ctor !== 'Error') name = ctor;
  const msg = e instanceof Error ? e.message : String(e);
  const cause = (e as { cause?: unknown } | null)?.cause;
  const own = `${name}: ${msg}`;
  const full = cause !== undefined && cause !== e ? `${own} <- ${technicalDetail(cause)}` : own;
  return full.length > 260 ? `${full.slice(0, 257)}...` : full;
}

const looksEncrypted = (m: string): boolean => /is encrypted|NEEDS PASSWORD|Password incorrect|needs a password/i.test(m);
const looksOutOfMemory = (e: unknown): boolean => {
  const name = (e as { name?: string } | null)?.name;
  const msg = e instanceof Error ? e.message : String(e);
  return name === 'RangeError' && /allocation|array buffer|invalid (typed )?array length|out of memory/i.test(msg);
};

/** Classifica un'eccezione qualunque (della libreria o nostra) in un ExportError con codice. `phase` dice dove e' successo. */
export function toExportError(e: unknown, phase: 'load' | 'write' | 'verify'): ExportError {
  if (e instanceof ExportError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (looksOutOfMemory(e)) return new ExportError('memory', msg, e);
  if (looksEncrypted(msg)) return new ExportError('encrypted', msg, e);
  return new ExportError(phase === 'load' ? 'unreadable' : phase === 'verify' ? 'verify' : 'write', msg, e);
}

/** Testo per l'utente, in italiano, e dettaglio tecnico (inglese, dalle librerie). */
export function describeExportError(e: unknown): { title: string; message: string; detail: string } {
  const err = e instanceof ExportError ? e : toExportError(e, 'write');
  const safe = 'Il file originale e il tuo lavoro sono intatti: nulla è stato perso.';
  switch (err.code) {
    case 'encrypted':
      return { title: 'PDF protetto', message: `Questo PDF è protetto da password: l'esportazione non è prevista in questa versione. ${safe}`, detail: technicalDetail(err) };
    case 'unreadable':
      return {
        title: 'PDF non esportabile',
        message: `Non riesco a leggere la struttura di questo PDF${err.page ? ` (pagina ${err.page})` : ''} per scrivere il nuovo file: si apre e si vede, ma la libreria che lo riscrive non lo interpreta. ${safe}`,
        detail: technicalDetail(err),
      };
    case 'mismatch':
      return { title: 'Esportazione annullata', message: `${err.message} Non scrivo nulla a occhi chiusi. ${safe}`, detail: technicalDetail(err) };
    case 'memory':
      return { title: 'Memoria insufficiente', message: `Non c'è abbastanza memoria per esportare questo PDF su questo dispositivo. ${safe}`, detail: technicalDetail(err) };
    case 'verify':
      return {
        title: 'Controllo del file non superato',
        message: `Il PDF generato non supera il controllo di lettura (non si riapre come l'originale): non lo offro per non darti un file difettoso. ${safe}`,
        detail: technicalDetail(err),
      };
    default:
      return { title: 'Esportazione non riuscita', message: `Non sono riuscito a scrivere il nuovo PDF. ${safe}`, detail: technicalDetail(err) };
  }
}
