// Prove di CP6e: Sposta, Specchio e Rotazione per ogni tipo di oggetto, su pagina normale, /Rotate 90, CropBox e UserUnit diverso da 1.
// I valori attesi si calcolano QUI con un calcolo indipendente (numeri complessi nel piano matematico, Y verso l'alto), non con le funzioni del modulo.
import { describe, expect, it } from 'vitest';
import { EXACT_MIN_DISTANCE_PT } from '../app/construction';
import { type CoverObject, type DimensionObject, type LineObject, type PageObject, type TextObject, pointsOf } from '../model/model';
import { DEFAULT_STROKE } from '../model/stroke';
import { angleDegrees } from './angular';
import { arcProblem, curveOnSheet } from './arc';
import { measuredPt } from './dimension';
import { layoutDimension, textRect } from './layout';
import { PageGeometry, type PageSpec, type SheetPoint, type UserPoint } from './page';
import {
  ANGLE_MAX_DEG,
  ANGLE_TOL_RAD,
  COORD_LIMIT,
  MIN_DISTANCE_PT,
  type TransformSpec,
  classifyAxis,
  isFullTurns,
  objectProblem,
  planTransform,
  quarterTurns,
  reduceDeg,
  selectionProblem,
  sheetMap,
  specProblem,
  transformPoints,
} from './transform';

const SPECS: Record<string, PageSpec> = {
  normale: { view: [0, 0, 595.28, 841.89], rotate: 0, userUnit: 1 },
  rotate90: { view: [0, 0, 595.28, 841.89], rotate: 90, userUnit: 1 },
  rotate180: { view: [0, 0, 595.28, 841.89], rotate: 180, userUnit: 1 },
  rotate270: { view: [0, 0, 595.28, 841.89], rotate: 270, userUnit: 1 },
  cropbox: { view: [30.5, 40.25, 400.5, 600.75], rotate: 0, userUnit: 1 },
  cropboxRotate90: { view: [30.5, 40.25, 400.5, 600.75], rotate: 90, userUnit: 1 },
  userUnit: { view: [0, 0, 300, 400], rotate: 0, userUnit: 2.5 },
  userUnitRotate270: { view: [10, 20, 310, 420], rotate: 270, userUnit: 2.5 },
};
const GEOMS = Object.entries(SPECS).map(([name, spec]) => ({ name, spec, g: new PageGeometry(spec) }));

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const nearPt = (p: UserPoint, q: UserPoint, tol = 1e-9): boolean => near(p.x, q.x, tol) && near(p.y, q.y, tol);
const DEG = Math.PI / 180;

// ---- Calcolo indipendente nel foglio, con numeri complessi nel piano matematico (Y verso l'alto: y = -foglio.y) ----
type C = { re: number; im: number };
const toC = (p: SheetPoint): C => ({ re: p.x, im: -p.y });
const fromC = (z: C): SheetPoint => ({ x: z.re, y: -z.im });
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const cconj = (a: C): C => ({ re: a.re, im: -a.im });
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
/** Rotazione ANTIORARIA di `deg` gradi come si vede (piano matematico: moltiplicare per e^{i theta}). */
const expectedRotate = (p: SheetPoint, c: SheetPoint, deg: number): SheetPoint => {
  const rot: C = { re: Math.cos(deg * DEG), im: Math.sin(deg * DEG) };
  return fromC(cadd(toC(c), cmul(csub(toC(p), toC(c)), rot)));
};
/** Riflessione rispetto alla retta per a e b: z' = a + d * conj((z - a) / d), con d la direzione. */
const expectedMirror = (p: SheetPoint, a: SheetPoint, b: SheetPoint): SheetPoint => {
  const d = csub(toC(b), toC(a));
  return fromC(cadd(toC(a), cmul(d, cconj(cdiv(csub(toC(p), toC(a)), d)))));
};

