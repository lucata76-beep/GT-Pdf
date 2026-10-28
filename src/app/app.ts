// Guscio dell'app (CP4): barra con menu, palette, vista del documento, inspector, barra contestuale, tastierino, barra di stato.
// Strumenti: Sposta, Seleziona, Retta, Linea, Scala (calibrazione), Distanza, Testo, Quota, Copertura, Cancella. Oggetti e scala sono in memoria
// nella sessione (nessun salvataggio fino a CP5), nello spazio utente PDF. Ogni modifica passa da un comando (annulla/ripeti).
import { DIM_TYPES, type DimType, type DimensionDef, autoLabel, buildDimension, dimInfo, dimensionLabel } from '../geometry/dimension';
import { DIM_TEXT_MAX_LENGTH, TEXT_MAX_LENGTH, normalizeDimText, validateDimText, validateFreeText } from '../geometry/annotationText';
import { COVER_TYPES, type CoverKind, coverInfo, coverOnSheet, coverShapeOf } from '../geometry/cover';
import { distToShape, pickTop } from '../geometry/hit';
import { type Layout, type Shape, layoutDimension, layoutText } from '../geometry/layout';
import { measure, measureLines, measureMessage } from '../geometry/measure';
import { fmt, fmtTrim } from '../geometry/numbers';
import type { PageGeometry, SheetPoint, UserPoint } from '../geometry/page';
import { ptToMm } from '../geometry/pixels';
import { calibrate, realMm, scaleLabel } from '../geometry/scale';
import { type Command, History } from '../model/history';
import {
  AddObject,
  type CoverObject,
  type DimensionObject,
  DocumentModel,
  type LineObject,
  MoveObject,
  type ObjectProps,
  type PageObject,
  RemoveObject,
  SetProps,
  SetScale,
  type TextObject,
  drawOrder,
  isLine,
  objectLabel,
  objectNoun,
  patchedProps,
  propsEqual,
  propsOf,
} from '../model/model';
import { DEFAULT_STROKE, type Stroke } from '../model/stroke';
import { DEFAULT_TEXT_PT } from '../model/textStyle';
import { makePdfFile } from '../export/deliver';
import { exportFileName } from '../export/fileName';
import { type OpenedPdf, closePdf, openPdf } from '../pdf/loader';
import { askRealDistance } from '../ui/calibrateDialog';
import { showDialog } from '../ui/dialog';
import { showExportDialog } from '../ui/exportDialog';
import { type Child, h } from '../ui/dom';
import { type IconName, icon } from '../ui/icons';
import { Keypad } from '../ui/keypad';
import { type MenuEntry, menuButton } from '../ui/menu';
import type { DrawItem } from '../ui/overlay';
import { type StyleBinding, type StyleKind, createStyleControls, styleGlyph } from '../ui/styleControls';
import { PdfViewer, type ViewerMode } from '../ui/viewer';
import { Construction, type ConstructionTool } from './construction';
import { UI_SIZES, loadUiSize, saveUiSize } from './uiSize';

// Percorsi relativi alla pagina: l'app sta sotto /GT-Pdf/ su GitHub Pages.
const assetUrl = (path: string): string => new URL(path, document.baseURI).href;
const CSS_PX_PER_PT = 96 / 72; // 100 % = 96 px CSS per pollice; non e' la dimensione fisica sullo schermo

type ToolId = 'pan' | 'select' | ConstructionTool | 'erase';
interface Tool {
  id: string;
  label: string;
  icon: IconName;
  /** Checkpoint in cui la funzione arriva (strumenti non ancora attivi). */
  cp?: string;
  mode?: ViewerMode;
  needsDoc?: boolean;
}
const TOOLS: Tool[] = [
  { id: 'pan', label: 'Sposta vista', icon: 'hand', mode: 'pan' },
  { id: 'select', label: 'Seleziona', icon: 'mouse-pointer', mode: 'select', needsDoc: true },
  { id: 'segment', label: 'Retta', icon: 'slash', mode: 'pick', needsDoc: true },
  { id: 'polyline', label: 'Linea', icon: 'polyline', mode: 'pick', needsDoc: true },
  { id: 'calibrate', label: 'Scala', icon: 'scaling', mode: 'pick', needsDoc: true },
  { id: 'distance', label: 'Distanza', icon: 'ruler-dimension', mode: 'pick', needsDoc: true },
  { id: 'erase', label: 'Cancella', icon: 'eraser', mode: 'erase', needsDoc: true },
  { id: 'dim', label: 'Quota', icon: 'ruler', mode: 'pick', needsDoc: true },
  { id: 'text', label: 'Testo', icon: 'type', mode: 'pick', needsDoc: true },
  { id: 'cover', label: 'Copertura', icon: 'square', mode: 'pick', needsDoc: true },
];
const isConstructionTool = (id: ToolId): id is ConstructionTool => id !== 'pan' && id !== 'erase' && id !== 'select';
/** Desinenza del participio per i messaggi: "Testo cancellato", "Quota cancellata". */
const fem = (o: PageObject): 'o' | 'a' => (o.kind === 'text' ? 'o' : 'a');
/** Testo o quota in corso di scrittura con il tastierino: non e' ancora nel documento (annulla = si scarta). */
type Entry = { kind: 'text'; at: UserPoint; text: string } | { kind: 'dim'; def: DimensionDef; text: string; auto: string | null };

export interface AppOptions {
  openDiagnostics: () => void;
}

