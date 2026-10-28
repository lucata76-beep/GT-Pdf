// Prove di CP5b su Chromium: esportazione "Appiattito" (pagine con oggetti rasterizzate con PDF.js + gli stessi oggetti dell'app, JPEG o PNG, 150/300/600 dpi).
//
// 1) DIALOGO: DPI e formato, riepilogo con pagine rasterizzate e pixel della pagina piu' grande, DPI fuori tetto disabilitati con il motivo (A3 a 600 dpi:
//    69.605.736 px, oltre 67.108.864), pagine di misure diverse, nessun DPI ammesso, nessuna stima di byte, avvisi, telefono (390 x 844).
// 2) CONFRONTO app / PDF appiattito (tollerante, vedi `window.envelope` in e2e-lib.cjs) sui 6 PDF di prova e sui PDF sintetici (/Rotate 90/180/270,
//    CropBox, UserUnit 2.5): l'immagine di ogni pagina con oggetti, resa da PDF.js a 2 px per pt, sta nell'inviluppo min/max della schermata dell'app e viceversa,
//    separatamente nelle aree degli oggetti e nel resto. Prova di sensibilita': la stessa pagina spostata di 3 px (1,5 pt) deve essere rifiutata.
// 3) STRUTTURA: byte dell'originale invariati (SHA-256 prima/dopo), numero/dimensioni/rotazioni/CropBox/UserUnit uguali (letti con pdf-lib e con PDF.js),
//    pagine senza oggetti identiche pixel per pixel e con lo stesso contenuto, pagine appiattite con UN'immagine e nient'altro, testo NON estraibile e
//    non presente nei byte, annotazioni e collegamenti spariti (e URI assente dai byte).
// 4) ULTIMO PIXEL SIMULATO: getImageData(w-1,h-1) restituisce nero sopra una larghezza: l'esportazione si ferma con il messaggio, il lavoro resta, si riprova a un DPI piu' basso.
// 5) AVANZAMENTO "Pagina 3 di 12", Esc ignorato durante la generazione, canvas rilasciati.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5b.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
// Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const { fullSpecs, drawRaw } = require('./export-specs.cjs');

const lib = createE2E({ name: 'e2e-cp5b', out: process.argv[2], port: 4187, hport: 4188, zoom: 2 });
const { OUT, HPORT, ZOOM, check, info, setSection, sha, shaBuf, newApp, openBytes, openSample, showPage, shot, b64 } = lib;
const fx = () => import('./export-fixtures.mjs');
const pdfLib = () => import('@cantoo/pdf-lib');

// ---------- Soglie del confronto tollerante (perche' questi valori: docs/PIANO.md, "Scelte di CP5b") ----------
const ENV_R = 1; // raggio dell'inviluppo, in pixel (a 2 px per pt = 0.5 pt)
const ENV_T = 40; // un pixel di A e' "di oggetto" se differisce dalla pagina senza oggetti di piu' di cosi' (su 255)
const ENV_GROW = 4; // l'area degli oggetti si dilata di cosi' (pixel)
const ENV_TOL = 48; // tolleranza aggiunta all'inviluppo (su 255), uguale per JPEG e PNG
const MAX_OUT = { obj: 0.02, rest: 0.01 }; // a 2 px per pt: quota massima di pixel fuori inviluppo, nelle aree degli oggetti e nel resto della pagina
// alla scala nativa dell'immagine (dpi / 72 px per pt: 1 px dell'immagine = 1 px del confronto, nessun ricampionamento di PDF.js): soglie piu' strette, per formato
const NATIVE_OUT = { jpeg: { obj: 0.015, rest: 0.005 }, png: { obj: 0.005, rest: 0.005 } };
const BIG_SHIFT = [30, 0]; // spostamento grossolano (15 pt) che le soglie (oggetti o resto della pagina) DEVONO rifiutare
const SENS_SHIFT = [3, 0]; // spostamento (px, 1.5 pt) con cui la stessa prova DEVE fallire
const MIN_RATIO_SHIFTED = 3; // di quante volte deve salire la quota fuori inviluppo negli oggetti con lo spostamento

// ---------- Strumenti ----------
const dlg = (page) => page.locator('.export-dialog');
const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim());
async function openDialog(page) {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.locator('.menu-item', { hasText: 'Esporta PDF' }).click();
  await dlg(page).waitFor();
}
async function pickFlat(page, dpi, format) {
  await dlg(page).locator('label[data-value="flat"]').click();
  if (dpi) await dlg(page).locator(`label[data-value="${dpi}"]`).click();
  if (format) await dlg(page).locator(`label[data-value="${format}"]`).click();
}
/** Esporta in "Appiattito" dall'interfaccia: File > Esporta PDF > Appiattito > dpi > formato > Esporta > Scarica. */
async function runFlatViaUi(page, { dpi, format }) {
  await openDialog(page);
  await pickFlat(page, dpi, format);
  const t0 = Date.now();
  await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
  await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 600000 });
  const ms = Date.now() - t0;
  const summary = await text(dlg(page).locator('.exp-summary'));
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('.btn', { hasText: 'Scarica' }).click()]);
  const bytes = readFileSync(await dl.path());
  await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
  return { bytes, name: dl.suggestedFilename(), ms, summary };
}
/** Come showPage ma a uno zoom qualunque `z` (px per pt): per il confronto alla scala nativa dell'immagine. */
async function showPageAt(page, n, z) {
  await page.evaluate((k) => window.__gtpdf.goTo(k), n);
  await page.waitForTimeout(300);
  await page.evaluate((zz) => window.__gtpdf.zoomTo(zz), z);
  await page.waitForFunction((zz) => {
    const c = document.querySelector('.viewer-stage canvas');
    const s = window.__gtpdf.sheet();
    return c && c.width === Math.floor(s.w * zz) && c.height === Math.floor(s.h * zz);
  }, z, { timeout: 60000 });
  await page.waitForTimeout(400);
}
const dataUrl = (buf) => `data:image/png;base64,${b64(buf)}`;
const widthPx = (pt, dpi) => Math.round((pt * dpi) / 72);

/** Valori grezzi di ogni pagina letti con pdf-lib: caselle, /Rotate, UserUnit, contenuto decodificato, XObject. */
async function pageFacts(bytes) {
  const L = await pdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const num = (o) => (o && o.asNumber ? o.asNumber() : o && o.numberValue !== undefined ? o.numberValue : null);
  const arr = (a) => (a && a.size ? Array.from({ length: a.size() }, (_, i) => num(a.lookup(i))) : null);
  const out = [];
  for (const page of doc.getPages()) {
    const node = page.node;
    const contents = node.lookup(L.PDFName.of('Contents'));
    const streams = !contents ? [] : contents instanceof L.PDFArray ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)) : [contents];
    const content = Buffer.concat(streams.map((s) => Buffer.from(L.decodePDFRawStream(s).decode())));
    const res = node.lookup(L.PDFName.of('Resources'));
    const xo = res && res.lookup ? res.lookup(L.PDFName.of('XObject')) : null;
    const xobjects = [];
    if (xo && xo.keys) for (const k of xo.keys()) {
      const st = xo.lookup(k);
      const d = st.dict;
      xobjects.push({ name: k.decodeText(), subtype: d.lookup(L.PDFName.of('Subtype'))?.decodeText?.(), w: num(d.lookup(L.PDFName.of('Width'))), h: num(d.lookup(L.PDFName.of('Height'))), filter: d.lookup(L.PDFName.of('Filter'))?.decodeText?.() ?? null, bytes: st.contents ? st.contents.length : 0 });
    }
    out.push({
      media: arr(node.MediaBox()), // con ereditarieta' dai nodi /Pages
      crop: arr(node.CropBox()),
      rotate: num(node.Rotate()) ?? 0,
      userUnit: num(node.lookup(L.PDFName.of('UserUnit'))) ?? 1,
      content: content.toString('latin1'),
      xobjects,
      annots: (() => { const a = node.lookup(L.PDFName.of('Annots')); return a && a.size ? a.size() : 0; })(),
    });
  }
  void ctx;
  return out;
}

