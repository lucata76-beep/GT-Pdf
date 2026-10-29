// Misure di CP5d (menu in orizzontale, zoom e spostamento, altezza del visore) su Chromium con tocco emulato. NON fa controlli: stampa numeri.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/probe-cp5d.cjs <layout|menu> [cartella]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const { join } = require('node:path');

const MODE = process.argv[2] || 'layout';
const lib = createE2E({ name: 'probe-cp5d', out: process.argv[3], port: 4195, hport: 4196, zoom: 2 });
const { URL: APP_URL } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const SIZES = [14, 16, 22]; // A+ al minimo, normale, al massimo (UI_SIZES)

async function open(browser, w, h, uiIdx, withDoc) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  // Margini di sicurezza dell'iPhone 14 Pro Max (valori consueti, NON letti dal telefono dell'utente): orizzontale 0/59/21/59, verticale 59/0/34/0.
  const cdp = await ctx.newCDPSession(page);
  const land = w > h;
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: land ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  if (withDoc) {
    await page.locator('summary', { hasText: 'PDF di prova' }).click();
    await page.getByRole('button', { name: 'A4 vettoriale', exact: true }).click();
    await page.waitForSelector('.viewer-stage canvas');
    await page.waitForTimeout(500);
  }
  return { ctx, page };
}

const layout = (page) =>
  page.evaluate(() => {
    const R = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { top: Math.round(r.top * 10) / 10, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, shown: cs.display !== 'none' && r.height > 0 };
    };
    return {
      iw: innerWidth,
      ih: innerHeight,
      font: getComputedStyle(document.documentElement).fontSize,
      bar: R('.bar'),
      work: R('.work'),
      viewer: R('.viewer'),
      palette: R('.palette'),
      ctx: R('.ctxbar'),
      stat: R('.statusbar'),
      kbd: R('.keypad'),
      insp: R('.inspector'),
    };
  });


