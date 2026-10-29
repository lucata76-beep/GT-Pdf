import { describe, expect, it } from 'vitest';
import { groupRows } from './screenInfo';

describe('groupRows (righe visive di una barra)', () => {
  it('figli di altezza diversa centrati sulla stessa riga sono UNA riga (non una per ogni offsetTop)', () => {
    // intestazione a 814 pt: logo 36 px, pulsanti 44 px, nome del file 16 px, tutti nella riga da 0 a 44
    const logo = { top: 4, bottom: 40 };
    const btn = { top: 0, bottom: 44 };
    const name = { top: 14, bottom: 30 };
    expect(groupRows([logo, btn, name])).toEqual([{ top: 0, bottom: 44 }]);
  });
  it("due righe che si toccano (il fondo della prima coincide con l'inizio della seconda) restano due", () => {
    expect(groupRows([{ top: 0, bottom: 44 }, { top: 44, bottom: 88 }])).toHaveLength(2);
  });
  it("tre righe: logo / menu / pulsanti, come a 328 pt di larghezza; l'ordine di ingresso non conta", () => {
    const rows = groupRows([{ top: 88, bottom: 132 }, { top: 2, bottom: 38 }, { top: 44, bottom: 88 }, { top: 8, bottom: 40 }]);
    expect(rows.map((r) => r.top)).toEqual([2, 44, 88]);
  });
  it("una sovrapposizione di meno di 0.5 px (arrotondamenti) non unisce due righe, una di piu' si", () => {
    expect(groupRows([{ top: 0, bottom: 44.4 }, { top: 44, bottom: 90 }])).toHaveLength(2);
    expect(groupRows([{ top: 0, bottom: 44.6 }, { top: 44, bottom: 90 }])).toHaveLength(1);
  });
  it('nessun riquadro: nessuna riga', () => {
    expect(groupRows([])).toEqual([]);
  });
});
