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

/** Righe di testo con lo stato dello schermo adesso. */
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
  return lines;
}
