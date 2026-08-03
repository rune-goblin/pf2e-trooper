import { describe, expect, it } from 'vitest';
import {
  type GridRect,
  REDUCED_EFFECT_SLUGS,
  type ThresholdEntry,
  adjacentPlacements,
  attachablePlacements,
  footprintCells,
  hpCapForStatus,
  isContiguous,
  reachablePlacements,
  segmentsForHp,
  sharesEdge,
  statusFromSlugs,
  syncableSystemDiff,
} from '@/troops/logic';

// PF2e's 5-10-5 rule: diagonals alternate 1-2-1-2 squares.
const measure5105 = (dx: number, dy: number): number => {
  const [lo, hi] = [Math.min(Math.abs(dx), Math.abs(dy)), Math.max(Math.abs(dx), Math.abs(dy))];
  return hi + Math.floor(lo / 2);
};

// Ladder shape matches pf2e's derivation for a 90-HP troop: 4 at full, 3 at 2/3, 2 at 1/3.
const LADDER: ThresholdEntry[] = [
  { hp: 90, segments: 4 },
  { hp: 60, segments: 3 },
  { hp: 30, segments: 2 },
];

describe('segmentsForHp', () => {
  it('grants full segments above the higher threshold', () => {
    expect(segmentsForHp(LADDER, 90)).toBe(4);
    expect(segmentsForHp(LADDER, 61)).toBe(4);
  });

  it('drops a segment exactly at each threshold, matching system findLast semantics', () => {
    expect(segmentsForHp(LADDER, 60)).toBe(3);
    expect(segmentsForHp(LADDER, 31)).toBe(3);
    expect(segmentsForHp(LADDER, 30)).toBe(2);
  });

  it('bottoms out at 2 segments, including at 0 HP', () => {
    expect(segmentsForHp(LADDER, 1)).toBe(2);
    expect(segmentsForHp(LADDER, 0)).toBe(2);
  });
});

describe('statusFromSlugs', () => {
  it('is 4 with no reduced effects', () => {
    expect(statusFromSlugs([])).toBe(4);
    expect(statusFromSlugs(['effect-aid', 'frightened'])).toBe(4);
  });

  it('reads the reduced effects, worst wins', () => {
    expect(statusFromSlugs([REDUCED_EFFECT_SLUGS[3]])).toBe(3);
    expect(statusFromSlugs([REDUCED_EFFECT_SLUGS[3], REDUCED_EFFECT_SLUGS[2]])).toBe(2);
  });
});

describe('hpCapForStatus', () => {
  it('is uncapped at full strength', () => {
    expect(hpCapForStatus(LADDER, 4)).toBeNull();
  });

  it('caps at the matching threshold', () => {
    expect(hpCapForStatus(LADDER, 3)).toBe(60);
    expect(hpCapForStatus(LADDER, 2)).toBe(30);
  });
});

const seg = (x: number, y: number): GridRect => ({ x, y, w: 2, h: 2 });

describe('sharesEdge', () => {
  it('true for side-by-side and offset placements with at least one shared square edge', () => {
    expect(sharesEdge(seg(0, 0), seg(2, 0))).toBe(true);
    expect(sharesEdge(seg(0, 0), seg(2, 1))).toBe(true);
    expect(sharesEdge(seg(0, 0), seg(1, 2))).toBe(true);
  });

  it('false for diagonal contact and gaps (RAW: diagonal is not sufficient)', () => {
    expect(sharesEdge(seg(0, 0), seg(2, 2))).toBe(false);
    expect(sharesEdge(seg(0, 0), seg(3, 0))).toBe(false);
  });
});

describe('isContiguous', () => {
  it('accepts lines, L-shapes, and single segments', () => {
    expect(isContiguous([seg(0, 0)])).toBe(true);
    expect(isContiguous([seg(0, 0), seg(2, 0), seg(4, 0), seg(4, 2)])).toBe(true);
  });

  it('rejects a split formation even when each half is internally connected', () => {
    expect(isContiguous([seg(0, 0), seg(2, 0), seg(6, 0), seg(8, 0)])).toBe(false);
  });
});

