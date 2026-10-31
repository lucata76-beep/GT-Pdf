import { describe, expect, it } from 'vitest';
import type { CoverDef } from '../geometry/cover';
import type { DimensionDef } from '../geometry/dimension';
import { PageGeometry, type UserPoint } from '../geometry/page';
import type { SnapHit } from '../geometry/snap';
import { COINCIDENT_PX, Construction, type ConstructionEnv, type ConstructionEvents, type ConstructionTool } from './construction';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }); // Rotate 90 + CropBox

function setup(opts: { geom?: PageGeometry; ortho?: boolean; zoom?: number; snap?: ConstructionEnv['snap'] } = {}) {
  const log: string[] = [];
  const lines: { kind: string; points: UserPoint[] }[] = [];
  const dims: DimensionDef[] = [];
  const covers: CoverDef[] = [];
  const texts: UserPoint[] = [];
  const state = { ortho: opts.ortho ?? false };
  const ev: ConstructionEvents = {
    line: (kind, points) => {
      log.push(`line:${kind}:${points.length}`);
      lines.push({ kind, points });
    },
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    text: (at) => {
      log.push('text');
      texts.push(at);
    },
    dimension: (def) => {
      log.push(`dim:${def.dim}`);
      dims.push(def);
    },
    cover: (def) => {
      log.push(`cover:${def.shape}`);
      covers.push(def);
    },
    reject: () => log.push('reject'),
  };
  const c = new Construction({ geometry: () => opts.geom ?? flat, zoom: () => opts.zoom ?? 1, ortho: () => state.ortho, snap: opts.snap }, ev);
  return { c, log, lines, dims, covers, texts, state };
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

describe('Testo', () => {
  it('un solo punto, poi i tocchi sono ignorati finche\' l\'app non fa reset', () => {
    const { c, log, texts } = setup();
    c.setTool('text');
    expect(c.prompt).toContain('indica dove inizia');
    c.place(P(100, 100));
    expect(log).toEqual(['text']);
    expect(texts).toEqual([P(100, 100)]);
    expect(c.locked).toBe(true);
    expect(c.prompt).toContain('tastierino');
    c.place(P(300, 300));
    expect(log).toEqual(['text']);
    expect(c.undoLast()).toBe(false); // l'annulla di una voce in corso non tocca il punto
    c.reset();
    c.place(P(300, 300));
    expect(log).toEqual(['text', 'text']);
  });

  it('l\'ortogonale non si applica: il punto non cambia', () => {
    const { c } = setup({ ortho: true });
    c.setTool('text');
    const raw = flat.userToSheet(P(300, 130));
    expect(c.constrain(raw)).toEqual(raw);
  });
});

describe('Quota', () => {
  const pts3 = [P(100, 700), P(300, 650), P(200, 600)];

  it('lineare: tre punti (due misurati + posizione della linea di quota), poi attende il tastierino', () => {
    for (const dim of ['aligned', 'horizontal', 'vertical'] as const) {
      const { c, log, dims } = setup();
      c.setTool('dim');
      c.setDimType(dim);
      expect(c.needed).toBe(3);
      c.place(pts3[0] as UserPoint);
      c.place(pts3[1] as UserPoint);
      expect(log).toEqual([]);
      expect(c.pending).toBe(true);
      c.place(pts3[2] as UserPoint);
      expect(log).toEqual([`dim:${dim}`]);
      expect(dims[0]?.p1).toEqual(pts3[0]);
      expect(dims[0]?.p2).toEqual(pts3[1]);
      expect(c.locked).toBe(true);
      c.place(P(10, 10));
      expect(log).toHaveLength(1);
    }
  });

  it('Ø e R: due punti', () => {
    for (const dim of ['diameter', 'radius'] as const) {
      const { c, log, dims } = setup();
      c.setTool('dim');
      c.setDimType(dim);
      expect(c.needed).toBe(2);
      c.place(P(100, 700));
      expect(log).toEqual([]);
      c.place(P(160, 700));
      expect(log).toEqual([`dim:${dim}`]);
      expect(dims[0]?.a).toEqual(P(100, 700));
      expect(dims[0]?.b).toEqual(P(160, 700));
    }
  });

  it('il secondo punto uguale al primo e\' rifiutato; il terzo (posizione della linea) puo\' coincidere', () => {
    const { c, log } = setup();
    c.setTool('dim');
    c.setDimType('aligned');
    c.place(P(100, 700));
    c.place(P(100.5, 700));
    expect(log).toEqual(['reject']);
    c.place(P(300, 700));
    c.place(P(300, 700)); // linea di quota sul punto: offset zero, valido
    expect(log).toEqual(['reject', 'dim:aligned']);
  });

  it('orizzontale con due punti alla stessa X (sul foglio): rifiutato; verticale con la stessa Y: idem', () => {
    const h = setup();
    h.c.setTool('dim');
    h.c.setDimType('horizontal');
    h.c.place(P(100, 700));
    h.c.place(P(100, 500));
    expect(h.log).toEqual(['reject']);
    expect(h.c.points).toHaveLength(1);
    const v = setup();
    v.c.setTool('dim');
    v.c.setDimType('vertical');
    v.c.place(P(100, 700));
    v.c.place(P(300, 700));
    expect(v.log).toEqual(['reject']);
  });

  it('con pagina /Rotate 90 "orizzontale" e\' quella che si vede: punti alla stessa X sul foglio = stessa Y utente', () => {
    const { c, log } = setup({ geom: rot });
    c.setTool('dim');
    c.setDimType('horizontal');
    c.place(rot.sheetToUser({ x: 50, y: 50 }));
    c.place(rot.sheetToUser({ x: 50, y: 200 })); // stessa X sul foglio
    expect(log).toEqual(['reject']);
    c.place(rot.sheetToUser({ x: 250, y: 200 }));
    c.place(rot.sheetToUser({ x: 150, y: 20 }));
    expect(log).toEqual(['reject', 'dim:horizontal']);
  });

  it('cambiare tipo scarta i punti; annulla ultimo punto funziona fino al tastierino', () => {
    const { c } = setup();
    c.setTool('dim');
    c.setDimType('aligned');
    c.place(P(100, 700));
    c.place(P(300, 700));
    expect(c.undoLast()).toBe(true);
    expect(c.points).toHaveLength(1);
    c.setDimType('diameter');
    expect(c.points).toHaveLength(0);
    expect(c.pending).toBe(false);
  });

  it('l\'ortogonale non si applica alle quote', () => {
    const { c } = setup({ ortho: true });
    c.setTool('dim');
    c.setDimType('aligned');
    c.place(P(100, 700));
    const raw = flat.userToSheet(P(300, 730));
    expect(c.constrain(raw)).toEqual(raw);
  });

  it('testo guida per ogni tipo e passo', () => {
    const { c } = setup();
    c.setTool('dim');
    c.setDimType('aligned');
    expect(c.prompt).toBe('Quota allineata: indica il primo punto');
    c.place(P(100, 700));
    expect(c.prompt).toBe('Quota allineata: indica il secondo punto');
    c.place(P(300, 700));
    expect(c.prompt).toBe('Quota allineata: indica dove mettere la linea di quota');
    c.setDimType('diameter');
    expect(c.prompt).toBe('Quota diametro Ø: indica un punto sul bordo');
    c.place(P(100, 700));
    expect(c.prompt).toBe('Quota diametro Ø: indica il punto opposto, sul diametro');
    c.setDimType('radius');
    expect(c.prompt).toBe('Quota raggio R: indica il centro');
    c.place(P(100, 700));
    expect(c.prompt).toBe('Quota raggio R: indica un punto sul bordo');
    c.place(P(160, 700));
    expect(c.prompt).toBe('Quota raggio R: digita il valore con il tastierino');
  });
});

describe('Copertura (rettangolo, quadrato, cerchio)', () => {
  it('rettangolo: due angoli opposti, completa al secondo punto e riparte da capo', () => {
    const { c, log, covers } = setup();
    c.setTool('cover');
    expect(c.needed).toBe(2);
    c.place(P(100, 100));
    expect(c.pending).toBe(true);
    c.place(P(300, 200));
    expect(log).toEqual(['cover:rect']);
    expect(covers[0]).toEqual({ shape: 'rect', p1: P(100, 100), p2: P(300, 200) });
    expect(c.pending).toBe(false);
    c.place(P(10, 10));
    c.place(P(60, 50));
    expect(log).toEqual(['cover:rect', 'cover:rect']);
  });

  it('rettangolo senza larghezza o altezza (su schermo): rifiutato, il primo punto resta', () => {
    const { c, log } = setup();
    c.setTool('cover');
    c.place(P(100, 100));
    c.place(P(300, 102)); // 2 px di altezza a zoom 1: meno di COINCIDENT_PX
    c.place(P(103, 300)); // 3 px di larghezza
    expect(log).toEqual(['reject', 'reject']);
    expect(c.points).toHaveLength(1);
    c.place(P(100 + COINCIDENT_PX, 100 + COINCIDENT_PX));
    expect(log.at(-1)).toBe('cover:rect');
  });

  it('il limite si misura in pixel di schermo: con lo zoom un rettangolo piccolo e\' valido', () => {
    const { c, log } = setup({ zoom: 8 });
    c.setTool('cover');
    c.place(P(100, 100));
    c.place(P(101, 101)); // 1 pt x 8 = 8 px
    expect(log).toEqual(['cover:rect']);
  });

  it('quadrato: il secondo punto diventa l\'angolo squadrato (lato = il maggiore dei due spostamenti, verso il punto indicato)', () => {
    const { c, covers } = setup();
    c.setTool('cover');
    c.setCoverKind('square');
    c.place(P(100, 400)); // pagina senza rotazione: utente Y verso l'alto, foglio Y verso il basso
    c.place(P(180, 380)); // dx = +80, sul foglio dy = +20 (verso il basso): lato 80
    const cv = covers[0];
    expect(cv?.shape).toBe('square');
    expect(cv?.p1).toEqual(P(100, 400));
    expect(cv?.p2.x).toBeCloseTo(180, 9);
    expect(cv?.p2.y).toBeCloseTo(320, 9); // 80 verso il basso del foglio = Y utente 400 - 80
  });

  it('quadrato: la mira (constrain) mostra gia\' l\'angolo squadrato, e piazzarlo non lo cambia', () => {
    const { c, covers } = setup();
    c.setTool('cover');
    c.setCoverKind('square');
    expect(c.constrain({ x: 123, y: 456 })).toEqual({ x: 123, y: 456 }); // senza primo punto: nessun vincolo
    c.place(P(100, 400));
    const sheetA = flat.userToSheet(P(100, 400));
    const raw = { x: sheetA.x + 70, y: sheetA.y - 30 };
    const eff = c.constrain(raw);
    expect(eff.x - sheetA.x).toBeCloseTo(70, 9);
    expect(sheetA.y - eff.y).toBeCloseTo(70, 9); // quadrato: stesso lato, verso l'alto come il punto
    c.place(flat.sheetToUser(eff));
    const cv = covers[0];
    expect(cv).toBeDefined();
    const s2 = flat.userToSheet((cv as CoverDef).p2);
    expect(s2.x).toBeCloseTo(eff.x, 9);
    expect(s2.y).toBeCloseTo(eff.y, 9);
  });

  it('quadrato su pagina /Rotate 90 + CropBox: e\' un quadrato sul foglio mostrato', () => {
    const { c, covers } = setup({ geom: rot });
    c.setTool('cover');
    c.setCoverKind('square');
    c.place(P(100, 100));
    c.place(P(260, 130));
    const cv = covers[0] as CoverDef;
    const a = rot.userToSheet(cv.p1);
    const b = rot.userToSheet(cv.p2);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y), 9);
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(20);
  });

  it('cerchio: centro e punto sul bordo; raggio minimo come per gli altri strumenti', () => {
    const { c, log, covers } = setup();
    c.setTool('cover');
    c.setCoverKind('circle');
    c.place(P(200, 300));
    c.place(P(201, 300)); // 1 px
    expect(log).toEqual(['reject']);
    c.place(P(260, 300));
    expect(covers[0]).toEqual({ shape: 'circle', p1: P(200, 300), p2: P(260, 300) });
  });

  it('cambiare forma scarta il punto gia\' indicato; l\'ortogonale non si applica alle coperture', () => {
    const { c, state } = setup({ ortho: true });
    c.setTool('cover');
    c.place(P(100, 100));
    expect(c.anchor).toBeNull();
    const raw = { x: 250.7, y: 399.3 };
    expect(c.constrain(raw)).toEqual(raw); // rettangolo: nessun vincolo, nemmeno con ORTO attivo
    state.ortho = false;
    c.setCoverKind('circle');
    expect(c.points).toHaveLength(0);
  });

  it('i testi guida seguono la forma e il passo', () => {
    const { c } = setup();
    c.setTool('cover');
    expect(c.prompt).toBe('Copertura rettangolare: indica il primo angolo');
    c.place(P(100, 100));
    expect(c.prompt).toBe('Copertura rettangolare: indica l\'angolo opposto');
    c.setCoverKind('circle');
    expect(c.prompt).toBe('Copertura circolare: indica il centro');
    c.place(P(100, 100));
    expect(c.prompt).toBe('Copertura circolare: indica un punto sul bordo');
  });
});

