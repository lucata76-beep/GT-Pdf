---
name: Technical CAD Measurement
# FONTE UNICA del design di "Editor PDF con quote". Sostituisce il vecchio Design.md.
# Blocchi colors/typography/rounded/spacing: generati da Stitch (primary #a43700 e' il colore reale degli screen in design/0x-*/screen.png).
# Blocco cad: colori dell'app CAD, con i contrasti calcolati (formula WCAG) il 2026-10-26.
colors:
  surface: '#f8f9ff'
  surface-dim: '#d6dae4'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4fd'
  surface-container: '#eaeef8'
  surface-container-high: '#e4e8f2'
  surface-container-highest: '#dee2ec'
  on-surface: '#171c23'
  on-surface-variant: '#5a4138'
  inverse-surface: '#2c3138'
  inverse-on-surface: '#edf1fb'
  outline: '#8f7066'
  outline-variant: '#e3bfb2'
  surface-tint: '#a83900'
  primary: '#a43700'
  on-primary: '#ffffff'
  primary-container: '#cd4700'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb59a'
  secondary: '#006876'
  on-secondary: '#ffffff'
  secondary-container: '#69e8fe'
  on-secondary-container: '#006774'
  tertiary: '#00685d'
  on-tertiary: '#ffffff'
  tertiary-container: '#008376'
  on-tertiary-container: '#f4fffb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcf'
  primary-fixed-dim: '#ffb59a'
  on-primary-fixed: '#380d00'
  on-primary-fixed-variant: '#802a00'
  secondary-fixed: '#9eefff'
  secondary-fixed-dim: '#55d7ed'
  on-secondary-fixed: '#001f24'
  on-secondary-fixed-variant: '#004e59'
  tertiary-fixed: '#8df5e4'
  tertiary-fixed-dim: '#70d8c8'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#005048'
  background: '#f8f9ff'
  on-background: '#171c23'
  surface-variant: '#dee2ec'
cad:
  canvas: '#E2E5E9'
  sheet: '#FFFFFF'
  sheet-border: '#B0B7C1'
  chrome: '#F4F5F7'
  toolbar: '#ECEEF1'
  border: '#CBD0D8'
  border-strong: '#9AA1AC'
  text: '#1E232A'              # 14.48:1 su #F4F5F7, 12.50:1 su canvas
  text-secondary: '#5A626F'    # 5.64:1 su #F4F5F7, 4.87:1 su canvas
  text-disabled: '#838C99'     # SOLO elementi disabilitati o decorativi: 3.12:1 su #F4F5F7, NON ammesso per testo attivo
  accent-fill: '#A43700'       # sfondo dei pulsanti primari, testo bianco 6.72:1
  accent-fill-hover: '#CD4700' # hover/pressed, testo bianco 4.67:1
  accent-stroke: '#E65100'     # SOLO tratti e icone su #FFFFFF / #F4F5F7 (3.79 / 3.47:1); mai testo piccolo; su canvas e' 3.00:1, li' usare accent-fill
  measure: '#0277BD'           # quota in costruzione, rubber-band, cornice di selezione (4.80:1 su bianco, 3.80:1 su canvas)
  dimension-default: '#D32F2F' # quota definitiva, colore predefinito (4.98:1 su bianco)
  dimension-alt: '#1565C0'     # alternativa scelta dall'utente (5.75:1 su bianco)
  snap-topology: '#00796B'     # estremo, punto medio, centro (5.32:1 su bianco, 4.21:1 su canvas)
  snap-vector: '#00838F'       # intersezione, perpendicolare, tangente (4.52:1 su bianco, 3.58:1 su canvas)
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: '0'
  headline-sm:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.125rem
    letterSpacing: 0.01em
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  label-numeric-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: -0.02em
  label-numeric-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: -0.01em
  label-numeric-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.75rem
  label-micro-header:
    fontFamily: Inter
    fontSize: 0.625rem
    fontWeight: '700'
    lineHeight: 0.75rem
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px   # SOLO pallini di stato e indicatori dei radio button. Mai su pulsanti, schede, badge.
spacing:
  gutter: 0.5rem
  margin: 0.75rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

# DESIGN.md - Editor PDF con quote

## 0. Come usare questo file

