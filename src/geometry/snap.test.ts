import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { CoverObject, DimensionObject, LineObject, PageObject, TextObject } from '../model/model';
import { PageGeometry, type Pt, type UserPoint } from './page';
import { SNAP_KINDS, SNAP_LABEL, SNAP_TOL_PX, type SnapKinds, findSnap, snapCandidates, snapRadiusPt } from './snap';

const flat = new PageGeometry({ view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1 });
const rotCrop = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }); // /Rotate 90 + CropBox
const ALL: SnapKinds = { end: true, mid: true };
const ONLY_END: SnapKinds = { end: true, mid: false };
const ONLY_MID: SnapKinds = { end: false, mid: true };
const NONE: SnapKinds = { end: false, mid: false };

const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const line = (id: number, kind: 'segment' | 'polyline', pts: UserPoint[]): LineObject => ({ id, kind, points: pts, stroke: { ...stroke } });
const cover = (id: number, shape: CoverObject['shape'], p1: UserPoint, p2: UserPoint): CoverObject => ({ id, kind: 'cover', shape, p1, p2 });
const text = (id: number, at: UserPoint): TextObject => ({ id, kind: 'text', at, text: 'Ø8', textPt: 10, color: '#D32F2F' });
const dim = (id: number, p1: UserPoint, p2: UserPoint, a: UserPoint, b: UserPoint): DimensionObject => ({ id, kind: 'dim', dim: 'aligned', p1, p2, a, b, valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 });
const P = (x: number, y: number): UserPoint => ({ x, y });
const near = (a: Pt, b: Pt, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
/** Il punto utente `u` come lo vede il foglio. */
const S = (g: PageGeometry, u: UserPoint): Pt => g.userToSheet(u);
const nudge = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

describe('costanti', () => {
  it('i nomi dei tipi sono quelli di DESIGN.md', () => {
    expect(SNAP_LABEL).toEqual({ end: 'Estremo', mid: 'Punto medio' });
    expect(SNAP_KINDS).toEqual(['end', 'mid']);
  });
  it('raggio di cattura: valori di partenza uguali a quelli di selezione, in pt = px / zoom', () => {
    expect(SNAP_TOL_PX).toEqual({ touch: 22, mouse: 10 });
    expect(snapRadiusPt(true, 2)).toBe(11);
    expect(snapRadiusPt(false, 2)).toBe(5);
    expect(snapRadiusPt(false, 0.5)).toBe(20);
  });
});

describe('Retta (segmento a 2 punti)', () => {
  const seg = line(1, 'segment', [P(100, 100), P(300, 100)]);
  it('candidati: i due estremi e il centro', () => {
    const c = snapCandidates(seg, flat);
    expect(c.map((x) => x.kind)).toEqual(['end', 'mid', 'end']); // estremo, centro del tratto, estremo
    near(c[0]?.point as Pt, S(flat, P(100, 100)));
    near(c[1]?.point as Pt, S(flat, P(200, 100)));
    near(c[2]?.point as Pt, S(flat, P(300, 100)));
  });
  it('vicino a un estremo: Estremo; vicino al centro: Punto medio', () => {
    const e = findSnap([seg], flat, nudge(S(flat, P(100, 100)), 3, -2), 10, ALL);
    expect(e?.kind).toBe('end');
    near(e?.point as Pt, S(flat, P(100, 100)));
    const m = findSnap([seg], flat, nudge(S(flat, P(200, 100)), -4, 1), 10, ALL);
    expect(m?.kind).toBe('mid');
    near(m?.point as Pt, S(flat, P(200, 100)));
  });
  it('fuori dal raggio: null; sul bordo del raggio: agganciato (bordo compreso)', () => {
    const e = S(flat, P(100, 100));
    expect(findSnap([seg], flat, nudge(e, 10.01, 0), 10, ALL)).toBeNull();
    expect(findSnap([seg], flat, nudge(e, 10, 0), 10, ALL)?.kind).toBe('end');
    expect(findSnap([seg], flat, nudge(S(flat, P(150, 100)), 0, 0), 10, ALL)).toBeNull(); // a meta' fra estremo e centro, lontano da entrambi
  });
  it('un punto sul tratto ma lontano da estremi e centro non si aggancia (non e\' uno snap sulla linea)', () => {
    expect(findSnap([seg], flat, S(flat, P(150, 100)), 10, ALL)).toBeNull();
  });
  it('senza oggetti: null', () => {
    expect(findSnap([], flat, S(flat, P(100, 100)), 10, ALL)).toBeNull();
  });
});

describe('Linea (spezzata)', () => {
  const poly = line(2, 'polyline', [P(100, 100), P(200, 200), P(300, 100)]);
  it('3 estremi e 2 centri, nell\'ordine del tracciato', () => {
    const c = snapCandidates(poly, flat);
    expect(c.map((x) => x.kind)).toEqual(['end', 'mid', 'end', 'mid', 'end']);
    near(c[1]?.point as Pt, S(flat, P(150, 150)));
    near(c[3]?.point as Pt, S(flat, P(250, 150)));
  });
  it('sceglie il piu\' vicino fra i candidati di tutti i tratti', () => {
    const hit = findSnap([poly], flat, nudge(S(flat, P(250, 150)), 2, 2), 12, ALL);
    expect(hit?.kind).toBe('mid');
    near(hit?.point as Pt, S(flat, P(250, 150)));
    const vertex = findSnap([poly], flat, nudge(S(flat, P(200, 200)), -1, 3), 12, ALL);
    expect(vertex?.kind).toBe('end');
    near(vertex?.point as Pt, S(flat, P(200, 200)));
  });
});

describe('Copertura', () => {
  const rect = cover(3, 'rect', P(100, 100), P(300, 200));
  it('rettangolo: 4 angoli (Estremo) e 4 centri dei lati (Punto medio)', () => {
    const c = snapCandidates(rect, flat);
    expect(c.filter((x) => x.kind === 'end')).toHaveLength(4);
    expect(c.filter((x) => x.kind === 'mid')).toHaveLength(4);
    const has = (u: UserPoint, k: 'end' | 'mid'): boolean => c.some((x) => x.kind === k && Math.abs(x.point.x - S(flat, u).x) < 1e-9 && Math.abs(x.point.y - S(flat, u).y) < 1e-9);
    for (const u of [P(100, 100), P(300, 100), P(300, 200), P(100, 200)]) expect(has(u, 'end')).toBe(true);
    for (const u of [P(200, 100), P(300, 150), P(200, 200), P(100, 150)]) expect(has(u, 'mid')).toBe(true);
  });
  it('gli angoli non dipendono dall\'ordine dei due punti', () => {
    const swapped = cover(4, 'rect', P(300, 200), P(100, 100));
    const a = snapCandidates(rect, flat).map((x) => `${x.kind}:${x.point.x.toFixed(6)},${x.point.y.toFixed(6)}`).sort();
    const b = snapCandidates(swapped, flat).map((x) => `${x.kind}:${x.point.x.toFixed(6)},${x.point.y.toFixed(6)}`).sort();
    expect(b).toEqual(a);
  });
  it('quadrato: come un rettangolo (i suoi due punti sono gia\' squadrati)', () => {
    const sq = cover(5, 'square', P(100, 100), P(200, 200));
    expect(snapCandidates(sq, flat)).toHaveLength(8);
    const hit = findSnap([sq], flat, nudge(S(flat, P(150, 200)), 3, 3), 10, ALL);
    expect(hit?.kind).toBe('mid');
    near(hit?.point as Pt, S(flat, P(150, 200)));
  });
  it('cerchio: nessun candidato in V2a (il Centro arriva con il cerchio, V2b)', () => {
    const circ = cover(6, 'circle', P(200, 200), P(250, 200));
    expect(snapCandidates(circ, flat)).toEqual([]);
    expect(findSnap([circ], flat, S(flat, P(200, 200)), 50, ALL)).toBeNull();
    expect(findSnap([circ], flat, S(flat, P(250, 200)), 50, ALL)).toBeNull();
  });
});

describe('Quota', () => {
  const d = dim(7, P(100, 100), P(300, 100), P(100, 130), P(300, 130));
  it('Estremo = i due punti misurati; nessun Punto medio; a e b (linea di quota) non contano', () => {
    const c = snapCandidates(d, flat);
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.kind === 'end')).toBe(true);
    near(c[0]?.point as Pt, S(flat, P(100, 100)));
    near(c[1]?.point as Pt, S(flat, P(300, 100)));
    expect(findSnap([d], flat, S(flat, P(100, 130)), 5, ALL)).toBeNull(); // 'a'
    expect(findSnap([d], flat, S(flat, P(200, 100)), 5, ALL)).toBeNull(); // il centro della quota non e' un candidato
  });
  it('quote a catena: il punto misurato di una quota si aggancia per la successiva', () => {
    const hit = findSnap([d], flat, nudge(S(flat, P(300, 100)), 2, -3), 10, ALL);
    expect(hit?.kind).toBe('end');
    near(hit?.point as Pt, S(flat, P(300, 100)));
  });
});

