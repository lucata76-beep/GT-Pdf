// Prove di CP7a (V3.0, Diagnostica geometria PDF) su Chromium: la scheda "Geometria PDF" di File > Diagnostica (#diag), con mouse (desktop 1280 x 900) e 390 x 780.
// Apre con "Apri PDF…" (il selettore file della pagina Diagnostica) ciascuno dei 7 PDF di prova di public/test-pdfs, preme "Misura questa pagina" e confronta i numeri con quelli degli
// unitari (src/pdf/geometry.test.ts: 160 operazioni e 15 percorsi tutti stroke, 11 lineTo, 24 cubiche, 7 chiusure, 4 showText, 6 cerchi; annotazioni: 225 operazioni, 20 percorsi;
// scansione: 0 percorsi); "Misura tutte le pagine" su misto-3-pagine.pdf (3 righe); "Copia misura" (il testo copiato si legge da un navigator.clipboard sostituito nella pagina, e
// dall'area di ripiego quando la copia automatica fallisce) NON contiene il nome del file ne' i metadati del documento; livelli e un PDF grande (100.000 segmenti) costruiti qui
// con @cantoo/pdf-lib; PDF non valido, troncato e con un flusso danneggiato non rompono la scheda; nessuno scorrimento orizzontale a 390 px.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp7a.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su 1395749 la scheda non esiste e i controlli sulla scheda FALLISCONO)
//   E2E_ONLY=scheda,file,pagine,copia,livelli,grande,errori,layout: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li' ne' su iPhone.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { PDFDocument, PDFName, PDFString } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7a', out: process.argv[2], port: 4236, hport: 4237, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const PDFJS_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')).version;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const SECRET = 'cliente-riservato-7c1e';
const META_STRINGS = ['fittizio', 'test fixtures', 'make-test-pdfs', 'GT-Pdf test'];

// Valori attesi (gli stessi degli unitari). `w` e `h`: dimensioni della vista, in pt.
const SHEET = { cls: 'vettoriale', ops: 160, constructPath: 15, stroke: 15, fill: 0, fillstroke: 0, endPath: 0, paths: 15, lineTo: 11, cubic: 24, close: 7, showText: 4, circles: 6, images: 0, rotate: 0 };
const FILES = [
  ['a4-vettoriale.pdf', { ...SHEET, w: 595.28, h: 841.89, view: '0 0 595.276 841.89' }],
  ['a3-vettoriale.pdf', { ...SHEET, w: 1190.55, h: 841.89, view: '0 0 1190.551 841.89' }],
  ['a4-cropbox.pdf', { ...SHEET, w: 400, h: 550, view: '50 50 450 600' }],
  ['a4-rotate90.pdf', { ...SHEET, rotate: 90, w: 841.89, h: 595.28, view: '0 0 595.276 841.89' }],
  ['a4-annotazioni.pdf', { cls: 'vettoriale', ops: 225, constructPath: 20, stroke: 17, fill: 0, fillstroke: 2, endPath: 1, paths: 20, lineTo: 25, cubic: 24, close: 11, showText: 6, images: 0, rotate: 0, w: 595.28, h: 841.89, view: '0 0 595.276 841.89' }],
  ['a4-scansione.pdf', { cls: 'scansione', ops: 8, constructPath: 0, stroke: 0, fill: 0, fillstroke: 0, endPath: 0, paths: 0, lineTo: 0, cubic: 0, close: 0, showText: 0, images: 1, rotate: 0, w: 595.2, h: 841.92, view: null }],
];
const MISTO_PAGES = [
  { ...SHEET, w: 595.28, h: 841.89, view: '0 0 595.276 841.89' },
  { ...SHEET, w: 1190.55, h: 841.89, view: '0 0 1190.551 841.89' },
  { ...SHEET, rotate: 90, w: 841.89, h: 595.28, view: '0 0 595.276 841.89' },
];

