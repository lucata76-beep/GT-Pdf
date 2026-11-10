// Prove unitarie della misura per pagina (src/pdf/geometryMeasure.ts) in Node, con la build LEGACY di PDF.js: classe della pagina, tempi, memoria, limite di sicurezza,
// livelli del documento, testo di "Copia misura" (nessun nome di file, nessun metadato del documento).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAX_COORDS, type GeometryStats, type OpsTable, extractGeometry } from './geometry';
import { MAX_PAGES, type PageMeasure, allSegments, classifyPage, measureLines, measurePage, measureText, readDocLayers, summaryRow } from './geometryMeasure';
import { makePdf } from './geometryTestUtils';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
}
async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}
async function measureOk(doc: PDFDocumentProxy, n = 1, deps: Parameters<typeof measurePage>[2] = {}): Promise<PageMeasure> {
  const r = await measurePage(doc, n, deps);
  if (!r.ok) throw new Error(`misura fallita: ${r.reason}`);
  return r.measure;
}
/** Statistiche di un elenco finto (per le classi). */
function statsOf(list: [string, unknown][]): GeometryStats {
  const r = extractGeometry({ fnArray: list.map(([n]) => OPS[n] as number), argsArray: list.map(([, a]) => a), ops: OPS, isLayerVisible: () => true });
  if (!r.ok) throw new Error(r.reason);
  return r.stats;
}
const strokePath: [string, unknown] = ['constructPath', [OPS['stroke'], [[0, 0, 0, 1, 5, 5]], null]];
const fillPath: [string, unknown] = ['constructPath', [OPS['fill'], [[0, 0, 0, 1, 5, 5, 1, 0, 5, 4]], null]];
const clipPath: [string, unknown] = ['constructPath', [OPS['endPath'], [[0, 0, 0, 1, 5, 5]], null]];
const emptyPath: [string, unknown] = ['constructPath', [OPS['stroke'], [null], null]];
const image: [string, unknown] = ['paintImageXObject', ['img', 1, 1]];
const text: [string, unknown] = ['showText', [[]]];

describe('classe della pagina (regola dichiarata in classifyPage)', () => {
  it('vettoriale: almeno uno stroke o fillStroke e nessuna immagine', () => {
    expect(classifyPage(statsOf([strokePath]))).toBe('vettoriale');
    expect(classifyPage(statsOf([['constructPath', [OPS['fillStroke'], [[0, 0, 0, 1, 5, 5]], null]]]))).toBe('vettoriale');
    expect(classifyPage(statsOf([strokePath, fillPath, text]))).toBe('vettoriale');
  });
  it('scansione: 0 percorsi e almeno un\'immagine (anche con testo)', () => {
    expect(classifyPage(statsOf([image]))).toBe('scansione');
    expect(classifyPage(statsOf([image, text]))).toBe('scansione');
    expect(classifyPage(statsOf([image, emptyPath]))).toBe('scansione'); // un percorso vuoto non e' un percorso
  });
  it('mista: immagini e tratti; immagini e solo riempimenti o ritagli', () => {
    expect(classifyPage(statsOf([image, strokePath]))).toBe('mista');
    expect(classifyPage(statsOf([image, fillPath]))).toBe('mista');
    expect(classifyPage(statsOf([image, clipPath]))).toBe('mista');
  });
  it('vuota: niente percorsi, immagini, testo o sfumature; altro: solo testo, riempimenti, ritagli o sfumature', () => {
    expect(classifyPage(statsOf([]))).toBe('vuota');
    expect(classifyPage(statsOf([['save', null], ['restore', null], emptyPath]))).toBe('vuota');
    expect(classifyPage(statsOf([text]))).toBe('altro');
    expect(classifyPage(statsOf([fillPath]))).toBe('altro');
    expect(classifyPage(statsOf([clipPath]))).toBe('altro');
    expect(classifyPage(statsOf([['shadingFill', ['s']]]))).toBe('altro');
  });
  it('con il limite scattato la conta delle operazioni (completa) decide se ci sono percorsi', () => {
    const r = extractGeometry({ fnArray: [OPS['constructPath']!, OPS['paintImageXObject']!], argsArray: [strokePath[1], image[1]], ops: OPS as OpsTable, isLayerVisible: () => true, maxCoords: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stats.truncated).not.toBeNull();
      expect(r.stats.paths).toBe(0);
      expect(classifyPage(r.stats)).toBe('mista'); // 0 percorsi letti, ma constructPath e' 1: non e' una scansione
    }
  });
});

