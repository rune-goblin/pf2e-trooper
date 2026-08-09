import type { ActorPF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { MODULE_ID, REIGNMAKER_ID } from '@/constants';
import { aiArtIgnored, dropArtMode, preferTrooperArt } from '@/settings';
import { dropArtFor, packArtFrom, togglePiece, type PackArt } from './dropArt';
import { strippedSiegeArt } from './siegeArt';

// Troop art on drop: a troop dropped on a map arrives on the system's blank npc.svg, and the
// art for it is already installed. Applying it is silent and unprompted — a modal on every drop
// would be worse than either default. Strategy art is the opt-in, through the world setting or
// the per-token HUD toggle; nothing here asks a question mid-drop.

/**
 * ReignMaker owns art on its kingdom map. Asked rather than guessed — and only when it's there,
 * so this module still works with no ReignMaker installed at all.
 */
function isReignmakerKingdomScene(sceneId: string | null | undefined): boolean {
  const api = game.modules.get(REIGNMAKER_ID)?.active
    ? ((game.modules.get(REIGNMAKER_ID) as { api?: { isKingdomScene?: (id: string) => boolean } })
        .api ?? null)
    : null;
  return !!sceneId && api?.isKingdomScene?.(sceneId) === true;
}

function actorContext(actor: ActorPF2e | null, img: string | null | undefined) {
  if (!actor) return null;
  return {
    name: actor.name,
    img,
    traits: [...(actor.system?.traits?.value ?? [])] as string[],
    hasReignmakerArmyMetadata: !!(actor.flags as Record<string, any>)?.[REIGNMAKER_ID]?.['army-metadata'],
  };
}

/**
 * The art a token pack's compendium-art mapping dressed this actor with before we saw it —
 * looked up by the actor's compendium source in both registries a pack can register through.
 * Null unless the world prefers trooper art: otherwise mapped art is a choice we honour.
 */
function mappedPackArt(worldActor: ActorPF2e | null): PackArt | null {
  if (!worldActor || !preferTrooperArt()) return null;
  const source = worldActor._stats?.compendiumSource;
  if (!source?.startsWith('Compendium.')) return null;
  return packArtFrom(
    game.compendiumArt?.get(source),
    game.pf2e?.system?.moduleArt?.map?.get(source as `Compendium.${string}.Actor.${string}`)
  );
}

function onPreCreateToken(doc: TokenDocumentPF2e, data: Record<string, unknown>): void {
  if (aiArtIgnored()) return;

  // The portrait belongs to the world actor. `doc.actor` on an unlinked token is the delta's
  // synthetic copy, and a write to that is discarded with the delta — which is exactly what
  // happened before this looked the base actor up by id.
  const worldActor = doc.actorId ? (game.actors.get(doc.actorId) ?? null) : null;

  const decision = dropArtFor({
    tokenSrc: (data.texture as { src?: string } | undefined)?.src ?? doc.texture?.src,
    actor: actorContext(doc.actor, worldActor?.img ?? doc.actor?.img),
    packArt: mappedPackArt(worldActor),
    isKingdomScene: isReignmakerKingdomScene(doc.parent?.id),
    mode: dropArtMode(),
  });
  if (!decision) return;

  doc.updateSource({ 'texture.src': decision.tokenSrc, ...decision.tokenReset });
  // Not part of the same updateSource — it's a different document — and deliberately not awaited:
  // this hook's return value gates the drop, and a portrait is not worth blocking it on.
  if (decision.actor && worldActor) {
    const prototypeReset = Object.fromEntries(
      Object.entries(decision.actor.prototypeReset).map(([k, v]) => [`prototypeToken.${k}`, v])
    );
    void worldActor.update({
      img: decision.actor.img,
      'prototypeToken.texture.src': decision.actor.prototypeSrc,
      ...prototypeReset,
    });
  }
}

// Siege-engine art is baked into the compendium at build time, so ignoring it means acting where
// troop art means abstaining: the world copy of an imported siege weapon gets stripped to the
// system default here, before the token even exists to inherit its prototype. The compendium
// itself stays as shipped, and actors imported before the setting went on keep what they have.
function onPreCreateActor(doc: ActorPF2e): void {
  if (!aiArtIgnored()) return;

  const source = doc._source as {
    img?: string;
    prototypeToken?: { texture?: { src?: string } };
    flags?: Record<string, Record<string, unknown>>;
  };
  const changes = strippedSiegeArt({
    img: source.img,
    prototypeSrc: source.prototypeToken?.texture?.src,
    siegeFlag: source.flags?.[MODULE_ID]?.['siege-weapon'] as
      | { strategyTokenImage?: unknown }
      | undefined,
  });
  if (changes) doc.updateSource(changes);
}

function onRenderTokenHUD(_hud: unknown, html: HTMLElement, data: { _id?: string }): void {
  if (aiArtIgnored()) return;

  const token = canvas.scene?.tokens.get(data._id ?? '');
  const swapped = togglePiece(token?.texture?.src);
  if (!token || !swapped) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-icon';
  button.dataset.action = 'pf2eTrooperSwapArt';
  button.innerHTML = '<i class="fa-solid fa-chess-rook"></i>';
  button.dataset.tooltip = game.i18n.localize(`${MODULE_ID}.dropArt.swap`);
  button.addEventListener('click', () => void token.update({ 'texture.src': swapped }));

  html.querySelector('.col.left')?.append(button);
}

export function registerTroopArt(): void {
  Hooks.on('preCreateActor', onPreCreateActor);
  Hooks.on('preCreateToken', onPreCreateToken);
  Hooks.on('renderTokenHUD', onRenderTokenHUD);
}
