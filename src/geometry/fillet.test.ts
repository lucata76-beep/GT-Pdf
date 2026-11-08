import { describe, expect, it } from 'vitest';
import { EXACT_MIN_DISTANCE_PT } from '../app/construction';
import { ANGLE_MIN_DEG } from './angular';
import { ARC_MIN_SWEEP_RAD, arcProblem, arcThroughPoints } from './arc';
import { FILLET_MIN_RADIUS_PT, FILLET_MIN_REMAINDER_PT, type FilletSide, filletFromSides, filletProblemText, filletRadiusPt } from './fillet';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { mmToPt } from './pixels';

const DEG = Math.PI / 180;
const sub = (a: SheetPoint, b: SheetPoint): SheetPoint => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: SheetPoint, b: SheetPoint): number => a.x * b.x + a.y * b.y;
const cross = (a: SheetPoint, b: SheetPoint): number => a.x * b.y - a.y * b.x;
const len = (a: SheetPoint): number => Math.hypot(a.x, a.y);
const unit = (a: SheetPoint): SheetPoint => ({ x: a.x / len(a), y: a.y / len(a) });
const CASES = [0, 90, 180, 270].flatMap((rotate) => [1, 2.5].map((userUnit) => ({ rotate, userUnit })));
const geomOf = (c: { rotate: number; userUnit: number }): PageGeometry => new PageGeometry({ view: [50, 50, 450, 600], rotate: c.rotate, userUnit: c.userUnit });
const G0 = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const V: UserPoint = { x: 250, y: 300 };
const dirOf = (deg: number): UserPoint => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) });
const at = (c: UserPoint, d: UserPoint, k: number): UserPoint => ({ x: c.x + d.x * k, y: c.y + d.y * k });
const neg = (d: UserPoint): UserPoint => ({ x: -d.x, y: -d.y });
/** Un tratto da `from` a `to` (indice 0 di un oggetto `id`) con il clic a `click` (spazio utente). */
const tract = (id: number, from: UserPoint, to: UserPoint, click: UserPoint, index = 0): FilletSide => ({ id, index, a: from, b: to, click });

/**
 * Il raccordo calcolato nel FOGLIO con una costruzione INDIPENDENTE da `filletFromSides`: le direzioni tenute sono quelle dichiarate dal test, il centro e' l'incrocio delle due rette
 * spostate di R verso l'altra parte (sistema 2 x 2), i punti di tangenza sono i piedi delle perpendicolari dal centro e il punto sull'arco e' a distanza R dal centro verso V.
 */
function expectedSheet(g: PageGeometry, v: UserPoint, dirs: [UserPoint, UserPoint], r: number) {
  const vs = g.userToSheet(v);
  const u = dirs.map((d) => unit(sub(g.userToSheet(at(v, d, 1)), vs))) as [SheetPoint, SheetPoint];
  const perp = (a: SheetPoint): SheetPoint => ({ x: -a.y, y: a.x });
  let n1 = perp(u[0]);
  if (dot(n1, u[1]) < 0) n1 = { x: -n1.x, y: -n1.y };
  let n2 = perp(u[1]);
  if (dot(n2, u[0]) < 0) n2 = { x: -n2.x, y: -n2.y };
  const det = n1.x * n2.y - n1.y * n2.x;
  const w = { x: (r * n2.y - r * n1.y) / det, y: (n1.x * r - n2.x * r) / det };
  const c = { x: vs.x + w.x, y: vs.y + w.y };
  const foot = (k: 0 | 1): SheetPoint => {
    const s = dot(sub(c, vs), u[k]);
    return { x: vs.x + u[k].x * s, y: vs.y + u[k].y * s };
  };
  const toV = unit(sub(vs, c));
  return { vs, u, c, t: [foot(0), foot(1)] as [SheetPoint, SheetPoint], m: { x: c.x + toV.x * r, y: c.y + toV.y * r } };
}
const near = (a: SheetPoint, b: SheetPoint, tol = 1e-7): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

const L = 200; // meta' lunghezza dei tratti che attraversano V
const THETAS = [30, 45, 60, 90, 120, 135, 150, 170];

