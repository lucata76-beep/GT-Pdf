// Serie di prove di e2e-cp5c.cjs sul progetto .json: Salva con nome, Apri progetto, modifiche non salvate, dialoghi sul telefono.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const nodeCrypto = require('node:crypto');
const { fullSpecs } = require('./export-specs.cjs');

const sampleBytes = (f) => readFileSync(join(__dirname, '..', 'public', 'test-pdfs', f));
const sha256Node = (buf) => nodeCrypto.createHash('sha256').update(buf).digest('hex');

const ALL_SAMPLES = [
  ['A4 vettoriale', 'a4-vettoriale.pdf'],
  ['A3 vettoriale', 'a3-vettoriale.pdf'],
  ['A4 con /Rotate 90', 'a4-rotate90.pdf'],
  ['A4 con CropBox', 'a4-cropbox.pdf'],
  ['A4 scansione (immagine)', 'a4-scansione.pdf'],
  ['3 pagine miste', 'misto-3-pagine.pdf'],
  ['A4 con annotazioni', 'a4-annotazioni.pdf'],
];
const SAMPLES = process.env.CP5C_QUICK === '1' ? ALL_SAMPLES.slice(0, 1) : ALL_SAMPLES; // CP5C_QUICK=1: solo il primo (per iterare)

// Simula navigator.share / canShare (come in e2e-cp5a-suites.cjs) e, a richiesta, l'assenza di crypto.subtle.
const INIT = `(() => {
  window.__share = { log: [], mode: 'ok', canShare: true };
  Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
    const f = d && d.files && d.files[0];
    window.__share.log.push({ n: d && d.files ? d.files.length : 0, type: f && f.type, name: f && f.name, size: f && f.size });
    if (window.__share.mode === 'ok') return Promise.resolve();
    return Promise.reject(new DOMException('prova', window.__share.mode));
  } });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files) && window.__share.canShare });
})();`;

