import { describe, expect, it } from 'vitest';
import type { FilletSide } from '../geometry/fillet';
import { PageGeometry, type UserPoint } from '../geometry/page';
import { PROJECT_VERSION, type Project, parseProject, serializeProject } from '../project/format';
import { FILLET_CLOSED_EPS_PT, FILLET_EDIT_TEXT, FILLET_LABEL, FilletCommand, planFillet } from './fillet';
import { History } from './history';
import { AddObject, DocumentModel, type LineObject, type PageObject, pointsOf } from './model';
import type { Stroke } from './stroke';

const G0 = new PageGeometry({ view: [0, 0, 600, 800], rotate: 0, userUnit: 1 });
const RED: Stroke = { style: 'solid', color: '#D32F2F', widthPt: 1 };
const BLUE: Stroke = { style: 'dashed', color: '#1565C0', widthPt: 2.5 };
const P = (x: number, y: number): UserPoint => ({ x, y });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Un modello con una pagina e gli oggetti dati (aggiunti con il comando di aggiunta, come l'interfaccia). */
function setup(objs: Omit<PageObject, 'id'>[]): { model: DocumentModel; history: History<DocumentModel>; ids: number[] } {
  const model = new DocumentModel();
  const history = new History(model);
  const ids = objs.map((o) => {
    const obj = { ...o, id: model.newId() } as PageObject;
    history.exec(new AddObject(1, obj));
    return obj.id;
  });
  return { model, history, ids };
}
const seg = (a: UserPoint, b: UserPoint, stroke: Stroke = RED): Omit<LineObject, 'id'> => ({ kind: 'segment', points: [a, b], stroke });
const poly = (pts: UserPoint[], stroke: Stroke = RED): Omit<LineObject, 'id'> => ({ kind: 'polyline', points: pts, stroke });
/** Il tratto `index` dell'oggetto `id`, con il clic dato. */
function pick(model: DocumentModel, id: number, index: number, click: UserPoint): FilletSide {
  const o = model.get(1, id) as LineObject;
  return { id, index, a: { ...(o.points[index] as UserPoint) }, b: { ...(o.points[index + 1] as UserPoint) }, click };
}
/** Due punti coincidono entro 1e-9 (i punti di tangenza passano da foglio e spazio utente: errori di arrotondamento di 1e-13). */
const closeP = (a: UserPoint | undefined, b: UserPoint): void => {
  expect(Math.abs((a as UserPoint).x - b.x)).toBeLessThan(1e-9);
  expect(Math.abs((a as UserPoint).y - b.y)).toBeLessThan(1e-9);
};
let counter = 1000;
const nextId = (): number => ++counter;

describe('piano del raccordo: due Rette (angolo retto, calcolato a mano)', () => {
  it('accorcia i due estremi vicini ai punti di tangenza e aggiunge l\'arco con il tratto della prima retta', () => {
    const { model, history, ids } = setup([seg(P(100, 300), P(400, 300), BLUE), seg(P(250, 100), P(250, 500), RED)]);
    const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 350)), 20, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    history.exec(new FilletCommand(1, r.plan));
    const [a, b, arc] = model.objects(1) as [LineObject, LineObject, PageObject];
    closeP(a.points[0], P(270, 300));
    expect(a.points[1]).toEqual(P(400, 300));
    closeP(b.points[0], P(250, 320));
    expect(b.points[1]).toEqual(P(250, 500));
    expect(model.objects(1)).toHaveLength(3);
    expect(arc.kind).toBe('arc');
    if (arc.kind !== 'arc') return;
    expect(arc.p1).toEqual(a.points[0]);
    expect(arc.p3).toEqual(b.points[0]);
    expect(arc.p2.x).toBeCloseTo(250 + 20 * (1 - Math.SQRT1_2), 9);
    expect(arc.p2.y).toBeCloseTo(300 + 20 * (1 - Math.SQRT1_2), 9);
    expect(arc.stroke).toEqual(BLUE); // il tratto del PRIMO tratto scelto, non quello corrente
    expect(a.stroke).toEqual(BLUE);
    expect(b.stroke).toEqual(RED);
    expect(r.plan.changed).toBe(2);
    expect(r.plan.split).toBe(false);
  });

  it('ognuna delle quattro parti: i punti accorciati sono quelli dal lato del clic, l\'estremo lontano non si tocca', () => {
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      const { model, ids } = setup([seg(P(100, 300), P(400, 300)), seg(P(250, 100), P(250, 500))]);
      const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(250 + sx * 50, 300)), pick(model, ids[1] as number, 0, P(250, 300 + sy * 50)), 20, G0, nextId);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const ch = r.plan.changes;
      const c0 = ch[0]?.after as UserPoint[];
      const c1 = ch[1]?.after as UserPoint[];
      // retta orizzontale: il punto di tangenza e' V + sx * 20; l'estremo dalla parte del clic non cambia
      expect(c0[sx === 1 ? 0 : 1]?.x).toBeCloseTo(250 + sx * 20, 9);
      expect(c0[sx === 1 ? 1 : 0]).toEqual(sx === 1 ? P(400, 300) : P(100, 300));
      expect(c1[sy === 1 ? 0 : 1]?.y).toBeCloseTo(300 + sy * 20, 9);
      expect(c1[sy === 1 ? 1 : 0]).toEqual(sy === 1 ? P(250, 500) : P(250, 100));
    }
  });
});

