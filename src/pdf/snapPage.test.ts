// Prove della lettura per pagina dello snap sul PDF (src/pdf/snapPage.ts), in Node con la build LEGACY di PDF.js: stati (pronto, assente, non disponibile, troppo fitta, troncata),
// nessun page.cleanup(), messaggi senza nome del file, riga del registro, cache delle ultime N pagine. PDF di prova: i 7 di public/test-pdfs e PDF sintetici costruiti qui.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry } from '../geometry/page';
import { makePdf } from './geometryTestUtils';
import { PageCache, type PdfSnapState, SNAP_CACHE_PAGES, SNAP_MAX_COORDS, SNAP_MAX_SEGMENTS, loadPdfSnap, pdfSnapLogLine, pdfSnapNote } from './snapPage';

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
  if (s.kind !== 'ready') throw new Error(`stato ${s.kind}`);
  return s;
};
const allNear = (s: Extract<PdfSnapState, { kind: 'ready' }>, x: number, y: number, r: number, end = true, mid = true): [number, number, string][] => {
  const out: [number, number, string][] = [];
  s.source.forEachNear(x, y, r, end, mid, (px, py, k) => out.push([px, py, k]));
  return out;
};

describe('stati di una pagina', () => {
  it('a4-vettoriale.pdf: pronto, 12 tratti, 20 Estremi e 11 Punti medi, con i tempi di ogni fase', async () => {
    const s = readyOf(await stateOf(await loadTestPdf('a4-vettoriale.pdf')));
    expect(s.segments).toBe(12);
    expect(s.nEnd).toBe(20);
    expect(s.nMid).toBe(11);
    expect(s.bytes).toBe(31 * 16 + s.source.bytes);
    for (const k of ['opListMs', 'extractMs', 'pointsMs', 'indexMs'] as const) expect(s.timings[k]).toBeGreaterThanOrEqual(0);
    // il rettangolo del disegno: l'angolo in alto a sinistra e' a (10, 10) dal bordo del foglio (A4 da 595.276 x 841.89)
    const h = allNear(s, 10.5, 10.5, 2, true, false);
    expect(h).toHaveLength(1);
    expect(h[0]![0]).toBeCloseTo(10, 4);
    expect(h[0]![1]).toBeCloseTo(10, 4);
  });

  it('a4-scansione.pdf: assente (immagine), nessun punto', async () => {
    const s = await stateOf(await loadTestPdf('a4-scansione.pdf'));
    expect(s).toEqual({ kind: 'absent', why: 'image', segments: 0 });
  });

  it('pagina con solo testo e riempimenti: assente (nessun tratto rettilineo)', async () => {
    const s = await stateOf(await makePdf({ content: '1 0 0 rg 10 10 100 100 re f BT /F1 12 Tf 10 200 Td (x) Tj ET' }));
    expect(s.kind).toBe('absent');
    if (s.kind === 'absent') expect(s.why).toBe('none');
  });

  it('pagina con soli tratti in livelli spenti: assente (livelli spenti)', async () => {
    const s = await stateOf(
      await makePdf({
        content: '/OC /off BDC 10 10 m 110 10 l S EMC',
        mediabox: [200, 100],
        ocgs: [{ key: 'off', name: 'Spento', on: false }],
      }),
    );
    expect(s).toEqual({ kind: 'absent', why: 'hidden', segments: 1 });
  });

  it('livello acceso e spento nella stessa pagina: pronto, solo i tratti visibili', async () => {
    const s = readyOf(
      await stateOf(
        await makePdf({
          content: '/OC /on BDC 10 10 m 110 10 l S EMC /OC /off BDC 10 20 m 110 20 l S EMC',
          mediabox: [200, 100],
          ocgs: [
            { key: 'on', name: 'Acceso', on: true },
            { key: 'off', name: 'Spento', on: false },
          ],
        }),
      ),
    );
    expect(s.segments).toBe(1);
    expect(s.nEnd).toBe(2);
    expect(s.nMid).toBe(1);
  });

  it('troppo fitta: sopra il tetto (parametro) lo stato dice quanti tratti e qual e\' il tetto', async () => {
    const s = await stateOf(await loadTestPdf('a4-vettoriale.pdf'), 1, { maxSegments: 11 });
    expect(s).toEqual({ kind: 'dense', segments: 12, cap: 11 });
    expect(await stateOf(await loadTestPdf('a4-vettoriale.pdf'), 1, { maxSegments: 12 })).toMatchObject({ kind: 'ready' }); // il tetto stesso e' ammesso
    expect(SNAP_MAX_SEGMENTS).toBeGreaterThan(10000);
  });

  it('troncata: il limite di sicurezza dell\'estrazione scatta -> stato `truncated` (nessun punto: la geometria sarebbe parziale)', async () => {
    const s = await stateOf(await loadTestPdf('a4-vettoriale.pdf'), 1, { maxCoords: 30 });
    expect(s).toEqual({ kind: 'truncated' });
    expect(SNAP_MAX_COORDS).toBeLessThan(10_000_000);
  });

  it('non disponibile: formato non riconosciuto (tabella OPS senza una voce), errore di PDF.js (getPage che rifiuta, getOperatorList che rifiuta): mai un\'eccezione', async () => {
    const bytes = await loadTestPdf('a4-vettoriale.pdf');
    const missing = await stateOf(bytes, 1, { ops: {} });
    expect(missing.kind).toBe('unavailable');
    if (missing.kind === 'unavailable') expect(missing.reason).toContain('aggiornare src/pdf/geometry.ts');
    const doc = await open(bytes);
    const sheet = await sheetOf(doc, 1);
    const badPage = { getPage: () => Promise.reject(new Error('pagina illeggibile')) } as unknown as PDFDocumentProxy;
    const a = await loadPdfSnap(badPage, 1, sheet, { yieldToUi: noYield });
    expect(a).toEqual({ kind: 'unavailable', reason: 'Error: pagina illeggibile' });
    const badOps = { getPage: async () => ({ getOperatorList: () => Promise.reject(new Error('flusso danneggiato')) }), getOptionalContentConfig: async () => ({ isVisible: () => true }) } as unknown as PDFDocumentProxy;
    expect(await loadPdfSnap(badOps, 1, sheet, { yieldToUi: noYield })).toEqual({ kind: 'unavailable', reason: 'Error: flusso danneggiato' });
    const strange = { getPage: async () => ({ getOperatorList: async () => ({ fnArray: [91], argsArray: [['x']] }) }), getOptionalContentConfig: async () => ({ isVisible: () => true }) } as unknown as PDFDocumentProxy;
    expect((await loadPdfSnap(strange, 1, sheet, { yieldToUi: noYield })).kind).toBe('unavailable');
  });

  it('libera l\'elenco di operazioni della SUA pagina dopo la lettura (page.cleanup una volta, dopo l\'estrazione: il documento e\' dedicato) e non tocca le altre pagine', async () => {
    const doc = await open(await loadTestPdf('misto-3-pagine.pdf'));
    const p1 = await doc.getPage(1);
    const p2 = await doc.getPage(2);
    const calls: string[] = [];
    for (const [n, p] of [[1, p1], [2, p2]] as const) {
      const orig = p.cleanup.bind(p);
      p.cleanup = (...a: Parameters<typeof orig>) => {
        calls.push(`pagina ${n}`);
        return orig(...a);
      };
    }
    const s = await loadPdfSnap(doc, 1, await sheetOf(doc, 1), { yieldToUi: noYield });
    expect(s.kind).toBe('ready');
    expect(calls).toEqual(['pagina 1']);
  });

  it('usa la geometria del foglio della pagina data: misto-3-pagine.pdf (A4, A3 orizzontale, A4 con /Rotate 90) ha tre insiemi di punti diversi', async () => {
    const bytes = await loadTestPdf('misto-3-pagine.pdf');
    const doc = await open(bytes);
    const out: Extract<PdfSnapState, { kind: 'ready' }>[] = [];
    for (let n = 1; n <= 3; n++) out.push(readyOf(await loadPdfSnap(doc, n, await sheetOf(doc, n), { yieldToUi: noYield })));
    const sizes = out.map((s) => [s.source.points.width, s.source.points.height].map((v) => Math.round(v)));
    expect(sizes).toEqual([[595, 842], [1191, 842], [842, 595]]);
    // il primo angolo del rettangolo (10, 10 dall'angolo in alto a sinistra del foglio MOSTRATO) c'e' in A4 e in A3; in /Rotate 90 il rettangolo e' (10, 10) dal bordo di quel foglio ruotato
    for (const s of out) expect(allNear(s, 10, 10, 0.5, true, false)).toHaveLength(1);
  });

  it('esegue le tre fasi con un cedimento al browser fra l\'una e l\'altra', async () => {
    let pauses = 0;
    const s = await stateOf(await loadTestPdf('a4-vettoriale.pdf'), 1, { yieldToUi: async () => void pauses++ });
    expect(s.kind).toBe('ready');
    expect(pauses).toBe(3);
  });
});

