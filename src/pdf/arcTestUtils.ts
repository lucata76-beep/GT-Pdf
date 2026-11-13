// Costruzioni per le prove della misura degli archi (V3.2c, CP7e): archi e cerchi con l'approssimazione STANDARD di Bezier calcolata QUI (non copiata dal codice provato), poligoni
// su un cerchio, e la scrittura di un percorso come contenuto PDF o come comandi di PDF.js. Non e' importato dall'app: resta fuori dal build.

/** Un punto. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Cubica standard di un arco di cerchio di centro (cx, cy), raggio r, che parte dall'angolo a0 (rad) e copre th (rad, con segno): punti di controllo a distanza k r dagli estremi lungo le
 * tangenti, con k = 4/3 tan(th/4) (la scelta che fa coincidere i tre punti di controllo con i dati agli estremi e le tangenti). Restituisce x0, y0, c1x, c1y, c2x, c2y, x1, y1.
 */
export function arcCubic(cx: number, cy: number, r: number, a0: number, th: number): number[] {
  const k = (4 / 3) * Math.tan(th / 4);
  const a1 = a0 + th;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return [x0, y0, x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0), x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1), x1, y1];
}

/** Catena di `parts` cubiche uguali che coprono `totalDeg` gradi da `startDeg` (con segno: negativo = senso orario). */
export function arcChain(cx: number, cy: number, r: number, startDeg: number, totalDeg: number, parts: number): number[][] {
  const th = ((totalDeg * Math.PI) / 180) / parts;
  const a0 = (startDeg * Math.PI) / 180;
  const out: number[][] = [];
  for (let j = 0; j < parts; j++) out.push(arcCubic(cx, cy, r, a0 + j * th, th));
  return out;
}

/** Scostamento RELATIVO massimo (diviso r) della cubica standard dal cerchio esatto, per campionamento fitto (t da 0 a 1 in `steps` passi): calcolo INDIPENDENTE dalla misura. */
export function trueMaxRelDeviation(cx: number, cy: number, r: number, cubic: number[], steps = 20000): number {
  let worst = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    const x = w0 * (cubic[0] as number) + w1 * (cubic[2] as number) + w2 * (cubic[4] as number) + w3 * (cubic[6] as number);
    const y = w0 * (cubic[1] as number) + w1 * (cubic[3] as number) + w2 * (cubic[5] as number) + w3 * (cubic[7] as number);
    const d = Math.abs(Math.hypot(x - cx, y - cy) - r) / r;
    if (d > worst) worst = d;
  }
  return worst;
}

/** Vertici di un poligono regolare di n lati inscritto nel cerchio (cx, cy, r), con il primo vertice all'angolo phaseDeg. */
export function polygonOnCircle(cx: number, cy: number, r: number, n: number, phaseDeg = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((phaseDeg + (360 * i) / n) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Un generatore pseudocasuale deterministico (LCG a 32 bit) in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// ---- scrittura come contenuto PDF (stringa di operatori)
const f = (v: number): string => v.toFixed(6);
/** `x y m` poi una `c` per cubica (la prima parte da x0, y0); `close`: `h`. */
export function pdfChain(chain: number[][], close = false): string {
  const c0 = chain[0] as number[];
  const parts = [`${f(c0[0] as number)} ${f(c0[1] as number)} m`];
  for (const c of chain) parts.push(`${f(c[2] as number)} ${f(c[3] as number)} ${f(c[4] as number)} ${f(c[5] as number)} ${f(c[6] as number)} ${f(c[7] as number)} c`);
  if (close) parts.push('h');
  return parts.join(' ');
}
/** Un poligono: `m`, una `l` per ogni altro vertice; `close`: `h`. */
export function pdfPolygon(pts: Pt[], close = true): string {
  const parts = pts.map((p, i) => `${f(p.x)} ${f(p.y)} ${i === 0 ? 'm' : 'l'}`);
  if (close) parts.push('h');
  return parts.join(' ');
}
