// "Prova menu" (CP5d, Diagnostica): riproduce sul telefono le condizioni del menu a tendina dell'editor (schermo intero, barra in alto, pannello
// `.menu-panel` fisso con altezza massima e scorrimento, stesso codice di `menuButton`) e mostra in diretta i numeri che in Chromium non si possono
// riprodurre: finestra e viewport visivo (barra di Safari), margini di sicurezza, unita' vh/dvh/svh/lvh, misure del pannello, e quanti eventi
// resize, scroll e tocchi fuori sono arrivati e perche' il menu si e' chiuso. Serve a rispondere alle domande A13b della scheda prove; non e' una correzione.
import { type Child, h } from '../ui/dom';
import { type MenuEntry, menuButton } from '../ui/menu';
import { screenLines } from '../ui/screenInfo';

const ITEMS = 12; // come il menu Inserisci dell'editor, il piu' alto

interface Counters {
  resize: number;
  vvResize: number;
  vvScroll: number;
  winScroll: number;
  panelScroll: number;
  outside: number;
  opened: number;
}

export function menuTestCard(card: (title: string, open: boolean, ...body: Child[]) => HTMLElement): HTMLElement {
  const closeOnResize = h('input', { type: 'checkbox', checked: true, id: 'mt-close-resize' }) as HTMLInputElement;
  const start = h('button', { class: 'btn primary', type: 'button', onclick: () => openTest(closeOnResize.checked) }, 'Avvia la prova del menu');
  return card(
    'Prova menu',
    false,
    h(
      'p',
      { class: 'hint' },
      'Apre una schermata come l’editor (barra in alto, menu "Prova menu" con 12 voci). Aprire il menu, scorrerlo con un dito fino in fondo, toccare fuori, ruotare l’iPhone: i numeri sotto si aggiornano e dicono se e perché il menu si chiude. In fondo "Copia" li mette negli appunti.',
    ),
    h('label', { class: 'row' }, closeOnResize, h('span', null, 'Chiudi il menu quando la finestra cambia dimensione (come l’editor)')),
    h('div', { class: 'row' }, start),
  );
}

