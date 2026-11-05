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
