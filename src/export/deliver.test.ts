import { describe, expect, it } from 'vitest';
import { Download, RELEASE_DELAY_MS, makePdfFile, makeProjectFile, shareAvailability, shareFile } from './deliver';

const file = makePdfFile(new Uint8Array([37, 80, 68, 70, 45]), 'prova-quotato.pdf');
const domErr = (name: string, msg = 'x'): Error => Object.assign(new Error(msg), { name });

describe('makePdfFile', () => {
  it('File application/pdf con nome e contenuto', async () => {
    expect(file.type).toBe('application/pdf');
    expect(file.name).toBe('prova-quotato.pdf');
    expect(file.size).toBe(5);
  });
});

describe('makeProjectFile (file progetto .json, 5c)', () => {
  const project = makeProjectFile('{"format":"gt-pdf-project"}', 'prova.json');
  const nav = (canShare: boolean, share: (d: ShareData) => Promise<void> = async () => undefined) => ({ share, canShare: () => canShare }) as never;

  it('File application/json con nome e contenuto (UTF-8)', async () => {
    expect(project.type).toBe('application/json');
    expect(project.name).toBe('prova.json');
    expect(await project.text()).toBe('{"format":"gt-pdf-project"}');
  });

  it('Condividi: share() riceve UN File application/json, chiamata in modo sincrono', () => {
    let called: ShareData | null = null;
    const p = shareFile(project, nav(true, async (d) => { called = d; }), 'un file .json');
    expect(called).not.toBeNull();
    expect((called as unknown as ShareData).files).toHaveLength(1);
    expect((called as unknown as ShareData).files?.[0]?.type).toBe('application/json');
    return p.then((o) => expect(o.status).toBe('shared'));
  });

  it('canShare falso: lo dice nominando il file .json, non chiama share', async () => {
    let called = false;
    const a = shareAvailability(project, nav(false), 'un file .json');
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain('un file .json');
    expect(!a.ok && a.reason).not.toContain('PDF');
    const o = await shareFile(project, nav(false, async () => { called = true; }), 'un file .json');
    expect(o.status).toBe('unavailable');
    expect(called).toBe(false);
  });

  it('Scarica: blob application/octet-stream col nome .json', () => {
    const log: string[] = [];
    const d = new Download(project, {
      createObjectURL: (b) => { log.push(`create(${b.type},${b.size})`); return 'blob:p/1'; },
      revokeObjectURL: (u) => log.push(`revoke(${u})`),
      click: (u, n) => log.push(`click(${u},${n})`),
      setTimeout: () => 0,
      now: () => 1000,
    });
    d.start();
    expect(log).toEqual([`create(application/octet-stream,${project.size})`, 'click(blob:p/1,prova.json)']);
  });
});

describe('shareAvailability: dice perche\' non si puo\', senza nasconderlo', () => {
  it('share assente', () => {
    const a = shareAvailability(file, {});
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain('navigator.share');
  });
  it('canShare assente', () => {
    const a = shareAvailability(file, { share: async () => undefined } as never);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain('canShare');
  });
  it('canShare({files}) falso', () => {
    const a = shareAvailability(file, { share: async () => undefined, canShare: () => false } as never);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain('è falso');
  });
  it('canShare che lancia', () => {
    const a = shareAvailability(file, { share: async () => undefined, canShare: () => { throw domErr('TypeError'); } } as never);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain('TypeError');
  });
  it('canShare vero', () => {
    expect(shareAvailability(file, { share: async () => undefined, canShare: () => true } as never)).toEqual({ ok: true });
  });
});

