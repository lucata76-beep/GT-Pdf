import { describe, expect, it } from 'vitest';
import { History, type Command } from './history';
import { AddObject, DocumentModel, RemoveObject, SetScale, SetStroke, type LineObject } from './model';
import { calibrate } from '../geometry/scale';
import { DEFAULT_STROKE } from './stroke';

// ---- History con un modello minimo ----
class Counter {
  n = 0;
}
const add = (k: number, page = 1): Command<Counter> => ({
  label: `+${k}`,
  page,
  apply: (m) => void (m.n += k),
  revert: (m) => void (m.n -= k),
});

describe('History (pattern command)', () => {
  it('esegue, annulla e ripete', () => {
    const m = new Counter();
    const h = new History(m);
    h.exec(add(1));
    h.exec(add(10));
    expect(m.n).toBe(11);
    expect(h.undo()?.label).toBe('+10');
    expect(m.n).toBe(1);
    expect(h.redo()?.label).toBe('+10');
    expect(m.n).toBe(11);
  });

  it('ripeti si azzera dopo una nuova azione', () => {
    const m = new Counter();
    const h = new History(m);
    h.exec(add(1));
    h.exec(add(10));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.exec(add(100)); // nuova azione
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(m.n).toBe(101);
    h.undo();
    h.undo();
    expect(m.n).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it('annullare piu volte e ripetere nello stesso ordine', () => {
    const m = new Counter();
    const h = new History(m);
    [1, 2, 3].forEach((k) => h.exec(add(k)));
    h.undo();
    h.undo();
    expect(m.n).toBe(1);
    expect(h.nextRedo).toBe('+2');
    h.redo();
    expect(m.n).toBe(3);
    h.redo();
    expect(m.n).toBe(6);
    expect(h.canRedo).toBe(false);
  });

  it('clear azzera entrambe le pile', () => {
    const h = new History(new Counter());
    h.exec(add(1));
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('notifica i cambiamenti', () => {
    const h = new History(new Counter());
    let calls = 0;
    const off = h.onChange(() => calls++);
    h.exec(add(1));
    h.undo();
    h.redo();
    expect(calls).toBe(3);
    off();
    h.undo();
    expect(calls).toBe(3);
  });

  it('un comando dice la pagina interessata', () => {
    const h = new History(new Counter());
    h.exec(add(1, 3));
    expect(h.undo()?.page).toBe(3);
  });
});

// ---- Con il modello del documento ----
const seg = (id: number, x1 = 100): LineObject => ({ id, kind: 'segment', points: [{ x: 0, y: 0 }, { x: x1, y: 0 }], stroke: { ...DEFAULT_STROKE } });

describe('DocumentModel con i comandi', () => {
  it('aggiungi, annulla, ripeti: l\'oggetto e la sua posizione tornano', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, seg(1)));
    h.exec(new AddObject(1, seg(2)));
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2]);
    h.undo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1]);
    h.redo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2]);
    expect(m.last(1)?.id).toBe(2);
  });

  it('cancella: l\'annullamento rimette l\'oggetto allo stesso posto', () => {
    const m = new DocumentModel();
    const h = new History(m);
    for (const id of [1, 2, 3]) h.exec(new AddObject(1, seg(id)));
    const mid = m.get(1, 2);
    if (!mid) throw new Error('oggetto mancante');
    h.exec(new RemoveObject(1, mid));
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 3]);
    h.undo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2, 3]);
    h.redo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 3]);
  });

  it('proprieta\' dell\'ultima linea: annulla e ripeti', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, seg(1)));
    const before = { ...DEFAULT_STROKE };
    const after = { style: 'dashed' as const, color: '#1565C0', widthPt: 2 };
    h.exec(new SetStroke(1, 1, before, after));
    expect(m.get(1, 1)?.stroke).toEqual(after);
    h.undo();
    expect(m.get(1, 1)?.stroke).toEqual(before);
    h.redo();
    expect(m.get(1, 1)?.stroke).toEqual(after);
  });

  it('la calibrazione e\' annullabile e per pagina', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const s1 = calibrate(283.46, 100);
    const s2 = calibrate(283.46, 200);
    if (!s1 || !s2) throw new Error('scala non calcolata');
    h.exec(new SetScale(1, null, s1));
    h.exec(new SetScale(1, s1, s2));
    h.exec(new SetScale(2, null, s1));
    expect(m.scale(1)).toEqual(s2);
    expect(m.scale(2)).toEqual(s1);
    h.undo();
    expect(m.scale(2)).toBeNull();
    expect(m.scale(1)).toEqual(s2);
    h.undo();
    expect(m.scale(1)).toEqual(s1);
    h.undo();
    expect(m.scale(1)).toBeNull();
  });

  it('hasContent: oggetti o scale; torna falso dopo aver annullato tutto', () => {
    const m = new DocumentModel();
    const h = new History(m);
    expect(m.hasContent).toBe(false);
    h.exec(new AddObject(1, seg(1)));
    expect(m.hasContent).toBe(true);
    h.undo();
    expect(m.hasContent).toBe(false);
    const s = calibrate(100, 100);
    if (!s) throw new Error('scala non calcolata');
    h.exec(new SetScale(1, null, s));
    expect(m.hasContent).toBe(true);
    expect(m.scaleCount()).toBe(1);
  });

  it('le pagine sono indipendenti e clear svuota tutto', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, seg(1)));
    h.exec(new AddObject(2, seg(2)));
    expect(m.objects(1)).toHaveLength(1);
    expect(m.objects(2)).toHaveLength(1);
    expect(m.objects(3)).toHaveLength(0);
    expect(m.objectCount()).toBe(2);
    m.clear();
    expect(m.objectCount()).toBe(0);
  });
});
