// Misure di CP5d (menu in orizzontale, zoom e spostamento, altezza del visore) su Chromium con tocco emulato. NON fa controlli: stampa numeri.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/probe-cp5d.cjs <layout|menu> [cartella]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

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
    if (MODE === 'layout') {
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
