import { MODULE_ID } from '../constants';

export const SIEGE_ART_ROOT = `modules/${MODULE_ID}/assets/siege-engines/`;
/** What the pack generator itself falls back to when a weapon has no webp. */
export const DEFAULT_VEHICLE_ICON = 'systems/pf2e/icons/default-icons/vehicle.svg';

export interface SiegeArtSource {
  img?: string | null;
  prototypeSrc?: string | null;
  /** The `siege-weapon` flag, absent on anything that isn't a copy of our compendium entries. */
  siegeFlag?: { strategyTokenImage?: unknown } | null;
}

/**
 * Update keys swapping our baked-in siege-engine art for the system default, or null to leave the
 * actor alone. Only flagged siege weapons are touched, and within one only the slots still
 * pointing into our tree: a path someone chose — even one of ours put on another slot by hand —
 * is that person's choice.
 */
export function strippedSiegeArt(source: SiegeArtSource): Record<string, string> | null {
  if (!source.siegeFlag) return null;

  const ours = (src: unknown): boolean => typeof src === 'string' && src.startsWith(SIEGE_ART_ROOT);
  const updates: Record<string, string> = {};
  if (ours(source.img)) updates.img = DEFAULT_VEHICLE_ICON;
  if (ours(source.prototypeSrc)) updates['prototypeToken.texture.src'] = DEFAULT_VEHICLE_ICON;
  if (ours(source.siegeFlag.strategyTokenImage)) {
    updates[`flags.${MODULE_ID}.siege-weapon.strategyTokenImage`] = DEFAULT_VEHICLE_ICON;
  }
  return Object.keys(updates).length ? updates : null;
}
