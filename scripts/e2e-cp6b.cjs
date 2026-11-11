// Prove di CP6b su Chromium: (1) ORTO sul secondo punto di Quota allineata, Ø e R (non su orizzontale e verticale, non sul terzo punto); (2) Canc cancella l'oggetto
// selezionato con Seleziona. Mouse (desktop 1280 x 900, clic reali) e tocco emulato (iPhone 390 x 780, DPR 3, CDP).
// ORTO: il secondo punto inserito sta sulla stessa Y (o X) del primo SUL FOGLIO MOSTRATO (entro 1e-6 pt) anche con /Rotate 90 e CropBox; lo snap vince sull'ORTO; con la
// griglia si arrotonda solo l'asse libero; con ORTO spento il punto e' quello grezzo (come edbb650); orizzontale, verticale e terzo punto invariati.
// Canc: palette -> Seleziona -> clic sull'oggetto -> Delete; un solo passo di Annulla, Ripeti lo cancella di nuovo; guardie (nessuna selezione, focus in un campo o su un pulsante,
// dialogo aperto), Canc in costruzione e Backspace invariati; ogni tipo di oggetto; pagina /Rotate 90.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6b.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su edbb650 i controlli sul comportamento nuovo FALLISCONO)
// Chromium NON e' il browser dell'utente (Microsoft Edge sul PC): nulla di quanto segue prova il comportamento li'.
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6b', out: process.argv[2], port: 4207, hport: 4208, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel di getBoundingClientRect), non con un valore esatto. */
const RAW_TOL = 0.03;
const MM_PT = 72 / 25.4;

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
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
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
const DIM_BTN = { aligned: 'Allineata', horizontal: 'Orizz.', vertical: 'Vert.', diameter: 'Ø Diam.', radius: 'R Raggio' };
const dimType = async (page, type) => {
  await page.locator('.ctx-types button', { hasText: DIM_BTN[type] }).click();
  await page.waitForTimeout(150);
};
const toggle = (page, name) => page.locator(`.st-toggle[data-toggle="${name}"]`);
const pressed = async (page, name) => (await toggle(page, name).getAttribute('aria-pressed')) === 'true';
const setToggle = async (page, name, on) => {
  if ((await pressed(page, name)) !== on) await toggle(page, name).click();
  await page.waitForTimeout(80);
};
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);

/**
 * Geometria della pagina 1, calcolata qui da `pages()` (view, rotate, userUnit) con le stesse formule di `PageGeometry` (src/geometry/page.ts), come e2e-cp6a.cjs:
 * lo script non dipende da ganci nuovi e gira anche sul build di edbb650. Lo spazio utente ha l'origine in basso a sinistra, il foglio mostrato in alto a sinistra.
 */
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
/** Punto utente da frazioni (fx, fy) dell'area visibile (origine in basso a sinistra), come `addSpecs`. */
const userOf = (info, f) => ({ x: info.view[0] + f[0] * (info.view[2] - info.view[0]), y: info.view[1] + f[1] * (info.view[3] - info.view[1]) });
/** Posizione sullo schermo (client) di un punto utente / di un punto del foglio. */
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const clientOfUser = (page, u) => clientOfSheet(page, G.userToSheet(u));
/** Punto del foglio sotto una posizione dello schermo (grezzo, senza snap ne' vincoli). */
const sheetOfClient = async (page, c) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: (c.x - r.left) / k, y: (c.y - r.top) / k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Gli oggetti di prova (frazioni dell'area visibile, origine in basso a sinistra): lontani fra loro piu' di 40 px a ogni zoom usato. */
const SPEC = {
  segA: [[0.2, 0.8], [0.5, 0.8]],
  polyB: [[0.2, 0.55], [0.3, 0.65], [0.45, 0.55]],
  rectC: [[0.62, 0.55], [0.86, 0.75]],
  circD: [[0.72, 0.3], [0.8, 0.3]],
  dimE: [[0.2, 0.2], [0.5, 0.2], [0.35, 0.14]],
  textT: [0.62, 0.12],
  zeroZ: [0.9, 0.9],
};
/** Dove si clicca per scegliere ciascun oggetto di prova (frazioni dell'area visibile) e come si chiama nei messaggi. */
const PICKS = [
  { name: 'retta', kind: 'segment', f: [0.35, 0.8], msg: /^Retta cancellata\. Annulla la ripristina\.$/ },
  { name: 'linea', kind: 'polyline', f: [0.25, 0.6], msg: /^Linea cancellata\. Annulla la ripristina\.$/ },
  { name: 'copertura rettangolare', kind: 'cover', f: [0.74, 0.65], msg: /^Copertura cancellata\. Annulla la ripristina\.$/ },
  { name: 'copertura circolare', kind: 'cover', f: [0.72, 0.3], msg: /^Copertura cancellata\. Annulla la ripristina\.$/ },
  { name: 'quota', kind: 'dim', f: [0.27, 0.14], msg: /^Quota cancellata\. Annulla la ripristina\.$/ },
  { name: 'testo', kind: 'text', f: [0.62, 0.12], px: [2, -4], msg: /^Testo cancellato\. Annulla lo ripristina\.$/ },
];
const addSpecs = (page, withObjects = true) =>
  withObjects
    ? page.evaluate((S) => {
        window.__gtpdf.addSpecs(1, [
          { k: 'segment', pts: S.segA },
          { k: 'polyline', pts: S.polyB },
          { k: 'cover', shape: 'rect', a: S.rectC[0], b: S.rectC[1] },
          { k: 'cover', shape: 'circle', a: S.circD[0], b: S.circD[1] },
          { k: 'dim', dim: 'aligned', pts: S.dimE, value: '5' },
          { k: 'text', at: S.textT, text: 'T' },
          { k: 'segment', pts: [S.zeroZ, S.zeroZ] },
        ]);
      }, SPEC)
    : null;

async function openDoc(page, title = 'A4 vettoriale', withObjects = false) {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  if (withObjects) await addSpecs(page);
  await page.waitForTimeout(200);
}
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
/** Il mirino (aim-mark): posizione sullo schermo, o null se non si vede. */
const aimMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.aim-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    const svg = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)\s*\)/);
    return m ? { x: svg.left + +m[1], y: svg.top + +m[2] } : null;
  });
const snapMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    return { kind: g.dataset.kind, label: g.querySelector('text')?.textContent ?? null };
  });

/** Conferma la quota con il tastierino (scrive 5), se e' aperto. */
async function finishDim(page) {
  await page.waitForTimeout(120);
  if (!(await kbdOpen(page))) return false;
  await page.locator('.kp-key', { hasText: /^5$/ }).first().click();
  await page.locator('.kp-ok').click();
  await page.waitForTimeout(150);
  return true;
}
const lastObj = async (page) => {
  const o = await objectsOf(page);
  return o[o.length - 1];
};
/** Scarta quota e tastierino (Annulla del tastierino) se aperti. */
async function dropEntry(page) {
  if (await kbdOpen(page)) {
    await page.locator('.kp-cancel').click();
    await page.waitForTimeout(100);
  }
}

// ---------------------------------------------------------------- 1) ORTO sulle quote, con il mouse
/**
 * Inserisce una quota del tipo `type` con clic del mouse: `clicks` sono le posizioni sullo schermo di ogni punto, ricalcolate a ogni clic da una funzione
 * `(i, prev) => client` (il layout puo' cambiare dopo la scelta dello strumento). Restituisce {obj, raws}: la quota creata e i punti GREZZI (foglio) sotto i clic.
 */
async function drawDim(page, type, pointAt) {
  const need = type === 'aligned' || type === 'horizontal' || type === 'vertical' ? 3 : 2;
  const raws = [];
  for (let i = 0; i < need; i++) {
    const c = await pointAt(i, raws);
    raws.push(await sheetOfClient(page, c));
    await click(page, c);
  }
  const before = (await objectsOf(page)).length;
  await finishDim(page);
  const objs = await objectsOf(page);
  const obj = objs.length > before ? objs[objs.length - 1] : null;
  // La quota si annulla subito: i punti delle quote precedenti sarebbero candidati di snap (Estremo) per le prove successive.
  if (obj) await undoOne(page, before);
  return { obj, raws };
}
const undoOne = async (page, expectCount) => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  if ((await objectsOf(page)).length !== expectCount) info(`ATTENZIONE: dopo Annulla gli oggetti sono ${(await objectsOf(page)).length}, attesi ${expectCount}`);
};
const sheetPts = (o) => ({ s1: G.userToSheet(o.p1), s2: G.userToSheet(o.p2), a: G.userToSheet(o.a), b: G.userToSheet(o.b) });

