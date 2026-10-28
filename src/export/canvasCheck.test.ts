import { describe, expect, it } from 'vitest';
import { PROBE_CSS, type PixelProbeContext, checkLastPixel } from './canvasCheck';

/** Canvas finto: ricorda cio' che si scrive (come un canvas che funziona) oppure rilegge sempre (0,0,0,0) (come iOS sopra il limite). */
function fake(mode: 'works' | 'silent-fail' | 'throws' | 'wrong-color', w: number, h: number): PixelProbeContext & { writes: [number, number][] } {
  const writes: [number, number][] = [];
  let color: number[] = [0, 0, 0, 0];
  const ctx = {
    writes,
    fillStyle: '',
    fillRect(x: number, y: number) {
      writes.push([x, y]);
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(String(ctx.fillStyle));
      color = m ? [Number(m[1]), Number(m[2]), Number(m[3]), 255] : [0, 0, 0, 0];
    },
    getImageData(x: number, y: number) {
      if (mode === 'throws') throw Object.assign(new Error('The canvas is too large'), { name: 'IndexSizeError' });
      if (x !== w - 1 || y !== h - 1) return { data: [0, 0, 0, 0] };
      if (mode === 'silent-fail') return { data: [0, 0, 0, 0] };
      if (mode === 'wrong-color') return { data: [255, 255, 255, 255] };
      return { data: color };
    },
  };
  return ctx;
}

describe('checkLastPixel', () => {
  it('canvas che funziona: scrive e rilegge il pixel dell\'angolo estremo (w-1, h-1), colore opaco di prova', () => {
    const c = fake('works', 8192, 8192);
    expect(checkLastPixel(c, 8192, 8192)).toEqual({ ok: true });
    expect(c.writes).toEqual([[8191, 8191]]);
    expect(c.fillStyle).toBe(PROBE_CSS);
  });
  it('fallimento in silenzio (pixel riletto 0,0,0,0, nessuna eccezione, come iOS sopra il limite): non ok, con i valori letti', () => {
    const r = checkLastPixel(fake('silent-fail', 9921, 7016), 9921, 7016);
    expect(r).toEqual({ ok: false, read: [0, 0, 0, 0], error: null });
  });
  it('un colore diverso da quello scritto (per esempio il fondo bianco) non e\' una conferma', () => {
    const r = checkLastPixel(fake('wrong-color', 100, 100), 100, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.read).toEqual([255, 255, 255, 255]);
  });
  it('getImageData che lancia (alcuni browser): non ok, con il nome dell\'errore', () => {
    const r = checkLastPixel(fake('throws', 100, 100), 100, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('IndexSizeError: The canvas is too large');
  });
  it('il lato conta: un canvas largo che fallisce solo in larghezza viene colto dal pixel in ultima colonna', () => {
    // canvas finto che ricorda solo le prime 8192 colonne
    const w = 20000;
    const h = 100;
    let color: number[] = [0, 0, 0, 0];
    const ctx: PixelProbeContext = {
      fillStyle: '',
      fillRect(x) {
        const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(String(ctx.fillStyle));
        color = x < 8192 && m ? [Number(m[1]), Number(m[2]), Number(m[3]), 255] : [0, 0, 0, 0];
      },
      getImageData: () => ({ data: color }),
    };
    expect(checkLastPixel(ctx, w, h).ok).toBe(false);
    expect(checkLastPixel(ctx, 8000, h).ok).toBe(true);
  });
});
