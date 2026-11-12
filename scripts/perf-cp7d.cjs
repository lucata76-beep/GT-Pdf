// Misura della SCENA DEI TRATTI del PDF (V3.2b, CP7d: Intersezione e Perpendicolare sui tratti rettilinei) in CHROMIUM DESKTOP (questo contenitore), NON sul PC o sul telefono dell'utente: i
// numeri non valgono per altri browser, macchine o per iPhone. La soglia di 4 ms per un `findSnap` e' una scelta dell'assistente, senza fonte.
// PDF sintetici (generatore deterministico, foglio A3 orizzontale, coordinate a tre decimali), per ciascuna dimensione e /Rotate 0 e 90:
//  - `casuali`: spezzate a passeggiata casuale di 50 tratti (come scripts/perf-cp7b.cjs);
//  - `lunghe`: tratti LUNGHI orizzontali e verticali (30%-100% del lato del foglio): ognuno attraversa molte celle dell'indice (il caso peggiore per le voci di cella e la memoria);
//  - `tratteggio:K`: 6.000 tratti casuali PIU' un tratteggio denso al centro del foglio: K tratti a +45 gradi e K a -45 gradi, tutti lunghi 16 pt, che si incrociano a due a due nello stesso
//    punto della pagina (con 2K = 200 sono PDF_MAX_NEAR - 56 vicini al cursore: il confronto a coppie e' al massimo consentito; con 2K = 5000 sono sopra il tetto di vicini e il PDF non offre candidati
//    calcolati li');
//  - `fitto:K`: 6.000 tratti casuali PIU' K tratti CORTI (1-5 pt, direzione casuale) in un quadrato di 16 x 16 pt al centro (come il contorno di lettere o le curve di livello a spezzate: molti
//    vicini ma pochi incroci); con K = 200 sono sotto PDF_MAX_NEAR, con K = 2500 sopra.
// Per ciascuno, nel build di prova (GTPDF_TEST=1):
//  - lettura, estrazione, punti, indice e SCENA con la STESSA funzione dell'app (`window.__gtpdf.pdfSnapLoad`, che chiama `loadPdfSnap`), senza tetto di primitive: tempo di ogni fase;
//  - byte esatti della scena (dai tipi dei dati) e memoria `performance.memory` con `--enable-precise-memory-info` e `gc()`: heap con la scena meno heap senza (lettura con `maxSceneRefs: 0`,
//    che spegne la scena); misura approssimata e rumorosa;
//  - `findSnap` complessivo (`snapRunPdf`) con TUTTI i sette tipi accesi come nell'app, con un'ancora (Perpendicolare): con l'indice, solo punti del PDF (Estremo e Punto medio: il
//    riferimento di CP7c), e a scansione lineare di punti e tratti (solo come confronto). Mediana e massimo per chiamata sui LOTTI da 50 e massimo della singola chiamata (500, risoluzione
//    0,1 ms); raggio del mouse (10 px) e del tocco (22 px) allo zoom di adattamento. Nessun oggetto disegnato.
// Uso: node scripts/perf-cp7d.cjs [cartella]   (PERF_SIZES=6000,100000,300000; PERF_MIXES=casuali,lunghe,tratteggio:100,tratteggio:2500,fitto:200,fitto:2500; PERF_ROTATES=0,90)
const { chromium } = require('playwright');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp7d', out: process.argv[2], port: 4248, hport: 4249, zoom: 2 });
const { setSection, info } = lib;
const SHEET = [1190.551, 841.89]; // A3 orizzontale
const SIZES = (process.env.PERF_SIZES || '6000,100000,300000').split(',').map(Number);
const MIXES = (process.env.PERF_MIXES || 'casuali,lunghe,tratteggio:100,tratteggio:2500,fitto:200,fitto:2500').split(',');
const ROTATES = (process.env.PERF_ROTATES || '0,90').split(',').map(Number);
const ALL_KINDS = { end: true, mid: true, center: true, intersection: true, quadrant: true, perpendicular: true, tangent: true };
const POINT_KINDS = { end: true, mid: true };

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const f3 = (v) => v.toFixed(3);

