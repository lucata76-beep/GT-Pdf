// Prove unitarie della scena dei tratti del PDF e del suo indice (src/pdf/segmentIndex.ts, CP7d), in Node, senza PDF.js: geometrie costruite a mano (`lineGeometry`).
// Valori attesi NON presi dal codice provato: il ritaglio sul foglio e' ricalcolato qui con un'altra via (intervalli di parametro per asse); il risultato dell'indice e' confrontato con la
// scansione lineare `scanSegmentsNear` (la DEFINIZIONE del risultato) su 10.000 interrogazioni casuali piu' i casi ai bordi di cella, del raggio e del foglio.
import { describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { PDF_MAX_NEAR, segmentNearPoint } from '../geometry/snapExtra';
import { type Seg, lineGeometry, rng } from './segmentTestUtils';
import { BYTES_PER_SEGMENT, SEGMENT_GRID_CELL_PT, SEGMENT_GRID_MAX_CELL_PT, SegmentGrid, buildSegmentScene, scanSegmentsNear } from './segmentIndex';
import { MIN_SEGMENT_PT, PAGE_MARGIN_PT, type SheetMap, buildSnapPoints } from './snapPoints';

/** Foglio di prova senza conversione (utente = foglio): 600 x 800 pt. */
const flat: SheetMap = { width: 600, height: 800, userToSheet: (p) => ({ x: p.x, y: p.y }) };
type Row = [number, number, number, number, number, number];
const collect = (src: Pick<SegmentGrid, 'forEachNear'>, x: number, y: number, r: number, max = 1e9): { ok: boolean; rows: Row[] } => {
  const rows: Row[] = [];
  const ok = src.forEachNear(x, y, r, max, (id, path, a, b, c, d) => rows.push([id, path, a, b, c, d]));
  return { ok, rows };
};
const gridOf = (segs: Seg[], sheet: SheetMap = flat, opts = {}): SegmentGrid => {
  const { grid } = buildSegmentScene(lineGeometry(segs), sheet, opts);
  if (!grid) throw new Error('scena assente');
  return grid;
};
const segsOf = (g: SegmentGrid): Seg[] => Array.from({ length: g.n }, (_, i) => [g.xy[4 * i]!, g.xy[4 * i + 1]!, g.xy[4 * i + 2]!, g.xy[4 * i + 3]!]);

describe('costruzione: quali tratti entrano', () => {
  it('un tratto dentro il foglio resta com\'e\': gli estremi sono UGUALI AL BIT a quelli dei punti Estremo di CP7b', () => {
    const geom = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
    const segs: Seg[] = [[100.123, 200.456, 300.789, 400.321], [10, 10, 590, 10], [50, 700, 50, 20]];
    const g = lineGeometry(segs);
    const { grid, stats } = buildSegmentScene(g, geom);
    expect(stats.kept).toBe(3);
    expect(grid?.n).toBe(3);
    const pts = buildSnapPoints(g, geom);
    const ends = new Set<string>();
    for (let i = 0; i < pts.nEnd; i++) ends.add(`${pts.xy[2 * i]},${pts.xy[2 * i + 1]}`);
    for (let i = 0; i < 3; i++) {
      expect(ends.has(`${grid!.xy[4 * i]},${grid!.xy[4 * i + 1]}`)).toBe(true);
      expect(ends.has(`${grid!.xy[4 * i + 2]},${grid!.xy[4 * i + 3]}`)).toBe(true);
    }
  });

  it('un livello spento non da\' tratti; i percorsi visibili si', () => {
    const g = lineGeometry([[10, 10, 100, 10], [10, 20, 100, 20], [10, 30, 100, 30]], { path: [0, 1, 2], visible: [true, false, true] });
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(stats).toMatchObject({ segments: 3, hidden: 1, kept: 2, tiny: 0, outside: 0, clipped: 0 });
    expect(segsOf(grid!).map((s) => s[1])).toEqual([10, 30]);
    expect(Array.from(grid!.path)).toEqual([0, 2]); // l'indice del percorso resta quello del PDF
  });

  it('un tratto sotto MIN_SEGMENT_PT (pt del foglio) e\' fuori dalla scena; a MIN_SEGMENT_PT esatti no', () => {
    const g = lineGeometry([[10, 10, 10 + MIN_SEGMENT_PT / 2, 10], [20, 20, 20 + MIN_SEGMENT_PT * 1.5, 20], [30, 30, 30, 30]]);
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(stats).toMatchObject({ tiny: 2, kept: 1 });
    expect(segsOf(grid!)[0]![0]).toBeCloseTo(20, 5);
  });

  it('UserUnit 2.5: la soglia e\' in pt FISICI del foglio (0.005 unita\' = 0.0125 pt: resta; 0.003 unita\' = 0.0075 pt: fuori)', () => {
    const geom = new PageGeometry({ view: [0, 0, 400, 500], rotate: 0, userUnit: 2.5 });
    const g = lineGeometry([[100, 100, 100.005, 100], [100, 200, 100.003, 200]]);
    const { stats } = buildSegmentScene(g, geom);
    expect(stats).toMatchObject({ tiny: 1, kept: 1 });
  });

  it('pagina senza tratti: nessuna scena e nessuna eccezione', () => {
    const { grid, stats } = buildSegmentScene(lineGeometry([]), flat);
    expect(grid).toBeNull();
    expect(stats).toMatchObject({ segments: 0, kept: 0, dense: false, refs: 0 });
  });
});

describe('ritaglio sul foglio', () => {
  /** Il pezzo del tratto dentro [0, w] x [0, h] con intervalli di parametro per asse (via diversa da Liang-Barsky), o null. */
  function insidePiece(s: Seg, w: number, h: number): Seg | null {
    const [x1, y1, x2, y2] = s;
    let lo = 0;
    let hi = 1;
    const axis = (p0: number, d: number, max: number): boolean => {
      if (d === 0) return p0 >= 0 && p0 <= max;
      const a = (0 - p0) / d;
      const b = (max - p0) / d;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      return true;
    };
    if (!axis(x1, x2 - x1, w) || !axis(y1, y2 - y1, h) || lo > hi) return null;
    return [x1 + lo * (x2 - x1), y1 + lo * (y2 - y1), x1 + hi * (x2 - x1), y1 + hi * (y2 - y1)];
  }
  it('un tratto che esce dal foglio si ritaglia sul bordo; il resto e\' identico al calcolo indipendente (entro 1e-9)', () => {
    const rand = rng(7);
    const segs: Seg[] = [];
    for (let i = 0; i < 400; i++) segs.push([rand() * 900 - 150, rand() * 1100 - 150, rand() * 900 - 150, rand() * 1100 - 150]);
    const g = lineGeometry(segs);
    const { grid, stats } = buildSegmentScene(g, flat);
    const f32 = (s: Seg): Seg => Array.from(new Float32Array(s)) as Seg;
    let kept = 0;
    const got = grid ? segsOf(grid) : [];
    for (const s of segs) {
      const t = f32(s);
      if (Math.hypot(t[2] - t[0], t[3] - t[1]) < MIN_SEGMENT_PT) continue;
      const want = insidePiece(t, 600, 800);
      if (!want || Math.hypot(want[2] - want[0], want[3] - want[1]) < MIN_SEGMENT_PT) continue;
      const hit = got[kept++]!;
      for (let k = 0; k < 4; k++) expect(Math.abs(hit[k]! - want[k]!)).toBeLessThan(1e-9);
    }
    expect(stats.kept).toBe(kept);
    expect(stats.clipped).toBeGreaterThan(50);
    expect(stats.outside).toBeGreaterThan(5);
    expect(stats.kept + stats.outside + stats.tiny + stats.hidden).toBe(stats.segments);
  });

  it('tutti i tratti della scena stanno dentro il foglio (estremi compresi) e gli estremi ritagliati stanno sul bordo', () => {
    const g = lineGeometry([[-100, 400, 700, 400], [300, -50, 300, 900], [-10, -10, 610, 810], [500, 700, 650, 850]]);
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(stats).toMatchObject({ kept: 4, clipped: 4, outside: 0 });
    const onBorder = (x: number, y: number): boolean => x === 0 || x === 600 || y === 0 || y === 800;
    for (const [x1, y1, x2, y2] of segsOf(grid!)) {
      for (const [x, y] of [[x1, y1], [x2, y2]] as const) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(600);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(800);
      }
      expect(onBorder(x1, y1) || onBorder(x2, y2)).toBe(true); // almeno un estremo e' stato portato sul bordo
    }
    const last = segsOf(grid!)[3]!; // [500, 700, 650, 850]: l'estremo interno resta dov'era (Float32 di 500 e 700 sono esatti)
    expect([last[0], last[1]]).toEqual([500, 700]);
  });

  it('tratto tutto fuori: scartato (anche se il suo riquadro tocca il foglio); parallelo al bordo e fuori: scartato', () => {
    const g = lineGeometry([[-50, 100, -10, 700], [610, 5, 700, 5], [-1, 900, 2000, 900], [-20, -20, 5, -2], [100, -1, 400, -1]]);
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(grid).toBeNull();
    expect(stats).toMatchObject({ segments: 5, outside: 5, kept: 0 });
  });

  it('margine: estremi entro PAGE_MARGIN_PT dal bordo si riportano sul bordo (come i punti); oltre il margine il tratto orizzontale e\' fuori', () => {
    const half = PAGE_MARGIN_PT / 2;
    const g = lineGeometry([[100, -half, 300, -half], [-half, 50, -half, 400], [100, -PAGE_MARGIN_PT * 3, 300, -PAGE_MARGIN_PT * 3]]);
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(stats).toMatchObject({ kept: 2, outside: 1 });
    const s = segsOf(grid!);
    expect(s[0]![1]).toBe(0);
    expect(s[0]![3]).toBe(0);
    expect(s[1]![0]).toBe(0);
    expect(s[1]![2]).toBe(0);
  });

  it('un tratto ritagliato che resta sotto MIN_SEGMENT_PT e\' scartato', () => {
    const g = lineGeometry([[-5, 100, 0.004, 100]]);
    const { grid, stats } = buildSegmentScene(g, flat);
    expect(grid).toBeNull();
    expect(stats.outside).toBe(1);
  });
});

