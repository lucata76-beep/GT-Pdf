import { describe, expect, it } from 'vitest';
import {
  ANGLE_MIN_DEG,
  ARC_MAX_DEVIATION_PT,
  ARC_MAX_SEGMENTS,
  ARC_MAX_STEP_DEG,
  type AngularPoints,
  SIDE_STUB_PT,
  type PickedSide,
  angleDegrees,
  angularFromLines,
  angularFromPoints,
  angularGeometry,
  angularUserProblem,
  arcPoints,
  arcSegments,
  arcStepRad,
  pickSide,
} from './angular';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';

const DEG = Math.PI / 180;
const at = (c: UserPoint, r: number, deg: number): UserPoint => ({ x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) });
const sub = (a: SheetPoint, b: SheetPoint): SheetPoint => ({ x: a.x - b.x, y: a.y - b.y });
/** Direzione (gradi, [0, 360)) di un vettore nello spazio utente. */
const dirDeg = (v: UserPoint): number => ((Math.atan2(v.y, v.x) / DEG) % 360 + 360) % 360;
const angDiff = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const CASES = [0, 90, 180, 270].flatMap((rotate) => [1, 2.5].map((userUnit) => ({ rotate, userUnit })));
const geomOf = (c: { rotate: number; userUnit: number }): PageGeometry => new PageGeometry({ view: [50, 50, 450, 600], rotate: c.rotate, userUnit: c.userUnit });
const G0 = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const V: UserPoint = { x: 250, y: 300 };
const side = (id: number, a: UserPoint, b: UserPoint, index = 0): PickedSide => ({ id, index, a, b });

describe('angolo fra due rette nei quattro settori (calcolato con una formula indipendente)', () => {
  for (const c of CASES) {
    for (const theta of [30, 45, 90, 135, 179.99]) {
      it(`/Rotate ${c.rotate}, UserUnit ${c.userUnit}, theta ${theta}: i quattro settori danno theta, 180 - theta, theta, 180 - theta, con le semirette giuste`, () => {
        const g = geomOf(c);
        // due rette per V (direzioni 0 e theta), tratti lunghi 100 che attraversano V
        const s1 = side(1, at(V, 100, 180), at(V, 100, 0));
        const s2 = side(2, at(V, 100, theta + 180), at(V, 100, theta));
        // i quattro settori: (0, theta), (theta, 180), (180, 180 + theta), (180 + theta, 360), con le semirette che li delimitano
        const sectors = [
          { phi: theta / 2, expected: theta, r1: 0, r2: theta },
          { phi: (theta + 180) / 2, expected: 180 - theta, r1: 180, r2: theta },
          { phi: 180 + theta / 2, expected: theta, r1: 180, r2: theta + 180 },
          { phi: 180 + (theta + 180) / 2, expected: 180 - theta, r1: 0, r2: theta + 180 },
        ];
        for (const s of sectors) {
          const res = angularFromLines(s1, s2, at(V, 40, s.phi), g);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const deg = angleDegrees(res.points, g);
          expect(deg).not.toBeNull();
          expect(deg as number).toBeCloseTo(s.expected, 8);
          // il vertice e' V; p1 sulla semiretta del lato 1 e p2 su quella del lato 2, a distanza > 0
          expect(res.points.a.x).toBeCloseTo(V.x, 7);
          expect(res.points.a.y).toBeCloseTo(V.y, 7);
          const d1 = sub(res.points.p1, res.points.a);
          const d2 = sub(res.points.p2, res.points.a);
          expect(Math.hypot(d1.x, d1.y)).toBeGreaterThan(0);
          expect(Math.hypot(d2.x, d2.y)).toBeGreaterThan(0);
          expect(angDiff(dirDeg(d1), s.r1)).toBeLessThan(1e-6);
          expect(angDiff(dirDeg(d2), s.r2)).toBeLessThan(1e-6);
          // il raggio e' la distanza del punto dal vertice (40 unita' utente) e b sta sulla bisettrice
          const rb = sub(res.points.b, res.points.a);
          expect(Math.hypot(rb.x, rb.y)).toBeCloseTo(40, 7);
          const bis = (s.r1 + s.r2) / 2 + (Math.abs(s.r1 - s.r2) > 180 ? 180 : 0);
          expect(angDiff(dirDeg(rb), bis)).toBeLessThan(1e-6);
        }
      });
    }
  }
});

