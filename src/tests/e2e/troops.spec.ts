import { test, expect } from './fixtures/foundry-clients';

// Troop lifecycle against a real Foundry + pf2e: segment spawn on drop, full-state
// sync (reconciler), formation-follow movement, and Troop Reduced threshold
// automation. One serial test — each step depends on the state the previous one made.
// Uses throwaway __e2e_-named documents, deleted in afterAll.

declare const CONFIG: any;
declare const canvas: any;

test.describe('Troop segments', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_troop'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_troop'))) await a.delete();
    });
  });

  test('segments spawn, sync, move as a unit, and reduce at thresholds', async ({ gmPage }) => {
    const ids = await test.step('drop a troop NPC onto a fresh scene', async () => {
      const created = await gmPage.evaluate(async () => {
        const scene = await CONFIG.Scene.documentClass.create({
          name: '__e2e_troop_scene',
          width: 4000,
          height: 3000,
          grid: { type: 1, size: 100 },
          padding: 0,
        });
        const actor = await CONFIG.Actor.documentClass.create({
          name: '__e2e_troop',
          type: 'npc',
          system: {
            traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } },
            attributes: { hp: { value: 90, max: 90, temp: 0, details: '' }, speed: { value: 25, otherSpeeds: [] } },
            details: { level: { value: 5 } },
          },
        });
        const tokenDoc = await actor.getTokenDocument({ x: 1000, y: 1000 });
        await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
        // Item and actor writes ripple into token render flags, which need a drawn canvas.
        await scene.activate();
        return { sceneId: scene.id, actorId: actor.id };
      });
      await gmPage.waitForFunction(
        ({ sceneId }) => canvas?.ready && canvas.scene?.id === sceneId,
        created,
        { timeout: 20_000 },
      );
      await gmPage.waitForFunction(
        ({ sceneId }) => game.scenes.get(sceneId)?.tokens.filter((t: any) => t.flags?.pf2e?.troop).length === 4,
        created,
        { timeout: 15_000 },
      );
      return created;
    });

    const segments = () =>
      gmPage.evaluate(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .map((t: any) => ({
              id: t.id,
              x: t._source.x,
              y: t._source.y,
              conditions: t.actor?.itemTypes.condition.map((c: any) => c.slug) ?? [],
              effects: t.actor?.itemTypes.effect.map((e: any) => e.slug) ?? [],
              hp: t.actor?.system.attributes.hp.value,
            })),
        ids,
      );

    await test.step('a condition applied to one segment reconciles to all four', async () => {
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.increaseCondition('sickened');
      }, ids);
      await gmPage.waitForFunction(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .every((t: any) => t.actor?.itemTypes.condition.some((c: any) => c.slug === 'sickened')),
        ids,
        { timeout: 10_000 },
      );
    });

    await test.step('moving one segment translates the whole formation', async () => {
      const before = await segments();
      await gmPage.evaluate(async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        await tok.update({ x: tok._source.x + 300, y: tok._source.y + 100 });
      }, { ...ids, tokenId: before[0].id });
      await gmPage.waitForFunction(
        ({ sceneId, firstId, oldX }) => {
          const tok = game.scenes.get(sceneId).tokens.get(firstId);
          const all = game.scenes.get(sceneId).tokens.filter((t: any) => t.flags?.pf2e?.troop);
          return tok._source.x === oldX + 300 && all.every((t: any) => t._source.x >= oldX);
        },
        { ...ids, firstId: before[0].id, oldX: before[0].x },
        { timeout: 10_000 },
      );
      await expect
        .poll(async () => {
          const after = await segments();
          return after.map((t: { id: string; x: number; y: number }) => {
            const prev = before.find((b: { id: string }) => b.id === t.id);
            return { dx: t.x - prev.x, dy: t.y - prev.y };
          });
        }, { timeout: 10_000 })
        .toEqual(before.map(() => ({ dx: 300, dy: 100 })));
    });

    await test.step('crossing the 2/3 threshold applies Troop Reduced (3) everywhere and caps healing', async () => {
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.update({ 'system.attributes.hp.value': 50 });
      }, ids);
      await gmPage.waitForFunction(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .every((t: any) => t.actor?.itemTypes.effect.some((e: any) => e.slug === 'troop-reduced-3-segments')),
        ids,
        { timeout: 10_000 },
      );

      // Healing cannot exceed the 2/3 threshold (60 of 90) while reduced.
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.update({ 'system.attributes.hp.value': 90 });
      }, ids);
      await expect
        .poll(async () => (await segments()).map((s: { hp: number }) => s.hp), { timeout: 10_000 })
        .toEqual([60, 60, 60, 60]);
    });
  });
});
