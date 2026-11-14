// Prove di `loadPdfSnap` con gli anelli (CP7f, V3.3a) in Node con la build LEGACY di PDF.js: PDF costruiti con pdf-lib (operatori scritti a mano) e letti con PDF.js, un altro lettore.
// Stato (`rings`, `ringStats`, `ringBytes`), riga del registro (frase degli anelli, nessun nome di file, identica a prima se non ci sono anelli), flag `recognizeArcs: false` (come prima di CP7f),
// i quattro cedimenti al browser invariati, livelli spenti e le pagine con /Rotate.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { arcChain, pdfChain, pdfPolygon, polygonOnCircle } from './arcTestUtils';
import { makePdf } from './geometryTestUtils';
import { type PdfSnapState, loadPdfSnap, pdfSnapLogLine } from './snapPage';

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
const noYield = async (): Promise<void> => undefined;
async function stateOf(bytes: Uint8Array, deps: Parameters<typeof loadPdfSnap>[3] = {}): Promise<PdfSnapState> {
  const doc = await open(bytes);
  const p = await doc.getPage(1);
  return loadPdfSnap(doc, 1, new PageGeometry({ view: p.view as [number, number, number, number], rotate: p.rotate, userUnit: p.userUnit }), { yieldToUi: noYield, ...deps });
}
const readyOf = (s: PdfSnapState): Extract<PdfSnapState, { kind: 'ready' }> => {
  if (s.kind !== 'ready') throw new Error(`stato ${s.kind}`);
  return s;
};
const ringsAt = (s: Extract<PdfSnapState, { kind: 'ready' }>, x: number, y: number, r: number): [number, number, string][] => {
  const out: [number, number, string][] = [];
  s.rings?.forEachNear(x, y, r, true, true, (px, py, k) => out.push([px, py, k]));
  return out;
};

/** Una pagina 600 x 800 con: un cerchio (4 cubiche, chiuso), un arco di 150 gradi (2 cubiche), un poligono di 24 vertici, una S e un'ellisse sotto una cm 2:1. */
const CONTENT = [
  `${pdfChain(arcChain(100, 700, 40, 0, 360, 4), true)} S`,
  `${pdfChain(arcChain(300, 700, 30, 20, 150, 2))} S`,
  `${pdfPolygon(polygonOnCircle(100, 500, 50, 24), true)} S`,
  `${pdfChain([arcChain(300, 500, 40, 0, 90, 1)[0] as number[], arcChain(300, 580, 40, 270, -90, 1)[0] as number[]])} S`,
  `q 2 0 0 1 0 0 cm ${pdfChain(arcChain(150, 300, 40, 0, 360, 4), true)} S Q`,
].join('\n');

