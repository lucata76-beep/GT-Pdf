// Livello di disegno sopra il foglio: oggetti, anteprima, segni dei punti, mira, badge di misura.
// Tutto in coordinate del foglio (pt fisici, origine in alto a sinistra): gli oggetti stanno in un gruppo SVG con
// transform translate+scale(zoom), quindi spessori, pattern di tratteggio e corpo dei testi sono in pt come nell'esportazione.
// Segni, mira e badge hanno dimensione fissa sullo schermo e vengono riposizionati a ogni cambio di vista.
import { type SheetArc, svgArcPath } from '../geometry/arc';
import { type SheetCover, coverShapeOf } from '../geometry/cover';
import { gridIndexRange, gridVisible } from '../geometry/grid';
import type { Layout, Shape } from '../geometry/layout';
import type { SheetPoint } from '../geometry/page';
import { SNAP_KINDS, SNAP_LABEL, type SnapKind } from '../geometry/snap';
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

/** Marcatore di snap: mezzo lato in px CSS (8 x 8 px di DESIGN.md) e larghezza stimata di un carattere dell'etichetta (11 px, spaziatura fissa). */
const SNAP_HALF = 4;
const SNAP_CHAR_PX = 6.6;

/** Simbolo dell'origine: lunghezza degli assi e punta (px CSS, fissi). */
export const ORIGIN_ARM_PX = 32;
const ORIGIN_HEAD_PX = 5;

/**
 * Il simbolo dell'origine nelle coordinate dello schermo, con l'origine in (0, 0): asse X verso destra, asse Y verso l'ALTO (y negative), punte aperte, un
 * cerchietto sull'origine e le etichette "X" e "Y". Ogni tratto e' disegnato due volte: sotto un alone bianco largo (leggibile su una scansione scura), sopra il
 * tratto colorato. Colori e spessori da CSS (`.origin-mark`): vedi app.css.
 */
