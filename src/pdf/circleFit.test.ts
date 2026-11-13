// Prove unitarie dell'adattamento del cerchio (V3.2c, CP7e; src/pdf/circleFit.ts). I valori attesi vengono da costruzioni note (archi con raggio e angolo scelti QUI, con l'approssimazione
// standard di Bezier calcolata in arcTestUtils.ts) e da calcoli INDIPENDENTI scritti in questo file: una ricerca a griglia del minimo dei quadrati (nessun Taubin, nessun Gauss-Newton), una
// previsione al primo ordine dell'effetto di uno scostamento sui parametri del cerchio (sistema lineare 3 x 3 risolto con la regola di Cramer), un campionamento fitto delle cubiche.
import { afterAll, describe, expect, it } from 'vitest';
import { arcChain, arcCubic, polygonOnCircle, rng, trueMaxRelDeviation } from './arcTestUtils';
import { ARC_MAX_CUBICS, ARC_MAX_VERTICES, BENT_FRACTION, STRAIGHT_RATIO, type CircleFit, fitCircle, measureCubicChain, measurePolygon, newArcMeasure } from './circleFit';

const DEG = Math.PI / 180;
const fresh = (): CircleFit => ({ ok: false, cx: 0, cy: 0, r: 0 });

/** Punti su un arco esatto: centro, raggio, angolo iniziale e ampiezza in gradi, n punti equidistanti in angolo (estremi compresi se sweep < 360). */
function onCircle(cx: number, cy: number, r: number, a0: number, sweep: number, n: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const full = sweep >= 360;
  for (let i = 0; i < n; i++) {
    const a = (a0 + (sweep * i) / (full ? n : n - 1)) * DEG;
    xs.push(cx + r * Math.cos(a));
    ys.push(cy + r * Math.sin(a));
  }
  return { xs, ys };
}

/** Somma dei quadrati degli scostamenti radiali dal raggio medio per un centro dato (la funzione che l'adattamento minimizza). */
function objective(xs: number[], ys: number[], cx: number, cy: number): number {
  const d = xs.map((x, i) => Math.hypot(x - cx, (ys[i] as number) - cy));
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  return d.reduce((a, b) => a + (b - m) * (b - m), 0);
}
/**
 * Ricerca a griglia con zoom del centro che minimizza `objective`: indipendente da Taubin e Gauss-Newton. Griglia di 41 x 41 passi attorno al baricentro dei punti (mezza larghezza
 * `half`, che deve contenere il minimo), poi attorno al punto migliore con mezza larghezza ridotta a 0.6 ad ogni livello, fino a 1e-13 della larghezza iniziale. Una ricerca a passi
 * dimezzati (compass search) NON converge nella valle lunga e stretta degli archi corti: provata e scartata.
 */
function zoomCenter(xs: number[], ys: number[], start: { x: number; y: number }, half0: number): { x: number; y: number; f: number } {
  let { x, y } = start;
  let half = half0;
  let f = objective(xs, ys, x, y);
  for (let level = 0; level < 120 && half > 1e-13 * half0; level++) {
    let bx = x;
    let by = y;
    let bf = Infinity;
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const cx = x + (i * half) / 20;
        const cy = y + (j * half) / 20;
        const v = objective(xs, ys, cx, cy);
        if (v < bf) {
          bf = v;
          bx = cx;
          by = cy;
        }
      }
    }
    x = bx;
    y = by;
    f = bf;
    half *= 0.6;
  }
  return { x, y, f };
}

describe('fitCircle: punti esatti su un cerchio', () => {
  const radii = [0.5, 10, 500];
  const centers: [number, number][] = [
    [0, 0],
    [300, 400],
    [100000, -200000],
  ];
  const sweeps = [20, 90, 180, 270, 360];
  for (const r of radii) {
    for (const [cx, cy] of centers) {
      for (const sweep of sweeps) {
        for (const n of [5, 9, 33]) {
          it(`r ${r}, centro (${cx}, ${cy}), arco di ${sweep} gradi, ${n} punti: centro e raggio ritrovati`, () => {
            const { xs, ys } = onCircle(cx, cy, r, 37, sweep, n);
            const out = fitCircle(xs, ys, n, fresh());
            expect(out.ok).toBe(true);
            // limite: errore degli arrotondamenti delle coordinate (eps x |coordinata|) amplificato dal condizionamento dell'arco (~ 8 / angolo^2 per angoli piccoli)
            const eps = 2.3e-16 * Math.max(Math.abs(cx), Math.abs(cy), r);
            const amp = Math.max(1, 8 / (Math.min(sweep, 180) * DEG) ** 2);
            const tol = 50 * eps * amp + 1e-12 * r;
            expect(Math.abs(out.cx - cx)).toBeLessThanOrEqual(tol);
            expect(Math.abs(out.cy - cy)).toBeLessThanOrEqual(tol);
            expect(Math.abs(out.r - r)).toBeLessThanOrEqual(tol);
          });
        }
      }
    }
  }
});

