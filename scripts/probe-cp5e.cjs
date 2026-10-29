// Misure di CP5e (altezza di intestazione e barra di stato che non dipende dalla larghezza, pannello "Nessun documento" nel visore) su Chromium con tocco emulato.
// Stampa numeri, non fa controlli (i controlli sono in e2e-cp5e.cjs). NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/probe-cp5e.cjs <width|fit|need> <indirizzo-del-build>   oppure   table <indirizzo-prima> <indirizzo-dopo>   (il build di prova, GTPDF_TEST=1, deve essere gia' servito, per esempio
//   con `npx vite preview --outDir <cartella> --port 4301`: cosi' si confronta lo stesso script tra due commit senza ricostruire).
// Chromium NON e' Safari: nulla di quanto segue prova il comportamento sul telefono. Margini di sicurezza emulati (0/59/21/59 in orizzontale) con
// Emulation.setSafeAreaInsetsOverride: valori consueti dell'iPhone 14 Pro Max, NON letti dal telefono.
const { chromium } = require('playwright');

const MODE = process.argv[2] || 'width';
const APP_URL = process.argv[3] || 'http://localhost:4302/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const UI_PX = [14, 16, 18, 20, 22];

async function phone(browser, w, h, uiIdx, withDoc, url = APP_URL) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(url);
  if (withDoc) await openSample(page);
  return { ctx, page };
}
async function desktop(browser, w, h, uiIdx) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  return { ctx, page };
}
/** Apre un PDF di prova dal campo file nascosto (non dal pannello "Nessun documento": prima di CP5e a A+ alto "PDF di prova" era fuori dal visore e non si poteva toccare). */
async function openSample(page, file = 'a4-vettoriale.pdf') {
  await page.setInputFiles('input[type=file]', { name: file, mimeType: 'application/pdf', buffer: require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'test-pdfs', file)) });
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(400);
}

/** Altezza di `selector` se fosse largo `w` px (position: fixed; width: w), come nelle misure dell'utente. null = larghezza vera. */
const heightAt = (page, selector, w) =>
  page.evaluate(
    ([s, width]) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const old = el.getAttribute('style');
      if (width !== null) el.style.cssText += `;position:fixed;left:0;top:0;width:${width}px`;
      const h = Math.round(el.getBoundingClientRect().height * 10) / 10;
      if (old === null) el.removeAttribute('style');
      else el.setAttribute('style', old);
      return h;
    },
    [selector, w],
  );

const trueWidth = (page, selector) => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width * 10) / 10, selector);

async function widthMode(browser) {
  for (const [vw, vh] of [[932, 320], [844, 390]]) {
    for (const idx of [0, 1, 2, 3, 4]) {
      const { ctx, page } = await phone(browser, vw, vh, idx, false);
      const bw = await trueWidth(page, '.bar');
      const widths = [null, 328, 250, 48];
      const out = [];
      for (const sel of ['.bar', '.statusbar']) {
        const hs = [];
        for (const w of widths) hs.push(`${w === null ? bw : w}:${await heightAt(page, sel, w)}`);
        out.push(`${sel} ${hs.join(' ')}`);
      }
      console.log(`${vw}x${vh} A+ ${UI_PX[idx]}: ${out.join(' | ')}`);
      await ctx.close();
    }
  }
}

/** Tutto cio' che esce dalla riga: elementi (con testo/etichetta) il cui bordo destro supera il bordo destro del contenitore. */
const clippedIn = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.className || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 22);
    const leaves = [...el.querySelectorAll('button, .st-coord, .st-scale, .st-msg, .doc-name, .brand, .zoom-val')].filter((e) => {
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && e.getBoundingClientRect().width > 0 && !e.closest('[hidden]');
    });
    const hidden = leaves.filter((e) => e.getBoundingClientRect().right > box.right + 0.5 || e.getBoundingClientRect().left < box.left - 0.5);
    const msg = el.querySelector('.st-msg, .doc-name');
    return { client: el.clientWidth, scroll: el.scrollWidth, height: Math.round(box.height * 10) / 10, msgW: msg ? Math.round(msg.getBoundingClientRect().width) : null, hidden: [...new Set(hidden.map(name))] };
  }, selector);

async function fitMode(browser) {
  console.log('--- tocco emulato (iPhone), senza documento');
  for (const [vw, vh] of [[932, 320], [844, 390], [780, 390], [720, 390]]) {
    for (const idx of [0, 1, 2, 3, 4]) {
      const { ctx, page } = await phone(browser, vw, vh, idx, false);
      const b = await clippedIn(page, '.bar');
      const s = await clippedIn(page, '.statusbar');
      const f = (n, r) => `${n} alta ${r.height} contenuto ${r.scroll}/${r.client}${r.msgW === null ? '' : ` msg ${r.msgW}`}${r.hidden.length ? ` FUORI: ${r.hidden.join(', ')}` : ''}`;
      console.log(`${vw}x${vh} A+ ${UI_PX[idx]}: ${f('bar', b)} | ${f('stato', s)}`);
      await ctx.close();
    }
  }
  console.log('--- desktop (mouse), senza documento');
  for (const vw of [720, 780, 844, 932, 1280]) {
    for (const idx of [0, 1, 2, 3, 4]) {
      const { ctx, page } = await desktop(browser, vw, 800, idx);
      const b = await clippedIn(page, '.bar');
      const s = await clippedIn(page, '.statusbar');
      const f = (n, r) => `${n} alta ${r.height} contenuto ${r.scroll}/${r.client}${r.msgW === null ? '' : ` msg ${r.msgW}`}${r.hidden.length ? ` FUORI: ${r.hidden.join(', ')}` : ''}`;
      console.log(`${vw} A+ ${UI_PX[idx]}: ${f('bar', b)} | ${f('stato', s)}`);
      await ctx.close();
    }
  }
}

