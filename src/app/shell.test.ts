import { describe, expect, it } from 'vitest';
import { COMMA_MESSAGE, SHELL_MAX_ABS_MM, SHELL_MAX_LENGTH, parseShellPoint, parseShellRadius } from './shell';

const pt = (t: string) => parseShellPoint(t);
const ok = (t: string, x: number, y: number): void => {
  const r = pt(t);
  expect(r.ok, t).toBe(true);
  if (r.ok) {
    expect(r.value.x, t).toBe(x);
    expect(r.value.y, t).toBe(y);
  }
};
const err = (t: string): string => {
  const r = pt(t);
  expect(r.ok, `«${t}» doveva essere rifiutato`).toBe(false);
  return r.ok ? '' : r.error;
};

describe('shell: "X;Y" relative all\'origine (decisione 59)', () => {
  it('casi validi: interi, decimali con il punto, negativi, zero', () => {
    ok('10;20', 10, 20);
    ok('0;0', 0, 0);
    ok('12.5;-3', 12.5, -3);
    ok('-0.25;0.75', -0.25, 0.75);
    ok('100000;-100000', 100000, -100000);
    ok('1.23456789012;9', 1.23456789012, 9);
  });
  it('parte intera o decimale mancante con il punto: ".5" e "10." sono numeri', () => {
    ok('.5;10.', 0.5, 10);
    ok('-.5;-10.', -0.5, -10);
  });
  it('spazi attorno ai valori e al separatore ignorati', () => {
    ok('  10 ; 20  ', 10, 20);
    ok('\t-5\t;\t7.5\t', -5, 7.5);
  });
  it('-0 diventa 0 (nessun "-0" nei punti)', () => {
    const r = pt('-0;-0.0');
    expect(r.ok && Object.is(r.value.x, 0) && Object.is(r.value.y, 0)).toBe(true);
  });
  it('la virgola NON si accetta, ovunque sia: un solo messaggio chiaro, mai una conversione silenziosa', () => {
    for (const t of ['10,5;20', '10;20,5', '10,5', '10,20', '10,5;20,5', '1,2,3', ',;,']) expect(err(t), t).toBe(COMMA_MESSAGE);
    expect(COMMA_MESSAGE).toBe('Usa il punto per i decimali e «;» per separare X e Y.');
  });
  it('un solo valore o troppi valori', () => {
    expect(err('10')).toMatch(/^Servono X e Y separati da «;»/);
    expect(err('10;20;30')).toMatch(/^Troppi valori/);
    expect(err(';;')).toMatch(/^Troppi valori/);
  });
  it('valori mancanti, vuoto', () => {
    expect(err('')).toMatch(/^Digita X;Y/);
    expect(err('   ')).toMatch(/^Digita X;Y/);
    expect(err(';5')).toMatch(/^Manca X/);
    expect(err('5;')).toMatch(/^Manca Y/);
    expect(err(' ; ')).toMatch(/^Manca X/);
  });
  it('niente esponenziale, niente testo, niente segno + , niente segni doppi', () => {
    for (const t of ['1e3;5', '5;1E2', '1e-3;1', 'abc;1', '1;x', '--5;1', '5;-', '+5;1', '1.2.3;4', '0x10;1', 'Infinity;1', 'NaN;1', '1_000;2', '1/2;3']) expect(err(t), t).toMatch(/non è un numero/);
  });
  it('spazi dentro un numero rifiutati (non si legge "1 0" come 10)', () => {
    expect(err('1 0;5')).toMatch(/^Niente spazi dentro un numero/);
    expect(err('- 5;1')).toMatch(/^Niente spazi dentro un numero/);
  });
  it('valori enormi rifiutati (anche non finiti), il limite stesso e\' ammesso', () => {
    expect(err(`${SHELL_MAX_ABS_MM + 1};0`)).toMatch(/^Valore troppo grande/);
    expect(err(`0;-${SHELL_MAX_ABS_MM + 1}`)).toMatch(/^Valore troppo grande/);
    expect(err(`${'9'.repeat(60)};0`)).toMatch(/^Valore troppo grande/); // 1e60: finito ma enorme
    expect(err(`${'9'.repeat(400)};0`)).toMatch(/^Testo troppo lungo/); // oltre 64 caratteri: si ferma prima di arrivare a un numero non finito
    ok(`${SHELL_MAX_ABS_MM};-${SHELL_MAX_ABS_MM}`, SHELL_MAX_ABS_MM, -SHELL_MAX_ABS_MM);
  });
  it('testo troppo lungo', () => {
    expect(err(`1;${'0'.repeat(SHELL_MAX_LENGTH)}`)).toMatch(/^Testo troppo lungo/);
  });
  it('i messaggi sono di una riga e dicono che cosa fare', () => {
    for (const t of ['10', '1,5;2', 'a;b', '', '1e3;1', '99999999999;1', '10;20;30', '1 0;1']) expect(err(t), t).not.toMatch(/\n/);
  });
  it('non legge mai la catena dei prototipi ne\' valuta codice: è solo un confronto con un\'espressione regolare', () => {
    expect(err('constructor;toString')).toMatch(/non è un numero/);
    expect(err('__proto__;1')).toMatch(/non è un numero/);
  });
});

describe('shell: il raggio', () => {
  const r = (t: string) => parseShellRadius(t);
  it('un numero maggiore di zero', () => {
    expect(r('25')).toEqual({ ok: true, value: 25 });
    expect(r(' 0.5 ')).toEqual({ ok: true, value: 0.5 });
    expect(r('.25')).toEqual({ ok: true, value: 0.25 });
    expect(r('1000')).toEqual({ ok: true, value: 1000 });
  });
  it('zero e negativi rifiutati', () => {
    for (const t of ['0', '0.0', '-5', '-0.1']) expect(r(t), t).toEqual({ ok: false, error: 'Il raggio deve essere maggiore di zero.' });
  });
  it('un punto X;Y al posto del raggio rifiutato', () => {
    expect(r('10;20')).toEqual({ ok: false, error: 'Per il raggio serve un solo numero, maggiore di zero.' });
  });
  it('virgola rifiutata con un messaggio che parla di raggio; esponenziale, testo, vuoto, enormi', () => {
    expect(r('2,5')).toEqual({ ok: false, error: 'Usa il punto per i decimali: il raggio è un solo numero.' });
    expect(r('1e2').ok).toBe(false);
    expect(r('abc').ok).toBe(false);
    expect(r('').ok).toBe(false);
    expect(r(`${SHELL_MAX_ABS_MM + 1}`).ok).toBe(false);
    expect(r(`${'9'.repeat(60)}`).ok).toBe(false);
    expect(r(`${'9'.repeat(400)}`).ok).toBe(false);
    expect(r('x'.repeat(SHELL_MAX_LENGTH + 1)).ok).toBe(false);
    const e = r('1e2');
    expect(!e.ok && e.error).toMatch(/Il raggio non è un numero/);
  });
});