describe('fitCircle: verifica indipendente con la ricerca a griglia con zoom (punti rumorosi)', () => {
  for (const [sweep, noise, seed] of [
    [60, 1e-3, 11],
    [120, 5e-3, 12],
    [270, 1e-2, 13],
    [360, 2e-2, 14],
  ] as const) {
    it(`arco di ${sweep} gradi con rumore ${noise} x raggio: stesso minimo dei quadrati`, () => {
      const rnd = rng(seed);
      const r = 40;
      const { xs, ys } = onCircle(250, 330, r, 15, sweep, 17);
      for (let i = 0; i < xs.length; i++) {
        xs[i] = (xs[i] as number) + (rnd() - 0.5) * 2 * noise * r;
        ys[i] = (ys[i] as number) + (rnd() - 0.5) * 2 * noise * r;
      }
      const out = fitCircle(xs, ys, xs.length, fresh());
      expect(out.ok).toBe(true);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const bf = zoomCenter(xs, ys, { x: mx, y: my }, 2.5 * r);
      const ours = objective(xs, ys, out.cx, out.cy);
      // il nostro minimo non e' piu' alto di quello trovato per ricerca (a meno degli arrotondamenti) e i due centri coincidono
      expect(ours).toBeLessThanOrEqual(bf.f * (1 + 1e-9) + 1e-18);
      expect(Math.hypot(out.cx - bf.x, out.cy - bf.y)).toBeLessThanOrEqual(1e-6 * r);
      // il raggio e' la media delle distanze dal centro trovato per ricerca
      const rbf = xs.map((x, i) => Math.hypot(x - bf.x, (ys[i] as number) - bf.y)).reduce((a, b) => a + b, 0) / xs.length;
      expect(Math.abs(out.r - rbf)).toBeLessThanOrEqual(1e-6 * r);
    });
  }
});

describe('fitCircle: invarianze e casi limite', () => {
  it('traslazione, rotazione e scala: il raggio scala, il centro si trasforma', () => {
    const rnd = rng(5);
    const { xs, ys } = onCircle(10, 20, 30, 0, 200, 12);
    for (let i = 0; i < xs.length; i++) {
      xs[i] = (xs[i] as number) + (rnd() - 0.5) * 0.2;
      ys[i] = (ys[i] as number) + (rnd() - 0.5) * 0.2;
    }
    const a = fitCircle(xs, ys, xs.length, fresh());
    const s = 7.5;
    const ang = 0.7;
    const [tx, ty] = [1234, -567];
    const x2 = xs.map((x, i) => s * (Math.cos(ang) * x - Math.sin(ang) * (ys[i] as number)) + tx);
    const y2 = xs.map((x, i) => s * (Math.sin(ang) * x + Math.cos(ang) * (ys[i] as number)) + ty);
    const b = fitCircle(x2, y2, x2.length, fresh());
    expect(a.ok && b.ok).toBe(true);
    expect(b.r).toBeCloseTo(s * a.r, 6);
    expect(b.cx).toBeCloseTo(s * (Math.cos(ang) * a.cx - Math.sin(ang) * a.cy) + tx, 6);
    expect(b.cy).toBeCloseTo(s * (Math.sin(ang) * a.cx + Math.cos(ang) * a.cy) + ty, 6);
  });
  it('meno di 3 punti, punti coincidenti, punti allineati in modo esatto, valori non finiti: raggio non determinabile', () => {
    expect(fitCircle([0, 1], [0, 1], 2, fresh()).ok).toBe(false);
    expect(fitCircle([5, 5, 5, 5], [7, 7, 7, 7], 4, fresh()).ok).toBe(false);
    expect(fitCircle([0, 1, 2, 3, 4], [0, 2, 4, 6, 8], 5, fresh()).ok).toBe(false);
    expect(fitCircle([0, 1, NaN, 3], [0, 1, 2, 3], 4, fresh()).ok).toBe(false);
    expect(fitCircle([0, 1, Infinity], [0, 1, 2], 3, fresh()).ok).toBe(false);
  });
  it('tre punti non allineati: il cerchio per i tre punti (formula del circocentro, indipendente)', () => {
    const [x1, y1, x2, y2, x3, y3] = [0, 0, 4, 0, 1, 3];
    // circocentro: intersezione degli assi dei lati
    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
    const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
    const out = fitCircle([x1, x2, x3], [y1, y2, y3], 3, fresh());
    expect(out.ok).toBe(true);
    expect(out.cx).toBeCloseTo(ux, 9);
    expect(out.cy).toBeCloseTo(uy, 9);
    expect(out.r).toBeCloseTo(Math.hypot(x1 - ux, y1 - uy), 9);
  });
});

