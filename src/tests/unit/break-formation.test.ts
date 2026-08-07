import { describe, expect, it } from 'vitest';
import {
  NO_MODIFIER,
  isIndependent,
  pressPointer,
  releaseModifier,
  releasePointer,
} from '@/troops/break-formation';

const held = (state = NO_MODIFIER, now = false) => isIndependent(state, now);

describe('break-formation key', () => {
  it('leaves an unmodified drag to the formation', () => {
    expect(held(releasePointer(pressPointer(false)))).toBe(false);
  });

  it('marks a drag begun with the modifier held', () => {
    expect(held(releasePointer(pressPointer(true)))).toBe(true);
  });

  // The drop's update lands after the pointer is up and can outlive the key press.
  it('keeps the latch when the key goes up mid-drag', () => {
    const midDrag = releaseModifier(pressPointer(true));
    expect(held(releasePointer(midDrag))).toBe(true);
  });

  it('drops the latch when the key goes up with no button down', () => {
    const afterClick = releasePointer(pressPointer(true));
    expect(held(releaseModifier(afterClick))).toBe(false);
  });

  it('answers for keyboard nudges from the live key state alone', () => {
    expect(held(NO_MODIFIER, true)).toBe(true);
    expect(held(NO_MODIFIER, false)).toBe(false);
  });

  it('re-reads the key on every gesture', () => {
    const modified = releasePointer(pressPointer(true));
    expect(held(releasePointer(pressPointer(false)))).toBe(false);
    expect(held(modified)).toBe(true);
  });
});
