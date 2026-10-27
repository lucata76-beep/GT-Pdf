// Vista del documento: pagina PDF.js su canvas, pan con un dito, pinch con due, rotella su desktop.
// Pointer Events + touch-action: none. Il canvas non supera mai SCREEN_PIXEL_BUDGET: oltre, il rendering sfoca.
// Modo 'point': un dito (o il mouse) punta con la lente, il punto si inserisce al rilascio; due dita = pinch/pan.
// Coordinate: i punti sono nello spazio utente PDF; per lo schermo si passa dal viewport a scala 1
// (convertToViewportPoint / convertToPdfPoint gestiscono Rotate, CropBox e UserUnit).
import { SCREEN_PIXEL_BUDGET, fitRenderSize } from '../geometry/pixels';
import type { PDFPageProxy, RenderTask } from '../pdf/loader';
import { h } from './dom';
import { Lens } from './lens';

export interface ViewerStats {
  /** Pixel CSS per pt PDF (zoom a schermo). */
  zoom: number;
  zoomOfFit: number;
  dpr: number;
  render: { w: number; h: number; scale: number; clamped: boolean; ms: number } | null;
  pointers: number;
  maxPointers: number;
  gestureEvents: number;
  pageZoom: number | null; // window.visualViewport.scale: deve restare 1 durante il pinch
  error: string | null;
}

export type ViewerMode = 'pan' | 'point';

/** Punto nello spazio utente PDF della pagina corrente. */
export interface UserPoint {
  x: number;
  y: number;
}

/** Posizione sul foglio in pt reali (1/72 in), origine in alto a sinistra della pagina mostrata (Rotate applicato). */
export interface SheetPoint {
  x: number;
  y: number;
}

export interface ViewerHooks {
  /** Posizione del cursore sul foglio; null quando esce dal foglio. */
  onCursor?: (p: SheetPoint | null) => void;
  /** Punto inserito (rilascio dopo la mira). */
  onPlace?: (user: UserPoint, sheet: SheetPoint) => void;
  /** Mira rilasciata fuori dalla pagina. */
  onReject?: (reason: string) => void;
  /** Zoom o fit cambiati (pixel CSS per pt). */
  onView?: (v: { zoom: number; fit: number }) => void;
}

type Pt = { x: number; y: number };

const MAX_ZOOM = 24; // px CSS per pt
const SVG_NS = 'http://www.w3.org/2000/svg';

const isCancel = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'RenderingCancelledException';
const release = (c: HTMLCanvasElement): void => {
  c.width = 1;
  c.height = 1;
};

type Viewport = ReturnType<PDFPageProxy['getViewport']>;

export class PdfViewer {
  readonly el: HTMLDivElement;
  readonly hooks: ViewerHooks = {};
  private readonly stage: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly overlay: SVGSVGElement;
  private readonly markers: SVGGElement;
  private readonly aimMark: SVGGElement;
  private readonly lens = new Lens();
  private canvas: HTMLCanvasElement | null = null;

  private page: PDFPageProxy | null = null;
  private vp1: Viewport | null = null;
  private pageW = 0;
  private pageH = 0;
  private points: UserPoint[] = [];
  mode: ViewerMode = 'pan';

  private zoom = 1; // px CSS per pt
  private fitZoom = 1;
  private atFit = false;
  private tx = 0;
  private ty = 0;
  private renderZoom = 1; // px CSS per pt del canvas attualmente mostrato

  private readonly pointers = new Map<number, Pt>();
  private maxPointers = 0;
  private gestureEvents = 0;
  private pinch: { dist: number; zoom: number; midX: number; midY: number; tx: number; ty: number } | null = null;
  /** Mira in corso (modo 'point', primo puntatore). */
  private aim: { id: number; pos: Pt; touch: boolean } | null = null;

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
    this.markers = document.createElementNS(SVG_NS, 'g');
    this.aimMark = document.createElementNS(SVG_NS, 'g');
    this.aimMark.setAttribute('class', 'aim-mark');
    this.aimMark.setAttribute('display', 'none');
    this.aimMark.innerHTML = '<line x1="-10" x2="10" y1="0" y2="0"/><line x1="0" x2="0" y1="-10" y2="10"/>';
    this.overlay = document.createElementNS(SVG_NS, 'svg');
    this.overlay.setAttribute('class', 'viewer-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.append(this.markers, this.aimMark);
    this.el = h(
      'div',
      { class: 'viewer', tabindex: 0, role: 'img', 'aria-label': 'Anteprima del documento' },
      this.stage,
      this.overlay,
      this.lens.el,
      this.empty,
    );

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hooks.onCursor?.(null);
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
    this.page = page;
    this.lastRender = null;
    this.lastError = null;
    this.logNext = page !== null;
    if (!page) {
      this.vp1 = null;
      this.stage.replaceChildren();
      if (this.canvas) release(this.canvas);
      this.canvas = null;
      this.empty.hidden = false;
      this.renderMarkers();
      this.queueStats();
      return;
    }
    this.empty.hidden = true;
    this.vp1 = page.getViewport({ scale: 1 });
    this.pageW = this.vp1.width;
    this.pageH = this.vp1.height;
    this.fit();
    this.renderMarkers();
    await this.renderNow();
  }

