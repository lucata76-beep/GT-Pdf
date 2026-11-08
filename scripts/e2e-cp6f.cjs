// Prove di CP6f (Snap ampliato) su Chromium: i candidati nuovi dello snap (Intersezione, Quadrante, Perpendicolare, Tangente, Origine), i loro interruttori, i marcatori e le
// etichette, la priorita' a parita' di distanza, il punto di partenza di Perpendicolare e Tangente (Retta, Distanza, Sposta, Specchio, Scala sì; Cerchio, Copertura, Testo no),
// i tipi nuovi spenti (nessun candidato nuovo, come prima), progetto (versione 3, nessun campo nuovo, interruttori non salvati) ed esportazione (marcatori solo a schermo).
// Mouse (desktop 1280 x 900, clic reali) e tocco emulato (iPhone 390 x 780, DPR 3, CDP) su tre pagine: A4 vettoriale, A4 con /Rotate 90, A4 con CropBox.
// Punti ESATTI: i punti attesi si calcolano QUI, con formule indipendenti dall'app, nel foglio mostrato (pt fisici, Y in giu') a partire dai punti degli oggetti del modello;
// il punto inserito dall'app deve coincidere entro 1e-6 pt. Il punto di partenza di Perpendicolare e Tangente e' l'Estremo di una retta nota (agganciato), cosi' e' esatto.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp6f.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: su c4380b0 i controlli sul comportamento nuovo FALLISCONO)
//   E2E_ONLY=esatti,interruttori,priorita,partenza,marcatori,bordo,progetto,export,tocco: solo alcune serie (per il debug)
// Chromium NON e' il browser dell'utente: nulla di quanto segue prova il comportamento li'.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp6f', out: process.argv[2], port: 4224, hport: 4225, zoom: 2 });
const { check, info, setSection, URL: APP_URL, openSample, newApp } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-6) => !!p && !!q && near(p.x, q.x, tol) && near(p.y, q.y, tol);
const SAMPLES = [
  ['A4 vettoriale', 'a4-vettoriale.pdf'],
  ['A4 con /Rotate 90', 'a4-rotate90.pdf'],
  ['A4 con CropBox', 'a4-cropbox.pdf'],
];
const PDF_DIR = join(__dirname, '..', 'public', 'test-pdfs');
const SW = ['end', 'mid', 'center', 'intersection', 'quadrant', 'perpendicular', 'tangent'];
const LABEL = { end: 'Estremo', mid: 'Punto medio', center: 'Centro', origin: 'Origine', intersection: 'Intersezione', quadrant: 'Quadrante', perpendicular: 'Perpendicolare', tangent: 'Tangente' };
/** Forma del marcatore (8 x 8 px) per tipo: etichetta del tag e attributi; il tangente e l'origine sono gruppi (cerchio + tratto). */
const SIG = {
  end: 'rect:',
  mid: 'polygon:0,-4 4,4 -4,4',
  center: 'circle:',
  origin: 'g:circle4+pathM-2 0H2M0 -2V2',
  intersection: 'path:M-4 -4L4 4M-4 4L4 -4',
  quadrant: 'polygon:0,-4 4,0 0,4 -4,0',
  perpendicular: 'path:M-4 -4V4H4',
  tangent: 'g:circle3+pathM-4 2H4',
};

