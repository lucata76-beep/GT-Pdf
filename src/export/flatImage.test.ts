import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedFlatImage, parsePngRgb8 } from './flatImage';
import { fakeJpeg, makePng } from './testImages';

describe('parsePngRgb8', () => {
  it('RGB 8 bit non interlacciato: dimensioni e IDAT concatenati (anche spezzati in piu\' chunk)', async () => {
    const { png, idat } = await makePng(20, 10, { parts: 4 });
    const r = parsePngRgb8(png);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ width: 20, height: 10 });
    expect(Array.from(r?.idat ?? [])).toEqual(Array.from(idat));
  });
  it('RGBA, interlacciato, 16 bit, firma sbagliata o troncato: null (si ripiega su embedPng)', async () => {
    expect(parsePngRgb8((await makePng(4, 4, { colorType: 6 })).png)).toBeNull();
    expect(parsePngRgb8((await makePng(4, 4, { interlace: 1 })).png)).toBeNull();
    expect(parsePngRgb8((await makePng(4, 4, { depth: 16 })).png)).toBeNull();
    const ok = (await makePng(4, 4)).png;
    expect(parsePngRgb8(ok.subarray(0, ok.length - 20))).toBeNull();
    expect(parsePngRgb8(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
    const bad = ok.slice();
    bad[0] = 0;
    expect(parsePngRgb8(bad)).toBeNull();
  });
});

describe('embedFlatImage', () => {
  async function stream(doc: PDFDocument, ref: ReturnType<PDFDocument['context']['nextRef']>): Promise<{ dict: PDFDict; contents: Uint8Array }> {
    const s = doc.context.lookup(ref) as unknown as { dict: PDFDict; getContents(): Uint8Array };
    return { dict: s.dict, contents: s.getContents() };
  }
  it('JPEG: i byte restano quelli del canvas (stesso contenuto, DCTDecode), dimensioni dal marcatore', async () => {
    const doc = await PDFDocument.create();
    const jpg = fakeJpeg(300, 200);
    const e = await embedFlatImage(doc, 'jpeg', jpg);
    expect(e).toMatchObject({ via: 'jpeg', width: 300, height: 200 });
    const { dict, contents } = await stream(doc, e.ref);
    expect(dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('DCTDecode'));
    expect(dict.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceRGB'));
    expect(Array.from(contents)).toEqual(Array.from(jpg));
  });
  it('PNG RGB 8 bit: IDAT inseriti senza decodifica (FlateDecode, predittore 15, 3 colori, colonne = larghezza)', async () => {
    const doc = await PDFDocument.create();
    const { png, idat } = await makePng(64, 32);
    const e = await embedFlatImage(doc, 'png', png);
    expect(e).toMatchObject({ via: 'png-idat', width: 64, height: 32 });
    const { dict, contents } = await stream(doc, e.ref);
    expect(Array.from(contents)).toEqual(Array.from(idat));
    expect(dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('FlateDecode'));
    const parms = dict.lookup(PDFName.of('DecodeParms'), PDFDict);
    expect(parms.lookup(PDFName.of('Predictor'), PDFNumber).asNumber()).toBe(15);
    expect(parms.lookup(PDFName.of('Colors'), PDFNumber).asNumber()).toBe(3);
    expect(parms.lookup(PDFName.of('Columns'), PDFNumber).asNumber()).toBe(64);
    expect(dict.get(PDFName.of('ColorSpace'))).toEqual(PDFName.of('DeviceRGB'));
    expect(contents).toBeInstanceOf(Uint8Array);
    expect(doc.context.lookup(e.ref) instanceof PDFRawStream).toBe(true);
  });
  it('PNG RGBA: ripiego su embedPng di pdf-lib (decodifica e ricompressione), file valido', async () => {
    const doc = await PDFDocument.create();
    const { png } = await makePng(16, 16, { colorType: 6 });
    const e = await embedFlatImage(doc, 'png', png);
    expect(e).toMatchObject({ via: 'png-embed', width: 16, height: 16 });
    const { dict } = await stream(doc, e.ref);
    expect(dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('FlateDecode'));
  });
  it('pngDirect: false forza il percorso di pdf-lib anche per un PNG RGB (serve alle misure di confronto)', async () => {
    const doc = await PDFDocument.create();
    const { png } = await makePng(16, 16);
    expect((await embedFlatImage(doc, 'png', png, { pngDirect: false })).via).toBe('png-embed');
  });
});
