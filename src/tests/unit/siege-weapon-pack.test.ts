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
  items: { name: string; system: { description: { value: string } } }[];
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

  // AoN breaks some measurements as "10- foot burst"; a shape left as prose is an area attack
  // with no template to drop, which reads as a single-target weapon on the sheet.
  it('turns every area measurement into a @Template', () => {
    const shape = /(\d+)-\s*foot\s+(burst|cone|emanation|line|radius)s?\b/gi;
    for (const [file, doc] of docs) {
      for (const item of doc.items ?? []) {
        // A plural template keeps the prose as its label, so drop whole enrichers first.
        const prose = item.system.description.value.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, '');
        const leftovers = [...prose.matchAll(shape)];
        expect(leftovers.map((m) => m[0]), `${file} / ${item.name}`).toEqual([]);
      }
    }
  });

  // Without the option the save rolls as a plain check: no area-damage roll option, so
  // resistances and abilities keyed to area damage never see it.
  it('flags the save on every templated action as an area effect', () => {
    for (const [file, doc] of docs) {
      for (const item of doc.items ?? []) {
        const value = item.system.description.value;
        if (!value.includes('@Template[')) continue;
        const saves = (value.match(/@Check\[[^\]]*\]/g) ?? []).filter((c) =>
          /\b(reflex|fortitude|will)\b/.test(c),
        );
        for (const save of saves) {
          expect(save, `${file} / ${item.name}`).toContain('options:area-effect');
        }
      }
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