describe("vertice dentro e fuori dai tratti; p e' il punto del tratto piu' vicino all'arco", () => {
  // V = (400, 300). Tratto 1 orizzontale da (100,300) a (200,300): sulla semiretta a 180 gradi, a distanza 200..300 dal vertice.
  // Tratto 2 verticale da (400,450) a (400,550): sulla semiretta a 90 gradi, a distanza 150..250.
  const O: UserPoint = { x: 400, y: 300 };
  const s1 = side(1, { x: 100, y: 300 }, { x: 200, y: 300 });
  const s2 = side(2, { x: 400, y: 450 }, { x: 400, y: 550 });
  const rho = (p: UserPoint): number => Math.hypot(p.x - O.x, p.y - O.y);

  it('vertice fuori da entrambi i tratti: l\'angolo e\' 90 e p sta sulle semirette scelte', () => {
    const res = angularFromLines(s1, s2, at(O, 100, 135), G0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.points.a.x).toBeCloseTo(400, 7);
    expect(res.points.a.y).toBeCloseTo(300, 7);
    expect(angleDegrees(res.points, G0) as number).toBeCloseTo(90, 8);
    expect(angDiff(dirDeg(sub(res.points.p1, O)), 180)).toBeLessThan(1e-6);
    expect(angDiff(dirDeg(sub(res.points.p2, O)), 90)).toBeLessThan(1e-6);
  });

  it('R minore dell\'inizio dei tratti: p e\' l\'estremo piu\' vicino all\'arco (la linea di estensione torna indietro verso l\'arco)', () => {
    const res = angularFromLines(s1, s2, at(O, 100, 135), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(rho(res.points.p1)).toBeCloseTo(200, 7);
    expect(rho(res.points.p2)).toBeCloseTo(150, 7);
  });

  it('R dentro i tratti: p sta sul tratto, alla distanza dell\'arco (il lato tocca l\'arco)', () => {
    const res = angularFromLines(s1, s2, at(O, 220, 135), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(rho(res.points.p1)).toBeCloseTo(220, 7);
    expect(rho(res.points.p2)).toBeCloseTo(220, 7);
  });

  it('R oltre la fine dei tratti: p e\' l\'estremo piu\' lontano dal vertice (e piu\' vicino all\'arco)', () => {
    const res = angularFromLines(s1, s2, at(O, 400, 135), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(rho(res.points.p1)).toBeCloseTo(300, 7);
    expect(rho(res.points.p2)).toBeCloseTo(250, 7);
  });

  it('settore dalla parte opposta dei tratti: p sta a SIDE_STUB_PT dal vertice (il lato non tocca quella semiretta)', () => {
    const res = angularFromLines(s1, s2, at(O, 100, 315), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(angleDegrees(res.points, G0) as number).toBeCloseTo(90, 8);
    expect(angDiff(dirDeg(sub(res.points.p1, O)), 0)).toBeLessThan(1e-6);
    expect(angDiff(dirDeg(sub(res.points.p2, O)), 270)).toBeLessThan(1e-6);
    expect(rho(res.points.p1)).toBeCloseTo(SIDE_STUB_PT, 7);
    expect(rho(res.points.p2)).toBeCloseTo(SIDE_STUB_PT, 7);
  });

  it('con un raggio piccolo (2 pt) lo stub e\' al massimo meta\' del raggio', () => {
    const res = angularFromLines(s1, s2, at(O, 2, 315), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(rho(res.points.p1)).toBeCloseTo(1, 7);
    const res2 = angularFromLines(s1, s2, at(O, 1, 315), G0);
    if (!res2.ok) throw new Error('attesa ok');
    expect(rho(res2.points.p1)).toBeCloseTo(0.5, 7);
  });

  it('un tratto che ha il vertice come estremo e giace sulla semiretta scelta: p e\' sul tratto', () => {
    // angolo interno di un angolo di una Linea: tratti (0,0)-(300,300)... qui (400,300)-(600,300) e (400,300)-(400,500)
    const a = side(1, { x: 400, y: 300 }, { x: 600, y: 300 });
    const b = side(2, { x: 400, y: 300 }, { x: 400, y: 500 }, 1);
    const res = angularFromLines(a, b, at(O, 60, 45), G0);
    if (!res.ok) throw new Error('attesa ok');
    expect(angleDegrees(res.points, G0) as number).toBeCloseTo(90, 8);
    expect(rho(res.points.p1)).toBeCloseTo(60, 7);
    expect(rho(res.points.p2)).toBeCloseTo(60, 7);
    // il settore opposto (fuori dall'angolo della Linea): i tratti stanno dall'altra parte, quindi p e' lo stub
    const out = angularFromLines(a, b, at(O, 60, 225), G0);
    if (!out.ok) throw new Error('attesa ok');
    expect(rho(out.points.p1)).toBeCloseTo(SIDE_STUB_PT, 7);
  });
});

describe('rifiuti (tolleranza di parallelismo ' + ANGLE_MIN_DEG + ' gradi)', () => {
  const s1 = side(1, at(V, 100, 180), at(V, 100, 0));
  const withAngle = (deg: number): PickedSide => side(2, at(V, 100, deg + 180), at(V, 100, deg));

  it('lo stesso tratto due volte', () => {
    const r = angularFromLines(s1, side(1, s1.a, s1.b), at(V, 30, 45), G0);
    expect(r).toEqual({ ok: false, problem: 'same-side' });
    // due tratti diversi della stessa Linea sono ammessi
    const r2 = angularFromLines(side(7, { x: 100, y: 100 }, { x: 300, y: 100 }, 0), side(7, { x: 300, y: 100 }, { x: 300, y: 300 }, 1), { x: 250, y: 150 }, G0);
    expect(r2.ok).toBe(true);
  });

  it('rette parallele, antiparallele e sulla stessa retta', () => {
    const shifted = (dy: number, flip = false): PickedSide => side(2, { x: flip ? 400 : 100, y: V.y + dy }, { x: flip ? 100 : 400, y: V.y + dy });
    expect(angularFromLines(s1, shifted(50), at(V, 25, 90), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromLines(s1, shifted(50, true), at(V, 25, 90), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromLines(s1, side(2, at(V, 300, 0), at(V, 500, 0)), at(V, 25, 90), G0)).toEqual({ ok: false, problem: 'parallel' });
  });

  it('il limite di parallelismo: sotto 0.005 gradi si rifiuta, sopra si accetta (anche vicino a 180)', () => {
    expect(angularFromLines(s1, withAngle(0.004), at(V, 30, 0.002 + 90), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromLines(s1, withAngle(180 - 0.004), at(V, 30, 90), G0)).toEqual({ ok: false, problem: 'parallel' });
    for (const deg of [0.006, 0.01, 179.99, 179.994]) {
      const r = angularFromLines(s1, withAngle(deg), at(V, 30, 90), G0);
      expect(r.ok).toBe(true);
    }
    // l'angolo mostrato non e' mai 0.00 ne' 180.00
    const small = angularFromLines(s1, withAngle(0.006), at(V, 30, 0.003), G0);
    if (!small.ok) throw new Error('attesa ok');
    expect((angleDegrees(small.points, G0) as number).toFixed(2)).toBe('0.01');
    const big = angularFromLines(s1, withAngle(179.994), at(V, 30, 90 + 0.003), G0);
    if (!big.ok) throw new Error('attesa ok');
    expect((angleDegrees(big.points, G0) as number).toFixed(2)).toBe('179.99');
  });

  it('un tratto di lunghezza nulla non ha una direzione', () => {
    expect(angularFromLines(s1, side(2, V, V), at(V, 30, 45), G0)).toEqual({ ok: false, problem: 'parallel' });
  });

  it('il punto sul vertice o su una delle due rette non individua un settore', () => {
    const s2 = withAngle(60);
    expect(angularFromLines(s1, s2, V, G0)).toEqual({ ok: false, problem: 'at-vertex' });
    expect(angularFromLines(s1, s2, at(V, 80, 0), G0)).toEqual({ ok: false, problem: 'on-line' });
    expect(angularFromLines(s1, s2, at(V, 80, 180), G0)).toEqual({ ok: false, problem: 'on-line' });
    expect(angularFromLines(s1, s2, at(V, 80, 60), G0)).toEqual({ ok: false, problem: 'on-line' });
    expect(angularFromLines(s1, s2, at(V, 900, 240), G0)).toEqual({ ok: false, problem: 'on-line' }); // sul prolungamento, lontano dai tratti
    // appena fuori dalla tolleranza (1e-5 pt): si accetta
    expect(angularFromLines(s1, s2, { x: V.x + 80, y: V.y + 1e-5 }, G0).ok).toBe(true);
  });

  it('il vertice fuori dai limiti del foglio si rifiuta quando si passa un limite', () => {
    // seconda retta a 0.006 gradi dalla prima, a 150 pt di distanza: si incontrano a circa 1.43 milioni di pt dal foglio
    const k = Math.tan(0.006 * DEG);
    const nearlyParallel = side(2, { x: 100, y: 450 - 150 * k }, { x: 400, y: 450 + 150 * k });
    const r = angularFromLines(s1, nearlyParallel, { x: 300, y: 380 }, G0, 1_000_000);
    expect(r).toEqual({ ok: false, problem: 'far' });
    expect(angularFromLines(s1, nearlyParallel, { x: 300, y: 380 }, G0).ok).toBe(true);
  });
});

describe('modalita\' da tre punti', () => {
  it('angoli noti con vertice, due punti sui lati e il raggio: b sta sulla bisettrice a distanza R', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      for (const theta of [30, 45, 90, 135, 179.99]) {
        const r = angularFromPoints(V, at(V, 80, 17), at(V, 55, 17 + theta), at(V, 50, 200), g);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(angleDegrees(r.points, g) as number).toBeCloseTo(theta, 8);
        expect(r.points.p1).toEqual(at(V, 80, 17));
        expect(r.points.p2).toEqual(at(V, 55, 17 + theta));
        const rb = sub(r.points.b, V);
        expect(Math.hypot(rb.x, rb.y)).toBeCloseTo(50, 7);
        expect(angDiff(dirDeg(rb), 17 + theta / 2)).toBeLessThan(1e-6);
      }
    }
  });

  it('e\' sempre l\'angolo minore: scambiando i due lati l\'angolo e\' lo stesso e l\'arco passa dall\'altra parte', () => {
    const a = angularFromPoints(V, at(V, 80, 10), at(V, 80, 100), at(V, 50, 0), G0);
    const b = angularFromPoints(V, at(V, 80, 100), at(V, 80, 10), at(V, 50, 0), G0);
    if (!a.ok || !b.ok) throw new Error('attese ok');
    expect(angleDegrees(a.points, G0) as number).toBeCloseTo(90, 8);
    expect(angleDegrees(b.points, G0) as number).toBeCloseTo(90, 8);
    expect(a.points.b.x).toBeCloseTo(b.points.b.x, 7);
    expect(a.points.b.y).toBeCloseTo(b.points.b.y, 7);
    // oltre 180 gradi non esiste in questa tappa: lati a 10 e 350 gradi danno 20, non 340
    const c = angularFromPoints(V, at(V, 80, 10), at(V, 80, 350), at(V, 50, 0), G0);
    if (!c.ok) throw new Error('attesa ok');
    expect(angleDegrees(c.points, G0) as number).toBeCloseTo(20, 8);
  });

  it('rifiuta punti sul vertice e lati sulla stessa retta', () => {
    expect(angularFromPoints(V, V, at(V, 80, 40), at(V, 50, 0), G0)).toEqual({ ok: false, problem: 'at-vertex' });
    expect(angularFromPoints(V, at(V, 80, 40), V, at(V, 50, 0), G0)).toEqual({ ok: false, problem: 'at-vertex' });
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 80, 120), V, G0)).toEqual({ ok: false, problem: 'at-vertex' });
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 30, 40), at(V, 50, 0), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 30, 220), at(V, 50, 0), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 80, 40.004), at(V, 50, 0), G0)).toEqual({ ok: false, problem: 'parallel' });
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 80, 40.006), at(V, 50, 0), G0).ok).toBe(true);
  });

  it('il raggio non e\' piu\' lontano dei limiti del foglio', () => {
    expect(angularFromPoints(V, at(V, 80, 40), at(V, 80, 120), { x: 5_000_000, y: 0 }, G0, 1_000_000)).toEqual({ ok: false, problem: 'far' });
  });
});