async function ortoMouseSuite(browser) {
  setSection('ORTO sulle quote, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale', false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  await tool(page, 'Quota');
  await setToggle(page, 'ortho', true);
  const k0 = await zoomPx(page);
  info(`zoom di adattamento ${k0.toFixed(3)} px/pt`);

  // Il primo punto sta in un posto fisso; il secondo e' a (dx, dy) pixel da quello effettivamente inserito.
  const first = U([0.3, 0.55]);
  const at = (dx, dy) => async (i, raws) => {
    if (i === 0) return clientOfUser(page, first);
    const p = await clientOfSheet(page, raws[0]);
    if (i === 1) return { x: p.x + dx, y: p.y + dy };
    const p2 = await clientOfSheet(page, raws[1]);
    return { x: p2.x + 30, y: p2.y + 25 }; // terzo punto
  };

  for (const type of ['aligned', 'diameter', 'radius']) {
    await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    // quasi orizzontale: dx 150 px, dy 14 px
    let r = await drawDim(page, type, at(150, 14));
    let o = r.obj;
    let ok = !!o && o.dim === type;
    let p = ok ? sheetPts(o) : null;
    check(`ORTO acceso, ${type}: la quota e' stata creata`, ok, JSON.stringify(o));
    check(`ORTO acceso, ${type}, quasi orizzontale: il secondo punto sta sulla stessa Y del primo sul foglio (entro 1e-6 pt)`, ok && near(p.s2.y, p.s1.y, 1e-6), p ? `${p.s1.y} / ${p.s2.y}` : '');
    check(`ORTO acceso, ${type}: l'altra coordinata del secondo punto e' quella del clic`, ok && near(p.s2.x, r.raws[1].x, RAW_TOL), p ? `${p.s2.x} / ${r.raws[1].x}` : '');
    check(`ORTO acceso, ${type}: il primo punto e' quello del clic (nessun vincolo sul primo punto)`, ok && near(p.s1.x, r.raws[0].x, RAW_TOL) && near(p.s1.y, r.raws[0].y, RAW_TOL), p ? JSON.stringify([p.s1, r.raws[0]]) : '');
    // quasi verticale: dx 12 px, dy 130 px
    r = await drawDim(page, type, at(12, 130));
    o = r.obj;
    ok = !!o && o.dim === type;
    p = ok ? sheetPts(o) : null;
    check(`ORTO acceso, ${type}, quasi verticale: il secondo punto sta sulla stessa X del primo sul foglio (entro 1e-6 pt)`, ok && near(p.s2.x, p.s1.x, 1e-6), p ? `${p.s1.x} / ${p.s2.x}` : '');
    check(`ORTO acceso, ${type}, quasi verticale: l'altra coordinata e' quella del clic`, ok && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? `${p.s2.y} / ${r.raws[1].y}` : '');
    // ORTO spento: comportamento di edbb650 (punto grezzo, fuori asse)
    await setToggle(page, 'ortho', false);
    r = await drawDim(page, type, at(150, 14));
    o = r.obj;
    ok = !!o && o.dim === type;
    p = ok ? sheetPts(o) : null;
    check(`ORTO spento, ${type}: il secondo punto e' quello del clic, fuori asse (come edbb650)`, ok && near(p.s2.x, r.raws[1].x, RAW_TOL) && near(p.s2.y, r.raws[1].y, RAW_TOL) && Math.abs(p.s2.y - p.s1.y) > 1, p ? JSON.stringify([p.s2, r.raws[1]]) : '');
    await setToggle(page, 'ortho', true);
  }

  // Il terzo punto di Allineata (posizione della linea di quota) NON usa l'ORTO: con il secondo punto vincolato in orizzontale, un terzo punto a destra (dx > dy) e
  // sotto di 25 px darebbe distanza zero dalla linea con ORTO; senza, la linea di quota sta a 25 px.
  await tool(page, 'Quota');
  await dimType(page, 'aligned');
  await setToggle(page, 'ortho', true);
  let r = await drawDim(page, 'aligned', at(150, 14));
  let o = r.obj;
  let p = o ? sheetPts(o) : null;
  const off = p ? p.a.y - p.s1.y : NaN;
  const wantOff = r.raws[2].y - p.s1.y;
  check('Allineata con ORTO: il terzo punto non e\' vincolato (la linea di quota sta a distanza dalla quota pari a quella del clic, non zero)', !!o && Math.abs(wantOff) > 1 && near(off, wantOff, RAW_TOL), JSON.stringify({ off, wantOff }));

  // Orizzontale e verticale: nessun ORTO, nemmeno con ORTO acceso (regressione)
  for (const [type, dx, dy] of [['horizontal', 25, 140], ['vertical', 140, 25]]) {
    await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    r = await drawDim(page, type, at(dx, dy));
    o = r.obj;
    p = o ? sheetPts(o) : null;
    check(`${type} con ORTO acceso: creata, il secondo punto e' quello del clic (nessun vincolo: con ORTO sarebbe collassato sulla stessa ${type === 'horizontal' ? 'X' : 'Y'} e rifiutato)`, !!o && o.dim === type && near(p.s2.x, r.raws[1].x, RAW_TOL) && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? JSON.stringify([p.s2, r.raws[1]]) : JSON.stringify(o));
    const third = p ? (type === 'horizontal' ? p.a.y : p.a.x) : NaN;
    const wantThird = type === 'horizontal' ? r.raws[2].y : r.raws[2].x;
    check(`${type} con ORTO acceso: anche il terzo punto e' quello del clic (la linea di quota ci passa)`, !!o && near(third, wantThird, RAW_TOL), JSON.stringify({ third, wantThird }));
  }

  // Due punti sulla stessa X (orizzontale) o Y (verticale): ancora rifiutati, con ORTO acceso
  await tool(page, 'Quota');
  await dimType(page, 'horizontal');
  await setToggle(page, 'ortho', true);
  const n0 = (await objectsOf(page)).length;
  await click(page, await clientOfUser(page, first));
  await click(page, await clientOfUser(page, { x: first.x, y: first.y + 120 }));
  check('orizzontale: due punti sulla stessa X sono rifiutati, con messaggio (invariato)', /stessa X/.test(await status(page)), await status(page));
  await dropEntry(page);
  check('orizzontale: nessuna quota in piu\' dopo il rifiuto', (await objectsOf(page)).length === n0);

  // Il mirino (anteprima) mostra gia' il punto vincolato: secondo punto di Allineata
  await tool(page, 'Quota');
  await dimType(page, 'aligned');
  await setToggle(page, 'ortho', true);
  await click(page, await clientOfUser(page, first));
  const p1c = await clientOfUser(page, first);
  await page.mouse.move(p1c.x + 140, p1c.y + 11);
  await page.waitForTimeout(60);
  const am = await aimMark(page);
  check('anteprima: il mirino del secondo punto sta sulla stessa Y del primo (ORTO)', !!am && near(am.y, p1c.y, 0.75), JSON.stringify({ am, p1c }));
  await setToggle(page, 'ortho', false);
  await page.mouse.move(p1c.x + 140, p1c.y + 11);
  await page.waitForTimeout(60);
  const am2 = await aimMark(page);
  // Il segno di mira compare solo se il vincolo sposta il punto (altrimenti c'e' gia' il cursore a croce): con ORTO spento il punto e' quello del mouse, nessun segno.
  check('anteprima con ORTO spento: il punto non e\' spostato, quindi nessun segno di mira (come prima)', am2 === null, JSON.stringify({ am2, p1c }));
  await setToggle(page, 'ortho', true);
  await page.keyboard.press('Escape');

  // Il testo guida non cambia con l'ORTO (una riga su iPhone)
  await tool(page, 'Quota');
  await dimType(page, 'aligned');
  const hint0 = await hint(page);
  await click(page, await clientOfUser(page, first));
  const hint1 = await hint(page);
  check('testo guida della quota allineata: invariato, "indica il primo punto" / "indica il secondo punto"', hint0 === 'Quota allineata: indica il primo punto' && hint1 === 'Quota allineata: indica il secondo punto', JSON.stringify([hint0, hint1]));
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---------------------------------------------------------------- 2) priorita': snap > ORTO > griglia
async function priorityMouseSuite(browser) {
  setSection('ORTO sulle quote, priorita\' (snap, griglia)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale', false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  // un'unica retta di prova: il suo estremo (0.6, 0.30) e' fuori asse rispetto al primo punto della quota (0.3, 0.55)
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.6, 0.3], [0.8, 0.3]] }]));
  await page.waitForTimeout(150);
  const endpoint = U([0.6, 0.3]);
  const first = U([0.3, 0.55]);

  for (const type of ['aligned', 'diameter', 'radius']) {
    await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    // snap vince sull'ORTO: clic a 4 px dall'estremo della retta
    let r = await drawDim(page, type, async (i, raws) => {
      if (i === 0) return clientOfUser(page, first);
      const e = await clientOfUser(page, endpoint);
      return i === 1 ? { x: e.x + 4, y: e.y - 3 } : { x: e.x - 60, y: e.y + 40 };
    });
    let o = r.obj;
    let p = o ? sheetPts(o) : null;
    const e = G.userToSheet(endpoint);
    check(`${type}: ORTO acceso e un Estremo a portata: il secondo punto va all'Estremo, fuori asse (lo snap vince sull'ORTO)`, !!o && near(p.s2.x, e.x, 1e-6) && near(p.s2.y, e.y, 1e-6) && Math.abs(p.s2.y - p.s1.y) > 5, p ? JSON.stringify([p.s2, e]) : JSON.stringify(o));
  }
  // il marcatore dello snap si vede mentre si mira vicino all'Estremo, con ORTO acceso
  await tool(page, 'Quota');
  await dimType(page, 'aligned');
  await setToggle(page, 'ortho', true);
  await click(page, await clientOfUser(page, first));
  const ec = await clientOfUser(page, endpoint);
  await page.mouse.move(ec.x + 4, ec.y - 3);
  await page.waitForTimeout(60);
  const m = await snapMark(page);
  check('ORTO acceso: vicino all\'Estremo compare il marcatore "Estremo" (il punto vincolato dallo snap si vede)', !!m && m.kind === 'end' && m.label === 'Estremo', JSON.stringify(m));
  // lontano da ogni candidato: vince l'ORTO
  const p1c = await clientOfUser(page, first);
  await page.mouse.move(p1c.x - 130, p1c.y + 9);
  await page.waitForTimeout(60);
  const am = await aimMark(page);
  check('ORTO acceso, nessun candidato a portata: vince l\'ORTO (mirino sulla Y del primo punto) e non c\'e\' marcatore', !!am && near(am.y, p1c.y, 0.75) && (await snapMark(page)) === null, JSON.stringify({ am, p1c }));
  await page.keyboard.press('Escape');

  // griglia + ORTO: si arrotonda solo l'asse libero
  await setToggle(page, 'grid', true);
  const step = 10 * MM_PT;
  for (const type of ['aligned', 'diameter', 'radius']) {
    await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    // evita l'Estremo della retta di prova: secondo punto a sinistra del primo
    const r = await drawDim(page, type, async (i, raws) => {
      if (i === 0) return clientOfUser(page, U([0.35, 0.6]));
      const p = await clientOfSheet(page, raws[0]);
      return i === 1 ? { x: p.x - 143, y: p.y + 4 } : { x: p.x - 143, y: p.y + 40 };
    });
    const o = r.obj;
    const p = o ? sheetPts(o) : null;
    const sx = (v) => v / step;
    check(`griglia + ORTO, ${type}: il primo punto e' su un nodo`, !!o && near(sx(p.s1.x), Math.round(sx(p.s1.x)), 1e-6) && near(sx(G.height - p.s1.y), Math.round(sx(G.height - p.s1.y)), 1e-6), p ? JSON.stringify(p.s1) : '');
    check(`griglia + ORTO, ${type}: il secondo punto ha la Y del primo (asse bloccato) e la X su un nodo (asse libero)`, !!o && near(p.s2.y, p.s1.y, 1e-6) && near(sx(p.s2.x), Math.round(sx(p.s2.x)), 1e-6) && Math.abs(p.s2.x - p.s1.x) > 5, p ? JSON.stringify([p.s1, p.s2]) : '');
  }
  await ctx.close();
}

