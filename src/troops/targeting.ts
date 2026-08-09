import type { TokenPF2e, UserPF2e } from 'foundry-pf2e';
import { troopFlags } from './context';

// A troop is one creature holding one HP pool, so it takes one save and one damage application.
// Target its segments and every consumer counts them separately: pf2e's own damage buttons and
// pf2e-toolbelt's target helper both read `user.targets` verbatim, so a burst over four segments
// asks for four Reflex saves and offers four Apply Damage buttons against the same pool.
//
// The rule is the one already governing control in formation.ts — at most one segment of a troop
// at a time, newest wins — applied to targets. Fixing it here rather than in any one consumer's
// card covers area templates, manual targeting, and every module that reads the target set.

interface Targeted {
  id: string;
  troopId: string | null;
}

/** The targets a newly targeted token makes redundant: its own troop's other segments. */
export function redundantTargets<T extends Targeted>(added: T, current: T[]): T[] {
  if (!added.troopId) return [];
  return current.filter((t) => t.id !== added.id && t.troopId === added.troopId);
}

function describe(token: TokenPF2e): Targeted {
  return { id: token.id, troopId: troopFlags(token.document)?.id ?? null };
}

function onTargetToken(user: UserPF2e, token: TokenPF2e, targeted: boolean): void {
  // Untargeting needs no answer, and a peer's target set is theirs to hold — the client that
  // rolls is the one whose targets the card is built from.
  if (!targeted || user.id !== game.user.id) return;

  const current = [...user.targets];
  const redundant = new Set(redundantTargets(describe(token), current.map(describe)).map((t) => t.id));
  for (const other of current) {
    if (redundant.has(other.id)) other.setTarget(false, { releaseOthers: false });
  }
}

export function registerTargetDeduplication(): void {
  Hooks.on('targetToken', onTargetToken);
}
