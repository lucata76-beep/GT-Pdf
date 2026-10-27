import { describe, expect, it } from 'vitest';
import { type CoverKind, coverInfo } from '../geometry/cover';
import { dimensionLabel } from '../geometry/dimension';
import { pickTop } from '../geometry/hit';
import type { Shape } from '../geometry/layout';
import { PageGeometry } from '../geometry/page';
import { calibrate } from '../geometry/scale';
import { History } from './history';
import {
  AddObject,
  type CoverObject,
  type DimensionObject,
  DocumentModel,
  type LineObject,
  MoveObject,
  type PageObject,
  RemoveObject,
  SetProps,
  type TextObject,
  drawOrder,
  objectLabel,
  objectNoun,
  patchedProps,
  pointsOf,
  propsOf,
} from './model';
import { DEFAULT_STROKE } from './stroke';

const line = (id: number, kind: 'segment' | 'polyline' = 'segment'): LineObject => ({
  id,
  kind,
  points: kind === 'segment' ? [{ x: 0.1, y: 0.2 }, { x: 100.3, y: 50.7 }] : [{ x: 0.1, y: 0.2 }, { x: 50, y: 60 }, { x: 100.3, y: 0.7 }],
  stroke: { ...DEFAULT_STROKE },
});
const text = (id: number): TextObject => ({ id, kind: 'text', at: { x: 10.1, y: 20.3 }, text: 'FORO', textPt: 10, color: '#D32F2F' });
const dim = (id: number, dimType: DimensionObject['dim'] = 'horizontal', valueText: string | null = null): DimensionObject => ({
  id,
  kind: 'dim',
  dim: dimType,
  p1: { x: 100.1, y: 200.2 },
  p2: { x: 300.3, y: 220.7 },
  a: { x: 100.1, y: 150 },
  b: { x: 300.3, y: 150 },
  valueText,
  color: '#D32F2F',
  widthPt: 1,
  textPt: 10,
});
const cover = (id: number, shape: CoverKind = 'rect'): CoverObject => ({ id, kind: 'cover', shape, p1: { x: 30.3, y: 40.4 }, p2: { x: 130.1, y: 90.9 } });

describe('Sposta (MoveObject)', () => {
  const cases: [string, PageObject][] = [
    ['retta', line(1)],
    ['linea', line(1, 'polyline')],
    ['testo', text(1)],
    ['quota orizzontale', dim(1)],
    ['quota Ø', dim(1, 'diameter')],
    ['copertura', cover(1)],
    ['copertura circolare', cover(1, 'circle')],
  ];
  for (const [name, obj] of cases) {
    it(`${name}: traslano tutti i punti, annulla restituisce i valori ESATTI di prima, ripeti quelli di dopo`, () => {
      const m = new DocumentModel();
      const h = new History(m);
      h.exec(new AddObject(1, obj));
      const before = pointsOf(m.get(1, 1) as PageObject);
      h.exec(new MoveObject(1, m.get(1, 1) as PageObject, 0.1, -0.2)); // valori che in binario non tornano a somma zero
      const after = pointsOf(m.get(1, 1) as PageObject);
      expect(after).toHaveLength(before.length);
      before.forEach((p, i) => {
        expect(after[i]?.x).toBeCloseTo(p.x + 0.1, 12);
        expect(after[i]?.y).toBeCloseTo(p.y - 0.2, 12);
      });
      h.undo();
      expect(pointsOf(m.get(1, 1) as PageObject)).toEqual(before); // esatti, nessuna deriva in virgola mobile
      h.redo();
      expect(pointsOf(m.get(1, 1) as PageObject)).toEqual(after);
      h.undo();
      h.undo(); // anche l'aggiunta
      expect(m.objects(1)).toHaveLength(0);
    });
  }

  it('un trascinamento = un solo comando: una sola annullata riporta tutto, con nome e pagina', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(2, dim(1)));
    const cmd = new MoveObject(2, m.get(2, 1) as PageObject, 5, 6);
    h.exec(cmd);
    expect(h.nextUndo).toBe('Sposta quota');
    expect(cmd.page).toBe(2);
    h.undo();
    expect(h.nextUndo).toBe('Quota orizzontale');
  });

  it('la quota spostata mantiene tipo, valore (automatico o digitato) e misura: il valore automatico non cambia', () => {
    const g = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
    const scale = calibrate(283.465, 100);
    if (!scale) throw new Error('scala');
    for (const rot of [0, 90]) {
      const geom = rot === 0 ? g : new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 90, userUnit: 1 });
      const m = new DocumentModel();
      const h = new History(m);
      const auto = dim(1, 'horizontal', null);
      const typed = dim(2, 'aligned', '25 H7');
      h.exec(new AddObject(1, auto));
      h.exec(new AddObject(1, typed));
      const labelBefore = dimensionLabel(auto, geom, scale);
      const pts0 = pointsOf(auto);
      h.exec(new MoveObject(1, auto, 123.456, -78.9));
      h.exec(new MoveObject(1, typed, 123.456, -78.9));
      const moved = m.get(1, 1) as DimensionObject;
      expect(moved.valueText).toBeNull();
      expect(moved.dim).toBe('horizontal');
      expect(dimensionLabel(moved, geom, scale)).toBe(labelBefore);
      expect(dimensionLabel(m.get(1, 2) as DimensionObject, geom, scale)).toBe('25 H7');
      // tutti e quattro i punti (p1, p2, a, b) hanno la stessa traslazione
      const pts1 = pointsOf(moved);
      expect(pts1).toHaveLength(4);
      pts0.forEach((p, i) => {
        expect(pts1[i]?.x).toBeCloseTo(p.x + 123.456, 12);
        expect(pts1[i]?.y).toBeCloseTo(p.y - 78.9, 12);
      });
    }
  });

  it('spostare un oggetto di un\'altra pagina o gia\' cancellato non fa nulla di dannoso', () => {
    const m = new DocumentModel();
    const t = text(1);
    m.insert(1, t);
    const cmd = new MoveObject(1, t, 5, 5);
    m.take(1, 1);
    expect(() => cmd.apply(m)).not.toThrow();
    expect(m.objects(1)).toHaveLength(0);
  });
});

