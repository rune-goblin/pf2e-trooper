import { test, expect } from './fixtures/foundry-clients';

// Downtime recovery through the public api. The threshold ladder only ever worsens on its
// own; recoverOneSegment / setReducedStatus are the way back up, and they have to leave
// the effect, the HP band and every peer (segments and world actor) agreeing.

declare const CONFIG: any;
declare const canvas: any;

test.describe('Troop reduced-status api', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_recover'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_recover'))) await a.delete();
    });
  });

  test('recovery climbs one rung at a time and every peer follows', async ({ gmPage }) => {
    // 90 max HP: the system's ladder is 60 (3 segments) and 30 (2 segments).
    const ids = await test.step('drop a linked troop onto an active scene', async () => {
      const created = await gmPage.evaluate(async () => {
        const scene = await CONFIG.Scene.documentClass.create({
          name: '__e2e_recover_scene',
          width: 4000,
          height: 3000,
          grid: { type: 1, size: 100 },
          padding: 0,
        });
        const actor = await CONFIG.Actor.documentClass.create({
          name: '__e2e_recover_troop',
          type: 'npc',
          system: {
            traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } },
            attributes: { hp: { value: 90, max: 90, temp: 0, details: '' }, speed: { value: 25, otherSpeeds: [] } },
            details: { level: { value: 5 } },
          },
          prototypeToken: { actorLink: true },
        });
        const tokenDoc = await actor.getTokenDocument({ x: 1000, y: 1000 });
        await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
        await scene.activate();
        return { sceneId: scene.id, actorId: actor.id };
      });
      await gmPage.waitForFunction(
        ({ sceneId }) => canvas?.ready && canvas.scene?.id === sceneId,
        created,
        { timeout: 20_000 },
      );
      await gmPage.waitForFunction(
        ({ sceneId, actorId }) =>
          game.scenes
            .get(sceneId)
            ?.tokens.filter((t: any) => t.flags?.pf2e?.troop?.linked && t.actorId === actorId).length === 4,
        created,
        { timeout: 15_000 },
      );
      return created;
    });

    const everyone = () =>
      gmPage.evaluate(
        ({ sceneId, actorId }) => {
          const read = (doc: any) => ({
            hp: doc.system.attributes.hp.value,
            reduced: doc.itemTypes.effect.map((e: any) => e.slug).filter((s: string) => s?.startsWith('troop-reduced')),
          });
          const segments = game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .map((t: any) => read(t.actor));
          return { base: read(game.actors.get(actorId)), segments };
        },
        ids,
      );
    const api = (call: string, ...args: unknown[]) =>
      gmPage.evaluate(
        async ({ actorId, call, args }) => {
          const api = game.modules.get('pf2e-trooper').api;
          return api[call](game.actors.get(actorId), ...args);
        },
        { ...ids, call, args },
      );

    await test.step('damage on a segment reduces the troop to 2 segments everywhere', async () => {
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.update({ 'system.attributes.hp.value': 20 });
      }, ids);
      await expect.poll(everyone, { timeout: 15_000 }).toEqual({
        base: { hp: 20, reduced: ['troop-reduced-2-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 20, reduced: ['troop-reduced-2-segments'] })),
      });
      expect(await api('reducedStatus')).toBe(2);
    });

    await test.step('recoverOneSegment climbs to 3: effect swapped, HP lifted into the band, peers converged', async () => {
      expect(await api('recoverOneSegment')).toBe(3);
      // Resolved only after the reconcile, so no polling: every peer already agrees.
      expect(await everyone()).toEqual({
        base: { hp: 31, reduced: ['troop-reduced-3-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 31, reduced: ['troop-reduced-3-segments'] })),
      });
    });

    await test.step('healing past the new cap is still capped at 60', async () => {
      await gmPage.evaluate(async ({ actorId }) => {
        await game.actors.get(actorId).update({ 'system.attributes.hp.value': 75 });
      }, ids);
      await expect.poll(everyone, { timeout: 15_000 }).toEqual({
        base: { hp: 60, reduced: ['troop-reduced-3-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 60, reduced: ['troop-reduced-3-segments'] })),
      });
    });

    await test.step('a further heal does not re-reduce the troop', async () => {
      await gmPage.evaluate(async ({ actorId }) => {
        await game.actors.get(actorId).update({ 'system.attributes.hp.value': 55 });
      }, ids);
      await expect.poll(everyone, { timeout: 15_000 }).toEqual({
        base: { hp: 55, reduced: ['troop-reduced-3-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 55, reduced: ['troop-reduced-3-segments'] })),
      });
    });

    await test.step('recoverOneSegment again restores full strength and lifts the cap', async () => {
      expect(await api('recoverOneSegment')).toBe(4);
      expect(await everyone()).toEqual({
        base: { hp: 61, reduced: [] },
        segments: Array.from({ length: 4 }, () => ({ hp: 61, reduced: [] })),
      });
      await gmPage.evaluate(async ({ actorId }) => {
        await game.actors.get(actorId).update({ 'system.attributes.hp.value': 90 });
      }, ids);
      await expect.poll(everyone, { timeout: 15_000 }).toEqual({
        base: { hp: 90, reduced: [] },
        segments: Array.from({ length: 4 }, () => ({ hp: 90, reduced: [] })),
      });
      expect(await api('recoverOneSegment')).toBe(4);
    });

    await test.step('setReducedStatus forces a reduction and pulls HP down to its cap', async () => {
      expect(await api('setReducedStatus', 2)).toBe(2);
      expect(await everyone()).toEqual({
        base: { hp: 30, reduced: ['troop-reduced-2-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 30, reduced: ['troop-reduced-2-segments'] })),
      });
    });

    await test.step('called on a segment instead of the world actor, the result is the same', async () => {
      const status = await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        return game.modules.get('pf2e-trooper').api.recoverOneSegment(seg.actor);
      }, ids);
      expect(status).toBe(3);
      expect(await everyone()).toEqual({
        base: { hp: 31, reduced: ['troop-reduced-3-segments'] },
        segments: Array.from({ length: 4 }, () => ({ hp: 31, reduced: ['troop-reduced-3-segments'] })),
      });
    });

    await test.step('a non-troop actor is refused with null', async () => {
      const result = await gmPage.evaluate(async () => {
        const actor = await CONFIG.Actor.documentClass.create({ name: '__e2e_recover_plain', type: 'npc' });
        return game.modules.get('pf2e-trooper').api.recoverOneSegment(actor);
      });
      expect(result).toBeNull();
    });
  });
});
