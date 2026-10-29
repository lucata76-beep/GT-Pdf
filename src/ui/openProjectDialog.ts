// Dialogo "Apri progetto" (5c, decisione D4: riapertura in DUE PASSI). Il file .json non contiene il PDF e Safari non ha showOpenFilePicker: l'app non puo'
// riaprire il PDF da sola. Passo 1 (fatto fuori da qui): si sceglie il .json, lo si legge e lo si valida. Passo 2 (questo dialogo): riepilogo e pulsante
// "Scegli il PDF…", che apre il selettore DAL TOCCO (su iPhone un input file va aperto da un gesto: per share() CP0 ha misurato che il gesto scade; per il
// selettore NON VERIFICATO, quindi il secondo selettore non si apre mai da codice). Poi: apertura del PDF SENZA toccare il documento attuale, confronto
// (stesso file / stessa geometria / altro) e, se serve, conferma. Finche' non si conferma, il documento aperto resta com'era.
import type { OpenOutcome } from '../project/match';
import type { ProjectSummary } from '../project/session';
import { fmtSize } from './exportDialog';
import { h } from './dom';

/** Il PDF scelto, gia' aperto ma NON ancora installato: o si installa (`commit`) o si scarta (`discard`). */
export interface CheckedPdf {
  outcome: OpenOutcome;
  /** Nome e dimensione del PDF scelto, per i messaggi. */
  name: string;
  size: number;
  /** Installa il PDF e applica il progetto. */
  commit(): Promise<void>;
  /** Chiude il PDF aperto senza installarlo. */
  discard(): void;
}

export interface OpenProjectInput {
  /** Nome del file .json scelto. */
  fileName: string;
  /** Il PDF con cui il progetto e' stato salvato: nome, dimensione e se c'e' l'impronta. */
  pdfName: string;
  pdfSize: number;
  hasHash: boolean;
  summary: ProjectSummary;
  /** Apre il selettore del PDF. DEVE essere chiamata direttamente dal gestore del tocco (nessun `await` prima). `onPick` riceve il file scelto. */
  pickPdf(onPick: (f: File) => void): void;
  /** Legge e apre il PDF scelto e lo confronta col progetto. Lancia se non si puo' aprire come PDF (messaggio in italiano). Non tocca il documento attuale. */
  check(file: File): Promise<CheckedPdf>;
  /** Chiamata dopo `commit()` riuscito, per il messaggio finale nell'app. */
  onOpened(message: string): void;
}