describe('messaggi e riga del registro', () => {
  const states: PdfSnapState[] = [
    { kind: 'absent', why: 'image', segments: 0 },
    { kind: 'absent', why: 'hidden', segments: 4 },
    { kind: 'absent', why: 'none', segments: 0 },
    { kind: 'dense', segments: 201234, cap: 150000 },
    { kind: 'truncated' },
    { kind: 'unavailable', reason: 'Error: x' },
  ];
  it('ogni stato senza snap ha un messaggio con la pagina e la frase sugli oggetti disegnati; `ready` non ne ha', () => {
    for (const s of states) {
      const t = pdfSnapNote(s, 7);
      expect(t, s.kind).toContain('Pagina 7');
      expect(t).toContain('Gli oggetti disegnati si agganciano come sempre.');
    }
    expect(pdfSnapNote({ kind: 'dense', segments: 201234, cap: 150000 }, 2)).toContain('201.234 tratti, tetto 150.000');
    expect(pdfSnapNote({ kind: 'absent', why: 'image', segments: 0 }, 1)).toMatch(/scansione/);
    expect(pdfSnapNote({ kind: 'absent', why: 'hidden', segments: 3 }, 1)).toMatch(/livelli spenti/);
  });
  it('nessun messaggio ne\' riga contiene un nome di file: il testo dipende solo da stato e numero di pagina', () => {
    for (const s of states) {
      expect(pdfSnapNote(s, 3)).not.toMatch(/\.pdf/i);
      expect(pdfSnapLogLine(s, 3)).not.toMatch(/\.pdf/i);
    }
  });
  it('la riga del registro dice i numeri di una pagina pronta e il motivo delle altre', async () => {
    const s = await stateOf(await loadTestPdf('a4-vettoriale.pdf'));
    const line = pdfSnapLogLine(s, 1);
    expect(line).toContain('Snap PDF, pagina 1: pronto, 20 estremi e 11 punti medi da 12 tratti');
    expect(line).not.toMatch(/\.pdf/i);
    expect(pdfSnapLogLine({ kind: 'dense', segments: 9, cap: 5 }, 2)).toBe('Snap PDF, pagina 2: spento, 9 tratti sopra il tetto di 5');
    expect(pdfSnapLogLine({ kind: 'truncated' }, 2)).toContain('spento');
    expect(pdfSnapLogLine({ kind: 'unavailable', reason: 'Error: x' }, 2)).toContain('non disponibile: Error: x');
    expect(pdfSnapLogLine({ kind: 'absent', why: 'image', segments: 0 }, 2)).toContain('immagine');
  });
});

