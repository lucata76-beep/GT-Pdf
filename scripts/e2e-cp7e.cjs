// Prove di CP7e (V3.2c, misura degli archi) su Chromium, in DIAGNOSTICA > Geometria PDF e in «Copia misura»: mouse (desktop 1280 x 900) e tocco emulato (390 x 780).
// Si costruisce QUI, in memoria (nessun file in public/), un PDF con archi di raggio e angolo NOTI: un cerchio chiuso (4 cubiche), archi aperti di 1, 2 e 3 cubiche, un arco di 9 cubiche (oltre il tetto di 8:
// solo contato), un poligono regolare di 24 vertici, uno irregolare di 15, una cubica quasi rettilinea (sagitta 0.03 su corda 30), un cerchio sotto una cm con scala 2:1 (non e' un cerchio) e archi solo riempiti (non candidati).
// I numeri attesi (raggi, angoli, vertici, contenitori, conti) sono calcolati DA QUESTO SCRIPT con le formule dell'approssimazione standard di Bezier e uno scostamento vero per campionamento fitto:
// NON vengono dal codice dell'app. La scheda mostra le righe nuove (cominciano con «archi»), «Copia misura» le contiene e non contiene il nome del file; le righe di prima restano.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')). Chromium NON e' il browser dell'utente (Edge sul PC, Safari su iPhone): nulla di quanto segue prova il comportamento li'.
// Uso: node scripts/e2e-cp7e.cjs [cartella-immagini]   (E2E_DIST=<cartella di un build di prova gia' fatto> per provare quel build; E2E_ONLY=diag,diagphone)
const { chromium } = require('playwright');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp7e', out: process.argv[2], port: 4250, hport: 4251, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const SECRET = 'cliente-riservato-7e5a';
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- costruzioni note (calcolate QUI)
/** Cubica standard di un arco (centro, raggio, angolo iniziale e ampiezza in rad): k = 4/3 tan(th/4). */
function arcCubic(cx, cy, r, a0, th) {
  const k = (4 / 3) * Math.tan(th / 4);
  const a1 = a0 + th;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return [x0, y0, x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0), x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1), x1, y1];
}
function chain(cx, cy, r, startDeg, totalDeg, parts) {
  const th = (totalDeg * DEG) / parts;
  return Array.from({ length: parts }, (_, j) => arcCubic(cx, cy, r, startDeg * DEG + j * th, th));
}
/** Scostamento VERO relativo massimo di una cubica dal cerchio esatto (campionamento fitto). */
function trueRel(cx, cy, r, c, steps = 4000) {
  let worst = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
    const y = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7];
    worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cy) - r) / r);
  }
  return worst;
}
const f6 = (v) => v.toFixed(6);
const pdfChain = (ch, close = false) => `${f6(ch[0][0])} ${f6(ch[0][1])} m ${ch.map((c) => `${f6(c[2])} ${f6(c[3])} ${f6(c[4])} ${f6(c[5])} ${f6(c[6])} ${f6(c[7])} c`).join(' ')}${close ? ' h' : ''}`;
function polygon(cx, cy, r, n, phaseDeg = 0) {
  return Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((phaseDeg + (360 * i) / n) * DEG), y: cy + r * Math.sin((phaseDeg + (360 * i) / n) * DEG) }));
}
const pdfPoly = (pts) => `${pts.map((p, i) => `${f6(p.x)} ${f6(p.y)} ${i === 0 ? 'm' : 'l'}`).join(' ')} h`;
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
async function contentPdf(content, size = [600, 800]) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const pg = doc.addPage(size);
  const c = doc.context;
  pg.node.set(PDFName.of('Resources'), c.obj({}));
  pg.node.set(PDFName.of('Contents'), c.register(c.stream(content)));
  return doc.save({ useObjectStreams: false });
}