describe('piano del raccordo: Retta e Linea, Linea e Linea (estremi), tratto interno', () => {
  it('Retta e Linea: l\'estremo vicino della Linea (il primo punto) e\' sostituito; gli altri punti non cambiano', () => {
    const { model, ids } = setup([seg(P(100, 300), P(400, 300)), poly([P(250, 100), P(250, 500), P(400, 520)])]);
    const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 400)), 20, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.plan.changes[1]?.after as UserPoint[];
    expect(after).toHaveLength(3);
    expect(after[0]?.y).toBeCloseTo(320, 9);
    expect(after[1]).toEqual(P(250, 500));
    expect(after[2]).toEqual(P(400, 520));
  });
  it('Linea e Linea agli estremi (i tratti non arrivano al vertice: i punti di tangenza cadono dentro i tratti): si sostituisce l\'ultimo punto della prima e il primo della seconda', () => {
    // V = (250, 300). Prima Linea: il suo tratto 1 (100,300)->(300,300) attraversa V. Seconda Linea: il suo tratto 0 (250,250)->(250,100) finisce a 50 da V, sotto
    const { model, ids } = setup([poly([P(100, 200), P(100, 300), P(300, 300)]), poly([P(250, 250), P(250, 100), P(400, 100)])]);
    const r = planFillet(model.objects(1), pick(model, ids[0] as number, 1, P(150, 300)), pick(model, ids[1] as number, 0, P(250, 200)), 60, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.plan.changes[0]?.after as UserPoint[];
    expect(a.slice(0, 2)).toEqual([P(100, 200), P(100, 300)]);
    closeP(a[2], P(190, 300)); // l'estremo vicino della prima e' l'ULTIMO punto (300,300), sostituito da V - 60 lungo x
    const b = r.plan.changes[1]?.after as UserPoint[];
    closeP(b[0], P(250, 240)); // l'estremo vicino della seconda e' il PRIMO punto (250,250), sostituito da V - 60 lungo y
    expect(b.slice(1)).toEqual([P(250, 100), P(400, 100)]);
    // con un raggio piu' piccolo (t = 20 < 50) il tratto della seconda Linea non arriva al raccordo
    expect(planFillet(model.objects(1), pick(model, ids[0] as number, 1, P(150, 300)), pick(model, ids[1] as number, 0, P(250, 200)), 20, G0, nextId)).toEqual({ ok: false, message: 'Il tratto 2 non arriva fino al raccordo: serve un raggio più grande.' });
  });
  it('un tratto INTERNO di una Linea (l\'estremo da sostituire non e\' il primo ne\' l\'ultimo punto) si rifiuta con il messaggio e senza consumare id', () => {
    // la Linea ha il tratto 0 (250,100)->(250,500) che attraversa V = (250,300): con il clic sotto V la parte tenuta e' verso (250,100) e l'estremo da sostituire sarebbe (250,500), un punto interno
    const { model, ids } = setup([seg(P(100, 300), P(400, 300)), poly([P(250, 100), P(250, 500), P(400, 520)])]);
    let used = 0;
    const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 150)), 20, G0, () => ++used);
    expect(r).toEqual({ ok: false, message: FILLET_EDIT_TEXT.interior });
    expect(used).toBe(0);
    // con il clic sopra V la parte tenuta e' verso (250,500) e l'estremo da sostituire e' il primo punto: ammesso
    expect(planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 450)), 20, G0, nextId).ok).toBe(true);
    // un tratto in mezzo di una Linea di 4 punti: i suoi due estremi sono interni
    const s2 = setup([seg(P(150, -50), P(150, 150)), poly([P(0, 0), P(100, 100), P(200, 0), P(300, 100)])]);
    const r2 = planFillet(s2.model.objects(1), pick(s2.model, s2.ids[0] as number, 0, P(150, 120)), pick(s2.model, s2.ids[1] as number, 1, P(130, 70)), 5, G0, nextId);
    expect(r2).toEqual({ ok: false, message: FILLET_EDIT_TEXT.interior });
  });
});

