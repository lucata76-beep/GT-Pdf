// `findSnap` con i TRATTI del disegno del PDF (CP7d, V3.2b): Perpendicolare dall'ancora della costruzione (`extra.anchor`, spazio utente). Il piede atteso e' ricalcolato qui con la
// proiezione di un punto su una retta, nello spazio UTENTE (scritta qui): il passaggio utente -> foglio e' una similitudine, quindi il piede della perpendicolare si conserva e il suo
// corrispondente nel foglio e' `userToSheet(piede)`. Pagine /Rotate 90 + CropBox e UserUnit 2.5: PageGeometry (la conversione e' provata contro PDF.js in src/pdf/segmentScenePdf.test.ts).
import { describe, expect, it } from 'vitest';
import type { LineObject, PageObject } from '../model/model';
import { SegmentGrid, buildSegmentScene, scanSegmentsNear } from '../pdf/segmentIndex';
import { type Seg, lineGeometry, rng } from '../pdf/segmentTestUtils';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { type SnapKinds, findSnap } from './snap';
import { PDF_MAX_NEAR, type PdfSegmentSource } from './snapExtra';

const flat = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const rotCrop = new PageGeometry({ view: [50, 50, 450, 600], rotate: 90, userUnit: 1 });
const unit25 = new PageGeometry({ view: [0, 0, 400, 500], rotate: 0, userUnit: 2.5 });
const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 } as const;
const P = (x: number, y: number): UserPoint => ({ x, y });
const ONLY = (...k: (keyof SnapKinds)[]): SnapKinds => Object.fromEntries(k.map((x) => [x, true]));
const scene = (segs: Seg[], geom: PageGeometry = flat, opts: { path?: number[]; visible?: boolean[] } = {}): SegmentGrid => {
  const { grid } = buildSegmentScene(lineGeometry(segs, opts), geom);
  if (!grid) throw new Error('scena assente');
  return grid;
};
const f32 = (s: Seg): Seg => Array.from(new Float32Array(s)) as Seg;
/** Il piede della perpendicolare da `a` sulla retta per il tratto (spazio utente) e se cade DENTRO il tratto. */
function foot(seg: Seg, a: UserPoint): { x: number; y: number; inside: boolean } {
  const [x1, y1, x2, y2] = f32(seg);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = ((a.x - x1) * dx + (a.y - y1) * dy) / (dx * dx + dy * dy);
  return { x: x1 + t * dx, y: y1 + t * dy, inside: t >= 0 && t <= 1 };
}
const close = (a: SheetPoint, b: SheetPoint, tol = 1e-6): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};
const nudge = (p: SheetPoint, dx: number, dy: number): SheetPoint => ({ x: p.x + dx, y: p.y + dy });

