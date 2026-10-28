// Esportazione "Copertura semplice": un NUOVO PDF dai byte dell'originale, con gli oggetti scritti nel contenuto delle sole pagine
// che ne hanno (le altre restano come sono). L'originale (`original`) non viene mai modificato: pdf-lib legge, lavora in memoria e
// `save()` produce un'altra sequenza di byte. Le coperture sono bianche e sovrapposte al contenuto: il testo e il disegno sotto restano
// nel file (e si possono selezionare/copiare), per questo "semplice".
//
// Ordine per pagina (come nell'app, `drawOrder`): prima TUTTE le coperture, poi linee, quote (linea di quota, linee di estensione,
// frecce piene, badge bianco con bordo, testo) e testi, nell'ordine di creazione. Tutto nello spazio utente della pagina: i punti degli
// oggetti lo sono gia'; le primitive di quote e testi (calcolate sul foglio mostrato, in pt fisici) si riportano con `sheetToUser`;
// spessori, pattern di tratteggio, frecce, badge e corpo dei testi si dividono per `UserUnit`. /Rotate e CropBox sono gia' dentro
// `PageGeometry`.
import {
  type PDFFont,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  PDFRawStream,
  PDFStream,
  LineCapStyle,
  LineJoinStyle,
  StandardFonts,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  decodePDFRawStream,
  degrees,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from '@cantoo/pdf-lib';
import { coverUserBox, coverUserRadius } from '../geometry/cover';
import { dimensionLabel } from '../geometry/dimension';
import { type Layout, exportRuns, layoutDimension, layoutText } from '../geometry/layout';
import { PageGeometry, type PageSpec, type SheetPoint, type UserPoint } from '../geometry/page';
import type { PageScale } from '../geometry/scale';
import { type PageObject, drawOrder, isLine } from '../model/model';
import { STROKE_CAP, STROKE_JOIN, STROKE_MITER_LIMIT, dashPattern } from '../model/stroke';
import { type ContentAnalysis, analyzeContent } from './contentState';
import { ExportError, toExportError } from './errors';

/** Una pagina da esportare: geometria come la mostra l'app (da PDF.js), oggetti e scala della sessione. */
export interface ExportPage {
  spec: PageSpec;
  objects: readonly PageObject[];
  scale: PageScale | null;
}

export type ExportWarningCode =
  /** La pagina ha coperture e annotazioni con aspetto proprio (campi, note, timbri): i lettori le disegnano SOPRA il contenuto, quindi anche sopra le coperture. */
  | 'annotations-over-cover'
  /** Contenuto originale non analizzabile (filtro non decodificabile, immagine in linea non delimitabile): isolato solo dal q/Q di pdf-lib. */
  | 'content-unreadable'
  /** Il contenuto originale lascia un Q in piu' o un q aperto: corretto, dettaglio in `text`. */
  | 'content-unbalanced'
  /** Quota con valore automatico ma pagina senza scala: scritta con "?". */
  | 'dimension-without-value';
export interface ExportWarning {
  page: number;
  code: ExportWarningCode;
  text: string;
}

export interface ExportResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Pagine con almeno un oggetto (le sole riscritte). */
  touchedPages: number;
  objectCount: number;
  warnings: ExportWarning[];
  /** Tempi in ms: lettura (pdf-lib), scrittura degli oggetti, salvataggio. */
  timing: { load: number; draw: number; save: number };
}

export interface ExportOptions {
  /** Chiamata dopo ogni pagina elaborata (`done` su `total` pagine con oggetti). */
  onProgress?: (done: number, total: number) => void;
  /** Oggetti PDF per giro del salvataggio prima di cedere il controllo all'interfaccia (predefinito di pdf-lib: 50). */
  objectsPerTick?: number;
}

const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const colorOf = (hex: string): [number, number, number] => [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
const WHITE: [number, number, number] = [1, 1, 1];
/** Cerchio con 4 curve di Bezier (costante standard 4/3 * (sqrt(2) - 1)). */
const KAPPA = 0.5522847498307936;

const miterLimit = (v: number): PDFOperator => PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [PDFNumber.of(v)]);
const capOf = (): LineCapStyle => (STROKE_CAP === 'butt' ? LineCapStyle.Butt : LineCapStyle.Round);
const joinOf = (): LineJoinStyle => (STROKE_JOIN === 'miter' ? LineJoinStyle.Miter : LineJoinStyle.Round);

