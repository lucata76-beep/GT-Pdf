// Non regressione di CP7e: le righe di «Copia misura» che c'erano gia' (tutte tranne quelle nuove, che cominciano con «archi», e le righe di tempi e memoria) devono essere IDENTICHE a quelle
// prodotte da d4903c4 (l'ultimo commit prima di CP7e) per i 7 PDF di public/test-pdfs (tutte le pagine) e per PDF sintetici di sole cubiche, poligoni, riempimenti, cm non uniforme,
// quadratiche, piu' sottopercorsi, cubica di corda 0 e livello spento. Le impronte (SHA-256, primi 16 caratteri del testo senza le righe di tempi e memoria) sono state calcolate su un
// albero pulito di d4903c4 con la stessa prova (`git worktree add <cartella> d4903c4`, la stessa costruzione dei PDF, `measurePage` e `measureLines` di quell'albero).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { arcChain, pdfChain, pdfPolygon, polygonOnCircle, rng } from './arcTestUtils';
import { measureLines, measurePage, readDocLayers } from './geometryMeasure';
import { makePdf } from './geometryTestUtils';

/** [pagina, righe, impronta] misurate su d4903c4. */
const GOLD: [string, number, string][] = [
  ['a3-vettoriale#1', 63, '3b9dba7da073cc83'],
  ['a4-annotazioni#1', 63, 'd50a686ce6310763'],
  ['a4-cropbox#1', 63, 'aa3ca6b673ab4f7a'],
  ['a4-rotate90#1', 63, '760a88276fa9ac2e'],
  ['a4-scansione#1', 63, '0bc315287d85f77e'],
  ['a4-vettoriale#1', 63, '041669a3773eb678'],
  ['misto-3-pagine#1', 63, 'edc8eb122363b9c3'],
  ['misto-3-pagine#2', 63, 'f0bb42e24031bea9'],
  ['misto-3-pagine#3', 63, 'b1030642efaca67b'],
  ['sint-cerchio-4-chiuso#1', 63, 'b063ad91e8bf55c3'],
  ['sint-cerchio-4-aperto-per-coincidenza#1', 63, '0c2248d3fd26e0ff'],
  ['sint-archi-aperti-1-2-3#1', 63, '0cb849bfae4867f4'],
  ['sint-poligono-24#1', 63, 'da587070df6e7d62'],
  ['sint-poligono-irregolare-15#1', 63, '679c3663c615e713'],
  ['sint-misto-rettangolo-arrotondato#1', 63, '1c9a83f7d7ddbe70'],
  ['sint-nove-cubiche#1', 63, 'b46f1b75b3c23b5d'],
  ['sint-riempimento-cerchio#1', 63, 'd8bd0e541a5a1248'],
  ['sint-riempimento-e-tratto#1', 63, '5984d152886ca532'],
  ['sint-cm-non-uniforme#1', 63, 'e9e9bf4be32a59bc'],
  ['sint-quadratiche-v-y#1', 63, 'c17002090cb8766b'],
  ['sint-piu-sottopercorsi#1', 63, '0467783966844516'],
  ['sint-corda-zero#1', 63, '25926afe7291a2fb'],
  ['sint-livello-spento#1', 63, 'ecab96a962c340d7'],
];

const rnd = rng(7);
const irregular = Array.from({ length: 15 }, (_, i) => ({ x: 300 + (40 + rnd() * 30) * Math.cos(i), y: 400 + (40 + rnd() * 30) * Math.sin(i) }));
const sq = (x: number, y: number, s: number): string => `${x} ${y} m ${x + s} ${y} l ${x + s} ${y + s} l ${x} ${y + s} l h`;
const synth: Record<string, string> = {
  'cerchio-4-chiuso': `${pdfChain(arcChain(300, 400, 50, 0, 360, 4), true)} S`,
  'cerchio-4-aperto-per-coincidenza': `${pdfChain(arcChain(300, 400, 50, 0, 360, 4), false)} S`,
  'archi-aperti-1-2-3': `${pdfChain(arcChain(100, 100, 20, 10, 60, 1))} S ${pdfChain(arcChain(200, 100, 20, 30, 150, 2))} S ${pdfChain(arcChain(300, 100, 20, 0, 210, 3))} S`,
  'poligono-24': `${pdfPolygon(polygonOnCircle(300, 400, 60, 24), true)} S`,
  'poligono-irregolare-15': `${pdfPolygon(irregular, true)} B`,
  'misto-rettangolo-arrotondato': '100 100 m 200 100 l 210 100 220 110 220 120 c 220 200 l 210 210 200 210 190 210 c h S',
  'nove-cubiche': `${pdfChain(arcChain(300, 400, 50, 0, 360, 9))} S`,
  'riempimento-cerchio': `${pdfChain(arcChain(300, 400, 50, 0, 360, 4), true)} f`,
  'riempimento-e-tratto': `${pdfChain(arcChain(300, 400, 50, 0, 360, 4), true)} B`,
  'cm-non-uniforme': `q 2 0 0 1 0 0 cm ${pdfChain(arcChain(150, 400, 50, 0, 360, 4), true)} S Q`,
  'quadratiche-v-y': '10 10 m 20 20 40 20 c 60 10 80 10 90 20 v 100 30 110 40 y S',
  'piu-sottopercorsi': `${pdfChain(arcChain(100, 500, 30, 0, 360, 4), true)} ${pdfChain(arcChain(200, 500, 30, 0, 90, 1))} ${sq(300, 500, 40)} S`,
  'corda-zero': '100 100 m 120 140 140 140 100 100 c S',
};
void sq;

