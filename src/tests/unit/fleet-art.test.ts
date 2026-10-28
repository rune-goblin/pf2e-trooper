import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ART_DIR = join(ROOT, 'assets', 'fleets');

// pf2e-reignmaker bakes modules/pf2e-trooper/assets/fleets/<class>/<class>_<slot>.webp onto the
// vehicle actors it creates for fleets, keyed by its fleet class ids. Live worlds hold those paths.
const FLEET_CLASSES = ['skiffs', 'longboats', 'galleys', 'tall-ships'];
const SLOTS = ['portrait', 'token', 'strategy'];

describe('assets/fleets', () => {
  it('holds one folder per ReignMaker fleet class', () => {
    expect(existsSync(ART_DIR), 'assets/fleets is missing').toBe(true);
    const folders = readdirSync(ART_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual([...FLEET_CLASSES].sort());
  });

  it.each(FLEET_CLASSES)('ships portrait, token and strategy art for %s', (fleetClass) => {
    const files = readdirSync(join(ART_DIR, fleetClass)).sort();
    expect(files).toEqual(SLOTS.map((slot) => `${fleetClass}_${slot}.webp`).sort());
  });
});
