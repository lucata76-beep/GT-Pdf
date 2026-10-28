// Livello di disegno sopra il foglio: oggetti, anteprima, segni dei punti, mira, badge di misura.
// Tutto in coordinate del foglio (pt fisici, origine in alto a sinistra): gli oggetti stanno in un gruppo SVG con
// transform translate+scale(zoom), quindi spessori, pattern di tratteggio e corpo dei testi sono in pt come nell'esportazione.
// Segni, mira e badge hanno dimensione fissa sullo schermo e vengono riposizionati a ogni cambio di vista.
import { type SheetCover, coverShapeOf } from '../geometry/cover';
import type { Layout, Shape } from '../geometry/layout';
import type { SheetPoint } from '../geometry/page';
import { DRAWING_FONT, type DrawItem } from '../model/scene';
import { STROKE_CAP, STROKE_JOIN, STROKE_MITER_LIMIT, type Stroke, dashPattern } from '../model/stroke';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Spessore minimo visibile sullo schermo (pixel CSS): una linea di 0.25 pt a zoom ridotto non deve sparire. */
export const MIN_SCREEN_STROKE_PX = 1;

export type { DrawItem };
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
  el: SVGElement;
  widthPt: number;
}

export { DRAWING_FONT };

/** Riempimento delle coperture: bianco pieno, senza bordo. */
const COVER_FILL = '#ffffff';

function coverEl(c: SheetCover): SVGElement {
  return c.kind === 'rect'
    ? svgEl('rect', { x: c.rect.x, y: c.rect.y, width: c.rect.w, height: c.rect.h, fill: COVER_FILL, stroke: 'none' })
    : svgEl('circle', { cx: c.circle.c.x, cy: c.circle.c.y, r: c.circle.r, fill: COVER_FILL, stroke: 'none' });
}

