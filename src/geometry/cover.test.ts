import { describe, expect, it } from 'vitest';
import { COVER_TYPES, coverInfo, coverOnSheet, coverShapeOf, coverUserBox, coverUserRadius, squareSheet, squareUser } from './cover';
import { distToShape } from './hit';
import { PageGeometry, type PageSpec } from './page';

const ROTATIONS = [0, 90, 180, 270] as const;
const UNITS = [1, 2.5] as const;
const spec = (rotate: number, userUnit: number): PageSpec => ({ view: [50, 40, 450, 600], rotate, userUnit });

describe('squareSheet: quadrato da due punti', () => {
  const a = { x: 100, y: 100 };
  it('il lato e\' il maggiore tra |dx| e |dy| e cresce verso il punto indicato, nei quattro quadranti', () => {
    expect(squareSheet(a, { x: 130, y: 110 })).toEqual({ x: 130, y: 130 }); // dx maggiore
    expect(squareSheet(a, { x: 110, y: 140 })).toEqual({ x: 140, y: 140 }); // dy maggiore
    expect(squareSheet(a, { x: 70, y: 110 })).toEqual({ x: 70, y: 130 }); // verso sinistra, giu'
    expect(squareSheet(a, { x: 90, y: 60 })).toEqual({ x: 60, y: 60 }); // verso sinistra, su
    expect(squareSheet(a, { x: 120, y: 90 })).toEqual({ x: 120, y: 80 }); // verso destra, su
  });
  it('con dx o dy nullo cresce verso destra / verso il basso', () => {
    expect(squareSheet(a, { x: 100, y: 130 })).toEqual({ x: 130, y: 130 });
    expect(squareSheet(a, { x: 130, y: 100 })).toEqual({ x: 130, y: 130 });
  });
  it('e\' idempotente: squadrare un punto gia\' squadrato lo lascia dov\'e\'', () => {
    for (const raw of [{ x: 133, y: 107 }, { x: 61, y: 90 }, { x: 40, y: 190 }, { x: 99, y: 3 }]) {
      const once = squareSheet(a, raw);
      expect(squareSheet(a, once)).toEqual(once);
    }
  });
});

