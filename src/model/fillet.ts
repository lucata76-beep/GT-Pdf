// Raccordo (CP6h, V2c): che cosa cambia nel modello. La geometria (punti di tangenza, punto sull'arco) e' in `geometry/fillet`; qui si decide quali oggetti si accorciano, se una Linea si
// spezza, che cosa si aggiunge, e il comando che lo fa in UN SOLO passo di Annulla e di Ripeti.
//
// Casi (decisioni dell'utente dell'8/11/2026, ore 21:10, e scelte dell'assistente dichiarate in docs/PIANO.md):
//  - due oggetti diversi (Retta o Linea): l'estremo vicino di ogni tratto e' sostituito dal punto di tangenza; l'estremo deve essere il primo o l'ultimo punto dell'oggetto, altrimenti la
//    Linea verrebbe tagliata a meta' e si rifiuta (limite NON risolto: «tratto interno»);
//  - due tratti CONSECUTIVI della stessa Linea (spigolo): la Linea P = [p0 ... pk] diventa P1 = [p0 ... p_i, T1] (conserva id e tratto) e una Linea NUOVA P2 = [T2, p_{i+2} ... pk] con lo stesso
//    tratto; P2 sta subito dopo P nell'elenco (l'ordine di disegno delle altre linee non cambia);
//  - lo spigolo del punto di CHIUSURA di una Linea chiusa (primo punto = ultimo, entro FILLET_CLOSED_EPS_PT): la Linea resta una sola, [T_primo, p1 ... p_{k-1}, T_ultimo];
//  - due tratti NON consecutivi della stessa Linea: rifiuto.
// L'arco (un normale Arco, statico, non legato alle rette) ha p1 = T1, p2 = M, p3 = T2 e il tratto (stile, colore, spessore) COPIATO da quello del primo tratto scelto; va in fondo all'elenco.
import { type Fillet, type FilletSide, filletFromSides, filletProblemText } from '../geometry/fillet';
import type { PageGeometry, UserPoint } from '../geometry/page';
import type { Command } from './history';
import { type ArcObject, type DocumentModel, type LineObject, type PageObject, type PointChange, isLine, pointsOf } from './model';

/** Etichetta di Annulla e Ripeti. */
export const FILLET_LABEL = 'Raccordo';
/** Una Linea con primo e ultimo punto a meno di cosi' (pt del foglio) e' chiusa: lo spigolo di chiusura si raccorda come ogni altro. */
export const FILLET_CLOSED_EPS_PT = 1e-6;

/** I rifiuti che dipendono dagli oggetti (non dalla geometria), una riga. */
export const FILLET_EDIT_TEXT = {
  missing: 'Uno dei due tratti non c\'è più: scegli di nuovo i tratti.',
  interior: 'Il raccordo accorcia solo i tratti agli estremi di una Linea.',
  notConsecutive: 'Due tratti della stessa Linea si raccordano solo se sono consecutivi.',
} as const;

export interface FilletPlan {
  /** Gli oggetti esistenti che cambiano, con i punti prima e dopo. */
  changes: PointChange[];
  /** Gli oggetti nuovi con il loro indice nell'elenco FINALE: l'eventuale seconda Linea (subito dopo la prima) e l'arco (in fondo). */
  added: { obj: PageObject; index: number }[];
  /** L'arco aggiunto. */
  arc: ArcObject;
  /** La geometria del raccordo. */
  fillet: Fillet;
  /** Quanti oggetti esistenti cambiano (1 o 2) e se una Linea e' stata spezzata in due. */
  changed: number;
  split: boolean;
}
export type FilletPlanResult = { ok: true; plan: FilletPlan } | { ok: false; message: string };

const same = (a: UserPoint, b: UserPoint): boolean => a.x === b.x && a.y === b.y;
const fail = (message: string): FilletPlanResult => ({ ok: false, message });

/** Il tratto scelto e' ancora quello salvato nell'oggetto (stesso indice, stessi due punti). */
function currentTract(o: LineObject, s: FilletSide): boolean {
  const a = o.points[s.index];
  const b = o.points[s.index + 1];
  return !!a && !!b && same(a, s.a) && same(b, s.b);
}

/**
 * Il piano del raccordo fra due tratti scelti con raggio `radiusPt` (pt FISICI del foglio), o il motivo del rifiuto in una riga. `objects` e' l'elenco della pagina; `newId` da' gli id
 * degli oggetti nuovi e si chiama SOLO se il piano riesce (ogni id e' assegnato una volta, cosi' Ripeti reinserisce gli stessi oggetti). Senza effetti sul modello.
 */