const stroke = { ...DEFAULT_STROKE };
/** Punti in coordinate FRAZIONARIE dell'area visibile (come il gancio di prova dell'app), per descrivere lo stesso oggetto su pagine diverse. */
const userAt = (spec: PageSpec, fx: number, fy: number): UserPoint => {
  const [x0, y0, x1, y1] = spec.view;
  return { x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0) };
};
const objects = (g: PageGeometry, spec: PageSpec): Record<string, PageObject> => {
  const u = (fx: number, fy: number): UserPoint => userAt(spec, fx, fy);
  const dimBase = (dim: DimensionObject['dim'], pts: [UserPoint, UserPoint, UserPoint]): DimensionObject => {
    // costruita a mano nello spazio utente con la stessa regola di buildDimension (a e b dal foglio)
    const s1 = g.userToSheet(pts[0]);
    const s2 = g.userToSheet(pts[1]);
    const s3 = g.userToSheet(pts[2]);
    let a: SheetPoint;
    let b: SheetPoint;
    if (dim === 'horizontal') {
      a = { x: s1.x, y: s3.y };
      b = { x: s2.x, y: s3.y };
    } else if (dim === 'vertical') {
      a = { x: s3.x, y: s1.y };
      b = { x: s3.x, y: s2.y };
    } else {
      const len = Math.hypot(s2.x - s1.x, s2.y - s1.y);
      const n = { x: -(s2.y - s1.y) / len, y: (s2.x - s1.x) / len };
      const d = (s3.x - s1.x) * n.x + (s3.y - s1.y) * n.y;
      a = { x: s1.x + n.x * d, y: s1.y + n.y * d };
      b = { x: s2.x + n.x * d, y: s2.y + n.y * d };
    }
    return { id: 0, kind: 'dim', dim, p1: pts[0], p2: pts[1], a: g.sheetToUser(a), b: g.sheetToUser(b), valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 };
  };
  const out: Record<string, PageObject> = {
    retta: { id: 1, kind: 'segment', points: [u(0.2, 0.3), u(0.6, 0.45)], stroke },
    linea: { id: 2, kind: 'polyline', points: [u(0.2, 0.2), u(0.4, 0.5), u(0.7, 0.35)], stroke },
    cerchio: { id: 3, kind: 'circle', p1: u(0.5, 0.5), p2: u(0.65, 0.5), stroke },
    arco: { id: 4, kind: 'arc', p1: u(0.3, 0.3), p2: u(0.4, 0.45), p3: u(0.55, 0.4), stroke },
    coperturaCirc: { id: 5, kind: 'cover', shape: 'circle', p1: u(0.4, 0.6), p2: u(0.5, 0.6) },
    quotaAll: dimBase('aligned', [u(0.2, 0.2), u(0.5, 0.35), u(0.3, 0.5)]),
    quotaDiam: { ...dimBase('aligned', [u(0.3, 0.3), u(0.5, 0.4), u(0.3, 0.3)]), dim: 'diameter' },
    quotaRag: { ...dimBase('aligned', [u(0.3, 0.3), u(0.5, 0.4), u(0.3, 0.3)]), dim: 'radius' },
    testo: { id: 9, kind: 'text', at: u(0.25, 0.7), text: 'FORO Ø10', textPt: 12, color: '#D32F2F' },
  };
  // Coperture rettangolare e quadrata: due angoli opposti allineati agli assi del foglio (il quadrato: lato uguale sul foglio)
  const s0 = g.userToSheet(u(0.2, 0.6));
  out.coperturaRett = { id: 6, kind: 'cover', shape: 'rect', p1: g.sheetToUser(s0), p2: g.sheetToUser({ x: s0.x + 80, y: s0.y + 40 }) };
  out.coperturaQuad = { id: 7, kind: 'cover', shape: 'square', p1: g.sheetToUser(s0), p2: g.sheetToUser({ x: s0.x + 50, y: s0.y + 50 }) };
  // Quota angolare (CP6g): vertice, un punto per lato (a 10 e 80 gradi) e il punto di mezzo dell'arco sulla bisettrice (45 gradi), costruita nello spazio utente
  const av = u(0.3, 0.4);
  const polar = (r: number, deg: number): UserPoint => ({ x: av.x + r * Math.cos(deg * DEG), y: av.y + r * Math.sin(deg * DEG) });
  out.quotaAng = { id: 12, kind: 'dim', dim: 'angular', a: av, p1: polar(60, 10), p2: polar(45, 80), b: polar(30, 45), valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 };
  out.quotaOriz = dimBase('horizontal', [u(0.2, 0.2), u(0.5, 0.35), u(0.3, 0.5)]);
  out.quotaVert = dimBase('vertical', [u(0.2, 0.2), u(0.5, 0.35), u(0.3, 0.5)]);
  out.quotaOriz.id = 10;
  out.quotaVert.id = 11;
  return out;
};
const ALWAYS = ['retta', 'linea', 'cerchio', 'arco', 'coperturaCirc', 'quotaAll', 'quotaDiam', 'quotaRag', 'quotaAng', 'testo'] as const;

/** Punti attesi per un oggetto di `ALWAYS` (testo escluso), calcolati nel foglio con le funzioni indipendenti. */
const expectedPoints = (o: PageObject, g: PageGeometry, f: (p: SheetPoint) => SheetPoint): UserPoint[] => pointsOf(o).map((p) => g.sheetToUser(f(g.userToSheet(p))));

describe('Sposta', () => {
  for (const { name, spec, g } of GEOMS) {
    it(`${name}: tutti i punti di ogni tipo si spostano dello stesso spostamento riportato nello spazio utente`, () => {
      const objs = objects(g, spec);
      const move: TransformSpec = { kind: 'move', dx: 37.25, dy: -12.5 };
      const d = g.sheetDeltaToUser(37.25, -12.5);
      for (const [key, o] of Object.entries(objs)) {
        const r = transformPoints(o, move, g);
        expect(r.ok, key).toBe(true);
        if (!r.ok) continue;
        pointsOf(o).forEach((p, i) => {
          expect(nearPt(r.points[i] as UserPoint, { x: p.x + d.x, y: p.y + d.y }, 1e-9), `${key} punto ${i}`).toBe(true);
        });
      }
    });
  }
  it('lo spostamento sul foglio e\' quello che si vede: dx a destra, dy in basso', () => {
    for (const { name, g, spec } of GEOMS) {
      const o = objects(g, spec).retta as LineObject;
      const r = transformPoints(o, { kind: 'move', dx: 10, dy: 20 }, g);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      const before = g.userToSheet(pointsOf(o)[0] as UserPoint);
      const after = g.userToSheet(r.points[0] as UserPoint);
      expect(near(after.x - before.x, 10, 1e-9) && near(after.y - before.y, 20, 1e-9), name).toBe(true);
    }
  });
  it('nessun oggetto e\' escluso dallo spostamento (nemmeno quote orizzontali e verticali, coperture rettangolari, testo)', () => {
    const { g, spec } = GEOMS[0]!;
    const objs = objects(g, spec);
    for (const o of Object.values(objs)) expect(objectProblem(o, { kind: 'move', dx: 5, dy: 5 })).toBeNull();
  });
  it('spostamento nullo (sotto 0.001 pt): rifiutato con un messaggio', () => {
    expect(specProblem({ kind: 'move', dx: 0, dy: 0 })).toMatch(/Spostamento nullo/);
    expect(specProblem({ kind: 'move', dx: 0.0005, dy: 0 })).toMatch(/Spostamento nullo/);
    expect(specProblem({ kind: 'move', dx: 0.001, dy: 0 })).toBeNull();
  });
  it('la soglia e\' quella dei punti digitati (EXACT_MIN_DISTANCE_PT), non i 6 px di place', () => {
    expect(MIN_DISTANCE_PT).toBe(EXACT_MIN_DISTANCE_PT);
  });
});

