// Come perf-cp6a.cjs, con CERCHI E ARCHI nel mix (V2b, CP6c) e i punti in costruzione: tempo di `findSnap` (src/geometry/snap.ts) con 100, 2.000 e 10.000 oggetti su una pagina
// (10.000 e' il limite per pagina del formato progetto). Mix: il 70 % come in perf-cp6a (Rette, Linee a 4 punti, Coperture rettangolari e circolari, Quote, Testi, nelle
// stesse proporzioni), 15 % Cerchi e 15 % Archi; 10 punti in costruzione (Estremo) in piu'.
// Misura in CHROMIUM DESKTOP (questo contenitore), NON sul PC o sul telefono dell'utente: i numeri non valgono per altri browser o macchine.
// Chiama la STESSA funzione dell'app (`window.__gtpdf.snapRun`, presente solo nel build di prova GTPDF_TEST=1) su oggetti sintetici (generatore deterministico) sparsi
// sulla pagina: miscela di Rette, Linee a 4 punti, Coperture rettangolari, Quote, Testi e Coperture circolari; punti da cercare: meta' vicini a un candidato
// (esito: aggancio), meta' lontani (esito: nessun aggancio). Il raggio e' quello del mouse a zoom di adattamento.
// performance.now() in Chromium senza isolamento ha risoluzione di 100 us: la singola chiamata non e' misurabile sotto quel valore, per cui si riporta il tempo di
// un LOTTO di B chiamate diviso B (mediana e massimo su 200 lotti) e, a parte, la singola chiamata (con la sua risoluzione).
// Uso: node scripts/perf-cp6c.cjs [cartella]   (E2E_MIX=old per il mix di perf-cp6a, senza cerchi e archi: confronto sulla stessa macchina)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp6c', out: process.argv[2], port: 4213, hport: 4214, zoom: 2 });
const { newApp, openSample, setSection, info } = lib;

