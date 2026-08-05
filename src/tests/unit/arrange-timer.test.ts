import { describe, expect, it } from 'vitest';
import {
  FADE_MS,
  INITIAL_MS,
  RESUME_MS,
  holdTimer,
  isHeld,
  releaseTimer,
  resetTimer,
  startTimer,
  timerAlpha,
} from '@/troops/arrange-timer';

/** Wall-clock at which the overlay is fully gone (alpha hits 0). */
const clearedAt = (timer: { deadline: number }) => timer.deadline + FADE_MS;

const pressed = (now: number) => holdTimer(startTimer(0), 'pointer', now);

describe('arrange timer', () => {
  it('opens for INITIAL_MS, then fades across FADE_MS', () => {
    const t = startTimer(0);
    expect(timerAlpha(t, INITIAL_MS - 1)).toBe(1);
    expect(timerAlpha(t, INITIAL_MS)).toBe(1);
    expect(timerAlpha(t, INITIAL_MS + FADE_MS / 2)).toBeCloseTo(0.5);
    expect(timerAlpha(t, INITIAL_MS + FADE_MS)).toBe(0);
  });

  it('holds at full opacity for as long as the pointer is down', () => {
    const t = pressed(1000);
    expect(timerAlpha(t, 1000)).toBe(1);
    expect(timerAlpha(t, 60_000)).toBe(1);
  });

  it('counts RESUME_MS from the release, not from the press', () => {
    const released = releaseTimer(pressed(1000), 'pointer', 50_000);
    expect(clearedAt(released)).toBe(50_000 + RESUME_MS + FADE_MS);
    expect(timerAlpha(released, 50_000 + RESUME_MS)).toBe(1);
    expect(timerAlpha(released, 50_000 + RESUME_MS + FADE_MS)).toBe(0);
  });

  // The reported bug: releasing starts the 3s countdown, then the drag's own update
  // lands a round-trip later and used to restart it — so the area outlived the drop by
  // the server latency on top of the full 3s.
  it("does not restart the countdown when the released drag's update lands", () => {
    const released = releaseTimer(pressed(1000), 'pointer', 2000);
    const dropped = resetTimer(released, 2800);
    expect(clearedAt(dropped)).toBe(2000 + RESUME_MS + FADE_MS);
    expect(timerAlpha(dropped, 2000 + RESUME_MS + FADE_MS)).toBe(0);
  });

  it('grants a fresh countdown for a move that no release preceded', () => {
    const t = resetTimer(startTimer(0), 1000);
    expect(clearedAt(t)).toBe(1000 + RESUME_MS + FADE_MS);
  });

  it('only swallows one update per release', () => {
    const released = releaseTimer(pressed(0), 'pointer', 1000);
    const laterMove = resetTimer(resetTimer(released, 1200), 3000);
    expect(clearedAt(laterMove)).toBe(3000 + RESUME_MS + FADE_MS);
  });

  // The drag that opens the area ends with a release too, but nothing was held —
  // it must not cut the opening INITIAL_MS down to RESUME_MS.
  it('ignores a release that lifts no hold', () => {
    const opened = startTimer(0);
    expect(releaseTimer(opened, 'pointer', 500)).toBe(opened);
    expect(clearedAt(releaseTimer(opened, 'pointer', 500))).toBe(INITIAL_MS + FADE_MS);
  });

  it('reasserting a hold every frame does not push the deadline out', () => {
    const held = holdTimer(startTimer(0), 'layout', 1000);
    expect(holdTimer(held, 'layout', 9999)).toBe(held);
    expect(clearedAt(releaseTimer(held, 'layout', 2000))).toBe(2000 + RESUME_MS + FADE_MS);
  });
});

describe('arrange timer holds', () => {
  it('an invalid layout keeps the area up indefinitely', () => {
    const broken = holdTimer(startTimer(0), 'layout', 100);
    expect(timerAlpha(broken, 500_000)).toBe(1);
  });

  // Releasing the drag that broke the formation must not start the fade — the whole
  // point of the layout hold is that the guidance outlasts the gesture.
  it('releasing the pointer while the layout is invalid does not start the fade', () => {
    const bothHeld = holdTimer(holdTimer(startTimer(0), 'layout', 100), 'pointer', 200);
    const released = releaseTimer(bothHeld, 'pointer', 300);
    expect(isHeld(released)).toBe(true);
    expect(timerAlpha(released, 500_000)).toBe(1);
  });

  it('starts the countdown once the layout is repaired, from the repair', () => {
    const bothHeld = holdTimer(holdTimer(startTimer(0), 'layout', 100), 'pointer', 200);
    const released = releaseTimer(bothHeld, 'pointer', 300);
    const repaired = releaseTimer(released, 'layout', 10_000);
    expect(isHeld(repaired)).toBe(false);
    expect(clearedAt(repaired)).toBe(10_000 + RESUME_MS + FADE_MS);
  });

  it('a layout that breaks again during the countdown re-holds the area', () => {
    const counting = releaseTimer(pressed(0), 'pointer', 1000);
    const brokeAgain = holdTimer(counting, 'layout', 1500);
    expect(timerAlpha(brokeAgain, 500_000)).toBe(1);
    expect(clearedAt(releaseTimer(brokeAgain, 'layout', 2000))).toBe(2000 + RESUME_MS + FADE_MS);
  });

  // A layout repair is not a drop, so it must not consume the releasing flag that
  // suppresses the drag's own update.
  it('repairing the layout does not arm the drop suppression', () => {
    const repaired = releaseTimer(holdTimer(startTimer(0), 'layout', 100), 'layout', 1000);
    expect(clearedAt(resetTimer(repaired, 1500))).toBe(1500 + RESUME_MS + FADE_MS);
  });
});
