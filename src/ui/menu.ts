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

let openMenu: { close: () => void } | null = null;

/** Un pulsante di menu. `items` e' valutata a ogni apertura (stato aggiornato). */
export function menuButton(label: string, items: () => MenuEntry[]): HTMLButtonElement {
  const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label);
  let panel: HTMLDivElement | null = null;

  const close = (): void => {
    if (!panel) return;
    panel.remove();
    panel = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    if (openMenu?.close === close) openMenu = null;
  };
  const onOutside = (e: Event): void => {
    if (panel && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      btn.focus();
    }
  };

  btn.addEventListener('click', () => {
    if (panel) {
      close();
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
        close();
        entry.onSelect?.();
      });
      panel.append(item);
    }
    document.body.append(panel);
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth;
    panel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
    panel.style.top = `${r.bottom + 2}px`;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    openMenu = { close };
  });
  return btn;
}
