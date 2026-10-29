// Lettura in diretta di schermo, zoom e puntatori (CP5d): un riquadro richiudibile con i numeri che servono a capire sul telefono perche' zoom e spostamento
// non vanno (puntatori rimasti nella mappa, zoom della pagina intera, altezza del visore) e un pulsante per copiarli. Si aggiorna solo se e' aperto.
// Compare nel pannello "App" dell'editor e in Diagnostica. Non cambia nulla: legge soltanto.
import { fmt } from '../geometry/numbers';
import { h } from './dom';
import { screenLines } from './screenInfo';
import type { ViewerStats } from './viewer';

export class TouchReadout {
  readonly el: HTMLDetailsElement;
  private readonly pre: HTMLPreElement;
  private stats: ViewerStats | null = null;
  private timer = 0;
  private readonly onTick = (): void => this.render();

  constructor(title = 'Diagnostica tocco e schermo') {
    this.pre = h('pre', { class: 'stats mono touch-readout', 'aria-live': 'off' });
    const copy = h('button', { class: 'btn', type: 'button', onclick: () => void this.copy() }, 'Copia');
    this.el = h('details', { class: 'touch-diag' }, h('summary', null, title), h('div', { class: 'row' }, copy), this.pre);
    this.el.addEventListener('toggle', () => {
      if (this.el.open) this.start();
      else this.stop();
    });
  }

  /** Le statistiche del visore (zoom, puntatori, registro degli eventi). */
  setStats(s: ViewerStats): void {
    this.stats = s;
    if (this.el.open) this.render();
  }

  /** Testo completo: schermo, zoom e puntatori. */
  text(): string {
    const lines = [`GT-Pdf ${__BUILD_ID__} · ${navigator.userAgent}`, ...screenLines()];
    const s = this.stats;
    if (!s) lines.push('visore: nessuna lettura');
    else {
      lines.push(`zoom documento ${fmt(s.zoom, 3)} px/pt (${fmt(s.zoomOfFit * 100, 0)} % dell'adattamento) · zoom pagina intera (visualViewport.scale) ${s.pageZoom === null ? 'n/d' : fmt(s.pageZoom, 2)}`);
      lines.push(`puntatori nella mappa: ${s.pointers} [${s.pointerIds.join(',')}] (max ${s.maxPointers}) · eventi gesto Safari: ${s.gestureEvents}`);
      lines.push('ultimi eventi puntatore (down, up, cancel, gotcapture, lostcapture; id, tipo, P primario / S secondario, n = mappa dopo l\'evento):');
      lines.push(...(s.pointerLog.length > 0 ? s.pointerLog.map((r) => `  ${r}`) : ['  nessuno']));
    }
    return lines.join('\n');
  }

  private render(): void {
    this.pre.textContent = this.text();
  }

  private start(): void {
    this.render();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(this.onTick, 500);
    window.visualViewport?.addEventListener('resize', this.onTick);
    window.visualViewport?.addEventListener('scroll', this.onTick);
    window.addEventListener('resize', this.onTick);
  }

  private stop(): void {
    window.clearInterval(this.timer);
    window.visualViewport?.removeEventListener('resize', this.onTick);
    window.visualViewport?.removeEventListener('scroll', this.onTick);
    window.removeEventListener('resize', this.onTick);
  }

  private async copy(): Promise<void> {
    const text = this.text();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(this.pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }
}
