// Vista del documento: pagina PDF.js su canvas, pan con un dito, pinch con due, rotella su desktop.
// Pointer Events + touch-action: none. Il canvas non supera mai SCREEN_PIXEL_BUDGET: oltre, il rendering sfoca.
// Modo 'pick': un dito (o il mouse) punta con la lente, il punto si inserisce al rilascio; due dita = pinch/pan.
// Modo 'erase': un tocco fermo sceglie l'oggetto da cancellare; trascinando si sposta la vista.
// Modo 'select': un tocco fermo sceglie l'oggetto da selezionare; trascinare l'oggetto selezionato lo sposta, trascinare
// altrove sposta la vista. Durante il trascinamento l'oggetto segue il dito (solo a schermo); alla fine l'app crea UN comando.
// Coordinate: gli oggetti sono nello spazio utente PDF; per lo schermo si passa da PageGeometry (src/geometry/page.ts),
// che gestisce Rotate, CropBox e UserUnit come il viewport a scala 1 di PDF.js (confronto nei test).
import type { SheetCover } from '../geometry/cover';
import type { Layout, Shape } from '../geometry/layout';
import { PageGeometry, type SheetPoint, type UserPoint } from '../geometry/page';
import { SCREEN_PIXEL_BUDGET, fitRenderSize } from '../geometry/pixels';
import type { Stroke } from '../model/stroke';
import type { PDFPageProxy, RenderTask } from '../pdf/loader';
import { h } from './dom';
import { Lens } from './lens';
import { PointerLog } from './pointerLog';
import { type Badge, type DrawItem, SceneOverlay } from './overlay';

export type { SheetPoint, UserPoint };

export interface ViewerStats {
  /** Pixel CSS per pt PDF (zoom a schermo). */
  zoom: number;
  zoomOfFit: number;
  dpr: number;
  render: { w: number; h: number; scale: number; clamped: boolean; ms: number } | null;
  pointers: number;
  /** Id dei puntatori nella mappa in questo momento (con le dita sollevate deve essere vuota). */
  pointerIds: number[];
  /** Ultimi eventi puntatore (down, up, cancel, lostcapture...), i piu' vecchi per primi. */
  pointerLog: readonly string[];
  maxPointers: number;
  gestureEvents: number;
  pageZoom: number | null; // window.visualViewport.scale: deve restare 1 durante il pinch
  error: string | null;
}

export type ViewerMode = 'pan' | 'pick' | 'erase' | 'select';

export interface ViewerHooks {
  /** Posizione del cursore sul foglio (pt fisici, origine in alto a sinistra); null quando esce dal foglio. */
  onCursor?: (p: SheetPoint | null) => void;
  /** Modo 'pick': porta il punto grezzo sul punto effettivo (es. vincolo ortogonale). Vale per mira, anteprima e inserimento. */
  constrain?: (raw: SheetPoint) => SheetPoint;
  /** Modo 'pick': il punto che verrebbe inserito adesso (gia' vincolato), durante la mira o il passaggio del mouse; null alla fine. */
  onAim?: (effective: SheetPoint | null) => void;
  /** Modo 'pick': punto inserito (rilascio dopo la mira), gia' vincolato. */
  onPlace?: (user: UserPoint, sheet: SheetPoint) => void;
  /** Modo 'erase': tocco o clic fermo. `tolPt` = tolleranza in pt del foglio (pixel di schermo / zoom). */
  onErase?: (sheet: SheetPoint, tolPt: number) => void;
  /** Modo 'erase': posizione di dito o mouse per evidenziare l'oggetto che verrebbe cancellato; null quando finisce. */
  onErasePreview?: (sheet: SheetPoint | null, tolPt: number) => void;
  /** Modo 'select': tocco o clic fermo, anche fuori dalla pagina. `tolPt` = tolleranza in pt del foglio (pixel di schermo / zoom). */
  onSelect?: (sheet: SheetPoint, tolPt: number) => void;
  /** Modo 'select': il punto premuto e' sull'oggetto selezionato (entro la tolleranza)? Se si', trascinare lo sposta. */
  canGrab?: (sheet: SheetPoint, tolPt: number) => boolean;
  /** Modo 'select': trascinamento dell'oggetto selezionato, spostamento dall'inizio in pt del foglio. */
  onDragMove?: (dx: number, dy: number) => void;
  onDragEnd?: (dx: number, dy: number) => void;
  /** Trascinamento interrotto (secondo dito, annullamento del sistema, cambio di modo): l'oggetto torna dov'era. */
  onDragCancel?: () => void;
  /** Mira rilasciata fuori dalla pagina. */
  onReject?: (reason: string) => void;
  /** Zoom o fit cambiati (pixel CSS per pt). */
  onView?: (v: { zoom: number; fit: number }) => void;
}

