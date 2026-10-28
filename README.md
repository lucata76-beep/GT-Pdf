# GT-Pdf

Editor PDF con quote (nome provvisorio): web app statica, senza backend. Apre PDF vettoriali e scansioni, li annota e li quota in unità reali **senza mai alterare l'originale**; l'esportazione produce un nuovo file. I file restano sul dispositivo (locale o iCloud, tramite il selettore di sistema). Funziona su iPhone (Safari) e su desktop.

**Stato: CP4 (coperture e selezione).** Si apre un PDF, si calibra la scala di ogni pagina, si disegnano rette e linee (continue, tratto-punto, tratteggiate; colore e spessore a scelta; ortogonale), si misurano le distanze in unità reali, si scrivono **testi** e si mettono **quote** (allineata, orizzontale, verticale, diametro Ø, raggio R) con valore automatico dalla scala o digitato, con un **tastierino su schermo**; si mettono **coperture bianche** (rettangolo, quadrato, cerchio) che nascondono il disegno sotto e stanno sempre sotto linee, quote e testi; con **Seleziona** si tocca un oggetto, lo si sposta trascinandolo e se ne cambiano le proprietà; si annulla/ripete e si cancella. Gli oggetti vivono in memoria nella sessione: non c'è ancora salvataggio né esportazione (CP5). Il menu File ha Apri, Salva con nome (CP5), Esporta PDF (CP5), Chiudi. La diagnostica di CP0 resta in File > Diagnostica. Piano, decisioni e assegnazione delle funzioni ai checkpoint: [`docs/PIANO.md`](docs/PIANO.md). Design: [`design/DESIGN.md`](design/DESIGN.md).

## Aprire l'app

- Online (GitHub Pages): https://lucata76-beep.github.io/GT-Pdf/ — indirizzo atteso dal formato `<utente>.github.io/<repository>`, da confermare dopo il primo deploy.
- In locale: `npm ci`, poi `npm run dev` (oppure `npm run build && npm run preview`). Richiede Node 22.12 o successivo.

Comandi: `npm run typecheck`, `npm test`, `npm run build`. `npm run test-pdfs` rigenera i PDF di prova, `npm run icons` le icone, `npm run helvetica-widths` la tabella delle larghezze di Helvetica. Prove su Chromium (mouse e touch iPhone emulato): `npm run build && node scripts/e2e-cp4.cjs` (coperture, seleziona, sposta), `node scripts/e2e-cp3.cjs` (testo, quote, tastierino) e `node scripts/e2e-cp2.cjs` (disegno, scala); richiedono Playwright con Chromium installati (non sono una dipendenza del progetto).

## Provare CP4 su iPhone

Aprire l'indirizzo in Safari. Controllare la versione: icona del pannello in alto a destra, in fondo "App · Versione" = commit pubblicato (se è diversa, Safari mostra file vecchi: ricaricare). Aprire **A4 vettoriale** da "PDF di prova". Tutto quello che segue è stato provato **solo su Chromium** (anche con tocco emulato): su iPhone è **NON VERIFICATO**, quindi ogni punto va riferito (va / non va, e cosa).

