import { test, expect, MODULE_ID } from './fixtures/foundry-clients';

// Dropping a published troop on a map, with no ReignMaker in the world: the token should come
// out wearing its art without anyone being asked. drop-art.test.ts proves the decision; this
// proves the wiring — the preCreateToken source edit, the actor portrait write, the world
// setting, and standing aside when ReignMaker claims the scene.

declare const CONFIG: any;

const ART = 'modules/pf2e-trooper/assets/troops/official/bandit-gang/bandit-gang';
const created: { sceneIds: string[]; actorIds: string[] } = { sceneIds: [], actorIds: [] };

// The lookup is by name, so the actor can't carry an __e2e_ prefix; ids drive the cleanup.
const newTroopActor = `async () => {
    const actor = await CONFIG.Actor.documentClass.create({
        name: 'Bandit Gang',
        type: 'npc',
        system: { traits: { value: ['troop'], rarity: 'common', size: { value: 'grg' } } },
    });
    return actor.id;
}`;

test.describe('a troop dropped on a map', () => {
    test.afterAll(async ({ gmPage }) => {
        await gmPage.evaluate(async (ids) => {
            await game.settings.set('pf2e-trooper', 'dropArt', 'tactical');
            for (const id of ids.sceneIds) await game.scenes.get(id)?.delete();
            for (const id of ids.actorIds) await game.actors.get(id)?.delete();
        }, created);
    });

    test('is dressed silently, follows the world setting, and defers to ReignMaker', async ({ gmPage }) => {
        const sceneId = await gmPage.evaluate(async () => {
            const scene = await CONFIG.Scene.documentClass.create({
                name: '__e2e_art_scene',
                width: 4000,
                height: 3000,
                grid: { type: 1, size: 100 },
                padding: 0,
            });
            return scene.id as string;
        });
        created.sceneIds.push(sceneId);

        const actorId = await gmPage.evaluate((src) => new Function(`return (${src})`)()(), newTroopActor);
        created.actorIds.push(actorId);

        const place = (aid: string, x: number) =>
            gmPage.evaluate(
                async ({ sid, aid, x }) => {
                    const scene = game.scenes.get(sid);
                    const tokenDoc = await game.actors.get(aid).getTokenDocument({ x, y: 1000 });
                    const [placed] = await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
                    return placed.texture.src as string;
                },
                { sid: sceneId, aid, x }
            );

        expect(await place(actorId, 1000), 'tactical piece by default').toBe(`${ART}_token.webp`);

        // The portrait write is fire-and-forget so it can't block the drop.
        await expect
            .poll(() => gmPage.evaluate((id) => game.actors.get(id).img as string, actorId))
            .toBe(`${ART}_portrait.webp`);

        await gmPage.evaluate(() => game.settings.set('pf2e-trooper', 'dropArt', 'strategy'));
        expect(await place(actorId, 2000), 'strategy piece once the world asks for it').toBe(
            `${ART}_strategy.webp`
        );

        // No ReignMaker in this world, so its claim is stubbed. The live cross-module case runs in
        // ReignMaker's own harness, where both modules are installed. A fresh actor, so what's
        // asserted is "still undressed" rather than "kept what an earlier drop gave it".
        const undressedId = await gmPage.evaluate((src) => new Function(`return (${src})`)()(), newTroopActor);
        created.actorIds.push(undressedId);

        const deferredSrc = await gmPage.evaluate(
            async ({ sid, aid }) => {
                const modules = game.modules as any;
                const real = modules.get.bind(modules);
                modules.get = (id: string) =>
                    id === 'pf2e-reignmaker'
                        ? { id, active: true, api: { isKingdomScene: () => true } }
                        : real(id);
                try {
                    const scene = game.scenes.get(sid);
                    const tokenDoc = await game.actors.get(aid).getTokenDocument({ x: 3000, y: 1000 });
                    const [placed] = await scene.createEmbeddedDocuments('Token', [tokenDoc.toObject()]);
                    return placed.texture.src as string;
                } finally {
                    modules.get = real;
                }
            },
            { sid: sceneId, aid: undressedId }
        );

        expect(deferredSrc, 'untouched on a ReignMaker kingdom scene').not.toContain('pf2e-trooper');
        expect(
            await gmPage.evaluate((id) => game.actors.get(id).img as string, undressedId),
            'and its portrait left alone'
        ).not.toContain('pf2e-trooper');
    });

    test('registers the drop-art setting on this module', async ({ gmPage }) => {
        const setting = await gmPage.evaluate(
            (id) => game.settings.settings.get(`${id}.dropArt`)?.default,
            MODULE_ID
        );
        expect(setting).toBe('tactical');
    });
});
