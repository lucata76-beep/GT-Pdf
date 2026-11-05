// Cerchio e Arco (V2b, CP6c) e i punti in costruzione come candidati dello snap: prove di `Construction` con la ricerca di snap vera (`findSnap`).
import { describe, expect, it } from 'vitest';
import { ARC_PROBLEM_TEXT, type CurveKind, arcThroughPoints } from '../geometry/arc';
import { PageGeometry, type SheetPoint, type UserPoint } from '../geometry/page';
import { type SnapKinds, findSnap } from '../geometry/snap';
import type { PageObject } from '../model/model';
import { COINCIDENT_PX, Construction, type ConstructionEnv, type ConstructionEvents } from './construction';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }); // Rotate 90 + CropBox
const ALL: SnapKinds = { end: true, mid: true, center: true };
const P = (x: number, y: number): UserPoint => ({ x, y });
const DEG = Math.PI / 180;

function setup(opts: { geom?: PageGeometry; ortho?: boolean; zoom?: number; objects?: PageObject[]; kinds?: SnapKinds; radius?: number; grid?: ConstructionEnv['grid'] } = {}) {
  const geom = opts.geom ?? flat;
  const log: string[] = [];
  const rejects: string[] = [];
  const curves: { kind: CurveKind; points: UserPoint[] }[] = [];
  const lines: { kind: string; points: UserPoint[] }[] = [];
  const state = { ortho: opts.ortho ?? false };
  const ev: ConstructionEvents = {
    line: (kind, points) => {
      log.push(`line:${kind}:${points.length}`);
      lines.push({ kind, points });
    },
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    text: () => log.push('text'),
    dimension: (def) => log.push(`dim:${def.dim}`),
    cover: (def) => log.push(`cover:${def.shape}`),
    curve: (kind, points) => {
      log.push(`curve:${kind}:${points.length}`);
      curves.push({ kind, points });
    },
    reject: (reason) => {
      log.push('reject');
      rejects.push(reason);
    },
  };
  const env: ConstructionEnv = {
    geometry: () => geom,
    zoom: () => opts.zoom ?? 1,
    ortho: () => state.ortho,
    snap: (raw, _touch, pending) => findSnap(opts.objects ?? [], geom, raw, opts.radius ?? 10, opts.kinds ?? ALL, pending),
    grid: opts.grid,
  };
  return { c: new Construction(env, ev), log, rejects, curves, lines, state, geom };
}
const at = (cx: number, cy: number, r: number, deg: number): UserPoint => P(cx + r * Math.cos(deg * DEG), cy + r * Math.sin(deg * DEG));

describe('Cerchio: 2 punti (centro, punto sul bordo)', () => {
  it('si completa al secondo punto con i punti indicati, e riparte da capo', () => {
    const { c, log, curves } = setup();
    c.setCurveKind('circle');
    c.setTool('curve');
    expect(c.needed).toBe(2);
    c.place(P(300, 300));
    expect(c.pending).toBe(true);
    expect(log).toEqual([]);
    c.place(P(340, 330));
    expect(log).toEqual(['curve:circle:2']);
    expect(curves[0]?.points).toEqual([P(300, 300), P(340, 330)]);
    expect(c.pending).toBe(false);
    c.place(P(10, 10));
    c.place(P(10, 60));
    expect(log).toEqual(['curve:circle:2', 'curve:circle:2']);
  });
  it('punto sul bordo coincidente con il centro (meno di COINCIDENT_PX): rifiutato, il centro resta; la soglia e\' in pixel (zoom)', () => {
    const a = setup();
    a.c.setTool('curve');
    a.c.place(P(100, 100));
    a.c.place(P(100 + (COINCIDENT_PX - 1), 100));
    expect(a.log).toEqual(['reject']);
    expect(a.rejects[0]).toBe('I due punti coincidono: scegli un secondo punto diverso.');
    expect(a.c.points).toHaveLength(1);
    const b = setup({ zoom: 10 });
    b.c.setTool('curve');
    b.c.place(P(100, 100));
    b.c.place(P(100 + (COINCIDENT_PX + 1) / 10, 100)); // 7 px a zoom 10
    expect(b.log).toEqual(['curve:circle:2']);
  });
  it('ORTO acceso: nessun effetto (anchor nullo, il punto effettivo e\' quello grezzo)', () => {
    const { c } = setup({ ortho: true });
    c.setTool('curve');
    expect(c.anchor).toBeNull();
    c.place(P(100, 100));
    expect(c.anchor).toBeNull();
    const raw = flat.userToSheet(P(190, 140)); // fuori asse
    expect(c.resolve(raw)).toEqual({ point: raw, snap: null });
  });
  it('ORTO acceso con /Rotate 90 + CropBox: ancora nessun effetto', () => {
    const { c } = setup({ geom: rot, ortho: true });
    c.setTool('curve');
    c.place(P(200, 200));
    const raw = rot.userToSheet(P(260, 250));
    expect(c.resolve(raw).point).toEqual(raw);
  });
  it('Annulla toglie l\'ultimo punto in costruzione', () => {
    const { c } = setup();
    c.setTool('curve');
    c.place(P(100, 100));
    expect(c.undoLast()).toBe(true);
    expect(c.points).toHaveLength(0);
    expect(c.undoLast()).toBe(false);
  });
});

