// Dialogo "Esporta PDF" (DESIGN.md, "Dialog Esporta PDF"). CP5a: solo "Copertura semplice"; "Appiattito" e' visibile ma disattivato (5b).
// Quattro stati: scelta (riepilogo, Annulla / Esporta) -> generazione (senza chiamare share) -> pronto (Condividi, Scarica) oppure errore.
// "Esporta" genera il PDF e basta: Condividi va chiamato da un tocco successivo, perche' su iPhone share() riesce solo subito dopo il
// gesto (CP0: dopo 6 s NotAllowedError). Alla chiusura si rilasciano il File e l'indirizzo del blob.
import { Download, type ShareOutcome, shareAvailability, shareFile } from '../export/deliver';
import { describeExportError } from '../export/errors';
import type { ExportWarning } from '../export/coverSimple';
import { fmt } from '../geometry/numbers';
import { h } from './dom';

export interface ExportRunResult {
  file: File;
  /** Pagine riscritte (con oggetti) e totale. */
  touchedPages: number;
  pageCount: number;
  objectCount: number;
  warnings: ExportWarning[];
  /** Tempo totale della generazione e del controllo, in ms. */
  ms: number;
  /** Esito del controllo del file generato (riaperto con PDF.js). */
  verifiedPages: number;
}

export interface ExportDialogInput {
  /** Nome del PDF aperto. */
  fileName: string;
  /** Nome del file che si ottiene (-quotato.pdf). */
  outName: string;
  pageCount: number;
  /** Oggetti e pagine che ne hanno, nella sessione. */
  objectCount: number;
  pagesWithObjects: number;
  /** Genera il PDF. Puo' lanciare (ExportError o altro): il dialogo mostra il messaggio e il lavoro resta intatto. */
  run(onProgress: (done: number, total: number) => void): Promise<ExportRunResult>;
}