describe('raccordo fra due rette: quattro combinazioni di clic, calcolato con una costruzione indipendente', () => {
  for (const c of CASES) {
    for (const theta of THETAS) {
      it(`/Rotate ${c.rotate}, UserUnit ${c.userUnit}, angolo ${theta}: ognuna delle quattro parti danno un raccordo diverso e giusto (centro a distanza R dalle due rette, tangenza, sweep 180 - theta)`, () => {
        const g = geomOf(c);
        const R = 10;
        const d1 = dirOf(0);
        const d2 = dirOf(theta);
        const t1 = (click: UserPoint) => tract(1, at(V, d1, -L), at(V, d1, L), click);
        const t2 = (click: UserPoint) => tract(2, at(V, d2, -L), at(V, d2, L), click);
        const combos: { k1: 1 | -1; k2: 1 | -1; angle: number }[] = [
          { k1: 1, k2: 1, angle: theta },
          { k1: -1, k2: 1, angle: 180 - theta },
          { k1: -1, k2: -1, angle: theta },
          { k1: 1, k2: -1, angle: 180 - theta },
        ];
        const seen = new Set<string>();
        for (const cb of combos) {
          const u1 = cb.k1 === 1 ? d1 : neg(d1);
          const u2 = cb.k2 === 1 ? d2 : neg(d2);
          const res = filletFromSides(t1(at(V, u1, 60)), t2(at(V, u2, 70)), R, g);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const f = res.fillet;
          const ex = expectedSheet(g, V, [u1, u2], R);
          near(g.userToSheet(f.center), ex.c);
          near(g.userToSheet(f.ends[0].tangent), ex.t[0]);
          near(g.userToSheet(f.ends[1].tangent), ex.t[1]);
          near(g.userToSheet(f.mid), ex.m);
          // proprieta': distanze dalle rette = R, |T - C| = R, tangenza (T - C perpendicolare al tratto), sweep = 180 - theta
          const cs = g.userToSheet(f.center);
          for (const k of [0, 1] as const) {
            const tk = g.userToSheet(f.ends[k].tangent);
            expect(Math.abs(len(sub(tk, cs)) - R)).toBeLessThan(1e-9 * R + 1e-9);
            expect(Math.abs(dot(unit(sub(tk, cs)), ex.u[k]))).toBeLessThan(1e-9);
            expect(Math.abs(Math.abs(cross(sub(cs, ex.vs), ex.u[k])) - R)).toBeLessThan(1e-9 * R + 1e-9);
          }
          expect(Math.abs(len(sub(g.userToSheet(f.mid), cs)) - R)).toBeLessThan(1e-9 * R + 1e-9);
          expect(f.sweepDeg).toBeCloseTo(180 - cb.angle, 8);
          expect(f.thetaDeg).toBeCloseTo(cb.angle, 8);
          expect(f.tangentPt).toBeCloseTo(R / Math.tan((cb.angle * DEG) / 2), 8);
          // l'arco per tre punti ricostruito dal file ha centro e raggio del raccordo, e copre 180 - theta
          const a = arcThroughPoints(g.userToSheet(f.ends[0].tangent), g.userToSheet(f.mid), g.userToSheet(f.ends[1].tangent));
          expect(a).not.toBeNull();
          if (!a) return;
          expect(Math.abs(a.r - R)).toBeLessThan(1e-6);
          near(a.c, cs, 1e-6);
          expect(Math.abs(Math.abs(a.sweep) / DEG - (180 - cb.angle))).toBeLessThan(1e-6);
          // l'estremo che si sostituisce e' quello opposto alla parte tenuta: la parte tenuta e' verso +d (b) se k = 1, quindi si toglie la 'a'
          expect(f.ends[0].replace).toBe(cb.k1 === 1 ? 'a' : 'b');
          expect(f.ends[1].replace).toBe(cb.k2 === 1 ? 'a' : 'b');
          seen.add(`${f.ends[0].tangent.x.toFixed(4)},${f.ends[0].tangent.y.toFixed(4)};${f.ends[1].tangent.x.toFixed(4)},${f.ends[1].tangent.y.toFixed(4)};${f.mid.x.toFixed(4)},${f.mid.y.toFixed(4)}`);
        }
        expect(seen.size).toBe(4); // quattro raccordi diversi
      });
    }
  }
});

