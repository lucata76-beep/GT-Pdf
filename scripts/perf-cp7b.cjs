// Misura dello snap sul PDF (V3.1, CP7b) in CHROMIUM DESKTOP (questo contenitore), NON sul PC o sul telefono dell'utente: i numeri non valgono per altri browser, macchine o per iPhone.
// PDF sintetici (generatore deterministico) con 10.000, 100.000 e 300.000 tratti rettilinei (spezzate a passeggiata casuale di passo 2-12 pt su un foglio A3 orizzontale, con le
// coordinate a tre decimali), per /Rotate 0 e 90. Per ciascuno, nel build di prova (GTPDF_TEST=1):
//  - lettura (`getOperatorList`), estrazione, punti e indice con la STESSA funzione dell'app (`window.__gtpdf.pdfSnapLoad`, che chiama `loadPdfSnap`), senza tetto: tempo di ogni fase
//    (le fasi sincrone sono quelle che bloccano il browser);
//  - byte: punti (16 per punto) e indice, esatti dai tipi dei dati; memoria `performance.memory` con `--enable-precise-memory-info` e `gc()` prima e dopo (approssimata);
//  - `findSnap` con la sorgente PDF (`snapRunPdf`, la stessa funzione dell'app): con l'indice e, solo come confronto, a scansione lineare. Mediana e massimo per chiamata sui LOTTI da 50
//    (risoluzione di performance.now(): 0.1 ms) e massimo della singola chiamata (500 chiamate, una per una); punti da cercare: meta' vicini a un candidato (aggancio) e meta'
//    sparsi a caso; raggio del mouse (10 px) e del tocco (22 px) allo zoom di adattamento. Nessun oggetto disegnato (si misura solo la sorgente PDF).
// Uso: node scripts/perf-cp7b.cjs [cartella]   (PERF_SIZES=10000,100000 per scegliere le dimensioni; PERF_EXTRA=600000 aggiunge una dimensione)
const { chromium } = require('playwright');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp7b', out: process.argv[2], port: 4240, hport: 4241, zoom: 2 });
const { setSection, info } = lib;
const SHEET = [1190.551, 841.89]; // A3 orizzontale
const SIZES = (process.env.PERF_SIZES || '10000,100000,300000').split(',').map(Number).concat(process.env.PERF_EXTRA ? [Number(process.env.PERF_EXTRA)] : []);

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** PDF con `n` tratti in spezzate di 50 tratti (passeggiata casuale nel foglio); restituisce anche i punti (utente) per scegliere i punti vicini. */
async function makePdf(n, rotate, rnd) {
  const [W, H] = SHEET;
  const parts = [];
  const verts = [];
  const clamp = (v, hi) => Math.min(hi - 5, Math.max(5, v));
  let made = 0;
  while (made < n) {
    let x = 5 + rnd() * (W - 10);
    let y = 5 + rnd() * (H - 10);
    let a = rnd() * Math.PI * 2;
    parts.push(`${x.toFixed(3)} ${y.toFixed(3)} m`);
    verts.push({ x: +x.toFixed(3), y: +y.toFixed(3) });
    for (let k = 0; k < 50 && made < n; k++, made++) {
      a += (rnd() - 0.5) * 2.1;
      const step = 2 + rnd() * 10;
      x = clamp(x + Math.cos(a) * step, W);
      y = clamp(y + Math.sin(a) * step, H);
      parts.push(`${x.toFixed(3)} ${y.toFixed(3)} l`);
      verts.push({ x: +x.toFixed(3), y: +y.toFixed(3) });
    }
    parts.push('S');
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(SHEET);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(parts.join('\n'))));
  if (rotate) page.node.set(PDFName.of('Rotate'), ctx.obj(rotate));
  return { bytes: await doc.save({ useObjectStreams: false }), verts };
}

