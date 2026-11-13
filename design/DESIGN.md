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
- Barra superiore 40px: File, Modifica, Inserisci, Origine (CP6d), Zoom; `A-` / `A+` (dimensione interfaccia, separata dallo zoom del documento); zoom documento con `-`, valore percentuale, `+`.
- Palette strumenti a sinistra 48px (pulsanti 36x36).
- Area di lavoro fluida con righelli.
- Inspector a destra 280px: Proprieta' oggetto (colore linea, spessore, tipo linea, altezza testo/quota). Nessun campo di tolleranza in V1.
- Barra di stato in basso.

iPhone (verticale):
- Massimizzare il foglio. Barra superiore compatta con menu (File, Modifica, Inserisci, Origine, Zoom), `A-` / `A+`, annulla/ripeti.
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
- Tipi di quota: lineare (allineata, orizzontale, verticale), diametro, raggio e, dal CP6g, **angolare**. Valore automatico dalla scala (l'angolare: dall'angolo, senza scala) oppure digitato. **Sei pulsanti in una riga** (CP6h, PARTE 1): dopo CP6g la riga usciva dallo schermo con A+ 20 e 22 (a 390 px il bordo destro dell'ultimo pulsante era a 406 e 446 px); ora il gruppo si restringe (`min-width: 0`), lo spazio fra i pulsanti e' 0,125 rem, le etichette stanno su una riga e la lettera scende **solo se serve** perche' la parola piu' larga ("Angolare", 4,31 em in Inter 500) entri nel pulsante: a 390 px 10,5 / 12 / 12,4 / 12,1 / 11,9 px con A+ 14 / 16 / 18 / 20 / 22 (a 360 px: 10,5 / 11,4 / 11,2 / 11 / 10,8 px). Altezza della barra e dei pulsanti (>= 44 px) invariate; bordo destro a 390 px: 379,5 / 378 / 376,5 / 375 / 373,5 px.

Snap (V2: gli snap sugli oggetti, a partire da Estremo e Punto medio, non sono in V1; in V1 c'e' solo ORTO). **Realizzati in CP6a (V2a): Estremo e Punto medio e la Griglia; in CP6c (V2b): Centro** (con Cerchio e Arco) e i punti in costruzione come candidati; **in CP6f: Intersezione, Quadrante, Perpendicolare, Tangente e l'Origine come candidato** ("Piu' vicino" non e' stato richiesto).
- Marker 8x8px, tratto 1.5px: quadrato = estremo, triangolo = punto medio, cerchio = centro, croce = intersezione, **rombo = quadrante, angolo retto (L) = perpendicolare, cerchio appoggiato a un tratto = tangente, cerchio con una piccola croce = origine (CP6f)**. Colori: `snap-topology` (estremo, punto medio, centro, quadrante, origine) e `snap-vector` (intersezione, perpendicolare, tangente).
- Etichetta del tipo di snap con i nomi: Estremo, Punto medio, Centro, Origine, Intersezione, Quadrante, Perpendicolare, Tangente (non "Spigolo").
- Nella barra di stato: toggle singoli `[Estremo] [Punto medio] [Centro] [Intersezione] [Ortogonale] [Griglia]` da 720 px in su; **Quadrante, Perpendicolare e Tangente (CP6f) solo nel pannello "Aggancio e griglia"**; sotto 720 px la barra resta compatta.
- **Realizzato in CP6a** (decisioni 48-52 di docs/PIANO.md):
  - **Marcatore**: nel livello di sovrapposizione, solo a schermo (non esportato); quadrato 8x8 px = Estremo, triangolo 8x8 px = Punto medio, **cerchio 8x8 px = Centro (CP6c)**, tratto 1.5 px, colore `snap-topology` (#00796B, 5.32:1 su bianco); accanto, l'etichetta "Estremo", "Punto medio" o "Centro" (11 px, a spaziatura fissa, con alone del colore del foglio; vicino al bordo destro del visore passa a sinistra). Compare sul punto che verrebbe inserito, durante la mira del dito e il passaggio del mouse. **Nella lente non compare** (la lente copia solo il PDF), ma la lente mostra il punto agganciato.
  - **Candidati**: Retta e Linea (estremi e centro di ogni tratto), Copertura rettangolare e quadrata (4 angoli e centri dei 4 lati), Quota (i due punti misurati). **Dal CP6c**: Cerchio (Centro), Arco (Estremo = inizio e fine, Punto medio = il punto a meta' dell'arco, Centro; il punto di passaggio non e' un candidato), Copertura circolare (Centro) e **i punti gia' indicati nella costruzione in corso** (Estremo: chiudere una spezzata, tornare su un punto, Arco, Quota). Nessuno per il testo. Raggio di cattura: 10 px col mouse, 22 col dito (**valori di partenza, da tarare sul PC**). A parita' di distanza: Estremo, poi Punto medio, poi Centro.
  - **Interruttori**: `Estremo`, `Punto medio` e (CP6c) `Centro`, in quest'ordine, nella barra di stato accanto a `ORTO` e `Griglia` (`st-toggle`, `aria-pressed`), attivi all'avvio; stato della sessione, non salvato nel progetto. Sotto 720 px (iPhone in verticale) la barra di stato resta compatta (X, Y, scala, ORTO) e questi quattro (con Griglia) stanno solo nel pannello a destra, sezione "Aggancio e griglia" (>= 44 px).
  - **Priorita'**: squadratura del quadrato, poi snap su un oggetto, poi ORTO, poi griglia.
- **Realizzato in CP6f** (decisioni 88-90 di docs/PIANO.md; i candidati calcolati stanno in `src/geometry/snapExtra.ts`):
  - **Candidati**: **Intersezione** dove si incontrano due oggetti a linea (tratto con tratto, tratto con cerchio o arco, cerchio o arco con cerchio o arco; Retta e Linea ogni tratto, Cerchio, Arco entro il suo sweep): **solo dentro gli oggetti, nessun prolungamento**; i due tratti adiacenti di una Linea non si incontrano nel vertice (li' c'e' l'Estremo); due curve tangenti danno un solo candidato. **Quadrante** = i quattro punti del cerchio a destra, in basso, a sinistra e in alto **del foglio come lo vede la persona** (anche con `/Rotate`); su un Arco solo quelli dentro l'arco; anche sulla Copertura circolare. **Perpendicolare** = il piede della perpendicolare dal punto di partenza sul tratto (se cade dentro il tratto), sul cerchio (i due piedi) o sull'arco (se dentro l'arco). **Tangente** = i punti di tangenza dal punto di partenza al cerchio o all'arco (solo se il punto di partenza e' fuori dal cerchio). **Origine** = l'origine della pagina, quando c'e' e almeno un interruttore e' acceso. Nessun candidato calcolato per coperture rettangolari e quadrate, quote e testi.
  - **Punto di partenza** di Perpendicolare e Tangente: l'ultimo punto indicato, la stessa ancora dell'ORTO; vale dal secondo punto di Retta, Linea, Distanza, Scala, Sposta, Specchio e delle Quote Allineata, Ø e R; **non** per il primo punto, Testo, Copertura, Cerchio, Arco, Origine, Rotazione, Quota Orizzontale e Verticale e il terzo punto delle quote. Seleziona e Cancella non agganciano mai.
  - **Marcatori e colori**: otto forme di 8x8 px (il tangente occupa 8x6), tratto 1.5 px, a schermo e mai esportati; `snap-topology` #00796B (estremo, punto medio, centro, quadrante, origine) e `snap-vector` #00838F (intersezione, perpendicolare, tangente; 4.52:1 su bianco, 3.58:1 su canvas). Etichetta a destra del marcatore, a sinistra vicino al bordo destro del visore.
  - **Priorita' a parita' di distanza (1e-9 pt)**: Estremo, Punto medio, Centro, Origine, Intersezione, Quadrante, Perpendicolare, Tangente. La priorita' generale non cambia.
  - **Interruttori**: sette (Estremo, Punto medio, Centro, Intersezione, Quadrante, Perpendicolare, Tangente), **tutti accesi all'avvio, non salvati nel progetto**; nel pannello "Aggancio e griglia" tutti, nella barra di stato da 720 px **solo `Intersezione`** (dopo `Centro`); l'Origine non ha un interruttore. Messaggi: "Tangente attiva: ..." / "Tangente disattivata" (femminile per Intersezione, Perpendicolare e Tangente).
- **Realizzato in CP7b (V3.1, decisioni 110-112 di docs/PIANO.md)**: Estremo e Punto medio si agganciano anche ai **tratti rettilinei del disegno del PDF** (lettura asincrona per pagina, `src/pdf/snapPage.ts`; punti in `src/pdf/snapPoints.ts`, griglia spaziale in `src/pdf/pointIndex.ts`). Un interruttore **«PDF»** (acceso all'avvio, non salvato nel progetto; nel pannello «Aggancio e griglia» e, da 720 px in su, nella barra di stato solo se la barra non scorre) si somma a Estremo e Punto medio, che restano i loro interruttori. **Stessi marcatori, stesse etichette e stesso colore** (`snap-topology`): nessuna distinzione grafica fra un punto del PDF e uno dei tuoi oggetti, nessun tipo nuovo; a parita' di distanza e di tipo vince il tuo oggetto. Senza snap sul PDF (scansione, livelli spenti, nessun tratto, sopra il **tetto provvisorio di 300.000 tratti** per pagina, lettura non riuscita) la pagina lo dice una volta nella riga dei messaggi e l'aggancio sui tuoi oggetti non cambia. Non sono candidati: cubiche, cerchi, riempimenti.
- **Realizzato in CP7c (V3.2a, decisioni 113-115 di docs/PIANO.md)**: l'**Estremo** si aggancia anche agli **estremi delle curve** del disegno del PDF: il punto iniziale e il punto finale di ogni cubica (quindi anche i giunti di una catena: i quattro punti di un cerchio scritto con 4 cubiche), senza riconoscere cerchi o archi; nessun Punto medio, Centro o Quadrante delle curve. Stesso interruttore **«PDF»** e stesso **Estremo** (con uno dei due spento non c'e' l'Estremo delle curve), stessi marcatori, etichette e colore: nessun tipo nuovo. Il **tetto provvisorio di 300.000** per pagina conta tratti piu' cubiche; una pagina di sole curve e' **pronta** (non «assente»), che vale per immagine, livelli tutti spenti o nessun tratto ne' curva. In Diagnostica la scheda «Geometria PDF» ha righe in piu' sui cerchi e gli archi (sottopercorsi aperti, chiusi e misti; distanza fra ultimo e primo punto; regola del cerchio senza la chiusura; lunghezza esattamente 0): solo misura.
- **Realizzato in CP7d (V3.2b, decisioni 116-118 di docs/PIANO.md; integrato su `main` (decisione 121); provato dall'utente sul PC con Microsoft Edge il 13/11/2026 (decisione 122))**: **Intersezione** e **Perpendicolare** si agganciano anche ai **tratti rettilinei del disegno del PDF** (non alle curve): l'Intersezione fra due tratti del PDF e fra un tratto del PDF e un tuo oggetto (Retta, Linea, Cerchio, Arco); la Perpendicolare dal punto di partenza (l'ancora della costruzione, come per gli oggetti) al piede dentro un tratto del PDF. Nessun interruttore nuovo e nessun tipo nuovo: valgono gli interruttori **Intersezione**, **Perpendicolare** e **«PDF»**; stessi marcatori, etichette, colori e priorita', e a parita' di distanza e di tipo vince il tuo oggetto. Niente prolungamenti; due tratti dello stesso percorso del PDF che si toccano in un estremo non danno un'Intersezione (e' un Estremo). I tratti stanno in una scena sul foglio con una griglia spaziale (`src/pdf/segmentIndex.ts`), costruita con i punti all'apertura della pagina. Due limiti **provvisori**: sopra un tetto di voci d'indice per pagina la scena e' spenta e la pagina lo dice una volta nella riga dei messaggi (Estremo e Punto medio del PDF restano); con piu' di 256 tratti entro il raggio del puntatore il PDF non offre in quel punto ne' Intersezione ne' Perpendicolare (con lo zoom il raggio si riduce).
- **Griglia (CP6a)**: DESIGN.md non la disegnava. **Linee sottili di 1 px** (colore `border-strong` a meta' opacita'), sotto gli oggetti e sopra il PDF, solo quelle visibili; origine nell'angolo in basso a sinistra della pagina mostrata. **Nascosta (e non arrotonda) quando il passo a schermo e' sotto 8 px CSS.** Passo in mm nel pannello a destra, sezione "Aggancio e griglia", campo "Passo griglia" (valori predefiniti 1, 2, 5, 10, 20, 50 + campo digitabile 0.1-1000), con una nota che dice se il passo e' in mm reali o del foglio. Spenta all'avvio. **CP6d**: con un'origine sulla pagina i nodi sono in origine + k x passo (anche a sinistra e sotto l'origine, dentro la pagina); il passo non cambia; senza origine tutto resta com'era.
- **Origine (CP6d, decisioni 58, 70-72)**: un punto per pagina (dato di pagina come la scala, non un oggetto: non si seleziona, non si trascina, non si cancella con lo strumento Cancella, non si esporta), indicato come ogni altro punto (snap e griglia attivi, nessun ORTO). **Simbolo** solo a schermo, mai esportato: due assi (X a destra, Y verso l'alto) lunghi 32 px fissi con le punte aperte, un cerchietto sull'origine e le lettere `X` e `Y` (11 px, mono); tratti `accent-stroke` (#E65100, 1.5 px) con sotto un alone bianco di 4.5 px, lettere `accent-fill` (#A43700) con alone bianco: leggibile su pagina bianca e su una scansione scura; l'interfaccia non ha un tema scuro. Il livello non riceve il puntatore (non intercetta clic di selezione, cancellazione, trascinamento o snap).

Barra di stato
- Coordinate cursore (`X: 142.50 mm  Y: 88.25 mm`), stato calibrazione, toggle snap. Su iPhone: riga compatta con X, Y, scala, ORTO. **CP6a**: da 720 px la barra contiene anche `Estremo`, `Punto medio` e `Griglia`; se non entra tutto la riga scorre (decisione 39): a 932 px entra tutto fino ad A+ 20, a 844 px fino ad A+ 18, a 780 px fino ad A+ 16 e a 720 px fino ad A+ 14 (misure in "Scelte di CP6a"). **CP6f**: da 720 px la barra contiene anche `Intersezione` (58, 60, 67, 75 e 83 px in piu' per A+ 14, 16, 18, 20 e 22): sul telefono a 780 x 390 entra tutto fino ad A+ 14 e a 720 x 390 non entra piu' nemmeno ad A+ 14 (misure in "Scelte di CP6f"); sotto 720 px la barra non cambia. X e Y restano sul cursore grezzo, non sul punto agganciato. **CP6d**: con un'**origine** sulla pagina mostrata X e Y sono **relative all'origine** (X a destra, Y verso l'alto; negative a sinistra e sotto) e l'etichetta dell'unita' dice quale: `mm reali` se la pagina ha una scala, `mm foglio` se no (la stessa unita' della shell e del passo della griglia); senza origine restano `mm` del foglio dal bordo in basso a sinistra, anche con una scala. Si aggiornano subito con il mouse fermo quando cambiano origine, scala, zoom o pagina; con il cursore fuori dalla pagina restano i trattini.

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
- Barra contestuale della Quota: una riga con i tipi (Allineata, Orizz., Vert., Ø Diam., R Raggio e, dal CP6g, Angolare), poi proprieta' (linea in miniatura + `Aa` con l'altezza), `Annulla`.
- **Quota angolare (CP6g, decisioni 93-95 di `docs/PIANO.md`)**. *Valore*: l'angolo fra due lati, sempre fra 0 e 180 gradi esclusi, calcolato sul foglio mostrato (con /Rotate e CropBox e' quello che si vede); automatico = gradi decimali con "." e 2 decimali e il simbolo `°`, per esempio `45.00°`; **non dipende dalla scala** (una pagina non calibrata non dice "?" e non da' avvisi); digitabile con il tasto `°` del tastierino (stesse regole delle altre quote). *Disegno* (di progetto, NON da una norma): l'**arco** e' una polilinea dal lato 1 al lato 2 per la via breve (passo al massimo 2 gradi, scarto dal vero arco al massimo 0,02 pt del foglio, al massimo 2000 segmenti), con lo stesso colore e spessore delle altre quote; **frecce piene** con la punta sugli estremi dell'arco, lungo la tangente (dentro l'arco se questo e' lungo almeno 2,5 frecce, altrimenti fuori); **linee di estensione** sottili, con lo stesso stacco (0,25 x corpo) e la stessa sporgenza (0,4 x corpo) delle lineari, dal punto del lato verso l'arco e solo dove il lato non lo raggiunge; **badge** bianco con bordo sottile sul prolungamento della bisettrice, fuori dall'arco, in modo da non coprire le frecce. *Costruzione* (stesso oggetto salvato): **"da due linee"** (predefinita; la richiesta dell'utente): si SCELGONO due tratti con un tocco o un clic (solo Rette e Linee, il PIU' VICINO entro 10 px col mouse e 22 px col dito, in una Linea il tratto piu' vicino; il candidato si evidenzia al passaggio del mouse e col dito appoggiato, i lati scelti restano evidenziati), poi un punto: il vertice e' l'incrocio delle due rette prolungate (puo' stare fuori dai tratti), il settore in cui cade il punto e' l'angolo quotato e la sua distanza dal vertice il raggio dell'arco (anteprima che segue il cursore); snap e griglia come per ogni punto, **nessun ORTO**. **"Da tre punti"**: vertice, un punto sul lato 1, un punto sul lato 2, punto del raggio; l'angolo e' sempre il minore; ORTO (e Perpendicolare e Tangente) dal vertice sul secondo e sul terzo punto, non sul quarto. *Rifiuti con messaggio*: lo stesso tratto due volte, rette parallele o sulla stessa retta (angolo fra le rette sotto 0,005 gradi), vertice oltre i limiti del foglio, punto dell'arco a meno di 6 px dal vertice o da una delle rette; da tre punti: punti sul vertice e lati sulla stessa retta. *Testi guida* (una riga, al massimo 42 caratteri): `Quota angolare: scegli la prima linea` / `scegli la seconda linea` / `indica dove mettere l'arco`; da tre punti `indica il vertice` / `indica un punto sul lato 1` / `indica un punto sul lato 2` / `indica dove mettere l'arco`; con il tastierino `digita il valore con il tastierino`. *Barra contestuale*: nel gruppo dei tipi un sesto pulsante `Angolare`; nella riga dei pulsanti, solo con l'angolare, l'interruttore `Da 3 punti` (acceso = da tre punti; predefinito spento; stato della sessione, non si salva): non aggiunge righe alla barra (misure in `docs/PIANO.md`, "Scelte di CP6g"). *Menu Inserisci*: `Quota angolare da due linee` e `Quota angolare da tre punti`. *Tastierino*: riga informativa `Automatico 45.00° · gradi decimali` (mai "Pagina non calibrata"). *Dati*: quota STATICA, nessun riferimento alle linee d'origine; quattro punti nello spazio utente (vertice, un punto per lato, punto di mezzo dell'arco); file di progetto versione 4. *Snap*: lo snap non e' cambiato, quindi come ogni quota la quota angolare offre i due punti dei lati (p1 e p2) come Estremo.
- **Raccordo (CP6h, V2c; decisioni dalla 98 di `docs/PIANO.md`)**. *Che cosa fa*: l'arco di cerchio di raggio R **tangente a due rette**, fra DUE TRATTI di Retta o Linea (non Cerchio ne' Arco); i due tratti si ACCORCIANO ai punti di tangenza (in un solo passo di Annulla e di Ripeti) e l'arco e' un normale **Arco**, statico, non legato alle rette (nessun nuovo tipo di oggetto: il file di progetto resta alla versione 4). *Geometria* (nel foglio mostrato, quindi /Rotate, CropBox e UserUnit sono quelli che si vedono; R in pt fisici del foglio): V = incrocio delle rette prolungate; theta = angolo fra le parti tenute; distanza di tangenza t = R / tan(theta/2); centro = V + R / sin(theta/2) lungo la bisettrice; l'arco copre 180 - theta gradi. *Da che parte stare*: i due clic che scelgono i tratti decidono quale dei quattro raccordi possibili si ottiene (nessun terzo clic): la parte tenuta di un tratto e' quella dove si e' cliccato rispetto al vertice V; se il tratto sta tutto da una parte di V la decide il tratto. *Costruzione* (strumento **senza pulsante in palette**, si arma da Inserisci > Raccordo; resta armato dopo ogni raccordo; Esc, `Annulla` senza niente in corso o un altro strumento lo disarmano): (1) **"Raccordo: scegli il primo tratto"**, (2) **"Raccordo: scegli il secondo tratto"**, (3) tastierino per il raggio. La scelta dei tratti e' quella della quota angolare "da due linee" (solo Rette e Linee, il PIU' VICINO entro 10 px col mouse e 22 px col dito, evidenziato al passaggio del mouse e dopo la scelta); nessun oggetto a portata: messaggio di una riga e nessun cambio di stato. *Tastierino*: titolo "Raccordo", riga informativa **"Raggio in mm reali · scala 1:N"** oppure **"Raggio in mm sul foglio (pagina non calibrata)"** (stessa regola della griglia), valore proposto = l'ultimo raggio usato nella sessione (solo in memoria, non nel file; la prima volta 5), il primo tasto lo sostituisce; "OK" rifiuta senza chiudere: testo non numerico, zero o negativo, oltre 100000 mm, raggio troppo grande per un tratto ("Raggio troppo grande per il tratto 1: il raccordo uscirebbe dal tratto."), il tratto che non arriva al raccordo, tratti quasi sulla stessa retta (l'arco coprirebbe meno di 1 grado), tratto interno di una Linea e tratti non consecutivi della stessa Linea. *Anteprima* (solo a schermo, mai esportata): i due tratti evidenziati e l'arco con il raggio che si digita (con il tratto che avra'), che sparisce se il raggio non e' realizzabile. *Che cosa cambia*: due oggetti diversi: l'estremo vicino di ogni tratto e' sostituito dal punto di tangenza (solo se e' il primo o l'ultimo punto della Linea); **spigolo di una Linea** (due tratti consecutivi): la Linea si SPEZZA in due Linee (la prima conserva id e tratto, la seconda e' nuova con lo stesso tratto e sta subito dopo nell'elenco) piu' l'arco; spigolo del punto di chiusura di una Linea chiusa: la Linea resta una. L'arco ha il tratto (stile, colore, spessore) **copiato dal primo tratto scelto** e va in fondo all'elenco. *Barra contestuale*: solo il testo guida (una riga) e `Annulla` (come l'Origine armata): stessa altezza fra i passi e uguale a quella dell'Origine a 390 x 780 con A+ 14 / 16 / 18 / 20 / 22 (100 / 103 / 111,5 / 120 / 128,5 px con l'area sicura di prova), nessun elemento oltre i 390 px; il tastierino ha la stessa altezza di quello della Quota senza scala. *Non in questa tappa*: Cerchio o Arco come tratti, raggio zero, modalita' "senza taglio", raccordo di tutti gli spigoli, raccordi associati, tratti intermedi, smusso.
- Tastierino: compare solo mentre si scrive; iPhone in verticale in basso al posto di barre, palette e pulsanti sul foglio; in orizzontale a destra del foglio; desktop sotto il foglio. Mostra titolo, riga informativa (valore automatico e scala, o "Pagina non calibrata"), il valore (non e' un campo di testo: la tastiera di sistema non compare) con il cursore in coda e, se il valore e' proposto, la selezione.
- Tasti >= 44 x 44 pt.

Coperture e Seleziona (CP4)
- Copertura: strumento in palette (icona quadrato). Forme nella barra contestuale: `Rettangolo`, `Quadrato`, `Cerchio` (tre pulsanti >= 44 px). Rettangolo: due angoli opposti; Quadrato: un angolo e un secondo punto che da' direzione e misura (il lato e' il maggiore tra lo spostamento orizzontale e quello verticale sul foglio mostrato; il mirino e la lente mostrano gia' l'angolo squadrato); Cerchio: centro e un punto sul bordo. ORTO non si applica.
- Aspetto: riempimento **bianco pieno, senza bordo**. Sullo schermo, **solo in costruzione e da selezionata**, un contorno sottile in `cad.measure` (1.5 px fissi); il contorno non fa parte del disegno e non viene esportato.
- Ordine: le coperture stanno SEMPRE sotto linee, quote e testi, qualunque sia l'ordine di creazione (uno strato separato sotto agli altri oggetti); tra coperture vale l'ordine di creazione.
- Seleziona: un tocco sceglie l'oggetto **in primo piano** entro la tolleranza (22 px col dito, 10 col mouse, la stessa di Cancella; le coperture, sotto tutto, vincono solo se non c'e' altro a portata). Evidenziazione in `cad.measure`: alone di 5 px sulle linee, cornice di 1.5 px con velo leggero su testi, badge e coperture. La barra contestuale dice "Selezionata: Retta" (testo breve: la barra non deve cambiare altezza, altrimenti il foglio si ridimensiona sotto il dito).
- Spostare: trascinare l'oggetto **selezionato** lo sposta (segue il dito, un solo comando annullabile); trascinare altrove sposta la vista. Un secondo dito durante il trascinamento annulla lo spostamento e passa al pinch. Una quota spostata trasla tutti i suoi punti; il valore automatico non cambia.
- **Selezione multipla (CP6e, decisioni 60 e 75-81 di docs/PIANO.md)**: solo da PC. **Ctrl + clic** (o Cmd + clic) su un oggetto non selezionato lo **aggiunge**, su uno selezionato lo **toglie**, nel vuoto non cambia niente; un clic semplice riduce la selezione a quell'oggetto (nel vuoto la azzera). Con Ctrl premuto all'inizio del gesto non parte il trascinamento. Evidenziazione: l'**unione** delle forme, con lo stesso alone e la stessa cornice di un oggetto solo (nessun riquadro complessivo). La barra contestuale dice «Selezionati: N oggetti» (una riga: la barra non cambia altezza). Trascinando uno qualsiasi degli oggetti selezionati si sposta **tutta** la selezione (un solo comando annullabile); **Canc** la cancella tutta (un solo Annulla). Con N >= 2 i controlli di stile **non lavorano sul gruppo**: il riquadro della barra resta al suo posto ma invisibile e il pannello delle proprieta' lo dice; le proprieta' dei nuovi oggetti non cambiano. Non c'e' il rettangolo di selezione.
- **Trasformazioni (CP6e)**: i pulsanti **Sposta**, **Specchio** e **Rotazione** stanno nella riga dei pulsanti della barra contestuale con lo strumento Seleziona (sempre presenti, disattivati senza selezione; la Rotazione anche senza un puntatore preciso con hover) e hanno una voce nel menu Modifica; **non** sono in palette. Sono strumenti a punti come la Retta: snap, griglia e ORTO (sul secondo punto) valgono, mirino e lente sul tocco. **Sposta**: punto base, poi punto di arrivo. **Specchio**: i due punti dell'asse (con ORTO l'asse e' orizzontale o verticale). **Rotazione**: il centro (un clic, o il pulsante **Origine** se la pagina ne ha una) e poi l'angolo in una **casella numerica** della barra, come la shell: gradi decimali con il punto, **positivo = antiorario** come si vede sul foglio, la virgola non si accetta, massimo 3600; la casella prende il fuoco dopo il centro. Durante la trasformazione la barra mostra l'interruttore **Mantieni l'originale** (spento di partenza, stato di sessione: non si salva) e **Annulla**; **Seleziona** resta acceso in palette. **Anteprima** solo a schermo (mai esportata) degli oggetti come diventerebbero: semitrasparenti, le coperture solo in contorno; se la trasformazione non e' ammessa non c'e' anteprima e il motivo sta nella riga di stato. **Esc** annulla la trasformazione (la selezione resta), **Ctrl+Z** toglie l'ultimo punto indicato; cambiare pagina o strumento la annulla. **Tutto o niente** e restrizioni (decisione 78): il testo si sposta ma resta dritto (Specchio e Rotazione muovono il centro del suo riquadro); le quote orizzontali e verticali non ruotano e si specchiano solo con un asse orizzontale o verticale; le coperture rettangolari e quadrate ruotano solo di multipli di 90 gradi e si specchiano solo con un asse orizzontale, verticale o a 45 gradi. Dopo l'operazione si resta con Seleziona e la selezione passa agli oggetti trasformati (o alle copie). Il risultato non deve uscire dai limiti del file (+-1.000.000 pt) ma puo' uscire dal foglio. Messaggi di una riga con il genere giusto ("Retta specchiata. Annulla la rimette a posto.", "3 oggetti ruotati. Annulla li rimette a posto.").
- Proprieta' dell'oggetto selezionato: gli stessi controlli dei nuovi oggetti (inspector su desktop, riquadro con la linea in miniatura su iPhone) lavorano sull'oggetto selezionato: linee e quote tipo/colore/spessore, testi e quote altezza; ogni modifica e' annullabile. La copertura non ha proprieta' (nessun riquadro). Senza selezione i controlli valgono per i nuovi oggetti, come prima.
- Palette: con Seleziona le voci visibili su iPhone sono 9 (Distanza sta nella colonna sul foglio) e la barra scorre in orizzontale; 9 voci da 44 pt non entrano nei 390 px. Quando cambia lo strumento attivo (anche dal menu o dalla barra di stato) la barra scorre fino al pulsante attivo, che resta tutto in vista (decisione 15 di `docs/PIANO.md`).
- **Adatta alla pagina nella palette (aggiunta a CP6e, decisione 83)**: sul **desktop** (da 720 px) in fondo alla colonna della palette, sotto gli strumenti e staccato da loro da un filetto, un pulsante **solo icona** (la stessa icona `maximize` del pulsante dell'iPhone, titolo e nome accessibile "Adatta alla pagina", stessa larghezza e altezza degli strumenti, stesso anello del fuoco). Fa quello che fanno la voce del menu Zoom e il valore percentuale della barra superiore: porta la **pagina intera** nella vista (`viewer.fit()`); non e' uno strumento (niente `aria-pressed`, non e' tra gli 11 strumenti) e non cambia strumento, selezione, costruzione in corso o storia. Disattivato senza documento. Sta in un contenitore *sticky* in fondo alla palette: con la finestra bassa gli strumenti scorrono e il pulsante resta in vista; in fondo allo scorrimento l'ultimo strumento sta sopra di lui. **Nascosto** sotto i 720 px (palette orizzontale dell'iPhone, misurata) e col tocco con poca altezza (`(pointer: coarse) and (max-height: 500px)`, dove lo zoom sta nei pulsanti sul foglio): li' c'e' gia' quello della colonna fluttuante, e se ne vede uno solo.
- Colonna sul foglio: Distanza solo icona (nome in `aria-label` e `title`), colonna larga come i pulsanti (46 px) (decisione 16).
- **Shell (CP6d, decisioni 59 e 71)**: con un'origine sulla pagina, uno tra Retta, Linea e Cerchio attivo e un puntatore preciso con hover (mouse, trackpad: `(hover: hover) and (pointer: fine)`; **non** su iPhone e iPad), nella barra contestuale compare una **casella** nella parte centrale, tra il testo guida e i pulsanti (nella riga dei pulsanti, quindi la barra non cambia altezza), con a destra l'unita' (`mm reali` / `mm foglio`). Segnaposto `X;Y` (`raggio` quando il Cerchio aspetta il raggio). `X;Y` relative all'origine: separatore `;`, decimali con `.`, segno `-`, spazi attorno ai valori ignorati, niente esponenziale; la **virgola non si accetta** ("Usa il punto per i decimali e «;» per separare X e Y."). Invio conferma e il punto vale come uno indicato col mouse (si puo' proseguire con l'uno o con l'altra); i punti digitati sono **esatti** (nessuno snap, griglia, ORTO o squadratura). Cerchio: `X;Y` del centro, poi UN numero per il raggio (il punto sul bordo e' il centro + il raggio lungo +X del foglio mostrato). Linea: un `X;Y` per punto, `Fine` o Invio a casella vuota termina. Esc svuota la casella; a casella vuota annulla la costruzione. Backspace, Canc e Ctrl+Z nella casella valgono per il testo della casella. Testi guida di una riga ("Retta: indica o digita X;Y del punto iniziale").
- **Cerchio e arco (CP6c, V2b)**: strumento in palette (icona cerchio, titolo "Cerchio e arco"), forma nella barra contestuale: `Cerchio`, `Arco` (due pulsanti >= 44 px col tocco; stesso modello della Copertura). Sono oggetti a **linea** (tipo di linea, colore, spessore come la Retta), **non** la Copertura circolare bianca. Cerchio: centro, poi un punto sul bordo (2 punti). Arco: inizio, un punto sull'arco, fine (3 punti; tre punti allineati o quasi, sotto 1 grado di sweep, si rifiutano con "I tre punti sono allineati: un arco non passa da tre punti su una retta."). Testi guida di una riga. ORTO non si applica; snap e griglia come per ogni punto. Anteprima solo a schermo: cerchio dopo il centro; arco dopo il primo punto la corda, dopo il secondo l'arco con il cursore come fine. Si scelgono con un tocco **sulla linea**, non dentro. Menu Inserisci: `Cerchio`, `Arco`, `Raccordo` (disattivata, V2c).

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
  - Generazione ("Copertura semplice"): "Esporta" produce il PDF **senza** aprire il foglio di condivisione (su iPhone share() riesce solo dentro il gesto: CP0). Durante il lavoro il dialogo mostra l'avanzamento ("Scrittura delle pagine con oggetti: 3 di 12") e non si puo' chiudere (in "Appiattito", dal 5c, c'e' il pulsante `Annulla`: vedi sotto).
  - Pronto: riepilogo (nome, dimensione calcolata, pagine riscritte, controllo di riapertura, tempo), eventuali **avvisi** in italiano (per esempio annotazioni che restano sopra le coperture) e tre pulsanti: `Chiudi`, `Scarica` (blob `application/octet-stream`, si salva in Download) e `Condividi` (foglio di condivisione con un File `application/pdf`, chiamato direttamente dal tocco). Se il browser non puo' condividere file (`navigator.canShare` assente o `canShare({files})` falso) il dialogo lo scrive in una riga; l'annullamento del foglio di condivisione non e' un errore ("Condivisione annullata.").
  - Errore: titolo, messaggio in italiano ("... nulla e' stato perso"), dettaglio tecnico (inglese, dalle librerie) e `Chiudi` / `Riprova`; il lavoro non viene toccato.
  - Con iPhone in orizzontale il dialogo scorre dentro lo schermo (altezza = altezza visibile, `100dvh` con ripiego `100vh`).

- **Realizzato in CP5c** (Annulla, Salva con nome, Apri progetto, modifiche non salvate):
  - Annulla in "Appiattito": durante la generazione il pulsante `Annulla` (>= 44 px) e' attivo; ferma l'esportazione tra una pagina e l'altra (la pagina in corso finisce: "Annullamento: finisco la pagina in corso…") e il dialogo torna alla scelta con "Esportazione annullata. Nulla e' stato scritto." In "Copertura semplice" resta disattivato.
  - **Salva con nome** (`ui/saveDialog.ts`): scelta (PDF, Nuovo file `<nome del PDF senza .pdf>.json`, Pagine con oggetti `N di M`, Oggetti, Scale; riga su cio' che non si salva; avviso se il browser non calcola l'impronta SHA-256; nessuna stima di byte o di tempo), generazione senza aprire il foglio di condivisione, **Progetto pronto** (File, Dimensione, Pagine, Oggetti, Scale, Impronta SHA-256, Controllo "riletto e validato", Tempo) con `Chiudi`, `Scarica` e `Condividi` come in Esporta PDF (`application/json` per Condividi, `octet-stream` per Scarica); dopo la consegna il messaggio dice che l'app non puo' sapere se il file e' arrivato. Errore: "Salvataggio non riuscito", `Chiudi` / `Riprova`, lavoro intatto.
  - **Apri progetto** (`ui/openProjectDialog.ts`), in due passi: il selettore del `.json`, poi il dialogo con il riepilogo ("Progetto di X: N pagine, M oggetti, K scale.", File progetto, PDF atteso, Pagine con oggetti, Oggetti, Scale, Impronta SHA-256 presente/assente), `Annulla` e **`Scegli il PDF…`** (apre il selettore dal tocco, mai da codice). Esiti: "Progetto aperto." (stesso file); **"Non è lo stesso file"** con `Annulla` (a fuoco) e `Procedi` (stessa geometria, impronta diversa o assente); **"PDF non corrispondente"** con la prima differenza, `Chiudi` e `Scegli un altro PDF…` (geometria o numero di pagine diversi); **"PDF non apribile"**. Il documento aperto non cambia finche' non si conferma. File non valido: "Progetto non valido" con il motivo e la posizione.
  - **Modifiche non salvate**: dialogo "Modifiche non salvate" (`Annulla` / `Procedi`) per Apri, Apri progetto e Chiudi solo se ci sono modifiche dall'ultimo salvataggio o apertura; Esporta PDF non conta come salvataggio. Tutti i pulsanti >= 44 px; i dialoghi scorrono dentro lo schermo in orizzontale come quello di Esporta PDF.
  - Pannello (icona in alto a destra): in fondo il collegamento "Licenze e componenti di terze parti" (testi di licenza del sito, `licenses/`).
- **Realizzato in CP5d** (strumenti di lettura, nessun cambio di layout): in fondo al pannello App il riquadro richiudibile "Diagnostica tocco e schermo" (finestra, visualViewport, margini di sicurezza, vh/dvh, tipo di puntatore, altezza di barre e visore; zoom del documento e della pagina intera; puntatori nella mappa e ultimi 30 eventi; dove e' caduto il dito) con `Copia`; in Diagnostica la scheda "Prova menu" (schermata come l'editor con un menu di 12 voci e i contatori in diretta).
- **Realizzato in CP5e** (layout in orizzontale; decisioni 39-42 di docs/PIANO.md): da 720 px di larghezza intestazione e barra di stato stanno su **una riga** a qualunque larghezza (se non entra tutto la riga scorre in orizzontale, senza barra visibile; il bordo di fuoco dei pulsanti e' disegnato dentro); il pannello "Nessun documento aperto" sta dentro il visore e scorre se non entra (su touch con poca altezza: logo da 88 px accanto a titolo, "Apri PDF…", frase e "PDF di prova"; "Apri PDF…" >= 44 px anche a A+ 14); nel riquadro "Diagnostica tocco e schermo" le righe "griglia .app", "intestazione", "stato" e "contestuale" (altezza, padding su/giu', righe visive, larghezza visibile e del contenuto). La barra contestuale non e' cambiata.

Menu
- File: Apri, Apri progetto, Salva con nome, Esporta PDF, Chiudi (niente "Nuovo", decisione 27/10/2026), poi dopo il separatore Diagnostica. Salva con nome, Esporta PDF e Chiudi sono disattivati senza un PDF aperto; Apri e Apri progetto sono sempre attivi (5c, decisione 29 di docs/PIANO.md).
- Modifica: Annulla, Ripeti, Seleziona/sposta, **Sposta selezione, Specchia selezione, Ruota selezione, Duplica selezione, Cancella selezione** (CP6e: attive con lo strumento Seleziona e almeno un oggetto selezionato; la Rotazione anche solo con mouse o trackpad; **Duplica** crea copie sul posto e le seleziona; **Cancella selezione** cancella tutta la selezione con un solo Annulla), Cancella (attiva lo strumento Cancella, un oggetto per volta). La voce «Copia» non c'e' piu': Duplica e «Mantieni l'originale» la coprono e non c'e' un appunti.
- Inserisci: Linea (tipi di linea), Retta, Cerchio, Arco, Raccordo, Testo, Quota (allineata, orizzontale, verticale, diametro Ø, raggio R, **angolare da due linee e da tre punti**, CP6g), Copertura bianca (rettangolo, quadrato, cerchio).
- **Origine (CP6d, decisioni 58 e 72 di docs/PIANO.md)**, tra Inserisci e Zoom: `Imposta origine` (arma l'Origine come strumento **a un colpo**: il clic imposta, o sposta, l'origine della pagina e si torna allo strumento di prima; Esc, `Annulla` o un altro strumento la disarmano) e `Rimuovi origine` (disattivata se la pagina non ne ha una). Entrambe disattivate senza un PDF aperto. L'Origine **non e' in palette**. Ogni cambio e' un passo di Annulla/Ripeti.
- Zoom: zoom documento (separato da `A-` / `A+`).
- Pulsante Distanza sempre raggiungibile.
- Un menu piu' alto dello spazio sotto il pulsante (iPhone in orizzontale, `A+`) scorre in verticale: tutte le voci raggiungibili, voci >= 44 px sui dispositivi touch; se entra non cambia nulla (decisione 17).

## 7. Fuori dalla V1

Tolleranze (campi, classi), Livelli, funzioni CNC, stampa, account/registrazione. Nessuna decisione per le fasi successive.

## 8. Punti aperti (da decidere o provare)

- Lente: forma e dimensioni definitive (provare su iPhone reale).
- Separatore decimale: deciso il 27/10/2026: mostrato sempre ".", in digitazione la "," e' accettata e normalizzata a "." (campi dei numeri, tastierino); **fa eccezione la shell (CP6d, decisione 59): li' la virgola e' rifiutata**. Tasto decimale del tastierino numerico italiano sul PC: NON VERIFICATO (domanda all'utente). Tasto segno meno per valori negativi: non serve nelle quote (valori positivi); aperto per il futuro.
- Snap su Estremo e Punto medio: **realizzato in CP6a (V2a)**; raggio di cattura (10 px mouse, 22 px dito) e soglia della griglia (8 px) da tarare sul PC; marcatore nella lente e X/Y sul punto agganciato: da decidere (docs/PIANO.md, "Scelte di CP6a").
- Schermate non ancora disegnate: menu aperti. Coperture, Seleziona, Cancella e i layout ABC e simboli sono stati realizzati in CP3-CP4 seguendo questo file.
- Colonna di pulsanti sul foglio: copre ancora una striscia del foglio (12 % della larghezza a pagina intera, 390 x 780); l'eventuale pulsante apri/chiudi si decide dopo la prova su iPhone (decisione 16).
- Layout iPhone definitivo da tarare su dispositivo.
