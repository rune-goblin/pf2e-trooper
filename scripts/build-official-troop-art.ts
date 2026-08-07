// Regenerates assets/troops/official-art-manifest.json from the art present in
// assets/troops/official/. Run after adding or removing official troop art.
//
// A folder only ships if it has all three slots — a partial set would resolve to a 404 on one
// of them. The "does a published troop of this name exist?" cross-check that lived in
// ReignMaker's version did NOT come along: troop definitions are ReignMaker's, art is ours,
// and Trooper must build standalone.
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART_DIR = join(ROOT, 'assets', 'troops', 'official');
const OUT = join(ROOT, 'assets', 'troops', 'official-art-manifest.json');
const SLOTS = ['portrait', 'token', 'strategy'];

const slugs: string[] = [];
const skipped: string[] = [];

for (const entry of readdirSync(ART_DIR, { withFileTypes: true }).sort((a, b) =>
  a.name.localeCompare(b.name)
)) {
  if (!entry.isDirectory()) continue;
  const missing = SLOTS.filter(
    (slot) => !existsSync(join(ART_DIR, entry.name, `${entry.name}_${slot}.webp`))
  );
  if (missing.length > 0) skipped.push(`${entry.name}: missing ${missing.join(', ')}`);
  else slugs.push(entry.name);
}

writeFileSync(OUT, `${JSON.stringify(slugs, null, 2)}\n`);

console.log(`[TrooperArt] ${slugs.length} official troops have art -> ${OUT.slice(ROOT.length)}`);
for (const line of skipped) console.warn(`[TrooperArt] skipped ${line}`);
