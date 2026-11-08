// Quota angolare (CP6g, decisioni 62 e 93 e seguenti di docs/PIANO.md): geometria pura, senza DOM e senza modello.
// Si lavora nel FOGLIO mostrato (pt fisici, Y in giu'): l'angolo che si vede resta quello con /Rotate, CropBox e UserUnit (sono similitudini). Si salva nello
// spazio utente, come ogni oggetto, con i quattro punti di `DimensionDef`:
//   a  = il vertice (incrocio delle due rette, o il primo punto indicato)
//   p1 = un punto sulla semiretta del primo lato, p2 = un punto sulla semiretta del secondo lato (a distanza > 0 dal vertice)
//   b  = il punto di mezzo dell'arco, sulla bisettrice, a distanza R dal vertice (R = raggio dell'arco)
// L'angolo quotato e' SEMPRE il minore fra i due lati, in (0, 180) gradi esclusi; l'arco va dal lato 1 al lato 2 per la via breve.
// La quota e' STATICA: nessun riferimento agli oggetti-linea da cui e' nata (se una linea si sposta o si cancella, la quota resta com'e').
import { distToSegment } from './hit';
import type { PageGeometry, SheetPoint, UserPoint } from './page';

/** Sotto questo angolo (gradi) fra i due lati, o sopra 180 meno questo, i lati sono "sulla stessa retta" e la quota si rifiuta. Ne' 0.00 ne' 180.00 si possono mostrare. */
export const ANGLE_MIN_DEG = 0.005;
/** Distanza dal vertice (pt del foglio, al massimo meta' del raggio) del punto p di un lato che sta tutto sul prolungamento opposto: il lato non tocca la semiretta. */
export const SIDE_STUB_PT = 1;
/** Un punto a meno di cosi' (pt del foglio) dal vertice o da una delle due rette non individua un settore. */
export const ON_LINE_EPS_PT = 1e-6;
/** Arco a segmenti (decisione dell'utente: nessun arco vero nel layout): passo massimo, scarto massimo dal vero arco, e tetto al numero di segmenti. */
export const ARC_MAX_STEP_DEG = 2;
export const ARC_MAX_DEVIATION_PT = 0.02;
export const ARC_MAX_SEGMENTS = 2000;

const DEG = Math.PI / 180;
const cross = (a: SheetPoint, b: SheetPoint): number => a.x * b.y - a.y * b.x;
const dot = (a: SheetPoint, b: SheetPoint): number => a.x * b.x + a.y * b.y;
const sub = (a: SheetPoint, b: SheetPoint): SheetPoint => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: SheetPoint): number => Math.hypot(a.x, a.y);
const unit = (a: SheetPoint): SheetPoint => {
  const l = len(a);
  return { x: a.x / l, y: a.y / l };
};
const rot = (u: SheetPoint, rad: number): SheetPoint => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: u.x * c - u.y * s, y: u.x * s + u.y * c };
};

/** I quattro punti di una quota angolare (spazio utente): gli stessi campi di `DimensionDef` senza il tipo. */
export interface AngularPoints {
  p1: UserPoint;
  p2: UserPoint;
  a: UserPoint;
  b: UserPoint;
}

/** Geometria nel foglio: vertice, versori dei due lati, raggio, angolo con segno (verso orario sul foglio se positivo, essendo Y in giu') e bisettrice. */
export interface AngularGeometry {
  v: SheetPoint;
  u1: SheetPoint;
  u2: SheetPoint;
  radius: number;
  /** Da u1 a u2, per la via breve: in (-pi, pi), mai 0 ne' +-pi. */
  sweep: number;
  /** |sweep|, in (0, pi). */
  angle: number;
  /** Versore della bisettrice (dal vertice verso il punto di mezzo dell'arco). */
  mid: SheetPoint;
}