// ---- Zoom e spostamento: puntatore perso, visore basso, pulsanti sul foglio ----
async function pointersProbe(browser) {
  const w = 844;
  const h = Number(process.argv[4]) || 326;
  // Si apre il documento con una finestra piu' alta (a A+ al massimo il pannello vuoto non entra nel visore basso) e poi si riduce l'altezza.
  const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 59, bottom: 21, right: 59 } });
  await page.addInitScript(() => {
    localStorage.setItem('gtpdf.uiSize', '4');
    window.__swallow = new Set();
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, (e) => { if (window.__swallow.has(e.pointerId)) e.stopImmediatePropagation(); }, true);
  });
  await page.goto(APP_URL);
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: 'A4 vettoriale', exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  const rects = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), shown: getComputedStyle(e).display !== 'none' }; };
    return { viewer: r('.viewer'), floatZoom: r('.float-zoom'), buttons: [...document.querySelectorAll('.float-zoom .btn')].map((b) => { const q = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) }; }) };
  });
  console.log('RETTANGOLI', JSON.stringify(rects));
  const V = rects.viewer;
  const view = () => page.evaluate(() => window.__gtpdf.view());
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const fmtV = (v) => 'zoom ' + v.zoom.toFixed(3) + ' tx ' + v.tx.toFixed(1) + ' ty ' + v.ty.toFixed(1) + ' puntatori [' + v.pointerIds + '] pinch ' + v.pinching + ' modo ' + v.mode;
  const cx = V.x + V.w / 2;
  const cy = V.y + V.h / 2;
  const drag = async (x, y, dx, dy) => {
    await touch('touchStart', [[x, y, 1]]);
    for (let k = 1; k <= 8; k++) await touch('touchMove', [[x + (dx * k) / 8, y + (dy * k) / 8, 1]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(80);
  };
  const pinch = async (spread0, spread1) => {
    await touch('touchStart', [[cx - spread0, cy, 1], [cx + spread0, cy, 2]]);
    for (let k = 1; k <= 8; k++) { const sp = spread0 + ((spread1 - spread0) * k) / 8; await touch('touchMove', [[cx - sp, cy, 1], [cx + sp, cy, 2]]); }
    await touch('touchEnd', []);
    await page.waitForTimeout(80);
  };

  console.log('S0 base       ', fmtV(await view()));
  await drag(cx - 60, cy, 100, 0);
  console.log('S0 un dito 100px a destra ->', fmtV(await view()));
  const z0 = (await view()).zoom;
  await pinch(20, 60);
  console.log('S0 pinch 20->60 ->', fmtV(await view()), ' (zoom prima ' + z0.toFixed(3) + ')');

  // ---- puntatore perso ----
  console.log('--- pointerup perso ---');
  await touch('touchStart', [[cx - 40, cy, 1], [cx + 40, cy, 2]]);
  const ids = (await view()).pointerIds;
  console.log('ids con due dita:', ids);
  await page.evaluate((id) => window.__swallow.add(id), ids[0]);
  await touch('touchMove', [[cx + 40, cy, 2]]); // solleva il dito 1 (l'evento verra' inghiottito)
  await page.waitForTimeout(50);
  console.log('dito 1 sollevato (up perso):', fmtV(await view()));
  await touch('touchEnd', []);
  await page.waitForTimeout(80);
  console.log('tutte le dita su, la mappa dovrebbe essere vuota:', fmtV(await view()));
  const before = await view();
  await drag(cx - 60, cy, 100, 0);
  const after = await view();
  console.log('UN dito, 100 px a destra, con il puntatore fantasma ->', fmtV(after));
  console.log('   zoom prima/dopo', before.zoom.toFixed(3), after.zoom.toFixed(3), 'variazione di zoom', (after.zoom / before.zoom).toFixed(3));
  const b2 = await view();
  await pinch(20, 60);
  const a2 = await view();
  console.log('due dita (pinch 20->60) con il fantasma: zoom prima/dopo', b2.zoom.toFixed(3), a2.zoom.toFixed(3), 'mappa dopo [' + a2.pointerIds + ']');
  // ---- pulsanti sul foglio ----
  console.log('--- pulsanti sul foglio ---');
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(200);
  const vz = async () => (await view()).zoom;
  const tap = async (x, y) => { await touch('touchStart', [[x, y, 1]]); await touch('touchEnd', []); await page.waitForTimeout(120); };
  const area = rects.floatZoom.w * rects.floatZoom.h / (V.w * V.h);
  console.log('la riga dei pulsanti copre ' + (100 * area).toFixed(1) + ' % dell\'area del visore (' + (100 * rects.floatZoom.w / V.w).toFixed(0) + ' % della larghezza, ' + (100 * rects.floatZoom.h / V.h).toFixed(0) + ' % dell\'altezza)');
  const btnRect = (label) => page.evaluate((l) => { const e = document.querySelector('.float-zoom .btn[aria-label="' + l + '"]'); const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, v: document.querySelector('.viewer').getBoundingClientRect().height }; }, label);
  const backToPan = async () => { await page.evaluate(() => document.querySelector('button.tool[title="Sposta vista"]')?.click()); await page.evaluate(() => window.__gtpdf.fit()); await page.waitForTimeout(150); };
  for (const label of ['Distanza', 'Aumenta zoom', 'Riduci zoom', 'Adatta alla pagina']) {
    await backToPan();
    if (label !== 'Aumenta zoom') await page.evaluate(() => window.__gtpdf.zoomTo(0.5));
    await page.waitForTimeout(100);
    const r = await btnRect(label);
    const z0b = await vz();
    const mode0 = (await view()).mode;
    await tap(r.x + r.w / 2, r.y + r.h / 2);
    const v1 = await view();
    const r2 = await btnRect('Adatta alla pagina');
    console.log('tocco su "' + label + '": zoom ' + z0b.toFixed(3) + ' -> ' + v1.zoom.toFixed(3) + ' (x' + (v1.zoom / z0b).toFixed(3) + '), modo ' + mode0 + ' -> ' + v1.mode + ', altezza del visore ' + r.v.toFixed(0) + ' -> ' + r2.v.toFixed(0) + ' px');
  }
  await backToPan();
  // un dito che parte su "Aumenta zoom" e striscia a sinistra: sposta la vista?
  const plus = await btnRect('Aumenta zoom');
  const vb = await view();
  await drag(plus.x + plus.w / 2, plus.y + plus.h / 2, -150, 0);
  const va = await view();
  console.log('un dito che parte sul pulsante "Aumenta zoom" e striscia 150 px a sinistra: tx ' + vb.tx.toFixed(1) + ' -> ' + va.tx.toFixed(1) + ', zoom ' + vb.zoom.toFixed(3) + ' -> ' + va.zoom.toFixed(3));
  await page.screenshot({ path: join(lib.OUT, 'pointers.png') });
  await ctx.close();
}

