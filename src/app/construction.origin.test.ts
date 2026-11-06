import { describe, expect, it } from 'vitest';
import type { CurveKind } from '../geometry/arc';
import { PageGeometry, type SheetPoint, type UserPoint } from '../geometry/page';
import { EXACT_MIN_DISTANCE_PT, Construction, type ConstructionEnv, type ConstructionEvents, type ConstructionTool } from './construction';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rot = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }); // Rotate 90 + CropBox
const P = (x: number, y: number): UserPoint => ({ x, y });

function setup(opts: { geom?: PageGeometry; ortho?: boolean; zoom?: number; grid?: number | null; gridOrigin?: SheetPoint | null; snap?: ConstructionEnv['snap'] } = {}) {
  const log: string[] = [];
  const rejects: string[] = [];
  const origins: UserPoint[] = [];
  const lines: { kind: string; points: UserPoint[] }[] = [];
  const curves: { kind: CurveKind; points: UserPoint[] }[] = [];
  const ev: ConstructionEvents = {
    line: (kind, points) => {
      log.push(`line:${kind}:${points.length}`);
      lines.push({ kind, points });
    },
    calibrate: () => log.push('calibrate'),
    measure: () => log.push('measure'),
    text: () => log.push('text'),
    dimension: () => log.push('dim'),
    cover: () => log.push('cover'),
    curve: (kind, points) => {
      log.push(`curve:${kind}:${points.length}`);
      curves.push({ kind, points });
    },
    origin: (at) => {
      log.push('origin');
      origins.push(at);
    },
    reject: (r) => {
      log.push('reject');
      rejects.push(r);
    },
  };
  const state = { ortho: opts.ortho ?? false };
  const c = new Construction(
    { geometry: () => opts.geom ?? flat, zoom: () => opts.zoom ?? 1, ortho: () => state.ortho, snap: opts.snap, grid: () => opts.grid ?? null, gridOrigin: () => opts.gridOrigin ?? null },
    ev,
  );
  return { c, log, rejects, origins, lines, curves, state };
}

describe('strumento Origine (CP6d): un punto, indicato come ogni altro', () => {
  it('un solo punto: lo consegna all\'app e si azzera (la costruzione non resta in sospeso)', () => {
    const { c, log, origins } = setup();
    c.setTool('origin');
    expect(c.needed).toBe(1);
    expect(c.pending).toBe(false);
    c.place(P(120.5, 300.25));
    expect(log).toEqual(['origin']);
    expect(origins).toEqual([P(120.5, 300.25)]);
    expect(c.points).toEqual([]);
    expect(c.pending).toBe(false);
    c.place(P(10, 10)); // un secondo clic (lo strumento e' ancora armato) sposta di nuovo
    expect(origins).toHaveLength(2);
  });

  it('nessun ORTO: nemmeno con l\'ORTO acceso il punto grezzo viene vincolato', () => {
    const { c } = setup({ ortho: true });
    c.setTool('origin');
    expect(c.anchor).toBeNull();
    const raw = { x: 41.3, y: 63.7 };
    expect(c.resolve(raw)).toEqual({ point: raw, snap: null });
  });

  it('snap e griglia valgono come per ogni punto: lo snap vince, poi la griglia', () => {
    const hit = { point: { x: 100, y: 200 }, kind: 'end' as const };
    const a = setup({ snap: () => hit, grid: 20 });
    a.c.setTool('origin');
    expect(a.c.resolve({ x: 103, y: 197 })).toEqual({ point: hit.point, snap: 'end' });
    const b = setup({ grid: 20 });
    b.c.setTool('origin');
    const r = b.c.resolve({ x: 41.3, y: 163.7 });
    expect(r.snap).toBeNull();
    expect(r.point.x).toBeCloseTo(40, 9);
  });

  it('il testo guida e\' di una riga e non cambia con lo strumento fermo', () => {
    const { c } = setup();
    c.setTool('origin');
    expect(c.prompt).toBe('Origine: indica il punto da cui contare X e Y');
    expect(c.prompt).not.toMatch(/\n/);
  });
});