describe('misura di una pagina con PDF.js', () => {
  it('a4-vettoriale.pdf: classe, conte, tempi, secondo getOperatorList sullo stesso oggetto, heap non disponibile (simulato)', async () => {
    const doc = await open(await loadTestPdf('a4-vettoriale.pdf'));
    const m = await measureOk(doc, 1, { heapUsed: () => null }); // performance.memory esiste solo in Chromium: qui si simula la sua assenza
    expect(m.pageClass).toBe('vettoriale');
    expect(m.stats.ops.total).toBe(160);
    expect(m.stats.all.paths).toBe(15);
    expect(m.meta).toMatchObject({ pageNo: 1, numPages: 1, rotate: 0, userUnit: 1 });
    expect(m.meta.view).toEqual([0, 0, 595.276, 841.89]);
    expect(Math.abs(m.meta.widthPt - 595.276)).toBeLessThan(1e-9);
    expect(m.timings.sameObject).toBe(true);
    expect(m.timings.fresh).toBe(true);
    for (const v of [m.timings.firstMs, m.timings.secondMs, m.timings.extractMs]) expect(v).toBeGreaterThanOrEqual(0);
    expect(m.heap).toBeNull();
    expect(m.nPaths).toBe(15);
    expect(m.nLines).toBe(12);
    expect(m.nCubics).toBe(24);
    expect(allSegments(m.stats)).toBe(11 + 1 + 24);
    // una seconda misura della stessa pagina (l'elenco e' in memoria) funziona e da' gli stessi numeri
    const again = await measureOk(doc);
    expect(again.stats).toEqual(m.stats);
  });

  it('a4-scansione.pdf: scansione, 0 percorsi; a4-annotazioni.pdf: 20 percorsi', async () => {
    const scan = await measureOk(await open(await loadTestPdf('a4-scansione.pdf')));
    expect(scan.pageClass).toBe('scansione');
    expect(scan.stats.all.paths).toBe(0);
    expect(scan.stats.ops.imageOps).toBe(1);
    const ann = await measureOk(await open(await loadTestPdf('a4-annotazioni.pdf')));
    expect(ann.stats.all.paths).toBe(20);
    expect(ann.pageClass).toBe('vettoriale');
  });

  it('Rotate, vista e UserUnit nei dati di pagina', async () => {
    const rot = await measureOk(await open(await loadTestPdf('a4-rotate90.pdf')));
    expect(rot.meta.rotate).toBe(90);
    expect(Math.abs(rot.meta.widthPt - 841.89)).toBeLessThan(1e-9);
    const crop = await measureOk(await open(await loadTestPdf('a4-cropbox.pdf')));
    expect(crop.meta.view).toEqual([50, 50, 450, 600]);
    expect(crop.meta.widthPt).toBe(400);
    expect(crop.meta.heightPt).toBe(550);
  });

  it('memoria heap: se performance.memory esiste si riportano prima e dopo, altrimenti null', async () => {
    const doc = await open(await loadTestPdf('a4-vettoriale.pdf'));
    let i = 0;
    const m = await measureOk(doc, 1, { heapUsed: () => (i++ === 0 ? 10 * 1048576 : 25 * 1048576) });
    expect(m.heap).toEqual({ before: 10 * 1048576, after: 25 * 1048576 });
    const lines = measureLines(m, null);
    expect(lines.some((l) => l.startsWith('heap JS (performance.memory, solo Chromium): prima 10.0 MB, dopo 25.0 MB'))).toBe(true);
    const none = measureLines(await measureOk(doc, 1, { heapUsed: () => null }), null);
    expect(none.some((l) => l.endsWith('non disponibile'))).toBe(true);
  });

  it('limite di sicurezza: la misura riporta cosa ha letto e lo dice', async () => {
    const doc = await open(await loadTestPdf('a4-vettoriale.pdf'));
    const m = await measureOk(doc, 1, { maxCoords: 100 });
    expect(m.stats.truncated).not.toBeNull();
    expect(m.stats.truncated!.limit).toBe(100);
    expect(m.stats.ops.total).toBe(160); // conta completa
    expect(m.stats.ops.constructPath).toBe(15);
    expect(m.stats.all.paths).toBeLessThan(15);
    expect(m.stats.coordsRead).toBeLessThanOrEqual(100);
    const text = measureLines(m, null).join('\n');
    expect(text).toContain('limite di sicurezza: SCATTATO');
    expect(summaryRow(m)).toContain('LIMITE');
    expect(measureLines(await measureOk(doc), null).join('\n')).toContain(`limite di sicurezza: non scattato (limite ${DEFAULT_MAX_COORDS} numeri)`);
  });

  it('errori: pagina inesistente e formato non riconosciuto danno { ok: false } senza lanciare', async () => {
    const doc = await open(await loadTestPdf('a4-vettoriale.pdf'));
    const bad = await measurePage(doc, 99);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason.length).toBeGreaterThan(0);
    const { constructPath, ...without } = OPS;
    void constructPath;
    const fmtErr = await measurePage(doc, 1, { ops: without });
    expect(fmtErr.ok).toBe(false);
    if (!fmtErr.ok) {
      expect(fmtErr.reason).toContain('aggiornare src/pdf/geometry.ts');
      expect(fmtErr.meta?.pageNo).toBe(1);
    }
  });

  it('release: libera l\'elenco della pagina dopo la misura (il secondo getOperatorList lo rilegge)', async () => {
    const doc = await open(await loadTestPdf('misto-3-pagine.pdf'));
    for (let n = 1; n <= 3; n++) {
      const m = await measureOk(doc, n, { release: true });
      expect(m.meta.pageNo).toBe(n);
      expect(m.stats.all.paths).toBe(15);
    }
  });
});

