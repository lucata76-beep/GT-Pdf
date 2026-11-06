// Costruzione per punti successivi degli strumenti Retta, Linea, Scala, Distanza, Testo, Quota, Copertura, Cerchio/Arco e Origine.
// Logica senza DOM: i punti sono nello spazio utente PDF; il vincolo ortogonale e' calcolato nel foglio mostrato.
// Testo e Copertura non usano l'ortogonale: una copertura con ORTO sarebbe un rettangolo senza altezza e il quadrato ha il suo vincolo (`squareSheet`).
// Cerchio e Arco (V2b) non lo usano: sono scelte dell'assistente da confermare (decisione 67); snap e griglia valgono come per ogni punto indicato.
// La Quota lo usa solo sul SECONDO punto di Allineata, Ø e R (come la Retta; decisione 56 di PIANO.md). Non sull'Orizzontale e sulla Verticale, che misurano
// gia' una componente (e `place` rifiuta due punti sulla stessa X o Y), e non sul terzo punto di nessuna quota: e' la posizione della linea di quota,
// gia' vincolata dal tipo di quota.
// Priorita' del punto effettivo (`resolve`): (1) squadratura del secondo punto del quadrato; (2) snap su un oggetto, se un candidato e' nel
// raggio; (3) ORTO, se attivo e c'e' un'ancora; (4) griglia, se accesa e visibile: arrotonda le coordinate rimaste libere (senza ORTO tutte e due, con
// ORTO solo quella libera: l'altra resta uguale all'ancora). Il punto che si vede (marcatore, anteprima, lente) e' quello che si inserisce: con ORTO
// acceso lo snap puo' portare il punto fuori asse e si vede. I punti gia' indicati nella costruzione in corso sono candidati dello snap (Estremo): V2b.
// Origine (CP6d): un solo punto, indicato come ogni altro (snap e griglia attivi, nessun ORTO). Shell (CP6d, decisione 59): i punti digitati sono ESATTI (`placeExact`):
// non passano da snap, griglia, squadratura ne' ORTO, e si rifiutano per distanza in pt (non per i pixel di `COINCIDENT_PX`, che dipendono dallo zoom).
import { ARC_PROBLEM_TEXT, type CurveKind, arcProblem, curveInfo } from '../geometry/arc';
import { type CoverDef, type CoverKind, coverInfo, squareSheet, squareUser } from '../geometry/cover';
import { type DimType, type DimensionDef, buildDimension, dimInfo } from '../geometry/dimension';
import { snapToGrid } from '../geometry/grid';
import { orthoFreeAxis, orthoSheet } from '../geometry/ortho';
import type { PageGeometry, SheetPoint, UserPoint } from '../geometry/page';
import type { Resolved, SnapHit } from '../geometry/snap';
import type { LineKind } from '../model/model';

export type ConstructionTool = 'segment' | 'polyline' | 'calibrate' | 'distance' | 'text' | 'dim' | 'cover' | 'curve' | 'origin';

export interface ConstructionEnv {
  geometry(): PageGeometry | null;
  /** Pixel CSS per pt del foglio (zoom a schermo). */
  zoom(): number;
  ortho(): boolean;
  /**
   * Snap sugli oggetti (V2a): il candidato (Estremo, Punto medio o Centro) entro il raggio dal punto grezzo, o null. `touch` = raggio del dito.
   * `pending` sono i punti gia' indicati nella costruzione in corso (V2b), candidati Estremo; vuoto se non ce n'e'.
   * Facoltativa: senza, nessuno snap (comportamento di prima).
   */
  snap?(raw: SheetPoint, touch: boolean, pending: readonly UserPoint[]): SnapHit | null;
  /**
   * Griglia (V2a): il passo in pt FISICI del foglio se la griglia e' accesa e si vede a questo zoom, altrimenti null. Facoltativa: senza, nessuna griglia.
   * L'origine e' l'angolo in basso a sinistra della pagina mostrata (`snapToGrid`).
   */
  grid?(): number | null;
  /**
   * Origine di pagina sul foglio mostrato (CP6d), o null: i nodi della griglia sono in origine + k * passo. Facoltativa: senza, i nodi partono dall'angolo in basso a sinistra.
   */
  gridOrigin?(): SheetPoint | null;
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
  /** Cerchio (centro, punto sul bordo) o Arco (inizio, punto sull'arco, fine) completato. */
  curve(kind: CurveKind, points: UserPoint[]): void;
  /** Origine (CP6d): il punto e' stato indicato. */
  origin(at: UserPoint): void;
  reject(reason: string): void;
}

