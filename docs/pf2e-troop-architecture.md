# PF2e system troop support — architecture notes

Diagnosis of how the Pathfinder 2e system (source: `_pf2e-source`, v8.4.0) implements
troop actors: how the four tokens get spawned, what actually links them, what syncs and
what doesn't, and where `pf2e-trooper` can hook in.

**TLDR:** A troop is one NPC actor whose drop onto a scene fans out into up to four
**unlinked** tokens ("segments"). Each segment is its own independent synthetic actor
(ActorDelta). They are tied together only by a shared token flag (`flags.pf2e.troop.id`)
plus a handful of explicit, narrow sync mechanisms: HP and elite/weak adjustment are
propagated actor-to-actor on update; HP-affecting rule elements are "poached" from
siblings during data prep; and combat uses one shared token-less combatant. **Nothing
else is shared** — spell slots, focus points, conditions, effects, and item changes stay
per-segment. There is **no selection linking and no drag/movement sync anywhere in the
system** — those simply don't exist yet, which is the gap this module can fill.

---

## 1. What makes an actor a troop

An NPC becomes a troop mechanically when it has the `troop` trait and at least 3 max HP.
During data preparation the system computes **HP thresholds**:

`src/module/actor/npc/document.ts:218-229` (`prepareDerivedData`):

```ts
system.attributes.hp.thresholds = null;
if (this.system.traits.value.includes("troop") && hpMax >= 3) {
    system.attributes.hp.thresholds = [
        { hp: hpMax,                    segments: 4 },
        { hp: Math.floor(hpMax * 2/3),  segments: 3 },
        { hp: Math.floor(hpMax / 3),    segments: 2 },
    ];
    this.system.traits.size.wide = 10;
    this.system.traits.size.long = 10;
}
```

Key consequences:

- `hp.thresholds` (a derived, never-stored field) is the system's universal "is this a
  troop?" test — everywhere else checks `actor.system.attributes.hp.thresholds` rather
  than the trait directly.
- The actor's size is forced to **10 ft × 10 ft**, so each segment token is 2×2 squares
  (`src/module/scene/token-document/sheets/mixin.ts:38-41` hard-codes `2` for actors
  with thresholds). Four segments × 4 squares = the troop's full 16-square footprint.
- Troops are excluded from being flanked (`npc/document.ts:109`).
- The NPC sheet renders the thresholds as a selectable HP-threshold display
  (`src/module/actor/npc/sheet.ts:254-266`).

## 2. The drop: how four tokens spawn

`TokenDocumentPF2e._preCreate` — `src/module/scene/token-document/document.ts:608-636`:

1. If the created token's actor is an NPC **with thresholds** and the token does **not**
   already carry the troop flag (this is the recursion guard):
2. It builds the troop identity:
   ```ts
   const troop = { id: this.actorLink ? actor.id : fu.randomID(), linked: this.actorLink };
   this._source.actorLink = false;   // troop tokens are ALWAYS unlinked
   this._source.flags = fu.mergeObject(this._source.flags, { pf2e: { troop } });
   ```
3. It counts how many segments the actor's *current* HP entitles it to
   (`thresholds.findLast(t => t.hp >= hp.value)?.segments`, clamped 1–4) and creates
   the extra N−1 tokens via `scene.createEmbeddedDocuments("Token", ...)` (fire-and-
   forget, not awaited). Each is a `this.toObject()` copy carrying the **same troop
   flag**, offset in a 2×2 pattern: `[1,0], [0,1], [1,1]` × the token's pixel width.
4. The clones re-enter `_preCreate` but skip step 1 because the flag is present.

Also enforced:

- `_preUpdate` re-forces `actorLink = false` on any update to a troop token
  (`document.ts:652-655`). Note the guard requires `this.object` (a rendered canvas
  object), i.e. it only applies on the viewed scene — the changelog entry "Fix troop
  creation in unviewed scenes" relates to this area.
- The troop flag is actively stripped from **prototype** tokens so it never persists
  onto the world actor (`src/module/actor/base.ts:1859-1863`).
