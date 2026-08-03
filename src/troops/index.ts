import { registerArrangeOverlay } from './arrange';
import { registerFormationControls } from './formation';
import { registerSegmentSync } from './sync';
import { registerThresholdAutomation } from './thresholds';

export function registerTroopHooks(): void {
  registerSegmentSync();
  registerThresholdAutomation();
  registerFormationControls();
  registerArrangeOverlay();
}
