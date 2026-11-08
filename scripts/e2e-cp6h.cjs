// Prove di CP6h (Raccordo, V2c) su Chromium: lo strumento dal menu Inserisci alla conferma con il tastierino, le quattro combinazioni di clic su due Rette, estremi di Linee, lo spigolo di una
// Linea (spezzata in due), i rifiuti con il messaggio, raggio in mm reali (con scala) e in mm del foglio (senza), ultimo raggio come valore proposto, Annulla e Ripeti, strumento che
// resta armato, progetto (versione 4, riapertura, fixture scritto da b3d8646), esportazione in entrambe le modalita' con continuita' dell'inchiostro nei punti di tangenza e barra
// contestuale a 390 x 780 a tutti i livelli di A+ (14, 16, 18, 20, 22 px; 22 e' il massimo).
// Mouse (desktop 1280 x 900, clic reali) e tocco emulato (iPhone 390 x 780, DPR 3, CDP) su tre pagine: A4 vettoriale, A4 con /Rotate 90, A4 con CropBox.
// Valori ESATTI: punti di tangenza, centro e punto sull'arco si calcolano QUI, nel foglio mostrato (pt fisici, Y in giu'), con una costruzione indipendente dall'app (il centro e' l'incrocio
// delle due rette spostate di R verso l'altra parte; i punti di tangenza sono i piedi delle perpendicolari dal centro) a partire dalle rette create e dalla parte scelta con i clic.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6h.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su b3d8646 i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=menu,rette,linee,scala,armato,progetto,export,barra,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li'.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6h', out: process.argv[2], port: 4234, hport: 4235, zoom: 2 });
const { OUT, check, info, setSection, URL: APP_URL, openSample, HPORT, ZOOM, b64, showPage, shot, newApp } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
const DEG = Math.PI / 180;
const MM = 72 / 25.4; // pt del foglio per mm
const SAMPLES = [
  ['A4 vettoriale', 'a4-vettoriale.pdf'],
  ['A4 con /Rotate 90', 'a4-rotate90.pdf'],
  ['A4 con CropBox', 'a4-cropbox.pdf'],
];
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const FIXTURE_V4 = join(__dirname, '..', 'src', 'project', 'fixtures', 'project-v4-b3d8646.json');
const RED = { style: 'solid', color: '#D32F2F', widthPt: 1 };
const BLUE = { style: 'dashed', color: '#1565C0', widthPt: 2.5 };
const BLACK2 = { style: 'solid', color: '#000000', widthPt: 2 };

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
async function phone(browser, w = 390, h = 780, uiSize = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((u) => localStorage.setItem('gtpdf.uiSize', String(u)), uiSize);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, cdp };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const lastObj = async (page) => (await objectsOf(page)).at(-1);
const undo = async (page) => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
};
const redo = async (page) => {
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(80);
};
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);
const kpText = (page, sel) => page.locator(`.keypad ${sel}`).first().textContent();
const canon = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const modeOf = (page) => page.evaluate(() => window.__gtpdf.view().mode);
const previewCount = (page) => page.evaluate(() => document.querySelector('.sc-preview')?.children.length ?? 0);
const selCount = (page) => page.evaluate(() => document.querySelector('.sc-sel')?.children.length ?? 0);
const hlCount = (page) => page.evaluate(() => document.querySelector('.sc-hl')?.children.length ?? 0);

