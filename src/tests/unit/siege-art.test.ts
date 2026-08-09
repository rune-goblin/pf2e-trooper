import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_ICON, strippedSiegeArt } from '@/art/siegeArt';

const ART = 'modules/pf2e-trooper/assets/siege-engines/ballista.webp';
const FLAG_KEY = 'flags.pf2e-trooper.siege-weapon.strategyTokenImage';

describe('stripping siege-engine art', () => {
  it('swaps all three slots for the default vehicle icon', () => {
    expect(
      strippedSiegeArt({ img: ART, prototypeSrc: ART, siegeFlag: { strategyTokenImage: ART } })
    ).toEqual({
      img: DEFAULT_VEHICLE_ICON,
      'prototypeToken.texture.src': DEFAULT_VEHICLE_ICON,
      [FLAG_KEY]: DEFAULT_VEHICLE_ICON
    });
  });

  it('strips only the slots still pointing into our tree', () => {
    const chosen = 'worlds/my-world/ballista-photo.webp';
    expect(
      strippedSiegeArt({ img: chosen, prototypeSrc: ART, siegeFlag: { strategyTokenImage: ART } })
    ).toEqual({
      'prototypeToken.texture.src': DEFAULT_VEHICLE_ICON,
      [FLAG_KEY]: DEFAULT_VEHICLE_ICON
    });
  });
});

describe('leaving an actor alone', () => {
  it('ignores actors without the siege-weapon flag, even wearing our art', () => {
    expect(strippedSiegeArt({ img: ART, prototypeSrc: ART, siegeFlag: null })).toBeNull();
    expect(strippedSiegeArt({ img: ART, prototypeSrc: ART })).toBeNull();
  });

  it('ignores a siege weapon with no slot pointing into our tree', () => {
    expect(
      strippedSiegeArt({
        img: DEFAULT_VEHICLE_ICON,
        prototypeSrc: 'worlds/my-world/ballista.webp',
        siegeFlag: { strategyTokenImage: DEFAULT_VEHICLE_ICON }
      })
    ).toBeNull();
  });
});
