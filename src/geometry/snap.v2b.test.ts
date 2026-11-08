// Snap V2b (CP6c): Centro (cerchio, arco, Copertura circolare), Estremo e Punto medio dell'arco, punti in costruzione, priorita' Estremo > Punto medio > Centro.
import { describe, expect, it } from 'vitest';
import type { ArcObject, CircleObject, LineObject, PageObject } from '../model/model';
import { arcMid, arcThroughPoints } from './arc';
import { PageGeometry, type Pt, type UserPoint } from './page';
import { SNAP_KINDS, type SnapKinds, findSnap, snapCandidates } from './snap';

const ALL: SnapKinds = { end: true, mid: true, center: true };
const ONLY = (k: 'end' | 'mid' | 'center'): SnapKinds => ({ end: k === 'end', mid: k === 'mid', center: k === 'center' });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const DEG = Math.PI / 180;
const at = (c: UserPoint, r: number, deg: number): UserPoint => P(c.x + r * Math.cos(deg * DEG), c.y + r * Math.sin(deg * DEG));
const circle = (id: number, p1: UserPoint, p2: UserPoint): CircleObject => ({ id, kind: 'circle', p1, p2, stroke: { ...stroke } });
const arc = (id: number, p1: UserPoint, p2: UserPoint, p3: UserPoint): ArcObject => ({ id, kind: 'arc', p1, p2, p3, stroke: { ...stroke } });
const seg = (id: number, pts: UserPoint[]): LineObject => ({ id, kind: pts.length === 2 ? 'segment' : 'polyline', points: pts, stroke: { ...stroke } });
const near = (a: Pt, b: Pt, digits = 7): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const GEOMS: [string, PageGeometry][] = [
  ['0', new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 })],
  ['90 + CropBox', new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 })],
  ['180', new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 180, userUnit: 1 })],
  ['270 UserUnit 2.5', new PageGeometry({ view: [20, 30, 500, 700], rotate: 270, userUnit: 2.5 })],
];

describe('Cerchio: Centro', () => {
  it('il solo candidato e\' il Centro (il bordo e il punto indicato sul bordo non lo sono), con tutte le rotazioni', () => {
    for (const [name, g] of GEOMS) {
      const o = circle(1, P(200, 300), P(250, 330));
      const c = snapCandidates(o, g);
      expect(c.map((x) => x.kind), name).toEqual(['center']);
      near(c[0]!.point, g.userToSheet(P(200, 300)));
      expect(findSnap([o], g, g.userToSheet(P(203, 301)), 10, ALL)?.kind, name).toBe('center');
      expect(findSnap([o], g, g.userToSheet(P(250, 330)), 3, ALL), name).toBeNull();
      expect(findSnap([o], g, g.userToSheet(P(225, 315)), 3, ALL), name).toBeNull(); // sul diametro, non al centro
    }
  });
  it('solo con l\'interruttore Centro acceso', () => {
    const o = circle(1, P(200, 300), P(250, 330));
    const g = GEOMS[0]![1];
    const raw = g.userToSheet(P(201, 300));
    expect(findSnap([o], g, raw, 10, ONLY('end'))).toBeNull();
    expect(findSnap([o], g, raw, 10, ONLY('mid'))).toBeNull();
    expect(findSnap([o], g, raw, 10, ONLY('center'))?.kind).toBe('center');
  });
});

describe('Arco: Estremo (inizio e fine), Punto medio dell\'arco, Centro; il punto di passaggio no', () => {
  const C = P(300, 400);
  const R = 90;
  const p1 = at(C, R, 10);
  const p2 = at(C, R, 40); // vicino all'inizio: NON e' il punto medio
  const p3 = at(C, R, 150);
  it('quattro candidati: Estremo p1 e p3, Punto medio a meta\' dell\'arco (non p2), Centro; tutte le rotazioni e UserUnit', () => {
    for (const [name, g] of GEOMS) {
      const o = arc(1, p1, p2, p3);
      const c = snapCandidates(o, g);
      expect(c.map((x) => x.kind).sort(), name).toEqual(['center', 'end', 'end', 'mid']);
      const ends = c.filter((x) => x.kind === 'end').map((x) => x.point);
      near(ends[0]!, g.userToSheet(p1));
      near(ends[1]!, g.userToSheet(p3));
      // il punto medio e il centro, calcolati nello spazio utente (orientamento diverso, stesso punto geometrico)
      const ua = arcThroughPoints(p1, p2, p3)!;
      near(c.find((x) => x.kind === 'mid')!.point, g.userToSheet(arcMid(ua)));
      near(c.find((x) => x.kind === 'center')!.point, g.userToSheet(ua.c));
      // il punto medio e' a 80 gradi (meta' tra 10 e 150), non a 40
      near(arcMid(ua), at(C, R, 80));
    }
  });
  it('il punto di passaggio p2 non si aggancia; vicino al punto medio si aggancia al Punto medio', () => {
    const g = GEOMS[0]![1];
    const o = arc(1, p1, p2, p3);
    expect(findSnap([o], g, g.userToSheet(p2), 5, ALL)).toBeNull();
    const m = findSnap([o], g, g.userToSheet(at(C, R + 2, 80)), 6, ALL);
    expect(m?.kind).toBe('mid');
    near(m!.point, g.userToSheet(at(C, R, 80)));
    expect(findSnap([o], g, g.userToSheet(at(C, R, 12)), 6, ALL)?.kind).toBe('end');
    expect(findSnap([o], g, g.userToSheet(P(301, 399)), 6, ALL)?.kind).toBe('center');
  });
  it('arco lungo (oltre 180 gradi) e in verso antiorario: il punto medio e\' sempre a meta\' dello sweep', () => {
    const g = GEOMS[1]![1];
    const a = arc(1, at(C, R, 0), at(C, R, 200), at(C, R, 300)); // 300 gradi, p2 oltre meta'
    near(snapCandidates(a, g).find((x) => x.kind === 'mid')!.point, g.userToSheet(at(C, R, 150)));
    const b = arc(2, at(C, R, 300), at(C, R, 200), at(C, R, 0)); // lo stesso al contrario
    near(snapCandidates(b, g).find((x) => x.kind === 'mid')!.point, g.userToSheet(at(C, R, 150)));
  });
  it('un arco degenerato (punti allineati: non puo\' esistere) lascia solo i due estremi, senza errori', () => {
    const g = GEOMS[0]![1];
    const bad = arc(1, P(0, 0), P(5, 5), P(10, 10));
    expect(snapCandidates(bad, g).map((x) => x.kind)).toEqual(['end', 'end']);
  });
});