describe('Testo', () => {
  it('nessun candidato', () => {
    const t = text(8, P(150, 150));
    expect(snapCandidates(t, flat)).toEqual([]);
    expect(findSnap([t], flat, S(flat, P(150, 150)), 50, ALL)).toBeNull();
  });
});

describe('parita\' e priorita\'', () => {
  it('stessa posizione (segmento di lunghezza zero): Estremo prima di Punto medio', () => {
    const z = line(9, 'segment', [P(100, 100), P(100, 100)]);
    const hit = findSnap([z], flat, S(flat, P(100, 100)), 5, ALL);
    expect(hit?.kind).toBe('end');
  });
  it('parita\' di distanza fra un Estremo e un Punto medio: vince l\'Estremo, in qualunque ordine degli oggetti', () => {
    const a = line(10, 'segment', [P(0, 100), P(20, 100)]); // centro in (10, 100)
    const b = line(11, 'segment', [P(20, 300), P(120, 300)]);
    const e = line(12, 'segment', [P(20, 100), P(20, 40)]); // estremo in (20, 100)
    const raw = S(flat, P(15, 100)); // a 5 pt dal centro di `a` e a 5 pt dall'estremo di `e`
    for (const order of [[a, e], [e, a], [a, b, e], [e, b, a]]) {
      const hit = findSnap(order, flat, raw, 8, ALL);
      expect(hit?.kind).toBe('end');
      near(hit?.point as Pt, S(flat, P(20, 100)));
    }
  });
  it('il piu\' vicino vince anche se e\' un Punto medio', () => {
    const a = line(13, 'segment', [P(0, 100), P(20, 100)]); // centro in (10, 100)
    const e = line(14, 'segment', [P(20, 100), P(20, 40)]); // estremo in (20, 100)
    const hit = findSnap([a, e], flat, S(flat, P(12, 100)), 20, ALL);
    expect(hit?.kind).toBe('mid');
  });
  it('a parita\' anche di tipo: il primo oggetto', () => {
    const a = line(15, 'segment', [P(100, 100), P(100, 200)]);
    const b = line(16, 'segment', [P(100, 100), P(300, 100)]);
    const hit = findSnap([a, b], flat, S(flat, P(100, 100)), 5, ONLY_END);
    expect(hit?.kind).toBe('end');
    near(hit?.point as Pt, S(flat, P(100, 100)));
  });
});

