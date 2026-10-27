import { describe, expect, it } from 'vitest';
import { firstUnsupported } from '../geometry/textMetrics';
import { DIGIT_KEYS, type EntryRules, LETTER_KEYS, SPECIAL_KEYS, SYMBOL_KEYS, backspace, typeChar } from './keypadInput';

const free: EntryRules = { maxLength: 10, commaAfterDigitIsDecimal: false };
const dim: EntryRules = { maxLength: 10, commaAfterDigitIsDecimal: true };

describe('tastierino: modifica del testo', () => {
  it('aggiunge in coda e cancella l\'ultimo carattere', () => {
    let t = '';
    for (const ch of ['Ø', '2', '5', '.', '4']) t = typeChar(t, ch, dim).text;
    expect(t).toBe('Ø25.4');
    expect(backspace(t)).toBe('Ø25.');
    expect(backspace('')).toBe('');
    expect(backspace('a')).toBe('');
  });

  it('"00" si scrive come due zeri', () => {
    expect(typeChar('5', '00', dim).text).toBe('500');
  });

  it('quote: la virgola dopo una cifra diventa punto; altrove resta virgola', () => {
    expect(typeChar('12', ',', dim).text).toBe('12.');
    expect(typeChar('M8', ',', dim).text).toBe('M8.'); // dopo una cifra
    expect(typeChar('M', ',', dim).text).toBe('M,');
    expect(typeChar('', ',', dim).text).toBe(',');
  });

  it('testo libero: la virgola resta com\'e\'', () => {
    expect(typeChar('12', ',', free).text).toBe('12,');
  });

  it('rifiuta i caratteri non esportabili e oltre la lunghezza massima, con il motivo', () => {
    expect(typeChar('ab', '→', free)).toEqual({ text: 'ab', error: 'Il carattere "→" non si può esportare nel PDF.' });
    const full = typeChar('0123456789', '1', free);
    expect(full.text).toBe('0123456789');
    expect(full.error).toMatch(/Massimo 10/);
    expect(typeChar('012345678', '9', free).error).toBeUndefined();
  });

  it('i tasti offerti si possono tutti esportare (nessun "?" nel PDF) e sono quelli del design', () => {
    const all = [...DIGIT_KEYS, ...LETTER_KEYS, ...LETTER_KEYS.map((c) => c.toLowerCase()), ...SYMBOL_KEYS, ...SPECIAL_KEYS.map((k) => k.ch)];
    for (const k of all) expect(firstUnsupported(k), k).toBeNull();
    expect(SPECIAL_KEYS.map((k) => k.ch)).toEqual(['Ø', 'R', '°', '±']);
    expect(DIGIT_KEYS).toEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '00']);
    expect(LETTER_KEYS).toHaveLength(26);
    expect(SYMBOL_KEYS).toHaveLength(28);
    expect(SYMBOL_KEYS).toEqual(expect.arrayContaining(['#', '$', '&']));
    expect(new Set(SYMBOL_KEYS).size).toBe(28);
  });
});
