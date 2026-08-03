import type { ActorPF2e, ItemPF2e, NPCPF2e, ScenePF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { segmentContext, troopFlags } from './context';
import { type ItemSourceLike, planItemReconcile, syncableSystemDiff } from './logic';

// Full-state sync between troop segments, structured as record-then-reconcile:
// hooks never write — mid-cascade writes against synthetic actors proved to race
// Foundry's own workflow (stale actor instances, keepId collisions landing on the
// wrong ActorDelta). Instead hooks queue the troop, and a debounced, serialized
// reconciler re-resolves every document fresh from the scene and converges each
// sibling onto the segment where the change originated.

/** Operation key marking reconciler writes so hooks don't re-queue them. */
export const SYNC_OPTION = 'pf2eTrooperSync';

const MIRROR_OPTIONS = { [SYNC_OPTION]: true } as never;
const MIRROR_KEEP_ID = { [SYNC_OPTION]: true, keepId: true } as never;

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
  sceneId: string;
  troopId: string;
  /** Token id of the segment the change originated on — the reconcile authority. */
  leaderTokenId: string;
  /** Actor-system diffs accumulated since the last flush, applied before item reconciliation. */
  systemDiffs: Record<string, unknown>[];
}

const pending = new Map<string, PendingReconcile>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Serialization chain: reconciles never overlap each other. */
let flushChain: Promise<void> = Promise.resolve();

function queueReconcile(actor: ActorPF2e | null, systemDiff?: Record<string, unknown>): void {
  const ctx = segmentContext(actor);
  if (!ctx || !ctx.token.parent) return;
  const key = `${ctx.token.parent.id}:${ctx.troopId}`;
  const entry = pending.get(key) ?? {
    sceneId: ctx.token.parent.id,
    troopId: ctx.troopId,
    leaderTokenId: ctx.token.id,
    systemDiffs: [],
  };
  entry.leaderTokenId = ctx.token.id;
  if (systemDiff) entry.systemDiffs.push(systemDiff);
  pending.set(key, entry);

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

async function reconcileTroop(job: PendingReconcile): Promise<void> {
  const scene = game.scenes.get(job.sceneId) as ScenePF2e | undefined;
  if (!scene) return;
  const tokens = scene.tokens.contents.filter((t) => troopFlags(t)?.id === job.troopId);
  const leader = tokens.find((t) => t.id === job.leaderTokenId) ?? tokens[0];
  const leaderActor = leader?.actor;
  if (!leaderActor?.isOfType('npc')) return;

  const leaderItems = leaderActor.items.map((i) => i.toObject() as ItemSourceLike);
  for (const token of tokens) {
    if (token === leader) continue;
    const sibling = token.actor;
    if (!sibling?.isOfType('npc')) continue;
    await reconcileSibling(sibling, job.systemDiffs, leaderItems);
  }
}

async function reconcileSibling(
  sibling: NPCPF2e,
  systemDiffs: Record<string, unknown>[],
  leaderItems: ItemSourceLike[],
): Promise<void> {
  for (const diff of systemDiffs) {
    await sibling
      .update({ system: structuredClone(diff) }, MIRROR_OPTIONS)
      ?.catch?.((error: unknown) => console.error(`${MODULE_ID} | system sync failed`, error));
  }

  const siblingItems = sibling.items.map((i) => i.toObject() as ItemSourceLike);
  const plan = planItemReconcile(leaderItems, siblingItems, isExcludedItemSource);
  try {
    if (plan.delete.length > 0) await sibling.deleteEmbeddedDocuments('Item', plan.delete, MIRROR_OPTIONS);
    if (plan.update.length > 0) {
      await sibling.updateEmbeddedDocuments('Item', structuredClone(plan.update), MIRROR_OPTIONS);
    }
    if (plan.create.length > 0) {
      await sibling.createEmbeddedDocuments('Item', structuredClone(plan.create), MIRROR_KEEP_ID);
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
  const diff =
    changed.system && typeof changed.system === 'object' ? syncableSystemDiff(changed.system) : null;
  // Item changes ride along inside delta updates too, so queue even without a system diff.
  queueReconcile(actor, diff ?? undefined);
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