describe('Coperture nel modello', () => {
  it('nome per i messaggi e nessuna proprieta\' modificabile', () => {
    expect(objectLabel(cover(1))).toBe('Copertura rettangolare');
    expect(objectLabel(cover(1, 'square'))).toBe(coverInfo('square').label);
    expect(objectNoun(cover(1))).toBe('copertura');
    expect(propsOf(cover(1))).toEqual({});
    expect(patchedProps(cover(1), { color: '#000000', widthPt: 3, textPt: 8, style: 'dashed' })).toEqual({});
  });

  it('SetProps su una copertura non la cambia (e annulla/ripeti restano coerenti)', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, cover(1)));
    h.exec(new SetProps(1, 1, {}, { color: '#000000' }));
    expect(m.get(1, 1)).toEqual(cover(1));
    h.undo();
    h.redo();
    expect(m.get(1, 1)).toEqual(cover(1));
  });

  it('cancellare e annullare rimette la copertura nella sua posizione di creazione', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new AddObject(1, line(1)));
    h.exec(new AddObject(1, cover(2)));
    h.exec(new AddObject(1, text(3)));
    h.exec(new RemoveObject(1, m.get(1, 2) as PageObject));
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 3]);
    h.undo();
    expect(m.objects(1).map((o) => o.id)).toEqual([1, 2, 3]);
    expect(h.nextUndo).toBe('Testo');
  });

  it('i punti coprono tutti i tipi: retta 2, linea n, testo 1, quota 4, copertura 2', () => {
    expect(pointsOf(line(1))).toHaveLength(2);
    expect(pointsOf(line(1, 'polyline'))).toHaveLength(3);
    expect(pointsOf(text(1))).toHaveLength(1);
    expect(pointsOf(dim(1))).toHaveLength(4);
    expect(pointsOf(cover(1))).toHaveLength(2);
  });
});

describe('patchedProps: solo le proprieta\' che l\'oggetto ha', () => {
  it('linea: tipo, colore, spessore; il corpo del testo si ignora', () => {
    expect(patchedProps(line(1), { style: 'dashed', color: '#1565C0', widthPt: 2, textPt: 14 })).toEqual({ style: 'dashed', color: '#1565C0', widthPt: 2 });
  });
  it('testo: colore e corpo; spessore e tipo si ignorano', () => {
    expect(patchedProps(text(1), { style: 'dashed', color: '#1565C0', widthPt: 2, textPt: 14 })).toEqual({ color: '#1565C0', textPt: 14 });
  });
  it('quota: colore, spessore e corpo', () => {
    expect(patchedProps(dim(1), { style: 'dashed', color: '#1565C0', widthPt: 2, textPt: 14 })).toEqual({ color: '#1565C0', widthPt: 2, textPt: 14 });
  });
  it('una patch vuota lascia tutto com\'e\'', () => {
    expect(patchedProps(dim(1), {})).toEqual(propsOf(dim(1)));
  });
});

describe('Ordine di disegno e primo piano', () => {
  it('le coperture stanno sempre sotto linee, testi e quote, qualunque sia l\'ordine di creazione', () => {
    const objs: PageObject[] = [cover(1), line(2), text(3), cover(4, 'circle'), dim(5), cover(6, 'square'), line(7)];
    expect(drawOrder(objs).map((o) => o.id)).toEqual([1, 4, 6, 2, 3, 5, 7]);
    expect(drawOrder(objs).slice(0, 3).every((o) => o.kind === 'cover')).toBe(true);
    expect(drawOrder(objs.slice().reverse()).slice(0, 3).map((o) => o.id)).toEqual([6, 4, 1]); // tra coperture vale l'ordine di creazione
  });
  it('non modifica la lista originale ne\' l\'ordine nel modello', () => {
    const m = new DocumentModel();
    m.insert(1, line(1));
    m.insert(1, cover(2));
    const before = m.objects(1).map((o) => o.id);
    drawOrder(m.objects(1));
    expect(m.objects(1).map((o) => o.id)).toEqual(before);
    expect(before).toEqual([1, 2]);
  });
  it('con una copertura e una linea sopra: un tocco entro la tolleranza della linea sceglie la linea, altrove la copertura', () => {
    const rect: Shape = { lines: [], rects: [{ x: 0, y: 0, w: 200, h: 100 }], circles: [] };
    const ln: Shape = { lines: [[{ x: 20, y: 50 }, { x: 180, y: 50 }]], rects: [], circles: [] };
    const items: PageObject[] = drawOrder([line(1), cover(2)]);
    const shapeOf = (o: PageObject): Shape => (o.kind === 'cover' ? rect : ln);
    expect(pickTop(items, shapeOf, { x: 100, y: 55 }, 10)?.id).toBe(1); // a 5 pt dalla linea: la linea
    expect(pickTop(items, shapeOf, { x: 100, y: 80 }, 10)?.id).toBe(2); // a 30 pt: solo la copertura
    expect(pickTop(items, shapeOf, { x: 300, y: 300 }, 10)).toBeNull();
  });
  it('la copertura ha la precedenza solo se non c\'e\' nient\'altro a portata, anche se disegnata per ultima', () => {
    const items = drawOrder([line(1), cover(2)]); // la copertura e' l'ultima creata, ma sta sotto
    expect(items.map((o) => o.id)).toEqual([2, 1]);
  });
});
