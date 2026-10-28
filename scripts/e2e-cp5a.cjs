// Prove di CP5a su Chromium: esportazione "Copertura semplice" e Condividi / Scarica.
//
// 1) CONFRONTO app / PDF esportato. Per ogni pagina dei 6 PDF di prova (e di PDF sintetici con UserUnit 2.5, /Rotate + CropBox + UserUnit, stato
//    grafico sporco, annotazioni) si mettono nell'app TUTTI i tipi di oggetto (rette e linee in ogni tipo di linea, coperture rettangolare,
//    quadrata e circolare su testo e su disegno, quote allineata/orizzontale/verticale/Ø/R con valore automatico e digitato, testi con Ø ° ±),
//    si esporta dall'interfaccia (File > Esporta PDF > Esporta > Scarica) e si confrontano, allo STESSO ZOOM (2 px per pt):
//      A0 = app senza oggetti, A = app con oggetti (screenshot del foglio: canvas di PDF.js + livello SVG),
//      B0 = originale reso da PDF.js, B = PDF esportato reso da PDF.js (stessa versione, stessi asset, stessa scala).
//    Si confrontano gli "inchiostri" (|A-A0| e |B-B0| oltre una soglia): distanza di ogni pixel di inchiostro di A dall'inchiostro piu' vicino
//    di B e viceversa, e l'errore di colore all'interno delle aree piene. Le immagini (A | B | differenze) si salvano FUORI dal repository.
// 2) Testo sotto le coperture ancora estraibile dal PDF esportato; originale invariato (SHA-256 prima e dopo); file in uscita diverso.
// 3) Dialogo: Appiattito (attivo dalla tappa 5b, qui solo che c'e' e non e' predefinito; le sue prove sono in e2e-cp5b.cjs), riepilogo, "Esporta" senza share, Condividi (File application/pdf, dentro il tocco, annullamento,
//    errori, canShare assente o falso), Scarica (octet-stream, nome), nomi con spazi / accenti / piu' punti, blob rilasciato alla chiusura.
// 4) Errori: PDF troncato, danneggiato, cifrato, e PDF che PDF.js apre ma pdf-lib no; il lavoro resta.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5a.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
// Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const lib = createE2E({ name: 'e2e-cp5a', out: process.argv[2], port: 4185, hport: 4186, zoom: 2 });
const { OUT, URL, HPORT, ZOOM, check, info, setSection, sha, shaBuf, newApp, openBytes, openSample, showPage, shot, b64 } = lib;
const fx = () => import('./export-fixtures.mjs');
const { fullSpecs } = require('./export-specs.cjs');

// ---------- Soglie del confronto (vedi il resoconto: perche' questi valori) ----------
const INK_T = 40; // differenza massima tra i canali (su 255) oltre la quale un pixel e' "inchiostro"
const TOL_PX = 2; // distanza massima ammessa tra l'inchiostro dell'app e quello del PDF, in pixel (a 2 px/pt = 1 pt)
const MIN_MATCH = 0.97; // quota minima di pixel di inchiostro entro TOL_PX dall'altro (in entrambi i sensi)
const MAX_INTERIOR_ERR = 10; // errore medio di colore (su 255) nelle aree piene
const INK_RATIO = [0.9, 1.1]; // rapporto minimo e massimo tra l'inchiostro del PDF e quello dell'app