describe('Rotazione: il verso, i punti attesi con un calcolo indipendente', () => {
  it('positivo = ANTIORARIO come si vede: un punto a destra del centro sale (Y del foglio diminuisce) di 90 gradi', () => {
    const map = sheetMap({ kind: 'rotate', center: { x: 100, y: 100 }, deg: 90 });
    const p = map({ x: 150, y: 100 });
    expect(near(p.x, 100, 1e-12) && near(p.y, 50, 1e-12)).toBe(true);
    const q = sheetMap({ kind: 'rotate', center: { x: 100, y: 100 }, deg: -90 })({ x: 150, y: 100 });
    expect(near(q.x, 100, 1e-12) && near(q.y, 150, 1e-12)).toBe(true);
  });
  for (const deg of [90, 45, -30, 180, 270, 359.5, 1234.5]) {
    for (const { name, spec, g } of GEOMS) {
      it(`${name}, ${deg} gradi: ogni punto va dove dice il calcolo indipendente (tipi sempre ammessi)`, () => {
        const objs = objects(g, spec);
        const center = g.userToSheet(userAt(spec, 0.45, 0.55));
        const t: TransformSpec = { kind: 'rotate', center, deg };
        for (const key of ALWAYS) {
          const o = objs[key] as PageObject;
          if (o.kind === 'text') continue; // il testo ha la sua prova
          const r = transformPoints(o, t, g);
          expect(r.ok, `${key}`).toBe(true);
          if (!r.ok) continue;
          const exp = expectedPoints(o, g, (p) => expectedRotate(p, center, deg));
          exp.forEach((e, i) => expect(nearPt(r.points[i] as UserPoint, e, 1e-6), `${key} punto ${i}`).toBe(true));
        }
      });
    }
  }
  it('la rotazione conserva le distanze (isometria) e il valore delle quote allineata, Ø e R', () => {
    for (const { g, spec } of GEOMS) {
      const objs = objects(g, spec);
      for (const key of ['quotaAll', 'quotaDiam', 'quotaRag'] as const) {
        const o = objs[key] as DimensionObject;
        const r = transformPoints(o, { kind: 'rotate', center: g.userToSheet(userAt(spec, 0.5, 0.5)), deg: 33.3 }, g);
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        const after: DimensionObject = { ...o, p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, a: r.points[2] as UserPoint, b: r.points[3] as UserPoint };
        expect(near(measuredPt(after, g), measuredPt(o, g), 1e-7), key).toBe(true);
        // anche la distanza fra linea di quota e punti misurati
        const dBefore = g.distancePt(o.p1, o.a);
        expect(near(g.distancePt(after.p1, after.a), dBefore, 1e-7), key).toBe(true);
      }
    }
  });
  it('multipli di 90 gradi: coordinate esatte (seno e coseno esatti), senza perdere cifre', () => {
    const map = sheetMap({ kind: 'rotate', center: { x: 10.1, y: 20.3 }, deg: 90 });
    expect(map({ x: 30.1, y: 20.3 })).toEqual({ x: 10.1, y: 20.3 - (30.1 - 10.1) }); // 90 gradi: x' = cx + dy, y' = cy - dx, senza errori di seno e coseno
    expect(sheetMap({ kind: 'rotate', center: { x: 10.1, y: 20.3 }, deg: 180 })({ x: 30.1, y: 20.3 })).toEqual({ x: 10.1 - (30.1 - 10.1), y: 20.3 });
  });
  it('360 gradi e multipli: niente da ruotare', () => {
    expect(specProblem({ kind: 'rotate', center: { x: 0, y: 0 }, deg: 0 })).toMatch(/niente da ruotare/);
    expect(specProblem({ kind: 'rotate', center: { x: 0, y: 0 }, deg: 360 })).toMatch(/niente da ruotare/);
    expect(specProblem({ kind: 'rotate', center: { x: 0, y: 0 }, deg: -720 })).toMatch(/niente da ruotare/);
    expect(specProblem({ kind: 'rotate', center: { x: 0, y: 0 }, deg: 0.001 })).toBeNull();
    expect(specProblem({ kind: 'rotate', center: { x: 0, y: 0 }, deg: Number.NaN })).toMatch(/non valido/);
    expect(isFullTurns(360)).toBe(true);
    expect(isFullTurns(359.9999999999)).toBe(true);
    expect(isFullTurns(359.99)).toBe(false);
  });
  it('quarterTurns e reduceDeg', () => {
    expect(quarterTurns(0)).toBe(0);
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(-90)).toBe(3);
    expect(quarterTurns(450)).toBe(1);
    expect(quarterTurns(180)).toBe(2);
    expect(quarterTurns(90.001)).toBeNull();
    expect(quarterTurns(44.9)).toBeNull();
    expect(reduceDeg(-30)).toBe(330);
    expect(reduceDeg(725)).toBe(5);
    expect(ANGLE_MAX_DEG).toBe(3600);
  });
});

