// Corpo del testo (Testo e etichette delle quote), in pt FISICI del foglio come gli spessori delle linee.
// "Altezza testo" nell'interfaccia: e' il corpo del carattere (font size); le maiuscole di Helvetica sono alte circa 0.72 volte il corpo.

/** Corpi predefiniti, in pt. */
export const TEXT_PRESETS_PT: readonly number[] = [6, 8, 10, 12, 14, 18, 24];
export const TEXT_MIN_PT = 2;
export const TEXT_MAX_PT = 200;
/** Scelta di progetto: 10 pt (circa 3.5 mm di corpo) leggibile su A4 e A3 senza coprire il disegno. */
export const DEFAULT_TEXT_PT = 10;
