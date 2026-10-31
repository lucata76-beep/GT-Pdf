// Prove di CP6a (V2a) su Chromium: snap su Estremo e Punto medio, poi griglia. Mouse (desktop 1280 x 900) e tocco emulato (iPhone 932 x 430 / 390 x 780, DPR 3).
// Si prova: il punto inserito coincide con il candidato (estremo, centro, angolo, centro del lato); il marcatore (quadrato = Estremo, triangolo = Punto medio, con
// l'etichetta) sta nel livello di sovrapposizione al punto effettivo; interruttore spento = comportamento di 40a01be; con ORTO acceso; la squadratura del quadrato
// vince; nessuno snap in Seleziona, Cancella e nel trascinamento; la lente mostra il punto effettivo; l'esportazione e il file progetto non cambiano; la barra di stato.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6a.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 40a01be (senza snap) i controlli sullo snap FALLISCONO)
// Chromium NON e' il browser dell'utente (Safari/iPhone, o il browser del PC): nulla di quanto segue prova il comportamento li'.
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6a', out: process.argv[2], port: 4201, hport: 4202, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const UI_PX = [14, 16, 18, 20, 22];
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (p, q, tol = 1e-6) => near(p.x, q.x, tol) && near(p.y, q.y, tol);
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel di getBoundingClientRect), non con un candidato esatto. */
const RAW_TOL = 0.03;

// ---------------------------------------------------------------- strumenti di prova
async function desktop(browser, w = 1280, h = 900, uiIdx = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page };
}
async function phone(browser, w, h, uiIdx = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  // Registra gli argomenti con cui la lente copia il canvas del PDF (solo la lente: classe lens-canvas)
  await page.addInitScript(() => {
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    window.__lensCalls = [];
    CanvasRenderingContext2D.prototype.drawImage = function (...a) {
      if (this.canvas && this.canvas.classList && this.canvas.classList.contains('lens-canvas')) window.__lensCalls.push(a.slice(1).map(Number));
      return orig.apply(this, a);
    };
  });
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
const pressed = async (page, name) => (await toggle(page, name).getAttribute('aria-pressed')) === 'true';
const setToggle = async (page, name, on) => {
  if ((await pressed(page, name)) !== on) await toggle(page, name).click();
  await page.waitForTimeout(80);
};
const status = (page) => page.locator('.st-msg').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);

/**
 * Geometria della pagina 1, calcolata qui da `pages()` (view, rotate, userUnit) con le stesse formule di `PageGeometry` (src/geometry/page.ts): cosi' lo script non
 * dipende da ganci di prova nuovi e gira anche sul build di 40a01be (dove i controlli sullo snap devono FALLIRE). Lo spazio utente ha l'origine in basso a sinistra,
 * il foglio mostrato in alto a sinistra; il foglio e' in pt FISICI.
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

/** Area visibile e geometria della pagina 1 (come la vede l'app). */
const pageInfo = (page) => page.evaluate(() => ({ info: window.__gtpdf.pages()[0], sheet: window.__gtpdf.sheet() }));
/** Punto utente da frazioni (fx, fy) dell'area visibile (origine in basso a sinistra), come `addSpecs`. */
const userOf = (info, f) => ({ x: info.view[0] + f[0] * (info.view[2] - info.view[0]), y: info.view[1] + f[1] * (info.view[3] - info.view[1]) });
/** Posizione sullo schermo (client) di un punto utente. */
const clientOfUser = async (page, u) => {
  const s = G.userToSheet(u);
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
/** Punto utente sotto una posizione dello schermo (grezzo, senza snap). */
const userOfClient = async (page, c) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return G.sheetToUser({ x: (c.x - r.left) / k, y: (c.y - r.top) / k });
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
    const cs = shape ? getComputedStyle(shape) : null;
    return {
      kind: g.dataset.kind,
      label: g.querySelector('text')?.textContent ?? null,
      shape: shape?.tagName.toLowerCase() ?? null,
      x: m ? svg.left + +m[1] : NaN,
      y: m ? svg.top + +m[2] : NaN,
      stroke: cs?.stroke ?? null,
      strokeWidth: cs ? parseFloat(cs.strokeWidth) : NaN,
      bbox: shape ? (({ width, height }) => ({ w: width, h: height }))(shape.getBBox()) : null,
      inLayer: !!g.closest('.viewer-layer'),
    };
  });

