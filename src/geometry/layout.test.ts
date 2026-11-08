import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildDimension } from './dimension';
import { distToShape } from './hit';
import {
  ARROWS_OUTSIDE_BELOW,
  ARROW_LEN_EM,
  type DimSpec,
  LABEL_PAD_EM,
  type Layout,
  type Shape,
  exportRuns,
  layoutDimension,
  layoutText,
  textRect,
  unionShapes,
} from './layout';
import { PageGeometry, type SheetPoint, type UserPoint } from './page';
import { ASCENT_EM, DESCENT_EM, textWidthPt } from './textMetrics';

const near = (a: SheetPoint, b: SheetPoint, digits = 7): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const CASES = [0, 90, 180, 270].flatMap((rotate) => [1, 2.5].map((userUnit) => ({ rotate, userUnit })));
const geomOf = (c: { rotate: number; userUnit: number }): PageGeometry => new PageGeometry({ view: [50, 50, 450, 600], rotate: c.rotate, userUnit: c.userUnit });
const SIZE = 10;
const RED = '#D32F2F';

function dimSpec(g: PageGeometry, dim: Parameters<typeof buildDimension>[0], sheetPts: SheetPoint[], extra: Partial<DimSpec> = {}): DimSpec {
  const def = buildDimension(dim, sheetPts.map((p) => g.sheetToUser(p)), g);
  if (!def) throw new Error('quota degenere');
  return { ...def, textPt: SIZE, widthPt: 1, color: RED, ...extra };
}
const rectCenter = (r: { x: number; y: number; w: number; h: number }): SheetPoint => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const unit = (v: SheetPoint): SheetPoint => ({ x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) });

describe('angolo del testo dritto sul foglio', () => {
  it('0, 90, 180, 270 per /Rotate 0, 90, 180, 270', () => {
    for (const rotate of [0, 90, 180, 270]) expect(geomOf({ rotate, userUnit: 1 }).uprightAngleDeg).toBe(rotate);
  });
  it('un vettore a quell\'angolo nello spazio utente va verso destra sul foglio (anche con UserUnit)', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const a = (g.uprightAngleDeg * Math.PI) / 180;
      const p: UserPoint = { x: 200, y: 300 };
      const q: UserPoint = { x: p.x + Math.cos(a), y: p.y + Math.sin(a) };
      const d = { x: g.userToSheet(q).x - g.userToSheet(p).x, y: g.userToSheet(q).y - g.userToSheet(p).y };
      expect(d.x).toBeCloseTo(c.userUnit, 9);
      expect(d.y).toBeCloseTo(0, 9);
    }
  });
});

describe('testo', () => {
  it('sta alla Y e X del punto, dritto, con il rettangolo da ascender a descender', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const at = g.sheetToUser({ x: 120, y: 200 });
      const l = layoutText({ at, text: 'Ø25.40', textPt: 12, color: RED }, g);
      expect(l.texts).toHaveLength(1);
      near({ x: l.texts[0]?.x ?? NaN, y: l.texts[0]?.y ?? NaN }, { x: 120, y: 200 });
      const w = textWidthPt('Ø25.40', 12);
      expect(l.hit.rects[0]).toEqual({ x: 120, y: 200 - ASCENT_EM * 12, w, h: (ASCENT_EM + DESCENT_EM) * 12 });
      expect(textRect({ x: 120, y: 200 }, 'Ø25.40', 12)).toEqual(l.hit.rects[0]);
    }
  });
  it('vuoto: nessun testo disegnato (bozza prima di scrivere)', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    expect(layoutText({ at: { x: 100, y: 100 }, text: '', textPt: 12, color: RED }, g).texts).toEqual([]);
  });
});

