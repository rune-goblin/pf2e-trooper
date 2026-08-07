import { describe, expect, it } from 'vitest';
import { dropArtFor, hasOwnArt, togglePiece, type DropContext } from '@/art/dropArt';

const ART = 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang';
const NPC_SVG = 'systems/pf2e/icons/default-icons/npc.svg';

const drop = (overrides: Partial<DropContext> = {}): DropContext => ({
  tokenSrc: 'icons/svg/mystery-man.svg',
  actor: { name: 'Bandit Gang', img: NPC_SVG, traits: ['troop'] },
  mode: 'tactical',
  ...overrides,
});

describe('dressing a dropped troop', () => {
  it('applies the tactical token and the portrait', () => {
    expect(dropArtFor(drop())).toEqual({
      tokenSrc: `${ART}_token.webp`,
      actor: { img: `${ART}_portrait.webp`, prototypeSrc: `${ART}_token.webp` },
    });
  });

  it('applies the strategy piece when the world asks for it', () => {
    expect(dropArtFor(drop({ mode: 'strategy' })!)?.tokenSrc).toBe(`${ART}_strategy.webp`);
  });

  it('leaves a portrait someone already chose', () => {
    const decision = dropArtFor(
      drop({ actor: { name: 'Bandit Gang', img: 'worlds/mine/gang.webp', traits: ['troop'] } })
    );
    expect(decision?.tokenSrc).toBe(`${ART}_token.webp`);
    expect(decision).not.toHaveProperty('actor');
  });

  // Once the first drop dresses the actor, later tokens arrive wearing its tactical piece. That
  // is ours, so the world's setting still decides what gets placed.
  it('re-points one of our own pieces at the mode the world asked for', () => {
    const decision = dropArtFor(drop({ tokenSrc: `${ART}_token.webp`, mode: 'strategy' }));
    expect(decision?.tokenSrc).toBe(`${ART}_strategy.webp`);
  });

  it.each([
    ["Foundry's core default", 'icons/svg/mystery-man.svg'],
    ['a system default icon', NPC_SVG],
    ['nothing at all', ''],
  ])('treats %s as an undressed token', (_label, tokenSrc) => {
    expect(dropArtFor(drop({ tokenSrc }))?.tokenSrc).toBe(`${ART}_token.webp`);
  });
});

describe('leaving a drop alone', () => {
  it.each([
    ['the token already has art', { tokenSrc: 'worlds/mine/token.webp' }],
    ['the actor is not a troop', { actor: { name: 'Bandit Gang', img: NPC_SVG, traits: ['humanoid'] } }],
    ['nothing was drawn for the name', { actor: { name: 'Not A Troop', img: NPC_SVG, traits: ['troop'] } }],
    ['there is no actor', { actor: null }],
  ])('skips when %s', (_label, overrides) => {
    expect(dropArtFor(drop(overrides as Partial<DropContext>))).toBeNull();
  });

  // ReignMaker dresses its own kingdom map, and its clone door dresses its own armies.
  it('defers to ReignMaker on its kingdom scene', () => {
    expect(dropArtFor(drop({ isKingdomScene: true }))).toBeNull();
  });

  it('defers to ReignMaker on an actor its clone door already handled', () => {
    const actor = { name: 'Bandit Gang', img: NPC_SVG, traits: ['troop'], hasReignmakerArmyMetadata: true };
    expect(dropArtFor(drop({ actor }))).toBeNull();
  });
});

describe('togglePiece', () => {
  it('swaps between the pair in both directions', () => {
    expect(togglePiece(`${ART}_token.webp`)).toBe(`${ART}_strategy.webp`);
    expect(togglePiece(`${ART}_strategy.webp`)).toBe(`${ART}_token.webp`);
  });

  it.each([
    ['a portrait', `${ART}_portrait.webp`],
    ["someone's own file", 'worlds/mine/token.webp'],
    ['nothing', undefined],
  ])('has no pair for %s', (_label, src) => {
    expect(togglePiece(src)).toBeNull();
  });
});

describe('hasOwnArt', () => {
  it('is false for the placeholders and true for a real choice', () => {
    expect(hasOwnArt('icons/svg/mystery-man.svg')).toBe(false);
    expect(hasOwnArt(NPC_SVG)).toBe(false);
    expect(hasOwnArt('')).toBe(false);
    expect(hasOwnArt(undefined)).toBe(false);
    expect(hasOwnArt('worlds/mine/token.webp')).toBe(true);
  });
});
