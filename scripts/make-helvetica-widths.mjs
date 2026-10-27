// Genera src/geometry/helveticaWidths.ts: larghezze dei glifi di Helvetica (font standard del PDF, codifica WinAnsi)
// misurate con @cantoo/pdf-lib, in millesimi di em. Servono a calcolare la larghezza dei testi e dei badge delle quote
// con le stesse metriche che avra' il PDF esportato (CP5), senza misurare nulla sullo schermo.
// Uso: npm run helvetica-widths   (riscrive il file; i test confrontano la tabella con pdf-lib)
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const FIRST = 32;
const LAST = 255;
// Caratteri ammessi: ASCII stampabile (32-126) e Latin-1 (160-255), che in WinAnsi hanno lo stesso codice di Unicode.
const allowed = (c) => (c >= 32 && c <= 126) || (c >= 160 && c <= 255);
const widths = [];
for (let c = FIRST; c <= LAST; c++) widths.push(allowed(c) ? Math.round(font.widthOfTextAtSize(String.fromCharCode(c), 1000)) : 0);

const em = font.embedder.font;
const rows = [];
for (let i = 0; i < widths.length; i += 16) rows.push(`  ${widths.slice(i, i + 16).join(', ')},`);
const src = `// GENERATO da scripts/make-helvetica-widths.mjs (npm run helvetica-widths): non modificare a mano.
// Larghezze di Helvetica (font standard del PDF, WinAnsi) in millesimi di em, misurate con @cantoo/pdf-lib.
// Indice = codice - ${FIRST}; 0 = carattere non ammesso (127-159). Metriche verticali dal file AFM di pdf-lib.

export const HELVETICA_FIRST_CODE = ${FIRST};
export const HELVETICA_LAST_CODE = ${LAST};
/** Ascender, descender (negativo) e altezza delle maiuscole, in millesimi di em. */
export const HELVETICA_ASCENDER = ${em.Ascender};
export const HELVETICA_DESCENDER = ${em.Descender};
export const HELVETICA_CAP_HEIGHT = ${em.CapHeight};
export const HELVETICA_WIDTHS: readonly number[] = [
${rows.join('\n')}
];
`;
writeFileSync(new URL('../src/geometry/helveticaWidths.ts', import.meta.url), src);
console.log(`helveticaWidths.ts: ${widths.length} valori, ascender ${em.Ascender}, descender ${em.Descender}, cap ${em.CapHeight}`);