// ---------------------------------------------------------------- strumenti di prova
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
async function newDiag(browser, kind) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA } : { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__copied = [];
    window.__clipMode = 'ok';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t) => {
          if (window.__clipMode === 'fail') throw new Error('negato');
          window.__copied.push(String(t));
        },
      },
    });
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
const logText = (page) => page.locator('textarea[aria-label="Registro eventi"]').inputValue();
const countIn = (text, re) => (text.match(re) || []).length;
/** Apre un PDF con il selettore di "Apri PDF…" e aspetta l'esito (Aperto / Apertura fallita) nel registro. */
async function loadFile(page, name, bytes) {
  const before = await logText(page);
  const nOk = countIn(before, /\[OK\] Aperto: /g);
  const nBad = countIn(before, /Apertura fallita/g);
  await page.setInputFiles('.screen-diag input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction(
    ([a, b]) => {
      const t = document.querySelector('textarea[aria-label="Registro eventi"]').value;
      return (t.match(/\[OK\] Aperto: /g) || []).length > a || (t.match(/Apertura fallita/g) || []).length > b;
    },
    [nOk, nBad],
  );
  const after = await logText(page);
  const opened = countIn(after, /\[OK\] Aperto: /g) > nOk;
  if (opened) await page.waitForTimeout(250);
  return opened;
}
const btn = (page, name) => page.locator('.geo-card').getByRole('button', { name, exact: true });
const status = (page) => page.locator('.geo-status').innerText();
/** Preme un pulsante di misura e aspetta la fine (lo stato non dice piu' "in corso"). */
async function press(page, name, doneRe) {
  await btn(page, name).click();
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.geo-status').innerText), doneRe, { timeout: 60000 });
  return status(page);
}
const MEASURED = '^(Misurat[ae] \\d+|Nessuna pagina misurata|Misura fallita|Misura interrotta)';
const detail = (page) => page.locator('.geo-detail').innerText();
const num = (re, t) => {
  const m = re.exec(t);
  return m ? m.slice(1).map(Number) : null;
};
/** Legge le voci del dettaglio mostrato dalla scheda. */
function parse(t) {
  const all = num(/tutti i percorsi: percorsi (\d+), sottopercorsi (\d+) \(senza tratti (\d+)\), lineTo (\d+), cubiche (\d+), quadratiche (\d+), chiusure (\d+)/, t);
  const bp = num(/percorsi per pittura: stroke (\d+), fill (\d+), fillstroke (\d+), endPath (\d+)/, t);
  const view = /vista: \[([^\]]*)\] = ([\d.]+) x ([\d.]+) pt/.exec(t);
  return {
    cls: (/classe della pagina: (\w+)/.exec(t) || [])[1],
    ops: (num(/operazioni totali: (\d+)/, t) || [])[0],
    constructPath: (num(/constructPath: (\d+)/, t) || [])[0],
    images: (num(/operazioni immagine \(tutte\): (\d+)/, t) || [])[0],
    showText: (num(/showText \(e varianti\): (\d+)/, t) || [])[0],
    stroke: bp && bp[0],
    fill: bp && bp[1],
    fillstroke: bp && bp[2],
    endPath: bp && bp[3],
    paths: all && all[0],
    subpaths: all && all[1],
    emptySub: all && all[2],
    lineTo: all && all[3],
    cubic: all && all[4],
    close: all && all[6],
    circles: (num(/di 4 cubiche che rispettano la regola del cerchio, tutti i percorsi: (\d+)/, t) || [])[0],
    rotate: (num(/Rotate: (\d+)/, t) || [])[0],
    view: view && view[1],
    w: view && Number(view[2]),
    h: view && Number(view[3]),
    page: num(/pagina: (\d+) di (\d+)/, t),
    userUnit: (num(/UserUnit: ([\d.]+)/, t) || [])[0],
    heap: /heap JS[^\n]*: (.*)/.exec(t)?.[1],
    limit: /limite di sicurezza: (\w+)/.exec(t)?.[1],
  };
}
function compare(label, got, want) {
  for (const k of ['cls', 'ops', 'constructPath', 'images', 'showText', 'stroke', 'fill', 'fillstroke', 'endPath', 'paths', 'lineTo', 'cubic', 'close', 'rotate']) {
    if (want[k] === undefined) continue;
    check(`${label}: ${k} = ${want[k]}`, got[k] === want[k], `letto ${got[k]}`);
  }
  if (want.circles !== undefined) check(`${label}: 6 cerchi riconosciuti`, got.circles === want.circles, `letto ${got.circles}`);
  check(`${label}: dimensioni della vista ${want.w} x ${want.h} pt`, got.w !== null && near(got.w, want.w, 0.011) && near(got.h, want.h, 0.011), `letto ${got.w} x ${got.h}`);
  if (want.view) check(`${label}: vista [${want.view}]`, got.view === want.view, `letto [${got.view}]`);
  check(`${label}: UserUnit 1`, got.userUnit === 1, `letto ${got.userUnit}`);
}

