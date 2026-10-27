// Costruzione per punti successivi degli strumenti Retta, Linea, Scala, Distanza, Testo, Quota e Copertura.
// Logica senza DOM: i punti sono nello spazio utente PDF; il vincolo ortogonale e' calcolato nel foglio mostrato.
// Testo, Quota e Copertura non usano l'ortogonale: la posizione della linea di quota e' gia' vincolata dal tipo di quota
// e una copertura con ORTO sarebbe un rettangolo senza altezza. Il quadrato ha il suo vincolo (`squareSheet`).
import { type CoverDef, type CoverKind, coverInfo, squareSheet, squareUser } from '../geometry/cover';
import { type DimType, type DimensionDef, buildDimension, dimInfo } from '../geometry/dimension';
import { orthoSheet } from '../geometry/ortho';
import type { PageGeometry, SheetPoint, UserPoint } from '../geometry/page';
import type { LineKind } from '../model/model';

export type ConstructionTool = 'segment' | 'polyline' | 'calibrate' | 'distance' | 'text' | 'dim' | 'cover';

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
  /** Testo: il punto e' stato indicato; l'app apre il tastierino e poi chiama `reset()`. */
  text(at: UserPoint): void;
  /** Quota: punti indicati e geometria calcolata; l'app apre il tastierino e poi chiama `reset()`. */
  dimension(def: DimensionDef): void;
  /** Copertura completata (rettangolo, quadrato gia' squadrato, cerchio). */
  cover(def: CoverDef): void;
  reject(reason: string): void;
}

/** Due punti piu' vicini di cosi' (pixel CSS) sono lo stesso punto: sulla Linea vale come "fine". */
export const COINCIDENT_PX = 6;

export const TOOL_NAME: Record<ConstructionTool, string> = {
  segment: 'Retta',
  polyline: 'Linea',
  calibrate: 'Scala',
  distance: 'Distanza',
  text: 'Testo',
  dim: 'Quota',
  cover: 'Copertura',
};

export class Construction {
  tool: ConstructionTool | null = null;
  points: UserPoint[] = [];
  /** Distanza: i due punti sono stati misurati e restano visibili; il prossimo tocco inizia una nuova misura. */
  done = false;
  /** Scala, Testo, Quota: i punti sono in attesa del dialogo o del tastierino; i tocchi sono ignorati. */
  locked = false;
  /** Tipo della Quota in costruzione. */
  dimType: DimType = 'aligned';
  /** Forma della Copertura in costruzione. */
  coverKind: CoverKind = 'rect';

  constructor(
    private readonly env: ConstructionEnv,
    private readonly ev: ConstructionEvents,
  ) {}

  setTool(tool: ConstructionTool | null): void {
    this.tool = tool;
    this.reset();
  }

  /** Cambia il tipo di quota: i punti gia' indicati si scartano (cambia il numero di punti necessari). */
  setDimType(type: DimType): void {
    this.dimType = type;
    this.reset();
  }

  /** Cambia la forma della copertura: il punto gia' indicato si scarta (cambia il significato dei due punti). */
  setCoverKind(kind: CoverKind): void {
    this.coverKind = kind;
    this.reset();
  }

  /** Punti che servono per completare lo strumento corrente. */
  get needed(): number {
    switch (this.tool) {
      case 'segment':
      case 'calibrate':
      case 'distance':
      case 'cover':
        return 2;
      case 'text':
        return 1;
      case 'dim':
        return dimInfo(this.dimType).points;
      default:
        return Infinity; // Linea: finisce con Fine
    }
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
    if (!this.tool || this.tool === 'text' || this.tool === 'dim' || this.tool === 'cover' || this.done || this.locked) return null;
    return this.points.at(-1) ?? null;
  }

  /** Porta il punto grezzo (foglio) sul punto effettivo: ortogonale rispetto all'ultimo punto, se attivo; per il quadrato, l'angolo squadrato. */
  constrain(raw: SheetPoint): SheetPoint {
    const geom = this.env.geometry();
    const first = this.points[0];
    if (geom && first && this.tool === 'cover' && this.coverKind === 'square' && this.points.length === 1 && !this.locked) return squareSheet(geom.userToSheet(first), raw);
    const a = this.anchor;
    if (!geom || !a || !this.env.ortho()) return raw;
    return orthoSheet(geom.userToSheet(a), raw);
  }