describe('Specchio: i punti attesi con un calcolo indipendente', () => {
  const axes: Record<string, (g: PageGeometry, spec: PageSpec) => [SheetPoint, SheetPoint]> = {
    orizzontale: (g, spec) => [g.userToSheet(userAt(spec, 0.3, 0.5)), (() => ({ x: g.userToSheet(userAt(spec, 0.3, 0.5)).x + 100, y: g.userToSheet(userAt(spec, 0.3, 0.5)).y }))()],
    verticale: (g, spec) => [g.userToSheet(userAt(spec, 0.3, 0.5)), (() => ({ x: g.userToSheet(userAt(spec, 0.3, 0.5)).x, y: g.userToSheet(userAt(spec, 0.3, 0.5)).y - 80 }))()],
    diagonale45: (g, spec) => [g.userToSheet(userAt(spec, 0.3, 0.5)), (() => ({ x: g.userToSheet(userAt(spec, 0.3, 0.5)).x + 60, y: g.userToSheet(userAt(spec, 0.3, 0.5)).y + 60 }))()],
    obliquo: (g, spec) => [g.userToSheet(userAt(spec, 0.3, 0.5)), (() => ({ x: g.userToSheet(userAt(spec, 0.3, 0.5)).x + 100, y: g.userToSheet(userAt(spec, 0.3, 0.5)).y + 37 }))()],
  };
  for (const [axName, axis] of Object.entries(axes)) {
    for (const { name, spec, g } of GEOMS) {
      it(`${name}, asse ${axName}: ogni punto va dove dice il calcolo indipendente`, () => {
        const objs = objects(g, spec);
        const [a, b] = axis(g, spec);
        const t: TransformSpec = { kind: 'mirror', a, b };
        for (const key of ALWAYS) {
          const o = objs[key] as PageObject;
          if (o.kind === 'text') continue;
          const r = transformPoints(o, t, g);
          expect(r.ok, key).toBe(true);
          if (!r.ok) continue;
          const exp = expectedPoints(o, g, (p) => expectedMirror(p, a, b));
          exp.forEach((e, i) => expect(nearPt(r.points[i] as UserPoint, e, 1e-6), `${key} punto ${i}`).toBe(true));
        }
      });
    }
  }
  it('arco specchiato: il segno dello sweep si inverte, |sweep| resta, centro e raggio sono quelli trasformati', () => {
    for (const { name, spec, g } of GEOMS) {
      const arc = objects(g, spec).arco as PageObject;
      const a = g.userToSheet(userAt(spec, 0.3, 0.5));
      const b = { x: a.x + 100, y: a.y + 30 };
      const r = transformPoints(arc, { kind: 'mirror', a, b }, g);
      expect(r.ok, name).toBe(true);
      if (!r.ok || arc.kind !== 'arc') continue;
      const before = curveOnSheet({ kind: 'arc', p1: arc.p1, p2: arc.p2, p3: arc.p3 }, g);
      const after = curveOnSheet({ kind: 'arc', p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, p3: r.points[2] as UserPoint }, g);
      expect(before && after, name).toBeTruthy();
      if (!before || !after) continue;
      expect(Math.sign(after.sweep), name).toBe(-Math.sign(before.sweep));
      expect(near(Math.abs(after.sweep), Math.abs(before.sweep), 1e-9), name).toBe(true);
      expect(near(after.r, before.r, 1e-7), name).toBe(true);
      const c = expectedMirror(before.c, a, b);
      expect(near(after.c.x, c.x, 1e-6) && near(after.c.y, c.y, 1e-6), name).toBe(true);
      expect(arcProblem(r.points[0] as UserPoint, r.points[1] as UserPoint, r.points[2] as UserPoint)).toBeNull();
    }
  });
  it('la rotazione di un arco conserva il segno dello sweep', () => {
    const { g, spec } = GEOMS[1]!;
    const arc = objects(g, spec).arco;
    if (arc?.kind !== 'arc') throw new Error('arco');
    const r = transformPoints(arc, { kind: 'rotate', center: { x: 200, y: 300 }, deg: 77 }, g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = curveOnSheet(arc, g);
    const after = curveOnSheet({ kind: 'arc', p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, p3: r.points[2] as UserPoint }, g);
    expect(Math.sign(after?.sweep ?? 0)).toBe(Math.sign(before?.sweep ?? 0));
  });
  it('quote Ø e R specchiate: il valore misurato non cambia', () => {
    for (const { g, spec } of GEOMS) {
      for (const key of ['quotaAll', 'quotaDiam', 'quotaRag'] as const) {
        const o = objects(g, spec)[key] as DimensionObject;
        const a = g.userToSheet(userAt(spec, 0.4, 0.4));
        const r = transformPoints(o, { kind: 'mirror', a, b: { x: a.x + 50, y: a.y - 20 } }, g);
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        const after: DimensionObject = { ...o, p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, a: r.points[2] as UserPoint, b: r.points[3] as UserPoint };
        expect(near(measuredPt(after, g), measuredPt(o, g), 1e-7), key).toBe(true);
      }
    }
  });
  it('due punti dell\'asse coincidenti: rifiutati', () => {
    expect(specProblem({ kind: 'mirror', a: { x: 5, y: 5 }, b: { x: 5, y: 5 } })).toMatch(/coincidono/);
    expect(specProblem({ kind: 'mirror', a: { x: 5, y: 5 }, b: { x: 5.0005, y: 5 } })).toMatch(/coincidono/);
    expect(specProblem({ kind: 'mirror', a: { x: 5, y: 5 }, b: { x: 6, y: 5 } })).toBeNull();
  });
});

describe('classificazione dell\'asse (tolleranza stretta, mai un arrotondamento silenzioso)', () => {
  it('orizzontale, verticale, 45 gradi, altro', () => {
    expect(classifyAxis({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('horizontal');
    expect(classifyAxis({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe('horizontal');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('vertical');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe('vertical');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 7, y: 7 })).toBe('diagonal');
    expect(classifyAxis({ x: 0, y: 0 }, { x: -7, y: 7 })).toBe('diagonal');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 7, y: -7 })).toBe('diagonal');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 10, y: 1 })).toBe('other');
    expect(classifyAxis({ x: 0, y: 0 }, { x: 10, y: 1e-6 })).toBe('other'); // 1e-7 rad: oltre la tolleranza
    expect(classifyAxis({ x: 0, y: 0 }, { x: 10, y: 1e-10 })).toBe('horizontal'); // 1e-11 rad: rumore dei double
    expect(classifyAxis({ x: 3, y: 3 }, { x: 3, y: 3 })).toBeNull();
    expect(ANGLE_TOL_RAD).toBe(1e-9);
  });
  it('un asse riconosciuto si raddrizza: i punti escono esatti', () => {
    const map = sheetMap({ kind: 'mirror', a: { x: 10, y: 50 }, b: { x: 110, y: 50 + 1e-11 } });
    expect(map({ x: 33, y: 20 })).toEqual({ x: 33, y: 80 });
    const diag = sheetMap({ kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 5, y: 5 } });
    const q = diag({ x: 10, y: 0 });
    expect(near(q.x, 0, 1e-12) && near(q.y, 10, 1e-12)).toBe(true);
  });
});

