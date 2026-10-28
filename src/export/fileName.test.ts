import { describe, expect, it } from 'vitest';
import { exportFileName } from './fileName';

describe('exportFileName', () => {
  it('aggiunge -quotato prima di .pdf', () => {
    expect(exportFileName('disegno.pdf')).toBe('disegno-quotato.pdf');
    expect(exportFileName('a4-vettoriale.pdf')).toBe('a4-vettoriale-quotato.pdf');
  });
  it('toglie .pdf con qualunque maiuscola', () => {
    for (const ext of ['.PDF', '.Pdf', '.pDf', '.pdF']) expect(exportFileName(`Disegno${ext}`)).toBe('Disegno-quotato.pdf');
  });
  it('spazi, accenti e piu\' punti restano come sono', () => {
    expect(exportFileName('Flangia rev 3.pdf')).toBe('Flangia rev 3-quotato.pdf');
    expect(exportFileName('perché è così più.PDF')).toBe('perché è così più-quotato.pdf');
    expect(exportFileName('flangia.rev.3.v2.pdf')).toBe('flangia.rev.3.v2-quotato.pdf');
    expect(exportFileName('Tavola 12.A.pdf.PDF')).toBe('Tavola 12.A.pdf-quotato.pdf'); // si toglie solo l'ultima estensione
  });
  it('conserva la forma Unicode scomposta (e + accento) dei nomi di iOS', () => {
    const nfd = 'perché.pdf';
    expect(exportFileName(nfd)).toBe('perché-quotato.pdf');
  });
  it('senza estensione .pdf si aggiunge comunque', () => {
    expect(exportFileName('scheda')).toBe('scheda-quotato.pdf');
    expect(exportFileName('scheda.pdf.bak')).toBe('scheda.pdf.bak-quotato.pdf');
  });
  it('nome vuoto o solo estensione: nome di ripiego', () => {
    expect(exportFileName('')).toBe('documento-quotato.pdf');
    expect(exportFileName('.pdf')).toBe('documento-quotato.pdf');
    expect(exportFileName('   .PDF')).toBe('documento-quotato.pdf');
  });
  it('separatori di percorso e caratteri di controllo non entrano nel nome', () => {
    expect(exportFileName('a/b\\c.pdf')).toBe('a_b_c-quotato.pdf');
    expect(exportFileName('a\u0000b\nc.pdf')).toBe('abc-quotato.pdf');
  });
  it('nome molto lungo: accorciato per caratteri interi, estensione intatta', () => {
    const out = exportFileName(`${'x'.repeat(300)}.pdf`);
    expect(out.endsWith('-quotato.pdf')).toBe(true);
    expect([...out].length).toBe(120 + '-quotato.pdf'.length);
    const emoji = exportFileName(`${'😀'.repeat(200)}.pdf`);
    expect([...emoji].length).toBe(120 + '-quotato.pdf'.length);
    expect(emoji).not.toContain('�');
  });
});
