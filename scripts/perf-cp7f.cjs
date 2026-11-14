// Misura del COSTO del riconoscimento di archi e cerchi del PDF (V3.3a, CP7f: Centro e Quadrante) in CHROMIUM DESKTOP (questo contenitore), NON sul PC (Edge) o sul telefono (iPhone/Safari) dell'utente:
// i numeri non valgono per altri browser, macchine o per iPhone. Funzione dell'app, non una copia: `window.__gtpdf.pdfSnapLoad` (build di prova, GTPDF_TEST=1) chiama `loadPdfSnap` (lo stesso percorso
// dell'editor: estrazione, punti dei tratti, punti degli anelli, indici) con `recognizeArcs` spento (come prima di CP7f) e acceso (come l'editor); `window.__gtpdf.snapRunPdf` chiama `findSnap` con l'indice
// dei punti e, se si vuole, quello degli anelli.
// PDF sintetici (foglio A3 orizzontale, 300.000 ELEMENTI per caso, generatore deterministico come in scripts/perf-cp7e.cjs): `archi1` (300.000 sottopercorsi di UNA cubica, archi di 60 gradi: il caso peggiore
// per il riconoscimento, ogni cubica e' un anello), `archi4` (75.000 cerchi chiusi di 4 cubiche), `archi8` (37.500 catene aperte di 8 cubiche, 320 gradi: il massimo riconosciuto) e `rette` (nessuna cubica:
// 300.000 tratti rettilinei in spezzate di 50; il riconoscimento non deve costare nulla). Raggio da 2 a 32 pt, posizione a caso nel foglio.
// Si misura, per ogni caso: (1) il tempo di `loadPdfSnap` (parete, e le sue fasi: getOperatorList, estrazione, punti, indice, anelli), senza e con il riconoscimento, alternati; (2) quanti anelli, centri e
// quadranti ne escono e la memoria che occupano (la contabilita' dell'app: `ringBytes`; non e' la memoria misurata del browser); (3) `findSnap` con e senza anelli (punti a caso nel foglio e punti entro 3 pt da un centro).
// Uso: node scripts/perf-cp7f.cjs [cartella]   (PERF_N=300000; PERF_KINDS=archi1,archi4,archi8,rette; PERF_REPEAT=5; E2E_DIST=<build di prova gia' fatto>)
const { chromium } = require('playwright');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp7f', out: process.argv[2], port: 4256, hport: 4257, zoom: 2 });
const { setSection, info } = lib;
const SHEET = [1190.551, 841.89]; // A3 orizzontale
const N = Number(process.env.PERF_N || 300000);
const KINDS = (process.env.PERF_KINDS || 'archi1,archi4,archi8,rette').split(',');
const REPEAT = Number(process.env.PERF_REPEAT || 5);

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const f3 = (v) => v.toFixed(3);

function arcCubic(cx, cy, r, a0, th) {
  const k = (4 / 3) * Math.tan(th / 4);
  const a1 = a0 + th;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  return [x0, y0, x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0), x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1), x1, y1];
}

/** Il PDF del caso: `rings` = i centri (utente) dei primi anelli, per scegliere punti vicini. */
async function makePdf(kind, n, rnd) {
  const [W, H] = SHEET;
  const parts = [];
  const centers = [];
  let subpaths = 0;
  let elements = 0;
  if (kind === 'rette') {
    const clamp = (v, hi) => Math.min(hi - 5, Math.max(5, v));
    while (elements < n) {
      let x = 5 + rnd() * (W - 10);
      let y = 5 + rnd() * (H - 10);
      let a = rnd() * Math.PI * 2;
      parts.push(`${f3(x)} ${f3(y)} m`);
      for (let k = 0; k < 50 && elements < n; k++, elements++) {
        a += (rnd() - 0.5) * 2.1;
        const step = 2 + rnd() * 10;
        x = clamp(x + Math.cos(a) * step, W);
        y = clamp(y + Math.sin(a) * step, H);
        parts.push(`${f3(x)} ${f3(y)} l`);
      }
      parts.push('S');
      subpaths++;
    }
  } else {
    const per = kind === 'archi1' ? 1 : kind === 'archi4' ? 4 : 8;
    // 1 cubica: 60 gradi; 4 cubiche: cerchio chiuso (360); 8 cubiche: 320 gradi (aperta)
    const total = kind === 'archi4' ? Math.PI * 2 : kind === 'archi1' ? Math.PI / 3 : (Math.PI * 2 * 320) / 360;
    const th = total / per;
    while (elements < n) {
      const cx = 40 + rnd() * (W - 80);
      const cy = 40 + rnd() * (H - 80);
      const r = 2 + rnd() * 30;
      const a0 = rnd() * Math.PI * 2;
      for (let j = 0; j < per; j++) {
        const c = arcCubic(cx, cy, r, a0 + j * th, th);
        if (j === 0) parts.push(`${f3(c[0])} ${f3(c[1])} m`);
        parts.push(`${f3(c[2])} ${f3(c[3])} ${f3(c[4])} ${f3(c[5])} ${f3(c[6])} ${f3(c[7])} c`);
      }
      if (kind === 'archi4') parts.push('h');
      if (centers.length < 3000) centers.push({ x: cx, y: cy });
      elements += per;
      subpaths++;
      if (subpaths % 100 === 0) parts.push('S');
    }
    parts.push('S');
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(SHEET);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(parts.join('\n'))));
  return { bytes: await doc.save({ useObjectStreams: false }), subpaths, elements, centers };
}

