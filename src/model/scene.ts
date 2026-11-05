// Scena di una pagina: gli oggetti come primitive sul foglio (pt fisici, origine in alto a sinistra), dal fondo al primo piano.
// Sta qui, e non nell'interfaccia, perche' la usano due "pittori" con lo STESSO elenco di primitive: il livello SVG a schermo
// (`ui/overlay.ts`) e il pittore su canvas dell'esportazione "Appiattito" (`export/paint.ts`). La geometria (layout di quote e testi,
// coperture, ordine di disegno) e' una sola; cambia solo dove si scrive.
import { type SheetArc, curveOnSheet } from '../geometry/arc';
import { type SheetCover, coverOnSheet } from '../geometry/cover';
import { dimensionLabel } from '../geometry/dimension';
import { type Layout, layoutDimension, layoutText } from '../geometry/layout';
import type { PageGeometry, SheetPoint } from '../geometry/page';
import type { PageScale } from '../geometry/scale';
import { type DimensionObject, type LineObject, type PageObject, type TextObject, drawOrder, isCurve, isLine } from './model';
import type { Stroke } from './stroke';

/**
 * Rette e linee (spezzata con tipo di linea), cerchi e archi (un arco sul foglio con tipo di linea), testi e quote (primitive gia' calcolate dal layout) oppure coperture.
 * Le coperture vanno in uno strato SOTTO a tutto il resto: l'ordine della lista conta solo dentro lo stesso strato.
 */
export type DrawItem =
  | { kind: 'line'; id: number; points: readonly SheetPoint[]; stroke: Stroke }
  | { kind: 'curve'; id: number; arc: SheetArc; stroke: Stroke }
  | { kind: 'layout'; id: number; layout: Layout }
  | { kind: 'cover'; id: number; cover: SheetCover };

/** Carattere dei testi sul foglio: Helvetica come nell'esportazione (decisione 6); Arial e Liberation Sans hanno le stesse larghezze. */
export const DRAWING_FONT = "Helvetica, Arial, 'Liberation Sans', sans-serif";

/**
 * Layout di un testo o di una quota (sempre dritti sul foglio). Una quota automatica senza scala non dovrebbe esistere:
 * "?" per non nascondere l'errore.
 */
export function objectLayoutFor(o: TextObject | DimensionObject, g: PageGeometry, scale: PageScale | null): Layout {
  if (o.kind === 'text') return layoutText(o, g);
  return layoutDimension(o, g, dimensionLabel(o, g, scale) ?? '?');
}

export const sheetLine = (o: LineObject, g: PageGeometry): SheetPoint[] => o.points.map((p) => g.userToSheet(p));

/** Gli oggetti dal fondo al primo piano: le coperture stanno sotto tutto, anche se disegnate dopo. */
export function buildDrawItems(objects: readonly PageObject[], g: PageGeometry, scale: PageScale | null): DrawItem[] {
  const items: DrawItem[] = [];
  for (const o of drawOrder(objects)) {
    if (o.kind === 'cover') items.push({ kind: 'cover', id: o.id, cover: coverOnSheet(o, g) });
    else if (isLine(o)) items.push({ kind: 'line', id: o.id, points: sheetLine(o, g), stroke: o.stroke });
    else if (isCurve(o)) {
      const arc = curveOnSheet(o, g);
      if (arc) items.push({ kind: 'curve', id: o.id, arc, stroke: o.stroke }); // punti che non danno una curva (non succede: costruzione e file lo escludono): niente da disegnare
    } else items.push({ kind: 'layout', id: o.id, layout: objectLayoutFor(o, g, scale) });
  }
  return items;
}
