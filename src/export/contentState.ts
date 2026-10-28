// Stato grafico del contenuto originale di una pagina: serve all'esportazione per scrivere i propri oggetti SENZA ereditare
// matrice, tracciati di ritaglio o altro lasciati dal contenuto originale.
//
// pdf-lib (@cantoo/pdf-lib 2.11.1) racchiude gia' il contenuto originale tra un `q` e un `Q` (PDFPageLeaf.normalize, con
// autoNormalizeCTM = true): basta se il contenuto e' bilanciato (ogni `q` ha il suo `Q`) o non ha `q`/`Q`. Non basta se il
// contenuto lascia dei `q` aperti (il `Q` di pdf-lib chiude il `q` sbagliato) o ha dei `Q` in piu' (consumano il `q` di pdf-lib).
// `analyzeContent` simula `q`, `Q` e `cm` sulla sequenza che pdf-lib scrive (`q` + originale + `Q`) e dice quanti `Q` servono
// ancora e quale matrice (inversa) riporta il sistema di coordinate a quello della pagina.
//
// Limiti (NON coperti, vedere README): un `Q` in piu' non ripristina l'eventuale ritaglio (`W n`) che fosse rimasto attivo;
// il riconoscimento dell'immagine in linea (`BI ... ID ... EI`) usa l'euristica abituale (cerca `EI` tra spazi seguito da testo
// semplice): se non la trova l'analisi fallisce (null) e si resta con il solo `q`/`Q` di pdf-lib.

export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export interface ContentAnalysis {
  /** `Q` da scrivere dopo il `Q` di chiusura di pdf-lib per chiudere i `q` rimasti aperti dal contenuto originale. */
  closers: number;
  /** `Q` senza `q` corrispondente nel contenuto originale (i lettori li ignorano a pila vuota). */
  strayQ: number;
  /** Matrice corrente alla fine del contenuto originale, prima di qualunque chiusura (diagnostica). */
  endMatrix: Matrix;
  /** Profondita' dei `q` alla fine del contenuto originale (diagnostica). */
  endDepth: number;
  /**
   * Matrice da applicare con `cm` DOPO le chiusure per tornare alla matrice della pagina. Null se gia' e' l'identita'.
   * Diversa da null solo se un `Q` in piu' ha consumato il `q` di pdf-lib: il contenuto e' poi cambiato senza ripristino.
   */
  resetMatrix: Matrix | null;
  /** Vero se la matrice dopo le chiusure non e' invertibile: non si puo' ripristinare (resetMatrix null per forza). */
  singular: boolean;
}

/** `m` applicata per prima, poi `n` (convenzione dei vettori riga di PDF: nuova CTM = m x CTM). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const nearIdentity = (m: Matrix): boolean => m.every((v, i) => Math.abs(v - (IDENTITY[i] as number)) < 1e-9);

const isSpace = (c: number): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelimiter = (c: number): boolean => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
/** Un byte "plausibile" dopo `EI`: testo semplice (ASCII stampabile o spazio), non dati binari. */
const isPlain = (c: number): boolean => isSpace(c) || (c >= 0x20 && c < 0x7f);

interface Token {
  /** 'op' = parola chiave/operatore; 'num' = numero; 'other' = nome, stringa, delimitatore. */
  kind: 'op' | 'num' | 'other';
  text: string;
  value: number;
}

