import { describe, expect, it } from 'vitest';
import { PageGeometry, type UserPoint } from '../geometry/page';
import { COINCIDENT_PX, Construction, type ConstructionEvents } from './construction';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }); // Rotate 90 + CropBox

function setup(opts: { geom?: PageGeometry; ortho?: boolean; zoom?: number } = {}) {
  const log: string[] = [];
  const lines: { kind: string; points: UserPoint[] }[] = [];
  const state = { ortho: opts.ortho ?? false };
  const ev: ConstructionEvents = {
    line: (kind, points) => {
      log.push(`line:${kind}:${points.length}`);
      lines.push({ kind, points });
    },
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    reject: () => log.push('reject'),
  };
  const c = new Construction({ geometry: () => opts.geom ?? flat, zoom: () => opts.zoom ?? 1, ortho: () => state.ortho }, ev);
  return { c, log, lines, state };
}
const P = (x: number, y: number): UserPoint => ({ x, y });

describe('Retta = segmento a 2 punti', () => {
  it('si completa al secondo punto e riparte da capo', () => {
    const { c, log, lines } = setup();
    c.setTool('segment');
    c.place(P(100, 100));
    expect(c.pending).toBe(true);
    expect(log).toEqual([]);
    c.place(P(300, 100));
    expect(log).toEqual(['line:segment:2']);
    expect(lines[0]?.points).toEqual([P(100, 100), P(300, 100)]);
    expect(c.pending).toBe(false);
    c.place(P(10, 10));
    c.place(P(20, 90));
    expect(log).toEqual(['line:segment:2', 'line:segment:2']);
  });

  it('due punti coincidenti: rifiutati, il primo resta', () => {
    const { c, log } = setup();
    c.setTool('segment');
    c.place(P(100, 100));
    c.place(P(100.5, 100)); // a zoom 1 = meno di COINCIDENT_PX
    expect(log).toEqual(['reject']);
    expect(c.points).toHaveLength(1);
  });

  it('la soglia di coincidenza dipende dallo zoom (pixel, non pt)', () => {
    const near = setup({ zoom: 10 });
    near.c.setTool('segment');
    near.c.place(P(100, 100));
    near.c.place(P(100 + (COINCIDENT_PX - 1) / 10, 100)); // 5 px a zoom 10
    expect(near.log[0]).toContain('reject');
    const far = setup({ zoom: 10 });
    far.c.setTool('segment');
    far.c.place(P(100, 100));
    far.c.place(P(100 + (COINCIDENT_PX + 1) / 10, 100)); // 7 px a zoom 10
    expect(far.log).toEqual(['line:segment:2']);
  });
});

describe('Linea = spezzata a piu punti', () => {
  it('Fine con 3 punti crea una spezzata di 3 punti', () => {
    const { c, log, lines } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(P(200, 100));
    c.place(P(200, 200));
    expect(log).toEqual([]);
    c.finish();
    expect(log).toEqual(['line:polyline:3']);
    expect(lines[0]?.points).toHaveLength(3);
    expect(c.pending).toBe(false);
  });

  it('un tocco sull\'ultimo punto termina la linea (non aggiunge un punto doppio)', () => {
    const { c, log, lines } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(P(200, 100));
    c.place(P(200.2, 100.1));
    expect(log).toEqual(['line:polyline:2']);
    expect(lines[0]?.points).toEqual([P(100, 100), P(200, 100)]);
  });

  it('Fine con un solo punto non crea nulla e azzera', () => {
    const { c, log } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.finish();
    expect(log).toEqual([]);
    expect(c.pending).toBe(false);
  });

  it('con un solo punto, un secondo tocco coincidente e\' rifiutato (non e\' "fine")', () => {
    const { c, log } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(P(100, 100));
    expect(log).toEqual(['reject']);
  });

  it('annulla ultimo punto', () => {
    const { c } = setup();
    c.setTool('polyline');
    expect(c.undoLast()).toBe(false);
    c.place(P(100, 100));
    c.place(P(200, 100));
    expect(c.undoLast()).toBe(true);
    expect(c.points).toEqual([P(100, 100)]);
    expect(c.undoLast()).toBe(true);
    expect(c.pending).toBe(false);
    expect(c.undoLast()).toBe(false);
  });
});

