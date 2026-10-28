export const A4: [number, number];
export interface FixturePage {
  size?: [number, number];
  rotate?: number;
  /** [x, y, larghezza, altezza] */
  crop?: [number, number, number, number];
  userUnit?: number;
  /** Contenuto grezzo della pagina (font Helvetica disponibile come /F1). */
  raw?: string;
  /** Annotazione con aspetto proprio (timbro rosso). */
  stamp?: { x: number; y: number; w: number; h: number };
  draw?: (page: unknown, font: unknown) => void;
}
export interface FixtureOptions {
  pages: FixturePage[];
  encrypt?: { algorithm?: string; ownerPassword?: string; userPassword?: string };
  useObjectStreams?: boolean;
}
export function build(options: FixtureOptions): Promise<Uint8Array>;
export type DirtyKind = 'clean' | 'matrix-left' | 'flip-left' | 'open-q' | 'stray-q' | 'invisible-text';
export function dirtyContent(kind: DirtyKind): string;
export function dirtyPdf(kind: DirtyKind, extra?: Partial<FixturePage>): Promise<Uint8Array>;