describe('quota orizzontale', () => {
  const S1 = { x: 100, y: 200 };
  const S2 = { x: 300, y: 210 };
  for (const c of CASES) {
    const name = `/Rotate ${c.rotate}, UserUnit ${c.userUnit}`;
    const g = geomOf(c);

    it(`linee e frecce (${name})`, () => {
      const d = dimSpec(g, 'horizontal', [S1, S2, { x: 200, y: 150 }]);
      const l = layoutDimension(d, g, '200.00');
      // linea di quota orizzontale da (100,150) a (300,150), spessore 1 pt
      near(l.lines[0]?.pts[0] as SheetPoint, { x: 100, y: 150 });
      near(l.lines[0]?.pts[1] as SheetPoint, { x: 300, y: 150 });
      expect(l.lines[0]?.widthPt).toBe(1);
      // due linee di estensione, verticali, sottili: dal punto misurato (con stacco) a oltre la linea di quota
      expect(l.lines).toHaveLength(3);
      const e1 = l.lines[1];
      expect(e1?.pts[0]?.x).toBeCloseTo(100, 7);
      expect(e1?.pts[0]?.y).toBeCloseTo(200 - 0.25 * SIZE, 7);
      expect(e1?.pts[1]?.y).toBeCloseTo(150 - 0.4 * SIZE, 7);
      expect(e1?.widthPt).toBe(0.5);
      // frecce dentro: punta sull'estremo, base verso l'interno
      expect(l.arrows).toHaveLength(2);
      const L = ARROW_LEN_EM * SIZE;
      const tips = l.arrows.map((a) => a.pts[0]);
      expect(tips).toContainEqual({ x: 100, y: 150 });
      expect(tips).toContainEqual({ x: 300, y: 150 });
      const atA = l.arrows.find((a) => a.pts[0].x === 100);
      expect(atA?.pts[1].x).toBeCloseTo(100 + L, 7);
      expect(atA?.pts[2].x).toBeCloseTo(100 + L, 7);
      expect(Math.abs((atA?.pts[1].y ?? 0) - (atA?.pts[2].y ?? 0))).toBeCloseTo((2 * L) / 6, 7);
    });

    it(`il badge sta dal lato opposto ai punti misurati e non copre la linea (${name})`, () => {
      const above = layoutDimension(dimSpec(g, 'horizontal', [S1, S2, { x: 200, y: 150 }]), g, '200.00');
      const box = above.boxes[0]?.rect;
      if (!box) throw new Error('badge');
      expect(rectCenter(box).y).toBeLessThan(150); // punti misurati sotto la linea: badge sopra
      expect(box.y + box.h).toBeLessThan(150); // non tocca la linea
      expect(rectCenter(box).x).toBeCloseTo(200, 7);
      const pad = LABEL_PAD_EM * SIZE;
      expect(box.w).toBeCloseTo(textWidthPt('200.00', SIZE) + 2 * pad, 7);
      expect(box.h).toBeCloseTo((ASCENT_EM + DESCENT_EM) * SIZE + 2 * pad, 7);
      // il testo sta dentro il badge, con la linea di base a ASCENT dal margine alto
      const t = above.texts[0];
      expect(t?.x).toBeCloseTo(box.x + pad, 7);
      expect(t?.y).toBeCloseTo(box.y + pad + ASCENT_EM * SIZE, 7);
      expect(t?.text).toBe('200.00');

      const below = layoutDimension(dimSpec(g, 'horizontal', [S1, S2, { x: 200, y: 260 }]), g, '200.00');
      const b2 = below.boxes[0]?.rect;
      if (!b2) throw new Error('badge');
      expect(b2.y).toBeGreaterThan(260); // punti misurati sopra la linea: badge sotto
    });

    it(`forma per scegliere l'oggetto: linee di quota e di estensione, e il badge (${name})`, () => {
      const l = layoutDimension(dimSpec(g, 'horizontal', [S1, S2, { x: 200, y: 150 }]), g, '200.00');
      expect(distToShape({ x: 200, y: 150 }, l.hit)).toBe(0); // sulla linea di quota
      expect(distToShape({ x: 100, y: 175 }, l.hit)).toBeCloseTo(0, 7); // sulla linea di estensione
      expect(distToShape(rectCenter(l.boxes[0]?.rect as never), l.hit)).toBe(0); // dentro il badge
      expect(distToShape({ x: 200, y: 400 }, l.hit)).toBeGreaterThan(100);
    });
  }
});

