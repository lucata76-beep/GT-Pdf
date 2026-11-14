// Prove dell'aggiunta a CP6e "Adatta alla pagina" (8/11/2026, decisione 83): pulsante in fondo alla palette del desktop che fa `viewer.fit()` (pagina intera nella vista).
// Non e' una tappa del piano ma un'aggiunta a CP6e: per questo il nome e' "e2e-cp6e-adatta" (le prove di CP6e sono in e2e-cp6e.cjs).
// Serie: posizione (dentro la finestra a varie altezze, senza coprire l'ultimo strumento), uguale (stessa vista del menu Zoom e della percentuale), disattivato (senza documento),
// costruzione (con Rotazione armata, con una Linea in costruzione: nessun cambiamento fuori dalla vista), tastiera (Tab, Invio, Spazio; Canc, Esc, Ctrl+Z), tocco (non c'e' sotto i 720 px
// ne' col tocco con poca altezza: ne resta uno solo in vista). Mouse (desktop, clic reali) e tocco emulato come guardia (decisione 81).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6e-adatta.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 6dbf8ee i controlli sul pulsante FALLISCONO)
//   E2E_ONLY=posizione,uguale,disattivato,costruzione,tastiera,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li'.
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6e-adatta', out: process.argv[2], port: 4221, hport: 4222, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- strumenti di prova
async function desktop(browser, w = 1280, h = 800, uiSize = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  await page.addInitScript((u) => localStorage.setItem('gtpdf.uiSize', String(u)), uiSize);
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' }); // come le altre prove: la colonna fluttuante non deve intercettare i clic (sul desktop e' gia' nascosta)
  return { ctx, page };
}
async function phone(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  return { ctx, page, cdp };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });
async function openDoc(page, title = 'A4 vettoriale') {
  await openSample(page, title);
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
}
const view = (page) => page.evaluate(() => window.__gtpdf.view());
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const intersects = (a, b) => a && b && a.l < b.r - 0.01 && b.l < a.r - 0.01 && a.t < b.b - 0.01 && b.t < a.b - 0.01;
const inside = (a, o, tol = 0.5) => a && o && a.l >= o.l - tol && a.r <= o.r + tol && a.t >= o.t - tol && a.b <= o.b + tol;
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const fitBtn = (page) => page.locator('.palette-fit');
const hint = (page) => page.locator('.ctx-hint').innerText();
const undoTitle = (page) => page.locator('.undo-ctl button').first().getAttribute('title');
const redoTitle = (page) => page.locator('.undo-ctl button').nth(1).getAttribute('title');
const version = (page) => page.evaluate(() => window.__gtpdf.state().version);
const objectsOf = (page) => page.evaluate(() => window.__gtpdf.state().pages[0].objects);
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(120);
};
/** Porta la vista lontano da "pagina intera": zoom e spostamento. */
async function zoomAndPan(page) {
  await page.evaluate(() => window.__gtpdf.zoomTo(2.6));
  await page.waitForTimeout(250);
  await tool(page, 'Sposta vista');
  const c = await canvasRect(page);
  await page.mouse.move(c.left + 200, c.top + 200);
  await page.mouse.down();
  await page.mouse.move(c.left + 120, c.top + 150, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}
const menuItem = async (page, menu, re) => {
  await page.locator('.menu-btn', { hasText: menu }).click();
  await page.locator('.menu-item').filter({ hasText: re }).click();
  await page.waitForTimeout(150);
};

// ---------------------------------------------------------------- 1) posizione: dentro la finestra, senza coprire l'ultimo strumento
async function positionSuite(browser) {
  const cases = [[1280, 900, 1], [1280, 800, 1], [1280, 600, 1], [1280, 480, 1], [1280, 400, 1], [1024, 700, 4], [1280, 900, 4]];
  for (const [w, h, ui] of cases) {
    const tag = `${w}x${h}${ui === 1 ? '' : ' A+ al massimo'}`;
    setSection(`posizione, ${tag}`);
    const { ctx, page } = await desktop(browser, w, h, ui);
    await openDoc(page);
    const vp = { l: 0, t: 0, r: w, b: h };
    const pal = () => rect(page, '.palette');
    const btn = () => rect(page, '.palette-fit');
    const lastTool = () => page.evaluate(() => { const t = [...document.querySelectorAll('.palette button.tool')].filter((e) => e.offsetParent !== null); const r = t[t.length - 1].getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, title: t[t.length - 1].title }; });
    const scroll = () => page.evaluate(() => { const p = document.querySelector('.palette'); return { top: Math.round(p.scrollTop), max: p.scrollHeight - p.clientHeight }; });
    const s0 = await scroll();
    info(`${tag}: la palette ${s0.max > 0 ? `scorre (${s0.max} px)` : 'entra tutta senza scorrere'}`);
    check(`${tag}: il pulsante "Adatta alla pagina" e' dentro la finestra e dentro la palette, senza scorrere (all'inizio)`, inside(await btn(), vp) && inside(await btn(), await pal()), JSON.stringify([await btn(), await pal()]));
    await page.evaluate(() => { const p = document.querySelector('.palette'); p.scrollTop = p.scrollHeight; });
    await page.waitForTimeout(80);
    const sEnd = await scroll();
    const bEnd = await btn();
    const lEnd = await lastTool();
    check(`${tag}: in fondo allo scorrimento il pulsante e' ancora dentro la finestra e l'ultimo strumento (${lEnd.title}) e' tutto dentro la palette e NON copre ne' e' coperto dal pulsante (rettangoli)`, inside(bEnd, vp) && inside(lEnd, await pal()) && !intersects(lEnd, bEnd), JSON.stringify({ bEnd, lEnd, sEnd }));
    if (s0.max > 0) check(`${tag}: la palette scorre davvero in questa altezza (la prova e' significativa)`, sEnd.top > 0 && sEnd.max > 0);
    // ogni strumento scelto resta in vista e non finisce sotto il pulsante (revealTool)
    const bad = [];
    const titles = await page.$$eval('.palette button.tool', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.title));
    for (const t of titles) {
      await page.evaluate((x) => document.querySelector(`.palette button.tool[title="${x}"]`).click(), t);
      await page.waitForTimeout(60);
      const r = await page.evaluate((x) => { const e = document.querySelector(`.palette button.tool[title="${x}"]`).getBoundingClientRect(); return { l: e.left, t: e.top, r: e.right, b: e.bottom }; }, t);
      const bb = await btn();
      if (!bb || !inside(r, await pal()) || intersects(r, bb)) bad.push(t); // senza il pulsante la prova non vale: fallisce
    }
    check(`${tag}: scegliendo ognuno degli ${titles.length} strumenti (clic dal codice: il browser non lo porta in vista da solo) resta tutto in vista e non finisce sotto il pulsante`, bad.length === 0, bad.join(', '));
    await ctx.close();
  }
  setSection('posizione: che pulsante e\'');
  const { ctx, page } = await desktop(browser, 1280, 800);
  await openDoc(page);
  const info1 = await page.evaluate(() => {
    const b = document.querySelector('.palette-fit');
    const t = document.querySelector('.palette button.tool');
    const fz = document.querySelector('.float-zoom button[aria-label="Adatta alla pagina"] .icon');
    const tb = t.getBoundingClientRect();
    const bb = b.getBoundingClientRect();
    return {
      isTool: b.classList.contains('tool'),
      pressed: b.hasAttribute('aria-pressed'),
      toolCount: document.querySelectorAll('.palette button.tool').length,
      buttons: document.querySelectorAll('.palette button').length,
      title: b.title,
      aria: b.getAttribute('aria-label'),
      sameIcon: !!fz && fz.innerHTML === b.querySelector('.icon').innerHTML && b.querySelector('.icon svg') !== null,
      label: b.textContent.trim(),
      w: bb.width,
      h: bb.height,
      toolW: tb.width,
      toolH: tb.height,
      type: b.type,
    };
  });
  check('non e\' uno strumento: niente classe `tool`, niente `aria-pressed`; la palette ha ancora 11 strumenti (.palette button.tool = 11) e un solo pulsante in piu\'', !info1.isTool && !info1.pressed && info1.toolCount === 11 && info1.buttons === 12, JSON.stringify(info1));
  check('nome "Adatta alla pagina" (title e aria-label) e la stessa icona del pulsante dell\'iPhone; solo icona (nessun testo)', info1.title === 'Adatta alla pagina' && info1.aria === 'Adatta alla pagina' && info1.sameIcon && info1.label === '', JSON.stringify(info1));
  check('stessa larghezza degli strumenti e altezza non minore (--hit)', near(info1.w, info1.toolW, 0.5) && info1.h >= info1.toolH - 0.5, `${info1.w}x${info1.h} contro ${info1.toolW}x${info1.toolH}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 2) la stessa vista della voce di menu e della percentuale
async function sameSuite(browser) {
  for (const [title, label] of [['A4 vettoriale', 'A4'], ['A4 con /Rotate 90', 'pagina /Rotate 90'], ['A4 con CropBox', 'pagina con CropBox']]) {
    setSection(`stessa vista del menu Zoom, ${label}`);
    const { ctx, page } = await desktop(browser);
    await openDoc(page, title);
    const base = await view(page);
    await zoomAndPan(page);
    const far = await view(page);
    check(`${label}: (premessa) dopo zoom e spostamento la vista e' lontana da "pagina intera" (atFit falso)`, far.atFit === false && !near(far.zoom, base.zoom, 1e-6), JSON.stringify([base, far]));
    await fitBtn(page).click();
    await page.waitForTimeout(250);
    const viaButton = await view(page);
    await zoomAndPan(page);
    await menuItem(page, 'Zoom', /^Adatta alla pagina/);
    const viaMenu = await view(page);
    await zoomAndPan(page);
    await page.locator('.zoom-val').click();
    await page.waitForTimeout(250);
    const viaPercent = await view(page);
    const same = (a, b) => a.atFit === b.atFit && near(a.zoom, b.zoom, 1e-9) && near(a.tx, b.tx, 1e-6) && near(a.ty, b.ty, 1e-6);
    check(`${label}: il pulsante porta atFit a vero con lo stesso zoom e la stessa posizione del menu Zoom > "Adatta alla pagina" (e quindi della pagina intera di prima)`, viaButton.atFit === true && same(viaButton, viaMenu) && same(viaButton, base), JSON.stringify([viaButton, viaMenu, base]));
    check(`${label}: ... e del valore percentuale della barra superiore`, same(viaButton, viaPercent), JSON.stringify([viaButton, viaPercent]));
    // la pagina e' intera e centrata (calcolo indipendente dal canvas)
    const c = await canvasRect(page);
    const vr = await rect(page, '.viewer');
    const margins = { left: c.left - vr.l, right: vr.r - (c.left + c.width), top: c.top - vr.t, bottom: vr.b - (c.top + c.height) };
    check(`${label}: la pagina e' tutta nella vista e centrata (margini uguali a destra e a sinistra, in alto e in basso: 4 % del lato che la limita)`, margins.left > 0 && margins.top > 0 && near(margins.left, margins.right, 1.5) && near(margins.top, margins.bottom, 1.5), JSON.stringify(margins));
    // dopo il pulsante la finestra ridimensionata rifa' il fit (atFit)
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.waitForTimeout(400);
    const v2 = await view(page);
    check(`${label}: dopo il pulsante il ridimensionamento della finestra rifa' il fit (atFit resta vero, lo zoom si adegua)`, v2.atFit === true && !near(v2.zoom, viaButton.zoom, 1e-6), JSON.stringify([viaButton.zoom, v2.zoom]));
    await ctx.close();
  }
  // pagina successiva del documento a piu' pagine: fit della pagina mostrata
  setSection('stessa vista del menu Zoom, 3 pagine miste (pagina 2, A3)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, '3 pagine miste');
  await page.evaluate(async () => { await window.__gtpdf.goTo(2); });
  await page.waitForTimeout(500);
  await zoomAndPan(page);
  await fitBtn(page).click();
  await page.waitForTimeout(250);
  const a = await view(page);
  await zoomAndPan(page);
  await menuItem(page, 'Zoom', /^Adatta alla pagina/);
  const b = await view(page);
  check('pagina 2 (A3): il pulsante e il menu Zoom danno la stessa vista', a.atFit && b.atFit && near(a.zoom, b.zoom, 1e-9) && near(a.tx, b.tx, 1e-6) && near(a.ty, b.ty, 1e-6), JSON.stringify([a, b]));
  await ctx.close();
}

