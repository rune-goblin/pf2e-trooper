import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/foundry-clients';

// The advisory area's feedback, against a real canvas. Placement is free — the colour
// carries the verdict: an illegal layout paints the area red and holds it open, a legal
// one returns it to green and lets it fade. The anchor lock is the one hard rule. And —
// the part no unit test can reach — an in-flight drag turns it red from the preview
// clone, before any drop. Throwaway __e2e_-named documents, deleted in afterAll.

declare const CONFIG: any;
declare const CONST: any;
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

/** A fresh activated scene holding one 4-segment troop, ready to drive. */
async function createTroopScene(
  gmPage: Page,
  slug: string,
  at: { x: number; y: number },
): Promise<{ sceneId: string }> {
  const created = await gmPage.evaluate(
    async ({ slug, at }) => {
      const scene = await CONFIG.Scene.documentClass.create({
        name: `__e2e_arrange_${slug}_scene`,
        width: 4000,
        height: 3000,
        grid: { type: 1, size: 100 },
        padding: 0,
      });
      const actor = await CONFIG.Actor.documentClass.create({
        name: `__e2e_arrange_${slug}_troop`,
        type: 'npc',
        system: {
          traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } },
          attributes: { hp: { value: 90, max: 90, temp: 0, details: '' }, speed: { value: 25, otherSpeeds: [] } },
          details: { level: { value: 5 } },
        },
      });
      const tokenDoc = await actor.getTokenDocument(at);
      await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
      await scene.activate();
      return { sceneId: scene.id as string };
    },
    { slug, at },
  );
  await gmPage.waitForFunction(
    ({ sceneId }) =>
      canvas?.ready &&
      canvas.scene?.id === sceneId &&
      game.scenes.get(sceneId)?.tokens.filter((t: any) => t.flags?.pf2e?.troop).length === 4,
    created,
    { timeout: 30_000 },
  );
  return created;
}

