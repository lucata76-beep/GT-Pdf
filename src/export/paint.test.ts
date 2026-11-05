import { describe, expect, it } from 'vitest';
import { buildDimension } from '../geometry/dimension';
import { PageGeometry } from '../geometry/page';
import type { ArcObject, CircleObject, CoverObject, DimensionObject, LineObject, TextObject } from '../model/model';
import { DRAWING_FONT, buildDrawItems } from '../model/scene';
import { dashPattern } from '../model/stroke';
import { type PaintContext, paintItems } from './paint';

/** Contesto finto che registra le chiamate con lo stato corrente. */
function recorder(): { ctx: PaintContext; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', miterLimit: 0, lineDashOffset: 0, font: '', textAlign: '', textBaseline: '' };
  let dash: number[] = [];
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'setLineDash') return (d: number[]) => { dash = d; };
      return (...a: unknown[]) => {
        const extra = k === 'stroke' ? ` w=${state.lineWidth} c=${state.strokeStyle} dash=${JSON.stringify(dash)} cap=${state.lineCap} join=${state.lineJoin} miter=${state.miterLimit}` : k === 'fill' ? ` c=${state.fillStyle}` : k === 'fillRect' || k === 'strokeRect' ? ` ${k === 'fillRect' ? 'fill' : 'stroke'}=${k === 'fillRect' ? state.fillStyle : state.strokeStyle} w=${state.lineWidth}` : k === 'fillText' ? ` font=${state.font} fill=${state.fillStyle} base=${state.textBaseline}` : '';
        log.push(`${k}(${a.map((x) => (typeof x === 'number' ? Number(x.toFixed(3)) : x)).join(',')})${extra}`);
      };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as PaintContext;
  return { ctx, log };
}

const g = new PageGeometry({ view: [0, 0, 400, 500], rotate: 0, userUnit: 1 });
const line: LineObject = { id: 1, kind: 'segment', points: [{ x: 10, y: 10 }, { x: 100, y: 50 }], stroke: { style: 'dashdot', color: '#2E7D32', widthPt: 2 } };
const rect: CoverObject = { id: 2, kind: 'cover', shape: 'rect', p1: { x: 20, y: 20 }, p2: { x: 80, y: 60 } };
const circle: CoverObject = { id: 3, kind: 'cover', shape: 'circle', p1: { x: 200, y: 200 }, p2: { x: 230, y: 200 } };
const text: TextObject = { id: 4, kind: 'text', at: { x: 50, y: 300 }, text: 'FORO Ø8 ±0.1', textPt: 12, color: '#1565C0' };
const def = buildDimension('horizontal', [{ x: 100, y: 100 }, { x: 300, y: 110 }, { x: 200, y: 150 }], g);
if (!def) throw new Error('quota degenere');
const dim: DimensionObject = { id: 5, kind: 'dim', ...def, valueText: '200.00', color: '#D32F2F', widthPt: 1, textPt: 10 };

describe('paintItems: stesse regole del livello SVG', () => {
  it('coperture bianche per prime (rettangolo pieno, cerchio come arco), anche se create dopo le linee', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([line, rect, circle], g, null));
    expect(log[0]).toBe('fillRect(20,440,60,40) fill=#ffffff w=1');
    expect(log.slice(1, 4)).toEqual(['beginPath()', `arc(200,300,30,0,${Number((Math.PI * 2).toFixed(3))})`, 'fill() c=#ffffff']);
    expect(log.findIndex((l) => l.startsWith('stroke('))).toBeGreaterThan(3);
  });
  it('linea: colore, spessore fisico, tratto-punto in pt, butt, miter 10', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([line], g, null));
    expect(log).toContain(`stroke() w=2 c=#2E7D32 dash=${JSON.stringify(dashPattern('dashdot', 2))} cap=butt join=miter miter=10`);
    expect(log.filter((l) => l.startsWith('moveTo')).length).toBe(1);
  });
  it('quota: linee piene (senza tratteggio), frecce piene, badge bianco con bordo 0.5 pt, testo in Helvetica con la linea di base', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([dim], g, null));
    const strokes = log.filter((l) => l.startsWith('stroke('));
    expect(strokes.length).toBe(3); // linea di quota + due linee di estensione
    expect(strokes.every((s) => s.includes('dash=[]') && s.includes('cap=butt'))).toBe(true);
    expect(log.filter((l) => l.startsWith('fill() c=#D32F2F')).length).toBe(2); // due frecce
    expect(log.some((l) => /^fillRect\(.*\) fill=#ffffff/.test(l))).toBe(true);
    expect(log.some((l) => /^strokeRect\(.*\) stroke=#D32F2F w=0\.5$/.test(l))).toBe(true);
    const t = log.find((l) => l.startsWith('fillText('));
    expect(t).toContain('fillText(200.00,');
    expect(t).toContain(`font=10px ${DRAWING_FONT}`);
    expect(t).toContain('base=alphabetic');
    // ordine: linee, frecce, badge, testo
    const idx = (p: string): number => log.findIndex((l) => l.startsWith(p));
    expect(idx('stroke(')).toBeLessThan(idx('fill() c=#D32F2F'));
    expect(idx('fill() c=#D32F2F')).toBeLessThan(idx('strokeRect('));
    expect(idx('strokeRect(')).toBeLessThan(idx('fillText('));
  });
  it('testo: corpo in pt fisici e colore', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([text], g, null));
    const t = log.find((l) => l.startsWith('fillText('));
    expect(t).toContain('fillText(FORO Ø8 ±0.1,50,');
    expect(t).toContain(`font=12px ${DRAWING_FONT} fill=#1565C0`);
  });
});