async function harnessPage(harness) {
  const hp = await harness.newPage();
  await hp.goto(`http://localhost:${HPORT}/`);
  await hp.waitForFunction(() => window.harnessReady === true);
  return hp;
}

// ======================================================================================================
// Un caso: apre il PDF, mette gli oggetti sulle pagine `objectPages`, esporta Appiattito dall'interfaccia e verifica tutto.
async function flatCase(browser, harness, c) {
  const dpi = c.dpi ?? 150;
  const format = c.format ?? 'jpeg';
  setSection(`appiattito ${dpi} dpi ${format.toUpperCase()}: ${c.name}`);
  // alla scala nativa (fino a 300 dpi: A4 = 2480 x 3508 px, 3508 x 2480 se ruotata) il canvas deve stare per intero nel viewport, altrimenti lo screenshot si taglia
  const { ctx, page } = await newApp(browser, c.native ? { viewport: { width: 4300, height: 4300 } } : {});
  const hp = await harnessPage(harness);
  try {
    if (c.sample) await openSample(page, c.sample);
    else await openBytes(page, c.fileName, c.bytes);
    const infos = await page.evaluate(() => window.__gtpdf.pages());
    const objPages = c.objectPages ?? infos.map((_, i) => i + 1);
    const before = await sha(page, 'window.__gtpdf.originalBytes()');
    const origBytes = Buffer.from(await page.evaluate(() => Array.from(window.__gtpdf.originalBytes())));
    const A0 = {};
    const A = {};
    const A0n = {};
    const An = {};
    const nz = dpi / 72;
    for (const n of objPages) {
      await showPage(page, n);
      A0[n] = (await shot(page)).buf;
      if (c.native) {
        await showPageAt(page, n, nz);
        A0n[n] = (await shot(page)).buf;
      }
    }
    for (const n of objPages) await page.evaluate(({ n: k, specs }) => { window.__gtpdf.setScale(k, 0.5); window.__gtpdf.addSpecs(k, specs); }, { n, specs: c.specs ? c.specs(n, infos[n - 1]) : fullSpecs() });
    for (const n of objPages) {
      await showPage(page, n);
      A[n] = (await shot(page)).buf;
      if (c.native) {
        await showPageAt(page, n, nz);
        An[n] = (await shot(page)).buf;
      }
    }
    const exp = await runFlatViaUi(page, { dpi, format });
    writeFileSync(join(OUT, `${c.id}-${dpi}-${format}.pdf`), exp.bytes);
    const after = await sha(page, 'window.__gtpdf.originalBytes()');
    check("byte dell'originale identici prima e dopo l'esportazione (SHA-256 nel browser)", before === after, `${before} / ${after}`);
    check('il file esportato e\' un PDF diverso dall\'originale', exp.bytes.subarray(0, 5).toString() === '%PDF-' && (await shaBuf(exp.bytes)) !== before);
    check(`il riepilogo dice Appiattito, ${dpi} dpi, ${format.toUpperCase()} e ${objPages.length} pagine appiattite`, exp.summary.includes(`Appiattito, ${dpi} dpi, ${format.toUpperCase()}`) && new RegExp(`Pagine ${infos.length} \\(${objPages.length} appiattit[ae]\\)`).test(exp.summary), exp.summary);
    check("il controllo di lettura ha riaperto il file con tante pagine quante l'originale", exp.summary.includes(`riaperto: ${infos.length} pagin`), exp.summary);
    info(`file ${(exp.bytes.length / 1024).toFixed(0)} kB in ${(exp.ms / 1000).toFixed(1)} s dal clic su Esporta | ${exp.summary}`);

    // ---- struttura (pdf-lib) ----
    const fo = await pageFacts(origBytes);
    const fe = await pageFacts(exp.bytes);
    check('stesso numero di pagine', fo.length === fe.length, `${fo.length} / ${fe.length}`);
    const sameBoxes = fo.every((o, i) => JSON.stringify([o.media, o.crop, o.rotate, o.userUnit]) === JSON.stringify([fe[i].media, fe[i].crop, fe[i].rotate, fe[i].userUnit]));
    check('MediaBox, CropBox, /Rotate e UserUnit di ogni pagina identici a quelli dell\'originale', sameBoxes, JSON.stringify(fo.map((o, i) => [[o.media, o.crop, o.rotate, o.userUnit], [fe[i].media, fe[i].crop, fe[i].rotate, fe[i].userUnit]]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))));
    if (c.annots) check(`premessa: l'originale ha ${c.annots} annotazioni nella pagina 1 (timbro, campo, casella, collegamento)`, fo[0].annots === c.annots, String(fo[0].annots));
    const po = await hp.evaluate((d) => window.pageInfos(d), b64(origBytes));
    const pe = await hp.evaluate((d) => window.pageInfos(d), b64(exp.bytes));
    check('PDF.js vede la stessa area visibile (view), /Rotate e UserUnit di ogni pagina', JSON.stringify(po) === JSON.stringify(pe), JSON.stringify({ po, pe }));
    for (let n = 1; n <= fo.length; n++) {
      const flat = objPages.includes(n);
      if (flat) {
        const e = fe[n - 1];
        const v = po[n - 1].view;
        const swap = po[n - 1].rotate % 180 !== 0;
        const sheetW = (swap ? v[3] - v[1] : v[2] - v[0]) * po[n - 1].userUnit;
        const sheetH = (swap ? v[2] - v[0] : v[3] - v[1]) * po[n - 1].userUnit;
        // le dimensioni del foglio in pt fisici, come nel dialogo: larghezza e altezza di PDF.js con rotazione
        const expW = widthPx(sheetW, dpi);
        const expH = widthPx(sheetH, dpi);
        check(`pagina ${n}: UNA sola immagine (XObject GtFlat, ${format === 'jpeg' ? 'DCTDecode' : 'FlateDecode'}) e nessun altro XObject`, e.xobjects.length === 1 && e.xobjects[0].name === 'GtFlat' && e.xobjects[0].subtype === 'Image' && e.xobjects[0].filter === (format === 'jpeg' ? 'DCTDecode' : 'FlateDecode'), JSON.stringify(e.xobjects));
        // il foglio mostrato dall'app e' (larghezza, altezza) dopo /Rotate: PDF.js li da' gia' ruotati in `view`+`rotate`; per questo si accetta anche lo scambio
        const gotW = e.xobjects[0]?.w;
        const gotH = e.xobjects[0]?.h;
        check(`pagina ${n}: immagine di ${expW} x ${expH} px (area visibile a ${dpi} dpi)`, (gotW === expW && gotH === expH) || (gotW === expH && gotH === expW), `${gotW} x ${gotH}`);
        check(`pagina ${n}: il contenuto e' solo "q <matrice> cm /GtFlat Do Q" (nessun operatore del vecchio contenuto)`, /^\s*q\s+[-\d.e+ ]+\s+cm\s+\/GtFlat\s+Do\s+Q\s*$/.test(e.content), e.content.slice(0, 200));
        check(`pagina ${n}: nessuna annotazione, nessun collegamento`, e.annots === 0, String(e.annots));
      } else {
        check(`pagina ${n} (senza oggetti): contenuto decodificato identico a quello dell'originale`, fo[n - 1].content === fe[n - 1].content);
        check(`pagina ${n} (senza oggetti): stesse annotazioni (${fo[n - 1].annots})`, fo[n - 1].annots === fe[n - 1].annots, `${fo[n - 1].annots} / ${fe[n - 1].annots}`);
      }
    }

    // ---- testo ed annotazioni (PDF.js) ----
    const results = [];
    for (let n = 1; n <= infos.length; n++) {
      const flat = objPages.includes(n);
      const tOrig = (await hp.evaluate(([d, k]) => window.textOf(d, k), [b64(origBytes), n])).filter((s) => s.trim());
      const tExp = (await hp.evaluate(([d, k]) => window.textOf(d, k), [b64(exp.bytes), n])).filter((s) => s.trim());
      if (flat) check(`pagina ${n}: nessun testo estraibile dal PDF appiattito${tOrig.length ? ` (l'originale ne aveva ${tOrig.length} stringhe)` : ''}`, tExp.length === 0, JSON.stringify(tExp.slice(0, 5)));
      else check(`pagina ${n} (senza oggetti): testo estraibile identico a quello dell'originale (${tOrig.length} stringhe)`, JSON.stringify(tOrig) === JSON.stringify(tExp));
      const aOrig = await hp.evaluate(([d, k]) => window.annotsOf(d, k), [b64(origBytes), n]);
      const aExp = await hp.evaluate(([d, k]) => window.annotsOf(d, k), [b64(exp.bytes), n]);
      check(`pagina ${n}: annotazioni ${flat ? 'sparite (diventano parte dell\'immagine)' : 'identiche'} (${aOrig.length} -> ${aExp.length})`, flat ? aExp.length === 0 : JSON.stringify(aOrig) === JSON.stringify(aExp));
    }
    if (c.rawText || c.rawHex) {
      // testo letterale (contenuto non compresso) e testo come stringa esadecimale UTF-16BE (come pdf-lib scrive il valore di un campo di modulo)
      const hex = (t) => `feff${Buffer.from(t, 'utf16le').swap16().toString('hex')}`;
      const needles = [...(c.rawText ?? []).map((t) => ({ t, k: t, ci: false })), ...(c.rawHex ?? []).map((t) => ({ t: `${t} (esadecimale UTF-16BE)`, k: hex(t), ci: true }))];
      const norm = (b, ci) => (ci ? b.toString('latin1').toLowerCase() : b.toString('latin1'));
      for (const { t, k, ci } of needles) {
        check(`premessa: "${t}" e' nei byte dell'originale (non compresso)`, norm(origBytes, ci).includes(k));
        check(`"${t}" NON e' piu' nei byte del PDF appiattito (nemmeno come contenuto orfano)`, !norm(exp.bytes, ci).includes(k));
      }
    }

    // ---- resa: pagine senza oggetti identiche, pagine appiattite nell'inviluppo ----
    for (let n = 1; n <= infos.length; n++) {
      const b0 = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64(origBytes), n, ZOOM]);
      const bb = await hp.evaluate(([d, k, s]) => window.renderPage(d, k, s), [b64(exp.bytes), n, ZOOM]);
      if (!objPages.includes(n)) {
        const same = await hp.evaluate(([x, y]) => window.maxDiff(x, y), [b0, bb]);
        check(`pagina ${n} (senza oggetti): resa da PDF.js identica pixel per pixel a quella dell'originale`, same.max === 0, JSON.stringify(same));
        continue;
      }
      const tol = ENV_TOL;
      const run = (shift) => hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [dataUrl(A0[n]), dataUrl(A[n]), bb, { r: ENV_R, tol, T: ENV_T, grow: ENV_GROW, shift, noImage: shift !== null }]);
      const m = await run(null);
      writeFileSync(join(OUT, `${c.id}-${dpi}-${format}-p${n}-A_B_fuori.png`), Buffer.from(m.image.split(',')[1], 'base64'));
      delete m.image;
      const q = (a, b) => (b ? a / b : 0);
      const label = `pagina ${n} (/Rotate ${po[n - 1].rotate}, UserUnit ${po[n - 1].userUnit}, ${m.w}x${m.h} px)`;
      info(`${label}: fuori inviluppo (r=${ENV_R}, tol=${tol}) | oggetti ${m.nObj} px: PDF ${(q(m.outBObj, m.nObj) * 100).toFixed(2)} %, app ${(q(m.outAObj, m.nObj) * 100).toFixed(2)} % | resto ${m.nRest} px: PDF ${(q(m.outBRest, m.nRest) * 100).toFixed(2)} %, app ${(q(m.outARest, m.nRest) * 100).toFixed(2)} % | eccesso massimo PDF ${m.maxBExcess}, app ${m.maxAExcess} | misure app ${m.sizeA.join('x')} PDF ${m.sizeB.join('x')}`);
      results.push({ n, m });
      {
        // spostamento grossolano (15 pt): deve essere rifiutato (errori di posizione, scala o rotazione dell'immagine)
        const g = await run(BIG_SHIFT);
        const go = Math.max(q(g.outBObj, g.nObj), q(g.outAObj, g.nObj));
        const gr = Math.max(q(g.outBRest, g.nRest), q(g.outARest, g.nRest));
        check(`${label}: con il PDF spostato di ${BIG_SHIFT[0]} px (${BIG_SHIFT[0] / ZOOM} pt) le soglie lo rifiutano (errori grossolani di posizione, scala, rotazione)`, go > MAX_OUT.obj || gr > MAX_OUT.rest, `oggetti ${(go * 100).toFixed(2)} % (soglia ${MAX_OUT.obj * 100} %), resto ${(gr * 100).toFixed(2)} % (soglia ${MAX_OUT.rest * 100} %)`);
      }
      if (c.native) {
        const bn = await hp.evaluate(([d, k, z]) => window.renderPage(d, k, z), [b64(exp.bytes), n, nz]);
        const runN = (shift) => hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [dataUrl(A0n[n]), dataUrl(An[n]), bn, { r: ENV_R, tol: ENV_TOL, T: ENV_T, grow: ENV_GROW * 2, shift, noImage: true }]);
        const mn = await runN(null);
        const sn = await runN(SENS_SHIFT);
        const lab = `${label}, scala nativa ${nz.toFixed(3)} px/pt (${mn.w}x${mn.h} px)`;
        const NO = NATIVE_OUT[format];
        const worst = (z, k) => Math.max(q(z[`outB${k}`], z[`n${k}`]), q(z[`outA${k}`], z[`n${k}`]));
        info(`${lab}: fuori inviluppo | oggetti ${(worst(mn, 'Obj') * 100).toFixed(2)} % | resto ${(worst(mn, 'Rest') * 100).toFixed(2)} % | spostato di ${SENS_SHIFT[0]} px (${(SENS_SHIFT[0] / nz).toFixed(2)} pt): oggetti ${(worst(sn, 'Obj') * 100).toFixed(2)} %, resto ${(worst(sn, 'Rest') * 100).toFixed(2)} %`);
        check(`${lab}: aree degli oggetti <= ${NO.obj * 100} % fuori inviluppo`, worst(mn, 'Obj') <= NO.obj, `${(worst(mn, 'Obj') * 100).toFixed(2)} %`);
        check(`${lab}: resto della pagina <= ${NO.rest * 100} % fuori inviluppo`, worst(mn, 'Rest') <= NO.rest, `${(worst(mn, 'Rest') * 100).toFixed(2)} %`);
        check(`${lab}: con il PDF spostato di ${SENS_SHIFT[0]} px (${(SENS_SHIFT[0] / nz).toFixed(2)} pt) la soglia lo rifiuta`, worst(sn, 'Obj') > NO.obj || worst(sn, 'Rest') > NO.rest, `oggetti ${(worst(sn, 'Obj') * 100).toFixed(2)} %, resto ${(worst(sn, 'Rest') * 100).toFixed(2)} %`);
      }
      if (!c.sweep) {
        // lo stesso confronto sull'inchiostro di 5a (distanza dei bordi, colore delle aree piene, quantita'): solo come dato
        const k = await hp.evaluate(([a0, a, b0u, bu, T, tl]) => window.compare(a0, a, b0u, bu, T, tl), [dataUrl(A0[n]), dataUrl(A[n]), b0, bb, 40, 2]);
        delete k.image;
        info(`${label}: confronto sull'inchiostro (come 5a): app->PDF ${(k.matchA * 100).toFixed(2)} %, PDF->app ${(k.matchB * 100).toFixed(2)} % entro 2 px | colore aree piene ${k.interior.toFixed(2)}/255 su ${k.interiorPx} px | inchiostro PDF/app ${(k.nB / k.nA).toFixed(3)} (${k.nB}/${k.nA})`);
      }
      if (c.sweep) {
        // Taratura delle soglie (CP5B_SWEEP=1): quota fuori inviluppo per raggio, tolleranza e spostamento. Nessun controllo: i dati servono a scegliere le soglie.
        const grid = [];
        for (const r of [1, 2, 3]) for (const t of [16, 32, 48]) for (const shift of [null, [2, 0], [3, 0], [0, 3]]) {
          const g = await hp.evaluate(([a0, a, b, o]) => window.envelope(a0, a, b, o), [dataUrl(A0[n]), dataUrl(A[n]), bb, { r, tol: t, T: ENV_T, grow: ENV_GROW, shift, noImage: true }]);
          grid.push({ r, tol: t, shift, nObj: g.nObj, nRest: g.nRest, outBObj: g.outBObj, outAObj: g.outAObj, outBRest: g.outBRest, outARest: g.outARest });
        }
        writeFileSync(join(OUT, `sweep-${c.id}-${dpi}-${format}-p${n}.json`), JSON.stringify(grid));
        continue;
      }
      check(`${label}: la resa dell'app ha oggetti (area degli oggetti non vuota)`, m.nObj > 500, String(m.nObj));
      check(`${label}: PDF appiattito nell'inviluppo dell'app: aree degli oggetti <= ${MAX_OUT.obj * 100} % fuori`, q(m.outBObj, m.nObj) <= MAX_OUT.obj, `${(q(m.outBObj, m.nObj) * 100).toFixed(2)} %`);
      check(`${label}: app nell'inviluppo del PDF appiattito: aree degli oggetti <= ${MAX_OUT.obj * 100} % fuori`, q(m.outAObj, m.nObj) <= MAX_OUT.obj, `${(q(m.outAObj, m.nObj) * 100).toFixed(2)} %`);
      check(`${label}: PDF appiattito nell'inviluppo dell'app: resto della pagina <= ${MAX_OUT.rest * 100} % fuori`, q(m.outBRest, m.nRest) <= MAX_OUT.rest, `${(q(m.outBRest, m.nRest) * 100).toFixed(2)} %`);
      check(`${label}: app nell'inviluppo del PDF appiattito: resto della pagina <= ${MAX_OUT.rest * 100} % fuori`, q(m.outARest, m.nRest) <= MAX_OUT.rest, `${(q(m.outARest, m.nRest) * 100).toFixed(2)} %`);
      if (c.sensitivity && n === c.sensitivity) {
        const s = await run(SENS_SHIFT);
        delete s.image;
        const rejected = q(s.outBObj, s.nObj) > MAX_OUT.obj || q(s.outAObj, s.nObj) > MAX_OUT.obj || q(s.outBRest, s.nRest) > MAX_OUT.rest || q(s.outARest, s.nRest) > MAX_OUT.rest;
        const base = Math.max(q(m.outBObj, m.nObj), q(m.outAObj, m.nObj));
        const shifted = Math.max(q(s.outBObj, s.nObj), q(s.outAObj, s.nObj));
        info(`sensibilita': PDF spostato di (${SENS_SHIFT.join(', ')}) px: oggetti ${(q(s.outBObj, s.nObj) * 100).toFixed(2)} % / ${(q(s.outAObj, s.nObj) * 100).toFixed(2)} %, resto ${(q(s.outBRest, s.nRest) * 100).toFixed(2)} % / ${(q(s.outARest, s.nRest) * 100).toFixed(2)} % (senza spostamento: oggetti ${(base * 100).toFixed(2)} %)`);
        check(`sensibilita': con il PDF spostato di ${SENS_SHIFT[0]} px (${(SENS_SHIFT[0] / ZOOM).toFixed(1)} pt) la stessa soglia lo rifiuta`, rejected, `oggetti ${(shifted * 100).toFixed(2)} %`);
        check(`sensibilita': lo spostamento fa salire la quota fuori inviluppo negli oggetti di almeno ${MIN_RATIO_SHIFTED} volte`, shifted >= MIN_RATIO_SHIFTED * Math.max(base, 0.001), `${(shifted * 100).toFixed(2)} % contro ${(base * 100).toFixed(2)} %`);
      }
    }
    return { exp, origBytes, results, infos, summary: exp.summary };
  } finally {
    await hp.close();
    await ctx.close();
  }
}

