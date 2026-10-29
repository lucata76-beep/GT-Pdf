// Copia le licenze dei componenti di terze parti nel sito (public/licenses/): i testi di LICENSES/ e THIRD_PARTY.md, piu' una pagina index.html che li elenca.
// Serve agli obblighi di attribuzione (MIT, ISC, BSD, Apache-2.0, OFL, GPL-2.0 con eccezione per i font Liberation): le licenze devono accompagnare cio' che si distribuisce,
// quindi stanno anche nel sito pubblicato, non solo nel repository. public/licenses/ e' generato (non e' nel repository, come public/pdfjs/).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'LICENSES');
const dst = join(root, 'public', 'licenses');
if (!existsSync(src)) {
  console.error(`Manca ${src}`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
copyFileSync(join(root, 'THIRD_PARTY.md'), join(dst, 'THIRD_PARTY.md'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const files = readdirSync(dst).filter((f) => f !== 'index.html' && f !== 'THIRD_PARTY.md').sort();
const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licenze - GT-Pdf</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:50rem;margin:0 auto;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:.75rem;border-radius:6px;font-size:14px}a{color:#1565c0}</style>
</head>
<body>
<h1>Licenze dei componenti di terze parti</h1>
<p>Testi di licenza dei componenti inclusi in GT-Pdf. Altri testi stanno accanto ai file di PDF.js: <a href="../pdfjs/LICENSE">pdfjs/LICENSE</a> e i file <code>LICENSE_*</code> in <code>pdfjs/wasm/</code>, <code>pdfjs/standard_fonts/</code> e <code>pdfjs/iccs/</code>.</p>
<ul>
${files.map((f) => `<li><a href="${encodeURIComponent(f)}">${esc(f)}</a></li>`).join('\n')}
</ul>
<h2>Elenco dei componenti (THIRD_PARTY.md)</h2>
<pre>${esc(readFileSync(join(dst, 'THIRD_PARTY.md'), 'utf8'))}</pre>
</body>
</html>
`;
writeFileSync(join(dst, 'index.html'), html);
console.log(`Licenze copiate in public/licenses/ (${files.length} file)`);
