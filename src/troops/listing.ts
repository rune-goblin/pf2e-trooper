import { MODULE_ID } from '../constants';
import { officialTroopArt, type TroopArt } from '../art/officialTroopArt';

/** One troop a consumer can offer: enough to list, sort, and filter it without loading the actor. */
export interface TroopListing {
  /** Resolves through `fromUuid` to the full actor, in a compendium or in the world. */
  uuid: string;
  name: string;
  level: number;
  /** The book that published it, or the world folder that holds it. */
  source: string;
  /** The compendium collection it came from; null for a world actor. */
  pack: string | null;
  art: TroopArt | null;
}

/** What the listing reads, whether it comes off a compendium index row or a world actor. */
export interface TroopIndexEntry {
  uuid: string;
  name?: string;
  system?: {
    traits?: { value?: string[] | null } | null;
    details?: { level?: { value?: number | null } | null; publication?: { title?: string | null } | null } | null;
  } | null;
}

export const TROOP_INDEX_FIELDS = ['system.traits.value', 'system.details.level.value', 'system.details.publication.title'];

/** `art` is handed in so a world that turned the generated art off lists troops without it. */
export function troopListingsFrom(
  entries: Iterable<TroopIndexEntry>,
  pack: string | null,
  fallbackSource: string | ((entry: TroopIndexEntry) => string),
  art: (name: string) => TroopArt | null = officialTroopArt,
): TroopListing[] {
  const out: TroopListing[] = [];
  for (const entry of entries) {
    if (!entry.name || !entry.system?.traits?.value?.includes('troop')) continue;
    const fallback = typeof fallbackSource === 'string' ? fallbackSource : fallbackSource(entry);
    out.push({
      uuid: entry.uuid,
      name: entry.name,
      level: entry.system.details?.level?.value ?? 0,
      source: entry.system.details?.publication?.title || fallback,
      pack,
      art: art(entry.name),
    });
  }
  return out;
}

/** A listing as the cache keeps it. Art is left out: it follows a world setting and this
 * module's own manifest, so it is worked out on every read. */
export type CachedTroop = Omit<TroopListing, 'art'>;
export interface CachedPack { stamp: string; troops: CachedTroop[] }
export type TroopCache = Record<string, CachedPack>;

export interface PackToScan {
  collection: string;
  label: string;
  /** The shipping package and its version, or null for a pack that can change at any time. */
  stamp: string | null;
  index: () => Promise<Iterable<TroopIndexEntry>>;
}

/**
 * The troops in every pack, reading a pack's index only when the cache has no answer for the
 * version that ships it. A released pack changes only with its package, so its answer holds
 * across sessions — an empty one included, which is most packs. Returns the cache to keep.
 */
export async function troopsAcross(packs: PackToScan[], cache: TroopCache): Promise<{ troops: CachedTroop[]; cache: TroopCache }> {
  const next: TroopCache = {};
  const lists = await Promise.all(packs.map(async (pack) => {
    const kept = pack.stamp !== null ? cache[pack.collection] : undefined;
    if (kept && kept.stamp === pack.stamp) {
      next[pack.collection] = kept;
      return kept.troops;
    }
    let entries: Iterable<TroopIndexEntry>;
    try {
      entries = await pack.index();
    } catch (error) {
      // One unreadable pack costs its own troops, and is asked again next session.
      console.warn(`${MODULE_ID} | could not index ${pack.collection}`, error);
      return [];
    }
    const troops = troopListingsFrom(entries, pack.collection, pack.label, () => null)
      .map(({ art: _art, ...troop }) => troop);
    if (pack.stamp !== null) next[pack.collection] = { stamp: pack.stamp, troops };
    return troops;
  }));
  return { troops: lists.flat(), cache: next };
}

const CACHE_KEY = `${MODULE_ID}.troop-index.v1`;

function readCache(): TroopCache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as TroopCache;
  } catch {
    return {};
  }
}

function stampOf(metadata: { packageType: string; packageName: string }): string | null {
  if (metadata.packageType === 'world') return null;
  const version = metadata.packageType === 'system' ? game.system.version : game.modules.get(metadata.packageName)?.version;
  return version ? `${metadata.packageName}@${version}` : null;
}

let scan: Promise<CachedTroop[]> | null = null;

function compendiumTroops(): Promise<CachedTroop[]> {
  scan ??= (async () => {
    const packs = game.packs.filter((p) => p.metadata.type === 'Actor').map((p): PackToScan => ({
      collection: p.collection,
      label: p.metadata.label,
      stamp: stampOf(p.metadata),
      index: async () => (await p.getIndex({ fields: TROOP_INDEX_FIELDS })).contents as unknown as TroopIndexEntry[],
    }));
    const { troops, cache } = await troopsAcross(packs, readCache());
    // Private browsing and a full quota both throw; the list is still good for this session.
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* kept in memory only */ }
    return troops;
  })();
  // A failed scan is asked again rather than remembered.
  scan.catch(() => { scan = null; });
  return scan;
}

/** Every troop the world can reach: its own actors, read fresh, then the compendia. */
export async function listTroops(art: (name: string) => TroopArt | null = officialTroopArt): Promise<TroopListing[]> {
  const world = troopListingsFrom(
    game.actors.contents as unknown as (TroopIndexEntry & { folder?: { name?: string } | null })[],
    null,
    (entry) => (entry as { folder?: { name?: string } | null }).folder?.name ?? 'World',
    art,
  );
  return [...world, ...(await compendiumTroops()).map((troop) => ({ ...troop, art: art(troop.name) }))];
}