/** Geometria della pagina 1 (come e2e-cp6g): le stesse formule di `PageGeometry`. */
function makeGeom(inf) {
  const [x0, y0, x1, y1] = inf.view;
  const sU = inf.userUnit > 0 ? inf.userUnit : 1;
  const rot = (((inf.rotate % 360) + 360) % 360) | 0;
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
let G = null;
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const sheetOfClient = async (page, c) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: (c.x - r.left) / k, y: (c.y - r.top) / k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
const sh = (u) => G.userToSheet(u);
const us = (s) => G.sheetToUser(s);
const pt = (x, y) => ({ x, y });

// ---- geometria indipendente (foglio mostrato, pt fisici, Y in giu')
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cr = (a, b) => a.x * b.y - a.y * b.x;
const dt = (a, b) => a.x * b.x + a.y * b.y;
const unit = (a) => ({ x: a.x / Math.hypot(a.x, a.y), y: a.y / Math.hypot(a.x, a.y) });
const neg = (a) => ({ x: -a.x, y: -a.y });
/** Direzione sul foglio a `deg` gradi sopra l'asse X (antiorario come si vede). */
const dirS = (deg) => ({ x: Math.cos(deg * DEG), y: -Math.sin(deg * DEG) });
const alongS = (from, u, d) => ({ x: from.x + u.x * d, y: from.y + u.y * d });
const angleBetween = (a, b) => Math.atan2(Math.abs(cr(a, b)), dt(a, b)) / DEG;
/** Il raccordo di raggio R fra due rette per V, dalla parte dei versori u1 e u2 (costruzione indipendente: rette spostate di R, piedi delle perpendicolari). */
function expectFillet(V, u1, u2, R) {
  const perp = (a) => ({ x: -a.y, y: a.x });
  let n1 = perp(u1);
  if (dt(n1, u2) < 0) n1 = neg(n1);
  let n2 = perp(u2);
  if (dt(n2, u1) < 0) n2 = neg(n2);
  const det = n1.x * n2.y - n1.y * n2.x;
  const w = { x: (R * n2.y - R * n1.y) / det, y: (n1.x * R - n2.x * R) / det };
  const C = { x: V.x + w.x, y: V.y + w.y };
  const foot = (u) => alongS(V, u, dt(sub(C, V), u));
  return { C, T1: foot(u1), T2: foot(u2), M: alongS(C, unit(sub(V, C)), R), theta: angleBetween(u1, u2) };
}
/** Centro e raggio del cerchio per tre punti. */
function circum(p1, p2, p3) {
  const ax = p2.x - p1.x, ay = p2.y - p1.y, bx = p3.x - p1.x, by = p3.y - p1.y;
  const d = 2 * (ax * by - ay * bx);
  const ux = (by * (ax * ax + ay * ay) - ay * (bx * bx + by * by)) / d;
  const uy = (ax * (bx * bx + by * by) - bx * (ax * ax + ay * ay)) / d;
  return { c: { x: p1.x + ux, y: p1.y + uy }, r: Math.hypot(ux, uy) };
}

// ---- pagina di prova
async function openDoc(page, title = 'A4 vettoriale') {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
}
const fsheet = (fx, fy) => ({ x: fx * G.width, y: fy * G.height });
async function addSeg(page, a, b, stroke = RED) {
  await page.evaluate(([pts, s]) => window.__gtpdf.add(1, [{ kind: 'segment', points: pts, stroke: s }]), [[us(a), us(b)], stroke]);
  return lastObj(page);
}
async function addPoly(page, pts, stroke = RED) {
  await page.evaluate(([p, s]) => window.__gtpdf.add(1, [{ kind: 'polyline', points: p, stroke: s }]), [pts.map(us), stroke]);
  return lastObj(page);
}
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(70);
}
/** Clic sul foglio in un punto del foglio; restituisce il punto GREZZO realmente sotto il clic (letto PRIMA: con il tastierino aperto il foglio si ridimensiona). */
async function clickSheet(page, s) {
  const c = await clientOfSheet(page, s);
  const raw = await sheetOfClient(page, c);
  await click(page, c);
  return raw;
}
async function menuItem(page, menu, re) {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.locator('.menu-item').filter({ hasText: re }).click();
  await page.waitForTimeout(150);
}
const armFillet = (page) => menuItem(page, 'Inserisci', /^Raccordo$/);
const menuState = async (page, menu) => {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.waitForTimeout(80);
  const items = await page.$$eval('.menu-panel .menu-item', (els) => els.map((i) => ({ text: i.textContent.trim(), disabled: i.disabled || i.getAttribute('aria-disabled') === 'true' })));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  return items;
};
/** Digita il raggio con la tastiera fisica e conferma con Invio. */
async function typeAndConfirm(page, text) {
  if (text) await page.keyboard.type(text);
  await page.waitForTimeout(60);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
const closeKeypad = async (page) => {
  if (await kbdOpen(page)) {
    await page.locator('.kp-cancel').click();
    await page.waitForTimeout(100);
  }
};

/** Le due rette di prova per V (a 0 e a `theta` gradi sul foglio, tratti di 150 pt per parte): oggetti aggiunti (la prima blu tratteggiata, la seconda rossa) e geometria. */
async function twoSegments(page, V, theta = 60) {
  const d1 = dirS(0);
  const d2 = dirS(theta);
  const o1 = await addSeg(page, alongS(V, d1, -150), alongS(V, d1, 150), BLUE);
  const o2 = await addSeg(page, alongS(V, d2, -150), alongS(V, d2, 150), RED);
  return { V, d1, d2, o1, o2 };
}
const pointsOfObj = (o) => o.points.map(sh);

// ---------------------------------------------------------------- 1) menu e strumento
async function menuSuite(browser) {
  setSection('menu Inserisci e strumento Raccordo');
  {
    const { ctx, page } = await desktop(browser);
    const r = (await menuState(page, 'Inserisci')).find((i) => /^Raccordo/.test(i.text));
    check('senza documento la voce "Raccordo" del menu Inserisci c\'e\' ed e\' disattivata', !!r && r.disabled, JSON.stringify(r));
    await ctx.close();
  }
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const items = await menuState(page, 'Inserisci');
  const r = items.find((i) => /^Raccordo/.test(i.text));
  check('con un documento la voce "Raccordo" e\' ATTIVA e senza l\'indicazione "V2c"', !!r && !r.disabled && !/V2c/.test(r.text), JSON.stringify(r));
  check('il menu Inserisci ha ancora 16 voci e "Raccordo" e\' l\'ultima', items.length === 16 && /^Raccordo/.test(items.at(-1).text), `${items.length}: ${items.at(-1)?.text}`);
  const nBtn = await page.locator('nav.palette button.tool').count();
  await armFillet(page);
  check('armato il Raccordo la palette non ha pulsanti in piu\' e nessuno si chiama "Raccordo"', (await page.locator('nav.palette button.tool').count()) === nBtn && (await page.locator('nav.palette button.tool[title="Raccordo"]').count()) === 0, String(nBtn));
  check('lo strumento e\' armato: nessun pulsante della palette e\' premuto, modo del visore "choose", barra contestuale visibile', (await page.locator('nav.palette button.tool[aria-pressed="true"]').count()) === 0 && (await modeOf(page)) === 'choose' && (await page.locator('.ctxbar:not([hidden])[data-tool="fillet"]').count()) === 1, `${await modeOf(page)}`);
  check('testo guida del primo passo: "Raccordo: scegli il primo tratto"', (await hint(page)) === 'Raccordo: scegli il primo tratto', await hint(page));
  const vis = await page.evaluate(() => {
    const show = (e) => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
    return {
      groups: ['.ctx-types', '.ctx-covers', '.ctx-curves', '.ctx-angmode', '.ctx-style'].map((s) => [s, show(document.querySelector(s))]).filter(([, v]) => v).map(([s]) => s),
      actions: [...document.querySelectorAll('.ctx-actions > *')].filter(show).map((e) => e.textContent.trim()),
    };
  });
  check('la barra contestuale ha solo il testo guida e il pulsante "Annulla" (nessun gruppo di scelta, riquadro di stile o interruttore)', vis.groups.length === 0 && JSON.stringify(vis.actions) === JSON.stringify(['Annulla']), JSON.stringify(vis));
  await ctx.close();
}

// ---------------------------------------------------------------- 2) due Rette: le quattro combinazioni di clic
async function segmentsSuite(browser, title) {
  setSection(`raccordo fra due Rette, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  const theta = 60;
  const { V, d1, d2, o1, o2 } = await twoSegments(page, fsheet(0.5, 0.42), theta);
  const R = 10 * MM; // 10 mm del foglio (pagina non calibrata)
  const base = await objectsOf(page);
  await armFillet(page);
  const seen = new Set();
  const combos = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  let idx = 0;
  for (const [k1, k2] of combos) {
    idx++;
    const name = `parti (${k1 > 0 ? '+' : '-'}, ${k2 > 0 ? '+' : '-'})`;
    const u1 = k1 > 0 ? d1 : neg(d1);
    const u2 = k2 > 0 ? d2 : neg(d2);
    await clickSheet(page, alongS(V, u1, 80));
    const hintAfter1 = await hint(page);
    await clickSheet(page, alongS(V, u2, 80));
    check(`${name}: primo tratto -> "scegli il secondo tratto"; dopo il secondo si apre il tastierino "Raccordo"`, hintAfter1 === 'Raccordo: scegli il secondo tratto' && (await kbdOpen(page)) && (await kpText(page, '.kp-title')) === 'Raccordo', hintAfter1);
    if (idx === 1) {
      check('tastierino: informazione "Raggio in mm sul foglio (pagina non calibrata)", valore proposto 5 (il primo)', (await kpText(page, '.kp-info')) === 'Raggio in mm sul foglio (pagina non calibrata)' && (await kpText(page, '.kp-value')) === '5', `${await kpText(page, '.kp-info')} / ${await kpText(page, '.kp-value')}`);
      check('con il tastierino aperto i due tratti sono evidenziati e l\'anteprima mostra l\'arco (raggio proposto 5)', (await selCount(page)) === 2 && (await previewCount(page)) >= 1, `${await selCount(page)} / ${await previewCount(page)}`);
    }
    await page.keyboard.type('10'); // il primo tasto sostituisce il valore proposto
    check(`${name}: digitando "10" il valore e' "10" (sostituisce il proposto)`, (await kpText(page, '.kp-value')) === '10', await kpText(page, '.kp-value'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const objs = await objectsOf(page);
    check(`${name}: 3 oggetti (le due rette e un arco), tastierino chiuso`, objs.length === 3 && !(await kbdOpen(page)), String(objs.length));
    const t1 = objs.find((o) => o.id === o1.id);
    const t2 = objs.find((o) => o.id === o2.id);
    const arc = objs.at(-1);
    const ex = expectFillet(V, u1, u2, R);
    const i1 = k1 > 0 ? 0 : 1; // l'estremo che si sostituisce: quello dalla parte opposta a quella tenuta
    const i2 = k2 > 0 ? 0 : 1;
    const e1 = sh(t1.points[i1]);
    const e2 = sh(t2.points[i2]);
    check(`${name}: l'estremo vicino della prima retta e' il punto di tangenza atteso (entro 1e-6 pt), l'altro non cambia`, nearP(e1, ex.T1, 1e-6) && canon(t1.points[1 - i1]) === canon(o1.points[1 - i1]), JSON.stringify([e1, ex.T1]));
    check(`${name}: lo stesso per la seconda retta`, nearP(e2, ex.T2, 1e-6) && canon(t2.points[1 - i2]) === canon(o2.points[1 - i2]), JSON.stringify([e2, ex.T2]));
    check(`${name}: l'arco e' un oggetto "arc" che parte e finisce ESATTAMENTE negli estremi accorciati (nessun buco, nessuna sovrapposizione)`, arc.kind === 'arc' && canon(arc.p1) === canon(t1.points[i1]) && canon(arc.p3) === canon(t2.points[i2]), JSON.stringify(arc));
    const cc = circum(sh(arc.p1), sh(arc.p2), sh(arc.p3));
    check(`${name}: l'arco ha il centro atteso e raggio R = 10 mm = ${R.toFixed(4)} pt (entro 1e-6 pt), passa per il punto atteso`, nearP(cc.c, ex.C, 1e-6) && near(cc.r, R, 1e-6) && nearP(sh(arc.p2), ex.M, 1e-6), JSON.stringify([cc, ex.C, ex.M]));
    check(`${name}: l'angolo fra i tratti e' ${ex.theta.toFixed(3)} gradi e l'arco ne copre ${(180 - ex.theta).toFixed(3)}`, near(angleBetween(sub(sh(arc.p1), cc.c), sub(sh(arc.p3), cc.c)), 180 - ex.theta, 1e-6), String(angleBetween(sub(sh(arc.p1), cc.c), sub(sh(arc.p3), cc.c))));
    check(`${name}: l'arco ha il tratto della PRIMA retta scelta (blu tratteggiato 2.5 pt), non quello corrente dell'app`, canon(arc.stroke) === canon(BLUE), JSON.stringify(arc.stroke));
    check(`${name}: l'arco e' in fondo all'elenco e le due rette conservano id e tratto`, objs.map((o) => o.id).join() === [o1.id, o2.id, arc.id].join() && canon(t1.stroke) === canon(BLUE) && canon(t2.stroke) === canon(RED), objs.map((o) => o.id).join());
    check(`${name}: messaggio "Raccordo R 10 mm sul foglio aggiunto: tratti accorciati. Annulla lo ripristina."`, (await status(page)) === 'Raccordo R 10 mm sul foglio aggiunto: tratti accorciati. Annulla lo ripristina.', await status(page));
    check(`${name}: lo strumento RESTA armato (testo guida del primo passo, visore in modo "choose")`, (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await modeOf(page)) === 'choose', await hint(page));
    seen.add(`${arc.p1.x.toFixed(3)},${arc.p1.y.toFixed(3)};${arc.p3.x.toFixed(3)},${arc.p3.y.toFixed(3)}`);
    // Annulla: UN solo passo e tutto com'era (punti, numero di oggetti, id, ordine); Ripeti: lo stesso risultato con gli stessi id
    await undo(page);
    check(`${name}: Annulla (un passo) rimette le due rette com'erano (punti esatti) e toglie l'arco`, canon(await objectsOf(page)) === canon(base) && /^Annullato: Raccordo/.test(await status(page)), (await status(page)));
    await redo(page);
    check(`${name}: Ripeti reinserisce lo stesso raccordo (stessi oggetti, stessi id)`, canon(await objectsOf(page)) === canon(objs) && /^Ripetuto: Raccordo/.test(await status(page)), await status(page));
    await undo(page);
  }
  check('le quattro combinazioni di clic sugli stessi due tratti danno quattro raccordi DIVERSI', seen.size === 4, String(seen.size));
  await ctx.close();
}

// ---------------------------------------------------------------- 3) estremi di Linee, spigolo di una Linea, rifiuti
async function linesSuite(browser) {
  setSection('Linee, spigolo spezzato e rifiuti, mouse 1280x900, A4 vettoriale');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const R = 10 * MM;
  const V = pt(300, 400);
  await armFillet(page);

  // --- Retta e Linea (estremo): la Linea ha il tratto 0 verticale per V
  const A = await addSeg(page, pt(150, 400), pt(450, 400), RED);
  const L = await addPoly(page, [pt(300, 250), pt(300, 550), pt(450, 570)], BLUE);
  const before = await objectsOf(page);
  await clickSheet(page, pt(380, 400)); // retta, parte a destra di V
  await clickSheet(page, pt(300, 330)); // linea, sopra V: la parte tenuta e' verso (300,250) e l'estremo da sostituire sarebbe (300,550), un punto INTERNO
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('tratto INTERNO di una Linea: il tastierino resta aperto e dice "Il raccordo accorcia solo i tratti agli estremi di una Linea."', (await kbdOpen(page)) && (await kpText(page, '.kp-msg')) === 'Il raccordo accorcia solo i tratti agli estremi di una Linea.', `${await kpText(page, '.kp-msg')}`);
  check('... e non e\' cambiato niente nel documento', canon(await objectsOf(page)) === canon(before));
  await closeKeypad(page);
  check('Annulla del tastierino: "Annullato", strumento ancora armato, nessuna scelta in corso', (await status(page)) === 'Annullato' && (await hint(page)) === 'Raccordo: scegli il primo tratto', `${await status(page)} / ${await hint(page)}`);
  await clickSheet(page, pt(380, 400));
  await clickSheet(page, pt(300, 480)); // sotto V: la parte tenuta e' verso (300,550) e si sostituisce il PRIMO punto (300,250)
  await typeAndConfirm(page, '10');
  let objs = await objectsOf(page);
  const l1 = objs.find((o) => o.id === L.id);
  const exA = expectFillet(V, dirS(0), { x: 0, y: 1 }, R);
  const a1 = objs.find((o) => o.id === A.id);
  check('Retta e Linea: si sostituisce il PRIMO punto della Linea con il punto di tangenza (gli altri due non cambiano) e l\'estremo sinistro della retta con il suo (l\'altro non cambia)', l1.points.length === 3 && nearP(sh(l1.points[0]), exA.T2, 1e-6) && canon(l1.points.slice(1)) === canon(L.points.slice(1)) && nearP(sh(a1.points[0]), exA.T1, 1e-6) && canon(a1.points[1]) === canon(A.points[1]), JSON.stringify([l1.points, a1.points]));
  check('Retta e Linea: l\'arco ha l\'ultimo punto nel punto di tangenza della Linea e il tratto della Retta (la prima scelta)', objs.at(-1).kind === 'arc' && canon(objs.at(-1).p3) === canon(l1.points[0]) && canon(objs.at(-1).stroke) === canon(RED), JSON.stringify(objs.at(-1)));
  await undo(page);
  check('Annulla: Retta e Linea tornano come prima', canon(await objectsOf(page)) === canon(before));

  // --- rifiuti nella scelta dei tratti
  const n0 = (await objectsOf(page)).length;
  await clickSheet(page, pt(60, 700));
  check('un clic dove non c\'e\' nulla: "Nessuna retta o linea in questo punto..." e il testo guida non cambia', /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await hint(page)) === 'Raccordo: scegli il primo tratto', await status(page));
  await clickSheet(page, pt(200, 400));
  await clickSheet(page, pt(420, 400));
  check('lo stesso tratto due volte: "Hai scelto due volte lo stesso tratto", il primo resta scelto', /Hai scelto due volte lo stesso tratto/.test(await status(page)) && (await hint(page)) === 'Raccordo: scegli il secondo tratto' && (await selCount(page)) === 1, await status(page));
  await undo(page);
  check('Annulla durante la scelta toglie il primo tratto (non il documento): torna "scegli il primo tratto" e gli oggetti sono gli stessi', (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await selCount(page)) === 0 && (await objectsOf(page)).length === n0, `${await hint(page)}`);
  const P1 = await addSeg(page, pt(100, 650), pt(500, 650), RED);
  await clickSheet(page, pt(200, 400));
  await clickSheet(page, pt(200, 650));
  check('rette parallele: "Le due linee sono parallele (o sulla stessa retta): non si possono raccordare.", il primo tratto resta scelto', (await status(page)) === 'Le due linee sono parallele (o sulla stessa retta): non si possono raccordare.' && (await hint(page)) === 'Raccordo: scegli il secondo tratto', await status(page));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Esc con una scelta in corso la annulla (lo strumento resta armato)', (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await selCount(page)) === 0 && (await modeOf(page)) === 'choose', await hint(page));
  void P1;

  // --- raggio non valido o non realizzabile: il tastierino resta aperto con il motivo
  await clickSheet(page, pt(380, 400));
  await clickSheet(page, pt(300, 480));
  const msgFor = async (typed) => {
    // il primo tasto sostituisce il proposto; poi OK
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    return { open: await kbdOpen(page), msg: await kpText(page, '.kp-msg') };
  };
  const clearValue = async () => {
    for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
  };
  let m = await msgFor('0');
  check('raggio 0: rifiutato senza chiudere il tastierino ("maggiore di 0")', m.open && /maggiore di 0/.test(m.msg), JSON.stringify(m));
  await clearValue();
  m = await msgFor('.');
  check('un punto da solo non e\' un numero: rifiutato senza chiudere il tastierino', m.open && m.msg.length > 0 && !/maggiore di 0/.test(m.msg), JSON.stringify(m));
  await clearValue();
  m = await msgFor('');
  check('nessuna cifra: rifiutato ("Inserisci un numero.")', m.open && /Inserisci un numero/.test(m.msg), JSON.stringify(m));
  await clearValue();
  m = await msgFor('1000000');
  check('raggio oltre il massimo (100000 mm): rifiutato con "Il raggio massimo e\' 100000 mm."', m.open && /Il raggio massimo è 100000 mm\./.test(m.msg), JSON.stringify(m));
  await clearValue();
  m = await msgFor('500');
  check('raggio troppo grande per i tratti (500 mm del foglio): rifiutato con il numero del tratto, tastierino aperto, documento invariato', m.open && /^Raggio troppo grande per il tratto [12]: il raccordo uscirebbe dal tratto\.$/.test(m.msg) && canon(await objectsOf(page)) === canon(before.concat([P1])) , JSON.stringify(m));
  check('con un raggio non realizzabile l\'anteprima dell\'arco non c\'e\' (i due tratti restano evidenziati)', (await previewCount(page)) === 0 && (await selCount(page)) === 2, `${await previewCount(page)} / ${await selCount(page)}`);
  await clearValue();
  await page.keyboard.type('12');
  check('correggendo il raggio l\'anteprima torna', (await previewCount(page)) >= 1, String(await previewCount(page)));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('con un raggio valido il raccordo si fa', !(await kbdOpen(page)) && (await lastObj(page)).kind === 'arc', JSON.stringify(await lastObj(page)));
  await undo(page);

  // --- Linea e Linea (estremi): L1 finisce in V (ultimo punto), L2 parte sopra V
  const L1 = await addPoly(page, [pt(100, 200), pt(100, 300), pt(300, 300)], RED);
  const L2 = await addPoly(page, [pt(300, 100), pt(300, 450), pt(420, 470)], BLUE);
  const before2 = await objectsOf(page);
  await clickSheet(page, pt(200, 300)); // L1, tratto 1 (orizzontale), parte a sinistra di V = (300, 300); l'estremo vicino e' l'ULTIMO punto
  await clickSheet(page, pt(300, 380)); // L2, tratto 0 (verticale) passa per V; parte sotto V, l'estremo vicino e' il PRIMO punto
  await typeAndConfirm(page, '10');
  objs = await objectsOf(page);
  const exL = expectFillet(pt(300, 300), pt(-1, 0), pt(0, 1), R);
  const m1 = objs.find((o) => o.id === L1.id);
  const m2 = objs.find((o) => o.id === L2.id);
  check('Linea e Linea (estremi): si sostituisce l\'ULTIMO punto della prima e il PRIMO della seconda; gli altri punti non cambiano', m1.points.length === 3 && nearP(sh(m1.points[2]), exL.T1, 1e-6) && canon(m1.points.slice(0, 2)) === canon(L1.points.slice(0, 2)) && m2.points.length === 3 && nearP(sh(m2.points[0]), exL.T2, 1e-6) && canon(m2.points.slice(1)) === canon(L2.points.slice(1)), JSON.stringify([m1.points, m2.points]));
  await undo(page);
  check('Annulla: le due Linee tornano com\'erano', canon(await objectsOf(page)) === canon(before2));
  await undo(page);
  await undo(page);

  // --- spigolo di UNA Linea: la Linea si spezza
  const objBefore = await objectsOf(page);
  const X0 = await addSeg(page, pt(30, 780), pt(60, 800), RED);
  const ST = await addPoly(page, [pt(100, 300), pt(250, 300), pt(250, 500), pt(400, 500)], BLUE);
  const X1 = await addSeg(page, pt(500, 700), pt(550, 760), RED);
  const sb = await objectsOf(page);
  const ST_V = pt(250, 300);
  await clickSheet(page, pt(170, 300)); // tratto 0
  await clickSheet(page, pt(250, 400)); // tratto 1 (consecutivo)
  await typeAndConfirm(page, '10');
  objs = await objectsOf(page);
  const exS = expectFillet(ST_V, pt(-1, 0), pt(0, 1), R);
  const idsAfter = objs.map((o) => o.id);
  const newPoly = objs.find((o) => !sb.some((x) => x.id === o.id) && o.kind === 'polyline');
  const keep = objs.find((o) => o.id === ST.id);
  check('spigolo di una Linea: la Linea e\' SPEZZATA in due Linee piu\' l\'arco (5 oggetti in piu\' dopo i due segmenti e la Linea di partenza: +2)', objs.length === sb.length + 2 && !!newPoly && objs.at(-1).kind === 'arc', `${objs.length} / ${sb.length}`);
  check('P1 conserva id e tratto e finisce nel punto di tangenza sul primo tratto: [(100,300), T1]', keep.points.length === 2 && canon(keep.points[0]) === canon(ST.points[0]) && nearP(sh(keep.points[1]), exS.T1, 1e-6) && canon(keep.stroke) === canon(BLUE), JSON.stringify(keep.points));
  check('P2 e\' una Linea NUOVA (id nuovo) con lo stesso tratto: [T2, (250,500), (400,500)]', !!newPoly && newPoly.id !== ST.id && nearP(sh(newPoly.points[0]), exS.T2, 1e-6) && canon(newPoly.points.slice(1)) === canon(ST.points.slice(2)) && canon(newPoly.stroke) === canon(BLUE), JSON.stringify(newPoly));
  const iP = idsAfter.indexOf(ST.id);
  check('... P, poi P2, poi la retta che stava dopo; l\'arco ultimo', idsAfter[iP + 1] === newPoly.id && idsAfter[iP + 2] === X1.id && idsAfter.at(-1) === objs.at(-1).id && idsAfter.indexOf(X0.id) < iP, idsAfter.join());
  check('P1 e P2 si toccano nei punti dell\'arco: l\'arco parte da T1 (fine di P1) e finisce in T2 (inizio di P2), ESATTAMENTE', canon(objs.at(-1).p1) === canon(keep.points[1]) && canon(objs.at(-1).p3) === canon(newPoly.points[0]), JSON.stringify(objs.at(-1)));
  check('messaggio: "Raccordo R 10 mm sul foglio aggiunto: Linea spezzata in due. Annulla lo ripristina."', (await status(page)) === 'Raccordo R 10 mm sul foglio aggiunto: Linea spezzata in due. Annulla lo ripristina.', await status(page));
  await undo(page);
  check('Annulla (UN passo): la Linea torna intera con tutti i punti, l\'elenco e gli id sono quelli di prima', canon(await objectsOf(page)) === canon(sb), `${(await objectsOf(page)).length}`);
  await redo(page);
  check('Ripeti: gli stessi tre oggetti con gli stessi id', JSON.stringify((await objectsOf(page)).map((o) => o.id)) === JSON.stringify(idsAfter) && canon(await objectsOf(page)) === canon(objs));
  await undo(page);

  // --- tratti NON consecutivi della stessa Linea: rifiuto
  // (tratti 0 e 2 di una Linea di 4 punti, non paralleli: altrimenti si rifiuterebbe prima per le rette parallele)
  const ZZ = await addPoly(page, [pt(100, 100), pt(300, 100), pt(300, 200), pt(150, 260)], RED);
  await clickSheet(page, pt(200, 100));
  await clickSheet(page, pt(225, 230));
  await typeAndConfirm(page, '3');
  check('due tratti NON consecutivi della stessa Linea: rifiuto "Due tratti della stessa Linea si raccordano solo se sono consecutivi."', (await kbdOpen(page)) && (await kpText(page, '.kp-msg')) === 'Due tratti della stessa Linea si raccordano solo se sono consecutivi.', `${await kpText(page, '.kp-msg')}`);
  await closeKeypad(page);
  void ZZ;
  void objBefore;
  await ctx.close();
}