- `_onCreate` (`document.ts:668-679`) batch-resets sibling actors when segments appear,
  so each segment's data prep re-runs with knowledge of its new siblings (via a
  debounced `ResetBatch`, `src/module/actor/npc/reset-batch.ts`).

### The troop flag (the only real "link")

`src/module/scene/token-document/data.ts`:

```ts
troop?: {
    id: string;       // world actor id if dropped linked, else a fresh randomID per drop
    linked: boolean;  // whether the drop came from a linked prototype token
};
```

- **Unlinked drop:** each drop mints a new `randomID()` → each drop is its own troop.
- **Linked drop:** `id = actor.id` → *every* linked drop of that actor shares one troop
  id. `linked` is used only to (a) relax the same-scene restriction when resolving a
  combatant (`document.ts:39-50`) and (b) build the dedup key at combatant creation
  (`document.ts:480`). The comment in `data.ts` says a linked troop "may need to update
  a world actor's HP", but **no such write-back exists in the code** — the flag is
  recorded and never used for HP. Also note: dropping the same linked troop actor twice
  onto one scene produces *eight* tokens sharing one troop id and one combatant — a
  latent oddity worth knowing about.

## 3. Actor model: why linking feels unreliable

Because every segment is forced unlinked, each one is a **synthetic token actor** — the
world actor plus that token's private `ActorDelta`. Four segments = four independent
actor instances that merely start out identical. Everything that *is* shared is an
explicit, hand-written sync path:

| Data | Shared? | Mechanism |
|---|---|---|
| HP (`system.attributes.hp`) | ✅ | `NPCPF2e._preUpdate` copies the changed `hp` object to every sibling with a `fromTroop: true` recursion guard (`npc/document.ts:544-560`) |
| Elite/Weak (`system.attributes.adjustment`) | ✅ | same propagation path |
| HP-affecting rule elements (e.g. Drained) | ✅ (max HP only) | during HP prep each segment **extracts `hp` modifiers from siblings' synthetics** ("Grab HP", `npc/document.ts:200-202`); `ScenePF2e.view` resets all troop actors on scene change so this poaching stays current (`scene/document.ts:120-131`) |
| Data-prep freshness | ✅ | any actor update or embedded-item change on one segment triggers a debounced `reset()` of siblings (`npc/document.ts:571-587`) — a re-*prepare*, not a data copy |
| Spell slots / focus points | ❌ | live on embedded spellcasting-entry items / `system.resources`, never propagated |
| Conditions & effects | ❌ | embedded items on one delta only (their *HP side-effects* reach siblings via poaching; the condition itself doesn't) |
| Any other item edit | ❌ | per-segment delta |
| Token position/selection | ❌ | nothing exists |

**This precisely explains your observations:** HP "seems shared" because it has a
dedicated propagation hook; spell lists aren't because nothing copies embedded-item
state between the four deltas. It's not one flaky link — it's four separate actors with
exactly two whitelisted sync channels.

The sibling list itself is `NPCPF2e.otherSegments`, resolved in `prepareBaseData` from
the token's `segments` getter (`npc/document.ts:91-93`), which is "all other tokens in
this scene with my troop id" (`token-document/document.ts:59-64`).

## 4. Combat integration

Troops use a single **token-less combatant** per troop:

- `TokenDocumentPF2e.createCombatants` (`document.ts:468-510`) filters troop tokens out
  of normal combatant creation, dedupes them by troop id, and creates one combatant with
  no `tokenId` — just `flags.pf2e.troop = <troopId>` and a `sceneId`.
- `CombatantPF2e.tokens` (`src/module/encounter/combatant.ts:116-124`) resolves that
  flag back to every segment token in the scene; `combatant.actor` and
  `combatant.token` fall back to the **first segment** (`combatant.ts:108-114`), which
  is what initiative rolls use.
- `TokenDocumentPF2e.combatant` does the reverse lookup so any segment finds the shared
  combatant (`document.ts:38-50`).
- Turn markers render on **all** segments (`src/module/canvas/token/object.ts:173-194`,
  `src/module/encounter/document.ts:231-243`); the tracker pings all segments
  (`src/module/apps/sidebar/encounter-tracker.ts:285-296`) and hides the effects strip
  for troop combatants (`encounter-tracker.ts:56`).
- End-of-turn events (persistent damage, effect expiry) run **once per segment**
  (`combatant.ts:164-198`) — deliberate, since conditions live per-segment.
- Deleting segments: the delete-key confirm is suppressed unless you're deleting the
  whole troop / a combatant (`src/module/canvas/layer/token.ts:28-52`); when the *last*
  segment dies, `_onDeleteOperation` cleans up the orphaned troop combatant
  (`document.ts:523-548`).

### Damage application

`applyDamageFromMessage` (`src/module/chat-message/helpers.ts:112`) dedupes the user's
selected tokens by troop id, so damage with all four segments selected applies **once**;
HP propagation then mirrors it to the other three. Threshold crossing is detected in
`ActorPF2e.applyDamage` (`src/module/actor/base.ts:1213-1218`, `:1330`) and produces
only a **chat message** — "The troop has reached their next threshold ({segments}
segments remaining)". **The system never removes segment tokens automatically**; per
RAW the attacker chooses which segment dies, so that's left to the GM. Segment count is
only auto-derived from HP at *drop time*.

