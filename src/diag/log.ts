// Registro eventi della pagina diagnostica: si copia e si incolla nella chat.
export type Level = 'info' | 'ok' | 'err';

interface Entry {
  t: number;
  level: Level;
  msg: string;
}

const entries: Entry[] = [];
const listeners = new Set<() => void>();

const TAG: Record<Level, string> = { info: 'i', ok: 'OK', err: 'ERR' };

export function log(msg: string, level: Level = 'info'): void {
  entries.push({ t: Date.now(), level, msg });
  if (entries.length > 500) entries.shift();
  for (const l of listeners) l();
}

export function onLog(cb: () => void): void {
  listeners.add(cb);
}

export function clearLog(): void {
  entries.length = 0;
  for (const l of listeners) l();
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function logText(): string {
  return entries
    .map((e) => {
      const d = new Date(e.t);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} [${TAG[e.level]}] ${e.msg}`;
    })
    .join('\n');
}

export function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  const named = e as { name?: string; message?: string } | null;
  if (named && (named.name || named.message)) return `${named.name ?? 'Errore'}: ${named.message ?? ''}`;
  return String(e);
}