// ---------------------------------------------------------------- 4) scala (mm reali), pagina non calibrata (mm del foglio), ultimo raggio, Linea chiusa
async function scaleSuite(browser) {
  setSection('scala, ultimo raggio e Linea chiusa, mouse 1280x900, A4 vettoriale');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const V = pt(300, 400);
  await twoSegments(page, V, 90);
  await armFillet(page);
  const pick = async (k1 = 1, k2 = 1) => {
    await clickSheet(page, alongS(V, dirS(0), 80 * k1));
    await clickSheet(page, alongS(V, dirS(90), 80 * k2));
  };
  // pagina non calibrata
  await pick();
  check('senza scala: informazione "Raggio in mm sul foglio (pagina non calibrata)" e valore proposto 5', (await kpText(page, '.kp-info')) === 'Raggio in mm sul foglio (pagina non calibrata)' && (await kpText(page, '.kp-value')) === '5', `${await kpText(page, '.kp-info')} / ${await kpText(page, '.kp-value')}`);
  await typeAndConfirm(page, '7.5');
  let arc = await lastObj(page);
  let cc = circum(sh(arc.p1), sh(arc.p2), sh(arc.p3));
  check('senza scala: R digitato 7.5 sono mm del FOGLIO (7.5 x 72 / 25.4 pt, entro 1e-6) e il messaggio dice "mm sul foglio"', near(cc.r, 7.5 * MM, 1e-6) && /^Raccordo R 7.5 mm sul foglio aggiunto/.test(await status(page)), `${cc.r} / ${await status(page)}`);
  await undo(page);
  // l'ultimo raggio (7.5) e' il valore proposto e il primo tasto lo sostituisce; Annulla del tastierino non lo cambia
  await pick();
  check('l\'ULTIMO raggio usato (7.5) e\' il valore proposto la volta dopo', (await kpText(page, '.kp-value')) === '7.5', await kpText(page, '.kp-value'));
  check('il valore proposto e\' "selezionato": evidenziato e il primo tasto lo sostituisce', (await page.locator('.keypad .kp-sel').count()) === 1, String(await page.locator('.keypad .kp-sel').count()));
  await page.keyboard.type('3');
  await page.locator('.kp-cancel').click();
  await page.waitForTimeout(100);
  await pick();
  check('un raggio digitato ma ANNULLATO non diventa l\'ultimo usato: il proposto resta 7.5', (await kpText(page, '.kp-value')) === '7.5', await kpText(page, '.kp-value'));
  await closeKeypad(page);
  // pagina calibrata: N = 2 (mmPerPt = 2 x 25.4 / 72); R digitato = mm REALI
  const mmPerPt = 2 * (25.4 / 72);
  await page.evaluate((v) => window.__gtpdf.setScale(1, v), mmPerPt);
  await page.waitForTimeout(150);
  await pick();
  check('con la scala: informazione "Raggio in mm reali · scala 1:2" e proposto 7.5', (await kpText(page, '.kp-info')) === 'Raggio in mm reali · scala 1:2' && (await kpText(page, '.kp-value')) === '7.5', `${await kpText(page, '.kp-info')} / ${await kpText(page, '.kp-value')}`);
  await typeAndConfirm(page, '5');
  arc = await lastObj(page);
  cc = circum(sh(arc.p1), sh(arc.p2), sh(arc.p3));
  check('con la scala 1:2: R digitato 5 sono mm REALI, cioe\' 5 / 0.7056 = 7.0866 pt sul foglio (entro 1e-6) e il messaggio dice "mm" senza "sul foglio"', near(cc.r, 5 / mmPerPt, 1e-6) && /^Raccordo R 5 mm aggiunto/.test(await status(page)), `${cc.r} / ${await status(page)}`);
  const exact = expectFillet(V, dirS(0), dirS(90), 5 / mmPerPt);
  check('con la scala: i punti di tangenza sono quelli della formula con R = 5 mm reali', nearP(sh(arc.p1), exact.T1, 1e-6) && nearP(sh(arc.p3), exact.T2, 1e-6), JSON.stringify([sh(arc.p1), exact.T1]));
  await undo(page);
  // il raggio NON si salva nel progetto: stessi campi e versione 4
  await pick();
  await typeAndConfirm(page, '4');
  const text = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text);
  check('il file progetto ha versione 4, gli stessi campi di pagina e nessun campo del raggio o del raccordo', j.version === 4 && JSON.stringify(Object.keys(j.pages[0])) === JSON.stringify(['number', 'view', 'rotate', 'userUnit', 'scale', 'origin', 'objects']) && !/fillet|raccordo|radius|raggio/i.test(text) && j.pages[0].objects.map((o) => o.kind).join() === 'segment,segment,arc', `${j.version} ${j.pages[0].objects.map((o) => o.kind).join()}`);
  await undo(page);
  // Linea chiusa: lo spigolo del punto di chiusura (primo punto = ultimo) non spezza la Linea
  const SQ = await addPoly(page, [pt(100, 600), pt(300, 600), pt(300, 800), pt(100, 800), pt(100, 600)], BLUE);
  const sqBefore = await objectsOf(page);
  await clickSheet(page, pt(200, 600)); // tratto 0
  await clickSheet(page, pt(100, 700)); // tratto 3 (l'ultimo)
  await typeAndConfirm(page, '5');
  const objs = await objectsOf(page);
  const sq = objs.find((o) => o.id === SQ.id);
  check('Linea chiusa, spigolo di chiusura: la Linea resta UNA (stesso numero di punti) e gli estremi si accorciano; l\'arco la richiude', objs.length === sqBefore.length + 1 && sq.points.length === 5 && objs.at(-1).kind === 'arc' && canon(sq.points.slice(1, 4)) === canon(SQ.points.slice(1, 4)) && canon(objs.at(-1).p1) === canon(sq.points[0]) && canon(objs.at(-1).p3) === canon(sq.points[4]), JSON.stringify(sq.points));
  check('Linea chiusa: il primo punto e l\'ultimo sono a 5 mm reali / 2... dal vertice di chiusura (distanza di tangenza t = R = 7.0866 pt)', near(hyp(sh(sq.points[0]), pt(100, 600)), 5 / mmPerPt, 1e-6) && near(hyp(sh(sq.points[4]), pt(100, 600)), 5 / mmPerPt, 1e-6), `${hyp(sh(sq.points[0]), pt(100, 600))}`);
  await undo(page);
  check('Annulla: la Linea chiusa torna com\'era', canon(await objectsOf(page)) === canon(sqBefore));
  await ctx.close();
  // una sessione nuova riparte da 5 (il raggio e' solo in memoria)
  const { ctx: ctx2, page: page2 } = await desktop(browser);
  await openDoc(page2);
  const W = pt(300, 400);
  await twoSegments(page2, W, 90);
  await armFillet(page2);
  await clickSheet(page2, alongS(W, dirS(0), 80));
  await clickSheet(page2, alongS(W, dirS(90), 80));
  check('in una sessione nuova il valore proposto e\' di nuovo 5 (l\'ultimo raggio non si salva)', (await kpText(page2, '.kp-value')) === '5', await kpText(page2, '.kp-value'));
  await ctx2.close();
}

