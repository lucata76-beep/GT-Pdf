// Dal modello della sessione al progetto e ritorno.
import type { DocumentModel } from '../model/model';
import type { PageInfo } from '../pdf/loader';
import type { Project, ProjectPdfInfo } from './format';

/** Il progetto da scrivere: una voce per OGNI pagina del PDF, in ordine, con la sua geometria, la scala e gli oggetti nell'ordine del modello. */
export function snapshotProject(model: DocumentModel, pages: readonly PageInfo[], app: string, pdf: ProjectPdfInfo): Project {
  return {
    app,
    pdf,
    pages: pages.map((p, i) => ({
      number: i + 1,
      view: [p.view[0], p.view[1], p.view[2], p.view[3]],
      rotate: p.rotate,
      userUnit: p.userUnit,
      scale: model.scale(i + 1) ? { mmPerPt: (model.scale(i + 1) as { mmPerPt: number }).mmPerPt } : null,
      objects: [...model.objects(i + 1)],
    })),
  };
}

/** Applica un progetto gia' validato al modello (sostituisce tutto). */
export function applyProject(model: DocumentModel, project: Project): void {
  model.restore(project.pages.map((p) => ({ page: p.number, scale: p.scale, objects: p.objects })));
}

/** Riepilogo per i dialoghi. */
export interface ProjectSummary {
  pages: number;
  pagesWithObjects: number;
  objects: number;
  scales: number;
}
export function summarize(p: Project): ProjectSummary {
  let pagesWithObjects = 0;
  let objects = 0;
  let scales = 0;
  for (const g of p.pages) {
    if (g.objects.length > 0) pagesWithObjects++;
    objects += g.objects.length;
    if (g.scale) scales++;
  }
  return { pages: p.pages.length, pagesWithObjects, objects, scales };
}
