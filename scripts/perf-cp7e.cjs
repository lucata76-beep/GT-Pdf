// Misura del TEMPO DI ESTRAZIONE prima e dopo la misura degli archi (V3.2c, CP7e) in CHROMIUM DESKTOP (questo contenitore), NON sul PC (Edge) o sul telefono dell'utente: i numeri non valgono per altri browser,
// macchine o per iPhone. Due percorsi, entrambi con la funzione dell'app: (A) l'EDITOR: `window.__gtpdf.pdfSnapLoad` (build di prova, GTPDF_TEST=1), che chiama `loadPdfSnap` e quindi `extractGeometry` SENZA la
// misura degli archi (non deve cambiare fra d4903c4 e CP7e); (B) DIAGNOSTICA: il pulsante «Misura questa pagina», che chiama `measurePage` e `extractGeometry` CON la misura degli archi; si legge la riga
// «estrazione: N ms» della scheda (c'e' gia' in d4903c4, dove e' l'estrazione di prima).
// PDF sintetici: (1) quelli di scripts/perf-cp7c.cjs (stesso generatore e stessi semi: `mix`, `curve`, `rette`: spezzate di 50 elementi, quindi sottopercorsi di 50 cubiche, oltre il tetto di 8 della misura degli archi) e
// (2) i casi PEGGIORI per la misura degli archi: `archi1` (ogni cubica e' un sottopercorso aperto: la misura costa a ogni cubica), `archi4` (cerchi chiusi di 4 cubiche), `archi8` (sottopercorsi di 8 cubiche, il massimo
// misurato), `poligoni24` (poligoni chiusi di 24 vertici) e `poligoni250` (poligoni di 250 vertici, il massimo misurato). `n` e' il numero di ELEMENTI (cubiche o tratti).
// Per ottenere il "prima" si prova il build di prova di d4903c4 con E2E_DIST=<cartella del build di prova di d4903c4>: lo stesso script, gli stessi PDF (generatore deterministico).
// Uso: node scripts/perf-cp7e.cjs [cartella]   (PERF_SIZES=100000,300000; PERF_KINDS=mix,curve,rette,archi1,archi4,archi8,poligoni24,poligoni250; PERF_REPEAT=7)
const { chromium } = require('playwright');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp7e', out: process.argv[2], port: 4252, hport: 4253, zoom: 2 });
const { setSection, info } = lib;
const SHEET = [1190.551, 841.89]; // A3 orizzontale
const SIZES = (process.env.PERF_SIZES || '100000,300000').split(',').map(Number);
const KINDS = (process.env.PERF_KINDS || 'mix,curve,rette,archi1,archi4,archi8,poligoni24,poligoni250').split(',');
const REPEAT = Number(process.env.PERF_REPEAT || 7);

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/**
 * PDF con `n` ELEMENTI (rette e/o cubiche, secondo `mix`) in spezzate di 50 elementi (passeggiata casuale nel foglio); restituisce anche gli estremi (utente) per scegliere i punti vicini.
 * La cubica ha i punti di controllo spostati di lato di fino a 40% del passo: un arco dolce.
 */
