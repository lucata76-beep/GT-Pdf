import { describe, expect, it } from 'vitest';
import { FILLET_PROBLEM_TEXT, type FilletSide } from '../geometry/fillet';
import { PageGeometry, type UserPoint } from '../geometry/page';
import { Construction, type ConstructionEnv, type ConstructionEvents, TOOL_NAME } from './construction';

// Raccordo (CP6h): lo strumento sceglie due tratti (non indica punti), consegna i due tratti all'app per il raggio, rifiuta con il motivo e si annulla passo per passo.
const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const V: UserPoint = { x: 250, y: 300 };
const side = (id: number, a: UserPoint, b: UserPoint, click: UserPoint, index = 0): FilletSide => ({ id, index, a, b, click });
const s1 = side(1, { x: 100, y: 300 }, { x: 400, y: 300 }, { x: 320, y: 300 });
const s2 = side(2, { x: 250, y: 100 }, { x: 250, y: 500 }, { x: 250, y: 380 });

function setup(opts: { withEvent?: boolean } = {}) {
  const log: string[] = [];
  const rejects: string[] = [];
  const got: [FilletSide, FilletSide][] = [];
  const ev: ConstructionEvents = {
    line: () => log.push('line'),
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    text: () => log.push('text'),
    dimension: () => log.push('dim'),
    cover: () => log.push('cover'),
    curve: () => log.push('curve'),
    origin: () => log.push('origin'),
    ...(opts.withEvent === false
      ? {}
      : {
          fillet: (sides: [FilletSide, FilletSide]) => {
            log.push('fillet');
            got.push(sides);
          },
        }),
    reject: (r) => {
      log.push('reject');
      rejects.push(r);
    },
  };
  const env: ConstructionEnv = { geometry: () => flat, zoom: () => 1, ortho: () => false };
  const c = new Construction(env, ev);
  c.setTool('fillet');
  return { c, log, rejects, got };
}

