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
  /** Art for the world actor, absent when it already has some of its own. */
  actor?: {
    img: string;
    /** The prototype token always gets the tactical piece; the mode only chooses what's placed. */
    prototypeSrc: string;
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
  if (actor.hasReignmakerArmyMetadata) return null;
  if (!actor.traits?.includes('troop')) return null;

  const art = officialTroopArt(actor.name);
  if (!art) return null;

  // Our own pieces are replaceable, unlike art someone chose: once the first drop dresses the
  // actor, every later token arrives wearing the prototype's tactical piece, and the world's
  // drop-art setting would silently stop meaning anything.
  const ours: string[] = [art.portrait, art.token, art.strategy];
  if (hasOwnArt(context.tokenSrc) && !ours.includes(context.tokenSrc as string)) return null;

  return {
    tokenSrc: pieceFor(art, context.mode),
    ...(hasOwnArt(actor.img) ? {} : { actor: { img: art.portrait, prototypeSrc: art.token } })
  };
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
