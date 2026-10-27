import { describe, expect, it } from 'vitest';
import { mmToPt } from './pixels';
import { REFERENCE_100MM_PT, calibrate, ptForRealMm, realMm, scaleLabel, scaleN, sheetMm } from './scale';

describe('formule di scala (DESIGN.md)', () => {
  it('100 mm sul foglio = 283.46 pt', () => {
    expect(REFERENCE_100MM_PT).toBeCloseTo(283.4646, 3);
    expect(Number(REFERENCE_100MM_PT.toFixed(2))).toBe(283.46);
    expect(sheetMm(283.46)).toBeCloseTo(100, 2);
  });

  it('foglio_mm = d_pt * 25.4 / 72', () => {
    expect(sheetMm(72)).toBeCloseTo(25.4, 10);
    expect(sheetMm(144)).toBeCloseTo(50.8, 10);
  });

  it('esempio di DESIGN.md: 100 mm reali su 283.46 pt = 100 mm di foglio = 1:1', () => {
    const s = calibrate(283.46, 100);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.mmPerPt).toBeCloseTo(100 / 283.46, 12); // mm_reali_per_pt = L_reale / d_pt
    expect(scaleN(s)).toBeCloseTo(1, 4);
  });

  it('N = L_reale / foglio_mm', () => {
    const dPt = mmToPt(40); // 40 mm sul foglio
    const s = calibrate(dPt, 2000); // 2000 mm reali
    expect(s).not.toBeNull();
    if (!s) return;
    expect(scaleN(s)).toBeCloseTo(2000 / 40, 9); // 1:50
    expect(scaleN(s)).toBeCloseTo(50, 9);
  });

  it('ingrandimento: 10 mm reali su 20 mm di foglio = 1:0.5', () => {
    const s = calibrate(mmToPt(20), 10);
    expect(s && scaleN(s)).toBeCloseTo(0.5, 9);
  });

  it('la lunghezza reale rispetta la scala e torna indietro', () => {
    const s = calibrate(283.46, 100);
    if (!s) throw new Error('scala non calcolata');
    expect(realMm(283.46, s)).toBeCloseTo(100, 9);
    expect(realMm(2 * 283.46, s)).toBeCloseTo(200, 9);
    expect(ptForRealMm(realMm(123.4, s), s)).toBeCloseTo(123.4, 9);
  });

  it('dati non validi: nessuna scala', () => {
    expect(calibrate(0, 100)).toBeNull();
    expect(calibrate(-5, 100)).toBeNull();
    expect(calibrate(100, 0)).toBeNull();
    expect(calibrate(100, -3)).toBeNull();
    expect(calibrate(Number.NaN, 100)).toBeNull();
    expect(calibrate(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('etichetta della scala', () => {
  const label = (dPt: number, realMm: number): string => {
    const s = calibrate(dPt, realMm);
    if (!s) throw new Error('scala non calcolata');
    return scaleLabel(s);
  };
  it('1:N con "." e senza zeri inutili', () => {
    expect(label(mmToPt(40), 2000)).toBe('1:50');
    expect(label(mmToPt(40), 100)).toBe('1:2.5');
    expect(label(mmToPt(20), 10)).toBe('1:0.5');
    expect(label(283.46, 100)).toBe('1:1');
  });
});