describe('Perpendicolare dall\'ancora a un tratto del PDF', () => {
  const line: Seg = [100, 200, 500, 320];
  const anchor = P(260, 450);
  const f = foot(line, anchor);
  for (const [name, geom, seg] of [['pagina diritta', flat, line], ['/Rotate 90 e CropBox', rotCrop, [100, 200, 400, 320] as Seg], ['UserUnit 2.5', unit25, [100, 200, 350, 300] as Seg]] as const) {
    it(`${name}: il piede e' quello del calcolo indipendente e il tipo e' Perpendicolare`, () => {
      const src = scene([seg], geom);
      const a = geom === flat ? anchor : geom === rotCrop ? P(250, 480) : P(200, 450);
      const ft = foot(seg, a);
      expect(ft.inside).toBe(true);
      const want = geom.userToSheet(P(ft.x, ft.y));
      for (const d of [[0, 0], [3, 2], [-4, 3], [-6, -6]] as const) {
        const h = findSnap([], geom, nudge(want, d[0], d[1]), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor: a });
        expect(h?.kind).toBe('perpendicular');
        close(h!.point, want, 1e-4);
      }
    });
  }
  const src = scene([line]);
  const want = flat.userToSheet(P(f.x, f.y));
  it('senza ancora nessun candidato; con l\'interruttore spento nessun candidato', () => {
    expect(findSnap([], flat, want, 10, ONLY('perpendicular'), [], { pdfSegments: src })).toBeNull();
    expect(findSnap([], flat, want, 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor: null })).toBeNull();
    expect(findSnap([], flat, want, 10, ONLY('end', 'mid', 'intersection', 'center', 'quadrant', 'tangent'), [], { pdfSegments: src, anchor: anchor })).toBeNull();
    expect(findSnap([], flat, want, 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor })?.kind).toBe('perpendicular');
  });
  it('il piede FUORI dal tratto (la perpendicolare cadrebbe sul prolungamento): nessun candidato; sull\'estremo: c\'e\' (estremi compresi)', () => {
    const outside = P(620, 380); // la proiezione cade oltre l'estremo (500, 320)
    const fo = foot(line, outside);
    expect(fo.inside).toBe(false);
    expect(findSnap([], flat, flat.userToSheet(P(fo.x, fo.y)), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor: outside })).toBeNull();
    // l'ancora esattamente sulla perpendicolare per l'estremo (500, 320): direzione del tratto (400, 120), perpendicolare (-120, 400)
    const onEndPerp = P(500 - 120 * 0.2, 320 + 400 * 0.2);
    expect(foot(line, onEndPerp)).toMatchObject({ x: 500, y: 320, inside: true });
    const h = findSnap([], flat, nudge(flat.userToSheet(P(500, 320)), 1, 1), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor: onEndPerp });
    expect(h?.kind).toBe('perpendicular');
    close(h!.point, flat.userToSheet(P(500, 320)), 1e-4);
  });
  it('l\'ancora SUL tratto: il piede coincide con l\'ancora e non si offre (segmento di lunghezza nulla)', () => {
    const onLine = P(300, 200 + (300 - 100) * 0.3);
    expect(findSnap([], flat, nudge(flat.userToSheet(onLine), 2, 2), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor: onLine })).toBeNull();
  });
  it('raggio: bordo compreso; appena oltre, niente', () => {
    expect(findSnap([], flat, nudge(want, 10, 0), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor })?.kind).toBe('perpendicular');
    expect(findSnap([], flat, nudge(want, 10.001, 0), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor })).toBeNull();
  });
  it('il piede si offre solo se il TRATTO passa entro il raggio dal cursore: un cursore lontano dalla linea (anche se il piede e\' vicino a lui) non lo vede', () => {
    // il piede sta sul tratto, quindi un cursore a meno di 10 pt dal piede e' anche a meno di 10 pt dal tratto: nessun caso in cui il tratto e' lontano e il piede vicino
    expect(findSnap([], flat, nudge(want, 40, 40), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor })).toBeNull();
  });
  it('un livello spento non da\' piedi; tratti sotto soglia nemmeno', () => {
    const r = buildSegmentScene(lineGeometry([line, [300, 300, 300, 300.002]], { path: [0, 1], visible: [false, true] }), flat);
    expect(r.stats).toMatchObject({ hidden: 1, tiny: 1, kept: 0 });
    expect(r.grid).toBeNull();
    // il livello spento accanto a uno acceso: solo quello acceso da' il piede
    const two = scene([line, [100, 400, 500, 520]], flat, { path: [0, 1], visible: [false, true] });
    const f2 = foot([100, 400, 500, 520], P(260, 450));
    expect(findSnap([], flat, flat.userToSheet(P(foot(line, P(260, 450)).x, foot(line, P(260, 450)).y)), 5, ONLY('perpendicular'), [], { pdfSegments: two, anchor: P(260, 450) })).toBeNull();
    close(findSnap([], flat, flat.userToSheet(P(f2.x, f2.y)), 5, ONLY('perpendicular'), [], { pdfSegments: two, anchor: P(260, 450) })!.point, flat.userToSheet(P(f2.x, f2.y)), 1e-4);
  });
});

describe('Perpendicolare: tratti del PDF e oggetti insieme', () => {
  const pdfLine: Seg = [100, 200, 500, 320];
  const src = scene([pdfLine]);
  const anchor = P(260, 450);
  it('il piu\' vicino dei due: il piede sulla linea del PDF contro il piede su una Retta disegnata', () => {
    const o: LineObject = { id: 1, kind: 'segment', points: [P(150, 500), P(450, 560)], stroke: { ...stroke } };
    const fp = foot(pdfLine, anchor);
    const fo = foot([150, 500, 450, 560], anchor);
    expect(fp.inside && fo.inside).toBe(true);
    const sp = flat.userToSheet(P(fp.x, fp.y));
    const so = flat.userToSheet(P(fo.x, fo.y));
    const nearPdf = findSnap([o], flat, nudge(sp, 1, 1), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor });
    expect(nearPdf?.kind).toBe('perpendicular');
    close(nearPdf!.point, sp, 1e-4);
    const nearObj = findSnap([o], flat, nudge(so, -1, 2), 10, ONLY('perpendicular'), [], { pdfSegments: src, anchor });
    close(nearObj!.point, so, 1e-9);
  });
  it('senza la scena del PDF, la linea del PDF non da\' alcun piede', () => {
    expect(findSnap([], flat, nudge(flat.userToSheet(P(foot(pdfLine, anchor).x, foot(pdfLine, anchor).y)), 1, 1), 10, ONLY('perpendicular'), [], { anchor })).toBeNull();
  });
  it('Intersezione e Perpendicolare accese insieme: il candidato piu\' vicino dei due tipi (a parita\' vince la priorita\': Perpendicolare dopo Intersezione)', () => {
    const o: LineObject = { id: 2, kind: 'segment', points: [P(300, 150), P(300, 450)], stroke: { ...stroke } };
    const p = { x: 300, y: 200 + (300 - 100) * 0.3 }; // incontro dell'oggetto verticale con la linea del PDF (pendenza 120/400)
    const h = findSnap([o], flat, nudge(flat.userToSheet(P(p.x, p.y)), 1, 1), 10, ONLY('intersection', 'perpendicular'), [], { pdfSegments: src, anchor: P(500, 600) });
    expect(h?.kind).toBe('intersection');
    close(h!.point, flat.userToSheet(P(p.x, p.y)), 1e-4);
  });
});

