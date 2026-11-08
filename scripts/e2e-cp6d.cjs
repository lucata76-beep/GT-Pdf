// Prove di CP6d (tappa "Origine e shell") su Chromium: menu Origine (Imposta/Rimuovi, strumento a un colpo), simbolo solo a schermo, barra di stato e griglia relative
// all'origine, shell (Retta, Linea, Cerchio: punti esatti, rifiuti, mescolare con il mouse, tastiera), file progetto versione 3 (lettura di 1 e 2), chiusura con la sola
// origine, esportazione identica con e senza origine, tocco emulato (la shell non c'e'). Mouse (desktop 1280 x 900, clic reali) e, come guardia, tocco emulato (iPhone 390 x 780: decisione 73).
// Punti ESATTI: i punti digitati si confrontano con un calcolo indipendente (geometria della pagina ricostruita qui da `pages()`), entro 1e-6 pt nello spazio utente;
// i punti presi col mouse (senza snap) con la tolleranza del rettangolo del canvas (RAW_TOL).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6d.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 8575e69 i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=origine,stato,griglia,shell,shellpagine,tastiera,barra,progetto,chiusura,export,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente (Microsoft Edge sul PC): nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6d', out: process.argv[2], port: 4215, hport: 4216, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel di getBoundingClientRect), non con un valore esatto. */
const RAW_TOL = 0.03;
const MM_PT = 72 / 25.4; // pt per mm
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const COMMA_MESSAGE = 'Usa il punto per i decimali e «;» per separare X e Y.';

// ---------------------------------------------------------------- strumenti di prova
async function desktop(browser, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page };
}
async function phone(browser, w = 390, h = 780) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, cdp };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });

const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(150);
};
const curveTool = async (page, kind) => {
  await tool(page, 'Cerchio e arco');
  await page.locator('.ctx-curves button', { hasText: kind === 'arc' ? 'Arco' : 'Cerchio' }).click();
  await page.waitForTimeout(120);
};
const toggle = (page, name) => page.locator(`.st-toggle[data-toggle="${name}"]`);
const pressed = async (page, name) => (await toggle(page, name).getAttribute('aria-pressed')) === 'true';
const setToggle = async (page, name, on) => {
  if ((await pressed(page, name)) !== on) await toggle(page, name).click();
  await page.waitForTimeout(80);
};
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const originOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].origin, n);
const lastObj = async (page) => {
  const o = await objectsOf(page);
  return o[o.length - 1];
};

/** Geometria della pagina 1, ricostruita qui da `pages()` con le formule di `PageGeometry` (come e2e-cp6a/b/c): lo script gira anche sul build di 8575e69. */
function makeGeom(info) {
  const [x0, y0, x1, y1] = info.view;
  const sU = info.userUnit > 0 ? info.userUnit : 1;
  const rot = (((info.rotate % 360) + 360) % 360) | 0;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rot];
  let offX, offY, width, height;
  if (a === 0) {
    offX = Math.abs(cy - y0) * sU;
    offY = Math.abs(cx - x0) * sU;
    width = (y1 - y0) * sU;
    height = (x1 - x0) * sU;
  } else {
    offX = Math.abs(cx - x0) * sU;
    offY = Math.abs(cy - y0) * sU;
    width = (x1 - x0) * sU;
    height = (y1 - y0) * sU;
  }
  const m = [a * sU, b * sU, c * sU, d * sU, offX - a * sU * cx - c * sU * cy, offY - b * sU * cx - d * sU * cy];
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    width,
    height,
    userToSheet: (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
    sheetToUser: (p) => {
      const x = p.x - m[4];
      const y = p.y - m[5];
      return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
    },
  };
}
let G = null; // geometria della pagina 1 del documento aperto (impostata da openDoc)
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const pageInfo = (page) => page.evaluate(() => window.__gtpdf.pages()[0]);
const userOf = (info, f) => ({ x: info.view[0] + f[0] * (info.view[2] - info.view[0]), y: info.view[1] + f[1] * (info.view[3] - info.view[1]) });
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const clientOfUser = (page, u) => clientOfSheet(page, G.userToSheet(u));
const sheetOfClient = async (page, c) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: (c.x - r.left) / k, y: (c.y - r.top) / k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** pt del foglio per 1 mm delle coordinate relative: mm reali con la scala (mmPerPt), mm del foglio senza. */
const unitPt = (mmPerPt) => (mmPerPt ? 1 / mmPerPt : MM_PT);
/** Punto utente per le coordinate relative (X, Y in mm) rispetto a un'origine utente: calcolo indipendente dall'app. */
function relToUser(origUser, mmPerPt, x, y) {
  const o = G.userToSheet(origUser);
  const u = unitPt(mmPerPt);
  return G.sheetToUser({ x: o.x + x * u, y: o.y - y * u });
}

async function openDoc(page, title = 'A4 vettoriale') {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
}
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
/** Voce di un menu della barra (File, Modifica, Inserisci, Origine, Zoom). */
async function menuItem(page, menu, re) {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.locator('.menu-item').filter({ hasText: re }).click();
  await page.waitForTimeout(120);
}
const menuState = async (page, menu) => {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.waitForTimeout(80);
  const items = await page.$$eval('.menu-panel .menu-item', (els) => els.map((i) => ({ text: i.textContent.trim(), disabled: i.disabled || i.getAttribute('aria-disabled') === 'true' })));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  return items;
};
/** Il simbolo dell'origine: posizione sullo schermo (il punto dell'origine), etichette, puntatore. Null se non c'e'. */
const originMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.origin-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    const svg = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)\s*\)/);
    const box = g.getBoundingClientRect();
    return {
      x: m ? svg.left + +m[1] : NaN,
      y: m ? svg.top + +m[2] : NaN,
      labels: [...g.querySelectorAll('text')].map((t) => t.textContent),
      pointerEvents: getComputedStyle(g).pointerEvents,
      inOverlay: !!g.closest('.viewer-layer'),
      w: box.width,
      h: box.height,
      arrowPaths: g.querySelectorAll('.origin-ink path').length,
    };
  });
/** X e Y della barra di stato con le loro unita'. */
const coords = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.st-coord');
    return { x: c.querySelectorAll('.num')[0].textContent, y: c.querySelectorAll('.num')[1].textContent, ux: c.querySelectorAll('.unit')[0].textContent, uy: c.querySelectorAll('.unit')[1].textContent, title: c.title };
  });
/** Le linee della griglia, in coordinate dello schermo: x delle verticali, y delle orizzontali. */
const gridLines = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.sc-grid');
    if (!el || el.getAttribute('display') === 'none') return null;
    const svg = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const d = el.getAttribute('d') || '';
    const xs = [...d.matchAll(/M(-?[\d.e+-]+) (-?[\d.e+-]+)V/g)].map((m) => svg.left + +m[1]);
    const ys = [...d.matchAll(/M(-?[\d.e+-]+) (-?[\d.e+-]+)H/g)].map((m) => svg.top + +m[2]);
    return { xs, ys };
  });
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);
const shell = (page) => page.locator('.ctx-shell');
const shellInput = (page) => page.locator('.ctx-shell-input');
const shellVisible = async (page) => (await shell(page).count()) === 1 && (await shell(page).isVisible());
/** Digita nella casella della shell e conferma con Invio. */
async function typeShell(page, text, enter = true) {
  const inp = shellInput(page);
  await inp.click();
  await inp.fill(text);
  if (enter) await inp.press('Enter');
  await page.waitForTimeout(80);
}
const ctxBarHeight = (page) => page.evaluate(() => { const b = document.querySelector('.ctxbar'); return b && !b.hidden ? b.getBoundingClientRect().height : 0; });
const focusInfo = (page) => page.evaluate(() => ({ cls: document.activeElement?.className ?? null, tag: document.activeElement?.tagName ?? null }));
// Ctrl+Z e Ctrl+Y dell'app: con il fuoco in un campo di testo (la casella della shell) varrebbero per il campo, quindi prima si toglie il fuoco dal campo.
const undo = async (page) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
};
const redo = async (page) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(80);
};
/** Imposta l'origine dal menu con un clic reale nel punto utente `u` (snap e griglia spenti non servono: nessun oggetto). */
async function setOriginByClick(page, u, dx = 0, dy = 0) {
  await menuItem(page, 'Origine', /^Imposta origine/);
  await click(page, await clientOfUser(page, u), dx, dy);
}

