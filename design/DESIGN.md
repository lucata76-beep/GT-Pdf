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
- Tutti i numeri (coordinate, quote, scale, input numerici, ΔX/ΔY): `JetBrains Mono`, fallback `"SF Mono", Consolas, monospace`, con `font-variant-numeric: tabular-nums`.
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
- Linee di estensione sottili, frecce, testo in `JetBrains Mono`. Etichetta in badge bianco, raggio 2px, bordo 1px. Colore: `dimension-default` (modificabile). In costruzione: `measure`.
- Prefissi: `Ø` solo per quota di diametro, `R` solo per raggio.
- Stile esatto di frecce e proporzioni: da fissare in implementazione e mostrare all'utente (riferimento DIN/ISO NON VERIFICATO).
- Tipi di quota: lineare (allineata, orizzontale, verticale), diametro, raggio. Valore automatico dalla scala oppure digitato.

Snap
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
- `ABC TESTO` e `#$& SIMBOLI` aprono layout con lettere e simboli nella stessa griglia (nei mockup non e' disegnato).

Dialog Calibra scala
- L'utente seleziona due punti noti; l'app mostra la distanza misurata in unita' PDF (pt, 1/72 in) e in mm sul foglio. Campo "Distanza reale" + unita' (`mm`). Pulsanti Applica e Annulla.
- Formule (verificate: 100 mm = 283.46 pt):
  - `foglio_mm = d_pt * 25.4 / 72`
  - `mm_reali_per_pt = L_reale_mm / d_pt`
  - scala 1:N con `N = L_reale_mm / foglio_mm` (esempio: 100 mm reali su 283.46 pt = 100 mm di foglio = 1:1)
- Mai pixel di schermo: dipenderebbero dallo zoom. La scala e' per pagina.

Dialog Esporta PDF
- Predefinito: **Copertura semplice** - "Il testo sotto le coperture resta nel file."
- **Appiattito** - "Le pagine diventano immagini: il testo sotto sparisce." Mostrare la scelta DPI (150, 300, 600).
- Un DPI e' selezionabile solo se `(larghezza_px * altezza_px)` della pagina non supera il limite del canvas del dispositivo; altrimenti disabilitato con il motivo.
  - Limite di partenza: 16.777.216 px per canvas (fonti del 2022, NON VERIFICATO sull'iOS attuale: da provare su iPhone reale; un'altra fonte indica 5.242.880 px).
  - Pixel calcolati: A4 150 dpi = 2.174.960; A4 300 dpi = 8.699.840; A4 600 dpi = 34.806.376; A3 150 dpi = 4.349.920; A3 300 dpi = 17.403.188; A3 600 dpi = 69.605.736. Calcolare sempre sulla dimensione reale della pagina.
- Nessuna stima di peso del file inventata: mostrare un valore solo se calcolato.
- Riepilogo: nome file, pagine, modalita', DPI. Pulsanti Annulla ed Esporta.

Menu
- File: Nuovo, Apri, Salva con nome, Esporta PDF, Chiudi.
- Modifica: Annulla, Ripeti, Seleziona/sposta, Copia, Duplica, Cancella.
- Inserisci: Linea (tipi di linea), Retta, Cerchio, Arco, Raccordo, Testo, Quota, Copertura bianca (rettangolo, quadrato, cerchio).
- Zoom: zoom documento (separato da `A-` / `A+`).
- Pulsante Distanza sempre raggiungibile.

## 7. Fuori dalla V1

Tolleranze (campi, classi), Livelli, funzioni CNC, stampa, account/registrazione. Nessuna decisione per le fasi successive.

## 8. Punti aperti (da decidere o provare)

- Lente: forma e dimensioni definitive (provare su iPhone reale).
- Tasto segno meno per valori negativi e separatore decimale: accettare sia "." sia "," (proposta, da confermare).
- Schermate non ancora disegnate: coperture bianche, copia/duplica, cancella, layout ABC e simboli, menu aperti. Realizzarle seguendo questo file.
- Layout iPhone definitivo da tarare su dispositivo.
