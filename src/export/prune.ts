// "Appiattito": pulizia del documento dopo aver sostituito il contenuto delle pagine con un'immagine.
//
// 1) Campi di modulo. Annotazioni, campi e collegamenti delle pagine appiattite non restano come oggetti: si tolgono i loro widget dalla
//    pagina (`/Annots`), ma i campi sono elencati anche in /AcroForm /Fields (con i valori, `/V`): si tolgono da li' i widget delle
//    pagine appiattite e i campi che restano senza widget (e dalla lista di calcolo /CO). Dei campi di pagine NON appiattite non si tocca nulla.
// 2) Oggetti orfani. pdf-lib scrive TUTTI gli oggetti del contesto, anche quelli che nessuno referenzia piu': senza questa pulizia il vecchio
//    contenuto delle pagine appiattite (testo sotto le coperture compreso!) resterebbe nel file e il file sarebbe piu' grande dell'originale.
//    Si eliminano solo gli oggetti raggiungibili dalle pagine appiattite (contenuto, risorse, annotazioni, miniatura, dati privati) che dopo la
//    sostituzione NON sono piu' raggiungibili dalla radice del documento (catalogo, Info, Encrypt). Le risorse condivise con altre pagine
//    (font, immagini, moduli, profili colore) restano perche' le raggiungono le altre pagine.
//    Prudenza: se nel documento c'e' anche un solo oggetto che pdf-lib non ha saputo interpretare (`PDFInvalidObject`: puo' contenere
//    riferimenti che non si vedono) NON si elimina nulla e si avvisa che il contenuto sotto potrebbe restare nel file.
import { PDFArray, PDFDict, PDFInvalidObject, PDFName, type PDFContext, type PDFDocument, type PDFObject, PDFRef, PDFStream } from '@cantoo/pdf-lib';

/** Chiavi della pagina che si tengono (area visibile, rotazione, UserUnit, gruppo di trasparenza); tutto il resto si toglie. */
export const PAGE_KEEP_KEYS: ReadonlySet<string> = new Set(['/Type', '/Parent', '/MediaBox', '/CropBox', '/BleedBox', '/TrimBox', '/ArtBox', '/Rotate', '/UserUnit', '/Group', '/Tabs']);

const NO_SKIP: ReadonlySet<string> = new Set();
/** Riferimenti "all'indietro" (pagina padre, pagina dell'annotazione): seguirli porterebbe a tutto il documento. */
const BACK_REFS: ReadonlySet<string> = new Set(['/Parent', '/P']);

function childrenOf(o: PDFObject, skip: ReadonlySet<string>): PDFObject[] {
  if (o instanceof PDFDict) {
    const out: PDFObject[] = [];
    for (const [k, v] of o.entries()) if (!skip.has(k.asString())) out.push(v);
    return out;
  }
  if (o instanceof PDFArray) return o.asArray();
  if (o instanceof PDFStream) return childrenOf(o.dict, skip);
  return [];
}

/** Tutti i riferimenti indiretti raggiungibili dagli oggetti `starts` (visita iterativa, senza ricorsione). */
export function reachableRefs(context: PDFContext, starts: readonly PDFObject[], skip: ReadonlySet<string> = NO_SKIP): Map<string, PDFRef> {
  const seen = new Map<string, PDFRef>();
  const stack: PDFObject[] = [...starts];
  while (stack.length > 0) {
    const o = stack.pop() as PDFObject;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.set(o.tag, o);
      const target = context.lookup(o);
      if (target) stack.push(target);
    } else for (const c of childrenOf(o, skip)) stack.push(c);
  }
  return seen;
}

/** Riferimenti dei widget/annotazioni di una pagina (le annotazioni dirette, senza riferimento, non sono in nessun campo). */
export function annotationRefs(pageDict: PDFDict): PDFRef[] {
  const annots = pageDict.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return [];
  return annots.asArray().filter((o): o is PDFRef => o instanceof PDFRef);
}

export interface FormCleanup {
  /** Widget tolti da /Fields e campi rimasti senza widget. */
  removed: number;
}