module.exports = async (t) => {
  const { browser, harness, F, newApp, openSample, check, info, setSection, sha, OUT, HPORT, b64 } = t;
  const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());
  const menuItem = async (page, re) => {
    await page.locator('.menu-btn', { hasText: 'File' }).click();
    await page.locator('.menu-item').filter({ hasText: re }).click();
  };
  const openPdfBytes = async (page, name, bytes) => {
    await page.setInputFiles('input.file-hidden:not(.project-file):not(.project-pdf-file)', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
    await page.waitForTimeout(400);
  };
  /** Apre un PDF di prova anche se l'elenco "PDF di prova" e' gia' aperto (il riepilogo si apre e si chiude a ogni tocco). */
  const openSampleAny = async (page, title) => {
    const open = await page.locator('details.samples-box').evaluate((e) => e.open).catch(() => false);
    if (!open) await page.locator('summary', { hasText: 'PDF di prova' }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.waitForSelector('.viewer-stage canvas');
    await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
    await page.waitForTimeout(400);
  };
  const state = (page) => page.evaluate(() => window.__gtpdf.state());
  const stateSame = (a, b) => JSON.stringify(a.pages) === JSON.stringify(b.pages);
  const origSha = (page) => sha(page, 'window.__gtpdf.originalBytes()');
  const docName = (page) => page.evaluate(() => document.querySelector('.st-msg')?.textContent ?? '');

  /** Mette oggetti di ogni tipo e una scala (valore con molte cifre, diverso per pagina) su ogni pagina. */
  const fill = async (page) => {
    const n = await page.evaluate(() => window.__gtpdf.pages().length);
    for (let k = 1; k <= n; k++) {
      await page.evaluate(({ k: p, specs, mm }) => { window.__gtpdf.setScale(p, mm); window.__gtpdf.addSpecs(p, specs); }, { k, specs: fullSpecs(), mm: 0.35277777777777775 * k + 0.123456789 });
    }
    return n;
  };
  const saveViaUi = async (page, how = 'download') => {
    await menuItem(page, /^Salva con nome/);
    const d = page.locator('.save-dialog');
    await d.waitFor();
    const chooseText = await text(d);
    await d.locator('.btn.primary', { hasText: 'Salva' }).click();
    await d.locator('.exp-done-actions').waitFor({ timeout: 120000 });
    const doneText = await text(d.locator('.exp-summary'));
    const warnText = await text(d);
    let bytes = null;
    let name = null;
    if (how === 'download') {
      const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
      bytes = readFileSync(await dl.path());
      name = dl.suggestedFilename();
    } else if (how === 'share') {
      await d.locator('.btn', { hasText: 'Condividi' }).click();
      await page.waitForFunction(() => document.querySelector('.save-dialog .exp-status')?.textContent);
    }
    const status = await text(d.locator('.exp-status'));
    await d.locator('.btn', { hasText: 'Chiudi' }).click();
    return { chooseText, doneText, warnText, bytes, name, status };
  };
  /** File > Apri progetto…: .json dal primo selettore, PDF dal secondo (aperto dal tocco su "Scegli il PDF…"). */
  const openProject = async (page, json, jsonName, pdf, pdfName, { confirmFirst = false } = {}) => {
    const first = page.waitForEvent('filechooser');
    await menuItem(page, /^Apri progetto/);
    if (confirmFirst) await page.locator('.dialog .btn.primary', { hasText: 'Procedi' }).click();
    await (await first).setFiles({ name: jsonName, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.locator('.open-project-dialog').waitFor();
    const summary = await text(page.locator('.open-project-dialog'));
    if (!pdf) return { summary };
    const second = page.waitForEvent('filechooser');
    await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
    await (await second).setFiles({ name: pdfName, mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
    return { summary };
  };
  const dialogText = (page) => text(page.locator('.open-project-dialog'));

  // ====================================================================================================
  // Salva > chiudi > apri progetto > stato identico, per i 6 PDF di prova e a4-annotazioni
  // ====================================================================================================
  const projects = {};
  for (const [title, file] of SAMPLES) {
    setSection(`salva e riapri: ${title}`);
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
    try {
      const pdf = sampleBytes(file);
      await openSample(page, title);
      const n = await fill(page);
      const S0 = await state(page);
      const objects = S0.pages.reduce((s, p) => s + p.objects.length, 0);
      const origBefore = await origSha(page);
      const pagesWithObjects = S0.pages.filter((p) => p.objects.length > 0).length;
      const scaleBtn0 = await page.locator('.st-scale-btn').innerText();
      const saved = await saveViaUi(page, 'download');
      const base = file.replace(/\.pdf$/, '');
      writeFileSync(join(OUT, `${base}.json`), saved.bytes);
      projects[file] = saved.bytes;
      check('Salva: il riepilogo prima di salvare dice PDF, Nuovo file, pagine con oggetti, oggetti, scale', saved.chooseText.includes(`PDF ${file}`) && saved.chooseText.includes(`Nuovo file ${base}.json`) && saved.chooseText.includes(`Pagine con oggetti ${pagesWithObjects} di ${n}`) && saved.chooseText.includes(`Oggetti ${objects}`) && saved.chooseText.includes(`Scale ${n}`), saved.chooseText);
      check('Salva: nessuna stima di byte o di tempo prima di generare', !/~\s*\d|stimat|\d+(\.\d+)?\s*(kB|MB)/.test(saved.chooseText.replace(/\d+\.\d+ \d+/g, '')), saved.chooseText);
      check('Pronto: nome <PDF>.json, dimensione e tempo misurati, impronta calcolata, rilettura', saved.doneText.includes(`File ${base}.json`) && /Dimensione \d+(\.\d+)? (kB|MB)/.test(saved.doneText) && /Impronta SHA-256 calcolata in \d+ ms/.test(saved.doneText) && /Controllo riletto e validato/.test(saved.doneText) && /Tempo \d+(\.\d+)? s/.test(saved.doneText), saved.doneText);
      check('il file scaricato si chiama <nome del PDF senza .pdf>.json', saved.name === `${base}.json`, saved.name);
      const j = JSON.parse(saved.bytes.toString('utf8'));
      check('il file e\' un progetto valido: format, version 1, app = versione dell\'app, pdf.name e size', j.format === 'gt-pdf-project' && j.version === 1 && typeof j.app === 'string' && j.app.length > 0 && j.pdf.name === file && j.pdf.size === pdf.length, JSON.stringify({ f: j.format, v: j.version, app: j.app, pdf: j.pdf }));
      check('sha256 scritto = SHA-256 calcolato in Node sui byte del PDF (implementazione indipendente)', j.pdf.sha256 === sha256Node(pdf), `${j.pdf.sha256} / ${sha256Node(pdf)}`);
      check('una voce per OGNI pagina del PDF, in ordine, con numero, view, rotate e userUnit', j.pages.length === n && j.pages.every((p, i) => p.number === i + 1 && p.view.length === 4 && [0, 90, 180, 270].includes(p.rotate) && p.userUnit > 0), JSON.stringify(j.pages.map((p) => [p.number, p.rotate, p.userUnit])));
      check('le scale sono mmPerPt a precisione piena e non c\'e\' nessuna etichetta salvata', j.pages.every((p, i) => p.scale && p.scale.mmPerPt === S0.pages[i].scale.mmPerPt) && !/1:\d|:1"/.test(saved.bytes.toString('utf8')));
      check('il file non contiene stato di sessione (cronologia, selezione, strumento, zoom, ORTO)', !/history|undo|redo|selected|tool|zoom|ortho|orto/i.test(saved.bytes.toString('utf8')));
      const dirtyAfterSave = (await state(page)).dirty;
      check('dopo Scarica il progetto risulta salvato (nessuna modifica non salvata)', dirtyAfterSave === false);

      // chiudi: non deve avvisare (appena salvato)
      await menuItem(page, /^Chiudi/);
      await page.waitForTimeout(300);
      check('Chiudi subito dopo il salvataggio NON avvisa (il documento si chiude)', (await page.locator('.dialog:has-text("Modifiche non salvate")').count()) === 0 && (await page.evaluate(() => window.__gtpdf.pages().length)) === 0);

      // apri progetto con lo stesso PDF
      await openProject(page, saved.bytes, `${base}.json`, pdf, file);
      await page.locator('.open-project-dialog').waitFor({ state: 'detached', timeout: 60000 });
      const S1 = await state(page);
      check('Apri progetto con lo stesso PDF: stato IDENTICO (oggetti con id e ordine, scale, testi mostrati con i valori automatici delle quote)', stateSame(S0, S1), JSON.stringify(S1.pages.map((p, i) => [p.objects.length, JSON.stringify(p) === JSON.stringify(S0.pages[i])])));
      check('l\'etichetta della scala nella barra di stato e\' la stessa', (await page.locator('.st-scale-btn').innerText()) === scaleBtn0, `${scaleBtn0} / ${await page.locator('.st-scale-btn').innerText()}`);
      check('subito dopo la riapertura non ci sono modifiche non salvate', S1.dirty === false);
      check('i byte dell\'originale riaperto sono identici a quelli di partenza (SHA-256)', (await origSha(page)) === origBefore);
      check('la barra di stato dice "Progetto aperto."', (await page.locator('.st-msg').innerText()).includes('Progetto aperto.'), await page.locator('.st-msg').innerText());
      // il prossimo id e' maggiore del massimo letto
      const maxId = Math.max(...S1.pages.flatMap((p) => p.objects.map((o) => o.id)));
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.2, 0.2]] }]));
      const S2 = await state(page);
      const newId = S2.pages[0].objects[S2.pages[0].objects.length - 1].id;
      check(`un oggetto nuovo dopo la riapertura ha un id maggiore del massimo letto (${maxId})`, newId > maxId, String(newId));
      check('e subito dopo risulta una modifica non salvata', S2.dirty === true);
    } finally {
      await ctx.close();
    }
  }

  // ====================================================================================================
  // Condividi (File application/json, canShare), annullamento, modifiche non salvate
  // ====================================================================================================
  setSection('Condividi il progetto e modifiche non salvate');
  {
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
    try {
      await openSample(page, 'A4 vettoriale');
      check('appena aperto un PDF senza modifiche: nessuna modifica non salvata', (await state(page)).dirty === false);
      await menuItem(page, /^Chiudi/);
      await page.waitForTimeout(200);
      check('Chiudi senza contenuto non avvisa', (await page.evaluate(() => window.__gtpdf.pages().length)) === 0);
      await openSampleAny(page, 'A4 vettoriale');
      await fill(page);
      // 1) modifiche -> Chiudi avvisa, senza parlare di 5c; Annulla lascia tutto
      await menuItem(page, /^Chiudi/);
      let dlg = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
      await dlg.waitFor();
      const warn = await text(dlg);
      check('l\'avviso dice "dall\'ultimo salvataggio", non parla piu\' di 5c e rimanda a Salva con nome', /dall'ultimo salvataggio/.test(warn) && !/5c/.test(warn) && /Salva con nome/.test(warn), warn);
      check('l\'avviso dice che Esporta PDF non salva il progetto', /Esporta PDF crea un nuovo file ma non salva il progetto/.test(warn), warn);
      await dlg.locator('.btn', { hasText: 'Annulla' }).click();
      check('Annulla: il documento resta aperto con i suoi oggetti', (await page.evaluate(() => window.__gtpdf.objectCount())) > 0);

      // 2) Esporta PDF NON conta come salvataggio
      await menuItem(page, /^Esporta PDF/);
      await page.locator('.export-dialog').waitFor();
      await page.locator('.export-dialog .btn.primary', { hasText: 'Esporta' }).click();
      await page.locator('.export-dialog .exp-done-actions').waitFor({ timeout: 120000 });
      await page.locator('.export-dialog .btn', { hasText: 'Chiudi' }).click();
      check('dopo Esporta PDF restano modifiche non salvate', (await state(page)).dirty === true);

      // 3) Condividi annullato (AbortError): NON salvato
      await page.evaluate(() => { window.__share.mode = 'AbortError'; });
      let r = await saveViaUi(page, 'share');
      check('Condividi annullato dall\'utente: "Condivisione annullata." e il progetto NON risulta salvato', /Condivisione annullata/.test(r.status) && (await state(page)).dirty === true, r.status);
      let log = await page.evaluate(() => window.__share.log);
      check('share() chiamata con UN File application/json chiamato <nome>.json', log.length === 1 && log[0].n === 1 && log[0].type === 'application/json' && log[0].name === 'a4-vettoriale.json' && log[0].size > 100, JSON.stringify(log));
      // 4) canShare falso: lo dice e non chiama share
      await page.evaluate(() => { window.__share.mode = 'ok'; window.__share.canShare = false; window.__share.log.length = 0; });
      await menuItem(page, /^Salva con nome/);
      const sd = page.locator('.save-dialog');
      await sd.waitFor();
      await sd.locator('.btn.primary', { hasText: 'Salva' }).click();
      await sd.locator('.exp-done-actions').waitFor({ timeout: 60000 });
      const noShare = await text(sd);
      check('canShare falso: il dialogo lo dice ("non può condividere un file .json") senza nascondere Scarica', /non può condividere un file \.json \(canShare\(\{files\}\) è falso\)/.test(noShare) && (await sd.locator('.btn', { hasText: 'Scarica' }).count()) === 1, noShare);
      await sd.locator('.btn', { hasText: 'Condividi' }).click();
      await page.waitForTimeout(200);
      check('toccando Condividi con canShare falso share() non viene chiamata', (await page.evaluate(() => window.__share.log.length)) === 0);
      await sd.locator('.btn', { hasText: 'Chiudi' }).click();
      // 5) Condividi riuscito: salvato
      await page.evaluate(() => { window.__share.canShare = true; });
      r = await saveViaUi(page, 'share');
      check('Condividi riuscito: il progetto risulta salvato e il messaggio dice che l\'app non puo\' sapere se il file e\' arrivato', /Il progetto risulta salvato \(l’app non può sapere se il file è davvero arrivato dove pensi\)/.test(r.status) && (await state(page)).dirty === false, r.status);
      // 6) dopo il salvataggio Chiudi non avvisa; dopo una nuova modifica avvisa; annulla/ripeti contano come modifica
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.2, 0.2]] }]));
      check('una modifica dopo il salvataggio torna a "non salvato"', (await state(page)).dirty === true);
      r = await saveViaUi(page, 'download');
      check('Scarica: salvato', (await state(page)).dirty === false);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(150);
      check('annullare dopo il salvataggio e\' una modifica: torna a "non salvato" (nessuna ipotesi sul "stesso stato di prima")', (await state(page)).dirty === true);
      await menuItem(page, /^Apri…/);
      dlg = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
      await dlg.waitFor();
      check('anche Apri avvisa (con il testo di Apri)', /Aprire un altro PDF le scarta/.test(await text(dlg)));
      await dlg.locator('.btn', { hasText: 'Annulla' }).click();
      // Procedi su Chiudi chiude
      await menuItem(page, /^Chiudi/);
      dlg = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
      await dlg.waitFor();
      await dlg.locator('.btn.primary', { hasText: 'Procedi' }).click();
      await page.waitForTimeout(300);
      check('Procedi chiude il documento', (await page.evaluate(() => window.__gtpdf.pages().length)) === 0);
    } finally {
      await ctx.close();
    }
  }

  // ====================================================================================================
  // Apri progetto: esiti (stesso file / hash diverso / geometria diversa / pagine diverse / senza hash), Annulla, doppio selettore da due tocchi
  // ====================================================================================================
  setSection('Apri progetto: esiti e Annulla');
  {
    const jsonA4 = projects['a4-vettoriale.pdf'];
    const pdfA4 = sampleBytes('a4-vettoriale.pdf');
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
    try {
      // documento aperto di partenza (un altro PDF, con oggetti suoi): deve restare com'era in ogni annullamento / rifiuto
      await openSample(page, 'A3 vettoriale');
      await fill(page);
      const base = await state(page);
      const baseSha = await origSha(page);
      const filechoosers = [];
      page.on('filechooser', () => filechoosers.push(Date.now()));
      const intact = async (what) => {
        const s = await state(page);
        check(`${what}: il documento aperto resta com'era (oggetti, scale, byte dell'originale)`, stateSame(base, s) && (await origSha(page)) === baseSha && (await page.evaluate(() => window.__gtpdf.pages().length)) === 1, JSON.stringify({ a: s.pages[0].objects.length, b: base.pages[0].objects.length }));
      };

      // (a) c'e' contenuto non salvato: si chiede conferma; Annulla non apre nessun selettore
      await menuItem(page, /^Apri progetto/);
      let conf = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
      await conf.waitFor();
      check('Apri progetto con contenuto non salvato: conferma con il testo "Aprire un progetto sostituisce il documento attuale."', /Aprire un progetto sostituisce il documento attuale/.test(await text(conf)));
      await conf.locator('.btn', { hasText: 'Annulla' }).click();
      await page.waitForTimeout(300);
      check('Annulla alla conferma: nessun selettore aperto', filechoosers.length === 0);
      await intact('Annulla alla conferma');

      // (b) doppio selettore da due tocchi: il secondo selettore si apre SOLO dal tocco su "Scegli il PDF…"
      filechoosers.length = 0;
      const first = page.waitForEvent('filechooser');
      await menuItem(page, /^Apri progetto/);
      await page.locator('.dialog', { hasText: 'Modifiche non salvate' }).locator('.btn.primary', { hasText: 'Procedi' }).click();
      const ch1 = await first;
      check('Procedi apre il primo selettore (.json) dal tocco: accetta .json', filechoosers.length === 1 && (await page.locator('input.project-file').getAttribute('accept')) === '.json,application/json');
      await ch1.setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: jsonA4 });
      await page.locator('.open-project-dialog').waitFor();
      await page.waitForTimeout(800);
      check('dopo aver scelto il .json NON si apre nessun secondo selettore da codice (resta uno solo)', filechoosers.length === 1, String(filechoosers.length));
      const sum = await dialogText(page);
      check('riepilogo: "Progetto di a4-vettoriale.pdf: 1 pagina, N oggetti, 1 scala." e PDF atteso con nome e dimensione', /Progetto di a4-vettoriale\.pdf: 1 pagina, \d+ oggetti, 1 scala\./.test(sum) && /PDF atteso a4-vettoriale\.pdf \(\d+(\.\d+)? kB\)/.test(sum) && /Impronta SHA-256 presente/.test(sum), sum);
      const second = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      const ch2 = await second;
      check('il secondo selettore si apre dal tocco su "Scegli il PDF…" (due tocchi, due selettori) e accetta i PDF', filechoosers.length === 2 && (await page.locator('input.project-pdf-file').getAttribute('accept')) === 'application/pdf,.pdf');
      // (c) PDF con geometria diversa (A3 al posto di A4): rifiuto con la prima differenza
      await ch2.setFiles({ name: 'a3-vettoriale.pdf', mimeType: 'application/pdf', buffer: sampleBytes('a3-vettoriale.pdf') });
      await page.locator('.open-project-dialog', { hasText: 'PDF non corrispondente' }).waitFor();
      let body = await dialogText(page);
      check('geometria diversa (A3 al posto di A4): rifiuto, dice pagina, valore atteso e trovato', /Pagina 1: area visibile attesa \[0, 0, 595\.276, 841\.89\] pt, trovata \[0, 0, 1190\.551, 841\.89\] pt\./.test(body) && /non apro il progetto/.test(body), body);
      check('il rifiuto offre "Scegli un altro PDF…" e Chiudi', (await page.locator('.open-project-dialog [data-role=pick-pdf]').innerText()) === 'Scegli un altro PDF…');
      await intact('Rifiuto per geometria diversa');
      // ... si puo' scegliere un altro PDF dallo stesso dialogo: numero di pagine diverso (3 miste)
      const third = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      await (await third).setFiles({ name: 'misto-3-pagine.pdf', mimeType: 'application/pdf', buffer: sampleBytes('misto-3-pagine.pdf') });
      await page.locator('.open-project-dialog', { hasText: 'Il progetto ha 1 pagina, il PDF scelto ne ha 3.' }).waitFor();
      check('numero di pagine diverso: "Il progetto ha 1 pagina, il PDF scelto ne ha 3."', true);
      await intact('Rifiuto per numero di pagine diverso');
      // ... e un file che non e' un PDF (il .json stesso): errore chiaro, documento intatto
      const fourth = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      await (await fourth).setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: jsonA4 });
      await page.locator('.open-project-dialog', { hasText: 'PDF non apribile' }).waitFor();
      body = await dialogText(page);
      check('scegliere un .json come PDF: "PDF non apribile" con il motivo, documento intatto', /è un file progetto \(\.json\), non un PDF/.test(body), body);
      await intact('PDF non apribile');
      // ... un PDF danneggiato
      const fifth = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      await (await fifth).setFiles({ name: 'rotto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnon e un pdf vero') });
      await page.locator('.open-project-dialog', { hasText: 'PDF non apribile' }).waitFor();
      body = await dialogText(page);
      check('un PDF danneggiato: messaggio in italiano ("non è un PDF valido…") e documento intatto', /non è un PDF valido|danneggiato|incompleto/.test(body), body);
      await intact('PDF danneggiato');

      // (d) hash diverso con la stessa geometria: "A4 con annotazioni" al posto di "A4 vettoriale"
      const sixth = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
      await (await sixth).setFiles({ name: 'a4-annotazioni.pdf', mimeType: 'application/pdf', buffer: sampleBytes('a4-annotazioni.pdf') });
      await page.locator('.open-project-dialog', { hasText: 'Non è lo stesso file' }).waitFor();
      body = await dialogText(page);
      check('hash diverso con la stessa geometria: avviso "Non è lo stesso file con cui hai salvato… il disegno sotto potrebbe essere cambiato"', /Non è lo stesso file con cui hai salvato/.test(body) && /il disegno sotto potrebbe essere cambiato/.test(body) && /Annulla/.test(body) && /Procedi/.test(body), body);
      check('l\'avviso dice che Annulla lascia il documento com\'era', /Con Annulla il documento attuale resta com’era/.test(body));
      await page.locator('.open-project-dialog [data-role=cancel]').click();
      await page.locator('.open-project-dialog').waitFor({ state: 'detached' });
      await intact('Annulla all\'avviso di hash diverso');
      // Esc a ogni passo
      for (const step of ['riepilogo', 'avviso']) {
        const f1 = page.waitForEvent('filechooser');
        await menuItem(page, /^Apri progetto/);
        const c = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
        await c.waitFor();
        await c.locator('.btn.primary', { hasText: 'Procedi' }).click();
        await (await f1).setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: jsonA4 });
        await page.locator('.open-project-dialog').waitFor();
        if (step === 'avviso') {
          const f2 = page.waitForEvent('filechooser');
          await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
          await (await f2).setFiles({ name: 'a4-annotazioni.pdf', mimeType: 'application/pdf', buffer: sampleBytes('a4-annotazioni.pdf') });
          await page.locator('.open-project-dialog', { hasText: 'Non è lo stesso file' }).waitFor();
        }
        await page.keyboard.press('Escape');
        await page.locator('.open-project-dialog').waitFor({ state: 'detached' });
        await intact(`Esc al passo "${step}"`);
      }
      // Annulla dal riepilogo
      {
        const f1 = page.waitForEvent('filechooser');
        await menuItem(page, /^Apri progetto/);
        await page.locator('.dialog', { hasText: 'Modifiche non salvate' }).locator('.btn.primary', { hasText: 'Procedi' }).click();
        await (await f1).setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: jsonA4 });
        await page.locator('.open-project-dialog').waitFor();
        await page.locator('.open-project-dialog .btn', { hasText: 'Annulla' }).click();
        await page.locator('.open-project-dialog').waitFor({ state: 'detached' });
        await intact('Annulla dal riepilogo');
      }
      // (e) hash diverso: Procedi applica gli oggetti al PDF scelto
      {
        const f1 = page.waitForEvent('filechooser');
        await menuItem(page, /^Apri progetto/);
        await page.locator('.dialog', { hasText: 'Modifiche non salvate' }).locator('.btn.primary', { hasText: 'Procedi' }).click();
        await (await f1).setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: jsonA4 });
        await page.locator('.open-project-dialog').waitFor();
        const f2 = page.waitForEvent('filechooser');
        await page.locator('.open-project-dialog [data-role=pick-pdf]').click();
        await (await f2).setFiles({ name: 'a4-annotazioni.pdf', mimeType: 'application/pdf', buffer: sampleBytes('a4-annotazioni.pdf') });
        await page.locator('.open-project-dialog', { hasText: 'Non è lo stesso file' }).waitFor();
        await page.locator('.open-project-dialog [data-role=proceed]').click();
        await page.locator('.open-project-dialog').waitFor({ state: 'detached', timeout: 60000 });
        const s = await state(page);
        const want = JSON.parse(jsonA4.toString('utf8')).pages[0];
        check('Procedi con un PDF diverso (stessa geometria): oggetti e scala del progetto applicati al PDF scelto', s.pages[0].objects.length === want.objects.length && s.pages[0].scale.mmPerPt === want.scale.mmPerPt && s.dirty === false, `${s.pages[0].objects.length} / ${want.objects.length}`);
        check('il PDF aperto adesso e\' quello scelto (byte di a4-annotazioni.pdf) e il messaggio lo dice', (await origSha(page)) === `${sampleBytes('a4-annotazioni.pdf').length}:${sha256Node(sampleBytes('a4-annotazioni.pdf'))}` && /PDF diverso, stessa geometria/.test(await page.locator('.st-msg').innerText()), await page.locator('.st-msg').innerText());
      }
    } finally {
      await ctx.close();
    }
  }

  // ---- progetto senza impronta (sha256 null) e browser senza crypto.subtle ----
  setSection('Apri progetto: senza impronta');
  {
    const jsonA4 = projects['a4-vettoriale.pdf'];
    const pdfA4 = sampleBytes('a4-vettoriale.pdf');
    // progetto salvato senza sha256 (come da un browser senza crypto.subtle): si apre con avviso
    const noHash = JSON.parse(jsonA4.toString('utf8'));
    noHash.pdf.sha256 = null;
    const { ctx, page } = await newApp(browser, { init: INIT });
    try {
      await openProject(page, Buffer.from(JSON.stringify(noHash)), 'senza-hash.json', pdfA4, 'a4-vettoriale.pdf');
      await page.locator('.open-project-dialog', { hasText: 'Non è lo stesso file' }).waitFor();
      const body = await dialogText(page);
      check('progetto con sha256 null, anche con lo stesso PDF: "salvato senza l\'impronta… non posso verificare" e conferma', /salvato senza l'impronta \(SHA-256\) del PDF: non posso verificare che sia lo stesso file/.test(body), body);
      await page.locator('.open-project-dialog [data-role=proceed]').click();
      await page.locator('.open-project-dialog').waitFor({ state: 'detached', timeout: 60000 });
      check('Procedi: progetto aperto, senza modifiche non salvate', (await state(page)).dirty === false && (await state(page)).pages[0].objects.length > 0);
    } finally {
      await ctx.close();
    }
    // browser senza crypto.subtle: salva con sha256 null, lo dice, e alla riapertura e' un hash "che non coincide"
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page2 = await ctx2.newPage();
    await page2.addInitScript(`${INIT}\nObject.defineProperty(crypto, 'subtle', { configurable: true, get: () => undefined });`);
    page2.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
    try {
      await page2.goto(t.URL);
      await page2.addStyleTag({ content: '.float-zoom{display:none!important}' });
      await openSample(page2, 'A4 vettoriale');
      await fill(page2);
      await menuItem(page2, /^Salva con nome/);
      const d = page2.locator('.save-dialog');
      await d.waitFor();
      check('senza crypto.subtle il dialogo lo dice PRIMA di salvare', /non calcola l’impronta SHA-256 del PDF: il progetto si salva senza \(sha256 = null\)/.test(await text(d)));
      await d.locator('.btn.primary', { hasText: 'Salva' }).click();
      await d.locator('.exp-done-actions').waitFor({ timeout: 60000 });
      const done = await text(d);
      check('e a file pronto: "Impronta SHA-256 non disponibile (sha256 = null)"', /Impronta SHA-256 non disponibile \(sha256 = null\)/.test(done), done);
      const [dl] = await Promise.all([page2.waitForEvent('download'), d.locator('.btn', { hasText: 'Scarica' }).click()]);
      const bytes = readFileSync(await dl.path());
      check('il file ha "sha256": null (nessun valore inventato)', JSON.parse(bytes.toString('utf8')).pdf.sha256 === null);
      await d.locator('.btn', { hasText: 'Chiudi' }).click();
      await menuItem(page2, /^Chiudi/);
      await page2.locator('.dialog', { hasText: 'Modifiche non salvate' }).locator('.btn.primary', { hasText: 'Procedi' }).click().catch(() => undefined);
      await page2.waitForTimeout(300);
      const f1 = page2.waitForEvent('filechooser');
      await menuItem(page2, /^Apri progetto/);
      await (await f1).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: bytes });
      await page2.locator('.open-project-dialog').waitFor();
      check('con un progetto senza impronta il riepilogo dice "Impronta SHA-256 assente"', /Impronta SHA-256 assente/.test(await text(page2.locator('.open-project-dialog'))));
      const f2 = page2.waitForEvent('filechooser');
      await page2.locator('.open-project-dialog [data-role=pick-pdf]').click();
      await (await f2).setFiles({ name: 'a4-vettoriale.pdf', mimeType: 'application/pdf', buffer: pdfA4 });
      await page2.locator('.open-project-dialog', { hasText: 'Non è lo stesso file' }).waitFor();
      check('senza crypto.subtle alla riapertura l\'impronta si tratta come "non coincide": conferma con il motivo', /non posso verificare che sia lo stesso file/.test(await text(page2.locator('.open-project-dialog'))));
    } finally {
      await ctx2.close();
    }
  }

  // ====================================================================================================
  // File non validi e un .json aperto con Apri
  // ====================================================================================================
  setSection('Apri progetto: file non validi');
  {
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
    try {
      await openSample(page, 'A4 vettoriale');
      await fill(page);
      const base = await state(page);
      const baseSha = await origSha(page);
      const good = JSON.parse(projects['a4-vettoriale.pdf'].toString('utf8'));
      const bads = [
        ['file vuoto', '', /vuoto/],
        ['non JSON', 'questo non è json', /non e' un JSON valido/],
        ['JSON di un altro tipo', '{"nome":"x","valori":[1,2,3]}', /non e' un progetto di GT-Pdf/],
        ['versione futura', JSON.stringify({ ...good, version: 9 }), /versione piu' recente \(9\)/],
        ['oggetto con spessore fuori intervallo', JSON.stringify({ ...good, pages: good.pages.map((p, i) => (i === 0 ? { ...p, objects: p.objects.map((o, k) => (k === 4 ? { ...o, stroke: { ...o.stroke, widthPt: 99 } } : o)) } : p)) }), /pagina 1, oggetto 5: spessore \(99\) fuori dall'intervallo 0\.1–20 pt/],
      ];
      for (const [name, content, re] of bads) {
        const f1 = page.waitForEvent('filechooser');
        await menuItem(page, /^Apri progetto/);
        const c = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
        await c.waitFor();
        await c.locator('.btn.primary', { hasText: 'Procedi' }).click();
        await (await f1).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(content) });
        const err = page.locator('.dialog', { hasText: 'Progetto non valido' });
        await err.waitFor();
        const msg = await text(err);
        check(`${name}: "Progetto non valido" con il motivo in italiano e il documento non toccato`, re.test(msg) && /Il documento aperto non è stato toccato/.test(msg), msg);
        await err.locator('.btn.primary').click();
        check(`${name}: il documento aperto resta com'era`, stateSame(base, await state(page)) && (await origSha(page)) === baseSha);
      }
      // file molto grande: rifiutato senza leggerlo
      const big = Buffer.alloc(17 * 1024 * 1024, 120);
      const f1 = page.waitForEvent('filechooser');
      await menuItem(page, /^Apri progetto/);
      const c = page.locator('.dialog', { hasText: 'Modifiche non salvate' });
      await c.waitFor();
      await c.locator('.btn.primary', { hasText: 'Procedi' }).click();
      await (await f1).setFiles({ name: 'enorme.json', mimeType: 'application/json', buffer: big });
      const err = page.locator('.dialog', { hasText: 'Progetto non valido' });
      await err.waitFor();
      check('file di 17 MB: "troppo grande (oltre 16 MB)" e documento intatto', /il file è troppo grande \(oltre 16 MB\)/.test(await text(err)) && stateSame(base, await state(page)));
      await err.locator('.btn.primary').click();
      // un .json aperto con "Apri…" (selettore dei PDF) non si accetta come PDF
      await page.setInputFiles('input.file-hidden:not(.project-file):not(.project-pdf-file)', { name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: projects['a4-vettoriale.pdf'] });
      const d = page.locator('.dialog', { hasText: 'Questo è un progetto' });
      await d.waitFor();
      check('un .json scelto con Apri: "Questo è un progetto… usa File > Apri progetto…" e il documento non cambia', /file progetto \(\.json\), non un PDF/.test(await text(d)) && stateSame(base, await state(page)) && (await origSha(page)) === baseSha, await text(d));
      await d.locator('.btn.primary').click();
      // lo stesso, con tipo MIME PDF ma nome .json non conta: basta il nome o il tipo
    } finally {
      await ctx.close();
    }
  }

  // ====================================================================================================
  // Coerenza: esporta "Copertura semplice", salva, chiudi, riapri il progetto con lo stesso PDF, esporta di nuovo
  // ====================================================================================================
  setSection('coerenza dell\'esportazione dopo salva e riapri');
  {
    const L = await import('@cantoo/pdf-lib');
    const contents = async (buf) => {
      const doc = await L.PDFDocument.load(buf, { updateMetadata: false });
      return doc.getPages().map((p) => {
        const c = p.node.lookup(L.PDFName.of('Contents'));
        const streams = !c ? [] : c instanceof L.PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : [c];
        return Buffer.concat(streams.map((s) => Buffer.from(L.decodePDFRawStream(s).decode()))).toString('latin1');
      });
    };
    const rot90crop = await F.build({ pages: [{ size: [300, 400], crop: [20, 30, 240, 330], rotate: 90, raw: 'BT /F1 12 Tf 40 300 Td (TESTO ORIGINALE) Tj ET 0 0 0 rg 60 60 100 80 re f' }] });
    const cases = [
      ['A4 vettoriale con un oggetto per tipo', async (page) => openSample(page, 'A4 vettoriale'), sampleBytes('a4-vettoriale.pdf'), 'a4-vettoriale.pdf'],
      ['/Rotate 90 + CropBox (sintetico)', async (page) => openPdfBytes(page, 'rot90-crop.pdf', rot90crop), Buffer.from(rot90crop), 'rot90-crop.pdf'],
      ['3 pagine miste', async (page) => openSample(page, '3 pagine miste'), sampleBytes('misto-3-pagine.pdf'), 'misto-3-pagine.pdf'],
    ];
    for (const [title, open, pdf, name] of cases) {
      const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
      try {
        await open(page);
        await fill(page);
        const exportNow = async () => {
          await page.evaluate(() => window.__gtpdf.runExport({ mode: 'simple', keep: true }));
          return Buffer.from(await page.evaluate(() => window.__gtpdf.lastExportBase64()), 'base64');
        };
        const E1 = await exportNow();
        const saved = await saveViaUi(page, 'download');
        await menuItem(page, /^Chiudi/);
        await page.waitForTimeout(300);
        await openProject(page, saved.bytes, `${name}.json`, pdf, name);
        await page.locator('.open-project-dialog').waitFor({ state: 'detached', timeout: 60000 });
        const E2 = await exportNow();
        const c1 = await contents(E1);
        const c2 = await contents(E2);
        const same = JSON.stringify(c1) === JSON.stringify(c2);
        check(`${title}: l'esportazione dopo salva/chiudi/riapri ha lo STESSO contenuto di pagina (flussi decodificati, ${c1.length} pagine)`, same, c1.map((x, i) => (x === c2[i] ? 'uguale' : `diverso (${x.length} / ${c2[i]?.length})`)).join(', '));
        info(`${title}: file esportati ${E1.length} e ${E2.length} byte, ${E1.equals(E2) ? 'IDENTICI byte per byte' : 'diversi nei byte (ma contenuto di pagina uguale)'}`);
      } finally {
        await ctx.close();
      }
    }
  }

  // ====================================================================================================
  // Dialoghi sul telefono: 390x844 e 844x390 (Salva con nome, Apri progetto)
  // ====================================================================================================
  setSection('dialoghi sul telefono');
  for (const [label, vp] of [['390x844', { width: 390, height: 844 }], ['844x390', { width: 844, height: 390 }]]) {
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: vp, dpr: 3, context: { isMobile: true, hasTouch: true } });
    try {
      await openSample(page, 'A4 vettoriale');
      await fill(page);
      const fits = async (sel, what) => {
        const m = await page.locator(sel).evaluate((e) => {
          const r = e.getBoundingClientRect();
          const btns = [...e.querySelectorAll('.btn')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect().height);
          return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: e.scrollHeight, ch: e.clientHeight, vw: innerWidth, vh: innerHeight, btns, ov: getComputedStyle(e).overflowY, sw: e.scrollWidth, cw: e.clientWidth };
        });
        check(`${label}, ${what}: il dialogo sta dentro lo schermo e scorre se serve (contenuto ${m.sh} px in ${m.ch} px)`, m.l >= 0 && m.t >= 0 && m.r <= m.vw + 0.5 && m.b <= m.vh + 0.5 && m.sw <= m.cw && (m.sh <= m.ch || m.ov === 'auto'), JSON.stringify(m));
        check(`${label}, ${what}: i pulsanti sono alti almeno 44 px`, m.btns.every((x) => x >= 44), m.btns.join(','));
        return m;
      };
      await page.locator('.menu-btn', { hasText: 'File' }).tap();
      await page.locator('.menu-item').filter({ hasText: /^Salva con nome/ }).tap();
      await page.locator('.save-dialog').waitFor();
      await fits('.save-dialog', 'Salva con nome (scelta)');
      await page.locator('.save-dialog .btn.primary', { hasText: 'Salva' }).tap();
      await page.locator('.save-dialog .exp-done-actions').waitFor({ timeout: 60000 });
      await fits('.save-dialog', 'Progetto pronto');
      const reach = async (re, what) => {
        const b = page.locator('.save-dialog .btn').filter({ hasText: re }).first();
        await b.scrollIntoViewIfNeeded();
        const r = await b.evaluate((e) => { const x = e.getBoundingClientRect(); return { t: x.top, b: x.bottom, h: x.height, vh: innerHeight }; });
        check(`${label}: "${what}" si raggiunge scorrendo, alto ${Math.round(r.h)} px e dentro lo schermo`, r.h >= 44 && r.t >= 0 && r.b <= r.vh + 0.5, JSON.stringify(r));
      };
      await reach(/^Chiudi$/, 'Chiudi');
      await reach(/^Scarica$/, 'Scarica');
      await reach(/^Condividi$/, 'Condividi');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.save-dialog .btn', { hasText: 'Scarica' }).tap()]);
      const bytes = readFileSync(await dl.path());
      await page.locator('.save-dialog .btn', { hasText: 'Chiudi' }).tap();
      // Apri progetto: da una sessione appena salvata (nessuna conferma)
      const f1 = page.waitForEvent('filechooser');
      await page.locator('.menu-btn', { hasText: 'File' }).tap();
      await page.locator('.menu-item').filter({ hasText: /^Apri progetto/ }).tap();
      await (await f1).setFiles({ name: 'a4-vettoriale.json', mimeType: 'application/json', buffer: bytes });
      await page.locator('.open-project-dialog').waitFor();
      await fits('.open-project-dialog', 'Apri progetto (riepilogo)');
      const f2 = page.waitForEvent('filechooser');
      await page.locator('.open-project-dialog [data-role=pick-pdf]').tap();
      await (await f2).setFiles({ name: 'a3-vettoriale.pdf', mimeType: 'application/pdf', buffer: sampleBytes('a3-vettoriale.pdf') });
      await page.locator('.open-project-dialog', { hasText: 'PDF non corrispondente' }).waitFor();
      await fits('.open-project-dialog', 'Apri progetto (rifiuto)');
      await page.screenshot({ path: join(OUT, `apri-progetto-rifiuto-${label}.png`) });
      await page.locator('.open-project-dialog .btn', { hasText: 'Chiudi' }).tap();
    } finally {
      await ctx.close();
    }
  }
};
