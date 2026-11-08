// Snap sugli oggetti (V2a, CP6a: Estremo e Punto medio; V2b, CP6c: Centro e punti in costruzione). Logica senza DOM, nel foglio mostrato (pt fisici, /Rotate, CropBox e
// UserUnit gia' applicati da `PageGeometry`) come `hit.ts` e `ortho.ts`: si riporta nello spazio utente solo all'inserimento,
// con `geom.sheetToUser`, come per ogni altro punto.
//
// Candidati (decisione 48 di docs/PIANO.md):
//   Retta e Linea .......... Estremo = ogni punto; Punto medio = il centro di ogni tratto.
//   Copertura rettangolo
//   e quadrato ............. Estremo = i 4 angoli; Punto medio = i centri dei 4 lati, come li vede il foglio dopo /Rotate.
//   Copertura cerchio ...... Centro (decisione 67 di docs/PIANO.md; la 48 lo rimandava a V2b).
//   Cerchio (V2b) .......... Centro.
//   Arco (V2b) ............. Estremo = inizio (p1) e fine (p3); Punto medio = il punto a meta' dell'ARCO (non il punto di passaggio p2); Centro.
//                            Il punto di passaggio p2 non e' un candidato: e' solo un punto per cui passa la curva.
//   Quota .................. Estremo = i due punti misurati `p1` e `p2` (servono alle quote a catena); nessun Punto medio.
//   Testo .................. nessuno.
//   Punti in costruzione ... Estremo = ogni punto gia' indicato nella costruzione in corso (`pending` di `findSnap`: chiudere una spezzata, tornare su un punto,
//                            Arco, Quota). Non sono oggetti del modello: li passa chi costruisce, e senza di loro i risultati sono quelli di prima.
// CP6f (Snap ampliato, decisioni 61 e 88-89): Intersezione, Quadrante, Perpendicolare e Tangente si CALCOLANO (`snapExtra.ts`, con una scena di primitive e riquadri in pt del
// foglio) e l'Origine di pagina e' un candidato. Perpendicolare e Tangente hanno bisogno di un punto di partenza (`extra.anchor`: l'ancora della costruzione, la stessa dell'ORTO).
// Senza `extra` e con i tipi nuovi spenti il risultato e' quello di prima.
// A parita' di distanza (1e-9 pt) vince il tipo con priorita' piu' alta: Estremo, Punto medio, Centro, Origine, Intersezione, Quadrante, Perpendicolare, Tangente (i punti gia'
// presenti negli oggetti prima di quelli calcolati).
import type { PageObject } from '../model/model';
import { arcEnd, arcMid, arcStart, curveOnSheet } from './arc';
import type { PageGeometry, SheetPoint, UserPoint } from './page';
import { type ExtraKind, type SnapScene, buildSnapScene, extraCandidates } from './snapExtra';

/** I tipi di snap; l'Origine non ha un interruttore proprio (e' sempre un candidato quando c'e' almeno un interruttore acceso). */
export type SnapKind = 'end' | 'mid' | 'center' | 'origin' | ExtraKind;
/** I tipi con un interruttore. */
export type SnapSwitch = Exclude<SnapKind, 'origin'>;
/** Nell'ordine degli interruttori e della priorita': Estremo, Punto medio, Centro (V2a, V2b), poi Intersezione, Quadrante, Perpendicolare, Tangente (CP6f). */
export const SNAP_KINDS: readonly SnapSwitch[] = ['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent'];
/** Nomi dei tipi di snap, come in DESIGN.md ("Estremo", "Punto medio", "Centro"; non "Spigolo"). */
export const SNAP_LABEL: Record<SnapKind, string> = {
  end: 'Estremo',
  mid: 'Punto medio',
  center: 'Centro',
  origin: 'Origine',
  intersection: 'Intersezione',
  quadrant: 'Quadrante',
  perpendicular: 'Perpendicolare',
  tangent: 'Tangente',
};
/** Gli interruttori accesi; un tipo non elencato e' spento (cosi' le chiamate di prima, con i soli tre tipi, restano valide). */
export type SnapKinds = Readonly<Partial<Record<SnapSwitch, boolean>>>;