describe('Arco: 3 punti (inizio, punto sull\'arco, fine)', () => {
  const arcSetup = (o: Parameters<typeof setup>[0] = {}) => {
    const s = setup(o);
    s.c.setCurveKind('arc');
    s.c.setTool('curve');
    return s;
  };
  it('si completa al terzo punto, con i tre punti indicati (non centro, raggio o angoli)', () => {
    const { c, log, curves } = arcSetup();
    expect(c.needed).toBe(3);
    c.place(P(100, 100));
    c.place(P(150, 140));
    expect(log).toEqual([]);
    expect(c.pending).toBe(true);
    c.place(P(220, 100));
    expect(log).toEqual(['curve:arc:3']);
    expect(curves[0]).toEqual({ kind: 'arc', points: [P(100, 100), P(150, 140), P(220, 100)] });
    expect(c.pending).toBe(false);
  });
  it('tre punti allineati: rifiutati con il messaggio di una riga; il terzo non si aggiunge, i primi due restano', () => {
    const { c, log, rejects } = arcSetup();
    c.place(P(100, 100));
    c.place(P(200, 200));
    c.place(P(300, 300));
    expect(log).toEqual(['reject']);
    expect(rejects[0]).toBe('I tre punti sono allineati: un arco non passa da tre punti su una retta.');
    expect(rejects[0]).toBe(ARC_PROBLEM_TEXT.collinear);
    expect(c.points).toHaveLength(2);
    // un terzo punto buono dopo il rifiuto completa l'arco
    c.place(P(300, 150));
    expect(log).toEqual(['reject', 'curve:arc:3']);
  });
  it('quasi allineati (sotto 1 grado di sweep): rifiutati; con 3 px di freccia su 300: accettati', () => {
    const a = arcSetup();
    a.c.place(P(100, 100));
    a.c.place(P(250, 100.3));
    a.c.place(P(400, 100));
    expect(a.log).toEqual(['reject']);
    const b = arcSetup();
    b.c.place(P(100, 100));
    b.c.place(P(250, 103));
    b.c.place(P(400, 100));
    expect(b.log).toEqual(['curve:arc:3']);
  });
  it('raggio oltre il massimo: rifiutato con un messaggio proprio', () => {
    const { c, rejects } = arcSetup();
    const R = 2_000_000;
    const q = (deg: number) => P(-R + R * Math.cos(deg * DEG), R * Math.sin(deg * DEG));
    c.place(q(-1));
    c.place(q(0));
    c.place(q(1));
    expect(rejects[0]).toBe(ARC_PROBLEM_TEXT.radius);
    expect(c.points).toHaveLength(2);
  });
  it('punti coincidenti: il secondo sul primo e il terzo sul secondo con il messaggio solito; la fine sull\'inizio con un messaggio proprio', () => {
    const a = arcSetup();
    a.c.place(P(100, 100));
    a.c.place(P(102, 101));
    expect(a.rejects).toEqual(['I due punti coincidono: scegli un secondo punto diverso.']);
    a.c.place(P(200, 160));
    a.c.place(P(201, 161));
    expect(a.rejects[1]).toBe('I due punti coincidono: scegli un secondo punto diverso.');
    expect(a.c.points).toHaveLength(2);
    const b = arcSetup();
    b.c.place(P(100, 100));
    b.c.place(P(200, 160));
    b.c.place(P(103, 102)); // fine a meno di 6 px dall'inizio
    expect(b.rejects).toEqual(['Inizio e fine coincidono: per un arco chiuso usa il cerchio.']);
    expect(b.c.points).toHaveLength(2);
  });
  it('arco lungo (oltre 180 gradi) e in verso antiorario: accettati', () => {
    for (const [a, b, c] of [[0, 200, 300], [300, 200, 0], [0, -100, -250]] as const) {
      const s = arcSetup();
      s.c.place(at(300, 300, 100, a));
      s.c.place(at(300, 300, 100, b));
      s.c.place(at(300, 300, 100, c));
      expect(s.log, `${a},${b},${c}`).toEqual(['curve:arc:3']);
    }
  });
  it('/Rotate 90 + CropBox: i punti passati sono quelli utente, l\'arco e\' valutato sul cerchio dei tre punti', () => {
    const s = arcSetup({ geom: rot });
    const p = [at(250, 300, 80, 20), at(250, 300, 80, 100), at(250, 300, 80, 200)];
    for (const q of p) s.c.place(q);
    expect(s.curves[0]?.points).toEqual(p);
    const arc = arcThroughPoints(p[0]!, p[1]!, p[2]!)!;
    expect(arc.r).toBeCloseTo(80, 9);
  });
  it('ORTO acceso: nessun effetto sul secondo e sul terzo punto', () => {
    const { c } = arcSetup({ ortho: true });
    c.place(P(100, 100));
    for (let n = 1; n <= 2; n++) {
      expect(c.anchor).toBeNull();
      const raw: SheetPoint = flat.userToSheet(P(150 + 40 * n, 140 + 13 * n));
      expect(c.resolve(raw).point).toEqual(raw);
      if (n === 1) c.place(P(150, 140));
    }
  });
  it('Annulla toglie i punti uno alla volta', () => {
    const { c } = arcSetup();
    c.place(P(100, 100));
    c.place(P(150, 140));
    expect(c.undoLast()).toBe(true);
    expect(c.points).toEqual([P(100, 100)]);
    expect(c.undoLast()).toBe(true);
    expect(c.pending).toBe(false);
  });
  it('cambiare tra Cerchio e Arco scarta i punti gia\' indicati', () => {
    const { c } = arcSetup();
    c.place(P(100, 100));
    c.setCurveKind('circle');
    expect(c.points).toHaveLength(0);
    expect(c.needed).toBe(2);
  });
});

