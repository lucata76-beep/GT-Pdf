// Statistiche della misura degli archi (V3.2c, CP7e): contenitori e classi degli istogrammi. SOLA MISURA: nessuna tolleranza e' decisa qui, le classi sono scelte da Code e dichiarate
// nelle righe di `measureLines` (src/pdf/geometryMeasure.ts) e in docs/PIANO.md (decisione 124, da confermare). Modulo puro: le tolleranze di CP7a per il conteggio di riferimento
// arrivano come booleano dal chiamante (src/pdf/geometry.ts), cosi' non c'e' nessuna importazione circolare.
import { type ArcMeasure, BENT_FRACTION } from './circleFit';

/** Scostamento massimo RELATIVO (scostamento / raggio), limite superiore INCLUSO: fino a 1e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 0.1; oltre 0.1 (8 classi). */
export const REL_EDGES = [1e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 1e-1] as const;
/** Scostamento massimo ASSOLUTO (pt utente), limite superiore INCLUSO: fino a 1e-4, 1e-3, 2e-3 (= CIRCLE_TOL_ABS di CP7a), 1e-2, 0.1, 1; oltre 1 (7 classi). */
export const ABS_EDGES = [1e-4, 1e-3, 2e-3, 1e-2, 1e-1, 1] as const;
/** Raggio (pt utente), limite superiore ESCLUSO: sotto 0.1; 0.1-1; 1-10; 10-100; 100-1000; 1000 e oltre (6 classi). */
export const RADIUS_EDGES = [0.1, 1, 10, 100, 1000] as const;
/** Angolo coperto (gradi): fino a 10, 90, 180, 270 (limiti superiori INCLUSI con il margine ANGLE_MARGIN), poi meno di 360, circa 360 e oltre 360 (7 classi). */
export const ANGLE_EDGES = [10, 90, 180, 270] as const;
/** Margine (gradi) dei limiti degli angoli: serve a mettere un arco esatto di 90 gradi in «fino a 90» e un cerchio in «circa 360»; NON e' una tolleranza di riconoscimento. */
export const ANGLE_MARGIN = 0.5;
/** Scostamento delle tangenti (gradi), limite superiore INCLUSO: fino a 0.01, 0.1, 1, 5, 15; oltre 15 (6 classi). */
export const TAN_EDGES = [0.01, 0.1, 1, 5, 15] as const;
/** Contenitori dei vertici dei poligoni fitti: 12-16, 17-24, 25-32, 33-64, 65-128, 129-256 (6). */
export const VERTEX_BUCKETS = 6;

export const REL_CLASSES = REL_EDGES.length + 1;
export const ABS_CLASSES = ABS_EDGES.length + 1;
export const RADIUS_CLASSES = RADIUS_EDGES.length + 1;
export const ANGLE_CLASSES = ANGLE_EDGES.length + 3;
export const TAN_CLASSES = TAN_EDGES.length + 1;

function upTo(v: number, edges: readonly number[]): number {
  for (let i = 0; i < edges.length; i++) if (v <= (edges[i] as number)) return i;
  return edges.length;
}
/** Classe dello scostamento relativo (limite superiore incluso). */
export const relClass = (v: number): number => upTo(v, REL_EDGES);
/** Classe dello scostamento assoluto (limite superiore incluso). */
export const absClass = (v: number): number => upTo(v, ABS_EDGES);
/** Classe dello scostamento delle tangenti (limite superiore incluso). */
export const tanClass = (v: number): number => upTo(v, TAN_EDGES);
/** Classe del raggio (limite superiore escluso). */
export function radiusClass(r: number): number {
  for (let i = 0; i < RADIUS_EDGES.length; i++) if (r < (RADIUS_EDGES[i] as number)) return i;
  return RADIUS_EDGES.length;
}
/** Classe dell'angolo coperto in gradi: 0-3 «fino a 10, 90, 180, 270» (con margine), 4 «meno di 360», 5 «circa 360» (entro il margine), 6 «oltre 360». */
export function angleClass(deg: number): number {
  for (let i = 0; i < ANGLE_EDGES.length; i++) if (deg <= (ANGLE_EDGES[i] as number) + ANGLE_MARGIN) return i;
  if (deg < 360 - ANGLE_MARGIN) return ANGLE_EDGES.length;
  if (deg <= 360 + ANGLE_MARGIN) return ANGLE_EDGES.length + 1;
  return ANGLE_EDGES.length + 2;
}
/** Contenitore dei vertici (>= 12) dei poligoni fitti misurati (<= 256). */
export function vertexBucket(v: number): number {
  return v <= 16 ? 0 : v <= 24 ? 1 : v <= 32 ? 2 : v <= 64 ? 3 : v <= 128 ? 4 : 5;
}