const TIMING = /^(primo getOperatorList|secondo getOperatorList|estrazione:|heap JS)/;
async function sha256(text: string): Promise<string> {
  const name = 'node:crypto';
  const m = (await import(/* @vite-ignore */ name)) as { createHash(a: string): { update(t: string): { digest(f: string): string } } };
  return m.createHash('sha256').update(text).digest('hex').slice(0, 16);
}
async function loadTestPdf(name: string): Promise<Uint8Array> {
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(`../../public/test-pdfs/${name}.pdf`, import.meta.url)));
}
const tasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  while (tasks.length) await tasks.pop()?.destroy();
});
/** Le righe di ogni pagina del PDF, per chiave «nome#pagina». */
async function linesOf(name: string, bytes: Uint8Array): Promise<Record<string, string[]>> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  tasks.push(task);
  const doc = await task.promise;
  const layers = await readDocLayers(doc);
  const out: Record<string, string[]> = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const r = await measurePage(doc, n);
    if (!r.ok) throw new Error(`${name}: ${r.reason}`);
    out[`${name}#${n}`] = measureLines(r.measure, layers);
  }
  return out;
}

describe("le righe di «Copia misura» che c'erano già sono identiche a quelle di d4903c4", () => {
  it('i 7 PDF di prova e i PDF sintetici: 23 pagine, stesse righe (senza quelle nuove, che cominciano con «archi», e senza tempi e memoria)', async () => {
    const got: Record<string, string[]> = {};
    for (const f of ['a3-vettoriale', 'a4-annotazioni', 'a4-cropbox', 'a4-rotate90', 'a4-scansione', 'a4-vettoriale', 'misto-3-pagine']) Object.assign(got, await linesOf(f, await loadTestPdf(f)));
    for (const [k, content] of Object.entries(synth)) Object.assign(got, await linesOf(`sint-${k}`, await makePdf({ content })));
    Object.assign(got, await linesOf('sint-livello-spento', await makePdf({ content: `/OC /A BDC ${pdfChain(arcChain(300, 400, 50, 0, 360, 4), true)} S EMC`, ocgs: [{ key: 'A', name: 'A', on: false }] })));
    expect(Object.keys(got)).toEqual(GOLD.map(([k]) => k));
    for (const [k, n, h] of GOLD) {
      const old = (got[k] as string[]).filter((l) => !TIMING.test(l) && !l.startsWith('archi'));
      expect(old.length, k).toBe(n);
      expect(await sha256(old.join('\n')), k).toBe(h);
    }
  }, 60000);
  it('le righe nuove stanno tutte insieme, dopo quelle di CP7c e prima dei livelli del documento', async () => {
    const got = await linesOf('sint-cerchio-4-chiuso', await makePdf({ content: synth['cerchio-4-chiuso'] as string }));
    const ls = got['sint-cerchio-4-chiuso#1'] as string[];
    const idx = ls.map((l, i) => (l.startsWith('archi') ? i : -1)).filter((i) => i >= 0);
    expect(idx.length).toBeGreaterThan(20);
    expect(idx).toEqual(Array.from({ length: idx.length }, (_, i) => (idx[0] as number) + i));
    expect(ls[(idx[0] as number) - 1]).toMatch(/^di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, candidati:/);
    expect(ls[(idx[idx.length - 1] as number) + 1]).toMatch(/^livelli del documento:/);
  });
});