// ---------- Server: anteprima del build di prova e pagina "harness" con PDF.js ----------
/** Esporta dall'interfaccia: File > Esporta PDF > Esporta > Scarica. Restituisce i byte scaricati e il nome proposto. */
async function exportViaUi(page) {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.locator('.menu-item', { hasText: 'Esporta PDF' }).click();
  await page.locator('.export-dialog').waitFor();
  await page.locator('.export-dialog .btn.primary', { hasText: 'Esporta' }).click();
  await page.locator('.export-dialog .exp-done-actions').waitFor({ timeout: 120000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.export-dialog .btn', { hasText: 'Scarica' }).click()]);
  const path = await dl.path();
  return { bytes: readFileSync(path), name: dl.suggestedFilename() };
}

/** Un caso del confronto: apre il PDF, mette gli oggetti, esporta, confronta tutte le pagine. */
async function compareCase(browser, harness, c) {
  setSection(`confronto: ${c.name}`);
  const { ctx, page } = await newApp(browser);
  try {
    if (c.sample) await openSample(page, c.sample);
    else await openBytes(page, c.fileName, c.bytes);
    const infos = await page.evaluate(() => window.__gtpdf.pages());
    const original = readFileSync ? null : null;
    void original;
    const before = await sha(page, 'window.__gtpdf.originalBytes()');
    const origBytes = Buffer.from(await page.evaluate(() => Array.from(window.__gtpdf.originalBytes())));
    // A0: app senza oggetti
    const A0 = [];
    for (let n = 1; n <= infos.length; n++) {
      await showPage(page, n);
      A0.push((await shot(page)).buf);
    }
    // oggetti su ogni pagina (e scala 0.5 mm/pt per i valori automatici)
    for (let n = 1; n <= infos.length; n++) {
      await page.evaluate(({ n: k, specs, scale }) => { window.__gtpdf.setScale(k, scale); window.__gtpdf.addSpecs(k, specs); }, { n, specs: c.specs ? c.specs(n, infos[n - 1]) : fullSpecs(), scale: 0.5 });
    }
    const A = [];
    for (let n = 1; n <= infos.length; n++) {
      await showPage(page, n);
      A.push((await shot(page)).buf);
    }
    const exp = await exportViaUi(page);
    writeFileSync(join(OUT, `${c.id}-quotato.pdf`), exp.bytes);
    const after = await sha(page, 'window.__gtpdf.originalBytes()');
    check('byte dell\'originale identici prima e dopo l\'esportazione (SHA-256 nel browser)', before === after, `${before} / ${after}`);
    check('il file esportato e\' diverso dall\'originale', (await shaBuf(exp.bytes)) !== before && exp.bytes.length > 0);
    check('nome proposto = nome originale senza .pdf + -quotato.pdf', exp.name === (c.fileName || `${c.sampleFile}`).replace(/\.pdf$/i, '') + '-quotato.pdf', exp.name);

    const hp = await harness.newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    const results = [];
    for (let n = 1; n <= infos.length; n++) {
      const b0 = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64(origBytes), n, ZOOM]);
      const bb = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64(exp.bytes), n, ZOOM]);
      const url = (buf) => `data:image/png;base64,${b64(buf)}`;
      if (c.untouched && c.untouched.includes(n)) {
        const same = await hp.evaluate(([x, y]) => window.maxDiff(x, y), [b0, bb]);
        check(`pagina ${n} (senza oggetti): resa da PDF.js identica pixel per pixel a quella dell'originale`, same.max === 0, JSON.stringify(same));
        results.push({ n, untouched: true });
        continue;
      }
      const m = await hp.evaluate(([a0, a, b0u, bu, T, tol]) => window.compare(a0, a, b0u, bu, T, tol), [url(A0[n - 1]), url(A[n - 1]), b0, bb, INK_T, TOL_PX]);
      if (c.keepRaw) m.raw = { a0: url(A0[n - 1]), a: url(A[n - 1]), b0, bb };
      const img = Buffer.from(m.image.split(',')[1], 'base64');
      writeFileSync(join(OUT, `${c.id}-p${n}-A_B_diff.png`), img);
      delete m.image;
      const pageInfo = infos[n - 1];
      const label = `pagina ${n} (/Rotate ${pageInfo.rotate}, UserUnit ${pageInfo.userUnit}, ${m.w}x${m.h} px)`;
      info(`${label}: inchiostro app ${m.nA} px, PDF ${m.nB} px | entro ${TOL_PX} px: ${(m.matchA * 100).toFixed(2)} % (app->PDF), ${(m.matchB * 100).toFixed(2)} % (PDF->app) | p99 ${m.p99A.toFixed(2)}/${m.p99B.toFixed(2)} px, p99.9 ${m.p999A.toFixed(2)}/${m.p999B.toFixed(2)}, max ${m.maxA.toFixed(1)}/${m.maxB.toFixed(1)} px | colore aree piene ${m.interior.toFixed(2)}/255 su ${m.interiorPx} px | rumore di base (app senza oggetti vs PDF.js senza oggetti) ${m.baseNoisePx} px | misure canvas app ${m.sizeA.join('x')} PDF ${m.sizeB.join('x')}`);
      results.push({ n, m });
      if (c.expectDifference) continue;
      check(`${label}: inchiostro dell'app presente (oggetti disegnati)`, m.nA > 500);
      check(`${label}: inchiostro del PDF presente`, m.nB > 500);
      check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro dell'app entro ${TOL_PX} px da quello del PDF`, m.matchA >= MIN_MATCH, `${(m.matchA * 100).toFixed(2)} %`);
      check(`${label}: >= ${MIN_MATCH * 100} % dell'inchiostro del PDF entro ${TOL_PX} px da quello dell'app`, m.matchB >= MIN_MATCH, `${(m.matchB * 100).toFixed(2)} %`);
      check(`${label}: colore medio delle aree piene entro ${MAX_INTERIOR_ERR}/255`, m.interior <= MAX_INTERIOR_ERR, m.interior.toFixed(2));
      // la quantita' di inchiostro cattura cio' che la distanza non vede: un errore di spessore (per es. UserUnit non diviso: 2.5 volte piu' spesso)
      // o di corpo dei testi cambia molto l'area, non la distanza dei bordi
      const ratio = m.nB / m.nA;
      check(`${label}: quantita' di inchiostro del PDF / dell'app tra ${INK_RATIO[0]} e ${INK_RATIO[1]}`, ratio >= INK_RATIO[0] && ratio <= INK_RATIO[1], ratio.toFixed(3));
    }
    // pagine senza oggetti: non ce ne sono qui; il controllo e' nel caso "pagine senza oggetti"
    await hp.close();
    return { exp, results, origBytes, infos };
  } finally {
    await ctx.close();
  }
}

// ======================================================================================================
async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  const F = await fx();
  try {
    await require('./e2e-cp5a-suites.cjs')({ browser, harness, F, compareCase, fullSpecs, newApp, openBytes, openSample, showPage, shot, exportViaUi, sha, shaBuf, check, info, setSection, OUT, URL, HPORT, b64, ZOOM, INK_T, TOL_PX });
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