describe('piano del raccordo: spigolo di una Linea (due tratti consecutivi)', () => {
  const stairs = (): Omit<LineObject, 'id'> => poly([P(100, 300), P(250, 300), P(250, 500), P(400, 500)], BLUE);
  it('la Linea si spezza: P1 conserva id e tratto, P2 e\' nuova con lo stesso tratto e sta subito dopo P; l\'arco in fondo', () => {
    const { model, history, ids } = setup([seg(P(0, 0), P(10, 10)), stairs(), seg(P(500, 0), P(550, 50))]);
    const pid = ids[1] as number;
    const r = planFillet(model.objects(1), pick(model, pid, 0, P(150, 300)), pick(model, pid, 1, P(250, 400)), 20, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.split).toBe(true);
    expect(r.plan.changed).toBe(1);
    history.exec(new FilletCommand(1, r.plan));
    const list = model.objects(1);
    expect(list).toHaveLength(5);
    expect(list.map((o) => o.kind)).toEqual(['segment', 'polyline', 'polyline', 'segment', 'arc']);
    const [, p1, p2, , arc] = list as [PageObject, LineObject, LineObject, PageObject, PageObject];
    expect(p1.id).toBe(pid);
    expect(p1.points[0]).toEqual(P(100, 300));
    expect(p1.points[1]?.x).toBeCloseTo(230, 9);
    expect(p1.points[1]?.y).toBeCloseTo(300, 9);
    expect(p1.points).toHaveLength(2);
    expect(p2.id).not.toBe(pid);
    expect(p2.stroke).toEqual(BLUE);
    expect(p1.stroke).toEqual(BLUE);
    expect(p2.points[0]?.x).toBeCloseTo(250, 9);
    expect(p2.points[0]?.y).toBeCloseTo(320, 9);
    expect(p2.points.slice(1)).toEqual([P(250, 500), P(400, 500)]);
    if (arc.kind !== 'arc') return;
    expect(arc.p1).toEqual(p1.points[1]); // il primo tratto scelto e' il tratto 0
    expect(arc.p3).toEqual(p2.points[0]);
    expect(arc.stroke).toEqual(BLUE);
    // tre id distinti
    expect(new Set(list.map((o) => o.id)).size).toBe(5);
  });
  it('scegliendo i tratti nell\'altro ordine l\'arco parte dal primo tratto SCELTO, ma le due Linee sono le stesse', () => {
    const { model, ids } = setup([stairs()]);
    const pid = ids[0] as number;
    const a = planFillet(model.objects(1), pick(model, pid, 0, P(150, 300)), pick(model, pid, 1, P(250, 400)), 20, G0, nextId);
    const b = planFillet(model.objects(1), pick(model, pid, 1, P(250, 400)), pick(model, pid, 0, P(150, 300)), 20, G0, nextId);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.plan.changes[0]?.after).toEqual(a.plan.changes[0]?.after);
    expect((b.plan.added[0]?.obj as LineObject).points).toEqual((a.plan.added[0]?.obj as LineObject).points);
    expect(b.plan.arc.p1).toEqual(a.plan.arc.p3);
    expect(b.plan.arc.p3).toEqual(a.plan.arc.p1);
  });
  it('tratti NON consecutivi della stessa Linea: rifiuto con messaggio; lo stesso tratto due volte: rifiuto', () => {
    const { model, ids } = setup([poly([P(0, 0), P(100, 0), P(100, 100), P(0, 100)])]);
    const pid = ids[0] as number;
    expect(planFillet(model.objects(1), pick(model, pid, 0, P(50, 0)), pick(model, pid, 2, P(50, 100)), 5, G0, nextId)).toEqual({ ok: false, message: FILLET_EDIT_TEXT.notConsecutive });
    const same = planFillet(model.objects(1), pick(model, pid, 1, P(100, 30)), pick(model, pid, 1, P(100, 70)), 5, G0, nextId);
    expect(same.ok).toBe(false);
  });
  it('Linea chiusa, spigolo del punto di chiusura: la Linea resta UNA e i suoi due estremi si accorciano; l\'arco la richiude', () => {
    const { model, ids } = setup([poly([P(100, 100), P(300, 100), P(300, 300), P(100, 300), P(100, 100)], BLUE)]);
    const pid = ids[0] as number;
    const r = planFillet(model.objects(1), pick(model, pid, 0, P(200, 100)), pick(model, pid, 3, P(100, 200)), 20, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.split).toBe(false);
    expect(r.plan.added).toHaveLength(1); // solo l'arco
    const after = r.plan.changes[0]?.after as UserPoint[];
    expect(after).toHaveLength(5);
    closeP(after[0], P(120, 100));
    expect(after[1]).toEqual(P(300, 100));
    expect(after[2]).toEqual(P(300, 300));
    expect(after[3]).toEqual(P(100, 300));
    expect(after[4]?.x).toBeCloseTo(100, 9);
    expect(after[4]?.y).toBeCloseTo(120, 9);
    expect(r.plan.arc.p1).toEqual(after[0]); // il primo tratto scelto e' il tratto 0
    expect(r.plan.arc.p3).toEqual(after[4]);
    // gli stessi tratti in un'altra Linea quasi chiusa (un buco di 0,01 pt) NON sono "chiusi": rifiuto
    const gap = setup([poly([P(100, 100), P(300, 100), P(300, 300), P(100, 300), P(100, 100.01)])]);
    expect(planFillet(gap.model.objects(1), pick(gap.model, gap.ids[0] as number, 0, P(200, 100)), pick(gap.model, gap.ids[0] as number, 3, P(100, 200)), 20, G0, nextId)).toEqual({ ok: false, message: FILLET_EDIT_TEXT.notConsecutive });
    expect(FILLET_CLOSED_EPS_PT).toBe(1e-6);
  });
  it('Linea chiusa, altri spigoli: la Linea si spezza come una aperta (due Linee che si toccano nel punto di chiusura)', () => {
    const { model, ids } = setup([poly([P(100, 100), P(300, 100), P(300, 300), P(100, 300), P(100, 100)])]);
    const pid = ids[0] as number;
    const r = planFillet(model.objects(1), pick(model, pid, 0, P(200, 100)), pick(model, pid, 1, P(300, 200)), 20, G0, nextId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.split).toBe(true);
    const p1pts = r.plan.changes[0]?.after as UserPoint[];
    expect(p1pts).toHaveLength(2);
    expect(p1pts[0]).toEqual(P(100, 100));
    closeP(p1pts[1], P(280, 100));
    const p2 = r.plan.added[0]?.obj as LineObject;
    expect(p2.points[0]?.x).toBeCloseTo(300, 9);
    expect(p2.points[0]?.y).toBeCloseTo(120, 9);
    expect(p2.points.slice(1)).toEqual([P(300, 300), P(100, 300), P(100, 100)]);
  });
});

