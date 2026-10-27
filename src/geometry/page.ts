// Geometria di una pagina: spazio utente PDF <-> foglio come appare sullo schermo.
//
// - Spazio utente PDF: dove vivono gli oggetti (unita' utente, origine in basso a sinistra del MediaBox, Y verso l'alto).
//   Indipendente da zoom, /Rotate e CropBox.
// - Foglio ("sheet"): pt fisici (1/72 in) della pagina MOSTRATA, origine in alto a sinistra, Y verso il basso,
//   con /Rotate, CropBox e UserUnit applicati. Corrisponde al viewport a scala 1 di PDF.js.
//
// Le formule replicano PageViewport di PDF.js (pdfjs-dist 6.4.299, src/display/page_viewport.js); un test le confronta
// con PageViewport per tutte le rotazioni.

export interface Pt {
  x: number;
  y: number;
}
/** Punto nello spazio utente PDF. */
export type UserPoint = Pt;
/** Punto sul foglio mostrato, in pt fisici, origine in alto a sinistra. */
export type SheetPoint = Pt;

export interface PageSpec {
  /** CropBox ∩ MediaBox [x0, y0, x1, y1] nello spazio utente (page.view di PDF.js). */
  view: readonly [number, number, number, number];
  /** /Rotate della pagina: 0, 90, 180, 270 (altri multipli di 90 sono normalizzati). */
  rotate: number;
  /** UserUnit: dimensione di un'unita' utente in 1/72 in (default 1). */
  userUnit: number;
}

export class PageGeometry {
  /** Dimensioni del foglio mostrato, in pt fisici. */
  readonly width: number;
  readonly height: number;
  readonly userUnit: number;
  private readonly m: readonly [number, number, number, number, number, number];

  constructor(spec: PageSpec) {
    const [x0, y0, x1, y1] = spec.view;
    const s = spec.userUnit > 0 ? spec.userUnit : 1;
    const rot = (((spec.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    if (rot % 90 !== 0) throw new Error('PageGeometry: la rotazione deve essere un multiplo di 90 gradi.');
    const cx = (x1 + x0) / 2;
    const cy = (y1 + y0) / 2;
    let a: number, b: number, c: number, d: number;
    switch (rot) {
      case 180:
        [a, b, c, d] = [-1, 0, 0, 1];
        break;
      case 90:
        [a, b, c, d] = [0, 1, 1, 0];
        break;
      case 270:
        [a, b, c, d] = [0, -1, -1, 0];
        break;
      default:
        [a, b, c, d] = [1, 0, 0, -1];
    }
    let offX: number, offY: number;
    if (a === 0) {
      offX = Math.abs(cy - y0) * s;
      offY = Math.abs(cx - x0) * s;
      this.width = (y1 - y0) * s;
      this.height = (x1 - x0) * s;
    } else {
      offX = Math.abs(cx - x0) * s;
      offY = Math.abs(cy - y0) * s;
      this.width = (x1 - x0) * s;
      this.height = (y1 - y0) * s;
    }
    this.userUnit = s;
    this.m = [a * s, b * s, c * s, d * s, offX - a * s * cx - c * s * cy, offY - b * s * cx - d * s * cy];
  }

  userToSheet(p: UserPoint): SheetPoint {
    const m = this.m;
    return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
  }

  sheetToUser(p: SheetPoint): UserPoint {
    const m = this.m;
    const det = m[0] * m[3] - m[1] * m[2];
    const x = p.x - m[4];
    const y = p.y - m[5];
    return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
  }

  /**
   * Angolo della linea di base (gradi, antiorario come in PDF, in [0, 360)) con cui un testo scritto nello spazio utente
   * appare orizzontale e leggibile sul foglio mostrato: 0, 90, 180 o 270 a seconda di /Rotate. Per l'esportazione (CP5):
   * e' l'argomento `rotate` del testo.
   */
  get uprightAngleDeg(): number {
    const m = this.m;
    const det = m[0] * m[3] - m[1] * m[2];
    // direzione "verso destra sul foglio" (1, 0) riportata nello spazio utente
    const deg = (Math.atan2(-m[1] / det, m[3] / det) * 180) / Math.PI;
    const rounded = Math.round(deg / 90) * 90; // sono multipli di 90 a meno dell'errore numerico
    return ((rounded % 360) + 360) % 360;
  }

  /** Il punto sta dentro il foglio (bordo compreso). */
  contains(s: SheetPoint): boolean {
    return s.x >= 0 && s.y >= 0 && s.x <= this.width && s.y <= this.height;
  }

  /** Distanza in pt FISICI del foglio tra due punti utente (tiene conto di UserUnit). */
  distancePt(a: UserPoint, b: UserPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y) * this.userUnit;
  }
}
