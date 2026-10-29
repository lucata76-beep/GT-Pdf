import { describe, expect, it } from 'vitest';
import { DocumentModel, type PageObject } from '../model/model';
import type { PageInfo } from '../pdf/loader';
import { SavedMark } from './saved';
import { parseProject, serializeProject, verifyProjectText } from './format';
import { applyProject, snapshotProject, summarize } from './session';

const pages: PageInfo[] = [
  { index: 1, rotate: 0, view: [0, 0, 595.276, 841.89], userUnit: 1, widthPt: 595.276, heightPt: 841.89 },
  { index: 2, rotate: 90, view: [20, 30, 260, 360], userUnit: 2.5, widthPt: 825, heightPt: 600 },
  { index: 3, rotate: 0, view: [0, 0, 300, 300], userUnit: 1, widthPt: 300, heightPt: 300 },
];
const pdf = { name: 'x.pdf', size: 10, sha256: null };
const seg = (id: number, x: number): PageObject => ({ id, kind: 'segment', points: [{ x, y: 1 }, { x: x + 10, y: 5 }], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } });

describe('modello <-> progetto', () => {
  it('salva e riapplica: stessi oggetti nello stesso ordine, stesse scale; il prossimo id e\' maggiore del massimo letto', () => {
    const m = new DocumentModel();
    m.insert(1, seg(5, 0));
    m.insert(1, { id: 2, kind: 'cover', shape: 'rect', p1: { x: 0, y: 0 }, p2: { x: 9, y: 9 } });
    m.insert(2, seg(41, 3));
    m.setScale(1, { mmPerPt: 0.123456789 });
    m.setScale(3, { mmPerPt: 2 });
    const proj = snapshotProject(m, pages, 'abc1234', pdf);
    const text = serializeProject(proj);
    expect(verifyProjectText(text, { pages: 3, objects: 3, scales: 2 })).toBeNull();
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(summarize(r.project)).toEqual({ pages: 3, pagesWithObjects: 2, objects: 3, scales: 2 });
    const n = new DocumentModel();
    applyProject(n, r.project);
    expect(n.objects(1)).toEqual(m.objects(1));
    expect(n.objects(1).map((o) => o.id)).toEqual([5, 2]); // l'ordine del modello (= di creazione) si conserva
    expect(n.objects(2)).toEqual(m.objects(2));
    expect(n.objects(3)).toEqual([]);
    expect(n.scale(1)).toEqual({ mmPerPt: 0.123456789 });
    expect(n.scale(2)).toBeNull();
    expect(n.scale(3)).toEqual({ mmPerPt: 2 });
    expect(n.newId()).toBe(42); // maggiore del massimo letto (41)
    expect(n.newId()).toBe(43);
  });

  it('il prossimo id non scende mai sotto quello gia\' in uso nella sessione', () => {
    const n = new DocumentModel();
    for (let i = 0; i < 99; i++) n.newId(); // 99 id gia' dati
    applyProject(n, { app: 'x', pdf, pages: [{ number: 1, view: [0, 0, 1, 1], rotate: 0, userUnit: 1, scale: null, objects: [seg(3, 0)] }] });
    expect(n.newId()).toBe(100);
  });

  it('una voce per OGNI pagina, anche senza oggetti, con la geometria del PDF', () => {
    const proj = snapshotProject(new DocumentModel(), pages, 'a', pdf);
    expect(proj.pages.map((p) => [p.number, p.rotate, p.userUnit, p.scale, p.objects.length])).toEqual([[1, 0, 1, null, 0], [2, 90, 2.5, null, 0], [3, 0, 1, null, 0]]);
    expect(proj.pages[1]!.view).toEqual([20, 30, 260, 360]);
  });

  it('applicare un progetto sostituisce tutto (un solo cambiamento) e non condivide gli oggetti con il modello di partenza', () => {
    const m = new DocumentModel();
    m.insert(1, seg(1, 0));
    const before = m.version;
    applyProject(m, { app: 'x', pdf, pages: [{ number: 2, view: [0, 0, 1, 1], rotate: 0, userUnit: 1, scale: { mmPerPt: 1 }, objects: [] }] });
    expect(m.version).toBe(before + 1);
    expect(m.objectCount()).toBe(0);
    expect(m.scale(2)).toEqual({ mmPerPt: 1 });
  });
});

describe('DocumentModel.version e SavedMark (modifiche non salvate)', () => {
  it('la versione sale a ogni modifica, anche annulla/ripeti (insert/take/scala/proprieta\'/punti)', () => {
    const m = new DocumentModel();
    let v = m.version;
    const bump = (what: string, fn: () => void): void => {
      fn();
      expect(m.version, what).toBeGreaterThan(v);
      v = m.version;
    };
    bump('insert', () => m.insert(1, seg(1, 0)));
    bump('setScale', () => m.setScale(1, { mmPerPt: 1 }));
    bump('setProps', () => m.setProps(1, 1, { color: '#000000' }));
    bump('setPoints', () => m.setPoints(1, 1, [{ x: 0, y: 0 }, { x: 1, y: 1 }]));
    bump('take', () => m.take(1, 1));
    bump('clear', () => m.clear());
  });

  it('SavedMark: pulito all\'apertura, sporco dopo una modifica, pulito dopo il salvataggio della versione generata', () => {
    const m = new DocumentModel();
    const s = new SavedMark(() => m.version);
    expect(s.dirty).toBe(false);
    m.insert(1, seg(1, 0));
    expect(s.dirty).toBe(true);
    const generated = m.version; // il file si genera qui
    s.markSaved(generated);
    expect(s.dirty).toBe(false);
    m.setScale(1, { mmPerPt: 2 });
    expect(s.dirty).toBe(true);
    s.reset(); // apertura di un nuovo PDF o progetto
    expect(s.dirty).toBe(false);
  });

  it('SavedMark: se il modello cambia tra la generazione e la consegna, resta "non salvato"', () => {
    const m = new DocumentModel();
    const s = new SavedMark(() => m.version);
    m.insert(1, seg(1, 0));
    const generated = m.version;
    m.insert(1, seg(2, 5)); // modifica dopo la generazione (non possibile col dialogo modale, ma la regola vale)
    s.markSaved(generated);
    expect(s.dirty).toBe(true);
  });
});
