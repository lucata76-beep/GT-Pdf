// Disegno di testi e quote come primitive nel foglio (pt fisici, origine in alto a sinistra, Y verso il basso):
// linee, frecce (triangoli pieni), badge dell'etichetta e testi. Funzioni pure: le usano il livello di disegno a schermo,
// la scelta dell'oggetto da cancellare (`hit`) e, in CP5, l'esportazione (`exportRuns` riporta i testi nello spazio utente).
// I testi sono SEMPRE orizzontali sul foglio mostrato (anche con /Rotate): nel PDF cio' vuol dire ruotarli di
// `PageGeometry.uprightAngleDeg`. Proporzioni di frecce e badge: scelte di progetto (NON derivate da una norma), in docs/PIANO.md.
import { angularGeometry, arcPoints } from './angular';
import type { SheetArc } from './arc';
import type { DimensionDef } from './dimension';
import type { PageGeometry, SheetPoint, UserPoint } from './page';
import { ASCENT_EM, DESCENT_EM, textWidthPt } from './textMetrics';

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutLine {
  pts: SheetPoint[];
  widthPt: number;
  color: string;
}
export interface LayoutArrow {
  /** Punta e i due angoli della base. */
  pts: [SheetPoint, SheetPoint, SheetPoint];
  color: string;
}
/** Badge dell'etichetta: fondo bianco, bordo sottile (DESIGN.md), angoli vivi. */
export interface LayoutBox {
  rect: SheetRect;
  borderPt: number;
  color: string;
}
/** Testo con l'origine nell'angolo in basso a sinistra della linea di base (come `drawText` di PDF). */
export interface LayoutText {
  text: string;
  x: number;
  y: number;
  sizePt: number;
  color: string;
}
/** Cerchio pieno nel foglio (pt fisici). */
export interface SheetCircle {
  c: SheetPoint;
  r: number;
}
/**
 * Forma per scegliere l'oggetto con un tocco: spezzate, rettangoli e cerchi PIENI nel foglio (`circles`: la Copertura circolare, distanza 0 dentro) e,
 * dal V2b, cerchi e archi come LINEA (`arcs`: la distanza e' quella dalla circonferenza o dall'arco, mai 0 dentro: un disco pieno nasconderebbe gli
 * oggetti che stanno sotto). Il cerchio e' un arco con `|sweep| = 2 pi`. `arcs` manca nelle forme che non ne hanno.
 */
export interface Shape {
  lines: SheetPoint[][];
  rects: SheetRect[];
  circles: SheetCircle[];
  arcs?: SheetArc[];
}
/** L'unione di piu' forme (la selezione multipla di CP6e): stesse primitive, una dopo l'altra. */
export function unionShapes(shapes: readonly Shape[]): Shape {
  const out: Shape = { lines: [], rects: [], circles: [] };
  for (const sh of shapes) {
    for (const l of sh.lines) out.lines.push(l);
    for (const r of sh.rects) out.rects.push(r);
    for (const c of sh.circles) out.circles.push(c);
    if (sh.arcs && sh.arcs.length > 0) (out.arcs ??= []).push(...sh.arcs);
  }
  return out;
}
export interface Layout {
  lines: LayoutLine[];
  arrows: LayoutArrow[];
  boxes: LayoutBox[];
  texts: LayoutText[];
  hit: Shape;
}

// ---- Proporzioni (in funzione del corpo del testo `textPt`) ----
/** Lunghezza della freccia: 0.8 x corpo, ma almeno 3 x spessore. Semiapertura = 1/6 della lunghezza (circa 19 gradi in tutto). */
export const ARROW_LEN_EM = 0.8;
export const ARROW_MIN_PER_WIDTH = 3;
export const ARROW_HALF_WIDTH_RATIO = 1 / 6;
/** Linee di estensione: stacco dal punto misurato e sporgenza oltre la linea di quota. */
export const EXT_GAP_EM = 0.25;
export const EXT_OVERSHOOT_EM = 0.4;
/** Badge: margine interno e distanza dalla linea di quota. */
export const LABEL_PAD_EM = 0.25;
export const LABEL_GAP_EM = 0.3;
export const LABEL_BORDER_PT = 0.5;
/** Con la linea di quota piu' corta di 2.5 frecce, le frecce vanno fuori dalle linee di estensione. */
export const ARROWS_OUTSIDE_BELOW = 2.5;