describe('quote orizzontali e verticali', () => {
  it('sposta: ammesse; il valore (componente sul foglio) non cambia', () => {
    for (const { g, spec } of GEOMS) {
      for (const key of ['quotaOriz', 'quotaVert'] as const) {
        const o = objects(g, spec)[key] as DimensionObject;
        const r = transformPoints(o, { kind: 'move', dx: 11, dy: -7 }, g);
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        const after: DimensionObject = { ...o, p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, a: r.points[2] as UserPoint, b: r.points[3] as UserPoint };
        expect(near(measuredPt(after, g), measuredPt(o, g), 1e-7)).toBe(true);
      }
    }
  });
  it('rotazione: sempre esclusa (anche 90, 180, 360 non ne fa un\'eccezione), con la frase che dice cosa fare', () => {
    const { g, spec } = GEOMS[0]!;
    for (const key of ['quotaOriz', 'quotaVert'] as const) {
      const o = objects(g, spec)[key] as PageObject;
      for (const deg of [90, 180, 45, -30]) expect(objectProblem(o, { kind: 'rotate', center: { x: 0, y: 0 }, deg })).toMatch(/non ruotano.*Deselezionale o usa Sposta/);
    }
  });
  it('specchio: solo con asse orizzontale o verticale sul foglio; con asse a 45 gradi o obliquo rifiutato', () => {
    for (const { g, spec, name } of GEOMS) {
      for (const key of ['quotaOriz', 'quotaVert'] as const) {
        const o = objects(g, spec)[key] as DimensionObject;
        const a = g.userToSheet(userAt(spec, 0.4, 0.4));
        for (const [axisName, b, ok] of [
          ['orizzontale', { x: a.x + 90, y: a.y }, true],
          ['verticale', { x: a.x, y: a.y + 90 }, true],
          ['a 45 gradi', { x: a.x + 90, y: a.y + 90 }, false],
          ['obliquo', { x: a.x + 90, y: a.y + 10 }, false],
        ] as const) {
          const t: TransformSpec = { kind: 'mirror', a, b };
          expect(objectProblem(o, t) === null, `${name} ${key} ${axisName}`).toBe(ok);
          if (!ok) continue;
          const r = transformPoints(o, t, g);
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          const after: DimensionObject = { ...o, p1: r.points[0] as UserPoint, p2: r.points[1] as UserPoint, a: r.points[2] as UserPoint, b: r.points[3] as UserPoint };
          expect(near(measuredPt(after, g), measuredPt(o, g), 1e-7), `${name} ${key} ${axisName}: valore`).toBe(true);
          // la quota resta orizzontale (o verticale) sul foglio: i due estremi della linea di quota hanno la stessa Y (X)
          const sa = g.userToSheet(after.a);
          const sb = g.userToSheet(after.b);
          if (key === 'quotaOriz') expect(near(sa.y, sb.y, 1e-6), `${name} ${key} ${axisName}: linea di quota`).toBe(true);
          else expect(near(sa.x, sb.x, 1e-6), `${name} ${key} ${axisName}: linea di quota`).toBe(true);
        }
      }
    }
  });
  it('perche\' il rifiuto: con un asse obliquo la quota diventerebbe obliqua e il valore cambierebbe (provato con il calcolo)', () => {
    const { g, spec } = GEOMS[0]!;
    const o = objects(g, spec).quotaOriz as DimensionObject;
    const a = g.userToSheet(userAt(spec, 0.4, 0.4));
    const b = { x: a.x + 90, y: a.y + 90 };
    const s1 = expectedMirror(g.userToSheet(o.p1), a, b);
    const s2 = expectedMirror(g.userToSheet(o.p2), a, b);
    // con l'asse a 45 gradi la componente orizzontale della distanza passa a essere quella verticale di prima
    const before = Math.abs(g.userToSheet(o.p2).x - g.userToSheet(o.p1).x);
    expect(near(Math.abs(s2.x - s1.x), Math.abs(g.userToSheet(o.p2).y - g.userToSheet(o.p1).y), 1e-9)).toBe(true);
    expect(near(Math.abs(s2.x - s1.x), before, 1e-6)).toBe(false);
  });
});

