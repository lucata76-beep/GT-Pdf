// Copia gli asset di PDF.js (wasm, font standard, profili ICC) in public/pdfjs/.
// Servono per scansioni JBIG2/JPEG2000 e per i PDF con font non incorporati.
// I file LICENSE_* delle librerie incluse restano accanto agli asset.
// Esclusi: cmaps/ (CJK). Aggiungerli solo se un PDF lo richiede.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dst = join(root, 'public', 'pdfjs');

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

for (const dir of ['wasm', 'standard_fonts', 'iccs']) {
  const from = join(src, dir);
  if (!existsSync(from)) {
    console.error(`Manca ${from}: eseguire npm ci`);
    process.exit(1);
  }
  cpSync(from, join(dst, dir), { recursive: true });
}
cpSync(join(src, 'LICENSE'), join(dst, 'LICENSE'));
console.log('Asset PDF.js copiati in public/pdfjs/');