describe('raccordo: due rette perpendicolari (t = R)', () => {
  it('con i clic nei quattro settori: t = R, il centro e\' a R da entrambe, M a R dal centro; punti calcolati a mano', () => {
    const R = 10;
    // rette: asse X e asse Y per V = (250, 300), nel foglio non ruotato con UserUnit 1 le distanze sono uguali
    const hx = (click: UserPoint) => tract(1, { x: 50, y: 300 }, { x: 450, y: 300 }, click);
    const hy = (click: UserPoint) => tract(2, { x: 250, y: 100 }, { x: 250, y: 500 }, click);
    const quadrants: { sx: 1 | -1; sy: 1 | -1 }[] = [
      { sx: 1, sy: 1 },
      { sx: -1, sy: 1 },
      { sx: -1, sy: -1 },
      { sx: 1, sy: -1 },
    ];
    for (const q of quadrants) {
      const res = filletFromSides(hx({ x: V.x + q.sx * 80, y: V.y }), hy({ x: V.x, y: V.y + q.sy * 80 }), R, G0);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const f = res.fillet;
      // a mano (spazio utente = foglio con Y capovolto, UserUnit 1): T1 = V + (sx * R, 0), T2 = V + (0, sy * R), C = V + (sx * R, sy * R), M = C - R * (sx, sy) / sqrt(2)
      expect(f.ends[0].tangent.x).toBeCloseTo(V.x + q.sx * R, 9);
      expect(f.ends[0].tangent.y).toBeCloseTo(V.y, 9);
      expect(f.ends[1].tangent.x).toBeCloseTo(V.x, 9);
      expect(f.ends[1].tangent.y).toBeCloseTo(V.y + q.sy * R, 9);
      expect(f.center.x).toBeCloseTo(V.x + q.sx * R, 9);
      expect(f.center.y).toBeCloseTo(V.y + q.sy * R, 9);
      expect(f.mid.x).toBeCloseTo(V.x + q.sx * R * (1 - Math.SQRT1_2), 9);
      expect(f.mid.y).toBeCloseTo(V.y + q.sy * R * (1 - Math.SQRT1_2), 9);
      expect(f.tangentPt).toBeCloseTo(R, 9);
      expect(f.sweepDeg).toBeCloseTo(90, 9);
    }
  });
});

