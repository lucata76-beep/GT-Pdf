// Shell: la casella per digitare i punti relativi all'origine (CP6d, decisione 59 di docs/PIANO.md). Logica senza DOM.
//
// Sintassi (decisione 59): separatore ";", decimali con ".", segno "-" ammesso, spazi attorno ai valori ignorati; niente esponenziale. La virgola NON si accetta e
// da' un messaggio chiaro: non si converte in silenzio (un "10,5" letto come 10.5 o come due valori nasconderebbe un errore di battitura). Coordinate relative
// all'origine in mm: reali se la pagina ha una scala, del foglio se no (`geometry/origin`). Il raggio e' UN numero maggiore di zero, nelle stesse unita'.
// I messaggi sono di una riga (vanno nella riga di stato) e dicono che cosa fare.

/** Oltre questo valore (mm) un numero e' un errore di battitura: una pagina non e' grande 10 chilometri. */
export const SHELL_MAX_ABS_MM = 10_000_000;
/** Lunghezza massima del testo digitato. */
export const SHELL_MAX_LENGTH = 64;

export type ShellParse<T> = { ok: true; value: T } | { ok: false; error: string };

/** Il messaggio per la virgola: vale per decimali e per separatore sbagliati. */
export const COMMA_MESSAGE = 'Usa il punto per i decimali e «;» per separare X e Y.';

// un numero: segno "-" facoltativo, cifre, parte decimale facoltativa dopo il punto ("10", "-3.5", "0.25", ".5" e "10." compresi)
const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

const shown = (t: string): string => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

function parseNumber(token: string, what: string): ShellParse<number> {
  const t = token.trim();
  if (t === '') return { ok: false, error: `Manca ${what}: scrivi X;Y, per esempio 10;20.` };
  if (/\s/.test(t)) return { ok: false, error: `Niente spazi dentro un numero: «${shown(t)}».` };
  if (!NUMBER_RE.test(t)) return { ok: false, error: `${what[0]?.toUpperCase()}${what.slice(1)} non è un numero: «${shown(t)}». Esempi: 12.5 e -3 (niente esponenziale).` };
  const v = Number(t);
  if (!Number.isFinite(v) || Math.abs(v) > SHELL_MAX_ABS_MM) return { ok: false, error: `Valore troppo grande: «${shown(t)}» (massimo ${SHELL_MAX_ABS_MM} mm).` };
  return { ok: true, value: v === 0 ? 0 : v }; // -0 -> 0
}

function precheck(text: string): string | null {
  if (text.length > SHELL_MAX_LENGTH) return `Testo troppo lungo (massimo ${SHELL_MAX_LENGTH} caratteri).`;
  if (text.includes(',')) return COMMA_MESSAGE;
  return null;
}

/** "X;Y" -> le due coordinate relative (mm). */
export function parseShellPoint(text: string): ShellParse<{ x: number; y: number }> {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'Digita X;Y relative all\'origine, per esempio 10;20.' };
  const pre = precheck(t);
  if (pre) return { ok: false, error: pre };
  const parts = t.split(';');
  if (parts.length < 2) return { ok: false, error: 'Servono X e Y separati da «;», per esempio 10;20.' };
  if (parts.length > 2) return { ok: false, error: 'Troppi valori: servono solo X e Y, per esempio 10;20.' };
  const x = parseNumber(parts[0] as string, 'X');
  if (!x.ok) return x;
  const y = parseNumber(parts[1] as string, 'Y');
  if (!y.ok) return y;
  return { ok: true, value: { x: x.value, y: y.value } };
}

/** Il raggio: un numero maggiore di zero (mm). */
export function parseShellRadius(text: string): ShellParse<number> {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'Digita il raggio, un numero maggiore di zero.' };
  const pre = precheck(t);
  if (pre) return { ok: false, error: pre === COMMA_MESSAGE ? 'Usa il punto per i decimali: il raggio è un solo numero.' : pre };
  if (t.includes(';')) return { ok: false, error: 'Per il raggio serve un solo numero, maggiore di zero.' };
  const r = parseNumber(t, 'il raggio');
  if (!r.ok) return r;
  if (!(r.value > 0)) return { ok: false, error: 'Il raggio deve essere maggiore di zero.' };
  return r;
}

/** Al punto fuori dalla pagina (stessa frase del visore per un clic fuori dalla pagina). */
export const OUTSIDE_MESSAGE = 'Punto fuori dalla pagina: non inserito';
