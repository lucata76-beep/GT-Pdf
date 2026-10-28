// Controllo dell'ultimo pixel (decisione 4 di docs/PIANO.md). Esito di CP0 su iPhone (Safari, iOS 27.2): sopra il limite un canvas
// NON lancia nessuna eccezione e `getContext` funziona, ma il canvas e' vuoto: il pixel scritto si rilegge come (0, 0, 0, 0).
// CP0 non ha distinto un limite sull'area da un limite sul lato (provati solo canvas quadrati/rettangoli fino a 8192 x 8192).
// Per questo il controllo NON assume nessuna regola: si scrive un pixel opaco di un colore preciso nell'angolo estremo (ultima colonna,
// ultima riga: se fallisce la larghezza, l'altezza o l'area, e' li' che manca la memoria) e si rilegge. Se non torna, si ferma.

export interface PixelProbeContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

/** Colore opaco di prova (non e' ne' bianco ne' nero: un canvas vuoto o riempito di bianco non lo puo' restituire). */
export const PROBE_RGB: readonly [number, number, number] = [18, 52, 86];
export const PROBE_CSS = `rgb(${PROBE_RGB.join(',')})`;

export type PixelCheck = { ok: true } | { ok: false; read: number[]; error: string | null };

/** Scrive il pixel di prova nell'angolo (w-1, h-1) e lo rilegge. Lascia quel pixel colorato: il chiamante poi riempie il canvas. */
export function checkLastPixel(ctx: PixelProbeContext, w: number, h: number): PixelCheck {
  try {
    ctx.fillStyle = PROBE_CSS;
    ctx.fillRect(w - 1, h - 1, 1, 1);
    const d = ctx.getImageData(w - 1, h - 1, 1, 1).data;
    const read = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
    const ok = read[0] === PROBE_RGB[0] && read[1] === PROBE_RGB[1] && read[2] === PROBE_RGB[2] && read[3] === 255;
    return ok ? { ok: true } : { ok: false, read, error: null };
  } catch (e) {
    return { ok: false, read: [], error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
