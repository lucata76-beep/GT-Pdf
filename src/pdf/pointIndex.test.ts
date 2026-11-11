// Prove dell'indice spaziale dei punti di snap del PDF (src/pdf/pointIndex.ts). Il requisito e' uno: il risultato dell'indice e' IDENTICO alla scansione lineare dei punti
// (`scanNear`, la definizione), quindi le prove sono differenziali: stessa SEQUENZA di punti emessi (valori, tipi e ORDINE: nei pareggi conta, vedi la testata del modulo) per almeno
// 10.000 interrogazioni casuali, per le interrogazioni sui bordi delle celle e a distanza esatta dal raggio (terne pitagoriche: dx^2 + dy^2 = r^2 senza errori di arrotondamento),
// per punti identici, per fogli con molte celle e per i casi vuoti. Generatore pseudo-casuale con seme fisso: nessun risultato dipende dall'esecuzione.
import { describe, expect, it } from 'vitest';
import { GRID_CELL_PT, GRID_MAX_CELLS, PointGrid, scanNear } from './pointIndex';
import type { SnapPoints } from './snapPoints';

type P = [number, number];
type Hit = [number, number, string];
const ZERO_STATS = { segments: 0, hiddenSegments: 0, tinySegments: 0, outsidePoints: 0, mergedEnd: 0, mergedMid: 0 };
function makePoints(ends: P[], mids: P[], width: number, height: number): SnapPoints {
  const xy = new Float64Array((ends.length + mids.length) * 2);
  [...ends, ...mids].forEach((p, i) => {
    xy[2 * i] = p[0];
    xy[2 * i + 1] = p[1];
  });
  return { width, height, xy, nEnd: ends.length, nMid: mids.length, stats: { ...ZERO_STATS }, bytes: xy.byteLength };
}
/** Generatore pseudo-casuale con seme (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const viaGrid = (g: PointGrid, x: number, y: number, r: number, end: boolean, mid: boolean): Hit[] => {
  const out: Hit[] = [];
  g.forEachNear(x, y, r, end, mid, (px, py, k) => out.push([px, py, k]));
  return out;
};
const viaScan = (p: SnapPoints, x: number, y: number, r: number, end: boolean, mid: boolean): Hit[] => {
  const out: Hit[] = [];
  scanNear(p, x, y, r, end, mid, (px, py, k) => out.push([px, py, k]));
  return out;
};
/** Confronta indice e scansione su un insieme di interrogazioni; restituisce quante hanno dato almeno un punto (la prova non deve essere vuota). */
function compareAll(p: SnapPoints, g: PointGrid, queries: { x: number; y: number; r: number; end: boolean; mid: boolean }[]): number {
  let nonEmpty = 0;
  for (const q of queries) {
    const a = viaGrid(g, q.x, q.y, q.r, q.end, q.mid);
    const b = viaScan(p, q.x, q.y, q.r, q.end, q.mid);
    if (JSON.stringify(a) !== JSON.stringify(b)) expect(a, `interrogazione ${JSON.stringify(q)}`).toEqual(b);
    if (a.length) nonEmpty++;
  }
  return nonEmpty;
}
const FLAGS: [boolean, boolean][] = [[true, true], [true, false], [false, true], [false, false]];