- Questo e' l'unico file di design da seguire per colori, tipografia, forme e componenti.
- Le cartelle `design/01..05` (`screen.png` + `code.html`) sono riferimento visivo generato da Stitch. Non copiare il codice generato. Dove i mockup divergono da questo file, vince questo file.
- Divergenze dei mockup da NON riprodurre:
  1. icona account/avatar in alto a destra (il progetto non ha registrazione);
  2. funzioni TOLLERANZA, LIVELLI, CNC, campi tolleranza, "ISO js7", stampa, "Rapporto Collaudo", "DWG-CONV", "CAD CAM V4.2";
  3. riferimenti a norme (ISO 12647-2, DIN 7168, DIN EN ISO 1101, ISO 2768, ISO 128): non verificati, non usarli;
  4. numeri e testi di esempio (righelli con "50" ripetuto, pesi "~1.4 MB", "1 mm = 4.2 px (1:1)");
  5. barra inferiore di navigazione duplicata dell'iPhone (FILE, QUOTA, TOLLERANZA, LIVELLI, CNC);
  6. dipendenze da rete: Tailwind CDN, Google Fonts, Material Symbols da googleapis.

## 1. Visione

Strumento web per annotare e quotare PDF, orientato all'officina meccanica. Zero registrazione, zero cloud, esecuzione locale. Estetica industriale, sobria, ad alto contrasto: niente gradienti, niente decorazioni. Lingua dell'interfaccia: italiano tecnico (File, Modifica, Inserisci, Zoom, Quota, Raggio, Diametro, Snap).

## 2. Colori

| Uso | Token | Valore |
|---|---|---|
| Sfondo area di lavoro | `cad.canvas` | `#E2E5E9` |
| Foglio PDF | `cad.sheet` + bordo 1px `cad.sheet-border` | `#FFFFFF` / `#B0B7C1` |
| Pannelli e barre | `cad.chrome` | `#F4F5F7` |
| Intestazioni barre | `cad.toolbar` | `#ECEEF1` |
| Bordi, separatori | `cad.border` / `cad.border-strong` | `#CBD0D8` / `#9AA1AC` |
| Testo | `cad.text` / `cad.text-secondary` | `#1E232A` / `#5A626F` |
| Pulsante primario, strumento attivo (riempimento) | `cad.accent-fill` | `#A43700` |
| Hover/pressed del primario | `cad.accent-fill-hover` | `#CD4700` |
| Tratti e icone attive su bianco/chrome | `cad.accent-stroke` | `#E65100` |
| Quota in costruzione, selezione | `cad.measure` | `#0277BD` |
| Quota definitiva | `cad.dimension-default` / `cad.dimension-alt` | `#D32F2F` / `#1565C0` |
| Snap estremo, punto medio, centro | `cad.snap-topology` | `#00796B` |
| Snap intersezione, perpendicolare, tangente | `cad.snap-vector` | `#00838F` |
| Errore e stati distruttivi | `colors.error`, `error-container`, `on-error-container` | Material |

Regole:
- Testo: contrasto >= 4.5:1. Icone, tratti e marker di snap: >= 3:1 (WCAG 2.2, 1.4.3 e 1.4.11).
- `#838C99` solo per elementi disabilitati o decorativi.
- `#F57C00` (hover del vecchio file) e `#00ACC1` (snap del file Stitch) NON si usano: contrasto 2.70:1 e 2.74:1 su bianco.
- Il colore della quota definitiva e' una proprieta' modificabile dall'utente (colore e spessore); predefinito `dimension-default`.

## 3. Tipografia

