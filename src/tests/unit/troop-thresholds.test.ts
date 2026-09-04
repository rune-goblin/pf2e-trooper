import { describe, expect, it } from 'vitest';
import { clampHpToStatus, hpBandForStatus, hpCapForStatus, segmentsForHp } from '@/troops/logic';

// The ladder pf2e derives for a 90 HP troop: floor(2/3 max) and floor(1/3 max).
const thresholds = [
  { hp: 90, segments: 4 },
  { hp: 60, segments: 3 },
  { hp: 30, segments: 2 },
];

describe('hpBandForStatus', () => {
  it('matches the system reading at both edges of every rung', () => {
    for (const status of [2, 3, 4] as const) {
      const band = hpBandForStatus(thresholds, status)!;
      expect(segmentsForHp(thresholds, band.min)).toBe(status);
      expect(segmentsForHp(thresholds, band.max)).toBe(status);
      if (band.max < 90) expect(segmentsForHp(thresholds, band.max + 1)).not.toBe(status);
    }
  });

  it('is bounded above by the heal cap of a reduced rung', () => {
    expect(hpBandForStatus(thresholds, 3)!.max).toBe(hpCapForStatus(thresholds, 3));
    expect(hpBandForStatus(thresholds, 2)!.max).toBe(hpCapForStatus(thresholds, 2));
  });

  it('is null when the ladder lacks the rung', () => {
    expect(hpBandForStatus([{ hp: 90, segments: 4 }], 3)).toBeNull();
  });
});

describe('clampHpToStatus', () => {
  // Recovery that leaves HP under the new band is undone by the next heal: the
  // automation reads the ladder, sees fewer segments than the effect says, and re-reduces.
  it('lifts HP to the floor of the recovered band', () => {
    expect(clampHpToStatus(thresholds, 3, 20)).toBe(31);
    expect(clampHpToStatus(thresholds, 4, 50)).toBe(61);
  });

  it('lowers HP to the cap of a forced reduction', () => {
    expect(clampHpToStatus(thresholds, 2, 90)).toBe(30);
  });

  it('leaves HP already inside the band alone', () => {
    expect(clampHpToStatus(thresholds, 3, 45)).toBe(45);
    expect(clampHpToStatus(thresholds, 4, 90)).toBe(90);
    expect(clampHpToStatus(thresholds, 2, 0)).toBe(0);
  });
});
