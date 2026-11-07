// Comandi su piu' oggetti (CP6e): trasformazione, aggiunta di copie e cancellazione. Un comando = UN passo di Annulla e di Ripeti e UN solo cambiamento del modello.
import { describe, expect, it } from 'vitest';
import type { UserPoint } from '../geometry/page';
import { History } from './history';
import {
  AddObject,
  AddObjects,
  DocumentModel,
  type LineObject,
  type PageObject,
  RemoveObjects,
  type TextObject,
  TransformObjects,
  cloneObject,
  countLabel,
  pointsOf,
} from './model';
import { DEFAULT_STROKE } from './stroke';

const seg = (id: number, x = 0): LineObject => ({ id, kind: 'segment', points: [{ x: x + 0.1, y: 0.2 }, { x: x + 100.3, y: 50.7 }], stroke: { ...DEFAULT_STROKE } });
const text = (id: number): TextObject => ({ id, kind: 'text', at: { x: 10.1, y: 20.3 }, text: 'FORO', textPt: 10, color: '#D32F2F' });
const fill = (m: DocumentModel, h: History<DocumentModel>, n: number): PageObject[] => {
  const out: PageObject[] = [];
  for (let i = 1; i <= n; i++) {
    const o = i % 3 === 0 ? text(m.newId()) : seg(m.newId(), i);
    out.push(o);
    h.exec(new AddObject(1, o));
  }
  return out;
};
const ids = (m: DocumentModel): number[] => m.objects(1).map((o) => o.id);
const counter = (m: DocumentModel): { n: number } => {
  const c = { n: 0 };
  m.onChange(() => c.n++);
  return c;
};

describe('TransformObjects', () => {
  it('un solo cambiamento (un emit, una salita di version) e un solo passo di Annulla, qualunque sia N', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 12);
    const c = counter(m);
    const v0 = m.version;
    const changes = objs.map((o) => ({ id: o.id, before: pointsOf(o), after: pointsOf(o).map((p) => ({ x: p.x + 7.7, y: p.y - 3.3 })) }));
    h.exec(new TransformObjects(1, 'Sposta 12 oggetti', changes));
    expect(c.n).toBe(1);
    expect(m.version).toBe(v0 + 1);
    expect(h.nextUndo).toBe('Sposta 12 oggetti');
    h.undo();
    expect(c.n).toBe(2);
    expect(m.version).toBe(v0 + 2);
    h.redo();
    expect(c.n).toBe(3);
  });
  it('Annulla restituisce valori ESATTI; Ripeti riapplica gli stessi valori', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 6);
    const before = objs.map((o) => pointsOf(o));
    const after = before.map((pts) => pts.map((p) => ({ x: p.x * 1.0000001 + 0.1, y: p.y / 3 })));
    h.exec(new TransformObjects(1, 'x', objs.map((o, i) => ({ id: o.id, before: before[i] as UserPoint[], after: after[i] as UserPoint[] }))));
    objs.forEach((o, i) => expect(pointsOf(m.get(1, o.id) as PageObject)).toEqual(after[i]));
    h.undo();
    objs.forEach((o, i) => expect(pointsOf(m.get(1, o.id) as PageObject)).toEqual(before[i]));
    h.redo();
    objs.forEach((o, i) => expect(pointsOf(m.get(1, o.id) as PageObject)).toEqual(after[i]));
  });
  it('gli oggetti non toccati restano come sono e l\'ordine non cambia', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 5);
    const order = ids(m);
    const untouched = JSON.stringify(m.get(1, (objs[1] as PageObject).id));
    h.exec(new TransformObjects(1, 'x', [objs[0], objs[3]].map((o) => ({ id: (o as PageObject).id, before: pointsOf(o as PageObject), after: pointsOf(o as PageObject).map((p) => ({ x: p.x + 1, y: p.y + 1 })) }))));
    expect(ids(m)).toEqual(order);
    expect(JSON.stringify(m.get(1, (objs[1] as PageObject).id))).toBe(untouched);
  });
});