/** Candidati (utente) di tutti gli oggetti di prova, per nome. */
function candidates(info, S) {
  const u = (f) => userOf(info, f);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const out = {};
  out.segA = { end1: u(S.segA[0]), end2: u(S.segA[1]), mid: mid(u(S.segA[0]), u(S.segA[1])) };
  out.polyB = { v1: u(S.polyB[0]), v2: u(S.polyB[1]), v3: u(S.polyB[2]), m12: mid(u(S.polyB[0]), u(S.polyB[1])), m23: mid(u(S.polyB[1]), u(S.polyB[2])) };
  const [ca, cb] = [u(S.rectC[0]), u(S.rectC[1])];
  out.rectC = {
    corners: [ca, { x: cb.x, y: ca.y }, cb, { x: ca.x, y: cb.y }],
    mids: [{ x: (ca.x + cb.x) / 2, y: ca.y }, { x: cb.x, y: (ca.y + cb.y) / 2 }, { x: (ca.x + cb.x) / 2, y: cb.y }, { x: ca.x, y: (ca.y + cb.y) / 2 }],
  };
  out.circD = { center: u(S.circD[0]), edge: u(S.circD[1]) };
  out.dimE = { p1: u(S.dimE[0]), p2: u(S.dimE[1]) };
  out.textT = u(S.textT);
  out.zeroZ = u(S.zeroZ);
  return out;
}

/** Oggetti di prova (frazioni dell'area visibile, origine in basso a sinistra): lontani fra loro piu' di 40 px a ogni zoom usato. */
const SPEC = {
  segA: [[0.2, 0.8], [0.5, 0.8]],
  polyB: [[0.2, 0.55], [0.3, 0.65], [0.45, 0.55]],
  rectC: [[0.62, 0.55], [0.86, 0.75]],
  circD: [[0.72, 0.3], [0.8, 0.3]],
  dimE: [[0.2, 0.2], [0.5, 0.2], [0.35, 0.14]],
  textT: [0.62, 0.12],
  zeroZ: [0.9, 0.9],
};
const addSpecs = (page) =>
  page.evaluate((S) => {
    window.__gtpdf.addSpecs(1, [
      { k: 'segment', pts: S.segA },
      { k: 'polyline', pts: S.polyB },
      { k: 'cover', shape: 'rect', a: S.rectC[0], b: S.rectC[1] },
      { k: 'cover', shape: 'circle', a: S.circD[0], b: S.circD[1] },
      { k: 'dim', dim: 'aligned', pts: S.dimE, value: '5' }, // allineata: vale per ogni /Rotate (una orizzontale sul foglio ruotato sarebbe degenere)
      { k: 'text', at: S.textT, text: 'T' },
      { k: 'segment', pts: [S.zeroZ, S.zeroZ] },
    ]);
  }, SPEC);

async function openDoc(page, title = 'A4 vettoriale', withObjects = true) {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  if (withObjects) await addSpecs(page);
  await page.waitForTimeout(200);
}