describe('tipi attivi e raggio', () => {
  const seg = line(17, 'segment', [P(100, 100), P(300, 100)]);
  it('solo Estremo: il centro non si aggancia', () => {
    expect(findSnap([seg], flat, S(flat, P(200, 100)), 10, ONLY_END)).toBeNull();
    expect(findSnap([seg], flat, S(flat, P(100, 100)), 10, ONLY_END)?.kind).toBe('end');
  });
  it('solo Punto medio: gli estremi non si agganciano', () => {
    expect(findSnap([seg], flat, S(flat, P(100, 100)), 10, ONLY_MID)).toBeNull();
    expect(findSnap([seg], flat, S(flat, P(200, 100)), 10, ONLY_MID)?.kind).toBe('mid');
  });
  it('un candidato di un tipo spento non nasconde uno attivo piu\' lontano', () => {
    // vicino all'estremo (spento) ma dentro il raggio del centro (attivo) di un altro oggetto
    const near1 = line(18, 'segment', [P(100, 100), P(100, 60)]);
    const mid = line(19, 'segment', [P(90, 80), P(110, 80)]); // centro in (100, 80)
    const hit = findSnap([near1, mid], flat, S(flat, P(100, 88)), 12, ONLY_MID);
    expect(hit?.kind).toBe('mid');
    near(hit?.point as Pt, S(flat, P(100, 80)));
  });
  it('nessun tipo attivo: null', () => {
    expect(findSnap([seg], flat, S(flat, P(100, 100)), 100, NONE)).toBeNull();
  });
  it('raggio nullo, negativo o non finito: null', () => {
    const e = S(flat, P(100, 100));
    expect(findSnap([seg], flat, e, 0, ALL)).toBeNull();
    expect(findSnap([seg], flat, e, -3, ALL)).toBeNull();
    expect(findSnap([seg], flat, e, Number.NaN, ALL)).toBeNull();
  });
});

