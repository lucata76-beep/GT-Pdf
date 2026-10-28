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
// 3) Dialogo: Appiattito disattivato, riepilogo, "Esporta" senza share, Condividi (File application/pdf, dentro il tocco, annullamento,
//    errori, canShare assente o falso), Scarica (octet-stream, nome), nomi con spazi / accenti / piu' punti, blob rilasciato alla chiusura.
// 4) Errori: PDF troncato, danneggiato, cifrato, e PDF che PDF.js apre ma pdf-lib no; il lavoro resta.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5a.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository)
// Esce con codice 1 se una prova fallisce. Safari/iPhone reale: NON provato qui.
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

const ROOT = resolve(__dirname, '..');
const OUT = process.argv[2] || join(os.tmpdir(), 'gtpdf-e2e-cp5a');
const DIST = join(OUT, 'dist-test');
mkdirSync(OUT, { recursive: true });
const PORT = 4185;
const HPORT = 4186;
const URL = `http://localhost:${PORT}/`;
const ZOOM = 2; // pixel CSS (= pixel del confronto, DPR 1) per pt del foglio

const results = [];
let section = '';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
};
const info = (text) => console.log(`INFO  [${section}] ${text}`);
const fx = () => import('./export-fixtures.mjs');

// ---------- Soglie del confronto (vedi il resoconto: perche' questi valori) ----------
const INK_T = 40; // differenza massima tra i canali (su 255) oltre la quale un pixel e' "inchiostro"
const TOL_PX = 2; // distanza massima ammessa tra l'inchiostro dell'app e quello del PDF, in pixel (a 2 px/pt = 1 pt)
const MIN_MATCH = 0.97; // quota minima di pixel di inchiostro entro TOL_PX dall'altro (in entrambi i sensi)
const MAX_INTERIOR_ERR = 10; // errore medio di colore (su 255) nelle aree piene
const INK_RATIO = [0.9, 1.1]; // rapporto minimo e massimo tra l'inchiostro del PDF e quello dell'app

// ---------- Server: anteprima del build di prova e pagina "harness" con PDF.js ----------
function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('anteprima non avviata')), 30000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) {
        clearTimeout(t);
        res(proc);
      }
    });
    proc.on('exit', () => rej(new Error('anteprima terminata')));
  });
}

