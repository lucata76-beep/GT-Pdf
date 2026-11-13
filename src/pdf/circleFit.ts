// Adattamento di un cerchio a punti (V3.2c, CP7e): SOLA MISURA. Modulo PURO (niente DOM, niente PDF.js): serve a src/pdf/geometry.ts per misurare quanto i sottopercorsi di sole
// cubiche e i poligoni fitti di un PDF somigliano a archi o cerchi. NON decide nessuna tolleranza e NON riconosce nulla: restituisce numeri.
//
// METODO (dichiarato; verificato in src/pdf/circleFit.test.ts con calcoli indipendenti):
//  1. Punti: per una catena di `k` cubiche i nodi (inizio della prima, giunti, fine dell'ultima) e, per ogni cubica, i punti a t = 0.25, 0.5 e 0.75 (4k + 1 punti; tre punti
//     definiscono sempre un cerchio, i punti in piu' no); per un poligono tutti i vertici.
//  2. Cerchio: adattamento ai MINIMI QUADRATI della distanza geometrica (minimizza la somma dei quadrati degli scostamenti radiali). Partenza dal cerchio algebrico di Taubin
//     (Chernov-Lesort 2005: robusto anche su archi parziali), poi iterazioni di Gauss-Newton sul solo centro (il raggio e' la media delle distanze).
//  3. Scostamento = distanza massima in valore assoluto fra le distanze dei punti dal centro e il raggio adattato (pt utente); relativo = scostamento / raggio.
//  4. Angolo coperto: somma degli angoli (con segno) fra punti consecutivi visti dal centro, in valore assoluto, in gradi (per un poligono anche l'ultimo lato verso il primo punto, ma solo
//     se non e' piu' ampio, visto dal centro, di ogni altro lato: altrimenti e' una corda che chiude un arco e non conta).
//  5. Tangenti (solo catene di cubiche): in ogni estremo di ogni cubica l'angolo fra la tangente della curva e la tangente del cerchio; nei giunti l'angolo fra la tangente
//     uscente dalla cubica prima e quella entrante nella dopo (continuita' della tangente).
//  6. «Quasi rettilineo»: raggio oltre STRAIGHT_RATIO volte la diagonale del riquadro dei punti (angolo coperto sotto circa 0.57 gradi), oppure raggio non determinabile
//     (punti allineati o coincidenti): il raggio e lo scostamento relativo non hanno significato e quei sottopercorsi si contano a parte. Fra loro si conta quanti NON sono piatti
//     (punti a piu' di BENT_FRACTION della diagonale dalla retta ai minimi quadrati: per esempio una S, che ha un cerchio adattato enorme ma non e' una retta).
// Le tolleranze di CP7a (CIRCLE_TOL_ABS, CIRCLE_TOL_REL, CIRCLE_MID_REL: src/pdf/geometry.ts) servono solo come RIFERIMENTO per un conteggio: qui non si decide nulla.

/** Punti per cubica oltre al nodo di inizio: t = 0.25, 0.5, 0.75 e il nodo di fine. */
export const SAMPLES_PER_CUBIC = 4;
/** Massimo di cubiche di una catena misurata (N della tappa: proposta, da confermare). */
export const ARC_MAX_CUBICS = 8;
/** Massimo di vertici di un poligono misurato (proposta, da confermare): oltre, il poligono e' solo contato. */
export const ARC_MAX_VERTICES = 256;
/** Raggio oltre il quale (rispetto alla diagonale del riquadro dei punti) il sottopercorso e' «quasi rettilineo»: 100 volte, cioe' un angolo coperto sotto circa 0.57 gradi. */
export const STRAIGHT_RATIO = 100;
/** Fra i quasi rettilinei, «non piatto» = punti a piu' di questa frazione della diagonale dalla retta ai minimi quadrati (una S di raggio adattato enorme non e' una retta). */
export const BENT_FRACTION = 0.01;

