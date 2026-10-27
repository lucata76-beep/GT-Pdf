// Metriche dei testi: Helvetica standard del PDF (decisione 6), nessuna misura sullo schermo.
// Larghezza = somma delle larghezze dei glifi, SENZA crenatura (kerning): e' cosi' che un lettore PDF avanza il testo
// disegnato con un operatore di testo semplice, quindi il badge di una quota ha la stessa larghezza nell'app e nel PDF.
// Caratteri ammessi: ASCII stampabile e Latin-1 (160-255), che in WinAnsi hanno lo stesso codice di Unicode:
// ci sono Ø, °, ± e R. Altri caratteri verrebbero sostituiti da "?" da pdf-lib, quindi l'app li rifiuta in digitazione.
import {
  HELVETICA_ASCENDER,
  HELVETICA_DESCENDER,
  HELVETICA_FIRST_CODE,
  HELVETICA_LAST_CODE,
  HELVETICA_WIDTHS,
} from './helveticaWidths';

/** Altezza sopra la linea di base e sotto di essa, per ogni pt di corpo (ascender e descender di Helvetica). */
export const ASCENT_EM = HELVETICA_ASCENDER / 1000;
export const DESCENT_EM = -HELVETICA_DESCENDER / 1000;

const codeOf = (ch: string): number => ch.codePointAt(0) ?? -1;

/** Il carattere esiste in Helvetica/WinAnsi con lo stesso codice di Unicode. */
export function isExportableChar(ch: string): boolean {
  const c = codeOf(ch);
  return (c >= 32 && c <= 126) || (c >= 160 && c <= HELVETICA_LAST_CODE);
}

/** Primo carattere non ammesso, se c'e'. */
export function firstUnsupported(text: string): string | null {
  for (const ch of text) if (!isExportableChar(ch)) return ch;
  return null;
}

/** Larghezza di un carattere in millesimi di em; 0 per i non ammessi. */
const glyphWidth = (ch: string): number => HELVETICA_WIDTHS[codeOf(ch) - HELVETICA_FIRST_CODE] ?? 0;

/** Larghezza del testo in pt, per un corpo di `sizePt` pt. */
export function textWidthPt(text: string, sizePt: number): number {
  let w = 0;
  for (const ch of text) w += glyphWidth(ch);
  return (w * sizePt) / 1000;
}