// ---------- Operatori degli oggetti (nello spazio utente) ----------
function polylineOps(pts: readonly UserPoint[], color: string, widthUser: number, dashUser: readonly number[]): PDFOperator[] {
  const [r, g, b] = colorOf(color);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingRgbColor(r, g, b),
    setLineWidth(widthUser),
    setLineCap(capOf()),
    setLineJoin(joinOf()),
    miterLimit(STROKE_MITER_LIMIT),
    setDashPattern([...dashUser], 0),
  ];
  pts.forEach((p, i) => ops.push(i === 0 ? moveTo(p.x, p.y) : lineTo(p.x, p.y)));
  ops.push(stroke(), popGraphicsState());
  return ops;
}

function polygonOps(pts: readonly UserPoint[], fillColor: [number, number, number], border?: { color: string; widthUser: number }): PDFOperator[] {
  const ops: PDFOperator[] = [pushGraphicsState(), setFillingRgbColor(...fillColor)];
  if (border) {
    const [r, g, b] = colorOf(border.color);
    ops.push(setStrokingRgbColor(r, g, b), setLineWidth(border.widthUser), setLineCap(capOf()), setLineJoin(joinOf()), miterLimit(STROKE_MITER_LIMIT), setDashPattern([], 0));
  }
  pts.forEach((p, i) => ops.push(i === 0 ? moveTo(p.x, p.y) : lineTo(p.x, p.y)));
  ops.push(closePath(), border ? fillAndStroke() : fill(), popGraphicsState());
  return ops;
}

function circleOps(c: UserPoint, r: number): PDFOperator[] {
  const k = KAPPA * r;
  return [
    pushGraphicsState(),
    setFillingRgbColor(...WHITE),
    moveTo(c.x + r, c.y),
    appendBezierCurve(c.x + r, c.y + k, c.x + k, c.y + r, c.x, c.y + r),
    appendBezierCurve(c.x - k, c.y + r, c.x - r, c.y + k, c.x - r, c.y),
    appendBezierCurve(c.x - r, c.y - k, c.x - k, c.y - r, c.x, c.y - r),
    appendBezierCurve(c.x + k, c.y - r, c.x + r, c.y - k, c.x + r, c.y),
    closePath(),
    fill(),
    popGraphicsState(),
  ];
}

/** Primitive di un testo o di una quota (calcolate sul foglio) riportate nello spazio utente: linee, frecce, badge; i testi a parte. */
function layoutOps(l: Layout, geom: PageGeometry): PDFOperator[] {
  const u = geom.userUnit;
  const toUser = (p: SheetPoint): UserPoint => geom.sheetToUser(p);
  const ops: PDFOperator[] = [];
  for (const ln of l.lines) ops.push(...polylineOps(ln.pts.map(toUser), ln.color, ln.widthPt / u, []));
  for (const a of l.arrows) ops.push(...polygonOps(a.pts.map(toUser), colorOf(a.color)));
  for (const bx of l.boxes) {
    const { x, y, w, h } = bx.rect;
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ].map(toUser);
    ops.push(...polygonOps(corners, WHITE, { color: bx.color, widthUser: bx.borderPt / u }));
  }
  return ops;
}

// ---------- Isolamento dal contenuto originale ----------
/** Contenuto originale della pagina (dopo `normalize()`, tra il q e il Q di pdf-lib), decodificato; null se non leggibile. */
function originalContent(page: PDFPage): { bytes: Uint8Array } | null {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return { bytes: new Uint8Array(0) };
  const push = ctx.getPushGraphicsStateContentStream();
  const pop = ctx.getPopGraphicsStateContentStream();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i);
      if (ref === push || ref === pop) continue;
      const s = ctx.lookup(ref);
      let data: Uint8Array | undefined;
      if (s instanceof PDFRawStream) data = decodePDFRawStream(s).decode();
      else if (s instanceof PDFStream) data = s.getContents();
      if (data && data.length > 0) {
        chunks.push(data, Uint8Array.of(0x0a));
        total += data.length + 1;
      }
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes };
}

/** ExtGState che riporta alla normalita' trasparenza e maschere (usato solo se il contenuto originale non e' pulito). */
function resetGraphicsState(page: PDFPage): PDFOperator {
  const ctx = page.doc.context;
  const dict = ctx.obj({ Type: 'ExtGState', CA: 1, ca: 1, BM: 'Normal', SMask: 'None' });
  const name = page.node.newExtGState('GtPdfReset', ctx.register(dict));
  return PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams, [name]);
}