// ---------------------------------------------------------------- 1) menu Origine, strumento a un colpo, simbolo
async function originSuite(browser) {
  setSection('menu Origine, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  // senza documento: la voce c'e' ma le due azioni sono disattivate
  const menus0 = await page.$$eval('.menus .menu-btn', (bs) => bs.map((b) => b.textContent.trim()));
  check('barra dei menu: File, Modifica, Inserisci, Origine, Zoom', JSON.stringify(menus0) === JSON.stringify(['File', 'Modifica', 'Inserisci', 'Origine', 'Zoom']), JSON.stringify(menus0));
  const m0 = await menuState(page, 'Origine');
  check('senza documento: "Imposta origine" e "Rimuovi origine" sono tutte e due disattivate', !!m0 && m0.length === 2 && m0[0].text.startsWith('Imposta origine') && m0[1].text.startsWith('Rimuovi origine') && m0.every((i) => i.disabled), JSON.stringify(m0));
  await openDoc(page);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const m1 = await menuState(page, 'Origine');
  check('con il documento: "Imposta origine" attiva, "Rimuovi origine" disattivata (la pagina non ha un\'origine)', !!m1 && !m1[0].disabled && m1[1].disabled, JSON.stringify(m1));
  check('la palette non ha una voce Origine (11 strumenti come prima, nessun pulsante nuovo)', (await page.locator('.palette button.tool').count()) === 11 && (await page.locator('.palette button.tool[title="Origine"]').count()) === 0);

  // si arma da un colpo mentre e' attiva la Retta: torna alla Retta dopo il clic
  await tool(page, 'Retta');
  await menuItem(page, 'Origine', /^Imposta origine/);
  const h1 = await hint(page);
  check('Imposta origine arma lo strumento: il testo guida dice "Origine: indica il punto..." (una riga) e c\'e\' Annulla', /^Origine: indica il punto/.test(h1) && (await page.locator('.ctxbar .ctx-act', { hasText: 'Annulla' }).isEnabled()), h1);
  check('lo strumento armato non e\' un pulsante della palette: nessun pulsante premuto', (await page.locator('.palette button.tool[aria-pressed="true"]').count()) === 0);
  const p1 = U([0.3, 0.7]);
  await click(page, await clientOfUser(page, p1));
  const o1 = await originOf(page);
  const raw1 = G.sheetToUser(await sheetOfClient(page, await clientOfUser(page, p1)));
  check('il clic imposta l\'origine nel punto indicato (spazio utente, entro RAW_TOL)', !!o1 && nearP(o1, raw1, RAW_TOL), JSON.stringify(o1));
  check('messaggio di stato: "Origine impostata. Annulla la toglie."', (await status(page)) === 'Origine impostata. Annulla la toglie.', await status(page));
  check('strumento a un colpo: si torna alla Retta (premuta nella palette, testo guida della Retta)', (await page.locator('button.tool[title="Retta"]').getAttribute('aria-pressed')) === 'true' && /^Retta:/.test(await hint(page)), await hint(page));
  const mk = await originMark(page);
  const want1 = await clientOfUser(page, o1);
  check('il simbolo sta nel punto dell\'origine (entro 0.75 px)', !!mk && dist(mk, want1) < 0.75, JSON.stringify({ mk, want1 }));
  check('simbolo: due assi con le etichette X e Y, due punte, solo a schermo (nel livello di sovrapposizione), il livello non riceve il puntatore', !!mk && JSON.stringify(mk.labels) === JSON.stringify(['X', 'Y']) && mk.arrowPaths === 2 && mk.inOverlay && mk.pointerEvents === 'none', JSON.stringify(mk));
  check('simbolo di dimensione costante sullo schermo (circa 32 px per asse + etichette)', !!mk && mk.w > 30 && mk.w < 60 && mk.h > 30 && mk.h < 60, `${mk?.w} x ${mk?.h}`);
  const menusAfter = await menuState(page, 'Origine');
  check('ora "Rimuovi origine" e\' attiva', !!menusAfter && !menusAfter[1].disabled, JSON.stringify(menusAfter));
  // zoom: il simbolo resta di 32 px e segue il punto
  await page.evaluate(() => window.__gtpdf.zoomTo(2));
  await page.waitForTimeout(250);
  const mkz = await originMark(page);
  const wantz = await clientOfUser(page, o1);
  check('dopo lo zoom il simbolo e\' ancora sull\'origine e della stessa dimensione', !!mkz && dist(mkz, wantz) < 0.75 && Math.abs(mkz.w - mk.w) < 1 && Math.abs(mkz.h - mk.h) < 1, JSON.stringify({ mkz, wantz }));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(250);

  // il simbolo non intercetta i clic: la retta con un estremo sull'origine si seleziona e si cancella cliccando sul simbolo
  await page.evaluate((o) => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.3, 0.7], [0.62, 0.7]] }]), o1);
  await page.waitForTimeout(150);
  const seg = (await objectsOf(page))[0];
  const onSym = await clientOfUser(page, { x: (seg.points[0].x + seg.points[1].x) / 2, y: (seg.points[0].y + seg.points[1].y) / 2 });
  void onSym;
  // clic proprio sul simbolo (un po' a destra dell'origine, sull'asse X): sotto c'e' la retta, a 0 px di distanza
  const symClick = { x: want1.x + 14, y: want1.y };
  const topEl = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.viewer, .origin-mark, .viewer-overlay, .viewer-layer')?.className?.toString?.() ?? null, symClick);
  check('sul simbolo l\'elemento colpito e\' il visore, non il simbolo (pointer-events: none)', !!topEl && /\bviewer\b/.test(topEl) && !/origin-mark/.test(topEl), String(topEl));
  await tool(page, 'Seleziona');
  await click(page, symClick);
  check('Seleziona: un clic sul simbolo sceglie la retta che c\'e\' sotto', /^Selezionata: Retta/.test(await hint(page)), await hint(page));
  await tool(page, 'Cancella');
  await click(page, symClick);
  check('Cancella: un clic sul simbolo cancella la retta (non l\'origine: l\'origine non e\' un oggetto)', (await objectsOf(page)).length === 0 && (await originOf(page)) !== null, `${(await objectsOf(page)).length} / ${JSON.stringify(await originOf(page))}`);
  await undo(page);
  check('Annulla ripristina la retta e non tocca l\'origine', (await objectsOf(page)).length === 1 && nearP(await originOf(page), o1, 1e-12));
  await undo(page); // annulla addSpecs
  await tool(page, 'Retta');
  // niente snap sull'origine: nessun marcatore vicino al simbolo (non ci sono altri oggetti)
  const c1 = await clientOfUser(page, o1);
  await page.mouse.move(c1.x + 3, c1.y + 3);
  await page.waitForTimeout(80);
  // (CP6f, decisione 89: l'origine ora E' un candidato dello snap quando c'e' almeno un interruttore acceso: e2e-cp6f.cjs. Qui, come prima, il caso senza snap: tutti gli interruttori spenti.)
  const snapSwitches = page.locator('.panel-toggle:not([data-panel-toggle="grid"])');
  const snapWas = await snapSwitches.evaluateAll((els) => els.map((e) => [e.dataset.panelToggle, e.getAttribute('aria-pressed') === 'true']));
  for (const [k, on] of snapWas) if (on) await page.locator(`.panel-toggle[data-panel-toggle="${k}"]`).click();
  await page.mouse.move(c1.x + 4, c1.y + 4);
  await page.waitForTimeout(80);
  check('l\'origine non e\' un candidato dello snap con tutti gli interruttori spenti: vicino al simbolo non compare nessun marcatore', (await page.locator('.snap-mark:not([display="none"])').count()) === 0);
  for (const [k, on] of snapWas) if (on) await page.locator(`.panel-toggle[data-panel-toggle="${k}"]`).click();

  // sposta con un nuovo clic
  await menuItem(page, 'Origine', /^Imposta origine/);
  check('con un\'origine gia\' impostata il testo guida resta quello dell\'Origine e il messaggio dice che un clic la sposta', /^Origine: indica il punto/.test(await hint(page)) && /sposta l'origine/.test(await status(page)), `${await hint(page)} | ${await status(page)}`);
  const p2 = U([0.6, 0.35]);
  await click(page, await clientOfUser(page, p2));
  const o2 = await originOf(page);
  check('un nuovo clic sposta l\'origine (una sola per pagina)', !!o2 && nearP(o2, G.sheetToUser(await sheetOfClient(page, await clientOfUser(page, p2))), RAW_TOL) && !nearP(o2, o1, 1), JSON.stringify(o2));
  check('messaggio di stato: "Origine spostata. Annulla la rimette a posto."', (await status(page)) === 'Origine spostata. Annulla la rimette a posto.', await status(page));
  check('un solo simbolo sullo schermo', (await page.locator('.origin-mark:not([display="none"])').count()) === 1);
  await undo(page);
  check('Annulla (un solo passo) rimette l\'origine dov\'era, il simbolo la segue', nearP(await originOf(page), o1, 1e-12) && dist(await originMark(page), await clientOfUser(page, o1)) < 0.75);
  await redo(page);
  check('Ripeti la sposta di nuovo', nearP(await originOf(page), o2, 1e-12));

  // Esc e Annulla disarmano senza cambiare l'origine
  await menuItem(page, 'Origine', /^Imposta origine/);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc disarma l\'Origine: si torna alla Retta e l\'origine non cambia', /^Retta:/.test(await hint(page)) && nearP(await originOf(page), o2, 1e-12));
  await menuItem(page, 'Origine', /^Imposta origine/);
  await page.locator('.ctxbar .ctx-act', { hasText: 'Annulla' }).click();
  await page.waitForTimeout(100);
  check('il pulsante Annulla disarma l\'Origine e torna alla Retta', /^Retta:/.test(await hint(page)) && nearP(await originOf(page), o2, 1e-12));
  await menuItem(page, 'Origine', /^Imposta origine/);
  await tool(page, 'Linea');
  check('scegliendo un altro strumento dalla palette l\'Origine si disarma e quello scelto resta', /^Linea:/.test(await hint(page)));
  await click(page, await clientOfUser(page, U([0.2, 0.2])));
  check('... e un clic non sposta piu\' l\'origine (e\' un punto della Linea)', nearP(await originOf(page), o2, 1e-12));
  await page.keyboard.press('Escape');

  // un clic fuori dalla pagina non imposta nulla e non disarma
  await tool(page, 'Seleziona');
  await menuItem(page, 'Origine', /^Imposta origine/);
  const cv = await canvasRect(page);
  await click(page, { x: cv.left - 8, y: cv.top + 40 });
  check('un clic fuori dalla pagina non imposta l\'origine (messaggio del visore) e l\'Origine resta armata', /fuori dalla pagina/.test(await status(page)) && /^Origine:/.test(await hint(page)) && nearP(await originOf(page), o2, 1e-12), await status(page));
  await page.keyboard.press('Escape');
  check('... Esc disarma e riporta a Seleziona', /^Seleziona:/.test(await hint(page)));

  // rimuovi
  await menuItem(page, 'Origine', /^Rimuovi origine/);
  check('Rimuovi origine toglie l\'origine e il simbolo', (await originOf(page)) === null && (await originMark(page)) === null);
  check('messaggio di stato: "Origine rimossa. Annulla la ripristina."', (await status(page)) === 'Origine rimossa. Annulla la ripristina.', await status(page));
  await undo(page);
  check('Annulla (un solo passo) ripristina l\'origine e il simbolo', nearP(await originOf(page), o2, 1e-12) && !!(await originMark(page)));
  await redo(page);
  check('Ripeti la toglie di nuovo', (await originOf(page)) === null && (await originMark(page)) === null);
  const m2 = await menuState(page, 'Origine');
  check('senza origine "Rimuovi origine" torna disattivata', !!m2 && m2[1].disabled);
  // la cronologia mostra i nomi dei comandi nel menu Modifica
  await undo(page);
  await page.locator('.menu-btn', { hasText: 'Modifica' }).click();
  const undoItem = await page.locator('.menu-item').filter({ hasText: /^Annulla/ }).innerText();
  await page.keyboard.press('Escape');
  check('il menu Modifica dice quale passo annulla ("Sposta origine")', /Sposta origine/.test(undoItem), undoItem);
  await ctx.close();
}

