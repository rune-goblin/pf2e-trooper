// Pure troop math and diff shaping — no Foundry imports, so the vitest tier covers it.

export interface ThresholdEntry {
  hp: number;
  segments: number;
}

export type SegmentCount = 2 | 3 | 4;

export const REDUCED_EFFECT_SLUGS: Record<2 | 3, string> = {
  3: 'troop-reduced-3-segments',
  2: 'troop-reduced-2-segments',
};

/** Segment count the ladder grants at an HP value (system semantics: lowest threshold whose hp >= value). */
export function segmentsForHp(thresholds: ThresholdEntry[], hp: number): SegmentCount {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (thresholds[i].hp >= hp) return thresholds[i].segments as SegmentCount;
  }
  return 4;
}

/** Worst reduced status among the given effect slugs; 4 = full strength. */
export function statusFromSlugs(slugs: Iterable<string>): SegmentCount {
  let status: SegmentCount = 4;
  for (const slug of slugs) {
    if (slug === REDUCED_EFFECT_SLUGS[2]) return 2;
    if (slug === REDUCED_EFFECT_SLUGS[3]) status = 3;
  }
  return status;
}

/** HP value healing may not exceed for a reduced unit; null = uncapped. */
export function hpCapForStatus(thresholds: ThresholdEntry[], status: SegmentCount): number | null {
  if (status === 4) return null;
  return thresholds.find((t) => t.segments === status)?.hp ?? null;
}

/** Axis-aligned rectangle in grid-square units (troop segments are 2×2). */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RAW troop contiguity: at least one full square edge shared — diagonal contact is not enough. */
export function sharesEdge(a: GridRect, b: GridRect): boolean {
  const horizontal =
    (a.x + a.w === b.x || b.x + b.w === a.x) && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= 1;
  const vertical =
    (a.y + a.h === b.y || b.y + b.h === a.y) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= 1;
  return horizontal || vertical;
}

export function isContiguous(rects: GridRect[]): boolean {
  if (rects.length <= 1) return true;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    for (let j = 0; j < rects.length; j++) {
      if (!seen.has(j) && sharesEdge(rects[i], rects[j])) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.size === rects.length;
}

function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function neighborsOf(rect: GridRect, size: number): GridRect[] {
  const out: GridRect[] = [];
  for (let off = 1 - size; off <= rect.w - 1; off++) {
    out.push({ x: rect.x + off, y: rect.y - size, w: size, h: size });
    out.push({ x: rect.x + off, y: rect.y + rect.h, w: size, h: size });
  }
  for (let off = 1 - size; off <= rect.h - 1; off++) {
    out.push({ x: rect.x - size, y: rect.y + off, w: size, h: size });
    out.push({ x: rect.x + rect.w, y: rect.y + off, w: size, h: size });
  }
  return out;
}

/** Open size×size placements sharing at least one square edge with the cluster and not overlapping it. */
export function adjacentPlacements(cluster: GridRect[], size = 2): GridRect[] {
  const found: GridRect[] = [];
  const seen = new Set<string>();
  for (const rect of cluster) {
    for (const candidate of neighborsOf(rect, size)) {
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!cluster.some((r) => overlaps(r, candidate))) found.push(candidate);
    }
  }
  return found;
}

/**
 * All size×size placements any follower could reach spending no more than `budget`
 * squares from its own origin (RAW: "none of them moves farther than the moving
 * segment"). `measure` maps a square offset to its grid distance in squares, so the
 * caller supplies the grid's actual diagonal rule. Placements overlapping a blocked
 * rect (the moved segment's final position) are excluded. Deduplicated union.
 */
