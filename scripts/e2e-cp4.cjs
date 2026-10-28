// Prove di CP4 su Chromium: mouse (desktop 1280x800) e touch (emulazione iPhone 390x780 e in orizzontale, DPR 3, eventi touch reali via CDP).
// Coperture bianche (rettangolo, quadrato, cerchio: costruzione, contorno solo a schermo, ordine sotto gli oggetti, annulla/ripeti, Cancella),
// Seleziona (tolleranza, primo piano, trascinamento = un comando, trascinare altrove sposta la vista) e proprieta' dell'oggetto selezionato.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium gia' installati (require('playwright')).
// Uso: npm run build && node scripts/e2e-cp4.cjs [cartella-screenshot]
// Avvia da solo `vite preview` su una porta libera. Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const SHOTS = process.argv[2] || join(require('node:os').tmpdir(), 'gtpdf-e2e-cp4');
mkdirSync(SHOTS, { recursive: true });
const PORT = 4184;
const URL = `http://localhost:${PORT}/`;
const MM = 72 / 25.4;
const A4 = { w: 595.276, h: 841.89 };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const results = [];
let section = '';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
};
const info = (text) => console.log(`INFO  [${section}] ${text}`);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const SAMPLES = {
  'A4 vettoriale': { sheet: { w: A4.w, h: A4.h }, ref: [{ x: 28, y: A4.h - 62 }, { x: 28 + 100 * MM, y: A4.h - 62 }] },
  'A4 con /Rotate 90': { sheet: { w: A4.h, h: A4.w }, ref: [{ x: 62, y: 28 }, { x: 62, y: 28 + 100 * MM }] },
};

async function startServer() {
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

// ---------- Utilita' ----------
async function openSample(page, title) {
  await page.goto(URL);
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(700);
}
const canvasRect = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
    return { l: b.left, t: b.top, w: b.width, h: b.height };
  });
async function toClient(page, sample, p) {
  const r = await canvasRect(page);
  return { x: r.l + (p.x * r.w) / sample.sheet.w, y: r.t + (p.y * r.h) / sample.sheet.h };
}
/** Pixel CSS per pt del foglio (zoom attuale). */
const scaleK = async (page, sample) => (await canvasRect(page)).w / sample.sheet.w;
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(250);
};
const nums = (d) => (d || '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);
const display = (page) => page.locator('.kp-display').innerText();
const ok = (page) => page.locator('.kp-ok').click();
const undoTitle = (page) => page.locator('.undo-ctl button').nth(0).getAttribute('title');
const undoClick = (page) => page.locator('.undo-ctl button').nth(0).click();
const redoClick = (page) => page.locator('.undo-ctl button').nth(1).click();

// Livello di disegno
const covers = (page) =>
  page.$$eval('.sc-covers > *', (els) =>
    els.map((e) => ({
      id: e.dataset.id,
      tag: e.tagName,
      x: +(e.getAttribute('x') ?? NaN),
      y: +(e.getAttribute('y') ?? NaN),
      w: +(e.getAttribute('width') ?? NaN),
      h: +(e.getAttribute('height') ?? NaN),
      cx: +(e.getAttribute('cx') ?? NaN),
      cy: +(e.getAttribute('cy') ?? NaN),
      r: +(e.getAttribute('r') ?? NaN),
      fill: e.getAttribute('fill'),
      stroke: e.getAttribute('stroke'),
      transform: e.getAttribute('transform'),
    })),
  );
const lines = (page) =>
  page.$$eval('.sc-objects > path', (els) => els.map((e) => ({ id: e.dataset.id, d: e.getAttribute('d'), stroke: e.getAttribute('stroke'), w: +e.getAttribute('stroke-width'), dash: e.getAttribute('stroke-dasharray'), transform: e.getAttribute('transform') })));
const readGroup = (g) => ({
  id: g.dataset.id,
  transform: g.getAttribute('transform'),
  paths: [...g.querySelectorAll('path')].map((p) => ({ d: p.getAttribute('d'), w: +p.getAttribute('stroke-width'), stroke: p.getAttribute('stroke') })),
  arrows: [...g.querySelectorAll('polygon')].map((p) => p.getAttribute('points')),
  rect: g.querySelector('rect') ? { x: +g.querySelector('rect').getAttribute('x'), y: +g.querySelector('rect').getAttribute('y') } : null,
  text: g.querySelector('text')?.textContent ?? null,
  tx: g.querySelector('text') ? +g.querySelector('text').getAttribute('x') : null,
  ty: g.querySelector('text') ? +g.querySelector('text').getAttribute('y') : null,
  size: g.querySelector('text') ? +g.querySelector('text').getAttribute('font-size') : null,
  fill: g.querySelector('text')?.getAttribute('fill') ?? null,
});
const annots = (page) => page.$$eval('.sc-objects .sc-ann', (gs, src) => gs.map((g) => new Function('g', `return (${src})(g)`)(g)), readGroup.toString());
const selShapes = (page) => page.$$eval('.sc-sel > *', (els) => els.map((e) => e.tagName.toLowerCase()));
const outlineShapes = (page) =>
  page.$$eval('.sc-outline > *', (els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), w: +(e.getAttribute('width') ?? NaN), h: +(e.getAttribute('height') ?? NaN), x: +(e.getAttribute('x') ?? NaN), y: +(e.getAttribute('y') ?? NaN), r: +(e.getAttribute('r') ?? NaN) })));
const inspHeadings = (page) => page.$$eval('.inspector .insp-sec > .insp-h', (els) => els.map((e) => e.textContent.trim()));
const visibleSections = (page, root = '.inspector') => page.$$eval(`${root} .style-ctl .ctl-sec`, (els) => els.filter((e) => !e.hidden).map((e) => e.querySelector('h3').textContent.trim()));

/** Tutti i numeri di una stringa di tracciato o di punti, a coppie (x, y). */
const shifted = (before, after, dx, dy, tol = 0.02) => {
  const a = nums(before);
  const b = nums(after);
  if (a.length !== b.length || a.length === 0) return false;
  return a.every((v, i) => near(b[i] - v, i % 2 === 0 ? dx : dy, tol));
};
const sameNums = (a, b, tol = 0.001) => {
  const x = nums(a);
  const y = nums(b);
  return x.length === y.length && x.every((v, i) => near(v, y[i], tol));
};

/** Conta i pixel di una regione (in coordinate client): non bianchi, rossastri (#D32F2F e sue sfumature) e bianchi puri. */
async function regionStats(decoder, page, clip) {
  const buf = await page.screenshot({ clip });
  return decoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonwhite = 0;
    let reddish = 0;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r < 235 || g < 235 || b < 235) nonwhite++;
      if (r > 150 && r - g > 40 && r - b > 40) reddish++;
      if (r >= 250 && g >= 250 && b >= 250) white++;
    }
    return { nonwhite, reddish, white, n: c.width * c.height };
  }, buf.toString('base64'));
}
/** Rettangolo client da una regione del foglio (pt). */
async function clipOf(page, sample, x0, y0, x1, y1) {
  const a = await toClient(page, sample, { x: x0, y: y0 });
  const b = await toClient(page, sample, { x: x1, y: y1 });
  return { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(b.x - a.x), height: Math.round(b.y - a.y) };
}

async function calibrate(page, sample, tap, real = '100') {
  await tool(page, 'Scala');
  await tap(sample.ref[0]);
  await tap(sample.ref[1]);
  await page.waitForSelector('.dialog');
  await page.locator('.dialog .dlg-fields input').fill(real);
  await page.locator('.dialog .btn.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached' });
}