const HARNESS = `<!doctype html><meta charset="utf-8"><title>harness</title><body>
<script type="module">
import * as pdfjs from '/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
const base = location.origin + '/assets/';
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const open = (bytes) => pdfjs.getDocument({ data: bytes, wasmUrl: base + 'wasm/', standardFontDataUrl: base + 'standard_fonts/', iccUrl: base + 'iccs/', useSystemFonts: false, verbosity: 0 });
const decode = (url) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0); ok({ w: i.width, h: i.height, d: x.getImageData(0, 0, i.width, i.height).data }); }; i.onerror = ko; i.src = url; });

// Rende la pagina come l'app: canvas di floor(pt * scala), viewport a scala piena.
window.renderPage = async (data, pageNo, scale) => {
  const task = open(b64(data));
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    await page.render({ canvas, viewport: page.getViewport({ scale }) }).promise;
    return canvas.toDataURL('image/png');
  } finally { await task.destroy(); }
};

window.textOf = async (data, pageNo) => {
  const task = open(b64(data));
  try { const doc = await task.promise; const p = await doc.getPage(pageNo); const tc = await p.getTextContent(); return tc.items.filter((i) => 'str' in i).map((i) => i.str); }
  finally { await task.destroy(); }
};
window.annotsOf = async (data, pageNo) => {
  const task = open(b64(data));
  try { const doc = await task.promise; const p = await doc.getPage(pageNo); return (await p.getAnnotations()).map((a) => ({ subtype: a.subtype, rect: a.rect })); }
  finally { await task.destroy(); }
};

// distanza (chamfer 1 / 1.4142) di ogni pixel dal pixel di inchiostro piu' vicino
function dt(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + S); if (x < w - 1) v = Math.min(v, d[i - w + 1] + S); } d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = d[i]; if (x < w - 1) v = Math.min(v, d[i + 1] + 1); if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + S); if (x > 0) v = Math.min(v, d[i + w - 1] + S); } d[i] = v; }
  return d;
}
const pct = (dists, q) => { if (!dists.length) return 0; const s = Float32Array.from(dists).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// A0, A (app senza e con oggetti), B0, B (originale e esportato resi da PDF.js): confronto degli inchiostri
const shifted = (img, dx, dy) => { if (!dx && !dy) return img; const d = new Uint8ClampedArray(img.d.length).fill(255); for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue; const o = (y * img.w + x) * 4, i = (sy * img.w + sx) * 4; d[o] = img.d[i]; d[o + 1] = img.d[i + 1]; d[o + 2] = img.d[i + 2]; d[o + 3] = 255; } return { w: img.w, h: img.h, d }; };
window.compare = async (a0u, au, b0u, bu, T, tol, shift) => {
  const [A0, A, B0s, Bs] = await Promise.all([decode(a0u), decode(au), decode(b0u), decode(bu)]);
  const B0 = shifted(B0s, shift ? shift[0] : 0, shift ? shift[1] : 0), B = shifted(Bs, shift ? shift[0] : 0, shift ? shift[1] : 0);
  const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
  const px = (img, x, y) => (y * img.w + x) * 4;
  const maskOf = (img, base) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = px(img, x, y), j = px(base, x, y); if (Math.max(Math.abs(img.d[i] - base.d[j]), Math.abs(img.d[i + 1] - base.d[j + 1]), Math.abs(img.d[i + 2] - base.d[j + 2])) > T) m[y * w + x] = 1; } return m; };
  const inkA = maskOf(A, A0), inkB = maskOf(B, B0);
  const dA = dt(inkA, w, h), dB = dt(inkB, w, h);
  let nA = 0, nB = 0, okA = 0, okB = 0; const farA = [], farB = [];
  for (let i = 0; i < w * h; i++) { if (inkA[i]) { nA++; farA.push(dB[i]); if (dB[i] <= tol) okA++; } if (inkB[i]) { nB++; farB.push(dA[i]); if (dA[i] <= tol) okB++; } }
  // errore di colore nelle aree piene (3x3 tutto inchiostro in entrambi)
  let sum = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let all = true; for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (y + dy) * w + x + dx; if (!inkA[k] || !inkB[k]) { all = false; break; } } if (!all) continue; const i = px(A, x, y), j = px(B, x, y); sum += (Math.abs(A.d[i] - B.d[j]) + Math.abs(A.d[i + 1] - B.d[j + 1]) + Math.abs(A.d[i + 2] - B.d[j + 2])) / 3; cnt++; }
  // rumore di base: stessa pagina senza oggetti, app contro PDF.js
  let base = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = px(A0, x, y), j = px(B0, x, y); if (Math.max(Math.abs(A0.d[i] - B0.d[j]), Math.abs(A0.d[i + 1] - B0.d[j + 1]), Math.abs(A0.d[i + 2] - B0.d[j + 2])) > T) base++; }
  // immagine: A | B | differenze (rosso = solo app, blu = solo PDF, viola = entrambi)
  const out = document.createElement('canvas'); out.width = w * 3; out.height = h; const ctx = out.getContext('2d');
  const put = (img, ox) => { const id = ctx.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = px(img, x, y), o = (y * w + x) * 4; id.data[o] = img.d[i]; id.data[o + 1] = img.d[i + 1]; id.data[o + 2] = img.d[i + 2]; id.data[o + 3] = 255; } ctx.putImageData(id, ox, 0); };
  put(A, 0); put(B, w);
  const diff = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const o = i * 4; const a = inkA[i], b = inkB[i]; const [r, g, bl] = a && b ? [150, 60, 180] : a ? [230, 40, 40] : b ? [40, 80, 230] : [255, 255, 255]; diff.data[o] = r; diff.data[o + 1] = g; diff.data[o + 2] = bl; diff.data[o + 3] = 255; }
  ctx.putImageData(diff, w * 2, 0);
  return { w, h, sizeA: [A.w, A.h], sizeB: [B.w, B.h], nA, nB, matchA: nA ? okA / nA : 1, matchB: nB ? okB / nB : 1, p99A: pct(farA, 0.99), p999A: pct(farA, 0.999), maxA: pct(farA, 1), p99B: pct(farB, 0.99), p999B: pct(farB, 0.999), maxB: pct(farB, 1), interior: cnt ? sum / cnt : 0, interiorPx: cnt, baseNoisePx: base, image: out.toDataURL('image/png') };
};
// differenza massima tra due immagini della stessa dimensione (0 = identiche)
window.maxDiff = async (u1, u2) => { const [a, b] = await Promise.all([decode(u1), decode(u2)]); if (a.w !== b.w || a.h !== b.h) return { sizeMismatch: [a.w, a.h, b.w, b.h] }; let m = 0, n = 0; for (let i = 0; i < a.d.length; i++) { const d = Math.abs(a.d[i] - b.d[i]); if (d > m) m = d; if (d) n++; } return { max: m, differing: n }; };
window.colorAt = async (u, x, y) => { const a = await decode(u); const i = (Math.round(y) * a.w + Math.round(x)) * 4; return [a.d[i], a.d[i + 1], a.d[i + 2]]; };
window.harnessReady = true;
</script></body>`;

