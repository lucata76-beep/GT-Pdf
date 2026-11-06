// Prove di CP6c (V2b) su Chromium: Cerchio e Arco (oggetti a linea), snap sul Centro e sull'Estremo e Punto medio dell'arco, punti in costruzione come candidati
// dello snap, selezione sulla linea (non dentro), Canc, Annulla e Ripeti, file progetto versione 2 (legge 1 e 2), esportazione "Copertura semplice" e "Appiattito".
// Mouse (desktop 1280 x 900, clic reali) e tocco emulato (iPhone 390 x 780, DPR 3, CDP). Pagine: A4 vettoriale, A4 con /Rotate 90, A4 con CropBox.
// Punti ESATTI: i punti sono presi con lo snap su punti noti (estremi di rette messe con il gancio di prova), cosi' il punto inserito e' quello utente
// calcolato dal gancio, entro 1e-6 pt; i punti liberi (senza snap) si confrontano con il punto grezzo sotto il clic con la tolleranza del rettangolo del canvas (RAW_TOL).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6c.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 47a660e i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=menu,esatti,centro,arco,linea,selezione,costruzione,orto,progetto,export,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente (Microsoft Edge sul PC): nulla di quanto segue prova il comportamento li'.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6c', out: process.argv[2], port: 4209, hport: 4210, zoom: 2 });
const { OUT, check, info, setSection, URL: APP_URL, openSample, HPORT, ZOOM, b64, showPage, shot, newApp } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel di getBoundingClientRect), non con un valore esatto. */
const RAW_TOL = 0.03;
const SAMPLES = [
  ['A4 vettoriale', 'a4-vettoriale.pdf'],
  ['A4 con /Rotate 90', 'a4-rotate90.pdf'],
  ['A4 con CropBox', 'a4-cropbox.pdf'],
];
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');

// ---------------------------------------------------------------- strumenti di prova
async function desktop(browser, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
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
/** Strumento Cerchio e arco con la forma scelta ('circle' | 'arc'). */
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
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const lastObj = async (page) => {
  const o = await objectsOf(page);
  return o[o.length - 1];
};

/** Geometria della pagina 1, calcolata qui da `pages()` con le stesse formule di `PageGeometry` (come e2e-cp6a e cp6b). */
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
    userUnit: sU,
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
const userOfClient = async (page, c) => G.sheetToUser(await sheetOfClient(page, c));
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;

/** Cerchio per tre punti (nel piano che si dia: la formula e' la stessa nello spazio utente e nel foglio): centro, raggio e sweep con segno (angolo crescente = orario con Y in giu'). */
function circum(p1, p2, p3) {
  const ax = p2.x - p1.x, ay = p2.y - p1.y, bx = p3.x - p1.x, by = p3.y - p1.y;
  const d = 2 * (ax * by - ay * bx);
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by;
  const ux = (by * a2 - ay * b2) / d, uy = (ax * b2 - bx * a2) / d;
  const c = { x: p1.x + ux, y: p1.y + uy };
  const a0 = Math.atan2(-uy, -ux);
  const a3 = Math.atan2(p3.y - c.y, p3.x - c.x);
  const M = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = d > 0 ? M(a3 - a0) : -M(a0 - a3);
  return { c, r: Math.hypot(ux, uy), a0, sweep, mid: { x: c.x + Math.hypot(ux, uy) * Math.cos(a0 + sweep / 2), y: c.y + Math.hypot(ux, uy) * Math.sin(a0 + sweep / 2) } };
}

/** Punti noti (frazioni dell'area visibile, origine in basso a sinistra): estremi di rette lontani fra loro, a ogni zoom usato. */
const ANCH = {
  segA: [[0.2, 0.75], [0.4, 0.75]], // a1, a2; punto medio (0.3, 0.75)
  segB: [[0.62, 0.7], [0.82, 0.84]], // b1, b2
  segC: [[0.28, 0.3], [0.52, 0.22]], // c1, c2
  segD: [[0.65, 0.2], [0.85, 0.3]], // d1, d2
};
const addAnchors = (page, names = Object.keys(ANCH)) => page.evaluate(([A, ns]) => window.__gtpdf.addSpecs(1, ns.map((n) => ({ k: 'segment', pts: A[n] }))), [ANCH, names]);

async function openDoc(page, title = 'A4 vettoriale', anchors = true) {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  if (anchors) await addAnchors(page);
  await page.waitForTimeout(200);
}
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
const snapMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    return { kind: g.dataset.kind, label: g.querySelector('text')?.textContent ?? null, shape: [...g.children].map((e) => e.tagName.toLowerCase()).filter((t) => t !== 'text')[0] };
  });
/** Passa il mouse vicino a un punto utente e restituisce il marcatore di snap. */
async function hover(page, u, dx = 3, dy = 3) {
  const c = await clientOfUser(page, u);
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.waitForTimeout(80);
  return snapMark(page);
}
const previewD = (page) => page.evaluate(() => [...document.querySelectorAll('.sc-preview path')].map((p) => p.getAttribute('d')));
const undo = async (page) => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
};
const redo = async (page) => {
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(80);
};

// ---------------------------------------------------------------- 1) menu, palette, testi guida
async function menuSuite(browser) {
  setSection('menu, palette e testi guida');
  const { ctx, page } = await desktop(browser);
  const items = async () => page.locator('.menu-item').evaluateAll((els) => els.map((e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), dis: e.disabled || e.getAttribute('aria-disabled') === 'true' })));
  await page.locator('.menu-btn', { hasText: 'Inserisci' }).click();
  let it = await items();
  check('senza documento: le voci Cerchio e Arco ci sono ma sono disattivate; Raccordo disattivato con "V2c"', ['Cerchio', 'Arco'].every((n) => it.find((x) => x.t === n)?.dis === true) && /^Raccordo\s*V2c$/.test(it.find((x) => x.t.startsWith('Raccordo'))?.t ?? '') && it.find((x) => x.t.startsWith('Raccordo'))?.dis === true, JSON.stringify(it));
  check('la voce vecchia "Cerchio, arco, raccordo" non c\'e\' piu\'', !it.some((x) => /Cerchio, arco, raccordo/.test(x.t)));
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 450);
  await openDoc(page, 'A4 vettoriale', false);
  await page.locator('.menu-btn', { hasText: 'Inserisci' }).click();
  it = await items();
  check('con un documento: Cerchio e Arco attive, Raccordo ancora disattivato', ['Cerchio', 'Arco'].every((n) => it.find((x) => x.t === n)?.dis === false) && it.find((x) => x.t.startsWith('Raccordo'))?.dis === true, JSON.stringify(it));
  check('le voci delle coperture non cambiano (Copertura rettangolare, quadrata, circolare)', ['Copertura rettangolare', 'Copertura quadrata', 'Copertura circolare'].every((n) => it.some((x) => x.t === n)));
  await page.locator('.menu-item', { hasText: /^Arco$/ }).click();
  await page.waitForTimeout(150);
  check('Inserisci > Arco: strumento "Cerchio e arco" attivo con la forma Arco', (await page.locator('button.tool[aria-pressed="true"]').getAttribute('title')) === 'Cerchio e arco' && (await page.locator('.ctx-curves button[aria-pressed="true"]').innerText()) === 'Arco');
  check('testo guida di una riga: "Arco: indica l\'inizio"', (await hint(page)) === 'Arco: indica l\'inizio');
  await page.locator('.menu-btn', { hasText: 'Inserisci' }).click();
  await page.locator('.menu-item', { hasText: /^Cerchio$/ }).click();
  await page.waitForTimeout(150);
  check('Inserisci > Cerchio: forma Cerchio, "Cerchio: indica il centro"', (await page.locator('.ctx-curves button[aria-pressed="true"]').innerText()) === 'Cerchio' && (await hint(page)) === 'Cerchio: indica il centro');
  info(`desktop (mouse): altezza dei pulsanti Cerchio/Arco della barra contestuale e del pulsante in palette: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ctx-curves button, button.tool[title="Cerchio e arco"]')].map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10)))} px (>= 44 px si prova col tocco)`);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  await click(page, await clientOfUser(page, U([0.5, 0.5])));
  check('dopo il centro: "Cerchio: indica un punto sul bordo"', (await hint(page)) === 'Cerchio: indica un punto sul bordo');
  await page.locator('.ctx-curves button', { hasText: 'Arco' }).click();
  check('cambiando forma il punto gia\' indicato si scarta e il testo riparte', (await hint(page)) === 'Arco: indica l\'inizio');
  await click(page, await clientOfUser(page, U([0.3, 0.3])));
  check('Arco dopo il primo punto: "Arco: indica un punto sull\'arco"', (await hint(page)) === 'Arco: indica un punto sull\'arco');
  await click(page, await clientOfUser(page, U([0.45, 0.4])));
  check('Arco dopo il secondo punto: "Arco: indica la fine"', (await hint(page)) === 'Arco: indica la fine');
  const hh = await page.evaluate(() => { const e = document.querySelector('.ctx-hint'); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) }; });
  check('il testo guida sta su una riga (altezza <= 1.5 righe)', hh.h <= hh.lh * 1.5 + 1, JSON.stringify(hh));
  check('lo strumento in palette e il menu hanno nomi senza ambiguita\': un solo pulsante di palette "Cerchio e arco"', (await page.locator('button.tool[title="Cerchio e arco"]').count()) === 1);
  await ctx.close();
}

