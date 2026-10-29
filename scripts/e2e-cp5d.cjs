// Prove di CP5d su Chromium: "Prova menu" in Diagnostica, menu dell'editor in orizzontale, zoom e spostamento (puntatore perso), lettura di schermo e puntatori,
// misure del visore in orizzontale. NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5d.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
// Chromium NON e' Safari: nulla di quanto segue prova il comportamento su iPhone. I margini di sicurezza dell'iPhone sono emulati con
// Emulation.setSafeAreaInsetsOverride (valori consueti dell'iPhone 14 Pro Max, NON letti dal telefono dell'utente).
const { chromium } = require('playwright');
const { join } = require('node:path');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp5d', out: process.argv[2], port: 4199, hport: 4200, zoom: 2 });
const { check, info, setSection, URL: APP_URL, OUT } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const UI_PX = [14, 16, 18, 20, 22];

/** Telefono emulato: tocco, DPR 3, margini di sicurezza in orizzontale (0/59/21/59) o in verticale (59/0/34/0), A+ a scelta (indice di UI_SIZES). */
async function phone(browser, w, h, uiIdx = 1, hash = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const land = w > h;
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: land ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript(
    ([i]) => {
      localStorage.setItem('gtpdf.uiSize', String(i));
      // Prova del puntatore perso: i pointerup e pointercancel di questi id non arrivano al visore (si fermano in cattura sulla finestra).
      window.__swallow = new Set();
      for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, (e) => { if (window.__swallow.has(e.pointerId)) e.stopImmediatePropagation(); }, true);
    },
    [uiIdx],
  );
  await page.goto(APP_URL + hash);
  return { ctx, page, cdp };
}
async function openSample(page, title = 'A4 vettoriale') {
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForTimeout(500);
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
const view = (page) => page.evaluate(() => window.__gtpdf.view());

// =====================================================================
// 1) "Prova menu" in Diagnostica
async function menuTestSuite(browser) {
  setSection('Prova menu (Diagnostica)');
  const { ctx, page, cdp } = await phone(browser, 932, 390, 1, '#diag');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('summary', { hasText: 'Prova menu' }).click();
  check('la scheda "Prova menu" c\'e\' in Diagnostica con il pulsante di avvio e l\'opzione di chiusura su resize', (await page.getByRole('button', { name: 'Avvia la prova del menu' }).count()) === 1 && (await page.locator('#mt-close-resize').isChecked()));
  await page.getByRole('button', { name: 'Avvia la prova del menu' }).click();
  check('si apre una schermata intera come l\'editor (body in modalita\' app, il menu "Prova menu" in alto)', (await page.locator('.menu-test').count()) === 1 && (await page.evaluate(() => document.body.classList.contains('app-mode'))));
  const readout = () => page.locator('.menu-readout').innerText();
  let t = await readout();
  check('i numeri in diretta: finestra, visualViewport, margini di sicurezza, vh/dvh/svh/lvh, tipo di puntatore, contatori', /finestra 932x390/.test(t) && /visualViewport 932x390/.test(t) && /margini di sicurezza \(su, dx, giu, sx\): 0, 59, 21, 59/.test(t) && /100vh\/dvh\/svh\/lvh in px: vh 390 · dvh 390/.test(t) && /pointer coarse: si/.test(t) && /resize finestra 0/.test(t), t);
  const pageBefore = await page.evaluate(() => [document.scrollingElement.scrollTop, window.visualViewport.offsetTop, window.visualViewport.pageTop]);
  await page.getByRole('button', { name: 'Prova menu', exact: true }).click();
  await page.waitForTimeout(400);
  t = await readout();
  const nItems = await page.locator('.menu-panel .menu-item').count();
  check('il menu di prova ha 12 voci e il pannello e\' quello dell\'editor (.menu-panel)', nItems === 12);
  check('a 932x390 il pannello scorre (clientHeight < scrollHeight) e il testo lo dice con max-height e --menu-top', /\(scorre\)/.test(t) && /max-height calcolato 313px/.test(t) && /--menu-top 48px/.test(t) && /altezza min 44\.0/.test(t), t);
  // scorrimento col dito: trascinamento verso l'alto sul pannello
  const box = await page.locator('.menu-panel').boundingBox();
  for (let i = 0; i < 6; i++) {
    await touch(cdp, 'touchStart', [[box.x + box.width / 2, box.y + box.height - 14, 1]]);
    for (let k = 1; k <= 8; k++) await touch(cdp, 'touchMove', [[box.x + box.width / 2, box.y + box.height - 14 - (200 * k) / 8, 1]]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(250);
  }
  t = await readout();
  const st = await page.evaluate(() => { const p = document.querySelector('.menu-panel'); return { top: p.scrollTop, max: p.scrollHeight - p.clientHeight }; });
  check('col dito il pannello arriva in fondo e il contatore "scroll pannello" e\' salito', st.top >= st.max - 1 && !/scroll pannello 0 /.test(t), `${JSON.stringify(st)} ${t.split('\n').find((l) => l.startsWith('eventi'))}`);
  const pageAfter = await page.evaluate(() => [document.scrollingElement.scrollTop, window.visualViewport.offsetTop, window.visualViewport.pageTop]);
  check('mentre il pannello scorre la pagina dietro non si muove (scrollTop del documento, offsetTop e pageTop del visualViewport invariati: in Chromium)', JSON.stringify(pageBefore) === JSON.stringify(pageAfter), `${JSON.stringify(pageBefore)} -> ${JSON.stringify(pageAfter)}`);
  // tocco fuori
  await page.touchscreen.tap(700, 300);
  await page.waitForTimeout(150);
  t = await readout();
  check('un tocco fuori dal pannello lo chiude e il testo lo registra ("tocchi fuori 1", ultima chiusura: tocco fuori)', (await page.locator('.menu-panel').count()) === 0 && /tocchi fuori 1/.test(t) && /ultima chiusura: tocco fuori/.test(t), t);
  // resize: come l'editor (chiude)
  await page.getByRole('button', { name: 'Prova menu', exact: true }).click();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 932, height: 340 });
  await page.waitForTimeout(400);
  t = await readout();
  check('con la finestra che cambia altezza il menu si chiude (come l\'editor) e il testo dice "resize" come motivo', (await page.locator('.menu-panel').count()) === 0 && /ultima chiusura: resize/.test(t) && /resize finestra [1-9]/.test(t), t);
  check('il visualViewport segue la finestra (932x340) e le unita\' dvh con lui', /visualViewport 932x340/.test(t) && /dvh 340/.test(t), t);
  await page.getByRole('button', { name: 'Chiudi prova' }).click();
  check('"Chiudi prova" toglie la schermata e rimette il body com\'era', (await page.locator('.menu-test').count()) === 0 && !(await page.evaluate(() => document.body.classList.contains('app-mode'))));
  // senza chiusura su resize: il testo dice "ignorato" e il menu resta aperto
  await page.setViewportSize({ width: 932, height: 390 });
  await page.waitForTimeout(200);
  await page.locator('#mt-close-resize').uncheck();
  await page.getByRole('button', { name: 'Avvia la prova del menu' }).click();
  await page.getByRole('button', { name: 'Prova menu', exact: true }).click();
  await page.setViewportSize({ width: 932, height: 330 });
  await page.waitForTimeout(400);
  t = await readout();
  check('senza la chiusura su resize il menu resta aperto e il resize e\' registrato come ignorato', (await page.locator('.menu-panel').count()) === 1 && /\(ignorato\)/.test(t) && /chiusura su resize: no/.test(t), t);
  check('il pannello si riadatta alla nuova altezza (max-height segue 100dvh)', /max-height calcolato (2[0-9]{2})(\.\d+)?px/.test(t), t.split('\n').find((l) => l.startsWith('max-height')));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
// 2) Menu dell'editor in orizzontale e in verticale: misure (nessuna correzione: in Chromium non c'e' un difetto da correggere)
async function menuEditorSuite(browser) {
  setSection('menu dell\'editor, misure');
  const combos = [[932, 430], [932, 340], [844, 390], [430, 775]];
  for (const [w, h] of combos) {
    for (const idx of [0, 1, 4]) {
      const { ctx, page } = await phone(browser, w, h, idx);
      await openSample(page);
      let tooSmall = [];
      const rows = [];
      for (const name of ['File', 'Modifica', 'Inserisci', 'Zoom']) {
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForTimeout(60);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.menu-panel');
          const hs = [...p.querySelectorAll('.menu-item')].map((e) => e.getBoundingClientRect().height);
          const r = p.getBoundingClientRect();
          return { n: hs.length, min: Math.min(...hs), scrolls: p.scrollHeight > p.clientHeight + 0.5, bottom: r.bottom, ih: innerHeight };
        });
        if (m.min < 43.99) tooSmall.push(`${name} ${m.min}`);
        rows.push(`${name}: ${m.n} voci da ${m.min.toFixed(1)} px${m.scrolls ? ' (scorre)' : ''}`);
        await page.keyboard.press('Escape');
      }
      check(`${w}x${h} A+ ${UI_PX[idx]} px: le voci di tutti i menu sono >= 44 px (getBoundingClientRect)`, tooSmall.length === 0, tooSmall.join(', '));
      info(`${w}x${h} A+ ${UI_PX[idx]} px: ${rows.join(' · ')}`);
      await ctx.close();
    }
  }
  // l'editor chiude ancora il menu al resize (comportamento invariato: e' l'ipotesi (a) da verificare sul telefono con "Prova menu")
  const { ctx, page } = await phone(browser, 932, 390, 1);
  await openSample(page);
  await page.getByRole('button', { name: 'Inserisci', exact: true }).click();
  await page.setViewportSize({ width: 932, height: 350 });
  await page.waitForTimeout(300);
  check('nell\'editor il menu si chiude ancora quando la finestra cambia altezza (comportamento invariato)', (await page.locator('.menu-panel').count()) === 0);
  await ctx.close();
}

