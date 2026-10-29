// SHA-256 del PDF originale (i byte che l'app ha aperto, mai modificati) con `crypto.subtle.digest`: l'unica implementazione, nessun SHA-256 scritto a mano.
//
// Disponibilita': `crypto.subtle` esiste solo in un contesto sicuro (HTTPS, localhost compreso) e, secondo una fonte SECONDARIA (README di
// webcrypto-shim, letto tramite una ricerca web: MDN non e' raggiungibile dal sandbox), Safari lo ha senza prefisso dalla versione 11 con `digest` di
// SHA-256 tra le operazioni coerenti tra i browser. Su iPhone con iOS 27.2 NON VERIFICATO. Se manca o lancia, il risultato e' `null`: il chiamante salva
// `sha256: null`, lo dice, e alla riapertura lo tratta come un hash che non coincide.

export interface DigestEnv {
  subtle?: Pick<SubtleCrypto, 'digest'>;
}

const hex = (buf: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
};

/** 64 caratteri esadecimali minuscoli, o null se il browser non puo' calcolarlo. */
export async function sha256Hex(bytes: Uint8Array, env: DigestEnv = { subtle: globalThis.crypto?.subtle }): Promise<string | null> {
  const subtle = env.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  try {
    return hex(await subtle.digest('SHA-256', bytes as BufferSource));
  } catch {
    return null;
  }
}
