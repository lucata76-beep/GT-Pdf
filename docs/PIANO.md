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
- In CP1 l'unico oggetto e' il **punto di prova** (tocchi successivi con lente), non salvato ne' esportato: conta come "modifica" per le conferme. Strumenti e voci di menu delle fasi successive sono presenti ma disabilitati, con il checkpoint accanto. (In CP2 il punto di prova e' stato tolto: la lente e i tocchi successivi servono ora agli strumenti veri.)
- Diagnostica (CP0) raggiungibile da File > Diagnostica (`#diag`); i suoi pulsanti di condivisione/scarico usano un PDF generato dalla pagina, non il documento aperto, e sono rinominati di conseguenza.
- Zoom del documento: 100 % = 96 px CSS per pollice (1 pt = 4/3 px CSS); NON e' la dimensione fisica sullo schermo. A-/A+ cambiano la base `font-size` di `<html>` (5 passi, 14-22 px) e restano nel browser.

**CP2 - Scala e disegno.** Calibrazione su due punti, **pulsante Distanza**, retta e linea, **tipi di linea**, **colore e spessore**, annulla/ripeti (command pattern), cancella.

**CP3 - Testo e quote.** Testo, **quote allineata, orizzontale, verticale**, diametro Ø, raggio R, tastierino su schermo (numeri, "." e ",", simboli, lettere). Colore e spessore valgono anche per le quote.

**CP4 - Coperture e selezione.** Coperture bianche (rettangolo, quadrato, cerchio), seleziona/sposta, cancella.

**CP5 - Esportazione.** "Copertura semplice" e "Appiattito" con DPI, Salva con nome (`.json`), Esporta PDF, condivisione/download, README completo.

