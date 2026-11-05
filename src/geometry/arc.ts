// Cerchio e arco di cerchio (V2b, CP6c). Funzioni pure, senza DOM, nel FOGLIO mostrato (pt fisici, origine in alto a sinistra, Y verso il basso) come
// `hit.ts`, `snap.ts` e `ortho.ts`: /Rotate, CropBox e UserUnit sono gia' dentro `PageGeometry`, e il passaggio spazio utente -> foglio e' sempre una
// similitudine (rotazione di un multiplo di 90 gradi, scala UserUnit, riflessione dell'asse Y): un cerchio resta un cerchio, e una curva di Bezier
// calcolata nel foglio, con i punti riportati nello spazio utente (`sheetToUser`), e' esattamente la stessa curva (le Bezier sono invarianti per
// trasformazioni affini). Per questo l'esportazione non ha bisogno di flag di verso: li ha solo lo schermo.
//
// Convenzione degli angoli: `atan2(y - cy, x - cx)` con le coordinate del foglio (Y in giu'), la stessa di `CanvasRenderingContext2D.arc` e del flag
// di sweep dell'SVG. Uno `sweep` POSITIVO e' un angolo che cresce = senso ORARIO sullo schermo; NEGATIVO = antiorario. `|sweep| = 2 pi` e' il cerchio intero.
import type { PageGeometry, Pt, SheetPoint, UserPoint } from './page';

export const FULL_TURN = 2 * Math.PI;
/** Un arco con |sweep| entro questa tolleranza (rad) da un giro intero e' un cerchio. */
const FULL_EPS = 1e-12;

/** Arco nel foglio: centro, raggio, angolo di partenza e sweep (con segno, vedi sopra). Il cerchio e' un arco con `a0 = 0` e `sweep = 2 pi`. */
export interface SheetArc {
  c: SheetPoint;
  r: number;
  a0: number;
  sweep: number;
}

/** Curva cubica di Bezier. */
export interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
}

/** Cerchio o arco come punti nello spazio utente (come li salvano `CircleObject` e `ArcObject`). */
export type CurveDef = { kind: 'circle'; p1: UserPoint; p2: UserPoint } | { kind: 'arc'; p1: UserPoint; p2: UserPoint; p3: UserPoint };

export type CurveKind = 'circle' | 'arc';

export interface CurveTypeInfo {
  id: CurveKind;
  label: string;
  /** Punti indicati per costruirla. */
  points: number;
}
/** Cerchio (centro + punto sul bordo) e Arco (inizio, punto sull'arco, fine): decisioni 63 e 64 di docs/PIANO.md. */
export const CURVE_TYPES: readonly CurveTypeInfo[] = [
  { id: 'circle', label: 'Cerchio', points: 2 },
  { id: 'arc', label: 'Arco', points: 3 },
];
export const curveInfo = (k: CurveKind): CurveTypeInfo => CURVE_TYPES.find((c) => c.id === k) as CurveTypeInfo;

export const isFullCircle = (a: SheetArc): boolean => Math.abs(a.sweep) >= FULL_TURN - FULL_EPS;

/** Il cerchio dal centro e da un punto sul bordo; null se i due punti coincidono. Parte dall'angolo 0 (a destra del centro), in senso orario. */
export function circleFromCenterEdge(c: Pt, edge: Pt): SheetArc | null {
  const r = Math.hypot(edge.x - c.x, edge.y - c.y);
  return r > 0 && Number.isFinite(r) ? { c: { x: c.x, y: c.y }, r, a0: 0, sweep: FULL_TURN } : null;
}

const mod2pi = (x: number): number => ((x % FULL_TURN) + FULL_TURN) % FULL_TURN;

/**
 * L'arco da p1 a p3 che passa per p2 (cerchio per tre punti). Il verso e' quello in cui si incontrano p1, p2, p3. Null se i tre punti sono
 * esattamente allineati (o due coincidono) o se il calcolo non e' finito; le soglie d'uso (quasi allineati, raggio massimo) sono in `arcProblem`.
 * Il calcolo parte dal punto p1 (coordinate relative) per perdere meno cifre con coordinate grandi.
 */
