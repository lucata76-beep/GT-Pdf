// Vista del documento: pagina PDF.js su canvas, pan con un dito, pinch con due, rotella su desktop.
// Pointer Events + touch-action: none. Il canvas non supera mai PIXEL_BUDGET: oltre, il rendering sfoca.
import { PIXEL_BUDGET, fitRenderSize } from '../geometry/pixels';
import type { PDFPageProxy, RenderTask } from '../pdf/loader';
import { h } from './dom';

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

type Pt = { x: number; y: number };

const MAX_ZOOM = 24; // px CSS per pt

const isCancel = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'RenderingCancelledException';
const release = (c: HTMLCanvasElement): void => {
  c.width = 1;
  c.height = 1;
};

export class PdfViewer {
  readonly el: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;

  private page: PDFPageProxy | null = null;
  private pageW = 0;
  private pageH = 0;

  private zoom = 1; // px CSS per pt
  private fitZoom = 1;
  private tx = 0;
  private ty = 0;
  private renderZoom = 1; // px CSS per pt del canvas attualmente mostrato

  private readonly pointers = new Map<number, Pt>();
  private maxPointers = 0;
  private gestureEvents = 0;
  private pinch: { dist: number; zoom: number; midX: number; midY: number; tx: number; ty: number } | null = null;

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
    this.el = h('div', { class: 'viewer', tabindex: 0, role: 'img', 'aria-label': 'Anteprima del documento' }, this.stage, this.empty);

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
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
      if (this.page) this.queueStats();
    }).observe(this.el);
    window.visualViewport?.addEventListener('resize', () => this.queueStats());
  }

  async setPage(page: PDFPageProxy | null): Promise<void> {
    this.renderToken++;
    this.task?.cancel();
    this.page = page;
    this.lastRender = null;
    this.lastError = null;
    this.logNext = page !== null;
    if (!page) {
      this.stage.replaceChildren();
      if (this.canvas) release(this.canvas);
      this.canvas = null;
      this.empty.hidden = false;
      this.queueStats();
      return;
    }
    this.empty.hidden = true;
    const vp = page.getViewport({ scale: 1 });
    this.pageW = vp.width;
    this.pageH = vp.height;
    this.fit();
    await this.renderNow();
  }

  fit(): void {
    if (!this.page) return;
    const r = this.el.getBoundingClientRect();
    this.fitZoom = Math.min(r.width / this.pageW, r.height / this.pageH) * 0.96;
    this.zoom = this.fitZoom;
    this.tx = (r.width - this.pageW * this.zoom) / 2;
    this.ty = (r.height - this.pageH * this.zoom) / 2;
    this.applyTransform();
    this.scheduleRender(0);
  }

  zoomBy(factor: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(this.zoom * factor, r.width / 2, r.height / 2);
    this.scheduleRender();
  }

  private zoomAt(newZoom: number, cx: number, cy: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(this.fitZoom * 0.2, newZoom));
    const k = z / this.zoom;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.zoom = z;
    this.applyTransform();
  }

  // ---- Gesti ----
  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.page) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* puntatore gia' terminato: si prosegue senza cattura */
    }
    this.pointers.set(e.pointerId, this.local(e));
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
    this.resetBaseline();
    this.queueStats();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.page) return;
    const cur = this.local(e);
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 1) {
      this.tx += cur.x - prev.x;
      this.ty += cur.y - prev.y;
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
    }
    this.applyTransform();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.resetBaseline();
    this.scheduleRender();
    this.queueStats();
  };

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

  // ---- Rendering ----
  private applyTransform(): void {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom / this.renderZoom})`;
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
    const size = fitRenderSize(this.pageW, this.pageH, this.zoom * dpr, PIXEL_BUDGET);
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
    });
  }
}