## 5. What does NOT exist (the gaps this module targets)

1. **Selection linking** — no code anywhere controls sibling tokens when one is
   selected. `TokenLayerPF2e` and `TokenPF2e` touch troops only for turn markers and
   the delete warning.
2. **Movement/drag sync** — nothing moves segments together or enforces the RAW
   contiguity rule ("segments must share an edge"; the troop-movement rules are shipped
   only as journal text, `static/lang/en.json` `TroopMovement`).
3. **Spell/resource sync** — slots, focus points, and item state diverge freely across
   segments.
4. **Condition sync** — applying Frightened to one segment leaves the others untouched
   (only HP-relevant rule elements cross over).
5. **Automatic segment removal at thresholds** — chat message only.
6. **Linked-actor HP write-back** — `troop.linked` is stored but the promised world-
   actor HP update is unimplemented.
7. **Linked double-drop collision** — two linked drops of the same actor merge into one
   troop id (see §2).

## 6. Hook points for pf2e-trooper

Useful primitives the system already exposes:

- **Identity:** `token.flags.pf2e.troop?.id` (read via `token.flags` — it's a plain
  flag, so `getFlag("pf2e", "troop")` also works), `tokenDoc.segments` (sibling token
  docs), `npcActor.otherSegments` (sibling actors), `combatant.tokens`.
- **Recursion guard convention:** the system passes `{ fromTroop: true }` in the update
  operation when it propagates; a module doing its own propagation should use the same
  trick (its own flag) to avoid loops, and can *check* `options.fromTroop` to ignore
  system-originated echoes.
- **Selection:** hook `controlToken` — on control, call `.control({ releaseOthers:
  false })` on sibling `token.object`s (with a re-entrancy guard). Release side via the
  same hook's `controlled=false` branch.
- **Drag sync:** hook `preUpdateToken`/`updateToken` for `x`/`y` changes on a troop
  token and apply the same delta to `segments` in one
  `scene.updateEmbeddedDocuments("Token", ...)` batch (guarded so segment updates don't
  cascade). Foundry v13+ movement API (`movementAction`, update `_movement`) is worth
  checking for animation-friendly follow movement.
- **Spell/resource sync:** hook `updateItem`/`createItem`/`deleteItem` where
  `item.actor` is a troop segment and mirror the change to `otherSegments` — e.g.
  spellcasting-entry `system.slots` updates and `system.resources.focus`. Alternatively
  the cleaner (bigger) fix: route all segment sheets to one designated "primary"
  segment actor.
- **Turn events:** `pf2e.startTurn` / `pf2e.endTurn` hooks fire with the shared
  combatant.
- **Data prep freshness:** after mirroring anything, follow the system's `ResetBatch`
  pattern (debounced `actor.reset(); actor.render()`) rather than resetting eagerly.

## 7. Decision: build on top, don't replace

Considered and rejected: suppressing the system implementation and shipping our own.