// ---------------------------------------------------------------- 3) disattivato senza documento, attivo con ogni strumento
async function disabledSuite(browser) {
  setSection('disattivato senza documento');
  const { ctx, page } = await desktop(browser);
  check('senza documento il pulsante c\'e\' ed e\' disattivato (come zoom e percentuale)', (await fitBtn(page).isDisabled()) && (await page.locator('.zoom-val').isDisabled()), 'senza documento');
  await openDoc(page);
  check('con un documento e\' attivo', await fitBtn(page).isEnabled());
  const titles = await page.$$eval('.palette button.tool', (els) => els.map((e) => e.title));
  const off = [];
  for (const t of titles) {
    await page.evaluate((x) => document.querySelector(`.palette button.tool[title="${x}"]`).click(), t);
    await page.waitForTimeout(50);
    if (!(await fitBtn(page).isEnabled())) off.push(t);
  }
  check(`attivo con ognuno degli ${titles.length} strumenti`, off.length === 0, off.join(', '));
  await menuItem(page, 'File', /^Chiudi/);
  await page.waitForTimeout(300);
  const dlg = page.locator('.dialog .btn', { hasText: /Chiudi|Procedi|Scarta/ });
  if (await dlg.count()) await dlg.first().click().catch(() => {});
  await page.waitForTimeout(400);
  check('chiuso il documento torna disattivato', await fitBtn(page).isDisabled());
  await ctx.close();
}

