# Siege Weapons dataset

Reference data for PF2e siege weapons, one JSON file per weapon. Pulled from
Archives of Nethys (the source PF2e system does **not** ship these as compendium
documents). A faithful capture of the mechanics; the flavor text has been
deliberately de-Paizo'd for ORC compliance (see [Setting-noun renames](#setting-noun-renames)),
so this is **not** a byte-faithful mirror of AoN.

- **Source:** AoN Elasticsearch (`https://elasticsearch.aonprd.com/aon/_search`,
  `category: siege-weapon`), page <https://2e.aonprd.com/SiegeWeapons.aspx>.
- **Count:** 59 canonical siege weapons.

## Curation rules

AoN returns 84 rows; these are pared to 59 canonical weapons:

1. **Dropped pre-remaster duplicates.** Every entry whose `source.book` is the
   non-remastered `"Guns & Gears"` (18 rows) is superseded by a
   `"Guns & Gears (Remastered)"` twin and was discarded. Do **not** re-add them.
2. **Dropped AoN sub-row variants** (ids like `siege-weapon-3-8`). AoN indexes item
   variants as extra search rows; the base document (`siege-weapon-3`) already
   contains them in its `text`. Kept only ids matching `^siege-weapon-\d+$`.
3. **Excluded the Light Mortar** (`siege-weapon-36`). It is an Inventor "Light Mortar
   Innovation," not a fixed siege object — its AC/HP/saves scale continuously with
   the wielding inventor's class DC, Intelligence, and level (only Hardness,
   proficiency rank, and damage dice segment, and on mismatched cadences). It has no
   standalone stat block and doesn't fit the flat-stat model of the other 59.

### Variants live inside their base weapon

- *Battering Ram (covered)* → `battering-ram.json`
- *Adamantine Drilling Ram* (level 11) → `drilling-ram.json`

## Setting-noun renames

Paizo's setting proper nouns are Reserved Material under ORC — they can't ship in
module content. `name`, `slug`, and the flavor prose (`summary`, `text`,
`markdown`) are rewritten to strip them. Mechanics, stats, and action bodies are
untouched. **Re-querying AoN restores the originals — reapply this table.**

| AoN name | Ships as | Stripped |
| --- | --- | --- |
| Alkenstar Cannon | **Great Bronze Cannon** | Alkenstar, Ancil Alkenstar, Mana Waste |
| Jistkan Horn | **Blasting Horn** | Jistka Imperium, Jistkan, Garund |
| Nexian Disgorger | **Fleshforged Disgorger** | Nex, Nexian |
| Stasian Sled | **Galvanic Sled** | Stasian, Ustalav |
| Steelheart 21 | **Hydraulic Cannon** | Brondar Steelheart, Dongun |
| Ustradi Long Cannon | **Long Cannon** | Ustradi, Gunworks, Alkenstar, Maw of Rovagug |

Prose-only (name unchanged): `aquatic-disintegrator`, `blob-paste-propulsor`,
`bolt-emitter`, `cannon`, `clockwork-ballista`, `corrupted-polyp`,
`cyclonic-cannon`, `fists-of-divinity`, `flute-rocket`, `glacial-zephyr`,
`sigilstone-slinger`, `volley-gun`, `web-launcher`, `wolf-fang`.

Two notes worth knowing:

- **`teekdoon` is not an offender.** It looks like a setting noun but its own text
  explains it as onomatopoeia for a peregrine falcon's diving takedown.
- **`bolt-emitter`'s description is ours.** AoN ships no description for it, and its
  `summary` was the literal "Nethys Note: No description has been provided…"
  boilerplate — which was reaching players as the actor description. Replaced with a
  sentence derived from its own stat block.

`source.book` / `aonId` / `aonUrl` are **kept**: they ship as `publication.title`
with `license: 'ORC'`, which is the attribution ORC requires.

### Consumers

`scripts/build-siege-weapon-pack.ts` turns these files into the `siege-weapons`
compendium. pf2e-reignmaker prices the same weapons for its kingdom economy in
`src/data/siegeWeapons/costs.json`, and its `siegeWeaponCosts` unit spec reads
*this* directory out of a sibling Trooper checkout to catch a name or level
drifting apart. A rename has to land in both repos.

## Field notes

- `text` — human-readable stat block (HTML/markdown tags stripped).
- `markdown` — AoN's structured markdown, kept because it delimits actions
  (`<actions string="Two Actions" />`) for future parsing.
- `defenses` omits keys the weapon genuinely lacks — portable rams, for instance,
  have no AC/HP.

## Regenerating

Re-query the AoN endpoint and re-run the build (script in session scratchpad).
Applying the three curation rules above must yield 59 files.
