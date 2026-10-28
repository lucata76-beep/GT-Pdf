# GT-Pdf

Editor PDF con quote (nome provvisorio): web app statica, senza backend. Apre PDF vettoriali e scansioni, li annota e li quota in unità reali **senza mai alterare l'originale**; l'esportazione produce un nuovo file. I file restano sul dispositivo (locale o iCloud, tramite il selettore di sistema). Funziona su iPhone (Safari) e su desktop.

**Stato: CP5b (esportazione in "Copertura semplice" e "Appiattito").** Si apre un PDF, si calibra la scala di ogni pagina, si disegnano rette e linee (continue, tratto-punto, tratteggiate; colore e spessore a scelta; ortogonale), si misurano le distanze in unità reali, si scrivono **testi** e si mettono **quote** (allineata, orizzontale, verticale, diametro Ø, raggio R) con valore automatico dalla scala o digitato, con un **tastierino su schermo**; si mettono **coperture bianche** (rettangolo, quadrato, cerchio) che stanno sempre sotto linee, quote e testi; con **Seleziona** si tocca un oggetto, lo si sposta e se ne cambiano le proprietà; si annulla/ripete e si cancella. Con **File > Esporta PDF** si crea un **nuovo PDF** (`<nome>-quotato.pdf`) con gli oggetti scritti nel contenuto delle pagine che ne hanno: in **"Copertura semplice"** il testo sotto le coperture resta nel file, in **"Appiattito"** le pagine con oggetti diventano un'immagine (DPI 150, 300 o 600; JPEG o PNG) e il testo sotto sparisce davvero; poi lo si **condivide** (foglio di condivisione, per "Salva su File") o lo si **scarica**. L'originale non viene mai modificato. Gli oggetti vivono in memoria nella sessione: il salvataggio del progetto (`.json`) arriva in 5c: **fino ad allora chiudere o ricaricare la pagina fa perdere gli oggetti** (e le prove pesanti di "Appiattito" su iPhone possono far ricaricare Safari). Il menu File ha Apri, Salva con nome (5c), Esporta PDF, Chiudi. La diagnostica di CP0 resta in File > Diagnostica. Piano, decisioni e assegnazione delle funzioni ai checkpoint: [`docs/PIANO.md`](docs/PIANO.md). Design: [`design/DESIGN.md`](design/DESIGN.md).

## Aprire l'app

- Online (GitHub Pages): https://lucata76-beep.github.io/GT-Pdf/ — indirizzo atteso dal formato `<utente>.github.io/<repository>`, da confermare dopo il primo deploy.
- In locale: `npm ci`, poi `npm run dev` (oppure `npm run build && npm run preview`). Richiede Node 22.12 o successivo.

Comandi: `npm run typecheck`, `npm test`, `npm run build`. `npm run test-pdfs` rigenera i PDF di prova, `npm run icons` le icone, `npm run helvetica-widths` la tabella delle larghezze di Helvetica. Prove su Chromium (mouse e touch iPhone emulato): `node scripts/e2e-cp5b.cjs` (esportazione Appiattito; costruisce da solo un build di prova) e `node scripts/e2e-cp5a.cjs` (Copertura semplice, Condividi/Scarica), `node scripts/measure-cp5b.cjs` (misure di 5b), `npm run build && node scripts/e2e-cp4.cjs` (coperture, seleziona, sposta), `node scripts/e2e-cp3.cjs` (testo, quote, tastierino) e `node scripts/e2e-cp2.cjs` (disegno, scala); richiedono Playwright con Chromium installati (non sono una dipendenza del progetto). Esportazione (CP5a): `node scripts/e2e-cp5a.cjs [cartella]` costruisce da solo un build di prova con il gancio `window.__gtpdf` (`GTPDF_TEST=1`, fuori dal repository: il build pubblicato non lo contiene), esporta e confronta l'app con il PDF esportato reso da PDF.js, salvando le immagini nella cartella indicata (fuori dal repository); `node scripts/perf-cp5a.cjs [cartella]` misura tempo e memoria su un PDF sintetico a 124 pagine che genera da sé. Su Linux con locale POSIX lanciare con `LC_ALL=C.UTF-8` (Chromium sostituisce i nomi di file con caratteri non ASCII con "download"; lo script lo imposta da solo).