/** Larghezza minima perche' una riga non tagli nulla: la barra forzata a 100 px (position: fixed), con nowrap il contenuto non cede oltre il minimo e scrollWidth e' quel minimo. */
const needAt = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const old = el.getAttribute('style');
    el.style.cssText += ';position:fixed;left:0;top:0;width:100px';
    const w = el.scrollWidth;
    if (old === null) el.removeAttribute('style');
    else el.setAttribute('style', old);
    return w;
  }, selector);

async function needMode(browser) {
  console.log('larghezza minima della riga (px) perche\' nulla esca; margini laterali 59+59 = 118 px (iPhone 14 Pro Max emulato), 0 su desktop');
  for (const idx of [0, 1, 2, 3, 4]) {
    const t = await phone(browser, 844, 390, idx, false);
    const d = await desktop(browser, 844, 800, idx);
    const row = async (page, insets) => `intestazione ${await needAt(page, '.bar')} (finestra >= ${(await needAt(page, '.bar')) + insets}) · stato ${await needAt(page, '.statusbar')} (finestra >= ${(await needAt(page, '.statusbar')) + insets})`;
    console.log(`A+ ${UI_PX[idx]} touch 720-899: ${await row(t.page, 118)}`);
    console.log(`A+ ${UI_PX[idx]} desktop 720-899: ${await row(d.page, 0)}`);
    await t.ctx.close();
    await d.ctx.close();
  }
}

/** Altezze (px) di intestazione, visore, barra contestuale e barra di stato adesso; 0 se nascosti. */
const heights = (page) =>
  page.evaluate(() => {
    const R = (q) => {
      const e = document.querySelector(q);
      if (!e) return 0;
      const cs = getComputedStyle(e);
      return cs.display === 'none' ? 0 : Math.round(e.getBoundingClientRect().height * 10) / 10;
    };
    return { bar: R('.bar'), viewer: R('.viewer'), ctx: R('.ctxbar'), stat: R('.statusbar') };
  });

/** Tabella prima/dopo (Parte 4 di CP5e) in righe Markdown: <indirizzo prima> <indirizzo dopo>. "p>d" dove prima e dopo differiscono, un solo numero dove sono uguali.
 *  Chromium con tocco emulato, margini 0/59/21/59: NON sono misure del telefono. Intestazione e stato sono letti con il documento aperto e nessuno strumento. */
async function tableMode(browser) {
  const before = process.argv[3];
  const after = process.argv[4];
  if (!before || !after) throw new Error('uso: table <indirizzo-prima> <indirizzo-dopo>');
  const both = (a, b) => (a === b ? String(a) : `${a}>${b}`);
  const TOOLS = [['nessuno', null], ['Distanza', 'Distanza'], ['Quota', 'Quota'], ['Copertura', 'Copertura']];
  console.log('| Finestra | A+ | Intest. | Stato | Contest. Distanza / Quota, Copertura | Visore senza documento | Visore, nessuno strumento | Visore, Distanza | Visore, Quota / Copertura |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [w, h] of [[932, 320], [932, 340], [932, 430], [844, 280], [844, 390]]) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const res = {};
      for (const [name, url] of [['b', before], ['a', after]]) {
        res[name] = { nodoc: null, doc: {} };
        const e = await phone(browser, w, h, idx, false, url);
        res[name].nodoc = await heights(e.page);
        await e.ctx.close();
        const d = await phone(browser, w, h, idx, true, url);
        for (const [label, title] of TOOLS) {
          if (title) {
            await d.page.evaluate((t) => document.querySelector(`button.tool[title="${t}"]`)?.click(), title);
            await d.page.waitForTimeout(200);
          }
          res[name].doc[label] = await heights(d.page);
        }
        await d.ctx.close();
      }
      const D = (label, key) => both(res.b.doc[label][key], res.a.doc[label][key]);
      const quota = D('Quota', 'viewer');
      const cop = D('Copertura', 'viewer');
      const qctx = D('Quota', 'ctx');
      const cctx = D('Copertura', 'ctx');
      console.log(`| ${w}x${h} | ${UI_PX[idx]} | ${D('nessuno', 'bar')} | ${D('nessuno', 'stat')} | ${D('Distanza', 'ctx')} / ${qctx === cctx ? qctx : `${qctx} · ${cctx}`} | ${both(res.b.nodoc.viewer, res.a.nodoc.viewer)} | ${D('nessuno', 'viewer')} | ${D('Distanza', 'viewer')} | ${quota === cop ? quota : `${quota} · ${cop}`} |`);
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (MODE === 'table') await tableMode(browser);
    else if (MODE === 'need') await needMode(browser);
    else if (MODE === 'width') await widthMode(browser);
    else if (MODE === 'fit') await fitMode(browser);
    else throw new Error(`modo sconosciuto: ${MODE}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