// ---------------------------------------------------------------- PDF costruiti qui
async function builtPdf(content, opts = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(opts.mediabox || [600, 800]);
  const ctx = doc.context;
  const res = {};
  if (opts.ocgs) {
    const props = {};
    const refs = [];
    const on = [];
    const off = [];
    for (const g of opts.ocgs) {
      const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(g.name) }));
      refs.push(ref);
      (g.on ? on : off).push(ref);
      props[g.key] = ref;
    }
    doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: refs, D: { Order: refs, ON: on, OFF: off } }));
    res.Properties = props;
  }
  page.node.set(PDFName.of('Resources'), ctx.obj(res));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(content)));
  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- serie
async function cardSuite(browser) {
  setSection('scheda');
  const { ctx, page, errors } = await newDiag(browser, 'desk');
  check('la scheda "Geometria PDF" c\'e\' in Diagnostica', (await page.locator('.geo-card summary', { hasText: 'Geometria PDF' }).count()) === 1);
  check('"Apri PDF…" c\'e\' gia\' (non cambiato)', (await page.locator('.screen-diag label.btn', { hasText: 'Apri PDF…' }).count()) === 1);
  for (const n of ['Misura questa pagina', 'Misura tutte le pagine', 'Copia misura']) check(`pulsante "${n}"`, (await btn(page, n).count()) === 1);
  check('"Copia misura" disabilitato senza una misura', await btn(page, 'Copia misura').isDisabled());
  check('senza PDF lo stato dice di aprirne uno', /Nessun documento/.test(await status(page)), await status(page));
  await btn(page, 'Misura questa pagina').click();
  check('senza PDF "Misura questa pagina" avvisa e non misura', (await page.locator('.geo-warn').isVisible()) && /Nessun documento aperto/.test(await page.locator('.geo-warn').innerText()));
  // la misura non parte da sola
  await loadFile(page, `${SECRET}.pdf`, readFileSync(join(PDF_DIR, 'a4-vettoriale.pdf')));
  await page.waitForTimeout(1500);
  check('aperto un PDF, la misura NON parte da sola (nessun dettaglio)', await page.locator('.geo-detail').isHidden());
  check('aperto un PDF, la misura NON parte da sola (nessuna riga di registro)', !/Misura geometria/.test(await logText(page)));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function fileSuite(browser, kind) {
  const { ctx, page, errors } = await newDiag(browser, kind);
  for (const [file, want] of FILES) {
    setSection(`${file}, ${kind === 'phone' ? '390 x 780' : '1280 x 900'}`);
    const name = `${SECRET}-${file}`;
    check(`${file}: aperto con "Apri PDF…"`, await loadFile(page, name, readFileSync(join(PDF_DIR, file))));
    const st = await press(page, 'Misura questa pagina', MEASURED);
    check(`${file}: stato dopo la misura`, /^Misurata 1 pagina in /.test(st), st);
    const t = await detail(page);
    const got = parse(t);
    compare(file, got, want);
    check(`${file}: pagina 1 di 1`, got.page && got.page[0] === 1 && got.page[1] === 1, JSON.stringify(got.page));
    check(`${file}: il dettaglio non contiene il nome del file`, !t.includes(SECRET) && !t.includes(file), '');
    if (file === 'a4-scansione.pdf') {
      check(`${file}: classe "scansione" con 0 percorsi`, got.cls === 'scansione' && got.paths === 0);
    }
    check(`${file}: "Copia misura" abilitato`, await btn(page, 'Copia misura').isEnabled());
  }
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function pagesSuite(browser, kind) {
  setSection(`misto-3-pagine.pdf, ${kind === 'phone' ? '390 x 780' : '1280 x 900'}`);
  const { ctx, page, errors } = await newDiag(browser, kind);
  const name = `${SECRET}-misto.pdf`;
  check('aperto', await loadFile(page, name, readFileSync(join(PDF_DIR, 'misto-3-pagine.pdf'))));
  // ogni pagina con "Misura questa pagina" (la pagina si sceglie con i pulsanti del visore)
  for (let n = 1; n <= 3; n++) {
    if (n > 1) {
      await page.getByRole('button', { name: 'Pagina successiva' }).click();
      await page.waitForTimeout(300);
    }
    await press(page, 'Misura questa pagina', MEASURED);
    const got = parse(await detail(page));
    check(`pagina ${n}: numero di pagina letto`, got.page && got.page[0] === n && got.page[1] === 3, JSON.stringify(got.page));
    compare(`pagina ${n}`, got, MISTO_PAGES[n - 1]);
  }
  // tutte le pagine: 3 righe
  const st = await press(page, 'Misura tutte le pagine', MEASURED);
  check('"Misura tutte le pagine": stato "Misurate 3 pagine"', /^Misurate 3 pagine in /.test(st), st);
  const rows = (await page.locator('.geo-summary').innerText()).split('\n').filter((l) => l.trim());
  check('"Misura tutte le pagine": 3 righe', rows.length === 3, JSON.stringify(rows));
  const rowRe = /^pagina (\d): vettoriale · percorsi 15 · segmenti 36 · (\d+) ms · Rotate (0|90) · ([\d.]+) x ([\d.]+) pt$/;
  rows.forEach((r, i) => {
    const m = rowRe.exec(r);
    check(`riga ${i + 1}: percorsi, segmenti, millisecondi, Rotate e dimensioni`, !!m && Number(m[1]) === i + 1 && Number(m[3]) === MISTO_PAGES[i].rotate && near(Number(m[4]), MISTO_PAGES[i].w, 0.06) && near(Number(m[5]), MISTO_PAGES[i].h, 0.06), r);
  });
  const opts = await page.locator('.geo-picker option').allInnerTexts();
  check('l\'elenco del dettaglio ha 3 pagine', opts.length === 3, JSON.stringify(opts));
  await page.locator('.geo-picker').selectOption({ label: 'pagina 3' });
  const g3 = parse(await detail(page));
  check('scelta la pagina 3, il dettaglio e\' quello della pagina 3 (Rotate 90)', g3.page && g3.page[0] === 3 && g3.rotate === 90, JSON.stringify(g3.page));
  // copia: sintesi di tutte le pagine e dettaglio della pagina scelta
  await btn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const copied = await page.evaluate(() => window.__copied.at(-1));
  check('copia: 3 righe di sintesi e il dettaglio della pagina 3', copied.includes('pagine misurate: 3 di 3') && copied.includes('--- dettaglio della pagina 3 ---') && /pagina: 3 di 3/.test(copied), '');
  check('"Misura tutte le pagine" non cambia la pagina mostrata dal visore', /3 \/ 3/.test(await page.locator('.screen-diag .num', { hasText: '/' }).first().innerText()));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function copySuite(browser, kind) {
  setSection(`Copia misura, ${kind === 'phone' ? '390 x 780' : '1280 x 900'}`);
  const { ctx, page, errors } = await newDiag(browser, kind);
  const file = 'a4-rotate90.pdf';
  const name = `${SECRET}-${file}`;
  await loadFile(page, name, readFileSync(join(PDF_DIR, file)));
  await press(page, 'Misura questa pagina', MEASURED);
  await btn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const text = await page.evaluate(() => window.__copied.at(-1));
  const lines = text.split('\n');
  check('testo copiato: prima riga con versione dell\'app e di PDF.js', lines[0].startsWith('GT-Pdf ') && lines[0].includes(`PDF.js ${PDFJS_VERSION}`), lines[0]);
  check('testo copiato: pagina, Rotate, vista e UserUnit', /^pagina: 1 di 1$/m.test(text) && /^Rotate: 90$/m.test(text) && /^vista: \[0 0 595\.276 841\.89\] = 841\.89 x 595\.28 pt/m.test(text) && /^UserUnit: 1$/m.test(text), '');
  check('testo copiato: NON contiene il nome del file', !text.includes(SECRET) && !text.includes(file) && !/\.pdf/i.test(text), '');
  check('testo copiato: NON contiene i metadati del documento', META_STRINGS.every((s) => !text.includes(s)), META_STRINGS.filter((s) => text.includes(s)).join(','));
  check('testo copiato: una voce per riga, nessuna riga vuota', lines.every((l) => l.trim().length > 0 && /[:·]/.test(l)), '');
  check('testo copiato: numeri sempre con il punto', !/\d,\d/.test(text), '');
  check('testo copiato: uguale al dettaglio mostrato piu\' l\'intestazione', text.endsWith(await detail(page)) || text.includes(await detail(page)), '');
  const shown = parse(await detail(page));
  const copiedParsed = parse(text);
  check('testo copiato: stessi numeri della scheda', shown.ops === copiedParsed.ops && shown.paths === copiedParsed.paths && shown.cubic === copiedParsed.cubic, '');
  const log = await logText(page);
  check('il registro conserva la riga Apertura "<nome>" com\'era (Copia registro include il nome del file)', log.includes(`Apertura "${name}"`) && log.includes('[OK] Aperto: 1 pagine'), '');
  const geoLines = log.split('\n').filter((l) => /Misura geometria/.test(l));
  check('le righe di registro della misura ci sono e NON contengono il nome del file', geoLines.length >= 2 && geoLines.every((l) => !l.includes(SECRET) && !l.includes(file)), JSON.stringify(geoLines));
  check('stato dopo la copia', /Misura copiata negli appunti/.test(await status(page)), await status(page));
  // copia automatica che fallisce: area di ripiego con lo stesso testo, selezionata
  await page.evaluate(() => (window.__clipMode = 'fail'));
  await btn(page, 'Copia misura').click();
  await page.locator('.geo-fallback').waitFor({ state: 'visible' });
  const fb = await page.locator('.geo-fallback').inputValue();
  check('copia fallita: l\'area di ripiego ha lo stesso testo', fb === text, `${fb.length} contro ${text.length}`);
  const sel = await page.evaluate(() => {
    const t = document.querySelector('.geo-fallback');
    return { all: t.selectionStart === 0 && t.selectionEnd === t.value.length, focus: document.activeElement === t };
  });
  check('copia fallita: il testo e\' selezionato', sel.all && sel.focus, JSON.stringify(sel));
  check('copia fallita: lo stato lo dice e nel registro compare l\'errore', /Copia automatica non riuscita/.test(await status(page)) && /copia automatica non riuscita/.test(await logText(page)), '');
  // altro PDF: i numeri letti appartengono al documento di prima
  await page.evaluate(() => (window.__clipMode = 'ok'));
  await loadFile(page, 'altro.pdf', readFileSync(join(PDF_DIR, 'a4-scansione.pdf')));
  check('aperto un altro PDF, la scheda riparte (nessun dettaglio, nessuna copia)', (await page.locator('.geo-detail').isHidden()) && (await btn(page, 'Copia misura').isDisabled()), '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function layersSuite(browser) {
  setSection('livelli');
  const { ctx, page, errors } = await newDiag(browser, 'desk');
  const p = (n) => `${n} ${n} m ${n + 1} ${n + 1} l S`;
  const content = ['/OC /Loff BDC', p(1), '/OC /Lon BDC', p(2), 'EMC', '/Foo BMC', p(3), 'EMC', 'EMC', '/OC /Lon BDC', p(4), '/OC /Loff BDC', p(5), 'EMC', '/Span <</MCID 3>> BDC', p(6), 'EMC', 'EMC', p(7)].join('\n');
  const bytes = await builtPdf(content, {
    ocgs: [
      { key: 'Loff', name: 'SEGRETO-LIVELLO-1', on: false },
      { key: 'Lon', name: 'SEGRETO-LIVELLO-2', on: true },
    ],
  });
  check('PDF con livelli aperto', await loadFile(page, 'livelli.pdf', bytes));
  await press(page, 'Misura questa pagina', MEASURED);
  const t = await detail(page);
  check('gruppi OCG del documento: 2, spenti 1', /livelli del documento: gruppi OCG 2, spenti nella configurazione predefinita 1/.test(t), '');
  check('marcatori OC: 4 (tutti OCG)', /marcatori OC: 4 \(OCG 4, OCMD 0 di cui spenti 0, dati null 0/.test(t), '');
  check('profondita\' massima dei marcatori 2', /profondita' massima dei marcatori: 2/.test(t), '');
  check('7 percorsi, 4 dentro livelli spenti (spento, acceso dentro spento, BMC dentro spento, spento dentro acceso)', /dentro livelli spenti: percorsi 4 \(candidati 4\), segmenti dei candidati 4/.test(t) && parse(t).paths === 7, '');
  check('i nomi dei livelli non compaiono', !t.includes('SEGRETO'), '');
  await btn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  check('copia: i nomi dei livelli non compaiono', !(await page.evaluate(() => window.__copied.at(-1))).includes('SEGRETO'), '');
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function bigSuite(browser) {
  setSection('PDF grande (100.000 segmenti)');
  const { ctx, page, errors } = await newDiag(browser, 'desk');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const parts = [];
  for (let i = 0; i < 1000; i++) {
    parts.push(`${(rnd() * 2384).toFixed(3)} ${(rnd() * 3370).toFixed(3)} m`);
    for (let k = 0; k < 100; k++) parts.push(`${(rnd() * 2384).toFixed(3)} ${(rnd() * 3370).toFixed(3)} l`);
    parts.push('S');
  }
  const bytes = await builtPdf(parts.join('\n'), { mediabox: [2384, 3370] });
  info(`PDF costruito: ${(bytes.length / 1048576).toFixed(2)} MB`);
  check('aperto', await loadFile(page, 'grande.pdf', bytes));
  const t0 = Date.now();
  await btn(page, 'Misura questa pagina').click();
  // durante la misura lo stato dice "in corso" (la scheda non parte da sola e non e' ferma)
  const inCorso = await page.waitForFunction(() => /in corso/.test(document.querySelector('.geo-status').innerText), null, { timeout: 5000 }).then(() => true, () => false);
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.geo-status').innerText), MEASURED, { timeout: 60000 });
  info(`misura di 100.000 segmenti: ${Date.now() - t0} ms in Chromium del contenitore (NON vale per il browser o l'iPhone dell'utente)`);
  check("la scheda ha mostrato \"in corso\" prima del risultato (o era gia' finita)", inCorso || /^Misurata/.test(await status(page)), '');
  const t = await detail(page);
  const got = parse(t);
  check('1000 percorsi, 100.000 lineTo, 1000 sottopercorsi, classe vettoriale', got.paths === 1000 && got.lineTo === 100000 && got.subpaths === 1000 && got.cls === 'vettoriale' && got.constructPath === 1000, JSON.stringify(got));
  const hist = /sotto 0\.01: (\d+) · 0\.01-0\.1: (\d+) · 0\.1-1: (\d+) · 1-10: (\d+) · 10 e oltre: (\d+)/.exec(t);
  check('istogramma delle lunghezze: somma 100.000', !!hist && hist.slice(1).map(Number).reduce((a, b) => a + b, 0) === 100000, hist ? hist[0] : '');
  check('byte stimati delle primitive: 100.000 segmenti x 20 + 1000 percorsi x 2 = 2002000', /= 2002000 byte stimati/.test(t), '');
  check('limite di sicurezza non scattato', /limite di sicurezza: non scattato/.test(t), '');
  check('heap JS: riportato (Chromium) con prima e dopo', /heap JS \(performance\.memory, solo Chromium\): prima [\d.]+ MB, dopo [\d.]+ MB/.test(t), got.heap);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function errorsSuite(browser) {
  setSection('PDF non valido o danneggiato');
  const { ctx, page, errors } = await newDiag(browser, 'desk');
  const good = readFileSync(join(PDF_DIR, 'a4-vettoriale.pdf'));
  // 1. non e' un PDF
  check('un file che non e\' un PDF: apertura fallita (e non si rompe)', !(await loadFile(page, 'non-un-pdf.pdf', Buffer.from('questo non e un pdf, solo testo'))));
  await btn(page, 'Misura questa pagina').click();
  check('dopo l\'apertura fallita "Misura questa pagina" avvisa che manca un documento', /Nessun documento aperto/.test(await page.locator('.geo-warn').innerText()), '');
  check('la scheda e i pulsanti restano usabili', await btn(page, 'Misura questa pagina').isEnabled(), '');
  // 2. PDF troncato (la sola testata)
  check('un PDF troncato: apertura fallita', !(await loadFile(page, 'troncato.pdf', good.subarray(0, 300))));
  check('ancora usabile dopo il PDF troncato', await btn(page, 'Misura questa pagina').isEnabled(), '');
  // 3. flusso del contenuto danneggiato: PDF.js lo apre; la misura finisce con un numero o con un errore, mai bloccata
  const bad = Buffer.from(good);
  const at = bad.indexOf('stream\n', bad.indexOf('/FlateDecode')) + 7;
  for (let i = 0; i < 40; i++) bad[at + 10 + i] = (bad[at + 10 + i] ^ 0x5a) & 0xff;
  const opened = await loadFile(page, 'flusso-danneggiato.pdf', bad);
  info(`flusso danneggiato: ${opened ? 'PDF.js lo apre' : 'PDF.js non lo apre'}`);
  if (opened) {
    const st = await press(page, 'Misura questa pagina', MEASURED);
    info(`flusso danneggiato, esito della misura: ${st}`);
    check('flusso danneggiato: la misura finisce (numero o errore) e la scheda e\' di nuovo usabile', (await btn(page, 'Misura questa pagina').isEnabled()) && !/in corso/.test(await status(page)), await status(page));
  }
  // 4. dopo tutto questo un PDF buono si misura
  check('un PDF buono si apre dopo gli errori', await loadFile(page, 'buono.pdf', good));
  await press(page, 'Misura questa pagina', MEASURED);
  const got = parse(await detail(page));
  check('e si misura come prima (160 operazioni, 15 percorsi)', got.ops === 160 && got.paths === 15 && got.cls === 'vettoriale', JSON.stringify(got));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function layoutSuite(browser) {
  setSection('layout a 390 px');
  const { ctx, page, errors } = await newDiag(browser, 'phone');
  const sw = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth }));
  check('prima di aprire un PDF: nessuno scorrimento orizzontale', (await sw()).sw <= 390, JSON.stringify(await sw()));
  await loadFile(page, `${SECRET}.pdf`, readFileSync(join(PDF_DIR, 'misto-3-pagine.pdf')));
  await press(page, 'Misura tutte le pagine', MEASURED);
  await btn(page, 'Copia misura').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const o = await sw();
  check('dopo "Misura tutte le pagine" e "Copia misura": nessuno scorrimento orizzontale della pagina', o.sw <= o.iw && o.bw <= o.iw, JSON.stringify(o));
  await page.evaluate(() => (window.__clipMode = 'fail'));
  await btn(page, 'Copia misura').click();
  await page.locator('.geo-fallback').waitFor({ state: 'visible' });
  const o2 = await sw();
  check('con l\'area di ripiego aperta: nessuno scorrimento orizzontale', o2.sw <= o2.iw, JSON.stringify(o2));
  const geo = await page.evaluate(() => {
    const c = document.querySelector('.geo-card');
    const r = c.getBoundingClientRect();
    const boxes = [...c.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect()).map((b) => ({ l: b.left, r: b.right, h: b.height }));
    return { sw: c.scrollWidth, cw: c.clientWidth, left: r.left, right: r.right, boxes };
  });
  check('la scheda sta dentro la finestra', geo.left >= 0 && geo.right <= 390.5 && geo.sw <= geo.cw + 1, JSON.stringify({ l: geo.left, r: geo.right, sw: geo.sw, cw: geo.cw }));
  check('i pulsanti stanno dentro la finestra e si toccano (altezza >= 32 px)', geo.boxes.every((b) => b.l >= 0 && b.r <= 390.5 && b.h >= 32), JSON.stringify(geo.boxes));
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const only_ = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only_ || only_.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su 1395749, dove la scheda non esiste) lo dice con un controllo fallito e le altre proseguono.
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
    await guarded('scheda', 'scheda', () => cardSuite(browser));
    for (const kind of ['desk', 'phone']) {
      await guarded('file', `7 PDF di prova, ${kind}`, () => fileSuite(browser, kind));
      await guarded('pagine', `tutte le pagine, ${kind}`, () => pagesSuite(browser, kind));
      await guarded('copia', `Copia misura, ${kind}`, () => copySuite(browser, kind));
    }
    await guarded('livelli', 'livelli', () => layersSuite(browser));
    await guarded('grande', 'PDF grande', () => bigSuite(browser));
    await guarded('errori', 'errori', () => errorsSuite(browser));
    await guarded('layout', 'layout', () => layoutSuite(browser));
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
