// Distanze punto-segmento, punto-spezzata e punto-forma, per scegliere l'oggetto da cancellare con un tocco.
// Si lavora nel foglio (pt fisici, isotropo): la tolleranza in pt = pixel di schermo / zoom.
import type { Shape, SheetRect } from './layout';
import type { Pt } from './page';

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) best = Math.min(best, distToSegment(p, a, b));
  }
  if (pts.length === 1 && pts[0]) best = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  return best;
}

/** Distanza dal rettangolo pieno: 0 dentro. */
export function distToRect(p: Pt, r: SheetRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function distToShape(p: Pt, shape: Shape): number {
  let best = Infinity;
  for (const l of shape.lines) best = Math.min(best, distToPolyline(p, l));
  for (const r of shape.rects) best = Math.min(best, distToRect(p, r));
  return best;
}

/** L'elemento piu' vicino a `p` entro `tol`; a parita' vince quello disegnato per ultimo (sopra). */
export function pickNearest<T>(items: readonly T[], shapeOf: (item: T) => Shape, p: Pt, tol: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = distToShape(p, shapeOf(item));
    if (d <= tol && d <= bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}
