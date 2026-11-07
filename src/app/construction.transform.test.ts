// Strumenti Sposta, Specchio e Rotazione di Construction (CP6e): i punti si indicano come ogni altro (snap, griglia, ORTO sul secondo punto), non si rifiutano con i 6 px.
import { describe, expect, it } from 'vitest';
import { PageGeometry, type SheetPoint, type UserPoint } from '../geometry/page';
import { Construction, type ConstructionEnv, type ConstructionEvents, type TransformTool, isTransformTool } from './construction';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const P = (x: number, y: number): UserPoint => ({ x, y });

function setup(opts: { geom?: PageGeometry; ortho?: boolean; accept?: boolean; snap?: ConstructionEnv['snap']; zoom?: number } = {}) {
  const calls: { kind: TransformTool; points: UserPoint[] }[] = [];
  const rejects: string[] = [];
  const state = { ortho: opts.ortho ?? false, accept: opts.accept ?? true };
  const ev: ConstructionEvents = {
    line: () => undefined,
    calibrate: () => undefined,
    measure: () => undefined,
    text: () => undefined,
    dimension: () => undefined,
    cover: () => undefined,
    curve: () => undefined,
    origin: () => undefined,
    reject: (r) => rejects.push(r),
    transform: (kind, points) => {
      calls.push({ kind, points });
      return state.accept;
    },
  };
  const c = new Construction({ geometry: () => opts.geom ?? flat, zoom: () => opts.zoom ?? 1, ortho: () => state.ortho, snap: opts.snap }, ev);
  return { c, calls, rejects, state };
}

describe('Sposta e Specchio: due punti', () => {
  for (const tool of ['move', 'mirror'] as const) {
    it(`${tool}: servono 2 punti; al secondo l'app e' avvisata e la costruzione si azzera`, () => {
      const { c, calls } = setup();
      c.setTool(tool);
      expect(c.needed).toBe(2);
      expect(isTransformTool(c.tool)).toBe(true);
      c.place(P(100, 100));
      expect(c.pending).toBe(true);
      expect(calls).toHaveLength(0);
      c.place(P(180, 140));
      expect(calls).toEqual([{ kind: tool, points: [P(100, 100), P(180, 140)] }]);
      expect(c.points).toEqual([]);
      expect(c.pending).toBe(false);
    });
    it(`${tool}: due punti vicini (sotto i 6 px di place) NON si rifiutano qui: decide l'app con la soglia in pt`, () => {
      const { c, calls, rejects } = setup({ zoom: 1 });
      c.setTool(tool);
      c.place(P(100, 100));
      c.place(P(102, 100)); // 2 px
      expect(rejects).toEqual([]);
      expect(calls).toHaveLength(1);
    });
    it(`${tool}: se l'app non accetta, il primo punto resta e si sceglie un altro secondo punto`, () => {
      const { c, calls, state } = setup({ accept: false });
      c.setTool(tool);
      c.place(P(100, 100));
      c.place(P(180, 140));
      expect(calls).toHaveLength(1);
      expect(c.points).toEqual([P(100, 100)]);
      expect(c.pending).toBe(true);
      state.accept = true;
      c.place(P(300, 300));
      expect(calls).toHaveLength(2);
      expect(calls[1]?.points).toEqual([P(100, 100), P(300, 300)]);
    });
    it(`${tool}: ORTO sul secondo punto (rispetto al primo), non sul primo`, () => {
      const { c } = setup({ ortho: true });
      c.setTool(tool);
      const first = c.resolve({ x: 123.4, y: 200.6 });
      expect(first.point).toEqual({ x: 123.4, y: 200.6 });
      c.place(flat.sheetToUser({ x: 100, y: 200 }));
      const second = c.resolve({ x: 180, y: 203 }); // piu' lontano in orizzontale: orizzontale
      expect(second.point).toEqual({ x: 180, y: 200 });
      const third = c.resolve({ x: 103, y: 260 });
      expect(third.point).toEqual({ x: 100, y: 260 });
    });
    it(`${tool}: Ctrl+Z (undoLast) toglie l'ultimo punto indicato`, () => {
      const { c } = setup();
      c.setTool(tool);
      expect(c.undoLast()).toBe(false);
      c.place(P(100, 100));
      expect(c.undoLast()).toBe(true);
      expect(c.points).toEqual([]);
    });
    it(`${tool}: lo snap vale per ogni punto e il primo punto e' candidato del secondo`, () => {
      const seen: number[] = [];
      const { c } = setup({
        snap: (_raw: SheetPoint, _t, pending) => {
          seen.push(pending.length);
          return null;
        },
      });
      c.setTool(tool);
      c.resolve({ x: 10, y: 10 });
      c.place(P(100, 100));
      c.resolve({ x: 20, y: 20 });
      expect(seen).toEqual([0, 1]);
    });
  }
  it('i testi guida (una riga)', () => {
    const { c } = setup();
    c.setTool('move');
    expect(c.prompt).toBe('Sposta: indica il punto base');
    c.place(P(1, 1));
    expect(c.prompt).toBe('Sposta: indica il punto di arrivo');
    c.setTool('mirror');
    expect(c.prompt).toBe('Specchio: indica il primo punto dell\'asse');
    c.place(P(1, 1));
    expect(c.prompt).toBe('Specchio: indica il secondo punto dell\'asse');
  });
  it('funziona anche con /Rotate 90 e CropBox: i punti restano nello spazio utente', () => {
    const { c, calls } = setup({ geom: rot });
    c.setTool('move');
    c.place(P(100, 200));
    c.place(P(120, 260));
    expect(calls[0]?.points).toEqual([P(100, 200), P(120, 260)]);
  });
});

describe('Rotazione: il centro e poi l\'angolo digitato', () => {
  it('1 punto: il centro resta in costruzione; un nuovo clic lo sostituisce', () => {
    const { c, calls } = setup();
    c.setTool('rotate');
    expect(c.needed).toBe(1);
    c.place(P(100, 100));
    expect(calls).toEqual([{ kind: 'rotate', points: [P(100, 100)] }]);
    expect(c.points).toEqual([P(100, 100)]);
    expect(c.pending).toBe(true);
    c.place(P(300, 400));
    expect(c.points).toEqual([P(300, 400)]);
    expect(calls).toHaveLength(2);
    expect(c.prompt).toMatch(/digita l'angolo/);
  });
  it('Ctrl+Z toglie il centro; il centro non ha ORTO', () => {
    const { c } = setup({ ortho: true });
    c.setTool('rotate');
    expect(c.anchor).toBeNull();
    c.place(P(100, 100));
    expect(c.anchor).toBeNull();
    expect(c.resolve({ x: 123.4, y: 200.6 }).point).toEqual({ x: 123.4, y: 200.6 });
    expect(c.undoLast()).toBe(true);
    expect(c.pending).toBe(false);
    expect(c.prompt).toBe('Rotazione: indica il centro');
  });
  it('senza il gestore dell\'evento (facoltativo) non succede nulla di strano', () => {
    const c = new Construction({ geometry: () => flat, zoom: () => 1, ortho: () => false }, { line: () => undefined, calibrate: () => undefined, measure: () => undefined, text: () => undefined, dimension: () => undefined, cover: () => undefined, curve: () => undefined, origin: () => undefined, reject: () => undefined });
    c.setTool('move');
    c.place(P(1, 1));
    c.place(P(50, 50));
    expect(c.points).toEqual([]);
  });
});
