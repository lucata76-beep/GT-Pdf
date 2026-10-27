// Disegno di testi e quote come primitive nel foglio (pt fisici, origine in alto a sinistra, Y verso il basso):
// linee, frecce (triangoli pieni), badge dell'etichetta e testi. Funzioni pure: le usano il livello di disegno a schermo,
// la scelta dell'oggetto da cancellare (`hit`) e, in CP5, l'esportazione (`exportRuns` riporta i testi nello spazio utente).
// I testi sono SEMPRE orizzontali sul foglio mostrato (anche con /Rotate): nel PDF cio' vuol dire ruotarli di
// `PageGeometry.uprightAngleDeg`. Proporzioni di frecce e badge: scelte di progetto (NON derivate da una norma), in docs/PIANO.md.
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
/** Forma per scegliere l'oggetto con un tocco: spezzate e rettangoli nel foglio. */
export interface Shape {
  lines: SheetPoint[][];
  rects: SheetRect[];
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
    hit: { lines: [], rects: [rect] },
  };
}

export interface DimSpec extends DimensionDef {
  /** Corpo dell'etichetta, spessore di linee e frecce (pt fisici) e colore. */
  textPt: number;
  widthPt: number;
  color: string;
}

export function layoutDimension(d: DimSpec, geom: PageGeometry, label: string): Layout {
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
    hit: { lines: hitLines, rects: [rect] },
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