## Provare CP5b su iPhone

Aprire l'indirizzo in Safari. Controllare la versione: icona del pannello in alto a destra, in fondo "App · Versione" = commit pubblicato (se è diversa, Safari mostra file vecchi: ricaricare). Tutto quello che segue è stato provato **solo su Chromium desktop**: su iPhone è **NON VERIFICATO**, quindi ogni punto va riferito (va / non va, e cosa).

> **Attenzione: sono prove pesanti. Usare solo gli oggetti di prova.** Il lavoro (oggetti, scala) esiste **solo in memoria** fino a 5c (non c'è ancora "Salva con nome"): se Safari ricarica la pagina, **gli oggetti messi spariscono**. In "Appiattito" ogni pagina diventa un canvas grande (A4 a 600 dpi: 34.806.376 px x 4 byte = circa 139 MB di bitmap: calcolo, non misurato su iPhone) e Safari potrebbe **ricaricare la pagina** o chiudere la scheda: è **NON VERIFICATO** (CP0 ha provato su iPhone solo canvas a colore piatto, non canvas con un disegno e non la codifica JPEG/PNG). Per questo si parte dai DPI bassi e si sale. Se la pagina si ricarica, riferire a quale prova è successo.

Per ogni prova: **File > Esporta PDF…**, scegliere **Appiattito**, scegliere DPI e formato, **Esporta**, poi **Scarica** (o **Condividi** e *Salva su File*) e aprire il file da **File**. Atteso nel dialogo: *Risoluzione* (150, 300, 600 dpi) e *Formato delle immagini* (JPEG, PNG); il riepilogo con `Pagine appiattite M di N` e `Pagina più grande` (pixel); il riquadro **Prima di esportare** con gli avvisi (il testo non sarà più selezionabile, i collegamenti spariscono, le annotazioni e i campi diventano parte dell'immagine come li disegna PDF.js, le pagine senza oggetti restano identiche, le immagini restano in memoria fino alla fine); durante il lavoro `Pagina 1 di 1` e la riga `Pagina 1 del PDF · 300 dpi · JPEG · immagini finora …`; alla fine **PDF pronto** con `Immagini inserite` e `Vecchio contenuto tolto`.

1. **Preparazione.** Aprire **A4 vettoriale** da "PDF di prova". Calibrare la scala (*Scala*, i due estremi del segmento "RIFERIMENTO 100 mm", `100`). Mettere pochi oggetti: una *Retta*, una *Quota Ø* con il valore automatico, un *Testo* `FORO Ø8 ±0.1 90°` e una **copertura rettangolare sul titolo** "DISEGNO FITTIZIO - GT-Pdf".
2. **A4 vettoriale, 150 dpi, JPEG.** Atteso: tutti e tre i DPI attivi (A4 a 150: 1240 × 1754 px = 2.174.960 px). Aprire da File: si vedono scala, quote, testo; il titolo sotto la copertura **non si vede e non si può selezionare né cercare** (provare a selezionare il testo e a cercare "DISEGNO"). Riferire il tempo da *Esporta* a *PDF pronto* e la dimensione.
3. **A4 vettoriale, 300 dpi, JPEG, poi PNG.** (2480 × 3508 px = 8.699.840 px.) Confrontare dimensione del file e tempo: il PNG è più grande. Riferire se le linee sottili sono nitide.
4. **A4 vettoriale, 600 dpi, JPEG, poi PNG** (4961 × 7016 px = **34.806.376 px**): la prova più pesante di un A4. Atteso: lavora qualche secondo e finisce; se compare **"Immagine troppo grande per questo dispositivo"** è il controllo dell'ultimo pixel (il dispositivo non ha creato il canvas): riferire il testo completo (c'è il numero di pagina e di pixel); **nulla è perso** e si può scegliere un DPI più basso con *Riprova*. Se invece **la pagina si ricarica o la scheda si chiude**, riferirlo (e che gli oggetti sono spariti).
5. **A3 vettoriale (A3 in orizzontale).** A **300 dpi** (4961 × 3508 px = **17.403.188 px**) deve esportare. A **600 dpi** deve risultare **disabilitato** (grigio, non si può toccare) con scritto sotto `Pagina 1 (A3) a 600 dpi: 69.605.736 px, oltre 67.108.864`. Riferire se è così.
6. **A4 scansione (immagine).** 150 e 300 dpi, JPEG e PNG. La pagina è una sola immagine in grigi (150 dpi): confrontare dimensione e tempo tra JPEG e PNG. Da File: il disegno della scansione e gli oggetti devono stare al loro posto.
7. **A4 con /Rotate 90.** Con un oggetto, 150 dpi JPEG: da File la pagina è nello stesso verso dell'app e gli oggetti sono al posto giusto (provato su Chromium anche con CropBox e UserUnit 2.5).
8. **3 pagine miste** (A4, A3, A4 ruotata) con oggetti **solo sulla pagina 2**: scegliere 300 dpi. Atteso: `Pagine appiattite 1 di 3`; da File le pagine 1 e 3 sono **identiche** all'originale (testo ancora selezionabile) e la 2 è un'immagine.
9. **A4 con annotazioni** (PDF di prova fittizio nuovo: un timbro rosso, un campo di testo compilato, una casella spuntata e un collegamento sul titolo). Aprirlo, mettere una copertura sul titolo e una su metà del timbro, esportare **Appiattito** a 150 dpi. Atteso: timbro, campo e casella **diventano parte dell'immagine** (la copertura nasconde la parte di timbro che copre, come nell'app); il campo **non è più compilabile**; il collegamento sul titolo **non funziona più** (e nel file non c'è più l'indirizzo). Riferire come si comporta File (provato su Chromium; Safari/File NON VERIFICATO).
10. **Errore dell'ultimo pixel** (solo se capita): riferire a quale DPI, il testo e se *Riprova* con un DPI più basso funziona.
11. **Esporta "Copertura semplice"** come in CP5a (stessa prova del punto 3 di CP5a): non deve essere cambiata.
12. **Da icona Home** (*Condividi → Aggiungi alla schermata Home*): ripetere i punti 2 e 4.

