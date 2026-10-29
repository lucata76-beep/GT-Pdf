import { describe, expect, it } from 'vitest';
import { STALE_MS, type TrackedPointer, strayTouchIds } from './strayPointers';

const map = (entries: [number, TrackedPointer][]): Map<number, TrackedPointer> => new Map(entries);
const touch = (lastSeen: number): TrackedPointer => ({ type: 'touch', lastSeen });

describe('strayTouchIds', () => {
  it('un tocco primario che arriva con un tocco fermo da piu\' di STALE_MS nella mappa: quello e\' un fantasma', () => {
    expect(strayTouchIds(map([[5, touch(1000)]]), { pointerType: 'touch', isPrimary: true }, 1000 + STALE_MS)).toEqual([5]);
  });

  it('un tocco appena visto non si scarta (dito appoggiato davvero)', () => {
    expect(strayTouchIds(map([[5, touch(1000)]]), { pointerType: 'touch', isPrimary: true }, 1000 + STALE_MS - 1)).toEqual([]);
  });

  it('il secondo dito (non primario) non scarta mai nulla, nemmeno un dito fermo da molto', () => {
    expect(strayTouchIds(map([[5, touch(0)]]), { pointerType: 'touch', isPrimary: false }, 60_000)).toEqual([]);
  });

  it('il mouse non scarta nulla e un puntatore del mouse nella mappa non si scarta', () => {
    expect(strayTouchIds(map([[5, touch(0)]]), { pointerType: 'mouse', isPrimary: true }, 60_000)).toEqual([]);
    expect(strayTouchIds(map([[1, { type: 'mouse', lastSeen: 0 }]]), { pointerType: 'touch', isPrimary: true }, 60_000)).toEqual([]);
  });

  it('scarta solo i fermi, nell\'ordine della mappa', () => {
    const m = map([
      [3, touch(0)],
      [4, touch(9_500)],
      [6, touch(100)],
    ]);
    expect(strayTouchIds(m, { pointerType: 'touch', isPrimary: true }, 10_000)).toEqual([3, 6]);
  });

  it('mappa vuota: niente da scartare', () => {
    expect(strayTouchIds(new Map(), { pointerType: 'touch', isPrimary: true }, 10_000)).toEqual([]);
  });
});
