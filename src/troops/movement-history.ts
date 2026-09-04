import type { ScenePF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { troopFlags } from './context';

// Once combat starts, Foundry banks a movement path per token and draws it under the token it
// belongs to. A troop moves as one, so a single order paints a trail and a distance chip for
// every segment — a fan of converging lines over the advisory area that already says how much
// room the troop has left. Troop segments therefore bank nothing.
//
// Emptying the staged history beats replacing `_shouldRecordMovementHistory`: preUpdateToken
// runs after core stages the field, so an ordinary hook does the job and nothing competes for
// that prototype method — pf2e-toolbelt overrides it outright for its own movement tools.

// A fresh object per call: Foundry writes its own fields (parent, parentUuid, the
// updates) into the operation it is handed, so a shared constant reaches the next call
// already populated — see mirrorOptions in sync.ts for the write that lost.
const clearHistoryOptions = () => ({ diff: false, noHook: true, _clearMovementHistory: true }) as never;

/** Empties the history core staged for this update. Returns whether it acted. */
export function suppressHistory(changed: Record<string, unknown>, isSegment: boolean): boolean {
  if (!isSegment || !('_movementHistory' in changed)) return false;
  changed._movementHistory = [];
  return true;
}

function onPreUpdateToken(doc: TokenDocumentPF2e, changed: Record<string, unknown>): void {
  suppressHistory(changed, !!troopFlags(doc));
}

/**
 * Trails banked before this module ran — or by whatever else records them — outlive the move
 * that made them, so they are cleared once the scene is up rather than left until combat ends.
 */
async function clearBankedHistory(scene: ScenePF2e | null): Promise<void> {
  if (!game.user.isGM || !scene) return;
  const stale = scene.tokens.contents.filter((t) => troopFlags(t) && t.movementHistory.length > 0);
  if (stale.length === 0) return;
  await scene.updateEmbeddedDocuments(
    'Token',
    stale.map((t) => ({ _id: t.id })),
    clearHistoryOptions(),
  );
}

export function registerMovementHistorySuppression(): void {
  Hooks.on('preUpdateToken', onPreUpdateToken);
  Hooks.on('canvasReady', (c: { scene: ScenePF2e | null }) => {
    clearBankedHistory(c.scene).catch((error) =>
      console.error(`${MODULE_ID} | clearing troop movement history failed`, error),
    );
  });
}
