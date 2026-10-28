// "Appiattito": quali DPI sono ammessi. Decisione 4 di docs/PIANO.md: tetto di 67.108.864 pixel per canvas (`PIXEL_BUDGET`, 8192 x 8192,
// misurato su iPhone in CP0: sopra il tetto il canvas fallisce IN SILENZIO). Il calcolo usa la pagina reale (area visibile con CropBox,
// /Rotate e UserUnit, cioe' le dimensioni del foglio mostrato) di OGNI pagina che verra' rasterizzata (le sole con oggetti, decisione 21):
// un DPI e' ammesso solo se ci stanno tutte. Nessuna stima di byte o di tempo: solo pixel, che si calcolano.
import { PIXEL_BUDGET, exportPixels, fitsBudget, ptToMm } from '../geometry/pixels';

export const DPI_CHOICES = [150, 300, 600] as const;
export type Dpi = (typeof DPI_CHOICES)[number];
export type ImageFormat = 'jpeg' | 'png';

/** Una pagina che verra' rasterizzata: numero (da 1) e dimensioni del foglio mostrato in pt fisici. */
export interface RasterPage {
  page: number;
  widthPt: number;
  heightPt: number;
}

export interface PagePixels {
  page: number;
  w: number;
  h: number;
  area: number;
}

export interface DpiPlan {
  dpi: Dpi;
  /** Ammesso: tutte le pagine da rasterizzare entrano nel tetto. */
  ok: boolean;
  /** La pagina piu' grande (per pixel) a questo DPI; null se non c'e' nessuna pagina da rasterizzare. */
  largest: PagePixels | null;
  /** Se non ammesso, il motivo da mostrare all'utente (con la pagina peggiore). */
  reason: string | null;
}

/** Numero intero con il punto come separatore delle migliaia: 69605736 -> "69.605.736". */
export const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const PAPERS: readonly { name: string; w: number; h: number }[] = [
  { name: 'A0', w: 841, h: 1189 },
  { name: 'A1', w: 594, h: 841 },
  { name: 'A2', w: 420, h: 594 },
  { name: 'A3', w: 297, h: 420 },
  { name: 'A4', w: 210, h: 297 },
  { name: 'A5', w: 148, h: 210 },
];
/** Nome del formato ISO A (orientamento qualunque, tolleranza 2 mm) o null. */
export function paperName(widthPt: number, heightPt: number): string | null {
  const a = ptToMm(Math.min(widthPt, heightPt));
  const b = ptToMm(Math.max(widthPt, heightPt));
  return PAPERS.find((p) => Math.abs(p.w - a) <= 2 && Math.abs(p.h - b) <= 2)?.name ?? null;
}

/** Pixel di ogni pagina a `dpi` (come `exportPixels`: ogni lato arrotondato al pixel piu' vicino). */
export function pagePixels(pages: readonly RasterPage[], dpi: number): PagePixels[] {
  return pages.map((p) => ({ page: p.page, ...exportPixels(p.widthPt, p.heightPt, dpi) }));
}

/** Etichetta di una pagina per i messaggi: "Pagina 2 (A3)" o "Pagina 2 (420.0 x 297.0 mm)". */
export function pageLabel(p: RasterPage): string {
  const paper = paperName(p.widthPt, p.heightPt);
  const mm = `${ptToMm(p.widthPt).toFixed(1)} x ${ptToMm(p.heightPt).toFixed(1)} mm`;
  return `Pagina ${p.page} (${paper ?? mm})`;
}

/** Un piano per ogni DPI: ammesso o no, con la pagina piu' grande e il motivo. */
export function planDpi(pages: readonly RasterPage[], budget: number = PIXEL_BUDGET): DpiPlan[] {
  return DPI_CHOICES.map((dpi): DpiPlan => {
    const px = pagePixels(pages, dpi);
    let worst: PagePixels | null = null;
    for (const p of px) if (!worst || p.area > worst.area) worst = p;
    const ok = px.every((p) => fitsBudget(p.area, budget));
    const src = worst ? pages.find((p) => p.page === worst?.page) : undefined;
    return {
      dpi,
      ok,
      largest: worst,
      reason: !ok && worst && src ? `${pageLabel(src)} a ${dpi} dpi: ${fmtInt(worst.area)} px, oltre ${fmtInt(budget)}` : null,
    };
  });
}

/** Il DPI proposto all'apertura: 300 (DESIGN.md) se ammesso, altrimenti il piu' alto ammesso; null se nessuno lo e'. */
export function defaultDpi(plans: readonly DpiPlan[]): Dpi | null {
  const p300 = plans.find((p) => p.dpi === 300);
  if (p300?.ok) return 300;
  const ok = plans.filter((p) => p.ok);
  return ok.length > 0 ? (ok[ok.length - 1] as DpiPlan).dpi : null;
}

/**
 * Qualita' JPEG (0-1) di `canvas.toBlob('image/jpeg', q)`. 0.85, scelta con le misure di 5b (decisione 26 e "Misure per la decisione 5" in
 * docs/PIANO.md): a 300 dpi il PSNR contro il PNG dello stesso canvas e' di 44.0 dB (vettoriale) e 42.2 dB (scansione di prova); da 0.85 a 0.95 il file
 * cresce del 35 % (vettoriale) e del 48 % (scansione) per +1.5 e +2.5 dB. Misurato con l'encoder di Chromium: quello di Safari NON VERIFICATO.
 */
export const JPEG_QUALITY = 0.85;
