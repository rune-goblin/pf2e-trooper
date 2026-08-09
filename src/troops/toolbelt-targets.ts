import type { ChatMessagePF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { troopFlags } from './context';

// pf2e-toolbelt's target helper normally builds its rows from `user.targets`, which targeting.ts
// has already reduced to one segment per troop. Its template helper is the exception: it stamps
// the card from the token list it just measured out of the region, so the canvas ends up with one
// target and the card with four rows against a shared HP pool.
//
// Trimming that one write is the whole of it — the rows, the saves and the damage buttons all read
// back from this flag.

const TOOLBELT_ID = 'pf2e-toolbelt';

interface ToolbeltFlags {
  [TOOLBELT_ID]?: { targetHelper?: { targets?: unknown } };
}

/**
 * Keeps the last uuid of each troop, which is the segment the canvas is left targeting: the
 * template helper targets its tokens in order, and each one sheds the siblings before it.
 */
export function dedupeTroopUuids(uuids: string[], troopOf: (uuid: string) => string | null): string[] {
  const survivor = new Map<string, string>();
  for (const uuid of uuids) {
    const troop = troopOf(uuid);
    if (troop) survivor.set(troop, uuid);
  }
  if (survivor.size === 0) return uuids;
  const kept = new Set(survivor.values());
  return uuids.filter((uuid) => !troopOf(uuid) || kept.has(uuid));
}

function troopOfUuid(uuid: string): string | null {
  const token = fromUuidSync(uuid) as TokenDocumentPF2e | null;
  return troopFlags(token)?.id ?? null;
}

function onPreUpdateChatMessage(_message: ChatMessagePF2e, changed: Record<string, unknown>): void {
  const helper = (changed.flags as ToolbeltFlags | undefined)?.[TOOLBELT_ID]?.targetHelper;
  if (!Array.isArray(helper?.targets)) return;
  const deduped = dedupeTroopUuids(helper.targets as string[], troopOfUuid);
  if (deduped.length !== helper.targets.length) helper.targets = deduped;
}

export function registerToolbeltTargetTrim(): void {
  if (!game.modules.get(TOOLBELT_ID)?.active) return;
  Hooks.on('preUpdateChatMessage', onPreUpdateChatMessage);
}
