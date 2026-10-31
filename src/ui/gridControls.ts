// Controllo "Passo griglia" del pannello a destra (CP6a): valori predefiniti e campo digitabile, validato, con lo stesso schema del campo dello spessore
// (`styleControls.ts`): il valore predefinito e' evidenziato, un valore digitato fuori intervallo non si applica e dice perche', la "," si normalizza a ".".
// Il passo e' in mm: REALI se la pagina ha una scala, del FOGLIO se non ce l'ha (lo dice la nota sotto il campo).
import { GRID_MAX_MM, GRID_MIN_MM, GRID_PRESETS_MM } from '../geometry/grid';
import { fmtTrim, parsePositive } from '../geometry/numbers';
import { h } from './dom';

export interface GridBinding {
  /** Passo corrente in mm. */
  get(): number;
  set(mm: number): void;
  /** "mm reali (scala 1:50)" o "mm del foglio (pagina non calibrata)": che cosa misura il passo sulla pagina corrente. */
  note(): string;
}

export interface GridControls {
  el: HTMLElement;
  /** Rilegge lo stato (cambio di passo, di pagina o di scala). */
  refresh(): void;
}

export function createGridControls(b: GridBinding): GridControls {
  const msg = h('p', { class: 'ctl-msg', role: 'alert' });
  const note = h('p', { class: 'hint grid-note' });
  const presetBtns = new Map<number, HTMLButtonElement>();
  const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Passi della griglia predefiniti in mm' });
  for (const mm of GRID_PRESETS_MM) {
    const btn = h(
      'button',
      {
        class: 'btn preset num',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => {
          msg.textContent = '';
          field.removeAttribute('aria-invalid');
          b.set(mm);
        },
      },
      fmtTrim(mm),
    );
    presetBtns.set(mm, btn);
    presets.append(btn);
  }
  const field = h('input', { class: 'field num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Passo della griglia in mm', placeholder: 'es. 10' });
  const apply = (): void => {
    const r = parsePositive(field.value, { what: 'Passo griglia', min: GRID_MIN_MM, max: GRID_MAX_MM });
    if (!r.ok) {
      msg.textContent = r.reason;
      field.setAttribute('aria-invalid', 'true');
      return;
    }
    msg.textContent = '';
    field.removeAttribute('aria-invalid');
    b.set(r.value);
    field.value = r.text.replace(/^\./, '0.'); // "," normalizzata a "."
  };
  field.addEventListener('change', apply);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
  const sec = h('section', { class: 'grid-sec' }, h('h3', { class: 'insp-h' }, 'Passo griglia'), presets, h('div', { class: 'field-row' }, h('span', { class: 'lbl num' }, 'P:'), field, h('span', { class: 'unit num' }, 'mm')), note, msg);
  const el = h('div', { class: 'grid-ctl' }, sec);

  const refresh = (): void => {
    const mm = b.get();
    for (const [v, btn] of presetBtns) btn.setAttribute('aria-pressed', String(v === mm));
    if (document.activeElement !== field) field.value = fmtTrim(mm, 3);
    note.textContent = b.note();
  };
  refresh();
  return { el, refresh };
}