/** Risultato di una misura (riusato fra una chiamata e l'altra: niente allocazioni nel ciclo di estrazione). Tutte le distanze in pt utente, gli angoli in gradi. */
export interface ArcMeasure {
  /** 'arc': raggio determinato; 'straight': quasi rettilineo (raggio oltre soglia); 'undetermined': raggio non determinabile (punti allineati, coincidenti o non finiti). */
  status: 'arc' | 'straight' | 'undetermined';
  cx: number;
  cy: number;
  r: number;
  /** Scostamento massimo (assoluto, pt) di tutti i punti dal cerchio adattato, e relativo (diviso il raggio). */
  dev: number;
  devRel: number;
  /** Scostamento massimo dei soli nodi (estremi e giunti) e dei soli punti a t = 0.5 (zero per i poligoni: nessun punto di meta' curva). */
  devNodes: number;
  devMid: number;
  /** Angolo coperto in gradi (valore assoluto della somma con segno). */
  angle: number;
  /** Solo per i quasi rettilinei: distanza massima dei punti dalla retta ai minimi quadrati divisa per la diagonale del riquadro (0 per gli altri). */
  flat: number;
  /** Scostamento massimo (gradi) delle tangenti dalla tangente del cerchio negli estremi delle cubiche; -1 se non misurato (poligoni, tangenti degeneri). */
  tanDev: number;
  /** Salto massimo (gradi) della tangente nei giunti; -1 se non ci sono giunti (una sola cubica) o le tangenti sono degeneri. */
  jointBreak: number;
}

export function newArcMeasure(): ArcMeasure {
  return { status: 'undetermined', cx: 0, cy: 0, r: 0, dev: 0, devRel: 0, devNodes: 0, devMid: 0, angle: 0, flat: 0, tanDev: -1, jointBreak: -1 };
}

/** Area di lavoro riusabile (punti, tangenti): dimensionata sul massimo fra le catene e i poligoni. */
export interface FitWork {
  xs: Float64Array;
  ys: Float64Array;
}
export function newFitWork(): FitWork {
  const n = Math.max(ARC_MAX_CUBICS * SAMPLES_PER_CUBIC + 1, ARC_MAX_VERTICES);
  return { xs: new Float64Array(n), ys: new Float64Array(n) };
}

/** Risultato del cerchio adattato (riusato). */
export interface CircleFit {
  ok: boolean;
  cx: number;
  cy: number;
  r: number;
}

const GN_ITERATIONS = 50;
const RAD2DEG = 180 / Math.PI;
/** Oltre questa distanza del centro (in unita' della scala dei punti) il raggio e' comunque oltre ogni soglia di «quasi rettilineo»: niente raffinamento. */
const HUGE_CENTER = 1e6;

/**
 * Cerchio ai minimi quadrati della distanza geometrica per i punti (xs[i], ys[i]), i < n. `ok` = false se il raggio non e' determinabile (n < 3, punti non finiti,
 * allineati in modo esatto o coincidenti). Nessuna soglia di «quasi rettilineo» qui: la applica il chiamante. I punti sono centrati sulla loro media e scalati prima dei conti.
 */