// ======================================================================================================
async function dialogSuite(browser, F) {
  const FIT = ' px, oltre ';
  void FIT;
  // ---------- A4 vettoriale ----------
  setSection('dialogo: A4 vettoriale');
  {
    const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
    await openSample(page, 'A4 vettoriale');
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'text', at: [0.1, 0.5], text: 'PROVA' }]));
    await openDialog(page);
    const radios = () => page.$$eval('.export-dialog input[type=radio]', (els) => els.map((e) => ({ n: e.name, v: e.value, checked: e.checked, disabled: e.disabled })));
    let r = await radios();
    check('"Appiattito" attivo (non disabilitato) e non predefinito', r.find((x) => x.v === 'flat')?.disabled === false && r.find((x) => x.v === 'flat')?.checked === false, JSON.stringify(r));
    check('con "Copertura semplice" le opzioni di Appiattito (DPI, formato) sono nascoste e gli avvisi di Appiattito anche', (await dlg(page).locator('.exp-flat-opts').isHidden()) && (await dlg(page).locator('.exp-flat-warn').isHidden()));
    await pickFlat(page);
    r = await radios();
    check('Appiattito: DPI 150, 300 e 600 tutti attivi per un A4', ['150', '300', '600'].every((v) => r.find((x) => x.n === 'exp-dpi' && x.v === v)?.disabled === false), JSON.stringify(r));
    check('DPI predefinito 300 e formato predefinito JPEG', r.find((x) => x.n === 'exp-dpi' && x.v === '300')?.checked === true && r.find((x) => x.n === 'exp-fmt' && x.v === 'jpeg')?.checked === true, JSON.stringify(r));
    check('formati JPEG e PNG tutti e due disponibili', r.filter((x) => x.n === 'exp-fmt').length === 2 && r.filter((x) => x.n === 'exp-fmt').every((x) => !x.disabled));
    let body = await text(dlg(page));
    check('riepilogo: Pagine appiattite 1 di 1', body.includes('Pagine appiattite 1 di 1'), body);
    check('riepilogo a 300 dpi: pagina piu\' grande 2480 × 3508 px = 8.699.840 px', body.includes('2480 × 3508 px = 8.699.840 px'), body);
    await dlg(page).locator('label[data-value="150"]').click();
    body = await text(dlg(page));
    check('a 150 dpi: 1240 × 1754 px = 2.174.960 px', body.includes('1240 × 1754 px = 2.174.960 px'), body);
    await dlg(page).locator('label[data-value="600"]').click();
    body = await text(dlg(page));
    check('a 600 dpi: 4961 × 7016 px = 34.806.376 px (A4 ammesso, sotto 67.108.864)', body.includes('4961 × 7016 px = 34.806.376 px'), body);
    check('il riepilogo riporta Modalita\' Appiattito, 600 dpi, JPEG', body.includes('Modalità Appiattito, 600 dpi, JPEG'), body);
    await dlg(page).locator('label[data-value="png"]').click();
    body = await text(dlg(page));
    check('scegliendo PNG il riepilogo diventa Appiattito, 600 dpi, PNG', body.includes('Modalità Appiattito, 600 dpi, PNG'), body);
    check('niente stime di peso o di tempo prima di generare', !/~\s*\d|stimat|\d+(\.\d+)?\s*(kB|MB|GB)|\b\d+\s*s\b/.test(body.replace(/\d{1,3}(\.\d{3})+ px/g, '')), body);
    const warn = await text(dlg(page).locator('.exp-flat-warn'));
    check('avviso: testo non selezionabile e collegamenti che spariscono', /testo non è più selezionabile/.test(warn) && /collegamenti spariscono/.test(warn), warn);
    check('avviso: annotazioni e campi diventano parte dell\'immagine, collegamenti non disegnati', /Annotazioni.*diventano parte dell'immagine/.test(warn) && /campi non restano compilabili/.test(warn) && /collegamenti non si disegnano/.test(warn), warn);
    check('avviso: pagine senza oggetti identiche; memoria e ricaricamento di Safari', /senza oggetti restano identiche/.test(warn) && /in memoria/.test(warn) && /Safari ricarica/.test(warn), warn);
    check('Esporta attivo', await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).isEnabled());
    const heights = await dlg(page).locator('.btn:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check('pulsanti alti almeno 44 px', heights.every((x) => x >= 44), heights.join(','));
    await dlg(page).locator('label[data-value="simple"]').click();
    check('tornando a "Copertura semplice" le opzioni di Appiattito si nascondono di nuovo', await dlg(page).locator('.exp-flat-opts').isHidden());
    await ctx.close();
  }

  // ---------- A3: 600 dpi fuori tetto ----------
  setSection('dialogo: A3, DPI fuori tetto');
  {
    const { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
    await openSample(page, 'A3 vettoriale');
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
    await openDialog(page);
    await pickFlat(page);
    const rs = await page.$$eval('.export-dialog input[name=exp-dpi]', (els) => els.map((e) => ({ v: e.value, checked: e.checked, disabled: e.disabled })));
    check('A3: 150 e 300 dpi attivi, 600 dpi DISABILITATO', JSON.stringify(rs.map((x) => [x.v, x.disabled])) === JSON.stringify([['150', false], ['300', false], ['600', true]]), JSON.stringify(rs));
    const body = await text(dlg(page));
    check('motivo mostrato: "A3 a 600 dpi: 69.605.736 px, oltre 67.108.864"', /\(A3\) a 600 dpi: 69\.605\.736 px, oltre 67\.108\.864/.test(body), body);
    check('il DPI predefinito resta 300 (ammesso) e a 300 la pagina piu\' grande (A3 in orizzontale) e\' 4961 × 3508 px = 17.403.188 px', rs.find((x) => x.v === '300')?.checked && body.includes('4961 × 3508 px = 17.403.188 px'), body);
    // un DPI disabilitato non si puo' scegliere, nemmeno forzando il clic
    await dlg(page).locator('label[data-value="600"]').click({ force: true, timeout: 2000 }).catch(() => {});
    const still = await page.$eval('.export-dialog input[name=exp-dpi][value="600"]', (e) => e.checked);
    check('toccando il 600 dpi disabilitato non si seleziona', still === false);
    check('Esporta resta attivo (150 e 300 sono ammessi)', await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).isEnabled());
    await ctx.close();
  }

  // ---------- misure diverse, nessun DPI ammesso, nessun oggetto ----------
  setSection('dialogo: pagine di misure diverse e casi limite');
  {
    const a3 = [841.89, 1190.55];
    const mixed = await F.build({ pages: [{ raw: 'BT /F1 12 Tf 50 700 Td (A4) Tj ET' }, { size: a3, raw: 'BT /F1 12 Tf 50 1000 Td (A3) Tj ET' }, { raw: '' }] });
    let { ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } });
    await openBytes(page, 'misure-diverse.pdf', mixed);
    await page.evaluate(() => { window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]); window.__gtpdf.addSpecs(2, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]); });
    await openDialog(page);
    await pickFlat(page);
    let rs = await page.$$eval('.export-dialog input[name=exp-dpi]', (els) => els.map((e) => ({ v: e.value, disabled: e.disabled })));
    let body = await text(dlg(page));
    check('A4 (pagina 1) + A3 (pagina 2) con oggetti su tutte e due: 600 dpi disabilitato per la pagina A3', JSON.stringify(rs.map((x) => x.disabled)) === '[false,false,true]' && /Pagina 2 \(A3\) a 600 dpi: 69\.605\.736 px, oltre 67\.108\.864/.test(body), body + JSON.stringify(rs));
    check('riepilogo: 2 pagine appiattite su 3, pagina piu\' grande = la pagina 2 (A3)', body.includes('Pagine appiattite 2 di 3') && /Pagina più grande 3508 × 4961 px = 17\.403\.188 px \(Pagina 2 \(A3\)\)/.test(body), body);
    await ctx.close();

    // oggetti solo sulla pagina A4: il calcolo e' sulle pagine CON oggetti, 600 dpi e' ammesso
    ({ ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } }));
    await openBytes(page, 'misure-diverse.pdf', mixed);
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
    await openDialog(page);
    await pickFlat(page, '600');
    rs = await page.$$eval('.export-dialog input[name=exp-dpi]', (els) => els.map((e) => ({ v: e.value, disabled: e.disabled })));
    body = await text(dlg(page));
    check('oggetti solo sulla pagina A4: 600 dpi ammesso (la pagina A3 senza oggetti non conta)', JSON.stringify(rs.map((x) => x.disabled)) === '[false,false,false]', JSON.stringify(rs));
    check('riepilogo: 1 pagina appiattita su 3; a 600 dpi 4961 × 7016 px = 34.806.376 px (Pagina 1 (A4))', body.includes('Pagine appiattite 1 di 3') && /4961 × 7016 px = 34\.806\.376 px \(Pagina 1 \(A4\)\)/.test(body), body);
    await ctx.close();

    // nessun DPI entra: 4000 x 4000 pt con un oggetto (a 150 dpi: 8333 x 8333 = 69.438.889 px > 67.108.864)
    const huge = await F.build({ pages: [{ size: [4000, 4000], raw: '' }] });
    ({ ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } }));
    await openBytes(page, 'enorme.pdf', huge);
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
    await openDialog(page);
    await pickFlat(page);
    rs = await page.$$eval('.export-dialog input[name=exp-dpi]', (els) => els.map((e) => ({ v: e.value, disabled: e.disabled })));
    body = await text(dlg(page));
    check('pagina di 4000 x 4000 pt: nessun DPI ammesso (150, 300 e 600 disabilitati)', rs.every((x) => x.disabled), JSON.stringify(rs));
    check('Esporta disabilitato e nota "Nessun DPI entra nel tetto di 67.108.864 px"', (await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).isDisabled()) && body.includes('Nessun DPI entra nel tetto di 67.108.864 px'), body);
    check('i motivi dei tre DPI citano la pagina e i pixel', rs.length === 3 && /Pagina 1 .* a 150 dpi: 69\.438\.889 px, oltre 67\.108\.864/.test(body), body);
    await dlg(page).locator('label[data-value="simple"]').click();
    check('con "Copertura semplice" Esporta torna attivo', await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).isEnabled());
    await ctx.close();

    // nessun oggetto: nessuna pagina verra' appiattita
    ({ ctx, page } = await newApp(browser, { viewport: { width: 1280, height: 900 } }));
    await openSample(page, 'A4 vettoriale');
    await openDialog(page);
    await pickFlat(page);
    body = await text(dlg(page));
    check('senza oggetti: nota "Non ci sono pagine con oggetti: nessuna pagina verrà appiattita"', body.includes('Non ci sono pagine con oggetti: nessuna pagina verrà appiattita'), body);
    check('senza oggetti: Pagine appiattite 0 di 1', body.includes('Pagine appiattite 0 di 1'), body);
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 60000 });
    const done = await text(dlg(page).locator('.exp-summary'));
    check('senza oggetti l\'esportazione riesce: 0 pagine appiattite e nessuna immagine inserita', /Pagine 1 \(0 appiattite\)/.test(done) && !/Immagini inserite [1-9]/.test(done), done);
    await ctx.close();
  }

  // ---------- telefono ----------
  setSection('dialogo: telefono 390 x 844');
  {
    const { ctx, page } = await newApp(browser, { viewport: { width: 390, height: 844 }, dpr: 3, context: { hasTouch: true, isMobile: true } });
    await openSample(page, 'A3 vettoriale');
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }]));
    await page.locator('.menu-btn', { hasText: 'File' }).tap();
    await page.locator('.menu-item', { hasText: 'Esporta PDF' }).tap();
    await dlg(page).waitFor();
    await dlg(page).locator('label[data-value="flat"]').tap();
    const m = await page.evaluate(() => {
      const d = document.querySelector('.export-dialog');
      const r = d.getBoundingClientRect();
      const sizes = [...d.querySelectorAll('label.exp-opt, label.exp-mode, .btn')].filter((e) => e.offsetParent !== null).map((e) => ({ t: e.textContent.trim().slice(0, 30), h: e.getBoundingClientRect().height, off: e.classList.contains('exp-opt-off') }));
      return { w: r.width, left: r.left, right: r.right, vw: innerWidth, scrollW: d.scrollWidth, clientW: d.clientWidth, scrollH: d.scrollHeight, clientH: d.clientHeight, overflowY: getComputedStyle(d).overflowY, sizes };
    });
    info(`dialogo ${m.w.toFixed(0)} px su ${m.vw}, contenuto ${m.scrollH} px in ${m.clientH} px (overflow-y ${m.overflowY})`);
    check('il dialogo sta nella larghezza dello schermo, senza scorrimento orizzontale', m.left >= 0 && m.right <= m.vw && m.scrollW <= m.clientW, JSON.stringify(m));
    check('se il contenuto supera lo schermo, il dialogo scorre in verticale', m.scrollH <= m.clientH || m.overflowY === 'auto' || m.overflowY === 'scroll', JSON.stringify(m));
    check('le opzioni e i pulsanti sono alti almeno 44 px', m.sizes.every((s) => s.h >= 44), JSON.stringify(m.sizes.filter((s) => s.h < 44)));
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).scrollIntoViewIfNeeded();
    const inView = await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    check('dopo lo scorrimento il pulsante Esporta e\' raggiungibile sullo schermo', inView);
    await page.screenshot({ path: join(OUT, 'dialogo-telefono.png') });
    await ctx.close();
  }
}