export function planFillet(objects: readonly PageObject[], s1: FilletSide, s2: FilletSide, radiusPt: number, geom: PageGeometry, newId: () => number): FilletPlanResult {
  const o1 = objects.find((o) => o.id === s1.id);
  const o2 = objects.find((o) => o.id === s2.id);
  if (!o1 || !o2 || !isLine(o1) || !isLine(o2) || !currentTract(o1, s1) || !currentTract(o2, s2)) return fail(FILLET_EDIT_TEXT.missing);

  // stessa Linea: solo tratti consecutivi (spigolo) o i due tratti che si incontrano nel punto di chiusura di una Linea chiusa
  let mode: 'two' | 'split' | 'closed' = 'two';
  if (o1.id === o2.id && s1.index !== s2.index) {
    const lo = Math.min(s1.index, s2.index);
    const hi = Math.max(s1.index, s2.index);
    const n = o1.points.length;
    if (hi === lo + 1) mode = 'split';
    else if (lo === 0 && hi === n - 2 && n >= 4 && geom.distancePt(o1.points[0] as UserPoint, o1.points[n - 1] as UserPoint) <= FILLET_CLOSED_EPS_PT) mode = 'closed';
    else return fail(FILLET_EDIT_TEXT.notConsecutive);
  }

  const r = filletFromSides(s1, s2, radiusPt, geom);
  if (!r.ok) return fail(filletProblemText(r));
  const f = r.fillet;
  const [e1, e2] = f.ends;
  const before1 = pointsOf(o1);
  const changes: PointChange[] = [];
  const extra: PageObject[] = []; // la seconda Linea, se serve (subito dopo la prima)
  let splitLine: LineObject | null = null;

  if (mode === 'two') {
    for (const [o, s, e, before] of [
      [o1, s1, e1, before1],
      [o2, s2, e2, pointsOf(o2)],
    ] as const) {
      const at = s.index + (e.replace === 'a' ? 0 : 1); // l'indice del punto che si sostituisce
      if (at !== 0 && at !== before.length - 1) return fail(FILLET_EDIT_TEXT.interior);
      const after = before.map((p) => ({ ...p }));
      after[at] = { ...e.tangent };
      changes.push({ id: o.id, before, after });
    }
  } else if (mode === 'closed') {
    // il vertice e' il punto di chiusura: il tratto 0 perde il primo punto, il tratto n - 2 l'ultimo; la Linea resta una sola
    const n = before1.length;
    const [first, lastTract] = s1.index === 0 ? [e1, e2] : [e2, e1];
    const firstSide = s1.index === 0 ? s1 : s2;
    if (firstSide.index !== 0 || first.replace !== 'a' || lastTract.replace !== 'b') return fail(FILLET_EDIT_TEXT.interior);
    const after = before1.map((p) => ({ ...p }));
    after[0] = { ...first.tangent };
    after[n - 1] = { ...lastTract.tangent };
    changes.push({ id: o1.id, before: before1, after });
  } else {
    // spigolo di una Linea: i due estremi vicini sono il vertice condiviso (indice i + 1); la Linea si spezza li'
    const [low, lowSide, high] = s1.index < s2.index ? [e1, s1, e2] : [e2, s2, e1];
    if (low.replace !== 'b' || high.replace !== 'a') return fail(FILLET_EDIT_TEXT.interior);
    const i = lowSide.index;
    const first = before1.slice(0, i + 1).map((p) => ({ ...p }));
    first.push({ ...low.tangent });
    const second = [{ ...high.tangent }, ...before1.slice(i + 2).map((p) => ({ ...p }))];
    changes.push({ id: o1.id, before: before1, after: first });
    splitLine = o1;
    extra.push({ id: newId(), kind: 'polyline', points: second, stroke: { ...o1.stroke } });
  }

  const arc: ArcObject = { id: newId(), kind: 'arc', p1: { ...e1.tangent }, p2: { ...f.mid }, p3: { ...e2.tangent }, stroke: { ...o1.stroke } };
  const added: { obj: PageObject; index: number }[] = [];
  if (splitLine) added.push({ obj: extra[0] as PageObject, index: objects.indexOf(splitLine) + 1 });
  added.push({ obj: arc, index: objects.length + extra.length });
  return { ok: true, plan: { changes, added, arc, fillet: f, changed: changes.length, split: splitLine !== null } };
}

/**
 * Il raccordo come UN comando: un passo di Annulla e di Ripeti e UN solo cambiamento del modello (`DocumentModel.edit`) per `apply` e per `revert`. Annulla rimette i punti di prima
 * (valori esatti) e toglie gli oggetti aggiunti: numero di oggetti, id e ordine nell'elenco tornano quelli di prima. Gli id degli oggetti nuovi sono quelli del piano, quindi Ripeti
 * reinserisce gli STESSI oggetti.
 */
export class FilletCommand implements Command<DocumentModel> {
  readonly label = FILLET_LABEL;
  constructor(
    readonly page: number,
    private readonly plan: Pick<FilletPlan, 'changes' | 'added'>,
  ) {}
  apply(m: DocumentModel): void {
    m.edit(this.page, { points: this.plan.changes.map((c) => ({ id: c.id, pts: c.after })), add: this.plan.added });
  }
  revert(m: DocumentModel): void {
    m.edit(this.page, { points: this.plan.changes.map((c) => ({ id: c.id, pts: c.before })), remove: this.plan.added.map((a) => a.obj.id) });
  }
}