**Numeri da riferire** (in "PDF pronto": `Dimensione`, `Immagini inserite`, `Tempo`; più un cronometro dal tocco su *Esporta* a "PDF pronto" se si vuole il tempo reale). Per confronto, i valori misurati su **Chromium desktop (NON iPhone)** con 19 oggetti di prova su un A4 (`docs/PIANO.md`, "Misure per la decisione 5"):

| prova | pixel | JPEG: dimensione, tempo | PNG: dimensione, tempo |
|---|---|---|---|
| A4 vettoriale 150 dpi | 2.174.960 | 0.09 MB, 0.4 s | 0.15 MB, 0.4 s |
| A4 vettoriale 300 dpi | 8.699.840 | 0.24 MB, 0.4 s | 0.38 MB, 0.4 s |
| A4 vettoriale 600 dpi | 34.806.376 | 0.62 MB, 1.0 s | 1.01 MB, 0.9 s |
| A4 scansione 150 dpi | 2.174.960 | 0.21 MB, 0.3 s | 0.28 MB, 0.3 s |
| A4 scansione 300 dpi | 8.699.840 | 0.42 MB, 0.4 s | 0.49 MB, 0.4 s |
| A3 vettoriale 300 dpi | 17.403.188 | non misurato | non misurato |

Il PNG di Safari potrebbe non passare per la via veloce (NON VERIFICATO): in quel caso il tempo e la memoria del PNG sarebbero molto maggiori (su Chromium 4-18 volte il tempo e circa 3 volte la memoria): se il PNG è molto più lento del JPEG, riferirlo. La scansione di prova è quasi uniforme e pesa poco: una scansione vera pesa di più.

Riferire per ogni punto che cosa non va (tempi lunghi, schermo bloccato, pagina ricaricata, immagini sfocate o spostate, dialogo fuori dallo schermo).

## Provare CP5a su iPhone

Aprire l'indirizzo in Safari. Controllare la versione: icona del pannello in alto a destra, in fondo "App · Versione" = commit pubblicato (se è diversa, Safari mostra file vecchi: ricaricare). Tutto quello che segue è stato provato **solo su Chromium** (anche con tocco emulato e con `navigator.share` simulato): su iPhone è **NON VERIFICATO**, quindi ogni punto va riferito (va / non va, e cosa).

