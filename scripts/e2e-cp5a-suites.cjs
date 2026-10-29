// Serie di prove di e2e-cp5a.cjs (separate per leggibilita'): ricevono gli strumenti dal file principale.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { drawRaw } = require('./export-specs.cjs');

const INIT = `(() => {
  window.__share = { log: [], mode: 'ok', canShare: true, hasCanShare: true };
  Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
    const f = d && d.files && d.files[0];
    window.__share.log.push({ n: d && d.files ? d.files.length : 0, type: f && f.type, name: f && f.name, size: f && f.size, active: navigator.userActivation ? navigator.userActivation.isActive : null });
    if (window.__share.mode === 'ok') return Promise.resolve();
    return Promise.reject(new DOMException('prova', window.__share.mode));
  } });
  Object.defineProperty(navigator, 'canShare', { configurable: true, get() { return window.__share.hasCanShare ? (d) => !!(d && d.files) && window.__share.canShare : undefined; } });
  const mk = URL.createObjectURL.bind(URL), rv = URL.revokeObjectURL.bind(URL);
  window.__urls = { created: [], revoked: [] };
  URL.createObjectURL = (b) => { const u = mk(b); window.__urls.created.push({ u, type: b.type, size: b.size }); return u; };
  URL.revokeObjectURL = (u) => { window.__urls.revoked.push(u); rv(u); };
})();`;

