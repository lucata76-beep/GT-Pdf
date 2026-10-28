// Messaggi per l'utente quando PDF.js non riesce ad aprire un file. PDF.js lancia eccezioni con nome (`InvalidPDFException`,
// `PasswordException`, ...) e messaggio in inglese; qui si traducono i casi riconosciuti e si lascia il testo originale come dettaglio.

export interface OpenErrorText {
  /** Frase per l'utente, in italiano. */
  message: string;
  /** Nome e messaggio originali (inglese, dalla libreria), per chi deve riferire il problema. */
  detail: string;
}

export function describeOpenError(name: string, e: unknown): OpenErrorText {
  const exName = (e as { name?: string } | null)?.name ?? 'Errore';
  const msg = e instanceof Error ? e.message : String(e);
  const detail = `${exName}: ${msg}`.slice(0, 200);
  if (exName === 'PasswordException') return { message: `${name}: il file richiede una password; i PDF protetti non sono previsti in questa versione.`, detail };
  if (exName === 'InvalidPDFException') {
    if (/empty|zero bytes/i.test(msg)) return { message: `${name}: il file è vuoto (0 byte).`, detail };
    return { message: `${name}: non è un PDF valido oppure è danneggiato o incompleto (per esempio troncato durante la copia o il download). Prova a copiarlo di nuovo da iCloud o dalla sorgente.`, detail };
  }
  if (exName === 'MissingPDFException') return { message: `${name}: il file non si trova più. Riprova a sceglierlo.`, detail };
  return { message: `${name}: non riesco ad aprire questo file.`, detail };
}