describe('le due modalita\' danno lo stesso oggetto per gli stessi lati', () => {
  it('da due linee e poi da tre punti con i punti ottenuti: stessi quattro punti', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const s1 = side(1, at(V, 100, 180), at(V, 100, 0));
      const s2 = side(2, at(V, 100, 225), at(V, 100, 45));
      const lines = angularFromLines(s1, s2, at(V, 70, 100), g);
      if (!lines.ok) throw new Error('attesa ok');
      const pts = angularFromPoints(lines.points.a, lines.points.p1, lines.points.p2, lines.points.b, g);
      if (!pts.ok) throw new Error('attesa ok');
      for (const k of ['a', 'p1', 'p2', 'b'] as const) {
        expect(pts.points[k].x).toBeCloseTo(lines.points[k].x, 9);
        expect(pts.points[k].y).toBeCloseTo(lines.points[k].y, 9);
      }
      // la forma e' canonica: un secondo clic in un'altra direzione ma alla stessa distanza dal vertice da' lo stesso b
      const other = angularFromPoints(lines.points.a, lines.points.p1, lines.points.p2, at(lines.points.a, 70, 311), g);
      if (!other.ok) throw new Error('attesa ok');
      expect(other.points.b.x).toBeCloseTo(lines.points.b.x, 7);
      expect(other.points.b.y).toBeCloseTo(lines.points.b.y, 7);
    }
  });
});

