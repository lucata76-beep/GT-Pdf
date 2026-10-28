// Esportazione "Appiattito" (decisioni 20, 21 di docs/PIANO.md): le pagine CON oggetti diventano un'immagine (JPEG o PNG) che riempie la
// pagina; le altre non si toccano (decisione 21). L'originale non si modifica: pdf-lib lavora in memoria e `save()` scrive altri byte.
//
// Come si ricostruisce una pagina appiattita, e perche': la pagina NON si crea ex novo ma si **riscrive sul posto**. Restano il dizionario
// della pagina con le sue chiavi geometriche (MediaBox, CropBox, BleedBox, TrimBox, ArtBox, /Rotate, /UserUnit: ereditate o proprie, non si
// toccano), il gruppo di trasparenza e la posizione nell'albero delle pagine. Cosi' area visibile, rotazione e UserUnit sono per costruzione
// quelli dell'originale (nessuna riscrittura dei riquadri, nessun rischio di sbagliare un'eredita'). Cambiano solo: /Contents (un flusso
// `q <matrice> cm /GtFlat Do Q`), /Resources (la sola immagine) e si tolgono tutte le altre chiavi (annotazioni, miniatura, dati privati,
// azioni, strutture di tag...). La matrice porta il quadrato unitario dell'immagine sull'area visibile tenendo conto di /Rotate e CropBox
// (`flatImageMatrix`, con le stesse formule di `PageGeometry`, verificate contro il viewport di PDF.js). Poi `prune` toglie dal file il
// vecchio contenuto, altrimenti il testo sotto le coperture resterebbe nel file.
import { PDFDocument, PDFName, type PDFObject, type PDFPage, type PDFRef } from '@cantoo/pdf-lib';
import { PageGeometry, type PageSpec } from '../geometry/page';
import { type ExportPage, type ExportWarning, checkSamePage } from './coverSimple';
import { ExportError, toExportError } from './errors';
import { type EmbedVia, embedFlatImage } from './flatImage';
import { PAGE_KEEP_KEYS, annotationRefs, pageGarbageCandidates, pruneOrphans, removeFormFields } from './prune';
import type { RasterResult } from './rasterize';

export type Matrix6 = readonly [number, number, number, number, number, number];

/**
 * Matrice `cm` che porta il quadrato unitario dell'immagine (origine in basso a sinistra, prima riga di pixel in alto) sull'area visibile
 * della pagina nello spazio utente. L'immagine e' il foglio MOSTRATO (con /Rotate): il suo angolo in alto a sinistra e' l'origine del foglio.
 */
export function flatImageMatrix(geom: PageGeometry): Matrix6 {
  const o = geom.sheetToUser({ x: 0, y: geom.height }); // pixel in basso a sinistra dell'immagine
  const x = geom.sheetToUser({ x: geom.width, y: geom.height }); // in basso a destra
  const y = geom.sheetToUser({ x: 0, y: 0 }); // in alto a sinistra
  return [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y];
}

const num = (v: number): string => (Math.abs(v) < 5e-7 ? '0' : v.toFixed(6).replace(/\.?0+$/, ''));
const IMAGE_NAME = 'GtFlat';

export interface FlatProgress {
  /** Pagina in lavorazione (1 di `total`) e numero di pagina nel documento. */
  current: number;
  total: number;
  page: number;
  /** Byte delle immagini gia' inserite (misurati, non stimati). */
  imageBytes: number;
}

export interface FlatImageInfo {
  page: number;
  via: EmbedVia;
  width: number;
  height: number;
  bytes: number;
  ms: RasterResult['ms'];
}

export interface FlatOptions {
  onProgress?: (p: FlatProgress) => void;
  /** false: il PNG passa sempre da `embedPng` di pdf-lib (serve alle misure di confronto). */
  pngDirect?: boolean;
  /** Oggetti PDF per giro del salvataggio prima di cedere il controllo (predefinito di pdf-lib: 50). */
  objectsPerTick?: number;
}

export interface FlatResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Pagine appiattite (le sole con oggetti). */
  flattenedPages: number;
  objectCount: number;
  /** Somma dei byte delle immagini inserite. */
  imageBytes: number;
  images: FlatImageInfo[];
  warnings: ExportWarning[];
  pruned: { deleted: number; freedBytes: number; skipped: 'invalid-objects' | null; removedFields: number };
  /** Tempi in ms: lettura, rasterizzazione (PDF.js + oggetti + codifica), inserimento nel PDF, pulizia, salvataggio. */
  timing: { load: number; raster: number; embed: number; prune: number; save: number };
}

const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Esporta in "Appiattito". `rasterize(i)` produce l'immagine della pagina `i` (da 0) gia' con gli oggetti; il chiamante la fa con
 * `rasterizePage`. Una pagina per volta: l'immagine si inserisce nel PDF e si lascia andare prima della successiva.
 * Lancia `ExportError` se non riesce (nessun file prodotto, sessione intatta).
 */