// ---------------------------------------------------------------- 5) strumento armato: Esc, Annulla, cambio di strumento
async function armedSuite(browser) {
  setSection('strumento armato, Esc, Annulla e cambio di strumento, mouse 1280x900');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const V = pt(300, 400);
  await twoSegments(page, V, 90);
  // si arma da Seleziona: Esc senza niente in corso lo disarma e torna a Seleziona
  await page.locator('button.tool[title="Seleziona"]').click();
  await armFillet(page);
  check('armato dal menu mentre Seleziona e\' attivo: barra del Raccordo', (await page.locator('.ctxbar:not([hidden])[data-tool="fillet"]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc senza niente in corso disarma il Raccordo e torna allo strumento di prima (Seleziona)', (await page.locator('.ctxbar:not([hidden])[data-tool="select"]').count()) === 1 && (await modeOf(page)) === 'select', `${await modeOf(page)}`);
  // dallo strumento Sposta vista
  await page.locator('button.tool[title="Sposta vista"]').click();
  await armFillet(page);
  await page.locator('.ctx-act', { hasText: 'Annulla' }).click();
  await page.waitForTimeout(100);
  check('il pulsante "Annulla" della barra, senza niente in corso, disarma il Raccordo (torna a Sposta vista: barra nascosta)', (await page.locator('.ctxbar:not([hidden])').count()) === 0 && (await modeOf(page)) === 'pan', `${await modeOf(page)}`);
  // con una scelta in corso: "Annulla" della barra toglie il tratto, non disarma
  await armFillet(page);
  await clickSheet(page, alongS(V, dirS(0), 80));
  await page.locator('.ctx-act', { hasText: 'Annulla' }).click();
  await page.waitForTimeout(100);
  check('"Annulla" della barra con un tratto scelto: lo toglie (resta armato)', (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await selCount(page)) === 0 && (await page.locator('.ctxbar:not([hidden])[data-tool="fillet"]').count()) === 1, await hint(page));
  // scegliere "Raccordo" dal menu con lo strumento gia' armato e una scelta in corso: la ripulisce
  await clickSheet(page, alongS(V, dirS(0), 80));
  await armFillet(page);
  check('"Raccordo" scelto di nuovo dal menu ripulisce la scelta in corso', (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await selCount(page)) === 0, await hint(page));
  // cambiare strumento dalla palette disarma
  await page.locator('button.tool[title="Retta"]').click();
  await page.waitForTimeout(100);
  check('scegliere un altro strumento dalla palette disarma il Raccordo (strumento Retta, nessuna scelta)', (await page.locator('.ctxbar:not([hidden])[data-tool="segment"]').count()) === 1 && (await selCount(page)) === 0 && (await modeOf(page)) === 'pick', `${await modeOf(page)}`);
  // Esc a tastierino aperto: chiude il tastierino ("Annullato"), non disarma
  await armFillet(page);
  await clickSheet(page, alongS(V, dirS(0), 80));
  await clickSheet(page, alongS(V, dirS(90), 80));
  check('(premessa) tastierino aperto dopo i due tratti', await kbdOpen(page));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check('Esc con il tastierino aperto lo chiude senza cambiare niente ("Annullato"); lo strumento resta armato, senza scelta', !(await kbdOpen(page)) && (await status(page)) === 'Annullato' && (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await objectsOf(page)).length === 2, `${await status(page)} / ${await hint(page)}`);
  // con il tastierino aperto Annulla (Ctrl+Z) non fa nulla; un raccordo fatto si annulla con Ctrl+Z anche con lo strumento armato
  await clickSheet(page, alongS(V, dirS(0), 80));
  await clickSheet(page, alongS(V, dirS(90), 80));
  const n = (await objectsOf(page)).length;
  await undo(page);
  check('Annulla (Ctrl+Z) con il tastierino aperto non fa nulla (il tastierino resta, gli oggetti sono gli stessi)', (await kbdOpen(page)) && (await objectsOf(page)).length === n);
  await typeAndConfirm(page, '6');
  check('(premessa) raccordo fatto: 3 oggetti', (await objectsOf(page)).length === 3);
  await page.locator('.undo-ctl button').nth(0).click();
  await page.waitForTimeout(100);
  check('il pulsante Annulla della barra superiore annulla il raccordo in UN passo e lo strumento resta armato', (await objectsOf(page)).length === 2 && (await hint(page)) === 'Raccordo: scegli il primo tratto' && /^Annullato: Raccordo/.test(await status(page)), `${await status(page)}`);
  // cambio di pagina (se ce n'e' una sola: nessuno); chiudere il documento disarma? si verifica solo che non ci siano errori
  await ctx.close();
}

// ---------------------------------------------------------------- 6) progetto: salva, riapri, fixture di b3d8646
async function projectSuite(browser, title, file) {
  setSection(`progetto versione 4 con un raccordo, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  const sample = readFileSync(join(PDF_DIR, file));
  const V = fsheet(0.5, 0.35);
  await twoSegments(page, V, 60);
  await armFillet(page);
  await clickSheet(page, alongS(V, dirS(0), 80));
  await clickSheet(page, alongS(V, dirS(60), -80));
  await typeAndConfirm(page, '8');
  const W = fsheet(0.35, 0.7);
  const ST = await addPoly(page, [alongS(W, pt(-1, 0), 150), W, alongS(W, pt(0, 1), 150), alongS(alongS(W, pt(0, 1), 150), pt(1, 0), 150)], BLUE);
  await clickSheet(page, alongS(W, pt(-1, 0), 70));
  await clickSheet(page, alongS(W, pt(0, 1), 70));
  await typeAndConfirm(page, '6');
  const S0 = await state(page);
  check('(premessa) due raccordi: 2 rette accorciate, 2 Linee (spezzata), 2 archi', S0.pages[0].objects.filter((o) => o.kind === 'arc').length === 2 && S0.pages[0].objects.filter((o) => o.kind === 'segment').length === 2 && S0.pages[0].objects.filter((o) => o.kind === 'polyline').length === 2, JSON.stringify(S0.pages[0].objects.map((o) => o.kind)));
  const text0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text0);
  check('il progetto scritto e\' di versione 4 con gli stessi campi (nessun nuovo tipo di oggetto)', j.version === 4 && j.format === 'gt-pdf-project' && j.pages[0].objects.every((o) => ['segment', 'polyline', 'arc'].includes(o.kind)), String(j.version));
  await menuItem(page, 'File', /^Salva con nome/);
  const d = page.locator('.save-dialog');
  await d.waitFor();
  await d.locator('.btn.primary', { hasText: 'Salva' }).click();
  await d.locator('.exp-done-actions').waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
  const saved = readFileSync(await dl.path());
  await d.locator('.btn', { hasText: 'Chiudi' }).click();
  const sj = JSON.parse(saved.toString('utf8'));
  check('il file scaricato e\' di versione 4 con gli stessi oggetti del modello', sj.version === 4 && canon(sj.pages[0].objects) === canon(S0.pages[0].objects), `${sj.version}`);
  const closeDoc = async () => {
    const items = await menuState(page, 'File');
    if (!items.some((i) => /^Chiudi/.test(i.text) && !i.disabled)) return;
    await menuItem(page, 'File', /^Chiudi/);
    await page.waitForTimeout(300);
    const dlg = page.locator('.dialog .btn', { hasText: /Chiudi|Procedi|Scarta/ });
    if (await dlg.count()) await dlg.first().click().catch(() => {});
    await page.waitForTimeout(300);
  };
  const openProject = async (json, jsonName, pdfName, pdfBytes) => {
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: jsonName, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.locator('.open-project-dialog').waitFor();
    const second = page.waitForEvent('filechooser');
    await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
    await (await second).setFiles({ name: pdfName, mimeType: 'application/pdf', buffer: Buffer.from(pdfBytes) });
    await page.waitForTimeout(900);
  };
  await closeDoc();
  await openProject(saved, 'progetto-raccordo.json', file, sample);
  const S1 = await state(page);
  check('riaperto il progetto: i due raccordi sono UGUALI (tutti i punti, id, tratti, ordine)', canon(S1.pages[0].objects) === canon(S0.pages[0].objects), `${S1.pages[0].objects.length}`);
  const text1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('il progetto riscritto dopo la riapertura e\' identico (versione 4)', JSON.stringify(JSON.parse(text1).pages) === JSON.stringify(j.pages) && JSON.parse(text1).version === 4);
  // dopo la riapertura Annulla non annulla niente (la cronologia riparte) ma il raccordo si puo' rifare sugli stessi oggetti
  void ST;
  // un file di versione 4 scritto dal codice di b3d8646 si apre uguale (l'unico PDF e' a4-vettoriale.pdf)
  if (file === 'a4-vettoriale.pdf') {
    const fx = readFileSync(FIXTURE_V4, 'utf8');
    await closeDoc();
    await openProject(fx, 'progetto-v4-b3d8646.json', 'a4-vettoriale.pdf', sample);
    const S4 = await state(page);
    const fj = JSON.parse(fx);
    check('un progetto di versione 4 salvato con b3d8646 si apre UGUALE (8 oggetti, scala e origine del file)', canon(S4.pages[0].objects) === canon(fj.pages[0].objects) && S4.pages[0].objects.length === 8 && near(S4.pages[0].scale.mmPerPt, fj.pages[0].scale.mmPerPt, 0) && nearP(S4.pages[0].origin, fj.pages[0].origin, 0), `${S4.pages[0].objects.length}`);
    const t4 = JSON.parse(await page.evaluate(async () => (await window.__gtpdf.projectText()).text));
    check('... e riscritto e\' uguale al file di b3d8646 (stessi oggetti, stessa scala e origine, versione 4)', t4.version === 4 && JSON.stringify(t4.pages) === JSON.stringify(fj.pages));
    // sul progetto aperto si puo' fare un raccordo (Retta e Linea del fixture non sono tracciati cosi': si usa il segmento e la Linea a gradini)
    G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  }
  await ctx.close();
}

// ---------------------------------------------------------------- 7) esportazione: "Copertura semplice" e "Appiattito", continuita' nei punti di tangenza
const INK_T = 40;
const TOL_PX = 2;
const MIN_MATCH = 0.97;
const INK_RATIO = [0.9, 1.1];
const MAX_FAR_PX = 4;
const ENV_R = 1;
const ENV_T = 40;
const ENV_GROW = 4;
const ENV_TOL = 48;
const MAX_OUT = { obj: 0.02, rest: 0.01 };
const BIG_SHIFT = [30, 0];
async function exportSuite(browser, harness, title, file) {
  setSection(`esportazione con un raccordo, ${title}`);
  // finestra grande (2800 x 2000) e zoom 2 px/pt: lo schermo e il PDF reso da PDF.js hanno lo STESSO ingrandimento (come e2e-cp6c)
  const { ctx, page } = await newApp(browser);
  try {
    await openSample(page, title);
    G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
    const origBytes = readFileSync(join(PDF_DIR, file));
    await showPage(page, 1);
    const A0 = (await shot(page)).buf;
    // due rette nere spesse (2 pt) a 60 gradi (R = 14 mm del foglio) e una Linea a gradini (R = 10 mm): posizioni in FRAZIONI del foglio, cosi' stanno nella pagina anche con /Rotate 90 e CropBox
    const V = fsheet(0.45, 0.33);
    const d1 = dirS(0);
    const d2 = dirS(60);
    const o1 = await addSeg(page, alongS(V, d1, -110), alongS(V, d1, 110), BLACK2);
    const o2 = await addSeg(page, alongS(V, d2, -110), alongS(V, d2, 110), BLACK2);
    await armFillet(page);
    await clickSheet(page, alongS(V, d1, 90));
    await clickSheet(page, alongS(V, d2, 90));
    await typeAndConfirm(page, '14');
    const W = fsheet(0.5, 0.7);
    const ST = await addPoly(page, [alongS(W, pt(-1, 0), 100), W, alongS(W, pt(0, 1), 100), alongS(alongS(W, pt(0, 1), 100), pt(1, 0), 100)], BLACK2);
    await clickSheet(page, alongS(W, pt(-1, 0), 50));
    await clickSheet(page, alongS(W, pt(0, 1), 50));
    await typeAndConfirm(page, '10');
    await page.keyboard.press('Escape'); // niente in corso: disarma
    await page.waitForTimeout(100);
    await showPage(page, 1);
    const A = (await shot(page)).buf;
    const st = await state(page);
    const objs = st.pages[0].objects;
    check('(premessa) 2 raccordi: 2 rette, 2 Linee (la gradinata e\' spezzata) e 2 archi; strumento disarmato con Esc', objs.length === 6 && objs.filter((o) => o.kind === 'arc').length === 2 && (await page.locator('.ctxbar:not([hidden])').count()) === 0, JSON.stringify(objs.map((o) => o.kind)));
    // punti da controllare: i quattro punti di tangenza (a due a due: estremo del tratto accorciato = inizio dell'arco)
    const arcs = objs.filter((o) => o.kind === 'arc');
    const tangents = [];
    for (const arc of arcs) {
      const cc = circum(sh(arc.p1), sh(arc.p2), sh(arc.p3));
      for (const [p, q] of [[arc.p1, arc.p3], [arc.p3, arc.p1]]) {
        const T = sh(p);
        // verso dell'arco partendo da T (verso il punto di mezzo): segno del prodotto vettoriale
        const sg = Math.sign(cr(sub(T, cc.c), sub(sh(arc.p2), cc.c)));
        const rT = sub(T, cc.c);
        const tangDir = unit({ x: -rT.y * sg, y: rT.x * sg }); // direzione di percorrenza dell'arco da T verso il punto di mezzo
        // il tratto dritto e' sul prolungamento tangente, dalla parte opposta all'arco
        tangents.push({ T, cc, R: cc.r, sg, straight: neg(tangDir), tangDir });
        void q;
      }
    }
    const hp = await harness.newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    const url = (buf) => `data:image/png;base64,${b64(buf)}`;
    const b0 = await hp.evaluate(([d, k, z]) => window.renderPage(d, k, z), [b64(origBytes), 1, ZOOM]);
    for (const [mode, label, opts] of [['simple', 'Copertura semplice', { mode: 'simple' }], ['flat', 'Appiattito (PNG 300 dpi)', { mode: 'flat', dpi: 300, format: 'png' }]]) {
      const r = await page.evaluate(async (o) => { const x = await window.__gtpdf.runExport({ ...o, keep: true }); return { warnings: x.warnings, objectCount: x.objectCount, touchedPages: x.touchedPages }; }, opts);
      const b64pdf = await page.evaluate(() => window.__gtpdf.lastExportBase64());
      writeFileSync(join(OUT, `${file.replace('.pdf', '')}-raccordo-${mode}.pdf`), Buffer.from(b64pdf, 'base64'));
      check(`${label}: esportazione riuscita con 6 oggetti (2 archi del raccordo, rette e Linee accorciate) su 1 pagina, nessun avviso`, r.objectCount === 6 && r.touchedPages === 1 && r.warnings.length === 0, JSON.stringify(r));
      const bb = await hp.evaluate(([d, k, z]) => window.renderPage(d, k, z), [b64pdf, 1, ZOOM]);
      // continuita': lungo il percorso "tratto dritto -> arco" a cavallo di ogni punto di tangenza ogni campione ha inchiostro (finestra 3 x 3 px, soglia 128)
      const samples = [];
      for (const t of tangents) {
        for (let s = 0; s <= 8; s += 0.25) {
          samples.push([ (t.T.x + t.straight.x * s) * ZOOM, (t.T.y + t.straight.y * s) * ZOOM ]); // sul tratto dritto accorciato
          const phi = (s / t.R) * t.sg; // lungo l'arco, nel verso del punto di mezzo
          const a = Math.atan2(t.T.y - t.cc.c.y, t.T.x - t.cc.c.x) + phi;
          samples.push([(t.cc.c.x + t.R * Math.cos(a)) * ZOOM, (t.cc.c.y + t.R * Math.sin(a)) * ZOOM]);
        }
      }
      const inked = await hp.evaluate(([u, pts]) => window.pathInk(u, pts, 128, 1), [bb, samples]);
      check(`${label}: inchiostro CONTINUO nei 4 punti di tangenza: ${samples.length} campioni lungo "tratto dritto -> arco" (8 pt per parte, passo 0.25 pt), nessuno vuoto (nessun buco)`, inked.every(Boolean), `${inked.filter((x) => !x).length} vuoti su ${inked.length}`);
      // la parte tolta e' sparita e quella tenuta c'e': lungo il tratto dritto, a 14 pt dal punto di tangenza dalla parte del vertice (tolta) e dalla parte opposta (tenuta); a 14 pt l'arco si
      // e' gia' allontanato di piu' di 3 pt dal prolungamento della retta, quindi il campione non vede l'arco
      const removed = tangents.map((t) => [(t.T.x - t.straight.x * 14) * ZOOM, (t.T.y - t.straight.y * 14) * ZOOM]);
      const kept = tangents.map((t) => [(t.T.x + t.straight.x * 14) * ZOOM, (t.T.y + t.straight.y * 14) * ZOOM]);
      for (const [where, img] of [['PDF', bb], ['app', url(A)]]) {
        const remInk = await hp.evaluate(([u, pts]) => window.pathInk(u, pts, 128, 1), [img, removed]);
        const keptInk = await hp.evaluate(([u, pts]) => window.pathInk(u, pts, 128, 1), [img, kept]);
        check(`${label}, ${where}: la parte di retta oltre il punto di tangenza (verso il vertice) e' TOLTA (nessun inchiostro a 14 pt dai 4 punti) e la parte tenuta c'e' (inchiostro a 14 pt dall'altra parte: la prova e' sensibile)`, remInk.every((x) => !x) && keptInk.every(Boolean), JSON.stringify([remInk, keptInk]));
      }
      if (mode === 'simple') {
        const m = await hp.evaluate(([a0, a, b0u, bu, T, tol]) => window.compare(a0, a, b0u, bu, T, tol), [url(A0), url(A), b0, bb, INK_T, TOL_PX]);
        writeFileSync(join(OUT, `${file.replace('.pdf', '')}-raccordo-${mode}-A_B_diff.png`), Buffer.from(m.image.split(',')[1], 'base64'));
        info(`${label}, ${title}: inchiostro app ${m.nA} px, PDF ${m.nB} px | entro ${TOL_PX} px: ${(m.matchA * 100).toFixed(2)} % (app->PDF), ${(m.matchB * 100).toFixed(2)} % (PDF->app) | p99 ${m.p99A.toFixed(2)}/${m.p99B.toFixed(2)} px, max ${m.maxA.toFixed(1)}/${m.maxB.toFixed(1)} px, rapporto ${(m.nB / m.nA).toFixed(3)}`);
        check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro dell'app entro ${TOL_PX} px da quello del PDF`, m.matchA >= MIN_MATCH, `${(m.matchA * 100).toFixed(2)} %`);
        check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro del PDF entro ${TOL_PX} px da quello dell'app`, m.matchB >= MIN_MATCH, `${(m.matchB * 100).toFixed(2)} %`);
        check(`${label}: quantita' di inchiostro del PDF / dell'app tra ${INK_RATIO[0]} e ${INK_RATIO[1]}`, m.nB / m.nA >= INK_RATIO[0] && m.nB / m.nA <= INK_RATIO[1], (m.nB / m.nA).toFixed(3));
        check(`${label}: nessun pezzo di inchiostro a piu' di ${MAX_FAR_PX} px dall'altro (massimo ${Math.max(m.maxA, m.maxB).toFixed(1)} px)`, Math.max(m.maxA, m.maxB) <= MAX_FAR_PX, `${m.maxA}/${m.maxB}`);
      } else {
        const run = (shift) => hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [url(A0), url(A), bb, { r: ENV_R, tol: ENV_TOL, T: ENV_T, grow: ENV_GROW, shift, noImage: shift !== null }]);
        const e = await run(null);
        if (e.image) writeFileSync(join(OUT, `${file.replace('.pdf', '')}-raccordo-${mode}-A_B_diff.png`), Buffer.from(e.image.split(',')[1], 'base64'));
        const q = (x, n) => (n ? x / n : 0);
        const outObj = Math.max(q(e.outBObj, e.nObj), q(e.outAObj, e.nObj));
        const outRest = Math.max(q(e.outBRest, e.nRest), q(e.outARest, e.nRest));
        info(`${label}, ${title}: fuori inviluppo | oggetti ${e.nObj} px: PDF ${(q(e.outBObj, e.nObj) * 100).toFixed(2)} %, app ${(q(e.outAObj, e.nObj) * 100).toFixed(2)} % | resto ${e.nRest} px: PDF ${(q(e.outBRest, e.nRest) * 100).toFixed(2)} %, app ${(q(e.outARest, e.nRest) * 100).toFixed(2)} %`);
        check(`${label}: nelle aree degli oggetti (rette accorciate, Linee, archi) al massimo ${MAX_OUT.obj * 100} % dei pixel fuori inviluppo`, e.nObj > 500 && outObj <= MAX_OUT.obj, `${(outObj * 100).toFixed(2)} % su ${e.nObj}`);
        check(`${label}: nel resto della pagina al massimo ${MAX_OUT.rest * 100} % dei pixel fuori inviluppo`, outRest <= MAX_OUT.rest, `${(outRest * 100).toFixed(2)} %`);
        const g = await run(BIG_SHIFT);
        const go = Math.max(q(g.outBObj, g.nObj), q(g.outAObj, g.nObj));
        const gr = Math.max(q(g.outBRest, g.nRest), q(g.outARest, g.nRest));
        check(`${label}: con il PDF spostato di ${BIG_SHIFT[0] / ZOOM} pt la stessa prova FALLISCE (la prova e' sensibile)`, go > MAX_OUT.obj || gr > MAX_OUT.rest, `oggetti ${(go * 100).toFixed(2)} %, resto ${(gr * 100).toFixed(2)} %`);
      }
    }
    await hp.close();
    void o1; void o2; void ST; void objs;
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 8) barra contestuale e tastierino (iPhone 390 x 780, A+ 14, 16, 18, 20, 22)
const hintGeom = (page) => page.evaluate(() => { const e = document.querySelector('.ctx-hint'); const b = document.querySelector('.ctxbar'); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), bar: b.getBoundingClientRect().height, right: Math.max(...[...b.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.getBoundingClientRect().right)) }; });
const barOf = async (page) => {
  const g = await hintGeom(page);
  return { text: await hint(page), lines: Math.round(g.h / g.lh), bar: Math.round(g.bar * 10) / 10, right: Math.round(g.right * 10) / 10 };
};
const kpGeom = (page) =>
  page.evaluate(() => {
    const k = document.querySelector('.keypad');
    const r = k.getBoundingClientRect();
    const head = k.querySelector('.kp-head');
    const info = k.querySelector('.kp-info');
    const keys = [...k.querySelectorAll('.kp-key')].map((e) => e.getBoundingClientRect());
    return { top: r.top, h: r.height, right: r.right, left: r.left, headH: head.getBoundingClientRect().height, headLh: parseFloat(getComputedStyle(head).lineHeight), infoSw: info.scrollWidth, infoCw: info.clientWidth, keysOutside: keys.filter((x) => x.left < -0.5 || x.right > innerWidth + 0.5).length, sw: document.documentElement.scrollWidth, iw: innerWidth };
  });