// ---------- Controlli sulla pagina ----------
const norm = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/**
 * Confronta la pagina vista da PDF.js (quella dell'app, su cui sono salvati gli oggetti) con quella vista da pdf-lib (su cui si scrive):
 * stessa area visibile, stessa rotazione, stesso UserUnit. Se non coincidono gli oggetti finirebbero nel posto sbagliato.
 */
function checkSamePage(page: PDFPage, spec: PageSpec, no: number): void {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const [mx0, mx1] = norm(media.x, media.x + media.width);
  const [my0, my1] = norm(media.y, media.y + media.height);
  const [cx0, cx1] = norm(crop.x, crop.x + crop.width);
  const [cy0, cy1] = norm(crop.y, crop.y + crop.height);
  const view = [Math.max(mx0, cx0), Math.max(my0, cy0), Math.min(mx1, cx1), Math.min(my1, cy1)];
  const rot = (((Math.round(page.getRotation().angle) % 360) + 360) % 360) as number;
  const specRot = (((spec.rotate % 360) + 360) % 360) as number;
  const uu = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
  const same = view.every((v, i) => Math.abs(v - (spec.view[i] as number)) <= 0.01) && rot === specRot && Math.abs(uu - (spec.userUnit > 0 ? spec.userUnit : 1)) <= 1e-9;
  if (!same) throw new ExportError('mismatch', `La pagina ${no} risulta diversa tra la lettura per la vista e quella per la scrittura (area visibile, rotazione o UserUnit).`, undefined, no);
}