// ======================================================================================================
const NATIVE_IDS = new Set(['a4-vettoriale', 'a4-scansione', 'a4-rotate90', 'a4-cropbox', 'rot90-crop-uu']); // casi confrontati anche alla scala nativa dell'immagine (150 e 300 dpi)
const SAMPLES = [
  ['a4-vettoriale', 'A4 vettoriale', 'a4-vettoriale.pdf'],
  ['a3-vettoriale', 'A3 vettoriale', 'a3-vettoriale.pdf'],
  ['a4-rotate90', 'A4 con /Rotate 90', 'a4-rotate90.pdf'],
  ['a4-cropbox', 'A4 con CropBox', 'a4-cropbox.pdf'],
  ['a4-scansione', 'A4 scansione (immagine)', 'a4-scansione.pdf'],
  ['misto-3-pagine', '3 pagine miste', 'misto-3-pagine.pdf'],
];

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser, harness } = servers;
  const F = await fx();
  try {
    if (process.env.CP5B_NATIVE === '1') {
      // solo il confronto alla scala nativa (per tarare NATIVE_OUT)
      for (const [id, title, file] of SAMPLES.filter(([i]) => NATIVE_IDS.has(i))) {
        await flatCase(browser, harness, { id, name: title, sample: title, sampleFile: file, dpi: 150, format: 'jpeg', native: true });
        await flatCase(browser, harness, { id, name: title, sample: title, sampleFile: file, dpi: 300, format: 'png', native: true });
      }
      const c = { id: 'rot90-crop-uu', name: '/Rotate 90 + CropBox + UserUnit 2.5 (sintetico)', fileName: 'rot90-crop-uu.pdf', bytes: await F.build({ pages: [{ size: [300, 400], crop: [20, 30, 240, 330], rotate: 90, userUnit: 2.5, raw: drawRaw(20, 30, 240, 330) }] }) };
      await flatCase(browser, harness, { ...c, dpi: 150, format: 'jpeg', native: true });
      await flatCase(browser, harness, { ...c, dpi: 300, format: 'png', native: true });
      for (const [dpi, format] of [[150, 'jpeg'], [300, 'png']]) await flatCase(browser, harness, { id: 'a4-annotazioni', name: 'A4 con annotazioni', sample: 'A4 con annotazioni', sampleFile: 'a4-annotazioni.pdf', dpi, format, native: true, annots: 4, rawText: ['https://example.com/', 'TIMBRO FITTIZIO'], rawHex: ['Campo compilato'] });
      await flatCase(browser, harness, { id: 'a3-vettoriale', name: 'A3 vettoriale', sample: 'A3 vettoriale', dpi: 300, format: 'png' });
      await flatCase(browser, harness, { id: 'rot180', name: '/Rotate 180 (sintetico)', fileName: 'rot180.pdf', bytes: await F.build({ pages: [{ rotate: 180, raw: drawRaw(0, 0, 595.276, 841.89) }] }), dpi: 150, format: 'jpeg' });
      await lib.stopAll(servers);
      lib.finish();
      return;
    }
    if (process.env.CP5B_SWEEP === '1') {
      for (const [id, title, file, dpi, format] of [['a4-vettoriale', 'A4 vettoriale', 'a4-vettoriale.pdf', 150, 'jpeg'], ['a4-vettoriale', 'A4 vettoriale', 'a4-vettoriale.pdf', 300, 'png'], ['a4-scansione', 'A4 scansione (immagine)', 'a4-scansione.pdf', 150, 'jpeg'], ['a4-cropbox', 'A4 con CropBox', 'a4-cropbox.pdf', 300, 'png'], ['a4-rotate90', 'A4 con /Rotate 90', 'a4-rotate90.pdf', 150, 'jpeg'], ['a3-vettoriale', 'A3 vettoriale', 'a3-vettoriale.pdf', 300, 'png']]) {
        await flatCase(browser, harness, { id, name: title, sample: title, sampleFile: file, dpi, format, sweep: true });
      }
      await lib.stopAll(servers);
      lib.finish();
      return;
    }
    await dialogSuite(browser, F);

    // ---- i 6 PDF di prova: JPEG a 150 dpi, PNG a 300 dpi ----
    for (const [id, title, file] of SAMPLES) {
      await flatCase(browser, harness, { id, name: title, sample: title, sampleFile: file, dpi: 150, format: 'jpeg', sensitivity: id === 'a4-vettoriale' ? 1 : 0, native: NATIVE_IDS.has(id) });
      await flatCase(browser, harness, { id, name: title, sample: title, sampleFile: file, dpi: 300, format: 'png', native: NATIVE_IDS.has(id) });
    }

    // ---- pagina con annotazioni fittizie (timbro, campo, casella, collegamento): diventano parte dell'immagine, il collegamento e il suo indirizzo spariscono ----
    for (const [dpi, format] of [[150, 'jpeg'], [300, 'png']]) {
      await flatCase(browser, harness, { id: 'a4-annotazioni', name: 'A4 con annotazioni', sample: 'A4 con annotazioni', sampleFile: 'a4-annotazioni.pdf', dpi, format, native: true, annots: 4, rawText: ['https://example.com/', 'TIMBRO FITTIZIO'], rawHex: ['Campo compilato'] });
    }

    // ---- PDF sintetici: /Rotate, CropBox, UserUnit 2.5 ----
    const SYN = [
      { id: 'uu25', name: 'UserUnit 2.5 (sintetico)', fileName: 'uu25.pdf', bytes: await F.build({ pages: [{ size: [238.11, 336.76], userUnit: 2.5, raw: drawRaw(0, 0, 238.11, 336.76) }] }) },
      { id: 'rot90-crop-uu', name: '/Rotate 90 + CropBox + UserUnit 2.5 (sintetico)', fileName: 'rot90-crop-uu.pdf', bytes: await F.build({ pages: [{ size: [300, 400], crop: [20, 30, 240, 330], rotate: 90, userUnit: 2.5, raw: drawRaw(20, 30, 240, 330) }] }) },
      { id: 'rot270-uu', name: '/Rotate 270 + UserUnit 2.5 (sintetico)', fileName: 'rot270-uu.pdf', bytes: await F.build({ pages: [{ size: [238.11, 336.76], rotate: 270, userUnit: 2.5, raw: drawRaw(0, 0, 238.11, 336.76) }] }) },
      { id: 'rot180', name: '/Rotate 180 (sintetico)', fileName: 'rot180.pdf', bytes: await F.build({ pages: [{ rotate: 180, raw: drawRaw(0, 0, 595.276, 841.89) }] }) },
    ];
    for (const c of SYN) {
      await flatCase(browser, harness, { ...c, dpi: 150, format: 'jpeg', rawText: ['TITOLO FITTIZIO SINTETICO', 'RIFERIMENTO FITTIZIO'], native: NATIVE_IDS.has(c.id) });
      await flatCase(browser, harness, { ...c, dpi: 300, format: 'png', native: NATIVE_IDS.has(c.id) });
    }

    // ---- 3 pagine miste con oggetti solo sulla pagina 2: pagine 1 e 3 invariate ----
    for (const [dpi, format] of [[150, 'jpeg'], [300, 'png']]) {
      await flatCase(browser, harness, { id: 'misto-solo-p2', name: '3 pagine miste, oggetti solo sulla pagina 2', sample: '3 pagine miste', objectPages: [2], dpi, format, specs: () => fullSpecs() });
    }
    // ---- A4 a 600 dpi: 34.806.376 px ----
    await flatCase(browser, harness, { id: 'a4-600', name: 'A4 vettoriale a 600 dpi', sample: 'A4 vettoriale', dpi: 600, format: 'jpeg' });

    await annotationSuite(browser, harness, F);
    await lastPixelSuite(browser, harness, F);
    await progressSuite(browser, F);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}

