// Guscio dell'app (CP1): barra con menu, palette, vista del documento, inspector, barra di stato.
// In CP1 non c'e' ancora nessuna funzione di editing: l'unico oggetto e' il "punto di prova" (tocchi successivi con la lente),
// non salvato ne' esportato. Serve a provare interfaccia, zoom, pinch e lente su iPhone.
import { ptToMm } from '../geometry/pixels';
import { type OpenedPdf, closePdf, openPdf } from '../pdf/loader';
import { showDialog } from '../ui/dialog';
import { type Child, h } from '../ui/dom';
import { type IconName, icon } from '../ui/icons';
import { type MenuEntry, menuButton } from '../ui/menu';
import { PdfViewer, type UserPoint, type ViewerMode } from '../ui/viewer';
import { UI_SIZES, loadUiSize, saveUiSize } from './uiSize';

// Percorsi relativi alla pagina: l'app sta sotto /GT-Pdf/ su GitHub Pages.
const assetUrl = (path: string): string => new URL(path, document.baseURI).href;
const nf = (n: number, d = 2): string => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const CSS_PX_PER_PT = 96 / 72; // 100 % = 96 px CSS per pollice; non e' la dimensione fisica sullo schermo

type ToolId = 'pan' | 'point';
interface Tool {
  id: string;
  label: string;
  icon: IconName;
  /** Checkpoint in cui la funzione arriva (strumenti non ancora attivi). */
  cp?: string;
  mode?: ViewerMode;
}
const TOOLS: Tool[] = [
  { id: 'pan', label: 'Sposta vista', icon: 'hand', mode: 'pan' },
  { id: 'point', label: 'Punto di prova', icon: 'crosshair', mode: 'point' },
  { id: 'line', label: 'Linea', icon: 'slash', cp: 'CP2' },
  { id: 'dim', label: 'Quota', icon: 'ruler', cp: 'CP3' },
  { id: 'text', label: 'Testo', icon: 'type', cp: 'CP3' },
  { id: 'cover', label: 'Copertura', icon: 'square', cp: 'CP4' },
];

export interface AppOptions {
  openDiagnostics: () => void;
}

