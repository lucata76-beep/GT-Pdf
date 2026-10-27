import { describe, expect, it } from 'vitest';
import { History, type Command } from './history';
import { AddObject, DocumentModel, type DimensionObject, type LineObject, RemoveObject, SetProps, SetScale, type TextObject, objectLabel, propsEqual, propsFor, propsOf } from './model';
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
    const before = propsOf(seg(1));
    const after = { style: 'dashed' as const, color: '#1565C0', widthPt: 2 };
    h.exec(new SetProps(1, 1, before, after));
    expect((m.get(1, 1) as LineObject).stroke).toEqual(after);
    h.undo();
    expect((m.get(1, 1) as LineObject).stroke).toEqual(DEFAULT_STROKE);
    h.redo();
    expect((m.get(1, 1) as LineObject).stroke).toEqual(after);
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

// ---- Testi e quote ----
const txt = (id: number, text = 'FORO Ø8'): TextObject => ({ id, kind: 'text', at: { x: 50, y: 60 }, text, textPt: 10, color: '#D32F2F' });
const dim = (id: number, valueText: string | null = null): DimensionObject => ({
  id,
  kind: 'dim',
  dim: 'horizontal',
  p1: { x: 0, y: 0 },
  p2: { x: 100, y: 0 },
  a: { x: 0, y: 40 },
  b: { x: 100, y: 40 },
  valueText,
  color: '#D32F2F',
  widthPt: 1,
  textPt: 10,
});

describe('testi e quote nell\'annulla/ripeti e nella cancellazione', () => {
  it('aggiungere un testo o una quota: annulla e ripeti, con i nomi per i messaggi', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, txt(1)));
    h.exec(new AddObject(1, dim(2)));
    expect(m.objects(1).map((o) => o.kind)).toEqual(['text', 'dim']);
    expect(h.nextUndo).toBe('Quota orizzontale');
    h.undo();
    expect(h.nextUndo).toBe('Testo');
    expect(h.nextRedo).toBe('Quota orizzontale');
    expect(m.objects(1).map((o) => o.id)).toEqual([1]);
    h.redo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2]);
    h.undo();
    h.undo();
    expect(m.hasContent).toBe(false);
  });

  it('cancella un testo e una quota: l\'annullamento li rimette al loro posto, ripeti li toglie', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, seg(1)));
    h.exec(new AddObject(1, txt(2)));
    h.exec(new AddObject(1, dim(3)));
    h.exec(new AddObject(1, seg(4)));
    const t = m.get(1, 2);
    const d = m.get(1, 3);
    if (!t || !d) throw new Error('oggetto mancante');
    h.exec(new RemoveObject(1, t));
    h.exec(new RemoveObject(1, d));
    expect(h.nextUndo).toBe('Cancella quota');
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 4]);
    h.undo();
    h.undo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2, 3, 4]);
    h.redo();
    h.redo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 4]);
    expect(h.nextUndo).toBe('Cancella quota');
  });

  it('proprieta\': ogni oggetto cambia solo quelle che ha', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, txt(1)));
    h.exec(new AddObject(1, dim(2)));
    // il testo non ha spessore: lo ignora; colore e corpo cambiano
    const t0 = propsOf(txt(1));
    h.exec(new SetProps(1, 1, t0, { color: '#1565C0', textPt: 14, widthPt: 3 }));
    expect(m.get(1, 1)).toMatchObject({ color: '#1565C0', textPt: 14 });
    expect(m.get(1, 1)).not.toHaveProperty('widthPt');
    h.exec(new SetProps(1, 2, propsOf(dim(2)), { color: '#00796B', widthPt: 0.5, textPt: 8 }));
    expect(m.get(1, 2)).toMatchObject({ color: '#00796B', widthPt: 0.5, textPt: 8 });
    h.undo();
    expect(m.get(1, 2)).toMatchObject({ color: '#D32F2F', widthPt: 1, textPt: 10 });
    h.undo();
    expect(m.get(1, 1)).toMatchObject({ color: '#D32F2F', textPt: 10 });
    h.redo();
    expect(m.get(1, 1)).toMatchObject({ color: '#1565C0', textPt: 14 });
  });

  it('proprieta\' di sessione ridotte a quelle dell\'oggetto e confronto', () => {
    const st = { style: 'dashed' as const, color: '#1565C0', widthPt: 2 };
    expect(propsFor('segment', st, 12)).toEqual({ style: 'dashed', color: '#1565C0', widthPt: 2 });
    expect(propsFor('text', st, 12)).toEqual({ color: '#1565C0', textPt: 12 });
    expect(propsFor('dim', st, 12)).toEqual({ color: '#1565C0', widthPt: 2, textPt: 12 });
    expect(propsEqual(propsOf(txt(1)), propsFor('text', { ...DEFAULT_STROKE }, 10))).toBe(true);
    expect(propsEqual(propsOf(txt(1)), propsFor('text', { ...DEFAULT_STROKE }, 11))).toBe(false);
    expect(propsEqual(propsOf(dim(1)), propsFor('dim', { ...DEFAULT_STROKE, widthPt: 2 }, 10))).toBe(false);
  });

  it('nomi: retta, linea, testo e le cinque quote', () => {
    expect(objectLabel(seg(1))).toBe('Retta');
    expect(objectLabel({ ...seg(1), kind: 'polyline' })).toBe('Linea');
    expect(objectLabel(txt(1))).toBe('Testo');
    expect(
      (['aligned', 'horizontal', 'vertical', 'diameter', 'radius'] as const).map((t) => objectLabel({ ...dim(1), dim: t })),
    ).toEqual(['Quota allineata', 'Quota orizzontale', 'Quota verticale', 'Quota diametro Ø', 'Quota raggio R']);
  });

  it('la scala ricalibrata cambia l\'etichetta delle quote automatiche, non di quelle digitate (valueText)', () => {
    // il modello conserva solo `valueText`: null = automatica; il testo mostrato si calcola da scala e geometria (dimension.test.ts)
    expect(dim(1).valueText).toBeNull();
    expect(dim(2, '25 H7').valueText).toBe('25 H7');
  });
});