export function mountApp(root: HTMLElement, opts: AppOptions): void {
  // ---------- Stato della sessione ----------
  let pdf: OpenedPdf | null = null;
  let pageNo = 1;
  const model = new DocumentModel();
  const history = new History<DocumentModel>(model);
  let tool: ToolId = 'pan';
  let uiSize = loadUiSize();
  let opening = false;
  let ortho = false;
  /** Proprieta' dei NUOVI oggetti: tipo di linea, colore e spessore (anche delle quote), corpo del testo (testi e quote). */
  const stroke: Stroke = { ...DEFAULT_STROKE };
  let textPt = DEFAULT_TEXT_PT;
  /** Tipo della quota che si sta per disegnare. */
  let dimType: DimType = 'aligned';
  /** Forma della copertura che si sta per disegnare. */
  let coverKind: CoverKind = 'rect';
  /** Oggetto selezionato (id) nella pagina corrente, solo con lo strumento Seleziona. */
  let selected: number | null = null;
  /** Punto che verrebbe inserito adesso (mira o passaggio del mouse), nello spazio utente. */
  let currentAim: UserPoint | null = null;
  /** Testo o valore di quota in corso di scrittura con il tastierino (non e' ancora nel documento). */
  let entry: Entry | null = null;

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

  // ---------- Costruzione per punti ----------
  const construction = new Construction(
    { geometry: () => viewer.geometry, zoom: () => viewer.zoomValue, ortho: () => ortho },
    {
      line: (kind, points) => {
        const obj: LineObject = { id: model.newId(), kind, points: points.map((p) => ({ ...p })), stroke: { ...stroke } };
        history.exec(new AddObject(pageNo, obj));
        say(`${kind === 'segment' ? 'Retta' : 'Linea'} aggiunta: ${lengthText(points)}. Annulla per toglierla.`);
      },
      calibrate: (a, b) => void calibrateFlow(a, b),
      measure: (a, b) => {
        const g = viewer.geometry;
        if (g) say(measureMessage(measure(g, a, b, model.scale(pageNo))));
      },
      text: (at) => startTextEntry(at),
      dimension: (def) => startDimEntry(def),
      cover: (def) => {
        const obj: CoverObject = { id: model.newId(), kind: 'cover', shape: def.shape, p1: { ...def.p1 }, p2: { ...def.p2 } };
        history.exec(new AddObject(pageNo, obj));
        say(`${coverInfo(def.shape).label} aggiunta: bianca, sotto linee, quote e testi. Annulla per toglierla.`);
      },
      reject: say,
    },
  );

  /** Lunghezza totale di una spezzata, in mm reali se la pagina e' calibrata, altrimenti in mm del foglio. */
  function lengthText(points: readonly UserPoint[]): string {
    const g = viewer.geometry;
    if (!g) return '';
    let dPt = 0;
    for (let i = 1; i < points.length; i++) dPt += g.distancePt(points[i - 1] as UserPoint, points[i] as UserPoint);
    const s = model.scale(pageNo);
    return s ? `${fmt(realMm(dPt, s))} mm` : `${fmt(ptToMm(dPt))} mm sul foglio (pagina non calibrata)`;
  }

  // ---------- Barra di stato ----------
  const stX = h('span', { class: 'num' }, '—');
  const stY = h('span', { class: 'num' }, '—');
  const stPage = h('span', { class: 'num st-page' }, '');
  const prevBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina precedente', disabled: true, onclick: () => void goTo(pageNo - 1) }, icon('chevron-left'));
  const nextBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina successiva', disabled: true, onclick: () => void goTo(pageNo + 1) }, icon('chevron-right'));
  const pager = h('div', { class: 'st-pager' }, prevBtn, stPage, nextBtn);
  const scaleBtn = h('button', { class: 'st-scale-btn num', type: 'button', title: 'Calibra la scala di questa pagina', onclick: () => selectTool('calibrate') }, 'non calibrata');
  const orthoBtn = h('button', { class: 'st-toggle', type: 'button', 'aria-pressed': 'false', title: 'Ortogonale: il secondo punto va in orizzontale o in verticale', onclick: () => setOrtho(!ortho) }, 'ORTO');
  const statusbar = h(
    'footer',
    { class: 'statusbar' },
    h('span', { class: 'st-coord' }, h('span', { class: 'lbl' }, 'X:'), stX, h('span', { class: 'unit' }, 'mm'), h('span', { class: 'lbl' }, 'Y:'), stY, h('span', { class: 'unit' }, 'mm')),
    h('span', { class: 'st-scale' }, h('span', { class: 'lbl' }, 'SCALA:'), scaleBtn),
    orthoBtn,
    statusMsg,
    pager,
  );
  const setCursor = (p: { x: number; y: number } | null): void => {
    if (!p) {
      stX.textContent = '—';
      stY.textContent = '—';
      return;
    }
    stX.textContent = fmt(ptToMm(p.x));
    stY.textContent = fmt(ptToMm(viewer.sheetSize.h - p.y)); // Y verso l'alto dal bordo inferiore della pagina mostrata
  };
  function setOrtho(on: boolean): void {
    ortho = on;
    orthoBtn.setAttribute('aria-pressed', String(on));
    say(on ? 'Ortogonale attivo: il punto successivo va in orizzontale o in verticale' : 'Ortogonale disattivato');
    viewer.refreshAim();
  }
  const updateScaleLabel = (): void => {
    const s = pdf ? model.scale(pageNo) : null;
    scaleBtn.textContent = s ? scaleLabel(s) : 'non calibrata';
    scaleBtn.disabled = !pdf;
  };

  // ---------- Barra superiore ----------
  const docName = h('span', { class: 'doc-name', title: '' }, 'Nessun documento');
  const zoomLabel = h('button', { class: 'zoom-val num', type: 'button', 'aria-label': 'Adatta alla pagina', title: 'Adatta alla pagina', onclick: () => viewer.fit() }, '—');
  const mkBarBtn = (name: IconName, label: string, fn: () => void): HTMLButtonElement =>
    h('button', { class: 'btn bar-btn', type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name));
  const zoomOutBtn = mkBarBtn('minus', 'Riduci zoom del documento', () => viewer.zoomBy(1 / 1.25));
  const zoomInBtn = mkBarBtn('plus', 'Aumenta zoom del documento', () => viewer.zoomBy(1.25));
  const undoBtn = mkBarBtn('undo', 'Annulla', () => undoAction());
  const redoBtn = mkBarBtn('redo', 'Ripeti', () => redoAction());

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
    { label: 'Apri…', onSelect: () => void openFlow() },
    { label: 'Salva con nome…', hint: '5c', disabled: true },
    { label: 'Esporta PDF…', disabled: !pdf, onSelect: () => void exportFlow() },
    { label: 'Chiudi', disabled: !pdf, onSelect: () => void closeFlow() },
    'separator',
    { label: 'Diagnostica', onSelect: opts.openDiagnostics },
  ];
  const editMenu = (): MenuEntry[] => [
    { label: 'Annulla', hint: construction.pending ? 'ultimo punto' : (history.nextUndo ?? undefined), disabled: !canUndo(), onSelect: () => undoAction() },
    { label: 'Ripeti', hint: history.nextRedo ?? undefined, disabled: !history.canRedo, onSelect: () => redoAction() },
    'separator',
    { label: 'Seleziona / sposta', disabled: !pdf, onSelect: () => selectTool('select') },
    { label: 'Copia', hint: 'V2', disabled: true },
    { label: 'Duplica', hint: 'V2', disabled: true },
    { label: 'Cancella', disabled: !pdf, onSelect: () => selectTool('erase') },
  ];
  const insertMenu = (): MenuEntry[] => [
    { label: 'Retta', disabled: !pdf, onSelect: () => selectTool('segment') },
    { label: 'Linea', disabled: !pdf, onSelect: () => selectTool('polyline') },
    'separator',
    { label: 'Testo', disabled: !pdf, onSelect: () => selectTool('text') },
    ...DIM_TYPES.map((t): MenuEntry => ({ label: t.label, disabled: !pdf, onSelect: () => selectDimType(t.id) })),
    ...COVER_TYPES.map((t): MenuEntry => ({ label: t.label, disabled: !pdf, onSelect: () => selectCoverKind(t.id) })),
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
    h('div', { class: 'bar-right' }, h('div', { class: 'undo-ctl' }, undoBtn, redoBtn), h('div', { class: 'size-ctl' }, sizeDown, sizeUp), h('div', { class: 'zoom-ctl' }, zoomOutBtn, zoomLabel, zoomInBtn), inspectorBtn),
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
        disabled: !enabled || t.needsDoc === true,
        title: enabled ? t.label : `${t.label} (${t.cp})`,
        onclick: () => selectTool(t.id as ToolId),
      },
      icon(t.icon),
      h('span', { class: 'tool-label' }, t.label),
    );
    toolBtns.set(t.id, b);
    palette.append(b);
  }

  // ---------- Proprieta' ----------
  /** L'oggetto selezionato, se c'e' (solo con lo strumento Seleziona). */
  function selObj(): PageObject | undefined {
    return selected === null ? undefined : model.get(pageNo, selected);
  }
  /** Quali controlli servono a un oggetto: quelli delle sue proprieta' (la copertura non ne ha). */
  const kindOfObject = (o: PageObject): StyleKind => (isLine(o) ? 'line' : o.kind === 'text' ? 'text' : o.kind === 'dim' ? 'dim' : 'none');
  /** Proprieta' dell'oggetto come tipo di linea e corpo; quelle che l'oggetto non ha restano quelle di sessione (i controlli corrispondenti sono nascosti). */
  function propsView(o: PageObject): { stroke: Stroke; textPt: number } {
    const p = propsOf(o);
    return { stroke: { style: p.style ?? stroke.style, color: p.color ?? stroke.color, widthPt: p.widthPt ?? stroke.widthPt }, textPt: p.textPt ?? textPt };
  }
  /** Modifica le proprieta' dell'oggetto selezionato: un comando annullabile per ogni modifica. */
  function editSelected(o: PageObject, patch: ObjectProps): void {
    const before = propsOf(o);
    const after = patchedProps(o, patch);
    if (propsEqual(before, after)) return;
    history.exec(new SetProps(pageNo, o.id, before, after));
    say(`Proprietà modificate: ${objectNoun(o)}. Annulla le ripristina.`);
  }
  // Con un oggetto selezionato i controlli lavorano su di lui; altrimenti sulle proprieta' dei NUOVI oggetti.
  const styleBinding: StyleBinding = {
    get: () => {
      const o = selObj();
      return o ? propsView(o).stroke : stroke;
    },
    set: (patch) => {
      const o = selObj();
      if (o) editSelected(o, patch);
      else {
        Object.assign(stroke, patch);
        onStyleChanged();
      }
    },
    getTextPt: () => {
      const o = selObj();
      return o ? propsView(o).textPt : textPt;
    },
    setTextPt: (pt) => {
      const o = selObj();
      if (o) editSelected(o, { textPt: pt });
      else {
        textPt = pt;
        onStyleChanged();
      }
    },
  };
  const inspectorStyle = createStyleControls(styleBinding);
  const popoverStyle = createStyleControls(styleBinding);
  const styleChip = h('button', { class: 'btn ctx-style', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': 'Proprietà del nuovo oggetto', onclick: () => toggleProps() });
  /** Quali proprieta' contano: quelle dell'oggetto selezionato, altrimenti quelle dello strumento attivo. */
  const styleKind = (): StyleKind => {
    const o = selObj();
    return o ? kindOfObject(o) : tool === 'text' ? 'text' : tool === 'dim' ? 'dim' : 'line';
  };
  const refreshStyleChip = (): void => {
    const kind = styleKind();
    const o = selObj();
    const s = styleBinding.get();
    const aa = (): HTMLElement => {
      const el = h('span', { class: 'ctx-aa' }, 'Aa');
      el.style.color = s.color;
      return el;
    };
    styleChip.replaceChildren(
      ...(kind === 'text' || kind === 'none' ? [] : [styleGlyph(s), h('span', { class: 'num' }, `${fmtTrim(s.widthPt, 3)} pt`)]),
      ...(kind === 'line' || kind === 'none' ? [] : [aa(), h('span', { class: 'num' }, `${fmtTrim(styleBinding.getTextPt(), 3)} pt`)]),
    );
    styleChip.setAttribute('aria-label', o ? "Proprietà dell'oggetto selezionato" : 'Proprietà del nuovo oggetto');
    popoverStyle.setKind(kind);
    inspectorStyle.setKind(o ? kind : 'all');
  };
  function onStyleChanged(): void {
    inspectorStyle.refresh();
    popoverStyle.refresh();
    refreshStyleChip();
    renderConstruction();
  }
  refreshStyleChip();

  // ---------- Barra contestuale ----------
  const ctxHint = h('p', { class: 'ctx-hint', 'aria-live': 'polite' });
  const cancelBtn = h('button', { class: 'btn ctx-act', type: 'button', onclick: () => cancelConstruction() }, 'Annulla');
  const finishBtn = h('button', { class: 'btn primary ctx-act', type: 'button', onclick: () => finishLine() }, icon('check'), 'Fine');
  const dimTypeBtns = new Map<DimType, HTMLButtonElement>();
  const dimTypes = h('div', { class: 'ctx-types seg', role: 'group', 'aria-label': 'Tipo di quota', hidden: true });
  for (const t of DIM_TYPES) {
    const b = h('button', { class: 'btn seg-btn', type: 'button', 'aria-pressed': String(t.id === dimType), title: t.label, onclick: () => selectDimType(t.id) }, t.short);
    dimTypeBtns.set(t.id, b);
    dimTypes.append(b);
  }
  const coverTypeBtns = new Map<CoverKind, HTMLButtonElement>();
  const coverTypes = h('div', { class: 'ctx-covers seg', role: 'group', 'aria-label': 'Forma della copertura', hidden: true });
  for (const t of COVER_TYPES) {
    const b = h('button', { class: 'btn seg-btn', type: 'button', 'aria-pressed': String(t.id === coverKind), title: t.label, onclick: () => selectCoverKind(t.id) }, t.short);
    coverTypeBtns.set(t.id, b);
    coverTypes.append(b);
  }
  const popover = h('div', { class: 'props-pop', role: 'group', 'aria-label': 'Proprietà', hidden: true }, popoverStyle.el);
  const ctxBar = h('section', { class: 'ctxbar', 'aria-label': 'Strumento attivo', hidden: true }, ctxHint, dimTypes, coverTypes, h('div', { class: 'ctx-actions' }, styleChip, cancelBtn, finishBtn), popover);
  let propsOpen = false;
  function toggleProps(open = !propsOpen): void {
    propsOpen = open;
    popover.hidden = !open;
    styleChip.setAttribute('aria-expanded', String(open));
    if (open) {
      popoverStyle.refresh();
      document.addEventListener('pointerdown', onOutsideProps, true);
    } else document.removeEventListener('pointerdown', onOutsideProps, true);
  }
  function onOutsideProps(e: Event): void {
    const t = e.target as Node;
    if (!popover.contains(t) && !styleChip.contains(t)) toggleProps(false);
  }

  // ---------- Inspector ----------
  const inspector = h('aside', { class: 'inspector', 'aria-label': 'Proprietà' });
  const section = (title: string, ...body: Child[]): HTMLElement => h('section', { class: 'insp-sec' }, h('h2', { class: 'insp-h' }, title), ...body);
  const kv = (k: string, v: string): HTMLElement => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v));
  const renderInspector = (): void => {
    const secs: HTMLElement[] = [];
    if (pdf) {
      const info = pdf.pages[pageNo - 1];
      secs.push(section('Documento', kv('File', pdf.name), kv('Pagine', String(pdf.pages.length))));
      if (info) {
        secs.push(
          section(
            `Pagina ${pageNo}`,
            kv('Dimensione', `${fmt(ptToMm(info.widthPt), 1)} x ${fmt(ptToMm(info.heightPt), 1)} mm`),
            kv('Rotate', `${info.rotate}°`),
            kv('Unità utente', info.userUnit === 1 ? '1/72 in' : `UserUnit ${fmt(info.userUnit, 3)}`),
          ),
        );
      }
      const s = model.scale(pageNo);
      const n = model.objects(pageNo).length;
      secs.push(
        section(
          'Scala e oggetti',
          kv('Scala', s ? scaleLabel(s) : 'non calibrata'),
          kv('Oggetti su questa pagina', String(n)),
          h('button', { class: 'btn', type: 'button', onclick: () => selectTool('calibrate') }, icon('scaling'), s ? 'Ricalibra la scala' : 'Calibra la scala'),
        ),
      );
    } else {
      secs.push(section('Documento', h('p', { class: 'hint' }, 'Nessun documento aperto.')));
    }
    const so = selObj();
    secs.push(
      section(
        so ? 'Proprietà (oggetto selezionato)' : 'Proprietà (nuovi oggetti)',
        ...(so ? [kv('Selezionato', objectLabel(so))] : []),
        ...(so && kindOfObject(so) === 'none' ? [h('p', { class: 'hint' }, 'Le coperture sono bianche e senza bordo: non hanno proprietà da cambiare.')] : []),
        inspectorStyle.el,
      ),
    );
    secs.push(section('App', kv('Versione', __BUILD_ID__)));
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

  const floatDist = h('button', { class: 'btn float-dist', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Distanza', title: 'Distanza tra due punti', onclick: () => selectTool(tool === 'distance' ? 'pan' : 'distance') }, icon('ruler-dimension'), h('span', null, 'Distanza'));
  const floatZoom = h(
    'div',
    { class: 'float-zoom' },
    floatDist,
    mkBarBtn('plus', 'Aumenta zoom', () => viewer.zoomBy(1.25)),
    mkBarBtn('minus', 'Riduci zoom', () => viewer.zoomBy(1 / 1.25)),
    mkBarBtn('maximize', 'Adatta alla pagina', () => viewer.fit()),
  );
  const work = h('main', { class: 'work' }, viewer.el, emptyPanel, floatZoom);

  const keypad = new Keypad();
  const app = h('div', { class: 'app' }, bar, palette, work, inspector, ctxBar, keypad.el, statusbar, fileInput);
  root.replaceChildren(app);

  // ---------- Strumenti ----------
  function selectTool(id: ToolId): void {
    const def = TOOLS.find((t) => t.id === id);
    if (!def || def.cp) return;
    if (def.needsDoc && !pdf) return;
    cancelEntry();
    tool = id;
    selected = null; // la selezione vale solo con lo strumento Seleziona
    viewer.setSelection(null);
    toggleProps(false);
    construction.setTool(isConstructionTool(id) ? id : null);
    if (id === 'dim') construction.setDimType(dimType);
    if (id === 'cover') construction.setCoverKind(coverKind);
    currentAim = null;
    viewer.setMode(def.mode ?? 'pan');
    viewer.setHighlight(null);
    for (const [tid, b] of toolBtns) b.setAttribute('aria-pressed', String(tid === id));
    floatDist.setAttribute('aria-pressed', String(id === 'distance'));
    say('');
    refreshStyleChip();
    renderInspector();
    renderConstruction();
    revealTool(id); // per ultimo: la barra contestuale appena comparsa o sparita cambia l'altezza della palette
  }

  /**
   * La palette scorre (in orizzontale su iPhone in verticale, in verticale dove non c'e' altezza per tutte le voci):
   * porta il pulsante dello strumento attivo tutto in vista, anche quando lo strumento e' scelto dal menu. Scrive
   * scrollLeft/scrollTop, senza animazione; non fa nulla se la palette non si vede o il pulsante e' nascosto (Distanza su schermo stretto).
   */
  function revealTool(id: string): void {
    const b = toolBtns.get(id);
    if (!b || palette.clientWidth === 0) return;
    const p = palette.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    if (r.width === 0) return;
    const cs = getComputedStyle(palette);
    const padX = Number.parseFloat(cs.paddingLeft) || 0;
    const padY = Number.parseFloat(cs.paddingTop) || 0;
    if (r.left < p.left + padX) palette.scrollLeft += r.left - (p.left + padX);
    else if (r.right > p.right - padX) palette.scrollLeft += r.right - (p.right - padX);
    if (r.top < p.top + padY) palette.scrollTop += r.top - (p.top + padY);
    else if (r.bottom > p.bottom - padY) palette.scrollTop += r.bottom - (p.bottom - padY);
  }
  // Se la palette cambia dimensione (barra contestuale che compare o va a capo, rotazione) lo strumento attivo resta tutto in vista.
  new ResizeObserver(() => revealTool(tool)).observe(palette);

  /** Sceglie la forma della copertura (e passa allo strumento Copertura). */
  function selectCoverKind(k: CoverKind): void {
    coverKind = k;
    if (tool !== 'cover') selectTool('cover');
    else {
      construction.setCoverKind(k);
      currentAim = null;
      renderConstruction();
    }
  }

  // ---------- Selezione ----------
  function renderSelection(): void {
    const o = selObj();
    viewer.setSelection(o ? shapeOf(o) : null);
  }
  function setSelected(id: number | null): void {
    selected = id;
    viewer.setDragOffset(null, 0, 0);
    renderSelection();
    refreshStyleChip();
    renderInspector();
    renderConstruction();
  }

  /** Sceglie il tipo di quota (e passa allo strumento Quota). */
  function selectDimType(t: DimType): void {
    dimType = t;
    if (tool !== 'dim') selectTool('dim');
    else {
      cancelEntry();
      construction.setDimType(t);
      currentAim = null;
      renderConstruction();
    }
  }

  /** Redisegna punti, anteprima, misura e barra contestuale secondo lo stato della costruzione. */
  function renderConstruction(): void {
    const geom = viewer.geometry;
    const t = construction.tool;
    const pts = construction.points;
    const aim = construction.done || construction.locked ? null : currentAim;
    viewer.setDraft(null);
    viewer.setCoverDraft(null);
    if (!geom || !pdf) {
      viewer.setMarkers([]);
      viewer.setPreview(null);
      viewer.setGuide(null);
      viewer.setBadge(null);
    } else if (t === 'text') {
      viewer.setMarkers(pts.map((p) => ({ p })));
      viewer.setPreview(null);
      viewer.setGuide(null);
      viewer.setBadge(null);
      if (entry) viewer.setDraft(entryLayout(geom));
    } else if (t === 'dim') {
      viewer.setMarkers(pts.map((p, i) => ({ p, label: String(i + 1) })));
      viewer.setPreview(null);
      viewer.setBadge(null);
      if (entry) {
        viewer.setGuide(null);
        viewer.setDraft(entryLayout(geom));
      } else {
        // dopo il primo punto la guida segue il dito; per le quote a tre punti, dopo il secondo si vede la quota intera
        const need = dimInfo(dimType).points;
        const line = aim && pts.length === 1 ? [...pts, aim] : pts;
        viewer.setGuide(pts.length < 2 || need === 2 ? (line.length >= 2 ? line : null) : null);
        if (need === 3 && pts.length === 2 && aim) {
          const def = buildDimension(dimType, [...pts, aim], geom);
          if (def) viewer.setDraft(dimLayout(def, null, geom, dimDraftLabel(def, null, geom)));
        }
      }
    } else if (t === 'cover') {
      viewer.setMarkers(pts.map((p) => ({ p })));
      viewer.setPreview(null);
      viewer.setGuide(null);
      viewer.setBadge(null);
      const first = pts[0];
      if (first && aim) viewer.setCoverDraft(coverOnSheet({ shape: coverKind, p1: first, p2: aim }, geom)); // fondo bianco sotto gli oggetti + contorno sottile (solo a schermo)
    } else if (t === 'segment' || t === 'polyline') {
      const line = aim && pts.length > 0 ? [...pts, aim] : pts;
      viewer.setMarkers(pts.map((p) => ({ p })));
      viewer.setPreview(line.length >= 2 ? line : null, stroke);
      viewer.setGuide(null);
      viewer.setBadge(null);
    } else if (t === 'calibrate' || t === 'distance') {
      const line = aim && pts.length === 1 ? [...pts, aim] : pts;
      viewer.setMarkers(pts.map((p, i) => ({ p, label: String(i + 1) })));
      viewer.setPreview(null);
      viewer.setGuide(line.length >= 2 ? line : null);
      const [a, b] = [pts[0], line[1]];
      if (t === 'distance' && a && b && line.length >= 2) {
        // misura in corso (durante la mira) o risultato (dopo il secondo punto)
        const m = measure(geom, a, b, model.scale(pageNo));
        viewer.setBadge({ at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, lines: measureLines(m) });
      } else viewer.setBadge(null);
    } else {
      viewer.setMarkers([]);
      viewer.setPreview(null);
      viewer.setGuide(null);
      viewer.setBadge(null);
    }
    // barra contestuale
    const active = tool !== 'pan';
    ctxBar.hidden = !active;
    ctxBar.dataset.tool = tool;
    const constructing = isConstructionTool(tool);
    const so = selObj();
    ctxHint.textContent = constructing
      ? construction.prompt
      : tool === 'erase'
        ? 'Cancella: tocca un oggetto per cancellarlo (Annulla lo ripristina)'
        : tool === 'select'
          ? so
            ? `Selezionat${fem(so)}: ${objectLabel(so)}` // testi brevi: la barra contestuale non deve cambiare altezza selezionando un oggetto
            : 'Seleziona: tocca un oggetto, poi trascinalo'
          : '';
    dimTypes.hidden = tool !== 'dim';
    for (const [id, b] of dimTypeBtns) b.setAttribute('aria-pressed', String(id === dimType));
    coverTypes.hidden = tool !== 'cover';
    for (const [id, b] of coverTypeBtns) b.setAttribute('aria-pressed', String(id === coverKind));
    styleChip.hidden = !(tool === 'segment' || tool === 'polyline' || tool === 'text' || tool === 'dim' || tool === 'select');
    // Con Seleziona il riquadro occupa sempre il suo posto (invisibile se non c'e' nulla da cambiare): se comparisse
    // solo con un oggetto selezionato, selezionare farebbe cambiare altezza alla barra e il foglio si ridimensionerebbe sotto il dito.
    styleChip.classList.toggle('ghost', tool === 'select' && !(so !== undefined && kindOfObject(so) !== 'none'));
    cancelBtn.hidden = !constructing;
    cancelBtn.disabled = !(construction.pending || construction.done || construction.locked);
    finishBtn.hidden = tool !== 'polyline';
    finishBtn.disabled = pts.length < 2 || construction.done;
    if (!active) toggleProps(false);
    refreshUndoRedo();
  }

  function cancelConstruction(): void {
    construction.reset();
    currentAim = null;
    say('');
    renderConstruction();
  }
  function finishLine(): void {
    construction.finish();
    renderConstruction();
  }

  async function calibrateFlow(a: UserPoint, b: UserPoint): Promise<void> {
    const geom = viewer.geometry;
    const page = pageNo;
    if (!geom) return;
    renderConstruction(); // mostra i due punti mentre il dialogo e' aperto
    const dPt = geom.distancePt(a, b);
    const real = await askRealDistance(dPt, model.scale(page));
    if (real !== null) {
      const s = calibrate(dPt, real);
      if (s) {
        history.exec(new SetScale(page, model.scale(page), s));
        say(`Scala della pagina ${page}: ${scaleLabel(s)}`);
      }
    }
    construction.reset();
    currentAim = null;
    renderConstruction();
  }

  // ---------- Scena: oggetti della pagina come li disegna il livello sul foglio ----------
  /** Layout di un testo o di una quota (sempre dritti sul foglio). Una quota automatica senza scala non dovrebbe esistere: "?" per non nascondere l'errore. */
  function objectLayout(o: TextObject | DimensionObject, g: PageGeometry): Layout {
    if (o.kind === 'text') return layoutText(o, g);
    return dimLayout(o, o, g, dimensionLabel(o, g, model.scale(pageNo)) ?? '?');
  }
  function dimLayout(def: DimensionDef, style: { color: string; widthPt: number; textPt: number } | null, g: PageGeometry, label: string): Layout {
    return layoutDimension({ ...def, color: style?.color ?? stroke.color, widthPt: style?.widthPt ?? stroke.widthPt, textPt: style?.textPt ?? textPt }, g, label);
  }
  const sheetLine = (o: LineObject, g: PageGeometry): SheetPoint[] => o.points.map((p) => g.userToSheet(p));
  const shapeOf = (o: PageObject): Shape => {
    const g = viewer.geometry;
    if (!g) return { lines: [], rects: [], circles: [] };
    if (o.kind === 'cover') return coverShapeOf(coverOnSheet(o, g));
    return isLine(o) ? { lines: [sheetLine(o, g)], rects: [], circles: [] } : objectLayout(o, g).hit;
  };
  /** Gli oggetti dal fondo al primo piano: le coperture stanno sotto tutto, anche se disegnate dopo. */
  function sceneItems(): DrawItem[] {
    const g = viewer.geometry;
    if (!g) return [];
    return drawOrder(model.objects(pageNo)).map((o): DrawItem => {
      if (o.kind === 'cover') return { kind: 'cover', id: o.id, cover: coverOnSheet(o, g) };
      return isLine(o) ? { kind: 'line', id: o.id, points: sheetLine(o, g), stroke: o.stroke } : { kind: 'layout', id: o.id, layout: objectLayout(o, g) };
    });
  }

  // ---------- Testo e valore delle quote con il tastierino ----------
  /** Etichetta della quota in costruzione: quella scritta, altrimenti l'automatica, altrimenti "?" (pagina non calibrata). */
  function dimDraftLabel(def: DimensionDef, typed: string | null, g: PageGeometry): string {
    return typed ? typed : (autoLabel(def, g, model.scale(pageNo)) ?? '?');
  }
  function entryLayout(g: PageGeometry): Layout | null {
    if (!entry) return null;
    if (entry.kind === 'text') return layoutText({ at: entry.at, text: entry.text, textPt, color: stroke.color }, g);
    return dimLayout(entry.def, null, g, dimDraftLabel(entry.def, entry.text, g));
  }
  /** Punti del foglio che devono restare in vista mentre si scrive. */
  function entryExtent(g: PageGeometry): SheetPoint[] {
    const l = entryLayout(g);
    if (!l) return [];
    const pts: SheetPoint[] = l.hit.lines.flat();
    for (const r of l.hit.rects) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    if (entry?.kind === 'text') pts.push(g.userToSheet(entry.at), { x: g.userToSheet(entry.at).x + 4 * textPt, y: g.userToSheet(entry.at).y - textPt }); // il testo e' ancora vuoto: spazio per le prime lettere
    return pts;
  }

  function openEntry(e: Entry, session: { title: string; info: string; layout: 'num' | 'abc'; selectFrom?: number; maxLength: number; decimal: boolean; validate: (t: string) => string | null; onConfirm: (t: string) => void }): void {
    const g = viewer.geometry;
    if (!g) return;
    toggleProps(false);
    entry = e;
    viewer.setMode('pan'); // un dito sposta la vista, due dita fanno pinch: il punto di lavoro si puo' controllare
    app.classList.add('kbd-open');
    keypad.open({
      title: session.title,
      info: session.info,
      initial: e.text,
      selectFrom: session.selectFrom,
      layout: session.layout,
      rules: { maxLength: session.maxLength, commaAfterDigitIsDecimal: session.decimal },
      validate: session.validate,
      onInput: (text) => {
        e.text = text;
        renderConstruction();
      },
      onConfirm: (text) => {
        endEntry();
        session.onConfirm(text);
      },
      onCancel: () => {
        endEntry();
        say('Annullato');
      },
    });
    renderConstruction();
    viewer.ensureVisible(entryExtent(g)); // l'area di lavoro si e' ridotta: il punto di lavoro non deve restare nascosto
  }

  /** Chiude il tastierino e torna allo strumento (il tastierino e' gia' chiuso se e' stato lui a chiamare). */
  function endEntry(): void {
    entry = null;
    keypad.close();
    app.classList.remove('kbd-open');
    construction.reset();
    currentAim = null;
    viewer.setMode(TOOLS.find((t) => t.id === tool)?.mode ?? 'pan');
    renderConstruction();
  }
  /** Scarta il testo o la quota in corso (cambio di strumento, di pagina, chiusura del documento). */
  function cancelEntry(): void {
    if (entry) endEntry();
  }

  function startTextEntry(at: UserPoint): void {
    openEntry(
      { kind: 'text', at, text: '' },
      {
        title: 'Testo',
        info: 'Una riga · Helvetica',
        layout: 'abc',
        maxLength: TEXT_MAX_LENGTH,
        decimal: false,
        validate: validateFreeText,
        onConfirm: (text) => {
          const obj: TextObject = { id: model.newId(), kind: 'text', at: { ...at }, text: text.trimEnd(), textPt, color: stroke.color };
          history.exec(new AddObject(pageNo, obj));
          say(`Testo aggiunto: "${obj.text}". Annulla per toglierlo.`);
        },
      },
    );
  }

  function startDimEntry(def: DimensionDef): void {
    const g = viewer.geometry;
    if (!g) return;
    const scale = model.scale(pageNo);
    const auto = autoLabel(def, g, scale);
    const name = dimInfo(def.dim).label;
    openEntry(
      { kind: 'dim', def, text: auto ?? dimInfo(def.dim).prefix, auto },
      {
        title: name,
        info: auto && scale ? `Automatico ${auto} mm · scala ${scaleLabel(scale)}` : 'Pagina non calibrata: digita il valore in mm',
        layout: 'num',
        selectFrom: auto ? dimInfo(def.dim).prefix.length : undefined, // il valore automatico e' proposto: il primo tasto lo sostituisce (il prefisso Ø/R resta)
        maxLength: DIM_TEXT_MAX_LENGTH,
        decimal: true,
        validate: validateDimText,
        onConfirm: (raw) => {
          const text = normalizeDimText(raw);
          const obj: DimensionObject = { id: model.newId(), kind: 'dim', ...def, valueText: text === auto ? null : text, color: stroke.color, widthPt: stroke.widthPt, textPt };
          history.exec(new AddObject(pageNo, obj));
          say(`${name}: ${text}${obj.valueText === null ? ' (automatico)' : ' (digitato)'}. Annulla per toglierla.`);
        },
      },
    );
  }

  // ---------- Scelta dell'oggetto con un tocco (Cancella e Seleziona) ----------
  /** Tra gli oggetti entro la tolleranza, quello in primo piano (le coperture, sotto tutto, vincono solo se non c'e' altro a portata). */
  const objectAt = (sheet: { x: number; y: number }, tol: number): PageObject | null => pickTop(drawOrder(model.objects(pageNo)), shapeOf, sheet, tol);

  // ---------- Annulla / ripeti ----------
  const canUndo = (): boolean => !entry && (construction.pending || history.canUndo);
  function refreshUndoRedo(): void {
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = entry !== null || !history.canRedo;
    undoBtn.title = construction.pending ? 'Annulla: toglie l\'ultimo punto' : history.nextUndo ? `Annulla ${history.nextUndo}` : 'Annulla';
    redoBtn.title = history.nextRedo ? `Ripeti ${history.nextRedo}` : 'Ripeti';
  }
  function afterHistory(cmd: Command<DocumentModel> | null, verb: string): void {
    if (!cmd) return;
    if (cmd.page !== pageNo) void goTo(cmd.page); // mostra la pagina interessata
    say(`${verb}: ${cmd.label}`);
  }
  function undoAction(): void {
    if (entry) return; // con il tastierino aperto si conferma o si annulla da li'
    if (construction.undoLast()) {
      currentAim = null;
      renderConstruction();
      return;
    }
    if (!history.canUndo) {
      say('Niente da annullare');
      return;
    }
    afterHistory(history.undo(), 'Annullato');
  }
  function redoAction(): void {
    if (entry) return;
    if (!history.canRedo) {
      say('Niente da ripetere');
      return;
    }
    afterHistory(history.redo(), 'Ripetuto');
  }

  // Se la vista cambia mentre si scrive (rotazione dell'iPhone, A-/A+), il punto di lavoro deve restare in vista.
  new ResizeObserver(() => {
    const g = viewer.geometry;
    if (entry && g) viewer.ensureVisible(entryExtent(g));
  }).observe(viewer.el);

  // ---------- Collegamenti della vista ----------
  viewer.hooks.onCursor = setCursor;
  viewer.hooks.onView = ({ zoom }) => {
    zoomLabel.textContent = `${fmt((zoom / CSS_PX_PER_PT) * 100, 0)}%`;
  };
  viewer.hooks.onReject = say;
  viewer.hooks.constrain = (raw) => construction.constrain(raw);
  viewer.hooks.onAim = (eff) => {
    const g = viewer.geometry;
    currentAim = eff && g ? g.sheetToUser(eff) : null;
    renderConstruction();
  };
  viewer.hooks.onPlace = (user) => {
    construction.place(user);
    renderConstruction();
  };
  viewer.hooks.onErasePreview = (sheet, tol) => {
    const o = sheet ? objectAt(sheet, tol) : null;
    viewer.setHighlight(o ? shapeOf(o) : null);
  };
  viewer.hooks.onErase = (sheet, tol) => {
    const o = objectAt(sheet, tol);
    if (!o) {
      say('Nessun oggetto in questo punto: tocca sopra un oggetto');
      return;
    }
    history.exec(new RemoveObject(pageNo, o));
    say(`${objectNoun(o).replace(/^./, (c) => c.toUpperCase())} cancellat${fem(o)}. Annulla ${o.kind === 'text' ? 'lo' : 'la'} ripristina.`);
  };
  // Seleziona: un tocco sceglie l'oggetto in primo piano; trascinare l'oggetto selezionato lo sposta (un solo comando).
  viewer.hooks.onSelect = (sheet, tol) => {
    const o = objectAt(sheet, tol);
    setSelected(o ? o.id : null);
    say(''); // lo dice gia' la barra contestuale: "Selezionata: Retta"
  };
  viewer.hooks.canGrab = (sheet, tol) => {
    const o = selObj();
    return o !== undefined && distToShape(sheet, shapeOf(o)) <= tol;
  };
  viewer.hooks.onDragMove = (dx, dy) => viewer.setDragOffset(selected, dx, dy);
  viewer.hooks.onDragCancel = () => viewer.setDragOffset(null, 0, 0);
  viewer.hooks.onDragEnd = (dx, dy) => {
    viewer.setDragOffset(null, 0, 0);
    const o = selObj();
    const g = viewer.geometry;
    if (!o || !g) return;
    const d = g.sheetDeltaToUser(dx, dy); // lo spostamento sul foglio, riportato nello spazio utente PDF
    if (d.x === 0 && d.y === 0) return;
    history.exec(new MoveObject(pageNo, o, d.x, d.y));
    say(`${objectNoun(o).replace(/^./, (c) => c.toUpperCase())} spostat${fem(o)}. Annulla ${o.kind === 'text' ? 'lo' : 'la'} rimette a posto.`);
  };

  // Modello e cronologia: ogni cambiamento aggiorna disegno, scala, proprieta' e pulsanti.
  model.onChange(() => {
    refreshScene();
    if (selected !== null && !model.get(pageNo, selected)) selected = null; // l'oggetto selezionato non c'e' piu'
    renderSelection();
    refreshStyleChip();
    updateScaleLabel();
    renderInspector();
    inspectorStyle.refresh();
    popoverStyle.refresh();
    renderConstruction();
  });
  history.onChange(refreshUndoRedo);
  function refreshScene(): void {
    viewer.setObjects(sceneItems());
  }

  // ---------- Tastiera (desktop) ----------
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.defaultPrevented || document.querySelector('.dialog-backdrop')) return;
    const target = e.target as HTMLElement | null;
    if (target?.matches('input, textarea, select')) return;
    // Invio, Backspace e Canc valgono solo se il focus non e' su un pulsante o un menu (resta l'uso da tastiera dei pulsanti).
    const onCanvas = target === null || target === document.body || viewer.el.contains(target);
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoAction();
      else undoAction();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redoAction();
    } else if (e.key === 'Escape') {
      if (propsOpen) toggleProps(false);
      else if (selected !== null) setSelected(null);
      else if (construction.pending || construction.done) cancelConstruction();
    } else if (e.key === 'Enter' && tool === 'polyline' && onCanvas) {
      e.preventDefault();
      finishLine();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && construction.pending && onCanvas) {
      e.preventDefault();
      undoAction();
    }
  });

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
    for (const t of TOOLS) if (t.needsDoc) toolBtns.get(t.id)?.toggleAttribute('disabled', !has);
    if (!has) zoomLabel.textContent = '—';
    updateScaleLabel();
    renderInspector();
  };

  async function goTo(n: number): Promise<void> {
    if (!pdf) return;
    cancelEntry();
    selected = null;
    pageNo = Math.min(Math.max(1, n), pdf.pages.length);
    construction.reset();
    currentAim = null;
    updateChrome();
    try {
      const rendering = viewer.setPage(await pdf.doc.getPage(pageNo));
      refreshScene(); // la geometria della nuova pagina e' gia' impostata: gli oggetti compaiono subito
      refreshStyleChip();
      renderConstruction();
      inspectorStyle.refresh();
      popoverStyle.refresh();
      await rendering;
    } catch (e) {
      say(`Pagina ${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Azzera la sessione. Parte sincrona: la chiusura del documento prosegue in coda. */
  function resetSession(): void {
    cancelEntry();
    const old = pdf;
    pdf = null;
    pageNo = 1;
    history.clear();
    model.clear();
    selectTool('pan');
    void viewer.setPage(null);
    updateChrome();
    say('');
    if (old) void closePdf(old).catch(() => undefined);
  }

  /** Riepilogo di cio' che andrebbe perso. */
  const contentSummary = (): string => {
    const parts: string[] = [];
    const n = model.objectCount();
    const s = model.scaleCount();
    if (n > 0) parts.push(n === 1 ? '1 oggetto disegnato' : `${n} oggetti disegnati`);
    if (s > 0) parts.push(s === 1 ? '1 scala calibrata' : `${s} scale calibrate`);
    return parts.join(' e ');
  };

  const confirmDiscard = (what: string, action: () => void): void => {
    if (!model.hasContent) {
      action();
      return;
    }
    void showDialog({
      title: 'Modifiche non salvate',
      message: `Ci sono ${contentSummary()} (il salvataggio del progetto arriva in 5c; Esporta PDF crea un nuovo file ma non salva il lavoro). ${what}`,
      confirmLabel: 'Procedi',
      cancelLabel: 'Annulla',
      onConfirm: action,
    });
  };

  /** Apri: il documento attuale resta finche' il nuovo non e' stato letto con successo. */
  function openFlow(): void {
    confirmDiscard('Aprire un altro PDF le scarta.', pickFile);
  }
  function closeFlow(): void {
    confirmDiscard('Chiudere il documento le scarta.', resetSession);
  }

  /**
   * Esporta PDF (CP5a, "Copertura semplice"): il modulo di scrittura (pdf-lib, circa 580 kB) si carica solo qui. Il lavoro (oggetti,
   * scala, cronologia) non viene toccato: un errore lascia tutto com'era. Il PDF si genera con "Esporta"; condividere o scaricare
   * sono tocchi successivi (share() va chiamata dal tocco).
   */
  async function exportFlow(): Promise<void> {
    const doc = pdf;
    if (!doc) return;
    if (entry) {
      say('Conferma o annulla prima il testo o la quota in corso');
      return;
    }
    cancelConstruction();
    const outName = exportFileName(doc.name);
    const pageObjects = (n: number): PageObject[] => [...model.objects(n)];
    let touched = 0;
    for (let n = 1; n <= doc.pages.length; n++) if (model.objects(n).length > 0) touched++;
    await showExportDialog({
      fileName: doc.name,
      outName,
      pageCount: doc.pages.length,
      objectCount: model.objectCount(),
      pagesWithObjects: touched,
      run: async (onProgress) => {
        const t0 = performance.now();
        const [{ exportCoverSimple }, { verifyExport }] = await Promise.all([import('../export/coverSimple'), import('../export/verify')]);
        const specs = doc.pages.map((p) => ({ view: p.view, rotate: p.rotate, userUnit: p.userUnit }));
        const res = await exportCoverSimple(
          doc.bytes,
          specs.map((spec, i) => ({ spec, objects: pageObjects(i + 1), scale: model.scale(i + 1) })),
          { onProgress },
        );
        const check = await verifyExport(res.bytes, specs);
        const file = makePdfFile(res.bytes, outName); // il File tiene i dati: i byte generati non servono piu'
        return { file, touchedPages: res.touchedPages, pageCount: res.pageCount, objectCount: res.objectCount, warnings: res.warnings, ms: performance.now() - t0, verifiedPages: check.pageCount };
      },
    });
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
      cancelEntry();
      pdf = next;
      pageNo = 1;
      history.clear();
      model.clear();
      construction.reset();
      if (prev) void closePdf(prev).catch(() => undefined);
      await goTo(1);
      say(`${name}: ${next.pages.length} ${next.pages.length === 1 ? 'pagina' : 'pagine'}, aperto in ${fmt(next.openMs, 0)} ms`);
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
  renderConstruction();
  viewer.setMode('pan');

  // Gancio per le prove Chromium: presente solo nel build di prova (GTPDF_TEST=1), mai in quello pubblicato (la costante e' false e il blocco sparisce).
  if (__TEST_HOOKS__) {
    const win = window as unknown as { __gtpdf?: unknown };
    win.__gtpdf = {
      /** Aggiunge oggetti (senza id) alla pagina con un comando annullabile, come fa l'interfaccia. */
      add: (page: number, objs: Omit<PageObject, 'id'>[]) => {
        for (const o of objs) history.exec(new AddObject(page, { ...o, id: model.newId() } as PageObject));
      },
      setScale: (page: number, mmPerPt: number) => history.exec(new SetScale(page, model.scale(page), { mmPerPt })),
      goTo: (n: number) => goTo(n),
      /** I byte originali del PDF aperto (stesso Uint8Array dell'app: serve a provare che non cambiano). */
      originalBytes: () => pdf?.bytes ?? null,
      page: () => pageNo,
      objectCount: () => model.objectCount(),
      zoomTo: (z: number) => viewer.zoomTo(z),
      fit: () => viewer.fit(),
    };
  }
}
