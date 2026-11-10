import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/foundry-clients';

declare const CONFIG: any;
declare const canvas: any;

interface Seg {
  id: string;
  x: number;
  y: number;
  elevation: number;
}

const AREA_NAME = 'pf2e-trooper:arrange-area';
const HATCH_NAME = 'pf2e-trooper:arrange-hatch';
const WALL_MARKS_NAME = 'pf2e-trooper:arrange-wall-marks';

async function createTroopScene(gmPage: Page, slug: string): Promise<{ sceneId: string }> {
  const created = await gmPage.evaluate(async (slug) => {
    const scene = await CONFIG.Scene.documentClass.create({
      name: `__e2e_follow_${slug}_scene`,
      width: 4000,
      height: 3000,
      grid: { type: 1, size: 100 },
      padding: 0,
    });
    const actor = await CONFIG.Actor.documentClass.create({
      name: `__e2e_follow_${slug}_troop`,
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
    return { sceneId: scene.id as string };
  }, slug);
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

const segments = (gmPage: Page, ids: { sceneId: string }): Promise<Seg[]> =>
  gmPage.evaluate(
    ({ sceneId }) =>
      game.scenes
        .get(sceneId)
        .tokens.filter((t: any) => t.flags?.pf2e?.troop)
        .map((t: any) => ({ id: t.id, x: t._source.x, y: t._source.y, elevation: t._source.elevation }))
        .sort((a: any, b: any) => a.y - b.y || a.x - b.x),
    ids,
  );

const shifted = (before: Seg[], dx: number, dy = 0, dz = 0): Seg[] =>
  before.map((s) => ({ id: s.id, x: s.x + dx, y: s.y + dy, elevation: s.elevation + dz }));

const areaPresent = (gmPage: Page): Promise<boolean> =>
  gmPage.evaluate(
    (areaName) => (canvas.interface as any).children.some((c: any) => c.name === areaName),
    AREA_NAME,
  );

const wallMarkCount = (gmPage: Page): Promise<number> =>
  gmPage.evaluate(
    (name) => (canvas.interface as any).children.find((c: any) => c.name === name)?.children.length ?? -1,
    WALL_MARKS_NAME,
  );

test.describe('Formation follow', () => {
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const s of [...game.scenes].filter((s: any) => s.name.startsWith('__e2e_follow'))) await s.delete();
      for (const a of [...game.actors].filter((a: any) => a.name.startsWith('__e2e_follow'))) await a.delete();
    });
  });

  test('followers cross a wall the leader never touches', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'wall');
    const before = await segments(gmPage, ids);
    const leader = before[0];
    const bottom = Math.max(...before.map((s) => s.y));
    const right = Math.max(...before.map((s) => s.x));

    // Spans only the lower row, so the top-row leader has a clear run.
    await gmPage.evaluate(
      async ({ sceneId, x, y0, y1 }) => {
        await game.scenes.get(sceneId).createEmbeddedDocuments('Wall', [{ c: [x, y0, x, y1] }]);
      },
      { ...ids, x: right + 350, y0: bottom - 50, y1: bottom + 400 },
    );

    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        await tok.update({ x: tok._source.x + 600 });
      },
      { ...ids, tokenId: leader.id },
    );

    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 600));
  });

  test('a move split at a checkpoint carries the whole troop to the end', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'legs');
    const before = await segments(gmPage, ids);
    const leader = before[0];

    const completed = await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        const { x, y } = tok._source;
        return tok.move([
          { x: x + 300, y, checkpoint: true },
          { x: x + 300, y: y + 400 },
        ]);
      },
      { ...ids, tokenId: leader.id },
    );

    expect(completed).toBe(true);
    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 300, 400));
    await expect.poll(() => areaPresent(gmPage), { timeout: 15_000 }).toBe(true);
  });

  test('an elevation change lifts every segment', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'elevation');
    const before = await segments(gmPage, ids);

    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        await game.scenes.get(sceneId).tokens.get(tokenId).update({ elevation: 20 });
      },
      { ...ids, tokenId: before[0].id },
    );

    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 0, 0, 20));
  });

  test('undo puts the whole troop back', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'undo');
    const before = await segments(gmPage, ids);

    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        await tok.update({ x: tok._source.x + 600 });
      },
      { ...ids, tokenId: before[0].id },
    );
    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 600));
    await expect.poll(() => areaPresent(gmPage), { timeout: 15_000 }).toBe(true);

    // The leader's move and the follow are separate history entries.
    await gmPage.evaluate(async () => {
      await canvas.tokens.undoHistory();
      await canvas.tokens.undoHistory();
    });

    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(before);
    expect(await areaPresent(gmPage)).toBe(false);
  });

  test('two quick steps leave no follower a step behind', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'race');
    const before = await segments(gmPage, ids);

    // Each update resolves when the leader lands; its follow is still in flight when the next step goes out.
    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        const { x } = tok._source;
        await tok.update({ x: x + 100 });
        await tok.update({ x: x + 200 });
      },
      { ...ids, tokenId: before[0].id },
    );

    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 200));
  });

  test('segments that would land off the scene close up against the troop', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'edge');
    const before = await segments(gmPage, ids);
    const leader = before[0];

    // The leader stops one segment short of the 4000px edge; the column to its right has no room.
    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        await game.scenes.get(sceneId).tokens.get(tokenId).update({ x: 3800 });
      },
      { ...ids, tokenId: leader.id },
    );

    await expect.poll(() => areaPresent(gmPage), { timeout: 15_000 }).toBe(true);
    const after = await segments(gmPage, ids);
    expect(after.every((s) => s.x >= 0 && s.x + 200 <= 4000 && s.y >= 0 && s.y + 200 <= 3000)).toBe(true);
    expect(new Set(after.map((s) => `${s.x},${s.y}`)).size).toBe(4);
    expect(before.every((b) => after.find((a) => a.id === b.id)!.x !== b.x)).toBe(true);
    // Green means one edge-connected group, nothing stacked, everyone inside the area.
    // The verdict is painted on the ticker, a frame or more after the area opens.
    await gmPage.waitForTimeout(500);
    const tint = await gmPage.evaluate(
      ({ areaName, hatchName }) =>
        (canvas.interface as any).children.find((c: any) => c.name === areaName)?.getChildByName(hatchName)?.tint,
      { areaName: AREA_NAME, hatchName: HATCH_NAME },
    );
    expect(tint).toBe(0x2fe04a);
  });

  test('a segment that lands on a wall is outlined and the area stays green', async ({ gmPage }) => {
    const ids = await createTroopScene(gmPage, 'wallmark');
    const before = await segments(gmPage, ids);
    const last = before[before.length - 1];

    // Inside the bottom-right segment's landing, clear of every other footprint.
    const wallId = await gmPage.evaluate(
      async ({ sceneId, x, y }) => {
        const [wall] = await game.scenes
          .get(sceneId)
          .createEmbeddedDocuments('Wall', [{ c: [x, y - 50, x, y + 50] }]);
        return wall.id as string;
      },
      { ...ids, x: last.x + 600 + 100, y: last.y + 100 },
    );

    await gmPage.evaluate(
      async ({ sceneId, tokenId }) => {
        const tok = game.scenes.get(sceneId).tokens.get(tokenId);
        await tok.update({ x: tok._source.x + 600 });
      },
      { ...ids, tokenId: before[0].id },
    );

    await expect.poll(() => segments(gmPage, ids), { timeout: 15_000 }).toEqual(shifted(before, 600));
    await expect.poll(() => wallMarkCount(gmPage), { timeout: 15_000 }).toBe(1);
    const tint = await gmPage.evaluate(
      ({ areaName, hatchName }) =>
        (canvas.interface as any).children.find((c: any) => c.name === areaName)?.getChildByName(hatchName)?.tint,
      { areaName: AREA_NAME, hatchName: HATCH_NAME },
    );
    expect(tint).toBe(0x2fe04a);

    await gmPage.evaluate(
      async ({ sceneId, wallId }) => {
        await game.scenes.get(sceneId).deleteEmbeddedDocuments('Wall', [wallId]);
      },
      { ...ids, wallId },
    );
    await expect.poll(() => wallMarkCount(gmPage), { timeout: 5_000 }).toBe(0);
  });
});
