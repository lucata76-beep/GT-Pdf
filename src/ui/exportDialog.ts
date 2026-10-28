// Dialogo "Esporta PDF" (DESIGN.md, "Dialog Esporta PDF"). Due modalita': "Copertura semplice" (5a, predefinita) e "Appiattito" (5b: DPI 150/300/600
// e formato JPEG/PNG). Quattro stati: scelta (riepilogo, avvisi, Annulla / Esporta) -> generazione (senza chiamare share) -> pronto (Condividi,
// Scarica) oppure errore. "Esporta" genera il PDF e basta: Condividi va chiamato da un tocco successivo, perche' su iPhone share() riesce solo
// subito dopo il gesto (CP0: dopo 6 s NotAllowedError). Alla chiusura si rilasciano il File e l'indirizzo del blob.
// Nessuna stima di byte o di tempo: nel dialogo ci sono solo pixel (che si calcolano) e, a file generato, valori misurati.
import { Download, type ShareOutcome, shareAvailability, shareFile } from '../export/deliver';
import { describeExportError } from '../export/errors';
import type { ExportWarning } from '../export/coverSimple';
import { type Dpi, type ImageFormat, JPEG_QUALITY, type RasterPage, defaultDpi, fmtInt, pageLabel, planDpi } from '../export/flatPlan';
import { fmt } from '../geometry/numbers';
import { PIXEL_BUDGET } from '../geometry/pixels';
import { h } from './dom';

export type ExportChoice = { mode: 'simple' } | { mode: 'flat'; dpi: Dpi; format: ImageFormat };

export interface ExportProgress {
  /** Pagina in lavorazione tra quelle da scrivere (1 di `total`) e numero di pagina nel PDF. */
  done: number;
  total: number;
  page?: number;
  /** Solo "Appiattito": byte delle immagini gia' inserite (misurati). */
  imageBytes?: number;
}

export interface ExportRunResult {
  file: File;
  mode: 'simple' | 'flat';
  dpi?: Dpi;
  format?: ImageFormat;
  /** Pagine riscritte (con oggetti; in "Appiattito" sono quelle rasterizzate) e totale. */
  touchedPages: number;
  pageCount: number;
  objectCount: number;
  warnings: ExportWarning[];
  /** Tempo totale della generazione e del controllo, in ms. */
  ms: number;
  /** Esito del controllo del file generato (riaperto con PDF.js). */
  verifiedPages: number;
  /** Solo "Appiattito": somma dei byte delle immagini e vecchio contenuto tolto dal file (misurati). */
  imageBytes?: number;
  prunedObjects?: number;
  prunedBytes?: number;
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
  /** Le pagine con oggetti (le sole che "Appiattito" rasterizza) con le dimensioni reali del foglio mostrato. */
  rasterPages: readonly RasterPage[];
  /** Genera il PDF. Puo' lanciare (ExportError o altro): il dialogo mostra il messaggio e il lavoro resta intatto. */
  run(choice: ExportChoice, onProgress: (p: ExportProgress) => void): Promise<ExportRunResult>;
}

export const fmtSize = (bytes: number): string => (bytes >= 1024 * 1024 ? `${fmt(bytes / (1024 * 1024), 2)} MB` : `${fmt(bytes / 1024, 1)} kB`);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const FORMAT_NAME: Record<ImageFormat, string> = { jpeg: 'JPEG', png: 'PNG' };

/** Avvisi mostrati PRIMA di esportare in "Appiattito". */
export const FLAT_WARNINGS: readonly string[] = [
  'Nelle pagine appiattite il testo non è più selezionabile né ricercabile e i collegamenti spariscono.',
  "Annotazioni (note, timbri) e campi di modulo diventano parte dell'immagine, come li disegna PDF.js: i campi non restano compilabili. I collegamenti non si disegnano.",
  'Le pagine senza oggetti restano identiche.',
  'Le immagini restano in memoria fino alla fine: con molte pagine o DPI alti serve molta memoria e, se Safari ricarica la pagina, il lavoro non salvato va perso.',
];

