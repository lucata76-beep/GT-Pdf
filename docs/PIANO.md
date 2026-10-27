# PIANO - Editor PDF con quote (GT-Pdf)

Documento di lavoro: decisioni prese, assegnazione delle funzioni ai checkpoint, punti NON VERIFICATI.
Il design resta in `design/DESIGN.md` (fonte unica). Questo file non lo sostituisce.

## Decisioni (26-27/10/2026)

| # | Tema | Scelta |
|---|---|---|
| 1 | Libreria di scrittura PDF | `@cantoo/pdf-lib` (MIT) |
| 2 | Stack | TypeScript (strict) + Vite, nessun framework, CSS con i token di `DESIGN.md` |
| 3 | "Salva con nome" | file progetto `.json` (oggetti, scala, nome e hash del PDF originale), in CP5 |
| 4 | Limite DPI in "Appiattito" | **A (27/10)**: tetto 67.108.864 px (8192 x 8192) + controllo dell'ultimo pixel prima di ogni export; i DPI sopra il tetto sono disabilitati (es. A3 a 600 dpi = 69.605.736 px) |
| 5 | Formato immagini in "Appiattito" | JPEG o PNG: **aperta**, si misura in CP5 |
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
- I tetti dei pixel sono costanti in `src/geometry/pixels.ts`: `PIXEL_BUDGET` = 67.108.864 (esportazione, decisione 4) e `SCREEN_PIXEL_BUDGET` = 16.777.216 (canvas a schermo, scelta di CP1 prudente, NON misurata nell'app reale: a schermo restano in memoria due canvas durante il rinnovo).

## Esito CP0 (iPhone, Safari in scheda, iOS 27.2, dichiarato dall'utente)
- Canvas: riesce fino a 67,11 M px (8192 x 8192); a 69,61 M px fallisce in silenzio (pixel letto 0,0,0,0).
- `share()` con file PDF: riesce se chiamata subito dal tocco; dopo 6 s `NotAllowedError`. Quindi in CP5: generare il PDF **prima**, condividere dal tocco.
- Scarico: `application/octet-stream` salva in Download; `application/pdf` apre il PDF senza salvare.
- Pinch, apertura da iCloud e da "Su questo iPhone": ok.
- Icona Home: la pagina si apre a schermo intero; le prove di dettaglio restano NON VERIFICATE.

## Assegnazione ai checkpoint

**CP0 - Scheletro e diagnostica.** Vite/TS/Vitest, workflow Pages, font e icone nel repository, pagina diagnostica: ambiente e funzioni del browser, apertura PDF, rendering con PDF.js legacy, zoom/pan/pinch di base, prova dei limiti del canvas, prova di condivisione/download. Nessuna funzione di editing.

**CP1 - Interfaccia.** Barra superiore e menu (File: Nuovo, Apri, Chiudi; Modifica, Inserisci, Zoom in forma di struttura), **A-/A+** (dimensione interfaccia, separata dallo zoom del documento), palette strumenti, inspector, barra di stato, lente con mirino, punti con tocchi successivi, zoom del documento.
- Nuovo: azzera la sessione (con conferma se ci sono modifiche) e apre il selettore file. Confermato: nessun foglio vuoto. Se si annulla il selettore, la sessione resta azzerata.
- Chiudi: chiude il documento senza aprirne un altro.
- Apri: il documento attuale resta finche' il nuovo non e' stato letto con successo.
- In CP1 l'unico oggetto e' il **punto di prova** (tocchi successivi con lente), non salvato ne' esportato: conta come "modifica" per le conferme. Strumenti e voci di menu delle fasi successive sono presenti ma disabilitati, con il checkpoint accanto.
- Diagnostica (CP0) raggiungibile da File > Diagnostica (`#diag`); i suoi pulsanti di condivisione/scarico usano un PDF generato dalla pagina, non il documento aperto, e sono rinominati di conseguenza.
- Zoom del documento: 100 % = 96 px CSS per pollice (1 pt = 4/3 px CSS); NON e' la dimensione fisica sullo schermo. A-/A+ cambiano la base `font-size` di `<html>` (5 passi, 14-22 px) e restano nel browser.

**CP2 - Scala e disegno.** Calibrazione su due punti, **pulsante Distanza**, retta e linea, **tipi di linea**, **colore e spessore**, annulla/ripeti (command pattern), cancella.

**CP3 - Testo e quote.** Testo, **quote allineata, orizzontale, verticale**, diametro Ø, raggio R, tastierino su schermo (numeri, "." e ",", simboli, lettere). Colore e spessore valgono anche per le quote.

**CP4 - Coperture e selezione.** Coperture bianche (rettangolo, quadrato, cerchio), seleziona/sposta, cancella.

**CP5 - Esportazione.** "Copertura semplice" e "Appiattito" con DPI, Salva con nome (`.json`), Esporta PDF, condivisione/download, README completo.

**V2.** Cerchio, arco, raccordo, **snap sugli oggetti**, copia/duplica, griglia.
**V3.** Snap sulla geometria interna del PDF (fattibilita' da verificare; PDF.js 6.4.299 espone i percorsi ma non i codici interni dei segmenti).

## Dispositivo di prova
iPhone con iOS 27.2 (build 24B5099f), dichiarato dall'utente. La build ha un suffisso a lettera: potrebbe essere una versione di prova, quindi il comportamento puo' cambiare tra aggiornamenti (NON VERIFICATO). Prove su desktop: Chrome e Safari.

## Stato CP1 (27/10/2026)
Implementati e provati su Chromium desktop e su Chromium con emulazione iPhone (touch, 390 x 780, DPR 3): interfaccia, menu, A-/A+, zoom, pinch, lente, punti con tocchi successivi, Nuovo/Apri/Chiudi, paginazione, diagnostica rinominata. NESSUNA prova su Safari/iPhone reale: vedere sotto.

## NON VERIFICATO (da chiudere con prove sul dispositivo)
- CP1 su iPhone: `input.click()` dal pulsante di conferma del dialogo (Nuovo con modifiche); lente (80x80, 70 px sopra il dito, 3x) leggibile e non coperta dal dito; `drawImage` con zona sorgente parzialmente fuori dal canvas (lente ai bordi della pagina); pinch senza zoom della pagina in modo "Punto di prova"; barre e safe area in verticale e orizzontale; da icona Home.
- PDF.js legacy 6.4.299 e `@cantoo/pdf-lib` 2.11.1 su Safari/iOS (provati solo su Chromium desktop).
- Limite di area del canvas e memoria su iOS 27.2. Nel sorgente WebKit `main` (`CanvasBase.cpp`) il limite d'area su iOS e' 8192 x 8192 = 67.108.864 px; la memoria e' un limite separato.
- Condivisione di un PDF con `navigator.share` su iOS attuale; bug WebKit 263608; scadenza del gesto dopo un'elaborazione lunga.
- Comportamento di input file e condivisione da icona Home.
- Disegno su pagine con `/Rotate`.
- Snap sulla geometria del PDF (V3).
- Licenza dei font Liberation inclusi in PDF.js (letta solo l'intestazione); incorporamento di font OFL nel PDF.
