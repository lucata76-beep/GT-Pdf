// Lente per puntare con il dito: riquadro quadrato con mirino a croce che mostra un ingrandimento
// della zona sotto il dito. Dimensione, scostamento e ingrandimento sono valori di partenza
// (DESIGN.md: 80 x 80 px, 70 px sopra il punto): da tarare su iPhone reale (NON VERIFICATO).
import { h } from './dom';

export const LENS_SIZE = 80; // px CSS
export const LENS_OFFSET = 70; // px CSS: centro della lente sopra il punto di tocco
export const LENS_MAG = 3;

export interface LensSource {
  /** Centro nel canvas sorgente, in pixel del canvas. */
  cx: number;
  cy: number;
  /** Pixel del canvas per pixel CSS dello schermo. */
  pxPerCss: number;
}

export class Lens {
  readonly el: HTMLDivElement;
  private readonly cv: HTMLCanvasElement;
  private readonly label: HTMLSpanElement;

  constructor() {
    this.cv = h('canvas', { class: 'lens-canvas' });
    this.label = h('span', { class: 'lens-mag num' }, `${LENS_MAG.toFixed(1)}x`);
    this.el = h(
      'div',
      { class: 'lens', hidden: true, 'aria-hidden': 'true' },
      this.cv,
      h('span', { class: 'lens-h' }),
      h('span', { class: 'lens-v' }),
      this.label,
    );
    this.el.style.width = `${LENS_SIZE}px`;
    this.el.style.height = `${LENS_SIZE}px`;
  }

  /**
   * `at` = punto di tocco nel riquadro del viewer; `box` = dimensioni del riquadro.
   * La lente sta sopra il punto; se non c'e' spazio sopra, sotto. Resta sempre dentro il riquadro.
   */
  show(at: { x: number; y: number }, box: { w: number; h: number }, source: HTMLCanvasElement, src: LensSource): void {
    const half = LENS_SIZE / 2;
    let cy = at.y - LENS_OFFSET;
    if (cy - half < 4) cy = at.y + LENS_OFFSET;
    const cx = Math.min(Math.max(at.x, half + 4), Math.max(half + 4, box.w - half - 4));
    cy = Math.min(Math.max(cy, half + 4), Math.max(half + 4, box.h - half - 4));
    this.el.style.transform = `translate(${cx - half}px, ${cy - half}px)`;
    this.el.hidden = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(LENS_SIZE * dpr);
    if (this.cv.width !== px) {
      this.cv.width = px;
      this.cv.height = px;
    }
    const ctx = this.cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#e2e5e9'; // fuori dalla pagina: colore dell'area di lavoro
    ctx.fillRect(0, 0, px, px);
    const side = (LENS_SIZE / LENS_MAG) * src.pxPerCss; // lato della zona sorgente, in pixel del canvas
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, src.cx - side / 2, src.cy - side / 2, side, side, 0, 0, px, px);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