function openTest(closeOnResizeOn: boolean): void {
  const c: Counters = { resize: 0, vvResize: 0, vvScroll: 0, winScroll: 0, panelScroll: 0, outside: 0, opened: 0 };
  const events: string[] = [];
  const t0 = performance.now();
  const note = (text: string): void => {
    events.push(`${((performance.now() - t0) / 1000).toFixed(2)}s ${text}`);
    if (events.length > 14) events.shift();
    render();
  };
  let lastClose = 'mai chiuso';
  let panelScrollTop = 0;
  let boundPanel: Element | null = null;

  const items = (): MenuEntry[] => Array.from({ length: ITEMS }, (_, i) => ({ label: `Voce ${i + 1}`, hint: i % 4 === 3 ? 'prova' : undefined, onSelect: () => note(`scelta la voce ${i + 1}`) }));
  const menu = menuButton('Prova menu', items, {
    closeOnResize: closeOnResizeOn,
    onEvent: (kind, detail) => {
      if (kind === 'open') {
        c.opened++;
        note(`menu aperto (finestra ${detail})`);
      } else if (kind === 'close') {
        lastClose = detail;
        boundPanel = null;
        note(`menu chiuso: ${detail}`);
      } else if (kind === 'resize') {
        c.resize++;
        note(`resize della finestra ${detail}${closeOnResizeOn ? '' : ' (ignorato)'}`);
      } else {
        c.outside++;
        note(`tocco fuori dal pannello (${detail})`);
      }
    },
  });

  const readout = h('pre', { class: 'stats mono touch-readout menu-readout' });
  const render = (): void => {
    const panel = document.querySelector<HTMLElement>('.menu-panel');
    if (panel && panel !== boundPanel) {
      boundPanel = panel;
      panel.addEventListener('scroll', () => {
        c.panelScroll++;
        panelScrollTop = panel.scrollTop;
      });
    }
    const lines: string[] = [];
    lines.push(`Prova menu · chiusura su resize: ${closeOnResizeOn ? 'sì (come l’editor)' : 'no'}`);
    lines.push(...screenLines().slice(0, 7));
    if (panel) {
      const r = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const items = Array.from(panel.querySelectorAll<HTMLElement>('.menu-item')).map((e) => e.getBoundingClientRect().height);
      lines.push(
        `pannello: alto ${Math.round(r.top)}, basso ${Math.round(r.bottom)} (finestra ${window.innerHeight}) · clientHeight ${panel.clientHeight} · scrollHeight ${panel.scrollHeight} · scrollTop ${Math.round(panel.scrollTop)}${panel.scrollHeight > panel.clientHeight + 0.5 ? ' (scorre)' : ' (entra intero)'}`,
      );
      lines.push(`max-height calcolato ${cs.maxHeight} · --menu-top ${panel.style.getPropertyValue('--menu-top') || 'n/d'} · voci ${items.length}, altezza min ${Math.min(...items).toFixed(1)} max ${Math.max(...items).toFixed(1)} px`);
    } else lines.push(`pannello: chiuso (ultimo scrollTop ${Math.round(panelScrollTop)})`);
    lines.push(`documento: scrollTop ${Math.round(document.scrollingElement?.scrollTop ?? 0)} · overflow body ${getComputedStyle(document.body).overflowY}`);
    lines.push(`eventi: aperture ${c.opened} · resize finestra ${c.resize} · resize visualViewport ${c.vvResize} · scroll visualViewport ${c.vvScroll} · scroll finestra ${c.winScroll} · scroll pannello ${c.panelScroll} · tocchi fuori ${c.outside}`);
    lines.push(`ultima chiusura: ${lastClose}`);
    lines.push('ultimi eventi:', ...(events.length > 0 ? events.map((e) => `  ${e}`) : ['  nessuno']));
    readout.textContent = lines.join('\n');
  };

  const onVvResize = (): void => {
    c.vvResize++;
    note(`resize visualViewport ${window.visualViewport ? `${window.visualViewport.width.toFixed(0)}x${window.visualViewport.height.toFixed(1)}` : ''}`);
  };
  const onVvScroll = (): void => {
    c.vvScroll++;
    render();
  };
  const onWinScroll = (): void => {
    c.winScroll++;
    render();
  };
  const tick = window.setInterval(render, 300);

  const copy = h('button', { class: 'btn', type: 'button', onclick: () => void navigator.clipboard?.writeText(readout.textContent ?? '').catch(() => undefined) }, 'Copia');
  const wasAppMode = document.body.classList.contains('app-mode');
  const overlay = h(
    'div',
    { class: 'menu-test screen-app' },
    h(
      'div',
      { class: 'menu-test-inner' },
      h('div', { class: 'bar' }, h('div', { class: 'menus' }, menu), h('div', { class: 'bar-right' }, copy, h('button', { class: 'btn', type: 'button', onclick: () => end() }, 'Chiudi prova'))),
      readout,
    ),
  );
  function end(): void {
    window.clearInterval(tick);
    window.visualViewport?.removeEventListener('resize', onVvResize);
    window.visualViewport?.removeEventListener('scroll', onVvScroll);
    window.removeEventListener('scroll', onWinScroll);
    if (menu.getAttribute('aria-expanded') === 'true') menu.click();
    overlay.remove();
    document.body.classList.toggle('app-mode', wasAppMode);
  }
  window.visualViewport?.addEventListener('resize', onVvResize);
  window.visualViewport?.addEventListener('scroll', onVvScroll);
  window.addEventListener('scroll', onWinScroll);
  // come nell'editor: body senza scorrimento della pagina e senza rimbalzo
  document.body.classList.add('app-mode');
  document.body.append(overlay);
  render();
}
