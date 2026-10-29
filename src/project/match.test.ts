import { describe, expect, it } from 'vitest';
import { VIEW_TOLERANCE_PT, comparePageGeometry, decideOutcome } from './match';
import type { ProjectPage } from './format';

const page = (n: number, over: Partial<ProjectPage> = {}): ProjectPage => ({ number: n, view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1, scale: null, objects: [], ...over });
const geo = (over: Partial<{ view: [number, number, number, number]; rotate: number; userUnit: number }> = {}) => ({ view: [0, 0, 595.276, 841.89] as [number, number, number, number], rotate: 0, userUnit: 1, ...over });

describe('comparePageGeometry', () => {
  it('stesse pagine: same', () => {
    expect(comparePageGeometry([page(1), page(2, { rotate: 90 })], [geo(), geo({ rotate: 90 })])).toEqual({ same: true });
  });
  it('numero di pagine diverso: lo dice', () => {
    const r = comparePageGeometry([page(1), page(2)], [geo()]);
    expect(r).toEqual({ same: false, difference: 'Il progetto ha 2 pagine, il PDF scelto ne ha 1.' });
    expect(comparePageGeometry([page(1)], [geo(), geo()])).toMatchObject({ same: false, difference: 'Il progetto ha 1 pagina, il PDF scelto ne ha 2.' });
  });
  it('la prima differenza: pagina, valore atteso e trovato (rotazione)', () => {
    expect(comparePageGeometry([page(1), page(2)], [geo(), geo({ rotate: 90 })])).toEqual({ same: false, difference: 'Pagina 2: rotazione attesa 0°, trovata 90°.' });
  });
  it('UserUnit diverso', () => {
    expect(comparePageGeometry([page(1, { userUnit: 2.5 })], [geo()])).toEqual({ same: false, difference: 'Pagina 1: UserUnit atteso 2.5, trovato 1.' });
  });
  it(`tolleranza di ${VIEW_TOLERANCE_PT} pt sull'area visibile: 0.009 passa, 0.011 no (su ogni numero)`, () => {
    expect(comparePageGeometry([page(1)], [geo({ view: [0.009, -0.009, 595.276 + 0.009, 841.89 - 0.009] })]).same).toBe(true);
    for (let k = 0; k < 4; k++) {
      const v: [number, number, number, number] = [0, 0, 595.276, 841.89];
      v[k] += 0.011;
      const r = comparePageGeometry([page(1)], [geo({ view: v })]);
      expect(r.same, `numero ${k}`).toBe(false);
    }
  });
  it('area visibile diversa: il messaggio riporta i due riquadri', () => {
    const r = comparePageGeometry([page(1)], [geo({ view: [50, 50, 450, 600] })]);
    expect(r).toEqual({ same: false, difference: 'Pagina 1: area visibile attesa [0, 0, 595.276, 841.89] pt, trovata [50, 50, 450, 600] pt.' });
  });
  it('un A4 contro un A3 (stesso numero di pagine): differenza sull\'area visibile', () => {
    expect(comparePageGeometry([page(1)], [geo({ view: [0, 0, 1190.551, 841.89] })]).same).toBe(false);
  });
});

describe('decideOutcome', () => {
  const same = { same: true } as const;
  it('hash uguale e stessa geometria: Progetto aperto', () => {
    expect(decideOutcome({ savedSha256: 'a'.repeat(64), openedSha256: 'a'.repeat(64), geometry: same })).toEqual({ kind: 'same', message: 'Progetto aperto.' });
  });
  it('hash diverso con stessa geometria: avviso con conferma', () => {
    const r = decideOutcome({ savedSha256: 'a'.repeat(64), openedSha256: 'b'.repeat(64), geometry: same });
    expect(r.kind).toBe('confirm');
    expect(r.kind === 'confirm' && r.reason).toBe('different-hash');
    expect(r.message).toMatch(/Non è lo stesso file con cui hai salvato.*il disegno sotto potrebbe essere cambiato/);
  });
  it('hash assente (nel progetto o nel browser): come diverso, con motivo "no-hash" e una frase che lo dice', () => {
    const a = decideOutcome({ savedSha256: null, openedSha256: 'b'.repeat(64), geometry: same });
    expect(a).toMatchObject({ kind: 'confirm', reason: 'no-hash' });
    expect(a.message).toMatch(/salvato senza l'impronta/);
    const b = decideOutcome({ savedSha256: 'a'.repeat(64), openedSha256: null, geometry: same });
    expect(b).toMatchObject({ kind: 'confirm', reason: 'no-hash' });
    expect(b.message).toMatch(/Questo browser non calcola l'impronta/);
    expect(decideOutcome({ savedSha256: null, openedSha256: null, geometry: same }).kind).toBe('confirm'); // due null NON sono "uguali"
  });
  it('geometria diversa: si rifiuta (anche con hash uguale, per un progetto ritoccato a mano) e dice la differenza', () => {
    const r = decideOutcome({ savedSha256: 'a'.repeat(64), openedSha256: 'a'.repeat(64), geometry: { same: false, difference: 'Pagina 1: rotazione attesa 0°, trovata 90°.' } });
    expect(r.kind).toBe('reject');
    expect(r.message).toMatch(/Pagina 1: rotazione attesa 0°, trovata 90°.*non apro il progetto/);
  });
});