async function barSuite(browser) {
  setSection('barra contestuale e tastierino, iPhone 390x780');
  for (const [uiSize, px] of [[0, 14], [1, 16], [2, 18], [3, 20], [4, 22]]) {
    const { ctx, page } = await phone(browser, 390, 780, uiSize);
    await openDoc(page, 'A4 vettoriale');
    const V = fsheet(0.5, 0.4);
    await twoSegments(page, V, 90);
    // riferimento: Origine armata (anche lei solo testo guida e Annulla)
    await menuItem(page, 'Origine', /^Imposta origine/);
    const ref = await barOf(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await armFillet(page);
    const a0 = await barOf(page);
    await clickSheet(page, alongS(V, dirS(0), 80));
    const a1 = await barOf(page);
    check(`A+ ${px}: testo guida del primo e del secondo passo su UNA riga ("Raccordo: scegli il primo tratto" / "... il secondo tratto")`, a0.text === 'Raccordo: scegli il primo tratto' && a1.text === 'Raccordo: scegli il secondo tratto' && a0.lines === 1 && a1.lines === 1, JSON.stringify([a0, a1]));
    check(`A+ ${px}: l'altezza della barra non cambia fra i due passi (${a0.bar} / ${a1.bar}) ed e' quella dell'Origine armata (${ref.bar}), che ha lo stesso contenuto`, a0.bar === a1.bar && a0.bar === ref.bar, JSON.stringify([ref.bar, a0.bar, a1.bar]));
    check(`A+ ${px}: nessun elemento della barra esce dai 390 px (bordo destro ${a0.right} / ${a1.right})`, a0.right <= 390.5 && a1.right <= 390.5, JSON.stringify([a0.right, a1.right]));
    const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.ctx-actions > *')].filter((x) => x.getBoundingClientRect().height > 0).map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), h: r.height, l: r.left, r: r.right }; }); return b; });
    check(`A+ ${px}: il pulsante "Annulla" e' alto almeno 44 px e dentro i 390 px`, btn.length === 1 && btn[0].h >= 43.5 && btn[0].l >= -0.5 && btn[0].r <= 390.5, JSON.stringify(btn));
    // tastierino
    await clickSheet(page, alongS(V, dirS(90), 80));
    const kp = await kpGeom(page);
    const kinfo = await kpText(page, '.kp-info');
    info(`A+ ${px}: barra del Raccordo ${a0.bar}/${a1.bar} px (Origine ${ref.bar}); tastierino ${kp.h.toFixed(1)} px con l'intestazione di ${kp.headH.toFixed(1)} px (${Math.round(kp.headH / kp.headLh)} righe), informazione "${kinfo}" ${kp.infoSw}/${kp.infoCw} px`);
    check(`A+ ${px}: il tastierino sta tutto nei 390 px, nessun tasto fuori e nessuno scorrimento orizzontale della pagina`, kp.keysOutside === 0 && kp.left >= -0.5 && kp.right <= 390.5 && kp.sw <= kp.iw, JSON.stringify(kp));
    check(`A+ ${px}: la riga informativa "${kinfo}" si legge intera (non e' tagliata)`, kp.infoSw <= kp.infoCw + 0.5, JSON.stringify([kp.infoSw, kp.infoCw]));
    // l'arco dell'anteprima e i punti scelti restano visibili e scoperti dal tastierino
    const vis = await page.evaluate(() => {
      const v = document.querySelector('.viewer').getBoundingClientRect();
      const k = document.querySelector('.keypad').getBoundingClientRect();
      const pv = [...document.querySelectorAll('.sc-preview *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
      return { v: { t: v.top, b: v.bottom }, k: { t: k.top }, prev: pv.map((r) => ({ t: r.top, b: r.bottom, l: r.left, r: r.right })) };
    });
    check(`A+ ${px}: con il tastierino aperto l'anteprima dell'arco c'e' ed e' tutta in vista e sopra il tastierino`, vis.prev.length >= 1 && vis.prev.every((r) => r.t >= vis.v.t - 1 && r.b <= vis.v.b + 1 && r.b <= vis.k.t + 1 && r.l >= -1 && r.r <= 391), JSON.stringify(vis));
    await closeKeypad(page);
    // confronto: il tastierino della Quota allineata su una pagina non calibrata ("Pagina non calibrata: digita il valore in mm"): quello del Raccordo non deve essere piu' alto
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await menuItem(page, 'Inserisci', /^Quota allineata$/);
    for (const p of [pt(60, 60), pt(160, 60), pt(110, 30)]) await clickSheet(page, p);
    const kq = await kpGeom(page);
    const infoQ = await kpText(page, '.kp-info');
    info(`A+ ${px}: confronto, tastierino della Quota allineata senza scala ${kq.h.toFixed(1)} px con intestazione di ${kq.headH.toFixed(1)} px (${Math.round(kq.headH / kq.headLh)} righe), informazione "${infoQ}"`);
    check(`A+ ${px}: l'intestazione del tastierino del Raccordo non ha piu' righe di quella della Quota allineata (${Math.round(kp.headH / kp.headLh)} contro ${Math.round(kq.headH / kq.headLh)}) e il tastierino non e' piu' alto di piu' di una riga`, Math.round(kp.headH / kp.headLh) <= Math.round(kq.headH / kq.headLh) && kp.h <= kq.h + kq.headLh + 0.5, JSON.stringify([kp.h, kp.headH, kq.h, kq.headH]));
    await closeKeypad(page);
    await ctx.close();
  }
  // desktop: 1280 x 900 e 720 x 700: la barra non cambia altezza fra i passi
  for (const [w, h] of [[1280, 900], [720, 700]]) {
    const { ctx, page } = await desktop(browser, w, h);
    await openDoc(page);
    const V = fsheet(0.5, 0.4);
    await twoSegments(page, V, 90);
    await menuItem(page, 'Origine', /^Imposta origine/);
    const ref = await barOf(page);
    await page.keyboard.press('Escape');
    await armFillet(page);
    const a0 = await barOf(page);
    await clickSheet(page, alongS(V, dirS(0), 80));
    const a1 = await barOf(page);
    info(`${w}x${h}: barra del Raccordo ${a0.bar}/${a1.bar} px, Origine ${ref.bar} px`);
    check(`${w}x${h}: l'altezza della barra non cambia fra i passi e coincide con quella dell'Origine (${ref.bar} / ${a0.bar} / ${a1.bar})`, a0.bar === a1.bar && a0.bar === ref.bar, JSON.stringify([ref.bar, a0.bar, a1.bar]));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 9) tocco emulato (iPhone 390 x 780, tolleranza di scelta 22 px)
async function touchSuite(browser, title) {
  setSection(`tocco emulato 390x780, ${title}`);
  const { ctx, page, cdp } = await phone(browser, 390, 780);
  await openDoc(page, title);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(90);
  };
  const tapSheet = async (s) => {
    const c = await clientOfSheet(page, s);
    const raw = await sheetOfClient(page, c);
    await tap(c);
    return raw;
  };
  const V = fsheet(0.5, 0.4);
  const { d1, d2, o1, o2 } = await twoSegments(page, V, 60);
  await armFillet(page); // PRIMA di misurare lo zoom (la barra contestuale cambia l'altezza del visore)
  const k = await zoomPx(page);
  info(`zoom ${k.toFixed(3)} px/pt: la tolleranza del dito (22 px) e' ${(22 / k).toFixed(1)} pt`);
  const normal = (u) => ({ x: -u.y, y: u.x });
  // fuori tolleranza (30 px): nessun tratto; dentro (18 px): si sceglie
  await tapSheet(alongS(alongS(V, d1, 80), normal(d1), 30 / k));
  check('tocco a 30 px da ogni retta: nessun tratto scelto, messaggio di una riga', /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await selCount(page)) === 0, await status(page));
  await tapSheet(alongS(alongS(V, d1, 80), normal(d1), 18 / k));
  check('tocco a 18 px dalla retta (tolleranza 22 px): il tratto e\' scelto e si evidenzia; guida del secondo passo', (await hint(page)) === 'Raccordo: scegli il secondo tratto' && (await selCount(page)) === 1, await hint(page));
  await tapSheet(alongS(alongS(V, d2, -80), normal(d2), 12 / k)); // seconda retta, parte opposta (k2 = -1)
  check('tocco sulla seconda retta (a 12 px): si apre il tastierino "Raccordo" con il valore proposto 5', (await kbdOpen(page)) && (await kpText(page, '.kp-title')) === 'Raccordo' && (await kpText(page, '.kp-value')) === '5', `${await kpText(page, '.kp-value')}`);
  // tasti del tastierino con il dito: il primo sostituisce il proposto; OK
  const key = async (t) => page.locator('.kp-key', { hasText: new RegExp(`^${t.replace('.', '\\.')}$`) }).first().tap();
  await key('1');
  await key('2');
  check('tasti "1" "2" del tastierino: il valore e\' 12 (il primo tasto ha sostituito il proposto)', (await kpText(page, '.kp-value')) === '12', await kpText(page, '.kp-value'));
  await page.locator('.kp-ok').tap();
  await page.waitForTimeout(200);
  const objs = await objectsOf(page);
  const arc = objs.at(-1);
  const R = 12 * MM;
  // i punti attesi dai clic grezzi: la parte tenuta e' quella del tocco (la prima retta +d1, la seconda -d2)
  const ex = expectFillet(V, d1, neg(d2), R);
  const t1 = objs.find((o) => o.id === o1.id);
  const t2 = objs.find((o) => o.id === o2.id);
  const cc = circum(sh(arc.p1), sh(arc.p2), sh(arc.p3));
  check('tocco: i punti di tangenza e il raggio sono quelli della formula con R = 12 mm del foglio (entro 1e-6 pt)', arc.kind === 'arc' && nearP(sh(arc.p1), ex.T1, 1e-6) && nearP(sh(arc.p3), ex.T2, 1e-6) && near(cc.r, R, 1e-6) && nearP(sh(t1.points[0]), ex.T1, 1e-6) && nearP(sh(t2.points[1]), ex.T2, 1e-6), JSON.stringify([sh(arc.p1), ex.T1, cc.r, R]));
  check('tocco: lo strumento resta armato e il messaggio dice "Raccordo R 12 mm sul foglio aggiunto: tratti accorciati."', (await hint(page)) === 'Raccordo: scegli il primo tratto' && /^Raccordo R 12 mm sul foglio aggiunto: tratti accorciati\./.test(await status(page)), await status(page));
  // il pulsante Annulla della barra superiore annulla in un passo
  await page.locator('.undo-ctl button').nth(0).tap();
  await page.waitForTimeout(120);
  check('tocco: Annulla (barra superiore) toglie il raccordo in un passo', (await objectsOf(page)).length === 2 && canon((await objectsOf(page)).map((o) => o.points)) === canon([o1.points, o2.points]), `${(await objectsOf(page)).length}`);
  // "Annulla" della barra contestuale toglie l'ultimo tratto scelto
  await tapSheet(alongS(V, d1, 80));
  await page.locator('.ctx-act', { hasText: 'Annulla' }).tap();
  await page.waitForTimeout(120);
  check('tocco: "Annulla" della barra toglie l\'ultimo tratto scelto', (await hint(page)) === 'Raccordo: scegli il primo tratto' && (await selCount(page)) === 0, await hint(page));
  // raggio troppo grande col dito: il tastierino resta aperto con il motivo
  await tapSheet(alongS(V, d1, 80));
  await tapSheet(alongS(V, d2, 80));
  for (const t of ['9', '9', '9']) await key(t);
  await page.locator('.kp-ok').tap();
  await page.waitForTimeout(150);
  check('tocco: raggio 999 mm: il tastierino resta aperto con "Raggio troppo grande per il tratto"', (await kbdOpen(page)) && /^Raggio troppo grande per il tratto [12]/.test(await kpText(page, '.kp-msg')), await kpText(page, '.kp-msg'));
  await closeKeypad(page);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('tocco: nessuno scorrimento orizzontale della pagina', ov.sw <= ov.iw, JSON.stringify(ov));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  const only_ = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only_ || only_.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di b3d8646, dove la voce "Raccordo" e' disattivata) lo dice con un controllo fallito e le altre proseguono.
  const guarded = async (id, name, fn) => {
    if (!run(id)) return;
    try {
      await fn();
    } catch (e) {
      setSection(name);
      check(`la serie "${name}" si e' interrotta: ${String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160)}`, false, process.env.E2E_DEBUG ? String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join(' | ') : '');
    }
  };
  const samples = process.env.E2E_SAMPLE ? SAMPLES.filter((_, i) => process.env.E2E_SAMPLE.split(',').includes(String(i))) : SAMPLES; // solo per il debug: E2E_SAMPLE=2 (indici)
  try {
    await guarded('menu', 'menu Inserisci', () => menuSuite(browser));
    for (const [t] of samples) await guarded('rette', `due Rette, ${t}`, () => segmentsSuite(browser, t));
    await guarded('linee', 'Linee e rifiuti', () => linesSuite(browser));
    await guarded('scala', 'scala e ultimo raggio', () => scaleSuite(browser));
    await guarded('armato', 'strumento armato', () => armedSuite(browser));
    for (const [t, f] of samples) await guarded('progetto', `progetto, ${t}`, () => projectSuite(browser, t, f));
    for (const [t, f] of samples) await guarded('export', `esportazione, ${t}`, () => exportSuite(browser, harness, t, f));
    await guarded('barra', 'barra contestuale', () => barSuite(browser));
    for (const [t] of samples) await guarded('tocco', `tocco, ${t}`, () => touchSuite(browser, t));
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void MM;
void unit;
void redo;
