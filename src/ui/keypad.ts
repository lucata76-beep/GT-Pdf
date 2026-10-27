// Tastierino su schermo (DESIGN.md, "Tastierino su schermo"): compare solo quando si scrive un testo o il valore di una quota.
// Riga fissa Ø R ° ± ⌫; poi 7 8 9 / 4 5 6 / 1 2 3 / 0 . 00 e, a destra, ABC TESTO, #$& SIMBOLI, Annulla, OK.
// ABC TESTO e #$& SIMBOLI sostituiscono i numeri con lettere o simboli nella stessa griglia (la riga fissa resta).
// Il valore e' mostrato in un riquadro che NON e' un campo di testo: la tastiera di sistema di iOS non si apre mai.
// Su desktop funziona anche la tastiera fisica (caratteri, Backspace, Invio, Esc).
import { type EntryRules, DIGIT_KEYS, LETTER_KEYS, SPECIAL_KEYS, SYMBOL_KEYS, backspace, typeChar } from './keypadInput';
import { h } from './dom';
import { icon } from './icons';

export type KeypadLayout = 'num' | 'abc' | 'sym';

export interface KeypadSession {
  /** Es. "Testo", "Quota allineata". */
  title: string;
  /** Riga informativa (es. scala e valore automatico). */
  info: string;
  initial: string;
  /**
   * Il testo iniziale e' un valore proposto (es. il valore automatico di una quota): dalla posizione `selectFrom` in poi
   * e' "selezionato" e il primo tasto lo sostituisce (come in una calcolatrice), cosi' per digitare un altro valore
   * non servono dieci cancellazioni. Prima di `selectFrom` (es. il prefisso Ø o R) il testo resta.
   */
  selectFrom?: number;
  layout: KeypadLayout;
  rules: EntryRules;
  /** Messaggio di errore per il testo attuale, o null se si puo' confermare. */
  validate(text: string): string | null;
  /** Il testo e' cambiato (anteprima sul foglio). */
  onInput(text: string): void;
  onConfirm(text: string): void;
  onCancel(): void;
}

const LAYOUT_BUTTONS: Record<KeypadLayout, readonly { to: KeypadLayout; top: string; sub: string }[]> = {
  num: [
    { to: 'abc', top: 'ABC', sub: 'TESTO' },
    { to: 'sym', top: '#$&', sub: 'SIMBOLI' },
  ],
  abc: [
    { to: 'num', top: '123', sub: 'NUMERI' },
    { to: 'sym', top: '#$&', sub: 'SIMBOLI' },
  ],
  sym: [
    { to: 'num', top: '123', sub: 'NUMERI' },
    { to: 'abc', top: 'ABC', sub: 'TESTO' },
  ],
};

export class Keypad {
  readonly el: HTMLElement;
  private session: KeypadSession | null = null;
  private text = '';
  private layout: KeypadLayout = 'num';
  private upper = true;
  /** Posizione da cui il testo e' selezionato (sostituito dal primo tasto); null se non c'e' selezione. */
  private selFrom: number | null = null;

  private readonly title = h('span', { class: 'kp-title' });
  private readonly info = h('span', { class: 'kp-info num' });
  private readonly value = h('span', { class: 'kp-value' });
  private readonly display = h('div', { class: 'kp-display num', role: 'textbox', 'aria-readonly': 'true', 'aria-label': 'Valore in modifica' }, this.value, h('span', { class: 'kp-caret', 'aria-hidden': 'true' }));
  private readonly msg = h('p', { class: 'kp-msg', role: 'alert' });
  private readonly row1 = h('div', { class: 'kp-row1' });
  private readonly main = h('div', { class: 'kp-main' });
  private readonly side = h('div', { class: 'kp-side' });
  private readonly body = h('div', { class: 'kp-body' }, this.main, this.side);

  constructor() {
    for (const k of SPECIAL_KEYS) this.row1.append(this.key(k.label, () => this.press(k.ch), { name: k.name }));
    this.row1.append(this.key('', () => this.erase(), { cls: 'kp-fn', name: 'Cancella l\'ultimo carattere', child: icon('delete') }));
    this.el = h('section', { class: 'keypad', 'aria-label': 'Tastierino', hidden: true, 'data-layout': 'num' }, h('div', { class: 'kp-head' }, this.title, this.info), this.display, this.msg, this.row1, this.body);
    // Tutto il tastierino: nessuna selezione di testo, nessuna lente di iOS, nessun tocco passa al foglio sotto.
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  open(s: KeypadSession): void {
    this.session = s;
    this.text = s.initial;
    this.selFrom = s.selectFrom !== undefined && s.initial.length > s.selectFrom ? s.selectFrom : null;
    this.upper = true;
    this.title.textContent = s.title;
    this.info.textContent = s.info;
    this.msg.textContent = '';
    this.setLayout(s.layout);
    this.refreshDisplay();
    this.el.hidden = false;
    document.addEventListener('keydown', this.onKey, true);
  }

  /** Chiude senza chiamare nulla (chi chiude sa gia' perche'). */
  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.session = null;
    this.el.hidden = true;
  }

