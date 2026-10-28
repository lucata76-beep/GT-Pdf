// Misure di CP5b su Chromium DESKTOP (non iPhone) per la decisione 5 di docs/PIANO.md: "Appiattito" su una scansione e su un vettoriale, per ogni DPI ammesso e per JPEG/PNG:
//   - byte del file; tempo da "Esporta" a "pronto" (dall'interfaccia, mediana di 3 prove); memoria: picco della SOMMA dell'RSS di tutti i processi di Chromium
//     (campionata ogni 50 ms, Chromium nuovo per ogni prova) meno quella prima di cliccare; qualita': PSNR del JPEG contro il PNG dello STESSO canvas (stessa pagina, stesso DPI).
//   - scelta della qualita' JPEG: byte e PSNR a qualita' 0.70 .. 0.95 a 300 dpi.
//   - memoria al crescere delle pagine: 1, 4 e 12 pagine di scansione a 300 dpi (le immagini restano in memoria fino al salvataggio?).
// NON e' una dipendenza del progetto: richiede Playwright con Chromium. Uso: node scripts/measure-cp5b.cjs [cartella-uscita] [tabella|qualita|pagine|png|rumore]
// I valori dipendono da questo computer e da Chromium: NON valgono per iPhone/Safari.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');
const { fullSpecs } = require('./export-specs.cjs');

