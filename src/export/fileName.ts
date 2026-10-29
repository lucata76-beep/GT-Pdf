// Nome del file esportato (decisione 22 di docs/PIANO.md): <nome originale senza ".pdf">-quotato.pdf; del progetto: <nome originale senza ".pdf">.json.
// Il ".pdf" finale si toglie con qualunque maiuscola (".PDF", ".Pdf"); il resto del nome resta com'e' (spazi, accenti, punti, forma
// Unicode): si cambiano solo i caratteri che un nome di file non puo' contenere ("/" e "\" e i caratteri di controllo).

/** Parte fissa aggiunta al nome originale, prima di ".pdf". */
export const EXPORT_SUFFIX = '-quotato';
/** Nome usato se dell'originale resta il nulla (es. ".pdf"). */
export const FALLBACK_BASE = 'documento';
/** Lunghezza massima del nome base, in caratteri (i file system arrivano a 255 byte UTF-8: qui si resta largamente sotto). */
const MAX_BASE_CHARS = 120;

/** Nome base comune ai file che l'app produce: stesse regole per il PDF esportato e per il progetto. */
function baseName(originalName: string): string {
  let base = originalName.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '');
  base = base.replace(/\.pdf$/i, '');
  if (base.trim() === '') base = FALLBACK_BASE;
  const chars = [...base]; // per code point: non si spezza un carattere fuori dal piano base
  if (chars.length > MAX_BASE_CHARS) base = chars.slice(0, MAX_BASE_CHARS).join('');
  return base;
}

export function exportFileName(originalName: string): string {
  return `${baseName(originalName)}${EXPORT_SUFFIX}.pdf`;
}

/** Nome del file progetto (5c, decisione 22): <nome del PDF senza ".pdf">.json, con le stesse regole di `exportFileName` (niente "-quotato"). */
export function projectFileName(pdfName: string): string {
  return `${baseName(pdfName)}.json`;
}
