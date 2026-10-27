import { PDFDocument, PDFName, PDFNumber, degrees } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { distToPolyline, distToSegment, pickNearest } from './hit';
import { orthoSheet, orthoUser } from './ortho';
import { PageGeometry, type PageSpec, type Pt } from './page';
import { mmToPt } from './pixels';
import { calibrate, realMm } from './scale';

const A4_CROP: PageSpec = { view: [50, 50, 450, 600], rotate: 90, userUnit: 1 }; // come a4-cropbox.pdf con /Rotate 90
const near = (a: Pt, b: Pt, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

// Pagine vere create con pdf-lib e lette da PDF.js: il confronto passa per page.view / page.rotate / page.userUnit
// e per getViewport({ scale: 1 }), cioe' per quello che usa l'app.
async function loadPage(opts: { media?: [number, number, number, number]; crop?: [number, number, number, number]; rotate: number; userUnit: number }): Promise<PDFPageProxy> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.276, 841.89]);
  if (opts.media) page.setMediaBox(...opts.media);
  if (opts.crop) page.setCropBox(...opts.crop);
  page.setRotation(degrees(opts.rotate));
  if (opts.userUnit !== 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(opts.userUnit));
  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = await getDocument({ data: bytes, useSystemFonts: false, verbosity: 0 }).promise;
  return pdf.getPage(1);
}

describe('PageGeometry coincide con il viewport a scala 1 di PDF.js (pagine vere)', () => {
  const cases: { name: string; media?: [number, number, number, number]; crop?: [number, number, number, number] }[] = [
    { name: 'A4' },
    { name: 'A4 con CropBox [50 50 450 600]', crop: [50, 50, 400, 550] },
    { name: 'MediaBox con origine negativa', media: [-20, 10, 320, 490] },
  ];
  for (const c of cases) {
    for (const rotate of [0, 90, 180, 270]) {
      for (const userUnit of [1, 2.5]) {
        it(`${c.name}, /Rotate ${rotate}, UserUnit ${userUnit}`, async () => {
          const page = await loadPage({ ...c, rotate, userUnit });
          expect(page.rotate).toBe(rotate);
          expect(page.userUnit).toBe(userUnit);
          const g = new PageGeometry({ view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit });
          const vp = page.getViewport({ scale: 1 });
          expect(g.width).toBeCloseTo(vp.width, 9);
          expect(g.height).toBeCloseTo(vp.height, 9);
          const [x0, y0, x1, y1] = page.view as [number, number, number, number];
          for (const u of [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: (x0 + x1) / 2 + 7, y: y0 + 33 }]) {
            const [vx, vy] = vp.convertToViewportPoint(u.x, u.y) as [number, number];
            near(g.userToSheet(u), { x: vx, y: vy });
            near(g.sheetToUser({ x: vx, y: vy }), u);
            const [px, py] = vp.convertToPdfPoint(vx, vy) as [number, number];
            near(g.sheetToUser({ x: vx, y: vy }), { x: px, y: py });
          }
        });
      }
    }
  }
});

