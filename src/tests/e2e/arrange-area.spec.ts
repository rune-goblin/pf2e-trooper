import { test, expect } from './fixtures/foundry-clients';

// The advisory area's enforcement and feedback, against a real canvas: the anchor is
// locked, a reshape that would detach a segment is refused outright, a committed
// illegal layout turns the area red and holds it open, and — the part no unit test can
// reach — an in-flight drag turns it red from the preview clone, before any drop.
// Throwaway __e2e_-named documents, deleted in afterAll.

declare const CONFIG: any;
declare const PIXI: any;
declare const canvas: any;

interface Seg {
  id: string;
  x: number;
  y: number;
}

// Mirrors src/troops/arrange.ts. `npm run init` rewrites the module id in both.
const AREA_NAME = 'pf2e-trooper:arrange-area';
const HATCH_NAME = 'pf2e-trooper:arrange-hatch';
const HATCH_COLOR = 0x9cf29c;
const INVALID_COLOR = 0xf29c9c;

test.describe('Arrange area', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_arrange'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_arrange'))) await a.delete();
    });
  });

  test('locks the anchor, refuses detaching drops, and warns in red', async ({ gmPage }) => {
    const ids = await test.step('activate a scene holding one troop', async () => {
      const created = await gmPage.evaluate(async () => {
        const scene = await CONFIG.Scene.documentClass.create({
          name: '__e2e_arrange_scene',
          width: 4000,
          height: 3000,
          grid: { type: 1, size: 100 },
          padding: 0,
        });
        const actor = await CONFIG.Actor.documentClass.create({
          name: '__e2e_arrange_troop',
          type: 'npc',
          system: {
            traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } },
            attributes: { hp: { value: 90, max: 90, temp: 0, details: '' }, speed: { value: 25, otherSpeeds: [] } },
            details: { level: { value: 5 } },
          },
        });
        const tokenDoc = await actor.getTokenDocument({ x: 1000, y: 1000 });
        await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
        await scene.activate();
        return { sceneId: scene.id, actorId: actor.id };
      });
      await gmPage.waitForFunction(
        ({ sceneId }) =>
          canvas?.ready &&
          canvas.scene?.id === sceneId &&
          game.scenes.get(sceneId)?.tokens.filter((t: any) => t.flags?.pf2e?.troop).length === 4,
        created,
        { timeout: 30_000 },
      );
      return created;
    });

    const segments = (): Promise<Seg[]> =>
      gmPage.evaluate(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .map((t: any) => ({ id: t.id, x: t._source.x, y: t._source.y })),
        ids,
      );

    // Reads the live overlay: whether it exists and what colour it is currently painted.
    const overlay = () =>
      gmPage.evaluate(
        ({ areaName, hatchName }) => {
          const area = (canvas.interface as any).children.find((c: any) => c.name === areaName);
          if (!area) return { present: false, tint: null };
          return { present: true, tint: area.getChildByName(hatchName)?.tint ?? null };
        },
        { areaName: AREA_NAME, hatchName: HATCH_NAME },
      );

    // A generous move so the painted area comfortably covers the anchor's neighbours —
    // the steps below place segments one square-step off the anchor and must land inside.
    const anchorId = await test.step('a unit move opens the area in green', async () => {
      const before = await segments();
      const leader = before[0];
      await gmPage.evaluate(
        async ({ sceneId, tokenId }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x: tok._source.x + 600 });
        },
        { ...ids, tokenId: leader.id },
      );
      await expect.poll(overlay, { timeout: 15_000 }).toEqual({ present: true, tint: HATCH_COLOR });
      return leader.id;
    });

    /** One segment's side length in px — the step size between edge-sharing placements. */
    const step = await gmPage.evaluate(
      ({ sceneId, anchorId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(anchorId);
        return tok.width * canvas.grid.size;
      },
      { ...ids, anchorId },
    );

    const anchorAt = async (): Promise<Seg> => (await segments()).find((s) => s.id === anchorId)!;

    /** Moves that bypass the drop guard, exactly as the module's own follow-updates do. */
    const forceMove = (tokenId: string, x: number, y: number) =>
      gmPage.evaluate(
        async ({ sceneId, tokenId, x, y }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x, y }, { pf2eTrooperFollow: true } as any);
        },
        { ...ids, tokenId, x, y },
      );

    await test.step('the anchor is locked while the area is visible', async () => {
      const before = (await segments()).find((s) => s.id === anchorId)!;
      await gmPage.evaluate(
        async ({ sceneId, tokenId }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x: tok._source.x + 100 }).catch(() => null);
        },
        { ...ids, tokenId: anchorId },
      );
      const after = (await segments()).find((s) => s.id === anchorId)!;
      expect(after.x).toBe(before.x);
    });

    // Strand two followers so the layout is illegal and only one segment is left in
    // play — the drop rule then turns purely on that segment's own placement.
    const [strayA, strayB, mover] = await test.step(
      'a committed illegal layout turns the area red and holds it open',
      async () => {
        const anchor = await anchorAt();
        const followers = (await segments()).filter((s) => s.id !== anchorId);
        await forceMove(followers[0].id, anchor.x + 2000, anchor.y + 1500);
        await forceMove(followers[1].id, anchor.x + 2400, anchor.y + 1500);
        await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: INVALID_COLOR });

        // Held, not merely slow to fade: well past the 3s countdown it is still up.
        await gmPage.waitForTimeout(5000);
        expect(await overlay()).toEqual({ present: true, tint: INVALID_COLOR });
        return [followers[0].id, followers[1].id, followers[2].id];
      },
    );

    // Establishes the premise for the refusal below: this neighbourhood IS inside the
    // painted area, so a refusal there can only be the contiguity rule talking.
    await test.step('an edge-sharing reshape inside the area is allowed', async () => {
      const anchor = await anchorAt();
      const target = { x: anchor.x - step, y: anchor.y };
      await gmPage.evaluate(
        async ({ sceneId, tokenId, x, y }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x, y }).catch(() => null);
        },
        { ...ids, tokenId: mover, ...target },
      );
      await expect
        .poll(async () => {
          const after = (await segments()).find((s) => s.id === mover)!;
          return { x: after.x, y: after.y };
        }, { timeout: 10_000 })
        .toEqual(target);
    });

    await test.step('a reshape that would detach the segment is refused', async () => {
      const anchor = await anchorAt();
      const before = (await segments()).find((s) => s.id === mover)!;
      // One square-step diagonally from the proven-inside cell: corner contact only, so
      // it shares no full edge with the anchor and must not commit.
      await gmPage.evaluate(
        async ({ sceneId, tokenId, x, y }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x, y }).catch(() => null);
        },
        { ...ids, tokenId: mover, x: anchor.x - step, y: anchor.y - step },
      );
      const after = (await segments()).find((s) => s.id === mover)!;
      expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
      // And it was not silently reinterpreted as a fresh unit move.
      expect((await anchorAt()).x).toBe(anchor.x);
    });

    await test.step('repairing the layout returns it to green and lets it fade', async () => {
      const anchor = await anchorAt();
      await forceMove(strayA, anchor.x + step, anchor.y);
      await forceMove(strayB, anchor.x, anchor.y - step);
      await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: HATCH_COLOR });
      await expect.poll(overlay, { timeout: 15_000 }).toEqual({ present: false, tint: null });
    });
  });

  // The preview path: Foundry drags a clone and leaves the document untouched until the
  // drop, so this is the only tier that can prove the warning tracks the cursor.
  test('an in-flight drag turns the area red before any drop', async ({ gmPage }) => {
    const ids = await gmPage.evaluate(async () => {
      const scene = await CONFIG.Scene.documentClass.create({
        name: '__e2e_arrange_drag_scene',
        width: 4000,
        height: 3000,
        grid: { type: 1, size: 100 },
        padding: 0,
      });
      const actor = await CONFIG.Actor.documentClass.create({
        name: '__e2e_arrange_drag_troop',
        type: 'npc',
        system: {
          traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } },
          attributes: { hp: { value: 90, max: 90, temp: 0, details: '' }, speed: { value: 25, otherSpeeds: [] } },
          details: { level: { value: 5 } },
        },
      });
      const tokenDoc = await actor.getTokenDocument({ x: 1500, y: 1200 });
      await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
      await scene.activate();
      return { sceneId: scene.id };
    });
    await gmPage.waitForFunction(
      ({ sceneId }) =>
        canvas?.ready &&
        canvas.scene?.id === sceneId &&
        game.scenes.get(sceneId)?.tokens.filter((t: any) => t.flags?.pf2e?.troop).length === 4,
      ids,
      { timeout: 30_000 },
    );

    // Open the area with a unit move, then frame the troop so screen maths is stable.
    const anchorId = await gmPage.evaluate(async ({ sceneId }) => {
      const scene = game.scenes.get(sceneId);
      const leader = scene.tokens.filter((t: any) => t.flags?.pf2e?.troop)[0];
      await leader.update({ x: leader._source.x + 300 });
      await canvas.animatePan({ x: 1800, y: 1400, scale: 0.5 });
      return leader.id;
    }, ids);

    await expect
      .poll(
        () =>
          gmPage.evaluate(
            (areaName) => (canvas.interface as any).children.some((c: any) => c.name === areaName),
            AREA_NAME,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    // Screen coordinates for a follower and for a detached-but-inside destination.
    const points = await gmPage.evaluate(
      ({ sceneId, anchorId }) => {
        const scene = game.scenes.get(sceneId);
        const segs = scene.tokens.filter((t: any) => t.flags?.pf2e?.troop);
        const anchor = segs.find((t: any) => t.id === anchorId);
        const follower = segs.find((t: any) => t.id !== anchorId);
        const toScreen = (wx: number, wy: number) => {
          const p = canvas.stage.worldTransform.apply(new PIXI.Point(wx, wy));
          return { x: Math.round(p.x), y: Math.round(p.y) };
        };
        const size = canvas.grid.size;
        return {
          from: toScreen(follower._source.x + size, follower._source.y + size),
          // Diagonally off the anchor: inside the area, sharing no full edge.
          to: toScreen(anchor._source.x + 400 + size, anchor._source.y + 400 + size),
        };
      },
      { ...ids, anchorId },
    );

    const hatchTint = () =>
      gmPage.evaluate(
        ({ areaName, hatchName }) => {
          const area = (canvas.interface as any).children.find((c: any) => c.name === areaName);
          return area?.getChildByName(hatchName)?.tint ?? null;
        },
        { areaName: AREA_NAME, hatchName: HATCH_NAME },
      );

    expect(await hatchTint()).toBe(HATCH_COLOR);

    await gmPage.mouse.move(points.from.x, points.from.y);
    await gmPage.mouse.down();
    // Two moves: the first starts the drag, the second settles the preview position.
    await gmPage.mouse.move(points.to.x, points.to.y, { steps: 10 });
    await gmPage.mouse.move(points.to.x, points.to.y);

    // A preview clone must exist, or the assertion below would pass for the wrong reason.
    expect(
      await gmPage.evaluate(() => ((canvas.tokens as any).preview?.children?.length ?? 0) as number),
    ).toBeGreaterThan(0);
    await expect.poll(hatchTint, { timeout: 5000 }).toBe(INVALID_COLOR);

    await gmPage.mouse.up();

    // The drop was refused, so the follower is back where it started and the area is green.
    await expect.poll(hatchTint, { timeout: 10_000 }).toBe(HATCH_COLOR);
  });
});
