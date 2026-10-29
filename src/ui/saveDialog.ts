// Dialogo "Salva con nome" (5c): il file progetto (.json). Stessa struttura di "Esporta PDF": scelta (riepilogo, Annulla / Salva) -> generazione (senza chiamare
// share) -> pronto (Condividi, Scarica) oppure errore. "Salva" genera il file e basta: Condividi va chiamato da un tocco successivo (su iPhone share() riesce
// solo subito dopo il gesto: CP0). Alla chiusura si rilasciano il File e l'indirizzo del blob.
// Nessuna stima di byte o di tempo: nel riepilogo ci sono solo conteggi; a file generato, valori misurati.
import { Download, type ShareOutcome, shareAvailability, shareFile } from '../export/deliver';
import { fmt } from '../geometry/numbers';
import { h } from './dom';
import { fmtSize } from './exportDialog';

export interface SaveRunResult {
  file: File;
  /** Versione del modello al momento in cui il file e' stato generato (per "salvato": vedi `SavedMark`). */
  version: number;
  pages: number;
  pagesWithObjects: number;
  objects: number;
  scales: number;
  /** SHA-256 scritto nel file; false = il browser non lo calcola e il file ha `sha256: null`. */
  hashed: boolean;
  /** Tempo per calcolare l'impronta (ms), se calcolata. */
  hashMs: number | null;
  /** Tempo totale (impronta, scrittura, rilettura), in ms. */
  ms: number;
}

export interface SaveDialogInput {
  pdfName: string;
  /** Nome del file che si ottiene (.json). */
  outName: string;
  pageCount: number;
  pagesWithObjects: number;
  objectCount: number;
  scaleCount: number;
  /** Il browser ha `crypto.subtle.digest`: se no lo si dice subito. */
  hashAvailable: boolean;
  /** Genera il file. Puo' lanciare: il dialogo mostra il messaggio e il lavoro resta intatto. */
  run(): Promise<SaveRunResult>;
  /** Il file e' stato consegnato per quanto l'app puo' sapere: share() si e' risolta ("shared") o e' partito lo Scarica. `version` e' quella generata. */
  onDelivered(version: number): void;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function showSaveDialog(input: SaveDialogInput): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    let busy = false;
    let download: Download | null = null;