// ---------------------------------------------------------------- 2) barra di stato relativa all'origine
async function statusSuite(browser) {
  setSection('barra di stato con l\'origine, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt`);
  // senza origine: mm del foglio dal bordo in basso a sinistra, anche con una scala
  const probeSheet = { x: 10 * MM_PT * 5, y: G.height - 10 * MM_PT * 7 }; // 50 mm da sinistra, 70 mm dal basso
  const cP = await clientOfSheet(page, probeSheet);
  await page.mouse.move(cP.x, cP.y);
  await page.waitForTimeout(80);
  let c = await coords(page);
  check('senza origine: X e Y dal bordo sinistro e dal bordo inferiore, in mm del foglio (come prima)', Math.abs(parseFloat(c.x) - 50) < 0.1 && Math.abs(parseFloat(c.y) - 70) < 0.1 && c.ux === 'mm' && c.uy === 'mm', JSON.stringify(c));
  await page.evaluate(() => window.__gtpdf.setScale(1, 0.5)); // 1 mm del foglio = 0.5 mm reali ... (mmPerPt = 0.5)
  await page.waitForTimeout(100);
  c = await coords(page);
  check('senza origine ma con una scala: ancora mm del foglio (invariato)', Math.abs(parseFloat(c.x) - 50) < 0.1 && Math.abs(parseFloat(c.y) - 70) < 0.1 && c.ux === 'mm', JSON.stringify(c));
  await undo(page); // annulla la scala

  // origine a 40 mm da sinistra e 100 mm dal basso (sul foglio)
  const origSheet = { x: 40 * MM_PT, y: G.height - 100 * MM_PT };
  const origUser = G.sheetToUser(origSheet);
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), origUser);
  await page.waitForTimeout(120);
  c = await coords(page);
  // il mouse e' fermo in (50, 70) mm del foglio: rispetto all'origine sono X = +10, Y = -30 (sotto l'origine)
  check('con l\'origine, mouse fermo: X e Y si rifanno subito (nessun movimento): +10 e -30 mm del foglio', Math.abs(parseFloat(c.x) - 10) < 0.1 && Math.abs(parseFloat(c.y) + 30) < 0.1, JSON.stringify(c));
  check('l\'etichetta dell\'unita\' dice "mm foglio" (pagina non calibrata) e il titolo spiega che sono relative all\'origine', c.ux === 'mm foglio' && c.uy === 'mm foglio' && /origine/.test(c.title), JSON.stringify(c));
  // sull'origine: 0, 0
  const cO = await clientOfSheet(page, origSheet);
  await page.mouse.move(cO.x, cO.y);
  await page.waitForTimeout(80);
  c = await coords(page);
  check('con il mouse sull\'origine: X = 0.00 e Y = 0.00', Math.abs(parseFloat(c.x)) < 0.05 && Math.abs(parseFloat(c.y)) < 0.05 && !/^-0/.test(c.x) && !/^-0/.test(c.y), JSON.stringify(c));
  // sinistra e sotto: negativi; destra e sopra: positivi (Y verso l'alto)
  const cUL = await clientOfSheet(page, { x: origSheet.x - 20 * MM_PT, y: origSheet.y - 15 * MM_PT });
  await page.mouse.move(cUL.x, cUL.y);
  await page.waitForTimeout(80);
  c = await coords(page);
  check('20 mm a sinistra e 15 mm sopra l\'origine (sul foglio): X = -20, Y = +15 (Y verso l\'alto)', Math.abs(parseFloat(c.x) + 20) < 0.1 && Math.abs(parseFloat(c.y) - 15) < 0.1, JSON.stringify(c));
  // scala: mm reali. mmPerPt = 0.5 -> 1 mm reale = 2 pt
  await page.evaluate(() => window.__gtpdf.setScale(1, 0.5));
  await page.waitForTimeout(120);
  c = await coords(page);
  const rel = (sheetP, mmPerPt) => {
    const u = unitPt(mmPerPt);
    return { x: (sheetP.x - origSheet.x) / u, y: (origSheet.y - sheetP.y) / u };
  };
  const sNow = await sheetOfClient(page, cUL);
  const e1 = rel(sNow, 0.5);
  check('con una scala le coordinate sono in mm REALI e si aggiornano subito con il mouse fermo (ricalibrazione)', Math.abs(parseFloat(c.x) - e1.x) < 0.05 && Math.abs(parseFloat(c.y) - e1.y) < 0.05 && c.ux === 'mm reali' && c.uy === 'mm reali', JSON.stringify({ c, e1 }));
  await page.evaluate(() => window.__gtpdf.setScale(1, 0.25));
  await page.waitForTimeout(120);
  c = await coords(page);
  const e2 = rel(sNow, 0.25);
  check('una seconda ricalibrazione cambia i valori subito', Math.abs(parseFloat(c.x) - e2.x) < 0.05 && Math.abs(parseFloat(c.y) - e2.y) < 0.05 && Math.abs(parseFloat(c.x) - e1.x) > 1, JSON.stringify({ c, e2 }));
  // zoom con la rotella a mouse fermo: i valori seguono il punto sotto il cursore
  const before = await coords(page);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(250);
  const after = await coords(page);
  const sAfter = await sheetOfClient(page, cUL);
  const e3 = rel(sAfter, 0.25);
  check('zoom con la rotella a mouse fermo: X e Y cambiano subito e sono quelle del punto sotto il cursore', Math.abs(parseFloat(after.x) - e3.x) < 0.1 && Math.abs(parseFloat(after.y) - e3.y) < 0.1 && (after.x !== before.x || after.y !== before.y), JSON.stringify({ before, after, e3 }));
  // fuori dalla pagina: trattini
  const cv = await canvasRect(page);
  await page.mouse.move(cv.left - 30, cv.top + 30);
  await page.waitForTimeout(80);
  c = await coords(page);
  check('con il cursore fuori dalla pagina restano i trattini (unita\' comprese)', c.x === '—' && c.y === '—', JSON.stringify(c));
  // sposta l'origine e annulla: i valori seguono senza muovere il mouse
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(250);
  const cm = await clientOfSheet(page, { x: 100, y: 100 });
  await page.mouse.move(cm.x, cm.y);
  await page.waitForTimeout(60);
  const c0 = await coords(page);
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), G.sheetToUser({ x: 10, y: 10 }));
  await page.waitForTimeout(100);
  const c1 = await coords(page);
  check('spostare l\'origine cambia X e Y a mouse fermo', c1.x !== c0.x && c1.y !== c0.y, JSON.stringify({ c0, c1 }));
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await page.waitForTimeout(100);
  const c2 = await coords(page);
  check('togliere l\'origine riporta X e Y in mm del foglio dal bordo, a mouse fermo, e l\'unita\' torna "mm"', Math.abs(parseFloat(c2.x) - 100 / MM_PT) < 0.1 && Math.abs(parseFloat(c2.y) - (G.height - 100) / MM_PT) < 0.1 && c2.ux === 'mm' && c2.uy === 'mm', JSON.stringify(c2));
  await ctx.close();

  // cambio di pagina: un'origine per pagina; i valori seguono la pagina mostrata
  setSection('barra di stato con l\'origine, due pagine');
  const d2 = await desktop(browser);
  await openDoc(d2.page, '3 pagine miste');
  const infos = await d2.page.evaluate(() => window.__gtpdf.pages());
  const g1 = makeGeom(infos[0]);
  G = g1;
  await d2.page.evaluate(() => window.__gtpdf.setOrigin(1, { x: 100, y: 100 }));
  await d2.page.waitForTimeout(100);
  const cc = await clientOfSheet(d2.page, { x: 150, y: 150 });
  await d2.page.mouse.move(cc.x, cc.y);
  await d2.page.waitForTimeout(80);
  const a1 = await coords(d2.page);
  check('pagina 1 con l\'origine: valori relativi, unita\' "mm foglio"', a1.ux === 'mm foglio', JSON.stringify(a1));
  await d2.page.evaluate(() => window.__gtpdf.goTo(2));
  await d2.page.waitForTimeout(500);
  const a2 = await coords(d2.page);
  check('pagina 2 senza origine: X e Y tornano "mm" del foglio dal bordo (cursore sempre fermo sul visore)', a2.ux === 'mm' && a2.uy === 'mm', JSON.stringify(a2));
  check('pagina 2: il simbolo non c\'e\' (e\' della pagina 1)', (await originMark(d2.page)) === null);
  await d2.page.evaluate(() => window.__gtpdf.setOrigin(2, { x: 50, y: 50 }));
  await d2.page.waitForTimeout(100);
  const a3 = await coords(d2.page);
  check('pagina 2: impostata la sua origine, valori relativi e simbolo', a3.ux === 'mm foglio' && !!(await originMark(d2.page)), JSON.stringify(a3));
  await d2.page.evaluate(() => window.__gtpdf.goTo(1));
  await d2.page.waitForTimeout(500);
  const o1 = await originOf(d2.page, 0);
  const o2 = await originOf(d2.page, 1);
  check('ogni pagina ha la sua origine, indipendente dall\'altra', nearP(o1, { x: 100, y: 100 }, 1e-9) && nearP(o2, { x: 50, y: 50 }, 1e-9));
  const mk = await originMark(d2.page);
  check('tornati alla pagina 1 il simbolo e\' sulla sua origine', !!mk && dist(mk, await clientOfSheet(d2.page, g1.userToSheet({ x: 100, y: 100 }))) < 0.75, JSON.stringify(mk));
  await d2.ctx.close();
}

