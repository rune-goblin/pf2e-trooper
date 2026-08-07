import type { ScenePF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '../constants';
import {
  type ArrangeTimer,
  holdTimer,
  releaseTimer,
  resetTimer,
  startTimer,
  timerAlpha,
} from './arrange-timer';
import { troopFlags } from './context';
import {
  type GridRect,
  attachablePlacements,
  footprintCells,
  layoutFaults,
  reachablePlacements,
} from './logic';

// The advisory area painted after a unit move: everywhere the remaining segments
// could legally end up, under both RAW constraints. Movement: followers regroup
// "provided none of them moves farther than the moving segment" — each remaining
// segment's budget is the leader's spent movement, measured from its own pre-move
// origin with the grid's real diagonal rule (PF2e 5-10-5). Attachment: segments
// must share at least one full square edge with the troop (chains through other
// segments allowed), so the area grows outward from the moved segment through
// budget-valid placements only and never spreads across the map. Drawn once when
// it opens; reshape drags reset the timer.
//
// Inside the area you shape the formation by dragging freely and the colour reports the
// verdict: an illegal layout (segments detached or stacked) paints the area red and holds
// it open, and it only turns green and resumes fading once the troop is legal again.
// The area's edge is the hard boundary — while it is up the anchor cannot move at all and
// no other segment may leave, so a drop outside is refused and the segment springs back.
// Once it fades, dragging any segment is an ordinary unit move again; Escape dismisses it
// early, which is the only way out if the area's squares admit no legal arrangement.

/** PIXI display-object names — stable handles for e2e specs; `npm run init` rewrites the id. */
export const AREA_NAME = 'pf2e-trooper:arrange-area';
export const HATCH_NAME = 'pf2e-trooper:arrange-hatch';

export const HATCH_COLOR = 0x2fe04a;
/** The same saturation and weight as HATCH_COLOR so only the hue reads as the change. */
export const INVALID_COLOR = 0xff2f2f;
const ANCHOR_COLOR = 0xffc94d;
const HATCH_ALPHA = 0.75;
/** A wash under the hatching so the area reads as a filled region, not just stripes. */
const FILL_ALPHA = 0.22;
const BORDER_WIDTH = 4;
/** Black halo under the coloured edge — keeps the outline legible over bright map art. */
const BORDER_BACKING_WIDTH = 8;
const BORDER_BACKING_ALPHA = 0.55;
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
  /** The anchor token — locked in place while the area is visible. */
  anchorTokenId: string;
  /** The shaded placement area — z-indexed beneath tokens. */
  area: PIXI.Container;
  /** The anchor marker — its own layer above tokens so it outlines the anchor token itself. */
  anchor: PIXI.Container;
  /** Re-tinted in place when the layout goes illegal — cheaper than rebuilding the overlay. */
  sprite: PIXI.TilingSprite;
  fill: PIXI.Graphics;
  borders: PIXI.Graphics;
  faulted: boolean;
  timer: ArrangeTimer;
  /** Grid squares ("x,y") the painted area covers — the inside/outside test for drags. */
  cells: Set<string>;
  /** The troop's segment token ids, resolved once — membership can't change while the area is up. */
  segmentIds: string[];
}

let active: ArrangeArea | null = null;
let hatchTexture: PIXI.Texture | null = null;
let ticking = false;

/**
 * How a troop segment's drag destination relates to the visible area (fade included —
 * as long as the shading is on screen, it governs the drag). 'inside': the whole
 * footprint lands in the shaded squares, so the drag is a reshape. 'outside': it would
 * leave the area, which is refused while the area is up. 'none': no area governs this
 * troop, so the drag is an ordinary unit move and the rest of the formation follows.
 */
export function arrangeDisposition(
  doc: TokenDocumentPF2e,
  troopId: string,
  sceneId: string,
  finalPx: { x: number; y: number },
): 'none' | 'inside' | 'outside' {
  if (!active || active.troopId !== troopId || active.sceneId !== sceneId) return 'none';
  for (const cell of occupiedCells(doc, finalPx)) {
    if (!active.cells.has(cell)) return 'outside';
  }
  return 'inside';
}

/** Whether this token is the anchor of a visible area — moves of it are blocked while so. */
export function isArrangeAnchor(tokenId: string, sceneId: string | undefined): boolean {
  return active !== null && active.anchorTokenId === tokenId && active.sceneId === sceneId;
}

export function activeArrangeTroopId(): string | null {
  return active?.troopId ?? null;
}

export function showArrangeArea(scene: ScenePF2e, troopId: string, ctx: ArrangeContext): void {
  clearArrangeArea();
  if (!canvas.ready || canvas.scene?.id !== scene.id) return;
  if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return;

  const built = buildOverlay(scene, ctx);
  if (!built) return;
  // canvas.interface sorts children by zIndex: keep the area beneath tokens, lift
  // the anchor marker above them.
  built.anchor.zIndex = ((canvas.tokens as unknown as { zIndex?: number }).zIndex ?? 100) + 1;
  (canvas.interface as unknown as PIXI.Container).addChild(built.area, built.anchor);
  active = {
    troopId,
    sceneId: scene.id,
    anchorTokenId: ctx.leaderId,
    area: built.area,
    anchor: built.anchor,
    sprite: built.sprite,
    fill: built.fill,
    borders: built.borders,
    faulted: false,
    timer: startTimer(Date.now()),
    cells: built.cells,
    segmentIds: scene.tokens.contents.filter((t) => troopFlags(t)?.id === troopId).map((t) => t.id),
  };
  ensureTicker();
}

