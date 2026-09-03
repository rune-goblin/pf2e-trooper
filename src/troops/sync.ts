import type { ActorPF2e, ItemPF2e, NPCPF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { baseActorFor, segmentContext, segmentTokensForTroop, troopFlags, troopIdsForBase } from './context';
import { type ItemSourceLike, baseSyncableSystemDiff, planItemReconcile, reconcileKey, syncableSystemDiff } from './logic';

// Full-state sync between troop segments, structured as record-then-reconcile:
// hooks never write — mid-cascade writes against synthetic actors proved to race
// Foundry's own workflow (stale actor instances, keepId collisions landing on the
// wrong ActorDelta). Instead hooks queue the troop, and a debounced, serialized
// reconciler re-resolves every document fresh from the scene and converges each
// sibling onto the segment where the change originated.
//
// A linked troop's world actor is a peer in that convergence, in both directions:
// segments are unlinked, so without it a deployed troop's damage, conditions and
// threshold effects would live only on the scene and never reach the actor the
// kingdom layer reads.

/** Operation key marking reconciler writes so hooks don't re-queue them. */
export const SYNC_OPTION = 'pf2eTrooperSync';

// Fresh objects per call: Foundry writes its own fields (parent, pack, the pending
// updates) into the operation it is handed, so a shared constant carries the last
// write's state into the next one — and a world-actor update issued after a segment's
// is then dropped silently, with no error and no preUpdate.
const mirrorOptions = () => ({ [SYNC_OPTION]: true }) as never;
const mirrorKeepId = () => ({ [SYNC_OPTION]: true, keepId: true }) as never;

/**
 * Items that stay per-segment: rule-element grants re-grant locally through their
 * mirrored parent (copying them too would duplicate), and persistent damage ticks
 * per segment at end of turn — mirrored, it would burn the shared HP pool 4×.
 */
const UNSYNCED_ITEM_SLUGS = new Set(['persistent-damage']);

export function isExcludedItemSource(source: ItemSourceLike): boolean {
  const flags = source.flags as { pf2e?: { grantedBy?: unknown } } | undefined;
  if (flags?.pf2e?.grantedBy) return true;
  const system = source.system as { slug?: string | null } | undefined;
  return UNSYNCED_ITEM_SLUGS.has(system?.slug ?? '');
}

type HookOptions = Record<string, unknown>;

export function isMirrorEcho(options: HookOptions): boolean {
  return !!options[SYNC_OPTION] || !!options.fromTroop;
}

interface PendingReconcile {
  /** The unit. One job per troop id — never per token, per actor, or per placement. */
  troopId: string;
  /** Scene the troop is confined to; empty for a linked troop, which spans scenes. */
  sceneId: string;
  /** Token id of the segment the change originated on — the reconcile authority. */
  leaderTokenId: string;
  /** World actor id when it is the authority instead of a segment. */
  baseActorId: string;
  /** Raw actor-system diffs since the last flush, projected per target before they're applied. */
  systemDiffs: Record<string, unknown>[];
}

const pending = new Map<string, PendingReconcile>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Serialization chain: reconciles never overlap each other. */
let flushChain: Promise<void> = Promise.resolve();

function enqueue(key: string, entry: PendingReconcile, systemDiff?: Record<string, unknown>): void {
  const existing = pending.get(key);
  const job = existing ?? entry;
  job.sceneId = entry.sceneId;
  job.leaderTokenId = entry.leaderTokenId;
  job.baseActorId = entry.baseActorId;
  if (systemDiff) job.systemDiffs.push(systemDiff);
  pending.set(key, job);

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = [...pending.values()];
    pending.clear();
    flushChain = flushChain.then(async () => {
      for (const item of batch) {
        await reconcileTroop(item).catch((error) =>
          console.error(`${MODULE_ID} | segment reconcile failed`, error),
        );
      }
    });
  }, 60);
}

function queueReconcile(actor: ActorPF2e | null, systemDiff?: Record<string, unknown>): void {
  const ctx = segmentContext(actor);
  const troop = ctx ? troopFlags(ctx.token) : null;
  if (ctx?.token.parent && troop) {
    const sceneId = troop.linked ? '' : ctx.token.parent.id;
    enqueue(
      reconcileKey(troop, ctx.token.parent.id),
      { troopId: troop.id, sceneId, leaderTokenId: ctx.token.id, baseActorId: '', systemDiffs: [] },
      systemDiff,
    );
    return;
  }
  queueBaseReconcile(actor, systemDiff);
}

/** The world actor of a deployed troop is an authority in its own right — RM writes there. */
function queueBaseReconcile(actor: ActorPF2e | null, systemDiff?: Record<string, unknown>): void {
  if (!actor?.isOfType('npc') || actor.token) return;
  if (!actor.system.traits.value.includes('troop')) return;
  // One job per troop, so an actor deployed more than once converges each unit once
  // and shares the same key a segment-originated change would use.
  for (const troopId of troopIdsForBase(actor.id)) {
    enqueue(
      reconcileKey({ id: troopId, linked: true }, ''),
      { troopId, sceneId: '', leaderTokenId: '', baseActorId: actor.id, systemDiffs: [] },
      systemDiff,
    );
  }
}