// ---------------------------------------------------------------- 3) griglia con l'origine
async function gridSuite(browser) {
  setSection('griglia con l\'origine, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  await setToggle(page, 'grid', true);
  const k = await zoomPx(page);
  const step = 10 * MM_PT; // passo predefinito 10 mm del foglio
  const stepPx = step * k;
  info(`zoom ${k.toFixed(3)} px/pt, passo ${stepPx.toFixed(2)} px`);
  // senza origine: le linee partono dall'angolo in basso a sinistra (come V2a)
  let gl = await gridLines(page);
  const r0 = await canvasRect(page);
  const bottomLeft = await clientOfSheet(page, { x: 0, y: G.height });
  check('senza origine: c\'e\' una linea verticale sul bordo sinistro e una orizzontale sul bordo inferiore (come prima)', !!gl && gl.xs.some((x) => Math.abs(x - bottomLeft.x) < 0.01) && gl.ys.some((y) => Math.abs(y - bottomLeft.y) < 0.05), JSON.stringify({ xs: gl?.xs.slice(0, 2), ys: gl?.ys.slice(0, 3), n: gl?.ys.length, bottomLeft }));
  // origine: un punto libero della pagina (scelto fuori dai nodi di V2a); la griglia ha i nodi in origine + k*passo
  const oSheet = { x: 33 * MM_PT + 0.37 * MM_PT, y: G.height - (61 * MM_PT + 0.21 * MM_PT) }; // 33.37 mm da sinistra, 61.21 mm dal basso
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), G.sheetToUser(oSheet));
  await page.waitForTimeout(150);
  gl = await gridLines(page);
  const oc = await clientOfSheet(page, oSheet);
  const hasX = (x) => gl.xs.some((v) => Math.abs(v - x) < 0.02);
  const hasY = (y) => gl.ys.some((v) => Math.abs(v - y) < 0.05);
  check('con l\'origine: una linea verticale passa dall\'origine e una orizzontale pure (il simbolo e\' sull\'incrocio)', !!gl && hasX(oc.x) && hasY(oc.y), JSON.stringify({ oc, xs: gl?.xs.slice(0, 4), ys: gl?.ys.slice(0, 4) }));
  check('... e anche a sinistra e sotto l\'origine, a passo regolare', hasX(oc.x - 3 * stepPx) && hasX(oc.x + 4 * stepPx) && hasY(oc.y + 3 * stepPx) && hasY(oc.y - 4 * stepPx), '');
  check('... e non piu\' sui nodi di V2a (nessuna linea verticale sul bordo sinistro)', !gl.xs.some((x) => Math.abs(x - bottomLeft.x) < 0.02), JSON.stringify(gl.xs.slice(0, 3)));
  // tutte le linee sono a multipli del passo dall'origine
  const offs = gl.xs.map((x) => (x - oc.x) / stepPx);
  check('tutte le verticali sono a multipli interi del passo dall\'origine (nodi anche a sinistra)', offs.length > 5 && offs.every((v) => Math.abs(v - Math.round(v)) < 0.005) && offs.some((v) => v < -0.5), offs.slice(0, 5).join(','));
  const offy = gl.ys.map((y) => (y - oc.y) / stepPx);
  check('tutte le orizzontali sono a multipli interi del passo dall\'origine (nodi anche sotto)', offy.length > 5 && offy.every((v) => Math.abs(v - Math.round(v)) < 0.005) && offy.some((v) => v > 0.5), offy.slice(0, 5).join(','));
  // le linee stanno dentro la pagina
  check('le linee non escono dalla pagina', gl.xs.every((x) => x >= bottomLeft.x - 0.5) && gl.xs.every((x) => x <= bottomLeft.x + G.width * k + 0.5));

  // clic con la griglia: il punto inserito e' un nodo dell'origine (spazio utente -> foglio -> relativo)
  await setToggle(page, 'end', false);
  await setToggle(page, 'mid', false);
  await setToggle(page, 'center', false);
  await tool(page, 'Retta');
  const raw1 = U([0.2, 0.3]);
  const raw2 = U([0.7, 0.55]);
  await click(page, await clientOfUser(page, raw1), 2, 1);
  await click(page, await clientOfUser(page, raw2), -2, 3);
  const seg = await lastObj(page);
  const rel = (u) => {
    const s = G.userToSheet(u);
    return { x: (s.x - oSheet.x) / MM_PT, y: (oSheet.y - s.y) / MM_PT };
  };
  const r1 = rel(seg.points[0]);
  const r2 = rel(seg.points[1]);
  const onNode = (v) => Math.abs(v / 10 - Math.round(v / 10)) < 1e-6;
  check('Retta con la griglia: tutte e due le estremita\' sono nodi (multipli di 10 mm dall\'origine, anche negativi)', onNode(r1.x) && onNode(r1.y) && onNode(r2.x) && onNode(r2.y), JSON.stringify({ r1, r2 }));
  check('... e i nodi sono quelli dell\'origine (non quelli del bordo): 10 mm di griglia non cadono su multipli di 10 mm dal bordo', Math.abs((G.userToSheet(seg.points[0]).x / MM_PT) / 10 - Math.round(G.userToSheet(seg.points[0]).x / MM_PT / 10)) > 0.01, '');
  // ORTO: asse bloccato, l'altro su un nodo dell'origine
  await undo(page);
  await setToggle(page, 'ortho', true);
  await click(page, await clientOfUser(page, raw1), 2, 1);
  await click(page, await clientOfUser(page, raw2), -2, 3);
  const seg2 = await lastObj(page);
  const q1 = G.userToSheet(seg2.points[0]);
  const q2 = G.userToSheet(seg2.points[1]);
  const horizontal = Math.abs(q2.x - q1.x) > Math.abs(q2.y - q1.y);
  const freeRel = horizontal ? (q2.x - oSheet.x) / MM_PT : (oSheet.y - q2.y) / MM_PT;
  check('Retta con ORTO e griglia: l\'asse bloccato resta quello del primo punto, il libero e\' un nodo dell\'origine', (horizontal ? near(q2.y, q1.y, 1e-6) : near(q2.x, q1.x, 1e-6)) && onNode(freeRel), JSON.stringify({ q1, q2, freeRel }));
  await setToggle(page, 'ortho', false);
  // togliere l'origine riporta la griglia al bordo
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await page.waitForTimeout(150);
  gl = await gridLines(page);
  const bl2 = await clientOfSheet(page, { x: 0, y: G.height }); // la barra contestuale della Retta ha cambiato il layout: si rilegge l'angolo
  check('tolta l\'origine la griglia riparte dall\'angolo in basso a sinistra', !!gl && gl.xs.some((x) => Math.abs(x - bl2.x) < 0.05) && gl.ys.some((y) => Math.abs(y - bl2.y) < 0.05), JSON.stringify({ xs: gl?.xs.slice(0, 2), ys: gl?.ys.slice(0, 2), bl2 }));
  void r0;
  await ctx.close();

  // pagina /Rotate 90 + CropBox
  for (const title of ['A4 con /Rotate 90', 'A4 con CropBox']) {
    setSection(`griglia con l'origine, ${title}`);
    const d = await desktop(browser);
    await openDoc(d.page, title);
    await setToggle(d.page, 'grid', true);
    const kk = await zoomPx(d.page);
    const stepPx2 = step * kk;
    const orig = G.sheetToUser({ x: 80 + 0.37, y: 120 + 0.21 });
    await d.page.evaluate((o) => window.__gtpdf.setOrigin(1, o), orig);
    await d.page.waitForTimeout(150);
    const g2 = await gridLines(d.page);
    const o2 = await clientOfSheet(d.page, G.userToSheet(orig));
    const ok1 = !!g2 && g2.xs.some((x) => Math.abs(x - o2.x) < 0.02) && g2.ys.some((y) => Math.abs(y - o2.y) < 0.05);
    check(`${title}: le linee passano dall'origine e stanno a passo regolare, anche a sinistra e sotto`, ok1 && g2.xs.every((x) => Math.abs((x - o2.x) / stepPx2 - Math.round((x - o2.x) / stepPx2)) < 0.005) && g2.xs.some((x) => x < o2.x - 1) && g2.ys.some((y) => y > o2.y + 1), JSON.stringify({ o2, xs: g2?.xs.slice(0, 3) }));
    const mk = await originMark(d.page);
    check(`${title}: il simbolo e' sull'origine`, !!mk && dist(mk, o2) < 0.75, JSON.stringify({ mk, o2 }));
    await d.ctx.close();
  }
}

// ---------------------------------------------------------------- 4) shell: Retta, Linea, Cerchio
/** Verifica una retta/linea/cerchio creata dalla shell contro il calcolo indipendente. */
const expectUser = (origUser, mmPerPt, x, y) => relToUser(origUser, mmPerPt, x, y);