function originSymbolMarkup(): string {
  const L = ORIGIN_ARM_PX;
  const a = ORIGIN_HEAD_PX;
  const strokes = `<path d="M0 0H${L}M${L - a} ${-a}L${L} 0L${L - a} ${a}"/><path d="M0 0V${-L}M${-a} ${-L + a}L0 ${-L}L${a} ${-L + a}"/><circle cx="0" cy="0" r="3"/>`;
  return `<g class="origin-halo">${strokes}</g><g class="origin-ink">${strokes}</g><text class="origin-label" x="${L + 5}" y="4">X</text><text class="origin-label" x="-3.5" y="${-L - 6}">Y</text>`;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Un marcatore fatto di piu' elementi (cerchio con croce, cerchio con tangente). */
function snapGroup(...els: SVGElement[]): SVGGElement {
  const g = svgEl('g');
  g.append(...els);
  return g;
}

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
  for (const a of shape.arcs ?? []) els.push(svgEl('path', { d: svgArcPath(a), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); // cerchi e archi: solo la linea, mai il disco
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
  /** Anteprima di una trasformazione (CP6e): gli oggetti come diventerebbero, semitrasparenti e con le coperture solo in contorno. Solo a schermo, mai esportata. */
  private readonly ghostG = svgEl('g', { class: 'sc-ghost' });
  private ghostStrokes: StrokeEl[] = [];
  /** Elementi che il trascinamento di piu' oggetti sta spostando (cercati una volta per gesto, non a ogni movimento) e gli id per cui sono stati cercati. */
  private dragEls: Element[] | null = null;
  private dragKey = '';
  private readonly hlG = svgEl('g', { class: 'sc-hl' });
  private readonly previewG = svgEl('g', { class: 'sc-preview' });
  private readonly guide = svgEl('path', { class: 'sc-guide', fill: 'none' });
  private readonly markersG = svgEl('g', { class: 'sc-markers' });
  /** Griglia (CP6a): linee sottili di 1 px CSS, sotto gli oggetti e sopra il PDF, nelle coordinate dello schermo; si ridisegna a ogni cambio di vista (solo le linee visibili). */
  private readonly gridEl = svgEl('path', { class: 'sc-grid', fill: 'none', display: 'none' });
  private grid: { stepPt: number; w: number; h: number; origin: SheetPoint | null } | null = null;
  /**
   * Simbolo dell'origine di pagina (CP6d, decisione 58): due assi con le etichette X e Y, SOLO a schermo (mai esportato: l'esportazione parte dal modello, non da
   * questo livello), di dimensione fissa in px CSS, sopra gli oggetti e sotto mira e snap. Il livello non riceve il puntatore (`pointer-events: none`).
   */
  private readonly originG = svgEl('g', { class: 'origin-mark', display: 'none' });
  private origin: SheetPoint | null = null;
  private readonly aimG = svgEl('g', { class: 'aim-mark', display: 'none' });
  /**
   * Marcatore di snap (DESIGN.md "Snap": 8x8 px, tratto 1.5 px) con il nome: solo a schermo, mai esportato. Colore `snap-topology` per i punti che stanno negli oggetti
   * (quadrato = Estremo, triangolo = Punto medio, cerchio = Centro) e per l'Origine (CP6f: cerchio con una croce dentro) e per il Quadrante (CP6f: rombo, scelta dell'assistente);
   * colore `snap-vector` (CP6f) per i punti calcolati: croce a X = Intersezione, angolo retto (due tratti a L) = Perpendicolare, cerchio con un tratto tangente = Tangente.
   */
  private readonly snapG = svgEl('g', { class: 'snap-mark', display: 'none' });
  private readonly snapShape: Record<SnapKind, SVGElement> = {
    end: svgEl('rect', { x: -SNAP_HALF, y: -SNAP_HALF, width: 2 * SNAP_HALF, height: 2 * SNAP_HALF }),
    mid: svgEl('polygon', { points: `0,${-SNAP_HALF} ${SNAP_HALF},${SNAP_HALF} ${-SNAP_HALF},${SNAP_HALF}` }),
    center: svgEl('circle', { cx: 0, cy: 0, r: SNAP_HALF }),
    origin: snapGroup(svgEl('circle', { cx: 0, cy: 0, r: SNAP_HALF }), svgEl('path', { d: `M${-SNAP_HALF / 2} 0H${SNAP_HALF / 2}M0 ${-SNAP_HALF / 2}V${SNAP_HALF / 2}` })),
    intersection: svgEl('path', { d: `M${-SNAP_HALF} ${-SNAP_HALF}L${SNAP_HALF} ${SNAP_HALF}M${-SNAP_HALF} ${SNAP_HALF}L${SNAP_HALF} ${-SNAP_HALF}` }),
    quadrant: svgEl('polygon', { points: `0,${-SNAP_HALF} ${SNAP_HALF},0 0,${SNAP_HALF} ${-SNAP_HALF},0` }),
    perpendicular: svgEl('path', { d: `M${-SNAP_HALF} ${-SNAP_HALF}V${SNAP_HALF}H${SNAP_HALF}` }),
    tangent: snapGroup(svgEl('circle', { cx: 0, cy: -1, r: 3 }), svgEl('path', { d: `M${-SNAP_HALF} 2H${SNAP_HALF}` })),
  };
  private readonly snapLabel = svgEl('text', { x: SNAP_HALF + 5, y: -SNAP_HALF - 2 });
  private readonly badgeEl = h('div', { class: 'measure-badge', hidden: true });
  private strokes: StrokeEl[] = [];
  private draftStrokes: StrokeEl[] = [];
  private previewStroke: StrokeEl | null = null;
  private markers: { g: SVGGElement; p: SheetPoint }[] = [];
  private aim: SheetPoint | null = null;
  private snap: { p: SheetPoint; kind: SnapKind } | null = null;
  private badge: Badge | null = null;
  private tx = 0;
  private ty = 0;
  private zoom = 1;

  constructor() {
    this.aimG.innerHTML = '<line x1="-10" x2="10" y1="0" y2="0"/><line x1="0" x2="0" y1="-10" y2="10"/>';
    this.guide.setAttribute('display', 'none');
    this.sheetG.append(this.coversG, this.coverDraftG, this.objectsG, this.draftG, this.selG, this.ghostG, this.outlineG, this.hlG, this.previewG, this.guide);
    const svg = svgEl('svg', { class: 'viewer-overlay', 'aria-hidden': 'true' });
    this.snapG.append(this.snapLabel);
    this.originG.innerHTML = originSymbolMarkup();
    svg.append(this.gridEl, this.sheetG, this.originG, this.markersG, this.aimG, this.snapG);
    this.el = h('div', { class: 'viewer-layer' }, svg, this.badgeEl);
  }

  // ---- Vista ----
  setView(tx: number, ty: number, zoom: number): void {
    const zoomChanged = zoom !== this.zoom;
    this.tx = tx;
    this.ty = ty;
    this.zoom = zoom;
    this.sheetG.setAttribute('transform', `translate(${tx} ${ty}) scale(${zoom})`);
    if (zoomChanged) for (const s of [...this.strokes, ...this.draftStrokes, ...this.ghostStrokes]) this.applyWidth(s);
    this.placeScreenItems();
    this.drawGrid();
  }

  private applyWidth(s: StrokeEl): void {
    s.el.setAttribute('stroke-width', String(Math.max(s.widthPt, MIN_SCREEN_STROKE_PX / this.zoom)));
  }

  private makeStroke(points: readonly SheetPoint[], stroke: Stroke): StrokeEl & { el: SVGPathElement } {
    return this.makeStrokeD(pathData(points), stroke);
  }

  /** Tracciato con tratto, tipo di linea e spessore da `d` (spezzata o arco: lo stesso codice, cosi' tratteggio e spessore sono quelli dell'esportazione). */
  private makeStrokeD(d: string, stroke: Stroke): StrokeEl & { el: SVGPathElement } {
    const el = svgEl('path', {
      d,
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
  /** Gli elementi SVG di una scena: coperture (sotto) e resto (sopra), con i tratti da ridimensionare registrati in `track`. `ghost`: coperture solo in contorno. */
  private itemEls(items: readonly DrawItem[], track: StrokeEl[], ghost: boolean): { covers: SVGElement[]; els: SVGElement[] } {
    const els: SVGElement[] = [];
    const covers: SVGElement[] = [];
    for (const it of items) {
      if (it.kind === 'cover') {
        const el = coverEl(it.cover);
        if (ghost) {
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', 'currentColor');
          el.setAttribute('stroke-width', '1.5');
          el.setAttribute('vector-effect', 'non-scaling-stroke');
        }
        el.dataset.id = String(it.id);
        covers.push(el);
      } else if (it.kind === 'line' || it.kind === 'curve') {
        const s = it.kind === 'line' ? this.makeStroke(it.points, it.stroke) : this.makeStrokeD(svgArcPath(it.arc), it.stroke);
        s.el.dataset.id = String(it.id);
        track.push(s);
        els.push(s.el);
      } else {
        const g = this.layoutGroup(it.layout, track);
        g.dataset.id = String(it.id);
        els.push(g);
      }
    }
    return { covers, els };
  }

  setObjects(items: readonly DrawItem[]): void {
    this.strokes = this.previewStroke ? [this.previewStroke] : [];
    const { covers, els } = this.itemEls(items, this.strokes, false);
    this.coversG.replaceChildren(...covers);
    this.objectsG.replaceChildren(...els);
  }

  /**
   * Anteprima di una trasformazione (CP6e): gli oggetti come sarebbero dopo, nello stesso disegno degli oggetti veri ma semitrasparenti, sopra la scena. Vuoto = nessuna
   * anteprima. Solo a schermo: non fa parte della scena che si esporta.
   */
  setGhost(items: readonly DrawItem[]): void {
    this.ghostStrokes = [];
    if (items.length === 0) {
      this.ghostG.replaceChildren();
      return;
    }
    const { covers, els } = this.itemEls(items, this.ghostStrokes, true);
    this.ghostG.replaceChildren(...covers, ...els);
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

  /**
   * Durante il trascinamento: sposta (dx, dy pt del foglio) l'oggetto `id`, o tutti gli oggetti di un elenco (selezione multipla, CP6e), e la loro evidenziazione, senza
   * ridisegnare. Gli elementi si cercano una volta sola per gesto (con 1.000 oggetti una ricerca a ogni movimento del mouse sarebbe quadratica). Null = rimette a posto.
   */
  setDragOffset(ids: number | readonly number[] | null, dx: number, dy: number): void {
    const list = ids === null ? null : typeof ids === 'number' ? [ids] : ids;
    const tr = list === null ? null : `translate(${dx} ${dy})`;
    const apply = (el: Element | null): void => {
      if (!el) return;
      if (tr) el.setAttribute('transform', tr);
      else el.removeAttribute('transform');
    };
    apply(this.selG);
    if (list === null) {
      for (const el of this.dragEls ?? []) el.removeAttribute('transform');
      this.dragEls = null;
      this.dragKey = '';
      return;
    }
    const key = list.join(',');
    if (this.dragEls === null || key !== this.dragKey) {
      for (const el of this.dragEls ?? []) el.removeAttribute('transform');
      const want = new Set(list.map(String));
      const found: Element[] = [];
      for (const g of [this.coversG, this.objectsG]) for (const el of Array.from(g.children)) if (want.has((el as SVGElement).dataset.id ?? '')) found.push(el);
      this.dragEls = found;
      this.dragKey = key;
    }
    for (const el of this.dragEls) apply(el);
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

  /** Linea, cerchio o arco in costruzione (spezzata di punti o `SheetArc`), con le proprieta' che avra' una volta finita. Solo a schermo: mai esportata. */
  setPreview(shape: readonly SheetPoint[] | SheetArc | null, stroke?: Stroke): void {
    if (this.previewStroke) this.strokes = this.strokes.filter((s) => s !== this.previewStroke);
    this.previewStroke = null;
    if (!shape || !stroke || (Array.isArray(shape) && shape.length < 2)) {
      this.previewG.replaceChildren();
      return;
    }
    const s = Array.isArray(shape) ? this.makeStroke(shape as readonly SheetPoint[], stroke) : this.makeStrokeD(svgArcPath(shape as SheetArc), stroke);
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

  /**
   * Griglia: passo in pt del foglio e dimensioni della pagina mostrata (l'origine e' l'angolo in basso a sinistra); null la toglie. Si disegna solo se il passo a
   * schermo e' almeno `GRID_MIN_SCREEN_PX`.
   */
  setGrid(g: { stepPt: number; w: number; h: number; origin?: SheetPoint | null } | null): void {
    this.grid = g ? { stepPt: g.stepPt, w: g.w, h: g.h, origin: g.origin ?? null } : null;
    this.drawGrid();
  }

  /** Il simbolo dell'origine di pagina sul foglio (pt fisici); null lo toglie. */
  setOrigin(p: SheetPoint | null): void {
    this.origin = p;
    this.originG.setAttribute('display', p ? 'inline' : 'none');
    this.placeScreenItems();
  }

  private drawGrid(): void {
    const g = this.grid;
    if (!g || !gridVisible(g.stepPt, this.zoom)) {
      this.gridEl.setAttribute('display', 'none');
      return;
    }
    const stepPx = g.stepPt * this.zoom;
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    const top = this.ty;
    const bottom = this.ty + g.h * this.zoom;
    const left = this.tx;
    const right = this.tx + g.w * this.zoom;
    // Nodi: x = ox + i * passo e y = oy - j * passo. Senza origine di pagina (ox = 0, oy = H) `left0` e `base` sono `tx` e `bottom`, e le espressioni sono quelle di V2a.
    const r = gridIndexRange(g.stepPt, { width: g.w, height: g.h }, g.origin);
    const left0 = this.tx + r.ox * this.zoom;
    const base = this.ty + r.oy * this.zoom;
    // solo le linee dentro il riquadro visibile (con un margine di una linea)
    const i0 = Math.max(r.iMin, Math.floor((0 - left0) / stepPx));
    const i1 = Math.min(r.iMax, Math.ceil((vw - left0) / stepPx));
    const yTop = Math.max(top, 0);
    const yBottom = Math.min(bottom, vh);
    const parts: string[] = [];
    if (yBottom > yTop) for (let i = i0; i <= i1; i++) parts.push(`M${left0 + i * stepPx} ${yTop}V${yBottom}`);
    // linea j: y = ty + (oy - j * passo) * zoom
    const xL = Math.max(left, 0);
    const xR = Math.min(right, vw);
    const j0 = Math.max(r.jMin, Math.floor((base - vh) / stepPx));
    const j1 = Math.min(r.jMax, Math.ceil((base - 0) / stepPx));
    if (xR > xL) for (let j = j0; j <= j1; j++) {
      const y = base - j * stepPx;
      if (y >= top - 0.5 && y <= vh + 0.5) parts.push(`M${xL} ${y}H${xR}`);
    }
    this.gridEl.setAttribute('d', parts.join(''));
    this.gridEl.removeAttribute('display');
  }

  /** Marcatore di snap sul punto effettivo (foglio) con il tipo; null lo toglie. */
  setSnap(p: SheetPoint | null, kind: SnapKind | null): void {
    this.snap = p && kind ? { p, kind } : null;
    if (!this.snap) {
      this.snapG.setAttribute('display', 'none');
      delete this.snapG.dataset.kind;
      return;
    }
    this.snapG.dataset.kind = this.snap.kind;
    this.snapG.insertBefore(this.snapShape[this.snap.kind], this.snapLabel);
    for (const k of SNAP_KINDS) if (k !== this.snap.kind) this.snapShape[k].remove();
    this.snapLabel.textContent = SNAP_LABEL[this.snap.kind];
    this.snapG.setAttribute('display', 'inline');
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
    if (this.origin) this.originG.setAttribute('transform', `translate(${this.tx + this.origin.x * this.zoom} ${this.ty + this.origin.y * this.zoom})`);
    if (this.aim) this.aimG.setAttribute('transform', `translate(${this.tx + this.aim.x * this.zoom} ${this.ty + this.aim.y * this.zoom})`);
    if (this.snap) {
      const sx = this.tx + this.snap.p.x * this.zoom;
      const sy = this.ty + this.snap.p.y * this.zoom;
      this.snapG.setAttribute('transform', `translate(${sx} ${sy})`);
      // l'etichetta sta a destra del marcatore; vicino al bordo destro del visore passa a sinistra (11 px di corpo: circa 6.6 px per carattere, a spaziatura fissa)
      const w = SNAP_LABEL[this.snap.kind].length * SNAP_CHAR_PX;
      const flip = sx + SNAP_HALF + 5 + w > this.el.clientWidth - 4 && sx - SNAP_HALF - 5 - w > 4;
      this.snapLabel.setAttribute('x', String(flip ? -SNAP_HALF - 5 : SNAP_HALF + 5));
      this.snapLabel.setAttribute('text-anchor', flip ? 'end' : 'start');
    }
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
