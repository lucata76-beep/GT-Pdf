// Pagina diagnostica di CP0: serve a misurare sul dispositivo reale cio' che nel PASSO 0 era NON VERIFICATO.
import { fmt } from '../geometry/numbers';
import { PIXEL_BUDGET, SCREEN_PIXEL_BUDGET, ptToMm } from '../geometry/pixels';
import { type OpenedPdf, closePdf, openPdf } from '../pdf/loader';
import { type Child, h } from '../ui/dom';
import { icon } from '../ui/icons';
import { PdfViewer, type ViewerStats } from '../ui/viewer';
import { type ProbeResult, type Tier, probeTier, savedResults, takeInterrupted, tiers } from './canvasProbe';
import { type Row, environmentRows, featureRows } from './env';
import { clearLog, errText, log, logText, onLog } from './log';
import { PDF_NAME, copyText, downloadFile, openBlob, shareFile, sleep } from './share';
import { makeDiagPdf } from './testPdf';

const nf = (n: number, d = 2): string => fmt(n, d); // numeri sempre con "." (decisione DECIMALE)
const mpx = (area: number): string => `${nf(area / 1e6, 2)} M px`;
const kb = (bytes: number): string => (bytes >= 1048576 ? `${nf(bytes / 1048576, 2)} MB` : `${nf(bytes / 1024, 1)} KB`);

function card(title: string, open: boolean, ...body: Child[]): HTMLDetailsElement {
  return h('details', { class: 'card', open }, h('summary', null, title), h('div', { class: 'card-body' }, ...body));
}

function dataList(rows: Row[]): HTMLDListElement {
  const dl = h('dl', { class: 'data' });
  for (const r of rows) {
    const value: Child = r.ok === undefined ? r.value : h('span', { class: r.ok ? 'yes' : 'no' }, r.value);
    dl.append(h('dt', null, r.label), h('dd', null, value));
  }
  return dl;
}