describe('scostamento atteso per archi esatti: approssimazione standard di Bezier (30, 60, 90, 120, 180 gradi; una o due cubiche)', () => {
  // L'approssimazione standard usa k = 4/3 tan(angolo/4) per la lunghezza dei bracci. Lo scostamento VERO (per campionamento fitto, centro e raggio noti) e' calcolato in arcTestUtils.ts
  // con una formula indipendente dal codice provato. Valore di riferimento noto in letteratura: per 90 gradi in una cubica circa 2.7e-4 del raggio.
  const rows: string[] = [];
  const r = 50;
  const [cx, cy] = [100, 200];
  for (const deg of [30, 60, 90, 120, 180]) {
    for (const parts of [1, 2]) {
      it(`${deg} gradi in ${parts} ${parts === 1 ? 'cubica' : 'cubiche'}: raggio e angolo misurati coincidono con quelli noti entro lo scostamento calcolato indipendentemente`, () => {
        const chain = arcChain(cx, cy, r, 25, deg, parts);
        // scostamento VERO dal cerchio esatto (centro e raggio noti): massimo sulle cubiche della catena
        const eps = Math.max(...chain.map((c) => trueMaxRelDeviation(cx, cy, r, c)));
        const flat = chain.flat();
        const m = measureCubicChain(flat, parts, newArcMeasure());
        expect(m.status).toBe('arc');
        // PREVISIONE AL PRIMO ORDINE (indipendente dall'adattamento non lineare): i punti del campione, calcolati qui con de Casteljau, differiscono dal cerchio esatto di e_i (radiale);
        // il cerchio ai minimi quadrati sposta centro e raggio di delta = argmin sum (e_i - (u_i . dc + dr))^2, con u_i il versore radiale: sistema 3 x 3 (regola di Cramer)
        const pts: { x: number; y: number }[] = [];
        const bez = (c: number[], t: number): { x: number; y: number } => {
          const l = (a: number, b: number, tt: number): number => a + (b - a) * tt;
          const q = (o: number): number => l(l(l(c[o]!, c[o + 2]!, t), l(c[o + 2]!, c[o + 4]!, t), t), l(l(c[o + 2]!, c[o + 4]!, t), l(c[o + 4]!, c[o + 6]!, t), t), t);
          return { x: q(0), y: q(1) };
        };
        chain.forEach((c, j) => {
          if (j === 0) pts.push(bez(c, 0));
          for (const t of [0.25, 0.5, 0.75, 1]) pts.push(bez(c, t));
        });
        // e_i = d_i - r  (scostamento radiale rispetto al cerchio esatto); u_i versore radiale
        const e = pts.map((p) => Math.hypot(p.x - cx, p.y - cy) - r);
        const u = pts.map((p) => {
          const d = Math.hypot(p.x - cx, p.y - cy);
          return { x: (p.x - cx) / d, y: (p.y - cy) / d };
        });
        // modello: distanza del punto dal nuovo cerchio (c + dc, r + dr) ~ (r + e_i) - u_i . dc ; scostamento residuo = e_i - u_i . dc - dr  -> si minimizza sum (e_i + (-ux) dcx + (-uy) dcy + (-1) dr)^2
        let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
        pts.forEach((_, i) => {
          const row = [-u[i]!.x, -u[i]!.y, -1];
          const ei = e[i]!;
          a11 += row[0]! * row[0]!; a12 += row[0]! * row[1]!; a13 += row[0]! * row[2]!;
          a22 += row[1]! * row[1]!; a23 += row[1]! * row[2]!; a33 += row[2]! * row[2]!;
          b1 -= row[0]! * ei; b2 -= row[1]! * ei; b3 -= row[2]! * ei;
        });
        const det3 = (m11: number, m12: number, m13: number, m21: number, m22: number, m23: number, m31: number, m32: number, m33: number): number =>
          m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31);
        const D = det3(a11, a12, a13, a12, a22, a23, a13, a23, a33);
        const dcx = det3(b1, a12, a13, b2, a22, a23, b3, a23, a33) / D;
        const dcy = det3(a11, b1, a13, a12, b2, a23, a13, b3, a33) / D;
        const dr = det3(a11, a12, b1, a12, a22, b2, a13, a23, b3) / D;
        // la previsione vale al primo ordine: scostamenti relativi attesi del centro e del raggio
        expect(Math.abs(m.cx - (cx + dcx))).toBeLessThanOrEqual(0.05 * Math.hypot(dcx, dcy) + 1e-9 * r);
        expect(Math.abs(m.cy - (cy + dcy))).toBeLessThanOrEqual(0.05 * Math.hypot(dcx, dcy) + 1e-9 * r);
        expect(Math.abs(m.r - (r + dr))).toBeLessThanOrEqual(0.05 * Math.abs(dr) + 1e-9 * r);
        // raggio e angolo noti: la distanza e' al massimo K x (scostamento vero), con K = amplificazione del sistema (calcolata dalla previsione stessa, non scelta)
        const K = (Math.hypot(dcx, dcy) + Math.abs(dr)) / (Math.max(...e.map(Math.abs)) || 1);
        expect(Math.abs(m.r - r)).toBeLessThanOrEqual(1.1 * K * eps * r + 1e-9 * r);
        // angolo noto = ampiezza scelta; la sua differenza dipende dal centro spostato: massimo (spostamento del centro / raggio) in radianti x 2 (due estremi)
        const dTheta = (2 * Math.hypot(dcx, dcy)) / r / DEG;
        expect(Math.abs(m.angle - deg)).toBeLessThanOrEqual(1.5 * dTheta + 1e-6);
        // lo scostamento relativo misurato non supera quello vero (il minimo dei quadrati non puo' fare peggio del cerchio esatto sui punti campionati, a parte l'ultima cifra)
        expect(m.devRel).toBeLessThanOrEqual(Math.max(...e.map(Math.abs)) / r + 1e-12);
        rows.push(`${deg} gradi, ${parts} cubica/e: scostamento VERO massimo ${eps.toExponential(2)} (relativo), misurato ${m.devRel.toExponential(2)}, raggio misurato/noto - 1 = ${((m.r - r) / r).toExponential(2)}, angolo misurato ${m.angle.toFixed(4)} (noto ${deg}), amplificazione ${K.toFixed(2)}`);
      });
    }
  }
  it('valore noto: una cubica standard da 90 gradi scosta dal cerchio di circa 2.7e-4 del raggio; gli archi piu' + "'" + ' ampi scostano di piu', () => {
    const e90 = trueMaxRelDeviation(0, 0, 1, arcCubic(0, 0, 1, 0, Math.PI / 2));
    expect(e90).toBeGreaterThan(2.6e-4);
    expect(e90).toBeLessThan(2.8e-4);
    const e = [30, 60, 90, 120, 180].map((d) => trueMaxRelDeviation(0, 0, 1, arcCubic(0, 0, 1, 0, d * DEG)));
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThan(e[i - 1] as number);
    // due cubiche della meta' scostano molto meno di una (cresce circa come l'angolo alla sesta)
    const e180two = trueMaxRelDeviation(0, 0, 1, arcCubic(0, 0, 1, 0, 90 * DEG));
    expect(e180two).toBeLessThan(e[4] as number);
  });
  afterAll(() => {
    // tabella per il resoconto (con `npx vitest run src/pdf/circleFit.test.ts --silent=false`)
    console.log(['', ...rows].join('\n'));
  });
});