/** Passa il mouse sul punto `c` (con scostamento) e legge il marcatore. */
async function hoverMark(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.waitForTimeout(40);
  return snapMark(page);
}
/** Clic del mouse in `c`. */
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- 1) mouse
async function mouseSuite(browser) {
  setSection('mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const { info: pinfo } = await pageInfo(page);
  const C = candidates(pinfo, SPEC);
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt`);

  // -- interruttori
  const tg = await page.$$eval('.statusbar .st-toggle', (els) => els.map((e) => ({ id: e.dataset.toggle, label: e.textContent.trim(), pressed: e.getAttribute('aria-pressed') })));
  check('barra di stato: interruttori Estremo, Punto medio, ORTO (stesso componente st-toggle, aria-pressed)', JSON.stringify(tg.map((t) => [t.id, t.label])) === JSON.stringify([['end', 'Estremo'], ['mid', 'Punto medio'], ['ortho', 'ORTO']]), JSON.stringify(tg));
  check('all\'avvio Estremo e Punto medio sono attivi, ORTO spento', JSON.stringify(tg.map((t) => t.pressed)) === JSON.stringify(['true', 'true', 'false']), JSON.stringify(tg));

  await tool(page, 'Retta');
  // -- Estremo
  const sA1 = await clientOfUser(page, C.segA.end1);
  let m = await hoverMark(page, sA1, 4, -3);
  check('Retta: vicino a un estremo compare il marcatore Estremo', !!m && m.kind === 'end' && m.label === 'Estremo', JSON.stringify(m));
  check('marcatore Estremo: quadrato 8x8 px, tratto 1.5 px, colore snap-topology, nel livello di sovrapposizione', !!m && m.shape === 'rect' && near(m.bbox.w, 8, 0.01) && near(m.bbox.h, 8, 0.01) && near(m.strokeWidth, 1.5, 0.01) && m.stroke === 'rgb(0, 121, 107)' && m.inLayer, JSON.stringify(m));
  check('marcatore Estremo: sta sul punto effettivo (l\'estremo), non sul cursore', !!m && dist(m, sA1) < 0.75, m ? `${dist(m, sA1).toFixed(2)} px` : 'assente');
  await click(page, sA1, 4, -3);
  const sFar = await clientOfUser(page, { x: pinfo.view[0] + 0.4 * (pinfo.view[2] - pinfo.view[0]), y: pinfo.view[1] + 0.35 * (pinfo.view[3] - pinfo.view[1]) });
  await click(page, sFar);
  let objs = await objectsOf(page);
  let last = objs[objs.length - 1];
  const rawFar = await userOfClient(page, sFar);
  check('Retta: il primo punto inserito coincide con l\'estremo (entro 1e-6 pt)', last.kind === 'segment' && nearPt(last.points[0], C.segA.end1), JSON.stringify(last.points?.[0]));
  check('Retta: il secondo punto (nessun candidato vicino) e\' il punto grezzo', nearPt(last.points[1], rawFar, RAW_TOL), JSON.stringify({ inserito: last.points?.[1], atteso: rawFar }));
  check('dopo l\'inserimento il marcatore non resta', (await snapMark(page)) === null || (await snapMark(page)).kind === undefined);

  // -- Punto medio
  const sAm = await clientOfUser(page, C.segA.mid);
  m = await hoverMark(page, sAm, -4, 3);
  check('Retta: vicino al centro del tratto compare il marcatore Punto medio (triangolo, etichetta)', !!m && m.kind === 'mid' && m.label === 'Punto medio' && m.shape === 'polygon' && near(m.bbox.w, 8, 0.01) && near(m.bbox.h, 8, 0.01) && dist(m, sAm) < 0.75, JSON.stringify(m));
  await click(page, sAm, -4, 3);
  await click(page, sFar, 30, 20);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('Retta: il primo punto inserito coincide con il centro del tratto', nearPt(last.points[0], C.segA.mid), JSON.stringify(last.points?.[0]));

  // -- raggio del mouse: 10 px CSS (valore di partenza)
  m = await hoverMark(page, sA1, 9.5, 0);
  check('raggio del mouse: a 9.5 px dall\'estremo si aggancia', !!m && m.kind === 'end');
  m = await hoverMark(page, sA1, 10.5, 0);
  check('raggio del mouse: a 10.5 px dall\'estremo non si aggancia', m === null, JSON.stringify(m));
  m = await hoverMark(page, sA1, 0, -200);
  check('lontano da tutto: nessun marcatore', m === null);

  // -- spezzata
  const polyChecks = [['v1', C.polyB.v1, 'end'], ['v2', C.polyB.v2, 'end'], ['v3', C.polyB.v3, 'end'], ['m12', C.polyB.m12, 'mid'], ['m23', C.polyB.m23, 'mid']];
  for (const [name, u, kind] of polyChecks) {
    const s = await clientOfUser(page, u);
    m = await hoverMark(page, s, 3, 3);
    check(`Linea (spezzata): ${name} -> ${kind === 'end' ? 'Estremo' : 'Punto medio'} nel punto giusto`, !!m && m.kind === kind && dist(m, s) < 0.75, JSON.stringify(m));
  }

  // -- copertura rettangolare: 4 angoli e 4 centri dei lati
  for (let i = 0; i < 4; i++) {
    const s = await clientOfUser(page, C.rectC.corners[i]);
    m = await hoverMark(page, s, -3, 4);
    check(`copertura rettangolare: angolo ${i + 1} -> Estremo`, !!m && m.kind === 'end' && dist(m, s) < 0.75, JSON.stringify(m));
    const t = await clientOfUser(page, C.rectC.mids[i]);
    m = await hoverMark(page, t, 3, -4);
    check(`copertura rettangolare: centro del lato ${i + 1} -> Punto medio`, !!m && m.kind === 'mid' && dist(m, t) < 0.75, JSON.stringify(m));
  }
  // -- cerchio, quota (a/b), testo: niente
  for (const [name, u] of [['centro del cerchio', C.circD.center], ['punto sul bordo del cerchio', C.circD.edge], ['testo', C.textT]]) {
    m = await hoverMark(page, await clientOfUser(page, u), 2, 2);
    check(`${name}: nessuno snap in V2a`, m === null, JSON.stringify(m));
  }
  for (const [name, u] of [['quota: primo punto misurato', C.dimE.p1], ['quota: secondo punto misurato', C.dimE.p2]]) {
    const s = await clientOfUser(page, u);
    m = await hoverMark(page, s, 2, -2);
    check(`${name} -> Estremo`, !!m && m.kind === 'end' && dist(m, s) < 0.75, JSON.stringify(m));
  }
  // -- parita': segmento di lunghezza zero, centro e estremo coincidono: vince l'Estremo
  m = await hoverMark(page, await clientOfUser(page, C.zeroZ), 1, 1);
  check('parita\' di distanza (segmento di lunghezza zero): vince l\'Estremo sul Punto medio', !!m && m.kind === 'end', JSON.stringify(m));

  // -- interruttori
  await setToggle(page, 'end', false);
  check('Estremo spento: messaggio di stato e interruttore non premuto', !(await pressed(page, 'end')) && /Estremo.*disattiv/i.test(await status(page)), await status(page));
  m = await hoverMark(page, sA1, 3, 3);
  check('Estremo spento: vicino all\'estremo nessun marcatore', m === null, JSON.stringify(m));
  m = await hoverMark(page, sAm, 3, 3);
  check('Estremo spento: il Punto medio funziona ancora', !!m && m.kind === 'mid');
  await click(page, sA1, 3, 3);
  await click(page, sFar, 60, 10);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  const rawA1 = await userOfClient(page, { x: sA1.x + 3, y: sA1.y + 3 });
  check('Estremo spento: il punto inserito e\' quello grezzo (identico a 40a01be)', nearPt(last.points[0], rawA1, RAW_TOL) && !nearPt(last.points[0], C.segA.end1, 1e-3), JSON.stringify({ inserito: last.points?.[0], atteso: rawA1 }));
  await page.keyboard.press('Control+z'); // quella retta ha un estremo a 3 px da A: le prove seguenti si aggancerebbero (giustamente) a lui
  await setToggle(page, 'end', true);
  await setToggle(page, 'mid', false);
  check('Punto medio spento: messaggio di stato', !(await pressed(page, 'mid')) && /Punto medio.*disattiv/i.test(await status(page)), await status(page));
  const sPm = await clientOfUser(page, C.polyB.m12); // nessun oggetto creato dalla prova ha un estremo qui
  m = await hoverMark(page, sPm, 3, 3);
  check('Punto medio spento: vicino al centro di un tratto nessun marcatore', m === null, JSON.stringify(m));
  m = await hoverMark(page, sA1, 3, 3);
  check('Punto medio spento: l\'Estremo funziona ancora', !!m && m.kind === 'end');
  await setToggle(page, 'end', false);
  for (const [name, u] of [['estremo', C.segA.end1], ['centro', C.segA.mid], ['angolo', C.rectC.corners[0]]]) {
    m = await hoverMark(page, await clientOfUser(page, u), 2, 2);
    check(`tutti e due spenti: nessun marcatore sul ${name}`, m === null, JSON.stringify(m));
  }
  await setToggle(page, 'end', true);
  await setToggle(page, 'mid', true);
  check('riaccesi: messaggio di stato e interruttori premuti', (await pressed(page, 'end')) && (await pressed(page, 'mid')) && /attivo/i.test(await status(page)) && !/disattiv/i.test(await status(page)), await status(page));
  await page.keyboard.press('Escape');

  // -- ORTO
  await tool(page, 'Retta');
  await setToggle(page, 'ortho', true);
  const p0 = await clientOfUser(page, userOf(pinfo, [0.1, 0.4]));
  await click(page, p0);
  const sA2 = await clientOfUser(page, C.segA.end2);
  m = await hoverMark(page, sA2, 3, 3);
  check('ORTO acceso: lo snap vince sull\'ORTO (il marcatore e\' sull\'estremo, fuori asse)', !!m && m.kind === 'end' && dist(m, sA2) < 0.75, JSON.stringify(m));
  const pv = await page.$$eval('.sc-preview path', (e) => e[0]?.getAttribute('d'));
  const pn = (pv || '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  check('ORTO acceso: l\'anteprima va al punto agganciato (non e\' orizzontale ne\' verticale)', pn.length === 4 && !near(pn[0], pn[2], 1e-6) && !near(pn[1], pn[3], 1e-6), pv);
  await click(page, sA2, 3, 3);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('ORTO acceso: il secondo punto inserito e\' l\'estremo, non quello ortogonale', nearPt(last.points[1], C.segA.end2) && !near(last.points[0].x, last.points[1].x, 1e-3) && !near(last.points[0].y, last.points[1].y, 1e-3), JSON.stringify(last.points));
  // senza candidati vicini l'ORTO funziona come prima
  await click(page, p0);
  const q = await clientOfUser(page, userOf(pinfo, [0.3, 0.43]));
  m = await hoverMark(page, q);
  check('ORTO acceso, nessun candidato: nessun marcatore', m === null);
  await click(page, q);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('ORTO acceso, nessun candidato: il secondo punto e\' ortogonale (come 40a01be)', near(last.points[0].y, last.points[1].y, 1e-6) || near(last.points[0].x, last.points[1].x, 1e-6), JSON.stringify(last.points));
  await setToggle(page, 'ortho', false);

  // -- quadrato: la squadratura vince sullo snap per il secondo punto
  await page.locator('button.tool[title="Copertura"]').click();
  await page.getByRole('button', { name: 'Quadrato' }).click();
  await page.waitForTimeout(100);
  const sq0 = await clientOfUser(page, userOf(pinfo, [0.1, 0.95])); // in alto a sinistra: il quadrato cresce verso il basso e a destra senza uscire dalla pagina
  await click(page, sq0);
  const nearEnd = await clientOfUser(page, C.segA.end1); // un candidato lontano dal punto squadrato
  m = await hoverMark(page, nearEnd, 2, 2);
  check('quadrato: sul secondo punto la squadratura vince, nessun marcatore di snap', m === null, JSON.stringify(m));
  await click(page, nearEnd, 2, 2);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('quadrato: la copertura e\' stata creata', last.kind === 'cover' && last.shape === 'square', JSON.stringify(last));
  const g1 = last.kind === 'cover' ? { a: G.userToSheet(last.p1), b: G.userToSheet(last.p2) } : { a: { x: 0, y: 0 }, b: { x: 1, y: 2 } };
  check('quadrato: il secondo punto salvato e\' squadrato sul foglio (|dx| = |dy|)', near(Math.abs(g1.b.x - g1.a.x), Math.abs(g1.b.y - g1.a.y), 1e-6), JSON.stringify(g1));
  const C0 = await clientOfUser(page, C.segA.end1);
  check('quadrato: il secondo punto NON e\' l\'estremo vicino al quale si e\' cliccato (la squadratura ha vinto sullo snap)', last.kind === 'cover' && !nearPt(last.p2, C.segA.end1, 1e-3) && Number.isFinite(C0.x));
  await page.keyboard.press('Control+z'); // il quadrato ha il centro del lato inferiore vicino ad A: le prove seguenti si aggancerebbero (giustamente) a lui
  // il primo angolo del quadrato si aggancia
  const sCorner = await clientOfUser(page, C.rectC.corners[2]);
  m = await hoverMark(page, sCorner, 3, 3);
  check('quadrato: il primo angolo si aggancia a un candidato (Estremo)', !!m && m.kind === 'end');
  await page.keyboard.press('Escape');

  // -- altri strumenti: Distanza, Testo, Quota, Copertura rettangolare, Linea
  // (la barra contestuale cambia altezza da uno strumento all'altro, il foglio si riadatta: le posizioni sullo schermo si rileggono a ogni clic)
  const at = (u) => clientOfUser(page, u);
  await tool(page, 'Distanza');
  await click(page, await at(C.segA.end1), 3, 3);
  await click(page, await at(C.segA.end2), -3, 3);
  const badge = await page.locator('.measure-badge').innerText();
  const lenPt = Math.hypot(C.segA.end2.x - C.segA.end1.x, C.segA.end2.y - C.segA.end1.y);
  const mmExp = (lenPt * 25.4) / 72;
  const mm = parseFloat((badge.match(/L\s*([\d.]+)/) || badge.match(/([\d.]+)\s*mm/) || [])[1]);
  check(`Distanza: la misura fra due estremi e' esatta (${mmExp.toFixed(2)} mm sul foglio)`, near(mm, mmExp, 0.006), badge.replace(/\n/g, ' | '));
  await page.keyboard.press('Escape');
  await tool(page, 'Copertura');
  await page.getByRole('button', { name: 'Rettangolo' }).click();
  await click(page, await at(C.polyB.v1), 3, 3);
  await click(page, await at(C.polyB.v2), 3, -3);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('Copertura rettangolare: i due angoli sono i vertici agganciati', last.kind === 'cover' && last.shape === 'rect' && nearPt(last.p1, C.polyB.v1) && nearPt(last.p2, C.polyB.v2), JSON.stringify([last.p1, last.p2]));
  await tool(page, 'Linea');
  await click(page, await at(C.rectC.corners[0]), 3, 3);
  await click(page, await at(C.rectC.corners[2]), 3, 3);
  await page.getByRole('button', { name: 'Fine' }).click();
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('Linea: i punti sono gli angoli agganciati', last.kind === 'polyline' && nearPt(last.points[0], C.rectC.corners[0]) && nearPt(last.points[1], C.rectC.corners[2]), JSON.stringify(last.points));
  const nBefore = objs.length;
  await tool(page, 'Testo');
  await click(page, await at(C.segA.end1), 3, 3);
  await page.waitForSelector('.keypad:not([hidden])');
  await page.locator('.kp-key', { hasText: /^[A-Z]$/ }).first().click();
  await page.locator('.kp-ok').click();
  await page.waitForTimeout(100);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('Testo: il punto di inserimento e\' l\'estremo agganciato', objs.length === nBefore + 1 && last.kind === 'text' && nearPt(last.at, C.segA.end1), JSON.stringify(last.at));
  await tool(page, 'Quota');
  await click(page, await at(C.segA.end1), 3, 3);
  await click(page, await at(C.segA.end2), 3, 3);
  await click(page, await at(userOf(pinfo, [0.35, 0.88])));
  await page.waitForSelector('.keypad:not([hidden])');
  await page.locator('.kp-key', { hasText: /^5$/ }).first().click().catch(() => {});
  await page.locator('.kp-ok').click();
  await page.waitForTimeout(100);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('Quota: i due punti misurati sono gli estremi agganciati', last.kind === 'dim' && nearPt(last.p1, C.segA.end1) && nearPt(last.p2, C.segA.end2), JSON.stringify(last.kind === 'dim' ? [last.p1, last.p2] : last));
  await tool(page, 'Scala');
  await click(page, await at(C.segA.end1), 3, 3);
  await click(page, await at(C.segA.end2), 3, 3);
  await page.waitForSelector('.dialog-backdrop');
  const dlg = await page.locator('.dialog').innerText();
  check(`Scala: i due punti sono gli estremi agganciati (distanza esatta nel dialogo: ${lenPt.toFixed(2)} pt = ${mmExp.toFixed(2)} mm)`, dlg.includes(`${lenPt.toFixed(2)} pt = ${mmExp.toFixed(2)} mm`), dlg.replace(/\n/g, ' | ').slice(0, 220));
  await page.locator('.dialog').getByRole('button', { name: 'Annulla' }).click();
  await page.waitForTimeout(100);

  // -- Seleziona e Cancella: nessuno snap (con una posizione che, con un altro strumento, si aggancerebbe: lo si prova prima con Retta)
  await tool(page, 'Retta');
  m = await hoverMark(page, await at(C.segA.end1), 3, 3);
  check('(premessa) con Retta, nella stessa posizione, il marcatore c\'e\'', !!m && m.kind === 'end');
  await page.keyboard.press('Escape');
  for (const [label, name] of [['Seleziona', 'Seleziona'], ['Cancella', 'Cancella'], ['Sposta vista', 'Sposta vista']]) {
    await tool(page, label);
    m = await hoverMark(page, await at(C.segA.end1), 3, 3);
    check(`${name}: nessun marcatore di snap`, m === null, JSON.stringify(m));
  }

  // -- trascinamento: nessuno snap (l'oggetto si sposta esattamente quanto il mouse)
  await tool(page, 'Seleziona');
  const segs = (await objectsOf(page)).filter((o) => o.kind === 'segment');
  const A = segs[0];
  const onA = { x: C.segA.end1.x + 0.25 * (C.segA.end2.x - C.segA.end1.x), y: C.segA.end1.y }; // un punto della retta A lontano dai suoi estremi e dal centro
  const sAMid = await clientOfUser(page, onA);
  const k2 = await zoomPx(page);
  await click(page, sAMid); // seleziona la retta A
  const before = (await objectsOf(page)).find((o) => o.id === A.id).points;
  // sposta A in modo che il suo primo estremo finisca a 4 px dall'angolo del rettangolo (dove lo snap, se ci fosse, lo agganciarebbe)
  const target = await clientOfUser(page, C.rectC.corners[0]);
  const from = await clientOfUser(page, C.segA.end1);
  const ddx = target.x + 4 - from.x;
  const ddy = target.y + 3 - from.y;
  await page.mouse.move(sAMid.x, sAMid.y);
  await page.mouse.down();
  await page.mouse.move(sAMid.x + ddx / 2, sAMid.y + ddy / 2, { steps: 5 });
  await page.mouse.move(sAMid.x + ddx, sAMid.y + ddy, { steps: 5 });
  m = await snapMark(page);
  check('trascinamento: nessun marcatore di snap durante il trascinamento', m === null, JSON.stringify(m));
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = (await objectsOf(page)).find((o) => o.id === A.id).points;
  const dxPt = ddx / k2;
  const dyPt = ddy / k2;
  const sb = before.map((q) => G.userToSheet(q));
  const sa = after.map((q) => G.userToSheet(q));
  check('trascinamento: l\'oggetto si sposta esattamente quanto il mouse (nessuno snap nel trascinamento)', near(sa[0].x - sb[0].x, dxPt, RAW_TOL) && near(sa[0].y - sb[0].y, dyPt, RAW_TOL) && near(sa[1].x - sb[1].x, dxPt, RAW_TOL), JSON.stringify({ d: [sa[0].x - sb[0].x, sa[0].y - sb[0].y], atteso: [dxPt, dyPt] }));
  await page.evaluate(() => window.__gtpdf.view());
  await ctx.close();
}

// ---------------------------------------------------------------- 2) pagina ruotata e CropBox, mouse
async function pageSuite(browser) {
  for (const [title, name] of [['A4 con /Rotate 90', 'rotate90'], ['A4 con CropBox', 'cropbox']]) {
    setSection(`mouse, ${title}`);
    const { ctx, page } = await desktop(browser);
    await openDoc(page, title);
    const { info: pinfo } = await pageInfo(page);
    const C = candidates(pinfo, SPEC);
    await tool(page, 'Retta');
    let ok = 0;
    const tests = [['estremo della retta', C.segA.end1, 'end'], ['centro della retta', C.segA.mid, 'mid'], ['angolo della copertura', C.rectC.corners[1], 'end'], ['centro di un lato della copertura', C.rectC.mids[2], 'mid'], ['vertice della spezzata', C.polyB.v2, 'end'], ['centro di un tratto della spezzata', C.polyB.m23, 'mid']];
    for (const [what, u, kind] of tests) {
      const s = await clientOfUser(page, u);
      const m = await hoverMark(page, s, 3, -3);
      const good = !!m && m.kind === kind && dist(m, s) < 0.75;
      if (good) ok++;
      check(`${title}: ${what} -> ${kind === 'end' ? 'Estremo' : 'Punto medio'} nel punto giusto`, good, JSON.stringify(m));
      await click(page, s, 3, -3);
      await click(page, await clientOfUser(page, userOf(pinfo, [0.4, 0.33])));
      const objs = await objectsOf(page);
      const last = objs[objs.length - 1];
      check(`${title}: ${what}: il punto inserito (spazio utente) coincide con il candidato`, nearPt(last.points[0], u), JSON.stringify([last.points?.[0], u]));
    }
    info(`${title}: ${ok}/${tests.length} marcatori nel posto giusto`);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 3) tocco emulato e lente
async function touchSuite(browser) {
  setSection('tocco 932x430');
  const { ctx, page, cdp } = await phone(browser, 932, 430, 1);
  await openDoc(page);
  const { info: pinfo } = await pageInfo(page);
  const C = candidates(pinfo, SPEC);
  await tool(page, 'Retta');
  const k = await zoomPx(page);
  // A 932 x 430 il foglio e' piccolo (circa 0.3 px per pt): l'estremo e il centro della retta A distano meno del raggio del dito (22 px).
  // Gli scostamenti sono quindi PERPENDICOLARI alla retta, verso l'alto (sotto la retta cadrebbero entro 22 px i vertici della spezzata B), dove l'estremo e' il piu' vicino.
  info(`zoom di adattamento ${k.toFixed(3)} px/pt: la retta A e' lunga ${(((C.segA.end2.x - C.segA.end1.x) * k)).toFixed(0)} px`);
  const at = (u) => clientOfUser(page, u);
  const sA1 = await at(C.segA.end1);
  const sAm = await at(C.segA.mid);
  const sheetOf = async (u) => G.userToSheet(u);
  const lensCenter = async () => {
    const c = (await page.evaluate(() => window.__lensCalls.slice())).at(-1);
    return c ? { x: c[0] + c[2] / 2, y: c[1] + c[3] / 2 } : null;
  };
  const canvasScale = () => page.evaluate(() => document.querySelector('.viewer-stage canvas').width / window.__gtpdf.sheet().w);
  const cs = await canvasScale();
  const eff = await sheetOf(C.segA.end1);

  // dito a 15 px dall'estremo (raggio del dito: 22 px)
  await touch(cdp, 'touchStart', [[sA1.x, sA1.y - 15]]);
  await page.waitForTimeout(80);
  let m = await snapMark(page);
  check('tocco: a 15 px dall\'estremo compare il marcatore Estremo (raggio del dito 22 px)', !!m && m.kind === 'end' && dist(m, sA1) < 0.75, JSON.stringify(m));
  check('tocco: la lente e\' visibile durante la mira', (await page.locator('.lens:not([hidden])').count()) === 1);
  const lc = await lensCenter();
  const rawY = eff.y - 15 / k;
  check('lente: copia la zona attorno al punto EFFETTIVO (l\'estremo), non quella sotto il dito', !!lc && near(lc.x, eff.x * cs, 0.75) && near(lc.y, eff.y * cs, 0.75) && Math.abs(lc.y - rawY * cs) > 5, JSON.stringify({ lc, atteso: { x: eff.x * cs, y: eff.y * cs }, grezzoY: rawY * cs }));
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(60);
  const sFar = await at(userOf(pinfo, [0.4, 0.35]));
  await touch(cdp, 'touchStart', [[sFar.x, sFar.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  let objs = await objectsOf(page);
  let last = objs[objs.length - 1];
  check('tocco: il primo punto inserito coincide con l\'estremo', last.kind === 'segment' && nearPt(last.points[0], C.segA.end1), JSON.stringify(last.points?.[0]));
  check('tocco: dopo il rilascio il marcatore e la lente non restano', (await snapMark(page)) === null && (await page.locator('.lens:not([hidden])').count()) === 0);
  // raggio del dito: 22 px (le posizioni si rileggono: dopo il primo punto la barra contestuale cambia testo e il foglio puo' riadattarsi)
  let p1 = await at(C.segA.end1);
  await touch(cdp, 'touchStart', [[p1.x, p1.y - 21]]);
  m = await snapMark(page);
  check('raggio del dito: a 21 px si aggancia', !!m && m.kind === 'end', JSON.stringify(m));
  await touch(cdp, 'touchMove', [[p1.x, p1.y - 23]]);
  m = await snapMark(page);
  check('raggio del dito: a 23 px non si aggancia', m === null, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []); // si annulla la mira: nessun punto viene inserito
  // Punto medio con il dito (perpendicolare alla retta), e la lente lo segue mentre il dito si muove
  const pm = await at(C.segA.mid);
  await touch(cdp, 'touchStart', [[pm.x, pm.y - 18]]);
  await touch(cdp, 'touchMove', [[pm.x + 2, pm.y - 12]]);
  m = await snapMark(page);
  const lc2 = await lensCenter();
  const effM = await sheetOf(C.segA.mid);
  check('tocco: Punto medio (triangolo, etichetta) e la lente sul centro del tratto', !!m && m.kind === 'mid' && m.label === 'Punto medio' && !!lc2 && near(lc2.x, effM.x * cs, 0.75) && near(lc2.y, effM.y * cs, 0.75), JSON.stringify({ m, lc2 }));
  await touch(cdp, 'touchCancel', []);
  // un nuovo tocco sul centro: il punto inserito coincide con il centro del tratto
  const pm2 = await at(C.segA.mid);
  await touch(cdp, 'touchStart', [[pm2.x, pm2.y - 15]]);
  await touch(cdp, 'touchEnd', []);
  const pf2 = await at(userOf(pinfo, [0.45, 0.3]));
  await touch(cdp, 'touchStart', [[pf2.x, pf2.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  objs = await objectsOf(page);
  last = objs[objs.length - 1];
  check('tocco: il punto inserito coincide con il centro del tratto', last.kind === 'segment' && nearPt(last.points[0], C.segA.mid), JSON.stringify(last.points?.[0]));
  // interruttori spenti: nessun marcatore, la lente sta sul punto grezzo e il punto inserito e' quello sotto il dito (come 40a01be)
  await setToggle(page, 'end', false);
  await setToggle(page, 'mid', false);
  const sA1b = await at(C.segA.end1);
  await touch(cdp, 'touchStart', [[sA1b.x + 6, sA1b.y + 4]]);
  await page.waitForTimeout(60);
  m = await snapMark(page);
  const lc3 = await lensCenter();
  const rawS = await (async () => { const r = await canvasRect(page); const kk = r.width / G.width; return { x: (sA1b.x + 6 - r.left) / kk, y: (sA1b.y + 4 - r.top) / kk }; })();
  check('interruttori spenti (tocco): nessun marcatore e la lente e\' sul punto grezzo (come 40a01be)', m === null && !!lc3 && near(lc3.x, rawS.x * cs, 0.75) && near(lc3.y, rawS.y * cs, 0.75), JSON.stringify({ m, lc3, atteso: { x: rawS.x * cs, y: rawS.y * cs } }));
  await touch(cdp, 'touchEnd', []);
  await ctx.close();
}

// ---------------------------------------------------------------- 4) l'esportazione e il file progetto non cambiano
async function exportSuite(browser) {
  setSection('esportazione e progetto');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const { info: pinfo } = await pageInfo(page);
  const C = candidates(pinfo, SPEC);
  const sha = (b64) => lib.shaBuf(Buffer.from(b64, 'base64'));
  const exportHash = async () => {
    await page.evaluate(() => window.__gtpdf.runExport({ mode: 'simple', keep: true }));
    return sha(await page.evaluate(() => window.__gtpdf.lastExportBase64()));
  };
  const h0 = await exportHash();
  const h0b = await exportHash();
  check('l\'esportazione dello stesso lavoro e\' deterministica (due esportazioni uguali: il confronto che segue ha senso)', h0 === h0b, `${h0} / ${h0b}`);
  info(`SHA-256 dell'esportazione "Copertura semplice" del lavoro di prova: ${h0}`);
  const proj0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  await tool(page, 'Retta');
  const s = await clientOfUser(page, C.segA.end1);
  const m = await hoverMark(page, s, 3, 3);
  check('(premessa) il marcatore di snap e\' sullo schermo durante l\'esportazione', !!m && m.kind === 'end');
  const h1 = await exportHash();
  check('esportazione con il marcatore di snap sullo schermo = esportazione senza (il marcatore non e\' esportato)', h1 === h0, `${h1} / ${h0}`);
  await setToggle(page, 'end', false);
  await setToggle(page, 'mid', false);
  const proj1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('file progetto identico dopo aver cambiato gli interruttori di snap (stesso formato, nessun campo nuovo)', proj1 === proj0);
  const keys = (t) => { const j = JSON.parse(t); return { root: Object.keys(j), page: Object.keys(j.pages[0]), version: j.version, format: j.format }; };
  check('chiavi e versione del progetto invariate (format "gt-pdf-project", version 1)', JSON.stringify(keys(proj0)) === JSON.stringify(keys(proj1)) && keys(proj1).version === 1 && keys(proj1).format === 'gt-pdf-project', JSON.stringify(keys(proj1)));
  check('nel progetto non compaiono parole di snap', !/snap|grid|griglia|estremo|punto medio/i.test(proj1));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    await mouseSuite(browser);
    await pageSuite(browser);
    await touchSuite(browser);
    await exportSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