describe('quota verticale, allineata, Ø e R', () => {
  const g = geomOf({ rotate: 0, userUnit: 1 });

  it('verticale: il badge sta di lato (stessa X in verita\' a destra) con la linea intera visibile', () => {
    const l = layoutDimension(dimSpec(g, 'vertical', [{ x: 100, y: 100 }, { x: 110, y: 300 }, { x: 160, y: 200 }]), g, '200.00');
    const box = l.boxes[0]?.rect;
    if (!box) throw new Error('badge');
    expect(box.x).toBeGreaterThan(160); // punti misurati a sinistra: badge a destra della linea
    expect(rectCenter(box).y).toBeCloseTo(200, 7);
    near(l.lines[0]?.pts[0] as SheetPoint, { x: 160, y: 100 });
    near(l.lines[0]?.pts[1] as SheetPoint, { x: 160, y: 300 });
  });

  it('allineata a 45 gradi: la linea e il badge sono dal lato dell\'offset; il badge non incrocia la linea', () => {
    const l = layoutDimension(dimSpec(g, 'aligned', [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 300, y: 100 }]), g, '282.84');
    const box = l.boxes[0]?.rect;
    if (!box) throw new Error('badge');
    // offset verso (+x, -y): il centro del badge e' piu' in alto a destra della meta' della linea di quota
    const a = l.lines[0]?.pts[0] as SheetPoint;
    const b = l.lines[0]?.pts[1] as SheetPoint;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const c = rectCenter(box);
    expect(c.x - mid.x).toBeGreaterThan(0);
    expect(c.y - mid.y).toBeLessThan(0);
    // il segmento di quota non entra nel badge: distanza del badge dalla linea > 0
    let minD = Infinity;
    for (let i = 0; i <= 200; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / 200, y: a.y + ((b.y - a.y) * i) / 200 };
      const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w));
      const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h));
      minD = Math.min(minD, Math.hypot(dx, dy));
    }
    expect(minD).toBeGreaterThan(0.2 * SIZE);
  });

  it('Ø: frecce a entrambi gli estremi, nessuna linea di estensione; badge sopra la linea', () => {
    const l = layoutDimension(dimSpec(g, 'diameter', [{ x: 100, y: 200 }, { x: 200, y: 200 }]), g, 'Ø100.00');
    expect(l.lines).toHaveLength(1);
    expect(l.arrows.map((a) => a.pts[0])).toEqual(expect.arrayContaining([{ x: 100, y: 200 }, { x: 200, y: 200 }]));
    expect(l.boxes[0]?.rect.y).toBeLessThan(200);
    expect(l.texts[0]?.text).toBe('Ø100.00');
  });

  it('R: una sola freccia, sul punto del bordo (il secondo)', () => {
    const l = layoutDimension(dimSpec(g, 'radius', [{ x: 100, y: 200 }, { x: 160, y: 200 }]), g, 'R60.00');
    expect(l.arrows).toHaveLength(1);
    expect(l.arrows[0]?.pts[0]).toEqual({ x: 160, y: 200 });
    expect(l.arrows[0]?.pts[1].x).toBeLessThan(160); // la base e' verso il centro
  });

  it('quota corta: le frecce vanno fuori dalle linee di estensione', () => {
    const L = ARROW_LEN_EM * SIZE;
    const short = layoutDimension(dimSpec(g, 'horizontal', [{ x: 100, y: 200 }, { x: 100 + ARROWS_OUTSIDE_BELOW * L - 1, y: 200 }, { x: 100, y: 150 }]), g, '1.00');
    const atA = short.arrows.find((a) => a.pts[0].x === 100);
    expect(atA?.pts[1].x).toBeCloseTo(100 - L, 7); // base a sinistra della punta: fuori
    const long = layoutDimension(dimSpec(g, 'horizontal', [{ x: 100, y: 200 }, { x: 100 + ARROWS_OUTSIDE_BELOW * L + 1, y: 200 }, { x: 100, y: 150 }]), g, '1.00');
    expect(long.arrows.find((a) => a.pts[0].x === 100)?.pts[1].x).toBeCloseTo(100 + L, 7);
  });

  it('con spessore grande la freccia non e\' piu\' corta di 3 spessori; scala col corpo del testo', () => {
    const thick = layoutDimension(dimSpec(g, 'horizontal', [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 100, y: 150 }], { widthPt: 4, textPt: 6 }), g, '1.00');
    expect(thick.arrows.find((a) => a.pts[0].x === 100)?.pts[1].x).toBeCloseTo(100 + 12, 7);
    const big = layoutDimension(dimSpec(g, 'horizontal', [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 100, y: 150 }], { textPt: 20 }), g, '1.00');
    expect(big.arrows.find((a) => a.pts[0].x === 100)?.pts[1].x).toBeCloseTo(100 + 16, 7);
  });
});

