// Prove di condivisione e scarico di un PDF. Si registra cosa succede, senza concludere nulla in anticipo.
import { errText, log } from './log';

export const PDF_NAME = 'prova-gt-pdf.pdf';

type ShareNav = Navigator & { canShare?: (data?: ShareData) => boolean };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function asFile(bytes: Uint8Array, type: string): File {
  return new File([bytes as BlobPart], PDF_NAME, { type });
}

/** navigator.share con un File application/pdf. Va chiamata dentro il gestore del tocco. */
export async function shareFile(bytes: Uint8Array, label: string): Promise<void> {
  const nav = navigator as ShareNav;
  const file = asFile(bytes, 'application/pdf');
  const data: ShareData = { files: [file] };
  log(`${label}: ${bytes.length} byte, tipo ${file.type}`);
  if (typeof nav.canShare === 'function') {
    try {
      log(`${label}: canShare({files}) = ${String(nav.canShare(data))}`);
    } catch (e) {
      log(`${label}: canShare ha lanciato ${errText(e)}`, 'err');
    }
  } else {
    log(`${label}: navigator.canShare assente`, 'err');
  }
  if (typeof nav.share !== 'function') {
    log(`${label}: navigator.share assente`, 'err');
    return;
  }
  try {
    await nav.share(data);
    log(`${label}: share() risolta (foglio di condivisione chiuso senza errori)`, 'ok');
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    // AbortError = l'utente ha annullato; NotAllowedError = gesto non valido (es. scaduto).
    log(`${label}: share() ha lanciato ${errText(e)}`, name === 'AbortError' ? 'info' : 'err');
  }
}

/** Scarico via <a download>. `mime` permette di provare application/octet-stream (bug WebKit 263608). */
export function downloadFile(bytes: Uint8Array, mime: string, label: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = PDF_NAME;
  a.rel = 'noopener';
  document.body.append(a);
  log(`${label}: <a download> con blob ${mime}, ${bytes.length} byte`);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Apre il blob in una nuova scheda (comportamento da osservare). */
export function openBlob(bytes: Uint8Array, label: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const w = window.open(url, '_blank');
  log(w ? `${label}: scheda aperta` : `${label}: window.open ha restituito null (bloccata?)`, w ? 'info' : 'err');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