/** Si risolve alla chiusura del dialogo. */
export function showExportDialog(input: ExportDialogInput): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    let busy = false;
    let download: Download | null = null;
    const plans = planDpi(input.rasterPages);
    let choice: { mode: 'simple' | 'flat'; dpi: Dpi; format: ImageFormat } = { mode: 'simple', dpi: defaultDpi(plans) ?? 150, format: 'jpeg' };

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
      const radio = (name: string, value: string, label: string, desc: string | null, opts: { checked: boolean; disabled?: boolean; reason?: string | null; onPick: () => void; cls?: string }): HTMLElement => {
        const el = h('input', { type: 'radio', name, value, checked: opts.checked, disabled: opts.disabled === true });
        el.addEventListener('change', () => {
          if (el.checked) opts.onPick();
        });
        return h(
          'label',
          { class: `${opts.cls ?? 'exp-opt'}${opts.disabled ? ' exp-opt-off' : ''}`, 'data-value': value },
          el,
          h('span', { class: 'exp-mode-text' }, h('span', { class: 'exp-mode-name' }, label), desc ? h('span', { class: 'exp-mode-desc' }, desc) : null, opts.reason ? h('span', { class: 'exp-opt-reason' }, opts.reason) : null),
        );
      };
      const modeCards = h('div', { class: 'exp-modes', role: 'radiogroup', 'aria-label': 'Modalità di esportazione' });
      const flatOpts = h('div', { class: 'exp-flat-opts' });
      const summary = h('div', { class: 'exp-summary', 'aria-label': 'Riepilogo' });
      const warnings = h('div', { class: 'exp-warn exp-flat-warn', role: 'note' });
      const exportBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => void generate() }, 'Esporta');

      const refresh = (): void => {
        const flat = choice.mode === 'flat';
        for (const [v, el] of [['simple', simpleCard], ['flat', flatCard]] as const) el.classList.toggle('exp-mode-on', choice.mode === v);
        flatOpts.hidden = !flat;
        warnings.hidden = !flat;
        const plan = plans.find((p) => p.dpi === choice.dpi);
        const noDpi = flat && plans.every((p) => !p.ok);
        // riepilogo
        const rows: HTMLElement[] = [kv('File', input.fileName), kv('Nuovo file', input.outName), kv('Pagine', input.pagesWithObjects > 0 ? `${input.pageCount} (${input.pagesWithObjects} con oggetti)` : String(input.pageCount)), kv('Oggetti', String(input.objectCount))];
        if (flat) {
          rows.push(kv('Pagine appiattite', `${input.rasterPages.length} di ${input.pageCount}`));
          if (plan?.largest) {
            const src = input.rasterPages.find((p) => p.page === plan.largest?.page);
            rows.push(kv('Pagina più grande', `${plan.largest.w} × ${plan.largest.h} px = ${fmtInt(plan.largest.area)} px${src ? ` (${pageLabel(src)})` : ''}`));
          }
          rows.push(kv('Modalità', `Appiattito, ${choice.dpi} dpi, ${FORMAT_NAME[choice.format]}`));
        } else rows.push(kv('Modalità', 'Copertura semplice'));
        summary.replaceChildren(...rows);
        warnings.replaceChildren(h('p', { class: 'exp-warn-h' }, 'Prima di esportare'), h('ul', null, ...FLAT_WARNINGS.map((w) => h('li', null, w))));
        exportBtn.disabled = noDpi;
        note.textContent = noDpi ? `Nessun DPI entra nel tetto di ${fmtInt(PIXEL_BUDGET)} px per la pagina più grande: usa "Copertura semplice".` : flat && input.rasterPages.length === 0 ? 'Non ci sono pagine con oggetti: nessuna pagina verrà appiattita.' : '';
        note.hidden = note.textContent === '';
      };
      const pick = (patch: Partial<typeof choice>): void => {
        choice = { ...choice, ...patch };
        refresh();
      };

      const simpleCard = radio('exp-mode', 'simple', 'Copertura semplice', 'Il testo sotto le coperture resta nel file.', { checked: choice.mode === 'simple', cls: 'exp-mode', onPick: () => pick({ mode: 'simple' }) });
      const flatCard = radio('exp-mode', 'flat', 'Appiattito', 'Le pagine diventano immagini: il testo sotto sparisce.', { checked: choice.mode === 'flat', cls: 'exp-mode', onPick: () => pick({ mode: 'flat' }) });
      modeCards.append(simpleCard, flatCard);

      const dpiGroup = h('div', { class: 'exp-opts', role: 'radiogroup', 'aria-label': 'Risoluzione' });
      for (const p of plans) dpiGroup.append(radio('exp-dpi', String(p.dpi), `${p.dpi} dpi`, null, { checked: choice.dpi === p.dpi, disabled: !p.ok, reason: p.reason, onPick: () => pick({ dpi: p.dpi }) }));
      const fmtGroup = h('div', { class: 'exp-opts', role: 'radiogroup', 'aria-label': 'Formato delle immagini' });
      fmtGroup.append(
        radio('exp-fmt', 'jpeg', 'JPEG', `Con perdita, qualità ${Math.round(JPEG_QUALITY * 100)}: file più piccolo.`, { checked: choice.format === 'jpeg', onPick: () => pick({ format: 'jpeg' }) }),
        radio('exp-fmt', 'png', 'PNG', 'Senza perdita: file più grande.', { checked: choice.format === 'png', onPick: () => pick({ format: 'png' }) }),
      );
      flatOpts.append(h('p', { class: 'exp-sub-h' }, 'Risoluzione'), dpiGroup, h('p', { class: 'exp-sub-h' }, 'Formato delle immagini'), fmtGroup);
      const note = h('p', { class: 'hint exp-note', role: 'status' });

      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Esporta PDF'),
        h('p', { class: 'dialog-msg' }, 'Crea un nuovo PDF con i tuoi oggetti. Il file originale non viene modificato.'),
        modeCards,
        flatOpts,
        summary,
        note,
        warnings,
        input.objectCount === 0 ? h('p', { class: 'hint' }, 'Non hai ancora disegnato nulla: il nuovo file avrà le stesse pagine dell’originale, senza aggiunte.') : null,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Annulla'), exportBtn),
      );
      refresh();
      exportBtn.focus();
    }

    // ---- 2) generazione ----
    async function generate(): Promise<void> {
      busy = true;
      const flat = choice.mode === 'flat';
      const bar = h('progress', { class: 'exp-progress', max: 100, 'aria-label': 'Avanzamento' });
      const line = h('p', { class: 'dialog-msg', role: 'status', 'aria-live': 'polite' }, 'Preparazione del PDF…');
      const detail = h('p', { class: 'hint exp-progress-detail num' });
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'Esporta PDF'),
        line,
        detail,
        bar,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', disabled: true }, 'Annulla'), h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Esporta')),
      );
      try {
        const r = await input.run(flat ? { mode: 'flat', dpi: choice.dpi, format: choice.format } : { mode: 'simple' }, (p) => {
          if (flat) {
            line.textContent = `Pagina ${p.done} di ${p.total}`;
            detail.textContent = `Pagina ${p.page ?? '?'} del PDF · ${choice.dpi} dpi · ${FORMAT_NAME[choice.format]} · immagini finora ${fmtSize(p.imageBytes ?? 0)}`;
            bar.value = p.total > 0 ? ((p.done - 1) / p.total) * 100 : 100;
          } else {
            line.textContent = `Scrittura delle pagine con oggetti: ${p.done} di ${p.total}…`;
            bar.value = p.total > 0 ? (p.done / p.total) * 100 : 100;
          }
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
      const flat = r.mode === 'flat';
      show(
        h('h2', { id: 'exp-title', class: 'dialog-title' }, 'PDF pronto'),
        h(
          'div',
          { class: 'exp-summary' },
          kv('File', r.file.name),
          kv('Dimensione', fmtSize(r.file.size)),
          kv('Modalità', flat ? `Appiattito, ${r.dpi} dpi, ${FORMAT_NAME[r.format ?? 'jpeg']}` : 'Copertura semplice'),
          kv('Pagine', `${r.pageCount} (${plural(r.touchedPages, flat ? 'appiattita' : 'riscritta', flat ? 'appiattite' : 'riscritte')})`),
          flat && r.imageBytes !== undefined ? kv('Immagini inserite', fmtSize(r.imageBytes)) : null,
          flat && r.prunedObjects !== undefined ? kv('Vecchio contenuto tolto', `${plural(r.prunedObjects, 'oggetto', 'oggetti')}, ${fmtSize(r.prunedBytes ?? 0)}`) : null,
          kv('Oggetti', String(r.objectCount)),
          kv('Controllo', `riaperto: ${plural(r.verifiedPages, 'pagina', 'pagine')} come l'originale`),
          kv('Tempo', `${fmt(r.ms / 1000, 1)} s`),
        ),
        r.warnings.length > 0
          ? h('div', { class: 'exp-warn exp-warnings', role: 'note' }, h('p', { class: 'exp-warn-h' }, plural(r.warnings.length, 'avviso', 'avvisi')), h('ul', null, ...r.warnings.map((w) => h('li', null, w.text))))
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
