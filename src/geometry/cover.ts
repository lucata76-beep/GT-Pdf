// Coperture bianche: rettangolo, quadrato e cerchio. Tutte hanno due punti nello spazio utente PDF:
//   rettangolo = due angoli opposti; quadrato = i due angoli opposti DOPO la squadratura (vedi `squareSheet`);
//   cerchio    = p1 centro, p2 punto sul bordo (il raggio e' la distanza).
// Un rettangolo e' sempre allineato agli assi del foglio mostrato; con /Rotate multiplo di 90 coincide con gli assi dello
// spazio utente, quindi in CP5 si scrive con un normale rettangolo (`coverUserBox`), senza rotazione.
import type { Shape, SheetCircle, SheetRect } from './layout';
import type { PageGeometry, SheetPoint, UserPoint } from './page';

export type CoverKind = 'rect' | 'square' | 'circle';

export interface CoverTypeInfo {
  id: CoverKind;
  label: string;
  /** Etichetta breve per i pulsanti stretti. */
  short: string;
}

export const COVER_TYPES: readonly CoverTypeInfo[] = [
  { id: 'rect', label: 'Copertura rettangolare', short: 'Rettangolo' },
  { id: 'square', label: 'Copertura quadrata', short: 'Quadrato' },
  { id: 'circle', label: 'Copertura circolare', short: 'Cerchio' },
];

export const coverInfo = (k: CoverKind): CoverTypeInfo => COVER_TYPES.find((c) => c.id === k) as CoverTypeInfo;

/** Definizione di una copertura nello spazio utente PDF. */
export interface CoverDef {
  shape: CoverKind;
  p1: UserPoint;
  p2: UserPoint;
}

/** Copertura sul foglio mostrato (pt fisici, origine in alto a sinistra). */
export type SheetCover = { kind: 'rect'; rect: SheetRect } | { kind: 'circle'; circle: SheetCircle };

/**
 * Quadrato da due punti: il primo e' un angolo, il secondo indica direzione e misura. Il lato e' il maggiore tra
 * |dx| e |dy| (sul foglio come si vede) e il quadrato cresce verso il punto indicato; con dx o dy nullo cresce verso
 * destra / verso il basso. Restituisce l'angolo opposto. Idempotente: squadrare un punto gia' squadrato lo lascia dov'e'.
 */
export function squareSheet(a: SheetPoint, raw: SheetPoint): SheetPoint {
  const dx = raw.x - a.x;
  const dy = raw.y - a.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + (dx < 0 ? -side : side), y: a.y + (dy < 0 ? -side : side) };
}

/** Lo stesso, con i punti nello spazio utente. */
export function squareUser(p1: UserPoint, p2: UserPoint, geom: PageGeometry): UserPoint {
  return geom.sheetToUser(squareSheet(geom.userToSheet(p1), geom.userToSheet(p2)));
}

/** La copertura come si vede sul foglio. Il quadrato e' gia' squadrato nei suoi punti: qui e' un rettangolo. */
export function coverOnSheet(def: CoverDef, geom: PageGeometry): SheetCover {
  const a = geom.userToSheet(def.p1);
  const b = geom.userToSheet(def.p2);
  if (def.shape === 'circle') return { kind: 'circle', circle: { c: a, r: Math.hypot(b.x - a.x, b.y - a.y) } };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { kind: 'rect', rect: { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) } };
}

/** Forma piena, per scegliere la copertura con un tocco, evidenziarla e disegnarne il contorno. */
export const coverShapeOf = (c: SheetCover): Shape => (c.kind === 'rect' ? { lines: [], rects: [c.rect], circles: [] } : { lines: [], rects: [], circles: [c.circle] });

/** Rettangolo nello spazio utente (unita' utente, origine in basso a sinistra): per rettangolo e quadrato. */
export function coverUserBox(def: CoverDef): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(def.p1.x, def.p2.x), y: Math.min(def.p1.y, def.p2.y), w: Math.abs(def.p2.x - def.p1.x), h: Math.abs(def.p2.y - def.p1.y) };
}

/** Raggio del cerchio in unita' utente (i pt fisici sono questo valore per UserUnit). */
export const coverUserRadius = (def: CoverDef): number => Math.hypot(def.p2.x - def.p1.x, def.p2.y - def.p1.y);