// ======================================================================================================
// Annotazioni (opzione (b)): nelle pagine appiattite timbri, note, campi e collegamenti diventano parte dell'immagine come li disegna PDF.js;
// i collegamenti non si disegnano e il loro indirizzo non resta nel file.
async function annotationSuite(browser, harness, F) {
  setSection('appiattito: annotazioni e collegamenti');
  const L = await pdfLib();
  const URI = 'https://esempio.invalid/riservato-gt-pdf';
  const bytes = await F.build({
    pages: [
      {
        raw: '0 0 1 rg 100 100 300 300 re f',
        stamp: { x: 150, y: 150, w: 100, h: 40 },
        draw: (page) => {
          const c = page.doc.context;
          const link = c.register(c.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 150, 80], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: L.PDFString.of(URI) } }));
          page.node.addAnnot(link);
        },
      },
    ],
  });
  const { ctx, page } = await newApp(browser);
  const hp = await harnessPage(harness);
  try {
    await openBytes(page, 'con-annotazioni.pdf', bytes);
    // la copertura nasconde meta' del timbro (x 119..178 su 150..250): il timbro e' sopra la copertura nell'originale, sotto negli oggetti dell'app
    await page.evaluate(() => window.__gtpdf.addSpecs(1, [{ k: 'cover', shape: 'rect', a: [0.2, 0.15], b: [0.3, 0.25] }]));
    await showPage(page, 1);
    const appShot = (await shot(page)).buf;
    const orig = Buffer.from(await page.evaluate(() => Array.from(window.__gtpdf.originalBytes())));
    const aOrig = await hp.evaluate(([d]) => window.annotsOf(d, 1), [b64(orig)]);
    check('premessa: l\'originale ha un timbro e un collegamento', aOrig.length === 2 && aOrig.some((a) => a.subtype === 'Stamp') && aOrig.some((a) => a.subtype === 'Link'), JSON.stringify(aOrig));
    check('premessa: l\'indirizzo del collegamento e\' nei byte dell\'originale', orig.toString('latin1').includes(URI));
    const exp = await runFlatViaUi(page, { dpi: 150, format: 'png' });
    check('il dialogo avvisa PRIMA che i collegamenti spariscono (gia\' verificato nel dialogo); qui: il risultato non ha annotazioni', (await hp.evaluate(([d]) => window.annotsOf(d, 1), [b64(exp.bytes)])).length === 0);
    check('l\'indirizzo del collegamento NON e\' piu\' nei byte del PDF appiattito', !exp.bytes.toString('latin1').includes(URI) && !exp.bytes.toString('latin1').includes('esempio.invalid'));
    const bShot = await hp.evaluate(([d]) => window.renderPage(d, 1, 2), [b64(exp.bytes)]);
    const xLeft = 2 * 160; // x 160 pt: sotto la copertura (119..178)
    const xRight = 2 * 230; // x 230 pt: timbro visibile
    const y = 2 * (841.89 - 170);
    const at = (u, x) => hp.evaluate(([uu, xx, yy]) => window.colorAt(uu, xx, yy), [u, x, y]);
    const cA = [await at(dataUrl(appShot), xLeft), await at(dataUrl(appShot), xRight)];
    const cB = [await at(bShot, xLeft), await at(bShot, xRight)];
    info(`colori sul timbro: sotto la copertura app ${JSON.stringify(cA[0])} PDF ${JSON.stringify(cB[0])}; parte visibile app ${JSON.stringify(cA[1])} PDF ${JSON.stringify(cB[1])}`);
    const white = (c) => c.every((v) => v > 240);
    const red = (c) => c[0] > 200 && c[1] < 60 && c[2] < 60;
    check('app: la copertura nasconde il timbro (bianco) e la parte libera e\' rossa', white(cA[0]) && red(cA[1]), JSON.stringify(cA));
    check('PDF appiattito: come nell\'app il timbro e\' nell\'immagine, NASCOSTO dalla copertura (bianco) e rosso dove e\' libero', white(cB[0]) && red(cB[1]), JSON.stringify(cB));
  } finally {
    await hp.close();
    await ctx.close();
  }
}