  /** Testo attuale (per le prove e per l'app). */
  get current(): string {
    return this.text;
  }

  // ---- Tasti ----
  private key(label: string, fn: () => void, o: { cls?: string; name?: string; child?: Node; sub?: string } = {}): HTMLButtonElement {
    const b = h(
      'button',
      { class: `kp-key${o.cls ? ` ${o.cls}` : ''}`, type: 'button', 'aria-label': o.name },
      o.child ?? null,
      o.child ? null : o.sub ? h('span', { class: 'kp-top' }, label) : label,
      o.sub ? h('span', { class: 'kp-sub' }, o.sub) : null,
    );
    // click, non pointerdown: il tocco su un tasto non deve mai arrivare al foglio; touch-action: manipulation evita il doppio tocco = zoom
    b.addEventListener('click', fn);
    return b;
  }

  private setLayout(l: KeypadLayout): void {
    this.layout = l;
    this.el.dataset.layout = l;
    this.main.className = `kp-main kp-main-${l}`;
    this.main.replaceChildren();
    if (l === 'num') {
      for (const k of DIGIT_KEYS) this.main.append(this.key(k, () => this.press(k), { name: k === '.' ? 'Punto decimale' : undefined }));
    } else if (l === 'abc') {
      for (const c of LETTER_KEYS) {
        const ch = this.upper ? c : c.toLowerCase();
        this.main.append(this.key(ch, () => this.press(this.upper ? c : c.toLowerCase())));
      }
      // il tasto mostra il risultato del tocco: con le maiuscole attive offre "abc", e viceversa
      this.main.append(this.key('', () => this.toggleCase(), { cls: 'kp-fn', name: this.upper ? 'Passa alle minuscole' : 'Passa alle maiuscole', child: h('span', null, this.upper ? 'abc' : 'ABC') }));
      this.main.append(this.key('', () => this.press(' '), { cls: 'kp-fn kp-space', name: 'Spazio', child: h('span', null, 'spazio') }));
    } else {
      for (const c of SYMBOL_KEYS) {
        if (c === ' ') this.main.append(this.key('', () => this.press(' '), { cls: 'kp-fn kp-space', name: 'Spazio', child: h('span', null, 'spazio') }));
        else this.main.append(this.key(c, () => this.press(c)));
      }
    }
    this.side.replaceChildren(
      ...LAYOUT_BUTTONS[l].map((b) => this.key(b.top, () => this.setLayout(b.to), { cls: 'kp-fn kp-mode', sub: b.sub, name: `${b.top} ${b.sub}` })),
      this.key('Annulla', () => this.cancel(), { cls: 'kp-cancel' }),
      this.key('OK', () => this.confirm(), { cls: 'kp-ok', child: h('span', { class: 'kp-oklabel' }, 'OK', icon('check')), name: 'OK, conferma' }),
    );
  }

  private toggleCase(): void {
    this.upper = !this.upper;
    this.setLayout(this.layout);
  }

  // ---- Azioni ----
  private press(ch: string): void {
    const s = this.session;
    if (!s) return;
    const base = this.selFrom === null ? this.text : this.text.slice(0, this.selFrom); // il primo tasto sostituisce la selezione
    const r = typeChar(base, ch, s.rules);
    this.msg.textContent = r.error ?? '';
    if (r.error && this.selFrom !== null) return; // carattere rifiutato: la selezione resta
    if (r.text === this.text && this.selFrom === null) return;
    this.selFrom = null;
    this.text = r.text;
    this.changed();
  }

  private erase(): void {
    if (!this.session) return;
    this.msg.textContent = '';
    if (this.selFrom !== null) {
      this.text = this.text.slice(0, this.selFrom); // cancella la selezione intera
      this.selFrom = null;
      this.changed();
      return;
    }
    if (this.text === '') return;
    this.text = backspace(this.text);
    this.changed();
  }

  private changed(): void {
    this.refreshDisplay();
    this.session?.onInput(this.text);
  }

  private refreshDisplay(): void {
    if (this.selFrom === null) this.value.textContent = this.text;
    else this.value.replaceChildren(this.text.slice(0, this.selFrom), h('mark', { class: 'kp-sel' }, this.text.slice(this.selFrom)));
    this.display.scrollLeft = this.display.scrollWidth; // si vede sempre la fine di quello che si scrive
  }

  private confirm(): void {
    const s = this.session;
    if (!s) return;
    const err = s.validate(this.text);
    if (err) {
      this.msg.textContent = err;
      return;
    }
    const text = this.text;
    this.close();
    s.onConfirm(text);
  }

  private cancel(): void {
    const s = this.session;
    if (!s) return;
    this.close();
    s.onCancel();
  }

  // ---- Tastiera fisica (desktop) ----
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.session || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.confirm();
    else if (e.key === 'Backspace') this.erase();
    else if ([...e.key].length === 1) this.press(e.key);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
}
