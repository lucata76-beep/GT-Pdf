// Misura della barra di stato di CP6a (nuovi interruttori Estremo, Punto medio e Griglia accanto a ORTO) a larghezze e dimensioni dell'interfaccia diverse:
// quanto e' larga la riga rispetto alla barra, quali elementi escono (la riga scorre in orizzontale, decisione 39), altezza della barra e righe visive.
// Telefono emulato (tocco, DPR 3, margini di sicurezza 0/59/21/59 in orizzontale e 59/0/34/0 in verticale come CP5e: valori consueti, NON letti dal telefono)
// e desktop (mouse). Chromium, NON Safari. Uso: node scripts/probe-cp6a.cjs [cartella]   (E2E_DIST=<build di prova> per provare un altro build)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'probe-cp6a', out: process.argv[2], port: 4205, hport: 4206, zoom: 2 });
const { URL: APP_URL } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const UI_PX = [14, 16, 18, 20, 22];

async function open(browser, w, h, uiIdx, kind) {
  const opts = kind === 'phone' ? { viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA } : { viewport: { width: w, height: h } };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  if (kind === 'phone') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  }
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.waitForSelector('.statusbar');
  await page.waitForTimeout(150);
  return { ctx, page };
}

const measure = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.statusbar');
    const b = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const items = [];
    for (const e of box.children) {
      const r = e.getBoundingClientRect();
      if (getComputedStyle(e).display === 'none' || r.width === 0) continue;
      const label = (e.dataset.toggle ? e.dataset.toggle : e.className).toString().replace(/\s+/g, ' ').slice(0, 14);
      items.push({ label, left: r.left, right: r.right, top: r.top, bottom: r.bottom, inside: r.right <= b.right + 0.5 && r.left >= b.left - 0.5 });
    }
    // righe visive: sovrapposizione verticale degli elementi
    const sorted = [...items].sort((x, y) => x.top - y.top);
    let rows = 0;
    let curBottom = -Infinity;
    for (const it of sorted) {
      if (it.top >= curBottom - 0.5) {
        rows++;
        curBottom = it.bottom;
      } else curBottom = Math.max(curBottom, it.bottom);
    }
    const vwr = document.querySelector('.viewer');
    const fz = document.querySelector('.float-zoom');
    const bar = document.querySelector('.bar');
    const viewerH = vwr ? Math.round(vwr.getBoundingClientRect().height * 10) / 10 : null;
    const floatOverBar = fz && bar ? fz.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 0.5 : null;
    return { viewerH, floatOverBar, client: box.clientWidth, scroll: box.scrollWidth, height: Math.round(b.height * 10) / 10, wrap: cs.flexWrap, overflowX: cs.overflowX, out: items.filter((i) => !i.inside).map((i) => i.label), rows };
  });

(async () => {
  const servers = await lib.startAll(chromium);
  try {
    const cases = [
      ['telefono', 932, 430],
      ['telefono', 844, 390],
      ['telefono', 780, 390],
      ['telefono', 720, 390],
      ['desktop', 1280, 800],
      ['telefono verticale', 390, 780],
    ];
    console.log('\n| finestra | A+ | riga (contenuto / barra) | scorre | fuori dalla barra a riposo | altezza barra | righe visive | altezza del visore | colonna sul foglio oltre l\'intestazione |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const [kind, w, h] of cases) {
      for (let idx = 0; idx < UI_PX.length; idx++) {
        const { ctx, page } = await open(servers.browser, w, h, idx, kind.startsWith('telefono') ? 'phone' : 'desktop');
        const m = await measure(page);
        console.log(`| ${kind} ${w} x ${h} | ${UI_PX[idx]} | ${m.scroll} / ${m.client} | ${m.scroll > m.client ? 'si' : 'no'} | ${m.out.length ? m.out.join(', ') : '-'} | ${m.height} | ${m.rows} | ${m.viewerH} | ${m.floatOverBar ? 'SI' : 'no'} |`);
        await ctx.close();
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
