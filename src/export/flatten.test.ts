import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PageGeometry, type PageSpec, type SheetPoint } from '../geometry/page';
import type { LineObject, PageObject } from '../model/model';
import type { ExportPage } from './coverSimple';
import { ExportError } from './errors';
import { exportFlattened, flatImageMatrix } from './flatten';
import type { RasterResult } from './rasterize';
import { fakeJpeg, makePng } from './testImages';
import { verifyExport } from './verify';

const tasks: { destroy(): Promise<void> }[] = [];
const open = async (bytes: Uint8Array): Promise<PDFDocumentProxy> => {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
};
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
const sha = async (b: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');
const text = (bytes: Uint8Array): string => Array.from(bytes, (c) => String.fromCharCode(c)).join('');

const SPEC1: PageSpec = { view: [0, 0, 300, 400], rotate: 0, userUnit: 1 };
const SPEC2: PageSpec = { view: [20, 30, 260, 360], rotate: 90, userUnit: 2.5 };
const SPEC3: PageSpec = { view: [0, 0, 300, 400], rotate: 0, userUnit: 1 };
const seg = (id: number): LineObject => ({ id, kind: 'segment', points: [{ x: 30, y: 40 }, { x: 90, y: 100 }], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } });
const exportPages = (objs: [number, number, number]): ExportPage[] => [SPEC1, SPEC2, SPEC3].map((spec, i) => ({ spec, objects: Array.from({ length: objs[i] as number }, (_, k) => seg(k + 1) as PageObject), scale: null }));

/** Documento di prova: 3 pagine; pagina 2 con /Rotate 90, CropBox e UserUnit 2.5, contenuto, immagine, campo, timbro, collegamento, miniatura e dati privati; font e immagine condivisi dalle pagine 1 e 3. */
async function buildDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { png } = await makePng(8, 8, { colorType: 6 });
  const shared = await doc.embedPng(png); // condivisa da 1 e 3
  const priv = await doc.embedPng((await makePng(9, 9, { colorType: 6 })).png); // solo pagina 2
  const raw = (page: ReturnType<PDFDocument['addPage']>, content: string, imgs: Record<string, ReturnType<typeof shared.ref.valueOf>> = {}): void => {
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    for (const [name, ref] of Object.entries(imgs)) page.node.newXObject(name, ref as PDFRef);
    page.node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(doc.context.stream(content))]));
  };
  const p1 = doc.addPage([300, 400]);
  const p2 = doc.addPage([300, 400]);
  const p3 = doc.addPage([300, 400]);
  raw(p1, 'BT /F1 12 Tf 20 360 Td (CONTENUTO PAGINA UNO) Tj ET q 50 0 0 50 100 100 cm /Img1 Do Q', { Img1: shared.ref });
  raw(p3, 'BT /F1 12 Tf 20 360 Td (CONTENUTO PAGINA TRE) Tj ET q 50 0 0 50 100 100 cm /Img1 Do Q', { Img1: shared.ref });
  raw(p2, 'BT /F1 12 Tf 30 340 Td (TESTO PRIVATO NASCOSTO) Tj ET q 80 0 0 80 100 100 cm /ImgP Do Q', { ImgP: priv.ref });
  p2.setCropBox(20, 30, 240, 330);
  p2.setRotation(degrees(90));
  p2.node.set(PDFName.of('UserUnit'), PDFNumber.of(2.5));
  const form = doc.getForm();
  const f1 = form.createTextField('campo1');
  f1.setText('Luigi Verdi');
  f1.addToPage(p1, { x: 20, y: 300, width: 120, height: 20 });
  const f2 = form.createTextField('campo2');
  f2.setText('Mario Rossi');
  f2.addToPage(p2, { x: 40, y: 300, width: 120, height: 20 });
  const ap = doc.context.register(doc.context.stream('0 0.6 0 rg 0 0 60 20 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 60, 20] }));
  p2.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [60, 200, 120, 220], AP: { N: ap }, F: 4 })));
  p2.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 160, 120, 180], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://esempio.invalid/PRIVATO') } })));
  p2.node.set(PDFName.of('Thumb'), doc.context.register(doc.context.stream('THUMB-PRIVATA-DELLA-PAGINA-DUE', { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })));
  p2.node.set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Data: PDFString.of('DATI PRIVATI DELL APP') } }));
  return doc.save({ useObjectStreams: false });
}

const jpegRaster = (w = 600, h = 800): (() => Promise<RasterResult>) => async () => ({ kind: 'jpeg', bytes: fakeJpeg(w, h), width: w, height: h, ms: { render: 1, paint: 1, encode: 1 } });