// =====================================================================
// 3) Zoom e spostamento: puntatore perso, pulsanti sul foglio, lettura nel pannello App
async function pointerSuite(browser) {
  setSection('zoom e spostamento');
  const w = 844;
  const { ctx, page, cdp } = await phone(browser, w, 700, 4);
  await openSample(page);
  // Visore basso come nello screenshot dell'utente (circa 94 px), A+ al massimo. Era 326 px di altezza con 0fd1884 (intestazione 127.5 e stato 104.5 a 844 px con A+ 22);
  // da CP5e l'intestazione non va piu' a capo a quella larghezza (67 e 82.5): per avere lo stesso visore la finestra e' alta 244 px.
  await page.setViewportSize({ width: w, height: 244 });
  await page.waitForTimeout(800);
  const V = await page.evaluate(() => { const b = document.querySelector('.viewer').getBoundingClientRect(); const f = document.querySelector('.float-zoom').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, f: { x: f.left, y: f.top, w: f.width, h: f.height } }; });
  info(`visore ${Math.round(V.w)}x${Math.round(V.h)} px a ${w}x244, A+ 22 px; riga dei pulsanti sul foglio ${Math.round(V.f.w)}x${Math.round(V.f.h)} = ${(100 * (V.f.w * V.f.h)) / (V.w * V.h) > 0 ? ((100 * V.f.w * V.f.h) / (V.w * V.h)).toFixed(1) : 0} % dell'area del visore (${((100 * V.f.w) / V.w).toFixed(0)} % della larghezza, ${((100 * V.f.h) / V.h).toFixed(0)} % dell'altezza)`);
  check('il visore e\' basso come nello screenshot dell\'utente (tra 80 e 130 px)', V.h > 80 && V.h < 130, String(V.h));
  const cx = V.x + 150; // a sinistra dei pulsanti sul foglio
  const cy = V.y + V.h / 2;
  const drag = async (x, y, dx) => {
    await touch(cdp, 'touchStart', [[x, y, 1]]);
    for (let k = 1; k <= 8; k++) await touch(cdp, 'touchMove', [[x + (dx * k) / 8, y, 1]]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(80);
  };
  const pinch = async (s0, s1) => {
    await touch(cdp, 'touchStart', [[cx - s0, cy, 1], [cx + s0, cy, 2]]);
    for (let k = 1; k <= 8; k++) { const sp = s0 + ((s1 - s0) * k) / 8; await touch(cdp, 'touchMove', [[cx - sp, cy, 1], [cx + sp, cy, 2]]); }
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(80);
  };

  // base: un dito sposta, due dita fanno pinch, la mappa si svuota
  let a = await view(page);
  await drag(cx - 40, cy, 100);
  let b = await view(page);
  check('un dito sposta la vista (+100 px) senza cambiare lo zoom e la mappa dei puntatori resta vuota', Math.abs(b.tx - a.tx - 100) < 2 && b.zoom === a.zoom && b.pointerIds.length === 0, `${JSON.stringify([a.tx, b.tx, a.zoom, b.zoom, b.pointerIds])}`);
  a = b;
  await pinch(20, 60);
  b = await view(page);
  check('due dita fanno pinch (lo zoom cresce) e la mappa si svuota', b.zoom > a.zoom * 2 && b.pointerIds.length === 0, `${a.zoom} -> ${b.zoom}`);

  // il dito esce dal visore (basso: 94 px) mentre sposta: la cattura del puntatore lo fa continuare; anche partendo a 2 px dal bordo
  a = await view(page);
  await touch(cdp, 'touchStart', [[cx - 40, V.y + V.h - 2, 1]]);
  for (let k = 1; k <= 8; k++) await touch(cdp, 'touchMove', [[cx - 40, V.y + V.h - 2 + (150 * k) / 8, 1]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  b = await view(page);
  check('un dito che parte a 2 px dal bordo del visore ed esce (+150 px in basso, sulla barra di stato) continua a spostare la vista (cattura del puntatore)', Math.abs(b.ty - a.ty - 150) < 2 && b.zoom === a.zoom && b.pointerIds.length === 0, `ty ${a.ty.toFixed(1)} -> ${b.ty.toFixed(1)}, zoom ${a.zoom} -> ${b.zoom}`);

  // puntatore perso: il pointerup di un dito non arriva
  await touch(cdp, 'touchStart', [[cx - 40, cy, 1]]);
  const id1 = (await view(page)).pointerIds[0];
  await page.evaluate((id) => window.__swallow.add(id), id1);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  let lost = await view(page);
  check('PUNTATORE PERSO: dopo un pointerup che non arriva la mappa tiene il puntatore (condizione che si vuole provare)', lost.pointerIds.length === 1 && lost.pointerIds[0] === id1, JSON.stringify(lost.pointerIds));
  await page.evaluate((id) => window.__swallow.delete(id), id1);
  await page.waitForTimeout(1200); // il tocco nuovo arriva dopo piu' di un secondo
  a = await view(page);
  await drag(cx - 40, cy, 100);
  b = await view(page);
  check('dopo il puntatore perso UN dito sposta ancora la vista (+100 px) e NON cambia lo zoom', Math.abs(b.tx - a.tx - 100) < 2 && Math.abs(b.zoom / a.zoom - 1) < 1e-9, `zoom ${a.zoom} -> ${b.zoom} (x${(b.zoom / a.zoom).toFixed(3)}), tx ${a.tx.toFixed(1)} -> ${b.tx.toFixed(1)}, mappa [${b.pointerIds}]`);
  check('dopo quel gesto la mappa e\' vuota (il fantasma e\' stato scartato)', b.pointerIds.length === 0, JSON.stringify(b.pointerIds));
  a = b;
  await pinch(20, 60);
  b = await view(page);
  check('dopo il puntatore perso due dita fanno ancora pinch', b.zoom > a.zoom * 2, `${a.zoom} -> ${b.zoom}`);
  const logText = await page.evaluate(() => { const d = document.querySelector('.touch-diag'); d.open = true; return new Promise((r) => setTimeout(() => r(d.innerText), 700)); });
  check('il registro dice che un puntatore fantasma e\' stato scartato (id e tempo di inattivita\')', /fantasma scartato id=\d+/.test(logText), logText.slice(-600));

  // un dito appoggiato davvero e fermo per piu' di un secondo, poi il secondo dito: NON si scarta
  await touch(cdp, 'touchStart', [[cx - 40, cy, 1]]);
  await page.waitForTimeout(1300);
  a = await view(page);
  await touch(cdp, 'touchStart', [[cx - 40, cy, 1], [cx + 40, cy, 2]]);
  const two = await view(page);
  for (let k = 1; k <= 8; k++) await touch(cdp, 'touchMove', [[cx - 40 - (30 * k) / 8, cy, 1], [cx + 40 + (30 * k) / 8, cy, 2]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  b = await view(page);
  check('un dito fermo da piu\' di un secondo seguito da un secondo dito: i due puntatori restano e il pinch funziona', two.pointerIds.length === 2 && b.zoom > a.zoom * 1.5 && b.pointerIds.length === 0, `${JSON.stringify([two.pointerIds, a.zoom, b.zoom, b.pointerIds])}`);

  // pagina in secondo piano: la mappa si svuota
  await touch(cdp, 'touchStart', [[cx - 40, cy, 1]]);
  const hid = (await view(page)).pointerIds.length;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const afterHide = (await view(page)).pointerIds.length;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
  await touch(cdp, 'touchEnd', []);
  check('con la pagina in secondo piano (visibilitychange) la mappa dei puntatori si svuota', hid === 1 && afterHide === 0, `${hid} -> ${afterHide}`);

  // pulsanti sul foglio: fatti sul comportamento attuale (nessuna modifica)
  await page.evaluate(() => document.querySelector('button.tool[title="Sposta vista"]')?.click());
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(200);
  const btn = (label) => page.evaluate((l) => { const e = document.querySelector(`.float-zoom .btn[aria-label="${l}"]`); const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, vh: document.querySelector('.viewer').getBoundingClientRect().height }; }, label);
  const tap = async (r) => { await touch(cdp, 'touchStart', [[r.x + r.w / 2, r.y + r.h / 2, 1]]); await touch(cdp, 'touchEnd', []); await page.waitForTimeout(120); };
  const plus = await btn('Aumenta zoom');
  a = await view(page);
  await tap(plus);
  b = await view(page);
  info(`tocco su "Aumenta zoom": zoom x${(b.zoom / a.zoom).toFixed(3)}`);
  const minus = await btn('Riduci zoom');
  a = await view(page);
  await tap(minus);
  b = await view(page);
  info(`tocco su "Riduci zoom": zoom x${(b.zoom / a.zoom).toFixed(3)}`);
  const plus2 = await btn('Aumenta zoom');
  a = await view(page);
  await touch(cdp, 'touchStart', [[plus2.x + plus2.w / 2, plus2.y + plus2.h / 2, 1]]);
  for (let k = 1; k <= 8; k++) await touch(cdp, 'touchMove', [[plus2.x + plus2.w / 2 - (150 * k) / 8, plus2.y + plus2.h / 2, 1]]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(100);
  b = await view(page);
  info(`un dito che parte su "Aumenta zoom" e striscia 150 px a sinistra: spostamento ${(b.tx - a.tx).toFixed(1)} px, zoom x${(b.zoom / a.zoom).toFixed(3)} (il visore non lo riceve)`);
  const dist = await btn('Distanza');
  await tap(dist);
  const vh1 = await page.evaluate(() => document.querySelector('.viewer').getBoundingClientRect().height);
  info(`un tocco su "Distanza" (strumento con barra contestuale): altezza del visore ${Math.round(dist.vh)} -> ${Math.round(vh1)} px`);
  await ctx.close();
}

// =====================================================================
// 4) Lettura nel pannello App dell'editor
async function readoutSuite(browser) {
  setSection('lettura nel pannello App');
  // 932 pixel di larghezza (>= 900): il pannello e' una colonna sempre visibile, come sul 14 Pro Max in orizzontale
  const { ctx, page, cdp } = await phone(browser, 932, 390, 1);
  await openSample(page);
  check('a 932 pixel il pulsante del pannello non c\'e\' e il pannello e\' una colonna visibile', !(await page.locator('.insp-toggle').isVisible()) && (await page.locator('.inspector').isVisible()));
  const det = page.locator('.touch-diag');
  check('nel pannello App c\'e\' il riquadro "Diagnostica tocco e schermo", chiuso all\'inizio', (await det.count()) === 1 && !(await det.evaluate((e) => e.open)));
  await det.locator('summary').click();
  await page.waitForTimeout(700);
  let t = await det.locator('pre').innerText();
  check('aperto mostra schermo, margini, unita\' dvh, tipo di puntatore, altezza di barre e visore', /finestra 932x390/.test(t) && /margini di sicurezza \(su, dx, giu, sx\): 0, 59, 21, 59/.test(t) && /pointer coarse: si/.test(t) && /visore \d+(\.\d)?x\d+/.test(t) && /barre \(larg x alt\): bar/.test(t), t);
  check('mostra lo zoom del documento, lo zoom della pagina intera (visualViewport.scale 1) e la mappa dei puntatori vuota', /zoom documento/.test(t) && /visualViewport\.scale\) 1\.00/.test(t) && /puntatori nella mappa: 0 \[\]/.test(t), t);
  const V = await page.evaluate(() => { const b = document.querySelector('.viewer').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await touch(cdp, 'touchStart', [[V.x + 100, V.y + 80, 1]]);
  await touch(cdp, 'touchMove', [[V.x + 130, V.y + 80, 1]]);
  await page.waitForTimeout(700);
  t = await det.locator('pre').innerText();
  check('durante un tocco la mappa lo mostra (n=1, id) e il registro ha il "down" del visore', /puntatori nella mappa: 1 \[\d+\]/.test(t) && /down id=\d+ touch P n=1/.test(t), t);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(700);
  t = await det.locator('pre').innerText();
  check('a dita sollevate la mappa e\' vuota, il registro ha "up" e il tocco e\' registrato nella zona "visore"', /puntatori nella mappa: 0 \[\]/.test(t) && /up id=\d+ touch P n=0/.test(t) && /touch id=\d+ P su visore/.test(t), t);
  await page.locator('.float-zoom .btn[aria-label="Aumenta zoom"]').tap();
  await page.waitForTimeout(700);
  t = await det.locator('pre').innerText();
  check('un tocco su un pulsante sul foglio e\' registrato come "pulsanti sul foglio · Aumenta zoom"', /su pulsanti sul foglio · Aumenta zoom/.test(t), t);
  await ctx.close();
}

// =====================================================================
// 5) Altezza del visore in orizzontale (misura)
async function heightSuite(browser) {
  setSection('altezza del visore (misura)');
  const rows = [];
  for (const [w, h] of [[932, 430], [844, 390]]) {
    for (const idx of [0, 1, 4]) {
      for (const doc of [false, true]) {
        const { ctx, page } = await phone(browser, w, h, idx);
        if (doc) await openSample(page);
        const m = await page.evaluate(() => {
          const R = (s) => { const e = document.querySelector(s); if (!e) return 0; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display === 'none' ? 0 : Math.round(r.height * 10) / 10; };
          return { viewer: R('.viewer'), work: R('.work'), bar: R('.bar'), stat: R('.statusbar'), ctx: R('.ctxbar'), empty: R('.empty-panel'), emptyScroll: (() => { const e = document.querySelector('.empty-panel'); return e ? e.scrollHeight : 0; })(), insp: document.querySelector('.inspector') ? getComputedStyle(document.querySelector('.inspector')).display !== 'none' : false };
        });
        rows.push(`${w}x${h} A+ ${UI_PX[idx]} px ${doc ? 'con documento' : 'senza documento'}: visore ${m.work} px (lavoro), intestazione ${m.bar}, barra di stato ${m.stat}, contestuale ${m.ctx}${m.insp ? ', pannello a destra visibile' : ''}${!doc ? `, pannello vuoto alto ${m.emptyScroll} su ${m.work}` : ''}`);
        check(`${w}x${h} A+ ${UI_PX[idx]} px ${doc ? 'con' : 'senza'} documento: il visore ha un'altezza positiva`, m.work > 0);
        await ctx.close();
      }
    }
  }
  for (const r of rows) info(r);
  // con uno strumento attivo la barra contestuale prende altra altezza: misura per strumento (con documento)
  for (const [w, h] of [[932, 430], [932, 340], [844, 390]]) {
    for (const idx of [1, 4]) {
      const { ctx, page } = await phone(browser, w, h, idx);
      await openSample(page);
      const out = [];
      for (const tool of ['Sposta vista', 'Retta', 'Quota', 'Testo', 'Copertura', 'Seleziona', 'Scala']) {
        await page.evaluate((t) => document.querySelector(`button.tool[title="${t}"]`)?.click(), tool);
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => {
          const R = (q) => { const e = document.querySelector(q); if (!e) return 0; const cs = getComputedStyle(e); return cs.display === 'none' ? 0 : Math.round(e.getBoundingClientRect().height * 10) / 10; };
          return { viewer: R('.viewer'), ctx: R('.ctxbar'), stat: R('.statusbar'), bar: R('.bar') };
        });
        out.push(`${tool}: visore ${m.viewer} (contestuale ${m.ctx}, stato ${m.stat}, intestazione ${m.bar})`);
      }
      info(`${w}x${h} A+ ${UI_PX[idx]} px, con strumento attivo: ${out.join(' · ')}`);
      await ctx.close();
    }
  }
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    await menuTestSuite(browser);
    await menuEditorSuite(browser);
    await pointerSuite(browser);
    await readoutSuite(browser);
    await heightSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void join;
void OUT;