describe('raccordo: dove sta il vertice rispetto ai tratti', () => {
  const R = 10;
  const d1 = dirOf(0);
  const d2 = dirOf(90);
  it('V dentro un solo tratto: l\'altro tratto finisce nel vertice; si accorcia il tratto che lo attraversa dalla parte del clic, anche dall\'altra parte di V', () => {
    // il tratto 1 attraversa V; il tratto 2 va da V in su
    const s1 = tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 50));
    const s2 = tract(2, V, at(V, d2, 100), at(V, d2, 40));
    const res = filletFromSides(s1, s2, R, G0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fillet.ends[0].replace).toBe('a'); // si toglie la parte da -100 a +10, compresa quella dall'altra parte di V
    expect(res.fillet.ends[1].replace).toBe('a'); // il tratto 2 comincia in V: si sostituisce il suo primo punto
    const ex = expectedSheet(G0, V, [d1, d2], R);
    near(G0.userToSheet(res.fillet.ends[0].tangent), ex.t[0]);
    near(G0.userToSheet(res.fillet.ends[1].tangent), ex.t[1]);
  });
  it('V fuori da entrambi i tratti (si incontrano solo prolungati) ma con i punti di tangenza dentro i tratti', () => {
    // i tratti cominciano a 5 da V e arrivano a 100: R = 10 da' t = 10 (angolo di 90 gradi) e cade dentro entrambi
    const s1 = tract(1, at(V, d1, 5), at(V, d1, 100), at(V, d1, 50));
    const s2 = tract(2, at(V, d2, 5), at(V, d2, 100), at(V, d2, 50));
    const res = filletFromSides(s1, s2, R, G0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ex = expectedSheet(G0, V, [d1, d2], R);
    near(G0.userToSheet(res.fillet.ends[0].tangent), ex.t[0]);
    near(G0.userToSheet(res.fillet.ends[1].tangent), ex.t[1]);
    expect(res.fillet.ends[0].replace).toBe('a');
    // con un raggio piccolo il punto di tangenza cadrebbe nello spazio fra V e l'inizio del tratto (t = 3 < 5): "il tratto non arriva al raccordo"
    const small = filletFromSides(s1, s2, 3, G0);
    expect(small).toEqual({ ok: false, problem: 'gap', tract: 1 });
    expect(filletProblemText(small as { problem: 'gap'; tract: 1 })).toContain('tratto 1');
  });
  it('il tratto che sta tutto da una parte di V decide la parte tenuta, qualunque sia il clic (anche un clic oltre V)', () => {
    const s1 = tract(1, at(V, d1, 5), at(V, d1, 100), at(V, d1, -3)); // clic dall'altra parte di V: il tratto sta a destra
    const s2 = tract(2, at(V, d2, 5), at(V, d2, 100), at(V, d2, 50));
    const res = filletFromSides(s1, s2, R, G0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    near(G0.userToSheet(res.fillet.ends[0].tangent), expectedSheet(G0, V, [d1, d2], R).t[0]);
  });
  it('tratti che si toccano in V (estremi in V): si accorciano i loro estremi in V', () => {
    const s1 = tract(1, V, at(V, d1, 100), at(V, d1, 50));
    const s2 = tract(2, V, at(V, d2, 100), at(V, d2, 50));
    const res = filletFromSides(s1, s2, R, G0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fillet.ends.map((e) => e.replace)).toEqual(['a', 'a']);
  });
});

describe('raccordo: il punto di tangenza deve stare dentro il tratto', () => {
  const d1 = dirOf(0);
  const d2 = dirOf(90);
  it('raggio troppo grande per un solo tratto: rifiuto che nomina quale (tratto 1, poi tratto 2)', () => {
    // angolo 90: t = R. Tratto 1 lungo 100 dalla parte tenuta, tratto 2 lungo 40: con R = 60 esce solo il 2; con R = 120 esce il 1 (e anche il 2: si dice il primo)
    const s1 = tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 50));
    const s2 = tract(2, at(V, d2, -100), at(V, d2, 40), at(V, d2, 20));
    const r2 = filletFromSides(s1, s2, 60, G0);
    expect(r2).toEqual({ ok: false, problem: 'beyond', tract: 2 });
    expect(filletProblemText(r2 as { problem: 'beyond'; tract: 2 })).toContain('tratto 2');
    const s2long = tract(2, at(V, d2, -100), at(V, d2, 400), at(V, d2, 20));
    const r1 = filletFromSides(s1, s2long, 150, G0);
    expect(r1).toEqual({ ok: false, problem: 'beyond', tract: 1 });
    expect(filletProblemText(r1 as { problem: 'beyond'; tract: 1 })).toContain('tratto 1');
  });
  it('il residuo minimo del tratto e\' FILLET_MIN_REMAINDER_PT (come EXACT_MIN_DISTANCE_PT): al limite si accetta, subito sotto si rifiuta', () => {
    expect(FILLET_MIN_REMAINDER_PT).toBe(EXACT_MIN_DISTANCE_PT);
    const R = 10;
    const t = R / Math.tan(Math.PI / 4); // 10 (angolo di 90 gradi)
    const mk = (extra: number) => filletFromSides(tract(1, V, at(V, d1, t + FILLET_MIN_REMAINDER_PT + extra), at(V, d1, 5)), tract(2, V, at(V, d2, 100), at(V, d2, 5)), R, G0);
    expect(mk(1e-9).ok).toBe(true); // 1e-9 sopra il limite
    expect(mk(-1e-9)).toEqual({ ok: false, problem: 'beyond', tract: 1 }); // 1e-9 sotto il limite
    expect(mk(0.5).ok).toBe(true);
  });
});