// ---------------------------------------------------------------- strumenti di prova
async function desktop(browser, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page };
}
async function phone(browser, w = 390, h = 780) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript(() => localStorage.setItem('gtpdf.uiSize', '1'));
  // registra gli argomenti con cui la lente copia il canvas del PDF (solo la lente: classe lens-canvas)
  await page.addInitScript(() => {
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    window.__lensCalls = [];
    CanvasRenderingContext2D.prototype.drawImage = function (...a) {
      if (this.canvas && this.canvas.classList && this.canvas.classList.contains('lens-canvas')) window.__lensCalls.push(a.slice(1).map(Number));
      return orig.apply(this, a);
    };
  });
  await page.goto(APP_URL);
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  return { ctx, page, cdp };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1 })) });
const tool = async (page, label) => {
  await page.locator(`button.tool[title="${label}"]`).click();
  await page.waitForTimeout(150);
};
const status = (page) => page.locator('.st-msg').innerText();
const hint = (page) => page.locator('.ctx-hint').innerText();
const objectsOf = (page, n = 0) => page.evaluate((k) => window.__gtpdf.state().pages[k].objects, n);
const state = (page) => page.evaluate(() => window.__gtpdf.state());
const lastObj = async (page) => {
  const o = await objectsOf(page);
  return o[o.length - 1];
};
const undo = async (page) => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
};
const redo = async (page) => {
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(80);
};
const panelBtn = (page, k) => page.locator(`.panel-toggle[data-panel-toggle="${k}"]`);
const statusBtn = (page, k) => page.locator(`.statusbar .st-toggle[data-toggle="${k}"]`);
const isOn = async (loc) => (await loc.count()) > 0 && (await loc.getAttribute('aria-pressed')) === 'true'; // un interruttore che non c'e' (build di c4380b0) conta come spento: i controlli sul comportamento nuovo falliscono uno per uno invece di interrompere la serie
/** Accende SOLO i tipi elencati (dal pannello "Aggancio e griglia"; dove il pannello e' a scomparsa (sotto 900 px) lo apre e lo richiude). */
async function only(page, list) {
  const hidden = !(await panelBtn(page, 'end').isVisible());
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  for (const k of SW) {
    const b = panelBtn(page, k);
    if ((await b.count()) === 0) continue; // sul build di c4380b0 i quattro tipi nuovi non hanno l'interruttore
    if ((await isOn(b)) !== list.includes(k)) await b.click();
  }
  if (hidden) {
    await page.locator('.insp-toggle').click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(60);
}

/** Geometria della pagina 1, calcolata qui da `pages()` con le stesse formule di `PageGeometry` (come e2e-cp6a, cp6b e cp6c). */
function makeGeom(info) {
  const [x0, y0, x1, y1] = info.view;
  const sU = info.userUnit > 0 ? info.userUnit : 1;
  const rot = (((info.rotate % 360) + 360) % 360) | 0;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rot];
  let offX, offY, width, height;
  if (a === 0) {
    offX = Math.abs(cy - y0) * sU;
    offY = Math.abs(cx - x0) * sU;
    width = (y1 - y0) * sU;
    height = (x1 - x0) * sU;
  } else {
    offX = Math.abs(cx - x0) * sU;
    offY = Math.abs(cy - y0) * sU;
    width = (x1 - x0) * sU;
    height = (y1 - y0) * sU;
  }
  const m = [a * sU, b * sU, c * sU, d * sU, offX - a * sU * cx - c * sU * cy, offY - b * sU * cx - d * sU * cy];
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    width,
    height,
    userToSheet: (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
    sheetToUser: (p) => {
      const x = p.x - m[4];
      const y = p.y - m[5];
      return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
    },
  };
}
let G = null; // geometria della pagina 1 del documento aperto (impostata da openDoc)
const canvasRect = (page) => page.evaluate(() => { const r = document.querySelector('.viewer-stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const pageInfo = (page) => page.evaluate(() => window.__gtpdf.pages()[0]);
const userOf = (info, f) => ({ x: info.view[0] + f[0] * (info.view[2] - info.view[0]), y: info.view[1] + f[1] * (info.view[3] - info.view[1]) });
const clientOfSheet = async (page, s) => {
  const r = await canvasRect(page);
  const k = r.width / G.width;
  return { x: r.left + s.x * k, y: r.top + s.y * k };
};
const zoomPx = async (page) => (await canvasRect(page)).width / G.width;
const sh = (u) => G.userToSheet(u);
const us = (s) => G.sheetToUser(s);

// ---- geometria indipendente (nel foglio mostrato, pt fisici, Y in giu'): intersezioni, piedi, tangenti, quadranti
const M2PI = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
/** Cerchio per tre punti: centro, raggio, angolo iniziale e sweep con segno (angolo crescente = orario con Y in giu'). */
function circum(p1, p2, p3) {
  const ax = p2.x - p1.x, ay = p2.y - p1.y, bx = p3.x - p1.x, by = p3.y - p1.y;
  const d = 2 * (ax * by - ay * bx);
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by;
  const ux = (by * a2 - ay * b2) / d, uy = (ax * b2 - bx * a2) / d;
  const c = { x: p1.x + ux, y: p1.y + uy };
  const a0 = Math.atan2(-uy, -ux);
  const a3 = Math.atan2(p3.y - c.y, p3.x - c.x);
  return { c, r: Math.hypot(ux, uy), a0, sweep: d > 0 ? M2PI(a3 - a0) : -M2PI(a0 - a3) };
}
const onArc = (ar, p) => {
  const an = Math.atan2(p.y - ar.c.y, p.x - ar.c.x);
  return (ar.sweep > 0 ? M2PI(an - ar.a0) : M2PI(ar.a0 - an)) <= Math.abs(ar.sweep);
};
function segSeg(s, t) {
  const r = sub(s.b, s.a), q = sub(t.b, t.a);
  const den = r.x * q.y - r.y * q.x;
  if (Math.abs(den) < 1e-12) return [];
  const u = ((t.a.x - s.a.x) * q.y - (t.a.y - s.a.y) * q.x) / den;
  const v = ((t.a.x - s.a.x) * r.y - (t.a.y - s.a.y) * r.x) / den;
  return u < 0 || u > 1 || v < 0 || v > 1 ? [] : [{ x: s.a.x + u * r.x, y: s.a.y + u * r.y }];
}
function segCirc(s, c) {
  const d = sub(s.b, s.a), f = sub(s.a, c.c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r;
  const D = B * B - 4 * A * C;
  if (D < 0) return [];
  const out = [];
  for (const sg of [-1, 1]) {
    const t = (-B + sg * Math.sqrt(D)) / (2 * A);
    if (t >= 0 && t <= 1) out.push({ x: s.a.x + t * d.x, y: s.a.y + t * d.y });
  }
  return out;
}
function circCirc(a, b) {
  const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y, d = Math.hypot(dx, dy);
  if (d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const t = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - t * t));
  const mx = a.c.x + (t * dx) / d, my = a.c.y + (t * dy) / d;
  return [{ x: mx + (h * dy) / d, y: my - (h * dx) / d }, { x: mx - (h * dy) / d, y: my + (h * dx) / d }];
}
const quads = (c) => [['destra', { x: c.c.x + c.r, y: c.c.y }], ['basso', { x: c.c.x, y: c.c.y + c.r }], ['sinistra', { x: c.c.x - c.r, y: c.c.y }], ['alto', { x: c.c.x, y: c.c.y - c.r }]];
const footSeg = (P, s) => {
  const d = sub(s.b, s.a);
  const t = dot(sub(P, s.a), d) / dot(d, d);
  return { p: { x: s.a.x + t * d.x, y: s.a.y + t * d.y }, t };
};
const feetCirc = (P, c) => {
  const d = hyp(P, c.c);
  const ux = (P.x - c.c.x) / d, uy = (P.y - c.c.y) / d;
  return [{ x: c.c.x + c.r * ux, y: c.c.y + c.r * uy }, { x: c.c.x - c.r * ux, y: c.c.y - c.r * uy }];
};
const tangents = (P, c) => {
  const d = hyp(P, c.c);
  const th = Math.atan2(P.y - c.c.y, P.x - c.c.x), al = Math.acos(c.r / d);
  return [th + al, th - al].map((a) => ({ x: c.c.x + c.r * Math.cos(a), y: c.c.y + c.r * Math.sin(a) }));
};

/**
 * La scena (frazioni dell'area visibile, origine in basso a sinistra). Tutti i punti d'intersezione sono lontani fra loro (>= 48 pt) e le ancore (estremi dei "pioli" ST1, ST2, ST3)
 * stanno in zone libere: i punti di partenza di Perpendicolare e Tangente sono Estremi, quindi ESATTI.
 */
const NAMES = ['A', 'B', 'K1', 'S3', 'K3', 'K4', 'AR', 'S5', 'S6', 'S4', 'K5', 'ST1', 'ST2', 'ST3'];
const SPECS = [
  { k: 'segment', pts: [[0.13, 0.79], [0.43, 0.89]] }, // A (taglia B a 3/10 della sua lunghezza: l'incrocio e' lontano dai punti medi e dagli estremi)
  { k: 'segment', pts: [[0.045, 0.904], [0.295, 0.784]] }, // B
  { k: 'circle', a: [0.7, 0.8], b: [0.8, 0.8] }, // K1
  { k: 'segment', pts: [[0.55, 0.72], [0.88, 0.86]] }, // S3 (taglia K1 in due punti)
  { k: 'circle', a: [0.62, 0.34], b: [0.72, 0.34] }, // K3
  { k: 'circle', a: [0.74, 0.22], b: [0.88, 0.22] }, // K4 (taglia K3 in due punti)
  { k: 'arc', a: [0.12, 0.5], b: [0.22, 0.6], c: [0.4, 0.52] }, // AR (arco di circa 174 gradi)
  { k: 'segment', pts: [[0.2, 0.42], [0.3, 0.66]] }, // S5 (taglia AR)
  { k: 'segment', pts: [[0.05, 0.62], [0.38, 0.4]] }, // S6 (taglia il cerchio di AR in un punto dell'arco e in uno fuori)
  { k: 'segment', pts: [[0.08, 0.12], [0.45, 0.26]] }, // S4 (per la perpendicolare)
  { k: 'circle', a: [0.78, 0.5], b: [0.88, 0.5] }, // K5 (per la tangente)
  { k: 'segment', pts: [[0.04, 0.3], [0.04, 0.34]] }, // ST1: l'estremo (0.04, 0.30) e' l'ancora per S4
  { k: 'segment', pts: [[0.5, 0.8], [0.47, 0.83]] }, // ST2: l'estremo (0.50, 0.80) e' l'ancora per K1
  { k: 'segment', pts: [[0.52, 0.58], [0.55, 0.61]] }, // ST3: l'estremo (0.52, 0.58) e' l'ancora per K5 e per l'arco
];
/** Oggetti della scena nel foglio, letti dal modello (ordine di NAMES). */
async function readScene(page) {
  const objs = (await objectsOf(page)).slice(-NAMES.length);
  const seg = (o) => ({ a: sh(o.points[0]), b: sh(o.points[1]), user: o.points });
  const circ = (o) => ({ c: sh(o.p1), r: hyp(sh(o.p1), sh(o.p2)) });
  const arc = (o) => circum(sh(o.p1), sh(o.p2), sh(o.p3));
  const S = {};
  NAMES.forEach((n, i) => (S[n] = n.startsWith('K') ? circ(objs[i]) : n === 'AR' ? arc(objs[i]) : seg(objs[i])));
  S.anchor = { ST1: S.ST1.a, ST2: S.ST2.a, ST3: S.ST3.a };
  return S;
}
async function openDoc(page, title = 'A4 vettoriale', scene = true) {
  await openSample(page, title);
  G = makeGeom(await page.evaluate(() => window.__gtpdf.pages()[0]));
  await page.evaluate(() => window.__gtpdf.fit());
  await page.waitForTimeout(400);
  if (scene) await page.evaluate((s) => window.__gtpdf.addSpecs(1, s), SPECS);
  await page.waitForTimeout(250);
}
async function click(page, c, dx = 0, dy = 0) {
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(70);
}
/** Il marcatore di snap: tipo, etichetta, forma, dimensioni, colore, posizione e riquadro dell'etichetta. */
const snapMark = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.snap-mark');
    if (!g || g.getAttribute('display') === 'none') return null;
    const t = g.querySelector('text');
    const kids = [...g.children].filter((e) => e.tagName.toLowerCase() !== 'text');
    const rs = kids.map((e) => e.getBoundingClientRect());
    const sig = kids.map((e) => e.tagName.toLowerCase() + ':' + (e.getAttribute('points') ?? e.getAttribute('d') ?? [...e.children].map((c) => c.tagName.toLowerCase() + (c.getAttribute('r') ?? c.getAttribute('d'))).join('+'))).join('|');
    const first = kids[0].tagName.toLowerCase() === 'g' ? kids[0].firstElementChild : kids[0];
    const cs = getComputedStyle(first);
    const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(g.getAttribute('transform') || '');
    const ov = document.querySelector('.viewer-overlay').getBoundingClientRect();
    const tx = t ? t.getBoundingClientRect() : null;
    return {
      kind: g.dataset.kind,
      label: t?.textContent ?? null,
      sig,
      w: Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)),
      h: Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top)),
      stroke: cs.stroke,
      strokeWidth: cs.strokeWidth,
      x: tr ? ov.left + +tr[1] : null,
      y: tr ? ov.top + +tr[2] : null,
      anchor: t?.getAttribute('text-anchor') ?? null,
      labelRect: tx ? { l: tx.left, r: tx.right, t: tx.top, b: tx.bottom } : null,
      box: { l: ov.left, r: ov.right, t: ov.top, b: ov.bottom },
    };
  });
const hexRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
/** Passa il mouse vicino a un punto del foglio e restituisce il marcatore di snap. */
async function hoverS(page, s, dx = 3, dy = -3) {
  const c = await clientOfSheet(page, s);
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.waitForTimeout(80);
  return snapMark(page);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Il marcatore e' del tipo e dell'etichetta attesi e sta sul punto atteso (entro 0.75 px). */
async function markOk(page, mk, kind, s) {
  if (!mk) return false;
  const c = await clientOfSheet(page, s);
  return mk.kind === kind && mk.label === LABEL[kind] && dist({ x: mk.x, y: mk.y }, c) < 0.75;
}
const FREE = [0.3, 0.03]; // un punto libero (nessun oggetto vicino) per chiudere una retta
const freeClient = async (page, info) => clientOfSheet(page, sh(userOf(info, FREE)));

/** Con lo strumento Retta: aggancia il PRIMO punto sul candidato `target` (foglio), chiude la retta in un punto libero, legge il punto inserito e annulla. */
async function firstPointAt(page, info, name, target, kind, mk0) {
  await tool(page, 'Retta');
  const c = await clientOfSheet(page, target);
  await page.mouse.move(c.x + 3, c.y - 3);
  await page.waitForTimeout(80);
  const mk = mk0 ?? (await snapMark(page));
  check(`${name}: marcatore "${LABEL[kind]}" sul candidato (tipo, etichetta e posizione entro 0.75 px)`, await markOk(page, mk, kind, target), JSON.stringify(mk && { kind: mk.kind, label: mk.label, x: mk.x, y: mk.y }));
  await click(page, c, 3, -3);
  await click(page, await freeClient(page, info));
  const o = await lastObj(page);
  check(`${name}: il primo punto della Retta e' il candidato (entro 1e-6 pt)`, o?.kind === 'segment' && nearP(o.points[0], us(target)), JSON.stringify([o?.points?.[0], us(target)]));
  await undo(page);
}
/** Con lo strumento Retta: primo punto sull'Estremo `anchor` (foglio), poi aggancia il SECONDO sul candidato `target` e legge il punto inserito; annulla. */
async function secondPointAt(page, name, anchor, target, kind) {
  await tool(page, 'Retta');
  await click(page, await clientOfSheet(page, anchor), 2, 2);
  const c = await clientOfSheet(page, target);
  await page.mouse.move(c.x + 3, c.y - 3);
  await page.waitForTimeout(80);
  const mk = await snapMark(page);
  check(`${name}: marcatore "${LABEL[kind]}" sul candidato (tipo, etichetta e posizione entro 0.75 px)`, await markOk(page, mk, kind, target), JSON.stringify(mk && { kind: mk.kind, label: mk.label, x: mk.x, y: mk.y }));
  await click(page, c, 3, -3);
  const o = await lastObj(page);
  check(`${name}: il secondo punto della Retta e' il candidato (entro 1e-6 pt) e il primo e' l'ancora`, o?.kind === 'segment' && nearP(o.points[1], us(target)) && nearP(o.points[0], us(anchor)), JSON.stringify([o?.points, us(target)]));
  await undo(page);
  return o;
}

// ---------------------------------------------------------------- 1) punti esatti su tre pagine, mouse
async function exactSuite(browser, title) {
  setSection(`candidati nuovi con punti esatti, mouse 1280x900, ${title}`);
  const { ctx, page } = await desktop(browser);
  await openDoc(page, title);
  const info0 = await pageInfo(page);
  const S = await readScene(page);
  const zk = await zoomPx(page);
  info(`${title}: zoom ${zk.toFixed(3)} px/pt, raggio del mouse ${(10 / zk).toFixed(1)} pt`);

  // ---- Intersezione
  await only(page, ['intersection']);
  const nI = (await objectsOf(page)).length;
  const inter = [
    ['tratto-tratto (A e B)', segSeg(S.A, S.B)[0]],
    ['tratto-cerchio (S3 e K1), primo punto', segCirc(S.S3, S.K1)[0]],
    ['tratto-cerchio (S3 e K1), secondo punto', segCirc(S.S3, S.K1)[1]],
    ['cerchio-cerchio (K3 e K4), primo punto', circCirc(S.K3, S.K4)[0]],
    ['cerchio-cerchio (K3 e K4), secondo punto', circCirc(S.K3, S.K4)[1]],
    ['tratto-arco (S5 e AR)', segCirc(S.S5, S.AR).filter((p) => onArc(S.AR, p))[0]],
    ['tratto-arco (S6 e AR, nel tratto dell\'arco)', segCirc(S.S6, S.AR).filter((p) => onArc(S.AR, p))[0]],
    ['tratto-tratto (S5 e S6)', segSeg(S.S5, S.S6)[0]],
  ];
  check('(premessa) le 8 intersezioni attese esistono tutte (calcolo indipendente)', inter.every(([, p]) => !!p) && (await objectsOf(page)).length === nI, JSON.stringify(inter.map(([n, p]) => [n, !!p])));
  for (const [n, p] of inter) await firstPointAt(page, info0, `Intersezione ${n}`, p, 'intersection');
  // il cerchio dell'arco tagliato da S6 anche FUORI dall'arco: li' non c'e' intersezione
  const outArc = segCirc(S.S6, S.AR).filter((p) => !onArc(S.AR, p))[0];
  check('(premessa) S6 taglia il cerchio dell\'arco anche in un punto FUORI dall\'arco', !!outArc);
  await tool(page, 'Retta');
  const mkOut = outArc ? await hoverS(page, outArc) : 'x';
  check('Intersezione: dove la retta taglia il prolungamento del cerchio dell\'arco (fuori dall\'arco) non c\'e\' nessun candidato', mkOut === null, JSON.stringify(mkOut));
  // due rette che non si toccano ma si incontrerebbero prolungandole: nessun candidato (nessun prolungamento)
  const prolA = (() => {
    const d = sub(S.A.b, S.A.a);
    return { x: S.A.b.x + 0.1 * d.x, y: S.A.b.y + 0.1 * d.y };
  })();
  const mkP = await hoverS(page, prolA);
  check('Intersezione: sul prolungamento di una retta (oltre l\'estremo) non c\'e\' nessun candidato', mkP === null, JSON.stringify(mkP));
  await page.keyboard.press('Escape');

  // ---- Quadrante
  await only(page, ['quadrant']);
  for (const [qn, qp] of quads(S.K1)) await firstPointAt(page, info0, `Quadrante ${qn} del cerchio (come si vede il foglio)`, qp, 'quadrant');
  for (const [qn, qp] of quads(S.AR)) {
    await tool(page, 'Retta');
    const mk = await hoverS(page, qp);
    const inside = onArc(S.AR, qp);
    check(`Quadrante ${qn} del cerchio dell'arco: ${inside ? 'e\' nell\'arco, c\'e\' il candidato' : 'e\' fuori dall\'arco, nessun candidato'}`, inside ? await markOk(page, mk, 'quadrant', qp) : mk === null, JSON.stringify(mk && { kind: mk.kind }));
    await page.keyboard.press('Escape');
  }
  check('(premessa) l\'arco ha almeno un quadrante dentro e almeno uno fuori', quads(S.AR).some(([, p]) => onArc(S.AR, p)) && quads(S.AR).some(([, p]) => !onArc(S.AR, p)));

  // ---- Perpendicolare: l'ancora e' l'Estremo di un piolo (agganciato: esatto)
  await only(page, ['end', 'perpendicular']);
  const fS4 = footSeg(S.anchor.ST1, S.S4);
  check('(premessa) il piede dell\'ancora ST1 su S4 e\' dentro il tratto (0.15 < t < 0.85) e a piu\' di 40 pt', fS4.t > 0.15 && fS4.t < 0.85 && hyp(fS4.p, S.anchor.ST1) > 40, JSON.stringify(fS4));
  const o1 = await secondPointAt(page, 'Perpendicolare su una retta (S4)', S.anchor.ST1, fS4.p, 'perpendicular');
  check('Perpendicolare su una retta: il segmento ancora-piede e\' perpendicolare a S4 (prodotto scalare ~ 0 nel foglio)', o1 && Math.abs(dot(sub(sh(o1.points[1]), sh(o1.points[0])), sub(S.S4.b, S.S4.a))) < 1e-6 * hyp(S.S4.a, S.S4.b) * hyp(sh(o1.points[1]), sh(o1.points[0])), JSON.stringify(o1?.points));
  const feetK1 = feetCirc(S.anchor.ST2, S.K1);
  await secondPointAt(page, 'Perpendicolare su un cerchio (K1), piede vicino', S.anchor.ST2, feetK1[0], 'perpendicular');
  await secondPointAt(page, 'Perpendicolare su un cerchio (K1), piede lontano (lato opposto)', S.anchor.ST2, feetK1[1], 'perpendicular');
  const feetAR = feetCirc(S.anchor.ST3, S.AR);
  check('(premessa) dall\'ancora ST3 un piede sul cerchio dell\'arco e\' nell\'arco e l\'altro no', onArc(S.AR, feetAR[0]) !== onArc(S.AR, feetAR[1]));
  for (const [i, f] of feetAR.entries()) {
    if (onArc(S.AR, f)) await secondPointAt(page, `Perpendicolare su un arco (piede ${i === 0 ? 'vicino' : 'lontano'}, nell'arco)`, S.anchor.ST3, f, 'perpendicular');
    else {
      await tool(page, 'Retta');
      await click(page, await clientOfSheet(page, S.anchor.ST3), 2, 2);
      const mk = await hoverS(page, f);
      check(`Perpendicolare su un arco (piede ${i === 0 ? 'vicino' : 'lontano'}, FUORI dall'arco): nessun candidato`, mk === null, JSON.stringify(mk && { kind: mk.kind }));
      await page.keyboard.press('Escape');
    }
  }
  // senza punto di partenza (primo punto): nessun candidato di Perpendicolare, nemmeno sul piede di prima
  await tool(page, 'Retta');
  const mkNo = await hoverS(page, fS4.p);
  check('Perpendicolare senza punto di partenza (primo punto della Retta): nessun candidato', mkNo === null, JSON.stringify(mkNo));

  // ---- Tangente
  await only(page, ['end', 'tangent']);
  const tK5 = tangents(S.anchor.ST3, S.K5);
  for (const [i, t] of tK5.entries()) {
    const o = await secondPointAt(page, `Tangente a un cerchio (K5), punto ${i + 1}`, S.anchor.ST3, t, 'tangent');
    // il raggio nel punto di tangenza e' perpendicolare alla retta ancora-punto
    check(`Tangente a un cerchio (K5), punto ${i + 1}: il raggio e' perpendicolare alla tangente (prodotto scalare ~ 0 nel foglio)`, o && Math.abs(dot(sub(sh(o.points[1]), S.K5.c), sub(sh(o.points[1]), sh(o.points[0])))) < 1e-6 * S.K5.r * hyp(sh(o.points[1]), sh(o.points[0])), JSON.stringify(o?.points));
  }
  const tAR = tangents(S.anchor.ST3, { c: S.AR.c, r: S.AR.r });
  check('(premessa) dall\'ancora ST3 una tangente al cerchio dell\'arco tocca l\'arco e l\'altra no', onArc(S.AR, tAR[0]) !== onArc(S.AR, tAR[1]));
  for (const [i, t] of tAR.entries()) {
    if (onArc(S.AR, t)) await secondPointAt(page, `Tangente a un arco (punto ${i + 1}, nell'arco)`, S.anchor.ST3, t, 'tangent');
    else {
      await tool(page, 'Retta');
      await click(page, await clientOfSheet(page, S.anchor.ST3), 2, 2);
      const mk = await hoverS(page, t);
      check(`Tangente a un arco (punto ${i + 1}, FUORI dall'arco): nessun candidato`, mk === null, JSON.stringify(mk && { kind: mk.kind }));
      await page.keyboard.press('Escape');
    }
  }
  await tool(page, 'Retta');
  const mkNoT = await hoverS(page, tK5[0]);
  check('Tangente senza punto di partenza (primo punto della Retta): nessun candidato', mkNoT === null, JSON.stringify(mkNoT));

  // ---- Origine
  await only(page, ['end']);
  const org = userOf(info0, [0.9, 0.08]);
  await page.evaluate((p) => window.__gtpdf.setOrigin(1, p), org);
  await page.waitForTimeout(150);
  await firstPointAt(page, info0, 'Origine della pagina', sh(org), 'origin');
  await only(page, []);
  await tool(page, 'Retta');
  const mkOff = await hoverS(page, sh(org));
  check('Origine: con tutti i sette interruttori spenti non c\'e\' nessun candidato (nemmeno l\'origine)', mkOff === null, JSON.stringify(mkOff));
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await ctx.close();
}

// ---------------------------------------------------------------- 2) interruttori, barra di stato, messaggi, nulla di salvato
async function switchSuite(browser) {
  setSection('interruttori: pannello, barra di stato, messaggi, non salvati (A4 vettoriale, 1280x900)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const info0 = await pageInfo(page);
  const S = await readScene(page);
  const pan = await page.locator('.panel-toggle').evaluateAll((els) => els.map((e) => e.dataset.panelToggle));
  check('il pannello "Aggancio e griglia" ha, in ordine, Estremo, Punto medio, Centro, Intersezione, Quadrante, Perpendicolare, Tangente e Griglia', JSON.stringify(pan) === JSON.stringify([...SW, 'grid']), JSON.stringify(pan));
  const panLabels = await page.locator('.panel-toggle').allInnerTexts();
  check('... con i nomi "Estremo", "Punto medio", "Centro", "Intersezione", "Quadrante", "Perpendicolare", "Tangente", "Griglia"', JSON.stringify(panLabels) === JSON.stringify(['Estremo', 'Punto medio', 'Centro', 'Intersezione', 'Quadrante', 'Perpendicolare', 'Tangente', 'Griglia']), JSON.stringify(panLabels));
  const allOn = await Promise.all(SW.map((k) => isOn(panelBtn(page, k))));
  check('all\'avvio i sette interruttori dei tipi di snap sono accesi (tutti i nuovi compresi)', allOn.every(Boolean), JSON.stringify(allOn));
  const bar = await page.locator('.statusbar .st-toggle').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.toggle));
  check('barra di stato (>= 720 px): gli interruttori sono Estremo, Punto medio, Centro, Intersezione, ORTO, Griglia (dei nuovi SOLO Intersezione)', JSON.stringify(bar) === JSON.stringify(['end', 'mid', 'center', 'intersection', 'ortho', 'grid']), JSON.stringify(bar));
  check('barra di stato: Quadrante, Perpendicolare e Tangente non ci sono', (await page.locator('.statusbar .st-toggle[data-toggle="quadrant"], .statusbar .st-toggle[data-toggle="perpendicular"], .statusbar .st-toggle[data-toggle="tangent"]').count()) === 0);
  check('barra di stato: il testo dell\'interruttore e\' "Intersezione"', (await statusBtn(page, 'intersection').innerText()) === 'Intersezione');
  // ogni interruttore: spento, il candidato sparisce; acceso, torna. Le posizioni sono quelle della scena
  const pI = segSeg(S.A, S.B)[0];
  const pQ = quads(S.K1)[0][1];
  const fS4 = footSeg(S.anchor.ST1, S.S4).p;
  const tK5 = tangents(S.anchor.ST3, S.K5)[0];
  const cases = [
    { k: 'intersection', p: pI, start: null, others: SW.filter((k) => k !== 'intersection') },
    { k: 'quadrant', p: pQ, start: null, others: SW.filter((k) => k !== 'quadrant') },
    { k: 'perpendicular', p: fS4, start: S.anchor.ST1, others: SW.filter((k) => k !== 'perpendicular' && k !== 'end') },
    { k: 'tangent', p: tK5, start: S.anchor.ST3, others: SW.filter((k) => k !== 'tangent' && k !== 'end') },
  ];
  for (const cs of cases) {
    await only(page, [cs.k, ...(cs.start ? ['end'] : [])]); // solo il tipo provato (e l'Estremo, per fissare il punto di partenza)
    await tool(page, 'Retta');
    if (cs.start) await click(page, await clientOfSheet(page, cs.start), 2, 2);
    let mk = await hoverS(page, cs.p);
    check(`${LABEL[cs.k]} acceso: il candidato c'e'`, await markOk(page, mk, cs.k, cs.p), JSON.stringify(mk && mk.kind));
    const btn = panelBtn(page, cs.k);
    await btn.click();
    await page.mouse.move(0, 0);
    mk = await hoverS(page, cs.p);
    check(`${LABEL[cs.k]} spento (pannello): nessun candidato`, mk === null, JSON.stringify(mk && mk.kind));
    const off = ['perpendicular', 'intersection', 'tangent'].includes(cs.k) ? 'disattivata' : 'disattivato'; // Intersezione, Perpendicolare e Tangente sono femminili
    check(`${LABEL[cs.k]} spento: messaggio "${LABEL[cs.k]} ${off}"`, (await status(page)) === `${LABEL[cs.k]} ${off}`, await status(page));
    await btn.click();
    mk = await hoverS(page, cs.p);
    check(`${LABEL[cs.k]} riacceso: il candidato torna`, await markOk(page, mk, cs.k, cs.p), JSON.stringify(mk && mk.kind));
    check(`${LABEL[cs.k]} acceso: il messaggio spiega che cosa fa ("${LABEL[cs.k]} attiv...")`, new RegExp(`^${LABEL[cs.k]} attiv[ao]: .+`).test(await status(page)), await status(page));
    await page.keyboard.press('Escape');
  }
  // Intersezione: la barra di stato e il pannello sono lo STESSO interruttore
  await only(page, SW);
  await statusBtn(page, 'intersection').click();
  check('Intersezione: spenta dalla barra di stato, il pannello la mostra spenta', !(await isOn(statusBtn(page, 'intersection'))) && !(await isOn(panelBtn(page, 'intersection'))));
  await tool(page, 'Retta');
  const mkOffBar = await hoverS(page, pI);
  check('... e il candidato non c\'e\'', mkOffBar === null, JSON.stringify(mkOffBar && { kind: mkOffBar.kind }));
  await panelBtn(page, 'intersection').click();
  check('... riaccesa dal pannello, la barra di stato la mostra accesa', (await isOn(statusBtn(page, 'intersection'))) && (await isOn(panelBtn(page, 'intersection'))));
  await page.keyboard.press('Escape');

  // ---- i quattro tipi nuovi spenti: nessun candidato nuovo in nessuna posizione (come prima di CP6f); accesi, ci sono tutti
  const kindsSeen = async () => {
    const seen = new Set();
    const pts = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 14; j++) pts.push(userOf(info0, [0.03 + i * 0.085, 0.03 + j * 0.07]));
    const pushS = (p) => pts.push(us(p));
    [pI, pQ, fS4, tK5].forEach(pushS);
    for (const sg of [S.S4, S.S3, S.S6, S.A]) pushS(footSeg(S.anchor.ST3, sg).p); // i piedi dell'ancora usata qui (ST3) su alcune rette
    for (const p of [segSeg(S.S5, S.S6)[0], circCirc(S.K3, S.K4)[0], ...segCirc(S.S3, S.K1)]) pushS(p);
    await tool(page, 'Retta');
    await click(page, await clientOfSheet(page, S.anchor.ST3), 2, 2); // con un punto di partenza, perche' Perpendicolare e Tangente possano comparire
    for (const u of pts) {
      const c = await clientOfSheet(page, sh(u));
      await page.mouse.move(c.x + 2, c.y - 2);
      await page.waitForTimeout(25);
      const mk = await snapMark(page);
      if (mk) seen.add(mk.kind);
    }
    await page.keyboard.press('Escape');
    return [...seen].sort();
  };
  await only(page, ['end', 'mid', 'center']);
  const off4 = await kindsSeen();
  check('con Intersezione, Quadrante, Perpendicolare e Tangente SPENTI, in ~180 posizioni (anche con un punto di partenza) compaiono solo Estremo, Punto medio e Centro', off4.length > 0 && off4.every((k) => ['end', 'mid', 'center'].includes(k)), JSON.stringify(off4));
  await only(page, SW);
  const on7 = await kindsSeen();
  check('con tutti i tipi accesi compaiono (nelle stesse posizioni) tutti i tipi nuovi: Intersezione, Quadrante, Perpendicolare e Tangente', ['intersection', 'quadrant', 'perpendicular', 'tangent'].every((k) => on7.includes(k)), JSON.stringify(on7));

  // ---- gli interruttori NON si salvano: il progetto non li contiene e dopo un ricaricamento sono accesi
  await only(page, ['end']);
  const j = JSON.parse(await page.evaluate(async () => (await window.__gtpdf.projectText()).text));
  const txt = JSON.stringify(j);
  check('il progetto scritto e\' di versione 3 e non contiene nessun campo di snap (interruttori, "snap", "intersez", "quadrante", "perpendicolare", "tangente")', j.version === 3 && !/snap|intersec|intersez|quadrant|perpendic|tangen|toggle|interrutt/i.test(txt), txt.slice(0, 200));
  const keys = new Set([...Object.keys(j), ...Object.keys(j.pages[0])]);
  check('i campi del progetto sono quelli di prima (nessun campo nuovo): format, version, app, pdf, pages / page, objects, scale, origin (e simili)', ![...keys].some((k) => /snap|switch|toggle|aggancio/i.test(k)), JSON.stringify([...keys]));
  await page.reload();
  await page.addStyleTag({ content: '.float-zoom{display:none!important}' });
  const after = await Promise.all(SW.map((k) => isOn(panelBtn(page, k))));
  check('dopo aver ricaricato la pagina i sette interruttori sono di nuovo tutti accesi (non si salvano)', after.every(Boolean), JSON.stringify(after));
  await ctx.close();
}

