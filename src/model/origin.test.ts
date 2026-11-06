import { describe, expect, it } from 'vitest';
import { DocumentModel, SetOrigin, type PageObject } from './model';
import { History } from './history';

const seg = (id: number): PageObject => ({ id, kind: 'segment', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } });

describe('origine di pagina (CP6d, decisione 58): dato di pagina come la scala, non un oggetto', () => {
  it('senza origine: null per ogni pagina, nessun conteggio, nessun contenuto', () => {
    const m = new DocumentModel();
    expect(m.origin(1)).toBeNull();
    expect(m.originCount()).toBe(0);
    expect(m.hasContent).toBe(false);
  });

  it('imposta, sposta e toglie: ogni cambio e\' un comando con un solo passo di Annulla e di Ripeti', () => {
    const m = new DocumentModel();
    const h = new History(m);
    h.exec(new SetOrigin(1, m.origin(1), { x: 10, y: 20 }));
    expect(m.origin(1)).toEqual({ x: 10, y: 20 });
    expect(h.nextUndo).toBe('Imposta origine');
    h.exec(new SetOrigin(1, m.origin(1), { x: 30, y: 40 }));
    expect(m.origin(1)).toEqual({ x: 30, y: 40 });
    expect(h.nextUndo).toBe('Sposta origine');
    h.exec(new SetOrigin(1, m.origin(1), null));
    expect(m.origin(1)).toBeNull();
    expect(h.nextUndo).toBe('Rimuovi origine');
    // Annulla: un passo per volta, in ordine inverso
    h.undo();
    expect(m.origin(1)).toEqual({ x: 30, y: 40 });
    h.undo();
    expect(m.origin(1)).toEqual({ x: 10, y: 20 });
    h.undo();
    expect(m.origin(1)).toBeNull();
    expect(h.canUndo).toBe(false);
    // Ripeti
    h.redo();
    expect(m.origin(1)).toEqual({ x: 10, y: 20 });
    h.redo();
    h.redo();
    expect(m.origin(1)).toBeNull();
    expect(h.canRedo).toBe(false);
  });

  it('una per pagina: ogni pagina ha la sua, indipendente dalle altre', () => {
    const m = new DocumentModel();
    m.setOrigin(1, { x: 1, y: 2 });
    m.setOrigin(3, { x: -5, y: 7 });
    expect(m.origin(1)).toEqual({ x: 1, y: 2 });
    expect(m.origin(2)).toBeNull();
    expect(m.origin(3)).toEqual({ x: -5, y: 7 });
    expect(m.originCount()).toBe(2);
    m.setOrigin(1, null);
    expect(m.originCount()).toBe(1);
    expect(m.origin(3)).toEqual({ x: -5, y: 7 });
  });

  it('il comando agisce sulla sua pagina e la dichiara (l\'app la mostra dopo Annulla/Ripeti)', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const c = new SetOrigin(4, null, { x: 1, y: 1 });
    expect(c.page).toBe(4);
    h.exec(c);
    expect(m.origin(4)).toEqual({ x: 1, y: 1 });
    expect(m.origin(1)).toBeNull();
  });

  it('la sola origine e\' contenuto: chiudere il documento chiede conferma, come per la sola scala', () => {
    const m = new DocumentModel();
    m.setOrigin(2, { x: 0, y: 0 }); // anche l'origine nel punto 0,0 e' un'origine
    expect(m.hasContent).toBe(true);
    expect(m.objectCount()).toBe(0);
    expect(m.scaleCount()).toBe(0);
    m.setOrigin(2, null);
    expect(m.hasContent).toBe(false);
    m.setScale(1, { mmPerPt: 1 });
    expect(m.hasContent).toBe(true);
  });

  it('la versione del modello sale a ogni cambio, anche Annulla e Ripeti (modifiche non salvate)', () => {
    const m = new DocumentModel();
    const h = new History(m);
    const v0 = m.version;
    h.exec(new SetOrigin(1, null, { x: 1, y: 1 }));
    expect(m.version).toBe(v0 + 1);
    h.undo();
    expect(m.version).toBe(v0 + 2);
    h.redo();
    expect(m.version).toBe(v0 + 3);
  });

  it('restore non scarta una pagina che ha solo l\'origine, e ripristina origine, scala e oggetti', () => {
    const m = new DocumentModel();
    m.restore([
      { page: 1, scale: null, origin: { x: 9, y: 8 }, objects: [] },
      { page: 2, scale: null, origin: null, objects: [] }, // vuota: si scarta
      { page: 3, scale: { mmPerPt: 2 }, origin: { x: -1, y: -2 }, objects: [seg(7)] },
      { page: 4, scale: null, objects: [seg(9)] }, // origin non indicata = null
    ]);
    expect(m.origin(1)).toEqual({ x: 9, y: 8 });
    expect(m.origin(2)).toBeNull();
    expect(m.origin(3)).toEqual({ x: -1, y: -2 });
    expect(m.origin(4)).toBeNull();
    expect(m.originCount()).toBe(2);
    expect(m.hasContent).toBe(true);
    expect(m.scale(3)).toEqual({ mmPerPt: 2 });
    expect(m.newId()).toBe(10);
    m.restore([]);
    expect(m.originCount()).toBe(0);
    expect(m.hasContent).toBe(false);
  });

  it('il modello tiene copie: cambiare il punto passato o letto non cambia l\'origine', () => {
    const m = new DocumentModel();
    const p = { x: 1, y: 2 };
    m.setOrigin(1, p);
    p.x = 99;
    expect(m.origin(1)).toEqual({ x: 1, y: 2 });
    const o = m.origin(1);
    if (o) o.y = 77;
    expect(m.origin(1)).toEqual({ x: 1, y: 2 });
    const r = [{ page: 1, scale: null, origin: { x: 5, y: 6 }, objects: [] }];
    m.restore(r);
    r[0]!.origin.x = 123;
    expect(m.origin(1)).toEqual({ x: 5, y: 6 });
  });

  it('l\'origine non e\' un oggetto: non entra nell\'elenco degli oggetti, nel conteggio e nell\'ordine di disegno', () => {
    const m = new DocumentModel();
    m.setOrigin(1, { x: 1, y: 1 });
    m.insert(1, seg(1));
    expect(m.objects(1)).toHaveLength(1);
    expect(m.objectCount()).toBe(1);
    expect(m.get(1, 2)).toBeUndefined();
  });

  it('clear toglie anche le origini', () => {
    const m = new DocumentModel();
    m.setOrigin(1, { x: 1, y: 1 });
    m.clear();
    expect(m.originCount()).toBe(0);
    expect(m.origin(1)).toBeNull();
  });
});
