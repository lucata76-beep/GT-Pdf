// Griglia (V2a, CP6a). Logica senza DOM, nel foglio mostrato (pt fisici, /Rotate, CropBox e UserUnit gia' applicati da `PageGeometry`).
//
// - Origine: l'angolo in basso a sinistra della pagina MOSTRATA, con Y verso l'alto: come le coordinate X/Y della barra di stato.
//   Sul foglio (origine in alto a sinistra) le linee verticali stanno a x = i * passo, quelle orizzontali a y = H - j * passo.
// - Passo: in mm. Se la pagina ha una scala e' in mm REALI (in pt del foglio: `ptForRealMm`); senza scala e' in mm del FOGLIO (`mmToPt`).
//   Una ricalibrazione cambia quindi il passo in pt del foglio, non quello in mm.
// - Il punto arrotondato sta sempre dentro la pagina: l'indice si limita alle linee che ci stanno (altrimenti un clic vicino al bordo
//   verrebbe rifiutato come "fuori dalla pagina" dopo essere stato arrotondato fuori).
// - La griglia si disegna e arrotonda solo se il passo a schermo e' almeno `GRID_MIN_SCREEN_PX`; sotto e' nascosta e NON arrotonda
//   (arrotondare su una griglia che non si vede darebbe punti che il disegno non spiega).
import { mmToPt } from './pixels';
import type { PageScale } from './scale';
import { ptForRealMm } from './scale';
import type { SheetPoint } from './page';

/** Passo predefinito, in mm (reali se la pagina e' calibrata, del foglio se non lo e'). */
export const GRID_DEFAULT_MM = 10;
/** Passi predefiniti offerti nel pannello (come i valori predefiniti dello spessore), in mm. */
export const GRID_PRESETS_MM: readonly number[] = [1, 2, 5, 10, 20, 50];
/** Limiti del campo digitabile, in mm. */
export const GRID_MIN_MM = 0.1;
export const GRID_MAX_MM = 1000;

/**
 * Sotto questo passo a schermo (pixel CSS) la griglia non si disegna e non arrotonda. Valore SCELTO (non da una fonte): 8 px e' il
 * limite sotto il quale i punti a 1 px si fondono in una trama e una griglia che si vede male non aiuta a puntare. Da tarare sul PC.
 */
export const GRID_MIN_SCREEN_PX = 8;

/** Passo della griglia in pt FISICI del foglio: mm reali con la scala della pagina, altrimenti mm del foglio. */
export function gridStepPt(stepMm: number, scale: PageScale | null): number {
  return scale ? ptForRealMm(stepMm, scale) : mmToPt(stepMm);
}

/** La griglia si vede (e arrotonda) a questo zoom? `zoom` = pixel CSS per pt del foglio. */
export const gridVisible = (stepPt: number, zoom: number): boolean => stepPt > 0 && Number.isFinite(stepPt) && stepPt * zoom >= GRID_MIN_SCREEN_PX;

export type GridAxis = 'x' | 'y';

/** Arrotonda al nodo piu' vicino (tutte e due le coordinate, o una sola) senza uscire dalla pagina `[0, width] x [0, height]`. */
export function snapToGrid(p: SheetPoint, stepPt: number, size: { width: number; height: number }, only?: GridAxis): SheetPoint {
  if (!(stepPt > 0) || !Number.isFinite(stepPt)) return p;
  const maxI = Math.floor(size.width / stepPt + 1e-9);
  const maxJ = Math.floor(size.height / stepPt + 1e-9);
  const out = { x: p.x, y: p.y };
  if (only !== 'y') {
    const i = Math.min(maxI, Math.max(0, Math.round(p.x / stepPt)));
    out.x = i * stepPt;
  }
  if (only !== 'x') {
    const j = Math.min(maxJ, Math.max(0, Math.round((size.height - p.y) / stepPt)));
    out.y = size.height - j * stepPt;
  }
  return out;
}

/** Quante linee verticali (`cols`) e orizzontali (`rows`) ci sono nella pagina, compresa quella sull'origine. */
export const gridLines = (stepPt: number, size: { width: number; height: number }): { cols: number; rows: number } => ({
  cols: Math.floor(size.width / stepPt + 1e-9) + 1,
  rows: Math.floor(size.height / stepPt + 1e-9) + 1,
});
