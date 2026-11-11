// Prove di CP7c (V3.2a, Snap sul PDF: Estremo delle curve; misura in piu' su cerchi e archi) su Chromium, NELL'EDITOR e in Diagnostica: mouse (desktop 1280 x 900) e tocco emulato (390 x 780).
// Si prova, con i PDF di prova di public/test-pdfs aperti nell'editor: i 24 punti dei sei cerchi di drawSheet (scripts/make-test-pdfs.mjs) hanno il marcatore Estremo (quadrato, etichetta
// "Estremo") nel punto calcolato QUI con le coordinate del generatore e le formule del foglio (non con il codice dell'app), anche con /Rotate 90, CropBox, A3, annotazioni e nelle tre
// pagine di misto-3-pagine.pdf; nessun punto sui punti di controllo, a meta' degli archi, ne' al centro dei cerchi piccoli; una QUOTA e una DISTANZA fra due punti opposti di un cerchio
// (il diametro), dopo la calibrazione sul riferimento di 100 mm, uguali al valore atteso; interruttore «PDF» e Estremo (con «PDF» spento nessun aggancio su quei punti); un PDF di SOLE
// CURVE costruito qui si aggancia e non dice «assente»; curve in un livello spento: nessun aggancio; un raccordo fra due rette non da' due punti; la scheda «Geometria PDF» di
// Diagnostica e «Copia misura» mostrano le righe nuove (e nessun nome di file); tocco.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp7c.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 5d7b364 (senza l'Estremo delle curve) i controlli sulle curve FALLISCONO)
//   E2E_ONLY=cerchi,controllo,quota,interruttori,solocurve,livelli,raccordo,tocco,diag: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente (browser del PC o Safari/iPhone): nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7c', out: process.argv[2], port: 4242, hport: 4243, zoom: 2 });
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
/** Tolleranza (mm) del diametro: il valore e' scritto con due decimali. */
const MM_TOL = 0.01;

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

// ---------------------------------------------------------------- punti attesi (make-test-pdfs.mjs, drawSheet: sei cerchi)
/**
 * I sei cerchi di drawSheet per un foglio con riquadro visibile (x, y, w, h) nello spazio utente, con le stesse formule del generatore (righe 31-40): grande (raggio r), interno
 * (0.42 r), quattro piccoli (0.09 r) a 0.72 r dal centro. Ogni cerchio e' di 4 cubiche e i suoi punti di fine stanno sugli assi (sinistra, basso, destra, alto).
 */
function circles(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const list = [
    ['cerchio grande', cx, cy, r],
    ['cerchio interno', cx, cy, r * 0.42],
    ...[
      ['piccolo destro', 1, 0],
      ['piccolo sinistro', -1, 0],
      ['piccolo alto', 0, 1],
      ['piccolo basso', 0, -1],
    ].map(([name, dx, dy]) => [name, cx + dx * r * 0.72, cy + dy * r * 0.72, r * 0.09]),
  ];
  return { cx, cy, r, list };
}
const P = (x, y) => ({ x, y });
/** I 24 punti (4 per cerchio) nello spazio utente, con il nome. */
function circlePoints(box) {
  const c = circles(...box);
  const out = {};
  for (const [name, ccx, ccy, rr] of c.list) {
    out[`${name}, sinistra`] = P(ccx - rr, ccy);
    out[`${name}, basso`] = P(ccx, ccy - rr);
    out[`${name}, destra`] = P(ccx + rr, ccy);
    out[`${name}, alto`] = P(ccx, ccy + rr);
  }
  return out;
}
const SHEET_BOXES = {
  'A4 vettoriale': [0, 0, A4[0], A4[1]],
  'A3 vettoriale': [0, 0, A3L[0], A3L[1]],
  'A4 con /Rotate 90': [0, 0, A4[0], A4[1]],
  'A4 con CropBox': [50, 50, 400, 550],
  'A4 con annotazioni': [0, 0, A4[0], A4[1]],
};

