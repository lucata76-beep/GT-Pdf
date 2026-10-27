// Quote: geometria della linea di quota, valore misurato ed etichetta.
// Le quote lineari sono definite da due punti misurati e da un terzo punto che dice dove sta la linea di quota; Ø e R da
// due punti (decisione 8: Ø = due punti sul diametro, R = centro + punto sul bordo; la geometria del PDF si indica con punti).
// Orizzontale e verticale sono quelle che si VEDONO sul foglio (con /Rotate): si calcola nel foglio e si riporta nello
// spazio utente, dove l'oggetto e' salvato (stessa regola dell'ortogonale).
import { fmt } from './numbers';
import type { PageGeometry, SheetPoint, UserPoint } from './page';
import { type PageScale, realMm } from './scale';

export type DimType = 'aligned' | 'horizontal' | 'vertical' | 'diameter' | 'radius';

export interface DimTypeInfo {
  id: DimType;
  label: string;
  /** Etichetta breve per i pulsanti stretti. */
  short: string;
  /** Punti da indicare: 3 per le lineari (due punti + posizione della linea di quota), 2 per Ø e R. */
  points: 2 | 3;
  /** Prefisso dell'etichetta: "Ø" solo per il diametro, "R" solo per il raggio (DESIGN.md). */
  prefix: '' | 'Ø' | 'R';
}

export const DIM_TYPES: readonly DimTypeInfo[] = [
  { id: 'aligned', label: 'Quota allineata', short: 'Allineata', points: 3, prefix: '' },
  { id: 'horizontal', label: 'Quota orizzontale', short: 'Orizz.', points: 3, prefix: '' },
  { id: 'vertical', label: 'Quota verticale', short: 'Vert.', points: 3, prefix: '' },
  { id: 'diameter', label: 'Quota diametro Ø', short: 'Ø Diam.', points: 2, prefix: 'Ø' },
  { id: 'radius', label: 'Quota raggio R', short: 'R Raggio', points: 2, prefix: 'R' },
];

export const dimInfo = (t: DimType): DimTypeInfo => DIM_TYPES.find((d) => d.id === t) as DimTypeInfo;

/** Definizione geometrica di una quota, nello spazio utente PDF. */
export interface DimensionDef {
  dim: DimType;
  /** Punti misurati: origini delle linee di estensione (lineari), estremi del diametro, centro e punto sul bordo (R). */
  p1: UserPoint;
  p2: UserPoint;
  /** Estremi della linea di quota, dove stanno le frecce. Per Ø e R coincidono con p1 e p2. */
  a: UserPoint;
  b: UserPoint;
}

/** Sotto questa lunghezza (pt del foglio) due punti sono lo stesso punto. */
const EPS = 1e-6;
const dist = (a: SheetPoint, b: SheetPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Costruisce la quota dai punti indicati (3 per le lineari, 2 per Ø e R). Null se la quota e' degenere:
 * punti coincidenti, o orizzontale/verticale con i due punti alla stessa quota.
 */
export function buildDimension(dim: DimType, pts: readonly UserPoint[], geom: PageGeometry): DimensionDef | null {
  const need = dimInfo(dim).points;
  if (pts.length < need) return null;
  const p1 = pts[0] as UserPoint;
  const p2 = pts[1] as UserPoint;
  const s1 = geom.userToSheet(p1);
  const s2 = geom.userToSheet(p2);
  if (dist(s1, s2) <= EPS) return null;
  if (need === 2) return { dim, p1: { ...p1 }, p2: { ...p2 }, a: { ...p1 }, b: { ...p2 } };

  const s3 = geom.userToSheet(pts[2] as UserPoint);
  let a: SheetPoint;
  let b: SheetPoint;
  if (dim === 'aligned') {
    const len = dist(s1, s2);
    const n = { x: -(s2.y - s1.y) / len, y: (s2.x - s1.x) / len };
    const d = (s3.x - s1.x) * n.x + (s3.y - s1.y) * n.y; // distanza con segno della linea di quota dal segmento p1-p2
    a = { x: s1.x + n.x * d, y: s1.y + n.y * d };
    b = { x: s2.x + n.x * d, y: s2.y + n.y * d };
  } else if (dim === 'horizontal') {
    if (Math.abs(s2.x - s1.x) <= EPS) return null;
    a = { x: s1.x, y: s3.y };
    b = { x: s2.x, y: s3.y };
  } else {
    if (Math.abs(s2.y - s1.y) <= EPS) return null;
    a = { x: s3.x, y: s1.y };
    b = { x: s3.x, y: s2.y };
  }
  return { dim, p1: { ...p1 }, p2: { ...p2 }, a: geom.sheetToUser(a), b: geom.sheetToUser(b) };
}

/** Lunghezza misurata dalla quota, in pt FISICI del foglio (con UserUnit): lineare secondo il tipo, Ø e R tra i due punti. */
export function measuredPt(def: Pick<DimensionDef, 'dim' | 'p1' | 'p2'>, geom: PageGeometry): number {
  const s1 = geom.userToSheet(def.p1);
  const s2 = geom.userToSheet(def.p2);
  if (def.dim === 'horizontal') return Math.abs(s2.x - s1.x);
  if (def.dim === 'vertical') return Math.abs(s2.y - s1.y);
  return dist(s1, s2);
}

/** Cifre decimali del valore automatico (come tutte le misure dell'app). */
export const AUTO_DECIMALS = 2;

/** Testo del valore automatico: prefisso + mm reali con "." e 2 decimali, senza unita' ("100.00", "Ø25.40", "R12.50"). */
export const autoText = (dim: DimType, mm: number): string => `${dimInfo(dim).prefix}${fmt(mm, AUTO_DECIMALS)}`;

/** Etichetta automatica dalla scala della pagina; null se la pagina non e' calibrata (senza scala non c'e' un valore reale). */
export function autoLabel(def: Pick<DimensionDef, 'dim' | 'p1' | 'p2'>, geom: PageGeometry, scale: PageScale | null): string | null {
  if (!scale) return null;
  return autoText(def.dim, realMm(measuredPt(def, geom), scale));
}

/**
 * Etichetta mostrata: il testo digitato (`valueText`), altrimenti quello automatico. Null = automatica senza scala.
 * Un testo automatico segue le ricalibrazioni successive della pagina.
 */
export function dimensionLabel(def: Pick<DimensionDef, 'dim' | 'p1' | 'p2'> & { valueText: string | null }, geom: PageGeometry, scale: PageScale | null): string | null {
  return def.valueText !== null ? def.valueText : autoLabel(def, geom, scale);
}
