// Prove di CP6e (tappa "Selezione multipla e trasformazioni") su Chromium: selezione con Ctrl + clic (aggiungi, togli, riduci), trascinamento e Canc su piu' oggetti, Sposta,
// Specchio e Rotazione (punti, anteprima, rifiuti, tutto o niente), "Mantieni l'originale", Duplica, voci del menu Modifica, file progetto e esportazione di oggetti
// trasformati, altezza della barra contestuale. Mouse (desktop 1280 x 900, clic reali, Ctrl premuto con la tastiera di Playwright) e, come guardia, tocco emulato (390 x 780:
// decisione 81, nessuna prova nuova dedicata all'iPhone).
// Punti ESATTI: i punti delle trasformazioni si indicano sui NODI della griglia (accesa, snap spenti), quindi sono esatti; i valori attesi si calcolano QUI con un calcolo
// indipendente (numeri complessi nel piano matematico, geometria della pagina ricostruita da `pages()`), entro 1e-6 pt nello spazio utente; i punti presi con un clic senza
// griglia con la tolleranza del rettangolo del canvas (RAW_TOL).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6e.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 2b26073 i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=selezione,trascina,canc,sposta,specchio,rotazione,misto,menu,tastiera,progetto,export,barra,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6e', out: process.argv[2], port: 4217, hport: 4218, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mobile/15E148) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel), non con un valore esatto. */
const RAW_TOL = 0.05;
const MM_PT = 72 / 25.4;
const DEG = Math.PI / 180;
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const PAGES = [
  ['A4 vettoriale', 'A4 vettoriale'],
  ['A4 con /Rotate 90', 'pagina /Rotate 90'],
  ['A4 con CropBox', 'pagina con CropBox'],
];

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
const toggle = (page, name) => page.locator(`.st-toggle[data-toggle="${name}"]`);
const setToggle = async (page, name, on) => {
  const cur = (await toggle(page, name).getAttribute('aria-pressed')) === 'true';
  if (cur !== on) await toggle(page, name).click();
  await page.waitForTimeout(60);
};
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const barH = async (page) => Math.round((await page.locator('.ctxbar').boundingBox()).height * 10) / 10;
const undoTitle = (page) => page.locator('.undo-ctl button').first().getAttribute('title');
const redoTitle = (page) => page.locator('.undo-ctl button').nth(1).getAttribute('title');
/** Gli id selezionati: dal gancio di prova se c'e', altrimenti null (il build di 2b26073 non ce l'ha). */
const selIds = (page) => page.evaluate(() => (window.__gtpdf.selection ? window.__gtpdf.selection() : null));
/** Quante primitive evidenzia la selezione (un alone o una cornice per forma): funziona anche sul build di prima. */
const selShapes = (page) => page.evaluate(() => document.querySelector('.sc-sel')?.children.length ?? 0);
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Geometria della pagina 1, ricostruita qui da `pages()` con le formule di `PageGeometry`. */
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
let STEP = 10 * MM_PT; // passo della griglia in pt del foglio (10 mm del foglio, o 10 mm reali con una scala)
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const pageInfo = (page) => page.evaluate(() => window.__gtpdf.pages()[0]);
const userOf = (info, f) => ({ x: info.view[0] + f[0] * (info.view[2] - info.view[0]), y: info.view[1] + f[1] * (info.view[3] - info.view[1]) });
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const clientOfUser = (page, u) => clientOfSheet(page, G.userToSheet(u));
/** Il nodo della griglia (colonna i, riga j dal BASSO, come X e Y della barra di stato) sul foglio mostrato, in pt. */
const node = (i, j) => ({ x: i * STEP, y: G.height - j * STEP });
const clientOfNode = (page, i, j) => clientOfSheet(page, node(i, j));
async function openDoc(page, title = 'A4 vettoriale') {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  STEP = 10 * MM_PT;
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
}
async function click(page, c, mods = [], dx = 0, dy = 0) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await page.waitForTimeout(70);
}
/** Clic vicino a un nodo della griglia (qualche pixel di scarto: la griglia arrotonda al nodo). */
const clickNode = async (page, i, j, mods = []) => click(page, await clientOfNode(page, i, j), mods, 3, -2);
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
/** Prepara una pagina per le trasformazioni: griglia accesa (nodi esatti), snap spenti, ORTO spento. */
async function gridMode(page) {
  for (const t of ['end', 'mid', 'center']) await setToggle(page, t, false);
  await setToggle(page, 'ortho', false);
  await setToggle(page, 'grid', true);
}

// ---- calcolo indipendente nel foglio (numeri complessi nel piano matematico: y = -foglio.y) ----
const toC = (p) => ({ re: p.x, im: -p.y });
const fromC = (z) => ({ x: z.re, y: -z.im });
const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const cconj = (a) => ({ re: a.re, im: -a.im });
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
/** Rotazione antioraria di `deg` gradi come si vede sul foglio. */
const rotSheet = (c, deg) => (p) => fromC(cadd(toC(c), cmul(csub(toC(p), toC(c)), { re: Math.cos(deg * DEG), im: Math.sin(deg * DEG) })));
/** Riflessione rispetto alla retta per a e b. */
const mirSheet = (a, b) => (p) => { const d = csub(toC(b), toC(a)); return fromC(cadd(toC(a), cmul(d, cconj(cdiv(csub(toC(p), toC(a)), d))))); };
const movSheet = (dx, dy) => (p) => ({ x: p.x + dx, y: p.y + dy });
/** I punti di un oggetto nell'ordine del modello. */
function ptsOf(o) {
  switch (o.kind) {
    case 'segment':
    case 'polyline': return o.points;
    case 'text': return [o.at];
    case 'cover':
    case 'circle': return [o.p1, o.p2];
    case 'arc': return [o.p1, o.p2, o.p3];
    default: return [o.p1, o.p2, o.a, o.b];
  }
}
/** Il punto atteso di `p` (utente) dopo la trasformazione del foglio `f`. */
const expUser = (p, f) => G.sheetToUser(f(G.userToSheet(p)));
/** Confronta gli oggetti prima e dopo: stesso id, stesso tipo, stesse proprieta', punti attesi entro `tol` (il testo e' escluso se `skipText`). Restituisce null se tutto torna. */
function compareObjects(before, after, f, tol = 1e-6, skipText = false) {
  if (before.length !== after.length) return `numero di oggetti ${before.length} -> ${after.length}`;
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    if (b.id !== a.id || b.kind !== a.kind) return `oggetto ${i}: id/tipo ${b.id}/${b.kind} -> ${a.id}/${a.kind}`;
    const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); for (const k of ['points', 'at', 'p1', 'p2', 'p3', 'a', 'b']) delete c[k]; return c; };
    if (!sameJSON(strip(b), strip(a))) return `oggetto ${b.id} (${b.kind}): le proprieta' sono cambiate`;
    if (b.kind === 'text' && skipText) continue;
    const pb = ptsOf(b);
    const pa = ptsOf(a);
    if (pb.length !== pa.length) return `oggetto ${b.id}: numero di punti`;
    for (let k = 0; k < pb.length; k++) {
      const e = expUser(pb[k], f);
      if (!nearP(e, pa[k], tol)) return `oggetto ${b.id} (${b.kind}) punto ${k}: atteso ${e.x.toFixed(6)},${e.y.toFixed(6)} trovato ${pa[k].x.toFixed(6)},${pa[k].y.toFixed(6)}`;
    }
  }
  return null;
}
/** Come `compareObjects` per i soli oggetti `sel` (id); tutti gli altri devono essere rimasti identici. */
function compareSel(before, after, sel, f, tol = 1e-6, skipText = false) {
  const inSel = (o) => sel.includes(o.id);
  const err = compareObjects(before.filter(inSel), after.filter(inSel), f, tol, skipText);
  if (err) return err;
  return sameJSON(before.filter((o) => !inSel(o)), after.filter((o) => !inSel(o))) ? null : 'gli oggetti non selezionati sono cambiati';
}
/** Il verso di tre punti sul foglio (+1 / -1): il segno dello sweep dell'arco ne dipende; Specchio lo inverte, Rotazione e Sposta no. */
const orient = (o) => {
  const [s1, s2, s3] = [o.p1, o.p2, o.p3].map((p) => G.userToSheet(p));
  return Math.sign((s2.x - s1.x) * (s3.y - s2.y) - (s2.y - s1.y) * (s3.x - s2.x));
};

/** Oggetti di prova per ogni tipo (coordinate frazionarie dell'area visibile), quote orizzontale e verticale e coperture rettangolare e quadrata comprese. */
const ALL_SPECS = [
  { k: 'segment', pts: [[0.15, 0.85], [0.45, 0.88]] },
  { k: 'polyline', pts: [[0.15, 0.75], [0.3, 0.8], [0.45, 0.72]], style: 'dashed' },
  { k: 'circle', a: [0.7, 0.8], b: [0.8, 0.8], color: '#1565C0' },
  { k: 'arc', a: [0.6, 0.6], b: [0.68, 0.66], c: [0.78, 0.6] },
  { k: 'cover', shape: 'circle', a: [0.3, 0.62], b: [0.36, 0.62] },
  { k: 'dim', dim: 'aligned', pts: [[0.15, 0.5], [0.4, 0.55], [0.25, 0.62]] },
  { k: 'dim', dim: 'diameter', pts: [[0.55, 0.35], [0.75, 0.4]] },
  { k: 'dim', dim: 'radius', pts: [[0.6, 0.25], [0.7, 0.3]] },
  { k: 'text', at: [0.15, 0.3], text: 'FORO Ø10', pt: 12 },
  { k: 'dim', dim: 'horizontal', pts: [[0.15, 0.15], [0.4, 0.2], [0.3, 0.1]] },
  { k: 'dim', dim: 'vertical', pts: [[0.5, 0.12], [0.55, 0.3], [0.6, 0.2]] },
  { k: 'cover', shape: 'rect', a: [0.7, 0.1], b: [0.85, 0.2] },
  { k: 'cover', shape: 'square', a: [0.1, 0.4], b: [0.18, 0.46] },
];
/** Per tipo (nell'ordine di ALL_SPECS): non sono ammessi alla Rotazione le quote orizzontale e verticale. */
const IDX = { segment: 0, polyline: 1, circle: 2, arc: 3, coverCircle: 4, dimAligned: 5, dimDiameter: 6, dimRadius: 7, text: 8, dimHoriz: 9, dimVert: 10, coverRect: 11, coverSquare: 12 };
const ids = (objs, names) => names.map((n) => objs[IDX[n]].id);
const COMMON = ['segment', 'polyline', 'circle', 'arc', 'coverCircle', 'dimAligned', 'dimDiameter', 'dimRadius', 'text'];