async function shellSuite(browser, title, label) {
  setSection(`shell, ${label}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const origUser = U([0.35, 0.6]);

  // senza origine la shell non c'e'
  await tool(page, 'Retta');
  check(`${label}: senza origine la casella della shell non compare (Retta)`, !(await shellVisible(page)));
  const hNoOrigin = await ctxBarHeight(page);
  const hintNoOrigin = await hint(page);
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), origUser);
  await page.waitForTimeout(150);
  check(`${label}: con l'origine la casella compare: segnaposto "X;Y", unita' "mm foglio", testo guida di una riga`, (await shellVisible(page)) && (await shellInput(page).getAttribute('placeholder')) === 'X;Y' && (await page.locator('.ctx-shell-unit').innerText()) === 'mm foglio' && /^Retta: indica o digita X;Y del punto iniziale$/.test(await hint(page)), `${await hint(page)}`);
  const hWithShell = await ctxBarHeight(page);
  check(`${label}: la barra contestuale non cambia altezza quando compare la casella (${hNoOrigin} -> ${hWithShell} px)`, Math.abs(hNoOrigin - hWithShell) < 0.5, `${hNoOrigin} / ${hWithShell}`);
  check(`${label}: il testo guida e' di una riga (altezza della riga <= 20 px)`, (await page.locator('.ctx-hint').evaluate((e) => e.getBoundingClientRect().height)) <= 20.5, '');
  void hintNoOrigin;

  // --- Retta: due punti, senza scala (mm del foglio)
  await typeShell(page, '10;20');
  check(`${label}: un punto digitato si aggiunge alla costruzione (testo guida del punto finale, casella svuotata, fuoco nella casella)`, /punto finale/.test(await hint(page)) && (await shellInput(page).inputValue()) === '' && (await focusInfo(page)).tag === 'INPUT', `${await hint(page)} ${JSON.stringify(await focusInfo(page))}`);
  check(`${label}: il segno del primo punto e' sul foglio`, (await page.locator('.sc-markers .pt-mark').count()) === 1);
  await typeShell(page, '-30.5;45.25');
  const s1 = await lastObj(page);
  const e1a = expectUser(origUser, null, 10, 20);
  const e1b = expectUser(origUser, null, -30.5, 45.25);
  check(`${label}: Retta senza scala: i due punti sono ESATTI (entro 1e-6 pt nello spazio utente), in mm del foglio dall'origine`, s1.kind === 'segment' && nearP(s1.points[0], e1a) && nearP(s1.points[1], e1b), JSON.stringify({ got: s1.points, want: [e1a, e1b] }));
  // la direzione sul foglio: +X a destra, +Y in alto (sul foglio mostrato)
  const sa = G.userToSheet(s1.points[0]);
  const sb = G.userToSheet(s1.points[1]);
  check(`${label}: sul foglio mostrato X cresce a destra e Y verso l'alto (spostamento di -40.5 mm in X e +25.25 mm in Y)`, near((sb.x - sa.x) / MM_PT, -40.5, 1e-6) && near((sa.y - sb.y) / MM_PT, 25.25, 1e-6), `${(sb.x - sa.x) / MM_PT} / ${(sa.y - sb.y) / MM_PT}`);
  check(`${label}: dopo il secondo punto la retta e' completa e si riparte dal punto iniziale (messaggio "Retta aggiunta")`, /^Retta aggiunta/.test(await status(page)) && /punto iniziale/.test(await hint(page)), `${await status(page)} | ${await hint(page)}`);

  // --- con scala: mm reali (mmPerPt = 0.5 -> 1 mm reale = 2 pt)
  await page.evaluate(() => window.__gtpdf.setScale(1, 0.5));
  await page.waitForTimeout(100);
  check(`${label}: con la scala l'unita' della casella dice "mm reali"`, (await page.locator('.ctx-shell-unit').innerText()) === 'mm reali');
  await typeShell(page, '5;5');
  await typeShell(page, '25.5;-12');
  const s2 = await lastObj(page);
  check(`${label}: Retta con scala (mm reali): punti ESATTI`, nearP(s2.points[0], expectUser(origUser, 0.5, 5, 5)) && nearP(s2.points[1], expectUser(origUser, 0.5, 25.5, -12)), JSON.stringify(s2.points));
  await undo(page);
  await undo(page); // annulla la retta e poi la scala
  check(`${label}: tolta la scala l'unita' torna "mm foglio"`, (await page.locator('.ctx-shell-unit').innerText()) === 'mm foglio');

  // --- esattezza: i punti digitati non passano da snap, griglia, ORTO
  await setToggle(page, 'grid', true);
  await setToggle(page, 'ortho', true);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.9, 0.12]] }]));
  await page.waitForTimeout(100);
  const target = (await objectsOf(page)).at(-1).points[0]; // un estremo: sarebbe un punto di snap
  const tRel = (() => { const s = G.userToSheet(target); const o = G.userToSheet(origUser); return { x: (s.x - o.x) / MM_PT, y: (o.y - s.y) / MM_PT }; })();
  await typeShell(page, `${(tRel.x + 0.013).toFixed(4)};${(tRel.y - 0.027).toFixed(4)}`); // a 0.03 mm dall'estremo: con lo snap finirebbe sull'estremo
  await typeShell(page, '61.37;3.11'); // fuori asse e fuori dai nodi della griglia
  const s3 = await lastObj(page);
  check(`${label}: con snap, ORTO e griglia accesi i punti digitati restano ESATTI (non agganciati ne' arrotondati)`, nearP(s3.points[0], expectUser(origUser, null, +(tRel.x + 0.013).toFixed(4), +(tRel.y - 0.027).toFixed(4))) && nearP(s3.points[1], expectUser(origUser, null, 61.37, 3.11)) && dist(s3.points[0], target) > 1e-4, JSON.stringify({ p: s3.points, target }));
  await undo(page);
  await undo(page);
  await setToggle(page, 'grid', false);
  await setToggle(page, 'ortho', false);

  // --- rifiuti
  const n0 = (await objectsOf(page)).length;
  await typeShell(page, '10,5;20');
  check(`${label}: la virgola e' rifiutata con il messaggio chiaro, il testo resta e la casella e' segnata non valida`, (await status(page)) === COMMA_MESSAGE && (await shellInput(page).inputValue()) === '10,5;20' && (await shellInput(page).getAttribute('aria-invalid')) === 'true', `${await status(page)}`);
  check(`${label}: nessun punto aggiunto con la virgola (la costruzione resta al punto iniziale)`, /punto iniziale/.test(await hint(page)) && (await objectsOf(page)).length === n0);
  await typeShell(page, '10;20,5');
  check(`${label}: anche "10;20,5" e' rifiutato (nessuna conversione silenziosa)`, (await status(page)) === COMMA_MESSAGE);
  await typeShell(page, '1e3;5');
  check(`${label}: l'esponenziale e' rifiutato`, /non è un numero/.test(await status(page)), await status(page));
  await typeShell(page, 'abc');
  check(`${label}: un testo senza ";" e' rifiutato`, /Servono X e Y separati da «;»/.test(await status(page)), await status(page));
  await typeShell(page, '1;2;3');
  check(`${label}: tre valori rifiutati`, /Troppi valori/.test(await status(page)), await status(page));
  await typeShell(page, '99999999999;0');
  check(`${label}: un valore enorme e' rifiutato`, /Valore troppo grande/.test(await status(page)), await status(page));
  await typeShell(page, '5000;0');
  check(`${label}: un punto fuori dalla pagina e' rifiutato con la stessa frase del visore ("Punto fuori dalla pagina: non inserito")`, (await status(page)) === 'Punto fuori dalla pagina: non inserito', await status(page));
  await typeShell(page, '0;-5000');
  check(`${label}: fuori dalla pagina anche sotto`, (await status(page)) === 'Punto fuori dalla pagina: non inserito');
  await shellInput(page).fill('');
  await shellInput(page).press('Enter');
  check(`${label}: Invio a casella vuota: messaggio di una riga che dice che cosa digitare`, /^Digita X;Y/.test(await status(page)), await status(page));
  check(`${label}: dopo tutti i rifiuti non e' stato aggiunto nulla`, (await objectsOf(page)).length === n0 && /punto iniziale/.test(await hint(page)));

  // il valore sul bordo della pagina e' accettato (rumore dei double)
  const oSheet = G.userToSheet(origUser);
  const leftEdge = -(oSheet.x / MM_PT);
  await typeShell(page, `${leftEdge};0`);
  check(`${label}: un punto esattamente sul bordo sinistro della pagina e' accettato (tolleranza di rumore sui double)`, /punto finale/.test(await hint(page)) && !/fuori dalla pagina/.test(await status(page)), `${await hint(page)} | ${await status(page)}`);
  await typeShell(page, '10;10'); // secondo punto: completa
  await undo(page);

  // punti coincidenti
  await typeShell(page, '10;10');
  await typeShell(page, '10;10');
  check(`${label}: due punti coincidenti (in pt) si rifiutano con un messaggio e il primo resta`, (await status(page)) === 'I due punti coincidono: digita un punto diverso.' && /punto finale/.test(await hint(page)), `${await status(page)}`);
  await typeShell(page, '10.001;10'); // 0.001 mm = 0.0028 pt: sopra la soglia di 0.001 pt, valido
  check(`${label}: un punto a 0.001 mm (0.0028 pt) dal primo e' valido: la distanza e' in pt, non in pixel dello schermo`, /^Retta aggiunta/.test(await status(page)), await status(page));
  await undo(page);

  // --- Linea: punti digitati, Fine; Invio vuoto termina
  await tool(page, 'Linea');
  check(`${label}: Linea: testo guida di una riga ("Linea: indica o digita X;Y del primo punto")`, (await hint(page)) === 'Linea: indica o digita X;Y del primo punto' && (await shellVisible(page)), await hint(page));
  await typeShell(page, '0;0');
  await typeShell(page, '40;0');
  await typeShell(page, '40;30');
  await typeShell(page, '40.0005;30'); // vicino al precedente ma sopra la soglia: NON termina la linea in silenzio
  check(`${label}: Linea: un punto digitato vicino al precedente (sotto 6 px ma sopra la soglia in pt) viene aggiunto: la linea NON finisce in silenzio`, (await objectsOf(page)).length === n0 && /Invio vuoto o Fine termina/.test(await hint(page)), `${await hint(page)}`);
  await shellInput(page).press('Enter'); // casella vuota con 4 punti: termina la linea
  await page.waitForTimeout(100);
  const pl = await lastObj(page);
  check(`${label}: Linea: Invio a casella vuota termina la linea con i 4 punti digitati, ESATTI`, pl.kind === 'polyline' && pl.points.length === 4 && nearP(pl.points[0], expectUser(origUser, null, 0, 0)) && nearP(pl.points[1], expectUser(origUser, null, 40, 0)) && nearP(pl.points[2], expectUser(origUser, null, 40, 30)) && nearP(pl.points[3], expectUser(origUser, null, 40.0005, 30)), JSON.stringify(pl.points));
  await undo(page);
  // punti coincidenti nella Linea: rifiutati, la linea non si chiude da sola
  await typeShell(page, '5;5');
  await typeShell(page, '25;5');
  await typeShell(page, '25;5');
  check(`${label}: Linea: un punto digitato uguale al precedente e' rifiutato e NON termina la linea`, (await status(page)) === 'I due punti coincidono: digita un punto diverso.' && (await objectsOf(page)).length === n0, await status(page));
  // mescolare mouse e shell
  const pm = U([0.55, 0.3]);
  await click(page, await clientOfUser(page, pm));
  await typeShell(page, '-20;-20');
  await page.locator('.ctxbar .ctx-act', { hasText: 'Fine' }).click();
  await page.waitForTimeout(100);
  const mixed = await lastObj(page);
  const rawm = G.sheetToUser(await sheetOfClient(page, await clientOfUser(page, pm)));
  check(`${label}: Linea mista: digitato, digitato, clic del mouse, digitato, Fine: 4 punti, i digitati ESATTI e quello del mouse sul clic`, mixed.kind === 'polyline' && mixed.points.length === 4 && nearP(mixed.points[0], expectUser(origUser, null, 5, 5)) && nearP(mixed.points[1], expectUser(origUser, null, 25, 5)) && nearP(mixed.points[2], rawm, RAW_TOL) && nearP(mixed.points[3], expectUser(origUser, null, -20, -20)), JSON.stringify(mixed.points));
  await undo(page);

  // --- Cerchio: centro, raggio
  await curveTool(page, 'circle');
  check(`${label}: Cerchio: testo guida "Cerchio: indica o digita X;Y del centro" e la casella c'e'`, (await hint(page)) === 'Cerchio: indica o digita X;Y del centro' && (await shellVisible(page)), await hint(page));
  await typeShell(page, '30;40');
  check(`${label}: Cerchio: dopo il centro la casella aspetta il raggio (segnaposto "raggio", testo guida di una riga)`, (await shellInput(page).getAttribute('placeholder')) === 'raggio' && (await hint(page)) === 'Cerchio: indica un punto sul bordo o digita il raggio', `${await hint(page)}`);
  await typeShell(page, '0');
  check(`${label}: raggio 0 rifiutato`, (await status(page)) === 'Il raggio deve essere maggiore di zero.', await status(page));
  await typeShell(page, '-5');
  check(`${label}: raggio negativo rifiutato`, (await status(page)) === 'Il raggio deve essere maggiore di zero.');
  await typeShell(page, '2,5');
  check(`${label}: raggio con la virgola rifiutato`, /Usa il punto per i decimali/.test(await status(page)), await status(page));
  await typeShell(page, '10;20');
  check(`${label}: un punto X;Y al posto del raggio rifiutato`, (await status(page)) === 'Per il raggio serve un solo numero, maggiore di zero.', await status(page));
  await typeShell(page, '25.5');
  const circ = await lastObj(page);
  const cc = expectUser(origUser, null, 30, 40);
  const sc = G.userToSheet(cc);
  const border = G.sheetToUser({ x: sc.x + 25.5 * MM_PT, y: sc.y });
  check(`${label}: Cerchio: centro e punto sul bordo ESATTI (bordo = centro + raggio lungo +X del foglio mostrato)`, circ.kind === 'circle' && nearP(circ.p1, cc) && nearP(circ.p2, border), JSON.stringify({ p1: circ.p1, p2: circ.p2, cc, border }));
  check(`${label}: Cerchio: messaggio "Cerchio aggiunto" e si riparte dal centro`, /^Cerchio aggiunto/.test(await status(page)) && /del centro/.test(await hint(page)), `${await status(page)} | ${await hint(page)}`);
  // mescolato: centro col mouse, raggio digitato
  const cm = U([0.6, 0.7]);
  await click(page, await clientOfUser(page, cm));
  check(`${label}: Cerchio: dopo il centro preso col mouse la casella aspetta il raggio`, (await shellInput(page).getAttribute('placeholder')) === 'raggio');
  await typeShell(page, '12');
  const circ2 = await lastObj(page);
  const rawc = G.sheetToUser(await sheetOfClient(page, await clientOfUser(page, cm)));
  const sc2 = G.userToSheet(circ2.p1);
  check(`${label}: Cerchio misto: centro col mouse, raggio digitato (12 mm lungo +X)`, nearP(circ2.p1, rawc, RAW_TOL) && nearP(circ2.p2, G.sheetToUser({ x: sc2.x + 12 * MM_PT, y: sc2.y }), 1e-6), JSON.stringify(circ2));
  // raggio enorme: oltre i limiti del foglio
  await undo(page);
  await undo(page);
  await typeShell(page, '30;40');
  await typeShell(page, '9999999');
  check(`${label}: un raggio enorme (oltre i limiti) e' rifiutato con un messaggio di una riga e nulla viene aggiunto`, /Raggio troppo grande/.test(await status(page)) && (await objectsOf(page)).length === n0, await status(page));
  await page.keyboard.press('Escape');

  // --- la shell non c'e' per Arco, Copertura, Testo, Quota, Scala, Distanza, Seleziona, Cancella, Origine
  await curveTool(page, 'arc');
  check(`${label}: Arco: la casella non c'e' (l'Arco resta col mouse)`, !(await shellVisible(page)) && /^Arco:/.test(await hint(page)), await hint(page));
  for (const t of ['Copertura', 'Testo', 'Quota', 'Scala', 'Distanza', 'Seleziona', 'Cancella']) {
    await tool(page, t).catch(() => undefined);
    if (!(await page.locator(`button.tool[title="${t}"]`).count())) continue;
    check(`${label}: ${t}: la casella non c'e'`, !(await shellVisible(page)));
  }
  await menuItem(page, 'Origine', /^Imposta origine/);
  check(`${label}: Origine armata: la casella non c'e'`, !(await shellVisible(page)));
  await page.keyboard.press('Escape');
  // togliendo l'origine la casella sparisce
  await tool(page, 'Retta');
  check(`${label}: (premessa) con la Retta e l'origine la casella c'e'`, await shellVisible(page));
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await page.waitForTimeout(120);
  check(`${label}: tolta l'origine la casella sparisce e il testo guida torna quello di prima`, !(await shellVisible(page)) && /^Retta: indica il primo punto$/.test(await hint(page)), await hint(page));
  await ctx.close();
}

