// Prove di CP5e su Chromium: righe nuove della diagnostica (griglia, altezza e righe visive di intestazione, stato e barra contestuale), altezza di intestazione e
// barra di stato che NON dipende dalla larghezza (>= 720 px), che cosa entra in una riga, pannello "Nessun documento" dentro il visore, pannello App che scorre fino in fondo.
// NON e' una dipendenza del progetto: richiede Playwright con Chromium (require('playwright')).
// Uso: node scripts/e2e-cp5e.cjs [cartella-immagini]   (costruisce da solo il build di prova con GTPDF_TEST=1 fuori dal repository;
//   con E2E_DIST=<cartella di un build di prova gia' fatto> prova quel build: cosi' si vede che i controlli FALLISCONO su 0fd1884, prima della correzione)
// Chromium NON e' Safari: nulla di quanto segue prova il comportamento su iPhone. I margini di sicurezza dell'iPhone sono emulati con
// Emulation.setSafeAreaInsetsOverride (valori consueti dell'iPhone 14 Pro Max, NON letti dal telefono dell'utente).
const { chromium } = require('playwright');
const { createE2E } = require('./e2e-lib.cjs');

const lib = createE2E({ name: 'e2e-cp5e', out: process.argv[2], port: 4197, hport: 4198, zoom: 2 });
const { check, info, setSection, URL: APP_URL } = lib;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const UI_PX = [14, 16, 18, 20, 22];