function startHarness() {
  const pdfjsBuild = join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/octet-stream' };
  const srv = http.createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    try {
      let file = null;
      if (path === '/' || path === '/harness.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(HARNESS);
      }
      if (path === '/pdf.mjs') file = join(pdfjsBuild, 'pdf.mjs');
      else if (path === '/pdf.worker.min.mjs') file = join(pdfjsBuild, 'pdf.worker.min.mjs');
      else if (path.startsWith('/assets/') && !path.includes('..')) file = join(ROOT, 'public', 'pdfjs', path.slice('/assets/'.length));
      if (!file) {
        res.writeHead(404);
        return res.end();
      }
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((res) => srv.listen(HPORT, () => res(srv)));
}

// ---------- Utilita' ----------
const sha = (page, expr) =>
  page.evaluate(async (e) => {
    const bytes = new Function(`return (${e})`)();
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return `${bytes.length}:${[...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }, expr);
const shaBuf = async (buf) => {
  const h = await require('node:crypto').webcrypto.subtle.digest('SHA-256', buf);
  return `${buf.length}:${Buffer.from(h).toString('hex')}`;
};

async function newApp(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 2800, height: 2000 }, deviceScaleFactor: opts.dpr || 1, acceptDownloads: true, ...(opts.context || {}) });
  const page = await ctx.newPage();
  if (opts.init) await page.addInitScript(opts.init);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  if (opts.clock) await page.clock.install();
  await page.goto(URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page };
}
async function openBytes(page, name, bytes) {
  await page.setInputFiles('input[type=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForTimeout(500);
}
async function openSample(page, title) {
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForTimeout(500);
}
/** Mostra la pagina `n` a ZOOM e aspetta che il canvas sia stato ridisegnato a quella scala. */
async function showPage(page, n) {
  await page.evaluate((k) => window.__gtpdf.goTo(k), n);
  await page.waitForTimeout(300);
  await page.evaluate((z) => window.__gtpdf.zoomTo(z), ZOOM);
  await page.waitForFunction((z) => {
    const c = document.querySelector('.viewer-stage canvas');
    const s = window.__gtpdf.sheet();
    return c && c.width === Math.floor(s.w * z) && c.height === Math.floor(s.h * z);
  }, ZOOM, { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function shot(page) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('.viewer-stage canvas').getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  const clip = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) };
  return { buf: await page.screenshot({ clip }), clip };
}
const b64 = (buf) => Buffer.from(buf).toString('base64');

/** Oggetti di prova per ogni pagina: tutti i tipi, in coordinate frazionarie dell'area visibile (spazio utente, origine in basso a sinistra). */
function fullSpecs() {
  return [
    // coperture sotto a tutto, create per prime e per ultime (l'ordine di creazione non conta: stanno sotto)
    { k: 'cover', shape: 'rect', a: [0.02, 0.895], b: [0.55, 0.99] }, // sul testo del titolo
    { k: 'cover', shape: 'circle', a: [0.5, 0.58], b: [0.5 + 0.06, 0.58] }, // sul disegno (cerchi e assi)
    { k: 'cover', shape: 'rect', a: [0.03, 0.05], b: [0.42, 0.115] }, // sul riferimento 100 mm e il suo testo
    { k: 'cover', shape: 'square', a: [0.64, 0.3], b: [0.75, 0.31] }, // quadrata sul disegno
    // linee: ogni tipo
    { k: 'segment', pts: [[0.1, 0.2], [0.4, 0.22]], style: 'solid', color: '#D32F2F', w: 1 },
    { k: 'segment', pts: [[0.1, 0.25], [0.4, 0.27]], style: 'dashed', color: '#1565C0', w: 1 },
    { k: 'segment', pts: [[0.1, 0.3], [0.4, 0.32]], style: 'dashdot', color: '#2E7D32', w: 2 },
    { k: 'segment', pts: [[0.45, 0.2], [0.6, 0.22]], style: 'dashed', color: '#6A1B9A', w: 0.5 },
    { k: 'segment', pts: [[0.45, 0.25], [0.6, 0.27]], style: 'dashdot', color: '#E65100', w: 3 },
    { k: 'polyline', pts: [[0.7, 0.2], [0.8, 0.26], [0.75, 0.33], [0.9, 0.36]], style: 'solid', color: '#1E232A', w: 1.5 },
    { k: 'polyline', pts: [[0.7, 0.1], [0.85, 0.12], [0.8, 0.17], [0.95, 0.15]], style: 'dashed', color: '#00796B', w: 1 },
    // quote: tutti i tipi, valore automatico (con scala) e digitato
    { k: 'dim', dim: 'aligned', pts: [[0.2, 0.45], [0.45, 0.5], [0.3, 0.4]] },
    { k: 'dim', dim: 'horizontal', pts: [[0.2, 0.7], [0.5, 0.74], [0.35, 0.8]], value: 'Ø8 ±0.1', color: '#1565C0' },
    { k: 'dim', dim: 'vertical', pts: [[0.85, 0.45], [0.88, 0.7], [0.95, 0.55]] },
    { k: 'dim', dim: 'diameter', pts: [[0.3, 0.58], [0.7, 0.58]] },
    { k: 'dim', dim: 'radius', pts: [[0.5, 0.58], [0.62, 0.66]], value: 'R12.5', color: '#6A1B9A', w: 0.75, pt: 8 },
    // testi
    { k: 'text', at: [0.06, 0.93], text: 'SOPRA LA COPERTURA', pt: 10, color: '#D32F2F' },
    { k: 'text', at: [0.1, 0.12], text: 'FORO Ø8 ±0.1 90° R12', pt: 14, color: '#1565C0' },
    { k: 'text', at: [0.55, 0.4], text: 'Ø25.40 ±0.05', pt: 6, color: '#1E232A' },
  ];
}

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
  section = `confronto: ${c.name}`;
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
  section = 'preparazione';
  execFileSync('node', ['scripts/copy-pdfjs-assets.mjs'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GTPDF_TEST: '1' } });
  const preview = await startPreview();
  const harnessSrv = await startHarness();
  // Con la locale POSIX (tipica dei contenitori Linux) Chromium sostituisce con "download" i nomi di file con caratteri non ASCII: serve UTF-8.
  const browser = await chromium.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
  const harness = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const F = await fx();
  try {
    await require('./e2e-cp5a-suites.cjs')({ browser, harness, F, compareCase, fullSpecs, newApp, openBytes, openSample, showPage, shot, exportViaUi, sha, shaBuf, check, info, setSection: (s) => (section = s), OUT, URL, HPORT, b64, ZOOM, INK_T, TOL_PX });
  } finally {
    await browser.close();
    harnessSrv.close();
    try {
      process.kill(-preview.pid);
    } catch {
      /* gia' chiuso */
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Immagini e PDF esportati in ${OUT}`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL [${f.section}] ${f.name} ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
