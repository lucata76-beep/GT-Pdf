// Livello di disegno sopra il foglio: oggetti, anteprima, segni dei punti, mira, badge di misura.
// Tutto in coordinate del foglio (pt fisici, origine in alto a sinistra): gli oggetti stanno in un gruppo SVG con
// transform translate+scale(zoom), quindi spessori e pattern di tratteggio sono in pt come nell'esportazione.
// Segni, mira e badge hanno dimensione fissa sullo schermo e vengono riposizionati a ogni cambio di vista.
import type { SheetPoint } from '../geometry/page';
import { STROKE_CAP, STROKE_JOIN, STROKE_MITER_LIMIT, type Stroke, dashPattern } from '../model/stroke';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Spessore minimo visibile sullo schermo (pixel CSS): una linea di 0.25 pt a zoom ridotto non deve sparire. */
export const MIN_SCREEN_STROKE_PX = 1;

export interface DrawItem {
  id: number;
  points: readonly SheetPoint[];
  stroke: Stroke;
}
export interface Marker {
  p: SheetPoint;
  label?: string;
}
export interface Badge {
  at: SheetPoint;
  lines: readonly string[];
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const pathData = (pts: readonly SheetPoint[]): string => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

interface StrokeEl {
  el: SVGPathElement;
  widthPt: number;
}

export class SceneOverlay {
  readonly el: HTMLDivElement;
  private readonly sheetG = svgEl('g');
  private readonly objectsG = svgEl('g', { class: 'sc-objects' });
  private readonly hlG = svgEl('g', { class: 'sc-hl' });
  private readonly previewG = svgEl('g', { class: 'sc-preview' });
  private readonly guide = svgEl('path', { class: 'sc-guide', fill: 'none' });
  private readonly markersG = svgEl('g', { class: 'sc-markers' });
  private readonly aimG = svgEl('g', { class: 'aim-mark', display: 'none' });
  private readonly badgeEl = h('div', { class: 'measure-badge', hidden: true });
  private strokes: StrokeEl[] = [];
  private previewStroke: StrokeEl | null = null;
  private markers: { g: SVGGElement; p: SheetPoint }[] = [];
  private aim: SheetPoint | null = null;
  private badge: Badge | null = null;
  private tx = 0;
  private ty = 0;
  private zoom = 1;

  constructor() {
    this.aimG.innerHTML = '<line x1="-10" x2="10" y1="0" y2="0"/><line x1="0" x2="0" y1="-10" y2="10"/>';
    this.guide.setAttribute('display', 'none');
    this.sheetG.append(this.objectsG, this.hlG, this.previewG, this.guide);
    const svg = svgEl('svg', { class: 'viewer-overlay', 'aria-hidden': 'true' });
    svg.append(this.sheetG, this.markersG, this.aimG);
    this.el = h('div', { class: 'viewer-layer' }, svg, this.badgeEl);
  }

  // ---- Vista ----
  setView(tx: number, ty: number, zoom: number): void {
    const zoomChanged = zoom !== this.zoom;
    this.tx = tx;
    this.ty = ty;
    this.zoom = zoom;
    this.sheetG.setAttribute('transform', `translate(${tx} ${ty}) scale(${zoom})`);
    if (zoomChanged) for (const s of this.strokes) this.applyWidth(s);
    this.placeScreenItems();
  }

  private applyWidth(s: StrokeEl): void {
    s.el.setAttribute('stroke-width', String(Math.max(s.widthPt, MIN_SCREEN_STROKE_PX / this.zoom)));
  }

  private makeStroke(points: readonly SheetPoint[], stroke: Stroke): StrokeEl {
    const el = svgEl('path', {
      d: pathData(points),
      fill: 'none',
      stroke: stroke.color,
      'stroke-linecap': STROKE_CAP,
      'stroke-linejoin': STROKE_JOIN,
      'stroke-miterlimit': STROKE_MITER_LIMIT,
    });
    const dash = dashPattern(stroke.style, stroke.widthPt);
    if (dash.length > 0) el.setAttribute('stroke-dasharray', dash.join(' '));
    const s = { el, widthPt: stroke.widthPt };
    this.applyWidth(s);
    return s;
  }