1. **Preparazione**: aprire **A4 vettoriale** da "PDF di prova". Calibrare la scala (*Scala*, i due estremi del segmento "RIFERIMENTO 100 mm", `100`). Mettere **un oggetto per tipo**: una *Retta* e una *Linea* a tre punti (anche *Tratteggiata*), una *Quota orizz.* e una *Quota Ø* con il valore automatico, una quota con valore digitato `Ø8 ±0.1`, un *Testo* `FORO Ø8 ±0.1 90°`, una **copertura rettangolare sul titolo** "DISEGNO FITTIZIO - GT-Pdf" e una **copertura circolare sul disegno**.
2. **File > Esporta PDF…**. Atteso: il dialogo sta dentro lo schermo (anche in orizzontale: scorre); **Copertura semplice** è scelta (dal 5b **Appiattito** è attivo, senza etichetta: per questa prova lasciare *Copertura semplice*; le prove di Appiattito sono in "Provare CP5b su iPhone"); il riepilogo dice `File a4-vettoriale.pdf`, `Nuovo file a4-vettoriale-quotato.pdf`, `Pagine 1 (1 con oggetti)`, `Oggetti` (il numero degli oggetti messi), `Modalità Copertura semplice`. *Annulla* chiude il dialogo senza fare nulla.
3. **Esporta** (riaprire il dialogo se serve). Atteso: avanzamento breve, poi **"PDF pronto"** con `File a4-vettoriale-quotato.pdf`, `Dimensione` in kB, `Pagine 1 (1 riscritta)`, `Controllo riaperto: 1 pagina come l'originale`, `Tempo`. **Non deve aprirsi da solo nessun foglio di condivisione.** Compaiono *Chiudi*, *Scarica*, *Condividi*.
4. **Condividi** (toccare subito). Atteso: si apre il foglio di condivisione di iOS con un file PDF chiamato `a4-vettoriale-quotato.pdf`. Scegliere **Salva su File**, una cartella, *Salva*. Aprire l'app **File**, riaprire il file: si vedono la scala, le quote (con i valori), il testo e le **coperture bianche** (il titolo sotto la copertura non si vede). Riferire se il PDF si apre bene e se linee tratteggiate, frecce e badge delle quote sono leggibili. Provare a **selezionare il testo** del titolo con un tocco prolungato sulla copertura (il testo sotto la copertura resta nel file: atteso che si possa selezionare; NON VERIFICATO sul visore di iOS).
5. **Annullare il foglio di condivisione** (chiuderlo senza scegliere nulla). Atteso: nel dialogo compare **"Condivisione annullata."** con il colore del testo normale, **non** un errore, e *Condividi* si può toccare di nuovo. Se compare un messaggio di errore: riferire il testo esatto (c'è il nome dell'eccezione tra parentesi).
6. **Gesto scaduto**: dopo "PDF pronto" aspettare più di 6 secondi e toccare *Condividi*. Atteso: funziona (il tocco è nuovo; è la generazione che avviene prima, non dopo il tocco). Riferire se compare invece "Il sistema non ha consentito la condivisione".
7. **Scarica**. Atteso: il file `a4-vettoriale-quotato.pdf` si **salva in Download** (icona dei download di Safari, oppure File > Download) e **non** si apre in una scheda. Se si apre in una scheda o non compare: riferire. Toccando *Scarica* una seconda volta il browser può salvare un secondo file (`… (1).pdf`): è normale, riferire come si comporta Safari.
8. **Chiudi**, poi riaprire **File > Esporta PDF…** ed esportare di nuovo: stesso risultato. L'originale non è cambiato (in File, il PDF di prova non è toccato: è dentro l'app, quindi per un PDF di File controllare data e dimensione).
9. **Nomi**: in File rinominare un PDF "Flangia rev.3 è più.PDF" (spazi, accenti, più punti, maiuscole), aprirlo nell'app, mettere un oggetto, esportare. Atteso: `Flangia rev.3 è più-quotato.pdf` (nel dialogo, nel foglio di condivisione e in Download).
10. **Pagine ruotate e miste**: aprire "A4 con /Rotate 90" e "3 pagine miste", mettere una quota, un testo e una copertura per pagina (anche sulla scansione), esportare e aprire da File: tutto deve stare come nell'app, con i testi dritti.
11. **Avvisi**: se si ha un PDF reale con annotazioni (note, timbri, campi di modulo) e si mette una copertura sopra: il dialogo "PDF pronto" dice che l'annotazione **resta sopra la copertura** (nel PDF i lettori la disegnano dopo il contenuto). Riferire se l'avviso compare e se nel file esportato è così.
12. **PDF reale grande** (per esempio 21 MB e 124 pagine, da iCloud): con un cronometro, tempo da *Esporta* a "PDF pronto"; Safari ricarica la pagina o la schermata resta bloccata? Riferire il tempo, la dimensione del file e se compare un errore (il messaggio dice che il lavoro non è perso). Dato di confronto: su Chromium desktop, con un PDF sintetico di 124 pagine e 21.7 MB, 0.4-1.1 s (NON iPhone).
13. **File non esportabili**: un PDF cifrato con password non si apre (messaggio in italiano); un PDF troncato o danneggiato non si apre ("non è un PDF valido oppure è danneggiato o incompleto"). Se un PDF si apre ma l'esportazione dice che non riesce a leggerlo, riferire il testo (c'è il dettaglio tecnico sotto).
14. **Da icona Home** (*Condividi → Aggiungi alla schermata Home*): ripetere i punti 3, 4 e 7.