// ---------------------------------------------------------------- 3) pagine con /Rotate 90 e CropBox
async function ortoPagesSuite(browser) {
  for (const [title, name] of [['A4 con /Rotate 90', 'rotate90'], ['A4 con CropBox', 'cropbox']]) {
    setSection(`ORTO sulle quote, mouse, ${title}`);
    const { ctx, page } = await desktop(browser);
    await openDoc(page, title, false);
    const pinfo = await pageInfo(page);
    const U = (f) => userOf(pinfo, f);
    info(`${title}: ${JSON.stringify({ view: pinfo.view, rotate: pinfo.rotate, userUnit: pinfo.userUnit })}`);
    const first = U([0.3, 0.55]);
    const at = (dx, dy) => async (i, raws) => {
      if (i === 0) return clientOfUser(page, first);
      const p = await clientOfSheet(page, raws[0]);
      return i === 1 ? { x: p.x + dx, y: p.y + dy } : { x: p.x + dx + 30, y: p.y + dy + 25 };
    };
    for (const type of ['aligned', 'diameter', 'radius']) {
      await tool(page, 'Quota');
      await dimType(page, type);
      await setToggle(page, 'ortho', true);
      let r = await drawDim(page, type, at(150, 14));
      let o = r.obj;
      let p = o ? sheetPts(o) : null;
      check(`${title}, ${type}: quasi orizzontale SULLO SCHERMO -> stessa Y sul foglio mostrato (entro 1e-6 pt)`, !!o && near(p.s2.y, p.s1.y, 1e-6) && near(p.s2.x, r.raws[1].x, RAW_TOL), p ? JSON.stringify([p.s1, p.s2]) : JSON.stringify(o));
      if (pinfo.rotate % 180 !== 0) {
        // con /Rotate 90 l'orizzontale dello schermo e' la verticale dello spazio utente (dove la quota e' salvata)
        check(`${title}, ${type}: nello spazio utente salvato i due punti hanno la stessa X (orizzontale dello schermo = verticale del PDF)`, !!o && near(o.p1.x, o.p2.x, 1e-6) && Math.abs(o.p1.y - o.p2.y) > 5, JSON.stringify([o?.p1, o?.p2]));
      }
      r = await drawDim(page, type, at(12, 130));
      o = r.obj;
      p = o ? sheetPts(o) : null;
      check(`${title}, ${type}: quasi verticale sullo schermo -> stessa X sul foglio mostrato`, !!o && near(p.s2.x, p.s1.x, 1e-6) && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? JSON.stringify([p.s1, p.s2]) : JSON.stringify(o));
    }
    for (const [type, dx, dy] of [['horizontal', 25, 140], ['vertical', 140, 25]]) {
      await tool(page, 'Quota');
      await dimType(page, type);
      await setToggle(page, 'ortho', true);
      const r = await drawDim(page, type, at(dx, dy));
      const o = r.obj;
      const p = o ? sheetPts(o) : null;
      check(`${title}, ${type} con ORTO acceso: invariata (secondo punto = clic, fuori asse)`, !!o && o.dim === type && near(p.s2.x, r.raws[1].x, RAW_TOL) && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? JSON.stringify([p.s2, r.raws[1]]) : JSON.stringify(o));
    }
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 4) ORTO sulle quote, tocco emulato
/**
 * CP7b: l'interruttore PDF (snap sul disegno del PDF, acceso all'avvio) si SPEGNE: queste prove riguardano gli oggetti disegnati e i PDF di prova hanno punti propri che ora si
 * agganciano; lo snap sul PDF e' provato in e2e-cp7b.cjs. Dove il pannello a destra e' a scomparsa lo apre e lo richiude. Su un build senza l'interruttore (3bbe3a8) non fa nulla.
 */
async function pdfSnapOff(page) {
  const b = page.locator('.panel-toggle[data-panel-toggle="pdf"]');
  if (!(await b.count())) return;
  const hidden = !(await b.isVisible());
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  if ((await b.getAttribute('aria-pressed')) === 'true') await b.click();
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(60);
}

async function ortoTouchSuite(browser) {
  setSection('ORTO sulle quote, tocco 390x780');
  const { ctx, page, cdp } = await phone(browser);
  await openDoc(page, 'A4 vettoriale', false);
  await pdfSnapOff(page); // CP7b
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(70);
  };
  const first = U([0.3, 0.55]);
  /** Come drawDim, con tocchi. */
  const drawDimTouch = async (type, pointAt) => {
    const need = type === 'aligned' || type === 'horizontal' || type === 'vertical' ? 3 : 2;
    const raws = [];
    for (let i = 0; i < need; i++) {
      const c = await pointAt(i, raws);
      raws.push(await sheetOfClient(page, c));
      await tap(c);
    }
    const before = (await objectsOf(page)).length;
    await finishDim(page);
    const objs = await objectsOf(page);
    const obj = objs.length > before ? objs[objs.length - 1] : null;
    if (obj) await undoOne(page, before);
    return { obj, raws };
  };
  await tool(page, 'Quota');
  const k = await zoomPx(page);
  info(`zoom ${k.toFixed(3)} px/pt`);
  const at = (dx, dy) => async (i, raws) => {
    if (i === 0) return clientOfUser(page, first);
    const p = await clientOfSheet(page, raws[0]);
    return i === 1 ? { x: p.x + dx, y: p.y + dy } : { x: p.x + dx - 10, y: p.y + dy + 25 };
  };
  await dimType(page, 'aligned');
  await setToggle(page, 'ortho', true);
  for (const type of ['aligned', 'diameter', 'radius']) {
    if (!(await page.locator('.ctx-types').isVisible())) await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    let r = await drawDimTouch(type, at(110, 12));
    let o = r.obj;
    let p = o ? sheetPts(o) : null;
    check(`tocco, ORTO acceso, ${type}: il secondo punto sta sulla stessa Y del primo sul foglio (entro 1e-6 pt)`, !!o && near(p.s2.y, p.s1.y, 1e-6) && near(p.s2.x, r.raws[1].x, RAW_TOL), p ? JSON.stringify([p.s1, p.s2, r.raws[1]]) : JSON.stringify(o));
    r = await drawDimTouch(type, at(10, 130));
    o = r.obj;
    p = o ? sheetPts(o) : null;
    check(`tocco, ORTO acceso, ${type}: quasi verticale -> stessa X sul foglio`, !!o && near(p.s2.x, p.s1.x, 1e-6) && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? JSON.stringify([p.s1, p.s2, r.raws[1]]) : JSON.stringify(o));
    await setToggle(page, 'ortho', false);
    r = await drawDimTouch(type, at(110, 12));
    o = r.obj;
    p = o ? sheetPts(o) : null;
    check(`tocco, ORTO spento, ${type}: il secondo punto e' quello del tocco (come edbb650)`, !!o && near(p.s2.x, r.raws[1].x, RAW_TOL) && near(p.s2.y, r.raws[1].y, RAW_TOL) && Math.abs(p.s2.y - p.s1.y) > 1, p ? JSON.stringify([p.s2, r.raws[1]]) : JSON.stringify(o));
    await setToggle(page, 'ortho', true);
  }
  for (const [type, dx, dy] of [['horizontal', 20, 130], ['vertical', 110, 20]]) {
    await tool(page, 'Quota');
    await dimType(page, type);
    await setToggle(page, 'ortho', true);
    const r = await drawDimTouch(type, at(dx, dy));
    const o = r.obj;
    const p = o ? sheetPts(o) : null;
    check(`tocco, ${type} con ORTO acceso: invariata (secondo punto = tocco, fuori asse)`, !!o && o.dim === type && near(p.s2.x, r.raws[1].x, RAW_TOL) && near(p.s2.y, r.raws[1].y, RAW_TOL), p ? JSON.stringify([p.s2, r.raws[1]]) : JSON.stringify(o));
  }
  // la lente mostra il punto effettivo: il centro della copia segue l'ORTO (stessa Y del primo punto)
  await tool(page, 'Quota');
  await dimType(page, 'aligned');
  await setToggle(page, 'ortho', true);
  await tap(await clientOfUser(page, first));
  const h1 = await hint(page);
  const p1c = await clientOfUser(page, first);
  await touch(cdp, 'touchStart', [[p1c.x + 100, p1c.y + 14]]);
  await page.waitForTimeout(80);
  const am = await aimMark(page);
  check('tocco: durante la mira il mirino del secondo punto sta sulla stessa Y del primo (ORTO)', !!am && near(am.y, p1c.y, 0.75), JSON.stringify({ am, p1c }));
  check('tocco: la lente e\' visibile durante la mira', (await page.locator('.lens:not([hidden])').count()) === 1);
  await touch(cdp, 'touchCancel', []);
  check('tocco: il testo guida del secondo punto e\' una riga (invariato)', h1 === 'Quota allineata: indica il secondo punto', h1);
  await ctx.close();
}

