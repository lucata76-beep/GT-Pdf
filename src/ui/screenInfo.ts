// Lettura dello schermo e dell'area realmente visibile (CP5d), per la diagnostica e per il pannello App dell'editor.
// Serve a leggere sul telefono i numeri che in Chromium non si possono riprodurre: finestra, viewport visivo (barra di Safari), margini di sicurezza,
// unita' vh/dvh/svh/lvh, tipo di puntatore e altezza delle barre e del visore. Non cambia nulla: legge soltanto.
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Un elemento invisibile con lo stile dato, misurato e subito tolto. */
function probe<T>(style: string, read: (el: HTMLElement) => T): T {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;${style}`;
  document.body.append(el);
  try {
    return read(el);
  } finally {
    el.remove();
  }
}

/** Margini di sicurezza (px) come li vede CSS con env(): alto, destra, basso, sinistra. */
export function safeAreaInsets(): [number, number, number, number] {
  return probe('padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)', (el) => {
    const s = getComputedStyle(el);
    return [parseFloat(s.paddingTop) || 0, parseFloat(s.paddingRight) || 0, parseFloat(s.paddingBottom) || 0, parseFloat(s.paddingLeft) || 0];
  });
}

/** Altezza in px di `100<unit>`; null se il browser non conosce l'unita'. */
export function viewportUnitHeight(unit: 'vh' | 'dvh' | 'svh' | 'lvh'): number | null {
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('height', `1${unit}`)) return null;
  return probe(`width:1px;height:100${unit}`, (el) => el.getBoundingClientRect().height);
}

const rectOf = (selector: string): string => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return '-';
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === 'none' || r.height === 0) return 'nascosto';
  return `${f1(r.width)}x${f1(r.height)}`;
};

/** Un riquadro verticale: da `top` a `bottom` (px). */
export interface VBox {
  top: number;
  bottom: number;
}

/**
 * Raggruppa riquadri in righe (CP5e): un riquadro entra nella riga precedente se comincia prima della sua fine (sovrapposizione verticale, 0.5 px di tolleranza).
 * Non si contano i valori distinti di offsetTop: con `align-items: center` due figli sulla stessa riga ma di altezza diversa (logo 36 px, pulsante 44 px)
 * hanno offsetTop diversi e verrebbero contati come due righe. Restituisce una riga per gruppo, dall'alto in basso.
 */
export function groupRows(boxes: readonly VBox[]): VBox[] {
  const rows: VBox[] = [];
  for (const r of [...boxes].sort((a, b) => a.top - b.top)) {
    const last = rows[rows.length - 1];
    if (last && r.top < last.bottom - 0.5) last.bottom = Math.max(last.bottom, r.bottom);
    else rows.push({ top: r.top, bottom: r.bottom });
  }
  return rows;
}

/** Righe visive dei figli diretti di un elemento: quelli con altezza > 0 e nel flusso. Restituisce l'inizio di ogni riga in px dal bordo alto dell'elemento. */
export function visualRows(el: Element): number[] {
  const top = el.getBoundingClientRect().top;
  const boxes = Array.from(el.children)
    .filter((c) => {
      const p = getComputedStyle(c).position;
      return p !== 'absolute' && p !== 'fixed';
    })
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.height > 0);
  return groupRows(boxes).map((r) => r.top - top);
}

/** Una barra: altezza, padding su/giu' calcolati, righe visive e larghezza visibile contro larghezza del contenuto (se supera, la barra scorre o taglia). */
const barLine = (name: string, selector: string): string => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return `${name}: -`;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === 'none' || r.height === 0) return `${name}: nascosta`;
  const rows = visualRows(el);
  return `${name}: alta ${f1(r.height)} · padding su/giu ${f1(parseFloat(cs.paddingTop) || 0)}/${f1(parseFloat(cs.paddingBottom) || 0)} · righe visive ${rows.length} [${rows.map(f1).join(', ')}] · larga ${f1(el.clientWidth)}, contenuto ${el.scrollWidth}`;
};

/** Righe di testo con lo stato dello schermo adesso. Le prime 7 righe non cambiano posto: la "Prova menu" di Diagnostica ne usa solo le prime 7. */
export function screenLines(): string[] {
  const vv = window.visualViewport;
  const ins = safeAreaInsets();
  const lines: string[] = [];
  lines.push(`finestra ${window.innerWidth}x${window.innerHeight} · documento ${document.documentElement.clientWidth}x${document.documentElement.clientHeight} · esterna ${window.outerWidth}x${window.outerHeight}`);
  lines.push(vv ? `visualViewport ${f1(vv.width)}x${f1(vv.height)} · offset ${f1(vv.offsetLeft)},${f1(vv.offsetTop)} · pagina ${f1(vv.pageLeft)},${f1(vv.pageTop)} · scala ${vv.scale}` : 'visualViewport: non disponibile');
  lines.push(`schermo ${screen.width}x${screen.height} (utile ${screen.availWidth}x${screen.availHeight}) · DPR ${window.devicePixelRatio} · ${screen.orientation?.type ?? 'orientamento n/d'}`);
  lines.push(`margini di sicurezza (su, dx, giu, sx): ${ins.map(f1).join(', ')}`);
  const u = (['vh', 'dvh', 'svh', 'lvh'] as const).map((k) => `${k} ${viewportUnitHeight(k) === null ? 'n/d' : f1(viewportUnitHeight(k) as number)}`);
  lines.push(`100vh/dvh/svh/lvh in px: ${u.join(' · ')}`);
  const mq = (q: string): string => (window.matchMedia(q).matches ? 'si' : 'no');
  lines.push(`pointer coarse: ${mq('(pointer: coarse)')} · any-pointer coarse: ${mq('(any-pointer: coarse)')} · hover none: ${mq('(hover: none)')} · max-height 500px: ${mq('(max-height: 500px)')} · min-width 900px: ${mq('(min-width: 900px)')}`);
  lines.push(`base ${getComputedStyle(document.documentElement).fontSize} · scorrimento pagina ${f1(window.scrollX)},${f1(window.scrollY)}`);
  lines.push(`barre (larg x alt): bar ${rectOf('.bar')} · visore ${rectOf('.viewer')} · lavoro ${rectOf('.work')} · contestuale ${rectOf('.ctxbar')} · stato ${rectOf('.statusbar')} · palette ${rectOf('.palette')} · pannello ${rectOf('.inspector')} · tastierino ${rectOf('.keypad')}`);
  // CP5e. Griglia dell'editor: getComputedStyle(...).gridTemplateRows/Columns di un contenitore griglia restituisce il VALORE USATO, una misura in px per ogni
  // traccia (CSS Grid, "Resolved Value of a Track Listing"; letto sul sorgente della specifica, non su Safari: li' NON VERIFICATO). Es. "49px 205px 0px 0px 66px".
  const app = document.querySelector<HTMLElement>('.app');
  if (app) {
    const g = getComputedStyle(app);
    lines.push(`griglia .app ${rectOf('.app')} · righe ${g.gridTemplateRows} · colonne ${g.gridTemplateColumns}`);
    lines.push(barLine('intestazione .bar', '.bar'));
    lines.push(barLine('stato .statusbar', '.statusbar'));
    lines.push(barLine('contestuale .ctxbar', '.ctxbar'));
  }
  return lines;
}
