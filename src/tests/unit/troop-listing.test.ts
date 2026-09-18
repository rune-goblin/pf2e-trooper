import { describe, expect, it } from 'vitest';
import { troopListingsFrom, type TroopIndexEntry } from '@/troops/listing';

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
