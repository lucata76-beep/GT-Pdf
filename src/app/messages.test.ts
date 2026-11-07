import { describe, expect, it } from 'vitest';
import type { PageObject } from '../model/model';
import { addedMessage, copiedMessage, deletedManyMessage, deletedMessage, duplicatedMessage, isMasculine, movedMessage, selectedManyText, selectedText, transformedManyMessage, transformedMessage } from './messages';

const st = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const p = { x: 0, y: 0 };
const dim = (): PageObject => ({ id: 5, kind: 'dim', dim: 'aligned', p1: p, p2: p, a: p, b: p, valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 });
const OBJ: Record<string, PageObject> = {
  retta: { id: 1, kind: 'segment', points: [p, p], stroke: st },
  linea: { id: 2, kind: 'polyline', points: [p, p, p], stroke: st },
  testo: { id: 3, kind: 'text', at: p, text: 'a', textPt: 10, color: '#D32F2F' },
  quota: dim(),
  coperturaRett: { id: 6, kind: 'cover', shape: 'rect', p1: p, p2: p },
  coperturaCirc: { id: 7, kind: 'cover', shape: 'circle', p1: p, p2: p },
  cerchio: { id: 8, kind: 'circle', p1: p, p2: p, stroke: st },
  arco: { id: 9, kind: 'arc', p1: p, p2: p, p3: p, stroke: st },
};

describe('messaggi al maschile (testo, cerchio, arco) e al femminile (retta, linea, quota, coperture)', () => {
  it('genere', () => {
    expect(Object.entries(OBJ).filter(([, o]) => isMasculine(o)).map(([k]) => k)).toEqual(['testo', 'cerchio', 'arco']);
  });
  it('cancellazione: "Arco cancellato. Annulla lo ripristina." e le altre', () => {
    expect(deletedMessage(OBJ.arco!)).toBe('Arco cancellato. Annulla lo ripristina.');
    expect(deletedMessage(OBJ.cerchio!)).toBe('Cerchio cancellato. Annulla lo ripristina.');
    expect(deletedMessage(OBJ.testo!)).toBe('Testo cancellato. Annulla lo ripristina.');
    expect(deletedMessage(OBJ.retta!)).toBe('Retta cancellata. Annulla la ripristina.');
    expect(deletedMessage(OBJ.linea!)).toBe('Linea cancellata. Annulla la ripristina.');
    expect(deletedMessage(OBJ.quota!)).toBe('Quota cancellata. Annulla la ripristina.');
    expect(deletedMessage(OBJ.coperturaRett!)).toBe('Copertura cancellata. Annulla la ripristina.');
    expect(deletedMessage(OBJ.coperturaCirc!)).toBe('Copertura cancellata. Annulla la ripristina.');
  });
  it('spostamento', () => {
    expect(movedMessage(OBJ.arco!)).toBe('Arco spostato. Annulla lo rimette a posto.');
    expect(movedMessage(OBJ.cerchio!)).toBe('Cerchio spostato. Annulla lo rimette a posto.');
    expect(movedMessage(OBJ.testo!)).toBe('Testo spostato. Annulla lo rimette a posto.');
    expect(movedMessage(OBJ.retta!)).toBe('Retta spostata. Annulla la rimette a posto.');
    expect(movedMessage(OBJ.quota!)).toBe('Quota spostata. Annulla la rimette a posto.');
  });
  it('"Selezionato: ..." / "Selezionata: ..."', () => {
    expect(selectedText(OBJ.cerchio!)).toBe('Selezionato: Cerchio');
    expect(selectedText(OBJ.arco!)).toBe('Selezionato: Arco');
    expect(selectedText(OBJ.testo!)).toBe('Selezionato: Testo');
    expect(selectedText(OBJ.retta!)).toBe('Selezionata: Retta');
    expect(selectedText(OBJ.linea!)).toBe('Selezionata: Linea');
    expect(selectedText(OBJ.quota!)).toBe('Selezionata: Quota allineata');
    expect(selectedText(OBJ.coperturaCirc!)).toBe('Selezionata: Copertura circolare');
  });
  it('aggiunta: "Cerchio aggiunto" e "Retta aggiunta"', () => {
    expect(addedMessage(OBJ.cerchio!)).toBe('Cerchio aggiunto. Annulla per toglierlo.');
    expect(addedMessage(OBJ.arco!, 'raggio 25 mm')).toBe('Arco aggiunto: raggio 25 mm. Annulla per toglierlo.');
    expect(addedMessage(OBJ.retta!)).toBe('Retta aggiunta. Annulla per toglierla.');
    expect(addedMessage(OBJ.testo!, '"ciao"')).toBe('Testo aggiunto: "ciao". Annulla per toglierlo.');
  });
});

describe('selezione multipla e trasformazioni (CP6e)', () => {
  it('selezionati', () => {
    expect(selectedManyText(3)).toBe('Selezionati: 3 oggetti');
  });
  it('cancellazione e trasformazioni di N oggetti: forma plurale generica', () => {
    expect(deletedManyMessage(3)).toBe('3 oggetti cancellati. Annulla li ripristina.');
    expect(transformedManyMessage('move', 3)).toBe('3 oggetti spostati. Annulla li rimette a posto.');
    expect(transformedManyMessage('mirror', 2)).toBe('2 oggetti specchiati. Annulla li rimette a posto.');
    expect(transformedManyMessage('rotate', 5)).toBe('5 oggetti ruotati. Annulla li rimette a posto.');
  });
  it('un oggetto: il genere del nome; spostare resta identico a movedMessage', () => {
    expect(transformedMessage('move', OBJ.retta!)).toBe(movedMessage(OBJ.retta!));
    expect(transformedMessage('move', OBJ.arco!)).toBe(movedMessage(OBJ.arco!));
    expect(transformedMessage('mirror', OBJ.retta!)).toBe('Retta specchiata. Annulla la rimette a posto.');
    expect(transformedMessage('rotate', OBJ.cerchio!)).toBe('Cerchio ruotato. Annulla lo rimette a posto.');
    expect(transformedMessage('mirror', OBJ.testo!)).toBe('Testo specchiato. Annulla lo rimette a posto.');
  });
  it('copie e duplicati', () => {
    expect(copiedMessage('move', 1)).toBe("Copia creata e spostata: l'originale resta. Annulla la toglie.");
    expect(copiedMessage('rotate', 3)).toBe('3 copie create e ruotate: gli originali restano. Annulla le toglie.');
    expect(duplicatedMessage([OBJ.retta!])).toBe('Retta duplicata. Annulla la toglie.');
    expect(duplicatedMessage([OBJ.cerchio!])).toBe('Cerchio duplicato. Annulla lo toglie.');
    expect(duplicatedMessage([OBJ.retta!, OBJ.arco!])).toBe('2 oggetti duplicati. Annulla li toglie.');
  });
});