export function resetArrangeTimer(): void {
  if (!active) return;
  active.timer = resetTimer(active.timer, Date.now());
}

export function pauseArrangeTimer(): void {
  if (!active) return;
  active.timer = holdTimer(active.timer, 'pointer', Date.now());
}

export function resumeArrangeTimer(): void {
  if (!active) return;
  active.timer = releaseTimer(active.timer, 'pointer', Date.now());
}

export function clearArrangeArea(): void {
  if (!active) return;
  active.area.destroy({ children: true });
  active.anchor.destroy({ children: true });
  active = null;
}

// Grid coordinates come from the grid object, never from px/size arithmetic: that assumed
// squares anchored at the origin and a token footprint of exactly width×height. Foundry's
// GridOffset is {i: row, j: column}, so it transposes into our "x,y" cell keys.

function toCell(point: { x: number; y: number }): { x: number; y: number } {
  const { i, j } = canvas.grid.getOffset(point);
  return { x: j, y: i };
}

/** Inverse of toCell — the square's top-left in pixels. */
function cellTopLeft(cx: number, cy: number): { x: number; y: number } {
  return canvas.grid.getTopLeftPoint({ i: cy, j: cx });
}

/**
 * The squares a segment actually occupies. getSize() resolves the token's real footprint
 * and getOffsetRange() maps that rectangle onto the grid, so this holds for tokens whose
 * size isn't a plain whole-square block.
 */
function occupiedCells(doc: TokenDocumentPF2e, at: { x: number; y: number }): Set<string> {
  const size = doc.getSize();
  const [i0, j0, i1, j1] = canvas.grid.getOffsetRange(
    new PIXI.Rectangle(at.x, at.y, size.width, size.height),
  );
  const cells = new Set<string>();
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) cells.add(`${j},${i}`);
  return cells;
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

interface BuiltOverlay {
  area: PIXI.Container;
  anchor: PIXI.Container;
  sprite: PIXI.TilingSprite;
  fill: PIXI.Graphics;
  borders: PIXI.Graphics;
  cells: Set<string>;
}

function buildOverlay(scene: ScenePF2e, ctx: ArrangeContext): BuiltOverlay | null {
  const leader = scene.tokens.get(ctx.leaderId);
  if (!leader || ctx.origins.length === 0) return null;
  const px = canvas.grid.size;
  const measure = offsetMeasurer();

  const finalCell = toCell(ctx.leaderFinal);
  const priorCell = toCell(ctx.leaderPrior);
  const budget = Math.min(
    measure(finalCell.x - priorCell.x, finalCell.y - priorCell.y),
    MAX_BUDGET_SQUARES,
  );
  if (budget <= 0) return null;

  const leaderRect: GridRect = { ...finalCell, w: leader.width, h: leader.height };
  const origins = ctx.origins.map(toCell);
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

  // Named so tests (and the PIXI devtools) can find the overlay without index-guessing.
  const container = new PIXI.Container();
  container.name = AREA_NAME;
  container.eventMode = 'none';

  const origin = cellTopLeft(minX, minY);
  const sprite = new PIXI.TilingSprite(getHatchTexture(), (maxX - minX + 1) * px, (maxY - minY + 1) * px);
  sprite.name = HATCH_NAME;
  sprite.position.set(origin.x, origin.y);
  sprite.tint = HATCH_COLOR;
  sprite.alpha = HATCH_ALPHA;

  const mask = new PIXI.Graphics();
  const fill = new PIXI.Graphics();
  fill.tint = HATCH_COLOR;
  fill.beginFill(0xffffff, FILL_ALPHA);
  mask.beginFill(0xffffff);
  for (const [cx, cy] of cellList) {
    const tl = cellTopLeft(cx, cy);
    mask.drawRect(tl.x, tl.y, px, px);
    fill.drawRect(tl.x, tl.y, px, px);
  }
  mask.endFill();
  fill.endFill();
  sprite.mask = mask;

  // Outline only the area's outer edge: a cell side is drawn when no neighbor cell abuts it.
  // Stroked white and tinted, like the hatch texture — tint multiplies, so a coloured
  // stroke could never be re-tinted to the invalid red. The backing pass is its own
  // untinted Graphics for the same reason: a tint applies to the whole object.
  const backing = new PIXI.Graphics();
  backing.lineStyle(BORDER_BACKING_WIDTH, 0x000000, BORDER_BACKING_ALPHA);
  const borders = new PIXI.Graphics();
  borders.tint = HATCH_COLOR;
  borders.lineStyle(BORDER_WIDTH, 0xffffff, 1);
  for (const [cx, cy] of cellList) {
    const { x, y } = cellTopLeft(cx, cy);
    for (const g of [backing, borders]) {
      if (!cells.has(`${cx},${cy - 1}`)) g.moveTo(x, y).lineTo(x + px, y);
      if (!cells.has(`${cx},${cy + 1}`)) g.moveTo(x, y + px).lineTo(x + px, y + px);
      if (!cells.has(`${cx - 1},${cy}`)) g.moveTo(x, y).lineTo(x, y + px);
      if (!cells.has(`${cx + 1},${cy}`)) g.moveTo(x + px, y).lineTo(x + px, y + px);
    }
  }

  container.addChild(fill, sprite, mask, backing, borders);

  // Anchor marker: the moved segment at its final position — the piece the rest of
  // the troop regroups around, locked in place while the area is visible.
  const anchorMark = new PIXI.Graphics();
  anchorMark.lineStyle(3, ANCHOR_COLOR, 0.9);
  anchorMark.beginFill(ANCHOR_COLOR, 0.12);
  const anchorTopLeft = cellTopLeft(leaderRect.x, leaderRect.y);
  const anchorSize = leader.getSize();
  anchorMark.drawRect(anchorTopLeft.x, anchorTopLeft.y, anchorSize.width, anchorSize.height);
  anchorMark.endFill();
  const anchor = new PIXI.Container();
  anchor.eventMode = 'none';
  anchor.addChild(anchorMark);

  return { area: container, anchor, sprite, fill, borders, cells };
}

