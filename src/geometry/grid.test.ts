import { describe, expect, it } from 'vitest';
import {
  GRID_DEFAULT_MM,
  GRID_MAX_MM,
  GRID_MIN_MM,
  GRID_MIN_SCREEN_PX,
  GRID_PRESETS_MM,
  gridLines,
  gridStepPt,
  gridVisible,
  snapToGrid,
} from './grid';
import { PageGeometry, type Pt } from './page';
import { mmToPt } from './pixels';
import { calibrate } from './scale';

const near = (a: Pt, b: Pt, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const A4 = { width: 595.276, height: 841.89 };

describe('passo della griglia', () => {
  it('valori predefiniti e limiti', () => {
    expect(GRID_DEFAULT_MM).toBe(10);
    expect(GRID_PRESETS_MM).toContain(GRID_DEFAULT_MM);
    expect(GRID_MIN_MM).toBeLessThan(GRID_DEFAULT_MM);
    expect(GRID_MAX_MM).toBeGreaterThan(GRID_DEFAULT_MM);
    for (const p of GRID_PRESETS_MM) {
      expect(p).toBeGreaterThanOrEqual(GRID_MIN_MM);
      expect(p).toBeLessThanOrEqual(GRID_MAX_MM);
    }
  });
  it('senza scala: mm del foglio (10 mm = 28.3465 pt)', () => {
    expect(gridStepPt(10, null)).toBeCloseTo(mmToPt(10), 12);
    expect(gridStepPt(10, null)).toBeCloseTo(28.346456692913385, 9);
  });
  it('con scala: mm REALI; 1:50 (50 mm reali per ogni mm del foglio) -> 10 mm reali = 0.2 mm sul foglio', () => {
    const s = calibrate(mmToPt(100), 5000); // 100 mm sul foglio = 5000 mm reali = 1:50
    expect(s).not.toBeNull();
    expect(gridStepPt(10, s)).toBeCloseTo(mmToPt(0.2), 9);
    // ingrandimento 4:1 (100 mm reali = 400 mm sul foglio): 10 mm reali = 40 mm sul foglio
    const z = calibrate(mmToPt(400), 100);
    expect(gridStepPt(10, z)).toBeCloseTo(mmToPt(40), 9);
  });
  it('una ricalibrazione cambia il passo in pt, non quello in mm', () => {
    const before = gridStepPt(10, calibrate(mmToPt(100), 100));
    const after = gridStepPt(10, calibrate(mmToPt(100), 200));
    expect(before).toBeCloseTo(mmToPt(10), 9);
    expect(after).toBeCloseTo(mmToPt(5), 9);
  });
});

describe('visibilita\' per zoom', () => {
  it('sotto la soglia in px CSS non si disegna e non arrotonda', () => {
    const step = mmToPt(10);
    const zOk = GRID_MIN_SCREEN_PX / step;
    expect(gridVisible(step, zOk)).toBe(true); // esattamente alla soglia: visibile
    expect(gridVisible(step, zOk * 0.999)).toBe(false);
    expect(gridVisible(step, 3)).toBe(true);
    expect(gridVisible(0, 3)).toBe(false);
    expect(gridVisible(Number.NaN, 3)).toBe(false);
  });
});

describe('arrotondamento al nodo', () => {
  const step = 20;
  const size = { width: 100, height: 100 };
  it('origine in basso a sinistra: nodi a x = i*passo e a y = H - j*passo', () => {
    near(snapToGrid({ x: 41, y: 99 }, step, size), { x: 40, y: 100 }); // in basso a sinistra: y -> H
    near(snapToGrid({ x: 41, y: 61 }, step, size), { x: 40, y: 60 }); // 100 - 60 = 40 = 2 passi
    near(snapToGrid({ x: 69, y: 1 }, step, size), { x: 60, y: 0 }); // il bordo alto e' y = 0 = H - 5 passi
  });
  it('arrotonda al piu\' vicino (a meta\': verso l\'alto in valore assoluto della coordinata)', () => {
    near(snapToGrid({ x: 29.9, y: 100 }, step, size), { x: 20, y: 100 });
    near(snapToGrid({ x: 30.1, y: 100 }, step, size), { x: 40, y: 100 });
  });
  it('una sola coordinata (con ORTO): l\'altra non cambia', () => {
    near(snapToGrid({ x: 41, y: 63.3 }, step, size, 'x'), { x: 40, y: 63.3 });
    near(snapToGrid({ x: 41, y: 63.3 }, step, size, 'y'), { x: 41, y: 60 });
  });
  it('mai fuori dalla pagina: l\'indice si limita alle linee che ci stanno', () => {
    const a4 = snapToGrid({ x: A4.width - 0.1, y: 0.2 }, 10, A4); // nodo piu' vicino sarebbe x = 600 > 595.276, y < 0
    expect(a4.x).toBeLessThanOrEqual(A4.width);
    expect(a4.x).toBeCloseTo(590, 9);
    expect(a4.y).toBeGreaterThanOrEqual(0);
    expect(a4.y).toBeCloseTo(A4.height - 84 * 10, 9); // la linea piu' alta che sta nella pagina: 841.89 - 840 = 1.89 (la 85a cadrebbe a y < 0)
    near(snapToGrid({ x: -3, y: A4.height + 4 }, 10, A4), { x: 0, y: A4.height });
  });
  it('passo non valido: il punto resta com\'e\'', () => {
    near(snapToGrid({ x: 41, y: 63 }, 0, size), { x: 41, y: 63 });
    near(snapToGrid({ x: 41, y: 63 }, -5, size), { x: 41, y: 63 });
    near(snapToGrid({ x: 41, y: 63 }, Number.NaN, size), { x: 41, y: 63 });
  });
  it('quante linee ci sono', () => {
    expect(gridLines(20, size)).toEqual({ cols: 6, rows: 6 });
    expect(gridLines(30, size)).toEqual({ cols: 4, rows: 4 }); // 0, 30, 60, 90
  });
});

describe('griglia sul foglio mostrato (pagina ruotata, CropBox)', () => {
  for (const rotate of [0, 90, 180, 270]) {
    it(`/Rotate ${rotate} con CropBox: i nodi sono nel foglio (angolo in basso a sinistra della pagina mostrata) e tornano nello spazio utente`, () => {
      const g = new PageGeometry({ view: [50, 50, 450, 600], rotate, userUnit: 1 });
      const step = mmToPt(10);
      const p = snapToGrid({ x: g.width / 2 + 3, y: g.height / 2 - 4 }, step, g);
      // sul foglio il nodo e' un multiplo del passo contato dall'angolo in basso a sinistra
      const i = p.x / step;
      const j = (g.height - p.y) / step;
      expect(i).toBeCloseTo(Math.round(i), 9);
      expect(j).toBeCloseTo(Math.round(j), 9);
      expect(g.contains(p)).toBe(true);
      // e riportato nello spazio utente e di nuovo sul foglio non si sposta
      near(g.userToSheet(g.sheetToUser(p)), p, 9);
    });
  }
  it('UserUnit 2.5: il passo e\' in pt FISICI del foglio (il foglio e\' 2.5 volte piu\' grande dello spazio utente)', () => {
    const g = new PageGeometry({ view: [0, 0, 200, 300], rotate: 0, userUnit: 2.5 });
    const step = mmToPt(10);
    const p = snapToGrid({ x: 100, y: 100 }, step, g);
    expect(p.x / step).toBeCloseTo(Math.round(p.x / step), 9);
    // due nodi vicini distano 10 mm sul foglio = step / 2.5 unita' utente
    const a = g.sheetToUser({ x: 0, y: g.height });
    const b = g.sheetToUser({ x: step, y: g.height });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(step / 2.5, 9);
  });
});
