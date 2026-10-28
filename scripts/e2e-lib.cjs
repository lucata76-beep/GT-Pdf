// Infrastruttura comune delle prove Chromium di CP5 (e2e-cp5a.cjs, e2e-cp5b.cjs, measure-cp5b.cjs): anteprima del build di prova, pagina "harness"
// con PDF.js (resa di un PDF e confronti di immagini nel browser), apertura dei file nell'app, schermate del foglio, controlli e riepilogo.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const { mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');

const ROOT = resolve(__dirname, '..');

/** opts: { name, out?, port, hport, zoom } */
function createE2E(opts) {
  const OUT = opts.out || join(os.tmpdir(), `gtpdf-${opts.name}`);
  const DIST = join(OUT, 'dist-test');
  mkdirSync(OUT, { recursive: true });
  const PORT = opts.port;
  const HPORT = opts.hport;
  const URL = `http://localhost:${PORT}/`;
  const ZOOM = opts.zoom ?? 2;

  const results = [];
  let section = '';
  const setSection = (s) => (section = s);
  const check = (name, ok, detail = '') => {
    results.push({ section, name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
  };
  const info = (text) => console.log(`INFO  [${section}] ${text}`);

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

// Caratteristiche di ogni pagina come le vede PDF.js: area visibile (view), /Rotate, UserUnit.
window.pageInfos = async (data) => {
  const task = open(b64(data));
  try { const doc = await task.promise; const out = []; for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); out.push({ view: p.view, rotate: p.rotate, userUnit: p.userUnit }); } return out; }
  finally { await task.destroy(); }
};

// ---- Confronto TOLLERANTE tra due rese della stessa pagina a risoluzioni diverse (A = app, B = PDF esportato) ----
// Le due rese sono antialiasate in modo diverso (vettori contro un'immagine a 150-600 dpi ricampionata, JPEG con perdita): un confronto pixel per pixel
// fallirebbe sempre sui bordi. Un pixel e' "fuori" se, in almeno un canale, il valore di B esce dall'intervallo [min, max] dei pixel di A entro r pixel,
// allargato di tol (e viceversa). I pixel si dividono in "oggetti" (A differisce da A0, la stessa pagina senza oggetti, oltre T, poi dilatati di grow) e "resto".
function envelopeOf(img, w, h, r) {
  const n = w * h * 3, tmn = new Uint8Array(n), tmx = new Uint8Array(n), mn = new Uint8Array(n), mx = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { const v = img.d[(y * img.w + k) * 4 + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
    tmn[(y * w + x) * 3 + c] = lo; tmx[(y * w + x) * 3 + c] = hi;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { const i = (k * w + x) * 3 + c; if (tmn[i] < lo) lo = tmn[i]; if (tmx[i] > hi) hi = tmx[i]; }
    mn[(y * w + x) * 3 + c] = lo; mx[(y * w + x) * 3 + c] = hi;
  }
  return { mn, mx };
}
function dilate(mask, w, h, g) {
  if (!g) return mask;
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, x - g); k <= Math.min(w - 1, x + g) && !v; k++) v = mask[y * w + k]; t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, y - g); k <= Math.min(h - 1, y + g) && !v; k++) v = t[k * w + x]; o[y * w + x] = v; }
  return o;
}
window.envelope = async (a0u, au, bu, o) => {
  const [A0, A, Bs] = await Promise.all([decode(a0u), decode(au), decode(bu)]);
  const B = shifted(Bs, o.shift ? o.shift[0] : 0, o.shift ? o.shift[1] : 0);
  const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
  const eA = envelopeOf(A, w, h, o.r), eB = envelopeOf(B, w, h, o.r);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * A.w + x) * 4, j = (y * A0.w + x) * 4; if (Math.max(Math.abs(A.d[i] - A0.d[j]), Math.abs(A.d[i + 1] - A0.d[j + 1]), Math.abs(A.d[i + 2] - A0.d[j + 2])) > o.T) ink[y * w + x] = 1; }
  const reg = dilate(ink, w, h, o.grow);
  const s = { w, h, sizeA: [A.w, A.h], sizeB: [Bs.w, Bs.h], nObj: 0, nRest: 0, outBObj: 0, outBRest: 0, outAObj: 0, outARest: 0, maxBExcess: 0, maxAExcess: 0 };
  const out = document.createElement('canvas'); out.width = w * 3; out.height = h; const ctx = out.getContext('2d');
  const idA = ctx.createImageData(w, h), idB = ctx.createImageData(w, h), idD = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, ia = (y * A.w + x) * 4, ib = (y * B.w + x) * 4;
    let exB = 0, exA = 0;
    for (let c = 0; c < 3; c++) {
      const b = B.d[ib + c], a = A.d[ia + c];
      exB = Math.max(exB, eA.mn[p * 3 + c] - b, b - eA.mx[p * 3 + c]);
      exA = Math.max(exA, eB.mn[p * 3 + c] - a, a - eB.mx[p * 3 + c]);
    }
    const outB = exB > o.tol, outA = exA > o.tol;
    if (reg[p]) { s.nObj++; if (outB) s.outBObj++; if (outA) s.outAObj++; } else { s.nRest++; if (outB) s.outBRest++; if (outA) s.outARest++; }
    if (exB > s.maxBExcess) s.maxBExcess = exB;
    if (exA > s.maxAExcess) s.maxAExcess = exA;
    for (let c = 0; c < 3; c++) { idA.data[p * 4 + c] = A.d[ia + c]; idB.data[p * 4 + c] = B.d[ib + c]; }
    idA.data[p * 4 + 3] = 255; idB.data[p * 4 + 3] = 255;
    const [r, g, bl] = outA && outB ? [150, 60, 180] : outB ? [230, 40, 40] : outA ? [40, 80, 230] : reg[p] ? [235, 235, 235] : [255, 255, 255];
    idD.data[p * 4] = r; idD.data[p * 4 + 1] = g; idD.data[p * 4 + 2] = bl; idD.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(idA, 0, 0); ctx.putImageData(idB, w, 0); ctx.putImageData(idD, w * 2, 0);
  s.image = o.noImage ? null : out.toDataURL('image/png');
  return s;
};

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


  /** Costruisce il build di prova (GTPDF_TEST=1) fuori dal repository e avvia anteprima e harness. Restituisce i server. */
  async function startAll(chromium) {
    execFileSync('node', ['scripts/copy-pdfjs-assets.mjs'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GTPDF_TEST: '1' } });
    const preview = await startPreview();
    const harnessSrv = await startHarness();
    // Con la locale POSIX (tipica dei contenitori Linux) Chromium sostituisce con "download" i nomi di file con caratteri non ASCII: serve UTF-8.
    const browser = await chromium.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
    const harness = await browser.newContext({ viewport: { width: 800, height: 600 } });
    return { browser, harness, preview, harnessSrv };
  }
  async function stopAll({ browser, preview, harnessSrv }) {
    await browser.close();
    harnessSrv.close();
    try {
      process.kill(-preview.pid);
    } catch {
      /* gia' chiuso */
    }
  }
  function finish() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Immagini e PDF in ${OUT}`);
    if (failed.length) {
      for (const f of failed) console.log(`FAIL [${f.section}] ${f.name} ${f.detail}`);
      process.exit(1);
    }
    process.exit(0);
  }

  return { ROOT, OUT, DIST, PORT, HPORT, URL, ZOOM, results, check, info, setSection, startPreview, startHarness, startAll, stopAll, finish, sha, shaBuf, newApp, openBytes, openSample, showPage, shot, b64 };
}

module.exports = { createE2E, ROOT };
