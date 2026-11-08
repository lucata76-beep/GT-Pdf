// Guscio dell'app (CP4): barra con menu, palette, vista del documento, inspector, barra contestuale, tastierino, barra di stato.
// Strumenti: Sposta, Seleziona, Retta, Linea, Scala (calibrazione), Distanza, Testo, Quota, Copertura, Cancella (e Origine, dal menu). Oggetti, scala e origine sono in memoria
// nella sessione, nello spazio utente PDF; si salvano in un file progetto (.json) con File > Salva con nome e si riaprono con File > Apri progetto.
// Ogni modifica passa da un comando (annulla/ripeti).
import { type PickedSide, type SideTract, angularFromLines, pickSide } from '../geometry/angular';
import { DIM_TYPES, type DimType, type DimensionDef, autoLabel, buildDimension, dimInfo } from '../geometry/dimension';
import { DIM_TEXT_MAX_LENGTH, TEXT_MAX_LENGTH, normalizeDimText, validateDimText, validateFreeText } from '../geometry/annotationText';
import { CURVE_TYPES, type CurveKind, arcProblem, curveOnSheet } from '../geometry/arc';
import { COVER_TYPES, type CoverKind, coverInfo, coverOnSheet, coverShapeOf, squareUser } from '../geometry/cover';
import { distToShape, pickTop } from '../geometry/hit';
import { type Layout, type Shape, layoutDimension, layoutText, unionShapes } from '../geometry/layout';
import { measure, measureLines, measureMessage } from '../geometry/measure';
import { fmt, fmtTrim } from '../geometry/numbers';
import { type OriginFrame, inPageWithEps, originFrame, relToSheet, relUnitLabel, sheetToRel } from '../geometry/origin';
import { PageGeometry, type PageSpec, type SheetPoint, type UserPoint } from '../geometry/page';
import { ptToMm } from '../geometry/pixels';
import { calibrate, realMm, scaleLabel } from '../geometry/scale';
import { GRID_DEFAULT_MM, GRID_MIN_SCREEN_PX, gridStepPt, gridVisible } from '../geometry/grid';
import { SNAP_KINDS, SNAP_LABEL, type SnapHit, type SnapSwitch, findSnap, snapRadiusPt } from '../geometry/snap';
import { type SnapScene, buildSnapScene } from '../geometry/snapExtra';
import { type PlannedMove, type TransformSpec, planTransform, specProblem } from '../geometry/transform';
import { type Command, History } from '../model/history';
import {
  AddObject,
  AddObjects,
  type ArcObject,
  type CircleObject,
  type CoverObject,
  type DimensionObject,
  DocumentModel,
  type LineObject,
  MoveObject,
  type ObjectProps,
  type PageObject,
  RemoveObject,
  RemoveObjects,
  SetOrigin,
  SetProps,
  SetScale,
  type TextObject,
  TransformObjects,
  cloneObject,
  countLabel,
  drawOrder,
  hasStroke,
  isCurve,
  isLine,
  objectLabel,
  objectNoun,
  patchedProps,
  pointsOf,
  propsEqual,
  propsOf,
} from '../model/model';
import { type DrawItem, buildDrawItems, objectLayoutFor, sheetLine } from '../model/scene';
import { DEFAULT_STROKE, type Stroke } from '../model/stroke';
import { VERB_LABEL, addedMessage, copiedMessage, deletedManyMessage, deletedMessage, duplicatedMessage, movedMessage, selectedManyText, selectedText, transformedManyMessage, transformedMessage } from './messages';
import { ANGLE_MAX_LENGTH, parseAngle } from './angle';
import { DEFAULT_TEXT_PT } from '../model/textStyle';
import { makePdfFile, makeProjectFile } from '../export/deliver';
import { exportFileName, projectFileName } from '../export/fileName';
import { type OpenedPdf, type PageInfo, closePdf, openPdf } from '../pdf/loader';
import { describeOpenError } from '../pdf/openError';
import { LIMITS, type Project, parseProject, serializeProject, verifyProjectText } from '../project/format';
import { sha256Hex } from '../project/hash';
import { comparePageGeometry, decideOutcome } from '../project/match';
import { SavedMark } from '../project/saved';
import { applyProject, snapshotProject, summarize } from '../project/session';
import { askRealDistance } from '../ui/calibrateDialog';
import { showDialog } from '../ui/dialog';
import { type ExportChoice, type ExportProgress, type ExportRunResult, showExportDialog } from '../ui/exportDialog';
import { type CheckedPdf, showOpenProjectDialog } from '../ui/openProjectDialog';
import { type SaveRunResult, showSaveDialog } from '../ui/saveDialog';
import { JPEG_QUALITY, type RasterPage } from '../export/flatPlan';
import { type Child, h } from '../ui/dom';
import { type IconName, icon } from '../ui/icons';
import { createGridControls } from '../ui/gridControls';
import { Keypad } from '../ui/keypad';
import { type MenuEntry, menuButton } from '../ui/menu';
import { type StyleBinding, type StyleKind, createStyleControls, styleGlyph } from '../ui/styleControls';
import { TouchReadout } from '../ui/touchReadout';
import { PdfViewer, type ViewerMode } from '../ui/viewer';
import { type AngularMode, Construction, type ConstructionTool, type TransformTool, isTransformTool } from './construction';
import { OUTSIDE_MESSAGE, SHELL_MAX_LENGTH, parseShellPoint, parseShellRadius } from './shell';
import { UI_SIZES, loadUiSize, saveUiSize } from './uiSize';

// Percorsi relativi alla pagina: l'app sta sotto /GT-Pdf/ su GitHub Pages.
const assetUrl = (path: string): string => new URL(path, document.baseURI).href;
const CSS_PX_PER_PT = 96 / 72; // 100 % = 96 px CSS per pollice; non e' la dimensione fisica sullo schermo
const COORD_TITLE_SHEET = 'X e Y dal bordo sinistro e dal bordo inferiore della pagina, in mm del foglio';
const COORD_TITLE_ORIGIN = 'X e Y relative all\'origine di questa pagina (Y verso l\'alto), nell\'unità indicata';

type ToolId = 'pan' | 'select' | ConstructionTool | 'erase';
interface Tool {
  id: string;
  label: string;
  icon: IconName;
  /** Checkpoint in cui la funzione arriva (strumenti non ancora attivi). */
  cp?: string;
  mode?: ViewerMode;
  needsDoc?: boolean;
  /** Strumento che non sta nella palette (si arma da un menu): l'Origine (CP6d). */
  hidden?: boolean;
}
const TOOLS: Tool[] = [
  { id: 'pan', label: 'Sposta vista', icon: 'hand', mode: 'pan' },
  { id: 'select', label: 'Seleziona', icon: 'mouse-pointer', mode: 'select', needsDoc: true },
  { id: 'segment', label: 'Retta', icon: 'slash', mode: 'pick', needsDoc: true },
  { id: 'polyline', label: 'Linea', icon: 'polyline', mode: 'pick', needsDoc: true },
  { id: 'curve', label: 'Cerchio e arco', icon: 'circle', mode: 'pick', needsDoc: true },
  { id: 'calibrate', label: 'Scala', icon: 'scaling', mode: 'pick', needsDoc: true },
  { id: 'distance', label: 'Distanza', icon: 'ruler-dimension', mode: 'pick', needsDoc: true },
  { id: 'erase', label: 'Cancella', icon: 'eraser', mode: 'erase', needsDoc: true },
  { id: 'dim', label: 'Quota', icon: 'ruler', mode: 'pick', needsDoc: true },
  { id: 'text', label: 'Testo', icon: 'type', mode: 'pick', needsDoc: true },
  { id: 'cover', label: 'Copertura', icon: 'square', mode: 'pick', needsDoc: true },
  // Origine (CP6d): strumento a un colpo armato dal menu Origine, NON in palette (la palette e' misurata per l'iPhone); dopo il clic si torna allo strumento di prima.
  { id: 'origin', label: 'Origine', icon: 'scaling', mode: 'pick', needsDoc: true, hidden: true },
  // Sposta, Specchio, Rotazione (CP6e): strumenti a punti che trasformano la SELEZIONE; si armano dai pulsanti della barra contestuale o dal menu Modifica con lo strumento
  // Seleziona, NON stanno in palette (come l'Origine: la palette e' misurata per l'iPhone). La selezione resta mentre sono armati.
  { id: 'move', label: 'Sposta', icon: 'mouse-pointer', mode: 'pick', needsDoc: true, hidden: true },
  { id: 'mirror', label: 'Specchio', icon: 'mouse-pointer', mode: 'pick', needsDoc: true, hidden: true },
  { id: 'rotate', label: 'Rotazione', icon: 'mouse-pointer', mode: 'pick', needsDoc: true, hidden: true },
];
const isConstructionTool = (id: ToolId): id is ConstructionTool => id !== 'pan' && id !== 'erase' && id !== 'select';
/** Testo o quota in corso di scrittura con il tastierino: non e' ancora nel documento (annulla = si scarta). */
type Entry = { kind: 'text'; at: UserPoint; text: string } | { kind: 'dim'; def: DimensionDef; text: string; auto: string | null };

/** Descrizione di un oggetto per il gancio di prova (vedi `__gtpdf.addSpecs`). Solo tipi: nessun costo nel build pubblicato. */
type Frac = [number, number];
type HookSpec =
  | { k: 'segment' | 'polyline'; pts: Frac[]; style?: Stroke['style']; color?: string; w?: number }
  | { k: 'cover'; shape: CoverKind; a: Frac; b: Frac }
  | { k: 'circle'; a: Frac; b: Frac; style?: Stroke['style']; color?: string; w?: number }
  | { k: 'arc'; a: Frac; b: Frac; c: Frac; style?: Stroke['style']; color?: string; w?: number }
  | { k: 'text'; at: Frac; text: string; pt?: number; color?: string }
  | { k: 'dim'; dim: DimType; pts: Frac[]; value?: string | null; color?: string; w?: number; pt?: number };

/** Suggerimenti (title) e messaggi di stato degli interruttori di snap, uno per tipo (CP6f: i nuovi sono al femminile o al maschile come il loro nome). */
const SNAP_TITLE: Record<SnapSwitch, string> = {
  end: 'Snap sugli estremi: il punto si aggancia agli estremi di rette, linee, archi, quote e coperture e ai punti già indicati',
  mid: 'Snap sui punti medi: il punto si aggancia al centro dei tratti, dei lati delle coperture e degli archi',
  center: 'Snap sul centro: il punto si aggancia al centro di cerchi, archi e coperture circolari',
  intersection: 'Snap sull\'intersezione: il punto si aggancia a dove due linee, cerchi o archi si incontrano (solo dentro le linee, senza prolungamenti)',
  quadrant: 'Snap sul quadrante: il punto si aggancia ai quattro punti di cerchi, archi e coperture circolari (destra, basso, sinistra e alto del foglio come lo vedi)',
  perpendicular: 'Snap sulla perpendicolare: dopo il primo punto il punto si aggancia al piede della perpendicolare da quel punto su linee, cerchi e archi',
  tangent: 'Snap sulla tangente: dopo il primo punto il punto si aggancia al punto di tangenza da quel punto su cerchi e archi',
};
const SNAP_MESSAGE: Record<SnapSwitch, { on: string; off: string }> = {
  end: { on: 'Estremo attivo: il punto si aggancia agli estremi di rette, linee, archi, quote e coperture e ai punti già indicati', off: 'Estremo disattivato' },
  mid: { on: 'Punto medio attivo: il punto si aggancia al centro dei tratti, dei lati delle coperture e degli archi', off: 'Punto medio disattivato' },
  center: { on: 'Centro attivo: il punto si aggancia al centro di cerchi, archi e coperture circolari', off: 'Centro disattivato' },
  intersection: { on: 'Intersezione attiva: il punto si aggancia a dove due linee, cerchi o archi si incontrano', off: 'Intersezione disattivata' },
  quadrant: { on: 'Quadrante attivo: il punto si aggancia ai quattro punti di cerchi, archi e coperture circolari', off: 'Quadrante disattivato' },
  perpendicular: { on: 'Perpendicolare attiva: dopo il primo punto il punto si aggancia al piede della perpendicolare su linee, cerchi e archi', off: 'Perpendicolare disattivata' },
  tangent: { on: 'Tangente attiva: dopo il primo punto il punto si aggancia al punto di tangenza su cerchi e archi', off: 'Tangente disattivata' },
};

export interface AppOptions {
  openDiagnostics: () => void;
}

