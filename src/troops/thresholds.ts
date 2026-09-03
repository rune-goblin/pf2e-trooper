import type { ActorPF2e, ItemPF2e, NPCPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { hpThresholds, segmentContext } from './context';
import {
  REDUCED_EFFECT_SLUGS,
  type SegmentCount,
  type ThresholdEntry,
  hpCapForStatus,
  segmentsForHp,
  statusFromSlugs,
} from './logic';
import { isMirrorEcho } from './sync';

// Troop Reduced automation: crossing an HP threshold downward applies a persistent
// effect ("Troop Reduced — 3/2 Segments") to every segment, and while it's present
// healing is capped at the threshold — the unit's new effective maximum until it
// recovers (remove the effect after downtime recovery).
//
// The effects deliberately carry no max-HP rule element: the system recomputes the
// threshold ladder from *modified* max HP, so reducing max would shift the ladder
// and corrupt both segment counts and this cap. Capping hp.value is the stable form.

export const REDUCED_EFFECT_IDS: Record<2 | 3, string> = {
  3: 'pmtTroopReduced3',
  2: 'pmtTroopReduced2',
};

function reducedStatus(actor: NPCPF2e): SegmentCount {
  return statusFromSlugs(actor.itemTypes.effect.map((e) => e.slug ?? ''));
}

function onPreUpdateActor(actor: ActorPF2e, changed: Record<string, unknown>): void {
  const thresholds = hpThresholds(actor);
  if (!thresholds) return;
  const hp = foundry.utils.getProperty(changed, 'system.attributes.hp.value');
  if (typeof hp !== 'number') return;
  const cap = hpCapForStatus(thresholds, reducedStatus(actor as NPCPF2e));
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
  const thresholds = hpThresholds(actor);
  if (!thresholds) return;
  // A troop damaged through its world actor rather than on a scene — the kingdom
  // layer's path — crosses the same thresholds; the sync layer carries the effect
  // down to any segments it has deployed.
  const ctx = segmentContext(actor);
  const target = ctx?.actor ?? (actor.isOfType('npc') ? (actor as NPCPF2e) : null);
  if (!target) return;

  const expected = segmentsForHp(thresholds, target.system.attributes.hp.value);
  // Reduction only ever worsens automatically; recovery is a manual downtime decision.
  if (expected >= reducedStatus(target)) return;

  const key = `${ctx?.troopId ?? target.id}:${expected}`;
  if (pendingApplications.has(key)) return;
  pendingApplications.add(key);
  applyReducedStatus(target, expected as 2 | 3, thresholds)
    .catch((error) => console.error(`${MODULE_ID} | failed to apply Troop Reduced effect`, error))
    .finally(() => pendingApplications.delete(key));
}

/** Applies to one actor only — the sync layer mirrors both the delete and the create to its peers. */
async function applyReducedStatus(actor: NPCPF2e, status: 2 | 3, thresholds: ThresholdEntry[]): Promise<void> {
  const uuid = `Compendium.${MODULE_ID}.troop-effects.Item.${REDUCED_EFFECT_IDS[status]}`;
  const effect = await fromUuid<ItemPF2e>(uuid);
  if (!effect) {
    console.error(`${MODULE_ID} | missing effect ${uuid}`);
    return;
  }

  const newSlug = REDUCED_EFFECT_SLUGS[status];
  const stale = actor.itemTypes.effect.filter((e) => {
    const slug = e.slug ?? '';
    return slug !== newSlug && (slug === REDUCED_EFFECT_SLUGS[2] || slug === REDUCED_EFFECT_SLUGS[3]);
  });
  if (stale.length > 0) await actor.deleteEmbeddedDocuments('Item', stale.map((e) => e.id));
  if (actor.itemTypes.effect.some((e) => e.slug === newSlug)) return;
  await actor.createEmbeddedDocuments('Item', [effect.toObject()]);

  const cap = hpCapForStatus(thresholds, status);
  const ChatMessageImpl = CONFIG.ChatMessage.documentClass as unknown as { create(data: object): Promise<unknown> };
  await ChatMessageImpl.create({
    content: game.i18n.format(`${MODULE_ID}.troopReduced.message`, {
      name: actor.token?.name ?? actor.name,
      segments: status,
      hp: cap ?? 0,
    }),
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
  });
}

export function registerThresholdAutomation(): void {
  Hooks.on('preUpdateActor', onPreUpdateActor);
  Hooks.on('updateActor', onUpdateActor);
}
