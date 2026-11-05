// Misura di CP6c (V2b): altezza della palette, della barra contestuale e del visore con lo strumento "Cerchio e arco" (palette di 11 voci invece di 10), a 390 x 780 e
// 844 x 390 (telefono emulato, tocco, DPR 3, margini di sicurezza come probe-cp6a), con l'interfaccia a A+ normale (16 px) e al massimo (22 px).
// Si lancia sul build nuovo e, con E2E_DIST=<build di prova di 47a660e>, sul build di prima: gli strumenti che esistono in entrambi (Retta, Quota, Copertura) si
// confrontano; "Cerchio e arco" esiste solo nel nuovo. Chromium, NON Safari: le altezze del telefono vero NON sono verificate.
// Uso: node scripts/probe-cp6c.cjs [cartella]   (E2E_DIST=<build di prova gia' fatto>)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'probe-cp6c', out: process.argv[2], port: 4211, hport: 4212, zoom: 2 });
const { URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';

async function measure(browser, w, h, uiIdx, toolTitle, kind) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  await openSample(page, 'A4 vettoriale');
  if (toolTitle) {
    await page.locator(`button.tool[title="${toolTitle}"]`).tap();
    await page.waitForTimeout(250);
    if (kind) {
      const sel = toolTitle === 'Copertura' ? '.ctx-covers' : toolTitle === 'Cerchio e arco' ? '.ctx-curves' : toolTitle === 'Quota' ? '.ctx-types' : null;
      if (sel) await page.locator(`${sel} button`, { hasText: kind }).tap();
      await page.waitForTimeout(200);
    }
  }
  const r = await page.evaluate(() => {
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
      const b = e.getBoundingClientRect();
      return { h: Math.round(b.height * 10) / 10, w: Math.round(b.width * 10) / 10 };
    };
    const pal = document.querySelector('.palette');
    const tools = [...pal.querySelectorAll('button.tool')].filter((b) => getComputedStyle(b).display !== 'none');
    const small = tools.filter((b) => b.getBoundingClientRect().height < 43.5).length;
    return {
      palette: box('.palette'),
      paletteScroll: { client: [pal.clientWidth, pal.clientHeight], scroll: [pal.scrollWidth, pal.scrollHeight] },
      ctx: box('.ctxbar'),
      hint: box('.ctx-hint'),
      viewer: box('.work'),
      header: box('.bar'),
      status: box('.statusbar'),
      tools: tools.length,
      toolsUnder44: small,
    };
  });
  await ctx.close();
  return r;
}

(async () => {
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const rows = [];
  try {
    for (const [w, h] of [[390, 780], [844, 390]]) {
      for (const [ui, uiName] of [[1, 'A+ 16'], [4, 'A+ 22 (massimo)']]) {
        for (const [tool, kind] of [[null, null], ['Retta', null], ['Quota', null], ['Copertura', 'Cerchio'], ['Cerchio e arco', 'Arco']]) {
          let m = null;
          try {
            m = await measure(browser, w, h, ui, tool, kind);
          } catch (e) {
            m = { error: String(e.message).split('\n')[0] };
          }
          rows.push({ finestra: `${w}x${h}`, ui: uiName, strumento: tool ?? '(nessuno)', ...m });
          console.log(JSON.stringify(rows[rows.length - 1]));
        }
      }
    }
  } finally {
    await lib.stopAll(servers);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
