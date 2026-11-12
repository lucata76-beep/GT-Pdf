// Candidati calcolati dello snap (CP6f, decisioni 61 e 88-89 di docs/PIANO.md): Intersezione, Quadrante, Perpendicolare, Tangente. Logica senza DOM, nel foglio mostrato
// (pt fisici, /Rotate, CropBox e UserUnit gia' applicati da `PageGeometry`): il passaggio spazio utente -> foglio e' una similitudine, quindi cerchi e archi restano tali e
// questi punti si calcolano nel foglio senza flag per /Rotate (commento in testa a `arc.ts`).
//
// Perche' una SCENA: l'Intersezione confronta COPPIE di oggetti. Confrontarle tutte costa troppo (con 10.000 oggetti circa un secondo per movimento del mouse: prototipo
// dell'assistente, non codice dell'app). Ogni punto che questi tipi possono dare sta SU una curva (l'incontro di due curve sta su tutte e due; il piede della perpendicolare, il
// punto di tangenza e il quadrante stanno sulla curva): un candidato entro il raggio dal cursore richiede che la curva ci passi entro quel raggio. Quindi `extraCandidates`
//  (1) scarta subito le primitive che non passano entro il raggio dal cursore (prima il riquadro d'ingombro, poi la distanza reale);
//  (2) per l'Intersezione confronta a coppie solo quelle che restano.
// I riquadri e le primitive in pt del foglio si calcolano UNA volta (`buildSnapScene`) e si rinnovano quando cambiano il modello o la geometria della pagina (lo decide chi
// la usa), non a ogni movimento del mouse.
//
// Oggetti: Retta e Linea (ogni tratto), Cerchio, Arco e, solo per il Quadrante, la Copertura circolare. NON le altre coperture (bianche e senza bordo) ne' le quote ne' i testi.
// Niente prolungamenti ("intersezione apparente"): un tratto vale fra i suoi estremi, un arco entro il suo sweep.
//
// Tolleranze (dichiarate e provate in `snapExtra.test.ts`): `PARAM_EPS` (parametro di un tratto, relativo alla sua lunghezza), `PARALLEL_EPS` (seno dell'angolo fra due tratti),
// `TOUCH_REL` (due curve che si toccano in un punto, con uno scarto di calcolo sotto TOUCH_REL volte la loro scala, almeno TOUCH_REL pt, sono TANGENTI: UN candidato; oltre, 0 o 2),
// `ANGLE_EPS` (angolo di un punto rispetto agli estremi di un arco, in radianti).
//
// CP7d (V3.2b): Intersezione e Perpendicolare anche sui TRATTI rettilinei del disegno del PDF. I tratti non si copiano nella scena degli oggetti (centinaia di migliaia, una `Prim` di 18
// campi ciascuno): li fornisce una `PdfSegmentSource` (src/pdf/segmentIndex.ts, con un indice spaziale) che chiama `emit` per i soli tratti entro il raggio dal cursore, in un ordine
// stabile. `pdfCandidates` li tratta come le primitive-tratto degli oggetti (stesse funzioni `footOnSegment`, `intersectSegSeg`, `overlaps`, `intersections`): Perpendicolare dall'ancora,
// Intersezione fra due tratti del PDF e fra un tratto del PDF e un oggetto disegnato. Nessun prolungamento, nessuna curva del PDF. I candidati del PDF si emettono DOPO quelli degli
// oggetti: a parita' di distanza e di tipo vince l'oggetto disegnato (`findSnap` tiene il primo).
import type { PageObject } from '../model/model';
import { type SheetArc, curveOnSheet, isFullCircle } from './arc';
import type { PageGeometry, SheetPoint, UserPoint } from './page';

export type ExtraKind = 'intersection' | 'quadrant' | 'perpendicular' | 'tangent';
export type ExtraKinds = Readonly<Partial<Record<ExtraKind, boolean>>>;

/** Parametro di un tratto (0 = inizio, 1 = fine) accettato oltre gli estremi: 1e-9 della sua lunghezza. */
export const PARAM_EPS = 1e-9;
/** Due tratti con il seno dell'angolo fra loro sotto questo valore sono paralleli: nessuna intersezione (anche se sovrapposti). */
export const PARALLEL_EPS = 1e-9;
/** Tangenza: scarto di calcolo accettato, relativo alla scala (raggio o somma dei raggi, almeno 1 pt). */
export const TOUCH_REL = 1e-9;
/** Un punto di un cerchio sta in un arco anche a questo scarto (rad) dai suoi estremi. */
export const ANGLE_EPS = 1e-9;
/** Un candidato che coincide con il punto di partenza (entro questa distanza, pt) non si offre: sarebbe un segmento di lunghezza nulla. */
export const SAME_POINT_EPS = 1e-9;