describe('strumento Raccordo: scelta dei due tratti', () => {
  it('il nome dello strumento e\' "Raccordo"; all\'inizio sceglie tratti e non ha punti ne\' ORTO', () => {
    const { c } = setup();
    expect(TOOL_NAME.fillet).toBe('Raccordo');
    expect(c.tool).toBe('fillet');
    expect(c.choosingFillet).toBe(true);
    expect(c.anchor).toBeNull();
    expect(c.needed).toBe(2);
    expect(c.pending).toBe(false);
  });

  it('i testi guida: una riga per passo', () => {
    const { c } = setup();
    expect(c.prompt).toBe('Raccordo: scegli il primo tratto');
    expect(c.addFilletSide(s1)).toBe(true);
    expect(c.prompt).toBe('Raccordo: scegli il secondo tratto');
    expect(c.pending).toBe(true);
    expect(c.addFilletSide(s2)).toBe(true);
    expect(c.prompt).toBe('Raccordo: digita il raggio');
    for (const t of ['Raccordo: scegli il primo tratto', 'Raccordo: scegli il secondo tratto', 'Raccordo: digita il raggio']) expect(t.length).toBeLessThanOrEqual(42);
  });

  it('dopo il secondo tratto la costruzione si blocca e i due tratti (con i clic) sono consegnati all\'app; reset() la riapre', () => {
    const { c, log, got } = setup();
    c.addFilletSide(s1);
    expect(log).toEqual([]);
    c.addFilletSide(s2);
    expect(log).toEqual(['fillet']);
    expect(c.locked).toBe(true);
    expect(c.choosingFillet).toBe(false);
    expect(got[0]?.[0]).toEqual(s1);
    expect(got[0]?.[1]).toEqual(s2);
    expect(got[0]?.[0].click).toEqual({ x: 320, y: 300 }); // il clic grezzo e' conservato
    c.reset();
    expect(c.filletSides).toHaveLength(0);
    expect(c.locked).toBe(false);
    expect(c.choosingFillet).toBe(true); // resta armato: si puo' scegliere un'altra coppia
    expect(c.tool).toBe('fillet');
  });

  it('i tocchi come punti (place) non fanno nulla: il raccordo sceglie tratti', () => {
    const { c, log } = setup();
    c.place({ x: 10, y: 10 });
    expect(c.points).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it('un tratto non si aggiunge se non sta scegliendo (strumento diverso o gia\' bloccato)', () => {
    const { c } = setup();
    c.setTool('segment');
    expect(c.addFilletSide(s1)).toBe(false);
    c.setTool('fillet');
    c.addFilletSide(s1);
    c.addFilletSide(s2);
    expect(c.addFilletSide(s1)).toBe(false); // bloccato in attesa del raggio
    expect(c.filletSides).toHaveLength(2);
  });
});

describe('strumento Raccordo: rifiuti con il motivo', () => {
  it('lo stesso tratto due volte: rifiuto, il primo resta scelto', () => {
    const { c, rejects, log } = setup();
    c.addFilletSide(s1);
    expect(c.addFilletSide({ ...s1, click: { x: 150, y: 300 } })).toBe(false);
    expect(rejects).toEqual([FILLET_PROBLEM_TEXT['same-side']]);
    expect(c.filletSides).toHaveLength(1);
    expect(log).toEqual(['reject']);
  });
  it('rette parallele: rifiuto, il primo resta scelto', () => {
    const { c, rejects } = setup();
    c.addFilletSide(s1);
    expect(c.addFilletSide(side(2, { x: 100, y: 400 }, { x: 400, y: 400 }, { x: 200, y: 400 }))).toBe(false);
    expect(rejects).toEqual([FILLET_PROBLEM_TEXT.parallel]);
    expect(c.filletSides).toHaveLength(1);
    // dopo il rifiuto si puo' scegliere un altro secondo tratto
    expect(c.addFilletSide(s2)).toBe(true);
  });
  it('clic sul vertice dentro il tratto: rifiuto', () => {
    const { c, rejects } = setup();
    c.addFilletSide(s1);
    expect(c.addFilletSide({ ...s2, click: V })).toBe(false);
    expect(rejects).toEqual([FILLET_PROBLEM_TEXT['on-vertex']]);
  });
  it('vertice fuori dai limiti del foglio: rifiuto', () => {
    const { c, rejects } = setup();
    // due rette a 0,006 gradi (sopra la soglia di parallelismo) e a 200 di distanza si incontrano a circa 1,9 milioni di unita': oltre il limite del formato
    const dy = 100 * Math.tan((0.006 * Math.PI) / 180);
    c.addFilletSide(side(1, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }));
    expect(c.addFilletSide(side(2, { x: 0, y: 200 }, { x: 100, y: 200 + dy }, { x: 50, y: 200 + dy / 2 }))).toBe(false);
    expect(rejects).toEqual([FILLET_PROBLEM_TEXT.far]);
  });
});

describe('strumento Raccordo: Annulla, annullamento e cambio di strumento', () => {
  it('Annulla toglie l\'ultimo tratto scelto, passo per passo, e poi non c\'e\' piu\' niente da togliere', () => {
    const { c } = setup();
    expect(c.undoLast()).toBe(false);
    c.addFilletSide(s1);
    expect(c.pending).toBe(true);
    expect(c.undoLast()).toBe(true);
    expect(c.filletSides).toHaveLength(0);
    expect(c.pending).toBe(false);
    expect(c.prompt).toBe('Raccordo: scegli il primo tratto');
    expect(c.undoLast()).toBe(false);
  });
  it('con il tastierino aperto (costruzione bloccata) Annulla non toglie niente', () => {
    const { c } = setup();
    c.addFilletSide(s1);
    c.addFilletSide(s2);
    expect(c.locked).toBe(true);
    expect(c.undoLast()).toBe(false);
    expect(c.filletSides).toHaveLength(2);
  });
  it('il cambio di strumento azzera i tratti scelti', () => {
    const { c } = setup();
    c.addFilletSide(s1);
    c.setTool('segment');
    expect(c.filletSides).toHaveLength(0);
    expect(c.pending).toBe(false);
    c.setTool('fillet');
    expect(c.prompt).toBe('Raccordo: scegli il primo tratto');
  });
  it('senza l\'evento facoltativo la costruzione si blocca comunque (nessun errore)', () => {
    const { c } = setup({ withEvent: false });
    c.addFilletSide(s1);
    expect(c.addFilletSide(s2)).toBe(true);
    expect(c.locked).toBe(true);
  });
});