/** PDF con `n` tratti; restituisce anche i vertici (utente) per scegliere i punti vicini e il centro del tratteggio. */
async function makePdf(n, rotate, rnd, mix) {
  const [W, H] = SHEET;
  const parts = [];
  const verts = [];
  let hatch = null;
  const clamp = (v, hi) => Math.min(hi - 5, Math.max(5, v));
  let made = 0;
  let nHatch = 0;
  if (mix.startsWith('tratteggio:')) {
    const k = Number(mix.split(':')[1]);
    nHatch = 2 * k;
    const cx = W / 2;
    const cy = H / 2;
    hatch = { x: cx, y: cy };
    for (const ang of [Math.PI / 4, -Math.PI / 4]) {
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      const vx = -uy;
      const vy = ux;
      for (let i = 0; i < k; i++) {
        const off = -6 + (12 * (i + 0.5)) / k;
        const mx = cx + vx * off;
        const my = cy + vy * off;
        parts.push(`${f3(mx - ux * 8)} ${f3(my - uy * 8)} m ${f3(mx + ux * 8)} ${f3(my + uy * 8)} l`);
        if (i % 50 === 49) parts.push('S');
      }
      parts.push('S');
    }
  }
  if (mix.startsWith('fitto:')) {
    const k = Number(mix.split(':')[1]);
    nHatch = k;
    hatch = { x: W / 2, y: H / 2 };
    for (let i = 0; i < k; i++) {
      const x = W / 2 - 8 + rnd() * 16;
      const y = H / 2 - 8 + rnd() * 16;
      const a = rnd() * Math.PI * 2;
      const len = 1 + rnd() * 4;
      parts.push(`${f3(x)} ${f3(y)} m ${f3(x + Math.cos(a) * len)} ${f3(y + Math.sin(a) * len)} l`);
      if (i % 50 === 49) parts.push('S');
    }
    parts.push('S');
  }
  const nMain = mix.startsWith('tratteggio:') || mix.startsWith('fitto:') ? 6000 : n;
  if (mix === 'lunghe') {
    for (let i = 0; made < nMain; i++, made++) {
      const horizontal = rnd() < 0.5;
      const len = (0.3 + rnd() * 0.7) * (horizontal ? W : H);
      if (horizontal) {
        const y = 5 + rnd() * (H - 10);
        const x = 5 + rnd() * Math.max(1, W - 10 - len);
        parts.push(`${f3(x)} ${f3(y)} m ${f3(x + len)} ${f3(y)} l`);
        verts.push({ x: +f3(x), y: +f3(y) });
      } else {
        const x = 5 + rnd() * (W - 10);
        const y = 5 + rnd() * Math.max(1, H - 10 - len);
        parts.push(`${f3(x)} ${f3(y)} m ${f3(x)} ${f3(y + len)} l`);
        verts.push({ x: +f3(x), y: +f3(y) });
      }
      if (i % 50 === 49) parts.push('S');
    }
    parts.push('S');
  } else {
    while (made < nMain) {
      let x = 5 + rnd() * (W - 10);
      let y = 5 + rnd() * (H - 10);
      let a = rnd() * Math.PI * 2;
      parts.push(`${f3(x)} ${f3(y)} m`);
      verts.push({ x: +f3(x), y: +f3(y) });
      for (let k = 0; k < 50 && made < nMain; k++, made++) {
        a += (rnd() - 0.5) * 2.1;
        const step = 2 + rnd() * 10;
        x = clamp(x + Math.cos(a) * step, W);
        y = clamp(y + Math.sin(a) * step, H);
        parts.push(`${f3(x)} ${f3(y)} l`);
        verts.push({ x: +f3(x), y: +f3(y) });
      }
      parts.push('S');
    }
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(SHEET);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(parts.join('\n'))));
  if (rotate) page.node.set(PDFName.of('Rotate'), ctx.obj(rotate));
  return { bytes: await doc.save({ useObjectStreams: false }), verts, total: made + nHatch, hatch };
}