export function mountApp(root: HTMLElement, opts: AppOptions): void {
  // ---------- Stato della sessione ----------
  let pdf: OpenedPdf | null = null;
  let pageNo = 1;
  const points = new Map<number, UserPoint[]>(); // per pagina, spazio utente PDF
  let tool: ToolId = 'pan';
  let uiSize = loadUiSize();
  let opening = false;

  const pagePoints = (): UserPoint[] => points.get(pageNo) ?? [];
  const pointCount = (): number => [...points.values()].reduce((n, l) => n + l.length, 0);
  const dirty = (): boolean => pointCount() > 0;

  // ---------- Vista ----------
  const statusMsg = h('span', { class: 'st-msg', role: 'status', 'aria-live': 'polite' });
  const say = (text: string): void => {
    statusMsg.textContent = text;
  };
  const viewer = new PdfViewer(
    () => undefined,
    (msg, level) => {
      if (level === 'err') say(msg);
    },
  );

  // ---------- Barra di stato ----------
  const stX = h('span', { class: 'num' }, '—');
  const stY = h('span', { class: 'num' }, '—');
  const stPage = h('span', { class: 'num st-page' }, '');
  const prevBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina precedente', disabled: true, onclick: () => void goTo(pageNo - 1) }, icon('chevron-left'));
  const nextBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina successiva', disabled: true, onclick: () => void goTo(pageNo + 1) }, icon('chevron-right'));
  const pager = h('div', { class: 'st-pager' }, prevBtn, stPage, nextBtn);
  const statusbar = h(
    'footer',
    { class: 'statusbar' },
    h('span', { class: 'st-coord' }, h('span', { class: 'lbl' }, 'X:'), stX, h('span', { class: 'unit' }, 'mm'), h('span', { class: 'lbl' }, 'Y:'), stY, h('span', { class: 'unit' }, 'mm')),
    h('span', { class: 'st-scale' }, h('span', { class: 'lbl' }, 'SCALA:'), 'non calibrata'),
    statusMsg,
    pager,
  );
  const setCursor = (p: { x: number; y: number } | null): void => {
    if (!p) {
      stX.textContent = '—';
      stY.textContent = '—';
      return;
    }
    stX.textContent = nf(ptToMm(p.x));
    stY.textContent = nf(ptToMm(viewer.sheetSize.h - p.y)); // Y verso l'alto dal bordo inferiore della pagina mostrata
  };

  // ---------- Barra superiore ----------
  const docName = h('span', { class: 'doc-name', title: '' }, 'Nessun documento');
  const zoomLabel = h('button', { class: 'zoom-val num', type: 'button', 'aria-label': 'Adatta alla pagina', title: 'Adatta alla pagina', onclick: () => viewer.fit() }, '—');
  const mkZoomBtn = (name: IconName, label: string, fn: () => void): HTMLButtonElement =>
    h('button', { class: 'btn bar-btn', type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name));
  const zoomOutBtn = mkZoomBtn('minus', 'Riduci zoom del documento', () => viewer.zoomBy(1 / 1.25));
  const zoomInBtn = mkZoomBtn('plus', 'Aumenta zoom del documento', () => viewer.zoomBy(1.25));

  const sizeDown = h('button', { class: 'btn bar-btn size-btn', type: 'button', 'aria-label': 'Interfaccia più piccola (A-)', title: 'Interfaccia più piccola', onclick: () => setUiSize(uiSize - 1) }, 'A-');
  const sizeUp = h('button', { class: 'btn bar-btn size-btn', type: 'button', 'aria-label': 'Interfaccia più grande (A+)', title: 'Interfaccia più grande', onclick: () => setUiSize(uiSize + 1) }, 'A+');
  const setUiSize = (i: number): void => {
    uiSize = Math.min(UI_SIZES.length - 1, Math.max(0, i));
    document.documentElement.style.fontSize = `${UI_SIZES[uiSize]}px`;
    saveUiSize(uiSize);
    sizeDown.disabled = uiSize <= 0;
    sizeUp.disabled = uiSize >= UI_SIZES.length - 1;
  };
  setUiSize(uiSize);

  const inspectorBtn = h('button', { class: 'btn bar-btn insp-toggle', type: 'button', 'aria-label': 'Mostra o nascondi le proprietà', 'aria-expanded': 'false', onclick: () => toggleInspector() }, icon('panel-right'));

  const fileMenu = (): MenuEntry[] => [
    { label: 'Nuovo', onSelect: () => void newSession() },
    { label: 'Apri…', onSelect: () => void openFlow() },
    { label: 'Salva con nome…', hint: 'CP5', disabled: true },
    { label: 'Esporta PDF…', hint: 'CP5', disabled: true },
    { label: 'Chiudi', disabled: !pdf, onSelect: () => void closeFlow() },
    'separator',
    { label: 'Diagnostica', onSelect: opts.openDiagnostics },
  ];
  const editMenu = (): MenuEntry[] => [
    { label: 'Annulla', hint: 'CP2', disabled: true },
    { label: 'Ripeti', hint: 'CP2', disabled: true },
    'separator',
    { label: 'Seleziona / sposta', hint: 'CP4', disabled: true },
    { label: 'Copia', hint: 'V2', disabled: true },
    { label: 'Duplica', hint: 'V2', disabled: true },
    { label: 'Cancella punti di prova', disabled: pointCount() === 0, onSelect: () => void clearPoints() },
  ];
  const insertMenu = (): MenuEntry[] => [
    { label: 'Punto di prova', disabled: !pdf, onSelect: () => selectTool('point') },
    'separator',
    { label: 'Linea', hint: 'CP2', disabled: true },
    { label: 'Retta', hint: 'CP2', disabled: true },
    { label: 'Testo', hint: 'CP3', disabled: true },
    { label: 'Quota', hint: 'CP3', disabled: true },
    { label: 'Copertura bianca', hint: 'CP4', disabled: true },
    { label: 'Cerchio, arco, raccordo', hint: 'V2', disabled: true },
  ];
  const zoomMenu = (): MenuEntry[] => [
    { label: 'Zoom avanti', disabled: !pdf, onSelect: () => viewer.zoomBy(1.25) },
    { label: 'Zoom indietro', disabled: !pdf, onSelect: () => viewer.zoomBy(1 / 1.25) },
    { label: 'Adatta alla pagina', disabled: !pdf, onSelect: () => viewer.fit() },
    { label: '100 %', disabled: !pdf, onSelect: () => viewer.zoomTo(CSS_PX_PER_PT) },
  ];

  const bar = h(
    'header',
    { class: 'bar' },
    h(
      'h1',
      { class: 'brand' },
      h('img', {
        class: 'brand-logo',
        src: assetUrl('brand/logo-bar-36.png'),
        srcset: `${assetUrl('brand/logo-bar-36.png')} 1x, ${assetUrl('brand/logo-bar-72.png')} 2x, ${assetUrl('brand/logo-bar-108.png')} 3x`,
        width: 36,
        height: 36,
        alt: '',
      }),
      h('span', { class: 'sr-only' }, 'GT-Pdf'),
    ),
    h('nav', { class: 'menus', 'aria-label': 'Menu' }, menuButton('File', fileMenu), menuButton('Modifica', editMenu), menuButton('Inserisci', insertMenu), menuButton('Zoom', zoomMenu)),
    docName,
    h('div', { class: 'bar-right' }, h('div', { class: 'size-ctl' }, sizeDown, sizeUp), h('div', { class: 'zoom-ctl' }, zoomOutBtn, zoomLabel, zoomInBtn), inspectorBtn),
  );

  // ---------- Palette ----------
  const toolBtns = new Map<string, HTMLButtonElement>();
  const palette = h('nav', { class: 'palette', 'aria-label': 'Strumenti' });
  for (const t of TOOLS) {
    const enabled = !t.cp;
    const b = h(
      'button',
      {
        class: 'tool',
        type: 'button',
        'aria-pressed': enabled && t.id === tool ? 'true' : 'false',
        disabled: !enabled,
        title: enabled ? t.label : `${t.label} (${t.cp})`,
        onclick: () => selectTool(t.id as ToolId),
      },
      icon(t.icon),
      h('span', { class: 'tool-label' }, t.label),
    );
    toolBtns.set(t.id, b);
    palette.append(b);
  }
  function selectTool(id: ToolId): void {
    if (!pdf && id === 'point') return;
    tool = id;
    for (const [tid, b] of toolBtns) b.setAttribute('aria-pressed', String(tid === id));
    viewer.setMode(TOOLS.find((t) => t.id === id)?.mode ?? 'pan');
    say(id === 'point' ? 'Punto di prova: tieni premuto per mirare con la lente, rilascia per inserire' : '');
  }

  // ---------- Inspector ----------
  const inspector = h('aside', { class: 'inspector', 'aria-label': 'Proprietà' });
  const section = (title: string, ...body: Child[]): HTMLElement => h('section', { class: 'insp-sec' }, h('h2', { class: 'insp-h' }, title), ...body);
  const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v));
  const renderInspector = (): void => {
    const secs: HTMLElement[] = [];
    if (pdf) {
      const info = pdf.pages[pageNo - 1];
      secs.push(
        section(
          'Documento',
          kv('File', pdf.name),
          kv('Pagine', String(pdf.pages.length)),
        ),
      );
      if (info) {
        secs.push(
          section(
            `Pagina ${pageNo}`,
            kv('Dimensione', `${nf(ptToMm(info.widthPt), 1)} x ${nf(ptToMm(info.heightPt), 1)} mm`),
            kv('Rotate', `${info.rotate}°`),
            kv('Unità utente', info.userUnit === 1 ? '1/72 in' : `UserUnit ${nf(info.userUnit, 3)}`),
          ),
        );
      }
      const list = pagePoints();
      const body: Child[] = [];
      if (list.length === 0) body.push(h('p', { class: 'hint' }, 'Nessun punto su questa pagina. Scegli "Punto di prova" e tocca il foglio.'));
      list.forEach((p, i) => {
        const s = viewer.userToSheet(p);
        const mm = s ? `${nf(ptToMm(s.x))} ; ${nf(ptToMm(viewer.sheetSize.h - s.y))}` : '—';
        body.push(h('div', { class: 'pt-row' }, h('span', { class: 'pt-n num' }, String(i + 1)), h('span', { class: 'num' }, mm), h('span', { class: 'unit' }, 'mm')));
      });
      if (pointCount() > 0) body.push(h('button', { class: 'btn', type: 'button', onclick: () => void clearPoints() }, icon('trash'), 'Cancella i punti'));
      secs.push(section('Punti di prova (CP1)', ...body));
    } else {
      secs.push(section('Documento', h('p', { class: 'hint' }, 'Nessun documento aperto.')));
    }
    secs.push(section('Proprietà oggetto', h('p', { class: 'hint' }, 'Colore, spessore e tipo di linea arrivano con CP2.')));
    inspector.replaceChildren(...secs);
  };
  function toggleInspector(): void {
    const open = !app.classList.contains('insp-open');
    app.classList.toggle('insp-open', open);
    inspectorBtn.setAttribute('aria-expanded', String(open));
  }

  // ---------- Area di lavoro ----------
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    class: 'file-hidden',
    tabindex: -1,
    'aria-hidden': 'true',
    onchange: () => {
      const f = fileInput.files?.[0];
      fileInput.value = ''; // permette di riaprire lo stesso file
      if (f) void loadFile(f);
    },
  });
  const emptyOpenBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => void openFlow() }, icon('folder-open'), 'Apri PDF…');
  const samples = h('div', { class: 'samples' });
  const emptyPanel = h(
    'div',
    { class: 'empty-panel' },
    h('img', { class: 'empty-logo', src: assetUrl('brand/logo-empty-384.png'), width: 160, height: 160, alt: 'GT-Pdf' }),
    h('p', { class: 'empty-title' }, 'Nessun documento aperto'),
    emptyOpenBtn,
    h('p', { class: 'hint' }, 'Il file resta su questo dispositivo: nulla viene inviato.'),
    h('details', { class: 'samples-box' }, h('summary', null, 'PDF di prova (fittizi)'), samples),
  );
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
                  await loadBytes(s.file, new Uint8Array(await r.arrayBuffer()));
                } catch (e) {
                  say(`Caricamento di ${s.file} fallito: ${e instanceof Error ? e.message : String(e)}`);
                }
              },
            },
            s.titolo,
          ),
        );
      }
    })
    .catch(() => samples.append(h('span', { class: 'hint' }, 'Elenco non disponibile.')));

  const floatZoom = h(
    'div',
    { class: 'float-zoom' },
    mkZoomBtn('plus', 'Aumenta zoom', () => viewer.zoomBy(1.25)),
    mkZoomBtn('minus', 'Riduci zoom', () => viewer.zoomBy(1 / 1.25)),
    mkZoomBtn('maximize', 'Adatta alla pagina', () => viewer.fit()),
  );
  const work = h('main', { class: 'work' }, viewer.el, emptyPanel, floatZoom);

  const app = h('div', { class: 'app' }, bar, palette, work, inspector, statusbar, fileInput);
  root.replaceChildren(app);

  // ---------- Collegamenti della vista ----------
  viewer.hooks.onCursor = setCursor;
  viewer.hooks.onView = ({ zoom }) => {
    zoomLabel.textContent = `${nf((zoom / CSS_PX_PER_PT) * 100, 0)}%`;
  };
  viewer.hooks.onReject = say;
  viewer.hooks.onPlace = (user) => {
    const list = points.get(pageNo) ?? [];
    list.push(user);
    points.set(pageNo, list);
    viewer.setPoints(list);
    renderInspector();
    say(`Punto ${list.length} inserito`);
  };

  // ---------- Flussi ----------
  /** Il selettore file va aperto dentro un gesto dell'utente: chiamare questa funzione in modo sincrono dal tocco. */
  const pickFile = (): void => fileInput.click();

  const updateChrome = (): void => {
    const has = pdf !== null;
    app.classList.toggle('has-doc', has);
    emptyPanel.hidden = has;
    docName.textContent = pdf ? pdf.name : 'Nessun documento';
    docName.title = pdf ? pdf.name : '';
    for (const b of [zoomOutBtn, zoomInBtn, zoomLabel]) b.disabled = !has;
    floatZoom.hidden = !has;
    const n = pdf?.pages.length ?? 0;
    pager.hidden = n < 2;
    stPage.textContent = n > 0 ? `${pageNo} / ${n}` : '';
    prevBtn.disabled = pageNo <= 1;
    nextBtn.disabled = pageNo >= n;
    toolBtns.get('point')?.toggleAttribute('disabled', !has);
    if (!has) zoomLabel.textContent = '—';
    renderInspector();
  };

  async function goTo(n: number): Promise<void> {
    if (!pdf) return;
    pageNo = Math.min(Math.max(1, n), pdf.pages.length);
    updateChrome();
    try {
      await viewer.setPage(await pdf.doc.getPage(pageNo));
      viewer.setPoints(pagePoints());
      renderInspector();
    } catch (e) {
      say(`Pagina ${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Azzera la sessione. Parte sincrona: la chiusura del documento prosegue in coda. */
  function resetSession(): void {
    const old = pdf;
    pdf = null;
    pageNo = 1;
    points.clear();
    selectTool('pan');
    void viewer.setPage(null);
    viewer.setPoints([]);
    updateChrome();
    say('');
    if (old) void closePdf(old).catch(() => undefined);
  }

  const confirmDiscard = (what: string, action: () => void): void => {
    if (!dirty()) {
      action();
      return;
    }
    void showDialog({
      title: 'Modifiche non salvate',
      message: `Ci sono ${pointCount()} punti di prova (CP1: il salvataggio non c'è ancora). ${what}`,
      confirmLabel: 'Procedi',
      cancelLabel: 'Annulla',
      onConfirm: action,
    });
  };

  /** Apri: il documento attuale resta finche' il nuovo non e' stato letto con successo. */
  function openFlow(): void {
    confirmDiscard('Aprire un altro PDF le scarta.', pickFile);
  }
  /** Nuovo: azzera la sessione e apre il selettore file (nessun foglio vuoto). */
  function newSession(): void {
    confirmDiscard('Nuovo le scarta.', () => {
      resetSession();
      pickFile();
    });
  }
  function closeFlow(): void {
    confirmDiscard('Chiudere il documento le scarta.', resetSession);
  }
  async function clearPoints(): Promise<void> {
    if (pointCount() === 0) return;
    const ok = await showDialog({ title: 'Cancella i punti', message: `Cancellare ${pointCount()} punti di prova?`, confirmLabel: 'Cancella', cancelLabel: 'Annulla' });
    if (!ok) return;
    points.clear();
    viewer.setPoints([]);
    renderInspector();
    say('Punti cancellati');
  }

  async function loadFile(f: File): Promise<void> {
    try {
      await loadBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      await showDialog({ title: 'Apertura non riuscita', message: `${f.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function loadBytes(name: string, bytes: Uint8Array): Promise<void> {
    if (opening) return;
    opening = true;
    say(`Apertura di ${name}…`);
    try {
      const next = await openPdf(name, bytes);
      const prev = pdf;
      pdf = next;
      pageNo = 1;
      points.clear();
      if (prev) void closePdf(prev).catch(() => undefined);
      await goTo(1);
      say(`${name}: ${next.pages.length} ${next.pages.length === 1 ? 'pagina' : 'pagine'}, aperto in ${nf(next.openMs, 0)} ms`);
      window.setTimeout(() => viewer.fit(), 0); // dopo il layout definitivo (barre, tastiera, rotazione)
    } catch (e) {
      say('');
      const msg = e instanceof Error ? e.message : String(e);
      const named = (e as { name?: string } | null)?.name;
      await showDialog({
        title: 'Apertura non riuscita',
        message: named === 'PasswordException' ? `${name}: il file richiede una password; i PDF protetti non sono previsti in questa versione.` : `${name}: ${msg}`,
      });
    } finally {
      opening = false;
    }
  }

  updateChrome();
  viewer.setMode('pan');
}