**V2.** Cerchio, arco, raccordo, **snap sugli oggetti**, copia/duplica, griglia.
**V3.** Snap sulla geometria interna del PDF (fattibilita' da verificare; PDF.js 6.4.299 espone i percorsi ma non i codici interni dei segmenti).

## Scelte di CP2 (27/10/2026)

Non decise dall'utente: scelta la soluzione piu' semplice coerente con DESIGN.md.

| Tema | Scelta | Perche' |
|---|---|---|
| Retta / Linea | **Retta** = segmento a 2 punti; **Linea** = spezzata a 2 o piu' punti (stesso tipo di dati: `points[]`) | una sola struttura, stessa esportazione in CP5 |
| Calibrazione | strumento **Scala** (palette, o tocco su "SCALA" nella barra di stato): primo punto, secondo punto, poi dialogo con "Distanza reale" in mm, scala 1:N calcolata in tempo reale, Applica/Annulla | e' il dialogo di DESIGN.md; per pagina; annullabile |
| Distanza senza calibrazione | mostra i **mm del foglio** ("Foglio 100.00 mm", "non calibrata") e il messaggio invita a usare Scala | non inventa unita' reali |
| Distanza: risultato | badge sul foglio con `L`, `ΔX`, `ΔY` (X verso destra, Y verso l'alto, con segno); non e' un oggetto, non entra in annulla/ripeti | e' una misura, non un disegno |
| Colori | tavolozza di 8 colori (primi 4 = token di DESIGN.md: rosso `#D32F2F`, blu `#1565C0`, nero `#1E232A`, verde acqua `#00796B`; poi arancio, verde, viola, grigio), tutti >= 3:1 su bianco (test con formula WCAG); in piu' selettore nativo del colore e campo `#RRGGBB` | scelta personalizzata che funziona anche se il selettore nativo non c'e' |
| Colore e spessore predefiniti | rosso `#D32F2F` (colore predefinito delle quote), 1 pt, continua | le linee si distinguono dal disegno nero |
| Spessori | predefiniti 0.25, 0.5, 0.75, 1, 1.5, 2, 3 pt + valore digitabile 0.1-20 pt | in pt del foglio |
| Pattern dei tipi | `u = max(spessore, 0.5 pt)`; tratteggiata `[8u 3u]`; tratto-punto `[12u 3u 1u 3u]`; fase 0; estremita' butt, giunzione miter 10 | proporzioni di progetto (non da una norma); in pt, riusabili in CP5 senza conversioni |
| Cambiare le proprieta' | prima di disegnare (riquadro con la linea in miniatura nella barra contestuale su iPhone; inspector sul desktop) e **"Applica all'ultima linea"** (ultimo oggetto della pagina), annullabile | modificare oggetti qualunque richiede la selezione (CP4) |
| Ortogonale | interruttore **ORTO** nella barra di stato; vale per il punto successivo di Retta, Linea, Scala e Distanza; calcolato nel foglio mostrato (con /Rotate); anteprima e lente mostrano il punto gia' vincolato | come appare sullo schermo |
| Cancella | strumento **Cancella**: tocco fermo su una linea (tolleranza 22 px col dito, 10 col mouse) la cancella; l'oggetto e' evidenziato mentre il dito e' giu'; trascinare sposta la vista; annullabile | non serve la selezione (CP4) |
| Annulla/ripeti | pila unica per documento (command pattern: aggiungi, cancella, proprieta', scala); "Ripeti" si azzera dopo una nuova azione; con una linea in costruzione "Annulla" toglie l'ultimo punto; annullare un'azione di un'altra pagina mostra quella pagina | |
| Fine della Linea | pulsante **Fine**, oppure secondo tocco sullo stesso punto (entro 6 px), oppure Invio | |

## Dispositivo di prova
iPhone con iOS 27.2 (build 24B5099f), dichiarato dall'utente. La build ha un suffisso a lettera: potrebbe essere una versione di prova, quindi il comportamento puo' cambiare tra aggiornamenti (NON VERIFICATO). Prove su desktop: Chrome e Safari.

## Stato CP1 (27/10/2026)
Implementati e provati su Chromium desktop e su Chromium con emulazione iPhone (touch, 390 x 780, DPR 3): interfaccia, menu, A-/A+, zoom, pinch, lente, punti con tocchi successivi, Nuovo/Apri/Chiudi, paginazione, diagnostica rinominata. NESSUNA prova su Safari/iPhone reale: vedere sotto.

## Stato CP2 (27/10/2026)
Implementati e provati su Chromium desktop (mouse) e su Chromium con emulazione iPhone (touch reale via CDP, 390 x 780, DPR 3; anche 780 x 390 e A+ al massimo): scala per pagina, Retta, Linea, tipi di linea, colore, spessore, ortogonale (anche con /Rotate 90 e CropBox), Distanza, annulla/ripeti, Cancella. Prove automatiche: `npm test` (formule di scala, decimali, annulla/ripeti, pattern dei tipi, ortogonale su pagina /Rotate 90 + CropBox, confronto della geometria con PDF.js su pagine vere) e `scripts/e2e-cp2.cjs` (Chromium). NESSUNA prova su Safari/iPhone reale: vedere sotto.

## NON VERIFICATO (da chiudere con prove sul dispositivo)
- CP2 su iPhone: gesto di mira con la lente per Retta/Linea/Scala/Distanza (leggibilita', dito che copre, precisione); selettore colore nativo (`input type=color`) su iOS; tastierino decimale (`inputmode=decimal`) e tastiera che copre il dialogo di scala; layout della barra contestuale e del pannello proprieta' su iPhone reale (barra di Safari, safe area, da icona Home); layout in orizzontale; Cancella con il dito (tolleranza 22 px); doppio tocco per terminare la Linea; colonna dei pulsanti sul foglio ("Distanza" con le altre) che copre il lavoro.
- Disegno su pagine con `/Rotate` e CropBox: provato su Chromium e con i PDF di prova; NON provato con PDF reali, con `UserUnit` diverso da 1 (solo test sulla geometria) ne' su Safari.
- Tratteggi: proporzioni dei pattern scelte a occhio su schermo, non confrontate con una stampa.
- CP1 su iPhone: `input.click()` dal pulsante di conferma del dialogo (Nuovo con modifiche); lente (80x80, 70 px sopra il dito, 3x) leggibile e non coperta dal dito; `drawImage` con zona sorgente parzialmente fuori dal canvas (lente ai bordi della pagina); pinch senza zoom della pagina in modo "Punto di prova"; barre e safe area in verticale e orizzontale; da icona Home.
- PDF.js legacy 6.4.299 e `@cantoo/pdf-lib` 2.11.1 su Safari/iOS (provati solo su Chromium desktop).
- Limite di area del canvas e memoria su iOS 27.2. Nel sorgente WebKit `main` (`CanvasBase.cpp`) il limite d'area su iOS e' 8192 x 8192 = 67.108.864 px; la memoria e' un limite separato.
- Condivisione di un PDF con `navigator.share` su iOS attuale; bug WebKit 263608; scadenza del gesto dopo un'elaborazione lunga.
- Comportamento di input file e condivisione da icona Home.
- Disegno su pagine con `/Rotate`.
- Snap sulla geometria del PDF (V3).
- Licenza dei font Liberation inclusi in PDF.js (letta solo l'intestazione); incorporamento di font OFL nel PDF.
