// Misura del tempo di `findSnap` (src/geometry/snap.ts + snapExtra.ts) con i tipi nuovi di CP6f (Intersezione, Quadrante, Perpendicolare, Tangente, Origine) su una pagina con
// 100, 2.000 e 10.000 oggetti (10.000 e' il limite per pagina del formato progetto) e nel caso CONCENTRATO (2.000 oggetti in un quadrato di 100 x 100 pt).
// Misura in CHROMIUM DESKTOP (questo contenitore), NON sul PC o sul telefono dell'utente: i numeri non valgono per altri browser o macchine.
// Chiama la STESSA funzione dell'app (`window.__gtpdf.snapRun`, presente solo nel build di prova GTPDF_TEST=1) su oggetti sintetici (generatore deterministico): miscela di Rette,
// Linee a 4 punti, Coperture rettangolari e circolari, Quote, Testi, Cerchi e Archi; punti da cercare: meta' vicini a un candidato (estremo, punto medio, circonferenza),
// meta' casuali. Il raggio e' quello del mouse a zoom di adattamento.
// Tre varianti per caso: SPENTI (i tre tipi di prima: Estremo, Punto medio, Centro, come c4380b0), ACCESI SENZA PUNTO DI PARTENZA (Intersezione e Quadrante calcolano, Perpendicolare e
// Tangente no: nessuna costruzione in corso) e ACCESI CON PUNTO DI PARTENZA (tutti e sette: il caso peggiore). A parte, il costo di RIFARE la scena (riquadri in pt del foglio):
// si paga una volta a ogni cambio del modello o della pagina, non a ogni movimento del mouse.
// performance.now() in Chromium senza isolamento ha risoluzione di 100 us: la singola chiamata non e' misurabile sotto quel valore, per cui si riporta il tempo di
// un LOTTO di B chiamate diviso B (mediana e massimo su 200 lotti) e, a parte, la singola chiamata (mediana, 99-esimo percentile e massimo, con la sua risoluzione).
// Soglia di CP6f: 4 ms per chiamata. Se e' superata si propone un indice spaziale, non si implementa senza OK.
// Uso: node scripts/perf-cp6f.cjs [cartella]
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'perf-cp6f', out: process.argv[2], port: 4226, hport: 4227, zoom: 2 });
const { newApp, openSample, setSection, info } = lib;