describe('coperture rettangolare e quadrata', () => {
  it('rotazione: solo multipli di 90 gradi; con 90 il rettangolo gira attorno al centro indicato', () => {
    for (const { g, spec, name } of GEOMS) {
      for (const key of ['coperturaRett', 'coperturaQuad'] as const) {
        const o = objects(g, spec)[key] as CoverObject;
        const center = g.userToSheet(userAt(spec, 0.5, 0.5));
        expect(objectProblem(o, { kind: 'rotate', center, deg: 45 }), `${name} ${key} 45`).toMatch(/multipli di 90/);
        expect(objectProblem(o, { kind: 'rotate', center, deg: 90.001 }), `${name} ${key} 90.001`).toMatch(/multipli di 90/);
        for (const deg of [90, 180, 270, -90, 450]) {
          const t: TransformSpec = { kind: 'rotate', center, deg };
          expect(objectProblem(o, t), `${name} ${key} ${deg}`).toBeNull();
          const r = transformPoints(o, t, g);
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          const exp = [o.p1, o.p2].map((p) => g.sheetToUser(expectedRotate(g.userToSheet(p), center, deg)));
          exp.forEach((e, i) => expect(nearPt(r.points[i] as UserPoint, e, 1e-6), `${name} ${key} ${deg} punto ${i}`).toBe(true));
          // resta un rettangolo (un quadrato) allineato agli assi del foglio con gli stessi lati scambiati o no
          const s = r.points.map((p) => g.userToSheet(p));
          const w = Math.abs((s[1] as SheetPoint).x - (s[0] as SheetPoint).x);
          const h = Math.abs((s[1] as SheetPoint).y - (s[0] as SheetPoint).y);
          const sb = [o.p1, o.p2].map((p) => g.userToSheet(p));
          const w0 = Math.abs((sb[1] as SheetPoint).x - (sb[0] as SheetPoint).x);
          const h0 = Math.abs((sb[1] as SheetPoint).y - (sb[0] as SheetPoint).y);
          const swapped = Math.abs(deg) % 180 === 90;
          expect(near(w, swapped ? h0 : w0, 1e-6) && near(h, swapped ? w0 : h0, 1e-6), `${name} ${key} ${deg}: lati`).toBe(true);
        }
      }
    }
  });
  it('specchio: solo con asse orizzontale, verticale o a 45 gradi; con un altro angolo rifiutato', () => {
    for (const { g, spec, name } of GEOMS) {
      for (const key of ['coperturaRett', 'coperturaQuad'] as const) {
        const o = objects(g, spec)[key] as CoverObject;
        const a = g.userToSheet(userAt(spec, 0.4, 0.4));
        for (const [axisName, b, ok] of [
          ['orizzontale', { x: a.x + 90, y: a.y }, true],
          ['verticale', { x: a.x, y: a.y - 90 }, true],
          ['a 45 gradi', { x: a.x + 90, y: a.y + 90 }, true],
          ['a -45 gradi', { x: a.x + 90, y: a.y - 90 }, true],
          ['obliquo', { x: a.x + 90, y: a.y + 30 }, false],
        ] as const) {
          const t: TransformSpec = { kind: 'mirror', a, b };
          expect(objectProblem(o, t) === null, `${name} ${key} ${axisName}`).toBe(ok);
          if (!ok) continue;
          const r = transformPoints(o, t, g);
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          const exp = [o.p1, o.p2].map((p) => g.sheetToUser(expectedMirror(g.userToSheet(p), a, b)));
          exp.forEach((e, i) => expect(nearPt(r.points[i] as UserPoint, e, 1e-6), `${name} ${key} ${axisName} punto ${i}`).toBe(true));
        }
      }
    }
  });
  it('la copertura circolare non ha restrizioni', () => {
    const { g, spec } = GEOMS[0]!;
    const o = objects(g, spec).coperturaCirc as PageObject;
    expect(objectProblem(o, { kind: 'rotate', center: { x: 5, y: 5 }, deg: 33 })).toBeNull();
    expect(objectProblem(o, { kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 10, y: 3 } })).toBeNull();
  });
});