// ======================================================================================================
// Simulazione dell'ultimo pixel: dal 5 si patcha getImageData per far rileggere nero l'angolo estremo di un canvas largo almeno `minWidth`.
const INIT_LASTPIXEL = `(() => {
  window.__lp = { fail: false, minWidth: 0, hits: 0 };
  const g = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
    const d = g.apply(this, arguments);
    const lp = window.__lp;
    if (lp.fail && w === 1 && h === 1 && x === this.canvas.width - 1 && y === this.canvas.height - 1 && this.canvas.width >= lp.minWidth) { lp.hits++; d.data[0] = 0; d.data[1] = 0; d.data[2] = 0; d.data[3] = 0; }
    return d;
  };
  window.__cv = { on: false, list: [] };
  const ce = document.createElement.bind(document);
  document.createElement = (t, o) => { const e = ce(t, o); if (window.__cv.on && String(t).toLowerCase() === 'canvas') window.__cv.list.push(e); return e; };
})();`;

async function lastPixelSuite(browser, harness, F) {
  setSection('ultimo pixel simulato');
  const { ctx, page } = await newApp(browser, { init: INIT_LASTPIXEL, viewport: { width: 1280, height: 900 } });
  try {
    await openSample(page, 'A4 vettoriale');
    await page.evaluate(() => { window.__gtpdf.setScale(1, 0.5); window.__gtpdf.addSpecs(1, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'text', at: [0.1, 0.5], text: 'PROVA' }]); });
    const before = await sha(page, 'window.__gtpdf.originalBytes()');
    // da 2000 px di larghezza in su l'angolo si rilegge nero: 150 dpi (1240 px) funziona, 300 dpi (2480 px) no
    await page.evaluate(() => { window.__lp.fail = true; window.__lp.minWidth = 2000; });
    await openDialog(page);
    await pickFlat(page, '300', 'jpeg');
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('[role=alert]').waitFor({ timeout: 120000 });
    const body = await text(dlg(page));
    const hits = await page.evaluate(() => window.__lp.hits);
    check('la rilettura dell\'ultimo pixel e\' stata simulata (almeno una volta)', hits >= 1, String(hits));
    check('l\'esportazione si ferma con il titolo "Immagine troppo grande per questo dispositivo"', body.includes('Immagine troppo grande per questo dispositivo'), body);
    check('il messaggio dice la pagina, i pixel e che l\'ultimo pixel non e\' confermato', /pagina 1/i.test(body) && /2480 x 3508 px \(8\.699\.840 px\)/.test(body) && /l'ultimo pixel non è confermato/.test(body), body);
    check('il messaggio dice cosa fare (DPI piu\' basso) e che nulla e\' stato perso', /Scegli un DPI più basso/.test(body) && /nulla è stato perso/.test(body), body);
    check('nessun file offerto: ne\' Condividi ne\' Scarica', (await dlg(page).locator('.btn', { hasText: /Condividi|Scarica/ }).count()) === 0);
    check('byte dell\'originale invariati dopo l\'errore', (await sha(page, 'window.__gtpdf.originalBytes()')) === before);
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
    // il lavoro e' intatto: gli oggetti sono ancora li'
    await openDialog(page);
    check('il lavoro resta: il dialogo conta ancora 2 oggetti', (await text(dlg(page))).includes('Oggetti 2'));
    await dlg(page).locator('.btn', { hasText: 'Annulla' }).click();

    // riprovare dallo stesso dialogo con un DPI piu' basso funziona
    await openDialog(page);
    await pickFlat(page, '150', 'jpeg');
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    check('a 150 dpi (1240 px, sotto la soglia simulata) l\'esportazione riesce', (await text(dlg(page))).includes('PDF pronto'));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();

    // anche "Riprova" dal messaggio d'errore riapre la scelta con le opzioni precedenti
    await openDialog(page);
    await pickFlat(page, '600', 'png');
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('[role=alert]').waitFor({ timeout: 120000 });
    await dlg(page).locator('.btn.primary', { hasText: 'Riprova' }).click();
    const r = await page.$$eval('.export-dialog input[type=radio]', (els) => els.filter((e) => e.checked).map((e) => `${e.name}=${e.value}`));
    check('"Riprova" riapre la scelta con le opzioni di prima (Appiattito, 600 dpi, PNG)', r.includes('exp-mode=flat') && r.includes('exp-dpi=600') && r.includes('exp-fmt=png'), r.join(', '));
    await dlg(page).locator('label[data-value="150"]').click();
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    check('scegliendo 150 dpi dopo "Riprova" l\'esportazione riesce', (await text(dlg(page))).includes('PDF pronto'));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();

    // con il controllo disattivato (nessuna simulazione) 300 dpi funziona
    await page.evaluate(() => { window.__lp.fail = false; });
    await openDialog(page);
    await pickFlat(page, '300', 'jpeg');
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    check('senza simulazione, 300 dpi riesce: il controllo dell\'ultimo pixel non da\' falsi allarmi', (await text(dlg(page))).includes('PDF pronto'));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
  } finally {
    await ctx.close();
  }
}

