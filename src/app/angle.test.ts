import { describe, expect, it } from 'vitest';
import { ANGLE_COMMA_MESSAGE, ANGLE_MAX_LENGTH, parseAngle } from './angle';

describe('parseAngle', () => {
  it('gradi decimali con il punto, segno ammesso', () => {
    expect(parseAngle('90')).toEqual({ ok: true, value: 90 });
    expect(parseAngle('45')).toEqual({ ok: true, value: 45 });
    expect(parseAngle('-30')).toEqual({ ok: true, value: -30 });
    expect(parseAngle('  12.5 ')).toEqual({ ok: true, value: 12.5 });
    expect(parseAngle('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseAngle('10.')).toEqual({ ok: true, value: 10 });
    expect(parseAngle('-0')).toEqual({ ok: true, value: 0 });
    expect(parseAngle('0')).toEqual({ ok: true, value: 0 }); // il rifiuto di "niente da ruotare" e' della trasformazione, non del numero
    expect(parseAngle('360')).toEqual({ ok: true, value: 360 });
  });
  it('il segno meno tipografico vale come il trattino', () => {
    expect(parseAngle('−30')).toEqual({ ok: true, value: -30 });
  });
  it('la virgola e\' rifiutata con un messaggio chiaro, mai convertita', () => {
    for (const t of ['30,5', '1,5', ',5', '30,']) expect(parseAngle(t)).toEqual({ ok: false, error: ANGLE_COMMA_MESSAGE });
    expect(ANGLE_COMMA_MESSAGE).toMatch(/punto/);
  });
  it('vuoto, spazi interni, non numeri, esponenziale, "+" rifiutati', () => {
    for (const t of ['', '   ', '1 0', '--5', 'abc', '1e3', '+5', '5°', '1.2.3', '-', '.']) {
      const r = parseAngle(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.error.length, t).toBeGreaterThan(0);
    }
  });
  it('massimo 3600 gradi in valore assoluto e 12 caratteri', () => {
    expect(parseAngle('3600')).toEqual({ ok: true, value: 3600 });
    expect(parseAngle('-3600')).toEqual({ ok: true, value: -3600 });
    const big = parseAngle('3600.1');
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/troppo grande.*3600/);
    expect(parseAngle('1'.repeat(ANGLE_MAX_LENGTH + 1)).ok).toBe(false);
  });
});
