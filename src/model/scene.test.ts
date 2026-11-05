import { describe, expect, it } from 'vitest';
import { buildDimension } from '../geometry/dimension';
import { PageGeometry } from '../geometry/page';
import { curveOnSheet } from '../geometry/arc';
import type { ArcObject, CircleObject, CoverObject, DimensionObject, LineObject, TextObject } from './model';
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

describe('buildDrawItems: cerchi e archi (V2b)', () => {
  const st = { style: 'solid', color: '#2E7D32', widthPt: 1 } as const;
  const circle: CircleObject = { id: 10, kind: 'circle', p1: { x: 100, y: 100 }, p2: { x: 140, y: 100 }, stroke: st };
  const arc: ArcObject = { id: 11, kind: 'arc', p1: { x: 100, y: 300 }, p2: { x: 150, y: 340 }, p3: { x: 220, y: 300 }, stroke: st };
  it('stesso strato di linee, testi e quote, nell\'ordine di creazione; le coperture restano sotto', () => {
    const items = buildDrawItems([line, circle, cover, text, arc, dim], g, { mmPerPt: 0.5 });
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['cover:2', 'line:1', 'curve:10', 'layout:3', 'curve:11', 'layout:4']);
  });
  it('sono archi sul foglio mostrato (con /Rotate) con il loro tratto; il cerchio e\' un giro intero', () => {
    const [c, a] = buildDrawItems([circle, arc], g, null);
    expect(c?.kind).toBe('curve');
    expect(a?.kind).toBe('curve');
    if (c?.kind !== 'curve' || a?.kind !== 'curve') return;
    expect(c.arc).toEqual(curveOnSheet(circle, g));
    expect(Math.abs(c.arc.sweep)).toBeCloseTo(2 * Math.PI, 12);
    expect(c.arc.r).toBeCloseTo(40, 9);
    expect(a.arc).toEqual(curveOnSheet(arc, g));
    expect(a.stroke).toBe(st);
  });
  it('punti che non danno una curva (non puo\' succedere): nessuna voce, nessun errore', () => {
    const bad: ArcObject = { id: 12, kind: 'arc', p1: { x: 0, y: 0 }, p2: { x: 5, y: 5 }, p3: { x: 10, y: 10 }, stroke: st };
    expect(buildDrawItems([bad, line], g, null).map((i) => i.id)).toEqual([1]);
  });
});