describe('tetto di vicini e dati inaspettati', () => {
  it(`piu' di PDF_MAX_NEAR (${PDF_MAX_NEAR}) tratti entro il raggio: nessun piede dal PDF; esattamente PDF_MAX_NEAR: i piedi ci sono`, () => {
    const mk = (n: number): Seg[] => Array.from({ length: n }, (_, i) => [200, 300 + i * 0.01, 400, 300 + i * 0.01] as Seg);
    const anchor = P(300, 600);
    const at = flat.userToSheet(P(300, 300));
    const atMax = scene(mk(PDF_MAX_NEAR));
    expect(findSnap([], flat, at, 10, ONLY('perpendicular'), [], { pdfSegments: atMax, anchor })?.kind).toBe('perpendicular');
    const over = scene(mk(PDF_MAX_NEAR + 1));
    expect(findSnap([], flat, at, 10, ONLY('perpendicular'), [], { pdfSegments: over, anchor })).toBeNull();
  });
  it('pagina senza tratti: scena assente, nessun candidato e nessuna eccezione; sorgente finta che dice «troppi»: nessun candidato', () => {
    const empty = buildSegmentScene(lineGeometry([]), flat);
    expect(empty.grid).toBeNull();
    expect(findSnap([], flat, flat.userToSheet(P(300, 300)), 10, ONLY('perpendicular', 'intersection'), [], { pdfSegments: empty.grid, anchor: P(10, 10) })).toBeNull();
    const many: PdfSegmentSource = { forEachNear: () => false };
    expect(findSnap([], flat, flat.userToSheet(P(300, 300)), 10, ONLY('perpendicular', 'intersection'), [], { pdfSegments: many, anchor: P(10, 10) })).toBeNull();
  });
});

describe('indice contro scansione lineare, a livello di findSnap (Perpendicolare con ancora, Intersezione, Estremo, oggetti)', () => {
  it('10.000 interrogazioni: stessa risposta con l\'indice e con la scansione lineare dei tratti (anche nei pareggi), pagine diritta e /Rotate 90 + CropBox', () => {
    const r = rng(31337);
    for (const geom of [flat, rotCrop]) {
      const w = geom.width;
      const h = geom.height;
      const segs: Seg[] = [];
      for (let i = 0; i < 900; i++) {
        const x = 60 + r() * 320;
        const y = 60 + r() * 480;
        if (i % 4 === 0) segs.push([25 * Math.round(x / 25), 25 * Math.round(y / 25), 25 * Math.round(x / 25) + 25, 25 * Math.round(y / 25)]);
        else segs.push([x, y, x + (r() - 0.5) * 80, y + (r() - 0.5) * 80]);
      }
      const g = scene(segs, geom, { path: segs.map((_, i) => Math.floor(i / 3)) });
      const lin: PdfSegmentSource = { forEachNear: (x, y, rad, max, emit) => scanSegmentsNear(g.xy, g.path, g.n, x, y, rad, max, emit) };
      const objs: PageObject[] = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, kind: 'segment', points: [P(60 + r() * 320, 60 + r() * 480), P(60 + r() * 320, 60 + r() * 480)], stroke: { ...stroke } }));
      let hits = 0;
      let perp = 0;
      for (let i = 0; i < 5000; i++) {
        const s = segs[Math.floor(r() * segs.length)]!;
        const around = geom.userToSheet(i % 3 === 0 ? P(s[0], s[1]) : i % 3 === 1 ? P((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) : P(60 + r() * 320, 60 + r() * 480));
        const raw = { x: Math.min(w, Math.max(0, around.x + (r() - 0.5) * 16)), y: Math.min(h, Math.max(0, around.y + (r() - 0.5) * 16)) };
        const radius = [2, 5, 10, 22][i % 4]!;
        const kinds = [ONLY('perpendicular'), ONLY('perpendicular', 'intersection'), ONLY('perpendicular', 'intersection', 'end', 'mid')][i % 3]!;
        const anchor = i % 5 === 0 ? null : P(60 + r() * 320, 60 + r() * 480);
        const a = findSnap(objs, geom, raw, radius, kinds, [], { pdfSegments: g, anchor });
        const b = findSnap(objs, geom, raw, radius, kinds, [], { pdfSegments: lin, anchor });
        expect(a, `interrogazione ${i}`).toEqual(b);
        if (a) hits++;
        if (a?.kind === 'perpendicular') perp++;
      }
      expect(hits).toBeGreaterThan(1500);
      expect(perp).toBeGreaterThan(150);
    }
  }, 60000);
});
