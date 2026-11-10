import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type ItemSourceLike,
  baseSyncableSystemDiff,
  cloneSystemDiff,
  followMoves,
  positionAfter,
  planItemReconcile,
  reconcileKey,
  syncableSystemDiff,
} from '@/troops/logic';
import { isExcludedItemSource } from '@/troops/sync';

const item = (id: string, extra: Record<string, unknown> = {}): ItemSourceLike => ({
  _id: id,
  name: `Item ${id}`,
  system: { slug: null },
  ...extra,
});

const notExcluded = () => false;

describe('planItemReconcile', () => {
  it('is a no-op when sibling already matches the leader', () => {
    const items = [item('aaaa'), item('bbbb')];
    expect(planItemReconcile(items, structuredClone(items), notExcluded)).toEqual({
      create: [],
      update: [],
      delete: [],
    });
  });

  it('creates leader-only items and deletes sibling-only items', () => {
    const plan = planItemReconcile([item('aaaa'), item('new1')], [item('aaaa'), item('old1')], notExcluded);
    expect(plan.create.map((i) => i._id)).toEqual(['new1']);
    expect(plan.delete).toEqual(['old1']);
  });

  it('updates when sources diverge (e.g. condition badge value)', () => {
    const leader = [item('cond', { system: { slug: 'sickened', value: 2 } })];
    const sibling = [item('cond', { system: { slug: 'sickened', value: 1 } })];
    const plan = planItemReconcile(leader, sibling, notExcluded);
    expect(plan.update.map((i) => i._id)).toEqual(['cond']);
    expect(plan.create).toEqual([]);
  });

  // Regression: mid-cascade mirroring issued keepId creates for ids the sibling already
  // held, which the server rejects hard ("_id already exists within ActorDelta").
  it('never plans a create for an id the sibling already has', () => {
    const plan = planItemReconcile([item('dupe')], [item('dupe', { name: 'diverged' })], notExcluded);
    expect(plan.create).toEqual([]);
    expect(plan.update.map((i) => i._id)).toEqual(['dupe']);
  });

  it('excluded items are invisible in both directions', () => {
    const excluded = (i: ItemSourceLike) => i._id.startsWith('x');
    const plan = planItemReconcile(
      [item('aaaa'), item('xLeaderOnly')],
      [item('aaaa'), item('xSiblingOnly')],
      excluded,
    );
    expect(plan).toEqual({ create: [], update: [], delete: [] });
  });
});

describe('isExcludedItemSource', () => {
  it('excludes rule-element grants and persistent damage, keeps ordinary conditions', () => {
    expect(isExcludedItemSource(item('gran', { flags: { pf2e: { grantedBy: { id: 'zzzz' } } } }))).toBe(true);
    expect(isExcludedItemSource(item('pers', { system: { slug: 'persistent-damage' } }))).toBe(true);
    expect(isExcludedItemSource(item('sick', { system: { slug: 'sickened' } }))).toBe(false);
  });
});

describe('positionAfter', () => {
  const prior = { x: 200, y: 100, elevation: 0, level: 'ground' };

  // Regression: in v14 the document's prepared x/y still reads the PRE-move position
  // at updateToken time, so the result must come from the changed payload, never doc.x.
  it('reads the changed payload over the stashed prior', () => {
    expect(positionAfter({ x: 300, elevation: 10, level: 'upper' }, prior)).toEqual({
      x: 300,
      y: 100,
      elevation: 10,
      level: 'upper',
    });
  });

  it('treats a missing field as unmoved', () => {
    expect(positionAfter({ y: 250 }, prior)).toEqual({ ...prior, y: 250 });
  });
});

describe('followMoves', () => {
  const prior = { x: 200, y: 100, elevation: 0, level: 'ground' };
  const followers = [
    { id: 'b', x: 200, y: 0, elevation: 0 },
    { id: 'c', x: 0, y: 200, elevation: 5 },
  ];

  it('applies the leader shift to every follower', () => {
    expect(followMoves(prior, { ...prior, x: 300, y: 250 }, followers)).toEqual([
      { _id: 'b', x: 300, y: 150, elevation: 0 },
      { _id: 'c', x: 100, y: 350, elevation: 5 },
    ]);
  });

  it('carries an elevation change with no horizontal move', () => {
    expect(followMoves(prior, { ...prior, elevation: 20 }, followers)).toEqual([
      { _id: 'b', x: 200, y: 0, elevation: 20 },
      { _id: 'c', x: 0, y: 200, elevation: 25 },
    ]);
  });

  it('carries a level change', () => {
    expect(followMoves(prior, { ...prior, level: 'upper' }, followers)).toEqual([
      { _id: 'b', x: 200, y: 0, elevation: 0, level: 'upper' },
      { _id: 'c', x: 0, y: 200, elevation: 5, level: 'upper' },
    ]);
  });

  it('returns nothing when the leader did not move', () => {
    expect(followMoves(prior, { ...prior }, followers)).toEqual([]);
  });
});

