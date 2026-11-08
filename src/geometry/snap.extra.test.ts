// `findSnap` con i tipi di CP6f (Intersezione, Quadrante, Perpendicolare, Tangente) e l'Origine: interruttori, priorita' a parita' di distanza, raggio di cattura, tipi spenti
// (identici a c4380b0), pagine con /Rotate 90 e CropBox, e uguaglianza dello schema di scarto con il confronto di tutti gli oggetti.
import { describe, expect, it } from 'vitest';
import type { ArcObject, CircleObject, CoverObject, DimensionObject, LineObject, PageObject, TextObject } from '../model/model';
import { PageGeometry, type Pt, type SheetPoint, type UserPoint } from './page';
import { SNAP_KINDS, SNAP_LABEL, type SnapExtra, type SnapHit, type SnapKind, type SnapKinds, findSnap, snapCandidates } from './snap';
import { buildSnapScene, extraCandidates } from './snapExtra';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rotCrop = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const seg = (id: number, a: UserPoint, b: UserPoint): LineObject => ({ id, kind: 'segment', points: [a, b], stroke: { ...stroke } });
const poly = (id: number, pts: UserPoint[]): LineObject => ({ id, kind: 'polyline', points: pts, stroke: { ...stroke } });
const circle = (id: number, c: UserPoint, edge: UserPoint): CircleObject => ({ id, kind: 'circle', p1: c, p2: edge, stroke: { ...stroke } });
const arc = (id: number, a: UserPoint, b: UserPoint, c: UserPoint): ArcObject => ({ id, kind: 'arc', p1: a, p2: b, p3: c, stroke: { ...stroke } });
const near = (a: Pt, b: Pt, tol = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const ONLY = (...k: SnapKind[]): SnapKinds => Object.fromEntries(k.filter((x) => x !== 'origin').map((x) => [x, true]));
const ALL_NEW = ONLY('intersection', 'quadrant', 'perpendicular', 'tangent');
const OLD3: SnapKinds = { end: true, mid: true, center: true };
const EVERY: SnapKinds = { ...OLD3, ...ALL_NEW };
const S = (g: PageGeometry, u: UserPoint): SheetPoint => g.userToSheet(u);
const nudge = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

describe('costanti', () => {
  it(`i nomi e l\'ordine degli interruttori`, () => {
    expect(SNAP_LABEL).toEqual({ end: 'Estremo', mid: 'Punto medio', center: 'Centro', origin: 'Origine', intersection: 'Intersezione', quadrant: 'Quadrante', perpendicular: 'Perpendicolare', tangent: 'Tangente' });
    expect(SNAP_KINDS).toEqual(['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent']);
    expect(SNAP_LABEL.perpendicular).toHaveLength(14); // l'etichetta piu' lunga
  });
});

describe('ogni tipo da solo: solo i suoi candidati', () => {
  const o1 = seg(1, P(100, 100), P(300, 300));
  const o2 = seg(2, P(100, 300), P(300, 100));
  const cc = circle(3, P(400, 500), P(440, 500));
  it(`Intersezione: l\'incrocio e solo quello (spento: niente)`, () => {
    const raw = nudge(S(flat, P(200, 200)), 3, -2);
    const h = findSnap([o1, o2], flat, raw, 10, ONLY('intersection'));
    expect(h?.kind).toBe('intersection');
    near(h?.point as Pt, S(flat, P(200, 200)), 1e-9);
    expect(findSnap([o1, o2], flat, raw, 10, OLD3)?.kind).toBe('mid'); // senza il tipo nuovo, vicino c'e' il punto medio (stesso punto, ma di un altro tipo)
    expect(findSnap([o1, o2], flat, raw, 10, ONLY('quadrant', 'perpendicular', 'tangent'))).toBeNull();
  });
  it(`Quadrante: il punto del cerchio a destra (nel foglio piatto: x + r, stessa y)`, () => {
    const raw = nudge(S(flat, P(440, 500)), -3, 2);
    const h = findSnap([cc], flat, raw, 10, ONLY('quadrant'));
    expect(h?.kind).toBe('quadrant');
    near(h?.point as Pt, S(flat, P(440, 500)), 1e-9);
    expect(findSnap([cc], flat, raw, 10, ONLY('intersection', 'perpendicular', 'tangent'))).toBeNull();
  });
  it(`Perpendicolare e Tangente: solo con un punto di partenza; senza, nessun candidato`, () => {
    const A = P(250, 150);
    const raw = nudge(S(flat, P(250, 100)), 2, 1); // il piede di A su y = 100... nessun tratto orizzontale: serve un tratto
    const line = seg(1, P(100, 100), P(400, 100));
    void raw;
    const foot = nudge(S(flat, P(250, 100)), 3, 3);
    expect(findSnap([line], flat, foot, 10, ONLY('perpendicular'))).toBeNull(); // senza punto di partenza
    const h = findSnap([line], flat, foot, 10, ONLY('perpendicular'), [], { anchor: A });
    expect(h?.kind).toBe('perpendicular');
    near(h?.point as Pt, S(flat, P(250, 100)), 1e-9);
    // tangente al cerchio (0,0) r 50 da (200, 0): i punti sono (50^2/200, +-50*sqrt(200^2-50^2)/200)
    const cir = circle(2, P(300, 300), P(350, 300));
    const T = P(500, 300);
    const x = 300 + 2500 / 200;
    const y = (50 * Math.sqrt(200 * 200 - 50 * 50)) / 200;
    const t = findSnap([cir], flat, nudge(S(flat, P(x, 300 + y)), 2, 2), 10, ONLY('tangent'), [], { anchor: T });
    expect(t?.kind).toBe('tangent');
    near(t?.point as Pt, S(flat, P(x, 300 + y)), 1e-9);
    expect(findSnap([cir], flat, nudge(S(flat, P(x, 300 + y)), 2, 2), 10, ONLY('tangent'))).toBeNull();
  });
});

describe('Origine: candidato senza interruttore', () => {
  const origin = P(200, 400);
  it(`un candidato "Origine" al punto dell\'origine, con almeno un interruttore acceso`, () => {
    const raw = nudge(S(flat, origin), 4, 3);
    const h = findSnap([], flat, raw, 10, OLD3, [], { origin });
    expect(h?.kind).toBe('origin');
    near(h?.point as Pt, S(flat, origin), 1e-12);
    expect(findSnap([], flat, raw, 10, ONLY('intersection'), [], { origin })?.kind).toBe('origin'); // anche con un solo tipo nuovo acceso
    expect(findSnap([], flat, raw, 10, OLD3, [])).toBeNull(); // senza `origin`: come prima
  });
  it(`con tutti gli interruttori spenti non c\'e\' snap, nemmeno sull\'origine`, () => {
    expect(findSnap([], flat, S(flat, origin), 10, {}, [], { origin })).toBeNull();
    expect(findSnap([], flat, S(flat, origin), 10, { end: false, mid: false, center: false }, [], { origin })).toBeNull();
  });
  it(`con /Rotate 90 e CropBox: l\'origine e\' il punto della pagina`, () => {
    const h = findSnap([], rotCrop, nudge(S(rotCrop, origin), 2, -3), 10, OLD3, [], { origin });
    expect(h?.kind).toBe('origin');
    near(h?.point as Pt, S(rotCrop, origin), 1e-9);
  });
  it(`fuori dal raggio: nessuno`, () => {
    expect(findSnap([], flat, nudge(S(flat, origin), 10.01, 0), 10, OLD3, [], { origin })).toBeNull();
  });
});

describe('parita\' di distanza: l\'ordine Estremo, Punto medio, Centro, Origine, Intersezione, Quadrante, Perpendicolare, Tangente', () => {
  it(`Estremo prima dell\'Origine e dell\'Intersezione: due rette che si toccano in un estremo, con l\'origine li\'`, () => {
    const a = seg(1, P(100, 100), P(200, 100));
    const b = seg(2, P(200, 100), P(200, 200));
    const raw = nudge(S(flat, P(200, 100)), 2, 2);
    expect(findSnap([a, b], flat, raw, 10, EVERY, [], { origin: P(200, 100) })?.kind).toBe('end');
    // Estremo spento: vince l'Origine (a parita'), poi l'Intersezione
    const noEnd: SnapKinds = { ...EVERY, end: false };
    expect(findSnap([a, b], flat, raw, 10, noEnd, [], { origin: P(200, 100) })?.kind).toBe('origin');
    expect(findSnap([a, b], flat, raw, 10, noEnd)?.kind).toBe('intersection'); // niente origine: resta l'incontro (un contatto in un estremo)
  });
  it(`Intersezione prima del Quadrante: una retta passa per il quadrante destro di un cerchio`, () => {
    const c = circle(1, P(300, 300), P(350, 300));
    const l = seg(2, P(350, 250), P(350, 350)); // verticale per (350, 300): tangente al cerchio in quel punto
    const raw = nudge(S(flat, P(350, 300)), 1, 1);
    expect(findSnap([c, l], flat, raw, 10, ONLY('intersection', 'quadrant'))?.kind).toBe('intersection');
    expect(findSnap([c, l], flat, raw, 10, ONLY('quadrant'))?.kind).toBe('quadrant');
  });
  it(`Perpendicolare prima della Tangente: un tratto per il punto di tangenza, perpendicolare alla tangente`, () => {
    const cir = circle(1, P(0 + 300, 300), P(350, 300)); // centro (300,300) r 50
    const A = P(500, 300);
    // punto di tangenza T = (300 + 2500/200, 300 + 50*sqrt(200^2-50^2)/200) e tratto per T perpendicolare ad A-T: la perpendicolare da A al tratto cade in T
    const tx = 300 + 2500 / 200;
    const ty = 300 + (50 * Math.sqrt(200 * 200 - 50 * 50)) / 200;
    const dx = tx - A.x;
    const dy = ty - A.y;
    const n = Math.hypot(dx, dy);
    const px = -dy / n;
    const py = dx / n;
    const s = seg(2, P(tx - 20 * px, ty - 20 * py), P(tx + 20 * px, ty + 20 * py));
    const raw = nudge(S(flat, P(tx, ty)), 1, 1);
    expect(findSnap([cir, s], flat, raw, 10, ONLY('perpendicular', 'tangent'), [], { anchor: A })?.kind).toBe('perpendicular');
    expect(findSnap([cir, s], flat, raw, 10, ONLY('tangent'), [], { anchor: A })?.kind).toBe('tangent');
  });
  it(`a distanze diverse vince il piu\' vicino, qualunque sia il tipo`, () => {
    const a = seg(1, P(100, 100), P(300, 300));
    const b = seg(2, P(100, 300), P(300, 100));
    const mid = S(flat, P(200, 200)); // incrocio e punto medio di entrambe nello stesso punto: parita' -> Punto medio vince su Intersezione
    expect(findSnap([a, b], flat, nudge(mid, 1, 0), 10, EVERY)?.kind).toBe('mid');
    // un'origine piu' vicina del punto medio vince
    const h = findSnap([a, b], flat, nudge(mid, 2, 0), 10, EVERY, [], { origin: P(200 + 1.5, 200) });
    expect(h?.kind).toBe('origin');
  });
});

describe('raggio di cattura', () => {
  it(`bordo compreso, come per i tipi di prima`, () => {
    const a = seg(1, P(100, 100), P(300, 300));
    const b = seg(2, P(100, 300), P(300, 100));
    const c = S(flat, P(200, 200));
    expect(findSnap([a, b], flat, nudge(c, 0, 9.99), 10, ONLY('intersection'))).not.toBeNull();
    expect(findSnap([a, b], flat, nudge(c, 0, 10.01), 10, ONLY('intersection'))).toBeNull();
    expect(findSnap([a, b], flat, c, 0, ONLY('intersection'))).toBeNull(); // raggio nullo
  });
});

describe('solo tipi nuovi: il confronto dei punti di prima non parte', () => {
  it(`un estremo vicino non si aggancia se Estremo, Punto medio e Centro sono spenti`, () => {
    const a = seg(1, P(100, 100), P(300, 300));
    const b = seg(2, P(100, 300), P(300, 100));
    expect(findSnap([a, b], flat, nudge(S(flat, P(100, 100)), 2, 2), 10, ALL_NEW)).toBeNull();
  });
});

describe('pagine con /Rotate 90 e CropBox', () => {
  it(`Intersezione, Perpendicolare e Tangente: i punti della pagina (calcolo indipendente nello spazio utente)`, () => {
    const a = seg(1, P(100, 100), P(300, 300));
    const b = seg(2, P(100, 300), P(300, 100));
    const h = findSnap([a, b], rotCrop, nudge(S(rotCrop, P(200, 200)), 3, 1), 10, ONLY('intersection'));
    expect(h?.kind).toBe('intersection');
    near(h?.point as Pt, S(rotCrop, P(200, 200)), 1e-9);
    const A = P(250, 150);
    const line = seg(3, P(100, 100), P(400, 100));
    const f = findSnap([line], rotCrop, nudge(S(rotCrop, P(250, 100)), 2, 2), 10, ONLY('perpendicular'), [], { anchor: A });
    near(f?.point as Pt, S(rotCrop, P(250, 100)), 1e-9);
    const cir = circle(4, P(300, 300), P(350, 300));
    const tx = 300 + 2500 / 200;
    const ty = 300 + (50 * Math.sqrt(200 * 200 - 50 * 50)) / 200;
    const t = findSnap([cir], rotCrop, nudge(S(rotCrop, P(tx, ty)), 1, -1), 10, ONLY('tangent'), [], { anchor: P(500, 300) });
    near(t?.point as Pt, S(rotCrop, P(tx, ty)), 1e-9);
  });
  it(`Quadrante: i punti del foglio mostrato (destra, basso, sinistra, alto), non quelli dello spazio utente`, () => {
    const cir = circle(1, P(250, 300), P(280, 300));
    const c = S(rotCrop, P(250, 300));
    const rS = Math.hypot(S(rotCrop, P(280, 300)).x - c.x, S(rotCrop, P(280, 300)).y - c.y);
    for (const [dx, dy] of [[rS, 0], [0, rS], [-rS, 0], [0, -rS]] as const) {
      const h = findSnap([cir], rotCrop, nudge({ x: c.x + dx, y: c.y + dy }, 2, 2), 10, ONLY('quadrant'));
      expect(h?.kind).toBe('quadrant');
      near(h?.point as Pt, { x: c.x + dx, y: c.y + dy }, 1e-9);
    }
  });
});

// ---- Il comportamento con i tipi nuovi spenti e' quello di c4380b0 ----
/** Copia della `findSnap` di c4380b0 (CP6a-CP6c), con `snapCandidates` al posto di `visitCandidates`: il riferimento per "identico a prima". */
function findSnapV2b(objects: readonly PageObject[], geom: PageGeometry, raw: SheetPoint, radius: number, kinds: { end: boolean; mid: boolean; center: boolean }, pending: readonly UserPoint[] = []): SnapHit | null {
  if (!(radius > 0) || (!kinds.end && !kinds.mid && !kinds.center)) return null;
  const r2 = radius * radius;
  const rank = (k: SnapKind): number => (k === 'end' ? 0 : k === 'mid' ? 1 : 2);
  let bestD = Infinity;
  let bestKind: SnapKind = 'end';
  let bestX = 0;
  let bestY = 0;
  let found = false;
  const consider = (x: number, y: number, kind: SnapKind): void => {
    if (!(kind === 'end' ? kinds.end : kind === 'mid' ? kinds.mid : kinds.center)) return;
    const dx = x - raw.x;
    const dy = y - raw.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) return;
    const d = Math.sqrt(d2);
    if (!found || d < bestD - 1e-9 || (d <= bestD + 1e-9 && rank(kind) < rank(bestKind))) {
      found = true;
      bestD = d;
      bestKind = kind;
      bestX = x;
      bestY = y;
    }
  };
  for (const o of objects) for (const c of snapCandidates(o, geom)) consider(c.point.x, c.point.y, c.kind);
  if (kinds.end) {
    for (const p of pending) {
      const sp = geom.userToSheet(p);
      consider(sp.x, sp.y, 'end');
    }
  }
  return found ? { point: { x: bestX, y: bestY }, kind: bestKind } : null;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** Oggetti casuali di ogni tipo nell'area visibile di `view`. */
function randomObjects(n: number, view: readonly [number, number, number, number], rnd: () => number): PageObject[] {
  const [x0, y0, x1, y1] = view;
  const pt = (): UserPoint => P(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0));
  const out: PageObject[] = [];
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    const k = i % 8;
    if (k === 0 || k === 1) out.push(seg(id, pt(), pt()));
    else if (k === 2) out.push(poly(id, [pt(), pt(), pt(), pt()]));
    else if (k === 3) out.push(circle(id, pt(), pt()));
    else if (k === 4) {
      const c = pt();
      const r = 10 + rnd() * 80;
      const a0 = rnd() * 6.28;
      const sweep = 0.5 + rnd() * 4;
      const at = (t: number): UserPoint => P(c.x + r * Math.cos(a0 + t), c.y + r * Math.sin(a0 + t));
      out.push(arc(id, at(0), at(sweep / 2), at(sweep)));
    } else if (k === 5) out.push({ id, kind: 'cover', shape: rnd() < 0.5 ? 'circle' : 'rect', p1: pt(), p2: pt() } as CoverObject);
    else if (k === 6)
      out.push({ id, kind: 'dim', dim: 'aligned', p1: pt(), p2: pt(), a: pt(), b: pt(), valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 } as DimensionObject);
    else out.push({ id, kind: 'text', at: pt(), text: 'T', textPt: 10, color: '#D32F2F' } as TextObject);
  }
  return out;
}

