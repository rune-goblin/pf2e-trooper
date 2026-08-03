import type { ActorPF2e, NPCPF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import type { ThresholdEntry } from './logic';

// The bundled foundry-pf2e typedefs predate pf2e 8.x troop support, so the troop
// flag and hp.thresholds are read through structural casts kept in this one file.

export interface TroopFlags {
  id: string;
  linked: boolean;
}

type MaybeTroopToken = TokenDocumentPF2e & { flags: { pf2e?: { troop?: TroopFlags } } };

export interface SegmentContext {
  actor: NPCPF2e;
  token: TokenDocumentPF2e;
  troopId: string;
  /** The other segments' synthetic actors in the same scene. */
  siblings: NPCPF2e[];
}

export function troopFlags(token: TokenDocumentPF2e | null): TroopFlags | null {
  const troop = (token as MaybeTroopToken | null)?.flags?.pf2e?.troop;
  return troop?.id ? troop : null;
}

/** Resolve an actor to its troop-segment context, or null when it isn't a troop segment. */
export function segmentContext(actor: ActorPF2e | null): SegmentContext | null {
  if (!actor?.isOfType('npc') || !actor.token) return null;
  const token = actor.token;
  const troop = troopFlags(token);
  if (!troop) return null;
  const siblings = (token.parent?.tokens.contents ?? [])
    .filter((t) => t.id !== token.id && troopFlags(t)?.id === troop.id)
    .map((t) => t.actor)
    .filter((a) => !!a?.isOfType('npc')) as unknown as NPCPF2e[];
  return { actor, token, troopId: troop.id, siblings };
}

/** Derived troop HP thresholds; non-null exactly when the pf2e system treats the NPC as a troop. */
export function hpThresholds(actor: ActorPF2e | null): ThresholdEntry[] | null {
  if (!actor?.isOfType('npc')) return null;
  const hp = actor.system.attributes.hp as { thresholds?: ThresholdEntry[] | null };
  return hp.thresholds ?? null;
}
