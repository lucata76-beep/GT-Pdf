// Misura di distanza tra due punti (strumento Distanza).
// Con la scala della pagina: unita' reali (mm). Senza: mm sul foglio, e il testo invita a calibrare.
import { fmt, fmtSigned } from './numbers';
import type { PageGeometry, UserPoint } from './page';
import { ptToMm } from './pixels';
import { type PageScale, realMm } from './scale';

export interface Measurement {
  /** Distanza sul foglio, in pt fisici (1/72 in). */
  dPt: number;
  /** Distanza sul foglio, in mm. */
  sheetMm: number;
  /** Spostamento come appare sullo schermo: x verso destra, y verso l'ALTO (come Y nella barra di stato), in pt del foglio. */
  dxPt: number;
  dyPt: number;
  /** Valori reali in mm; null se la pagina non e' calibrata. */
  real: { mm: number; dx: number; dy: number } | null;
}

export function measure(geom: PageGeometry, a: UserPoint, b: UserPoint, scale: PageScale | null): Measurement {
  const sa = geom.userToSheet(a);
  const sb = geom.userToSheet(b);
  const dxPt = sb.x - sa.x;
  const dyPt = -(sb.y - sa.y);
  const dPt = geom.distancePt(a, b);
  return {
    dPt,
    sheetMm: ptToMm(dPt),
    dxPt,
    dyPt,
    real: scale ? { mm: realMm(dPt, scale), dx: realMm(dxPt, scale), dy: realMm(dyPt, scale) } : null,
  };
}

export const NOT_CALIBRATED = 'Pagina non calibrata';

/** Righe del badge sul foglio. */
export function measureLines(m: Measurement): string[] {
  if (m.real) return [`L ${fmt(m.real.mm)} mm`, `ΔX ${fmtSigned(m.real.dx)}  ΔY ${fmtSigned(m.real.dy)}`];
  return [`Foglio ${fmt(m.sheetMm)} mm`, 'non calibrata'];
}

/** Messaggio per la barra di stato. */
export function measureMessage(m: Measurement): string {
  if (m.real) return `Distanza ${fmt(m.real.mm)} mm (ΔX ${fmtSigned(m.real.dx)}, ΔY ${fmtSigned(m.real.dy)})`;
  return `${NOT_CALIBRATED}: distanza sul foglio ${fmt(m.sheetMm)} mm. Usa Scala per le misure reali.`;
}