/** Il contenuto di prova: ogni voce con il suo atteso (raggio R, angolo, cubiche, stato). */
const rnd = rng(99);
const IRREGULAR = Array.from({ length: 15 }, (_, i) => ({ x: 300 + (40 + rnd() * 30) * Math.cos(i * 0.43), y: 300 + (40 + rnd() * 30) * Math.sin(i * 0.43) }));
const ARCS = [
  { id: 'cerchio', cx: 100, cy: 700, r: 40, start: 0, deg: 360, parts: 4, close: true, state: 'CHIUSI' },
  { id: 'arco1', cx: 250, cy: 700, r: 25, start: 30, deg: 60, parts: 1, close: false, state: 'APERTI' },
  { id: 'arco2', cx: 350, cy: 700, r: 30, start: 20, deg: 150, parts: 2, close: false, state: 'APERTI' },
  { id: 'arco3', cx: 450, cy: 700, r: 20, start: 0, deg: 210, parts: 3, close: false, state: 'APERTI' },
];
const SKIPPED = { cx: 100, cy: 550, r: 30, start: 0, deg: 320, parts: 9 };
const POLY = { cx: 250, cy: 550, r: 50, n: 24 };
const FILLED = { cx: 450, cy: 550, r: 25, start: 0, deg: 180, parts: 2 };
const ELLIPSE = { cx: 75, cy: 400, r: 40 }; // sotto `2 0 0 1 0 0 cm`: x raddoppia
const CONTENT = [
  ...ARCS.map((a) => `${pdfChain(chain(a.cx, a.cy, a.r, a.start, a.deg, a.parts), a.close)} S`),
  `${pdfChain(chain(SKIPPED.cx, SKIPPED.cy, SKIPPED.r, SKIPPED.start, SKIPPED.deg, SKIPPED.parts))} S`,
  `${pdfPoly(polygon(POLY.cx, POLY.cy, POLY.r, POLY.n, 7))} S`,
  `${pdfPoly(IRREGULAR)} S`,
  '0 100 m 10 100.04 20 100.04 30 100 c S',
  `${pdfChain(chain(FILLED.cx, FILLED.cy, FILLED.r, FILLED.start, FILLED.deg, FILLED.parts))} f`,
  `q 2 0 0 1 0 0 cm ${pdfChain(chain(ELLIPSE.cx, ELLIPSE.cy, ELLIPSE.r, 0, 360, 4), true)} S Q`,
].join('\n');

// ---------------------------------------------------------------- Diagnostica
async function newDiag(browser, kind) {
  const isPhone = kind === 'phone';
  const ctx = await browser.newContext(isPhone ? { viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA } : { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(String(t)) } });
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
const diagLogText = (page) => page.locator('textarea[aria-label="Registro eventi"]').inputValue();
async function diagLoad(page, name, bytes) {
  const before = ((await diagLogText(page)).match(/\[OK\] Aperto: /g) || []).length;
  await page.setInputFiles('.screen-diag input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction((a) => (document.querySelector('textarea[aria-label="Registro eventi"]').value.match(/\[OK\] Aperto: /g) || []).length > a, before);
  await page.waitForTimeout(250);
}
const geoBtn = (page, name) => page.locator('.geo-card').getByRole('button', { name, exact: true });
async function press(page, name, touch) {
  const b = geoBtn(page, name);
  if (touch) await b.tap();
  else await b.click();
}
async function geoMeasure(page, touch) {
  await press(page, 'Misura questa pagina', touch);
  await page.waitForFunction(() => /^(Misurat[ae] \d+|Nessuna pagina misurata|Misura fallita)/.test(document.querySelector('.geo-status').innerText), null, { timeout: 60000 });
}

/** Una riga (le prime che cominciano con `prefix`) o '' se manca. */
const lineOf = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) || '';
/** Il numero dopo `label` (", " o ": " compresi) nella riga. */
/** minimo e massimo (due numeri) dopo la parola `what` ("minimo e massimo A e B"). */
const minMax = (line, after) => {
  const i = line.indexOf(after);
  const m = /minimo e massimo ([0-9.e+-]+) e ([0-9.e+-]+)/.exec(line.slice(i));
  return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
};

