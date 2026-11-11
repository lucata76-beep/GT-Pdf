// `findSnap` con i punti del disegno del PDF (CP7b, V3.1): `extra.pdf`. Senza sorgente il risultato e' quello di 3bbe3a8 (i test esistenti di snap.test.ts, snap.v2b.test.ts e
// snap.extra.test.ts restano invariati e passano); con la sorgente: il punto piu' vicino, gli interruttori Estremo e Punto medio (ma non Centro), il raggio (bordo compreso),
// la parita' (vince l'oggetto disegnato), /Rotate e CropBox, e un confronto differenziale fra indice e scansione lineare a livello di `findSnap` (anche nei pareggi).
import { describe, expect, it } from 'vitest';
import type { LineObject, PageObject } from '../model/model';
import { PointGrid, scanNear } from '../pdf/pointIndex';
import { type SnapPoints, buildSnapPoints } from '../pdf/snapPoints';
import type { PdfGeometry } from '../pdf/geometry';
import { PageGeometry, type Pt, type SheetPoint, type UserPoint } from './page';
import { type PdfSnapSource, type SnapExtra, type SnapKinds, findSnap } from './snap';

const flat = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const rotCrop = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const seg = (id: number, a: UserPoint, b: UserPoint): LineObject => ({ id, kind: 'segment', points: [a, b], stroke: { ...stroke } });
type Seg = [number, number, number, number];
/** Punti PDF (Estremo e Punto medio nel foglio di `g`) da tratti nello spazio utente, costruiti con la stessa funzione dell'app. */
function pdfPoints(segs: Seg[], g: PageGeometry): SnapPoints {
  const geom: PdfGeometry = {
    nPaths: 1,
    pathPaint: new Uint8Array([1]),
    pathVisible: new Uint8Array([1]),
    nLines: segs.length,
    lineXY: new Float32Array(segs.flat()),
    linePath: new Uint32Array(segs.length),
    nCubics: 0,
    cubicXY: new Float32Array(0),
    cubicPath: new Uint32Array(0),
    bytes: 0,
  };
  return buildSnapPoints(geom, g);
}
const grid = (p: SnapPoints): PointGrid => new PointGrid(p);
const linearSource = (p: SnapPoints): PdfSnapSource => ({ forEachNear: (x, y, r, e, m, emit) => scanNear(p, x, y, r, e, m, emit) });
const ONLY = (...k: ('end' | 'mid' | 'center')[]): SnapKinds => Object.fromEntries(k.map((x) => [x, true]));
const near = (a: Pt, b: Pt, tol = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const S = (u: UserPoint, g: PageGeometry = flat): SheetPoint => g.userToSheet(u);
const nudge = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

describe('senza sorgente: come prima', () => {
  const objs = [seg(1, P(100, 100), P(300, 100))];
  const raw = nudge(S(P(100, 100)), 3, 2);
  it('extra assente, vuoto, con pdf undefined o null: lo stesso risultato', () => {
    const base = findSnap(objs, flat, raw, 10, ONLY('end', 'mid'));
    expect(base?.kind).toBe('end');
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid'), [], {})).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid'), [], { pdf: undefined })).toEqual(base);
    expect(findSnap(objs, flat, raw, 10, ONLY('end', 'mid'), [], { pdf: null })).toEqual(base);
  });
  it('nessun candidato senza oggetti e senza sorgente', () => {
    expect(findSnap([], flat, raw, 10, ONLY('end', 'mid'), [], { pdf: null })).toBeNull();
  });
});