describe('raccordo: rifiuti', () => {
  const d1 = dirOf(0);
  const s1 = tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 50));
  it('rette parallele o sulla stessa retta: stessa soglia di angular.ts (0,005 gradi)', () => {
    const mk = (deg: number) => filletFromSides(s1, tract(2, at({ x: V.x, y: V.y + 20 }, dirOf(deg), -100), at({ x: V.x, y: V.y + 20 }, dirOf(deg), 100), at({ x: V.x, y: V.y + 20 }, dirOf(deg), 50)), 10, G0);
    for (const deg of [0, 0.004, -0.004, 180, 179.996, 180.004]) expect(mk(deg)).toEqual({ ok: false, problem: 'parallel' });
    // appena sopra la soglia non sono piu' "parallele": con theta = 0,006 gradi le due rette a 20 di distanza ammettono un arco di raggio 10 (quasi una mezza circonferenza, sweep 179,994 gradi)
    for (const deg of [0.006, -0.006, 179.994]) {
      const r = mk(deg);
      expect(r).not.toEqual({ ok: false, problem: 'parallel' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fillet.sweepDeg).toBeCloseTo(179.994, 6);
    }
    expect(ANGLE_MIN_DEG).toBe(0.005);
    expect(filletProblemText({ problem: 'parallel' })).toContain('parallele');
  });
  it('clic sul vertice quando V sta dentro il tratto: rifiuto; a poca distanza dal vertice si accetta; se V e\' fuori dal tratto il clic non conta', () => {
    const s2 = (click: UserPoint) => tract(2, at(V, dirOf(90), -100), at(V, dirOf(90), 100), click);
    expect(filletFromSides(tract(1, at(V, d1, -100), at(V, d1, 100), V), s2(at(V, dirOf(90), 50)), 10, G0)).toEqual({ ok: false, problem: 'on-vertex' });
    expect(filletFromSides(tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 1e-7)), s2(at(V, dirOf(90), 50)), 10, G0)).toEqual({ ok: false, problem: 'on-vertex' });
    expect(filletFromSides(tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 1e-5)), s2(at(V, dirOf(90), 50)), 10, G0).ok).toBe(true);
    expect(filletFromSides(tract(1, at(V, d1, 20), at(V, d1, 100), V), s2(at(V, dirOf(90), 50)), 30, G0).ok).toBe(true); // t = 30 cade dentro il tratto che comincia a 20 da V
  });
  it('lo stesso tratto due volte: rifiuto (stesso oggetto e stesso indice)', () => {
    expect(filletFromSides(s1, { ...s1, click: at(V, d1, 70) }, 10, G0)).toEqual({ ok: false, problem: 'same-side' });
    expect(filletFromSides(s1, { ...s1, index: 1 }, 10, G0).ok === false && (filletFromSides(s1, { ...s1, index: 1 }, 10, G0) as { problem: string }).problem !== 'same-side').toBe(true);
  });
  it('raggio zero, negativo, NaN, infinito o sotto il minimo: rifiuto "radius"; al minimo si accetta', () => {
    const s2 = tract(2, at(V, dirOf(90), -100), at(V, dirOf(90), 100), at(V, dirOf(90), 50));
    for (const r of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, FILLET_MIN_RADIUS_PT * 0.99]) expect(filletFromSides(s1, s2, r, G0)).toEqual({ ok: false, problem: 'radius' });
    expect(filletFromSides(s1, s2, FILLET_MIN_RADIUS_PT, G0).ok).toBe(true);
  });
  it('angolo vicino a 180 gradi: l\'arco sotto 1 grado e\' rifiutato da arcProblem (stessa soglia), appena sopra e\' accettato', () => {
    expect(ARC_MIN_SWEEP_RAD).toBeCloseTo(DEG, 15);
    // parte tenuta: +d1 e un'altra direzione a theta gradi da +d1, con sweep = 180 - theta
    const mk = (sweepDeg: number) => {
      const theta = 180 - sweepDeg;
      const d2 = dirOf(theta);
      return filletFromSides(tract(1, at(V, d1, -L), at(V, d1, L), at(V, d1, 60)), tract(2, at(V, d2, -L), at(V, d2, L), at(V, d2, 60)), 10, G0);
    };
    const bad = mk(0.99);
    expect(bad).toMatchObject({ ok: false, problem: 'arc', arc: 'collinear' });
    expect(filletProblemText(bad as { problem: 'arc' })).toContain('1 grado');
    expect(mk(1.01).ok).toBe(true);
    expect(mk(0.5).ok).toBe(false);
    expect(mk(5).ok).toBe(true);
  });
  it('il vertice o i punti oltre i limiti (1.000.000 unita'+"'"+' utente) si rifiutano ("far")', () => {
    // due rette quasi parallele che si incontrano molto lontano (ma sopra la soglia di parallelismo)
    const far = filletFromSides(tract(1, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }), tract(2, { x: 0, y: 1 }, { x: 100, y: 1.0001 }, { x: 50, y: 1.00005 }), 1, G0);
    expect(far).toMatchObject({ ok: false });
    expect(['far', 'parallel', 'beyond', 'gap']).toContain((far as { problem: string }).problem);
    expect(filletFromSides(tract(1, { x: 0, y: 0 }, { x: 1e6, y: 0 }, { x: 5e5, y: 0 }), tract(2, { x: 1e6, y: -10 }, { x: 1e6, y: 10 }, { x: 1e6, y: 5 }), 5, G0, 1e6 - 1)).toEqual({ ok: false, problem: 'far' });
  });
});