/** Generatore pseudocasuale deterministico (stesso risultato a ogni esecuzione). */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** N oggetti dentro il riquadro `box` [x0, y0, x1, y1] dello spazio utente; ritorna anche i punti candidati (per scegliere i punti vicini). */
function makeObjects(n, box, rnd, size = 1) {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0;
  const H = y1 - y0;
  const pt = () => ({ x: x0 + rnd() * W, y: y0 + rnd() * H });
  const stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 };
  const objs = [];
  const cands = [];
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    const r = rnd();
    if (r < 0.34) {
      const a = pt();
      const b = { x: a.x + (rnd() - 0.5) * 80 * size, y: a.y + (rnd() - 0.5) * 80 * size };
      objs.push({ id, kind: 'segment', points: [a, b], stroke });
      cands.push(a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (r < 0.5) {
      const pts = [pt()];
      for (let k = 1; k < 4; k++) pts.push({ x: pts[k - 1].x + (rnd() - 0.5) * 60 * size, y: pts[k - 1].y + (rnd() - 0.5) * 60 * size });
      objs.push({ id, kind: 'polyline', points: pts, stroke });
      cands.push(...pts);
    } else if (r < 0.62) {
      const a = pt();
      const b = { x: a.x + (20 + rnd() * 80) * size, y: a.y + (20 + rnd() * 80) * size };
      objs.push({ id, kind: 'cover', shape: 'rect', p1: a, p2: b });
      cands.push(a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y });
    } else if (r < 0.68) {
      const a = pt();
      objs.push({ id, kind: 'cover', shape: 'circle', p1: a, p2: { x: a.x + (10 + rnd() * 30) * size, y: a.y } });
      cands.push(a);
    } else if (r < 0.76) {
      const a = pt();
      const b = { x: a.x + (30 + rnd() * 80) * size, y: a.y };
      objs.push({ id, kind: 'dim', dim: 'horizontal', p1: a, p2: b, a: { x: a.x, y: a.y + 20 * size }, b: { x: b.x, y: a.y + 20 * size }, valueText: null, color: '#D32F2F', widthPt: 1, textPt: 10 });
      cands.push(a, b);
    } else if (r < 0.82) {
      objs.push({ id, kind: 'text', at: pt(), text: 'Ø8', textPt: 10, color: '#D32F2F' });
    } else if (r < 0.92) {
      const c = pt();
      const rad = (5 + rnd() * 40) * size;
      const a = rnd() * 2 * Math.PI;
      objs.push({ id, kind: 'circle', p1: c, p2: { x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) }, stroke });
      cands.push(c, { x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) }, { x: c.x + rad, y: c.y }, { x: c.x, y: c.y + rad });
    } else {
      const c = pt();
      const rad = (5 + rnd() * 40) * size;
      const a1 = rnd() * 2 * Math.PI;
      const span = (60 + rnd() * 240) * (Math.PI / 180);
      const on = (a) => ({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) });
      const p1 = on(a1);
      const p2 = on(a1 + span * (0.3 + rnd() * 0.4));
      const p3 = on(a1 + span);
      objs.push({ id, kind: 'arc', p1, p2, p3, stroke });
      cands.push(p1, p3, c);
    }
  }
  return { objs, cands };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

