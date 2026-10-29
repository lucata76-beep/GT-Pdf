// Puntatori "fantasma" del visore (CP5d). Il visore tiene i tocchi attivi in una mappa: un dito = sposta, due = pinch. Se un pointerup o un pointercancel non
// arriva mai (a un tocco puo' succedere: per esempio WebKit ha avuto segnalazioni di pointerup mancante dopo il gesto di navigazione laterale), il tocco resta
// nella mappa per sempre: con un dito il visore si crede in modalita' pinch (lo spostamento cambia lo zoom) e con due dita non fa piu' nulla (tre puntatori).
// Questa regola decide quali tocchi scartare quando ne arriva uno nuovo. La documentazione dei Pointer Events dice che il puntatore primario di un tipo e' il
// primo a diventare attivo, cioe' che un tocco PRIMARIO non puo' coesistere con altri tocchi attivi: quelli rimasti nella mappa sono fantasmi. Per non fidarsi
// ciecamente di `isPrimary` (non verificato su Safari) si scartano solo i tocchi fermi da almeno STALE_MS: un dito appoggiato davvero e poi seguito da un secondo
// dito resta al suo posto (il secondo non e' primario).
export const STALE_MS = 1000;

export interface TrackedPointer {
  type: string;
  /** Istante (ms, `performance.now()`) dell'ultimo evento ricevuto per questo puntatore. */
  lastSeen: number;
}

export function strayTouchIds(tracked: ReadonlyMap<number, TrackedPointer>, down: { pointerType: string; isPrimary: boolean }, now: number, staleMs = STALE_MS): number[] {
  if (down.pointerType !== 'touch' || !down.isPrimary) return [];
  const out: number[] = [];
  for (const [id, t] of tracked) if (t.type === 'touch' && now - t.lastSeen >= staleMs) out.push(id);
  return out;
}
