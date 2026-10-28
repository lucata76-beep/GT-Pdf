# Componenti di terze parti

Versioni e licenze verificate il 26/10/2026 sul registro npm e sui file LICENSE dei pacchetti.
Ricontrollate il 28/10/2026 (CP4.6) sul registro npm (versione piu' recente e campo `license`) e nei pacchetti installati: pdfjs-dist 6.4.299 (Apache-2.0), @cantoo/pdf-lib 2.11.1 (MIT), TypeScript 7.0.2 (Apache-2.0), Vite 8.3.5 (MIT), Vitest 5.0.5 (MIT), @fontsource/inter e @fontsource/jetbrains-mono 5.3.0 (OFL-1.1) sono ancora le versioni piu' recenti e le licenze non sono cambiate. Unica differenza: `lucide-static` e' alla 1.63.0 (ISC), il progetto usa le icone della 1.61.0 e non e' stato aggiornato. I testi dei file LICENSE non sono stati riletti: le versioni sono identiche a quelle del 26/10.
Ricontrollate di nuovo il 28/10/2026 (CP5a, prima dell'esportazione): registro npm e `package.json` installati, **nessuna versione e nessuna licenza cambiata** (pdfjs-dist 6.4.299, @cantoo/pdf-lib 2.11.1, TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5, font 5.3.0; `lucide-static` sempre 1.63.0 contro le icone 1.61.0 del progetto). I file `LICENSE` di pdfjs-dist e di @cantoo/pdf-lib installati sono identici (a parte gli spazi a fine riga) a quelli in `LICENSES/`. In CP5a si e' accertato che l'esportazione porta nel sito anche le dipendenze di @cantoo/pdf-lib importate dal suo build ES (verificato con `grep` sugli `import` di `node_modules/@cantoo/pdf-lib/es`): culori 4.0.2, fflate 0.8.3, node-html-better-parser 1.5.9 e html-entities 2.6.0, tutte MIT secondo il registro npm e il campo `license` installato; i loro `LICENSE` sono stati copiati in `LICENSES/` (prima non c'erano). `tslib` (0BSD) e' una dipendenza dichiarata ma il build ES di pdf-lib non la importa.
Ricontrollate ancora il 28/10/2026 (CP5b, prima dell'esportazione "Appiattito"): registro npm e `package.json` installati, **nessuna versione e nessuna licenza cambiata** (pdfjs-dist 6.4.299, @cantoo/pdf-lib 2.11.1, TypeScript 7.0.2, Vite 8.3.5, Vitest 5.0.5, font 5.3.0, culori 4.0.2, fflate 0.8.3, node-html-better-parser 1.5.9, html-entities 2.6.0; `lucide-static` sempre 1.63.0 contro le icone 1.61.0 del progetto). I `LICENSE` installati di pdfjs-dist, @cantoo/pdf-lib e delle quattro dipendenze indirette sono identici (a parte gli spazi a fine riga) a quelli in `LICENSES/`. CP5b non aggiunge nessuna dipendenza: codifica JPEG/PNG con il canvas del browser e compressione con `CompressionStream` (API del browser).
I testi di licenza sono in `LICENSES/`. Nessun componente viene caricato da CDN.

| Componente | Versione | Licenza | Dove |
|---|---|---|---|
| pdfjs-dist (PDF.js, build `legacy/`) | 6.4.299 | Apache-2.0 | dipendenza npm; testo in `LICENSES/pdfjs-Apache-2.0.txt` |
| @cantoo/pdf-lib | 2.11.1 | MIT | dipendenza npm; testo in `LICENSES/cantoo-pdf-lib-MIT.txt` |
| culori, fflate, node-html-better-parser, html-entities (dipendenze di @cantoo/pdf-lib) | 4.0.2, 0.8.3, 1.5.9, 2.6.0 | MIT | dipendenze npm indirette; testi in `LICENSES/culori-MIT.txt`, `fflate-MIT.txt`, `node-html-better-parser-MIT.txt`, `html-entities-MIT.txt` |
| Inter (latin, 400/500/600/700) | 5.3.0 (Fontsource) | SIL OFL 1.1 | `src/assets/fonts/`; testo in `LICENSES/OFL-Inter.txt` |
| JetBrains Mono (latin, 400/500) | 5.3.0 (Fontsource) | SIL OFL 1.1 | `src/assets/fonts/`; testo in `LICENSES/OFL-JetBrainsMono.txt` |
| Lucide (icone selezionate) | 1.61.0 | ISC (alcune icone MIT, da Feather) | `src/assets/icons/`; testo in `LICENSES/Lucide-ISC-MIT.txt`. `polyline.svg` non e' di Lucide: e' un'icona propria del progetto nello stesso stile |

## Asset di PDF.js copiati nel sito (`pdfjs/` nel build)

Copiati da `node_modules/pdfjs-dist` da `scripts/copy-pdfjs-assets.mjs`; i file `LICENSE_*` restano accanto agli asset.

- `wasm/`: decodificatori JBIG2 e JPEG2000 (PDFium, OpenJPEG) e gestione colore (qcms). Letta solo l'intestazione di ogni licenza: PDFium e OpenJPEG sono di tipo BSD, qcms e' di tipo MIT.
- `standard_fonts/`: font Foxit (PDFium) e Liberation. La licenza di Liberation e' un testo proprio, NON analizzato a fondo.
- `iccs/`: profilo colore ICC.

## Dipendenze di sviluppo (non incluse nel sito)

Vite 8.3.5 (MIT), TypeScript 7.0.2 (Apache-2.0), Vitest 5.0.5 (MIT).
