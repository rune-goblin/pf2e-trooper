import { describe, expect, it } from 'vitest';
import { dedupeTroopUuids } from '@/troops/toolbelt-targets';

const troops: Record<string, string> = {
  'Scene.s.Token.a': 'dromaar',
  'Scene.s.Token.b': 'dromaar',
  'Scene.s.Token.c': 'dromaar',
  'Scene.s.Token.d': 'dromaar',
};
const troopOf = (uuid: string) => troops[uuid] ?? null;

describe('toolbelt target trim', () => {
  it('leaves one row for a troop the template swallowed whole', () => {
    const caught = ['Scene.s.Token.a', 'Scene.s.Token.b', 'Scene.s.Token.c', 'Scene.s.Token.d'];
    expect(dedupeTroopUuids(caught, troopOf)).toEqual(['Scene.s.Token.d']);
  });

  // The canvas keeps the last segment targeted, so the row and the highlighted token agree.
  it('keeps the segment the canvas is left targeting', () => {
    expect(dedupeTroopUuids(['Scene.s.Token.b', 'Scene.s.Token.a'], troopOf)).toEqual(['Scene.s.Token.a']);
  });

  it('keeps every bystander caught alongside the troop', () => {
    const caught = ['Scene.s.Token.a', 'Scene.s.Token.x', 'Scene.s.Token.b', 'Scene.s.Token.y'];
    expect(dedupeTroopUuids(caught, troopOf)).toEqual([
      'Scene.s.Token.x',
      'Scene.s.Token.b',
      'Scene.s.Token.y',
    ]);
  });

  it('returns a troop-free list untouched', () => {
    const caught = ['Scene.s.Token.x', 'Scene.s.Token.y'];
    expect(dedupeTroopUuids(caught, troopOf)).toBe(caught);
  });
});
