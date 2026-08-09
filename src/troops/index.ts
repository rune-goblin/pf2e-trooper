import { troopMovementEnabled } from '@/settings';
import { registerArrangeOverlay } from './arrange';
import { registerFormationControls } from './formation';
import { registerMovementHistorySuppression } from './movement-history';
import { registerSegmentSync } from './sync';
import { registerTargetDeduplication } from './targeting';
import { registerThresholdAutomation } from './thresholds';

export function registerTroopHooks(): void {
  registerSegmentSync();
  registerThresholdAutomation();
  // Ungated with sync: counting one troop as four targets doubles up saves and damage against a
  // shared pool, which is a wrong result rather than a preference about how the canvas behaves.
  registerTargetDeduplication();
  // Segment sync and the HP-threshold ladder are what a troop *is*; formation movement and its
  // advisory area are the opinionated part, and that is what the setting turns off.
  if (!troopMovementEnabled()) return;
  registerFormationControls();
  registerArrangeOverlay();
  registerMovementHistorySuppression();
}