/** Perche' i punti non danno una quota angolare. */
export type AngularProblem =
  | 'same-side' // lo stesso tratto scelto due volte
  | 'parallel' // lati paralleli o sulla stessa retta (angolo < ANGLE_MIN_DEG o > 180 - ANGLE_MIN_DEG)
  | 'at-vertex' // il punto coincide con il vertice (raggio nullo, o un lato di lunghezza nulla)
  | 'on-line' // il punto dell'arco sta su una delle due rette: non dice in quale dei quattro angoli
  | 'far'; // il vertice esce dai limiti del foglio

export const ANGULAR_PROBLEM_TEXT: Record<AngularProblem, string> = {
  'same-side': 'Hai scelto due volte lo stesso tratto: scegli un\'altra linea.',
  parallel: 'Le due linee sono parallele (o sulla stessa retta): non formano un angolo.',
  'at-vertex': 'Il punto coincide con il vertice: scegli un punto più lontano.',
  'on-line': 'Il punto è su una delle due linee: scegli un punto dentro l\'angolo da quotare.',
  far: 'Le due linee si incontrano troppo lontano dal foglio: non si può quotare questo angolo.',
};

export type AngularResult = { ok: true; points: AngularPoints } | { ok: false; problem: AngularProblem };

/** Un tratto (due punti) nello spazio utente: un lato scelto con "da due linee". */
export interface SideTract {
  a: UserPoint;
  b: UserPoint;
}
/** Un tratto scelto: di quale oggetto (id) e quale tratto della sua spezzata (indice del primo punto). Solo per riconoscere "lo stesso tratto". */
export interface PickedSide extends SideTract {
  id: number;
  index: number;
}

/**
 * Geometria nel foglio dai quattro punti salvati. Null se non e' una quota angolare valida: un lato o il raggio di lunghezza nulla, o lati sulla stessa retta
 * (angolo fuori da [ANGLE_MIN_DEG, 180 - ANGLE_MIN_DEG]). Estremi inclusi: 180 - 0.005 = 179.995 e' il massimo e 0.005 il minimo.
 */
export function angularGeometry(def: AngularPoints, geom: PageGeometry): AngularGeometry | null {
  const v = geom.userToSheet(def.a);
  const d1 = sub(geom.userToSheet(def.p1), v);
  const d2 = sub(geom.userToSheet(def.p2), v);
  const radius = len(sub(geom.userToSheet(def.b), v));
  if (!(len(d1) > 0) || !(len(d2) > 0) || !(radius > 0)) return null;
  const u1 = unit(d1);
  const u2 = unit(d2);
  const sweep = Math.atan2(cross(u1, u2), dot(u1, u2));
  const angle = Math.abs(sweep);
  if (!(angle >= ANGLE_MIN_DEG * DEG) || !(angle <= Math.PI - ANGLE_MIN_DEG * DEG)) return null;
  return { v, u1, u2, radius, sweep, angle, mid: rot(u1, sweep / 2) };
}

/** L'angolo in gradi decimali, in (0, 180) esclusi; null se i punti non danno una quota angolare. */
export function angleDegrees(def: AngularPoints, geom: PageGeometry): number | null {
  const g = angularGeometry(def, geom);
  return g ? g.angle / DEG : null;
}

/**
 * Perche' i quattro punti salvati (SPAZIO UTENTE) non sono una quota angolare valida, o null. Serve alla lettura del file, dove non c'e' una pagina: gli angoli non
 * cambiano passando dallo spazio utente al foglio (e' una similitudine), quindi il controllo e' lo stesso di `angularGeometry`.
 */
