import { describe, expect, it } from 'vitest';
import type { DimType } from '../geometry/dimension';
import type { PageObject } from '../model/model';
import { LIMITS, type Project, PROJECT_FORMAT, PROJECT_VERSION, objectToJson, parseProject, serializeProject, verifyProjectText } from './format';

const sampleObjects = (): PageObject[] => [
  { id: 3, kind: 'cover', shape: 'rect', p1: { x: 10, y: 20 }, p2: { x: 110.5, y: 220.25 } },
  { id: 4, kind: 'cover', shape: 'square', p1: { x: 1, y: 2 }, p2: { x: 51, y: 52 } },
  { id: 5, kind: 'cover', shape: 'circle', p1: { x: 300, y: 300 }, p2: { x: 340, y: 300 } },
  { id: 6, kind: 'segment', points: [{ x: 0.1, y: 0.2 }, { x: 99.9, y: 0.30000000000000004 }], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } },
  { id: 7, kind: 'polyline', points: [{ x: 1, y: 1 }, { x: 5, y: 9 }, { x: 8, y: 3 }], stroke: { style: 'dashdot', color: '#1565C0', widthPt: 0.25 } },
  { id: 8, kind: 'polyline', points: [{ x: 1, y: 1 }, { x: 5, y: 9 }], stroke: { style: 'dashed', color: '#00796B', widthPt: 20 } },
  { id: 9, kind: 'text', at: { x: 50, y: 60 }, text: 'FORO Ø8 ±0.1 90° è più', textPt: 10, color: '#1E232A' },
  ...(['aligned', 'horizontal', 'vertical', 'diameter', 'radius'] as DimType[]).map(
    (dim, i): PageObject => ({ id: 20 + i, kind: 'dim', dim, p1: { x: 10, y: 10 + i }, p2: { x: 60, y: 10 + i }, a: { x: 10, y: 30 + i }, b: { x: 60, y: 30 + i }, valueText: i % 2 === 0 ? null : `Ø${i}.5 ±0.1`, color: '#6A1B9A', widthPt: 0.75, textPt: 8 }),
  ),
];

