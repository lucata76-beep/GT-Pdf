// Controlli delle proprieta' della linea: tipo, colore, spessore (pt del foglio). Servono sia nell'inspector (desktop)
// sia nel pannello aperto dalla barra contestuale (iPhone). Valgono per le NUOVE linee; "Applica all'ultima linea"
// le copia sull'ultima linea disegnata nella pagina (modificare oggetti qualunque richiede la selezione, CP4).
import { fmtTrim, parsePositive } from '../geometry/numbers';
import {
  COLOR_PALETTE,
  LINE_STYLES,
  type LineStyleId,
  type Stroke,
  WIDTH_MAX_PT,
  WIDTH_MIN_PT,
  WIDTH_PRESETS_PT,
  dashPattern,
  parseHexColor,
} from '../model/stroke';
import { h } from './dom';

export interface StyleBinding {
  get(): Stroke;
  set(patch: Partial<Stroke>): void;
  /** Copia le proprieta' correnti sull'ultima linea della pagina. */
  applyToLast(): void;
  /** C'e' un'ultima linea e ha proprieta' diverse da quelle correnti. */
  canApplyToLast(): boolean;
}

export interface StyleControls {
  el: HTMLElement;
  /** Rilegge lo stato (dopo un cambio da altrove). */
  refresh(): void;
}

/** Disegno in miniatura di una linea con le sue proprieta' (tipo, colore, spessore). */
export function styleGlyph(stroke: Stroke, opts: { width?: number; scalePx?: number } = {}): HTMLSpanElement {
  const w = opts.width ?? 44;
  const lineW = Math.min(4, Math.max(1, stroke.widthPt * (opts.scalePx ?? 1.5)));
  const dash = dashPattern(stroke.style, Math.max(0.6, lineW / 1.5));
  const span = document.createElement('span');
  span.className = 'style-glyph';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${w}" height="12" viewBox="0 0 ${w} 12"><line x1="1" x2="${w - 1}" y1="6" y2="6" stroke="${stroke.color}" stroke-width="${lineW}"${dash.length ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/></svg>`;
  return span;
}

export function createStyleControls(b: StyleBinding): StyleControls {
  const heading = (t: string): HTMLElement => h('h3', { class: 'insp-h' }, t);
  const msg = h('p', { class: 'ctl-msg', role: 'alert' });
  const showError = (text: string, field?: HTMLElement): void => {
    msg.textContent = text;
    field?.setAttribute('aria-invalid', 'true');
  };
  const clearError = (...fields: HTMLElement[]): void => {
    msg.textContent = '';
    for (const f of fields) f.removeAttribute('aria-invalid');
  };

  // ---- Tipo ----
  const styleBtns = new Map<LineStyleId, HTMLButtonElement>();
  const styleRow = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo di linea' });
  for (const s of LINE_STYLES) {
    const btn = h(
      'button',
      { class: 'btn seg-btn', type: 'button', 'aria-pressed': 'false', onclick: () => b.set({ style: s.id }) },
      styleGlyph({ style: s.id, color: 'currentColor', widthPt: 1 }, { width: 36 }),
      h('span', null, s.label),
    );
    styleBtns.set(s.id, btn);
    styleRow.append(btn);
  }

  // ---- Colore ----
  const swatchBtns = new Map<string, HTMLButtonElement>();
  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colore della linea' });
  for (const c of COLOR_PALETTE) {
    const btn = h('button', { class: 'btn swatch', type: 'button', 'aria-pressed': 'false', 'aria-label': `${c.name} ${c.color}`, title: `${c.name} ${c.color}`, onclick: () => b.set({ color: c.color }) });
    btn.style.setProperty('--swatch', c.color);
    swatchBtns.set(c.color, btn);
    swatches.append(btn);
  }
  const colorPicker = h('input', { class: 'color-native', type: 'color', 'aria-label': 'Scegli un colore personalizzato' });
  colorPicker.addEventListener('input', () => {
    clearError(hex);
    b.set({ color: colorPicker.value.toUpperCase() });
  });
  const hex = h('input', { class: 'field num', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 7, 'aria-label': 'Colore personalizzato in esadecimale', placeholder: '#RRGGBB' });
  const applyHex = (): void => {
    if (hex.value.trim() === '') return;
    const c = parseHexColor(hex.value);
    if (!c) {
      showError('Colore non valido: usa 6 cifre esadecimali, per esempio #A43700.', hex);
      return;
    }
    clearError(hex);
    b.set({ color: c });
  };
  hex.addEventListener('change', applyHex);
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyHex();
  });

  // ---- Spessore ----
  const presetBtns = new Map<number, HTMLButtonElement>();
  const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Spessori predefiniti in pt' });
  for (const w of WIDTH_PRESETS_PT) {
    const btn = h('button', { class: 'btn preset num', type: 'button', 'aria-pressed': 'false', onclick: () => b.set({ widthPt: w }) }, fmtTrim(w));
    presetBtns.set(w, btn);
    presets.append(btn);
  }
  const width = h('input', { class: 'field num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Spessore in pt', placeholder: 'es. 0.5' });
  const applyWidth = (): void => {
    const r = parsePositive(width.value, { what: 'Spessore', min: WIDTH_MIN_PT, max: WIDTH_MAX_PT });
    if (!r.ok) {
      showError(r.reason, width);
      return;
    }
    clearError(width);
    b.set({ widthPt: r.value });
    width.value = r.text.replace(/^\./, '0.'); // "," normalizzata a "."
  };
  width.addEventListener('change', applyWidth);
  width.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyWidth();
  });

  const last = h('button', { class: 'btn', type: 'button', onclick: () => b.applyToLast() }, "Applica all'ultima linea");

  const el = h(
    'div',
    { class: 'style-ctl' },
    h('section', { class: 'ctl-sec' }, heading('Tipo di linea'), styleRow),
    h('section', { class: 'ctl-sec' }, heading('Colore'), swatches, h('div', { class: 'field-row' }, colorPicker, hex)),
    h('section', { class: 'ctl-sec' }, heading('Spessore'), presets, h('div', { class: 'field-row' }, h('span', { class: 'lbl num' }, 'S:'), width, h('span', { class: 'unit num' }, 'pt'))),
    msg,
    last,
  );

  const refresh = (): void => {
    const s = b.get();
    for (const [id, btn] of styleBtns) btn.setAttribute('aria-pressed', String(id === s.style));
    for (const [c, btn] of swatchBtns) btn.setAttribute('aria-pressed', String(c === s.color));
    for (const [w, btn] of presetBtns) btn.setAttribute('aria-pressed', String(w === s.widthPt));
    colorPicker.value = s.color.toLowerCase();
    if (document.activeElement !== hex) hex.value = s.color;
    if (document.activeElement !== width) width.value = fmtTrim(s.widthPt, 3);
    last.disabled = !b.canApplyToLast();
  };
  refresh();
  return { el, refresh };
}