describe('esportazione (CP5): i testi del layout diventano chiamate di drawText nello spazio utente', () => {
  it('exportRuns: origine in spazio utente, corpo diviso per UserUnit, angolo per rendere dritto il testo', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const layout = layoutDimension(dimSpec(g, 'horizontal', [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 200, y: 150 }]), g, 'Ø25.40');
      const runs = exportRuns(layout, g);
      expect(runs).toHaveLength(1);
      const r = runs[0];
      if (!r) throw new Error('run');
      near(g.userToSheet({ x: r.x, y: r.y }), { x: layout.texts[0]?.x ?? NaN, y: layout.texts[0]?.y ?? NaN });
      expect(r.size).toBeCloseTo(SIZE / c.userUnit, 9);
      expect(r.angleDeg).toBe(g.uprightAngleDeg);
      expect(r.text).toBe('Ø25.40');
    }
  });

  // Prova con gli strumenti veri: pdf-lib scrive il testo con i parametri di exportRuns, PDF.js lo rilegge e lo posiziona
  // nel viewport a scala 1 (= il foglio mostrato dall'app). Non e' l'esportazione di CP5: dimostra che il modello basta.
  async function roundTrip(c: { rotate: number; userUnit: number }, layout: (g: PageGeometry) => Layout): Promise<{ g: PageGeometry; layout: Layout; items: { str: string; m: number[] }[] }> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.276, 841.89]);
    page.setCropBox(50, 50, 400, 550);
    page.setRotation(degrees(c.rotate));
    if (c.userUnit !== 1) {
      const { PDFName, PDFNumber } = await import('@cantoo/pdf-lib');
      page.node.set(PDFName.of('UserUnit'), PDFNumber.of(c.userUnit));
    }
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const g = geomOf(c);
    const lay = layout(g);
    for (const r of exportRuns(lay, g)) page.drawText(r.text, { x: r.x, y: r.y, size: r.size, font, rotate: degrees(r.angleDeg), color: rgb(0.8, 0.1, 0.1) });
    const bytes = await doc.save({ useObjectStreams: false });
    const task = getDocument({ data: bytes, useSystemFonts: false, verbosity: 0 });
    const pdf = await task.promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    const items = tc.items.filter((i) => 'str' in i && i.str !== '').map((i) => ({ str: (i as { str: string }).str, m: Util.transform(vp.transform, (i as { transform: number[] }).transform) }));
    await task.destroy();
    return { g, layout: lay, items };
  }

  for (const c of CASES) {
    it(`PDF.js rilegge il testo nel punto e dritto (/Rotate ${c.rotate}, UserUnit ${c.userUnit}), con Ø ° ± R`, async () => {
      const text = 'Ø25.40 R12 ±0.1 90°';
      const { layout, items } = await roundTrip(c, (g) => layoutText({ at: g.sheetToUser({ x: 120, y: 200 }), text, textPt: 12, color: RED }, g));
      const it0 = items.find((i) => i.str === text);
      expect(it0, `testo letto: ${items.map((i) => i.str).join('|')}`).toBeDefined();
      const m = it0?.m ?? [];
      expect(m[4]).toBeCloseTo(layout.texts[0]?.x ?? NaN, 3);
      expect(m[5]).toBeCloseTo(layout.texts[0]?.y ?? NaN, 3);
      // dritto: nessuna rotazione ne' inclinazione sul foglio; corpo 12 pt fisici
      expect(Math.abs(m[1] ?? 1)).toBeLessThan(1e-6);
      expect(Math.abs(m[2] ?? 1)).toBeLessThan(1e-6);
      expect(m[0]).toBeCloseTo(12, 3);
      expect(Math.abs(m[3] ?? 0)).toBeCloseTo(12, 3);
    });
  }

  it('la quota completa: il badge e il testo di ogni tipo si scrivono con testo leggibile', async () => {
    const c = { rotate: 90, userUnit: 1 };
    const { items } = await roundTrip(c, (g) => layoutDimension(dimSpec(g, 'diameter', [{ x: 100, y: 200 }, { x: 200, y: 200 }]), g, 'Ø100.00'));
    expect(items.map((i) => i.str)).toEqual(['Ø100.00']);
  });
});

