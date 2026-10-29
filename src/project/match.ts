// Confronto tra un progetto e il PDF che si sta per riaprire (PARTE 3 di CP5c): stesso file, stessa geometria, o altro.
import type { ProjectPage } from './format';

/** Tolleranza sull'area visibile, in pt: gli stessi numeri letti da PDF.js e riscritti non devono dare falsi allarmi. */
export const VIEW_TOLERANCE_PT = 0.01;
/** `userUnit` e' un numero come un altro: tolleranza relativa minima (stesso valore, errori di scrittura a parte). */
const USER_UNIT_TOLERANCE = 1e-9;

export interface OpenedPageGeometry {
  view: readonly [number, number, number, number];
  rotate: number;
  userUnit: number;
}

export type GeometryCheck = { same: true } | { same: false; difference: string };

const fmtNum = (n: number): string => String(Math.round(n * 1000) / 1000);
const fmtView = (v: readonly number[]): string => `[${v.map(fmtNum).join(', ')}]`;

/**
 * Stesso numero di pagine e, per ogni pagina, stessa area visibile (tolleranza 0.01 pt su ogni numero), stessa rotazione e stesso `userUnit`.
 * Alla prima differenza dice dove e che cosa (valore atteso = quello del progetto, trovato = quello del PDF).
 */
export function comparePageGeometry(saved: readonly ProjectPage[], opened: readonly OpenedPageGeometry[]): GeometryCheck {
  if (saved.length !== opened.length) {
    return { same: false, difference: `Il progetto ha ${saved.length} ${saved.length === 1 ? 'pagina' : 'pagine'}, il PDF scelto ne ha ${opened.length}.` };
  }
  for (let i = 0; i < saved.length; i++) {
    const s = saved[i] as ProjectPage;
    const o = opened[i] as OpenedPageGeometry;
    const n = i + 1;
    if (s.rotate !== o.rotate) return { same: false, difference: `Pagina ${n}: rotazione attesa ${s.rotate}°, trovata ${o.rotate}°.` };
    if (Math.abs(s.userUnit - o.userUnit) > USER_UNIT_TOLERANCE * Math.max(1, Math.abs(s.userUnit))) {
      return { same: false, difference: `Pagina ${n}: UserUnit atteso ${fmtNum(s.userUnit)}, trovato ${fmtNum(o.userUnit)}.` };
    }
    for (let k = 0; k < 4; k++) {
      if (Math.abs((s.view[k] as number) - (o.view[k] as number)) > VIEW_TOLERANCE_PT) {
        return { same: false, difference: `Pagina ${n}: area visibile attesa ${fmtView(s.view)} pt, trovata ${fmtView(o.view)} pt.` };
      }
    }
  }
  return { same: true };
}

/** Esito del confronto tra progetto e PDF scelto (decisioni 29 e seguenti di docs/PIANO.md). */
export type OpenOutcome =
  | { kind: 'same'; message: string }
  /** Hash diverso o assente, ma stesse pagine e stessa geometria: si puo' procedere con conferma. */
  | { kind: 'confirm'; reason: 'different-hash' | 'no-hash'; message: string }
  /** Pagine o geometria diverse: si rifiuta. */
  | { kind: 'reject'; message: string };

export interface OutcomeInput {
  savedSha256: string | null;
  openedSha256: string | null;
  geometry: GeometryCheck;
}

export function decideOutcome(i: OutcomeInput): OpenOutcome {
  if (!i.geometry.same) {
    return { kind: 'reject', message: `Questo PDF non ha le stesse pagine del progetto: ${i.geometry.difference} Gli oggetti finirebbero nel posto sbagliato, quindi non apro il progetto.` };
  }
  if (i.savedSha256 !== null && i.openedSha256 !== null && i.savedSha256 === i.openedSha256) return { kind: 'same', message: 'Progetto aperto.' };
  const why =
    i.savedSha256 === null
      ? 'Il progetto è stato salvato senza l\'impronta (SHA-256) del PDF: non posso verificare che sia lo stesso file.'
      : i.openedSha256 === null
        ? 'Questo browser non calcola l\'impronta (SHA-256) del PDF: non posso verificare che sia lo stesso file.'
        : 'Non è lo stesso file con cui hai salvato.';
  return {
    kind: 'confirm',
    reason: i.savedSha256 === null || i.openedSha256 === null ? 'no-hash' : 'different-hash',
    message: `${why} Le pagine hanno la stessa geometria: gli oggetti restano dove sono, ma il disegno sotto potrebbe essere cambiato.`,
  };
}
