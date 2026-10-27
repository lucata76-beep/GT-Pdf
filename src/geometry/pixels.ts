// Calcoli sui pixel di pagina e sul tetto dei canvas.
// Le pagine si misurano in pt PDF (1/72 in), mai in pixel di schermo.

/**
 * Tetto dei pixel per un singolo canvas di esportazione (decisione n. 4 = A, dopo la misura CP0 su iPhone):
 * 8192 x 8192. Misurato: riesce a 67,11 M px, a 69,61 M px fallisce in silenzio (pixel letto 0,0,0,0).
 * I DPI che superano il tetto vanno disabilitati; prima di ogni export si controlla comunque l'ultimo pixel (CP5).
 */
export const PIXEL_BUDGET = 67_108_864;

/**
 * Tetto dei pixel per il canvas a schermo (scelta di CP1, NON misurata nell'app reale).
 * Piu' basso di PIXEL_BUDGET: a schermo restano in memoria il canvas mostrato e quello in costruzione.
 */
export const SCREEN_PIXEL_BUDGET = 16_777_216;

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
export function fitRenderSize(widthPt: number, heightPt: number, wanted: number, budget: number = SCREEN_PIXEL_BUDGET): RenderSize {
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