describe('snap sugli oggetti (V2a)', () => {
  const hitAt = (g: PageGeometry, u: UserPoint, kind: SnapHit['kind'] = 'end'): SnapHit => ({ point: g.userToSheet(u), kind });

  it('senza `snap` nell\'ambiente il comportamento e\' quello di prima: punto grezzo, o ortogonale se attivo', () => {
    const { c, state } = setup();
    c.setTool('segment');
    const raw = flat.userToSheet(P(130, 90));
    expect(c.resolve(raw)).toEqual({ point: raw, snap: null });
    expect(c.constrain(raw)).toEqual(raw);
    c.place(P(100, 100));
    state.ortho = true;
    expect(c.resolve(flat.userToSheet(P(300, 107))).snap).toBeNull();
    expect(c.resolve(flat.userToSheet(P(300, 107))).point.y).toBeCloseTo(flat.userToSheet(P(100, 100)).y, 12);
  });

  it('un candidato nel raggio porta il punto li\' e dice il tipo; `constrain` restituisce lo stesso punto', () => {
    const calls: { raw: { x: number; y: number }; touch: boolean }[] = [];
    const target = hitAt(flat, P(200, 300), 'mid');
    const { c } = setup({ snap: (raw, touch) => (calls.push({ raw, touch }), target) });
    c.setTool('segment');
    const raw = flat.userToSheet(P(203, 297));
    expect(c.resolve(raw, true)).toEqual({ point: target.point, snap: 'mid' });
    expect(c.constrain(raw)).toEqual(target.point);
    expect(calls[0]).toEqual({ raw, touch: true });
    expect(calls[1]?.touch).toBe(false);
  });

  it('priorita\': lo snap vince sull\'ORTO (il punto puo\' andare fuori asse); senza candidato resta l\'ORTO', () => {
    let hit: SnapHit | null = hitAt(flat, P(400, 400));
    const { c, state } = setup({ ortho: true, snap: () => hit });
    state.ortho = true;
    c.setTool('segment');
    c.place(P(100, 100));
    const raw = flat.userToSheet(P(390, 108));
    expect(c.resolve(raw)).toEqual({ point: flat.userToSheet(P(400, 400)), snap: 'end' });
    hit = null;
    const o = c.resolve(raw);
    expect(o.snap).toBeNull();
    expect(o.point.y).toBeCloseTo(flat.userToSheet(P(100, 100)).y, 12); // orizzontale come prima
    expect(o.point.x).toBeCloseTo(raw.x, 12);
  });

  it('con snap, inserire il punto effettivo da\' esattamente il punto utente del candidato (anche con /Rotate 90 + CropBox)', () => {
    for (const geom of [flat, rot]) {
      const target = P(140.25, 321.5);
      const { c } = setup({ geom, snap: () => hitAt(geom, target) });
      c.setTool('segment');
      const eff = c.resolve(geom.userToSheet(P(143, 318)));
      c.place(geom.sheetToUser(eff.point));
      const first = c.points[0] as UserPoint;
      expect(first.x).toBeCloseTo(target.x, 9);
      expect(first.y).toBeCloseTo(target.y, 9);
    }
  });

  it('quadrato: sul secondo punto vince la squadratura (nessuno snap); sul primo si aggancia', () => {
    let asked = 0;
    const target = hitAt(flat, P(500, 500));
    const { c } = setup({ snap: () => (asked++, target) });
    c.setCoverKind('square');
    c.setTool('cover');
    c.setCoverKind('square');
    expect(c.resolve(flat.userToSheet(P(10, 10))).snap).toBe('end'); // primo angolo
    expect(asked).toBe(1);
    c.place(P(100, 100));
    const r = c.resolve(flat.userToSheet(P(300, 180)));
    expect(r.snap).toBeNull();
    expect(asked).toBe(1); // lo snap non e\' nemmeno stato interrogato
    const a = flat.userToSheet(P(100, 100));
    expect(Math.abs(r.point.x - a.x)).toBeCloseTo(Math.abs(r.point.y - a.y), 12);
  });

  it('rettangolo e cerchio: lo snap vale per entrambi i punti', () => {
    const target = hitAt(flat, P(500, 500));
    for (const kind of ['rect', 'circle'] as const) {
      const { c } = setup({ snap: () => target });
      c.setTool('cover');
      c.setCoverKind(kind);
      expect(c.resolve(flat.userToSheet(P(10, 10))).snap).toBe('end');
      c.place(P(100, 100));
      expect(c.resolve(flat.userToSheet(P(300, 180))).snap).toBe('end');
    }
  });

  it('non si interroga lo snap senza strumento o con lo strumento bloccato (dialogo o tastierino aperto)', () => {
    let asked = 0;
    const target = hitAt(flat, P(500, 500));
    const { c } = setup({ snap: () => (asked++, target) });
    expect(c.resolve(flat.userToSheet(P(10, 10))).snap).toBeNull(); // nessuno strumento
    c.setTool('calibrate');
    c.place(P(100, 100));
    c.place(P(300, 100)); // due punti: il dialogo e\' aperto, lo strumento e\' bloccato
    expect(c.locked).toBe(true);
    asked = 0;
    expect(c.resolve(flat.userToSheet(P(10, 10))).snap).toBeNull();
    expect(asked).toBe(0);
  });

  it('tutti gli strumenti di costruzione si agganciano al primo punto; Distanza anche per una nuova misura', () => {
    const target = hitAt(flat, P(500, 500));
    const tools: ConstructionTool[] = ['segment', 'polyline', 'calibrate', 'distance', 'text', 'dim', 'cover'];
    for (const t of tools) {
      const { c } = setup({ snap: () => target });
      c.setTool(t);
      expect(c.resolve(flat.userToSheet(P(10, 10))).snap, t).toBe('end');
    }
    const { c } = setup({ snap: () => target });
    c.setTool('distance');
    c.place(P(100, 100));
    c.place(P(300, 100));
    expect(c.done).toBe(true);
    expect(c.resolve(flat.userToSheet(P(10, 10))).snap).toBe('end'); // il tocco successivo inizia una nuova misura
  });

  it('terzo punto di una quota: si aggancia come ogni punto indicato', () => {
    const target = hitAt(flat, P(250, 400));
    const { c } = setup({ snap: () => target });
    c.setTool('dim');
    c.place(P(100, 100));
    c.place(P(300, 100));
    expect(c.resolve(flat.userToSheet(P(240, 395)))).toEqual({ point: target.point, snap: 'end' });
  });
});
