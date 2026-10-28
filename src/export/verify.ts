// Controllo del PDF generato: si riapre con PDF.js (lo stesso lettore dell'app) e si confrontano numero di pagine e geometria di ogni
// pagina con quelle dell'originale. Non prova che il contenuto sia identico (nessun confronto pixel qui: costerebbe un rendering per
// pagina), ma intercetta i file che la libreria di scrittura ha prodotto troncati, senza pagine o con riquadri/rotazioni diversi.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageSpec } from '../geometry/page';
import { ExportError, toExportError } from './errors';

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.01;

export interface VerifyResult {
  pageCount: number;
  ms: number;
}

/** Lancia ExportError('verify') se il file non si riapre o le pagine non coincidono con `expected`. Non modifica `bytes` (PDF.js lavora su una copia). */
export async function verifyExport(bytes: Uint8Array, expected: readonly PageSpec[]): Promise<VerifyResult> {
  const t0 = performance.now();
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    if (doc.numPages !== expected.length) throw new ExportError('verify', `Il file generato ha ${doc.numPages} pagine, l'originale ${expected.length}.`);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const want = expected[i - 1] as PageSpec;
      const view = page.view as number[];
      const rot = (((page.rotate % 360) + 360) % 360) as number;
      const wantRot = (((want.rotate % 360) + 360) % 360) as number;
      if (!want.view.every((v, k) => near(v, view[k] as number)) || rot !== wantRot || !near(page.userUnit, want.userUnit)) {
        throw new ExportError('verify', `La pagina ${i} del file generato ha area visibile, rotazione o UserUnit diversi dall'originale.`);
      }
      page.cleanup();
    }
    return { pageCount: doc.numPages, ms: performance.now() - t0 };
  } catch (e) {
    throw toExportError(e, 'verify');
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