    const close = (): void => {
      if (busy) return;
      document.removeEventListener('keydown', onKey, true);
      download?.release();
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
    const box = h('div', { class: 'dialog export-dialog save-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exp-title' });
    const show = (...children: (Node | null)[]): void => box.replaceChildren(...children.filter((c): c is Node => c !== null));
    const backdrop = h('div', { class: 'dialog-backdrop' }, box);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });
    const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num exp-v' }, v));

    // ---- 1) scelta ----
    function renderChoose(): void {
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Salva con nome'),
        h('p', { class: 'dialog-msg' }, 'Crea un file progetto (.json) con i tuoi oggetti e le scale. Non contiene il PDF: per riaprirlo servirà lo stesso PDF.'),
        h(
          'div',
          { class: 'exp-summary', 'aria-label': 'Riepilogo' },
          kv('PDF', input.pdfName),
          kv('Nuovo file', input.outName),
          kv('Pagine con oggetti', `${input.pagesWithObjects} di ${input.pageCount}`),
          kv('Oggetti', String(input.objectCount)),
          kv('Scale', String(input.scaleCount)),
        ),
        h('p', { class: 'hint' }, 'Non si salvano: cronologia annulla/ripeti, selezione, strumento attivo, zoom, dimensione dell’interfaccia e ORTO.'),
        input.hashAvailable ? null : h('p', { class: 'exp-warn exp-hash-warn', role: 'note' }, 'Questo browser non calcola l’impronta SHA-256 del PDF: il progetto si salva senza (sha256 = null) e alla riapertura non si potrà verificare che sia lo stesso PDF.'),
        input.objectCount === 0 && input.scaleCount === 0 ? h('p', { class: 'hint' }, 'Non hai ancora disegnato nulla né calibrato nessuna scala: il progetto sarà vuoto.') : null,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Annulla'), h('button', { class: 'btn primary', type: 'button', onclick: () => void generate() }, 'Salva')),
      );
      (box.querySelector('.btn.primary') as HTMLElement | null)?.focus();
    }

    // ---- 2) generazione ----
    async function generate(): Promise<void> {
      busy = true;
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Salva con nome'),
        h('p', { class: 'dialog-msg', role: 'status', 'aria-live': 'polite' }, 'Scrittura del progetto…'),
        h('progress', { class: 'exp-progress', 'aria-label': 'Avanzamento' }),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', disabled: true }, 'Annulla'), h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Salva')),
      );
      try {
        const r = await input.run();
        busy = false;
        download = new Download(r.file);
        renderDone(r);
      } catch (e) {
        busy = false;
        renderError(e);
      }
    }

    // ---- 3) pronto ----
    function renderDone(r: SaveRunResult): void {
      const status = h('p', { class: 'exp-status', role: 'status', 'aria-live': 'polite' });
      let delivered = false;
      const markDelivered = (): void => {
        if (delivered) return;
        delivered = true;
        input.onDelivered(r.version);
      };
      const avail = shareAvailability(r.file, undefined, 'un file .json');
      const shareBtn = h('button', { class: 'btn primary', type: 'button', 'aria-describedby': avail.ok ? undefined : 'exp-share-note' }, 'Condividi');
      // Il gestore chiama share() subito, senza await prima: iOS consente la condivisione solo dentro il gesto.
      shareBtn.addEventListener('click', () => {
        shareBtn.disabled = true;
        void shareFile(r.file, undefined, 'un file .json').then((o: ShareOutcome) => {
          shareBtn.disabled = false;
          status.textContent = o.message + (o.detail ? ` (${o.detail})` : '');
          status.dataset.state = o.status;
          if (o.status === 'shared') {
            markDelivered();
            status.textContent += ' Il progetto risulta salvato (l’app non può sapere se il file è davvero arrivato dove pensi).';
          }
        });
      });
      const dlBtn = h('button', { class: 'btn', type: 'button' }, 'Scarica');
      dlBtn.addEventListener('click', () => {
        download?.start();
        markDelivered();
        status.textContent = `Scarico avviato: ${r.file.name}. Controlla "Download" (in Safari: icona dei download, poi File > Download). Il progetto risulta salvato (l’app non può sapere se il download è riuscito).`;
        status.dataset.state = 'download';
      });
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Progetto pronto'),
        h(
          'div',
          { class: 'exp-summary' },
          kv('File', r.file.name),
          kv('Dimensione', fmtSize(r.file.size)),
          kv('Pagine', `${r.pages} (${plural(r.pagesWithObjects, 'con oggetti', 'con oggetti')})`),
          kv('Oggetti', String(r.objects)),
          kv('Scale', String(r.scales)),
          kv('Impronta SHA-256', r.hashed ? `calcolata${r.hashMs !== null ? ` in ${fmt(r.hashMs, 0)} ms` : ''}` : 'non disponibile (sha256 = null)'),
          kv('Controllo', 'riletto e validato con lo stesso codice della riapertura'),
          kv('Tempo', `${fmt(r.ms / 1000, 2)} s`),
        ),
        r.hashed ? null : h('p', { class: 'exp-warn exp-hash-warn', role: 'note' }, 'Questo browser non calcola l’impronta SHA-256: il progetto è stato salvato con sha256 = null e alla riapertura non si potrà verificare che sia lo stesso PDF.'),
        avail.ok ? null : h('p', { id: 'exp-share-note', class: 'exp-warn exp-share-note', role: 'note' }, avail.reason),
        status,
        h('div', { class: 'dialog-actions exp-done-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), dlBtn, shareBtn),
      );
      shareBtn.focus();
    }

    // ---- 4) errore ----
    function renderError(e: unknown): void {
      const msg = e instanceof Error ? e.message : String(e);
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Salvataggio non riuscito'),
        h('p', { class: 'dialog-msg', role: 'alert' }, `Non sono riuscito a scrivere il progetto. Il file originale e il tuo lavoro sono intatti: nulla è stato perso.`),
        h('p', { class: 'hint exp-detail num' }, msg.slice(0, 260)),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'), h('button', { class: 'btn primary', type: 'button', onclick: renderChoose }, 'Riprova')),
      );
      (box.querySelector('.btn.primary') as HTMLElement | null)?.focus();
    }

    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    renderChoose();
  });
}
