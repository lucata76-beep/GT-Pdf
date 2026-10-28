// Misura di tempo e memoria dell'esportazione "Copertura semplice" su un PDF SINTETICO multipagina (non nel repository, generato qui):
// 124 pagine alternate A4/A3, ogni pagina con un disegno vettoriale (1500 segmenti, righe di testo) e un'immagine in grigi non comprimibile,
// per arrivare a circa 22 MB, come l'ordine di grandezza del PDF reale aperto su iPhone in CP0 (21,91 MB, 124 pagine, aperto in 73 ms).
// Misura in CHROMIUM DESKTOP (questo contenitore), NON su iPhone: i numeri non valgono per il telefono.
// Uso: node scripts/perf-cp5a.cjs [cartella-di-lavoro]   (build di prova con GTPDF_TEST=1 fuori dal repository)
const { spawn, execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { fullSpecs } = require('./export-specs.cjs');

const ROOT = resolve(__dirname, '..');
const OUT = process.argv[2] || join(os.tmpdir(), 'gtpdf-perf-cp5a');
const DIST = join(OUT, 'dist-test');
const PDF = join(OUT, 'sintetico-124-pagine.pdf'); // fuori dal repository (e *.pdf e' comunque ignorato)
mkdirSync(OUT, { recursive: true });
const PORT = 4187;
const URL = `http://localhost:${PORT}/`;
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
    page.node.newXObject('Im1', imgRef);
    const ops = [`q ${w * 0.3} 0 0 ${w * 0.3} ${w * 0.35} ${h * 0.35} cm /Im1 Do Q`, '0.3 w'];
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
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(PDF, bytes);
  return bytes.length;
}

// ---- memoria del processo del renderer (Linux): RSS con campionamento esterno, VmHWM = picco dal /proc ----
function rendererPids() {
  const out = execFileSync('ps', ['-eo', 'pid,rss,args', '--no-headers'], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes('--type=renderer'))
    .map((l) => ({ pid: Number(l.trim().split(/\s+/)[0]), rss: Number(l.trim().split(/\s+/)[1]) }))
    .sort((a, b) => b.rss - a.rss);
}
const status = (pid) => {
  const s = readFileSync(`/proc/${pid}/status`, 'utf8');
  const kb = (k) => Number((s.match(new RegExp(`${k}:\\s+(\\d+)`)) || [0, 0])[1]);
  return { rss: kb('VmRSS'), hwm: kb('VmHWM') };
};
const MB = (kb) => (kb / 1024).toFixed(0);

async function scenario(browser, name, pagesWithObjects, objectsPerTick) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(URL);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', PDF);
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0, null, { timeout: 120000 });
  const openMs = Date.now() - t0;
  const openMsg = await page.locator('.st-msg').innerText();
  const specs = fullSpecs();
  const touched = Array.from({ length: pagesWithObjects }, (_, i) => 1 + Math.floor((i * PAGES) / pagesWithObjects));
  await page.evaluate(([list, s]) => { for (const n of list) window.__gtpdf.addSpecs(n, s); }, [touched, specs]);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.gc && window.gc());
  const heap0 = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const [{ pid }] = rendererPids();
  const base = status(pid);
  let peak = base.rss;
  const timer = setInterval(() => {
    try {
      peak = Math.max(peak, status(pid).rss);
    } catch {
      /* processo terminato */
    }
  }, 20);
  const r = await page.evaluate((n) => window.__gtpdf.runExport(n), objectsPerTick);
  clearInterval(timer);
  const after = status(pid);
  const heap1 = await page.evaluate(() => performance.memory.usedJSHeapSize);
  await page.evaluate(() => window.gc && window.gc());
  const heap2 = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const long = await page.evaluate(() => window.__long.slice());
  await ctx.close();
  return { name, openMs, openMsg, base, peak: Math.max(peak, after.hwm), after, heap0, heap1, heap2, r, longMax: long.length ? Math.max(...long) : 0, longN: long.length };
}

async function main() {
  execFileSync('node', ['scripts/copy-pdfjs-assets.mjs'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GTPDF_TEST: '1' } });
  const size = existsSync(PDF) && statSync(PDF).size > 1e6 ? statSync(PDF).size : await makePdf();
  console.log(`PDF sintetico: ${PAGES} pagine, ${(size / 1048576).toFixed(2)} MB (${PDF}, fuori dal repository)`);
  const preview = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('anteprima non avviata')), 30000);
    preview.stdout.on('data', (d) => String(d).includes('localhost') && (clearTimeout(t), res()));
  });
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'], env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  console.log(`Chromium ${browser.version()}, ${os.cpus().length} CPU (${os.cpus()[0].model}), RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GB; contenitore, NON iPhone`);
  const rows = [];
  const plan = [
    ['0 pagine con oggetti', 0, undefined],
    ['12 pagine con oggetti (17 ciascuna)', 12, undefined],
    ['12 pagine, objectsPerTick 1000', 12, 1000],
    ['tutte le 124 pagine (17 ciascuna)', 124, undefined],
  ];
  for (const [name, n, tick] of plan) for (let k = 0; k < 3; k++) rows.push(await scenario(browser, name, n, tick));
  await browser.close();
  try {
    process.kill(-preview.pid);
  } catch {
    /* gia' chiuso */
  }
  const f = (x) => (x / 1000).toFixed(2);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(40)} apertura ${r.openMs} ms (${r.openMsg.slice(-22)}) | totale ${f(r.r.total)} s = lettura ${f(r.r.load)} + scrittura ${f(r.r.draw)} + salvataggio ${f(r.r.save)} + controllo ${f(r.r.verify)} | file ${(r.r.bytes / 1048576).toFixed(2)} MB, ${r.r.touchedPages} pagine, ${r.r.objectCount} oggetti | RSS renderer: base ${MB(r.base.rss)} MB, picco ${MB(r.peak)} MB (+${MB(r.peak - r.base.rss)}), dopo ${MB(r.after.rss)} MB | heap JS ${(r.heap0 / 1048576).toFixed(0)} -> ${(r.heap1 / 1048576).toFixed(0)} -> (dopo gc) ${(r.heap2 / 1048576).toFixed(0)} MB | long task: ${r.longN}, massimo ${r.longMax.toFixed(0)} ms`,
    );
  }
  writeFileSync(join(OUT, 'perf-risultati.json'), JSON.stringify(rows, null, 1));
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
