// Controlli delle proprieta': tipo di linea, colore, spessore e altezza del testo (pt del foglio). Servono sia
// nell'inspector (desktop, tutte le sezioni) sia nel pannello aperto dalla barra contestuale (iPhone, solo quelle dello
// strumento attivo). Valgono per i NUOVI oggetti, oppure per l'oggetto selezionato quando lo strumento Seleziona ne ha
// uno (lo decide il binding: ogni modifica diventa un comando annullabile).
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
import { TEXT_MAX_PT, TEXT_MIN_PT, TEXT_PRESETS_PT } from '../model/textStyle';
import { h } from './dom';

export interface StyleBinding {
  get(): Stroke;
  set(patch: Partial<Stroke>): void;
  /** Corpo del testo per i nuovi testi e le nuove quote, in pt. */
  getTextPt(): number;
  setTextPt(pt: number): void;
}

/**
 * Quali sezioni mostrare: tutte (inspector) o quelle dello strumento o dell'oggetto selezionato
 * (linea: tipo, colore, spessore; testo: colore, altezza; quota: colore, spessore, altezza; nessuna: la copertura non ha proprieta').
 */
export type StyleKind = 'all' | 'line' | 'text' | 'dim' | 'none';

export interface StyleControls {
  el: HTMLElement;
  /** Rilegge lo stato (dopo un cambio da altrove). */
  refresh(): void;
  setKind(kind: StyleKind): void;
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

  // ---- Altezza del testo ----
  const textBtns = new Map<number, HTMLButtonElement>();
  const textPresets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Altezza del testo predefinita in pt' });
  for (const t of TEXT_PRESETS_PT) {
    const btn = h('button', { class: 'btn preset num', type: 'button', 'aria-pressed': 'false', onclick: () => b.setTextPt(t) }, fmtTrim(t));
    textBtns.set(t, btn);
    textPresets.append(btn);
  }
  const textPt = h('input', { class: 'field num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Altezza del testo in pt', placeholder: 'es. 10' });
  const applyTextPt = (): void => {
    const r = parsePositive(textPt.value, { what: 'Altezza testo', min: TEXT_MIN_PT, max: TEXT_MAX_PT });
    if (!r.ok) {
      showError(r.reason, textPt);
      return;
    }
    clearError(textPt);
    b.setTextPt(r.value);
    textPt.value = r.text.replace(/^\./, '0.'); // "," normalizzata a "."
  };
  textPt.addEventListener('change', applyTextPt);
  textPt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyTextPt();
  });

  const typeSec = h('section', { class: 'ctl-sec' }, heading('Tipo di linea'), styleRow);
  const colorSec = h('section', { class: 'ctl-sec' }, heading('Colore'), swatches, h('div', { class: 'field-row' }, colorPicker, hex));
  const widthSec = h('section', { class: 'ctl-sec' }, heading('Spessore'), presets, h('div', { class: 'field-row' }, h('span', { class: 'lbl num' }, 'S:'), width, h('span', { class: 'unit num' }, 'pt')));
  const textSec = h('section', { class: 'ctl-sec' }, heading('Altezza testo'), textPresets, h('div', { class: 'field-row' }, h('span', { class: 'lbl num' }, 'H:'), textPt, h('span', { class: 'unit num' }, 'pt')));
  const el = h('div', { class: 'style-ctl' }, typeSec, colorSec, widthSec, textSec, msg);

  const setKind = (kind: StyleKind): void => {
    colorSec.hidden = kind === 'none';
    typeSec.hidden = !(kind === 'all' || kind === 'line');
    widthSec.hidden = !(kind === 'all' || kind === 'line' || kind === 'dim');
    textSec.hidden = !(kind === 'all' || kind === 'text' || kind === 'dim');
  };
  setKind('all');

  const refresh = (): void => {
    const s = b.get();
    for (const [id, btn] of styleBtns) btn.setAttribute('aria-pressed', String(id === s.style));
    for (const [c, btn] of swatchBtns) btn.setAttribute('aria-pressed', String(c === s.color));
    for (const [w, btn] of presetBtns) btn.setAttribute('aria-pressed', String(w === s.widthPt));
    for (const [t, btn] of textBtns) btn.setAttribute('aria-pressed', String(t === b.getTextPt()));
    if (document.activeElement !== textPt) textPt.value = fmtTrim(b.getTextPt(), 3);
    colorPicker.value = s.color.toLowerCase();
    if (document.activeElement !== hex) hex.value = s.color;
    if (document.activeElement !== width) width.value = fmtTrim(s.widthPt, 3);
  };
  refresh();
  return { el, refresh, setKind };
}
