import { describe, expect, it } from 'vitest';
import { redundantTargets } from '@/troops/targeting';

const segment = (id: string, troopId: string | null) => ({ id, troopId });

describe('troop target deduplication', () => {
  it('drops the siblings already targeted', () => {
    const added = segment('d', 'dromaar');
    const current = [segment('a', 'dromaar'), segment('b', 'dromaar'), added];
    expect(redundantTargets(added, current).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('leaves another troop targeted', () => {
    const added = segment('d', 'dromaar');
    const current = [segment('x', 'grosbeak'), added];
    expect(redundantTargets(added, current)).toEqual([]);
  });

  it('leaves everything alone for a token outside any troop', () => {
    const current = [segment('a', 'dromaar'), segment('b', 'dromaar')];
    expect(redundantTargets(segment('lone', null), current)).toEqual([]);
  });

  // A burst adds every covered segment in turn; each addition sheds the ones before it, so the
  // set converges on one target per troop however many the template caught.
  it('converges a whole troop caught by a template onto one target', () => {
    const caught = ['a', 'b', 'c', 'd'].map((id) => segment(id, 'dromaar'));
    let targets: ReturnType<typeof segment>[] = [];
    for (const next of caught) {
      targets = [...targets, next];
      const redundant = new Set(redundantTargets(next, targets).map((t) => t.id));
      targets = targets.filter((t) => !redundant.has(t.id));
    }
    expect(targets.map((t) => t.id)).toEqual(['d']);
  });
});