describe('raccordo: raggio in mm reali (con scala) e in mm del foglio (senza scala)', () => {
  it('filletRadiusPt: con la scala mm / mmPerPt, senza scala mm in pt del foglio (stessa regola di gridStepPt)', () => {
    expect(filletRadiusPt(5, { mmPerPt: 0.5 })).toBeCloseTo(10, 12);
    expect(filletRadiusPt(5, null)).toBeCloseTo(mmToPt(5), 12);
    expect(filletRadiusPt(5, { mmPerPt: 2 })).toBeCloseTo(2.5, 12);
  });
  it('gli stessi punti di tangenza con R = 5 mm reali a scala mmPerPt = 0,5 e con R = 10 pt (= 3,5278 mm del foglio) senza scala', () => {
    const d1 = dirOf(0);
    const d2 = dirOf(60);
    const s1 = tract(1, at(V, d1, -100), at(V, d1, 100), at(V, d1, 40));
    const s2 = tract(2, at(V, d2, -100), at(V, d2, 100), at(V, d2, 40));
    const a = filletFromSides(s1, s2, filletRadiusPt(5, { mmPerPt: 0.5 }), G0);
    const b = filletFromSides(s1, s2, filletRadiusPt((10 * 25.4) / 72, null), G0);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    near(a.fillet.ends[0].tangent, b.fillet.ends[0].tangent, 1e-9);
    near(a.fillet.mid, b.fillet.mid, 1e-9);
    // e con UserUnit 2,5 il raggio e' in pt del foglio: la distanza di tangenza in unita' utente e' t / 2,5
    const g25 = new PageGeometry({ view: [0, 0, 300, 400], rotate: 0, userUnit: 2.5 });
    const c = filletFromSides(tract(1, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 100 }), tract(2, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 100, y: 150 }), 25, g25);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.fillet.ends[0].tangent.x).toBeCloseTo(110, 9); // t = 25 pt del foglio = 10 unita' utente
    expect(c.fillet.ends[1].tangent.y).toBeCloseTo(110, 9);
  });
});

describe('raccordo: coerenza con arcProblem e con la lettura del file', () => {
  it('un raccordo accettato ha sempre arcProblem(T1, M, T2) === null sui punti dello spazio utente', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      for (const theta of THETAS) {
        const d1 = dirOf(0);
        const d2 = dirOf(theta);
        const res = filletFromSides(tract(1, at(V, d1, -L), at(V, d1, L), at(V, d1, 60)), tract(2, at(V, d2, -L), at(V, d2, L), at(V, d2, 60)), 10, g);
        expect(res.ok).toBe(true);
        if (res.ok) expect(arcProblem(res.fillet.ends[0].tangent, res.fillet.mid, res.fillet.ends[1].tangent)).toBeNull();
      }
    }
  });
});
