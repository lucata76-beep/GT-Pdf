// Prove di CP7f (V3.3a, Centro e Quadrante di archi e cerchi del PDF) su Chromium, NELL'EDITOR e nel registro di Diagnostica: mouse (desktop 1280 x 900) e tocco emulato (390 x 780).
// Si costruisce QUI, in memoria (nessun file in public/: i PDF tracciati restano 7), un PDF con un cerchio (4 cubiche, chiuso), un arco di 150 gradi (2 cubiche, aperto), un poligono di 24 vertici e
// una S (due archi opposti); poi lo stesso con /Rotate 90. I punti attesi (centri, raggi, quadranti dentro l'arco) sono calcolati DA QUESTO SCRIPT con le formule di PageViewport (`makeGeom`) e
// con le costruzioni note: NON vengono dal codice dell'app. Si prova: lo stato letto (anelli riconosciuti, centri e quadranti nel foglio), il marcatore «Centro» e «Quadrante» (etichetta, forma,
// posizione) e il punto inserito dal clic; nessun marcatore sul poligono, sulla S e nel prolungamento di un arco; gli interruttori Centro, Quadrante e «PDF»; la priorita' (con tutti i tipi accesi
// il quadrante di un cerchio, che coincide con un suo Estremo, mostra l'Estremo); il registro di Diagnostica con la frase degli anelli e senza il nome del file; il tocco.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')). Chromium NON e' il browser dell'utente (Edge sul PC, Safari su iPhone).
// Uso: node scripts/e2e-cp7f.cjs [cartella-immagini]   (E2E_DIST=<cartella di un build di prova gia' fatto> per provare quel build: su e22698a gli anelli non ci sono e i controlli FALLISCONO)
//   E2E_ONLY=anelli,rotate,registro,tocco: solo alcune serie (per il debug)
const { join } = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, PDFName, degrees } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7f', out: process.argv[2], port: 4254, hport: 4255, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const SECRET = 'cliente-riservato-7f2b';
const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const P = (x, y) => ({ x, y });
/** Tolleranza (pt utente) del punto inserito rispetto al centro o al quadrante veri: il centro e' quello del cerchio adattato (errore ~1e-4 del raggio per un arco da 2 cubiche, molto meno per un cerchio) piu' il Float32. */
const USER_TOL = 0.02;
const KINDS = ['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent'];
const LABEL = { end: 'Estremo', center: 'Centro', quadrant: 'Quadrante' };

