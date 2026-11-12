// Prove di CP7d (V3.2b, Snap sul PDF: Intersezione e Perpendicolare sui tratti rettilinei) su Chromium, NELL'EDITOR e in Diagnostica: mouse (desktop 1280 x 900) e tocco emulato (390 x 780).
// Si prova, con i PDF di prova di public/test-pdfs aperti nell'editor e con PDF sintetici costruiti QUI (in memoria: nessun file in public/): le 5 o 6 Intersezioni di drawSheet
// (scripts/make-test-pdfs.mjs: assi, quota e riferimento con le loro tacche) hanno il marcatore Intersezione (X, etichetta «Intersezione») nel punto calcolato QUI con le coordinate del generatore e le
// formule del foglio (non con il codice dell'app), anche con /Rotate 90, CropBox e A3; una QUOTA e una DISTANZA fra due Intersezioni, dopo la calibrazione sul riferimento di 100 mm (anch'essa fatta
// su due Intersezioni), uguali alla distanza attesa; su un PDF sintetico di tratti noti: incroci obliqui (con l'oracolo di Cramer scritto qui), T, vertice di una spezzata, paralleli, riempimento
// (nessun incontro) e tracciato-e-riempito (incontri), livello spento; la Perpendicolare dall'ancora a una linea del PDF (piede dentro e fuori dal tratto, sull'estremo, ancora sulla linea, senza ancora);
// l'Intersezione fra oggetti disegnati (Retta e Cerchio) e le linee del PDF; interruttori «PDF», Intersezione e Perpendicolare; scena fitta (tetto delle voci) con il suo messaggio; registro; tocco;
// la scheda «Geometria PDF» e «Copia misura» invariate (stesse righe di f5e4947).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp7d.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su f5e4947 (senza i tratti del PDF) i controlli sull'Intersezione e sulla Perpendicolare FALLISCONO)
//   E2E_ONLY=incroci,sintetico,perp,oggetti,quota,interruttori,fitta,registro,tocco,diag,diagphone: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente (browser del PC o Safari/iPhone): nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { PDFDocument, PDFName, PDFString, degrees } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7d', out: process.argv[2], port: 4246, hport: 4247, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const MM = 72 / 25.4; // pt per mm
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const A4 = [595.276, 841.89];
const A3L = [1190.551, 841.89];
const SECRET = 'cliente-riservato-7d3e';
/** Tolleranza (pt utente) fra il punto inserito e quello atteso: il Float32 di PDF.js sposta le coordinate di ~3e-5 pt su A3; con un incontro obliquo l'errore puo' salire a ~1e-4. */
const USER_TOL = 1e-3;
/** Tolleranza (mm) delle distanze: il valore ha due decimali. */
const MM_TOL = 0.01;
const P = (x, y) => ({ x, y });
const LABEL = { end: 'Estremo', mid: 'Punto medio', intersection: 'Intersezione', perpendicular: 'Perpendicolare' };
/** Il tracciato del marcatore (8 x 8 px) di Intersezione e Perpendicolare, come in scripts/e2e-cp6f.cjs. */
const D = { intersection: 'M-4 -4L4 4M-4 4L4 -4', perpendicular: 'M-4 -4V4H4' };
const KINDS = ['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent'];

// ---------------------------------------------------------------- strumenti
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
const status = (page) => page.locator('.st-msg').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const barToggle = (page, id) => page.locator(`.statusbar .st-toggle[data-toggle="${id}"]`);
/** Lo stato dello snap sul PDF letto dal gancio di prova. */
const pdfState = (page) => page.evaluate(() => (window.__gtpdf.pdfSnap ? window.__gtpdf.pdfSnap() : null));
/** Aspetta che la lettura dei punti della pagina corrente sia finita (pronto o altro stato). */
async function waitPdfSnap(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const s = window.__gtpdf.pdfSnap();
    return s.state !== null && s.state !== 'busy';
  }, null, { timeout });
  await page.waitForTimeout(120);
  return (await pdfState(page)).state;
}

/** Geometria di una pagina, ricalcolata qui da `pages()` con le formule di PageViewport (come e2e-cp6a e e2e-cp7b): cosi' non dipende dal codice dell'app. */
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
  return {
    width,
    height,
    userToSheet: (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
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
  '3 pagine miste': 'misto-3-pagine.pdf',
  'A4 con annotazioni': 'a4-annotazioni.pdf',
};
/** Carica un PDF dal selettore di file (anche con un documento gia' aperto) e aspetta che sia quello mostrato. */
async function loadNamed(page, name, buffer) {
  await page.setInputFiles('input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(buffer) });
  await page.waitForFunction((n) => document.querySelector('.doc-name')?.textContent === n, name, { timeout: 120000 });
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(500);
}
/** Mostra la pagina `pageNo` del documento aperto e adatta; imposta G. */
async function showFit(page, pageNo = 1) {
  if (pageNo !== 1) {
    await page.evaluate((n) => window.__gtpdf.goTo(n), pageNo);
    await page.waitForTimeout(400);
  }
  G = makeGeom(await page.evaluate((n) => window.__gtpdf.pages()[n - 1], pageNo));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  return waitPdfSnap(page);
}
/** Apre un PDF di prova nell'editor e adatta la pagina; imposta G. */
async function openDoc(page, title, pageNo = 1) {
  const file = FILE_OF[title];
  await loadNamed(page, file, readFileSync(join(PDF_DIR, file)));
  return showFit(page, pageNo);
}


// ---------------------------------------------------------------- interruttori e marcatori
const panelToggle = (page, id) => page.locator(`.panel-toggle[data-panel-toggle="${id}"]`);
/** Porta un interruttore (Estremo, Punto medio, Centro, Intersezione, Quadrante, Perpendicolare, Tangente, PDF) nello stato voluto, dal pannello laterale. */
async function setSwitch(page, id, on) {
  const b = panelToggle(page, id);
  if (((await b.getAttribute('aria-pressed')) === 'true') !== on) {
    await b.click();
    await page.waitForTimeout(60);
  }
}
/** Accende SOLO gli interruttori elencati (fra i sette tipi di snap; «PDF» non si tocca). */
async function only(page, ids) {
  for (const id of KINDS) await setSwitch(page, id, ids.includes(id));
}
const allOn = (page) => only(page, KINDS);
const markD = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    const p = g && g.querySelector('path');
    return p ? p.getAttribute('d') : null;
  });
