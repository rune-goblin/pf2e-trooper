import type { TokenDocumentPF2e } from 'foundry-pf2e';
import { arrangeDisposition, resetArrangeTimer, showArrangeArea } from './arrange';
import { troopFlags } from './context';
import { followMoves } from './logic';

// Formation movement only — selection is left entirely to Foundry. Dragging one
// segment translates the rest of the formation by the same offset and paints the
// advisory wiggle-room area (see arrange.ts). While that area is visible, a drag
// landing inside it repositions only the dragged segment; landing outside it is a
// fresh unit move.

/** Operation key marking follower moves so they don't re-trigger the formation. */
const FOLLOW_OPTION = 'pf2eTrooperFollow';
/** Pre-update positions, keyed by token id — the options object is shared by every document in one operation. */
const PRIOR_KEY = 'pf2eTrooperPrior';
/** Troop ids already handled in this operation (covers several segments of one troop moving together). */
const MOVED_KEY = 'pf2eTrooperMoved';

type HookOptions = Record<string, unknown>;
type PriorMap = Record<string, { x: number; y: number }>;

function onPreUpdateToken(doc: TokenDocumentPF2e, changed: Record<string, unknown>, options: HookOptions): void {
  if (options[FOLLOW_OPTION]) return;
  if (typeof changed.x !== 'number' && typeof changed.y !== 'number') return;
  if (!troopFlags(doc)) return;
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

  // Spatial disambiguation while the area is visible: landing inside the shaded
  // squares repositions just this segment (and resets the countdown); landing
  // outside is a fresh unit move.
  if (arrangeDisposition(troop.id, scene.id, final, doc.width, doc.height) === 'inside') {
    resetArrangeTimer();
    return;
  }

  // Delta from the update payload, follower positions from _source: the document's
  // prepared x/y lags behind _source during v14's movement pipeline, so reading it
  // here yields the pre-move position (and a zero delta). Segments that moved in
  // this same operation (a native multi-token drag) keep their own movement.
  const siblings = scene.tokens.contents.filter((t) => t.id !== doc.id && troopFlags(t)?.id === troop.id);
  const followers = siblings
    .filter((t) => !priorMap?.[t.id])
    .map((t) => ({ id: t.id, x: t._source.x, y: t._source.y }));

  // Advisory-area inputs, captured before the follow updates land: each remaining
  // segment's budget is measured from its own pre-move origin.
  const arrangeCtx = {
    leaderId: doc.id,
    leaderPrior: prior,
    leaderFinal: final,
    origins: siblings.map((t) => priorMap?.[t.id] ?? { x: t._source.x, y: t._source.y }),
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

export function registerFormationControls(): void {
  Hooks.on('preUpdateToken', onPreUpdateToken);
  Hooks.on('updateToken', onUpdateToken);
}