describe('griglia con l\'origine di pagina: i nodi partono dall\'origine', () => {
  it('senza origine i nodi partono in basso a sinistra (come V2a); con l\'origine sono in origine + k * passo, anche a sinistra e sotto', () => {
    const STEP = 20;
    const none = setup({ grid: STEP });
    none.c.setTool('segment');
    const a = none.c.resolve({ x: 141.3, y: 363.7 }).point;
    expect(a.x).toBeCloseTo(140, 9);
    expect((flat.height - a.y) / STEP).toBeCloseTo(Math.round((flat.height - a.y) / STEP), 9);
    const origin = { x: 105, y: 300 }; // non su un nodo di V2a
    const withO = setup({ grid: STEP, gridOrigin: origin });
    withO.c.setTool('segment');
    const b = withO.c.resolve({ x: 141.3, y: 363.7 }).point;
    expect((b.x - origin.x) / STEP).toBeCloseTo(Math.round((b.x - origin.x) / STEP), 9);
    expect((origin.y - b.y) / STEP).toBeCloseTo(Math.round((origin.y - b.y) / STEP), 9);
    const left = withO.c.resolve({ x: 12.4, y: 590.2 }).point; // a sinistra e sotto l'origine
    expect(left.x).toBeCloseTo(5, 9); // 105 - 5 * 20
    expect(left.y).toBeCloseTo(600, 9); // 300 + 15 * 20
  });

  it('con ORTO e origine: si arrotonda solo l\'asse libero, sui nodi dell\'origine', () => {
    const STEP = 20;
    const origin = { x: 105, y: 300 };
    const { c } = setup({ grid: STEP, gridOrigin: origin, ortho: true });
    c.setTool('segment');
    c.place(flat.sheetToUser({ x: 105, y: 300 }));
    const r = c.resolve({ x: 300.4, y: 307 }).point;
    expect(r.y).toBe(300); // asse bloccato dall'ORTO: quello del primo punto
    expect((r.x - origin.x) / STEP).toBeCloseTo(Math.round((r.x - origin.x) / STEP), 9);
  });

  it('pagina /Rotate 90 + CropBox: i nodi dell\'origine sono sul foglio mostrato', () => {
    const STEP = 20;
    const origin = rot.userToSheet({ x: 200, y: 300 });
    const { c } = setup({ geom: rot, grid: STEP, gridOrigin: origin });
    c.setTool('segment');
    const p = c.resolve({ x: origin.x + 61.3, y: origin.y - 38.9 }).point;
    expect((p.x - origin.x) / STEP).toBeCloseTo(3, 9);
    expect((origin.y - p.y) / STEP).toBeCloseTo(2, 9);
  });
});

