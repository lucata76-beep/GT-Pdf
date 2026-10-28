import { describe, expect, it } from 'vitest';
import { describeOpenError } from './openError';

const ex = (name: string, message: string): Error => Object.assign(new Error(message), { name });

describe('describeOpenError', () => {
  it('PDF troncato, danneggiato o non PDF (InvalidPDFException): italiano, con il nome del file e il dettaglio originale', () => {
    const d = describeOpenError('rotto.pdf', ex('InvalidPDFException', 'Invalid PDF structure.'));
    expect(d.message).toContain('rotto.pdf');
    expect(d.message).toContain('non è un PDF valido oppure è danneggiato o incompleto');
    expect(d.detail).toBe('InvalidPDFException: Invalid PDF structure.');
  });
  it('file vuoto', () => {
    expect(describeOpenError('v.pdf', ex('InvalidPDFException', 'The PDF file is empty, i.e. its size is zero bytes.')).message).toBe('v.pdf: il file è vuoto (0 byte).');
  });
  it('con password: lo stesso testo di prima', () => {
    expect(describeOpenError('c.pdf', ex('PasswordException', 'No password given')).message).toBe('c.pdf: il file richiede una password; i PDF protetti non sono previsti in questa versione.');
  });
  it('file non trovato e errore qualunque', () => {
    expect(describeOpenError('x.pdf', ex('MissingPDFException', 'Missing PDF')).message).toContain('non si trova più');
    const d = describeOpenError('x.pdf', new Error('boom'));
    expect(d.message).toBe('x.pdf: non riesco ad aprire questo file.');
    expect(d.detail).toBe('Error: boom');
  });
});
