import { describe, expect, it } from 'vitest';
import { IDENTITY, type Matrix, analyzeContent, invert, multiply } from './contentState';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const an = (s: string) => analyzeContent(enc(s));
const approx = (m: Matrix | null, e: readonly number[]): void => {
  expect(m).not.toBeNull();
  (m as Matrix).forEach((v, i) => expect(v).toBeCloseTo(e[i] as number, 9));
};

describe('multiply / invert', () => {
  it('moltiplica con la convenzione di PDF: m per primo, poi n', () => {
    // scala 2 e poi traslazione (10, 5): il punto (1, 1) va in (2,2) e poi (12, 7)
    const m = multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 10, 5]);
    expect([m[0] * 1 + m[2] * 1 + m[4], m[1] * 1 + m[3] * 1 + m[5]]).toEqual([12, 7]);
  });
  it('l\'inversa riporta all\'identita\'', () => {
    const m: Matrix = [0.5, 0.1, -0.2, 2, 30, -40];
    const inv = invert(m) as Matrix;
    approx(multiply(m, inv), IDENTITY);
  });
  it('una matrice singolare non ha inversa', () => {
    expect(invert([1, 0, 0, 0, 5, 5])).toBeNull();
  });
});

describe('analyzeContent', () => {
  it('contenuto vuoto: niente da chiudere, niente da ripristinare', () => {
    const a = an('');
    expect(a).toMatchObject({ closers: 0, strayQ: 0, endDepth: 0, resetMatrix: null });
  });

  it('contenuto bilanciato: nessun Q in piu\'', () => {
    const a = an('q 0.5 0 0 0.5 10 10 cm 0 0 100 100 re f Q q 1 0 0 1 5 5 cm Q');
    expect(a).toMatchObject({ closers: 0, strayQ: 0, endDepth: 0, resetMatrix: null });
    approx(a?.endMatrix ?? null, IDENTITY);
  });

  it('matrice lasciata a fine contenuto senza q: la ripristina il Q di pdf-lib, nulla da aggiungere', () => {
    const a = an('1 0 0 -1 0 842 cm 0 0 100 100 re f 0.5 0 0 0.5 0 0 cm');
    expect(a).toMatchObject({ closers: 0, strayQ: 0, endDepth: 0, resetMatrix: null });
    // alla fine del contenuto la matrice NON era l'identita' (e' proprio il caso da coprire)
    approx(a?.endMatrix ?? null, multiply([0.5, 0, 0, 0.5, 0, 0], [1, 0, 0, -1, 0, 842]));
    expect(a?.endMatrix).not.toEqual(IDENTITY);
  });

  it('q rimasto aperto dopo una cm: il Q di pdf-lib chiude il q sbagliato, serve un Q in piu\'', () => {
    const a = an('0.5 0 0 0.5 10 10 cm q 2 0 0 2 0 0 cm 0 0 10 10 re f');
    expect(a).toMatchObject({ closers: 1, strayQ: 0, endDepth: 1, resetMatrix: null });
  });

  it('piu\' q aperti: il Q di pdf-lib ne chiude uno, ne servono altri 3 (2 q aperti + il suo)', () => {
    expect(an('q q q 3 0 0 3 0 0 cm')).toMatchObject({ closers: 3, endDepth: 3, resetMatrix: null });
  });

  it('Q in piu\': consuma il q di pdf-lib, poi la matrice cambia: serve la matrice inversa', () => {
    const a = an('Q Q 2 0 0 2 0 0 cm');
    expect(a).toMatchObject({ strayQ: 1, closers: 0 });
    approx(a?.resetMatrix ?? null, [0.5, 0, 0, 0.5, 0, 0]);
  });

  it('Q in piu\' ma con matrice di nuovo identica: nessun ripristino', () => {
    const a = an('Q q 2 0 0 2 0 0 cm Q');
    expect(a).toMatchObject({ strayQ: 0, closers: 0, resetMatrix: null });
  });

  it('q, Q, cm dentro stringhe, commenti, nomi e matrici di testo non contano', () => {
    const a = an('BT (q Q 9 0 0 9 0 0 cm) Tj <71516d> Tj [(q) -20 (Q)] TJ ET % q q q cm\n/Q gs /cm Do\n(escape \\) Q \\( q) Tj');
    expect(a).toMatchObject({ closers: 0, strayQ: 0, endDepth: 0, resetMatrix: null });
    approx(a?.endMatrix ?? null, IDENTITY);
  });

  it('un cm con meno di 6 numeri non cambia nulla', () => {
    expect(an('1 2 3 cm')?.endMatrix).toEqual(IDENTITY);
  });

  it('immagine in linea con dati binari che contengono q, Q, cm e un finto EI: viene saltata', () => {
    const data = 'q Q cm EI binario\u0001\u0002 Q q ';
    const a = an(`q BI /W 4 /H 4 /BPC 8 /CS /G ID ${data}\nEI Q q`);
    expect(a).toMatchObject({ closers: 1, strayQ: 0, endDepth: 1 }); // il primo q e' chiuso, l'ultimo resta aperto
  });

  it('immagine in linea senza EI: analisi non riuscita (null)', () => {
    expect(an('BI /W 1 /H 1 ID \u0000\u0001')).toBeNull();
  });

  it('matrice singolare lasciata da un Q in piu\': non ripristinabile', () => {
    const a = an('Q 1 0 0 0 0 0 cm');
    expect(a?.singular).toBe(true);
    expect(a?.resetMatrix).toBeNull();
  });
});
