import { describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import type { CoverObject } from '../model/model';
import { buildDrawItems } from '../model/scene';
import { ExportError, describeExportError } from './errors';
import { type RasterCanvas, type RasterContext, type RasterEnv, type RasterRequest, rasterizePage } from './rasterize';

interface Fake {
  canvas: RasterCanvas & { released: () => boolean; calls: string[] };
  env: RasterEnv;
  renderArgs: unknown[];
}
type Mode = 'ok' | 'silent-fail' | 'no-context' | 'clamped' | 'null-blob' | 'throws';

function fake(mode: Mode, blobBytes: number[] = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]): Fake {
  const calls: string[] = [];
  let width = 0;
  let height = 0;
  let color: number[] = [0, 0, 0, 0];
  let lastFill = '';
  const ctx: RasterContext = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    miterLimit: 10,
    lineDashOffset: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    fill() {},
    stroke() {},
    strokeRect() {},
    fillText() {},
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    setTransform(a, _b, _c, d) { calls.push(`setTransform(${a.toFixed(6)},${d.toFixed(6)})`); },
    fillRect(x, y, w, h) {
      lastFill = String(ctx.fillStyle);
      calls.push(`fillRect(${x},${y},${w},${h},${lastFill})`);
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(lastFill);
      if (m) color = mode === 'silent-fail' ? [0, 0, 0, 0] : [Number(m[1]), Number(m[2]), Number(m[3]), 255];
    },
    getImageData() {
      if (mode === 'throws') throw Object.assign(new Error('boom'), { name: 'RangeError' });
      return { data: color };
    },
  };
  const canvas = {
    get width() { return width; },
    set width(v: number) { width = mode === 'clamped' ? Math.min(v, 2000) : v; },
    get height() { return height; },
    set height(v: number) { height = v; },
    getContext: () => (mode === 'no-context' ? null : ctx),
    toBlob(cb: (b: Blob | null) => void) { cb(mode === 'null-blob' ? null : new Blob([Uint8Array.from(blobBytes)])); },
    released: () => width === 1 && height === 1,
    calls,
  };
  return { canvas, env: { createCanvas: () => canvas, now: () => 0 }, renderArgs: [] };
}

const spec = { view: [0, 0, 595.276, 841.89] as [number, number, number, number], rotate: 0, userUnit: 1 };
const g = new PageGeometry(spec);
const cover: CoverObject = { id: 1, kind: 'cover', shape: 'rect', p1: { x: 10, y: 10 }, p2: { x: 100, y: 60 } };

function request(f: Fake, over: Partial<RasterRequest> = {}): RasterRequest {
  return {
    pageNo: 2,
    page: {
      getViewport: ({ scale }: { scale: number }) => ({ width: g.width * scale, height: g.height * scale }),
      render: (p: unknown) => { f.renderArgs.push(p); return { promise: Promise.resolve() }; },
    } as unknown as RasterRequest['page'],
    sheetWidthPt: g.width,
    sheetHeightPt: g.height,
    items: buildDrawItems([cover], g, null),
    dpi: 300,
    format: 'jpeg',
    jpegQuality: 0.85,
    ...over,
  };
}