describe('indice: stesso risultato della scansione lineare (differenziale)', () => {
  const W = flat.width;
  const H = flat.height;
  /** Una scena con ogni tipo di tratto difficile: corti, lunghi, orizzontali e verticali sui confini di cella, diagonali per gli angoli di cella, sul bordo del foglio, quasi paralleli. */
  function hardSegments(): Seg[] {
    const rand = rng(12345);
    const segs: Seg[] = [];
    // casuali di varie lunghezze
    for (let i = 0; i < 1500; i++) {
      const len = [1, 4, 12, 40, 150, 600][Math.floor(rand() * 6)]!;
      const x = rand() * W;
      const y = rand() * H;
      const a = rand() * Math.PI * 2;
      segs.push([x, y, x + Math.cos(a) * len, y + Math.sin(a) * len]);
    }
    // orizzontali e verticali ESATTAMENTE sui confini delle celle (multipli di 8)
    for (let k = 1; k < 20; k++) {
      segs.push([8 * k * 2, 8 * k, 8 * k * 2 + 90, 8 * k]);
      segs.push([8 * k, 8 * k * 3, 8 * k, 8 * k * 3 + 120]);
    }
    // sul bordo stesso del foglio e lunghi quanto il foglio
    segs.push([0, 0, W, 0], [0, H, W, H], [0, 0, 0, H], [W, 0, W, H]);
    segs.push([0, 400, W, 400], [300, 0, 300, H]);
    // diagonali che passano per gli angoli delle celle
    segs.push([0, 0, 592, 592], [8, 8, 8 + 80, 8 + 80], [16, 400, 16 + 160, 400 - 160], [0, 800, 400, 400]);
    // tratti appena sopra la soglia e poco piu' lunghi, anche a cavallo di un confine di cella
    segs.push([7.99, 100, 8.02, 100], [15.999, 50, 16.012, 50.001], [64, 64, 64.011, 64]);
    // quasi paralleli (stessi punti di partenza)
    for (let i = 0; i < 30; i++) segs.push([300, 300, 500, 300 + i * 0.001]);
    return segs;
  }
  const radii = [0.4, 3, 7.5, 10, 22, 45];

  it('10.000 interrogazioni casuali (raggi, max e posizioni anche fuori dal foglio): sequenza identica, id compresi', () => {
    const grid = gridOf(hardSegments());
    expect(grid.cellPt).toBe(SEGMENT_GRID_CELL_PT);
    const rand = rng(99);
    let nonEmpty = 0;
    let overflow = 0;
    for (let q = 0; q < 10000; q++) {
      const x = rand() * (W + 60) - 30;
      const y = rand() * (H + 60) - 30;
      const r = radii[Math.floor(rand() * radii.length)]!;
      const max = [2, 5, 256, 1e9][Math.floor(rand() * 4)]!;
      const a = collect(grid, x, y, r, max);
      const rows: Row[] = [];
      const ok = scanSegmentsNear(grid.xy, grid.path, grid.n, x, y, r, max, (id, path, p, q2, c, d) => rows.push([id, path, p, q2, c, d]));
      expect(a.ok).toBe(ok);
      expect(a.rows).toEqual(rows);
      if (rows.length) nonEmpty++;
      if (!ok) overflow++;
    }
    expect(nonEmpty).toBeGreaterThan(3000);
    expect(overflow).toBeGreaterThan(100); // la prova coglie anche il caso «troppi vicini»
  }, 60000);

  it('casi ai bordi: cursore su confini di cella, a distanza ESATTAMENTE uguale al raggio (e di 1e-12, 1e-9, 1e-6 in piu\' o in meno), agli estremi, ai bordi del foglio', () => {
    const segs = hardSegments();
    const grid = gridOf(segs);
    const queries: [number, number, number][] = [];
    const eps = [0, 1e-12, -1e-12, 1e-9, -1e-9, 1e-6, -1e-6];
    // tutti i tratti speciali (dall'indice 1500: confini di cella, bordo del foglio, diagonali, soglia, quasi paralleli) e uno ogni 15 dei casuali
    const picked = segs.filter((_, i) => i >= 1500 || i % 15 === 0);
    for (const r of [7.5, 8, 10]) {
      for (const s of picked) {
        const [x1, y1, x2, y2] = s;
        for (const [px, py] of [[x1, y1], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]] as const) {
          for (const e of eps) {
            queries.push([px + r + e, py, r], [px - r - e, py, r], [px, py + r + e, r], [px, py - r - e, r]);
          }
        }
      }
    }
    // cursori esattamente sui confini delle celle e sugli angoli, anche sul bordo del foglio e fuori di poco
    for (let ix = 0; ix <= 75; ix += 3) for (let iy = 0; iy <= 100; iy += 5) for (const r of [7.5, 8]) queries.push([ix * 8, iy * 8, r], [ix * 8 + 1e-9, iy * 8 - 1e-9, r]);
    queries.push([-7.5, 400, 7.5], [-7.49999, 400, 7.5], [W + 7.5, 400, 7.5], [300, -7.5, 7.5], [300, H + 7.5, 7.5], [-8, -8, 12], [W + 8, H + 8, 12]);
    let hits = 0;
    for (const [x, y, r] of queries) {
      const a = collect(grid, x, y, r);
      const rows: Row[] = [];
      scanSegmentsNear(grid.xy, grid.path, grid.n, x, y, r, 1e9, (id, path, p, q, c, d) => rows.push([id, path, p, q, c, d]));
      expect(a.rows, `(${x}, ${y}) r=${r}`).toEqual(rows);
      if (rows.length) hits++;
    }
    expect(queries.length).toBeGreaterThan(20000);
    expect(hits).toBeGreaterThan(8000);
  }, 60000);

  it('i tratti orizzontali e verticali sul confine di una cella sono trovati da cursori sui due lati (e quello a distanza = raggio compreso)', () => {
    const grid = gridOf([[10, 40, 100, 40], [64, 20, 64, 200]]);
    // il tratto y = 40 e' sul confine fra le righe 4 e 5 (celle da 8)
    expect(collect(grid, 50, 40 + 7.5, 7.5).rows.map((r) => r[0])).toEqual([0]);
    expect(collect(grid, 50, 40 - 7.5, 7.5).rows.map((r) => r[0])).toEqual([0]);
    expect(collect(grid, 50, 40 + 7.5 + 1e-6, 7.5).rows).toEqual([]);
    expect(collect(grid, 64 + 7.5, 100, 7.5).rows.map((r) => r[0])).toEqual([1]);
    expect(collect(grid, 64 - 7.5, 100, 7.5).rows.map((r) => r[0])).toEqual([1]);
    // incrocio sui confini: i due, in ordine di indice
    expect(collect(grid, 64, 40, 3).rows.map((r) => r[0])).toEqual([0, 1]);
  });

  it('i tratti lunghi che attraversano molte celle (diagonale del foglio, orizzontale di tutta la pagina) sono trovati in ogni punto del loro percorso', () => {
    const segs: Seg[] = [[0, 0, 600, 800], [0, 123.456, 600, 123.456], [250.5, 0, 250.5, 800]];
    const grid = gridOf(segs);
    expect(grid.refs).toBeGreaterThan(200); // attraversano molte celle: le voci sono piu' dei tratti
    for (let t = 0; t <= 1; t += 1 / 997) {
      const x = 600 * t;
      const y = 800 * t;
      expect(collect(grid, x, y, 1).rows.map((r) => r[0])).toContain(0);
      expect(collect(grid, x, 123.456 + 0.5, 1).rows.map((r) => r[0])).toContain(1);
      expect(collect(grid, 250.5 - 0.5, y, 1).rows.map((r) => r[0])).toContain(2);
    }
  });

  it('un tratto quasi verticale (dx molto piccolo) e uno esattamente verticale sono trovati lungo tutta la lunghezza', () => {
    const grid = gridOf([[100, 10, 100 + 1e-11, 790], [200, 10, 200, 790], [300, 10, 300 + 1e-4, 790]]);
    for (let y = 10; y <= 790; y += 7) {
      for (const [i, x] of [[0, 100], [1, 200], [2, 300]] as const) {
        const ids = collect(grid, x + 1, y, 2).rows.map((r) => r[0]);
        expect(ids, `x=${x} y=${y}`).toContain(i);
      }
    }
  });

  it('raggio nullo, negativo o NaN: nessun tratto; cursore lontano dal foglio: nessun tratto; vicino al bordo ma fuori: i tratti entro il raggio', () => {
    const grid = gridOf([[0, 300, 100, 300]]);
    for (const r of [0, -1, Number.NaN]) expect(collect(grid, 50, 300, r)).toEqual({ ok: true, rows: [] });
    expect(collect(grid, -50, 300, 7.5).rows).toEqual([]);
    expect(collect(grid, -5, 300, 7.5).rows.map((r) => r[0])).toEqual([0]);
  });
});