/** Un contenitore (per stato e numero di cubiche, o per numero di vertici). Gli istogrammi contano SOLO i sottopercorsi con raggio determinato e sotto soglia (`arcs`). */
export interface ArcBucket {
  /** Sottopercorsi misurati = `arcs` + `straight`. */
  subpaths: number;
  /** Cubiche (catene) o vertici (poligoni) dei sottopercorsi misurati, per il conto. */
  units: number;
  /** Con raggio determinato e sotto la soglia dei quasi rettilinei: entrano negli istogrammi. */
  arcs: number;
  /** Quasi rettilinei: raggio oltre la soglia o non determinabile (contati a parte). */
  straight: number;
  /** Fra i quasi rettilinei, quelli con raggio non determinabile. */
  undetermined: number;
  /** Fra i quasi rettilinei con raggio determinabile, quelli NON piatti (punti a piu' di BENT_FRACTION della diagonale dalla retta ai minimi quadrati, per esempio una S) e la piattezza massima. */
  bent: number;
  flatMax: number;
  relHist: number[];
  relMax: number;
  absHist: number[];
  absMax: number;
  /** Quanti hanno gli scostamenti dei nodi e dei punti a meta' curva entro le tolleranze di CP7a (riferimento, NON una regola di riconoscimento). */
  withinCp7a: number;
  radiusHist: number[];
  radiusMin: number | null;
  radiusMax: number | null;
  angleHist: number[];
  angleMin: number | null;
  angleMax: number | null;
  /** Tangenti (solo catene di cubiche): quanti hanno uno scostamento misurato, il loro istogramma e il massimo (gradi); salto massimo nei giunti (-1: nessun giunto misurato). */
  tanMeasured: number;
  tanHist: number[];
  tanMax: number;
  jointMax: number;
}

/** Sottopercorsi che il tetto lascia solo contati (oltre N cubiche o oltre il massimo di vertici). */
export interface ArcSkipped {
  subpaths: number;
  /** Cubiche o vertici che contengono. */
  units: number;
}

/** Misura degli archi di un gruppo di percorsi (tutti; solo candidati). I contenitori si creano alla prima misura (null = nessun sottopercorso). */
export interface ArcStats {
  /** Sole cubiche, aperti e chiusi: un contenitore per numero di cubiche (indice = cubiche - 1, da 1 a ARC_MAX_CUBICS). */
  cubicOpen: (ArcBucket | null)[];
  cubicClosed: (ArcBucket | null)[];
  /** Sole cubiche oltre ARC_MAX_CUBICS (solo contati). */
  cubicOpenSkipped: ArcSkipped;
  cubicClosedSkipped: ArcSkipped;
  /** Poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica): per vertici (VERTEX_BUCKETS contenitori). */
  poly: (ArcBucket | null)[];
  /** Poligoni fitti con piu' vertici del massimo (solo contati). */
  polySkipped: ArcSkipped;
  /** Vertici di TUTTI i poligoni fitti (misurati e non), contati a parte per il conto. */
  polyVertices: number;
}

export function newArcStats(maxCubics: number): ArcStats {
  return {
    cubicOpen: new Array<ArcBucket | null>(maxCubics).fill(null),
    cubicClosed: new Array<ArcBucket | null>(maxCubics).fill(null),
    cubicOpenSkipped: { subpaths: 0, units: 0 },
    cubicClosedSkipped: { subpaths: 0, units: 0 },
    poly: new Array<ArcBucket | null>(VERTEX_BUCKETS).fill(null),
    polySkipped: { subpaths: 0, units: 0 },
    polyVertices: 0,
  };
}

export function newArcBucket(): ArcBucket {
  return {
    subpaths: 0,
    units: 0,
    arcs: 0,
    straight: 0,
    undetermined: 0,
    bent: 0,
    flatMax: 0,
    relHist: new Array<number>(REL_CLASSES).fill(0),
    relMax: 0,
    absHist: new Array<number>(ABS_CLASSES).fill(0),
    absMax: 0,
    withinCp7a: 0,
    radiusHist: new Array<number>(RADIUS_CLASSES).fill(0),
    radiusMin: null,
    radiusMax: null,
    angleHist: new Array<number>(ANGLE_CLASSES).fill(0),
    angleMin: null,
    angleMax: null,
    tanMeasured: 0,
    tanHist: new Array<number>(TAN_CLASSES).fill(0),
    tanMax: 0,
    jointMax: -1,
  };
}

/** Aggiunge una misura al contenitore `slots[index]` (lo crea se serve). `units`: cubiche o vertici del sottopercorso; `within7a`: vedi ArcBucket.withinCp7a. */
export function addArcMeasure(slots: (ArcBucket | null)[], index: number, m: ArcMeasure, units: number, within7a: boolean): void {
  let b = slots[index];
  if (b === null || b === undefined) {
    b = newArcBucket();
    slots[index] = b;
  }
  b.subpaths++;
  b.units += units;
  if (m.status !== 'arc') {
    b.straight++;
    if (m.status === 'undetermined') b.undetermined++;
    else {
      if (m.flat > BENT_FRACTION) b.bent++;
      if (m.flat > b.flatMax) b.flatMax = m.flat;
    }
    return;
  }
  b.arcs++;
  b.relHist[relClass(m.devRel)]!++;
  if (m.devRel > b.relMax) b.relMax = m.devRel;
  b.absHist[absClass(m.dev)]!++;
  if (m.dev > b.absMax) b.absMax = m.dev;
  if (within7a) b.withinCp7a++;
  b.radiusHist[radiusClass(m.r)]!++;
  if (b.radiusMin === null || m.r < b.radiusMin) b.radiusMin = m.r;
  if (b.radiusMax === null || m.r > b.radiusMax) b.radiusMax = m.r;
  b.angleHist[angleClass(m.angle)]!++;
  if (b.angleMin === null || m.angle < b.angleMin) b.angleMin = m.angle;
  if (b.angleMax === null || m.angle > b.angleMax) b.angleMax = m.angle;
  if (m.tanDev >= 0) {
    b.tanMeasured++;
    b.tanHist[tanClass(m.tanDev)]!++;
    if (m.tanDev > b.tanMax) b.tanMax = m.tanDev;
  }
  if (m.jointBreak > b.jointMax) b.jointMax = m.jointBreak;
}