describe('shareFile', () => {
  const nav = (share: (d: ShareData) => Promise<void>) => ({ share, canShare: () => true }) as never;

  it('chiama share in modo sincrono, con un solo File application/pdf', () => {
    let called: ShareData | null = null;
    let afterCall = false;
    const p = shareFile(file, nav(async (d) => { called = d; }));
    afterCall = true; // se share fosse dietro un await, qui `called` sarebbe ancora null
    expect(afterCall).toBe(true);
    expect(called).not.toBeNull();
    expect((called as unknown as ShareData).files).toHaveLength(1);
    expect((called as unknown as ShareData).files?.[0]?.type).toBe('application/pdf');
    return p.then((o) => expect(o.status).toBe('shared'));
  });

  it('AbortError (annullamento del foglio): esito "cancelled", non un errore', async () => {
    const o = await shareFile(file, nav(() => Promise.reject(domErr('AbortError', 'Share canceled'))));
    expect(o.status).toBe('cancelled');
    expect(o.detail).toBeUndefined();
    expect(o.message).toBe('Condivisione annullata.');
  });

  it('NotAllowedError (gesto scaduto): errore spiegato, con dettaglio', async () => {
    const o = await shareFile(file, nav(() => Promise.reject(domErr('NotAllowedError', 'denied'))));
    expect(o.status).toBe('failed');
    expect(o.message).toContain('Tocca di nuovo');
    expect(o.detail).toBe('NotAllowedError: denied');
  });

  it('TypeError e altri errori', async () => {
    expect((await shareFile(file, nav(() => Promise.reject(domErr('TypeError'))))).message).toContain('non può condividere');
    expect((await shareFile(file, nav(() => Promise.reject(domErr('DataError'))))).status).toBe('failed');
  });

  it('share che lancia in modo sincrono: nessuna eccezione verso il chiamante', async () => {
    const o = await shareFile(file, nav(() => { throw domErr('NotAllowedError'); }));
    expect(o.status).toBe('failed');
  });

  it('senza canShare: non chiama share e lo dice', async () => {
    let called = false;
    const o = await shareFile(file, { share: async () => { called = true; } } as never);
    expect(o.status).toBe('unavailable');
    expect(called).toBe(false);
  });
});

describe('Download: blob octet-stream, indirizzo rilasciato alla chiusura', () => {
  function env() {
    const log: string[] = [];
    let t = 1000;
    const timers: { fn: () => void; at: number }[] = [];
    const types: string[] = [];
    return {
      log,
      timers,
      types,
      advance: (ms: number) => {
        t += ms;
        for (const x of timers.filter((x) => x.at <= t)) x.fn();
      },
      e: {
        createObjectURL: (b: Blob) => {
          types.push(b.type);
          log.push(`create(${b.type},${b.size})`);
          return 'blob:test/1';
        },
        revokeObjectURL: (u: string) => log.push(`revoke(${u})`),
        click: (u: string, n: string) => log.push(`click(${u},${n})`),
        setTimeout: (fn: () => void, ms: number) => timers.push({ fn, at: t + ms }),
        now: () => t,
      },
    };
  }

  it('scarica con type octet-stream, nome .pdf, senza copiare; chiusura senza scarico: niente da revocare', () => {
    const x = env();
    const d = new Download(file, x.e);
    d.release();
    expect(x.log).toEqual([]);
    const y = env();
    const d2 = new Download(file, y.e);
    d2.start();
    d2.start(); // secondo scarico: stesso indirizzo
    expect(y.types).toEqual(['application/octet-stream']);
    expect(y.log).toEqual(['create(application/octet-stream,5)', 'click(blob:test/1,prova-quotato.pdf)', 'click(blob:test/1,prova-quotato.pdf)']);
  });

  it('alla chiusura subito dopo lo scarico si attende; a scarico lontano si revoca subito; dopo release non si scarica piu\'', () => {
    const x = env();
    const d = new Download(file, x.e);
    d.start();
    d.release();
    expect(x.log.some((l) => l.startsWith('revoke'))).toBe(false);
    x.advance(RELEASE_DELAY_MS - 1);
    expect(x.log.some((l) => l.startsWith('revoke'))).toBe(false);
    x.advance(1);
    expect(x.log.filter((l) => l.startsWith('revoke'))).toEqual(['revoke(blob:test/1)']);
    expect(d.objectUrl).toBeNull();
    d.start();
    expect(x.log.filter((l) => l.startsWith('click'))).toHaveLength(1);

    const y = env();
    const d2 = new Download(file, y.e);
    d2.start();
    y.advance(RELEASE_DELAY_MS + 5);
    d2.release();
    expect(y.log[y.log.length - 1]).toBe('revoke(blob:test/1)');
  });
});
