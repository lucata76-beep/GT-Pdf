// Misura di tempo del progetto .json su un PDF SINTETICO di 124 pagine (circa 22 MB, non nel repository) con circa 2350 oggetti (19 per pagina) e una scala per pagina:
// dimensione del .json, tempo di salvataggio (impronta SHA-256 su 21 MB, scrittura, rilettura) e di riapertura (lettura e validazione del .json, apertura del PDF, impronta, confronto, applicazione).
// Misura in CHROMIUM DESKTOP (questo contenitore), NON su iPhone: i numeri non valgono per il telefono.
// Uso: node scripts/perf-cp5c.cjs [cartella-di-lavoro]   (build di prova con GTPDF_TEST=1 fuori dal repository)
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const nodeCrypto = require('node:crypto');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const { fullSpecs } = require('./export-specs.cjs');

const lib = createE2E({ name: 'perf-cp5c', out: process.argv[2], port: 4199, hport: 4200, zoom: 2 });
const { OUT, newApp, check, setSection, sha } = lib;
const PAGES = 124;

async function makePdf() {
  const { PDFDocument, PDFName, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let p = 0; p < PAGES; p++) {
    const [w, h] = p % 3 === 1 ? [1190.551, 841.89] : [595.276, 841.89];
    const page = doc.addPage([w, h]);
    const img = new Uint8Array(410 * 410);
    for (let i = 0; i < img.length; i++) img[i] = (rnd() * 256) | 0; // rumore: non si comprime
    const imgRef = doc.context.register(doc.context.stream(img, { Type: 'XObject', Subtype: 'Image', Width: 410, Height: 410, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    const imName = page.node.newXObject('Im1', imgRef);
    const ops = [`q ${w * 0.3} 0 0 ${w * 0.3} ${w * 0.35} ${h * 0.35} cm /${imName.decodeText()} Do Q`, '0.3 w'];
    let x = w * 0.5;
    let y = h * 0.5;
    for (let i = 0; i < 1500; i++) {
      const nx = Math.min(w - 10, Math.max(10, x + (rnd() - 0.5) * 60));
      const ny = Math.min(h - 10, Math.max(10, y + (rnd() - 0.5) * 60));
      ops.push(`${x.toFixed(2)} ${y.toFixed(2)} m ${nx.toFixed(2)} ${ny.toFixed(2)} l S`);
      x = nx;
      y = ny;
    }
    for (let i = 0; i < 20; i++) ops.push(`BT /F1 8 Tf 20 ${h - 20 - i * 10} Td (Riga di testo sintetica numero ${i} pagina ${p + 1}) Tj ET`);
    page.node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(doc.context.flateStream(ops.join('\n')))]));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  setSection('prestazioni del progetto');
  const pdf = await makePdf();
  writeFileSync(join(OUT, 'sintetico-124-pagine.pdf'), pdf); // fuori dal repository (e *.pdf e' comunque ignorato)
  const nodeT0 = performance.now();
  const nodeSha = nodeCrypto.createHash('sha256').update(pdf).digest('hex');
  const nodeMs = performance.now() - nodeT0;
  console.log(`PDF sintetico: ${PAGES} pagine, ${(pdf.length / 1024 / 1024).toFixed(2)} MB; SHA-256 in Node: ${nodeMs.toFixed(0)} ms`);
  const servers = await lib.startAll(chromium);
  try {
    const { ctx, page } = await newApp(servers.browser, { viewport: { width: 1280, height: 900 } });
    await page.setInputFiles('input.file-hidden', { name: 'sintetico-124-pagine.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const t0 = Date.now();
    for (let k = 1; k <= PAGES; k++) await page.evaluate(({ k: p, specs, mm }) => { window.__gtpdf.setScale(p, mm); window.__gtpdf.addSpecs(p, specs); }, { k, specs: fullSpecs(), mm: 0.35277777777777775 + k / 1000 });
    const objects = await page.evaluate(() => window.__gtpdf.objectCount());
    console.log(`${objects} oggetti e ${PAGES} scale messi in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    // 1) il progetto senza interfaccia: impronta, scrittura, rilettura (5 prove)
    const runs = [];
    let text = '';
    for (let i = 0; i < 5; i++) {
      const r = await page.evaluate(() => window.__gtpdf.projectText());
      runs.push(r);
      text = r.text;
    }
    const kb = Buffer.byteLength(text) / 1024;
    const hashMs = median(runs.map((r) => r.hashMs));
    const writeMs = median(runs.map((r) => r.writeMs));
    const readMs = median(runs.map((r) => r.readMs));
    check('il progetto si rilegge valido', runs.every((r) => r.ok && r.hashed));
    const j = JSON.parse(text);
    check('l\'impronta nel progetto e\' quella calcolata in Node', j.pdf.sha256 === nodeSha, `${j.pdf.sha256} / ${nodeSha}`);
    console.log(`\nDimensione del .json: ${kb.toFixed(0)} kB (${(kb / objects * 1024).toFixed(0)} byte per oggetto, ${objects} oggetti, ${PAGES} pagine)`);
    console.log(`Senza interfaccia (mediana di 5): SHA-256 di ${(pdf.length / 1024 / 1024).toFixed(1)} MB ${hashMs.toFixed(0)} ms [${runs.map((r) => r.hashMs.toFixed(0)).join(', ')}]; scrittura ${writeMs.toFixed(0)} ms [${runs.map((r) => r.writeMs.toFixed(0)).join(', ')}]; lettura e validazione ${readMs.toFixed(0)} ms [${runs.map((r) => r.readMs.toFixed(0)).join(', ')}]`);

    // 2) dall'interfaccia: File > Salva con nome > Salva (dal clic a "Progetto pronto"), poi Scarica
    const uiSave = [];
    let bytes = null;
    for (let i = 0; i < 3; i++) {
      await page.locator('.menu-btn', { hasText: 'File' }).click();
      await page.locator('.menu-item').filter({ hasText: /^Salva con nome/ }).click();
      const d = page.locator('.save-dialog');
      await d.waitFor();
      const s0 = Date.now();
      await d.locator('.btn.primary', { hasText: 'Salva' }).click();
      await d.locator('.exp-done-actions').waitFor({ timeout: 120000 });
      uiSave.push(Date.now() - s0);
      const dialogTime = (await d.locator('.exp-summary').innerText()).replace(/\s+/g, ' ');
      if (i === 0) console.log(`Dialogo "Progetto pronto": ${dialogTime}`);
      const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
      bytes = readFileSync(await dl.path());
      await d.locator('.btn', { hasText: 'Chiudi' }).click();
    }
    console.log(`Salva dall'interfaccia (dal clic a "Progetto pronto", 3 prove): ${median(uiSave)} ms [${uiSave.join(', ')}]`);
    check('il file scaricato e\' uguale a quello senza interfaccia (stessa dimensione)', bytes.length === Buffer.byteLength(text), `${bytes.length} / ${Buffer.byteLength(text)}`);
    writeFileSync(join(OUT, 'sintetico-124-pagine.json'), bytes);

    // 3) riapertura: Chiudi, Apri progetto (lettura e validazione del .json), Scegli il PDF (apertura, impronta, confronto, applicazione)
    const stateBefore = await page.evaluate(() => JSON.stringify(window.__gtpdf.state().pages));
    const reopen = [];
    const readJson = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('.menu-btn', { hasText: 'File' }).click();
      await page.locator('.menu-item').filter({ hasText: /^Chiudi/ }).click();
      await page.waitForFunction(() => window.__gtpdf.pages().length === 0);
      const first = page.waitForEvent('filechooser');
      await page.locator('.menu-btn', { hasText: 'File' }).click();
      await page.locator('.menu-item').filter({ hasText: /^Apri progetto/ }).click();
      const c1 = await first;
      const a0 = Date.now();
      await c1.setFiles(join(OUT, 'sintetico-124-pagine.json')); // dal percorso: niente trasferimento di byte da Playwright nel tempo misurato
      await page.locator('.open-project-dialog').waitFor();
      readJson.push(Date.now() - a0);
      const second = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      const c2 = await second;
      const b0 = Date.now();
      await c2.setFiles(join(OUT, 'sintetico-124-pagine.pdf'));
      await page.locator('.open-project-dialog').waitFor({ state: 'detached', timeout: 120000 });
      reopen.push(Date.now() - b0);
    }
    const stateAfter = await page.evaluate(() => JSON.stringify(window.__gtpdf.state().pages));
    check('dopo tre riaperture lo stato e\' identico a quello di partenza (124 pagine, oggetti e scale)', stateBefore === stateAfter);
    check('l\'originale riaperto ha gli stessi byte', (await sha(page, 'window.__gtpdf.originalBytes()')) === `${pdf.length}:${nodeSha}`);
    console.log(`Apri progetto: dal .json scelto al riepilogo (lettura e validazione di ${kb.toFixed(0)} kB) ${median(readJson)} ms [${readJson.join(', ')}]`);
    console.log(`Apri progetto: dal PDF scelto a "Progetto aperto" (apertura PDF.js, impronta, confronto, applicazione, prima pagina) ${median(reopen)} ms [${reopen.join(', ')}]`);
    await ctx.close();
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
