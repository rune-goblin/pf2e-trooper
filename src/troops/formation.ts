import type { TokenDocumentPF2e, TokenPF2e } from 'foundry-pf2e';
import {
  activeArrangeTroopId,
  arrangeDisposition,
  clearArrangeArea,
  isArrangeAnchor,
  pauseArrangeTimer,
  resetArrangeTimer,
  resumeArrangeTimer,
  showArrangeArea,
} from './arrange';
import { independentMovement, registerBreakFormation } from './break-formation';
import { troopFlags } from './context';
import { followMoves } from './logic';

// Formation movement, plus one selection rule: at most one segment of a troop is
// ever controlled (newest control wins). A native multi-segment drag would give
// every piece its own ruler and no leader — no formation follow, no advisory
// area — so rubber-bands and shift-clicks dedupe down to a single segment.
// Dragging that segment translates the rest of the formation by the same offset
// and paints the advisory wiggle-room area (see arrange.ts). While that area is
// visible, the anchor (the segment whose move opened it) is locked in place; a
// drag of another segment landing inside the area repositions only that segment,
// landing outside it is a fresh unit move.
//
// Holding the break-formation key opts out of all of it for one gesture — see break-formation.ts.

/** Operation key marking follower moves so they don't re-trigger the formation. */
const FOLLOW_OPTION = 'pf2eTrooperFollow';
/** Pre-update positions, keyed by token id — the options object is shared by every document in one operation. */
const PRIOR_KEY = 'pf2eTrooperPrior';
/** Troop ids already handled in this operation (covers several segments of one troop moving together). */
const MOVED_KEY = 'pf2eTrooperMoved';

type HookOptions = Record<string, unknown>;
type PriorMap = Record<string, { x: number; y: number }>;

function onControlToken(token: TokenPF2e, controlled: boolean): void {
  if (!controlled) return;
  // The break-formation key keeps a multi-segment selection alive: those segments are about to move
  // independently of each other, so there is no leader to dedupe down to.
  if (independentMovement()) return;
  const troop = troopFlags(token.document);
  if (!troop) return;
  for (const other of [...canvas.tokens.controlled]) {
    if (other !== token && troopFlags(other.document)?.id === troop.id) other.release();
  }
}

/**
 * The veto point for troop movement. Refusals must happen here, not in preUpdateToken:
 * by the time that hook fires, v14's movement pipeline has already registered the move's
 * workflow, and discarding the update at the hook layer leaves that workflow dangling —
 * the drag preview clone waits on it forever and strands an unselectable ghost token on
 * the canvas. Refusing preMoveToken instead stops the movement cleanly.
 */
function onPreMoveToken(doc: TokenDocumentPF2e, movement: { destination: { x: number; y: number } }, operation: HookOptions): boolean | void {
  if (operation[FOLLOW_OPTION]) return;
  const troop = troopFlags(doc);
  if (!troop) return;
  const scene = doc.parent;
  if (!scene) return;
  const disposition = arrangeDisposition(doc, troop.id, scene.id, movement.destination);

  // Break-formation held: the segment may go anywhere. A drop beyond a visible area ends
  // the arrangement outright: left up, it would hold itself open and red over a segment
  // that has deliberately left.
  if (independentMovement()) {
    if (disposition === 'outside') clearArrangeArea();
    return;
  }

  if (isArrangeAnchor(doc.id, scene.id)) return false;

  // While the area is up the troop is mid-arrangement, so a segment may not leave it:
  // the drop is refused and the segment springs back to where it was. Without this,
  // dragging a follower out read as a fresh unit move and the whole troop chased it,
  // silently promoting that segment to anchor.
  if (disposition === 'outside') return false;
}

function onPreUpdateToken(doc: TokenDocumentPF2e, changed: Record<string, unknown>, options: HookOptions): void {
  if (options[FOLLOW_OPTION]) return;
  if (typeof changed.x !== 'number' && typeof changed.y !== 'number') return;
  if (!troopFlags(doc)) return;

  // Break-formation held: this segment moves alone. Recording no prior position is what
  // carries that through — onUpdateToken keys off the prior, so nothing follows and no
  // area opens.
  if (independentMovement()) return;

  const prior = (options[PRIOR_KEY] ??= {}) as PriorMap;
  prior[doc.id] = { x: doc._source.x, y: doc._source.y };
}

