// Raccordo (CP6h, V2c): l'arco di cerchio di raggio R tangente a due rette, fra DUE TRATTI di Retta o Linea. Geometria pura, senza DOM e senza modello (il modello e il comando
// sono in `model/fillet`). Si calcola nel FOGLIO mostrato (pt fisici, Y in giu'): /Rotate, CropBox e UserUnit sono gia' dentro `PageGeometry` (similitudini), il raggio e' in pt FISICI del
// foglio (`filletRadiusPt`: mm reali con la scala della pagina, mm del foglio senza) e i punti da salvare tornano nello spazio utente con `sheetToUser`.
//
// Formule (decisione del 8/11/2026, PARTE 3.1 della richiesta; verificate nei test con una costruzione indipendente: il centro e' l'incrocio delle due rette spostate di R):
//   V  = incrocio delle due rette PROLUNGATE (parallele o quasi: rifiuto, con la soglia di `angular`)
//   u1, u2 = i versori da V verso la parte scelta di ogni tratto; theta = angolo fra loro, in (0, 180) gradi
//   t  = R / tan(theta / 2)   distanza di tangenza (da V lungo u_k)
//   b  = (u1 + u2) / |u1 + u2|   bisettrice;   C = V + R / sin(theta / 2) * b   centro;   T_k = V + t * u_k   punti di tangenza;   M = C - R * b   punto sull'arco
//   L'arco va da T1 a T2 passando per M e copre 180 - theta gradi (con theta vicino a 180 l'arco e' corto: `arcProblem` rifiuta quello sotto 1 grado).
// La PARTE da tenere di ogni tratto la decide il clic: se il tratto sta tutto da un lato di V (V e' fuori o a un estremo) la decide il tratto stesso; se V cade DENTRO il tratto
// la decide il segno del clic rispetto a V sulla retta (clic grezzo, senza snap). Un tratto e' accorciato da T_k all'estremo lontano; la parte fra l'estremo vicino e T_k si toglie.
import { ANGLE_MIN_DEG, ANGULAR_COORD_LIMIT, ON_LINE_EPS_PT, type PickedSide } from './angular';
import { type ArcProblem, arcProblem } from './arc';
import type { PageGeometry, SheetPoint, UserPoint } from './page';
import { mmToPt } from './pixels';
import { type PageScale, ptForRealMm } from './scale';

/**
 * Quanto deve restare, al minimo, del tratto fra il punto di tangenza e il suo estremo lontano (pt del foglio): 0,001 pt, lo stesso valore di `EXACT_MIN_DISTANCE_PT`
 * (`app/construction`: sotto, due punti sono lo stesso punto). Un test controlla che siano uguali. Il caso "esattamente al limite" e' accettato, subito sotto e' rifiutato.
 */
export const FILLET_MIN_REMAINDER_PT = 0.001;
/** Raggio minimo (pt fisici del foglio): 0,01 pt = 0,0035 mm. Sotto, i tre punti dell'arco sarebbero indistinguibili dalle coordinate del tratto. */
export const FILLET_MIN_RADIUS_PT = 0.01;

const DEG = Math.PI / 180;
const cross = (a: SheetPoint, b: SheetPoint): number => a.x * b.y - a.y * b.x;
const dot = (a: SheetPoint, b: SheetPoint): number => a.x * b.x + a.y * b.y;
const sub = (a: SheetPoint, b: SheetPoint): SheetPoint => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: SheetPoint): number => Math.hypot(a.x, a.y);

/** Il raggio in pt FISICI del foglio da una cifra in mm: reali se la pagina ha una scala, del foglio se no (la stessa regola del passo della griglia). */
export const filletRadiusPt = (mm: number, scale: PageScale | null): number => (scale ? ptForRealMm(mm, scale) : mmToPt(mm));

/** Un tratto scelto per il raccordo: il tratto (come per la quota angolare) e il punto in cui si e' cliccato, nello spazio utente e GREZZO (senza snap). */
export interface FilletSide extends PickedSide {
  click: UserPoint;
}