describe('geometria dai punti salvati', () => {
  const pts = (deg: number): AngularPoints => ({ a: V, p1: at(V, 80, 0), p2: at(V, 80, deg), b: at(V, 50, deg / 2) });
  it('lo stesso angolo con /Rotate 0, 90, 180, 270, CropBox e UserUnit', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      for (const theta of [30, 45, 90, 135, 179.99]) expect(angleDegrees(pts(theta), g) as number).toBeCloseTo(theta, 9);
    }
  });
  it('null se i punti non sono una quota valida', () => {
    expect(angularGeometry({ ...pts(60), p1: V }, G0)).toBeNull();
    expect(angularGeometry({ ...pts(60), p2: V }, G0)).toBeNull();
    expect(angularGeometry({ ...pts(60), b: V }, G0)).toBeNull();
    expect(angularGeometry(pts(0), G0)).toBeNull();
    expect(angularGeometry(pts(180), G0)).toBeNull();
    expect(angularGeometry(pts(60), G0)).not.toBeNull();
  });
  it('angularUserProblem dice perche\' (per la lettura del file)', () => {
    expect(angularUserProblem(pts(60))).toBeNull();
    expect(angularUserProblem({ ...pts(60), p1: V })).toContain('p1');
    expect(angularUserProblem({ ...pts(60), p2: V })).toContain('p2');
    expect(angularUserProblem({ ...pts(60), b: V })).toContain('raggio');
    expect(angularUserProblem(pts(180))).toContain('stessa retta');
    expect(angularUserProblem(pts(0))).toContain('stessa retta');
    expect(angularUserProblem(pts(0.004))).toContain('stessa retta');
    expect(angularUserProblem(pts(0.006))).toBeNull();
  });
});