describe('Copertura circolare: Centro (decisione 67)', () => {
  it('Centro e basta', () => {
    const g = GEOMS[0]![1];
    const o: PageObject = { id: 1, kind: 'cover', shape: 'circle', p1: P(200, 200), p2: P(250, 200) };
    expect(snapCandidates(o, g).map((x) => x.kind)).toEqual(['center']);
    expect(findSnap([o], g, g.userToSheet(P(199, 201)), 5, ALL)?.kind).toBe('center');
    expect(findSnap([o], g, g.userToSheet(P(250, 200)), 5, ALL)).toBeNull();
  });
});

describe('priorita\' a parita\' di distanza: Estremo, poi Punto medio, poi Centro', () => {
  const g = GEOMS[0]![1];
  it('un Estremo e un Centro nello stesso punto: Estremo (in qualunque ordine degli oggetti)', () => {
    const c = circle(1, P(200, 200), P(240, 200));
    const s = seg(2, [P(200, 200), P(300, 250)]);
    expect(findSnap([c, s], g, g.userToSheet(P(200, 200)), 10, ALL)?.kind).toBe('end');
    expect(findSnap([s, c], g, g.userToSheet(P(200, 200)), 10, ALL)?.kind).toBe('end');
  });
  it('un Punto medio e un Centro nello stesso punto: Punto medio', () => {
    const c = circle(1, P(250, 200), P(290, 200));
    const s = seg(2, [P(200, 200), P(300, 200)]); // punto medio (250, 200)
    expect(findSnap([c, s], g, g.userToSheet(P(250, 200)), 10, ALL)?.kind).toBe('mid');
    expect(findSnap([s, c], g, g.userToSheet(P(250, 200)), 10, ALL)?.kind).toBe('mid');
  });
  it('un Estremo piu\' lontano non batte un Centro piu\' vicino (vince la distanza)', () => {
    const c = circle(1, P(200, 200), P(240, 200));
    const s = seg(2, [P(207, 200), P(300, 250)]);
    expect(findSnap([c, s], g, g.userToSheet(P(201, 200)), 10, ALL)?.kind).toBe('center');
  });
  it('SNAP_KINDS e\' nell\'ordine della priorita\' e degli interruttori', () => {
    expect(SNAP_KINDS.slice(0, 3)).toEqual(['end', 'mid', 'center']); // CP6f: poi Intersezione, Quadrante, Perpendicolare, Tangente
  });
});

describe('punti in costruzione (pending): Estremo', () => {
  const g = GEOMS[1]![1];
  it('si agganciano come Estremo, anche in una pagina ruotata, e il punto e\' esattamente quello indicato', () => {
    const r = findSnap([], g, g.userToSheet(P(143, 318)), 10, ALL, [P(140.25, 321.5), P(300, 400)]);
    expect(r?.kind).toBe('end');
    near(r!.point, g.userToSheet(P(140.25, 321.5)), 12);
  });
  it('valgono solo con l\'interruttore Estremo acceso', () => {
    const raw = g.userToSheet(P(141, 321));
    expect(findSnap([], g, raw, 10, ONLY('mid'), [P(140.25, 321.5)])).toBeNull();
    expect(findSnap([], g, raw, 10, ONLY('center'), [P(140.25, 321.5)])).toBeNull();
    expect(findSnap([], g, raw, 10, ONLY('end'), [P(140.25, 321.5)])?.kind).toBe('end');
  });
  it('senza pending (assente o vuoto) i risultati sono identici a prima, su 400 punti casuali', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const objs: PageObject[] = [seg(1, [P(100, 100), P(300, 120), P(250, 300)]), circle(2, P(200, 200), P(230, 210)), arc(3, at(P(300, 400), 80, 0), at(P(300, 400), 80, 70), at(P(300, 400), 80, 170))];
    const geom = GEOMS[0]![1];
    for (let i = 0; i < 400; i++) {
      const raw = { x: rnd() * 400, y: rnd() * 500 };
      expect(findSnap(objs, geom, raw, 25, ALL, [])).toEqual(findSnap(objs, geom, raw, 25, ALL));
    }
  });
  it('a parita\' con un oggetto vince il primo candidato (gli oggetti vengono prima dei punti in costruzione)', () => {
    const geom = GEOMS[0]![1];
    const s = seg(1, [P(100, 100), P(200, 100)]);
    const r = findSnap([s], geom, geom.userToSheet(P(100, 100)), 10, ALL, [P(100, 100)]);
    expect(r?.kind).toBe('end');
    near(r!.point, geom.userToSheet(P(100, 100)));
  });
});