// ---------------------------------------------------------------- serie 1: i punti dei cerchi (mouse)
async function circlesSuite(browser) {
  setSection('punti dei cerchi, mouse 1280x900');
  const { ctx, page, errors } = await desktop(browser);
  const doIt = async (title, box, pageNo, tag) => {
    const st = await openDoc(page, title, pageNo);
    await tool(page, 'Retta');
    const pts = circlePoints(box);
    let bad = [];
    let n = 0;
    for (const [what, u] of Object.entries(pts)) {
      const c = await clientOfUser(page, u);
      const m = await hoverMark(page, c);
      n++;
      const ok = !!m && m.kind === 'end' && m.label === 'Estremo' && m.shape === 'rect' && dist(m, c) < 0.75;
      if (!ok) bad.push(`${what}: ${JSON.stringify(m)} atteso end in (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
    }
    check(`${tag}: i ${n} punti dei sei cerchi (4 per cerchio) hanno il marcatore Estremo (quadrato, etichetta Estremo) nel punto giusto (entro 0.75 px)`, bad.length === 0, bad.slice(0, 3).join(' | '));
    if (title !== 'A4 con annotazioni') {
      check(`${tag}: lo stato dice 12 tratti, 24 cubiche, 44 Estremi (24 dovuti alle curve) e 11 Punti medi`, !!st && st.kind === 'ready' && st.segments === 12 && st.curves === 24 && st.nEnd === 44 && st.endsFromCurves === 24 && st.nMid === 11, JSON.stringify(st));
    } else {
      check(`${tag}: lo stato dice 24 cubiche e 24 Estremi dovuti alle curve (le annotazioni aggiungono solo tratti)`, !!st && st.kind === 'ready' && st.curves === 24 && st.endsFromCurves === 24 && st.nEnd > 44, JSON.stringify(st));
    }
    // il punto INSERITO e' quello del cerchio (spazio utente, Float32 di PDF.js: 1e-4)
    const probes = ['cerchio grande, sinistra', 'cerchio grande, alto', 'cerchio interno, destra', 'piccolo alto, basso'];
    for (const what of probes) {
      const u = pts[what];
      const s = await clientOfUser(page, u);
      await click(page, s, 3, -2);
      const far = await clientOfUser(page, { x: box[0] + box[2] * 0.12, y: box[1] + box[3] * 0.93 });
      await click(page, far, 0, 0);
      const objs = await objectsOf(page);
      const last = objs[objs.length - 1];
      check(`${tag}: ${what}: il primo punto inserito coincide con il punto del cerchio (entro ${USER_TOL} pt)`, last && last.kind === 'segment' && near(last.points[0].x, u.x, USER_TOL) && near(last.points[0].y, u.y, USER_TOL), JSON.stringify({ inserito: last?.points?.[0], atteso: u }));
    }
  };
  for (const [title, box] of Object.entries(SHEET_BOXES)) await doIt(title, box, 1, title);
  // tre pagine diverse (A4, A3 orizzontale, A4 /Rotate 90): ogni pagina ha i punti dei SUOI cerchi
  for (const [n, box] of [[1, [0, 0, A4[0], A4[1]]], [2, [0, 0, A3L[0], A3L[1]]], [3, [0, 0, A4[0], A4[1]]]]) {
    const file = FILE_OF['3 pagine miste'];
    if (n === 1) await loadNamed(page, file, readFileSync(join(PDF_DIR, file)));
    const st = await showFit(page, n);
    await tool(page, 'Retta');
    const pts = circlePoints(box);
    let bad = [];
    for (const [what, u] of Object.entries(pts)) {
      const c = await clientOfUser(page, u);
      const m = await hoverMark(page, c);
      if (!(!!m && m.kind === 'end' && dist(m, c) < 0.75)) bad.push(`${what}: ${JSON.stringify(m)}`);
    }
    check(`3 pagine miste, pagina ${n}: i 24 punti dei cerchi hanno il marcatore Estremo`, bad.length === 0, bad.slice(0, 3).join(' | '));
    check(`3 pagine miste, pagina ${n}: lo stato dice 24 cubiche e 44 Estremi`, !!st && st.kind === 'ready' && st.curves === 24 && st.nEnd === 44, JSON.stringify(st));
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 2: dove NON c'e' aggancio (nessuna interpretazione delle curve)
async function negativesSuite(browser) {
  setSection('nessun aggancio dove non c\'e\' un estremo');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  const box = SHEET_BOXES['A4 vettoriale'];
  const c = circles(...box);
  const kappa = 0.5522847498307936;
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 1280 x 900`);
  const probe = async (what, u, minPx = 11) => {
    const cl = await clientOfUser(page, u);
    const m = await hoverMark(page, cl);
    check(`${what}: nessun marcatore`, m === null, JSON.stringify(m));
    void minPx;
  };
  // punto a 45 gradi dell'arco del cerchio grande: sarebbe il Punto medio dell'arco, che NON c'e'
  await probe('meta\' dell\'arco del cerchio grande (45 gradi): nessun Punto medio delle curve', P(c.cx + c.r * Math.SQRT1_2, c.cy + c.r * Math.SQRT1_2));
  await probe('meta\' dell\'arco del cerchio grande (225 gradi)', P(c.cx - c.r * Math.SQRT1_2, c.cy - c.r * Math.SQRT1_2));
  // punto di controllo della prima cubica del cerchio grande (a kappa x r dal punto di fine): i punti di controllo non sono punti di snap
  await probe('punto di controllo di una cubica del cerchio grande', P(c.cx + c.r, c.cy + kappa * c.r));
  await probe('altro punto di controllo di una cubica del cerchio grande', P(c.cx - c.r, c.cy - kappa * c.r));
  // il centro del cerchio interno e' un incrocio degli assi (Punto medio dei tratti), non un Centro: qui si prova il Centro di un cerchio piccolo (se dista dai suoi punti di fine > 10.5 px)
  const small = c.list[2];
  const centerOfSmall = P(small[1], small[2]);
  const dpx = small[3] * k;
  if (dpx > 10.8) {
    await probe(`centro di un cerchio piccolo (a ${dpx.toFixed(1)} px dai suoi punti di fine): nessun Centro`, centerOfSmall);
  } else info(`centro del cerchio piccolo a ${dpx.toFixed(1)} px dai suoi punti di fine: dentro il raggio del mouse, prova saltata`);
  // il raggio del mouse vale anche per i punti delle curve: 9.5 px si aggancia, 10.5 no
  const pt = circlePoints(box)['cerchio grande, destra'];
  const cl = await clientOfUser(page, pt);
  let m = await hoverMark(page, cl, 9.5, 0);
  check('a 9.5 px da un punto del cerchio grande si aggancia (Estremo)', !!m && m.kind === 'end', JSON.stringify(m));
  m = await hoverMark(page, cl, 10.5, 0);
  check('a 10.5 px da un punto del cerchio grande non si aggancia', m === null, JSON.stringify(m));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 3: quota e distanza fra due punti opposti di un cerchio
async function quoteSuite(browser) {
  setSection('quota fra due punti opposti di un cerchio');
  for (const [title, box] of Object.entries(SHEET_BOXES)) {
    if (title === 'A4 con annotazioni') continue;
    const { ctx, page, errors } = await desktop(browser);
    await openDoc(page, title);
    const c = circles(...box);
    const pts = circlePoints(box);
    // calibrazione sul riferimento di 100 mm: i suoi due estremi sono Estremi dei tratti del PDF (come in e2e-cp7b)
    const ry = box[1] + 62;
    const rx = box[0] + 28;
    await tool(page, 'Scala');
    await click(page, await clientOfUser(page, P(rx, ry)), 2, -2);
    await click(page, await clientOfUser(page, P(rx + 100 * MM, ry)), -2, 2);
    await page.waitForSelector('.dialog');
    await page.locator('.dialog .dlg-fields input').fill('100');
    await page.locator('.dialog .btn.primary').click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    const scaleLbl = (await page.locator('.st-scale-btn').innerText()).trim();
    check(`${title}: la scala e' 1:1 (il riferimento e' di 100 mm)`, /^1[:.]/.test(scaleLbl), scaleLbl);
    const wantMm = ((2 * c.r) * 25.4) / 72; // diametro del cerchio grande in mm
    // Distanza (messaggio di stato) fra i due punti opposti, in orizzontale e in verticale
    await tool(page, 'Distanza');
    for (const [what, a, b] of [
      ['orizzontale (sinistra-destra)', 'cerchio grande, sinistra', 'cerchio grande, destra'],
      ['verticale (basso-alto)', 'cerchio grande, basso', 'cerchio grande, alto'],
    ]) {
      await click(page, await clientOfUser(page, pts[a]), 3, -3);
      await click(page, await clientOfUser(page, pts[b]), -3, 3);
      await page.waitForTimeout(150);
      const msg = await status(page);
      const got = parseFloat((/Distanza ([\d.]+) mm/.exec(msg) || [])[1]);
      check(`${title}: Distanza ${what} del cerchio grande = diametro ${wantMm.toFixed(2)} mm entro ${MM_TOL} mm`, Math.abs(got - wantMm) <= MM_TOL, `${msg} (atteso ${wantMm.toFixed(4)})`);
    }
    // Quota allineata fra i due punti opposti (diametro orizzontale)
    const pa = pts['cerchio grande, sinistra'];
    const pb = pts['cerchio grande, destra'];
    await tool(page, 'Quota');
    await click(page, await clientOfUser(page, pa), 3, -3);
    await click(page, await clientOfUser(page, pb), -3, 3);
    await click(page, await clientOfUser(page, { x: box[0] + box[2] * 0.5, y: box[1] + box[3] * 0.93 }), 0, 0);
    await page.keyboard.press('Enter'); // conferma il valore automatico della quota
    await page.waitForTimeout(120);
    const st = await page.evaluate(() => window.__gtpdf.state().pages[0]);
    const dim = st.objects.find((o) => o.kind === 'dim');
    check(`${title}: la quota fra i due punti del cerchio e' stata inserita`, !!dim, JSON.stringify(st.objects.map((o) => o.kind)));
    if (dim) {
      check(`${title}: i due punti della quota sono i punti del cerchio (entro ${USER_TOL} pt)`, near(dim.p1.x, pa.x, USER_TOL) && near(dim.p1.y, pa.y, USER_TOL) && near(dim.p2.x, pb.x, USER_TOL) && near(dim.p2.y, pb.y, USER_TOL), JSON.stringify({ p1: dim.p1, p2: dim.p2, pa, pb }));
      const txt = (st.texts.flat() || []).join(' ');
      const val = parseFloat((/(\d+[.,]\d+)/.exec(txt) || [])[1]?.replace(',', '.'));
      info(`${title}: diametro ${(2 * c.r).toFixed(3)} pt = ${wantMm.toFixed(4)} mm attesi; la quota dice "${txt}"`);
      check(`${title}: il valore della quota e' uguale al diametro atteso (${wantMm.toFixed(2)} mm) entro ${MM_TOL} mm`, Math.abs(val - wantMm) <= MM_TOL, `quota ${val}, attesi ${wantMm.toFixed(4)}`);
    }
    check(`${title}: nessun errore di pagina`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- serie 4: interruttori «PDF» e Estremo
async function togglesSuite(browser) {
  setSection('interruttori PDF ed Estremo sui punti dei cerchi');
  const { ctx, page, errors } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  const box = SHEET_BOXES['A4 vettoriale'];
  const pts = circlePoints(box);
  // un oggetto disegnato lontano dai punti del PDF: la sua estremita' deve agganciarsi sempre
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.62, 0.30], [0.9, 0.25]] }]));
  await page.waitForTimeout(150);
  const ownEnd = await clientOfUser(page, P(595.276 * 0.62, 841.89 * 0.3));
  const circPt = await clientOfUser(page, pts['cerchio grande, destra']);
  const smallPt = await clientOfUser(page, pts['piccolo alto, alto']);
  let m = await hoverMark(page, circPt);
  check('PDF acceso: Estremo su un punto del cerchio grande', !!m && m.kind === 'end' && dist(m, circPt) < 0.75, JSON.stringify(m));
  const bar = barToggle(page, 'pdf');
  await bar.click();
  await page.waitForTimeout(80);
  check('PDF spento: il messaggio lo dice', /PDF disattivato/.test(await status(page)), await status(page));
  m = await hoverMark(page, circPt);
  check('PDF spento: nessun aggancio sul punto del cerchio grande', m === null, JSON.stringify(m));
  m = await hoverMark(page, smallPt);
  check('PDF spento: nessun aggancio sul punto di un cerchio piccolo', m === null, JSON.stringify(m));
  m = await hoverMark(page, ownEnd);
  check('PDF spento: l\'aggancio sull\'oggetto disegnato resta', !!m && m.kind === 'end' && dist(m, ownEnd) < 0.75, JSON.stringify(m));
  await bar.click();
  await page.waitForTimeout(80);
  check('PDF acceso: messaggio "PDF attivo"', /PDF attivo/.test(await status(page)), await status(page));
  m = await hoverMark(page, circPt);
  check('PDF di nuovo acceso: l\'Estremo sul punto del cerchio torna', !!m && m.kind === 'end' && dist(m, circPt) < 0.75, JSON.stringify(m));
  // Estremo spento: l'Estremo del PDF (anche quello delle curve) non c'e'
  await barToggle(page, 'end').click();
  await page.waitForTimeout(60);
  m = await hoverMark(page, circPt);
  check('Estremo spento (PDF acceso): nessun aggancio sul punto del cerchio', m === null, JSON.stringify(m));
  await barToggle(page, 'end').click();
  await page.waitForTimeout(60);
  // Punto medio spento: resta l'Estremo delle curve
  await barToggle(page, 'mid').click();
  await page.waitForTimeout(60);
  m = await hoverMark(page, circPt);
  check('Punto medio spento (PDF acceso): resta l\'Estremo sul punto del cerchio', !!m && m.kind === 'end' && dist(m, circPt) < 0.75, JSON.stringify(m));
  await barToggle(page, 'mid').click();
  await page.waitForTimeout(60);
  // il titolo del pulsante parla anche delle curve; il file progetto resta alla versione 4
  const title = await bar.getAttribute('title');
  check('il titolo del pulsante PDF cita ancora Estremo e Punto medio e ora anche le curve', /Estremo e Punto medio/.test(title) && /curve/.test(title), title);
  const proj = await page.evaluate(async () => JSON.parse((await window.__gtpdf.projectText()).text));
  check('il file progetto resta alla versione 4 e non contiene i punti del PDF', proj.version === 4 && JSON.stringify(proj).length < 5000, `versione ${proj.version}`);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- PDF sintetici (costruiti qui, mai in public/)
/** Pagina 600 x 800 con solo CERCHI (pdf-lib drawCircle: 4 cubiche l'uno): tre cerchi, nessun tratto rettilineo. */
async function onlyCirclesPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage([600, 800]);
  for (const [x, y, r] of [[150, 600, 50], [400, 400, 80], [250, 150, 30]]) pg.drawCircle({ x, y, size: r, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  return doc.save({ useObjectStreams: false });
}
const ONLY_CIRCLES = [[150, 600, 50], [400, 400, 80], [250, 150, 30]];
/** PDF con contenuto scritto a mano (operatori) e, a richiesta, livelli (OCG acceso e spento). */
async function contentPdf(content, { layers = false, size = [600, 800] } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage(size);
  const c = doc.context;
  if (layers) {
    const ocgOn = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('acceso') }));
    const ocgOff = c.register(c.obj({ Type: 'OCG', Name: PDFString.of('spento') }));
    doc.catalog.set(PDFName.of('OCProperties'), c.obj({ OCGs: [ocgOn, ocgOff], D: { Order: [ocgOn, ocgOff], ON: [ocgOn], OFF: [ocgOff] } }));
    pg.node.set(PDFName.of('Resources'), c.obj({ Properties: { On: ocgOn, Off: ocgOff } }));
  } else pg.node.set(PDFName.of('Resources'), c.obj({}));
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  return doc.save({ useObjectStreams: false });
}
const KAPPA = 0.5522847498307936;
/** Cerchio di centro (x, y) e raggio r scritto con operatori m e c (4 cubiche, h): i punti di fine stanno sugli assi. */
function circleOps(x, y, r) {
  const k = KAPPA * r;
  const f = (v) => v.toFixed(4);
  return [
    `${f(x + r)} ${f(y)} m`,
    `${f(x + r)} ${f(y + k)} ${f(x + k)} ${f(y + r)} ${f(x)} ${f(y + r)} c`,
    `${f(x - k)} ${f(y + r)} ${f(x - r)} ${f(y + k)} ${f(x - r)} ${f(y)} c`,
    `${f(x - r)} ${f(y - k)} ${f(x - k)} ${f(y - r)} ${f(x)} ${f(y - r)} c`,
    `${f(x + k)} ${f(y - r)} ${f(x + r)} ${f(y - k)} ${f(x + r)} ${f(y)} c`,
    'h S',
  ].join('\n');
}
const circleEnds = (x, y, r) => [P(x + r, y), P(x, y + r), P(x - r, y), P(x, y - r)];