const TWO_PI = 2 * Math.PI;

/**
 * CP7d. Massimo di tratti del PDF entro il raggio dal cursore: se sono di piu', il PDF non offre NESSUN candidato calcolato (Intersezione o Perpendicolare) in quel punto: il confronto a
 * coppie dei vicini cresce col quadrato del loro numero (a 256: 32.640 coppie). Con lo zoom il raggio in pt si riduce e i vicini calano. VALORE DI PARTENZA scelto da Code (numeri in
 * docs/PIANO.md, decisione 117), NON tarato sui PDF dell'utente.
 */
export const PDF_MAX_NEAR = 256;

/**
 * Sorgente dei TRATTI rettilinei del PDF per Intersezione e Perpendicolare (V3.2b, CP7d), nel foglio. `forEachNear` chiama `emit(id, path, x1, y1, x2, y2)` per ogni tratto la cui distanza
 * REALE dal punto (x, y) e' al piu' `radius` (stesso predicato di `segmentNearPoint`, bordo compreso), in ordine di `id` crescente (l'indice del tratto nella sorgente; `path` e' il
 * percorso del PDF a cui appartiene). Se i tratti sono piu' di `max` NON emette nulla e restituisce false; altrimenti true. Non e' un oggetto: non si seleziona, non si cancella.
 */
export interface PdfSegmentSource {
  forEachNear(x: number, y: number, radius: number, max: number, emit: (id: number, path: number, x1: number, y1: number, x2: number, y2: number) => void): boolean;
}

/**
 * Il tratto (x1, y1)-(x2, y2) passa entro `radius` dal punto (x, y)? `r2` = radius * radius. E' la stessa prova che `extraCandidates` fa sulle primitive-tratto (riquadro allargato di
 * `radius`, poi distanza reale dal punto piu' vicino del tratto, `<= r2`): indice e scansione lineare dei tratti del PDF la usano entrambi, cosi' danno lo stesso risultato.
 */
export function segmentNearPoint(x1: number, y1: number, x2: number, y2: number, x: number, y: number, radius: number, r2: number): boolean {
  if (x < (x1 < x2 ? x1 : x2) - radius || x > (x1 < x2 ? x2 : x1) + radius || y < (y1 < y2 ? y1 : y2) - radius || y > (y1 < y2 ? y2 : y1) + radius) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x1 + t * dx - x;
  const ey = y1 + t * dy - y;
  return ex * ex + ey * ey <= r2;
}

/**
 * Una primitiva della scena, nel foglio: un tratto (`t` 0) o un cerchio/arco (`t` 1). Un solo tipo di oggetto con tutti i campi (forma monomorfa: il ciclo che scarta
 * le primitive e' il punto caldo). `owner` e `idx`: l'oggetto e il numero del tratto (i tratti adiacenti di una Linea si incontrano nel vertice: e' un Estremo).
 */
export interface Prim {
  t: 0 | 1;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // tratto
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // cerchio o arco
  cx: number;
  cy: number;
  r: number;
  a0: number;
  sweep: number;
  full: boolean;
  /** Copertura circolare: serve solo al Quadrante. */
  quadOnly: boolean;
  owner: number;
  idx: number;
}

export interface SnapScene {
  prims: Prim[];
}

const blank = (t: 0 | 1, owner: number, idx: number): Prim => ({ t, minX: 0, minY: 0, maxX: 0, maxY: 0, x1: 0, y1: 0, x2: 0, y2: 0, cx: 0, cy: 0, r: 0, a0: 0, sweep: 0, full: true, quadOnly: false, owner, idx });

function segPrim(owner: number, idx: number, ax: number, ay: number, bx: number, by: number): Prim {
  const p = blank(0, owner, idx);
  p.x1 = ax;
  p.y1 = ay;
  p.x2 = bx;
  p.y2 = by;
  p.minX = Math.min(ax, bx);
  p.maxX = Math.max(ax, bx);
  p.minY = Math.min(ay, by);
  p.maxY = Math.max(ay, by);
  return p;
}