describe('«troppi vicini» e tetto delle voci', () => {
  it('con piu\' di `max` tratti vicini non si emette nulla e si restituisce false (indice e scansione); con esattamente `max` si emettono tutti', () => {
    const segs: Seg[] = [];
    for (let i = 0; i < 10; i++) segs.push([100, 100 + i * 0.5, 160, 100 + i * 0.5]);
    const grid = gridOf(segs);
    expect(collect(grid, 130, 102, 6, 9)).toEqual({ ok: false, rows: [] });
    expect(collect(grid, 130, 102, 6, 10).rows).toHaveLength(10);
    const rows: Row[] = [];
    expect(scanSegmentsNear(grid.xy, grid.path, grid.n, 130, 102, 6, 9, (...a) => rows.push(a))).toBe(false);
    expect(rows).toEqual([]);
  });
  it('il contatore delle interrogazioni che fa il giro (4 miliardi) non cambia il risultato: dopo il giro i contrassegni si azzerano', () => {
    const grid = gridOf([[100, 100, 300, 100], [150, 50, 150, 200], [400, 400, 500, 500]]);
    const before = collect(grid, 150, 100, 5);
    (grid as unknown as { epoch: number }).epoch = 0xffffffff; // la prossima interrogazione porta il contatore a 0: riparte da 1
    expect(collect(grid, 150, 100, 5)).toEqual(before);
    expect(collect(grid, 150, 100, 5)).toEqual(before);
    expect(before.rows.map((r) => r[0])).toEqual([0, 1]);
  });
  it('PDF_MAX_NEAR e\' il valore dichiarato nel commento di snapExtra.ts', () => {
    expect(PDF_MAX_NEAR).toBe(256);
  });

  it('con celle da 8 pt e tanti tratti lunghi: la cella RADDOPPIA finche\' le voci stanno nel tetto; il risultato resta identico alla scansione lineare', () => {
    const segs: Seg[] = [];
    for (let i = 0; i < 300; i++) segs.push([0, 2 + i * 2.6, 600, 2 + i * 2.6 + (i % 7)]); // 300 tratti di 600 pt: 75 celle l'uno a 8 pt = 22.500 voci
    const small = buildSegmentScene(lineGeometry(segs), flat, { maxRefs: 1e9 });
    expect(small.stats.cellPt).toBe(8);
    expect(small.stats.refs).toBeGreaterThan(22000);
    const capped = buildSegmentScene(lineGeometry(segs), flat, { maxRefs: 8000 });
    expect(capped.stats.cellPt).toBeGreaterThan(8);
    expect(capped.stats.cellPt).toBeLessThanOrEqual(SEGMENT_GRID_MAX_CELL_PT);
    expect(capped.stats.refs).toBeLessThanOrEqual(8000);
    expect(capped.stats.dense).toBe(false);
    const rand = rng(5);
    for (let q = 0; q < 2000; q++) {
      const x = rand() * 640 - 20;
      const y = rand() * 800;
      const a = collect(capped.grid!, x, y, 7.5);
      const b = collect(small.grid!, x, y, 7.5);
      expect(a).toEqual(b);
    }
  });

  it('se neppure la cella massima basta la scena e\' «fitta»: nessuna griglia, `dense` vero, nessuna eccezione, e i numeri dicono perche\'', () => {
    const segs: Seg[] = [];
    for (let i = 0; i < 300; i++) segs.push([0, 2 + i * 2.6, 600, 2 + i * 2.6 + (i % 7)]);
    const r = buildSegmentScene(lineGeometry(segs), flat, { maxRefs: 500 });
    expect(r.grid).toBeNull();
    expect(r.stats).toMatchObject({ dense: true, kept: 300, cellPt: 0, bytes: 0, maxRefs: 500 });
    expect(r.stats.refs).toBeGreaterThan(500);
  });

  it('foglio enorme: le celle si ingrandiscono (al piu\' SEGMENT_GRID_MAX_CELLS) e l\'indice funziona', () => {
    const big: SheetMap = { width: 60000, height: 60000, userToSheet: (p) => ({ x: p.x, y: p.y }) };
    const { grid } = buildSegmentScene(lineGeometry([[100, 100, 50000, 49000], [100, 59000, 59000, 100]]), big);
    expect(grid!.nx * grid!.ny).toBeLessThanOrEqual(1 << 22);
    expect(grid!.cellPt).toBeGreaterThan(8);
    expect(collect(grid!, 25050, 24550, 5).rows.map((r) => r[0])).toContain(0);
  });
});

describe('memoria', () => {
  it('byte della scena = 40 per tratto (4 Float64, percorso e contrassegno) + 4 per voce + offset delle celle', () => {
    const grid = gridOf([[10, 10, 300, 10], [50, 50, 60, 60]]);
    expect(grid.bytes).toBe(2 * BYTES_PER_SEGMENT + 4 * grid.refs + 4 * (grid.nx * grid.ny + 1));
  });
  it('`segmentNearPoint`: bordo compreso e tratto di lunghezza nulla = punto', () => {
    expect(segmentNearPoint(0, 0, 10, 0, 5, 3, 3, 9)).toBe(true);
    expect(segmentNearPoint(0, 0, 10, 0, 5, 3.0000001, 3, 9)).toBe(false);
    expect(segmentNearPoint(0, 0, 10, 0, 13, 0, 3, 9)).toBe(true);
    expect(segmentNearPoint(2, 2, 2, 2, 2, 5, 3, 9)).toBe(true);
  });
});