  /** Punti da mostrare (spazio utente PDF della pagina corrente). */
  setPoints(points: UserPoint[]): void {
    this.points = points;
    this.renderMarkers();
    this.updateMarkers();
  }

  setMode(mode: ViewerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.cancelAim();
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
    return s.x >= 0 && s.y >= 0 && s.x <= this.pageW && s.y <= this.pageH;
  }

  private toUser(s: SheetPoint): UserPoint | null {
    if (!this.vp1) return null;
    const [x, y] = this.vp1.convertToPdfPoint(s.x, s.y);
    return x === undefined || y === undefined ? null : { x, y };
  }

  /** Da spazio utente PDF a pt reali sul foglio (origine in alto a sinistra). */
  userToSheet(p: UserPoint): SheetPoint | null {
    if (!this.vp1) return null;
    const [x, y] = this.vp1.convertToViewportPoint(p.x, p.y);
    return x === undefined || y === undefined ? null : { x, y };
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
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
    if (this.mode === 'point' && !mousePan && this.pointers.size === 1) {
      this.aim = { id: e.pointerId, pos, touch: e.pointerType !== 'mouse' };
      this.updateAim();
    } else {
      this.cancelAim(); // un secondo dito annulla la mira: si passa al pinch
    }
    this.resetBaseline();
    this.queueStats();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!this.page) return;
    const cur = this.local(e);
    if (!prev) {
      if (e.pointerType === 'mouse') this.reportCursor(cur); // passaggio del mouse, nessun tasto
      return;
    }
    this.pointers.set(e.pointerId, cur);
    this.reportCursor(cur);
    if (this.aim && this.aim.id === e.pointerId) {
      this.aim.pos = cur;
      this.updateAim();
      return;
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
    if (!this.pointers.delete(e.pointerId)) return;
    const aim = this.aim;
    if (aim && aim.id === e.pointerId) {
      const pos = this.local(e);
      this.cancelAim();
      if (e.type === 'pointerup') this.place(pos);
    }
    this.resetBaseline();
    this.scheduleRender();
    this.queueStats();
  };

  private place(pos: Pt): void {
    const sheet = this.toSheet(pos);
    if (!this.inPage(sheet)) {
      this.hooks.onReject?.('Punto fuori dalla pagina: non inserito');
      return;
    }
    const user = this.toUser(sheet);
    if (user) this.hooks.onPlace?.(user, sheet);
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
    this.aim = null;
    this.aimMark.setAttribute('display', 'none');
    this.lens.hide();
  }

  private updateAim(): void {
    const aim = this.aim;
    if (!aim) return;
    this.aimMark.setAttribute('transform', `translate(${aim.pos.x} ${aim.pos.y})`);
    this.aimMark.setAttribute('display', 'inline');
    if (!aim.touch || !this.canvas || !this.lastRender) return; // la lente serve al dito, non al mouse
    const sheet = this.toSheet(aim.pos);
    const box = this.el.getBoundingClientRect();
    this.lens.show(aim.pos, { w: box.width, h: box.height }, this.canvas, {
      cx: sheet.x * this.lastRender.scale,
      cy: sheet.y * this.lastRender.scale,
      // pixel del canvas per pixel CSS dello schermo
      pxPerCss: this.lastRender.scale / this.zoom,
    });
  }

  // ---- Segni dei punti ----
  private renderMarkers(): void {
    this.markers.replaceChildren();
    if (!this.vp1) return;
    this.points.forEach((_p, i) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'pt-mark');
      g.innerHTML = `<line x1="-7" x2="7" y1="0" y2="0"/><line x1="0" x2="0" y1="-7" y2="7"/><circle r="3.5"/><text x="9" y="-6">${i + 1}</text>`;
      this.markers.append(g);
    });
  }

  private updateMarkers(): void {
    if (!this.vp1) return;
    const kids = this.markers.children;
    this.points.forEach((p, i) => {
      const g = kids[i];
      if (!g || !this.vp1) return;
      const [vx, vy] = this.vp1.convertToViewportPoint(p.x, p.y);
      if (vx === undefined || vy === undefined) return;
      g.setAttribute('transform', `translate(${this.tx + vx * this.zoom} ${this.ty + vy * this.zoom})`);
    });
  }

  // ---- Rendering ----
  private applyTransform(): void {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom / this.renderZoom})`;
    this.updateMarkers();
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
        maxPointers: this.maxPointers,
        gestureEvents: this.gestureEvents,
        pageZoom: window.visualViewport?.scale ?? null,
        error: this.lastError,
      });
      this.hooks.onView?.({ zoom: this.zoom, fit: this.fitZoom });
    });
  }
}
