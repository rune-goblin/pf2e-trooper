import type { ScenePF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { type GridRect, attachablePlacements, footprintCells, reachablePlacements } from './logic';

// The advisory area painted after a unit move: everywhere the remaining segments
// could legally end up, under both RAW constraints. Movement: followers regroup
// "provided none of them moves farther than the moving segment" — each remaining
// segment's budget is the leader's spent movement, measured from its own pre-move
// origin with the grid's real diagonal rule (PF2e 5-10-5). Attachment: segments
// must share at least one full square edge with the troop (chains through other
// segments allowed), so the area grows outward from the moved segment through
// budget-valid placements only and never spreads across the map. Anchored once when
// it opens; reshape drags reset the timer. Purely advisory — nothing is
// blocked or validated.

export const ARRANGE_SECONDS_SETTING = 'arrangeSeconds';

const FADE_MS = 500;
const HATCH_COLOR = 0x9cf29c;
const ORIGIN_COLOR = 0xffc94d;
const HATCH_ALPHA = 0.5;
const BORDER_ALPHA = 0.8;
/** Enumeration cap in squares — a cross-map teleport doesn't need a scene-wide area. */
const MAX_BUDGET_SQUARES = 30;

export interface ArrangeContext {
  leaderId: string;
  /** Leader's pre-move position, px. */
  leaderPrior: { x: number; y: number };
  /** Leader's final position, px. */
  leaderFinal: { x: number; y: number };
  /** The other segments' pre-move positions, px. */
  origins: { x: number; y: number }[];
}

interface ArrangeArea {
  troopId: string;
  sceneId: string;
  container: PIXI.Container;
  expiresAt: number;
  /** Grid squares ("x,y") the painted area covers — the inside/outside test for drags. */
  cells: Set<string>;
}

let active: ArrangeArea | null = null;
let hatchTexture: PIXI.Texture | null = null;
let ticking = false;

/**
 * How a troop segment's drag destination relates to the visible area (fade included —
 * as long as the shading is on screen, it governs the drag): 'inside' means the whole
 * footprint lands in the shaded squares, so the drag is a reshape; 'outside' (or
 * 'none') means it's a fresh unit move.
 */
export function arrangeDisposition(
  troopId: string,
  sceneId: string,
  finalPx: { x: number; y: number },
  w: number,
  h: number,
): 'none' | 'inside' | 'outside' {
  if (!active || active.troopId !== troopId || active.sceneId !== sceneId) return 'none';
  const px = canvas.grid.size;
  const gx = Math.round(finalPx.x / px);
  const gy = Math.round(finalPx.y / px);
  for (let x = gx; x < gx + w; x++) {
    for (let y = gy; y < gy + h; y++) {
      if (!active.cells.has(`${x},${y}`)) return 'outside';
    }
  }
  return 'inside';
}

export function showArrangeArea(scene: ScenePF2e, troopId: string, ctx: ArrangeContext): void {
  clearArrangeArea();
  if (!canvas.ready || canvas.scene?.id !== scene.id) return;
  if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return;

  const built = buildOverlay(scene, ctx);
  if (!built) return;
  (canvas.interface as unknown as PIXI.Container).addChild(built.container);
  active = { troopId, sceneId: scene.id, container: built.container, expiresAt: Date.now() + areaMs(), cells: built.cells };
  ensureTicker();
}

/** Reset the countdown to the full duration after a reshape drag — absolute, never additive; the area itself stays anchored. */
export function resetArrangeTimer(): void {
  if (!active) return;
  active.expiresAt = Date.now() + areaMs();
  active.container.alpha = 1;
}

export function clearArrangeArea(): void {
  if (!active) return;
  active.container.destroy({ children: true });
  active = null;
}

function areaMs(): number {
  return (Number(game.settings.get(MODULE_ID, ARRANGE_SECONDS_SETTING)) || 3) * 1000;
}

/** Grid distance of a square offset, in squares, using the scene grid's own diagonal rule. */
function offsetMeasurer(): (dx: number, dy: number) => number {
  const px = canvas.grid.size;
  const feetPerSquare = canvas.grid.distance;
  const cache = new Map<string, number>();
  return (dx, dy) => {
    const key = `${dx},${dy}`;
    let distance = cache.get(key);
    if (distance === undefined) {
      const result = canvas.grid.measurePath([
        { x: 0, y: 0 },
        { x: dx * px, y: dy * px },
      ]) as { distance: number };
      distance = result.distance / feetPerSquare;
      cache.set(key, distance);
    }
    return distance;
  };
}

function buildOverlay(scene: ScenePF2e, ctx: ArrangeContext): { container: PIXI.Container; cells: Set<string> } | null {
  const leader = scene.tokens.get(ctx.leaderId);
  if (!leader || ctx.origins.length === 0) return null;
  const px = canvas.grid.size;
  const toGrid = (v: number): number => Math.round(v / px);
  const measure = offsetMeasurer();

  const budget = Math.min(
    measure(toGrid(ctx.leaderFinal.x) - toGrid(ctx.leaderPrior.x), toGrid(ctx.leaderFinal.y) - toGrid(ctx.leaderPrior.y)),
    MAX_BUDGET_SQUARES,
  );
  if (budget <= 0) return null;

  const leaderRect: GridRect = {
    x: toGrid(ctx.leaderFinal.x),
    y: toGrid(ctx.leaderFinal.y),
    w: leader.width,
    h: leader.height,
  };
  const origins = ctx.origins.map((o) => ({ x: toGrid(o.x), y: toGrid(o.y) }));
  const reachable = reachablePlacements(origins, budget, measure, leader.width, [leaderRect]);
  // Both RAW constraints: within budget AND attached to the moved segment (chains allowed).
  const placements = attachablePlacements(leaderRect, reachable, ctx.origins.length);
  const cells = footprintCells(placements);
  if (cells.size === 0) return null;

  const cellList = [...cells].map((key) => key.split(',').map(Number) as [number, number]);
  const xs = cellList.map((c) => c[0]);
  const ys = cellList.map((c) => c[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const [maxX, maxY] = [Math.max(...xs), Math.max(...ys)];

  const container = new PIXI.Container();
  container.eventMode = 'none';

  const sprite = new PIXI.TilingSprite(getHatchTexture(), (maxX - minX + 1) * px, (maxY - minY + 1) * px);
  sprite.position.set(minX * px, minY * px);
  sprite.tint = HATCH_COLOR;
  sprite.alpha = HATCH_ALPHA;

  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff);
  for (const [cx, cy] of cellList) mask.drawRect(cx * px, cy * px, px, px);
  mask.endFill();
  sprite.mask = mask;

  // Outline only the area's outer edge: a cell side is drawn when no neighbor cell abuts it.
  const borders = new PIXI.Graphics();
  borders.lineStyle(2, HATCH_COLOR, BORDER_ALPHA);
  for (const [cx, cy] of cellList) {
    if (!cells.has(`${cx},${cy - 1}`)) borders.moveTo(cx * px, cy * px).lineTo((cx + 1) * px, cy * px);
    if (!cells.has(`${cx},${cy + 1}`)) borders.moveTo(cx * px, (cy + 1) * px).lineTo((cx + 1) * px, (cy + 1) * px);
    if (!cells.has(`${cx - 1},${cy}`)) borders.moveTo(cx * px, cy * px).lineTo(cx * px, (cy + 1) * px);
    if (!cells.has(`${cx + 1},${cy}`)) borders.moveTo((cx + 1) * px, cy * px).lineTo((cx + 1) * px, (cy + 1) * px);
  }

  // Origin marker: where the moved segment came from, so the move that created this
  // area stays readable while pieces are repositioned.
  const origin = new PIXI.Graphics();
  origin.lineStyle(3, ORIGIN_COLOR, 0.9);
  origin.beginFill(ORIGIN_COLOR, 0.12);
  origin.drawRect(toGrid(ctx.leaderPrior.x) * px, toGrid(ctx.leaderPrior.y) * px, leader.width * px, leader.height * px);
  origin.endFill();

  container.addChild(sprite, mask, borders, origin);
  return { container, cells };
}

function getHatchTexture(): PIXI.Texture {
  if (hatchTexture) return hatchTexture;
  const s = 16;
  const g = new PIXI.Graphics();
  g.lineStyle(3, 0xffffff, 1);
  // Two 45° strokes so the pattern tiles without seams.
  g.moveTo(-s / 2, s / 2).lineTo(s / 2, -s / 2);
  g.moveTo(s / 2, s * 1.5).lineTo(s * 1.5, s / 2);
  hatchTexture = canvas.app.renderer.generateTexture(g, {
    region: new PIXI.Rectangle(0, 0, s, s),
    resolution: 2,
  });
  g.destroy();
  return hatchTexture;
}

function ensureTicker(): void {
  if (ticking) return;
  ticking = true;
  canvas.app.ticker.add(onTick);
}

function onTick(): void {
  if (!active) return;
  const remaining = active.expiresAt - Date.now();
  if (remaining <= -FADE_MS) {
    clearArrangeArea();
  } else if (remaining < 0) {
    active.container.alpha = 1 + remaining / FADE_MS;
  }
}

export function registerArrangeOverlay(): void {
  game.settings.register(MODULE_ID, ARRANGE_SECONDS_SETTING, {
    name: `${MODULE_ID}.settings.arrangeSeconds.name`,
    hint: `${MODULE_ID}.settings.arrangeSeconds.hint`,
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
  });

  Hooks.on('canvasTearDown', () => {
    clearArrangeArea();
    canvas.app.ticker.remove(onTick);
    ticking = false;
    // The texture belongs to the torn-down canvas; rebuild it lazily next time.
    hatchTexture?.destroy(true);
    hatchTexture = null;
  });
}