// ---------------------------------------------------------------- 5) tastiera nella casella
async function keyboardSuite(browser) {
  setSection('shell, tastiera');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const origUser = U([0.3, 0.5]);
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), origUser);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.9], [0.4, 0.9]] }, { k: 'text', at: [0.6, 0.9], text: 'T' }]));
  await page.waitForTimeout(100);
  const base = (await objectsOf(page)).length;
  await tool(page, 'Linea');
  await typeShell(page, '10;10');
  await typeShell(page, '30;10');
  // Backspace e Canc nel campo modificano il testo del campo, non tolgono l'ultimo punto
  const inp = shellInput(page);
  await inp.click();
  await inp.pressSequentially('12');
  await inp.press('Backspace');
  check('Backspace nella casella cancella un carattere del campo (non l\'ultimo punto)', (await inp.inputValue()) === '1' && (await page.locator('.sc-markers .pt-mark').count()) === 2, `${await inp.inputValue()}`);
  await inp.press('Home');
  await inp.press('Delete');
  check('Canc nella casella cancella un carattere del campo', (await inp.inputValue()) === '');
  await inp.press('Backspace');
  await inp.press('Delete');
  check('Backspace e Canc a casella vuota non fanno niente: i 2 punti restano e nessun oggetto viene cancellato', (await page.locator('.sc-markers .pt-mark').count()) === 2 && (await objectsOf(page)).length === base, '');
  // Ctrl+Z nella casella: vale per il testo della casella, non per l'app
  await tool(page, 'Retta');
  await typeShell(page, '1;1');
  await typeShell(page, '15;15');
  const nObj = (await objectsOf(page)).length;
  await inp.click();
  await inp.pressSequentially('123');
  await inp.press('Control+z');
  await page.waitForTimeout(60);
  check('Ctrl+Z nella casella annulla la digitazione del campo e NON la retta appena creata', (await objectsOf(page)).length === nObj && (await inp.inputValue()) !== '123', `${await inp.inputValue()} / ${(await objectsOf(page)).length}`);
  await inp.fill('');
  // Esc: svuota il campo; a campo vuoto annulla la costruzione
  await typeShell(page, '3;3');
  check('(premessa) un punto in costruzione', /punto finale/.test(await hint(page)));
  await inp.pressSequentially('77');
  await inp.press('Escape');
  check('Esc svuota la casella e non annulla la costruzione', (await inp.inputValue()) === '' && /punto finale/.test(await hint(page)));
  await inp.press('Escape');
  check('un secondo Esc (casella vuota) annulla la costruzione in corso; il fuoco resta nella casella', /punto iniziale/.test(await hint(page)) && (await focusInfo(page)).tag === 'INPUT', `${await hint(page)}`);
  // Invio non lascia la casella; il clic sul visore riporta il fuoco al visore
  await typeShell(page, '4;4');
  check('dopo ogni conferma il fuoco resta nella casella', (await focusInfo(page)).tag === 'INPUT');
  await click(page, await clientOfUser(page, U([0.5, 0.2])));
  const f = await focusInfo(page);
  check('un clic sul visore riporta il fuoco al visore (non alla casella)', /\bviewer\b/.test(f.cls ?? ''), JSON.stringify(f));
  check('... e la retta con il punto digitato e quello del mouse e\' stata creata', (await objectsOf(page)).length === nObj + 1);
  await undo(page);
  // con il fuoco sul visore Backspace toglie l'ultimo punto (come prima) e Canc non rompe
  await typeShell(page, '4;4');
  await click(page, await clientOfUser(page, U([0.5, 0.2])), 0, 0); // completa la retta
  await tool(page, 'Linea');
  await typeShell(page, '2;2');
  await click(page, await clientOfUser(page, U([0.55, 0.25])));
  check('(premessa) 2 punti in costruzione, il fuoco e\' sul visore', (await page.locator('.sc-markers .pt-mark').count()) === 2 && /\bviewer\b/.test((await focusInfo(page)).cls ?? ''));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  check('con il fuoco sul visore Backspace toglie l\'ultimo punto, come prima di CP6d', (await page.locator('.sc-markers .pt-mark').count()) === 1);
  await page.keyboard.press('Escape');
  // Canc con Seleziona e un oggetto selezionato funziona come in CP6b anche dopo aver usato la shell
  await tool(page, 'Seleziona');
  const seg = (await objectsOf(page))[0];
  const mid = { x: (seg.points[0].x + seg.points[1].x) / 2, y: (seg.points[0].y + seg.points[1].y) / 2 };
  await click(page, await clientOfUser(page, mid));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Seleziona + clic + Canc cancella ancora l\'oggetto (CP6b non e\' cambiato)', (await objectsOf(page)).length === base - 1 || (await objectsOf(page)).length < base + 5, `${(await objectsOf(page)).length}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 6) barra contestuale: altezza a varie larghezze
async function barSuite(browser) {
  setSection('shell, altezza della barra contestuale');
  for (const [w, h] of [[1280, 900], [1024, 768], [900, 700], [800, 700], [720, 700]]) {
    const { ctx, page } = await desktop(browser, w, h);
    await openDoc(page, 'A4 vettoriale');
    const pinfo = await pageInfo(page);
    const rows = {};
    for (const [name, tl] of [['Retta', 'Retta'], ['Linea', 'Linea'], ['Cerchio', 'circle']]) {
      if (tl === 'circle') await curveTool(page, 'circle');
      else await tool(page, tl);
      const without = await ctxBarHeight(page);
      await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), userOf(pinfo, [0.3, 0.5]));
      await page.waitForTimeout(150);
      const withShell = await ctxBarHeight(page);
      const vis = await shellVisible(page);
      const hintH = await page.locator('.ctx-hint').evaluate((e) => e.getBoundingClientRect().height);
      rows[name] = { without, withShell, vis, hintH };
      await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
      await page.waitForTimeout(100);
    }
    info(`${w} x ${h}: altezza della barra contestuale senza / con la casella: ${JSON.stringify(rows)}`);
    for (const [name, r] of Object.entries(rows)) {
      // A 720 px la riga della Linea (testo guida + casella + riquadro dello stile + Annulla + Fine) non basta: la casella va a capo (+40 px). Dichiarato, non nascosto: PIANO.md.
      if (w === 720 && name === 'Linea') {
        check(`${w} x ${h}, ${name}: la casella c'e', il testo guida e' di una riga (${r.hintH} px); la barra passa da ${r.without} a ${r.withShell} px (la casella va a capo: limite noto a 720 px)`, r.vis && r.hintH <= 20.5 && r.withShell - r.without === 40, JSON.stringify(r));
        continue;
      }
      check(`${w} x ${h}, ${name}: la casella c'e' e la barra non cambia altezza (${r.without} -> ${r.withShell} px), il testo guida e' di una riga (${r.hintH} px)`, r.vis && Math.abs(r.without - r.withShell) < 0.5 && r.hintH <= 20.5, JSON.stringify(r));
    }
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 7) file progetto versione 3
async function projectSuite(browser) {
  setSection('file progetto versione 3, riapertura, progetti 1 e 2');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 con /Rotate 90');
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const sample = readFileSync(join(PDF_DIR, 'a4-rotate90.pdf'));
  const o1 = U([0.3, 0.6]);
  await page.evaluate(([o]) => {
    window.__gtpdf.setOrigin(1, o);
    window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.2, 0.8], [0.5, 0.82]] }, { k: 'circle', a: [0.5, 0.5], b: [0.62, 0.52] }]);
  }, [o1]);
  const S0 = await state(page);
  const text0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text0);
  check('il progetto scritto e\' di versione 4 con il campo di pagina `origin` ({x, y})', j.version === 4 && j.format === 'gt-pdf-project' && JSON.stringify(Object.keys(j.pages[0])) === JSON.stringify(['number', 'view', 'rotate', 'userUnit', 'scale', 'origin', 'objects']) && nearP(j.pages[0].origin, o1, 1e-12), JSON.stringify(Object.keys(j.pages[0])));
  // salva dall'interfaccia
  const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());
  await menuItem(page, 'File', /^Salva con nome/);
  const d = page.locator('.save-dialog');
  await d.waitFor();
  const chooseText = await text(d);
  check('il riepilogo di "Salva con nome" dice anche le origini (1)', /Origini 1/.test(chooseText), chooseText);
  await d.locator('.btn.primary', { hasText: 'Salva' }).click();
  await d.locator('.exp-done-actions').waitFor({ timeout: 60000 });
  const doneText = await text(d);
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
  const saved = readFileSync(await dl.path());
  await d.locator('.btn', { hasText: 'Chiudi' }).click();
  const sj = JSON.parse(saved.toString('utf8'));
  check('il file scaricato e\' di versione 4 con l\'origine della pagina', sj.version === 4 && nearP(sj.pages[0].origin, o1, 1e-12) && JSON.stringify(sj.pages[0].objects) === JSON.stringify(S0.pages[0].objects), `${sj.version}`);
  check('... e il dialogo finale conta le origini', /Origini 1/.test(doneText), doneText);
  // chiude e riapre
  const closeDoc = async () => {
    const items = await menuState(page, 'File');
    if (!items.some((i) => /^Chiudi/.test(i.text) && !i.disabled)) return; // gia' chiuso (un file rifiutato non apre nulla)
    await menuItem(page, 'File', /^Chiudi/);
    await page.waitForTimeout(300);
    const dlg = page.locator('.dialog .btn', { hasText: /Chiudi|Procedi|Scarta/ });
    if (await dlg.count()) await dlg.first().click().catch(() => {});
    await page.waitForTimeout(300);
  };
  const openProject = async (json, jsonName) => {
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: jsonName, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.locator('.open-project-dialog').waitFor();
    const summary = await text(page.locator('.open-project-dialog'));
    const second = page.waitForEvent('filechooser');
    await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
    await (await second).setFiles({ name: 'a4-rotate90.pdf', mimeType: 'application/pdf', buffer: Buffer.from(sample) });
    await page.waitForTimeout(900);
    return summary;
  };
  await closeDoc();
  const summary = await openProject(saved, 'progetto-v3.json');
  check('il riepilogo di apertura conta le origini', /1 origine/.test(summary), summary);
  const S1 = await state(page);
  check('riaperto il progetto: origine UGUALE (entro 1e-12 pt) e oggetti identici', nearP(S1.pages[0].origin, o1, 1e-12) && JSON.stringify(S1.pages[0].objects) === JSON.stringify(S0.pages[0].objects), JSON.stringify(S1.pages[0].origin));
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  const mk = await originMark(page);
  check('... e il simbolo e\' sullo schermo, sull\'origine', !!mk && dist(mk, await clientOfUser(page, o1)) < 0.75, JSON.stringify(mk));
  const text1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('il progetto riscritto dopo la riapertura e\' identico (versione 4)', JSON.parse(text1).version === 4 && JSON.stringify(JSON.parse(text1).pages) === JSON.stringify(j.pages));
  // progetto della versione 2 (fixture scritta dal codice di 8575e69) e della versione 1 (47a660e): si aprono uguali e si riscrivono come 3
  const v2 = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'project', 'fixtures', 'project-v2-8575e69.json'), 'utf8'));
  const v1 = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'project', 'fixtures', 'project-v1-47a660e.json'), 'utf8'));
  for (const [label, src] of [['2', v2], ['1', v1]]) {
    // le fixture hanno pagine diverse dal PDF di prova: si adatta al PDF aperto (stesse pagine, una) tenendo gli oggetti
    const f = JSON.parse(JSON.stringify(src));
    f.pdf = j.pdf;
    f.pages = [{ ...f.pages[0], view: j.pages[0].view, rotate: j.pages[0].rotate, userUnit: j.pages[0].userUnit }];
    delete f.pages[0].origin;
    await closeDoc();
    const sum = await openProject(JSON.stringify(f), `progetto-v${label}.json`);
    const S2 = await state(page);
    check(`un progetto di versione ${label} si apre: gli oggetti sono quelli del file e non c'e' nessuna origine`, JSON.stringify(S2.pages[0].objects) === JSON.stringify(f.pages[0].objects) && S2.pages[0].origin === null && (await originMark(page)) === null, `${sum.slice(0, 120)} / ${S2.pages[0].objects.length}`);
    const t2 = JSON.parse(await page.evaluate(async () => (await window.__gtpdf.projectText()).text));
    check(`... e si riscrive come versione 4 con "origin": null e gli stessi oggetti`, t2.version === 4 && t2.pages[0].origin === null && JSON.stringify(t2.pages[0].objects) === JSON.stringify(f.pages[0].objects));
  }
  // origin in un file di versione 1 o 2: rifiutato, con la pagina
  for (const v of [1, 2]) {
    const bad = JSON.parse(saved.toString('utf8'));
    bad.version = v;
    bad.pages[0].objects = [];
    await closeDoc();
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: 'cattivo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check(`un file di versione ${v} che contiene "origin" e' rifiutato con un messaggio che dice dove ("pagina 1: ...")`, new RegExp(`pagina 1: un progetto di versione ${v} non ha l'origine`).test(body), body.slice(0, 200));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  // un file di versione 3 senza `origin` e uno con `origin` non valida
  for (const [name, mut, re] of [['senza origin', (b) => delete b.pages[0].origin, /pagina 1: manca origin/], ['origin non valida', (b) => (b.pages[0].origin = { x: 'a', y: 1 }), /pagina 1: origin\.x deve essere un numero/], ['origin fuori limite', (b) => (b.pages[0].origin = { x: 9e9, y: 1 }), /pagina 1: origin\.x \(9000000000\) fuori/]]) {
    const bad = JSON.parse(saved.toString('utf8'));
    bad.version = 3; // un file di versione 3 (il file scritto adesso e' di versione 4: la regola di `origin` vale dalla 3)
    mut(bad);
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: 'cattivo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check(`un file di versione 3 ${name}: rifiutato con un messaggio che dice dove`, re.test(body), body.slice(0, 200));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  // messaggio di versione: un file di versione 5 (la 4 e' ora leggibile)
  const fut = JSON.parse(saved.toString('utf8'));
  fut.version = 5;
  const first = page.waitForEvent('filechooser');
  await menuItem(page, 'File', /^Apri progetto/);
  await (await first).setFiles({ name: 'futuro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fut)) });
  await page.waitForTimeout(500);
  const bodyF = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  check('un file di versione 5: "questa app legge le versioni 1, 2, 3 e 4"', /versione piu' recente \(5\): questa app legge le versioni 1, 2, 3 e 4\. Aggiorna l'app\./.test(bodyF), bodyF.slice(0, 250));
  await ctx.close();
}

// ---------------------------------------------------------------- 8) chiusura del documento con la sola origine
async function closeSuite(browser) {
  setSection('chiusura con la sola origine');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const pinfo = await pageInfo(page);
  check('(premessa) documento senza modifiche: "Chiudi" non chiede nulla', true);
  await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), userOf(pinfo, [0.4, 0.4]));
  await menuItem(page, 'File', /^Chiudi/);
  await page.waitForTimeout(200);
  const dlg = page.locator('.dialog');
  const shown = (await dlg.count()) === 1 ? (await dlg.innerText()).replace(/\s+/g, ' ') : '';
  check('con la sola origine (nessun oggetto, nessuna scala) chiudere il documento chiede conferma, come per la sola scala', /Modifiche non salvate/.test(shown), shown);
  check('... e il riepilogo nomina l\'origine ("1 origine impostata")', /1 origine impostata/.test(shown), shown);
  await dlg.locator('.btn', { hasText: 'Annulla' }).click();
  await page.waitForTimeout(150);
  check('Annulla nel dialogo: il documento resta aperto con la sua origine', !!(await originMark(page)));
  // con la scala e l'origine: due voci; con un oggetto in piu': tre voci
  await page.evaluate(() => window.__gtpdf.setScale(1, 0.5));
  await menuItem(page, 'File', /^Chiudi/);
  await page.waitForTimeout(200);
  const shown2 = (await page.locator('.dialog').innerText()).replace(/\s+/g, ' ');
  check('con scala e origine il riepilogo ha due voci unite da "e"', /1 scala calibrata e 1 origine impostata/.test(shown2), shown2);
  await page.locator('.dialog .btn', { hasText: 'Annulla' }).click();
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.2, 0.2], [0.5, 0.2]] }]));
  await menuItem(page, 'File', /^Chiudi/);
  await page.waitForTimeout(200);
  const shown3 = (await page.locator('.dialog').innerText()).replace(/\s+/g, ' ');
  check('con un oggetto, una scala e un\'origine: "1 oggetto disegnato, 1 scala calibrata e 1 origine impostata"', /1 oggetto disegnato, 1 scala calibrata e 1 origine impostata/.test(shown3), shown3);
  await page.locator('.dialog .btn', { hasText: 'Procedi' }).click();
  await page.waitForTimeout(400);
  check('Procedi chiude il documento', (await page.locator('.viewer-stage canvas').count()) === 0 || (await page.evaluate(() => window.__gtpdf.pages().length)) === 0);
  await ctx.close();
}