async function reconcileTroop(job: PendingReconcile): Promise<void> {
  const segments = segmentTokensForTroop(job.troopId, job.sceneId || undefined);
  if (segments.length === 0) return;

  if (job.baseActorId) return reconcileFromBase(job, segments);

  const leader = segments.find((t) => t.id === job.leaderTokenId) ?? segments[0];
  const leaderActor = leader.actor;
  if (!leaderActor?.isOfType('npc')) return;

  const leaderItems = leaderActor.items.map((i) => i.toObject() as ItemSourceLike);

  // The world actor goes first. Writing the segments' ActorDeltas invalidates the
  // actor instance they derive from, and a write to it afterwards is dropped with no
  // error and no preUpdate — the stale-instance hazard this file is built around.
  const base = baseActorFor(leader);
  if (base) await reconcileTarget(base, project(job.systemDiffs, baseSyncableSystemDiff), leaderItems);

  const originScene = leader.parent?.id;
  for (const token of segments) {
    if (token === leader) continue;
    const sibling = token.actor;
    if (!sibling?.isOfType('npc')) continue;
    // The system's own HP propagation reaches the origin's scene and stops there, so
    // a segment of the same troop standing in another scene needs HP carried to it.
    const projection = token.parent?.id === originScene ? syncableSystemDiff : baseSyncableSystemDiff;
    await reconcileTarget(sibling, project(job.systemDiffs, projection), leaderItems);
  }
}

async function reconcileFromBase(job: PendingReconcile, segments: TokenDocumentPF2e[]): Promise<void> {
  const base = game.actors.get(job.baseActorId);
  if (!base?.isOfType('npc')) return;

  const baseItems = base.items.map((i) => i.toObject() as ItemSourceLike);
  // The system propagates HP between segments but never down from the world actor,
  // so every segment is written directly rather than left to one of its siblings.
  const diffs = project(job.systemDiffs, baseSyncableSystemDiff);
  for (const token of segments) {
    const segment = token.actor;
    if (!segment?.isOfType('npc')) continue;
    await reconcileTarget(segment, diffs, baseItems);
  }
}

function project(
  systemDiffs: Record<string, unknown>[],
  projection: (system: object) => Record<string, unknown> | null,
): Record<string, unknown>[] {
  return systemDiffs.map(projection).filter((d): d is Record<string, unknown> => !!d);
}

async function reconcileTarget(
  target: NPCPF2e,
  systemDiffs: Record<string, unknown>[],
  authorityItems: ItemSourceLike[],
): Promise<void> {
  for (const diff of systemDiffs) {
    await target
      .update({ system: structuredClone(diff) }, mirrorOptions())
      ?.catch?.((error: unknown) => console.error(`${MODULE_ID} | system sync failed`, error));
  }

  const targetItems = target.items.map((i) => i.toObject() as ItemSourceLike);
  const plan = planItemReconcile(authorityItems, targetItems, isExcludedItemSource);
  try {
    if (plan.delete.length > 0) await target.deleteEmbeddedDocuments('Item', plan.delete, mirrorOptions());
    if (plan.update.length > 0) {
      await target.updateEmbeddedDocuments('Item', structuredClone(plan.update), mirrorOptions());
    }
    if (plan.create.length > 0) {
      await target.createEmbeddedDocuments('Item', structuredClone(plan.create), mirrorKeepId());
    }
  } catch (error) {
    console.error(`${MODULE_ID} | item sync failed`, error);
  }
}

function isInitiator(userId: string): boolean {
  return userId === game.user.id;
}

function onUpdateActor(actor: ActorPF2e, changed: Record<string, unknown>, options: HookOptions, userId: string): void {
  if (!isInitiator(userId) || isMirrorEcho(options)) return;
  const diff = changed.system && typeof changed.system === 'object' ? (changed.system as object) : null;
  // Item changes ride along inside delta updates too, so queue even without a system diff.
  queueReconcile(actor, diff ? (structuredClone(diff) as Record<string, unknown>) : undefined);
}

function onItemChange(item: ItemPF2e, options: HookOptions, userId: string): void {
  if (!isInitiator(userId) || isMirrorEcho(options)) return;
  if (isExcludedItemSource(item.toObject() as ItemSourceLike)) return;
  queueReconcile(item.actor);
}

export function registerSegmentSync(): void {
  Hooks.on('updateActor', onUpdateActor);
  Hooks.on('createItem', onItemChange);
  Hooks.on('deleteItem', onItemChange);
  Hooks.on('updateItem', (item: ItemPF2e, _changed: object, options: HookOptions, userId: string) =>
    onItemChange(item, options, userId),
  );
}