(async () => {
  setSection('prestazioni dello snap sul PDF');
  const servers = await lib.startAll(chromium);
  // un Chromium nostro: con la misura precisa della memoria e gc() (quello di startAll serve solo per l'anteprima del build)
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'], env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
  const rows = [];
  try {
    for (const n of SIZES) {
      for (const rotate of [0, 90]) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(300000);
        page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
        await page.goto(lib.URL);
        const rnd = rng(1000 + n + rotate);
        const t0 = Date.now();
        const { bytes, verts } = await makePdf(n, rotate, rnd);
        info(`${n} tratti, /Rotate ${rotate}: PDF di ${(bytes.length / 1048576).toFixed(2)} MB costruito in ${Date.now() - t0} ms`);
        const tOpen = Date.now();
        await page.setInputFiles('input[type=file]', { name: `perf-${n}-${rotate}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
        // aspetta la lettura avviata dall'app all'apertura (con il tetto di serie: pronto o troppo fitta)
        await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0 && window.__gtpdf.pdfSnap().busy.length === 0 && window.__gtpdf.pdfSnap().cached.length > 0, null, { timeout: 300000 });
        const openToReadyMs = Date.now() - tOpen;
        await page.waitForSelector('.viewer-stage canvas');
        const atOpen = await page.evaluate(() => window.__gtpdf.pdfSnap().state);
        // lettura senza tetto, memoria prima e dopo
        const mem = await page.evaluate(async () => {
          const used = () => performance.memory.usedJSHeapSize;
          window.gc();
          const before = used();
          const r = await window.__gtpdf.pdfSnapLoad(1, { maxSegments: 1e12, maxCoords: 1e12, store: true, clear: true });
          window.gc();
          return { before, after: used(), r };
        });
        const st = mem.r.state;
        if (st.kind !== 'ready') throw new Error(`stato ${st.kind}`);
        const zoom = await page.evaluate(() => document.querySelector('.viewer-stage canvas').getBoundingClientRect().width / window.__gtpdf.sheet().w);
        // punti da cercare (utente): meta' vicini a un vertice, meta' sparsi nel riquadro visibile
        const [x0, y0, x1, y1] = await page.evaluate(() => window.__gtpdf.pages()[0].view);
        const CALLS = 2000;
        const raws = [];
        for (let i = 0; i < CALLS; i++) {
          if (i % 2 === 0) {
            const v = verts[Math.floor(rnd() * verts.length)];
            raws.push({ x: v.x + (rnd() - 0.5) * 6, y: v.y + (rnd() - 0.5) * 6 });
          } else raws.push({ x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) });
        }
        const run = async (mode, radiusPx) => {
          const heavy = mode === 'linear';
          const res = await page.evaluate(({ raws, radius, mode, batch, batches, singles }) => window.__gtpdf.snapRunPdf([], raws, radius, { mode, batch, batches, singles }), {
            raws,
            radius: radiusPx / zoom,
            mode,
            batch: heavy ? 5 : 50,
            batches: heavy ? 30 : 200,
            singles: heavy ? 60 : 500,
          });
          const per = res.batchMs.map((ms) => ms / res.batch);
          return { med: median(per), max: Math.max(...per), singleMax: Math.max(...res.singleMs), hits: res.hits, calls: res.calls };
        };
        const mouseIdx = await run('index', 10);
        const touchIdx = await run('index', 22);
        const mouseLin = await run('linear', 10);
        rows.push({ n, rotate, atOpen: atOpen && atOpen.kind, atOpenOp: atOpen && atOpen.timings ? atOpen.timings.opListMs : null, openToReadyMs, st, wall: mem.r.wallMs, heapMB: (mem.after - mem.before) / 1048576, mouseIdx, touchIdx, mouseLin, zoom });
        await ctx.close();
      }
    }
    console.log(`\nChromium del contenitore (non iPhone, non il browser dell'utente); zoom di adattamento ~${rows[0] ? rows[0].zoom.toFixed(3) : '?'} px/pt; foglio A3 orizzontale ${SHEET.join(' x ')} pt.`);
    console.log('\n| tratti | Rotate | stato all\'apertura (tetto di serie) | apertura del file fino alla fine della lettura | punti (estremi + medi) | getOperatorList (alla prima lettura) | estrazione | punti | indice | byte punti + indice | heap dopo - prima (cache svuotata, gc) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const t = r.st.timings;
      console.log(`| ${r.n} | ${r.rotate} | ${r.atOpen} | ${r.openToReadyMs} ms | ${r.st.nEnd} + ${r.st.nMid} | ${r.atOpenOp === null ? 'n/d (stato ' + r.atOpen + ')' : r.atOpenOp.toFixed(0) + ' ms'} | ${t.extractMs.toFixed(0)} ms | ${t.pointsMs.toFixed(0)} ms | ${t.indexMs.toFixed(0)} ms | ${(r.st.bytes / 1048576).toFixed(2)} MB | ${r.heapMB.toFixed(1)} MB |`);
    }
    console.log('\n| tratti | Rotate | raggio | sorgente | agganci / chiamate | mediana per chiamata (lotti) | massimo per chiamata (lotti) | singola chiamata: massimo (ris. 0,1 ms) |');
    console.log('|---|---|---|---|---|---|---|---|');
    const f = (s) => `${(s * 1000).toFixed(1)} us`;
    for (const r of rows) {
      for (const [label, x, src] of [['mouse 10 px', r.mouseIdx, 'indice'], ['tocco 22 px', r.touchIdx, 'indice'], ['mouse 10 px', r.mouseLin, 'scansione lineare']]) {
        console.log(`| ${r.n} | ${r.rotate} | ${label} | ${src} | ${x.hits} / ${x.calls} | ${f(x.med)} | ${f(x.max)} | ${x.singleMax.toFixed(2)} ms |`);
      }
    }
  } finally {
    await browser.close();
    await lib.stopAll(servers);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
