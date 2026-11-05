import { describe, expect, it } from 'vitest';
import {
  ARC_MAX_RADIUS,
  ARC_MIN_SWEEP_RAD,
  BEZIER_MAX_SEGMENT_RAD,
  FULL_TURN,
  type SheetArc,
  arcBeziers,
  arcEnd,
  arcMid,
  arcPointAt,
  arcProblem,
  arcStart,
  arcThroughPoints,
  circleFromCenterEdge,
  cubicAt,
  distToArc,
  isFullCircle,
  svgArcPath,
} from './arc';
import { PageGeometry } from './page';

const DEG = Math.PI / 180;
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const onCircle = (p: { x: number; y: number }, c: { x: number; y: number }, r: number, tol = 1e-9): boolean => near(Math.hypot(p.x - c.x, p.y - c.y), r, tol);
/** Punto sulla circonferenza (centro c, raggio r) all'angolo `deg` (angolo crescente = verso orario con Y in giu'). */
const at = (c: { x: number; y: number }, r: number, deg: number) => ({ x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) });

describe('cerchio dal centro e da un punto sul bordo', () => {
  it('centro, raggio = distanza, giro intero che parte dall\'angolo 0', () => {
    const a = circleFromCenterEdge({ x: 100, y: 50 }, { x: 103, y: 54 });
    expect(a).toEqual({ c: { x: 100, y: 50 }, r: 5, a0: 0, sweep: FULL_TURN });
    expect(a && isFullCircle(a)).toBe(true);
  });
  it('due punti coincidenti: nessun cerchio', () => {
    expect(circleFromCenterEdge({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('arco per tre punti: centro, raggio, angoli, verso', () => {
  it('cerchio unitario: centro e raggio', () => {
    const a = arcThroughPoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }) as SheetArc;
    expect(near(a.c.x, 0) && near(a.c.y, 0) && near(a.r, 1)).toBe(true);
  });
  it('angoli di inizio e fine: da p1 a p3, e il verso e\' quello in cui si incontrano p1, p2, p3 (Y in giu\': angolo crescente = orario)', () => {
    const c = { x: 40, y: -7 };
    const r = 25;
    const cw = arcThroughPoints(at(c, r, 10), at(c, r, 80), at(c, r, 130)) as SheetArc; // angoli crescenti
    expect(near(cw.sweep, 120 * DEG)).toBe(true);
    expect(near(cw.a0, 10 * DEG)).toBe(true);
    const ccw = arcThroughPoints(at(c, r, 130), at(c, r, 80), at(c, r, 10)) as SheetArc; // angoli decrescenti
    expect(near(ccw.sweep, -120 * DEG)).toBe(true);
    expect(near(ccw.a0, 130 * DEG)).toBe(true);
  });
  it('p2 puo\' stare sull\'arco lungo (piu\' di 180 gradi) e l\'arco passa comunque da p2', () => {
    const c = { x: 0, y: 0 };
    const p1 = at(c, 10, 0);
    const p2 = at(c, 10, 200);
    const p3 = at(c, 10, 300);
    const a = arcThroughPoints(p1, p2, p3) as SheetArc;
    expect(near(a.sweep, 300 * DEG)).toBe(true);
    expect(distToArc(p2, a)).toBeLessThan(1e-9);
    // la stessa terna in ordine inverso e' lo stesso cerchio, percorso al contrario, ancora per p2
    const b = arcThroughPoints(p3, p2, p1) as SheetArc;
    expect(b.sweep).toBeLessThan(0);
    expect(near(Math.abs(b.sweep), 300 * DEG)).toBe(true);
    expect(distToArc(p2, b)).toBeLessThan(1e-9);
  });
  it('proprieta\': 500 terne casuali: estremi = p1 e p3, p2 sull\'arco e tra gli estremi, raggio coerente', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let n = 0;
    for (let i = 0; i < 500; i++) {
      const p = [0, 1, 2].map(() => ({ x: rnd() * 1000 - 500, y: rnd() * 1000 - 500 }));
      const a = arcThroughPoints(p[0]!, p[1]!, p[2]!);
      if (!a) continue;
      n++;
      const s = arcStart(a);
      const e = arcEnd(a);
      expect(near(s.x, p[0]!.x, 1e-6) && near(s.y, p[0]!.y, 1e-6)).toBe(true);
      expect(near(e.x, p[2]!.x, 1e-6) && near(e.y, p[2]!.y, 1e-6)).toBe(true);
      expect(distToArc(p[1]!, a)).toBeLessThan(1e-6);
      for (const q of p) expect(onCircle(q, a.c, a.r, 1e-6)).toBe(true);
      expect(Math.abs(a.sweep)).toBeGreaterThan(0);
      expect(Math.abs(a.sweep)).toBeLessThan(FULL_TURN);
    }
    expect(n).toBeGreaterThan(450);
  });
  it('coordinate grandi con una piccola differenza: il calcolo parte da p1 e non perde il centro', () => {
    const c = { x: 5_000_000, y: -4_000_000 };
    const a = arcThroughPoints(at(c, 100, 20), at(c, 100, 60), at(c, 100, 110)) as SheetArc;
    expect(near(a.c.x, c.x, 1e-3) && near(a.c.y, c.y, 1e-3) && near(a.r, 100, 1e-3)).toBe(true);
  });
});

describe('punto a meta\' dell\'arco', () => {
  it('e\' sull\'arco a meta\' dello sweep e NON e\' il punto di passaggio indicato', () => {
    const c = { x: 0, y: 0 };
    const p2 = at(c, 10, 30); // vicino all'inizio
    const a = arcThroughPoints(at(c, 10, 0), p2, at(c, 10, 180)) as SheetArc;
    const m = arcMid(a);
    expect(near(m.x, 0, 1e-9) && near(m.y, 10, 1e-9)).toBe(true); // 90 gradi: (0, 10)
    expect(Math.hypot(m.x - p2.x, m.y - p2.y)).toBeGreaterThan(5);
    expect(distToArc(m, a)).toBeLessThan(1e-9);
  });
  it('con verso antiorario e con sweep oltre 180 gradi', () => {
    const c = { x: 0, y: 0 };
    const a = arcThroughPoints(at(c, 10, 0), at(c, 10, -100), at(c, 10, -270)) as SheetArc; // decrescente, 270 gradi
    expect(near(a.sweep, -270 * DEG)).toBe(true);
    const m = arcMid(a); // angolo -135 gradi
    expect(near(m.x, 10 * Math.cos(-135 * DEG)) && near(m.y, 10 * Math.sin(-135 * DEG))).toBe(true);
  });
});

describe('allineamento e raggio massimo', () => {
  const line = (t: number, off = 0) => ({ x: t, y: off });
  it('tre punti esattamente allineati o coincidenti: nessun cerchio e problema "collinear"', () => {
    expect(arcThroughPoints({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 })).toBeNull();
    expect(arcProblem({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 })).toBe('collinear');
    expect(arcProblem({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBe('collinear');
    expect(arcProblem({ x: 3, y: 3 }, { x: 8, y: 1 }, { x: 3, y: 3 })).toBe('collinear'); // inizio = fine
  });
  it('la soglia e\' 1 grado di sweep: sotto e\' "collinear", sopra va bene', () => {
    expect(ARC_MIN_SWEEP_RAD).toBeCloseTo(Math.PI / 180, 15);
    const c = { x: 0, y: 0 };
    const make = (deg: number) => [at(c, 100, 0), at(c, 100, deg / 2), at(c, 100, deg)] as const;
    expect(arcProblem(...make(0.9))).toBe('collinear');
    expect(arcProblem(...make(1.1))).toBeNull();
    expect(arcProblem(...make(180))).toBeNull();
    expect(arcProblem(...make(359))).toBeNull();
  });
  it('il punto sull\'arco quasi sulla corda (freccia 0.3 px su 300) e\' respinto; 3 px su 300 no', () => {
    expect(arcProblem(line(0), line(150, 0.3), line(300))).toBe('collinear');
    expect(arcProblem(line(0), line(150, 3), line(300))).toBeNull();
  });
  it('raggio oltre il massimo: "radius"', () => {
    expect(ARC_MAX_RADIUS).toBe(1_000_000);
    const c = { x: 0, y: 0 };
    expect(arcProblem(at(c, 2_000_000, -1), at(c, 2_000_000, 0), at(c, 2_000_000, 1))).toBe('radius');
    expect(arcProblem(at(c, 900_000, -1), at(c, 900_000, 0), at(c, 900_000, 1))).toBeNull();
  });
});

describe('distanza di un punto dall\'arco (per la scelta con un tocco)', () => {
  const full = circleFromCenterEdge({ x: 100, y: 100 }, { x: 150, y: 100 }) as SheetArc;
  it('cerchio: distanza dalla circonferenza, NON dall\'area (dentro non e\' 0)', () => {
    expect(distToArc({ x: 100, y: 100 }, full)).toBeCloseTo(50, 9); // il centro
    expect(distToArc({ x: 150, y: 100 }, full)).toBeCloseTo(0, 9);
    expect(distToArc({ x: 130, y: 100 }, full)).toBeCloseTo(20, 9); // dentro
    expect(distToArc({ x: 100, y: 180 }, full)).toBeCloseTo(30, 9); // fuori
  });
  it('arco: dalla circonferenza dentro l\'angolo, dall\'estremo piu\' vicino fuori', () => {
    const c = { x: 0, y: 0 };
    const a = arcThroughPoints(at(c, 10, 0), at(c, 10, 45), at(c, 10, 90)) as SheetArc; // da (10,0) a (0,10), orario con Y in giu'
    expect(distToArc(at(c, 13, 45), a)).toBeCloseTo(3, 9);
    expect(distToArc(at(c, 7, 80), a)).toBeCloseTo(3, 9);
    // dal lato opposto del cerchio: la distanza e' quella dell'estremo piu' vicino, non dalla circonferenza
    const far = at(c, 10, 225);
    expect(distToArc(far, a)).toBeGreaterThan(10);
    expect(distToArc(far, a)).toBeCloseTo(Math.min(Math.hypot(far.x - 10, far.y), Math.hypot(far.x, far.y - 10)), 9);
    // appena oltre l'estremo finale (95 gradi, a 10 dal centro): distanza = distanza dall'estremo
    const beyond = at(c, 10, 95);
    expect(distToArc(beyond, a)).toBeCloseTo(Math.hypot(beyond.x - 0, beyond.y - 10), 9);
  });
  it('arco con verso antiorario: stesso risultato', () => {
    const c = { x: 0, y: 0 };
    const a = arcThroughPoints(at(c, 10, 90), at(c, 10, 45), at(c, 10, 0)) as SheetArc;
    expect(a.sweep).toBeLessThan(0);
    expect(distToArc(at(c, 13, 45), a)).toBeCloseTo(3, 9);
    expect(distToArc(at(c, 10, 225), a)).toBeGreaterThan(10);
  });
});

describe('tracciato SVG: flag di sweep e di arco lungo', () => {
  const flags = (d: string): { large: string; sweep: string }[] => [...d.matchAll(/A[-\d.e+]+ [-\d.e+]+ 0 (\d) (\d) /g)].map((m) => ({ large: m[1] as string, sweep: m[2] as string }));
  const c = { x: 0, y: 0 };
  it('angolo crescente = sweep 1; decrescente = 0; oltre 180 gradi = large 1', () => {
    expect(flags(svgArcPath(arcThroughPoints(at(c, 10, 0), at(c, 10, 40), at(c, 10, 90)) as SheetArc))).toEqual([{ large: '0', sweep: '1' }]);
    expect(flags(svgArcPath(arcThroughPoints(at(c, 10, 90), at(c, 10, 40), at(c, 10, 0)) as SheetArc))).toEqual([{ large: '0', sweep: '0' }]);
    expect(flags(svgArcPath(arcThroughPoints(at(c, 10, 0), at(c, 10, 100), at(c, 10, 250)) as SheetArc))).toEqual([{ large: '1', sweep: '1' }]);
    expect(flags(svgArcPath(arcThroughPoints(at(c, 10, 250), at(c, 10, 100), at(c, 10, 0)) as SheetArc))).toEqual([{ large: '1', sweep: '0' }]);
  });
  it('il tracciato parte da p1 e arriva a p3', () => {
    const p1 = at(c, 10, 20);
    const p3 = at(c, 10, 130);
    const d = svgArcPath(arcThroughPoints(p1, at(c, 10, 70), p3) as SheetArc);
    const nums = d.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/g)!.map(Number);
    expect(near(nums[0]!, p1.x, 1e-9) && near(nums[1]!, p1.y, 1e-9)).toBe(true);
    expect(near(nums[nums.length - 2]!, p3.x, 1e-9) && near(nums[nums.length - 1]!, p3.y, 1e-9)).toBe(true);
  });
  it('il cerchio e\' due mezzi archi che partono a destra del centro e si chiudono con Z', () => {
    const d = svgArcPath(circleFromCenterEdge({ x: 10, y: 20 }, { x: 15, y: 20 }) as SheetArc);
    expect(d.startsWith('M15 20A5 5 0 0 1 ')).toBe(true);
    expect(d.endsWith('15 20Z')).toBe(true);
    expect(flags(d)).toHaveLength(2);
  });
});

describe('Bezier: curve da non piu\' di 90 gradi e errore radiale misurato', () => {
  /** Errore radiale massimo (relativo al raggio) di un arco approssimato, campionando ogni curva a 400 punti. */
  const radialError = (a: SheetArc): number => {
    let worst = 0;
    for (const cb of arcBeziers(a)) {
      for (let i = 0; i <= 400; i++) {
        const p = cubicAt(cb, i / 400);
        worst = Math.max(worst, Math.abs(Math.hypot(p.x - a.c.x, p.y - a.c.y) - a.r) / a.r);
      }
    }
    return worst;
  };
  const arcOf = (deg: number, r = 100): SheetArc => ({ c: { x: 30, y: -20 }, r, a0: 0.7, sweep: deg * DEG });

  it('il cerchio sono 4 curve; n = ceil(sweep / 90 gradi); ogni curva copre al massimo 90 gradi', () => {
    expect(arcBeziers(circleFromCenterEdge({ x: 0, y: 0 }, { x: 5, y: 0 }) as SheetArc)).toHaveLength(4);
    for (const [deg, n] of [[10, 1], [89.9, 1], [90, 1], [90.1, 2], [180, 2], [181, 3], [270, 3], [271, 4], [359.9, 4]] as const) {
      expect(arcBeziers(arcOf(deg))).toHaveLength(n);
      expect(arcBeziers(arcOf(-deg))).toHaveLength(n);
    }
    for (const deg of [10, 90, 133, 270, 359]) {
      const a = arcOf(deg);
      expect(Math.abs(a.sweep) / arcBeziers(a).length).toBeLessThanOrEqual(BEZIER_MAX_SEGMENT_RAD + 1e-12);
    }
  });
  it('le curve si concatenano, partono da p1 e finiscono a p3 (anche in verso antiorario)', () => {
    for (const sweep of [75, -75, 200, -200, 360]) {
      const a = arcOf(sweep);
      const cs = arcBeziers(a);
      for (let i = 1; i < cs.length; i++) expect(near(cs[i]!.p0.x, cs[i - 1]!.p1.x, 1e-9) && near(cs[i]!.p0.y, cs[i - 1]!.p1.y, 1e-9)).toBe(true);
      const s = arcStart(a);
      const e = arcEnd(a);
      expect(near(cs[0]!.p0.x, s.x) && near(cs[0]!.p0.y, s.y)).toBe(true);
      expect(near(cs[cs.length - 1]!.p1.x, e.x, 1e-9) && near(cs[cs.length - 1]!.p1.y, e.y, 1e-9)).toBe(true);
    }
  });
  it('ERRORE RADIALE: al massimo 2.8e-4 del raggio (circa 2.7e-4 per una curva di 90 gradi), molto meno per ampiezze minori', () => {
    const table: string[] = [];
    for (const deg of [1, 5, 15, 30, 45, 60, 75, 90, 91, 120, 135, 180, 181, 225, 270, 271, 360]) {
      const e = radialError(arcOf(deg));
      table.push(`${deg} gradi: ${e.toExponential(2)}`);
      expect(e).toBeLessThan(2.8e-4);
    }
    // la curva piu' larga consentita e' 90 gradi: li' l'errore e' il massimo possibile (misurato)
    expect(radialError(arcOf(90))).toBeGreaterThan(2.0e-4);
    expect(radialError(arcOf(90))).toBeLessThan(2.8e-4);
    expect(radialError(arcOf(45))).toBeLessThan(5e-6);
    expect(radialError(arcOf(360))).toBeLessThan(2.8e-4);
    // eslint-disable-next-line no-console
    console.log(`Errore radiale massimo / raggio (campioni 400 per curva): ${table.join('; ')}`);
  });
  it('l\'errore non dipende dal raggio (relativo): r = 1 e r = 5000 danno lo stesso', () => {
    expect(near(radialError(arcOf(90, 1)), radialError(arcOf(90, 5000)), 1e-9)).toBe(true);
  });
});

describe('verso e flag con la pagina non ruotata e con /Rotate 90 (cerchio di tre punti nello spazio utente)', () => {
  /** Tre punti nello spazio utente (Y verso l'alto) in senso ANTIORARIO visto sulla pagina. */
  const U = { c: { x: 300, y: 400 }, r: 80 };
  const user = (deg: number) => ({ x: U.c.x + U.r * Math.cos(deg * DEG), y: U.c.y + U.r * Math.sin(deg * DEG) });
  const spec = (rotate: number, userUnit = 1) => ({ view: [20, 30, 560, 800] as [number, number, number, number], rotate, userUnit });

  it('rotate 0: antiorario sulla pagina = sweep NEGATIVO nel foglio (Y in giu\'); orario = positivo', () => {
    const g = new PageGeometry(spec(0));
    const ccw = arcThroughPoints(g.userToSheet(user(10)), g.userToSheet(user(60)), g.userToSheet(user(130))) as SheetArc;
    expect(ccw.sweep).toBeLessThan(0);
    const cw = arcThroughPoints(g.userToSheet(user(130)), g.userToSheet(user(60)), g.userToSheet(user(10))) as SheetArc;
    expect(cw.sweep).toBeGreaterThan(0);
  });
  it('rotate 90, 180, 270: il verso visto sullo schermo non cambia (la rotazione non inverte l\'orientamento)', () => {
    for (const rot of [0, 90, 180, 270]) {
      const g = new PageGeometry(spec(rot));
      const ccw = arcThroughPoints(g.userToSheet(user(10)), g.userToSheet(user(60)), g.userToSheet(user(130))) as SheetArc;
      expect(ccw.sweep, `rotate ${rot}`).toBeLessThan(0);
      expect(near(Math.abs(ccw.sweep), 120 * DEG, 1e-9), `rotate ${rot}`).toBe(true);
    }
  });
  it('le curve di Bezier del foglio, riportate nello spazio utente, stanno sul cerchio dei tre punti utente (tutte le rotazioni, UserUnit 1 e 2.5)', () => {
    for (const rot of [0, 90, 180, 270]) {
      for (const uu of [1, 2.5]) {
        const g = new PageGeometry(spec(rot, uu));
        const a = arcThroughPoints(g.userToSheet(user(20)), g.userToSheet(user(100)), g.userToSheet(user(250))) as SheetArc;
        expect(near(a.r, U.r * uu, 1e-7)).toBe(true);
        const cu = g.sheetToUser(a.c);
        expect(near(cu.x, U.c.x, 1e-7) && near(cu.y, U.c.y, 1e-7)).toBe(true);
        for (const cb of arcBeziers(a)) {
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const q = g.sheetToUser(cubicAt(cb, t));
            expect(Math.abs(Math.hypot(q.x - U.c.x, q.y - U.c.y) - U.r) / U.r).toBeLessThan(2.8e-4);
          }
        }
        // gli estremi sono i punti utente di partenza e di arrivo
        const s = g.sheetToUser(arcStart(a));
        const e = g.sheetToUser(arcEnd(a));
        expect(near(s.x, user(20).x, 1e-6) && near(s.y, user(20).y, 1e-6)).toBe(true);
        expect(near(e.x, user(250).x, 1e-6) && near(e.y, user(250).y, 1e-6)).toBe(true);
        expect(arcPointAt(a, 0.5)).toBeTruthy();
      }
    }
  });
});
