// Give the e2e instance its OWN copy of a world.
//
// worlds/ used to be symlinked into test/foundry-data alongside systems/ and modules/,
// which meant both Foundry installs opened the same LevelDB files — and LevelDB takes an
// exclusive lock per directory. So e2e could only run with the desktop app closed, and a
// world left open there made the harness fail with "No active world at this port".
//
// A world is small (tens of MB) where systems/ and modules/ are gigabytes, so the world
// is the one thing worth copying. Two consequences beyond unblocking the run: the specs
// can no longer touch the real world's data, and the module-enabling flip on first run
// lands on the copy.
//
// Usage: node scripts/seed-test-world.ts <world-id> [--refresh]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFoundryData } from './foundry-paths.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DATA = join(REPO, 'test', 'foundry-data');

/** LevelDB's lock marker, copied along with everything else — stale in the copy. */
function dropStaleLocks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) dropStaleLocks(p);
    else if (entry.name === 'LOCK') unlinkSync(p);
  }
}

export function seedWorld(world: string, refresh = false): void {
  const foundryData = resolveFoundryData(REPO);
  const src = join(foundryData, 'worlds', world);
  const dest = join(TEST_DATA, 'Data', 'worlds', world);

  if (!existsSync(src)) {
    const available = existsSync(join(foundryData, 'worlds'))
      ? readdirSync(join(foundryData, 'worlds')).filter((n) =>
          statSync(join(foundryData, 'worlds', n)).isDirectory(),
        )
      : [];
    console.error(`❌ World "${world}" not found in ${join(foundryData, 'worlds')}`);
    if (available.length) console.error(`   Available: ${available.join(', ')}`);
    process.exit(1);
  }

  if (existsSync(dest) && !refresh) {
    console.log(`✅ world "${world}" already seeded — re-copy with: npm run test:e2e:seed -- ${world} --refresh`);
    return;
  }

  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  // A snapshot of a world that may be open elsewhere. Foundry writes in bursts, so this is
  // consistent in practice; --refresh again if a copy ever lands mid-write.
  cpSync(src, dest, { recursive: true });
  dropStaleLocks(dest);
  console.log(`📋 seeded world "${world}" → test/foundry-data/Data/worlds/${world} (independent copy)`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const world = args.find((a) => !a.startsWith('--'));
  if (!world) {
    console.error('Usage: node scripts/seed-test-world.ts <world-id> [--refresh]');
    process.exit(1);
  }
  seedWorld(world, args.includes('--refresh'));
}
