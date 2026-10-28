import { describe, expect, it } from 'vitest';
import { buildDimension } from '../geometry/dimension';
import { PageGeometry } from '../geometry/page';
import type { CoverObject, DimensionObject, LineObject, TextObject } from './model';
import { buildDrawItems, objectLayoutFor } from './scene';

const g = new PageGeometry({ view: [0, 0, 400, 500], rotate: 90, userUnit: 1 });
const line: LineObject = { id: 1, kind: 'segment', points: [{ x: 10, y: 10 }, { x: 100, y: 50 }], stroke: { style: 'dashed', color: '#D32F2F', widthPt: 1 } };
const cover: CoverObject = { id: 2, kind: 'cover', shape: 'rect', p1: { x: 20, y: 20 }, p2: { x: 80, y: 60 } };
const text: TextObject = { id: 3, kind: 'text', at: { x: 50, y: 50 }, text: 'FORO', textPt: 10, color: '#1565C0' };
const def = buildDimension('aligned', [{ x: 100, y: 100 }, { x: 300, y: 120 }, { x: 200, y: 60 }], g);
if (!def) throw new Error('quota degenere');
const dim: DimensionObject = { id: 4, kind: 'dim', ...def, valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 };

describe('buildDrawItems: la scena che disegnano a schermo e l\'esportazione "Appiattito"', () => {
  it('le coperture per prime (anche se create dopo), poi il resto nell\'ordine di creazione', () => {
    const items = buildDrawItems([line, cover, text, dim], g, { mmPerPt: 0.5 });
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['cover:2', 'line:1', 'layout:3', 'layout:4']);
  });
  it('la linea e\' sul foglio mostrato (con /Rotate), con le sue proprieta\'', () => {
    const [item] = buildDrawItems([line], g, null);
    expect(item?.kind).toBe('line');
    if (item?.kind !== 'line') return;
    expect(item.points).toEqual(line.points.map((p) => g.userToSheet(p)));
    expect(item.stroke).toBe(line.stroke);
  });
  it('quota automatica: valore dalla scala; senza scala "?" (non si nasconde l\'errore); digitata: il testo digitato', () => {
    expect(objectLayoutFor(dim, g, { mmPerPt: 0.5 }).texts[0]?.text).toBe('100.50');
    expect(objectLayoutFor(dim, g, null).texts[0]?.text).toBe('?');
    expect(objectLayoutFor({ ...dim, valueText: 'Ø8 ±0.1' }, g, null).texts[0]?.text).toBe('Ø8 ±0.1');
    expect(objectLayoutFor(text, g, null).texts[0]?.text).toBe('FORO');
  });
});
