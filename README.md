# GT-Pdf

Editor PDF con quote (nome provvisorio): web app statica, senza backend. Apre PDF vettoriali e scansioni, li annota e li quota in unità reali **senza mai alterare l'originale**; l'esportazione produce un nuovo file. I file restano sul dispositivo (locale o iCloud, tramite il selettore di sistema). Funziona su iPhone (Safari) e su desktop.

**Stato: CP1 (interfaccia).** Si apre un PDF, lo si guarda con zoom/pinch e si provano la lente e i punti di prova; non c'è ancora nessuna funzione di editing vera (scala, quote, testo, coperture, esportazione arrivano nei checkpoint successivi). La diagnostica di CP0 resta in File > Diagnostica. Piano, decisioni e assegnazione delle funzioni ai checkpoint: [`docs/PIANO.md`](docs/PIANO.md). Design: [`design/DESIGN.md`](design/DESIGN.md).

## Aprire l'app

- Online (GitHub Pages): https://lucata76-beep.github.io/GT-Pdf/ — indirizzo atteso dal formato `<utente>.github.io/<repository>`, da confermare dopo il primo deploy.
- In locale: `npm ci`, poi `npm run dev` (oppure `npm run build && npm run preview`). Richiede Node 22.12 o successivo.

Comandi: `npm run typecheck`, `npm test`, `npm run build`. `npm run test-pdfs` rigenera i PDF di prova, `npm run icons` le icone.

## Provare CP1 su iPhone

Aprire l'indirizzo in Safari (poi, per l'ultima serie, dall'icona Home).
1. **Apri PDF…** (iCloud e "Su questo iPhone"); i PDF di prova fittizi sono sotto "PDF di prova". Pagine multiple: frecce nella barra di stato.
2. **Zoom e pinch**: due dita zoomano solo il foglio (la pagina dell'app non deve ingrandirsi); un dito sposta con "Sposta vista"; pulsanti +, −, Adatta in basso a destra.
3. **A- / A+** in alto: cambiano la dimensione dell'interfaccia, non il documento.
4. **Lente**: scegliere "Punto di prova", tenere premuto sul foglio: appare la lente sopra il dito con mirino; spostando il dito la mira si muove, al rilascio il punto è inserito (elenco con coordinate nel pannello Proprietà, pulsante in alto a destra). Annotare se la lente è leggibile, se il dito la copre, se il punto cade dove punta il mirino.
5. **File > Nuovo** (con almeno un punto: conferma, poi si apre il selettore file), **Apri…**, **Chiudi**.
6. Ripetere dall'icona Home e in orizzontale.

## Provare CP0 (diagnostica) su iPhone — File > Diagnostica

Aprire l'indirizzo in Safari, poi **ripetere tutto dall'icona Home** (Condividi → Aggiungi alla schermata Home). In "Ambiente" la riga *Modalità* dice quale dei due casi si sta usando. In fondo, **Copia registro** copia tutto ciò che serve per riferire i risultati.

1. **Ambiente**: leggere i valori di `Map.getOrInsertComputed` e delle altre funzioni; annotare l'user agent.
2. **PDF**: aprire ogni PDF di prova, poi un PDF vero con *Apri PDF…* (resta sul telefono, nulla viene inviato). Controllare nitidezza, pagina ruotata, CropBox, scansione, navigazione tra le 3 pagine.
3. **Pinch**: due dita sul foglio devono zoomare solo il foglio. Nella riga di stato *zoom pagina* deve restare 1.00 e *max puntatori* deve arrivare a 2. Un dito sposta; un dito fuori dal foglio scorre la pagina.
4. **Limiti del canvas**: eseguire le prove dalla più piccola in su, una alla volta. Per ognuna dire se riesce, quanto ci mette, se Safari ricarica la pagina (la prova interrotta viene segnalata al riavvio). Poi, se si vuole, la sequenza.
5. **Condivisione**: provare tutti i pulsanti. Con *Condividi PDF* scegliere "Salva su File", poi aprire il file da File e verificare che sia un PDF valido. Provare anche *Condividi dopo attesa* (3 s e 6 s): serve a sapere se il gesto scade. Provare entrambi gli scarichi e *Apri in nuova scheda*.
6. **Desktop**: Chrome e Safari, stesse prove (la rotella zooma sotto il puntatore).

## Struttura

```
.github/workflows/deploy.yml   deploy su GitHub Pages (typecheck, test, build)
design/                        design (DESIGN.md = fonte unica) e mockup di riferimento
docs/PIANO.md                  decisioni, checkpoint, punti NON VERIFICATI
LICENSES/, THIRD_PARTY.md      licenze dei componenti inclusi
public/test-pdfs/              PDF di prova FITTIZI (generati da scripts/make-test-pdfs.mjs)
public/icons/, manifest        icone per la schermata Home
scripts/                       generazione PDF di prova e icone, copia asset PDF.js
src/geometry/                  calcoli sui pixel e sulle unità (con test)
src/pdf/                       apertura PDF con PDF.js (build legacy)
src/app/                       guscio dell'app (menu, palette, inspector, barra di stato, sessione)
src/ui/                        DOM, icone, vista del documento (pan, pinch, zoom, lente), menu, dialoghi
src/diag/                      pagina diagnostica (CP0)
src/assets/                    font Inter e JetBrains Mono, icone Lucide
```

## Privacy e repository

Il repository è **pubblico**: non va mai caricato un PDF o un disegno reale. `.gitignore` esclude tutti i `*.pdf` tranne `public/test-pdfs/`, che contiene solo disegni fittizi. L'app non invia nulla in rete e non usa CDN (font, icone e asset di PDF.js sono inclusi). Nessun segreto nel repository.

## Componenti di terze parti

PDF.js (Apache-2.0), @cantoo/pdf-lib (MIT), Inter e JetBrains Mono (OFL 1.1), Lucide (ISC/MIT). Dettagli e versioni in [`THIRD_PARTY.md`](THIRD_PARTY.md).