test.describe('Arrange area', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_arrange'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_arrange'))) await a.delete();
    });
  });

  test('locks the anchor, allows free reshaping, and warns in red', async ({ gmPage }) => {
    const ids = await test.step('activate a scene holding one troop', () =>
      createTroopScene(gmPage, 'main', { x: 1000, y: 1000 }));

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

    // Pins the platform behaviour behind footprintsShareEdge: Foundry's own adjacency
    // helper answers a *movement* question and counts corner contact, because PF2e's
    // 5-10-5 makes diagonals legal. Troop contiguity needs a shared edge, so we cannot
    // delegate to it. If a Foundry or system change ever flips this, we want to know.
    await test.step('Foundry grid adjacency counts diagonals, so it cannot judge contiguity', async () => {
      const grid = await gmPage.evaluate(() => ({
        diagonalsAreIllegal: canvas.grid.diagonals === CONST.GRID_DIAGONALS.ILLEGAL,
        // Two squares touching only at a corner.
        diagonalIsAdjacent: canvas.grid.testAdjacency({ i: 0, j: 0 }, { i: 1, j: 1 }),
        orthogonalIsAdjacent: canvas.grid.testAdjacency({ i: 0, j: 0 }, { i: 0, j: 1 }),
      }));
      expect(grid).toEqual({
        diagonalsAreIllegal: false,
        diagonalIsAdjacent: true,
        orthogonalIsAdjacent: true,
      });
    });

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
        // Far outside the area but comfortably inside the 4000×3000 scene — Foundry
        // rejects out-of-bounds positions, which would "pass" these steps for free.
        await forceMove(followers[0].id, anchor.x + 1500, anchor.y + 1200);
        await forceMove(followers[1].id, anchor.x + 1800, anchor.y + 1200);
        await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: INVALID_COLOR });

        // Held, not merely slow to fade: well past the 3s countdown it is still up.
        await gmPage.waitForTimeout(5000);
        expect(await overlay()).toEqual({ present: true, tint: INVALID_COLOR });
        return [followers[0].id, followers[1].id, followers[2].id];
      },
    );

    /** A normal segment update — the path a player's drop takes, guard and all. */
    const reshape = (tokenId: string, x: number, y: number) =>
      gmPage.evaluate(
        async ({ sceneId, tokenId, x, y }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x, y }).catch(() => null);
        },
        { ...ids, tokenId, x, y },
      );

    const moverAt = async () => {
      const s = (await segments()).find((seg) => seg.id === mover)!;
      return { x: s.x, y: s.y };
    };

    // Runs while the layout is still red, so the area is held open and the boundary is
    // guaranteed to be in force — no race against the fade.
    await test.step('a drop outside the area springs the segment back', async () => {
      const anchor = await anchorAt();
      const before = await moverAt();
      const troopBefore = await segments();

      // In-bounds for the scene, so only the area's edge can refuse this.
      await reshape(mover, anchor.x + 1200, anchor.y + 900);

      expect(await moverAt()).toEqual(before);
      // The regression this guards: the troop used to chase the segment out, treating it
      // as a fresh unit move that silently promoted it to anchor.
      expect(await segments()).toEqual(troopBefore);
    });

    // Gather all three around the anchor, so from here only the mover's placement
    // decides whether the layout is legal.
    await test.step('repairing the layout turns it green again', async () => {
      const anchor = await anchorAt();
      await forceMove(mover, anchor.x - step, anchor.y);
      await forceMove(strayA, anchor.x + step, anchor.y);
      await forceMove(strayB, anchor.x, anchor.y - step);
      await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: HATCH_COLOR });
    });

    // Proves the grid-derived footprints really do report a stack — the logic is unit
    // tested, but only real tokens exercise getSize()/getOffsetRange().
    await test.step('stacking one segment on another turns the area red', async () => {
      const anchor = await anchorAt();
      const onTopOfStrayA = { x: anchor.x + step, y: anchor.y };
      await reshape(mover, onTopOfStrayA.x, onTopOfStrayA.y);
      await expect.poll(moverAt, { timeout: 10_000 }).toEqual(onTopOfStrayA);
      await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: INVALID_COLOR });
    });

    // Inside the area, placement is free — the colour tells you when you're done.
    await test.step('a reshape that detaches the segment commits, and goes red', async () => {
      const anchor = await anchorAt();
      // Down-left of the anchor: corner contact only. The other two sit right and above,
      // so nothing bridges this position back into the troop.
      const target = { x: anchor.x - step, y: anchor.y + step };
      await reshape(mover, target.x, target.y);
      await expect.poll(moverAt, { timeout: 10_000 }).toEqual(target);
      // A reshape, not a fresh unit move: the anchor stayed put.
      expect((await anchorAt()).x).toBe(anchor.x);
      await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: INVALID_COLOR });
    });

    await test.step('a valid configuration turns it green and lets it fade', async () => {
      const anchor = await anchorAt();
      const target = { x: anchor.x - step, y: anchor.y };
      await reshape(mover, target.x, target.y);
      await expect.poll(moverAt, { timeout: 10_000 }).toEqual(target);
      await expect.poll(overlay, { timeout: 10_000 }).toEqual({ present: true, tint: HATCH_COLOR });
      await expect.poll(overlay, { timeout: 15_000 }).toEqual({ present: false, tint: null });
    });
  });

  // The preview path: Foundry drags a clone and leaves the document untouched until the
  // drop, so this is the only tier that can prove the warning tracks the cursor.
  test('an in-flight drag turns the area red before any drop', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'drag', { x: 1500, y: 1200 });

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

    // Screen coordinates for a follower, and a destination well beyond the area.
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

    // Only the colour is asserted after the drop. Whether the segment moved is covered
    // deterministically by the document-level "springs back" step in the test above;
    // asserting it here as well passed even with the guard disabled, so it proved nothing.
    await expect.poll(hatchTint, { timeout: 10_000 }).toBe(HATCH_COLOR);
  });

  // The safety valve. A held red area freezes the troop — anchor locked, nobody may leave
  // — so if its squares admit no legal arrangement there would be no way out without this.
  test('Escape dismisses a held area and restores ordinary movement', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'escape', { x: 1000, y: 1000 });

    const segments = (): Promise<Seg[]> =>
      gmPage.evaluate(
        ({ sceneId }) =>
          game.scenes
            .get(sceneId)
            .tokens.filter((t: any) => t.flags?.pf2e?.troop)
            .map((t: any) => ({ id: t.id, x: t._source.x, y: t._source.y })),
        ids,
      );

    const areaPresent = () =>
      gmPage.evaluate(
        (areaName) => (canvas.interface as any).children.some((c: any) => c.name === areaName),
        AREA_NAME,
      );

    const anchorId = (await segments())[0].id;
    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        await tok.update({ x: tok._source.x + 600 });
      },
      { ...ids, tokenId: anchorId },
    );
    await expect.poll(areaPresent, { timeout: 15_000 }).toBe(true);

    // Strand a follower so the area is held open indefinitely rather than fading on its own.
    await test.step('hold the area open with an illegal layout', async () => {
      const anchor = (await segments()).find((s) => s.id === anchorId)!;
      const follower = (await segments()).find((s) => s.id !== anchorId)!;
      await gmPage.evaluate(
        async ({ sceneId, tokenId, x, y }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x, y }, { pf2eTrooperFollow: true } as any);
        },
        { ...ids, tokenId: follower.id, x: anchor.x + 1500, y: anchor.y + 1200 },
      );
      await gmPage.waitForTimeout(4000);
      expect(await areaPresent()).toBe(true);
    });

    await test.step('Escape clears it', async () => {
      await gmPage.keyboard.press('Escape');
      await expect.poll(areaPresent, { timeout: 5000 }).toBe(false);
    });

    // The anchor was immovable a moment ago; with the area gone it moves, and the rest of
    // the troop follows it as an ordinary unit move.
    await test.step('the anchor is released and unit movement works again', async () => {
      const before = await segments();
      const anchor = before.find((s) => s.id === anchorId)!;
      await gmPage.evaluate(
        async ({ sceneId, tokenId }) => {
          const tok = game.scenes.get(sceneId).tokens.get(tokenId);
          await tok.update({ x: tok._source.x + 200 });
        },
        { ...ids, tokenId: anchorId },
      );
      await expect
        .poll(async () => (await segments()).find((s) => s.id === anchorId)!.x, { timeout: 10_000 })
        .toBe(anchor.x + 200);
    });
  });
});
