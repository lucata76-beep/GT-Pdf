// Scala di una pagina. Formule di DESIGN.md (verificate: 100 mm = 283.46 pt):
//   foglio_mm       = d_pt * 25.4 / 72
//   mm_reali_per_pt = L_reale_mm / d_pt
//   scala 1:N con N = L_reale_mm / foglio_mm
// Le distanze `d_pt` sono sempre in pt FISICI del foglio (1/72 in), mai pixel di schermo: la scala non dipende dallo zoom.
import { fmtTrim } from './numbers';
import { mmToPt, ptToMm } from './pixels';

export interface PageScale {
  /** mm reali per ogni pt fisico del foglio. */
  mmPerPt: number;
}

/** Distanza sul foglio in mm. */
export const sheetMm = (dPt: number): number => ptToMm(dPt);

/** Calibrazione: `dPt` pt misurati sul foglio corrispondono a `realMm` mm reali. Null se i dati non sono validi. */
export function calibrate(dPt: number, realMm: number): PageScale | null {
  if (!(dPt > 0) || !(realMm > 0) || !Number.isFinite(dPt) || !Number.isFinite(realMm)) return null;
  return { mmPerPt: realMm / dPt };
}

/** Il numero N = reale / foglio. 1 = 1:1; 50 = 1:50 (riduzione); 0.5 = ingrandimento 2:1 (vedi `scaleLabel`). */
export const scaleN = (s: PageScale): number => s.mmPerPt / ptToMm(1);

/** Lunghezza reale in mm di una distanza `dPt` sul foglio. */
export const realMm = (dPt: number, s: PageScale): number => dPt * s.mmPerPt;

/** Distanza sul foglio (pt) che corrisponde a `mm` reali. */
export const ptForRealMm = (mm: number, s: PageScale): number => mm / s.mmPerPt;

/** 100 mm sul foglio, in pt (riferimento dei PDF di prova). */
export const REFERENCE_100MM_PT = mmToPt(100);

/**
 * Etichetta della scala, con "." come separatore decimale e al massimo 2 decimali (senza zeri finali).
 * N >= 1 (riduzione): "1:N" ("1:50", "1:2.5", "1:1"). N < 1 (ingrandimento): "M:1" con M = 1 / N = foglio / reale
 * ("4.48:1" per N = 0.2234, "2:1" per N = 0.5). Il confronto con 1 e' sul valore pieno; poi si arrotonda: un valore che
 * arrotonda a 1 si scrive "1:1" da entrambe le parti (mai "1.00:1"). Solo testo: `PageScale`, quote e distanze usano
 * `mmPerPt` e non cambiano.
 */
export const scaleLabel = (s: PageScale): string => {
  const n = scaleN(s);
  return n < 1 ? `${fmtTrim(1 / n, 2)}:1` : `1:${fmtTrim(n, 2)}`;
};