async function diagSuite(browser, kind) {
  const phoneKind = kind === 'phone';
  setSection(`misura degli archi in Diagnostica e Copia misura, ${phoneKind ? '390 x 780 con tocco emulato' : '1280 x 900 con il mouse'}`);
  const { ctx, page, errors } = await newDiag(browser, kind);
  const name = `${SECRET}-archi.pdf`;
  await diagLoad(page, name, await contentPdf(CONTENT));
  await geoMeasure(page, phoneKind);
  const detail = await page.locator('.geo-detail').innerText();
  const arc = detail.split('\n').filter((l) => l.startsWith('archi'));
  info(`scheda: ${detail.split('\n').length} righe, di cui ${arc.length} nuove (cominciano con «archi»)`);
  check('scheda: le righe nuove ci sono e tutti i conti tornano (nessun «IL CONTO NON TORNA»; 12 righe «il conto torna»: 2 gruppi x (2 stati x 2 + poligoni x 2))', arc.length > 40 && !arc.some((l) => /IL CONTO NON TORNA/.test(l)) && arc.filter((l) => /il conto torna/.test(l)).length === 12, `${arc.length} righe nuove`);
  check('scheda: le righe di CP7a e di CP7c restano (cerchi di 4 cubiche, poligoni fitti, cubiche in sottopercorsi aperti)', /^di 4 cubiche che rispettano la regola del cerchio, candidati:/m.test(detail) && /^poligoni fitti \(chiusi, almeno 12 lineTo, nessuna cubica\), candidati: 2$/m.test(detail) && /^cubiche in sottopercorsi aperti, candidati:/m.test(detail), '');

  // ---- numeri attesi, calcolati qui
  // totali dei sottopercorsi di sole cubiche: candidati = 1 chiuso (cerchio) + aperti: arco1, arco2, arco3, arco di 9 cubiche, quasi rettilinea (1 cubica), = 5 aperti; la cm 2:1 e' un chiuso da 4 (6 sottopercorsi chiusi? no: 2)
  // chiusi: cerchio e ellisse (cm) = 2 da 4 cubiche; aperti: arco1 (1), arco2 (2), arco3 (3), quasi rettilinea (1), arco da 9 cubiche (solo contato) = 5, di cui 1 oltre il tetto
  const openLine = lineOf(detail, 'archi, sottopercorsi APERTI di sole cubiche, candidati:');
  check('candidati: APERTI di sole cubiche 5 = misurati 4 + oltre 8 cubiche non misurati 1; cubiche misurate 7 + non misurate 9 = 16', /: 5 = misurati 4 \(raggio determinato 3, quasi rettilinei 1, di cui raggio non determinabile 0 e non piatti 0\) \+ oltre 8 cubiche non misurati 1; cubiche: misurate 7 \+ non misurate 9 = 16$/.test(openLine), openLine);
  const closedLine = lineOf(detail, 'archi, sottopercorsi CHIUSI di sole cubiche, candidati:');
  check('candidati: CHIUSI di sole cubiche 2 = misurati 2 (cerchio e cerchio sotto cm 2:1); cubiche 8', /: 2 = misurati 2 \(raggio determinato 2, quasi rettilinei 0, di cui raggio non determinabile 0 e non piatti 0\) \+ oltre 8 cubiche non misurati 0; cubiche: misurate 8 \+ non misurate 0 = 8$/.test(closedLine), closedLine);
  const allClosed = lineOf(detail, 'archi, sottopercorsi CHIUSI di sole cubiche, tutti i percorsi:');
  const allOpen = lineOf(detail, 'archi, sottopercorsi APERTI di sole cubiche, tutti i percorsi:');
  check('tutti i percorsi: in piu\' il riempimento di 2 cubiche (aperto): APERTI 6 = misurati 5 + 1, cubiche misurate 9; i chiusi restano 2', /: 6 = misurati 5 /.test(allOpen) && /cubiche: misurate 9 \+ non misurate 9 = 18$/.test(allOpen) && /: 2 = misurati 2 /.test(allClosed), `${allOpen} | ${allClosed}`);
  const polyLine = lineOf(detail, 'archi, poligoni fitti (chiusi, almeno 12 lineTo, nessuna cubica), candidati:');
  check('candidati: 2 poligoni fitti misurati (24 e 15 vertici = 39), nessuno oltre 256', /: 2 = misurati 2 \(raggio determinato 2, quasi rettilinei 0, di cui raggio non determinabile 0 e non piatti 0\) \+ oltre 256 vertici non misurati 0; .*misurati 39 \+ non misurati 0 = 39$/.test(polyLine), polyLine);

  // ---- raggio e angolo noti, entro lo scostamento calcolato qui
  for (const a of ARCS) {
    const ch = chain(a.cx, a.cy, a.r, a.start, a.deg, a.parts);
    const eps = Math.max(...ch.map((c) => trueRel(a.cx, a.cy, a.r, c)));
    const th = Math.min(a.deg * DEG, Math.PI);
    const amp = Math.max(1, 8 / (th * th));
    const relTol = eps * amp + 2e-6; // + arrotondamento Float32 di PDF.js (~6e-8 x coordinata / raggio)
    const angTol = (3 * eps * amp + 4e-6) / DEG;
    const head = `archi ${a.state}, ${a.parts} ${a.parts === 1 ? 'cubica' : 'cubiche'}, candidati: raggio (pt utente)`;
    const l = lineOf(detail, head);
    const [rMin, rMax] = minMax(l, 'minimo e massimo');
    const aLine = l.slice(l.indexOf('angolo coperto'));
    const [aMin] = minMax(aLine, 'minimo e massimo');
    check(`${a.id}: raggio misurato ${rMin} contro ${a.r} (limite relativo ${relTol.toExponential(1)}), angolo ${aMin} contro ${a.deg} (limite ${angTol.toExponential(1)} gradi)`, Math.abs(rMin - a.r) / a.r <= relTol && (a.id === 'cerchio' || rMin === rMax) && Math.abs(aMin - a.deg) <= angTol, l.slice(0, 200));
  }
  // classi: cerchio -> «circa 360» (indice 5), arco 60 -> fino a 90, arco 150 -> fino a 180, arco 210 -> fino a 270
  const angleClasses = (head) => {
    const l = lineOf(detail, head);
    const m = /angolo coperto \(gradi\), fino a 10: (\d+) · fino a 90: (\d+) · fino a 180: (\d+) · fino a 270: (\d+) · meno di 360: (\d+) · circa 360: (\d+) · oltre 360: (\d+)/.exec(l);
    return m ? m.slice(1).map(Number) : [];
  };
  check('classi degli angoli: il cerchio sta in «circa 360» (anche l\'ellisse da cm: 2 in tutto), arco1 in «fino a 90», arco2 in «fino a 180», arco3 in «fino a 270»',
    JSON.stringify(angleClasses('archi CHIUSI, 4 cubiche, candidati: raggio')) === JSON.stringify([0, 0, 0, 0, 0, 2, 0]) &&
      JSON.stringify(angleClasses('archi APERTI, 1 cubica, candidati: raggio')) === JSON.stringify([0, 1, 0, 0, 0, 0, 0]) &&
      JSON.stringify(angleClasses('archi APERTI, 2 cubiche, candidati: raggio')) === JSON.stringify([0, 0, 1, 0, 0, 0, 0]) &&
      JSON.stringify(angleClasses('archi APERTI, 3 cubiche, candidati: raggio')) === JSON.stringify([0, 0, 0, 1, 0, 0, 0]),
    '');
  // il cerchio sotto la cm 2:1 NON e' un cerchio: tra i 2 chiusi da 4 cubiche, uno ha lo scostamento relativo grande (oltre 0.1) e uno minuscolo
  const relLine = lineOf(detail, 'archi CHIUSI, 4 cubiche, candidati: sottopercorsi 2');
  const rel = /fino a 0\.00001: (\d+) · fino a 0\.0001: (\d+) · fino a 0\.0003: (\d+) · fino a 0\.001: (\d+) · fino a 0\.003: (\d+) · fino a 0\.01: (\d+) · fino a 0\.1: (\d+) · oltre 0\.1: (\d+)/.exec(relLine);
  check('il cerchio sotto la cm 2:1 non e\' un cerchio: uno scostamento relativo oltre 0.1 (oltre 0.1: 1); il cerchio vero sta sotto 0.0003 (l\'approssimazione standard di 90 gradi scosta di ~2.7e-4)', !!rel && Number(rel[8]) === 1 && Number(rel[1]) + Number(rel[2]) + Number(rel[3]) === 1, relLine);
  const ref = lineOf(detail, 'archi CHIUSI, 4 cubiche, candidati: scostamento massimo ASSOLUTO');
  check('riferimento di CP7a: dei 2 chiusi da 4 cubiche uno solo rientra nelle tolleranze (il cerchio, non l\'ellisse)', /entro le tolleranze di CP7a \(riferimento\): 1 su 2$/.test(ref), ref);
  // arco quasi rettilineo contato a parte
  check('la cubica quasi rettilinea (sagitta 0.03 su 30: raggio ~ 3750, oltre 100 x la diagonale) e\' contata a parte fra le aperte da 1 cubica (quasi rettilinei 1)', /^archi APERTI, 1 cubica, candidati: sottopercorsi 2 \(raggio determinato 1, quasi rettilinei 1,/.test(lineOf(detail, 'archi APERTI, 1 cubica, candidati: sottopercorsi')), lineOf(detail, 'archi APERTI, 1 cubica, candidati: sottopercorsi'));
  // poligoni: 24 vertici (17-24) e 15 (12-16); il regolare ha raggio 50 e angolo 360
  const p24 = lineOf(detail, 'archi, poligoni fitti, 17-24 vertici, candidati: raggio');
  const [pr] = minMax(p24, 'minimo e massimo');
  const [pa] = minMax(p24.slice(p24.indexOf('angolo coperto')), 'minimo e massimo');
  check(`poligono regolare di 24 vertici: raggio ${pr} (atteso 50), angolo ${pa} (atteso 360)`, Math.abs(pr - 50) < 1e-3 && Math.abs(pa - 360) < 0.01, p24);
  check('poligono irregolare di 15 vertici: nel contenitore 12-16 con scostamento relativo grande (oltre 0.01)', /^archi, poligoni fitti, 12-16 vertici, candidati: sottopercorsi 1 /.test(lineOf(detail, 'archi, poligoni fitti, 12-16 vertici, candidati: sottopercorsi')) && (() => {
    const l = lineOf(detail, 'archi, poligoni fitti, 12-16 vertici, candidati: sottopercorsi');
    const m = /fino a 0\.1: (\d+) · oltre 0\.1: (\d+)/.exec(l);
    const m2 = /fino a 0\.01: (\d+)/.exec(l);
    return !!m && !!m2 && Number(m[1]) + Number(m[2]) === 1;
  })(), lineOf(detail, 'archi, poligoni fitti, 12-16 vertici, candidati: sottopercorsi'));

  // ---- Copia misura: le righe nuove ci sono, nessun nome di file
  await press(page, 'Copia misura', phoneKind);
  await page.waitForFunction(() => window.__copied.length > 0);
  const text = await page.evaluate(() => window.__copied.at(-1));
  const lines = text.split('\n');
  const copiedArc = lines.filter((l) => l.startsWith('archi'));
  check('Copia misura: contiene le righe nuove (le stesse della scheda, in numero e testo)', copiedArc.length === arc.length && copiedArc.every((l, i) => l === arc[i]), `${copiedArc.length} contro ${arc.length}`);
  for (const [what, re] of [
    ['definizioni', /^archi \(CP7e, SOLA MISURA/m],
    ['quasi rettilinei e tetti', /^archi, quasi rettilinei: raggio oltre 100 volte la diagonale del riquadro dei punti/m],
    ['riferimento di CP7a', /^archi, riferimento di CP7a/m],
    ['aperti di sole cubiche', /^archi, sottopercorsi APERTI di sole cubiche, tutti i percorsi:/m],
    ['poligoni fitti', /^archi, poligoni fitti \(chiusi, almeno 12 lineTo, nessuna cubica\), candidati:/m],
    ['conto dei vertici', /^archi, conto dei vertici misurati e non misurati, poligoni fitti, candidati: 39 \+ 0 = 39;/m],
  ]) check(`Copia misura: riga nuova presente (${what})`, re.test(text), '');
  check('Copia misura: NON contiene il nome del file', !text.includes(SECRET) && !/\.pdf/i.test(text), '');
  check('Copia misura: una voce per riga, nessuna riga vuota, numeri sempre con il punto', lines.every((l) => l.trim().length > 0 && /[:·]/.test(l)) && !/\d,\d/.test(text), '');
  check('Copia misura: ogni riga della scheda e\' anche nel testo copiato (stesso dettaglio)', detail.split('\n').every((l) => text.includes(l)), '');
  check('le definizioni non dicono che un gruppo «e\' un arco» o un cerchio (la misura non sa che cosa voleva disegnare l\'autore)', !/\b(e' un arco|sono archi|sono cerchi|e' un cerchio|raccordi)\b/i.test(arc.join('\n')), '');
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('nessuno scorrimento orizzontale della pagina Diagnostica', sw.sw <= sw.iw, JSON.stringify(sw));

  // ---- una pagina senza cubiche ne' poligoni fitti: righe nuove con zeri, i conti tornano
  await diagLoad(page, 'senza-curve.pdf', await contentPdf('10 10 m 100 10 l S', [200, 100]));
  await geoMeasure(page, phoneKind);
  const d2 = await page.locator('.geo-detail').innerText();
  const arc2 = d2.split('\n').filter((l) => l.startsWith('archi'));
  check('pagina senza cubiche: righe nuove con zeri, nessun contenitore, 12 conti che tornano', arc2.length > 10 && !arc2.some((l) => /IL CONTO NON TORNA/.test(l)) && arc2.filter((l) => /il conto torna/.test(l)).length === 12 && !arc2.some((l) => /^archi (APERTI|CHIUSI), /.test(l)), `${arc2.length}`);
  check('nessun errore di pagina', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
const SUITES = {
  diag: (browser) => diagSuite(browser, 'desktop'),
  diagphone: (browser) => diagSuite(browser, 'phone'),
};
(async () => {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const servers = await lib.startAll(chromium);
  const guarded = async (name, fn) => {
    setSection(name);
    try {
      await fn(servers.browser);
    } catch (e) {
      check(`la serie "${name}" arriva in fondo`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  };
  for (const [name, fn] of Object.entries(SUITES)) {
    if (only && !only.includes(name)) continue;
    await guarded(name, fn);
  }
  await lib.stopAll(servers);
  lib.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
