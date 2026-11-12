// Aiuti per i test della scena dei tratti del PDF (segmentIndex.test.ts, snap.pdfScene.test.ts): una `PdfGeometry` costruita a mano da tratti nello spazio utente, e un generatore di numeri
// casuali con seme. Non e' importato dall'app: resta fuori dal build.
import type { PdfGeometry } from './geometry';

/** x1, y1, x2, y2 nello spazio utente. */
export type Seg = [number, number, number, number];

/**
 * Una `PdfGeometry` di soli tratti rettilinei. `path[i]` e' il percorso del tratto i (predefinito: tutti nel percorso 0); `visible[p]` dice se il percorso p e' visibile (predefinito: sì).
 * Le coordinate passano per Float32, come quelle di PDF.js.
 */
export function lineGeometry(segs: readonly Seg[], opts: { path?: readonly number[]; visible?: readonly boolean[] } = {}): PdfGeometry {
  const path = segs.map((_, i) => opts.path?.[i] ?? 0);
  const nPaths = Math.max(1, ...path.map((p) => p + 1), opts.visible?.length ?? 0);
  const vis = new Uint8Array(nPaths);
  for (let p = 0; p < nPaths; p++) vis[p] = opts.visible?.[p] === false ? 0 : 1;
  return {
    nPaths,
    pathPaint: new Uint8Array(nPaths).fill(1),
    pathVisible: vis,
    nLines: segs.length,
    lineXY: new Float32Array(segs.flat()),
    linePath: new Uint32Array(path),
    nCubics: 0,
    cubicXY: new Float32Array(0),
    cubicPath: new Uint32Array(0),
    bytes: 0,
  };
}

/** Generatore pseudo-casuale con seme (mulberry32): le prove con numeri casuali si ripetono uguali. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