/** Dati in piu' di `findSnap` per i tipi di CP6f (tutti facoltativi). */
export interface SnapExtra {
  /** La scena della pagina (`buildSnapScene`), da rifare quando cambiano gli oggetti o la pagina; se manca ma serve, `findSnap` la costruisce a ogni chiamata. */
  scene?: SnapScene;
  /** Punto di partenza (spazio utente) per Perpendicolare e Tangente: l'ancora della costruzione; senza, quei due tipi non danno candidati. */
  anchor?: UserPoint | null;
  /** L'origine della pagina (spazio utente): candidato "Origine". */
  origin?: UserPoint | null;
}

export interface SnapHit {
  /** Il punto agganciato, nel foglio (pt fisici, origine in alto a sinistra). */
  point: SheetPoint;
  kind: SnapKind;
}

/** Il punto effettivo di una posizione: dopo vincoli e snap, e il tipo di snap se e' stato lui a portarlo li'. */
export interface Resolved {
  point: SheetPoint;
  snap: SnapKind | null;
}

/**
 * Raggio di cattura in pixel CSS: valori di PARTENZA, gli stessi di `HIT_TOL_PX` di `viewer.ts` (scelta di oggetti da
 * selezionare o cancellare). NON sono tarati: li giudica l'utente sul PC e li cambia. In pt del foglio il raggio e' px / zoom.
 */
export const SNAP_TOL_PX = { touch: 22, mouse: 10 } as const;

/** Raggio di cattura in pt del foglio per lo zoom a schermo (pixel CSS per pt) e il tipo di puntatore. */
export const snapRadiusPt = (touch: boolean, zoom: number): number => (touch ? SNAP_TOL_PX.touch : SNAP_TOL_PX.mouse) / zoom;

/** Due distanze che differiscono meno di cosi' (pt) sono una parita': vince il tipo con priorita' piu' alta. */
const TIE_EPS = 1e-9;

const RANK: Record<SnapKind, number> = { end: 0, mid: 1, center: 2, origin: 3, intersection: 4, quadrant: 5, perpendicular: 6, tangent: 7 };
const rank = (k: SnapKind): number => RANK[k];

/**
 * Candidati di uno snap in un oggetto, nel foglio. Serve a chi vuole elencarli (prove); `findSnap` non la usa: scorre gli
 * oggetti senza costruire liste.
 */
export function snapCandidates(o: PageObject, geom: PageGeometry): SnapHit[] {
  const out: SnapHit[] = [];
  visitCandidates(o, geom, (x, y, kind) => out.push({ point: { x, y }, kind }));
  return out;
}

function visitCandidates(o: PageObject, geom: PageGeometry, emit: (x: number, y: number, kind: SnapKind) => void): void {
  switch (o.kind) {
    case 'segment':
    case 'polyline': {
      let px = 0;
      let py = 0;
      for (let i = 0; i < o.points.length; i++) {
        const s = geom.userToSheet(o.points[i] as UserPoint);
        if (i > 0) emit((px + s.x) / 2, (py + s.y) / 2, 'mid');
        emit(s.x, s.y, 'end');
        px = s.x;
        py = s.y;
      }
      return;
    }
    case 'circle': {
      const c = geom.userToSheet(o.p1);
      emit(c.x, c.y, 'center');
      return;
    }
    case 'arc': {
      const a = curveOnSheet(o, geom);
      if (!a) {
        // punti che non danno un arco (non succede: costruzione e file lo escludono): almeno i due estremi, che sono punti indicati
        const s = geom.userToSheet(o.p1);
        const e = geom.userToSheet(o.p3);
        emit(s.x, s.y, 'end');
        emit(e.x, e.y, 'end');
        return;
      }
      const s = arcStart(a);
      const m = arcMid(a);
      const e = arcEnd(a);
      emit(s.x, s.y, 'end');
      emit(e.x, e.y, 'end');
      emit(m.x, m.y, 'mid');
      emit(a.c.x, a.c.y, 'center');
      return;
    }
    case 'cover': {
      if (o.shape === 'circle') {
        const c = geom.userToSheet(o.p1);
        emit(c.x, c.y, 'center');
        return;
      }
      // Rettangolo e quadrato (gia' squadrato nei suoi punti): sul foglio e' sempre allineato agli assi, qualunque /Rotate.
      const a = geom.userToSheet(o.p1);
      const b = geom.userToSheet(o.p2);
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      emit(x0, y0, 'end');
      emit(x1, y0, 'end');
      emit(x1, y1, 'end');
      emit(x0, y1, 'end');
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      emit(mx, y0, 'mid');
      emit(x1, my, 'mid');
      emit(mx, y1, 'mid');
      emit(x0, my, 'mid');
      return;
    }
    case 'dim': {
      const a = geom.userToSheet(o.p1);
      const b = geom.userToSheet(o.p2);
      emit(a.x, a.y, 'end');
      emit(b.x, b.y, 'end');
      return;
    }
    default:
      return; // Testo: nessuno snap
  }
}

