// The countdown governing how long the advisory area stays on screen. Pure and
// clock-injected so the state machine is unit-testable on its own; arrange.ts owns
// the PIXI side and feeds it Date.now().
//
// The gesture it models: a move opens the area for INITIAL_MS (long enough for the
// drop animation to finish). Two independent conditions can hold the countdown —
// a pointer pressed on a segment ('pointer'), and a troop layout that isn't a legal
// resting state ('layout'). The area only fades once every hold has lifted, so
// releasing a drag that left the troop detached keeps the guidance on screen.

export const INITIAL_MS = 5000;
export const RESUME_MS = 3000;
export const FADE_MS = 500;

export type HoldReason = 'pointer' | 'layout';

export interface ArrangeTimer {
  /** Timestamp at which the area starts fading. Meaningless while any hold is active. */
  deadline: number;
  holds: readonly HoldReason[];
  /**
   * Set from the pointer release until that drag's own update lands. The release
   * already started the countdown, so the update it causes must not restart it —
   * otherwise the area outlives the drop by however long the server round-trip took.
   */
  releasing: boolean;
}

export function startTimer(now: number): ArrangeTimer {
  return { deadline: now + INITIAL_MS, holds: [], releasing: false };
}

export function isHeld(timer: ArrangeTimer): boolean {
  return timer.holds.length > 0;
}

/** Idempotent — onTick reasserts the layout hold every frame. */
export function holdTimer(timer: ArrangeTimer, reason: HoldReason, now: number): ArrangeTimer {
  if (timer.holds.includes(reason)) return timer;
  return { deadline: now + RESUME_MS, holds: [...timer.holds, reason], releasing: false };
}

/** Lifting the last hold starts the countdown; lifting one of several changes nothing. */
export function releaseTimer(timer: ArrangeTimer, reason: HoldReason, now: number): ArrangeTimer {
  if (!timer.holds.includes(reason)) return timer;
  const holds = timer.holds.filter((h) => h !== reason);
  if (holds.length > 0) return { ...timer, holds };
  return { deadline: now + RESUME_MS, holds, releasing: reason === 'pointer' };
}

/** A segment landed inside the area — grant a fresh countdown, unless a release already started one. */
export function resetTimer(timer: ArrangeTimer, now: number): ArrangeTimer {
  if (timer.releasing) return { ...timer, releasing: false };
  return { ...timer, deadline: now + RESUME_MS, releasing: false };
}

/** Overlay opacity: 1 until the deadline, ramping to 0 across FADE_MS. 0 means "done, clear it". */
export function timerAlpha(timer: ArrangeTimer, now: number): number {
  if (isHeld(timer)) return 1;
  const remaining = timer.deadline - now;
  if (remaining >= 0) return 1;
  return Math.max(0, 1 + remaining / FADE_MS);
}