  // ---- Oggetti ----
  setObjects(items: readonly DrawItem[]): void {
    this.strokes = this.previewStroke ? [this.previewStroke] : [];
    const els: SVGPathElement[] = [];
    for (const it of items) {
      const s = this.makeStroke(it.points, it.stroke);
      s.el.dataset.id = String(it.id);
      this.strokes.push(s);
      els.push(s.el);
    }
    this.objectsG.replaceChildren(...els);
  }

  /** Evidenzia un oggetto (es. quello che si sta per cancellare). */
  setHighlight(points: readonly SheetPoint[] | null): void {
    if (!points) {
      this.hlG.replaceChildren();
      return;
    }
    this.hlG.replaceChildren(svgEl('path', { d: pathData(points), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  /** Linea in costruzione, con le proprieta' che avra' una volta finita. */
  setPreview(points: readonly SheetPoint[] | null, stroke?: Stroke): void {
    if (this.previewStroke) this.strokes = this.strokes.filter((s) => s !== this.previewStroke);
    this.previewStroke = null;
    if (!points || points.length < 2 || !stroke) {
      this.previewG.replaceChildren();
      return;
    }
    const s = this.makeStroke(points, stroke);
    this.previewStroke = s;
    this.strokes.push(s);
    this.previewG.replaceChildren(s.el);
  }

  /** Linea di costruzione di misura/calibrazione: colore `measure`, 1.5 px fissi. */
  setGuide(points: readonly SheetPoint[] | null): void {
    if (!points || points.length < 2) {
      this.guide.setAttribute('display', 'none');
      return;
    }
    this.guide.setAttribute('d', pathData(points));
    this.guide.removeAttribute('display');
  }

  // ---- Elementi a dimensione fissa ----
  setMarkers(list: readonly Marker[]): void {
    this.markers = list.map((m) => {
      const g = svgEl('g', { class: 'pt-mark' });
      g.innerHTML = `<line x1="-7" x2="7" y1="0" y2="0"/><line x1="0" x2="0" y1="-7" y2="7"/><circle r="3.5"/>${m.label ? `<text x="9" y="-6">${m.label}</text>` : ''}`;
      return { g, p: m.p };
    });
    this.markersG.replaceChildren(...this.markers.map((m) => m.g));
    this.placeScreenItems();
  }

  setAim(p: SheetPoint | null): void {
    this.aim = p;
    this.aimG.setAttribute('display', p ? 'inline' : 'none');
    this.placeScreenItems();
  }

  setBadge(b: Badge | null): void {
    this.badge = b;
    if (!b) {
      this.badgeEl.hidden = true;
      return;
    }
    this.badgeEl.replaceChildren(...b.lines.map((l) => h('div', null, l)));
    this.badgeEl.hidden = false;
    this.placeScreenItems();
  }

  private placeScreenItems(): void {
    for (const m of this.markers) m.g.setAttribute('transform', `translate(${this.tx + m.p.x * this.zoom} ${this.ty + m.p.y * this.zoom})`);
    if (this.aim) this.aimG.setAttribute('transform', `translate(${this.tx + this.aim.x * this.zoom} ${this.ty + this.aim.y * this.zoom})`);
    if (this.badge && !this.badgeEl.hidden) {
      const sx = this.tx + this.badge.at.x * this.zoom;
      const sy = this.ty + this.badge.at.y * this.zoom;
      const w = this.badgeEl.offsetWidth;
      const hgt = this.badgeEl.offsetHeight;
      const boxW = this.el.clientWidth;
      const x = Math.min(Math.max(sx - w / 2, 4), Math.max(4, boxW - w - 4));
      const y = sy - hgt - 12 < 4 ? sy + 14 : sy - hgt - 12;
      this.badgeEl.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}
