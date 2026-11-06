// Griglia (V2a, CP6a). Logica senza DOM, nel foglio mostrato (pt fisici, /Rotate, CropBox e UserUnit gia' applicati da `PageGeometry`).
//
// - Origine: l'angolo in basso a sinistra della pagina MOSTRATA, con Y verso l'alto: come le coordinate X/Y della barra di stato.
//   Sul foglio (origine in alto a sinistra) le linee verticali stanno a x = i * passo, quelle orizzontali a y = H - j * passo.
//   CP6d: se la pagina ha un'ORIGINE (decisione 58) i nodi sono in origine + k * passo, anche a sinistra e sotto l'origine, dentro la pagina:
//   x = ox + i * passo e y = oy - j * passo con i e j interi (anche negativi). Senza origine l'origine della griglia e' (0, H) e i risultati sono
//   identici a quelli di prima (stesse espressioni, stesso arrotondamento).
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

/** Dove sta l'origine della griglia sul foglio: l'origine della pagina se c'e', altrimenti l'angolo in basso a sinistra. */
export const gridOrigin = (size: { height: number }, origin?: SheetPoint | null): SheetPoint => origin ?? { x: 0, y: size.height };

/**
 * Gli indici dei nodi che stanno dentro la pagina `[0, width] x [0, height]`: x = ox + i * passo con `iMin <= i <= iMax`, y = oy - j * passo con
 * `jMin <= j <= jMax`. Un intervallo vuoto (`iMin > iMax`) vuol dire che nessun nodo sta nella pagina in quella direzione.
 * Senza origine (ox = 0, oy = H) e' [0, floor(W / passo)] x [0, floor(H / passo)] come in V2a.
 */
export function gridIndexRange(stepPt: number, size: { width: number; height: number }, origin?: SheetPoint | null): { ox: number; oy: number; iMin: number; iMax: number; jMin: number; jMax: number } {
  const o = gridOrigin(size, origin);
  const eps = 1e-9;
  // `+ 0` normalizza -0 in 0 (Math.ceil(-0.4) e' -0)
  return {
    ox: o.x,
    oy: o.y,
    iMin: Math.ceil((0 - o.x) / stepPt - eps) + 0,
    iMax: Math.floor((size.width - o.x) / stepPt + eps),
    jMin: Math.ceil((o.y - size.height) / stepPt - eps) + 0,
    jMax: Math.floor(o.y / stepPt + eps),
  };
}

/**
 * Arrotonda al nodo piu' vicino (tutte e due le coordinate, o una sola) senza uscire dalla pagina `[0, width] x [0, height]`. Con `origin` (foglio) i nodi
 * sono in origine + k * passo; senza, in basso a sinistra. Se in una direzione nessun nodo sta nella pagina quella coordinata resta com'e'.
 */
export function snapToGrid(p: SheetPoint, stepPt: number, size: { width: number; height: number }, only?: GridAxis, origin?: SheetPoint | null): SheetPoint {
  if (!(stepPt > 0) || !Number.isFinite(stepPt)) return p;
  const r = gridIndexRange(stepPt, size, origin);
  const out = { x: p.x, y: p.y };
  if (only !== 'y' && r.iMin <= r.iMax) {
    const i = Math.min(r.iMax, Math.max(r.iMin, Math.round((p.x - r.ox) / stepPt)));
    out.x = r.ox + i * stepPt;
  }
  if (only !== 'x' && r.jMin <= r.jMax) {
    const j = Math.min(r.jMax, Math.max(r.jMin, Math.round((r.oy - p.y) / stepPt)));
    out.y = r.oy - j * stepPt;
  }
  return out;
}

/** Quante linee verticali (`cols`) e orizzontali (`rows`) ci sono nella pagina, compresa quella sull'origine (della griglia o della pagina). */
export const gridLines = (stepPt: number, size: { width: number; height: number }, origin?: SheetPoint | null): { cols: number; rows: number } => {
  const r = gridIndexRange(stepPt, size, origin);
  return { cols: Math.max(0, r.iMax - r.iMin + 1), rows: Math.max(0, r.jMax - r.jMin + 1) };
};