describe('arco a segmenti', () => {
  const geometry = (radius: number, deg: number): NonNullable<ReturnType<typeof angularGeometry>> => {
    const g = angularGeometry({ a: V, p1: at(V, 10, 20), p2: at(V, 10, 20 + deg), b: at(V, radius, 20 + deg / 2) }, G0);
    if (!g) throw new Error('attesa geometria');
    return g;
  };
  const maxSagitta = (pts: SheetPoint[], v: SheetPoint, r: number): number => {
    let m = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1] as SheetPoint;
      const b = pts[k] as SheetPoint;
      m = Math.max(m, r - Math.hypot((a.x + b.x) / 2 - v.x, (a.y + b.y) / 2 - v.y));
    }
    return m;
  };

  it('scarto massimo dal vero arco <= 0.02 pt e passo <= 2 gradi, per raggi piccoli e grandi', () => {
    for (const R of [0.5, 1, 5, 20, 100, 500, 5000, 20000, 60000]) {
      for (const deg of [1, 30, 90, 179.9, 0.5]) {
        const g = geometry(R, deg);
        const pts = arcPoints(g);
        expect(pts.length).toBe(arcSegments(R, g.angle) + 1);
        expect(arcSegments(R, g.angle)).toBeLessThanOrEqual(ARC_MAX_SEGMENTS);
        // tutti i punti stanno sulla circonferenza
        for (const p of pts) expect(Math.hypot(p.x - g.v.x, p.y - g.v.y)).toBeCloseTo(R, 6);
        // scarto massimo (distanza del punto medio di ogni corda dalla circonferenza, calcolata dai punti)
        expect(maxSagitta(pts, g.v, R)).toBeLessThanOrEqual(ARC_MAX_DEVIATION_PT + 1e-9);
        // ogni passo e' al massimo 2 gradi
        const step = g.angle / (pts.length - 1);
        expect(step).toBeLessThanOrEqual(ARC_MAX_STEP_DEG * DEG + 1e-12);
        expect(step).toBeLessThanOrEqual(arcStepRad(R) + 1e-12);
      }
    }
  });

  it('gli estremi sono esattamente vertice + raggio * versore dei due lati, e l\'arco va per la via breve', () => {
    for (const deg of [30, 135, 179.99]) {
      const g = geometry(80, deg);
      const pts = arcPoints(g);
      expect(pts[0]).toEqual({ x: g.v.x + g.u1.x * g.radius, y: g.v.y + g.u1.y * g.radius });
      expect(pts.at(-1)).toEqual({ x: g.v.x + g.u2.x * g.radius, y: g.v.y + g.u2.y * g.radius });
      // tutti i punti stanno nel settore (via breve): fra u1 e u2 rispetto al segno di sweep
      const sgn = Math.sign(g.sweep);
      for (const p of pts) {
        const w = sub(p, g.v);
        expect(sgn * (g.u1.x * w.y - g.u1.y * w.x)).toBeGreaterThanOrEqual(-1e-9);
        expect(sgn * (w.x * g.u2.y - w.y * g.u2.x)).toBeGreaterThanOrEqual(-1e-9);
      }
      // il punto di mezzo e' sulla bisettrice
      const half = pts[Math.floor(pts.length / 2)] as SheetPoint;
      if (pts.length % 2 === 1) {
        const w = sub(half, g.v);
        expect(w.x / g.radius).toBeCloseTo(g.mid.x, 9);
        expect(w.y / g.radius).toBeCloseTo(g.mid.y, 9);
      }
    }
  });

  it('il tetto al numero di segmenti: oltre ~64.000 pt lo scarto puo\' superare 0.02 (dichiarato), mai oltre 2000 segmenti', () => {
    const g = geometry(1_000_000, 179);
    expect(arcSegments(1_000_000, g.angle)).toBe(ARC_MAX_SEGMENTS);
    expect(arcPoints(g).length).toBe(ARC_MAX_SEGMENTS + 1);
    expect(maxSagitta(arcPoints(g), g.v, 1_000_000)).toBeGreaterThan(ARC_MAX_DEVIATION_PT);
    // a 60.000 pt con 179 gradi il tetto basta ancora
    const g2 = geometry(60_000, 179);
    expect(arcSegments(60_000, g2.angle)).toBeLessThanOrEqual(ARC_MAX_SEGMENTS);
    expect(maxSagitta(arcPoints(g2), g2.v, 60_000)).toBeLessThanOrEqual(ARC_MAX_DEVIATION_PT + 1e-9);
  });

  it('con 2 gradi di passo un angolo di 90 gradi a raggio piccolo ha 45 segmenti', () => {
    expect(arcSegments(10, 90 * DEG)).toBe(45);
    expect(arcSegments(10, 2 * DEG)).toBe(1);
    expect(arcSegments(10, 2.01 * DEG)).toBe(2);
  });
});

