# DESIGN.md - Editor PDF con quote

## 1. Vision & Archetype
**Editor PDF con quote** è uno strumento web CAD/CAM puro, orientato all'officina meccanica e programmatori CNC.
- **Filosofia:** Zero registrazione, zero cloud, esecuzione locale, latenza zero.
- **Estetica:** Industriale, sobria, ad alto contrasto, priva di fronzoli o gradienti cosmetici. Richiama software tecnici storici e moderni (AutoCAD, DraftSight, Fusion 360, Mastercam) uniti alla reattività del web moderno.

---

## 2. Design Tokens

### Color Palette
- **Canvas / Sfondo CAD:** `#E2E5E9` (sfondo neutro che stacca nettamente il foglio PDF bianco)
- **Foglio Documento:** `#FFFFFF` (bianco puro con bordatura tecnica 1px `#B0B7C1` e ombra netta `0 2px 8px rgba(0,0,0,0.12)`)
- **Pannelli UI & Barre:** `#F4F5F7` (grigio chiaro ingegneristico)
- **Superfici Header/Toolbar:** `#ECEEF1`
- **Bordi & Separatori:** `#CBD0D8` (linea netta 1px)
- **Testo Primario:** `#191D23` (massima leggibilità sotto luce d'officina)
- **Testo Secondario:** `#555D6A`
- **Accento Primario / Selezione / Strumento Attivo:** `Safety Orange` (`#E65100` / `#FF6D00`)
- **Evidenziazione Snap / Coordinate:** `Precision Cyan` (`#00838F`) e `Emerald Snap` (`#00796B`)
- **Quotature sul disegno:** Rosso tecnico `#D32F2F` o Blu CAD `#1565C0` con frecce normalizzate DIN/ISO

### Tipografia
- **UI Sans:** `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif.
  - Pesi: 400 (Regular), 500 (Medium), 600 (Semi-bold).
  - Dimensioni: 11px (micro-labels/coordinate), 13px (toolbars/bottoni), 14px (dialogs), 16px (titoli modali).
- **Valori Numerici & Coordinate (Monospace):** `JetBrains Mono`, `SF Mono`, `Consolas`, monospace.
  - Dimensioni: 12px - 14px tabulari (`font-variant-numeric: tabular-nums`).

### Dimensioni & Spaziature
- Griglia base: 4px / 8px.
- Bordi: Raggio 2px o 4px max (nessun bordo arrotondato 'pill' o giocoso).
- Hit area mobile: Tassativamente $\ge 44 \times 44$ px con distanziamento netto.

---

## 3. Componenti Chiave

1. **Toolbar Superiore / Desktop Menu Bar:**
   - Dropdown tecnici: `File`, `Modifica`, `Inserisci`, `Zoom`.
   - Controlli dimensione testo interfaccia `A-` / `A+` indipendenti dallo zoom PDF.
   - Zoom documento con input numerico percentuale e pulsanti rapidi.

2. **Toolbar Verticale / Mobile Bottom Bar:**
   - Icone a tratto sottile (1.5px / 2px) chiare e universali (Retta, Cerchio, Quota, Arco, Raccordo, Calibra scala, Distanza, Copertura bianca).
   - Stato attivo: fondo arancio di sicurezza `#E65100` con icona bianca e bordatura netta.

3. **Status Bar Inferiore (Desktop):**
   - Coordinate del cursore in tempo reale: `X: 142.50 mm  Y: 88.25 mm`.
   - Stato calibrazione: `Scala: 1:1 (Calibrata 50.00 mm = 283.46 px)`.
   - Snap toggle ad attivazione singola: `[Estremo] [Punto medio] [Centro] [Intersezione] [Ortogonale] [Griglia]`.

4. **Lente d'Ingrandimento Mobile (Magnifier Loupe):**
   - Diametro 84px circolare o squadrata 80x80px con reticolo a croce (`crosshair`) e mirino snap magnetico, posizionata con offset di 70px sopra il punto di tocco del dito.

5. **Tastierino Numerico Su Schermo (Custom On-Screen Keypad per iPhone):**
   - Tastiera CAD specializzata per inserimento quote senza intralciare lo schermo con la tastiera di sistema.
   - Tasti rapidi dedicati: `Ø` (diametro), `R` (raggio), `°` (angolo), `+/-`, `.` (punto decimale), cifre `0-9`, tasti `ABC` e simboli, `OK` (primario arancio), `Annulla`.

6. **Finestre Modali Tecniche:**
   - **Calibra scala:** Selezione di due punti noti sul disegno, indicazione pixel misurati, campo interattivo `Distanza reale`, selettore unità (`mm`), bottoni `Applica` e `Annulla`.
   - **Esporta PDF:** Selezione metodo (`Copertura semplice` vs `Appiattito`), selettore DPI (150, 300, 600 DPI), avvertenze tecniche chiare su testo vettoriale o raster.
