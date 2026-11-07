// Trasformazioni di oggetti (CP6e, decisioni 60 e 75-81): Sposta, Specchio e Rotazione. Funzioni pure, senza DOM.
//
// Principio: si calcola nel FOGLIO MOSTRATO (pt fisici, origine in alto a sinistra, Y verso il basso: un'isometria) e si riporta punto per punto nello spazio
// utente con `PageGeometry.userToSheet` / `sheetToUser`, come gia' fanno ORTO, snap e le quote. NON si trasformano direttamente le coordinate utente: nel foglio la Y
// va verso il basso e con /Rotate il verso di una rotazione si invertirebbe. Lo SPOSTAMENTO e' l'unica eccezione apparente: e' una traslazione, quindi lo
// spostamento sul foglio si riporta UNA volta nello spazio utente (`sheetDeltaToUser`) e si somma ai punti (come il trascinamento di oggi: stessi valori).
//
// Verso dell'angolo: POSITIVO = ANTIORARIO come si vede sul foglio (scelta dell'assistente, da confermare). In `arc.ts` lo sweep positivo e' ORARIO sullo schermo:
// sono due convenzioni diverse, non confonderle.
//
// Ogni tipo e' definito da punti (`pointsOf` / `assignPoints` del modello): trasformare = trasformare i punti, con queste regole.
//  - Retta, Linea, Cerchio, Arco, Copertura circolare, quote allineata, Ø e R: tutti i punti (le quote conservano il valore: e' un'isometria).
//  - Quote orizzontale e verticale: misurano la componente sul foglio. Sposta: si'. Rotazione: NO (decisione 78). Specchio: solo con asse orizzontale o verticale.
//  - Coperture rettangolare e quadrata: sempre allineate agli assi del foglio. Rotazione: solo multipli di 90 gradi (decisione 78). Specchio: solo con asse a multipli di 45 gradi.
//  - Testo: sempre dritto (decisione 78). Si trasforma il CENTRO del suo riquadro e si ricalcola l'angolo in basso a sinistra in modo che il riquadro, dritto, abbia il centro li'.
// Un oggetto non ammesso rifiuta l'INTERA trasformazione (tutto o niente, scelta dell'assistente da confermare): saltarlo in silenzio sposterebbe una parte del disegno.
import type { PageObject } from '../model/model';
import { pointsOf } from '../model/model';
import { arcProblem } from './arc';
import { textRect } from './layout';
import type { PageGeometry, SheetPoint, UserPoint } from './page';
import { ASCENT_EM, DESCENT_EM } from './textMetrics';

/** Limite delle coordinate nello spazio utente (lo stesso di `LIMITS.coordAbs` del formato: un progetto fuori limite non si riaprirebbe). */
export const COORD_LIMIT = 1_000_000;
/** Tolleranza (rad) per riconoscere un asse orizzontale, verticale o a 45 gradi e un angolo multiplo di 90 gradi: stretta, perche' questi valori si ottengono con ORTO, snap o digitandoli. */
export const ANGLE_TOL_RAD = 1e-9;
/** Massimo dell'angolo digitato (gradi, in valore assoluto): 10 giri. Oltre, quasi certamente un errore di battitura; il calcolo usa comunque l'angolo ridotto modulo 360. */
export const ANGLE_MAX_DEG = 3600;
/**
 * Due punti piu' vicini di cosi' (pt FISICI del foglio) coincidono: la stessa soglia dei punti digitati (`EXACT_MIN_DISTANCE_PT` di construction.ts, provato da un test),
 * NON i 6 px di `place`, che dipendono dallo zoom. Vale per l'asse dello Specchio e per lo spostamento di Sposta.
 */
export const MIN_DISTANCE_PT = 0.001;

export type TransformKind = 'move' | 'mirror' | 'rotate';

/** La trasformazione richiesta, nel FOGLIO mostrato (pt fisici). */
export type TransformSpec =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'mirror'; a: SheetPoint; b: SheetPoint }
  /** `deg` positivo = antiorario sul foglio. */
  | { kind: 'rotate'; center: SheetPoint; deg: number };

export type AxisClass = 'horizontal' | 'vertical' | 'diagonal' | 'other';

/** Come si presenta l'asse (a, b) sul foglio: orizzontale, verticale, a 45 gradi o altro, con tolleranza `ANGLE_TOL_RAD`. Null se i due punti coincidono (sotto `MIN_DISTANCE_PT`). */
export function classifyAxis(a: SheetPoint, b: SheetPoint): AxisClass | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len >= MIN_DISTANCE_PT)) return null;
  const ang = Math.atan2(dy, dx); // (-pi, pi]
  const near = (target: number): boolean => Math.abs(Math.atan2(Math.sin(ang - target), Math.cos(ang - target))) <= ANGLE_TOL_RAD;
  if (near(0) || near(Math.PI)) return 'horizontal';
  if (near(Math.PI / 2) || near(-Math.PI / 2)) return 'vertical';
  if (near(Math.PI / 4) || near(-Math.PI / 4) || near((3 * Math.PI) / 4) || near((-3 * Math.PI) / 4)) return 'diagonal';
  return 'other';
}

