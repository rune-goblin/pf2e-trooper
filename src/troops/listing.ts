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

// A compendium does not change under a session, so its troops are scanned once and every later
// call reads the answer. Keyed by the art switch: a world that turns the art off lists without it.
const scanned = new Map<boolean, Promise<TroopListing[]>>();

function compendiumTroops(art?: (name: string) => TroopArt | null): Promise<TroopListing[]> {
  const key = art === undefined;
  let scan = scanned.get(key);
  if (!scan) {
    const packs = game.packs.filter((p) => p.metadata.type === 'Actor');
    scan = Promise.all(packs.map(async (p) => {
      const index = await p.getIndex({ fields: TROOP_INDEX_FIELDS });
      return troopListingsFrom(index.contents as unknown as TroopIndexEntry[], p.collection, p.metadata.label, art);
    })).then((lists) => lists.flat());
    // A failed scan is asked again rather than remembered.
    scan.catch(() => scanned.delete(key));
    scanned.set(key, scan);
  }
  return scan;
}

/** Every troop the world can reach: its own actors, read fresh, then the compendium scan. */
export async function listTroops(art?: (name: string) => TroopArt | null): Promise<TroopListing[]> {
  const world = troopListingsFrom(
    game.actors.contents as unknown as (TroopIndexEntry & { folder?: { name?: string } | null })[],
    null,
    (entry) => (entry as { folder?: { name?: string } | null }).folder?.name ?? 'World',
    art,
  );
  return [...world, ...await compendiumTroops(art)];
}