describe('testi guida di Cerchio e Arco: una riga ciascuno', () => {
  it('Cerchio e Arco', () => {
    const { c } = setup();
    c.setCurveKind('circle');
    c.setTool('curve');
    expect(c.prompt).toBe('Cerchio: indica il centro');
    c.place(P(100, 100));
    expect(c.prompt).toBe('Cerchio: indica un punto sul bordo');
    c.setCurveKind('arc');
    expect(c.prompt).toBe('Arco: indica l\'inizio');
    c.place(P(100, 100));
    expect(c.prompt).toBe('Arco: indica un punto sull\'arco');
    c.place(P(150, 150));
    expect(c.prompt).toBe('Arco: indica la fine');
    for (const t of [c.prompt, 'Cerchio: indica il centro']) expect(t).not.toContain('\n');
  });
});

describe('snap e griglia su Cerchio e Arco: come per ogni punto indicato (decisione 50)', () => {
  it('snap sul Centro di un cerchio esistente e sull\'Estremo e Punto medio di un arco esistente, anche con /Rotate 90 + CropBox', () => {
    for (const geom of [flat, rot]) {
      const circle: PageObject = { id: 1, kind: 'circle', p1: P(200, 300), p2: P(240, 300), stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } };
      const arc: PageObject = { id: 2, kind: 'arc', p1: at(300, 400, 60, 0), p2: at(300, 400, 60, 50), p3: at(300, 400, 60, 120), stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } };
      const s = setup({ geom, objects: [circle, arc] });
      s.c.setTool('curve');
      expect(s.c.resolve(geom.userToSheet(P(202, 299)))).toEqual({ point: geom.userToSheet(P(200, 300)), snap: 'center' });
      const end = s.c.resolve(geom.userToSheet(at(300, 400, 60, 121)));
      expect(end.snap).toBe('end');
      const mid = s.c.resolve(geom.userToSheet(at(300, 400, 60, 60)));
      expect(mid.snap).toBe('mid');
      const ctr = s.c.resolve(geom.userToSheet(P(301, 401)));
      expect(ctr.snap).toBe('center');
      s.c.place(geom.sheetToUser(ctr.point));
      expect(s.c.points[0]?.x).toBeCloseTo(300, 9);
      expect(s.c.points[0]?.y).toBeCloseTo(400, 9);
    }
  });
  it('la griglia arrotonda tutte e due le coordinate (nessuna ancora ORTO)', () => {
    const s = setup({ grid: () => 20, ortho: true });
    s.c.setTool('curve');
    s.c.place(P(40, 40));
    const r = s.c.resolve(flat.userToSheet(P(113, 87)));
    const u = flat.sheetToUser(r.point);
    expect(Math.abs(u.x / (20 * (1 / 1)) - Math.round(u.x / 20))).toBeLessThan(1e-9);
    expect(Math.abs(u.y / 20 - Math.round(u.y / 20))).toBeLessThan(1e-9);
    expect(r.snap).toBeNull();
  });
});