**Parte A - CP4**
1. **Barra degli strumenti**: in basso ci sono 9 voci (Sposta vista, Seleziona, Retta, Linea, Scala, Cancella, Quota, Testo, Copertura); *Distanza* sta nei pulsanti sul foglio. La barra scorre con un dito. **Quando cambia lo strumento (anche dal menu o dal pulsante SCALA della barra di stato) la barra scorre da sola fino al pulsante attivo, che deve restare tutto in vista.** Provare: *Inserisci > Copertura rettangolare*, poi *Modifica > Seleziona / sposta*, poi *Inserisci > Testo*, *Quota allineata*, *Modifica > Cancella*, e il pulsante *SCALA*: ogni volta il pulsante attivo è intero in vista? La barra scorre in modo brusco o fluido, e se la si scorre a mano resta dove la si lascia?
2. **Copertura rettangolare**: *Copertura*, forma *Rettangolo*. Tenere premuto sul foglio, mirare con la lente, rilasciare: primo angolo. Muovere il dito per il secondo angolo: compare il **contorno azzurro sottile** e il riempimento bianco; rilasciare. Ora il rettangolo è **bianco, senza contorno**. Coprire il segmento "RIFERIMENTO 100 mm" in basso a sinistra: deve sparire. *Annulla* (freccia in alto): riappare; *Ripeti*: sparisce.
3. **Quadrato**: forma *Quadrato*. Primo punto = un angolo; il secondo indica **direzione e misura**: il lato è il maggiore tra lo spostamento orizzontale e quello verticale, e il contorno (e il mirino) mostrano già il quadrato. Provare a muovere il dito su e giù e a sinistra: il quadrato cresce verso il dito.
4. **Cerchio**: forma *Cerchio*. Centro, poi un punto sul bordo.
5. **Sotto a tutto**: disegnare una *Retta* e scrivere un *Testo*, poi coprirli con una copertura: la copertura deve stare **sotto** (retta e testo restano visibili). Poi la copertura sul disegno del PDF: lo nasconde.
6. **Seleziona**: *Seleziona*, toccare una retta: alone azzurro e, nella barra sopra la barra di stato, "Selezionata: Retta". Toccare appena accanto alla retta (la tolleranza col dito è 22 px CSS): deve selezionare ancora; toccare nettamente più lontano: deseleziona. Annotare a che distanza dal dito smette di funzionare. Toccare una copertura: cornice sottile. Dentro una copertura, vicino a una retta: vince la **retta** (in primo piano).
7. **Spostare**: con un oggetto selezionato, appoggiare il dito su di lui e trascinare: lo segue; rilasciare. *Annulla* lo rimette dov'era in **un solo** passo; *Ripeti* lo sposta di nuovo. Trascinare **altrove** (non sull'oggetto selezionato): si sposta la vista, l'oggetto resta. Durante il trascinamento appoggiare un **secondo dito**: lo spostamento si annulla e si passa allo zoom a due dita. Annotare: il dito copre troppo l'oggetto? Il tocco è preciso?
8. **Il foglio non deve "saltare"**: selezionare e deselezionare un oggetto a pagina intera: il foglio non deve cambiare dimensione né posizione.
9. **Quota spostata**: calibrare la scala (*Scala*, i due estremi del segmento da 100 mm, `100`), mettere una quota *Orizz.* (tre punti, OK al valore automatico), poi *Seleziona*, toccare la linea di quota e trascinarla: la quota si sposta intera (linee, frecce, etichetta) e il **valore resta lo stesso**.
10. **Proprietà di un oggetto**: *Seleziona* una retta: nella barra compare il riquadro con la linea in miniatura; toccarlo e cambiare tipo, colore, spessore: cambia **quella** retta (e *Annulla* la ripristina); una nuova retta ha ancora le proprietà di prima. Una copertura selezionata non ha il riquadro. Un testo: colore e altezza. Una quota: colore, spessore, altezza.
11. **Cancella** una copertura (*Cancella*, toccarla): sparisce; *Annulla* la rimette. *Esc* non c'è su iPhone: per deselezionare toccare uno spazio vuoto.
12. **Pagina /Rotate 90** ("A4 con /Rotate 90"): una copertura e un trascinamento vanno "come si vedono" (a destra è a destra sullo schermo).
13. **Colonna di pulsanti sul foglio**: ora è larga 46 px (*Distanza* è solo l'icona del righello; il nome resta come etichetta per VoiceOver). A pagina intera copre il 12 % della larghezza e il 36 % dell'altezza del foglio (prima 27 % e 36 %). Annotare: l'icona di Distanza si riconosce senza il nome? **Un tocco sul foglio sotto la colonna finisce ancora sul pulsante** (previsto): quanto dà fastidio? Ruotare l'iPhone in orizzontale: la colonna diventa una riga in basso a destra; con la pagina ingrandita copre il foglio?
13b. **iPhone in orizzontale, i menu**: ruotare l'iPhone, aprire *Inserisci*: il menu è più alto dello schermo e **scorre** trascinandolo con un dito. Tutte le voci si raggiungono (*Quota raggio R*, le tre coperture, *Cerchio, arco, raccordo*)? Toccare *Copertura circolare* in fondo: si attiva *Copertura* con *Cerchio*. Provare anche *Modifica*, *File*, *Zoom*, e con *A+* al massimo. Annotare: le voci sono grandi abbastanza (44 px)? Il trascinamento del menu muove qualcosa dietro (la pagina, il foglio)? Il fondo del menu è coperto dalla barra di Safari o dall'indicatore Home? In verticale il menu non deve cambiare (entra intero, senza scorrere).

**Parte B - riserve di CP3**
14. **Da icona Home**: *Condividi → Aggiungi alla schermata Home*, aprire l'app dall'icona (non da Safari). Ripetere i punti 2, 6, 7 e un testo con il tastierino. Annotare: barre e tastierino rispetto al bordo basso e ai lati (safe area), il tastierino non copre il punto, la tastiera di iOS non compare.
15. **Tastierino in orizzontale con la barra di Safari** (da Safari, non dall'icona): ruotare l'iPhone, *Testo*, toccare un punto: il tastierino sta a destra. La vista è più bassa di quella emulata: l'ultima riga di tasti si raggiunge? I tasti si toccano bene? Provare con le lettere e con i numeri.
16. **A+**: premere *A+* finché si spegne (interfaccia più grande). Controllare: le tre forme della copertura, i cinque tipi di quota e il tastierino restano interi nella larghezza? Qualcosa esce dallo schermo?
17. **Pagina /Rotate 90**: "A4 con /Rotate 90": calibrare (i due estremi del segmento da 100 mm), una quota *Orizz.* e una *Vert.* devono misurare quello che si vede; un *Testo* resta dritto sul foglio.
18. **Precisione della scala**: su "A4 vettoriale" ingrandire (due dita) il segmento da 100 mm e calibrarlo (`100`). Poi misurare con *Quota Ø* il **cerchio grande** puntando i due punti dove l'asse orizzontale (tratto-punto) lo attraversa, a sinistra e a destra: valore atteso **113.40** (diametro 113,4 mm). Ripetere con *Distanza* sullo stesso segmento da 100 mm: atteso circa 100.00. Annotare il valore letto e se serve la lente / lo zoom.

**Parte C - CP4.6**
19. **Etichetta della scala per l'ingrandimento (N < 1)**. Su "A4 vettoriale" ingrandire (due dita) il segmento "RIFERIMENTO 100 mm" (100 mm esatti sul foglio). *Scala*, toccare le due estremità, nel dialogo digitare **25** (reali): il dialogo mostra *Nuova scala: 4:1* (se i due punti non sono precisi, per esempio 3.98:1 o 4.02:1). *Applica*: in basso *SCALA: 4:1*; nel pannello in alto a destra *Scala* 4:1; il messaggio dice "Scala della pagina 1: 4:1". Ricalibrare con **100**: *1:1*. Con **200**: *1:2* (riduzione, formato di prima). Valori attesi con questo segmento: reali 25 → **4:1**, 100 → **1:1**, 200 → **1:2** (N = reale / foglio = 0.25, 1, 2; M = foglio / reale = 4). Le etichette cambiano soltanto nel testo: con la scala 25, *Distanza* tra le due estremità del segmento deve dare **circa 25 mm** (L ≈ 25.00) e una *Quota orizzontale* sullo stesso segmento **circa 25.xx**, come con qualunque altra etichetta.
20. **Ricalibrare mostra il formato nuovo**: con la scala *4:1* applicata, riaprire *Scala* sugli stessi punti: il dialogo dice *Scala attuale della pagina* 4:1.

Riferire per ogni punto che cosa non va (taglia dei tasti, tocchi persi, zone coperte, errori).

## Provare CP3 su iPhone

Aprire l'indirizzo in Safari (poi, per l'ultima serie, dall'icona Home). Controllare la versione: icona del pannello in alto a destra, in fondo "App · Versione" = commit pubblicato. Aprire **A4 vettoriale** da "PDF di prova".
1. **Testo**: in basso toccare *Testo* (scorrere la barra degli strumenti se serve). Tenere premuto sul foglio: lente col mirino; rilasciare dove inizia il testo (angolo in basso a sinistra). Compare il **tastierino in basso**: barra superiore, strumenti, stato e pulsanti sul foglio spariscono e il foglio resta sopra. Annotare: il punto resta visibile? Il foglio è abbastanza alto? I tasti si toccano bene? La tastiera di iOS NON deve comparire.
2. Scrivere `FORO`: i tasti sono le lettere; toccare *Ø*, poi *123 NUMERI*, `8`, *±*, `0` `.` `1`, *°*. Il testo compare in rosso sul foglio mentre si scrive; ⌫ cancella l'ultimo carattere; *abc* passa alle minuscole; *#$& SIMBOLI* apre i simboli. **OK** conferma; **Annulla** scarta.
3. **Altezza del testo**: toccare il riquadro `Aa 10 pt` nella barra sopra la barra di stato, scegliere 14 e scrivere un altro testo. Per cambiare un testo già scritto: *Seleziona* (vedi CP4).
4. **Scala**: strumento *Scala*, toccare le due estremità del segmento di 100 mm, digitare `100` (o `100,5`) e *Applica*.
5. **Quota**: strumento *Quota*; la barra mostra i cinque tipi. *Orizz.*: toccare due punti, poi un terzo dove deve stare la linea di quota (lente per ogni punto). Compare il tastierino (numeri) con il **valore automatico selezionato** (es. `102.31`): **OK** lo accetta; oppure toccare un numero, che lo sostituisce. Lo stesso per *Allineata* e *Vert.* (sul foglio come si vede). *Ø Diam.*: due punti opposti sul diametro; *R Raggio*: centro e poi un punto sul bordo (valore con prefisso Ø o R).
6. **Senza scala** (altra pagina, per esempio con le 3 pagine miste): la quota non propone un valore: il tastierino chiede di digitarlo.
7. **Annulla/Ripeti** (frecce in alto) per testi e quote; **Cancella** (barra degli strumenti): appoggiare il dito su un testo o su una quota la evidenzia, rilasciare la cancella. **Ricalibrare** la scala: le quote automatiche cambiano, quelle digitate no.
8. **Tastierino con zoom**: ingrandire con due dita, scegliere *Testo* e toccare vicino al bordo inferiore del foglio: il tastierino riduce la vista ma il punto deve restare visibile sopra di esso.
9. **iPhone in orizzontale** e rotazione con il tastierino aperto: il tastierino sta a destra, il punto resta visibile. Provare anche con **A+**.
10. **Pagina ruotata**: aprire *A4 con /Rotate 90*, calibrare e provare quota orizzontale e Testo: "orizzontale" è quello che si vede.
11. Tutto da icona Home.

Riferire per ogni punto che cosa non va (taglia dei tasti, tocchi persi, zone coperte, errori).

## Provare CP2 su iPhone

Aprire l'indirizzo in Safari (poi, per l'ultima serie, dall'icona Home). Prima di tutto controllare la versione: icona del pannello in alto a destra, in fondo "App · Versione": deve coincidere con il commit pubblicato (se è diversa, Safari sta mostrando file vecchi: ricaricare).
1. **Apri PDF…**, poi dai "PDF di prova" scegliere **A4 vettoriale**. In basso a sinistra del foglio c'è il segmento "RIFERIMENTO 100 mm" (misura esatta di 100 mm).
2. **Retta**: in basso toccare *Retta*. Tenere premuto sul foglio: appare la lente col mirino; muovere il dito per mirare, rilasciare: il primo punto è inserito (segno azzurro). Mentre si mira il secondo punto la retta compare in anteprima. Rilasciare: la retta rossa è creata. Annotare: la lente si legge? il dito la copre? il punto cade dove punta il mirino?
3. **Linea**: *Linea*, toccare tre o quattro punti, poi **Fine** (oppure toccare due volte l'ultimo punto).
4. **Tipo, colore, spessore**: toccare il riquadro con la linea in miniatura ("1 pt") nella barra sopra la barra di stato. Scegliere *Tratteggiata* o *Tratto-punto*, un colore (anche il selettore o il campo `#RRGGBB`), uno spessore (anche digitato: prova `0,5` con la virgola e un valore non valido come `abc`: deve comparire un messaggio). Disegnare una nuova linea: ha le proprietà scelte (per cambiare una linea già disegnata: *Seleziona*, vedi CP4).
5. **ORTO**: toccare *ORTO* in basso (diventa arancio). Disegnare una retta quasi orizzontale: lente e anteprima mostrano già il punto allineato. Ripetere con il PDF di prova **A4 con /Rotate 90**: "orizzontale" è quello che si vede sullo schermo.
6. **Scala**: *Scala*; toccare le due estremità del segmento di 100 mm (conviene prima zoomare con due dita), nel dialogo digitare `100` (o `100,5`) e *Applica*. In basso compare `SCALA: 1:…` (circa 1:1). La scala vale per la pagina: con **3 pagine miste** ogni pagina ha la sua.
7. **Distanza**: pulsante *Distanza* sul foglio (colonna in basso a destra). Due punti: il badge mostra `L`, `ΔX`, `ΔY` in mm reali. Su una pagina non calibrata mostra "Foglio … mm / non calibrata".
8. **Annulla/Ripeti**: frecce in alto. *Ripeti* si spegne dopo una nuova azione. Con una linea a metà, *Annulla* toglie l'ultimo punto.
9. **Cancella**: *Cancella* (ultima icona visibile nella barra degli strumenti). Appoggiare il dito su una linea: si evidenzia; rilasciare: è cancellata. *Annulla* la ripristina. Trascinare sposta la vista senza cancellare.
10. **A- / A+**, rotazione in orizzontale, e tutto da icona Home.

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
scripts/                       generazione PDF di prova, icone e tabella Helvetica, copia asset PDF.js, prove Chromium (e2e-cp2.cjs, e2e-cp3.cjs, e2e-cp4.cjs)
src/geometry/                  pixel, unità, scala, geometria di pagina (Rotate/CropBox), ortogonale, misura, quote, coperture, layout di testi e quote, scelta con un tocco, metriche Helvetica (con test)
src/model/                     oggetti (linee, testi, quote, coperture), ordine di disegno, sposta, tipi di linea, colore, spessore, altezza testo, annulla/ripeti (con test)
src/pdf/                       apertura PDF con PDF.js (build legacy)
src/app/                       guscio dell'app (menu, palette, inspector, barre, sessione) e costruzione per punti
src/ui/                        DOM, icone, vista del documento (pan, pinch, zoom, lente), livello di disegno, menu, dialoghi, tastierino
src/diag/                      pagina diagnostica (CP0)
src/assets/                    font Inter e JetBrains Mono, icone Lucide
```

## Privacy e repository

Il repository è **pubblico**: non va mai caricato un PDF o un disegno reale. `.gitignore` esclude tutti i `*.pdf` tranne `public/test-pdfs/`, che contiene solo disegni fittizi. L'app non invia nulla in rete e non usa CDN (font, icone e asset di PDF.js sono inclusi). Nessun segreto nel repository.

## Componenti di terze parti

PDF.js (Apache-2.0), @cantoo/pdf-lib (MIT), Inter e JetBrains Mono (OFL 1.1), Lucide (ISC/MIT). Dettagli e versioni in [`THIRD_PARTY.md`](THIRD_PARTY.md).