/** Tolleranza di scelta dell'oggetto da cancellare o selezionare, in pixel CSS: piu' larga col dito (bersaglio >= 44 pt). */
const HIT_TOL_PX = { touch: 22, mouse: 10 } as const;
/** Movimento oltre il quale un tocco in modo 'erase' o 'select' diventa trascinamento. */
const TAP_SLOP_PX = 8;

type Pt = { x: number; y: number };

const MAX_ZOOM = 24; // px CSS per pt

const isCancel = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'RenderingCancelledException';
const release = (c: HTMLCanvasElement): void => {
  c.width = 1;
  c.height = 1;
};

export class PdfViewer {
  readonly el: HTMLDivElement;
  readonly hooks: ViewerHooks = {};
  private readonly stage: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly overlay = new SceneOverlay();
  private readonly lens = new Lens();
  private canvas: HTMLCanvasElement | null = null;

  private page: PDFPageProxy | null = null;
  private geom: PageGeometry | null = null;
  private pageW = 0;
  private pageH = 0;
  mode: ViewerMode = 'pan';

  private zoom = 1; // px CSS per pt
  private fitZoom = 1;
  private atFit = false;
  private tx = 0;
  private ty = 0;
  private renderZoom = 1; // px CSS per pt del canvas attualmente mostrato

  private readonly pointers = new Map<number, Pt>();
  private readonly ptrLog = new PointerLog();
  private maxPointers = 0;
  private gestureEvents = 0;
  private pinch: { dist: number; zoom: number; midX: number; midY: number; tx: number; ty: number } | null = null;
  /** Mira in corso (modo 'pick', primo puntatore). */
  private aim: { id: number; pos: Pt; touch: boolean } | null = null;
  /** Tocco in corso in modo 'erase': diventa trascinamento se il dito si muove oltre TAP_SLOP_PX. */
  private tap: { id: number; start: Pt; moved: boolean; touch: boolean } | null = null;
  /** Tocco in corso in modo 'select': `grab` = e' partito sull'oggetto selezionato, quindi trascinare lo sposta. */
  private sel: { id: number; start: Pt; moved: boolean; grab: boolean; touch: boolean } | null = null;
  /** Ultima posizione del mouse senza tasti (per rifare l'anteprima). */
  private lastHover: Pt | null = null;

  private renderTimer = 0;
  private renderToken = 0;
  private task: RenderTask | null = null;
  private lastRender: ViewerStats['render'] = null;
  private lastError: string | null = null;
  private statsQueued = false;
  private logNext = false;