// ---------------------------------------------------------------- 5) Canc sull'oggetto selezionato, mouse
const focusInfo = (page) => page.evaluate(() => ({ cls: document.activeElement?.className ?? null, tag: document.activeElement?.tagName ?? null }));
const kinds = (objs) => objs.map((o) => o.kind);
async function pickObject(page, pinfo, pick) {
  const c = await clientOfUser(page, userOf(pinfo, pick.f));
  await click(page, c, pick.px?.[0] ?? 0, pick.px?.[1] ?? 0);
}

async function cancSuite(browser, title = 'A4 vettoriale', label = 'mouse 1280x900') {
  setSection(`Canc, ${label}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title, true);
  const pinfo = await pageInfo(page);
  const isBase = title === 'A4 vettoriale';
  const total = (await objectsOf(page)).length;
  check(`${label}: 7 oggetti di prova sulla pagina`, total === 7, String(total));

  // palette -> Seleziona -> clic sull'oggetto -> Delete (clic reali), per ogni tipo di oggetto
  for (const pick of PICKS) {
    await tool(page, 'Seleziona');
    // Premessa del punto 2.2d: dopo aver scelto Seleziona dalla palette il focus e' sul pulsante della palette; il clic sull'oggetto deve riportarlo sul visore.
    const f0 = await focusInfo(page);
    if (pick === PICKS[0]) check(`${label}: dopo aver scelto Seleziona dalla palette il focus e' sul pulsante della palette (premessa)`, f0.tag === 'BUTTON' && /\btool\b/.test(f0.cls ?? ''), JSON.stringify(f0));
    await pickObject(page, pinfo, pick);
    const sel = await hint(page);
    check(`${label}, ${pick.name}: il clic la seleziona ("Selezionat...")`, /^Selezionat[ao]: /.test(sel), sel);
    const f = await focusInfo(page);
    check(`${label}, ${pick.name}: dopo il clic il focus e' sul visore (non sul pulsante della palette)`, /\bviewer\b/.test(f.cls ?? ''), JSON.stringify(f));
    const before = await objectsOf(page);
    const stepsBefore = await page.evaluate(() => window.__gtpdf.state().version);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    const after = await objectsOf(page);
    const gone = before.filter((o) => !after.some((a) => a.id === o.id));
    check(`${label}, ${pick.name}: Canc la cancella (un solo oggetto in meno, del tipo giusto)`, after.length === before.length - 1 && gone.length === 1 && gone[0].kind === pick.kind, JSON.stringify({ prima: kinds(before), dopo: kinds(after) }));
    check(`${label}, ${pick.name}: messaggio di Cancella ("... cancellat... Annulla ... ripristina.")`, pick.msg.test(await status(page)), await status(page));
    const hAfter = await hint(page);
    check(`${label}, ${pick.name}: la barra contestuale non dice piu' "Selezionat..."`, !/Selezionat/.test(hAfter) && hAfter === 'Seleziona: tocca un oggetto, poi trascinalo', hAfter);
    // Annulla in un solo passo, poi Ripeti lo cancella di nuovo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    const undone = await objectsOf(page);
    check(`${label}, ${pick.name}: Annulla (un solo passo) la ripristina, allo stesso posto e uguale`, undone.length === before.length && JSON.stringify(undone) === JSON.stringify(before), JSON.stringify(kinds(undone)));
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(100);
    const redone = await objectsOf(page);
    check(`${label}, ${pick.name}: Ripeti la cancella di nuovo`, JSON.stringify(redone) === JSON.stringify(after), JSON.stringify(kinds(redone)));
    await page.keyboard.press('Control+z'); // la rimette per il giro successivo
    await page.waitForTimeout(100);
    const v = await page.evaluate(() => window.__gtpdf.state().version);
    check(`${label}, ${pick.name}: dopo Annulla/Ripeti/Annulla il modello e' tornato com'era (stessi oggetti)`, JSON.stringify(await objectsOf(page)) === JSON.stringify(before) && v >= stepsBefore);
  }
  if (!isBase) {
    await ctx.close();
    return;
  }

  // ---- Canc senza selezione: nulla
  await tool(page, 'Seleziona');
  await click(page, await clientOfUser(page, userOf(pinfo, [0.9, 0.5]))); // clic nel vuoto (fuori da ogni oggetto)
  check('senza selezione: il clic nel vuoto non seleziona nulla', !/Selezionat/.test(await hint(page)), await hint(page));
  const m0 = await status(page);
  const o0 = JSON.stringify(await objectsOf(page));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('senza selezione: Canc non fa nulla (nessun oggetto cambia, nessun messaggio nuovo)', JSON.stringify(await objectsOf(page)) === o0 && (await status(page)) === m0);

  // ---- Backspace NON cancella l'oggetto selezionato
  await pickObject(page, pinfo, PICKS[0]);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  check('Backspace con un oggetto selezionato: non lo cancella (resta solo l\'annullamento in costruzione)', JSON.stringify(await objectsOf(page)) === o0 && /Selezionat/.test(await hint(page)));

  // ---- Canc con il focus in un campo ("Passo griglia"): non cancella
  const field = page.locator('.grid-ctl input.field');
  await field.click();
  check('focus nel campo "Passo griglia"', (await focusInfo(page)).tag === 'INPUT');
  check('la selezione c\'e\' ancora (cliccare nel campo non la toglie)', /Selezionat/.test(await hint(page)), await hint(page));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Canc con il focus nel campo "Passo griglia": non cancella l\'oggetto selezionato', JSON.stringify(await objectsOf(page)) === o0);
  // ... e subito dopo, con il focus riportato sul visore dal clic sull'oggetto, Canc cancella
  await pickObject(page, pinfo, PICKS[0]);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('riportato il focus sul visore (clic sull\'oggetto), Canc cancella', (await objectsOf(page)).length === 6);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);

  // ---- Canc con il focus su un pulsante: non cancella (come Invio e Backspace)
  await pickObject(page, pinfo, PICKS[0]);
  await page.locator('button.tool[title="Retta"]').focus(); // focus senza clic: lo strumento non cambia, la selezione resta
  const fb = await focusInfo(page);
  const hb = await hint(page);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Canc con il focus su un pulsante: non cancella', fb.tag === 'BUTTON' && /Selezionat/.test(hb) && JSON.stringify(await objectsOf(page)) === o0, JSON.stringify({ fb, hb }));

  // ---- Canc con un dialogo aperto: non cancella (focus riportato sul body, cosi' vale solo la guardia del dialogo)
  await pickObject(page, pinfo, PICKS[0]);
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.locator('.menu-item', { hasText: 'Salva con nome' }).click();
  await page.waitForSelector('.dialog-backdrop');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const fd = await focusInfo(page);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Canc con un dialogo aperto (focus sul body): non cancella', fd.tag === 'BODY' && JSON.stringify(await objectsOf(page)) === o0, JSON.stringify(fd));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await page.locator('.dialog-backdrop').count()) await page.locator('.dialog-backdrop .btn', { hasText: /Chiudi|Annulla/ }).first().click();
  check('il dialogo e\' chiuso', (await page.locator('.dialog-backdrop').count()) === 0);

  // ---- Canc in costruzione: toglie l'ultimo punto, come prima (e non cancella la selezione che non c'e' piu')
  await tool(page, 'Linea');
  const lc = (f) => clientOfUser(page, userOf(pinfo, f));
  await click(page, await lc([0.1, 0.4]));
  await click(page, await lc([0.2, 0.42]));
  await click(page, await lc([0.3, 0.4]));
  check('Linea: 3 punti in costruzione (il testo guida propone Fine)', /tocca due volte l'ultimo punto o premi Fine/.test(await hint(page)), await hint(page));
  const cnt = (await objectsOf(page)).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  await click(page, await lc([0.4, 0.38])); // un punto in piu': con 3 punti rimasti la Linea non e' ancora finita
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Canc e Backspace in costruzione tolgono l\'ultimo punto, nessun oggetto cancellato', (await objectsOf(page)).length === cnt);
  // prova diretta: con 2 punti, Canc ne lascia 1, un altro Canc 0
  await tool(page, 'Retta');
  await click(page, await lc([0.1, 0.9]));
  check('Retta: 1 punto in costruzione', /secondo punto/.test(await hint(page)), await hint(page));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Retta: Canc in costruzione toglie il punto (si torna a "indica il primo punto")', /primo punto/.test(await hint(page)), await hint(page));
  await page.keyboard.press('Escape');

  // ---- lo strumento Cancella e' invariato
  await tool(page, 'Cancella');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('strumento Cancella: Canc senza oggetti scelti non fa nulla', (await objectsOf(page)).length === 7);
  await click(page, await clientOfUser(page, userOf(pinfo, PICKS[0].f)));
  check('strumento Cancella: il clic cancella ancora (invariato), stesso messaggio', (await objectsOf(page)).length === 6 && PICKS[0].msg.test(await status(page)), await status(page));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  check('strumento Cancella: Annulla la ripristina (un solo passo)', (await objectsOf(page)).length === 7);

  // ---- con lo strumento Seleziona e nessun cambio di strumento: dopo Canc si puo' selezionare un altro oggetto e cancellarlo
  await tool(page, 'Seleziona');
  await pickObject(page, pinfo, PICKS[0]);
  await page.keyboard.press('Delete');
  await pickObject(page, pinfo, PICKS[1]);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  const two = await objectsOf(page);
  check('due selezioni e due Canc di seguito: due oggetti in meno', two.length === 5 && !kinds(two).includes('polyline'), JSON.stringify(kinds(two)));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  check('due Annulla: tornano tutti e due', JSON.stringify(await objectsOf(page)) === o0);

  // ---- Canc non vale con lo strumento Pan (nessun oggetto scelto)
  await tool(page, 'Sposta vista');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('strumento Sposta vista: Canc non fa nulla', JSON.stringify(await objectsOf(page)) === o0);
  await ctx.close();
}