describe('misura di una catena di cubiche: casi negativi e limiti', () => {
  it('una S di due cubiche con flesso (un arco di +90 gradi e uno di -90): scostamento relativo grande, lontana da un cerchio', () => {
    const c1 = arcCubic(0, 0, 50, 0, 90 * DEG);
    // secondo arco: parte dalla fine del primo, con la stessa tangente, curvando dall'altra parte (centro simmetrico rispetto al punto di giunzione)
    const [jx, jy] = [c1[6] as number, c1[7] as number];
    const c2 = arcCubic(2 * jx, 2 * jy, 50, 180 * DEG + 90 * DEG, -90 * DEG);
    const m = measureCubicChain([...c1, ...c2], 2, newArcMeasure());
    // i due archi stanno su due cerchi di centri (0,0) e (2 jx, 2 jy) con curvature opposte: una S con simmetria puntuale non ha un verso di curvatura preferito, il cerchio ai minimi quadrati
    // diventa enorme e il sottopercorso risulta «quasi rettilineo» per il raggio; ma NON e' piatto: i punti stanno lontani dalla retta (oltre BENT_FRACTION della diagonale)
    expect(m.status).toBe('straight');
    expect(m.flat).toBeGreaterThan(BENT_FRACTION);
    expect(m.flat).toBeGreaterThan(0.05);
    // i nodi sono comunque a tangente continua (continuita' G1 della S): salto nel giunto ~ 0
    expect(m.jointBreak).toBeLessThan(1e-6);
  });
  it('una cubica con i punti di controllo allineati sulla corda e' + "'" + ' «quasi rettilinea» (o a raggio non determinabile se esattamente allineata)', () => {
    const exact = measureCubicChain([0, 0, 10, 0, 20, 0, 30, 0], 1, newArcMeasure());
    expect(exact.status).toBe('undetermined');
    const flat = measureCubicChain([0, 0, 10, 0.01, 20, -0.01, 30, 0], 1, newArcMeasure());
    expect(['straight', 'undetermined']).toContain(flat.status);
    // sagitta 0.75 x 0.04 = 0.03 su corda 30: raggio ~ c^2 / (8 s) = 3750, oltre 100 x la diagonale (~30 = 3000): quasi rettilinea (angolo coperto circa 0.46 gradi)
    const bent = measureCubicChain([0, 0, 10, 0.04, 20, 0.04, 30, 0], 1, newArcMeasure());
    expect(bent.status).toBe('straight');
    expect(bent.r).toBeGreaterThan(STRAIGHT_RATIO * 30);
    expect(bent.flat).toBeLessThan(BENT_FRACTION); // piatta: i punti stanno a ~0.1% della diagonale dalla retta
    // sagitta 0.15 (controlli a 0.2): raggio ~ 750, angolo ~ 2.3 gradi: sotto la soglia di 100 x la diagonale NON e' quasi rettilinea (e' un arco di raggio grande)
    const gentle = measureCubicChain([0, 0, 10, 0.2, 20, 0.2, 30, 0], 1, newArcMeasure());
    expect(gentle.status).toBe('arc');
    expect(gentle.r).toBeGreaterThan(600);
    expect(gentle.r).toBeLessThan(900);
    expect(gentle.angle).toBeGreaterThan(2);
    expect(gentle.angle).toBeLessThan(2.6);
    // un po' piu' curva: sagitta ~ 1.5 su corda 30 -> raggio ~ 75: e' un arco per la soglia (e il suo angolo e' circa 23 gradi)
    const curved = measureCubicChain([0, 0, 10, 2, 20, 2, 30, 0], 1, newArcMeasure());
    expect(curved.status).toBe('arc');
    expect(curved.angle).toBeGreaterThan(20);
    expect(curved.angle).toBeLessThan(30);
  });
  it('una cubica di corda 0 (cappio: ultimo punto uguale al primo) e una con tutti i punti coincidenti non danno NaN', () => {
    const loop = measureCubicChain([100, 100, 120, 140, 140, 140, 100, 100], 1, newArcMeasure());
    for (const v of [loop.r, loop.dev, loop.devRel, loop.angle]) expect(Number.isFinite(v)).toBe(true);
    const dot = measureCubicChain([5, 5, 5, 5, 5, 5, 5, 5], 1, newArcMeasure());
    expect(dot.status).toBe('undetermined');
    expect(dot.tanDev).toBe(-1);
  });
  it('giunto con una spigolo di 30 gradi: il salto della tangente e\' 30 gradi (calcolato qui dalle direzioni)', () => {
    const a = arcCubic(0, 0, 50, 0, 60 * DEG); // finisce in (50 cos60, 50 sin60), tangente a 60 + 90 = 150 gradi
    const [jx, jy] = [a[6] as number, a[7] as number];
    // secondo arco che parte da J con la tangente ruotata di +30 gradi (180 gradi): cerchio di centro J + 50 x versore(180 - 90 = 90 gradi)... costruito con arcCubic: parte da J con raggio 50
    // arcCubic(cx, cy, r, a0, th) parte dal punto a0 sul cerchio, con tangente a0 + 90 (th > 0): serve a0 = 180 gradi (tangente 270?) -> si ricava dall'angolo voluto: tangente = a0 + 90
    const tangentDeg = 150 + 30;
    const a0 = (tangentDeg - 90) * DEG;
    const b = arcCubic(jx - 50 * Math.cos(a0), jy - 50 * Math.sin(a0), 50, a0, 60 * DEG);
    const m = measureCubicChain([...a, ...b], 2, newArcMeasure());
    expect(m.jointBreak).toBeGreaterThan(29.99);
    expect(m.jointBreak).toBeLessThan(30.01);
  });
  it('ARC_MAX_CUBICS e ARC_MAX_VERTICES dichiarati', () => {
    expect(ARC_MAX_CUBICS).toBe(8);
    expect(ARC_MAX_VERTICES).toBe(256);
    expect(STRAIGHT_RATIO).toBe(100);
  });
});