/** Elementi SVG di una forma: spezzate come tracciati, rettangoli e cerchi pieni. Lo stile lo decide il gruppo che li contiene (CSS). */
function shapeEls(shape: Shape): SVGElement[] {
  const els: SVGElement[] = shape.lines.map((pts) => svgEl('path', { d: pathData(pts), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  for (const r of shape.rects) els.push(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, 'stroke-linejoin': 'round' }));
  for (const c of shape.circles) els.push(svgEl('circle', { cx: c.c.x, cy: c.c.y, r: c.r }));
  return els;
}

export class SceneOverlay {
  readonly el: HTMLDivElement;
  private readonly sheetG = svgEl('g');
  /** Coperture: sotto linee, quote e testi, qualunque sia l'ordine di creazione. */
  private readonly coversG = svgEl('g', { class: 'sc-covers' });
  /** Copertura in costruzione: stesso strato delle altre coperture, appena sopra. */
  private readonly coverDraftG = svgEl('g', { class: 'sc-cover-draft' });
  private readonly objectsG = svgEl('g', { class: 'sc-objects' });
  private readonly draftG = svgEl('g', { class: 'sc-draft' });
  /** Oggetto selezionato e contorno sottile della copertura in costruzione (non fanno parte del disegno esportato). */
  private readonly selG = svgEl('g', { class: 'sc-sel' });
  private readonly outlineG = svgEl('g', { class: 'sc-outline' });
  private readonly hlG = svgEl('g', { class: 'sc-hl' });
  private readonly previewG = svgEl('g', { class: 'sc-preview' });
  private readonly guide = svgEl('path', { class: 'sc-guide', fill: 'none' });
  private readonly markersG = svgEl('g', { class: 'sc-markers' });
  private readonly aimG = svgEl('g', { class: 'aim-mark', display: 'none' });
  private readonly badgeEl = h('div', { class: 'measure-badge', hidden: true });
  private strokes: StrokeEl[] = [];
  private draftStrokes: StrokeEl[] = [];
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
    this.sheetG.append(this.coversG, this.coverDraftG, this.objectsG, this.draftG, this.selG, this.outlineG, this.hlG, this.previewG, this.guide);
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
    if (zoomChanged) for (const s of [...this.strokes, ...this.draftStrokes]) this.applyWidth(s);
    this.placeScreenItems();
  }

  private applyWidth(s: StrokeEl): void {
    s.el.setAttribute('stroke-width', String(Math.max(s.widthPt, MIN_SCREEN_STROKE_PX / this.zoom)));
  }

  private makeStroke(points: readonly SheetPoint[], stroke: Stroke): StrokeEl & { el: SVGPathElement } {
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
    const els: SVGElement[] = [];
    const covers: SVGElement[] = [];
    for (const it of items) {
      if (it.kind === 'cover') {
        const el = coverEl(it.cover);
        el.dataset.id = String(it.id);
        covers.push(el);
      } else if (it.kind === 'line') {
        const s = this.makeStroke(it.points, it.stroke);
        s.el.dataset.id = String(it.id);
        this.strokes.push(s);
        els.push(s.el);
      } else {
        const g = this.layoutGroup(it.layout, this.strokes);
        g.dataset.id = String(it.id);
        els.push(g);
      }
    }
    this.coversG.replaceChildren(...covers);
    this.objectsG.replaceChildren(...els);
  }

  /** Copertura in costruzione: riempimento bianco nello strato delle coperture (sotto gli oggetti) e contorno sottile sopra. */
  setCoverDraft(c: SheetCover | null): void {
    this.coverDraftG.replaceChildren(...(c ? [coverEl(c)] : []));
    this.outlineG.replaceChildren(...(c ? shapeEls(coverShapeOf(c)) : []));
  }

  /** Oggetto selezionato: alone sulle linee, cornice sottile su rettangoli e cerchi. */
  setSelection(shape: Shape | null): void {
    this.selG.removeAttribute('transform');
    this.selG.replaceChildren(...(shape ? shapeEls(shape) : []));
  }

  /** Durante il trascinamento: sposta (dx, dy pt del foglio) l'oggetto `id` e la sua evidenziazione, senza ridisegnare. Null = rimette a posto. */
  setDragOffset(id: number | null, dx: number, dy: number): void {
    const tr = id === null ? null : `translate(${dx} ${dy})`;
    const apply = (el: Element | null): void => {
      if (!el) return;
      if (tr) el.setAttribute('transform', tr);
      else el.removeAttribute('transform');
    };
    apply(this.selG);
    for (const g of [this.coversG, this.objectsG]) {
      for (const el of g.querySelectorAll('[transform]')) el.removeAttribute('transform');
      if (id !== null) apply(g.querySelector(`[data-id="${id}"]`));
    }
  }

  /** Testo o quota in corso di scrittura (bozza): stesso disegno degli oggetti, non ancora nel documento. */
  setDraft(layout: Layout | null): void {
    this.draftStrokes = [];
    this.draftG.replaceChildren(...(layout ? [this.layoutGroup(layout, this.draftStrokes)] : []));
  }

  /** Primitive di un testo o di una quota: linee, frecce piene, badge (fondo bianco, bordo sottile) e testi. */
  private layoutGroup(l: Layout, track: StrokeEl[]): SVGGElement {
    const g = svgEl('g', { class: 'sc-ann' });
    const widthed = (el: SVGElement, widthPt: number): void => {
      const s: StrokeEl = { el, widthPt };
      this.applyWidth(s);
      track.push(s);
    };
    for (const ln of l.lines) {
      const el = svgEl('path', { d: pathData(ln.pts), fill: 'none', stroke: ln.color, 'stroke-linecap': STROKE_CAP, 'stroke-linejoin': STROKE_JOIN });
      widthed(el, ln.widthPt);
      g.append(el);
    }
    for (const a of l.arrows) g.append(svgEl('polygon', { points: a.pts.map((p) => `${p.x},${p.y}`).join(' '), fill: a.color, stroke: 'none' }));
    for (const b of l.boxes) {
      const el = svgEl('rect', { x: b.rect.x, y: b.rect.y, width: b.rect.w, height: b.rect.h, fill: '#ffffff', stroke: b.color });
      widthed(el, b.borderPt);
      g.append(el);
    }
    for (const t of l.texts) {
      const el = svgEl('text', { x: t.x, y: t.y, 'font-size': t.sizePt, fill: t.color, class: 'sc-text' });
      el.style.fontFamily = DRAWING_FONT;
      el.textContent = t.text;
      g.append(el);
    }
    return g;
  }

  /** Evidenzia un oggetto (es. quello che si sta per cancellare). */
  setHighlight(shape: Shape | null): void {
    this.hlG.replaceChildren(...(shape ? shapeEls(shape) : []));
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
