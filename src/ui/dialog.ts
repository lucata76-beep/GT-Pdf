// Finestre di dialogo (livello 3 di DESIGN.md). Sostituiscono confirm()/alert(): in Safari da icona Home
// i dialoghi di sistema sono meno prevedibili (NON VERIFICATO).
import { h } from './dom';

interface DialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Se assente, la finestra ha solo il pulsante di conferma (avviso). */
  cancelLabel?: string;
  /**
   * Eseguita in modo sincrono dentro il gestore del tocco su "conferma", prima che la finestra si chiuda:
   * serve a chi deve aprire il selettore file, che iOS consente solo da un gesto diretto.
   */
  onConfirm?: () => void;
  /** Contenuto aggiuntivo (es. un campo da compilare), mostrato sotto il messaggio. */
  content?: Node;
  /** Elemento che riceve il focus all'apertura (predefinito: il pulsante di conferma). */
  initialFocus?: HTMLElement;
  /** Se presente e restituisce false, "conferma" non chiude la finestra (il contenuto spiega perche'). */
  canConfirm?: () => boolean;
}

/** Restituisce true se l'utente conferma. Esc e tocco fuori dalla finestra = annulla. */
export function showDialog(opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const finish = (value: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && opts.content?.contains(e.target)) {
        e.preventDefault();
        ok.click(); // Invio in un campo = conferma
      }
    };
    const ok = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
          if (opts.canConfirm && !opts.canConfirm()) return;
          opts.onConfirm?.();
          finish(true);
        },
      },
      opts.confirmLabel ?? 'OK',
    );
    const cancel = opts.cancelLabel ? h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, opts.cancelLabel) : null;
    const box = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title', class: 'dialog-title' }, opts.title),
      h('p', { class: 'dialog-msg' }, opts.message),
      opts.content ?? null,
      h('div', { class: 'dialog-actions' }, cancel, ok),
    );
    // Con un campo da compilare la finestra sta in alto: la tastiera su schermo non deve coprirla (NON VERIFICATO su iPhone).
    const backdrop = h('div', { class: opts.content ? 'dialog-backdrop has-field' : 'dialog-backdrop' }, box);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop && cancel) finish(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    (opts.initialFocus ?? ok).focus();
  });
}