async function addAll(page) {
  await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), ALL_SPECS);
  await page.waitForTimeout(200);
  return objectsOf(page);
}
const selectIdsHook = (page, list) => page.evaluate((l) => window.__gtpdf.selectIds(l), list);
const armBtn = async (page, name) => {
  await page.locator('.ctx-tr', { hasText: name }).click();
  await page.waitForTimeout(100);
};
const keepToggle = async (page, on) => {
  const b = page.locator('.ctx-keep');
  if (((await b.getAttribute('aria-pressed')) === 'true') !== on) await b.click();
  await page.waitForTimeout(60);
};
/** Digita nella casella dell'angolo e (se `enter`) conferma. */
async function typeAngle(page, text, enter = true) {
  const inp = page.locator('.ctx-angle-input');
  await inp.click();
  await inp.fill(text);
  if (enter) await inp.press('Enter');
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------- 1) selezione multipla con Ctrl + clic
const SEL_SPECS = [
  { k: 'segment', pts: [[0.15, 0.80], [0.45, 0.82]] }, // 1
  { k: 'segment', pts: [[0.15, 0.70], [0.45, 0.66]] }, // 2
  { k: 'circle', a: [0.7, 0.7], b: [0.8, 0.7] }, // 3
  { k: 'segment', pts: [[0.15, 0.55], [0.45, 0.55]] }, // 4
  { k: 'text', at: [0.6, 0.4], text: 'FORO', pt: 12 }, // 5
];
/** I punti dove cliccare sui cinque oggetti di SEL_SPECS (schermo) e un punto vuoto. */
async function selPoints(page) {
  const objs = await objectsOf(page);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const ts = objs[4] ? G.userToSheet(objs[4].at) : { x: 0, y: 0 };
  return {
    objs,
    s1: await clientOfUser(page, mid(objs[0].points[0], objs[0].points[1])),
    s2: await clientOfUser(page, mid(objs[1].points[0], objs[1].points[1])),
    c3: objs[2] ? await clientOfUser(page, objs[2].p2) : null,
    s4: objs[3] ? await clientOfUser(page, mid(objs[3].points[0], objs[3].points[1])) : null,
    t5: await clientOfSheet(page, { x: ts.x + 4, y: ts.y - 3 }),
    empty: await clientOfUser(page, userOf(await pageInfo(page), [0.3, 0.15])),
  };
}
async function selectionSuite(browser) {
  setSection('selezione multipla con Ctrl + clic');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SEL_SPECS);
  await tool(page, 'Seleziona');
  const P = await selPoints(page);
  const idle = 'Seleziona: tocca un oggetto, poi trascinalo';
  check('Seleziona: il testo guida di prima (nessuna selezione)', (await hint(page)) === idle, await hint(page));
  const bar0 = await barH(page);
  await click(page, P.s1);
  check('un clic seleziona un oggetto: "Selezionata: Retta"', (await hint(page)) === 'Selezionata: Retta' && (await selShapes(page)) === 1, await hint(page));
  check('... e l\'id e\' quello giusto', sameJSON(await selIds(page), [P.objs[0].id]), JSON.stringify(await selIds(page)));
  await click(page, P.s2, ['Control']);
  check('Ctrl + clic su un altro oggetto lo AGGIUNGE: "Selezionati: 2 oggetti"', (await hint(page)) === 'Selezionati: 2 oggetti', await hint(page));
  check('... due forme evidenziate (l\'unione, nessun riquadro complessivo)', (await selShapes(page)) === 2);
  check('... gli id sono i due oggetti', sameJSON(await selIds(page), [P.objs[0].id, P.objs[1].id]), JSON.stringify(await selIds(page)));
  check('... e la barra contestuale non cambia altezza (una riga di testo)', (await barH(page)) === bar0, `${bar0} -> ${await barH(page)}`);
  await click(page, P.c3, ['Control']);
  await click(page, P.t5, ['Control']);
  check('si aggiungono anche il cerchio e il testo: "Selezionati: 4 oggetti"', (await hint(page)) === 'Selezionati: 4 oggetti' && (await selShapes(page)) === 4, await hint(page));
  await click(page, P.s2, ['Control']);
  check('Ctrl + clic su un oggetto GIA\' selezionato lo TOGLIE', (await hint(page)) === 'Selezionati: 3 oggetti' && sameJSON(await selIds(page), [P.objs[0].id, P.objs[2].id, P.objs[4].id]), `${await hint(page)} ${JSON.stringify(await selIds(page))}`);
  const hBefore = await undoTitle(page);
  await click(page, P.empty, ['Control']);
  check('Ctrl + clic nel vuoto non cambia niente', (await hint(page)) === 'Selezionati: 3 oggetti' && (await selShapes(page)) === 3);
  await click(page, P.s1);
  check('un clic semplice su un oggetto di una selezione multipla la riduce a quell\'oggetto', (await hint(page)) === 'Selezionata: Retta' && (await selShapes(page)) === 1, await hint(page));
  await click(page, P.s2, ['Control']);
  await click(page, P.s4, ['Control']);
  // Ctrl + clic con un piccolo movimento (entro la soglia di 8 px): toglie l'oggetto e non avvia il trascinamento
  const before = await objectsOf(page);
  await page.keyboard.down('Control');
  await page.mouse.move(P.s2.x, P.s2.y);
  await page.mouse.down();
  await page.mouse.move(P.s2.x + 3, P.s2.y + 2, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(80);
  check('Ctrl + clic su un oggetto selezionato con un piccolo movimento (3 px) lo toglie', (await hint(page)) === 'Selezionati: 2 oggetti' && sameJSON(await selIds(page), [P.objs[0].id, P.objs[3].id]), `${await hint(page)} ${JSON.stringify(await selIds(page))}`);
  check('... e non sposta nulla (nessun comando nuovo)', sameJSON(await objectsOf(page), before) && (await undoTitle(page)) === hBefore, `${await undoTitle(page)}`);
  await click(page, P.empty);
  check('un clic nel vuoto azzera tutta la selezione', (await hint(page)) === idle && (await selShapes(page)) === 0);
  // Esc, cambio di strumento
  await click(page, P.s1);
  await click(page, P.s2, ['Control']);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Esc azzera la selezione multipla', (await hint(page)) === idle && (await selShapes(page)) === 0);
  await click(page, P.s1);
  await click(page, P.s2, ['Control']);
  await tool(page, 'Retta');
  await tool(page, 'Seleziona');
  check('cambiare strumento azzera la selezione multipla', (await hint(page)) === idle && (await selShapes(page)) === 0);
  // proprieta': con piu' oggetti i controlli di stile non lavorano sul gruppo e non cambiano le proprieta' dei nuovi oggetti
  await click(page, P.s1);
  const s1props = await page.evaluate(() => (window.__gtpdf.sessionProps ? window.__gtpdf.sessionProps() : null));
  const clickAllStyle = () => page.evaluate(() => { for (const b of document.querySelectorAll('.style-ctl button')) b.click(); });
  const objsBefore1 = await objectsOf(page);
  await clickAllStyle();
  const objsAfter1 = await objectsOf(page);
  check('(premessa) con UN oggetto selezionato i controlli di stile cambiano lui', !sameJSON(objsBefore1, objsAfter1));
  check('... e non le proprieta\' dei nuovi oggetti', sameJSON(await page.evaluate(() => (window.__gtpdf.sessionProps ? window.__gtpdf.sessionProps() : null)), s1props));
  await click(page, P.s2, ['Control']);
  const propsMulti0 = await page.evaluate(() => (window.__gtpdf.sessionProps ? window.__gtpdf.sessionProps() : null));
  const objsMulti0 = await objectsOf(page);
  const undoMulti0 = await undoTitle(page);
  await clickAllStyle();
  await page.evaluate(() => { for (const i of document.querySelectorAll('.style-ctl input')) { i.value = '3'; i.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(100);
  check('con 2 oggetti selezionati i controlli di stile NON cambiano le proprieta\' dei nuovi oggetti (stroke e corpo del testo di sessione)', sameJSON(await page.evaluate(() => (window.__gtpdf.sessionProps ? window.__gtpdf.sessionProps() : null)), propsMulti0) && propsMulti0 !== null, JSON.stringify(propsMulti0));
  check('... ne gli oggetti selezionati (nessun comando nuovo)', sameJSON(await objectsOf(page), objsMulti0) && (await undoTitle(page)) === undoMulti0);
  const ctl = await page.evaluate(() => ({
    chipVisible: !!document.querySelector('.ctx-style') && getComputedStyle(document.querySelector('.ctx-style')).visibility !== 'hidden' && getComputedStyle(document.querySelector('.ctx-style')).display !== 'none',
    visibleSections: [...document.querySelectorAll('.insp-sec .style-ctl .ctl-sec')].filter((s) => !s.hidden && s.getBoundingClientRect().height > 0).length,
    title: [...document.querySelectorAll('.insp-h')].map((e) => e.textContent).find((t) => /Proprietà/.test(t)),
  }));
  check('... i controlli sono nascosti (riquadro e sezioni del pannello) e il pannello dice quanti oggetti sono selezionati', !ctl.chipVisible && ctl.visibleSections === 0 && /2 oggetti selezionati/.test(ctl.title ?? ''), JSON.stringify(ctl));
  await ctx.close();

  // pagina: cambiare pagina azzera la selezione
  const c2 = await desktop(browser);
  await openSample(c2.page, '3 pagine miste');
  G = makeGeom(await c2.page.evaluate(() => window.__gtpdf.pages()[0]));
  await c2.page.evaluate(() => window.__gtpdf.fit());
  await c2.page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SEL_SPECS.slice(0, 2));
  await tool(c2.page, 'Seleziona');
  const P2 = await selPoints(c2.page);
  await click(c2.page, P2.s1);
  await click(c2.page, P2.s2, ['Control']);
  const n = await c2.page.evaluate(async () => { await window.__gtpdf.goTo(2); await window.__gtpdf.goTo(1); return 0; });
  await c2.page.waitForTimeout(300);
  check('cambiare pagina azzera la selezione multipla', n === 0 && (await hint(c2.page)) === idle && (await selShapes(c2.page)) === 0, await hint(c2.page));
  await c2.ctx.close();
}

// ---------------------------------------------------------------- 2) trascinamento di una selezione multipla
async function dragSuite(browser) {
  setSection('trascinamento di una selezione multipla');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SEL_SPECS);
  await tool(page, 'Seleziona');
  const P = await selPoints(page);
  const r = await canvasRect(page);
  const k = r.width / G.width;
  const drag = async (from, dx, dy, mods = [], steps = 6, mid = null) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps });
    if (mid) await mid();
    await page.mouse.move(from.x + dx, from.y + dy, { steps });
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(100);
  };
  // le selezioni: s1 + s2 + cerchio
  await click(page, P.s1);
  await click(page, P.s2, ['Control']);
  await click(page, P.c3, ['Control']);
  const before = await objectsOf(page);
  const sel3 = await selIds(page);
  const DX = 60;
  const DY = 40;
  let midState = null;
  await drag(P.s2, DX, DY, [], 6, async () => {
    midState = await page.evaluate(() => ({
      tr: [...document.querySelectorAll('.sc-objects [data-id]')].map((e) => [e.dataset.id, e.getAttribute('transform')]),
      sel: document.querySelector('.sc-sel')?.getAttribute('transform') ?? null,
    }));
  });
  check('durante il trascinamento tutti gli oggetti selezionati e l\'alone seguono il puntatore (stesso spostamento), gli altri no', !!midState && ['1', '2', '3'].every((id) => /translate/.test(midState.tr.find((t) => t[0] === id)?.[1] ?? '')) && ['4', '5'].every((id) => !midState.tr.find((t) => t[0] === id)?.[1]) && /translate/.test(midState.sel ?? ''), JSON.stringify(midState));
  const after = await objectsOf(page);
  // atteso: spostamento sul foglio = spostamento del mouse / k, riportato nello spazio utente (calcolo indipendente)
  // lo spostamento del mouse (px) / zoom e' noto a mezzo pixel di scarto del rettangolo del canvas: 0.02 pt; ma e' lo STESSO per ogni punto di ogni oggetto (1e-9)
  const dUser = { x: after[0].points[0].x - before[0].points[0].x, y: after[0].points[0].y - before[0].points[0].y };
  const f = (p) => G.userToSheet({ x: G.sheetToUser(p).x + dUser.x, y: G.sheetToUser(p).y + dUser.y });
  const movedErr = compareObjects(before.filter((o) => sel3.includes(o.id)), after.filter((o) => sel3.includes(o.id)), f, 1e-9, false);
  check('lo spostamento e\' lo STESSO per ogni punto di ogni oggetto selezionato (trascinando da un oggetto qualsiasi: 1e-9 pt)', movedErr === null, movedErr ?? '');
  const sd0 = G.userToSheet({ x: 0, y: 0 });
  const sd1 = G.userToSheet(dUser);
  check('... ed e\' lo spostamento del mouse sul foglio (calcolo indipendente, 0.02 pt)', near(sd1.x - sd0.x, DX / k, 0.02) && near(sd1.y - sd0.y, DY / k, 0.02), `${sd1.x - sd0.x} ${DX / k} / ${sd1.y - sd0.y} ${DY / k}`);
  check('gli oggetti non selezionati non si muovono', sameJSON(before.filter((o) => !sel3.includes(o.id)), after.filter((o) => !sel3.includes(o.id))));
  check('"3 oggetti spostati. Annulla li rimette a posto."', (await status(page)) === '3 oggetti spostati. Annulla li rimette a posto.', await status(page));
  check('un solo comando: "Annulla Sposta 3 oggetti"', (await undoTitle(page)) === 'Annulla Sposta 3 oggetti', await undoTitle(page));
  check('la selezione resta la stessa dopo il trascinamento', sameJSON(await selIds(page), sel3));
  await page.locator('.undo-ctl button').first().click();
  check('UN solo Annulla rimette tutti i 3 oggetti ai valori di prima (identici)', sameJSON(await objectsOf(page), before));
  await page.locator('.undo-ctl button').nth(1).click();
  check('Ripeti riapplica gli stessi valori', sameJSON(await objectsOf(page), after));
  await page.locator('.undo-ctl button').first().click();
  // un oggetto solo: lo stesso messaggio e la stessa etichetta di prima
  await click(page, P.s4);
  const b4 = await objectsOf(page);
  await drag(P.s4, 30, -20);
  const a4 = await objectsOf(page);
  const err4 = compareObjects(b4.filter((o) => o.id === 4), a4.filter((o) => o.id === 4), movSheet(30 / k, -20 / k), 0.02);
  check('un oggetto solo: spostato come il mouse (calcolo indipendente, 0.02 pt)', err4 === null && sameJSON(b4.filter((o) => o.id !== 4), a4.filter((o) => o.id !== 4)), err4 ?? '');
  check('... "Retta spostata. Annulla la rimette a posto." e "Annulla Sposta retta" (come prima)', (await status(page)) === 'Retta spostata. Annulla la rimette a posto.' && (await undoTitle(page)) === 'Annulla Sposta retta', `${await status(page)} / ${await undoTitle(page)}`);
  await page.locator('.undo-ctl button').first().click();
  // il punto premuto su un oggetto NON selezionato: sposta la vista
  await click(page, P.s1);
  await click(page, P.s2, ['Control']);
  const bPan = await objectsOf(page);
  const r0 = await canvasRect(page);
  await drag(P.c3, 50, 30);
  const r1 = await canvasRect(page);
  check('premendo su un oggetto NON selezionato il trascinamento sposta la vista (gli oggetti non cambiano, la selezione resta)', sameJSON(await objectsOf(page), bPan) && r1.left - r0.left > 30 && r1.top - r0.top > 15 && (await hint(page)) === 'Selezionati: 2 oggetti', `${r1.left - r0.left} ${r1.top - r0.top}`);
  // Ctrl premuto all'inizio: non si avvia il trascinamento
  const P2 = await selPoints(page);
  const bCtl = await objectsOf(page);
  const uCtl = await undoTitle(page);
  await drag(P2.s1, 40, 25, ['Control']);
  check('con Ctrl premuto all\'inizio del gesto NON si avvia il trascinamento dell\'oggetto selezionato (la vista si sposta)', sameJSON(await objectsOf(page), bCtl) && (await undoTitle(page)) === uCtl, `${await undoTitle(page)}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 3) Canc su piu' oggetti
async function deleteSuite(browser) {
  setSection('Canc su piu\' oggetti');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SEL_SPECS);
  await tool(page, 'Seleziona');
  const P = await selPoints(page);
  const before = await objectsOf(page);
  await click(page, P.s1);
  await click(page, P.c3, ['Control']);
  await click(page, P.t5, ['Control']);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  check('Backspace NON cancella la selezione (decisione 57)', sameJSON(await objectsOf(page), before));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  const left = await objectsOf(page);
  check('Canc cancella TUTTA la selezione con un solo comando: restano gli altri due oggetti', sameJSON(left.map((o) => o.id), [2, 4]), JSON.stringify(left.map((o) => o.id)));
  check('"3 oggetti cancellati. Annulla li ripristina." e "Annulla Cancella 3 oggetti"', (await status(page)) === '3 oggetti cancellati. Annulla li ripristina.' && (await undoTitle(page)) === 'Annulla Cancella 3 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
  check('la selezione e\' azzerata', (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo' && (await selShapes(page)) === 0);
  await page.locator('.undo-ctl button').first().click();
  check('UN solo Annulla li rimette TUTTI, ognuno al suo posto, nell\'ordine di prima', sameJSON(await objectsOf(page), before), JSON.stringify((await objectsOf(page)).map((o) => o.id)));
  await page.locator('.undo-ctl button').nth(1).click();
  check('Ripeti li cancella di nuovo', sameJSON((await objectsOf(page)).map((o) => o.id), [2, 4]));
  await page.locator('.undo-ctl button').first().click();
  // un oggetto: il messaggio di sempre
  await click(page, P.s4);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  check('un oggetto solo: "Retta cancellata. Annulla la ripristina." (come prima)', (await status(page)) === 'Retta cancellata. Annulla la ripristina.' && (await undoTitle(page)) === 'Annulla Cancella retta', `${await status(page)} / ${await undoTitle(page)}`);
  await page.locator('.undo-ctl button').first().click();
  // lo strumento Cancella cancella un oggetto per volta (non cambia)
  await tool(page, 'Cancella');
  await click(page, P.s1);
  check('lo strumento Cancella resta "un oggetto per volta"', (await objectsOf(page)).length === 4 && (await status(page)) === 'Retta cancellata. Annulla la ripristina.');
  await ctx.close();
}

// ---------------------------------------------------------------- strumenti per le trasformazioni
/** Apre una pagina di prova pronta per le trasformazioni: griglia accesa (nodi esatti), snap spenti, tutti i tipi di oggetto presenti, strumento Seleziona. `scale` = mm reali per pt. */
async function prepare(browser, title, scale = null) {
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  if (scale) {
    await page.evaluate((m) => window.__gtpdf.setScale(1, m), scale);
    STEP = 10 / scale; // 10 mm REALI sul foglio
  }
  await gridMode(page);
  const objs = await addAll(page);
  await tool(page, 'Seleziona');
  return { ctx, page, objs };
}
const undoBtn = (page) => page.locator('.undo-ctl button').first();
const redoBtn = (page) => page.locator('.undo-ctl button').nth(1);
/** I rifiuti non devono lasciare traccia: stessi oggetti, stessa etichetta di Annulla. */
async function snapshot(page) {
  return { objs: await objectsOf(page), undo: await undoTitle(page), redo: await redoTitle(page) };
}
const unchanged = async (page, snap) => sameJSON(await objectsOf(page), snap.objs) && (await undoTitle(page)) === snap.undo;
const ghostCount = (page) => page.evaluate(() => document.querySelector('.sc-ghost')?.children.length ?? 0);
const toolPressed = (page, label) => page.locator(`button.tool[title="${label}"]`).getAttribute('aria-pressed');
const countOf = (n) => (n === 1 ? '1' : String(n));

// ---------------------------------------------------------------- 4) Sposta
async function moveCase(browser, title, label, scale) {
  const tag = `${label}${scale ? ', con scala' : ''}`;
  setSection(`Sposta, ${tag}`);
  const { ctx, page, objs } = await prepare(browser, title, scale);
  const all = objs.map((o) => o.id);
  await selectIdsHook(page, all);
  const snapBefore = await snapshot(page);
  check(`${tag}: con la selezione i tre pulsanti sono attivi, il testo e' "Selezionati: 13 oggetti"`, (await hint(page)) === 'Selezionati: 13 oggetti' && (await page.$$eval('.ctx-tr', (b) => b.map((x) => !x.disabled && !x.hidden))).every(Boolean));
  const barSel = await barH(page);
  await armBtn(page, 'Sposta');
  check(`${tag}: Sposta: "indica il punto base", compare "Mantieni l'originale" (spento di partenza), Seleziona resta acceso in palette`, (await hint(page)) === 'Sposta: indica il punto base' && (await page.locator('.ctx-keep').isVisible()) && (await page.locator('.ctx-keep').getAttribute('aria-pressed')) === 'false' && (await toolPressed(page, 'Seleziona')) === 'true', await hint(page));
  check(`${tag}: la barra contestuale ha la stessa altezza`, (await barH(page)) === barSel, `${barSel} -> ${await barH(page)}`);
  await clickNode(page, 3, 10);
  check(`${tag}: dopo il punto base: "indica il punto di arrivo"`, (await hint(page)) === 'Sposta: indica il punto di arrivo', await hint(page));
  await page.mouse.move((await clientOfNode(page, 6, 7)).x + 3, (await clientOfNode(page, 6, 7)).y - 2);
  await page.waitForTimeout(120);
  check(`${tag}: con il punto di arrivo sotto il mouse si vede l'anteprima di tutti gli oggetti (solo a schermo)`, (await ghostCount(page)) === 13, `${await ghostCount(page)}`);
  const before = await objectsOf(page);
  await clickNode(page, 6, 7);
  const after = await objectsOf(page);
  const err = compareObjects(before, after, movSheet(3 * STEP, 3 * STEP), 1e-6);
  check(`${tag}: ogni punto di tutti i 13 tipi di oggetto si sposta di (3, 3) passi della griglia: calcolo indipendente, 1e-6 pt nello spazio utente`, err === null, err ?? '');
  check(`${tag}: "13 oggetti spostati. Annulla li rimette a posto." e "Annulla Sposta 13 oggetti"`, (await status(page)) === '13 oggetti spostati. Annulla li rimette a posto.' && (await undoTitle(page)) === 'Annulla Sposta 13 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
  check(`${tag}: si resta con Seleziona e la selezione passa agli stessi oggetti; l'anteprima sparisce`, (await hint(page)) === 'Selezionati: 13 oggetti' && sameJSON(await selIds(page), all) && (await ghostCount(page)) === 0 && !(await page.locator('.ctx-keep').isVisible()), await hint(page));
  await undoBtn(page).click();
  check(`${tag}: UN solo Annulla rimette tutti i 13 oggetti ai valori di prima (identici)`, sameJSON(await objectsOf(page), before) && (await undoTitle(page)) === snapBefore.undo, `${await undoTitle(page)} / ${snapBefore.undo}`);
  await redoBtn(page).click();
  check(`${tag}: Ripeti riapplica gli stessi valori`, sameJSON(await objectsOf(page), after));
  await undoBtn(page).click();
  // spostamento nullo
  await armBtn(page, 'Sposta');
  await clickNode(page, 3, 10);
  await clickNode(page, 3, 10);
  check(`${tag}: spostamento nullo: rifiutato con un messaggio, nessun comando, il punto base resta`, /Spostamento nullo/.test(await status(page)) && sameJSON(await objectsOf(page), snapBefore.objs) && (await hint(page)) === 'Sposta: indica il punto di arrivo', `${await status(page)} / ${await hint(page)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check(`${tag}: Esc annulla la trasformazione e lascia la selezione com'e'`, (await hint(page)) === 'Selezionati: 13 oggetti' && sameJSON(await selIds(page), all) && (await unchanged(page, snapBefore)), `${await hint(page)} / ${await undoTitle(page)} / ${snapBefore.undo}`);
  // ORTO: l'arrivo si porta sull'asse del punto base
  await setToggle(page, 'ortho', true);
  await armBtn(page, 'Sposta');
  await clickNode(page, 3, 10);
  await clickNode(page, 8, 11); // piu' lontano in orizzontale: l'ORTO lo porta alla stessa riga del punto base
  const afterO = await objectsOf(page);
  const errO = compareObjects(before, afterO, movSheet(5 * STEP, 0), 1e-6);
  check(`${tag}: con ORTO l'arrivo e' sulla riga del punto base: spostamento (5, 0) passi, esatto`, errO === null, errO ?? '');
  await undoBtn(page).click();
  await setToggle(page, 'ortho', false);
  await ctx.close();
}

async function moveSnapAndKeep(browser) {
  setSection('Sposta con snap, Mantieni l\'originale e Duplica');
  const { ctx, page, objs } = await prepare(browser, 'A4 vettoriale');
  // snap: estremo del segmento -> estremo della linea (esatti)
  await setToggle(page, 'grid', false);
  await setToggle(page, 'end', true);
  const segEnd = objs[0].points[1];
  const polyEnd = objs[1].points[2];
  const three = [objs[0].id, objs[2].id, objs[8].id]; // retta, cerchio, testo
  await selectIdsHook(page, three);
  const before = await objectsOf(page);
  await armBtn(page, 'Sposta');
  await click(page, await clientOfUser(page, segEnd), [], 3, 2);
  await click(page, await clientOfUser(page, polyEnd), [], -3, 2);
  const after = await objectsOf(page);
  info(`snap: stato "${await status(page)}", selezione ${JSON.stringify(await selIds(page))}`);
  const s0 = G.userToSheet(segEnd);
  const s1 = G.userToSheet(polyEnd);
  const sub = (list) => list.filter((o) => three.includes(o.id));
  const err = compareObjects(sub(before), sub(after), movSheet(s1.x - s0.x, s1.y - s0.y), 1e-6);
  check('Sposta con snap sugli estremi: base = estremo della retta, arrivo = estremo della linea: spostamento esatto (1e-6 pt)', err === null && sameJSON(before.filter((o) => !three.includes(o.id)), after.filter((o) => !three.includes(o.id))), err ?? '');
  check('... "3 oggetti spostati..." e un solo Annulla', (await status(page)) === '3 oggetti spostati. Annulla li rimette a posto.' && (await undoTitle(page)) === 'Annulla Sposta 3 oggetti');
  await undoBtn(page).click();
  await setToggle(page, 'end', false);
  await setToggle(page, 'grid', true);

  // Mantieni l'originale
  const base = await snapshot(page);
  await armBtn(page, 'Sposta');
  await keepToggle(page, true);
  check('"Mantieni l\'originale" si accende dalla barra durante la trasformazione', (await page.locator('.ctx-keep').getAttribute('aria-pressed')) === 'true');
  await clickNode(page, 3, 10);
  await clickNode(page, 6, 7);
  const kept = await objectsOf(page);
  const orig = base.objs;
  const maxId = Math.max(...orig.map((o) => o.id));
  const copies = kept.slice(orig.length);
  check('con "Mantieni l\'originale" acceso gli originali restano uguali e le copie sono in fondo, nello stesso ordine relativo (retta, cerchio, testo), con id nuovi', sameJSON(kept.slice(0, orig.length), orig) && copies.length === 3 && sameJSON(copies.map((o) => o.kind), ['segment', 'circle', 'text']) && copies.every((o) => o.id > maxId) && new Set(kept.map((o) => o.id)).size === kept.length, JSON.stringify(copies.map((o) => [o.id, o.kind])));
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); for (const k of ['id', 'points', 'at', 'p1', 'p2', 'p3', 'a', 'b']) delete c[k]; return c; };
  check('le copie hanno le stesse proprieta\' degli originali (tratto, colore, corpo, testo) e i punti spostati (calcolo indipendente)', sub(orig).every((o, i) => sameJSON(strip(o), strip(copies[i]))) && copies.every((c, i) => ptsOf(c).every((p, k) => nearP(p, expUser(ptsOf(sub(orig)[i])[k], movSheet(3 * STEP, 3 * STEP)), 1e-6))));
  check('"3 copie create e spostate: gli originali restano. Annulla le toglie." e "Annulla Sposta 3 oggetti (copia)"', (await status(page)) === '3 copie create e spostate: gli originali restano. Annulla le toglie.' && (await undoTitle(page)) === 'Annulla Sposta 3 oggetti (copia)', `${await status(page)} / ${await undoTitle(page)}`);
  check('la selezione passa alle COPIE', sameJSON(await selIds(page), copies.map((o) => o.id)) && (await hint(page)) === 'Selezionati: 3 oggetti', JSON.stringify(await selIds(page)));
  await undoBtn(page).click();
  check('UN solo Annulla toglie tutte le copie (gli originali restano com\'erano)', sameJSON(await objectsOf(page), orig));
  await redoBtn(page).click();
  const redone = await objectsOf(page);
  check('Ripeti reinserisce gli STESSI oggetti con gli stessi id', sameJSON(redone, kept), JSON.stringify(redone.slice(orig.length).map((o) => o.id)));
  await undoBtn(page).click();
  check('annullata l\'aggiunta delle copie, la selezione non le contiene piu\' (escono dalla selezione): nessun oggetto selezionato', (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo' && (await selShapes(page)) === 0, await hint(page));
  await selectIdsHook(page, three);
  await armBtn(page, 'Sposta');
  check('"Mantieni l\'originale" resta com\'era per tutta la sessione (acceso)', (await page.locator('.ctx-keep').getAttribute('aria-pressed')) === 'true');
  await keepToggle(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Esc: la selezione resta (le tre di prima)', sameJSON(await selIds(page), three));
  await armBtn(page, 'Sposta');
  check('... e spento si ricorda spento', (await page.locator('.ctx-keep').getAttribute('aria-pressed')) === 'false');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---------------------------------------------------------------- 5) Specchio
const AXES = {
  orizzontale: [[2, 12], [8, 12]],
  verticale: [[10, 5], [10, 12]],
  'a 45 gradi': [[4, 6], [9, 11]],
  obliquo: [[3, 10], [8, 12]],
};
async function mirrorCase(browser, title, label) {
  setSection(`Specchio, ${label}`);
  const { ctx, page, objs } = await prepare(browser, title);
  const common = ids(objs, COMMON);
  await selectIdsHook(page, common);
  const snap0 = await snapshot(page);
  const before = snap0.objs;
  for (const [axName, [n1, n2]] of Object.entries(AXES)) {
    await armBtn(page, 'Specchio');
    if (axName === 'orizzontale') check(`${label}: Specchio: "indica il primo punto dell'asse" e poi "il secondo"`, (await hint(page)) === 'Specchio: indica il primo punto dell\'asse', await hint(page));
    await clickNode(page, n1[0], n1[1]);
    if (axName === 'orizzontale') check(`${label}: ... dopo il primo punto: "indica il secondo punto dell'asse"`, (await hint(page)) === 'Specchio: indica il secondo punto dell\'asse', await hint(page));
    const hv = await clientOfNode(page, n2[0], n2[1]);
    await page.mouse.move(hv.x + 3, hv.y - 2);
    await page.waitForTimeout(100);
    if (axName === 'orizzontale') check(`${label}: con il secondo punto sotto il mouse si vede l'anteprima dei 9 oggetti`, (await ghostCount(page)) === 9, `${await ghostCount(page)}`);
    await click(page, hv, [], 3, -2);
    const after = await objectsOf(page);
    const f = mirSheet(node(...n1), node(...n2));
    const err = compareSel(before, after, common, f, 1e-6, true);
    check(`${label}: asse ${axName}: ogni punto va dove dice il calcolo indipendente (1e-6 pt; testo escluso, vedi sotto)`, err === null, err ?? '');
    const arcB = before.find((o) => o.kind === 'arc');
    const arcA = after.find((o) => o.kind === 'arc');
    check(`${label}: asse ${axName}: l'arco si specchia: il verso dei tre punti (il segno dello sweep) si inverte`, orient(arcB) === -orient(arcA) && orient(arcA) !== 0);
    // il testo: il riquadro dritto ha il centro nel punto specchiato -> l'angolo in basso a sinistra non e' piu' dov'era (a meno di un caso simmetrico) e resta un solo punto
    const tB = before.find((o) => o.kind === 'text');
    const tA = after.find((o) => o.kind === 'text');
    check(`${label}: asse ${axName}: il testo si sposta (resta dritto: ha ancora il solo angolo in basso a sinistra, stesso testo e corpo)`, !nearP(tB.at, tA.at, 1e-3) && tA.text === tB.text && tA.textPt === tB.textPt && Object.keys(tA).sort().join() === Object.keys(tB).sort().join());
    check(`${label}: asse ${axName}: "9 oggetti specchiati. Annulla li rimette a posto." e un solo comando`, (await status(page)) === '9 oggetti specchiati. Annulla li rimette a posto.' && (await undoTitle(page)) === 'Annulla Specchia 9 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
    await undoBtn(page).click();
    check(`${label}: asse ${axName}: un solo Annulla restituisce i valori ESATTI di prima`, sameJSON(await objectsOf(page), before));
  }
  // asse coincidente
  await armBtn(page, 'Specchio');
  await clickNode(page, 5, 5);
  await clickNode(page, 5, 5);
  check(`${label}: i due punti dell'asse coincidenti: rifiutati con un messaggio (non i 6 px: la soglia e' 0.001 pt), il primo punto resta`, /coincidono/.test(await status(page)) && sameJSON(await objectsOf(page), snap0.objs) && (await hint(page)) === 'Specchio: indica il secondo punto dell\'asse', `${await status(page)} / ${await hint(page)}`);
  await page.keyboard.press('Escape');
  // quote orizzontale e verticale
  const hv = ids(objs, ['dimHoriz', 'dimVert']);
  await selectIdsHook(page, hv);
  const beforeHV = await objectsOf(page);
  for (const [axName, [n1, n2]] of Object.entries(AXES)) {
    const ok = axName === 'orizzontale' || axName === 'verticale';
    await armBtn(page, 'Specchio');
    await clickNode(page, n1[0], n1[1]);
    await clickNode(page, n2[0], n2[1]);
    if (ok) {
      const err = compareSel(beforeHV, await objectsOf(page), hv, mirSheet(node(...n1), node(...n2)), 1e-6);
      check(`${label}: quote orizzontale e verticale, asse ${axName}: si specchiano (calcolo indipendente)`, err === null && (await status(page)) === '2 oggetti specchiati. Annulla li rimette a posto.', err ?? (await status(page)));
      await undoBtn(page).click();
    } else {
      check(`${label}: quote orizzontale e verticale, asse ${axName}: RIFIUTATO con un messaggio che dice che cosa fare, niente cambia`, /Specchio: le quote orizzontali e verticali si specchiano solo con un asse orizzontale o verticale/.test(await status(page)) && sameJSON(await objectsOf(page), beforeHV) && (await hint(page)) === 'Specchio: indica il secondo punto dell\'asse', await status(page));
      await page.keyboard.press('Escape');
    }
  }
  // con ORTO l'asse e' orizzontale o verticale
  await setToggle(page, 'ortho', true);
  await armBtn(page, 'Specchio');
  await clickNode(page, 6, 8);
  await clickNode(page, 10, 9);
  const errO = compareSel(beforeHV, await objectsOf(page), hv, mirSheet(node(6, 8), node(10, 8)), 1e-6);
  check(`${label}: con ORTO l'asse e' orizzontale: le quote orizzontale e verticale si specchiano`, errO === null, errO ?? (await status(page)));
  await undoBtn(page).click();
  await setToggle(page, 'ortho', false);
  // coperture rettangolare e quadrata: assi a multipli di 45 gradi
  const cv = ids(objs, ['coverRect', 'coverSquare']);
  await selectIdsHook(page, cv);
  const beforeC = await objectsOf(page);
  for (const [axName, [n1, n2]] of Object.entries(AXES)) {
    const ok = axName !== 'obliquo';
    await armBtn(page, 'Specchio');
    await clickNode(page, n1[0], n1[1]);
    await clickNode(page, n2[0], n2[1]);
    if (ok) {
      const err = compareSel(beforeC, await objectsOf(page), cv, mirSheet(node(...n1), node(...n2)), 1e-6);
      check(`${label}: coperture rettangolare e quadrata, asse ${axName}: si specchiano (calcolo indipendente)`, err === null, err ?? (await status(page)));
      await undoBtn(page).click();
    } else {
      check(`${label}: coperture rettangolare e quadrata, asse obliquo: RIFIUTATO (resterebbero non allineate agli assi), niente cambia`, /Specchio: le coperture rettangolari e quadrate si specchiano solo/.test(await status(page)) && sameJSON(await objectsOf(page), beforeC), await status(page));
      await page.keyboard.press('Escape');
    }
  }
  // un solo oggetto: messaggi con il genere
  await selectIdsHook(page, [objs[IDX.segment].id]);
  await armBtn(page, 'Specchio');
  await clickNode(page, 2, 12);
  await clickNode(page, 8, 12);
  check(`${label}: un oggetto: "Retta specchiata. Annulla la rimette a posto." e "Annulla Specchia retta"`, (await status(page)) === 'Retta specchiata. Annulla la rimette a posto.' && (await undoTitle(page)) === 'Annulla Specchia retta', `${await status(page)} / ${await undoTitle(page)}`);
  await undoBtn(page).click();
  await selectIdsHook(page, [objs[IDX.arc].id]);
  await armBtn(page, 'Specchio');
  await clickNode(page, 2, 12);
  await clickNode(page, 8, 12);
  check(`${label}: un arco: "Arco specchiato. Annulla lo rimette a posto."`, (await status(page)) === 'Arco specchiato. Annulla lo rimette a posto.', await status(page));
  await ctx.close();
}

// ---------------------------------------------------------------- 6) Rotazione
async function rotateCase(browser, title, label) {
  setSection(`Rotazione, ${label}`);
  const { ctx, page, objs } = await prepare(browser, title);
  const common = ids(objs, COMMON);
  await selectIdsHook(page, common);
  const snap0 = await snapshot(page);
  const before = snap0.objs;
  const C = node(9, 14);
  await armBtn(page, 'Rotazione');
  check(`${label}: Rotazione: "indica il centro", casella dell'angolo visibile con il pulsante Origine (disattivato: la pagina non ha origine)`, (await hint(page)) === 'Rotazione: indica il centro' && (await page.locator('.ctx-angle-input').isVisible()) && (await page.locator('.ctx-origin-center').isDisabled()), await hint(page));
  await clickNode(page, 9, 14);
  check(`${label}: dopo il centro: "digita l'angolo", la casella ha il fuoco (il passo dopo e' solo digitare)`, /Rotazione: digita l'angolo/.test(await hint(page)) && (await page.evaluate(() => document.activeElement?.classList.contains('ctx-angle-input'))), await hint(page));
  // anteprima mentre si digita
  await typeAngle(page, '30', false);
  check(`${label}: mentre si digita l'angolo si vede l'anteprima dei 9 oggetti`, (await ghostCount(page)) === 9, `${await ghostCount(page)}`);
  await page.locator('.ctx-angle-input').fill('');
  await page.waitForTimeout(80);
  check(`${label}: con la casella vuota l'anteprima sparisce`, (await ghostCount(page)) === 0);
  for (const deg of [90, 45, -30]) {
    await typeAngle(page, String(deg));
    const after = await objectsOf(page);
    const err = compareSel(before, after, common, rotSheet(C, deg), 1e-6, true);
    check(`${label}: ${deg} gradi attorno al centro: ogni punto va dove dice il calcolo indipendente (antiorario come si vede, 1e-6 pt; testo escluso)`, err === null, err ?? '');
    const arcB = before.find((o) => o.kind === 'arc');
    const arcA = after.find((o) => o.kind === 'arc');
    check(`${label}: ${deg} gradi: il verso dell'arco non cambia (la rotazione conserva lo sweep)`, orient(arcB) === orient(arcA) && orient(arcA) !== 0);
    const tB = before.find((o) => o.kind === 'text');
    const tA = after.find((o) => o.kind === 'text');
    check(`${label}: ${deg} gradi: il testo si sposta ma resta dritto (stesso testo e corpo, un solo punto)`, !nearP(tB.at, tA.at, 1e-3) && tA.text === tB.text && tA.textPt === tB.textPt && Object.keys(tA).sort().join() === Object.keys(tB).sort().join());
    check(`${label}: ${deg} gradi: "9 oggetti ruotati. Annulla li rimette a posto." e un solo comando`, (await status(page)) === '9 oggetti ruotati. Annulla li rimette a posto.' && (await undoTitle(page)) === 'Annulla Ruota 9 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
    await undoBtn(page).click();
    check(`${label}: ${deg} gradi: un solo Annulla restituisce i valori ESATTI di prima`, sameJSON(await objectsOf(page), before));
    await armBtn(page, 'Rotazione');
    await clickNode(page, 9, 14);
  }
  // rifiuti: niente cambia, il centro resta
  const rejects = [
    ['30,5', /Usa il punto per i decimali/],
    ['0', /niente da ruotare/],
    ['360', /niente da ruotare/],
    ['-720', /niente da ruotare/],
    ['abc', /non è un numero/],
    ['3601', /troppo grande.*3600/],
    ['', /Digita l'angolo in gradi/],
  ];
  for (const [text, re] of rejects) {
    await typeAngle(page, text);
    check(`${label}: angolo "${text}": rifiutato con un messaggio chiaro, niente cambia`, re.test(await status(page)) && sameJSON(await objectsOf(page), before) && (await page.locator('.ctx-angle-input').getAttribute('aria-invalid')) === 'true' && /Rotazione: digita/.test(await hint(page)), `${await status(page)} / ${await hint(page)}`);
  }
  // Esc nella casella: prima la svuota, poi annulla la trasformazione (la selezione resta)
  await typeAngle(page, '12', false);
  await page.locator('.ctx-angle-input').press('Escape');
  check(`${label}: Esc nella casella la svuota`, (await page.locator('.ctx-angle-input').inputValue()) === '' && /Rotazione: digita/.test(await hint(page)));
  await page.locator('.ctx-angle-input').press('Escape');
  await page.waitForTimeout(80);
  check(`${label}: Esc a casella vuota annulla la trasformazione e la selezione resta`, (await hint(page)) === 'Selezionati: 9 oggetti' && sameJSON(await selIds(page), common) && sameJSON(await objectsOf(page), before));
  // Backspace e Canc nella casella editano la casella: non cancellano gli oggetti selezionati
  await armBtn(page, 'Rotazione');
  await clickNode(page, 9, 14);
  const inp = page.locator('.ctx-angle-input');
  await inp.fill('123');
  await inp.press('Backspace');
  await inp.press('Delete');
  check(`${label}: Backspace e Canc nella casella editano la casella e non cancellano gli oggetti`, (await inp.inputValue()) === '12' && sameJSON(await objectsOf(page), before), await inp.inputValue());
  // un clic sostituisce il centro; Ctrl+Z toglie il centro
  await inp.fill('90');
  await clickNode(page, 4, 8);
  const mk = await page.evaluate(() => document.querySelectorAll('.sc-markers > *').length);
  check(`${label}: un nuovo clic sostituisce il centro (un solo segno sul foglio) e il valore digitato resta`, mk === 1 && (await inp.inputValue()) === '90', `${mk}`);
  await typeAngle(page, '90');
  const errC = compareSel(before, await objectsOf(page), common, rotSheet(node(4, 8), 90), 1e-6, true);
  check(`${label}: ... e la rotazione usa il nuovo centro`, errC === null, errC ?? '');
  await undoBtn(page).click();
  await armBtn(page, 'Rotazione');
  await clickNode(page, 4, 8);
  await page.locator('.ctx-angle-input').blur();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  check(`${label}: Ctrl+Z toglie il centro indicato (e non annulla la cronologia)`, (await hint(page)) === 'Rotazione: indica il centro' && sameJSON(await objectsOf(page), before), await hint(page));
  await page.keyboard.press('Escape');
  // il centro e' l'origine della pagina (pulsante Origine)
  const o = G.sheetToUser(node(5, 5));
  await page.evaluate((p) => window.__gtpdf.setOrigin(1, p), o);
  await selectIdsHook(page, common);
  await armBtn(page, 'Rotazione');
  check(`${label}: con un'origine sulla pagina il pulsante Origine e' attivo`, await page.locator('.ctx-origin-center').isEnabled());
  await page.locator('.ctx-origin-center').click();
  await typeAngle(page, '180');
  const errO = compareSel(before, await objectsOf(page), common, rotSheet(node(5, 5), 180), 1e-6, true);
  check(`${label}: centro = origine, 180 gradi: calcolo indipendente`, errO === null && (await status(page)) === '9 oggetti ruotati. Annulla li rimette a posto.', errO ?? (await status(page)));
  await undoBtn(page).click();
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  // coperture rettangolare e quadrata: solo multipli di 90 gradi
  const cv = ids(objs, ['coverRect', 'coverSquare']);
  await selectIdsHook(page, cv);
  const beforeC = await objectsOf(page);
  await armBtn(page, 'Rotazione');
  await clickNode(page, 9, 14);
  await typeAngle(page, '45');
  check(`${label}: coperture rettangolare e quadrata a 45 gradi: RIFIUTATO con un messaggio, niente cambia`, /Rotazione: le coperture rettangolari e quadrate ruotano solo di multipli di 90 gradi/.test(await status(page)) && sameJSON(await objectsOf(page), beforeC), await status(page));
  for (const deg of [90, 180, 270, -90]) {
    await typeAngle(page, String(deg));
    const err = compareSel(beforeC, await objectsOf(page), cv, rotSheet(C, deg), 1e-6);
    check(`${label}: coperture rettangolare e quadrata, ${deg} gradi: calcolo indipendente`, err === null, err ?? (await status(page)));
    await undoBtn(page).click();
    await armBtn(page, 'Rotazione');
    await clickNode(page, 9, 14);
  }
  await page.keyboard.press('Escape');
  await page.locator('.ctx-angle-input').press('Escape').catch(() => {});
  await page.keyboard.press('Escape');
  // quote orizzontale e verticale: escluse dalla rotazione
  const hv = ids(objs, ['dimHoriz', 'dimVert']);
  await selectIdsHook(page, hv);
  const beforeH = await objectsOf(page);
  await armBtn(page, 'Rotazione');
  await clickNode(page, 9, 14);
  for (const text of ['90', '180', '37']) {
    await typeAngle(page, text);
    check(`${label}: quote orizzontale e verticale, ${text} gradi: ESCLUSE dalla rotazione, con la frase che dice cosa fare`, /Rotazione: le quote orizzontali e verticali non ruotano\. Deselezionale o usa Sposta\./.test(await status(page)) && sameJSON(await objectsOf(page), beforeH), await status(page));
  }
  await page.locator('.ctx-angle-input').press('Escape');
  await page.locator('.ctx-angle-input').press('Escape');
  await ctx.close();
}

// ---------------------------------------------------------------- 7) selezione mista (tutto o niente) e limiti
async function mixedSuite(browser) {
  setSection('selezione mista: tutto o niente, limiti di coordinata');
  const { ctx, page, objs } = await prepare(browser, 'A4 vettoriale');
  const mixed = [objs[IDX.segment].id, objs[IDX.dimHoriz].id, objs[IDX.circle].id];
  await selectIdsHook(page, mixed);
  const snap0 = await snapshot(page);
  await armBtn(page, 'Rotazione');
  await clickNode(page, 9, 14);
  await typeAngle(page, '45');
  check('selezione mista (retta, quota orizzontale, cerchio): la Rotazione rifiuta TUTTO, con la ragione; la retta e il cerchio non si muovono', /non ruotano/.test(await status(page)) && sameJSON(await objectsOf(page), snap0.objs), await status(page));
  await page.locator('.ctx-angle-input').press('Escape');
  await page.locator('.ctx-angle-input').press('Escape');
  await armBtn(page, 'Specchio');
  await clickNode(page, 3, 10);
  await clickNode(page, 8, 12);
  check('... lo Specchio con un asse obliquo: rifiuta tutto', /solo con un asse orizzontale o verticale/.test(await status(page)) && sameJSON(await objectsOf(page), snap0.objs), await status(page));
  await clickNode(page, 8, 10); // secondo punto diverso: l'asse e' orizzontale
  const err = compareSel(snap0.objs, await objectsOf(page), mixed, mirSheet(node(3, 10), node(8, 10)), 1e-6);
  check('... poi con un asse orizzontale (secondo punto scelto di nuovo, il primo era rimasto) si specchiano tutti e tre', err === null && (await status(page)) === '3 oggetti specchiati. Annulla li rimette a posto.', err ?? (await status(page)));
  await undoBtn(page).click();
  await armBtn(page, 'Sposta');
  await clickNode(page, 3, 10);
  await clickNode(page, 5, 11);
  const errM = compareSel(snap0.objs, await objectsOf(page), mixed, movSheet(2 * STEP, -1 * STEP), 1e-6);
  check('... Sposta e\' ammesso per tutti i tipi (quota orizzontale compresa)', errM === null, errM ?? (await status(page)));
  await undoBtn(page).click();
  // limiti: un risultato fuori da +-1.000.000 pt non si applica, niente cambia
  const lim = await page.evaluate(() => {
    const ok = window.__gtpdf.applyTransform({ kind: 'move', dx: 2e6, dy: 0 });
    return { ok, status: document.querySelector('.st-msg').textContent };
  });
  check('un risultato fuori dai limiti del file (+-1.000.000 pt) non si applica e un messaggio lo dice', lim.ok === false && /limiti del foglio/.test(lim.status) && sameJSON(await objectsOf(page), snap0.objs), JSON.stringify(lim));
  const lim2 = await page.evaluate(() => window.__gtpdf.applyTransform({ kind: 'rotate', center: { x: 5e6, y: 5e6 }, deg: 90 }));
  check('... anche con una rotazione attorno a un centro lontanissimo', lim2 === false && sameJSON(await objectsOf(page), snap0.objs));
  const okNear = await page.evaluate(() => window.__gtpdf.applyTransform({ kind: 'move', dx: 900, dy: 0 }));
  check('... e un risultato dentro i limiti anche se fuori dalla pagina si applica (nessun controllo "dentro la pagina", come il trascinamento di oggi)', okNear === true && !sameJSON(await objectsOf(page), snap0.objs));
  await ctx.close();
}

// ---------------------------------------------------------------- 8) menu Modifica, Duplica, Cancella selezione
async function menuSuite(browser) {
  setSection('menu Modifica, Duplica e Cancella selezione');
  const { ctx, page, objs } = await prepare(browser, 'A4 vettoriale');
  const names = (items) => items.map((i) => i.text.replace(/\s+/g, ' '));
  const m0 = await menuState(page, 'Modifica');
  const has = (items, re) => items.find((i) => re.test(i.text));
  check('menu Modifica: la voce "Copia" non c\'e\' piu\' (con "Mantieni l\'originale" e Duplica la funzione e\' coperta)', !has(m0, /^Copia/), JSON.stringify(names(m0)));
  check('menu Modifica: le voci nuove ci sono (Sposta, Specchia, Ruota, Duplica, Cancella selezione) e "Cancella" resta', ['Sposta selezione', 'Specchia selezione', 'Ruota selezione', 'Duplica selezione', 'Cancella selezione', 'Cancella'].every((l) => !!has(m0, new RegExp(`^${l}( |$)`))), JSON.stringify(names(m0)));
  check('senza selezione le voci sulla selezione sono disattivate; "Cancella" e "Seleziona / sposta" no', ['Sposta selezione', 'Specchia selezione', 'Ruota selezione', 'Duplica selezione', 'Cancella selezione'].every((l) => has(m0, new RegExp(`^${l}`)).disabled) && !has(m0, /^Cancella$/).disabled && !has(m0, /^Seleziona/).disabled, JSON.stringify(m0));
  const common = ids(objs, COMMON);
  await selectIdsHook(page, common);
  const m1 = await menuState(page, 'Modifica');
  check('con una selezione le cinque voci sono attive', ['Sposta selezione', 'Specchia selezione', 'Ruota selezione', 'Duplica selezione', 'Cancella selezione'].every((l) => !has(m1, new RegExp(`^${l}`)).disabled), JSON.stringify(m1));
  // Sposta dal menu
  await menuItem(page, 'Modifica', /^Sposta selezione/);
  check('"Sposta selezione" dal menu arma Sposta (selezione intatta)', (await hint(page)) === 'Sposta: indica il punto base' && (await page.locator('.ctx-keep').isVisible()));
  const mT = await menuState(page, 'Modifica');
  check('durante la trasformazione le voci sulla selezione sono disattivate e Ripeti anche', ['Sposta selezione', 'Specchia selezione', 'Ruota selezione', 'Duplica selezione', 'Cancella selezione'].every((l) => has(mT, new RegExp(`^${l}`)).disabled) && has(mT, /^Ripeti/).disabled, JSON.stringify(mT));
  await page.keyboard.press('Escape');
  await menuItem(page, 'Modifica', /^Specchia selezione/);
  check('"Specchia selezione" dal menu', (await hint(page)) === 'Specchio: indica il primo punto dell\'asse');
  await page.keyboard.press('Escape');
  await menuItem(page, 'Modifica', /^Ruota selezione/);
  check('"Ruota selezione" dal menu', (await hint(page)) === 'Rotazione: indica il centro');
  await page.keyboard.press('Escape');
  // Duplica
  const before = await objectsOf(page);
  await menuItem(page, 'Modifica', /^Duplica selezione/);
  const after = await objectsOf(page);
  const copies = after.slice(before.length);
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.id; return c; };
  const orderedOrig = before.filter((o) => common.includes(o.id));
  check('Duplica: 9 copie in fondo, nello stesso ordine relativo, con le STESSE coordinate e proprieta\' degli originali (sul posto) e id nuovi', sameJSON(after.slice(0, before.length), before) && copies.length === 9 && orderedOrig.every((o, i) => sameJSON(strip(o), strip(copies[i]))) && copies.every((c) => c.id > Math.max(...before.map((o) => o.id))), JSON.stringify(copies.map((c) => c.id)));
  check('... la selezione passa alle copie, "9 oggetti duplicati. Annulla li toglie." e "Annulla Duplica 9 oggetti"', sameJSON(await selIds(page), copies.map((c) => c.id)) && (await status(page)) === '9 oggetti duplicati. Annulla li toglie.' && (await undoTitle(page)) === 'Annulla Duplica 9 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
  await undoBtn(page).click();
  check('UN solo Annulla toglie tutte le copie; la selezione e\' vuota (le copie non ci sono piu\')', sameJSON(await objectsOf(page), before) && (await selShapes(page)) === 0);
  await redoBtn(page).click();
  check('Ripeti reinserisce le STESSE copie (stessi id)', sameJSON(await objectsOf(page), after));
  // le copie si spostano con Sposta: gli originali restano (la selezione non fa parte della cronologia: si riseleziona)
  await selectIdsHook(page, copies.map((c) => c.id));
  await armBtn(page, 'Sposta');
  await clickNode(page, 3, 10);
  await clickNode(page, 5, 12);
  const moved = await objectsOf(page);
  const errCp = compareSel(after, moved, copies.map((c) => c.id), movSheet(2 * STEP, -2 * STEP), 1e-6);
  check('le copie si spostano (Sposta) e gli originali restano dove sono', sameJSON(moved.slice(0, before.length), before) && errCp === null, `${errCp} / ${await status(page)}`);
  await undoBtn(page).click();
  // Duplica di un oggetto solo
  await selectIdsHook(page, [objs[IDX.circle].id]);
  await menuItem(page, 'Modifica', /^Duplica selezione/);
  check('un oggetto: "Cerchio duplicato. Annulla lo toglie." (genere giusto)', (await status(page)) === 'Cerchio duplicato. Annulla lo toglie.', await status(page));
  await undoBtn(page).click();
  // Cancella selezione
  await selectIdsHook(page, common);
  const b2 = await objectsOf(page);
  await menuItem(page, 'Modifica', /^Cancella selezione/);
  check('"Cancella selezione" cancella tutta la selezione con un solo comando', (await objectsOf(page)).length === b2.length - 9 && (await status(page)) === '9 oggetti cancellati. Annulla li ripristina.' && (await undoTitle(page)) === 'Annulla Cancella 9 oggetti', `${await status(page)} / ${await undoTitle(page)}`);
  await undoBtn(page).click();
  check('... e un solo Annulla li rimette nell\'ordine di prima', sameJSON(await objectsOf(page), b2));
  // "Cancella" attiva lo strumento Cancella (non cambia)
  await menuItem(page, 'Modifica', /^Cancella$/);
  check('la voce "Cancella" attiva sempre lo strumento Cancella', /^Cancella: tocca un oggetto/.test(await hint(page)));
  // lo stato degli oggetti con un solo selezionato: Rotazione disponibile
  await ctx.close();
}

// ---------------------------------------------------------------- 9) tastiera e annullamento durante la trasformazione
async function keyboardSuite(browser) {
  setSection('tastiera durante la trasformazione');
  const { ctx, page, objs } = await prepare(browser, '3 pagine miste');
  const common = ids(objs, COMMON);
  await selectIdsHook(page, common);
  const snap0 = await snapshot(page);
  await armBtn(page, 'Sposta');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  check('Ctrl+Z senza punti: non annulla la cronologia, dice di usare Esc', /Nessun punto da togliere/.test(await status(page)) && (await undoTitle(page)) === snap0.undo && sameJSON(await objectsOf(page), snap0.objs), await status(page));
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Ripeti e Canc durante la trasformazione non fanno nulla (Canc non cancella la selezione)', sameJSON(await objectsOf(page), snap0.objs) && (await hint(page)) === 'Sposta: indica il punto base');
  check('i pulsanti Annulla e Ripeti dell\'intestazione: Ripeti disattivato durante la trasformazione', await redoBtn(page).isDisabled());
  await clickNode(page, 3, 10);
  check('dopo il punto base Annulla toglie "l\'ultimo punto"', /ultimo punto/.test((await undoTitle(page)) ?? '') || /ultimo punto/.test((await page.locator('.undo-ctl button').first().getAttribute('title')) ?? ''));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  check('Ctrl+Z toglie il punto base indicato (si torna a "indica il punto base")', (await hint(page)) === 'Sposta: indica il punto base' && sameJSON(await objectsOf(page), snap0.objs));
  await clickNode(page, 3, 10);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);
  check('Backspace toglie l\'ultimo punto (come per le costruzioni) e non cancella oggetti', (await hint(page)) === 'Sposta: indica il punto base' && sameJSON(await objectsOf(page), snap0.objs));
  // pulsante Annulla della barra
  await clickNode(page, 3, 10);
  await page.locator('.ctx-act', { hasText: 'Annulla' }).click();
  check('il pulsante Annulla della barra annulla la trasformazione e lascia la selezione', (await hint(page)) === 'Selezionati: 9 oggetti' && sameJSON(await selIds(page), common));
  // Esc: prima la trasformazione, poi la selezione
  await armBtn(page, 'Specchio');
  await clickNode(page, 3, 10);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Esc: prima annulla la trasformazione (la selezione resta)', (await hint(page)) === 'Selezionati: 9 oggetti');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('... poi azzera la selezione', (await selShapes(page)) === 0 && (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo');
  // cambio di strumento dalla palette annulla la trasformazione e azzera la selezione
  await selectIdsHook(page, common);
  await armBtn(page, 'Sposta');
  await tool(page, 'Retta');
  await tool(page, 'Seleziona');
  check('cambiare strumento durante la trasformazione la annulla e azzera la selezione', (await selShapes(page)) === 0 && sameJSON(await objectsOf(page), snap0.objs));
  // cambio di pagina durante la trasformazione
  await selectIdsHook(page, common);
  await armBtn(page, 'Rotazione');
  await clickNode(page, 3, 10);
  await page.evaluate(async () => { await window.__gtpdf.goTo(2); });
  await page.waitForTimeout(300);
  check('cambiare pagina durante la trasformazione la annulla: strumento Seleziona, nessuna selezione, la casella dell\'angolo e\' nascosta', (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo' && (await selShapes(page)) === 0 && !(await page.locator('.ctx-angle-input').isVisible()) && (await toolPressed(page, 'Seleziona')) === 'true', await hint(page));
  await page.evaluate(async () => { await window.__gtpdf.goTo(1); });
  check('... e tornando alla pagina 1 gli oggetti sono quelli di prima', sameJSON(await objectsOf(page), snap0.objs));
  await ctx.close();
}

// ---------------------------------------------------------------- 10) file progetto: oggetti trasformati
async function projectSuite(browser) {
  setSection('file progetto con oggetti trasformati');
  const { ctx, page, objs } = await prepare(browser, 'A4 con /Rotate 90');
  const all = objs.map((o) => o.id);
  const common = ids(objs, COMMON);
  // sposta tutti i 13, specchia i 9 (asse orizzontale), ruota i 9 di 90 gradi, copia 3 spostandoli
  await selectIdsHook(page, all);
  await armBtn(page, 'Sposta'); await clickNode(page, 3, 10); await clickNode(page, 5, 9);
  await selectIdsHook(page, common);
  await armBtn(page, 'Specchio'); await clickNode(page, 2, 12); await clickNode(page, 8, 12);
  await armBtn(page, 'Rotazione'); await clickNode(page, 9, 14); await typeAngle(page, '90');
  await selectIdsHook(page, [objs[IDX.segment].id, objs[IDX.circle].id, objs[IDX.text].id]);
  await armBtn(page, 'Sposta'); await keepToggle(page, true); await clickNode(page, 3, 10); await clickNode(page, 4, 9);
  const S0 = await state(page);
  check('(premessa) gli oggetti sono stati trasformati: 16 oggetti (13 + 3 copie)', S0.pages[0].objects.length === 16, String(S0.pages[0].objects.length));
  const text0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text0);
  check('il formato del file NON cambia: versione 4 e gli stessi campi di pagina di CP6d (nessun nuovo tipo di oggetto)', j.version === 4 && j.format === 'gt-pdf-project' && JSON.stringify(Object.keys(j.pages[0])) === JSON.stringify(['number', 'view', 'rotate', 'userUnit', 'scale', 'origin', 'objects']), JSON.stringify(Object.keys(j.pages[0])));
  check('il progetto scritto contiene gli oggetti trasformati (stessi punti, stesso ordine) e la lettura lo accetta', JSON.stringify(j.pages[0].objects) === JSON.stringify(S0.pages[0].objects) && (await page.evaluate(async () => (await window.__gtpdf.projectText()).ok)) === true);
  const sample = readFileSync(join(PDF_DIR, 'a4-rotate90.pdf'));
  await menuItem(page, 'File', /^Salva con nome/);
  const d = page.locator('.save-dialog');
  await d.waitFor();
  await d.locator('.btn.primary', { hasText: 'Salva' }).click();
  await d.locator('.exp-done-actions').waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
  const saved = readFileSync(await dl.path());
  await d.locator('.btn', { hasText: 'Chiudi' }).click();
  const sj = JSON.parse(saved.toString('utf8'));
  check('il file scaricato contiene gli oggetti trasformati', sj.version === 4 && JSON.stringify(sj.pages[0].objects) === JSON.stringify(S0.pages[0].objects));
  await menuItem(page, 'File', /^Chiudi/);
  await page.waitForTimeout(300);
  const dlg = page.locator('.dialog .btn', { hasText: /Chiudi|Procedi|Scarta/ });
  if (await dlg.count()) await dlg.first().click().catch(() => {});
  await page.waitForTimeout(300);
  const first = page.waitForEvent('filechooser');
  await menuItem(page, 'File', /^Apri progetto/);
  await (await first).setFiles({ name: 'progetto.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await page.locator('.open-project-dialog').waitFor();
  const second = page.waitForEvent('filechooser');
  await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
  await (await second).setFiles({ name: 'a4-rotate90.pdf', mimeType: 'application/pdf', buffer: Buffer.from(sample) });
  await page.waitForTimeout(900);
  const S1 = await state(page);
  check('salvato e riaperto: lo stato (oggetti con tutti i punti, ordine, proprieta\') e\' IDENTICO (state())', JSON.stringify(S1.pages[0].objects) === JSON.stringify(S0.pages[0].objects) && JSON.stringify(S1.pages[0].texts) === JSON.stringify(S0.pages[0].texts), `${S1.pages[0].objects.length}`);
  const text1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('... e il progetto riscritto e\' identico', JSON.stringify(JSON.parse(text1).pages) === JSON.stringify(j.pages));
  await ctx.close();
}

// ---------------------------------------------------------------- 11) esportazione: un oggetto trasformato = uno creato sui punti finali
async function exportCase(browser, title, label) {
  setSection(`esportazione di oggetti trasformati, ${label}`);
  const sha = (b64) => lib.shaBuf(Buffer.from(b64, 'base64'));
  const hashes = async (page) => {
    const h = {};
    for (const [name, opts] of [['simple', { mode: 'simple' }], ['flat', { mode: 'flat', dpi: 150, format: 'png' }]]) {
      await page.evaluate((o) => window.__gtpdf.runExport({ ...o, keep: true }), opts);
      h[name] = await sha(await page.evaluate(() => window.__gtpdf.lastExportBase64()));
    }
    return h;
  };
  // percorso 1: oggetti creati nei punti di partenza e trasformati con l'app
  const B = await prepare(browser, title);
  const objs = B.objs;
  const all = objs.map((o) => o.id);
  const common = ids(objs, COMMON);
  await selectIdsHook(B.page, all);
  await armBtn(B.page, 'Sposta'); await clickNode(B.page, 3, 10); await clickNode(B.page, 5, 9);
  await selectIdsHook(B.page, common);
  await armBtn(B.page, 'Specchio'); await clickNode(B.page, 2, 12); await clickNode(B.page, 8, 12);
  await armBtn(B.page, 'Rotazione'); await clickNode(B.page, 9, 14); await typeAngle(B.page, '90');
  await selectIdsHook(B.page, [objs[IDX.segment].id, objs[IDX.circle].id, objs[IDX.text].id]);
  await armBtn(B.page, 'Sposta'); await keepToggle(B.page, true); await clickNode(B.page, 3, 10); await clickNode(B.page, 4, 9);
  const finalObjs = await objectsOf(B.page);
  const hB = await hashes(B.page);
  // percorso 2: gli stessi oggetti finali creati direttamente (stesso ordine e proprieta')
  const A = await desktop(browser);
  await openDoc(A.page, title);
  await A.page.evaluate((list) => window.__gtpdf.add(1, list), finalObjs.map((o) => { const c = JSON.parse(JSON.stringify(o)); delete c.id; return c; }));
  await A.page.waitForTimeout(200);
  const hA = await hashes(A.page);
  check(`${label}: esportazione "Copertura semplice" di oggetti trasformati (16 oggetti, tutti i tipi) = oggetti creati sui punti finali (stessi byte)`, hA.simple === hB.simple, `${hA.simple} / ${hB.simple}`);
  check(`${label}: esportazione "Appiattito" (150 dpi, PNG) = oggetti creati sui punti finali (stessa pagina rasterizzata)`, hA.flat === hB.flat, `${hA.flat} / ${hB.flat}`);
  // la premessa: l'esportazione cambia davvero con la trasformazione (non e' un confronto vuoto)
  const C = await desktop(browser);
  await openDoc(C.page, title);
  await C.page.evaluate((list) => window.__gtpdf.add(1, list), objs.map((o) => { const c = JSON.parse(JSON.stringify(o)); delete c.id; return c; }));
  await C.page.waitForTimeout(200);
  const hC = await hashes(C.page);
  check(`${label}: (premessa) il PDF esportato prima della trasformazione e' DIVERSO da quello dopo`, hC.simple !== hB.simple && hC.flat !== hB.flat);
  const state0 = await state(B.page);
  check(`${label}: (premessa) la trasformazione ha dato oggetti diversi dall'originale`, !sameJSON(state0.pages[0].objects.slice(0, 13).map((o) => ptsOf(o)), objs.map((o) => ptsOf(o))));
  await B.ctx.close(); await A.ctx.close(); await C.ctx.close();
}

// ---------------------------------------------------------------- 12) altezza della barra contestuale
async function barSuite(browser) {
  for (const [w, h, uiSize] of [[1280, 900, 1], [1024, 768, 1], [900, 700, 1], [720, 700, 1], [720, 700, 4], [390, 780, 1], [390, 780, 4]]) {
    setSection(`barra contestuale ${w}x${h} A+ ${uiSize}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
    await page.addInitScript((u) => localStorage.setItem('gtpdf.uiSize', String(u)), uiSize);
    await page.goto(APP_URL);
    await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
    await openDoc(page, 'A4 vettoriale');
    const objs = await addAll(page);
    const common = ids(objs, COMMON);
    await tool(page, 'Seleziona');
    const m = {};
    m.nessuna = await barH(page);
    await selectIdsHook(page, [objs[0].id]);
    m.una = await barH(page);
    await selectIdsHook(page, common);
    m.nove = await barH(page);
    await armBtn(page, 'Sposta');
    m.sposta = await barH(page);
    await page.keyboard.press('Escape');
    await armBtn(page, 'Specchio');
    m.specchio = await barH(page);
    await page.keyboard.press('Escape');
    await armBtn(page, 'Rotazione');
    m.rotazione = await barH(page);
    await clickNode(page, 9, 14);
    m.rotazioneCentro = await barH(page);
    const rows = await page.evaluate(() => ({ hintH: document.querySelector('.ctx-hint').getBoundingClientRect().height, vw: window.innerWidth, scrollW: document.documentElement.scrollWidth }));
    info(`${w}x${h} A+ ${uiSize}: barra contestuale (px): nessuna selezione ${m.nessuna}, un oggetto ${m.una}, nove ${m.nove}, Sposta ${m.sposta}, Specchio ${m.specchio}, Rotazione ${m.rotazione}, Rotazione con il centro ${m.rotazioneCentro}; testo guida ${rows.hintH} px`);
    check(`${w}x${h} A+ ${uiSize}: selezionare (nessuno, uno, nove oggetti) non cambia l'altezza della barra`, m.nessuna === m.una && m.una === m.nove, JSON.stringify(m));
    check(`${w}x${h} A+ ${uiSize}: armare Sposta o Specchio non cambia l'altezza della barra (il foglio non si ridimensiona sotto il mouse)`, m.sposta === m.nove && m.specchio === m.nove, JSON.stringify(m));
    check(`${w}x${h} A+ ${uiSize}: la pagina non esce dallo schermo in larghezza`, rows.scrollW <= rows.vw + 0.5, `${rows.scrollW} / ${rows.vw}`);
    await page.keyboard.press('Escape');
    await page.locator('.ctx-angle-input').press('Escape').catch(() => {});
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 13) tocco emulato: solo come guardia
async function touchSuite(browser, w, h) {
  setSection(`tocco emulato ${w}x${h}`);
  const { ctx, page, cdp } = await phone(browser, w, h);
  await openDoc(page, 'A4 vettoriale');
  await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SEL_SPECS.slice(0, 2));
  const mm = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  check(`${w}x${h}: (premessa) con il tocco emulato il puntatore preciso con hover e' falso`, mm === false);
  await tool(page, 'Seleziona');
  const objs = await objectsOf(page);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const tapAt = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(60);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(120);
  };
  const c1 = await clientOfUser(page, mid(objs[0].points[0], objs[0].points[1]));
  await tapAt(c1);
  check(`${w}x${h}: con il dito un tocco seleziona un oggetto, come prima ("Selezionata: Retta")`, (await hint(page)) === 'Selezionata: Retta' && (await selShapes(page)) === 1, await hint(page));
  const before = await objectsOf(page);
  const c1b = await clientOfUser(page, mid(before[0].points[0], before[0].points[1]));
  await touch(cdp, 'touchStart', [[c1b.x, c1b.y]]);
  for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', [[c1b.x + i * 5, c1b.y + i * 3]]); await page.waitForTimeout(16); }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(120);
  const after = await objectsOf(page);
  check(`${w}x${h}: trascinando l'oggetto selezionato con il dito si sposta (un solo oggetto: "Retta spostata..." come prima)`, !sameJSON(before[0], after[0]) && sameJSON(before[1], after[1]) && (await status(page)) === 'Retta spostata. Annulla la rimette a posto.', await status(page));
  check(`${w}x${h}: i pulsanti Sposta e Specchio ci sono e sono attivi con una selezione; la Rotazione e' disattivata (l'angolo si digita: solo mouse o trackpad)`, (await page.locator('.ctx-tr[data-transform=move]').isEnabled()) && (await page.locator('.ctx-tr[data-transform=mirror]').isEnabled()) && (await page.locator('.ctx-tr[data-transform=rotate]').isDisabled()));
  const menu = await menuState(page, 'Modifica');
  check(`${w}x${h}: nel menu Modifica "Ruota selezione" e' disattivata e le altre voci sulla selezione sono attive`, menu.find((i) => /^Ruota selezione/.test(i.text))?.disabled === true && menu.find((i) => /^Sposta selezione/.test(i.text))?.disabled === false, JSON.stringify(menu));
  await tapAt(await clientOfUser(page, { x: 0, y: 0 }).catch(() => ({ x: 5, y: 400 })));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only || only.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di 2b26073, dove un controllo che serve non c'e') lo dice con un controllo fallito e le altre proseguono.
  const guarded = async (id, name, fn) => {
    if (!run(id)) return;
    try {
      await fn();
    } catch (e) {
      setSection(name);
      check(`la serie "${name}" si e' interrotta: ${String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160)}`, false, process.env.E2E_DEBUG ? String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join(' | ') : '');
    }
  };
  try {
    await guarded('selezione', 'selezione multipla', () => selectionSuite(browser));
    await guarded('trascina', 'trascinamento', () => dragSuite(browser));
    await guarded('canc', 'Canc su piu\' oggetti', () => deleteSuite(browser));
    for (const [title, label] of PAGES) {
      await guarded('sposta', `Sposta, ${label}`, () => moveCase(browser, title, label, null));
    }
    await guarded('sposta', 'Sposta, con scala', () => moveCase(browser, 'A4 con /Rotate 90', 'pagina /Rotate 90', 0.5));
    await guarded('sposta', 'Sposta con snap e Mantieni l\'originale', () => moveSnapAndKeep(browser));
    for (const [title, label] of PAGES) {
      await guarded('specchio', `Specchio, ${label}`, () => mirrorCase(browser, title, label));
    }
    for (const [title, label] of PAGES) {
      await guarded('rotazione', `Rotazione, ${label}`, () => rotateCase(browser, title, label));
    }
    await guarded('misto', 'selezione mista e limiti', () => mixedSuite(browser));
    await guarded('menu', 'menu Modifica', () => menuSuite(browser));
    await guarded('tastiera', 'tastiera durante la trasformazione', () => keyboardSuite(browser));
    await guarded('progetto', 'file progetto con oggetti trasformati', () => projectSuite(browser));
    for (const [title, label] of PAGES) {
      await guarded('export', `esportazione, ${label}`, () => exportCase(browser, title, label));
    }
    await guarded('barra', 'altezza della barra contestuale', () => barSuite(browser));
    // Tocco emulato solo a 390 x 780, come guardia (decisione 81: l'iPhone si usa pochissimo, le prove sono sul desktop).
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
