// Modifica del testo del tastierino, senza DOM: aggiunge un carattere o cancella l'ultimo.
// Solo in coda (niente cursore da spostare col dito): per etichette brevi basta e non serve la tastiera di sistema.
import { firstUnsupported } from '../geometry/textMetrics';

export interface EntryRules {
  maxLength: number;
  /** Quote: una virgola scritta subito dopo una cifra e' il separatore decimale e diventa "." (decisione 27/10/2026). */
  commaAfterDigitIsDecimal: boolean;
}

export interface EntryResult {
  text: string;
  /** Perche' il carattere e' stato rifiutato, se lo e'. */
  error?: string;
}

/** Aggiunge `ch` in coda. Rifiuta caratteri non esportabili e oltre la lunghezza massima. */
export function typeChar(text: string, ch: string, rules: EntryRules): EntryResult {
  let c = ch;
  if (c === ',' && rules.commaAfterDigitIsDecimal && /\d$/.test(text)) c = '.';
  const bad = firstUnsupported(c);
  if (bad !== null) return { text, error: `Il carattere "${bad}" non si può esportare nel PDF.` };
  if ([...text].length + [...c].length > rules.maxLength) return { text, error: `Massimo ${rules.maxLength} caratteri.` };
  return { text: text + c };
}

/** Toglie l'ultimo carattere (un punto di codice intero). */
export function backspace(text: string): string {
  return [...text].slice(0, -1).join('');
}

/** Simboli del layout "#$& SIMBOLI": 27 simboli e lo spazio (28 celle: 7 colonne x 4 righe). */
export const SYMBOL_KEYS: readonly string[] = [
  '#', '$', '&', '%', '@', '_', '/',
  '(', ')', '[', ']', '+', '-', '=',
  '*', '<', '>', '.', ',', ':', ';',
  '!', '?', '"', "'", '×', '²', ' ',
];

/** Lettere del layout "ABC TESTO": A-Z, maiuscole/minuscole (⇧) e spazio. */
export const LETTER_KEYS: readonly string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Tasti della riga fissa: Ø R ° ± (e ⌫, che ha la sua azione). */
export const SPECIAL_KEYS: readonly { ch: string; label: string; name: string }[] = [
  { ch: 'Ø', label: 'Ø', name: 'Diametro' },
  { ch: 'R', label: 'R', name: 'Raggio' },
  { ch: '°', label: '°', name: 'Gradi' },
  { ch: '±', label: '±', name: 'Più o meno' },
];

export const DIGIT_KEYS: readonly string[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '00'];