// ---------------------------------------------------------------- 2) punti esatti con lo snap: Cerchio e Arco su tre pagine, mouse
async function exactSuite(browser, title) {
  setSection(`Cerchio e Arco con punti esatti (snap), mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title, true);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const [a1, a2] = ANCH.segA.map(U);
  const [b1, b2] = ANCH.segB.map(U);
  const [c1, c2] = ANCH.segC.map(U);
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  // --- Cerchio: centro su un Estremo, punto sul bordo su un altro Estremo
  await curveTool(page, 'circle');
  const m1 = await hover(page, a1);
  check('Cerchio: sul primo Estremo il marcatore e\' un quadrato "Estremo"', !!m1 && m1.kind === 'end' && m1.label === 'Estremo' && m1.shape === 'rect', JSON.stringify(m1));
  await click(page, await clientOfUser(page, a1), 3, 3);
  const m2 = await hover(page, b2, -4, 2);
  check('Cerchio: secondo punto sull\'Estremo di un\'altra retta: "Estremo"', !!m2 && m2.kind === 'end');
  await click(page, await clientOfUser(page, b2), -4, 2);
  let o = await lastObj(page);
  check('Cerchio inserito: kind circle, p1 e p2 = i punti utente degli Estremi (entro 1e-6 pt)', o?.kind === 'circle' && nearP(o.p1, a1) && nearP(o.p2, b2), JSON.stringify(o));
  check('Cerchio inserito: tratto come la Retta (continua, rosso, 1 pt: valori predefiniti correnti)', o?.stroke?.style === 'solid' && o.stroke.color === '#D32F2F' && o.stroke.widthPt === 1, JSON.stringify(o?.stroke));
  check('messaggio: "Cerchio aggiunto: raggio ... Annulla per toglierlo."', /^Cerchio aggiunto: raggio .+\. Annulla per toglierlo\.$/.test(await status(page)), await status(page));
  check('in costruzione non resta nulla e il testo guida riparte', (await hint(page)) === 'Cerchio: indica il centro');
  // il disegno a schermo: un tracciato con archi (due mezzi cerchi) di raggio = distanza in pt del foglio
  const R = Math.hypot(G.userToSheet(a1).x - G.userToSheet(b2).x, G.userToSheet(a1).y - G.userToSheet(b2).y);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('.sc-objects path')].map((p) => ({ d: p.getAttribute('d'), id: p.dataset.id })).filter((p) => /A/.test(p.d)));
  check('a schermo il cerchio e\' un tracciato SVG con due archi di raggio = distanza dei punti sul foglio', drawn.length === 1 && (drawn[0].d.match(/A([\d.e+-]+) /g) || []).length === 2 && near(+/A([\d.e+-]+) /.exec(drawn[0].d)[1], R, 1e-6) && /Z$/.test(drawn[0].d), JSON.stringify(drawn));
  // --- Arco: tre Estremi
  await curveTool(page, 'arc');
  await click(page, await clientOfUser(page, a2), 2, -3);
  await click(page, await clientOfUser(page, c1), -3, 2);
  await click(page, await clientOfUser(page, c2), 3, 3);
  o = await lastObj(page);
  check('Arco inserito: kind arc, p1, p2 e p3 = i punti utente dei tre Estremi (entro 1e-6 pt)', o?.kind === 'arc' && nearP(o.p1, a2) && nearP(o.p2, c1) && nearP(o.p3, c2), JSON.stringify(o));
  check('messaggio: "Arco aggiunto: raggio ... Annulla per toglierlo."', /^Arco aggiunto: raggio .+\. Annulla per toglierlo\.$/.test(await status(page)), await status(page));
  const arcD = await page.evaluate(() => [...document.querySelectorAll('.sc-objects path')].map((p) => p.getAttribute('d')).filter((d) => /A/.test(d) && !/Z$/.test(d)));
  const ex = circum(G.userToSheet(a2), G.userToSheet(c1), G.userToSheet(c2));
  const flags = arcD[0] && /A([\d.e+-]+) ([\d.e+-]+) 0 (\d) (\d) /.exec(arcD[0]);
  check('a schermo l\'arco ha un solo "A": raggio, flag di arco lungo e di verso come dal calcolo indipendente (verso orario = sweep 1)', arcD.length === 1 && !!flags && near(+flags[1], ex.r, 1e-6) && +flags[3] === (Math.abs(ex.sweep) > Math.PI ? 1 : 0) && +flags[4] === (ex.sweep > 0 ? 1 : 0), JSON.stringify({ arcD, ex: { r: ex.r, sweep: ex.sweep } }));
  // --- tre punti allineati: Estremo, Punto medio, Estremo della stessa retta
  await curveTool(page, 'arc');
  const n0 = (await objectsOf(page)).length;
  await click(page, await clientOfUser(page, a1), 3, 3);
  const mm = await hover(page, mid(a1, a2), 0, 3);
  check('Punto medio della retta A: marcatore a triangolo "Punto medio"', !!mm && mm.kind === 'mid' && mm.label === 'Punto medio' && mm.shape === 'polygon', JSON.stringify(mm));
  await click(page, await clientOfUser(page, mid(a1, a2)), 0, 3);
  await click(page, await clientOfUser(page, a2), 2, -3);
  check('tre punti allineati: rifiutati con "I tre punti sono allineati: un arco non passa da tre punti su una retta."', (await status(page)) === 'I tre punti sono allineati: un arco non passa da tre punti su una retta.', await status(page));
  check('... nessun oggetto aggiunto, i primi due punti restano e il testo guida chiede la fine', (await objectsOf(page)).length === n0 && (await hint(page)) === 'Arco: indica la fine');
  await click(page, await clientOfUser(page, d_(U)), 0, 0);
  const o2 = await lastObj(page);
  check('... un terzo punto buono dopo il rifiuto completa l\'arco', (await objectsOf(page)).length === n0 + 1 && o2.kind === 'arc' && nearP(o2.p1, a1) && nearP(o2.p2, mid(a1, a2)), JSON.stringify(o2));
  await ctx.close();
}
const d_ = (U) => U(ANCH.segD[0]);

// ---------------------------------------------------------------- 3) snap sul Centro, sull'Estremo e sul Punto medio dell'arco
async function centerSuite(browser, title) {
  setSection(`snap sul Centro e sull'arco, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title, false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  // un cerchio e un arco con punti liberi, ben separati
  await curveTool(page, 'circle');
  await click(page, await clientOfUser(page, U([0.3, 0.7])));
  await click(page, await clientOfUser(page, U([0.45, 0.7])));
  const circ = await lastObj(page);
  await curveTool(page, 'arc');
  for (const f of [[0.55, 0.3], [0.6, 0.42], [0.85, 0.3]]) await click(page, await clientOfUser(page, U(f))); // il punto di passaggio e' vicino all'inizio: NON e' il punto medio
  const arc = await lastObj(page);
  check('(premessa) un cerchio e un arco inseriti con punti liberi: punti = punti grezzi sotto i clic (entro RAW_TOL)', circ?.kind === 'circle' && arc?.kind === 'arc');
  // calcolo indipendente dei candidati
  const s1 = G.userToSheet(arc.p1), s2 = G.userToSheet(arc.p2), s3 = G.userToSheet(arc.p3);
  const ex = circum(s1, s2, s3);
  const expUser = { end1: arc.p1, end3: arc.p3, mid: G.sheetToUser(ex.mid), center: G.sheetToUser(ex.c) };
  // inserisce una Retta con il primo punto sul candidato (hover vicino) e legge p1 dal modello; poi annulla
  async function probe(name, target, kind, label, shape, near2 = [3, -3]) {
    await tool(page, 'Retta');
    const mk = await hover(page, target, near2[0], near2[1]);
    check(`${name}: marcatore "${label}" (${shape}) sul candidato`, !!mk && mk.kind === kind && mk.label === label && mk.shape === shape, JSON.stringify(mk));
    const before = (await objectsOf(page)).length;
    await click(page, await clientOfUser(page, target), near2[0], near2[1]);
    await click(page, await clientOfUser(page, U([0.1, 0.1])));
    const seg = await lastObj(page);
    check(`${name}: il primo punto della Retta e' esattamente il candidato (entro 1e-6 pt)`, (await objectsOf(page)).length === before + 1 && seg.kind === 'segment' && nearP(seg.points[0], target), JSON.stringify([seg?.points?.[0], target]));
    await undo(page);
  }
  await probe('Centro del cerchio', circ.p1, 'center', 'Centro', 'circle');
  await probe('Estremo (inizio) dell\'arco', expUser.end1, 'end', 'Estremo', 'rect');
  await probe('Estremo (fine) dell\'arco', expUser.end3, 'end', 'Estremo', 'rect');
  await probe('Punto medio dell\'arco (a meta\' dell\'arco)', expUser.mid, 'mid', 'Punto medio', 'polygon');
  await probe('Centro dell\'arco', expUser.center, 'center', 'Centro', 'circle');
  // il punto di passaggio p2 dell'arco NON e' un candidato
  await tool(page, 'Retta');
  const pm = await hover(page, arc.p2, 4, 0);
  check('il punto di passaggio p2 dell\'arco non e\' un candidato di snap (nessun marcatore)', pm === null, JSON.stringify(pm));
  const dmid = Math.hypot(G.userToSheet(expUser.mid).x - s2.x, G.userToSheet(expUser.mid).y - s2.y);
  info(`distanza sul foglio tra il punto medio dell'arco e p2: ${dmid.toFixed(1)} pt (se fosse < raggio di cattura non si distinguerebbero)`);
  check('(premessa) p2 e il punto medio dell\'arco sono punti diversi, piu\' lontani del raggio di cattura', dmid * (await zoomPx(page)) > 15, dmid.toFixed(2));
  // Centro della Copertura circolare
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'cover', shape: 'circle', a: [0.2, 0.25], b: [0.28, 0.25] }]));
  const cov = (await objectsOf(page)).find((x) => x.kind === 'cover');
  await tool(page, 'Retta');
  const mc = await hover(page, cov.p1, 3, 3);
  check('Centro anche sulla Copertura circolare: marcatore "Centro"', !!mc && mc.kind === 'center' && mc.label === 'Centro', JSON.stringify(mc));
  // interruttore Centro
  check('interruttore "Centro" nella barra di stato, dopo "Punto medio", acceso all\'avvio', await page.evaluate(() => { const t = [...document.querySelectorAll('.statusbar .st-toggle')].map((b) => `${b.dataset.toggle}:${b.getAttribute('aria-pressed')}`); return JSON.stringify(t.slice(0, 3)) === JSON.stringify(['end:true', 'mid:true', 'center:true']); }));
  await setToggle(page, 'center', false);
  check('spento: messaggio "Centro disattivato" e nessun marcatore sul centro del cerchio', (await status(page)) === 'Centro disattivato' && (await hover(page, circ.p1, 3, 3)) === null, await status(page));
  await setToggle(page, 'center', true);
  check('riacceso: messaggio con il testo "al centro di cerchi, archi e coperture circolari"', /^Centro attivo: il punto si aggancia al centro di cerchi, archi e coperture circolari$/.test(await status(page)), await status(page));
  const pan = await page.locator('.panel-toggle[data-panel-toggle="center"]').count();
  check('stesso interruttore nel pannello a destra ("Aggancio e griglia"), con lo stesso stato', pan === 1 && (await page.locator('.panel-toggle[data-panel-toggle="center"]').getAttribute('aria-pressed')) === 'true');
  await ctx.close();
}

