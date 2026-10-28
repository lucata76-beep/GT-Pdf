// Consegna del PDF esportato: "Condividi" (foglio di condivisione) e "Scarica" (salva in Download).
//
// Esito di CP0 (iPhone, Safari, iOS 27.2, dichiarato dall'utente): navigator.share() con un File riesce se chiamata subito dal tocco e
// fallisce con NotAllowedError dopo 6 s; un blob application/octet-stream si salva in Download, application/pdf si apre senza salvare.
// Per questo il PDF si genera PRIMA (pulsante "Esporta", senza share) e qui `shareFile` chiama navigator.share in modo sincrono dentro il
// gestore del tocco: tra il tocco e la chiamata non c'e' nessun `await`.
//
// Nomi delle eccezioni di share(): AbortError = l'utente annulla il foglio di condivisione (o non ci sono destinazioni); NotAllowedError =
// manca l'attivazione transitoria (il gesto); TypeError = i dati non si possono condividere. Fonte: W3C Web Share API, algoritmo del metodo
// share() (bozze di lavoro 2020-2022 e editor's draft https://w3c.github.io/web-share/), come riportato da una ricerca: il testo originale
// non e' stato letto dal sandbox (rete verso w3.org bloccata). Il comportamento di Safari su iPhone alla chiusura del foglio e' NON VERIFICATO.

type ShareNavigator = Pick<Navigator, 'share' | 'canShare'> | { share?: undefined; canShare?: undefined };

/** Un File application/pdf con i byte generati (e' lui a tenere i dati: dopo si possono lasciar andare i byte). */
export const makePdfFile = (bytes: Uint8Array, name: string): File => new File([bytes as BlobPart], name, { type: 'application/pdf' });

export type ShareStatus = 'shared' | 'cancelled' | 'unavailable' | 'failed';
export interface ShareOutcome {
  status: ShareStatus;
  /** Testo per l'utente, in italiano. */
  message: string;
  /** Nome ed eccezione originali, per chi deve riferire il problema. */
  detail?: string;
}

/** Vero se il browser dice di poter condividere questo file; altrimenti il motivo, da mostrare all'utente. */
export function shareAvailability(file: File, nav: ShareNavigator = navigator): { ok: true } | { ok: false; reason: string } {
  if (typeof nav.share !== 'function') return { ok: false, reason: 'Questo browser non ha navigator.share: usa "Scarica".' };
  if (typeof nav.canShare !== 'function') return { ok: false, reason: 'Questo browser non dice se può condividere file (navigator.canShare assente): "Condividi" non è utilizzabile, usa "Scarica".' };
  let can = false;
  try {
    can = nav.canShare({ files: [file] });
  } catch (e) {
    return { ok: false, reason: `Il browser non riesce a verificare la condivisione del file (canShare ha dato errore: ${(e as { name?: string })?.name ?? 'errore'}): usa "Scarica".` };
  }
  return can ? { ok: true } : { ok: false, reason: 'Questo browser non può condividere un file PDF (canShare({files}) è falso): usa "Scarica".' };
}

const nameOf = (e: unknown): string => (e as { name?: string } | null)?.name ?? '';

/**
 * Apre il foglio di condivisione. DA CHIAMARE DIRETTAMENTE dal gestore del tocco (funzione non `async`: nessun `await` prima di share()).
 * La promessa non e' mai respinta: l'esito dice com'e' andata. L'annullamento del foglio (AbortError) NON e' un errore.
 */
export function shareFile(file: File, nav: ShareNavigator = navigator): Promise<ShareOutcome> {
  const avail = shareAvailability(file, nav);
  if (!avail.ok) return Promise.resolve({ status: 'unavailable', message: avail.reason });
  let p: Promise<void>;
  try {
    p = (nav.share as (d: ShareData) => Promise<void>)({ files: [file] });
  } catch (e) {
    return Promise.resolve(failure(e));
  }
  return p.then(
    (): ShareOutcome => ({ status: 'shared', message: 'Foglio di condivisione chiuso. Se hai scelto "Salva su File", controlla in File.' }),
    (e: unknown): ShareOutcome => (nameOf(e) === 'AbortError' ? { status: 'cancelled', message: 'Condivisione annullata.' } : failure(e)),
  );
}

function failure(e: unknown): ShareOutcome {
  const name = nameOf(e) || 'Errore';
  const msg = e instanceof Error ? e.message : String(e);
  const detail = `${name}: ${msg}`.slice(0, 200);
  if (name === 'NotAllowedError') return { status: 'failed', message: 'Il sistema non ha consentito la condivisione (il tocco non è più valido). Tocca di nuovo "Condividi", oppure usa "Scarica".', detail };
  if (name === 'TypeError') return { status: 'failed', message: 'Il sistema non può condividere questo file. Usa "Scarica".', detail };
  return { status: 'failed', message: 'La condivisione non è riuscita. Usa "Scarica".', detail };
}

/** Quanto si aspetta, dopo "Scarica", prima di revocare l'indirizzo del blob alla chiusura del dialogo (CP0: revocare subito puo' interrompere lo scarico su iOS). */
export const RELEASE_DELAY_MS = 60_000;

interface DownloadEnv {
  createObjectURL(b: Blob): string;
  revokeObjectURL(u: string): void;
  click(url: string, name: string): void;
  setTimeout(fn: () => void, ms: number): unknown;
  now(): number;
}
const browserEnv = (): DownloadEnv => ({
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  click: (url, name) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  },
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  now: () => Date.now(),
});

/**
 * Scarico via <a download> di un blob application/octet-stream (si salva in Download; application/pdf lo aprirebbe senza salvare).
 * Il blob condivide i dati del File (nessuna copia). `release()` alla chiusura del dialogo: se uno scarico e' partito da poco si attende
 * RELEASE_DELAY_MS prima di revocare l'indirizzo, altrimenti si revoca subito; poi non resta nessun riferimento ai dati.
 */
export class Download {
  private url: string | null = null;
  private startedAt = 0;
  private released = false;
  constructor(
    private file: File | null,
    private readonly env: DownloadEnv = browserEnv(),
  ) {}

  start(): void {
    if (!this.file || this.released) return;
    if (!this.url) this.url = this.env.createObjectURL(this.file.slice(0, this.file.size, 'application/octet-stream'));
    this.startedAt = this.env.now();
    this.env.click(this.url, this.file.name);
  }

  /** Indirizzo del blob se esiste (per le prove). */
  get objectUrl(): string | null {
    return this.url;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.file = null;
    const url = this.url;
    this.url = null;
    if (!url) return;
    const wait = this.startedAt + RELEASE_DELAY_MS - this.env.now();
    if (wait > 0) this.env.setTimeout(() => this.env.revokeObjectURL(url), wait);
    else this.env.revokeObjectURL(url);
  }
}
