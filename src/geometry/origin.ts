// Origine delle coordinate relative (CP6d, decisioni 58 e 59 di docs/PIANO.md). Logica senza DOM, nel foglio mostrato come grid.ts e snap.ts.
//
// - L'origine di una pagina e' un punto dello spazio utente PDF (come gli oggetti); si porta nel foglio mostrato con `PageGeometry`.
// - Assi: X verso destra e Y verso l'ALTO nel foglio MOSTRATO (come la Y della barra di stato), anche con /Rotate: sono gli assi che si vedono.
// - Unita': mm REALI se la pagina ha una scala (`ptForRealMm`), altrimenti mm del FOGLIO (`mmToPt`): la stessa regola di `gridStepPt` (grid.ts).
//   Una ricalibrazione cambia quindi il valore in pt di 1 mm, non le coordinate digitate.
// - Le coordinate relative sono "numeri della persona" (mm); il foglio e lo spazio utente sono in pt. Le conversioni sono lineari: nessun arrotondamento.
import { type PageGeometry, type SheetPoint, type UserPoint } from './page';
import { mmToPt } from './pixels';
import { type PageScale, ptForRealMm } from './scale';

/** Una coordinata relativa all'origine, in mm (reali con la scala, del foglio senza), Y verso l'alto. */
export interface RelPoint {
  x: number;
  y: number;
}

/** Quanti pt del foglio sono 1 mm delle coordinate relative: mm reali se la pagina ha una scala, altrimenti mm del foglio. */
export function relUnitPt(scale: PageScale | null): number {
  return scale ? ptForRealMm(1, scale) : mmToPt(1);
}

/** Come si chiama l'unita' delle coordinate relative: la barra di stato lo scrive accanto ai valori. */
export const relUnitLabel = (scale: PageScale | null): 'mm reali' | 'mm foglio' => (scale ? 'mm reali' : 'mm foglio');

/** Il riferimento di una pagina: dov'e' l'origine sul foglio mostrato e quanti pt vale 1 mm. */
export interface OriginFrame {
  /** L'origine sul foglio mostrato (pt fisici, angolo in alto a sinistra). */
  sheet: SheetPoint;
  /** pt del foglio per 1 mm delle coordinate relative. */
  unitPt: number;
}

export function originFrame(geom: PageGeometry, origin: UserPoint, scale: PageScale | null): OriginFrame {
  return { sheet: geom.userToSheet(origin), unitPt: relUnitPt(scale) };
}

/** Foglio -> coordinate relative (X a destra, Y in alto, in mm). */
export function sheetToRel(f: OriginFrame, p: SheetPoint): RelPoint {
  return { x: (p.x - f.sheet.x) / f.unitPt, y: (f.sheet.y - p.y) / f.unitPt };
}

/** Coordinate relative (mm) -> foglio. */
export function relToSheet(f: OriginFrame, r: RelPoint): SheetPoint {
  return { x: f.sheet.x + r.x * f.unitPt, y: f.sheet.y - r.y * f.unitPt };
}

/** Coordinate relative (mm) -> spazio utente PDF, dove si salvano i punti. */
export function relToUser(geom: PageGeometry, f: OriginFrame, r: RelPoint): UserPoint {
  return geom.sheetToUser(relToSheet(f, r));
}

/** Spazio utente PDF -> coordinate relative (mm). */
export function userToRel(geom: PageGeometry, f: OriginFrame, u: UserPoint): RelPoint {
  return sheetToRel(f, geom.userToSheet(u));
}

/** Tolleranza (pt del foglio) per dire che un punto sta sul bordo della pagina: un valore digitato esatto sul bordo non deve cadere fuori per l'errore dei double. */
export const EDGE_EPS_PT = 1e-9;

/** Il punto del foglio sta nella pagina, bordo compreso (con `EDGE_EPS_PT`): lo stesso criterio di `PageGeometry.contains`, appena meno rigido. */
export const inPageWithEps = (geom: PageGeometry, p: SheetPoint): boolean =>
  p.x >= -EDGE_EPS_PT && p.y >= -EDGE_EPS_PT && p.x <= geom.width + EDGE_EPS_PT && p.y <= geom.height + EDGE_EPS_PT;
