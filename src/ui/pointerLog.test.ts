import { describe, expect, it } from 'vitest';
import { PointerLog } from './pointerLog';

const ev = (id: number, primary = true, type = 'touch') => ({ pointerId: id, pointerType: type, isPrimary: primary });

describe('PointerLog', () => {
  it('registra tipo, id, tipo di puntatore, primario, dimensione della mappa e id presenti', () => {
    const log = new PointerLog();
    log.note('down', ev(3), 1, [3]);
    log.note('down', ev(4, false), 2, [3, 4]);
    log.note('up', ev(3), 1, [4], 'ignorato');
    expect(log.entries).toHaveLength(3);
    expect(log.entries[0]).toMatch(/^\d+\.\d\ds down id=3 touch P n=1 \[3\]$/);
    expect(log.entries[1]).toMatch(/down id=4 touch S n=2 \[3,4\]$/);
    expect(log.entries[2]).toMatch(/up id=3 touch P n=1 \[4\] ignorato$/);
  });

  it('tiene solo gli ultimi 30 eventi (i piu\' vecchi escono per primi)', () => {
    const log = new PointerLog();
    for (let i = 0; i < 45; i++) log.note('move', ev(i), 1, [i]);
    expect(log.entries).toHaveLength(30);
    expect(log.entries[0]).toContain('id=15 ');
    expect(log.entries[29]).toContain('id=44 ');
  });

  it('mark: un fatto che non e\' un evento puntatore', () => {
    const log = new PointerLog();
    log.mark('mappa svuotata (1 puntatori)');
    expect(log.entries[0]).toMatch(/^\d+\.\d\ds · mappa svuotata/);
  });
});