// ---------------------------------------------------------------- serie 5: una pagina di SOLE CURVE
async function onlyCurvesSuite(browser) {
  setSection('pagina di sole curve');
  const { ctx, page, errors } = await desktop(browser);
  const bytes = await onlyCirclesPdf();
  await loadNamed(page, 'sole-curve.pdf', bytes);
  const note = await status(page); // il messaggio della pagina (prima di scegliere uno strumento)
  const st = await showFit(page);
  await tool(page, 'Retta');
  check('sole curve: lo stato e\' "pronto" e non "assente" (0 tratti, 12 cubiche, 12 Estremi, 0 Punti medi)', !!st && st.kind === 'ready' && st.segments === 0 && st.curves === 12 && st.nEnd === 12 && st.nMid === 0, JSON.stringify(st));
  check('sole curve: la riga dei messaggi NON dice che non ci sono linee da agganciare', !/nessuna linea|da agganciare nel PDF|assente/i.test(note), note);
  let bad = [];
  let n = 0;
  for (const [x, y, r] of ONLY_CIRCLES) {
    for (const u of circleEnds(x, y, r)) {
      const c = await clientOfUser(page, u);
      const m = await hoverMark(page, c);
      n++;
      if (!(!!m && m.kind === 'end' && m.label === 'Estremo' && dist(m, c) < 0.75)) bad.push(JSON.stringify({ u, m }));
    }
  }
  check(`sole curve: i ${n} punti dei tre cerchi si agganciano (Estremo, punto giusto)`, bad.length === 0, bad.slice(0, 3).join(' | '));
  // nessun Punto medio ne' Centro
  const centre = await clientOfUser(page, P(400, 400));
  const m = await hoverMark(page, centre);
  check('sole curve: al centro di un cerchio non c\'e\' nessun aggancio (nessun Centro, nessun Punto medio)', m === null, JSON.stringify(m));
  // messaggio con l'interruttore PDF acceso: ancora nessuna frase "assente"
  const b = barToggle(page, 'pdf');
  await b.click();
  await b.click();
  await page.waitForTimeout(80);
  const t = await status(page);
  check('sole curve: acceso l\'interruttore PDF il messaggio e\' "PDF attivo" senza «nessuna linea»', /PDF attivo/.test(t) && !/nessuna linea|assente/i.test(t), t);
  // registro di Diagnostica: pronto, con gli Estremi dovuti alle curve, senza il nome del file
  const log = await diagLog(page);
  const lines = log.split('\n').filter((l) => /Snap PDF/.test(l));
  check('registro: "Snap PDF, pagina 1: pronto, 0 estremi e 0 punti medi da 0 tratti; curve: 12 estremi da 12 cubiche (12 estremi in tutto)" senza nome del file', lines.length === 1 && /Snap PDF, pagina 1: pronto, 0 estremi e 0 punti medi da 0 tratti; curve: 12 estremi da 12 cubiche \(12 estremi in tutto\) \(/.test(lines[0]) && !/sole-curve|\.pdf/i.test(lines[0]), JSON.stringify(lines));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
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

// ---------------------------------------------------------------- serie 6: curve in livelli spenti
async function layersSuite(browser) {
  setSection('curve in livelli spenti');
  const { ctx, page, errors } = await desktop(browser);
  // livello acceso: cerchio A; spento: cerchio B; fuori dai livelli: cerchio C; spento dentro acceso: D; acceso dentro spento: E
  const A = [150, 600, 50];
  const B = [150, 400, 50];
  const C = [400, 200, 50];
  const D = [400, 600, 50];
  const E = [400, 400, 50];
  const content = [
    '2 w 0 0 0 RG',
    `/OC /On BDC ${circleOps(...A)} EMC`,
    `/OC /Off BDC ${circleOps(...B)} EMC`,
    circleOps(...C),
    `/OC /On BDC /OC /Off BDC ${circleOps(...D)} EMC EMC`,
    `/OC /Off BDC /OC /On BDC ${circleOps(...E)} EMC EMC`,
  ].join('\n');
  await loadNamed(page, 'livelli-curve.pdf', await contentPdf(content, { layers: true }));
  const st = await showFit(page);
  await tool(page, 'Retta');
  check('livelli: pronto con 8 cubiche visibili (acceso e fuori dai livelli): 8 Estremi e nessun tratto', !!st && st.kind === 'ready' && st.segments === 0 && st.curves === 8 && st.nEnd === 8 && st.nMid === 0, JSON.stringify(st));
  const probeSet = async (what, circle, want) => {
    let bad = [];
    for (const u of circleEnds(...circle)) {
      const cl = await clientOfUser(page, u);
      const m = await hoverMark(page, cl);
      const ok = want ? !!m && m.kind === 'end' && dist(m, cl) < 0.75 : m === null;
      if (!ok) bad.push(JSON.stringify({ u, m }));
    }
    check(`livelli: ${what}`, bad.length === 0, bad.slice(0, 2).join(' | '));
  };
  await probeSet('i 4 punti del cerchio nel livello ACCESO: aggancio', A, true);
  await probeSet('i 4 punti del cerchio fuori dai livelli: aggancio', C, true);
  await probeSet('i 4 punti del cerchio nel livello SPENTO: nessun aggancio', B, false);
  await probeSet('spento DENTRO acceso: nessun aggancio', D, false);
  await probeSet('acceso DENTRO spento: nessun aggancio', E, false);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // curve SOLO in un livello spento: stato "assente" per livelli spenti, con il messaggio che lo dice
  const c2 = await desktop(browser);
  await loadNamed(c2.page, 'solo-spento.pdf', await contentPdf(`/OC /Off BDC ${circleOps(...B)} EMC`, { layers: true }));
  const note = await status(c2.page);
  const st2 = await showFit(c2.page);
  await tool(c2.page, 'Retta');
  check('curve solo in un livello spento: stato "assente" (livelli spenti) con le 4 cubiche lette', !!st2 && st2.kind === 'absent' && st2.why === 'hidden' && st2.curves === 4, JSON.stringify(st2));
  const b = barToggle(c2.page, 'pdf');
  await b.click();
  await b.click();
  await c2.page.waitForTimeout(80);
  const t = await status(c2.page);
  check('curve solo in un livello spento: il messaggio dice che sono in livelli spenti', /livelli spenti/.test(t) && /Gli oggetti disegnati si agganciano come sempre/.test(t), `${note} || ${t}`);
  const cl = await clientOfUser(c2.page, circleEnds(...B)[0]);
  const m = await hoverMark(c2.page, cl);
  check('curve solo in un livello spento: nessun aggancio', m === null, JSON.stringify(m));
  check('nessun errore di pagina', c2.errors.length === 0, c2.errors.join(' | '));
  await c2.ctx.close();
}

// ---------------------------------------------------------------- serie 7: raccordo fra due rette e catena aperta
async function filletSuite(browser) {
  setSection('raccordo fra due rette e arco aperto');
  const { ctx, page, errors } = await desktop(browser);
  // retta (100,100)-(200,100), cubica (200,100)-(230,130), retta (230,130)-(230,200); arco aperto di 2 cubiche (300,300)-(400,300)-(450,350)
  const content = ['2 w 0 0 0 RG', '100 100 m 200 100 l 220 100 230 110 230 130 c 230 200 l S', '300 300 m 300 350 350 400 400 400 c 450 400 500 350 500 300 c S'].join('\n');
  await loadNamed(page, 'raccordo.pdf', await contentPdf(content));
  const st = await showFit(page);
  await tool(page, 'Retta');
  // Estremi: 4 del raccordo (i due punti di contatto sono UNO solo: gia' Estremi delle rette) + 3 dell'arco (inizio, giunto, fine)
  check('raccordo e arco: 2 tratti, 3 cubiche, 7 Estremi (di cui 3 dovuti alle curve) e 2 Punti medi', !!st && st.kind === 'ready' && st.segments === 2 && st.curves === 3 && st.nEnd === 7 && st.endsFromCurves === 3 && st.nMid === 2, JSON.stringify(st));
  let bad = [];
  for (const [what, u] of [
    ['inizio della prima retta', P(100, 100)],
    ['contatto retta-cubica', P(200, 100)],
    ['contatto cubica-retta', P(230, 130)],
    ['fine della seconda retta', P(230, 200)],
    ['inizio dell\'arco', P(300, 300)],
    ['giunto dell\'arco (le due cubiche)', P(400, 400)],
    ['fine dell\'arco', P(500, 300)],
  ]) {
    const c = await clientOfUser(page, u);
    const m = await hoverMark(page, c);
    if (!(!!m && m.kind === 'end' && dist(m, c) < 0.75)) bad.push(`${what}: ${JSON.stringify(m)}`);
  }
  check('raccordo e arco: i 7 punti (compresi i due di contatto e il giunto dell\'arco) hanno il marcatore Estremo', bad.length === 0, bad.join(' | '));
  const mid = await clientOfUser(page, P(150, 100));
  const m = await hoverMark(page, mid);
  check('il Punto medio della retta c\'e\' ancora e quello della curva no (a meta\' dell\'arco nessun marcatore)', !!m && m.kind === 'mid' && dist(m, mid) < 0.75, JSON.stringify(m));
  const arcMid = await clientOfUser(page, P(350.5, 387.5));
  const m2 = await hoverMark(page, arcMid);
  check('a meta\' della prima cubica dell\'arco: nessun marcatore', m2 === null, JSON.stringify(m2));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 8: tocco (390 x 780)
async function touchSuite(browser) {
  setSection('tocco 390x780');
  const { ctx, page, cdp, errors } = await phone(browser);
  await openDoc(page, 'A4 vettoriale');
  await tool(page, 'Retta');
  const box = SHEET_BOXES['A4 vettoriale'];
  const pts = circlePoints(box);
  const k = await zoomPx(page);
  info(`zoom di adattamento ${k.toFixed(3)} px/pt a 390 px`);
  const target = pts['cerchio grande, sinistra'];
  const s = await clientOfUser(page, target);
  await touch(cdp, 'touchStart', [[s.x + 4, s.y + 14]]);
  await page.waitForTimeout(120);
  let m = await snapMark(page);
  check('tocco: a 15 px da un punto del cerchio grande compare il marcatore Estremo nel punto giusto (raggio del dito 22 px)', !!m && m.kind === 'end' && m.label === 'Estremo' && dist(m, s) < 0.75, JSON.stringify(m));
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  const far = await clientOfUser(page, { x: 300, y: 300 });
  await touch(cdp, 'touchStart', [[far.x, far.y]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  const objs = await objectsOf(page);
  const last = objs[objs.length - 1];
  check('tocco: il primo punto inserito coincide con il punto del cerchio', last && last.kind === 'segment' && near(last.points[0].x, target.x, USER_TOL) && near(last.points[0].y, target.y, USER_TOL), JSON.stringify(last?.points?.[0]));
  await touch(cdp, 'touchStart', [[s.x, s.y + 23.5]]);
  await page.waitForTimeout(100);
  m = await snapMark(page);
  check('tocco: a 23.5 px da un punto del cerchio non si aggancia a quel punto', m === null || dist(m, s) > 1, JSON.stringify(m));
  await touch(cdp, 'touchCancel', []);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- serie 9: Diagnostica, scheda "Geometria PDF" e "Copia misura"
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
/** La composizione nota della misura (stessa degli unitari di src/pdf/geometryShapes.test.ts): arco aperto di 4 cubiche con chiusura a 2e-3, raccordo, cerchio chiuso, lunghezza 0 e 0.005. */
const MEASURE_CONTENT = [
  '250 200 m 250 227.614 227.614 250 200 250 c 172.386 250 150 227.614 150 200 c 150 172.386 172.386 150 200 150 c 227.614 150 250 172.386 250.002 200 c S',
  '10 10 m 100 10 l 110 10 120 20 120 30 c 120 100 l S',
  '400 200 m 400 227.614 377.614 250 350 250 c 322.386 250 300 227.614 300 200 c 300 172.386 322.386 150 350 150 c 377.614 150 400 172.386 400 200 c h S',
  '50 300 m 50 300 l S',
  '60 300 m 60.005 300 l S',
].join('\n');
async function diagSuite(browser, kind) {
  setSection(`scheda Geometria PDF e Copia misura, ${kind === 'phone' ? '390 x 780' : '1280 x 900'}`);
  const { ctx, page, errors } = await newDiag(browser, kind);
  const name = `${SECRET}-misura.pdf`;
  await diagLoad(page, name, await contentPdf(MEASURE_CONTENT, { size: [600, 400] }));
  await geoPress(page, 'Misura questa pagina');
  const detail = await page.locator('.geo-detail').innerText();
  const has = (re) => re.test(detail);
  check('scheda: riga "segmenti rettilinei dei candidati sotto 0.01 pt utente, divisi" con lunghezza esattamente 0: 1 e fra 0 (escluso) e 0.01: 1', has(/^segmenti rettilinei dei candidati sotto 0\.01 pt utente, divisi: lunghezza esattamente 0: 1 · fra 0 \(escluso\) e 0\.01: 1$/m), '');
  check('scheda: riga delle corde delle cubiche (9 cubiche) e corda esattamente 0: 0', has(/^corde delle cubiche dei candidati \(distanza fra primo e ultimo punto, pt utente; le quadratiche non entrano\): sotto 0\.01: 0 ·/m) && has(/^corde delle cubiche dei candidati sotto 0\.01 pt utente, divise: lunghezza esattamente 0: 0 · fra 0 \(escluso\) e 0\.01: 0$/m), '');
  check('scheda: aperti di sole cubiche, candidati: 4: 1 (cubiche che contengono: 4)', has(/^sottopercorsi APERTI di sole cubiche, candidati, per numero di cubiche: 1: 0 · 2: 0 · 3: 0 · 4: 1 · 5-8: 0 · oltre 8: 0 \(cubiche che contengono: 4\)$/m), '');
  check('scheda: aperti misti, candidati: 1 sottopercorso (1 cubica, 2 lineTo); chiusi misti: 0', has(/^sottopercorsi APERTI misti \(cubiche e lineTo o quadratiche\), candidati: 1 \(cubiche 1, lineTo 2, quadratiche 0\);/m) && has(/^sottopercorsi CHIUSI misti \(cubiche e lineTo o quadratiche\), candidati: 0 /m), '');
  check('scheda: il conto delle cubiche torna (candidati e tutti i percorsi), anche per le aperte (5 = 4 + 1)', has(/^conto delle cubiche, candidati: .* = 9; cubiche dei percorsi 9 \(il conto torna\)$/m) && has(/^conto delle cubiche, tutti i percorsi: .* = 9; cubiche dei percorsi 9 \(il conto torna\)$/m) && has(/^conto delle cubiche in sottopercorsi aperti, candidati: .* = 5; riga "cubiche in sottopercorsi aperti" 5 \(il conto torna\)$/m), '');
  check('scheda: 4 cubiche, candidati: 2 sottopercorsi (aperti 1), distanze: fino a 0.0001: 1 · fino a 0.005: 1', has(/^sottopercorsi di sole cubiche con 4 cubiche \(aperti o chiusi\), candidati: 2 \(aperti 1\); distanza fra ultimo e primo punto \(pt utente\): fino a 0\.0001: 1 · fino a 0\.001: 0 · fino a 0\.005: 1 · fino a 0\.05: 0 · fino a 0\.5: 0 · oltre 0\.5: 0$/m), '');
  check('scheda: regola del cerchio senza la condizione di chiusura: 2 su 2', has(/^di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, candidati: 2 su 2 \(/m), '');
  check('scheda: le righe di CP7a restano (cubiche in sottopercorsi aperti: 5; di 4 cubiche che rispettano la regola del cerchio: 1)', has(/^cubiche in sottopercorsi aperti, candidati: 5$/m) && has(/^di 4 cubiche che rispettano la regola del cerchio, candidati: 1 \(/m), '');
  check('scheda: le definizioni sono scritte nella scheda (aperto, chiuso, di sole cubiche, misto)', /aperto.*chiuso.*di sole cubiche.*misto/s.test(await page.locator('.geo-defs').innerText()), '');
  // Copia misura: le righe nuove ci sono, nessun nome di file
  await geoBtn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const text = await page.evaluate(() => window.__copied.at(-1));
  const lines = text.split('\n');
  for (const [what, re] of [
    ['segmenti sotto 0.01 divisi', /^segmenti rettilinei dei candidati sotto 0\.01 pt utente, divisi:/m],
    ['corde delle cubiche', /^corde delle cubiche dei candidati/m],
    ['corda minima e massima', /^corda minima e massima delle cubiche dei candidati/m],
    ['aperti di sole cubiche', /^sottopercorsi APERTI di sole cubiche, tutti i percorsi/m],
    ['aperti misti', /^sottopercorsi APERTI misti .*candidati/m],
    ['chiusi misti per lineTo', /^sottopercorsi CHIUSI misti, candidati, per numero di lineTo:/m],
    ['4 cubiche', /^sottopercorsi di sole cubiche con 4 cubiche \(aperti o chiusi\), candidati:/m],
    ['distanza minima e massima', /^distanza minima e massima fra ultimo e primo punto/m],
    ['regola senza chiusura', /^di 4 cubiche che rispettano la regola del cerchio SENZA la condizione di chiusura, tutti i percorsi:/m],
  ]) check(`Copia misura: riga nuova presente (${what})`, re.test(text), '');
  check('Copia misura: NON contiene il nome del file', !text.includes(SECRET) && !/\.pdf/i.test(text), '');
  check('Copia misura: una voce per riga, nessuna riga vuota, numeri sempre con il punto', lines.every((l) => l.trim().length > 0 && /[:·]/.test(l)) && !/\d,\d/.test(text), '');
  check('Copia misura: ogni riga della scheda e\' anche nel testo copiato (stesso dettaglio)', detail.split('\n').every((l) => text.includes(l)), '');
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('nessuno scorrimento orizzontale della pagina Diagnostica', sw.sw <= sw.iw, JSON.stringify(sw));
  // pagina senza cubiche (il riferimento di CP7a): le righe nuove ci sono con zeri
  const flat = await contentPdf('10 10 m 100 10 l S', { size: [200, 100] });
  await diagLoad(page, 'senza-curve.pdf', flat);
  await geoPress(page, 'Misura questa pagina');
  const d2 = await page.locator('.geo-detail').innerText();
  check('pagina senza cubiche: corda minima "nessuna cubica", distanza "nessuno", conto 0 che torna', /^corda minima e massima delle cubiche dei candidati \(pt utente\): nessuna cubica$/m.test(d2) && /^distanza minima e massima fra ultimo e primo punto .*candidati \(pt utente\): nessuno$/m.test(d2) && /= 0; cubiche dei percorsi 0 \(il conto torna\)/.test(d2), '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
const SUITES = {
  cerchi: circlesSuite,
  controllo: negativesSuite,
  quota: quoteSuite,
  interruttori: togglesSuite,
  solocurve: onlyCurvesSuite,
  livelli: layersSuite,
  raccordo: filletSuite,
  tocco: touchSuite,
  diag: (browser) => diagSuite(browser, 'desktop'),
  diagphone: (browser) => diagSuite(browser, 'phone'),
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