// =====================================================================
async function mouseSuite(browser, decoder) {
  section = 'mouse';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  const tapSheet = async (p) => {
    const c = await toClient(page, sample, p);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
  };
  const dragClient = async (from, to, steps = 8, mid) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    if (mid) await mid();
    await page.mouse.up();
  };
  let k = await scaleK(page, sample);
  const refreshK = async () => (k = await scaleK(page, sample));

  // --- Palette e menu ---
  check('Palette: Seleziona e Copertura attivi', !(await page.locator('button.tool[title="Seleziona"]').isDisabled()) && !(await page.locator('button.tool[title="Copertura"]').isDisabled()));
  const toolTitles = await page.$$eval('.palette .tool', (els) => els.map((e) => e.getAttribute('title')));
  check('Palette: 10 voci (9 visibili su schermo stretto, Distanza e\' nei pulsanti sul foglio)', toolTitles.length === 10 && toolTitles[1] === 'Seleziona' && toolTitles.at(-1) === 'Copertura', toolTitles.join(','));
  await page.getByRole('button', { name: 'Modifica', exact: true }).click();
  const selItem = page.getByRole('menuitem', { name: 'Seleziona / sposta' });
  check('Menu Modifica: "Seleziona / sposta" attivo', !(await selItem.isDisabled()));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Inserisci', exact: true }).click();
  const coverItems = await page.getByRole('menuitem', { name: /^Copertura / }).allInnerTexts();
  check('Menu Inserisci: tre coperture (rettangolare, quadrata, circolare)', coverItems.length === 3 && coverItems.every((t) => !/CP4/.test(t)), coverItems.join(' | '));
  await page.getByRole('menuitem', { name: 'Copertura circolare' }).click();
  check('Menu Inserisci > Copertura circolare: strumento Copertura e forma Cerchio', (await page.locator('button.tool[aria-pressed="true"]').getAttribute('title')) === 'Copertura' && (await page.locator('.ctx-covers button[aria-pressed="true"]').innerText()) === 'Cerchio');
  check('Copertura: barra contestuale con 3 forme', (await page.locator('.ctx-covers button').count()) === 3 && (await page.locator('.ctx-covers').isVisible()));
  await page.getByRole('button', { name: 'Modifica', exact: true }).click();
  await selItem.click();
  check('Menu Modifica > Seleziona / sposta: strumento Seleziona', (await page.locator('button.tool[aria-pressed="true"]').getAttribute('title')) === 'Seleziona');

  // --- Oggetti di partenza: scala, testi, quota, rette ---
  await calibrate(page, sample, tapSheet);
  await tool(page, 'Testo');
  await tapSheet({ x: 60, y: 200 });
  await page.keyboard.type('FORO');
  await page.keyboard.press('Enter');
  await tool(page, 'Quota');
  await page.locator('.ctx-types button', { hasText: 'Orizz.' }).click();
  await tapSheet({ x: 150, y: 300 });
  await tapSheet({ x: 440, y: 320 });
  await tapSheet({ x: 300, y: 250 });
  const autoLabel = (await display(page)).trim();
  await ok(page);
  await tool(page, 'Retta');
  await tapSheet({ x: 100, y: 500 });
  await tapSheet({ x: 400, y: 500 });
  await tool(page, 'Testo');
  await tapSheet({ x: 200, y: 530 });
  await page.keyboard.type('ABC');
  await page.keyboard.press('Enter');
  const an0 = await annots(page);
  check('Partenza: due testi e una quota, una retta', an0.length === 3 && (await lines(page)).length === 1 && /^\d+\.\d\d$/.test(autoLabel), JSON.stringify(an0.map((a) => a.text)));
  const dimId = an0.find((a) => /^\d+\.\d\d$/.test(a.text))?.id;
  const t1Id = an0.find((a) => a.text === 'FORO')?.id;

  // --- Copertura rettangolare sopra la retta (creata prima): sta sotto ---
  await tool(page, 'Copertura');
  await page.locator('.ctx-covers button', { hasText: 'Rettangolo' }).click();
  check('Copertura: testo guida del primo angolo', /Copertura rettangolare: indica il primo angolo/.test(await page.locator('.ctx-hint').innerText()), await page.locator('.ctx-hint').innerText());
  await tapSheet({ x: 150, y: 450 });
  const c2 = await toClient(page, sample, { x: 350, y: 550 });
  await page.mouse.move(c2.x, c2.y);
  let ol = await outlineShapes(page);
  check('In costruzione: contorno sottile del rettangolo (solo a schermo), fondo bianco nello strato delle coperture', ol.length === 1 && ol[0].tag === 'rect' && near(ol[0].w, 200, 0.6) && near(ol[0].h, 100, 0.6) && (await page.locator('.sc-cover-draft rect').getAttribute('fill')) === '#ffffff');
  await page.screenshot({ path: join(SHOTS, 'mouse-01-costruzione.png') });
  await page.mouse.down();
  await page.mouse.up();
  let cv = await covers(page);
  check('Rettangolo creato: x,y,larghezza,altezza come i due angoli indicati', cv.length === 1 && cv[0].tag === 'rect' && near(cv[0].x, 150, 0.6) && near(cv[0].y, 450, 0.6) && near(cv[0].w, 200, 0.8) && near(cv[0].h, 100, 0.8), JSON.stringify(cv));
  check('Riempimento bianco, senza bordo', cv[0]?.fill === '#ffffff' && cv[0]?.stroke === 'none');
  check('Non selezionata e non in costruzione: nessun contorno sullo schermo', (await outlineShapes(page)).length === 0 && (await selShapes(page)).length === 0 && (await page.locator('.sc-cover-draft > *').count()) === 0);
  check('Messaggio di stato e annulla "Copertura rettangolare"', /Copertura rettangolare aggiunta/.test(await status(page)) && (await undoTitle(page)) === 'Annulla Copertura rettangolare', `${await status(page)} / ${await undoTitle(page)}`);
  // ordine: la retta e il testo "ABC" sono stati creati PRIMA della copertura ma restano sopra
  const order = await page.evaluate(() => {
    const c = document.querySelector('.sc-covers');
    const o = document.querySelector('.sc-objects');
    return { coversBeforeObjects: !!(c.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING), objs: o.children.length };
  });
  check('Ordine: lo strato delle coperture precede (sta sotto) quello di linee, quote e testi', order.coversBeforeObjects && order.objs === 4, JSON.stringify(order));
  const clipR1 = await clipOf(page, sample, 230, 497, 270, 503);
  const sR1 = await regionStats(decoder, page, clipR1);
  check('La retta rossa creata prima della copertura si vede ANCORA sopra di essa', sR1.reddish > 20, JSON.stringify(sR1));
  const clipT2 = await clipOf(page, sample, 199, 521, 226, 533);
  const sT2 = await regionStats(decoder, page, clipT2);
  check('Il testo creato prima della copertura si vede ANCORA sopra di essa', sT2.reddish > 2, JSON.stringify(sT2));
  // la copertura nasconde il disegno del PDF (cerchio grande: il suo bordo sinistro passa da x=136.9 a y=353; qui e' sulla retta y=500: nessun tratto del PDF nella zona, si usa il riferimento)
  // copertura sul segmento di riferimento da 100 mm
  const clipRef = await clipOf(page, sample, 20, 764, 330, 794);
  const before = await regionStats(decoder, page, clipRef);
  await tapSheet({ x: 10, y: 760 });
  await tapSheet({ x: 345, y: 800 });
  const after = await regionStats(decoder, page, clipRef);
  check('La copertura nasconde il disegno sotto (riferimento 100 mm): pixel non bianchi prima > 50, dopo 0', before.nonwhite > 50 && after.nonwhite === 0, JSON.stringify({ before, after }));
  check('...e la zona e\' bianca', after.white === after.n, JSON.stringify(after));
  await undoClick(page);
  const undone = await regionStats(decoder, page, clipRef);
  check('Annulla: la copertura sparisce e il disegno ricompare', undone.nonwhite === before.nonwhite && (await covers(page)).length === 1, JSON.stringify({ undone, before }));
  await redoClick(page);
  check('Ripeti: la copertura torna', (await covers(page)).length === 2 && (await regionStats(decoder, page, clipRef)).nonwhite === 0);

  // --- Quadrato ---
  await tool(page, 'Copertura');
  await page.locator('.ctx-covers button', { hasText: 'Quadrato' }).click();
  check('Quadrato: testo guida', /Copertura quadrata: indica un angolo/.test(await page.locator('.ctx-hint').innerText()));
  await tapSheet({ x: 200, y: 600 });
  const sq = await toClient(page, sample, { x: 300, y: 640 });
  await page.mouse.move(sq.x, sq.y);
  ol = await outlineShapes(page);
  check('Quadrato in costruzione: il contorno e\' gia\' un quadrato di lato 100 (maggiore tra 100 e 40)', ol.length === 1 && near(ol[0].w, 100, 0.8) && near(ol[0].h, 100, 0.8) && near(ol[0].x, 200, 0.8) && near(ol[0].y, 600, 0.8), JSON.stringify(ol));
  await page.mouse.down();
  await page.mouse.up();
  cv = await covers(page);
  const sq1 = cv.at(-1);
  check('Quadrato creato: 100 x 100 con un angolo nel primo punto', cv.length === 3 && near(sq1.x, 200, 0.8) && near(sq1.y, 600, 0.8) && near(sq1.w, 100, 0.8) && near(sq1.h, 100, 0.8), JSON.stringify(sq1));
  await tapSheet({ x: 500, y: 600 });
  await tapSheet({ x: 450, y: 560 }); // dx = -50, dy = -40 -> lato 50 verso sinistra e verso l'alto
  const sq2 = (await covers(page)).at(-1);
  check('Quadrato verso sinistra e in alto: lato = il maggiore (50), cresce verso il punto indicato', near(sq2.x, 450, 0.8) && near(sq2.y, 550, 0.8) && near(sq2.w, 50, 0.8) && near(sq2.h, 50, 0.8), JSON.stringify(sq2));

  // --- Cerchio ---
  await tool(page, 'Copertura');
  await page.locator('.ctx-covers button', { hasText: 'Cerchio' }).click();
  await tapSheet({ x: 500, y: 420 });
  const ce = await toClient(page, sample, { x: 560, y: 420 });
  await page.mouse.move(ce.x, ce.y);
  ol = await outlineShapes(page);
  check('Cerchio in costruzione: contorno sottile di raggio 60', ol.length === 1 && ol[0].tag === 'circle' && near(ol[0].r, 60, 0.8), JSON.stringify(ol));
  await page.mouse.down();
  await page.mouse.up();
  const ci = (await covers(page)).at(-1);
  check('Cerchio creato: centro nel primo punto, raggio = distanza dal punto sul bordo', ci.tag === 'circle' && near(ci.cx, 500, 0.8) && near(ci.cy, 420, 0.8) && near(ci.r, 60, 0.8), JSON.stringify(ci));
  // ORTO non vincola le coperture: con ORTO attivo un rettangolo con angoli in diagonale si crea normalmente
  await page.locator('.st-toggle').click();
  await tool(page, 'Copertura');
  await page.locator('.ctx-covers button', { hasText: 'Rettangolo' }).click();
  await tapSheet({ x: 400, y: 100 });
  await tapSheet({ x: 480, y: 160 });
  const ortho = (await covers(page)).at(-1);
  check('ORTO attivo: la copertura non e\' vincolata (rettangolo 80 x 60, non appiattito)', near(ortho.w, 80, 1) && near(ortho.h, 60, 1), JSON.stringify(ortho));
  await page.locator('.st-toggle').click();

  // --- Rette per le prove di selezione ---
  await tool(page, 'Retta');
  await tapSheet({ x: 100, y: 715 });
  await tapSheet({ x: 400, y: 715 });
  const lns = await lines(page);
  const r1 = lns[0];
  const r2 = lns[1];
  check('Due rette: R1 dentro la copertura, R2 libera', lns.length === 2 && sameNums(r2.d, 'M100 715 L400 715', 1.2), JSON.stringify(lns.map((l) => l.d)));

  // --- Seleziona ---
  await tool(page, 'Seleziona');
  check('Seleziona: testo guida', /Seleziona: tocca un oggetto/.test(await page.locator('.ctx-hint').innerText()));
  check('Nessuna selezione: proprieta\' dei nuovi oggetti con tutte le sezioni', (await inspHeadings(page)).includes('Proprietà (nuovi oggetti)') && (await visibleSections(page)).length === 4, JSON.stringify([await inspHeadings(page), await visibleSections(page)]));
  const onR2 = await toClient(page, sample, { x: 150, y: 715 });
  await page.mouse.click(onR2.x, onR2.y + 9);
  check('Tolleranza col mouse: 9 px dalla linea selezionano', (await selShapes(page)).length === 1 && (await selShapes(page))[0] === 'path' && /Selezionata: Retta/.test(await hint(page)), `${await selShapes(page)} ${await hint(page)}`);
  await page.mouse.click(onR2.x, onR2.y + 11);
  check('Tolleranza col mouse: 11 px dalla linea deselezionano (nessun oggetto a portata)', (await selShapes(page)).length === 0);
  await page.mouse.click(onR2.x, onR2.y);
  check('Tocco sulla linea: selezionata, evidenziata', (await selShapes(page)).join() === 'path' && (await inspHeadings(page)).includes('Proprietà (oggetto selezionato)'));
  check('Barra contestuale: "Selezionata: Retta"', /Selezionata: Retta/.test(await hint(page)));
  await page.screenshot({ path: join(SHOTS, 'mouse-02-selezionata.png') });

  // Primo piano: dentro la copertura R1 vince entro la tolleranza, la copertura altrove
  const onR1 = await toClient(page, sample, { x: 250, y: 500 });
  await page.mouse.click(onR1.x, onR1.y + 6);
  check('Primo piano: dentro la copertura, a 6 px dalla retta, vince la retta', (await selShapes(page)).join() === 'path' && /Selezionata: Retta/.test(await hint(page)));
  const inCover = await toClient(page, sample, { x: 320, y: 470 });
  await page.mouse.click(inCover.x, inCover.y);
  check('Primo piano: dentro la copertura lontano da tutto vince la copertura (evidenziata con cornice sottile)', (await selShapes(page)).join() === 'rect' && /Selezionata: Copertura rettangolare/.test(await hint(page)), `${await selShapes(page)} ${await hint(page)}`);
  check('Copertura selezionata: nessuna proprieta\' da cambiare', (await visibleSections(page)).length === 0 && /non hanno proprietà/.test(await page.locator('.inspector').innerText()), JSON.stringify(await visibleSections(page)));
  // Sposta la copertura (trascinando l'oggetto selezionato)
  await refreshK();
  const coverBefore = (await covers(page))[0];
  const r1Before = (await lines(page))[0].d;
  let midChecked = false;
  await dragClient(inCover, { x: inCover.x + 60, y: inCover.y - 30 }, 8, async () => {
    const live = (await covers(page))[0];
    const selT = await page.$eval('.sc-sel', (e) => e.getAttribute('transform'));
    midChecked = /translate/.test(live.transform ?? '') && /translate/.test(selT ?? '');
  });
  const coverAfter = (await covers(page))[0];
  check('Durante il trascinamento l\'oggetto e il suo contorno seguono il puntatore', midChecked);
  check('Trascinare la copertura selezionata la sposta dello stesso spostamento (60 px, -30 px)', near(coverAfter.x - coverBefore.x, 60 / k, 0.05) && near(coverAfter.y - coverBefore.y, -30 / k, 0.05) && near(coverAfter.w, coverBefore.w, 1e-9), JSON.stringify({ coverBefore, coverAfter, k }));
  check('La retta sotto non si e\' mossa; il contorno segue la copertura', (await lines(page))[0].d === r1Before && (await selShapes(page)).join() === 'rect');
  check('Un trascinamento = un solo comando: "Annulla Sposta copertura"', (await undoTitle(page)) === 'Annulla Sposta copertura', await undoTitle(page));
  await undoClick(page);
  const coverUndone = (await covers(page))[0];
  check('Annulla: la copertura torna esattamente dov\'era', coverUndone.x === coverBefore.x && coverUndone.y === coverBefore.y && (await undoTitle(page)) !== 'Annulla Sposta copertura');
  await redoClick(page);
  check('Ripeti: la copertura e\' di nuovo spostata', near((await covers(page))[0].x, coverAfter.x, 1e-9));
  await undoClick(page);

  // Trascinare la retta selezionata
  await page.mouse.click(onR2.x, onR2.y);
  await refreshK();
  const r2Before = (await lines(page))[1].d;
  const startR2 = await toClient(page, sample, { x: 250, y: 715 });
  await dragClient(startR2, { x: startR2.x + 40, y: startR2.y + 20 }, 6);
  const r2After = (await lines(page))[1].d;
  check('R2 trascinata di (40, 20) px: tutti i punti traslano di (40/zoom, 20/zoom) pt', shifted(r2Before, r2After, 40 / k, 20 / k, 0.03), `${r2Before} -> ${r2After}`);
  check('Annulla un solo comando: "Sposta retta"', (await undoTitle(page)) === 'Annulla Sposta retta');
  await undoClick(page);
  check('Annulla: R2 torna esatta', (await lines(page))[1].d === r2Before);
  // trascinare altrove sposta la vista
  await page.mouse.click(onR2.x, onR2.y);
  const stageBefore = await page.$eval('.viewer-stage', (e) => e.style.transform);
  const histBefore = await undoTitle(page);
  const vbox = await page.locator('.viewer').boundingBox();
  const empty = { x: vbox.x + vbox.width - 40, y: vbox.y + 80 }; // zona grigia a destra del foglio, senza oggetti
  await dragClient(empty, { x: empty.x - 50, y: empty.y + 30 }, 6);
  const stageAfter = await page.$eval('.viewer-stage', (e) => e.style.transform);
  check('Trascinare altrove (fuori dall\'oggetto selezionato) sposta la vista', stageBefore !== stageAfter, JSON.stringify({ stageBefore, stageAfter, empty, sel: await selShapes(page), hint: await page.locator('.ctx-hint').innerText() }));
  check('...senza spostare oggetti, senza nuovi comandi e senza perdere la selezione', (await lines(page))[1].d === r2Before && (await undoTitle(page)) === histBefore && (await selShapes(page)).join() === 'path', `${histBefore} / ${await undoTitle(page)}`);
  const onR1b = await toClient(page, sample, { x: 120, y: 500 });
  const d0 = (await lines(page))[0].d;
  const st0 = await page.$eval('.viewer-stage', (e) => e.style.transform);
  await dragClient(onR1b, { x: onR1b.x + 25, y: onR1b.y + 25 }, 5);
  check('...come richiesto: R1 non selezionata, il trascinamento muove la vista e non R1', (await lines(page))[0].d === d0 && (await page.$eval('.viewer-stage', (e) => e.style.transform)) !== st0);

  // Proprieta' della retta selezionata: ogni modifica e' un comando, i nuovi oggetti non cambiano
  const pr2 = await toClient(page, sample, { x: 150, y: 715 });
  await page.mouse.click(pr2.x, pr2.y);
  const secs = await visibleSections(page);
  check('Retta selezionata: sezioni Tipo di linea, Colore, Spessore', secs.join() === 'Tipo di linea,Colore,Spessore', secs.join());
  const insp = page.locator('.inspector');
  await insp.getByRole('button', { name: 'Tratteggiata' }).click();
  await insp.locator('button[aria-label^="Blu"]').click();
  await insp.locator('.presets[aria-label^="Spessori"] .preset', { hasText: /^3$/ }).click();
  let l2 = (await lines(page))[1];
  check('Tipo, colore e spessore della retta selezionata cambiano subito', l2.dash !== null && l2.stroke === '#1565C0' && near(l2.w, 3, 0.001), JSON.stringify(l2));
  check('Ogni modifica e\' un comando annullabile', (await undoTitle(page)) === 'Annulla Proprietà oggetto');
  await undoClick(page);
  l2 = (await lines(page))[1];
  check('Annulla: torna lo spessore precedente, restano blu e tratteggio', l2.stroke === '#1565C0' && l2.dash !== null && !near(l2.w, 3, 0.001), JSON.stringify(l2));
  await redoClick(page);
  // Proprieta' di un testo
  const t1c = await toClient(page, sample, { x: 70, y: 197 });
  await page.mouse.click(t1c.x, t1c.y);
  check('Testo selezionato: sezioni Colore e Altezza testo', (await visibleSections(page)).join() === 'Colore,Altezza testo', (await visibleSections(page)).join());
  await insp.locator('.presets[aria-label^="Altezza"] .preset', { hasText: /^14$/ }).click();
  const anT = await annots(page);
  check('Altezza 14 sul testo selezionato; l\'altro testo no', anT.find((a) => a.id === t1Id).size === 14 && anT.find((a) => a.text === 'ABC').size === 10, JSON.stringify(anT.map((a) => [a.text, a.size])));
  // Sposta il testo
  await refreshK();
  const tBefore = (await annots(page)).find((a) => a.id === t1Id);
  const t1c2 = await toClient(page, sample, { x: 75, y: 197 });
  await dragClient(t1c2, { x: t1c2.x + 35, y: t1c2.y - 18 }, 5);
  const tAfter = (await annots(page)).find((a) => a.id === t1Id);
  check('Testo trascinato: l\'origine si sposta di (35/zoom, -18/zoom) pt', near(tAfter.tx - tBefore.tx, 35 / k, 0.05) && near(tAfter.ty - tBefore.ty, -18 / k, 0.05) && tAfter.text === 'FORO', JSON.stringify({ tBefore, tAfter }));
  // Quota: proprieta' e spostamento
  const dimLine = await toClient(page, sample, { x: 200, y: 250 });
  await page.mouse.click(dimLine.x, dimLine.y);
  check('Quota selezionata: sezioni Colore, Spessore, Altezza testo', (await visibleSections(page)).join() === 'Colore,Spessore,Altezza testo', (await visibleSections(page)).join());
  await insp.locator('.presets[aria-label^="Spessori"] .preset', { hasText: /^2$/ }).click();
  let dimA = (await annots(page)).find((a) => a.id === dimId);
  check('Spessore 2 sulla quota selezionata (linea di quota)', near(dimA.paths[0].w, 2, 0.001), JSON.stringify(dimA.paths));
  await refreshK();
  const dBefore = (await annots(page)).find((a) => a.id === dimId);
  const dimLine2 = await toClient(page, sample, { x: 210, y: 250 });
  await dragClient(dimLine2, { x: dimLine2.x + 30, y: dimLine2.y + 25 }, 6);
  const dAfter = (await annots(page)).find((a) => a.id === dimId);
  const dx = 30 / k;
  const dy = 25 / k;
  check('Quota trascinata: TUTTE le primitive (linee, estensioni, frecce, badge, testo) traslano dello stesso spostamento', dBefore.paths.length === dAfter.paths.length && dBefore.paths.every((p, i) => shifted(p.d, dAfter.paths[i].d, dx, dy)) && dBefore.arrows.every((a, i) => shifted(a, dAfter.arrows[i], dx, dy)) && near(dAfter.rect.x - dBefore.rect.x, dx, 0.03) && near(dAfter.rect.y - dBefore.rect.y, dy, 0.03) && near(dAfter.tx - dBefore.tx, dx, 0.03) && near(dAfter.ty - dBefore.ty, dy, 0.03), JSON.stringify({ dBefore, dAfter }));
  check('Il valore automatico non cambia: l\'etichetta e\' identica', dAfter.text === dBefore.text && dBefore.text === autoLabel, `${dBefore.text} -> ${dAfter.text} (tastierino: ${autoLabel})`);
  await undoClick(page);
  check('Annulla lo spostamento della quota: tutto com\'era (un solo comando)', JSON.stringify((await annots(page)).find((a) => a.id === dimId).paths) === JSON.stringify(dBefore.paths));
  await redoClick(page);

  // Proprieta' di sessione intatte: una nuova retta ha ancora le proprieta' predefinite
  await tool(page, 'Retta');
  await tapSheet({ x: 60, y: 640 });
  await tapSheet({ x: 160, y: 640 });
  const newest = (await lines(page)).at(-1);
  check('Cambiare le proprieta\' di un oggetto selezionato non cambia quelle dei NUOVI oggetti (rosso, continua)', newest.stroke === '#D32F2F' && newest.dash === null, JSON.stringify(newest));

  // Esc, annulla della creazione dell'oggetto selezionato
  await tool(page, 'Seleziona');
  const nc = await toClient(page, sample, { x: 110, y: 640 });
  await page.mouse.click(nc.x, nc.y);
  check('Nuova retta selezionata', (await selShapes(page)).length === 1);
  await page.keyboard.press('Escape');
  check('Esc deseleziona', (await selShapes(page)).length === 0 && (await inspHeadings(page)).includes('Proprietà (nuovi oggetti)'));
  await page.mouse.click(nc.x, nc.y);
  const nLines = (await lines(page)).length;
  // l'ultimo comando e' lo spostamento della quota: annullo finche' la retta sparisce
  const hist = [];
  for (let i = 0; i < 12 && (await lines(page)).length === nLines; i++) {
    hist.push(await undoTitle(page));
    await undoClick(page);
  }
  check('Annullando la creazione dell\'oggetto selezionato la selezione sparisce', (await lines(page)).length === nLines - 1 && (await selShapes(page)).length === 0 && (await inspHeadings(page)).includes('Proprietà (nuovi oggetti)'), hist.join(' > '));

  // --- Cancella con le coperture ---
  await tool(page, 'Cancella');
  const cc = await toClient(page, sample, { x: 530, y: 420 }); // dentro il cerchio (centro 500,420 r 60), lontano da altro
  await page.mouse.move(cc.x, cc.y);
  check('Cancella: il cerchio sotto il puntatore e\' evidenziato', (await page.locator('.sc-hl circle').count()) === 1);
  const nCov = (await covers(page)).length;
  await page.mouse.down();
  await page.mouse.up();
  check('Cancella: la copertura circolare e\' cancellata', (await covers(page)).length === nCov - 1 && /Copertura cancellata/.test(await status(page)), await status(page));
  await undoClick(page);
  check('Annulla: la copertura torna', (await covers(page)).length === nCov);
  // dentro la copertura rettangolare, a 6 px dalla retta R1: Cancella cancella la retta (primo piano), non la copertura
  const nL = (await lines(page)).length;
  const onR1c = await toClient(page, sample, { x: 250, y: 500 });
  await page.mouse.click(onR1c.x, onR1c.y + 6);
  check('Cancella: dentro la copertura vicino a una linea vince la linea (primo piano)', (await lines(page)).length === nL - 1 && (await covers(page)).length === nCov);
  await undoClick(page);

  check('Nessun errore in console (mouse)', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: join(SHOTS, 'mouse-03-finale.png') });
  await ctx.close();
}

