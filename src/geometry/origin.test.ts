import { describe, expect, it } from 'vitest';
import { EDGE_EPS_PT, inPageWithEps, originFrame, relToSheet, relToUser, relUnitLabel, relUnitPt, sheetToRel, userToRel } from './origin';
import { PageGeometry } from './page';
import { mmToPt } from './pixels';
import { calibrate } from './scale';

const A4 = { view: [0, 0, 595.276, 841.89] as [number, number, number, number], rotate: 0, userUnit: 1 };
const ROT90 = { view: [50, 50, 450, 600] as [number, number, number, number], rotate: 90, userUnit: 1 }; // /Rotate 90 + CropBox (come a4-rotate90 e a4-cropbox)
const CROP = { view: [20, 30.5, 260, 360.25] as [number, number, number, number], rotate: 0, userUnit: 1 };
const UU = { view: [0, 0, 300, 200] as [number, number, number, number], rotate: 0, userUnit: 2.5 };
const SPECS = { A4, ROT90, CROP, UU, R180: { ...A4, rotate: 180 }, R270: { ...ROT90, rotate: 270 }, UU90: { ...UU, rotate: 90 } };

describe('unita\' delle coordinate relative', () => {
  it('senza scala: mm del foglio (1 mm = 2.8346 pt); con scala: mm reali (1:50 -> 1 mm reale = 0.02 mm sul foglio)', () => {
    expect(relUnitPt(null)).toBeCloseTo(mmToPt(1), 12);
    expect(relUnitLabel(null)).toBe('mm foglio');
    const s = calibrate(mmToPt(100), 5000); // 1:50
    expect(relUnitPt(s)).toBeCloseTo(mmToPt(0.02), 12);
    expect(relUnitLabel(s)).toBe('mm reali');
    // ingrandimento 4:1: 1 mm reale = 4 mm sul foglio
    expect(relUnitPt(calibrate(mmToPt(400), 100))).toBeCloseTo(mmToPt(4), 12);
  });
  it('stessa regola del passo della griglia', async () => {
    const { gridStepPt } = await import('./grid');
    for (const s of [null, calibrate(mmToPt(100), 5000), calibrate(mmToPt(100), 37.5)]) expect(relUnitPt(s) * 10).toBeCloseTo(gridStepPt(10, s), 9);
  });
});