// ======================================================================================================
// Avanzamento "Pagina 3 di 12", annulla ignorato durante la generazione, canvas rilasciati.
async function progressSuite(browser, F) {
  setSection('avanzamento e canvas rilasciati');
  const pages = [];
  for (let i = 0; i < 4; i++) pages.push({ raw: drawRaw(0, 0, 595.276, 841.89) });
  const bytes = await F.build({ pages });
  const { ctx, page } = await newApp(browser, {
    init: `${INIT_LASTPIXEL}
(() => { window.__prog = []; new MutationObserver(() => { const el = document.querySelector('.export-dialog [role=status]'); const d = document.querySelector('.export-progress-detail, .exp-progress-detail'); const t = (el ? el.textContent : '') + ' | ' + (d ? d.textContent : ''); if (!window.__prog.length || window.__prog[window.__prog.length - 1] !== t) window.__prog.push(t); }).observe(document, { subtree: true, childList: true, characterData: true }); })();`,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await openBytes(page, 'quattro.pdf', bytes);
    for (let n = 1; n <= 4; n++) await page.evaluate((k) => window.__gtpdf.addSpecs(k, [{ k: 'segment', pts: [[0.1, 0.1], [0.5, 0.3]] }, { k: 'text', at: [0.1, 0.5], text: 'PROVA' }]), n);
    await openDialog(page);
    await pickFlat(page, '300', 'jpeg');
    await page.evaluate(() => { window.__cv.on = true; window.__prog.length = 0; });
    await dlg(page).locator('.btn.primary', { hasText: 'Esporta' }).click();
    await page.keyboard.press('Escape'); // durante la generazione il dialogo non si chiude
    const stillOpen = (await dlg(page).count()) === 1;
    await dlg(page).locator('.exp-done-actions').waitFor({ timeout: 120000 });
    await page.evaluate(() => { window.__cv.on = false; });
    check('Esc durante la generazione NON chiude il dialogo', stillOpen);
    const prog = await page.evaluate(() => window.__prog);
    info(`righe di avanzamento viste: ${JSON.stringify(prog.slice(0, 12))}`);
    for (let n = 1; n <= 4; n++) check(`si e' vista la riga "Pagina ${n} di 4"`, prog.some((p) => p.includes(`Pagina ${n} di 4`)), JSON.stringify(prog));
    check('la riga di dettaglio dice pagina del PDF, dpi, formato e byte delle immagini finora', prog.some((p) => /Pagina \d del PDF · 300 dpi · JPEG · immagini finora \d/.test(p)), JSON.stringify(prog));
    const body = await text(dlg(page));
    check('"PDF pronto" riporta Immagini inserite e Vecchio contenuto tolto (misurati)', /Immagini inserite \d/.test(body) && /Vecchio contenuto tolto \d+ oggett/.test(body), body);
    const cv = await page.evaluate(() => window.__cv.list.filter((c) => !c.isConnected).map((c) => [c.width, c.height]));
    const big = cv.filter(([w]) => w > 1);
    info(`canvas creati durante l'esportazione e non nel documento: ${cv.length}; ancora grandi: ${big.length}${big.length ? ` ${JSON.stringify(big.slice(0, 5))}` : ''}`);
    check('tutti i canvas creati dall\'esportazione sono stati rilasciati (larghezza = altezza = 1)', cv.length > 0 && big.length === 0, JSON.stringify(big.slice(0, 5)));
    await dlg(page).locator('.btn', { hasText: 'Chiudi' }).click();
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
