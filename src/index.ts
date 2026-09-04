import './styles.css';
import type { ActorPF2e } from 'foundry-pf2e';
import { MODULE_ID } from './constants';
import { registerTroopHooks } from './troops';
import { recoverOneSegment, reducedStatus, setReducedStatus } from './troops/thresholds';
import type { SegmentCount } from './troops/logic';
import { officialTroopArt, officialTroopArtSlugs, type TroopArt } from './art/officialTroopArt';
import { registerTroopArt } from './art';
import { aiArtIgnored, registerSettings } from './settings';
import { ExampleApp } from './ui/ExampleApp';

interface ModuleApi {
  version: string;
  open: () => void;
  /** The art drawn for a published troop name, or null when none was. */
  troopArt: (name: string | null | undefined) => TroopArt | null;
  /** Every published-troop slug this module has art for. */
  troopArtSlugs: () => string[];
  /** A troop's reduced status (4 = full strength), or null for an actor that is not a troop. */
  reducedStatus: (actor: Actor | null | undefined) => SegmentCount | null;
  /**
   * Sets the status outright — the Troop Reduced effect, the HP band it implies, and every
   * segment and the world actor. Resolves once they have all followed.
   */
  setReducedStatus: (actor: Actor | null | undefined, status: SegmentCount) => Promise<SegmentCount | null>;
  /** Downtime recovery: one rung up (2 → 3, 3 → full). Resolves to the resulting status. */
  recoverOneSegment: (actor: Actor | null | undefined) => Promise<SegmentCount | null>;
}

export type { ModuleApi, SegmentCount };

// `init`, not `ready`: ReignMaker's clone door calls troopArt() synchronously, and Foundry does
// not await async hook callbacks — anything fetched in `ready` could still be in flight when a
// consumer's `ready` runs, and an unloaded lookup is indistinguishable from "no art".
Hooks.once('init', () => {
  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const api: ModuleApi = {
    version,
    open: () => ExampleApp.open(),
    // Read per call, not captured: a world that turns the art off mid-session must stop being
    // handed it, and consumers hold on to this object.
    troopArt: (name) => (aiArtIgnored() ? null : officialTroopArt(name)),
    troopArtSlugs: () => (aiArtIgnored() ? [] : officialTroopArtSlugs()),
    reducedStatus: (actor) => reducedStatus(actor as ActorPF2e | null),
    setReducedStatus: (actor, status) => setReducedStatus(actor as ActorPF2e | null, status),
    recoverOneSegment: (actor) => recoverOneSegment(actor as ActorPF2e | null),
  };
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: ModuleApi }).api = api;

  console.log(`${MODULE_ID} | init (v${version}, art for ${officialTroopArtSlugs().length} troops)`);
  // Before the registrations that read it — `registerTroopHooks` gates on troop movement.
  registerSettings();
  registerTroopHooks();
  registerTroopArt();
});