/** Toglie da /AcroForm /Fields (e da /CO) i widget indicati e i campi che restano senza widget. */
export function removeFormFields(doc: PDFDocument, widgets: ReadonlySet<string>): FormCleanup {
  if (widgets.size === 0) return { removed: 0 };
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!acro || !fields) return { removed: 0 };
  const gone = new Set<string>();
  const prune = (arr: PDFArray): void => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const item = arr.get(i);
      const tag = item instanceof PDFRef ? item.tag : null;
      if (tag && widgets.has(tag)) {
        arr.remove(i);
        gone.add(tag);
        continue;
      }
      const field = arr.lookupMaybe(i, PDFDict);
      const kids = field?.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (!kids) continue;
      prune(kids);
      if (kids.size() === 0) {
        arr.remove(i);
        if (tag) gone.add(tag);
      }
    }
  };
  prune(fields);
  const calc = acro.lookupMaybe(PDFName.of('CO'), PDFArray);
  if (calc) for (let i = calc.size() - 1; i >= 0; i--) if (gone.has((calc.get(i) as PDFRef).tag ?? '')) calc.remove(i);
  return { removed: gone.size };
}

export interface PruneResult {
  /** Oggetti eliminati. */
  deleted: number;
  /** Byte dei flussi eliminati (contenuti, immagini, font non piu' usati...). */
  freedBytes: number;
  /** Se non si e' eliminato nulla, perche'. */
  skipped: 'invalid-objects' | null;
}

/**
 * Campi "padre" dei widget indicati (catena di `/Parent`). Il valore `/V` e il nome `/T` di un campo stanno nel padre, che NON e' raggiungibile dal widget perche'
 * `/Parent` non si segue (porterebbe a tutto il documento): senza questi candidati il testo compilato resterebbe nel file come oggetto orfano. Sono solo
 * candidati: `pruneOrphans` elimina solo cio' che non e' piu' raggiungibile dalla radice (un campo con altri widget su pagine non appiattite resta).
 */
export function annotationParentRefs(context: PDFContext, annots: readonly PDFRef[]): PDFRef[] {
  const out = new Map<string, PDFRef>();
  for (const ref of annots) {
    let cur: PDFObject | undefined = context.lookup(ref);
    for (let depth = 0; depth < 32 && cur instanceof PDFDict; depth++) {
      const parent: PDFObject | undefined = cur.get(PDFName.of('Parent'));
      if (!(parent instanceof PDFRef) || out.has(parent.tag)) break;
      out.set(parent.tag, parent);
      cur = context.lookup(parent);
    }
  }
  return [...out.values()];
}

/** Riferimenti raggiungibili dai valori che si stanno per togliere da una pagina (senza risalire ai padri). */
export function pageGarbageCandidates(context: PDFContext, dropped: readonly PDFObject[]): Map<string, PDFRef> {
  return reachableRefs(context, dropped, BACK_REFS);
}

/** Elimina dai `candidates` quelli che non sono piu' raggiungibili dalla radice del documento. */
export function pruneOrphans(doc: PDFDocument, candidates: ReadonlyMap<string, PDFRef>): PruneResult {
  const { context } = doc;
  if (candidates.size === 0) return { deleted: 0, freedBytes: 0, skipped: null };
  for (const [, obj] of context.enumerateIndirectObjects()) if (obj instanceof PDFInvalidObject) return { deleted: 0, freedBytes: 0, skipped: 'invalid-objects' };
  const t = context.trailerInfo as { Root?: PDFObject; Info?: PDFObject; Encrypt?: PDFObject; ID?: PDFObject };
  const roots = [t.Root, t.Info, t.Encrypt, t.ID].filter((o): o is PDFObject => o !== undefined);
  const live = reachableRefs(context, roots);
  let deleted = 0;
  let freed = 0;
  for (const [tag, ref] of candidates) {
    if (live.has(tag)) continue;
    const obj = context.lookup(ref);
    if (obj instanceof PDFStream) freed += obj.getContentsSize();
    if (context.delete(ref)) deleted++;
  }
  return { deleted, freedBytes: freed, skipped: null };
}