// =====================================================================
async function rotateAndPagesSuite(browser, decoder) {
  section = 'rotate e pagine';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const sample = SAMPLES['A4 con /Rotate 90'];
  await openSample(page, 'A4 con /Rotate 90');
  const tapSheet = async (p) => {
    const c = await toClient(page, sample, p);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
  };
  await tool(page, 'Copertura');
  await page.locator('.ctx-covers button', { hasText: 'Rettangolo' }).click();
  await tapSheet({ x: 100, y: 100 });
  await tapSheet({ x: 300, y: 200 });
  let cv = (await covers(page))[0];
  check('Pagina /Rotate 90: il rettangolo e\' come lo vedo (stessi angoli sul foglio)', cv && near(cv.x, 100, 0.8) && near(cv.y, 100, 0.8) && near(cv.w, 200, 1) && near(cv.h, 100, 1), JSON.stringify(cv));
  // quadrato e cerchio
  await page.locator('.ctx-covers button', { hasText: 'Quadrato' }).click();
  await tapSheet({ x: 400, y: 300 });
  await tapSheet({ x: 460, y: 340 });
  cv = (await covers(page)).at(-1);
  check('Pagina /Rotate 90: il quadrato e\' un quadrato sul foglio mostrato', near(cv.w, 60, 1) && near(cv.h, 60, 1), JSON.stringify(cv));
  // sposta con Seleziona: lo spostamento e' quello che si vede
  await tool(page, 'Seleziona');
  const k = await scaleK(page, sample);
  const start = await toClient(page, sample, { x: 200, y: 150 });
  await page.mouse.click(start.x, start.y);
  const before = (await covers(page))[0];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 45, { steps: 6 });
  await page.mouse.up();
  const after = (await covers(page))[0];
  check('Pagina /Rotate 90: trascinando a destra e in basso (70, 45) px la copertura va a destra e in basso di (70/zoom, 45/zoom) pt sul foglio', near(after.x - before.x, 70 / k, 0.05) && near(after.y - before.y, 45 / k, 0.05), JSON.stringify({ before, after, k }));
  await undoClick(page);
  check('Annulla: torna al punto di prima', (await covers(page))[0].x === before.x && (await covers(page))[0].y === before.y);
  check('Nessun errore in console (rotate)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // Piu' pagine: la selezione non resta tra le pagine
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  const sample1 = { sheet: { w: A4.w, h: A4.h } };
  await openSample(p2, '3 pagine miste');
  const tap = async (p) => {
    const c = await toClient(p2, sample1, p);
    await p2.mouse.move(c.x, c.y);
    await p2.mouse.down();
    await p2.mouse.up();
  };
  await tool(p2, 'Retta');
  await tap({ x: 100, y: 300 });
  await tap({ x: 300, y: 300 });
  await tool(p2, 'Seleziona');
  const lc = await toClient(p2, sample1, { x: 200, y: 300 });
  await p2.mouse.click(lc.x, lc.y);
  check('3 pagine: retta selezionata a pagina 1', (await selShapes(p2)).length === 1);
  await p2.getByRole('button', { name: 'Pagina successiva' }).click();
  await p2.waitForTimeout(500);
  check('Cambio pagina: la selezione e\' scartata', (await selShapes(p2)).length === 0 && (await inspHeadings(p2)).includes('Proprietà (nuovi oggetti)'));
  await p2.getByRole('button', { name: 'Pagina precedente' }).click();
  await p2.waitForTimeout(500);
  check('Tornando a pagina 1: la retta c\'e\' ancora, non selezionata', (await lines(p2)).length === 1 && (await selShapes(p2)).length === 0);
  await ctx2.close();
}

