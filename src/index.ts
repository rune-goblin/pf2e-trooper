import './styles.css';
import { MODULE_ID } from './constants';
import { registerTroopHooks } from './troops';
import { ExampleApp } from './ui/ExampleApp';

interface ModuleApi {
  version: string;
  open: () => void;
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | init`);
  registerTroopHooks();
});

Hooks.once('ready', () => {
  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const api: ModuleApi = { version, open: () => ExampleApp.open() };
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: ModuleApi }).api = api;
  console.log(`${MODULE_ID} | ready (v${version})`);
});
