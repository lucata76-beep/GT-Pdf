// Oggetti di prova per le prove di esportazione (e2e-cp5a.cjs, perf-cp5a.cjs): descrizioni per `__gtpdf.addSpecs` del build di prova.
/** Oggetti di prova per ogni pagina: tutti i tipi, in coordinate frazionarie dell'area visibile (spazio utente, origine in basso a sinistra). */
function fullSpecs() {
  return [
    // coperture sotto a tutto, create per prime e per ultime (l'ordine di creazione non conta: stanno sotto)
    { k: 'cover', shape: 'rect', a: [0.02, 0.895], b: [0.55, 0.99] }, // sul testo del titolo
    { k: 'cover', shape: 'circle', a: [0.5, 0.58], b: [0.5 + 0.06, 0.58] }, // sul disegno (cerchi e assi)
    { k: 'cover', shape: 'rect', a: [0.03, 0.05], b: [0.42, 0.115] }, // sul riferimento 100 mm e il suo testo
    { k: 'cover', shape: 'square', a: [0.64, 0.3], b: [0.75, 0.31] }, // quadrata sul disegno
    // linee: ogni tipo
    { k: 'segment', pts: [[0.1, 0.2], [0.4, 0.22]], style: 'solid', color: '#D32F2F', w: 1 },
    { k: 'segment', pts: [[0.1, 0.25], [0.4, 0.27]], style: 'dashed', color: '#1565C0', w: 1 },
    { k: 'segment', pts: [[0.1, 0.3], [0.4, 0.32]], style: 'dashdot', color: '#2E7D32', w: 2 },
    { k: 'segment', pts: [[0.45, 0.2], [0.6, 0.22]], style: 'dashed', color: '#6A1B9A', w: 0.5 },
    { k: 'segment', pts: [[0.45, 0.25], [0.6, 0.27]], style: 'dashdot', color: '#E65100', w: 3 },
    { k: 'polyline', pts: [[0.7, 0.2], [0.8, 0.26], [0.75, 0.33], [0.9, 0.36]], style: 'solid', color: '#1E232A', w: 1.5 },
    { k: 'polyline', pts: [[0.7, 0.1], [0.85, 0.12], [0.8, 0.17], [0.95, 0.15]], style: 'dashed', color: '#00796B', w: 1 },
    // quote: tutti i tipi, valore automatico (con scala) e digitato
    { k: 'dim', dim: 'aligned', pts: [[0.2, 0.45], [0.45, 0.5], [0.3, 0.4]] },
    { k: 'dim', dim: 'horizontal', pts: [[0.2, 0.7], [0.5, 0.74], [0.35, 0.8]], value: 'Ø8 ±0.1', color: '#1565C0' },
    { k: 'dim', dim: 'vertical', pts: [[0.8, 0.45], [0.83, 0.7], [0.88, 0.55]] },
    { k: 'dim', dim: 'diameter', pts: [[0.3, 0.58], [0.7, 0.58]] },
    { k: 'dim', dim: 'radius', pts: [[0.5, 0.58], [0.62, 0.66]], value: 'R12.5', color: '#6A1B9A', w: 0.75, pt: 8 },
    // testi
    { k: 'text', at: [0.06, 0.93], text: 'SOPRA LA COPERTURA', pt: 10, color: '#D32F2F' },
    { k: 'text', at: [0.1, 0.12], text: 'FORO Ø8 ±0.1 90° R12', pt: 14, color: '#1565C0' },
    { k: 'text', at: [0.55, 0.4], text: 'Ø25.40 ±0.05', pt: 6, color: '#1E232A' },
  ];
}

/** Contenuto di una pagina sintetica (riquadro, cerchio, titolo in alto a sinistra) per le pagine create dalle prove. */
function drawRaw(x0, y0, w, h) {
  const cx = x0 + w / 2;
  const cy = y0 + h * 0.58;
  const r = Math.min(w, h) * 0.27;
  const k = 0.5523 * r;
  return [
    `0.4 w ${x0 + 3} ${y0 + 3} ${w - 6} ${h - 6} re S`,
    `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c S`,
    `[4 2] 0 d ${cx - r * 1.1} ${cy} m ${cx + r * 1.1} ${cy} l S [] 0 d`,
    `BT /F1 ${Math.max(5, h / 55)} Tf ${x0 + 8} ${y0 + h - 14} Td (TITOLO FITTIZIO SINTETICO) Tj ET`,
    `BT /F1 ${Math.max(4, h / 70)} Tf ${x0 + 8} ${y0 + h - 24} Td (seconda riga del titolo) Tj ET`,
    `BT /F1 ${Math.max(4, h / 70)} Tf ${x0 + 8} ${y0 + 12} Td (RIFERIMENTO FITTIZIO) Tj ET`,
  ].join('\n');
}

module.exports = { fullSpecs, drawRaw };