/** Passa il cursore su `u` (spazio utente) e confronta il marcatore con l'atteso: `want` = {kind, at: punto utente} oppure null (nessun marcatore). Restituisce una descrizione dell'errore o null. */
async function hoverCheck(page, what, u, want) {
  const m = await hoverMark(page, await clientOfUser(page, u));
  if (!want) return m === null ? null : `${what}: atteso nessun marcatore, c'e' ${JSON.stringify(m)}`;
  const c = await clientOfUser(page, want.at);
  const d = m ? await markD(page) : null;
  const ok = !!m && m.kind === want.kind && m.label === LABEL[want.kind] && dist(m, c) < 0.75 && (D[want.kind] === undefined || d === D[want.kind]);
  return ok ? null : `${what}: ${JSON.stringify(m)} d=${d} atteso ${want.kind} in (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`;
}
/** Come `hoverCheck`, ma il marcatore puo' essere di uno qualsiasi dei tipi `kinds` (nel punto giusto entro 0.75 px). */
async function hoverAnyOf(page, what, u, kinds) {
  const c = await clientOfUser(page, u);
  const m = await hoverMark(page, c);
  return !!m && kinds.includes(m.kind) && dist(m, c) < 0.75 ? null : `${what}: ${JSON.stringify(m)} atteso uno di ${kinds.join(', ')}`;
}
/** Il punto inserito dal primo clic di una Retta: clic su `u` (con scarto) e poi su un punto libero lontano; restituisce il primo punto dell'ultimo oggetto. */
async function clickFirstPoint(page, u, freeUser, dx = 3, dy = -2) {
  await click(page, await clientOfUser(page, u), dx, dy);
  await click(page, await clientOfUser(page, freeUser), 0, 0);
  const objs = await objectsOf(page);
  const last = objs[objs.length - 1];
  return last && last.kind === 'segment' ? last.points[0] : null;
}

// ---------------------------------------------------------------- punti attesi dei PDF di prova (make-test-pdfs.mjs, drawSheet)
const SHEET_BOXES = {
  'A4 vettoriale': [0, 0, A4[0], A4[1]],
  'A3 vettoriale': [0, 0, A3L[0], A3L[1]],
  'A4 con /Rotate 90': [0, 0, A4[0], A4[1]],
  'A4 con CropBox': [50, 50, 400, 550],
};
/**
 * Gli incontri di drawSheet nello spazio utente, con le stesse formule del generatore (righe 31-45): gli assi tratteggiati (due tratti che si incrociano nei loro punti medi), la quota con le sue
 * due tacche (le tacche si incrociano con la quota nei suoi estremi), il riferimento di 100 mm con le sue due tacche, e, quando l'asse verticale (da cy - 1.15 r a cy + 1.15 r) arriva alla quota
 * (r >= 120: A4, A3 e A4 ruotata; non il foglio ritagliato, dove r = 108), la quota con l'asse verticale.
 */
function sheetCrossings(box) {
  const [x, y, w, h] = box;
  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const qy = cy - r - 18;
  const ry = y + 62;
  const rx = x + 28;
  const out = {
    'assi (centro)': P(cx, cy),
    'quota, estremo sinistro': P(cx - r, qy),
    'quota, estremo destro': P(cx + r, qy),
    'riferimento, estremo sinistro': P(rx, ry),
    'riferimento, estremo destro': P(rx + 100 * MM, ry),
  };
  if (r >= 120) out['quota e asse verticale'] = P(cx, qy);
  return { out, cx, cy, r, qy, rx, ry };
}