// ---------------------------------------------------------------- 4) solo la vista: nessun altro cambiamento
async function constructionSuite(browser) {
  setSection('con una trasformazione o una costruzione in corso');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [
    { k: 'segment', pts: [[0.2, 0.7], [0.5, 0.74]] },
    { k: 'circle', a: [0.6, 0.6], b: [0.7, 0.6] },
    { k: 'text', at: [0.2, 0.45], text: 'FORO', pt: 12 },
  ]));
  await page.waitForTimeout(200);
  const ids = await page.evaluate(() => window.__gtpdf.state().pages[0].objects.map((o) => o.id));
  await page.evaluate((l) => window.__gtpdf.selectIds(l), ids);
  await page.locator('.ctx-tr', { hasText: 'Rotazione' }).click();
  const r0 = await canvasRect(page);
  const sheet = await page.evaluate(() => window.__gtpdf.sheet());
  const k0 = r0.width / sheet.w;
  const click = { x: r0.left + r0.width * 0.45, y: r0.top + r0.height * 0.55 };
  await page.mouse.move(click.x, click.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const sheetPt = { x: (click.x - r0.left) / k0, y: (click.y - r0.top) / k0 }; // il centro sul foglio (pt): non dipende dalla vista
  await page.locator('.ctx-angle-input').fill('30');
  await page.waitForTimeout(120);
  const snapshot = async () => ({
    hint: await hint(page),
    tool: await page.locator('button.tool[aria-pressed="true"]').getAttribute('title'),
    selection: await page.evaluate(() => window.__gtpdf.selection()),
    undo: await undoTitle(page),
    redo: await redoTitle(page),
    version: await version(page),
    objects: await objectsOf(page),
    markers: await page.evaluate(() => document.querySelectorAll('.sc-markers > *').length),
    ghost: await page.evaluate(() => document.querySelector('.sc-ghost').children.length),
    angle: await page.locator('.ctx-angle-input').inputValue(),
    shown: await page.locator('.ctx-angle-input').isVisible(),
  });
  // la vista cambia senza cambiare strumento (gancio di prova: zoomTo): la trasformazione resta in corso
  await page.evaluate(() => window.__gtpdf.zoomTo(2.2));
  await page.waitForTimeout(250);
  const before = await snapshot();
  const vBefore = await view(page);
  const markerBefore = await page.evaluate(() => { const m = document.querySelector('.sc-markers > *').getBoundingClientRect(); return { x: m.left + m.width / 2, y: m.top + m.height / 2 }; });
  await fitBtn(page).click();
  await page.waitForTimeout(300);
  const after = await snapshot();
  const vAfter = await view(page);
  check('(premessa) con la Rotazione armata, centro scelto e angolo digitato la vista era lontana da "pagina intera" e dopo il clic e\' tornata intera', vBefore.atFit === false && vAfter.atFit === true && !near(vBefore.zoom, vAfter.zoom, 1e-6), JSON.stringify([vBefore, vAfter]));
  check('il clic cambia SOLO la vista: strumento, testo guida, selezione, storia (Annulla, Ripeti, versione del modello), oggetti, centro, angolo digitato e casella restano come prima', sameJSON({ ...before }, { ...after }), JSON.stringify({ before, after }).slice(0, 400));
  check('... e l\'anteprima (oggetti semitrasparenti) e il segno del centro seguono la vista nuova: il segno e\' sul centro (stesso punto del foglio, dentro 1 px)', after.ghost === 3 && after.markers === 1, JSON.stringify([before.ghost, after.ghost, before.markers, after.markers]));
  const c2 = await canvasRect(page);
  const k2 = c2.width / sheet.w;
  const markerAfter = await page.evaluate(() => { const m = document.querySelector('.sc-markers > *').getBoundingClientRect(); return { x: m.left + m.width / 2, y: m.top + m.height / 2 }; });
  const expected = { x: c2.left + sheetPt.x * k2, y: c2.top + sheetPt.y * k2 };
  check('... il segno del centro e\' dove ora sta quel punto del foglio (calcolo indipendente dal rettangolo del canvas)', Math.hypot(markerAfter.x - expected.x, markerAfter.y - expected.y) <= 1.0 && Math.hypot(markerAfter.x - markerBefore.x, markerAfter.y - markerBefore.y) > 5, JSON.stringify({ markerBefore, markerAfter, expected }));
  // la rotazione poi funziona come se niente fosse (stesso centro)
  await page.locator('.ctx-angle-input').press('Enter');
  await page.waitForTimeout(150);
  const rotated = await objectsOf(page);
  check('digitato Invio dopo il pulsante la rotazione si applica ai tre oggetti (un solo comando) attorno allo stesso centro', rotated.length === 3 && (await undoTitle(page)) === 'Annulla Ruota 3 oggetti' && !sameJSON(rotated, before.objects), await undoTitle(page));
  await page.locator('.undo-ctl button').first().click();

  // Linea in costruzione
  setSection('con una Linea in costruzione');
  // snap spenti: i punti si indicano dove si clicca (altrimenti lo snap su un estremo degli oggetti disegnati sposta il punto e il confronto con il foglio non vale); dopo CP7f anche lo snap sul PDF
  // (senza, il terzo punto veniva spostato di circa 13 pt da un aggancio sul disegno del PDF)
  for (const t of ['end', 'mid', 'center', 'pdf']) {
    const b = page.locator(`.st-toggle[data-toggle="${t}"]`);
    if ((await b.getAttribute('aria-pressed')) === 'true') await b.click();
  }
  await tool(page, 'Linea');
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(300);
  const c3 = await canvasRect(page);
  const pts = [[0.3, 0.2], [0.5, 0.25], [0.6, 0.35]].map(([fx, fy]) => ({ x: c3.left + c3.width * fx, y: c3.top + c3.height * fy }));
  for (const p of pts.slice(0, 2)) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(80);
  }
  await page.mouse.move(pts[2].x, pts[2].y);
  await page.waitForTimeout(80);
  const sheetOf = (c, p) => ({ x: (p.x - c.left) / (c.width / sheet.w), y: (p.y - c.top) / (c.width / sheet.w) });
  const sp = pts.map((p) => sheetOf(c3, p));
  await page.evaluate(() => window.__gtpdf.zoomTo(2.2));
  await page.waitForTimeout(200);
  const lBefore = {
    hint: await hint(page),
    tool: await page.locator('button.tool[aria-pressed="true"]').getAttribute('title'),
    version: await version(page),
    undo: await undoTitle(page),
    markers: await page.evaluate(() => document.querySelectorAll('.sc-markers > *').length),
    objects: (await objectsOf(page)).length,
  };
  await fitBtn(page).click();
  await page.waitForTimeout(300);
  const lAfter = {
    hint: await hint(page),
    tool: await page.locator('button.tool[aria-pressed="true"]').getAttribute('title'),
    version: await version(page),
    undo: await undoTitle(page),
    markers: await page.evaluate(() => document.querySelectorAll('.sc-markers > *').length),
    objects: (await objectsOf(page)).length,
  };
  check('Linea con due punti indicati: il clic non cambia strumento, testo guida, storia, punti in costruzione ne\' oggetti (solo la vista)', sameJSON(lBefore, lAfter) && lAfter.markers === 2 && lAfter.tool === 'Linea', JSON.stringify([lBefore, lAfter]));
  // si continua: il terzo punto va dove lo indica il mouse nella vista nuova, Fine crea la linea con i tre punti
  const c4 = await canvasRect(page);
  const k4 = c4.width / sheet.w;
  await page.mouse.move(c4.left + sp[2].x * k4, c4.top + sp[2].y * k4);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const objs = await objectsOf(page);
  const line = objs[objs.length - 1];
  const pv = await page.evaluate(() => window.__gtpdf.pages()[0].view);
  const want = sp.map((q) => ({ x: pv[0] + q.x, y: pv[3] - q.y })); // pagina senza /Rotate: x = foglio x, y = alto del foglio - foglio y
  const maxErr = line.kind === 'polyline' ? Math.max(...line.points.map((q, i) => Math.hypot(q.x - want[i].x, q.y - want[i].y))) : Infinity;
  check('... poi si prosegue con la costruzione: la linea ha i tre punti indicati (due prima e uno dopo il pulsante), tutti negli stessi punti del foglio (0.05 pt)', line.kind === 'polyline' && line.points.length === 3 && maxErr <= 0.05, `${maxErr} ${JSON.stringify(line.points)}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 5) tastiera
async function keyboardSuite(browser) {
  setSection('tastiera: Tab, Invio, Spazio; Canc, Esc, Ctrl+Z dopo il clic');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  await page.locator('button.tool[title="Copertura"]').focus();
  await page.keyboard.press('Tab');
  check('con Tab dall\'ultimo strumento si arriva al pulsante', await page.evaluate(() => document.activeElement?.classList.contains('palette-fit')));
  check('... e il fuoco si vede (anello :focus-visible di 2 px)', (await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}`; })) === 'solid 2px');
  await page.evaluate(() => window.__gtpdf.zoomTo(2.4));
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('Invio sul pulsante porta la pagina intera', (await view(page)).atFit === true);
  await page.evaluate(() => window.__gtpdf.zoomTo(2.4));
  await page.waitForTimeout(250);
  await fitBtn(page).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  check('Spazio sul pulsante porta la pagina intera', (await view(page)).atFit === true);
  check('dopo Shift+Tab si torna all\'ultimo strumento (ordine del fuoco: palette, poi pulsante)', await (async () => { await page.keyboard.press('Shift+Tab'); return page.evaluate(() => document.activeElement?.title === 'Copertura'); })());

  // Canc, Esc e Ctrl+Z dopo il clic: come dopo il clic su uno strumento della palette
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.2, 0.7], [0.5, 0.74]] }, { k: 'segment', pts: [[0.2, 0.5], [0.5, 0.54]] }]));
  await page.waitForTimeout(150);
  const ids = await page.evaluate(() => window.__gtpdf.state().pages[0].objects.map((o) => o.id));
  const afterTool = async () => {
    // dopo il clic su uno strumento della palette (Seleziona) e una selezione data dal codice (il fuoco resta sul pulsante dello strumento)
    await page.locator('button.tool[title="Seleziona"]').click();
    await page.evaluate((l) => window.__gtpdf.selectIds(l), ids);
    await page.waitForTimeout(80);
    const active = await page.evaluate(() => document.activeElement?.className ?? '');
    const n0 = (await objectsOf(page)).length;
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    const delRes = (await objectsOf(page)).length === n0 ? 'ignorato' : 'cancellato';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const escRes = await hint(page);
    return { active, delRes, escRes };
  };
  const afterFit = async () => {
    await page.locator('button.tool[title="Seleziona"]').click();
    await page.evaluate((l) => window.__gtpdf.selectIds(l), ids);
    await fitBtn(page).click();
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => document.activeElement?.className ?? '');
    const n0 = (await objectsOf(page)).length;
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    const delRes = (await objectsOf(page)).length === n0 ? 'ignorato' : 'cancellato';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const escRes = await hint(page);
    return { active, delRes, escRes };
  };
  const t = await afterTool();
  const f = await afterFit();
  info(`dopo il clic su uno strumento: fuoco "${t.active}", Canc ${t.delRes}, dopo Esc "${t.escRes}"; dopo il clic sul pulsante: fuoco "${f.active}", Canc ${f.delRes}, dopo Esc "${f.escRes}"`);
  check('Canc dopo il clic sul pulsante si comporta come dopo il clic su uno strumento della palette (il fuoco e\' su un pulsante: Canc e\' ignorato, serve un clic sul foglio)', t.delRes === f.delRes && f.delRes === 'ignorato', JSON.stringify([t, f]));
  check('Esc dopo il clic sul pulsante azzera la selezione come dopo uno strumento', t.escRes === f.escRes && /^Seleziona: tocca/.test(f.escRes), JSON.stringify([t, f]));
  // Ctrl+Z annulla l'ultimo comando in entrambi i casi
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'circle', a: [0.7, 0.3], b: [0.8, 0.3] }]));
  const nz = (await objectsOf(page)).length;
  await fitBtn(page).click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check('Ctrl+Z dopo il clic sul pulsante annulla l\'ultimo comando (il pulsante non e\' un campo di testo e non entra nella storia)', (await objectsOf(page)).length === nz - 1);
  await ctx.close();
}

