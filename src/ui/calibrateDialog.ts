// Dialogo "Calibra scala" (DESIGN.md): mostra la distanza misurata in pt e in mm sul foglio, campo "Distanza reale" in mm,
// scala calcolata in tempo reale. Applica e Annulla. Input non valido: rifiutato con un messaggio e finestra aperta.
import { fmt, parsePositive } from '../geometry/numbers';
import { ptToMm } from '../geometry/pixels';
import { type PageScale, calibrate, scaleLabel } from '../geometry/scale';
import { showDialog } from './dialog';
import { h } from './dom';

/** Distanza reale massima accettata (mm): 1.000 km. Serve solo a scartare errori di digitazione evidenti. */
export const REAL_MM_MAX = 1_000_000_000;

/** Restituisce i mm reali digitati, o null se l'utente annulla. */
export async function askRealDistance(dPt: number, current: PageScale | null): Promise<number | null> {
  const input = h('input', {
    class: 'field num',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'Distanza reale in millimetri',
    placeholder: 'es. 100',
  });
  const msg = h('p', { class: 'dlg-field-msg', role: 'alert' });
  const result = h('p', { class: 'dlg-calc num', 'aria-live': 'polite' });
  const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v));
  let value: number | null = null;

  const evaluate = (showEmptyError: boolean): boolean => {
    const raw = input.value;
    value = null;
    result.textContent = '';
    input.removeAttribute('aria-invalid');
    if (raw.trim() === '' && !showEmptyError) {
      msg.textContent = '';
      return false;
    }
    const r = parsePositive(raw, { what: 'Distanza reale', max: REAL_MM_MAX });
    if (!r.ok) {
      msg.textContent = r.reason;
      input.setAttribute('aria-invalid', 'true');
      return false;
    }
    const s = calibrate(dPt, r.value);
    if (!s) {
      msg.textContent = 'Non è possibile calcolare la scala con questi valori.';
      input.setAttribute('aria-invalid', 'true');
      return false;
    }
    msg.textContent = '';
    value = r.value;
    result.textContent = `Nuova scala: ${scaleLabel(s)}`;
    return true;
  };
  input.addEventListener('input', () => evaluate(false));
  input.addEventListener('change', () => {
    if (evaluate(false) && value !== null) input.value = String(value); // normalizza "," a "."
  });

  const content = h(
    'div',
    { class: 'dlg-fields' },
    kv('Distanza misurata sul foglio', `${fmt(dPt)} pt = ${fmt(ptToMm(dPt))} mm`),
    current ? kv('Scala attuale della pagina', scaleLabel(current)) : null,
    h('label', { class: 'dlg-label' }, h('span', { class: 'insp-h' }, 'Distanza reale'), h('span', { class: 'field-row' }, h('span', { class: 'lbl num' }, 'L:'), input, h('span', { class: 'unit num' }, 'mm'))),
    msg,
    result,
  );

  const ok = await showDialog({
    title: 'Calibra scala',
    message: 'Inserisci la distanza reale tra i due punti. Valida per questa pagina.',
    confirmLabel: 'Applica',
    cancelLabel: 'Annulla',
    content,
    initialFocus: input,
    canConfirm: () => {
      const good = evaluate(true);
      if (good && value !== null) input.value = String(value);
      return good;
    },
  });
  return ok ? value : null;
}