describe('conversioni foglio <-> coordinate relative <-> spazio utente', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const g = new PageGeometry(spec);
    for (const scale of [null, calibrate(mmToPt(100), 5000)]) {
      it(`${name}${scale ? ' con scala' : ' senza scala'}: andata e ritorno esatti; l'origine ha coordinate (0, 0); X a destra e Y in alto sul foglio mostrato`, () => {
        const origin = { x: spec.view[0] + 0.37 * (spec.view[2] - spec.view[0]), y: spec.view[1] + 0.41 * (spec.view[3] - spec.view[1]) };
        const f = originFrame(g, origin, scale);
        expect(f.sheet).toEqual(g.userToSheet(origin));
        const zero = sheetToRel(f, f.sheet);
        expect(zero.x).toBe(0);
        expect(zero.y).toBe(0);
        const u = relUnitPt(scale);
        // un punto 10 mm a destra e 5 mm in alto SUL FOGLIO MOSTRATO
        const right = sheetToRel(f, { x: f.sheet.x + 10 * u, y: f.sheet.y });
        expect(right.x).toBeCloseTo(10, 9);
        expect(right.y).toBeCloseTo(0, 9);
        const up = sheetToRel(f, { x: f.sheet.x, y: f.sheet.y - 5 * u });
        expect(up.x).toBeCloseTo(0, 9);
        expect(up.y).toBeCloseTo(5, 9);
        for (const r of [{ x: 12.5, y: -7.25 }, { x: -100.125, y: 33.5 }, { x: 0, y: 0 }, { x: 1e-3, y: -1e-3 }]) {
          const s = relToSheet(f, r);
          const back = sheetToRel(f, s);
          expect(back.x).toBeCloseTo(r.x, 9);
          expect(back.y).toBeCloseTo(r.y, 9);
          const uu = relToUser(g, f, r);
          const r2 = userToRel(g, f, uu);
          expect(r2.x).toBeCloseTo(r.x, 9);
          expect(r2.y).toBeCloseTo(r.y, 9);
          // lo spazio utente e' quello della pagina: il punto sul foglio e' lo stesso
          const s2 = g.userToSheet(uu);
          expect(s2.x).toBeCloseTo(s.x, 9);
          expect(s2.y).toBeCloseTo(s.y, 9);
        }
      });
    }
  }

  it('con /Rotate 90 gli assi sono quelli che si vedono: +X relativo = a destra sul foglio = verso l\'alto nel PDF; +Y relativo = in alto sul foglio = a destra nel PDF... (verificato su un caso)', () => {
    const g = new PageGeometry(ROT90);
    const origin = { x: 200, y: 300 };
    const f = originFrame(g, origin, null);
    const east = relToUser(g, f, { x: 10, y: 0 });
    const north = relToUser(g, f, { x: 0, y: 10 });
    // distanze: 10 mm del foglio in pt
    const d = mmToPt(10);
    expect(Math.hypot(east.x - origin.x, east.y - origin.y)).toBeCloseTo(d, 9);
    expect(Math.hypot(north.x - origin.x, north.y - origin.y)).toBeCloseTo(d, 9);
    // /Rotate 90: l'asse X del foglio e' l'asse Y utente (e l'asse Y del foglio, verso il basso, e' l'asse X utente)
    expect(east.x).toBeCloseTo(origin.x, 9);
    expect(Math.abs(east.y - origin.y)).toBeCloseTo(d, 9);
    expect(north.y).toBeCloseTo(origin.y, 9);
    expect(Math.abs(north.x - origin.x)).toBeCloseTo(d, 9);
  });

  it('con UserUnit 2.5 il valore in mm e\' in pt FISICI del foglio: 10 mm sono 28.35 pt fisici, non 28.35 pt utente', () => {
    const g = new PageGeometry(UU);
    const origin = { x: 10, y: 10 };
    const f = originFrame(g, origin, null);
    const u = relToUser(g, f, { x: 10, y: 0 });
    expect(Math.hypot(u.x - origin.x, u.y - origin.y) * 2.5).toBeCloseTo(mmToPt(10), 9); // distancePt = utente * UserUnit
    expect(g.distancePt(origin, u)).toBeCloseTo(mmToPt(10), 9);
  });

  it('una ricalibrazione cambia i pt di 1 mm, non le coordinate digitate: stesso (X, Y), punto diverso sul foglio', () => {
    const g = new PageGeometry(A4);
    const o = { x: 100, y: 100 };
    const f1 = originFrame(g, o, calibrate(mmToPt(100), 100)); // 1:1
    const f2 = originFrame(g, o, calibrate(mmToPt(100), 200)); // 1:2: 1 mm reale = 0.5 mm foglio
    const p1 = relToSheet(f1, { x: 20, y: 0 });
    const p2 = relToSheet(f2, { x: 20, y: 0 });
    expect(p1.x - f1.sheet.x).toBeCloseTo(mmToPt(20), 9);
    expect(p2.x - f2.sheet.x).toBeCloseTo(mmToPt(10), 9);
  });
});

describe('dentro la pagina (bordo compreso, con una tolleranza di rumore dei double)', () => {
  it('stesso criterio di PageGeometry.contains, appena meno rigido sul bordo', () => {
    const g = new PageGeometry(A4);
    expect(inPageWithEps(g, { x: 0, y: 0 })).toBe(true);
    expect(inPageWithEps(g, { x: g.width, y: g.height })).toBe(true);
    expect(inPageWithEps(g, { x: -EDGE_EPS_PT / 2, y: 10 })).toBe(true);
    expect(g.contains({ x: -EDGE_EPS_PT / 2, y: 10 })).toBe(false); // il visore, a rigore, la rifiuta; la shell la accetta (rumore)
    expect(inPageWithEps(g, { x: -0.001, y: 10 })).toBe(false);
    expect(inPageWithEps(g, { x: g.width + 0.001, y: 10 })).toBe(false);
    expect(inPageWithEps(g, { x: 10, y: g.height + 0.001 })).toBe(false);
  });
});