async function makePdf(n, rotate, rnd, mix) {
  const [W, H] = SHEET;
  const parts = [];
  const verts = [];
  const clamp = (v, hi) => Math.min(hi - 5, Math.max(5, v));
  const f = (v) => v.toFixed(3);
  let made = 0;
  let lines = 0;
  let cubics = 0;
  while (made < n) {
    let x = 5 + rnd() * (W - 10);
    let y = 5 + rnd() * (H - 10);
    let a = rnd() * Math.PI * 2;
    parts.push(`${f(x)} ${f(y)} m`);
    verts.push({ x: +f(x), y: +f(y) });
    for (let k = 0; k < 50 && made < n; k++, made++) {
      a += (rnd() - 0.5) * 2.1;
      const step = 2 + rnd() * 10;
      const nx = clamp(x + Math.cos(a) * step, W);
      const ny = clamp(y + Math.sin(a) * step, H);
      const curve = mix === 'curve' || (mix === 'mix' && rnd() < 0.5);
      if (curve) {
        const px = -Math.sin(a);
        const py = Math.cos(a);
        const o1 = (rnd() - 0.5) * 0.8 * step;
        const o2 = (rnd() - 0.5) * 0.8 * step;
        const c1x = x + (nx - x) / 3 + px * o1;
        const c1y = y + (ny - y) / 3 + py * o1;
        const c2x = x + (2 * (nx - x)) / 3 + px * o2;
        const c2y = y + (2 * (ny - y)) / 3 + py * o2;
        parts.push(`${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(nx)} ${f(ny)} c`);
        cubics++;
      } else {
        parts.push(`${f(nx)} ${f(ny)} l`);
        lines++;
      }
      x = nx;
      y = ny;
      verts.push({ x: +f(x), y: +f(y) });
    }
    parts.push('S');
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(SHEET);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(parts.join('\n'))));
  if (rotate) page.node.set(PDFName.of('Rotate'), ctx.obj(rotate));
  return { bytes: await doc.save({ useObjectStreams: false }), verts, lines, cubics };
}


/** Casi peggiori per la misura degli archi (sottopercorsi corti di sole cubiche; poligoni). Restituisce { bytes, subpaths, elements }. */
async function makeArcPdf(kind, n, rnd) {
  const [W, H] = SHEET;
  const f = (v) => v.toFixed(3);
  const parts = [];
  let subpaths = 0;
  let elements = 0;
  const arcCubic = (cx, cy, r, a0, th) => {
    const k = (4 / 3) * Math.tan(th / 4);
    const a1 = a0 + th;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return [x0, y0, x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0), x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1), x1, y1];
  };
  const cubicsPerSub = kind === 'archi1' ? 1 : kind === 'archi4' ? 4 : kind === 'archi8' ? 8 : 0;
  const verts = kind === 'poligoni24' ? 24 : kind === 'poligoni250' ? 250 : 0;
  while (elements < n) {
    const cx = 40 + rnd() * (W - 80);
    const cy = 40 + rnd() * (H - 80);
    const r = 2 + rnd() * 30;
    const a0 = rnd() * Math.PI * 2;
    if (cubicsPerSub) {
      // gli archi di 1 e 8 cubiche coprono 60 e 320 gradi, i cerchi (4 cubiche) 360 gradi e si chiudono
      const total = kind === 'archi4' ? Math.PI * 2 : kind === 'archi1' ? Math.PI / 3 : (Math.PI * 2 * 320) / 360;
      const th = total / cubicsPerSub;
      for (let j = 0; j < cubicsPerSub; j++) {
        const c = arcCubic(cx, cy, r, a0 + j * th, th);
        if (j === 0) parts.push(`${f(c[0])} ${f(c[1])} m`);
        parts.push(`${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} ${f(c[7])} c`);
      }
      if (kind === 'archi4') parts.push('h');
      elements += cubicsPerSub;
    } else {
      for (let i = 0; i < verts; i++) {
        const a = a0 + (Math.PI * 2 * i) / verts;
        parts.push(`${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))} ${i === 0 ? 'm' : 'l'}`);
      }
      parts.push('h');
      elements += verts;
    }
    subpaths++;
    if (subpaths % 100 === 0) parts.push('S');
  }
  parts.push('S');
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(SHEET);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(parts.join('\n'))));
  return { bytes: await doc.save({ useObjectStreams: false }), subpaths, elements };
}