const lib = createE2E({ name: 'measure-cp5b', out: process.argv[2], port: 4189, hport: 4190, zoom: 2 });
const { OUT, URL, HPORT, b64 } = lib;
const ONLY = process.argv[3] || 'tutto';
const REPS = 3;
const ENV = { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };
const MB = (kb) => kb / 1024;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function procKb(pid) {
  try {
    const t = readFileSync(`/proc/${pid}/status`, 'utf8');
    const g = (k) => Number((t.match(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm')) || [])[1] || 0);
    return { rss: g('VmRSS'), hwm: g('VmHWM') };
  } catch {
    return { rss: 0, hwm: 0 };
  }
}

/** Un Chromium nuovo, una pagina con l'app, il documento aperto e gli oggetti su ogni pagina. */
async function session(chromiumRef, doc) {
  const browser = await chromiumRef.launch({ env: ENV });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  await page.goto(URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  if (doc.sample) {
    await page.locator('summary', { hasText: 'PDF di prova' }).click();
    await page.getByRole('button', { name: doc.sample, exact: true }).click();
  } else await page.setInputFiles('input[type=file]', { name: doc.fileName, mimeType: 'application/pdf', buffer: Buffer.from(doc.bytes) });
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => window.__gtpdf.pages().length);
  for (let k = 1; k <= n; k++) await page.evaluate(({ k: p, specs }) => { window.__gtpdf.setScale(p, 0.5); window.__gtpdf.addSpecs(p, specs); }, { k, specs: doc.specs ? doc.specs(k) : fullSpecs() });
  await page.waitForTimeout(500);
  const cdp = await browser.newBrowserCDPSession();
  return { browser, ctx, page, cdp, pages: n };
}

/** Campiona la somma dell'RSS di tutti i processi di Chromium finche' non si chiama stop(). */
function sampler(cdp) {
  let ids = [];
  let peak = 0;
  let last = 0;
  let stopped = false;
  const refresh = async () => {
    try {
      ids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map((p) => ({ type: p.type, id: p.id }));
    } catch {
      /* browser chiuso */
    }
  };
  const total = () => ids.reduce((s, p) => s + procKb(p.id).rss, 0);
  const tick = () => {
    if (stopped) return;
    last = total();
    if (last > peak) peak = last;
  };
  const timer = setInterval(tick, 50);
  const refreshTimer = setInterval(refresh, 400);
  return {
    async start() {
      await refresh();
      tick();
      peak = last;
      return last;
    },
    resetPeak() {
      peak = total();
    },
    async stop() {
      tick();
      stopped = true;
      clearInterval(timer);
      clearInterval(refreshTimer);
      return { peak, last, types: ids.map((p) => p.type) };
    },
  };
}

/** Esporta dall'interfaccia (File > Esporta PDF > Appiattito > dpi > formato > Esporta) e misura. */
async function uiRun(s, { dpi, format }) {
  const { page } = s;
  const sm = sampler(s.cdp);
  const baseKb = await sm.start();
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  await page.locator('.menu-item', { hasText: 'Esporta PDF' }).click();
  await page.locator('.export-dialog').waitFor();
  await page.locator('.export-dialog label[data-value="flat"]').click();
  await page.locator(`.export-dialog label[data-value="${dpi}"]`).click();
  await page.locator(`.export-dialog label[data-value="${format}"]`).click();
  sm.resetPeak();
  const t0 = Date.now();
  await page.locator('.export-dialog .btn.primary', { hasText: 'Esporta' }).click();
  await page.locator('.export-dialog .exp-done-actions').waitFor({ timeout: 900000 });
  const ms = Date.now() - t0;
  const summary = (await page.locator('.export-dialog .exp-summary').innerText()).replace(/\s+/g, ' ');
  const afterKb = (await sm.stop()).last;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.export-dialog .btn', { hasText: 'Scarica' }).click()]);
  const bytes = readFileSync(await dl.path());
  const sizeOf = (re) => { const m = summary.match(re); return m ? Number(m[1]) * (m[2] === 'MB' ? 1024 * 1024 : 1024) : null; };
  return { ms, bytes: bytes.length, baseKb, peakKb: (await sm.stop()).peak || 0, afterKb, imageBytes: sizeOf(/Immagini inserite ([\d.]+) (kB|MB)/), summary, file: bytes };
}

async function pngFromPdf(L, bytes) {
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPages()[0];
  const xo = page.node.Resources().lookup(L.PDFName.of('XObject')).lookup(L.PDFName.of('GtFlat'));
  const d = xo.dict;
  return { contents: Buffer.from(xo.contents), w: d.lookup(L.PDFName.of('Width')).asNumber(), h: d.lookup(L.PDFName.of('Height')).asNumber(), filter: d.lookup(L.PDFName.of('Filter')).decodeText() };
}

async function main() {
  const servers = await lib.startAll(chromium);
  await servers.browser.close(); // non serve: ogni prova avvia un Chromium nuovo
  const F = await import('./export-fixtures.mjs');
  const L = await import('@cantoo/pdf-lib');
  const out = [];
  const log = (s) => { console.log(s); out.push(s); };
  try {
    const hb = await chromium.launch({ env: ENV });
    const hp = await (await hb.newContext()).newPage();
    await hp.goto(`http://localhost:${HPORT}/`);
    await hp.waitForFunction(() => window.harnessReady === true);
    // PSNR tra un JPEG e un PNG (stessa pagina, stesso canvas): decodifica nel browser
    await hp.evaluate(() => {
      const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (type, data) => { const t = new TextEncoder().encode(type); const o = new Uint8Array(12 + data.length); const dv = new DataView(o.buffer); dv.setUint32(0, data.length); o.set(t, 4); o.set(data, 8); const body = new Uint8Array(4 + data.length); body.set(t, 0); body.set(data, 4); dv.setUint32(8 + data.length, crc(body)); return o; };
      const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const decode = async (u8, type) => { const bm = await createImageBitmap(new Blob([u8], { type })); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0); const d = x.getImageData(0, 0, bm.width, bm.height).data; c.width = c.height = 1; return { w: bm.width, h: bm.height, d }; };
      window.psnr = async (jpegB64, idatB64, w, h) => {
        const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
        const idat = bytes(idatB64);
        const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
        const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
        const A = await decode(bytes(jpegB64), 'image/jpeg'); const B = await decode(png, 'image/png');
        if (A.w !== B.w || A.h !== B.h) return { error: `misure diverse ${A.w}x${A.h} / ${B.w}x${B.h}` };
        let se = 0, big = 0, mx = 0; const n = A.w * A.h;
        for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 3; c++) { const d = A.d[i * 4 + c] - B.d[i * 4 + c]; se += d * d; if (Math.abs(d) > m) m = Math.abs(d); } if (m > 24) big++; if (m > mx) mx = m; }
        const mse = se / (n * 3);
        return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), bigShare: big / n, max: mx, w: A.w, h: A.h };
      };
    });

    const SAMPLES = [['vettoriale', 'A4 vettoriale'], ['scansione', 'A4 scansione (immagine)']];

    if (ONLY === 'tutto' || ONLY === 'tabella') {
      log('\n## Tabella per la decisione 5 (Chromium desktop, A4, oggetti di prova, mediana di 3 prove)');
      log('| pagina | dpi | formato | pixel | file | immagini | tempo da Esporta a pronto | memoria: picco - base (somma RSS di Chromium) | PSNR contro il PNG |');
      log('|---|---|---|---|---|---|---|---|---|');
      for (const [label, title] of SAMPLES) {
        for (const dpi of [150, 300, 600]) {
          const res = {};
          for (const format of ['jpeg', 'png']) {
            const runs = [];
            for (let r = 0; r < REPS; r++) {
              const s = await session(chromium, { sample: title });
              try {
                runs.push(await uiRun(s, { dpi, format }));
              } finally {
                await s.browser.close();
              }
            }
            const med = runs.slice().sort((a, b) => a.ms - b.ms)[Math.floor(runs.length / 2)];
            res[format] = { ...med, msAll: runs.map((r) => r.ms), peakAll: runs.map((r) => MB(r.peakKb - r.baseKb)) };
            if (format === 'jpeg') writeFileSync(join(OUT, `${label}-${dpi}-jpeg.pdf`), med.file);
            else writeFileSync(join(OUT, `${label}-${dpi}-png.pdf`), med.file);
          }
          const j = await pngFromPdf(L, res.jpeg.file);
          const p = await pngFromPdf(L, res.png.file);
          const q = await hp.evaluate(([a, b, w, h]) => window.psnr(a, b, w, h), [j.contents.toString('base64'), p.contents.toString('base64'), j.w, j.h]);
          for (const format of ['jpeg', 'png']) {
            const r = res[format];
            const pm = median(r.peakAll);
            log(`| ${label} | ${dpi} | ${format.toUpperCase()} | ${j.w} × ${j.h} = ${(j.w * j.h).toLocaleString('it-IT')} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB | ${r.imageBytes !== null ? (r.imageBytes / 1024 / 1024).toFixed(2) : '?'} MB | ${(r.ms / 1000).toFixed(1)} s (${r.msAll.map((x) => (x / 1000).toFixed(1)).join('/')}) | ${pm.toFixed(0)} MB (${r.peakAll.map((x) => x.toFixed(0)).join('/')}) | ${format === 'png' ? 'senza perdita' : q.error ? q.error : `${q.psnr.toFixed(1)} dB, ${(q.bigShare * 100).toFixed(2)} % dei pixel con errore > 24, errore massimo ${q.max}`} |`);
          }
        }
      }
    }

    if (ONLY === 'tutto' || ONLY === 'qualita') {
      log('\n## Qualita\' JPEG a 300 dpi (byte dell\'immagine e PSNR contro il PNG dello stesso canvas)');
      log('| pagina | qualita\' | immagine | PSNR | pixel con errore > 24 | errore massimo |');
      log('|---|---|---|---|---|---|');
      for (const [label, title] of SAMPLES) {
        const s = await session(chromium, { sample: title });
        try {
          const png = await s.page.evaluate(() => window.__gtpdf.runExport({ mode: 'flat', dpi: 300, format: 'png', keep: true }).then(async () => window.__gtpdf.lastExportBase64()));
          const p = await pngFromPdf(L, Buffer.from(png, 'base64'));
          for (const quality of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
            const b = await s.page.evaluate((qq) => window.__gtpdf.runExport({ mode: 'flat', dpi: 300, format: 'jpeg', jpegQuality: qq, keep: true }).then(async (r) => ({ r, b64: await window.__gtpdf.lastExportBase64() })), quality);
            const j = await pngFromPdf(L, Buffer.from(b.b64, 'base64'));
            const q = await hp.evaluate(([a, c, w, h]) => window.psnr(a, c, w, h), [j.contents.toString('base64'), p.contents.toString('base64'), j.w, j.h]);
            log(`| ${label} | ${quality} | ${(j.contents.length / 1024).toFixed(0)} kB | ${q.psnr.toFixed(1)} dB | ${(q.bigShare * 100).toFixed(2)} % | ${q.max} |`);
          }
          log(`| ${label} | PNG | ${(p.contents.length / 1024).toFixed(0)} kB | senza perdita | - | - |`);
        } finally {
          await s.browser.close();
        }
      }
    }

    if (ONLY === 'tutto' || ONLY === 'pagine') {
      log('\n## Memoria al crescere delle pagine (scansione A4, 300 dpi, dall\'interfaccia)');
      log('| pagine | formato | file | immagini | tempo | picco - base (somma RSS) | per pagina |');
      log('|---|---|---|---|---|---|---|');
      const sample = readFileSync(join(__dirname, '..', 'public', 'test-pdfs', 'a4-scansione.pdf'));
      for (const n of [1, 4, 12]) {
        const src = await L.PDFDocument.load(sample);
        const dst = await L.PDFDocument.create();
        for (let i = 0; i < n; i++) {
          const [pg] = await dst.copyPages(src, [0]);
          dst.addPage(pg);
        }
        const bytes = await dst.save();
        for (const format of ['jpeg', 'png']) {
          const s = await session(chromium, { fileName: `scansione-${n}.pdf`, bytes });
          try {
            const r = await uiRun(s, { dpi: 300, format });
            const d = MB(r.peakKb - r.baseKb);
            log(`| ${n} | ${format.toUpperCase()} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB | ${r.imageBytes !== null ? (r.imageBytes / 1024 / 1024).toFixed(2) : '?'} MB | ${(r.ms / 1000).toFixed(1)} s | ${d.toFixed(0)} MB | ${(d / n).toFixed(0)} MB |`);
          } finally {
            await s.browser.close();
          }
        }
      }
    }
    if (ONLY === 'tutto' || ONLY === 'png') {
      log('\n## PNG: flusso IDAT copiato senza decodifica (pngDirect) contro embedPng di pdf-lib (gancio runExport, mediana di 3 prove)');
      log('| pagina | dpi | via | file | tempo totale | rasterizzazione | inserimento | salvataggio | picco - base (somma RSS) |');
      log('|---|---|---|---|---|---|---|---|---|');
      for (const [label, title] of SAMPLES) {
        for (const dpi of [300, 600]) {
          for (const direct of [true, false]) {
            const runs = [];
            for (let r = 0; r < REPS; r++) {
              const s = await session(chromium, { sample: title });
              try {
                const sm = sampler(s.cdp);
                const base = await sm.start();
                sm.resetPeak();
                const res = await s.page.evaluate((o) => window.__gtpdf.runExport(o), { mode: 'flat', dpi, format: 'png', pngDirect: direct });
                const st = await sm.stop();
                runs.push({ ...res, peakMb: MB(st.peak - base) });
              } finally {
                await s.browser.close();
              }
            }
            const med = runs.slice().sort((a, b) => a.total - b.total)[Math.floor(runs.length / 2)];
            log(`| ${label} | ${dpi} | ${direct ? 'IDAT copiato' : 'embedPng'} | ${(med.bytes / 1024 / 1024).toFixed(2)} MB | ${(med.total / 1000).toFixed(1)} s | ${(med.raster / 1000).toFixed(1)} s | ${(med.embed / 1000).toFixed(2)} s | ${(med.save / 1000).toFixed(2)} s | ${med.peakMb.toFixed(0)} MB (${runs.map((x) => x.peakMb.toFixed(0)).join('/')}) |`);
          }
        }
      }
    }
    if (ONLY === 'tutto' || ONLY === 'rumore') {
      // Caso peggiore: pagina fatta di PURO RUMORE (grigi casuali, 2480 x 3508 px = 300 dpi, quasi incomprimibile). La "scansione" di prova e' quasi uniforme e si comprime molto.
      const { deflateSync } = require('node:zlib');
      const w = 2480;
      const h = 3508;
      const raw = Buffer.alloc(w * h);
      let seed = 987654321;
      for (let i = 0; i < raw.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        raw[i] = seed >>> 24;
      }
      const z = deflateSync(raw, { level: 6 });
      const noiseDoc = async (n) => {
        const doc = await L.PDFDocument.create({ updateMetadata: false });
        const img = doc.context.register(doc.context.stream(z, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' }));
        for (let i = 0; i < n; i++) {
          const page = doc.addPage([595.276, 841.89]);
          const name = page.node.newXObject('Im', img); // il nome ha un suffisso casuale
          page.node.set(L.PDFName.of('Contents'), doc.context.obj([doc.context.register(doc.context.stream(`q 595.276 0 0 841.89 0 0 cm /${name.decodeText()} Do Q`))]));
        }
        return doc.save({ useObjectStreams: false });
      };
      log(`\n## Caso peggiore: pagina di rumore (immagine di ${(z.length / 1024 / 1024).toFixed(1)} MB compressa, 300 dpi, gia' nel PDF di partenza), dall'interfaccia`);
      log('| pagine | dpi | formato | file | immagini | tempo da Esporta a pronto | picco - base (somma RSS) |');
      log('|---|---|---|---|---|---|---|');
      for (const [n, dpi, format, reps] of [[1, 300, 'jpeg', 3], [1, 300, 'png', 3], [1, 600, 'jpeg', 3], [1, 600, 'png', 3], [12, 300, 'jpeg', 1], [12, 300, 'png', 1]]) {
        const bytes = await noiseDoc(n);
        const runs = [];
        for (let r = 0; r < reps; r++) {
          const s = await session(chromium, { fileName: `rumore-${n}.pdf`, bytes });
          try {
            runs.push(await uiRun(s, { dpi, format }));
          } finally {
            await s.browser.close();
          }
        }
        const med = runs.slice().sort((a, b) => a.ms - b.ms)[Math.floor(runs.length / 2)];
        log(`| ${n} | ${dpi} | ${format.toUpperCase()} | ${(med.bytes / 1024 / 1024).toFixed(1)} MB | ${med.imageBytes !== null ? (med.imageBytes / 1024 / 1024).toFixed(1) : '?'} MB | ${(med.ms / 1000).toFixed(1)} s (${runs.map((x) => (x.ms / 1000).toFixed(1)).join('/')}) | ${MB(med.peakKb - med.baseKb).toFixed(0)} MB (${runs.map((x) => MB(x.peakKb - x.baseKb).toFixed(0)).join('/')}) |`);
      }
    }
    await hb.close();
  } finally {
    servers.harnessSrv.close();
    try { process.kill(-servers.preview.pid); } catch { /* chiuso */ }
  }
  writeFileSync(join(OUT, 'misure-cp5b.md'), `${out.join('\n')}\n`);
  console.log(`\nSalvato in ${join(OUT, 'misure-cp5b.md')}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