class Scanner {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}

  /** Prossimo token, o null a fine dati. Lancia un Error se un'immagine in linea non si riesce a delimitare. */
  next(): Token | null {
    const b = this.b;
    const n = b.length;
    for (;;) {
      while (this.pos < n && isSpace(b[this.pos] as number)) this.pos++;
      if (this.pos >= n) return null;
      if (b[this.pos] !== 0x25) break; // commento: fino a fine riga
      while (this.pos < n && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
    }
    const c = b[this.pos] as number;
    if (c === 0x28) {
      // stringa letterale, con parentesi annidate e escape
      let depth = 0;
      while (this.pos < n) {
        const d = b[this.pos++] as number;
        if (d === 0x5c) this.pos++;
        else if (d === 0x28) depth++;
        else if (d === 0x29 && --depth === 0) break;
      }
      return { kind: 'other', text: '(', value: 0 };
    }
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { kind: 'other', text: '<<', value: 0 };
      }
      while (this.pos < n && b[this.pos] !== 0x3e) this.pos++; // stringa esadecimale
      this.pos++;
      return { kind: 'other', text: '<', value: 0 };
    }
    if (c === 0x3e) {
      this.pos += b[this.pos + 1] === 0x3e ? 2 : 1;
      return { kind: 'other', text: '>>', value: 0 };
    }
    if (c === 0x2f) {
      this.pos++;
      while (this.pos < n && !isSpace(b[this.pos] as number) && !isDelimiter(b[this.pos] as number)) this.pos++;
      return { kind: 'other', text: '/', value: 0 };
    }
    if (isDelimiter(c)) {
      this.pos++;
      return { kind: 'other', text: String.fromCharCode(c), value: 0 };
    }
    const start = this.pos;
    while (this.pos < n && !isSpace(b[this.pos] as number) && !isDelimiter(b[this.pos] as number)) this.pos++;
    let text = '';
    for (let i = start; i < this.pos; i++) text += String.fromCharCode(b[i] as number);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { kind: 'num', text, value: Number.parseFloat(text) };
    return { kind: 'op', text, value: 0 };
  }

  /** Dopo `ID`: salta i dati dell'immagine in linea fino a dopo `EI`. */
  skipInlineImage(): void {
    const b = this.b;
    const n = b.length;
    let i = this.pos;
    if (i < n && isSpace(b[i] as number)) i++; // un solo spazio dopo ID
    for (; i + 1 < n; i++) {
      if (b[i] !== 0x45 || b[i + 1] !== 0x49) continue; // 'E' 'I'
      if (i === 0 || !isSpace(b[i - 1] as number)) continue;
      const after = b[i + 2];
      if (after !== undefined && !isSpace(after) && !isDelimiter(after)) continue;
      let plain = true;
      for (let k = i + 2; k < Math.min(n, i + 12); k++) if (!isPlain(b[k] as number)) plain = false;
      if (!plain) continue;
      this.pos = i + 2;
      return;
    }
    throw new Error('immagine in linea senza EI');
  }
}

interface Saved {
  m: Matrix;
  /** Il `q` scritto da pdf-lib prima del contenuto originale. */
  wrapper: boolean;
}

/**
 * Analizza il contenuto originale (tutti i flussi di /Contents decodificati e uniti da uno spazio) come se fosse scritto
 * tra il `q` e il `Q` di pdf-lib. Null se il contenuto non si riesce a leggere (immagine in linea non delimitabile).
 */
export function analyzeContent(content: Uint8Array): ContentAnalysis | null {
  const stack: Saved[] = [{ m: IDENTITY, wrapper: true }];
  let ctm: Matrix = IDENTITY;
  let strayQ = 0;
  const nums: number[] = [];
  const restore = (): boolean => {
    const prev = stack.pop();
    if (!prev) return false; // a pila vuota i lettori ignorano il Q: la matrice resta com'e'
    ctm = prev.m;
    return true;
  };
  try {
    const sc = new Scanner(content);
    for (let t = sc.next(); t; t = sc.next()) {
      if (t.kind === 'num') {
        nums.push(t.value);
        if (nums.length > 8) nums.shift();
        continue;
      }
      if (t.kind === 'op') {
        if (t.text === 'q') stack.push({ m: ctm, wrapper: false });
        else if (t.text === 'Q') {
          if (!restore()) strayQ++;
        } else if (t.text === 'cm') {
          if (nums.length >= 6) ctm = multiply(nums.slice(-6) as unknown as Matrix, ctm);
        } else if (t.text === 'ID') sc.skipInlineImage();
        nums.length = 0;
      }
    }
  } catch {
    return null;
  }
  const endMatrix = ctm;
  const endDepth = stack.filter((e) => !e.wrapper).length;
  restore(); // il `Q` di chiusura che scrive pdf-lib (se il `q` di pdf-lib era gia' stato consumato non fa nulla)
  const closers = stack.length;
  while (restore());
  let resetMatrix: Matrix | null = null;
  let singular = false;
  if (!nearIdentity(ctm)) {
    resetMatrix = invert(ctm);
    singular = resetMatrix === null;
  }
  return { closers, strayQ, endMatrix, endDepth, resetMatrix, singular };
}
