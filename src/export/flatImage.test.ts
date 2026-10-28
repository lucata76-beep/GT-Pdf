import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedFlatImage, parsePngRgb8 } from './flatImage';

// ---- PNG e JPEG minimi, costruiti qui (nessun file) ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const t = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const body = new Uint8Array(4 + data.length);
  body.set(t);
  body.set(data, 4);
  return Uint8Array.from([...be32(data.length), ...body, ...be32(crc32(body))]);
};
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}
/** PNG con righe "Sub"-filtrate a caso (tag 1) di `w` x `h` pixel, tipo di colore e profondita' a scelta; IDAT spezzato in `parts` chunk. */
async function makePng(w: number, h: number, opts: { colorType?: number; depth?: number; interlace?: number; parts?: number } = {}): Promise<{ png: Uint8Array; idat: Uint8Array }> {
  const { colorType = 2, depth = 8, interlace = 0, parts = 3 } = opts;
  const bpp = colorType === 6 ? 4 : 3;
  const raw = new Uint8Array(h * (1 + w * bpp));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * bpp)] = 1;
    for (let i = 0; i < w * bpp; i++) raw[y * (1 + w * bpp) + 1 + i] = (y * 31 + i * 7) & 255;
  }
  const z = await deflate(raw);
  const ihdr = Uint8Array.from([...be32(w), ...be32(h), depth, colorType, 0, 0, interlace]);
  const size = Math.ceil(z.length / parts);
  const idats: Uint8Array[] = [];
  for (let o = 0; o < z.length; o += size) idats.push(chunk('IDAT', z.subarray(o, o + size)));
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const all = [sig, chunk('IHDR', ihdr), ...idats, chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    png.set(a, at);
    at += a.length;
  }
  return { png, idat: z };
}
/** Un JPEG "vuoto" ma con intestazione valida (SOI, SOF0 con dimensioni e 3 componenti, EOI): basta a pdf-lib, che legge solo le dimensioni. */
const fakeJpeg = (w: number, h: number): Uint8Array => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

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
