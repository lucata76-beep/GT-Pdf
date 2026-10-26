// Prova dei limiti del canvas: alloca, disegna, rilegge un pixel, codifica in JPEG, rilascia.
// Serve a misurare cosa regge il dispositivo (decisioni n. 4 e 5). Lo stato "in corso" viene salvato:
// se Safari chiude la pagina per memoria, al ricaricamento si sa quale prova l'ha causata.
import { exportPixels } from '../geometry/pixels';
import { errText } from './log';

const A4 = { w: 595.276, h: 841.89 };
const A3 = { w: 841.89, h: 1190.551 }; // lato lungo in verticale: l'area non cambia

export interface Tier {
  id: string;
  label: string;
  w: number;
  h: number;
}

function pageTier(id: string, label: string, page: { w: number; h: number }, dpi: number): Tier {
  const p = exportPixels(page.w, page.h, dpi);
  return { id, label, w: p.w, h: p.h };
}

export function tiers(): Tier[] {
  const list: Tier[] = [
    pageTier('a4-150', 'A4 a 150 dpi', A4, 150),
    pageTier('a4-300', 'A4 a 300 dpi', A4, 300),
    { id: '4096x4096', label: '4096 x 4096 (tetto provvisorio)', w: 4096, h: 4096 },
    pageTier('a3-300', 'A3 a 300 dpi', A3, 300),
    { id: '8192x4096', label: '8192 x 4096', w: 8192, h: 4096 },
    pageTier('a4-600', 'A4 a 600 dpi', A4, 600),
    { id: '8192x8192', label: '8192 x 8192 (limite iOS nel sorgente WebKit)', w: 8192, h: 8192 },
    pageTier('a3-600', 'A3 a 600 dpi', A3, 600),
  ];
  return list.sort((a, b) => a.w * a.h - b.w * b.h);
}

export interface ProbeResult {
  tierId: string;
  ok: boolean;
  /** Fase raggiunta (se fallita: dove si e' fermata). */
  stage: string;
  ms: number;
  jpegBytes?: number;
  jpegMs?: number;
  error?: string;
  at: number;
}

const PENDING_KEY = 'gtpdf.probe.pending';
const RESULTS_KEY = 'gtpdf.probe.results';

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Prova interrotta dal sistema nella sessione precedente, se c'e'. Si legge una volta sola. */
export function takeInterrupted(): string | null {
  const s = store();
  if (!s) return null;
  try {
    const id = s.getItem(PENDING_KEY);
    if (id) s.removeItem(PENDING_KEY);
    return id;
  } catch {
    return null;
  }
}

export function savedResults(): Record<string, ProbeResult> {
  try {
    return JSON.parse(store()?.getItem(RESULTS_KEY) ?? '{}') as Record<string, ProbeResult>;
  } catch {
    return {};
  }
}

function saveResult(r: ProbeResult): void {
  try {
    const all = savedResults();
    all[r.tierId] = r;
    store()?.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    /* localStorage non disponibile: il risultato resta a schermo */
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

export async function probeTier(tier: Tier): Promise<ProbeResult> {
  const t0 = performance.now();
  let stage = 'preparazione';
  const canvas = document.createElement('canvas');
  const res: ProbeResult = { tierId: tier.id, ok: false, stage, ms: 0, at: Date.now() };
  try {
    store()?.setItem(PENDING_KEY, tier.id);
  } catch {
    /* ignora */
  }
  await tick(); // lascia aggiornare l'interfaccia prima dell'allocazione pesante
  try {
    stage = 'dimensionamento';
    canvas.width = tier.w;
    canvas.height = tier.h;
    stage = 'getContext';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('getContext(2d) ha restituito null');
    stage = 'disegno';
    const g = ctx.createLinearGradient(0, 0, tier.w, tier.h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#6a7480');
    g.addColorStop(1, '#1e232a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, tier.w, tier.h);
    ctx.fillStyle = 'rgb(10, 20, 30)';
    ctx.fillRect(tier.w - 2, tier.h - 2, 2, 2);
    stage = 'lettura dell\'ultimo pixel';
    const px = ctx.getImageData(tier.w - 1, tier.h - 1, 1, 1).data;
    if (px[0] !== 10 || px[1] !== 20 || px[2] !== 30 || px[3] !== 255) {
      throw new Error(`pixel letto [${[...px].join(', ')}], atteso [10, 20, 30, 255]: il canvas non è utilizzabile`);
    }
    stage = 'codifica JPEG (toBlob)';
    const j0 = performance.now();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('toBlob ha restituito null');
    res.jpegBytes = blob.size;
    res.jpegMs = performance.now() - j0;
    stage = 'completata';
    res.ok = true;
  } catch (e) {
    res.error = errText(e);
  } finally {
    canvas.width = 1; // rilascia la memoria
    canvas.height = 1;
  }
  res.stage = stage;
  res.ms = performance.now() - t0;
  try {
    store()?.removeItem(PENDING_KEY);
  } catch {
    /* ignora */
  }
  saveResult(res);
  return res;
}