(async () => {
  setSection('prestazioni dello snap ampliato');
  const servers = await lib.startAll(chromium);
  try {
    const { ctx, page } = await newApp(servers.browser, { viewport: { width: 1280, height: 900 } });
    await openSample(page, 'A4 vettoriale');
    const pg = await page.evaluate(() => ({ info: window.__gtpdf.pages()[0], sheet: window.__gtpdf.sheet() }));
    const view = pg.info.view;
    const zoom = await page.evaluate(() => document.querySelector('.viewer-stage canvas').getBoundingClientRect().width / window.__gtpdf.sheet().w);
    const radiusPt = 10 / zoom; // raggio del mouse
    info(`Pagina A4 ${pg.sheet.w.toFixed(1)} x ${pg.sheet.h.toFixed(1)} pt, zoom di adattamento ${zoom.toFixed(3)} px/pt, raggio del mouse ${radiusPt.toFixed(2)} pt`);
    const ALL = { end: true, mid: true, center: true, intersection: true, quadrant: true, perpendicular: true, tangent: true };
    const OLD = { end: true, mid: true, center: true };
    const NEW_NOANCHOR = ALL; // senza `anchor` Perpendicolare e Tangente non calcolano nulla
    const cases = [
      { name: '100 oggetti sulla pagina', n: 100, box: view, size: 1 },
      { name: '2.000 oggetti sulla pagina', n: 2000, box: view, size: 1 },
      { name: '10.000 oggetti sulla pagina', n: 10000, box: view, size: 1 },
      // concentrato: 2.000 oggetti in 100 x 100 pt (tratti e figure piu' piccoli, in proporzione, perche' restino dentro il riquadro)
      { name: '2.000 oggetti concentrati in 100 x 100 pt', n: 2000, box: [view[0] + 200, view[1] + 300, view[0] + 300, view[1] + 400], size: 0.25 },
      // peggiore: stessi 2.000 oggetti in 100 x 100 pt ma di dimensioni NORMALI (tratti fino a 80 pt, cerchi fino a 45 pt di raggio): quasi tutti passano vicino al cursore
      { name: '2.000 oggetti di dimensioni normali sovrapposti in 100 x 100 pt (caso peggiore)', n: 2000, box: [view[0] + 200, view[1] + 300, view[0] + 300, view[1] + 400], size: 1 },
    ];
    const rows = [];
    for (const cs of cases) {
      const rnd = rng(777 + cs.n + Math.round(cs.size * 100));
      const { objs, cands } = makeObjects(cs.n, cs.box, rnd, cs.size);
      const [bx0, by0, bx1, by1] = cs.box;
      const raws = [];
      const CALLS = 2000;
      for (let i = 0; i < CALLS; i++) {
        if (i % 2 === 0) {
          const c = cands[Math.floor(rnd() * cands.length)];
          raws.push({ x: c.x + (rnd() - 0.5) * radiusPt, y: c.y + (rnd() - 0.5) * radiusPt });
        } else raws.push({ x: bx0 + rnd() * (bx1 - bx0), y: by0 + rnd() * (by1 - by0) });
      }
      const anchor = { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 };
      const origin = { x: view[0] + 20, y: view[1] + 20 };
      for (const v of [
        { name: 'tipi nuovi SPENTI (come c4380b0)', kinds: OLD, anchor: null, origin: null },
        { name: 'tipi nuovi accesi, senza punto di partenza', kinds: NEW_NOANCHOR, anchor: null, origin },
        { name: 'tipi nuovi accesi, con punto di partenza', kinds: ALL, anchor, origin },
      ]) {
        const res = await page.evaluate(({ objs, raws, radius, v }) => window.__gtpdf.snapRun(objs, raws, radius, { batch: 50, batches: 200, singles: 5000, kinds: v.kinds, anchor: v.anchor, origin: v.origin }), { objs, raws, radius: radiusPt, v });
        const perCall = res.batchMs.map((ms) => ms / res.batch);
        rows.push({ caso: cs.name, variante: v.name, hits: res.hits, calls: res.calls, med: median(perCall), max: Math.max(...perCall), sMed: median(res.singleMs), sP99: pct(res.singleMs, 0.99), sP999: pct(res.singleMs, 0.999), sMax: Math.max(...res.singleMs), over: res.singleMs.filter((x) => x > 4).length, nSingle: res.singleMs.length, sceneMs: res.sceneMs });
      }
    }
    console.log('\n| caso | variante | chiamate | agganci | mediana per chiamata (lotti da 50) | massimo per chiamata (lotti da 50) | singola chiamata: mediana / 99-esimo / 99,9-esimo / massimo (ris. 0,1 ms) | singole oltre 4 ms | scena rifatta (una volta) |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.caso} | ${r.variante} | ${r.calls} | ${r.hits} | ${(r.med * 1000).toFixed(1)} us | ${(r.max * 1000).toFixed(1)} us | ${r.sMed.toFixed(2)} / ${r.sP99.toFixed(2)} / ${r.sP999.toFixed(2)} / ${r.sMax.toFixed(2)} ms | ${r.over} su ${r.nSingle} | ${r.variante.includes('SPENTI') ? '-' : r.sceneMs.toFixed(2) + ' ms'} |`);
    const worstBatch = Math.max(...rows.map((r) => r.max));
    const worstSingle = Math.max(...rows.map((r) => r.sMax));
    const overAll = rows.reduce((a, r) => a + r.over, 0);
    console.log(`\nPeggior media per chiamata in un lotto: ${worstBatch.toFixed(2)} ms (soglia 4 ms: ${worstBatch <= 4 ? 'NON superata' : 'SUPERATA'}). Peggior singola chiamata: ${worstSingle.toFixed(2)} ms; singole chiamate oltre 4 ms: ${overAll} su ${rows.reduce((a, r) => a + r.nSingle, 0)}.`);
    console.log('Le singole oltre 4 ms per variante: ' + rows.filter((r) => r.over > 0).map((r) => `${r.caso} / ${r.variante}: ${r.over}`).join(' ; ') + '.');
    await ctx.close();
  } finally {
    await lib.stopAll(servers);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
