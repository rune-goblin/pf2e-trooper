import './styles.css';
import { MODULE_ID } from './constants';
import { registerTroopHooks } from './troops';
import { officialTroopArt, officialTroopArtSlugs, type TroopArt } from './art/officialTroopArt';
import { registerTroopArt } from './art';
import { registerSettings } from './settings';
import { ExampleApp } from './ui/ExampleApp';

interface ModuleApi {
  version: string;
  open: () => void;
  /** The art drawn for a published troop name, or null when none was. */
  troopArt: (name: string | null | undefined) => TroopArt | null;
  /** Every published-troop slug this module has art for. */
  troopArtSlugs: () => string[];
}

// `init`, not `ready`: ReignMaker's clone door calls troopArt() synchronously, and Foundry does
// not await async hook callbacks — anything fetched in `ready` could still be in flight when a
// consumer's `ready` runs, and an unloaded lookup is indistinguishable from "no art".
Hooks.once('init', () => {
  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const api: ModuleApi = {
    version,
    open: () => ExampleApp.open(),
    troopArt: officialTroopArt,
    troopArtSlugs: officialTroopArtSlugs
  };
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: ModuleApi }).api = api;

  console.log(`${MODULE_ID} | init (v${version}, art for ${officialTroopArtSlugs().length} troops)`);
  // Before the registrations that read it — `registerTroopHooks` gates on troop movement.
  registerSettings();
  registerTroopHooks();
  registerTroopArt();
});