describe('stato con gli anelli', () => {
  it('un cerchio e un arco riconosciuti (2 anelli: 1 cerchio e 1 arco), 2 Centri e 4 + 2 Quadranti nel foglio; il poligono, la S e l\'ellisse no', async () => {
    const s = readyOf(await stateOf(await makePdf({ content: CONTENT })));
    expect(s.ringStats).toMatchObject({ rings: 2, circles: 1, arcs: 1, hiddenRings: 0, centers: 2 });
    // l'arco da 20 a 170 gradi (antiorario): quadrante a 90 (utente: alto) e nessun altro; nel foglio y e' rovesciato ma il conto dei quadranti e' lo stesso
    expect(s.ringStats?.quadrants).toBe(4 + 1);
    // la memoria che resta: i punti (16 byte l'uno) e l'indice; i buffer di estrazione (`ringStats.ringBytes`) si liberano con la geometria e non sono contati
    const pointsBytes = ((s.ringStats?.centers ?? 0) + (s.ringStats?.quadrants ?? 0)) * 16;
    expect(s.ringBytes).toBe(pointsBytes + (s.rings?.grid.bytes ?? 0));
    expect(s.ringStats?.ringBytes).toBeGreaterThan(0);
    expect(s.timings.ringsMs).toBeGreaterThanOrEqual(0);
    // il Centro del cerchio: utente (100, 700) -> foglio (100, 800 - 700); vicino al punto, entro 0.05 pt
    const c = ringsAt(s, 100, 100, 3);
    expect(c.map((p) => p[2])).toEqual(['center']);
    expect(Math.hypot((c[0] as [number, number, string])[0] - 100, (c[0] as [number, number, string])[1] - 100)).toBeLessThan(0.05);
    // nessun Centro dove ci sono il poligono (100, 300), la S e l'ellisse
    expect(ringsAt(s, 100, 300, 5)).toHaveLength(0);
    expect(ringsAt(s, 300, 300, 40)).toHaveLength(0);
    expect(ringsAt(s, 300, 300, 5)).toHaveLength(0);
  });
  it('la riga del registro ha la frase degli anelli con i numeri, in fondo, e nessun nome di file; la frase di prima resta la stessa', async () => {
    const s = readyOf(await stateOf(await makePdf({ content: CONTENT, meta: { title: 'SEGRETO-TITOLO' } })));
    const line = pdfSnapLogLine(s, 1);
    expect(line).toMatch(/; anelli: 2 riconosciuti \(1 cerchi, 1 archi\), 2 centri e 5 quadranti nel foglio \(\d+\.\d\d MB, \d+ ms\)$/);
    expect(line.startsWith('Snap PDF, pagina 1: pronto, ')).toBe(true);
    expect(line).not.toMatch(/SEGRETO|\.pdf/i);
    // senza il riconoscimento la riga e' quella di prima (senza la frase)
    const off = pdfSnapLogLine(readyOf(await stateOf(await makePdf({ content: CONTENT }), { recognizeArcs: false })), 1);
    expect(off).not.toContain('anelli');
    expect(line.replace(/; anelli: .*$/, '').replace(/\d+ ms/g, '#')).toBe(off.replace(/\d+ ms/g, '#'));
  });
  it('senza anelli (solo tratti) lo stato e la riga sono quelli di prima: nessuna frase, nessun campo `rings`', async () => {
    const s = readyOf(await stateOf(await makePdf({ content: '10 10 m 300 10 l S 10 20 m 300 20 l S' })));
    expect(s.rings).toBeUndefined();
    expect(s.ringStats).toBeUndefined();
    expect(s.ringBytes).toBeUndefined();
    expect(s.timings.ringsMs).toBeUndefined();
    expect(pdfSnapLogLine(s, 1)).not.toContain('anelli');
  });
  it('`recognizeArcs: false` (come prima di CP7f): nessun anello, lo stato e i numeri dei punti identici', async () => {
    const bytes = await makePdf({ content: CONTENT });
    const on = readyOf(await stateOf(bytes));
    const off = readyOf(await stateOf(bytes, { recognizeArcs: false }));
    expect(off.rings).toBeUndefined();
    expect(off.ringStats).toBeUndefined();
    for (const k of ['segments', 'curves', 'hiddenSegments', 'nEnd', 'endsFromCurves', 'nMid', 'bytes'] as const) expect(off[k]).toBe(on[k]);
  });
  it('i cedimenti al browser sono quattro anche con gli anelli (come prima di CP7f)', async () => {
    let pauses = 0;
    const s = readyOf(await stateOf(await makePdf({ content: `${CONTENT}\n10 10 m 300 10 l S` }), { yieldToUi: async () => void pauses++ }));
    expect(s.ringStats?.rings).toBe(2);
    expect(pauses).toBe(4);
  });
  it('un anello in un livello spento: nessun punto, lo stato lo conta come «in livelli spenti»; acceso: i suoi punti', async () => {
    const content = `/OC /A BDC ${pdfChain(arcChain(300, 400, 40, 0, 360, 4), true)} S EMC\n10 10 m 50 50 l S`;
    const off = readyOf(await stateOf(await makePdf({ content, ocgs: [{ key: 'A', name: 'A', on: false }] })));
    expect(off.ringStats).toMatchObject({ rings: 0, hiddenRings: 1, centers: 0, quadrants: 0 });
    expect(pdfSnapLogLine(off, 1)).toMatch(/; anelli: 0 riconosciuti \(0 cerchi, 0 archi\), 0 centri e 0 quadranti nel foglio, 1 in livelli spenti/);
    const on = readyOf(await stateOf(await makePdf({ content, ocgs: [{ key: 'A', name: 'A', on: true }] })));
    expect(on.ringStats).toMatchObject({ rings: 1, hiddenRings: 0, centers: 1, quadrants: 4 });
  });
  it('una pagina di soli anelli (nessun tratto) e\' pronta, con i loro punti (e gli Estremi delle cubiche)', async () => {
    const s = readyOf(await stateOf(await makePdf({ content: `${pdfChain(arcChain(300, 400, 40, 0, 360, 4), true)} S` })));
    expect(s.segments).toBe(0);
    expect(s.curves).toBe(4);
    expect(s.ringStats).toMatchObject({ rings: 1, circles: 1, centers: 1, quadrants: 4 });
  });
  it('/Rotate 90 e 270 (a4-rotate90.pdf e una pagina costruita): i 6 cerchi di drawSheet danno 6 Centri e 24 Quadranti', async () => {
    const a4 = readyOf(await stateOf(await loadTestPdf('a4-vettoriale.pdf')));
    expect(a4.ringStats).toMatchObject({ rings: 6, circles: 6, arcs: 0, centers: 6, quadrants: 24 });
    const rot = readyOf(await stateOf(await loadTestPdf('a4-rotate90.pdf')));
    expect(rot.ringStats).toMatchObject({ rings: 6, circles: 6, arcs: 0, centers: 6, quadrants: 24 });
    for (const rotate of [90, 270]) {
      const s = readyOf(await stateOf(await makePdf({ content: `${pdfChain(arcChain(300, 400, 40, 0, 360, 4), true)} S ${pdfChain(arcChain(200, 300, 30, 20, 150, 2))} S`, rotate })));
      expect(s.ringStats).toMatchObject({ rings: 2, circles: 1, arcs: 1, centers: 2, quadrants: 5 });
    }
  });
});