describe('con i tipi nuovi spenti il risultato e\' quello di c4380b0 (copia della funzione di allora)', () => {
  for (const [name, geom] of [['A4 piatta', flat], ['/Rotate 90 e CropBox', rotCrop]] as const) {
    it(`${name}: 400 posizioni su 40 oggetti casuali, con e senza punti in costruzione, con scena, punto di partenza e SENZA origine`, () => {
      const rnd = rng(7);
      const view = name === 'A4 piatta' ? ([0, 0, 595, 842] as const) : ([50, 50, 450, 600] as const);
      const objs = randomObjects(40, view, rnd);
      const scene = buildSnapScene(objs, geom);
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        const raw = S(geom, P(view[0] + rnd() * (view[2] - view[0]), view[1] + rnd() * (view[3] - view[1])));
        const pending = i % 3 === 0 ? [P(view[0] + rnd() * 100, view[1] + rnd() * 100)] : [];
        const kinds = { end: rnd() < 0.8, mid: rnd() < 0.8, center: rnd() < 0.8 };
        const radius = 5 + rnd() * 40;
        const a = findSnapV2b(objs, geom, raw, radius, kinds, pending);
        const b = findSnap(objs, geom, raw, radius, kinds, pending, { scene, anchor: P(10, 10), origin: null });
        const c = findSnap(objs, geom, raw, radius, kinds, pending);
        expect(b).toEqual(a);
        expect(c).toEqual(a);
        if (a) hits++;
      }
      expect(hits).toBeGreaterThan(20);
    });
  }
});