describe('piano del raccordo: pagine /Rotate 90, 180, 270, CropBox e UserUnit 2,5', () => {
  for (const rotate of [0, 90, 180, 270]) {
    for (const userUnit of [1, 2.5]) {
      it(`/Rotate ${rotate}, UserUnit ${userUnit}: l'arco e le rette accorciate sono continui nei punti di tangenza e i punti di tangenza stanno sulle rette originali`, () => {
        const g = new PageGeometry({ view: [50, 50, 450, 600], rotate, userUnit });
        const A = [P(100, 300), P(400, 300)];
        const B = [P(250, 100), P(250, 500)];
        const { model, history, ids } = setup([seg(A[0] as UserPoint, A[1] as UserPoint), seg(B[0] as UserPoint, B[1] as UserPoint)]);
        const R = 12 * userUnit; // pt del foglio: in unita' utente 12
        const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 400)), R, g, nextId);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        history.exec(new FilletCommand(1, r.plan));
        const [a, b, arc] = model.objects(1) as [LineObject, LineObject, PageObject];
        if (arc.kind !== 'arc') throw new Error('arco atteso');
        expect(arc.p1).toEqual(a.points[0]);
        expect(arc.p3).toEqual(b.points[0]);
        // il raggio e' 12 unita' utente: T1 = V + 12 lungo +x, T2 = V + 12 lungo +y (V = (250, 300), angolo retto, t = R)
        expect(a.points[0]?.x).toBeCloseTo(262, 8);
        expect(a.points[0]?.y).toBeCloseTo(300, 8);
        expect(b.points[0]?.x).toBeCloseTo(250, 8);
        expect(b.points[0]?.y).toBeCloseTo(312, 8);
      });
    }
  }
});