/** Generatore pseudocasuale deterministico (stesso risultato a ogni esecuzione). */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** N oggetti nello spazio utente dell'area visibile `view` [x0, y0, x1, y1]; ritorna anche i punti candidati (per scegliere i punti vicini). */
function makeObjects(n, view, rnd) {
  const [x0, y0, x1, y1] = view;
  const W = x1 - x0;
  const H = y1 - y0;
  const pt = () => ({ x: x0 + rnd() * W, y: y0 + rnd() * H });
  const objs = [];
  const cands = [];
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    const r = rnd();
    const OLD = process.env.E2E_MIX === 'old';
    const st = { style: 'solid', color: '#D32F2F', widthPt: 1 };
    const rr = OLD ? r : r / 0.7; // 70 % degli oggetti con le proporzioni del mix di perf-cp6a, 15 % Cerchi, 15 % Archi
    if (!OLD && r >= 0.7) {
      const c = pt();
      if (r < 0.85) {
        const p2 = { x: c.x + 8 + rnd() * 40, y: c.y + (rnd() - 0.5) * 10 };
        objs.push({ id, kind: 'circle', p1: c, p2, stroke: st });
        cands.push(c);
      } else {
        const R = 15 + rnd() * 60;
        const a0 = rnd() * 6.28;
        const at = (t) => ({ x: c.x + R * Math.cos(a0 + t), y: c.y + R * Math.sin(a0 + t) });
        const p1 = at(0), p2 = at(0.4 + rnd()), p3 = at(1.6 + rnd());
        objs.push({ id, kind: 'arc', p1, p2, p3, stroke: st });
        cands.push(p1, p3, c);
      }
    } else if (rr < 0.45) {
      const a = pt();
      const b = { x: a.x + (rnd() - 0.5) * 80, y: a.y + (rnd() - 0.5) * 80 };
      objs.push({ id, kind: 'segment', points: [a, b], stroke: st });
      cands.push(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (rr < 0.65) {
      const pts = [pt()];
      for (let k = 1; k < 4; k++) pts.push({ x: pts[k - 1].x + (rnd() - 0.5) * 60, y: pts[k - 1].y + (rnd() - 0.5) * 60 });
      objs.push({ id, kind: 'polyline', points: pts, stroke: st });
      cands.push(...pts);
    } else if (rr < 0.8) {
      const a = pt();
      const b = { x: a.x + 20 + rnd() * 80, y: a.y + 20 + rnd() * 80 };
      objs.push({ id, kind: 'cover', shape: 'rect', p1: a, p2: b });
      cands.push(a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y });
    } else if (rr < 0.88) {
      const a = pt();
      const b = { x: a.x + 30 + rnd() * 80, y: a.y };
      objs.push({ id, kind: 'dim', dim: 'horizontal', p1: a, p2: b, a: { x: a.x, y: a.y + 20 }, b: { x: b.x, y: a.y + 20 }, valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 });
      cands.push(a, b);
    } else if (rr < 0.95) {
      objs.push({ id, kind: 'text', at: pt(), text: 'Ø8', textPt: 10, color: '#D32F2F' });
    } else {
      const a = pt();
      objs.push({ id, kind: 'cover', shape: 'circle', p1: a, p2: { x: a.x + 10 + rnd() * 30, y: a.y } });
      cands.push(a);
    }
  }
  return { objs, cands };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  setSection('prestazioni dello snap');
  const servers = await lib.startAll(chromium);
  try {
    const { ctx, page } = await newApp(servers.browser, { viewport: { width: 1280, height: 900 } });
    await openSample(page, 'A4 vettoriale');
    const pg = await page.evaluate(() => ({ info: window.__gtpdf.pages()[0], sheet: window.__gtpdf.sheet() }));
    const view = pg.info.view;
    // Zoom di adattamento: pixel CSS per pt = larghezza del canvas / larghezza del foglio
    const zoom = await page.evaluate(() => document.querySelector('.viewer-stage canvas').getBoundingClientRect().width / window.__gtpdf.sheet().w);
    const radiusPt = 10 / zoom; // raggio del mouse
    info(`Pagina A4 ${pg.sheet.w.toFixed(1)} x ${pg.sheet.h.toFixed(1)} pt, zoom di adattamento ${zoom.toFixed(3)} px/pt, raggio del mouse ${radiusPt.toFixed(2)} pt`);
    const rows = [];
    for (const n of [100, 2000, 10000]) {
      const rnd = rng(12345 + n);
      const { objs, cands } = makeObjects(n, view, rnd);
      const raws = [];
      const CALLS = 2000;
      for (let i = 0; i < CALLS; i++) {
        if (i % 2 === 0) {
          const c = cands[Math.floor(rnd() * cands.length)];
          raws.push({ x: c.x + (rnd() - 0.5) * radiusPt, y: c.y + (rnd() - 0.5) * radiusPt });
        } else raws.push({ x: view[0] + rnd() * (view[2] - view[0]), y: view[1] + rnd() * (view[3] - view[1]) });
      }
      const pending = Array.from({ length: 10 }, () => ({ x: view[0] + rnd() * (view[2] - view[0]), y: view[1] + rnd() * (view[3] - view[1]) }));
      const res = await page.evaluate(({ objs, raws, radius, pending }) => window.__gtpdf.snapRun(objs, raws, radius, { batch: 50, batches: 200, pending }), { objs, raws, radius: radiusPt, pending });
      const perCall = res.batchMs.map((ms) => ms / res.batch);
      rows.push({ n, hits: res.hits, calls: res.calls, med: median(perCall), max: Math.max(...perCall), singleMax: Math.max(...res.singleMs), singleMed: median(res.singleMs) });
    }
    console.log('\n| oggetti | chiamate | agganci | mediana per chiamata (lotti da 50) | massimo per chiamata (lotti da 50) | singola chiamata: mediana / massimo (ris. 0,1 ms) |');
    console.log('|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.n} | ${r.calls} | ${r.hits} | ${(r.med * 1000).toFixed(1)} us | ${(r.max * 1000).toFixed(1)} us | ${r.singleMed.toFixed(2)} / ${r.singleMax.toFixed(2)} ms |`);
    await ctx.close();
  } finally {
    await lib.stopAll(servers);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