/** L'angolo (gradi) ridotto in [0, 360). */
export const reduceDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** `deg` e' un multiplo di 360 (entro `ANGLE_TOL_RAD`): non c'e' niente da ruotare. */
export function isFullTurns(deg: number): boolean {
  const r = reduceDeg(deg);
  const tol = (ANGLE_TOL_RAD * 180) / Math.PI;
  return r <= tol || 360 - r <= tol;
}

/** Il numero k tale che `deg` = 90 k (entro `ANGLE_TOL_RAD`), ridotto in 0..3, oppure null se non e' un multiplo di 90 gradi. */
export function quarterTurns(deg: number): 0 | 1 | 2 | 3 | null {
  const r = reduceDeg(deg);
  const k = Math.round(r / 90);
  const tol = (ANGLE_TOL_RAD * 180) / Math.PI;
  return Math.abs(r - 90 * k) <= tol ? ((k % 4) as 0 | 1 | 2 | 3) : null;
}

/** Seno e coseno di `deg`; ESATTI (0, 1, -1) per i multipli di 90 gradi, per non perdere cifre su un'operazione che deve restare esatta. */
function sinCos(deg: number): { sin: number; cos: number } {
  const q = quarterTurns(deg);
  if (q !== null) return [{ sin: 0, cos: 1 }, { sin: 1, cos: 0 }, { sin: 0, cos: -1 }, { sin: -1, cos: 0 }][q] as { sin: number; cos: number };
  const t = (reduceDeg(deg) * Math.PI) / 180;
  return { sin: Math.sin(t), cos: Math.cos(t) };
}

/**
 * L'applicazione di un punto del foglio per Specchio e Rotazione. Con l'asse riconosciuto come orizzontale, verticale o a 45 gradi (`classifyAxis`) l'asse
 * si RADDRIZZA: passa dal primo punto con la direzione esatta (le coordinate escono esatte). Altrimenti nessun arrotondamento.
 */
export function sheetMap(spec: Exclude<TransformSpec, { kind: 'move' }>): (p: SheetPoint) => SheetPoint {
  if (spec.kind === 'rotate') {
    const { sin, cos } = sinCos(spec.deg);
    const c = spec.center;
    // antiorario sul foglio, con la Y verso il basso: x' = cx + dx cos + dy sin ; y' = cy - dx sin + dy cos
    return (p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      return { x: c.x + dx * cos + dy * sin, y: c.y - dx * sin + dy * cos };
    };
  }
  const { a, b } = spec;
  const cls = classifyAxis(a, b);
  let ux: number;
  let uy: number;
  if (cls === 'horizontal') [ux, uy] = [1, 0];
  else if (cls === 'vertical') [ux, uy] = [0, 1];
  else if (cls === 'diagonal') {
    const s = Math.SQRT1_2;
    [ux, uy] = (b.x - a.x) * (b.y - a.y) >= 0 ? [s, s] : [s, -s];
  } else {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
  }
  return (p) => {
    const vx = p.x - a.x;
    const vy = p.y - a.y;
    const k = 2 * (vx * ux + vy * uy);
    return { x: a.x + k * ux - vx, y: a.y + k * uy - vy };
  };
}

/** Perche' la trasformazione in se' non ha senso (spostamento nullo, asse con due punti coincidenti, angolo zero o multiplo di 360), o null. */
export function specProblem(spec: TransformSpec): string | null {
  if (spec.kind === 'move') return Math.hypot(spec.dx, spec.dy) >= MIN_DISTANCE_PT ? null : 'Spostamento nullo: il punto di arrivo coincide con il punto base.';
  if (spec.kind === 'mirror') return classifyAxis(spec.a, spec.b) === null ? 'I due punti dell\'asse coincidono: indica un secondo punto diverso.' : null;
  if (!Number.isFinite(spec.deg)) return 'Angolo non valido.';
  return isFullTurns(spec.deg) ? 'Angolo zero o multiplo di 360 gradi: niente da ruotare.' : null;
}