describe('comando del raccordo: un solo passo, un solo cambiamento, Annulla e Ripeti esatti', () => {
  const build = () => {
    const s = setup([seg(P(10, 10), P(20, 20)), poly([P(100, 300), P(250, 300), P(250, 500), P(400, 500)], BLUE), seg(P(500, 0), P(550, 50)), { kind: 'cover', shape: 'rect', p1: P(0, 0), p2: P(50, 50) } as Omit<PageObject, 'id'>]);
    const pid = s.ids[1] as number;
    const r = planFillet(s.model.objects(1), pick(s.model, pid, 0, P(150, 300)), pick(s.model, pid, 1, P(250, 400)), 20, G0, () => s.model.newId());
    if (!r.ok) throw new Error(r.message);
    return { ...s, plan: r.plan, pid };
  };
  it('Annulla restituisce punti, numero di oggetti, id e ordine esatti; Ripeti reinserisce gli STESSI oggetti negli stessi indici', () => {
    const { model, history, plan, pid } = build();
    const before = clone(model.objects(1));
    const idsBefore = model.objects(1).map((o) => o.id);
    history.exec(new FilletCommand(1, plan));
    const after = clone(model.objects(1));
    expect(after).toHaveLength(before.length + 2);
    expect(model.objects(1).map((o) => o.id)).toEqual([idsBefore[0], pid, plan.added[0]?.obj.id, idsBefore[2], idsBefore[3], plan.added[1]?.obj.id]);
    history.undo();
    expect(clone(model.objects(1))).toEqual(before);
    expect(model.objects(1).map((o) => o.id)).toEqual(idsBefore);
    history.redo();
    expect(clone(model.objects(1))).toEqual(after);
    // gli oggetti reinseriti sono le STESSE istanze del piano
    expect(model.objects(1)).toContain(plan.added[0]?.obj);
    expect(model.objects(1)).toContain(plan.added[1]?.obj);
    history.undo();
    expect(clone(model.objects(1))).toEqual(before);
    history.redo();
    expect(clone(model.objects(1))).toEqual(after);
  });
  it('un solo passo di Annulla e un solo cambiamento del modello per apply e per revert', () => {
    const { model, history, plan } = build();
    let changes = 0;
    model.onChange(() => changes++);
    const v0 = model.version;
    history.exec(new FilletCommand(1, plan));
    expect(changes).toBe(1);
    expect(model.version).toBe(v0 + 1);
    expect(history.nextUndo).toBe(FILLET_LABEL);
    history.undo();
    expect(changes).toBe(2);
    expect(model.version).toBe(v0 + 2);
    history.redo();
    expect(changes).toBe(3);
    // un solo Annulla basta a tornare allo stato di prima del raccordo (il comando e' uno)
    history.undo();
    expect(history.canUndo).toBe(true); // restano le aggiunte degli oggetti di partenza
    expect(history.nextUndo).not.toBe(FILLET_LABEL);
  });
  it('un piano che fallisce non consuma id', () => {
    const { model, ids } = setup([seg(P(100, 300), P(400, 300)), seg(P(250, 100), P(250, 130))]);
    let used = 0;
    const r = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 110)), 50, G0, () => ++used);
    expect(r.ok).toBe(false);
    expect(used).toBe(0);
  });
});

