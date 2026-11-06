import { describe, expect, it } from 'vitest';
import { gridIndexRange, gridLines, snapToGrid } from './grid';
import type { SheetPoint } from './page';

/** La V2a (CP6a) com'era PRIMA dell'origine di pagina: il riferimento per dire che senza origine i risultati non cambiano di un bit. */
function snapToGridV2a(p: SheetPoint, stepPt: number, size: { width: number; height: number }, only?: 'x' | 'y'): SheetPoint {
  if (!(stepPt > 0) || !Number.isFinite(stepPt)) return p;
  const maxI = Math.floor(size.width / stepPt + 1e-9);
  const maxJ = Math.floor(size.height / stepPt + 1e-9);
  const out = { x: p.x, y: p.y };
  if (only !== 'y') {
    const i = Math.min(maxI, Math.max(0, Math.round(p.x / stepPt)));
    out.x = i * stepPt;
  }
  if (only !== 'x') {
    const j = Math.min(maxJ, Math.max(0, Math.round((size.height - p.y) / stepPt)));
    out.y = size.height - j * stepPt;
  }
  return out;
}
const gridLinesV2a = (stepPt: number, size: { width: number; height: number }) => ({ cols: Math.floor(size.width / stepPt + 1e-9) + 1, rows: Math.floor(size.height / stepPt + 1e-9) + 1 });

const rnd = (() => {
  let s = 20261106;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
})();

describe('griglia senza origine di pagina: identica alla V2a (CP6a)', () => {
  it('stessi risultati, bit per bit, su 20.000 punti casuali, passi e pagine diversi, con e senza asse bloccato (anche fuori pagina)', () => {
    for (let n = 0; n < 20000; n++) {
      const size = { width: 50 + rnd() * 1500, height: 50 + rnd() * 1500 };
      const step = [0.5, 2.8346456692913385, 5, 7.3, 28.346456692913385, 283.46456692913387, 1000][Math.floor(rnd() * 7)]!;
      const p = { x: (rnd() * 1.4 - 0.2) * size.width, y: (rnd() * 1.4 - 0.2) * size.height };
      const only = [undefined, 'x', 'y'][Math.floor(rnd() * 3)] as 'x' | 'y' | undefined;
      const a = snapToGrid(p, step, size, only);
      const b = snapToGridV2a(p, step, size, only);
      expect(Object.is(a.x, b.x) && Object.is(a.y, b.y), JSON.stringify({ p, step, size, only, a, b })).toBe(true);
      const c = snapToGrid(p, step, size, only, null);
      expect(Object.is(c.x, b.x) && Object.is(c.y, b.y)).toBe(true);
    }
  });
  it('stesso numero di linee', () => {
    for (let n = 0; n < 2000; n++) {
      const size = { width: 50 + rnd() * 1500, height: 50 + rnd() * 1500 };
      const step = 1 + rnd() * 400;
      expect(gridLines(step, size)).toEqual(gridLinesV2a(step, size));
    }
  });
});

