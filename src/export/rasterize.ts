// Rasterizzazione di UNA pagina per "Appiattito": PDF.js a DPI/72 su fondo bianco, poi gli oggetti con lo stesso elenco di primitive
// dell'app (`model/scene`, pittore `export/paint`), poi JPEG o PNG dal canvas. Una pagina per volta; il canvas si rilascia sempre
// (width = height = 1) anche in caso di errore.
//
// Opzioni di PDF.js (documentazione: pdfjs-dist 6.4.299, `types/src/display/api.d.ts`, `RenderParameters`):
//  - `annotationMode: AnnotationMode.ENABLE` (e' il valore predefinito, lo stesso dell'app): "includes all possible annotations (thus it
//    also depends on the intent)"; con `intent` 'display' (predefinito). Provato in Chromium (PDF.js 6.4.299) su un PDF con campo di testo,
//    casella, collegamento con bordo rosso e timbro: ENABLE disegna campo, casella e timbro, NON disegna il collegamento (nemmeno con
//    bordo); ENABLE_FORMS non disegna il campo di testo; DISABLE non disegna nulla; 'print' non cambia. Si usa ENABLE perche' l'immagine
//    deve essere quella che si vede nell'app.
//  - `background`: predefinito 'rgb(255,255,255)'; si riempie comunque di bianco (il JPEG non ha trasparenza).
//  - `transform`: "applied just before viewport transform": serve a far combaciare il canvas, di lati arrotondati al pixel
//    (come i conti di DESIGN.md: `exportPixels`), con la pagina (lati frazionari).
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PIXEL_BUDGET, exportPixels, fitsBudget } from '../geometry/pixels';
import type { DrawItem } from '../model/scene';
import { type PixelProbeContext, checkLastPixel } from './canvasCheck';
import { ExportError } from './errors';
import { type ImageFormat, fmtInt } from './flatPlan';
import { type PaintContext, paintItems } from './paint';

export interface RasterRequest {
  /** Numero della pagina (da 1), per i messaggi. */
  pageNo: number;
  /** Pagina di PDF.js; basta `getViewport` e `render`. */
  page: Pick<PDFPageProxy, 'getViewport' | 'render'>;
  /** Dimensioni del foglio mostrato in pt fisici (`PageGeometry.width/height`). */
  sheetWidthPt: number;
  sheetHeightPt: number;
  items: readonly DrawItem[];
  dpi: number;
  format: ImageFormat;
  /** Qualita' JPEG da 0 a 1 (ignorata per PNG). */
  jpegQuality: number;
}

export interface RasterResult {
  /** Formato dei byte: quello richiesto, salvo che il browser ne abbia restituito un altro (riconosciuto dai primi byte). */
  kind: ImageFormat;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Tempi in ms. */
  ms: { render: number; paint: number; encode: number };
}

/** Il sottoinsieme del canvas e del suo contesto che usiamo (si sostituisce con un finto nelle prove). */
export interface RasterContext extends PaintContext, PixelProbeContext {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}
export interface RasterCanvas {
  width: number;
  height: number;
  getContext(type: '2d', options?: { alpha?: boolean }): RasterContext | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}
export interface RasterEnv {
  createCanvas(): RasterCanvas;
  now(): number;
}
const browserEnv: RasterEnv = { createCanvas: () => document.createElement('canvas') as unknown as RasterCanvas, now: () => performance.now() };

const isJpeg = (b: Uint8Array): boolean => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array): boolean => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export async function rasterizePage(req: RasterRequest, env: RasterEnv = browserEnv, budget: number = PIXEL_BUDGET): Promise<RasterResult> {
  const { pageNo, dpi } = req;
  const px = exportPixels(req.sheetWidthPt, req.sheetHeightPt, dpi);
  const where = `della pagina ${pageNo} a ${dpi} dpi`;
  const fail = (message: string, cause?: unknown): never => {
    throw new ExportError('canvas', message, cause, pageNo);
  };
  if (!fitsBudget(px.area, budget)) fail(`L'immagine ${where} sarebbe di ${px.w} x ${px.h} px (${fmtInt(px.area)} px), oltre il tetto di ${fmtInt(budget)} px.`);

  const canvas = env.createCanvas();
  try {
    canvas.width = px.w;
    canvas.height = px.h;
    if (canvas.width !== px.w || canvas.height !== px.h) fail(`Il dispositivo non crea un'immagine di ${px.w} x ${px.h} px ${where}: il canvas è stato ridotto a ${canvas.width} x ${canvas.height} px.`);
    // alpha: false -> il PNG del canvas e' RGB (Chromium) e si puo' inserire senza decodificarlo (`flatImage`); il JPEG non ha trasparenza comunque
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return fail(`Il dispositivo non crea un'immagine di ${px.w} x ${px.h} px (${fmtInt(px.area)} px) ${where}: il canvas non è disponibile.`);

    // Ultimo pixel (decisione 4): sopra il limite iOS non da' errori, il canvas e' solo vuoto
    const probe = checkLastPixel(ctx, px.w, px.h);
    if (!probe.ok) {
      const what = probe.error ? `la lettura è fallita (${probe.error})` : `il pixel scritto si rilegge come (${probe.read.join(', ')}) invece che come scritto`;
      fail(`Il dispositivo non ha memoria per un'immagine di ${px.w} x ${px.h} px (${fmtInt(px.area)} px) ${where}: l'ultimo pixel non è confermato, ${what}.`);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px.w, px.h);

    const t0 = env.now();
    const viewport = req.page.getViewport({ scale: dpi / 72 });
    await req.page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      transform: [px.w / viewport.width, 0, 0, px.h / viewport.height, 0, 0],
      annotationMode: AnnotationMode.ENABLE,
      background: '#ffffff',
    }).promise;
    const t1 = env.now();

    // gli oggetti: coordinate in pt del foglio, quindi una scala sola per lato (come `transform` sopra)
    ctx.save();
    ctx.setTransform(px.w / req.sheetWidthPt, 0, 0, px.h / req.sheetHeightPt, 0, 0);
    paintItems(ctx, req.items);
    ctx.restore();
    const t2 = env.now();

    const mime = req.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, req.format === 'jpeg' ? req.jpegQuality : undefined));
    if (!blob || blob.size === 0) fail(`Il dispositivo non riesce a codificare in ${req.format.toUpperCase()} l'immagine di ${px.w} x ${px.h} px ${where}.`);
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const kind: ImageFormat = isJpeg(bytes) ? 'jpeg' : isPng(bytes) ? 'png' : req.format;
    return { kind, bytes, width: px.w, height: px.h, ms: { render: t1 - t0, paint: t2 - t1, encode: env.now() - t2 } };
  } finally {
    canvas.width = 1;
    canvas.height = 1; // rilascia subito la memoria del canvas
  }
}