/** Perche' due tratti e un raggio non danno un raccordo. */
export type FilletProblem =
  | 'same-side' // lo stesso tratto scelto due volte
  | 'parallel' // rette parallele o sulla stessa retta (angolo < ANGLE_MIN_DEG o > 180 - ANGLE_MIN_DEG), o un tratto di lunghezza nulla
  | 'on-vertex' // V cade dentro il tratto e il clic e' sul vertice: non dice da che parte stare
  | 'radius' // raggio non finito o sotto FILLET_MIN_RADIUS_PT
  | 'far' // il vertice, un punto di tangenza o il punto sull'arco escono dai limiti del foglio
  | 'beyond' // il punto di tangenza cade oltre l'estremo lontano del tratto: raggio troppo grande per quel tratto (o tratto troppo corto)
  | 'gap' // il tratto comincia dopo il punto di tangenza: non arriva al raccordo
  | 'arc'; // i punti non danno un arco accettabile (tratti quasi sulla stessa retta: sotto 1 grado)

/** Un estremo del raccordo: dove il tratto tocca l'arco e quale estremo del tratto si sostituisce. */
export interface FilletEnd {
  /** Punto di tangenza, spazio utente. */
  tangent: UserPoint;
  /** L'estremo del tratto (`a` = primo punto, `b` = secondo punto del tratto) che si sostituisce con `tangent`: quello piu' vicino a V lungo la parte tenuta. */
  replace: 'a' | 'b';
}

export interface Fillet {
  /** Uno per tratto, nell'ordine in cui si sono scelti. */
  ends: [FilletEnd, FilletEnd];
  /** Punto sull'arco (M), spazio utente. */
  mid: UserPoint;
  /** Centro e vertice (V) nello spazio utente, e la distanza di tangenza t in pt del foglio. */
  center: UserPoint;
  vertex: UserPoint;
  tangentPt: number;
  /** Angolo fra i tratti e angolo coperto dall'arco (gradi): sweep = 180 - theta. */
  thetaDeg: number;
  sweepDeg: number;
}

export type FilletResult = { ok: true; fillet: Fillet } | { ok: false; problem: FilletProblem; tract?: 1 | 2; arc?: ArcProblem };

/** I messaggi di una riga (italiano) dei rifiuti che non nominano un tratto; `beyond` e `gap` nominano il tratto e sono in `filletProblemText`. */
export const FILLET_PROBLEM_TEXT: Record<Exclude<FilletProblem, 'beyond' | 'gap'>, string> = {
  'same-side': 'Hai scelto due volte lo stesso tratto: scegli un\'altra linea.',
  parallel: 'Le due linee sono parallele (o sulla stessa retta): non si possono raccordare.',
  'on-vertex': 'Hai toccato il vertice: tocca un punto del tratto, lontano dall\'incrocio.',
  radius: 'Il raggio è troppo piccolo: digita un numero più grande.',
  far: 'Il raccordo uscirebbe dai limiti del foglio.',
  arc: 'Le due linee sono quasi sulla stessa retta: l\'arco coprirebbe meno di 1 grado.',
};

/** Il messaggio di una riga di un rifiuto, con il numero del tratto dove serve. */
export function filletProblemText(r: { problem: FilletProblem; tract?: 1 | 2 }): string {
  if (r.problem === 'beyond') return `Raggio troppo grande per il tratto ${r.tract ?? 1}: il raccordo uscirebbe dal tratto.`;
  if (r.problem === 'gap') return `Il tratto ${r.tract ?? 1} non arriva fino al raccordo: serve un raggio più grande.`;
  return FILLET_PROBLEM_TEXT[r.problem];
}

const outOfLimits = (p: UserPoint, limit: number): boolean => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > limit || Math.abs(p.y) > limit;

interface Oriented {
  /** Versore da V verso la parte tenuta. */
  u: SheetPoint;
  /** Coordinate lungo u, a partire da V, dell'estremo vicino e di quello lontano del tratto. */
  near: number;
  far: number;
  replace: 'a' | 'b';
}

