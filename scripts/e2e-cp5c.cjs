// Prove di CP5c su Chromium: Annulla in "Appiattito", progetto .json (Salva con nome, Apri progetto), modifiche non salvate.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5c.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
// Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const { fullSpecs } = require('./export-specs.cjs');

const lib = createE2E({ name: 'e2e-cp5c', out: process.argv[2], port: 4193, hport: 4194, zoom: 2 });
const { check, info, setSection, sha, newApp, openSample } = lib;

const dlg = (page) => page.locator('.export-dialog');
const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());
async function openExportDialog(page) {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.locator('.menu-item', { hasText: 'Esporta PDF' }).click();
  await dlg(page).waitFor();
}
async function pickFlat(page, dpi, format) {
  await dlg(page).locator('label[data-value="flat"]').click();
  if (dpi) await dlg(page).locator(`label[data-value="${dpi}"]`).click();
  if (format) await dlg(page).locator(`label[data-value="${format}"]`).click();
}

// Tiene traccia dei canvas creati dall'esportazione e delle righe di avanzamento; quando compare `autoCancelAt` preme "Annulla" nel dialogo.
const INIT_TRACK = `(() => {
  window.__cv = { on: false, list: [] };
  const ce = document.createElement.bind(document);
  document.createElement = (t, o) => { const e = ce(t, o); if (window.__cv.on && String(t).toLowerCase() === 'canvas') window.__cv.list.push(e); return e; };
  window.__prog = [];
  window.__cancelBtn = null;
  window.__autoCancelAt = null;
  new MutationObserver(() => {
    const dlg = document.querySelector('.export-dialog');
    if (!dlg) return;
    const el = dlg.querySelector('[role=status]');
    const t = el ? el.textContent : '';
    if (window.__prog.length === 0 || window.__prog[window.__prog.length - 1] !== t) window.__prog.push(t);
    const btn = [...dlg.querySelectorAll('.dialog-actions .btn')].find((b) => b.textContent.trim() === 'Annulla');
    if (btn && !window.__cancelBtn && t) window.__cancelBtn = { disabled: btn.disabled, h: btn.getBoundingClientRect().height, text: t };
    if (window.__autoCancelAt && t.includes(window.__autoCancelAt) && btn && !btn.disabled) { window.__autoCancelAt = null; btn.click(); }
  }).observe(document, { subtree: true, childList: true, characterData: true });
})();`;