// ---------------------------------------------------------------- costruzioni note (calcolate QUI)
/** Cubica standard di un arco (centro, raggio, angolo iniziale e ampiezza in rad): k = 4/3 tan(th/4). */
function arcCubic(cx, cy, r, a0, th) {
  const k = (4 / 3) * Math.tan(th / 4);
  const a1 = a0 + th;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  return [x0, y0, x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0), x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1), x1, y1];
}
const chain = (cx, cy, r, startDeg, totalDeg, parts) => Array.from({ length: parts }, (_, j) => arcCubic(cx, cy, r, startDeg * DEG + (j * totalDeg * DEG) / parts, (totalDeg * DEG) / parts));
const f6 = (v) => v.toFixed(6);
const pdfChain = (ch, close = false) => `${f6(ch[0][0])} ${f6(ch[0][1])} m ${ch.map((c) => `${f6(c[2])} ${f6(c[3])} ${f6(c[4])} ${f6(c[5])} ${f6(c[6])} ${f6(c[7])} c`).join(' ')}${close ? ' h' : ''}`;
const polygon = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((360 * i) / n * DEG), y: cy + r * Math.sin((360 * i) / n * DEG) }));
const pdfPoly = (pts) => `${pts.map((p, i) => `${f6(p.x)} ${f6(p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ')} h`;
async function contentPdf(content, { size = [600, 800], rotate = 0 } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage(size);
  if (rotate) pg.setRotation(degrees(rotate));
  const c = doc.context;
  pg.node.set(PDFName.of('Resources'), c.obj({}));
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  return doc.save({ useObjectStreams: false });
}

// il contenuto: cerchio, arco, poligono, S (tutti nello spazio utente di una pagina 600 x 800)
const CIRCLE = { cx: 150, cy: 600, r: 60 };
const ARC = { cx: 400, cy: 600, r: 50, start: 20, sweep: 150 }; // da 20 a 170 gradi (antiorario con Y in su): contiene SOLO il quadrante a 90 gradi (in alto)
const POLY = { cx: 150, cy: 350, r: 60, n: 24 };
const S1 = { cx: 350, cy: 350, r: 50 }; // primo arco 0 -> 90, giunto in (350, 400); secondo arco di centro (350, 450) da 270 a 180 (orario)
const S2 = { cx: 350, cy: 450, r: 50 };
const CONTENT = [
  `${pdfChain(chain(CIRCLE.cx, CIRCLE.cy, CIRCLE.r, 0, 360, 4), true)} S`,
  `${pdfChain(chain(ARC.cx, ARC.cy, ARC.r, ARC.start, ARC.sweep, 2))} S`,
  `${pdfPoly(polygon(POLY.cx, POLY.cy, POLY.r, POLY.n))} S`,
  `${pdfChain([arcCubic(S1.cx, S1.cy, S1.r, 0, 90 * DEG), arcCubic(S2.cx, S2.cy, S2.r, 270 * DEG, -90 * DEG)])} S`,
].join('\n');

// ---------------------------------------------------------------- strumenti (come e2e-cp7d.cjs)
async function desktop(browser, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('ERRORE PAGINA:', e.message);
  });
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, errors };
}
async function phone(browser, w = 390, h = 780) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('ERRORE PAGINA:', e.message);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, cdp, errors };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(150);
};
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const pdfState = (page) => page.evaluate(() => window.__gtpdf.pdfSnap());
async function waitPdfSnap(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const s = window.__gtpdf.pdfSnap();
    return s.state !== null && s.state !== 'busy';
  }, null, { timeout });
  await page.waitForTimeout(120);
  return (await pdfState(page)).state;
}
/** Geometria di una pagina ricalcolata QUI con le formule di PageViewport (non dipende dal codice dell'app). */
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
  return { width, height, userToSheet: (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }) };
}
let G = null;
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const clientOfUser = async (page, u) => {
  const s = G.userToSheet(u);
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
const snapMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    const svg = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)\s*\)/);
    const shape = g.querySelector('rect, polygon, circle, path');
    return { kind: g.dataset.kind, label: g.querySelector('text')?.textContent ?? null, shape: shape?.tagName.toLowerCase() ?? null, x: m ? svg.left + +m[1] : NaN, y: m ? svg.top + +m[2] : NaN };
  });
