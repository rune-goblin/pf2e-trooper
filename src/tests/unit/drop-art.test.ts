import { describe, expect, it } from 'vitest';
import { dropArtFor, hasOwnArt, packArtFrom, togglePiece, type DropContext } from '@/art/dropArt';

const ART = 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang';
const NPC_SVG = 'systems/pf2e/icons/default-icons/npc.svg';

const drop = (overrides: Partial<DropContext> = {}): DropContext => ({
  tokenSrc: 'icons/svg/mystery-man.svg',
  actor: { name: 'Bandit Gang', img: NPC_SVG, traits: ['troop'] },
  mode: 'tactical',
  ...overrides,
});

const RING_OFF = { 'ring.enabled': false };

describe('dressing a dropped troop', () => {
  it('applies the tactical token and the portrait, and turns the dynamic ring off', () => {
    expect(dropArtFor(drop())).toEqual({
      tokenSrc: `${ART}_token.webp`,
      tokenReset: RING_OFF,
      actor: { img: `${ART}_portrait.webp`, prototypeSrc: `${ART}_token.webp`, prototypeReset: RING_OFF },
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

describe('preferring trooper art over a token pack', () => {
  const PACK_TOKEN = 'modules/pf2e-tokens-npc-core/assets/tokens/bandit-gang-troop.webp';
  const PACK_PORTRAIT = 'modules/pf2e-tokens-npc-core/assets/portraits/bandit-gang-troop.webp';
  const RESET = { 'texture.scaleX': 1, 'texture.scaleY': 1, 'ring.enabled': false };
  const packDrop = (overrides: Partial<DropContext> = {}): DropContext =>
    drop({
      tokenSrc: PACK_TOKEN,
      actor: { name: 'Bandit Gang', img: PACK_PORTRAIT, traits: ['troop'] },
      packArt: { srcs: [PACK_PORTRAIT, PACK_TOKEN], tokenReset: RESET },
      ...overrides,
    });

  it('replaces mapped art and undoes the mapping on both documents', () => {
    expect(dropArtFor(packDrop())).toEqual({
      tokenSrc: `${ART}_token.webp`,
      tokenReset: { ...RING_OFF, ...RESET },
      actor: {
        img: `${ART}_portrait.webp`,
        prototypeSrc: `${ART}_token.webp`,
        prototypeReset: { ...RING_OFF, ...RESET },
      },
    });
  });

  it('honours mapped art when the world does not prefer trooper art', () => {
    expect(dropArtFor(packDrop({ packArt: null }))).toBeNull();
  });

  it('still leaves a portrait someone picked by hand', () => {
    const decision = dropArtFor(
      packDrop({ actor: { name: 'Bandit Gang', img: 'worlds/mine/gang.webp', traits: ['troop'] } })
    );
    expect(decision?.tokenSrc).toBe(`${ART}_token.webp`);
    expect(decision).not.toHaveProperty('actor');
  });

  it('still leaves a token texture someone picked by hand', () => {
    expect(dropArtFor(packDrop({ tokenSrc: 'worlds/mine/token.webp' }))).toBeNull();
  });

  it('re-dresses a ReignMaker army still wearing token-pack art', () => {
    const actor = { name: 'Bandit Gang', img: PACK_PORTRAIT, traits: ['troop'], hasReignmakerArmyMetadata: true };
    expect(dropArtFor(packDrop({ actor }))?.tokenSrc).toBe(`${ART}_token.webp`);
  });

  it('still defers to ReignMaker on an army wearing what its clone door chose', () => {
    const actor = { name: 'Bandit Gang', img: `${ART}_portrait.webp`, traits: ['troop'], hasReignmakerArmyMetadata: true };
    expect(dropArtFor(packDrop({ tokenSrc: `${ART}_token.webp`, actor }))).toBeNull();
  });

  it('skips the mapping undo for an undressed actor but still turns the ring off', () => {
    const decision = dropArtFor(
      packDrop({ tokenSrc: 'icons/svg/mystery-man.svg', actor: { name: 'Bandit Gang', img: NPC_SVG, traits: ['troop'] } })
    );
    expect(decision?.tokenReset).toEqual(RING_OFF);
    expect(decision?.actor?.prototypeReset).toEqual(RING_OFF);
  });
});

describe('packArtFrom', () => {
  const PORTRAIT = 'modules/pack/portraits/troop.webp';
  const TOKEN = 'modules/pack/tokens/troop.webp';

  it('collects paths from both registries, deduplicated', () => {
    const { srcs } = packArtFrom(
      { actor: PORTRAIT, token: { texture: { src: TOKEN } } },
      { img: PORTRAIT, prototypeToken: { texture: { src: TOKEN } } }
    );
    expect(srcs).toEqual([PORTRAIT, TOKEN]);
  });

  it('accepts a token given as a bare path, with nothing to reset', () => {
    expect(packArtFrom({ token: TOKEN }, undefined)).toEqual({ srcs: [TOKEN], tokenReset: {} });
  });

  it('resets the scale and ring a core mapping merged in', () => {
    const { tokenReset } = packArtFrom(
      { actor: PORTRAIT, token: { texture: { src: TOKEN, scaleX: 2, scaleY: 2 }, ring: { enabled: true } } },
      undefined
    );
    expect(tokenReset).toEqual({
      'texture.scaleX': 1,
      'texture.scaleY': 1,
      'ring.enabled': false,
      'ring.subject.texture': null,
      'ring.subject.scale': 1,
    });
  });

  it('resets the scale and autoscale flag a pf2e mapping merged in', () => {
    const { tokenReset } = packArtFrom(undefined, {
      img: PORTRAIT,
      prototypeToken: { flags: { pf2e: { autoscale: false } }, texture: { src: TOKEN, scaleX: 2, scaleY: 2 } },
    });
    expect(tokenReset).toEqual({
      'texture.scaleX': 1,
      'texture.scaleY': 1,
      'flags.pf2e.-=autoscale': null,
    });
  });

  it('is empty when neither registry mapped the actor', () => {
    expect(packArtFrom(undefined, undefined)).toEqual({ srcs: [], tokenReset: {} });
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
