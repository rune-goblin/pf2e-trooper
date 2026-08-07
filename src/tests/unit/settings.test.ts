import { describe, expect, it } from 'vitest';
import { dropArtModeFor } from '@/settings';

describe('strategy-token setting', () => {
  it('drops tactical art by default', () => {
    expect(dropArtModeFor(false, false)).toBe('tactical');
  });

  it('drops strategy art when the world opts in', () => {
    expect(dropArtModeFor(true, false)).toBe('strategy');
  });

  it('stays tactical while ReignMaker is active, however the world is set', () => {
    expect(dropArtModeFor(true, true)).toBe('tactical');
    expect(dropArtModeFor(false, true)).toBe('tactical');
  });
});