  constructor(
    private readonly onStats: (s: ViewerStats) => void,
    private readonly onLog: (msg: string, level?: 'info' | 'ok' | 'err') => void,
  ) {
    this.stage = h('div', { class: 'viewer-stage' });
    this.empty = h('div', { class: 'viewer-empty' }, 'Nessun documento aperto');
    this.el = h(
      'div',
      { class: 'viewer', tabindex: 0, role: 'img', 'aria-label': 'Anteprima del documento' },
      this.stage,
      this.overlay.el,
      this.lens.el,
      this.empty,
    );

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('gotpointercapture', (e) => this.logPointer('gotcapture', e));
    this.el.addEventListener('lostpointercapture', (e) => this.logPointer('lostcapture', e));
    this.el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hooks.onCursor?.(null);
      if (this.pointers.size > 0) return; // tasto premuto: la cattura del puntatore continua a seguirlo
      this.lastHover = null;
      this.overlay.setAim(null);
      this.hooks.onAim?.(null);
      this.hooks.onErasePreview?.(null, 0);
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('wheel', this.onWheel, { passive: false });
    // Eventi di gesto proprietari di Safari: li annulliamo per evitare lo zoom della pagina.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      this.el.addEventListener(type, (e) => {
        this.gestureEvents++;
        e.preventDefault();
        this.queueStats();
      });
    }
    new ResizeObserver(() => {
      if (!this.page) return;
      if (this.atFit) this.fit();
      else this.applyTransform();
    }).observe(this.el);
    window.visualViewport?.addEventListener('resize', () => this.queueStats());
  }

  get hasPage(): boolean {
    return this.page !== null;
  }

  async setPage(page: PDFPageProxy | null): Promise<void> {
    this.renderToken++;
    this.task?.cancel();
    this.cancelAim();
    this.cancelSelect();
    this.page = page;
    this.lastRender = null;
    this.lastError = null;
    this.logNext = page !== null;
    this.clearScene();
    if (!page) {
      this.geom = null;
      this.stage.replaceChildren();
      if (this.canvas) release(this.canvas);
      this.canvas = null;
      this.empty.hidden = false;
      this.queueStats();
      return;
    }
    this.empty.hidden = true;
    // view = CropBox ∩ MediaBox; /Rotate e UserUnit: la geometria e' quella del viewport a scala 1 di PDF.js.
    this.geom = new PageGeometry({ view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit });
    this.pageW = this.geom.width;
    this.pageH = this.geom.height;
    this.fit();
    await this.renderNow();
  }

  // ---- Contenuto del livello di disegno (l'app passa punti nello spazio utente PDF della pagina corrente) ----
  private sheetPts(points: readonly UserPoint[]): SheetPoint[] {
    const g = this.geom;
    return g ? points.map((p) => g.userToSheet(p)) : [];
  }
  /** Oggetti della pagina gia' nel foglio (rette e linee con le loro proprieta', testi e quote come primitive). */
  setObjects(items: readonly DrawItem[]): void {
    this.overlay.setObjects(items);
  }
  /** Evidenzia la forma (nel foglio) dell'oggetto che si sta per cancellare. */
  setHighlight(shape: Shape | null): void {
    this.overlay.setHighlight(shape);
  }
  /** Evidenzia la forma (nel foglio) dell'oggetto selezionato. */
  setSelection(shape: Shape | null): void {
    this.overlay.setSelection(shape);
  }
  /** Copertura in costruzione (nel foglio): riempimento sotto gli oggetti e contorno sottile sopra. */
  setCoverDraft(cover: SheetCover | null): void {
    this.overlay.setCoverDraft(cover);
  }
  /** Sposta a schermo (pt del foglio) l'oggetto `id` mentre lo si trascina; `null` rimette tutto a posto. */
  setDragOffset(id: number | null, dx: number, dy: number): void {
    this.overlay.setDragOffset(id, dx, dy);
  }
  /** Testo o quota in corso di scrittura. */
  setDraft(layout: Layout | null): void {
    this.overlay.setDraft(layout);
  }
  /** Linea in costruzione, disegnata con le proprieta' che avra'. */
  setPreview(points: readonly UserPoint[] | null, stroke?: Stroke): void {
    this.overlay.setPreview(points ? this.sheetPts(points) : null, stroke);
  }
  /** Linea di costruzione di misura o calibrazione (colore `measure`). */
  setGuide(points: readonly UserPoint[] | null): void {
    this.overlay.setGuide(points ? this.sheetPts(points) : null);
  }
  setMarkers(list: readonly { p: UserPoint; label?: string }[]): void {
    this.overlay.setMarkers(list.map((m) => ({ p: this.sheetPts([m.p])[0] as SheetPoint, label: m.label })));
  }
  setBadge(b: { at: UserPoint; lines: readonly string[] } | null): void {
    const g = this.geom;
    const badge: Badge | null = b && g ? { at: g.userToSheet(b.at), lines: b.lines } : null;
    this.overlay.setBadge(badge);
  }
  /** Svuota il livello di disegno (cambio pagina o documento). */
  clearScene(): void {
    this.overlay.setObjects([]);
    this.overlay.setDraft(null);
    this.overlay.setHighlight(null);
    this.overlay.setSelection(null);
    this.overlay.setCoverDraft(null);
    this.overlay.setDragOffset(null, 0, 0);
    this.overlay.setPreview(null);
    this.overlay.setGuide(null);
    this.overlay.setMarkers([]);
    this.overlay.setBadge(null);
  }

  setMode(mode: ViewerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.cancelAim();
    this.clearTap();
    this.cancelSelect();
    this.el.dataset.mode = mode;
  }

  fit(): void {
    if (!this.page) return;
    const r = this.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.fitZoom = Math.min(r.width / this.pageW, r.height / this.pageH) * 0.96;
    this.zoom = this.fitZoom;
    this.tx = (r.width - this.pageW * this.zoom) / 2;
    this.ty = (r.height - this.pageH * this.zoom) / 2;
    this.atFit = true;
    this.applyTransform();
    this.scheduleRender(0);
  }

  /**
   * Porta nella parte visibile i punti del foglio (pt) senza cambiare lo zoom, a meno che non entrino nel riquadro:
   * allora si riduce lo zoom quanto basta. Serve quando il tastierino restringe l'area di lavoro: il punto di lavoro
   * (dove si scrive o si quota) non deve restare nascosto ne' coperto.
   */
  ensureVisible(points: readonly SheetPoint[], marginPx = 28): void {
    if (!this.page || points.length === 0) return;
    const r = this.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const availW = Math.max(1, r.width - 2 * marginPx);
    const availH = Math.max(1, r.height - 2 * marginPx);
    let changed = false;
    if ((x1 - x0) * this.zoom > availW || (y1 - y0) * this.zoom > availH) {
      const z = Math.max(this.fitZoom * 0.2, Math.min(this.zoom, availW / Math.max(x1 - x0, 1e-6), availH / Math.max(y1 - y0, 1e-6)));
      this.zoom = z;
      this.tx = r.width / 2 - ((x0 + x1) / 2) * z; // centrato: l'insieme non entra comunque con margine
      this.ty = r.height / 2 - ((y0 + y1) / 2) * z;
      changed = true;
    } else {
      const left = this.tx + x0 * this.zoom;
      const right = this.tx + x1 * this.zoom;
      const top = this.ty + y0 * this.zoom;
      const bottom = this.ty + y1 * this.zoom;
      let dx = 0;
      let dy = 0;
      if (left < marginPx) dx = marginPx - left;
      else if (right > r.width - marginPx) dx = r.width - marginPx - right;
      if (top < marginPx) dy = marginPx - top;
      else if (bottom > r.height - marginPx) dy = r.height - marginPx - bottom;
      if (dx !== 0 || dy !== 0) {
        this.tx += dx;
        this.ty += dy;
        changed = true;
      }
    }
    if (!changed) return;
    this.atFit = false;
    this.applyTransform();
    this.scheduleRender();
  }

  zoomBy(factor: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(this.zoom * factor, r.width / 2, r.height / 2);
    this.scheduleRender();
  }

  /** Zoom assoluto (pixel CSS per pt), centrato sul riquadro. */
  zoomTo(zoom: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(zoom, r.width / 2, r.height / 2);
    this.scheduleRender();
  }

  private zoomAt(newZoom: number, cx: number, cy: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(this.fitZoom * 0.2, newZoom));
    const k = z / this.zoom;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.zoom = z;
    this.atFit = false;
    this.applyTransform();
  }

  // ---- Coordinate ----
  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Da posizione nel riquadro a pt reali sul foglio (origine in alto a sinistra). */
  private toSheet(p: Pt): SheetPoint {
    return { x: (p.x - this.tx) / this.zoom, y: (p.y - this.ty) / this.zoom };
  }

  private inPage(s: SheetPoint): boolean {
    return this.geom?.contains(s) ?? false;
  }

  /** Geometria della pagina mostrata (spazio utente <-> foglio); null senza documento. */
  get geometry(): PageGeometry | null {
    return this.geom;
  }

  /** Pixel CSS per pt del foglio (zoom a schermo). */
  get zoomValue(): number {
    return this.zoom;
  }

  /** Il punto effettivo per una posizione nel riquadro: grezzo + vincolo dell'app (es. ortogonale). */
  private effective(pos: Pt): SheetPoint {
    const raw = this.toSheet(pos);
    return this.hooks.constrain ? this.hooks.constrain(raw) : raw;
  }

  get sheetSize(): { w: number; h: number } {
    return { w: this.pageW, h: this.pageH };
  }

  private reportCursor(p: Pt): void {
    const s = this.toSheet(p);
    this.hooks.onCursor?.(this.inPage(s) ? s : null);
  }

  // ---- Gesti ----
  private readonly onDown = (e: PointerEvent): void => {
    if (!this.page) return;
    const mousePan = e.pointerType === 'mouse' && e.button !== 0; // tasto centrale o destro: sposta
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* puntatore gia' terminato: si prosegue senza cattura */
    }
    const pos = this.local(e);
    this.pointers.set(e.pointerId, pos);
    this.logPointer('down', e);
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
    const primary = !mousePan && this.pointers.size === 1;
    const touch = e.pointerType !== 'mouse';
    if (this.mode === 'pick' && primary) {
      this.aim = { id: e.pointerId, pos, touch };
      this.updateAim();
    } else {
      this.cancelAim(); // un secondo dito annulla la mira: si passa al pinch
    }
    if (this.mode === 'erase' && primary) {
      this.tap = { id: e.pointerId, start: pos, moved: false, touch };
      this.previewErase(pos, touch);
    } else {
      this.clearTap();
    }
    if (this.mode === 'select' && primary) {
      const grab = this.hooks.canGrab?.(this.toSheet(pos), this.hitTol(touch)) ?? false;
      this.sel = { id: e.pointerId, start: pos, moved: false, grab, touch };
    } else {
      this.cancelSelect(); // un secondo dito annulla un eventuale trascinamento: si passa al pinch
    }
    this.resetBaseline();
    this.queueStats();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!this.page) return;
    const cur = this.local(e);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        this.reportCursor(cur); // passaggio del mouse, nessun tasto
        this.hover(cur);
      }
      return;
    }
    this.pointers.set(e.pointerId, cur);
    this.reportCursor(cur);
    if (this.aim && this.aim.id === e.pointerId) {
      this.aim.pos = cur;
      this.updateAim();
      return;
    }
    const sel = this.sel;
    if (sel && sel.id === e.pointerId) {
      if (!sel.moved) {
        if (Math.hypot(cur.x - sel.start.x, cur.y - sel.start.y) < TAP_SLOP_PX) return;
        sel.moved = true;
      }
      if (sel.grab) {
        // l'oggetto segue il dito: spostamento totale dall'inizio, in pt del foglio
        this.hooks.onDragMove?.((cur.x - sel.start.x) / this.zoom, (cur.y - sel.start.y) / this.zoom);
        return;
      }
      // partito altrove: sposta la vista (codice sotto)
    }
    const tap = this.tap;
    if (tap && tap.id === e.pointerId && !tap.moved) {
      if (Math.hypot(cur.x - tap.start.x, cur.y - tap.start.y) < TAP_SLOP_PX) {
        this.previewErase(cur, tap.touch);
        return;
      }
      tap.moved = true; // trascinamento: sposta la vista
      this.hooks.onErasePreview?.(null, 0);
    }
    if (this.pointers.size === 1) {
      this.tx += cur.x - prev.x;
      this.ty += cur.y - prev.y;
      this.atFit = false;
    } else if (this.pinch) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = Math.min(MAX_ZOOM, Math.max(this.fitZoom * 0.2, (this.pinch.zoom * dist) / this.pinch.dist));
      // Il punto del foglio che era sotto le dita all'inizio resta sotto le dita.
      const px = (this.pinch.midX - this.pinch.tx) / this.pinch.zoom;
      const py = (this.pinch.midY - this.pinch.ty) / this.pinch.zoom;
      this.zoom = z;
      this.tx = mid.x - px * z;
      this.ty = mid.y - py * z;
      this.atFit = false;
    }
    this.applyTransform();
  };

  private readonly onUp = (e: PointerEvent): void => {
    const known = this.pointers.delete(e.pointerId);
    this.logPointer(e.type === 'pointerup' ? 'up' : 'cancel', e, known ? '' : 'sconosciuto');
    if (!known) return;
    const aim = this.aim;
    if (aim && aim.id === e.pointerId) {
      const pos = this.local(e);
      this.cancelAim();
      if (e.type === 'pointerup') this.place(pos);
    }
    const tap = this.tap;
    if (tap && tap.id === e.pointerId) {
      this.clearTap();
      if (e.type === 'pointerup' && !tap.moved) this.erase(this.local(e), tap.touch);
    }
    const sel = this.sel;
    if (sel && sel.id === e.pointerId) {
      this.sel = null;
      const pos = this.local(e);
      if (e.type !== 'pointerup') {
        if (sel.moved && sel.grab) this.hooks.onDragCancel?.();
      } else if (!sel.moved) this.hooks.onSelect?.(this.toSheet(pos), this.hitTol(sel.touch));
      else if (sel.grab) this.hooks.onDragEnd?.((pos.x - sel.start.x) / this.zoom, (pos.y - sel.start.y) / this.zoom);
    }
    this.resetBaseline();
    this.scheduleRender();
    this.queueStats();
  };

  /** Registra l'evento con la dimensione della mappa dopo l'evento e gli id presenti (solo per la diagnostica: non cambia nulla). */
  private logPointer(kind: string, e: PointerEvent, extra = ''): void {
    this.ptrLog.note(kind, e, this.pointers.size, [...this.pointers.keys()], extra);
    this.queueStats();
  }

  private place(pos: Pt): void {
    const geom = this.geom;
    if (!geom) return;
    const raw = this.toSheet(pos);
    const eff = this.effective(pos);
    if (!geom.contains(raw) || !geom.contains(eff)) {
      this.hooks.onReject?.('Punto fuori dalla pagina: non inserito');
      return;
    }
    this.hooks.onPlace?.(geom.sheetToUser(eff), eff);
  }

  // ---- Cancella e Seleziona: tocco fermo ----
  /** Tolleranza in pt del foglio, uguale per Cancella e Seleziona. */
  private hitTol(touch: boolean): number {
    return (touch ? HIT_TOL_PX.touch : HIT_TOL_PX.mouse) / this.zoom;
  }
  private previewErase(pos: Pt, touch: boolean): void {
    this.hooks.onErasePreview?.(this.toSheet(pos), this.hitTol(touch));
  }
  private erase(pos: Pt, touch: boolean): void {
    const s = this.toSheet(pos);
    if (this.inPage(s)) this.hooks.onErase?.(s, this.hitTol(touch));
  }
  /** Interrompe un tocco in modo 'select'; se stava trascinando l'oggetto, lo rimette dov'era. */
  private cancelSelect(): void {
    const sel = this.sel;
    this.sel = null;
    if (sel?.moved && sel.grab) this.hooks.onDragCancel?.();
  }
  private clearTap(): void {
    if (!this.tap) return;
    this.tap = null;
    this.hooks.onErasePreview?.(null, 0);
  }

  /** Rifa' mira e anteprima dopo un cambio di vincolo (es. ORTO attivato). */
  refreshAim(): void {
    if (this.aim) this.updateAim();
    else if (this.lastHover) this.hover(this.lastHover);
  }

  /** Mouse senza tasti: anteprima del punto (rubber-band) o dell'oggetto da cancellare. */
  private hover(pos: Pt): void {
    this.lastHover = pos;
    if (this.mode === 'pick') {
      const raw = this.toSheet(pos);
      const eff = this.effective(pos);
      const ok = this.inPage(raw);
      this.hooks.onAim?.(ok ? eff : null);
      // il segno di mira serve solo se il vincolo ha spostato il punto (altrimenti c'e' gia' il cursore a croce)
      this.overlay.setAim(ok && Math.hypot(eff.x - raw.x, eff.y - raw.y) * this.zoom > 1 ? eff : null);
    } else if (this.mode === 'erase') {
      this.previewErase(pos, false);
    }
  }

  private resetBaseline(): void {
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (a && b) {
        this.pinch = {
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: this.zoom,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          tx: this.tx,
          ty: this.ty,
        };
        return;
      }
    }
    this.pinch = null;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.page) return;
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(this.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
    this.scheduleRender();
  };

  // ---- Mira e lente ----
  private cancelAim(): void {
    const had = this.aim !== null;
    this.aim = null;
    this.overlay.setAim(null);
    this.lens.hide();
    if (had) this.hooks.onAim?.(null);
  }

  private updateAim(): void {
    const aim = this.aim;
    if (!aim) return;
    const raw = this.toSheet(aim.pos);
    const eff = this.effective(aim.pos);
    this.overlay.setAim(eff);
    this.hooks.onAim?.(this.inPage(raw) ? eff : null);
    if (!aim.touch || !this.canvas || !this.lastRender) return; // la lente serve al dito, non al mouse
    const box = this.el.getBoundingClientRect();
    // La lente sta vicino al dito ma mostra il punto EFFETTIVO (dopo il vincolo): e' li' che cadra' il punto.
    this.lens.show(aim.pos, { w: box.width, h: box.height }, this.canvas, {
      cx: eff.x * this.lastRender.scale,
      cy: eff.y * this.lastRender.scale,
      // pixel del canvas per pixel CSS dello schermo
      pxPerCss: this.lastRender.scale / this.zoom,
    });
  }

  // ---- Rendering ----
  private applyTransform(): void {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom / this.renderZoom})`;
    this.overlay.setView(this.tx, this.ty, this.zoom);
    this.queueStats();
  }

  private scheduleRender(delay = 180): void {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => void this.renderNow(), delay);
  }

  private async renderNow(): Promise<void> {
    const page = this.page;
    if (!page) return;
    const token = ++this.renderToken;
    this.task?.cancel();

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = fitRenderSize(this.pageW, this.pageH, this.zoom * dpr, SCREEN_PIXEL_BUDGET);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const t0 = performance.now();
    const task = page.render({ canvas, viewport: page.getViewport({ scale: size.scale }) });
    this.task = task;
    try {
      await task.promise;
    } catch (e) {
      release(canvas);
      if (isCancel(e)) return;
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.lastError = msg;
      this.onLog(`Rendering fallito (${size.w}x${size.h}): ${msg}`, 'err');
      this.queueStats();
      return;
    }
    if (token !== this.renderToken) {
      release(canvas);
      return;
    }
    const css = size.scale / dpr;
    canvas.style.width = `${this.pageW * css}px`;
    canvas.style.height = `${this.pageH * css}px`;
    const old = this.canvas;
    this.stage.replaceChildren(canvas);
    if (old) release(old); // rilascia subito la memoria del canvas precedente
    this.canvas = canvas;
    this.renderZoom = css;
    this.lastError = null;
    this.lastRender = { w: size.w, h: size.h, scale: size.scale, clamped: size.clamped, ms: performance.now() - t0 };
    if (this.logNext) {
      this.logNext = false;
      this.onLog(`Prima visualizzazione: canvas ${size.w}x${size.h} px in ${Math.round(this.lastRender.ms)} ms${size.clamped ? ' (ridotto dal tetto)' : ''}`, 'ok');
    }
    this.applyTransform();
  }

  // ---- Statistiche ----
  private queueStats(): void {
    if (this.statsQueued) return;
    this.statsQueued = true;
    requestAnimationFrame(() => {
      this.statsQueued = false;
      this.onStats({
        zoom: this.zoom,
        zoomOfFit: this.fitZoom > 0 ? this.zoom / this.fitZoom : 1,
        dpr: Math.min(window.devicePixelRatio || 1, 3),
        render: this.lastRender,
        pointers: this.pointers.size,
        pointerIds: [...this.pointers.keys()],
        pointerLog: this.ptrLog.entries,
        maxPointers: this.maxPointers,
        gestureEvents: this.gestureEvents,
        pageZoom: window.visualViewport?.scale ?? null,
        error: this.lastError,
      });
      this.hooks.onView?.({ zoom: this.zoom, fit: this.fitZoom });
    });
  }
}
