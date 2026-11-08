import { describe, expect, it } from 'vitest';
import { type PickedSide, angleDegrees } from '../geometry/angular';
import { ANGULAR_PROBLEM_TEXT } from '../geometry/angular';
import type { DimensionDef } from '../geometry/dimension';
import { PageGeometry, type SheetPoint, type UserPoint } from '../geometry/page';
import { COINCIDENT_PX, Construction, type ConstructionEnv, type ConstructionEvents } from './construction';

// Quota angolare (CP6g): le due modalita' di costruzione, gli stessi rifiuti dell'interfaccia, ORTO dal vertice, Annulla passo per passo.
const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const DEG = Math.PI / 180;
const V: UserPoint = { x: 250, y: 300 };
const at = (c: UserPoint, r: number, deg: number): UserPoint => ({ x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) });
const side = (id: number, a: UserPoint, b: UserPoint, index = 0): PickedSide => ({ id, index, a, b });

function setup(opts: { geom?: PageGeometry; ortho?: boolean; zoom?: number; snap?: ConstructionEnv['snap'] } = {}) {
  const log: string[] = [];
  const rejects: string[] = [];
  const dims: DimensionDef[] = [];
  const state = { ortho: opts.ortho ?? false };
  const ev: ConstructionEvents = {
    line: () => log.push('line'),
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    text: () => log.push('text'),
    dimension: (def) => {
      log.push(`dim:${def.dim}`);
      dims.push(def);
    },
    cover: () => log.push('cover'),
    curve: () => log.push('curve'),
    origin: () => log.push('origin'),
    reject: (r) => {
      log.push('reject');
      rejects.push(r);
    },
  };
  const c = new Construction({ geometry: () => opts.geom ?? flat, zoom: () => opts.zoom ?? 1, ortho: () => state.ortho, snap: opts.snap }, ev);
  return { c, log, rejects, dims, state };
}
const start = (mode: 'lines' | 'points', o: Parameters<typeof setup>[0] = {}) => {
  const s = setup(o);
  s.c.setTool('dim');
  s.c.setDimType('angular');
  s.c.setAngularMode(mode);
  return s;
};
const s1 = side(1, at(V, 100, 180), at(V, 100, 0));
const s2 = side(2, at(V, 100, 225), at(V, 100, 45));

