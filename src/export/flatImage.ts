// Immagini delle pagine appiattite dentro il PDF (@cantoo/pdf-lib 2.11.1, sorgente letto):
//  - JPEG: `embedJpg` legge solo le dimensioni dal marcatore SOF e mette i byte JPEG **cosi' come sono** nel flusso (`DCTDecode`),
//    senza decodificarli ne' ricomprimerli e senza copiarli (il flusso tiene lo stesso Uint8Array).
//  - PNG, percorso di pdf-lib (`embedPng`): decodifica il PNG in JavaScript (UPNG), lo porta a RGBA, separa RGB e alfa e ricomprime con
//    `zlibSync` (fflate). Misurato in Node su un A4 a 300 dpi (8,7 M px): 0.5-0.7 s di decodifica + 1.1-1.2 s di compressione, circa
//    105 MB di memoria in piu' durante la decodifica (circa 12 byte per pixel): a 600 dpi (34,8 M px) quattro volte tanto.
//  - PNG, percorso diretto (questo file): un PNG a 8 bit RGB non interlacciato (`canvas.toBlob` di un contesto `alpha: false` in Chromium)
//    ha dati che PDF sa gia' leggere: i flussi IDAT, concatenati, sono uno zlib con i filtri per riga di PNG, cioe' `FlateDecode` con
//    `/Predictor 15` (PDF 32000-1, 7.4.4.4). Si inseriscono **senza decodificarli ne' ricomprimerli**, come il JPEG. Se il PNG non e' di
//    quel tipo (per esempio RGBA: Safari NON VERIFICATO) si ripiega su `embedPng`.
// Dopo `embed()` pdf-lib scarta l'embedder (`this.embedder = undefined`): non restano i pixel decodificati, solo i byte compressi nel
// contesto fino a `save()`.
import type { PDFDocument, PDFRef } from '@cantoo/pdf-lib';

export interface PngRgb8 {
  width: number;
  height: number;
  /** Dati dei chunk IDAT concatenati: uno zlib con i filtri per riga di PNG. */
  idat: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Legge un PNG e lo restituisce solo se e' a 8 bit, RGB (tipo 2), non interlacciato; altrimenti null. */
export function parsePngRgb8(bytes: Uint8Array): PngRgb8 | null {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (o: number): string => String.fromCharCode(bytes[o] as number, bytes[o + 1] as number, bytes[o + 2] as number, bytes[o + 3] as number);
  let pos = 8;
  let header: { width: number; height: number } | null = null;
  const parts: Uint8Array[] = [];
  let total = 0;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const name = type(pos + 4);
    const data = pos + 8;
    if (data + len + 4 > bytes.length) return null; // chunk troncato
    if (name === 'IHDR') {
      if (len !== 13) return null;
      const [depth, colorType, compression, filter, interlace] = [bytes[data + 8], bytes[data + 9], bytes[data + 10], bytes[data + 11], bytes[data + 12]];
      if (depth !== 8 || colorType !== 2 || compression !== 0 || filter !== 0 || interlace !== 0) return null;
      header = { width: view.getUint32(data), height: view.getUint32(data + 4) };
    } else if (name === 'IDAT') {
      parts.push(bytes.subarray(data, data + len));
      total += len;
    } else if (name === 'IEND') break;
    pos = data + len + 4;
  }
  if (!header || header.width === 0 || header.height === 0 || total === 0) return null;
  const idat = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    idat.set(p, at);
    at += p.length;
  }
  return { ...header, idat };
}

export type EmbedVia = 'jpeg' | 'png-idat' | 'png-embed';
export interface EmbeddedImage {
  ref: PDFRef;
  via: EmbedVia;
  /** Dimensioni in pixel dell'immagine come inserita nel PDF. */
  width: number;
  height: number;
}

/** Inserisce nel documento l'immagine di una pagina e restituisce il riferimento da usare in `/XObject`. L'immagine e' scritta subito nel contesto. */
export async function embedFlatImage(doc: PDFDocument, kind: 'jpeg' | 'png', bytes: Uint8Array, options: { pngDirect?: boolean } = {}): Promise<EmbeddedImage> {
  if (kind === 'jpeg') {
    const img = await doc.embedJpg(bytes);
    await img.embed();
    return { ref: img.ref, via: 'jpeg', width: img.width, height: img.height };
  }
  const direct = options.pngDirect === false ? null : parsePngRgb8(bytes);
  if (direct) {
    const stream = doc.context.stream(direct.idat, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: direct.width,
      Height: direct.height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: direct.width },
    });
    return { ref: doc.context.register(stream), via: 'png-idat', width: direct.width, height: direct.height };
  }
  const img = await doc.embedPng(bytes);
  await img.embed();
  return { ref: img.ref, via: 'png-embed', width: img.width, height: img.height };
}
