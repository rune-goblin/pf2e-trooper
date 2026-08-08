import { MODULE_ID, REIGNMAKER_ID } from './constants';
import type { DropArtMode } from './art/dropArt';

export const TROOP_MOVEMENT_SETTING = 'troopMovement';
export const STRATEGY_TOKENS_SETTING = 'useStrategyTokens';
export const PREFER_TROOPER_ART_SETTING = 'preferTrooperArt';

/**
 * Strategy art is ReignMaker's when ReignMaker is there: it assigns troop art itself and coerces
 * it on its kingdom map, so honouring this setting too would mean two modules writing the same
 * token. The stored choice is kept, not overwritten — uninstall ReignMaker and it means something
 * again.
 */
export const dropArtModeFor = (useStrategy: boolean, reignmaker: boolean): DropArtMode =>
  useStrategy && !reignmaker ? 'strategy' : 'tactical';

export const reignmakerActive = (): boolean => game.modules.get(REIGNMAKER_ID)?.active === true;

export const troopMovementEnabled = (): boolean =>
  game.settings.get(MODULE_ID, TROOP_MOVEMENT_SETTING) === true;

export const preferTrooperArt = (): boolean =>
  game.settings.get(MODULE_ID, PREFER_TROOPER_ART_SETTING) === true;

export const dropArtMode = (): DropArtMode =>
  dropArtModeFor(
    game.settings.get(MODULE_ID, STRATEGY_TOKENS_SETTING) === true,
    reignmakerActive()
  );

function lockStrategyTokens(_app: unknown, html: HTMLElement): void {
  if (!reignmakerActive()) return;
  const input = html.querySelector<HTMLInputElement>(
    `input[name="${MODULE_ID}.${STRATEGY_TOKENS_SETTING}"]`
  );
  if (!input) return;

  input.disabled = true;
  // The effective value, not the stored one. A disabled control is left out of the submitted
  // form data, so showing it unchecked doesn't write over the world's choice.
  input.checked = false;

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = game.i18n.localize(
    `${MODULE_ID}.settings.useStrategyTokens.reignmakerLocked`
  );
  input.closest('.form-group')?.append(note);
}

export function registerSettings(): void {
  game.settings.register(MODULE_ID, TROOP_MOVEMENT_SETTING, {
    name: `${MODULE_ID}.settings.troopMovement.name`,
    hint: `${MODULE_ID}.settings.troopMovement.hint`,
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    // The hooks it gates are attached once at init; there is no half-attached state to fall into.
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, STRATEGY_TOKENS_SETTING, {
    name: `${MODULE_ID}.settings.useStrategyTokens.name`,
    hint: `${MODULE_ID}.settings.useStrategyTokens.hint`,
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, PREFER_TROOPER_ART_SETTING, {
    name: `${MODULE_ID}.settings.preferTrooperArt.name`,
    hint: `${MODULE_ID}.settings.preferTrooperArt.hint`,
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  Hooks.on('renderSettingsConfig', lockStrategyTokens);
}
