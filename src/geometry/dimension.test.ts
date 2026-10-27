import { describe, expect, it } from 'vitest';
import { DIM_TYPES, autoLabel, autoText, buildDimension, dimInfo, dimensionLabel, measuredPt } from './dimension';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { mmToPt } from './pixels';
import { calibrate } from './scale';
import { DIM_TEXT_MAX_LENGTH, TEXT_MAX_LENGTH, normalizeDimText, validateDimText, validateFreeText } from './annotationText';

const near = (a: SheetPoint, b: SheetPoint, digits = 7): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const CASES = [0, 90, 180, 270].flatMap((rotate) => [1, 2.5].map((userUnit) => ({ rotate, userUnit })));
const geomOf = (c: { rotate: number; userUnit: number }): PageGeometry => new PageGeometry({ view: [50, 50, 450, 600], rotate: c.rotate, userUnit: c.userUnit });

describe('quote lineari: calcolate sul foglio come si vede (con /Rotate, CropBox e UserUnit)', () => {
  for (const c of CASES) {
    const name = `/Rotate ${c.rotate}, UserUnit ${c.userUnit}`;
    const g = geomOf(c);
    const u = (s: SheetPoint): UserPoint => g.sheetToUser(s);
    const s1 = { x: 100, y: 100 };
    const s2 = { x: 300, y: 180 };

    it(`orizzontale (${name}): la linea di quota e' orizzontale sul foglio, alla Y del terzo punto`, () => {
      const def = buildDimension('horizontal', [u(s1), u(s2), u({ x: 220, y: 40 })], g);
      expect(def).not.toBeNull();
      if (!def) return;
      near(g.userToSheet(def.a), { x: 100, y: 40 });
      near(g.userToSheet(def.b), { x: 300, y: 40 });
      expect(measuredPt(def, g)).toBeCloseTo(200, 7);
      near(g.userToSheet(def.p1), s1);
      near(g.userToSheet(def.p2), s2);
    });

    it(`verticale (${name}): la linea di quota e' verticale sul foglio, alla X del terzo punto`, () => {
      const def = buildDimension('vertical', [u(s1), u(s2), u({ x: 350, y: 140 })], g);
      expect(def).not.toBeNull();
      if (!def) return;
      near(g.userToSheet(def.a), { x: 350, y: 100 });
      near(g.userToSheet(def.b), { x: 350, y: 180 });
      expect(measuredPt(def, g)).toBeCloseTo(80, 7);
    });

    it(`allineata (${name}): parallela a p1-p2 alla distanza del terzo punto; misura la distanza vera`, () => {
      const def = buildDimension('aligned', [u({ x: 100, y: 100 }), u({ x: 200, y: 200 }), u({ x: 100, y: 160 })], g);
      expect(def).not.toBeNull();
      if (!def) return;
      const a = g.userToSheet(def.a);
      const b = g.userToSheet(def.b);
      // direzione p1-p2 = (1,1)/sqrt2; normale = (-1,1)/sqrt2; (p3-p1).n = 60/sqrt2
      const d = 60 / Math.SQRT2;
      near(a, { x: 100 - d / Math.SQRT2, y: 100 + d / Math.SQRT2 });
      near(b, { x: 200 - d / Math.SQRT2, y: 200 + d / Math.SQRT2 });
      expect((b.x - a.x) * 1).toBeCloseTo(b.y - a.y, 7); // parallela
      expect(measuredPt(def, g)).toBeCloseTo(100 * Math.SQRT2, 7);
    });

    it(`diametro e raggio (${name}): due punti, la linea di quota passa per i punti`, () => {
      for (const dim of ['diameter', 'radius'] as const) {
        const def = buildDimension(dim, [u(s1), u(s2)], g);
        expect(def).not.toBeNull();
        if (!def) return;
        expect(def.a).toEqual(def.p1);
        expect(def.b).toEqual(def.p2);
        expect(measuredPt(def, g)).toBeCloseTo(Math.hypot(200, 80), 7);
      }
    });
  }

  it('quote degeneri: punti coincidenti, orizzontale con la stessa X, verticale con la stessa Y, punti mancanti', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const p = { x: 100, y: 100 };
    expect(buildDimension('aligned', [p, { ...p }, { x: 0, y: 0 }], g)).toBeNull();
    expect(buildDimension('diameter', [p, { ...p }], g)).toBeNull();
    expect(buildDimension('horizontal', [p, { x: 100, y: 300 }, { x: 0, y: 0 }], g)).toBeNull(); // stessa X
    expect(buildDimension('vertical', [p, { x: 300, y: 100 }, { x: 0, y: 0 }], g)).toBeNull(); // stessa Y
    expect(buildDimension('aligned', [p, { x: 200, y: 200 }], g)).toBeNull(); // manca il terzo punto
    expect(buildDimension('radius', [p], g)).toBeNull();
  });

  it('offset zero: la linea di quota coincide con i punti misurati', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const def = buildDimension('aligned', [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 150, y: 100 }], g);
    expect(def?.a).toEqual({ x: 100, y: 100 });
    expect(def?.b).toEqual({ x: 300, y: 100 });
  });
});