describe('pagina con /Rotate 90 + CropBox [50 50 450 600]', () => {
  const g = new PageGeometry(A4_CROP);

  it('il foglio mostrato e\' 550 x 400 pt (CropBox ruotato)', () => {
    expect(g.width).toBe(550);
    expect(g.height).toBe(400);
  });

  it('gli angoli del CropBox vanno agli angoli del foglio (rotazione oraria)', () => {
    near(g.userToSheet({ x: 50, y: 50 }), { x: 0, y: 0 }); // in basso a sinistra -> in alto a sinistra
    near(g.userToSheet({ x: 50, y: 600 }), { x: 550, y: 0 });
    near(g.userToSheet({ x: 450, y: 600 }), { x: 550, y: 400 });
    near(g.userToSheet({ x: 450, y: 50 }), { x: 0, y: 400 });
  });

  it('andata e ritorno spazio utente <-> foglio', () => {
    for (const u of [{ x: 100, y: 100 }, { x: 321.5, y: 77.25 }, { x: 449, y: 599 }]) near(g.sheetToUser(g.userToSheet(u)), u);
  });

  it('la distanza in pt fisici non cambia con la rotazione', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 100 + mmToPt(100), y: 100 };
    expect(g.distancePt(a, b)).toBeCloseTo(283.4646, 3);
    const sa = g.userToSheet(a);
    const sb = g.userToSheet(b);
    expect(Math.hypot(sb.x - sa.x, sb.y - sa.y)).toBeCloseTo(283.4646, 3);
  });

  it('UserUnit: la distanza fisica scala con UserUnit', () => {
    const g2 = new PageGeometry({ ...A4_CROP, userUnit: 2 });
    expect(g2.distancePt({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(20, 9);
    expect(g2.width).toBe(1100);
  });

  it('contains: bordo compreso, fuori no', () => {
    expect(g.contains({ x: 0, y: 0 })).toBe(true);
    expect(g.contains({ x: 550, y: 400 })).toBe(true);
    expect(g.contains({ x: 550.01, y: 10 })).toBe(false);
    expect(g.contains({ x: -0.01, y: 10 })).toBe(false);
  });

  it('rotazione non multipla di 90: errore', () => {
    expect(() => new PageGeometry({ view: [0, 0, 100, 100], rotate: 45, userUnit: 1 })).toThrow();
  });
});

describe('ortogonale: orizzontale/verticale come appare sullo schermo', () => {
  it('nel foglio: asse dominante, a parita\' orizzontale', () => {
    expect(orthoSheet({ x: 10, y: 10 }, { x: 100, y: 30 })).toEqual({ x: 100, y: 10 });
    expect(orthoSheet({ x: 10, y: 10 }, { x: 30, y: 100 })).toEqual({ x: 10, y: 100 });
    expect(orthoSheet({ x: 10, y: 10 }, { x: 50, y: 50 })).toEqual({ x: 50, y: 10 });
    expect(orthoSheet({ x: 10, y: 10 }, { x: -80, y: 5 })).toEqual({ x: -80, y: 10 });
  });

  it('senza /Rotate: orizzontale sullo schermo = orizzontale nello spazio utente', () => {
    const g = new PageGeometry({ view: [0, 0, 595, 842], rotate: 0, userUnit: 1 });
    const anchor = { x: 100, y: 300 };
    const raw = g.sheetToUser({ x: 400, y: g.userToSheet(anchor).y + 12 }); // quasi orizzontale sullo schermo
    const r = orthoUser(g, anchor, raw);
    expect(r.y).toBeCloseTo(anchor.y, 9);
    expect(r.x).toBeCloseTo(raw.x, 9);
  });

  it('/Rotate 90 + CropBox: orizzontale sullo schermo = VERTICALE nello spazio utente', () => {
    const g = new PageGeometry(A4_CROP);
    const anchor = { x: 100, y: 100 }; // foglio: (50, 50)
    const rawSheet = { x: 250, y: 60 }; // quasi orizzontale sullo schermo (dx 200, dy 10)
    const r = orthoUser(g, anchor, g.sheetToUser(rawSheet));
    // sullo schermo: stessa y dell'ancora, x del punto
    const rs = g.userToSheet(r);
    expect(rs.y).toBeCloseTo(50, 9);
    expect(rs.x).toBeCloseTo(250, 9);
    // nello spazio utente: la x non cambia (verticale)
    expect(r.x).toBeCloseTo(anchor.x, 9);
    expect(r.y).toBeCloseTo(300, 9);
  });

  it('/Rotate 90 + CropBox: verticale sullo schermo = ORIZZONTALE nello spazio utente', () => {
    const g = new PageGeometry(A4_CROP);
    const anchor = { x: 100, y: 100 };
    const rawSheet = { x: 60, y: 250 }; // quasi verticale sullo schermo (dx 10, dy 200)
    const r = orthoUser(g, anchor, g.sheetToUser(rawSheet));
    const rs = g.userToSheet(r);
    expect(rs.x).toBeCloseTo(50, 9);
    expect(rs.y).toBeCloseTo(250, 9);
    expect(r.y).toBeCloseTo(anchor.y, 9);
    expect(r.x).toBeCloseTo(300, 9);
  });

  it('per ogni rotazione il risultato e\' orizzontale o verticale sullo schermo', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const g = new PageGeometry({ view: [50, 50, 450, 600], rotate, userUnit: 1 });
      const anchor = { x: 120, y: 200 };
      for (const raw of [{ x: 300, y: 260 }, { x: 140, y: 500 }, { x: 80, y: 90 }, { x: 410, y: 210 }]) {
        const a = g.userToSheet(anchor);
        const r = g.userToSheet(orthoUser(g, anchor, raw));
        const horizontal = Math.abs(r.y - a.y) < 1e-9;
        const vertical = Math.abs(r.x - a.x) < 1e-9;
        expect(horizontal || vertical).toBe(true);
      }
    }
  });
});

describe('punti e distanze su pagina /Rotate 90 + CropBox, con scala', () => {
  it('100 mm sul foglio misurati in qualunque direzione danno 283.46 pt e 100 mm con scala 1:1', () => {
    const g = new PageGeometry(A4_CROP);
    const a = g.sheetToUser({ x: 100, y: 100 });
    const b = g.sheetToUser({ x: 100 + mmToPt(100), y: 100 }); // 100 mm orizzontali sullo schermo
    const d = g.distancePt(a, b);
    expect(d).toBeCloseTo(283.46, 2);
    const s = calibrate(d, 100);
    if (!s) throw new Error('scala non calcolata');
    const c = g.sheetToUser({ x: 100, y: 100 + mmToPt(50) }); // 50 mm verticali sullo schermo
    expect(realMm(g.distancePt(a, c), s)).toBeCloseTo(50, 6);
  });
});

describe('hit-test (cancella con un tocco)', () => {
  it('distanza punto-segmento', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5); // oltre l'estremo
    expect(distToSegment({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 })).toBeCloseTo(Math.SQRT2, 12); // segmento degenere
  });
  it('distanza punto-spezzata: il minimo fra i segmenti', () => {
    const pl = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distToPolyline({ x: 12, y: 5 }, pl)).toBe(2);
  });
  it('pickNearest: entro la tolleranza, il piu\' vicino; a parita\' l\'ultimo; fuori tolleranza niente', () => {
    const items = [
      { id: 1, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 2, pts: [{ x: 0, y: 4 }, { x: 100, y: 4 }] },
      { id: 3, pts: [{ x: 0, y: 4 }, { x: 100, y: 4 }] },
    ];
    const pts = (i: (typeof items)[number]): Pt[] => i.pts;
    expect(pickNearest(items, pts, { x: 50, y: 1 }, 5)?.id).toBe(1);
    expect(pickNearest(items, pts, { x: 50, y: 3 }, 5)?.id).toBe(3); // 2 e 3 a pari distanza: l'ultimo
    expect(pickNearest(items, pts, { x: 50, y: 30 }, 5)).toBeNull();
  });
});
