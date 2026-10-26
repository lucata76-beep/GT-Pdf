import { describe, expect, it } from 'vitest';
import { PIXEL_BUDGET, exportPixels, fitRenderSize, fitsBudget, mmToPt, ptToMm } from './pixels';

// Dimensioni PDF reali di A4/A3 come le produce reportlab/pdf-lib (pt).
const A4 = { w: 595.276, h: 841.89 };
const A3 = { w: 841.89, h: 1190.551 };

describe('exportPixels: valori di DESIGN.md', () => {
  it.each([
    ['A4', A4, 150, 2_174_960],
    ['A4', A4, 300, 8_699_840],
    ['A4', A4, 600, 34_806_376],
    ['A3', A3, 150, 4_349_920],
    ['A3', A3, 300, 17_403_188],
    ['A3', A3, 600, 69_605_736],
  ])('%s a %i dpi', (_n, page, dpi, expected) => {
    expect(exportPixels(page.w, page.h, dpi).area).toBe(expected);
  });
});

describe('tetto provvisorio', () => {
  it('vale 16.777.216 (4096 x 4096)', () => {
    expect(PIXEL_BUDGET).toBe(4096 * 4096);
  });
  it('A4 300 dpi sta nel tetto, A3 300 dpi no', () => {
    expect(fitsBudget(exportPixels(A4.w, A4.h, 300).area)).toBe(true);
    expect(fitsBudget(exportPixels(A3.w, A3.h, 300).area)).toBe(false);
  });
});

describe('fitRenderSize', () => {
  it('non riduce se rientra nel tetto', () => {
    const r = fitRenderSize(A4.w, A4.h, 2, PIXEL_BUDGET);
    expect(r.clamped).toBe(false);
    expect(r.scale).toBe(2);
    expect(r.w).toBe(Math.floor(A4.w * 2));
  });
  it('riduce la scala se supera il tetto e non lo supera mai', () => {
    for (const wanted of [5, 8, 12, 20, 50]) {
      const r = fitRenderSize(A3.w, A3.h, wanted, PIXEL_BUDGET);
      expect(r.w * r.h).toBeLessThanOrEqual(PIXEL_BUDGET);
      if (wanted * wanted * A3.w * A3.h > PIXEL_BUDGET) {
        expect(r.clamped).toBe(true);
        expect(r.scale).toBeLessThan(wanted);
      }
    }
  });
  it('rispetta anche tetti piccoli', () => {
    const r = fitRenderSize(100, 100, 10, 1000);
    expect(r.w * r.h).toBeLessThanOrEqual(1000);
    expect(r.w).toBeGreaterThanOrEqual(1);
  });
});

describe('conversioni di unità (formule di DESIGN.md)', () => {
  it('100 mm = 283.46 pt', () => {
    expect(mmToPt(100)).toBeCloseTo(283.4646, 3);
  });
  it('conversione di andata e ritorno', () => {
    expect(ptToMm(mmToPt(37.25))).toBeCloseTo(37.25, 10);
  });
});