const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? 'n/d' : v.toFixed(d));

(async () => {
  setSection('costo del riconoscimento di archi e cerchi del PDF');
  const servers = await lib.startAll(chromium);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'], env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
  const rows = [];
  const snaps = [];
  try {
    for (const kind of KINDS) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(600000);
      page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
      await page.goto(lib.URL);
      const t0 = Date.now();
      const made = await makePdf(kind, N, rng(5000 + N + kind.length));
      info(`${kind}: ${made.elements} elementi in ${made.subpaths} sottopercorsi, PDF di ${(made.bytes.length / 1048576).toFixed(2)} MB costruito in ${Date.now() - t0} ms`);
      await page.setInputFiles('input[type=file]', { name: `perf-${kind}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(made.bytes) });
      await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0 && window.__gtpdf.pdfSnap().busy.length === 0 && window.__gtpdf.pdfSnap().cached.length > 0, null, { timeout: 600000 });
      const acc = { off: { wall: [], ex: [], pts: [], idx: [], op: [], rings: [] }, on: { wall: [], ex: [], pts: [], idx: [], op: [], rings: [] } };
      let last = { off: null, on: null };
      const load = (flag) => page.evaluate((fl) => window.__gtpdf.pdfSnapLoad(1, { maxSegments: 1e12, maxCoords: 1e12, store: false, clear: false, recognizeArcs: fl }), flag);
      for (let i = 0; i < REPEAT + 1; i++) {
        for (const [name, flag] of [['off', false], ['on', true]]) {
          const r = await load(flag);
          if (r.state.kind !== 'ready') throw new Error(`stato ${r.state.kind}`);
          last[name] = r.state;
          if (i === 0) continue; // la prima lettura di ogni coppia e' di riscaldamento (compilazione JIT) e si scarta
          const t = r.state.timings;
          acc[name].wall.push(r.wallMs);
          acc[name].ex.push(t.extractMs);
          acc[name].pts.push(t.pointsMs);
          acc[name].idx.push(t.indexMs);
          acc[name].op.push(t.opListMs);
          acc[name].rings.push(t.ringsMs ?? 0);
        }
      }
      const on = last.on;
      rows.push({
        kind,
        made,
        wallOff: median(acc.off.wall),
        wallOn: median(acc.on.wall),
        exOff: median(acc.off.ex),
        exOn: median(acc.on.ex),
        ptsOff: median(acc.off.pts),
        ptsOn: median(acc.on.pts),
        idxOff: median(acc.off.idx),
        idxOn: median(acc.on.idx),
        ringsOn: median(acc.on.rings),
        opOff: median(acc.off.op),
        opOn: median(acc.on.op),
        minWallOff: Math.min(...acc.off.wall),
        maxWallOff: Math.max(...acc.off.wall),
        minWallOn: Math.min(...acc.on.wall),
        maxWallOn: Math.max(...acc.on.wall),
        ringStats: on.ringStats,
        ringBytes: on.ringBytes,
        bytesOff: last.off.bytes,
        bytesOn: on.bytes,
        gridBytesOn: on.gridBytes,
        nEnd: on.nEnd,
        nMid: on.nMid,
        offHasRings: !!last.off.ringStats,
      });
      // findSnap: lo stato con gli anelli nella cache, poi chiamate con e senza `pdfRings`
      await page.evaluate(() => window.__gtpdf.pdfSnapLoad(1, { maxSegments: 1e12, maxCoords: 1e12, store: true, clear: true, recognizeArcs: true }));
      const rnd = rng(77);
      const randRaws = Array.from({ length: 1000 }, () => ({ x: 20 + rnd() * (SHEET[0] - 40), y: 20 + rnd() * (SHEET[1] - 40) }));
      const nearRaws = made.centers.length
        ? Array.from({ length: 1000 }, (_, i) => {
            const c = made.centers[i % made.centers.length];
            return { x: c.x + (rnd() - 0.5) * 6, y: c.y + (rnd() - 0.5) * 6 };
          })
        : randRaws;
      const sets = [['a caso nel foglio', randRaws]];
      if (made.centers.length) sets.push(['entro 3 pt da un centro', nearRaws]);
      for (const [setName, raws] of sets) {
        for (const rings of [false, true]) {
          const r = await page.evaluate(([rw, rg]) => window.__gtpdf.snapRunPdf([], rw, 6, { mode: 'index', batch: 1000, batches: 7, singles: 0, kinds: { end: true, mid: true, center: true, quadrant: true }, rings: rg }), [raws, rings]);
          const b = r.batchMs.slice(1); // la prima serie e' di riscaldamento
          snaps.push({ kind, setName, rings, usPerCall: (median(b) / r.batch) * 1000, hits: r.hits, calls: r.calls });
        }
      }
      await ctx.close();
    }
    console.log(`\nChromium del contenitore (NON iPhone/Safari, NON Edge dell'utente); build di prova: ${process.env.E2E_DIST || '(costruito da questo script)'}; foglio A3 orizzontale ${SHEET.join(' x ')} pt; ${N} elementi per caso; ${REPEAT} coppie di letture per caso (la prima scartata, mediana).`);
    console.log('\n**Lettura della pagina (`loadPdfSnap`, tutta la catena): senza e con il riconoscimento degli anelli**\n');
    console.log('| caso | sottopercorsi | anelli | centri | quadranti | senza: parete | con: parete | differenza | estrazione senza / con | punti senza / con | indice senza / con | anelli (punti + indice) | memoria degli anelli che resta | buffer di estrazione (si liberano) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const rs = r.ringStats;
      console.log(
        `| ${r.kind} | ${r.made.subpaths} | ${rs ? rs.rings : 0} | ${rs ? rs.centers : 0} | ${rs ? rs.quadrants : 0} | ${fmt(r.wallOff)} ms (${fmt(r.minWallOff, 0)}-${fmt(r.maxWallOff, 0)}) | ${fmt(r.wallOn)} ms (${fmt(r.minWallOn, 0)}-${fmt(r.maxWallOn, 0)}) | ${r.wallOn - r.wallOff >= 0 ? '+' : ''}${fmt(r.wallOn - r.wallOff)} ms | ${fmt(r.exOff)} / ${fmt(r.exOn)} ms | ${fmt(r.ptsOff)} / ${fmt(r.ptsOn)} ms | ${fmt(r.idxOff)} / ${fmt(r.idxOn)} ms | ${fmt(r.ringsOn)} ms | ${fmt(r.ringBytes / 1048576, 2)} MB | ${fmt((rs ? rs.ringBytes : 0) / 1048576, 2)} MB |`,
      );
    }
    console.log('\n(`punti` e `indice` sono quelli dei tratti: i punti e l\'indice degli anelli stanno nella colonna «anelli» e si AGGIUNGONO, dentro la parete. «Memoria che resta» = punti e indice degli anelli (come `bytes` per i tratti); i buffer di estrazione si liberano con la geometria. La memoria e\' la contabilita\' dell\'app, non la misura del browser. Lo stato SENZA riconoscimento ha ringStats assente: ' + rows.map((r) => `${r.kind}=${r.offHasRings ? 'PRESENTE' : 'assente'}`).join(', ') + '.)');
    console.log('\n**`findSnap` (indice dei punti; Estremo, Punto medio, Centro e Quadrante accesi; raggio 6 pt), senza e con gli anelli**\n');
    console.log('| caso | punti | anelli | µs per chiamata (mediana di 6 serie da 1000) | aggancio trovato |');
    console.log('|---|---|---|---|---|');
    for (const s of snaps) {
      console.log(`| ${s.kind} | ${s.setName} | ${s.rings ? 'con' : 'senza'} | ${fmt(s.usPerCall, 2)} | ${s.hits} su ${s.calls} |`);
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