/** Perche' un oggetto non puo' subire la trasformazione, o null se puo'. La frase e' pronta per il messaggio di stato (una riga). */
export function objectProblem(o: PageObject, spec: TransformSpec): string | null {
  if (spec.kind === 'move') return null;
  if (spec.kind === 'rotate') {
    if (o.kind === 'dim' && (o.dim === 'horizontal' || o.dim === 'vertical')) return 'Rotazione: le quote orizzontali e verticali non ruotano. Deselezionale o usa Sposta.';
    if (o.kind === 'cover' && o.shape !== 'circle' && quarterTurns(spec.deg) === null) return 'Rotazione: le coperture rettangolari e quadrate ruotano solo di multipli di 90 gradi. Deselezionale o cambia l\'angolo.';
    return null;
  }
  const cls = classifyAxis(spec.a, spec.b);
  if (o.kind === 'dim' && (o.dim === 'horizontal' || o.dim === 'vertical') && cls !== 'horizontal' && cls !== 'vertical') {
    return 'Specchio: le quote orizzontali e verticali si specchiano solo con un asse orizzontale o verticale (con ORTO acceso l\'asse lo è). Deselezionale o cambia l\'asse.';
  }
  if (o.kind === 'cover' && o.shape !== 'circle' && cls === 'other') {
    return 'Specchio: le coperture rettangolari e quadrate si specchiano solo con un asse orizzontale, verticale o a 45 gradi. Deselezionale o cambia l\'asse.';
  }
  return null;
}

/** La prima ragione per cui la trasformazione non e' ammessa per la selezione (tutto o niente), o null. */
export function selectionProblem(objects: readonly PageObject[], spec: TransformSpec): string | null {
  for (const o of objects) {
    const p = objectProblem(o, spec);
    if (p) return p;
  }
  return null;
}

const finiteInLimit = (p: UserPoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= COORD_LIMIT && Math.abs(p.y) <= COORD_LIMIT;

/** Il riquadro del testo nel foglio mostrato per l'oggetto `o` (di tipo testo). */
function textBox(o: Extract<PageObject, { kind: 'text' }>, geom: PageGeometry): { origin: SheetPoint; w: number; h: number } {
  const origin = geom.userToSheet(o.at);
  const r = textRect(origin, o.text, o.textPt);
  return { origin, w: r.w, h: r.h };
}

export type PointsResult = { ok: true; points: UserPoint[] } | { ok: false; reason: string };

/**
 * I nuovi punti di un oggetto (stesso ordine di `pointsOf`). NON controlla l'ammissibilita' del tipo (`objectProblem`): controlla il risultato (coordinate finite e
 * nei limiti del formato; arco e cerchio ancora validi con le regole del file). Il testo si trasforma come descritto in testa al file.
 */
export function transformPoints(o: PageObject, spec: TransformSpec, geom: PageGeometry): PointsResult {
  const before = pointsOf(o);
  let after: UserPoint[];
  if (spec.kind === 'move') {
    const d = geom.sheetDeltaToUser(spec.dx, spec.dy);
    after = before.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
  } else {
    const map = sheetMap(spec);
    if (o.kind === 'text') {
      const box = textBox(o, geom);
      const asc = ASCENT_EM * o.textPt;
      const desc = DESCENT_EM * o.textPt;
      const centre = { x: box.origin.x + box.w / 2, y: box.origin.y - asc + (asc + desc) / 2 };
      const c = map(centre);
      after = [geom.sheetToUser({ x: c.x - box.w / 2, y: c.y + asc - (asc + desc) / 2 })];
    } else {
      after = before.map((p) => geom.sheetToUser(map(geom.userToSheet(p))));
    }
  }
  if (!after.every(finiteInLimit)) return { ok: false, reason: 'Il risultato esce dai limiti del foglio: nulla è stato trasformato.' };
  if (o.kind === 'arc' && arcProblem(after[0] as UserPoint, after[1] as UserPoint, after[2] as UserPoint) !== null) return { ok: false, reason: 'Un arco non sarebbe più valido dopo la trasformazione: nulla è stato trasformato.' };
  if (o.kind === 'circle' && (after[0] as UserPoint).x === (after[1] as UserPoint).x && (after[0] as UserPoint).y === (after[1] as UserPoint).y) return { ok: false, reason: 'Un cerchio sarebbe degenere dopo la trasformazione: nulla è stato trasformato.' };
  return { ok: true, points: after };
}

export interface PlannedMove {
  id: number;
  before: UserPoint[];
  after: UserPoint[];
}

export type PlanResult = { ok: true; moves: PlannedMove[] } | { ok: false; reason: string };

/**
 * Piano della trasformazione per tutta la selezione, TUTTO O NIENTE: se un oggetto non e' ammesso (`objectProblem`) o un risultato esce dai limiti o non e' valido,
 * nessun oggetto cambia e la ragione dice che cosa lo impedisce.
 */
export function planTransform(objects: readonly PageObject[], spec: TransformSpec, geom: PageGeometry): PlanResult {
  const bad = specProblem(spec) ?? selectionProblem(objects, spec);
  if (bad) return { ok: false, reason: bad };
  const moves: PlannedMove[] = [];
  for (const o of objects) {
    const r = transformPoints(o, spec, geom);
    if (!r.ok) return r;
    moves.push({ id: o.id, before: pointsOf(o), after: r.points });
  }
  return { ok: true, moves };
}