describe('system diff projections', () => {
  const hpChange = { attributes: { hp: { value: 40 } }, _migration: { version: 1 } };

  // Sibling HP is the system's job (its own fromTroop updates), the world actor's is nobody's
  // but ours: without this a deployed troop's damage never leaves the scene.
  it('strips hp for a sibling segment and keeps it for the world actor', () => {
    expect(syncableSystemDiff(structuredClone(hpChange))).toBeNull();
    expect(baseSyncableSystemDiff(structuredClone(hpChange))).toEqual({ attributes: { hp: { value: 40 } } });
  });

  it('drops per-actor migration bookkeeping from both', () => {
    const diff = { details: { level: { value: 5 } }, _migration: { version: 1 } };
    expect(syncableSystemDiff(structuredClone(diff))).toEqual({ details: { level: { value: 5 } } });
    expect(baseSyncableSystemDiff(structuredClone(diff))).toEqual({ details: { level: { value: 5 } } });
  });

  it('is null when a change carries nothing to mirror', () => {
    expect(baseSyncableSystemDiff({ _migration: { version: 1 } })).toBeNull();
  });
});

// Shaped like common/data/operators.mjs: the value sits under a symbol, and create() wraps a
// replacement in a Proxy. Those two traits are what structuredClone trips on.
const OPERATOR_VALUE = Symbol('DataFieldOperatorValue');
class DataFieldOperator {
  [OPERATOR_VALUE]: unknown;
  constructor(value?: unknown) {
    this[OPERATOR_VALUE] = value;
  }
  static get(value: unknown): unknown {
    return value instanceof DataFieldOperator ? value[OPERATOR_VALUE] : value;
  }
}
class ForcedDeletion extends DataFieldOperator {}
class ForcedReplacement extends DataFieldOperator {
  static create(value: unknown): ForcedReplacement {
    return new Proxy(new ForcedReplacement(value), {});
  }
}

describe('cloneSystemDiff with v14 data operators', () => {
  beforeAll(() => vi.stubGlobal('foundry', { data: { operators: { DataFieldOperator, ForcedDeletion, ForcedReplacement } } }));
  afterAll(() => vi.unstubAllGlobals());

  // An Adventure import updates existing actors with `recursive: false`, so `changed.system`
  // arrives as one ForcedReplacement holding the whole system.
  const imported = () =>
    ForcedReplacement.create({
      attributes: { hp: { value: 40 }, speed: { value: 30 } },
      details: { level: { value: 5 } },
      _migration: { version: 1 },
    });

  it('copies a replacement that structuredClone rejects', () => {
    expect(() => structuredClone(imported())).toThrow();
    expect(cloneSystemDiff(imported())).toEqual({
      attributes: { hp: { value: 40 }, speed: { value: 30 } },
      details: { level: { value: 5 } },
      _migration: { version: 1 },
    });
  });

  it('projects an unwrapped replacement like any other diff', () => {
    expect(syncableSystemDiff(imported())).toEqual({
      attributes: { speed: { value: 30 } },
      details: { level: { value: 5 } },
    });
    expect(baseSyncableSystemDiff(imported())).toEqual({
      attributes: { hp: { value: 40 }, speed: { value: 30 } },
      details: { level: { value: 5 } },
    });
  });

  it('keeps a deletion a deletion through the hook copy and the projection', () => {
    const deletion = new ForcedDeletion();
    const projected = syncableSystemDiff(cloneSystemDiff({ details: { alliance: deletion } }));
    const alliance = (projected?.details as Record<string, unknown>).alliance;
    expect(alliance).toBeInstanceOf(ForcedDeletion);
    expect(alliance).not.toBe(deletion);
  });
});

describe('reconcileKey', () => {
  // A linked troop placed twice in one scene is eight segments of ONE troop, and the
  // same troop id turns up in every scene it stands in: keying by scene would make two
  // jobs for one unit, each overwriting the other's convergence.
  it('gives a linked troop one key across scenes and placements', () => {
    const troop = { id: 'OIddxhuoEno4ESFq', linked: true };
    expect(reconcileKey(troop, 'sceneA')).toBe(reconcileKey(troop, 'sceneB'));
  });

  it('keeps unlinked troops scene-local', () => {
    const troop = { id: 'abc', linked: false };
    expect(reconcileKey(troop, 'sceneA')).not.toBe(reconcileKey(troop, 'sceneB'));
  });

  it('never collides two different troops', () => {
    expect(reconcileKey({ id: 'a', linked: true }, 's')).not.toBe(reconcileKey({ id: 'b', linked: true }, 's'));
  });
});