describe('pagina /Rotate 90 con CropBox (come a4-cropbox.pdf ruotata)', () => {
  const seg = line(20, 'segment', [P(100, 100), P(300, 220)]);
  const box = cover(21, 'rect', P(120, 300), P(260, 500));
  it('lo snap e\' nel foglio mostrato e riporta nello spazio utente il punto esatto', () => {
    const raw = nudge(S(rotCrop, P(100, 100)), 2, -3);
    const hit = findSnap([seg, box], rotCrop, raw, 10, ALL);
    expect(hit?.kind).toBe('end');
    near(rotCrop.sheetToUser(hit?.point as Pt), P(100, 100), 9);
    const m = findSnap([seg, box], rotCrop, nudge(S(rotCrop, P(200, 160)), 1, 1), 10, ALL);
    expect(m?.kind).toBe('mid');
    near(rotCrop.sheetToUser(m?.point as Pt), P(200, 160), 9);
  });
  it('la copertura vista dal foglio ruotato: 4 angoli e 4 centri anche con le coordinate scambiate', () => {
    const c = snapCandidates(box, rotCrop);
    expect(c).toHaveLength(8);
    const corners = c.filter((x) => x.kind === 'end').map((x) => rotCrop.sheetToUser(x.point));
    for (const u of [P(120, 300), P(260, 300), P(260, 500), P(120, 500)]) expect(corners.some((q) => Math.abs(q.x - u.x) < 1e-9 && Math.abs(q.y - u.y) < 1e-9)).toBe(true);
    const mids = c.filter((x) => x.kind === 'mid').map((x) => rotCrop.sheetToUser(x.point));
    for (const u of [P(190, 300), P(260, 400), P(190, 500), P(120, 400)]) expect(mids.some((q) => Math.abs(q.x - u.x) < 1e-9 && Math.abs(q.y - u.y) < 1e-9)).toBe(true);
  });
  it('la distanza e il raggio sono nel foglio: lo stesso scostamento sul foglio vale in tutte le rotazioni', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const g = new PageGeometry({ view: [50, 50, 450, 600], rotate, userUnit: 1 });
      const e = S(g, P(100, 100));
      expect(findSnap([seg], g, nudge(e, 6, 6), 9, ALL)?.kind).toBe('end'); // 8.49 pt
      expect(findSnap([seg], g, nudge(e, 7, 7), 9, ALL)).toBeNull(); // 9.90 pt
    }
  });
  it('UserUnit 2.5: il raggio e\' in pt fisici del foglio, non in unita\' utente', () => {
    const g = new PageGeometry({ view: [0, 0, 200, 300], rotate: 0, userUnit: 2.5 });
    const s = line(22, 'segment', [P(20, 20), P(60, 20)]);
    const e = S(g, P(20, 20)); // (50, 725) sul foglio
    expect(findSnap([s], g, nudge(e, 9, 0), 10, ALL)?.kind).toBe('end');
    expect(findSnap([s], g, nudge(e, 11, 0), 10, ALL)).toBeNull();
  });
});