module.exports = async (t) => {
  const { browser, harness, F, compareCase, fullSpecs, newApp, openBytes, openSample, exportViaUi, sha, shaBuf, check, info, setSection, OUT, HPORT, b64 } = t;
  const sampleBytes = (f) => readFileSync(join(__dirname, '..', 'public', 'test-pdfs', f));
  const dlg = (page) => page.locator('.export-dialog');
  const openDialog = async (page) => {
    await page.locator('.menu-btn', { hasText: 'File' }).click();
    await page.locator('.menu-item', { hasText: 'Esporta PDF' }).click();
    await dlg(page).waitFor();
  };
  const generate = async (page) => {
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
  };
  const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());

  // ====================================================================================
  setSection('menu e dialogo');
  {
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 } });
    await page.locator('.menu-btn', { hasText: 'File' }).click();
    const items = async () => page.$$eval('.menu-item', (els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, ' ').trim(), off: e.disabled })));
    let it = await items();
    check('senza PDF: "Esporta PDF…" disattivato', it.find((i) => i.t.startsWith('Esporta PDF'))?.off === true, JSON.stringify(it));
    // 5c: "Salva con nome…" ha la stessa regola di "Esporta PDF…" (serve un PDF aperto), senza etichetta di tappa; "Apri progetto…" e' sempre attivo.
    check('senza PDF: "Salva con nome…" disattivato e senza etichetta di tappa, "Apri progetto…" attivo', it.find((i) => i.t.startsWith('Salva con nome'))?.off === true && !it.find((i) => i.t.startsWith('Salva con nome'))?.t.includes('5c') && it.find((i) => i.t.startsWith('Apri progetto'))?.off === false, JSON.stringify(it));
    await page.keyboard.press('Escape');
    await openSample(page, 'A4 vettoriale');
    await page.locator('.menu-btn', { hasText: 'File' }).click();
    it = await items();
    check('con un PDF aperto: "Esporta PDF…" e "Salva con nome…" attivi (dalla tappa 5c)', it.find((i) => i.t.startsWith('Esporta PDF'))?.off === false && it.find((i) => i.t.startsWith('Salva con nome'))?.off === false, JSON.stringify(it));
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'text', at: [0.1, 0.5], text: 'PROVA' }]));
    await openDialog(page);
    const radios = await page.$$eval('.export-dialog input[type=radio]', (els) => els.map((e) => ({ v: e.value, checked: e.checked, disabled: e.disabled })));
    check('"Copertura semplice" e\' predefinita', radios.find((r) => r.v === 'simple')?.checked === true && radios.find((r) => r.v === 'simple')?.disabled === false, JSON.stringify(radios));
    check('"Appiattito" e\' visibile, ATTIVO dalla tappa 5b e non predefinito', radios.find((r) => r.v === 'flat')?.disabled === false && radios.find((r) => r.v === 'flat')?.checked === false, JSON.stringify(radios));
    const body = await text(dlg(page));
    check('"Appiattito" non porta piu\' l\'etichetta 5b', !/Appiattito\s*5b/.test(body), body);
    check('descrizione di Copertura semplice: "Il testo sotto le coperture resta nel file."', body.includes('Il testo sotto le coperture resta nel file.'));
    check('descrizione di Appiattito: "Le pagine diventano immagini: il testo sotto sparisce."', body.includes('Le pagine diventano immagini: il testo sotto sparisce.'));
    check('riepilogo: nome file, nuovo file, pagine, oggetti, modalita\'', body.includes('File a4-vettoriale.pdf') && body.includes('Nuovo file a4-vettoriale-quotato.pdf') && body.includes('Pagine 1 (1 con oggetti)') && body.includes('Oggetti 2') && body.includes('Modalità Copertura semplice'), body);
    check('nessuna stima di peso del file prima di generarlo (DESIGN.md: niente stime inventate)', !/~\s*\d|stimat/i.test(body), body);
    const btns = await dlg(page).locator('.dialog-actions .btn').allInnerTexts();
    check('pulsanti Annulla ed Esporta', btns.join('|') === 'Annulla|Esporta', btns.join('|'));
    const heights = await dlg(page).locator('.btn:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check('pulsanti alti almeno 44 px', heights.every((h) => h >= 44), heights.join(','));
    await dlg(page).locator('.btn', { hasText: 'Annulla' }).click();
    check('Annulla chiude il dialogo senza generare', (await page.locator('.export-dialog').count()) === 0 && (await page.evaluate(() => window.__share.log.length)) === 0);
    await openDialog(page);
    await page.keyboard.press('Escape');
    check('Esc chiude il dialogo', (await page.locator('.export-dialog').count()) === 0);
    await ctx.close();
  }

  // ====================================================================================
  setSection('Esporta, Condividi, Scarica');
  {
    const { ctx, page } = await newApp(browser, { init: INIT, viewport: { width: 1280, height: 900 }, clock: true });
    await openSample(page, 'A4 vettoriale');
    await page.evaluate(() => { window.__gtpdf.setScale(1, 0.5); window.__gtpdf.addSpecs(1, [{ k: 'cover', shape: 'rect', a: [0.02, 0.895], b: [0.55, 0.99] }, { k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'dim', dim: 'horizontal', pts: [[0.2, 0.7], [0.5, 0.74], [0.35, 0.8]] }]); });
    const before = await sha(page, 'window.__gtpdf.originalBytes()');
    await openDialog(page);
    await generate(page);
    const body = await text(dlg(page));
    check('dopo "Esporta" il dialogo mostra Condividi e Scarica', (await dlg(page).locator('.btn', { hasText: 'Condividi' }).count()) === 1 && (await dlg(page).locator('.btn', { hasText: 'Scarica' }).count()) === 1, body);
    check('"Esporta" NON ha chiamato share()', (await page.evaluate(() => window.__share.log.length)) === 0);
    check('riepilogo del risultato: nome, dimensione calcolata (kB/MB), pagine riscritte, controllo, tempo', /File a4-vettoriale-quotato\.pdf/.test(body) && /Dimensione \d+(\.\d+)? (kB|MB)/.test(body) && /Pagine 1 \(1 riscritta\)/.test(body) && /Controllo riaperto: 1 pagina come l'originale/.test(body) && /Tempo \d+(\.\d+)? s/.test(body), body);
    check('nessun avviso per questo documento (nessuna annotazione)', (await page.locator('.export-dialog .exp-warn-h').count()) === 0);

    // Condividi: esito "ok"
    await dlg(page).locator('.btn', { hasText: 'Condividi' }).click();
    await page.waitForFunction(() => document.querySelector('.exp-status')?.textContent);
    let log = await page.evaluate(() => window.__share.log);
    check('Condividi: share() chiamata una volta con un solo File application/pdf', log.length === 1 && log[0].n === 1 && log[0].type === 'application/pdf', JSON.stringify(log));
    check('il File condiviso si chiama a4-vettoriale-quotato.pdf e non e\' vuoto', log[0]?.name === 'a4-vettoriale-quotato.pdf' && log[0]?.size > 1000, JSON.stringify(log[0]));
    check('share() e\' chiamata dentro il gesto: userActivation.isActive vero al momento della chiamata', log[0]?.active === true, String(log[0]?.active));
    check('esito "condiviso": messaggio normale', (await page.locator('.exp-status').getAttribute('data-state')) === 'shared', await text(page.locator('.exp-status')));

    // annullamento del foglio: AbortError, non e' un errore
    await page.evaluate(() => { window.__share.mode = 'AbortError'; });
    await dlg(page).locator('.btn', { hasText: 'Condividi' }).click();
    await page.waitForFunction(() => document.querySelector('.exp-status')?.getAttribute('data-state') === 'cancelled');
    check('AbortError: "Condivisione annullata." mostrato come annullamento, non come errore', (await text(page.locator('.exp-status'))) === 'Condivisione annullata.' && (await page.locator('.exp-status').getAttribute('data-state')) === 'cancelled');
    const col = await page.locator('.exp-status').evaluate((e) => getComputedStyle(e).color);
    const normalCol = await page.locator('.dialog-title').evaluate((e) => getComputedStyle(e).color);
    check('AbortError: stesso colore del testo normale (non quello degli errori)', col === normalCol, `${col} / ${normalCol}`);
    check('dopo l\'annullamento Condividi e\' di nuovo utilizzabile', await dlg(page).locator('.btn', { hasText: 'Condividi' }).isEnabled());

    // NotAllowedError
    await page.evaluate(() => { window.__share.mode = 'NotAllowedError'; });
    await dlg(page).locator('.btn', { hasText: 'Condividi' }).click();
    await page.waitForFunction(() => document.querySelector('.exp-status')?.getAttribute('data-state') === 'failed');
    const failedText = await text(page.locator('.exp-status'));
    check('NotAllowedError: errore spiegato in italiano, con l\'eccezione originale', /Tocca di nuovo/.test(failedText) && /NotAllowedError/.test(failedText), failedText);

    // canShare falso, poi assente
    await page.evaluate(() => { window.__share.mode = 'ok'; window.__share.canShare = false; });
    await dlg(page).locator('.btn', { hasText: 'Condividi' }).click();
    await page.waitForFunction(() => document.querySelector('.exp-status')?.getAttribute('data-state') === 'unavailable');
    const noShare = await text(page.locator('.exp-status'));
    check('canShare({files}) falso: lo dice (e non chiama share)', /canShare\(\{files\}\) è falso/.test(noShare) && (await page.evaluate(() => window.__share.log.length)) === 3, noShare);
    check('Scarica resta disponibile', await dlg(page).locator('.btn', { hasText: 'Scarica' }).isEnabled());

    // Scarica
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
    const saved = readFileSync(await dl.path());
    check('Scarica: nome suggerito a4-vettoriale-quotato.pdf', dl.suggestedFilename() === 'a4-vettoriale-quotato.pdf', dl.suggestedFilename());
    check('Scarica: il file scaricato e\' un PDF (%PDF-) e non e\' l\'originale', saved.subarray(0, 5).toString() === '%PDF-' && (await shaBuf(saved)) !== before);
    const urls = await page.evaluate(() => window.__urls);
    check('Scarica: blob application/octet-stream (si salva in Download), stessa dimensione del file', urls.created.length === 1 && urls.created[0].type === 'application/octet-stream' && urls.created[0].size === saved.length, JSON.stringify(urls.created));
    check('subito dopo Scarica l\'indirizzo del blob non e\' ancora revocato', urls.revoked.length === 0);
    writeFileSync(join(OUT, 'a4-vettoriale-scaricato-quotato.pdf'), saved);
    // Scarica due volte: lo stesso indirizzo
    const [dl2] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
    await dl2.path();
    check('secondo Scarica: nessun secondo blob', (await page.evaluate(() => window.__urls.created.length)) === 1);

    // chiusura: il blob si rilascia (dopo l'attesa, perche' lo scarico e' appena partito)
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
    check('il dialogo si chiude', (await page.locator('.export-dialog').count()) === 0);
    let u = await page.evaluate(() => window.__urls);
    check('alla chiusura subito dopo lo scarico l\'indirizzo resta (si attende, CP0: revocare subito puo\' interrompere lo scarico su iOS)', u.revoked.length === 0);
    await page.clock.fastForward(61000);
    u = await page.evaluate(() => window.__urls);
    check('dopo 60 s l\'indirizzo del blob e\' revocato (stesso indirizzo creato)', u.revoked.length === 1 && u.revoked[0] === u.created[0].u, JSON.stringify(u));
    check('l\'originale non e\' cambiato (SHA-256)', (await sha(page, 'window.__gtpdf.originalBytes()')) === before);

    // senza scaricare: niente blob da revocare
    await openDialog(page);
    await generate(page);
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
    check('chiudere senza scaricare non crea ne\' revoca indirizzi', (await page.evaluate(() => window.__urls.created.length)) === 1);
    // canShare assente
    await page.evaluate(() => { window.__share.hasCanShare = false; });
    await openDialog(page);
    await generate(page);
    const note = await text(dlg(page));
    check('canShare assente: il dialogo lo dice subito, senza nasconderlo', /navigator\.canShare assente/.test(note), note);
    await dlg(page).locator('.btn', { hasText: 'Condividi' }).click();
    await page.waitForFunction(() => document.querySelector('.exp-status')?.getAttribute('data-state') === 'unavailable');
    check('canShare assente: toccare Condividi non chiama share', (await page.evaluate(() => window.__share.log.length)) === 3);
    await ctx.close();
  }

  // ====================================================================================
  setSection('nomi dei file');
  {
    const base = sampleBytes('a4-vettoriale.pdf');
    const names = [
      ['Disegno 1.pdf', 'Disegno 1-quotato.pdf'],
      ['Disegno rev 3.PDF', 'Disegno rev 3-quotato.pdf'],
      ['perché è così più.Pdf', 'perché è così più-quotato.pdf'],
      ['flangia.rev.3.v2.pdf', 'flangia.rev.3.v2-quotato.pdf'],
      ['Tavola 12.A.pdf.PDF', 'Tavola 12.A.pdf-quotato.pdf'],
      ['perché NFD.pdf', 'perché NFD-quotato.pdf'],
    ];
    const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
    for (const [orig, want] of names) {
      await openBytes(page, orig, base);
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
      await openDialog(page);
      const shown = await text(dlg(page));
      await generate(page);
      const [dl] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
      check(`"${orig}" -> "${want}" (nome del file scaricato)`, dl.suggestedFilename() === want, dl.suggestedFilename());
      check(`"${orig}": il dialogo mostra lo stesso nome come "Nuovo file"`, shown.includes(`Nuovo file ${want}`), shown.slice(0, 200));
      await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
      // apre un altro file: il documento attuale ha oggetti, quindi chiede conferma
      await page.locator('.menu-btn', { hasText: 'File' }).click();
      await page.locator('.menu-item', { hasText: 'Chiudi' }).click();
      await page.locator('.dialog .btn.primary', { hasText: 'Procedi' }).click();
    }
    await ctx.close();
  }

  // ====================================================================================
  // CONFRONTO app / PDF esportato
  const SAMPLES = [
    ['a4-vettoriale', 'A4 vettoriale', 'a4-vettoriale.pdf'],
    ['a3-vettoriale', 'A3 vettoriale', 'a3-vettoriale.pdf'],
    ['a4-rotate90', 'A4 con /Rotate 90', 'a4-rotate90.pdf'],
    ['a4-cropbox', 'A4 con CropBox', 'a4-cropbox.pdf'],
    ['a4-scansione', 'A4 scansione (immagine)', 'a4-scansione.pdf'],
    ['misto-3-pagine', '3 pagine miste', 'misto-3-pagine.pdf'],
  ];
  const cmp = {};
  for (const [id, title, file] of SAMPLES) cmp[id] = await compareCase(browser, harness, { id, name: title, sample: title, sampleFile: file, keepRaw: id === 'a4-vettoriale' });
  const cmpRaw = cmp['a4-vettoriale'].results[0].m.raw;

  // PDF sintetici (non nel repository): UserUnit 2.5; /Rotate + CropBox + UserUnit; stato grafico sporco
  const synth = [
    { id: 'uu25', name: 'UserUnit 2.5 (sintetico)', fileName: 'uu25.pdf', bytes: await F.build({ pages: [{ size: [238.11, 336.76], userUnit: 2.5, raw: drawRaw(0, 0, 238.11, 336.76) }] }) },
    {
      id: 'rot90-crop-uu',
      name: '/Rotate 90 + CropBox + UserUnit 2.5 (sintetico)',
      fileName: 'rot90-crop-uu.pdf',
      bytes: await F.build({ pages: [{ size: [300, 400], crop: [20, 30, 240, 330], rotate: 90, userUnit: 2.5, raw: drawRaw(20, 30, 240, 330) }] }),
    },
    { id: 'rot270-uu', name: '/Rotate 270 + UserUnit 2.5 (sintetico)', fileName: 'rot270-uu.pdf', bytes: await F.build({ pages: [{ size: [238.11, 336.76], rotate: 270, userUnit: 2.5, raw: drawRaw(0, 0, 238.11, 336.76) }] }) },
    { id: 'rot180', name: '/Rotate 180 (sintetico)', fileName: 'rot180.pdf', bytes: await F.build({ pages: [{ rotate: 180, raw: drawRaw(0, 0, 595.276, 841.89) }] }) },
  ];
  for (const kind of ['matrix-left', 'flip-left', 'open-q', 'stray-q', 'invisible-text']) {
    // contenuto sporco + il disegno sintetico DOPO lo stato sporco non serve: l'originale e' il contenuto di dirtyContent
    synth.push({ id: `dirty-${kind}`, name: `contenuto con stato grafico sporco: ${kind} (sintetico)`, fileName: `dirty-${kind}.pdf`, bytes: await F.dirtyPdf(kind) });
  }
  for (const c of synth) cmp[c.id] = await compareCase(browser, harness, c);

  // sensibilita' delle soglie: lo stesso confronto con il PDF esportato spostato di 1, 3 e 6 pixel (0.5, 1.5 e 3 pt)
  setSection("sensibilita' delle soglie");
  {
    const raw = cmpRaw;
    const hp = await harness.newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    for (const [dx, dy, expectPass] of [[0, 0, true], [1, 0, true], [0, 1, true], [3, 0, false], [0, 3, false], [6, 6, false]]) {
      const m = await hp.evaluate(([r, T, tol, sh]) => window.compare(r.a0, r.a, r.b0, r.bb, T, tol, sh), [raw, t.INK_T, t.TOL_PX, [dx, dy]]);
      const pass = m.matchA >= 0.97 && m.matchB >= 0.97;
      info(`PDF spostato di (${dx}, ${dy}) px: ${(m.matchA * 100).toFixed(2)} % / ${(m.matchB * 100).toFixed(2)} %, p99 ${m.p99A.toFixed(2)} px`);
      check(`spostamento di (${dx}, ${dy}) px (${(Math.hypot(dx, dy) / t.ZOOM).toFixed(2)} pt): la soglia ${expectPass ? 'lo accetta' : 'lo rifiuta'}`, pass === expectPass, `${(m.matchA * 100).toFixed(2)} % / ${(m.matchB * 100).toFixed(2)} %`);
    }
    await hp.close();
  }

  // ====================================================================================
  setSection('testo estraibile, pagine senza oggetti, annotazioni');
  {
    const hp = await harness.newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    const exp = cmp['a4-vettoriale'].exp.bytes;
    const orig = cmp['a4-vettoriale'].origBytes;
    const textOf = (bytes, n) => hp.evaluate(([d, k]) => window.textOf(d, k), [b64(bytes), n]);
    const tOrig = await textOf(orig, 1);
    const tExp = await textOf(exp, 1);
    check('testo sotto le coperture: "RIFERIMENTO 100 mm" (sotto la copertura in basso) e il titolo sono ancora estraibili dal PDF esportato', tExp.includes('RIFERIMENTO 100 mm') && tExp.includes('DISEGNO FITTIZIO - GT-Pdf'), JSON.stringify(tExp));
    check('tutte le stringhe del PDF originale sono ancora nel PDF esportato', tOrig.filter((x) => x.trim()).every((x) => tExp.includes(x)), JSON.stringify({ tOrig, tExp }));
    for (const want of ['FORO Ø8 ±0.1 90° R12', 'Ø8 ±0.1', 'R12.5', 'SOPRA LA COPERTURA', 'Ø25.40 ±0.05']) check(`testo scritto dall'app estraibile dal PDF: "${want}"`, tExp.includes(want), JSON.stringify(tExp));
    check('valori automatici delle quote nel PDF (scala 0.5 mm/pt): Ø119.06 (diametro), 77.33 (allineata)', tExp.includes('Ø119.06') && tExp.includes('77.33'), JSON.stringify(tExp));

    // pagine senza oggetti: misto-3-pagine con oggetti solo sulla pagina 2
    const mixed = await compareCase(browser, harness, { id: 'misto-solo-p2', name: '3 pagine miste, oggetti solo sulla pagina 2', sample: '3 pagine miste', sampleFile: 'misto-3-pagine.pdf', untouched: [1, 3], specs: (n) => (n === 2 ? fullSpecs() : []) });
    check('3 pagine miste: la pagina 2 ha l\'inchiostro degli oggetti', mixed.results.find((r) => r.n === 2)?.m?.nA > 500);

    // annotazione con aspetto proprio sotto una copertura: nel PDF sta SOPRA (limite noto)
    setSection('annotazioni sopra le coperture');
    const stamp = await F.build({ pages: [{ raw: '0 0 1 rg 100 100 300 300 re f', stamp: { x: 150, y: 150, w: 100, h: 40 } }] });
    const { ctx, page } = await newApp(browser);
    await openBytes(page, 'con-annotazione.pdf', stamp);
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'cover', shape: 'rect', a: [0.2, 0.15], b: [0.45, 0.25] }]));
    await t.showPage(page, 1);
    const appShot = (await t.shot(page)).buf;
    await openDialog(page);
    await generate(page);
    const warn = await text(dlg(page).locator('.exp-warnings'));
    check('avviso nel dialogo: l\'annotazione resta sopra la copertura', /annotazion/.test(warn) && /sopra le coperture/.test(warn), warn);
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
    const out = readFileSync(await dl.path());
    const annots = await hp.evaluate(([d]) => window.annotsOf(d, 1), [b64(out)]);
    check('l\'annotazione e\' ancora nel PDF esportato, stesso rettangolo (150,150)-(250,190)', annots.length === 1 && JSON.stringify(annots[0].rect) === JSON.stringify([150, 150, 250, 190]), JSON.stringify(annots));
    const bShot = await hp.evaluate(([d]) => window.renderPage(d, 1, 2), [b64(out)]);
    const px = 400;
    const py = 2 * (841.89 - 170);
    const cB = await hp.evaluate(([u, x, y]) => window.colorAt(u, x, y), [bShot, px, py]);
    const cA = await hp.evaluate(([u, x, y]) => window.colorAt(u, x, y), [`data:image/png;base64,${b64(appShot)}`, px, py]);
    info(`colore al centro dell'annotazione (rossa): app ${JSON.stringify(cA)}, PDF esportato ${JSON.stringify(cB)}`);
    check('nell\'app la copertura nasconde l\'annotazione (bianco)', cA[0] > 240 && cA[1] > 240 && cA[2] > 240, JSON.stringify(cA));
    check('nel PDF esportato l\'annotazione e\' disegnata SOPRA la copertura (rosso): limite di "Copertura semplice" documentato e segnalato', cB[0] > 200 && cB[1] < 60 && cB[2] < 60, JSON.stringify(cB));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
    await ctx.close();
    await hp.close();
  }

  // ====================================================================================
  setSection('errori');
  {
    const showsOpenError = async (name, bytes) => {
      const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
      await page.setInputFiles('input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
      await page.locator('.dialog').waitFor({ timeout: 15000 });
      const title = await text(page.locator('.dialog-title'));
      const msg = await text(page.locator('.dialog-msg'));
      await page.locator('.dialog .btn').first().click();
      const stillEmpty = await page.evaluate(() => window.__gtpdf.pages().length === 0);
      await ctx.close();
      return { title, msg, stillEmpty };
    };
    const good = sampleBytes('a4-vettoriale.pdf');
    for (const [label, name, bytes] of [
      ['troncato a meta', 'troncato.pdf', good.subarray(0, good.length >> 1)],
      ['non e\' un PDF', 'finto.pdf', Buffer.from('Questo non e un PDF')],
      ['vuoto', 'vuoto.pdf', Buffer.alloc(0)],
      ['cifrato con password utente', 'cifrato-password.pdf', await F.build({ pages: [{ raw: '' }], encrypt: { userPassword: 'segreta' } })],
    ]) {
      const r = await showsOpenError(name, bytes);
      info(`APERTURA di un PDF ${label}: titolo "${r.title}", messaggio "${r.msg}"`);
      check(`PDF ${label}: l'apertura fallisce con un messaggio, nessun documento aperto (l'esportazione non si raggiunge)`, r.title.length > 0 && r.msg.length > 0 && r.stillEmpty);
    }

    // PDF che PDF.js apre ma la libreria di scrittura legge male
    const toStr = (b) => Buffer.from(b).toString('latin1');
    const mutate = (b, f) => Buffer.from(f(toStr(b)), 'latin1');
    const three = await F.build({ pages: [{ raw: '' }, { raw: '' }, { raw: '' }] });
    const cases = [
      ['Resources rotto (PDF.js 3 pagine, pdf-lib 2)', 'resources-rotto.pdf', mutate(three, (s) => s.replace(/\/Resources <<[^>]*>>/, '/Resources << /Font')), 'mismatch'],
      ['/Type /Page mancante', 'senza-type-page.pdf', mutate(good, (s) => s.replace(/\/Type \/Page\b(?!s)/g, '/TypeX /Page')), 'mismatch'],
      ['MediaBox con 3 valori', 'mediabox-rotto.pdf', mutate(good, (s) => s.replace(/\/MediaBox \[[^\]]*\]/, '/MediaBox [0 0 595]')), 'unreadable'],
    ];
    for (const [label, name, bytes, code] of cases) {
      const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
      await openBytes(page, name, bytes);
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'text', at: [0.1, 0.5], text: 'PROVA' }]));
      const beforeHash = await sha(page, 'window.__gtpdf.originalBytes()');
      await openDialog(page);
      await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
      await dlg(page).locator('.dialog-msg[role=alert]').waitFor({ timeout: 60000 });
      const title = await text(dlg(page).locator('.dialog-title'));
      const msg = await text(dlg(page).locator('.dialog-msg'));
      const detail = await text(dlg(page).locator('.exp-detail'));
      info(`ESPORTAZIONE di un PDF con ${label}: titolo "${title}" | messaggio "${msg}" | dettaglio "${detail}"`);
      check(`${label}: messaggio in italiano, dice che nulla e' stato perso, dettaglio tecnico separato`, /nulla è stato perso/.test(msg) && title.length > 0 && detail.length > 3 && !/Condividi|Scarica/.test(await text(dlg(page))));
      check(`${label}: codice atteso ${code} (titolo ${code === 'mismatch' ? 'Esportazione annullata' : 'PDF non esportabile'})`, title === (code === 'mismatch' ? 'Esportazione annullata' : 'PDF non esportabile'), title);
      check(`${label}: il dialogo offre Chiudi e Riprova`, (await dlg(page).locator('.dialog-actions .btn').allInnerTexts()).join('|') === 'Chiudi|Riprova');
      await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
      check(`${label}: dopo l'errore il lavoro c'e' ancora (2 oggetti) e Annulla e' disponibile`, (await page.evaluate(() => window.__gtpdf.objectCount())) === 2 && (await page.locator('.undo-ctl button').nth(0).isEnabled()));
      check(`${label}: l'originale non e' cambiato`, (await sha(page, 'window.__gtpdf.originalBytes()')) === beforeHash);
      await openDialog(page);
      check(`${label}: si puo' riaprire il dialogo`, (await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).count()) === 1);
      await ctx.close();
    }

    // cifrato con sole restrizioni del proprietario (utente vuoto): PDF.js lo apre, pdf-lib lo decifra e riscrive
    for (const algorithm of ['AES-256', 'AES-128', 'RC4-128']) {
      const enc = await F.build({ pages: [{ raw: 'BT /F1 12 Tf 50 700 Td (TESTO CIFRATO) Tj ET' }], encrypt: { algorithm } });
      const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
      await openBytes(page, `cifrato-${algorithm}.pdf`, enc);
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'text', at: [0.1, 0.5], text: 'AGGIUNTO' }]));
      const h0 = await sha(page, 'window.__gtpdf.originalBytes()');
      const hp = await harness.newPage();
      await hp.goto(`http://localhost:${HPORT}/`);
      await hp.waitForFunction(() => window.harnessReady === true);
      const e = await exportViaUi(page);
      const tx = await hp.evaluate(([d]) => window.textOf(d, 1), [b64(e.bytes)]);
      check(`PDF cifrato (${algorithm}, password utente vuota): si esporta, il risultato si riapre senza password e ha il testo originale e quello aggiunto`, tx.includes('TESTO CIFRATO') && tx.includes('AGGIUNTO'), JSON.stringify(tx));
      check(`PDF cifrato (${algorithm}): byte dell'originale invariati`, (await sha(page, 'window.__gtpdf.originalBytes()')) === h0);
      await hp.close();
      await ctx.close();
    }
  }

  // ====================================================================================
  setSection('iPhone: dialogo');
  {
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const stamp = await F.build({ pages: [{ raw: '0 0 1 rg 100 100 300 300 re f', stamp: { x: 150, y: 150, w: 100, h: 40 } }, { raw: '' }] });
    for (const [label, vp] of [['verticale 390x780', { width: 390, height: 780 }], ['orizzontale 780x390', { width: 780, height: 390 }], ['orizzontale 667x375', { width: 667, height: 375 }]]) {
      const { ctx, page } = await newApp(browser, { viewport: vp, dpr: 3, context: { isMobile: true, hasTouch: true, userAgent: IPHONE_UA } });
      await openBytes(page, 'Disegno con un nome piuttosto lungo per provare la riga del riepilogo.pdf', stamp);
      await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'cover', shape: 'rect', a: [0.2, 0.15], b: [0.45, 0.25] }, { k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
      await page.locator('.menu-btn', { hasText: 'File' }).tap();
      await page.locator('.menu-item', { hasText: 'Esporta PDF' }).tap();
      await dlg(page).waitFor();
      const fits = async (what) => {
        const r = await dlg(page).evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, sh: e.scrollHeight, ch: e.clientHeight, vw: innerWidth, vh: innerHeight }; });
        check(`${label}, ${what}: il dialogo sta dentro lo schermo (${Math.round(r.l)}..${Math.round(r.r)} x ${Math.round(r.t)}..${Math.round(r.b)} su ${r.vw}x${r.vh}; contenuto ${r.sh} px in ${r.ch} px, scorre: ${r.sh > r.ch})`, r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh);
      };
      await fits('scelta');
      const reach = async (sel, what) => {
        const b = dlg(page).locator(sel).first();
        await b.scrollIntoViewIfNeeded();
        const r = await b.evaluate((e) => { const x = e.getBoundingClientRect(); return { t: x.top, b: x.bottom, h: x.height, vh: innerHeight }; });
        check(`${label}: "${what}" si raggiunge scorrendo, alto ${Math.round(r.h)} px (>= 44) e dentro lo schermo`, r.h >= 44 && r.t >= 0 && r.b <= r.vh, JSON.stringify(r));
      };
      await reach('.btn:has-text("Annulla")', 'Annulla');
      await reach('.btn.primary:has-text("Esporta")', 'Esporta');
      await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).tap();
      await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 60000 });
      await fits('pronto, con avviso');
      await reach('.btn:has-text("Chiudi")', 'Chiudi');
      await reach('.btn:has-text("Scarica")', 'Scarica');
      await reach('.btn.primary:has-text("Condividi")', 'Condividi');
      await dlg(page).locator('.btn', { hasText: 'Chiudi' }).tap();
      check(`${label}: Chiudi chiude il dialogo con un tocco`, (await page.locator('.export-dialog').count()) === 0);
      await ctx.close();
    }
  }
};