function ringPrim(owner: number, a: SheetArc, quadOnly: boolean): Prim {
  const p = blank(1, owner, 0);
  p.cx = a.c.x;
  p.cy = a.c.y;
  p.r = a.r;
  p.a0 = a.a0;
  p.sweep = a.sweep;
  p.full = isFullCircle(a);
  p.quadOnly = quadOnly;
  // riquadro prudente: quello del cerchio intero (un arco non e' piu' grande)
  p.minX = a.c.x - a.r;
  p.maxX = a.c.x + a.r;
  p.minY = a.c.y - a.r;
  p.maxY = a.c.y + a.r;
  return p;
}

/** La scena di una pagina: tutte le primitive, in pt del foglio, con i loro riquadri. Costo lineare; si rifa' solo quando cambiano oggetti o pagina. */
export function buildSnapScene(objects: readonly PageObject[], geom: PageGeometry): SnapScene {
  const prims: Prim[] = [];
  for (let oi = 0; oi < objects.length; oi++) {
    const o = objects[oi] as PageObject;
    switch (o.kind) {
      case 'segment':
      case 'polyline': {
        let prev: SheetPoint | null = null;
        for (let i = 0; i < o.points.length; i++) {
          const s = geom.userToSheet(o.points[i] as UserPoint);
          if (prev) prims.push(segPrim(oi, i - 1, prev.x, prev.y, s.x, s.y));
          prev = s;
        }
        break;
      }
      case 'circle':
      case 'arc': {
        const a = curveOnSheet(o, geom);
        if (a) prims.push(ringPrim(oi, a, false));
        break;
      }
      case 'cover': {
        if (o.shape !== 'circle') break;
        const c = geom.userToSheet(o.p1);
        const e = geom.userToSheet(o.p2);
        const r = Math.hypot(e.x - c.x, e.y - c.y);
        if (r > 0 && Number.isFinite(r)) prims.push(ringPrim(oi, { c, r, a0: 0, sweep: TWO_PI }, true));
        break;
      }
      default:
        break; // quote e testi: nessuno di questi tipi di snap
    }
  }
  return { prims };
}

// ---- Geometria pura ----

const mod2pi = (x: number): number => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** Il punto (x, y), che sta sul cerchio di `p`, cade nell'arco? Il cerchio intero: sempre. */
export function inArc(p: Pick<Prim, 'cx' | 'cy' | 'a0' | 'sweep' | 'full'>, x: number, y: number): boolean {
  if (p.full) return true;
  const ang = Math.atan2(y - p.cy, x - p.cx);
  const rel = p.sweep > 0 ? mod2pi(ang - p.a0) : mod2pi(p.a0 - ang);
  return rel <= Math.abs(p.sweep) + ANGLE_EPS || rel >= TWO_PI - ANGLE_EPS;
}

type SegLike = Pick<Prim, 'x1' | 'y1' | 'x2' | 'y2'>;
type RingLike = Pick<Prim, 'cx' | 'cy' | 'r'>;

/** L'incontro di due tratti (dentro tutti e due, estremi compresi), o null (paralleli e sovrapposti compresi). */
export function intersectSegSeg(a: SegLike, b: SegLike): SheetPoint | null {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) <= PARALLEL_EPS * Math.hypot(rx, ry) * Math.hypot(sx, sy) || den === 0) return null;
  const qx = b.x1 - a.x1;
  const qy = b.y1 - a.y1;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -PARAM_EPS || t > 1 + PARAM_EPS || u < -PARAM_EPS || u > 1 + PARAM_EPS) return null;
  return { x: a.x1 + t * rx, y: a.y1 + t * ry };
}

/** Gli incontri di un tratto con il CERCHIO intero (0, 1 se tangente, o 2), dentro il tratto. L'eventuale limite dell'arco lo applica chi chiama. */
export function intersectSegCircle(s: SegLike, c: RingLike): SheetPoint[] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [];
  const tc = ((c.cx - s.x1) * dx + (c.cy - s.y1) * dy) / len2; // parametro del piede del centro sulla retta del tratto
  const fx = s.x1 + tc * dx;
  const fy = s.y1 + tc * dy;
  const h = Math.hypot(fx - c.cx, fy - c.cy); // distanza del centro dalla retta
  const tol = TOUCH_REL * Math.max(1, c.r);
  if (h > c.r + tol) return [];
  const out: SheetPoint[] = [];
  const push = (t: number): void => {
    if (t >= -PARAM_EPS && t <= 1 + PARAM_EPS) out.push({ x: s.x1 + t * dx, y: s.y1 + t * dy });
  };
  if (h >= c.r - tol) {
    push(tc); // tangente: un solo punto, il piede
    return out;
  }
  const half = Math.sqrt(c.r * c.r - h * h) / Math.sqrt(len2);
  push(tc - half);
  push(tc + half);
  return out;
}