async function annullaSuite(browser) {
  setSection('Annulla in Appiattito');
  const { ctx, page } = await newApp(browser, { init: INIT_TRACK, viewport: { width: 1280, height: 900 } });
  try {
    await openSample(page, '3 pagine miste');
    for (let n = 1; n <= 3; n++) await page.evaluate(({ n: k, specs }) => { window.__gtpdf.setScale(k, 0.5); window.__gtpdf.addSpecs(k, specs); }, { n, specs: fullSpecs() });
    const objectsBefore = await page.evaluate(() => window.__gtpdf.objectCount());
    const before = await sha(page, 'window.__gtpdf.originalBytes()');
    let downloads = 0;
    page.on('download', () => downloads++);

    await openExportDialog(page);
    await pickFlat(page, '300', 'jpeg');
    await page.evaluate(() => { window.__cv.on = true; window.__prog.length = 0; window.__cancelBtn = null; window.__autoCancelAt = 'Pagina 2 di 3'; });
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-cancelled').waitFor({ timeout: 120000 });
    await page.evaluate(() => { window.__cv.on = false; });
    const body = await text(dlg(page));
    const prog = await page.evaluate(() => window.__prog);
    const btn = await page.evaluate(() => window.__cancelBtn);
    info(`righe di avanzamento: ${JSON.stringify(prog)}; pulsante Annulla in generazione: ${JSON.stringify(btn)}`);
    check('in generazione "Appiattito" il pulsante Annulla e\' attivo ed e\' alto almeno 44 px', btn && btn.disabled === false && btn.h >= 44, JSON.stringify(btn));
    check('si e\' vista la pagina 2 di 3 e la riga "Annullamento: finisco la pagina in corso…"', prog.some((p) => p.includes('Pagina 2 di 3')) && prog.some((p) => p.includes('Annullamento: finisco la pagina in corso')), JSON.stringify(prog));
    check('la pagina 3 NON e\' partita (nessuna riga "Pagina 3 di 3")', !prog.some((p) => p.includes('Pagina 3 di 3')), JSON.stringify(prog));
    check('il dialogo torna alla scelta con "Esportazione annullata. Nulla è stato scritto."', (await dlg(page).locator('.exp-cancelled').innerText()).trim() === 'Esportazione annullata. Nulla è stato scritto.', body);
    const radios = await page.$$eval('.export-dialog input[type=radio]', (els) => els.filter((e) => e.checked).map((e) => `${e.name}=${e.value}`));
    check('restano scelti Appiattito, 300 dpi, JPEG', radios.includes('exp-mode=flat') && radios.includes('exp-dpi=300') && radios.includes('exp-fmt=jpeg'), radios.join(', '));
    check('nessun file offerto (ne\' Condividi ne\' Scarica) e nessun scarico', (await dlg(page).locator('.btn', { hasText: /Condividi|Scarica/ }).count()) === 0 && downloads === 0);
    check('byte dell\'originale identici (SHA-256 nel browser)', (await sha(page, 'window.__gtpdf.originalBytes()')) === before);
    check('gli oggetti restano (il dialogo e il modello li contano ancora)', body.includes(`Oggetti ${objectsBefore}`) && (await page.evaluate(() => window.__gtpdf.objectCount())) === objectsBefore, `${objectsBefore} / ${body}`);
    const cv = await page.evaluate(() => window.__cv.list.filter((c) => !c.isConnected).map((c) => [c.width, c.height]));
    const big = cv.filter(([w]) => w > 1);
    info(`canvas creati durante l'esportazione e non nel documento: ${cv.length}; ancora grandi: ${big.length}`);
    check('canvas rilasciati: nessuno di quelli creati dall\'esportazione e\' piu\' largo di 1 px', cv.length > 0 && big.length === 0, JSON.stringify(big.slice(0, 5)));

    // si puo' riesportare dallo stesso dialogo, e finisce
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    const done = await text(dlg(page).locator('.exp-summary'));
    check('riesportando dallo stesso dialogo l\'esportazione finisce: 3 pagine appiattite', /Pagine 3 \(3 appiattite\)/.test(done), done);
    check('byte dell\'originale ancora identici dopo la riesportazione', (await sha(page, 'window.__gtpdf.originalBytes()')) === before);
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();

    // "Copertura semplice": il pulsante Annulla resta disattivato (non si annulla: dura meno di 1.1 s)
    await openExportDialog(page);
    await page.evaluate(() => { window.__prog.length = 0; window.__cancelBtn = null; });
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 60000 });
    const sbtn = await page.evaluate(() => window.__cancelBtn);
    check('in "Copertura semplice" il pulsante Annulla resta disattivato durante la generazione', sbtn && sbtn.disabled === true, JSON.stringify(sbtn));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();

    // annullato prima della prima pagina: si preme Annulla appena compare "Pagina 1 di 3"
    await openExportDialog(page);
    await pickFlat(page, '150', 'png');
    await page.evaluate(() => { window.__prog.length = 0; window.__cancelBtn = null; window.__autoCancelAt = 'Pagina 1 di 3'; });
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-cancelled').waitFor({ timeout: 120000 });
    const p2 = await page.evaluate(() => window.__prog);
    check('annullato alla pagina 1 di 3: la pagina 1 finisce, la 2 non parte', !p2.some((p) => p.includes('Pagina 2 di 3')), JSON.stringify(p2));
    check('byte dell\'originale identici anche dopo il secondo annullamento', (await sha(page, 'window.__gtpdf.originalBytes()')) === before);
    await dlg(page).locator('.btn', { hasText: 'Annulla' }).click();
    check('"Annulla" nella scelta chiude il dialogo', (await page.locator('.export-dialog').count()) === 0);
  } finally {
    await ctx.close();
  }
}