describe('AddObjects (copie)', () => {
  it('Ripeti reinserisce gli STESSI oggetti con gli stessi id; vanno in fondo nell\'ordine dato; un solo cambiamento', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 4);
    const copies = [objs[2], objs[0]].map((o) => cloneObject(o as PageObject, m.newId()));
    const copyIds = copies.map((o) => o.id);
    expect(new Set([...ids(m), ...copyIds]).size).toBe(6); // id nuovi
    const c = counter(m);
    h.exec(new AddObjects(1, 'Duplica', copies));
    expect(c.n).toBe(1);
    expect(ids(m).slice(-2)).toEqual(copyIds);
    h.undo();
    expect(ids(m)).toEqual(objs.map((o) => o.id));
    h.redo();
    expect(ids(m).slice(-2)).toEqual(copyIds);
    expect(m.get(1, copyIds[0] as number)).toBe(copies[0]); // lo stesso oggetto
    expect(m.newId()).toBeGreaterThan(Math.max(...copyIds)); // gli id non si riusano
  });
  it('una copia ha le stesse proprieta\' dell\'originale ma e\' un oggetto distinto (non condivide punti ne\' tratto)', () => {
    const o: LineObject = { id: 1, kind: 'polyline', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], stroke: { style: 'dashed', color: '#112233', widthPt: 2.5 } };
    const c = cloneObject(o, 9) as LineObject;
    expect(c.id).toBe(9);
    expect(c.stroke).toEqual(o.stroke);
    expect(c.stroke).not.toBe(o.stroke);
    expect(c.points).not.toBe(o.points);
    expect(c.points).toEqual(o.points);
    const moved = cloneObject(o, 10, [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }]) as LineObject;
    expect(moved.points[2]).toEqual({ x: 50, y: 60 });
    expect(o.points[2]).toEqual({ x: 5, y: 6 }); // l'originale non cambia
    const q = cloneObject({ id: 4, kind: 'dim', dim: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, a: { x: 0, y: 1 }, b: { x: 1, y: 2 }, valueText: '12.5', color: '#000000', widthPt: 1, textPt: 9 }, 11, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 3 }]);
    expect(q.kind === 'dim' && q.valueText).toBe('12.5');
  });
});

describe('RemoveObjects', () => {
  it('Annulla rimette ognuno al suo indice, nell\'ordine di prima, con un solo passo e un solo cambiamento', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 10);
    const order = ids(m);
    const pick = [objs[1], objs[4], objs[5], objs[9], objs[0]] as PageObject[];
    const c = counter(m);
    h.exec(new RemoveObjects(1, pick));
    expect(c.n).toBe(1);
    expect(ids(m)).toEqual(order.filter((id) => !pick.some((p) => p.id === id)));
    expect(h.nextUndo).toBe('Cancella 5 oggetti');
    h.undo();
    expect(c.n).toBe(2);
    expect(ids(m)).toEqual(order);
    h.redo();
    expect(ids(m)).toEqual(order.filter((id) => !pick.some((p) => p.id === id)));
    h.undo();
    expect(ids(m)).toEqual(order);
  });
  it('anche con selezioni all\'inizio, in fondo e adiacenti', () => {
    for (const idx of [[0, 1, 2], [7, 8, 9], [0, 9], [3], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      const m = new DocumentModel();
      const h = new History(m);
      const objs = fill(m, h, 10);
      const order = ids(m);
      h.exec(new RemoveObjects(1, idx.map((i) => objs[i] as PageObject)));
      h.undo();
      expect(ids(m), idx.join(',')).toEqual(order);
    }
  });
  it('un solo oggetto: la stessa etichetta di RemoveObject ("Cancella retta")', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 2);
    const cmd = new RemoveObjects(1, [objs[0] as PageObject]);
    expect(cmd.label).toBe('Cancella retta');
    expect(countLabel([objs[0] as PageObject])).toBe('retta');
    expect(countLabel(objs)).toBe('2 oggetti');
  });
  it('cancellare, annullare e cancellare altri non rompe gli indici (cronologia lineare)', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const objs = fill(m, h, 8);
    const order = ids(m);
    h.exec(new RemoveObjects(1, [objs[2], objs[3]] as PageObject[]));
    h.exec(new RemoveObjects(1, [objs[0], objs[7]] as PageObject[]));
    h.undo();
    h.undo();
    expect(ids(m)).toEqual(order);
  });
});

describe('metodi del modello su molti oggetti', () => {
  it('1.000 oggetti: un solo emit per metodo', () => {
    const m = new DocumentModel();
    const objs: PageObject[] = [];
    for (let i = 0; i < 1000; i++) objs.push(seg(m.newId(), i));
    m.insertMany(1, objs);
    const c = counter(m);
    m.setPointsMany(
      1,
      objs.map((o) => ({ id: o.id, pts: pointsOf(o).map((p) => ({ x: p.x + 1, y: p.y })) })),
    );
    expect(c.n).toBe(1);
    const taken = m.takeMany(
      1,
      objs.map((o) => o.id),
    );
    expect(c.n).toBe(2);
    expect(taken).toHaveLength(1000);
    expect(taken.map((t) => t.index)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    m.insertAt(1, taken);
    expect(c.n).toBe(3);
    expect(ids(m)).toEqual(objs.map((o) => o.id));
  });
  it('setPointsMany ignora gli id che non ci sono', () => {
    const m = new DocumentModel();
    m.insertMany(1, [seg(1)]);
    m.setPointsMany(1, [{ id: 99, pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]);
    expect(pointsOf(m.get(1, 1) as PageObject)[0]).toEqual({ x: 0.1, y: 0.2 });
  });
});