// =====================================================================
async function touchSuite(browser, decoder) {
  section = 'iPhone 390x780';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  /** Tocco con mira (lente) e rilascio nel punto del foglio; `inspect` gira PRIMA del rilascio. */
  const tapSheet = async (p, { via, inspect } = {}) => {
    const c = await toClient(page, sample, p);
    await touch('touchStart', [c]);
    if (via) {
      await touch('touchMove', [{ x: c.x + via.x, y: c.y + via.y }]);
      await touch('touchMove', [c]);
    }
    await page.waitForTimeout(80); // gli eventi arrivano alla pagina in modo asincrono
    const lens = await page.locator('.lens:not([hidden])').count();
    const got = inspect ? await inspect() : undefined;
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
    return { lens, got };
  };
  const tapClient = async (c) => {
    await touch('touchStart', [c]);
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
  };
  const dragTouch = async (from, to, steps = 6, mid) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    if (mid) await mid();
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
  };
  const boxes = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));

  // --- Palette con 9 voci e colonna di pulsanti sul foglio (misure per la proposta) ---
  const pal = await page.evaluate(() => {
    const p = document.querySelector('.palette');
    const items = [...p.querySelectorAll('.tool')].filter((e) => e.offsetParent !== null).map((e) => {
      const r = e.getBoundingClientRect();
      return { t: e.getAttribute('title'), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { client: p.clientWidth, scroll: p.scrollWidth, items };
  });
  const fullyVisible = pal.items.filter((i) => i.l >= 0 && i.r <= pal.client).map((i) => i.t);
  info(`palette: ${pal.items.length} voci visibili, larghezza della riga ${pal.client} px, contenuto ${pal.scroll} px, voci intere senza scorrere: ${fullyVisible.length} (${fullyVisible.join(', ')}); ogni voce ${pal.items[0].w}x${pal.items[0].h} px`);
  check('Palette: 9 voci visibili, scorre in orizzontale (contenuto piu\' largo della riga)', pal.items.length === 9 && pal.scroll > pal.client, JSON.stringify(pal));
  check('Palette: ogni voce >= 44 px di altezza e Seleziona e\' tra le prime visibili senza scorrere', pal.items.every((i) => i.h >= 43.5) && fullyVisible.includes('Seleziona'), JSON.stringify(pal.items));
  const fz = await page.evaluate(() => {
    const f = document.querySelector('.float-zoom').getBoundingClientRect();
    const c = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
    const ox = Math.max(0, Math.min(f.right, c.right) - Math.max(f.left, c.left));
    const oy = Math.max(0, Math.min(f.bottom, c.bottom) - Math.max(f.top, c.top));
    return { col: { l: Math.round(f.left), t: Math.round(f.top), w: Math.round(f.width), h: Math.round(f.height) }, page: { l: Math.round(c.left), t: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) }, overlap: { w: Math.round(ox), h: Math.round(oy) } };
  });
  info(`colonna sul foglio (a pagina intera): ${JSON.stringify(fz.col)}; pagina ${JSON.stringify(fz.page)}; sovrapposizione ${fz.overlap.w}x${fz.overlap.h} px = ${((fz.overlap.w * 100) / fz.page.w).toFixed(0)}% della larghezza, ${((fz.overlap.h * 100) / fz.page.h).toFixed(0)}% dell'altezza della pagina`);

  // --- Rette di prova (con la lente) ---
  await tool(page, 'Retta');
  await tapSheet({ x: 100, y: 500 }, { via: { x: 10, y: 14 } });
  await tapSheet({ x: 400, y: 500 }, { via: { x: -10, y: 14 } });
  await tapSheet({ x: 100, y: 200 }, { via: { x: 10, y: 14 } });
  await tapSheet({ x: 400, y: 200 }, { via: { x: -10, y: 14 } });
  check('Due rette con il dito', (await lines(page)).length === 2);

  // --- Copertura con il dito ---
  await tool(page, 'Copertura');
  const types = await boxes('.ctx-covers button');
  check('Copertura: tre forme, ognuna >= 44 px di altezza e dentro i 390 px', types.length === 3 && types.every((b) => b.h >= 43.5 && b.l >= -0.5 && b.r <= 390.5), JSON.stringify(types));
  await page.locator('.ctx-covers button', { hasText: 'Rettangolo' }).click();
  const a1 = await tapSheet({ x: 150, y: 300 }, { via: { x: 12, y: 20 } });
  const a2 = await tapSheet({ x: 350, y: 420 }, { via: { x: -12, y: 20 }, inspect: async () => outlineShapes(page) });
  check('Rettangolo con il dito: lente per entrambi i punti', a1.lens === 1 && a2.lens === 1);
  check('...e durante la mira il contorno sottile mostra il rettangolo', a2.got.length === 1 && near(a2.got[0].w, 200, 1.2) && near(a2.got[0].h, 120, 1.2), JSON.stringify(a2.got));
  const cvT = (await covers(page))[0];
  check('Rettangolo creato dove puntava il mirino', near(cvT.x, 150, 1) && near(cvT.y, 300, 1) && near(cvT.w, 200, 1.5) && near(cvT.h, 120, 1.5), JSON.stringify(cvT));
  await page.locator('.ctx-covers button', { hasText: 'Quadrato' }).click();
  await tapSheet({ x: 60, y: 600 }, { via: { x: 12, y: 20 } });
  const sqT = await tapSheet({ x: 140, y: 630 }, { via: { x: -12, y: 20 }, inspect: async () => outlineShapes(page) });
  check('Quadrato con il dito: durante la mira il contorno e\' un quadrato di lato 80', sqT.got.length === 1 && near(sqT.got[0].w, 80, 1.2) && near(sqT.got[0].h, 80, 1.2), JSON.stringify(sqT.got));
  await page.locator('.ctx-covers button', { hasText: 'Cerchio' }).click();
  // (a destra della pagina la colonna dei pulsanti sul foglio intercetta i tocchi: il cerchio sta a sinistra)
  await tapSheet({ x: 300, y: 650 }, { via: { x: 12, y: 20 } });
  await tapSheet({ x: 350, y: 650 }, { via: { x: -12, y: 20 } });
  const cT = (await covers(page)).at(-1);
  check('Cerchio con il dito', cT.tag === 'circle' && near(cT.r, 50, 1.2), JSON.stringify({ cT, status: await status(page), hint: await hint(page), markers: await page.locator('.pt-mark').count(), n: (await covers(page)).length }));
  await page.screenshot({ path: join(SHOTS, 'iphone-01-coperture.png') });

  // --- Seleziona con il dito ---
  await tool(page, 'Seleziona');
  check('Seleziona: nessuna selezione, il riquadro delle proprieta\' non si vede (ma tiene il suo posto)', (await page.locator('.ctx-style').isHidden()) || (await page.$eval('.ctx-style', (e) => getComputedStyle(e).visibility)) === 'hidden');
  const viewerBox = () => page.locator('.viewer').boundingBox();
  const vbox0 = await viewerBox();
  const onL = await toClient(page, sample, { x: 250, y: 200 }); // retta in alto, libera
  await tapClient({ x: onL.x, y: onL.y + 21 });
  const vbox1 = await viewerBox();
  check('Selezionare un oggetto NON cambia le dimensioni del foglio (la barra non cambia altezza)', near(vbox0.height, vbox1.height, 0.5) && near(vbox0.width, vbox1.width, 0.5), JSON.stringify({ vbox0, vbox1 }));
  check('Tolleranza col dito: 21 px dalla linea selezionano', (await selShapes(page)).join() === 'path');
  await tapClient({ x: onL.x, y: onL.y + 23 });
  const vbox2 = await viewerBox();
  check('Deselezionare non cambia le dimensioni del foglio', near(vbox0.height, vbox2.height, 0.5));
  check('Tolleranza col dito: 23 px dalla linea deselezionano', (await selShapes(page)).length === 0);
  await tapClient(onL);
  check('Tocco sulla linea: selezionata', (await selShapes(page)).join() === 'path' && (await lines(page)).length === 2);
  await page.screenshot({ path: join(SHOTS, 'iphone-02-selezionata.png') });
  // proprieta' dal riquadro
  check('Linea selezionata: compare il riquadro delle proprieta\' (linea in miniatura + spessore)', await page.locator('.ctx-style').isVisible());
  await page.locator('.ctx-style').click();
  check('Pannello: sezioni Tipo di linea, Colore, Spessore', (await visibleSections(page, '.props-pop')).join() === 'Tipo di linea,Colore,Spessore');
  const swBox = await boxes('.props-pop .swatch');
  check('Pannello: i campioni di colore sono >= 44 px', swBox.length === 8 && swBox.every((b) => b.w >= 43.5 && b.h >= 43.5), JSON.stringify(swBox.slice(0, 2)));
  await page.locator('.props-pop button[aria-label^="Blu"]').click();
  const lb = (await lines(page)).find((l) => l.stroke === '#1565C0');
  check('Colore blu sulla linea selezionata dal pannello su iPhone', lb !== undefined && (await lines(page)).filter((l) => l.stroke === '#D32F2F').length === 1);
  await page.locator('.ctx-style').click(); // chiude
  // trascinamento col dito
  const k = await scaleK(page, sample);
  const lBefore = (await lines(page)).find((l) => l.stroke === '#1565C0');
  const hBefore = await undoTitle(page);
  let midT = false;
  await dragTouch(onL, { x: onL.x + 36, y: onL.y + 24 }, 6, async () => {
    const live = (await lines(page)).find((l) => l.stroke === '#1565C0');
    midT = /translate/.test(live.transform ?? '');
  });
  const lAfter = (await lines(page)).find((l) => l.stroke === '#1565C0');
  check('Durante il trascinamento col dito la linea segue il dito', midT);
  check('Linea trascinata col dito di (36, 24) px: i punti traslano di (36/zoom, 24/zoom) pt', shifted(lBefore.d, lAfter.d, 36 / k, 24 / k, 0.05), `${lBefore.d} -> ${lAfter.d}`);
  check('Un solo comando "Sposta retta"', (await undoTitle(page)) === 'Annulla Sposta retta' && hBefore !== (await undoTitle(page)));
  // trascinare altrove = muovere la vista
  const stage0 = await page.$eval('.viewer-stage', (e) => e.style.transform);
  const far = await toClient(page, sample, { x: 520, y: 80 });
  const histT = await undoTitle(page);
  await dragTouch(far, { x: far.x - 40, y: far.y + 30 });
  check('Trascinare altrove con un dito sposta la vista, senza comandi e senza perdere la selezione', (await page.$eval('.viewer-stage', (e) => e.style.transform)) !== stage0 && (await undoTitle(page)) === histT && (await selShapes(page)).length === 1);
  // un secondo dito durante il trascinamento annulla lo spostamento
  const cur = (await lines(page)).find((l) => l.stroke === '#1565C0');
  const selPos = await page.evaluate((id) => {
    const el = document.querySelector(`.sc-objects > path[data-id="${id}"]`).getBoundingClientRect();
    return { x: el.left + el.width / 2, y: el.top + el.height / 2 };
  }, cur.id);
  await touch('touchStart', [selPos]);
  await touch('touchMove', [{ x: selPos.x + 30, y: selPos.y + 20 }]);
  const moving = /translate/.test((await lines(page)).find((l) => l.id === cur.id).transform ?? '');
  await touch('touchStart', [{ x: selPos.x + 30, y: selPos.y + 20 }, { x: selPos.x + 120, y: selPos.y + 90 }]);
  await touch('touchMove', [{ x: selPos.x + 30, y: selPos.y + 20 }, { x: selPos.x + 150, y: selPos.y + 120 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(80);
  const cancelled = (await lines(page)).find((l) => l.id === cur.id);
  check('Un secondo dito durante il trascinamento: la linea torna a posto e non si crea nessun comando (si passa al pinch)', moving && cancelled.transform === null && cancelled.d === cur.d && (await undoTitle(page)) === histT, JSON.stringify({ moving, cancelled, cur }));
  // pinch con un oggetto selezionato
  const z0 = await scaleK(page, sample);
  const mid = { x: 195, y: 330 };
  await touch('touchStart', [{ x: mid.x - 30, y: mid.y }, { x: mid.x + 30, y: mid.y }]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: mid.x - 30 - i * 10, y: mid.y }, { x: mid.x + 30 + i * 10, y: mid.y }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  check('Pinch con un oggetto selezionato: zoom cambiato, oggetto invariato e ancora selezionato', (await scaleK(page, sample)) > z0 * 1.2 && (await lines(page)).find((l) => l.id === cur.id).d === cur.d && (await selShapes(page)).length === 1);
  await page.locator('.float-zoom button[aria-label="Adatta alla pagina"]').click();
  await page.waitForTimeout(250);

  // --- Seleziona una copertura col dito e spostala ---
  const inRect = await toClient(page, sample, { x: 250, y: 330 });
  await tapClient(inRect);
  check('Tocco dentro la copertura rettangolare: selezionata (cornice sottile)', (await selShapes(page)).join() === 'rect' && /Selezionata: Copertura rettangolare/.test(await hint(page)), `${await selShapes(page)} ${await hint(page)}`);
  check('Copertura selezionata: nessun riquadro delle proprieta\'', await page.locator('.ctx-style').isHidden());
  const kk = await scaleK(page, sample);
  const cb = (await covers(page))[0];
  await dragTouch(inRect, { x: inRect.x + 30, y: inRect.y + 45 });
  const ca = (await covers(page))[0];
  check('Copertura trascinata col dito di (30, 45) px', near(ca.x - cb.x, 30 / kk, 0.06) && near(ca.y - cb.y, 45 / kk, 0.06), JSON.stringify({ cb, ca }));
  check('Un solo comando "Sposta copertura"', (await undoTitle(page)) === 'Annulla Sposta copertura', await undoTitle(page));
  await page.screenshot({ path: join(SHOTS, 'iphone-03-copertura-spostata.png') });
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  check('Nessuno scorrimento della pagina', ov.sw <= ov.iw && ov.sh <= ov.ih, JSON.stringify(ov));

  // --- A+ al massimo ---
  for (let i = 0; i < 3; i++) await page.locator('.size-btn').nth(1).click();
  await tool(page, 'Copertura');
  const t5 = await boxes('.ctx-covers button');
  check('A+ al massimo: le tre forme restano intere nei 390 px', t5.length === 3 && t5.every((b) => b.l >= -0.5 && b.r <= 390.5 && b.h >= 43.5), JSON.stringify(t5));
  await page.screenshot({ path: join(SHOTS, 'iphone-04-A-piu-max.png') });
  check('Nessun errore in console (iPhone)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function landscapeSuite(browser) {
  section = 'iPhone 844x390';
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  const tap = async (p) => {
    const c = await toClient(page, sample, p);
    await touch('touchStart', [c]);
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
  };
  await tool(page, 'Copertura');
  const ctxBox = await page.locator('.ctxbar').boundingBox();
  check('Orizzontale: barra della Copertura dentro la larghezza', ctxBox && ctxBox.x >= 0 && ctxBox.x + ctxBox.width <= 844.5, JSON.stringify(ctxBox));
  const vb = await page.locator('.viewer').boundingBox();
  info(`foglio ${vb.width.toFixed(0)}x${vb.height.toFixed(0)} px con la barra contestuale della Copertura`);
  check('Orizzontale: il foglio ha almeno 150 px di altezza con lo strumento Copertura', vb.height >= 150, String(vb.height));
  await tap({ x: 200, y: 250 });
  await tap({ x: 400, y: 350 });
  check('Orizzontale: copertura creata con il dito', (await covers(page)).length === 1);
  await tool(page, 'Seleziona');
  await tap({ x: 300, y: 300 });
  check('Orizzontale: copertura selezionata', (await selShapes(page)).join() === 'rect');
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  check('Orizzontale: nessuno scorrimento della pagina', ov.sw <= ov.iw && ov.sh <= ov.ih, JSON.stringify(ov));
  await page.screenshot({ path: join(SHOTS, 'landscape-01.png') });
  check('Nessun errore in console (orizzontale)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}


// =====================================================================
// Palette che scorre fino allo strumento attivo (anche scelto dal menu) e colonna sul foglio con Distanza solo icona.
async function paletteAndColumnSuite(browser) {
  for (const [w, h] of [[390, 780], [780, 390]]) {
    section = `palette e colonna ${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const sample = SAMPLES['A4 vettoriale'];
    await openSample(page, 'A4 vettoriale');
    const menu = async (top, item) => {
      await page.getByRole('button', { name: top, exact: true }).click();
      await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
      await page.waitForTimeout(150);
    };
    const active = () =>
      page.evaluate(() => {
        const pal = document.querySelector('.palette');
        const p = pal.getBoundingClientRect();
        const b = document.querySelector('.tool[aria-pressed="true"]');
        const r = b.getBoundingClientRect();
        return {
          title: b.title,
          ok: r.width > 0 && r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5,
          btn: [r.left, r.right, r.top, r.bottom].map(Math.round),
          bar: [p.left, p.right, p.top, p.bottom].map(Math.round),
          sl: Math.round(pal.scrollLeft),
          st: Math.round(pal.scrollTop),
          overflowX: pal.scrollWidth > pal.clientWidth,
          overflowY: pal.scrollHeight > pal.clientHeight,
        };
      });
    const narrow = w < 720;
    const first = await active();
    info(`palette ${narrow ? 'orizzontale' : 'verticale'}: scorre ${narrow ? first.overflowX : first.overflowY}, barra ${JSON.stringify(first.bar)}`);
    check('Palette: all\'inizio Sposta vista e\' attivo e tutto in vista', first.title === 'Sposta vista' && first.ok, JSON.stringify(first));
    check('Palette: la barra scorre (non entrano tutte le voci)', narrow ? first.overflowX : first.overflowY);

    // Con l'iPhone in orizzontale (altezza 390) le voci in fondo al menu Inserisci stanno sotto il bordo: il menu scorre (CP4.6).
    // Il pulsante attivato dal codice della pagina (`jsTool`) prova lo scorrimento della palette senza che il browser lo porti in vista da solo.
    await page.getByRole('button', { name: 'Inserisci', exact: true }).click();
    const offscreen = await page.evaluate(() => [...document.querySelectorAll('.menu-panel .menu-item')].filter((e) => e.getBoundingClientRect().bottom > innerHeight).map((e) => e.textContent.trim()));
    await page.keyboard.press('Escape');
    info(`menu Inserisci: voci sotto il bordo dello schermo (si raggiungono scorrendo il menu): ${offscreen.length ? offscreen.join(', ') : 'nessuna'}`);
    const jsTool = async (title) => {
      await page.evaluate((t) => document.querySelector(`.palette .tool[title="${t}"]`).click(), title);
      await page.waitForTimeout(150);
    };
    const seq = narrow
      ? [
          ['menu', 'Inserisci', 'Copertura rettangolare', 'Copertura'],
          ['menu', 'Modifica', 'Seleziona / sposta', 'Seleziona'],
          ['menu', 'Inserisci', 'Testo', 'Testo'],
          ['menu', 'Inserisci', 'Quota allineata', 'Quota'],
          ['menu', 'Modifica', 'Cancella', 'Cancella'],
          ['menu', 'Inserisci', 'Retta', 'Retta'],
          ['menu', 'Inserisci', 'Linea', 'Linea'],
          ['menu', 'Inserisci', 'Copertura circolare', 'Copertura'],
        ]
      : [
          ['menu', 'Inserisci', 'Copertura rettangolare', 'Copertura'],
          ['menu', 'Modifica', 'Seleziona / sposta', 'Seleziona'],
          ['menu', 'Inserisci', 'Testo', 'Testo'],
          ['menu', 'Inserisci', 'Quota allineata', 'Quota'],
          ['menu', 'Modifica', 'Cancella', 'Cancella'],
          ['menu', 'Inserisci', 'Retta', 'Retta'],
          ['menu', 'Inserisci', 'Linea', 'Linea'],
          ['js', '', 'Copertura', 'Copertura'],
        ];
    let prev = first;
    for (const [via, top, item, title] of seq) {
      if (via === 'menu') await menu(top, item);
      else await jsTool(title);
      const a = await active();
      check(`${via === 'menu' ? `Dal menu ${top} > ${item}` : `Attivando ${title} senza che la barra sia gia' scorsa`}: ${title} e' attivo e il suo pulsante e' TUTTO in vista`, a.title === title && a.ok, JSON.stringify(a));
      prev = a;
    }
    // la barra torna indietro quando lo strumento e' all'inizio
    await menu('Modifica', 'Seleziona / sposta');
    const back = await active();
    const moved = narrow ? back.sl < prev.sl : back.st < prev.st;
    check('Tornando a una voce vicina all\'inizio la barra scorre indietro', back.ok && moved, JSON.stringify({ prev, back }));
    // Scala dal pulsante SCALA della barra di stato (non dal menu)
    await page.locator('.st-scale-btn').click();
    await page.waitForTimeout(150);
    const sc = await active();
    check('Dal pulsante SCALA della barra di stato: Scala attivo e tutto in vista', sc.title === 'Scala' && sc.ok, JSON.stringify(sc));
    // cambiare strumento dalla palette resta tutto in vista (un pulsante tagliato si porta in vista)
    await page.locator('button.tool[title="Sposta vista"]').click();
    const pan = await active();
    check('Sposta vista dalla palette: attivo e tutto in vista', pan.title === 'Sposta vista' && pan.ok, JSON.stringify(pan));
    // Distanza dalla colonna sul foglio: su schermo stretto non c'e' in palette, nessun errore e la palette non si muove
    const before = await active();
    await page.locator('.float-zoom .float-dist').click();
    await page.waitForTimeout(150);
    const afterDist = await active();
    if (narrow) check('Distanza dalla colonna (su schermo stretto non e\' in palette): la palette non si sposta e nessun errore', afterDist.sl === before.sl && afterDist.title === 'Distanza' && afterDist.btn.every((v) => v === 0) && errors.length === 0, JSON.stringify({ before, afterDist }));
    else check('Distanza: attiva e tutta in vista nella palette', afterDist.title === 'Distanza' && afterDist.ok, JSON.stringify(afterDist));
    await page.locator('button.tool[title="Sposta vista"]').click();

    // --- Colonna sul foglio ---
    const col = await page.evaluate(() => {
      const f = document.querySelector('.float-zoom');
      const fr = f.getBoundingClientRect();
      const btns = [...f.querySelectorAll('.btn')].map((e) => {
        const r = e.getBoundingClientRect();
        return { n: e.getAttribute('aria-label'), w: +r.width.toFixed(1), h: +r.height.toFixed(1), text: e.innerText.trim(), title: e.title };
      });
      const c = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
      const v = document.querySelector('.viewer').getBoundingClientRect();
      return { w: +fr.width.toFixed(1), h: +fr.height.toFixed(1), l: Math.round(fr.left), t: Math.round(fr.top), btns, page: { l: Math.round(c.left), t: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) }, viewer: { l: Math.round(v.left), t: Math.round(v.top), r: Math.round(v.right), b: Math.round(v.bottom) } };
    });
    const dist = col.btns.find((b) => b.n === 'Distanza');
    check('Colonna: Distanza e\' solo icona (nessun testo visibile) ma ha nome accessibile e titolo', dist && dist.text === '' && /^Distanza/.test(dist.title), JSON.stringify(dist));
    check('Colonna: tutti i pulsanti >= 44 x 44 px', col.btns.length === 4 && col.btns.every((b) => b.w >= 43.5 && b.h >= 43.5), JSON.stringify(col.btns));
    check('Colonna: i quattro pulsanti hanno la stessa larghezza (46 px)', col.btns.every((b) => Math.abs(b.w - col.btns[0].w) < 0.6) && col.btns[0].w <= 48, JSON.stringify(col.btns.map((b) => b.w)));
    check(narrow ? 'Colonna in verticale: larga come un pulsante (<= 48 px) e alta 200 px' : 'Colonna in orizzontale (riga): alta come un pulsante e larga 4 pulsanti', narrow ? col.w <= 48 && near(col.h, 200, 2) : near(col.h, 44, 2) && col.w <= 4 * 48 + 3 * 8 + 2, JSON.stringify({ w: col.w, h: col.h }));
    // Dove finisce un tocco sul foglio: griglia di punti della pagina visibile, e un tocco vero sotto la colonna
    const grid = await page.evaluate(() => {
      const c = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
      const v = document.querySelector('.viewer').getBoundingClientRect();
      const x0 = Math.max(c.left, v.left);
      const x1 = Math.min(c.right, v.right);
      const y0 = Math.max(c.top, v.top);
      const y1 = Math.min(c.bottom, v.bottom);
      let n = 0;
      let onBtn = 0;
      for (let i = 0; i < 60; i++) {
        for (let j = 0; j < 60; j++) {
          const x = x0 + ((x1 - x0) * (i + 0.5)) / 60;
          const y = y0 + ((y1 - y0) * (j + 0.5)) / 60;
          n++;
          if (document.elementFromPoint(x, y)?.closest('.float-zoom')) onBtn++;
        }
      }
      return { n, onBtn, area: ((onBtn * 100) / n).toFixed(1) };
    });
    info(`colonna ${col.w}x${col.h} px a (${col.l},${col.t}); pagina visibile ${col.page.w}x${col.page.h}: ${grid.area}% dei punti del foglio cade sotto un pulsante (${grid.onBtn}/${grid.n})`);
    if (grid.onBtn > 0) {
      const target = await page.evaluate(() => {
        const f = document.querySelector('.float-zoom').getBoundingClientRect();
        const c = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
        // un punto della pagina dentro il riquadro di un pulsante
        const btn = [...document.querySelectorAll('.float-zoom .btn')].map((e) => e.getBoundingClientRect()).find((r) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top);
        return btn ? { x: (Math.max(btn.left, c.left) + Math.min(btn.right, c.right)) / 2, y: (Math.max(btn.top, c.top) + Math.min(btn.bottom, c.bottom)) / 2 } : null;
      });
      if (target) {
        const cdp = await ctx.newCDPSession(page);
        await page.evaluate(() => {
          window.__hit = null;
          document.addEventListener('pointerdown', (e) => (window.__hit = e.target.closest('.float-zoom .btn')?.getAttribute('aria-label') ?? 'foglio'), true);
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(100);
        info(`un tocco su un punto della pagina sotto la colonna (${Math.round(target.x)},${Math.round(target.y)}) arriva a: ${await page.evaluate(() => window.__hit)}`);
      }
    }
    check(`Nessun errore in console (${w}x${h})`, errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: join(SHOTS, `palette-${w}x${h}.png`) });
    await ctx.close();
  }
}

// =====================================================================
// CP4.6 A) Menu con scorrimento verticale: nessuna voce resta sotto il bordo, bersagli touch >= 44 px, verticale invariato.
async function menuScrollSuite(browser) {
  const combos = [[780, 390], [844, 390], [932, 430], [390, 780]];
  for (const [w, h] of combos) {
    for (const aPlus of [false, true]) {
      section = `menu ${w}x${h}${aPlus ? ' A+ al massimo' : ''}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const cdp = await ctx.newCDPSession(page);
      await openSample(page, 'A4 vettoriale');
      if (aPlus) {
        for (let i = 0; i < 6 && !(await page.locator('.size-btn').nth(1).isDisabled()); i++) await page.locator('.size-btn').nth(1).click();
        check('A+ al massimo (22 px)', (await page.evaluate(() => document.documentElement.style.fontSize)) === '22px');
      }
      for (const name of ['File', 'Modifica', 'Inserisci', 'Zoom']) {
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForTimeout(80);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.menu-panel');
          const pr = p.getBoundingClientRect();
          const items = [...p.querySelectorAll('.menu-item')];
          const small = items.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim());
          const unreachable = [];
          for (const it of items) {
            it.scrollIntoView({ block: 'nearest' });
            const r = it.getBoundingClientRect();
            const q = p.getBoundingClientRect();
            if (r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) unreachable.push(it.textContent.trim());
          }
          p.scrollTop = 0;
          return { top: pr.top, bottom: pr.bottom, innerH: innerHeight, n: items.length, scrollH: p.scrollHeight, clientH: p.clientHeight, overflow: p.scrollHeight > p.clientHeight, small, unreachable, itemH: items[0].getBoundingClientRect().height };
        });
        const tag = `${name}`;
        info(`${tag}: ${m.n} voci, altezza ${m.clientH} su ${m.scrollH} px${m.overflow ? ' (scorre)' : ''}, voce da ${m.itemH.toFixed(1)} px, pannello ${Math.round(m.top)}-${Math.round(m.bottom)} su ${m.innerH}`);
        check(`${tag}: il pannello sta nello schermo (fondo ${Math.round(m.bottom)} <= ${m.innerH})`, m.top >= 0 && m.bottom <= m.innerH + 0.5, JSON.stringify(m));
        check(`${tag}: tutte le ${m.n} voci sono raggiungibili scorrendo`, m.unreachable.length === 0, m.unreachable.join(', '));
        check(`${tag}: bersagli touch >= 44 px`, m.small.length === 0, m.small.join(', '));
        if (!aPlus && w === 390 && h === 780 && name === 'Inserisci') check('Verticale invariato: il menu Inserisci entra intero (545 px, nessuno scorrimento)', !m.overflow && near(m.clientH, 545, 2), JSON.stringify(m));
        if (!aPlus && w === 390) check(`${tag}: in verticale non scorre`, !m.overflow, JSON.stringify(m));
        if (m.overflow) {
          // scorrimento vero col dito: trascinamenti touch verso l'alto (CDP dispatchTouchEvent: `synthesizeScrollGesture` in questa emulazione non scorre il pannello, mentre il trascinamento e la rotella si), poi l'ultima voce attivabile si tocca
          for (let i = 0; i < 10; i++) {
            const d = await page.evaluate(() => {
              const p = document.querySelector('.menu-panel');
              const r = p.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.bottom - 14, span: Math.max(40, Math.min(r.height - 28, 220)), done: p.scrollTop >= p.scrollHeight - p.clientHeight - 1 };
            });
            if (d.done) break;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: d.x, y: d.y, id: 1 }] });
            for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: d.x, y: d.y - (d.span * k) / 8, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(350);
          }
          const atEnd = await page.evaluate(() => {
            const p = document.querySelector('.menu-panel');
            const items = [...p.querySelectorAll('.menu-item')];
            const last = items.at(-1).getBoundingClientRect();
            const q = p.getBoundingClientRect();
            return { st: Math.round(p.scrollTop), max: p.scrollHeight - p.clientHeight, lastIn: last.bottom <= q.bottom + 0.5 && last.top >= q.top - 0.5, pageScrolled: window.scrollY !== 0 || document.documentElement.scrollTop !== 0 };
          });
          check(`${tag}: trascinando col dito si arriva in fondo al menu e l'ultima voce e' tutta in vista`, atEnd.st >= atEnd.max - 1 && atEnd.lastIn && !atEnd.pageScrolled, JSON.stringify(atEnd));
          if (name === 'Inserisci') {
            const tap = await page.evaluate(() => {
              const it = [...document.querySelectorAll('.menu-panel .menu-item')].find((e) => e.textContent.trim() === 'Copertura circolare');
              const r = it.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tap.x, y: tap.y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(200);
            check(`${tag}: toccando "Copertura circolare" in fondo al menu si attiva Copertura con la forma Cerchio`, (await page.locator('button.tool[aria-pressed="true"]').getAttribute('title')) === 'Copertura' && (await page.locator('.ctx-covers button[aria-pressed="true"]').innerText()) === 'Cerchio');
            continue; // il menu si e' chiuso scegliendo
          }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }
      check(`Nessun errore in console (${section})`, errors.length === 0, errors.join(' | '));
      if (!aPlus && w === 780) await page.screenshot({ path: join(SHOTS, `menu-${w}x${h}.png`) });
      await ctx.close();
    }
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const decoderPage = await browser.newPage();
  try {
    await mouseSuite(browser, decoderPage);
    await rotateAndPagesSuite(browser, decoderPage);
    await touchSuite(browser, decoderPage);
    await landscapeSuite(browser);
    await paletteAndColumnSuite(browser);
    await menuScrollSuite(browser);
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