// ---------------------------------------------------------------- serie 1: le Intersezioni di drawSheet (mouse)
async function crossingsSuite(browser) {
  setSection('Intersezioni dei PDF di prova, mouse 1280x900');
  const { ctx, page, errors } = await desktop(browser);
  for (const [title, box] of Object.entries(SHEET_BOXES)) {
    const st = await openDoc(page, title);
    await tool(page, 'Retta');
    const sc = sheetCrossings(box);
    check(`${title}: lo stato della pagina ha la scena dei tratti: 12 tratti, nessuno ritagliato o fuori, non fitta`, !!st && st.kind === 'ready' && !!st.sceneStats && st.sceneStats.kept === 12 && st.sceneStats.clipped === 0 && st.sceneStats.outside === 0 && st.sceneStats.dense === false && st.hasScene === true, JSON.stringify(st && st.sceneStats));
    await only(page, ['intersection']);
    const bad = [];
    for (const [what, u] of Object.entries(sc.out)) {
      const e = await hoverCheck(page, what, u, { kind: 'intersection', at: u });
      if (e) bad.push(e);
    }
    check(`${title}: le ${Object.keys(sc.out).length} Intersezioni (solo Intersezione accesa) hanno il marcatore X con l'etichetta «Intersezione» nel punto giusto (entro 0.75 px)`, bad.length === 0, bad.slice(0, 3).join(' | '));
    // dove non c'e' un incontro: lungo la quota e lungo l'asse orizzontale, lontano dagli incontri
    const none = [];
    for (const [what, u] of [['lungo la quota (a r/2 dal centro)', P(sc.cx + sc.r / 2, sc.qy)], ["lungo l'asse orizzontale (a r/2 dal centro)", P(sc.cx + sc.r / 2, sc.cy)], ['lungo il riferimento (a 50 mm)', P(sc.rx + 50 * MM, sc.ry)]]) {
      const e = await hoverCheck(page, what, u, null);
      if (e) none.push(e);
    }
    check(`${title}: lungo le linee, lontano dagli incontri, nessun marcatore`, none.length === 0, none.join(' | '));
    // il punto INSERITO e' l'incontro (spazio utente, Float32 di PDF.js)
    const free = { x: box[0] + box[2] * 0.12, y: box[1] + box[3] * 0.93 };
    for (const key of ['quota, estremo destro', 'riferimento, estremo sinistro']) {
      const want = sc.out[key];
      const got = await clickFirstPoint(page, want, free);
      check(`${title}: ${key}: il primo punto inserito e' l'Intersezione (entro ${USER_TOL} pt)`, !!got && near(got.x, want.x, USER_TOL) && near(got.y, want.y, USER_TOL), JSON.stringify({ got, want }));
    }
    // con tutti i tipi accesi: nei punti in cui l'incontro coincide con un Estremo o un Punto medio del PDF c'e' un marcatore nel punto giusto; QUALE dei due (Estremo o Punto medio contro Intersezione)
    // dipende dal Float32 di PDF.js: i punti distano meno di 1e-4 pt, non esattamente zero, e a distanze diverse vince il piu' vicino. La priorita' a parita' ESATTA e' provata dagli unitari e da «croci».
    await allOn(page);
    let e = await hoverAnyOf(page, 'centro degli assi, tutti i tipi', sc.out['assi (centro)'], ['mid', 'intersection']);
    check(`${title}: con tutti i tipi accesi, dove gli assi si incrociano c'e' un marcatore nel punto giusto: Punto medio o Intersezione (stessa posizione entro 1e-4 pt)`, e === null, e || '');
    e = await hoverAnyOf(page, 'estremo della quota, tutti i tipi', sc.out['quota, estremo destro'], ['end', 'mid', 'intersection']);
    check(`${title}: con tutti i tipi accesi, dove la tacca incontra la quota c'e' un marcatore nel punto giusto: Estremo, Punto medio o Intersezione`, e === null, e || '');
    // Estremo e Punto medio spenti, Intersezione accesa: la stessa cosa
    await only(page, ['intersection']);
    e = await hoverCheck(page, 'centro degli assi, solo Intersezione', sc.out['assi (centro)'], { kind: 'intersection', at: sc.out['assi (centro)'] });
    check(`${title}: con la sola Intersezione accesa, nel centro degli assi c'e' l'Intersezione`, e === null, e || '');
    await allOn(page);
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- PDF sintetici (costruiti qui, mai in public/)
/** Tratti del PDF sintetico «croci» nello spazio utente: percorso, visibilita', e i quattro numeri; i riempimenti non ci sono (non sono tratti). */
const CROCI_SEGS = [
  { path: 0, s: [80, 100, 420, 300] }, // A
  { path: 1, s: [120, 400, 380, 80] }, // B
  { path: 2, s: [250, 50, 250, 350], hidden: true }, // D (livello spento)
  { path: 3, s: [100, 500, 300, 500] }, // H
  { path: 4, s: [200, 560, 200, 500] }, // V: la cima finisce SU H
  { path: 5, s: [450, 600, 500, 700] }, // spezzata, primo tratto
  { path: 5, s: [500, 700, 550, 600] }, // spezzata, secondo tratto (vertice 500, 700)
  { path: 6, s: [100, 650, 300, 650] }, // P1
  { path: 7, s: [100, 670, 300, 670] }, // P2 (parallelo a P1)
  { path: 8, s: [200, 630, 220, 690] }, // C: incrocia P1 e P2
  { path: 9, s: [430, 150, 570, 150] }, // E: attraversa un RIEMPIMENTO
  { path: 10, s: [430, 350, 570, 350] }, // F: attraversa un tracciato-e-riempito
  { path: 11, s: [450, 300, 550, 300] }, // rettangolo `re B`, 4 lati
  { path: 11, s: [550, 300, 550, 400] },
  { path: 11, s: [550, 400, 450, 400] },
  { path: 11, s: [450, 400, 450, 300] },
];
/** Il PDF «croci»: 600 x 800 (variante con /Rotate o CropBox), con un livello spento, un riempimento, un tracciato-e-riempito e le linee di CROCI_SEGS. */
async function crociPdf({ rotate = 0, crop = null } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage([600, 800]);
  const c = doc.context;
  const ocgOn = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('acceso') }));
  const ocgOff = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('spento') }));
  doc.catalog.set(PDFName.of('OCProperties'), c.obj({ OCGs: [ocgOn, ocgOff], D: { Order: [ocgOn, ocgOff], ON: [ocgOn], OFF: [ocgOff] } }));
  pg.node.set(PDFName.of('Resources'), c.obj({ Properties: { On: ocgOn, Off: ocgOff } }));
  const seg = (s) => `${s[0]} ${s[1]} m ${s[2]} ${s[3]} l S`;
  const [A, B, Dd, H, V, , , P1, P2, C, E, F] = CROCI_SEGS.map((x) => x.s);
  const content = [
    '0 G 1 w',
    seg(A),
    seg(B),
    `/OC /Off BDC ${seg(Dd)} EMC`,
    seg(H),
    seg(V),
    '450 600 m 500 700 l 550 600 l S', // una spezzata: UN percorso, due tratti, un vertice
    seg(P1),
    seg(P2),
    seg(C),
    '0.7 g 450 100 100 100 re f', // riempimento: i suoi lati NON sono tratti
    '0 G',
    seg(E),
    '1 0 0 rg 0 G 450 300 100 100 re B', // riempimento e contorno: i lati SONO tratti
    seg(F),
  ].join('\n');
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  if (rotate) pg.setRotation(degrees(rotate));
  if (crop) pg.setCropBox(...crop);
  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- oracoli (calcolo indipendente dal codice dell'app)
/** Incontro di due tratti (Cramer) nello spazio utente, o null; coordinate Float32 come quelle di PDF.js. */
function cramer(a, b) {
  const [x1, y1, x2, y2] = Array.from(new Float32Array(a));
  const [x3, y3, x4, y4] = Array.from(new Float32Array(b));
  const a11 = x2 - x1;
  const a12 = -(x4 - x3);
  const a21 = y2 - y1;
  const a22 = -(y4 - y3);
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((x3 - x1) * a22 - a12 * (y3 - y1)) / det;
  const u = (a11 * (y3 - y1) - (x3 - x1) * a21) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return P(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
}
const sharesEnd = (a, b) =>
  [
    [0, 1],
    [2, 3],
  ].some(([i, j]) =>
    [
      [0, 1],
      [2, 3],
    ].some(([k, l]) => a[i] === b[k] && a[j] === b[l]),
  );
/** Le Intersezioni fra i tratti VISIBILI dei percorsi di `segs` e (opzionale) di `extra` (oggetti: {s, path}); due tratti dello stesso percorso con un estremo in comune non si confrontano. */
function interOracle(segs, extra = []) {
  const all = [...segs.filter((x) => !x.hidden).map((x) => ({ path: x.path, s: Array.from(new Float32Array(x.s)) })), ...extra];
  const out = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].path === all[j].path && sharesEnd(all[i].s, all[j].s)) continue;
      const p = cramer(all[i].s, all[j].s);
      if (p) out.push(p);
    }
  }
  return out;
}
/** Gli incontri di un tratto con un cerchio (centro, raggio), dentro il tratto. */
function segCircle(s, c, r) {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const a = dx * dx + dy * dy;
  const b = 2 * (dx * (x1 - c.x) + dy * (y1 - c.y));
  const cc = (x1 - c.x) ** 2 + (y1 - c.y) ** 2 - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return [];
  return [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter((t) => t >= 0 && t <= 1).map((t) => P(x1 + t * dx, y1 + t * dy));
}
/** I piedi della perpendicolare da `a` sui tratti visibili (dentro il tratto, estremi compresi) che non coincidono con `a`. */
function perpOracle(segs, a) {
  const out = [];
  for (const x of segs) {
    if (x.hidden) continue;
    const [x1, y1, x2, y2] = Array.from(new Float32Array(x.s));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = ((a.x - x1) * dx + (a.y - y1) * dy) / (dx * dx + dy * dy);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const f = P(x1 + t * dx, y1 + t * dy);
    if (dist(f, a) > 1e-9) out.push(f);
  }
  return out;
}
/** Il candidato piu' vicino a `u` entro `r` pt (spazio utente, UserUnit 1: la rotazione conserva le distanze), o null. */
const nearest = (cands, u, r) => cands.filter((c) => dist(c, u) <= r).sort((p, q) => dist(p, u) - dist(q, u))[0] || null;
/** Ogni candidato dell'oracolo e' agganciato (marcatore del tipo, nel punto giusto) e dove l'oracolo non ne ha entro 15 px non c'e' nulla. Restituisce gli errori. */
async function hoverAll(page, cands, kind, extraNone = []) {
  const k = await zoomPx(page);
  const bad = [];
  for (const p of cands) {
    const e = await hoverCheck(page, `${kind} in (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`, p, { kind, at: p });
    if (e) bad.push(e);
  }
  for (const u of extraNone) {
    if (nearest(cands, u, 15 / k)) {
      bad.push(`punto "nessun marcatore" (${u.x}, ${u.y}) troppo vicino a un candidato dell'oracolo`);
      continue;
    }
    const e = await hoverCheck(page, `nessun marcatore in (${u.x}, ${u.y})`, u, null);
    if (e) bad.push(e);
  }
  return bad;
}
async function openCroci(page, variant) {
  const bytes = await crociPdf(variant);
  await loadNamed(page, 'croci.pdf', bytes);
  return showFit(page, 1);
}
const CROCI_VARIANTS = {
  '/Rotate 0': {},
  '/Rotate 90': { rotate: 90 },
  'CropBox (20, 20, 560, 770)': { crop: [20, 20, 560, 770] },
};

// ---------------------------------------------------------------- serie 2: PDF sintetico di tratti noti (mouse), Intersezione
async function syntheticSuite(browser) {
  for (const [vname, variant] of Object.entries(CROCI_VARIANTS)) {
    setSection(`PDF sintetico «croci», ${vname}`);
    const { ctx, page, errors } = await desktop(browser);
    const st = await openCroci(page, variant);
    await tool(page, 'Retta');
    const tag = `croci ${vname}`;
    check(`${tag}: lo stato dice 16 tratti letti (12 linee e i 4 lati del rettangolo «re B»), 1 nascosto, 15 nella scena, nessuno ritagliato`, !!st && st.kind === 'ready' && st.sceneStats && st.sceneStats.segments === 16 && st.sceneStats.hidden === 1 && st.sceneStats.kept === 15 && st.sceneStats.clipped === 0 && st.sceneStats.outside === 0, JSON.stringify(st && st.sceneStats));
    // l'oracolo (Cramer, scritto qui): 6 incontri; il vertice della spezzata, i vertici del rettangolo, i paralleli, il livello spento e il riempimento non ne danno
    const inter = interOracle(CROCI_SEGS);
    check(`${tag}: l'oracolo di Cramer trova 6 incontri (obliquo A x B, T, C x P1, C x P2, F x due lati del rettangolo)`, inter.length === 6, JSON.stringify(inter));
    await only(page, ['intersection']);
    const none = [P(500, 700), P(450, 150), P(550, 150), P(250, 240), P(250, 200), P(250, 660), P(80, 100), P(450, 300), P(550, 400), P(300, 400)];
    let bad = await hoverAll(page, inter, 'intersection', none);
    check(`${tag}: ogni incontro ha il marcatore Intersezione nel punto giusto; nessun marcatore sul vertice della spezzata, sui vertici del rettangolo, fra i paralleli, sul livello spento, sui lati di un riempimento`, bad.length === 0, bad.slice(0, 3).join(' | '));
    // tutti i tipi accesi: nel T vince l'Estremo (la cima di V finisce sul punto medio di H: Estremo e Punto medio nello stesso punto), nell'incrocio obliquo l'Intersezione
    await allOn(page);
    const T = P(200, 500);
    const AB = cramer(CROCI_SEGS[0].s, CROCI_SEGS[1].s);
    let e = await hoverCheck(page, 'T', T, { kind: 'end', at: T });
    check(`${tag}: con tutti i tipi accesi, nel T (la cima di V sul punto medio di H) vince l'Estremo`, e === null, e || '');
    e = await hoverCheck(page, 'A x B', AB, { kind: 'intersection', at: AB });
    check(`${tag}: con tutti i tipi accesi, nell'incrocio obliquo A x B (ne' estremo ne' punto medio) c'e' l'Intersezione`, e === null, e || '');
    e = await hoverCheck(page, 'vertice spezzata', P(500, 700), { kind: 'end', at: P(500, 700) });
    check(`${tag}: il vertice della spezzata e' un Estremo (non un'Intersezione)`, e === null, e || '');
    // interruttore PDF spento: nessun aggancio sull'incrocio
    await setSwitch(page, 'pdf', false);
    e = await hoverCheck(page, 'A x B con PDF spento', AB, null);
    check(`${tag}: con «PDF» spento nessun marcatore sull'incrocio A x B`, e === null, e || '');
    await setSwitch(page, 'pdf', true);
    e = await hoverCheck(page, 'A x B con PDF riacceso', AB, { kind: 'intersection', at: AB });
    check(`${tag}: con «PDF» di nuovo acceso l'Intersezione torna`, e === null, e || '');
    // Intersezione spenta: nessuna
    await setSwitch(page, 'intersection', false);
    e = await hoverCheck(page, 'A x B con Intersezione spenta', AB, null);
    check(`${tag}: con Intersezione spenta nessun marcatore sull'incrocio A x B`, e === null, e || '');
    await setSwitch(page, 'intersection', true);
    // il punto inserito (per ultimo: la Retta inserita ha un estremo proprio sull'incrocio)
    const got = await clickFirstPoint(page, AB, P(300, 760));
    check(`${tag}: il primo punto inserito e' l'incrocio A x B calcolato da Cramer (entro ${USER_TOL} pt)`, !!got && near(got.x, AB.x, USER_TOL) && near(got.y, AB.y, USER_TOL), JSON.stringify({ got, AB }));
    check(`${tag}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- serie 3: Perpendicolare dall'ancora a una linea del PDF
async function perpSuite(browser) {
  for (const [vname, variant] of Object.entries(CROCI_VARIANTS)) {
    setSection(`Perpendicolare, ${vname}`);
    const { ctx, page, errors } = await desktop(browser);
    await openCroci(page, variant);
    await tool(page, 'Retta');
    const tag = `croci ${vname}`;
    await only(page, ['perpendicular']);
    // senza ancora (nessun punto indicato) nessun candidato, neanche sulle linee
    let e = await hoverCheck(page, 'su A senza ancora', P(250, 200), null);
    check(`${tag}: senza punto di partenza nessun marcatore sulla linea A`, e === null, e || '');
    // ancora in (250, 420): il primo clic non si aggancia a nulla (nessun tipo con ancora assente); nessun piede cade vicino a un estremo (t lontano da 0 e da 1)
    const anchor = P(250, 420);
    await click(page, await clientOfUser(page, anchor), 0, 0);
    const feet = perpOracle(CROCI_SEGS, anchor);
    check(`${tag}: l'oracolo trova ${feet.length} piedi dall'ancora (250, 420): A, B, H, P1 e P2`, feet.length === 5, JSON.stringify(feet.map((f) => [+f.x.toFixed(2), +f.y.toFixed(2)])));
    let bad = await hoverAll(page, feet, 'perpendicular', [P(200, 400), P(250, 580)]);
    check(`${tag}: dall'ancora il piede su ogni linea (dentro il tratto) ha il marcatore Perpendicolare (angolo retto) nel punto giusto; fuori dai tratti nessun marcatore`, bad.length === 0, bad.slice(0, 3).join(' | '));
    // il secondo punto inserito e' il piede sulla linea A: sta su A e il tratto ancora-piede e' perpendicolare ad A (l'ancora vera e' quella del clic, entro un pixel dal punto nominale)
    const footA = perpOracle([CROCI_SEGS[0]], anchor)[0];
    await click(page, await clientOfUser(page, footA), 0.3, -0.2);
    const objs = await objectsOf(page);
    const last = objs[objs.length - 1];
    const [ax1, ay1, ax2, ay2] = Array.from(new Float32Array(CROCI_SEGS[0].s));
    let perpOk = false;
    let detail = JSON.stringify(last);
    if (last && last.kind === 'segment') {
      const [q0, q1] = last.points;
      const dxA = ax2 - ax1;
      const dyA = ay2 - ay1;
      const t = ((q0.x - ax1) * dxA + (q0.y - ay1) * dyA) / (dxA * dxA + dyA * dyA);
      const proj = { x: ax1 + t * dxA, y: ay1 + t * dyA };
      perpOk = near(q1.x, proj.x, USER_TOL) && near(q1.y, proj.y, USER_TOL) && dist(q0, anchor) < 1.5 && dist(q1, footA) < 1.5;
      detail = JSON.stringify({ q0, q1, proj });
    }
    check(`${tag}: il secondo punto della Retta e' il piede della perpendicolare dal suo primo punto sulla linea A (entro ${USER_TOL} pt)`, perpOk, detail);
    // il piede FUORI dal tratto: ancora in (350, 700), cursore in (350, 650): le perpendicolari cadrebbero sui prolungamenti
    await page.keyboard.press('Escape');
    const anchor2 = P(350, 700);
    await click(page, await clientOfUser(page, anchor2), 0, 0);
    const feet2 = perpOracle(CROCI_SEGS, anchor2);
    bad = await hoverAll(page, feet2, 'perpendicular', [P(350, 650), P(350, 670), P(350, 500)]);
    check(`${tag}: dall'ancora (350, 700) i piedi fuori dai tratti (sui prolungamenti di P1, P2, H) non sono agganciabili`, bad.length === 0, bad.slice(0, 3).join(' | '));
    // ancora SULLA linea H: il primo clic si aggancia al Punto medio di H (200, 500), quindi e' ESATTAMENTE sulla linea; il piede coincide con l'ancora e non si offre
    await page.keyboard.press('Escape');
    await only(page, ['mid']);
    const anchor3 = P(200, 500);
    await click(page, await clientOfUser(page, anchor3), 0.4, -0.3);
    await only(page, ['perpendicular']);
    const feet3 = perpOracle(CROCI_SEGS, anchor3);
    bad = await hoverAll(page, feet3, 'perpendicular', [P(200, 500)]);
    check(`${tag}: con l'ancora sulla linea H (nel suo punto medio) il piede (l'ancora stessa, e la cima di V che coincide) non si offre`, bad.length === 0, bad.slice(0, 3).join(' | '));
    // interruttori: Perpendicolare spenta nessun piede; «PDF» spento nessun piede; poi tornano
    await page.keyboard.press('Escape');
    await click(page, await clientOfUser(page, anchor), 0, 0);
    e = await hoverCheck(page, 'piede su A', footA, { kind: 'perpendicular', at: footA });
    check(`${tag}: (controllo) il piede su A c'e'`, e === null, e || '');
    await setSwitch(page, 'perpendicular', false);
    e = await hoverCheck(page, 'piede su A con Perpendicolare spenta', footA, null);
    check(`${tag}: con Perpendicolare spenta nessun piede sul PDF`, e === null, e || '');
    await setSwitch(page, 'perpendicular', true);
    await setSwitch(page, 'pdf', false);
    e = await hoverCheck(page, 'piede su A con PDF spento', footA, null);
    check(`${tag}: con «PDF» spento nessun piede sul PDF`, e === null, e || '');
    await setSwitch(page, 'pdf', true);
    e = await hoverCheck(page, 'piede su A di nuovo', footA, { kind: 'perpendicular', at: footA });
    check(`${tag}: con «PDF» di nuovo acceso il piede torna`, e === null, e || '');
    await page.keyboard.press('Escape');
    check(`${tag}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- serie 4: oggetti disegnati contro linee del PDF
async function objectsSuite(browser) {
  setSection('oggetti disegnati contro linee del PDF');
  const { ctx, page, errors } = await desktop(browser);
  await openCroci(page, {});
  await tool(page, 'Retta');
  const view = await page.evaluate(() => window.__gtpdf.pages()[0].view);
  const fr = (u) => [(u.x - view[0]) / (view[2] - view[0]), (u.y - view[1]) / (view[3] - view[1])];
  // una Retta disegnata R1 (60,200)-(420,200) e un Cerchio C1 di centro (500, 200) e raggio 60
  const R1 = [60, 200, 420, 200];
  const C1 = { c: P(500, 200), r: 60 };
  await page.evaluate(
    ({ a, b, c, d }) =>
      window.__gtpdf.addSpecs(1, [
        { k: 'segment', pts: [a, b] },
        { k: 'circle', a: c, b: d },
      ]),
    { a: fr(P(R1[0], R1[1])), b: fr(P(R1[2], R1[3])), c: fr(C1.c), d: fr(P(C1.c.x + C1.r, C1.c.y)) },
  );
  await page.waitForTimeout(150);
  await only(page, ['intersection']);
  // la Retta disegnata contro le linee del PDF (A, B) e il Cerchio contro E; il lato di un riempimento non conta
  const pdfSegs = CROCI_SEGS.filter((x) => !x.hidden);
  const extra = [{ path: 1000, s: R1 }];
  const pdfInter = interOracle(CROCI_SEGS, extra);
  const circleInter = [];
  for (const x of pdfSegs) for (const p of segCircle(Array.from(new Float32Array(x.s)), C1.c, C1.r)) circleInter.push(p);
  const r1xA = cramer(R1, CROCI_SEGS[0].s);
  const r1xB = cramer(R1, CROCI_SEGS[1].s);
  check("oracolo: la Retta disegnata incrocia A in (250, 200) e B in (282.5, 200); il Cerchio incrocia E in due punti (466.8, 150) e (533.2, 150)", !!r1xA && !!r1xB && near(r1xA.x, 250, 1e-4) && near(r1xB.x, 282.5, 1e-4) && circleInter.length >= 2 && circleInter.some((p) => near(p.x, 466.8, 0.1) && near(p.y, 150, 1e-3)) && circleInter.some((p) => near(p.x, 533.2, 0.1)), JSON.stringify({ r1xA, r1xB, circleInter }));
  let bad = await hoverAll(page, [...pdfInter, ...circleInter], 'intersection', [P(450, 166.8), P(450, 233.2)]);
  check("Retta e Cerchio disegnati: ogni incontro con una linea del PDF (e fra le linee del PDF) ha il marcatore Intersezione nel punto giusto; il Cerchio non da' incontri con i lati di un riempimento", bad.length === 0, bad.slice(0, 3).join(' | '));
  // con «PDF» spento: l'incontro Retta-A non c'e'; fra due OGGETTI disegnati resta
  await page.evaluate(({ a, b }) => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [a, b] }]), { a: fr(P(350, 100)), b: fr(P(350, 300)) });
  await page.waitForTimeout(150);
  const R2 = [350, 100, 350, 300];
  const r1xR2 = cramer(R1, R2);
  await setSwitch(page, 'pdf', false);
  let e = await hoverCheck(page, 'R1 x A con PDF spento', r1xA, null);
  check("con «PDF» spento nessun marcatore sull'incontro fra la Retta disegnata e la linea A del PDF", e === null, e || '');
  e = await hoverCheck(page, 'R1 x R2 con PDF spento', r1xR2, { kind: 'intersection', at: r1xR2 });
  check("con «PDF» spento l'Intersezione fra due oggetti disegnati resta", e === null, e || '');
  e = await hoverCheck(page, 'C1 x E con PDF spento', circleInter.find((p) => p.x < 500), null);
  check("con «PDF» spento nessun marcatore sull'incontro fra il Cerchio disegnato e la linea E del PDF", e === null, e || '');
  await setSwitch(page, 'pdf', true);
  e = await hoverCheck(page, 'R1 x A con PDF acceso', r1xA, { kind: 'intersection', at: r1xA });
  check("con «PDF» di nuovo acceso l'incontro Retta-A torna", e === null, e || '');
  // il punto inserito: l'incontro Retta-A (per ultimo: la Retta inserita ha un estremo proprio sull'incontro)
  await only(page, ['intersection']);
  const got = await clickFirstPoint(page, r1xA, P(300, 760));
  check(`il primo punto inserito e' l'incontro fra la Retta disegnata e la linea A (entro ${USER_TOL} pt)`, !!got && near(got.x, r1xA.x, USER_TOL) && near(got.y, r1xA.y, USER_TOL), JSON.stringify({ got, r1xA }));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 5: quota e distanza fra due Intersezioni
async function quoteSuite(browser) {
  for (const [title, box] of Object.entries(SHEET_BOXES)) {
    setSection(`quota fra Intersezioni, ${title}`);
    const { ctx, page, errors } = await desktop(browser);
    await openDoc(page, title);
    const sc = sheetCrossings(box);
    await only(page, ['intersection']);
    // calibrazione sul riferimento di 100 mm: i suoi due estremi sono Intersezioni (le tacche), non Estremi (spenti)
    await tool(page, 'Scala');
    await click(page, await clientOfUser(page, sc.out['riferimento, estremo sinistro']), 2, -2);
    await click(page, await clientOfUser(page, sc.out['riferimento, estremo destro']), -2, 2);
    await page.waitForSelector('.dialog');
    await page.locator('.dialog .dlg-fields input').fill('100');
    await page.locator('.dialog .btn.primary').click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    const scaleLbl = (await page.locator('.st-scale-btn').innerText()).trim();
    check(`${title}: calibrata su due Intersezioni la scala e' 1:1 (il riferimento e' di 100 mm)`, /^1[:.]/.test(scaleLbl), scaleLbl);
    const L = sc.out['quota, estremo sinistro'];
    const R = sc.out['quota, estremo destro'];
    const wantMm = ((R.x - L.x) * 25.4) / 72; // = 2 r in mm
    await tool(page, 'Distanza');
    await click(page, await clientOfUser(page, L), 3, -3);
    await click(page, await clientOfUser(page, R), -3, 3);
    await page.waitForTimeout(150);
    const msg = await status(page);
    const got = parseFloat((/Distanza ([\d.]+) mm/.exec(msg) || [])[1]);
    check(`${title}: Distanza fra le due Intersezioni della quota = ${wantMm.toFixed(2)} mm entro ${MM_TOL} mm`, Math.abs(got - wantMm) <= MM_TOL, `${msg} (atteso ${wantMm.toFixed(4)})`);
    if (sc.out['quota e asse verticale']) {
      const C = sc.out['assi (centro)'];
      const V = sc.out['quota e asse verticale'];
      const wantV = ((C.y - V.y) * 25.4) / 72;
      await click(page, await clientOfUser(page, V), 3, -3);
      await click(page, await clientOfUser(page, C), -3, 3);
      await page.waitForTimeout(150);
      const gotV = parseFloat((/Distanza ([\d.]+) mm/.exec(await status(page)) || [])[1]);
      check(`${title}: Distanza in verticale fra due Intersezioni (assi e quota con l'asse) = ${wantV.toFixed(2)} mm entro ${MM_TOL} mm`, Math.abs(gotV - wantV) <= MM_TOL, `${await status(page)} (atteso ${wantV.toFixed(4)})`);
    }
    // Quota allineata fra le due Intersezioni
    await tool(page, 'Quota');
    await click(page, await clientOfUser(page, L), 3, -3);
    await click(page, await clientOfUser(page, R), -3, 3);
    await click(page, await clientOfUser(page, { x: box[0] + box[2] * 0.5, y: box[1] + box[3] * 0.93 }), 0, 0);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const st = await page.evaluate(() => window.__gtpdf.state().pages[0]);
    const dim = st.objects.find((o) => o.kind === 'dim');
    check(`${title}: la quota fra le due Intersezioni e' stata inserita`, !!dim, JSON.stringify(st.objects.map((o) => o.kind)));
    if (dim) {
      check(`${title}: i due punti della quota sono le due Intersezioni (entro ${USER_TOL} pt)`, near(dim.p1.x, L.x, USER_TOL) && near(dim.p1.y, L.y, USER_TOL) && near(dim.p2.x, R.x, USER_TOL) && near(dim.p2.y, R.y, USER_TOL), JSON.stringify({ p1: dim.p1, p2: dim.p2, L, R }));
      const txt = (st.texts.flat() || []).join(' ');
      const val = parseFloat((/(\d+[.,]\d+)/.exec(txt) || [])[1]?.replace(',', '.'));
      info(`${title}: distanza attesa ${wantMm.toFixed(4)} mm; la quota dice "${txt}"`);
      check(`${title}: il valore della quota e' uguale alla distanza attesa (${wantMm.toFixed(2)} mm) entro ${MM_TOL} mm`, Math.abs(val - wantMm) <= MM_TOL, `quota ${val}, attesi ${wantMm.toFixed(4)}`);
    }
    check(`${title}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- serie 6: scena fitta (tetto delle voci), messaggio, Estremo che resta
async function denseSuite(browser) {
  setSection('scena fitta');
  const { ctx, page, errors } = await desktop(browser);
  await openCroci(page, {});
  await tool(page, 'Retta');
  await only(page, ['intersection']);
  const AB = cramer(CROCI_SEGS[0].s, CROCI_SEGS[1].s);
  let e = await hoverCheck(page, 'A x B', AB, { kind: 'intersection', at: AB });
  check("(controllo) con il tetto di serie l'Intersezione A x B c'e'", e === null, e || '');
  // lettura della stessa pagina con un tetto di 5 voci: la scena e' fitta
  const r = await page.evaluate(() => window.__gtpdf.pdfSnapLoad(1, { maxSceneRefs: 5, store: true }));
  const sc = r.state.sceneStats;
  check("con un tetto di 5 voci lo stato e' pronto ma la scena e' fitta (dense), senza scena, con i punti di prima", r.state.kind === 'ready' && sc && sc.dense === true && r.state.hasScene === false && sc.maxRefs === 5 && sc.refs > 5 && r.state.nEnd > 0, JSON.stringify(r.state));
  e = await hoverCheck(page, 'A x B con scena fitta', AB, null);
  check("con la scena fitta nessuna Intersezione del PDF (A x B)", e === null, e || '');
  // Estremo e Punto medio del PDF restano
  await only(page, ['end', 'mid']);
  const A0 = P(CROCI_SEGS[0].s[0], CROCI_SEGS[0].s[1]);
  const Amid = P((CROCI_SEGS[0].s[0] + CROCI_SEGS[0].s[2]) / 2, (CROCI_SEGS[0].s[1] + CROCI_SEGS[0].s[3]) / 2);
  e = await hoverCheck(page, 'Estremo di A', A0, { kind: 'end', at: A0 });
  check("con la scena fitta l'Estremo del PDF resta (inizio di A)", e === null, e || '');
  e = await hoverCheck(page, 'Punto medio di A', Amid, { kind: 'mid', at: Amid });
  check('con la scena fitta il Punto medio del PDF resta (A)', e === null, e || '');
  // il messaggio, una volta per pagina: spegnendo e riaccendendo «PDF» la riga dei messaggi lo ripete
  await setSwitch(page, 'pdf', false);
  await setSwitch(page, 'pdf', true);
  const msg = await status(page);
  check("il messaggio dice che per la pagina Intersezione e Perpendicolare sul PDF sono spente, che Estremo e Punto medio restano, e che gli oggetti disegnati si agganciano come sempre", /^PDF attivo\. Pagina 1: troppi tratti lunghi e fitti per l'Intersezione e la Perpendicolare sul PDF/.test(msg) && /l'Estremo e il Punto medio del PDF restano/.test(msg) && /Gli oggetti disegnati si agganciano come sempre\./.test(msg), msg);
  // con la scena fitta le Intersezioni fra oggetti disegnati restano
  await only(page, ['intersection']);
  await page.evaluate(({ a, b, c, d }) => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [a, b] }, { k: 'segment', pts: [c, d] }]), { a: [0.1, 0.55], b: [0.4, 0.55], c: [0.25, 0.45], d: [0.25, 0.65] });
  await page.waitForTimeout(150);
  const view = await page.evaluate(() => window.__gtpdf.pages()[0].view);
  const X = P(view[0] + 0.25 * (view[2] - view[0]), view[1] + 0.55 * (view[3] - view[1]));
  e = await hoverCheck(page, 'incontro fra due oggetti', X, { kind: 'intersection', at: X });
  check("con la scena del PDF fitta l'Intersezione fra due oggetti disegnati resta", e === null, e || '');
  // rilettura con il tetto di serie: la scena torna
  const r2 = await page.evaluate(() => window.__gtpdf.pdfSnapLoad(1, { store: true }));
  check('rilettura con il tetto di serie: la scena e\' di nuovo presente', r2.state.hasScene === true && r2.state.sceneStats.dense === false && r2.state.sceneStats.kept === 15, JSON.stringify(r2.state.sceneStats));
  e = await hoverCheck(page, 'A x B di nuovo', AB, { kind: 'intersection', at: AB });
  check("l'Intersezione A x B torna", e === null, e || '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 7: registro di Diagnostica
async function diagLog(page) {
  await page.evaluate(() => (location.hash = '#diag'));
  await page.waitForSelector('textarea[aria-label="Registro eventi"]', { state: 'attached' });
  await page.waitForTimeout(200);
  const t = await page.locator('textarea[aria-label="Registro eventi"]').inputValue();
  await page.evaluate(() => (location.hash = ''));
  await page.waitForTimeout(250);
  return t;
}
async function logSuite(browser) {
  setSection('registro della costruzione della scena');
  const { ctx, page, errors } = await desktop(browser);
  await loadNamed(page, `${SECRET}-a4.pdf`, readFileSync(join(PDF_DIR, 'a4-vettoriale.pdf')));
  await showFit(page, 1);
  const t = await diagLog(page);
  const line = t.split('\n').find((l) => /Snap PDF, pagina 1: pronto/.test(l)) || '';
  check('il registro riporta la scena: 12 tratti, celle da 8 pt, voci, MB e ms', /; scena dei tratti: 12 tratti \(0 ritagliati sul foglio, 0 fuori dal foglio\), celle da 8 pt, \d+ voci, \d\.\d\d MB, \d+ ms/.test(line), line);
  check('la riga del registro mantiene la parte di prima (44 estremi dalle curve e 11 punti medi da 12 tratti)', /pronto, 20 estremi e 11 punti medi da 12 tratti; curve: 24 estremi da 24 cubiche \(44 estremi in tutto\)/.test(line), line);
  check('nessuna riga dello snap PDF contiene il nome del file', !t.split('\n').filter((l) => /Snap PDF/.test(l)).some((l) => l.includes(SECRET)), '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 8: tocco (390 x 780)
async function touchSuite(browser) {
  setSection('tocco 390x780');
  const { ctx, page, cdp, errors } = await phone(browser);
  await openCroci(page, {});
  await tool(page, 'Retta');
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 390 px`);
  const AB = cramer(CROCI_SEGS[0].s, CROCI_SEGS[1].s); // incrocio obliquo: ne' un Estremo ne' un Punto medio
  const s = await clientOfUser(page, AB);
  await touch(cdp, 'touchStart', [[s.x + 4, s.y + 14]]);
  await page.waitForTimeout(120);
  let m = await snapMark(page);
  const d = m ? await markD(page) : null;
  check("tocco: a 14.6 px dall'incrocio obliquo compare il marcatore Intersezione (X) nel punto giusto (raggio del dito 22 px)", !!m && m.kind === 'intersection' && m.label === 'Intersezione' && d === D.intersection && dist(m, s) < 0.75, JSON.stringify({ m, d }));
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  const far = await clientOfUser(page, { x: 300, y: 760 });
  await touch(cdp, 'touchStart', [[far.x, far.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  const objs = await objectsOf(page);
  const last = objs[objs.length - 1];
  check("tocco: il primo punto inserito e' l'incrocio A x B", last && last.kind === 'segment' && near(last.points[0].x, AB.x, USER_TOL) && near(last.points[0].y, AB.y, USER_TOL), JSON.stringify(last?.points?.[0]));
  await touch(cdp, 'touchStart', [[s.x, s.y + 23.5]]);
  await page.waitForTimeout(100);
  m = await snapMark(page);
  check("tocco: a 23.5 px dall'incrocio non si aggancia a quel punto", m === null || dist(m, s) > 1, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 9: Diagnostica, scheda "Geometria PDF" e "Copia misura": INVARIATE rispetto a f5e4947
async function newDiag(browser, kind) {
  const isPhone = kind === 'phone';
  const ctx = await browser.newContext(isPhone ? { viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA } : { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(String(t)) } });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('ERRORE PAGINA:', e.message);
  });
  await page.goto(`${APP_URL}#diag`);
  await page.waitForSelector('.screen-diag input[type=file]', { state: 'attached' });
  return { ctx, page, errors };
}
const diagLogText = (page) => page.locator('textarea[aria-label="Registro eventi"]').inputValue();
async function diagLoad(page, name, bytes) {
  const before = ((await diagLogText(page)).match(/\[OK\] Aperto: /g) || []).length;
  await page.setInputFiles('.screen-diag input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction((a) => (document.querySelector('textarea[aria-label="Registro eventi"]').value.match(/\[OK\] Aperto: /g) || []).length > a, before);
  await page.waitForTimeout(250);
}
const geoBtn = (page, name) => page.locator('.geo-card').getByRole('button', { name, exact: true });
async function geoPress(page, name) {
  await geoBtn(page, name).click();
  await page.waitForFunction(() => /^(Misurat[ae] \d+|Nessuna pagina misurata|Misura fallita)/.test(document.querySelector('.geo-status').innerText), null, { timeout: 60000 });
}
/** Lo scheletro di un testo: ogni numero diventa `#` (tempi e memoria cambiano da una corsa all'altra; le righe, le parole e l'ordine no). */
const skeleton = (t) => t.split('\n').map((l) => l.replace(/-?\d+([.,]\d+)?/g, '#')).join('\n');
const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
/** SHA-256 (primi 16 caratteri) dello scheletro della scheda e di «Copia misura» MISURATI SU f5e4947 con questa stessa prova (E2E_DIST=<build di f5e4947> E2E_ONLY=diag): il testo e' lo stesso. */
const BASE_CARD = '54e4ea4cf928d4bb';
const BASE_COPY = '385020cfdd2af2f2';
async function diagSuite(browser, kind) {
  setSection(`scheda Geometria PDF e Copia misura, ${kind === 'phone' ? '390 x 780' : '1280 x 900'}`);
  const { ctx, page, errors } = await newDiag(browser, kind);
  const name = `${SECRET}-vettoriale.pdf`;
  await diagLoad(page, name, readFileSync(join(PDF_DIR, 'a4-vettoriale.pdf')));
  await geoPress(page, 'Misura questa pagina');
  const detail = await page.locator('.geo-detail').innerText();
  await geoBtn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const text = await page.evaluate(() => window.__copied.at(-1));
  const cardHash = sha(skeleton(detail));
  const copyHash = sha(skeleton(text));
  info(`scheda: ${detail.split('\n').length} righe, scheletro ${cardHash}; Copia misura: ${text.split('\n').length} righe, scheletro ${copyHash}`);
  check('la scheda e «Copia misura» non parlano della scena dei tratti, di Intersezione o di Perpendicolare (la misura non e\' cambiata)', !/scena|intersezion|perpendicolar/i.test(detail + text), '');
  check(`la scheda ha le stesse righe di f5e4947 (scheletro senza numeri ${BASE_CARD})`, cardHash === BASE_CARD, cardHash);
  check(`«Copia misura» ha le stesse righe di f5e4947 (scheletro senza numeri ${BASE_COPY})`, copyHash === BASE_COPY, copyHash);
  check('«Copia misura» non contiene il nome del file', !text.includes(SECRET) && !/\.pdf/i.test(text), '');
  check('ogni riga della scheda e\' anche nel testo copiato (stesso dettaglio)', detail.split('\n').every((l) => text.includes(l)), '');
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('nessuno scorrimento orizzontale della pagina Diagnostica', sw.sw <= sw.iw, JSON.stringify(sw));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
const SUITES = {
  incroci: crossingsSuite,
  sintetico: syntheticSuite,
  perp: perpSuite,
  oggetti: objectsSuite,
  quota: quoteSuite,
  fitta: denseSuite,
  registro: logSuite,
  tocco: touchSuite,
  diag: (browser) => diagSuite(browser, 'desktop'),
  diagphone: (browser) => diagSuite(browser, 'phone'),
};
(async () => {
  const only_ = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
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
    if (only_ && !only_.includes(name)) continue;
    await guarded(name, fn);
  }
  await lib.stopAll(servers);
  lib.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