Riferire per ogni punto che cosa non va (testi, tocchi persi, dialogo che esce dallo schermo, file che non si salva).

## Esportazione: cosa fa e limiti

- **Originale intatto.** Si legge il PDF in memoria (con pdf-lib) e si scrive **un altro file**. Il file originale e i suoi byte non si toccano (provato: SHA-256 uguale prima e dopo; dopo l'esportazione il file in uscita è diverso).
- **Riscrittura completa.** Il nuovo PDF è una riscrittura di tutto il file, non un'aggiunta in coda. Producer e date restano quelli dell'originale. Le pagine senza oggetti restano identiche (stessa resa pixel per pixel su Chromium).
- **Copertura semplice.** Le coperture sono rettangoli o cerchi **bianchi sovrapposti** al contenuto: il testo e il disegno sotto **restano nel file** e si possono ancora selezionare, copiare o estrarre. Per sparire davvero serve "Appiattito".
- **Appiattito (5b).** Le pagine **con oggetti** diventano **una sola immagine** (PDF.js a DPI/72 su fondo bianco, poi gli oggetti con lo stesso disegno dell'app, coperture per prime); le altre pagine restano **identiche**. L'area visibile (MediaBox, CropBox, /Rotate, `UserUnit`) resta quella dell'originale. Il vecchio contenuto (testo sotto le coperture, miniature, dati privati, collegamenti e i loro indirizzi, campi di modulo con i valori) **non resta nel file** (provato con PDF sintetici e controllando i byte). **Il testo delle pagine appiattite non è più selezionabile né ricercabile.** Annotazioni (timbri, note con aspetto) e campi **diventano parte dell'immagine come li disegna PDF.js**; i campi non restano compilabili e **i collegamenti spariscono** (PDF.js non li disegna). DPI ammessi: quelli per cui ogni pagina con oggetti sta in **67.108.864 px**; gli altri sono disabilitati con il motivo (A3 a 600 dpi: 69.605.736 px). Prima di ogni pagina si controlla che il dispositivo abbia creato davvero il canvas (ultimo pixel); se no l'esportazione si ferma senza perdere il lavoro. Una pagina per volta, ma **pdf-lib tiene tutte le immagini in memoria fino al salvataggio**: con molte pagine o DPI alti serve molta memoria. Misure (Chromium desktop, **non iPhone**) e decisione JPEG/PNG: `docs/PIANO.md`, "Misure per la decisione 5". Safari/iPhone **NON VERIFICATO**.
- **Annotazioni, campi di modulo, collegamenti** (pdf-lib, in "Copertura semplice"): restano nel file, con gli stessi rettangoli e valori (provati con un campo di testo, una casella, un collegamento e un timbro). **Ma i lettori disegnano le annotazioni e i campi sopra il contenuto**, quindi **sopra le coperture**: una copertura non nasconde un'annotazione (l'app invece la nasconde). Il dialogo avvisa quando una pagina ha coperture e annotazioni.
- **Firme digitali:** riscrivendo il file la firma **non resta valida** (pdf-lib non aggiorna `/ByteRange`; provato solo con una firma finta). Non esportare per firmare di nuovo un documento firmato.
- **PDF cifrati:** con password l'app non apre il file. Con sole restrizioni del proprietario (si apre senza password) l'esportazione funziona e il file esportato resta **cifrato** (provati AES-256, AES-128 e RC4-128; PDF.js lo apre senza password; altri lettori NON VERIFICATO).
- **Contenuto originale sporco:** `q` non chiusi, `Q` in più, matrici o modalità di testo lasciate a metà non influiscono sugli oggetti (si correggono prima di scriverli e si avvisa). Limiti: un ritaglio rimasto attivo dopo un `Q` in più non si ripristina; immagini in linea o flussi non decodificabili si isolano solo con il `q`/`Q` di pdf-lib.
- **Testi:** Helvetica standard (Ø ° ± verificati). Pagine con `/Rotate`, CropBox e `UserUnit` diverso da 1 sono provate su Chromium con PDF sintetici, **non con PDF reali**.
- **Controlli:** prima di scrivere si verifica che PDF.js e la libreria di scrittura vedano le stesse pagine, e dopo si riapre il file generato con PDF.js (stesso numero di pagine e stesse aree visibili): se qualcosa non torna l'esportazione si ferma con un messaggio in italiano e **il lavoro non si perde**. Il controllo non confronta il contenuto pixel per pixel.
- **Memoria e tempi:** su Chromium desktop, 124 pagine e 21.7 MB: 0.4-1.1 s e circa 70-120 MB in più nel processo. **Su iPhone NON VERIFICATO.**

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
scripts/                       generazione PDF di prova, icone e tabella Helvetica, copia asset PDF.js, prove Chromium (e2e-cp2.cjs, e2e-cp3.cjs, e2e-cp4.cjs, e2e-cp5a.cjs con le sue serie e PDF sintetici, e2e-cp5b.cjs per "Appiattito", e2e-lib.cjs con l'infrastruttura comune di 5a e 5b, perf-cp5a.cjs, measure-cp5b.cjs per le misure di 5b)
src/geometry/                  pixel, unità, scala, geometria di pagina (Rotate/CropBox), ortogonale, misura, quote, coperture, layout di testi e quote, scelta con un tocco, metriche Helvetica (con test)
src/model/                     oggetti (linee, testi, quote, coperture), ordine di disegno, scena condivisa (`scene.ts`: le primitive che disegnano il livello SVG e l'esportazione), sposta, tipi di linea, colore, spessore, altezza testo, annulla/ripeti (con test)
src/pdf/                       apertura PDF con PDF.js (build legacy), messaggi di errore di apertura
src/export/                    esportazione: analisi del contenuto originale, "Copertura semplice" con pdf-lib, "Appiattito" (piano dei DPI, controllo dell'ultimo pixel, pittore su canvas, rasterizzazione, immagine nel PDF, pulizia del vecchio contenuto), controllo del file, nome, condividi/scarica, errori (con test)
src/app/                       guscio dell'app (menu, palette, inspector, barre, sessione) e costruzione per punti
src/ui/                        DOM, icone, vista del documento (pan, pinch, zoom, lente), livello di disegno, menu, dialoghi (anche Esporta PDF), tastierino
src/diag/                      pagina diagnostica (CP0)
src/assets/                    font Inter e JetBrains Mono, icone Lucide
```

## Privacy e repository

Il repository è **pubblico**: non va mai caricato un PDF o un disegno reale. `.gitignore` esclude tutti i `*.pdf` tranne `public/test-pdfs/`, che contiene solo disegni fittizi. L'app non invia nulla in rete e non usa CDN (font, icone e asset di PDF.js sono inclusi). Nessun segreto nel repository.

## Componenti di terze parti

PDF.js (Apache-2.0), @cantoo/pdf-lib (MIT), Inter e JetBrains Mono (OFL 1.1), Lucide (ISC/MIT). Dettagli e versioni in [`THIRD_PARTY.md`](THIRD_PARTY.md).
