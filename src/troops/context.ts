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

/**
 * The world actor a troop segment was placed from. Segment tokens are always unlinked,
 * so `linked` is the only marker that one stands in for a world actor rather than
 * living scene-locally.
 */
export function baseActorFor(token: TokenDocumentPF2e | null): NPCPF2e | null {
  if (!troopFlags(token)?.linked) return null;
  const actorId = (token as unknown as { actorId?: string | null } | null)?.actorId;
  const actor = actorId ? game.actors.get(actorId) : null;
  return actor?.isOfType('npc') ? (actor as unknown as NPCPF2e) : null;
}

/**
 * Every segment of one troop. Identity is the troop id, never the actor id or the
 * token: a linked troop is a single unit wherever its segments sit, so placing one
 * twice in a scene makes eight segments of one troop, not two troops. An unlinked
 * troop is scene-local, so pass its scene to keep same-id troops in other scenes out.
 */
export function segmentTokensForTroop(troopId: string, sceneId?: string): TokenDocumentPF2e[] {
  const scene = sceneId ? game.scenes.get(sceneId) : null;
  const scenes = scene ? [scene] : sceneId ? [] : game.scenes.contents;
  const segments: TokenDocumentPF2e[] = [];
  for (const s of scenes) {
    for (const token of s.tokens.contents) {
      if (troopFlags(token)?.id === troopId) segments.push(token);
    }
  }
  return segments;
}

/**
 * Distinct troop ids this world actor has deployed. One entry is the normal case —
 * the id equals the actor's — and the set is what keeps a troop counted once.
 */
export function troopIdsForBase(actorId: string): string[] {
  const ids = new Set<string>();
  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      const troop = troopFlags(token);
      if (troop?.linked && (token as unknown as { actorId?: string | null }).actorId === actorId) {
        ids.add(troop.id);
      }
    }
  }
  return [...ids];
}

/** Derived troop HP thresholds; non-null exactly when the pf2e system treats the NPC as a troop. */
export function hpThresholds(actor: ActorPF2e | null): ThresholdEntry[] | null {
  if (!actor?.isOfType('npc')) return null;
  const hp = actor.system.attributes.hp as { thresholds?: ThresholdEntry[] | null };
  return hp.thresholds ?? null;
}