/** Telefono emulato: tocco, DPR 3, margini di sicurezza in orizzontale (0/59/21/59) o in verticale (59/0/34/0), A+ a scelta (indice di UI_SIZES). */
async function phone(browser, w, h, uiIdx = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000); // un elemento fuori dal visore (prima della correzione) non deve bloccare la prova per 30 s
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: w > h ? { top: 0, left: 59, bottom: 21, right: 59 } : { top: 59, left: 0, bottom: 34, right: 0 } });
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  return { ctx, page, cdp };
}
/** Desktop con il mouse: nessun margine di sicurezza, `pointer: fine`. */
async function desktop(browser, w, h, uiIdx = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.addInitScript((i) => localStorage.setItem('gtpdf.uiSize', String(i)), uiIdx);
  await page.goto(APP_URL);
  return { ctx, page };
}
async function openSample(page, title = 'A4 vettoriale') {
  await page.locator('summary', { hasText: 'PDF di prova' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.waitForSelector('.viewer-stage canvas');
  await page.waitForFunction(() => window.__gtpdf && window.__gtpdf.pages().length > 0);
  await page.waitForTimeout(400);
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });

/** Altezza di `selector` come se fosse largo `w` px (position: fixed; width: w), come nelle misure dell'utente. w = null: larghezza vera. */
const heightAt = (page, selector, w) =>
  page.evaluate(
    ([s, width]) => {
      const el = document.querySelector(s);
      const old = el.getAttribute('style');
      if (width !== null) el.style.cssText += `;position:fixed;left:0;top:0;width:${width}px`;
      const h = el.getBoundingClientRect().height;
      if (old === null) el.removeAttribute('style');
      else el.setAttribute('style', old);
      return h;
    },
    [selector, w],
  );

// =====================================================================
// 1) Righe nuove della diagnostica
async function readoutSuite(browser) {
  setSection('diagnostica: griglia e barre');
  const { ctx, page } = await phone(browser, 932, 320, 1);
  const det = page.locator('.touch-diag');
  await det.locator('summary').click();
  await page.waitForTimeout(700);
  let t = await det.locator('pre').innerText();
  check('riga della griglia: righe e colonne in px come le restituisce getComputedStyle (una misura per traccia; 3 colonne 48 / resto / 280 a 932 px)', /griglia \.app 932x320 · righe (\d+(\.\d+)?px ){4}\d+(\.\d+)?px · colonne 48px 486px 280px/.test(t), t.split('\n').find((l) => l.startsWith('griglia')));
  const rows = (t.match(/righe ((?:\d+(?:\.\d+)?px ?){5}) ·/) || [])[1];
  check('le 5 righe della griglia sono intestazione, foglio, tastierino, contestuale, stato: 49px 205px 0px 0px 66px (senza strumento)', rows && rows.trim() === '49px 205px 0px 0px 66px', rows);
  check('intestazione: altezza 49, padding su/giu 2/2, UNA riga visiva (nonostante logo da 36 px e pulsanti da 44 px centrati: non sono due righe)', /intestazione \.bar: alta 49 · padding su\/giu 2\/2 · righe visive 1 \[2\] · larga 814, contenuto 814/.test(t), t.split('\n').find((l) => l.startsWith('intestazione')));
  check('stato: altezza 66, padding su/giu 0/21 (margine di sicurezza in basso), una riga visiva', /stato \.statusbar: alta 66 · padding su\/giu 0\/21 · righe visive 1 \[1\]/.test(t), t.split('\n').find((l) => l.startsWith('stato')));
  check('barra contestuale senza strumento: "nascosta"', /contestuale \.ctxbar: nascosta/.test(t));
  await openSample(page);
  await page.evaluate(() => document.querySelector('button.tool[title="Quota"]')?.click());
  await page.waitForTimeout(800);
  t = await det.locator('pre').innerText();
  const ctxLine = t.split('\n').find((l) => l.startsWith('contestuale'));
  check('con Quota la barra contestuale ha altezza, padding e piu\' di una riga visiva (va a capo per progetto)', /contestuale \.ctxbar: alta 1\d\d(\.\d)? · padding su\/giu 4\/21 · righe visive [2-9] /.test(t), ctxLine);
  const g = t.split('\n').find((l) => l.startsWith('griglia'));
  check('con Quota la riga contestuale della griglia non e\' piu\' 0px e la riga del foglio si e\' accorciata (205 -> 67)', /righe 49px 6[0-9](\.\d+)?px 0px 138px 66px/.test(g || ''), g);
  await ctx.close();

  // Contare le righe per sovrapposizione, non per offsetTop: in verticale l'intestazione ha DUE righe (logo, nome e pulsanti / menu), anche se logo e pulsanti hanno offsetTop diversi.
  const p2 = await phone(browser, 390, 780, 1);
  const det2 = p2.page.locator('.touch-diag');
  await p2.page.locator('.insp-toggle').click();
  await det2.locator('summary').click();
  await p2.page.waitForTimeout(700);
  const t2 = await det2.locator('pre').innerText();
  check('in verticale (< 720 px) l\'intestazione ha due righe visive (il layout a capo e\' voluto: logo, nome, pulsanti / menu)', /intestazione \.bar: alta \d+(\.\d)? · padding su\/giu \d+(\.\d)?\/\d+(\.\d)? · righe visive 2 \[/.test(t2), t2.split('\n').find((l) => l.startsWith('intestazione')));
  check('in verticale la griglia ha una sola colonna', /colonne 390px(\s|$)/.test(t2.split('\n').find((l) => l.startsWith('griglia')) ?? ''), t2.split('\n').find((l) => l.startsWith('griglia')));
  await p2.ctx.close();
}

// =====================================================================
// 2) L'altezza di intestazione e stato non dipende dalla larghezza (>= 720 px)
const WIDTHS = [328, 250, 48];
async function invariantSuite(browser) {
  setSection('altezza indipendente dalla larghezza');
  const combos = [
    ['telefono', 932, 320],
    ['telefono', 844, 390],
    ['telefono', 780, 390],
    ['telefono', 720, 390],
    ['desktop', 1280, 800],
    ['desktop', 900, 700],
    ['desktop', 720, 700],
  ];
  const bad = [];
  let n = 0;
  for (const [kind, w, h] of combos) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const { ctx, page } = kind === 'telefono' ? await phone(browser, w, h, idx) : await desktop(browser, w, h, idx);
      for (const sel of ['.bar', '.statusbar']) {
        const real = await heightAt(page, sel, null);
        const hs = [];
        for (const fw of WIDTHS) hs.push(await heightAt(page, sel, fw));
        n++;
        if (hs.some((x) => Math.abs(x - real) > 1)) bad.push(`${kind} ${w}x${h} A+ ${UI_PX[idx]} ${sel}: vera ${real}, a ${WIDTHS.join('/')}: ${hs.join('/')}`);
      }
      await ctx.close();
    }
  }
  check(`l'altezza di .bar e .statusbar e' la stessa (+-1) alla larghezza vera, a 328, 250 e 48 px: ${n} casi (telefono 932x320, 844x390, 780x390, 720x390 con margini 0/59/21/59, desktop 1280, 900, 720; A+ 14, 16, 18, 20, 22)`, bad.length === 0, bad.slice(0, 6).join(' | ') + (bad.length > 6 ? ` ... (${bad.length} casi)` : ''));
  for (const b of bad.slice(0, 4)) info(`non invariante: ${b}`);

  // Le due righe sono SEMPRE una sola riga visiva alla larghezza vera nel layout a piu' colonne.
  const one = [];
  for (const [w, h] of [[932, 320], [844, 390], [780, 390], [720, 390]]) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const { ctx, page } = await phone(browser, w, h, idx);
      const r = await page.evaluate(() => {
        const rows = (el) => { const top = el.getBoundingClientRect().top; const bs = [...el.children].filter((c) => !['absolute', 'fixed'].includes(getComputedStyle(c).position)).map((c) => c.getBoundingClientRect()).filter((b) => b.height > 0).sort((a, b) => a.top - b.top); const out = []; for (const b of bs) { const l = out[out.length - 1]; if (l && b.top < l.bottom - 0.5) l.bottom = Math.max(l.bottom, b.bottom); else out.push({ top: b.top, bottom: b.bottom }); } return out.length; };
        return { bar: rows(document.querySelector('.bar')), stat: rows(document.querySelector('.statusbar')) };
      });
      if (r.bar !== 1 || r.stat !== 1) one.push(`${w}x${h} A+ ${UI_PX[idx]}: intestazione ${r.bar} righe, stato ${r.stat}`);
      await ctx.close();
    }
  }
  check('con il telefono (>= 720 px) intestazione e stato sono sempre UNA riga visiva, anche a A+ 22 e a 720 px', one.length === 0, one.join(' | '));
}

