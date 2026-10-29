import { describe, expect, it } from 'vitest';
import { exportFileName, projectFileName } from './fileName';

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

describe('projectFileName (5c, decisione 22): <nome del PDF senza .pdf>.json', () => {
  it('toglie .pdf con qualunque maiuscola e aggiunge .json (senza -quotato)', () => {
    expect(projectFileName('disegno.pdf')).toBe('disegno.json');
    for (const ext of ['.PDF', '.Pdf', '.pDf', '.pdF']) expect(projectFileName(`Disegno${ext}`)).toBe('Disegno.json');
  });
  it('spazi, accenti e piu\' punti restano come sono', () => {
    expect(projectFileName('Flangia rev 3.pdf')).toBe('Flangia rev 3.json');
    expect(projectFileName('perché è così più.PDF')).toBe('perché è così più.json');
    expect(projectFileName('flangia.rev.3.v2.pdf')).toBe('flangia.rev.3.v2.json');
    expect(projectFileName('Tavola 12.A.pdf.PDF')).toBe('Tavola 12.A.pdf.json');
  });
  it('la forma Unicode scomposta (NFD, come i nomi di iOS) resta scomposta', () => {
    const nfd = 'perché.pdf';
    expect(nfd.normalize('NFC')).not.toBe(nfd);
    expect(projectFileName(nfd)).toBe('perché.json');
    expect(projectFileName(nfd).normalize('NFD')).toBe('perché.json');
  });
  it('un nome che finisce gia\' in ".JSON" (non e\' un PDF, ma succede) non perde l\'estensione: si aggiunge .json', () => {
    expect(projectFileName('Progetto.JSON')).toBe('Progetto.JSON.json');
    expect(projectFileName('x.json.pdf')).toBe('x.json.json');
  });
  it('"/" e "\\" e i caratteri di controllo si cambiano; nome vuoto -> documento.json; nomi lunghi si accorciano per code point', () => {
    expect(projectFileName('a/b\\c.pdf')).toBe('a_b_c.json');
    expect(projectFileName('a\u0007b.pdf')).toBe('ab.json');
    expect(projectFileName('.pdf')).toBe('documento.json');
    expect(projectFileName('   .pdf')).toBe('documento.json');
    const long = projectFileName(`${'😀'.repeat(200)}.pdf`);
    expect([...long.replace(/\.json$/, '')]).toHaveLength(120);
  });
  it('stesse regole di exportFileName: stesso nome base', () => {
    for (const n of ['Disegno 1.pdf', 'perché.PDF', 'a.b.c.pdf', '.pdf']) expect(exportFileName(n).replace(/-quotato\.pdf$/, '')).toBe(projectFileName(n).replace(/\.json$/, ''));
  });
});