export function fitCircle(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, out: CircleFit): CircleFit {
  out.ok = false;
  out.cx = 0;
  out.cy = 0;
  out.r = 0;
  if (n < 3) return out;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i] as number;
    my += ys[i] as number;
  }
  mx /= n;
  my /= n;
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return out;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs((xs[i] as number) - mx), Math.abs((ys[i] as number) - my));
    if (d > scale) scale = d;
  }
  if (!(scale > 0) || !Number.isFinite(scale)) return out; // punti coincidenti o non finiti
  // ---- Taubin (Chernov-Lesort): polinomio caratteristico di terzo grado, radice cercata con Newton partendo da 0; coordinate (u, v) centrate e scalate
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let szz = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const u = ((xs[i] as number) - mx) / scale;
    const v = ((ys[i] as number) - my) / scale;
    const z = u * u + v * v;
    sxx += u * u;
    syy += v * v;
    sxy += u * v;
    sxz += u * z;
    syz += v * z;
    szz += z * z;
    sz += z;
  }
  const mz = sz / n;
  const mxx = sxx / n;
  const myy = syy / n;
  const mxy = sxy / n;
  const mxz = sxz / n;
  const myz = syz / n;
  const mzz = szz / n;
  const covXY = mxx * myy - mxy * mxy;
  const varZ = mzz - mz * mz;
  const A3 = 4 * mz;
  const A2 = -3 * mz * mz - mzz;
  const A1 = varZ * mz + 4 * covXY * mz - mxz * mxz - myz * myz;
  const A0 = mxz * mxz * myy + myz * myz * mxx - 2 * mxz * myz * mxy - varZ * covXY;
  const A22 = A2 + A2;
  let x = 0;
  let y = A0;
  for (let it = 0; it < 99; it++) {
    const dy = A1 + x * (A22 + 3 * A3 * x);
    const xnew = x - y / dy;
    if (!Number.isFinite(xnew) || xnew === x) break;
    const ynew = A0 + xnew * (A1 + xnew * (A2 + xnew * A3));
    if (Math.abs(ynew) >= Math.abs(y)) break;
    x = xnew;
    y = ynew;
  }
  const det = x * x - x * mz + covXY;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-300) return out;
  let u0 = (mxz * (myy - x) - myz * mxy) / det / 2;
  let v0 = (myz * (mxx - x) - mxz * mxy) / det / 2;
  if (!Number.isFinite(u0) || !Number.isFinite(v0)) return out;
  // ---- Gauss-Newton sul solo centro, raggio = media delle distanze: minimizza F(c) = sum (d_i - mean d)^2 con ritorno indietro se F non scende
  const objective = (cu: number, cv: number): number => {
    let sd = 0;
    for (let i = 0; i < n; i++) sd += Math.sqrt(sq(cu - ((xs[i] as number) - mx) / scale) + sq(cv - ((ys[i] as number) - my) / scale));
    const r = sd / n;
    let f = 0;
    for (let i = 0; i < n; i++) f += sq(Math.sqrt(sq(cu - ((xs[i] as number) - mx) / scale) + sq(cv - ((ys[i] as number) - my) / scale)) - r);
    return f;
  };
  if (Math.hypot(u0, v0) < HUGE_CENTER) {
    let f = objective(u0, v0);
    for (let it = 0; it < GN_ITERATIONS && f > 0; it++) {
      let sd = 0;
      let sux = 0;
      let suy = 0;
      let degenerate = false;
      for (let i = 0; i < n; i++) {
        const dx = u0 - ((xs[i] as number) - mx) / scale;
        const dy = v0 - ((ys[i] as number) - my) / scale;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (!(d > 0)) {
          degenerate = true; // il centro coincide con un punto: si tiene il cerchio corrente
          break;
        }
        sd += d;
        sux += dx / d;
        suy += dy / d;
      }
      if (degenerate) break;
      const r = sd / n;
      const mux = sux / n;
      const muy = suy / n;
      let jxx = 0;
      let jxy = 0;
      let jyy = 0;
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < n; i++) {
        const dx = u0 - ((xs[i] as number) - mx) / scale;
        const dy = v0 - ((ys[i] as number) - my) / scale;
        const d = Math.sqrt(dx * dx + dy * dy);
        const jx = dx / d - mux;
        const jy = dy / d - muy;
        const e = d - r;
        jxx += jx * jx;
        jxy += jx * jy;
        jyy += jy * jy;
        gx += jx * e;
        gy += jy * e;
      }
      const dd = jxx * jyy - jxy * jxy;
      if (!(Math.abs(dd) > 1e-300)) break; // sistema singolare (punti quasi allineati): si tiene il cerchio corrente
      const sx = -(gx * jyy - gy * jxy) / dd;
      const sy = -(jxx * gy - jxy * gx) / dd;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) break;
      let lam = 1;
      let accepted = false;
      for (let bt = 0; bt < 30; bt++) {
        const fn = objective(u0 + lam * sx, v0 + lam * sy);
        if (fn <= f) {
          u0 += lam * sx;
          v0 += lam * sy;
          f = fn;
          accepted = true;
          break;
        }
        lam /= 2;
      }
      if (!accepted || lam * Math.hypot(sx, sy) <= 1e-14 * Math.max(1, Math.hypot(u0, v0))) break;
    }
  }
  let sd = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(sq(u0 - ((xs[i] as number) - mx) / scale) + sq(v0 - ((ys[i] as number) - my) / scale));
    if (!(d > 0)) return out;
    sd += d;
  }
  const r = sd / n;
  if (!(r > 0) || !Number.isFinite(r)) return out;
  out.ok = true;
  out.cx = mx + u0 * scale;
  out.cy = my + v0 * scale;
  out.r = r * scale;
  return out;
}
const sq = (v: number): number => v * v;

const T25 = [0.421875, 0.421875, 0.140625, 0.015625] as const; // pesi dei punti di controllo a t = 0.25: (1-t)^3, 3 (1-t)^2 t, 3 (1-t) t^2, t^3
const T50 = [0.125, 0.375, 0.375, 0.125] as const;
const T75 = [0.015625, 0.140625, 0.421875, 0.421875] as const;

const WORK = newFitWork();
const FIT: CircleFit = { ok: false, cx: 0, cy: 0, r: 0 };

/** Angolo (gradi) fra due direzioni non nulle (ax, ay) e (bx, by), in [0, 180]. */
function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  return Math.atan2(Math.abs(cross), dot) * RAD2DEG;
}

