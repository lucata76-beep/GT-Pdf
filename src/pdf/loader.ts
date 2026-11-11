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
  /** Seconda istanza di PDF.js sugli stessi byte, creata alla prima lettura dei punti dello snap (`opsDocument`): vedi la nota li'. */
  ops?: { task: PDFDocumentLoadingTask; doc: Promise<PDFDocumentProxy> };
}

/** Opzioni di PDF.js per un documento: le stesse per quello del visore e per quello delle letture dello snap. */
function docOptions(bytes: Uint8Array): Parameters<typeof pdfjs.getDocument>[0] {
  return {
    data: bytes.slice(),
    wasmUrl: `${assetBase}wasm/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    iccUrl: `${assetBase}iccs/`,
    // Font non incorporati: sempre quelli inclusi (Foxit/Liberation, metricamente compatibili con Helvetica/Times/Courier),
    // cosi' l'impaginazione e' uguale su ogni dispositivo.
    useSystemFonts: false,
  };
}

export async function openPdf(name: string, bytes: Uint8Array): Promise<OpenedPdf> {
  const t0 = performance.now();
  const task = pdfjs.getDocument(docOptions(bytes));
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

/**
 * Il documento di PDF.js per LEGGERE i tratti del disegno (snap sul PDF, V3.1): una SECONDA istanza sugli stessi byte (un'altra copia dei byte e un altro lavoratore), creata la
 * prima volta che serve e distrutta con il documento. NON si usa `pdf.doc` perche' misurato in Chromium (CP7b, `scripts/e2e-cp7b.cjs` e le prove nello scratch): una `getOperatorList()`
 * in parallelo a un `render()` della STESSA pagina, nello stesso documento, da' un elenco SBAGLIATO quando la pagina ha annotazioni con un aspetto proprio (nel PDF di prova
 * con timbro, campo e casella: 216 operazioni invece di 225, senza il contenuto del timbro; con l'ordine inverso 231, con operazioni in piu') e il visore parte sempre subito
 * dopo `setPage`. Con un documento a parte la lettura non tocca ne' la resa ne' lo stato delle pagine del visore. Costo: memoria (i byte e l'analisi del PDF si ripetono).
 */
export function opsDocument(pdf: OpenedPdf): Promise<PDFDocumentProxy> {
  if (!pdf.ops) {
    const task = pdfjs.getDocument(docOptions(pdf.bytes));
    pdf.ops = { task, doc: task.promise };
  }
  return pdf.ops.doc;
}

export async function closePdf(pdf: OpenedPdf): Promise<void> {
  await Promise.allSettled([pdf.task.destroy(), pdf.ops?.task.destroy()]);
}