export function angularUserProblem(def: AngularPoints): string | null {
  const d1 = { x: def.p1.x - def.a.x, y: def.p1.y - def.a.y };
  const d2 = { x: def.p2.x - def.a.x, y: def.p2.y - def.a.y };
  const r = { x: def.b.x - def.a.x, y: def.b.y - def.a.y };
  if (!(len(d1) > 0)) return 'p1 coincide con il vertice a.';
  if (!(len(d2) > 0)) return 'p2 coincide con il vertice a.';
  if (!(len(r) > 0)) return 'b coincide con il vertice a: il raggio dell\'arco deve essere maggiore di zero.';
  const angle = Math.abs(Math.atan2(cross(unit(d1), unit(d2)), dot(unit(d1), unit(d2))));
  if (!(angle >= ANGLE_MIN_DEG * DEG) || !(angle <= Math.PI - ANGLE_MIN_DEG * DEG)) return `i due lati sono sulla stessa retta (angolo ${(angle / DEG).toFixed(4)} gradi): l'angolo deve stare fra ${ANGLE_MIN_DEG} e ${180 - ANGLE_MIN_DEG} gradi.`;
  return null;
}

/** I punti salvati da vertice, due punti sui lati e raggio: `b` e' SEMPRE il punto di mezzo dell'arco sulla bisettrice (forma canonica: due modalita', stesso oggetto). */
function canonical(v: SheetPoint, p1: UserPoint, p2: UserPoint, radius: number, geom: PageGeometry): AngularResult {
  const a = geom.sheetToUser(v);
  const draft: AngularPoints = { p1: { ...p1 }, p2: { ...p2 }, a, b: a };
  // la bisettrice si calcola dagli stessi punti salvati (come la rileggera' `angularGeometry`): cosi' ricalcolare dal file da' lo stesso `b`
  const v0 = geom.userToSheet(a);
  const u1 = unit(sub(geom.userToSheet(p1), v0));
  const u2 = unit(sub(geom.userToSheet(p2), v0));
  const sweep = Math.atan2(cross(u1, u2), dot(u1, u2));
  const mid = rot(u1, sweep / 2);
  draft.b = geom.sheetToUser({ x: v0.x + mid.x * radius, y: v0.y + mid.y * radius });
  return angularGeometry(draft, geom) ? { ok: true, points: draft } : { ok: false, problem: 'parallel' };
}

const outOfLimits = (p: UserPoint, limit: number): boolean => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > limit || Math.abs(p.y) > limit;

/**
 * Modalita' "da tre punti": vertice, un punto sul primo lato, un punto sul secondo lato e un punto che fissa il RAGGIO dell'arco (la sua distanza dal vertice).
 * L'angolo e' sempre il minore fra i due lati. Rifiuta: punti coincidenti con il vertice, lati sulla stessa retta.
 */
export function angularFromPoints(vertex: UserPoint, p1: UserPoint, p2: UserPoint, radiusPoint: UserPoint, geom: PageGeometry, limit = Infinity): AngularResult {
  const v = geom.userToSheet(vertex);
  const s1 = geom.userToSheet(p1);
  const s2 = geom.userToSheet(p2);
  const r = len(sub(geom.userToSheet(radiusPoint), v));
  if (!(len(sub(s1, v)) > ON_LINE_EPS_PT) || !(len(sub(s2, v)) > ON_LINE_EPS_PT) || !(r > ON_LINE_EPS_PT)) return { ok: false, problem: 'at-vertex' };
  const res = canonical(v, p1, p2, r, geom);
  if (res.ok && outOfLimits(res.points.b, limit)) return { ok: false, problem: 'far' };
  return res;
}