describe('livelli del documento', () => {
  const ocgs = [
    { key: 'A', name: 'SEGRETO-LIVELLO-A', on: false },
    { key: 'B', name: 'SEGRETO-LIVELLO-B', on: true },
    { key: 'C', name: 'SEGRETO-LIVELLO-C', on: false },
  ];
  it('gruppi OCG e quanti spenti nella configurazione predefinita (solo numeri)', async () => {
    const doc = await open(await makePdf({ content: '/OC /A BDC 0 0 m 1 1 l S EMC', ocgs }));
    expect(await readDocLayers(doc)).toEqual({ groups: 3, off: 2 });
    expect(await readDocLayers(await open(await loadTestPdf('a4-vettoriale.pdf')))).toEqual({ groups: 0, off: 0 });
  });
  it('misura di una pagina con livelli: percorsi e segmenti dentro livelli spenti, profondita\'', async () => {
    const content = '/OC /A BDC 0 0 m 1 1 l S /OC /B BDC 2 2 m 3 3 l S EMC EMC /OC /B BDC 4 4 m 5 5 l S EMC';
    const doc = await open(await makePdf({ content, ocgs }));
    const m = await measureOk(doc);
    expect(m.stats.layers).toMatchObject({ ocMarkers: 3, hiddenPaths: 2, hiddenCandidatePaths: 2, hiddenCandidateSegments: 2, maxDepth: 2, ocNull: 0 });
    const text = measureLines(m, await readDocLayers(doc)).join('\n');
    expect(text).toContain('gruppi OCG 3, spenti nella configurazione predefinita 2');
    expect(text).toContain('dentro livelli spenti: percorsi 2 (candidati 2), segmenti dei candidati 2');
    expect(text).not.toContain('SEGRETO'); // i nomi dei livelli non si copiano
  });
});

