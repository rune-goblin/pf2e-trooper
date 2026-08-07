import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  officialTroopArt,
  officialTroopArtSlugs,
  officialTroopSlug
} from '@/art/officialTroopArt';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ART_DIR = join(ROOT, 'assets', 'troops', 'official');
const SLOTS = ['portrait', 'token', 'strategy'] as const;

describe('officialTroopSlug', () => {
  it('breaks on punctuation instead of dropping it', () => {
    expect(officialTroopSlug("Hana's Hundreds")).toBe('hana-s-hundreds');
    expect(officialTroopSlug('Bill-Band')).toBe('bill-band');
    expect(officialTroopSlug('Xulgath Dinosaur Cavalry')).toBe('xulgath-dinosaur-cavalry');
  });
});

describe('officialTroopArt', () => {
  it('resolves a published name to its three pieces', () => {
    expect(officialTroopArt('Bandit Gang')).toEqual({
      portrait: 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang_portrait.webp',
      token: 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang_token.webp',
      strategy: 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang_strategy.webp'
    });
  });

  it('is null for a name nothing was drawn for, and for no name', () => {
    expect(officialTroopArt('Not A Troop')).toBeNull();
    expect(officialTroopArt(undefined)).toBeNull();
    expect(officialTroopArt('')).toBeNull();
  });
});

// The bundled manifest is what the api answers from; the directory is what actually ships.
// They drift the moment someone adds art and skips `npm run build:art-manifest`.
describe('the bundled manifest', () => {
  const complete = readdirSync(ART_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => SLOTS.every((slot) => existsSync(join(ART_DIR, entry.name, `${entry.name}_${slot}.webp`))))
    .map((entry) => entry.name);

  it('lists exactly the folders that have all three slots', () => {
    expect(officialTroopArtSlugs().sort()).toEqual(complete.sort());
  });

  it('points every slot at a file that exists', () => {
    for (const slug of officialTroopArtSlugs()) {
      const art = officialTroopArt(slug)!;
      for (const slot of SLOTS) {
        const onDisk = join(ROOT, art[slot].replace('modules/pf2e-trooper/', ''));
        expect(existsSync(onDisk), `${slug} ${slot}: ${onDisk}`).toBe(true);
      }
    }
  });
});
