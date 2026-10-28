// Pittore su canvas della scena di una pagina, per l'esportazione "Appiattito". Disegna lo STESSO elenco di primitive del livello SVG a
// schermo (`model/scene.ts`: coperture per prime, poi linee, quote e testi nell'ordine di creazione) con le stesse regole: tratteggi in pt
// (`dashPattern`), terminazioni butt, giunzioni miter con limite 10, frecce piene, badge bianco con bordo, testo nel carattere di
// `DRAWING_FONT`. Il chiamante imposta la trasformazione: le coordinate sono in pt fisici del foglio (origine in alto a sinistra), quindi
// con `scale(dpi / 72)` spessori, pattern e corpo dei testi sono quelli fisici (nessuno spessore minimo: a schermo c'e' MIN_SCREEN_STROKE_PX,
// su carta no).
import { type DrawItem, DRAWING_FONT } from '../model/scene';
import { STROKE_CAP, STROKE_JOIN, STROKE_MITER_LIMIT, dashPattern } from '../model/stroke';

/** Il sottoinsieme di CanvasRenderingContext2D che serve (cosi' si prova con un contesto finto). */
export interface PaintContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  lineDashOffset: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  setLineDash(segments: number[]): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

const WHITE = '#ffffff';

function strokePath(ctx: PaintContext, pts: readonly { x: number; y: number }[], color: string, widthPt: number, dash: number[]): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPt;
  ctx.lineCap = STROKE_CAP;
  ctx.lineJoin = STROKE_JOIN;
  ctx.miterLimit = STROKE_MITER_LIMIT;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

export function paintItems(ctx: PaintContext, items: readonly DrawItem[]): void {
  for (const it of items) {
    if (it.kind === 'cover') {
      ctx.fillStyle = WHITE;
      if (it.cover.kind === 'rect') ctx.fillRect(it.cover.rect.x, it.cover.rect.y, it.cover.rect.w, it.cover.rect.h);
      else {
        ctx.beginPath();
        ctx.arc(it.cover.circle.c.x, it.cover.circle.c.y, it.cover.circle.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (it.kind === 'line') {
      strokePath(ctx, it.points, it.stroke.color, it.stroke.widthPt, dashPattern(it.stroke.style, it.stroke.widthPt));
    } else {
      const l = it.layout;
      for (const ln of l.lines) strokePath(ctx, ln.pts, ln.color, ln.widthPt, []);
      for (const a of l.arrows) {
        ctx.fillStyle = a.color;
        ctx.beginPath();
        a.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
      }
      for (const b of l.boxes) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.borderPt;
        ctx.lineJoin = STROKE_JOIN;
        ctx.miterLimit = STROKE_MITER_LIMIT;
        ctx.setLineDash([]);
        ctx.strokeRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      }
      for (const t of l.texts) {
        ctx.fillStyle = t.color;
        ctx.font = `${t.sizePt}px ${DRAWING_FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(t.text, t.x, t.y);
      }
    }
  }
}