(async () => {
  setSection('tempo di estrazione, prima e dopo la misura degli archi');
  const servers = await lib.startAll(chromium);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'], env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
  const rows = [];
  try {
    for (const n of SIZES) {
      for (const kind of KINDS) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(600000);
        page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
        await page.goto(lib.URL);
        const t0 = Date.now();
        let made;
        if (['mix', 'curve', 'rette'].includes(kind)) {
          const rnd = rng(1000 + n + 0 + kind.length);
          const m = await makePdf(n, 0, rnd, kind);
          made = { bytes: m.bytes, subpaths: Math.ceil(n / 50), elements: n, desc: `${m.lines} rette + ${m.cubics} cubiche` };
        } else {
          const m = await makeArcPdf(kind, n, rng(5000 + n + kind.length));
          made = { ...m, desc: `${m.subpaths} sottopercorsi` };
        }
        info(`${n} elementi (${kind}: ${made.desc}): PDF di ${(made.bytes.length / 1048576).toFixed(2)} MB costruito in ${Date.now() - t0} ms`);
        await page.setInputFiles('input[type=file]', { name: `perf-${n}-${kind}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(made.bytes) });
        await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0 && window.__gtpdf.pdfSnap().busy.length === 0 && window.__gtpdf.pdfSnap().cached.length > 0, null, { timeout: 600000 });
        const ex = [];
        const op = [];
        for (let i = 0; i < REPEAT + 1; i++) {
          const r = await page.evaluate(() => window.__gtpdf.pdfSnapLoad(1, { maxSegments: 1e12, maxCoords: 1e12, store: false, clear: false }));
          if (r.state.kind !== 'ready') throw new Error(`stato ${r.state.kind}`);
          if (i > 0) {
            ex.push(r.state.timings.extractMs); // la prima lettura e' di riscaldamento (compilazione JIT) e si scarta
            op.push(r.state.timings.opListMs);
          }
        }
        // (B) Diagnostica: «Misura questa pagina» ripetuta, riga «estrazione: N ms»
        const dpage = await ctx.newPage();
        dpage.setDefaultTimeout(600000);
        dpage.on('pageerror', (e) => console.log('ERRORE PAGINA (Diagnostica):', e.message));
        await dpage.goto(`${lib.URL}#diag`);
        await dpage.waitForSelector('.screen-diag input[type=file]', { state: 'attached' });
        await dpage.setInputFiles('.screen-diag input[type=file]', { name: `perf-${n}-${kind}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(made.bytes) });
        await dpage.waitForFunction(() => /\[OK\] Aperto: /.test(document.querySelector('textarea[aria-label="Registro eventi"]').value), null, { timeout: 600000 });
        const dx = [];
        let prev = '';
        for (let i = 0; i < REPEAT + 1; i++) {
          await dpage.locator('.geo-card').getByRole('button', { name: 'Misura questa pagina', exact: true }).click();
          await dpage.waitForFunction((p) => { const d = document.querySelector('.geo-detail'); return d && !d.hidden && d.innerText && d.innerText !== p && /^Misurat[ae] \d+/.test(document.querySelector('.geo-status').innerText); }, prev, { timeout: 600000 });
          const text = await dpage.locator('.geo-detail').innerText();
          prev = text;
          const m = /^estrazione: ([0-9.]+) ms$/m.exec(text);
          if (!m) throw new Error('riga «estrazione» non trovata');
          if (i > 0) dx.push(Number(m[1]));
        }
        rows.push({ n, kind, desc: made.desc, subpaths: made.subpaths, ex, op, dx });
        await ctx.close();
      }
    }
    console.log(`\nChromium del contenitore (non iPhone, non Edge dell'utente); build di prova: ${process.env.E2E_DIST || '(costruito da questo script)'}; foglio A3 orizzontale ${SHEET.join(' x ')} pt; ${REPEAT} letture per PDF (la prima scartata).`);
    console.log('\n| elementi | PDF | composizione | (A) editor: estrazione mediana | minimo | massimo | (B) Diagnostica: estrazione mediana | minimo | massimo | getOperatorList (mediana, editor) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log(`| ${r.n} | ${r.kind} | ${r.desc} | ${median(r.ex).toFixed(1)} ms | ${Math.min(...r.ex).toFixed(1)} ms | ${Math.max(...r.ex).toFixed(1)} ms | ${median(r.dx).toFixed(1)} ms | ${Math.min(...r.dx).toFixed(1)} ms | ${Math.max(...r.dx).toFixed(1)} ms | ${median(r.op).toFixed(1)} ms |`);
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
