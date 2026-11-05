// Scelta con un tocco di cerchi e archi (V2b): si sceglie SULLA LINEA, non dentro (un disco pieno nasconderebbe gli oggetti sotto).
import { describe, expect, it } from 'vitest';
import { type SheetArc, arcThroughPoints, circleFromCenterEdge } from './arc';
import { coverOnSheet, coverShapeOf } from './cover';
import { distToShape, pickTop } from './hit';
import type { Shape } from './layout';
import { PageGeometry } from './page';

const ring = (c: { x: number; y: number }, r: number): SheetArc => circleFromCenterEdge(c, { x: c.x + r, y: c.y }) as SheetArc;
const shapeOfArc = (a: SheetArc): Shape => ({ lines: [], rects: [], circles: [], arcs: [a] });
const DEG = Math.PI / 180;
const at = (c: { x: number; y: number }, r: number, deg: number) => ({ x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) });

describe('distToShape: cerchio come anello, arco come linea', () => {
  const C = { x: 200, y: 200 };
  it('cerchio: sulla linea 0, a 3 dentro e a 3 fuori 3, NEL CENTRO e dentro lontano dalla linea no (distanza = distanza dalla linea)', () => {
    const s = shapeOfArc(ring(C, 50));
    expect(distToShape({ x: 250, y: 200 }, s)).toBeCloseTo(0, 9);
    expect(distToShape({ x: 247, y: 200 }, s)).toBeCloseTo(3, 9);
    expect(distToShape({ x: 253, y: 200 }, s)).toBeCloseTo(3, 9);
    expect(distToShape(C, s)).toBeCloseTo(50, 9);
    expect(distToShape({ x: 210, y: 205 }, s)).toBeGreaterThan(30);
  });
  it('arco: sulla linea dentro l\'angolo; fuori dall\'angolo la distanza e\' quella dall\'estremo, non dalla circonferenza', () => {
    const a = arcThroughPoints(at(C, 50, 0), at(C, 50, 45), at(C, 50, 90)) as SheetArc;
    const s = shapeOfArc(a);
    expect(distToShape(at(C, 50, 30), s)).toBeCloseTo(0, 9);
    expect(distToShape(at(C, 53, 60), s)).toBeCloseTo(3, 9);
    expect(distToShape(at(C, 50, 200), s)).toBeGreaterThan(50); // il lato opposto del cerchio
    const far = at(C, 50, 135);
    expect(distToShape(far, s)).toBeCloseTo(Math.hypot(far.x - C.x, far.y - (C.y + 50)), 9);
  });
  it('forme senza arcs (come prima) e con arcs vuoto: invariate', () => {
    const lineShape: Shape = { lines: [[{ x: 0, y: 0 }, { x: 10, y: 0 }]], rects: [], circles: [] };
    expect(distToShape({ x: 5, y: 3 }, lineShape)).toBe(3);
    expect(distToShape({ x: 5, y: 3 }, { ...lineShape, arcs: [] })).toBe(3);
  });
});

describe('pickTop: la scelta con un tocco', () => {
  const g = new PageGeometry({ view: [0, 0, 400, 500], rotate: 0, userUnit: 1 });
  type Item = { id: string; shape: Shape };
  const circleItem: Item = { id: 'cerchio', shape: shapeOfArc(ring({ x: 200, y: 250 }, 80)) };
  const coverCircle: Item = { id: 'copertura', shape: coverShapeOf(coverOnSheet({ shape: 'circle', p1: g.sheetToUser({ x: 200, y: 250 }), p2: g.sheetToUser({ x: 280, y: 250 }) }, g)) };
  const segInside: Item = { id: 'retta', shape: { lines: [[{ x: 150, y: 250 }, { x: 250, y: 250 }]], rects: [], circles: [] } };
  const pick = (items: Item[], x: number, y: number, tol = 10): string | null => pickTop(items, (i) => i.shape, { x, y }, tol)?.id ?? null;

  it('un tocco sulla linea del cerchio sceglie il cerchio; dentro, lontano dalla linea, NON lo sceglie', () => {
    expect(pick([circleItem], 280, 250)).toBe('cerchio');
    expect(pick([circleItem], 276, 255)).toBe('cerchio');
    expect(pick([circleItem], 200, 250)).toBeNull(); // il centro
    expect(pick([circleItem], 230, 250)).toBeNull(); // dentro
    expect(pick([circleItem], 400, 400)).toBeNull();
  });
  it('un cerchio sopra una retta NON la nasconde: il tocco sulla retta dentro il cerchio sceglie la retta', () => {
    expect(pick([segInside, circleItem], 200, 250)).toBe('retta');
    expect(pick([segInside, circleItem], 275, 250)).toBe('cerchio'); // sulla linea del cerchio: il cerchio e' in primo piano
  });
  it('un cerchio sopra una copertura circolare: dentro si sceglie la copertura (disco), sulla linea il cerchio (primo piano)', () => {
    expect(pick([coverCircle, circleItem], 220, 250)).toBe('copertura');
    expect(pick([coverCircle, circleItem], 280, 250)).toBe('cerchio');
  });
});
