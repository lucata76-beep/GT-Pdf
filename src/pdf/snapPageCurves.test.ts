// Prove dello stato e dei messaggi dello snap sul PDF con le curve (V3.2a, CP7c: src/pdf/snapPage.ts), in Node con la build LEGACY di PDF.js: una pagina di sole curve e' «pronta» e
// non «assente»; il tetto conta tratti piu' cubiche; livelli spenti, nessun tratto ne' curva, limite di sicurezza e ok:false senza eccezioni; messaggi e riga del registro senza nome
// del file e identici a quelli di CP7b dove non ci sono curve. PDF sintetici costruiti qui: nessun file nuovo in public/.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { makePdf } from './geometryTestUtils';
import { type PdfSnapState, loadPdfSnap, pdfSnapLogLine, pdfSnapNote } from './snapPage';

async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
}
async function sheetOf(doc: PDFDocumentProxy, n: number): Promise<PageGeometry> {
  const p = await doc.getPage(n);
  return new PageGeometry({ view: p.view as [number, number, number, number], rotate: p.rotate, userUnit: p.userUnit });
}
const noYield = async (): Promise<void> => undefined;
async function stateOf(bytes: Uint8Array, n = 1, deps: Parameters<typeof loadPdfSnap>[3] = {}): Promise<PdfSnapState> {
  const doc = await open(bytes);
  return loadPdfSnap(doc, n, await sheetOf(doc, n), { yieldToUi: noYield, ...deps });
}
const readyOf = (s: PdfSnapState): Extract<PdfSnapState, { kind: 'ready' }> => {
  if (s.kind !== 'ready') throw new Error(`stato ${s.kind}: ${JSON.stringify(s)}`);
  return s;
};
const OCGS = [
  { key: 'on', name: 'Acceso', on: true },
  { key: 'off', name: 'Spento', on: false },
];
const CUBIC = '10 10 m 20 40 60 40 70 10 c S';

describe('pagina di sole curve', () => {
  it('un cerchio e nient\'altro: pronto (non «assente»), 4 Estremi, nessun Punto medio, 0 tratti e 4 cubiche', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([400, 300]).drawCircle({ x: 200, y: 150, size: 80, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    const s = readyOf(await stateOf(await doc.save({ useObjectStreams: false })));
    expect(s.segments).toBe(0);
    expect(s.curves).toBe(4);
    expect(s.nEnd).toBe(4);
    expect(s.endsFromCurves).toBe(4);
    expect(s.nMid).toBe(0);
    expect(pdfSnapNote(s, 1)).toBeNull(); // pronto: nessun messaggio
  });

  it('una sola cubica: pronto, 2 Estremi; una cubica fillStroke (B) anche; un riempimento (f) no (nessun tratto ne\' curva: assente)', async () => {
    expect(readyOf(await stateOf(await makePdf({ content: CUBIC }))).nEnd).toBe(2);
    expect(readyOf(await stateOf(await makePdf({ content: '10 10 m 20 40 60 40 70 10 c B' }))).nEnd).toBe(2);
    const fill = await stateOf(await makePdf({ content: '10 10 m 20 40 60 40 70 10 c f' }));
    expect(fill).toEqual({ kind: 'absent', why: 'none', segments: 0 });
  });

  it('cubiche solo in un livello spento: assente (livelli spenti), con il numero delle cubiche; mista con un livello acceso: pronto', async () => {
    const hidden = await stateOf(await makePdf({ content: `/OC /off BDC ${CUBIC} EMC`, mediabox: [200, 100], ocgs: OCGS }));
    expect(hidden).toEqual({ kind: 'absent', why: 'hidden', segments: 0, curves: 1 });
    const both = await stateOf(await makePdf({ content: `/OC /off BDC ${CUBIC} EMC /OC /on BDC 10 50 m 110 50 l S EMC`, mediabox: [200, 100], ocgs: OCGS }));
    const r = readyOf(both);
    expect(r.segments).toBe(1);
    expect(r.curves).toBe(0); // la cubica e' nel livello spento
  });

  it('nessun tratto ne\' curva (solo testo e riempimenti): assente (nessuno); scansione: assente (immagine), come in CP7b', async () => {
    const s = await stateOf(await makePdf({ content: '1 0 0 rg 10 10 100 100 re f BT /F1 12 Tf 10 200 Td (x) Tj ET' }));
    expect(s).toEqual({ kind: 'absent', why: 'none', segments: 0 });
  });

  it('tutti gli estremi fuori dal foglio: assente (nessuno)', async () => {
    const s = await stateOf(await makePdf({ content: '-100 -100 m -50 -50 -20 -50 -10 -100 c S', mediabox: [200, 100] }));
    expect(s).toEqual({ kind: 'absent', why: 'none', segments: 0, curves: 1 });
  });
});

describe('tetto: tratti piu\' cubiche', () => {
  it('10 tratti e 10 cubiche = 20 primitive: tetto 19 -> troppo fitta (con tutti e due i numeri), tetto 20 -> pronto', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `10 ${10 + i * 5} m 90 ${10 + i * 5} l S`).join('\n');
    const cubics = Array.from({ length: 10 }, (_, i) => `10 ${100 + i * 5} m 30 ${140 + i * 5} 70 ${140 + i * 5} 90 ${100 + i * 5} c S`).join('\n');
    const bytes = await makePdf({ content: `${lines}\n${cubics}`, mediabox: [200, 300] });
    expect(await stateOf(bytes, 1, { maxSegments: 19 })).toEqual({ kind: 'dense', segments: 10, curves: 10, cap: 19 });
    const r = readyOf(await stateOf(bytes, 1, { maxSegments: 20 }));
    expect(r.segments).toBe(10);
    expect(r.curves).toBe(10);
  });

  it('solo tratti: lo stato troppo fitta e\' quello di CP7b (nessun campo `curves`)', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `10 ${10 + i * 5} m 90 ${10 + i * 5} l S`).join('\n');
    expect(await stateOf(await makePdf({ content: lines, mediabox: [200, 100] }), 1, { maxSegments: 11 })).toEqual({ kind: 'dense', segments: 12, cap: 11 });
  });

  it('le cubiche dei livelli spenti non contano per il tetto', async () => {
    const hidden = Array.from({ length: 30 }, (_, i) => `10 ${10 + i} m 20 ${40 + i} 60 ${40 + i} 70 ${10 + i} c S`).join('\n');
    const bytes = await makePdf({ content: `/OC /off BDC ${hidden} EMC ${CUBIC}`, mediabox: [200, 100], ocgs: OCGS });
    const r = readyOf(await stateOf(bytes, 1, { maxSegments: 1 }));
    expect(r.curves).toBe(1);
  });
});

