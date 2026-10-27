import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE,
  DEFAULT_STROKE,
  LINE_STYLES,
  MIN_PATTERN_UNIT_PT,
  WIDTH_MAX_PT,
  WIDTH_MIN_PT,
  WIDTH_PRESETS_PT,
  contrastRatio,
  dashPattern,
  parseHexColor,
  patternUnit,
} from './stroke';

describe('pattern dei tipi di linea (unita\' PDF, in funzione dello spessore)', () => {
  it('continua: nessun tratteggio', () => {
    expect(dashPattern('solid', 1)).toEqual([]);
    expect(dashPattern('solid', 5)).toEqual([]);
  });

  it('tratteggiata: tratto 8u, vuoto 3u', () => {
    expect(dashPattern('dashed', 1)).toEqual([8, 3]);
    expect(dashPattern('dashed', 2)).toEqual([16, 6]);
  });

  it('tratto-punto: tratto 12u, vuoto 3u, punto 1u, vuoto 3u', () => {
    expect(dashPattern('dashdot', 1)).toEqual([12, 3, 1, 3]);
    expect(dashPattern('dashdot', 0.5)).toEqual([6, 1.5, 0.5, 1.5]);
  });

  it('scala linearmente con lo spessore (sopra il minimo)', () => {
    for (const style of ['dashed', 'dashdot'] as const) {
      const a = dashPattern(style, 1);
      const b = dashPattern(style, 3);
      b.forEach((v, i) => expect(v).toBeCloseTo((a[i] as number) * 3, 12));
    }
  });

  it('sotto 0.5 pt l\'unita\' resta 0.5 pt: le linee sottili hanno comunque tratti visibili', () => {
    expect(MIN_PATTERN_UNIT_PT).toBe(0.5);
    expect(patternUnit(0.25)).toBe(0.5);
    expect(patternUnit(0.1)).toBe(0.5);
    expect(dashPattern('dashed', 0.25)).toEqual(dashPattern('dashed', 0.5));
  });

  it('tutti i valori sono positivi e finiti (richiesto da PDF /D e da SVG)', () => {
    for (const { id } of LINE_STYLES) {
      for (const w of [...WIDTH_PRESETS_PT, WIDTH_MIN_PT, WIDTH_MAX_PT]) {
        for (const v of dashPattern(id, w)) {
          expect(v).toBeGreaterThan(0);
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it('tre tipi, con etichette in italiano', () => {
    expect(LINE_STYLES.map((s) => s.id)).toEqual(['solid', 'dashdot', 'dashed']);
    expect(LINE_STYLES.map((s) => s.label)).toEqual(['Continua', 'Tratto-punto', 'Tratteggiata']);
  });
});

describe('colore', () => {
  it('tavolozza: ogni colore ha almeno 3:1 su bianco (WCAG 1.4.11)', () => {
    for (const { color } of COLOR_PALETTE) expect(contrastRatio(color, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
  it('contrasto: valori di riferimento di DESIGN.md', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#D32F2F', '#FFFFFF')).toBeCloseTo(4.98, 2); // dimension-default
    expect(contrastRatio('#1565C0', '#FFFFFF')).toBeCloseTo(5.75, 2); // dimension-alt
    expect(contrastRatio('#A43700', '#FFFFFF')).toBeCloseTo(6.72, 2); // accent-fill
  });
  it('il colore predefinito e\' nella tavolozza', () => {
    expect(COLOR_PALETTE.some((c) => c.color === DEFAULT_STROKE.color)).toBe(true);
  });
  it('parseHexColor: 6 cifre, con o senza #, maiuscolo', () => {
    expect(parseHexColor('#a43700')).toBe('#A43700');
    expect(parseHexColor('a43700')).toBe('#A43700');
    expect(parseHexColor('  #00FF7f ')).toBe('#00FF7F');
    for (const bad of ['', '#fff', '#12345', '#1234567', 'rosso', '#gg0000', '12 34 56']) expect(parseHexColor(bad)).toBeNull();
  });
});

describe('spessore', () => {
  it('predefiniti crescenti, dentro i limiti, con il valore predefinito fra loro', () => {
    expect([...WIDTH_PRESETS_PT].sort((a, b) => a - b)).toEqual([...WIDTH_PRESETS_PT]);
    for (const w of WIDTH_PRESETS_PT) {
      expect(w).toBeGreaterThanOrEqual(WIDTH_MIN_PT);
      expect(w).toBeLessThanOrEqual(WIDTH_MAX_PT);
    }
    expect(WIDTH_PRESETS_PT).toContain(DEFAULT_STROKE.widthPt);
  });
});
