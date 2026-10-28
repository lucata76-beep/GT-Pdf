import { describe, expect, it } from 'vitest';
import { PIXEL_BUDGET } from '../geometry/pixels';
import { defaultDpi, fmtInt, pageLabel, pagePixels, paperName, planDpi } from './flatPlan';

const A4 = { widthPt: 595.276, heightPt: 841.89 };
const A3 = { widthPt: 1190.551, heightPt: 841.89 };

describe('fmtInt', () => {
  it('punto come separatore delle migliaia', () => {
    expect(fmtInt(69605736)).toBe('69.605.736');
    expect(fmtInt(67108864)).toBe('67.108.864');
    expect(fmtInt(999)).toBe('999');
    expect(fmtInt(1000)).toBe('1.000');
  });
});

describe('pixel calcolati sulla pagina reale (valori di DESIGN.md)', () => {
  const px = (p: { widthPt: number; heightPt: number }, dpi: number): number => (pagePixels([{ page: 1, ...p }], dpi)[0] as { area: number }).area;
  it('A4: 150 dpi = 2.174.960, 300 = 8.699.840, 600 = 34.806.376', () => {
    expect(px(A4, 150)).toBe(2174960);
    expect(px(A4, 300)).toBe(8699840);
    expect(px(A4, 600)).toBe(34806376);
  });
  it('A3: 150 dpi = 4.349.920, 300 = 17.403.188, 600 = 69.605.736 (sopra il tetto)', () => {
    expect(px(A3, 150)).toBe(4349920);
    expect(px(A3, 300)).toBe(17403188);
    expect(px(A3, 600)).toBe(69605736);
    expect(px(A3, 600)).toBeGreaterThan(PIXEL_BUDGET);
  });
  it('lato per lato: 300 dpi di un A4 sono 2480 x 3508 px', () => {
    expect(pagePixels([{ page: 1, ...A4 }], 300)[0]).toMatchObject({ w: 2480, h: 3508 });
  });
});

describe('planDpi', () => {
  it('una sola pagina A4: tutti i DPI ammessi', () => {
    const plans = planDpi([{ page: 1, ...A4 }]);
    expect(plans.map((p) => [p.dpi, p.ok])).toEqual([[150, true], [300, true], [600, true]]);
    expect(plans.every((p) => p.reason === null)).toBe(true);
  });
  it('una pagina A3: 600 dpi disabilitato con il motivo in italiano', () => {
    const plans = planDpi([{ page: 2, ...A3 }]);
    expect(plans.map((p) => p.ok)).toEqual([true, true, false]);
    expect(plans[2]?.reason).toBe('Pagina 2 (A3) a 600 dpi: 69.605.736 px, oltre 67.108.864');
    expect(plans[2]?.largest).toMatchObject({ page: 2, w: 9921, h: 7016, area: 69605736 });
  });
  it('pagine di misure diverse: un DPI e\' ammesso solo se entrano TUTTE (qui basta l\'A3)', () => {
    const plans = planDpi([{ page: 1, ...A4 }, { page: 3, ...A3 }]);
    expect(plans.map((p) => p.ok)).toEqual([true, true, false]);
    expect(plans[2]?.reason).toContain('Pagina 3 (A3)');
    expect(plans[1]?.largest?.page).toBe(3);
  });
  it('il tetto e\' esatto: 8192 x 8192 entra, un pixel in piu\' no (la regola e\' sull\'area)', () => {
    const edge = { page: 1, widthPt: (8192 * 72) / 150, heightPt: (8192 * 72) / 150 };
    expect(planDpi([edge])[0]?.ok).toBe(true); // 150 dpi: 8192 x 8192 = 67.108.864
    expect(planDpi([{ ...edge, widthPt: edge.widthPt + 0.6 }])[0]?.ok).toBe(false);
  });
  it('una pagina grande (A0): entra solo a 150 dpi (34,9 M px), con la pagina nel motivo degli altri', () => {
    const a0 = { page: 5, widthPt: 2383.94, heightPt: 3370.39 };
    const plans = planDpi([a0]);
    expect(plans.map((p) => p.ok)).toEqual([true, false, false]);
    expect(plans[1]?.reason).toContain('Pagina 5 (A0) a 300 dpi');
    expect(defaultDpi(plans)).toBe(150);
  });
  it('una pagina enorme (A0 doppio): nessun DPI ammesso, nessun DPI proposto', () => {
    const plans = planDpi([{ page: 1, widthPt: 4768, heightPt: 6741 }]);
    expect(plans.every((p) => !p.ok)).toBe(true);
    expect(defaultDpi(plans)).toBeNull();
  });
  it('nessuna pagina da rasterizzare: tutto ammesso, nessuna pagina piu\' grande', () => {
    const plans = planDpi([]);
    expect(plans.every((p) => p.ok && p.largest === null)).toBe(true);
  });
  it('CropBox, /Rotate e UserUnit: contano le dimensioni del foglio mostrato (qui 400 x 550 pt)', () => {
    const crop = { page: 1, widthPt: 400, heightPt: 550 };
    expect(pagePixels([crop], 300)[0]).toMatchObject({ w: 1667, h: 2292 });
    const rotated = { page: 1, widthPt: 550, heightPt: 400 };
    expect(pagePixels([rotated], 300)[0]).toMatchObject({ w: 2292, h: 1667 });
    const uu = { page: 1, widthPt: 238.11 * 2.5, heightPt: 336.76 * 2.5 };
    expect(pagePixels([uu], 300)[0]).toMatchObject({ w: 2480, h: 3508 }); // 238.11 x 336.76 unita' utente x 2.5 = un A4 fisico
  });
});

describe('defaultDpi', () => {
  it('300 se ammesso, altrimenti il piu\' alto ammesso', () => {
    expect(defaultDpi(planDpi([{ page: 1, ...A4 }]))).toBe(300);
    expect(defaultDpi(planDpi([{ page: 1, ...A3 }]))).toBe(300);
    const big = { page: 1, widthPt: 1683.78, heightPt: 2383.94 }; // A1: 300 dpi = 7016 x 9933 = 69,7 M
    expect(defaultDpi(planDpi([big]))).toBe(150);
  });
});

describe('nomi dei formati', () => {
  it('A4, A3 in qualunque orientamento; altri: millimetri', () => {
    expect(paperName(595.276, 841.89)).toBe('A4');
    expect(paperName(841.89, 595.276)).toBe('A4');
    expect(paperName(1190.551, 841.89)).toBe('A3');
    expect(paperName(400, 550)).toBeNull();
    expect(pageLabel({ page: 1, widthPt: 400, heightPt: 550 })).toBe('Pagina 1 (141.1 x 194.0 mm)');
    expect(pageLabel({ page: 4, ...A4 })).toBe('Pagina 4 (A4)');
  });
});