describe('rasterizePage', () => {
  it('A4 a 300 dpi: canvas 2480 x 3508, ultimo pixel confermato, fondo bianco, PDF.js con ENABLE, oggetti dopo, JPEG', async () => {
    const f = fake('ok');
    const r = await rasterizePage(request(f), f.env);
    expect(r).toMatchObject({ kind: 'jpeg', width: 2480, height: 3508 });
    expect(Array.from(r.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    const c = f.canvas.calls;
    expect(c[0]).toBe('fillRect(2479,3507,1,1,rgb(18,52,86))'); // pixel di prova nell'angolo estremo
    expect(c[1]).toBe('fillRect(0,0,2480,3508,#ffffff)'); // poi fondo bianco su tutto
    const arg = f.renderArgs[0] as { annotationMode: number; transform: number[]; background: string };
    expect(arg.annotationMode).toBe(1); // AnnotationMode.ENABLE
    expect(arg.background).toBe('#ffffff');
    expect(arg.transform[0]).toBeCloseTo(2480 / (595.276 * (300 / 72)), 9);
    expect(c.findIndex((x) => x.startsWith('setTransform'))).toBeGreaterThan(1); // gli oggetti dopo PDF.js
    expect(c).toContain(`setTransform(${(2480 / g.width).toFixed(6)},${(3508 / g.height).toFixed(6)})`);
    expect(f.canvas.released()).toBe(true);
  });
  it('PNG: il tipo si riconosce dai byte restituiti dal browser', async () => {
    const f = fake('ok', [0x89, 0x50, 0x4e, 0x47, 0, 0]);
    expect((await rasterizePage(request(f, { format: 'png' }), f.env)).kind).toBe('png');
    const g2 = fake('ok', [0x89, 0x50, 0x4e, 0x47, 0, 0]); // chiesto JPEG, il browser ha dato PNG: si dice la verita'
    expect((await rasterizePage(request(g2), g2.env)).kind).toBe('png');
  });
  it('SIMULAZIONE del fallimento in silenzio (iOS sopra il limite): ultimo pixel riletto 0,0,0,0 -> ExportError "canvas", canvas rilasciato, nessun render', async () => {
    const f = fake('silent-fail');
    const err = await rasterizePage(request(f), f.env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect((err as ExportError).code).toBe('canvas');
    expect((err as ExportError).page).toBe(2);
    const d = describeExportError(err);
    expect(d.title).toBe('Immagine troppo grande per questo dispositivo');
    expect(d.message).toContain('2480 x 3508 px (8.699.840 px) della pagina 2 a 300 dpi');
    expect(d.message).toContain('(0, 0, 0, 0)');
    expect(d.message).toContain('Scegli un DPI più basso');
    expect(d.message).toContain('nulla è stato perso');
    expect(f.renderArgs).toHaveLength(0);
    expect(f.canvas.released()).toBe(true);
  });
  it('getImageData che lancia, getContext nullo, canvas ridotto, toBlob nullo: tutti fermano l\'esportazione con messaggio e canvas rilasciato', async () => {
    for (const [mode, text] of [['throws', 'RangeError: boom'], ['no-context', 'il canvas non e\' disponibile'], ['clamped', 'ridotto a 2000 x 3508 px'], ['null-blob', 'non riesce a codificare in JPEG']] as const) {
      const f = fake(mode);
      const err = await rasterizePage(request(f, { dpi: 300 }), f.env).catch((e: unknown) => e);
      expect((err as ExportError).code, mode).toBe('canvas');
      expect((err as ExportError).message, mode).toContain(text);
      expect(f.canvas.released(), mode).toBe(true);
    }
  });
  it('sopra il tetto (A3 a 600 dpi = 69.605.736 px): errore prima di creare il canvas', async () => {
    const f = fake('ok');
    let created = 0;
    const env: RasterEnv = { createCanvas: () => { created++; return f.canvas; }, now: () => 0 };
    const err = await rasterizePage(request(f, { dpi: 600, sheetWidthPt: 1190.551, sheetHeightPt: 841.89 }), env).catch((e: unknown) => e);
    expect((err as ExportError).code).toBe('canvas');
    expect((err as ExportError).message).toContain('69.605.736 px), oltre il tetto di 67.108.864 px');
    expect(created).toBe(0);
  });
  it('errore di PDF.js durante il render: il canvas si rilascia comunque', async () => {
    const f = fake('ok');
    const req = request(f);
    (req.page as unknown as { render: () => unknown }).render = () => ({ promise: Promise.reject(new Error('render fallito')) });
    await expect(rasterizePage(req, f.env)).rejects.toThrow('render fallito');
    expect(f.canvas.released()).toBe(true);
  });
});