describe('unionShapes (selezione multipla, CP6e)', () => {
  const a: Shape = { lines: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]], rects: [], circles: [] };
  const b: Shape = { lines: [], rects: [{ x: 1, y: 2, w: 3, h: 4 }], circles: [{ c: { x: 5, y: 5 }, r: 2 }], arcs: [{ c: { x: 0, y: 0 }, r: 3, a0: 0, sweep: 1 }] };
  it('concatena linee, rettangoli, cerchi e archi nell\'ordine dato', () => {
    const u = unionShapes([a, b, a]);
    expect(u.lines).toHaveLength(2);
    expect(u.rects).toEqual(b.rects);
    expect(u.circles).toEqual(b.circles);
    expect(u.arcs).toEqual(b.arcs);
  });
  it('senza archi nessuna chiave `arcs` e le forme originali non cambiano', () => {
    const u = unionShapes([a]);
    expect(u.arcs).toBeUndefined();
    expect(u).toEqual({ lines: a.lines, rects: [], circles: [] });
    expect(a.lines).toHaveLength(1);
    expect(unionShapes([])).toEqual({ lines: [], rects: [], circles: [] });
  });
});

describe('quota angolare (CP6g): arco a segmenti, frecce, linee di estensione, badge', () => {
  const DEGR = Math.PI / 180;
  const V: SheetPoint = { x: 200, y: 300 };
  /** Direzione sul foglio (Y in giu') a `deg` gradi sopra l'asse X, cioe' il verso antiorario che si vede. */
  const dir = (deg: number): SheetPoint => ({ x: Math.cos(deg * DEGR), y: -Math.sin(deg * DEGR) });
  const along = (u: SheetPoint, d: number, from: SheetPoint = V): SheetPoint => ({ x: from.x + u.x * d, y: from.y + u.y * d });
  const GAP = 0.25 * SIZE; // EXT_GAP_EM
  const OVER = 0.4 * SIZE; // EXT_OVERSHOOT_EM
  const LEN = Math.max(ARROW_LEN_EM * SIZE, 3 * 1); // lunghezza della freccia: 0.8 x corpo = 8
  /** Quota angolare con vertice V, lato 1 a 0 gradi a distanza r1, lato 2 a `theta` gradi a distanza r2, raggio R. */
  const spec = (g: PageGeometry, theta: number, r1: number, r2: number, R: number, extra: Partial<DimSpec> = {}): DimSpec => dimSpec(g, 'angular', [V, along(dir(0), r1), along(dir(theta), r2), along(dir(theta / 2), R)], extra);
  const dist = (a: SheetPoint, b: SheetPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

  it('arco: polilinea dal lato 1 al lato 2 di raggio R, estremi esatti, e nessuna linea di estensione se i lati toccano l\'arco', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const l = layoutDimension(spec(g, 45, 80, 80, 80), g, '45.00°');
      expect(l.lines).toHaveLength(1);
      const arc = l.lines[0]!.pts;
      near(arc[0]!, along(dir(0), 80), 6);
      near(arc.at(-1)!, along(dir(45), 80), 6);
      for (const p of arc) expect(dist(p, V)).toBeCloseTo(80, 6);
      expect(arc.length).toBeGreaterThan(20); // 45 gradi a passi di 2 gradi al massimo
      expect(l.lines[0]!.widthPt).toBe(1);
      expect(l.lines[0]!.color).toBe(RED);
    }
  });

  it('frecce: la punta sull\'estremo dell\'arco e il corpo lungo la tangente, verso l\'interno se l\'arco e\' lungo abbastanza', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const l = layoutDimension(spec(g, 45, 80, 80, 80), g, '45.00°');
      expect(l.arrows).toHaveLength(2);
      const [a1, a2] = l.arrows as [Layout['arrows'][number], Layout['arrows'][number]];
      near(a1.pts[0], along(dir(0), 80), 6);
      near(a2.pts[0], along(dir(45), 80), 6);
      // direzione interna calcolata in modo indipendente: la componente di u2 perpendicolare a u1 (e viceversa)
      const u1 = dir(0);
      const u2 = dir(45);
      const k = u1.x * u2.x + u1.y * u2.y;
      const in1 = unit({ x: u2.x - k * u1.x, y: u2.y - k * u1.y });
      const in2 = unit({ x: u1.x - k * u2.x, y: u1.y - k * u2.y });
      const mid = (a: Layout['arrows'][number]): SheetPoint => ({ x: (a.pts[1].x + a.pts[2].x) / 2, y: (a.pts[1].y + a.pts[2].y) / 2 });
      near(mid(a1), along(in1, LEN, a1.pts[0]), 6);
      near(mid(a2), along(in2, LEN, a2.pts[0]), 6);
      // la base e' perpendicolare alla tangente, cioe' radiale, e larga 2 x (lunghezza / 6)
      expect(dist(a1.pts[1], a1.pts[2])).toBeCloseTo((2 * LEN) / 6, 9);
    }
  });

  it('arco corto (meno di 2.5 frecce): le frecce vanno fuori, lungo la tangente, dalla parte opposta', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const l = layoutDimension(spec(g, 5, 80, 80, 80), g, '5.00°'); // arco di 7 pt < 2.5 x 8
    const u1 = dir(0);
    const u2 = dir(5);
    const k = u1.x * u2.x + u1.y * u2.y;
    const in1 = unit({ x: u2.x - k * u1.x, y: u2.y - k * u1.y });
    const in2 = unit({ x: u1.x - k * u2.x, y: u1.y - k * u2.y });
    const [a1, a2] = l.arrows as [Layout['arrows'][number], Layout['arrows'][number]];
    const mid = (a: Layout['arrows'][number]): SheetPoint => ({ x: (a.pts[1].x + a.pts[2].x) / 2, y: (a.pts[1].y + a.pts[2].y) / 2 });
    near(mid(a1), along(in1, -LEN, a1.pts[0]), 6);
    near(mid(a2), along(in2, -LEN, a2.pts[0]), 6);
    // al limite: l'arco lungo esattamente 2.5 frecce sta dentro, appena meno fuori
    const R = 100;
    const edge = (2.5 * LEN) / R / DEGR; // gradi
    const inside = layoutDimension(spec(g, edge * 1.001, R, R, R), g, 'x');
    const outside = layoutDimension(spec(g, edge * 0.999, R, R, R), g, 'x');
    const body = (ly: Layout): number => (ly.arrows[0]!.pts[1].y + ly.arrows[0]!.pts[2].y) / 2 - ly.arrows[0]!.pts[0].y; // sul lato 1 (a 0 gradi) la tangente e' verticale
    expect(body(inside)).toBeLessThan(-LEN / 2); // verso l'arco, cioe' in su
    expect(body(outside)).toBeGreaterThan(LEN / 2);
  });

  it('linee di estensione: solo dove il lato non arriva all\'arco, sottili, con lo stesso stacco e la stessa sporgenza delle lineari', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const R = 80;
    // lato 1 oltre l'arco (120): torna indietro dal punto verso l'arco; lato 2 sull'arco (80): nessuna
    let l = layoutDimension(spec(g, 45, 120, 80, R), g, '45.00°');
    expect(l.lines).toHaveLength(2);
    near(l.lines[1]!.pts[0]!, along(dir(0), 120 - GAP), 6);
    near(l.lines[1]!.pts[1]!, along(dir(0), R - OVER), 6);
    expect(l.lines[1]!.widthPt).toBeLessThan(l.lines[0]!.widthPt);
    expect(l.lines[1]!.widthPt).toBeCloseTo(0.5, 9);
    // lato 1 prima dell'arco (40): va dal punto verso l'arco e lo supera
    l = layoutDimension(spec(g, 45, 40, 80, R), g, '45.00°');
    expect(l.lines).toHaveLength(2);
    near(l.lines[1]!.pts[0]!, along(dir(0), 40 + GAP), 6);
    near(l.lines[1]!.pts[1]!, along(dir(0), R + OVER), 6);
    // entrambi i lati corti: due linee
    l = layoutDimension(spec(g, 45, 40, 30, R), g, '45.00°');
    expect(l.lines).toHaveLength(3);
    near(l.lines[2]!.pts[0]!, along(dir(45), 30 + GAP), 6);
    near(l.lines[2]!.pts[1]!, along(dir(45), R + OVER), 6);
    // a meno dello stacco dall'arco: niente (come le lineari)
    l = layoutDimension(spec(g, 45, R - GAP + 0.01, R + GAP - 0.01, R), g, '45.00°');
    expect(l.lines).toHaveLength(1);
    // il punto a 1 pt dal vertice (lato dall'altra parte): la linea parte vicino al vertice
    l = layoutDimension(spec(g, 45, 1, 1, R), g, '45.00°');
    expect(l.lines).toHaveLength(3);
    near(l.lines[1]!.pts[0]!, along(dir(0), 1 + GAP), 6);
    // la hit comprende arco, linee di estensione e badge
    expect(l.hit.lines).toHaveLength(3);
    expect(l.hit.rects).toHaveLength(1);
  });

  it('badge: sul prolungamento della bisettrice, fuori dall\'arco, senza coprire le punte delle frecce; il testo e\' quello dato', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      for (const theta of [10, 45, 90, 135, 170]) {
        const l = layoutDimension(spec(g, theta, 80, 80, 80), g, `${theta}.00°`);
        const m = dir(theta / 2);
        const box = l.boxes[0]!.rect;
        const centre = rectCenter(box);
        const w = { x: centre.x - V.x, y: centre.y - V.y };
        expect(w.x * m.y - w.y * m.x).toBeCloseTo(0, 6); // sulla bisettrice
        // l'angolo del riquadro piu' vicino al vertice e' oltre l'arco (con lo stacco): il riquadro sta tutto fuori dalla circonferenza
        const corners = [
          { x: box.x, y: box.y },
          { x: box.x + box.w, y: box.y },
          { x: box.x, y: box.y + box.h },
          { x: box.x + box.w, y: box.y + box.h },
        ];
        expect(Math.min(...corners.map((p) => dist(p, V))) + 1e-9).toBeGreaterThanOrEqual(80);
        // e il centro e' piu' lontano del punto di mezzo dell'arco
        expect(Math.hypot(w.x, w.y)).toBeGreaterThan(80 + LABEL_PAD_EM * SIZE);
        for (const a of l.arrows) {
          const tip = a.pts[0];
          expect(tip.x > box.x && tip.x < box.x + box.w && tip.y > box.y && tip.y < box.y + box.h, `theta ${theta}`).toBe(false);
        }
        expect(l.texts).toHaveLength(1);
        expect(l.texts[0]!.text).toBe(`${theta}.00°`);
        expect(box.w).toBeCloseTo(textWidthPt(`${theta}.00°`, SIZE) + 2 * LABEL_PAD_EM * SIZE, 9);
        // il testo sta dentro il riquadro
        expect(l.texts[0]!.x).toBeGreaterThan(box.x);
        expect(l.texts[0]!.x + textWidthPt(l.texts[0]!.text, SIZE)).toBeLessThan(box.x + box.w);
      }
    }
  });

  it('hit: l\'arco (distanza 0 sui punti dell\'arco), le linee di estensione e il badge; fuori da tutto la distanza e\' quella vera', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const l = layoutDimension(spec(g, 60, 40, 80, 80), g, '60.00°');
    for (const p of l.lines[0]!.pts) expect(distToShape(p, l.hit)).toBeCloseTo(0, 9);
    expect(distToShape(rectCenter(l.boxes[0]!.rect), l.hit)).toBe(0);
    expect(distToShape(along(dir(0), 60), l.hit)).toBeCloseTo(0, 9); // sulla linea di estensione
    expect(distToShape(along(dir(150), 60), l.hit)).toBeGreaterThan(20); // fuori dal settore
    expect(distToShape(V, l.hit)).toBeGreaterThan(30); // il vertice non e' sull'oggetto
  });

  it('lo specchio: il layout della quota specchiata e\' lo specchio del layout (stesso arco, frecce e badge dall\'altra parte)', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const flip = (p: SheetPoint): SheetPoint => ({ x: 2 * V.x - p.x, y: p.y });
    const a = layoutDimension(spec(g, 70, 100, 60, 80), g, '70.00°');
    const mirrored = dimSpec(g, 'angular', [V, flip(along(dir(0), 100)), flip(along(dir(70), 60)), flip(along(dir(35), 80))]);
    const b = layoutDimension(mirrored, g, '70.00°');
    expect(b.lines.length).toBe(a.lines.length);
    b.lines.forEach((ln, i) => {
      expect(ln.pts.length).toBe(a.lines[i]!.pts.length);
      ln.pts.forEach((p, k) => near(p, flip(a.lines[i]!.pts[k]!), 6));
    });
    b.arrows.forEach((ar, i) => ar.pts.forEach((p, k) => near(p, flip(a.arrows[i]!.pts[k]!), 6)));
    near(rectCenter(b.boxes[0]!.rect), flip(rectCenter(a.boxes[0]!.rect)), 6);
  });

  it('179.99 gradi e 0.01 gradi: il layout si costruisce (bisettrice stabile) e il badge sta sulla bisettrice', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    for (const theta of [0.01, 179.99]) {
      const l = layoutDimension(spec(g, theta, 80, 80, 80), g, `${theta}`);
      const m = dir(theta / 2);
      const centre = rectCenter(l.boxes[0]!.rect);
      expect((centre.x - V.x) * m.y - (centre.y - V.y) * m.x, `theta ${theta}`).toBeCloseTo(0, 5);
      expect(l.lines[0]!.pts.length).toBeGreaterThanOrEqual(2);
      expect(l.lines[0]!.pts.length).toBeLessThanOrEqual(2001);
    }
  });

  it('esportazione: il testo "45.00°" esce una volta, dritto sul foglio, con il corpo in unita\' utente', () => {
    for (const c of CASES) {
      const g = geomOf(c);
      const l = layoutDimension(spec(g, 45, 80, 80, 80), g, '45.00°');
      const runs = exportRuns(l, g);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('45.00°');
      expect(runs[0]!.size).toBeCloseTo(SIZE / c.userUnit, 9);
      expect(runs[0]!.angleDeg).toBe(g.uprightAngleDeg);
    }
  });

  it('punti che non danno un angolo (non succede): solo il badge sul vertice, senza eccezioni', () => {
    const g = geomOf({ rotate: 0, userUnit: 1 });
    const ok = spec(g, 45, 80, 80, 80);
    const l = layoutDimension({ ...ok, p1: ok.a }, g, '??');
    expect(l.lines).toHaveLength(0);
    expect(l.arrows).toHaveLength(0);
    expect(l.boxes).toHaveLength(1);
    expect(l.texts).toHaveLength(1);
  });
});