/**
 * Orienta un tratto rispetto a V. Se il tratto sta tutto da una parte di V (V e' fuori o a un estremo, entro ON_LINE_EPS_PT) la parte tenuta e' quella del tratto, qualunque sia il clic;
 * se V sta dentro il tratto decide il clic (il segno di (clic - V) lungo la retta). Null se V e' dentro e il clic e' sul vertice.
 */
function orient(v: SheetPoint, a: SheetPoint, b: SheetPoint, click: SheetPoint): Oriented | null {
  const ab = sub(b, a);
  const l = len(ab);
  const d = { x: ab.x / l, y: ab.y / l };
  const sa = dot(sub(a, v), d);
  const sb = dot(sub(b, v), d);
  let sign: 1 | -1;
  if (Math.min(sa, sb) >= -ON_LINE_EPS_PT) sign = 1;
  else if (Math.max(sa, sb) <= ON_LINE_EPS_PT) sign = -1;
  else {
    const sc = dot(sub(click, v), d);
    if (Math.abs(sc) <= ON_LINE_EPS_PT) return null;
    sign = sc > 0 ? 1 : -1;
  }
  const ua = sign * sa;
  const ub = sign * sb;
  return { u: { x: sign * d.x, y: sign * d.y }, near: Math.min(ua, ub), far: Math.max(ua, ub), replace: ua < ub ? 'a' : 'b' };
}

interface Basis {
  /** Incrocio delle due rette (foglio) e nello spazio utente. */
  v: SheetPoint;
  vUser: UserPoint;
  o1: Oriented;
  o2: Oriented;
}

/**
 * Quello che non dipende dal raggio: lo stesso tratto, rette parallele (o un tratto di lunghezza nulla), vertice fuori dai limiti, clic sul vertice quando V sta dentro il tratto.
 * Serve a `filletFromSides` e a `filletSidesProblem` (che lo dice appena si sceglie il secondo tratto, prima di chiedere il raggio).
 */
function basis(s1: FilletSide, s2: FilletSide, geom: PageGeometry, limit: number): { ok: true; b: Basis } | { ok: false; problem: FilletProblem } {
  if (s1.id === s2.id && s1.index === s2.index) return { ok: false, problem: 'same-side' };
  const a1 = geom.userToSheet(s1.a);
  const b1 = geom.userToSheet(s1.b);
  const a2 = geom.userToSheet(s2.a);
  const b2 = geom.userToSheet(s2.b);
  const l1 = len(sub(b1, a1));
  const l2 = len(sub(b2, a2));
  if (!(l1 > ON_LINE_EPS_PT) || !(l2 > ON_LINE_EPS_PT)) return { ok: false, problem: 'parallel' };
  const d1 = { x: (b1.x - a1.x) / l1, y: (b1.y - a1.y) / l1 };
  const d2 = { x: (b2.x - a2.x) / l2, y: (b2.y - a2.y) / l2 };
  const folded = Math.atan2(Math.abs(cross(d1, d2)), dot(d1, d2)); // [0, pi]
  if (!(folded >= ANGLE_MIN_DEG * DEG) || !(folded <= Math.PI - ANGLE_MIN_DEG * DEG)) return { ok: false, problem: 'parallel' };
  const k = cross(sub(a2, a1), d2) / cross(d1, d2);
  const v = { x: a1.x + d1.x * k, y: a1.y + d1.y * k };
  const vUser = geom.sheetToUser(v);
  if (outOfLimits(vUser, limit)) return { ok: false, problem: 'far' };
  const o1 = orient(v, a1, b1, geom.userToSheet(s1.click));
  const o2 = orient(v, a2, b2, geom.userToSheet(s2.click));
  if (!o1 || !o2) return { ok: false, problem: 'on-vertex' };
  return { ok: true, b: { v, vUser, o1, o2 } };
}

