// Dimensione dell'interfaccia (A-/A+): agisce sulla base `font-size` di <html> (tutto il CSS e' in rem).
// E' separata dallo zoom del documento. Il valore resta nel browser (localStorage), se disponibile.
export const UI_SIZES = [14, 16, 18, 20, 22] as const; // px
const DEFAULT_INDEX = 1;
const KEY = 'gtpdf.uiSize';

export function loadUiSize(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (Number.isInteger(v) && v >= 0 && v < UI_SIZES.length && localStorage.getItem(KEY) !== null) return v;
  } catch {
    /* localStorage non disponibile (finestra privata, dati bloccati) */
  }
  return DEFAULT_INDEX;
}

export function saveUiSize(index: number): void {
  try {
    localStorage.setItem(KEY, String(index));
  } catch {
    /* si prosegue senza memoria */
  }
}