// =====================================================================
// 3) Che cosa entra nella riga
async function fitSuite(browser) {
  setSection('che cosa entra nella riga');
  const inBox = (page) =>
    page.evaluate(() => {
      const names = { bar: ['.bar .brand', '.menus .menu-btn', '.undo-ctl .btn', '.size-ctl .btn', '.zoom-ctl > *', '.insp-toggle'], statusbar: ['.st-coord', '.st-scale', '.st-toggle', '.st-pager .btn'] };
      const res = {};
      for (const [k, sels] of Object.entries(names)) {
        const box = document.querySelector(k === 'bar' ? '.bar' : '.statusbar');
        const out = [];
        for (const s of sels) for (const e of box.querySelectorAll(s.replace(/^\.(bar|statusbar) /, ''))) {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          if (cs.display === 'none' || r.width === 0) continue;
          const b = box.getBoundingClientRect();
          const label = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.className).trim().replace(/\s+/g, ' ').slice(0, 24);
          out.push({ label, inside: r.right <= b.right + 0.5 && r.left >= b.left - 0.5, right: Math.round(r.right), boxRight: Math.round(b.right) });
        }
        res[k] = { items: out, client: box.clientWidth, scroll: box.scrollWidth, height: Math.round(box.getBoundingClientRect().height * 10) / 10 };
      }
      return res;
    });
  // Misurato: finestra minima (con 59 + 59 px di margini) a cui NON esce nulla. A 932 px (>= 900) il pulsante del pannello non c'e' e tutto entra.
  const mustFit = { 932: [0, 1, 2, 3, 4], 844: [0, 1, 2, 3], 780: [0, 1, 2], 720: [0, 1] };
  const rows = [];
  for (const [w, h] of [[932, 320], [844, 390], [780, 390], [720, 390]]) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const { ctx, page } = await phone(browser, w, h, idx);
      const r = await inBox(page);
      const outBar = r.bar.items.filter((i) => !i.inside).map((i) => i.label);
      const outSt = r.statusbar.items.filter((i) => !i.inside).map((i) => i.label);
      if (mustFit[w].includes(idx)) check(`telefono ${w}x${h} A+ ${UI_PX[idx]}: logo, File, Modifica, Inserisci, Zoom, annulla, ripeti, A-, A+ e (fra 720 e 899) il pulsante del pannello entrano tutti nella riga; X/Y, scala, ORTO e pagine pure`, outBar.length === 0 && outSt.length === 0, `intestazione fuori: ${outBar.join(', ')} · stato fuori: ${outSt.join(', ')}`);
      else {
        // Non entra tutto: nessun taglio senza via d'uscita. Scorrendo fino in fondo ogni elemento si raggiunge; l'altezza non cambia.
        const reach = await page.evaluate(() => {
          const bar = document.querySelector('.bar');
          const h0 = bar.getBoundingClientRect().height;
          bar.scrollLeft = bar.scrollWidth;
          const b = bar.getBoundingClientRect();
          const last = [...bar.querySelectorAll('button')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).pop();
          const lr = last.getBoundingClientRect();
          const ok = lr.right <= b.right + 0.5 && lr.left >= b.left - 0.5;
          const h1 = bar.getBoundingClientRect().height;
          bar.scrollLeft = 0;
          return { ok, scrolls: bar.scrollWidth > bar.clientWidth, h0, h1 };
        });
        check(`telefono ${w}x${h} A+ ${UI_PX[idx]}: non entra tutto (fuori: ${outBar.join(', ') || '-'} · stato: ${outSt.join(', ') || '-'}) ma la riga scorre, l'ultimo pulsante si raggiunge e l'altezza resta ${reach.h0}`, reach.ok && reach.h0 === reach.h1, JSON.stringify(reach));
      }
      rows.push(`${w}x${h} A+ ${UI_PX[idx]} px: intestazione ${r.bar.height} alta, contenuto ${r.bar.scroll} su ${r.bar.client}${outBar.length ? ` · FUORI: ${outBar.join(', ')}` : ''} | stato ${r.statusbar.height}, contenuto ${r.statusbar.scroll} su ${r.statusbar.client}${outSt.length ? ` · FUORI: ${outSt.join(', ')}` : ''}`);
      await ctx.close();
    }
  }
  for (const r of rows) info(r);
  // Desktop: stessa misura, solo informativa (nessun margine di sicurezza, ci sono nome del file e zoom)
  for (const w of [720, 780, 844, 932]) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const { ctx, page } = await desktop(browser, w, 700, idx);
      const r = await inBox(page);
      const outBar = r.bar.items.filter((i) => !i.inside).map((i) => i.label);
      if (outBar.length) info(`desktop ${w} px A+ ${UI_PX[idx]}: intestazione, contenuto ${r.bar.scroll} su ${r.bar.client} · FUORI: ${outBar.join(', ')}`);
      await ctx.close();
    }
  }
  // Il bordo di fuoco non e' tagliato: dentro il pulsante
  const { ctx, page } = await desktop(browser, 1280, 700, 1);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const off = await page.evaluate(() => { const a = document.activeElement; return { cls: a.className, offset: getComputedStyle(a).outlineOffset, style: getComputedStyle(a).outlineStyle }; });
  check('il bordo di fuoco dei pulsanti dell\'intestazione e\' disegnato dentro il pulsante (il contenitore ha overflow e taglierebbe quello esterno)', /menu-btn/.test(off.cls) && off.style === 'solid' && parseFloat(off.offset) < 0, JSON.stringify(off));
  await ctx.close();
}

