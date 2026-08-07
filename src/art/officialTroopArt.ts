import { MODULE_ID } from '../constants';
import manifest from '../../assets/troops/official-art-manifest.json';

const ART_ROOT = `modules/${MODULE_ID}/assets/troops/official`;
const SLUGS: ReadonlySet<string> = new Set(manifest as string[]);

export interface TroopArt {
  /** Actor portrait. */
  portrait: string;
  /** Prototype-token texture — the piece used on tactical scenes. */
  token: string;
  /** Kingdom-map piece; ReignMaker stores this on its own creature flag. */
  strategy: string;
}

/**
 * The art folder is named for the published troop's name, lowercased with every run of
 * non-alphanumerics collapsed to a hyphen. Deliberately not PF2e's `sluggify`, which drops
 * apostrophes instead of breaking on them ("Hana's Hundreds" → `hanas-hundreds`, not
 * `hana-s-hundreds`); the art was generated with this rule and the folders encode it.
 */
export function officialTroopSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The art drawn for a published troop, or null when none was. */
export function officialTroopArt(name: string | null | undefined): TroopArt | null {
  if (!name) return null;
  const slug = officialTroopSlug(name);
  if (!SLUGS.has(slug)) return null;
  return {
    portrait: `${ART_ROOT}/${slug}/${slug}_portrait.webp`,
    token: `${ART_ROOT}/${slug}/${slug}_token.webp`,
    strategy: `${ART_ROOT}/${slug}/${slug}_strategy.webp`
  };
}

export function officialTroopArtSlugs(): string[] {
  return [...SLUGS];
}
