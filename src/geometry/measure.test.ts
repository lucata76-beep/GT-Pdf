import { describe, expect, it } from 'vitest';
import { measure, measureLines, measureMessage } from './measure';
import { PageGeometry } from './page';
import { mmToPt } from './pixels';
import { calibrate } from './scale';

const plain = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rotated = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });

describe('Distanza', () => {
  it('senza calibrazione: mm del foglio e invito a calibrare', () => {
    const a = plain.sheetToUser({ x: 100, y: 100 });
    const b = plain.sheetToUser({ x: 100 + mmToPt(100), y: 100 });
    const m = measure(plain, a, b, null);
    expect(m.real).toBeNull();
    expect(m.sheetMm).toBeCloseTo(100, 6);
    expect(m.dPt).toBeCloseTo(283.4646, 3);
    expect(measureLines(m)).toEqual(['Foglio 100.00 mm', 'non calibrata']);
    expect(measureMessage(m)).toContain('non calibrata');
    expect(measureMessage(m)).toContain('100.00 mm');
  });

  it('con calibrazione: unita\' reali, ΔX a destra, ΔY in alto, sempre con "."', () => {
    const s = calibrate(mmToPt(10), 500); // 10 mm di foglio = 500 mm reali (1:50)
    if (!s) throw new Error('scala non calcolata');
    const a = plain.sheetToUser({ x: 100, y: 300 });
    const b = plain.sheetToUser({ x: 100 + mmToPt(30), y: 300 - mmToPt(40) }); // 30 mm a destra, 40 mm IN ALTO sullo schermo
    const m = measure(plain, a, b, s);
    expect(m.sheetMm).toBeCloseTo(50, 6);
    expect(m.real?.mm).toBeCloseTo(2500, 6);
    expect(m.real?.dx).toBeCloseTo(1500, 6);
    expect(m.real?.dy).toBeCloseTo(2000, 6);
    expect(measureLines(m)).toEqual(['L 2500.00 mm', 'ΔX +1500.00  ΔY +2000.00']);
    const back = measure(plain, b, a, s);
    expect(measureLines(back)).toEqual(['L 2500.00 mm', 'ΔX -1500.00  ΔY -2000.00']);
  });

  it('pagina con /Rotate 90 + CropBox: la misura segue lo schermo, non lo spazio utente', () => {
    const s = calibrate(mmToPt(100), 100); // 1:1
    if (!s) throw new Error('scala non calcolata');
    const a = rotated.sheetToUser({ x: 100, y: 100 });
    const b = rotated.sheetToUser({ x: 100 + mmToPt(100), y: 100 }); // 100 mm orizzontali sullo schermo
    const m = measure(rotated, a, b, s);
    expect(m.real?.mm).toBeCloseTo(100, 6);
    expect(m.real?.dx).toBeCloseTo(100, 6);
    expect(m.real?.dy).toBeCloseTo(0, 6);
    expect(measureLines(m)[1]).toBe('ΔX +100.00  ΔY 0.00');
  });

  it('UserUnit: la distanza e\' in pt fisici', () => {
    const g = new PageGeometry({ view: [0, 0, 100, 100], rotate: 0, userUnit: 2 });
    const m = measure(g, { x: 0, y: 0 }, { x: 36, y: 0 }, null); // 36 unita' utente = 72 pt = 25.4 mm
    expect(m.dPt).toBeCloseTo(72, 9);
    expect(m.sheetMm).toBeCloseTo(25.4, 9);
  });
});
