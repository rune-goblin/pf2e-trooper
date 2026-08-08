import { describe, expect, it } from 'vitest';
import { suppressHistory } from '@/troops/movement-history';

describe('troop movement history', () => {
  it('empties the history staged for a segment', () => {
    const changed = { x: 100, _movementHistory: [{ x: 0, y: 0 }] };
    expect(suppressHistory(changed, true)).toBe(true);
    expect(changed._movementHistory).toEqual([]);
  });

  it('leaves a token outside any troop alone', () => {
    const waypoints = [{ x: 0, y: 0 }];
    const changed = { x: 100, _movementHistory: waypoints };
    expect(suppressHistory(changed, false)).toBe(false);
    expect(changed._movementHistory).toBe(waypoints);
  });

  // Core stages the field only for moves it records, so an unrecorded move must not gain one:
  // an empty array in the payload is itself a write.
  it('adds nothing to an update that records no movement', () => {
    const changed: Record<string, unknown> = { x: 100 };
    expect(suppressHistory(changed, true)).toBe(false);
    expect('_movementHistory' in changed).toBe(false);
  });
});