async function cancTouchSuite(browser) {
  setSection('Canc, tocco emulato 390x780 con tastiera');
  const { ctx, page, cdp } = await phone(browser);
  await openDoc(page, 'A4 vettoriale', true);
  const pinfo = await pageInfo(page);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(90);
  };
  await tool(page, 'Seleziona');
  const before = await objectsOf(page);
  await tap(await clientOfUser(page, userOf(pinfo, PICKS[0].f)));
  check('tocco: il tocco seleziona la retta', /^Selezionata: Retta$/.test(await hint(page)), await hint(page));
  const f = await focusInfo(page);
  info(`tocco: elemento con il focus dopo il tocco: ${JSON.stringify(f)}`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  const after = await objectsOf(page);
  check('tocco + tastiera (iPad con tastiera, emulato): Canc cancella la retta selezionata', after.length === before.length - 1 && !kinds(after).includes('segment') === (kinds(before).filter((k) => k === 'segment').length === 1) , JSON.stringify(kinds(after)));
  check('tocco: messaggio di Cancella e barra contestuale senza "Selezionata"', PICKS[0].msg.test(await status(page)) && !/Selezionat/.test(await hint(page)), JSON.stringify([await status(page), await hint(page)]));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('tocco: Annulla la ripristina', JSON.stringify(await objectsOf(page)) === JSON.stringify(before));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  // E2E_ONLY=orto,priorita,pagine,tocco,canc,cancpagina,canctocco: solo alcune serie (per il debug); senza, tutte.
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only || only.includes(id);
  try {
    if (run('orto')) await ortoMouseSuite(browser);
    if (run('priorita')) await priorityMouseSuite(browser);
    if (run('pagine')) await ortoPagesSuite(browser);
    if (run('tocco')) await ortoTouchSuite(browser);
    if (run('canc')) await cancSuite(browser);
    if (run('cancpagina')) await cancSuite(browser, 'A4 con /Rotate 90', 'pagina /Rotate 90');
    if (run('canctocco')) await cancTouchSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
