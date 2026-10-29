// Il PDF di prova fittizio "A4 con annotazioni" (scripts/make-test-pdfs.mjs): la casella deve essere spuntata sia nel campo sia nel widget.
// Bug trovato in 5c: `check()` chiamato PRIMA di `addToPage` lasciava il widget con /AS /Off e PDF.js disegnava la casella vuota.
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

describe('public/test-pdfs/a4-annotazioni.pdf', () => {
  it('la casella e\' spuntata e il suo widget ha /AS = /Yes (stato di accensione), non /Off', async () => {
    // il progetto non ha i tipi di Node (nessun @types/node): il modulo si carica con un nome in variabile
    const fsName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
    const doc = await PDFDocument.load(fs.readFileSync(new URL('../../public/test-pdfs/a4-annotazioni.pdf', import.meta.url)));
    const box = doc.getForm().getCheckBox('casella-prova');
    expect(box.isChecked()).toBe(true);
    const widgets = box.acroField.getWidgets();
    expect(widgets).toHaveLength(1);
    expect(String(widgets[0]?.dict.get(PDFName.of('AS')))).toBe('/Yes');
  });
});
