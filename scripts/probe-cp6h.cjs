// Misura di CP6h (PARTE 1): la barra dei tipi di quota (sei pulsanti dopo CP6g) a varie finestre e a tutti i livelli di A+ (14, 16, 18, 20, 22 px: l'indice 4, 22 px, e' il massimo),
// con Quota allineata e Quota angolare (che aggiunge l'interruttore "Da 3 punti" nella barra), e, come confronto, gli altri strumenti con barra a scelta (Retta, Copertura, Cerchio e arco).
// Per ogni caso: altezza della barra contestuale, altezza del testo guida, riquadro di ogni pulsante dei tipi (sinistra, destra, altezza), eventuale scorrimento orizzontale della pagina.
// Si lancia sul build nuovo e, con E2E_DIST=<build di prova di b3d8646>, sul build di prima. Chromium con tocco emulato, NON Safari: le misure del telefono vero NON sono verificate.
// Uso: node scripts/probe-cp6h.cjs [cartella]   (E2E_DIST=<build di prova gia' fatto>; E2E_WINDOWS="390x780,360x700,430x900" per scegliere le finestre)
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'probe-cp6h', out: process.argv[2], port: 4230, hport: 4231, zoom: 2 });
const { URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const WINDOWS = (process.env.E2E_WINDOWS || '390x780,360x700,430x900').split(',').map((s) => s.split('x').map(Number));
const UI_PX = [14, 16, 18, 20, 22];
const r1 = (v) => Math.round(v * 10) / 10;

async function measure(browser, w, h, uiIdx, toolTitle, kind) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  await openSample(page, 'A4 vettoriale');
  await page.locator(`button.tool[title="${toolTitle}"]`).tap();
  await page.waitForTimeout(250);
  if (kind) {
    const sel = toolTitle === 'Copertura' ? '.ctx-covers' : toolTitle === 'Cerchio e arco' ? '.ctx-curves' : toolTitle === 'Quota' ? '.ctx-types' : null;
    if (sel) await page.locator(`${sel} button`, { hasText: kind }).tap();
    await page.waitForTimeout(250);
  }
  const res = await page.evaluate(() => {
    const box = (e) => {
      if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
      const b = e.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
    };
    const sel = (s) => document.querySelector(s);
    const groups = {};
    for (const g of ['.ctx-types', '.ctx-covers', '.ctx-curves']) {
      const el = sel(g);
      if (el && !el.hidden) {
        groups[g] = [...el.querySelectorAll('button')].map((b) => {
          // larghezza del testo (Range) contro lo spazio interno del pulsante (senza bordi e margini interni): margine > 0 = il testo entra tutto
          const rg = document.createRange();
          rg.selectNodeContents(b);
          const cs = getComputedStyle(b);
          const inner = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return { n: b.textContent, ...box(b), sw: b.scrollWidth, cw: b.clientWidth, textW: rg.getBoundingClientRect().width, inner, lines: Math.round(rg.getBoundingClientRect().height / parseFloat(cs.lineHeight)), font: parseFloat(cs.fontSize) };
        });
      }
    }
    const acts = [...document.querySelectorAll('.ctx-actions > *')].map((e) => ({ c: e.className.split(' ').filter((x) => x !== 'btn')[0], ...box(e) })).filter((x) => x.w !== undefined);
    return {
      iw: innerWidth,
      scrollW: document.documentElement.scrollWidth,
      bar: box(sel('.ctxbar')),
      hint: box(sel('.ctx-hint')),
      hintText: sel('.ctx-hint')?.textContent,
      groups,
      acts,
    };
  });
  await ctx.close();
  return res;
}

(async () => {
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const cases = [['Quota', 'Allineata'], ['Quota', 'Angolare'], ['Retta', null], ['Copertura', 'Cerchio'], ['Cerchio e arco', 'Arco']];
  try {
    for (const [w, h] of WINDOWS) {
      for (let ui = 0; ui < UI_PX.length; ui++) {
        for (const [tool, kind] of cases) {
          let m;
          try {
            m = await measure(browser, w, h, ui, tool, kind);
          } catch (e) {
            m = { error: String(e.message).split('\n')[0] };
          }
          if (m.error) {
            console.log(JSON.stringify({ finestra: `${w}x${h}`, aplus: UI_PX[ui], strumento: `${tool}${kind ? ' / ' + kind : ''}`, error: m.error }));
            continue;
          }
          const grp = Object.values(m.groups)[0] || [];
          const maxR = grp.length ? Math.max(...grp.map((b) => b.r)) : null;
          const minH = grp.length ? Math.min(...grp.map((b) => b.h)) : null;
          const minL = grp.length ? Math.min(...grp.map((b) => b.l)) : null;
          const clipped = grp.filter((b) => b.sw > b.cw + 0.5 || b.textW > b.inner + 0.01).map((b) => b.n);
          const slack = grp.length ? Math.min(...grp.map((b) => b.inner - b.textW)) : null;
          console.log(
            JSON.stringify({
              finestra: `${w}x${h}`,
              aplus: UI_PX[ui],
              strumento: `${tool}${kind ? ' / ' + kind : ''}`,
              barraH: r1(m.bar.h),
              guidaH: m.hint ? r1(m.hint.h) : null,
              pulsanti: grp.length,
              bordoSx: minL === null ? null : r1(minL),
              bordoDx: maxR === null ? null : r1(maxR),
              altezzaMin: minH === null ? null : r1(minH),
              testoTagliato: clipped,
              margineTesto: slack === null ? null : r1(slack),
              carattere: grp.length ? r1(grp[0].font) : null,
              righeMax: grp.length ? Math.max(...grp.map((b) => b.lines)) : null,
              azioniDx: m.acts.length ? r1(Math.max(...m.acts.map((a) => a.r))) : null,
              scorrimentoOrizz: m.scrollW > m.iw,
              larghezze: grp.map((b) => r1(b.w)),
            }),
          );
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