export function reachablePlacements(
  origins: { x: number; y: number }[],
  budget: number,
  measure: (dx: number, dy: number) => number,
  size = 2,
  blocked: GridRect[] = [],
): GridRect[] {
  const radius = Math.ceil(budget);
  const placements: GridRect[] = [];
  const seen = new Set<string>();
  for (const origin of origins) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (measure(dx, dy) > budget) continue;
        const rect: GridRect = { x: origin.x + dx, y: origin.y + dy, w: size, h: size };
        const key = `${rect.x},${rect.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!blocked.some((b) => overlaps(b, rect))) placements.push(rect);
      }
    }
  }
  return placements;
}

/**
 * RAW's attachment rule applied to the reachable set: a segment must share at least
 * one full square edge with the troop, chaining through other segments is allowed,
 * and a bridge segment must itself be legally placed. BFS from the moved segment's
 * final rect through edge-sharing candidates, one layer per remaining segment — so
 * the area stays anchored to the troop no matter how large the movement budget is.
 */
export function attachablePlacements(leader: GridRect, candidates: GridRect[], maxDepth: number): GridRect[] {
  const remaining = new Map(candidates.map((c) => [`${c.x},${c.y}`, c]));
  const accepted: GridRect[] = [];
  let frontier: GridRect[] = [leader];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: GridRect[] = [];
    for (const [key, candidate] of remaining) {
      if (frontier.some((f) => sharesEdge(f, candidate))) {
        remaining.delete(key);
        next.push(candidate);
      }
    }
    accepted.push(...next);
    frontier = next;
  }
  return accepted;
}

/** The set of individual grid squares ("x,y") covered by any of the given rects. */
export function footprintCells(rects: GridRect[]): Set<string> {
  const cells = new Set<string>();
  for (const rect of rects) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      for (let y = rect.y; y < rect.y + rect.h; y++) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

export interface ItemSourceLike {
  _id: string;
  [key: string]: unknown;
}

export interface ItemReconcilePlan {
  create: ItemSourceLike[];
  update: ItemSourceLike[];
  delete: string[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Diff a sibling segment's item sources against the leader's: what to create, replace,
 * and delete so the sibling's items match. Excluded items (rule-element grants,
 * per-segment conditions) are invisible to the plan in both directions. Never plans a
 * create for an id the sibling already has — a keepId create for an existing id is a
 * hard server error, and mid-cascade races made exactly that happen.
 */
export function planItemReconcile(
  leaderItems: ItemSourceLike[],
  siblingItems: ItemSourceLike[],
  isExcluded: (item: ItemSourceLike) => boolean,
): ItemReconcilePlan {
  const plan: ItemReconcilePlan = { create: [], update: [], delete: [] };
  const siblingById = new Map(siblingItems.filter((i) => !isExcluded(i)).map((i) => [i._id, i]));
  for (const item of leaderItems) {
    if (isExcluded(item)) continue;
    const counterpart = siblingById.get(item._id);
    if (!counterpart) plan.create.push(item);
    else if (!deepEqual(item, counterpart)) plan.update.push(item);
    siblingById.delete(item._id);
  }
  plan.delete = [...siblingById.keys()];
  return plan;
}

export interface PointSource {
  id: string;
  x: number;
  y: number;
}

/**
 * Follower position updates for a unit move. The delta comes from the update's
 * `changed` payload against the stashed prior position — never from the document's
 * prepared x/y, which lags `_source` during Foundry v14's movement pipeline (reading
 * it mid-update yields the OLD position and a zero delta).
 */
export function followMoves(
  changed: { x?: unknown; y?: unknown },
  prior: { x: number; y: number },
  followers: PointSource[],
): { _id: string; x: number; y: number }[] {
  const dx = (typeof changed.x === 'number' ? changed.x : prior.x) - prior.x;
  const dy = (typeof changed.y === 'number' ? changed.y : prior.y) - prior.y;
  if (!dx && !dy) return [];
  return followers.map((f) => ({ _id: f.id, x: f.x + dx, y: f.y + dy }));
}

/**
 * Clone of a `system` update diff with the paths we must not mirror removed:
 * hp and elite/weak adjustment are already propagated by the pf2e system itself
 * (double-writing them would race its `fromTroop` updates), and `_migration`
 * bookkeeping is per-actor. Null when nothing mirrorable remains.
 */
export function syncableSystemDiff(system: object): Record<string, unknown> | null {
  const diff = structuredClone(system) as Record<string, unknown>;
  const attributes = diff.attributes as Record<string, unknown> | undefined;
  if (attributes) {
    delete attributes.hp;
    delete attributes.adjustment;
    if (Object.keys(attributes).length === 0) delete diff.attributes;
  }
  delete diff._migration;
  return Object.keys(diff).length > 0 ? diff : null;
}