function getHatchTexture(): PIXI.Texture {
  if (hatchTexture) return hatchTexture;
  const s = 16;
  const g = new PIXI.Graphics();
  g.lineStyle(5, 0xffffff, 1);
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

interface SegmentLayout {
  anchor: Set<string>;
  followers: Set<string>[];
}

/**
 * Segment rects, with `overrides` (px) standing in for any segment not at its settled
 * position. Settled positions come from `_source` — the prepared x/y lags behind during
 * v14's movement pipeline, so mid-drop it reports the old layout.
 */
function segmentLayout(
  area: ArrangeArea,
  overrides: Map<string, { x: number; y: number }>,
): SegmentLayout | null {
  const scene = canvas.scene;
  if (!scene || scene.id !== area.sceneId) return null;
  let anchor: Set<string> | null = null;
  const followers: Set<string>[] = [];
  for (const id of area.segmentIds) {
    const doc = scene.tokens.get(id);
    if (!doc) continue;
    const cells = occupiedCells(doc, overrides.get(id) ?? { x: doc._source.x, y: doc._source.y });
    if (id === area.anchorTokenId) anchor = cells;
    else followers.push(cells);
  }
  return anchor ? { anchor, followers } : null;
}

/**
 * Live positions of segments being dragged right now. Foundry drags a clone in
 * `canvas.tokens.preview` and leaves the real document untouched until the drop, so
 * without this the overlay would only react after the fact.
 */
function draggedPositions(): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const preview = (canvas.tokens as unknown as { preview: PIXI.Container | null }).preview;
  for (const child of preview?.children ?? []) {
    const clone = child as unknown as {
      _original?: { id: string };
      document?: { x: number; y: number };
    };
    const id = clone._original?.id;
    if (id && clone.document) positions.set(id, { x: clone.document.x, y: clone.document.y });
  }
  return positions;
}

function onTick(): void {
  if (!active) return;
  const now = Date.now();

  // An illegal formation holds the area open and turns it red: it stops being a
  // countdown and starts being a "you're not done yet" marker. Evaluated against the
  // in-flight drag position, so the warning tracks the segment under the cursor rather
  // than appearing only once it has landed.
  const layout = segmentLayout(active, draggedPositions());
  const faulted =
    layout !== null && layoutFaults(layout.anchor, layout.followers, active.cells).length > 0;
  active.timer = faulted
    ? holdTimer(active.timer, 'layout', now)
    : releaseTimer(active.timer, 'layout', now);
  if (faulted !== active.faulted) {
    active.faulted = faulted;
    const tint = faulted ? INVALID_COLOR : HATCH_COLOR;
    active.sprite.tint = tint;
    active.fill.tint = tint;
    active.borders.tint = tint;
  }

  const alpha = timerAlpha(active.timer, now);
  if (alpha <= 0) {
    clearArrangeArea();
    return;
  }
  active.area.alpha = alpha;
  active.anchor.alpha = alpha;
}

export function registerArrangeOverlay(): void {
  // The escape hatch. While the area is up the anchor is frozen and no segment may leave,
  // so a troop with no legal arrangement available inside a cramped area would otherwise
  // have no way out. Dismissing drops the area and restores ordinary unit movement.
  game.keybindings.register(MODULE_ID, 'dismissArrangeArea', {
    name: `${MODULE_ID}.keybindings.dismissArrangeArea.name`,
    hint: `${MODULE_ID}.keybindings.dismissArrangeArea.hint`,
    editable: [{ key: 'Escape', modifiers: [] }],
    // Ahead of core's Escape, but only consumed when an area is actually up — otherwise
    // Escape still clears selection and opens the menu as usual.
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: () => {
      if (!active) return false;
      clearArrangeArea();
      return true;
    },
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
