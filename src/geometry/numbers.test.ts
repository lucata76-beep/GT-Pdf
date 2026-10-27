import { describe, expect, it } from 'vitest';
import { fmt, fmtSigned, fmtTrim, parseDecimal, parsePositive } from './numbers';

describe('parseDecimal: "." e "," sono accettati e normalizzati a "."', () => {
  it.each([
    ['12.5', 12.5, '12.5'],
    ['12,5', 12.5, '12.5'],
    ['  100 ', 100, '100'],
    ['0,25', 0.25, '0.25'],
    ['.5', 0.5, '.5'],
    [',5', 0.5, '.5'],
    ['12.', 12, '12.'],
    ['1,', 1, '1.'],
    ['-3,5', -3.5, '-3.5'],
    ['+7', 7, '+7'],
  ])('"%s" -> %d', (input, value, text) => {
    const r = parseDecimal(input);
    expect(r).toEqual({ ok: true, value, text });
  });

  it.each(['abc', '', '   ', '1.2.3', '1,2,3', '1,000.5', '1.000,5', '1e5', '12 5', '--3', 'Infinity', 'NaN', '0x10', '12mm'])('rifiuta "%s" con un messaggio', (input) => {
    const r = parseDecimal(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(5);
  });
});

describe('parsePositive', () => {
  it('accetta valori nel campo', () => {
    expect(parsePositive('0,5', { min: 0.1, max: 20, what: 'Spessore' })).toEqual({ ok: true, value: 0.5, text: '0.5' });
  });
  it('rifiuta zero, negativi, sotto il minimo, sopra il massimo', () => {
    for (const v of ['0', '-1', '0.05', '25']) {
      const r = parsePositive(v, { min: 0.1, max: 20, what: 'Spessore' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('Spessore');
    }
  });
  it('propaga il rifiuto del testo non numerico', () => {
    expect(parsePositive('abc', { what: 'Distanza reale' }).ok).toBe(false);
  });
});

describe('formattazione: sempre "." e mai migliaia', () => {
  it('fmt', () => {
    expect(fmt(12.5)).toBe('12.50');
    expect(fmt(1234567.891)).toBe('1234567.89');
    expect(fmt(0, 1)).toBe('0.0');
    expect(fmt(-0.001)).toBe('0.00');
    expect(fmt(-12.345, 1)).toBe('-12.3');
  });
  it('fmtTrim', () => {
    expect(fmtTrim(2.5)).toBe('2.5');
    expect(fmtTrim(50)).toBe('50');
    expect(fmtTrim(0.25)).toBe('0.25');
    expect(fmtTrim(1 / 3)).toBe('0.33');
  });
  it('fmtSigned', () => {
    expect(fmtSigned(3)).toBe('+3.00');
    expect(fmtSigned(-3)).toBe('-3.00');
    expect(fmtSigned(0)).toBe('0.00');
    expect(fmtSigned(-0.0001)).toBe('0.00');
  });
});