**Why not replace.** The troop behavior is keyed off `flags.pf2e.troop` and derived
`hp.thresholds` across ~14 files (data prep, token lifecycle, combat, tracker, canvas,
chat). Suppressing it means either nulling `hp.thresholds` (which also kills the 10×10
sizing, sheet display, and segment-count logic) or libWrapper-overriding many system
internals that have no API stability and change with the system's frequent releases.
We'd then have to rebuild what already works — shared combatant, turn markers, damage
dedup, per-segment turn events, combatant cleanup — and would desync from anything else
that expects standard troop behavior.

**Why augmenting is the stronger position.** Every feature we want is additive — the
system occupies none of that space (see §5): selection linking, drag-follow, item/
resource sync, threshold automation are all pure hook-layer additions with nothing to
fight. The narrow HP-only sync channel doesn't conflict with a broader mirror layer,
and the sibling `ResetBatch` refreshes derived data for free after we write.

**The delta model is the right substrate.** RAW wants per-segment saves for area
effects and per-segment persistent damage, but unit-level spell slots — so "what is
shared" must be chosen per data type. A sync layer allows that; the "clean" alternative
(four linked tokens on one world actor) forces everything shared and collapses when two
troops of the same creature share a scene.

**Safety rails for depending on system internals:**

- Feature-detect (`hp.thresholds`, `flags.pf2e.troop`) — never assume.
- Reuse system primitives (`segments`, `otherSegments`, `combatant.tokens`) instead of
  re-deriving them.
- Guard all our propagation with our own `fromTrooper`-style operation flag; ignore
  echoes carrying the system's `fromTroop`.
- Targeted wraps only for behavior that must *change* (linked double-drop collision,
  HP write-back), never wholesale replacement.
- An e2e canary spec (Playwright tier) asserting the system behaviors we depend on —
  drop spawns N segments, HP propagates, flag shape — so a pf2e update breaks loudly.

## 8. File map (all under `_pf2e-source/src/module/`)

| File | Troop responsibility |
|---|---|
| `actor/npc/document.ts` | thresholds, forced 10×10 size, `otherSegments`, HP-modifier poaching, HP/adjustment propagation, sibling reset batching |
| `actor/npc/reset-batch.ts` | debounced dedup'd `actor.reset()` |
| `actor/base.ts` | threshold-crossing detection + chat message on damage; strips troop flag from prototype tokens |
| `scene/token-document/document.ts` | segment spawning on drop, forced unlink, troop→combatant resolution, `segments` getter, combatant create/delete overrides |
| `scene/token-document/data.ts` | `TroopFlags` type (`id`, `linked`) |
| `scene/token-document/sheets/mixin.ts` | 2×2 token dimensions for troops |
| `scene/document.ts` | reset troop actors on scene view (rule-element poaching freshness) |
| `encounter/combatant.ts` | token-less troop combatant, `tokens` getter, per-segment end-turn events |
| `encounter/document.ts` | turn markers across segments |
| `apps/sidebar/encounter-tracker.ts` | ping all segments, hide effects strip |
| `canvas/token/object.ts` | turn marker on every segment |
| `canvas/layer/token.ts` | delete-key warning suppression for partial-troop deletes |
| `chat-message/helpers.ts` | damage dedup by troop id |
| `actor/npc/sheet.ts` | threshold display on NPC sheet |

## 9. pf2e-trooper phase 1 — full sync + Troop Reduced (implemented)

Design decision: segments should behave **as though linked** — what applies to one
applies to all, sharing one resolution. Implemented in `src/troops/`:

### Sync layer (`src/troops/sync.ts`) — record-then-reconcile

The first implementation mirrored per-event from inside the hooks and **failed in
live Foundry v14**: writes issued mid-hook-cascade against synthetic actors raced
Foundry's own workflow, and concurrent `keepId` creates collided on the wrong
ActorDelta (`_id already exists within ActorDelta […]`), leaving some segments
unsynced. The shipped design is immune by construction:

- **Hooks never write.** `updateActor` / `createItem` / `updateItem` / `deleteItem`
  only *queue* the troop for reconciliation (recording the originating segment as the
  authority, plus any persisted `system` diff minus `attributes.hp`/`adjustment`,
  which the pf2e system propagates itself, and `_migration`).
