// Build test/foundry-data/ — an isolated Foundry data path for the Playwright e2e harness,
// so driving a headless Foundry never touches the user's normal install. Idempotent.
// Run with `npm run test:e2e:setup`.
//
// systems/ and modules/ are SYMLINKED from the real data dir (gigabytes; tests run against the
// same pf2e system and the live module scaffold, whose dist symlink → repo dist). worlds/ is NOT:
// each world is COPIED in, because LevelDB locks a database directory exclusively and sharing
// worlds/ meant e2e could only run with the desktop Foundry closed. See seed-test-world.ts.
// The license is copied; admin.txt is intentionally omitted so the instance has no admin
// password (the harness joins a world as a user, never /setup).
import {
  existsSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync, lstatSync, rmSync, symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { resolveFoundryData } from './foundry-paths.ts';
import { seedWorld } from './seed-test-world.ts';

const repo = process.cwd();
const TEST_DATA = join(repo, 'test', 'foundry-data');
const PORT = Number(process.env.TEST_FOUNDRY_PORT ?? 30005);

// Windows can't make plain dir symlinks without admin; junctions need no privilege.
const symlinkType = process.platform === 'win32' ? 'junction' : undefined;

function relink(target: string, linkPath: string): void {
  const st = lstatSync(linkPath, { throwIfNoEntry: false });
  if (st) {
    if (st.isDirectory() && !st.isSymbolicLink()) rmSync(linkPath, { recursive: true, force: true });
    else unlinkSync(linkPath);
  }
  symlinkSync(target, linkPath, symlinkType);
  console.log(`🔗 linked ${linkPath.replace(repo + '/', '')} → ${target}`);
}

const foundryData = resolveFoundryData(repo);
const configSource = join(dirname(foundryData), 'Config');

console.log(`📁 Data source:   ${foundryData}`);
console.log(`📁 Config source: ${configSource}\n`);

const configDir = join(TEST_DATA, 'Config');
const dataDir = join(TEST_DATA, 'Data');
mkdirSync(configDir, { recursive: true });
mkdirSync(join(dataDir, 'assets'), { recursive: true });
mkdirSync(join(TEST_DATA, 'Logs'), { recursive: true });

const licenseSrc = join(configSource, 'license.json');
if (existsSync(licenseSrc)) {
  copyFileSync(licenseSrc, join(configDir, 'license.json'));
  console.log('📋 copied license.json');
} else {
  console.warn(`⚠️  license.json not found at ${licenseSrc} — the test instance won't boot without it.`);
}
// A lingering admin.txt would reinstate an admin password we can't recover the plaintext for.
const adminTxt = join(configDir, 'admin.txt');
if (existsSync(adminTxt)) unlinkSync(adminTxt);

const options = {
  dataPath: `${TEST_DATA}/`,
  port: PORT,
  upnp: false,
  hostname: null,
  routePrefix: null,
  sslCert: null,
  sslKey: null,
  proxyPort: null,
  proxySSL: false,
  updateChannel: 'stable',
  language: 'en.core',
  world: null,
  telemetry: false,
};
writeFileSync(join(configDir, 'options.json'), `${JSON.stringify(options, null, 2)}\n`);
console.log(`✅ wrote Config/options.json (port ${PORT}, upnp off)`);

for (const name of ['systems', 'modules']) {
  relink(join(foundryData, name), join(dataDir, name));
}

// A real directory, never a link — the copies inside are what let the test instance run
// while the desktop app holds the original world open.
const worldsDir = join(dataDir, 'worlds');
const worldsStat = lstatSync(worldsDir, { throwIfNoEntry: false });
if (worldsStat?.isSymbolicLink()) unlinkSync(worldsDir);
mkdirSync(worldsDir, { recursive: true });

const testWorld = process.env.TEST_WORLD;
if (testWorld) seedWorld(testWorld);
else console.log('ℹ️  set TEST_WORLD to seed a world now (boot/e2e will seed it on demand anyway)');

console.log('\n✨ Test data path ready at test/foundry-data');
console.log('   Boot it with:  TEST_WORLD=<world> npm run test:foundry');
console.log('   Run e2e with:  TEST_WORLD=<world> npm run test:e2e');
console.log('   Worlds are independent copies — refresh one with: npm run test:e2e:seed -- <world> --refresh');
