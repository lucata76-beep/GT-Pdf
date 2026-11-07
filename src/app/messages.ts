// Testi dei messaggi di stato che dipendono dal GENERE del nome dell'oggetto ("Retta cancellata", "Arco cancellato"): funzioni pure, provate in `messages.test.ts`.
// Maschili: testo, cerchio, arco. Femminili: retta, linea, quota, copertura (tutte le forme). Prima di V2b solo il testo era maschile e il controllo era sparso
// nell'app (`fem`, e il "lo/la" con `o.kind === 'text'`).
import { type PageObject, objectLabel, objectNoun } from '../model/model';

export const isMasculine = (o: PageObject): boolean => o.kind === 'text' || o.kind === 'circle' || o.kind === 'arc';
/** Desinenza del participio: "cancellato" / "cancellata". */
const end = (o: PageObject): 'o' | 'a' => (isMasculine(o) ? 'o' : 'a');
/** Il pronome di "Annulla lo ripristina" / "Annulla la ripristina". */
const pron = (o: PageObject): 'lo' | 'la' => (isMasculine(o) ? 'lo' : 'la');
const capitalNoun = (o: PageObject): string => objectNoun(o).replace(/^./, (c) => c.toUpperCase());

/** "Cerchio aggiunto: raggio 10 mm. Annulla per toglierlo." / "Retta aggiunta. Annulla per toglierla." */
export const addedMessage = (o: PageObject, detail?: string): string => `${objectLabel(o)} aggiunt${end(o)}${detail ? `: ${detail}` : ''}. Annulla per toglier${pron(o)}.`;
/** "Arco cancellato. Annulla lo ripristina." / "Retta cancellata. Annulla la ripristina." */
export const deletedMessage = (o: PageObject): string => `${capitalNoun(o)} cancellat${end(o)}. Annulla ${pron(o)} ripristina.`;
/** "Cerchio spostato. Annulla lo rimette a posto." / "Retta spostata. Annulla la rimette a posto." */
export const movedMessage = (o: PageObject): string => `${capitalNoun(o)} spostat${end(o)}. Annulla ${pron(o)} rimette a posto.`;
/** Il testo breve della barra contestuale con Seleziona: "Selezionato: Cerchio" / "Selezionata: Retta" (una riga: la barra non deve cambiare altezza). */
export const selectedText = (o: PageObject): string => `Selezionat${end(o)}: ${objectLabel(o)}`;

// ---- Selezione multipla e trasformazioni (CP6e) ----
// Per UN oggetto valgono le forme con il genere del nome (sopra); per N >= 2 una forma plurale generica ("3 oggetti spostati. Annulla li rimette a posto.").

/** Quale trasformazione: serve al participio ("spostat-", "specchiat-", "ruotat-"). */
export type TransformVerb = 'move' | 'mirror' | 'rotate';
const PARTICIPLE: Record<TransformVerb, string> = { move: 'spostat', mirror: 'specchiat', rotate: 'ruotat' };
/** Il verbo all'imperativo, per le etichette di Annulla e Ripeti e per le voci dei menu: "Sposta", "Specchia", "Ruota". */
export const VERB_LABEL: Record<TransformVerb, string> = { move: 'Sposta', mirror: 'Specchia', rotate: 'Ruota' };

/** "Selezionati: 3 oggetti" (N >= 2): una riga, come "Selezionata: Retta", perche' la barra contestuale non cambi altezza. */
export const selectedManyText = (n: number): string => `Selezionati: ${n} oggetti`;

/** "3 oggetti cancellati. Annulla li ripristina." */
export const deletedManyMessage = (n: number): string => `${n} oggetti cancellati. Annulla li ripristina.`;
/** "3 oggetti spostati. Annulla li rimette a posto." (N >= 2) */
export const transformedManyMessage = (verb: TransformVerb, n: number): string => `${n} oggetti ${PARTICIPLE[verb]}i. Annulla li rimette a posto.`;
/** "Retta specchiata. Annulla la rimette a posto." (un oggetto; il genere del nome) */
export const transformedMessage = (verb: TransformVerb, o: PageObject): string => `${capitalNoun(o)} ${PARTICIPLE[verb]}${end(o)}. Annulla ${pron(o)} rimette a posto.`;
/** Con "Mantieni l'originale" acceso: gli originali restano e si crea una copia (una frase al femminile: "copia"), "Annulla la toglie". */
export const copiedMessage = (verb: TransformVerb, n: number): string =>
  n === 1 ? `Copia creata e ${PARTICIPLE[verb]}a: l'originale resta. Annulla la toglie.` : `${n} copie create e ${PARTICIPLE[verb]}e: gli originali restano. Annulla le toglie.`;
/** "Retta duplicata. Annulla la toglie." / "3 oggetti duplicati. Annulla li toglie." */
export const duplicatedMessage = (objs: readonly PageObject[]): string => {
  const first = objs[0];
  return objs.length === 1 && first ? `${capitalNoun(first)} duplicat${end(first)}. Annulla ${pron(first)} toglie.` : `${objs.length} oggetti duplicati. Annulla li toglie.`;
};
