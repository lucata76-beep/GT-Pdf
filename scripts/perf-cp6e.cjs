// Prestazioni di CP6e (selezione multipla e trasformazioni) con molte selezioni: tempo di Sposta, Specchio, Rotazione, Duplica, Canc, Annulla e Ripeti su 1.000 oggetti selezionati,
// numero di cambiamenti del modello per comando (deve essere 1), e costo dell'anteprima a ogni movimento del mouse. Chromium nel contenitore: i numeri NON sono quelli del PC
// dell'utente. Nessun limite deciso: si riportano i tempi.
// Uso: node scripts/perf-cp6e.cjs [N]   (N = numero di oggetti, predefinito 1000; costruisce da solo il build di prova)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const N = Number(process.argv[2]) || 1000;
const lib = createE2E({ name: 'perf-cp6e', port: 4219, hport: 4220, zoom: 2 });
const { URL: APP_URL, openSample } = lib;

(async () => {
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
    await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
    await page.goto(APP_URL);
    await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
    await openSample(page, 'A4 vettoriale');
    await page.evaluate(() => window.__gtpdf.fit());
    const made = await page.evaluate((n) => {
      const info = window.__gtpdf.pages()[0];
      const [x0, y0, x1, y1] = info.view;
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const px = () => x0 + 0.05 * (x1 - x0) + rnd() * 0.9 * (x1 - x0);
      const py = () => y0 + 0.05 * (y1 - y0) + rnd() * 0.9 * (y1 - y0);
      const st = { style: 'solid', color: '#D32F2F', widthPt: 1 };
      const objs = [];
      for (let i = 0; i < n; i++) {
        const k = i % 5;
        if (k === 0) objs.push({ kind: 'segment', points: [{ x: px(), y: py() }, { x: px(), y: py() }], stroke: st });
        else if (k === 1) objs.push({ kind: 'circle', p1: { x: px(), y: py() }, p2: { x: px(), y: py() }, stroke: st });
        else if (k === 2) objs.push({ kind: 'text', at: { x: px(), y: py() }, text: `T${i}`, textPt: 10, color: '#D32F2F' });
        else if (k === 3) objs.push({ kind: 'dim', dim: 'aligned', p1: { x: px(), y: py() }, p2: { x: px(), y: py() }, a: { x: px(), y: py() }, b: { x: px(), y: py() }, valueText: '12.5', color: '#D32F2F', widthPt: 1, textPt: 10 });
        else objs.push({ kind: 'polyline', points: [{ x: px(), y: py() }, { x: px(), y: py() }, { x: px(), y: py() }], stroke: st });
      }
      const t0 = performance.now();
      window.__gtpdf.add(1, objs);
      return { ms: performance.now() - t0, count: window.__gtpdf.objectCount() };
    }, N);
    console.log(`Creazione di ${made.count} oggetti con ${N} comandi (uno per oggetto, come il gancio di prova): ${made.ms.toFixed(0)} ms (non e' un comando dell'app)`);
    await page.locator('button.tool[title="Seleziona"]').click();
    const g = await page.evaluate(() => {
      const s = window.__gtpdf.sheet();
      return { w: s.w, h: s.h };
    });
    const ids = await page.evaluate(() => window.__gtpdf.state().pages[0].objects.map((o) => o.id));
    const timed = (label, fn) => page.evaluate(`(() => { const t0 = performance.now(); const v0 = window.__gtpdf.state().version; const r = (${fn})(); return { label: ${JSON.stringify(label)}, r, ms: performance.now() - t0, v0 }; })()`);
    // la versione del modello sale di 1 per comando: si legge prima e dopo (state() ha un costo suo, non incluso nel tempo del comando)
    const run = async (label, action) => {
      const v0 = await page.evaluate(() => window.__gtpdf.state().version);
      const ms = await page.evaluate((a) => {
        const t0 = performance.now();
        // eslint-disable-next-line no-eval
        eval(a);
        return performance.now() - t0;
      }, action);
      const v1 = await page.evaluate(() => window.__gtpdf.state().version);
      console.log(`${label}: ${ms.toFixed(1)} ms, cambiamenti del modello: ${v1 - v0}`);
      return { ms, changes: v1 - v0 };
    };
    void timed;
    const t = await page.evaluate((list) => {
      const t0 = performance.now();
      window.__gtpdf.selectIds(list);
      return performance.now() - t0;
    }, ids);
    console.log(`Selezione di ${ids.length} oggetti (selectIds, con evidenziazione e riquadro delle proprieta'): ${t.toFixed(1)} ms`);
    const hint = await page.locator('.ctx-hint').innerText();
    console.log(`Testo guida: "${hint}"`);
    await run(`Sposta ${N} oggetti`, "window.__gtpdf.applyTransform({ kind: 'move', dx: 12.5, dy: -7.25 })");
    await run('Annulla (Sposta)', "document.querySelector('.undo-ctl button').click()");
    await run('Ripeti (Sposta)', "document.querySelectorAll('.undo-ctl button')[1].click()");
    await run('Annulla (Sposta)', "document.querySelector('.undo-ctl button').click()");
    await run(`Specchio di ${N} oggetti`, `window.__gtpdf.applyTransform({ kind: 'mirror', a: { x: 100, y: ${g.h / 2} }, b: { x: 200, y: ${g.h / 2} } })`);
    await run('Annulla (Specchio)', "document.querySelector('.undo-ctl button').click()");
    await run(`Rotazione di ${N} oggetti (37 gradi)`, `window.__gtpdf.applyTransform({ kind: 'rotate', center: { x: ${g.w / 2}, y: ${g.h / 2} }, deg: 37 })`);
    await run('Annulla (Rotazione)', "document.querySelector('.undo-ctl button').click()");
    await page.evaluate((list) => window.__gtpdf.selectIds(list), ids);
    await run(`Duplica ${N} oggetti`, 'window.__gtpdf.duplicate()');
    await run('Annulla (Duplica)', "document.querySelector('.undo-ctl button').click()");
    await run('Ripeti (Duplica)', "document.querySelectorAll('.undo-ctl button')[1].click()");
    await run('Annulla (Duplica)', "document.querySelector('.undo-ctl button').click()");
    await page.evaluate((list) => window.__gtpdf.selectIds(list), ids);
    await run(`Canc su ${N} oggetti`, 'window.__gtpdf.deleteSelection()');
    await run('Annulla (Canc)', "document.querySelector('.undo-ctl button').click()");
    const back = await page.evaluate(() => window.__gtpdf.state().pages[0].objects.map((o) => o.id));
    console.log(`Dopo Annulla gli oggetti sono ${back.length} e nello stesso ordine: ${JSON.stringify(back) === JSON.stringify(ids)}`);
    // anteprima: costo di ogni movimento del mouse con la trasformazione armata e N oggetti selezionati
    await page.evaluate((list) => window.__gtpdf.selectIds(list), ids);
    await page.locator('.ctx-tr', { hasText: 'Sposta' }).click();
    const r = await page.evaluate(() => { const c = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: c.left, top: c.top, width: c.width, height: c.height }; });
    await page.mouse.move(r.left + r.width * 0.3, r.top + r.height * 0.3);
    await page.mouse.down();
    await page.mouse.up();
    const move = await page.evaluate((rect) => {
      const el = document.querySelector('.viewer');
      const times = [];
      for (let i = 0; i < 30; i++) {
        const x = rect.left + rect.width * (0.35 + 0.01 * i);
        const y = rect.top + rect.height * (0.3 + 0.005 * i);
        const t0 = performance.now();
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, bubbles: true, buttons: 0 }));
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { median: times[15], max: times[29], min: times[0], ghost: document.querySelector('.sc-ghost')?.children.length ?? 0 };
    }, r);
    console.log(`Anteprima di Sposta con ${N} oggetti selezionati: per ogni movimento del mouse mediana ${move.median.toFixed(1)} ms, massimo ${move.max.toFixed(1)} ms (primitive nell'anteprima: ${move.ghost})`);
    await ctx.close();
  } finally {
    await lib.stopAll(servers);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