/**
 * Il candidato piu' vicino a `raw` entro `radius` (pt del foglio, bordo compreso), tra i soli tipi attivi; null se non ce n'e'.
 * A parita' di distanza (entro 1e-9 pt) vince il tipo con priorita' piu' alta (Estremo, Punto medio, Centro, Origine, Intersezione, Quadrante, Perpendicolare, Tangente); a
 * parita' anche di tipo, il primo nell'ordine degli oggetti (i punti in costruzione vengono dopo gli oggetti).
 * `objects` sono gli oggetti della pagina corrente (nello spazio utente); il risultato e' nel foglio.
 * `pending`: i punti gia' indicati nella costruzione in corso (nello spazio utente), candidati Estremo come gli estremi degli oggetti; se mancano o sono
 * vuoti il risultato e' quello di sempre.
 * `extra` (CP6f): scena, punto di partenza e origine; senza `extra` e con i tipi nuovi spenti il risultato e' quello di prima. L'Origine e' un candidato solo se c'e' almeno un
 * interruttore acceso (con tutti spenti non c'e' snap).
 */
export function findSnap(objects: readonly PageObject[], geom: PageGeometry, raw: SheetPoint, radius: number, kinds: SnapKinds, pending: readonly UserPoint[] = [], extra?: SnapExtra): SnapHit | null {
  const base = !!(kinds.end || kinds.mid || kinds.center);
  const calc = !!(kinds.intersection || kinds.quadrant || kinds.perpendicular || kinds.tangent);
  if (!(radius > 0) || (!base && !calc)) return null;
  const r2 = radius * radius;
  let bestD = Infinity;
  let bestKind: SnapKind = 'end';
  let bestX = 0;
  let bestY = 0;
  let found = false;
  const consider = (x: number, y: number, kind: SnapKind): void => {
    if (kind !== 'origin' && !kinds[kind]) return;
    const dx = x - raw.x;
    const dy = y - raw.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) return;
    const d = Math.sqrt(d2);
    if (!found || d < bestD - TIE_EPS || (d <= bestD + TIE_EPS && rank(kind) < rank(bestKind))) {
      found = true;
      bestD = d;
      bestKind = kind;
      bestX = x;
      bestY = y;
    }
  };
  if (base) for (const o of objects) visitCandidates(o, geom, consider);
  if (kinds.end) {
    for (const p of pending) {
      const sp = geom.userToSheet(p);
      consider(sp.x, sp.y, 'end');
    }
  }
  if (extra?.origin) {
    const so = geom.userToSheet(extra.origin);
    consider(so.x, so.y, 'origin');
  }
  if (calc) {
    const scene = extra?.scene ?? buildSnapScene(objects, geom);
    extraCandidates(scene, raw, radius, kinds, extra?.anchor ? geom.userToSheet(extra.anchor) : null, consider);
  }
  return found ? { point: { x: bestX, y: bestY }, kind: bestKind } : null;
}