describe('limite di sicurezza e lettura non riuscita: nessun punto e nessuna eccezione', () => {
  it('limite dell\'estrazione scattato: troncata', async () => {
    const cubics = Array.from({ length: 20 }, (_, i) => `10 ${10 + i} m 20 ${40 + i} 60 ${40 + i} 70 ${10 + i} c S`).join('\n');
    expect(await stateOf(await makePdf({ content: cubics }), 1, { maxCoords: 30 })).toEqual({ kind: 'truncated' });
  });
  it('tabella OPS incompleta (ok: false): non disponibile', async () => {
    const s = await stateOf(await makePdf({ content: CUBIC }), 1, { ops: {} });
    expect(s.kind).toBe('unavailable');
  });
});

describe('messaggi e riga del registro con le curve', () => {
  it('«nessuna linea né curva»: il messaggio non dice piu\' «solo testo, curve o riempimenti»; livelli spenti: linee e curve', () => {
    const none = pdfSnapNote({ kind: 'absent', why: 'none', segments: 0 }, 4) ?? '';
    expect(none).toContain('Pagina 4');
    expect(none).toMatch(/nessuna linea né curva/);
    expect(none).toMatch(/solo testo o riempimenti/);
    expect(none).not.toMatch(/solo testo, curve/);
    expect(none).toContain('Gli oggetti disegnati si agganciano come sempre.');
    expect(pdfSnapNote({ kind: 'absent', why: 'hidden', segments: 0, curves: 3 }, 4)).toMatch(/linee e le curve del PDF sono tutte in livelli spenti/);
  });
  it('troppo fitta con le curve: il messaggio dice tratti, curve e tetto; senza curve e\' quello di CP7b', () => {
    const t = pdfSnapNote({ kind: 'dense', segments: 200000, curves: 150000, cap: 300000 }, 2) ?? '';
    expect(t).toContain('200.000 tratti e 150.000 curve, tetto 300.000 fra tratti e curve');
    expect(pdfSnapNote({ kind: 'dense', segments: 201234, cap: 150000 }, 2)).toContain('201.234 tratti, tetto 150.000');
    expect(pdfSnapLogLine({ kind: 'dense', segments: 9, curves: 4, cap: 5 }, 2)).toBe('Snap PDF, pagina 2: spento, 9 tratti e 4 curve sopra il tetto di 5');
    expect(pdfSnapLogLine({ kind: 'dense', segments: 9, cap: 5 }, 2)).toBe('Snap PDF, pagina 2: spento, 9 tratti sopra il tetto di 5');
  });
  it('riga del registro di una pagina pronta con curve: la frase di CP7b, poi gli estremi dovuti alle curve e il totale; senza curve identica a CP7b; mai un nome di file', async () => {
    const s = readyOf(await stateOf(await loadTestPdf('a4-vettoriale.pdf')));
    const line = pdfSnapLogLine(s, 1);
    expect(line).toContain('Snap PDF, pagina 1: pronto, 20 estremi e 11 punti medi da 12 tratti; curve: 24 estremi da 24 cubiche (44 estremi in tutto) (');
    expect(line).not.toMatch(/\.pdf/i);
    const flat = readyOf(await stateOf(await makePdf({ content: '10 10 m 110 10 l S', mediabox: [200, 100] })));
    const flatLine = pdfSnapLogLine(flat, 1);
    expect(flatLine).toContain('Snap PDF, pagina 1: pronto, 2 estremi e 1 punti medi da 1 tratti (');
    expect(flatLine).not.toContain('curve');
    expect(pdfSnapLogLine({ kind: 'absent', why: 'none', segments: 0 }, 2)).toBe('Snap PDF, pagina 2: assente (nessun tratto né curva; tratti letti 0)');
    expect(pdfSnapLogLine({ kind: 'absent', why: 'hidden', segments: 0, curves: 5 }, 2)).toBe('Snap PDF, pagina 2: assente (solo livelli spenti; tratti letti 0, cubiche lette 5)');
  });
});