  /** Un tocco (o clic) ha inserito il punto `placed` (gia' vincolato). */
  place(placed: UserPoint): void {
    const geom = this.env.geometry();
    if (!geom || !this.tool || this.locked) return;
    if (this.done) this.reset(); // nuova misura
    const last = this.points.at(-1);
    // Quadrato: il secondo punto e' sempre l'angolo squadrato (idempotente se il vincolo l'ha gia' applicato).
    const p = this.tool === 'cover' && this.coverKind === 'square' && last ? squareUser(last, placed, geom) : placed;
    // Il terzo punto di una quota e' la posizione della linea di quota: puo' coincidere con l'ultimo.
    if (last && !(this.tool === 'dim' && this.points.length >= 2)) {
      const sa = geom.userToSheet(last);
      const sb = geom.userToSheet(p);
      const tooClose = Math.hypot(sb.x - sa.x, sb.y - sa.y) * this.env.zoom() < COINCIDENT_PX;
      if (tooClose) {
        if (this.tool === 'polyline' && this.points.length >= 2) this.finish();
        else this.ev.reject('I due punti coincidono: scegli un secondo punto diverso.');
        return;
      }
      if (this.tool === 'cover' && this.coverKind === 'rect') {
        // Rettangolo: gli angoli devono differire su entrambi gli assi, altrimenti non ha area.
        if (Math.min(Math.abs(sb.x - sa.x), Math.abs(sb.y - sa.y)) * this.env.zoom() < COINCIDENT_PX) {
          this.ev.reject('Il rettangolo sarebbe troppo stretto: scegli l\'angolo opposto più lontano, sia in orizzontale sia in verticale.');
          return;
        }
      }
      if (this.tool === 'dim' && this.points.length === 1 && (this.dimType === 'horizontal' || this.dimType === 'vertical')) {
        // Orizzontale/verticale: i punti devono differire nella direzione misurata (sul foglio come si vede).
        const d = this.dimType === 'horizontal' ? sb.x - sa.x : sb.y - sa.y;
        if (Math.abs(d) * this.env.zoom() < COINCIDENT_PX) {
          this.ev.reject(this.dimType === 'horizontal' ? 'I due punti sono alla stessa X: una quota orizzontale non si può misurare.' : 'I due punti sono alla stessa Y: una quota verticale non si può misurare.');
          return;
        }
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
      case 'text':
        this.locked = true;
        this.ev.text(p);
        break;
      case 'cover':
        if (this.points.length === 2) {
          const def: CoverDef = { shape: this.coverKind, p1: this.points[0] as UserPoint, p2: this.points[1] as UserPoint };
          this.reset();
          this.ev.cover(def);
        }
        break;
      case 'dim':
        if (this.points.length === this.needed) {
          const def = buildDimension(this.dimType, this.points, geom);
          if (!def) {
            this.points.pop();
            this.ev.reject('Quota non valida: scegli un altro punto.');
          } else {
            this.locked = true;
            this.ev.dimension(def);
          }
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
      case 'text':
        return this.locked ? 'Testo: scrivi con il tastierino' : 'Testo: indica dove inizia (angolo in basso a sinistra)';
      case 'dim':
        return this.dimPrompt(n);
      case 'cover':
        return this.coverPrompt(n);
      default:
        return '';
    }
  }

  /** I testi guida restano brevi (una riga su iPhone): se andassero a capo la barra contestuale cambierebbe altezza e il foglio si ridimensionerebbe sotto il dito. */
  private coverPrompt(n: number): string {
    const name = coverInfo(this.coverKind).label;
    switch (this.coverKind) {
      case 'square':
        return n === 0 ? `${name}: indica un angolo` : `${name}: indica direzione e misura`;
      case 'circle':
        return n === 0 ? `${name}: indica il centro` : `${name}: indica un punto sul bordo`;
      default:
        return n === 0 ? `${name}: indica il primo angolo` : `${name}: indica l'angolo opposto`;
    }
  }

  private dimPrompt(n: number): string {
    const name = dimInfo(this.dimType).label;
    if (this.locked) return `${name}: digita il valore con il tastierino`;
    switch (this.dimType) {
      case 'diameter':
        return n === 0 ? `${name}: indica un punto sul bordo` : `${name}: indica il punto opposto, sul diametro`;
      case 'radius':
        return n === 0 ? `${name}: indica il centro` : `${name}: indica un punto sul bordo`;
      default:
        return n === 0 ? `${name}: indica il primo punto` : n === 1 ? `${name}: indica il secondo punto` : `${name}: indica dove mettere la linea di quota`;
    }
  }
}
