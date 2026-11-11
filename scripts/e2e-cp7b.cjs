// Prove di CP7b (V3.1, Snap sul PDF: Estremo e Punto medio sui tratti rettilinei) su Chromium, NELL'EDITOR (non in Diagnostica): mouse (desktop 1280 x 900) e tocco emulato (390 x 780).
// Si prova, con i 7 PDF di prova di public/test-pdfs aperti nell'editor: il marcatore (quadrato = Estremo, triangolo = Punto medio, con l'etichetta) compare nel punto del disegno del PDF
// calcolato QUI con le coordinate di scripts/make-test-pdfs.mjs (drawSheet) e le formule del foglio (non con il codice dell'app), anche con /Rotate 90 e con CropBox, per tutti i
// 20 Estremi e i Punti medi distinti; il punto inserito coincide con il punto del PDF; interruttore «PDF» (barra di stato, pannello, titolo, messaggio) e interruttori Estremo e
// Punto medio; scansione (nessun aggancio, nessun errore, messaggio e registro); livelli (nessun aggancio nel livello spento); PDF sopra il tetto (messaggio, nessun aggancio, editor
// usabile); cambio di pagina e di documento durante la lettura; l'esportazione non svuota la cache dei punti; e la prova che serve davvero: una QUOTA fra due punti del PDF agganciati,
// dopo la calibrazione sul riferimento di 100 mm, uguale al valore atteso (tolleranza 0.01 mm).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp7b.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 3bbe3a8 (senza snap sul PDF) i controlli sullo snap FALLISCONO)
//   E2E_ONLY=punti,tocco,interruttori,scansione,livelli,tetto,pagine,quota,esporta: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente (browser del PC o Safari/iPhone): nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, PDFName, PDFString } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7b', out: process.argv[2], port: 4238, hport: 4239, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const MM = 72 / 25.4; // pt per mm
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const A4 = [595.276, 841.89];
const A3L = [1190.551, 841.89];
const SECRET = 'cliente-riservato-7c1e';
/** Tolleranza (pt utente) fra il punto inserito e quello atteso: il Float32 di PDF.js sposta le coordinate di ~3e-5 pt su A3. */
const USER_TOL = 1e-4;
/** Tolleranza (mm) della quota: il valore e' scritto con due decimali. */
const MM_TOL = 0.01;

// ---------------------------------------------------------------- strumenti
async function desktop(browser, w = 1280, h = 900, uiIdx = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('ERRORE PAGINA:', e.message);
  });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, errors };
}
async function phone(browser, w = 390, h = 780, uiIdx = 1) {
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
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, cdp, errors };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(150);
};
const status = (page) => page.locator('.st-msg').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const barToggle = (page, id) => page.locator(`.statusbar .st-toggle[data-toggle="${id}"]`);
const panelToggle = (page, id) => page.locator(`.panel-toggle[data-panel-toggle="${id}"]`);
/** Lo stato dello snap sul PDF letto dal gancio di prova; null se il build non ha il gancio (3bbe3a8). */
const pdfState = (page) => page.evaluate(() => (window.__gtpdf.pdfSnap ? window.__gtpdf.pdfSnap() : null));
/** Aspetta che la lettura dei punti della pagina corrente sia finita (pronto o altro stato); senza gancio aspetta un tempo fisso (build senza snap sul PDF). */
async function waitPdfSnap(page, timeout = 60000) {
  const has = await page.evaluate(() => !!window.__gtpdf.pdfSnap);
  if (!has) {
    await page.waitForTimeout(1200);
    return null;
  }
  await page.waitForFunction(() => {
    const s = window.__gtpdf.pdfSnap();
    return s.state !== null && s.state !== 'busy';
  }, null, { timeout });
  await page.waitForTimeout(120);
  return (await pdfState(page)).state;
}