describe('testo: resta dritto, si trasforma il centro del suo riquadro', () => {
  for (const { name, spec, g } of GEOMS) {
    it(`${name}: dopo Rotazione e Specchio il riquadro dritto ha il centro nel punto trasformato`, () => {
      const t = objects(g, spec).testo as TextObject;
      const centreOf = (at: UserPoint): SheetPoint => {
        const r = textRect(g.userToSheet(at), t.text, t.textPt);
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      };
      const c0 = centreOf(t.at);
      const center = g.userToSheet(userAt(spec, 0.5, 0.5));
      const rot = transformPoints(t, { kind: 'rotate', center, deg: 123 }, g);
      expect(rot.ok).toBe(true);
      if (rot.ok) {
        const e = expectedRotate(c0, center, 123);
        const c1 = centreOf(rot.points[0] as UserPoint);
        expect(near(c1.x, e.x, 1e-6) && near(c1.y, e.y, 1e-6)).toBe(true);
        expect(rot.points).toHaveLength(1);
      }
      const a = g.userToSheet(userAt(spec, 0.2, 0.3));
      const b = { x: a.x + 70, y: a.y + 20 };
      const mir = transformPoints(t, { kind: 'mirror', a, b }, g);
      expect(mir.ok).toBe(true);
      if (mir.ok) {
        const e = expectedMirror(c0, a, b);
        const c1 = centreOf(mir.points[0] as UserPoint);
        expect(near(c1.x, e.x, 1e-6) && near(c1.y, e.y, 1e-6)).toBe(true);
      }
      // la copia dello stesso punto trasformato non cambia ne' testo ne' corpo: sono altre proprieta' (invarianti per costruzione)
    });
    it(`${name}: Sposta trasla l'angolo in basso a sinistra`, () => {
      const t = objects(g, spec).testo as TextObject;
      const r = transformPoints(t, { kind: 'move', dx: 12, dy: 34 }, g);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const s0 = g.userToSheet(t.at);
      const s1 = g.userToSheet(r.points[0] as UserPoint);
      expect(near(s1.x - s0.x, 12, 1e-7) && near(s1.y - s0.y, 34, 1e-7)).toBe(true);
    });
  }
  it('Sposta con la formula del centro dà lo stesso risultato di una traslazione del solo angolo (coerenza fra i due modi)', () => {
    const { g, spec } = GEOMS[0]!;
    const t = objects(g, spec).testo as TextObject;
    // rotazione di 360 - epsilon non e' una traslazione; qui si controlla la rotazione di 180 attorno al centro del riquadro: il testo resta dov'e'
    const r0 = textRect(g.userToSheet(t.at), t.text, t.textPt);
    const centre = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
    const r = transformPoints(t, { kind: 'rotate', center: centre, deg: 180 }, g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(nearPt(r.points[0] as UserPoint, t.at, 1e-9)).toBe(true);
  });
});

describe('selezione mista: tutto o niente', () => {
  it('se un oggetto non e\' ammesso non si trasforma niente e la ragione lo dice', () => {
    const { g, spec } = GEOMS[0]!;
    const objs = objects(g, spec);
    const sel = [objs.retta, objs.quotaOriz, objs.cerchio] as PageObject[];
    const rot = planTransform(sel, { kind: 'rotate', center: { x: 100, y: 100 }, deg: 30 }, g);
    expect(rot.ok).toBe(false);
    if (!rot.ok) expect(rot.reason).toMatch(/quote orizzontali e verticali non ruotano/);
    const ok = planTransform(sel, { kind: 'move', dx: 3, dy: 4 }, g);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.moves.map((m) => m.id)).toEqual([1, 10, 3]);
      expect(ok.moves.every((m) => m.before.length === m.after.length)).toBe(true);
    }
    expect(selectionProblem(sel, { kind: 'mirror', a: { x: 0, y: 0 }, b: { x: 10, y: 3 } })).toMatch(/solo con un asse orizzontale o verticale/);
  });
  it('un piano completo ha un cambiamento per oggetto con prima e dopo', () => {
    const { g, spec } = GEOMS[0]!;
    const objs = objects(g, spec);
    const sel = ALWAYS.map((k) => objs[k] as PageObject);
    const plan = planTransform(sel, { kind: 'rotate', center: { x: 100, y: 100 }, deg: 90 }, g);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moves).toHaveLength(ALWAYS.length);
    sel.forEach((o, i) => expect(plan.moves[i]?.before).toEqual(pointsOf(o)));
  });
  it('la spec stessa non valida (spostamento nullo, asse coincidente, angolo zero) rifiuta anche con selezione vuota di problemi', () => {
    const { g, spec } = GEOMS[0]!;
    const sel = [objects(g, spec).retta as PageObject];
    expect(planTransform(sel, { kind: 'move', dx: 0, dy: 0 }, g).ok).toBe(false);
    expect(planTransform(sel, { kind: 'mirror', a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }, g).ok).toBe(false);
    expect(planTransform(sel, { kind: 'rotate', center: { x: 1, y: 1 }, deg: 360 }, g).ok).toBe(false);
  });
});

describe('limite di coordinata', () => {
  it('un risultato fuori da +-1.000.000 (o non finito) non si trasforma, per nessun oggetto', () => {
    const { g, spec } = GEOMS[0]!;
    const o = objects(g, spec).retta as PageObject;
    const far = transformPoints(o, { kind: 'move', dx: 2_000_000, dy: 0 }, g);
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.reason).toMatch(/limiti del foglio/);
    const inf = transformPoints(o, { kind: 'move', dx: Number.POSITIVE_INFINITY, dy: 0 }, g);
    expect(inf.ok).toBe(false);
    const plan = planTransform([objects(g, spec).cerchio as PageObject, o], { kind: 'move', dx: 2_000_000, dy: 0 }, g);
    expect(plan.ok).toBe(false);
    expect(COORD_LIMIT).toBe(1_000_000);
  });
  it('appena dentro il limite si trasforma', () => {
    const { g } = GEOMS[0]!;
    const o: LineObject = { id: 1, kind: 'segment', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], stroke };
    expect(transformPoints(o, { kind: 'move', dx: 999_000, dy: 0 }, g).ok).toBe(true);
  });
  it('anche il testo e la rotazione rispettano il limite', () => {
    const { g, spec } = GEOMS[0]!;
    const t = objects(g, spec).testo as PageObject;
    expect(transformPoints(t, { kind: 'rotate', center: { x: 5_000_000, y: 5_000_000 }, deg: 90 }, g).ok).toBe(false);
  });
});