async function hoverMark(page, c, dx = 0.3, dy = -0.2) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.waitForTimeout(35);
  return snapMark(page);
}
async function click(page, c, dx = 0.3, dy = -0.2) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
async function loadNamed(page, name, buffer) {
  await page.setInputFiles('input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(buffer) });
  await page.waitForFunction((n) => document.querySelector('.doc-name')?.textContent === n, name, { timeout: 120000 });
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(500);
}
async function showFit(page, pageNo = 1) {
  G = makeGeom(await page.evaluate((n) => window.__gtpdf.pages()[n - 1], pageNo));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  return waitPdfSnap(page);
}
const panelToggle = (page, id) => page.locator(`.panel-toggle[data-panel-toggle="${id}"]`);
/** Esegue `fn` con il pannello «Aggancio e griglia» visibile: sotto 900 px il pannello e' a scomparsa (si apre e si richiude, come in e2e-cp6f.cjs; il foglio puo' riadattarsi, ma ogni posizione si rilegge dal canvas). */
async function withPanel(page, fn) {
  const hidden = !(await panelToggle(page, 'end').isVisible());
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  try {
    await fn();
  } finally {
    if (hidden) {
      await page.locator('.insp-toggle').click();
      await page.waitForTimeout(150);
    }
  }
}
async function setSwitch(page, id, on) {
  await withPanel(page, async () => {
    const b = panelToggle(page, id);
    if (((await b.getAttribute('aria-pressed')) === 'true') !== on) {
      await b.click();
      await page.waitForTimeout(60);
    }
  });
}
async function only(page, ids) {
  await withPanel(page, async () => {
    for (const id of KINDS) {
      const b = panelToggle(page, id);
      if (((await b.getAttribute('aria-pressed')) === 'true') !== ids.includes(id)) await b.click();
    }
    await page.waitForTimeout(60);
  });
}
async function diagLog(page) {
  await page.evaluate(() => (location.hash = '#diag'));
  await page.waitForSelector('textarea[aria-label="Registro eventi"]', { state: 'attached' });
  await page.waitForTimeout(200);
  const t = await page.locator('textarea[aria-label="Registro eventi"]').inputValue();
  await page.evaluate(() => (location.hash = ''));
  await page.waitForTimeout(250);
  return t;
}

/** Il centro e i quattro quadranti veri di un cerchio utente, nello spazio utente (i quadranti del FOGLIO si ricavano con il foglio: vedi `quadrantsOnSheet`). */
const userAt = (c, deg) => P(c.cx + c.r * Math.cos(deg * DEG), c.cy + c.r * Math.sin(deg * DEG));
/** I quattro quadranti nel foglio di un cerchio utente (angoli 0, 90, 180 e 270 del foglio mostrato: destra, basso, sinistra, alto), riportati nello spazio utente con la matrice inversa. */
function quadrantsOnSheet(c) {
  const s = G.userToSheet(P(c.cx, c.cy));
  const unit = Math.abs(G.userToSheet(P(1, 0)).x - G.userToSheet(P(0, 0)).x) + Math.abs(G.userToSheet(P(1, 0)).y - G.userToSheet(P(0, 0)).y); // scala (UserUnit): 1 qui
  const rs = c.r * unit;
  return { sheetCenter: s, pts: { 0: P(s.x + rs, s.y), 90: P(s.x, s.y + rs), 180: P(s.x - rs, s.y), 270: P(s.x, s.y - rs) }, rs };
}
/** Un punto del foglio (come marcatore a schermo atteso): lo converte in coordinate della pagina del browser. */
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
/** Passa il cursore su un punto del foglio e confronta il marcatore: `want` = {kind, at: punto del foglio} oppure null. Restituisce la descrizione dell'errore o null. */
async function hoverSheet(page, what, s, want) {
  const m = await hoverMark(page, await clientOfSheet(page, s));
  if (!want) return m === null ? null : `${what}: atteso nessun marcatore, c'e' ${JSON.stringify(m)}`;
  const c = await clientOfSheet(page, want.at);
  const ok = !!m && m.kind === want.kind && m.label === LABEL[want.kind] && dist(m, c) < 0.75;
  return ok ? null : `${what}: ${JSON.stringify(m)} atteso ${want.kind} in (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`;
}
/** Il punto inserito dal primo clic di una Retta (vicino a `s`, nel foglio, con scarto) e poi un secondo clic lontano; restituisce il primo punto dell'ultimo oggetto. */
async function clickFirstPoint(page, s, freeSheet, dx = 3, dy = -2) {
  await click(page, await clientOfSheet(page, s), dx, dy);
  await click(page, await clientOfSheet(page, freeSheet), 0, 0);
  const objs = await objectsOf(page);
  const last = objs[objs.length - 1];
  return last && last.kind === 'segment' ? last.points[0] : null;
}
const sheetToUserPt = (s) => {
  // inversa della matrice di makeGeom, per confrontare il punto inserito (utente) con quello atteso (foglio)
  const o = G.userToSheet(P(0, 0));
  const ex = G.userToSheet(P(1, 0));
  const ey = G.userToSheet(P(0, 1));
  const a = ex.x - o.x, b = ex.y - o.y, c = ey.x - o.x, d = ey.y - o.y;
  const det = a * d - b * c;
  const x = s.x - o.x, y = s.y - o.y;
  return P((d * x - c * y) / det, (-b * x + a * y) / det);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function ringsSuite(browser, rotate) {
  setSection(rotate ? `anelli del PDF con /Rotate ${rotate}, 1280 x 900 con il mouse` : 'anelli del PDF, 1280 x 900 con il mouse');
  const { ctx, page, errors } = await desktop(browser);
  await loadNamed(page, `${SECRET}-anelli.pdf`, await contentPdf(CONTENT, { rotate }));
  const st = await showFit(page, 1);
  const rs = st.ringStats;
  check('lo stato letto: 2 anelli riconosciuti (1 cerchio, 1 arco), 2 centri e 5 quadranti nel foglio (4 del cerchio e 1 dell\'arco); il poligono e la S no', !!rs && rs.rings === 2 && rs.circles === 1 && rs.arcs === 1 && rs.centers === 2 && rs.quadrants === 5 && rs.hiddenRings === 0, JSON.stringify(rs));
  await tool(page, 'Retta');
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 1280 px`);
  // ---- Centro del cerchio e dell'arco (solo l'interruttore Centro)
  await only(page, ['center']);
  const circ = quadrantsOnSheet(CIRCLE);
  const arc = quadrantsOnSheet(ARC);
  let err = await hoverSheet(page, 'Centro del cerchio', circ.sheetCenter, { kind: 'center', at: circ.sheetCenter });
  check('Centro del cerchio: marcatore «Centro» nel centro vero (entro 0.75 px)', err === null, err ?? '');
  err = await hoverSheet(page, 'Centro dell\'arco', arc.sheetCenter, { kind: 'center', at: arc.sheetCenter });
  check('Centro dell\'arco: marcatore «Centro» nel centro del cerchio dell\'arco (che sta fuori dall\'arco), entro 0.75 px', err === null, err ?? '');
  const free = G.userToSheet(P(30, 30));
  const p1 = await clickFirstPoint(page, circ.sheetCenter, free);
  const e1 = sheetToUserPt(circ.sheetCenter);
  check('il clic inserisce il centro del cerchio (entro 0.02 pt utente)', !!p1 && near(p1.x, e1.x, USER_TOL) && near(p1.y, e1.y, USER_TOL), JSON.stringify(p1));
  const p2 = await clickFirstPoint(page, arc.sheetCenter, free);
  const e2 = sheetToUserPt(arc.sheetCenter);
  check('il clic inserisce il centro dell\'arco (entro 0.02 pt utente)', !!p2 && near(p2.x, e2.x, USER_TOL) && near(p2.y, e2.y, USER_TOL), JSON.stringify(p2));
  // ---- nessun Centro sul poligono e sulla S (nei punti dove ci sarebbe il centro di un cerchio): nessun marcatore
  const polyC = G.userToSheet(P(POLY.cx, POLY.cy));
  err = await hoverSheet(page, 'centro del poligono', polyC, null);
  check('poligono di 24 vertici: nessun Centro (i vertici non sono un cerchio)', err === null, err ?? '');
  for (const [name, u] of [['S: centro del primo arco', P(S1.cx, S1.cy)], ['S: centro del secondo arco', P(S2.cx, S2.cy)], ['S: il giunto', P(350, 400)]]) {
    err = await hoverSheet(page, name, G.userToSheet(u), null);
    check(`${name}: nessun Centro`, err === null, err ?? '');
  }
  // ---- Quadrante: i quattro quadranti del cerchio, e per l'arco solo quello DENTRO l'arco (a 90 gradi utente = in alto nella pagina senza rotazione)
  await only(page, ['quadrant']);
  for (const q of [0, 90, 180, 270]) {
    err = await hoverSheet(page, `quadrante ${q} del cerchio`, circ.pts[q], { kind: 'quadrant', at: circ.pts[q] });
    check(`Quadrante del cerchio a ${q} gradi del foglio: marcatore «Quadrante» nel punto vero`, err === null, err ?? '');
  }
  // quale quadrante del foglio e' dentro l'arco: quello che sta fra i suoi estremi (calcolato QUI campionando l'arco vero e portandolo nel foglio)
  const inside = [];
  const outside = [];
  const samples = Array.from({ length: 1501 }, (_, i) => G.userToSheet(userAt({ cx: ARC.cx, cy: ARC.cy, r: ARC.r }, ARC.start + (ARC.sweep * i) / 1500)));
  for (const q of [0, 90, 180, 270]) {
    const p = arc.pts[q];
    const target = (Math.atan2(p.y - arc.sheetCenter.y, p.x - arc.sheetCenter.x) * 180) / Math.PI;
    const covered = samples.some((s) => Math.abs(((Math.atan2(s.y - arc.sheetCenter.y, s.x - arc.sheetCenter.x) * 180) / Math.PI - target + 540) % 360 - 180) <= 0.1);
    (covered ? inside : outside).push(q);
  }
  check('l\'arco da 20 a 170 gradi ha un solo quadrante del foglio (calcolo dello script)', inside.length === 1 && outside.length === 3, JSON.stringify({ inside, outside }));
  for (const q of inside) {
    err = await hoverSheet(page, `quadrante ${q} dell'arco`, arc.pts[q], { kind: 'quadrant', at: arc.pts[q] });
    check(`Quadrante dell'arco a ${q} gradi del foglio (dentro l'arco): marcatore «Quadrante» nel punto vero`, err === null, err ?? '');
  }
  for (const q of outside) {
    err = await hoverSheet(page, `quadrante ${q} nel prolungamento`, arc.pts[q], null);
    check(`nel prolungamento dell'arco (quadrante a ${q} gradi del foglio) nessun Quadrante`, err === null, err ?? '');
  }
  // il clic sul quadrante del cerchio inserisce quel punto
  const qs = inside.length ? arc.pts[inside[0]] : arc.pts[90];
  const pq = await clickFirstPoint(page, circ.pts[0], free);
  const eq = sheetToUserPt(circ.pts[0]);
  check('il clic inserisce il quadrante del cerchio (entro 0.02 pt utente)', !!pq && near(pq.x, eq.x, USER_TOL) && near(pq.y, eq.y, USER_TOL), JSON.stringify(pq));
  void qs;
  // ---- poligono e S: nessun Quadrante dove ce ne sarebbe uno (a destra, in basso, a sinistra e in alto del cerchio circoscritto)
  const polyQ = quadrantsOnSheet(POLY);
  const errs = [];
  for (const q of [0, 90, 180, 270]) {
    const e = await hoverSheet(page, `poligono ${q}`, polyQ.pts[q], null);
    if (e) errs.push(e);
  }
  check('poligono di 24 vertici: nessun Quadrante ai quattro punti del suo cerchio circoscritto (con Estremo spento)', errs.length === 0, errs.join(' | '));
  // ---- gli interruttori e «PDF»
  await only(page, ['center', 'quadrant']);
  const mC = await hoverMark(page, await clientOfSheet(page, circ.sheetCenter));
  check('con Centro e Quadrante accesi: nel centro del cerchio il marcatore e\' «Centro»', !!mC && mC.kind === 'center', JSON.stringify(mC));
  await only(page, ['quadrant']);
  const mNoC = await hoverMark(page, await clientOfSheet(page, circ.sheetCenter));
  check('con Centro spento (Quadrante acceso): nessun Centro del PDF', mNoC === null, JSON.stringify(mNoC));
  await only(page, ['center']);
  const mNoQ = await hoverMark(page, await clientOfSheet(page, circ.pts[0]));
  check('con Quadrante spento (Centro acceso): nessun Quadrante del PDF', mNoQ === null, JSON.stringify(mNoQ));
  await only(page, ['center', 'quadrant']);
  await setSwitch(page, 'pdf', false);
  const mOff1 = await hoverMark(page, await clientOfSheet(page, circ.sheetCenter));
  const mOff2 = await hoverMark(page, await clientOfSheet(page, circ.pts[90]));
  check('con «PDF» spento: nessun Centro e nessun Quadrante del PDF', mOff1 === null && mOff2 === null, JSON.stringify([mOff1, mOff2]));
  await setSwitch(page, 'pdf', true);
  // ---- priorita': con tutti i tipi accesi il quadrante di un cerchio (che coincide con un suo Estremo) mostra l'Estremo
  await only(page, KINDS);
  const mAll = await hoverMark(page, await clientOfSheet(page, circ.pts[0]));
  check('con tutti i tipi accesi, nel quadrante di un cerchio del PDF (dove c\'e\' anche un Estremo) il marcatore e\' «Estremo» (priorita\')', !!mAll && mAll.kind === 'end', JSON.stringify(mAll));
  // un oggetto disegnato non cambia: un Cerchio disegnato sopra il cerchio del PDF mostra il suo Centro (stesso punto): il marcatore e' sempre «Centro»
  const objs = await objectsOf(page);
  check('gli anelli non sono oggetti: nessun oggetto nel modello oltre alle 3 rette disegnate dalla prova', objs.every((o) => o.kind === 'segment') && objs.length === 3, JSON.stringify(objs.map((o) => o.kind)));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function logSuite(browser) {
  setSection('registro di Diagnostica con la frase degli anelli');
  const { ctx, page, errors } = await desktop(browser);
  await loadNamed(page, `${SECRET}-anelli.pdf`, await contentPdf(CONTENT));
  await showFit(page, 1);
  const t = await diagLog(page);
  const line = t.split('\n').find((l) => /Snap PDF, pagina 1: pronto/.test(l)) || '';
  check('il registro riporta gli anelli: «anelli: 2 riconosciuti (1 cerchi, 1 archi), 2 centri e 5 quadranti nel foglio» con MB e ms', /; anelli: 2 riconosciuti \(1 cerchi, 1 archi\), 2 centri e 5 quadranti nel foglio \(\d\.\d\d MB, \d+ ms\)/.test(line), line);
  check('la riga del registro mantiene la parte di prima (estremi, punti medi e curve)', /pronto, \d+ estremi e \d+ punti medi da \d+ tratti; curve: \d+ estremi da \d+ cubiche \(\d+ estremi in tutto\)/.test(line), line);
  check('nessuna riga dello snap PDF contiene il nome del file', !t.split('\n').filter((l) => /Snap PDF/.test(l)).some((l) => l.includes(SECRET)), '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function touchSuite(browser) {
  setSection('tocco 390x780');
  const { ctx, page, cdp, errors } = await phone(browser);
  await loadNamed(page, `${SECRET}-anelli.pdf`, await contentPdf(CONTENT));
  const st = await showFit(page, 1);
  check('tocco: lo stato letto ha gli stessi anelli (2 riconosciuti, 2 centri e 5 quadranti)', !!st.ringStats && st.ringStats.rings === 2 && st.ringStats.centers === 2 && st.ringStats.quadrants === 5, JSON.stringify(st.ringStats));
  await tool(page, 'Retta');
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 390 px`);
  await only(page, ['center']);
  const circ = quadrantsOnSheet(CIRCLE);
  const s = await clientOfSheet(page, circ.sheetCenter);
  await touch(cdp, 'touchStart', [[s.x + 4, s.y + 14]]);
  await page.waitForTimeout(120);
  let m = await snapMark(page);
  check('tocco: a 14.6 px dal centro del cerchio compare «Centro» nel punto giusto (raggio del dito 22 px)', !!m && m.kind === 'center' && m.label === 'Centro' && dist(m, s) < 0.75, JSON.stringify(m));
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  const far = await clientOfSheet(page, G.userToSheet(P(40, 40)) /* un punto libero lontano */);
  await touch(cdp, 'touchStart', [[far.x, far.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  const objs = await objectsOf(page);
  const last = objs[objs.length - 1];
  const e = sheetToUserPt(circ.sheetCenter);
  check('tocco: il primo punto inserito e\' il centro del cerchio (entro 0.02 pt utente)', !!last && last.kind === 'segment' && near(last.points[0].x, e.x, USER_TOL) && near(last.points[0].y, e.y, USER_TOL), JSON.stringify(last?.points?.[0]));
  await touch(cdp, 'touchStart', [[s.x, s.y + 23.5]]);
  await page.waitForTimeout(100);
  m = await snapMark(page);
  check('tocco: a 23.5 px dal centro non si aggancia a quel punto', m === null || dist(m, s) > 1, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  await only(page, ['quadrant']);
  const q0 = await clientOfSheet(page, circ.pts[270]);
  await touch(cdp, 'touchStart', [[q0.x + 3, q0.y + 12]]);
  await page.waitForTimeout(120);
  m = await snapMark(page);
  check('tocco: a 12.4 px dal quadrante in alto del cerchio compare «Quadrante» nel punto giusto', !!m && m.kind === 'quadrant' && m.label === 'Quadrante' && dist(m, q0) < 0.75, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
const SUITES = {
  anelli: (browser) => ringsSuite(browser, 0),
  rotate: (browser) => ringsSuite(browser, 90),
  registro: logSuite,
  tocco: touchSuite,
};
(async () => {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const servers = await lib.startAll(chromium);
  const guarded = async (name, fn) => {
    setSection(name);
    try {
      await fn(servers.browser);
    } catch (e) {
      check(`la serie "${name}" arriva in fondo`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  };
  for (const [name, fn] of Object.entries(SUITES)) {
    if (only && !only.includes(name)) continue;
    await guarded(name, fn);
  }
  await lib.stopAll(servers);
  lib.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
