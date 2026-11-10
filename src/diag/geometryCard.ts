// Scheda "Geometria PDF" della pagina Diagnostica (V3.0, CP7a): misura sul PDF aperto in questa pagina (non nell'editor) quanta geometria vettoriale contiene ciascuna
// pagina e come e' scritta (tratti, cubiche, cerchi, livelli, tempi). NIENTE snap, niente uso nell'editor o nel visore: serve a decidere V3.1 con i numeri dei PDF reali.
// La misura NON parte da sola: si preme "Misura questa pagina" o "Misura tutte le pagine". "Copia misura" non contiene il nome del file, testi ne' metadati del documento.
import type { OpenedPdf } from '../pdf/loader';
import { type DocLayers, MAX_PAGES, type PageMeasure, measureLines, measurePage, measureText, readDocLayers, summaryRow } from '../pdf/geometryMeasure';
import { type Child, h } from '../ui/dom';
import { errText, log } from './log';
import { copyText } from './share';

export interface GeometryCardHost {
  /** Il PDF aperto nella pagina Diagnostica (null se nessuno). */
  pdf(): OpenedPdf | null;
  /** La pagina mostrata dal visore (da 1). */
  pageNo(): number;
}

export interface GeometryCard {
  el: HTMLElement;
  /** Da chiamare quando si apre un altro PDF: i numeri letti appartengono al documento di prima. */
  reset(): void;
}

interface Results {
  pdf: OpenedPdf;
  layers: DocLayers | null;
  measures: Map<number, PageMeasure>;
  failures: Map<number, string>;
  /** Pagine non misurate perche' oltre MAX_PAGES. */
  skipped: number;
  selected: number;
}

/** Lascia al browser il tempo di mostrare "in corso" prima di un lavoro lungo (rAF puo' non partire in una scheda in secondo piano: ripiego a tempo). */
function paint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const end = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(end, 120);
    requestAnimationFrame(() => setTimeout(end, 0));
  });
}

