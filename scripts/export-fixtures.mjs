// PDF di prova SINTETICI per le prove dell'esportazione (CP5a): costruiti in memoria con @cantoo/pdf-lib, mai scritti nel repository.
// Li usano i test unitari (src/export/*.test.ts) e le prove Chromium (scripts/e2e-cp5a.cjs, scripts/perf-cp5a.cjs, con import()).
// Ogni funzione restituisce un Uint8Array. Contenuti fittizi: nessun disegno reale.
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from '@cantoo/pdf-lib';

export const A4 = [595.276, 841.89];

/**
 * pages: [{ size?, rotate?, crop?: [x, y, w, h], userUnit?, raw?: string (contenuto grezzo, font Helvetica come /F1),
 *           stamp?: { x, y, w, h } (annotazione con aspetto proprio, rossa, flag Print), draw?: (page, font) => void }]
 * encrypt: { algorithm?, ownerPassword?, userPassword? } cifra al salvataggio (lettura con utente vuoto se userPassword assente).
 */
export async function build({ pages, encrypt, useObjectStreams = false }) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('GT-Pdf export fixtures');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage(spec.size ?? A4);
    if (spec.crop) page.setCropBox(...spec.crop);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    if (spec.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(spec.userUnit));
    if (spec.raw !== undefined) {
      page.node.setFontDictionary(PDFName.of('F1'), font.ref);
      page.node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(doc.context.stream(spec.raw))]));
    }
    if (spec.draw) spec.draw(page, font);
    if (spec.stamp) {
      const { x, y, w, h } = spec.stamp;
      const ap = doc.context.register(doc.context.stream('1 0 0 rg 0 0 ' + w + ' ' + h + ' re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }));
      const annot = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [x, y, x + w, y + h], AP: { N: ap }, F: 4 }));
      page.node.addAnnot(annot);
    }
  }
  if (encrypt) doc.encrypt({ userPassword: encrypt.userPassword ?? '', ownerPassword: encrypt.ownerPassword ?? 'owner', algorithm: encrypt.algorithm, allowWeakCryptography: true, permissions: { printing: false, modifying: false } });
  return doc.save({ useObjectStreams });
}

/** Contenuto che disegna un riquadro nero con un testo e poi lascia lo stato grafico "sporco" in uno dei modi indicati. */
export function dirtyContent(kind) {
  const body = '0 0 0 rg 100 600 200 100 re f BT /F1 12 Tf 110 650 Td (TESTO ORIGINALE) Tj ET\n';
  switch (kind) {
    case 'clean':
      return `q ${body} Q`;
    case 'matrix-left': // matrice non identica lasciata a fine contenuto, senza q/Q
      return `${body} 0.5 0 0 0.5 120 -80 cm`;
    case 'flip-left': // il caso piu' comune: ribaltamento all'inizio mai annullato
      return `1 0 0 -1 0 841.89 cm 1 0 0 -1 0 841.89 cm ${body} 0.25 0 0 0.25 30 30 cm`;
    case 'open-q': // q aperto dopo una matrice: il Q di pdf-lib chiude il q sbagliato
      return `0.5 0 0 0.5 120 -80 cm q 2 0 0 2 0 0 cm ${body}`;
    case 'stray-q': // Q in piu' all'inizio, poi una matrice lasciata
      return `Q Q ${body} 2 0 0 2 0 0 cm 3 Tr 5 Tc 20 Tz`;
    case 'invisible-text': // modalita' di testo invisibile (OCR) lasciata a fine contenuto, fuori da q/Q
      return `${body} 3 Tr`;
    default:
      throw new Error(`tipo di contenuto sconosciuto: ${kind}`);
  }
}

export const dirtyPdf = (kind, extra = {}) => build({ pages: [{ raw: dirtyContent(kind), ...extra }] });