describe('paintItems: cerchio e arco (V2b), stessi angoli e verso dello schermo', () => {
  const st = { style: 'dashed', color: '#E65100', widthPt: 1.5 } as const;
  const circ: CircleObject = { id: 10, kind: 'circle', p1: { x: 200, y: 200 }, p2: { x: 230, y: 200 }, stroke: st };
  const DEG = Math.PI / 180;
  const at = (c: { x: number; y: number }, r: number, deg: number) => ({ x: c.x + r * Math.cos(deg * DEG), y: c.y + r * Math.sin(deg * DEG) });
  const C = { x: 150, y: 250 };
  const arcCcw: ArcObject = { id: 11, kind: 'arc', p1: at(C, 60, 20), p2: at(C, 60, 70), p3: at(C, 60, 130), stroke: st }; // antiorario sulla pagina (Y utente in su)
  const arcCw: ArcObject = { id: 12, kind: 'arc', p1: at(C, 60, 130), p2: at(C, 60, 70), p3: at(C, 60, 20), stroke: st };
  const num = (x: number): number => Number(x.toFixed(3));

  it('cerchio: solo tratto (nessun riempimento), un arco di 2 pi dall\'angolo 0 in senso orario, tratteggio in pt', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([circ], g, null));
    expect(log[0]).toBe('beginPath()');
    expect(log[1]).toBe(`arc(200,300,30,0,${num(2 * Math.PI)},false)`);
    expect(log[2]).toBe(`stroke() w=1.5 c=#E65100 dash=${JSON.stringify(dashPattern('dashed', 1.5))} cap=butt join=miter miter=10`);
    expect(log.some((l) => l.startsWith('fill'))).toBe(false);
  });
  it('arco antiorario sulla pagina non ruotata = angolo decrescente nel foglio (anticlockwise true); orario = false', () => {
    const a = recorder();
    paintItems(a.ctx, buildDrawItems([arcCcw], g, null));
    const arcLine = a.log.find((l) => l.startsWith('arc('));
    expect(arcLine).toMatch(/,true\)$/);
    const b = recorder();
    paintItems(b.ctx, buildDrawItems([arcCw], g, null));
    expect(b.log.find((l) => l.startsWith('arc('))).toMatch(/,false\)$/);
  });
  it('con /Rotate 90 il verso visto sulla pagina e\' lo stesso: anticlockwise resta true per l\'arco antiorario', () => {
    for (const rotate of [90, 180, 270]) {
      const gr = new PageGeometry({ view: [0, 0, 400, 500], rotate, userUnit: 1 });
      const a = recorder();
      paintItems(a.ctx, buildDrawItems([arcCcw], gr, null));
      expect(a.log.find((l) => l.startsWith('arc('))?.endsWith(',true)'), `rotate ${rotate}`).toBe(true);
      const b = recorder();
      paintItems(b.ctx, buildDrawItems([arcCw], gr, null));
      expect(b.log.find((l) => l.startsWith('arc('))?.endsWith(',false)'), `rotate ${rotate}`).toBe(true);
    }
  });
  it('l\'arco ha centro e raggio sul foglio e passa da p1 a p3 (angoli = quelli di p1 e p3)', () => {
    const { ctx, log } = recorder();
    paintItems(ctx, buildDrawItems([arcCcw], g, null));
    const m = /^arc\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),(true|false)\)$/.exec(log.find((l) => l.startsWith('arc(')) as string);
    expect(m).not.toBeNull();
    const [cx, cy, r, a0, a1] = [1, 2, 3, 4, 5].map((i) => Number((m as RegExpExecArray)[i]));
    expect(cx).toBeCloseTo(150, 2);
    expect(cy).toBeCloseTo(500 - 250, 2); // Y capovolta sul foglio
    expect(r).toBeCloseTo(60, 2);
    const s = g.userToSheet(arcCcw.p1);
    const e = g.userToSheet(arcCcw.p3);
    expect(cx! + r! * Math.cos(a0!)).toBeCloseTo(s.x, 2);
    expect(cy! + r! * Math.sin(a0!)).toBeCloseTo(s.y, 2);
    expect(cx! + r! * Math.cos(a1!)).toBeCloseTo(e.x, 2);
    expect(cy! + r! * Math.sin(a1!)).toBeCloseTo(e.y, 2);
  });
});