describe('shell (CP6d): punti digitati ESATTI', () => {
  const TOOLS_WITH_SHELL: [ConstructionTool, CurveKind | null][] = [['segment', null], ['polyline', null], ['curve', 'circle']];

  it('quale passo aspetta la shell: punto per Retta e Linea, punto poi raggio per il Cerchio, niente per tutto il resto', () => {
    const a = setup();
    a.c.setTool('segment');
    expect(a.c.shellStep).toBe('point');
    a.c.placeExact(P(10, 10));
    expect(a.c.shellStep).toBe('point');
    const l = setup();
    l.c.setTool('polyline');
    for (let i = 0; i < 5; i++) {
      expect(l.c.shellStep).toBe('point');
      l.c.placeExact(P(10 + 20 * i, 10));
    }
    const k = setup();
    k.c.setTool('curve');
    k.c.setCurveKind('circle');
    expect(k.c.shellStep).toBe('point');
    k.c.placeExact(P(100, 100));
    expect(k.c.shellStep).toBe('radius');
    for (const t of ['calibrate', 'distance', 'text', 'dim', 'cover', 'origin'] as const) {
      const x = setup();
      x.c.setTool(t);
      expect(x.c.shellStep, t).toBeNull();
      expect(x.c.shellPrompt, t).toBeNull();
    }
    const arc = setup();
    arc.c.setTool('curve');
    arc.c.setCurveKind('arc'); // l'Arco resta col mouse (decisione 71)
    expect(arc.c.shellStep).toBeNull();
    const none = setup();
    expect(none.c.shellStep).toBeNull(); // nessuno strumento
  });

  it('Retta: due punti digitati completano la retta con i punti esatti (nessuna elaborazione)', () => {
    const { c, log, lines } = setup({ ortho: true, grid: 20 });
    c.setTool('segment');
    const a = P(123.456789012345, 234.5);
    const b = P(301.123456789, 101.000000001);
    expect(c.placeExact(a)).toBe(true);
    expect(c.points).toEqual([a]);
    expect(c.pending).toBe(true);
    expect(c.placeExact(b)).toBe(true);
    expect(log).toEqual(['line:segment:2']);
    expect(lines[0]?.points[0]).toBe(a);
    expect(lines[0]?.points[1]).toBe(b); // gli stessi oggetti, non copie arrotondate
    expect(c.pending).toBe(false);
  });

  it('i punti digitati non passano da snap, griglia, ORTO ne\' squadratura (nemmeno con tutto acceso)', () => {
    let asked = 0;
    const { c, lines } = setup({ ortho: true, grid: 20, gridOrigin: { x: 3, y: 3 }, snap: () => (asked++, { point: P(0, 0), kind: 'end' as const }) });
    c.setTool('segment');
    c.placeExact(P(10.123, 20.456));
    c.placeExact(P(77.7, 30.3)); // fuori asse e fuori dai nodi
    expect(asked).toBe(0);
    expect(lines[0]?.points).toEqual([P(10.123, 20.456), P(77.7, 30.3)]);
  });

  it('Linea: ogni punto digitato si aggiunge; Fine (come oggi) la termina; si puo\' mescolare con il mouse', () => {
    const { c, log, lines } = setup();
    c.setTool('polyline');
    c.placeExact(P(10, 10));
    c.placeExact(P(100, 10));
    c.place(P(100, 150)); // un clic (punto del mouse)
    c.placeExact(P(10, 150));
    expect(c.points).toHaveLength(4);
    expect(log).toEqual([]);
    c.finish();
    expect(log).toEqual(['line:polyline:4']);
    expect(lines[0]?.points[2]).toEqual(P(100, 150));
  });

  it('Linea: un punto digitato vicino al precedente (sotto i 6 px ma sopra 0.001 pt) NON termina la linea in silenzio e viene aggiunto', () => {
    const { c, log, rejects } = setup({ zoom: 1 });
    c.setTool('polyline');
    c.placeExact(P(10, 10));
    c.placeExact(P(100, 10));
    expect(c.placeExact(P(103, 10))).toBe(true); // 3 pt = 3 px a zoom 1: con `place` varrebbe come Fine
    expect(log).toEqual([]);
    expect(rejects).toEqual([]);
    expect(c.points).toHaveLength(3);
  });

  it('un segmento digitato corto ma voluto (2 mm) e\' valido anche a zoom basso (sotto i 6 px)', () => {
    const { c, log } = setup({ zoom: 0.5 });
    c.setTool('segment');
    c.placeExact(P(100, 100));
    expect(c.placeExact(P(105.67, 100))).toBe(true); // circa 2 mm = 2.83 px a zoom 0.5
    expect(log).toEqual(['line:segment:2']);
  });

  it('due punti coincidenti (distanza in pt sotto la soglia) rifiutati con un messaggio, il primo resta; la Linea non si chiude', () => {
    for (const t of ['segment', 'polyline'] as const) {
      const { c, log, rejects } = setup();
      c.setTool(t);
      c.placeExact(P(50, 60));
      expect(c.placeExact(P(50, 60))).toBe(false);
      expect(c.placeExact(P(50 + EXACT_MIN_DISTANCE_PT / 2, 60))).toBe(false);
      expect(rejects).toEqual(['I due punti coincidono: digita un punto diverso.', 'I due punti coincidono: digita un punto diverso.']);
      expect(c.points).toEqual([P(50, 60)]);
      expect(log.filter((x) => x === 'reject')).toHaveLength(2);
      expect(log.some((x) => x.startsWith('line'))).toBe(false);
      expect(c.placeExact(P(50 + EXACT_MIN_DISTANCE_PT * 2, 60))).toBe(true);
    }
  });

  it('la soglia e\' in pt FISICI del foglio: con UserUnit 2.5 la distanza utente va moltiplicata', () => {
    const uu = new PageGeometry({ view: [0, 0, 300, 200], rotate: 0, userUnit: 2.5 });
    const { c } = setup({ geom: uu });
    c.setTool('segment');
    c.placeExact(P(10, 10));
    expect(c.placeExact(P(10 + 0.0006, 10))).toBe(true); // 0.0006 * 2.5 = 0.0015 pt fisici: sopra 0.001, quindi valido
    const one = setup(); // la stessa distanza utente con UserUnit 1 sono 0.0006 pt fisici: coincidenti
    one.c.setTool('segment');
    one.c.placeExact(P(10, 10));
    expect(one.c.placeExact(P(10 + 0.0006, 10))).toBe(false);
  });

  it('Cerchio: centro, poi il punto sul bordo (derivato dal raggio) completa il cerchio', () => {
    const { c, log, curves } = setup();
    c.setTool('curve');
    c.setCurveKind('circle');
    c.placeExact(P(200, 300));
    expect(c.prompt).toBe('Cerchio: indica un punto sul bordo');
    expect(c.placeExact(P(250.5, 300))).toBe(true);
    expect(log).toEqual(['curve:circle:2']);
    expect(curves[0]?.points).toEqual([P(200, 300), P(250.5, 300)]);
  });

  it('raggio nullo: il punto sul bordo coincide con il centro, rifiutato con un messaggio che parla di raggio', () => {
    const { c, rejects } = setup();
    c.setTool('curve');
    c.setCurveKind('circle');
    c.placeExact(P(200, 300));
    expect(c.placeExact(P(200, 300))).toBe(false);
    expect(rejects).toEqual(['Il raggio è troppo piccolo: digita un numero più grande.']);
    expect(c.points).toHaveLength(1);
  });

  it('non si puo\' digitare quando lo strumento non lo prevede o e\' bloccato: nulla cambia', () => {
    const t = setup();
    t.c.setTool('text');
    expect(t.c.placeExact(P(1, 1))).toBe(false);
    expect(t.c.points).toEqual([]);
    const arc = setup();
    arc.c.setTool('curve');
    arc.c.setCurveKind('arc');
    expect(arc.c.placeExact(P(1, 1))).toBe(false);
    const idle = setup();
    expect(idle.c.placeExact(P(1, 1))).toBe(false);
    const cal = setup();
    cal.c.setTool('calibrate');
    cal.c.place(P(0, 0));
    cal.c.place(P(100, 0));
    expect(cal.c.locked).toBe(true);
    expect(cal.c.placeExact(P(1, 1))).toBe(false);
  });

  it('sulla pagina /Rotate 90 + CropBox il punto digitato resta lo stesso punto utente (la shell lavora con le coordinate gia\' convertite)', () => {
    const { c, lines } = setup({ geom: rot });
    c.setTool('segment');
    const a = rot.sheetToUser({ x: 33.3, y: 44.4 });
    const b = rot.sheetToUser({ x: 133.3, y: 44.4 });
    c.placeExact(a);
    c.placeExact(b);
    expect(lines[0]?.points).toEqual([a, b]);
    const s1 = rot.userToSheet(lines[0]!.points[0]!);
    const s2 = rot.userToSheet(lines[0]!.points[1]!);
    expect(s2.y).toBeCloseTo(s1.y, 9); // orizzontale sullo schermo
  });

  it('testi guida della shell: una riga, dicono che cosa si aspetta e che si puo\' indicare col mouse', () => {
    for (const [tool, kind] of TOOLS_WITH_SHELL) {
      const { c } = setup();
      c.setTool(tool);
      if (kind) c.setCurveKind(kind);
      const seen: string[] = [];
      for (let i = 0; i < 4 && c.shellPrompt; i++) {
        seen.push(c.shellPrompt);
        if (!c.placeExact(P(10 + 40 * (i + 1), 10))) break;
      }
      for (const m of seen) {
        expect(m, m).not.toMatch(/\n/);
        expect(m, m).toMatch(/indica/);
        expect(m.length, m).toBeLessThanOrEqual(80);
      }
      expect(seen.length, tool).toBeGreaterThan(0);
    }
    const r = setup();
    r.c.setTool('segment');
    expect(r.c.shellPrompt).toBe('Retta: indica o digita X;Y del punto iniziale');
    r.c.placeExact(P(1, 1));
    expect(r.c.shellPrompt).toBe('Retta: indica o digita X;Y del punto finale');
    const k = setup();
    k.c.setTool('curve');
    k.c.setCurveKind('circle');
    expect(k.c.shellPrompt).toBe('Cerchio: indica o digita X;Y del centro');
    k.c.placeExact(P(1, 1));
    expect(k.c.shellPrompt).toBe('Cerchio: indica un punto sul bordo o digita il raggio');
  });
});
