import type { ActorPF2e, ItemPF2e, NPCPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { hpThresholds, segmentContext } from './context';
import {
  REDUCED_EFFECT_SLUGS,
  type SegmentCount,
  type ThresholdEntry,
  clampHpToStatus,
  hpCapForStatus,
  segmentsForHp,
  statusFromSlugs,
} from './logic';
import { SYNC_OPTION, isMirrorEcho, reconciled } from './sync';

// Troop Reduced automation: crossing an HP threshold downward applies a persistent
// effect ("Troop Reduced — 3/2 Segments") to every segment, and while it's present
// healing is capped at the threshold — the unit's new effective maximum until it
// recovers. Recovery is a downtime decision, taken through setReducedStatus /
// recoverOneSegment below (the public api and the Recover Troop Segment macro).
//
// The effects deliberately carry no max-HP rule element: the system recomputes the
// threshold ladder from *modified* max HP, so reducing max would shift the ladder
// and corrupt both segment counts and this cap. Capping hp.value is the stable form.

export const REDUCED_EFFECT_IDS: Record<2 | 3, string> = {
  3: 'pmtTroopReduced3',
  2: 'pmtTroopReduced2',
};

const REDUCED_SLUGS = new Set<string>(Object.values(REDUCED_EFFECT_SLUGS));

function statusOf(actor: NPCPF2e): SegmentCount {
  return statusFromSlugs(actor.itemTypes.effect.map((e) => e.slug ?? ''));
}

/**
 * The actor the automation and the api write to: a segment's own synthetic actor, or a
 * troop world actor. Null for anything the system does not treat as a troop. One write
 * target is enough — the sync layer carries the result to every peer.
 */
function troopTarget(actor: ActorPF2e | null | undefined): NPCPF2e | null {
  if (!actor) return null;
  const target = segmentContext(actor)?.actor ?? (actor.isOfType('npc') ? (actor as NPCPF2e) : null);
  return target && hpThresholds(target) ? target : null;
}

function onPreUpdateActor(actor: ActorPF2e, changed: Record<string, unknown>, options: Record<string, unknown>): void {
  // A reconciler write carries HP already capped at its authority; capping it again would
  // pin a peer at its old cap when the effect that lifts it lands in the same reconcile.
  // Only the reconciler's writes, though: the system's own fromTroop propagation runs in
  // _preUpdate, before this hook capped the origin, so it carries the uncapped request.
  if (options[SYNC_OPTION]) return;
  const thresholds = hpThresholds(actor);
  if (!thresholds) return;
  const hp = foundry.utils.getProperty(changed, 'system.attributes.hp.value');
  if (typeof hp !== 'number') return;
  const cap = hpCapForStatus(thresholds, statusOf(actor as NPCPF2e));
  if (cap !== null && hp > cap) {
    foundry.utils.setProperty(changed, 'system.attributes.hp.value', cap);
    ui.notifications.info(
      game.i18n.format(`${MODULE_ID}.troopReduced.healCapped`, { name: actor.token?.name ?? actor.name, hp: cap }),
    );
  }
}

/** Guards against double application while the async effect fetch/create is in flight. */
const pendingApplications = new Set<string>();

function onUpdateActor(actor: ActorPF2e, changed: Record<string, unknown>, options: Record<string, unknown>, userId: string): void {
  if (userId !== game.user.id || isMirrorEcho(options)) return;
  if (foundry.utils.getProperty(changed, 'system.attributes.hp.value') === undefined) return;
  // A troop damaged through its world actor rather than on a scene — the kingdom
  // layer's path — crosses the same thresholds; the sync layer carries the effect
  // down to any segments it has deployed.
  const target = troopTarget(actor);
  const thresholds = hpThresholds(target);
  if (!target || !thresholds) return;

  const expected = segmentsForHp(thresholds, target.system.attributes.hp.value);
  // Reduction only ever worsens automatically; recovery is a downtime decision.
  if (expected >= statusOf(target)) return;

  const key = `${segmentContext(target)?.troopId ?? target.id}:${expected}`;
  if (pendingApplications.has(key)) return;
  pendingApplications.add(key);
  swapReducedEffect(target, expected)
    .then(() => announce(target, expected, thresholds))
    .catch((error) => console.error(`${MODULE_ID} | failed to apply Troop Reduced effect`, error))
    .finally(() => pendingApplications.delete(key));
}

/** Leaves exactly the effect for `status` on the actor (none at full strength). */
async function swapReducedEffect(actor: NPCPF2e, status: SegmentCount): Promise<void> {
  const keep = status === 4 ? null : REDUCED_EFFECT_SLUGS[status];
  // Fetched before anything is deleted, so a missing compendium leaves the actor as it was.
  const effect = keep && !actor.itemTypes.effect.some((e) => e.slug === keep) ? await reducedEffect(status as 2 | 3) : null;

  const stale = actor.itemTypes.effect.filter((e) => REDUCED_SLUGS.has(e.slug ?? '') && e.slug !== keep);
  if (stale.length > 0) await actor.deleteEmbeddedDocuments('Item', stale.map((e) => e.id));
  if (effect) await actor.createEmbeddedDocuments('Item', [effect.toObject()]);
}

async function reducedEffect(status: 2 | 3): Promise<ItemPF2e> {
  const uuid = `Compendium.${MODULE_ID}.troop-effects.Item.${REDUCED_EFFECT_IDS[status]}`;
  const effect = await fromUuid<ItemPF2e>(uuid);
  if (!effect) throw new Error(`${MODULE_ID} | missing effect ${uuid}`);
  return effect;
}

async function announce(actor: NPCPF2e, status: SegmentCount, thresholds: ThresholdEntry[], recovered = false): Promise<void> {
  const key = !recovered ? 'message' : status === 4 ? 'recoveredFull' : 'recovered';
  const ChatMessageImpl = CONFIG.ChatMessage.documentClass as unknown as { create(data: object): Promise<unknown> };
  await ChatMessageImpl.create({
    content: game.i18n.format(`${MODULE_ID}.troopReduced.${key}`, {
      name: actor.token?.name ?? actor.name,
      segments: status,
      hp: hpCapForStatus(thresholds, status) ?? 0,
    }),
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
  });
}

/** The troop's reduced status (4 = full strength), or null when the actor is not a troop. */
export function reducedStatus(actor: ActorPF2e | null | undefined): SegmentCount | null {
  const target = troopTarget(actor);
  return target ? statusOf(target) : null;
}

/**
 * Sets a troop's reduced status outright: swaps in the matching effect, moves HP into
 * the band the ladder reads as that many segments, and waits for every segment and the
 * world actor to follow. Resolves to the status set, or null when the actor is not a troop.
 */
export async function setReducedStatus(actor: ActorPF2e | null | undefined, status: SegmentCount): Promise<SegmentCount | null> {
  const target = troopTarget(actor);
  const thresholds = hpThresholds(target);
  if (!target || !thresholds) return null;
  const before = statusOf(target);

  // The effect converges before HP moves: the system propagates a segment's HP to its
  // siblings inside _preUpdate, and a sibling still holding the old effect would cap it.
  await swapReducedEffect(target, status);
  await reconciled();
  const hp = target.system.attributes.hp.value;
  const clamped = clampHpToStatus(thresholds, status, hp);
  if (clamped !== hp) await target.update({ 'system.attributes.hp.value': clamped });

  if (status !== before) await announce(target, status, thresholds, status > before);
  await reconciled();
  return status;
}

/** Climbs one rung (2 → 3, 3 → full). Resolves to the resulting status; 4 when there was nothing to recover. */
export async function recoverOneSegment(actor: ActorPF2e | null | undefined): Promise<SegmentCount | null> {
  const status = reducedStatus(actor);
  if (status === null || status === 4) return status;
  return setReducedStatus(actor, (status + 1) as SegmentCount);
}

export function registerThresholdAutomation(): void {
  Hooks.on('preUpdateActor', onPreUpdateActor);
  Hooks.on('updateActor', onUpdateActor);
}