describe('differenziale: indice contro scansione lineare', () => {
  it('20.000 interrogazioni casuali su un foglio A4 con 5.000 Estremi e 3.000 Punti medi (raggi da 0.3 a 40 pt, tutte le combinazioni di tipi, anche fuori dal foglio)', () => {
    const r = rng(1);
    const W = 595.276;
    const H = 841.89;
    const ends: P[] = Array.from({ length: 5000 }, () => [r() * W, r() * H]);
    const mids: P[] = Array.from({ length: 3000 }, () => [r() * W, r() * H]);
    const p = makePoints(ends, mids, W, H);
    const g = new PointGrid(p);
    const radii = [0.3, 1, 2.5, 7.5, 16, 40];
    const qs = Array.from({ length: 20000 }, (_, i) => {
      const f = FLAGS[i % 4]!;
      return { x: -30 + r() * (W + 60), y: -30 + r() * (H + 60), r: radii[i % radii.length]!, end: f[0], mid: f[1] };
    });
    const nonEmpty = compareAll(p, g, qs);
    expect(nonEmpty).toBeGreaterThan(3000); // la prova non e' vuota: molte interrogazioni trovano punti
  });

  it('punti addensati (cluster) e punti identici: stessa sequenza, anche nei pareggi (ordine dell\'array)', () => {
    const r = rng(2);
    const W = 1190.551;
    const H = 841.89;
    const centers: P[] = Array.from({ length: 40 }, () => [r() * W, r() * H]);
    const ends: P[] = [];
    const mids: P[] = [];
    for (let i = 0; i < 6000; i++) {
      const c = centers[Math.floor(r() * centers.length)]!;
      ends.push([Math.min(W, Math.max(0, c[0] + (r() - 0.5) * 6)), Math.min(H, Math.max(0, c[1] + (r() - 0.5) * 6))]);
      if (i % 2 === 0) mids.push(r() < 0.5 ? c : [Math.min(W, Math.max(0, c[0] + (r() - 0.5) * 6)), Math.min(H, Math.max(0, c[1] + (r() - 0.5) * 6))]);
    }
    for (let k = 0; k < 30; k++) ends.push([centers[0]![0], centers[0]![1]]); // 30 copie dello stesso punto
    const p = makePoints(ends, mids, W, H);
    const g = new PointGrid(p);
    const qs = Array.from({ length: 12000 }, (_, i) => {
      const c = centers[i % centers.length]!;
      const f = FLAGS[i % 3]!;
      return { x: c[0] + (r() - 0.5) * 8, y: c[1] + (r() - 0.5) * 8, r: [1, 4, 10][i % 3]!, end: f[0], mid: f[1] };
    });
    expect(compareAll(p, g, qs)).toBeGreaterThan(8000);
  });

  it('punti sui bordi delle celle (multipli del lato) e interrogazioni sui bordi e a distanza ESATTA dal raggio (terne pitagoriche): bordo compreso', () => {
    const W = 400;
    const H = 320;
    const c = GRID_CELL_PT;
    const ends: P[] = [];
    const mids: P[] = [];
    for (let x = 0; x <= W; x += c) for (let y = 0; y <= H; y += c) (((x + y) / c) % 2 === 0 ? ends : mids).push([x, y]);
    ends.push([W, H], [0, 0], [W, 0], [0, H]);
    const p = makePoints(ends, mids, W, H);
    const g = new PointGrid(p);
    expect(g.cellPt).toBe(c);
    const triples: [number, number, number][] = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [0, 5, 5], [7, 24, 25], [20, 21, 29]];
    const qs: { x: number; y: number; r: number; end: boolean; mid: boolean }[] = [];
    for (let x = 0; x <= W; x += c) {
      for (let y = 0; y <= H; y += c) {
        for (const [a, b, rr] of triples) {
          for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) qs.push({ x: x + sx! * a, y: y + sy! * b, r: rr, end: true, mid: true });
        }
        qs.push({ x, y, r: c, end: true, mid: true }); // sul bordo, raggio uguale al lato
        qs.push({ x, y, r: c / 2, end: true, mid: false });
      }
    }
    const nonEmpty = compareAll(p, g, qs);
    expect(qs.length).toBeGreaterThan(10000);
    expect(nonEmpty).toBeGreaterThan(qs.length / 2);
    // a distanza esatta: il punto (0, 0) e il centro (3, 4) con r = 5: c'e' (bordo compreso); con r appena sotto: no
    const only: SnapPoints = makePoints([[0, 0]], [], 100, 100);
    const go = new PointGrid(only);
    expect(viaGrid(go, 3, 4, 5, true, true)).toEqual([[0, 0, 'end']]);
    expect(viaGrid(go, 3, 4, 5 - 1e-9, true, true)).toEqual([]);
    expect(viaScan(only, 3, 4, 5, true, true)).toEqual([[0, 0, 'end']]);
  });

  it('punti sul bordo del foglio e fogli con dimensioni non multiple della cella', () => {
    const W = 595.276;
    const H = 841.89;
    const ends: P[] = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2], [W - 1e-9, H - 1e-9]];
    const p = makePoints(ends, [[W, H], [0, 0]], W, H);
    const g = new PointGrid(p);
    const r = rng(3);
    const qs = Array.from({ length: 5000 }, (_, i) => ({ x: [0, W, W / 2][i % 3]! + (r() - 0.5) * 20, y: [0, H, H / 2][(i >> 1) % 3]! + (r() - 0.5) * 20, r: [2, 6, 12][i % 3]!, end: true, mid: i % 2 === 0 }));
    expect(compareAll(p, g, qs)).toBeGreaterThan(1000);
  });

  it('interrogazioni tutte fuori dal foglio, raggio enorme (tutti i punti, nell\'ordine dell\'array), raggio nullo o non valido: come la scansione', () => {
    const r = rng(4);
    const W = 300;
    const H = 200;
    const ends: P[] = Array.from({ length: 300 }, () => [r() * W, r() * H]);
    const mids: P[] = Array.from({ length: 200 }, () => [r() * W, r() * H]);
    const p = makePoints(ends, mids, W, H);
    const g = new PointGrid(p);
    const outside = [[-50, -50], [W + 50, H + 50], [-1000, 100], [100, 5000], [W + 3, 100]].flatMap(([x, y]) => [1, 5, 20].map((rad) => ({ x: x!, y: y!, r: rad, end: true, mid: true })));
    compareAll(p, g, outside);
    expect(viaGrid(g, 150, 100, 1e6, true, true)).toHaveLength(500);
    compareAll(p, g, [{ x: 150, y: 100, r: 1e6, end: true, mid: true }, { x: 150, y: 100, r: 1e9, end: false, mid: true }]);
    for (const bad of [0, -1, Number.NaN]) {
      expect(viaGrid(g, 150, 100, bad, true, true)).toEqual([]);
      expect(viaScan(p, 150, 100, bad, true, true)).toEqual([]);
    }
    expect(viaGrid(g, 150, 100, 50, false, false)).toEqual([]);
    // i punti del raggio enorme sono emessi per indice crescente: prima tutti gli Estremi, poi i Punti medi
    const kinds = viaGrid(g, 150, 100, 1e6, true, true).map((h) => h[2]);
    expect(kinds.slice(0, 300).every((k) => k === 'end')).toBe(true);
    expect(kinds.slice(300).every((k) => k === 'mid')).toBe(true);
  });

  it('casi vuoti e minimi: nessun punto, un solo punto, solo Punti medi', () => {
    const empty = makePoints([], [], 595, 842);
    const ge = new PointGrid(empty);
    expect(viaGrid(ge, 10, 10, 50, true, true)).toEqual([]);
    expect(ge.nPoints).toBe(0);
    const one = makePoints([], [[10, 10]], 595, 842);
    const go = new PointGrid(one);
    expect(viaGrid(go, 12, 10, 3, true, true)).toEqual([[10, 10, 'mid']]);
    expect(viaGrid(go, 12, 10, 3, true, false)).toEqual([]);
    expect(go.nEnd).toBe(0);
    expect(go.nMid).toBe(1);
  });

  it('foglio enorme: le celle si ingrandiscono per non superare GRID_MAX_CELLS e l\'indice resta identico alla scansione', () => {
    const W = 20000; // 14400 x 14400 (200 pollici) con celle da 8 pt darebbe 3.2 milioni di celle: sotto il massimo; con UserUnit grandi il foglio puo' superarlo
    const H = 20000;
    const r = rng(5);
    const ends: P[] = Array.from({ length: 4000 }, () => [r() * W, r() * H]);
    const p = makePoints(ends, [], W, H);
    const g = new PointGrid(p);
    expect(g.nx * g.ny).toBeLessThanOrEqual(GRID_MAX_CELLS);
    expect(g.cellPt).toBeGreaterThan(GRID_CELL_PT);
    const qs = Array.from({ length: 3000 }, (_, i) => {
      const c = ends[i % ends.length]!;
      return { x: c[0] + (r() - 0.5) * 30, y: c[1] + (r() - 0.5) * 30, r: [3, 10, 25][i % 3]!, end: true, mid: true };
    });
    expect(compareAll(p, g, qs)).toBeGreaterThan(1000);
  });

  it('lato delle celle diverso (2, 3.7, 8, 31 pt): sempre lo stesso risultato', () => {
    const r = rng(6);
    const W = 595.276;
    const H = 841.89;
    const ends: P[] = Array.from({ length: 1500 }, () => [r() * W, r() * H]);
    const mids: P[] = Array.from({ length: 1500 }, () => [r() * W, r() * H]);
    const p = makePoints(ends, mids, W, H);
    const qs = Array.from({ length: 3000 }, (_, i) => ({ x: r() * W, y: r() * H, r: [1, 7.5, 22][i % 3]!, end: true, mid: i % 5 !== 0 }));
    for (const c of [2, 3.7, 8, 31]) {
      const g = new PointGrid(p, c);
      expect(g.cellPt).toBe(c);
      compareAll(p, g, qs);
    }
  });
});