- UI: `Inter` (pesi 400, 500, 600, 700 solo per `label-micro-header`), fallback `-apple-system, "Segoe UI", sans-serif`.
- Tutti i numeri dell'interfaccia (coordinate, scale, input numerici, ΔX/ΔY, badge di Distanza, valori nel tastierino): `JetBrains Mono`, fallback `"SF Mono", Consolas, monospace`, con `font-variant-numeric: tabular-nums`.
- Fanno eccezione i testi che stanno sul foglio e finiscono nel PDF esportato: i **testi** e le **etichette delle quote** sono in **Helvetica** (decisione 6 di `docs/PIANO.md`; l'esportazione non puo' incorporare JetBrains Mono e cosi' l'etichetta ha la stessa larghezza nell'app e nel file).
- Scale e dimensioni: i token `typography.*` del frontmatter.
- Font e icone vanno inclusi nel repository (self-host), non caricati da CDN. Verificare la licenza di ogni font/icona al momento dell'inclusione (NON VERIFICATO).

## 4. Layout

Desktop:
- Barra superiore 40px: File, Modifica, Inserisci, Zoom; `A-` / `A+` (dimensione interfaccia, separata dallo zoom del documento); zoom documento con `-`, valore percentuale, `+`.
- Palette strumenti a sinistra 48px (pulsanti 36x36).
- Area di lavoro fluida con righelli.
- Inspector a destra 280px: Proprieta' oggetto (colore linea, spessore, tipo linea, altezza testo/quota). Nessun campo di tolleranza in V1.
- Barra di stato in basso.

iPhone (verticale):
- Massimizzare il foglio. Barra superiore compatta con menu (File, Modifica, Inserisci, Zoom), `A-` / `A+`, annulla/ripeti.
- Barra strumenti in basso, scorrevole in orizzontale, piu' una riga contestuale solo quando uno strumento e' attivo (es. tipo quota + Annulla + Conferma, interamente visibile). Nessuna seconda barra di navigazione.
- Controlli fluttuanti sul foglio ridotti al minimo: Distanza, griglia, `+` `-` zoom, adatta alla pagina, in un'unica colonna sul bordo, senza coprire il punto di lavoro.
- Tutti i bersagli di tocco >= 44x44 pt (Apple HIG), anche se l'icona e' piu' piccola.
- Pinch per lo zoom del documento. Punti inseriti con tocchi successivi.

## 5. Forme ed elevazione

- Raggio 2px o 4px (`rounded.sm`, `rounded.DEFAULT`). Niente pulsanti a pillola o circolari. Cerchio ammesso solo per pallini di stato e indicatori dei radio.
- Livello 0: area di lavoro `cad.canvas`; foglio `cad.sheet` con bordo 1px `cad.sheet-border`, senza ombra sfocata.
- Livello 1: barre e pannelli `cad.chrome` con bordo 1px `cad.border`.
- Livello 2: badge di quota e tooltip: fondo bianco, bordo 1px `cad.text`, ombra `0 1px 2px rgba(30,35,42,0.12)`.
- Livello 3: dialog: fondo bianco, bordo 1px `cad.border-strong`, ombra `0 4px 12px rgba(30,35,42,0.16)`.

## 6. Componenti

Pulsanti
- Strumento (palette): trasparente; hover `cad.canvas`; attivo = fondo `cad.accent-fill` con icona bianca (su canvas) oppure bordo 1px `cad.accent-stroke` con icona `cad.accent-stroke` (su bianco/chrome).
- Primario (OK, Applica, Esporta, Conferma): fondo `cad.accent-fill`, testo bianco, raggio 2px, Inter 500; hover `cad.accent-fill-hover`.
- Secondario (Annulla): fondo bianco, testo `cad.text`, bordo 1px `cad.border`; hover `cad.chrome`.
- Icone a tratto sottile (1.5-2px), chiare e universali.

Campi numerici
- Altezza 28px (desktop), >= 44px (iPhone). `JetBrains Mono` 12px. Fondo bianco, bordo 1px `cad.border`, raggio 2px. Focus: bordo 1px `cad.accent-stroke`, senza alone. Prefisso asse/grandezza (`X:`, `Y:`, `R:`, `L:`) in `cad.text-secondary`; unita' (`mm`, `°`) in `cad.text-secondary`.

Quota sul disegno
- Linee di estensione sottili, frecce, etichetta in **Helvetica** (non JetBrains Mono: vedi sezione 3). Etichetta in badge bianco, angoli vivi, bordo sottile. Colore: `dimension-default` (modificabile). In costruzione: `measure`.
- Prefissi: `Ø` solo per quota di diametro, `R` solo per raggio.
- Stile esatto di frecce e proporzioni (fissato in CP3, di progetto, NON da una norma): vedere "Testo, quote e tastierino (CP3)" sotto e `docs/PIANO.md` (Scelte di CP3).
- Tipi di quota: lineare (allineata, orizzontale, verticale), diametro, raggio. Valore automatico dalla scala oppure digitato.

Snap (V2: gli snap sugli oggetti, a partire da Estremo e Punto medio, non sono in V1; in V1 c'e' solo ORTO)
- Marker 8x8px, tratto 1.5px: quadrato = estremo, triangolo = punto medio, cerchio = centro, croce = intersezione. Colori: `snap-topology` e `snap-vector`.
- Etichetta del tipo di snap con i nomi: Estremo, Punto medio, Centro, Intersezione (non "Spigolo").
- Nella barra di stato: toggle singoli `[Estremo] [Punto medio] [Centro] [Intersezione] [Ortogonale] [Griglia]`.

Barra di stato
- Coordinate cursore (`X: 142.50 mm  Y: 88.25 mm`), stato calibrazione, toggle snap. Su iPhone: riga compatta con X, Y, scala, ORTO.

Lente (iPhone)
- Riquadro quadrato con mirino a croce e snap magnetico, mostra l'ingrandimento. Dimensione 80x80 px e scostamento 70px sopra il punto di tocco: valori di partenza (da Design originale), da tarare su iPhone reale (NON VERIFICATO).

Tastierino su schermo (iPhone)
- Compare solo quando si scrive testo o quota. Mostra il valore in modifica, il tipo (`Ø`, `R`) e il pulsante di conferma.
- Griglia: riga 1 `Ø` `R` `°` `±` `⌫`; poi `7 8 9` / `4 5 6` / `1 2 3` / `0 . 00`; colonna destra `ABC TESTO`, `#$& SIMBOLI`, `Annulla`, `OK`.
- `ABC TESTO` e `#$& SIMBOLI` aprono layout con lettere e simboli nella stessa griglia (nei mockup non e' disegnato). Realizzato in CP3: lettere A-Z in ordine alfabetico su 7 colonne con `abc`/`ABC` e `spazio`, 27 simboli + `spazio`; la riga `Ø R ° ± ⌫` e i pulsanti `Annulla` e `OK` restano; nei layout con lettere e simboli la fila `123 NUMERI`, `#$& SIMBOLI` (o `ABC TESTO`), `Annulla`, `OK` sta sotto la griglia.

Dialog Calibra scala
- L'utente seleziona due punti noti; l'app mostra la distanza misurata in unita' PDF (pt, 1/72 in) e in mm sul foglio. Campo "Distanza reale" + unita' (`mm`). Pulsanti Applica e Annulla.
- Formule (verificate: 100 mm = 283.46 pt):
  - `foglio_mm = d_pt * 25.4 / 72`
  - `mm_reali_per_pt = L_reale_mm / d_pt`
  - scala 1:N con `N = L_reale_mm / foglio_mm` (esempio: 100 mm reali su 283.46 pt = 100 mm di foglio = 1:1)
  - etichetta: N >= 1 (riduzione) `1:N`; N < 1 (ingrandimento) `M:1` con `M = 1 / N = foglio_mm / L_reale_mm` (N = 0.2234 -> `4.48:1`); max 2 decimali senza zeri finali, mai `1.00:1`. Solo testo: la scala (`mm_reali_per_pt`) e le misure non cambiano (decisione 18 di `docs/PIANO.md`).
- Mai pixel di schermo: dipenderebbero dallo zoom. La scala e' per pagina.

Barra contestuale e proprieta' della linea (CP2)
- Compare sopra la barra di stato solo quando e' attivo uno strumento diverso da "Sposta vista" (su iPhone la palette e la barra di stato restano ferme). Una riga di testo guida con il passo corrente ("Retta: indica il secondo punto") e, sotto, il riquadro delle proprieta' (linea in miniatura con tipo, colore e spessore: apre il pannello), `Annulla` (scarta i punti in costruzione) e, per la Linea, `Fine`. Sul desktop il riquadro non c'e': le stesse proprieta' stanno nell'inspector.
- Pannello proprieta': tipo (Continua, Tratto-punto, Tratteggiata), colore (8 della tavolozza + selettore nativo + campo `#RRGGBB`), spessore in pt (predefiniti 0.25, 0.5, 0.75, 1, 1.5, 2, 3 + campo digitabile 0.1-20). Stato attivo: bordo 1px `cad.accent-stroke`. Il pulsante `Applica all'ultima linea` di CP2 e' stato tolto in CP4: con Seleziona gli stessi controlli cambiano le proprieta' di un oggetto qualunque (vedi "Coperture e Seleziona (CP4)").
- Barra di stato: `SCALA:` (tocco = calibra) e interruttore `ORTO` (attivo = fondo `cad.accent-fill`, testo bianco).
- Misura (Distanza): linea e segni in `cad.measure`; badge bianco con `L`, `ΔX`, `ΔY` (livello 2). Cancella: la linea sotto il dito e' evidenziata in `cad.measure` prima di essere cancellata.
- Pattern dei tipi di linea e valori predefiniti: vedere `docs/PIANO.md` (Scelte di CP2); sono in pt del foglio, in funzione dello spessore.

Testo, quote e tastierino (CP3)
- Testo: un tocco indica l'angolo in basso a sinistra della linea di base; una riga, sempre dritta sul foglio mostrato; Helvetica, corpo predefinito 10 pt (proprieta' "Altezza testo": 6-24 pt predefiniti, 2-200 digitabile). Colore: quello corrente.
- Quota lineare: due punti misurati e un terzo punto per la linea di quota; Ø: due punti sul diametro; R: centro e punto sul bordo. Frecce piene (punta sull'estremo; fuori se la linea e' troppo corta), linee di estensione sottili con stacco e sporgenza, badge bianco con bordo sottile accanto alla linea. Valore: automatico dalla scala (mm, "." e 2 decimali, senza unita': `100.00`, `Ø25.40`, `R12.50`) oppure digitato; senza scala solo digitato.
- Barra contestuale della Quota: una riga con i cinque tipi (Allineata, Orizz., Vert., Ø Diam., R Raggio), poi proprieta' (linea in miniatura + `Aa` con l'altezza), `Annulla`.
- Tastierino: compare solo mentre si scrive; iPhone in verticale in basso al posto di barre, palette e pulsanti sul foglio; in orizzontale a destra del foglio; desktop sotto il foglio. Mostra titolo, riga informativa (valore automatico e scala, o "Pagina non calibrata"), il valore (non e' un campo di testo: la tastiera di sistema non compare) con il cursore in coda e, se il valore e' proposto, la selezione.
- Tasti >= 44 x 44 pt.

Coperture e Seleziona (CP4)
- Copertura: strumento in palette (icona quadrato). Forme nella barra contestuale: `Rettangolo`, `Quadrato`, `Cerchio` (tre pulsanti >= 44 px). Rettangolo: due angoli opposti; Quadrato: un angolo e un secondo punto che da' direzione e misura (il lato e' il maggiore tra lo spostamento orizzontale e quello verticale sul foglio mostrato; il mirino e la lente mostrano gia' l'angolo squadrato); Cerchio: centro e un punto sul bordo. ORTO non si applica.
- Aspetto: riempimento **bianco pieno, senza bordo**. Sullo schermo, **solo in costruzione e da selezionata**, un contorno sottile in `cad.measure` (1.5 px fissi); il contorno non fa parte del disegno e non viene esportato.
- Ordine: le coperture stanno SEMPRE sotto linee, quote e testi, qualunque sia l'ordine di creazione (uno strato separato sotto agli altri oggetti); tra coperture vale l'ordine di creazione.
- Seleziona: un tocco sceglie l'oggetto **in primo piano** entro la tolleranza (22 px col dito, 10 col mouse, la stessa di Cancella; le coperture, sotto tutto, vincono solo se non c'e' altro a portata). Evidenziazione in `cad.measure`: alone di 5 px sulle linee, cornice di 1.5 px con velo leggero su testi, badge e coperture. La barra contestuale dice "Selezionata: Retta" (testo breve: la barra non deve cambiare altezza, altrimenti il foglio si ridimensiona sotto il dito).
- Spostare: trascinare l'oggetto **selezionato** lo sposta (segue il dito, un solo comando annullabile); trascinare altrove sposta la vista. Un secondo dito durante il trascinamento annulla lo spostamento e passa al pinch. Una quota spostata trasla tutti i suoi punti; il valore automatico non cambia.
- Proprieta' dell'oggetto selezionato: gli stessi controlli dei nuovi oggetti (inspector su desktop, riquadro con la linea in miniatura su iPhone) lavorano sull'oggetto selezionato: linee e quote tipo/colore/spessore, testi e quote altezza; ogni modifica e' annullabile. La copertura non ha proprieta' (nessun riquadro). Senza selezione i controlli valgono per i nuovi oggetti, come prima.
- Palette: con Seleziona le voci visibili su iPhone sono 9 (Distanza sta nella colonna sul foglio) e la barra scorre in orizzontale; 9 voci da 44 pt non entrano nei 390 px. Quando cambia lo strumento attivo (anche dal menu o dalla barra di stato) la barra scorre fino al pulsante attivo, che resta tutto in vista (decisione 15 di `docs/PIANO.md`).
- Colonna sul foglio: Distanza solo icona (nome in `aria-label` e `title`), colonna larga come i pulsanti (46 px) (decisione 16).

Dialog Esporta PDF
- Predefinito: **Copertura semplice** - "Il testo sotto le coperture resta nel file."
- **Appiattito** - "Le pagine diventano immagini: il testo sotto sparisce." Mostrare la scelta DPI (150, 300, 600).
- Un DPI e' selezionabile solo se `(larghezza_px * altezza_px)` della pagina non supera il limite del canvas del dispositivo; altrimenti disabilitato con il motivo.
  - Limite: 67.108.864 px per canvas (8192 x 8192), misurato su iPhone (iOS 27.2, Safari) il 27/10/2026: riesce a 67,11 M px, a 69,61 M px fallisce in silenzio. Prima di ogni export si controlla l'ultimo pixel (decisione 4 = A in docs/PIANO.md).
  - Pixel calcolati: A4 150 dpi = 2.174.960; A4 300 dpi = 8.699.840; A4 600 dpi = 34.806.376; A3 150 dpi = 4.349.920; A3 300 dpi = 17.403.188; A3 600 dpi = 69.605.736 (sopra il limite: disabilitato). Calcolare sempre sulla dimensione reale della pagina.
- Nessuna stima di peso del file inventata: mostrare un valore solo se calcolato.
- Riepilogo: nome file, pagine, modalita', DPI. Pulsanti Annulla ed Esporta.
- **Realizzato in CP5a** ("Copertura semplice") **e in CP5b** ("Appiattito", DPI, JPEG/PNG):
  - Scelta: due schede (radio) "Copertura semplice" (predefinita, "Il testo sotto le coperture resta nel file.") e "Appiattito" ("Le pagine diventano immagini: il testo sotto sparisce."; dal 5b e' **attiva**, senza etichetta). Nessuna stima di peso o di tempo: il peso si mostra solo a file generato, calcolato.
  - **Appiattito** (5b): scegliendolo compaiono *Risoluzione* (radio 150 / 300 / 600 dpi; il predefinito e' 300 se ammesso, altrimenti il piu' alto ammesso) e *Formato delle immagini* (radio JPEG "Con perdita, qualita' 85: file piu' piccolo." predefinito / PNG "Senza perdita: file piu' grande."), il riepilogo si allunga con **Pagine appiattite** (`M di N`: solo quelle con oggetti, le altre restano identiche), **Pagina piu' grande** (`larghezza × altezza px = X px`, con la pagina tra parentesi) e **Modalita'** (`Appiattito, 300 dpi, JPEG`), e sotto compare il riquadro "Prima di esportare" con gli avvisi (testo non piu' selezionabile e collegamenti che spariscono; annotazioni e campi che diventano parte dell'immagine come li disegna PDF.js; pagine senza oggetti identiche; immagini in memoria fino alla fine con il rischio di ricaricamento di Safari).
  - **DPI fuori tetto** (decisione 4, 24): il calcolo e' sulle misure reali di **ogni pagina con oggetti**; un DPI per cui anche una sola pagina supera 67.108.864 px e' **disabilitato** (non si puo' toccare) e porta sotto di se' il motivo, per esempio `Pagina 2 (A3) a 600 dpi: 69.605.736 px, oltre 67.108.864`. Se nessun DPI entra, `Esporta` e' disabilitato e una nota rimanda a "Copertura semplice". Con pagine di misure diverse il dialogo non sceglie al posto dell'utente: mostra quali DPI sono ammessi e perche'.
  - Avanzamento (5b): `Pagina 3 di 12` (3-esima pagina da appiattire) con una riga `Pagina 7 del PDF · 300 dpi · JPEG · immagini finora 4.10 MB`; il dialogo non si chiude mentre lavora e non ha un `Annulla` (proposta aperta nel resoconto di 5b).
  - Pronto (5b, Appiattito): in piu' `Immagini inserite` (byte delle immagini) e `Vecchio contenuto tolto` (oggetti PDF e byte rimossi dal file).
  - Errore del canvas (5b): se il dispositivo non conferma l'ultimo pixel (o non crea o non codifica l'immagine) l'esportazione si ferma con "Immagine troppo grande per questo dispositivo", il numero della pagina e dei pixel, "Scegli un DPI piu' basso e riprova" e "nulla e' stato perso"; `Riprova` riapre la scelta con le opzioni di prima.
  - Riepilogo: File, Nuovo file (`<nome originale senza .pdf>-quotato.pdf`), Pagine (e quante hanno oggetti), Oggetti, Modalita'. Pulsanti `Annulla` ed `Esporta` (>= 44 px).
  - Generazione ("Copertura semplice"): "Esporta" produce il PDF **senza** aprire il foglio di condivisione (su iPhone share() riesce solo dentro il gesto: CP0). Durante il lavoro il dialogo mostra l'avanzamento ("Scrittura delle pagine con oggetti: 3 di 12") e non si puo' chiudere.
  - Pronto: riepilogo (nome, dimensione calcolata, pagine riscritte, controllo di riapertura, tempo), eventuali **avvisi** in italiano (per esempio annotazioni che restano sopra le coperture) e tre pulsanti: `Chiudi`, `Scarica` (blob `application/octet-stream`, si salva in Download) e `Condividi` (foglio di condivisione con un File `application/pdf`, chiamato direttamente dal tocco). Se il browser non puo' condividere file (`navigator.canShare` assente o `canShare({files})` falso) il dialogo lo scrive in una riga; l'annullamento del foglio di condivisione non e' un errore ("Condivisione annullata.").
  - Errore: titolo, messaggio in italiano ("... nulla e' stato perso"), dettaglio tecnico (inglese, dalle librerie) e `Chiudi` / `Riprova`; il lavoro non viene toccato.
  - Con iPhone in orizzontale il dialogo scorre dentro lo schermo (altezza = altezza visibile, `100dvh` con ripiego `100vh`).

Menu
- File: Apri, Salva con nome (disattivato fino a 5c), Esporta PDF (attivo dal 5a), Chiudi (niente "Nuovo", decisione 27/10/2026).
- Modifica: Annulla, Ripeti, Seleziona/sposta, Copia, Duplica, Cancella.
- Inserisci: Linea (tipi di linea), Retta, Cerchio, Arco, Raccordo, Testo, Quota (allineata, orizzontale, verticale, diametro Ø, raggio R), Copertura bianca (rettangolo, quadrato, cerchio).
- Zoom: zoom documento (separato da `A-` / `A+`).
- Pulsante Distanza sempre raggiungibile.
- Un menu piu' alto dello spazio sotto il pulsante (iPhone in orizzontale, `A+`) scorre in verticale: tutte le voci raggiungibili, voci >= 44 px sui dispositivi touch; se entra non cambia nulla (decisione 17).

## 7. Fuori dalla V1

Tolleranze (campi, classi), Livelli, funzioni CNC, stampa, account/registrazione. Nessuna decisione per le fasi successive.

## 8. Punti aperti (da decidere o provare)

- Lente: forma e dimensioni definitive (provare su iPhone reale).
- Separatore decimale: deciso il 27/10/2026: mostrato sempre ".", in digitazione la "," e' accettata e normalizzata a ".". Tasto segno meno per valori negativi: non serve nelle quote (valori positivi); aperto per il futuro.
- Snap su Estremo e Punto medio: in V2 (decisione 27/10/2026), non in CP3.
- Schermate non ancora disegnate: copia/duplica, menu aperti. Coperture, Seleziona, Cancella e i layout ABC e simboli sono stati realizzati in CP3-CP4 seguendo questo file.
- Colonna di pulsanti sul foglio: copre ancora una striscia del foglio (12 % della larghezza a pagina intera, 390 x 780); l'eventuale pulsante apri/chiudi si decide dopo la prova su iPhone (decisione 16).
- Layout iPhone definitivo da tarare su dispositivo.