/** Due punti piu' vicini di cosi' (pixel CSS) sono lo stesso punto: sulla Linea vale come "fine". */
export const COINCIDENT_PX = 6;
/**
 * Due punti DIGITATI (shell) piu' vicini di cosi' (pt del foglio) sono lo stesso punto e si rifiutano. Volutamente minuscolo (0.001 pt = 0.00035 mm): con la shell
 * la distanza non dipende dallo zoom e un segmento corto ma voluto (2 mm) e' valido anche se a schermo e' sotto i 6 px di `COINCIDENT_PX`.
 */
export const EXACT_MIN_DISTANCE_PT = 0.001;

export const TOOL_NAME: Record<ConstructionTool, string> = {
  segment: 'Retta',
  polyline: 'Linea',
  calibrate: 'Scala',
  distance: 'Distanza',
  text: 'Testo',
  dim: 'Quota',
  cover: 'Copertura',
  curve: 'Cerchio e arco',
  origin: 'Origine',
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
  /** Cerchio o Arco in costruzione. */
  curveKind: CurveKind = 'circle';

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

  /** Cambia tra Cerchio e Arco: i punti gia' indicati si scartano (cambia il numero di punti e il loro significato). */
  setCurveKind(kind: CurveKind): void {
    this.curveKind = kind;
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
      case 'origin':
        return 1;
      case 'dim':
        return dimInfo(this.dimType).points;
      case 'curve':
        return curveInfo(this.curveKind).points;
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

  /**
   * L'ultimo punto, da cui parte il vincolo ortogonale; null per il primo punto e per gli strumenti senza ORTO (Testo, Copertura, Cerchio e Arco).
   * Quota: solo il secondo punto di Allineata, Ø e R (con un punto gia' indicato); null per Orizzontale e Verticale e per il terzo punto (posizione della linea di quota).
   */
  get anchor(): UserPoint | null {
    if (!this.tool || this.tool === 'text' || this.tool === 'cover' || this.tool === 'curve' || this.tool === 'origin' || this.done || this.locked) return null;
    if (this.tool === 'dim' && (this.points.length !== 1 || this.dimType === 'horizontal' || this.dimType === 'vertical')) return null;
    return this.points.at(-1) ?? null;
  }

  /**
   * Porta il punto grezzo (foglio) sul punto effettivo e dice se e' stato uno snap a portarlo li'. Ordine: per il secondo punto del quadrato, l'angolo
   * squadrato (vince su tutto); poi lo snap su un oggetto (a ogni punto indicato, a strumento non bloccato); poi l'ortogonale rispetto all'ultimo punto, se attivo.
   * `touch`: il raggio di cattura dello snap e' piu' largo col dito.
   */
  resolve(raw: SheetPoint, touch = false): Resolved {
    const geom = this.env.geometry();
    const first = this.points[0];
    if (geom && first && this.tool === 'cover' && this.coverKind === 'square' && this.points.length === 1 && !this.locked) return { point: squareSheet(geom.userToSheet(first), raw), snap: null };
    if (geom && this.tool && !this.locked) {
      const hit = this.env.snap?.(raw, touch, this.pending ? this.points : []) ?? null;
      if (hit) return { point: hit.point, snap: hit.kind };
    }
    const step = geom && this.tool && !this.locked ? (this.env.grid?.() ?? null) : null;
    const a = this.anchor;
    const gridOrigin = step ? (this.env.gridOrigin?.() ?? null) : null;
    if (!geom || !a || !this.env.ortho()) return { point: step && geom ? snapToGrid(raw, step, geom, undefined, gridOrigin) : raw, snap: null };
    const sa = geom.userToSheet(a);
    const o = orthoSheet(sa, raw);
    return { point: step ? snapToGrid(o, step, geom, orthoFreeAxis(sa, raw), gridOrigin) : o, snap: null };
  }

  /** Il solo punto effettivo di `resolve`. */
  constrain(raw: SheetPoint, touch = false): SheetPoint {
    return this.resolve(raw, touch).point;
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
      if (this.tool === 'curve' && this.curveKind === 'arc' && this.points.length === 2) {
        // Arco, terzo punto: la fine non puo' coincidere con l'inizio (sarebbe un cerchio) e i tre punti devono dare un arco (non allineati, raggio non enorme).
        const s1 = geom.userToSheet(this.points[0] as UserPoint);
        if (Math.hypot(sb.x - s1.x, sb.y - s1.y) * this.env.zoom() < COINCIDENT_PX) {
          this.ev.reject('Inizio e fine coincidono: per un arco chiuso usa il cerchio.');
          return;
        }
        const problem = arcProblem(this.points[0] as UserPoint, this.points[1] as UserPoint, p);
        if (problem) {
          this.ev.reject(ARC_PROBLEM_TEXT[problem]);
          return;
        }
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
    this.commit(geom, p);
  }

  /** Aggiunge il punto `p` (gia' validato) e, se la costruzione e' completa, la consegna all'app. */
  private commit(geom: PageGeometry, p: UserPoint): void {
    this.points.push(p);
    switch (this.tool) {
      case 'origin': {
        this.reset();
        this.ev.origin(p);
        break;
      }
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
      case 'curve':
        if (this.points.length === this.needed) {
          const pts = this.points;
          const kind = this.curveKind;
          this.reset();
          this.ev.curve(kind, pts);
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

  /**
   * Che cosa si aspetta la shell (CP6d, decisioni 59 e 71) al passo corrente: un punto "X;Y" (Retta, Linea, centro del Cerchio), il raggio del Cerchio, o niente
   * (Arco, Copertura, Testo, Quota, Scala, Distanza, Origine, strumento fermo o bloccato).
   */
  get shellStep(): 'point' | 'radius' | null {
    if (this.locked || this.done) return null;
    switch (this.tool) {
      case 'segment':
      case 'polyline':
        return 'point';
      case 'curve':
        return this.curveKind === 'circle' ? (this.points.length === 0 ? 'point' : this.points.length === 1 ? 'radius' : null) : null;
      default:
        return null;
    }
  }

  /**
   * Un punto DIGITATO (shell): esatto, quindi non passa da snap, griglia, squadratura ne' ORTO. Si rifiuta (con `reject`) se coincide con l'ultimo punto, per distanza in
   * pt del foglio (`EXACT_MIN_DISTANCE_PT`): sulla Linea NON termina la linea in silenzio, come invece fa `place` con i 6 px. Falso se non c'e' un passo che aspetti un punto.
   */
  placeExact(p: UserPoint): boolean {
    const geom = this.env.geometry();
    const step = this.shellStep;
    if (!geom || step === null) return false;
    const last = this.points.at(-1);
    if (last && geom.distancePt(last, p) < EXACT_MIN_DISTANCE_PT) {
      this.ev.reject(step === 'radius' ? 'Il raggio è troppo piccolo: digita un numero più grande.' : 'I due punti coincidono: digita un punto diverso.');
      return false;
    }
    this.commit(geom, p);
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
      case 'curve':
        return this.curvePrompt(n);
      case 'origin':
        return 'Origine: indica il punto da cui contare X e Y';
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

  /** Una riga, come gli altri: Cerchio (centro, punto sul bordo) e Arco (inizio, punto sull'arco, fine). */
  private curvePrompt(n: number): string {
    if (this.curveKind === 'circle') return n === 0 ? 'Cerchio: indica il centro' : 'Cerchio: indica un punto sul bordo';
    return n === 0 ? 'Arco: indica l\'inizio' : n === 1 ? 'Arco: indica un punto sull\'arco' : 'Arco: indica la fine';
  }

  /**
   * Testo guida con la shell visibile (una riga): dice che si puo' indicare col mouse o digitare. Null se la shell non aspetta niente (si usa `prompt`).
   */
  get shellPrompt(): string | null {
    const step = this.shellStep;
    if (step === null) return null;
    const n = this.points.length;
    switch (this.tool) {
      case 'segment':
        return n === 0 ? 'Retta: indica o digita X;Y del punto iniziale' : 'Retta: indica o digita X;Y del punto finale';
      case 'polyline':
        return n === 0 ? 'Linea: indica o digita X;Y del primo punto' : n === 1 ? 'Linea: indica o digita X;Y del punto successivo' : 'Linea: indica o digita X;Y; Invio vuoto o Fine termina';
      default:
        return step === 'point' ? 'Cerchio: indica o digita X;Y del centro' : 'Cerchio: indica un punto sul bordo o digita il raggio';
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