describe('Distanza', () => {
  it('due punti, poi il risultato resta; il tocco successivo inizia una nuova misura', () => {
    const { c, log } = setup();
    c.setTool('distance');
    c.place(P(100, 100));
    c.place(P(200, 100));
    expect(log).toEqual(['measure']);
    expect(c.done).toBe(true);
    expect(c.points).toHaveLength(2); // restano per il disegno
    expect(c.anchor).toBeNull(); // nessun vincolo dal risultato precedente
    expect(c.pending).toBe(false);
    c.place(P(300, 300));
    expect(c.done).toBe(false);
    expect(c.points).toEqual([P(300, 300)]);
    c.place(P(300, 400));
    expect(log).toEqual(['measure', 'measure']);
  });
});

describe('Scala', () => {
  it('due punti, poi i tocchi sono ignorati finche\' l\'app non fa reset', () => {
    const { c, log } = setup();
    c.setTool('calibrate');
    c.place(P(100, 100));
    c.place(P(383.46, 100));
    expect(log).toEqual(['calibrate']);
    expect(c.locked).toBe(true);
    c.place(P(500, 500));
    expect(log).toEqual(['calibrate']);
    expect(c.points).toHaveLength(2);
    c.reset();
    expect(c.locked).toBe(false);
    expect(c.points).toHaveLength(0);
  });
});

describe('vincolo ortogonale', () => {
  it('spento: il punto non cambia', () => {
    const { c } = setup({ ortho: false });
    c.setTool('segment');
    c.place(P(100, 100));
    const raw = flat.userToSheet(P(300, 130));
    expect(c.constrain(raw)).toEqual(raw);
  });

  it('senza primo punto non c\'e\' nulla da vincolare', () => {
    const { c } = setup({ ortho: true });
    c.setTool('segment');
    const raw = { x: 12, y: 34 };
    expect(c.constrain(raw)).toEqual(raw);
  });

  it('acceso: il secondo punto va su orizzontale o verticale (pagina senza /Rotate)', () => {
    const { c } = setup({ ortho: true });
    c.setTool('segment');
    c.place(P(100, 100));
    const h = flat.sheetToUser(c.constrain(flat.userToSheet(P(300, 130))));
    expect(h.y).toBeCloseTo(100, 9);
    expect(h.x).toBeCloseTo(300, 9);
    const v = flat.sheetToUser(c.constrain(flat.userToSheet(P(110, 400))));
    expect(v.x).toBeCloseTo(100, 9);
    expect(v.y).toBeCloseTo(400, 9);
  });

  it('acceso su pagina /Rotate 90 + CropBox: orizzontale come appare sullo schermo', () => {
    const { c } = setup({ geom: rot, ortho: true });
    c.setTool('segment');
    c.place(P(100, 100)); // foglio (50, 50)
    const raw = { x: 250, y: 60 }; // quasi orizzontale sullo schermo
    const eff = c.constrain(raw);
    expect(eff.y).toBeCloseTo(50, 9); // stessa y sullo schermo
    expect(eff.x).toBeCloseTo(250, 9);
    const user = rot.sheetToUser(eff);
    expect(user.x).toBeCloseTo(100, 9); // nello spazio utente e' verticale
    c.place(user);
    expect(c.points).toHaveLength(0); // retta completata
  });

  it('Linea: ogni punto e\' vincolato rispetto al precedente', () => {
    const { c } = setup({ ortho: true });
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(flat.sheetToUser(c.constrain(flat.userToSheet(P(300, 110))))); // orizzontale
    expect(c.points[1]?.y).toBeCloseTo(100, 9);
    const third = flat.sheetToUser(c.constrain(flat.userToSheet(P(310, 400)))); // verticale rispetto a (300,100)
    expect(third.x).toBeCloseTo(300, 9);
  });

  it('si puo\' attivare e disattivare in qualunque momento', () => {
    const { c, state } = setup({ ortho: true });
    c.setTool('segment');
    c.place(P(100, 100));
    const raw = flat.userToSheet(P(300, 130));
    expect(c.constrain(raw)).not.toEqual(raw);
    state.ortho = false;
    expect(c.constrain(raw)).toEqual(raw);
  });
});

describe('testo guida', () => {
  it('cambia con il passo', () => {
    const { c } = setup();
    c.setTool('segment');
    expect(c.prompt).toBe('Retta: indica il primo punto');
    c.place(P(1, 1));
    expect(c.prompt).toBe('Retta: indica il secondo punto');
    c.setTool('polyline');
    c.place(P(1, 1));
    c.place(P(50, 1));
    expect(c.prompt).toContain('Fine');
  });
});