describe('coperture sul foglio e nello spazio utente (4 rotazioni x UserUnit 1 e 2.5)', () => {
  for (const rotate of ROTATIONS) {
    for (const unit of UNITS) {
      const g = new PageGeometry(spec(rotate, unit));
      const p1 = { x: 120, y: 90.5 };
      const p2 = { x: 300.25, y: 410 };
      it(`/Rotate ${rotate}, UserUnit ${unit}: il rettangolo e' allineato agli assi del foglio e agli assi utente`, () => {
        const c = coverOnSheet({ shape: 'rect', p1, p2 }, g);
        expect(c.kind).toBe('rect');
        if (c.kind !== 'rect') return;
        // i quattro angoli del rettangolo sul foglio, riportati nello spazio utente, sono i quattro angoli del rettangolo utente
        const box = coverUserBox({ shape: 'rect', p1, p2 });
        const corners = [
          { x: c.rect.x, y: c.rect.y },
          { x: c.rect.x + c.rect.w, y: c.rect.y },
          { x: c.rect.x, y: c.rect.y + c.rect.h },
          { x: c.rect.x + c.rect.w, y: c.rect.y + c.rect.h },
        ].map((s) => g.sheetToUser(s));
        const want = [
          { x: box.x, y: box.y },
          { x: box.x + box.w, y: box.y },
          { x: box.x, y: box.y + box.h },
          { x: box.x + box.w, y: box.y + box.h },
        ];
        for (const w of want) expect(corners.some((q) => Math.abs(q.x - w.x) < 1e-9 && Math.abs(q.y - w.y) < 1e-9)).toBe(true);
        // dimensioni sul foglio = dimensioni utente x UserUnit (scambiate con /Rotate 90 e 270)
        const swap = rotate === 90 || rotate === 270;
        expect(c.rect.w).toBeCloseTo((swap ? box.h : box.w) * unit, 9);
        expect(c.rect.h).toBeCloseTo((swap ? box.w : box.h) * unit, 9);
      });
      it(`/Rotate ${rotate}, UserUnit ${unit}: il quadrato e' un quadrato sul foglio e i suoi punti sono nello spazio utente`, () => {
        const p2sq = squareUser(p1, { x: 250, y: 130 }, g);
        const c = coverOnSheet({ shape: 'square', p1, p2: p2sq }, g);
        if (c.kind !== 'rect') throw new Error('atteso rettangolo');
        expect(c.rect.w).toBeCloseTo(c.rect.h, 9);
        // il lato e' il maggiore degli spostamenti sul foglio
        const s1 = g.userToSheet(p1);
        const s2 = g.userToSheet({ x: 250, y: 130 });
        expect(c.rect.w).toBeCloseTo(Math.max(Math.abs(s2.x - s1.x), Math.abs(s2.y - s1.y)), 9);
        // il primo angolo resta dov'e'
        const sp1 = g.userToSheet(p1);
        expect([c.rect.x, c.rect.x + c.rect.w].some((x) => Math.abs(x - sp1.x) < 1e-9)).toBe(true);
        expect([c.rect.y, c.rect.y + c.rect.h].some((y) => Math.abs(y - sp1.y) < 1e-9)).toBe(true);
      });
      it(`/Rotate ${rotate}, UserUnit ${unit}: il cerchio ha centro p1 e raggio = distanza in pt fisici`, () => {
        const c = coverOnSheet({ shape: 'circle', p1, p2 }, g);
        if (c.kind !== 'circle') throw new Error('atteso cerchio');
        const sc = g.userToSheet(p1);
        expect(c.circle.c.x).toBeCloseTo(sc.x, 9);
        expect(c.circle.c.y).toBeCloseTo(sc.y, 9);
        expect(c.circle.r).toBeCloseTo(coverUserRadius({ shape: 'circle', p1, p2 }) * unit, 9);
        // il punto sul bordo e' sul cerchio
        const sb = g.userToSheet(p2);
        expect(Math.hypot(sb.x - c.circle.c.x, sb.y - c.circle.c.y)).toBeCloseTo(c.circle.r, 9);
      });
    }
  }
});

describe('forma piena per la scelta con un tocco', () => {
  const g = new PageGeometry(spec(0, 1));
  it('rettangolo: distanza 0 dentro e dal bordo fuori', () => {
    const shape = coverShapeOf(coverOnSheet({ shape: 'rect', p1: { x: 100, y: 100 }, p2: { x: 200, y: 160 } }, g));
    const s = g.userToSheet({ x: 150, y: 130 });
    expect(distToShape(s, shape)).toBe(0);
    const out = g.userToSheet({ x: 210, y: 130 });
    expect(distToShape(out, shape)).toBeCloseTo(10, 9);
    expect(shape.circles).toEqual([]);
  });
  it('cerchio: distanza 0 dentro e dal bordo fuori', () => {
    const shape = coverShapeOf(coverOnSheet({ shape: 'circle', p1: { x: 150, y: 150 }, p2: { x: 180, y: 150 } }, g));
    expect(distToShape(g.userToSheet({ x: 160, y: 160 }), shape)).toBe(0);
    expect(distToShape(g.userToSheet({ x: 190, y: 150 }), shape)).toBeCloseTo(10, 9);
    expect(shape.rects).toEqual([]);
  });
});

describe('tipi di copertura', () => {
  it('rettangolo, quadrato, cerchio, con un nome per i messaggi', () => {
    expect(COVER_TYPES.map((t) => t.id)).toEqual(['rect', 'square', 'circle']);
    expect(coverInfo('square').label).toBe('Copertura quadrata');
  });
});
