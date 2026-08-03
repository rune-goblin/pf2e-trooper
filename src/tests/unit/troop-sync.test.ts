import { describe, expect, it } from 'vitest';
import { type ItemSourceLike, followMoves, planItemReconcile } from '@/troops/logic';
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

describe('followMoves', () => {
  const followers = [
    { id: 'b', x: 200, y: 0 },
    { id: 'c', x: 0, y: 200 },
  ];

  // Regression: in v14 the document's prepared x/y still reads the PRE-move position
  // at updateToken time, so the delta must come from the changed payload, never doc.x.
  it('computes the delta from the changed payload against the stashed prior', () => {
    const updates = followMoves({ x: 300 }, { x: 200, y: 100 }, followers);
    expect(updates).toEqual([
      { _id: 'b', x: 300, y: 0 },
      { _id: 'c', x: 100, y: 200 },
    ]);
  });

  it('treats a missing axis as unmoved', () => {
    const updates = followMoves({ y: 250 }, { x: 200, y: 100 }, followers);
    expect(updates).toEqual([
      { _id: 'b', x: 200, y: 150 },
      { _id: 'c', x: 0, y: 350 },
    ]);
  });

  it('returns nothing for a zero-distance update', () => {
    expect(followMoves({ x: 200, y: 100 }, { x: 200, y: 100 }, followers)).toEqual([]);
  });
});