describe('raccordo e file del progetto (versione 4, nessun campo nuovo)', () => {
  it('un progetto con un raccordo (arco, rette accorciate, Linea spezzata) si salva, si rilegge uguale e supera la validazione dell\'arco', () => {
    const { model, history, ids } = setup([seg(P(100, 300), P(400, 300), BLUE), seg(P(250, 100), P(250, 500)), poly([P(100, 600), P(250, 600), P(250, 700), P(400, 700)], RED)]);
    const r1 = planFillet(model.objects(1), pick(model, ids[0] as number, 0, P(300, 300)), pick(model, ids[1] as number, 0, P(250, 350)), 20, G0, () => model.newId());
    if (!r1.ok) throw new Error(r1.message);
    history.exec(new FilletCommand(1, r1.plan));
    const pid = ids[2] as number;
    const r2 = planFillet(model.objects(1), pick(model, pid, 0, P(150, 600)), pick(model, pid, 1, P(250, 650)), 15, G0, () => model.newId());
    if (!r2.ok) throw new Error(r2.message);
    history.exec(new FilletCommand(1, r2.plan));
    const project: Project = {
      app: 'abc1234',
      pdf: { name: 'a.pdf', size: 1, sha256: 'ab'.repeat(32) },
      pages: [{ number: 1, view: [0, 0, 600, 800], rotate: 0, userUnit: 1, scale: null, origin: null, objects: model.objects(1).map((o) => clone(o)) }],
    };
    const text = serializeProject(project);
    expect(JSON.parse(text).version).toBe(4);
    expect(PROJECT_VERSION).toBe(4);
    const back = parseProject(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.project).toEqual(project);
    expect(back.objectCount).toBe(model.objects(1).length);
    expect(back.project.pages[0]?.objects.filter((o) => o.kind === 'arc')).toHaveLength(2);
    expect(serializeProject(back.project)).toBe(text);
    // i punti salvati sono quelli del modello, bit per bit
    expect(back.project.pages[0]?.objects.map((o) => pointsOf(o))).toEqual(model.objects(1).map((o) => pointsOf(o)));
  });
});
