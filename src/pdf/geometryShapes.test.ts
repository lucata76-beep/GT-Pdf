// Prove unitarie della misura in piu' su cerchi e archi (V3.2a, CP7c): composizione dei sottopercorsi con cubiche (aperti di sole cubiche, misti aperti e chiusi, chiusi di sole cubiche),
// sottopercorsi di sole cubiche con 4 cubiche (distanza fra ultimo e primo punto, regola del cerchio senza la chiusura), lunghezza esattamente 0 di tratti e corde delle cubiche, e il
// testo di "Copia misura". I numeri attesi sono scritti qui, da composizioni note (nessuno viene dal codice provato). Le prove di CP7a (geometry.test.ts, geometryMeasure.test.ts) non
// sono toccate: qui si provano solo i campi e le righe NUOVI.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CIRCLE_TOL_ABS,
  CIRCLE_TOL_REL,
  CLOSE_COINCIDENCE,
  DRAW_CLOSE,
  DRAW_CURVE_TO,
  DRAW_LINE_TO,
  DRAW_MOVE_TO,
  DRAW_QUAD_TO,
  type GeometryStats,
  circleFrom4Cubics,
  extractGeometry,
  gapBucket,
  lineToBucket,
} from './geometry';
import { type PageMeasure, measureLines, measurePage, measureText } from './geometryMeasure';
import { makePdf } from './geometryTestUtils';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
type Op = [string, unknown];
const path = (paint: string, cmds: number[]): Op => ['constructPath', [OPS[paint], [cmds], null]];
function stats(list: Op[]): GeometryStats {
  const r = extractGeometry({ fnArray: list.map(([n]) => OPS[n] as number), argsArray: list.map(([, a]) => a), ops: OPS, isLayerVisible: () => true });
  if (!r.ok) throw new Error(r.reason);
  return r.stats;
}
const M = (x: number, y: number): number[] => [DRAW_MOVE_TO, x, y];
const Lt = (x: number, y: number): number[] => [DRAW_LINE_TO, x, y];
const C = (a: number, b: number, c: number, d: number, e: number, f: number): number[] => [DRAW_CURVE_TO, a, b, c, d, e, f];
const Q = (a: number, b: number, c: number, d: number): number[] => [DRAW_QUAD_TO, a, b, c, d];
const Z: number[] = [DRAW_CLOSE];
const cat = (...p: number[][]): number[] => p.flat();
const KAPPA = 0.5522847498307936;

/** Cubica "generica" da (x, y) a (x + dx, y): non fa parte di nessun cerchio. */
const bump = (x: number, y: number, dx = 10): number[] => C(x + dx / 3, y + 5, x + (2 * dx) / 3, y + 5, x + dx, y);
/**
 * Arco di 4 cubiche da 90 gradi (come pdf-lib scrive un cerchio) di centro (cx, cy) e raggio r, in senso antiorario, che parte da (cx + r, cy) e finisce a (cx + r + gap, cy): `gap` e' la
 * distanza di chiusura (ultimo punto contro primo). Senza `h`: il sottopercorso e' aperto se gap > 0.001 pt, chiuso per coincidenza altrimenti.
 */