export function showOpenProjectDialog(input: OpenProjectInput): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    let busy = false;
    let pending: CheckedPdf | null = null;

    const close = (): void => {
      if (busy) return;
      document.removeEventListener('keydown', onKey, true);
      pending?.discard();
      pending = null;
      backdrop.remove();
      previous?.focus?.();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const box = h('div', { class: 'dialog export-dialog open-project-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exp-title' });
    const show = (...children: (Node | null)[]): void => box.replaceChildren(...children.filter((c): c is Node => c !== null));
    const backdrop = h('div', { class: 'dialog-backdrop' }, box);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });
    const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num exp-v' }, v));
    const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
    const title = 'Apri progetto';

    /** Il pulsante che apre il selettore del PDF: il gestore chiama `pickPdf` subito, dentro il tocco. */
    const pickButton = (label: string, primary: boolean): HTMLElement =>
      h('button', { class: primary ? 'btn primary' : 'btn', type: 'button', 'data-role': 'pick-pdf', onclick: () => input.pickPdf((f) => void onPicked(f)) }, label);

    // ---- 1) riepilogo e scelta del PDF ----
    function renderSummary(note: string | null = null): void {
      const s = input.summary;
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, title),
        h('p', { class: 'dialog-msg' }, `Progetto di ${input.pdfName}: ${plural(s.pages, 'pagina', 'pagine')}, ${plural(s.objects, 'oggetto', 'oggetti')}, ${plural(s.scales, 'scala', 'scale')}.`),
        h(
          'div',
          { class: 'exp-summary', 'aria-label': 'Riepilogo del progetto' },
          kv('File progetto', input.fileName),
          kv('PDF atteso', `${input.pdfName} (${fmtSize(input.pdfSize)})`),
          kv('Pagine con oggetti', `${s.pagesWithObjects} di ${s.pages}`),
          kv('Oggetti', String(s.objects)),
          kv('Scale', String(s.scales)),
          kv('Impronta SHA-256', input.hasHash ? 'presente' : 'assente'),
        ),
        h('p', { class: 'hint' }, 'Il progetto non contiene il PDF: scegli lo stesso PDF con cui l’hai salvato. Il documento attuale resta com’è finché non confermi.'),
        note === null ? null : h('p', { class: 'exp-warn exp-open-note', role: 'alert' }, note),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Annulla'), pickButton('Scegli il PDF…', true)),
      );
      (box.querySelector('[data-role=pick-pdf]') as HTMLElement | null)?.focus();
    }

    // ---- 2) il PDF e' stato scelto ----
    async function onPicked(file: File): Promise<void> {
      busy = true;
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, title),
        h('p', { class: 'dialog-msg', role: 'status', 'aria-live': 'polite' }, `Controllo di ${file.name}…`),
        h('progress', { class: 'exp-progress', 'aria-label': 'Controllo del PDF' }),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', disabled: true }, 'Annulla')),
      );
      let checked: CheckedPdf;
      try {
        checked = await input.check(file);
      } catch (e) {
        busy = false;
        renderPdfError(e instanceof Error ? e.message : String(e));
        return;
      }
      busy = false;
      pending = checked;
      const o = checked.outcome;
      if (o.kind === 'same') {
        await apply(checked, o.message);
        return;
      }
      if (o.kind === 'confirm') {
        show(
          h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Non è lo stesso file'),
          h('p', { class: 'dialog-msg', role: 'alert' }, o.message),
          h('div', { class: 'exp-summary' }, kv('PDF scelto', `${checked.name} (${fmtSize(checked.size)})`), kv('PDF atteso', input.pdfName)),
          h('p', { class: 'hint' }, 'Con Annulla il documento attuale resta com’era.'),
          h(
            'div',
            { class: 'dialog-actions' },
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                'data-role': 'cancel',
                onclick: () => {
                  pending?.discard();
                  pending = null;
                  close();
                },
              },
              'Annulla',
            ),
            h('button', { class: 'btn primary', type: 'button', 'data-role': 'proceed', onclick: () => void apply(checked, 'Progetto aperto (PDF diverso, stessa geometria delle pagine).') }, 'Procedi'),
          ),
        );
        (box.querySelector('[data-role=cancel]') as HTMLElement | null)?.focus();
        return;
      }
      // rifiutato: pagine o geometria diverse
      pending = null;
      checked.discard();
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'PDF non corrispondente'),
        h('p', { class: 'dialog-msg', role: 'alert' }, o.message),
        h('p', { class: 'hint' }, 'Il documento attuale non è stato toccato.'),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), pickButton('Scegli un altro PDF…', true)),
      );
    }

    async function apply(checked: CheckedPdf, message: string): Promise<void> {
      busy = true;
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, title),
        h('p', { class: 'dialog-msg', role: 'status', 'aria-live': 'polite' }, 'Apertura del progetto…'),
        h('progress', { class: 'exp-progress', 'aria-label': 'Apertura' }),
      );
      try {
        await checked.commit();
        pending = null;
        busy = false;
        input.onOpened(message);
        close();
      } catch (e) {
        pending = null;
        busy = false;
        checked.discard();
        renderPdfError(e instanceof Error ? e.message : String(e));
      }
    }

    function renderPdfError(message: string): void {
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'PDF non apribile'),
        h('p', { class: 'dialog-msg', role: 'alert' }, message),
        h('p', { class: 'hint' }, 'Il documento attuale non è stato toccato.'),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), pickButton('Scegli un altro PDF…', true)),
      );
    }

    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    renderSummary();
  });
}