/** L'incrocio delle due rette per i tratti (nel foglio), con le direzioni unitarie; null se sono parallele o sulla stessa retta (angolo < ANGLE_MIN_DEG) o un tratto ha lunghezza nulla. */
function lineCrossing(s1: SideTract, s2: SideTract, geom: PageGeometry): { v: SheetPoint; d1: SheetPoint; d2: SheetPoint; a1: SheetPoint; a2: SheetPoint; b1: SheetPoint; b2: SheetPoint } | null {
  const a1 = geom.userToSheet(s1.a);
  const b1 = geom.userToSheet(s1.b);
  const a2 = geom.userToSheet(s2.a);
  const b2 = geom.userToSheet(s2.b);
  const l1 = len(sub(b1, a1));
  const l2 = len(sub(b2, a2));
  if (!(l1 > ON_LINE_EPS_PT) || !(l2 > ON_LINE_EPS_PT)) return null;
  const d1 = unit(sub(b1, a1));
  const d2 = unit(sub(b2, a2));
  const folded = Math.atan2(Math.abs(cross(d1, d2)), dot(d1, d2)); // [0, pi]
  if (!(folded >= ANGLE_MIN_DEG * DEG) || !(folded <= Math.PI - ANGLE_MIN_DEG * DEG)) return null;
  const t = cross(sub(a2, a1), d2) / cross(d1, d2);
  return { v: { x: a1.x + d1.x * t, y: a1.y + d1.y * t }, d1, d2, a1, a2, b1, b2 };
}

/**
 * Il punto `p` di un lato: sulla semiretta `r` (versore) uscente dal vertice, per un tratto di estremi `e1` ed `e2`. E' il punto del tratto (sulla semiretta) piu' VICINO all'ARCO,
 * cioe' alla distanza `radius` dal vertice: se il tratto contiene la distanza dell'arco, p ci sta sopra (nessuna linea di estensione: il lato tocca l'arco); se finisce prima
 * (o comincia dopo) p e' l'estremo piu' vicino all'arco (la linea di estensione va da li' all'arco); se il tratto sta tutto dall'altra parte del vertice, p e' a SIDE_STUB_PT
 * (al massimo meta' del raggio) dal vertice e la linea di estensione va quasi dal vertice all'arco.
 */
function sidePoint(v: SheetPoint, r: SheetPoint, e1: SheetPoint, e2: SheetPoint, radius: number): SheetPoint {
  const s1 = dot(sub(e1, v), r);
  const s2 = dot(sub(e2, v), r);
  const hi = Math.max(s1, s2);
  const lo = Math.max(Math.min(s1, s2), 0);
  const rho = hi > ON_LINE_EPS_PT ? Math.min(Math.max(radius, lo), hi) : Math.min(SIDE_STUB_PT, radius / 2);
  return { x: v.x + r.x * rho, y: v.y + r.y * rho };
}

/**
 * Modalita' "da due linee": due tratti scelti e un punto `p` che fissa l'angolo e l'arco. Il vertice e' l'incrocio delle due rette PROLUNGATE (puo' stare fuori dai tratti). Le due
 * rette dividono il piano in quattro settori: quello in cui cade `p` e' l'angolo quotato, la distanza di `p` dal vertice e' il raggio dell'arco. Il settore e' {alfa u1 + beta u2}:
 * i segni di alfa e beta danno le due semirette che lo delimitano (sigma1 u1 e sigma2 u2), e l'angolo e' quello fra di esse (theta, 180 - theta, theta, 180 - theta nei quattro).
 * Rifiuta: lo stesso tratto due volte, rette parallele o sulla stessa retta, `p` sul vertice o su una delle due rette (a meno di ON_LINE_EPS_PT), vertice fuori da `limit` (+-limit pt utente).
 */
export function angularFromLines(s1: PickedSide, s2: PickedSide, p: UserPoint, geom: PageGeometry, limit = Infinity): AngularResult {
  if (s1.id === s2.id && s1.index === s2.index) return { ok: false, problem: 'same-side' };
  const x = lineCrossing(s1, s2, geom);
  if (!x) return { ok: false, problem: 'parallel' };
  const vUser = geom.sheetToUser(x.v);
  if (outOfLimits(vUser, limit)) return { ok: false, problem: 'far' };
  const sp = geom.userToSheet(p);
  const w = sub(sp, x.v);
  const radius = len(w);
  if (!(radius > ON_LINE_EPS_PT)) return { ok: false, problem: 'at-vertex' };
  const D = cross(x.d1, x.d2);
  const dist1 = Math.abs(cross(x.d1, w)); // distanza di p dalla retta 1
  const dist2 = Math.abs(cross(x.d2, w));
  if (dist1 <= ON_LINE_EPS_PT || dist2 <= ON_LINE_EPS_PT) return { ok: false, problem: 'on-line' };
  const alpha = cross(w, x.d2) / D;
  const beta = cross(x.d1, w) / D;
  const r1 = alpha > 0 ? x.d1 : { x: -x.d1.x, y: -x.d1.y };
  const r2 = beta > 0 ? x.d2 : { x: -x.d2.x, y: -x.d2.y };
  const q1 = sidePoint(x.v, r1, x.a1, x.b1, radius);
  const q2 = sidePoint(x.v, r2, x.a2, x.b2, radius);
  const res = canonical(x.v, geom.sheetToUser(q1), geom.sheetToUser(q2), radius, geom);
  if (res.ok && outOfLimits(res.points.b, limit)) return { ok: false, problem: 'far' };
  return res;
}

