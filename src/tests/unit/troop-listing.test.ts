import { describe, expect, it } from 'vitest';
import { troopListingsFrom, troopsAcross, type PackToScan, type TroopIndexEntry } from '@/troops/listing';

const entry = (name: string, traits: string[], level = 5, title?: string): TroopIndexEntry => ({
  uuid: `Compendium.pf2e.test.Actor.${name}`,
  name,
  system: { traits: { value: traits }, details: { level: { value: level }, publication: { title } } },
});

describe('listing troops off an index', () => {
  it('keeps the troop-trait actors and drops the rest', () => {
    const listed = troopListingsFrom([entry('Bandit Gang', ['troop', 'human']), entry('Bandit', ['human'])], 'pf2e.test', 'Test');
    expect(listed.map((t) => t.name)).toEqual(['Bandit Gang']);
  });

  it('names the publication, and falls back to the pack when the actor states none', () => {
    const listed = troopListingsFrom(
      [entry('Bandit Gang', ['troop'], 5, 'Battlecry!'), entry('Home Guard', ['troop'])], 'pf2e.test', 'Test Pack');
    expect(listed.map((t) => t.source)).toEqual(['Battlecry!', 'Test Pack']);
  });

  it('carries the art for a published name and null for one without', () => {
    const [known, unknown] = troopListingsFrom([entry('Bandit Gang', ['troop']), entry('Home Guard', ['troop'])], null, 'World');
    expect(known.art?.token).toContain('bandit-gang_token.webp');
    expect(unknown.art).toBeNull();
    expect(known.pack).toBeNull();
  });

  it('lists no art when the lookup is turned off', () => {
    expect(troopListingsFrom([entry('Bandit Gang', ['troop'])], null, 'World', () => null)[0].art).toBeNull();
  });
});

describe('keeping the compendium scan', () => {
  const pack = (stamp: string | null, entries: TroopIndexEntry[], reads: string[]): PackToScan => ({
    collection: 'pf2e.test', label: 'Test', stamp,
    index: async () => { reads.push('pf2e.test'); return entries; },
  });

  it('reads a pack once per package version, and keeps an empty answer too', async () => {
    const reads: string[] = [];
    const first = await troopsAcross([pack('pf2e@7.0.0', [entry('Bandit', ['human'])], reads)], {});
    expect(first.cache['pf2e.test']).toEqual({ stamp: 'pf2e@7.0.0', troops: [] });
    await troopsAcross([pack('pf2e@7.0.0', [], reads)], first.cache);
    expect(reads).toHaveLength(1);
  });

  it('reads the pack again when its package moves to a new version', async () => {
    const reads: string[] = [];
    const first = await troopsAcross([pack('pf2e@7.0.0', [], reads)], {});
    const second = await troopsAcross([pack('pf2e@7.1.0', [entry('Bandit Gang', ['troop'])], reads)], first.cache);
    expect(second.troops.map((t) => t.name)).toEqual(['Bandit Gang']);
    expect(reads).toHaveLength(2);
  });

  it('never keeps a world pack, which can change at any time', async () => {
    const reads: string[] = [];
    const first = await troopsAcross([pack(null, [entry('Home Guard', ['troop'])], reads)], {});
    expect(first.cache).toEqual({});
    await troopsAcross([pack(null, [], reads)], first.cache);
    expect(reads).toHaveLength(2);
  });

  it('forgets a pack that is no longer installed', async () => {
    const kept = await troopsAcross([], { 'gone.pack': { stamp: 'gone@1.0.0', troops: [] } });
    expect(kept.cache).toEqual({});
  });

  it('lists the other packs when one cannot be read, and does not keep the failure', async () => {
    const broken: PackToScan = { collection: 'bad.pack', label: 'Bad', stamp: 'bad@1.0.0', index: async () => { throw new Error('locked'); } };
    const result = await troopsAcross([broken, pack('pf2e@7.0.0', [entry('Bandit Gang', ['troop'])], [])], {});
    expect(result.troops.map((t) => t.name)).toEqual(['Bandit Gang']);
    expect(result.cache['bad.pack']).toBeUndefined();
  });
});