export function arcThroughPoints(p1: Pt, p2: Pt, p3: Pt): SheetArc | null {
  const ax = p2.x - p1.x;
  const ay = p2.y - p1.y;
  const bx = p3.x - p1.x;
  const by = p3.y - p1.y;
  const d = 2 * (ax * by - ay * bx);
  if (d === 0 || !Number.isFinite(d)) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const ux = (by * a2 - ay * b2) / d;
  const uy = (ax * b2 - bx * a2) / d;
  const r = Math.hypot(ux, uy);
  if (!(r > 0) || !Number.isFinite(r)) return null;
  const c = { x: p1.x + ux, y: p1.y + uy };
  const a0 = Math.atan2(-uy, -ux); // angolo di p1 intorno al centro
  const a3 = Math.atan2(p3.y - c.y, p3.x - c.x);
  // d > 0: i tre punti sono in ordine di angolo crescente (stessa formula in qualunque sistema di coordinate); sweep da p1 a p3 nel verso di p2.
  const sweep = d > 0 ? mod2pi(a3 - a0) : -mod2pi(a0 - a3);
  return Number.isFinite(sweep) && sweep !== 0 ? { c, r, a0, sweep } : null;
}

/**
 * Soglie dell'arco per tre punti: valori di PARTENZA, NON tarati (li giudica l'utente sul PC), scelti dall'assistente. In unita' delle coordinate date: la
 * costruzione e la lettura del file le applicano entrambe ai punti nello spazio utente (`arcProblem` e' la stessa funzione), cosi' quello che si costruisce il file lo rilegge.
 *  - `ARC_MIN_SWEEP_RAD`: l'arco deve coprire almeno 1 grado. Sotto, l'arco e' indistinguibile da un tratto dritto (con una corda di 300 px la
 *    freccia e' 0.65 px) e il centro e' lontanissimo; e' lo stesso che dire che il punto sull'arco vede la corda sotto un angolo > 179.5 gradi.
 *  - `ARC_MAX_RADIUS`: raggio massimo 1.000.000, come il limite delle coordinate del file (`LIMITS.coordAbs`). Con la soglia dei gradi il raggio e'
 *    gia' limitato a circa 57 volte la corda: serve solo per le corde molto lunghe.
 */
export const ARC_MIN_SWEEP_RAD = (1 * Math.PI) / 180;
export const ARC_MAX_RADIUS = 1_000_000;

export type ArcProblem = 'collinear' | 'radius';

/** Perche' tre punti non danno un arco accettabile: allineati (o quasi, o coincidenti) oppure raggio troppo grande; null se vanno bene. */
export function arcProblem(p1: Pt, p2: Pt, p3: Pt): ArcProblem | null {
  const a = arcThroughPoints(p1, p2, p3);
  if (!a || Math.abs(a.sweep) < ARC_MIN_SWEEP_RAD) return 'collinear';
  if (a.r > ARC_MAX_RADIUS) return 'radius';
  return null;
}

/** I messaggi di una riga di `arcProblem` (italiano, per l'interfaccia e per i file progetto). */
export const ARC_PROBLEM_TEXT: Record<ArcProblem, string> = {
  collinear: 'I tre punti sono allineati: un arco non passa da tre punti su una retta.',
  radius: 'Il raggio dell\'arco sarebbe troppo grande: allontana il punto sull\'arco dalla corda.',
};

/** Il punto dell'arco a frazione `t` (0 = inizio, 1 = fine). */
export function arcPointAt(a: SheetArc, t: number): SheetPoint {
  const ang = a.a0 + t * a.sweep;
  return { x: a.c.x + a.r * Math.cos(ang), y: a.c.y + a.r * Math.sin(ang) };
}
export const arcStart = (a: SheetArc): SheetPoint => arcPointAt(a, 0);
export const arcEnd = (a: SheetArc): SheetPoint => arcPointAt(a, 1);
/** Il punto a meta' dell'arco (misurato sull'arco, non il punto di passaggio indicato da chi l'ha disegnato). */
export const arcMid = (a: SheetArc): SheetPoint => arcPointAt(a, 0.5);