/** Perche' due tratti scelti non danno un raccordo con NESSUN raggio (lo stesso tratto, rette parallele, vertice fuori dai limiti, clic sul vertice), o null. Si controlla appena si sceglie il secondo. */
export function filletSidesProblem(s1: FilletSide, s2: FilletSide, geom: PageGeometry, limit = ANGULAR_COORD_LIMIT): FilletProblem | null {
  const r = basis(s1, s2, geom, limit);
  return r.ok ? null : r.problem;
}

/**
 * Il raccordo di raggio `radiusPt` (pt FISICI del foglio) fra due tratti scelti. Rifiuta, nell'ordine: lo stesso tratto, un raggio non valido, rette parallele, vertice fuori dai limiti, il clic
 * sul vertice (solo se V e' dentro il tratto), un punto di tangenza fuori dal tratto (`beyond`: oltre l'estremo lontano meno FILLET_MIN_REMAINDER_PT; `gap`: prima dell'estremo
 * vicino), punti oltre `limit` (+-limit unita' utente), e un arco che `arcProblem` non accetta (la stessa funzione della costruzione e della lettura del file).
 */
export function filletFromSides(s1: FilletSide, s2: FilletSide, radiusPt: number, geom: PageGeometry, limit = ANGULAR_COORD_LIMIT): FilletResult {
  if (s1.id === s2.id && s1.index === s2.index) return { ok: false, problem: 'same-side' };
  if (!Number.isFinite(radiusPt) || !(radiusPt >= FILLET_MIN_RADIUS_PT)) return { ok: false, problem: 'radius' };
  const base = basis(s1, s2, geom, limit);
  if (!base.ok) return { ok: false, problem: base.problem };
  const { v, vUser, o1, o2 } = base.b;

  const theta = Math.atan2(Math.abs(cross(o1.u, o2.u)), dot(o1.u, o2.u)); // (0, pi): le rette non sono parallele
  const half = theta / 2;
  const t = radiusPt / Math.tan(half);
  const sum = { x: o1.u.x + o2.u.x, y: o1.u.y + o2.u.y };
  const sl = len(sum); // 2 cos(theta / 2) > 0
  const bis = { x: sum.x / sl, y: sum.y / sl };
  const dC = radiusPt / Math.sin(half);
  const center = { x: v.x + bis.x * dC, y: v.y + bis.y * dC };
  const mid = { x: v.x + bis.x * (dC - radiusPt), y: v.y + bis.y * (dC - radiusPt) };
  const t1 = { x: v.x + o1.u.x * t, y: v.y + o1.u.y * t };
  const t2 = { x: v.x + o2.u.x * t, y: v.y + o2.u.y * t };

  // il punto di tangenza deve stare dentro il tratto: fra l'estremo vicino (con una piccola tolleranza) e l'estremo lontano meno il residuo minimo
  for (const [i, o] of [o1, o2].entries()) {
    const tract = (i + 1) as 1 | 2;
    if (!(t <= o.far - FILLET_MIN_REMAINDER_PT)) return { ok: false, problem: 'beyond', tract };
    if (!(t >= o.near - ON_LINE_EPS_PT)) return { ok: false, problem: 'gap', tract };
  }

  const T1 = geom.sheetToUser(t1);
  const T2 = geom.sheetToUser(t2);
  const M = geom.sheetToUser(mid);
  if (outOfLimits(T1, limit) || outOfLimits(T2, limit) || outOfLimits(M, limit)) return { ok: false, problem: 'far' };
  const problem = arcProblem(T1, M, T2);
  if (problem) return { ok: false, problem: 'arc', arc: problem };

  return {
    ok: true,
    fillet: {
      ends: [
        { tangent: T1, replace: o1.replace },
        { tangent: T2, replace: o2.replace },
      ],
      mid: M,
      center: geom.sheetToUser(center),
      vertex: vUser,
      tangentPt: t,
      thetaDeg: theta / DEG,
      sweepDeg: 180 - theta / DEG,
    },
  };
}
