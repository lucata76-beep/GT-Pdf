// Prove di CP6g (Quote angolari) su Chromium: la quota angolare "da due linee" e "da tre punti" dall'inizio alla conferma con il tastierino, i quattro angoli (settori), la
// scelta del tratto (Linea con piu' tratti, il piu' vicino, nessun oggetto a portata, rette parallele), vertice fuori dai tratti, pagina NON calibrata, valore digitato con °,
// Annulla, Sposta/Specchio/Rotazione/Duplica/stile/Cancella sulla quota, progetto (versione 4, riapertura, file di versione 3), esportazione ("Copertura semplice" e "Appiattito"
// con il testo "45.00°" nel PDF) e testo guida di una riga a 390 x 780 con A+ 14 e 22.
// Mouse (desktop 1280 x 900, clic reali) e tocco emulato (iPhone 390 x 780, DPR 3, CDP) su tre pagine: A4 vettoriale, A4 con /Rotate 90, A4 con CropBox.
// Valori ESATTI: gli angoli e i punti attesi si calcolano QUI, con formule indipendenti dall'app, nel foglio mostrato (pt fisici, Y in giu') dai punti delle rette create e dal
// punto grezzo sotto il clic; l'angolo letto dall'oggetto salvato deve coincidere entro 1e-6 gradi.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6g.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 57f82e8 i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=linee,punti,scala,digitato,modifica,progetto,export,barra,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li'.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6g', out: process.argv[2], port: 4228, hport: 4229, zoom: 2 });
const { OUT, check, info, setSection, URL: APP_URL, openSample, HPORT, ZOOM, b64, showPage, shot, newApp } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
/** Tolleranza (pt) del confronto con un punto GREZZO ricostruito dal rettangolo del canvas (errore sub-pixel di getBoundingClientRect). */
const RAW_TOL = 0.05;
const DEG = Math.PI / 180;
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
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(150);
};
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const lastObj = async (page) => {
  const o = await objectsOf(page);
  return o[o.length - 1];
};
const undo = async (page) => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
};
const redo = async (page) => {
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(80);
};
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);
const toggle = (page, name) => page.locator(`.st-toggle[data-toggle="${name}"]`);
const setToggle = async (page, name, on) => {
  if (((await toggle(page, name).getAttribute('aria-pressed')) === 'true') !== on) await toggle(page, name).click();
  await page.waitForTimeout(80);
};
const SW = ['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent'];
const panelBtn = (page, k) => page.locator(`.panel-toggle[data-panel-toggle="${k}"]`);
/** Spegne tutti i candidati dello snap (dal pannello "Aggancio e griglia"; dove il pannello e' a scomparsa lo apre e lo richiude), tranne quelli elencati. */
async function snapOnly(page, list = []) {
  const hidden = !(await panelBtn(page, 'end').isVisible());
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  for (const k of SW) {
    const b = panelBtn(page, k);
    if ((await b.count()) === 0) continue;
    if (((await b.getAttribute('aria-pressed')) === 'true') !== list.includes(k)) await b.click();
  }
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(60);
}

/** Geometria della pagina 1, calcolata qui da `pages()` con le stesse formule di `PageGeometry` (come e2e-cp6a, cp6b, cp6c e cp6f). */
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

// ---- geometria indipendente (nel foglio mostrato, pt fisici, Y in giu'), numeri complessi nel piano matematico (Y in su: y = -foglio.y)
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cr = (a, b) => a.x * b.y - a.y * b.x;
const dt = (a, b) => a.x * b.x + a.y * b.y;
const unit = (a) => ({ x: a.x / Math.hypot(a.x, a.y), y: a.y / Math.hypot(a.x, a.y) });
/** Direzione sul foglio a `deg` gradi sopra l'asse X (antiorario come si vede). */
const dirS = (deg) => ({ x: Math.cos(deg * DEG), y: -Math.sin(deg * DEG) });
const alongS = (from, u, d) => ({ x: from.x + u.x * d, y: from.y + u.y * d });
/** Angolo in gradi (0, 180) fra due vettori. */
const angleBetween = (a, b) => (Math.atan2(Math.abs(cr(a, b)), dt(a, b)) / DEG);
/** Incrocio delle rette per (a1, b1) e (a2, b2). */
function crossing(a1, b1, a2, b2) {
  const d1 = unit(sub(b1, a1));
  const d2 = unit(sub(b2, a2));
  const t = cr(sub(a2, a1), d2) / cr(d1, d2);
  return { v: alongS(a1, d1, t), d1, d2 };
}
/** Quello che deve uscire da "due linee": vertice, angolo, versori dei lati e raggio, dal punto grezzo p sul foglio. */
function expectAngle(a1, b1, a2, b2, p) {
  const { v, d1, d2 } = crossing(a1, b1, a2, b2);
  const w = sub(p, v);
  const D = cr(d1, d2);
  const alpha = cr(w, d2) / D;
  const beta = cr(d1, w) / D;
  const r1 = alpha > 0 ? d1 : { x: -d1.x, y: -d1.y };
  const r2 = beta > 0 ? d2 : { x: -d2.x, y: -d2.y };
  return { v, r1, r2, angle: angleBetween(r1, r2), radius: Math.hypot(w.x, w.y) };
}

