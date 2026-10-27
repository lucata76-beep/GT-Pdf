// Prove di CP2 su Chromium: mouse (desktop 1280x800) e touch (emulazione iPhone 390x780, DPR 3, eventi touch reali via CDP).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium gia' installati (require('playwright')).
// Uso: npm run build && node scripts/e2e-cp2.cjs [cartella-screenshot]
// Avvia da solo `vite preview` su una porta libera. Esce con codice 1 se una prova fallisce.
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const SHOTS = process.argv[2] || join(require('node:os').tmpdir(), 'gtpdf-e2e');
mkdirSync(SHOTS, { recursive: true });
const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const MM = 72 / 25.4;

const results = [];
let section = '';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Pagine di prova: dimensioni del foglio mostrato in pt (CropBox e /Rotate applicati) e posizione del riferimento di 100 mm.
// Il riferimento e' disegnato da scripts/make-test-pdfs.mjs: da (28, 62) a (28 + 100 mm, 62) nello spazio utente
// (per a4-cropbox da (50+28, 50+62)). Qui si calcola dove cade sul foglio mostrato, con le formule della specifica PDF.
const A4 = { w: 595.276, h: 841.89 };
const SAMPLES = {
  'A4 vettoriale': { sheet: { w: A4.w, h: A4.h }, ref: [{ x: 28, y: A4.h - 62 }, { x: 28 + 100 * MM, y: A4.h - 62 }] },
  'A4 con /Rotate 90': { sheet: { w: A4.h, h: A4.w }, ref: [{ x: 62, y: 28 }, { x: 62, y: 28 + 100 * MM }] },
  'A4 con CropBox': { sheet: { w: 400, h: 550 }, ref: [{ x: 28, y: 600 - 112 }, { x: 28 + 100 * MM, y: 600 - 112 }] },
};

async function startServer() {
  // detached: il processo ha un proprio gruppo, cosi' alla fine si chiude anche il figlio di npx (altrimenti resta in ascolto)
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('anteprima non avviata')), 20000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on('exit', () => reject(new Error('anteprima terminata')));
  });
  return proc;
}

// ---------- Utilita' sulla pagina ----------
async function openSample(page, title) {
  await page.goto(URL);
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(700);
}
/** Foglio (pt) -> pixel CSS della finestra, usando il riquadro del canvas del foglio. */
async function toClient(page, sample, p) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
    return { l: b.left, t: b.top, w: b.width, h: b.height };
  });
  return { x: r.l + (p.x * r.w) / sample.sheet.w, y: r.t + (p.y * r.h) / sample.sheet.h };
}
const objects = (page) =>
  page.$$eval('.sc-objects path', (els) =>
    els.map((e) => ({
      pts: (e.getAttribute('d').match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number).reduce((a, v, i) => (i % 2 ? (a[a.length - 1].y = v, a) : (a.push({ x: v }), a)), []),
      stroke: e.getAttribute('stroke'),
      dash: e.getAttribute('stroke-dasharray'),
      width: Number(e.getAttribute('stroke-width')),
    })),
  );
// Scegliere uno strumento puo' far comparire la barra contestuale: la vista si restringe e, se la pagina e' "adattata",
// lo zoom cambia. Si aspetta l'assestamento prima di calcolare coordinate sul foglio.
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(350);
};
const clickAt = async (page, p) => {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
};
const status = (page) => page.locator('.st-msg').innerText();
const scaleText = (page) => page.locator('.st-scale-btn').innerText();
const hintText = (page) => page.locator('.ctx-hint').innerText();

/** Dark pixel check: il canvas del foglio ha un tratto scuro in (sx, sy)? Confronta con un punto 6 pt piu' in la. */
async function canvasDarkAt(page, sample, p) {
  return page.evaluate(
    ({ p, sw, sh }) => {
      const c = document.querySelector('.viewer-stage canvas');
      const ctx = c.getContext('2d');
      const dark = (x, y) => {
        const px = Math.round((x * c.width) / sw);
        const py = Math.round((y * c.height) / sh);
        let best = 255;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) best = Math.min(best, ctx.getImageData(px + dx, py + dy, 1, 1).data[0]);
        return best < 120;
      };
      return { on: dark(p.x, p.y), off: dark(p.x + 7, p.y + 7) };
    },
    { p, sw: sample.sheet.w, sh: sample.sheet.h },
  );
}

async function calibrateWith(page, real) {
  const input = page.locator('.dialog .dlg-fields input');
  await input.fill(real);
  await page.locator('.dialog .btn.primary').click();
}