// ---------------------------------------------------------------- 6) tocco: non c'e' nella palette, ne resta uno solo in vista
async function touchSuite(browser) {
  for (const [w, h] of [[390, 780], [780, 390], [844, 390]]) {
    setSection(`tocco emulato ${w}x${h}`);
    const { ctx, page, cdp } = await phone(browser, w, h);
    await openDoc(page);
    const vis = await page.evaluate(() => {
      const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const all = [...document.querySelectorAll('button[aria-label="Adatta alla pagina"]')];
      return { total: all.length, visible: all.filter(visible).map((e) => e.closest('.float-zoom') ? 'colonna sul foglio' : e.closest('.palette') ? 'palette' : e.classList.contains('zoom-val') ? 'percentuale' : 'altro'), dock: getComputedStyle(document.querySelector('.palette-dock')).display, tools: document.querySelectorAll('.palette button.tool').length };
    });
    check(`${w}x${h}: il pulsante nella palette NON si vede (contenitore nascosto) e le voci della palette sono 11 come prima`, vis.dock === 'none' && !vis.visible.includes('palette') && vis.tools === 11, JSON.stringify(vis));
    check(`${w}x${h}: in vista c'e' un solo "Adatta alla pagina": ${JSON.stringify(vis.visible)}`, vis.visible.length === 1 && vis.visible[0] === 'colonna sul foglio', JSON.stringify(vis));
    // quello della colonna fluttuante funziona con il dito
    await page.evaluate(() => window.__gtpdf.zoomTo(2.4));
    await page.waitForTimeout(250);
    const b = await rect(page, '.float-zoom button[aria-label="Adatta alla pagina"]');
    await touch(cdp, 'touchStart', [[b.l + b.w / 2, b.t + b.h / 2]]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(300);
    check(`${w}x${h}: il pulsante della colonna sul foglio porta la pagina intera col dito`, (await view(page)).atFit === true);
    await ctx.close();
  }
  setSection('desktop: quanti "Adatta alla pagina" si vedono');
  const { ctx, page } = await desktop(browser);
  await openDoc(page);
  const n = await page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return [...document.querySelectorAll('button[aria-label="Adatta alla pagina"]')].filter(visible).map((e) => (e.closest('.palette') ? 'palette' : e.classList.contains('zoom-val') ? 'percentuale' : 'altro'));
  });
  check('sul desktop si vedono il valore percentuale della barra superiore e il pulsante della palette (la colonna sul foglio e\' nascosta da 720 px)', n.length === 2 && n.includes('palette') && n.includes('percentuale'), JSON.stringify(n));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only || only.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di 6dbf8ee, dove il pulsante non c'e') lo dice con un controllo fallito e le altre proseguono.
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
    await guarded('posizione', 'posizione', () => positionSuite(browser));
    await guarded('uguale', 'stessa vista', () => sameSuite(browser));
    await guarded('disattivato', 'disattivato senza documento', () => disabledSuite(browser));
    await guarded('costruzione', 'trasformazione e costruzione in corso', () => constructionSuite(browser));
    await guarded('tastiera', 'tastiera', () => keyboardSuite(browser));
    await guarded('tocco', 'tocco emulato', () => touchSuite(browser));
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