- **A debounced (60 ms), serialized reconciler** then re-resolves every token and
  actor fresh from the scene and converges each sibling onto the leader:
  accumulated system diffs first, then `planItemReconcile` (pure, in `logic.ts`)
  diffs item sources into batched create/update/delete — conditions, effects,
  spell-slot and focus expenditure, anything. It never plans a `keepId` create for
  an id the sibling already has (the exact server error from the mirror design),
  and no-ops when states already match, so duplicate events and races converge
  instead of colliding.
- Guards: only the initiating client queues (`userId === game.user.id`); reconciler
  writes carry `pf2eTrooperSync` in the operation options and are skipped, as are the
  system's own `fromTroop` echoes.
- **Exceptions** (invisible to the reconcile plan in both directions):
  - `flags.pf2e.grantedBy` items (GrantItem rule-element children): the mirrored
    *granting* item re-grants them locally on each segment; mirroring the children too
    would duplicate them.
  - `persistent-damage`: the system runs end-of-turn events per segment, so a mirrored
    persistent-damage condition would tick 4× against the shared HP pool. It stays
    per-segment (same behavior as stock pf2e).

### Troop Reduced automation (`src/troops/thresholds.ts` + `packs/troop-effects`)

Two unlimited-duration effect items — **Troop Reduced (3 Segments)** (`pmtTroopReduced3`)
and **(2 Segments)** (`pmtTroopReduced2`) — in the `pf2e-trooper.troop-effects`
compendium, each carrying a `RollOption` (`troop:segments:N`) for future automation.

- `updateActor` watcher: when a primary (non-echo) HP change drops a segment's HP
  across a threshold, the matching effect is applied to that segment (replacing a
  lesser one); the sync layer mirrors it to the rest. A GM-whispered chat message
  reports the new cap.
- `preUpdateActor` cap: while a reduced effect is present, `hp.value` is clamped to
  the threshold — healing cannot exceed the unit's new effective max. The effect is
  unlimited-duration, so status persists between encounters; recovery = the GM removes
  the effect after downtime (long-term treatment / recruitment), which the sync layer
  mirrors too.
- **Deliberately no max-HP rule element** on the effects: pf2e derives the threshold
  ladder from *modified* max HP (`npc/document.ts:219`), so an RE reducing max would
  shift the ladder (e.g. 90-max troop at 60 HP would count as 4 segments again) and
  corrupt both segment counts and the cap. Clamping `hp.value` leaves the ladder
  canonical. Displayed max HP therefore stays at the original value — revisit only if
  the ladder derivation ever changes.

### Test coverage

Everything decision-shaped lives as pure functions in `src/troops/logic.ts` — ladder
math, status/cap resolution, diff stripping, `planItemReconcile`, `followMoves`, grid
adjacency — covered by the vitest tier (`src/tests/unit/troop-logic.test.ts`,
`troop-sync.test.ts`), including regression tests for both live-debugged v14 failures
(the prepared-x zero-delta and the keepId-collision create). The integration truth is
`src/tests/e2e/troops.spec.ts` (Playwright against a real Foundry + pf2e): drop spawns
4 segments, condition reconciles to all, unit move preserves offsets, threshold
applies Troop Reduced everywhere, and healing clamps at the cap. Run with
`npm run test:e2e` — needs the licensed local Foundry, and the test world can't be
open in another client at the same time.

### Formation movement (`src/troops/formation.ts`)

Design decision (re-revised): **movement plus selection dedupe**. An earlier
iteration deduplicated selection to one segment per troop, was removed as
apparently redundant, then restored: with several segments controlled, a drag is a
*native* multi-token move — every piece gets its own ruler, no segment is the
leader, so no formation follow and no advisory area. Dedupe (`controlToken`: on
control, release any other controlled segment of the same troop — newest wins)
guarantees the leader+follow path is the only way a troop moves. The
"siblings moved in the same operation" guard below stays as a backstop for
batch updates from macros or other clients.