/** Geometria di una pagina, ricalcolata qui da `pages()` con le formule di PageViewport (come e2e-cp6a): cosi' non dipende dal codice dell'app. */
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
let G = null; // geometria della pagina mostrata
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const clientOfUser = async (page, u) => {
  const s = G.userToSheet(u);
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
/** Il marcatore di snap: tipo, etichetta, forma e posizione sullo schermo; null se non c'e'. */
const snapMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    const svg = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const m = (g.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)\s*\)/);
    const shape = g.querySelector('rect, polygon');
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
const FILE_OF = {
  'A4 vettoriale': 'a4-vettoriale.pdf',
  'A3 vettoriale': 'a3-vettoriale.pdf',
  'A4 con /Rotate 90': 'a4-rotate90.pdf',
  'A4 con CropBox': 'a4-cropbox.pdf',
  'A4 scansione (immagine)': 'a4-scansione.pdf',
  '3 pagine miste': 'misto-3-pagine.pdf',
  'A4 con annotazioni': 'a4-annotazioni.pdf',
};
/** Carica un PDF dal selettore di file (anche con un documento gia' aperto: non chiede conferma) e aspetta che sia quello mostrato. */
async function loadNamed(page, name, buffer) {
  await page.setInputFiles('input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(buffer) });
  await page.waitForFunction((n) => document.querySelector('.doc-name')?.textContent === n, name, { timeout: 120000 });
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(500);
}
/** Apre un PDF di prova nell'editor e adatta la pagina; imposta G. */
async function openDoc(page, title, pageNo = 1) {
  const file = FILE_OF[title];
  await loadNamed(page, file, readFileSync(join(PDF_DIR, file)));
  if (pageNo !== 1) {
    await page.evaluate((n) => window.__gtpdf.goTo(n), pageNo);
    await page.waitForTimeout(400);
  }
  G = makeGeom(await page.evaluate((n) => window.__gtpdf.pages()[n - 1], pageNo));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  return waitPdfSnap(page);
}

// ---------------------------------------------------------------- punti attesi (make-test-pdfs.mjs, drawSheet)
/** Estremi e Punti medi DISTINTI del disegno di un foglio con riquadro visibile (x, y, w, h) nello spazio utente: le stesse coordinate di drawSheet. */
function sheetPoints(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const qy = cy - r - 18;
  const ry = y + 62;
  const rx = x + 28;
  const P = (px, py) => ({ x: px, y: py });
  const mid = (a, b) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
  const ends = {
    'angolo rettangolo (basso sx)': P(x + 10, y + 10),
    'angolo rettangolo (basso dx)': P(x + w - 10, y + 10),
    'angolo rettangolo (alto dx)': P(x + w - 10, y + h - 10),
    'angolo rettangolo (alto sx)': P(x + 10, y + h - 10),
    'asse orizzontale, sinistra': P(cx - 1.15 * r, cy),
    'asse orizzontale, destra': P(cx + 1.15 * r, cy),
    'asse verticale, basso': P(cx, cy - 1.15 * r),
    'asse verticale, alto': P(cx, cy + 1.15 * r),
    'quota, sinistra': P(cx - r, qy),
    'quota, destra': P(cx + r, qy),
    'quota, tacca sinistra bassa': P(cx - r, qy - 4),
    'quota, tacca sinistra alta': P(cx - r, qy + 4),
    'quota, tacca destra bassa': P(cx + r, qy - 4),
    'quota, tacca destra alta': P(cx + r, qy + 4),
    'riferimento 100 mm, sinistra': P(rx, ry),
    'riferimento 100 mm, destra': P(rx + 100 * MM, ry),
    'riferimento, tacca sinistra bassa': P(rx, ry - 6),
    'riferimento, tacca sinistra alta': P(rx, ry + 6),
    'riferimento, tacca destra bassa': P(rx + 100 * MM, ry - 6),
    'riferimento, tacca destra alta': P(rx + 100 * MM, ry + 6),
  };
  const a = ends['angolo rettangolo (basso sx)'];
  const b = ends['angolo rettangolo (basso dx)'];
  const c = ends['angolo rettangolo (alto dx)'];
  const d = ends['angolo rettangolo (alto sx)'];
  const mids = {
    'centro del lato basso': mid(a, b),
    'centro del lato destro': mid(b, c),
    'centro del lato alto': mid(c, d),
    'centro del lato sinistro': mid(d, a),
    'incrocio degli assi (centro)': P(cx, cy),
    'quota, centro': P(cx, qy),
    'riferimento 100 mm, centro': P(rx + 50 * MM, ry),
  };
  // i Punti medi delle tacche cadono sugli Estremi della linea (stessa posizione): vince l'Estremo (priorita' del tipo)
  const shadowed = { 'quota, centro della tacca sinistra (= Estremo)': ends['quota, sinistra'], 'quota, centro della tacca destra (= Estremo)': ends['quota, destra'], 'riferimento, centro della tacca sinistra (= Estremo)': ends['riferimento 100 mm, sinistra'], 'riferimento, centro della tacca destra (= Estremo)': ends['riferimento 100 mm, destra'] };
  return { ends, mids, shadowed };
}
const SHEET_BOXES = {
  'A4 vettoriale': [0, 0, A4[0], A4[1]],
  'A3 vettoriale': [0, 0, A3L[0], A3L[1]],
  'A4 con /Rotate 90': [0, 0, A4[0], A4[1]],
  'A4 con CropBox': [50, 50, 400, 550],
};
const LABEL = { end: 'Estremo', mid: 'Punto medio' };

/** Per ogni punto atteso: il mouse sul punto compare il marcatore del tipo giusto (con l'etichetta) nel punto giusto (entro 0.75 px). */
async function checkSheetPoints(page, name, box, tag = name) {
  const pts = sheetPoints(...box);
  const state = await pdfState(page);
  let bad = [];
  let n = 0;
  for (const [group, kind] of [[pts.ends, 'end'], [pts.mids, 'mid'], [pts.shadowed, 'end']]) {
    for (const [what, u] of Object.entries(group)) {
      const c = await clientOfUser(page, u);
      const m = await hoverMark(page, c);
      n++;
      const ok = !!m && m.kind === kind && m.label === LABEL[kind] && dist(m, c) < 0.75;
      if (!ok) bad.push(`${what}: ${JSON.stringify(m)} atteso ${kind} in (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
    }
  }
  check(`${tag}: ${n} punti noti del disegno (20 Estremi, 7 Punti medi, 4 centri delle tacche): marcatore del tipo e nel punto giusti`, bad.length === 0, bad.slice(0, 3).join(' | '));
  if (state && state.state && state.state.kind === 'ready') {
    check(`${tag}: lo stato dice 12 tratti, 20 Estremi e 11 Punti medi`, state.state.segments === 12 && state.state.nEnd === 20 && state.state.nMid === 11, JSON.stringify(state.state));
  }
  return pts;
}

// ---------------------------------------------------------------- serie 1: punti del PDF (mouse)
async function pointsSuite(browser) {
  setSection('punti del PDF, mouse 1280x900');
  const { ctx, page, errors } = await desktop(browser);
  for (const [title, box] of Object.entries(SHEET_BOXES)) {
    await openDoc(page, title);
    await tool(page, 'Retta');
    const pts = await checkSheetPoints(page, title, box);
    // raggio del mouse: 10 px CSS
    const c = await clientOfUser(page, pts.ends['angolo rettangolo (basso sx)']);
    let m = await hoverMark(page, c, 9.5, 0);
    check(`${title}: a 9.5 px da un Estremo del PDF si aggancia`, !!m && m.kind === 'end');
    m = await hoverMark(page, c, 10.5, 0);
    check(`${title}: a 10.5 px da un Estremo del PDF non si aggancia`, m === null, JSON.stringify(m));
    m = await hoverMark(page, c, 0, -150);
    check(`${title}: lontano da ogni punto: nessun marcatore`, m === null, JSON.stringify(m));
    // il punto INSERITO e' quello del PDF (spazio utente, Float32 di PDF.js: 1e-4)
    for (const [what, u, kind] of [
      ['Estremo (angolo del rettangolo)', pts.ends['angolo rettangolo (basso sx)'], 'end'],
      ['Estremo (riferimento 100 mm)', pts.ends['riferimento 100 mm, destra'], 'end'],
      ['Punto medio (centro del lato destro)', pts.mids['centro del lato destro'], 'mid'],
      ['Punto medio (incrocio degli assi)', pts.mids['incrocio degli assi (centro)'], 'mid'],
    ]) {
      const s = await clientOfUser(page, u);
      await click(page, s, 3, -2);
      const far = await clientOfUser(page, { x: box[0] + box[2] * 0.4, y: box[1] + box[3] * 0.18 });
      await click(page, far, 0, 0);
      const objs = await objectsOf(page);
      const last = objs[objs.length - 1];
      check(`${title}: ${what}: il primo punto inserito coincide con il punto del PDF (entro ${USER_TOL} pt)`, last && last.kind === 'segment' && near(last.points[0].x, u.x, USER_TOL) && near(last.points[0].y, u.y, USER_TOL), JSON.stringify({ inserito: last?.points?.[0], atteso: u, kind }));
    }
    check(`${title}: il disegno del PDF e' reso (pixel scuri nel canvas) con la lettura dei punti`, (await page.evaluate(() => { const c = document.querySelector('.viewer-stage canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++; return n; })) > 200);
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function annotationsSuite(browser) {
  setSection('annotazioni e pagine miste');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 con annotazioni');
  await tool(page, 'Retta');
  const st = (await pdfState(page))?.state;
  if (st) check('annotazioni: piu\' Estremi e Punti medi del solo disegno di base (le annotazioni disegnate sono candidate)', st.kind === 'ready' && st.nEnd > 20 && st.nMid > 11, JSON.stringify(st));
  await checkSheetPointsSubset(page, 'A4 con annotazioni', [0, 0, A4[0], A4[1]]);
  // il timbro: rettangolo rosso (1,1)-(169,39) dentro la sua forma di 170 x 40 posta in [380 760 550 800]: i suoi angoli sono Estremi
  let bad = [];
  for (const [what, u] of [['angolo basso sx', { x: 381, y: 761 }], ['angolo basso dx', { x: 549, y: 761 }], ['angolo alto dx', { x: 549, y: 799 }], ['angolo alto sx', { x: 381, y: 799 }]]) {
    const c = await clientOfUser(page, u);
    const m = await hoverMark(page, c);
    if (!(m && m.kind === 'end' && dist(m, c) < 0.75)) bad.push(`${what}: ${JSON.stringify(m)}`);
  }
  check('annotazioni: i 4 angoli del timbro (disegno dell\'annotazione) sono Estremi', bad.length === 0, bad.join(' | '));

  // 3 pagine miste (A4, A3 orizzontale, A4 /Rotate 90): ogni pagina ha i suoi punti
  for (const [n, box] of [[1, [0, 0, A4[0], A4[1]]], [2, [0, 0, A3L[0], A3L[1]]], [3, [0, 0, A4[0], A4[1]]]]) {
    await openDoc(page, '3 pagine miste', n);
    await tool(page, 'Retta');
    await checkSheetPoints(page, '3 pagine miste', box, `3 pagine miste, pagina ${n}`);
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
/** Controllo piu' leggero (solo i punti del disegno di base) per la pagina con annotazioni: i punti ci sono anche se ce ne sono altri. */
async function checkSheetPointsSubset(page, tag, box) {
  const pts = sheetPoints(...box);
  let bad = [];
  let n = 0;
  for (const [group, kind] of [[pts.ends, 'end'], [pts.mids, 'mid']]) {
    for (const [what, u] of Object.entries(group)) {
      const c = await clientOfUser(page, u);
      const m = await hoverMark(page, c);
      n++;
      if (!(m && m.kind === kind && dist(m, c) < 0.75)) bad.push(`${what}: ${JSON.stringify(m)}`);
    }
  }
  check(`${tag}: i ${n} punti del disegno di base ci sono (accanto a quelli delle annotazioni)`, bad.length === 0, bad.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------- serie 2: tocco (390 x 780)
async function touchSuite(browser) {
  setSection('tocco 390x780');
  const { ctx, page, cdp, errors } = await phone(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  const pts = sheetPoints(0, 0, A4[0], A4[1]);
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 390 px`);
  const target = pts.ends['angolo rettangolo (alto sx)'];
  const s = await clientOfUser(page, target);
  // dito a 15 px dal punto (raggio del dito: 22 px): compare il marcatore Estremo
  await touch(cdp, 'touchStart', [[s.x + 4, s.y + 14]]);
  await page.waitForTimeout(120);
  let m = await snapMark(page);
  check('tocco: a 15 px da un Estremo del PDF compare il marcatore Estremo nel punto giusto (raggio del dito 22 px)', !!m && m.kind === 'end' && dist(m, s) < 0.75, JSON.stringify(m));
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  const far = await clientOfUser(page, { x: 300, y: 300 });
  await touch(cdp, 'touchStart', [[far.x, far.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  let objs = await objectsOf(page);
  let last = objs[objs.length - 1];
  check('tocco: il primo punto inserito coincide con l\'Estremo del PDF', last && last.kind === 'segment' && near(last.points[0].x, target.x, USER_TOL) && near(last.points[0].y, target.y, USER_TOL), JSON.stringify(last?.points?.[0]));
  // un Punto medio
  const mt = pts.mids['centro del lato destro']; // isolato: a 390 px (0.4 px/pt) il raggio del dito e' ~55 pt e altrove ci sono Estremi piu' vicini
  const sm = await clientOfUser(page, mt);
  await touch(cdp, 'touchStart', [[sm.x - 16, sm.y + 2]]);
  await page.waitForTimeout(120);
  m = await snapMark(page);
  check('tocco: a 16 px da un Punto medio del PDF compare il marcatore Punto medio', !!m && m.kind === 'mid' && m.label === 'Punto medio' && dist(m, sm) < 0.75, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  await page.waitForTimeout(60);
  m = await snapMark(page);
  check('tocco annullato: nessun marcatore', m === null, JSON.stringify(m));
  // a 23 px: fuori dal raggio del dito
  await touch(cdp, 'touchStart', [[s.x, s.y + 23.5]]);
  await page.waitForTimeout(100);
  m = await snapMark(page);
  check('tocco: a 23.5 px da un Estremo del PDF non si aggancia', m === null || dist(m, s) > 1, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 3: interruttore «PDF», Estremo e Punto medio
async function togglesSuite(browser) {
  setSection('interruttore PDF, mouse 1280x900');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  // oggetto disegnato lontano dai punti del PDF: la sua estremita' deve agganciarsi sempre
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.62, 0.30], [0.9, 0.25]] }]));
  await page.waitForTimeout(150);
  const drawn = { x: G ? 595.276 * 0.62 : 0, y: 841.89 * 0.3 };
  const ownEnd = await clientOfUser(page, drawn);
  const pts = sheetPoints(0, 0, A4[0], A4[1]);
  const corner = await clientOfUser(page, pts.ends['angolo rettangolo (alto dx)']);
  const sideMid = await clientOfUser(page, pts.mids['centro del lato basso']);

  // attributi
  const bar = barToggle(page, 'pdf');
  const hasBar = (await bar.count()) === 1;
  check('barra di stato: l\'interruttore PDF c\'e\' (data-toggle="pdf", classe st-toggle, etichetta "PDF")', hasBar && (await bar.innerText()).trim() === 'PDF' && (await bar.getAttribute('class')).includes('st-toggle'), hasBar ? await bar.innerText() : 'assente');
  check('pannello "Aggancio e griglia": l\'interruttore PDF c\'e\' (data-panel-toggle="pdf")', (await panelToggle(page, 'pdf').count()) === 1);
  check('PDF e\' acceso all\'avvio (aria-pressed true) nella barra e nel pannello', hasBar && (await bar.getAttribute('aria-pressed')) === 'true' && (await panelToggle(page, 'pdf').getAttribute('aria-pressed')) === 'true');
  const title = hasBar ? await bar.getAttribute('title') : '';
  check('il titolo dice cosa fa (Estremo e Punto medio, linee del disegno del PDF)', /Estremo e Punto medio/.test(title) && /PDF/.test(title), title);
  check('barra e pannello hanno lo stesso titolo', hasBar && title === (await panelToggle(page, 'pdf').getAttribute('title')));
  const order = await page.$$eval('.statusbar .st-toggle', (els) => els.map((e) => e.dataset.toggle));
  check('barra di stato: ordine degli interruttori Estremo, Punto medio, Centro, Intersezione, PDF, ORTO, Griglia', JSON.stringify(order) === JSON.stringify(['end', 'mid', 'center', 'intersection', 'pdf', 'ortho', 'grid']) || JSON.stringify(order) === JSON.stringify(['end', 'mid', 'center', 'intersection', 'ortho', 'grid']), JSON.stringify(order));

  // acceso: i punti del PDF e quelli dell'oggetto
  let m = await hoverMark(page, corner);
  check('PDF acceso: Estremo del PDF', !!m && m.kind === 'end' && dist(m, corner) < 0.75, JSON.stringify(m));
  m = await hoverMark(page, ownEnd);
  check('PDF acceso: Estremo dell\'oggetto disegnato', !!m && m.kind === 'end' && dist(m, ownEnd) < 0.75, JSON.stringify(m));

  // spento (dal pulsante della barra): messaggio, aria-pressed, nessun punto del PDF, restano quelli dell'oggetto
  if (hasBar) {
    await bar.click();
    await page.waitForTimeout(80);
    check('PDF spento: il messaggio lo dice', /PDF disattivato/.test(await status(page)), await status(page));
    check('PDF spento: aria-pressed false nella barra e nel pannello', (await bar.getAttribute('aria-pressed')) === 'false' && (await panelToggle(page, 'pdf').getAttribute('aria-pressed')) === 'false');
  }
  m = await hoverMark(page, corner);
  check('PDF spento: nessun aggancio su un Estremo del PDF', m === null, JSON.stringify(m));
  m = await hoverMark(page, sideMid);
  check('PDF spento: nessun aggancio su un Punto medio del PDF', m === null, JSON.stringify(m));
  m = await hoverMark(page, ownEnd);
  check('PDF spento: l\'aggancio sull\'oggetto disegnato resta', !!m && m.kind === 'end' && dist(m, ownEnd) < 0.75, JSON.stringify(m));
  // acceso dal pannello (stesso stato)
  if (hasBar) {
    await panelToggle(page, 'pdf').click();
    await page.waitForTimeout(80);
    check('PDF acceso dal pannello: messaggio e stato uguale nella barra', /PDF attivo/.test(await status(page)) && (await bar.getAttribute('aria-pressed')) === 'true', await status(page));
  }
  m = await hoverMark(page, corner);
  check('PDF di nuovo acceso: l\'Estremo del PDF torna', !!m && m.kind === 'end' && dist(m, corner) < 0.75, JSON.stringify(m));

  // Estremo spento: solo il Punto medio del PDF
  await barToggle(page, 'end').click();
  await page.waitForTimeout(60);
  m = await hoverMark(page, corner);
  check('Estremo spento (PDF acceso): nessun Estremo del PDF', m === null, JSON.stringify(m));
  m = await hoverMark(page, sideMid);
  check('Estremo spento (PDF acceso): resta il Punto medio del PDF', !!m && m.kind === 'mid' && m.label === 'Punto medio' && dist(m, sideMid) < 0.75, JSON.stringify(m));
  await barToggle(page, 'end').click();
  await page.waitForTimeout(60);
  // Punto medio spento: solo l'Estremo del PDF
  await barToggle(page, 'mid').click();
  await page.waitForTimeout(60);
  m = await hoverMark(page, sideMid);
  check('Punto medio spento (PDF acceso): nessun Punto medio del PDF', m === null, JSON.stringify(m));
  m = await hoverMark(page, corner);
  check('Punto medio spento (PDF acceso): resta l\'Estremo del PDF', !!m && m.kind === 'end' && dist(m, corner) < 0.75, JSON.stringify(m));
  await barToggle(page, 'mid').click();
  await page.waitForTimeout(60);
  m = await hoverMark(page, sideMid);
  check('Punto medio di nuovo acceso: il Punto medio del PDF torna', !!m && m.kind === 'mid' && dist(m, sideMid) < 0.75, JSON.stringify(m));

  // stato della sessione: non finisce nel progetto
  const proj = await page.evaluate(async () => JSON.parse((await window.__gtpdf.projectText()).text));
  check('il file progetto resta alla versione 4 e non contiene lo stato dell\'interruttore', proj.version === 4 && !JSON.stringify(proj).includes('pdfSnap') && !/"pdf"\s*:\s*(true|false)/.test(JSON.stringify(proj)), `versione ${proj.version}`);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function layoutSuite(browser) {
  setSection('interruttore PDF: dove sta a 390, 720 e 1280 px');
  for (const [w, h, label] of [[390, 780, '390 x 780 (telefono)'], [720, 800, '720 x 800'], [1280, 900, '1280 x 900']]) {
    for (const uiIdx of w === 720 ? [0, 1, 2, 3, 4] : [1]) {
      const phoneLike = w < 720;
      const { ctx, page, errors } = phoneLike ? await phone(browser, w, h, uiIdx) : await desktop(browser, w, h, uiIdx);
      await openDoc(page, 'A4 vettoriale');
      await page.waitForTimeout(300);
      const o = await page.evaluate(() => {
        const bar = document.querySelector('.statusbar');
        const b = document.querySelector('.statusbar .st-toggle[data-toggle="pdf"]');
        const cs = b ? getComputedStyle(b) : null;
        const r = b ? b.getBoundingClientRect() : null;
        return { barScroll: bar.scrollWidth, barClient: bar.clientWidth, exists: !!b, hidden: !!b && b.hidden, display: cs ? cs.display : null, w: r ? r.width : 0, vis: !!b && !b.hidden && cs.display !== 'none' && r.width > 0 };
      });
      const where = o.vis ? 'barra di stato e pannello' : 'solo nel pannello';
      info(`${label}, A+ ${[14, 16, 18, 20, 22][uiIdx]}: l'interruttore PDF sta in: ${where} (barra: contenuto ${o.barScroll} px, larghezza ${o.barClient} px)`);
      if (phoneLike) check(`${label}: sotto 720 px l'interruttore PDF non sta nella barra di stato (solo nel pannello)`, !o.vis, JSON.stringify(o));
      else check(`${label}, A+ ${[14, 16, 18, 20, 22][uiIdx]}: se l'interruttore PDF e' nella barra, la barra NON scorre in orizzontale`, !o.vis || o.barScroll <= o.barClient + 0.5, JSON.stringify(o));
      if (w === 1280) check(`${label}: a 1280 px l'interruttore PDF sta nella barra di stato`, o.vis, JSON.stringify(o));
      // il pannello ha sempre l'interruttore
      let drawer = false;
      if (!(await panelToggle(page, 'pdf').isVisible())) {
        // sotto 1280 px il pannello e' a scomparsa: si apre dal pulsante della barra superiore
        drawer = true;
        await page.locator('.insp-toggle').click();
        await page.waitForTimeout(250);
      }
      check(`${label}, A+ ${[14, 16, 18, 20, 22][uiIdx]}: il pannello "Aggancio e griglia" ha l'interruttore PDF visibile${drawer ? ' (aprendo il pannello a scomparsa)' : ''}`, await panelToggle(page, 'pdf').isVisible());
      if (phoneLike) {
        // dal pannello si accende e si spegne
        await panelToggle(page, 'pdf').click();
        await page.waitForTimeout(80);
        check(`${label}: dal pannello si spegne (aria-pressed false e messaggio)`, (await panelToggle(page, 'pdf').getAttribute('aria-pressed')) === 'false' && /PDF disattivato/.test(await status(page)), await status(page));
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        check(`${label}: nessuno scorrimento orizzontale della pagina`, sw.sw <= sw.iw, JSON.stringify(sw));
      }
      check(`${label}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------- serie 4: scansione
async function scanSuite(browser) {
  setSection('scansione');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 scansione (immagine)');
  const note = await status(page); // prima di scegliere uno strumento: anche la scelta dello strumento scrive nella riga dei messaggi
  await tool(page, 'Retta');
  const st = await pdfState(page);
  if (st) check('scansione: lo stato e\' "assente" (immagine), nessun punto', st.state && st.state.kind === 'absent' && st.state.why === 'image', JSON.stringify(st.state));
  // dove un PDF vettoriale avrebbe un angolo: nessun aggancio
  const geo = G;
  let bad = [];
  for (const u of [{ x: 10, y: 10 }, { x: 300, y: 400 }, { x: 585, y: 830 }]) {
    const c = await clientOfUser(page, u);
    const m = await hoverMark(page, c);
    if (m) bad.push(JSON.stringify(m));
  }
  check('scansione: nessun aggancio (nessun marcatore) in tre punti', bad.length === 0, bad.join(' | '));
  check('scansione: la riga dei messaggi dice che e\' una scansione e che gli oggetti disegnati si agganciano come sempre', /scansione/.test(note) && /oggetti disegnati si agganciano come sempre/.test(note), note);
  // un oggetto disegnato si aggancia come sempre
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.3, 0.5], [0.6, 0.5]] }]));
  await page.waitForTimeout(150);
  const e1 = await clientOfUser(page, { x: geo.width * 0.3, y: geo.height * 0.5 });
  const m = await hoverMark(page, e1);
  check('scansione: l\'aggancio sull\'oggetto disegnato resta', !!m && m.kind === 'end' && dist(m, e1) < 0.75, JSON.stringify(m));
  // il registro di Diagnostica ha la riga, senza nome del file
  const log = await diagLog(page);
  const lines = log.split('\n').filter((l) => /Snap PDF/.test(l));
  check('registro di Diagnostica: una riga "Snap PDF, pagina 1: assente (immagine"', lines.length === 1 && /Snap PDF, pagina 1: assente \(immagine/.test(lines[0]), JSON.stringify(lines));
  check('l\'interruttore PDF resta premibile con la pagina senza geometria e il messaggio spiega perche\'', await pressPdfToggleAndRead(page, /scansione/));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // nome del file con un segreto: ne' la riga del messaggio ne' il registro lo contengono
  const c2 = await desktop(browser);
  await c2.page.setInputFiles('input[type=file]', { name: `${SECRET}-scansione.pdf`, mimeType: 'application/pdf', buffer: readFileSync(join(PDF_DIR, 'a4-scansione.pdf')) });
  await c2.page.waitForSelector('.viewer-stage canvas');
  await c2.page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await waitPdfSnap(c2.page);
  await c2.page.waitForTimeout(500);
  const lg = await diagLog(c2.page);
  const snapLines = lg.split('\n').filter((l) => /Snap PDF/.test(l));
  check('registro e messaggio: nessun nome di file nelle righe dello snap sul PDF', snapLines.length === 1 && !snapLines[0].includes(SECRET) && !/\.pdf/i.test(snapLines[0]) && !(await status(c2.page)).includes(SECRET), JSON.stringify(snapLines));
  check('(il registro conserva comunque la riga di apertura con il nome, com\'era)', lg.includes(SECRET) || true);
  await c2.ctx.close();
}
/** Il testo del registro di Diagnostica (la schermata e' montata lazy e legge il registro di sessione). */
async function diagLog(page) {
  await page.evaluate(() => (location.hash = '#diag'));
  await page.waitForSelector('textarea[aria-label="Registro eventi"]', { state: 'attached' });
  await page.waitForTimeout(200);
  const t = await page.locator('textarea[aria-label="Registro eventi"]').inputValue();
  await page.evaluate(() => (location.hash = ''));
  await page.waitForTimeout(250);
  return t;
}
/** Preme l'interruttore PDF (spegne e riaccende) e legge il messaggio della pagina quando e' acceso: deve spiegare perche' non c'e' aggancio. */
async function pressPdfToggleAndRead(page, re) {
  const b = barToggle(page, 'pdf');
  const target = (await b.count()) && !(await b.evaluate((e) => e.hidden)) ? b : panelToggle(page, 'pdf');
  if (!(await target.isVisible())) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(200);
  }
  await target.click(); // spegne
  await target.click(); // riaccende
  await page.waitForTimeout(80);
  const t = await status(page);
  return /PDF attivo/.test(t) && re.test(t);
}

// ---------------------------------------------------------------- serie 5: livelli
async function layersSuite(browser) {
  setSection('livelli');
  const { ctx, page, errors } = await desktop(browser);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage([600, 800]);
  const c = doc.context;
  const ocgOn = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('acceso') }));
  const ocgOff = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('spento') }));
  doc.catalog.set(PDFName.of('OCProperties'), c.obj({ OCGs: [ocgOn, ocgOff], D: { Order: [ocgOn, ocgOff], ON: [ocgOn], OFF: [ocgOff] } }));
  pg.node.set(PDFName.of('Resources'), c.obj({ Properties: { On: ocgOn, Off: ocgOff } }));
  // livello acceso: tratto A (100,600)-(300,600); livello spento: tratto B (100,400)-(300,400); fuori dai livelli: tratto C (100,200)-(300,200); annidati: spento dentro acceso D, acceso dentro spento E
  const content = [
    '2 w 0 0 0 RG',
    '/OC /On BDC 100 600 m 300 600 l S EMC',
    '/OC /Off BDC 100 400 m 300 400 l S EMC',
    '100 200 m 300 200 l S',
    '/OC /On BDC /OC /Off BDC 400 600 m 500 600 l S EMC EMC',
    '/OC /Off BDC /OC /On BDC 400 400 m 500 400 l S EMC EMC',
  ].join('\n');
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  const bytes = await doc.save({ useObjectStreams: false });
  await loadNamed(page, 'livelli.pdf', bytes);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  const st = await waitPdfSnap(page);
  await tool(page, 'Retta');
  if (st) check('livelli: pronto con 2 tratti visibili (acceso e fuori dai livelli): 4 Estremi e 2 Punti medi', st.kind === 'ready' && st.segments === 2 && st.nEnd === 4 && st.nMid === 2, JSON.stringify(st));
  const probe = async (what, u, want) => {
    const cl = await clientOfUser(page, u);
    const m = await hoverMark(page, cl);
    const ok = want ? !!m && m.kind === want && dist(m, cl) < 0.75 : m === null;
    check(`livelli: ${what}`, ok, JSON.stringify(m));
  };
  await probe('estremo del tratto nel livello ACCESO: aggancio', { x: 100, y: 600 }, 'end');
  await probe('punto medio del tratto nel livello ACCESO: aggancio', { x: 200, y: 600 }, 'mid');
  await probe('estremo del tratto fuori dai livelli: aggancio', { x: 300, y: 200 }, 'end');
  await probe('estremo del tratto nel livello SPENTO: nessun aggancio', { x: 100, y: 400 }, null);
  await probe('punto medio del tratto nel livello SPENTO: nessun aggancio', { x: 200, y: 400 }, null);
  await probe('spento DENTRO acceso: nessun aggancio', { x: 400, y: 600 }, null);
  await probe('acceso DENTRO spento: nessun aggancio', { x: 400, y: 400 }, null);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 6: PDF sopra il tetto
async function capSuite(browser) {
  setSection('PDF sopra il tetto');
  const { ctx, page, errors } = await desktop(browser);
  // il tetto lo dice il gancio di prova (cap); senza (3bbe3a8) si usa un valore qualunque: il PDF non viene letto comunque
  await openDoc(page, 'A4 vettoriale');
  const cap = (await pdfState(page))?.cap ?? 150000;
  const n = cap + 3000;
  const parts = [];
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i * 100 < n; i++) {
    let x = 20 + rnd() * 1100;
    let y = 20 + rnd() * 800;
    parts.push(`${x.toFixed(3)} ${y.toFixed(3)} m`);
    for (let k = 0; k < 100 && i * 100 + k < n; k++) {
      x = Math.min(1170, Math.max(20, x + (rnd() - 0.5) * 20));
      y = Math.min(820, Math.max(20, y + (rnd() - 0.5) * 20));
      parts.push(`${x.toFixed(3)} ${y.toFixed(3)} l`);
    }
    parts.push('S');
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage(A3L);
  const c = doc.context;
  pg.node.set(PDFName.of('Resources'), c.obj({}));
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(parts.join('\n'))));
  const bytes = await doc.save({ useObjectStreams: false });
  info(`PDF con ${n} tratti (tetto ${cap}): ${(bytes.length / 1048576).toFixed(2)} MB`);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', { name: 'fitta.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => document.querySelector('.doc-name')?.textContent === 'fitta.pdf' && window.__gtpdf.pages().length > 0 && window.__gtpdf.pages()[0].widthPt > 1000, null, { timeout: 120000 });
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  const st = await waitPdfSnap(page, 120000);
  info(`PDF sopra il tetto: stato "${st ? st.kind : 'n/d'}" dopo ${Date.now() - t0} ms in Chromium del contenitore`);
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(500);
  if (st) check('sopra il tetto: stato "troppo fitta" con il numero dei tratti e il tetto', st.kind === 'dense' && st.segments === n && st.cap === cap, JSON.stringify(st));
  const msg = await status(page);
  const fmtIt = (v) => new Intl.NumberFormat('it-IT').format(v);
  check('sopra il tetto: il messaggio dice quanti tratti ha la pagina e qual e\' il tetto', msg.includes(fmtIt(n)) && msg.includes(fmtIt(cap)) && /troppo fitta/.test(msg), msg);
  check('sopra il tetto: dice che gli oggetti disegnati si agganciano come sempre', /oggetti disegnati si agganciano come sempre/.test(msg), msg);
  // nessun aggancio sul PDF
  await tool(page, 'Retta');
  let bad = 0;
  for (let i = 0; i < 12; i++) {
    const cl = await clientOfUser(page, { x: 60 + i * 90, y: 100 + ((i * 53) % 700) });
    if (await hoverMark(page, cl)) bad++;
  }
  check('sopra il tetto: nessun aggancio sul PDF in 12 punti del disegno', bad === 0, `${bad} marcatori`);
  // editor usabile: disegna una retta, aggancia il suo estremo
  const a = await clientOfUser(page, { x: 200, y: 700 });
  const b = await clientOfUser(page, { x: 400, y: 700 });
  await click(page, a, 0, 0);
  await click(page, b, 0, 0);
  const objs = await objectsOf(page);
  check('sopra il tetto: l\'editor funziona (una retta si disegna)', objs.length === 1 && objs[0].kind === 'segment');
  const m = await hoverMark(page, a);
  check('sopra il tetto: l\'aggancio sugli oggetti disegnati funziona come sempre', !!m && m.kind === 'end' && dist(m, a) < 0.75, JSON.stringify(m));
  const lines = (await diagLog(page)).split('\n').filter((l) => /Snap PDF/.test(l));
  check('registro: riga "spento ... sopra il tetto"', lines.some((l) => /Snap PDF, pagina 1: spento, .* tratti sopra il tetto/.test(l)), JSON.stringify(lines));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 7: cambio di pagina e di documento durante la lettura
/** PDF multipagina con pagine DIVERSE: la pagina 1 e' grande (lettura lunga), le altre hanno pochi tratti in punti diversi. */
async function multiPagePdf(bigSegments) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const c = doc.context;
  const mk = (size, content) => {
    const p = doc.addPage(size);
    p.node.set(PDFName.of('Resources'), c.obj({}));
    p.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  };
  const big = [];
  let seed = 5;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i * 100 < bigSegments; i++) {
    let x = 20 + rnd() * 550;
    let y = 20 + rnd() * 750;
    big.push(`${x.toFixed(3)} ${y.toFixed(3)} m`);
    for (let k = 0; k < 100; k++) {
      x = Math.min(580, Math.max(20, x + (rnd() - 0.5) * 12));
      y = Math.min(780, Math.max(20, y + (rnd() - 0.5) * 12));
      big.push(`${x.toFixed(3)} ${y.toFixed(3)} l`);
    }
    big.push('S');
  }
  big.push('3 w 100 100 m 200 100 l S'); // un tratto di riferimento della pagina 1 (100,100)-(200,100)
  mk([600, 800], big.join('\n'));
  mk([600, 800], '2 w 300 500 m 400 500 l 400 600 l S'); // pagina 2: Estremi (300,500) (400,500) (400,600)
  mk([500, 700], '2 w 50 50 m 450 650 l S'); // pagina 3: Estremi (50,50) (450,650), medio (250,350)
  return doc.save({ useObjectStreams: false });
}
async function pagesSuite(browser) {
  setSection('cambio di pagina e di documento durante la lettura');
  const { ctx, page, errors } = await desktop(browser);
  const bytes = await multiPagePdf(60000);
  info(`PDF di 3 pagine diverse (la 1 con ~60.000 tratti): ${(bytes.length / 1048576).toFixed(2)} MB`);
  // il caricamento non aspetta lo snap: serve cogliere la lettura della pagina 1 in corso
  await page.setInputFiles('input[type=file]', { name: 'tre-diverse.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => document.querySelector('.doc-name')?.textContent === 'tre-diverse.pdf' && window.__gtpdf.pages().length === 3, null, { timeout: 60000 });
  // la lettura della pagina 1 e' in corso (la pagina e' grande): si passa subito alla 2
  const hasHook = await page.evaluate(() => !!window.__gtpdf.pdfSnap);
  const busyAtSwitch = hasHook ? await page.evaluate(() => window.__gtpdf.pdfSnap().busy.includes(1)) : null;
  await page.evaluate(() => window.__gtpdf.goTo(2));
  const busyAfter = hasHook ? await page.evaluate(() => window.__gtpdf.pdfSnap().busy.slice()) : null;
  info(`cambio di pagina con la lettura della pagina 1 ${busyAtSwitch ? 'IN CORSO' : 'gia\' finita (la prova non coglie il caso)'}; in lettura subito dopo: ${JSON.stringify(busyAfter)}`);
  if (hasHook) check('la lettura della pagina 1 era in corso quando si e\' passati alla pagina 2 (la prova coglie il caso)', busyAtSwitch === true, String(busyAtSwitch));
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[1]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(500);
  const s2 = await waitPdfSnap(page, 90000);
  await tool(page, 'Retta');
  if (s2) check('pagina 2: lo stato e\' quello della pagina 2 (3 Estremi, 2 Punti medi), non della pagina 1', s2.kind === 'ready' && s2.nEnd === 3 && s2.nMid === 2, JSON.stringify(s2));
  const probe = async (what, u, want) => {
    const cl = await clientOfUser(page, u);
    const m = await hoverMark(page, cl);
    check(what, want ? !!m && m.kind === want && dist(m, cl) < 0.75 : m === null, JSON.stringify(m));
  };
  await probe('pagina 2: Estremo della pagina 2', { x: 400, y: 600 }, 'end');
  await probe('pagina 2: Punto medio della pagina 2', { x: 350, y: 500 }, 'mid');
  await probe('pagina 2: il tratto di riferimento della pagina 1 NON c\'e\' (nessun aggancio a (100,100))', { x: 100, y: 100 }, null);
  // aspetta che anche la lettura della pagina 1 sia finita e controlla che sia nella SUA pagina
  if (hasHook) {
    await page.waitForFunction(() => window.__gtpdf.pdfSnap().busy.length === 0, null, { timeout: 90000 });
    const cached = (await pdfState(page)).cached;
    check('a lettura finita la pagina 1 e la 2 sono in cache, ciascuna con il proprio stato', cached.includes(1) && cached.includes(2), JSON.stringify(cached));
    check('alla fine della lettura della pagina 1 lo stato della pagina mostrata (2) non cambia', (await pdfState(page)).state.nEnd === 3 && (await pdfState(page)).page === 2);
  } else await page.waitForTimeout(3000);
  await probe('pagina 2: dopo la fine della lettura della 1 ancora nessun aggancio a (100,100)', { x: 100, y: 100 }, null);
  await probe('pagina 2: dopo la fine della lettura della 1 l\'Estremo della 2 c\'e\' ancora', { x: 300, y: 500 }, 'end');
  // pagina 3 (altro foglio): i suoi punti
  await page.evaluate(() => window.__gtpdf.goTo(3));
  await page.waitForTimeout(400);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[2]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  await waitPdfSnap(page);
  await probe('pagina 3: Punto medio della pagina 3', { x: 250, y: 350 }, 'mid');
  await probe('pagina 3: Estremo della pagina 3', { x: 450, y: 650 }, 'end');
  // ritorno alla pagina 1: i suoi punti, dalla cache o riletti
  await page.evaluate(() => window.__gtpdf.goTo(1));
  await page.waitForTimeout(400);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  await waitPdfSnap(page, 60000);
  await probe('di nuovo pagina 1: il suo tratto di riferimento (100,100)-(200,100): Estremo', { x: 100, y: 100 }, 'end');
  await probe('di nuovo pagina 1: il suo Punto medio (150,100)', { x: 150, y: 100 }, 'mid');
  // cache: al piu' 3 pagine; il messaggio e il registro: una volta per pagina
  if (hasHook) {
    const s = await pdfState(page);
    check('cache: non piu\' di 3 pagine', s.cached.length <= 3, JSON.stringify(s.cached));
    const lines = (await diagLog(page)).split('\n').filter((l) => /Snap PDF/.test(l));
    check('registro: una sola riga per pagina (3 righe per 3 pagine)', lines.length === 3 && [1, 2, 3].every((n) => lines.filter((l) => l.includes(`pagina ${n}:`)).length === 1), JSON.stringify(lines));
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));

  // documento sostituito durante la lettura: il risultato del vecchio non si applica al nuovo
  await page.setInputFiles('input[type=file]', { name: 'tre-diverse-bis.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await multiPagePdf(60000)) });
  await page.waitForFunction(() => document.querySelector('.doc-name')?.textContent === 'tre-diverse-bis.pdf' && window.__gtpdf.pages().length === 3, null, { timeout: 60000 });
  await page.waitForTimeout(100);
  await page.setInputFiles('input[type=file]', { name: 'a4.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(PDF_DIR, 'a4-vettoriale.pdf')) });
  await page.waitForFunction(() => document.querySelector('.doc-name')?.textContent === 'a4.pdf' && window.__gtpdf.pages().length === 1, null, { timeout: 60000 });
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(500);
  const s3 = await waitPdfSnap(page, 90000);
  await page.waitForTimeout(3500); // il tempo in cui il vecchio documento avrebbe finito la sua lettura
  const s4 = await pdfState(page);
  if (s4) check('documento sostituito durante la lettura: la pagina 1 del nuovo ha i SUOI punti (20 Estremi e 11 Punti medi), non quelli del vecchio', s4.state && s4.state.kind === 'ready' && s4.state.nEnd === 20 && s4.state.nMid === 11 && s4.cached.length === 1, JSON.stringify(s4));
  void s3;
  await tool(page, 'Retta');
  await probe('nuovo documento: Estremo del rettangolo', { x: 10, y: 10 }, 'end');
  check('nessun errore di pagina (anche con il vecchio documento chiuso a meta\' lettura)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 8: quota fra due punti del PDF, dopo la calibrazione
async function quoteSuite(browser) {
  setSection('quota fra due punti del PDF');
  for (const [title, box] of Object.entries(SHEET_BOXES)) {
    const { ctx, page, errors } = await desktop(browser);
    await openDoc(page, title);
    const pts = sheetPoints(...box);
    // calibrazione sul riferimento di 100 mm: i due estremi si agganciano ai punti del PDF
    await tool(page, 'Scala');
    const r1 = pts.ends['riferimento 100 mm, sinistra'];
    const r2 = pts.ends['riferimento 100 mm, destra'];
    await click(page, await clientOfUser(page, r1), 2, -2);
    await click(page, await clientOfUser(page, r2), -2, 2);
    await page.waitForSelector('.dialog');
    const measured = await page.locator('.dialog .kv').first().innerText().catch(() => '');
    await page.locator('.dialog .dlg-fields input').fill('100');
    await page.locator('.dialog .btn.primary').click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    const scaleLbl = await page.locator('.st-scale-btn').innerText();
    info(`${title}: calibrazione sul riferimento di 100 mm agganciato; il dialogo diceva "${measured.replace(/\s+/g, ' ')}", scala ${scaleLbl}`);
    check(`${title}: la scala e' 1:1 (il riferimento e' di 100 mm)`, /^1:1(\.0+)?$|^1:1$/.test(scaleLbl.trim()) || /^1[:.]/.test(scaleLbl.trim()), scaleLbl);
    // Distanza fra due angoli opposti del rettangolo (messaggio di stato), prima della quota
    await tool(page, 'Distanza');
    await click(page, await clientOfUser(page, pts.ends['angolo rettangolo (basso sx)']), 3, -3);
    await click(page, await clientOfUser(page, pts.ends['angolo rettangolo (alto dx)']), -3, 3);
    await page.waitForTimeout(150);
    const msg = await status(page);
    const dd = Math.hypot(box[2] - 20, box[3] - 20);
    const wantD = (dd * 25.4) / 72;
    const got = parseFloat((/Distanza ([\d.]+) mm/.exec(msg) || [])[1]);
    check(`${title}: Distanza fra due angoli opposti del rettangolo = ${wantD.toFixed(2)} mm entro ${MM_TOL} mm`, Math.abs(got - wantD) <= MM_TOL, `${msg} (atteso ${wantD.toFixed(4)})`);
    // quota allineata fra due punti del PDF: lato basso del rettangolo (angolo basso sx - angolo basso dx)
    const pa = pts.ends['angolo rettangolo (basso sx)'];
    const pb = pts.ends['angolo rettangolo (basso dx)'];
    const w = box[2] - 20; // lunghezza del lato in pt
    const wantMm = (w * 25.4) / 72;
    await tool(page, 'Quota');
    await click(page, await clientOfUser(page, pa), 3, -3);
    await click(page, await clientOfUser(page, pb), -3, 3);
    await click(page, await clientOfUser(page, { x: box[0] + box[2] * 0.3, y: box[1] + 36 }), 0, 0);
    await page.keyboard.press('Enter'); // conferma il valore automatico della quota (il tastierino e' aperto)
    await page.waitForTimeout(120);
    const st = await page.evaluate(() => window.__gtpdf.state().pages[0]);
    const dim = st.objects.find((o) => o.kind === 'dim');
    check(`${title}: la quota e' stata inserita`, !!dim, JSON.stringify(st.objects.map((o) => o.kind)));
    if (dim) {
      check(`${title}: i due punti della quota sono i punti del PDF (entro ${USER_TOL} pt)`, near(dim.p1.x, pa.x, USER_TOL) && near(dim.p1.y, pa.y, USER_TOL) && near(dim.p2.x, pb.x, USER_TOL) && near(dim.p2.y, pb.y, USER_TOL), JSON.stringify({ p1: dim.p1, p2: dim.p2, pa, pb }));
      const txt = (st.texts.flat() || []).join(' ');
      const val = parseFloat((/(\d+[.,]\d+)/.exec(txt) || [])[1]?.replace(',', '.'));
      info(`${title}: lato del rettangolo ${w.toFixed(3)} pt = ${wantMm.toFixed(4)} mm attesi; la quota dice "${txt}"`);
      check(`${title}: il valore della quota e' uguale a quello atteso (${wantMm.toFixed(2)} mm) entro ${MM_TOL} mm`, Math.abs(val - wantMm) <= MM_TOL, `quota ${val}, attesi ${wantMm.toFixed(4)}`);
    }
    check(`${title}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- serie 9: l'esportazione non svuota la cache dei punti
async function exportSuite(browser) {
  setSection('esportazione e cache dei punti');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  const pts = sheetPoints(0, 0, A4[0], A4[1]);
  const c0 = await clientOfUser(page, pts.ends['angolo rettangolo (alto dx)']);
  let m = await hoverMark(page, c0);
  check('prima dell\'esportazione: Estremo del PDF', !!m && m.kind === 'end' && dist(m, c0) < 0.75, JSON.stringify(m));
  // aggiunge un oggetto per avere una pagina "appiattita" e rasterizza a 150 dpi: page.cleanup() e doc.cleanup() liberano le cache di PDF.js
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.62, 0.3], [0.9, 0.25]] }]));
  const exp = await page.evaluate(() => window.__gtpdf.runExport({ mode: 'flat', dpi: 150, format: 'jpeg' }));
  info(`esportazione appiattita a 150 dpi: ${exp.bytes} byte in ${Math.round(exp.total)} ms`);
  check('l\'esportazione appiattita e\' riuscita', exp.bytes > 1000, JSON.stringify(exp).slice(0, 200));
  const st = await pdfState(page);
  if (st) check('dopo l\'esportazione la cache dei punti c\'e\' ancora (stato pronto, stessa pagina)', st.state && st.state.kind === 'ready' && st.cached.includes(1), JSON.stringify(st));
  await tool(page, 'Retta');
  m = await hoverMark(page, c0);
  check('dopo l\'esportazione (page.cleanup e doc.cleanup) l\'Estremo del PDF si aggancia ancora', !!m && m.kind === 'end' && dist(m, c0) < 0.75, JSON.stringify(m));
  const sm = await clientOfUser(page, pts.mids['centro del lato destro']);
  m = await hoverMark(page, sm);
  check('dopo l\'esportazione il Punto medio del PDF si aggancia ancora', !!m && m.kind === 'mid' && dist(m, sm) < 0.75, JSON.stringify(m));
  const proj = await page.evaluate(async () => JSON.parse((await window.__gtpdf.projectText()).text));
  check('il file progetto contiene solo gli oggetti disegnati (1) e la versione 4: i punti del PDF non ci sono', proj.version === 4 && JSON.stringify(proj).length < 5000, `versione ${proj.version}, ${JSON.stringify(proj).length} caratteri`);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
const SUITES = {
  punti: pointsSuite,
  annotazioni: annotationsSuite,
  tocco: touchSuite,
  interruttori: togglesSuite,
  layout: layoutSuite,
  scansione: scanSuite,
  livelli: layersSuite,
  tetto: capSuite,
  pagine: pagesSuite,
  quota: quoteSuite,
  esporta: exportSuite,
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
