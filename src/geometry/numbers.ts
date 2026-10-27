// Numeri: mostrati sempre con "." (nessun separatore delle migliaia). In digitazione si accetta anche ","
// e si normalizza a ".". Input non valido: rifiutato, con un messaggio.

export type ParsedNumber = { ok: true; value: number; text: string } | { ok: false; reason: string };

// Solo cifre con al massimo un separatore decimale ("." o ","), segno facoltativo. Niente esponenti, spazi interni, migliaia.
const DECIMAL = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/** "12,5" -> 12.5; "12.5" -> 12.5; "abc", "", "1.2.3", "1e5", "1,000.5" -> rifiutati. `text` e' la forma normalizzata con ".". */
export function parseDecimal(input: string): ParsedNumber {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'Inserisci un numero.' };
  if (!DECIMAL.test(raw)) return { ok: false, reason: `"${raw}" non è un numero valido: usa solo cifre e un separatore decimale (. o ,).` };
  const text = raw.replace(',', '.');
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${raw}" non è un numero valido.` };
  return { ok: true, value, text };
}

/** Numero positivo (> 0), eventualmente entro [min, max]. */
export function parsePositive(input: string, opts: { min?: number; max?: number; what: string }): ParsedNumber {
  const r = parseDecimal(input);
  if (!r.ok) return r;
  if (r.value <= 0) return { ok: false, reason: `${opts.what}: il valore deve essere maggiore di 0.` };
  if (opts.min !== undefined && r.value < opts.min) return { ok: false, reason: `${opts.what}: il valore minimo è ${fmtTrim(opts.min)}.` };
  if (opts.max !== undefined && r.value > opts.max) return { ok: false, reason: `${opts.what}: il valore massimo è ${fmtTrim(opts.max)}.` };
  return r;
}

/** Formato di visualizzazione: sempre ".", `decimals` cifre decimali, mai "-0.00". */
export function fmt(n: number, decimals = 2): string {
  const s = n.toFixed(decimals);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** Come `fmt` ma senza zeri finali inutili (es. 2.5, 50, 0.25). */
export function fmtTrim(n: number, maxDecimals = 2): string {
  const s = fmt(n, maxDecimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Con segno esplicito (+/-) per le differenze. */
export function fmtSigned(n: number, decimals = 2): string {
  const s = fmt(n, decimals);
  return s.startsWith('-') || Number(s) === 0 ? s : `+${s}`;
}
