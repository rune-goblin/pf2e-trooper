import { officialTroopArt, type TroopArt } from './officialTroopArt';

export type DropArtMode = 'tactical' | 'strategy';

/**
 * "This document was never given a picture." Two of them, because a compendium actor picks up
 * BOTH: the system's default-icon on `img`, and Foundry's core `CONST.DEFAULT_TOKEN` on
 * `prototypeToken.texture.src`, filled in at document initialization.
 */
const PLACEHOLDER_ART = /^(icons\/svg\/mystery-man\.svg$|systems\/[^/]+\/icons\/default-icons\/)/;

export const hasOwnArt = (src: unknown): boolean =>
  typeof src === 'string' && src !== '' && !PLACEHOLDER_ART.test(src);

export interface DropContext {
  /** The dropped token's texture, as the create data carries it. */
  tokenSrc?: string | null;
  /**
   * What a compendium-art mapping (a token pack) put on the actor. Filled only when the world
   * prefers trooper art — present, its paths count as undressed rather than as a choice.
   */
  packArt?: PackArt | null;
  /** The actor behind the token. */
  actor?: {
    name?: string | null;
    img?: string | null;
    traits?: readonly string[];
    /** ReignMaker stamps its army metadata here; its clone door already dressed the actor. */
    hasReignmakerArmyMetadata?: boolean;
  } | null;
  /** True when ReignMaker says this is its kingdom map. */
  isKingdomScene?: boolean;
  mode: DropArtMode;
}

export interface DropArtDecision {
  /** Texture to put on the placed token. */
  tokenSrc: string;
  /** Ring off plus any pack-mapping undo (scale, ring subject) for the placed token. */
  tokenReset: Record<string, unknown>;
  /** Art for the world actor, absent when it already has some of its own. */
  actor?: {
    img: string;
    /** The prototype token always gets the tactical piece; the mode only chooses what's placed. */
    prototypeSrc: string;
    /** Same reset for the prototype token, keys relative to `prototypeToken`. */
    prototypeReset: Record<string, unknown>;
  };
}

/**
 * What to dress a freshly dropped troop token with, or null to leave it alone.
 *
 * Only undressed troops are touched: a token whose texture someone chose is that person's
 * choice, and a troop ReignMaker recruited already carries art from its clone door. On the
 * kingdom map ReignMaker owns the art outright, so we skip the scene entirely — its own
 * coercion would win anyway, and this avoids both modules writing the same token.
 */
export function dropArtFor(context: DropContext): DropArtDecision | null {
  const { actor } = context;
  if (!actor) return null;
  if (context.isKingdomScene) return null;

  const packSrcs = context.packArt?.srcs ?? [];
  const packDressed =
    packSrcs.includes(context.tokenSrc as string) || packSrcs.includes(actor.img as string);

  // A ReignMaker army wears what RM's clone door decided — except when that decision was to
  // keep token-pack art the actor arrived in: the world preferring trooper art outranks a pack
  // on tactical scenes, RM or no RM.
  if (actor.hasReignmakerArmyMetadata && !packDressed) return null;
  if (!actor.traits?.includes('troop')) return null;

  const art = officialTroopArt(actor.name);
  if (!art) return null;

  const dressed = (src: string | null | undefined): boolean =>
    hasOwnArt(src) && !packSrcs.includes(src as string);

  // Our own pieces are replaceable, unlike art someone chose: once the first drop dresses the
  // actor, every later token arrives wearing the prototype's tactical piece, and the world's
  // drop-art setting would silently stop meaning anything.
  const ours: string[] = [art.portrait, art.token, art.strategy];
  if (dressed(context.tokenSrc) && !ours.includes(context.tokenSrc as string)) return null;
  // Trooper pieces are full-token art, not ring subjects: whenever one goes on, the dynamic
  // token ring goes off, whether a pack mapping or a world default turned it on.
  const reset: Record<string, unknown> = {
    'ring.enabled': false,
    ...(packDressed ? context.packArt?.tokenReset : {})
  };

  return {
    tokenSrc: pieceFor(art, context.mode),
    tokenReset: reset,
    ...(dressed(actor.img)
      ? {}
      : { actor: { img: art.portrait, prototypeSrc: art.token, prototypeReset: reset } })
  };
}

interface CoreArtInfo {
  actor?: unknown;
  img?: unknown;
  token?: unknown;
}

interface Pf2eArtPartial {
  img?: unknown;
  prototypeToken?: {
    flags?: unknown;
    texture?: { src?: unknown; scaleX?: unknown; scaleY?: unknown };
  };
}

export interface PackArt {
  /** Every art path the mapping put on the actor or its prototype token. */
  srcs: string[];
  /**
   * Update keys undoing what the mapping merged into the token beyond the texture path —
   * left in place they'd keep rendering the pack's look (its ring subject, its scale) around
   * trooper art. Keys are relative to the token document.
   */
  tokenReset: Record<string, unknown>;
}

/**
 * What a compendium-art mapping put on an actor's source. Two registries feed it: Foundry
 * core's `compendiumArtMappings` (the Paizo token packs) and pf2e's own `pf2e-art` flag.
 */
export function packArtFrom(
  core: CoreArtInfo | undefined,
  pf2e: Pf2eArtPartial | undefined
): PackArt {
  const coreToken =
    typeof core?.token === 'object' && core.token !== null
      ? (core.token as { texture?: { src?: unknown; scaleX?: unknown; scaleY?: unknown }; ring?: unknown })
      : undefined;
  const candidates = [
    core?.actor,
    core?.img,
    typeof core?.token === 'string' ? core.token : coreToken?.texture?.src,
    pf2e?.img,
    pf2e?.prototypeToken?.texture?.src
  ];
  const srcs = [...new Set(candidates.filter((s): s is string => typeof s === 'string' && s !== ''))];

  const pf2eTexture = pf2e?.prototypeToken?.texture;
  const tokenReset: Record<string, unknown> = {};
  if ([coreToken?.texture?.scaleX, coreToken?.texture?.scaleY, pf2eTexture?.scaleX, pf2eTexture?.scaleY]
      .some((s) => s !== undefined)) {
    tokenReset['texture.scaleX'] = 1;
    tokenReset['texture.scaleY'] = 1;
  }
  if (coreToken?.ring !== undefined) {
    tokenReset['ring.enabled'] = false;
    tokenReset['ring.subject.texture'] = null;
    tokenReset['ring.subject.scale'] = 1;
  }
  // pf2e's registry pins `flags.pf2e.autoscale: false` alongside a scale; deleting it restores
  // whatever the world's autoscale setting says.
  if (pf2e?.prototypeToken?.flags !== undefined) tokenReset['flags.pf2e.-=autoscale'] = null;

  return { srcs, tokenReset };
}

export const pieceFor = (art: TroopArt, mode: DropArtMode): string =>
  mode === 'strategy' ? art.strategy : art.token;

const SUFFIXES: Record<DropArtMode, string> = { tactical: '_token.webp', strategy: '_strategy.webp' };

/**
 * The other piece of a pair, derived from the path rather than looked up: the token on the canvas
 * may be a troop we have no manifest entry for (renamed, homebrewed off one of ours), and the
 * pairing is the file naming, not the name.
 */
export function togglePiece(src: string | null | undefined): string | null {
  if (typeof src !== 'string') return null;
  if (src.endsWith(SUFFIXES.tactical)) return src.slice(0, -SUFFIXES.tactical.length) + SUFFIXES.strategy;
  if (src.endsWith(SUFFIXES.strategy)) return src.slice(0, -SUFFIXES.strategy.length) + SUFFIXES.tactical;
  return null;
}