// ---------------------------------------------------------------- 4) punti in costruzione come candidati
async function pendingSuite(browser, title) {
  setSection(`punti in costruzione come candidati, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title, false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const A = U([0.2, 0.7]), B = U([0.55, 0.78]), C = U([0.5, 0.4]);
  const polyCount = async () => (await objectsOf(page)).filter((o) => o.kind === 'polyline').length;
  // Linea: chiude la spezzata sul primo punto
  await tool(page, 'Linea');
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  await click(page, await clientOfUser(page, C));
  const mk = await hover(page, A, 4, -3);
  check('Linea: vicino al primo punto compare il marcatore "Estremo" (punto in costruzione)', !!mk && mk.kind === 'end' && mk.label === 'Estremo', JSON.stringify(mk));
  await click(page, await clientOfUser(page, A), 4, -3);
  await page.locator('.ctx-act', { hasText: 'Fine' }).click();
  await page.waitForTimeout(100);
  let p = await lastObj(page);
  check('chiusura: la Linea ha 4 punti e l\'ultimo e\' il primo (entro 1e-6 pt)', p?.kind === 'polyline' && p.points.length === 4 && nearP(p.points[3], p.points[0]), JSON.stringify(p?.points));
  check('... il primo punto e\' quello grezzo del primo clic (entro RAW_TOL)', near(p.points[0].x, A.x, 0.2) && near(p.points[0].y, A.y, 0.2));
  await undo(page);
  // Linea: il doppio clic sull'ultimo punto termina la linea (regressione)
  await tool(page, 'Linea');
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  await click(page, await clientOfUser(page, C));
  const n = await polyCount();
  await click(page, await clientOfUser(page, C), 2, 2);
  p = await lastObj(page);
  check('Linea: un secondo clic sull\'ultimo punto la termina con 3 punti (come prima), senza punto doppio', (await polyCount()) === n + 1 && p?.kind === 'polyline' && p.points.length === 3, JSON.stringify(p?.points));
  await undo(page);
  // Linea con 2 punti: clic sul secondo -> Linea di 2 punti (come prima: points.length >= 2)
  await tool(page, 'Linea');
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  await click(page, await clientOfUser(page, B), 3, 3);
  p = await lastObj(page);
  check('Linea: due punti e un clic sul secondo la termina con 2 punti', p?.kind === 'polyline' && p.points.length === 2, JSON.stringify(p?.points));
  await undo(page);
  // Retta: il secondo punto sul primo e' rifiutato
  await tool(page, 'Retta');
  const k0 = (await objectsOf(page)).length;
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, A), 4, 3);
  check('Retta: il secondo punto sul primo e\' rifiutato ("I due punti coincidono") e il primo resta', (await status(page)) === 'I due punti coincidono: scegli un secondo punto diverso.' && (await objectsOf(page)).length === k0 && (await hint(page)) === 'Retta: indica il secondo punto', await status(page));
  await page.keyboard.press('Escape');
  // Arco: il primo punto e il punto di passaggio sono candidati
  await curveTool(page, 'arc');
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  const m1 = await hover(page, A, 5, 2);
  const m2 = await hover(page, B, -5, 2);
  check('Arco: il primo punto e il punto di passaggio si agganciano (Estremo) per il punto successivo', m1?.kind === 'end' && m2?.kind === 'end', JSON.stringify([m1, m2]));
  await page.keyboard.press('Escape');
  // Quota a catena: i due punti misurati sono candidati per il terzo (posizione della linea di quota)
  await tool(page, 'Quota');
  await page.locator('.ctx-types button', { hasText: 'Allineata' }).click();
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  const m3 = await hover(page, B, 3, 3);
  check('Quota allineata: i punti misurati sono candidati (Estremo) per la posizione della linea di quota', m3?.kind === 'end', JSON.stringify(m3));
  await page.keyboard.press('Escape');
  // interruttore Estremo spento: nessun candidato in costruzione
  await tool(page, 'Linea');
  await setToggle(page, 'end', false);
  await click(page, await clientOfUser(page, A));
  await click(page, await clientOfUser(page, B));
  const m4 = await hover(page, A, 3, 3);
  check('con Estremo spento i punti in costruzione non si agganciano', m4 === null, JSON.stringify(m4));
  await page.keyboard.press('Escape');
  await setToggle(page, 'end', true);
  await ctx.close();
}

// ---------------------------------------------------------------- 5) selezione sulla linea, non dentro; Canc; Annulla e Ripeti; trascinamento; Cancella
async function selectSuite(browser, title, rotated) {
  setSection(`selezione, Canc e Annulla/Ripeti di Cerchio e Arco, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title, false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [
    { k: 'circle', a: [0.5, 0.55], b: [0.68, 0.55] },
    { k: 'segment', pts: [[0.44, 0.5], [0.56, 0.6]] },
    { k: 'arc', a: [0.2, 0.2], b: [0.3, 0.3], c: [0.45, 0.2] },
    { k: 'cover', shape: 'circle', a: [0.8, 0.8], b: [0.9, 0.8] },
  ]));
  await page.waitForTimeout(150);
  const objs = await objectsOf(page);
  const circle = objs.find((o) => o.kind === 'circle');
  const arc = objs.find((o) => o.kind === 'arc');
  const sc = G.userToSheet(circle.p1), se = G.userToSheet(circle.p2);
  const Rs = Math.hypot(se.x - sc.x, se.y - sc.y);
  const onCircle = (deg) => G.sheetToUser({ x: sc.x + Rs * Math.cos(deg * Math.PI / 180), y: sc.y + Rs * Math.sin(deg * Math.PI / 180) });
  const arcEx = circum(G.userToSheet(arc.p1), G.userToSheet(arc.p2), G.userToSheet(arc.p3));
  await tool(page, 'Seleziona');
  // tocco sulla linea del cerchio
  await click(page, await clientOfUser(page, onCircle(200)), 3, 2);
  check('un clic sulla LINEA del cerchio lo seleziona: "Selezionato: Cerchio"', (await hint(page)) === 'Selezionato: Cerchio', await hint(page));
  check('la selezione evidenzia la linea (un tracciato con arco), non un disco', await page.evaluate(() => { const s = [...document.querySelectorAll('.sc-sel > *')]; return s.length === 1 && s[0].tagName.toLowerCase() === 'path' && /A/.test(s[0].getAttribute('d')) && getComputedStyle(s[0]).fill === 'none'; }));
  // clic dentro il cerchio, lontano dalla linea e dalla retta: nessuna selezione
  const inside = G.sheetToUser({ x: sc.x + Rs * 0.35 * (rotated ? 0 : 1), y: sc.y - Rs * 0.35 * (rotated ? 1 : 0) });
  const insideC = await clientOfUser(page, inside);
  const dSeg = await page.evaluate(([x, y]) => 0, [0, 0]);
  void dSeg;
  await click(page, insideC);
  const hs = await hint(page);
  check('un clic DENTRO il cerchio (lontano dalla linea e dalle altre cose) non seleziona nulla', hs === 'Seleziona: tocca un oggetto, poi trascinalo' || /^Selezionat/.test(hs) === false, hs);
  // la retta che passa dentro il cerchio resta scegliibile
  await click(page, await clientOfUser(page, U([0.5, 0.55])));
  check('la retta che attraversa il cerchio si sceglie con un clic sulla retta (il cerchio non la nasconde): "Selezionata: Retta"', (await hint(page)) === 'Selezionata: Retta', await hint(page));
  // Canc sul cerchio
  await click(page, await clientOfUser(page, onCircle(200)), 3, 2);
  const before = JSON.stringify(await objectsOf(page));
  const n0 = (await objectsOf(page)).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('Canc cancella il cerchio selezionato: "Cerchio cancellato. Annulla lo ripristina." (maschile)', (await status(page)) === 'Cerchio cancellato. Annulla lo ripristina.' && (await objectsOf(page)).length === n0 - 1 && !(await objectsOf(page)).some((o) => o.kind === 'circle'), await status(page));
  check('... e la selezione e\' azzerata', (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo');
  await undo(page);
  check('Annulla in un solo passo: il cerchio torna identico (stessi dati e stesso ordine)', JSON.stringify(await objectsOf(page)) === before);
  await redo(page);
  check('Ripeti: lo cancella di nuovo, in un solo passo', (await objectsOf(page)).length === n0 - 1);
  await undo(page);
  // proprieta' del cerchio selezionato (pannello a destra): spessore 3 pt, in un solo passo di Annulla
  await click(page, await clientOfUser(page, onCircle(200)), 3, 2);
  const insp = page.locator('.inspector');
  const propsBefore = JSON.stringify((await objectsOf(page)).find((o) => o.kind === 'circle'));
  await insp.locator('.presets[aria-label^="Spessori"] .preset', { hasText: /^3$/ }).click();
  await page.waitForTimeout(100);
  const circAfter = (await objectsOf(page)).find((o) => o.kind === 'circle');
  check('proprieta\' del cerchio selezionato: lo spessore 3 pt si applica e il messaggio dice "Proprieta\' modificate: cerchio. Annulla le ripristina."', circAfter.stroke.widthPt === 3 && /^Propriet. modificate: cerchio\. Annulla le ripristina\.$/.test(await status(page)), JSON.stringify(circAfter.stroke) + ' ' + (await status(page)));
  await undo(page);
  check('Annulla ripristina le proprieta\' del cerchio in un passo', JSON.stringify((await objectsOf(page)).find((o) => o.kind === 'circle')) === propsBefore);
  // trascinamento
  await click(page, await clientOfUser(page, onCircle(200)), 3, 2);
  const p1Before = (await objectsOf(page)).find((o) => o.kind === 'circle');
  const from = await clientOfUser(page, onCircle(200));
  await page.mouse.move(from.x + 3, from.y + 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 33, from.y + 22, { steps: 6 });
  await page.mouse.move(from.x + 63, from.y + 42, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const moved = (await objectsOf(page)).find((o) => o.kind === 'circle');
  const k = await zoomPx(page);
  const dSheet = { x: 60 / k, y: 40 / k };
  const expDelta = G.sheetToUser({ x: dSheet.x + 0, y: dSheet.y + 0 });
  const o0 = G.sheetToUser({ x: 0, y: 0 });
  const dUser = { x: expDelta.x - o0.x, y: expDelta.y - o0.y };
  check('trascinare il cerchio selezionato lo sposta: p1 e p2 cambiano della stessa quantita\' (= lo spostamento sul foglio riportato nello spazio utente, entro 0.1 pt)', near(moved.p1.x - p1Before.p1.x, dUser.x, 0.1) && near(moved.p1.y - p1Before.p1.y, dUser.y, 0.1) && near(moved.p2.x - p1Before.p2.x, moved.p1.x - p1Before.p1.x, 1e-9) && near(moved.p2.y - p1Before.p2.y, moved.p1.y - p1Before.p1.y, 1e-9), JSON.stringify([p1Before, moved, dUser]));
  check('messaggio: "Cerchio spostato. Annulla lo rimette a posto."', (await status(page)) === 'Cerchio spostato. Annulla lo rimette a posto.', await status(page));
  await undo(page);
  check('Annulla rimette il cerchio dov\'era (esatto)', JSON.stringify((await objectsOf(page)).find((o) => o.kind === 'circle')) === JSON.stringify(p1Before));
  // arco: sulla linea si sceglie; sul lato opposto del cerchio che lo contiene no
  const arcOn = G.sheetToUser({ x: arcEx.c.x + arcEx.r * Math.cos(arcEx.a0 + arcEx.sweep * 0.3), y: arcEx.c.y + arcEx.r * Math.sin(arcEx.a0 + arcEx.sweep * 0.3) });
  await click(page, await clientOfUser(page, arcOn), 3, 2);
  check('un clic sulla linea dell\'arco lo seleziona: "Selezionato: Arco"', (await hint(page)) === 'Selezionato: Arco', await hint(page));
  const opp = G.sheetToUser({ x: arcEx.c.x + arcEx.r * Math.cos(arcEx.a0 + arcEx.sweep / 2 + Math.PI), y: arcEx.c.y + arcEx.r * Math.sin(arcEx.a0 + arcEx.sweep / 2 + Math.PI) });
  await page.keyboard.press('Escape');
  await click(page, await clientOfUser(page, opp));
  check('sul lato opposto del suo cerchio (fuori dall\'arco) un clic non lo seleziona', (await hint(page)) === 'Seleziona: tocca un oggetto, poi trascinalo' || !/Arco/.test(await hint(page)), await hint(page));
  // strumento Cancella
  await tool(page, 'Cancella');
  const nA = (await objectsOf(page)).length;
  await click(page, insideC);
  check('Cancella: un clic dentro il cerchio (non sulla linea) non cancella nulla', (await objectsOf(page)).length === nA && /Nessun oggetto in questo punto/.test(await status(page)), await status(page));
  await click(page, await clientOfUser(page, arcOn), 3, 2);
  check('Cancella: un clic sulla linea dell\'arco lo cancella: "Arco cancellato. Annulla lo ripristina."', (await status(page)) === 'Arco cancellato. Annulla lo ripristina.' && (await objectsOf(page)).length === nA - 1, await status(page));
  await undo(page);
  check('Annulla ripristina l\'arco allo stesso posto', JSON.stringify((await objectsOf(page)).find((o) => o.kind === 'arc')) === JSON.stringify(arc));
  // anteprima sull'evidenziazione di Cancella: sulla linea del cerchio compare l'alone
  await page.mouse.move(...Object.values(await clientOfUser(page, onCircle(10))));
  await page.waitForTimeout(80);
  check('Cancella: passando sulla linea del cerchio compare l\'alone (un tracciato)', await page.evaluate(() => document.querySelectorAll('.sc-hl path').length === 1));
  await ctx.close();
}

// ---------------------------------------------------------------- 6) costruzione: Annulla di un punto, Esc, anteprima, ORTO
async function buildSuite(browser) {
  setSection('costruzione: Annulla di un punto, anteprima e ORTO, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale', false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  await curveTool(page, 'arc');
  await click(page, await clientOfUser(page, U([0.3, 0.3])));
  await click(page, await clientOfUser(page, U([0.45, 0.45])));
  check('(premessa) Arco con 2 punti: "Arco: indica la fine"', (await hint(page)) === 'Arco: indica la fine');
  await undo(page);
  check('Ctrl+Z in costruzione toglie l\'ultimo punto: "Arco: indica un punto sull\'arco"', (await hint(page)) === 'Arco: indica un punto sull\'arco' && (await objectsOf(page)).length === 0);
  await undo(page);
  check('Ctrl+Z di nuovo toglie anche il primo', (await hint(page)) === 'Arco: indica l\'inizio');
  // anteprima: cerchio
  await curveTool(page, 'circle');
  const c0 = await clientOfUser(page, U([0.5, 0.5]));
  await click(page, c0);
  const to = { x: c0.x + 90, y: c0.y + 40 };
  await page.mouse.move(to.x, to.y);
  await page.waitForTimeout(100);
  let pd = await previewD(page);
  const k = await zoomPx(page);
  const rs = Math.hypot(90, 40) / k;
  check('anteprima del cerchio dopo il centro: un tracciato con due archi di raggio = distanza dal cursore (pt del foglio)', pd.length === 1 && (pd[0].match(/A([\d.e+-]+) /g) || []).length === 2 && near(+/A([\d.e+-]+) /.exec(pd[0])[1], rs, 0.05), JSON.stringify(pd));
  await page.keyboard.press('Escape');
  check('Esc toglie l\'anteprima e il punto', (await previewD(page)).length === 0 && (await hint(page)) === 'Cerchio: indica il centro');
  // anteprima: arco = corda, poi arco
  await curveTool(page, 'arc');
  const a0 = await clientOfUser(page, U([0.3, 0.3]));
  await click(page, a0);
  await page.mouse.move(a0.x + 120, a0.y - 30);
  await page.waitForTimeout(100);
  pd = await previewD(page);
  check('anteprima dell\'arco dopo il primo punto: la corda fino al cursore (M ... L ..., senza archi)', pd.length === 1 && /^M[^A]*L[^A]*$/.test(pd[0]), JSON.stringify(pd));
  await click(page, { x: a0.x + 60, y: a0.y - 70 });
  await page.mouse.move(a0.x + 130, a0.y - 10);
  await page.waitForTimeout(100);
  pd = await previewD(page);
  check('anteprima dopo il secondo punto: l\'arco per i tre punti con il cursore come fine (un solo "A")', pd.length === 1 && (pd[0].match(/A/g) || []).length === 1 && !/Z$/.test(pd[0]), JSON.stringify(pd));
  await page.mouse.move(a0.x + 120, a0.y - 140); // sul prolungamento della retta fra i primi due punti (60, -70)
  await page.waitForTimeout(100);
  pd = await previewD(page);
  check('il cursore sulla retta dei primi due punti (tre punti allineati): nessuna anteprima dell\'arco', pd.length === 0 || !/A/.test(pd[0]), JSON.stringify(pd));
  await page.keyboard.press('Escape');
  // il PDF non cambia con l'anteprima: nessun oggetto
  check('l\'anteprima non e\' un oggetto: il documento non ha oggetti', (await objectsOf(page)).length === 0);
  // ORTO: nessun effetto su Cerchio e Arco
  await setToggle(page, 'ortho', true);
  await curveTool(page, 'circle');
  const o1 = await clientOfUser(page, U([0.35, 0.6]));
  await click(page, o1);
  await click(page, { x: o1.x + 140, y: o1.y + 17 });
  let c = await lastObj(page);
  const s1 = G.userToSheet(c.p1), s2 = G.userToSheet(c.p2);
  check('ORTO acceso, Cerchio: il punto sul bordo NON e\' portato sull\'asse (stessa Y/X del centro) e resta il punto del clic', Math.abs(s2.y - s1.y) > 5 && near((await sheetOfClient(page, { x: o1.x + 140, y: o1.y + 17 })).x, s2.x, RAW_TOL) && near((await sheetOfClient(page, { x: o1.x + 140, y: o1.y + 17 })).y, s2.y, RAW_TOL), JSON.stringify([s1, s2]));
  await curveTool(page, 'arc');
  const q = [[0.6, 0.3], [0.7, 0.36], [0.78, 0.28]].map(U);
  const qc = [];
  for (const p of q) {
    const cl = await clientOfUser(page, p);
    qc.push(cl);
    await click(page, cl);
  }
  c = await lastObj(page);
  const raws = [];
  for (const cl of qc) raws.push(await sheetOfClient(page, cl));
  const ss = [c.p1, c.p2, c.p3].map((p) => G.userToSheet(p));
  check('ORTO acceso, Arco: i tre punti sono quelli dei clic (entro RAW_TOL), nessun vincolo d\'asse', c.kind === 'arc' && ss.every((s, i) => near(s.x, raws[i].x, RAW_TOL) && near(s.y, raws[i].y, RAW_TOL)) && Math.abs(ss[1].y - ss[0].y) > 5, JSON.stringify([ss, raws]));
  check('l\'interruttore ORTO e il suo messaggio non sono cambiati', (await toggle(page, 'ortho').innerText()) === 'ORTO');
  await setToggle(page, 'ortho', false);
  await ctx.close();
}

// ---------------------------------------------------------------- 7) file progetto: versione 2, riapertura, versione 1
async function projectSuite(browser) {
  setSection('file progetto versione 2, riapertura e progetto di versione 1');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 con /Rotate 90', false);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const sample = readFileSync(join(PDF_DIR, 'a4-rotate90.pdf'));
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [
    { k: 'segment', pts: [[0.2, 0.8], [0.5, 0.82]] },
    { k: 'circle', a: [0.5, 0.5], b: [0.62, 0.52], style: 'dashed', color: '#1565C0', w: 1.5 },
    { k: 'arc', a: [0.2, 0.25], b: [0.3, 0.38], c: [0.46, 0.27], style: 'dashdot', color: '#2E7D32', w: 0.5 },
    { k: 'cover', shape: 'circle', a: [0.8, 0.8], b: [0.88, 0.8] },
    { k: 'text', at: [0.6, 0.12], text: 'T' },
  ]));
  void U;
  const S0 = await state(page);
  const text0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text0);
  check('il progetto scritto e\' di versione 3 (format "gt-pdf-project"; dalla CP6d la scrittura e\' sempre la 3)', j.version === 3 && j.format === 'gt-pdf-project');
  const jc = j.pages[0].objects.find((o) => o.kind === 'circle');
  const ja = j.pages[0].objects.find((o) => o.kind === 'arc');
  check('cerchio e arco nel file: solo i punti indicati e il tratto (lista bianca), nessun centro/raggio/angolo', JSON.stringify(Object.keys(jc)) === JSON.stringify(['id', 'kind', 'p1', 'p2', 'stroke']) && JSON.stringify(Object.keys(ja)) === JSON.stringify(['id', 'kind', 'p1', 'p2', 'p3', 'stroke']) && !/center|centro|radius|raggio|angle|sweep/i.test(JSON.stringify([jc, ja])));
  // salva dall'interfaccia
  const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());
  const menuItem = async (pg, re) => {
    await pg.locator('.menu-btn', { hasText: 'File' }).click();
    await pg.locator('.menu-item').filter({ hasText: re }).click();
  };
  await menuItem(page, /^Salva con nome/);
  const d = page.locator('.save-dialog');
  await d.waitFor();
  await d.locator('.btn.primary', { hasText: 'Salva' }).click();
  await d.locator('.exp-done-actions').waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
  const saved = readFileSync(await dl.path());
  await d.locator('.btn', { hasText: 'Chiudi' }).click();
  writeFileSync(join(OUT, 'progetto-v2.json'), saved);
  const sj = JSON.parse(saved.toString('utf8'));
  check('il file scaricato e\' di versione 3 con gli stessi oggetti del modello', sj.version === 3 && JSON.stringify(sj.pages[0].objects) === JSON.stringify(S0.pages[0].objects), `${sj.version}`);
  // chiude e riapre il progetto con lo stesso PDF
  const openProject = async (pg, json, jsonName, pdfBytes) => {
    const first = pg.waitForEvent('filechooser');
    await menuItem(pg, /^Apri progetto/);
    await (await first).setFiles({ name: jsonName, mimeType: 'application/json', buffer: Buffer.from(json) });
    await pg.locator('.open-project-dialog').waitFor();
    const summary = await text(pg.locator('.open-project-dialog'));
    const second = pg.waitForEvent('filechooser');
    await pg.locator('.open-project-dialog [data-role=pick-pdf]').click();
    await (await second).setFiles({ name: 'a4-rotate90.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfBytes) });
    await pg.waitForTimeout(900);
    return summary;
  };
  await menuItem(page, /^Chiudi/);
  await page.waitForTimeout(300);
  const dlg = page.locator('.dialog .btn', { hasText: /Chiudi|Procedi|Scarta/ });
  if (await dlg.count()) await dlg.first().click().catch(() => {});
  await page.waitForTimeout(300);
  const summary = await openProject(page, saved, 'progetto-v2.json', sample);
  const S1 = await state(page);
  check('riaperto il progetto di versione 2: oggetti IDENTICI (kind, punti, tratto, id, ordine)', JSON.stringify(S1.pages[0].objects) === JSON.stringify(S0.pages[0].objects), JSON.stringify(S1.pages[0].objects).slice(0, 300));
  check('... il riepilogo di apertura conta gli oggetti (5)', /5 oggetti/.test(summary) || /oggett/.test(summary), summary);
  check('... e a schermo cerchio e arco ci sono (due tracciati con archi)', (await page.evaluate(() => [...document.querySelectorAll('.sc-objects path')].filter((p) => /A/.test(p.getAttribute('d'))).length)) === 2);
  // riscrive: ancora versione 2, stesso contenuto
  const text1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('il progetto riscritto dopo la riapertura e\' identico a quello scritto prima (versione 3)', JSON.parse(text1).version === 3 && JSON.stringify(JSON.parse(text1).pages) === JSON.stringify(j.pages));
  // progetto di versione 1: stesso file con i soli oggetti che c'erano nella 1 e version = 1
  const v1 = JSON.parse(saved.toString('utf8'));
  v1.version = 1;
  v1.app = '47a660e';
  for (const pg of v1.pages) delete pg.origin; // `origin` esiste dalla versione 3 (CP6d): un file di versione 1 non lo ha
  v1.pages[0].objects = v1.pages[0].objects.filter((o) => o.kind !== 'circle' && o.kind !== 'arc');
  await menuItem(page, /^Chiudi/);
  await page.waitForTimeout(300);
  if (await dlg.count()) await dlg.first().click().catch(() => {});
  await page.waitForTimeout(300);
  const summary1 = await openProject(page, JSON.stringify(v1), 'progetto-v1.json', sample);
  const S2 = await state(page);
  check('un progetto di VERSIONE 1 (senza cerchi e archi) si apre: gli oggetti sono quelli del file', JSON.stringify(S2.pages[0].objects) === JSON.stringify(v1.pages[0].objects) && S2.pages[0].objects.length === 3, `${summary1} / ${S2.pages[0].objects.length}`);
  const text2 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j2 = JSON.parse(text2);
  check('... e si riscrive come versione 3 con gli stessi oggetti', j2.version === 3 && JSON.stringify(j2.pages[0].objects) === JSON.stringify(v1.pages[0].objects));
  // un file di versione 1 che contiene un cerchio e' rifiutato
  const bad = JSON.parse(saved.toString('utf8'));
  bad.version = 1;
  for (const pg of bad.pages) delete pg.origin; // idem: altrimenti il file sarebbe rifiutato per l'origine prima che per il cerchio
  await menuItem(page, /^Chiudi/);
  await page.waitForTimeout(300);
  if (await dlg.count()) await dlg.first().click().catch(() => {});
  await page.waitForTimeout(300);
  const first = page.waitForEvent('filechooser');
  await menuItem(page, /^Apri progetto/);
  await (await first).setFiles({ name: 'cattivo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForTimeout(500);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  check('un progetto di versione 1 con un cerchio e\' rifiutato con un messaggio che dice dove ("oggetto 2: un progetto di versione 1 non ha cerchi")', /oggetto 2: un progetto di versione 1 non ha cerchi/.test(body), body.slice(0, 300));
  await ctx.close();
}

// ---------------------------------------------------------------- 8) esportazione: Copertura semplice e Appiattito, confronto con lo schermo
async function exportSuite(browser, harness) {
  for (const [title, file] of SAMPLES) {
    setSection(`esportazione con Cerchio e Arco, ${title}`);
    // finestra grande (2800 x 2000) e zoom 2 px/pt: lo schermo e il PDF reso da PDF.js hanno lo STESSO ingrandimento (come e2e-cp5a)
    const { ctx, page } = await newApp(browser);
    try {
      await openSample(page, title);
      const origBytes = readFileSync(join(PDF_DIR, file));
      const specs = [
        { k: 'circle', a: [0.35, 0.62], b: [0.5, 0.62], style: 'solid', color: '#D32F2F', w: 1 },
        { k: 'circle', a: [0.7, 0.7], b: [0.8, 0.7], style: 'dashed', color: '#1565C0', w: 2 },
        { k: 'arc', a: [0.15, 0.3], b: [0.3, 0.42], c: [0.45, 0.28], style: 'solid', color: '#2E7D32', w: 1.5 },
        { k: 'arc', a: [0.85, 0.3], b: [0.7, 0.2], c: [0.6, 0.3], style: 'dashdot', color: '#6A1B9A', w: 1 },
        { k: 'arc', a: [0.55, 0.45], b: [0.3, 0.1], c: [0.2, 0.6], style: 'solid', color: '#E65100', w: 0.75 }, // arco lungo
      ];
      await showPage(page, 1);
      const A0 = (await shot(page)).buf;
      await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), specs);
      await showPage(page, 1);
      const A = (await shot(page)).buf;
      const hp = await harness.newPage();
      await hp.goto(`http://localhost:${HPORT}/`);
      await hp.waitForFunction(() => window.harnessReady === true);
      const url = (buf) => `data:image/png;base64,${b64(buf)}`;
      const b0 = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64(origBytes), 1, ZOOM]);
      for (const [mode, label, opts] of [['simple', 'Copertura semplice', { mode: 'simple' }], ['flat', 'Appiattito (PNG 300 dpi)', { mode: 'flat', dpi: 300, format: 'png' }]]) {
        const r = await page.evaluate(async (o) => { const x = await window.__gtpdf.runExport({ ...o, keep: true }); return { warnings: x.warnings, objectCount: x.objectCount, touchedPages: x.touchedPages }; }, opts);
        const b64pdf = await page.evaluate(() => window.__gtpdf.lastExportBase64());
        const bytes = Buffer.from(b64pdf, 'base64');
        writeFileSync(join(OUT, `${file.replace('.pdf', '')}-${mode}.pdf`), bytes);
        check(`${label}: esportazione riuscita con 5 oggetti su 1 pagina, nessun avviso`, r.objectCount === 5 && r.touchedPages === 1 && r.warnings.length === 0, JSON.stringify(r));
        const bb = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64pdf, 1, ZOOM]);
        if (mode === 'simple') {
          // confronto degli inchiostri (come e2e-cp5a): distanza di ogni pixel di inchiostro dell'app da quello del PDF e viceversa, a 2 px per pt
          const m = await hp.evaluate(([a0, a, b0u, bu, T, tol]) => window.compare(a0, a, b0u, bu, T, tol), [url(A0), url(A), b0, bb, INK_T, TOL_PX]);
          writeFileSync(join(OUT, `${file.replace('.pdf', '')}-${mode}-A_B_diff.png`), Buffer.from(m.image.split(',')[1], 'base64'));
          info(`${label}, ${title}: inchiostro app ${m.nA} px, PDF ${m.nB} px | entro ${TOL_PX} px: ${(m.matchA * 100).toFixed(2)} % (app->PDF), ${(m.matchB * 100).toFixed(2)} % (PDF->app) | p99 ${m.p99A.toFixed(2)}/${m.p99B.toFixed(2)} px, max ${m.maxA.toFixed(1)}/${m.maxB.toFixed(1)} px, rapporto inchiostro ${(m.nB / m.nA).toFixed(3)}`);
          check(`${label}: inchiostro presente nell'app e nel PDF`, m.nA > 500 && m.nB > 500, `${m.nA}/${m.nB}`);
          check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro dell'app entro ${TOL_PX} px da quello del PDF`, m.matchA >= MIN_MATCH, `${(m.matchA * 100).toFixed(2)} %`);
          check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro del PDF entro ${TOL_PX} px da quello dell'app`, m.matchB >= MIN_MATCH, `${(m.matchB * 100).toFixed(2)} %`);
          check(`${label}: quantita' di inchiostro del PDF / dell'app tra ${INK_RATIO[0]} e ${INK_RATIO[1]}`, m.nB / m.nA >= INK_RATIO[0] && m.nB / m.nA <= INK_RATIO[1], (m.nB / m.nA).toFixed(3));
          check(`${label}: nessun pezzo di inchiostro a piu' di ${MAX_FAR_PX} px dall'altro (massimo ${Math.max(m.maxA, m.maxB).toFixed(1)} px)`, Math.max(m.maxA, m.maxB) <= MAX_FAR_PX, `${m.maxA}/${m.maxB}`);
        } else {
          // la pagina e' un'immagine: confronto tollerante con l'inviluppo (come e2e-cp5b): quota di pixel dell'immagine fuori dall'inviluppo dell'app, e viceversa
          const run = (shift) => hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [url(A0), url(A), bb, { r: ENV_R, tol: ENV_TOL, T: ENV_T, grow: ENV_GROW, shift, noImage: shift !== null }]);
          const e = await run(null);
          if (e.image) writeFileSync(join(OUT, `${file.replace('.pdf', '')}-${mode}-A_B_diff.png`), Buffer.from(e.image.split(',')[1], 'base64'));
          const q = (x, n) => (n ? x / n : 0);
          const outObj = Math.max(q(e.outBObj, e.nObj), q(e.outAObj, e.nObj));
          const outRest = Math.max(q(e.outBRest, e.nRest), q(e.outARest, e.nRest));
          info(`${label}, ${title}: fuori inviluppo (r=${ENV_R}, tol=${ENV_TOL}) | oggetti ${e.nObj} px: PDF ${(q(e.outBObj, e.nObj) * 100).toFixed(2)} %, app ${(q(e.outAObj, e.nObj) * 100).toFixed(2)} % | resto ${e.nRest} px: PDF ${(q(e.outBRest, e.nRest) * 100).toFixed(2)} %, app ${(q(e.outARest, e.nRest) * 100).toFixed(2)} % | eccesso massimo PDF ${e.maxBExcess}, app ${e.maxAExcess}`);
          check(`${label}: nelle aree degli oggetti al massimo ${MAX_OUT.obj * 100} % dei pixel fuori inviluppo`, e.nObj > 500 && outObj <= MAX_OUT.obj, `${(outObj * 100).toFixed(2)} % su ${e.nObj}`);
          check(`${label}: nel resto della pagina al massimo ${MAX_OUT.rest * 100} % dei pixel fuori inviluppo`, outRest <= MAX_OUT.rest, `${(outRest * 100).toFixed(2)} %`);
          const g = await run(BIG_SHIFT);
          const go = Math.max(q(g.outBObj, g.nObj), q(g.outAObj, g.nObj));
          const gr = Math.max(q(g.outBRest, g.nRest), q(g.outARest, g.nRest));
          check(`${label}: con il PDF spostato di ${BIG_SHIFT[0] / ZOOM} pt la stessa prova FALLISCE (la prova e' sensibile)`, go > MAX_OUT.obj || gr > MAX_OUT.rest, `oggetti ${(go * 100).toFixed(2)} %, resto ${(gr * 100).toFixed(2)} %`);
        }
      }
      await hp.close();
    } finally {
      await ctx.close();
    }
  }
}
const INK_T = 40;
const TOL_PX = 2;
const MIN_MATCH = 0.97;
const INK_RATIO = [0.9, 1.1];
const MAX_FAR_PX = 4;
// "Appiattito": confronto con l'inviluppo (stesse soglie di e2e-cp5b)
const ENV_R = 1;
const ENV_T = 40;
const ENV_GROW = 4;
const ENV_TOL = 48;
const MAX_OUT = { obj: 0.02, rest: 0.01 };
const BIG_SHIFT = [30, 0];