export function mountDiagPage(root: HTMLElement, back: () => void): void {
  // ---------- Testata ----------
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn', type: 'button', onclick: back }, icon('chevron-left'), 'App'),
    h('h1', null, 'GT-Pdf'),
    h('span', { class: 'tag' }, 'Diagnostica'),
    h('span', { class: 'build mono' }, __BUILD_ID__),
  );

  // ---------- Ambiente ----------
  const envCard = card(
    'Ambiente e funzioni del browser',
    false,
    dataList(environmentRows()),
    h('p', { class: 'hint' }, 'Funzioni rilevate a runtime. "no" non è un errore: indica cosa il browser non offre.'),
    dataList(featureRows()),
  );

  // ---------- PDF e viewer ----------
  let pdf: OpenedPdf | null = null;
  let pageNo = 1;

  const statsEl = h('pre', { class: 'stats mono' }, 'Nessun documento.');
  const showStats = (s: ViewerStats): void => {
    const lines: string[] = [];
    lines.push(`zoom: ${nf(s.zoom, 3)} px/pt (${nf(s.zoomOfFit * 100, 0)} % dell'adattamento) · DPR ${nf(s.dpr, 1)}`);
    if (s.render) {
      const r = s.render;
      lines.push(`render: ${r.w} x ${r.h} px = ${mpx(r.w * r.h)} (${nf(r.scale, 3)} px/pt) · ${nf(r.ms, 0)} ms`);
      if (r.clamped) lines.push(`ATTENZIONE: tetto a schermo di ${SCREEN_PIXEL_BUDGET} px raggiunto, l'immagine è sfocata a questo zoom.`);
    } else lines.push('render: in corso o nessuno');
    if (s.error) lines.push(`ERRORE render: ${s.error}`);
    lines.push(`puntatori: ${s.pointers} (max ${s.maxPointers}) · eventi gesto Safari: ${s.gestureEvents} · zoom pagina: ${s.pageZoom === null ? 'n/d' : nf(s.pageZoom, 2)}`);
    statsEl.textContent = lines.join('\n');
  };
  const viewer = new PdfViewer(showStats, log);

  const infoEl = h('div');
  const pageLabel = h('span', { class: 'num', style: 'min-width:6rem;text-align:center' }, '-');
  const prevBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Pagina precedente', disabled: true }, icon('chevron-left'));
  const nextBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Pagina successiva', disabled: true }, icon('chevron-right'));

  const showPage = async (n: number): Promise<void> => {
    if (!pdf) return;
    pageNo = Math.min(Math.max(1, n), pdf.pages.length);
    pageLabel.textContent = `${pageNo} / ${pdf.pages.length}`;
    prevBtn.disabled = pageNo <= 1;
    nextBtn.disabled = pageNo >= pdf.pages.length;
    try {
      await viewer.setPage(await pdf.doc.getPage(pageNo));
    } catch (e) {
      log(`Pagina ${pageNo}: ${errText(e)}`, 'err');
    }
  };
  prevBtn.addEventListener('click', () => void showPage(pageNo - 1));
  nextBtn.addEventListener('click', () => void showPage(pageNo + 1));

  const loadPdf = async (name: string, bytes: Uint8Array): Promise<void> => {
    log(`Apertura "${name}" (${kb(bytes.length)})`);
    try {
      const next = await openPdf(name, bytes);
      const prev = pdf;
      pdf = next;
      if (prev) await closePdf(prev);
      const rows: Row[] = [
        { label: 'File', value: name },
        { label: 'Dimensione', value: kb(bytes.length) },
        { label: 'Pagine', value: String(next.pages.length) },
        { label: 'Apertura', value: `${nf(next.openMs, 0)} ms` },
      ];
      for (const p of next.pages.slice(0, 12)) {
        rows.push({
          label: `Pagina ${p.index}`,
          value: `${nf(p.widthPt, 1)} x ${nf(p.heightPt, 1)} pt = ${nf(ptToMm(p.widthPt), 1)} x ${nf(ptToMm(p.heightPt), 1)} mm · Rotate ${p.rotate} · vista [${p.view.map((v) => nf(v, 1)).join(' ')}] · userUnit ${p.userUnit}`,
        });
      }
      if (next.pages.length > 12) rows.push({ label: '...', value: `altre ${next.pages.length - 12} pagine non elencate` });
      infoEl.replaceChildren(dataList(rows));
      log(`Aperto: ${next.pages.length} pagine in ${nf(next.openMs, 0)} ms`, 'ok');
      await showPage(1);
    } catch (e) {
      log(`Apertura fallita: ${errText(e)}`, 'err');
      infoEl.replaceChildren(h('div', { class: 'notice warn' }, `Apertura fallita: ${errText(e)}`));
    }
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    onchange: async (ev: Event) => {
      const input = ev.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = ''; // permette di riaprire lo stesso file
      if (!f) return;
      await loadPdf(f.name, new Uint8Array(await f.arrayBuffer()));
    },
  });
  const openBtn = h('label', { class: 'btn primary file-btn' }, icon('folder-open'), 'Apri PDF…', fileInput);

  const samples = h('div', { class: 'row' });
  void fetch(new URL('test-pdfs/index.json', document.baseURI))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ file: string; titolo: string; note: string }[]>;
    })
    .then((list) => {
      for (const s of list) {
        samples.append(
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              title: s.note,
              onclick: async () => {
                try {
                  const r = await fetch(new URL(`test-pdfs/${s.file}`, document.baseURI));
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  await loadPdf(s.file, new Uint8Array(await r.arrayBuffer()));
                } catch (e) {
                  log(`Caricamento di ${s.file}: ${errText(e)}`, 'err');
                }
              },
            },
            s.titolo,
          ),
        );
      }
    })
    .catch((e) => samples.append(h('span', { class: 'hint' }, `Elenco PDF di prova non disponibile: ${errText(e)}`)));

  const zoomOut = h('button', { class: 'btn', type: 'button', 'aria-label': 'Riduci zoom', onclick: () => viewer.zoomBy(1 / 1.5) }, icon('zoom-out'));
  const zoomIn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Aumenta zoom', onclick: () => viewer.zoomBy(1.5) }, icon('zoom-in'));
  const fitBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Adatta alla pagina', onclick: () => viewer.fit() }, icon('maximize'), 'Adatta');

  const pdfCard = card(
    'PDF e visualizzazione',
    true,
    h('div', { class: 'row' }, openBtn),
    h('p', { class: 'hint' }, 'Oppure un PDF di prova (fittizio, incluso nell’app):'),
    samples,
    infoEl,
    h('div', { class: 'row' }, prevBtn, pageLabel, nextBtn, zoomOut, zoomIn, fitBtn),
    viewer.el,
    statsEl,
    h('p', { class: 'hint' }, 'Un dito sposta, due dita fanno pinch. Durante il pinch "zoom pagina" deve restare 1,00 e la pagina non deve ingrandirsi.'),
  );

  // ---------- Prove del canvas ----------
  const tierEls = new Map<string, { result: HTMLElement; btn: HTMLButtonElement }>();
  const describe = (r: ProbeResult): string => {
    const when = new Date(r.at).toLocaleTimeString('it-IT');
    if (r.ok) return `RIUSCITA · ${nf(r.ms / 1000, 2)} s · JPEG ${kb(r.jpegBytes ?? 0)} in ${nf((r.jpegMs ?? 0) / 1000, 2)} s · ${when}`;
    return `FALLITA alla fase "${r.stage}": ${r.error ?? '?'} · ${when}`;
  };
  const showResult = (t: Tier, r: ProbeResult): void => {
    const el = tierEls.get(t.id);
    if (!el) return;
    el.result.textContent = describe(r);
    el.result.className = `result ${r.ok ? 'yes' : 'no'}`;
  };
  let busy = false;
  const runTier = async (t: Tier): Promise<ProbeResult> => {
    const el = tierEls.get(t.id);
    if (el) el.result.textContent = 'in corso…';
    log(`Prova canvas ${t.label}: ${t.w} x ${t.h} = ${mpx(t.w * t.h)}`);
    const r = await probeTier(t);
    log(`Prova canvas ${t.label}: ${describe(r)}`, r.ok ? 'ok' : 'err');
    showResult(t, r);
    return r;
  };
  const allTiers = tiers();
  const saved = savedResults();
  const tierList = h('div');
  for (const t of allTiers) {
    const result = h('div', { class: 'result' }, 'non provata');
    const btn = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          if (busy) return;
          busy = true;
          try {
            await runTier(t);
          } finally {
            busy = false;
          }
        },
      },
      icon('play'),
      'Prova',
    );
    tierEls.set(t.id, { result, btn });
    tierList.append(
      h(
        'div',
        { class: 'tier' },
        h('div', null, h('div', { class: 'label' }, t.label), h('div', { class: 'size num' }, `${t.w} x ${t.h} = ${mpx(t.w * t.h)} · ~${nf((t.w * t.h * 4) / 1048576, 0)} MB di memoria`)),
        btn,
        result,
      ),
    );
    const prev = saved[t.id];
    if (prev) {
      result.textContent = `(salvata) ${describe(prev)}`;
      result.className = `result ${prev.ok ? 'yes' : 'no'}`;
    }
  }
  const interrupted = takeInterrupted();
  const interruptedNote = interrupted
    ? h('div', { class: 'notice warn' }, `La prova "${interrupted}" non è terminata: la pagina è stata chiusa o ricaricata dal sistema (probabile limite di memoria).`)
    : null;
  if (interrupted) log(`Prova canvas "${interrupted}" interrotta dal sistema nella sessione precedente`, 'err');

  const seqBtn = h(
    'button',
    {
      class: 'btn primary',
      type: 'button',
      onclick: async () => {
        if (busy) return;
        if (!confirm('La sequenza alloca canvas sempre più grandi fino al primo errore. Safari potrebbe ricaricare la pagina. Procedere?')) return;
        busy = true;
        try {
          for (const t of allTiers) {
            const r = await runTier(t);
            if (!r.ok) break;
          }
        } finally {
          busy = false;
        }
      },
    },
    icon('play'),
    'Prova in sequenza fino al primo errore',
  );

  const canvasCard = card(
    'Limiti del canvas',
    false,
    h('div', { class: 'notice' }, `Tetti dell'app: ${PIXEL_BUDGET} px per l'esportazione (decisione 4 = A, misurato su iPhone in CP0), ${SCREEN_PIXEL_BUDGET} px per il canvas a schermo. Ogni prova alloca un canvas, disegna, rilegge un pixel e codifica in JPEG. Prove grandi possono far ricaricare la pagina: in quel caso il risultato viene segnalato al riavvio.`),
    interruptedNote,
    tierList,
    h('div', { class: 'row' }, seqBtn),
  );

  // ---------- Condivisione e scarico ----------
  let diagPdf: Uint8Array | null = null;
  const shareStatus = h('p', { class: 'hint' }, 'Preparazione del PDF di prova…');
  const delaySel = h(
    'select',
    { class: 'field', 'aria-label': 'Attesa prima della condivisione' },
    ...[0, 1000, 3000, 6000].map((ms) => h('option', { value: ms, selected: ms === 3000 }, ms === 0 ? 'nessuna attesa' : `attesa ${ms / 1000} s`)),
  );
  const need = (fn: (b: Uint8Array) => void | Promise<void>) => async (): Promise<void> => {
    if (diagPdf) await fn(diagPdf);
  };
  const shareBtns = [
    h('button', { class: 'btn primary', type: 'button', onclick: need((b) => shareFile(b, 'Condividi PDF di prova (immediato)')) }, icon('share'), 'Condividi PDF di prova'),
    h('button', { class: 'btn', type: 'button', onclick: need(async (b) => {
      const ms = Number((delaySel as HTMLSelectElement).value);
      log(`Condividi PDF di prova dopo attesa: attendo ${ms} ms poi chiamo share()`);
      await sleep(ms);
      await shareFile(b, `Condividi PDF di prova (dopo ${ms} ms)`);
    }) }, icon('share'), 'Condividi PDF di prova dopo attesa'),
    h('button', { class: 'btn', type: 'button', onclick: need((b) => downloadFile(b, 'application/pdf', 'Scarica PDF di prova (application/pdf)')) }, icon('download'), 'Scarica PDF di prova (application/pdf)'),
    h('button', { class: 'btn', type: 'button', onclick: need((b) => downloadFile(b, 'application/octet-stream', 'Scarica PDF di prova (octet-stream)')) }, icon('download'), 'Scarica PDF di prova (octet-stream)'),
    h('button', { class: 'btn', type: 'button', onclick: need((b) => openBlob(b, 'Apri PDF di prova in scheda')) }, icon('file-up'), 'Apri PDF di prova in nuova scheda'),
  ];
  for (const b of shareBtns) b.disabled = true;
  void (async () => {
    try {
      const t0 = performance.now();
      diagPdf = await makeDiagPdf();
      log(`PDF di prova generato con @cantoo/pdf-lib: ${kb(diagPdf.length)} in ${nf(performance.now() - t0, 0)} ms`, 'ok');
      shareStatus.textContent = `PDF di prova pronto (${kb(diagPdf.length)}, nome ${PDF_NAME}). Provare ogni pulsante e annotare cosa succede.`;
      for (const b of shareBtns) b.disabled = false;
    } catch (e) {
      log(`Generazione del PDF di prova fallita: ${errText(e)}`, 'err');
      shareStatus.textContent = `Generazione fallita: ${errText(e)}`;
    }
  })();

  const shareCard = card(
    'Condivisione e scarico',
    false,
    h('div', { class: 'notice' }, 'Questi pulsanti usano un PDF di prova generato dalla pagina (una pagina A4 con testo fittizio), NON il documento aperto nell’app.'),
    shareStatus,
    h('div', { class: 'row grow' }, shareBtns[0] as Node),
    h('div', { class: 'row grow' }, delaySel, shareBtns[1] as Node),
    h('div', { class: 'row grow' }, shareBtns[2] as Node, shareBtns[3] as Node),
    h('div', { class: 'row grow' }, shareBtns[4] as Node),
    h('p', { class: 'hint' }, 'Ogni esito (anche l’annullamento) finisce nel registro. Dopo "Condividi PDF di prova" scegliere "Salva su File" e poi riaprire il file da File per verificarlo.'),
  );

  // ---------- Registro ----------
  const logEl = h('textarea', { class: 'log', readonly: true, rows: 12, 'aria-label': 'Registro eventi', spellcheck: 'false' });
  const refreshLog = (): void => {
    logEl.value = logText();
    logEl.scrollTop = logEl.scrollHeight;
  };
  onLog(refreshLog);
  const copyBtn = h(
    'button',
    {
      class: 'btn primary',
      type: 'button',
      onclick: async () => {
        const text = `GT-Pdf ${__BUILD_ID__}\n${navigator.userAgent}\n\n${logText()}`;
        if (await copyText(text)) log('Registro copiato negli appunti', 'ok');
        else {
          logEl.focus();
          logEl.select();
          log('Copia automatica non riuscita: testo selezionato, usare Copia dal menu di iOS', 'err');
        }
      },
    },
    icon('copy'),
    'Copia registro',
  );
  const logCard = card(
    'Registro',
    true,
    h('div', { class: 'row' }, copyBtn, h('button', { class: 'btn', type: 'button', onclick: clearLog }, 'Cancella')),
    logEl,
  );

  root.replaceChildren(topbar, h('main', null, pdfCard, canvasCard, shareCard, envCard, logCard));
  log(`Avvio GT-Pdf ${__BUILD_ID__} (diagnostica)`);
  log(`User agent: ${navigator.userAgent}`);
  log(`DPR ${window.devicePixelRatio}, schermo ${screen.width}x${screen.height}, finestra ${window.innerWidth}x${window.innerHeight}`);
}