/** Quanto dista (gradi) la direzione (tx, ty) dalla tangente del cerchio nel punto (px, py): angolo fra la direzione e la perpendicolare al raggio; -1 se degenere. */
function tangentDeviation(tx: number, ty: number, px: number, py: number, cx: number, cy: number): number {
  const rx = px - cx;
  const ry = py - cy;
  if (!(Math.hypot(rx, ry) > 0) || !(Math.hypot(tx, ty) > 0)) return -1;
  // angolo fra t e la tangente (-ry, rx), senza segno e senza verso (una tangente e' una retta)
  const a = angleBetween(tx, ty, -ry, rx);
  return a > 90 ? 180 - a : a;
}

/**
 * Direzione (non nulla) della tangente in t = 0 di una cubica p0, c1, c2, p1: la prima differenza non nulla fra c1 - p0, c2 - p0, p1 - p0 (le prime due sono nulle solo se i
 * punti di controllo coincidono con l'estremo). Scrive in `dir[0..1]`; restituisce false se tutti i punti coincidono.
 */
function startTangent(c: ArrayLike<number>, o: number, dir: Float64Array): boolean {
  const x0 = c[o] as number;
  const y0 = c[o + 1] as number;
  for (const k of [2, 4, 6]) {
    const dx = (c[o + k] as number) - x0;
    const dy = (c[o + k + 1] as number) - y0;
    if (dx !== 0 || dy !== 0) {
      dir[0] = dx;
      dir[1] = dy;
      return true;
    }
  }
  return false;
}
/** Tangente in t = 1 (direzione di marcia): la prima differenza non nulla fra p1 - c2, p1 - c1, p1 - p0. */
function endTangent(c: ArrayLike<number>, o: number, dir: Float64Array): boolean {
  const x1 = c[o + 6] as number;
  const y1 = c[o + 7] as number;
  for (const k of [4, 2, 0]) {
    const dx = x1 - (c[o + k] as number);
    const dy = y1 - (c[o + k + 1] as number);
    if (dx !== 0 || dy !== 0) {
      dir[0] = dx;
      dir[1] = dy;
      return true;
    }
  }
  return false;
}

const TA = new Float64Array(2);
const TB = new Float64Array(2);

/**
 * Angolo coperto: somma con segno degli angoli visti dal centro fra punti consecutivi (ciascun passo ridotto a (-pi, pi]), in gradi e in valore assoluto. `closeLoop` (poligoni): si aggiunge
 * l'ultimo lato verso il primo punto SOLO se, visto dal centro, non e' piu' ampio del lato piu' ampio fra gli altri e ha lo stesso verso della somma: altrimenti e' una corda che chiude
 * un arco (un poligono a «D» copre l'angolo dei suoi vertici, non 0) e non conta.
 */
function sweepDegrees(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, cx: number, cy: number, closeLoop: boolean): number {
  let sum = 0;
  let maxStep = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ax = (xs[i] as number) - cx;
    const ay = (ys[i] as number) - cy;
    const bx = (xs[i + 1] as number) - cx;
    const by = (ys[i + 1] as number) - cy;
    const step = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    sum += step;
    if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
  }
  if (closeLoop && n >= 2) {
    const ax = (xs[n - 1] as number) - cx;
    const ay = (ys[n - 1] as number) - cy;
    const bx = (xs[0] as number) - cx;
    const by = (ys[0] as number) - cy;
    const step = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (Math.abs(step) <= maxStep * (1 + 1e-9) && step * sum >= 0) sum += step;
  }
  return Math.abs(sum) * RAD2DEG;
}

/** Distanza massima dei punti dalla retta ai minimi quadrati totali (asse principale), divisa per la diagonale `diag` del riquadro. */
function flatness(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, diag: number): number {
  if (!(diag > 0)) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i] as number;
    my += ys[i] as number;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(phi);
  const ny = Math.cos(phi);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(((xs[i] as number) - mx) * nx + ((ys[i] as number) - my) * ny);
    if (d > worst) worst = d;
  }
  return worst / diag;
}

function finish(out: ArcMeasure, n: number, nodeStride: number, closeLoop: boolean): void {
  const xs = WORK.xs;
  const ys = WORK.ys;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  out.status = 'undetermined';
  out.cx = out.cy = out.r = 0;
  out.dev = out.devRel = out.devNodes = out.devMid = out.angle = out.flat = 0;
  fitCircle(xs, ys, n, FIT);
  if (!FIT.ok) return;
  out.cx = FIT.cx;
  out.cy = FIT.cy;
  out.r = FIT.r;
  if (FIT.r > STRAIGHT_RATIO * diag) {
    out.status = 'straight';
    out.flat = flatness(xs, ys, n, diag);
    return;
  }
  out.status = 'arc';
  let dev = 0;
  let devNodes = 0;
  let devMid = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(Math.hypot((xs[i] as number) - FIT.cx, (ys[i] as number) - FIT.cy) - FIT.r);
    if (d > dev) dev = d;
    if (nodeStride > 0) {
      const phase = i % nodeStride;
      if (phase === 0 && d > devNodes) devNodes = d;
      else if (phase === 2 && d > devMid) devMid = d;
    } else if (d > devNodes) devNodes = d;
  }
  out.dev = dev;
  out.devRel = dev / FIT.r;
  out.devNodes = devNodes;
  out.devMid = devMid;
  out.angle = sweepDegrees(xs, ys, n, FIT.cx, FIT.cy, closeLoop);
}