// =====================================================================
// 4) Pannello "Nessun documento aperto" dentro il visore
async function emptyPanelSuite(browser) {
  setSection('pannello Nessun documento');
  const measure = (page) =>
    page.evaluate(() => {
      const wk = document.querySelector('.work').getBoundingClientRect();
      const ep = document.querySelector('.empty-panel');
      const R = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { top: r.top - wk.top, bottom: r.bottom - wk.top, left: r.left - wk.left, right: r.right - wk.left, h: r.height }; };
      const parts = { logo: R('.empty-logo'), titolo: R('.empty-title'), apri: R('.empty-panel .btn.big'), frase: R('.empty-panel .hint'), prova: R('.samples-box summary') };
      return { work: { w: wk.width, h: wk.height }, scrollH: ep.scrollHeight, clientH: ep.clientHeight, scrollW: ep.scrollWidth, clientW: ep.clientWidth, overflowY: getComputedStyle(ep).overflowY, parts };
    });
  const inside = (p, work, tol = 0.5) => p.top >= -tol && p.bottom <= work.h + tol && p.left >= -tol && p.right <= work.w + tol;
  for (const [w, h] of [[932, 320], [932, 430], [844, 280], [844, 390]]) {
    for (let idx = 0; idx < UI_PX.length; idx++) {
      const tag = `${w}x${h} A+ ${UI_PX[idx]}`;
      const { ctx, page } = await phone(browser, w, h, idx);
      const m = await measure(page);
      const scrolls = m.scrollH > m.clientH + 0.5;
      const names = Object.keys(m.parts);
      if (!scrolls) check(`${tag}: il pannello entra e tutte le parti (logo, titolo, Apri PDF, frase, PDF di prova) sono dentro il visore (${Math.round(m.work.w)}x${Math.round(m.work.h)})`, names.every((k) => inside(m.parts[k], m.work)), JSON.stringify(m.parts));
      else {
        check(`${tag}: il pannello e' piu' alto del visore (${m.scrollH} su ${m.clientH}), scorre (overflow-y ${m.overflowY}) e a scrollTop 0 NON taglia in alto (il logo parte da ${Math.round(m.parts.logo.top)} >= 0)`, m.overflowY === 'auto' && m.parts.logo.top >= -0.5 && m.parts.titolo.top >= -0.5, JSON.stringify(m.parts));
        const end = await page.evaluate(() => { const ep = document.querySelector('.empty-panel'); ep.scrollTop = ep.scrollHeight; const wk = document.querySelector('.work').getBoundingClientRect(); const r = document.querySelector('.samples-box summary').getBoundingClientRect(); return { bottom: r.bottom - wk.top, h: wk.height, scrollTop: ep.scrollTop }; });
        check(`${tag}: in fondo il sommario "PDF di prova" e' tutto dentro il visore (basso ${Math.round(end.bottom)} <= ${Math.round(end.h)})`, end.bottom <= end.h + 0.5, JSON.stringify(end));
        await page.evaluate(() => { document.querySelector('.empty-panel').scrollTop = 0; });
      }
      check(`${tag}: nessun scorrimento in orizzontale del pannello`, m.scrollW <= m.clientW + 0.5, `${m.scrollW} > ${m.clientW}`);
      // "Apri PDF..." (>= 44 px) raggiungibile con il tocco: se non e' in vista a scrollTop 0 si porta in vista; elementFromPoint al centro e' il pulsante
      await page.locator('.empty-panel .btn.big').scrollIntoViewIfNeeded().catch(() => {});
      const hit = await page.evaluate(() => {
        const b = document.querySelector('.empty-panel .btn.big');
        const r = b.getBoundingClientRect();
        const wk = document.querySelector('.work').getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { ok: (e === b || b.contains(e)) && r.top >= wk.top - 0.5 && r.bottom <= wk.bottom + 0.5, h: r.height };
      });
      check(`${tag}: "Apri PDF…" alto >= 44 px (${hit.h}), dentro il visore e colpito al centro da elementFromPoint`, hit.ok && hit.h >= 44, JSON.stringify(hit));
      // Elenco "PDF di prova": ogni voce cliccabile
      let opened = true;
      try {
        await page.locator('summary', { hasText: 'PDF di prova' }).click();
      } catch (e) {
        opened = false;
      }
      check(`${tag}: il sommario "PDF di prova" si apre con un tocco (e' raggiungibile)`, opened);
      if (!opened) {
        await ctx.close();
        continue;
      }
      await page.waitForSelector('.samples .btn', { state: 'attached' });
      const n = await page.locator('.samples .btn').count();
      let okAll = true;
      const bad = [];
      for (let i = 0; i < n; i++) {
        await page.locator('.samples .btn').nth(i).scrollIntoViewIfNeeded().catch(() => {});
        const r = await page.evaluate((k) => {
          const b = document.querySelectorAll('.samples .btn')[k];
          const wk = document.querySelector('.work').getBoundingClientRect();
          const bb = b.getBoundingClientRect();
          const e = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
          return { ok: (e === b || b.contains(e)) && bb.top >= wk.top - 0.5 && bb.bottom <= wk.bottom + 0.5 && bb.left >= wk.left - 0.5 && bb.right <= wk.right + 0.5, label: b.textContent };
        }, i);
        if (!r.ok) {
          okAll = false;
          bad.push(r.label);
        }
      }
      check(`${tag}: le ${n} voci di "PDF di prova" si portano in vista scorrendo e sono colpite al centro`, n >= 7 && okAll, bad.join(', '));
      await ctx.close();
    }
  }
  // Compatto: a 932x320 con A+ normale "Apri PDF…" e la frase sulla privacy sono visibili SENZA scorrere
  for (const idx of [0, 1]) {
    const { ctx, page } = await phone(browser, 932, 320, idx);
    const m = await measure(page);
    check(`932x320 A+ ${UI_PX[idx]}: "Apri PDF…" e la frase "Il file resta su questo dispositivo" sono visibili a scrollTop 0 (senza scorrere)`, inside(m.parts.apri, m.work) && inside(m.parts.frase, m.work) && inside(m.parts.titolo, m.work), JSON.stringify(m.parts));
    check(`932x320 A+ ${UI_PX[idx]}: anche il sommario "PDF di prova" e' in vista senza scorrere`, inside(m.parts.prova, m.work), JSON.stringify(m.parts.prova));
    await ctx.close();
  }
  // Regressione: dove prima entrava (verticale, desktop) il pannello resta al centro e senza scorrimento
  for (const [kind, w, h] of [['telefono', 390, 780], ['desktop', 1280, 800]]) {
    const { ctx, page } = kind === 'telefono' ? await phone(browser, w, h, 1) : await desktop(browser, w, h, 1);
    const m = await measure(page);
    const top = m.parts.logo.top;
    const bottom = m.parts.prova.bottom;
    const cy = (top + bottom) / 2;
    const cx = (m.parts.logo.left + m.parts.logo.right) / 2;
    check(`${kind} ${w}x${h}: il pannello entra, non scorre e il contenuto sta al centro del visore (verticale ${cy.toFixed(1)} su ${(m.work.h / 2).toFixed(1)}, orizzontale ${cx.toFixed(1)} su ${(m.work.w / 2).toFixed(1)}, +-2 px)`, m.scrollH <= m.clientH + 0.5 && Math.abs(cy - m.work.h / 2) <= 2 && Math.abs(cx - m.work.w / 2) <= 2, JSON.stringify(m.parts));
    check(`${kind} ${w}x${h}: logo da 160 px (la disposizione compatta vale solo su touch con poca altezza)`, Math.abs(m.parts.logo.h - 160) < 0.5, String(m.parts.logo.h));
    await ctx.close();
  }
}