// ---- Lo schema di scarto da' lo stesso risultato del confronto di tutto con tutto ----
function brute(objects: readonly PageObject[], geom: PageGeometry, raw: SheetPoint, radius: number, kinds: SnapKinds, pending: readonly UserPoint[], extra: SnapExtra): SnapHit | null {
  const base = !!(kinds.end || kinds.mid || kinds.center);
  const calc = !!(kinds.intersection || kinds.quadrant || kinds.perpendicular || kinds.tangent);
  if (!(radius > 0) || (!base && !calc)) return null;
  const order: SnapKind[] = ['end', 'mid', 'center', 'origin', 'intersection', 'quadrant', 'perpendicular', 'tangent'];
  const rank = (k: SnapKind): number => order.indexOf(k);
  let best: SnapHit | null = null;
  let bestD = Infinity;
  const consider = (x: number, y: number, kind: SnapKind): void => {
    if (kind !== 'origin' && !kinds[kind]) return;
    const d = Math.hypot(x - raw.x, y - raw.y);
    if (d > radius) return;
    if (!best || d < bestD - 1e-9 || (d <= bestD + 1e-9 && rank(kind) < rank(best.kind))) {
      best = { point: { x, y }, kind };
      bestD = d;
    }
  };
  if (base) for (const o of objects) for (const c of snapCandidates(o, geom)) consider(c.point.x, c.point.y, c.kind);
  if (kinds.end) for (const p of pending) consider(geom.userToSheet(p).x, geom.userToSheet(p).y, 'end');
  if (extra.origin) consider(geom.userToSheet(extra.origin).x, geom.userToSheet(extra.origin).y, 'origin');
  if (calc) extraCandidates(buildSnapScene(objects, geom), raw, Number.POSITIVE_INFINITY, kinds, extra.anchor ? geom.userToSheet(extra.anchor) : null, consider);
  return best;
}