/** Annotazioni con aspetto proprio (/AP), non nascoste: i lettori le disegnano dopo il contenuto, cioe' sopra le coperture. */
function visibleAnnotationCount(page: PDFPage): number {
  try {
    const annots = page.node.Annots();
    if (!annots) return 0;
    let n = 0;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a || !a.has(PDFName.of('AP'))) continue;
      const flags = a.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
      if ((flags & 0b10) !== 0 || (flags & 0b100000) !== 0) continue; // Hidden (bit 2) o NoView (bit 6)
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Esporta in "Copertura semplice". `original` non viene modificato (verificato dai test: stesso hash prima e dopo).
 * Lancia `ExportError` se non riesce; in quel caso non e' stato prodotto nulla e la sessione dell'app e' intatta.
 */
export async function exportCoverSimple(original: Uint8Array, pages: readonly ExportPage[], options: ExportOptions = {}): Promise<ExportResult> {
  const warnings: ExportWarning[] = [];
  const t0 = now();
  let doc: PDFDocument;
  let pdfLibPages: number;
  try {
    // password '' = utente vuoto: i PDF con sole restrizioni del proprietario (si aprono senza password) vengono letti; un'altra password
    // fa fallire il caricamento (ma PDF.js, all'apertura, li ha gia' rifiutati). updateMetadata false: Producer e date restano quelli dell'originale.
    doc = await PDFDocument.load(original, { password: '', updateMetadata: false });
    pdfLibPages = doc.getPageCount(); // anche questo legge l'albero delle pagine: un PDF senza catalogo fallisce qui
  } catch (e) {
    throw toExportError(e, 'load');
  }
  const t1 = now();

  if (pdfLibPages !== pages.length) {
    throw new ExportError('mismatch', `Il PDF ha ${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'} per la vista e ${pdfLibPages} per la scrittura.`);
  }
  const targets: number[] = [];
  pages.forEach((p, i) => {
    if (p.objects.length > 0) targets.push(i);
  });

  let font: PDFFont | null = null;
  let objectCount = 0;
  try {
    let done = 0;
    for (const i of targets) {
      const input = pages[i] as ExportPage;
      const no = i + 1;
      let page: PDFPage;
      try {
        page = doc.getPage(i);
        checkSamePage(page, input.spec, no);
      } catch (e) {
        if (e instanceof ExportError) throw e;
        // pagina senza /Type /Page, riquadro che non e' un rettangolo, ...: PDF.js la legge, la libreria di scrittura no
        throw new ExportError('unreadable', `La pagina ${no} non e' leggibile dalla libreria di scrittura.`, e, no);
      }
      const geom = new PageGeometry(input.spec);

      // 1) isolamento: normalize() racchiude il contenuto originale tra q e Q; poi si correggono q aperti, Q in piu' e matrice.
      page.node.normalize();
      const content = originalContent(page);
      const analysis: ContentAnalysis | null = content ? analyzeContent(content.bytes) : null;
      const head: PDFOperator[] = [];
      if (!analysis) {
        warnings.push({ page: no, code: 'content-unreadable', text: `Pagina ${no}: contenuto originale non analizzabile; isolato solo dal q/Q di pdf-lib.` });
      } else {
        for (let k = 0; k < analysis.closers; k++) head.push(popGraphicsState());
        if (analysis.resetMatrix) head.push(concatTransformationMatrix(...analysis.resetMatrix));
        if (analysis.closers > 0 || analysis.strayQ > 0 || analysis.resetMatrix || analysis.singular) {
          warnings.push({
            page: no,
            code: 'content-unbalanced',
            text: `Pagina ${no}: il contenuto originale lascia ${analysis.closers} q aperti e ha ${analysis.strayQ} Q in piu'${analysis.resetMatrix ? ' e lascia una matrice diversa dall\'identita\'' : ''}: corretto prima degli oggetti.`,
          });
        }
      }
      head.push(pushGraphicsState());
      if (!analysis || analysis.closers > 0 || analysis.strayQ > 0 || analysis.resetMatrix || analysis.singular) {
        // contenuto non pulito: oltre alla matrice, riporta alla normalita' testo e trasparenza (il ritaglio non e' ripristinabile)
        head.push(
          PDFOperator.of(PDFOperatorNames.SetCharacterSpacing, [PDFNumber.of(0)]),
          PDFOperator.of(PDFOperatorNames.SetWordSpacing, [PDFNumber.of(0)]),
          PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(100)]),
          PDFOperator.of(PDFOperatorNames.SetTextRise, [PDFNumber.of(0)]),
          PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(0)]),
          resetGraphicsState(page),
        );
      }
      page.pushOperators(...head);

      // 2) oggetti: coperture per prime, poi il resto nell'ordine di creazione
      let hasCover = false;
      for (const o of drawOrder(input.objects)) {
        objectCount++;
        if (o.kind === 'cover') {
          hasCover = true;
          if (o.shape === 'circle') page.pushOperators(...circleOps(o.p1, coverUserRadius(o)));
          else {
            const b = coverUserBox(o);
            page.pushOperators(
              ...polygonOps(
                [
                  { x: b.x, y: b.y },
                  { x: b.x + b.w, y: b.y },
                  { x: b.x + b.w, y: b.y + b.h },
                  { x: b.x, y: b.y + b.h },
                ],
                WHITE,
              ),
            );
          }
        } else if (isLine(o)) {
          page.pushOperators(...polylineOps(o.points, o.stroke.color, o.stroke.widthPt / geom.userUnit, dashPattern(o.stroke.style, o.stroke.widthPt).map((d) => d / geom.userUnit)));
        } else {
          let layout: Layout;
          if (o.kind === 'text') layout = layoutText(o, geom);
          else {
            let label = dimensionLabel(o, geom, input.scale);
            if (label === null) {
              label = '?';
              warnings.push({ page: no, code: 'dimension-without-value', text: `Pagina ${no}: una quota con valore automatico non ha la scala della pagina; scritta con "?".` });
            }
            layout = layoutDimension(o, geom, label);
          }
          page.pushOperators(...layoutOps(layout, geom));
          for (const run of exportRuns(layout, geom)) {
            if (run.text === '') continue;
            font ??= await doc.embedFont(StandardFonts.Helvetica);
            const [r, g, b] = colorOf(run.color);
            page.drawText(run.text, { x: run.x, y: run.y, size: run.size, font, color: rgb(r, g, b), rotate: degrees(run.angleDeg) });
          }
        }
      }
      page.pushOperators(popGraphicsState());

      if (hasCover) {
        const n = visibleAnnotationCount(page);
        if (n > 0) {
          warnings.push({
            page: no,
            code: 'annotations-over-cover',
            text: `Pagina ${no}: ${n === 1 ? 'un\'annotazione' : `${n} annotazioni`} del PDF (campi, note, timbri) restano sopra le coperture: i lettori le disegnano dopo il contenuto.`,
          });
        }
      }
      options.onProgress?.(++done, targets.length);
      await yieldToUi();
    }
  } catch (e) {
    throw toExportError(e, 'write');
  }
  const t2 = now();

  let bytes: Uint8Array;
  try {
    bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: options.objectsPerTick });
  } catch (e) {
    throw toExportError(e, 'write');
  }
  const t3 = now();
  return { bytes, pageCount: pages.length, touchedPages: targets.length, objectCount, warnings, timing: { load: t1 - t0, draw: t2 - t1, save: t3 - t2 } };
}