describe('adjacentPlacements', () => {
  it('finds all 12 placements around a lone segment', () => {
    expect(adjacentPlacements([seg(0, 0)])).toHaveLength(12);
  });

  it('never overlaps the cluster and every placement touches it edge-on', () => {
    const cluster = [seg(0, 0), seg(2, 0)];
    const placements = adjacentPlacements(cluster);
    for (const p of placements) {
      expect(cluster.some((r) => sharesEdge(r, p))).toBe(true);
      expect(cluster.some((r) => p.x < r.x + r.w && r.x < p.x + p.w && p.y < r.y + r.h && r.y < p.y + p.h)).toBe(false);
    }
    expect(placements.map((p) => `${p.x},${p.y}`)).toContain('-2,0');
    expect(placements.map((p) => `${p.x},${p.y}`)).toContain('4,0');
  });
});

describe('reachablePlacements', () => {
  it('budget 1 from one origin is the 3×3 neighborhood (first diagonal costs 1)', () => {
    const placements = reachablePlacements([{ x: 10, y: 10 }], 1, measure5105);
    expect(placements).toHaveLength(9);
    expect(placements.map((p) => `${p.x},${p.y}`)).toContain('9,9');
  });

  it('applies the alternating diagonal rule: (2,2) costs 3, out of a 2-square budget', () => {
    const keys = reachablePlacements([{ x: 0, y: 0 }], 2, measure5105).map((p) => `${p.x},${p.y}`);
    expect(keys).toContain('1,1');
    expect(keys).toContain('2,1');
    expect(keys).not.toContain('2,2');
  });

  it('unions multiple origins without duplicates and excludes blocked rects', () => {
    const leaderRect: GridRect = { x: 0, y: 0, w: 2, h: 2 };
    const placements = reachablePlacements(
      [
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
      1,
      measure5105,
      2,
      [leaderRect],
    );
    const keys = placements.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    // (1,1) overlaps the leader's 2×2 at the origin square (1,1) — excluded.
    expect(keys).not.toContain('1,1');
    expect(keys).toContain('3,0');
    expect(keys).toContain('0,3');
  });
});

describe('attachablePlacements', () => {
  const leader: GridRect = { x: 0, y: 0, w: 2, h: 2 };
  const A = seg(2, 0);
  const B = seg(4, 0);
  const C = seg(6, 0);
  const isolated = seg(10, 10);

  it('accepts chains up to one layer per remaining segment, rejects detached placements', () => {
    const keys = attachablePlacements(leader, [A, B, C, isolated], 3).map((p) => `${p.x},${p.y}`);
    expect(keys).toEqual(expect.arrayContaining(['2,0', '4,0', '6,0']));
    expect(keys).not.toContain('10,10');
  });

  it('depth limits the chain', () => {
    const keys = attachablePlacements(leader, [A, B, C], 1).map((p) => `${p.x},${p.y}`);
    expect(keys).toEqual(['2,0']);
  });

  it('a placement is unreachable when its bridge is not itself a valid placement', () => {
    expect(attachablePlacements(leader, [B], 3)).toEqual([]);
  });
});

describe('footprintCells', () => {
  it('covers every square of each rect, deduplicated across overlaps', () => {
    const cells = footprintCells([
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 1, y: 0, w: 2, h: 2 },
    ]);
    expect(cells.size).toBe(6);
    expect(cells.has('1,1')).toBe(true);
    expect(cells.has('3,0')).toBe(false);
  });
});

describe('syncableSystemDiff', () => {
  it('drops hp and adjustment (the system propagates those itself)', () => {
    expect(syncableSystemDiff({ attributes: { hp: { value: 12 }, adjustment: 'elite' } })).toBeNull();
  });

  it('keeps sibling attributes when hp is stripped', () => {
    const diff = syncableSystemDiff({ attributes: { hp: { value: 12 }, speed: { value: 30 } } });
    expect(diff).toEqual({ attributes: { speed: { value: 30 } } });
  });

  it('passes unrelated system data through untouched, without mutating the input', () => {
    const input = { details: { level: { value: 3 } }, _migration: { version: 1 } };
    const diff = syncableSystemDiff(input);
    expect(diff).toEqual({ details: { level: { value: 3 } } });
    expect(input._migration).toEqual({ version: 1 });
  });
});
