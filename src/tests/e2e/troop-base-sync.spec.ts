import { test, expect } from './fixtures/foundry-clients';

// Two-way sync between a linked troop's segments and the world actor they were placed
// from. Segment tokens are always unlinked, so without this the kingdom layer — which
// only ever reads the world actor — sees a pristine actor for a troop that has been
// mauled on a scene, and its healing never reaches the segments.

declare const CONFIG: any;
declare const canvas: any;

test.describe('Linked troop world-actor sync', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_linked'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_linked'))) await a.delete();
    });
  });

  test('segment damage reaches the world actor, and world-actor changes reach the segments', async ({ gmPage }) => {
    const ids = await test.step('drop a linked troop actor onto a fresh scene', async () => {
      const created = await gmPage.evaluate(async () => {
        const scene = await CONFIG.Scene.documentClass.create({
          name: '__e2e_linked_scene',
          width: 4000,
          height: 3000,
          grid: { type: 1, size: 100 },
          padding: 0,
        });
        const actor = await CONFIG.Actor.documentClass.create({
          name: '__e2e_linked_troop',
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
        // A linked actor's update ripples to its token objects, which needs a drawn canvas.
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

    const baseState = () =>
      gmPage.evaluate(({ actorId }) => {
        const actor = game.actors.get(actorId);
        return {
          hp: actor.system.attributes.hp.value,
          effects: actor.itemTypes.effect.map((e: any) => e.slug),
          conditions: actor.itemTypes.condition.map((c: any) => c.slug),
        };
      }, ids);

    const segmentHp = () =>
      gmPage.evaluate(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .map((t: any) => t.actor?.system.attributes.hp.value),
        ids,
      );

    await test.step('damage on a segment carries hp and the Troop Reduced effect to the world actor', async () => {
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.update({ 'system.attributes.hp.value': 50 });
      }, ids);
      await expect.poll(baseState, { timeout: 15_000 }).toMatchObject({
        hp: 50,
        effects: ['troop-reduced-3-segments'],
      });
    });

    await test.step('a condition applied to a segment reaches the world actor', async () => {
      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.increaseCondition('sickened');
      }, ids);
      await expect
        .poll(async () => (await baseState()).conditions, { timeout: 15_000 })
        .toContain('sickened');
    });

    await test.step('clearing the effect on the world actor clears it on every segment', async () => {
      await gmPage.evaluate(async ({ actorId }) => {
        const actor = game.actors.get(actorId);
        const reduced = actor.itemTypes.effect.filter((e: any) => e.slug?.startsWith('troop-reduced'));
        await actor.deleteEmbeddedDocuments('Item', reduced.map((e: any) => e.id));
      }, ids);
      await gmPage.waitForFunction(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .every((t: any) => !t.actor?.itemTypes.effect.some((e: any) => e.slug?.startsWith('troop-reduced'))),
        ids,
        { timeout: 15_000 },
      );
    });

    await test.step('healing the world actor heals every segment', async () => {
      await gmPage.evaluate(async ({ actorId }) => {
        await game.actors.get(actorId).update({ 'system.attributes.hp.value': 90 });
      }, ids);
      await expect.poll(segmentHp, { timeout: 15_000 }).toEqual([90, 90, 90, 90]);
    });

    // A linked troop is one unit wherever it stands: the same troop id turns up in
    // every scene holding it, and placing it twice in one scene makes eight segments
    // of one troop rather than two troops.
    await test.step('a second scene holding the same troop converges with the first', async () => {
      await gmPage.evaluate(async ({ actorId }) => {
        const scene = await CONFIG.Scene.documentClass.create({
          name: '__e2e_linked_scene_b',
          width: 4000,
          height: 3000,
          grid: { type: 1, size: 100 },
          padding: 0,
        });
        const doc = await game.actors.get(actorId).getTokenDocument({ x: 1000, y: 1000 });
        await scene.createEmbeddedDocuments('Token', [doc.toObject()]);
      }, ids);

      const everySegment = () =>
        gmPage.evaluate(({ actorId }) => {
          const out: { hp: number; reduced: boolean }[] = [];
          for (const scene of game.scenes) {
            for (const t of scene.tokens) {
              if ((t as any).flags?.pf2e?.troop?.id !== actorId) continue;
              out.push({
                hp: (t as any).actor?.system.attributes.hp.value,
                reduced: !!(t as any).actor?.itemTypes.effect.some((e: any) => e.slug === 'troop-reduced-3-segments'),
              });
            }
          }
          return out;
        }, ids);

      await expect.poll(async () => (await everySegment()).length, { timeout: 15_000 }).toBe(8);

      await gmPage.evaluate(async ({ sceneId }) => {
        const seg = game.scenes.get(sceneId).tokens.find((t: any) => t.flags?.pf2e?.troop);
        await seg.actor.update({ 'system.attributes.hp.value': 50 });
      }, ids);

      await expect
        .poll(everySegment, { timeout: 15_000 })
        .toEqual(Array.from({ length: 8 }, () => ({ hp: 50, reduced: true })));
      await expect.poll(baseState, { timeout: 15_000 }).toMatchObject({ hp: 50 });
    });
  });
});