function arc4(cx: number, cy: number, r: number, gap = 0): number[] {
  const k = KAPPA * r;
  return cat(
    M(cx + r, cy),
    C(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    C(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    C(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    C(cx + k, cy - r, cx + r, cy - k, cx + r + gap, cy),
  );
}

describe('contatori nuovi: arco di 4 cubiche con chiusura a 5e-4, 2e-3 e 1e-2 pt', () => {
  it('5e-4 pt: chiuso per coincidenza (<= 0.001): chiuso di sole cubiche da 4, cerchio; distanza nel contenitore fino a 0.001', () => {
    const s = stats([path('stroke', arc4(100, 100, 50, 5e-4))]);
    for (const g of [s.shapesAll, s.shapesCand]) {
      expect(g.closedByCoincidence).toBe(1);
      expect(g.closedCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
      expect(g.circles4).toBe(1);
      expect(g.openCubicOnly).toEqual([0, 0, 0, 0, 0, 0]);
      expect(g.cubicsInOpen).toBe(0);
      expect(g.four.subpaths).toBe(1);
      expect(g.four.open).toBe(0);
      expect(g.four.gapHist).toEqual([0, 1, 0, 0, 0, 0]);
      expect(g.four.gapMin).toBeCloseTo(5e-4, 12);
      expect(g.four.circleNoClose).toBe(1);
      expect(g.closedCubicOnlyCubics).toBe(4);
      expect(g.openCubicOnlyCubics).toBe(0);
    }
  });

  it('2e-3 pt: APERTO (oltre 0.001): aperto di sole cubiche da 4, 4 cubiche in sottopercorsi aperti, non riconosciuto dalla regola con chiusura ma si dalla regola senza chiusura', () => {
    const s = stats([path('stroke', arc4(100, 100, 50, 2e-3))]);
    for (const g of [s.shapesAll, s.shapesCand]) {
      expect(g.closedByCoincidence).toBe(0);
      expect(g.closedCubicOnly).toEqual([0, 0, 0, 0, 0, 0]);
      expect(g.circles4).toBe(0); // la regola di CP7a vale solo per i sottopercorsi chiusi
      expect(g.cubicsInOpen).toBe(4);
      expect(g.openCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
      expect(g.openCubicOnlyCubics).toBe(4);
      expect(g.four.subpaths).toBe(1);
      expect(g.four.open).toBe(1);
      expect(g.four.gapHist).toEqual([0, 0, 1, 0, 0, 0]);
      expect(g.four.gapMax).toBeCloseTo(2e-3, 12);
      expect(g.four.circleNoClose).toBe(1);
      expect(g.four.circleNoCloseMaxDev).toBeGreaterThanOrEqual(0);
      expect(g.four.circleNoCloseMaxDev).toBeLessThan(CIRCLE_TOL_ABS + CIRCLE_TOL_REL * 50 + 0.2); // sotto la tolleranza del punto a meta' delle cubiche
    }
  });

  it('1e-2 pt: aperto, distanza fra 0.005 e 0.05; ancora un cerchio senza la chiusura', () => {
    const s = stats([path('stroke', arc4(100, 100, 50, 1e-2))]);
    expect(s.shapesCand.openCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
    expect(s.shapesCand.four.gapHist).toEqual([0, 0, 0, 1, 0, 0]);
    expect(s.shapesCand.four.circleNoClose).toBe(1);
  });

  it('chiusura a 0.3 e a 5 pt: contenitori fino a 0.5 e oltre; un arco di 4 cubiche che non e\' un cerchio (ellisse) non rispetta la regola senza chiusura', () => {
    const far = stats([path('stroke', arc4(100, 100, 50, 0.3)), path('stroke', arc4(100, 100, 50, 5))]);
    expect(far.shapesCand.four.gapHist).toEqual([0, 0, 0, 0, 1, 1]);
    expect(far.shapesCand.four.gapMin).toBeCloseTo(0.3, 12);
    expect(far.shapesCand.four.gapMax).toBeCloseTo(5, 12);
    // ellisse (asse x doppio, con la matrice di scala): le 4 cubiche non stanno su una circonferenza
    const stretched = cat(M(150, 100), C(150, 127.6, 127.6, 150, 100, 150), C(72.4, 150, 50, 127.6, 50, 100), C(50, 72.4, 72.4, 50, 100, 50), C(127.6, 50, 150, 72.4, 150, 100.5));
    const st = stats([['transform', [2, 0, 0, 1, 0, 0]], path('stroke', stretched)]);
    expect(st.shapesCand.four.subpaths).toBe(1);
    expect(st.shapesCand.four.circleNoClose).toBe(0); // l'ellisse non e' un cerchio
  });

  it('circleFrom4Cubics: il parametro `needClosed` (predefinito true) non cambia i numeri di CP7a; con false si ignora la chiusura', () => {
    const flat = (p: number[]): number[] => {
      // da M + 4 C a 32 numeri: x0 y0 c1 c2 x1 y1 per cubica
      const out: number[] = [];
      let x = p[1]!;
      let y = p[2]!;
      for (let i = 0; i < 4; i++) {
        const o = 3 + i * 7;
        out.push(x, y, p[o + 1]!, p[o + 2]!, p[o + 3]!, p[o + 4]!, p[o + 5]!, p[o + 6]!);
        x = p[o + 5]!;
        y = p[o + 6]!;
      }
      return out;
    };
    const closed = flat(arc4(0, 0, 10, 0));
    // chiusura a 0.05 pt: oltre la tolleranza di chiusura (0.002 + 5e-4 x 10 = 0.007) ma l'ultimo punto sposta il punto a meta' dell'ultima cubica di soli 0.05 / 8 = 0.00625 pt,
    // sotto la tolleranza di quel punto (0.007 + 2e-3 x 10 = 0.027): senza la condizione di chiusura la regola e' rispettata. Con chiusure molto piu' grandi (oltre ~8 x 0.027 pt a r = 10)
    // lo spostamento dell'ultimo punto deforma l'ultima cubica e la regola senza chiusura NON e' piu' rispettata: e' un limite della misura, dichiarato in docs/PIANO.md.
    const open05 = flat(arc4(0, 0, 10, 0.05));
    const dev = circleFrom4Cubics(closed);
    expect(dev).not.toBeNull();
    expect(circleFrom4Cubics(closed, true)).toBe(dev); // stesso numero con il parametro esplicito
    expect(circleFrom4Cubics(open05)).toBeNull();
    expect(circleFrom4Cubics(open05, true)).toBeNull();
    const noClose = circleFrom4Cubics(open05, false);
    expect(noClose).not.toBeNull();
    expect(noClose!).toBeLessThan(0.05); // lo scostamento di chiusura (0.05) non e' nel massimo
    expect(circleFrom4Cubics(flat(arc4(0, 0, 10, 5)), false)).toBeNull(); // chiusura a 5 pt: l'ultima cubica e' deformata, non e' piu' un cerchio
  });

  it('i contenitori della distanza: limite superiore incluso, 0.001 (= CLOSE_COINCIDENCE) nel secondo', () => {
    expect(CLOSE_COINCIDENCE).toBe(0.001);
    expect([0, 1e-4, 1.0001e-4, 0.001, 0.0010001, 0.005, 0.0051, 0.05, 0.0501, 0.5, 0.51, 100].map(gapBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect([0, 1, 2, 3, 4, 5, 8, 9, 100].map(lineToBucket)).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('contatori nuovi: catene miste di rette e curve, cerchio chiuso, conti che tornano', () => {
  it('raccordo fra due rette (retta, cubica, retta, aperto): un misto aperto con 1 cubica e 2 lineTo', () => {
    const s = stats([path('stroke', cat(M(0, 0), Lt(10, 0), bump(10, 0), Lt(30, 0)))]);
    for (const g of [s.shapesAll, s.shapesCand]) {
      expect(g.openMixed).toEqual({ subpaths: 1, cubics: 1, lineTo: 2, quad: 0, byCubics: [1, 0, 0, 0, 0, 0], byLineTo: [0, 0, 1, 0, 0, 0] });
      expect(g.closedMixed.subpaths).toBe(0);
      expect(g.openCubicOnly).toEqual([0, 0, 0, 0, 0, 0]);
      expect(g.cubicsInOpen).toBe(1);
      expect(g.four.subpaths).toBe(0);
    }
  });

  it('rettangolo con gli angoli arrotondati (4 rette, 4 cubiche, closePath): un misto CHIUSO con 4 cubiche e 4 lineTo', () => {
    const rr = cat(M(10, 0), Lt(90, 0), bump(90, 0), Lt(100, 80), bump(100, 80, -10), Lt(10, 90), bump(10, 90, -10), Lt(0, 10), bump(0, 10), Z);
    const s = stats([path('stroke', rr)]);
    expect(s.shapesCand.closedMixed).toEqual({ subpaths: 1, cubics: 4, lineTo: 4, quad: 0, byCubics: [0, 0, 0, 1, 0, 0], byLineTo: [0, 0, 0, 1, 0, 0] });
    expect(s.shapesCand.openMixed.subpaths).toBe(0);
    expect(s.shapesCand.closedCubicOnly).toEqual([0, 0, 0, 0, 0, 0]); // non e' "di sole cubiche"
    expect(s.shapesCand.four.subpaths).toBe(0);
  });

  it('catena di 6 cubiche con una retta in fondo (aperta), e una quadratica con una cubica: misti', () => {
    const chain = cat(M(0, 0), bump(0, 0), bump(10, 0), bump(20, 0), bump(30, 0), bump(40, 0), bump(50, 0), Lt(100, 50));
    const withQuad = cat(M(0, 100), Q(5, 110, 10, 100), bump(10, 100));
    const s = stats([path('stroke', chain), path('stroke', withQuad)]);
    expect(s.shapesCand.openMixed.subpaths).toBe(2);
    expect(s.shapesCand.openMixed.cubics).toBe(7);
    expect(s.shapesCand.openMixed.lineTo).toBe(1);
    expect(s.shapesCand.openMixed.quad).toBe(1);
    expect(s.shapesCand.openMixed.byCubics).toEqual([1, 0, 0, 0, 1, 0]); // 1 cubica (con la quadratica), 6 cubiche (5-8)
    expect(s.shapesCand.openMixed.byLineTo).toEqual([1, 1, 0, 0, 0, 0]); // 0 lineTo (solo quadratica), 1 lineTo
  });

  it('cerchio chiuso (4 cubiche e closePath): chiuso di sole cubiche, distanza nel primo contenitore, regola con e senza chiusura', () => {
    const s = stats([path('stroke', cat(arc4(50, 50, 20, 0), Z))]);
    expect(s.shapesCand.closedCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
    expect(s.shapesCand.circles4).toBe(1);
    expect(s.shapesCand.four).toMatchObject({ subpaths: 1, open: 0, gapHist: [1, 0, 0, 0, 0, 0], circleNoClose: 1 });
    expect(s.shapesCand.four.gapMin).toBe(0);
    // closePath che aggiunge una retta di 0.04 pt (distanza fra 0.005 e 0.05): chiuso di sole cubiche da 4 (conta come tale in CP7a), ma NON cerchio con la chiusura (0.04 > 0.012);
    // senza la chiusura si'
    const withChord = stats([path('stroke', cat(arc4(50, 50, 20, 0.04), Z))]);
    expect(withChord.shapesCand.closedCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
    expect(withChord.shapesCand.circles4).toBe(0);
    expect(withChord.shapesCand.four.open).toBe(0);
    expect(withChord.shapesCand.four.gapHist).toEqual([0, 0, 0, 1, 0, 0]);
    expect(withChord.shapesCand.four.circleNoClose).toBe(1);
  });

  it('il conto delle cubiche torna: chiusi di sole cubiche + aperti di sole cubiche + aperti misti + chiusi misti = cubiche dei percorsi (e le aperte = cubicsInOpen)', () => {
    const list: Op[] = [
      path('stroke', cat(arc4(50, 50, 20, 0), Z)), // chiuso di sole cubiche, 4
      path('stroke', cat(M(0, 0), bump(0, 0), bump(10, 0))), // aperto di sole cubiche, 2
      path('stroke', cat(M(0, 20), bump(0, 20), bump(10, 20), bump(20, 20), bump(30, 20), bump(40, 20), bump(50, 20))), // aperto di 6
      path('stroke', cat(M(0, 0), Lt(10, 0), bump(10, 0), Lt(30, 0))), // misto aperto, 1 cubica
      path('fillStroke', cat(M(10, 0), Lt(90, 0), bump(90, 0), Lt(100, 80), bump(100, 80, -10), Z)), // misto chiuso, 2 cubiche
      path('fill', cat(M(0, 0), bump(0, 0), bump(10, 0))), // solo "tutti i percorsi": un riempimento
      path('stroke', cat(M(0, 0), bump(0, 0), Z)), // 1 cubica chiusa dal closePath (una retta di chiusura): chiuso di sole cubiche
    ];
    const s = stats(list);
    for (const [g, total] of [[s.shapesAll, s.all.cubic], [s.shapesCand, s.cand.cubic]] as const) {
      expect(g.closedCubicOnlyCubics + g.openCubicOnlyCubics + g.openMixed.cubics + g.closedMixed.cubics, 'conto delle cubiche').toBe(total);
      expect(g.openCubicOnlyCubics + g.openMixed.cubics, 'conto delle aperte').toBe(g.cubicsInOpen);
    }
    expect(s.cand.cubic).toBe(4 + 2 + 6 + 1 + 2 + 1);
    expect(s.all.cubic).toBe(s.cand.cubic + 2);
    expect(s.shapesCand.closedCubicOnlyCubics).toBe(5);
    expect(s.shapesCand.openCubicOnly).toEqual([0, 1, 0, 0, 1, 0]);
    expect(s.shapesCand.openCubicOnlyCubics).toBe(8);
    expect(s.shapesCand.openMixed.cubics).toBe(1);
    expect(s.shapesCand.closedMixed.cubics).toBe(2);
    // un riempimento conta fra "tutti" ma non fra i candidati
    expect(s.shapesAll.openCubicOnlyCubics).toBe(10);
  });

  it('sottopercorsi con una sola cubica (aperti e chiusi): aperto di sole cubiche per 1; nessuna cubica: nessun contatore', () => {
    const s = stats([path('stroke', cat(M(0, 0), bump(0, 0))), path('stroke', cat(M(0, 0), Lt(10, 0), Lt(10, 10)))]);
    expect(s.shapesCand.openCubicOnly).toEqual([1, 0, 0, 0, 0, 0]);
    expect(s.shapesCand.openMixed.subpaths).toBe(0);
    expect(s.shapesCand.closedMixed.subpaths).toBe(0);
  });
});

describe('contatori nuovi: lunghezza esattamente 0, tratti e corde delle cubiche', () => {
  it('tratti: lunghezza 0, 0.005 e 0.5: nel primo contenitore ci sono 2 e di questi 1 e\' esattamente 0', () => {
    const s = stats([path('stroke', cat(M(10, 10), Lt(10, 10))), path('stroke', cat(M(0, 0), Lt(0.005, 0))), path('stroke', cat(M(0, 5), Lt(0.5, 5)))]);
    expect(s.lineHist).toEqual([2, 0, 1, 0, 0]);
    expect(s.lineZero).toBe(1);
    expect(s.lineMin).toBe(0);
  });

  it('un riempimento con un tratto di lunghezza 0 non conta (i contatori riguardano i candidati)', () => {
    const s = stats([path('fill', cat(M(10, 10), Lt(10, 10), Lt(20, 20), Z))]);
    expect(s.lineZero).toBe(0);
    expect(s.cubicChordZero).toBe(0);
  });

  it('corde delle cubiche: estremi coincidenti (0), corda 0.005, corda 8: contenitori e minimo e massimo', () => {
    const cappio = cat(M(0, 0), C(10, 10, -10, 10, 0, 0)); // estremi coincidenti, punti di controllo lontani
    const tiny = cat(M(100, 100), C(100.001, 100.002, 100.004, 100.002, 100.005, 100));
    const big = cat(M(0, 50), C(2, 60, 6, 60, 8, 50));
    const s = stats([path('stroke', cappio), path('stroke', tiny), path('stroke', big), path('fill', cat(M(0, 0), C(1, 1, 2, 2, 30, 30)))]);
    expect(s.cubicChordHist).toEqual([2, 0, 0, 1, 0]); // 0 e 0.005 sotto 0.01; 8 fra 1 e 10 (contenitore 3); il riempimento non entra
    expect(s.cubicChordZero).toBe(1);
    expect(s.cubicChordMin).toBe(0);
    expect(s.cubicChordMax).toBeCloseTo(8, 12);
  });

  it('le quadratiche non entrano nelle corde delle cubiche', () => {
    const s = stats([path('stroke', cat(M(0, 0), Q(5, 5, 10, 0)))]);
    expect(s.cand.quad).toBe(1);
    expect(s.cubicChordHist).toEqual([0, 0, 0, 0, 0]);
    expect(s.cubicChordMin).toBeNull();
    expect(s.cubicChordMax).toBeNull();
  });

  it('nessuna cubica: minimo e massimo null, contenitori a zero', () => {
    const s = stats([path('stroke', cat(M(0, 0), Lt(10, 0)))]);
    expect(s.cubicChordHist).toEqual([0, 0, 0, 0, 0]);
    expect(s.cubicChordZero).toBe(0);
    expect(s.shapesCand.four.gapMin).toBeNull();
    expect(s.shapesCand.four.gapMax).toBeNull();
  });
});

// ------------------------------------------------------------------ da un PDF vero (PDF.js): numeri e testo di "Copia misura"
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  return task.promise;
}
async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}`, import.meta.url)));
}
async function measureOk(bytes: Uint8Array): Promise<PageMeasure> {
  const r = await measurePage(await open(bytes), 1);
  if (!r.ok) throw new Error(`misura fallita: ${r.reason}`);
  return r.measure;
}
/** Il PDF dei contatori: arco di 4 cubiche aperto con chiusura a 2e-3, raccordo fra due rette, cerchio chiuso, tratto di lunghezza 0 (con un `re` non si ottiene: scritto con m e l). */
const CONTENT = [
  // arco aperto di 4 cubiche, chiusura a 2e-3 (raggio 50, centro 200 200)
  '250 200 m 250 227.614 227.614 250 200 250 c 172.386 250 150 227.614 150 200 c 150 172.386 172.386 150 200 150 c 227.614 150 250 172.386 250.002 200 c S',
  // raccordo: retta, cubica, retta
  '10 10 m 100 10 l 110 10 120 20 120 30 c 120 100 l S',
  // cerchio chiuso (closePath)
  '400 200 m 400 227.614 377.614 250 350 250 c 322.386 250 300 227.614 300 200 c 300 172.386 322.386 150 350 150 c 377.614 150 400 172.386 400 200 c h S',
  // un tratto di lunghezza 0 e uno di 0.005
  '50 300 m 50 300 l S',
  '60 300 m 60.005 300 l S',
].join('\n');

describe('da un PDF vero: i contatori e le righe di "Copia misura"', () => {
  it('numeri attesi della composizione nota (4 cubiche aperte con chiusura a 2e-3, raccordo, cerchio chiuso, lunghezza 0)', async () => {
    const m = await measureOk(await makePdf({ content: CONTENT, mediabox: [600, 400] }));
    const g = m.stats.shapesCand;
    expect(m.stats.all.cubic).toBe(9);
    expect(g.cubicsInOpen).toBe(5); // 4 dell'arco + 1 del raccordo
    expect(g.openCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
    expect(g.openCubicOnlyCubics).toBe(4);
    expect(g.openMixed).toMatchObject({ subpaths: 1, cubics: 1, lineTo: 2 });
    expect(g.closedMixed.subpaths).toBe(0);
    expect(g.closedCubicOnly).toEqual([0, 0, 0, 1, 0, 0]);
    expect(g.closedCubicOnlyCubics).toBe(4);
    expect(g.four.subpaths).toBe(2);
    expect(g.four.open).toBe(1);
    expect(g.four.gapHist).toEqual([1, 0, 1, 0, 0, 0]); // il cerchio chiuso (~0) e l'arco aperto (2e-3)
    expect(g.four.circleNoClose).toBe(2);
    expect(m.stats.lineHist[0]).toBe(2);
    expect(m.stats.lineZero).toBe(1);
    expect(m.stats.cubicChordHist.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('a4-vettoriale.pdf: 6 cerchi chiusi di 4 cubiche, nessun aperto, nessun misto; il conto torna; 0 lunghezze esattamente 0', async () => {
    const m = await measureOk(await loadTestPdf('a4-vettoriale.pdf'));
    const g = m.stats.shapesCand;
    expect(g.closedCubicOnly).toEqual([0, 0, 0, 6, 0, 0]);
    expect(g.circles4).toBe(6);
    expect(g.four).toMatchObject({ subpaths: 6, open: 0, circleNoClose: 6 });
    expect(g.four.gapHist).toEqual([6, 0, 0, 0, 0, 0]); // pdf-lib chiude il cerchio esattamente: distanza ~1e-5
    expect(g.openCubicOnly).toEqual([0, 0, 0, 0, 0, 0]);
    expect(g.openMixed.subpaths + g.closedMixed.subpaths).toBe(0);
    expect(g.closedCubicOnlyCubics).toBe(24);
    expect(m.stats.lineZero).toBe(0);
    expect(m.stats.cubicChordZero).toBe(0);
  });

  it('le righe nuove: ci sono, con i numeri attesi, e quelle di CP7a restano uguali e nello stesso ordine', async () => {
    const m = await measureOk(await makePdf({ content: CONTENT, mediabox: [600, 400] }));
    const lines = measureLines(m, null);
    const has = (start: string): string => {
      const hit = lines.find((l) => l.startsWith(start));
      if (!hit) throw new Error(`riga mancante: ${start}`);
      return hit;
    };
    expect(has('segmenti rettilinei dei candidati sotto 0.01 pt utente, divisi:')).toBe('segmenti rettilinei dei candidati sotto 0.01 pt utente, divisi: lunghezza esattamente 0: 1 · fra 0 (escluso) e 0.01: 1');
    expect(has('corde delle cubiche dei candidati (distanza')).toContain('sotto 0.01: 0 ·');
    expect(has('corda minima e massima delle cubiche dei candidati (pt utente):')).toMatch(/: \d/);
    expect(has('sottopercorsi APERTI di sole cubiche, candidati,')).toBe('sottopercorsi APERTI di sole cubiche, candidati, per numero di cubiche: 1: 0 · 2: 0 · 3: 0 · 4: 1 · 5-8: 0 · oltre 8: 0 (cubiche che contengono: 4)');
    expect(has('sottopercorsi APERTI misti (cubiche e lineTo o quadratiche), candidati:')).toBe(
      'sottopercorsi APERTI misti (cubiche e lineTo o quadratiche), candidati: 1 (cubiche 1, lineTo 2, quadratiche 0); per numero di cubiche: 1: 1 · 2: 0 · 3: 0 · 4: 0 · 5-8: 0 · oltre 8: 0',
    );
    expect(has('sottopercorsi CHIUSI misti, candidati, per numero di lineTo:')).toBe('sottopercorsi CHIUSI misti, candidati, per numero di lineTo: 0: 0 · 1: 0 · 2: 0 · 3-4: 0 · 5-8: 0 · oltre 8: 0');
    expect(has('conto delle cubiche, candidati:')).toContain('= 9; cubiche dei percorsi 9 (il conto torna)');
    expect(has('conto delle cubiche in sottopercorsi aperti, candidati:')).toContain('= 5; riga "cubiche in sottopercorsi aperti" 5 (il conto torna)');
    expect(has('sottopercorsi di sole cubiche con 4 cubiche (aperti o chiusi), candidati:')).toBe(
      'sottopercorsi di sole cubiche con 4 cubiche (aperti o chiusi), candidati: 2 (aperti 1); distanza fra ultimo e primo punto (pt utente): fino a 0.0001: 1 · fino a 0.001: 0 · fino a 0.005: 1 · fino a 0.05: 0 · fino a 0.5: 0 · oltre 0.5: 0',
    );
    expect(has('di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, candidati:')).toMatch(/^di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, candidati: 2 su 2 \(scostamento massimo [\d.]+ pt, chiusura esclusa; tolleranza 0\.002 pt \+ 0\.0005 x raggio\)$/);
    // le righe di CP7a, nello stesso ordine (le nuove sono in piu')
    const old = [
      'classe della pagina:',
      'segmenti rettilinei dei candidati (lineTo e chiusure con segmento):',
      'lunghezza dei segmenti rettilinei (pt utente):',
      'lunghezza minima e massima dei segmenti rettilinei (pt utente):',
      'sottopercorsi chiusi di sole cubiche, tutti i percorsi, per numero di cubiche:',
      'di 4 cubiche che rispettano la regola del cerchio, tutti i percorsi:',
      'poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), tutti i percorsi:',
      'cubiche in sottopercorsi aperti, tutti i percorsi:',
      "sottopercorsi chiusi solo per coincidenza dell'ultimo punto (senza chiusura), tutti i percorsi:",
      'sottopercorsi chiusi di sole cubiche, candidati, per numero di cubiche:',
      'di 4 cubiche che rispettano la regola del cerchio, candidati:',
      'poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), candidati:',
      'cubiche in sottopercorsi aperti, candidati:',
      "sottopercorsi chiusi solo per coincidenza dell'ultimo punto (senza chiusura), candidati:",
      'livelli del documento:',
    ];
    const idx = old.map((o) => lines.findIndex((l) => l.startsWith(o)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('privacy e formato: nessun nome di file, nessuna riga vuota, una voce per riga con ":" o "·", numeri con il punto', async () => {
    const m = await measureOk(await makePdf({ content: CONTENT, mediabox: [600, 400], meta: { title: 'SEGRETO-TITOLO', author: 'SEGRETO-AUTORE' } }));
    const t = measureText('abc1234', [m], m, null);
    const lines = t.split('\n');
    expect(lines.every((l) => l.trim().length > 0 && /[:·]/.test(l))).toBe(true);
    expect(t).not.toMatch(/\d,\d/);
    expect(t).not.toMatch(/SEGRETO|\.pdf/i);
    // nessuna riga nuova contiene testo del documento: si compone solo di etichette fisse e numeri
    for (const l of lines.filter((x) => /APERTI|CHIUSI|conto delle cubiche|corde delle cubiche|esattamente 0|SENZA la condizione|ultimo e primo punto/.test(x))) expect(l).toMatch(/^[a-zA-Zàèéìòù0-9 ·:;,.()"+=x%-]+$/);
  });

  it('una pagina senza cubiche: le righe nuove ci sono con tutti i numeri a 0 e "nessuna cubica"/"nessuno"', async () => {
    const m = await measureOk(await makePdf({ content: '10 10 m 50 50 l S' }));
    const lines = measureLines(m, null);
    expect(lines).toContain('corda minima e massima delle cubiche dei candidati (pt utente): nessuna cubica');
    expect(lines).toContain('distanza minima e massima fra ultimo e primo punto dei sottopercorsi di sole cubiche con 4 cubiche, candidati (pt utente): nessuno');
    expect(lines.find((l) => l.startsWith('conto delle cubiche, candidati:'))).toContain('= 0; cubiche dei percorsi 0 (il conto torna)');
  });
});
