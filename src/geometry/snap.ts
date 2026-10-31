// Snap sugli oggetti (V2a, CP6a): Estremo e Punto medio. Logica senza DOM, nel foglio mostrato (pt fisici, /Rotate, CropBox e
// UserUnit gia' applicati da `PageGeometry`) come `hit.ts` e `ortho.ts`: si riporta nello spazio utente solo all'inserimento,
// con `geom.sheetToUser`, come per ogni altro punto.
//
// Candidati (decisione 48 di docs/PIANO.md):
//   Retta e Linea .......... Estremo = ogni punto; Punto medio = il centro di ogni tratto.
//   Copertura rettangolo
//   e quadrato ............. Estremo = i 4 angoli; Punto medio = i centri dei 4 lati, come li vede il foglio dopo /Rotate.
//   Copertura cerchio ...... nessuno (il Centro arriva con il cerchio, V2b).
//   Quota .................. Estremo = i due punti misurati `p1` e `p2` (servono alle quote a catena); nessun Punto medio.
//   Testo .................. nessuno.
// A parita' di distanza vince l'Estremo sul Punto medio.
import type { PageObject } from '../model/model';
import type { PageGeometry, SheetPoint, UserPoint } from './page';

export type SnapKind = 'end' | 'mid';
export const SNAP_KINDS: readonly SnapKind[] = ['end', 'mid'];
/** Nomi dei tipi di snap, come in DESIGN.md ("Estremo", "Punto medio"; non "Spigolo"). */
export const SNAP_LABEL: Record<SnapKind, string> = { end: 'Estremo', mid: 'Punto medio' };
export type SnapKinds = Readonly<Record<SnapKind, boolean>>;

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

/** Due distanze che differiscono meno di cosi' (pt) sono una parita': vince l'Estremo. */
const TIE_EPS = 1e-9;

const rank = (k: SnapKind): number => (k === 'end' ? 0 : 1);

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
    case 'cover': {
      if (o.shape === 'circle') return;
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
 * A parita' di distanza (entro 1e-9 pt) vince l'Estremo sul Punto medio; a parita' anche di tipo, il primo nell'ordine degli oggetti.
 * `objects` sono gli oggetti della pagina corrente (nello spazio utente); il risultato e' nel foglio.
 */
export function findSnap(objects: readonly PageObject[], geom: PageGeometry, raw: SheetPoint, radius: number, kinds: SnapKinds): SnapHit | null {
  if (!(radius > 0) || (!kinds.end && !kinds.mid)) return null;
  const r2 = radius * radius;
  let bestD = Infinity;
  let bestKind: SnapKind = 'end';
  let bestX = 0;
  let bestY = 0;
  let found = false;
  const consider = (x: number, y: number, kind: SnapKind): void => {
    if (!kinds[kind]) return;
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
  for (const o of objects) visitCandidates(o, geom, consider);
  return found ? { point: { x: bestX, y: bestY }, kind: bestKind } : null;
}