describe('struttura e costo', () => {
  it('struttura: celle sul foglio, offset e indici in Uint32, byte dichiarati', () => {
    const W = 595.276;
    const H = 841.89;
    const p = makePoints([[1, 1], [2, 2]], [[3, 3]], W, H);
    const g = new PointGrid(p);
    expect(g.cellPt).toBe(8);
    expect(g.nx).toBe(Math.ceil(W / 8));
    expect(g.ny).toBe(Math.ceil(H / 8));
    expect(g.bytes).toBe((g.nx * g.ny + 1) * 4 + 3 * 4);
    expect(g.points).toBe(p);
  });

  it('300.000 punti: costruzione veloce e interrogazioni identiche (campione)', () => {
    const r = rng(7);
    const W = 595.276;
    const H = 841.89;
    const ends: P[] = Array.from({ length: 200000 }, () => [r() * W, r() * H]);
    const mids: P[] = Array.from({ length: 100000 }, () => [r() * W, r() * H]);
    const p = makePoints(ends, mids, W, H);
    const t0 = performance.now();
    const g = new PointGrid(p);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
    const qs = Array.from({ length: 300 }, () => ({ x: r() * W, y: r() * H, r: 7.5, end: true, mid: true }));
    expect(compareAll(p, g, qs)).toBeGreaterThan(250);
  });
});