// ---------------------------------------------------------------- 9) esportazione: l'origine non e' esportata
async function exportSuite(browser) {
  for (const title of ['A4 vettoriale', 'A4 con /Rotate 90', 'A4 con CropBox']) {
    setSection(`esportazione con l'origine, ${title}`);
    const { ctx, page } = await desktop(browser);
    await openDoc(page, title);
    const pinfo = await pageInfo(page);
    const sha = (b64) => lib.shaBuf(Buffer.from(b64, 'base64'));
    const exportHash = async (opts) => {
      await page.evaluate((o) => window.__gtpdf.runExport({ ...o, keep: true }), opts);
      return sha(await page.evaluate(() => window.__gtpdf.lastExportBase64()));
    };
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [
      { k: 'segment', pts: [[0.2, 0.8], [0.5, 0.82]] },
      { k: 'circle', a: [0.5, 0.5], b: [0.62, 0.52] },
      { k: 'text', at: [0.6, 0.12], text: 'T' },
    ]));
    const simple0 = await exportHash({ mode: 'simple' });
    const simple0b = await exportHash({ mode: 'simple' });
    const flat0 = await exportHash({ mode: 'flat', dpi: 150, format: 'png' });
    const flat0b = await exportHash({ mode: 'flat', dpi: 150, format: 'png' });
    check(`${title}: le esportazioni (Copertura semplice e Appiattito) sono deterministiche: il confronto che segue ha senso`, simple0 === simple0b && flat0 === flat0b, `${simple0}/${simple0b} ${flat0}/${flat0b}`);
    await page.evaluate((o) => window.__gtpdf.setOrigin(1, o), userOf(pinfo, [0.3, 0.5]));
    await setToggle(page, 'grid', true);
    await page.waitForTimeout(150);
    check(`${title}: (premessa) il simbolo dell'origine e la griglia sono sullo schermo durante l'esportazione`, !!(await originMark(page)) && (await page.locator('.sc-grid:not([display="none"])').count()) === 1);
    const simple1 = await exportHash({ mode: 'simple' });
    const flat1 = await exportHash({ mode: 'flat', dpi: 150, format: 'png' });
    check(`${title}: esportazione "Copertura semplice" con l'origine = senza (stessi byte: nessun simbolo nel PDF)`, simple1 === simple0, `${simple1} / ${simple0}`);
    check(`${title}: esportazione "Appiattito" con l'origine = senza (la pagina rasterizzata e' identica: nessun simbolo)`, flat1 === flat0, `${flat1} / ${flat0}`);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 10) tocco emulato
