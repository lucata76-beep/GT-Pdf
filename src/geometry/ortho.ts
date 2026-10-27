// Vincolo ortogonale: il punto e' portato su orizzontale o verticale rispetto all'ancora, COME APPARE SULLO SCHERMO
// (quindi nel foglio mostrato, con /Rotate gia' applicato). Con /Rotate 90 una linea orizzontale sullo schermo e'
// verticale nello spazio utente PDF: per questo il vincolo si calcola nel foglio e poi si riporta nello spazio utente.
import type { PageGeometry, SheetPoint, UserPoint } from './page';

/** Sposta `p` sull'asse dominante rispetto ad `a` (a parita' di spostamento: orizzontale). Tutto nel foglio. */
export function orthoSheet(anchor: SheetPoint, p: SheetPoint): SheetPoint {
  return Math.abs(p.x - anchor.x) >= Math.abs(p.y - anchor.y) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y };
}

/** Come `orthoSheet`, con ancora e punto nello spazio utente: il risultato e' nello spazio utente. */
export function orthoUser(geom: PageGeometry, anchor: UserPoint, p: UserPoint): UserPoint {
  return geom.sheetToUser(orthoSheet(geom.userToSheet(anchor), geom.userToSheet(p)));
}