/** Gli incontri di due CERCHI interi (0, 1 se tangenti, o 2). Concentrici o coincidenti: nessuno. */
export function intersectCircleCircle(p: RingLike, q: RingLike): SheetPoint[] {
  const dx = q.cx - p.cx;
  const dy = q.cy - p.cy;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [];
  const tol = TOUCH_REL * Math.max(1, p.r + q.r);
  const outer = p.r + q.r;
  const inner = Math.abs(p.r - q.r);
  if (d > outer + tol || d < inner - tol) return [];
  const ux = dx / d;
  const uy = dy / d;
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d); // distanza dal centro di p alla corda comune
  if (Math.abs(d - outer) <= tol || Math.abs(d - inner) <= tol) return [{ x: p.cx + a * ux, y: p.cy + a * uy }]; // tangenti
  const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  const mx = p.cx + a * ux;
  const my = p.cy + a * uy;
  return [
    { x: mx - h * uy, y: my + h * ux },
    { x: mx + h * uy, y: my - h * ux },
  ];
}

/** Il piede della perpendicolare da `a` sulla retta del tratto, se cade DENTRO il tratto (estremi compresi); null altrimenti o se il tratto e' nullo. */
export function footOnSegment(s: SegLike, ax: number, ay: number): SheetPoint | null {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((ax - s.x1) * dx + (ay - s.y1) * dy) / len2;
  if (t < -PARAM_EPS || t > 1 + PARAM_EPS) return null;
  return { x: s.x1 + t * dx, y: s.y1 + t * dy };
}

/** I due punti del cerchio sulla retta per il centro e `a` (i piedi delle perpendicolari da `a`); nessuno se `a` e' nel centro. */
export function footsOnCircle(c: RingLike, ax: number, ay: number): SheetPoint[] {
  const dx = ax - c.cx;
  const dy = ay - c.cy;
  const d = Math.hypot(dx, dy);
  if (!(d > SAME_POINT_EPS)) return [];
  const ux = dx / d;
  const uy = dy / d;
  return [
    { x: c.cx + c.r * ux, y: c.cy + c.r * uy },
    { x: c.cx - c.r * ux, y: c.cy - c.r * uy },
  ];
}

/** I punti di tangenza delle tangenti dal punto `a` al cerchio: due se `a` e' fuori, nessuno se e' dentro o sul cerchio (entro TOUCH_REL). */
export function tangentPoints(c: RingLike, ax: number, ay: number): SheetPoint[] {
  const dx = ax - c.cx;
  const dy = ay - c.cy;
  const d = Math.hypot(dx, dy);
  if (d <= c.r + TOUCH_REL * Math.max(1, c.r)) return [];
  const theta = Math.atan2(dy, dx);
  const phi = Math.acos(c.r / d);
  return [
    { x: c.cx + c.r * Math.cos(theta + phi), y: c.cy + c.r * Math.sin(theta + phi) },
    { x: c.cx + c.r * Math.cos(theta - phi), y: c.cy + c.r * Math.sin(theta - phi) },
  ];
}

/** I quattro punti del cerchio a 0, 90, 180 e 270 gradi nel foglio MOSTRATO: destra, basso, sinistra, alto del foglio come li vede la persona (Y in giu'). */
export function quadrantPoints(c: RingLike): SheetPoint[] {
  return [
    { x: c.cx + c.r, y: c.cy },
    { x: c.cx, y: c.cy + c.r },
    { x: c.cx - c.r, y: c.cy },
    { x: c.cx, y: c.cy - c.r },
  ];
}

// ---- Ricerca ----

/** I riquadri di due primitive si toccano o si sovrappongono (con un piccolo margine: due curve tangenti hanno riquadri che si toccano a meno dell'errore di calcolo). */
function overlaps(a: Prim, b: Prim): boolean {
  const m = 1e-6 + 1e-9 * (a.maxX - a.minX + a.maxY - a.minY + b.maxX - b.minX + b.maxY - b.minY);
  return a.minX <= b.maxX + m && b.minX <= a.maxX + m && a.minY <= b.maxY + m && b.minY <= a.maxY + m;
}