// ---- pagina di prova
async function openDoc(page, title = 'A4 vettoriale') {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
}
/** Frazioni (fx, fy) dell'area visibile -> punto sul foglio. Le rette di prova sono costruite NEL FOGLIO (angoli esatti), poi riportate nello spazio utente. */
const fsheet = (fx, fy) => ({ x: fx * G.width, y: fy * G.height });
const STROKE = { style: 'solid', color: '#D32F2F', widthPt: 1 };
/** Aggiunge una Retta fra due punti del foglio (con il comando dell'interfaccia) e ne restituisce l'oggetto. */
async function addSegment(page, a, b) {
  await page.evaluate(([pts]) => window.__gtpdf.add(1, [{ kind: 'segment', points: pts, stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } }]), [[us(a), us(b)]]);
  return lastObj(page);
}
async function addPolyline(page, pts) {
  await page.evaluate(([p]) => window.__gtpdf.add(1, [{ kind: 'polyline', points: p, stroke: { style: 'solid', color: '#1565C0', widthPt: 1 } }]), [pts.map(us)]);
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
/** JSON con le chiavi in ordine alfabetico a ogni livello: gli oggetti aggiunti con il gancio `add` hanno `id` in fondo, quelli del file in testa (stessi dati). */
const canon = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const lastText = async (page) => (await state(page)).pages[0].texts.at(-1)?.join('') ?? null;
/** Conferma la quota con il tastierino: senza testo = valore automatico proposto. */
async function confirmKeypad(page, keys = null) {
  await page.waitForTimeout(120);
  if (!(await kbdOpen(page))) return false;
  for (const k of keys ?? []) await page.locator('.kp-key', { hasText: new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
  await page.locator('.kp-ok').click();
  await page.waitForTimeout(150);
  return true;
}
const dropEntry = async (page) => {
  if (await kbdOpen(page)) {
    await page.locator('.kp-cancel').click();
    await page.waitForTimeout(100);
  }
};
const MENU_LINES = /^Quota angolare da due linee$/;
const MENU_POINTS = /^Quota angolare da tre punti$/;
async function menuInsert(page, re) {
  await page.locator('.menu-btn', { hasText: 'Inserisci' }).click();
  await page.locator('.menu-item').filter({ hasText: re }).click();
  await page.waitForTimeout(150);
}
/** Lettura delle parti disegnate di una quota nel livello SVG: numero di linee, frecce, riquadri e testi dell'ULTIMA quota. */
const drawnParts = (page) =>
  page.evaluate(() => {
    const groups = document.querySelectorAll('.sc-objects g.sc-ann');
    const g = groups[groups.length - 1];
    if (!g) return null;
    return { paths: g.querySelectorAll('path').length, polygons: g.querySelectorAll('polygon').length, rects: g.querySelectorAll('rect').length, texts: [...g.querySelectorAll('text')].map((t) => t.textContent) };
  });
const selCount = (page) => page.evaluate(() => document.querySelector('.sc-sel')?.children.length ?? 0);
const hlCount = (page) => page.evaluate(() => document.querySelector('.sc-hl')?.children.length ?? 0);

/** Verifica un oggetto salvato contro i valori attesi (calcolati qui). */
function judge(name, o, exp, radiusTol = RAW_TOL) {
  const ok = o?.kind === 'dim' && o.dim === 'angular';
  const a = ok ? sh(o.a) : null;
  const b = ok ? sh(o.b) : null;
  const p1 = ok ? sh(o.p1) : null;
  const p2 = ok ? sh(o.p2) : null;
  const val = ok ? angleBetween(sub(p1, a), sub(p2, a)) : NaN;
  check(`${name}: l'oggetto salvato e' una quota angolare`, ok, JSON.stringify(o));
  if (!ok) return;
  check(`${name}: vertice nell'incrocio delle rette (entro 1e-6 pt)`, nearP(a, exp.v, 1e-6), JSON.stringify([a, exp.v]));
  check(`${name}: angolo letto dall'oggetto = ${exp.angle.toFixed(6)} gradi (entro 1e-6)`, near(val, exp.angle, 1e-6), `${val} / ${exp.angle}`);
  const u1 = unit(sub(p1, a));
  const u2 = unit(sub(p2, a));
  check(`${name}: p1 e p2 stanno sulle semirette che delimitano il settore scelto`, hyp(u1, exp.r1) < 1e-6 && hyp(u2, exp.r2) < 1e-6, JSON.stringify([u1, exp.r1, u2, exp.r2]));
  check(`${name}: il raggio dell'arco e' la distanza del punto dal vertice (entro ${radiusTol} pt) e b e' sulla bisettrice`, near(hyp(b, a), exp.radius, radiusTol) && near(angleBetween(sub(b, a), { x: exp.r1.x + exp.r2.x, y: exp.r1.y + exp.r2.y }), 0, 1e-6), `${hyp(b, a)} / ${exp.radius}`);
}

// ---------------------------------------------------------------- 1) da due linee, mouse
async function linesSuite(browser, title) {
  setSection(`quota angolare da due linee, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  await setToggle(page, 'ortho', false);
  info(`zoom ${(await zoomPx(page)).toFixed(3)} px/pt`);

  // Due rette per un punto V del foglio, a 0 e a 45 gradi (sul foglio), tratti che attraversano V
  const V = fsheet(0.5, 0.5);
  const R1 = [alongS(V, dirS(0), -150), alongS(V, dirS(0), 150)];
  const R2 = [alongS(V, dirS(45), -150), alongS(V, dirS(45), 150)];
  const o1 = await addSegment(page, R1[0], R1[1]);
  const o2 = await addSegment(page, R2[0], R2[1]);
  const pts = (o) => [sh(o.points[0]), sh(o.points[1])];
  const [a1, b1] = pts(o1);
  const [a2, b2] = pts(o2);

  await menuInsert(page, MENU_LINES);
  check('Inserisci > "Quota angolare da due linee": strumento Quota, tipo Angolare, interruttore "Da 3 punti" spento', (await page.locator('.ctx-types button[aria-pressed="true"]').innerText()) === 'Angolare' && (await page.locator('.ctx-angmode').getAttribute('aria-pressed')) === 'false');
  check('testo guida del primo passo: "Quota angolare: scegli la prima linea"', (await hint(page)) === 'Quota angolare: scegli la prima linea', await hint(page));

  // un clic nel vuoto: messaggio, nessun cambio di stato
  const n0 = (await objectsOf(page)).length;
  await clickSheet(page, fsheet(0.12, 0.12));
  check('un clic dove non c\'e\' nulla: messaggio di una riga e il testo guida non cambia', /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la prima linea', await status(page));

  // al passaggio del mouse si evidenzia il candidato
  const onR1 = alongS(V, dirS(0), 100);
  const onR2 = alongS(V, dirS(45), 100);
  await page.mouse.move((await clientOfSheet(page, onR1)).x, (await clientOfSheet(page, onR1)).y + 3);
  await page.waitForTimeout(80);
  check('passando sopra una retta il candidato si evidenzia (come in Cancella)', (await hlCount(page)) === 1, String(await hlCount(page)));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(60);
  check('uscendo dal foglio l\'evidenziazione sparisce', (await hlCount(page)) === 0);

  // primo lato: resta evidenziato; testo guida passa al secondo
  await click(page, await clientOfSheet(page, onR1), 0, 3);
  check('dopo il primo lato: "Quota angolare: scegli la seconda linea" e il lato scelto resta evidenziato', (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, `${await hint(page)} / ${await selCount(page)}`);
  // lo stesso tratto: rifiutato
  await click(page, await clientOfSheet(page, alongS(V, dirS(0), -80)), 0, 2);
  check('lo stesso tratto scelto due volte e\' rifiutato con un messaggio chiaro, il primo resta scelto', /Hai scelto due volte lo stesso tratto/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, await status(page));
  await click(page, await clientOfSheet(page, onR2), 2, 2);
  check('dopo il secondo lato: "Quota angolare: indica dove mettere l\'arco"', (await hint(page)) === 'Quota angolare: indica dove mettere l\'arco', await hint(page));
  check('nessuna quota e\' stata creata fin qui', (await objectsOf(page)).length === n0);

  // Annulla toglie l'ultimo lato, poi si sceglie di nuovo
  await undo(page);
  check('Annulla durante la costruzione toglie l\'ultimo lato: torna "scegli la seconda linea" e gli oggetti sono gli stessi', (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await objectsOf(page)).length === n0 && (await selCount(page)) === 1, await hint(page));
  await click(page, await clientOfSheet(page, onR2), 2, 2);

  // il punto dell'arco sul vertice o su una delle due rette (a meno di 6 px) e' rifiutato, con un messaggio; il passo non cambia
  const kz = await zoomPx(page);
  const rejectAt = async (name, at, re) => {
    await clickSheet(page, at);
    check(`${name}: rifiutato con un messaggio, il testo guida non cambia e nessun tastierino`, re.test(await status(page)) && (await hint(page)) === 'Quota angolare: indica dove mettere l\'arco' && !(await kbdOpen(page)), `${await status(page)} / ${await hint(page)}`);
  };
  await rejectAt('punto dell\'arco sul vertice', V, /coincide con il vertice/);
  await rejectAt('punto dell\'arco a 3 px dal vertice', { x: V.x + 3 / kz, y: V.y }, /coincide con il vertice|su una delle due linee/);
  await rejectAt('punto dell\'arco a 3 px dalla prima retta', alongS(V, dirS(0), 80), /su una delle due linee/);
  await rejectAt('punto dell\'arco a 3 px dalla seconda retta', alongS(alongS(V, dirS(45), 80), pt(0, 1), 3 / kz), /su una delle due linee/);
  await rejectAt('punto dell\'arco sul prolungamento della prima retta, lontano dai tratti', alongS(V, dirS(180), 150), /su una delle due linee/);

  // i quattro settori: theta, 180 - theta, theta, 180 - theta
  const secs = [22.5, 112.5, 202.5, 292.5];
  const wanted = [45, 135, 45, 135];
  for (let i = 0; i < 4; i++) {
    const P = alongS(V, dirS(secs[i]), 70 + 5 * i);
    // il preview segue il cursore: con il mouse sul settore la bozza (quota intera) e' sul foglio
    const cP = await clientOfSheet(page, P);
    await page.mouse.move(cP.x, cP.y);
    await page.waitForTimeout(80);
    const draft = await page.evaluate(() => document.querySelector('.sc-draft')?.children.length ?? 0);
    check(`settore ${i + 1}: con il mouse sul punto compare l'anteprima della quota`, draft >= 1, String(draft));
    const raw = await sheetOfClient(page, cP); // PRIMA del clic: con il tastierino aperto il foglio si ridimensiona
    await click(page, cP);
    check(`settore ${i + 1}: si apre il tastierino con il valore automatico ${wanted[i]}.00°`, (await kbdOpen(page)) && /Automatico \d+\.\d\d° · gradi decimali/.test(await page.locator('.keypad').innerText()), (await page.locator('.keypad').innerText()).slice(0, 200));
    const shown = await page.locator('.keypad').innerText();
    check(`settore ${i + 1}: il tastierino propone "${wanted[i]}.00°"`, shown.includes(`${wanted[i]}.00°`), shown.slice(0, 200));
    await confirmKeypad(page);
    const o = await lastObj(page);
    if (title === 'A4 vettoriale') await page.screenshot({ path: join(lib.OUT, `linee-settore-${i + 1}.png`), clip: { x: 150, y: 90, width: 900, height: 650 } });
    judge(`settore ${i + 1} (${wanted[i]} gradi)`, o, expectAngle(a1, b1, a2, b2, raw));
    check(`settore ${i + 1}: valueText null (valore automatico) e testo "${wanted[i]}.00°" sul foglio`, o.valueText === null && (await drawnParts(page))?.texts.join('') === `${wanted[i]}.00°`, JSON.stringify([o.valueText, await drawnParts(page)]));
    const st = await state(page);
    check(`settore ${i + 1}: lo stato dice "${wanted[i]}.00°"`, JSON.stringify(st.pages[0].texts.at(-1)) === JSON.stringify([`${wanted[i]}.00°`]), JSON.stringify(st.pages[0].texts.at(-1)));
    // a quota finita il tastierino e' chiuso, lo strumento riparte dal primo lato e i lati non restano evidenziati
    check(`settore ${i + 1}: a quota finita lo strumento riparte ("scegli la prima linea") e nessun lato resta evidenziato`, !(await kbdOpen(page)) && (await hint(page)) === 'Quota angolare: scegli la prima linea' && (await selCount(page)) === 0, `${await hint(page)} / ${await selCount(page)}`);
    await undo(page);
    check(`settore ${i + 1}: Annulla toglie la quota`, (await objectsOf(page)).length === n0);
    // ripete con i due lati (il tastierino ha chiuso la costruzione)
    if (i < 3) {
      await click(page, await clientOfSheet(page, onR1), 0, 3);
      await click(page, await clientOfSheet(page, onR2), 2, 2);
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------- 2) da tre punti, mouse
async function pointsSuite(browser, title) {
  setSection(`quota angolare da tre punti, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  await setToggle(page, 'ortho', false);
  await menuInsert(page, MENU_POINTS);
  const n0 = (await objectsOf(page)).length;
  check('Inserisci > "Quota angolare da tre punti": tipo Angolare, interruttore "Da 3 punti" acceso, "indica il vertice"', (await page.locator('.ctx-types button[aria-pressed="true"]').innerText()) === 'Angolare' && (await page.locator('.ctx-angmode').getAttribute('aria-pressed')) === 'true' && (await hint(page)) === 'Quota angolare: indica il vertice', await hint(page));
  const V = fsheet(0.5, 0.45);
  const cases = [
    { name: '30 gradi', t1: 10, t2: 40, r1: 130, r2: 100, rr: 70, rd: 300 },
    { name: '90 gradi', t1: 20, t2: 110, r1: 110, r2: 120, rr: 60, rd: 200 },
    { name: '135 gradi', t1: 30, t2: 165, r1: 90, r2: 130, rr: 80, rd: 280 },
    { name: '30 gradi con i lati scambiati (sempre l\'angolo minore)', t1: 200, t2: 170, r1: 100, r2: 100, rr: 50, rd: 10 },
    { name: 'vicino a 180 gradi', t1: 4, t2: 182.5, r1: 100, r2: 100, rr: 60, rd: 90 },
  ];
  const HINTS = ['Quota angolare: indica il vertice', 'Quota angolare: indica un punto sul lato 1', 'Quota angolare: indica un punto sul lato 2', 'Quota angolare: indica dove mettere l\'arco'];
  for (const c of cases) {
    const hints = [];
    const raws = [];
    for (const s of [V, alongS(V, dirS(c.t1), c.r1), alongS(V, dirS(c.t2), c.r2), alongS(V, dirS(c.rd), c.rr)]) {
      hints.push(await hint(page));
      raws.push(await clickSheet(page, s));
    }
    check(`${c.name}: i quattro testi guida, una riga per passo`, JSON.stringify(hints) === JSON.stringify(HINTS), JSON.stringify(hints));
    check(`${c.name}: si apre il tastierino`, await kbdOpen(page));
    const o0 = (await objectsOf(page)).length;
    await confirmKeypad(page);
    const o = await lastObj(page);
    check(`${c.name}: una quota in piu', angolare`, (await objectsOf(page)).length === o0 + 1 && o?.kind === 'dim' && o.dim === 'angular', JSON.stringify(o));
    if (!(o?.dim === 'angular')) continue;
    const a = sh(o.a), p1 = sh(o.p1), p2 = sh(o.p2), b = sh(o.b);
    check(`${c.name}: vertice e punti dei lati sono quelli dei clic (entro ${RAW_TOL} pt, nessuno snap, nessun ORTO)`, nearP(a, raws[0], RAW_TOL) && nearP(p1, raws[1], RAW_TOL) && nearP(p2, raws[2], RAW_TOL), JSON.stringify([a, raws[0], p1, raws[1], p2, raws[2]]));
    const val = angleBetween(sub(p1, a), sub(p2, a));
    check(`${c.name}: l'angolo e' il minore fra i due lati (${val.toFixed(4)} gradi, calcolato dai punti salvati) e il testo sul foglio e' "${val.toFixed(2)}°"`, val > 0 && val < 180 && (await lastText(page)) === `${val.toFixed(2)}°` && o.valueText === null, `${await lastText(page)} / ${val}`);
    check(`${c.name}: il raggio dell'arco e' la distanza del quarto punto dal vertice e b sta sulla bisettrice`, near(hyp(b, a), hyp(raws[3], raws[0]), RAW_TOL) && near(angleBetween(sub(b, a), { x: unit(sub(p1, a)).x + unit(sub(p2, a)).x, y: unit(sub(p1, a)).y + unit(sub(p2, a)).y }), 0, 1e-5), `${hyp(b, a)} / ${hyp(raws[3], raws[0])}`);
    await undo(page);
    // il tastierino ha chiuso la costruzione: lo strumento riparte dal vertice
  }

  // rifiuti: punto sul vertice, lati sulla stessa retta, raggio nullo; nessuna quota in piu', il passo resta
  const k = await zoomPx(page);
  const px = (n) => n / k; // pixel -> pt
  const on = async (s) => clickSheet(page, s);
  await on(V);
  await on({ x: V.x + px(3), y: V.y });
  check('secondo punto a 3 px dal vertice: rifiutato con messaggio, il passo non cambia', /coincide con il vertice/.test(await status(page)) && (await hint(page)) === HINTS[1], `${await status(page)} / ${await hint(page)}`);
  await on(alongS(V, dirS(40), 100));
  await on(alongS(V, dirS(40), 60));
  check('terzo punto sulla stessa semiretta del secondo: rifiutato ("stessa retta"), il passo non cambia', /stessa retta/.test(await status(page)) && (await hint(page)) === HINTS[2], `${await status(page)} / ${await hint(page)}`);
  await on(alongS(V, dirS(220), 60));
  check('terzo punto dalla parte opposta (180 gradi): rifiutato', /stessa retta/.test(await status(page)) && (await hint(page)) === HINTS[2], `${await status(page)}`);
  await on(alongS(V, dirS(130), 80));
  await on({ x: V.x + px(2), y: V.y + px(2) });
  check('raggio dell\'arco sul vertice (2 px): rifiutato con messaggio, il passo non cambia', /raggio dell'arco è troppo piccolo/.test(await status(page)) && (await hint(page)) === HINTS[3], `${await status(page)} / ${await hint(page)}`);
  check('nessuna quota creata dai rifiuti', (await objectsOf(page)).length === n0 && !(await kbdOpen(page)));
  // Annulla toglie l'ultimo punto, un passo alla volta; poi Esc azzera
  await undo(page);
  check('Annulla durante la costruzione toglie l\'ultimo punto: torna "indica un punto sul lato 2"', (await hint(page)) === HINTS[2], await hint(page));
  await undo(page);
  await undo(page);
  check('Annulla ancora: torna "indica un punto sul lato 1" e poi "indica il vertice"', (await hint(page)) === HINTS[0], await hint(page));
  await on(V);
  await on(alongS(V, dirS(30), 90));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Esc azzera la costruzione: "indica il vertice"', (await hint(page)) === HINTS[0] && (await objectsOf(page)).length === n0, await hint(page));

  // Perpendicolare: il punto di partenza del secondo e del terzo punto e' il vertice (come l'ORTO); il primo punto non ha partenza
  const Sg = await addSegment(page, pt(V.x + 110, V.y - 80), pt(V.x + 140, V.y + 100));
  const [sg1, sg2] = endpoints(Sg);
  const dSg = sub(sg2, sg1);
  await snapOnly(page, ['perpendicular']);
  const rv2 = await on(V); // il vertice REALE (punto grezzo): da li' parte la perpendicolare
  const footOf = (from) => {
    const t = dt(sub(from, sg1), dSg) / dt(dSg, dSg);
    return { t, p: { x: sg1.x + t * dSg.x, y: sg1.y + t * dSg.y } };
  };
  const foot = footOf(rv2).p;
  check('(premessa) il piede della perpendicolare dal vertice cade dentro la retta libera', footOf(rv2).t > 0.1 && footOf(rv2).t < 0.9, String(footOf(rv2).t));
  const cFoot = await clientOfSheet(page, foot);
  await click(page, { x: cFoot.x + 5, y: cFoot.y - 4 });
  await on(alongS(V, dirS(100), 90));
  await on(alongS(V, dirS(300), 60));
  await confirmKeypad(page);
  const op = await lastObj(page);
  // il piede si calcola dal vertice SALVATO (il punto grezzo del clic e' arrotondato dal browser entro RAW_TOL): lo snap parte da quello
  check('Perpendicolare: il secondo punto della quota angolare da tre punti e\' il piede della perpendicolare dal vertice salvato (entro 1e-6 pt)', op?.dim === 'angular' && nearP(sh(op.a), rv2, RAW_TOL) && nearP(sh(op.p1), footOf(sh(op.a)).p, 1e-6), JSON.stringify([op && sh(op.p1), op && footOf(sh(op.a)).p]));
  await undo(page);
  await undo(page); // la retta libera
  await snapOnly(page, []);

  // ORTO sul secondo e sul terzo clic con partenza dal vertice, non sul quarto
  await setToggle(page, 'ortho', true);
  const rv = await on(V);
  const c2 = await clientOfSheet(page, alongS(V, dirS(0), 130));
  const raw2 = await sheetOfClient(page, { x: c2.x, y: c2.y + 9 });
  await click(page, { x: c2.x, y: c2.y + 9 });
  const c3 = await clientOfSheet(page, alongS(V, dirS(90), 120));
  await click(page, { x: c3.x + 7, y: c3.y });
  const raw3 = await sheetOfClient(page, { x: c3.x + 7, y: c3.y });
  const r4 = await on(alongS(V, dirS(315), 75));
  await confirmKeypad(page);
  const oo = await lastObj(page);
  const ssa = sh(oo.a), ss1 = sh(oo.p1), ss2 = sh(oo.p2), ssb = sh(oo.b);
  check('ORTO acceso: il secondo punto sta sulla stessa Y del vertice sul foglio (entro 1e-6 pt), l\'altra coordinata e\' quella del clic', near(ss1.y, ssa.y, 1e-6) && near(ss1.x, raw2.x, RAW_TOL), JSON.stringify([ss1, ssa, raw2]));
  check('ORTO acceso: il terzo punto sta sulla stessa X del vertice (entro 1e-6 pt)', near(ss2.x, ssa.x, 1e-6) && near(ss2.y, raw3.y, RAW_TOL), JSON.stringify([ss2, ssa, raw3]));
  check('ORTO acceso: l\'angolo fra un lato orizzontale e uno verticale e\' 90 gradi (entro 1e-6)', near(angleBetween(sub(ss1, ssa), sub(ss2, ssa)), 90, 1e-6) && (await lastText(page)) === '90.00°', await lastText(page));
  check('ORTO acceso: il quarto punto NON e\' vincolato (il raggio e\' la distanza vera del clic dal vertice)', near(hyp(ssb, ssa), hyp(r4, rv), RAW_TOL) && hyp(r4, rv) > 70, `${hyp(ssb, ssa)} / ${hyp(r4, rv)}`);
  await undo(page);
  await setToggle(page, 'ortho', false);
  await ctx.close();
}

// ---------------------------------------------------------------- 3) scelta dei tratti, vertice fuori dai tratti, linee di estensione, snap
/** Costruisce una quota "da due linee": clic sui due lati e sul punto, tastierino confermato; restituisce {raw, obj, parts}. Lo strumento deve essere gia' armato. */
async function makeLines(page, side1, side2, P) {
  await clickSheet(page, side1);
  if (process.env.E2E_DEBUG) info(`DEBUG dopo il lato 1: "${await hint(page)}" | ${await status(page)}`);
  await clickSheet(page, side2);
  if (process.env.E2E_DEBUG) info(`DEBUG dopo il lato 2: "${await hint(page)}" | ${await status(page)}`);
  const raw = await clickSheet(page, P);
  if (process.env.E2E_DEBUG) info(`DEBUG P=${JSON.stringify(P)} raw=${JSON.stringify(raw)}`);
  if (process.env.E2E_DEBUG) info(`DEBUG dopo il punto: "${await hint(page)}" | ${await status(page)} | tastierino ${await kbdOpen(page)}`);
  await confirmKeypad(page);
  const obj = await lastObj(page);
  return { raw, obj, parts: await drawnParts(page) };
}
const endpoints = (o) => o.points.map(sh);
const pt = (x, y) => ({ x, y });
async function chooseSuite(browser, title) {
  setSection(`scelta dei tratti e linee di estensione, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  await setToggle(page, 'ortho', false);
  await menuInsert(page, MENU_LINES); // PRIMA di misurare lo zoom: la barra contestuale che compare cambia l'altezza del visore e lo zoom di adattamento
  const k = await zoomPx(page);
  const px = (n) => n / k;
  info(`foglio ${G.width.toFixed(1)} x ${G.height.toFixed(1)} pt, zoom ${k.toFixed(3)} px/pt`);
  // La scena e' in pt ASSOLUTI del foglio, dentro 30..370 x 40..510 (entra anche nel CropBox di 400 x 550): non dipende dalla dimensione della pagina.
  const PL = await addPolyline(page, [pt(60, 100), pt(180, 100), pt(180, 230), pt(300, 260)]); // punti del FOGLIO (addPolyline li riporta nello spazio utente)
  const SG = await addSegment(page, pt(40, 200), pt(360, 160));
  const [q0, q1, q2, q3] = endpoints(PL);
  const [g0, g1] = endpoints(SG);
  const onSeg = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  // 1) in una Linea si sceglie il tratto piu' vicino al clic
  const hov = await clientOfSheet(page, onSeg(q1, q2, 0.5));
  await page.mouse.move(hov.x + 3, hov.y);
  await page.waitForTimeout(80);
  const hl = await page.evaluate(() => [...document.querySelectorAll('.sc-hl path')].map((e) => (e.getAttribute('d') || '').split('L').length - 1));
  check('passando sopra una Linea si evidenzia il SOLO tratto piu\' vicino (un segmento: un solo "L" nel tracciato)', hl.length > 0 && hl.every((n) => n === 1), JSON.stringify(hl));
  let r = await makeLines(page, onSeg(q1, q2, 0.3), onSeg(g0, g1, 0.9), pt(230, 120));
  judge('Linea, tratto 2 (verticale) e Retta', r.obj, expectAngle(q1, q2, g0, g1, r.raw));
  check('Linea, tratto 2 e Retta: il vertice e\' nell\'incrocio del tratto 2 con la Retta (non con un altro tratto)', hyp(sh(r.obj.a), crossing(q1, q2, g0, g1).v) < 1e-6 && hyp(crossing(q1, q2, g0, g1).v, crossing(q0, q1, g0, g1).v) > 1);
  await undo(page);
  // i tratti 1 (orizzontale) e 2 (verticale): l'angolo interno della Linea nel vertice P1 e' 90
  r = await makeLines(page, onSeg(q0, q1, 0.5), onSeg(q1, q2, 0.5), pt(q1.x - 40, q1.y + 40));
  judge('Linea, due tratti adiacenti (angolo interno)', r.obj, expectAngle(q0, q1, q1, q2, r.raw));
  check('Linea, due tratti adiacenti: il vertice e\' il vertice della Linea e l\'angolo e\' 90.00°', nearP(sh(r.obj.a), q1, 1e-6) && (await lastText(page)) === '90.00°', `${await lastText(page)}`);
  await undo(page);
  // i tratti 2 e 3 (adiacenti nel vertice P2), settore opposto: i tratti stanno dall'altra parte del vertice
  r = await makeLines(page, onSeg(q1, q2, 0.5), onSeg(q2, q3, 0.5), pt(q2.x - 30, q2.y + 20));
  judge('Linea, tratti 2 e 3, settore opposto (i tratti stanno dall\'altra parte: nessuna semiretta toccata)', r.obj, expectAngle(q1, q2, q2, q3, r.raw));
  await undo(page);

  // 2) il piu' vicino fra due oggetti a portata (anche se quello piu' lontano e' in primo piano)
  const A = await addSegment(page, pt(60, 330), pt(240, 330));
  const B = await addSegment(page, pt(60, 330 + px(7)), pt(240, 330 + px(7))); // 7 px sotto A, creata dopo (in primo piano)
  const C = await addSegment(page, pt(120, 290), pt(200, 390));
  const [a1, a2] = endpoints(A);
  const [b1, b2] = endpoints(B);
  const [c1, c2] = endpoints(C);
  await menuInsert(page, MENU_LINES);
  r = await makeLines(page, pt(100, 330 + px(2)), onSeg(c1, c2, 0.5), pt(190, 300));
  judge('piu\' vicino: clic a 2 px da A e 5 px da B (B in primo piano): sceglie A', r.obj, expectAngle(a1, a2, c1, c2, r.raw));
  check('piu\' vicino: l\'incrocio e\' con A, non con B', hyp(sh(r.obj.a), crossing(a1, a2, c1, c2).v) < 1e-6 && hyp(sh(r.obj.a), crossing(b1, b2, c1, c2).v) > 0.5);
  await undo(page);
  r = await makeLines(page, pt(100, 330 + px(6)), onSeg(c1, c2, 0.5), pt(190, 300));
  judge('piu\' vicino: clic a 6 px da A e 1 px da B: sceglie B', r.obj, expectAngle(b1, b2, c1, c2, r.raw));
  await undo(page);

  // nessun oggetto a portata: a 12 px (mouse: tolleranza 10 px) niente; a 8 px si
  await clickSheet(page, pt(100, 330 - px(12)));
  check('a 12 px da ogni retta (tolleranza del mouse 10 px): nessun lato scelto, messaggio, testo guida invariato', /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la prima linea' && (await selCount(page)) === 0, await status(page));
  await clickSheet(page, pt(100, 330 - px(8)));
  check('a 8 px: il lato e\' scelto', (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, await hint(page));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  check('Esc azzera: nessun lato evidenziato, "scegli la prima linea"', (await hint(page)) === 'Quota angolare: scegli la prima linea' && (await selCount(page)) === 0);

  // Cerchi, Archi, Coperture, Testi e Quote non si scelgono (oggetti in pt assoluti, in zone libere)
  const stroke = { style: 'solid', color: '#2E7D32', widthPt: 1 };
  await page.evaluate(([list]) => window.__gtpdf.add(1, list), [[
    { kind: 'circle', p1: us(pt(340, 440)), p2: us(pt(365, 440)), stroke },
    { kind: 'arc', p1: us(pt(40, 430)), p2: us(pt(70, 405)), p3: us(pt(100, 430)), stroke },
    { kind: 'cover', shape: 'rect', p1: us(pt(200, 430)), p2: us(pt(260, 470)) },
    { kind: 'text', at: us(pt(40, 480)), text: 'TESTO', textPt: 14, color: '#6A1B9A' },
    { kind: 'dim', dim: 'diameter', p1: us(pt(150, 500)), p2: us(pt(300, 500)), a: us(pt(150, 500)), b: us(pt(300, 500)), valueText: '12', color: '#6A1B9A', widthPt: 1, textPt: 10 },
  ]]);
  const targets = [
    ['un Cerchio', pt(365, 440)],
    ['un Arco', pt(70, 405)],
    ['una Copertura', pt(230, 450)],
    ['un Testo', pt(52, 476)],
    ['una Quota', pt(225, 500)],
  ];
  for (const [name, at] of targets) {
    await clickSheet(page, at);
    check(`un clic su ${name}: non si sceglie (messaggio, nessun cambio di stato)`, /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la prima linea' && (await selCount(page)) === 0, `${await status(page)} / ${await hint(page)}`);
  }

  // 3) rette parallele e sulla stessa retta: rifiutate, la prima resta scelta
  const E = await addSegment(page, pt(60, 365), pt(240, 365)); // parallela ad A
  const F = await addSegment(page, pt(262, 330), pt(340, 330)); // sulla stessa retta di A
  const [e1, e2] = endpoints(E);
  const [f1, f2] = endpoints(F);
  await clickSheet(page, onSeg(a1, a2, 0.3));
  await clickSheet(page, onSeg(e1, e2, 0.5));
  check('due rette parallele: rifiutate con un messaggio chiaro, la prima resta scelta', /parallele/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, await status(page));
  await clickSheet(page, onSeg(f1, f2, 0.5));
  check('due rette sulla stessa retta (tratti diversi): rifiutate', /parallele \(o sulla stessa retta\)/.test(await status(page)) && (await hint(page)) === 'Quota angolare: scegli la seconda linea', await status(page));
  await clickSheet(page, onSeg(c1, c2, 0.5));
  check('poi si sceglie una retta non parallela: si va avanti', (await hint(page)) === 'Quota angolare: indica dove mettere l\'arco', await hint(page));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  // 4) vertice fuori dai tratti: linee di estensione solo dove servono. V = (270, 400): S1 orizzontale a sinistra (distanze 120..170), S2 verticale in alto (distanze 60..160)
  const S1 = await addSegment(page, pt(100, 400), pt(150, 400));
  const S2 = await addSegment(page, pt(270, 340), pt(270, 240));
  const [s11, s12] = endpoints(S1);
  const [s21, s22] = endpoints(S2);
  const Vx = crossing(s11, s12, s21, s22).v;
  check('(premessa) il vertice (270, 400) sta fuori da entrambi i tratti', nearP(Vx, pt(270, 400), 1e-6), JSON.stringify(Vx));
  const cases = [
    ['R piccolo (30 pt: i tratti iniziano oltre l\'arco): due linee di estensione che tornano indietro', 30, 3],
    ['R dentro i tratti (140 pt): i lati toccano l\'arco, nessuna linea di estensione', 140, 1],
    ['R oltre la fine dei tratti (260 pt): due linee di estensione che escono verso l\'arco', 260, 3],
  ];
  await menuInsert(page, MENU_LINES);
  for (const [name, R, paths] of cases) {
    r = await makeLines(page, onSeg(s11, s12, 0.5), onSeg(s21, s22, 0.5), pt(Vx.x - R * 0.7, Vx.y - R * 0.7)); // settore fra la semiretta verso sinistra e quella verso l'alto
    judge(name, r.obj, expectAngle(s11, s12, s21, s22, r.raw));
    check(`${name}: nel disegno ${paths} linee (arco${paths > 1 ? ' + estensioni' : ''}), 2 frecce, 1 riquadro, il testo "90.00°"`, r.parts && r.parts.paths === paths && r.parts.polygons === 2 && r.parts.rects === 1 && r.parts.texts.join('') === '90.00°', JSON.stringify(r.parts));
    await undo(page);
  }
  // settore dalla parte opposta ai tratti: i lati non toccano le semirette scelte; le linee di estensione partono vicino al vertice
  r = await makeLines(page, onSeg(s11, s12, 0.5), onSeg(s21, s22, 0.5), pt(Vx.x + 50, Vx.y + 40));
  judge('settore dalla parte opposta ai tratti', r.obj, expectAngle(s11, s12, s21, s22, r.raw));
  check('settore dalla parte opposta ai tratti: arco + due linee di estensione dal vertice', r.parts && r.parts.paths === 3, JSON.stringify(r.parts));
  await undo(page);

  // 5) snap sul punto dell'arco: con l'Estremo acceso il terzo punto va sull'estremo di una retta libera
  const T = await addSegment(page, pt(60, 450), pt(150, 470));
  const [t1] = endpoints(T);
  await snapOnly(page, ['end']);
  await clickSheet(page, onSeg(s11, s12, 0.5));
  await clickSheet(page, onSeg(s21, s22, 0.5));
  const cT = await clientOfSheet(page, t1);
  await click(page, { x: cT.x + 4, y: cT.y - 3 });
  await confirmKeypad(page);
  const os = await lastObj(page);
  check('snap: con l\'Estremo acceso il punto dell\'arco e\' l\'estremo della retta libera (entro 1e-6 pt): il raggio e\' la distanza dal vertice', os?.dim === 'angular' && near(hyp(sh(os.b), sh(os.a)), hyp(t1, Vx), 1e-6), `${os ? hyp(sh(os.b), sh(os.a)) : ''} / ${hyp(t1, Vx)}`);
  await undo(page);
  await ctx.close();
}

// ---------------------------------------------------------------- 4) pagina NON calibrata, valore digitato con il simbolo °
/** Due rette a 45 gradi (sul foglio) per un punto fisso e il punto che sceglie il settore da 45; restituisce i tratti e il punto. */
async function twoLines(page, V = { x: 200, y: 300 }) {
  const o1 = await addSegment(page, alongS(V, dirS(0), -120), alongS(V, dirS(0), 120));
  const o2 = await addSegment(page, alongS(V, dirS(45), -120), alongS(V, dirS(45), 120));
  return { V, o1, o2, s1: alongS(V, dirS(0), 90), s2: alongS(V, dirS(45), 90), P: alongS(V, dirS(22.5), 70) };
}
async function scaleSuite(browser, title) {
  setSection(`pagina non calibrata e calibrata, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  const st0 = await state(page);
  check('(premessa) la pagina NON e\' calibrata', st0.pages[0].scale === null, JSON.stringify(st0.pages[0].scale));
  const L = await twoLines(page);
  // una quota allineata sulla pagina non calibrata: come prima, il tastierino lo dice
  await tool(page, 'Quota');
  await page.locator('.ctx-types button', { hasText: 'Allineata' }).click();
  await clickSheet(page, pt(60, 60));
  await clickSheet(page, pt(160, 60));
  await clickSheet(page, pt(100, 30));
  const infoAligned = await page.locator('.keypad').innerText();
  check('(riferimento) la quota allineata su pagina non calibrata dice "Pagina non calibrata: digita il valore in mm" (comportamento invariato)', /Pagina non calibrata: digita il valore in mm/.test(infoAligned), infoAligned.slice(0, 160));
  await dropEntry(page);
  // la quota angolare: nessun avviso di scala, valore automatico
  await menuInsert(page, MENU_LINES);
  await clickSheet(page, L.s1);
  await clickSheet(page, L.s2);
  await clickSheet(page, L.P);
  const infoAng = await page.locator('.keypad').innerText();
  check('quota angolare su pagina non calibrata: il tastierino NON dice "Pagina non calibrata", propone il valore automatico', !/non calibrata/.test(infoAng) && /Automatico 45\.00° · gradi decimali/.test(infoAng) && infoAng.includes('45.00°'), infoAng.slice(0, 200));
  await confirmKeypad(page);
  let st = await state(page);
  const texts = st.pages[0].texts.flat();
  check('quota angolare su pagina non calibrata: il testo e\' "45.00°", nessun "?" in nessuna etichetta', texts.at(-1) === '45.00°' && !texts.some((t) => t.includes('?')), JSON.stringify(texts));
  const dom = await drawnParts(page);
  check('... e sul foglio il testo e\' "45.00°" (nessun "?")', dom?.texts.join('') === '45.00°', JSON.stringify(dom));
  const r1 = await page.evaluate(async () => { const x = await window.__gtpdf.runExport({ mode: 'simple', keep: true }); return { warnings: x.warnings, objectCount: x.objectCount }; });
  check('Esporta (Copertura semplice) la quota angolare su pagina non calibrata: NESSUN avviso (niente "valore con ?")', r1.warnings.length === 0 && r1.objectCount >= 1, JSON.stringify(r1));
  // con una scala il valore dell'angolo non cambia
  const mm = 0.25;
  await page.evaluate((v) => window.__gtpdf.setScale(1, v), mm);
  await page.waitForTimeout(150);
  st = await state(page);
  check('dopo la calibrazione della pagina la quota angolare dice ancora "45.00°" (non dipende dalla scala)', st.pages[0].scale !== null && st.pages[0].texts.flat().at(-1) === '45.00°' && !st.pages[0].texts.flat().some((t) => t.includes('?')), JSON.stringify(st.pages[0].texts));
  const r2 = await page.evaluate(async () => { const x = await window.__gtpdf.runExport({ mode: 'simple', keep: true }); return { warnings: x.warnings }; });
  check('... ed e\' esportabile senza avvisi', r2.warnings.length === 0, JSON.stringify(r2));
  await undo(page); // la scala
  await undo(page); // la quota angolare
  await ctx.close();
}

async function typedSuite(browser, title) {
  setSection(`valore digitato con il simbolo °, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  const L = await twoLines(page);
  await menuInsert(page, MENU_LINES);
  await clickSheet(page, L.s1);
  await clickSheet(page, L.s2);
  await clickSheet(page, L.P);
  const keys = (await page.locator('.kp-key').allInnerTexts()).map((x) => x.trim());
  check('il tastierino numerico ha il tasto "°" (e le cifre, il punto, "Ø", "R", "±")', ['°', 'Ø', 'R', '±', '0', '9', '.'].every((c) => keys.includes(c)), JSON.stringify(keys));
  const dec = '.';
  // si digita 44.5° : il primo tasto sostituisce il valore proposto
  await confirmKeypad(page, ['4', '4', dec, '5', '°']);
  let o = await lastObj(page);
  check('digitato "44.5°": la quota ha valueText "44.5°" (accettato e normalizzato) e il foglio dice "44.5°"', o?.dim === 'angular' && o.valueText === '44.5°' && (await lastText(page)) === '44.5°', JSON.stringify([o?.valueText, await lastText(page)]));
  check('... e l\'angolo vero dei punti e\' ancora 45 gradi (il testo digitato non cambia la geometria)', near(angleBetween(sub(sh(o.p1), sh(o.a)), sub(sh(o.p2), sh(o.a))), 45, 1e-6));
  await undo(page);
  // digitando esattamente il valore automatico (45.00°) il valore resta automatico (valueText null)
  await clickSheet(page, L.s1);
  await clickSheet(page, L.s2);
  await clickSheet(page, L.P);
  await confirmKeypad(page, ['4', '5', dec, '0', '0', '°']);
  o = await lastObj(page);
  check('digitando esattamente "45.00°" (uguale all\'automatico) valueText resta null', o?.dim === 'angular' && o.valueText === null && (await lastText(page)) === '45.00°', JSON.stringify([o?.valueText, await lastText(page)]));
  await undo(page);
  // valore senza cifre: rifiutato dal tastierino
  await clickSheet(page, L.s1);
  await clickSheet(page, L.s2);
  await clickSheet(page, L.P);
  await page.locator('.kp-key', { hasText: /^°$/ }).first().click();
  await page.locator('.kp-ok').click();
  await page.waitForTimeout(150);
  check('un valore senza cifre ("°") non si conferma: il tastierino resta aperto e dice perche\'', (await kbdOpen(page)) && /almeno una cifra/.test(await page.locator('.keypad').innerText()), (await page.locator('.keypad').innerText()).slice(0, 200));
  await dropEntry(page);
  check('Annulla del tastierino: nessuna quota in piu\'', (await objectsOf(page)).length === 2 && (await hint(page)) === 'Quota angolare: scegli la prima linea', await hint(page));
  await ctx.close();
}

// ---------------------------------------------------------------- 5) Sposta, Specchio, Rotazione, Duplica, stile, Cancella, Canc, Annulla e Ripeti sulla quota
const selectIdsHook = (page, list) => page.evaluate((l) => window.__gtpdf.selectIds(l), list);
const armBtn = async (page, name) => {
  await page.locator('.ctx-tr', { hasText: name }).click();
  await page.waitForTimeout(100);
};
async function typeAngle(page, text) {
  const inp = page.locator('.ctx-angle-input');
  await inp.click();
  await inp.fill(text);
  await inp.press('Enter');
  await page.waitForTimeout(120);
}
const pts4 = (o) => ['p1', 'p2', 'a', 'b'].map((k) => sh(o[k]));
const rotCcw = (p, c, deg) => {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const co = Math.cos(deg * DEG);
  const si = Math.sin(deg * DEG);
  return { x: c.x + dx * co + dy * si, y: c.y - dx * si + dy * co }; // antiorario come si vede (Y in giu')
};
const objById = async (page, id) => (await objectsOf(page)).find((o) => o.id === id);
async function modifySuite(browser, title) {
  setSection(`modifiche della quota angolare, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  await setToggle(page, 'ortho', false);
  const L = await twoLines(page, { x: 220, y: 260 });
  // la quota da due linee: costruita con l'interfaccia
  await menuInsert(page, MENU_LINES);
  const made = await makeLines(page, L.s1, L.s2, L.P);
  const Q = made.obj;
  const base = JSON.stringify(Q);
  const text0 = await lastText(page);
  check('(premessa) la quota angolare e\' stata creata dall\'interfaccia ("45.00°")', Q?.dim === 'angular' && text0 === '45.00°', `${text0}`);

  // statica: spostare o cancellare una delle linee d'origine non cambia la quota
  await tool(page, 'Seleziona');
  await click(page, await clientOfSheet(page, L.s1), 0, 0);
  await armBtn(page, 'Sposta');
  const rawA = await clickSheet(page, pt(300, 400));
  const rawB = await clickSheet(page, pt(310, 430));
  check('(statica) spostando una delle due linee la quota non cambia (nessun riferimento all\'oggetto)', JSON.stringify(await objById(page, Q.id)) === base && (await lastText(page)) === text0 && hyp(rawA, rawB) > 20, JSON.stringify(await objById(page, Q.id)));
  await undo(page);
  await tool(page, 'Cancella');
  await click(page, await clientOfSheet(page, L.s2));
  check('(statica) cancellando una delle due linee la quota resta com\'e\'', (await objectsOf(page)).length === 2 && JSON.stringify(await objById(page, Q.id)) === base, `${(await objectsOf(page)).length}`);
  await undo(page);

  // si sceglie con un clic sull'arco; il testo della barra lo dice
  await tool(page, 'Seleziona');
  await click(page, await clientOfSheet(page, sh(Q.b)));
  check('Seleziona: un clic sull\'arco sceglie la quota angolare (il testo della barra lo dice, nessun altro oggetto)', /Quota angolare/.test(await hint(page)), await hint(page));
  const sel = await page.evaluate(() => window.__gtpdf.selection());
  check('... ed e\' la sola selezionata', Array.isArray(sel) && sel.length === 1 && sel[0] === Q.id, JSON.stringify(sel));

  // Sposta: tutti i quattro punti si spostano dello stesso vettore, il valore non cambia
  await armBtn(page, 'Sposta');
  const m1 = await clickSheet(page, pt(100, 420));
  const m2 = await clickSheet(page, pt(160, 395));
  let o = await objById(page, Q.id);
  const dlt = { x: m2.x - m1.x, y: m2.y - m1.y };
  const before = pts4(JSON.parse(base));
  const after = pts4(o);
  check('Sposta: i quattro punti (p1, p2, vertice, arco) si spostano del vettore dei due clic (entro 0.1 pt)', after.every((p, i) => near(p.x, before[i].x + dlt.x, 0.1) && near(p.y, before[i].y + dlt.y, 0.1)), JSON.stringify([after, before, dlt]));
  check('Sposta: stesso id, stesso valore ("45.00°"), stessi colore e spessore', o.id === Q.id && (await lastText(page)) === text0 && o.color === Q.color && o.widthPt === Q.widthPt && o.valueText === Q.valueText);
  await undo(page);
  check('Annulla di Sposta rimette la quota com\'era', JSON.stringify(await objById(page, Q.id)) === base);
  await redo(page);
  check('Ripeti di Sposta la rimette spostata', JSON.stringify(pts4(await objById(page, Q.id))) === JSON.stringify(after));
  await undo(page);

  // Specchio con asse orizzontale (ORTO acceso: il secondo punto dell'asse ha la stessa Y del primo): il settore e l'arco sono quelli speculari, il valore lo stesso
  await selectIdsHook(page, [Q.id]);
  await setToggle(page, 'ortho', true);
  await armBtn(page, 'Specchio');
  const ax1 = await clickSheet(page, pt(60, 360));
  await clickSheet(page, pt(160, 363));
  await setToggle(page, 'ortho', false);
  o = await objById(page, Q.id);
  const mir = pts4(o);
  check('Specchio (asse orizzontale): i quattro punti sono i simmetrici rispetto alla Y dell\'asse (entro 0.1 pt)', mir.every((p, i) => near(p.x, before[i].x, 0.1) && near(p.y, 2 * ax1.y - before[i].y, 0.1)), JSON.stringify([mir, before, ax1]));
  check('Specchio: il valore e\' lo stesso (45.00°) e l\'angolo dei punti e\' ancora 45 gradi (isometria)', (await lastText(page)) === text0 && near(angleBetween(sub(mir[0], mir[2]), sub(mir[1], mir[2])), 45, 1e-6));
  const drawnM = await drawnParts(page);
  check('Specchio: arco, frecce, riquadro e testo ci sono ancora (disegno rifatto)', drawnM && drawnM.polygons === 2 && drawnM.rects === 1 && drawnM.texts.join('') === '45.00°', JSON.stringify(drawnM));
  await undo(page);

  // Rotazione di 30 gradi attorno a un centro: i quattro punti ruotati (antiorario), il valore lo stesso
  await selectIdsHook(page, [Q.id]);
  await armBtn(page, 'Rotazione');
  const rc = await clickSheet(page, pt(200, 330));
  await typeAngle(page, '30');
  o = await objById(page, Q.id);
  const rot = pts4(o);
  check('Rotazione di 30 gradi: i quattro punti sono ruotati attorno al centro (entro 0.1 pt, antiorario come si vede)', rot.every((p, i) => hyp(p, rotCcw(before[i], rc, 30)) < 0.1), JSON.stringify([rot, before.map((p) => rotCcw(p, rc, 30))]));
  check('Rotazione: il valore e\' lo stesso (45.00°) e la quota non e\' stata rifiutata (nessun vincolo per l\'angolare)', (await lastText(page)) === text0 && !/non ruotano|rifiutat/i.test(await status(page)), await status(page));
  await undo(page);

  // Duplica (menu Modifica): una copia con id nuovo, stessi punti e valore; Annulla la toglie
  await selectIdsHook(page, [Q.id]);
  await menuInsert2(page, 'Modifica', /^Duplica selezione/);
  const objs2 = await objectsOf(page);
  const copy = objs2.at(-1);
  check('Duplica: una quota angolare in piu\' (sul posto), con id nuovo e gli stessi dati', objs2.length === 4 && copy.id !== Q.id && copy.dim === 'angular' && JSON.stringify({ ...copy, id: 0 }) === JSON.stringify({ ...Q, id: 0 }), JSON.stringify(copy));
  await undo(page);
  check('Annulla di Duplica toglie la copia', (await objectsOf(page)).length === 3);

  // stile: colore, spessore, corpo del testo sulla selezione (un solo comando ciascuno)
  await selectIdsHook(page, [Q.id]);
  await page.waitForTimeout(150);
  const swatch = page.locator('.swatches .swatch[aria-pressed="false"]').first();
  const hex = ((await swatch.getAttribute('aria-label')) || '').match(/#[0-9A-Fa-f]{6}/)?.[0];
  await swatch.click();
  await page.waitForTimeout(100);
  o = await objById(page, Q.id);
  check(`stile: il colore ${hex} passa alla quota (linee e frecce)`, hex && o.color.toLowerCase() === hex.toLowerCase(), `${o.color} / ${hex}`);
  const wBtn = page.locator('.presets[aria-label^="Spessori"] .preset[aria-pressed="false"]').nth(2);
  const wVal = Number(((await wBtn.innerText()) || '').replace(',', '.'));
  await wBtn.click();
  await page.waitForTimeout(100);
  o = await objById(page, Q.id);
  check(`stile: lo spessore ${wVal} pt passa alla quota`, o.widthPt === wVal, `${o.widthPt}`);
  const tBtn = page.locator('.presets[aria-label^="Altezza del testo"] .preset[aria-pressed="false"]').nth(1);
  const tVal = Number(((await tBtn.innerText()) || '').replace(',', '.'));
  await tBtn.click();
  await page.waitForTimeout(100);
  o = await objById(page, Q.id);
  check(`stile: il corpo del testo ${tVal} pt passa alla quota; il valore non cambia`, o.textPt === tVal && (await lastText(page)) === text0, `${o.textPt}`);
  await undo(page);
  await undo(page);
  await undo(page);
  check('Annulla tre volte rimette lo stile di prima', JSON.stringify(await objById(page, Q.id)) === base);

  // Cancella: lo strumento sull'arco, e Canc con Seleziona; un solo passo di Annulla
  await tool(page, 'Cancella');
  await click(page, await clientOfSheet(page, sh(Q.b)));
  check('Cancella: un clic sull\'arco cancella la quota (messaggio "Quota cancellata")', (await objectsOf(page)).length === 2 && /Quota cancellata/.test(await status(page)), await status(page));
  await undo(page);
  check('Annulla ripristina la quota com\'era', JSON.stringify(await objById(page, Q.id)) === base);
  await tool(page, 'Seleziona');
  await click(page, await clientOfSheet(page, sh(Q.b)));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  check('Canc su Seleziona cancella la quota; Ripeti/Annulla un solo passo', (await objectsOf(page)).length === 2 && /Quota cancellata/.test(await status(page)), await status(page));
  await undo(page);
  check('Annulla di Canc la rimette com\'era', JSON.stringify(await objById(page, Q.id)) === base);
  await ctx.close();
}
async function menuInsert2(page, menu, re) {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.locator('.menu-item').filter({ hasText: re }).click();
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------- 6) progetto: versione 4, riapertura, file di versione 3, rifiuti
async function projectSuite(browser, title, file) {
  setSection(`progetto versione 4 con quote angolari, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  await snapOnly(page, []);
  const sample = readFileSync(join(PDF_DIR, file));
  const text = (loc) => loc.innerText().then((x) => x.replace(/\s+/g, ' ').trim());
  const L = await twoLines(page, { x: 220, y: 260 });
  await menuInsert(page, MENU_LINES);
  const q1 = (await makeLines(page, L.s1, L.s2, L.P)).obj; // automatica
  await menuInsert(page, MENU_POINTS);
  const V = pt(150, 420);
  await clickSheet(page, V);
  await clickSheet(page, alongS(V, dirS(15), 110));
  await clickSheet(page, alongS(V, dirS(100), 90));
  await clickSheet(page, alongS(V, dirS(300), 60));
  await confirmKeypad(page, ['4', '4', '.', '5', '°']); // digitata
  const q2 = await lastObj(page);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'dim', dim: 'aligned', pts: [[0.2, 0.2], [0.5, 0.2], [0.35, 0.14]], value: '5' }]));
  const aligned = await lastObj(page);
  check('(premessa) due quote angolari (da due linee, automatica; da tre punti, "44.5°") e una allineata', q1?.dim === 'angular' && q1.valueText === null && q2?.dim === 'angular' && q2.valueText === '44.5°' && aligned?.dim === 'aligned', JSON.stringify([q1?.dim, q2?.dim, aligned?.dim]));
  const S0 = await state(page);
  const text0 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  const j = JSON.parse(text0);
  const jq = j.pages[0].objects.find((o) => o.id === q1.id);
  const ja = j.pages[0].objects.find((o) => o.id === aligned.id);
  check('il progetto scritto e\' di versione 4 (format "gt-pdf-project") con gli stessi campi di pagina', j.version === 4 && j.format === 'gt-pdf-project' && JSON.stringify(Object.keys(j.pages[0])) === JSON.stringify(['number', 'view', 'rotate', 'userUnit', 'scale', 'origin', 'objects']), `${j.version}`);
  check('la quota angolare nel file ha gli stessi campi delle altre quote (nessun campo nuovo: dim "angular", p1, p2, a, b, valueText, colore, spessore, corpo), nessun riferimento alle linee', JSON.stringify(Object.keys(jq)) === JSON.stringify(Object.keys(ja)) && jq.dim === 'angular' && !/ref|source|sides|line/i.test(JSON.stringify(Object.keys(jq))), JSON.stringify(Object.keys(jq)));
  check('il valore digitato si salva com\'e\' ("44.5°") e l\'automatico come null', j.pages[0].objects.find((o) => o.id === q2.id).valueText === '44.5°' && jq.valueText === null);
  // salva dall'interfaccia
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
  const openProject = async (json, jsonName) => {
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: jsonName, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.locator('.open-project-dialog').waitFor();
    const summary = await text(page.locator('.open-project-dialog'));
    const second = page.waitForEvent('filechooser');
    await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
    await (await second).setFiles({ name: file, mimeType: 'application/pdf', buffer: Buffer.from(sample) });
    await page.waitForTimeout(900);
    return summary;
  };
  await closeDoc();
  await openProject(saved, 'progetto-v4.json');
  const S1 = await state(page);
  check('riaperto il progetto: le quote angolari sono UGUALI (tutti i punti, valueText, stile) e il testo sul foglio e\' lo stesso', canon(S1.pages[0].objects) === canon(S0.pages[0].objects) && JSON.stringify(S1.pages[0].texts) === JSON.stringify(S0.pages[0].texts), `${S1.pages[0].objects.length}`);
  const text1 = await page.evaluate(async () => (await window.__gtpdf.projectText()).text);
  check('il progetto riscritto dopo la riapertura e\' identico (versione 4)', JSON.parse(text1).version === 4 && JSON.stringify(JSON.parse(text1).pages) === JSON.stringify(j.pages));
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  const dr = await drawnParts(page);
  void dr;

  // un progetto di versione 3 (fixture scritta dal codice di 57f82e8) si apre uguale e si riscrive come 4
  const v3 = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'project', 'fixtures', 'project-v3-57f82e8.json'), 'utf8'));
  const f = JSON.parse(JSON.stringify(v3));
  f.pdf = j.pdf;
  f.pages = [{ ...f.pages[0], view: j.pages[0].view, rotate: j.pages[0].rotate, userUnit: j.pages[0].userUnit }]; // la fixture ha pagine diverse dal PDF di prova: si adatta, tenendo oggetti, scala e origine
  await closeDoc();
  await openProject(JSON.stringify(f), 'progetto-v3.json');
  const S3 = await state(page);
  check('un progetto di VERSIONE 3 si apre uguale: gli oggetti sono quelli del file e l\'origine e\' quella del file', JSON.stringify(S3.pages[0].objects) === JSON.stringify(f.pages[0].objects) && nearP(S3.pages[0].origin, f.pages[0].origin, 1e-12), `${S3.pages[0].objects.length}`);
  const t3 = JSON.parse(await page.evaluate(async () => (await window.__gtpdf.projectText()).text));
  check('... e riscritto e\' di versione 4 con gli stessi oggetti, la stessa origine e la stessa scala', t3.version === 4 && JSON.stringify(t3.pages[0].objects) === JSON.stringify(f.pages[0].objects) && nearP(t3.pages[0].origin, f.pages[0].origin, 1e-12) && JSON.stringify(t3.pages[0].scale) === JSON.stringify(f.pages[0].scale));

  // rifiuti: quota angolare in un file di versione 1, 2 o 3; quota non valida; versione 5
  const reject = async (name, mutate, re) => {
    const bad = JSON.parse(saved.toString('utf8'));
    mutate(bad);
    await closeDoc();
    const first = page.waitForEvent('filechooser');
    await menuItem(page, 'File', /^Apri progetto/);
    await (await first).setFiles({ name: 'cattivo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check(name, re.test(body), body.slice(0, 220));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  const angularIdx = (b) => b.pages[0].objects.findIndex((o) => o.dim === 'angular') + 1;
  for (const v of [3, 2, 1]) {
    await reject(`un file di versione ${v} che contiene una quota angolare e' rifiutato con un messaggio che dice dove`, (b) => {
      b.version = v;
      if (v < 3) for (const pg of b.pages) delete pg.origin;
      if (v < 2) b.pages[0].objects = b.pages[0].objects.filter((o) => o.kind !== 'circle' && o.kind !== 'arc');
    }, new RegExp(`pagina 1, oggetto \\d+: un progetto di versione ${v} non ha le quote angolari: sono della versione 4\\.`));
  }
  void angularIdx;
  await reject('una quota angolare con i lati sulla stessa retta e\' rifiutata ("quota angolare non valida")', (b) => {
    const o = b.pages[0].objects.find((x) => x.dim === 'angular');
    o.p2 = { x: o.a.x + 2 * (o.p1.x - o.a.x), y: o.a.y + 2 * (o.p1.y - o.a.y) };
  }, /pagina 1, oggetto \d+: quota angolare non valida: i due lati sono sulla stessa retta/);
  await reject('una quota angolare con il vertice sul punto di un lato e\' rifiutata', (b) => {
    const o = b.pages[0].objects.find((x) => x.dim === 'angular');
    o.p1 = { ...o.a };
  }, /quota angolare non valida: p1 coincide con il vertice a/);
  await reject('un file di versione 5: "questa app legge le versioni 1, 2, 3 e 4"', (b) => (b.version = 5), /versione piu' recente \(5\): questa app legge le versioni 1, 2, 3 e 4\. Aggiorna l'app\./);
  await ctx.close();
}
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

// ---------------------------------------------------------------- 7) esportazione: "Copertura semplice" e "Appiattito"
// Soglie del confronto delle rese: le stesse di e2e-cp6c (inchiostri a 2 px per pt; "Appiattito" con l'inviluppo di e2e-cp5b)
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
/** Una quota angolare completa nello spazio utente, descritta NEL FOGLIO: vertice, lati a `t1` e `t2` gradi con i punti a distanza r1 e r2, raggio R (b = punto di mezzo dell'arco). */
const angularObject = (V, t1, t2, r1, r2, R, valueText = null) => {
  const mid = unit({ x: dirS(t1).x + dirS(t2).x, y: dirS(t1).y + dirS(t2).y });
  return { kind: 'dim', dim: 'angular', p1: us(alongS(V, dirS(t1), r1)), p2: us(alongS(V, dirS(t2), r2)), a: us(V), b: us(alongS(V, mid, R)), valueText, color: '#D32F2F', widthPt: 1, textPt: 10 };
};
async function exportSuite(browser, harness, title, file) {
  setSection(`esportazione con quote angolari, ${title}`);
  // finestra grande (2800 x 2000) e zoom 2 px/pt: lo schermo e il PDF reso da PDF.js hanno lo STESSO ingrandimento (come e2e-cp6c)
  const { ctx, page } = await newApp(browser);
  try {
    await openSample(page, title);
    G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
    const origBytes = readFileSync(join(PDF_DIR, file));
    await showPage(page, 1);
    const A0 = (await shot(page)).buf;
    await page.evaluate(([list]) => window.__gtpdf.add(1, list), [[
      angularObject(pt(200, 300), 0, 45, 90, 90, 90), // 45 gradi, automatica, i lati toccano l'arco
      angularObject(pt(200, 470), 20, 140, 150, 40, 70, '44.5°'), // 120 gradi, digitata, con linee di estensione
      angularObject(pt(60, 140), 0, 10, 60, 60, 60), // 10 gradi: arco corto, frecce fuori
    ]]);
    await showPage(page, 1);
    const A = (await shot(page)).buf;
    const st = await state(page);
    check('(premessa) tre quote angolari con i testi "45.00°", "44.5°" e "10.00°" (pagina non calibrata)', JSON.stringify(st.pages[0].texts.flat()) === JSON.stringify(['45.00°', '44.5°', '10.00°']) && st.pages[0].scale === null, JSON.stringify(st.pages[0].texts));
    const hp = await harness.newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    const url = (buf) => `data:image/png;base64,${b64(buf)}`;
    const b0 = await hp.evaluate(([d, k, z]) => window.renderPage(d, k, z), [b64(origBytes), 1, ZOOM]);
    for (const [mode, label, opts] of [['simple', 'Copertura semplice', { mode: 'simple' }], ['flat', 'Appiattito (PNG 300 dpi)', { mode: 'flat', dpi: 300, format: 'png' }]]) {
      const r = await page.evaluate(async (o) => { const x = await window.__gtpdf.runExport({ ...o, keep: true }); return { warnings: x.warnings, objectCount: x.objectCount, touchedPages: x.touchedPages }; }, opts);
      const b64pdf = await page.evaluate(() => window.__gtpdf.lastExportBase64());
      const bytes = Buffer.from(b64pdf, 'base64');
      writeFileSync(join(OUT, `${file.replace('.pdf', '')}-angolare-${mode}.pdf`), bytes);
      check(`${label}: esportazione riuscita con 3 quote angolari su 1 pagina, nessun avviso (pagina non calibrata)`, r.objectCount === 3 && r.touchedPages === 1 && r.warnings.length === 0, JSON.stringify(r));
      const bb = await hp.evaluate(([d, k, z]) => window.renderPage(d, k, z), [b64pdf, 1, ZOOM]);
      if (mode === 'simple') {
        const items = await hp.evaluate(([d, k]) => window.textOf(d, k), [b64pdf, 1]);
        check(`${label}: il testo del PDF contiene "45.00°", "44.5°" e "10.00°" (simbolo ° giusto, un testo per quota) e nessun "?"`, ['45.00°', '44.5°', '10.00°'].every((t) => items.includes(t)) && !items.some((t) => t.includes('?')), JSON.stringify(items.filter((t) => /°|\?/.test(t))));
        const m = await hp.evaluate(([a0, a, b0u, bu, T, tol]) => window.compare(a0, a, b0u, bu, T, tol), [url(A0), url(A), b0, bb, INK_T, TOL_PX]);
        writeFileSync(join(OUT, `${file.replace('.pdf', '')}-angolare-${mode}-A_B_diff.png`), Buffer.from(m.image.split(',')[1], 'base64'));
        info(`${label}, ${title}: inchiostro app ${m.nA} px, PDF ${m.nB} px | entro ${TOL_PX} px: ${(m.matchA * 100).toFixed(2)} % (app->PDF), ${(m.matchB * 100).toFixed(2)} % (PDF->app) | p99 ${m.p99A.toFixed(2)}/${m.p99B.toFixed(2)} px, max ${m.maxA.toFixed(1)}/${m.maxB.toFixed(1)} px, rapporto ${(m.nB / m.nA).toFixed(3)}`);
        check(`${label}: archi, frecce e linee di estensione disegnati: inchiostro presente nell'app e nel PDF`, m.nA > 500 && m.nB > 500, `${m.nA}/${m.nB}`);
        check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro dell'app entro ${TOL_PX} px da quello del PDF`, m.matchA >= MIN_MATCH, `${(m.matchA * 100).toFixed(2)} %`);
        check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro del PDF entro ${TOL_PX} px da quello dell'app`, m.matchB >= MIN_MATCH, `${(m.matchB * 100).toFixed(2)} %`);
        check(`${label}: quantita' di inchiostro del PDF / dell'app tra ${INK_RATIO[0]} e ${INK_RATIO[1]}`, m.nB / m.nA >= INK_RATIO[0] && m.nB / m.nA <= INK_RATIO[1], (m.nB / m.nA).toFixed(3));
        check(`${label}: nessun pezzo di inchiostro a piu' di ${MAX_FAR_PX} px dall'altro (massimo ${Math.max(m.maxA, m.maxB).toFixed(1)} px)`, Math.max(m.maxA, m.maxB) <= MAX_FAR_PX, `${m.maxA}/${m.maxB}`);
      } else {
        const run = (shift) => hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [url(A0), url(A), bb, { r: ENV_R, tol: ENV_TOL, T: ENV_T, grow: ENV_GROW, shift, noImage: shift !== null }]);
        const e = await run(null);
        if (e.image) writeFileSync(join(OUT, `${file.replace('.pdf', '')}-angolare-${mode}-A_B_diff.png`), Buffer.from(e.image.split(',')[1], 'base64'));
        const q = (x, n) => (n ? x / n : 0);
        const outObj = Math.max(q(e.outBObj, e.nObj), q(e.outAObj, e.nObj));
        const outRest = Math.max(q(e.outBRest, e.nRest), q(e.outARest, e.nRest));
        info(`${label}, ${title}: fuori inviluppo | oggetti ${e.nObj} px: PDF ${(q(e.outBObj, e.nObj) * 100).toFixed(2)} %, app ${(q(e.outAObj, e.nObj) * 100).toFixed(2)} % | resto ${e.nRest} px: PDF ${(q(e.outBRest, e.nRest) * 100).toFixed(2)} %, app ${(q(e.outARest, e.nRest) * 100).toFixed(2)} %`);
        check(`${label}: nelle aree delle quote (arco, frecce, estensioni, testo "45.00°") al massimo ${MAX_OUT.obj * 100} % dei pixel fuori inviluppo`, e.nObj > 500 && outObj <= MAX_OUT.obj, `${(outObj * 100).toFixed(2)} % su ${e.nObj}`);
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

// ---------------------------------------------------------------- 8) barra contestuale e testo guida di una riga (iPhone 390 x 780, A+ 14, 16 e 22)
const hintGeom = (page) => page.evaluate(() => { const e = document.querySelector('.ctx-hint'); const b = document.querySelector('.ctxbar'); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), bar: b.getBoundingClientRect().height }; });
const barOf = async (page) => {
  const g = await hintGeom(page);
  return { text: await hint(page), lines: Math.round(g.h / g.lh), bar: Math.round(g.bar * 10) / 10 };
};
async function barSuite(browser) {
  setSection('barra contestuale e testo guida, iPhone 390x780');
  for (const [uiSize, px] of [[0, 14], [1, 16], [4, 22]]) {
    const { ctx, page } = await phone(browser, 390, 780, uiSize);
    await openDoc(page, 'A4 vettoriale');
    await snapOnly(page, []);
    const L = await twoLines(page);
    // riferimento: Quota allineata, i tre passi (l'ultimo e' il testo piu' lungo delle altre quote)
    await menuInsert(page, /^Quota allineata$/);
    const ref0 = await barOf(page);
    await clickSheet(page, pt(60, 60));
    const ref1 = await barOf(page);
    await clickSheet(page, pt(160, 60));
    const ref2 = await barOf(page);
    await page.keyboard.press('Escape');
    // angolare da due linee: i tre passi
    await menuInsert(page, MENU_LINES);
    const a0 = await barOf(page);
    await clickSheet(page, L.s1);
    const a1 = await barOf(page);
    await clickSheet(page, L.s2);
    const a2 = await barOf(page);
    await page.keyboard.press('Escape');
    // angolare da tre punti: i quattro passi
    await menuInsert(page, MENU_POINTS);
    const p0 = await barOf(page);
    await clickSheet(page, pt(100, 420));
    const p1 = await barOf(page);
    await clickSheet(page, pt(200, 400));
    const p2 = await barOf(page);
    await clickSheet(page, pt(120, 330));
    const p3 = await barOf(page);
    await page.keyboard.press('Escape');
    // il pulsante "Da 3 punti": e' sulla stessa riga dei pulsanti (non aggiunge una riga alla barra) e la sua altezza e' >= 44 px
    const btn = await page.evaluate(() => { const b = document.querySelector('.ctx-angmode'); const a = document.querySelector('.ctx-actions'); const r = b.getBoundingClientRect(); const ar = a.getBoundingClientRect(); const kids = [...a.children].filter((c) => c.getBoundingClientRect().height > 0); const tops = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top))); return { h: r.height, w: r.width, rows: tops.size, actionsH: ar.height }; });
    info(`A+ ${px}: barra con Quota allineata ${ref0.bar}/${ref1.bar}/${ref2.bar} px (${ref0.lines}/${ref1.lines}/${ref2.lines} righe di guida); angolare da due linee ${a0.bar}/${a1.bar}/${a2.bar} px (${a0.lines}/${a1.lines}/${a2.lines} righe); da tre punti ${p0.bar}/${p1.bar}/${p2.bar}/${p3.bar} px (${p0.lines}/${p1.lines}/${p2.lines}/${p3.lines} righe); pulsante "Da 3 punti" ${Math.round(btn.w)} x ${Math.round(btn.h)} px, righe di pulsanti ${btn.rows}`);
    const steps = [a0, a1, a2, p0, p1, p2, p3];
    check(`A+ ${px}: i sette testi guida dell'angolare entrano in ${Math.max(ref0.lines, ref1.lines, ref2.lines)} riga/e al massimo (come il piu' lungo delle altre quote)`, steps.every((x) => x.lines <= Math.max(ref0.lines, ref1.lines, ref2.lines)), JSON.stringify(steps.map((x) => [x.text, x.lines])));
    if (px <= 16) check(`A+ ${px}: ogni testo guida dell'angolare sta su UNA riga (altezza <= 1.5 righe)`, steps.every((x) => x.lines === 1), JSON.stringify(steps.map((x) => [x.text, x.lines])));
    check(`A+ ${px}: l'altezza della barra non cambia fra i passi (da due linee: ${a0.bar}/${a1.bar}/${a2.bar}; da tre punti: ${p0.bar}/${p1.bar}/${p2.bar}/${p3.bar})`, [a0, a1, a2].every((x) => x.bar === a0.bar) && [p0, p1, p2, p3].every((x) => x.bar === p0.bar), JSON.stringify([a0.bar, a1.bar, a2.bar, p0.bar, p1.bar, p2.bar, p3.bar]));
    check(`A+ ${px}: il pulsante "Da 3 punti" e' alto almeno 44 px e non aggiunge una riga di pulsanti (${btn.rows})`, btn.h >= 43.5 && btn.rows === 1, JSON.stringify(btn));
    check(`A+ ${px}: la barra con l'angolare ha l'altezza di quella della Quota allineata piu' ${Math.round((a0.bar - ref0.bar) * 10) / 10} px (misura)`, true);
    await ctx.close();
  }
  // desktop: stessa misura a 1280 x 900 e a 720 x 700
  for (const [w, h] of [[1280, 900], [720, 700]]) {
    const { ctx, page } = await desktop(browser, w, h);
    await openDoc(page, 'A4 vettoriale');
    await snapOnly(page, []);
    await menuInsert(page, /^Quota allineata$/);
    const r0 = await barOf(page);
    await menuInsert(page, MENU_LINES);
    const l0 = await barOf(page);
    await menuInsert(page, MENU_POINTS);
    const q0 = await barOf(page);
    info(`${w}x${h}: barra con Quota allineata ${r0.bar} px, angolare da due linee ${l0.bar} px, da tre punti ${q0.bar} px (guida ${l0.lines}/${q0.lines} righe)`);
    check(`${w}x${h}: l'angolare non cambia l'altezza della barra rispetto alla Quota allineata (${r0.bar} / ${l0.bar} / ${q0.bar})`, l0.bar === r0.bar && q0.bar === r0.bar, JSON.stringify([r0.bar, l0.bar, q0.bar]));
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 9) tocco emulato (iPhone 390 x 780, tolleranza di scelta 22 px)
async function touchSuite(browser, title, first) {
  setSection(`tocco emulato 390x780, ${title}`);
  const { ctx, page, cdp } = await phone(browser, 390, 780);
  await openDoc(page, title);
  await snapOnly(page, []);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(90);
  };
  const tapSheet = async (sx) => {
    const c = await clientOfSheet(page, sx);
    const raw = await sheetOfClient(page, c);
    await tap(c);
    return raw;
  };
  await menuInsert(page, MENU_LINES); // PRIMA di misurare lo zoom (la barra contestuale cambia l'altezza del visore)
  const k = await zoomPx(page);
  const px = (n) => n / k;
  const L = await twoLines(page, pt(200, 300));
  const [a1, b1] = endpoints(L.o1);
  const [a2, b2] = endpoints(L.o2);
  info(`zoom ${k.toFixed(3)} px/pt: la tolleranza del dito (22 px) e' ${(22 / k).toFixed(1)} pt`);
  check('tocco: "Quota angolare da due linee": testo guida di una riga', (await hint(page)) === 'Quota angolare: scegli la prima linea' && (await hintGeom(page)).h <= (await hintGeom(page)).lh * 1.5 + 1, await hint(page));
  // fuori tolleranza (26 px) niente; dentro (20 px) si sceglie
  const n2 = { x: -Math.sin(45 * DEG), y: -Math.cos(45 * DEG) }; // normale della retta a 45 gradi sul foglio (verso l'alto a sinistra)
  const farOnL1 = alongS(L.s1, pt(0, 1), px(26));
  await tapSheet(farOnL1);
  check('tocco a 26 px da ogni retta: nessun lato scelto, messaggio', /^Nessuna retta o linea in questo punto/.test(await status(page)) && (await selCount(page)) === 0, await status(page));
  await tapSheet(alongS(L.s1, pt(0, 1), px(20)));
  check('tocco a 20 px dalla retta (tolleranza del dito 22 px): il lato e\' scelto e si evidenzia', (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, await hint(page));
  const tapped = [];
  tapped.push(await tapSheet(alongS(L.s2, n2, px(14))));
  check('tocco sulla seconda retta (a 14 px): "indica dove mettere l\'arco"', (await hint(page)) === 'Quota angolare: indica dove mettere l\'arco', await hint(page));
  // il pulsante Annulla della barra toglie l'ultimo passo
  await page.locator('button[title^="Annulla"]').first().click();
  await page.waitForTimeout(120);
  check('tocco: "Annulla" della barra toglie l\'ultimo lato scelto', (await hint(page)) === 'Quota angolare: scegli la seconda linea', await hint(page));
  await tapSheet(alongS(L.s2, n2, px(14)));
  const rawP = await tapSheet(L.P);
  check('tocco: dopo il punto si apre il tastierino con "45.00°"', (await kbdOpen(page)) && (await page.locator('.keypad').innerText()).includes('45.00°'), (await page.locator('.keypad').innerText()).slice(0, 150));
  await confirmKeypad(page);
  const o = await lastObj(page);
  judge('tocco, da due linee', o, expectAngle(a1, b1, a2, b2, rawP), 0.1);
  await undo(page);

  // da tre punti con il tocco
  await menuInsert(page, MENU_POINTS);
  const V = pt(150, 420);
  const raws = [];
  for (const sx of [V, alongS(V, dirS(15), 110), alongS(V, dirS(100), 90), alongS(V, dirS(300), 60)]) raws.push(await tapSheet(sx));
  check('tocco, da tre punti: dopo i quattro tocchi si apre il tastierino', await kbdOpen(page));
  await confirmKeypad(page);
  const q = await lastObj(page);
  const sa = sh(q.a), s1 = sh(q.p1), s2 = sh(q.p2), sb = sh(q.b);
  const val = angleBetween(sub(s1, sa), sub(s2, sa));
  check('tocco, da tre punti: punti e raggio sono quelli dei tocchi (entro 0.1 pt) e il testo e\' l\'angolo minore con 2 decimali', q?.dim === 'angular' && nearP(sa, raws[0], 0.1) && nearP(s1, raws[1], 0.1) && nearP(s2, raws[2], 0.1) && near(hyp(sb, sa), hyp(raws[3], raws[0]), 0.1) && (await lastText(page)) === `${val.toFixed(2)}°`, `${await lastText(page)} / ${val}`);
  if (first) {
    // scelta di un tratto di una Linea con il tocco
    await undo(page);
    const PL = await addPolyline(page, [pt(40, 500), pt(160, 500), pt(160, 600)]);
    const [p0, p1, p2] = endpoints(PL);
    await menuInsert(page, MENU_LINES);
    await tapSheet(alongS(pt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2), pt(1, 0), px(18))); // il tratto verticale p1-p2, 18 px a destra
    check('tocco su una Linea (a 18 px dal tratto verticale): si sceglie quel tratto, evidenziato (un solo segmento)', (await hint(page)) === 'Quota angolare: scegli la seconda linea' && (await selCount(page)) === 1, await hint(page));
    void p0;
  }
  await ctx.close();
}

// ---------------------------------------------------------------- 10) immagini per la lettura a occhio (nessun controllo automatico: E2E_ONLY=immagini)
async function imageSuite(browser) {
  setSection('immagini della quota angolare');
  const { ctx, page } = await newApp(browser, { dpr: 2, viewport: { width: 1500, height: 2300 } });
  try {
    await openSample(page, 'A4 vettoriale');
    G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
    await page.evaluate(() => window.__gtpdf.fit());
    await page.waitForTimeout(300);
    const V1 = pt(200, 260);
    await addSegment(page, alongS(V1, dirS(0), -20), alongS(V1, dirS(0), 150));
    await addSegment(page, alongS(V1, dirS(45), -20), alongS(V1, dirS(45), 150));
    const V2 = pt(200, 480);
    await addSegment(page, alongS(V2, dirS(20), 20), alongS(V2, dirS(20), 60));
    await addSegment(page, alongS(V2, dirS(140), 90), alongS(V2, dirS(140), 150));
    await page.evaluate(([list]) => window.__gtpdf.add(1, list), [[
      angularObject(V1, 0, 45, 120, 120, 90),
      angularObject(V2, 20, 140, 60, 90, 70),
      angularObject(pt(380, 260), 0, 10, 60, 60, 60),
      angularObject(pt(380, 480), 10, 170, 80, 80, 70),
      angularObject(pt(380, 640), 30, 120, 90, 90, 22), // raggio piccolo
    ]]);
    await page.evaluate(() => window.__gtpdf.zoomTo(2.2));
    await page.waitForTimeout(600);
    const frame = async (name, centre, w, h) => {
      const c2 = await clientOfSheet(page, centre);
      await page.screenshot({ path: join(OUT, `immagine-${name}.png`), clip: { x: Math.max(0, c2.x - w / 2), y: Math.max(0, c2.y - h / 2), width: w, height: h } });
    };
    await frame('45-gradi', alongS(V1, dirS(22.5), 90), 520, 360);
    await frame('120-gradi-estensioni', alongS(V2, dirS(80), 80), 560, 460);
    await frame('10-gradi-frecce-fuori', alongS(pt(380, 260), dirS(5), 50), 420, 300);
    await frame('160-gradi', alongS(pt(380, 480), dirS(90), 60), 560, 360);
    await frame('raggio-piccolo', alongS(pt(380, 640), dirS(75), 30), 300, 260);
    check('immagini salvate in ' + OUT, true);
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- avvio
async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  const only_ = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only_ || only_.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di 57f82e8, dove un controllo che serve non c'e') lo dice con un controllo fallito e le altre proseguono.
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
    for (const [t] of samples) await guarded('linee', `da due linee, ${t}`, () => linesSuite(browser, t));
    for (const [t] of samples) await guarded('punti', `da tre punti, ${t}`, () => pointsSuite(browser, t));
    for (const [t] of samples) await guarded('scelta', `scelta dei tratti, ${t}`, () => chooseSuite(browser, t));
    for (const [t] of samples) await guarded('scala', `pagina non calibrata, ${t}`, () => scaleSuite(browser, t));
    for (const [t] of samples) await guarded('digitato', `valore digitato, ${t}`, () => typedSuite(browser, t));
    for (const [t] of samples) await guarded('modifica', `modifiche, ${t}`, () => modifySuite(browser, t));
    for (const [t, f] of samples) await guarded('progetto', `progetto, ${t}`, () => projectSuite(browser, t, f));
    for (const [t, f] of samples) await guarded('export', `esportazione, ${t}`, () => exportSuite(browser, harness, t, f));
    await guarded('barra', 'barra contestuale', () => barSuite(browser));
    if (process.env.E2E_ONLY && process.env.E2E_ONLY.split(',').includes('immagini')) await imageSuite(browser); // solo su richiesta: nessun controllo
    for (const [i, [t]] of samples.entries()) await guarded('tocco', `tocco, ${t}`, () => touchSuite(browser, t, i === 0));
  } finally {
    await lib.stopAll(servers);
  }
  void harness;
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void readFileSync;
void PDF_DIR;
void touch;
void redo;
void dropEntry;
void MENU_POINTS;
void STROKE;
void addPolyline;
