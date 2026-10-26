// Calcoli sui pixel di pagina e sul tetto dei canvas.
// Le pagine si misurano in pt PDF (1/72 in), mai in pixel di schermo.

/**
 * Tetto provvisorio dei pixel per un singolo canvas (decisione n. 4).
 * Sara' rivisto dopo la misura su iPhone (CP0). Unico punto di modifica.
 */
export const PIXEL_BUDGET = 16_777_216;

/** Pixel di una pagina esportata a `dpi`: ogni lato arrotondato al pixel piu' vicino. */
export function exportPixels(widthPt: number, heightPt: number, dpi: number): { w: number; h: number; area: number } {
  const w = Math.round((widthPt * dpi) / 72);
  const h = Math.round((heightPt * dpi) / 72);
  return { w, h, area: w * h };
}

export function fitsBudget(area: number, budget: number = PIXEL_BUDGET): boolean {
  return area <= budget;
}

export interface RenderSize {
  /** Pixel per pt effettivamente usati (<= richiesti). */
  scale: number;
  w: number;
  h: number;
  /** true se la scala richiesta e' stata ridotta per rispettare il tetto. */
  clamped: boolean;
}

/**
 * Dimensione del canvas per il rendering a schermo.
 * `wanted` = pixel per pt desiderati. I lati sono arrotondati per difetto,
 * cosi' w*h non supera mai `budget`.
 */
export function fitRenderSize(widthPt: number, heightPt: number, wanted: number, budget: number = PIXEL_BUDGET): RenderSize {
  const maxScale = Math.sqrt(budget / (widthPt * heightPt));
  const clamped = wanted > maxScale;
  const scale = clamped ? maxScale : wanted;
  let w = Math.max(1, Math.floor(widthPt * scale));
  let h = Math.max(1, Math.floor(heightPt * scale));
  // Con un budget minuscolo il minimo di 1 px potrebbe superarlo: impossibile in uso reale, ma restiamo coerenti.
  while (w * h > budget && (w > 1 || h > 1)) {
    if (w >= h) w -= 1;
    else h -= 1;
  }
  return { scale, w, h, clamped };
}

/** Conversioni di unita' (pt PDF, mm sul foglio). */
export const ptToMm = (pt: number): number => (pt * 25.4) / 72;
export const mmToPt = (mm: number): number => (mm * 72) / 25.4;