function onUpdateToken(doc: TokenDocumentPF2e, changed: Record<string, unknown>, options: HookOptions, userId: string): void {
  if (userId !== game.user.id || options[FOLLOW_OPTION]) return;
  const priorMap = options[PRIOR_KEY] as PriorMap | undefined;
  const prior = priorMap?.[doc.id];
  if (!prior) return;
  const troop = troopFlags(doc);
  const scene = doc.parent;
  if (!troop || !scene) return;

  const handled = (options[MOVED_KEY] ??= {}) as Record<string, boolean>;
  if (handled[troop.id]) return;
  handled[troop.id] = true;

  const movedX = typeof changed.x === 'number' && changed.x !== prior.x;
  const movedY = typeof changed.y === 'number' && changed.y !== prior.y;
  if (!movedX && !movedY) return;

  const final = {
    x: typeof changed.x === 'number' ? changed.x : prior.x,
    y: typeof changed.y === 'number' ? changed.y : prior.y,
  };

  // With an area up, the only drops that reach here are reshapes — leaving it was
  // refused in preUpdate. Everything else is a unit move: no area governs this troop.
  if (arrangeDisposition(doc, troop.id, scene.id, final) === 'inside') {
    resetArrangeTimer();
    return;
  }

  const siblings = scene.tokens.contents.filter((t) => t.id !== doc.id && troopFlags(t)?.id === troop.id);

  // One operation carrying several segments of the troop exists only through a
  // Break-Formation selection, so it is a manual override even if the key was released
  // before the drop: the user placed those segments — nothing follows, no area opens.
  if (siblings.some((t) => priorMap?.[t.id])) return;

  // Delta from the update payload, follower positions from _source: the document's
  // prepared x/y lags behind _source during v14's movement pipeline, so reading it
  // here yields the pre-move position (and a zero delta).
  const followers = siblings.map((t) => ({ id: t.id, x: t._source.x, y: t._source.y }));

  // Advisory-area inputs, captured before the follow updates land: each remaining
  // segment's budget is measured from its own pre-move origin.
  const arrangeCtx = {
    leaderId: doc.id,
    leaderPrior: prior,
    leaderFinal: final,
    origins: followers.map(({ x, y }) => ({ x, y })),
  };

  const updates = followMoves(changed, prior, followers);
  if (updates.length > 0) {
    scene
      .updateEmbeddedDocuments('Token', updates, { [FOLLOW_OPTION]: true } as never)
      .then(() => showArrangeArea(scene, troop.id, arrangeCtx))
      .catch((error) => console.error('pf2e-trooper | formation follow failed', error));
  } else {
    showArrangeArea(scene, troop.id, arrangeCtx);
  }
}

function onCanvasPointerDown(event: PointerEvent): void {
  if (event.target !== canvas.app?.view) return;
  const troopId = activeArrangeTroopId();
  if (!troopId) return;
  const hovered = (canvas.tokens as unknown as { hover: TokenPF2e | null }).hover;
  if (hovered && troopFlags(hovered.document)?.id === troopId) pauseArrangeTimer();
}

function onCanvasPointerUp(): void {
  resumeArrangeTimer();
}

export function registerFormationControls(): void {
  registerBreakFormation();
  Hooks.on('controlToken', onControlToken);
  Hooks.on('preMoveToken', onPreMoveToken);
  Hooks.on('preUpdateToken', onPreUpdateToken);
  Hooks.on('updateToken', onUpdateToken);
  document.addEventListener('pointerdown', onCanvasPointerDown);
  document.addEventListener('pointerup', onCanvasPointerUp);
  // Without this a pointer released off-window never resumes, freezing the area forever.
  document.addEventListener('pointercancel', onCanvasPointerUp);
  window.addEventListener('blur', onCanvasPointerUp);
}
