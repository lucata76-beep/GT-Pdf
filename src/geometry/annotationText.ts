// Testo digitato per Testo e Quota: caratteri ammessi, lunghezza, normalizzazione del decimale.
// Il testo libero resta com'e'; nel valore di una quota la virgola decimale e' normalizzata a "." (decisione 27/10/2026).
import { firstUnsupported } from './textMetrics';

export const TEXT_MAX_LENGTH = 100;
export const DIM_TEXT_MAX_LENGTH = 40;

/** "12,5" -> "12.5" (solo virgole tra due cifre); il resto non cambia. */
export const normalizeDimText = (text: string): string => text.replace(/(\d),(?=\d)/g, '$1.');

const unsupported = (ch: string): string => `Il carattere "${ch}" non si può esportare nel PDF.`;

/** Messaggio di errore per un testo libero, o null se va bene. */
export function validateFreeText(text: string): string | null {
  if (text.trim() === '') return 'Scrivi il testo.';
  if (text.length > TEXT_MAX_LENGTH) return `Massimo ${TEXT_MAX_LENGTH} caratteri.`;
  const bad = firstUnsupported(text);
  return bad === null ? null : unsupported(bad);
}

/** Messaggio di errore per il valore di una quota (testo con almeno una cifra), o null se va bene. */
export function validateDimText(text: string): string | null {
  if (text.trim() === '') return 'Digita il valore della quota.';
  if (text.length > DIM_TEXT_MAX_LENGTH) return `Massimo ${DIM_TEXT_MAX_LENGTH} caratteri.`;
  const bad = firstUnsupported(text);
  if (bad !== null) return unsupported(bad);
  if (!/\d/.test(text)) return 'Il valore deve contenere almeno una cifra.';
  return null;
}
