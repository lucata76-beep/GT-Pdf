// Menu a tendina della barra superiore. La voce disabilitata mostra in quale checkpoint arriva.
import { h } from './dom';

export interface MenuItem {
  label: string;
  /** Testo a destra: es. "CP2" per le funzioni non ancora presenti. */
  hint?: string;
  disabled?: boolean;
  onSelect?: () => void;
}
export type MenuEntry = MenuItem | 'separator';

/** Per la diagnostica ("Prova menu" in Diagnostica): l'editor usa le impostazioni predefinite e non cambia. */
export interface MenuOptions {
  /** Chiude il menu quando la finestra cambia dimensione (predefinito: si'). */
  closeOnResize?: boolean;
  /** Osservatore: apertura, chiusura con il motivo, ridimensionamento della finestra (anche se ignorato), tocco fuori dal pannello. */
  onEvent?: (kind: 'open' | 'close' | 'resize' | 'outside', detail: string) => void;
}

let openMenu: { close: () => void } | null = null;

/** Un pulsante di menu. `items` e' valutata a ogni apertura (stato aggiornato). */
export function menuButton(label: string, items: () => MenuEntry[], options: MenuOptions = {}): HTMLButtonElement {
  const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label);
  let panel: HTMLDivElement | null = null;

  const close = (reason = 'altro menu'): void => {
    if (!panel) return;
    panel.remove();
    panel = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (openMenu?.close === close) openMenu = null;
    options.onEvent?.('close', reason);
  };
  const onResize = (): void => {
    options.onEvent?.('resize', `${window.innerWidth}x${window.innerHeight}`);
    if (options.closeOnResize !== false) close('resize');
  };
  const onOutside = (e: Event): void => {
    if (panel && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      options.onEvent?.('outside', (e.target as HTMLElement).className || (e.target as HTMLElement).tagName);
      close('tocco fuori');
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close('Esc');
      btn.focus();
    }
  };

  btn.addEventListener('click', () => {
    if (panel) {
      close('pulsante');
      return;
    }
    openMenu?.close();
    panel = h('div', { class: 'menu-panel', role: 'menu' });
    for (const entry of items()) {
      if (entry === 'separator') {
        panel.append(h('div', { class: 'menu-sep', role: 'separator' }));
        continue;
      }
      const item = h(
        'button',
        { class: 'menu-item', type: 'button', role: 'menuitem', disabled: entry.disabled === true },
        h('span', null, entry.label),
        entry.hint ? h('span', { class: 'menu-hint' }, entry.hint) : null,
      );
      item.addEventListener('click', () => {
        close('voce');
        entry.onSelect?.();
      });
      panel.append(item);
    }
    document.body.append(panel);
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth;
    panel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
    panel.style.top = `${r.bottom + 2}px`;
    // Il menu non esce dallo schermo: se e' piu' alto dello spazio sotto il pulsante (iPhone in orizzontale, A+) scorre (CSS .menu-panel).
    panel.style.setProperty('--menu-top', `${r.bottom + 2}px`);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    openMenu = { close };
    options.onEvent?.('open', `${window.innerWidth}x${window.innerHeight}`);
  });
  return btn;
}