const EPS = 1e-9;
const dist = (a: SheetPoint, b: SheetPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

export interface TextSpec {
  /** Angolo in basso a sinistra della linea di base, nello spazio utente. */
  at: UserPoint;
  text: string;
  /** Corpo del carattere in pt FISICI del foglio. */
  textPt: number;
  color: string;
}

/** Rettangolo del testo nel foglio: da `ASCENT` sopra la linea di base a `DESCENT` sotto. */
export function textRect(origin: SheetPoint, text: string, sizePt: number): SheetRect {
  return { x: origin.x, y: origin.y - ASCENT_EM * sizePt, w: textWidthPt(text, sizePt), h: (ASCENT_EM + DESCENT_EM) * sizePt };
}

export function layoutText(t: TextSpec, geom: PageGeometry): Layout {
  const o = geom.userToSheet(t.at);
  const rect = textRect(o, t.text, t.textPt);
  return {
    lines: [],
    arrows: [],
    boxes: [],
    texts: t.text === '' ? [] : [{ text: t.text, x: o.x, y: o.y, sizePt: t.textPt, color: t.color }],
    hit: { lines: [], rects: [rect], circles: [] },
  };
}

export interface DimSpec extends DimensionDef {
  /** Corpo dell'etichetta, spessore di linee e frecce (pt fisici) e colore. */
  textPt: number;
  widthPt: number;
  color: string;
}

/**
 * Quota angolare (CP6g): l'arco e' una POLILINEA dentro `lines` (nessun arco vero nel layout: overlay, "Appiattito" e "Copertura semplice" lo disegnano come ogni altra
 * linea), dal lato 1 al lato 2 per la via breve, di raggio R = distanza del vertice dal punto `b`; passo massimo e scarto massimo in `geometry/angular`. Frecce con la punta
 * sugli estremi dell'arco, lungo la tangente: dentro se l'arco e' lungo almeno ARROWS_OUTSIDE_BELOW frecce, altrimenti fuori. Linee di estensione sottili dal punto `p` di ogni
 * lato verso l'arco (con lo stesso stacco e la stessa sporgenza delle lineari), solo dove il lato non arriva all'arco. Badge sul prolungamento della bisettrice, fuori dall'arco.
 * Il testo e' quello passato: "45.00°" o il valore digitato.
 */
function layoutAngular(d: DimSpec, geom: PageGeometry, label: string): Layout {
  const size = d.textPt;
  const g = angularGeometry(d, geom);
  const pad = LABEL_PAD_EM * size;
  const boxW = textWidthPt(label, size) + 2 * pad;
  const boxH = (ASCENT_EM + DESCENT_EM) * size + 2 * pad;
  const badge = (c: SheetPoint): Pick<Layout, 'boxes' | 'texts'> & { rect: SheetRect } => {
    const rect: SheetRect = { x: c.x - boxW / 2, y: c.y - boxH / 2, w: boxW, h: boxH };
    return {
      rect,
      boxes: [{ rect, borderPt: LABEL_BORDER_PT, color: d.color }],
      texts: [{ text: label, x: rect.x + pad, y: rect.y + pad + ASCENT_EM * size, sizePt: size, color: d.color }],
    };
  };
  if (!g) {
    // punti che non danno un angolo (non succede: costruzione e file lo escludono): solo il badge sul vertice, perche' l'esportazione non si fermi
    const b = badge(geom.userToSheet(d.a));
    return { lines: [], arrows: [], boxes: b.boxes, texts: b.texts, hit: { lines: [], rects: [b.rect], circles: [] } };
  }

  const arc = arcPoints(g);
  const lines: LayoutLine[] = [{ pts: arc, widthPt: d.widthPt, color: d.color }];
  const hitLines: SheetPoint[][] = [arc];

  // linee di estensione: dal punto del lato verso l'arco (e un po' oltre), solo se il lato non lo raggiunge; se il lato e' oltre l'arco tornano indietro verso di lui
  const gap = EXT_GAP_EM * size;
  const over = EXT_OVERSHOOT_EM * size;
  const extWidth = Math.min(d.widthPt, Math.max(0.25, d.widthPt / 2));
  for (const [p, u] of [
    [d.p1, g.u1],
    [d.p2, g.u2],
  ] as const) {
    const rho = dist(geom.userToSheet(p), g.v);
    const toArc = g.radius - rho;
    if (Math.abs(toArc) <= gap) continue;
    const dir = toArc > 0 ? 1 : -1;
    const from = rho + dir * gap;
    const to = g.radius + dir * over;
    const pts = [
      { x: g.v.x + u.x * from, y: g.v.y + u.y * from },
      { x: g.v.x + u.x * to, y: g.v.y + u.y * to },
    ];
    lines.push({ pts, widthPt: extWidth, color: d.color });
    hitLines.push(pts);
  }

  // frecce: la punta sull'estremo dell'arco, il corpo lungo la tangente (verso l'interno dell'arco, o verso l'esterno se l'arco e' troppo corto)
  const L = Math.max(ARROW_LEN_EM * size, ARROW_MIN_PER_WIDTH * d.widthPt);
  const hw = L * ARROW_HALF_WIDTH_RATIO;
  const inside = g.radius * g.angle >= ARROWS_OUTSIDE_BELOW * L;
  const sg = g.sweep >= 0 ? 1 : -1;
  const tangent = (u: SheetPoint): SheetPoint => ({ x: -u.y * sg, y: u.x * sg }); // verso da lato 1 a lato 2
  const arrow = (u: SheetPoint, dir: SheetPoint): LayoutArrow => {
    const tip = { x: g.v.x + u.x * g.radius, y: g.v.y + u.y * g.radius };
    const base = { x: tip.x + dir.x * L, y: tip.y + dir.y * L };
    return { pts: [tip, { x: base.x + u.x * hw, y: base.y + u.y * hw }, { x: base.x - u.x * hw, y: base.y - u.y * hw }], color: d.color };
  };
  const t1 = tangent(g.u1);
  const t2 = tangent(g.u2);
  const into = inside ? 1 : -1;
  const arrows: LayoutArrow[] = [arrow(g.u1, { x: t1.x * into, y: t1.y * into }), arrow(g.u2, { x: -t2.x * into, y: -t2.y * into })];

  // badge: sul prolungamento della bisettrice, fuori dall'arco (come le lineari: dal lato opposto ai punti misurati, cosi' non copre le frecce)
  const m = g.mid;
  const shift = Math.abs(m.x) * (boxW / 2) + Math.abs(m.y) * (boxH / 2) + LABEL_GAP_EM * size;
  const top = { x: g.v.x + m.x * g.radius, y: g.v.y + m.y * g.radius };
  const b = badge({ x: top.x + m.x * shift, y: top.y + m.y * shift });

  return { lines, arrows, boxes: b.boxes, texts: b.texts, hit: { lines: hitLines, rects: [b.rect], circles: [] } };
}

export function layoutDimension(d: DimSpec, geom: PageGeometry, label: string): Layout {
  if (d.dim === 'angular') return layoutAngular(d, geom, label);
  const size = d.textPt;
  const s1 = geom.userToSheet(d.p1);
  const s2 = geom.userToSheet(d.p2);
  const A = geom.userToSheet(d.a);
  const B = geom.userToSheet(d.b);
  const linear = d.dim === 'aligned' || d.dim === 'horizontal' || d.dim === 'vertical';
  const len = dist(A, B);
  const t = len > EPS ? { x: (B.x - A.x) / len, y: (B.y - A.y) / len } : { x: 1, y: 0 };
  const perp = { x: -t.y, y: t.x };

  const lines: LayoutLine[] = [{ pts: [A, B], widthPt: d.widthPt, color: d.color }];
  const hitLines: SheetPoint[][] = [[A, B]];
  if (linear) {
    const gap = EXT_GAP_EM * size;
    const over = EXT_OVERSHOOT_EM * size;
    const extWidth = Math.min(d.widthPt, Math.max(0.25, d.widthPt / 2)); // linee di estensione sottili
    for (const [s, e] of [
      [s1, A],
      [s2, B],
    ] as const) {
      const l = dist(s, e);
      if (l <= gap) continue;
      const u = { x: (e.x - s.x) / l, y: (e.y - s.y) / l };
      const pts = [
        { x: s.x + u.x * gap, y: s.y + u.y * gap },
        { x: e.x + u.x * over, y: e.y + u.y * over },
      ];
      lines.push({ pts, widthPt: extWidth, color: d.color });
      hitLines.push(pts);
    }
  }

  // Frecce: dentro la linea di quota (la punta tocca l'estremo) o, se e' troppo corta, fuori.
  const L = Math.max(ARROW_LEN_EM * size, ARROW_MIN_PER_WIDTH * d.widthPt);
  const hw = L * ARROW_HALF_WIDTH_RATIO;
  const inside = len >= ARROWS_OUTSIDE_BELOW * L;
  const arrow = (tip: SheetPoint, dir: SheetPoint): LayoutArrow => {
    const base = { x: tip.x + dir.x * L, y: tip.y + dir.y * L };
    return {
      pts: [tip, { x: base.x + perp.x * hw, y: base.y + perp.y * hw }, { x: base.x - perp.x * hw, y: base.y - perp.y * hw }],
      color: d.color,
    };
  };
  const into = inside ? 1 : -1; // verso l'interno della linea di quota, o verso l'esterno
  const arrows: LayoutArrow[] = [arrow(B, { x: -t.x * into, y: -t.y * into })]; // in B (R: sul bordo)
  if (d.dim !== 'radius') arrows.push(arrow(A, { x: t.x * into, y: t.y * into }));

  // Badge dell'etichetta, accanto alla linea di quota dal lato opposto ai punti misurati (cosi' non copre le frecce).
  // Lineari con offset zero, Ø e R: dal lato "su" (poi "destra") della linea.
  const pad = LABEL_PAD_EM * size;
  const boxW = textWidthPt(label, size) + 2 * pad;
  const boxH = (ASCENT_EM + DESCENT_EM) * size + 2 * pad;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const measuredMid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
  const off = { x: mid.x - measuredMid.x, y: mid.y - measuredMid.y };
  const offLen = Math.hypot(off.x, off.y);
  let n = perp;
  if (linear && offLen > 1e-6) n = { x: off.x / offLen, y: off.y / offLen };
  else if (n.y > EPS || (Math.abs(n.y) <= EPS && n.x < 0)) n = { x: -n.x, y: -n.y };
  const shift = Math.abs(n.x) * (boxW / 2) + Math.abs(n.y) * (boxH / 2) + LABEL_GAP_EM * size;
  const c = { x: mid.x + n.x * shift, y: mid.y + n.y * shift };
  const rect: SheetRect = { x: c.x - boxW / 2, y: c.y - boxH / 2, w: boxW, h: boxH };

  return {
    lines,
    arrows,
    boxes: [{ rect, borderPt: LABEL_BORDER_PT, color: d.color }],
    texts: [{ text: label, x: rect.x + pad, y: rect.y + pad + ASCENT_EM * size, sizePt: size, color: d.color }],
    hit: { lines: hitLines, rects: [rect], circles: [] },
  };
}

// ---- Esportazione (CP5) ----
/** Testo pronto per `drawText` di pdf-lib: posizione e corpo nello spazio utente, rotazione per apparire dritto sul foglio. */
export interface ExportTextRun {
  text: string;
  /** Origine nello spazio utente PDF (unita' utente). */
  x: number;
  y: number;
  /** Corpo in unita' utente: i pt fisici divisi per UserUnit. */
  size: number;
  /** Rotazione antioraria in gradi attorno a (x, y). */
  angleDeg: number;
  color: string;
}

export function exportRuns(layout: Layout, geom: PageGeometry): ExportTextRun[] {
  return layout.texts.map((t) => {
    const o = geom.sheetToUser({ x: t.x, y: t.y });
    return { text: t.text, x: o.x, y: o.y, size: t.sizePt / geom.userUnit, angleDeg: geom.uprightAngleDeg, color: t.color };
  });
}
