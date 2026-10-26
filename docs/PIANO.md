# PIANO - Editor PDF con quote (GT-Pdf)

Documento di lavoro: decisioni prese, assegnazione delle funzioni ai checkpoint, punti NON VERIFICATI.
Il design resta in `design/DESIGN.md` (fonte unica). Questo file non lo sostituisce.

## Decisioni (26/10/2026)

| # | Tema | Scelta |
|---|---|---|
| 1 | Libreria di scrittura PDF | `@cantoo/pdf-lib` (MIT) |
| 2 | Stack | TypeScript (strict) + Vite, nessun framework, CSS con i token di `DESIGN.md` |
| 3 | "Salva con nome" | file progetto `.json` (oggetti, scala, nome e hash del PDF originale), in CP5 |
| 4 | Limite DPI in "Appiattito" | tetto provvisorio 16.777.216 px; si decide dopo la misura su iPhone (CP0) |
| 5 | Formato immagini in "Appiattito" | JPEG o PNG: si decide in CP5 con misura |
| 6 | Testo nell'esportazione | Helvetica standard (WinAnsi: Ø, °, ± verificati) |
| 7 | Stop | a ogni checkpoint |
| 8 | Quota Ø / R in V1 | Ø: due punti sul diametro. R: centro + punto sul bordo. Nessuno snap sulla geometria del PDF prima della V3 |
| 9 | Offline | nessun service worker in V1; manifest e icona Home minimi |
| 10 | Hosting | GitHub Pages, deploy con GitHub Actions, percorsi relativi |

Altre scelte operative:
- PDF.js: solo la build `legacy/` (la build normale richiede `Map.getOrInsertComputed`, quindi Safari/iOS 26.2+, senza polyfill).
- Asset PDF.js inclusi: `wasm/` (JBIG2, JPEG2000), `standard_fonts/`, `iccs/`. Esclusi `cmaps/` (CJK), da aggiungere solo se un PDF lo richiede.
- Coordinate degli oggetti: spazio utente PDF (pt, 1/72 in), mai pixel di schermo. Conversione con `convertToPdfPoint` / `convertToViewportPoint` di PDF.js (gestiscono Rotate e CropBox). `userUnit` da considerare.
- Nessun PDF vero nel repository: i PDF di prova sono fittizi e generati da `scripts/make-test-pdfs.mjs`.
- Il tetto dei pixel di canvas e' una costante unica (`src/geometry/pixels.ts`).

## Assegnazione ai checkpoint

**CP0 - Scheletro e diagnostica.** Vite/TS/Vitest, workflow Pages, font e icone nel repository, pagina diagnostica: ambiente e funzioni del browser, apertura PDF, rendering con PDF.js legacy, zoom/pan/pinch di base, prova dei limiti del canvas, prova di condivisione/download. Nessuna funzione di editing.

**CP1 - Interfaccia.** Barra superiore e menu (File: Nuovo, Apri, Chiudi; Modifica, Inserisci, Zoom in forma di struttura), **A-/A+** (dimensione interfaccia, separata dallo zoom del documento), palette strumenti, inspector, barra di stato, lente con mirino, punti con tocchi successivi, zoom del documento.
- Nuovo: azzera la sessione (con conferma se ci sono modifiche) e apre il selettore file. Da confermare in CP1: nessun foglio vuoto.
- Chiudi: chiude il documento senza aprirne un altro.

**CP2 - Scala e disegno.** Calibrazione su due punti, **pulsante Distanza**, retta e linea, **tipi di linea**, **colore e spessore**, annulla/ripeti (command pattern), cancella.

**CP3 - Testo e quote.** Testo, **quote allineata, orizzontale, verticale**, diametro Ø, raggio R, tastierino su schermo (numeri, "." e ",", simboli, lettere). Colore e spessore valgono anche per le quote.

**CP4 - Coperture e selezione.** Coperture bianche (rettangolo, quadrato, cerchio), seleziona/sposta, cancella.

**CP5 - Esportazione.** "Copertura semplice" e "Appiattito" con DPI, Salva con nome (`.json`), Esporta PDF, condivisione/download, README completo.

**V2.** Cerchio, arco, raccordo, **snap sugli oggetti**, copia/duplica, griglia.
**V3.** Snap sulla geometria interna del PDF (fattibilita' da verificare; PDF.js 6.4.299 espone i percorsi ma non i codici interni dei segmenti).

## Dispositivo di prova
iPhone con iOS 27.2 (build 24B5099f), dichiarato dall'utente. La build ha un suffisso a lettera: potrebbe essere una versione di prova, quindi il comportamento puo' cambiare tra aggiornamenti (NON VERIFICATO). Prove su desktop: Chrome e Safari.

## NON VERIFICATO (da chiudere con prove sul dispositivo)
- PDF.js legacy 6.4.299 e `@cantoo/pdf-lib` 2.11.1 su Safari/iOS (provati solo su Chromium desktop).
- Limite di area del canvas e memoria su iOS 27.2. Nel sorgente WebKit `main` (`CanvasBase.cpp`) il limite d'area su iOS e' 8192 x 8192 = 67.108.864 px; la memoria e' un limite separato.
- Condivisione di un PDF con `navigator.share` su iOS attuale; bug WebKit 263608; scadenza del gesto dopo un'elaborazione lunga.
- Comportamento di input file e condivisione da icona Home.
- Il pinch non deve zoomare la pagina (`touch-action: none`): da provare.
- Dimensioni della lente (80x80 px, scostamento 70 px).
- Disegno su pagine con `/Rotate`.
- Snap sulla geometria del PDF (V3).
- Licenza dei font Liberation inclusi in PDF.js (letta solo l'intestazione); incorporamento di font OFL nel PDF.
