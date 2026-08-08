import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCE_DIR = join(ROOT, 'packs', '_source', 'siege-weapons');
const DATA_DIR = join(ROOT, 'data', 'siege-weapons');

interface SiegeDoc {
  name: string;
  img: string;
  prototypeToken: { texture: { src: string } };
  flags: Record<string, Record<string, { slug: string; strategyTokenImage: string }>>;
}

const docs = readdirSync(SOURCE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(SOURCE_DIR, f), 'utf8')) as SiegeDoc] as const);

describe('the generated siege-weapon pack source', () => {
  it('has one actor per weapon in data/siege-weapons', () => {
    expect(docs.length).toBe(readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).length);
  });

  it('stamps every actor with our own siege-weapon flag', () => {
    for (const [file, doc] of docs) {
      const flag = doc.flags['pf2e-trooper']?.['siege-weapon'];
      expect(flag, `${file} carries no pf2e-trooper siege-weapon flag`).toBeDefined();
      expect(flag.slug, file).toBe(file.replace(/\.json$/, ''));
    }
  });

  // ReignMaker recognizes a siege vehicle by this flag and reads strategyTokenImage off it, so
  // all three slots have to land on art that actually ships.
  it('points all three art slots at a file under assets/siege-engines', () => {
    for (const [file, doc] of docs) {
      const slots = [doc.img, doc.prototypeToken.texture.src, doc.flags['pf2e-trooper']['siege-weapon'].strategyTokenImage];
      for (const slot of slots) {
        expect(slot, file).toMatch(/^modules\/pf2e-trooper\/assets\/siege-engines\/[a-z0-9-]+\.webp$/);
        expect(existsSync(join(ROOT, slot.replace('modules/pf2e-trooper/', ''))), `${file}: ${slot}`).toBe(true);
      }
    }
  });
});