/**
 * Misura una catena di `k` cubiche consecutive (1 <= k <= ARC_MAX_CUBICS) memorizzate in `c` come x0, y0, c1x, c1y, c2x, c2y, x1, y1 ciascuna (la fine di una e' l'inizio della
 * successiva). Scrive il risultato in `out`.
 */
export function measureCubicChain(c: ArrayLike<number>, k: number, out: ArcMeasure): ArcMeasure {
  const xs = WORK.xs;
  const ys = WORK.ys;
  let n = 0;
  for (let j = 0; j < k; j++) {
    const o = j * 8;
    const x0 = c[o] as number;
    const y0 = c[o + 1] as number;
    const x1 = c[o + 2] as number;
    const y1 = c[o + 3] as number;
    const x2 = c[o + 4] as number;
    const y2 = c[o + 5] as number;
    const x3 = c[o + 6] as number;
    const y3 = c[o + 7] as number;
    // nodo di inizio (solo per la prima cubica: per le altre e' il nodo di fine della precedente), t = 0.25, 0.5, 0.75
    if (j === 0) {
      xs[n] = x0;
      ys[n] = y0;
      n++;
    }
    xs[n] = T25[0] * x0 + T25[1] * x1 + T25[2] * x2 + T25[3] * x3;
    ys[n] = T25[0] * y0 + T25[1] * y1 + T25[2] * y2 + T25[3] * y3;
    n++;
    xs[n] = T50[0] * x0 + T50[1] * x1 + T50[2] * x2 + T50[3] * x3;
    ys[n] = T50[0] * y0 + T50[1] * y1 + T50[2] * y2 + T50[3] * y3;
    n++;
    xs[n] = T75[0] * x0 + T75[1] * x1 + T75[2] * x2 + T75[3] * x3;
    ys[n] = T75[0] * y0 + T75[1] * y1 + T75[2] * y2 + T75[3] * y3;
    n++;
    xs[n] = x3;
    ys[n] = y3;
    n++;
  }
  finish(out, n, SAMPLES_PER_CUBIC, false);
  out.tanDev = -1;
  out.jointBreak = -1;
  if (out.status !== 'arc') return out;
  // ---- tangenti negli estremi di ogni cubica (rispetto al cerchio adattato) e salto nei giunti
  let tanDev = -1;
  let joint = -1;
  let prevEndOk = false;
  let prevX = 0;
  let prevY = 0;
  for (let j = 0; j < k; j++) {
    const o = j * 8;
    const okS = startTangent(c, o, TA);
    if (okS) {
      const d = tangentDeviation(TA[0] as number, TA[1] as number, c[o] as number, c[o + 1] as number, out.cx, out.cy);
      if (d > tanDev) tanDev = d;
      if (j > 0 && prevEndOk) {
        const b = angleBetween(prevX, prevY, TA[0] as number, TA[1] as number);
        if (b > joint) joint = b;
      }
    }
    const okE = endTangent(c, o, TB);
    if (okE) {
      const d = tangentDeviation(TB[0] as number, TB[1] as number, c[o + 6] as number, c[o + 7] as number, out.cx, out.cy);
      if (d > tanDev) tanDev = d;
      prevX = TB[0] as number;
      prevY = TB[1] as number;
    }
    prevEndOk = okE;
  }
  out.tanDev = tanDev;
  out.jointBreak = joint;
  return out;
}

/** Misura un poligono chiuso di `n` vertici (3 <= n <= ARC_MAX_VERTICES) memorizzati come x, y consecutivi in `v` (senza ripetere il primo alla fine). */
export function measurePolygon(v: ArrayLike<number>, n: number, out: ArcMeasure): ArcMeasure {
  const xs = WORK.xs;
  const ys = WORK.ys;
  for (let i = 0; i < n; i++) {
    xs[i] = v[2 * i] as number;
    ys[i] = v[2 * i + 1] as number;
  }
  finish(out, n, 0, true);
  out.tanDev = -1;
  out.jointBreak = -1;
  return out;
}
