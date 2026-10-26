// Ambiente e funzioni del browser rilevanti per l'app. Tutto misurato a runtime, nulla supposto.

export interface Row {
  label: string;
  value: string;
  ok?: boolean;
}

const nav = navigator as Navigator & {
  standalone?: boolean;
  deviceMemory?: number;
  canShare?: (data?: ShareData) => boolean;
};

const fmt = (n: number): string => n.toLocaleString('it-IT', { maximumFractionDigits: 2 });

export function environmentRows(): Row[] {
  const vv = window.visualViewport;
  const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return [
    { label: 'Versione app', value: `${__BUILD_ID__} (${__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC)` },
    { label: 'Indirizzo', value: location.href },
    { label: 'Modalità', value: standalone ? 'da icona Home (standalone)' : 'scheda del browser' },
    { label: 'User agent', value: navigator.userAgent },
    { label: 'Schermo', value: `${screen.width} x ${screen.height} px CSS, DPR ${fmt(window.devicePixelRatio)}` },
    { label: 'Finestra', value: `${window.innerWidth} x ${window.innerHeight} px CSS` },
    { label: 'visualViewport', value: vv ? `${fmt(vv.width)} x ${fmt(vv.height)}, scala ${fmt(vv.scale)}` : 'assente' },
    { label: 'Punti di tocco', value: String(navigator.maxTouchPoints) },
    { label: 'Memoria (deviceMemory)', value: nav.deviceMemory !== undefined ? `${nav.deviceMemory} GB` : 'non esposta dal browser' },
    { label: 'Contesto sicuro (HTTPS)', value: window.isSecureContext ? 'sì' : 'no', ok: window.isSecureContext },
  ];
}

const has = (v: unknown): boolean => v !== undefined && v !== null;

export function featureRows(): Row[] {
  const yn = (label: string, ok: boolean): Row => ({ label, value: ok ? 'sì' : 'no', ok });
  return [
    yn('Map.getOrInsertComputed (serve alla build normale di PDF.js)', typeof (Map.prototype as unknown as Record<string, unknown>)['getOrInsertComputed'] === 'function'),
    yn('Promise.try', typeof (Promise as unknown as Record<string, unknown>)['try'] === 'function'),
    yn('Float16Array', has((globalThis as Record<string, unknown>)['Float16Array'])),
    yn('Uint8Array.fromBase64', typeof (Uint8Array as unknown as Record<string, unknown>)['fromBase64'] === 'function'),
    yn('Math.sumPrecise', typeof (Math as unknown as Record<string, unknown>)['sumPrecise'] === 'function'),
    yn('Promise.withResolvers', typeof (Promise as unknown as Record<string, unknown>)['withResolvers'] === 'function'),
    yn('WebAssembly', typeof WebAssembly === 'object'),
    yn('OffscreenCanvas', typeof OffscreenCanvas === 'function'),
    yn('PointerEvent', typeof PointerEvent === 'function'),
    yn('CSS touch-action: none', typeof CSS !== 'undefined' && CSS.supports('touch-action', 'none')),
    yn('navigator.share', typeof nav.share === 'function'),
    yn('navigator.canShare', typeof nav.canShare === 'function'),
    yn('showOpenFilePicker', 'showOpenFilePicker' in window),
    yn('showSaveFilePicker', 'showSaveFilePicker' in window),
    yn('navigator.clipboard.writeText', typeof navigator.clipboard?.writeText === 'function'),
    yn('Blob.arrayBuffer', typeof Blob.prototype.arrayBuffer === 'function'),
  ];
}
