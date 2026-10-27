// Costruzione per punti successivi degli strumenti Retta, Linea, Scala e Distanza.
// Logica senza DOM: i punti sono nello spazio utente PDF; il vincolo ortogonale e' calcolato nel foglio mostrato.
import { orthoSheet } from '../geometry/ortho';
import type { PageGeometry, SheetPoint, UserPoint } from '../geometry/page';
import type { LineKind } from '../model/model';

export type ConstructionTool = 'segment' | 'polyline' | 'calibrate' | 'distance';

export interface ConstructionEnv {
  geometry(): PageGeometry | null;
  /** Pixel CSS per pt del foglio (zoom a schermo). */
  zoom(): number;
  ortho(): boolean;
}

export interface ConstructionEvents {
  /** Retta (2 punti) o Linea (2 o piu' punti) completata. */
  line(kind: LineKind, points: UserPoint[]): void;
  /** Due punti per la calibrazione: l'app apre il dialogo e poi chiama `reset()`. */
  calibrate(a: UserPoint, b: UserPoint): void;
  /** Due punti misurati: il risultato resta mostrato fino al punto successivo. */
  measure(a: UserPoint, b: UserPoint): void;
  reject(reason: string): void;
}

/** Due punti piu' vicini di cosi' (pixel CSS) sono lo stesso punto: sulla Linea vale come "fine". */
export const COINCIDENT_PX = 6;

export const TOOL_NAME: Record<ConstructionTool, string> = {
  segment: 'Retta',
  polyline: 'Linea',
  calibrate: 'Scala',
  distance: 'Distanza',
};

export class Construction {
  tool: ConstructionTool | null = null;
  points: UserPoint[] = [];
  /** Distanza: i due punti sono stati misurati e restano visibili; il prossimo tocco inizia una nuova misura. */
  done = false;
  /** Scala: i due punti sono in attesa del dialogo; i tocchi sono ignorati. */
  locked = false;

  constructor(
    private readonly env: ConstructionEnv,
    private readonly ev: ConstructionEvents,
  ) {}

  setTool(tool: ConstructionTool | null): void {
    this.tool = tool;
    this.reset();
  }

  reset(): void {
    this.points = [];
    this.done = false;
    this.locked = false;
  }

  /** Ci sono punti in costruzione (non ancora una linea finita). */
  get pending(): boolean {
    return this.points.length > 0 && !this.done;
  }

  /** L'ultimo punto, da cui parte il vincolo ortogonale; null per il primo punto. */
  get anchor(): UserPoint | null {
    if (!this.tool || this.done || this.locked) return null;
    return this.points.at(-1) ?? null;
  }

  /** Porta il punto grezzo (foglio) sul punto effettivo: ortogonale rispetto all'ultimo punto, se attivo. */
  constrain(raw: SheetPoint): SheetPoint {
    const geom = this.env.geometry();
    const a = this.anchor;
    if (!geom || !a || !this.env.ortho()) return raw;
    return orthoSheet(geom.userToSheet(a), raw);
  }

  /** Un tocco (o clic) ha inserito il punto `p` (gia' vincolato). */
  place(p: UserPoint): void {
    const geom = this.env.geometry();
    if (!geom || !this.tool || this.locked) return;
    if (this.done) this.reset(); // nuova misura
    const last = this.points.at(-1);
    if (last) {
      const sa = geom.userToSheet(last);
      const sb = geom.userToSheet(p);
      const tooClose = Math.hypot(sb.x - sa.x, sb.y - sa.y) * this.env.zoom() < COINCIDENT_PX;
      if (tooClose) {
        if (this.tool === 'polyline' && this.points.length >= 2) this.finish();
        else this.ev.reject('I due punti coincidono: scegli un secondo punto diverso.');
        return;
      }
    }
    this.points.push(p);
    switch (this.tool) {
      case 'segment':
        if (this.points.length === 2) {
          const pts = this.points;
          this.reset();
          this.ev.line('segment', pts);
        }
        break;
      case 'calibrate':
        if (this.points.length === 2) {
          this.locked = true;
          this.ev.calibrate(this.points[0] as UserPoint, this.points[1] as UserPoint);
        }
        break;
      case 'distance':
        if (this.points.length === 2) {
          this.done = true;
          this.ev.measure(this.points[0] as UserPoint, this.points[1] as UserPoint);
        }
        break;
      default:
    }
  }

  /** Linea: termina. Con meno di 2 punti non c'e' nulla da creare. */
  finish(): void {
    if (this.tool !== 'polyline') return;
    if (this.points.length >= 2) {
      const pts = this.points;
      this.reset();
      this.ev.line('polyline', pts);
    } else {
      this.reset();
    }
  }

  /** Toglie l'ultimo punto in costruzione. Falso se non c'era nulla da togliere. */
  undoLast(): boolean {
    if (this.locked || this.done || this.points.length === 0) return false;
    this.points.pop();
    return true;
  }

  /** Testo guida per il passo corrente. */
  get prompt(): string {
    const n = this.points.length;
    switch (this.tool) {
      case 'segment':
        return n === 0 ? 'Retta: indica il primo punto' : 'Retta: indica il secondo punto';
      case 'polyline':
        return n === 0 ? 'Linea: indica il primo punto' : n === 1 ? 'Linea: indica il punto successivo' : 'Linea: indica il punto successivo; tocca due volte l\'ultimo punto o premi Fine per terminare';
      case 'calibrate':
        return this.locked ? 'Scala: inserisci la distanza reale' : n === 0 ? 'Scala: indica il primo punto di una distanza nota' : 'Scala: indica il secondo punto';
      case 'distance':
        return this.done ? 'Distanza: indica un punto per una nuova misura' : n === 0 ? 'Distanza: indica il primo punto' : 'Distanza: indica il secondo punto';
      default:
        return '';
    }
  }
}
