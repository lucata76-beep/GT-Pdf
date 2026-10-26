// Apertura dei PDF con PDF.js (build legacy: la build normale richiede Safari/iOS 26.2+ senza polyfill).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export type { PDFDocumentProxy, PDFPageProxy, RenderTask };

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Gli asset (wasm, font standard, ICC) sono copiati in pdfjs/ da scripts/copy-pdfjs-assets.mjs.
// URL assoluti: il worker li risolverebbe altrimenti rispetto al proprio file in assets/.
const assetBase = new URL('pdfjs/', document.baseURI).href;

export interface PageInfo {
  index: number; // da 1
  rotate: number; // /Rotate della pagina
  view: [number, number, number, number]; // MediaBox ∩ CropBox, spazio utente PDF
  userUnit: number;
  /** Dimensioni della vista (con Rotate e CropBox applicati), in pt PDF. */
  widthPt: number;
  heightPt: number;
}

export interface OpenedPdf {
  name: string;
  /** Byte originali: non vengono mai modificati. PDF.js riceve una copia. */
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  /** In PDF.js 6 la distruzione passa dal task di caricamento (PDFDocumentProxy.destroy e' stato rimosso). */
  task: PDFDocumentLoadingTask;
  pages: PageInfo[];
  openMs: number;
}

export async function openPdf(name: string, bytes: Uint8Array): Promise<OpenedPdf> {
  const t0 = performance.now();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    wasmUrl: `${assetBase}wasm/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    iccUrl: `${assetBase}iccs/`,
    // Font non incorporati: sempre quelli inclusi (Foxit/Liberation, metricamente compatibili con Helvetica/Times/Courier),
    // cosi' l'impaginazione e' uguale su ogni dispositivo.
    useSystemFonts: false,
  });
  const doc = await task.promise;
  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({
      index: i,
      rotate: page.rotate,
      view: page.view as [number, number, number, number],
      userUnit: page.userUnit,
      widthPt: vp.width,
      heightPt: vp.height,
    });
  }
  return { name, bytes, doc, task, pages, openMs: performance.now() - t0 };
}

export async function closePdf(pdf: OpenedPdf): Promise<void> {
  await pdf.task.destroy();
}