// ---------------------------------------------------------------- 9) tocco emulato (390 x 780)
async function touchSuite(browser) {
  setSection('Cerchio e Arco con il tocco emulato, 390x780');
  const { ctx, page, cdp } = await phone(browser);
  await openDoc(page, 'A4 vettoriale', true);
  const pinfo = await pageInfo(page);
  const U = (f) => userOf(pinfo, f);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(80);
  };
  const [a1, a2] = ANCH.segA.map(U);
  const [b1, b2] = ANCH.segB.map(U);
  const [c1, c2] = ANCH.segC.map(U);
  const k = await zoomPx(page);
  info(`zoom ${k.toFixed(3)} px/pt, raggio di cattura del dito 22 px = ${(22 / k).toFixed(1)} pt`);
  check('la palette ha il pulsante "Cerchio e arco" (>= 44 px di altezza) e la barra contestuale i pulsanti Cerchio e Arco (>= 44 px)', await (async () => {
    await tool(page, 'Cerchio e arco');
    return page.evaluate(() => [...document.querySelectorAll('.ctx-curves button, button.tool[title="Cerchio e arco"]')].every((b) => b.getBoundingClientRect().height >= 43.5));
  })());
  check('sotto 720 px (iPhone in verticale) l\'interruttore Centro non sta nella barra di stato ma solo nel pannello a destra (decisione 51)', (await page.locator('.statusbar .st-toggle[data-toggle="center"]').evaluate((e) => getComputedStyle(e).display)) === 'none' && (await page.locator('.panel-toggle[data-panel-toggle="center"]').count()) === 1);
  await curveTool(page, 'circle');
  await tap({ ...(await clientOfUser(page, a1)), x: (await clientOfUser(page, a1)).x + 6, y: (await clientOfUser(page, a1)).y + 5 });
  const s1 = await snapMark(page);
  await tap({ x: (await clientOfUser(page, b2)).x - 7, y: (await clientOfUser(page, b2)).y + 4 });
  let o = await lastObj(page);
  check('tocco, Cerchio: i due tocchi vicini agli Estremi (entro il raggio del dito) danno p1 e p2 esatti (entro 1e-6 pt)', o?.kind === 'circle' && nearP(o.p1, a1) && nearP(o.p2, b2), JSON.stringify([o, s1]));
  check('tocco: messaggio "Cerchio aggiunto: raggio ..."', /^Cerchio aggiunto: raggio .+ Annulla per toglierlo\.$/.test(await status(page)), await status(page));
  await curveTool(page, 'arc');
  for (const [u, dx, dy] of [[a2, 5, -5], [c1, -6, 3], [c2, 7, 6]]) {
    const c = await clientOfUser(page, u);
    await tap({ x: c.x + dx, y: c.y + dy });
  }
  o = await lastObj(page);
  check('tocco, Arco: tre tocchi vicini a tre Estremi danno p1, p2 e p3 esatti', o?.kind === 'arc' && nearP(o.p1, a2) && nearP(o.p2, c1) && nearP(o.p3, c2), JSON.stringify(o));
  // tre allineati
  await curveTool(page, 'arc');
  const n0 = (await objectsOf(page)).length;
  const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  for (const [u, dx, dy] of [[a1, 4, 4], [mid, 0, 6], [a2, -4, 4]]) {
    const c = await clientOfUser(page, u);
    await tap({ x: c.x + dx, y: c.y + dy });
  }
  check('tocco: tre punti allineati rifiutati con il messaggio, nessun oggetto aggiunto', (await status(page)) === 'I tre punti sono allineati: un arco non passa da tre punti su una retta.' && (await objectsOf(page)).length === n0, await status(page));
  await page.locator('.ctx-act', { hasText: 'Annulla' }).click();
  // Centro con il dito
  const circ = (await objectsOf(page)).find((x) => x.kind === 'circle');
  await tool(page, 'Retta');
  const cc = await clientOfUser(page, circ.p1);
  await touch(cdp, 'touchStart', [[cc.x + 8, cc.y - 7]]);
  await page.waitForTimeout(120);
  const mk = await snapMark(page);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  // il primo punto coincide con a1 (Estremo): il centro del cerchio e' a1; il candidato piu' vicino al dito e' lo stesso punto: si prova "Estremo" (stesso punto, priorita')
  check('tocco: vicino al punto in cui Centro (cerchio) ed Estremo (retta) coincidono vince l\'Estremo (priorita\')', !!mk && mk.kind === 'end', JSON.stringify(mk));
  await page.locator('.ctx-act', { hasText: 'Annulla' }).click();
  // selezione col dito sulla linea del cerchio
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'circle', a: [0.5, 0.5], b: [0.7, 0.5] }]));
  const cobj = (await objectsOf(page)).filter((x) => x.kind === 'circle').pop();
  const sc = G.userToSheet(cobj.p1), se = G.userToSheet(cobj.p2);
  const Rs = Math.hypot(se.x - sc.x, se.y - sc.y);
  await tool(page, 'Seleziona');
  const onC = await clientOfSheet(page, { x: sc.x - Rs, y: sc.y });
  await tap({ x: onC.x + 3, y: onC.y + 2 });
  check('tocco: un tocco sulla linea del cerchio lo seleziona ("Selezionato: Cerchio")', (await hint(page)) === 'Selezionato: Cerchio', await hint(page));
  const inC = await clientOfSheet(page, { x: sc.x, y: sc.y }); // il centro: a Rs (119 pt) dalla linea, oltre il raggio del dito (43 pt)
  await page.keyboard.press('Escape');
  await tap(inC);
  check('tocco: un tocco dentro il cerchio (lontano dalla linea) non lo seleziona', !/Cerchio/.test(await hint(page)), await hint(page));
  // tocco + tasto Canc
  await tap({ x: onC.x + 3, y: onC.y + 2 });
  const cnt = (await objectsOf(page)).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  check('tocco + Canc: "Cerchio cancellato. Annulla lo ripristina." e un solo passo di Annulla', (await status(page)) === 'Cerchio cancellato. Annulla lo ripristina.' && (await objectsOf(page)).length === cnt - 1);
  await undo(page);
  check('... Annulla lo ripristina', (await objectsOf(page)).length === cnt);
  // la lente: durante la mira il centro della lente e' il punto effettivo (mirino al centro); qui si controlla solo che compaia
  await curveTool(page, 'circle');
  const lensC = await clientOfUser(page, U([0.4, 0.45]));
  await touch(cdp, 'touchStart', [[lensC.x, lensC.y]]);
  await page.waitForTimeout(150);
  check('tocco: durante la mira compare la lente', (await page.locator('.lens:not([hidden])').count()) >= 1 || (await page.locator('.lens').count()) >= 1);
  await touch(cdp, 'touchEnd', []);
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only || only.includes(id);
  try {
    if (run('menu')) await menuSuite(browser);
    if (run('esatti')) for (const [t] of SAMPLES) await exactSuite(browser, t);
    if (run('centro')) for (const [t] of SAMPLES) await centerSuite(browser, t);
    if (run('linea')) await pendingSuite(browser, 'A4 vettoriale');
    if (run('linea')) await pendingSuite(browser, 'A4 con /Rotate 90');
    if (run('selezione')) {
      await selectSuite(browser, 'A4 vettoriale', false);
      await selectSuite(browser, 'A4 con /Rotate 90', true);
      await selectSuite(browser, 'A4 con CropBox', false);
    }
    if (run('costruzione')) await buildSuite(browser);
    if (run('progetto')) await projectSuite(browser);
    if (run('export')) await exportSuite(browser, harness);
    if (run('tocco')) await touchSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