// Le geometrie dei PDF di prova veri, lette da PDF.js come fa l'app (page.view / page.rotate / page.userUnit).
async function geometryOf(file: string): Promise<{ g: PageGeometry; view: number[]; rotate: number }> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  const data = new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${file}`, import.meta.url)));
  const task = getDocument({ data, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const view = [...(page.view as number[])];
  const g = new PageGeometry({ view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit });
  const out = { g, view, rotate: page.rotate };
  await task.destroy();
  return out;
}

describe('PDF di prova veri: a4-rotate90.pdf e a4-cropbox.pdf', () => {
  it('a4-rotate90.pdf: /Rotate 90, il foglio e\' orizzontale; estremo, centro e angoli di una copertura', async () => {
    const { g, rotate } = await geometryOf('a4-rotate90.pdf');
    expect(rotate).toBe(90);
    expect(g.width).toBeGreaterThan(g.height);
    const seg = line(30, 'segment', [P(100, 150), P(400, 150)]); // orizzontale nello spazio utente, VERTICALE sul foglio
    const cv = cover(31, 'rect', P(200, 300), P(350, 500));
    const objs: PageObject[] = [seg, cv];
    const s0 = S(g, P(100, 150));
    const s1 = S(g, P(400, 150));
    expect(Math.abs(s0.x - s1.x)).toBeLessThan(1e-9); // verticale sul foglio
    const e = findSnap(objs, g, nudge(s0, 4, -4), 10, ALL);
    expect(e?.kind).toBe('end');
    near(g.sheetToUser(e?.point as Pt), P(100, 150), 9);
    const m = findSnap(objs, g, nudge(S(g, P(250, 150)), -3, 2), 10, ALL);
    expect(m?.kind).toBe('mid');
    near(g.sheetToUser(m?.point as Pt), P(250, 150), 9);
    const corner = findSnap(objs, g, nudge(S(g, P(350, 500)), 5, 0), 10, ALL);
    expect(corner?.kind).toBe('end');
    near(g.sheetToUser(corner?.point as Pt), P(350, 500), 9);
    const side = findSnap(objs, g, nudge(S(g, P(275, 300)), 0, 5), 10, ALL);
    expect(side?.kind).toBe('mid');
    near(g.sheetToUser(side?.point as Pt), P(275, 300), 9);
  });
  it('a4-cropbox.pdf: area visibile [50 50 450 600]; l\'origine del foglio e\' l\'angolo della CropBox', async () => {
    const { g, view } = await geometryOf('a4-cropbox.pdf');
    expect(view).toEqual([50, 50, 450, 600]);
    expect(g.width).toBeCloseTo(400, 9);
    expect(g.height).toBeCloseTo(550, 9);
    const seg = line(32, 'segment', [P(50, 50), P(450, 50)]); // lungo il bordo inferiore dell'area visibile
    const e = S(g, P(50, 50)); // angolo in basso a sinistra del foglio
    near(e, { x: 0, y: 550 });
    const hit = findSnap([seg], g, nudge(e, 3, -3), 10, ALL);
    expect(hit?.kind).toBe('end');
    near(hit?.point as Pt, { x: 0, y: 550 });
    const mid = findSnap([seg], g, nudge(S(g, P(250, 50)), 4, -4), 10, ALL);
    expect(mid?.kind).toBe('mid');
    near(mid?.point as Pt, { x: 200, y: 550 });
  });
});