// La casella spuntata del PDF di prova "A4 con annotazioni" (5c, correzione): PDF.js la deve disegnare spuntata, nell'app e in "Appiattito".
async function casellaSuite(browser, harness) {
  setSection('casella spuntata');
  const L = await import('@cantoo/pdf-lib');
  const fs = require('node:fs');
  const path = require('node:path');
  const sample = fs.readFileSync(path.join(__dirname, '..', 'public', 'test-pdfs', 'a4-annotazioni.pdf'));
  // casella: x 270..294, y 700..724 (spazio utente, origine in basso a sinistra); a 2 px/pt e dall'alto: x 540..588, y 235.8..283.8; si guarda l'interno (6 px dal bordo)
  const R = [548, 244, 580, 276];
  const THR = 128;
  const dark = (hp, url) => hp.evaluate(([u, r, t]) => window.darkCount(u, r[0], r[1], r[2], r[3], t), [url, R, THR]);
  const doc = await L.PDFDocument.load(sample);
  const field = doc.getForm().getCheckBox('casella-prova');
  const w = field.acroField.getWidgets()[0];
  check('il file di prova: il campo e\' spuntato e il widget ha /AS = /Yes (non /Off)', field.isChecked() && String(w.dict.get(L.PDFName.of('AS'))) === '/Yes', `${field.isChecked()} ${String(w.dict.get(L.PDFName.of('AS')))}`);
  const hp = await harness.newPage();
  await hp.goto(`http://localhost:${lib.HPORT}/`);
  await hp.waitForFunction(() => window.harnessReady === true);
  // controllo: la stessa pagina con la casella tolta (/AS /Off) NON deve avere pixel scuri dentro: la misura distingue
  field.uncheck();
  const unchecked = Buffer.from(await doc.save({ useObjectStreams: false }));
  const dOff = await dark(hp, await hp.evaluate(([d, s]) => window.renderPage(d, 1, s), [lib.b64(unchecked), 2]));
  const dOn = await dark(hp, await hp.evaluate(([d, s]) => window.renderPage(d, 1, s), [lib.b64(sample), 2]));
  info(`pixel scuri nell'interno della casella (PDF.js, 2 px/pt): spuntata ${dOn}, non spuntata (controllo) ${dOff}`);
  check('PDF.js disegna la casella spuntata (segno dentro) e vuota quella con /AS /Off: la misura distingue', dOn >= 30 && dOff === 0, `${dOn} / ${dOff}`);

  const { ctx, page } = await newApp(browser); // viewport predefinito (2800 x 2000): il canvas a 2 px/pt deve stare per intero, altrimenti lo screenshot si taglia
  try {
    await openSample(page, 'A4 con annotazioni');
    await lib.showPage(page, 1);
    const appShot = (await lib.shot(page)).buf;
    const dApp = await dark(hp, `data:image/png;base64,${lib.b64(appShot)}`);
    check('nell\'app la casella e\' spuntata (segno dentro)', dApp >= 30, String(dApp));
    // un oggetto lontano dalla casella, poi Appiattito (150 dpi PNG) dall'interfaccia
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.2], [0.4, 0.22]] }]));
    await openExportDialog(page);
    await pickFlat(page, '150', 'png');
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
    const out = fs.readFileSync(await dl.path());
    const dFlat = await dark(hp, await hp.evaluate(([d, s]) => window.renderPage(d, 1, s), [lib.b64(out), 2]));
    check('nel PDF appiattito la casella e\' spuntata (segno dentro)', dFlat >= 30, String(dFlat));
    info(`pixel scuri nell'interno della casella: app ${dApp}, appiattito ${dFlat}`);
  } finally {
    await hp.close();
    await ctx.close();
  }
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  try {
    await annullaSuite(browser);
    await casellaSuite(browser, harness);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