describe('schema di scarto = confronto di tutto con tutto (stesso tipo, stesso punto)', () => {
  for (const [name, geom, view] of [
    ['A4 piatta', flat, [0, 0, 595, 842] as const],
    ['/Rotate 90 e CropBox', rotCrop, [50, 50, 450, 600] as const],
  ] as const) {
    it(`${name}: 600 posizioni su 60 oggetti casuali, tutti i tipi, con e senza punto di partenza, origine e punti in costruzione`, () => {
      const rnd = rng(42);
      const objs = randomObjects(60, view, rnd);
      const scene = buildSnapScene(objs, geom);
      const counts: Record<string, number> = {};
      for (let i = 0; i < 600; i++) {
        const pick = rnd();
        // metà delle posizioni vicino a un oggetto (per avere agganci), metà a caso
        const base = P(view[0] + rnd() * (view[2] - view[0]), view[1] + rnd() * (view[3] - view[1]));
        const extra: SnapExtra = { scene, anchor: pick < 0.7 ? P(view[0] + rnd() * (view[2] - view[0]), view[1] + rnd() * (view[3] - view[1])) : null, origin: pick < 0.3 ? P(view[0] + rnd() * 400, view[1] + rnd() * 400) : null };
        // con l'origine, meta' delle posizioni cadono vicino a lei: cosi' anche l'Origine vince qualche volta
        const raw = extra.origin && rnd() < 0.5 ? nudge(S(geom, extra.origin), rnd() * 8 - 4, rnd() * 8 - 4) : S(geom, base);
        const pending = i % 4 === 0 ? [P(view[0] + rnd() * 200, view[1] + rnd() * 200)] : [];
        const kinds: SnapKinds = { end: rnd() < 0.6, mid: rnd() < 0.6, center: rnd() < 0.6, intersection: rnd() < 0.8, quadrant: rnd() < 0.8, perpendicular: rnd() < 0.8, tangent: rnd() < 0.8 };
        const radius = 5 + rnd() * 120;
        const a = brute(objs, geom, raw, radius, kinds, pending, extra);
        const b = findSnap(objs, geom, raw, radius, kinds, pending, extra);
        expect(b).toEqual(a);
        if (a) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
      }
      // la prova e' significativa: ci sono agganci di tutti i tipi
      for (const k of ['end', 'mid', 'center', 'origin', 'intersection', 'quadrant', 'perpendicular', 'tangent']) expect(counts[k] ?? 0, k).toBeGreaterThan(0);
    });
  }
});