// =====================================================================
async function mouseSuite(browser) {
  section = 'mouse';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  await page.screenshot({ path: join(SHOTS, 'mouse-01-aperto.png') });

  // --- Retta: due clic, rubber-band in anteprima ---
  await tool(page, 'Retta');
  check('Retta: guida iniziale', (await hintText(page)).includes('primo punto'));
  const a = await toClient(page, sample, { x: 100, y: 200 });
  const b = await toClient(page, sample, { x: 300, y: 200 });
  await clickAt(page, a);
  await page.mouse.move(b.x, b.y);
  check('Retta: anteprima (rubber-band) durante il passaggio del mouse', (await page.locator('.sc-preview path').count()) === 1);
  await page.mouse.down();
  await page.mouse.up();
  let objs = await objects(page);
  check('Retta: un oggetto di 2 punti', objs.length === 1 && objs[0].pts.length === 2);
  check('Retta: punti nel foglio dove si e\' cliccato (tolleranza 1.5 pt)', objs[0] && near(objs[0].pts[0].x, 100, 1.5) && near(objs[0].pts[0].y, 200, 1.5) && near(objs[0].pts[1].x, 300, 1.5), JSON.stringify(objs[0]?.pts));
  check('Retta: predefiniti continua, rosso, 1 pt', objs[0].dash === null && objs[0].stroke === '#D32F2F' && near(objs[0].width, 1, 0.8), JSON.stringify(objs[0]));
  check('Retta: anteprima sparita a fine disegno', (await page.locator('.sc-preview path').count()) === 0);

  // --- Linea: spezzata, Fine, doppio tocco sull'ultimo punto ---
  await tool(page, 'Linea');
  const pts = [{ x: 100, y: 300 }, { x: 200, y: 340 }, { x: 260, y: 300 }];
  for (const p of pts) await clickAt(page, await toClient(page, sample, p));
  check('Linea: Fine abilitato con 3 punti', await page.locator('.ctx-act.primary').isEnabled());
  await page.locator('.ctx-act.primary').click();
  objs = await objects(page);
  check('Linea: spezzata di 3 punti', objs.length === 2 && objs[1].pts.length === 3);
  for (const p of [{ x: 100, y: 400 }, { x: 200, y: 430 }]) await clickAt(page, await toClient(page, sample, p));
  await clickAt(page, await toClient(page, sample, { x: 200, y: 430 })); // stesso punto: fine
  objs = await objects(page);
  check('Linea: secondo clic sull\'ultimo punto termina (2 punti, nessun punto doppio)', objs.length === 3 && objs[2].pts.length === 2, JSON.stringify(objs[2]));

  // --- Annulla / ripeti ---
  const undo = page.locator('.undo-ctl button').nth(0);
  const redo = page.locator('.undo-ctl button').nth(1);
  await undo.click();
  check('Annulla: toglie l\'ultima linea', (await objects(page)).length === 2);
  await undo.click();
  check('Annulla: toglie anche la precedente', (await objects(page)).length === 1);
  await redo.click();
  check('Ripeti: la rimette', (await objects(page)).length === 2);
  await tool(page, 'Retta');
  await clickAt(page, await toClient(page, sample, { x: 50, y: 500 }));
  await clickAt(page, await toClient(page, sample, { x: 150, y: 560 }));
  check('Dopo una nuova azione "Ripeti" e\' disabilitato', await redo.isDisabled());
  check('...e ci sono 3 oggetti', (await objects(page)).length === 3);
  // Annulla durante la costruzione: toglie l'ultimo punto, non l'ultima linea
  await clickAt(page, await toClient(page, sample, { x: 300, y: 600 }));
  await undo.click();
  check('Annulla con una linea in costruzione toglie il punto, non la linea', (await objects(page)).length === 3 && (await page.locator('.pt-mark').count()) === 0);

  // --- Calibrazione sul riferimento di 100 mm ---
  await tool(page, 'Scala');
  check('Scala: non calibrata all\'inizio', (await scaleText(page)) === 'non calibrata');
  await clickAt(page, await toClient(page, sample, SAMPLES['A4 vettoriale'].ref[0]));
  await clickAt(page, await toClient(page, sample, SAMPLES['A4 vettoriale'].ref[1]));
  await page.waitForSelector('.dialog');
  await page.screenshot({ path: join(SHOTS, 'mouse-02-dialogo-scala.png') });
  const dlgText = await page.locator('.dialog').innerText();
  check('Dialogo: mostra la distanza misurata in pt e mm (~283.46 pt, ~100 mm)', /28[2-4]\.\d\d pt/.test(dlgText) && /(99|100)\.\d\d mm/.test(dlgText), dlgText);
  // input non valido: rifiutato con un messaggio, la finestra resta
  await calibrateWith(page, 'abc');
  check('Dialogo: "abc" rifiutato con messaggio e finestra aperta', (await page.locator('.dialog').count()) === 1 && (await page.locator('.dlg-field-msg').innerText()).length > 5);
  await calibrateWith(page, '-5');
  check('Dialogo: "-5" rifiutato', (await page.locator('.dialog').count()) === 1);
  // virgola decimale: accettata e normalizzata
  await page.locator('.dialog .dlg-fields input').fill('100,0');
  await page.locator('.dialog .dlg-fields input').dispatchEvent('change');
  check('Dialogo: "100,0" normalizzato a "100"', (await page.locator('.dialog .dlg-fields input').inputValue()) === '100');
  check('Dialogo: scala calcolata mostrata con "."', /Nuova scala: 1:(0\.9\d|1(\.0\d)?)/.test(await page.locator('.dlg-calc').innerText()), await page.locator('.dlg-calc').innerText());
  await page.locator('.dialog .btn.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached' });
  const sc = await scaleText(page);
  const n = Number(sc.replace('1:', ''));
  check('Scala applicata ~1:1 (clic al pixel: tolleranza 2%)', sc.startsWith('1:') && near(n, 1, 0.02), sc);

  // --- Distanza con scala ---
  await tool(page, 'Distanza');
  await clickAt(page, await toClient(page, sample, { x: 100, y: 700 }));
  await clickAt(page, await toClient(page, sample, { x: 100 + 50 * MM, y: 700 }));
  const badge = await page.locator('.measure-badge').innerText();
  const m = /L (\d+\.\d\d) mm/.exec(badge);
  check('Distanza: 50 mm sul foglio = ~50 mm reali con scala 1:1', !!m && near(Number(m[1]), 50, 1.5), badge);
  check('Distanza: ΔX e ΔY mostrati con segno e "."', /ΔX [+-]?\d+\.\d\d {2}ΔY [+-]?\d+\.\d\d/.test(badge), badge);
  check('Distanza: il risultato non crea un oggetto', (await objects(page)).length === 3);
  await page.screenshot({ path: join(SHOTS, 'mouse-03-distanza.png') });
  // nuova misura: il tocco successivo riparte
  await clickAt(page, await toClient(page, sample, { x: 200, y: 700 }));
  check('Distanza: nuovo punto riparte da capo (risultato precedente tolto)', (await page.locator('.measure-badge:not([hidden])').count()) === 0);

  // --- Ortogonale ---
  await tool(page, 'Retta');
  await page.locator('.st-toggle').click();
  check('ORTO: attivo', (await page.locator('.st-toggle').getAttribute('aria-pressed')) === 'true');
  const o1 = await toClient(page, sample, { x: 200, y: 100 });
  const o2 = await toClient(page, sample, { x: 330, y: 112 }); // quasi orizzontale
  await clickAt(page, o1);
  await page.mouse.move(o2.x, o2.y);
  const pv = await page.$$eval('.sc-preview path', (e) => e[0]?.getAttribute('d'));
  const pvNums = (pv || '').match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
  check('ORTO: anche l\'anteprima e\' vincolata (stessa y)', pvNums.length === 4 && near(pvNums[1], pvNums[3], 1e-6), pv);
  await page.mouse.down();
  await page.mouse.up();
  objs = await objects(page);
  const oh = objs[objs.length - 1];
  check('ORTO: retta quasi orizzontale diventa orizzontale (y uguali)', near(oh.pts[0].y, oh.pts[1].y, 1e-6) && near(oh.pts[1].x, 330, 1.5), JSON.stringify(oh.pts));
  await clickAt(page, await toClient(page, sample, { x: 400, y: 100 }));
  await clickAt(page, await toClient(page, sample, { x: 411, y: 250 })); // quasi verticale
  objs = await objects(page);
  const ov = objs[objs.length - 1];
  check('ORTO: retta quasi verticale diventa verticale (x uguali)', near(ov.pts[0].x, ov.pts[1].x, 1e-6) && near(ov.pts[1].y, 250, 1.5), JSON.stringify(ov.pts));
  await page.locator('.st-toggle').click();
  check('ORTO: si disattiva', (await page.locator('.st-toggle').getAttribute('aria-pressed')) === 'false');
  await clickAt(page, await toClient(page, sample, { x: 450, y: 100 }));
  await clickAt(page, await toClient(page, sample, { x: 520, y: 140 }));
  objs = await objects(page);
  const od = objs[objs.length - 1];
  check('ORTO spento: retta obliqua resta obliqua', !near(od.pts[0].y, od.pts[1].y, 5) && !near(od.pts[0].x, od.pts[1].x, 5), JSON.stringify(od.pts));

  // --- Proprieta': tipo, colore, spessore ---
  const insp = page.locator('.inspector');
  await insp.getByRole('button', { name: 'Tratteggiata' }).click();
  await insp.locator('button[aria-label^="Blu"]').click();
  await insp.getByRole('button', { name: '2', exact: true }).click();
  await tool(page, 'Retta');
  await clickAt(page, await toClient(page, sample, { x: 100, y: 750 }));
  await clickAt(page, await toClient(page, sample, { x: 300, y: 750 }));
  objs = await objects(page);
  let last = objs[objs.length - 1];
  check('Nuove linee: tratteggiata 16 6 (8u 3u con u = 2 pt)', last.dash === '16 6', last.dash);
  check('Nuove linee: colore blu', last.stroke === '#1565C0');
  check('Nuove linee: spessore 2 pt (o piu\' se lo zoom e\' basso)', last.width >= 2 - 1e-9);
  await insp.getByRole('button', { name: 'Tratto-punto' }).click();
  await insp.locator('button[aria-label^="Verde acqua"]').click();
  const wInput = insp.locator('input[aria-label="Spessore in pt"]');
  await wInput.fill('0,5');
  await wInput.press('Enter');
  check('Spessore digitato con virgola: accettato e normalizzato', (await wInput.inputValue()) === '0.5', await wInput.inputValue());
  await wInput.fill('abc');
  await wInput.press('Enter');
  check('Spessore "abc": rifiutato con messaggio', (await insp.locator('.ctl-msg').innerText()).length > 5);
  await wInput.fill('50');
  await wInput.press('Enter');
  check('Spessore 50: fuori campo, rifiutato', (await insp.locator('.ctl-msg').innerText()).includes('massimo'));
  await wInput.fill('0,5');
  await wInput.press('Enter');
  await insp.locator('input[aria-label^="Colore personalizzato"]').fill('#12ab34');
  await insp.locator('input[aria-label^="Colore personalizzato"]').press('Enter');
  await clickAt(page, await toClient(page, sample, { x: 100, y: 780 }));
  await clickAt(page, await toClient(page, sample, { x: 300, y: 780 }));
  objs = await objects(page);
  last = objs[objs.length - 1];
  check('Tratto-punto 0.5 pt: 6 1.5 0.5 1.5', last.dash === '6 1.5 0.5 1.5', last.dash);
  check('Colore personalizzato #12AB34', last.stroke === '#12AB34', last.stroke);
  // Applica all'ultima linea: cambia l'ultima, non le altre
  await insp.getByRole('button', { name: 'Continua' }).click();
  await insp.locator('button[aria-label^="Rosso"]').click();
  const before = await objects(page);
  await insp.getByRole('button', { name: "Applica all'ultima linea" }).click();
  const after = await objects(page);
  check("Applica all'ultima linea: solo l'ultima cambia (continua, rosso)", after[after.length - 1].dash === null && after[after.length - 1].stroke === '#D32F2F' && after[after.length - 2].dash === before[before.length - 2].dash);
  await undo.click();
  const undone = await objects(page);
  check("Annulla l'applicazione: l'ultima linea torna tratto-punto verde-custom", undone[undone.length - 1].dash === '6 1.5 0.5 1.5' && undone[undone.length - 1].stroke === '#12AB34');
  await redo.click();

  // --- Cancella ---
  const countBefore = (await objects(page)).length;
  await tool(page, 'Cancella');
  const target = await toClient(page, sample, { x: 200, y: 200 }); // sulla prima retta (100,200)-(300,200)
  await page.mouse.move(target.x, target.y + 3);
  check('Cancella: l\'oggetto sotto il mouse e\' evidenziato', (await page.locator('.sc-hl path').count()) === 1);
  await page.mouse.down();
  await page.mouse.up();
  check('Cancella: un tocco sulla linea la cancella', (await objects(page)).length === countBefore - 1);
  await undo.click();
  const restored = await objects(page);
  check('Cancella: Annulla la ripristina, allo stesso posto (la prima)', restored.length === countBefore && near(restored[0].pts[0].y, 200, 1.5), JSON.stringify(restored[0]?.pts));
  const empty = await toClient(page, sample, { x: 500, y: 500 });
  await clickAt(page, empty);
  check('Cancella: tocco nel vuoto non cancella nulla e lo dice', (await objects(page)).length === countBefore && (await status(page)).includes('Nessuna linea'), await status(page));
  await page.screenshot({ path: join(SHOTS, 'mouse-04-disegno.png') });

  // --- Tastiera ---
  await tool(page, 'Linea');
  await page.locator('.viewer').focus();
  await clickAt(page, await toClient(page, sample, { x: 300, y: 450 }));
  await clickAt(page, await toClient(page, sample, { x: 350, y: 470 }));
  await page.keyboard.press('Enter');
  check('Tastiera: Invio termina la linea', (await objects(page)).length === countBefore + 1);
  await page.keyboard.press('Control+z');
  check('Tastiera: Ctrl+Z annulla', (await objects(page)).length === countBefore);
  await page.keyboard.press('Control+Shift+z');
  check('Tastiera: Ctrl+Maiusc+Z ripete', (await objects(page)).length === countBefore + 1);

  // --- Pagina, Nuovo/Chiudi: oggetti e scala per pagina, conferma ---
  await page.getByRole('button', { name: 'Modifica' }).click();
  check('Menu Modifica: Annulla e Ripeti presenti', (await page.locator('.menu-panel').innerText()).includes('Ripeti'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chiudi' }).click();
  const dlg = await page.locator('.dialog').innerText();
  check('Chiudi con oggetti: avvisa e conta linee e scala', /linee disegnate/.test(dlg) && /scala calibrata/.test(dlg), dlg);
  await page.getByRole('button', { name: 'Annulla' }).last().click();

  check('Nessun errore in console (mouse)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function rotateCropSuite(browser) {
  section = 'rotate/crop';
  for (const title of ['A4 con /Rotate 90', 'A4 con CropBox']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const sample = SAMPLES[title];
    await openSample(page, title);
    // 1. il riferimento disegnato nel PDF cade dove lo calcoliamo (pixel del canvas renderizzato da PDF.js)
    const mid = { x: (sample.ref[0].x + sample.ref[1].x) / 2, y: (sample.ref[0].y + sample.ref[1].y) / 2 };
    const px = await canvasDarkAt(page, sample, mid);
    check(`${title}: il riferimento di 100 mm e' nel punto calcolato dal foglio mostrato (canvas)`, px.on === true && px.off === false, JSON.stringify(px));
    // 2. calibrazione e Distanza sul riferimento
    await tool(page, 'Scala');
    await clickAt(page, await toClient(page, sample, sample.ref[0]));
    await clickAt(page, await toClient(page, sample, sample.ref[1]));
    await page.waitForSelector('.dialog');
    await calibrateWith(page, '100');
    await page.waitForSelector('.dialog', { state: 'detached' });
    const n = Number((await scaleText(page)).replace('1:', ''));
    check(`${title}: calibrazione sul riferimento = ~1:1`, near(n, 1, 0.02), await scaleText(page));
    // 3. una retta disegnata sul riferimento sta sopra il tratto del PDF (stessa posizione nel foglio)
    await tool(page, 'Retta');
    await clickAt(page, await toClient(page, sample, sample.ref[0]));
    await clickAt(page, await toClient(page, sample, sample.ref[1]));
    const objs = await objects(page);
    check(`${title}: la retta disegnata coincide con il riferimento (1.5 pt)`, objs.length === 1 && near(objs[0].pts[0].x, sample.ref[0].x, 1.5) && near(objs[0].pts[0].y, sample.ref[0].y, 1.5) && near(objs[0].pts[1].x, sample.ref[1].x, 1.5) && near(objs[0].pts[1].y, sample.ref[1].y, 1.5), JSON.stringify(objs[0]?.pts));
    // 4. ortogonale come appare sullo schermo
    await page.locator('.st-toggle').click();
    await clickAt(page, await toClient(page, sample, { x: 120, y: 120 }));
    await clickAt(page, await toClient(page, sample, { x: 250, y: 131 }));
    const all = await objects(page);
    const h = all[all.length - 1];
    check(`${title}: ORTO orizzontale sullo schermo (y uguali nel foglio)`, near(h.pts[0].y, h.pts[1].y, 1e-6) && near(h.pts[1].x, 250, 1.5), JSON.stringify(h.pts));
    await clickAt(page, await toClient(page, sample, { x: 120, y: 200 }));
    await clickAt(page, await toClient(page, sample, { x: 131, y: 300 }));
    const all2 = await objects(page);
    const v = all2[all2.length - 1];
    check(`${title}: ORTO verticale sullo schermo (x uguali nel foglio)`, near(v.pts[0].x, v.pts[1].x, 1e-6) && near(v.pts[1].y, 300, 1.5), JSON.stringify(v.pts));
    // 5. Distanza: 50 mm sullo schermo, in orizzontale e in verticale
    await page.locator('.st-toggle').click();
    await tool(page, 'Distanza');
    await clickAt(page, await toClient(page, sample, { x: 100, y: 100 }));
    await clickAt(page, await toClient(page, sample, { x: 100 + 50 * MM, y: 100 }));
    const b1 = await page.locator('.measure-badge').innerText();
    await clickAt(page, await toClient(page, sample, { x: 100, y: 100 }));
    await clickAt(page, await toClient(page, sample, { x: 100, y: 100 + 50 * MM }));
    const b2 = await page.locator('.measure-badge').innerText();
    const l1 = Number(/L (\d+\.\d\d)/.exec(b1)?.[1]);
    const l2 = Number(/L (\d+\.\d\d)/.exec(b2)?.[1]);
    check(`${title}: 50 mm orizzontali e 50 mm verticali misurano ~50 mm`, near(l1, 50, 1.5) && near(l2, 50, 1.5), `${b1} / ${b2}`);
    check(`${title}: ΔX>0 per lo spostamento a destra, ΔY<0 per quello verso il basso`, /ΔX \+5\d\.\d\d {2}ΔY [+-]?0\.\d\d/.test(b1) && /ΔX [+-]?0\.\d\d {2}ΔY -5\d\.\d\d/.test(b2), `${b1} / ${b2}`);
    await page.screenshot({ path: join(SHOTS, `rotcrop-${title.includes('Rotate') ? 'rotate90' : 'cropbox'}.png`) });
    await ctx.close();
  }
}

// =====================================================================
async function touchSuite(browser) {
  section = 'iPhone 390x780';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  /** Tocco con mira: premi, (muovi), rilascia. `lens` = controlla che la lente compaia durante la mira. */
  const aimTap = async (p, via) => {
    await touch('touchStart', [p]);
    let lens = null;
    if (via) {
      await touch('touchMove', [via]);
      await touch('touchMove', [p]);
    }
    lens = await page.locator('.lens:not([hidden])').count();
    await touch('touchEnd', []);
    return lens;
  };
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'iphone-01-aperto.png') });

  // Bersagli >= 44 px e tutto dentro la larghezza
  const boxes = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 24), w: r.width, h: r.height, l: r.left, r: r.right }; }));
  const small = (list) => list.filter((b) => b.w < 43.5 || b.h < 43.5).map((b) => `${b.n} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`);
  check('Barra superiore: undo, redo, A-, A+, pannello >= 44x44', small(await boxes('.bar .btn')).length === 0, small(await boxes('.bar .btn')).join(', '));
  check('Palette: strumenti >= 44 px di altezza', small((await boxes('.palette .tool')).map((b) => ({ ...b, w: 44 }))).length === 0);
  check('Barra di stato: scala e ORTO >= 44 px', small(await boxes('.st-scale-btn, .st-toggle')).length === 0, small(await boxes('.st-scale-btn, .st-toggle')).join(', '));
  check('Distanza fluttuante presente e >= 44 px', small(await boxes('.float-dist')).length === 0 && (await boxes('.float-dist')).length === 1);

  // --- Retta con il dito e la lente ---
  await tool(page, 'Retta');
  await page.screenshot({ path: join(SHOTS, 'iphone-02-retta.png') });
  const ctxBox = await page.locator('.ctxbar').boundingBox();
  check('Barra contestuale visibile, interamente nella larghezza di 390 px', ctxBox && ctxBox.x >= 0 && ctxBox.x + ctxBox.width <= 390.5, JSON.stringify(ctxBox));
  const ctxItems = await boxes('.ctxbar .ctx-actions > *');
  check('Barra contestuale: Annulla/Fine/proprieta\' >= 44 px e dentro la larghezza', small(ctxItems).length === 0 && ctxItems.every((b) => b.r <= 390.5 && b.l >= 0), JSON.stringify(ctxItems));
  const t1 = await toClient(page, sample, { x: 150, y: 250 });
  const t2 = await toClient(page, sample, { x: 380, y: 250 });
  const lens1 = await aimTap(t1, { x: t1.x + 15, y: t1.y + 25 });
  check('Lente visibile durante la mira del dito', lens1 === 1);
  check('Retta: primo punto inserito, lente chiusa al rilascio', (await page.locator('.pt-mark').count()) === 1 && (await page.locator('.lens:not([hidden])').count()) === 0);
  await touch('touchStart', [t2]);
  await touch('touchMove', [{ x: t2.x + 4, y: t2.y + 6 }]);
  check('Retta con il dito: anteprima durante la mira', (await page.locator('.sc-preview path').count()) === 1);
  await touch('touchMove', [t2]); // si affina la mira tornando sul punto voluto
  await touch('touchEnd', []);
  let objs = await objects(page);
  check('Retta con il dito: oggetto creato nel punto toccato (tolleranza 2.5 pt: 1 px CSS ~ 1.4 pt)', objs.length === 1 && near(objs[0].pts[0].x, 150, 2.5) && near(objs[0].pts[1].y, 250, 2.5), JSON.stringify(objs[0]?.pts));

  // --- Ortogonale con il dito: la lente mostra il punto vincolato ---
  await page.locator('.st-toggle').click();
  check('ORTO acceso dal tocco', (await page.locator('.st-toggle').getAttribute('aria-pressed')) === 'true');
  const u1 = await toClient(page, sample, { x: 150, y: 400 });
  const u2 = await toClient(page, sample, { x: 360, y: 412 });
  await aimTap(u1);
  await touch('touchStart', [u2]);
  const pvd = await page.$$eval('.sc-preview path', (e) => e[0]?.getAttribute('d'));
  const nums = (pvd || '').match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
  check('ORTO con il dito: anteprima orizzontale', nums.length === 4 && near(nums[1], nums[3], 1e-6), pvd);
  await touch('touchEnd', []);
  objs = await objects(page);
  const ho = objs[objs.length - 1];
  check('ORTO con il dito: retta orizzontale', objs.length === 2 && near(ho.pts[0].y, ho.pts[1].y, 1e-6));
  await page.locator('.st-toggle').click();

  // --- Due dita non inseriscono punti (pinch) ---
  await tool(page, 'Linea');
  const before = (await objects(page)).length;
  const c0 = await toClient(page, sample, { x: 300, y: 500 });
  await touch('touchStart', [c0, { x: c0.x + 60, y: c0.y }]);
  await touch('touchMove', [{ x: c0.x - 10, y: c0.y }, { x: c0.x + 80, y: c0.y }]);
  await touch('touchEnd', []);
  check('Pinch con strumento di disegno attivo: nessun punto inserito', (await page.locator('.pt-mark').count()) === 0 && (await objects(page)).length === before);
  await tool(page, 'Sposta vista');
  await page.locator('.float-zoom button[aria-label="Adatta alla pagina"]').click();
  await page.waitForTimeout(300);

  // --- Linea: proprieta' dal pannello contestuale ---
  await tool(page, 'Linea');
  await page.locator('.ctx-style').click();
  const pop = await page.locator('.props-pop').boundingBox();
  await page.screenshot({ path: join(SHOTS, 'iphone-03-proprieta.png') });
  check('Pannello proprieta\': dentro lo schermo (390x780)', pop && pop.x >= 0 && pop.x + pop.width <= 390.5 && pop.y >= 0 && pop.y + pop.height <= 780, JSON.stringify(pop));
  const popBtns = await boxes('.props-pop .btn');
  check('Pannello proprieta\': pulsanti >= 44 px', small(popBtns).length === 0, small(popBtns).join(', '));
  await page.locator('.props-pop').getByRole('button', { name: 'Tratteggiata' }).click();
  await page.locator('.props-pop button[aria-label^="Arancio"]').click();
  await page.locator('.props-pop').getByRole('button', { name: '1.5', exact: true }).click();
  const chip = await page.locator('.ctx-style').innerText();
  check('Chip proprieta\' riassume lo spessore (1.5 pt)', chip.includes('1.5 pt'), chip);
  await page.mouse.click(195, 60); // tocco fuori dal pannello (sulla barra)... il pannello si chiude
  await page.waitForTimeout(200);
  check('Pannello proprieta\' si chiude toccando fuori', await page.locator('.props-pop').isHidden());
  const l1 = await toClient(page, sample, { x: 120, y: 600 });
  const l2 = await toClient(page, sample, { x: 250, y: 650 });
  const l3 = await toClient(page, sample, { x: 380, y: 600 });
  await aimTap(l1);
  await aimTap(l2);
  await aimTap(l3);
  await page.locator('.ctx-act.primary').click();
  objs = await objects(page);
  const pl = objs[objs.length - 1];
  check('Linea con il dito: 3 punti, tratteggiata arancio 1.5 pt', pl.pts.length === 3 && pl.dash === '12 4.5' && pl.stroke === '#E65100', JSON.stringify(pl));

  // --- Annulla/ripeti dalla barra ---
  const n0 = (await objects(page)).length;
  await page.locator('.undo-ctl button').nth(0).tap();
  check('Annulla (tocco)', (await objects(page)).length === n0 - 1);
  await page.locator('.undo-ctl button').nth(1).tap();
  check('Ripeti (tocco)', (await objects(page)).length === n0);

  // --- Cancella con un tocco ---
  await tool(page, 'Cancella');
  const e1 = await toClient(page, sample, { x: 265, y: 250 }); // sulla prima retta, un po' fuori (4 px)
  await touch('touchStart', [{ x: e1.x, y: e1.y + 6 }]);
  check('Cancella con il dito: oggetto evidenziato durante il tocco', (await page.locator('.sc-hl path').count()) === 1);
  await touch('touchEnd', []);
  check('Cancella con il dito: linea cancellata', (await objects(page)).length === n0 - 1);
  await page.locator('.undo-ctl button').nth(0).tap();
  check('Cancella: Annulla la ripristina', (await objects(page)).length === n0);
  // trascinare non cancella: sposta la vista
  const d1 = await toClient(page, sample, { x: 265, y: 250 });
  await touch('touchStart', [d1]);
  await touch('touchMove', [{ x: d1.x + 30, y: d1.y }]);
  await touch('touchEnd', []);
  check('Cancella: un trascinamento non cancella', (await objects(page)).length === n0);
  await page.locator('.float-zoom button[aria-label="Adatta alla pagina"]').click();
  await page.waitForTimeout(300);

  // --- Scala con il dito + dialogo con tastiera ---
  await tool(page, 'Scala');
  await aimTap(await toClient(page, sample, sample.ref[0]));
  await aimTap(await toClient(page, sample, sample.ref[1]));
  await page.waitForSelector('.dialog');
  await page.screenshot({ path: join(SHOTS, 'iphone-04-dialogo-scala.png') });
  const dbox = await page.locator('.dialog').boundingBox();
  check('Dialogo scala: dentro lo schermo 390x780', dbox && dbox.x >= 0 && dbox.x + dbox.width <= 390.5 && dbox.y >= 0 && dbox.y + dbox.height <= 780, JSON.stringify(dbox));
  const dfs = await page.locator('.dialog .dlg-fields input').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check('Campo del dialogo: font >= 16 px (Safari non ingrandisce la pagina)', dfs >= 16, String(dfs));
  const im = await page.locator('.dialog .dlg-fields input').getAttribute('inputmode');
  check('Campo del dialogo: tastierino decimale (inputmode=decimal)', im === 'decimal');
  await page.locator('.dialog .dlg-fields input').fill('100,5');
  await page.locator('.dialog .btn.primary').tap();
  await page.waitForSelector('.dialog', { state: 'detached' });
  const sc = await scaleText(page);
  check('Scala applicata dal tocco (virgola accettata): ~1:1.005', sc.startsWith('1:') && near(Number(sc.slice(2)), 1.005, 0.03), sc);

  // --- Distanza dal pulsante fluttuante ---
  await page.locator('.float-dist').tap();
  check('Distanza fluttuante: attiva lo strumento', (await page.locator('.float-dist').getAttribute('aria-pressed')) === 'true');
  await aimTap(await toClient(page, sample, { x: 100, y: 700 }));
  await aimTap(await toClient(page, sample, { x: 100 + 40 * MM, y: 700 }));
  const bd = await page.locator('.measure-badge').innerText();
  const bb = await page.locator('.measure-badge').boundingBox();
  check('Distanza col dito: ~40 mm reali (scala 1:1.005 -> ~40.2)', near(Number(/L (\d+\.\d\d)/.exec(bd)?.[1]), 40.2, 1.5), bd);
  check('Badge di misura dentro lo schermo', bb && bb.x >= 0 && bb.x + bb.width <= 390.5, JSON.stringify(bb));
  await page.screenshot({ path: join(SHOTS, 'iphone-05-distanza.png') });
  await page.locator('.float-dist').tap();
  check('Distanza fluttuante: secondo tocco torna a Sposta vista', (await page.locator('.float-dist').getAttribute('aria-pressed')) === 'false' && (await page.locator('.ctxbar').isHidden()));

  // --- Layout verticale e orizzontale: nessun overflow orizzontale della pagina ---
  const ov = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('Nessuno scorrimento orizzontale della pagina', ov);
  check('Nessun errore in console (iPhone)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function extraSuite(browser) {
  section = 'pagine, tastiera, orizzontale';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await openSample(page, '3 pagine miste');
  const a4 = { sheet: { w: A4.w, h: A4.h } };
  const pageLabel = () => page.locator('.st-page').innerText();
  const undo = page.locator('.undo-ctl button').nth(0);
  const redo = page.locator('.undo-ctl button').nth(1);
  const next = page.locator('.st-pager button').nth(1);
  const prev = page.locator('.st-pager button').nth(0);
  check('3 pagine: si parte dalla pagina 1', (await pageLabel()) === '1 / 3');

  // pagina 1: scala 1:1 e una retta
  await tool(page, 'Scala');
  const ref = SAMPLES['A4 vettoriale'].ref;
  await clickAt(page, await toClient(page, a4, ref[0]));
  await clickAt(page, await toClient(page, a4, ref[1]));
  await page.waitForSelector('.dialog');
  // Invio nel campo conferma
  await page.locator('.dialog .dlg-fields input').fill('100');
  await page.locator('.dialog .dlg-fields input').press('Enter');
  await page.waitForSelector('.dialog', { state: 'detached' });
  const s1 = await scaleText(page);
  check('Pagina 1: Invio nel campo conferma la scala (~1:1)', near(Number(s1.replace('1:', '')), 1, 0.02), s1);
  await tool(page, 'Retta');
  await clickAt(page, await toClient(page, a4, { x: 100, y: 100 }));
  await clickAt(page, await toClient(page, a4, { x: 300, y: 100 }));
  check('Pagina 1: una retta', (await objects(page)).length === 1);

  // pagina 2: non calibrata, nessun oggetto; calibra con un altro valore e disegna
  await next.click();
  await page.waitForTimeout(900);
  check('Pagina 2: scala propria (non calibrata) e nessun oggetto della pagina 1', (await scaleText(page)) === 'non calibrata' && (await objects(page)).length === 0);
  const a3 = { sheet: { w: 1190.551, h: 841.89 } };
  await tool(page, 'Scala');
  await clickAt(page, await toClient(page, a3, { x: 100, y: 400 }));
  await clickAt(page, await toClient(page, a3, { x: 100 + 100 * MM, y: 400 }));
  await page.waitForSelector('.dialog');
  await page.locator('.dialog .dlg-fields input').fill('200');
  await page.locator('.dialog .btn.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached' });
  const s2 = await scaleText(page);
  check('Pagina 2: scala ~1:2, indipendente dalla pagina 1', near(Number(s2.replace('1:', '')), 2, 0.05), s2);
  await tool(page, 'Linea');
  for (const p of [{ x: 200, y: 200 }, { x: 400, y: 260 }, { x: 600, y: 200 }]) await clickAt(page, await toClient(page, a3, p));
  await page.keyboard.press('Enter');
  check('Pagina 2: una linea', (await objects(page)).length === 1);
  // Distanza usa la scala della pagina: 50 mm di foglio = ~100 mm reali
  await tool(page, 'Distanza');
  await clickAt(page, await toClient(page, a3, { x: 100, y: 600 }));
  await clickAt(page, await toClient(page, a3, { x: 100 + 50 * MM, y: 600 }));
  const bd = await page.locator('.measure-badge').innerText();
  check('Pagina 2: Distanza con la scala della pagina (~100 mm per 50 mm di foglio)', near(Number(/L (\d+\.\d\d)/.exec(bd)?.[1]), 100, 3), bd);

  // Annulla attraversa le pagine: torna alla pagina interessata
  await tool(page, 'Sposta vista');
  await undo.click(); // annulla la linea (pagina 2)
  check('Annulla: toglie la linea della pagina 2', (await objects(page)).length === 0 && (await pageLabel()) === '2 / 3');
  await undo.click(); // annulla la calibrazione (pagina 2)
  check('Annulla: toglie la calibrazione della pagina 2', (await scaleText(page)) === 'non calibrata' && (await pageLabel()) === '2 / 3');
  await prev.click();
  await page.waitForTimeout(700);
  check('Tornando alla pagina 1: scala e retta ci sono ancora', near(Number((await scaleText(page)).replace('1:', '')), 1, 0.02) && (await objects(page)).length === 1);
  await next.click();
  await page.waitForTimeout(700);
  await undo.click(); // annulla la retta, che e' della pagina 1: l'app mostra la pagina 1
  await page.waitForTimeout(700);
  check('Annulla di un\'azione di un\'altra pagina: l\'app mostra quella pagina', (await pageLabel()) === '1 / 3' && (await objects(page)).length === 0, await pageLabel());
  await redo.click();
  await page.waitForTimeout(500);
  check('Ripeti: la retta torna (pagina 1)', (await objects(page)).length === 1 && (await pageLabel()) === '1 / 3');

  // Cambiare pagina con punti in costruzione: la costruzione e' scartata
  await tool(page, 'Linea');
  await clickAt(page, await toClient(page, a4, { x: 300, y: 300 }));
  check('Linea: un punto in costruzione', (await page.locator('.pt-mark').count()) === 1);
  await next.click();
  await page.waitForTimeout(700);
  check('Cambio pagina: punti in costruzione scartati', (await page.locator('.pt-mark').count()) === 0 && (await page.locator('.ctx-act.primary').isDisabled()));
  // Esc annulla la costruzione
  await clickAt(page, await toClient(page, a3, { x: 300, y: 300 }));
  await page.keyboard.press('Escape');
  check('Esc: annulla la costruzione', (await page.locator('.pt-mark').count()) === 0);
  // Esc chiude il dialogo di scala e scarta i punti
  await tool(page, 'Scala');
  await clickAt(page, await toClient(page, a3, { x: 300, y: 300 }));
  await clickAt(page, await toClient(page, a3, { x: 500, y: 300 }));
  await page.waitForSelector('.dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { state: 'detached' });
  check('Dialogo scala annullato: nessuna scala applicata e punti scartati', (await scaleText(page)) === 'non calibrata' && (await page.locator('.pt-mark').count()) === 0);
  await page.screenshot({ path: join(SHOTS, 'pagine-a3.png') });
  check('Nessun errore in console (pagine)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // --- iPhone in orizzontale (780x390) e A+ al massimo (390x780) ---
  const phone = (w, h) => browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const land = await phone(780, 390);
  const lp = await land.newPage();
  await openSample(lp, 'A4 vettoriale');
  await tool(lp, 'Linea');
  await lp.screenshot({ path: join(SHOTS, 'iphone-orizzontale.png') });
  const lw = await lp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  check('iPhone orizzontale: nessuno scorrimento della pagina', lw.sw <= lw.iw && lw.sh <= lw.ih, JSON.stringify(lw));
  const vb = await lp.locator('.viewer').boundingBox();
  check('iPhone orizzontale: il foglio ha almeno 150 px di altezza', vb && vb.height >= 150, JSON.stringify(vb));
  await land.close();

  const big = await phone(390, 780);
  const bp = await big.newPage();
  await openSample(bp, 'A4 vettoriale');
  for (let i = 0; i < 3; i++) await bp.locator('.size-btn').nth(1).click(); // 16 -> 22 px in 3 passi
  await tool(bp, 'Linea');
  await bp.screenshot({ path: join(SHOTS, 'iphone-A-piu-max.png') });
  const items = await bp.$$eval('.ctxbar .ctx-actions > *, .st-toggle, .st-scale-btn', (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.textContent || '').trim().slice(0, 12), l: r.left, r: r.right }; }));
  check('A+ al massimo (22 px): barra contestuale e stato dentro i 390 px', items.every((b) => b.l >= -0.5 && b.r <= 390.5), JSON.stringify(items));
  const ov = await bp.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('A+ al massimo: nessuno scorrimento orizzontale', ov);
  await big.close();
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await mouseSuite(browser);
    await rotateCropSuite(browser);
    await touchSuite(browser);
    await extraSuite(browser);
  } catch (e) {
    check('esecuzione senza eccezioni', false, e.stack || String(e));
  } finally {
    await browser.close();
    process.kill(-server.pid);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} prove superate. Screenshot in ${SHOTS}`);
  if (failed.length) {
    console.log('FALLITE:');
    for (const f of failed) console.log(` - [${f.section}] ${f.name} ${f.detail}`);
    process.exit(1);
  }
})();