describe('griglia con l\'origine di pagina (decisione 58): nodi in origine + k * passo, anche a sinistra e sotto, dentro la pagina', () => {
  const size = { width: 200, height: 100 };
  const step = 20;
  const origin = { x: 70, y: 30 }; // sul foglio: 70 da sinistra, 30 dall'alto (quindi 70 dal basso)

  it('gli indici dei nodi dentro la pagina', () => {
    const r = gridIndexRange(step, size, origin);
    // x = 70 + 20 i in [0, 200] -> i da -3 (10) a 6 (190); y = 30 - 20 j in [0, 100] -> j da -3 (90) a 1 (10)
    expect([r.iMin, r.iMax, r.jMin, r.jMax]).toEqual([-3, 6, -3, 1]);
    expect(gridLines(step, size, origin)).toEqual({ cols: 10, rows: 5 });
  });

  it('i nodi arrivano anche a sinistra e sotto l\'origine', () => {
    expect(snapToGrid({ x: 12, y: 88 }, step, size, undefined, origin)).toEqual({ x: 10, y: 90 }); // sinistra e sotto
    expect(snapToGrid({ x: 71, y: 29 }, step, size, undefined, origin)).toEqual({ x: 70, y: 30 }); // l'origine stessa
    expect(snapToGrid({ x: 133, y: 12 }, step, size, undefined, origin)).toEqual({ x: 130, y: 10 });
  });

  it('un asse alla volta (ORTO): l\'altro non cambia', () => {
    expect(snapToGrid({ x: 133, y: 12.5 }, step, size, 'x', origin)).toEqual({ x: 130, y: 12.5 });
    expect(snapToGrid({ x: 133, y: 12.5 }, step, size, 'y', origin)).toEqual({ x: 133, y: 10 });
  });

  it('il nodo resta dentro la pagina anche per un punto lontano o fuori', () => {
    expect(snapToGrid({ x: -500, y: 500 }, step, size, undefined, origin)).toEqual({ x: 10, y: 90 });
    expect(snapToGrid({ x: 900, y: -500 }, step, size, undefined, origin)).toEqual({ x: 190, y: 10 });
  });

  it('l\'origine sul bordo: i nodi arrivano al bordo opposto; l\'origine in basso a sinistra da\' la griglia di sempre', () => {
    const corner = { x: 0, y: size.height };
    for (let n = 0; n < 500; n++) {
      const p = { x: rnd() * 220 - 10, y: rnd() * 120 - 10 };
      expect(snapToGrid(p, step, size, undefined, corner)).toEqual(snapToGrid(p, step, size));
    }
    const right = { x: 200, y: 0 };
    expect(snapToGrid({ x: 3, y: 97 }, step, size, undefined, right)).toEqual({ x: 0, y: 100 }); // 200 - 10 passi = 0, 0 - (-5) passi = 100
  });

  it('passo piu\' grande della pagina: se nessun nodo sta nella pagina in una direzione quella coordinata non cambia; altrimenti il nodo e\' dentro', () => {
    const o = { x: 150, y: 50 };
    const big = 300; // x = 150 + 300 i: nessun nodo in [0, 200] tranne i = 0 (150); y = 50 - 300 j: j = 0 (50)
    expect(snapToGrid({ x: 30, y: 70 }, big, size, undefined, o)).toEqual({ x: 150, y: 50 });
    // origine fuori pagina (file ostile o pagina di dimensioni cambiate): nessun nodo in x
    const far = { x: -500, y: 50 };
    const r = gridIndexRange(700, size, far);
    expect([r.iMin, r.iMax]).toEqual([1, 1]); // un solo nodo in x, a 200 (bordo destro)
    const q = snapToGrid({ x: 33.3, y: 70 }, 700, size, undefined, far); // x = -500 + 700 i: i = 1 -> 200 (sul bordo, dentro)
    expect(q.x).toBe(200);
    const none = snapToGrid({ x: 33.3, y: 70 }, 900, size, undefined, { x: -1000, y: 50 }); // x = -1000 + 900 i: -100, 800: nessuno in [0, 200]
    expect(none.x).toBe(33.3);
    expect(gridLines(900, size, { x: -1000, y: 50 }).cols).toBe(0);
  });

  it('ogni nodo restituito sta nella pagina e a un multiplo intero del passo dall\'origine (1000 punti casuali)', () => {
    for (let n = 0; n < 1000; n++) {
      const sz = { width: 100 + rnd() * 800, height: 100 + rnd() * 800 };
      const st = 5 + rnd() * 100;
      const o = { x: rnd() * sz.width, y: rnd() * sz.height };
      const p = { x: rnd() * sz.width, y: rnd() * sz.height };
      const q = snapToGrid(p, st, sz, undefined, o);
      expect(q.x).toBeGreaterThanOrEqual(-1e-9);
      expect(q.x).toBeLessThanOrEqual(sz.width + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(-1e-9);
      expect(q.y).toBeLessThanOrEqual(sz.height + 1e-9);
      const ki = (q.x - o.x) / st;
      const kj = (o.y - q.y) / st;
      expect(Math.abs(ki - Math.round(ki))).toBeLessThan(1e-9);
      expect(Math.abs(kj - Math.round(kj))).toBeLessThan(1e-9);
      // ed e' il nodo piu' vicino: i nodi adiacenti che stanno nella pagina non sono piu' vicini (lungo ogni asse)
      for (const d of [-1, 1]) {
        const nx = q.x + d * st;
        if (nx >= 0 && nx <= sz.width) expect(Math.abs(nx - p.x)).toBeGreaterThanOrEqual(Math.abs(q.x - p.x) - 1e-9);
        const ny = q.y + d * st;
        if (ny >= 0 && ny <= sz.height) expect(Math.abs(ny - p.y)).toBeGreaterThanOrEqual(Math.abs(q.y - p.y) - 1e-9);
      }
    }
  });
});
