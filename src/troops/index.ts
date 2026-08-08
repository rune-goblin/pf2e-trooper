import { troopMovementEnabled } from '@/settings';
import { registerArrangeOverlay } from './arrange';
import { registerFormationControls } from './formation';
import { registerMovementHistorySuppression } from './movement-history';
import { registerSegmentSync } from './sync';
import { registerThresholdAutomation } from './thresholds';

export function registerTroopHooks(): void {
  registerSegmentSync();
  registerThresholdAutomation();
  // Segment sync and the HP-threshold ladder are what a troop *is*; formation movement and its
  // advisory area are the opinionated part, and that is what the setting turns off.
  if (!troopMovementEnabled()) return;
  registerFormationControls();
  registerArrangeOverlay();
  registerMovementHistorySuppression();
}