async function main() {
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    const combos = [
      [932, 430],
      [932, 340],
      [844, 390],
      [844, 340],
      [430, 932],
      [430, 775],
    ];
    if (MODE === 'pointers') await pointersProbe(browser);
    else if (MODE === 'layout') {
      for (const [w, h] of combos) {
        for (const idx of [0, 1, 4]) {
          for (const withDoc of [false, true]) {
            const { ctx, page } = await open(browser, w, h, idx, withDoc);
            const L = await layout(page);
            const f = (o) => (o && o.shown ? `${o.h}` : '-');
            console.log(
              `${w}x${h} A+=${SIZES[idx === 4 ? 2 : idx]}px doc=${withDoc ? 'si' : 'no'}  viewer=${f(L.viewer)} (${L.viewer ? L.viewer.w : '-'} larg)  bar=${f(L.bar)} ctx=${f(L.ctx)} stat=${f(L.stat)} palette=${L.palette ? (L.palette.shown ? `${L.palette.h}x${L.palette.w}` : '-') : '-'} insp=${f(L.insp)} kbd=${f(L.kbd)}`,
            );
            await ctx.close();
          }
        }
      }
    } else if (MODE === 'menu') {
      for (const [w, h] of combos) {
        for (const idx of [0, 1, 4]) {
          const { ctx, page } = await open(browser, w, h, idx, true);
          for (const name of ['File', 'Modifica', 'Inserisci', 'Zoom']) {
            await page.getByRole('button', { name, exact: true }).click();
            await page.waitForTimeout(80);
            const m = await page.evaluate(() => {
              const p = document.querySelector('.menu-panel');
              const pr = p.getBoundingClientRect();
              const items = [...p.querySelectorAll('.menu-item')];
              const hs = items.map((e) => e.getBoundingClientRect().height);
              return {
                top: pr.top,
                bottom: pr.bottom,
                ih: innerHeight,
                n: items.length,
                clientH: p.clientHeight,
                scrollH: p.scrollHeight,
                minItem: Math.min(...hs),
                maxItem: Math.max(...hs),
                maxHeightCss: getComputedStyle(p).maxHeight,
                menuTop: p.style.getPropertyValue('--menu-top'),
                coarse: matchMedia('(pointer: coarse)').matches,
              };
            });
            console.log(
              `${w}x${h} A+=${SIZES[idx === 4 ? 2 : idx]}px ${name}: ${m.n} voci, voce min ${m.minItem.toFixed(1)} max ${m.maxItem.toFixed(1)} px, pannello ${Math.round(m.top)}-${Math.round(m.bottom)} su ${m.ih}, client ${m.clientH} scroll ${m.scrollH}${m.scrollH > m.clientH + 0.5 ? ' (SCORRE)' : ''}, max-height ${m.maxHeightCss}, --menu-top ${m.menuTop}, coarse=${m.coarse}`,
            );
            await page.keyboard.press('Escape');
            await page.waitForTimeout(40);
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await lib.stopAll(servers);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
