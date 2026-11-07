// L'angolo della Rotazione (CP6e), digitato in una casella numerica: gradi decimali con il punto, segno "-" ammesso (anche il «−» tipografico, che nessuno sa digitare
// su una tastiera italiana e non e' ambiguo), niente esponenziale, niente spazi dentro il numero. La virgola NON si accetta e da' un messaggio chiaro (non si converte
// in silenzio, come nella shell). Positivo = ANTIORARIO come si vede sul foglio. Massimo `ANGLE_MAX_DEG` in valore assoluto: il calcolo usa comunque l'angolo ridotto
// modulo 360. Zero e multipli di 360 sono numeri validi qui e li rifiuta la trasformazione ("niente da ruotare"). Logica senza DOM.
import { ANGLE_MAX_DEG } from '../geometry/transform';
import type { ShellParse } from './shell';

/** Lunghezza massima del testo digitato. */
export const ANGLE_MAX_LENGTH = 12;
export const ANGLE_COMMA_MESSAGE = 'Usa il punto per i decimali: l\'angolo è un solo numero in gradi, per esempio 30.5.';

const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const shown = (t: string): string => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

/** "30", "-45.5", ".5" -> gradi. Vuoto, virgola, spazi dentro, non numeri e valori oltre il massimo sono errori con un messaggio di una riga. */
export function parseAngle(text: string): ShellParse<number> {
  const t = text.trim().replace(/−/g, '-');
  if (t === '') return { ok: false, error: 'Digita l\'angolo in gradi (positivo = antiorario), per esempio 30 o -45.' };
  if (t.length > ANGLE_MAX_LENGTH) return { ok: false, error: `Testo troppo lungo (massimo ${ANGLE_MAX_LENGTH} caratteri).` };
  if (t.includes(',')) return { ok: false, error: ANGLE_COMMA_MESSAGE };
  if (/\s/.test(t)) return { ok: false, error: `Niente spazi dentro un numero: «${shown(t)}».` };
  if (!NUMBER_RE.test(t)) return { ok: false, error: `L'angolo non è un numero: «${shown(t)}». Esempi: 30 e -45.5 (gradi, niente esponenziale).` };
  const v = Number(t);
  if (!Number.isFinite(v) || Math.abs(v) > ANGLE_MAX_DEG) return { ok: false, error: `Angolo troppo grande: «${shown(t)}» (massimo ${ANGLE_MAX_DEG} gradi).` };
  return { ok: true, value: v === 0 ? 0 : v }; // -0 -> 0
}