describe('testo di "Copia misura"', () => {
  const SECRET_NAME = 'cliente-riservato-ABC123.pdf';
  const meta = { title: 'SEGRETO-TITOLO', author: 'SEGRETO-AUTORE', producer: 'SEGRETO-PRODUTTORE', creator: 'SEGRETO-CREATORE', subject: 'SEGRETO-OGGETTO', keywords: ['SEGRETO-PAROLA'] };

  it('contiene versione dell\'app, versione di PDF.js, pagina, Rotate, vista e UserUnit; non il nome del file ne\' i metadati; nessuna riga vuota', async () => {
    const bytes = await makePdf({ content: '10 10 m 50 50 l S\n(SEGRETO-TESTO) Tj', rotate: 90, meta });
    const doc = await open(bytes);
    const m = await measureOk(doc);
    const t = measureText('abc1234', [m], m, await readDocLayers(doc));
    const lines = t.split('\n');
    expect(lines[0]).toBe(`GT-Pdf abc1234 · misura geometria PDF · PDF.js ${pdfjs.version}`);
    expect(t).toContain('pagina: 1 di 1');
    expect(t).toContain('Rotate: 90');
    expect(t).toContain('vista: [0 0 600 800] = 800 x 600 pt');
    expect(t).toContain('UserUnit: 1');
    for (const secret of ['SEGRETO', SECRET_NAME, 'cliente-riservato', '.pdf', 'Title', 'Author', 'Producer']) expect(t, secret).not.toContain(secret);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(lines.every((l) => /[:·]/.test(l))).toBe(true); // una voce per riga, con il nome della misura
    // numeri sempre con il punto
    expect(t).not.toMatch(/\d,\d/);
  });

  it('ogni voce di 2.2 compare nel testo', async () => {
    const m = await measureOk(await open(await loadTestPdf('a4-vettoriale.pdf')));
    const t = measureLines(m, { groups: 0, off: 0 }).join('\n');
    for (const label of [
      'classe della pagina',
      'operazioni totali',
      'constructPath',
      'operazioni immagine (tutte)',
      'showText',
      'shadingFill',
      'operatori colore con pattern',
      'percorsi per pittura: stroke 15, fill 0, fillstroke 0, endPath 0',
      'tutti i percorsi: percorsi 15',
      'candidati (stroke e fillstroke): percorsi 15',
      'lineTo 11',
      'cubiche 24',
      'quadratiche 0',
      'chiusure 7',
      'lunghezza dei segmenti rettilinei (pt utente): sotto 0.01',
      'lunghezza minima e massima',
      'per numero di cubiche: 1: 0 · 2: 0 · 3: 0 · 4: 6',
      'regola del cerchio',
      'poligoni fitti',
      'cubiche in sottopercorsi aperti',
      'livelli del documento',
      'marcatori OC',
      'profondita\' massima dei marcatori',
      'dentro livelli spenti',
      'coordinate non finite',
      'numeri nei Float32Array',
      'primitive memorizzate',
      'primo getOperatorList',
      'secondo getOperatorList',
      'stesso oggetto: si',
      'estrazione',
      'heap JS',
      'limite di sicurezza',
    ]) {
      expect(t, label).toContain(label);
    }
    expect(t).toContain('di 4 cubiche che rispettano la regola del cerchio, tutti i percorsi: 6');
    expect(t).toContain('12 segmenti rettilinei (20 byte l\'uno), 24 cubiche (36 byte l\'una)');
  });

  it('piu\' pagine: una riga di sintesi per pagina (percorsi, segmenti, millisecondi) e il dettaglio della pagina scelta', async () => {
    const doc = await open(await loadTestPdf('misto-3-pagine.pdf'));
    const ms: PageMeasure[] = [];
    for (let n = 1; n <= 3; n++) ms.push(await measureOk(doc, n));
    const t = measureText('dev', ms, ms[1]!, null);
    expect(t).toContain('pagine misurate: 3 di 3');
    const rows = t.split('\n').filter((l) => l.startsWith('pagina ') && l.includes('percorsi'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^pagina 1: vettoriale · percorsi 15 · segmenti 36 · \d+ ms · Rotate 0 · 595\.3 x 841\.9 pt$/);
    expect(rows[1]).toMatch(/^pagina 2: vettoriale · percorsi 15 · segmenti 36 · \d+ ms · Rotate 0 · 1190\.6 x 841\.9 pt$/);
    expect(rows[2]).toMatch(/^pagina 3: vettoriale · percorsi 15 · segmenti 36 · \d+ ms · Rotate 90 · 841\.9 x 595\.3 pt$/);
    expect(t).toContain('--- dettaglio della pagina 2 ---');
    expect(t).toContain('pagina: 2 di 3');
    expect(t).toContain('livelli del documento: gruppi OCG non letti');
    expect(MAX_PAGES).toBe(200);
  });
});