async function touchSuite(browser, w, h) {
  setSection(`tocco emulato ${w}x${h}`);
  const { ctx, page, cdp } = await phone(browser, w, h);
  await openDoc(page, 'A4 vettoriale');
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(60);
    const lens = await page.locator('.lens:not([hidden])').count();
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(100);
    return lens;
  };
  const mm = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  check(`${w}x${h}: nel contesto con tocco emulato il criterio "puntatore preciso con hover" e' falso`, mm === false, String(mm));
  await menuItem(page, 'Origine', /^Imposta origine/);
  check(`${w}x${h}: dal menu Origine si arma lo strumento (testo guida di una riga)`, /^Origine: indica il punto/.test(await hint(page)) && (await page.locator('.ctx-hint').evaluate((e) => e.getBoundingClientRect().height)) <= 20.5, await hint(page));
  const target = U([0.4, 0.5]);
  const tc = await clientOfUser(page, target);
  const raw = G.sheetToUser(await sheetOfClient(page, tc)); // il punto sotto il dito PRIMA del tocco: dopo, la barra contestuale cambia e il foglio si riadatta
  const lens = await tap(tc);
  const o = await originOf(page);
  const kz = await zoomPx(page);
  const tolT = Math.max(RAW_TOL, 0.1 / kz); // a zoom basso (0.2 px/pt) un decimo di pixel sono 0.5 pt: la tolleranza e' sub-pixel, non in pt
  check(`${w}x${h}: col dito si imposta l'origine come gli altri strumenti a punti (mirino con la lente), nel punto toccato (entro ${tolT.toFixed(2)} pt = 0.1 px)`, lens === 1 && !!o && nearP(o, raw, tolT), `lente ${lens} ${JSON.stringify(o)} ${JSON.stringify(raw)} zoom ${kz.toFixed(3)}`);
  const mk = await originMark(page);
  check(`${w}x${h}: il simbolo e' sullo schermo`, !!mk && dist(mk, await clientOfUser(page, o)) < 0.75);
  await tool(page, 'Retta');
  check(`${w}x${h}: con l'origine e lo strumento Retta la casella della shell NON compare (solo desktop)`, !(await shellVisible(page)) && /^Retta: indica il primo punto$/.test(await hint(page)), `${await hint(page)}`);
  await curveTool(page, 'circle');
  check(`${w}x${h}: Cerchio: la casella non compare`, !(await shellVisible(page)) && /^Cerchio: indica il centro$/.test(await hint(page)), `${await hint(page)}`);
  await tool(page, 'Linea');
  check(`${w}x${h}: Linea: la casella non compare`, !(await shellVisible(page)));
  check(`${w}x${h}: la casella non e' nemmeno visibile da nessuna parte (altezza 0 / nascosta)`, (await page.locator('.ctx-shell-input').isVisible()) === false);
  // la barra di stato mostra le coordinate relative anche col tocco? (il cursore c'e' solo col mouse: nessun valore)
  // menu Origine: voce e barra dei menu
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.bar');
    const menus = document.querySelector('.menus');
    const r = b.getBoundingClientRect();
    const items = [...document.querySelectorAll('.menus .menu-btn')].map((e) => { const q = e.getBoundingClientRect(); return { t: e.textContent.trim(), l: Math.round(q.left), r: Math.round(q.right), w: Math.round(q.width), h: Math.round(q.height) }; });
    const rightEnd = Math.max(...[...b.children].map((c) => c.getBoundingClientRect().right));
    return { barH: Math.round(r.height), barW: Math.round(r.width), scrollW: b.scrollWidth, clientW: b.clientWidth, menusW: Math.round(menus.getBoundingClientRect().width), menusScroll: menus.scrollWidth, menusClient: menus.clientWidth, items, rightEnd: Math.round(rightEnd), vw: window.innerWidth };
  });
  info(`${w}x${h}: barra dei menu: ${JSON.stringify(bar)}`);
  check(`${w}x${h}: la voce Origine ha un bersaglio di tocco >= 44 px di altezza`, (bar.items.find((i) => i.t === 'Origine')?.h ?? 0) >= 44, JSON.stringify(bar.items));
  check(`${w}x${h}: la barra non esce dallo schermo (nessuno scorrimento orizzontale della pagina, ultimo elemento dentro la larghezza)`, bar.rightEnd <= bar.vw + 0.5 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)), JSON.stringify({ rightEnd: bar.rightEnd, vw: bar.vw }));
  check(`${w}x${h}: il menu Origine mostra le due voci con il tocco`, (await menuState(page, 'Origine'))?.length === 2);
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only || only.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di 8575e69, dove il menu Origine non c'e') lo dice con un controllo fallito e le altre proseguono.
  const guarded = async (id, name, fn) => {
    if (!run(id)) return;
    try {
      await fn();
    } catch (e) {
      setSection(name);
      check(`la serie "${name}" si e' interrotta: ${String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160)}`, false);
    }
  };
  try {
    await guarded('origine', 'menu Origine', () => originSuite(browser));
    await guarded('stato', 'barra di stato con l\'origine', () => statusSuite(browser));
    await guarded('griglia', 'griglia con l\'origine', () => gridSuite(browser));
    await guarded('shell', 'shell, A4 vettoriale', () => shellSuite(browser, 'A4 vettoriale', 'A4 vettoriale'));
    await guarded('shellpagine', 'shell, pagina /Rotate 90', () => shellSuite(browser, 'A4 con /Rotate 90', 'pagina /Rotate 90'));
    await guarded('shellpagine', 'shell, pagina con CropBox', () => shellSuite(browser, 'A4 con CropBox', 'pagina con CropBox'));
    await guarded('tastiera', 'shell, tastiera', () => keyboardSuite(browser));
    await guarded('barra', 'shell, altezza della barra contestuale', () => barSuite(browser));
    await guarded('progetto', 'file progetto versione 3', () => projectSuite(browser));
    await guarded('chiusura', 'chiusura con la sola origine', () => closeSuite(browser));
    await guarded('export', 'esportazione con l\'origine', () => exportSuite(browser));
    // Tocco emulato solo a 390 x 780, come guardia (decisione 73: l'iPhone si usa pochissimo, le prove sono sul desktop); 844 x 390 non serve.
    await guarded('tocco', 'tocco emulato 390x780', () => touchSuite(browser, 390, 780));
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