describe('con la sorgente PDF', () => {
  const pts = pdfPoints([[100, 100, 300, 100], [300, 100, 300, 400]], flat); // Estremi (100,100) (300,100) (300,400); Punti medi (200,100) (300,250)
  const src = grid(pts);
  const extra: SnapExtra = { pdf: src };
  it('Estremo del PDF: il punto piu\' vicino, nel foglio, senza alcun oggetto', () => {
    const h = findSnap([], flat, nudge(S(P(300, 400)), -4, 3), 10, ONLY('end', 'mid'), [], extra);
    expect(h?.kind).toBe('end');
    near(h!.point, S(P(300, 400)), 1e-6); // Float32 di lineXY: 1e-6 pt
  });
  it('Punto medio del PDF', () => {
    const h = findSnap([], flat, nudge(S(P(200, 100)), 2, 2), 10, ONLY('end', 'mid'), [], extra);
    expect(h?.kind).toBe('mid');
    near(h!.point, S(P(200, 100)), 1e-6);
    const h2 = findSnap([], flat, nudge(S(P(300, 250)), -2, 5), 10, ONLY('end', 'mid'), [], extra);
    expect(h2?.kind).toBe('mid');
    near(h2!.point, S(P(300, 250)), 1e-6);
  });
  it('fra due punti vicini vince il piu\' vicino (anche se di tipo con priorita\' piu\' bassa)', () => {
    // il Punto medio (200,100) e l'Estremo (100,100) distano 100 pt: un cursore a 5 pt dal medio e a 95 dall'estremo
    const h = findSnap([], flat, nudge(S(P(200, 100)), 5, 0), 100, ONLY('end', 'mid'), [], extra);
    expect(h?.kind).toBe('mid');
  });
  it('interruttori: Estremo spento = niente Estremi del PDF; Punto medio spento = niente medi del PDF', () => {
    const atEnd = nudge(S(P(300, 100)), 1, 1);
    expect(findSnap([], flat, atEnd, 10, ONLY('end'), [], extra)?.kind).toBe('end');
    expect(findSnap([], flat, atEnd, 10, ONLY('mid'), [], extra)).toBeNull(); // il medio piu' vicino e' a 100 pt
    const atMid = nudge(S(P(200, 100)), 1, 1);
    expect(findSnap([], flat, atMid, 10, ONLY('mid'), [], extra)?.kind).toBe('mid');
    expect(findSnap([], flat, atMid, 10, ONLY('end'), [], extra)).toBeNull();
    expect(findSnap([], flat, atMid, 10, ONLY(), [], extra)).toBeNull();
  });
  it('il solo interruttore Centro (o nessuno) non da\' punti del PDF', () => {
    expect(findSnap([], flat, S(P(100, 100)), 10, ONLY('center'), [], extra)).toBeNull();
    expect(findSnap([], flat, S(P(100, 100)), 10, {}, [], extra)).toBeNull();
  });
  it('raggio: bordo compreso; appena oltre, niente', () => {
    const p0 = S(P(100, 100));
    expect(findSnap([], flat, nudge(p0, 10, 0), 10, ONLY('end'), [], extra)?.kind).toBe('end');
    expect(findSnap([], flat, nudge(p0, 10.001, 0), 10, ONLY('end'), [], extra)).toBeNull();
    expect(findSnap([], flat, p0, 0, ONLY('end'), [], extra)).toBeNull();
  });
  it('oggetti e PDF insieme: il piu\' vicino dei due', () => {
    const obj = seg(7, P(110, 100), P(150, 100));
    const raw = nudge(S(P(100, 100)), 3, 0);
    expect(findSnap([obj], flat, raw, 20, ONLY('end', 'mid'), [], extra)?.point.x).toBeCloseTo(S(P(100, 100)).x, 4); // il PDF e' a 3 pt, l'oggetto a 7
    const raw2 = nudge(S(P(110, 100)), -1, 0);
    expect(findSnap([obj], flat, raw2, 20, ONLY('end', 'mid'), [], extra)?.point.x).toBeCloseTo(110, 9); // l'oggetto e' a 1 pt
  });
  it('punti in costruzione (pending) e PDF: il piu\' vicino', () => {
    const raw = nudge(S(P(100, 100)), 6, 0);
    const h = findSnap([], flat, raw, 20, ONLY('end'), [P(104, 100)], extra);
    near(h!.point, S(P(104, 100)), 1e-12); // il punto in costruzione e' a 2 pt, quello del PDF a 6
  });
});

describe('parita\': vince il punto di un oggetto disegnato su quello del PDF', () => {
  /** Sorgente finta: emette un solo Estremo (nel foglio). */
  const fake = (x: number, y: number): PdfSnapSource => ({ forEachNear: (_x, _y, _r, end, _m, emit) => end && emit(x, y, 'end') });
  it('stessa distanza (entro la tolleranza di parita\' di 1e-9 pt) e stesso tipo: il risultato e\' il punto dell\'OGGETTO', () => {
    const o = seg(1, P(100, 100), P(300, 100));
    const ob = S(P(100, 100)); // Estremo dell'oggetto, nel foglio
    const raw = nudge(ob, 3, 0);
    // il punto del PDF e' PIU' VICINO al cursore di 5e-10 pt (dentro la tolleranza): e' una parita', l'oggetto (considerato prima) resta
    const tie = findSnap([o], flat, raw, 10, ONLY('end'), [], { pdf: fake(ob.x + 5e-10, ob.y) });
    expect(tie?.kind).toBe('end');
    expect(tie!.point).toEqual(ob); // esattamente il punto dell'oggetto
    // piu' vicino di 1e-8 pt (oltre la tolleranza): non e' piu' una parita', vince il PDF
    const closer = findSnap([o], flat, raw, 10, ONLY('end'), [], { pdf: fake(ob.x + 1e-8, ob.y) });
    expect(closer!.point).toEqual({ x: ob.x + 1e-8, y: ob.y });
    // senza oggetti il punto del PDF e' l'unico candidato
    expect(findSnap([], flat, raw, 10, ONLY('end'), [], { pdf: fake(ob.x + 5e-10, ob.y) })!.point).toEqual({ x: ob.x + 5e-10, y: ob.y });
  });
  it('un Estremo del PDF alla stessa distanza di un Punto medio di un oggetto: vince l\'Estremo (priorita\' del tipo), come fra due oggetti', () => {
    // oggetto: tratto con medio in (200, 100); PDF: Estremo in (200 + 7, 100): il cursore e' a meta' -> stessa distanza (3.5 pt)
    const o = seg(1, P(100, 100), P(300, 100));
    const ps = pdfPoints([[207, 100, 207, 300]], flat);
    const raw = S(P(203.5, 100));
    const h = findSnap([o], flat, raw, 10, ONLY('end', 'mid'), [], { pdf: grid(ps) });
    expect(h?.kind).toBe('end');
    near(h!.point, S(P(207, 100)), 1e-6);
  });
  it('a parita\' di tipo e di distanza fra due punti PDF vince il primo nell\'ordine dei tratti (indice e scansione lineare uguali)', () => {
    const ps = pdfPoints([[100, 100, 100, 200], [300, 100, 300, 200]], flat); // Estremi (100,100) (100,200) (300,100) (300,200)
    const raw = S(P(200, 100)); // equidistante da (100,100) e (300,100)
    for (const src of [grid(ps), linearSource(ps)]) {
      const h = findSnap([], flat, raw, 150, ONLY('end'), [], { pdf: src });
      near(h!.point, S(P(100, 100)), 1e-6);
    }
  });
});