- **Formation follow** (`preUpdateToken` + `updateToken`): when a segment moves
  (drag, arrow keys, or an undo), the pre-update hook stashes its prior position in
  the operation options **keyed by token id** — the options object is shared by every
  document in one operation, so an unkeyed stash would be clobbered when two troops
  move in the same drag. The post-update hook computes the delta and applies it to
  every sibling in one `updateEmbeddedDocuments` batch, preserving the formation's
  relative offsets. Guards: only the initiating client acts; follower moves carry
  `pf2eTrooperFollow` and are ignored; a per-operation troop-id ledger handles each
  troop once per operation; and siblings that moved **in the same operation** (a
  native multi-token drag) are excluded from follow — Foundry already moved them, so
  a rubber-band drag of the whole troop is a plain native move, not a double
  translation.
- **Foundry v14 gotcha (live-debugged):** during the movement pipeline, a token
  document's *prepared* `x`/`y` lags `_source` — at `updateToken` time it still reads
  the pre-move position, so a delta computed from `doc.x` is zero and the follow
  silently never fires. All deltas therefore come from the update's `changed` payload
  against the stashed prior (`followMoves` in `logic.ts`), and follower/overlay
  positions read `_source.x/y`, never the prepared values.

### Advisory area (`src/troops/arrange.ts`)

RAW troop movement is two-phase: one segment leads, then the rest regroup around it
as the player sees fit. The module maps that onto a **timed mode switch** — no
keybinding, no toggle button:

1. A drag is normally a **unit move**: the formation follows rigidly, then the
   advisory area paints — everywhere the remaining segments could legally end up,
   under **both** RAW constraints:
   - *Movement*: "none of them moves farther than the moving segment" — each
     remaining segment's budget is the leader's spent movement, measured from its
     own pre-move origin with the scene grid's real diagonal rule via
     `canvas.grid.measurePath` (PF2e's 5-10-5 — hence the stepped edges).
   - *Attachment*: segments "must share at least 5 feet of one of their edges" with
     the troop, chains through other segments allowed — so the area grows outward
     from the moved segment's final position through **budget-valid** placements
     only (a bridge must itself be legally placeable), at most one adjacency layer
     per remaining segment. This keeps the area anchored to the troop no matter
     how far the drag was — it can never spread across the map.

   Rendered as two PIXI containers on `canvas.interface` (which sorts children by
   `zIndex`): the hatch-textured area — a `TilingSprite` masked to the area's
   squares with a border stroked only along its outer edge — sits **beneath** the
   tokens, while the amber **anchor marker** — outlining the moved segment at its
   final position, the piece the rest of the troop regroups around — gets its own
   container z-indexed **above** the token layer, so it reads through the token
   sitting on it. Both are drawn once when the area opens and **never redraw**
   while segments are repositioned.
2. While the area is **visible** (default 3 s + 0.5 s fade, world setting
   `arrangeSeconds`), the anchor is **locked**: drags of it are cancelled in
   `preUpdateToken` (with a warning toast), since the regroup is defined relative
   to where it stopped. Any other segment's drag destination disambiguates:
   landing **inside** the shaded squares repositions only that segment and resets
   the countdown; landing **outside** is a fresh unit move — so you're never stuck
   waiting for the fade to move the unit again.
3. At expiry the overlay fades (0.5 s), the anchor unlocks, and every drag is a
   unit move again.

The area math is pure and vitest-covered in `logic.ts`: `reachablePlacements`
(budget union with the diagonal rule injected), `attachablePlacements` (the
edge-sharing BFS from the leader), and `footprintCells`; `sharesEdge` /
`isContiguous` / `adjacentPlacements` remain for contiguity work. The straight-line
prior→final distance stands in for the drag's true path length, and enumeration caps
at 30 squares. One area exists at a time (moving another troop replaces it);
gridless/hex scenes skip the overlay, so drags there are always unit moves; the
overlay tears down with the canvas.

**Advisory by design** (a deliberate scope decision): the hatching visualizes the
RAW limit — followers regroup adjacent to the moved segment, and "none of them moves
farther than the moving segment" — but follower placement is never blocked or
validated. It doesn't prevent an off-pattern drop, doesn't wall-test candidates,
doesn't track occupancy, and doesn't measure the distance budget. The GM
adjudicates; the module just paints the reference. The single hard rule is the
anchor lock above — the area's geometry is meaningless if its reference point moves.

Next: threshold-driven segment removal.
