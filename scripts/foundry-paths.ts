// Locating the user's real Foundry install. Shared by the e2e harness scripts so
// setup and boot always resolve the same Data dir without re-prompting.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function readDevPaths(repo: string): { foundryData?: string } {
  const p = join(repo, '.dev-paths.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as { foundryData?: string };
  } catch {
    return {};
  }
}

/** The real Foundry Data dir (holds systems/, modules/, worlds/). Mirrors `npm run setup`'s detection. */
export function resolveFoundryData(repo: string): string {
  const candidates = [
    process.env.FOUNDRY_DATA,
    readDevPaths(repo).foundryData,
    join(homedir(), 'Library', 'Application Support', 'FoundryVTT-v14', 'Data'),
    join(homedir(), 'Library', 'Application Support', 'FoundryVTT', 'Data'),
    join(homedir(), 'FoundryVTT', 'Data'),
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('❌ Could not find a Foundry Data dir to mirror.');
    console.error('   Set FOUNDRY_DATA or run `npm run setup` to cache it in .dev-paths.json. Looked in:');
    for (const p of candidates) console.error(`     - ${p}`);
    process.exit(1);
  }
  return found;
}