describe('flatImageMatrix: l\'immagine riempie l\'area visibile come la mostra PDF.js', () => {
  for (const rotate of [0, 90, 180, 270]) {
    for (const userUnit of [1, 2.5]) {
      it(`/Rotate ${rotate}, UserUnit ${userUnit}, CropBox: gli angoli dell'immagine finiscono sugli angoli del foglio`, async () => {
        const doc = await PDFDocument.create();
        const page = doc.addPage([300, 400]);
        page.setCropBox(20, 30, 240, 330);
        page.setRotation(degrees(rotate));
        if (userUnit !== 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
        const pdf = await open(await doc.save());
        const p = await pdf.getPage(1);
        const vp = p.getViewport({ scale: 1 });
        const spec: PageSpec = { view: [20, 30, 260, 360], rotate, userUnit };
        const g = new PageGeometry(spec);
        const m = flatImageMatrix(g);
        // PDF.js: matrice dello spazio utente -> viewport (foglio); composta con quella dell'immagine
        const full = Util.transform(vp.transform, [...m]) as number[];
        const at = (x: number, y: number): SheetPoint => ({ x: (full[0] as number) * x + (full[2] as number) * y + (full[4] as number), y: (full[1] as number) * x + (full[3] as number) * y + (full[5] as number) });
        const W = vp.width;
        const H = vp.height;
        const close = (a: SheetPoint, b: SheetPoint): void => {
          expect(a.x).toBeCloseTo(b.x, 3);
          expect(a.y).toBeCloseTo(b.y, 3);
        };
        close(at(0, 1), { x: 0, y: 0 }); // prima riga di pixel, prima colonna = angolo in alto a sinistra del foglio
        close(at(1, 1), { x: W, y: 0 });
        close(at(0, 0), { x: 0, y: H });
        close(at(1, 0), { x: W, y: H });
        expect(W).toBeCloseTo(g.width, 6);
        expect(H).toBeCloseTo(g.height, 6);
      });
    }
  }
});

describe('exportFlattened: pagine con oggetti sostituite, le altre intatte', () => {
  it('pagina 2 appiattita: contenuto, risorse e chiavi sostituite; riquadri, rotazione e UserUnit invariati; byte in ingresso invariati', async () => {
    const original = await buildDoc();
    const h = await sha(original);
    const r = await exportFlattened(original, exportPages([0, 2, 0]), jpegRaster(), {});
    expect(await sha(original)).toBe(h);
    expect(r.flattenedPages).toBe(1);
    expect(r.images).toMatchObject([{ page: 2, via: 'jpeg', width: 600, height: 800 }]);
    const doc = await PDFDocument.load(r.bytes, { password: '' });
    const node = doc.getPage(1).node;
    const keys = node.entries().map(([k]) => k.asString()).sort();
    expect(keys).toEqual(['/Contents', '/CropBox', '/MediaBox', '/Parent', '/Resources', '/Rotate', '/Type', '/UserUnit']);
    expect(node.lookup(PDFName.of('Rotate'), PDFNumber).asNumber()).toBe(90);
    expect(node.lookup(PDFName.of('UserUnit'), PDFNumber).asNumber()).toBe(2.5);
    const xo = node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    expect(xo.keys().map((k) => k.asString())).toEqual(['/GtFlat']);
    const content = node.lookup(PDFName.of('Contents'), PDFArray).lookup(0, PDFStream).getContents();
    expect(text(content)).toMatch(/^q [-0-9. ]+ cm \/GtFlat Do Q\n$/);
    const img = xo.lookup(PDFName.of('GtFlat'), PDFStream);
    expect(img.dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('DCTDecode'));
    await verifyExport(r.bytes, [SPEC1, SPEC2, SPEC3]); // PDF.js riapre il file: pagine, riquadri, rotazione e UserUnit come l'originale
  });

  it('il vecchio contenuto della pagina appiattita NON resta nel file (testo, immagine privata, miniatura, dati privati, campo, collegamento)', async () => {
    const original = await buildDoc();
    const before = text(original);
    for (const marker of ['TESTO PRIVATO NASCOSTO', 'THUMB-PRIVATA-DELLA-PAGINA-DUE', 'DATI PRIVATI DELL APP', 'esempio.invalid/PRIVATO']) expect(before, marker).toContain(marker);
    const r = await exportFlattened(original, exportPages([0, 1, 0]), jpegRaster(), {});
    const after = text(r.bytes);
    for (const marker of ['TESTO PRIVATO NASCOSTO', 'THUMB-PRIVATA-DELLA-PAGINA-DUE', 'DATI PRIVATI DELL APP', 'esempio.invalid/PRIVATO']) expect(after, marker).not.toContain(marker);
    // le pagine 1 e 3 conservano tutto
    expect(after).toContain('CONTENUTO PAGINA UNO');
    expect(after).toContain('CONTENUTO PAGINA TRE');
    expect(r.pruned.skipped).toBeNull();
    expect(r.pruned.deleted).toBeGreaterThan(5);
    expect(r.pruned.freedBytes).toBeGreaterThan(100);
    // il file non e' piu' grande dell'originale: le vecchie pagine e il loro peso sono usciti (l'immagine finta e' minuscola)
    expect(r.bytes.length).toBeLessThan(original.length);
  });

  it('i campi di modulo: quello della pagina appiattita sparisce da /AcroForm /Fields (e il widget dalla pagina), quello della pagina 1 resta', async () => {
    const original = await buildDoc();
    const r = await exportFlattened(original, exportPages([0, 1, 0]), jpegRaster(), {});
    const doc = await PDFDocument.load(r.bytes, { password: '' });
    const names = doc.getForm().getFields().map((f) => f.getName());
    expect(names).toEqual(['campo1']);
    expect(r.pruned.removedFields).toBeGreaterThanOrEqual(1);
    const pdf = await open(r.bytes);
    const a1 = await (await pdf.getPage(1)).getAnnotations();
    const a2 = await (await pdf.getPage(2)).getAnnotations();
    expect(a1.map((a) => a.fieldName)).toEqual(['campo1']);
    expect(a2).toEqual([]); // niente annotazioni, campi ne' collegamenti
  });

  it('pagine senza oggetti: operatori e testi identici a quelli dell\'originale (anche se condividono font e immagine con la pagina appiattita)', async () => {
    const original = await buildDoc();
    const r = await exportFlattened(original, exportPages([0, 3, 0]), jpegRaster(), {});
    const a = await open(original);
    const b = await open(r.bytes);
    const stable = (v: unknown): string => JSON.stringify(v).replace(/g_d\d+_/g, 'g_dN_');
    for (const n of [1, 3]) {
      const oa = await (await a.getPage(n)).getOperatorList();
      const ob = await (await b.getPage(n)).getOperatorList();
      // le immagini condivise non si decodificano in Node: si confrontano gli operatori che non le riguardano
      const keep = (ol: { fnArray: number[]; argsArray: unknown[] }): string => stable(ol.fnArray.map((f, i) => [f, ol.argsArray[i]]).filter(([, args]) => !JSON.stringify(args).includes('g_d')).map((x) => x));
      expect(keep(ob), `pagina ${n}`).toBe(keep(oa));
      const ta = (await (await a.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : ''));
      const tb = (await (await b.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : ''));
      expect(tb).toEqual(ta);
    }
    // e le risorse condivise ci sono ancora
    const doc = await PDFDocument.load(r.bytes, { password: '' });
    for (const n of [0, 2]) {
      const res = doc.getPage(n).node.lookup(PDFName.of('Resources'), PDFDict);
      expect(res.lookup(PDFName.of('Font'), PDFDict).keys().length).toBe(1);
      expect(res.lookup(PDFName.of('XObject'), PDFDict).keys().length).toBe(1);
    }
  });

  it('testo sotto una copertura NON estraibile nella pagina appiattita (PDF.js non trova nessun testo), estraibile nelle altre', async () => {
    const original = await buildDoc();
    const r = await exportFlattened(original, exportPages([1, 1, 0]), jpegRaster(), {});
    const pdf = await open(r.bytes);
    const strings = async (n: number): Promise<string[]> => (await (await pdf.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).filter((s) => s.trim() !== '');
    expect(await strings(1)).toEqual([]); // pagina 1 appiattita: nessun testo
    expect(await strings(2)).toEqual([]);
    expect(await strings(3)).toEqual(['CONTENUTO PAGINA TRE']);
  });

  it('nessuna pagina con oggetti: nessuna rasterizzazione, nessuna pulizia, file valido', async () => {
    const original = await buildDoc();
    let calls = 0;
    const r = await exportFlattened(original, exportPages([0, 0, 0]), async () => { calls++; return jpegRaster()(); }, {});
    expect(calls).toBe(0);
    expect(r).toMatchObject({ flattenedPages: 0, imageBytes: 0 });
    expect(r.pruned).toMatchObject({ deleted: 0, skipped: null });
    await verifyExport(r.bytes, [SPEC1, SPEC2, SPEC3]);
  });

  it('PNG RGB: inserito senza decodifica (percorso diretto); RGBA: percorso di pdf-lib; entrambi validi', async () => {
    const original = await buildDoc();
    const png = async (type: 2 | 6): Promise<RasterResult> => ({ kind: 'png', bytes: (await makePng(30, 40, { colorType: type })).png, width: 30, height: 40, ms: { render: 0, paint: 0, encode: 0 } });
    for (const [type, via] of [[2, 'png-idat'], [6, 'png-embed']] as const) {
      const r = await exportFlattened(original, exportPages([1, 0, 1]), () => png(type), {});
      expect(r.images.map((i) => i.via)).toEqual([via, via]);
      await verifyExport(r.bytes, [SPEC1, SPEC2, SPEC3]);
    }
  });

  it('progresso: pagina corrente, totale e byte delle immagini misurati', async () => {
    const original = await buildDoc();
    const seen: string[] = [];
    await exportFlattened(original, exportPages([1, 0, 1]), jpegRaster(100, 100), { onProgress: (p) => seen.push(`${p.current}/${p.total} p${p.page} ${p.imageBytes}`) });
    expect(seen).toEqual([`1/2 p1 0`, `2/2 p3 ${fakeJpeg(100, 100).length}`]);
  });

  it('un errore della rasterizzazione (ultimo pixel) ferma tutto con il suo codice e il numero di pagina; l\'originale non cambia', async () => {
    const original = await buildDoc();
    const h = await sha(original);
    const fail = async (): Promise<RasterResult> => {
      throw new ExportError('canvas', 'Il dispositivo non ha memoria per un\'immagine di 9921 x 7016 px.', undefined, 2);
    };
    const err = await exportFlattened(original, exportPages([0, 1, 0]), fail, {}).catch((e: unknown) => e);
    expect((err as ExportError).code).toBe('canvas');
    expect((err as ExportError).page).toBe(2);
    expect(await sha(original)).toBe(h);
    const other = await exportFlattened(original, exportPages([0, 1, 0]), async () => { throw new Error('boom'); }, {}).catch((e: unknown) => e);
    expect((other as ExportError).code).toBe('write');
  });

  it('oggetto che pdf-lib non interpreta (PDFInvalidObject): niente pulizia, avviso, il resto funziona', async () => {
    const doc = await PDFDocument.load(await buildDoc(), { password: '' });
    doc.context.register(PDFInvalidObject.of(Uint8Array.from('<< /Rotto ( ((( [ >> ]', (c) => c.charCodeAt(0)))); // al riletto non e' un oggetto valido
    const original = await doc.save({ useObjectStreams: false });
    const reread = await PDFDocument.load(original, { password: '' });
    expect(reread.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFInvalidObject)).toBe(true); // la premessa della prova
    const r = await exportFlattened(original, exportPages([0, 1, 0]), jpegRaster(), {});
    expect(r.pruned.skipped).toBe('invalid-objects');
    expect(r.pruned.deleted).toBe(0);
    expect(r.warnings.map((w) => w.text).join(' ')).toContain('potrebbe restare nel file');
    await verifyExport(r.bytes, [SPEC1, SPEC2, SPEC3]);
  });

  it('PDF con sole restrizioni del proprietario (cifrato, utente vuoto): si appiattisce e il risultato si riapre', async () => {
    const d = await PDFDocument.load(await buildDoc(), { password: '' });
    d.encrypt({ userPassword: '', ownerPassword: 'owner', permissions: { printing: false } });
    const original = await d.save({ useObjectStreams: false });
    const r = await exportFlattened(original, exportPages([0, 1, 0]), jpegRaster(), {});
    await verifyExport(r.bytes, [SPEC1, SPEC2, SPEC3]);
  });
});

describe('oggetti orfani con tipi di riferimento particolari', () => {
  it('risorse condivise tra la pagina appiattita e un\'altra pagina restano; font e immagine "solo della pagina 2" se ne vanno', async () => {
    const original = await buildDoc();
    const r = await exportFlattened(original, exportPages([0, 1, 0]), jpegRaster(), {});
    const before = await PDFDocument.load(original, { password: '' });
    const after = await PDFDocument.load(r.bytes, { password: '' });
    const streams = (d: PDFDocument): number => d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFStream).length;
    expect(streams(after)).toBeLessThan(streams(before) + 1); // un'immagine in piu', ma pagina, miniatura, timbro, campo... in meno
    // nessun riferimento pendente: ogni riferimento raggiungibile dalla radice si risolve
    const refs: PDFRef[] = [];
    const stack: unknown[] = [after.catalog];
    const seen = new Set<string>();
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) {
        if (seen.has(o.tag)) continue;
        seen.add(o.tag);
        refs.push(o);
        const t = after.context.lookup(o);
        expect(t, `riferimento ${o.tag} pendente`).toBeDefined();
        stack.push(t);
      } else if (o instanceof PDFDict) stack.push(...o.entries().map(([, v]) => v));
      else if (o instanceof PDFArray) stack.push(...o.asArray());
      else if (o instanceof PDFStream) stack.push(o.dict);
    }
    expect(refs.length).toBeGreaterThan(10);
    expect(PDFHexString).toBeDefined();
  });
});
