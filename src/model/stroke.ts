// Proprieta' di una linea: tipo, colore, spessore. Tutto in unita' PDF (pt del foglio), cosi' l'esportazione (CP5)
// riusa gli stessi valori e gli stessi pattern: nessuna conversione dallo schermo.

export type LineStyleId = 'solid' | 'dashdot' | 'dashed';

export interface LineStyleInfo {
  id: LineStyleId;
  label: string;
}
export const LINE_STYLES: readonly LineStyleInfo[] = [
  { id: 'solid', label: 'Continua' },
  { id: 'dashdot', label: 'Tratto-punto' },
  { id: 'dashed', label: 'Tratteggiata' },
];

export interface Stroke {
  style: LineStyleId;
  /** "#RRGGBB" maiuscolo. */
  color: string;
  /** Spessore in pt del foglio. */
  widthPt: number;
}

/** Terminazioni e giunzioni: i valori predefiniti di PDF (butt, miter, limite 10), uguali in anteprima ed esportazione. */
export const STROKE_CAP = 'butt';
export const STROKE_JOIN = 'miter';
export const STROKE_MITER_LIMIT = 10;

/**
 * Unita' dei pattern di tratteggio, in pt: lo spessore, ma mai meno di 0.5 pt, cosi' una linea sottile ha comunque
 * tratti visibili. Le proporzioni sono una scelta di progetto (NON derivate da una norma).
 */
export const MIN_PATTERN_UNIT_PT = 0.5;
export const patternUnit = (widthPt: number): number => Math.max(widthPt, MIN_PATTERN_UNIT_PT);

/**
 * Pattern di tratteggio in pt (equivale a /D [array fase] di PDF e a stroke-dasharray di SVG), in funzione dello spessore.
 * u = patternUnit(spessore):
 *   continua      -> [] (nessun tratteggio)
 *   tratteggiata  -> tratto 8u, vuoto 3u
 *   tratto-punto  -> tratto 12u, vuoto 3u, punto 1u, vuoto 3u
 * La fase e' sempre 0: il pattern parte dal primo punto della linea.
 */
export function dashPattern(style: LineStyleId, widthPt: number): number[] {
  const u = patternUnit(widthPt);
  switch (style) {
    case 'dashed':
      return [8 * u, 3 * u];
    case 'dashdot':
      return [12 * u, 3 * u, 1 * u, 3 * u];
    default:
      return [];
  }
}

// ---- Colore ----
/** Tavolozza (tutti >= 3:1 su bianco, verificato da un test con la formula WCAG). I primi quattro sono token di DESIGN.md. */
export const COLOR_PALETTE: readonly { color: string; name: string }[] = [
  { color: '#D32F2F', name: 'Rosso' },
  { color: '#1565C0', name: 'Blu' },
  { color: '#1E232A', name: 'Nero' },
  { color: '#00796B', name: 'Verde acqua' },
  { color: '#E65100', name: 'Arancio' },
  { color: '#2E7D32', name: 'Verde' },
  { color: '#6A1B9A', name: 'Viola' },
  { color: '#5A626F', name: 'Grigio' },
];

/** "#a43700" o "a43700" -> "#A43700"; altro -> null. Accetta solo 6 cifre esadecimali. */
export function parseHexColor(text: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
  return m ? `#${(m[1] as string).toUpperCase()}` : null;
}

/** Contrasto WCAG tra due colori "#RRGGBB" (rapporto di luminanza relativa, da 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- Spessore ----
/** Spessori predefiniti in pt del foglio. */
export const WIDTH_PRESETS_PT: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
export const WIDTH_MIN_PT = 0.1;
export const WIDTH_MAX_PT = 20;

/** Scelta di progetto: nuove linee rosse (colore predefinito delle quote), continue, 1 pt. */
export const DEFAULT_STROKE: Stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 };

export const strokeEquals = (a: Stroke, b: Stroke): boolean => a.style === b.style && a.color === b.color && a.widthPt === b.widthPt;
