# Componenti di terze parti

Versioni e licenze verificate il 26/10/2026 sul registro npm e sui file LICENSE dei pacchetti.
I testi di licenza sono in `LICENSES/`. Nessun componente viene caricato da CDN.

| Componente | Versione | Licenza | Dove |
|---|---|---|---|
| pdfjs-dist (PDF.js, build `legacy/`) | 6.4.299 | Apache-2.0 | dipendenza npm; testo in `LICENSES/pdfjs-Apache-2.0.txt` |
| @cantoo/pdf-lib | 2.11.1 | MIT | dipendenza npm; testo in `LICENSES/cantoo-pdf-lib-MIT.txt` |
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