export const fmtSize = (bytes: number): string => (bytes >= 1024 * 1024 ? `${fmt(bytes / (1024 * 1024), 2)} MB` : `${fmt(bytes / 1024, 1)} kB`);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Si risolve alla chiusura del dialogo. */
export function showExportDialog(input: ExportDialogInput): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    let busy = false;
    let download: Download | null = null;

    const close = (): void => {
      if (busy) return;
      document.removeEventListener('keydown', onKey, true);
      download?.release(); // rilascia il blob (e il File) alla chiusura
      download = null;
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

    const box = h('div', { class: 'dialog export-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exp-title' });
    const show = (...children: (Node | null)[]): void => box.replaceChildren(...children.filter((c): c is Node => c !== null));
    const backdrop = h('div', { class: 'dialog-backdrop' }, box);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });

    const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num exp-v' }, v));

    // ---- 1) scelta ----
    function renderChoose(): void {
      const simple = h(
        'label',
        { class: 'exp-mode exp-mode-on' },
        h('input', { type: 'radio', name: 'exp-mode', value: 'simple', checked: true, 'aria-describedby': 'exp-simple-d' }),
        h('span', { class: 'exp-mode-text' }, h('span', { class: 'exp-mode-name' }, 'Copertura semplice'), h('span', { id: 'exp-simple-d', class: 'exp-mode-desc' }, 'Il testo sotto le coperture resta nel file.')),
      );
      const flat = h(
        'label',
        { class: 'exp-mode exp-mode-off', title: 'Arriva nel passo 5b' },
        h('input', { type: 'radio', name: 'exp-mode', value: 'flat', disabled: true, 'aria-describedby': 'exp-flat-d' }),
        h(
          'span',
          { class: 'exp-mode-text' },
          h('span', { class: 'exp-mode-name' }, 'Appiattito', h('span', { class: 'exp-tag' }, '5b')),
          h('span', { id: 'exp-flat-d', class: 'exp-mode-desc' }, 'Le pagine diventano immagini: il testo sotto sparisce. Non ancora disponibile.'),
        ),
      );
      const exportBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => void generate() }, 'Esporta');
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Esporta PDF'),
        h('p', { class: 'dialog-msg' }, "Crea un nuovo PDF con i tuoi oggetti. Il file originale non viene modificato."),
        h('div', { class: 'exp-modes', role: 'radiogroup', 'aria-label': 'Modalità di esportazione' }, simple, flat),
        h(
          'div',
          { class: 'exp-summary', 'aria-label': 'Riepilogo' },
          kv('File', input.fileName),
          kv('Nuovo file', input.outName),
          kv('Pagine', input.pagesWithObjects > 0 ? `${input.pageCount} (${input.pagesWithObjects} con oggetti)` : String(input.pageCount)),
          kv('Oggetti', String(input.objectCount)),
          kv('Modalità', 'Copertura semplice'),
        ),
        input.objectCount === 0 ? h('p', { class: 'hint' }, 'Non hai ancora disegnato nulla: il nuovo file avrà le stesse pagine dell’originale, senza aggiunte.') : null,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Annulla'), exportBtn),
      );
      exportBtn.focus();
    }

    // ---- 2) generazione ----
    async function generate(): Promise<void> {
      busy = true;
      const bar = h('progress', { class: 'exp-progress', max: 100, 'aria-label': 'Avanzamento' });
      const line = h('p', { class: 'dialog-msg', role: 'status', 'aria-live': 'polite' }, 'Preparazione del PDF…');
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Esporta PDF'),
        line,
        bar,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', disabled: true }, 'Annulla'), h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Esporta')),
      );
      try {
        const r = await input.run((done, total) => {
          line.textContent = `Scrittura delle pagine con oggetti: ${done} di ${total}…`;
          bar.value = total > 0 ? (done / total) * 100 : 100;
        });
        busy = false;
        download = new Download(r.file);
        renderDone(r);
      } catch (e) {
        busy = false;
        renderError(e);
      }
    }

    // ---- 3) pronto ----
    function renderDone(r: ExportRunResult): void {
      const status = h('p', { class: 'exp-status', role: 'status', 'aria-live': 'polite' });
      const avail = shareAvailability(r.file);
      const shareBtn = h('button', { class: 'btn primary', type: 'button', 'aria-describedby': avail.ok ? undefined : 'exp-share-note' }, 'Condividi');
      // Il gestore chiama share() subito, senza await prima: iOS consente la condivisione solo dentro il gesto.
      shareBtn.addEventListener('click', () => {
        shareBtn.disabled = true;
        void shareFile(r.file).then((o: ShareOutcome) => {
          shareBtn.disabled = false;
          status.textContent = o.message + (o.detail ? ` (${o.detail})` : '');
          status.dataset.state = o.status;
        });
      });
      const dlBtn = h('button', { class: 'btn', type: 'button' }, 'Scarica');
      dlBtn.addEventListener('click', () => {
        download?.start();
        status.textContent = `Scarico avviato: ${r.file.name}. Controlla "Download" (in Safari: icona dei download, poi File > Download).`;
        status.dataset.state = 'download';
      });
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'PDF pronto'),
        h(
          'div',
          { class: 'exp-summary' },
          kv('File', r.file.name),
          kv('Dimensione', fmtSize(r.file.size)),
          kv('Pagine', `${r.pageCount} (${plural(r.touchedPages, 'riscritta', 'riscritte')})`),
          kv('Oggetti', String(r.objectCount)),
          kv('Controllo', `riaperto: ${plural(r.verifiedPages, 'pagina', 'pagine')} come l'originale`),
          kv('Tempo', `${fmt(r.ms / 1000, 1)} s`),
        ),
        r.warnings.length > 0
          ? h('div', { class: 'exp-warn', role: 'note' }, h('p', { class: 'exp-warn-h' }, plural(r.warnings.length, 'avviso', 'avvisi')), h('ul', null, ...r.warnings.map((w) => h('li', null, w.text))))
          : null,
        avail.ok ? null : h('p', { id: 'exp-share-note', class: 'exp-warn exp-share-note', role: 'note' }, avail.reason),
        status,
        h('div', { class: 'dialog-actions exp-done-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), dlBtn, shareBtn),
      );
      shareBtn.focus();
    }

    // ---- 4) errore ----
    function renderError(e: unknown): void {
      const d = describeExportError(e);
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, d.title),
        h('p', { class: 'dialog-msg', role: 'alert' }, d.message),
        h('p', { class: 'hint exp-detail num' }, d.detail),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), h('button', { class: 'btn primary', type: 'button', onclick: renderChoose }, 'Riprova')),
      );
      (box.querySelector('.btn.primary') as HTMLElement | null)?.focus();
    }

    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    renderChoose();
  });
}