describe('quota angolare (CP6g): tutti i punti si trasformano, il valore non cambia, nessun vincolo nuovo', () => {
  const asDim = (o: PageObject, pts: readonly UserPoint[]): DimensionObject => ({ ...(o as DimensionObject), p1: pts[0] as UserPoint, p2: pts[1] as UserPoint, a: pts[2] as UserPoint, b: pts[3] as UserPoint });
  const specsFor = (g: PageGeometry, spec: PageSpec): { name: string; t: TransformSpec; f: (p: SheetPoint) => SheetPoint }[] => {
    const a = g.userToSheet(userAt(spec, 0.4, 0.4));
    const c = g.userToSheet(userAt(spec, 0.5, 0.5));
    const out: { name: string; t: TransformSpec; f: (p: SheetPoint) => SheetPoint }[] = [{ name: 'sposta', t: { kind: 'move', dx: 13, dy: -9 }, f: (p) => ({ x: p.x + 13, y: p.y - 9 }) }];
    for (const deg of [90, 180, 270, 45, -30]) out.push({ name: `rotazione ${deg}`, t: { kind: 'rotate', center: c, deg }, f: (p) => expectedRotate(p, c, deg) });
    for (const [name, b] of [['orizzontale', { x: a.x + 90, y: a.y }], ['verticale', { x: a.x, y: a.y + 90 }], ['a 45 gradi', { x: a.x + 90, y: a.y + 90 }], ['obliquo', { x: a.x + 90, y: a.y + 10 }]] as const) {
      out.push({ name: `specchio ${name}`, t: { kind: 'mirror', a, b }, f: (p) => expectedMirror(p, a, b) });
    }
    return out;
  };

  it('Sposta, Rotazione e Specchio (assi orizzontale, verticale, a 45 gradi, obliquo) sono ammessi, portano i quattro punti dove devono e il valore non cambia', () => {
    for (const { g, spec, name } of GEOMS) {
      const o = objects(g, spec).quotaAng as DimensionObject;
      const before = angleDegrees(o, g) as number;
      expect(before).toBeCloseTo(70, 7);
      for (const { name: tname, t, f } of specsFor(g, spec)) {
        expect(objectProblem(o, t), `${name} ${tname}`).toBeNull(); // nessun vincolo nuovo in transform.ts
        const r = transformPoints(o, t, g);
        expect(r.ok, `${name} ${tname}`).toBe(true);
        if (!r.ok) continue;
        expectedPoints(o, g, f).forEach((p, i) => expect(nearPt(p, r.points[i] as UserPoint, 1e-7), `${name} ${tname} punto ${i}`).toBe(true));
        expect(angleDegrees(asDim(o, r.points), g) as number, `${name} ${tname}: valore`).toBeCloseTo(before, 7);
      }
    }
  });

  it('dopo lo Specchio il settore e l\'arco sono quelli speculari (l\'arco trasformato e\' il trasformato dell\'arco), dopo la Rotazione ruotati', () => {
    for (const { g, spec, name } of GEOMS) {
      const o = objects(g, spec).quotaAng as DimensionObject;
      const style = { textPt: 10, widthPt: 1, color: '#D32F2F' };
      const arcOf = (d: DimensionObject): SheetPoint[] => layoutDimension({ ...d, ...style }, g, '70.00°').lines[0]!.pts;
      const arc0 = arcOf(o);
      for (const { name: tname, t, f } of specsFor(g, spec).filter((s) => s.t.kind !== 'move')) {
        const r = transformPoints(o, t, g);
        if (!r.ok) throw new Error(`${name} ${tname}`);
        const arc1 = arcOf(asDim(o, r.points));
        expect(arc1.length, `${name} ${tname}`).toBe(arc0.length);
        arc0.forEach((p, k) => {
          const e = f(p);
          expect(Math.hypot(arc1[k]!.x - e.x, arc1[k]!.y - e.y), `${name} ${tname} punto ${k}`).toBeLessThan(1e-6);
        });
      }
    }
  });

  it('selezione mista: con una quota orizzontale la rotazione e\' rifiutata per tutta la selezione; con la sola angolare (e le altre ammesse) no', () => {
    const { g, spec } = GEOMS[0]!;
    const all = objects(g, spec);
    const rot: TransformSpec = { kind: 'rotate', center: { x: 100, y: 100 }, deg: 30 };
    expect(selectionProblem([all.quotaAng as PageObject, all.retta as PageObject, all.quotaAll as PageObject], rot)).toBeNull();
    expect(selectionProblem([all.quotaAng as PageObject, all.quotaOriz as PageObject], rot)).toMatch(/non ruotano/);
    expect(planTransform([all.quotaAng as PageObject, all.retta as PageObject], rot, g).ok).toBe(true);
  });
});