// =====================================================================
// 5) Il pannello App si raggiunge in fondo scorrendo (932x320, circa 205 px di altezza)
async function inspectorScrollSuite(browser) {
  setSection('pannello App: fino in fondo');
  for (const idx of [1, 4]) {
    const { ctx, page, cdp } = await phone(browser, 932, 320, idx);
    const det = page.locator('.touch-diag');
    await det.locator('summary').click();
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => { const i = document.querySelector('.inspector'); return { h: i.clientHeight, sh: i.scrollHeight }; });
    check(`932x320 A+ ${UI_PX[idx]}: il pannello e' alto ${m.h} px e il suo contenuto ${m.sh} px (scorre)`, m.sh > m.h + 1, JSON.stringify(m));
    // Dito che trascina sulla riga del titolo "Documento" (non su una zona che scorre da sola): il pannello scorre
    const box = await page.locator('.inspector').boundingBox();
    const x = box.x + 6; // nel margine interno del pannello: non su un riquadro che scorre da solo
    for (let k = 0; k < 40; k++) {
      await touch(cdp, 'touchStart', [[x, box.y + box.height - 20, 1]]);
      for (let s = 1; s <= 6; s++) await touch(cdp, 'touchMove', [[x, box.y + box.height - 20 - (150 * s) / 6, 1]]);
      await touch(cdp, 'touchEnd', []);
      await page.waitForTimeout(120);
      const st = await page.evaluate(() => { const i = document.querySelector('.inspector'); return i.scrollTop >= i.scrollHeight - i.clientHeight - 1; });
      if (st) break;
    }
    const end = await page.evaluate(() => {
      const i = document.querySelector('.inspector');
      const b = i.getBoundingClientRect();
      const link = document.querySelector('.licenses-link').getBoundingClientRect();
      return { atEnd: i.scrollTop >= i.scrollHeight - i.clientHeight - 1, linkBottom: Math.round(link.bottom), boxBottom: Math.round(b.bottom), linkInside: link.bottom <= b.bottom + 0.5 && link.top >= b.top - 0.5 };
    });
    check(`932x320 A+ ${UI_PX[idx]}: con il dito il pannello arriva in fondo e il collegamento "Licenze e componenti di terze parti" e' tutto in vista (con il riquadro di diagnostica aperto)`, end.atEnd && end.linkInside, JSON.stringify(end));
    // Dito che parte DENTRO il riquadro di lettura (scorre da solo, max-height 45vh): dopo il suo fondo i trascinamenti seguenti portano avanti il pannello
    await page.evaluate(() => { const i = document.querySelector('.inspector'); i.scrollTop = 0; document.querySelector('.touch-readout').scrollTop = 0; document.querySelector('.touch-readout').scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(200);
    let swipes = 0;
    let atEnd = false;
    for (; swipes < 80 && !atEnd; swipes++) {
      const r = await page.evaluate(() => { const i = document.querySelector('.inspector').getBoundingClientRect(); const p = document.querySelector('.touch-readout').getBoundingClientRect(); const top = Math.max(i.top, p.top); const bottom = Math.min(i.bottom, p.bottom); return { x: p.left + p.width / 2, y: (top + bottom) / 2, h: bottom - top }; });
      if (r.h < 30) break; // il riquadro non e' piu' abbastanza in vista per partire da li'
      await touch(cdp, 'touchStart', [[r.x, r.y + r.h / 2 - 4, 1]]);
      for (let s = 1; s <= 6; s++) await touch(cdp, 'touchMove', [[r.x, r.y + r.h / 2 - 4 - (r.h - 12) * (s / 6), 1]]);
      await touch(cdp, 'touchEnd', []);
      await page.waitForTimeout(150);
      atEnd = await page.evaluate(() => { const i = document.querySelector('.inspector'); return i.scrollTop >= i.scrollHeight - i.clientHeight - 1; });
    }
    check(`932x320 A+ ${UI_PX[idx]}: con il dito che parte DENTRO il riquadro di lettura (scorre da solo) il pannello arriva comunque in fondo (${swipes} trascinamenti)`, atEnd, `swipes ${swipes}`);
    await ctx.close();
  }
}

async function main() {
  setSection('preparazione');
  const servers = await lib.startAll(chromium);
  const { browser } = servers;
  try {
    await readoutSuite(browser);
    await invariantSuite(browser);
    await fitSuite(browser);
    await emptyPanelSuite(browser);
    await inspectorScrollSuite(browser);
  } finally {
    await lib.stopAll(servers);
  }
  lib.finish();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