/** L'insieme dei punti di incontro di due primitive (gia' filtrati per i loro limiti: tratto e arco). */
function intersections(a: Prim, b: Prim, emit: (p: SheetPoint) => void): void {
  if (a.t === 0 && b.t === 0) {
    const p = intersectSegSeg(a, b);
    if (p) emit(p);
    return;
  }
  if (a.t === 0 || b.t === 0) {
    const s = a.t === 0 ? a : b;
    const ring = a.t === 0 ? b : a;
    for (const p of intersectSegCircle(s, ring)) if (inArc(ring, p.x, p.y)) emit(p);
    return;
  }
  for (const p of intersectCircleCircle(a, b)) if (inArc(a, p.x, p.y) && inArc(b, p.x, p.y)) emit(p);
}

/**
 * Chiama `emit(x, y, kind)` per i candidati calcolati che possono stare entro `radius` dal punto `raw`. NON filtra per distanza i punti che emette (lo fa chi li riceve:
 * `findSnap`); scarta pero' le primitive lontane (vedi il commento in testa). `anchor` (foglio) e' il punto di partenza di Perpendicolare e Tangente: senza, quei due tipi
 * non hanno candidati.
 */
export function extraCandidates(scene: SnapScene, raw: SheetPoint, radius: number, kinds: ExtraKinds, anchor: SheetPoint | null, emit: (x: number, y: number, kind: ExtraKind) => void, pdf?: PdfSegmentSource | null): void {
  const wantInter = kinds.intersection === true;
  const wantQuad = kinds.quadrant === true;
  const wantPerp = kinds.perpendicular === true && anchor !== null;
  const wantTan = kinds.tangent === true && anchor !== null;
  if (!wantInter && !wantQuad && !wantPerp && !wantTan) return;
  // CP7d: i tratti del PDF danno l'Intersezione (la Perpendicolare e' del punto successivo)
  const wantPdf = !!pdf && wantInter;
  const prims = scene.prims;
  const r2 = radius * radius;
  // (1) scarto: riquadro e poi distanza reale dal cursore
  const near: Prim[] = [];
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i] as Prim;
    if (raw.x < p.minX - radius || raw.x > p.maxX + radius || raw.y < p.minY - radius || raw.y > p.maxY + radius) continue;
    if (p.t === 0) {
      const dx = p.x2 - p.x1;
      const dy = p.y2 - p.y1;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((raw.x - p.x1) * dx + (raw.y - p.y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = p.x1 + t * dx - raw.x;
      const ey = p.y1 + t * dy - raw.y;
      if (ex * ex + ey * ey <= r2) near.push(p);
    } else {
      const dist = Math.hypot(raw.x - p.cx, raw.y - p.cy);
      if (Math.abs(dist - p.r) > radius) continue;
      if (!p.full) {
        // un arco: la distanza reale e' dalla circonferenza se l'angolo del cursore e' nello sweep, altrimenti dall'estremo piu' vicino
        if (!inArc(p, raw.x, raw.y)) {
          const s = { x: p.cx + p.r * Math.cos(p.a0), y: p.cy + p.r * Math.sin(p.a0) };
          const e = { x: p.cx + p.r * Math.cos(p.a0 + p.sweep), y: p.cy + p.r * Math.sin(p.a0 + p.sweep) };
          if (Math.min((s.x - raw.x) ** 2 + (s.y - raw.y) ** 2, (e.x - raw.x) ** 2 + (e.y - raw.y) ** 2) > r2) continue;
        }
      }
      near.push(p);
    }
  }
  if (near.length === 0 && !wantPdf) return;
  // (2) candidati sulle primitive rimaste
  for (let i = 0; i < near.length; i++) {
    const p = near[i] as Prim;
    if (p.t === 1) {
      if (wantQuad) for (const q of quadrantPoints(p)) if (inArc(p, q.x, q.y)) emit(q.x, q.y, 'quadrant');
      if (p.quadOnly) continue;
      if (anchor) {
        if (wantPerp) {
          for (const q of footsOnCircle(p, anchor.x, anchor.y)) if (inArc(p, q.x, q.y) && Math.hypot(q.x - anchor.x, q.y - anchor.y) > SAME_POINT_EPS) emit(q.x, q.y, 'perpendicular');
        }
        if (wantTan) for (const q of tangentPoints(p, anchor.x, anchor.y)) if (inArc(p, q.x, q.y)) emit(q.x, q.y, 'tangent');
      }
    } else if (wantPerp && anchor) {
      const f = footOnSegment(p, anchor.x, anchor.y);
      if (f && Math.hypot(f.x - anchor.x, f.y - anchor.y) > SAME_POINT_EPS) emit(f.x, f.y, 'perpendicular');
    }
  }
  if (wantInter) {
    for (let i = 0; i < near.length; i++) {
      const a = near[i] as Prim;
      if (a.quadOnly) continue;
      for (let j = i + 1; j < near.length; j++) {
        const b = near[j] as Prim;
        if (b.quadOnly || !overlaps(a, b)) continue;
        if (a.owner === b.owner && a.t === 0 && b.t === 0 && Math.abs(a.idx - b.idx) === 1) continue; // tratti adiacenti di una Linea: si toccano nel vertice (Estremo)
        intersections(a, b, (p) => emit(p.x, p.y, 'intersection'));
      }
    }
  }
  // (3) CP7d: i tratti del PDF, dopo tutti i candidati degli oggetti
  if (wantPdf) pdfCandidates(pdf as PdfSegmentSource, near, raw, radius, emit);
}