describe('cache delle ultime N pagine', () => {
  it('N predefinito 3: la meno usata esce per prima; `get` la rende la piu\' recente; `clear` svuota', () => {
    expect(SNAP_CACHE_PAGES).toBe(3);
    const c = new PageCache<string>();
    c.set(1, 'a');
    c.set(2, 'b');
    c.set(3, 'c');
    expect(c.pages()).toEqual([1, 2, 3]);
    expect(c.get(1)).toBe('a'); // 1 e' ora la piu' recente
    c.set(4, 'd'); // esce la meno usata: la 2
    expect(c.has(2)).toBe(false);
    expect(c.pages()).toEqual([3, 1, 4]);
    expect(c.size).toBe(3);
    c.set(3, 'c2'); // sostituire non aumenta
    expect(c.size).toBe(3);
    expect(c.get(3)).toBe('c2');
    expect(c.get(99)).toBeUndefined();
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get(1)).toBeUndefined();
  });
  it('peek legge senza cambiare l\'ordine di uso', () => {
    const c = new PageCache<string>(2);
    c.set(1, 'a');
    c.set(2, 'b');
    expect(c.peek(1)).toBe('a');
    expect(c.pages()).toEqual([1, 2]); // get() la metterebbe in coda
    c.set(3, 'c'); // esce la 1: peek non l'ha resa piu' recente
    expect(c.pages()).toEqual([2, 3]);
    expect(c.peek(9)).toBeUndefined();
  });
  it('max 1: tiene solo l\'ultima', () => {
    const c = new PageCache<number>(1);
    c.set(1, 1);
    c.set(2, 2);
    expect(c.pages()).toEqual([2]);
  });
});