describe('valore ed etichetta', () => {
  const g = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
  // 100 mm sul foglio = 100 mm reali (1:1)
  const scale11 = calibrate(mmToPt(100), 100);
  const scale12 = calibrate(mmToPt(100), 200); // 1:2
  if (!scale11 || !scale12) throw new Error('scala');
  const h = { dim: 'horizontal' as const, p1: { x: 100, y: 500 }, p2: { x: 100 + mmToPt(100), y: 480 }, valueText: null };

  it('automatica: mm reali dalla scala, "." e 2 decimali, senza unita\'', () => {
    expect(autoLabel(h, g, scale11)).toBe('100.00');
    expect(autoLabel(h, g, scale12)).toBe('200.00');
    expect(autoLabel({ dim: 'vertical', p1: { x: 0, y: 0 }, p2: { x: 5, y: mmToPt(12.5) } }, g, scale11)).toBe('12.50');
  });

  it('prefissi: Ø solo per il diametro, R solo per il raggio', () => {
    const d = { p1: { x: 100, y: 500 }, p2: { x: 100 + mmToPt(25.4), y: 500 } };
    expect(autoLabel({ dim: 'diameter', ...d }, g, scale11)).toBe('Ø25.40');
    expect(autoLabel({ dim: 'radius', ...d }, g, scale11)).toBe('R25.40');
    expect(autoLabel({ dim: 'aligned', ...d }, g, scale11)).toBe('25.40');
    expect(autoLabel({ dim: 'horizontal', ...d }, g, scale11)).toBe('25.40');
    expect(DIM_TYPES.filter((t) => t.prefix !== '').map((t) => t.id)).toEqual(['diameter', 'radius']);
    expect(autoText('diameter', 8)).toBe('Ø8.00');
  });

  it('senza scala non c\'e\' un valore automatico (non si inventano unita\' reali)', () => {
    expect(autoLabel(h, g, null)).toBeNull();
    expect(dimensionLabel(h, g, null)).toBeNull();
  });

  it('digitato: mostrato com\'e\', anche senza scala; l\'automatica segue la ricalibrazione', () => {
    expect(dimensionLabel({ ...h, valueText: '25 H7' }, g, null)).toBe('25 H7');
    expect(dimensionLabel({ ...h, valueText: 'Ø8 ±0.1' }, g, scale11)).toBe('Ø8 ±0.1');
    expect(dimensionLabel(h, g, scale11)).toBe('100.00');
    expect(dimensionLabel(h, g, scale12)).toBe('200.00'); // stessa quota, nuova scala
  });

  it('con UserUnit la misura e\' in pt fisici', () => {
    const g2 = new PageGeometry({ view: [0, 0, 300, 300], rotate: 0, userUnit: 2 });
    const def = { dim: 'aligned' as const, p1: { x: 0, y: 0 }, p2: { x: mmToPt(50) / 2, y: 0 } }; // 50 mm fisici = 141.7 pt fisici = 70.9 unita' utente
    expect(measuredPt(def, g2)).toBeCloseTo(mmToPt(50), 7);
    const s = calibrate(mmToPt(100), 100);
    if (!s) throw new Error('scala');
    expect(autoLabel(def, g2, s)).toBe('50.00');
  });

  it('i tipi di quota: 5, con 3 punti le lineari e 2 punti Ø e R', () => {
    expect(DIM_TYPES.map((t) => [t.id, t.points])).toEqual([
      ['aligned', 3],
      ['horizontal', 3],
      ['vertical', 3],
      ['diameter', 2],
      ['radius', 2],
    ]);
    expect(dimInfo('radius').label).toBe('Quota raggio R');
  });
});

describe('testo digitato', () => {
  it('la virgola tra due cifre diventa punto, il resto non cambia', () => {
    expect(normalizeDimText('12,5')).toBe('12.5');
    expect(normalizeDimText('Ø12,50 ±0,1')).toBe('Ø12.50 ±0.1');
    expect(normalizeDimText('M8, 4 fori')).toBe('M8, 4 fori');
    expect(normalizeDimText('1,2,3')).toBe('1.2.3');
    expect(normalizeDimText('12.5')).toBe('12.5');
  });

  it('testo libero: non vuoto, ammesso, non troppo lungo', () => {
    expect(validateFreeText('')).toMatch(/Scrivi/);
    expect(validateFreeText('   ')).toMatch(/Scrivi/);
    expect(validateFreeText('FORO Ø8 ±0.1 90° #1 & $')).toBeNull();
    expect(validateFreeText('a→b')).toMatch(/"→"/);
    expect(validateFreeText('x'.repeat(TEXT_MAX_LENGTH))).toBeNull();
    expect(validateFreeText('x'.repeat(TEXT_MAX_LENGTH + 1))).toMatch(/Massimo/);
  });

  it('valore di una quota: serve almeno una cifra', () => {
    expect(validateDimText('')).toMatch(/Digita/);
    expect(validateDimText('Ø')).toMatch(/cifra/);
    expect(validateDimText('R')).toMatch(/cifra/);
    expect(validateDimText('Ø25.4')).toBeNull();
    expect(validateDimText('4x Ø8 ±0.1')).toBeNull();
    expect(validateDimText('12 Ω')).toMatch(/"Ω"/);
    expect(validateDimText('1'.repeat(DIM_TEXT_MAX_LENGTH + 1))).toMatch(/Massimo/);
  });
});
