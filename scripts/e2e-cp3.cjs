// Prove di CP3 su Chromium: mouse (desktop 1280x800) e touch (emulazione iPhone 390x780 e in orizzontale, DPR 3, eventi touch reali via CDP).
// Testo, Quota (allineata, orizzontale, verticale, Ø, R), tastierino su schermo, annulla/ripeti, Cancella, pagina /Rotate 90.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium gia' installati (require('playwright')).
// Uso: npm run build && node scripts/e2e-cp3.cjs [cartella-screenshot]
// Avvia da solo `vite preview` su una porta libera. Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const SHOTS = process.argv[2] || join(require('node:os').tmpdir(), 'gtpdf-e2e-cp3');
mkdirSync(SHOTS, { recursive: true });
const PORT = 4181;
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** Dall'etichetta della scala ("1:N" per N >= 1, "M:1" per N < 1, CP4.6) al numero N = reale / foglio. */
const labelN = (t) => {
  const [a, b] = t.split(':').map(Number);
  return a === 1 ? b : 1 / a;
};

// Dimensioni del foglio mostrato (pt) e riferimento di 100 mm (stesso calcolo di e2e-cp2).
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
async function toClient(page, sample, p) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
    return { l: b.left, t: b.top, w: b.width, h: b.height };
  });
  return { x: r.l + (p.x * r.w) / sample.sheet.w, y: r.t + (p.y * r.h) / sample.sheet.h };
}
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(350);
};
const nums = (d) => (d || '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
const readGroup = (g) => ({
  paths: [...g.querySelectorAll('path')].map((p) => ({ d: p.getAttribute('d'), w: Number(p.getAttribute('stroke-width')), stroke: p.getAttribute('stroke') })),
  arrows: [...g.querySelectorAll('polygon')].map((p) => p.getAttribute('points')),
  rect: g.querySelector('rect') ? { x: +g.querySelector('rect').getAttribute('x'), y: +g.querySelector('rect').getAttribute('y'), w: +g.querySelector('rect').getAttribute('width'), h: +g.querySelector('rect').getAttribute('height') } : null,
  text: g.querySelector('text')?.textContent ?? null,
  tx: g.querySelector('text') ? +g.querySelector('text').getAttribute('x') : null,
  ty: g.querySelector('text') ? +g.querySelector('text').getAttribute('y') : null,
  size: g.querySelector('text') ? +g.querySelector('text').getAttribute('font-size') : null,
  fill: g.querySelector('text')?.getAttribute('fill') ?? null,
  font: g.querySelector('text') ? getComputedStyle(g.querySelector('text')).fontFamily : null,
});
const annots = (page) => page.$$eval('.sc-objects .sc-ann', (gs, src) => gs.map((g) => ({ id: g.dataset.id, ...new Function('g', `return (${src})(g)`)(g) })), readGroup.toString());
const draft = (page) => page.$$eval('.sc-draft .sc-ann', (gs, src) => gs.map((g) => new Function('g', `return (${src})(g)`)(g)), readGroup.toString());
const lineObjects = (page) => page.$$eval('.sc-objects > path', (els) => els.length);
const status = (page) => page.locator('.st-msg').innerText();
const kbdOpen = (page) => page.locator('.keypad:not([hidden])').count().then((n) => n === 1);
const display = (page) => page.locator('.kp-display').innerText();
const key = (page, label) => page.locator('.kp-key', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
const press = async (page, ...labels) => {
  for (const l of labels) await key(page, l).click();
};
const ok = (page) => page.locator('.kp-ok').click();
/** Valore (mm) della distanza sul foglio tra due punti in pt. */
const mmOf = (a, b) => (Math.hypot(b.x - a.x, b.y - a.y) * 25.4) / 72;

async function calibrate(page, sample, tap, real = '100') {
  await tool(page, 'Scala');
  await tap(sample.ref[0]);
  await tap(sample.ref[1]);
  await page.waitForSelector('.dialog');
  await page.locator('.dialog .dlg-fields input').fill(real);
  await page.locator('.dialog .btn.primary').click();
  await page.waitForSelector('.dialog', { state: 'detached' });
}

/** Il punto di lavoro (segni dei punti) e il disegno della bozza stanno nella vista e non sotto il tastierino. */
async function geometryOfEntry(page) {
  return page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const v = r(document.querySelector('.viewer'));
    const k = r(document.querySelector('.keypad'));
    const marks = [...document.querySelectorAll('.pt-mark')].map((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const dr = document.querySelector('.sc-draft .sc-ann');
    return { v, k, marks, draft: dr ? r(dr) : null };
  });
}
const inside = (p, box, m = 0) => p.x >= box.l + m && p.x <= box.r - m && p.y >= box.t + m && p.y <= box.b - m;

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
  const tapSheet = async (p) => {
    const c = await toClient(page, sample, p);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
  };

  // --- Menu: niente "Nuovo"; Inserisci con Testo e le 5 quote ---
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const fileItems = await page.locator('.menu-panel .menu-item').allInnerTexts();
  check('Menu File: Apri, Salva con nome, Esporta PDF, Chiudi (niente "Nuovo")', !fileItems.some((t) => /Nuovo/.test(t)) && ['Apri', 'Salva con nome', 'Esporta PDF', 'Chiudi'].every((n) => fileItems.some((t) => t.startsWith(n))), fileItems.join(' | '));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Inserisci', exact: true }).click();
  const insItems = await page.locator('.menu-panel .menu-item').allInnerTexts();
  check('Menu Inserisci: Testo e le cinque quote attivi', ['Testo', 'Quota allineata', 'Quota orizzontale', 'Quota verticale', 'Quota diametro Ø', 'Quota raggio R'].every((n) => insItems.some((t) => t.startsWith(n))) && (await page.locator('.menu-panel .menu-item:disabled').allInnerTexts()).every((t) => !/Testo|Quota/.test(t)), insItems.join(' | '));
  await page.keyboard.press('Escape');
  check('Strumenti Testo e Quota attivi nella palette', (await page.locator('button.tool[title="Testo"]').isEnabled()) && (await page.locator('button.tool[title="Quota"]').isEnabled()));
  check('Tastierino nascosto all\'inizio', !(await kbdOpen(page)));

  // --- Testo ---
  await tool(page, 'Testo');
  check('Testo: guida iniziale', (await page.locator('.ctx-hint').innerText()).includes('indica dove inizia'));
  check('Tastierino ancora nascosto dopo la scelta dello strumento', !(await kbdOpen(page)));
  await tapSheet({ x: 120, y: 120 });
  check('Testo: dopo il punto compare il tastierino', await kbdOpen(page));
  check('Testo: parte con i tasti lettere (ABC)', (await page.locator('.keypad').getAttribute('data-layout')) === 'abc');
  await page.screenshot({ path: join(SHOTS, 'mouse-01-testo-tastierino.png') });
  // OK a vuoto: errore e resta aperto
  await ok(page);
  check('Testo vuoto: OK rifiutato con messaggio, tastierino aperto', (await kbdOpen(page)) && (await page.locator('.kp-msg').innerText()).includes('Scrivi'));
  await press(page, 'F', 'O', 'R', 'O', 'spazio');
  await page.locator('.kp-row1 .kp-key', { hasText: 'Ø' }).click();
  await page.locator('.kp-mode', { hasText: '123' }).click();
  await press(page, '8');
  await page.locator('.kp-row1 .kp-key', { hasText: '±' }).click();
  await press(page, '0', '.', '1');
  await page.locator('.kp-row1 .kp-key', { hasText: '°' }).click();
  check('Testo: il valore in modifica mostra quello che si scrive (Ø ± ° compresi)', (await display(page)).trim() === 'FORO Ø8±0.1°', await display(page));
  const dr = await draft(page);
  check('Testo: la bozza e\' sul foglio nel punto indicato, in Helvetica 10 pt, rossa', dr.length === 1 && dr[0].text === 'FORO Ø8±0.1°' && near(dr[0].tx, 120, 2.5) && near(dr[0].ty, 120, 2.5) && dr[0].size === 10 && dr[0].fill === '#D32F2F' && /Helvetica/.test(dr[0].font), JSON.stringify(dr[0]));
  // carattere non esportabile: rifiutato con messaggio
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '→', bubbles: true, cancelable: true })));
  check('Carattere non esportabile (→): rifiutato con messaggio, testo invariato', (await page.locator('.kp-msg').innerText()).includes('non si può esportare') && (await display(page)).trim() === 'FORO Ø8±0.1°');
  await ok(page);
  check('Testo: OK chiude il tastierino', !(await kbdOpen(page)));
  let an = await annots(page);
  check('Testo: un oggetto sul foglio con lo stesso testo e posizione', an.length === 1 && an[0].text === 'FORO Ø8±0.1°' && near(an[0].tx, 120, 2.5) && near(an[0].ty, 120, 2.5), JSON.stringify(an));
  check('Testo: la bozza e\' sparita', (await draft(page)).length === 0);
  check('Testo: messaggio di stato con annulla', (await status(page)).includes('Testo aggiunto'));

  // Annulla / ripeti (tastiera e pulsanti)
  await page.locator('.viewer').focus();
  await page.keyboard.press('Control+z');
  check('Ctrl+Z toglie il testo', (await annots(page)).length === 0);
  await page.keyboard.press('Control+Shift+z');
  check('Ctrl+Maiusc+Z lo rimette', (await annots(page)).length === 1);

  // Esc annulla senza lasciare nulla
  await tapSheet({ x: 120, y: 200 });
  await press(page, 'A', 'B');
  await page.keyboard.press('Escape');
  check('Esc: tastierino chiuso, nessun oggetto aggiunto, bozza tolta', !(await kbdOpen(page)) && (await annots(page)).length === 1 && (await draft(page)).length === 0);

  // Tastiera fisica
  await tapSheet({ x: 120, y: 200 });
  await page.keyboard.type('Foro 4');
  await page.keyboard.press('Backspace');
  check('Tastiera fisica: scrive e Backspace cancella', (await display(page)).trim() === 'Foro');
  check('Con il tastierino aperto Annulla/Ripeti in alto sono disattivati', (await page.locator('.undo-ctl button').nth(0).isDisabled()) && (await page.locator('.undo-ctl button').nth(1).isDisabled()));
  await page.keyboard.press('Enter');
  an = await annots(page);
  check('Invio conferma il testo', an.length === 2 && an[1].text === 'Foro' && !(await kbdOpen(page)));

  // Altezza del testo: nell'inspector (desktop)
  const insp = page.locator('.inspector');
  await insp.locator('.preset', { hasText: /^14$/ }).click();
  await tapSheet({ x: 120, y: 280 });
  await page.keyboard.type('GRANDE');
  await page.keyboard.press('Enter');
  an = await annots(page);
  check('Altezza testo 14 pt dall\'inspector: il nuovo testo ha corpo 14', an.length === 3 && an[2].size === 14, JSON.stringify(an.map((a) => a.size)));
  // ("Applica all'ultimo oggetto" e' stato tolto in CP4: si cambiano le proprieta' di un oggetto qualunque con Seleziona, provato in e2e-cp4.cjs)
  await insp.locator('.preset', { hasText: /^10$/ }).click();

  // Cancella: un tocco sul testo lo cancella; Annulla lo ripristina
  await tool(page, 'Cancella');
  const tc = await toClient(page, sample, { x: 135, y: 117 });
  await page.mouse.move(tc.x, tc.y);
  check('Cancella: il testo sotto il puntatore e\' evidenziato', (await page.locator('.sc-hl rect').count()) === 1);
  await page.mouse.down();
  await page.mouse.up();
  an = await annots(page);
  check('Cancella: il testo e\' cancellato', an.length === 2 && !an.some((a) => a.text === 'FORO Ø8±0.1°'), JSON.stringify(an.map((a) => a.text)));
  await page.locator('.undo-ctl button').nth(0).click();
  an = await annots(page);
  check('Annulla: il testo torna al suo posto (il primo)', an.length === 3 && an[0].text === 'FORO Ø8±0.1°');
  // pulizia: via tutto per le prove delle quote
  await page.locator('.viewer').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  check('Pagina pulita per le quote', (await annots(page)).length === 0);

  // --- Quota senza scala: valore digitato ---
  await tool(page, 'Quota');
  check('Quota: cinque tipi nella barra contestuale, allineata attiva', (await page.locator('.ctx-types button').count()) === 5 && (await page.locator('.ctx-types button[aria-pressed="true"]').innerText()) === 'Allineata');
  await page.locator('.ctx-types button', { hasText: 'Orizz.' }).click();
  check('Quota orizzontale: guida del primo punto', (await page.locator('.ctx-hint').innerText()).includes('Quota orizzontale: indica il primo punto'));
  await tapSheet({ x: 150, y: 450 });
  await tapSheet({ x: 440, y: 470 });
  check('Quota a tre punti: dopo il secondo il tastierino non c\'e\' ancora', !(await kbdOpen(page)));
  check('Quota: guida del terzo punto', (await page.locator('.ctx-hint').innerText()).includes('linea di quota'));
  await tapSheet({ x: 300, y: 380 });
  check('Quota: dopo il terzo punto compare il tastierino (numeri)', (await kbdOpen(page)) && (await page.locator('.keypad').getAttribute('data-layout')) === 'num');
  check('Senza scala: nessun valore proposto e il tastierino lo dice', (await display(page)).trim() === '' && (await page.locator('.kp-info').innerText()).includes('non calibrata'), `${await display(page)} / ${await page.locator('.kp-info').innerText()}`);
  await ok(page);
  check('Quota senza valore: OK rifiutato (serve una cifra)', (await kbdOpen(page)) && (await page.locator('.kp-msg').innerText()).includes('Digita'));
  await page.keyboard.type('25,4');
  check('Virgola decimale digitata -> "." nel valore', (await display(page)).trim() === '25.4', await display(page));
  await ok(page);
  an = await annots(page);
  check('Quota digitata: etichetta "25.4", linea di quota orizzontale e due frecce', an.length === 1 && an[0].text === '25.4' && an[0].arrows.length === 2, JSON.stringify(an[0]));
  const mainLine = nums(an[0].paths[0].d);
  check('Quota orizzontale: la linea di quota e\' orizzontale (stessa Y) alla Y del terzo punto', mainLine.length === 4 && near(mainLine[1], mainLine[3], 1e-6) && near(mainLine[1], 380, 2.5) && near(mainLine[0], 150, 2.5) && near(mainLine[2], 440, 2.5), JSON.stringify(mainLine));
  const ext = an[0].paths.slice(1).map((p) => nums(p.d));
  check('Due linee di estensione verticali, dai punti misurati (Y 450 e 470) alla linea di quota (Y 380)', ext.length === 2 && ext.every((e) => near(e[0], e[2], 1e-6)) && near(ext[0][1], 450 - 2.5, 2.5) && near(ext[1][1], 470 - 2.5, 2.5) && ext.every((e) => e[3] < 380), JSON.stringify(ext));
  check('Etichetta in un badge bianco che non tocca la linea di quota', an[0].rect && (an[0].rect.y + an[0].rect.h < mainLine[1] || an[0].rect.y > mainLine[1]), JSON.stringify(an[0].rect));
  await page.screenshot({ path: join(SHOTS, 'mouse-02-quota-senza-scala.png') });

  // --- Calibrazione e quote automatiche ---
  await calibrate(page, sample, tapSheet);
  const scaleN = labelN(await page.locator('.st-scale-btn').innerText());
  check('Scala ~1:1 dopo la calibrazione', near(scaleN, 1, 0.03), String(scaleN));
  const expectMm = (a, b) => mmOf(a, b) * (near(scaleN, 1, 0.03) ? scaleN : 1);

  const dimFlow = async (label, pts) => {
    if (!(await page.locator('.ctx-types').isVisible())) await tool(page, 'Quota');
    await page.locator('.ctx-types button', { hasText: label }).click();
    for (const p of pts) await tapSheet(p);
    return kbdOpen(page);
  };
  // Allineata
  await dimFlow('Allineata', [{ x: 150, y: 600 }, { x: 440, y: 650 }, { x: 300, y: 560 }]);
  const alignedExpect = expectMm({ x: 150, y: 600 }, { x: 440, y: 650 });
  let shown = (await display(page)).trim();
  check('Quota allineata: valore automatico = distanza p1-p2 con la scala', near(Number(shown), alignedExpect, alignedExpect * 0.02 + 0.1) && /^\d+\.\d\d$/.test(shown), `${shown} atteso ~${alignedExpect.toFixed(2)}`);
  check('Il tastierino dice automatico e scala', /Automatico .* · scala 1:/.test(await page.locator('.kp-info').innerText()), await page.locator('.kp-info').innerText());
  let d0 = (await draft(page))[0];
  const al = nums(d0.paths[0].d);
  const slope = (al[3] - al[1]) / (al[2] - al[0]);
  check('Allineata: la linea di quota e\' parallela a p1-p2 (pendenza 50/290)', near(slope, 50 / 290, 0.01), String(slope));
  await ok(page);
  an = await annots(page);
  check('Quota allineata confermata con il valore automatico', an.length === 2 && an[1].text === shown, JSON.stringify(an[1]?.text));
  const alignedId = an[1].id;

  // Verticale (a sinistra), digitando un valore dopo la selezione
  await dimFlow('Vert.', [{ x: 100, y: 250 }, { x: 120, y: 520 }, { x: 60, y: 400 }]);
  shown = (await display(page)).trim();
  check('Quota verticale: valore automatico = |Δy| sul foglio', near(Number(shown), expectMm({ x: 0, y: 250 }, { x: 0, y: 520 }), 1.5), `${shown} atteso ~${expectMm({ x: 0, y: 250 }, { x: 0, y: 520 }).toFixed(2)}`);
  d0 = (await draft(page))[0];
  const vl = nums(d0.paths[0].d);
  check('Verticale: linea di quota verticale (stessa X) alla X del terzo punto', near(vl[0], vl[2], 1e-6) && near(vl[0], 60, 2.5), JSON.stringify(vl));
  check('Verticale: il badge sta a sinistra della linea (lato opposto ai punti)', d0.rect.x + d0.rect.w < vl[0], JSON.stringify({ r: d0.rect, vl }));
  await press(page, '7');
  check('Primo tasto sostituisce il valore proposto (selezione)', (await display(page)).trim() === '7');
  await press(page, '2', '.', '5');
  await ok(page);
  an = await annots(page);
  check('Quota verticale digitata "72.5"', an.length === 3 && an[2].text === '72.5');

  // Ø: 2 punti, prefisso che resta alla sostituzione
  await dimFlow('Ø Diam.', [{ x: 217, y: 390 }, { x: 378, y: 390 }]);
  shown = (await display(page)).trim();
  check('Quota Ø: due punti bastano; valore automatico con prefisso Ø', /^Ø\d+\.\d\d$/.test(shown) && near(Number(shown.slice(1)), expectMm({ x: 217, y: 390 }, { x: 378, y: 390 }), 1.5), shown);
  d0 = (await draft(page))[0];
  check('Ø: nessuna linea di estensione, due frecce, linea di quota tra i due punti', d0.paths.length === 1 && d0.arrows.length === 2, JSON.stringify(d0.paths.length));
  await page.locator('.kp-fn[aria-label^="Cancella"]').click();
  check('⌫ sulla selezione cancella il numero e lascia il prefisso Ø', (await display(page)).trim() === 'Ø', await display(page));
  await press(page, '8');
  await ok(page);
  an = await annots(page);
  check('Quota Ø digitata "Ø8"', an.length === 4 && an[3].text === 'Ø8');

  // R: centro + punto sul bordo
  await dimFlow('R Raggio', [{ x: 298, y: 390 }, { x: 378, y: 390 }]);
  shown = (await display(page)).trim();
  check('Quota R: centro + punto sul bordo; valore con prefisso R', /^R\d+\.\d\d$/.test(shown) && near(Number(shown.slice(1)), expectMm({ x: 298, y: 390 }, { x: 378, y: 390 }), 1.5), shown);
  d0 = (await draft(page))[0];
  check('R: una sola freccia (sul bordo)', d0.arrows.length === 1, String(d0.arrows.length));
  await ok(page);
  an = await annots(page);
  check('Quota R confermata (automatica)', an.length === 5 && /^R\d+\.\d\d$/.test(an[4].text));
  await page.screenshot({ path: join(SHOTS, 'mouse-03-cinque-quote.png') });

  // Ricalibrazione: le quote automatiche seguono, quelle digitate no
  const before = an.map((a) => a.text);
  await calibrate(page, sample, tapSheet, '200');
  an = await annots(page);
  const ratio = Number(an[1].text) / Number(before[1]);
  check('Ricalibrata a 200 mm: la quota allineata automatica raddoppia (~x2)', near(ratio, 2, 0.05), `${before[1]} -> ${an[1].text}`);
  check('...le quote digitate non cambiano (72.5, Ø8)', an[2].text === '72.5' && an[3].text === 'Ø8', JSON.stringify(an.map((a) => a.text)));
  await page.locator('.undo-ctl button').nth(0).click();
  an = await annots(page);
  check('Annulla la ricalibrazione: i valori tornano', an[1].text === before[1], `${an[1].text} / ${before[1]}`);

  // Cancella una quota, annulla
  await tool(page, 'Cancella');
  const qc = await toClient(page, sample, { x: 300, y: 560 });
  await page.mouse.move(qc.x, qc.y);
  check('Cancella: la quota sotto il puntatore e\' evidenziata (linee e badge)', (await page.locator('.sc-hl path').count()) >= 1);
  await page.mouse.down();
  await page.mouse.up();
  an = await annots(page);
  check('Cancella: la quota allineata e\' cancellata', an.length === 4 && !an.some((a) => a.id === alignedId));
  await page.locator('.undo-ctl button').nth(0).click();
  an = await annots(page);
  check('Annulla: la quota torna', an.length === 5 && an[1].id === alignedId);

  // Menu Inserisci > Quota raggio R seleziona strumento e tipo
  await page.getByRole('button', { name: 'Inserisci', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Quota verticale' }).click();
  check('Menu Inserisci > Quota verticale: strumento Quota, tipo verticale', (await page.locator('.ctx-types button[aria-pressed="true"]').innerText()) === 'Vert.' && (await page.locator('button.tool[aria-pressed="true"]').getAttribute('title')) === 'Quota');

  // Cambio strumento con il tastierino aperto non puo' succedere: il tastierino e' modale per le barre (desktop: resta tutto visibile)
  await page.locator('.ctx-types button', { hasText: 'Allineata' }).click();
  await tapSheet({ x: 150, y: 700 });
  await tapSheet({ x: 300, y: 700 });
  await tapSheet({ x: 220, y: 740 });
  check('Quota con il tastierino aperto: palette ancora visibile su desktop', await kbdOpen(page));
  await tool(page, 'Retta');
  check('Cambiare strumento col tastierino aperto lo chiude e scarta la bozza', !(await kbdOpen(page)) && (await draft(page)).length === 0 && (await annots(page)).length === 5);

  check('Nessun errore in console (mouse)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function rotateSuite(browser) {
  section = 'rotate 90';
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
  await calibrate(page, sample, tapSheet);
  await tool(page, 'Quota');
  await page.locator('.ctx-types button', { hasText: 'Orizz.' }).click();
  await tapSheet({ x: 100, y: 200 });
  await tapSheet({ x: 400, y: 260 });
  await tapSheet({ x: 250, y: 150 });
  const shown = (await display(page)).trim();
  const exp = mmOf({ x: 100, y: 0 }, { x: 400, y: 0 });
  check('Pagina /Rotate 90: quota orizzontale = |Δx| come si vede sullo schermo', near(Number(shown), exp, 1.5), `${shown} atteso ~${exp.toFixed(2)}`);
  const d0 = (await draft(page))[0];
  const l = nums(d0.paths[0].d);
  check('Pagina /Rotate 90: la linea di quota e\' orizzontale sul foglio', near(l[1], l[3], 1e-6) && near(l[1], 150, 2.5), JSON.stringify(l));
  await ok(page);
  await page.locator('.ctx-types button', { hasText: 'Vert.' }).click();
  await tapSheet({ x: 120, y: 300 });
  await tapSheet({ x: 140, y: 480 });
  await tapSheet({ x: 90, y: 400 });
  const shownV = (await display(page)).trim();
  const expV = mmOf({ x: 0, y: 300 }, { x: 0, y: 480 });
  check('Pagina /Rotate 90: quota verticale = |Δy| sullo schermo', near(Number(shownV), expV, 1.5), `${shownV} atteso ~${expV.toFixed(2)}`);
  await ok(page);
  await tool(page, 'Testo');
  await tapSheet({ x: 300, y: 500 });
  await page.keyboard.type('RUOTATA');
  await page.keyboard.press('Enter');
  const an = await annots(page);
  const t = an.find((a) => a.text === 'RUOTATA');
  check('Pagina /Rotate 90: il testo e\' dritto sul foglio (nessuna rotazione) nel punto indicato', t && near(t.tx, 300, 2.5) && near(t.ty, 500, 2.5), JSON.stringify(t));
  const rot = await page.$$eval('.sc-objects .sc-ann text', (els) => els.map((e) => e.getAttribute('transform')));
  check('Il testo non ha trasformazioni di rotazione', rot.every((r) => r === null), JSON.stringify(rot));
  await page.screenshot({ path: join(SHOTS, 'rotate-01.png') });
  check('Nessun errore in console (rotate)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function touchSuite(browser) {
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
  /** Tocco con mira (lente) e rilascio nel punto del foglio. */
  const tapSheet = async (p, { via } = {}) => {
    const c = await toClient(page, sample, p);
    await touch('touchStart', [c]);
    if (via) {
      await touch('touchMove', [{ x: c.x + via.x, y: c.y + via.y }]);
      await touch('touchMove', [c]);
    }
    const lens = await page.locator('.lens:not([hidden])').count();
    await touch('touchEnd', []);
    return lens;
  };
  const boxes = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  const small = (list) => list.filter((b) => b.w < 43.5 || b.h < 43.5).map((b) => `${b.n} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`);

  // --- Testo con il dito e la lente ---
  await tool(page, 'Testo');
  await page.locator('button.tool[title="Testo"]').scrollIntoViewIfNeeded();
  const ctxBox = await page.locator('.ctxbar').boundingBox();
  check('Testo: barra contestuale dentro i 390 px', ctxBox && ctxBox.x >= 0 && ctxBox.x + ctxBox.width <= 390.5, JSON.stringify(ctxBox));
  const lensSeen = await tapSheet({ x: 150, y: 330 }, { via: { x: 12, y: 20 } });
  check('Testo: la lente compare durante la mira', lensSeen === 1);
  check('Tastierino visibile dopo il punto', await kbdOpen(page));
  // niente barre e palette: spazio per il foglio
  const hidden = await page.evaluate(() => ['.bar', '.palette', '.statusbar', '.ctxbar', '.float-zoom'].map((s) => [s, getComputedStyle(document.querySelector(s)).display]));
  check('iPhone verticale: con il tastierino aperto barre, palette e pulsanti sul foglio sono nascosti', hidden.every(([, d]) => d === 'none'), JSON.stringify(hidden));
  let g = await geometryOfEntry(page);
  check('Il tastierino sta in basso e non copre il foglio (vista sopra il tastierino)', g.v.b <= g.k.t + 0.5 && g.k.b <= 780.5 && g.v.h >= 250, JSON.stringify({ v: g.v, k: g.k }));
  check('Il punto di lavoro e\' visibile nella vista e fuori dal tastierino', g.marks.length === 1 && inside(g.marks[0], g.v, 6) && !inside(g.marks[0], g.k), JSON.stringify(g.marks));
  const keys = await boxes('.keypad .kp-key');
  check('Tastierino (lettere): tutti i tasti >= 44x44 px e dentro i 390 px', small(keys).length === 0 && keys.every((b) => b.l >= -0.5 && b.r <= 390.5), small(keys).join(', '));
  check('Tastierino: 26 lettere + Aa + spazio + 4 speciali + backspace + 4 azioni', keys.length === 26 + 2 + 4 + 1 + 4, String(keys.length));
  await page.screenshot({ path: join(SHOTS, 'iphone-01-testo-lettere.png') });
  await press(page, 'F', 'O', 'R', 'O');
  await page.locator('.kp-fn', { hasText: 'abc' }).click();
  await press(page, 'f');
  check('Maiuscole/minuscole: il tasto passa alle minuscole', (await display(page)).trim() === 'FOROf');
  await page.locator('.kp-mode', { hasText: '#$&' }).click();
  check('Layout simboli: 28 celle e simboli # $ &', (await page.locator('.kp-main .kp-key').count()) === 28 && (await page.locator('.kp-main .kp-key', { hasText: /^#$/ }).count()) === 1 && (await page.locator('.kp-main .kp-key', { hasText: /^\$$/ }).count()) === 1 && (await page.locator('.kp-main .kp-key', { hasText: /^&$/ }).count()) === 1);
  await page.screenshot({ path: join(SHOTS, 'iphone-02-simboli.png') });
  await press(page, '#');
  await page.locator('.kp-mode', { hasText: '123' }).click();
  const numKeys = await boxes('.keypad .kp-key');
  check('Tastierino (numeri): tutti i tasti >= 44x44 px e dentro i 390 px', small(numKeys).length === 0 && numKeys.every((b) => b.l >= -0.5 && b.r <= 390.5), small(numKeys).join(', '));
  await press(page, '1', '2');
  check('Numeri: layout 7 8 9 / 4 5 6 / 1 2 3 / 0 . 00', (await page.locator('.kp-main-num .kp-key').allInnerTexts()).join(',') === '7,8,9,4,5,6,1,2,3,0,.,00');
  await page.screenshot({ path: join(SHOTS, 'iphone-03-numeri.png') });
  // un tocco sul tastierino non inserisce punti sul foglio
  check('Toccare i tasti non inserisce punti sul foglio', (await page.locator('.pt-mark').count()) === 1);
  await ok(page);
  let an = await annots(page);
  check('Testo con il dito: oggetto nel punto toccato', an.length === 1 && an[0].text === 'FOROf#12' && near(an[0].tx, 150, 3) && near(an[0].ty, 330, 3), JSON.stringify(an[0]));
  check('Tastierino chiuso e barre di nuovo visibili', !(await kbdOpen(page)) && (await page.evaluate(() => getComputedStyle(document.querySelector('.palette')).display !== 'none' && getComputedStyle(document.querySelector('.bar')).display !== 'none')));

  // --- Quota: tre punti con il dito, punto di lavoro in basso con zoom ---
  await tool(page, 'Quota');
  const types = await boxes('.ctx-types button');
  check('Tipi di quota: 5 pulsanti interi dentro 390 px, >= 44 px di altezza', types.length === 5 && types.every((b) => b.h >= 43.5 && b.l >= -0.5 && b.r <= 390.5), JSON.stringify(types));
  await calibrate(page, sample, async (p) => void (await tapSheet(p)));
  await tool(page, 'Quota');
  await page.locator('.ctx-types button', { hasText: 'Orizz.' }).click();
  await tapSheet({ x: 150, y: 450 });
  await tapSheet({ x: 440, y: 470 });
  const dl = await tapSheet({ x: 300, y: 400 }, { via: { x: 10, y: 14 } });
  check('Quota: lente anche per il terzo punto', dl === 1);
  check('Quota orizzontale con valore automatico', (await kbdOpen(page)) && /^\d+\.\d\d$/.test((await display(page)).trim()), await display(page));
  g = await geometryOfEntry(page);
  check('Quota: punti e disegno della bozza visibili sopra il tastierino', g.marks.length === 3 && g.marks.every((m) => inside(m, g.v, 4) && !inside(m, g.k)) && g.draft && g.draft.t >= g.v.t - 1 && g.draft.b <= g.k.t + 1, JSON.stringify({ marks: g.marks, draft: g.draft, v: g.v, k: g.k }));
  await page.screenshot({ path: join(SHOTS, 'iphone-04-quota.png') });
  await ok(page);
  check('Quota: confermata', (await annots(page)).length === 2);

  // Zoom avanti vicino al fondo della pagina: il punto di lavoro non deve finire sotto il tastierino
  await tool(page, 'Sposta vista');
  for (let i = 0; i < 4; i++) await page.locator('.float-zoom button[aria-label="Aumenta zoom"]').click();
  await page.waitForTimeout(400);
  await tool(page, 'Testo');
  // un punto vicino al bordo inferiore della vista attuale (non della pagina)
  const vbox = await page.locator('.viewer').boundingBox();
  const px = vbox.x + vbox.width / 2;
  const py = vbox.y + vbox.height - 40;
  await touch('touchStart', [{ x: px, y: py }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  g = await geometryOfEntry(page);
  check('Con zoom e punto vicino al fondo: il tastierino riduce la vista ma il punto resta visibile e scoperto', (await kbdOpen(page)) && g.marks.length === 1 && inside(g.marks[0], g.v, 6) && !inside(g.marks[0], g.k), JSON.stringify({ marks: g.marks, v: g.v, k: g.k }));
  await page.screenshot({ path: join(SHOTS, 'iphone-05-zoom-punto-in-basso.png') });
  await page.locator('.kp-cancel').click();
  check('Annulla: tastierino chiuso, nessun oggetto aggiunto', !(await kbdOpen(page)) && (await annots(page)).length === 2);

  // Un dito sposta la vista con il tastierino aperto (modo "sposta"), nessun punto inserito
  const vbox2 = await page.locator('.viewer').boundingBox();
  await touch('touchStart', [{ x: vbox2.x + vbox2.width / 2 - 40, y: vbox2.y + 100 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const m0 = (await geometryOfEntry(page)).marks[0];
  const vb2 = await page.locator('.viewer').boundingBox();
  await touch('touchStart', [{ x: vb2.x + 60, y: vb2.y + 60 }]);
  await touch('touchMove', [{ x: vb2.x + 90, y: vb2.y + 80 }]);
  await touch('touchEnd', []);
  const m1 = (await geometryOfEntry(page)).marks[0];
  check('Con il tastierino aperto un dito trascina la vista (il segno si sposta di 30x20 px) senza inserire punti', m0 && m1 && near(m1.x - m0.x, 30, 3) && near(m1.y - m0.y, 20, 3) && (await page.locator('.pt-mark').count()) === 1, JSON.stringify({ m0, m1 }));
  await page.locator('.kp-cancel').click();

  check('Nessun errore in console (iPhone)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// =====================================================================
async function landscapeSuite(browser) {
  for (const [w, h] of [[844, 390], [780, 390], [667, 375]]) {
    section = `iPhone ${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    const sample = SAMPLES['A4 vettoriale'];
    await openSample(page, 'A4 vettoriale');
    await tool(page, 'Testo');
    const c = await toClient(page, sample, { x: 200, y: 250 });
    await touch('touchStart', [c]);
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    check('Tastierino visibile dopo il punto', await kbdOpen(page));
    const g = await geometryOfEntry(page);
    check('In orizzontale il tastierino sta a destra e la vista a sinistra, senza sovrapporsi', g.k.l >= g.v.r - 0.5 && g.k.r <= w + 0.5 && g.v.w >= 250, JSON.stringify({ v: g.v, k: g.k }));
    check('Il punto di lavoro e\' visibile e fuori dal tastierino', g.marks.length === 1 && inside(g.marks[0], g.v, 6) && !inside(g.marks[0], g.k), JSON.stringify(g.marks));
    // il tastierino riempie l'altezza disponibile: si misura se l'ultima riga di tasti sta dentro il suo riquadro
    const fit = () => {
      const k = document.querySelector('.keypad').getBoundingClientRect();
      const body = document.querySelector('.kp-body').getBoundingClientRect();
      return { fits: body.bottom <= k.bottom + 0.5, bodyBottom: Math.round(body.bottom), keypadBottom: Math.round(k.bottom) };
    };
    const kb = await page.evaluate((src) => {
      const keys = [...document.querySelectorAll('.keypad .kp-key')].map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, r: r.right, b: r.bottom }; });
      return { ...new Function(`return (${src})()`)(), keys };
    }, fit.toString());
    check('Lettere in orizzontale: tasti >= 44 px', kb.keys.every((b) => b.w >= 43.5 && b.h >= 43.5), JSON.stringify(kb.keys.filter((b) => b.w < 43.5 || b.h < 43.5)));
    console.log(`INFO  [${section}] tastierino lettere: ultima riga a ${kb.bodyBottom} px, riquadro fino a ${kb.keypadBottom} px ${kb.fits ? '(entra)' : '(scorre)'}`);
    await page.screenshot({ path: join(SHOTS, `landscape-${w}x${h}-lettere.png`) });
    await page.locator('.kp-mode', { hasText: '123' }).click();
    const kn = await page.evaluate((src) => new Function(`return (${src})()`)(), fit.toString());
    console.log(`INFO  [${section}] tastierino numeri: ultima riga a ${kn.bodyBottom} px, riquadro fino a ${kn.keypadBottom} px ${kn.fits ? '(entra)' : '(scorre)'}`);
    check('Numeri in orizzontale: il tastierino entra senza scorrere', kn.fits, JSON.stringify(kn));
    await press(page, '4', '2');
    await page.screenshot({ path: join(SHOTS, `landscape-${w}x${h}-numeri.png`) });
    await ok(page);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
    check('Nessuno scorrimento della pagina', ov.sw <= ov.iw && ov.sh <= ov.ih, JSON.stringify(ov));
    check('Nessun errore in console', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // Rotazione dell'iPhone con il tastierino aperto: il punto di lavoro resta in vista e scoperto
  section = 'iPhone rotazione';
  {
    const ctxR = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
    const pageR = await ctxR.newPage();
    const cdpR = await ctxR.newCDPSession(pageR);
    const touchR = (type, pts) => cdpR.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    const sampleR = SAMPLES['A4 vettoriale'];
    await openSample(pageR, 'A4 vettoriale');
    for (let i = 0; i < 3; i++) await pageR.locator('.float-zoom button[aria-label="Aumenta zoom"]').click();
    await tool(pageR, 'Testo');
    const vb = await pageR.locator('.viewer').boundingBox();
    await touchR('touchStart', [{ x: vb.x + vb.width / 2 - 40, y: vb.y + vb.height - 60 }]);
    await touchR('touchEnd', []);
    await pageR.waitForTimeout(400);
    let gr = await geometryOfEntry(pageR);
    check('Verticale con zoom, punto in basso: punto visibile e scoperto', gr.marks.length === 1 && inside(gr.marks[0], gr.v, 6) && !inside(gr.marks[0], gr.k), JSON.stringify(gr));
    await pageR.setViewportSize({ width: 844, height: 390 });
    await pageR.waitForTimeout(500);
    gr = await geometryOfEntry(pageR);
    check('Ruotato in orizzontale col tastierino aperto: tastierino a destra, punto ancora visibile e scoperto', (await kbdOpen(pageR)) && gr.k.l >= gr.v.r - 0.5 && gr.marks.length === 1 && inside(gr.marks[0], gr.v, 6) && !inside(gr.marks[0], gr.k), JSON.stringify(gr));
    await pageR.screenshot({ path: join(SHOTS, 'rotazione-orizzontale.png') });
    await pageR.setViewportSize({ width: 390, height: 780 });
    await pageR.waitForTimeout(500);
    gr = await geometryOfEntry(pageR);
    check('Di nuovo in verticale: punto visibile e scoperto', (await kbdOpen(pageR)) && gr.marks.length === 1 && inside(gr.marks[0], gr.v, 6) && !inside(gr.marks[0], gr.k), JSON.stringify(gr));
    await ctxR.close();
  }

  // A+ al massimo in verticale: il tastierino resta intero nella larghezza
  section = 'iPhone A+ al massimo';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const sample = SAMPLES['A4 vettoriale'];
  await openSample(page, 'A4 vettoriale');
  for (let i = 0; i < 3; i++) await page.locator('.size-btn').nth(1).click();
  await tool(page, 'Quota');
  const t5 = await page.$$eval('.ctx-types button', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; }));
  check('A+ al massimo: i cinque tipi di quota restano interi nei 390 px', t5.length === 5 && t5.every((b) => b.l >= -0.5 && b.r <= 390.5), JSON.stringify(t5));
  await page.locator('.ctx-types button', { hasText: 'Ø Diam.' }).click();
  const a = await toClient(page, sample, { x: 200, y: 300 });
  const b = await toClient(page, sample, { x: 400, y: 300 });
  await touch('touchStart', [a]);
  await touch('touchEnd', []);
  await touch('touchStart', [b]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  check('A+ al massimo: tastierino aperto per la quota Ø', await kbdOpen(page));
  const gk = await geometryOfEntry(page);
  const kk = await page.$$eval('.keypad .kp-key', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
  check('A+ al massimo: tutti i tasti dentro i 390 px', kk.every((x) => x.l >= -0.5 && x.r <= 390.5), JSON.stringify(kk.filter((x) => x.l < -0.5 || x.r > 390.5)));
  check('A+ al massimo: il punto di lavoro e\' visibile', gk.marks.length === 2 && gk.marks.every((m) => inside(m, gk.v, 4) && !inside(m, gk.k)), JSON.stringify({ marks: gk.marks, v: gk.v, k: gk.k }));
  console.log(`INFO  [${section}] vista ${gk.v.h.toFixed(0)} px, tastierino ${gk.k.h.toFixed(0)} px`);
  await page.screenshot({ path: join(SHOTS, 'iphone-A-piu-max-quota.png') });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('A+ al massimo: nessuno scorrimento orizzontale', ov);
  await ctx.close();
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    await mouseSuite(browser);
    await rotateSuite(browser);
    await touchSuite(browser);
    await landscapeSuite(browser);
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