/** Passo (rad) dell'arco a segmenti: il minore fra ARC_MAX_STEP_DEG e quello per cui lo scarto massimo R (1 - cos(passo / 2)) non supera ARC_MAX_DEVIATION_PT. */
export function arcStepRad(radius: number): number {
  const byStep = ARC_MAX_STEP_DEG * DEG;
  if (!(radius > ARC_MAX_DEVIATION_PT)) return byStep; // anche una corda lunga quanto il diametro sbaglia al massimo R < scarto
  const byDeviation = 2 * Math.acos(1 - ARC_MAX_DEVIATION_PT / radius);
  return Math.min(byStep, byDeviation);
}

/** Numero di segmenti dell'arco: ceil(|sweep| / passo), almeno 1 e al massimo ARC_MAX_SEGMENTS (oltre il tetto lo scarto puo' superare ARC_MAX_DEVIATION_PT: solo per R > ~64.000 pt). */
export function arcSegments(radius: number, angle: number): number {
  return Math.max(1, Math.min(ARC_MAX_SEGMENTS, Math.ceil(angle / arcStepRad(radius) - 1e-12)));
}

/** I punti dell'arco (polilinea sul foglio) dal lato 1 al lato 2, per la via breve. Il primo e l'ultimo sono ESATTAMENTE vertice + raggio * versore del lato. */
export function arcPoints(g: AngularGeometry): SheetPoint[] {
  const n = arcSegments(g.radius, g.angle);
  const pts: SheetPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k === 0 ? g.u1 : k === n ? g.u2 : rot(g.u1, (g.sweep * k) / n);
    pts.push({ x: g.v.x + u.x * g.radius, y: g.v.y + u.y * g.radius });
  }
  return pts;
}

/**
 * Il tratto di una spezzata (o la retta) piu' vicino a `raw`, o null. `candidates` sono le Rette e le Linee della pagina nell'ordine di disegno (dal fondo al primo piano).
 * Si sceglie il PIU' VICINO entro `tolPt` (non il primo in primo piano come `pickTop`); a parita' (1e-9 pt) vince l'ultimo, cioe' il piu' in primo piano. I tratti di lunghezza nulla
 * si saltano (non hanno una direzione).
 */
export function pickSide(candidates: readonly { id: number; points: readonly UserPoint[] }[], geom: PageGeometry, raw: SheetPoint, tolPt: number): PickedSide | null {
  let best: PickedSide | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    for (let i = 0; i + 1 < c.points.length; i++) {
      const a = c.points[i] as UserPoint;
      const b = c.points[i + 1] as UserPoint;
      const sa = geom.userToSheet(a);
      const sb = geom.userToSheet(b);
      if (!(len(sub(sb, sa)) > ON_LINE_EPS_PT)) continue;
      const d = distToSegment(raw, sa, sb);
      if (d <= tolPt && d <= bestD + 1e-9) {
        best = { id: c.id, index: i, a: { ...a }, b: { ...b } };
        bestD = Math.min(bestD, d);
      }
    }
  }
  return best;
}
