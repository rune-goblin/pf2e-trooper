import type { ActorPF2e, TokenDocumentPF2e } from 'foundry-pf2e';
import { MODULE_ID } from '@/constants';
import { dropArtFor, togglePiece, type DropArtMode } from './dropArt';

const DROP_ART_SETTING = 'dropArt';
const REIGNMAKER_ID = 'pf2e-reignmaker';

// Troop art on drop: a troop dropped on a map arrives on the system's blank npc.svg, and the
// art for it is already installed. Applying it is silent and unprompted — a modal on every drop
// would be worse than either default. Strategy art is the opt-in, through the world setting or
// the per-token HUD toggle; nothing here asks a question mid-drop.

function dropArtMode(): DropArtMode {
  return (game.settings.get(MODULE_ID, DROP_ART_SETTING) as DropArtMode) ?? 'tactical';
}

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

function onPreCreateToken(doc: TokenDocumentPF2e, data: Record<string, unknown>): void {
  // The portrait belongs to the world actor. `doc.actor` on an unlinked token is the delta's
  // synthetic copy, and a write to that is discarded with the delta — which is exactly what
  // happened before this looked the base actor up by id.
  const worldActor = doc.actorId ? (game.actors.get(doc.actorId) ?? null) : null;

  const decision = dropArtFor({
    tokenSrc: (data.texture as { src?: string } | undefined)?.src ?? doc.texture?.src,
    actor: actorContext(doc.actor, worldActor?.img ?? doc.actor?.img),
    isKingdomScene: isReignmakerKingdomScene(doc.parent?.id),
    mode: dropArtMode(),
  });
  if (!decision) return;

  doc.updateSource({ 'texture.src': decision.tokenSrc });
  // Not part of the same updateSource — it's a different document — and deliberately not awaited:
  // this hook's return value gates the drop, and a portrait is not worth blocking it on.
  if (decision.actor && worldActor) {
    void worldActor.update({
      img: decision.actor.img,
      'prototypeToken.texture.src': decision.actor.prototypeSrc,
    });
  }
}

function onRenderTokenHUD(_hud: unknown, html: HTMLElement, data: { _id?: string }): void {
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
  game.settings.register(MODULE_ID, DROP_ART_SETTING, {
    name: `${MODULE_ID}.settings.dropArt.name`,
    hint: `${MODULE_ID}.settings.dropArt.hint`,
    scope: 'world',
    config: true,
    type: String,
    choices: {
      tactical: `${MODULE_ID}.settings.dropArt.tactical`,
      strategy: `${MODULE_ID}.settings.dropArt.strategy`,
    },
    default: 'tactical',
  });

  Hooks.on('preCreateToken', onPreCreateToken);
  Hooks.on('renderTokenHUD', onRenderTokenHUD);
}