describe('misura di un poligono', () => {
  it('vertici esatti su un cerchio (12, 24, 64, 256 lati): scostamento al livello degli arrotondamenti, raggio e angolo noti', () => {
    for (const n of [12, 24, 64, 256]) {
      const pts = polygonOnCircle(300, 400, 60, n, 13);
      const v: number[] = pts.flatMap((p) => [p.x, p.y]);
      const m = measurePolygon(v, n, newArcMeasure());
      expect(m.status).toBe('arc');
      expect(m.r).toBeCloseTo(60, 9);
      expect(m.cx).toBeCloseTo(300, 9);
      expect(m.cy).toBeCloseTo(400, 9);
      expect(m.devRel).toBeLessThan(1e-12);
      expect(m.angle).toBeCloseTo(360, 6);
      expect(m.tanDev).toBe(-1);
      expect(m.jointBreak).toBe(-1);
    }
  });
  it('un poligono irregolare (raggi fra 40 e 70) ha uno scostamento relativo grande', () => {
    const rnd = rng(7);
    const v: number[] = [];
    for (let i = 0; i < 15; i++) v.push(300 + (40 + rnd() * 30) * Math.cos(i * 0.43), 400 + (40 + rnd() * 30) * Math.sin(i * 0.43));
    const m = measurePolygon(v, 15, newArcMeasure());
    expect(m.devRel).toBeGreaterThan(0.05);
  });
  it('un poligono a «D» (13 vertici su mezzo cerchio, chiuso da una corda): il lato di chiusura non conta, l\'angolo coperto e\' 180 gradi', () => {
    const v: number[] = [];
    for (let i = 0; i <= 12; i++) v.push(100 + 30 * Math.cos((i * Math.PI) / 12), 100 + 30 * Math.sin((i * Math.PI) / 12));
    const m = measurePolygon(v, 13, newArcMeasure());
    expect(m.status).toBe('arc');
    expect(m.r).toBeCloseTo(30, 8);
    expect(m.angle).toBeCloseTo(180, 6);
    // 11 vertici su 150 gradi, corda di chiusura non diametrale
    const w: number[] = [];
    for (let i = 0; i <= 10; i++) w.push(100 + 30 * Math.cos((i * 15 * Math.PI) / 180), 100 + 30 * Math.sin((i * 15 * Math.PI) / 180));
    const m2 = measurePolygon(w, 11, newArcMeasure());
    expect(m2.angle).toBeCloseTo(150, 6);
  });
});
