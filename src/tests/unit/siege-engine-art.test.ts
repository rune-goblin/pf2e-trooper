import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ART_DIR = join(ROOT, 'assets', 'siege-engines');

// pf2e-reignmaker's siege-weapon pack builder bakes
// modules/pf2e-trooper/assets/siege-engines/<slug>.webp straight into its compendium — it never
// asks an api. This is the layout contract that build assumes.
describe('assets/siege-engines', () => {
  const entries = readdirSync(ART_DIR, { withFileTypes: true });

  it('ships art', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('is flat — every entry is a <slug>.webp file', () => {
    for (const entry of entries) {
      expect(entry.isFile(), `${entry.name} is not a file`).toBe(true);
      expect(entry.name, `${entry.name} is not a slug.webp`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.webp$/);
    }
  });
});