describe('punti in costruzione come candidati dello snap (V2b, decisione 66)', () => {
  it('senza punti in costruzione il risultato e\' quello di prima (nessun candidato in piu\')', () => {
    const seg: PageObject = { id: 1, kind: 'segment', points: [P(100, 100), P(300, 100)], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } };
    for (const tool of ['segment', 'polyline', 'curve', 'dim', 'cover'] as const) {
      const s = setup({ objects: [seg] });
      s.c.setTool(tool);
      for (const u of [P(103, 98), P(200, 101), P(500, 500), P(298, 103)]) {
        const raw = flat.userToSheet(u);
        expect(s.c.resolve(raw)).toEqual({ point: findSnap([seg], flat, raw, 10, ALL) ? findSnap([seg], flat, raw, 10, ALL)!.point : raw, snap: findSnap([seg], flat, raw, 10, ALL)?.kind ?? null });
      }
    }
  });
  it('Linea: il primo punto si aggancia (Estremo) e chiude la spezzata', () => {
    const { c, lines } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(P(300, 100));
    c.place(P(300, 250));
    const r = c.resolve(flat.userToSheet(P(104, 97))); // vicino al primo punto
    expect(r.snap).toBe('end');
    expect(r.point).toEqual(flat.userToSheet(P(100, 100)));
    c.place(flat.sheetToUser(r.point));
    expect(c.points).toHaveLength(4);
    expect(c.points[3]?.x).toBeCloseTo(100, 9);
    expect(c.points[3]?.y).toBeCloseTo(100, 9);
    c.finish();
    expect(lines[0]?.points).toHaveLength(4);
    expect(lines[0]?.points[3]).toEqual(lines[0]?.points[0]);
  });
  it('Linea: il doppio tocco sull\'ultimo punto la termina, come prima (con lo snap sul punto stesso)', () => {
    const { c, log, lines } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    c.place(P(200, 100));
    c.place(P(200, 200));
    const r = c.resolve(flat.userToSheet(P(203, 198))); // secondo tocco vicino all'ultimo punto: si aggancia ad esso
    expect(r.snap).toBe('end');
    c.place(flat.sheetToUser(r.point));
    expect(log).toEqual(['line:polyline:3']);
    expect(lines[0]?.points).toEqual([P(100, 100), P(200, 100), P(200, 200)]);
  });
  it('Linea con 2 punti: un tocco sull\'ultimo punto non e\' "Fine" (servono almeno 3 punti): rifiuto come prima', () => {
    const { c, log } = setup();
    c.setTool('polyline');
    c.place(P(100, 100));
    const r = c.resolve(flat.userToSheet(P(102, 99)));
    c.place(flat.sheetToUser(r.point));
    expect(log).toEqual(['reject']);
    expect(c.points).toHaveLength(1);
  });
  it('Retta: il secondo punto sul primo e\' rifiutato come oggi', () => {
    const { c, log, rejects } = setup();
    c.setTool('segment');
    c.place(P(100, 100));
    const r = c.resolve(flat.userToSheet(P(104, 102)));
    expect(r.snap).toBe('end'); // si aggancia al primo punto...
    c.place(flat.sheetToUser(r.point));
    expect(log).toEqual(['reject']); // ...e il punto coincidente e' rifiutato
    expect(rejects[0]).toBe('I due punti coincidono: scegli un secondo punto diverso.');
    expect(c.points).toHaveLength(1);
  });
  it('Arco: il primo punto e il punto di passaggio sono candidati per il punto successivo', () => {
    const { c } = setup();
    c.setCurveKind('arc');
    c.setTool('curve');
    c.place(P(100, 100));
    c.place(P(200, 180));
    expect(c.resolve(flat.userToSheet(P(103, 98))).snap).toBe('end');
    expect(c.resolve(flat.userToSheet(P(198, 183))).snap).toBe('end');
    expect(c.resolve(flat.userToSheet(P(150, 140))).snap).toBeNull();
  });
  it('Quota a tre punti: i due punti misurati sono candidati per la posizione della linea di quota', () => {
    const { c } = setup();
    c.setTool('dim');
    c.place(P(100, 100));
    c.place(P(300, 100));
    expect(c.resolve(flat.userToSheet(P(102, 103))).snap).toBe('end');
    expect(c.resolve(flat.userToSheet(P(299, 98))).snap).toBe('end');
  });
  it('non sono candidati: i punti di una Distanza gia\' misurata (done), di una Scala o di un Testo in attesa (bloccati) e con l\'interruttore Estremo spento', () => {
    const d = setup();
    d.c.setTool('distance');
    d.c.place(P(100, 100));
    d.c.place(P(300, 100));
    expect(d.c.done).toBe(true);
    expect(d.c.resolve(flat.userToSheet(P(101, 101))).snap).toBeNull();
    const off = setup({ kinds: { end: false, mid: true, center: true } });
    off.c.setTool('polyline');
    off.c.place(P(100, 100));
    off.c.place(P(300, 100));
    expect(off.c.resolve(flat.userToSheet(P(101, 101))).snap).toBeNull();
    const t = setup();
    t.c.setTool('text');
    t.c.place(P(100, 100));
    expect(t.c.locked).toBe(true);
    expect(t.c.resolve(flat.userToSheet(P(101, 101))).snap).toBeNull();
  });
  it('con /Rotate 90 + CropBox il punto agganciato e\' esattamente il punto utente indicato', () => {
    const { c } = setup({ geom: rot });
    c.setTool('polyline');
    const first = P(140.25, 321.5);
    c.place(first);
    c.place(P(300, 400));
    c.place(P(320, 520));
    const r = c.resolve(rot.userToSheet(P(143, 318)));
    expect(r.snap).toBe('end');
    const u = rot.sheetToUser(r.point);
    expect(u.x).toBeCloseTo(first.x, 9);
    expect(u.y).toBeCloseTo(first.y, 9);
  });
});