export function geometryCard(card: (title: string, open: boolean, ...body: Child[]) => HTMLElement, host: GeometryCardHost): GeometryCard {
  let results: Results | null = null;
  let busy = false;
  let cancel = false;
  let cancelable = false;

  const status = h('p', { class: 'hint geo-status', role: 'status' }, 'Nessun documento: aprire un PDF con "Apri PDF…" qui sopra, poi premere "Misura questa pagina".');
  const warn = h('div', { class: 'notice warn geo-warn', role: 'alert', hidden: true });
  const summary = h('pre', { class: 'stats mono geo-summary', hidden: true });
  const pickerLabel = h('label', { class: 'geo-picker-label', hidden: true }, 'Dettaglio della pagina ');
  const picker = h('select', { class: 'field geo-picker', 'aria-label': 'Pagina di cui mostrare il dettaglio' }) as HTMLSelectElement;
  pickerLabel.append(picker);
  const detail = h('pre', { class: 'stats mono geo-detail', hidden: true });
  const fallback = h('textarea', { class: 'log geo-fallback', readonly: true, rows: 8, 'aria-label': 'Testo della misura da copiare', spellcheck: 'false', hidden: true }) as HTMLTextAreaElement;

  const onePage = h('button', { class: 'btn primary', type: 'button' }, 'Misura questa pagina') as HTMLButtonElement;
  const allPages = h('button', { class: 'btn', type: 'button' }, 'Misura tutte le pagine') as HTMLButtonElement;
  const stop = h('button', { class: 'btn', type: 'button', hidden: true }, 'Interrompi') as HTMLButtonElement;
  const copy = h('button', { class: 'btn', type: 'button', disabled: true }, 'Copia misura') as HTMLButtonElement;

  const showWarn = (text: string | null): void => {
    warn.hidden = text === null;
    warn.textContent = text ?? '';
  };
  const setBusy = (on: boolean): void => {
    busy = on;
    onePage.disabled = on;
    allPages.disabled = on;
    stop.hidden = !on || !cancelable;
  };

  const render = (): void => {
    if (!results || results.measures.size === 0) {
      summary.hidden = true;
      pickerLabel.hidden = true;
      detail.hidden = true;
      copy.disabled = true;
      return;
    }
    const r = results;
    const numbers = [...r.measures.keys()].sort((a, b) => a - b);
    if (!r.measures.has(r.selected)) r.selected = numbers[0]!;
    const many = r.measures.size > 1 || r.failures.size > 0;
    const rows: string[] = [];
    const all = [...new Set([...numbers, ...r.failures.keys()])].sort((a, b) => a - b);
    for (const n of all) {
      const m = r.measures.get(n);
      rows.push(m ? summaryRow(m) : `pagina ${n}: ERRORE: ${r.failures.get(n) ?? ''}`);
    }
    if (r.skipped > 0) rows.push(`non misurate: ${r.skipped} pagine oltre le prime ${MAX_PAGES}`);
    summary.textContent = rows.join('\n');
    summary.hidden = !many;
    picker.replaceChildren(...numbers.map((n) => h('option', { value: n, selected: n === r.selected }, `pagina ${n}`)));
    pickerLabel.hidden = numbers.length < 2;
    detail.textContent = measureLines(r.measures.get(r.selected)!, r.layers).join('\n');
    detail.hidden = false;
    copy.disabled = false;
  };
  picker.addEventListener('change', () => {
    if (!results) return;
    results.selected = Number(picker.value);
    render();
  });

  const fresh = (pdf: OpenedPdf): Results => {
    if (results && results.pdf === pdf) return results;
    return { pdf, layers: null, measures: new Map(), failures: new Map(), skipped: 0, selected: 1 };
  };

  /** Misura le pagine `from..to` (una alla volta, con un'attesa fra una e l'altra perche' la pagina resti usabile). */
  const run = async (from: number, to: number, shown: number, isAll: boolean): Promise<void> => {
    const pdf = host.pdf();
    if (!pdf) {
      showWarn('Nessun documento aperto: usare "Apri PDF…" nella scheda qui sopra.');
      return;
    }
    if (busy) return;
    showWarn(null);
    const t0 = performance.now();
    results = fresh(pdf);
    const r = results;
    r.selected = shown;
    cancel = false;
    cancelable = isAll && to > from;
    setBusy(true);
    try {
      status.textContent = 'Misura in corso…';
      await paint();
      r.layers = await readDocLayers(pdf.doc);
      let okCount = 0;
      for (let n = from; n <= to; n++) {
        if (cancel) {
          log(`Misura geometria interrotta alla pagina ${n} di ${pdf.pages.length}`, 'info');
          break;
        }
        if (host.pdf() !== pdf) {
          log('Misura geometria interrotta: e\' stato aperto un altro PDF', 'info');
          status.textContent = 'Misura interrotta: e\' stato aperto un altro PDF.';
          return;
        }
        if (isAll) status.textContent = `Misura in corso: pagina ${n} di ${to}…`;
        await paint();
        const res = await measurePage(pdf.doc, n, { release: isAll && n !== host.pageNo() });
        if (res.ok) {
          r.measures.set(n, res.measure);
          r.failures.delete(n);
          okCount++;
          const m = res.measure;
          log(`Misura geometria, pagina ${n} di ${pdf.pages.length}: ${m.pageClass}, percorsi ${m.stats.all.paths}, ${m.nLines + m.nCubics} segmenti dei candidati, ${Math.round(m.timings.firstMs + m.timings.extractMs)} ms${m.stats.truncated ? ', LIMITE DI SICUREZZA' : ''}`, m.stats.truncated ? 'err' : 'ok');
        } else {
          r.failures.set(n, res.reason);
          log(`Misura geometria, pagina ${n}: ${res.reason}`, 'err');
          showWarn(`Pagina ${n}: ${res.reason}`);
        }
        render();
      }
      if (isAll) r.skipped = to < pdf.pages.length ? pdf.pages.length - to : 0;
      render();
      const secs = (performance.now() - t0) / 1000;
      status.textContent = okCount > 0 ? `Misurate ${okCount} ${okCount === 1 ? 'pagina' : 'pagine'} in ${secs.toFixed(2)} s. Il dettaglio qui sotto si copia con "Copia misura".` : 'Nessuna pagina misurata (vedi l\'errore sopra e il registro).';
    } catch (e) {
      showWarn(`Misura fallita: ${errText(e)}`);
      log(`Misura geometria fallita: ${errText(e)}`, 'err');
      status.textContent = 'Misura fallita.';
    } finally {
      setBusy(false);
    }
  };

  onePage.addEventListener('click', () => {
    const n = host.pageNo();
    void run(n, n, n, false);
  });
  allPages.addEventListener('click', () => {
    const pdf = host.pdf();
    if (!pdf) {
      showWarn('Nessun documento aperto: usare "Apri PDF…" nella scheda qui sopra.');
      return;
    }
    void run(1, Math.min(pdf.pages.length, MAX_PAGES), host.pageNo(), true);
  });
  stop.addEventListener('click', () => {
    cancel = true;
  });
  copy.addEventListener('click', async () => {
    if (!results || results.measures.size === 0) return;
    if (host.pdf() !== results.pdf) {
      showWarn('Il PDF aperto e\' cambiato dopo la misura: misurare di nuovo.');
      return;
    }
    const sel = results.measures.get(results.selected);
    if (!sel) return;
    const numbers = [...results.measures.keys()].sort((a, b) => a - b);
    const text = measureText(__BUILD_ID__, numbers.map((n) => results!.measures.get(n)!), sel, results.layers);
    fallback.hidden = true;
    if (await copyText(text)) {
      log('Misura geometria copiata negli appunti', 'ok');
      status.textContent = 'Misura copiata negli appunti (senza il nome del file).';
    } else {
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      log('Misura geometria: copia automatica non riuscita, testo selezionato nell\'area qui sotto', 'err');
      status.textContent = 'Copia automatica non riuscita: il testo e\' selezionato nell\'area qui sotto, usare Copia dal menu.';
    }
  });

  const el = card(
    'Geometria PDF',
    true,
    h(
      'p',
      { class: 'hint' },
      'Misura, sul PDF aperto qui sopra, i tratti vettoriali di ogni pagina e come sono scritti (segmenti, curve, cerchi, livelli, tempi). Non parte da sola e non cambia nulla nell’editor. È una misura per decidere lo snap sulla geometria del PDF (V3).',
    ),
    h('div', { class: 'row' }, onePage, allPages, stop, copy),
    status,
    warn,
    summary,
    pickerLabel,
    detail,
    fallback,
    h(
      'p',
      { class: 'hint' },
      `“Copia misura” contiene versione dell’app, versione di PDF.js, pagina, Rotate, dimensioni e UserUnit e solo numeri: niente nome del file, testi, nomi dei livelli o metadati del documento. “Copia registro” invece include il nome del file. “Misura tutte le pagine” misura al massimo ${MAX_PAGES} pagine.`,
    ),
  );
  el.classList.add('geo-card');

  return {
    el,
    reset(): void {
      results = null;
      cancel = true;
      showWarn(null);
      fallback.hidden = true;
      status.textContent = 'Nuovo documento: premere "Misura questa pagina".';
      render();
    },
  };
}