// ---------------------------------------------------------------- 3) priorita' a parita' di distanza e priorita' generale
async function priorSuite(browser) {
  setSection('priorita\' a parita\' di distanza e priorita\' generale (A4 vettoriale, 1280x900)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale', false);
  const info0 = await pageInfo(page);
  const U = (f) => userOf(info0, f);
  // cerchio con una retta che passa dal quadrante di destra del foglio, e due rette che si toccano in un estremo
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [
    { k: 'circle', a: [0.62, 0.62], b: [0.74, 0.62] },
    { k: 'segment', pts: [[0.1, 0.2], [0.3, 0.3]] }, // E1: estremo comune in (0.3, 0.3)
    { k: 'segment', pts: [[0.3, 0.3], [0.45, 0.2]] }, // E2
  ]));
  const objs = await objectsOf(page);
  const K = { c: sh(objs[0].p1), r: hyp(sh(objs[0].p1), sh(objs[0].p2)) };
  const Q = { x: K.c.x + K.r, y: K.c.y }; // quadrante di destra (nel foglio)
  // una retta che passa per Q e taglia il cerchio in Q (non e' tangente: direzione 45 gradi nel foglio)
  const L = { a: { x: Q.x - 40, y: Q.y - 40 }, b: { x: Q.x + 90, y: Q.y + 90 } }; // Q NON e' il punto medio
  await page.evaluate(([a, b]) => window.__gtpdf.add(1, [{ kind: 'segment', points: [a, b], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } }]), [us(L.a), us(L.b)]);
  const E = userOf(info0, [0.3, 0.3]);
  await only(page, SW);
  await tool(page, 'Retta');
  let mk = await hoverS(page, sh(E));
  check('Estremo e Intersezione sullo stesso punto (due rette che si toccano in un estremo): vince l\'Estremo', mk?.kind === 'end', JSON.stringify(mk && mk.kind));
  mk = await hoverS(page, Q);
  check('Intersezione e Quadrante sullo stesso punto (retta che taglia il cerchio nel quadrante di destra): vince l\'Intersezione', mk?.kind === 'intersection' && mk.label === 'Intersezione', JSON.stringify(mk && mk.kind));
  await only(page, ['quadrant']);
  mk = await hoverS(page, Q);
  check('... con la sola Intersezione spenta (resta il Quadrante) compare il Quadrante, nello stesso punto', (await markOk(page, mk, 'quadrant', Q)), JSON.stringify(mk && mk.kind));
  await only(page, SW);
  // Origine sul punto di un'intersezione: vince l'Origine (ordine: Estremo, Punto medio, Centro, Origine, Intersezione, ...)
  const cross = Q; // lo stesso punto: l'origine e' li'
  await page.evaluate((p) => window.__gtpdf.setOrigin(1, p), us(cross));
  await page.waitForTimeout(120);
  mk = await hoverS(page, cross);
  check('Origine e Intersezione sullo stesso punto: vince l\'Origine', mk?.kind === 'origin' && mk.label === 'Origine', JSON.stringify(mk && mk.kind));
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await page.waitForTimeout(100);
  // Centro e Intersezione: una retta che passa dal centro del cerchio
  const Lc = { a: { x: K.c.x - 90, y: K.c.y - 20 }, b: { x: K.c.x + 40, y: K.c.y + 10 } }; // il centro del cerchio NON e' il punto medio
  await page.evaluate(([a, b]) => window.__gtpdf.add(1, [{ kind: 'segment', points: [a, b], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } }]), [us(Lc.a), us(Lc.b)]);
  mk = await hoverS(page, K.c);
  check('Centro del cerchio con una retta che passa dal centro (nessuna intersezione li\'): il Centro', mk?.kind === 'center', JSON.stringify(mk && mk.kind));

  // ---- priorita' generale: squadratura > snap > ORTO > griglia
  const S1 = segSeg({ a: sh(E), b: sh(E) }, { a: sh(E), b: sh(E) }); // (non serve: solo per chiarezza)
  void S1;
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  // ORTO acceso, primo punto libero, secondo vicino a un'intersezione non allineata: il punto e' l'intersezione (lo snap batte l'ORTO)
  const inter = segSeg({ a: sh(objs[1].points[0]), b: sh(objs[1].points[1]) }, { a: sh(objs[2].points[0]), b: sh(objs[2].points[1]) });
  void inter;
  await only(page, ['intersection']);
  await tool(page, 'Retta');
  const P0 = { x: Q.x - 120, y: Q.y - 150 };
  await click(page, await clientOfSheet(page, P0));
  await statusBtn(page, 'ortho').click();
  const cQ = await clientOfSheet(page, Q);
  await page.mouse.move(cQ.x + 3, cQ.y - 2);
  await page.waitForTimeout(80);
  mk = await snapMark(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  let o = await lastObj(page);
  check('ORTO acceso: con un\'Intersezione vicina il secondo punto e\' l\'intersezione (lo snap batte l\'ORTO), non il punto in orizzontale/verticale', mk?.kind === 'intersection' && nearP(o.points[1], us(Q)), JSON.stringify([mk && mk.kind, o?.points]));
  await undo(page);
  // griglia accesa: l'Intersezione batte i nodi della griglia
  await statusBtn(page, 'ortho').click();
  await statusBtn(page, 'grid').click();
  await tool(page, 'Retta');
  await click(page, await clientOfSheet(page, P0));
  await page.mouse.move(cQ.x + 3, cQ.y - 2);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  o = await lastObj(page);
  check('Griglia accesa: con un\'Intersezione vicina il punto e\' l\'intersezione, non il nodo della griglia', nearP(o.points[1], us(Q)), JSON.stringify(o?.points));
  await undo(page);
  // senza candidato vicino la griglia (o l'ORTO) torna a valere: lo snap non cambia il resto
  await tool(page, 'Retta');
  await click(page, await clientOfSheet(page, P0));
  const far = userOf(info0, [0.85, 0.1]);
  const cf = await clientOfSheet(page, sh(far));
  await page.mouse.move(cf.x, cf.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  o = await lastObj(page);
  const step = (10 * 72) / 25.4; // 10 mm del foglio, in pt (passo predefinito)
  const gx = (o.points[1].x - info0.view[0]) / step;
  const gy = (o.points[1].y - info0.view[1]) / step;
  info(`griglia: secondo punto senza candidato vicino a (${gx.toFixed(6)}, ${gy.toFixed(6)}) passi dall'angolo in basso a sinistra dell'area visibile`);
  check('Griglia accesa, nessun candidato vicino: il secondo punto sta su un nodo della griglia (multiplo di 10 mm dall\'angolo dell\'area visibile), non sul punto grezzo', Math.abs(gx - Math.round(gx)) < 1e-6 && Math.abs(gy - Math.round(gy)) < 1e-6, JSON.stringify(o.points[1]));
  await undo(page);
  await ctx.close();
}

// ---------------------------------------------------------------- 4) il punto di partenza: dove Perpendicolare e Tangente valgono e dove no
async function startSuite(browser) {
  setSection('punto di partenza di Perpendicolare e Tangente: strumenti (A4 vettoriale, 1280x900)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const S = await readScene(page);
  const f = footSeg(S.anchor.ST1, S.S4).p;
  const A1 = S.anchor.ST1;
  await only(page, ['end', 'perpendicular']);
  const probe = async (name, expect, arm) => {
    await arm();
    await click(page, await clientOfSheet(page, A1), 2, 2); // primo punto: l'Estremo del piolo
    const mk = await hoverS(page, f);
    check(`${name}: dopo il primo punto, sul piede della perpendicolare ${expect ? 'c\'e\' il candidato "Perpendicolare"' : 'NON c\'e\' nessun candidato'}`, expect ? await markOk(page, mk, 'perpendicular', f) : mk === null, JSON.stringify(mk && mk.kind));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
  };
  await probe('Retta (secondo punto)', true, () => tool(page, 'Retta'));
  await probe('Linea (secondo punto)', true, () => tool(page, 'Linea'));
  await probe('Distanza (secondo punto)', true, () => tool(page, 'Distanza'));
  await probe('Scala (secondo punto)', true, () => tool(page, 'Scala'));
  await probe('Sposta (secondo punto, con un oggetto selezionato)', true, async () => {
    await tool(page, 'Seleziona');
    await page.evaluate(() => window.__gtpdf.selectIds([window.__gtpdf.state().pages[0].objects[0].id]));
    await page.waitForTimeout(100);
    await page.locator('.ctx-tr', { hasText: 'Sposta' }).click();
    await page.waitForTimeout(100);
  });
  await probe('Specchio (secondo punto dell\'asse, con un oggetto selezionato)', true, async () => {
    await tool(page, 'Seleziona');
    await page.evaluate(() => window.__gtpdf.selectIds([window.__gtpdf.state().pages[0].objects[0].id]));
    await page.waitForTimeout(100);
    await page.locator('.ctx-tr', { hasText: 'Specchio' }).click();
    await page.waitForTimeout(100);
  });
  await tool(page, 'Seleziona');
  await page.keyboard.press('Escape');
  // strumenti senza punto di partenza: Cerchio (secondo punto), Arco, Copertura, Testo, Quota orizzontale
  const pr2 = async (name, arm, first) => {
    await arm();
    if (first) await click(page, await clientOfSheet(page, A1), 2, 2);
    const mk = await hoverS(page, f);
    check(`${name}: sul piede della perpendicolare NON c'e' nessun candidato (lo strumento non ha un punto di partenza)`, mk === null, JSON.stringify(mk && mk.kind));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
  };
  await pr2('Cerchio (secondo punto)', async () => {
    await tool(page, 'Cerchio e arco');
    await page.locator('.ctx-curves button', { hasText: 'Cerchio' }).click();
  }, true);
  await pr2('Arco (secondo punto)', async () => {
    await tool(page, 'Cerchio e arco');
    await page.locator('.ctx-curves button', { hasText: 'Arco' }).click();
  }, true);
  await pr2('Copertura (secondo punto)', () => tool(page, 'Copertura'), true);
  await pr2('Testo', () => tool(page, 'Testo'), false);
  // tipi di tratto che non hanno punto di partenza ma hanno gli altri candidati: l'Estremo vale sempre
  await tool(page, 'Cerchio e arco');
  await page.locator('.ctx-curves button', { hasText: 'Cerchio' }).click();
  const mkE = await hoverS(page, A1, 2, 2);
  check('Cerchio: l\'Estremo (che non dipende dal punto di partenza) vale lo stesso', mkE?.kind === 'end', JSON.stringify(mkE && mkE.kind));
  await page.keyboard.press('Escape');
  // Seleziona e Cancella non agganciano mai: nessun marcatore, nemmeno vicino a un'intersezione
  await only(page, SW);
  const pI = segSeg(S.A, S.B)[0];
  await tool(page, 'Seleziona');
  check('Seleziona: vicino a un\'intersezione non compare nessun marcatore di snap (lo strumento non aggancia)', (await hoverS(page, pI)) === null);
  await tool(page, 'Cancella');
  check('Cancella: vicino a un\'intersezione non compare nessun marcatore di snap (lo strumento non aggancia)', (await hoverS(page, pI)) === null);
  await tool(page, 'Seleziona');
  await ctx.close();
}

// ---------------------------------------------------------------- 5) marcatori: forma, dimensione, colore, etichetta
async function markerSuite(browser) {
  setSection('marcatori e etichette (A4 vettoriale, 1280x900)');
  const { ctx, page } = await desktop(browser);
  await openDoc(page, 'A4 vettoriale');
  const info0 = await pageInfo(page);
  const S = await readScene(page);
  const tok = await page.evaluate(() => ({ v: getComputedStyle(document.documentElement).getPropertyValue('--cad-snap-vector').trim(), t: getComputedStyle(document.documentElement).getPropertyValue('--cad-snap-topology').trim() }));
  const org = userOf(info0, [0.9, 0.08]);
  await page.evaluate((p) => window.__gtpdf.setOrigin(1, p), org);
  const items = [
    ['intersection', 'Intersezione', segSeg(S.A, S.B)[0], null, tok.v],
    ['quadrant', 'Quadrante', quads(S.K1)[0][1], null, tok.t],
    ['perpendicular', 'Perpendicolare', footSeg(S.anchor.ST1, S.S4).p, S.anchor.ST1, tok.v],
    ['tangent', 'Tangente', tangents(S.anchor.ST3, S.K5)[0], S.anchor.ST3, tok.v],
    ['origin', 'Origine', sh(org), null, tok.t],
    ['end', 'Estremo', S.anchor.ST1, null, tok.t],
  ];
  info(`token: snap-vector ${tok.v}, snap-topology ${tok.t}`);
  for (const [kind, label, p, start, color] of items) {
    await only(page, [kind === 'origin' ? 'end' : kind, ...(start ? ['end'] : [])]);
    await tool(page, 'Retta');
    if (start) await click(page, await clientOfSheet(page, start), 2, 2);
    const mk = await hoverS(page, p);
    const ok = !!mk && mk.kind === kind;
    check(`${label}: marcatore con l'etichetta "${label}" e la forma attesa`, ok && mk.label === label && mk.sig === SIG[kind], JSON.stringify(mk && { kind: mk.kind, label: mk.label, sig: mk.sig }));
    check(`${label}: sta in un riquadro di 8 x 8 px (larghezza o altezza massima 8, nessuna oltre) e il tratto e' di 1.5 px`, ok && mk.w <= 8.01 && mk.h <= 8.01 && Math.max(mk.w, mk.h) >= 7.99 && mk.strokeWidth === '1.5px', JSON.stringify(mk && { w: mk.w, h: mk.h, sw: mk.strokeWidth }));
    check(`${label}: colore ${color} (${kind === 'intersection' || kind === 'perpendicular' || kind === 'tangent' ? 'snap-vector' : 'snap-topology'})`, ok && mk.stroke === hexRgb(color), JSON.stringify(mk && mk.stroke));
    info(`${label}: riquadro ${mk ? `${mk.w.toFixed(1)} x ${mk.h.toFixed(1)} px` : '-'}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await ctx.close();
}

// ---------------------------------------------------------------- 6) etichetta vicino al bordo destro del visore
async function edgeSuite(browser) {
  setSection('etichetta vicino al bordo destro del visore (A4 vettoriale, 800x1100)');
  const { ctx, page } = await desktop(browser, 800, 1100);
  await openDoc(page, 'A4 vettoriale', false);
  const info0 = await pageInfo(page);
  await page.evaluate(() => window.__gtpdf.addSpecs(1, [
    { k: 'segment', pts: [[0.5, 0.3], [0.99, 0.32]] }, // sul bordo destro della pagina
    { k: 'segment', pts: [[0.95, 0.2], [0.95, 0.22]] }, // l'ancora (estremo in (0.95, 0.20))
    { k: 'segment', pts: [[0.8, 0.6], [0.99, 0.64]] }, // incrocio a x = 0.945 (vicino al bordo destro della pagina)
    { k: 'segment', pts: [[0.99, 0.58], [0.9, 0.68]] },
  ]));
  const objs = (await objectsOf(page)).slice(-4);
  const seg = (o) => ({ a: sh(o.points[0]), b: sh(o.points[1]) });
  const S7 = seg(objs[0]);
  const anchor = seg(objs[1]).a;
  const foot = footSeg(anchor, S7).p;
  const panel = (list) => only(page, list); // a 800 px il pannello e' a scomparsa: only() lo apre e lo richiude
  await panel(['end', 'perpendicular']);
  await tool(page, 'Retta');
  await click(page, await clientOfSheet(page, anchor), 2, 2);
  let mk = await hoverS(page, foot, 0, 3);
  const dr = mk ? mk.box.r - mk.x : null;
  check('(premessa) il marcatore Perpendicolare sta a meno di 100 px dal bordo destro del visore (la sua etichetta non ci starebbe a destra)', !!mk && mk.kind === 'perpendicular' && dr < 100, JSON.stringify(mk && { dr }));
  check('l\'etichetta "Perpendicolare" passa a SINISTRA del marcatore (text-anchor end) e sta tutta nel visore', !!mk && mk.anchor === 'end' && mk.labelRect.l >= mk.box.l && mk.labelRect.r <= mk.box.r, JSON.stringify(mk && { anchor: mk.anchor, l: mk.labelRect.l, r: mk.labelRect.r, boxR: mk.box.r }));
  await page.keyboard.press('Escape');
  await panel(['intersection']);
  await tool(page, 'Retta');
  const P = segSeg(seg(objs[2]), seg(objs[3]))[0];
  mk = P ? await hoverS(page, P, 0, 3) : null;
  const dr2 = mk ? mk.box.r - mk.x : null;
  check('(premessa) il marcatore Intersezione sta a meno di 100 px dal bordo destro del visore', !!mk && mk.kind === 'intersection' && dr2 < 100, JSON.stringify(mk && { dr2 }));
  check('Intersezione vicino al bordo destro: l\'etichetta "Intersezione" passa a sinistra e sta tutta nel visore', !!mk && mk.anchor === 'end' && mk.labelRect.l >= mk.box.l && mk.labelRect.r <= mk.box.r, JSON.stringify(mk && { dr2, anchor: mk.anchor, l: mk.labelRect.l, r: mk.labelRect.r, boxR: mk.box.r }));
  await page.keyboard.press('Escape');
  // lontano dal bordo l'etichetta sta a destra
  await page.evaluate(() => window.__gtpdf.fit());
  await ctx.close();
  void info0;
}

// ---------------------------------------------------------------- 7) progetto ed esportazione
async function projectExportSuite(browser) {
  setSection('progetto e esportazione con lo snap (A4 vettoriale, 1280x900)');
  const sha = (b64) => lib.shaBuf(Buffer.from(b64, 'base64'));
  const hashes = async (page) => {
    const h = {};
    for (const [name, opts] of [['simple', { mode: 'simple' }], ['flat', { mode: 'flat', dpi: 150, format: 'png' }]]) {
      await page.evaluate((o) => window.__gtpdf.runExport({ ...o, keep: true }), opts);
      h[name] = await sha(await page.evaluate(() => window.__gtpdf.lastExportBase64()));
    }
    return h;
  };
  // percorso 1: oggetti creati con l'interfaccia, i cui punti vengono dallo snap (Intersezione, Quadrante, Perpendicolare, Tangente, Origine)
  const A = await desktop(browser);
  await openDoc(A.page, 'A4 vettoriale');
  const info0 = await pageInfo(A.page);
  const S = await readScene(A.page);
  const n0 = (await objectsOf(A.page)).length;
  await A.page.evaluate((p) => window.__gtpdf.setOrigin(1, p), userOf(info0, [0.9, 0.08]));
  await only(A.page, SW);
  const draw = async (tp, c1, c2) => {
    await tool(A.page, tp);
    await click(A.page, c1, 2, -2);
    await click(A.page, c2, 2, -2);
  };
  await draw('Retta', await clientOfSheet(A.page, segSeg(S.A, S.B)[0]), await clientOfSheet(A.page, quads(S.K1)[2][1]));
  await draw('Retta', await clientOfSheet(A.page, S.anchor.ST1), await clientOfSheet(A.page, footSeg(S.anchor.ST1, S.S4).p));
  await draw('Retta', await clientOfSheet(A.page, S.anchor.ST3), await clientOfSheet(A.page, tangents(S.anchor.ST3, S.K5)[1]));
  await draw('Retta', await clientOfSheet(A.page, sh(userOf(info0, [0.9, 0.08]))), await clientOfSheet(A.page, circCirc(S.K3, S.K4)[0]));
  const made = (await objectsOf(A.page)).slice(n0);
  check('(premessa) le 4 rette fatte con lo snap sono 4 oggetti nuovi', made.length === 4 && made.every((o) => o.kind === 'segment'), JSON.stringify(made.length));
  // il progetto contiene solo oggetti (kind, id, punti, tratto): nessun campo di snap
  const j = JSON.parse(await A.page.evaluate(async () => (await window.__gtpdf.projectText()).text));
  check('il progetto con oggetti fatti con lo snap e\' di versione 3 e ogni oggetto nuovo ha solo le chiavi di prima (id, kind, points, stroke)', j.version === 3 && j.pages[0].objects.slice(n0).every((o) => JSON.stringify(Object.keys(o)) === JSON.stringify(['id', 'kind', 'points', 'stroke'])), JSON.stringify(j.pages[0].objects.slice(n0).map((o) => Object.keys(o))));
  const mkVisible = await hoverS(A.page, segSeg(S.A, S.B)[0]);
  check('(premessa) col mouse sopra l\'intersezione il marcatore e\' visibile durante l\'esportazione', !!mkVisible);
  const hMarker = await hashes(A.page);
  await A.page.mouse.move(5, 5);
  await A.page.waitForTimeout(100);
  const hNoMarker = await hashes(A.page);
  check('esportazione "Copertura semplice": identica (stessi byte) con il marcatore di snap visibile e senza', hMarker.simple === hNoMarker.simple, `${hMarker.simple} / ${hNoMarker.simple}`);
  check('esportazione "Appiattito" (150 dpi, PNG): identica con il marcatore visibile e senza', hMarker.flat === hNoMarker.flat, `${hMarker.flat} / ${hNoMarker.flat}`);
  // percorso 2: gli stessi oggetti creati direttamente (senza snap, senza interfaccia): stessi byte
  const B = await desktop(browser);
  await openDoc(B.page, 'A4 vettoriale');
  await B.page.evaluate((p) => window.__gtpdf.setOrigin(1, p), userOf(info0, [0.9, 0.08]));
  await B.page.evaluate((list) => window.__gtpdf.add(1, list), made.map((o) => { const c = JSON.parse(JSON.stringify(o)); delete c.id; return c; }));
  await B.page.waitForTimeout(200);
  const hB = await hashes(B.page);
  check('esportazione "Copertura semplice": oggetti fatti con lo snap = gli stessi oggetti creati direttamente sui punti finali (stessi byte)', hB.simple === hNoMarker.simple, `${hB.simple} / ${hNoMarker.simple}`);
  check('esportazione "Appiattito": oggetti fatti con lo snap = gli stessi creati direttamente', hB.flat === hNoMarker.flat, `${hB.flat} / ${hNoMarker.flat}`);
  // premessa: l'esportazione cambia davvero con gli oggetti (non e' un confronto vuoto)
  const C = await desktop(browser);
  await openDoc(C.page, 'A4 vettoriale');
  const hC = await hashes(C.page);
  check('(premessa) senza le rette fatte con lo snap il PDF esportato e\' DIVERSO', hC.simple !== hNoMarker.simple && hC.flat !== hNoMarker.flat);
  // Annulla e Ripeti: un oggetto per passo
  const cnt = (await objectsOf(A.page)).length;
  await undo(A.page);
  const c1 = (await objectsOf(A.page)).length;
  await redo(A.page);
  const c2 = (await objectsOf(A.page)).length;
  check('Annulla toglie la retta fatta con lo snap (un passo) e Ripeti la rimette identica', c1 === cnt - 1 && c2 === cnt && JSON.stringify((await objectsOf(A.page)).slice(-1)[0].points) === JSON.stringify(made[3].points), `${cnt} ${c1} ${c2}`);
  await A.ctx.close();
  await B.ctx.close();
  await C.ctx.close();
}

// ---------------------------------------------------------------- 8) barra di stato sotto 720 px
async function narrowSuite(browser) {
  setSection('barra di stato sotto 720 px: invariata (portatile in verticale e telefono 390x780)');
  const { ctx, page } = await desktop(browser, 700, 800);
  await openDoc(page, 'A4 vettoriale', false);
  const vis = (p) => p.locator('.statusbar .st-toggle').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.toggle));
  check('desktop a 700 px: nella barra di stato resta SOLO ORTO (come prima di CP6f); Intersezione e gli altri tipi stanno nel pannello', JSON.stringify(await vis(page)) === JSON.stringify(['ortho']) && (await page.locator('.panel-toggle').count()) === 8, JSON.stringify(await vis(page)));
  await ctx.close();
  const p = await phone(browser, 390, 780);
  await openDoc(p.page, 'A4 vettoriale', false);
  check('telefono 390x780: nella barra di stato resta SOLO ORTO; i sette tipi e la Griglia stanno nel pannello', JSON.stringify(await vis(p.page)) === JSON.stringify(['ortho']) && (await p.page.locator('.panel-toggle').count()) === 8, JSON.stringify(await vis(p.page)));
  await p.ctx.close();
  const w = await phone(browser, 932, 430);
  await openDoc(w.page, 'A4 vettoriale', false);
  check('telefono 932x430 (>= 720 px): nella barra di stato ci sono Estremo, Punto medio, Centro, Intersezione, ORTO e Griglia', JSON.stringify(await vis(w.page)) === JSON.stringify(['end', 'mid', 'center', 'intersection', 'ortho', 'grid']), JSON.stringify(await vis(w.page)));
  await w.ctx.close();
}

// ---------------------------------------------------------------- 9) tocco emulato (390 x 780) sulle tre pagine
async function touchSuite(browser, title, first) {
  setSection(`tocco emulato 390x780, ${title}`);
  const { ctx, page, cdp } = await phone(browser);
  await openDoc(page, title);
  const info0 = await pageInfo(page);
  const S = await readScene(page);
  const k = await zoomPx(page);
  info(`${title}: zoom ${k.toFixed(3)} px/pt, raggio del dito 22 px = ${(22 / k).toFixed(1)} pt`);
  const tap = async (c) => {
    await touch(cdp, 'touchStart', [[c.x, c.y]]);
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(80);
  };
  const canvasScale = () => page.evaluate(() => document.querySelector('.viewer-stage canvas').width / window.__gtpdf.sheet().w); // px del canvas per pt (cambia se aprire e chiudere il pannello fa riadattare il foglio)
  const lensCenter = async () => {
    const c = (await page.evaluate(() => window.__lensCalls.slice())).at(-1);
    return c ? { x: c[0] + c[2] / 2, y: c[1] + c[3] / 2 } : null;
  };
  // Intersezione: il dito a 8 px dal punto; la lente mostra il punto agganciato
  await only(page, ['intersection']);
  await tool(page, 'Retta');
  const pI = segSeg(S.A, S.B)[0];
  const cI = await clientOfSheet(page, pI);
  if (first) {
    await touch(cdp, 'touchStart', [[cI.x + 8, cI.y - 6]]);
    await page.waitForTimeout(100);
    const mk = await snapMark(page);
    const lc = await lensCenter();
    const cs = await canvasScale();
    check('tocco: a ~10 px dall\'intersezione compare il marcatore "Intersezione"', await markOk(page, mk, 'intersection', pI), JSON.stringify(mk && { kind: mk.kind, label: mk.label }));
    check('tocco: la lente e\' visibile e il suo centro e\' il punto agganciato (l\'intersezione), non il punto sotto il dito', (await page.locator('.lens:not([hidden])').count()) === 1 && !!lc && near(lc.x, pI.x * cs, 0.75) && near(lc.y, pI.y * cs, 0.75), JSON.stringify({ lc, atteso: { x: pI.x * cs, y: pI.y * cs } }));
    await touch(cdp, 'touchCancel', []);
    await page.waitForTimeout(60);
  }
  await tap({ x: cI.x + 8, y: cI.y - 6 });
  await tap(await clientOfSheet(page, sh(userOf(info0, FREE))));
  let o = await lastObj(page);
  check('tocco, Intersezione: il primo punto della Retta e\' l\'intersezione (entro 1e-6 pt)', o?.kind === 'segment' && nearP(o.points[0], us(pI)), JSON.stringify([o?.points?.[0], us(pI)]));
  await undo(page);
  // Quadrante
  await only(page, ['quadrant']);
  await tool(page, 'Retta');
  const q = quads(S.K1)[1][1];
  const cq = await clientOfSheet(page, q);
  await tap({ x: cq.x + 7, y: cq.y - 5 });
  await tap(await clientOfSheet(page, sh(userOf(info0, FREE))));
  o = await lastObj(page);
  check('tocco, Quadrante: il primo punto della Retta e\' il quadrante in basso del cerchio (entro 1e-6 pt)', o?.kind === 'segment' && nearP(o.points[0], us(q)), JSON.stringify([o?.points?.[0], us(q)]));
  await undo(page);
  // Perpendicolare: primo tocco sull'Estremo dell'ancora, secondo vicino al piede
  await only(page, ['end', 'perpendicular']);
  await tool(page, 'Retta');
  const foot = footSeg(S.anchor.ST1, S.S4).p;
  await tap(await clientOfSheet(page, S.anchor.ST1));
  const cf = await clientOfSheet(page, foot);
  await tap({ x: cf.x + 6, y: cf.y - 6 });
  o = await lastObj(page);
  check('tocco, Perpendicolare: due tocchi (Estremo e vicino al piede) danno il secondo punto = piede della perpendicolare (entro 1e-6 pt)', o?.kind === 'segment' && nearP(o.points[0], us(S.anchor.ST1)) && nearP(o.points[1], us(foot)), JSON.stringify([o?.points, us(foot)]));
  await undo(page);
  // Tangente
  await only(page, ['end', 'tangent']);
  await tool(page, 'Retta');
  const tg = tangents(S.anchor.ST3, S.K5)[0];
  await tap(await clientOfSheet(page, S.anchor.ST3));
  const ct = await clientOfSheet(page, tg);
  await tap({ x: ct.x + 6, y: ct.y - 6 });
  o = await lastObj(page);
  check('tocco, Tangente: il secondo punto e\' il punto di tangenza (entro 1e-6 pt)', o?.kind === 'segment' && nearP(o.points[1], us(tg)), JSON.stringify([o?.points?.[1], us(tg)]));
  await undo(page);
  // Origine
  const org = userOf(info0, [0.9, 0.08]);
  await page.evaluate((p) => window.__gtpdf.setOrigin(1, p), org);
  await only(page, ['end']);
  await tool(page, 'Retta');
  const co = await clientOfSheet(page, sh(org));
  await tap({ x: co.x + 6, y: co.y - 6 });
  await tap(await clientOfSheet(page, sh(userOf(info0, FREE))));
  o = await lastObj(page);
  check('tocco, Origine: il primo punto della Retta e\' l\'origine (entro 1e-6 pt)', o?.kind === 'segment' && nearP(o.points[0], org), JSON.stringify([o?.points?.[0], org]));
  await page.evaluate(() => window.__gtpdf.setOrigin(1, null));
  await ctx.close();
}

// ---------------------------------------------------------------- avvio
async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  const only_ = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null;
  const run = (id) => !only_ || only_.includes(id);
  // Ogni serie e' protetta: se una si interrompe (per esempio su un build di c4380b0, dove un controllo che serve non c'e') lo dice con un controllo fallito e le altre proseguono.
  const guarded = async (id, name, fn) => {
    if (!run(id)) return;
    try {
      await fn();
    } catch (e) {
      setSection(name);
      check(`la serie "${name}" si e' interrotta: ${String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160)}`, false, process.env.E2E_DEBUG ? String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join(' | ') : '');
    }
  };
  try {
    for (const [t] of SAMPLES) await guarded('esatti', `punti esatti, ${t}`, () => exactSuite(browser, t));
    await guarded('interruttori', 'interruttori', () => switchSuite(browser));
    await guarded('priorita', 'priorita\'', () => priorSuite(browser));
    await guarded('partenza', 'punto di partenza', () => startSuite(browser));
    await guarded('marcatori', 'marcatori', () => markerSuite(browser));
    await guarded('bordo', 'etichetta al bordo', () => edgeSuite(browser));
    await guarded('progetto', 'progetto ed esportazione', () => projectExportSuite(browser));
    await guarded('stretto', 'barra di stato sotto 720 px', () => narrowSuite(browser));
    for (const [i, [t]] of SAMPLES.entries()) await guarded('tocco', `tocco, ${t}`, () => touchSuite(browser, t, i === 0));
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void readFileSync;
void PDF_DIR;