/** Distanza di un punto dall'arco (la linea, non l'area): dalla circonferenza se l'angolo del punto e' dentro l'arco, altrimenti dall'estremo piu' vicino. */
export function distToArc(p: Pt, a: SheetArc): number {
  const dx = p.x - a.c.x;
  const dy = p.y - a.c.y;
  const d = Math.hypot(dx, dy);
  if (isFullCircle(a)) return Math.abs(d - a.r);
  const ang = Math.atan2(dy, dx);
  const rel = a.sweep > 0 ? mod2pi(ang - a.a0) : mod2pi(a.a0 - ang);
  if (rel <= Math.abs(a.sweep)) return Math.abs(d - a.r);
  const s = arcStart(a);
  const e = arcEnd(a);
  return Math.min(Math.hypot(p.x - s.x, p.y - s.y), Math.hypot(p.x - e.x, p.y - e.y));
}

/**
 * Tracciato SVG dell'arco, nelle coordinate del foglio (lo stesso sistema dell'SVG: Y in giu'). Flag: sweep = 1 se l'angolo cresce (orario sullo
 * schermo), large-arc = 1 se |sweep| > 180 gradi. Il cerchio intero e' due mezzi archi che partono dall'angolo `a0` (cosi' il tratteggio parte dallo stesso
 * punto del disegno su canvas e del PDF) e si chiude con `Z`.
 */
export function svgArcPath(a: SheetArc): string {
  const s = arcStart(a);
  const sf = a.sweep > 0 ? 1 : 0;
  if (isFullCircle(a)) {
    const o = arcPointAt(a, 0.5);
    return `M${s.x} ${s.y}A${a.r} ${a.r} 0 0 ${sf} ${o.x} ${o.y}A${a.r} ${a.r} 0 0 ${sf} ${s.x} ${s.y}Z`;
  }
  const e = arcEnd(a);
  const large = Math.abs(a.sweep) > Math.PI ? 1 : 0;
  return `M${s.x} ${s.y}A${a.r} ${a.r} 0 ${large} ${sf} ${e.x} ${e.y}`;
}

/** Un segmento di Bezier non copre piu' di 90 gradi (richiesta della tappa); il cerchio intero sono 4 curve. */
export const BEZIER_MAX_SEGMENT_RAD = Math.PI / 2;

/**
 * L'arco come curve cubiche di Bezier di uguale ampiezza, ognuna di non piu' di 90 gradi: n = ceil(|sweep| / 90 gradi), costante 4/3 tan(ampiezza / 4)
 * per i punti di controllo (la tangente all'arco a distanza k r). Approssimazione, non esatta: l'errore radiale massimo e' misurato in `arc.test.ts`
 * (circa 2.7e-4 del raggio per una curva di 90 gradi, molto meno per ampiezze minori). Gli estremi sono sull'arco esatto.
 */
export function arcBeziers(a: SheetArc): Cubic[] {
  const n = Math.max(1, Math.ceil(Math.abs(a.sweep) / BEZIER_MAX_SEGMENT_RAD - 1e-9));
  const theta = a.sweep / n;
  const k = (4 / 3) * Math.tan(theta / 4);
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a.a0 + i * theta;
    const t1 = t0 + theta;
    const [c0, s0, c1, s1] = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)];
    const p0 = { x: a.c.x + a.r * c0, y: a.c.y + a.r * s0 };
    const p1 = { x: a.c.x + a.r * c1, y: a.c.y + a.r * s1 };
    out.push({
      p0,
      c1: { x: p0.x - k * a.r * s0, y: p0.y + k * a.r * c0 },
      c2: { x: p1.x + k * a.r * s1, y: p1.y - k * a.r * c1 },
      p1,
    });
  }
  return out;
}

/** Il punto della curva cubica al parametro t (0..1). */
export function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w0 * c.p0.x + w1 * c.c1.x + w2 * c.c2.x + w3 * c.p1.x, y: w0 * c.p0.y + w1 * c.c1.y + w2 * c.c2.y + w3 * c.p1.y };
}

/** Il cerchio o l'arco come si vede sul foglio mostrato (i punti passano da `userToSheet`); null se i punti non danno una curva. */
export function curveOnSheet(def: CurveDef, geom: PageGeometry): SheetArc | null {
  const a = geom.userToSheet(def.p1);
  const b = geom.userToSheet(def.p2);
  return def.kind === 'circle' ? circleFromCenterEdge(a, b) : arcThroughPoints(a, b, geom.userToSheet(def.p3));
}
