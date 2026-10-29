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

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    await annullaSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
