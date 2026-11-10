// Costruzione di PDF sintetici per i test di src/pdf (geometry.test.ts, geometryMeasure.test.ts): operatori scritti a mano, livelli (OCG e OCMD), form XObject
// (anche annidate), metadati. Non e' importato dall'app: resta fuori dal build.
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';

export interface FormSpec {
  content: string;
  matrix?: number[];
  bbox?: number[];
  /** nome nella risorsa XObject della form -> chiave di un'altra form */
  uses?: Record<string, string>;
}
export interface PdfSpec {
  content: string;
  mediabox?: [number, number];
  rotate?: number;
  ocgs?: { key: string; name: string; on: boolean }[];
  ocmds?: { key: string; groups: string[]; policy?: string }[];
  forms?: Record<string, FormSpec>;
  /** Metadati del documento (per provare che non finiscono in "Copia misura"). */
  meta?: { title?: string; author?: string; producer?: string; creator?: string; subject?: string; keywords?: string[] };
}
export async function makePdf(spec: PdfSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  if (spec.meta) {
    if (spec.meta.title) doc.setTitle(spec.meta.title);
    if (spec.meta.author) doc.setAuthor(spec.meta.author);
    if (spec.meta.producer) doc.setProducer(spec.meta.producer);
    if (spec.meta.creator) doc.setCreator(spec.meta.creator);
    if (spec.meta.subject) doc.setSubject(spec.meta.subject);
    if (spec.meta.keywords) doc.setKeywords(spec.meta.keywords);
  }
  const page = doc.addPage(spec.mediabox ?? [600, 800]);
  const ctx = doc.context;
  const res: Record<string, unknown> = {};
  if (spec.ocgs) {
    const props: Record<string, unknown> = {};
    const refs: unknown[] = [];
    const on: unknown[] = [];
    const off: unknown[] = [];
    for (const g of spec.ocgs) {
      const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(g.name) }));
      refs.push(ref);
      (g.on ? on : off).push(ref);
      props[g.key] = ref;
    }
    for (const m of spec.ocmds ?? []) {
      const d: Record<string, unknown> = { Type: 'OCMD', OCGs: m.groups.map((k) => props[k]) };
      if (m.policy) d['P'] = PDFName.of(m.policy);
      props[m.key] = ctx.register(ctx.obj(d as never));
    }
    doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: refs, D: { Order: refs, ON: on, OFF: off } } as never));
    res['Properties'] = props;
  }
  if (spec.forms) {
    const made = new Map<string, unknown>();
    const mk = (key: string): unknown => {
      const hit = made.get(key);
      if (hit) return hit;
      const f = spec.forms![key]!;
      const d: Record<string, unknown> = { Type: 'XObject', Subtype: 'Form', BBox: f.bbox ?? [0, 0, 600, 800] };
      if (f.matrix) d['Matrix'] = f.matrix;
      if (f.uses) {
        const xo: Record<string, unknown> = {};
        for (const [name, k] of Object.entries(f.uses)) xo[name] = mk(k);
        d['Resources'] = ctx.obj({ XObject: xo } as never);
      }
      const ref = ctx.register(ctx.stream(f.content, d as never));
      made.set(key, ref);
      return ref;
    };
    const xo: Record<string, unknown> = {};
    for (const k of Object.keys(spec.forms)) xo[k] = mk(k);
    res['XObject'] = xo;
  }
  page.node.set(PDFName.of('Resources'), ctx.obj(res as never));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(spec.content)));
  if (spec.rotate) page.node.set(PDFName.of('Rotate'), ctx.obj(spec.rotate));
  return doc.save({ useObjectStreams: false });
}