describe('/Rotate 90 e CropBox: i punti sono nel foglio mostrato', () => {
  it('un tratto nello spazio utente di una pagina ruotata e ritagliata: Estremo e Punto medio dove li vede la persona', () => {
    const segs: Seg[] = [[100, 100, 400, 100], [400, 100, 400, 500]];
    const ps = pdfPoints(segs, rotCrop);
    const extra: SnapExtra = { pdf: grid(ps) };
    for (const [u, kind] of [[P(100, 100), 'end'], [P(400, 100), 'end'], [P(400, 500), 'end'], [P(250, 100), 'mid'], [P(400, 300), 'mid']] as [UserPoint, string][]) {
      const s = S(u, rotCrop);
      const h = findSnap([], rotCrop, nudge(s, 2, -3), 10, ONLY('end', 'mid'), [], extra);
      expect(h?.kind, `${JSON.stringify(u)}`).toBe(kind);
      near(h!.point, s, 1e-5);
      // riportato nello spazio utente (all'inserimento): lo stesso punto del PDF
      const back = rotCrop.sheetToUser(h!.point);
      expect(Math.abs(back.x - u.x)).toBeLessThan(1e-5);
      expect(Math.abs(back.y - u.y)).toBeLessThan(1e-5);
    }
  });
});

describe('differenziale a livello di findSnap: indice contro scansione lineare (10.000 interrogazioni, anche nei pareggi)', () => {
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
  it('tratti casuali + oggetti casuali (alcuni con estremi sui punti del PDF) + punti in costruzione: stesso risultato con ogni combinazione di tipi', () => {
    const r = rng(11);
    const segs: Seg[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = 20 + r() * 560;
      const y = 20 + r() * 760;
      // un quarto dei tratti su un reticolo di 25 pt: molti punti equidistanti dal cursore (pareggi); il resto casuale
      if (i % 4 === 0) {
        const gx = 25 * Math.round(x / 25);
        const gy = 25 * Math.round(y / 25);
        segs.push([gx, gy, gx + 25, gy]);
      } else segs.push([x, y, x + (r() - 0.5) * 60, y + (r() - 0.5) * 60]);
    }
    const ps = pdfPoints(segs, flat);
    const g = grid(ps);
    const lin = linearSource(ps);
    const objs: PageObject[] = Array.from({ length: 40 }, (_, i) => {
      const k = Math.floor(r() * segs.length);
      const s = segs[k]!;
      // alcuni oggetti hanno un estremo ESATTAMENTE sul punto di un tratto del PDF (stessa posizione: pareggio fra oggetto e PDF)
      return seg(i + 1, i % 2 === 0 ? P(s[0], s[1]) : P(20 + r() * 560, 20 + r() * 760), P(20 + r() * 560, 20 + r() * 760));
    });
    const combos: SnapKinds[] = [ONLY('end', 'mid'), ONLY('end'), ONLY('mid'), ONLY('end', 'mid', 'center')];
    let hits = 0;
    for (let i = 0; i < 10000; i++) {
      const s = segs[Math.floor(r() * segs.length)]!;
      const around = i % 3 === 0 ? P(s[0], s[1]) : i % 3 === 1 ? P((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) : P(r() * 600, r() * 800);
      const raw = nudge(S(around), (r() - 0.5) * 16, (r() - 0.5) * 16);
      const radius = [2, 5, 10, 22][i % 4]!;
      const kinds = combos[i % combos.length]!;
      const pending = i % 7 === 0 ? [P(r() * 600, r() * 800)] : [];
      const a = findSnap(objs, flat, raw, radius, kinds, pending, { pdf: g });
      const b = findSnap(objs, flat, raw, radius, kinds, pending, { pdf: lin });
      expect(a, `interrogazione ${i}`).toEqual(b);
      if (a) hits++;
    }
    expect(hits).toBeGreaterThan(5000); // la prova non e' vuota
  });
});