describe('scelta del tratto (pickSide)', () => {
  // Linea a tre tratti: (100,100)-(200,100), (200,100)-(200,200), (200,200)-(300,200); in spazio utente con G0 il foglio e' (x, 800 - y)
  const line = { id: 1, points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 200 }] };
  const sheet = (p: UserPoint): SheetPoint => G0.userToSheet(p);

  it('in una Linea sceglie il tratto piu\' vicino al clic', () => {
    expect(pickSide([line], G0, sheet({ x: 150, y: 103 }), 10)?.index).toBe(0);
    expect(pickSide([line], G0, sheet({ x: 197, y: 150 }), 10)?.index).toBe(1);
    expect(pickSide([line], G0, sheet({ x: 260, y: 196 }), 10)?.index).toBe(2);
    const p = pickSide([line], G0, sheet({ x: 150, y: 103 }), 10);
    expect(p).toEqual({ id: 1, index: 0, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } });
  });

  it('sceglie il PIU\' VICINO fra due oggetti a portata, anche se quello piu\' lontano e\' in primo piano', () => {
    const near = { id: 5, points: [{ x: 100, y: 300 }, { x: 300, y: 300 }] };
    const far = { id: 9, points: [{ x: 100, y: 306 }, { x: 300, y: 306 }] }; // disegnato dopo (in primo piano), ma piu' lontano dal clic
    expect(pickSide([near, far], G0, sheet({ x: 200, y: 302 }), 10)?.id).toBe(5);
    expect(pickSide([far, near], G0, sheet({ x: 200, y: 302 }), 10)?.id).toBe(5);
    expect(pickSide([near, far], G0, sheet({ x: 200, y: 305 }), 10)?.id).toBe(9);
  });

  it('a parita\' di distanza vince l\'ultimo (il piu\' in primo piano)', () => {
    const a = { id: 1, points: [{ x: 100, y: 300 }, { x: 300, y: 300 }] };
    const b = { id: 2, points: [{ x: 100, y: 304 }, { x: 300, y: 304 }] };
    expect(pickSide([a, b], G0, sheet({ x: 200, y: 302 }), 10)?.id).toBe(2);
    expect(pickSide([b, a], G0, sheet({ x: 200, y: 302 }), 10)?.id).toBe(1);
  });

  it('nessun oggetto entro la tolleranza: null; tratti di lunghezza nulla saltati', () => {
    expect(pickSide([line], G0, sheet({ x: 150, y: 140 }), 10)).toBeNull();
    expect(pickSide([], G0, sheet({ x: 150, y: 100 }), 10)).toBeNull();
    const degenerate = { id: 3, points: [{ x: 100, y: 500 }, { x: 100, y: 500 }, { x: 200, y: 500 }] };
    expect(pickSide([degenerate], G0, sheet({ x: 100, y: 500 }), 10)?.index).toBe(1);
    expect(pickSide([{ id: 4, points: [{ x: 100, y: 500 }, { x: 100, y: 500 }] }], G0, sheet({ x: 100, y: 500 }), 10)).toBeNull();
  });

  it('la tolleranza e\' in pt del foglio: con /Rotate 90 il tratto e\' dove si vede', () => {
    const g = new PageGeometry({ view: [0, 0, 600, 800], rotate: 90, userUnit: 1 });
    const seg = { id: 1, points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] };
    const mid = g.userToSheet({ x: 200, y: 100 });
    expect(pickSide([seg], g, { x: mid.x + 4, y: mid.y }, 5)?.id).toBe(1);
    expect(pickSide([seg], g, { x: mid.x + 6, y: mid.y }, 5)).toBeNull();
  });
});