export function mountApp(root: HTMLElement, opts: AppOptions): void {
  // ---------- Stato della sessione ----------
  let pdf: OpenedPdf | null = null;
  let pageNo = 1;
  const model = new DocumentModel();
  const history = new History<DocumentModel>(model);
  /** Modifiche non salvate: il modello e' cambiato dopo l'ultimo salvataggio del progetto o dopo l'apertura (5c). */
  const saved = new SavedMark(() => model.version);
  let tool: ToolId = 'pan';
  let uiSize = loadUiSize();
  let opening = false;
  let ortho = false;
  /**
   * Snap sugli oggetti: Estremo e Punto medio (V2a), Centro (V2b), Intersezione, Quadrante, Perpendicolare e Tangente (CP6f), tutti attivi all'avvio. Stato della sessione: NON si
   * salva nel progetto (come ORTO). L'Origine non ha un interruttore: e' un candidato quando la pagina ha un'origine e c'e' almeno un interruttore acceso.
   */
  const snapOn: Record<SnapSwitch, boolean> = { end: true, mid: true, center: true, intersection: true, quadrant: true, perpendicular: true, tangent: true };
  /** La scena dei tipi calcolati (riquadri in pt del foglio): si rifa' quando cambiano gli oggetti o la pagina (versione del modello), non a ogni movimento del mouse. */
  let snapScene: SnapScene | null = null;
  let snapSceneKey = '';
  let snapSceneGeom: PageGeometry | null = null;
  /** Griglia (V2a): spenta all'avvio; passo in mm (reali se la pagina ha una scala, del foglio se no). Stato della sessione: NON si salva nel progetto. */
  let gridOn = false;
  let gridMm = GRID_DEFAULT_MM;
  /** Ultimo passo in pt (pagina corrente) e ultima visibilita' comunicati: servono a dire in un messaggio quando una ricalibrazione o lo zoom li cambiano. */
  let gridReportedPt = 0;
  let gridWasVisible = false;
  /** Proprieta' dei NUOVI oggetti: tipo di linea, colore e spessore (anche delle quote), corpo del testo (testi e quote). */
  const stroke: Stroke = { ...DEFAULT_STROKE };
  let textPt = DEFAULT_TEXT_PT;
  /** Tipo della quota che si sta per disegnare. */
  let dimType: DimType = 'aligned';
  /** Come si costruisce la quota angolare: da due linee (predefinito) o da tre punti. Stato della sessione, non si salva. */
  let angularMode: AngularMode = 'lines';
  /** Forma della copertura che si sta per disegnare. */
  let coverKind: CoverKind = 'rect';
  /** Cerchio o arco che si sta per disegnare. */
  let curveKind: CurveKind = 'circle';
  /** Lo strumento a cui tornare dopo il clic dell'Origine (strumento a un colpo, CP6d) o dopo averla disarmata; null se l'Origine non e' armata. */
  let originReturn: ToolId | null = null;
  /**
   * Oggetti selezionati (id) nella pagina corrente: uno o piu' (CP6e, Ctrl + clic), solo con lo strumento Seleziona (e mentre Sposta, Specchio o Rotazione sono armati).
   * Si sostituisce sempre con un nuovo insieme (mai modificato sul posto). Si azzera con cambio di pagina, cambio di strumento, Esc e chiusura del documento.
   */
  let selection: ReadonlySet<number> = new Set();
  /** "Mantieni l'originale" (decisione 77): spento di partenza; stato della sessione, NON si salva nel progetto. */
  let keepOriginal = false;
  /** Gli id che sta spostando il trascinamento in corso (calcolati una volta per gesto). */
  let dragIds: number[] | null = null;
  /** L'anteprima di una trasformazione e' sul foglio / l'ultimo motivo di rifiuto mostrato (per dirlo una volta sola e non a ogni movimento del mouse). */
  let ghostShown = false;
  let lastTransformProblem: string | null = null;
  /** Punto che verrebbe inserito adesso (mira o passaggio del mouse), nello spazio utente. */
  let currentAim: UserPoint | null = null;
  /** Testo o valore di quota in corso di scrittura con il tastierino (non e' ancora nel documento). */
  let entry: Entry | null = null;

  // ---------- Vista ----------
  const statusMsg = h('span', { class: 'st-msg', role: 'status', 'aria-live': 'polite' });
  const say = (text: string): void => {
    statusMsg.textContent = text;
  };
  // Lettura di schermo, zoom e puntatori nel pannello App (CP5d): si aggiorna solo se il riquadro e' aperto.
  const touchReadout = new TouchReadout();
  const viewer = new PdfViewer(
    (s) => touchReadout.setStats(s),
    (msg, level) => {
      if (level === 'err') say(msg);
    },
  );

  // ---------- Costruzione per punti ----------
  const construction = new Construction(
    { geometry: () => viewer.geometry, zoom: () => viewer.zoomValue, ortho: () => ortho, snap: (raw, touch, pending) => snapAt(raw, touch, pending), grid: () => gridActiveStepPt(), gridOrigin: () => originSheet() },
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
      curve: (kind, points) => {
        const g = viewer.geometry;
        const [p1, p2, p3] = points.map((p) => ({ ...p })) as [UserPoint, UserPoint, UserPoint];
        const obj: CircleObject | ArcObject = kind === 'circle' ? { id: model.newId(), kind, p1, p2, stroke: { ...stroke } } : { id: model.newId(), kind, p1, p2, p3, stroke: { ...stroke } };
        history.exec(new AddObject(pageNo, obj));
        const arc = g ? curveOnSheet(obj, g) : null;
        say(addedMessage(obj, arc ? `raggio ${mmText(arc.r)}` : undefined));
      },
      origin: (at) => onOriginPoint(at),
      transform: (kind, points) => onTransformPoints(kind, points),
      reject: say,
    },
  );

  /** L'origine della pagina corrente sul foglio mostrato (pt fisici), o null. */
  function originSheet(): SheetPoint | null {
    const g = viewer.geometry;
    const o = pdf ? model.origin(pageNo) : null;
    return g && o ? g.userToSheet(o) : null;
  }
  /** Il riferimento delle coordinate relative della pagina corrente (origine e unita'), o null se la pagina non ha un'origine. */
  function currentFrame(): OriginFrame | null {
    const g = viewer.geometry;
    const o = pdf ? model.origin(pageNo) : null;
    return g && o ? originFrame(g, o, model.scale(pageNo)) : null;
  }

  /** La scena della pagina corrente, rifatta solo se sono cambiati il modello (versione) o la pagina. */
  function sceneFor(g: PageGeometry): SnapScene {
    const key = `${model.version}:${pageNo}`;
    if (!snapScene || snapSceneKey !== key || snapSceneGeom !== g) {
      snapScene = buildSnapScene(model.objects(pageNo), g);
      snapSceneKey = key;
      snapSceneGeom = g;
    }
    return snapScene;
  }
  /**
   * Snap sugli oggetti della pagina corrente: il candidato piu' vicino al punto grezzo (foglio) entro il raggio (px CSS / zoom), tra i tipi attivi. Perpendicolare e Tangente
   * partono dall'ancora della costruzione (`construction.anchor`, la stessa dell'ORTO): solo dove c'e'. L'origine della pagina e' un candidato (CP6f).
   */
  function snapAt(raw: SheetPoint, touch: boolean, pending: readonly UserPoint[]): SnapHit | null {
    const g = viewer.geometry;
    if (!g || !pdf || !SNAP_KINDS.some((k) => snapOn[k])) return null;
    const calc = snapOn.intersection || snapOn.quadrant || snapOn.perpendicular || snapOn.tangent;
    return findSnap(model.objects(pageNo), g, raw, snapRadiusPt(touch, viewer.zoomValue), snapOn, pending, { scene: calc ? sceneFor(g) : undefined, anchor: construction.anchor, origin: model.origin(pageNo) });
  }

  /** Passo della griglia in pt FISICI del foglio per la pagina corrente (mm reali con la scala della pagina, altrimenti mm del foglio). */
  const gridStepNow = (): number => gridStepPt(gridMm, model.scale(pageNo));
  /** Il passo se la griglia e' accesa e si vede a questo zoom (allora disegna e arrotonda), altrimenti null. */
  function gridActiveStepPt(): number | null {
    if (!gridOn || !pdf) return null;
    const step = gridStepNow();
    return gridVisible(step, viewer.zoomValue) ? step : null;
  }
  /** "10 mm reali = 28.35 pt sul foglio" / "10 mm del foglio = 28.35 pt sul foglio". */
  const gridStepText = (): string => `${fmtTrim(gridMm, 3)} mm ${model.scale(pageNo) ? 'reali' : 'del foglio'} = ${fmt(gridStepNow())} pt sul foglio`;
  /** Avviso quando la griglia e' accesa ma a questo zoom e' troppo fitta: non si vede e non arrotonda. */
  const gridHiddenNote = (): string => (gridOn && pdf && !gridVisible(gridStepNow(), viewer.zoomValue) ? ` Ma a questo zoom il passo è sotto ${GRID_MIN_SCREEN_PX} px: la griglia non si vede e non arrotonda.` : '');
  /** Rimanda al visore il passo della pagina corrente e rilegge il controllo del pannello. */
  function refreshGrid(): void {
    viewer.setOrigin(pdf ? model.origin(pageNo) : null); // simbolo e nodi della griglia: l'origine e' un dato della pagina corrente
    viewer.setGrid(gridOn && pdf ? gridStepNow() : null);
    gridWasVisible = gridActiveStepPt() !== null;
    gridCtl.refresh();
    renderCursor(); // X e Y della barra di stato dipendono da origine, scala e pagina
  }
  /**
   * Nota per il messaggio di stato dopo un cambio di scala (ricalibrazione, annulla/ripeti di una scala): il passo in mm non cambia ma quello in pt del foglio si'.
   * Vuota se la griglia e' spenta o il passo in pt e' lo stesso.
   */
  function gridRecalNote(): string {
    if (!gridOn || !pdf) return '';
    const now = gridStepNow();
    const was = gridReportedPt;
    gridReportedPt = now;
    if (!was || Math.abs(now - was) < 1e-9) return '';
    return ` La griglia (${fmtTrim(gridMm, 3)} mm ${model.scale(pageNo) ? 'reali' : 'del foglio'}) passa da ${fmt(was)} a ${fmt(now)} pt sul foglio.`;
  }

  /** Una lunghezza in pt del foglio, in mm reali se la pagina e' calibrata, altrimenti in mm del foglio. */
  function mmText(dPt: number): string {
    const s = model.scale(pageNo);
    return s ? `${fmt(realMm(dPt, s))} mm` : `${fmt(ptToMm(dPt))} mm sul foglio (pagina non calibrata)`;
  }
  /** Lunghezza totale di una spezzata, in mm reali se la pagina e' calibrata, altrimenti in mm del foglio. */
  function lengthText(points: readonly UserPoint[]): string {
    const g = viewer.geometry;
    if (!g) return '';
    let dPt = 0;
    for (let i = 1; i < points.length; i++) dPt += g.distancePt(points[i - 1] as UserPoint, points[i] as UserPoint);
    return mmText(dPt);
  }

  // ---------- Barra di stato ----------
  const stX = h('span', { class: 'num' }, '—');
  const stY = h('span', { class: 'num' }, '—');
  // Con un'origine sulla pagina X e Y sono relative all'origine, nell'unita' della shell (mm reali con la scala, mm del foglio senza): l'etichetta dell'unita' lo dice (CP6d).
  const stUnitX = h('span', { class: 'unit' }, 'mm');
  const stUnitY = h('span', { class: 'unit' }, 'mm');
  const stCoord = h('span', { class: 'st-coord', title: COORD_TITLE_SHEET }, h('span', { class: 'lbl' }, 'X:'), stX, stUnitX, h('span', { class: 'lbl' }, 'Y:'), stY, stUnitY);
  const stPage = h('span', { class: 'num st-page' }, '');
  const prevBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina precedente', disabled: true, onclick: () => void goTo(pageNo - 1) }, icon('chevron-left'));
  const nextBtn = h('button', { class: 'btn st-btn', type: 'button', 'aria-label': 'Pagina successiva', disabled: true, onclick: () => void goTo(pageNo + 1) }, icon('chevron-right'));
  const pager = h('div', { class: 'st-pager' }, prevBtn, stPage, nextBtn);
  const scaleBtn = h('button', { class: 'st-scale-btn num', type: 'button', title: 'Calibra la scala di questa pagina', onclick: () => selectTool('calibrate') }, 'non calibrata');
  /** Interruttore della barra di stato: stesso componente per Estremo, Punto medio, Centro, Intersezione e ORTO (`data-toggle` li distingue). */
  const mkToggle = (id: 'end' | 'mid' | 'center' | 'intersection' | 'ortho', label: string, title: string, on: boolean, fn: () => void): HTMLButtonElement =>
    h('button', { class: 'st-toggle', type: 'button', 'aria-pressed': String(on), 'data-toggle': id, title, onclick: fn }, label);
  const endBtn = mkToggle('end', SNAP_LABEL.end, SNAP_TITLE.end, snapOn.end, () => setSnap('end', !snapOn.end));
  const midBtn = mkToggle('mid', SNAP_LABEL.mid, SNAP_TITLE.mid, snapOn.mid, () => setSnap('mid', !snapOn.mid));
  const centerBtn = mkToggle('center', SNAP_LABEL.center, SNAP_TITLE.center, snapOn.center, () => setSnap('center', !snapOn.center));
  const interBtn = mkToggle('intersection', SNAP_LABEL.intersection, SNAP_TITLE.intersection, snapOn.intersection, () => setSnap('intersection', !snapOn.intersection));
  const orthoBtn = mkToggle('ortho', 'ORTO', 'Ortogonale: il secondo punto va in orizzontale o in verticale', false, () => setOrtho(!ortho));
  const gridBtn = h('button', { class: 'st-toggle', type: 'button', 'aria-pressed': 'false', 'data-toggle': 'grid', title: 'Griglia: mostra i nodi e arrotonda i punti ai nodi (passo nel pannello a destra)', onclick: () => setGridOn(!gridOn) }, 'Griglia');
  // Gli stessi interruttori stanno anche nel pannello a destra ("Aggancio e griglia"): sotto 720 px la barra di stato resta compatta (X, Y, scala, ORTO: DESIGN.md) e
  // quei tre vivono solo li'. Ogni interruttore ha piu' pulsanti, che mostrano tutti lo stesso stato.
  const toggleBtns: Record<SnapSwitch | 'grid', HTMLButtonElement[]> = { end: [endBtn], mid: [midBtn], center: [centerBtn], intersection: [interBtn], quadrant: [], perpendicular: [], tangent: [], grid: [gridBtn] };
  const setPressed = (id: SnapSwitch | 'grid', on: boolean): void => {
    for (const b of toggleBtns[id]) b.setAttribute('aria-pressed', String(on));
  };
  const panelToggle = (id: SnapSwitch | 'grid', label: string, title: string, on: boolean, fn: () => void): HTMLButtonElement => {
    const b = h('button', { class: 'btn panel-toggle', type: 'button', 'aria-pressed': String(on), 'data-panel-toggle': id, title, onclick: fn }, label);
    toggleBtns[id].push(b);
    return b;
  };
  const statusbar = h(
    'footer',
    { class: 'statusbar' },
    stCoord,
    h('span', { class: 'st-scale' }, h('span', { class: 'lbl' }, 'SCALA:'), scaleBtn),
    endBtn,
    midBtn,
    centerBtn,
    interBtn,
    orthoBtn,
    gridBtn,
    statusMsg,
    pager,
  );
  /** Ultima posizione del cursore sul foglio (pt fisici), o null se e' fuori dalla pagina: serve a rifare i valori quando cambiano origine, scala, zoom o pagina. */
  let lastCursor: SheetPoint | null = null;
  function renderCursor(): void {
    const f = currentFrame();
    const unit = f ? relUnitLabel(model.scale(pageNo)) : 'mm';
    stUnitX.textContent = unit;
    stUnitY.textContent = unit;
    stCoord.title = f ? COORD_TITLE_ORIGIN : COORD_TITLE_SHEET;
    const p = lastCursor;
    if (!p) {
      stX.textContent = '—';
      stY.textContent = '—';
      return;
    }
    if (f) {
      const r = sheetToRel(f, p); // relative all'origine: X a destra, Y verso l'alto, anche a sinistra e sotto l'origine (valori negativi)
      stX.textContent = fmt(r.x);
      stY.textContent = fmt(r.y);
      return;
    }
    stX.textContent = fmt(ptToMm(p.x));
    stY.textContent = fmt(ptToMm(viewer.sheetSize.h - p.y)); // Y verso l'alto dal bordo inferiore della pagina mostrata
  }
  const setCursor = (p: { x: number; y: number } | null): void => {
    lastCursor = p;
    renderCursor();
  };
  function setOrtho(on: boolean): void {
    ortho = on;
    orthoBtn.setAttribute('aria-pressed', String(on));
    say(on ? 'Ortogonale attivo: il punto successivo va in orizzontale o in verticale' : 'Ortogonale disattivato');
    viewer.refreshAim();
  }
  function setSnap(kind: SnapSwitch, on: boolean): void {
    snapOn[kind] = on;
    setPressed(kind, on);
    const m = SNAP_MESSAGE[kind];
    say(on ? m.on : m.off);
    viewer.refreshAim();
  }
  function setGridOn(on: boolean): void {
    gridOn = on;
    setPressed('grid', on);
    gridReportedPt = on ? gridStepNow() : 0;
    refreshGrid();
    say(on ? `Griglia attiva: passo ${gridStepText()}.${gridHiddenNote()}` : 'Griglia disattivata');
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
    { label: 'Apri progetto…', onSelect: () => void openProjectFlow() },
    { label: 'Salva con nome…', disabled: !pdf, onSelect: () => void saveFlow() },
    { label: 'Esporta PDF…', disabled: !pdf, onSelect: () => void exportFlow() },
    { label: 'Chiudi', disabled: !pdf, onSelect: () => void closeFlow() },
    'separator',
    { label: 'Diagnostica', onSelect: opts.openDiagnostics },
  ];
  const editMenu = (): MenuEntry[] => {
    // Le voci sulla selezione (CP6e) valgono con lo strumento Seleziona e almeno un oggetto selezionato; la Rotazione anche solo con mouse o trackpad (l'angolo si digita).
    const hasSel = !!pdf && tool === 'select' && selection.size > 0;
    return [
      { label: 'Annulla', hint: construction.pending ? 'ultimo punto' : (history.nextUndo ?? undefined), disabled: !canUndo(), onSelect: () => undoAction() },
      { label: 'Ripeti', hint: history.nextRedo ?? undefined, disabled: !history.canRedo || isTransformTool(tool), onSelect: () => redoAction() },
      'separator',
      { label: 'Seleziona / sposta', disabled: !pdf, onSelect: () => selectTool('select') },
      { label: 'Sposta selezione', disabled: !hasSel, onSelect: () => armTransform('move') },
      { label: 'Specchia selezione', disabled: !hasSel, onSelect: () => armTransform('mirror') },
      { label: 'Ruota selezione', hint: desktopPointer() ? undefined : 'mouse', disabled: !hasSel || !desktopPointer(), onSelect: () => armTransform('rotate') },
      { label: 'Duplica selezione', disabled: !hasSel, onSelect: () => duplicateSelected() },
      { label: 'Cancella selezione', disabled: !hasSel, onSelect: () => deleteSelected() },
      { label: 'Cancella', disabled: !pdf, onSelect: () => selectTool('erase') },
    ];
  };
  const insertMenu = (): MenuEntry[] => [
    { label: 'Retta', disabled: !pdf, onSelect: () => selectTool('segment') },
    { label: 'Linea', disabled: !pdf, onSelect: () => selectTool('polyline') },
    ...CURVE_TYPES.map((t): MenuEntry => ({ label: t.label, disabled: !pdf, onSelect: () => selectCurveKind(t.id) })),
    'separator',
    { label: 'Testo', disabled: !pdf, onSelect: () => selectTool('text') },
    ...DIM_TYPES.flatMap((t): MenuEntry[] =>
      t.id === 'angular'
        ? [
            { label: `${t.label} da due linee`, disabled: !pdf, onSelect: () => selectAngularMode('lines') },
            { label: `${t.label} da tre punti`, disabled: !pdf, onSelect: () => selectAngularMode('points') },
          ]
        : [{ label: t.label, disabled: !pdf, onSelect: () => selectDimType(t.id) }],
    ),
    ...COVER_TYPES.map((t): MenuEntry => ({ label: t.label, disabled: !pdf, onSelect: () => selectCoverKind(t.id) })),
    { label: 'Raccordo', hint: 'V2c', disabled: true },
  ];
  const originMenu = (): MenuEntry[] => [
    { label: 'Imposta origine', disabled: !pdf, onSelect: () => armOrigin() },
    { label: 'Rimuovi origine', disabled: !pdf || model.origin(pageNo) === null, onSelect: () => removeOrigin() },
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
    h('nav', { class: 'menus', 'aria-label': 'Menu' }, menuButton('File', fileMenu), menuButton('Modifica', editMenu), menuButton('Inserisci', insertMenu), menuButton('Origine', originMenu), menuButton('Zoom', zoomMenu)),
    docName,
    h('div', { class: 'bar-right' }, h('div', { class: 'undo-ctl' }, undoBtn, redoBtn), h('div', { class: 'size-ctl' }, sizeDown, sizeUp), h('div', { class: 'zoom-ctl' }, zoomOutBtn, zoomLabel, zoomInBtn), inspectorBtn),
  );

  // ---------- Palette ----------
  const toolBtns = new Map<string, HTMLButtonElement>();
  const palette = h('nav', { class: 'palette', 'aria-label': 'Strumenti' });
  for (const t of TOOLS) {
    if (t.hidden) continue;
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
  // "Adatta alla pagina" in fondo alla palette (desktop, da 720 px; aggiunta a CP6e, decisione 83): fa quello che fanno la voce del menu Zoom e il valore percentuale della barra,
  // `viewer.fit()`, e basta (nessun comando, nessun cambio di strumento o di selezione). NON e' uno strumento: niente classe `tool`, niente `TOOLS`, niente `toolBtns`, niente
  // `aria-pressed` (la palette e' misurata per l'iPhone). Sta in un contenitore *sticky* in fondo alla palette: con la finestra bassa gli strumenti scorrono e il pulsante resta in vista;
  // scorrendo fino in fondo l'ultimo strumento sta sopra il pulsante, non sotto. Sotto i 720 px e col tocco con poca altezza e' nascosto (app.css): li' c'e' gia' quello della colonna sul foglio.
  const fitBtn = h('button', { class: 'palette-fit', type: 'button', 'aria-label': 'Adatta alla pagina', title: 'Adatta alla pagina', disabled: true, onclick: () => viewer.fit() }, icon('maximize'));
  const paletteDock = h('div', { class: 'palette-dock' }, fitBtn);
  palette.append(paletteDock);

  // ---------- Proprieta' ----------
  /** L'oggetto selezionato se ce n'e' UNO solo (solo con lo strumento Seleziona): con piu' oggetti le proprieta' non lavorano sul gruppo (CP6e). */
  function selObj(): PageObject | undefined {
    if (selection.size !== 1) return undefined;
    const [id] = selection;
    return id === undefined ? undefined : model.get(pageNo, id);
  }
  /** Gli oggetti selezionati, nell'ordine dell'elenco del modello (le copie e i comandi usano questo ordine). */
  function selectedObjects(): PageObject[] {
    if (selection.size === 0) return [];
    const out: PageObject[] = [];
    for (const o of model.objects(pageNo)) if (selection.has(o.id)) out.push(o);
    return out;
  }
  /** Quali controlli servono a un oggetto: quelli delle sue proprieta' (la copertura non ne ha). */
  const kindOfObject = (o: PageObject): StyleKind => (hasStroke(o) ? 'line' : o.kind === 'text' ? 'text' : o.kind === 'dim' ? 'dim' : 'none');
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
      if (selection.size >= 2) return; // con piu' oggetti selezionati i controlli non lavorano sul gruppo e NON devono cambiare le proprieta' dei nuovi oggetti
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
      if (selection.size >= 2) return;
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
    const multi = selection.size >= 2;
    const kind = styleKind(); // il contenuto del riquadro non cambia con piu' oggetti (resta nascosto ma tiene il suo posto: la barra non cambia altezza)
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
    popoverStyle.setKind(multi ? 'none' : kind);
    inspectorStyle.setKind(o ? kind : multi ? 'none' : 'all');
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
  const cancelBtn = h('button', { class: 'btn ctx-act', type: 'button', onclick: () => (tool === 'origin' ? disarmOrigin() : isTransformTool(tool) ? cancelTransform() : cancelConstruction()) }, 'Annulla');
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
  const curveTypeBtns = new Map<CurveKind, HTMLButtonElement>();
  const curveTypes = h('div', { class: 'ctx-curves seg', role: 'group', 'aria-label': 'Cerchio o arco', hidden: true });
  for (const t of CURVE_TYPES) {
    const b = h('button', { class: 'btn seg-btn', type: 'button', 'aria-pressed': String(t.id === curveKind), title: t.label, onclick: () => selectCurveKind(t.id) }, t.label);
    curveTypeBtns.set(t.id, b);
    curveTypes.append(b);
  }
  // Shell (CP6d, decisioni 59 e 71): casella per digitare i punti relativi all'origine, nella parte centrale della barra (tra il testo guida e i pulsanti). Compare solo con
  // un'origine sulla pagina, uno strumento che la usa (Retta, Linea, Cerchio) e un puntatore preciso con hover (desktop): vedi `shellStepNow`.
  const shellInput = h('input', {
    class: 'field num ctx-shell-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: SHELL_MAX_LENGTH,
    placeholder: 'X;Y',
    'aria-label': 'Coordinate X;Y relative all\'origine',
  });
  const shellUnit = h('span', { class: 'ctx-shell-unit num' }, 'mm');
  const shellBox = h('div', { class: 'ctx-shell', hidden: true }, shellInput, shellUnit);
  // Trasformazioni (CP6e): pulsanti Sposta, Specchio, Rotazione con lo strumento Seleziona (sempre presenti, disattivati senza selezione: la barra non cambia altezza
  // selezionando), e durante la trasformazione l'interruttore "Mantieni l'originale" e, per la Rotazione, la casella dell'angolo (come la shell: solo con un puntatore
  // preciso con hover) e il pulsante "Origine" come centro.
  const trBtn = (kind: TransformTool, label: string, title: string): HTMLButtonElement =>
    h('button', { class: 'btn ctx-act ctx-tr', type: 'button', 'data-transform': kind, title, onclick: () => armTransform(kind) }, label);
  const trMoveBtn = trBtn('move', 'Sposta', 'Sposta la selezione: punto base e punto di arrivo');
  const trMirrorBtn = trBtn('mirror', 'Specchio', 'Specchia la selezione rispetto a un asse indicato con due punti');
  const trRotateBtn = trBtn('rotate', 'Rotazione', 'Ruota la selezione attorno a un centro: digita l\'angolo in gradi (solo con mouse o trackpad)');
  const keepBtn = h('button', { class: 'btn ctx-act ctx-keep', type: 'button', 'aria-pressed': 'false', hidden: true, title: 'Acceso: gli originali restano e la trasformazione crea copie', onclick: () => setKeepOriginal(!keepOriginal) }, 'Mantieni l\'originale');
  // Quota angolare: un interruttore (come "Mantieni l'originale") sceglie fra "da due linee" (spento, la richiesta dell'utente) e "da tre punti" (acceso): nessuna riga in piu' nella barra
  const angModeBtn = h('button', { class: 'btn ctx-act ctx-angmode', type: 'button', 'aria-pressed': 'false', hidden: true, title: 'Acceso: la quota angolare si costruisce indicando vertice, un punto per lato e il raggio dell\'arco. Spento: si scelgono due linee', onclick: () => selectAngularMode(angularMode === 'lines' ? 'points' : 'lines') }, 'Da 3 punti');
  const angleInput = h('input', {
    class: 'field num ctx-angle-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: ANGLE_MAX_LENGTH,
    placeholder: 'gradi',
    title: 'Angolo in gradi decimali con il punto; positivo = antiorario, negativo = orario',
    'aria-label': 'Angolo di rotazione in gradi (positivo antiorario)',
  });
  const originCenterBtn = h('button', { class: 'btn ctx-act ctx-origin-center', type: 'button', title: 'Usa l\'origine della pagina come centro', onclick: () => useOriginAsCenter() }, 'Origine');
  const angleBox = h('div', { class: 'ctx-angle', hidden: true }, angleInput, h('span', { class: 'ctx-angle-unit num' }, '°'), originCenterBtn);
  const popover = h('div', { class: 'props-pop', role: 'group', 'aria-label': 'Proprietà', hidden: true }, popoverStyle.el);
  const ctxBar = h('section', { class: 'ctxbar', 'aria-label': 'Strumento attivo', hidden: true }, ctxHint, dimTypes, coverTypes, curveTypes, shellBox, angleBox, h('div', { class: 'ctx-actions' }, styleChip, trMoveBtn, trMirrorBtn, trRotateBtn, keepBtn, angModeBtn, cancelBtn, finishBtn), popover);
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

  // ---------- Griglia: passo ----------
  const gridCtl = createGridControls({
    get: () => gridMm,
    set: (mm) => {
      gridMm = mm;
      gridReportedPt = gridOn ? gridStepNow() : 0;
      refreshGrid();
      say(`Passo della griglia: ${gridStepText()}.${gridOn ? gridHiddenNote() : ' La griglia è spenta: accendila dalla barra di stato.'}`);
      viewer.refreshAim();
    },
    note: () => {
      if (!pdf) return 'Il passo è in mm del foglio finché la pagina non è calibrata, poi in mm reali.';
      const s = model.scale(pageNo);
      return s ? `Pagina calibrata (${scaleLabel(s)}): il passo è in mm REALI, ora ${fmt(gridStepNow())} pt sul foglio.` : `Pagina non calibrata: il passo è in mm del FOGLIO (${fmt(gridStepNow())} pt). Dopo la calibrazione sarà in mm reali.`;
    },
  });
  const snapPanelToggles = h(
    'div',
    { class: 'panel-toggles', role: 'group', 'aria-label': 'Aggancio e griglia' },
    panelToggle('end', SNAP_LABEL.end, endBtn.title, snapOn.end, () => setSnap('end', !snapOn.end)),
    panelToggle('mid', SNAP_LABEL.mid, midBtn.title, snapOn.mid, () => setSnap('mid', !snapOn.mid)),
    panelToggle('center', SNAP_LABEL.center, centerBtn.title, snapOn.center, () => setSnap('center', !snapOn.center)),
    panelToggle('intersection', SNAP_LABEL.intersection, interBtn.title, snapOn.intersection, () => setSnap('intersection', !snapOn.intersection)),
    panelToggle('quadrant', SNAP_LABEL.quadrant, SNAP_TITLE.quadrant, snapOn.quadrant, () => setSnap('quadrant', !snapOn.quadrant)),
    panelToggle('perpendicular', SNAP_LABEL.perpendicular, SNAP_TITLE.perpendicular, snapOn.perpendicular, () => setSnap('perpendicular', !snapOn.perpendicular)),
    panelToggle('tangent', SNAP_LABEL.tangent, SNAP_TITLE.tangent, snapOn.tangent, () => setSnap('tangent', !snapOn.tangent)),
    panelToggle('grid', 'Griglia', gridBtn.title, false, () => setGridOn(!gridOn)),
  );

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
    secs.push(section('Aggancio e griglia', snapPanelToggles, gridCtl.el));
    const so = selObj();
    const nSel = selection.size;
    secs.push(
      section(
        so ? 'Proprietà (oggetto selezionato)' : nSel >= 2 ? `Proprietà (${nSel} oggetti selezionati)` : 'Proprietà (nuovi oggetti)',
        ...(so ? [kv('Selezionato', objectLabel(so))] : []),
        ...(nSel >= 2 ? [h('p', { class: 'hint' }, 'Le proprietà non si cambiano a gruppo: seleziona un solo oggetto. Le proprietà dei nuovi oggetti non cambiano.')] : []),
        ...(so && kindOfObject(so) === 'none' ? [h('p', { class: 'hint' }, 'Le coperture sono bianche e senza bordo: non hanno proprietà da cambiare.')] : []),
        inspectorStyle.el,
      ),
    );
    secs.push(section('App', kv('Versione', __BUILD_ID__), touchReadout.el, h('a', { class: 'hint licenses-link', href: assetUrl('licenses/index.html'), target: '_blank', rel: 'noopener' }, 'Licenze e componenti di terze parti')));
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
  // Il pannello scorre se non entra nel visore (CP5e); logo e testi stanno in un solo contenitore centrato con `margin: auto` (non taglia in alto), che in
  // orizzontale su touch con poca altezza mette il logo accanto al resto (app.css).
  const emptyPanel = h(
    'div',
    { class: 'empty-panel' },
    h(
      'div',
      { class: 'empty-inner' },
      h('img', { class: 'empty-logo', src: assetUrl('brand/logo-empty-384.png'), width: 160, height: 160, alt: 'GT-Pdf' }),
      h(
        'div',
        { class: 'empty-body' },
        h('p', { class: 'empty-title' }, 'Nessun documento aperto'),
        emptyOpenBtn,
        h('p', { class: 'hint' }, 'Il file resta su questo dispositivo: nulla viene inviato.'),
        h('details', { class: 'samples-box' }, h('summary', null, 'PDF di prova (fittizi)'), samples),
      ),
    ),
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
  /** `keepSelection`: la selezione resta (fine o annullamento di una trasformazione); Sposta, Specchio e Rotazione la tengono sempre. */
  function selectTool(id: ToolId, opts: { keepSelection?: boolean } = {}): void {
    const def = TOOLS.find((t) => t.id === id);
    if (!def || def.cp) return;
    if (def.needsDoc && !pdf) return;
    cancelEntry();
    if (id !== 'origin') originReturn = null; // l'Origine armata si disarma scegliendo un altro strumento
    shellInput.value = '';
    shellInput.removeAttribute('aria-invalid');
    angleInput.value = '';
    angleInput.removeAttribute('aria-invalid');
    tool = id;
    if (!(opts.keepSelection || isTransformTool(id))) selection = new Set(); // la selezione vale solo con lo strumento Seleziona
    renderSelection();
    toggleProps(false);
    construction.setTool(isConstructionTool(id) ? id : null);
    if (id === 'dim') {
      construction.setDimType(dimType);
      construction.angularMode = angularMode;
    }
    if (id === 'cover') construction.setCoverKind(coverKind);
    if (id === 'curve') construction.setCurveKind(curveKind);
    currentAim = null;
    viewer.setMode(def.mode ?? 'pan');
    viewer.setHighlight(null);
    clearGhost();
    for (const [tid, b] of toolBtns) b.setAttribute('aria-pressed', String(tid === (isTransformTool(id) ? 'select' : id))); // durante una trasformazione resta acceso Seleziona
    floatDist.setAttribute('aria-pressed', String(id === 'distance'));
    say('');
    refreshStyleChip();
    renderInspector();
    renderConstruction();
    revealTool(id); // per ultimo: la barra contestuale appena comparsa o sparita cambia l'altezza della palette
  }

  // ---------- Origine (CP6d, decisioni 58 e 72) ----------
  /**
   * "Imposta origine" arma l'Origine come strumento a UN COLPO: il clic imposta (o sposta) l'origine e si torna allo strumento di prima (motivo: l'origine si imposta una volta
   * per pagina e poi si disegna; restare armati farebbe spostare l'origine a ogni clic successivo e il disegno ripartirebbe da zero). Esc o Annulla la disarmano.
   */
  function armOrigin(): void {
    if (!pdf || tool === 'origin') return;
    const back = tool;
    selectTool('origin');
    originReturn = back; // dopo selectTool, che azzera `originReturn` per gli altri strumenti
    say(model.origin(pageNo) ? 'Un nuovo clic sposta l\'origine di questa pagina' : '');
  }
  /** Disarma l'Origine senza cambiarla e torna allo strumento di prima. */
  function disarmOrigin(): void {
    if (tool !== 'origin') return;
    selectTool(originReturn ?? 'pan');
  }
  /** Il clic dell'Origine: imposta o sposta l'origine della pagina corrente (un solo passo di Annulla) e torna allo strumento di prima. */
  function onOriginPoint(at: UserPoint): void {
    const before = model.origin(pageNo);
    history.exec(new SetOrigin(pageNo, before, at));
    selectTool(originReturn ?? 'pan');
    say(before ? 'Origine spostata. Annulla la rimette a posto.' : 'Origine impostata. Annulla la toglie.');
  }
  function removeOrigin(): void {
    const before = model.origin(pageNo);
    if (!before) return;
    history.exec(new SetOrigin(pageNo, before, null));
    say('Origine rimossa. Annulla la ripristina.');
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
    // In basso il limite e' il contenitore di "Adatta alla pagina" (sticky: copre il fondo della palette), non il bordo: uno strumento sotto di lui non e' in vista.
    const bottom = paletteDock.offsetParent !== null ? Math.min(p.bottom, paletteDock.getBoundingClientRect().top) : p.bottom;
    if (r.top < p.top + padY) palette.scrollTop += r.top - (p.top + padY);
    else if (r.bottom > bottom - padY) palette.scrollTop += r.bottom - (bottom - padY);
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

  /** Sceglie Cerchio o Arco (e passa allo strumento Cerchio e arco). */
  function selectCurveKind(k: CurveKind): void {
    curveKind = k;
    if (tool !== 'curve') selectTool('curve');
    else {
      construction.setCurveKind(k);
      currentAim = null;
      renderConstruction();
    }
  }

  // ---------- Selezione ----------
  /** Evidenzia la selezione: l'unione delle forme degli oggetti selezionati, con lo stesso alone e la stessa cornice di un oggetto solo (nessun riquadro complessivo). */
  function renderSelection(): void {
    const objs = selectedObjects();
    viewer.setSelection(objs.length > 0 ? unionShapes(objs.map(shapeOf)) : null);
  }
  /** Sostituisce la selezione (anche con nessun oggetto). */
  function setSelection(ids: Iterable<number>): void {
    selection = new Set(ids);
    viewer.setDragOffset(null, 0, 0);
    if (selection.size >= 2) toggleProps(false); // con piu' oggetti non ci sono proprieta' da cambiare
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

  /** Sceglie la quota angolare e come costruirla (e passa allo strumento Quota). */
  function selectAngularMode(mode: AngularMode): void {
    angularMode = mode;
    dimType = 'angular';
    if (tool !== 'dim') selectTool('dim');
    else {
      cancelEntry();
      construction.setDimType('angular');
      construction.setAngularMode(mode);
      viewer.setHighlight(null);
      currentAim = null;
      renderConstruction();
    }
  }

  /** Il tratto scelto sul foglio mostrato (una linea sola): serve a evidenziarlo. */
  function sideShape(s: SideTract): Shape {
    const g = viewer.geometry;
    return g ? { lines: [[g.userToSheet(s.a), g.userToSheet(s.b)]], rects: [], circles: [] } : { lines: [], rects: [], circles: [] };
  }
  /** Il tratto di Retta o Linea piu' vicino al punto (entro la tolleranza), per la quota angolare "da due linee". */
  function sideAt(sheet: SheetPoint, tol: number): PickedSide | null {
    const g = viewer.geometry;
    return g && pdf ? pickSide(model.objects(pageNo).filter(isLine), g, sheet, tol) : null;
  }

  /**
   * Quota angolare in costruzione: linee guida e anteprima. "Da due linee": con i due lati scelti l'anteprima segue il cursore (settore e raggio). "Da tre punti": il
   * vertice con i lati finora indicati (il secondo segue il cursore) e, dopo il terzo punto, l'anteprima con il raggio sotto il cursore. Solo a schermo, mai esportata.
   */
  function renderAngular(geom: PageGeometry, aim: UserPoint | null): void {
    const pts = construction.points;
    const [v, a1, a2] = pts;
    let def: DimensionDef | null = null;
    let guide: UserPoint[] | null = null;
    if (construction.angularMode === 'lines') {
      const [s1, s2] = construction.sides;
      if (s1 && s2 && aim) {
        const r = angularFromLines(s1, s2, aim, geom);
        if (r.ok) def = { dim: 'angular', ...r.points };
      }
    } else if (v && pts.length === 1 && aim) guide = [v, aim];
    else if (v && a1 && pts.length === 2) guide = aim ? [a1, v, aim] : [a1, v];
    else if (v && a1 && a2) {
      guide = [a1, v, a2];
      if (aim) def = buildDimension('angular', [v, a1, a2, aim], geom);
    }
    viewer.setGuide(guide);
    if (def) viewer.setDraft(dimLayout(def, null, geom, dimDraftLabel(def, null, geom)));
  }

  /** Redisegna punti, anteprima, misura e barra contestuale secondo lo stato della costruzione. */
  function renderConstruction(): void {
    const geom = viewer.geometry;
    const t = construction.tool;
    const pts = construction.points;
    const aim = construction.done || construction.locked ? null : currentAim;
    viewer.setDraft(null);
    viewer.setCoverDraft(null);
    if (!isTransformTool(t)) clearGhost();
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
      // quota angolare "da due linee": si scelgono prima i lati (il visore sceglie un oggetto con un tocco) e poi si indica un punto; i lati scelti restano evidenziati
      if (!entry) viewer.setMode(construction.choosingSides ? 'choose' : 'pick');
      viewer.setSelection(construction.angular && construction.sides.length > 0 ? unionShapes(construction.sides.map(sideShape)) : null);
      if (entry) {
        viewer.setGuide(null);
        viewer.setDraft(entryLayout(geom));
      } else if (construction.angular) {
        renderAngular(geom, aim);
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
    } else if (t === 'curve') {
      viewer.setMarkers(pts.map((p) => ({ p })));
      viewer.setGuide(null);
      viewer.setBadge(null);
      // anteprima solo a schermo (mai esportata), con le proprieta' che avra': cerchio dopo il centro; arco: dopo il primo punto la corda fino al cursore,
      // dopo il secondo l'arco per i tre punti con il cursore come fine (se i tre punti non danno un arco, nulla)
      const [a, b] = [pts[0], pts[1]];
      if (a && aim && pts.length === 1 && curveKind === 'circle') viewer.setArcPreview(curveOnSheet({ kind: 'circle', p1: a, p2: aim }, geom), stroke);
      else if (a && aim && pts.length === 1) viewer.setPreview([a, aim], stroke);
      else if (a && b && aim && pts.length === 2 && arcProblem(a, b, aim) === null) viewer.setArcPreview(curveOnSheet({ kind: 'arc', p1: a, p2: b, p3: aim }, geom), stroke);
      else viewer.setPreview(null);
    } else if (isTransformTool(t)) {
      // Sposta, Specchio, Rotazione (CP6e): punti indicati, guida dal primo punto al cursore e anteprima di come diventerebbe la selezione (solo a schermo, mai esportata)
      viewer.setMarkers(pts.map((p, i) => ({ p, label: t === 'rotate' ? undefined : String(i + 1) })));
      viewer.setPreview(null);
      viewer.setBadge(null);
      const line = t !== 'rotate' && aim && pts.length === 1 ? [...pts, aim] : null;
      viewer.setGuide(line);
      updateGhost(geom);
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
    const nSel = selection.size;
    const inTransform = isTransformTool(tool);
    ctxHint.textContent = constructing
      ? construction.prompt
      : tool === 'erase'
        ? 'Cancella: tocca un oggetto per cancellarlo (Annulla lo ripristina)'
        : tool === 'select'
          ? so
            ? selectedText(so) // testi brevi: la barra contestuale non deve cambiare altezza selezionando un oggetto
            : nSel >= 2
              ? selectedManyText(nSel)
              : 'Seleziona: tocca un oggetto, poi trascinalo' // invariato (le prove storiche lo controllano): il Ctrl + clic sta nel suggerimento sotto
          : '';
    // Suggerimento (tooltip) del testo guida: con Seleziona dice come scegliere piu' oggetti, senza allungare la riga (la barra non deve cambiare altezza).
    ctxHint.title = tool === 'select' ? 'Ctrl + clic (o Cmd + clic) aggiunge un oggetto alla selezione o lo toglie; trascinando uno degli oggetti selezionati si sposta tutta la selezione' : '';
    const shellStep = shellStepNow();
    shellBox.hidden = shellStep === null;
    if (shellStep !== null) {
      ctxHint.textContent = construction.shellPrompt ?? ctxHint.textContent; // con la shell il testo guida dice anche che cosa digitare (una riga)
      shellInput.placeholder = shellStep === 'radius' ? 'raggio' : 'X;Y';
      shellInput.setAttribute('aria-label', shellStep === 'radius' ? 'Raggio del cerchio' : 'Coordinate X;Y relative all\'origine');
      shellUnit.textContent = relUnitLabel(model.scale(pageNo));
    }
    dimTypes.hidden = tool !== 'dim';
    for (const [id, b] of dimTypeBtns) b.setAttribute('aria-pressed', String(id === dimType));
    angModeBtn.hidden = !(tool === 'dim' && dimType === 'angular');
    angModeBtn.setAttribute('aria-pressed', String(angularMode === 'points'));
    coverTypes.hidden = tool !== 'cover';
    for (const [id, b] of coverTypeBtns) b.setAttribute('aria-pressed', String(id === coverKind));
    curveTypes.hidden = tool !== 'curve';
    for (const [id, b] of curveTypeBtns) b.setAttribute('aria-pressed', String(id === curveKind));
    styleChip.hidden = !(tool === 'segment' || tool === 'polyline' || tool === 'curve' || tool === 'text' || tool === 'dim' || tool === 'select' || (inTransform && tool !== 'rotate')); // con la Rotazione il riquadro sparisce davvero: la casella dell'angolo ha bisogno del posto (tra 720 e 899 px)
    // Con Seleziona il riquadro occupa sempre il suo posto (invisibile se non c'e' nulla da cambiare): se comparisse
    // solo con un oggetto selezionato, selezionare farebbe cambiare altezza alla barra e il foglio si ridimensionerebbe sotto il dito.
    styleChip.classList.toggle('ghost', inTransform || (tool === 'select' && !(so !== undefined && kindOfObject(so) !== 'none'))); // anche durante una trasformazione: il posto resta, la barra non cambia altezza
    // Trasformazioni (CP6e): con Seleziona i tre pulsanti (attivi se c'e' una selezione; la Rotazione anche solo con un puntatore preciso); durante la trasformazione
    // l'interruttore "Mantieni l'originale", per la Rotazione la casella dell'angolo e il pulsante Origine.
    for (const b of [trMoveBtn, trMirrorBtn, trRotateBtn]) b.hidden = tool !== 'select';
    trMoveBtn.disabled = nSel === 0;
    trMirrorBtn.disabled = nSel === 0;
    trRotateBtn.disabled = nSel === 0 || !desktopPointer();
    keepBtn.hidden = !inTransform;
    keepBtn.setAttribute('aria-pressed', String(keepOriginal));
    angleBox.hidden = tool !== 'rotate';
    originCenterBtn.disabled = !pdf || model.origin(pageNo) === null;
    cancelBtn.hidden = !constructing;
    cancelBtn.disabled = tool !== 'origin' && !inTransform && !(construction.pending || construction.done || construction.locked); // con l'Origine armata (o una trasformazione) Annulla la disarma
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

  // ---------- Shell (CP6d, decisioni 59 e 71) ----------
  /**
   * Criterio "solo desktop" (scelta dell'assistente, da confermare): il puntatore PRINCIPALE e' preciso e puo' passare sopra gli elementi (`(hover: hover) and (pointer: fine)`:
   * mouse e trackpad). Su iPhone e iPad (touch) la tastiera di sistema coprirebbe il foglio: la shell non c'e'. Lo stesso criterio che l'app gia' usa per i bersagli di tocco
   * (`pointer: coarse`, app.css). NON VERIFICATO: come lo riportano un iPad con tastiera o un trackpad, e Safari.
   */
  const desktopMq = window.matchMedia('(hover: hover) and (pointer: fine)'); // un solo oggetto: `matches` e' sempre aggiornato (si rilegge a ogni disegno della barra)
  const desktopPointer = (): boolean => desktopMq.matches;
  /** Che cosa aspetta la shell adesso: un punto, il raggio, o niente (null: la casella non si vede). Serve un'origine sulla pagina e un puntatore da desktop. */
  function shellStepNow(): 'point' | 'radius' | null {
    if (!pdf || entry || model.origin(pageNo) === null || !desktopPointer()) return null;
    return construction.shellStep;
  }
  function shellError(message: string): void {
    say(message);
    shellInput.setAttribute('aria-invalid', 'true');
  }
  /** Invio nella casella: il valore digitato diventa un punto della costruzione in corso, esatto (nessuno snap, griglia, ORTO o squadratura). */
  function submitShell(): void {
    const step = shellStepNow();
    const g = viewer.geometry;
    const f = currentFrame();
    if (!step || !g || !f) return;
    const text = shellInput.value;
    // Linea: Invio a casella vuota termina la linea (come Invio sul foglio)
    if (text.trim() === '' && tool === 'polyline' && construction.points.length >= 2) {
      finishLine();
      return;
    }
    let user: UserPoint;
    if (step === 'radius') {
      const r = parseShellRadius(text);
      const centre = construction.points[0];
      if (!r.ok || !centre) return shellError(r.ok ? 'Indica prima il centro.' : r.error);
      // il punto sul bordo e' centro + (raggio, 0) lungo +X del foglio mostrato: lo stesso dato di un clic a quel punto
      const cs = g.userToSheet(centre);
      user = g.sheetToUser({ x: cs.x + r.value * f.unitPt, y: cs.y });
      if (!(Math.abs(user.x) <= LIMITS.coordAbs && Math.abs(user.y) <= LIMITS.coordAbs)) return shellError('Raggio troppo grande: il cerchio esce dai limiti del foglio.');
    } else {
      const p = parseShellPoint(text);
      if (!p.ok) return shellError(p.error);
      const sheet = relToSheet(f, p.value);
      if (!inPageWithEps(g, sheet)) return shellError(OUTSIDE_MESSAGE); // lo stesso rifiuto di un clic fuori dalla pagina
      user = g.sheetToUser(sheet);
    }
    say(''); // il messaggio di un errore precedente; un rifiuto o il completamento della figura ne scrivono uno nuovo
    if (!construction.placeExact(user)) {
      shellInput.setAttribute('aria-invalid', 'true'); // il messaggio l'ha gia' dato la costruzione (punti coincidenti)
      return;
    }
    shellInput.value = '';
    shellInput.removeAttribute('aria-invalid');
    renderConstruction();
  }
  shellInput.addEventListener('input', () => shellInput.removeAttribute('aria-invalid'));
  shellInput.addEventListener('keydown', (e) => {
    // La casella gestisce i suoi tasti: il gestore globale della tastiera esce per ogni campo di testo, quindi Backspace, Canc e Ctrl+Z modificano il TESTO della casella
    // (e non l'ultimo punto, la selezione o la cronologia), come in "Passo griglia".
    if (e.key === 'Enter') {
      e.preventDefault();
      submitShell();
    } else if (e.key === 'Escape') {
      // Esc svuota la casella; a casella vuota annulla la costruzione in corso (come Esc sul foglio). Il fuoco resta nella casella.
      e.preventDefault();
      if (shellInput.value !== '') {
        shellInput.value = '';
        shellInput.removeAttribute('aria-invalid');
      } else if (construction.pending) cancelConstruction();
    }
  });

  // ---------- Selezione multipla e trasformazioni (CP6e, decisioni 60 e 75-81) ----------
  /** Toglie l'anteprima di una trasformazione (se c'era) e dimentica l'ultimo rifiuto mostrato. */
  function clearGhost(): void {
    if (ghostShown) {
      viewer.setGhost([]);
      ghostShown = false;
    }
    lastTransformProblem = null;
  }
  function setKeepOriginal(on: boolean): void {
    keepOriginal = on;
    say(on ? 'Mantieni l\'originale: acceso. La trasformazione crea copie e gli originali restano.' : 'Mantieni l\'originale: spento. La trasformazione modifica gli oggetti selezionati.');
    renderConstruction();
  }
  /** La trasformazione che si otterrebbe adesso (per l'anteprima), nel foglio, o null se mancano punti o angolo. */
  function transformSpecNow(g: PageGeometry): TransformSpec | null {
    const t = construction.tool;
    const pts = construction.points;
    if (t === 'move' || t === 'mirror') {
      const p0 = pts[0];
      if (!p0 || pts.length !== 1 || !currentAim || construction.locked) return null;
      const a = g.userToSheet(p0);
      const b = g.userToSheet(currentAim);
      return t === 'move' ? { kind: 'move', dx: b.x - a.x, dy: b.y - a.y } : { kind: 'mirror', a, b };
    }
    if (t === 'rotate') {
      const c = pts[0];
      if (!c) return null;
      const r = parseAngle(angleInput.value);
      return r.ok ? { kind: 'rotate', center: g.userToSheet(c), deg: r.value } : null;
    }
    return null;
  }
  /** Mostra come diventerebbe la selezione; se la trasformazione non e' ammessa (tipo escluso, fuori dai limiti) niente anteprima e il motivo nella riga di stato, una volta. */
  function updateGhost(g: PageGeometry): void {
    const spec = transformSpecNow(g);
    const objs = spec ? selectedObjects() : [];
    // uno spostamento nullo o un asse di due punti coincidenti e' naturale mentre il mouse si muove: niente anteprima e niente messaggio (li dice il clic)
    const plan = spec && objs.length > 0 && specProblem(spec) === null ? planTransform(objs, spec, g) : null;
    if (plan && plan.ok) {
      const moved = objs.map((o, i) => cloneObject(o, o.id, (plan.moves[i] as PlannedMove).after));
      viewer.setGhost(buildDrawItems(moved, g, model.scale(pageNo)));
      ghostShown = true;
    } else if (ghostShown) {
      viewer.setGhost([]);
      ghostShown = false;
    }
    const problem = plan && !plan.ok ? plan.reason : null;
    if (problem !== lastTransformProblem) {
      if (problem || lastTransformProblem) say(problem ?? '');
      lastTransformProblem = problem;
    }
  }

  /** Arma Sposta, Specchio o Rotazione per la selezione (solo con lo strumento Seleziona e almeno un oggetto). La selezione resta. */
  function armTransform(kind: TransformTool): void {
    if (!pdf || tool !== 'select' || selection.size === 0) return;
    if (kind === 'rotate' && !desktopPointer()) {
      say('Rotazione: serve un mouse o un trackpad, perché l\'angolo si digita (sul tocco non c\'è in questa versione).');
      return;
    }
    selectTool(kind);
  }
  /** Fine di una trasformazione: si torna a Seleziona con la selezione data (gli oggetti trasformati, o le copie). */
  function endTransform(ids: Iterable<number>): void {
    selectTool('select', { keepSelection: true });
    setSelection(ids);
  }
  /** Esc, Annulla o un altro modo di lasciar perdere: nessuna modifica, la selezione resta com'e'. */
  function cancelTransform(): void {
    if (!isTransformTool(tool)) return;
    selectTool('select', { keepSelection: true });
    say('Trasformazione annullata: la selezione resta.');
  }
  /**
   * Esegue la trasformazione sulla selezione: TUTTO O NIENTE (un oggetto non ammesso o un risultato fuori dai limiti rifiuta tutto, con la ragione), UN comando (un solo
   * Annulla). Con "Mantieni l'originale" acceso crea copie nuove (id nuovi) e gli originali restano. Dopo, la selezione passa agli oggetti trasformati (o alle copie).
   */
  function applyTransform(spec: TransformSpec): boolean {
    const g = viewer.geometry;
    const objs = selectedObjects();
    if (!g || !pdf || objs.length === 0) return false;
    const plan = planTransform(objs, spec, g);
    if (!plan.ok) {
      say(plan.reason);
      return false;
    }
    const label = `${VERB_LABEL[spec.kind]} ${countLabel(objs)}`;
    let next: number[];
    let msg: string;
    if (keepOriginal) {
      const copies = objs.map((o, i) => cloneObject(o, model.newId(), (plan.moves[i] as PlannedMove).after));
      history.exec(new AddObjects(pageNo, `${label} (copia)`, copies));
      next = copies.map((c) => c.id);
      msg = copiedMessage(spec.kind, objs.length);
    } else {
      history.exec(new TransformObjects(pageNo, label, plan.moves));
      next = objs.map((o) => o.id);
      msg = objs.length === 1 ? transformedMessage(spec.kind, objs[0] as PageObject) : transformedManyMessage(spec.kind, objs.length);
    }
    endTransform(next);
    say(msg);
    return true;
  }
  /** I punti di Sposta e Specchio sono completi, o il centro della Rotazione e' stato indicato. Dice se l'app li accetta (vedi `ConstructionEvents.transform`). */
  function onTransformPoints(kind: TransformTool, pts: UserPoint[]): boolean {
    const g = viewer.geometry;
    if (!g) return false;
    if (kind === 'rotate') {
      say('');
      if (desktopPointer()) angleInput.focus(); // il passo dopo il centro e' solo digitare l'angolo (a differenza della shell, che non prende il fuoco da sola)
      return true;
    }
    const a = g.userToSheet(pts[0] as UserPoint);
    const b = g.userToSheet(pts[1] as UserPoint);
    return applyTransform(kind === 'move' ? { kind: 'move', dx: b.x - a.x, dy: b.y - a.y } : { kind: 'mirror', a, b });
  }
  function useOriginAsCenter(): void {
    const o = model.origin(pageNo);
    if (tool !== 'rotate' || !o) return;
    construction.place(o);
    renderConstruction();
  }
  function angleError(message: string): void {
    say(message);
    angleInput.setAttribute('aria-invalid', 'true');
  }
  /** Invio nella casella dell'angolo: ruota la selezione attorno al centro indicato. */
  function submitAngle(): void {
    const g = viewer.geometry;
    const c = construction.points[0];
    if (tool !== 'rotate' || !g) return;
    if (!c) return angleError('Indica prima il centro: un clic sul foglio o il pulsante Origine.');
    const r = parseAngle(angleInput.value);
    if (!r.ok) return angleError(r.error);
    if (!applyTransform({ kind: 'rotate', center: g.userToSheet(c), deg: r.value })) angleInput.setAttribute('aria-invalid', 'true');
  }
  angleInput.addEventListener('input', () => {
    angleInput.removeAttribute('aria-invalid');
    renderConstruction(); // l'anteprima segue l'angolo mentre si digita
  });
  angleInput.addEventListener('keydown', (e) => {
    // Come la shell: i tasti della casella valgono per il TESTO (il gestore globale della tastiera esce per ogni campo di testo): Backspace e Canc non cancellano oggetti.
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAngle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (angleInput.value !== '') {
        angleInput.value = '';
        angleInput.removeAttribute('aria-invalid');
        renderConstruction();
      } else cancelTransform();
    }
  });

  /** Duplica: copie SUL POSTO (stesse coordinate) degli oggetti selezionati, che diventano la nuova selezione (un solo Annulla). */
  function duplicateSelected(): void {
    const objs = selectedObjects();
    if (!pdf || tool !== 'select' || objs.length === 0) return;
    const copies = objs.map((o) => cloneObject(o, model.newId()));
    history.exec(new AddObjects(pageNo, `Duplica ${countLabel(objs)}`, copies));
    setSelection(copies.map((c) => c.id));
    say(duplicatedMessage(objs));
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
        say(`Scala della pagina ${page}: ${scaleLabel(s)}.${gridRecalNote()}`);
      }
    }
    construction.reset();
    currentAim = null;
    renderConstruction();
  }

  // ---------- Scena: oggetti della pagina come li disegna il livello sul foglio ----------
  /** Layout di un testo o di una quota (sempre dritti sul foglio): lo stesso codice dell'esportazione (`model/scene`). */
  const objectLayout = (o: TextObject | DimensionObject, g: PageGeometry): Layout => objectLayoutFor(o, g, model.scale(pageNo));
  function dimLayout(def: DimensionDef, style: { color: string; widthPt: number; textPt: number } | null, g: PageGeometry, label: string): Layout {
    return layoutDimension({ ...def, color: style?.color ?? stroke.color, widthPt: style?.widthPt ?? stroke.widthPt, textPt: style?.textPt ?? textPt }, g, label);
  }
  const shapeOf = (o: PageObject): Shape => {
    const g = viewer.geometry;
    if (!g) return { lines: [], rects: [], circles: [] };
    if (o.kind === 'cover') return coverShapeOf(coverOnSheet(o, g));
    if (isCurve(o)) {
      const arc = curveOnSheet(o, g);
      return { lines: [], rects: [], circles: [], arcs: arc ? [arc] : [] }; // la LINEA del cerchio o dell'arco, non il disco: si sceglie sul tratto
    }
    return isLine(o) ? { lines: [sheetLine(o, g)], rects: [], circles: [] } : objectLayout(o, g).hit;
  };
  /** Gli oggetti dal fondo al primo piano (le coperture sotto tutto): la stessa scena che disegna l'esportazione "Appiattito". */
  function sceneItems(): DrawItem[] {
    const g = viewer.geometry;
    return g ? buildDrawItems(model.objects(pageNo), g, model.scale(pageNo)) : [];
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
        info: def.dim === 'angular' ? (auto ? `Automatico ${auto} · gradi decimali` : 'Digita l\'angolo in gradi') : auto && scale ? `Automatico ${auto} mm · scala ${scaleLabel(scale)}` : 'Pagina non calibrata: digita il valore in mm',
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
  const canUndo = (): boolean => !entry && (construction.pending || (history.canUndo && !isTransformTool(tool))); // durante una trasformazione Annulla toglie solo l'ultimo punto
  function refreshUndoRedo(): void {
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = entry !== null || !history.canRedo || isTransformTool(tool);
    undoBtn.title = construction.pending ? 'Annulla: toglie l\'ultimo punto' : history.nextUndo ? `Annulla ${history.nextUndo}` : 'Annulla';
    redoBtn.title = history.nextRedo ? `Ripeti ${history.nextRedo}` : 'Ripeti';
  }
  function afterHistory(cmd: Command<DocumentModel> | null, verb: string): void {
    if (!cmd) return;
    if (cmd.page !== pageNo) void goTo(cmd.page); // mostra la pagina interessata
    say(`${verb}: ${cmd.label}${cmd.page === pageNo ? gridRecalNote() : ''}`);
  }
  function undoAction(): void {
    if (entry) return; // con il tastierino aperto si conferma o si annulla da li'
    if (isTransformTool(tool) && !construction.pending) {
      say('Nessun punto da togliere: Esc annulla la trasformazione.');
      return;
    }
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
    if (entry || isTransformTool(tool)) return;
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
    if (gridOn && pdf) {
      // la griglia compare o sparisce (e comincia o smette di arrotondare) quando il passo a schermo passa la soglia: lo si dice una volta
      const vis = gridVisible(gridStepNow(), zoom);
      if (vis !== gridWasVisible) {
        gridWasVisible = vis;
        say(vis ? `Griglia visibile: passo ${gridStepText()}.` : `Griglia nascosta: a questo zoom il passo è sotto ${GRID_MIN_SCREEN_PX} px (non si vede e non arrotonda).`);
      }
    }
  };
  viewer.hooks.onReject = say;
  viewer.hooks.constrain = (raw, touch) => construction.resolve(raw, touch);
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
  // Quota angolare "da due linee" (CP6g): un tocco sceglie il TRATTO di Retta o Linea piu' vicino (non il primo in primo piano: `pickSide`); Cerchi, Archi, Coperture, Testi e Quote non si scelgono.
  viewer.hooks.onChoosePreview = (sheet, tol) => {
    const side = sheet ? sideAt(sheet, tol) : null;
    viewer.setHighlight(side ? sideShape(side) : null);
  };
  viewer.hooks.onChoose = (sheet, tol) => {
    const side = sideAt(sheet, tol);
    if (!side) {
      say('Nessuna retta o linea in questo punto: tocca sopra una retta o una linea');
      return;
    }
    if (!construction.addSide(side)) return; // rifiutato: il motivo e' gia' nel messaggio di stato
    say('');
    viewer.setHighlight(null);
    renderConstruction();
  };
  /** Cancella un oggetto con il comando dello strumento Cancella: un solo passo di Annulla, lo stesso messaggio. */
  function removeObject(o: PageObject): void {
    history.exec(new RemoveObject(pageNo, o));
    say(deletedMessage(o));
  }
  /**
   * Canc con lo strumento Seleziona: cancella TUTTA la selezione (CP6b, decisione 57; CP6e: piu' oggetti) con un solo comando (un solo Annulla) e azzera la selezione.
   * Con un oggetto solo e' lo stesso comando e lo stesso messaggio di sempre (`removeObject`).
   */
  function deleteSelected(): void {
    const objs = selectedObjects();
    if (!pdf || objs.length === 0) return;
    if (objs.length === 1) removeObject(objs[0] as PageObject);
    else {
      history.exec(new RemoveObjects(pageNo, objs)); // un solo comando: un solo Annulla li rimette tutti al loro posto
      say(deletedManyMessage(objs.length));
    }
    setSelection([]);
  }
  viewer.hooks.onErase = (sheet, tol) => {
    const o = objectAt(sheet, tol);
    if (!o) {
      say('Nessun oggetto in questo punto: tocca sopra un oggetto');
      return;
    }
    removeObject(o);
  };
  // Seleziona: un tocco sceglie l'oggetto in primo piano; trascinare l'oggetto selezionato lo sposta (un solo comando).
  // Ctrl (o Cmd) + clic: aggiunge l'oggetto alla selezione, o lo toglie se c'e' gia'; nel vuoto non cambia niente. Senza Ctrl: la selezione diventa quell'oggetto (anche
  // se faceva parte di una selezione multipla) e un clic nel vuoto la azzera, come prima.
  viewer.hooks.onSelect = (sheet, tol, additive) => {
    const o = objectAt(sheet, tol);
    if (additive) {
      if (!o) return;
      const next = new Set(selection);
      if (!next.delete(o.id)) next.add(o.id);
      setSelection(next);
    } else setSelection(o ? [o.id] : []);
    say(''); // lo dice gia' la barra contestuale: "Selezionata: Retta" / "Selezionati: 3 oggetti"
  };
  // Si afferra con uno qualsiasi degli oggetti selezionati (entro la tolleranza): il trascinamento sposta TUTTA la selezione.
  viewer.hooks.canGrab = (sheet, tol) => selectedObjects().some((o) => distToShape(sheet, shapeOf(o)) <= tol);
  viewer.hooks.onDragMove = (dx, dy) => {
    dragIds ??= [...selection];
    viewer.setDragOffset(dragIds, dx, dy);
  };
  viewer.hooks.onDragCancel = () => {
    dragIds = null;
    viewer.setDragOffset(null, 0, 0);
  };
  viewer.hooks.onDragEnd = (dx, dy) => {
    dragIds = null;
    viewer.setDragOffset(null, 0, 0);
    const objs = selectedObjects();
    const g = viewer.geometry;
    if (objs.length === 0 || !g) return;
    const d = g.sheetDeltaToUser(dx, dy); // lo spostamento sul foglio, riportato nello spazio utente PDF
    if (d.x === 0 && d.y === 0) return;
    const only = objs[0];
    if (objs.length === 1 && only) {
      history.exec(new MoveObject(pageNo, only, d.x, d.y)); // un oggetto: lo stesso comando, la stessa etichetta e lo stesso messaggio di prima
      say(movedMessage(only));
      return;
    }
    const plan = planTransform(objs, { kind: 'move', dx, dy }, g);
    if (!plan.ok) {
      say(plan.reason);
      return;
    }
    history.exec(new TransformObjects(pageNo, `${VERB_LABEL.move} ${countLabel(objs)}`, plan.moves));
    say(transformedManyMessage('move', objs.length));
  };

  // Modello e cronologia: ogni cambiamento aggiorna disegno, scala, proprieta' e pulsanti.
  model.onChange(() => {
    refreshScene();
    refreshGrid(); // una ricalibrazione cambia il passo in pt (il messaggio lo dice: gridRecalNote)
    if (selection.size > 0) {
      // gli oggetti selezionati che non ci sono piu' (Annulla di un Duplica, per esempio) escono dalla selezione
      const present = new Set<number>();
      for (const o of model.objects(pageNo)) present.add(o.id);
      if ([...selection].some((id) => !present.has(id))) selection = new Set([...selection].filter((id) => present.has(id)));
    }
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
    // Invio, Backspace e Canc valgono solo se il focus non e' su un pulsante o un menu (resta l'uso da tastiera dei pulsanti): vale anche per Canc su un oggetto selezionato.
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
      else if (isTransformTool(tool)) cancelTransform(); // prima la trasformazione in corso: la selezione resta com'e'
      else if (selection.size > 0) setSelection([]);
      else if (tool === 'origin') disarmOrigin();
      else if (construction.pending || construction.done) cancelConstruction();
    } else if (e.key === 'Enter' && tool === 'polyline' && onCanvas) {
      e.preventDefault();
      finishLine();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && construction.pending && onCanvas) {
      e.preventDefault();
      undoAction();
    } else if (e.key === 'Delete' && tool === 'select' && selection.size > 0 && onCanvas) {
      // Canc cancella tutta la selezione (non Backspace: resta solo l'annullamento dell'ultimo punto in costruzione).
      e.preventDefault();
      deleteSelected();
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
    for (const b of [zoomOutBtn, zoomInBtn, zoomLabel, fitBtn]) b.disabled = !has;
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
    if (isTransformTool(tool)) selectTool('select'); // cambiare pagina annulla la trasformazione in corso (e azzera la selezione)
    selection = new Set();
    pageNo = Math.min(Math.max(1, n), pdf.pages.length);
    construction.reset();
    shellInput.value = ''; // quello che si stava digitando era per la pagina di prima
    shellInput.removeAttribute('aria-invalid');
    currentAim = null;
    updateChrome();
    try {
      const rendering = viewer.setPage(await pdf.doc.getPage(pageNo));
      refreshScene(); // la geometria della nuova pagina e' gia' impostata: gli oggetti compaiono subito
      gridReportedPt = gridOn ? gridStepNow() : 0;
      refreshGrid(); // ogni pagina ha la sua scala, quindi il suo passo in pt
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
    saved.reset();
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
    const o = model.originCount();
    if (n > 0) parts.push(n === 1 ? '1 oggetto disegnato' : `${n} oggetti disegnati`);
    if (s > 0) parts.push(s === 1 ? '1 scala calibrata' : `${s} scale calibrate`);
    if (o > 0) parts.push(o === 1 ? '1 origine impostata' : `${o} origini impostate`);
    return parts.length <= 2 ? parts.join(' e ') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`; // "a e b" con due voci, "a, b e c" con tre
  };

  /**
   * Avvisa solo se ci sono modifiche DALL'ULTIMO SALVATAGGIO del progetto o dall'apertura (5c): `saved.dirty`. Si considera salvato quando share() si risolve o
   * parte lo Scarica (non c'e' modo di sapere se il file e' davvero arrivato: NON VERIFICATO su iPhone). Esporta PDF non conta come salvataggio.
   * Nessun avviso alla chiusura della scheda o della pagina: su iPhone `beforeunload` non e' affidabile (NON VERIFICATO).
   */
  const confirmDiscard = (what: string, action: () => void): void => {
    if (!(saved.dirty && model.hasContent)) {
      action();
      return;
    }
    void showDialog({
      title: 'Modifiche non salvate',
      message: `Ci sono modifiche dall'ultimo salvataggio del progetto o dall'apertura (ora: ${contentSummary()}). Usa File > Salva con nome per tenerle; Esporta PDF crea un nuovo file ma non salva il progetto. ${what}`,
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

  // ---------- Progetto (.json): Salva con nome e Apri progetto (5c) ----------
  const hashAvailable = (): boolean => typeof globalThis.crypto?.subtle?.digest === 'function';

  /**
   * Salva con nome: "Salva" genera il file progetto SENZA chiamare share; Condividi e Scarica sono tocchi successivi (come Esporta PDF).
   * Il lavoro non si tocca. Si considera salvato alla consegna (`saved.markSaved`), vedi `confirmDiscard`.
   */
  async function saveFlow(): Promise<void> {
    const doc = pdf;
    if (!doc) return;
    if (entry) {
      say('Conferma o annulla prima il testo o la quota in corso');
      return;
    }
    cancelConstruction();
    const outName = projectFileName(doc.name);
    let pagesWithObjects = 0;
    for (let n = 1; n <= doc.pages.length; n++) if (model.objects(n).length > 0) pagesWithObjects++;
    await showSaveDialog({
      pdfName: doc.name,
      outName,
      pageCount: doc.pages.length,
      pagesWithObjects,
      objectCount: model.objectCount(),
      scaleCount: model.scaleCount(),
      originCount: model.originCount(),
      hashAvailable: hashAvailable(),
      run: () => generateProject(doc, outName),
      onDelivered: (version) => saved.markSaved(version),
    });
  }

  /** Genera il file progetto: impronta del PDF originale, scrittura a lista bianca, rilettura con lo stesso codice della riapertura. */
  async function generateProject(doc: OpenedPdf, outName: string): Promise<SaveRunResult> {
    const t0 = performance.now();
    const th0 = performance.now();
    const sha256 = await sha256Hex(doc.bytes); // i byte che l'app ha aperto, mai modificati
    const hashMs = sha256 === null ? null : performance.now() - th0;
    const version = model.version;
    const project = snapshotProject(model, doc.pages, __BUILD_ID__, { name: doc.name, size: doc.bytes.length, sha256 });
    const sum = summarize(project);
    const text = serializeProject(project);
    const problem = verifyProjectText(text, { pages: sum.pages, objects: sum.objects, scales: sum.scales, origins: sum.origins });
    if (problem !== null) throw new Error(`Il file generato non supera la rilettura: ${problem}`);
    return { file: makeProjectFile(text, outName), version, pages: sum.pages, pagesWithObjects: sum.pagesWithObjects, objects: sum.objects, scales: sum.scales, origins: sum.origins, hashed: sha256 !== null, hashMs, ms: performance.now() - t0 };
  }

  // Gli input file del progetto si creano alla prima richiesta (non esistono a riposo: l'input dei PDF resta l'unico) e vivono nel DOM come quello dei PDF.
  let projectInput: HTMLInputElement | null = null;
  let projectPdfInput: HTMLInputElement | null = null;
  let onProjectPdf: ((f: File) => void) | null = null;
  /** Apre il selettore del .json. Da chiamare dal gestore del tocco (direttamente o dal "Procedi" della conferma). */
  const pickProject = (): void => {
    if (!projectInput) {
      const input = h('input', {
        type: 'file',
        accept: '.json,application/json',
        class: 'file-hidden project-file',
        tabindex: -1,
        'aria-hidden': 'true',
        onchange: () => {
          const f = input.files?.[0];
          input.value = '';
          if (f) void handleProjectFile(f);
        },
      });
      app.append(input);
      projectInput = input;
    }
    projectInput.click();
  };
  /** Apre il selettore del PDF del secondo passo. Da chiamare SOLO dal gestore di un tocco nuovo (il pulsante "Scegli il PDF…"). */
  const pickProjectPdf = (onPick: (f: File) => void): void => {
    onProjectPdf = onPick;
    if (!projectPdfInput) {
      const input = h('input', {
        type: 'file',
        accept: 'application/pdf,.pdf',
        class: 'file-hidden project-pdf-file',
        tabindex: -1,
        'aria-hidden': 'true',
        onchange: () => {
          const f = input.files?.[0];
          input.value = '';
          if (f) onProjectPdf?.(f);
        },
      });
      app.append(input);
      projectPdfInput = input;
    }
    projectPdfInput.click();
  };

  /** Apri progetto: il documento attuale resta com'e' finche' progetto e PDF non sono stati letti, controllati e confermati. */
  function openProjectFlow(): void {
    confirmDiscard('Aprire un progetto sostituisce il documento attuale.', pickProject);
  }

  async function handleProjectFile(f: File): Promise<void> {
    const untouched = 'Il documento aperto non è stato toccato.';
    if (f.size > LIMITS.fileBytes) {
      await showDialog({ title: 'Progetto non valido', message: `${f.name}: il file è troppo grande (oltre ${LIMITS.fileBytes / 1024 / 1024} MB): non è un progetto di GT-Pdf. ${untouched}` });
      return;
    }
    let text: string;
    try {
      text = await f.text();
    } catch (e) {
      await showDialog({ title: 'Lettura non riuscita', message: `${f.name}: ${e instanceof Error ? e.message : String(e)}. ${untouched}` });
      return;
    }
    const parsed = parseProject(text);
    if (!parsed.ok) {
      await showDialog({ title: 'Progetto non valido', message: `${f.name}: ${parsed.error} ${untouched}` });
      return;
    }
    const project = parsed.project;
    await showOpenProjectDialog({
      fileName: f.name,
      pdfName: project.pdf.name,
      pdfSize: project.pdf.size,
      hasHash: project.pdf.sha256 !== null,
      summary: summarize(project),
      pickPdf: pickProjectPdf,
      check: (file) => checkProjectPdf(file, project),
      onOpened: (message) => say(message),
    });
  }

  /** Apre il PDF scelto (senza installarlo) e lo confronta col progetto: stesso file, stessa geometria o altro. */
  async function checkProjectPdf(file: File, project: Project): Promise<CheckedPdf> {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') throw new Error(`${file.name} è un file progetto (.json), non un PDF: scegli il PDF.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let next: OpenedPdf;
    try {
      next = await openPdf(file.name, bytes);
    } catch (e) {
      const d = describeOpenError(file.name, e);
      throw new Error(`${d.message} (${d.detail})`);
    }
    const openedSha256 = await sha256Hex(bytes);
    const outcome = decideOutcome({ savedSha256: project.pdf.sha256, openedSha256, geometry: comparePageGeometry(project.pages, next.pages) });
    return {
      outcome,
      name: file.name,
      size: file.size,
      commit: async () => {
        if (opening) throw new Error('Un altro file è in apertura: riprova tra un momento.');
        opening = true;
        try {
          await installPdf(next, project);
        } finally {
          opening = false;
        }
      },
      discard: () => void closePdf(next).catch(() => undefined),
    };
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
    // le pagine con oggetti, con le dimensioni reali del foglio mostrato (CropBox, /Rotate e UserUnit inclusi): le sole che "Appiattito" rasterizza
    const rasterPages: RasterPage[] = [];
    for (let n = 1; n <= doc.pages.length; n++) {
      const info = doc.pages[n - 1];
      if (info && model.objects(n).length > 0) rasterPages.push({ page: n, widthPt: info.widthPt, heightPt: info.heightPt });
    }
    await showExportDialog({
      fileName: doc.name,
      outName,
      pageCount: doc.pages.length,
      objectCount: model.objectCount(),
      pagesWithObjects: rasterPages.length,
      rasterPages,
      run: (choice, onProgress, signal) => generatePdf(doc, outName, choice, onProgress, { signal }),
    });
  }

  interface GenerateOptions {
    /** Oggetti PDF per giro del salvataggio (predefinito di pdf-lib: 50). */
    objectsPerTick?: number;
    /** Solo "Appiattito": false = il PNG passa da `embedPng` di pdf-lib (misure). */
    pngDirect?: boolean;
    /** Solo "Appiattito": qualita' JPEG da 0 a 1 (predefinita `JPEG_QUALITY`). */
    jpegQuality?: number;
    /** Solo "Appiattito": Annulla (si ferma tra una pagina e l'altra, lancia `ExportCancelled`). */
    signal?: AbortSignal;
  }
  type GenerateTiming = Record<string, number>;
  /** Genera il PDF esportato (scrittura + controllo). Usata dal dialogo e, nel build di prova, dal gancio `runExport` delle misure. */
  async function generatePdf(
    doc: OpenedPdf,
    outName: string,
    choice: ExportChoice,
    onProgress: (p: ExportProgress) => void,
    options: GenerateOptions = {},
  ): Promise<ExportRunResult & { timing: GenerateTiming; images?: { page: number; via: string; bytes: number; width: number; height: number }[] }> {
    const t0 = performance.now();
    const { verifyExport } = await import('../export/verify');
    const specs = doc.pages.map((p) => ({ view: p.view, rotate: p.rotate, userUnit: p.userUnit }));
    const pageObjects = (n: number): PageObject[] => [...model.objects(n)];
    const exportPages = specs.map((spec, i) => ({ spec, objects: pageObjects(i + 1), scale: model.scale(i + 1) }));

    if (choice.mode === 'simple') {
      const { exportCoverSimple } = await import('../export/coverSimple');
      const res = await exportCoverSimple(doc.bytes, exportPages, { onProgress: (done, total) => onProgress({ done, total }), objectsPerTick: options.objectsPerTick });
      const check = await verifyExport(res.bytes, specs);
      const file = makePdfFile(res.bytes, outName); // il File tiene i dati: i byte generati non servono piu'
      return {
        file,
        mode: 'simple',
        touchedPages: res.touchedPages,
        pageCount: res.pageCount,
        objectCount: res.objectCount,
        warnings: res.warnings,
        ms: performance.now() - t0,
        verifiedPages: check.pageCount,
        timing: { ...res.timing, verify: check.ms },
      };
    }

    // "Appiattito": una pagina per volta (rasterizzazione, immagine nel PDF, canvas rilasciato), poi pulizia del vecchio contenuto
    const [{ exportFlattened }, { rasterizePage }] = await Promise.all([import('../export/flatten'), import('../export/rasterize')]);
    const quality = options.jpegQuality ?? JPEG_QUALITY;
    let res: Awaited<ReturnType<typeof exportFlattened>>;
    try {
      res = await exportFlattened(
        doc.bytes,
        exportPages,
        async (i) => {
          const no = i + 1;
          const info = doc.pages[i] as PageInfo;
          const page = await doc.doc.getPage(no);
          try {
            const items = buildDrawItems(pageObjects(no), new PageGeometry(specs[i] as PageSpec), model.scale(no));
            return await rasterizePage({ pageNo: no, page, sheetWidthPt: info.widthPt, sheetHeightPt: info.heightPt, items, dpi: choice.dpi, format: choice.format, jpegQuality: quality });
          } finally {
            page.cleanup();
          }
        },
        { onProgress: (p) => onProgress({ done: p.current, total: p.total, page: p.page, imageBytes: p.imageBytes }), objectsPerTick: options.objectsPerTick, pngDirect: options.pngDirect, signal: options.signal },
      );
    } finally {
      void doc.doc.cleanup(); // libera le cache di immagini e font di PDF.js usate dalla rasterizzazione
    }
    const check = await verifyExport(res.bytes, specs);
    const file = makePdfFile(res.bytes, outName);
    return {
      file,
      mode: 'flat',
      dpi: choice.dpi,
      format: choice.format,
      touchedPages: res.flattenedPages,
      pageCount: res.pageCount,
      objectCount: res.objectCount,
      warnings: res.warnings,
      ms: performance.now() - t0,
      verifiedPages: check.pageCount,
      imageBytes: res.imageBytes,
      prunedObjects: res.pruned.deleted,
      prunedBytes: res.pruned.freedBytes,
      timing: { ...res.timing, verify: check.ms },
      images: res.images.map((im) => ({ page: im.page, via: im.via, bytes: im.bytes, width: im.width, height: im.height })),
    };
  }

  async function loadFile(f: File): Promise<void> {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      await showDialog({ title: 'Questo è un progetto', message: `${f.name} è un file progetto (.json), non un PDF. Per aprirlo usa File > Apri progetto…` });
      return;
    }
    try {
      await loadBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      await showDialog({ title: 'Apertura non riuscita', message: `${f.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** Installa un PDF gia' aperto come documento della sessione, con gli oggetti e le scale di un progetto (o vuoto). Da qui in poi niente e' "non salvato". */
  async function installPdf(next: OpenedPdf, project: Project | null): Promise<void> {
    const prev = pdf;
    cancelEntry();
    pdf = next;
    pageNo = 1;
    history.clear();
    model.clear();
    if (project) applyProject(model, project);
    saved.reset();
    construction.reset();
    if (prev) void closePdf(prev).catch(() => undefined);
    await goTo(1);
    window.setTimeout(() => viewer.fit(), 0); // dopo il layout definitivo (barre, tastiera, rotazione)
  }

  async function loadBytes(name: string, bytes: Uint8Array): Promise<void> {
    if (opening) return;
    opening = true;
    say(`Apertura di ${name}…`);
    try {
      const next = await openPdf(name, bytes);
      await installPdf(next, null);
      say(`${name}: ${next.pages.length} ${next.pages.length === 1 ? 'pagina' : 'pagine'}, aperto in ${fmt(next.openMs, 0)} ms`);
    } catch (e) {
      say('');
      const d = describeOpenError(name, e);
      await showDialog({ title: 'Apertura non riuscita', message: `${d.message} (${d.detail})` });
    } finally {
      opening = false;
    }
  }

  updateChrome();
  renderConstruction();
  viewer.setMode('pan');

  // Gancio per le prove Chromium: presente solo nel build di prova (GTPDF_TEST=1), mai in quello pubblicato (la costante e' false e il blocco sparisce).
  if (__TEST_HOOKS__) {
    let lastFile: File | null = null;
    const win = window as unknown as { __gtpdf?: unknown };
    win.__gtpdf = {
      /** Aggiunge oggetti (senza id) alla pagina con un comando annullabile, come fa l'interfaccia. */
      add: (page: number, objs: Omit<PageObject, 'id'>[]) => {
        for (const o of objs) history.exec(new AddObject(page, { ...o, id: model.newId() } as PageObject));
      },
      /**
       * Oggetti descritti con coordinate FRAZIONARIE (fx, fy) dell'area visibile della pagina nello spazio utente (origine in basso a sinistra,
       * come il PDF non ruotato): la stessa descrizione vale per pagine di dimensione, /Rotate e CropBox diversi. Quote e quadrati si
       * costruiscono con le stesse funzioni dell'interfaccia (buildDimension, squareUser).
       */
      addSpecs: (page: number, specs: HookSpec[]) => {
        const info = pdf?.pages[page - 1];
        if (!info) throw new Error(`pagina ${page} inesistente`);
        const [x0, y0, x1, y1] = info.view;
        const g = new PageGeometry({ view: info.view, rotate: info.rotate, userUnit: info.userUnit });
        const u = (f: [number, number]): UserPoint => ({ x: x0 + f[0] * (x1 - x0), y: y0 + f[1] * (y1 - y0) });
        for (const sp of specs) {
          let obj: PageObject | null = null;
          if (sp.k === 'segment' || sp.k === 'polyline') {
            obj = { id: model.newId(), kind: sp.k, points: sp.pts.map(u), stroke: { style: sp.style ?? 'solid', color: sp.color ?? '#D32F2F', widthPt: sp.w ?? 1 } };
          } else if (sp.k === 'cover') {
            const p1 = u(sp.a);
            const p2 = sp.shape === 'square' ? squareUser(p1, u(sp.b), g) : u(sp.b);
            obj = { id: model.newId(), kind: 'cover', shape: sp.shape, p1, p2 };
          } else if (sp.k === 'circle') {
            obj = { id: model.newId(), kind: 'circle', p1: u(sp.a), p2: u(sp.b), stroke: { style: sp.style ?? 'solid', color: sp.color ?? '#D32F2F', widthPt: sp.w ?? 1 } };
          } else if (sp.k === 'arc') {
            obj = { id: model.newId(), kind: 'arc', p1: u(sp.a), p2: u(sp.b), p3: u(sp.c), stroke: { style: sp.style ?? 'solid', color: sp.color ?? '#D32F2F', widthPt: sp.w ?? 1 } };
          } else if (sp.k === 'text') {
            obj = { id: model.newId(), kind: 'text', at: u(sp.at), text: sp.text, textPt: sp.pt ?? 10, color: sp.color ?? '#D32F2F' };
          } else if (sp.k === 'dim') {
            const def = buildDimension(sp.dim, sp.pts.map(u), g);
            if (!def) throw new Error(`quota ${sp.dim} degenere`);
            obj = { id: model.newId(), kind: 'dim', ...def, valueText: sp.value ?? null, color: sp.color ?? '#D32F2F', widthPt: sp.w ?? 1, textPt: sp.pt ?? 10 };
          }
          if (obj) history.exec(new AddObject(page, obj));
        }
      },
      setScale: (page: number, mmPerPt: number) => history.exec(new SetScale(page, model.scale(page), { mmPerPt })),
      /** Imposta (o toglie, con null) l'origine di una pagina con lo stesso comando dell'interfaccia; il punto e' nello spazio utente PDF. */
      setOrigin: (page: number, p: UserPoint | null) => history.exec(new SetOrigin(page, model.origin(page), p)),
      /**
       * Prestazioni dello snap (scripts/perf-cp6a.cjs): chiama `findSnap`, la stessa funzione dell'app, su oggetti sintetici di una pagina. Per ogni lotto di
       * `batch` chiamate misura il tempo del lotto; misura anche `singles` chiamate una per una (performance.now() ha risoluzione limitata).
       */
      snapRun: (objects: PageObject[], raws: SheetPoint[], radius: number, o: { batch: number; batches: number; singles?: number; pending?: UserPoint[]; kinds?: Partial<Record<SnapSwitch, boolean>>; anchor?: UserPoint | null; origin?: UserPoint | null }) => {
        const info = pdf?.pages[0];
        if (!info) throw new Error('nessun documento');
        const g = new PageGeometry({ view: info.view, rotate: info.rotate, userUnit: info.userUnit });
        const sheetRaws = raws.map((u) => g.userToSheet(u));
        // CP6f: con `kinds` si scelgono i tipi (predefinito: i tre di prima, come nelle misure di CP6a); la scena dei tipi calcolati si costruisce UNA volta (e si misura), come fa l'app
        const kinds = o.kinds ?? { end: true, mid: true, center: true };
        const calc = !!(kinds.intersection || kinds.quadrant || kinds.perpendicular || kinds.tangent);
        const t0s = performance.now();
        const scene = calc ? buildSnapScene(objects, g) : undefined;
        const sceneMs = performance.now() - t0s;
        const extra = { scene, anchor: o.anchor ?? null, origin: o.origin ?? null };
        let hits = 0;
        let calls = 0;
        const batchMs: number[] = [];
        for (let b = 0; b < o.batches; b++) {
          const t0 = performance.now();
          for (let i = 0; i < o.batch; i++) {
            if (findSnap(objects, g, sheetRaws[(b * o.batch + i) % sheetRaws.length] as SheetPoint, radius, kinds, o.pending, extra)) hits++;
            calls++;
          }
          batchMs.push(performance.now() - t0);
        }
        const singleMs: number[] = [];
        for (let i = 0; i < (o.singles ?? 500); i++) {
          const t0 = performance.now();
          findSnap(objects, g, sheetRaws[i % sheetRaws.length] as SheetPoint, radius, kinds, o.pending, extra);
          singleMs.push(performance.now() - t0);
        }
        return { hits, calls, batch: o.batch, batchMs, singleMs, sceneMs };
      },
      goTo: (n: number) => goTo(n),
      /** Gli id selezionati (nell'ordine del modello) e le proprieta' dei NUOVI oggetti: per provare che la selezione multipla non le cambia. */
      selection: () => selectedObjects().map((o) => o.id),
      sessionProps: () => ({ stroke: { ...stroke }, textPt }),
      /** Seleziona per id (strumento Seleziona), senza clic: per le prove di prestazioni con molti oggetti. */
      selectIds: (ids: number[]) => {
        selectTool('select');
        setSelection(ids);
      },
      /** Lo stesso percorso del pulsante, del menu o della tastiera: Sposta/Specchio/Rotazione (spec nel FOGLIO), Duplica, Canc; per le prove di prestazioni. */
      applyTransform: (spec: TransformSpec) => applyTransform(spec),
      duplicate: () => duplicateSelected(),
      deleteSelection: () => deleteSelected(),
      keepOriginal: (on: boolean) => setKeepOriginal(on),
      /** I punti dell'oggetto con questo id (copie), per leggere i risultati senza passare da state(). */
      pointsOfId: (page: number, id: number) => {
        const o = model.get(page, id);
        return o ? pointsOf(o) : null;
      },
      /** I byte originali del PDF aperto (stesso Uint8Array dell'app: serve a provare che non cambiano). */
      originalBytes: () => pdf?.bytes ?? null,
      page: () => pageNo,
      pages: () => pdf?.pages.map((p) => ({ ...p })) ?? [],
      sheet: () => viewer.sheetSize,
      objectCount: () => model.objectCount(),
      /** Genera il PDF come fa il dialogo, senza interfaccia; restituisce tempi e dimensione (per scripts/perf-cp5a.cjs e scripts/measure-cp5b.cjs). */
      runExport: async (opts: { mode?: 'simple' | 'flat'; dpi?: 150 | 300 | 600; format?: 'jpeg' | 'png'; objectsPerTick?: number; pngDirect?: boolean; jpegQuality?: number; keep?: boolean } = {}) => {
        if (!pdf) throw new Error('nessun documento');
        const t0 = performance.now();
        const choice: ExportChoice = opts.mode === 'flat' ? { mode: 'flat', dpi: opts.dpi ?? 300, format: opts.format ?? 'jpeg' } : { mode: 'simple' };
        const progress: ExportProgress[] = [];
        const r = await generatePdf(pdf, exportFileName(pdf.name), choice, (p) => progress.push(p), { objectsPerTick: opts.objectsPerTick, pngDirect: opts.pngDirect, jpegQuality: opts.jpegQuality });
        lastFile = opts.keep ? r.file : null;
        return { bytes: r.file.size, total: performance.now() - t0, ...r.timing, warnings: r.warnings.map((w) => w.text), touchedPages: r.touchedPages, objectCount: r.objectCount, imageBytes: r.imageBytes ?? null, prunedObjects: r.prunedObjects ?? null, prunedBytes: r.prunedBytes ?? null, images: r.images ?? null, progress: progress.length };
      },
      /** L'ultimo file generato con `runExport({keep: true})`, in base64 (per confrontarlo fuori dalla pagina). */
      lastExportBase64: async () => {
        if (!lastFile) return null;
        const b = new Uint8Array(await lastFile.arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        return btoa(s);
      },
      zoomTo: (z: number) => viewer.zoomTo(z),
      /** Zoom, spostamento e puntatori nella mappa del visore (prove di CP5d). */
      view: () => viewer.debugState,
      fit: () => viewer.fit(),
      /**
       * Stato del lavoro per confrontarlo prima e dopo un salvataggio e una riapertura: oggetti (copie JSON), scale, testi che le quote e i testi mostrano
       * (valori automatici compresi), etichetta della scala, modifiche non salvate e versione del modello.
       */
      state: () => ({
        dirty: saved.dirty,
        version: model.version,
        pages: (pdf?.pages ?? []).map((info, i) => {
          const g = new PageGeometry({ view: info.view, rotate: info.rotate, userUnit: info.userUnit });
          const sc = model.scale(i + 1);
          return {
            scale: sc ? { mmPerPt: sc.mmPerPt } : null,
            scaleLabel: sc ? scaleLabel(sc) : null,
            origin: model.origin(i + 1),
            objects: model.objects(i + 1).map((o) => JSON.parse(JSON.stringify(o)) as unknown),
            texts: model.objects(i + 1).flatMap((o) => (o.kind === 'text' || o.kind === 'dim' ? [objectLayoutFor(o, g, sc).texts.map((t) => t.text)] : [])),
          };
        }),
      }),
      /** Il progetto che si salverebbe adesso (testo JSON), senza dialogo: per le misure di prestazioni. */
      projectText: async () => {
        if (!pdf) throw new Error('nessun documento');
        const t0 = performance.now();
        const sha = await sha256Hex(pdf.bytes);
        const t1 = performance.now();
        const text = serializeProject(snapshotProject(model, pdf.pages, __BUILD_ID__, { name: pdf.name, size: pdf.bytes.length, sha256: sha }));
        const t2 = performance.now();
        const ok = parseProject(text).ok;
        return { text, hashMs: t1 - t0, writeMs: t2 - t1, readMs: performance.now() - t2, ok, hashed: sha !== null };
      },
    };
  }
}
