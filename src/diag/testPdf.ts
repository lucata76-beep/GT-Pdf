// PDF di prova generato nell'app con @cantoo/pdf-lib: serve a provare salvataggio e condivisione.
// Contenuto fittizio. Testo in Helvetica standard (WinAnsi: Ø ° ± sono codificabili).
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

export async function makeDiagPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Prova GT-Pdf');
  doc.setProducer('GT-Pdf (prova)');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.276, 841.89]);
  const ink = rgb(0.12, 0.14, 0.16);
  page.drawRectangle({ x: 40, y: 40, width: 515.276, height: 761.89, borderColor: ink, borderWidth: 1 });
  page.drawCircle({ x: 297.638, y: 480, size: 120, borderColor: ink, borderWidth: 1.5 });
  page.drawRectangle({ x: 60, y: 60, width: 150, height: 40, color: rgb(1, 1, 1), borderColor: ink, borderWidth: 0.8 });
  page.drawText('Ø 48.50 ± 0.05 °  R12', { x: 70, y: 76, size: 12, font, color: ink });
  page.drawText('PDF di prova GT-Pdf (fittizio)', { x: 60, y: 760, size: 14, font, color: ink });
  page.drawText(`Versione ${__BUILD_ID__} - ${new Date().toISOString()}`, { x: 60, y: 742, size: 9, font, color: ink });
  return doc.save();
}
