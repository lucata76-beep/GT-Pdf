import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { ASCENT_EM, DESCENT_EM, firstUnsupported, isExportableChar, textWidthPt } from './textMetrics';

const allowed: string[] = [];
for (let c = 32; c <= 255; c++) if ((c <= 126 || c >= 160) && c !== 127) allowed.push(String.fromCharCode(c));

describe('metriche Helvetica (confronto con pdf-lib)', () => {
  it('la larghezza di ogni carattere ammesso coincide con quella misurata da pdf-lib', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const ch of allowed) {
      // un solo carattere: nessuna crenatura di mezzo
      expect(textWidthPt(ch, 1000), `U+${ch.charCodeAt(0).toString(16)}`).toBe(font.widthOfTextAtSize(ch, 1000));
    }
  });

  it('valori noti: Ø 778, ° 400, ± 584, R 722, cifra 556, punto 278', () => {
    expect(textWidthPt('Ø', 1000)).toBe(778);
    expect(textWidthPt('°', 1000)).toBe(400);
    expect(textWidthPt('±', 1000)).toBe(584);
    expect(textWidthPt('R', 1000)).toBe(722);
    expect(textWidthPt('0', 1000)).toBe(556);
    expect(textWidthPt('.', 1000)).toBe(278);
  });

  it('scala col corpo e somma i caratteri (nessuna crenatura)', () => {
    expect(textWidthPt('Ø25.40', 10)).toBeCloseTo((778 + 556 + 556 + 278 + 556 + 556) / 100, 9);
    expect(textWidthPt('AV', 10)).toBeCloseTo((667 + 667) / 100, 9);
    expect(textWidthPt('', 10)).toBe(0);
  });

  it('metriche verticali da AFM (718 / 207)', () => {
    expect(ASCENT_EM).toBeCloseTo(0.718, 9);
    expect(DESCENT_EM).toBeCloseTo(0.207, 9);
  });
});

describe('caratteri ammessi', () => {
  it('Ø ° ± R, cifre, lettere e simboli della tastiera sono ammessi', () => {
    for (const t of ['Ø25.40', 'R12.5', '90°', '±0.1', 'ABC abc 0123456789', '#$&%@_()[]/\\+-=*<>.,:;!?"\'', '4× M8²']) expect(firstUnsupported(t), t).toBeNull();
  });

  it('fuori da ASCII e Latin-1: rifiutati (pdf-lib li sostituirebbe con "?")', () => {
    expect(firstUnsupported('a→b')).toBe('→');
    expect(firstUnsupported('10 €')).toBe('€'); // in WinAnsi esiste, ma con codice diverso da Unicode: escluso per semplicita'
    expect(firstUnsupported('Ω')).toBe('Ω');
    expect(firstUnsupported('x😀')).toBe('😀');
    expect(isExportableChar('\n')).toBe(false);
    expect(isExportableChar('\t')).toBe(false);
  });

  it('pdf-lib codifica Ø ° ± R senza sostituzioni', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // WinAnsi: Ø = D8, ± = B1, ° = B0, R = 52
    expect(font.encodeText('Ø±°R').toString()).toBe('<D8B1B052>');
  });
});