/** I due tratti hanno un estremo in comune (uguale al bit: gli stessi numeri del PDF portati nel foglio con la stessa formula)? */
function shareEndpoint(a: Prim, b: Prim): boolean {
  return (a.x1 === b.x1 && a.y1 === b.y1) || (a.x1 === b.x2 && a.y1 === b.y2) || (a.x2 === b.x1 && a.y2 === b.y1) || (a.x2 === b.x2 && a.y2 === b.y2);
}

/** Primitive-tratto riutilizzate fra una chiamata e l'altra (al piu' PDF_MAX_NEAR): nessun oggetto nuovo a ogni movimento del mouse. */
const pdfPool: Prim[] = [];

/**
 * Candidati dei tratti del PDF entro `radius` da `raw` (CP7d). Intersezione: (i) fra due tratti del PDF, (ii) fra un tratto del PDF e una primitiva degli oggetti vicina al cursore (`objNear`: Retta, Linea, Cerchio, Arco). Due tratti dello
 * STESSO percorso del PDF con un estremo in comune si toccano nel vertice, che e' un Estremo (come i tratti adiacenti di una Linea): nessuna Intersezione li'. `PdfSegmentSource` non
 * dice quale sottopercorso e' di quale: fra tratti dello stesso percorso e con un estremo uguale al bit si salta il confronto (anche la chiusura di un poligono); a parita' di distanza
 * l'Estremo vince comunque per priorita'. Con piu' di `PDF_MAX_NEAR` tratti vicini non si emette nulla.
 */
function pdfCandidates(src: PdfSegmentSource, objNear: readonly Prim[], raw: SheetPoint, radius: number, emit: (x: number, y: number, kind: ExtraKind) => void): void {
  let n = 0;
  const ok = src.forEachNear(raw.x, raw.y, radius, PDF_MAX_NEAR, (id, path, ax, ay, bx, by) => {
    let p = pdfPool[n];
    if (!p) pdfPool[n] = p = blank(0, 0, 0);
    p.owner = path;
    p.idx = id;
    p.x1 = ax;
    p.y1 = ay;
    p.x2 = bx;
    p.y2 = by;
    p.minX = ax < bx ? ax : bx;
    p.maxX = ax < bx ? bx : ax;
    p.minY = ay < by ? ay : by;
    p.maxY = ay < by ? by : ay;
    n++;
  });
  if (!ok || n === 0) return;
  const out = (p: SheetPoint): void => emit(p.x, p.y, 'intersection');
  for (let i = 0; i < n; i++) {
    const a = pdfPool[i] as Prim;
    for (let j = i + 1; j < n; j++) {
      const b = pdfPool[j] as Prim;
      if (!overlaps(a, b) || (a.owner === b.owner && shareEndpoint(a, b))) continue;
      const p = intersectSegSeg(a, b);
      if (p) out(p);
    }
    for (let k = 0; k < objNear.length; k++) {
      const b = objNear[k] as Prim;
      if (b.quadOnly || !overlaps(a, b)) continue;
      intersections(a, b, out);
    }
  }
}