(async () => {
  setSection('prestazioni della scena dei tratti del PDF');
  const servers = await lib.startAll(chromium);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'], env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
  const rows = [];
  try {
    const cases = [];
    for (const mix of MIXES) for (const n of mix.startsWith('tratteggio:') || mix.startsWith('fitto:') ? [6000] : SIZES) cases.push([mix, n]);
    for (const [mix, n] of cases) {
      for (const rotate of ROTATES) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(600000);
        page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
        await page.goto(lib.URL);
        const rnd = rng(7000 + n + rotate + mix.length);
        const t0 = Date.now();
        const { bytes, verts, total, hatch } = await makePdf(n, rotate, rnd, mix);
        info(`${mix} ${n} tratti (in tutto ${total}), /Rotate ${rotate}: PDF di ${(bytes.length / 1048576).toFixed(2)} MB costruito in ${Date.now() - t0} ms`);
        await page.setInputFiles('input[type=file]', { name: `perf-${mix}-${n}-${rotate}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
        await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0 && window.__gtpdf.pdfSnap().busy.length === 0 && window.__gtpdf.pdfSnap().cached.length > 0, null, { timeout: 600000 });
        await page.waitForSelector('.viewer-stage canvas');
        const mem = await page.evaluate(async () => {
          const used = () => performance.memory.usedJSHeapSize;
          const lim = { maxSegments: 1e12, maxCoords: 1e12, store: true, clear: true };
          window.gc();
          const b0 = used();
          const noScene = await window.__gtpdf.pdfSnapLoad(1, { ...lim, maxSceneRefs: 0 });
          window.gc();
          const a0 = used();
          window.gc();
          const b1 = used();
          const r = await window.__gtpdf.pdfSnapLoad(1, lim);
          window.gc();
          const a1 = used();
          return { heapNoScene: a0 - b0, heapWith: a1 - b1, noScene: noScene.state.kind, r };
        });
        const st = mem.r.state;
        if (st.kind !== 'ready') throw new Error(`stato ${st.kind}`);
        const zoom = await page.evaluate(() => document.querySelector('.viewer-stage canvas').getBoundingClientRect().width / window.__gtpdf.sheet().w);
        const [x0, y0, x1, y1] = await page.evaluate(() => window.__gtpdf.pages()[0].view);
        const anchor = { x: x0 + (x1 - x0) * 0.4, y: y0 + (y1 - y0) * 0.55 };
        const CALLS = 2000;
        const raws = [];
        for (let i = 0; i < CALLS; i++) {
          if (hatch) raws.push({ x: hatch.x + (rnd() - 0.5) * 8, y: hatch.y + (rnd() - 0.5) * 8 }); // dentro il tratteggio
          else if (i % 2 === 0) {
            const v = verts[Math.floor(rnd() * verts.length)];
            raws.push({ x: v.x + (rnd() - 0.5) * 6, y: v.y + (rnd() - 0.5) * 6 });
          } else raws.push({ x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) });
        }
        const run = async (mode, kinds, radiusPx) => {
          const heavy = mode === 'linear';
          const res = await page.evaluate(({ raws, radius, mode, batch, batches, singles, kinds, anchor }) => window.__gtpdf.snapRunPdf([], raws, radius, { mode, batch, batches, singles, kinds, anchor }), {
            raws,
            radius: radiusPx / zoom,
            mode,
            batch: heavy ? 5 : 50,
            batches: heavy ? 30 : 200,
            singles: heavy ? 60 : 500,
            kinds,
            anchor,
          });
          const per = res.batchMs.map((ms) => ms / res.batch);
          return { med: median(per), max: Math.max(...per), singleMax: Math.max(...res.singleMs), hits: res.hits, calls: res.calls };
        };
        const mouse = await run('index', ALL_KINDS, 10);
        const touch = await run('index', ALL_KINDS, 22);
        const points = await run('index', POINT_KINDS, 10);
        const lin = await run('linear', ALL_KINDS, 10);
        rows.push({ mix, n, total, rotate, st, wall: mem.r.wallMs, heapNoScene: mem.heapNoScene / 1048576, heapWith: mem.heapWith / 1048576, mouse, touch, points, lin, zoom });
        await ctx.close();
      }
    }
    console.log(`\nChromium del contenitore (non iPhone, non il browser dell'utente); zoom di adattamento ~${rows[0] ? rows[0].zoom.toFixed(3) : '?'} px/pt; foglio A3 orizzontale ${SHEET.join(' x ')} pt.`);
    console.log('\n| composizione | tratti letti (visibili) | Rotate | apertura fino alla fine della lettura | getOperatorList | estrazione | punti | indice punti | SCENA: ms | tratti in scena (ritagliati / fuori) | celle (lato) | voci | byte scena | byte punti + indice | heap con scena - senza | stato scena |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const t = r.st.timings;
      const sc = r.st.sceneStats;
      console.log(`| ${r.mix} | ${r.total} (${r.st.segments}) | ${r.rotate} | ${r.wall.toFixed(0)} ms | ${t.opListMs.toFixed(0)} ms | ${t.extractMs.toFixed(0)} ms | ${t.pointsMs.toFixed(0)} ms | ${t.indexMs.toFixed(0)} ms | ${(t.sceneMs || 0).toFixed(0)} ms | ${sc.kept} (${sc.clipped} / ${sc.outside}) | ${sc.cells} (${sc.cellPt} pt) | ${sc.refs} | ${(sc.bytes / 1048576).toFixed(2)} MB | ${(r.st.bytes / 1048576).toFixed(2)} MB | ${(r.heapWith - r.heapNoScene).toFixed(1)} MB | ${sc.dense ? 'FITTA' : 'ok'} |`);
    }
    console.log('\n| composizione | Rotate | raggio | sorgente | agganci / chiamate | mediana per chiamata (lotti) | massimo per chiamata (lotti) | singola chiamata: massimo (ris. 0,1 ms) |');
    console.log('|---|---|---|---|---|---|---|---|');
    const f = (s) => `${(s * 1000).toFixed(1)} us`;
    for (const r of rows) {
      for (const [label, x, src] of [['mouse 10 px, sette tipi', r.mouse, 'indice (punti e tratti)'], ['tocco 22 px, sette tipi', r.touch, 'indice (punti e tratti)'], ['mouse 10 px, solo Estremo e Punto medio', r.points, 'indice (solo punti: come CP7c)'], ['mouse 10 px, sette tipi', r.lin, 'scansione lineare (solo confronto)']]) {
        console.log(`| ${r.mix} ${r.n} | ${r.rotate} | ${label} | ${src} | ${x.hits} / ${x.calls} | ${f(x.med)} | ${f(x.max)} | ${x.singleMax.toFixed(2)} ms |`);
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
