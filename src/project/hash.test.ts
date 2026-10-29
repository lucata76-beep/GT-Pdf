import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('sha256Hex (crypto.subtle.digest)', () => {
  // vettori noti di SHA-256 (FIPS 180-2 e la frase classica)
  it('"abc" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('il testo vuoto = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('"The quick brown fox jumps over the lazy dog" = d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592', async () => {
    expect(await sha256Hex(enc('The quick brown fox jumps over the lazy dog'))).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });
  it('FIPS 180-2: il messaggio di 448 bit "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"', async () => {
    expect(await sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('64 caratteri esadecimali minuscoli; i byte sono quelli passati (una sotto-vista non copia il resto del buffer)', async () => {
    const big = new Uint8Array(16);
    big.set(enc('abc'), 5);
    const h = await sha256Hex(big.subarray(5, 8));
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('senza crypto.subtle (contesto non sicuro) o se digest lancia: null, mai un valore inventato', async () => {
    expect(await sha256Hex(enc('abc'), {})).toBeNull();
    expect(await sha256Hex(enc('abc'), { subtle: {} as SubtleCrypto })).toBeNull();
    expect(await sha256Hex(enc('abc'), { subtle: { digest: () => Promise.reject(new Error('no')) } as unknown as SubtleCrypto })).toBeNull();
  });
});