const sampleProject = (): Project => ({
  app: 'abc1234',
  pdf: { name: 'Disegno 1.pdf', size: 123456, sha256: 'ab'.repeat(32) },
  pages: [
    { number: 1, view: [0, 0, 595.276, 841.89], rotate: 0, userUnit: 1, scale: { mmPerPt: 0.5 }, objects: sampleObjects() },
    { number: 2, view: [20, 30.5, 260, 360.25], rotate: 90, userUnit: 2.5, scale: null, objects: [] },
    { number: 3, view: [0, 0, 841.89, 1190.551], rotate: 270, userUnit: 1, scale: { mmPerPt: 0.35277777777777775 }, objects: [] },
  ],
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const asJson = (p: Project = sampleProject()): Json => JSON.parse(serializeProject(p)) as Json;

describe('formato del progetto: scrittura e lettura', () => {
  it('serializza i campi attesi (format, version, app, pdf, pages) e rilegge lo stesso progetto, oggetto per oggetto', () => {
    const p = sampleProject();
    const text = serializeProject(p);
    const j = JSON.parse(text) as Json;
    expect(Object.keys(j)).toEqual(['format', 'version', 'app', 'pdf', 'pages']);
    expect(j.format).toBe(PROJECT_FORMAT);
    expect(j.version).toBe(PROJECT_VERSION);
    expect(Object.keys(j.pdf)).toEqual(['name', 'size', 'sha256']);
    expect(j.pages).toHaveLength(3);
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual(p);
    expect(r.objectCount).toBe(sampleObjects().length);
    expect(r.scaleCount).toBe(2);
    expect(r.maxId).toBe(24);
    expect(serializeProject(r.project)).toBe(text); // lettura + riscrittura = identica
  });

  it('i numeri doppi tornano esatti (round-trip di JSON.stringify): 2000 valori casuali e valori difficili', () => {
    let seed = 42;
    const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const hard = [0.1 + 0.2, 1 / 3, Math.PI * 1000, 283.46456692913387, 5e-7, 123456.78901234567, -0.000123, 99999.99999999999, 2 / 3, 1e-10, 0.35277777777777775];
    const coords = [...hard, ...Array.from({ length: 1000 }, () => (rnd() - 0.5) * 2e5)];
    const scales = [...hard.filter((v) => v > 1e-6), ...Array.from({ length: 1000 }, () => 10 ** (rnd() * 6 - 3))];
    const p = sampleProject();
    p.pages[1]!.objects = coords.map((c, i): PageObject => ({ id: 100 + i, kind: 'segment', points: [{ x: c, y: coords[(i + 1) % coords.length]! }, { x: -c, y: c / 7 }], stroke: { style: 'solid', color: '#D32F2F', widthPt: 1 } }));
    p.pages[2]!.scale = { mmPerPt: scales[0]! };
    const r = parseProject(serializeProject(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = p.pages[1]!.objects;
    const b = r.project.pages[1]!.objects;
    for (let i = 0; i < a.length; i++) {
      const pa = (a[i] as { points: { x: number; y: number }[] }).points;
      const pb = (b[i] as { points: { x: number; y: number }[] }).points;
      for (let k = 0; k < 2; k++) {
        expect(Object.is(pb[k]!.x, pa[k]!.x), `x ${pa[k]!.x}`).toBe(true);
        expect(Object.is(pb[k]!.y, pa[k]!.y), `y ${pa[k]!.y}`).toBe(true);
      }
    }
    for (const s of scales) {
      const q = sampleProject();
      q.pages[0]!.scale = { mmPerPt: s };
      const rr = parseProject(serializeProject(q));
      expect(rr.ok && Object.is(rr.project.pages[0]!.scale!.mmPerPt, s), `mmPerPt ${s}`).toBe(true);
    }
  });

  it('lista bianca in scrittura: i campi in piu\' di un oggetto del modello NON finiscono nel file', () => {
    const o = { ...(sampleObjects()[3] as object), segreto: 'x', stroke: { style: 'solid', color: '#D32F2F', widthPt: 1, extra: 1 }, points: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5 }] } as unknown as PageObject;
    const text = JSON.stringify(objectToJson(o));
    expect(text).not.toContain('segreto');
    expect(text).not.toContain('extra');
    expect(text).not.toContain('"z"');
    for (const obj of sampleObjects()) {
      const keys = Object.keys(objectToJson(obj));
      const want = { cover: ['id', 'kind', 'shape', 'p1', 'p2'], segment: ['id', 'kind', 'points', 'stroke'], polyline: ['id', 'kind', 'points', 'stroke'], text: ['id', 'kind', 'at', 'text', 'textPt', 'color'], dim: ['id', 'kind', 'dim', 'p1', 'p2', 'a', 'b', 'valueText', 'color', 'widthPt', 'textPt'] }[obj.kind];
      expect(keys).toEqual(want);
    }
  });

  it('le quote automatiche restano automatiche (valueText null) e non si salva nessuna etichetta di scala', () => {
    const text = serializeProject(sampleProject());
    expect(text).toContain('"valueText":null');
    expect(text).not.toMatch(/"1:\d|:1"|scaleLabel|label/);
    expect(asJson().pages[0].scale).toEqual({ mmPerPt: 0.5 });
  });

  it('non si salvano cronologia, selezione, strumento, zoom, dimensione dell\'interfaccia e ORTO', () => {
    const text = serializeProject(sampleProject()).toLowerCase();
    for (const w of ['history', 'undo', 'redo', 'select', 'tool', 'zoom', 'uisize', 'ortho', 'orto']) expect(text, w).not.toContain(w);
  });

  it('non si salvano gli interruttori di snap (Estremo, Punto medio) e la griglia (visibilita\' e passo): stato della sessione; le chiavi del file sono quelle della versione 1', () => {
    const text = serializeProject(sampleProject());
    for (const w of ['snap', 'estremo', 'punto medio', 'griglia', 'grid', 'passo', 'step']) expect(text.toLowerCase(), w).not.toContain(w);
    const j = asJson();
    expect(Object.keys(j).sort()).toEqual(['app', 'format', 'pages', 'pdf', 'version']);
    expect(Object.keys(j.pages[0]).sort()).toEqual(['number', 'objects', 'rotate', 'scale', 'userUnit', 'view']);
    expect(j.version).toBe(1);
  });

  it('i campi sconosciuti si ignorano senza copiarli; __proto__ e constructor non arrivano mai sugli oggetti ne\' inquinano i prototipi', () => {
    const j = asJson();
    j.extra = { a: 1 };
    j.pdf.extra = 1;
    j.pages[0].extra = 'x';
    for (const o of j.pages[0].objects) {
      o.extra = 1;
      o['constructor'] = { prototype: { polluted: true } };
      Object.defineProperty(o, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
    }
    const text = JSON.stringify(j).replace('"extra":1', '"extra":1'); // __proto__ come chiave propria: JSON.stringify la scrive
    expect(text).toContain('"__proto__"');
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    for (const o of r.project.pages[0]!.objects) {
      expect(Object.keys(o)).toEqual(Object.keys(objectToJson(o)));
      expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
      expect((o as unknown as Record<string, unknown>).polluted).toBeUndefined();
    }
    expect(JSON.stringify(r.project)).not.toMatch(/extra|polluted|constructor|__proto__/);
  });

  it('il colore scritto in minuscolo si legge e si normalizza in maiuscolo; lo sha256 maiuscolo si normalizza in minuscolo', () => {
    const j = asJson();
    j.pdf.sha256 = 'AB'.repeat(32);
    j.pages[0].objects[3].stroke.color = '#d32f2f';
    const r = parseProject(JSON.stringify(j));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.pdf.sha256).toBe('ab'.repeat(32));
    expect((r.project.pages[0]!.objects[3] as { stroke: { color: string } }).stroke.color).toBe('#D32F2F');
  });

  it('sha256 null e\' valido (il browser non lo calcolava)', () => {
    const p = sampleProject();
    p.pdf.sha256 = null;
    const r = parseProject(serializeProject(p));
    expect(r.ok && r.project.pdf.sha256 === null).toBe(true);
  });
});

type Mut = [string, (j: Json) => void, RegExp];
const O = (j: Json, i = 0): Json => j.pages[0].objects[i];
const SEG = 3; // indice del segmento nell'elenco di sampleObjects (id 6)
const TXT = 6;
const DIM = 7;
const COV = 0;

const MUTATIONS: Mut[] = [
  // radice
  ['format diverso', (j) => (j.format = 'altro'), /non e' un progetto di GT-Pdf/],
  ['format mancante', (j) => delete j.format, /non e' un progetto di GT-Pdf/],
  ['versione futura', (j) => (j.version = 2), /versione piu' recente \(2\).*Aggiorna l'app/],
  ['versione 0', (j) => (j.version = 0), /Versione del progetto 0 non supportata/],
  ['versione non intera', (j) => (j.version = 1.5), /non e' un numero intero/],
  ['versione testo', (j) => (j.version = '1'), /non e' un numero intero/],
  ['app mancante', (j) => delete j.app, /app deve essere un testo/],
  ['app troppo lunga', (j) => (j.app = 'x'.repeat(LIMITS.appChars + 1)), /app: massimo/],
  ['pdf mancante', (j) => delete j.pdf, /pdf deve essere un oggetto/],
  ['pdf.name troppo lungo', (j) => (j.pdf.name = 'x'.repeat(LIMITS.nameChars + 1)), /pdf: name: massimo/],
  ['pdf.name numero', (j) => (j.pdf.name = 5), /pdf: name deve essere un testo/],
  ['pdf.size negativo', (j) => (j.pdf.size = -1), /pdf: size .* fuori dall'intervallo/],
  ['pdf.size decimale', (j) => (j.pdf.size = 10.5), /pdf: size deve essere un numero intero/],
  ['sha256 corto', (j) => (j.pdf.sha256 = 'ab'.repeat(31)), /sha256 deve essere null o 64/],
  ['sha256 non esadecimale', (j) => (j.pdf.sha256 = 'zz'.repeat(32)), /sha256 deve essere null o 64/],
  ['sha256 numero', (j) => (j.pdf.sha256 = 12), /sha256 deve essere null o 64/],
  ['pages non elenco', (j) => (j.pages = {}), /pages deve essere un elenco/],
  ['pages vuote', (j) => (j.pages = []), /non ha pagine/],
  // pagine
  ['pagina non oggetto', (j) => (j.pages[1] = 5), /pagina 2: la pagina deve essere un oggetto/],
  ['numero di pagina sbagliato', (j) => (j.pages[1].number = 5), /pagina 2: number deve essere 2/],
  ['view corta', (j) => (j.pages[0].view = [0, 0, 1]), /pagina 1: view deve avere 4 numeri/],
  ['view con testo', (j) => (j.pages[0].view = [0, 0, 'a', 5]), /pagina 1: view deve essere un numero/],
  ['view larghezza nulla', (j) => (j.pages[0].view = [5, 0, 5, 10]), /larghezza e altezza positive/],
  ['view fuori limite', (j) => (j.pages[0].view = [0, 0, 1e9, 10]), /fuori dall'intervallo/],
  ['rotate 45', (j) => (j.pages[0].rotate = 45), /rotate deve essere 0, 90, 180 o 270/],
  ['rotate testo', (j) => (j.pages[0].rotate = '90'), /rotate deve essere 0, 90, 180 o 270/],
  ['userUnit zero', (j) => (j.pages[0].userUnit = 0), /userUnit .* fuori dall'intervallo/],
  ['userUnit negativo', (j) => (j.pages[0].userUnit = -1), /userUnit .* fuori dall'intervallo/],
  ['scale mancante', (j) => delete j.pages[0].scale, /manca scale/],
  ['scale testo', (j) => (j.pages[0].scale = 'x'), /scale deve essere un oggetto/],
  ['mmPerPt zero', (j) => (j.pages[0].scale = { mmPerPt: 0 }), /scala \(mmPerPt\) .* fuori dall'intervallo/],
  ['mmPerPt negativo', (j) => (j.pages[0].scale = { mmPerPt: -0.5 }), /scala \(mmPerPt\)/],
  ['mmPerPt enorme', (j) => (j.pages[0].scale = { mmPerPt: 1e9 }), /scala \(mmPerPt\)/],
  ['mmPerPt null (NaN scritto da JSON)', (j) => (j.pages[0].scale = { mmPerPt: null }), /scala \(mmPerPt\) deve essere un numero/],
  ['objects mancante', (j) => delete j.pages[1].objects, /pagina 2: objects deve essere un elenco/],
  // oggetti: comuni
  ['oggetto non oggetto', (j) => (j.pages[0].objects[2] = 'x'), /pagina 1, oggetto 3: l'oggetto deve essere un oggetto/],
  ['kind sconosciuto', (j) => (O(j).kind = 'cerchio'), /pagina 1, oggetto 1: kind non valido/],
  ['kind come chiave dei prototipi', (j) => (O(j).kind = 'constructor'), /kind non valido/],
  ['kind __proto__', (j) => (O(j).kind = '__proto__'), /kind non valido/],
  ['id zero', (j) => (O(j).id = 0), /id .* fuori dall'intervallo/],
  ['id negativo', (j) => (O(j).id = -3), /id .* fuori dall'intervallo/],
  ['id decimale', (j) => (O(j).id = 1.5), /id deve essere un numero intero/],
  ['id testo', (j) => (O(j).id = '7'), /id deve essere un numero intero/],
  ['id enorme', (j) => (O(j).id = 2 ** 40), /id .* fuori dall'intervallo/],
  ['id duplicato', (j) => (O(j, 1).id = O(j, 0).id), /pagina 1, oggetto 2: id 3 gia' usato/],
  // coperture
  ['forma sconosciuta', (j) => (O(j, COV).shape = 'triangolo'), /forma non valido/],
  ['forma __proto__', (j) => (O(j, COV).shape = '__proto__'), /forma non valido/],
  ['copertura senza p2', (j) => delete O(j, COV).p2, /p2 deve essere un oggetto/],
  ['coordinata testo', (j) => (O(j, COV).p1.x = '10'), /p1\.x deve essere un numero/],
  ['coordinata fuori limite', (j) => (O(j, COV).p1.y = 1e9), /p1\.y .* fuori dall'intervallo/],
  ['coordinata null (NaN scritto da JSON)', (j) => (O(j, COV).p2.x = null), /p2\.x deve essere un numero/],
  // linee
  ['retta con 3 punti', (j) => O(j, SEG).points.push({ x: 1, y: 1 }), /una retta ha esattamente 2 punti/],
  ['linea con 1 punto', (j) => (O(j, SEG + 1).points = [{ x: 1, y: 1 }]), /una linea ha almeno 2 punti/],
  ['punti non elenco', (j) => (O(j, SEG).points = 'ab'), /points deve essere un elenco/],
  ['troppi punti', (j) => (O(j, SEG + 1).points = Array.from({ length: LIMITS.pointsPerLine + 1 }, (_, i) => ({ x: i, y: i }))), /troppi punti/],
  ['stroke mancante', (j) => delete O(j, SEG).stroke, /stroke deve essere un oggetto/],
  ['tipo di linea sconosciuto', (j) => (O(j, SEG).stroke.style = 'puntini'), /tipo di linea non valido/],
  ['colore con nome', (j) => (O(j, SEG).stroke.color = 'red'), /colore deve essere "#RRGGBB"/],
  ['colore corto', (j) => (O(j, SEG).stroke.color = '#12345'), /colore deve essere "#RRGGBB"/],
  ['colore senza #', (j) => (O(j, SEG).stroke.color = '123456'), /colore deve essere "#RRGGBB"/],
  ['colore non esadecimale', (j) => (O(j, SEG).stroke.color = '#GGGGGG'), /colore deve essere "#RRGGBB"/],
  ['colore numero', (j) => (O(j, SEG).stroke.color = 123456), /colore deve essere "#RRGGBB"/],
  ['spessore sotto il minimo', (j) => (O(j, SEG).stroke.widthPt = 0.05), /spessore .* fuori dall'intervallo 0\.1–20/],
  ['spessore sopra il massimo', (j) => (O(j, SEG).stroke.widthPt = 21), /spessore .* fuori dall'intervallo 0\.1–20/],
  ['spessore testo', (j) => (O(j, SEG).stroke.widthPt = '1'), /spessore deve essere un numero/],
  // testi
  ['testo vuoto', (j) => (O(j, TXT).text = '   '), /testo non valido: Scrivi il testo/],
  ['testo troppo lungo', (j) => (O(j, TXT).text = 'a'.repeat(101)), /testo non valido: Massimo 100/],
  ['testo con carattere non esportabile (ŝ)', (j) => (O(j, TXT).text = 'ŝ'), /testo non valido: Il carattere "ŝ"/],
  ['testo con emoji', (j) => (O(j, TXT).text = 'ciao 😀'), /testo non valido/],
  ['testo con carattere di controllo', (j) => (O(j, TXT).text = 'a\u0007b'), /testo non valido/],
  ['testo numero', (j) => (O(j, TXT).text = 42), /text deve essere un testo/],
  ['corpo sotto il minimo', (j) => (O(j, TXT).textPt = 1), /corpo del testo .* fuori dall'intervallo 2–200/],
  ['corpo sopra il massimo', (j) => (O(j, TXT).textPt = 201), /corpo del testo .* fuori dall'intervallo 2–200/],
  ['testo senza at', (j) => delete O(j, TXT).at, /at deve essere un oggetto/],
  // quote
  ['tipo di quota sconosciuto', (j) => (O(j, DIM).dim = 'angolo'), /tipo di quota non valido/],
  ['valore senza cifre', (j) => (O(j, DIM + 1).valueText = 'abc'), /valore della quota non valido: Il valore deve contenere almeno una cifra/],
  ['valore troppo lungo', (j) => (O(j, DIM + 1).valueText = '1'.repeat(41)), /valore della quota non valido: Massimo 40/],
  ['valore numero', (j) => (O(j, DIM + 1).valueText = 5), /valueText deve essere un testo/],
  ['valore mancante (non null)', (j) => delete O(j, DIM + 1).valueText, /valueText deve essere un testo/],
  ['quota senza b', (j) => delete O(j, DIM).b, /b deve essere un oggetto/],
  ['spessore quota', (j) => (O(j, DIM).widthPt = 99), /spessore .* fuori dall'intervallo/],
  ['corpo quota', (j) => (O(j, DIM).textPt = 0), /corpo del testo .* fuori dall'intervallo/],
];

describe('formato del progetto: una mutazione per ogni regola (file non valido, messaggio in italiano con la posizione)', () => {
  it('il file di partenza e\' valido (le mutazioni partono da un file buono)', () => {
    expect(parseProject(serializeProject(sampleProject())).ok).toBe(true);
  });
  for (const [name, mutate, message] of MUTATIONS) {
    it(`${name}`, () => {
      const j = asJson();
      mutate(j);
      const r = parseProject(JSON.stringify(j));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error).toMatch(message);
    });
  }

  it('la posizione nel messaggio: "pagina 2, oggetto 5"', () => {
    const j = asJson();
    j.pages[1].objects = [1, 2, 3, 4, 5].map((i) => ({ id: 200 + i, kind: 'cover', shape: 'rect', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } }));
    j.pages[1].objects[4].shape = 'x';
    const r = parseProject(JSON.stringify(j));
    expect(!r.ok && r.error.startsWith('pagina 2, oggetto 5: ')).toBe(true);
  });

  it('file vuoto, solo spazi, non JSON, JSON di un altro tipo', () => {
    for (const [text, re] of [
      ['', /vuoto/],
      ['   \n ', /vuoto/],
      ['questo non e json', /non e' un JSON valido/],
      ['{"a": 1', /non e' un JSON valido/],
      ['{"a": 1}', /non e' un progetto di GT-Pdf/],
      ['[]', /la radice non e' un oggetto/],
      ['null', /la radice non e' un oggetto/],
      ['"testo"', /la radice non e' un oggetto/],
      ['42', /la radice non e' un oggetto/],
      ['{"format":"gt-pdf-project"}', /versione del progetto non e' un numero intero/],
    ] as [string, RegExp][]) {
      const r = parseProject(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error, text).toMatch(re);
    }
  });

  it('un file molto grande si rifiuta prima di leggerlo (oltre 16 MiB)', () => {
    const r = parseProject('x'.repeat(LIMITS.fileBytes + 1));
    expect(!r.ok && /troppo grande/.test(r.error)).toBe(true);
  });

  it('troppi oggetti per pagina e in totale', () => {
    const cover = { id: 1, kind: 'cover', shape: 'rect', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } };
    const j = asJson();
    j.pages[0].objects = Array.from({ length: LIMITS.objectsPerPage + 1 }, (_, i) => ({ ...cover, id: i + 1 }));
    let r = parseProject(JSON.stringify(j));
    expect(!r.ok && /troppi oggetti \(10001, massimo 10000 per pagina\)/.test(r.error)).toBe(true);
    const k = asJson();
    let id = 1;
    k.pages[0].objects = Array.from({ length: LIMITS.objectsPerPage }, () => ({ ...cover, id: id++ }));
    k.pages[1].objects = Array.from({ length: LIMITS.objectsPerPage }, () => ({ ...cover, id: id++ }));
    k.pages[2].objects = [{ ...cover, id: id++ }];
    r = parseProject(JSON.stringify(k));
    expect(!r.ok && /troppi oggetti nel progetto/.test(r.error)).toBe(true);
  });

  it('versione futura: messaggio chiaro; versione uguale a 1: ok', () => {
    const j = asJson();
    j.version = 7;
    const r = parseProject(JSON.stringify(j));
    expect(!r.ok && r.error).toMatch(/versione piu' recente \(7\): questa app legge solo la versione 1/);
  });
});

describe('rilettura immediata (verifyProjectText)', () => {
  it('torna per un progetto valido', () => {
    const p = sampleProject();
    expect(verifyProjectText(serializeProject(p), { pages: 3, objects: sampleObjects().length, scales: 2 })).toBeNull();
  });
  it('un numero non finito diventa null nel JSON: la rilettura lo intercetta', () => {
    const p = sampleProject();
    (p.pages[0]!.objects[0] as { p1: { x: number } }).p1.x = Number.NaN;
    const text = serializeProject(p);
    expect(text).toContain('null');
    expect(verifyProjectText(text, { pages: 3, objects: sampleObjects().length, scales: 2 })).toMatch(/p1\.x deve essere un numero/);
  });
  it('i conteggi attesi diversi da quelli riletti sono un errore', () => {
    const text = serializeProject(sampleProject());
    expect(verifyProjectText(text, { pages: 3, objects: 1, scales: 2 })).toMatch(/Riletto 3 pagine/);
  });
  it('un testo valido ma riscritto in modo diverso (non generato da serializeProject) non torna', () => {
    const text = JSON.stringify(asJson(), null, 2);
    expect(verifyProjectText(text, { pages: 3, objects: sampleObjects().length, scales: 2 })).toMatch(/non e' identico/);
  });
});