export async function exportFlattened(
  original: Uint8Array,
  pages: readonly ExportPage[],
  rasterize: (index: number) => Promise<RasterResult>,
  options: FlatOptions = {},
): Promise<FlatResult> {
  const warnings: ExportWarning[] = [];
  const t0 = now();
  let doc: PDFDocument;
  let pdfLibPages: number;
  try {
    // password '' = utente vuoto (come in "Copertura semplice"); updateMetadata false: Producer e date restano quelli dell'originale
    doc = await PDFDocument.load(original, { password: '', updateMetadata: false });
    pdfLibPages = doc.getPageCount();
  } catch (e) {
    throw toExportError(e, 'load');
  }
  const tLoad = now() - t0;
  if (pdfLibPages !== pages.length) {
    throw new ExportError('mismatch', `Il PDF ha ${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'} per la vista e ${pdfLibPages} per la scrittura.`);
  }
  const targets: number[] = [];
  pages.forEach((p, i) => {
    if (p.objects.length > 0) targets.push(i);
  });

  const images: FlatImageInfo[] = [];
  const widgets = new Set<string>();
  const candidates = new Map<string, PDFRef>();
  let imageBytes = 0;
  let objectCount = 0;
  let tRaster = 0;
  let tEmbed = 0;
  try {
    let done = 0;
    for (const i of targets) {
      const input = pages[i] as ExportPage;
      const no = i + 1;
      options.onProgress?.({ current: ++done, total: targets.length, page: no, imageBytes });
      let node: PDFPage['node'];
      try {
        const page = doc.getPage(i);
        checkSamePage(page, input.spec, no);
        node = page.node;
      } catch (e) {
        if (e instanceof ExportError) throw e;
        throw new ExportError('unreadable', `La pagina ${no} non è leggibile dalla libreria di scrittura.`, e, no);
      }
      const geom = new PageGeometry(input.spec as PageSpec);

      // 1) rasterizzazione (PDF.js + oggetti + codifica): puo' lanciare ExportError('canvas')
      const tr0 = now();
      const r = await rasterize(i);
      tRaster += now() - tr0;

      // 2) inserimento dell'immagine
      const te0 = now();
      const emb = await embedFlatImage(doc, r.kind, r.bytes, { pngDirect: options.pngDirect });
      imageBytes += r.bytes.length;
      images.push({ page: no, via: emb.via, width: emb.width, height: emb.height, bytes: r.bytes.length, ms: r.ms });

      // 3) la pagina sul posto: prima si ricorda cio' che si toglie (per i campi e per gli orfani), poi si sostituisce
      for (const ref of annotationRefs(node)) widgets.add(ref.tag);
      const dropped: PDFObject[] = [];
      for (const [k, v] of node.entries()) {
        if (PAGE_KEEP_KEYS.has(k.asString())) continue;
        dropped.push(v);
        node.delete(k);
      }
      for (const [tag, ref] of pageGarbageCandidates(doc.context, dropped)) candidates.set(tag, ref);
      const m = flatImageMatrix(geom);
      const content = doc.context.stream(`q ${m.map(num).join(' ')} cm /${IMAGE_NAME} Do Q\n`);
      node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(content)]));
      node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { [IMAGE_NAME]: emb.ref } }));
      objectCount += input.objects.length;
      tEmbed += now() - te0;
      await yieldToUi();
    }
  } catch (e) {
    throw toExportError(e, 'write');
  }

  // 4) campi di modulo e oggetti orfani
  const tp0 = now();
  let removedFields = 0;
  let pruned: { deleted: number; freedBytes: number; skipped: 'invalid-objects' | null };
  try {
    removedFields = removeFormFields(doc, widgets).removed;
    pruned = pruneOrphans(doc, candidates);
  } catch (e) {
    throw toExportError(e, 'write');
  }
  if (pruned.skipped === 'invalid-objects') {
    warnings.push({ page: 0, code: 'content-unreadable', text: 'Il PDF contiene oggetti che la libreria non ha saputo interpretare: il vecchio contenuto delle pagine appiattite potrebbe restare nel file.' });
  }
  const tPrune = now() - tp0;

  // 5) salvataggio
  const ts0 = now();
  let bytes: Uint8Array;
  try {
    bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: options.objectsPerTick });
  } catch (e) {
    throw toExportError(e, 'write');
  }
  return {
    bytes,
    pageCount: pages.length,
    flattenedPages: targets.length,
    objectCount,
    imageBytes,
    images,
    warnings,
    pruned: { ...pruned, removedFields },
    timing: { load: tLoad, raster: tRaster, embed: tEmbed, prune: tPrune, save: now() - ts0 },
  };
}