describe('quota angolare "da due linee"', () => {
  it('si scelgono due lati e poi un punto: al punto la quota e\' consegnata all\'app (45 gradi), a strumento bloccato per il tastierino', () => {
    for (const geom of [flat, rot]) {
      const { c, log, dims } = start('lines', { geom });
      expect(c.choosingSides).toBe(true);
      expect(c.needed).toBe(1);
      expect(c.addSide(s1)).toBe(true);
      expect(c.choosingSides).toBe(true);
      expect(c.addSide(s2)).toBe(true);
      expect(c.choosingSides).toBe(false);
      expect(log).toEqual([]);
      c.place(at(V, 60, 22.5));
      expect(log).toEqual(['dim:angular']);
      expect(c.locked).toBe(true);
      expect(angleDegrees(dims[0] as DimensionDef, geom)).toBeCloseTo(45, 8);
      expect(c.sides).toHaveLength(2); // restano finche' l'app non chiama reset() (fine del tastierino)
      c.reset();
      expect(c.sides).toHaveLength(0);
      expect(c.pending).toBe(false);
    }
  });

  it('i testi guida: una riga per passo, il nome della quota e il verbo del passo', () => {
    const { c } = start('lines');
    expect(c.prompt).toBe('Quota angolare: scegli la prima linea');
    c.addSide(s1);
    expect(c.prompt).toBe('Quota angolare: scegli la seconda linea');
    c.addSide(s2);
    expect(c.prompt).toBe('Quota angolare: indica dove mettere l\'arco');
    c.place(at(V, 60, 22.5));
    expect(c.prompt).toBe('Quota angolare: digita il valore con il tastierino');
  });

  it('lo stesso tratto due volte, rette parallele, sulla stessa retta: rifiutati con il motivo, il primo lato resta scelto', () => {
    const { c, log, rejects } = start('lines');
    c.addSide(s1);
    expect(c.addSide(side(1, s1.a, s1.b))).toBe(false);
    expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT['same-side']);
    expect(c.addSide(side(3, at(V, 100, 90), { x: V.x + 100, y: V.y + 100 }))).toBe(false); // parallela a s1 (orizzontale)
    expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT.parallel);
    expect(c.addSide(side(4, at(V, 300, 0), at(V, 500, 0)))).toBe(false); // sulla stessa retta
    expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT.parallel);
    expect(log.filter((x) => x === 'reject')).toHaveLength(3);
    expect(c.sides).toHaveLength(1);
    expect(c.choosingSides).toBe(true);
    // due tratti diversi della stessa Linea si accettano
    const t = start('lines');
    expect(t.c.addSide(side(7, { x: 100, y: 100 }, { x: 300, y: 100 }, 0))).toBe(true);
    expect(t.c.addSide(side(7, { x: 300, y: 100 }, { x: 300, y: 300 }, 1))).toBe(true);
  });

  it('addSide non fa nulla fuori dalla scelta dei lati (altro strumento, altra modalita\', tre lati)', () => {
    const idle = setup();
    expect(idle.c.addSide(s1)).toBe(false);
    const pts = start('points');
    expect(pts.c.addSide(s1)).toBe(false);
    const full = start('lines');
    full.c.addSide(s1);
    full.c.addSide(s2);
    expect(full.c.addSide(side(9, at(V, 80, 100), at(V, 80, 280)))).toBe(false);
    expect(full.c.sides).toHaveLength(2);
    const seg = setup();
    seg.c.setTool('segment');
    expect(seg.c.addSide(s1)).toBe(false);
    expect(seg.c.choosingSides).toBe(false);
  });

  it('il punto sul vertice o su una delle due rette (entro 6 px) e\' rifiutato; appena oltre si accetta', () => {
    for (const zoom of [1, 4]) {
      const { c, log, rejects } = start('lines', { zoom });
      c.addSide(s1);
      c.addSide(s2);
      c.place(V);
      expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT['at-vertex']);
      c.place(at(V, (COINCIDENT_PX - 1) / zoom, 120)); // vicino al vertice, ma a 5 px
      expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT['at-vertex']);
      c.place(at(V, 80, 0.01)); // a 0.014 pt dalla retta 1
      expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT['on-line']);
      c.place({ x: V.x + 80, y: V.y + (COINCIDENT_PX - 1) / zoom });
      expect(rejects.at(-1)).toBe(ANGULAR_PROBLEM_TEXT['on-line']);
      expect(log).toEqual(['reject', 'reject', 'reject', 'reject']);
      expect(c.points).toHaveLength(0);
      expect(c.sides).toHaveLength(2);
      c.place({ x: V.x + 80, y: V.y + (COINCIDENT_PX + 1) / zoom });
      expect(log.at(-1)).toBe('dim:angular');
    }
  });

  it('un punto prima di aver scelto i due lati non vale', () => {
    const { c, log, rejects } = start('lines');
    c.place(at(V, 60, 22.5));
    expect(log).toEqual(['reject']);
    expect(rejects[0]).toBe('Quota angolare: scegli prima le due linee.');
    expect(c.points).toHaveLength(0);
  });

  it('Annulla toglie l\'ultimo passo: prima il punto (se ce n\'e\' uno), poi l\'ultimo lato, poi il primo; poi non c\'e\' piu\' nulla', () => {
    const { c } = start('lines');
    expect(c.undoLast()).toBe(false);
    c.addSide(s1);
    c.addSide(s2);
    expect(c.pending).toBe(true);
    expect(c.undoLast()).toBe(true);
    expect(c.sides.map((s) => s.id)).toEqual([1]);
    expect(c.choosingSides).toBe(true);
    expect(c.prompt).toBe('Quota angolare: scegli la seconda linea');
    expect(c.undoLast()).toBe(true);
    expect(c.pending).toBe(false);
    expect(c.undoLast()).toBe(false);
    // con la quota in attesa del tastierino Annulla non toglie nulla
    c.addSide(s1);
    c.addSide(s2);
    c.place(at(V, 60, 22.5));
    expect(c.locked).toBe(true);
    expect(c.undoLast()).toBe(false);
  });

  it('cambiare modalita', () => {
    const { c } = start('lines');
    c.addSide(s1);
    c.setAngularMode('points');
    expect(c.sides).toHaveLength(0);
    expect(c.choosingSides).toBe(false);
    expect(c.prompt).toBe('Quota angolare: indica il vertice');
    c.setAngularMode('lines');
    expect(c.prompt).toBe('Quota angolare: scegli la prima linea');
  });

  it('nessun ORTO e nessun punto di partenza (Perpendicolare, Tangente) in nessun passo; lo snap vale per il punto dell\'arco', () => {
    const seen: number[] = [];
    const { c, state } = start('lines', {
      snap: (_raw, _touch, pending) => {
        seen.push(pending.length);
        return null;
      },
    });
    state.ortho = true;
    expect(c.anchor).toBeNull();
    c.addSide(s1);
    expect(c.anchor).toBeNull();
    c.addSide(s2);
    expect(c.anchor).toBeNull();
    // ORTO acceso: il punto effettivo e' quello grezzo
    expect(c.constrain({ x: 123.4, y: 567.8 })).toEqual({ x: 123.4, y: 567.8 });
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('quota angolare "da tre punti"', () => {
  it('quattro punti: vertice, un punto per lato, raggio; l\'angolo e\' sempre il minore', () => {
    for (const geom of [flat, rot]) {
      const { c, log, dims } = start('points', { geom });
      expect(c.needed).toBe(4);
      expect(c.choosingSides).toBe(false);
      c.place(V);
      c.place(at(V, 80, 10));
      c.place(at(V, 60, 10 + 135));
      expect(log).toEqual([]);
      c.place(at(V, 50, 300));
      expect(log).toEqual(['dim:angular']);
      expect(angleDegrees(dims[0] as DimensionDef, geom)).toBeCloseTo(135, 8);
      expect(dims[0]?.p1).toEqual(at(V, 80, 10));
      expect(dims[0]?.a).toEqual(V);
    }
    const big = start('points');
    big.c.place(V);
    big.c.place(at(V, 80, 10));
    big.c.place(at(V, 60, 10 + 225)); // 225 gradi in verso antiorario = 135 dall'altra parte: sempre il minore
    big.c.place(at(V, 50, 0));
    expect(angleDegrees(big.dims[0] as DimensionDef, flat)).toBeCloseTo(135, 8);
  });

  it('i testi guida: una riga per passo', () => {
    const { c } = start('points');
    const seen = [c.prompt];
    c.place(V);
    seen.push(c.prompt);
    c.place(at(V, 80, 10));
    seen.push(c.prompt);
    c.place(at(V, 60, 100));
    seen.push(c.prompt);
    expect(seen).toEqual(['Quota angolare: indica il vertice', 'Quota angolare: indica un punto sul lato 1', 'Quota angolare: indica un punto sul lato 2', 'Quota angolare: indica dove mettere l\'arco']);
    for (const t of seen) expect(t.length).toBeLessThanOrEqual(42); // entra su una riga a 390 px anche con A+ 22 (misurato in e2e-cp6g: 42 caratteri entrano, 46 vanno a capo)
  });

  it('ORTO dal vertice sul secondo e sul terzo punto (anche Perpendicolare e Tangente), non sul primo e non sul quarto', () => {
    const { c, state } = start('points');
    state.ortho = true;
    expect(c.anchor).toBeNull(); // primo punto: il vertice
    c.place(V);
    expect(c.anchor).toEqual(V);
    const sheetV = flat.userToSheet(V);
    // ORTO acceso: il secondo punto sta sulla stessa Y (o X) del vertice sul foglio
    const eff = c.constrain({ x: sheetV.x + 120, y: sheetV.y + 9 });
    expect(eff.y).toBeCloseTo(sheetV.y, 9);
    c.place(at(V, 80, 0));
    expect(c.anchor).toEqual(V); // terzo punto: ancora il vertice
    const eff3 = c.constrain({ x: sheetV.x + 7, y: sheetV.y - 120 });
    expect(eff3.x).toBeCloseTo(sheetV.x, 9);
    c.place(at(V, 60, 90));
    expect(c.anchor).toBeNull(); // quarto punto (raggio): nessun ORTO
    const raw: SheetPoint = { x: sheetV.x + 33.3, y: sheetV.y - 21.7 };
    expect(c.constrain(raw)).toEqual(raw);
    // ORTO spento: nessun vincolo
    state.ortho = false;
    const t = start('points');
    t.c.place(V);
    expect(t.c.constrain({ x: sheetV.x + 120, y: sheetV.y + 9 })).toEqual({ x: sheetV.x + 120, y: sheetV.y + 9 });
  });

  it('il punto di partenza di snap e ORTO e\' il vertice anche con /Rotate 90 (la verticale e l\'orizzontale sono quelle che si vedono)', () => {
    const { c, state } = start('points', { geom: rot });
    state.ortho = true;
    c.place(V);
    const sv = rot.userToSheet(V);
    expect(c.constrain({ x: sv.x + 90, y: sv.y + 5 }).y).toBeCloseTo(sv.y, 9);
  });

  it('i punti sul vertice, i lati sulla stessa retta e il raggio nullo sono rifiutati con un messaggio; il passo resta com\'e\'', () => {
    const { c, log, rejects } = start('points');
    c.place(V);
    c.place(at(V, COINCIDENT_PX - 1, 30)); // a 5 px dal vertice
    expect(rejects.at(-1)).toBe('Il punto coincide con il vertice: indica un punto più lontano.');
    expect(c.points).toHaveLength(1);
    c.place(at(V, 80, 40));
    c.place(at(V, 30, 40)); // sullo stesso lato (stessa direzione)
    expect(rejects.at(-1)).toBe('I due lati sono sulla stessa retta: l\'angolo sarebbe 0° o 180°. Indica un altro punto.');
    c.place(at(V, 30, 220)); // dalla parte opposta (180 gradi)
    expect(rejects.at(-1)).toBe('I due lati sono sulla stessa retta: l\'angolo sarebbe 0° o 180°. Indica un altro punto.');
    expect(c.points).toHaveLength(2);
    c.place(at(V, 60, 130));
    c.place(V); // raggio nullo
    expect(rejects.at(-1)).toBe('Il raggio dell\'arco è troppo piccolo: indica un punto più lontano dal vertice.');
    expect(c.points).toHaveLength(3);
    expect(log.filter((x) => x === 'reject')).toHaveLength(4);
    expect(log).not.toContain('dim:angular');
    c.place(at(V, 50, 0));
    expect(log.at(-1)).toBe('dim:angular');
  });

  it('Annulla toglie l\'ultimo punto e Esc/reset tutto', () => {
    const { c } = start('points');
    c.place(V);
    c.place(at(V, 80, 10));
    c.place(at(V, 60, 100));
    expect(c.undoLast()).toBe(true);
    expect(c.points).toHaveLength(2);
    expect(c.prompt).toBe('Quota angolare: indica un punto sul lato 2');
    c.reset();
    expect(c.pending).toBe(false);
    expect(c.prompt).toBe('Quota angolare: indica il vertice');
  });
});

describe('le altre quote non cambiano', () => {
  it('Allineata: ORTO sul secondo punto, tre punti, testi guida e needed come prima; sides resta vuoto', () => {
    const { c, log } = setup();
    c.setTool('dim');
    c.setDimType('aligned');
    expect(c.angular).toBe(false);
    expect(c.choosingSides).toBe(false);
    expect(c.needed).toBe(3);
    expect(c.prompt).toBe('Quota allineata: indica il primo punto');
    c.place(V);
    expect(c.anchor).toEqual(V);
    c.place(at(V, 80, 0));
    expect(c.anchor).toBeNull();
    c.place(at(V, 40, 90));
    expect(log).toEqual(['dim:aligned']);
    expect(c.sides).toHaveLength(0);
  });

  it('con la modalita\' angolare impostata ma un altro tipo di quota, nulla cambia', () => {
    const { c } = setup();
    c.setTool('dim');
    c.setAngularMode('points');
    c.setDimType('diameter');
    expect(c.angular).toBe(false);
    expect(c.needed).toBe(2);
    c.place(V);
    expect(c.anchor).toEqual(V);
  });
});
