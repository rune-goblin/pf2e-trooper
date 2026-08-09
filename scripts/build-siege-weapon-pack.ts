// Generate packs/_source/siege-weapons/*.json — one pf2e `vehicle` actor per siege weapon in
// data/siege-weapons/. Run by `npm run build` ahead of scripts/pack.ts, which compiles the
// result into the LevelDB module.json registers.
//
// `vehicle` is chosen over npc/hazard because the vehicle schema natively carries
// Space/Crew/Speed/Hardness/Broken Threshold/object immunities — a 1:1 match for the AoN siege
// weapon stat block. A weapon's activities (Aim, Load, Launch, Ram, …) are parsed out of the AoN
// markdown into discrete `action` items with their own action costs; mounted weapons that list a
// Speed also get the standard Guns & Gears "Move Siege Weapon" activity.
//
// The vehicle model only stores a Fortitude save, so the weapon's own Reflex save and the rest of
// the siege metadata (proficiency, ammunition, AoN provenance) are kept losslessly in
// flags['pf2e-trooper']['siege-weapon']. pf2e-reignmaker reads that flag to recognize a siege
// vehicle on its kingdom map.
//
// This generator is the only writer of packs/_source/siege-weapons/ — regenerate, never hand-edit.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = join(ROOT, 'data', 'siege-weapons');
const OUT_DIR = join(ROOT, 'packs', '_source', 'siege-weapons');
const ART_DIR = join(ROOT, 'assets', 'siege-engines');
const DEFAULT_VEHICLE_IMG = 'systems/pf2e/icons/default-icons/vehicle.svg';
const missingArt: string[] = [];

/** 16-char [A-Za-z0-9] Foundry id, deterministic from the seed so the compendium UUID is stable. */
function stableDocId(seed: string): string {
  return createHash('sha1').update(seed).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
}

/**
 * One flat image per weapon fills all three slots: sheet portrait, battle token, and
 * kingdom-map strategy piece (ReignMaker's map hook shrinks it to one hex regardless of size).
 */
function artFor(slug: string): string {
  if (!existsSync(join(ART_DIR, `${slug}.webp`))) {
    missingArt.push(slug);
    return DEFAULT_VEHICLE_IMG;
  }
  return `modules/pf2e-trooper/assets/siege-engines/${slug}.webp`;
}

interface WeaponData {
  name: string;
  slug: string;
  level?: number;
  rarity?: string;
  siegeWeaponCategory?: string;
  proficiency?: string;
  size?: string[];
  usage?: string;
  price?: string;
  ammunition?: string;
  crew?: string;
  space?: string;
  speed?: string;
  summary?: string;
  markdown?: string;
  defenses?: {
    ac?: number;
    fortitudeSave?: number | string;
    reflexSave?: number | string;
    hardness?: number;
    hp?: number;
  };
  source?: { book?: string; page?: string; aonId?: string; aonUrl?: string };
}

const SIZE_CODES: Record<string, string> = {
  Tiny: 'tiny',
  Small: 'sm',
  Medium: 'med',
  Large: 'lg',
  Huge: 'huge',
  Gargantuan: 'grg',
};
const COST_IMG: Record<string, string> = {
  '1': 'systems/pf2e/icons/actions/OneAction.webp',
  '2': 'systems/pf2e/icons/actions/TwoActions.webp',
  '3': 'systems/pf2e/icons/actions/ThreeActions.webp',
  reaction: 'systems/pf2e/icons/actions/Reaction.webp',
  free: 'systems/pf2e/icons/actions/FreeAction.webp',
  passive: 'systems/pf2e/icons/actions/Passive.webp',
};
const ACTION_TRAITS = new Set(['attack', 'manipulate', 'concentrate', 'move', 'flourish', 'open', 'press', 'reckless']);

interface ActionCost {
  actionType: string;
  actions: number | null;
}

/** "Single Action" → {actionType:'action', actions:1}; Reaction/Free → null count. */
function parseCost(str: string): ActionCost {
  const s = (str || '').toLowerCase();
  if (s.includes('reaction')) return { actionType: 'reaction', actions: null };
  if (s.includes('free')) return { actionType: 'free', actions: null };
  if (s.includes('single') || s.includes('one')) return { actionType: 'action', actions: 1 };
  if (s.includes('two')) return { actionType: 'action', actions: 2 };
  if (s.includes('three')) return { actionType: 'action', actions: 3 };
  return { actionType: 'action', actions: null };
}

/** AoN inline markdown → sanitized HTML fragment (links flattened to their label). */
function inlineToHtml(md: string | undefined): string {
  let s = md ?? '';
  s = s.replace(/<actions\s+string="[^"]*"\s*\/>/g, '');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // [label](url) -> label
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/<br\s*\/?>/g, ' ');
  s = s.replace(/<\/?(?:title|traits|trait|column|row)[^>]*>/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
  return s;
}

const DMG_TYPES = 'bludgeoning|piercing|slashing|fire|cold|acid|electricity|lightning|sonic|force|mental|poison|spirit|void';
const SAVES = new Set(['reflex', 'fortitude', 'will']);
const SKILLS =
  'athletics|acrobatics|arcana|crafting|deception|diplomacy|intimidation|medicine|nature|occultism|performance|religion|society|stealth|survival|thievery|perception';
// Plural counts: a weapon that drops two 10-foot bursts still deals area damage.
const AREA_RE = /\b(burst|cone|emanation|line|blast|explosion)s?\b/i;

/** Turn "5d10 bludgeoning … DC 22 Reflex" into clickable @Damage / @Check enrichers. */
function enrichCombat(text: string): string {
  let s = text;
  s = s.replace(
    new RegExp(`\\b(\\d+d\\d+)\\s+persistent\\s+(${DMG_TYPES})\\b`, 'gi'),
    (_m, dice: string, type: string) =>
      `@Damage[${dice}[persistent,${type.toLowerCase() === 'lightning' ? 'electricity' : type.toLowerCase()}]]`,
  );
  s = s.replace(
    new RegExp(`\\b(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+(${DMG_TYPES})\\b`, 'gi'),
    (_m, dice: string, type: string) =>
      `@Damage[${dice.replace(/\s+/g, '')}[${type.toLowerCase() === 'lightning' ? 'electricity' : type.toLowerCase()}]]`,
  );
  s = s.replace(
    new RegExp(`\\bDC\\s+(\\d+)\\s+(basic\\s+)?(${[...SAVES].join('|')}|${SKILLS})\\b`, 'gi'),
    (_m, dc: string, basic: string | undefined, type: string) => {
      const slug = type.toLowerCase();
      const opts = [slug, `dc:${dc}`];
      if (SAVES.has(slug)) {
        if (basic) opts.push('basic');
        if (AREA_RE.test(text)) opts.push('options:area-effect');
      }
      return `@Check[${opts.join('|')}]`;
    },
  );
  // Damage the dice-type rule can't see: "bludgeoning damage equal to 7d8" (rams, type
  // before dice — label keeps the prose reading), then bare "10d6 damage" (type varies
  // by ammo or is absent; the lookahead keeps it off dice already inside an enricher).
  s = s.replace(
    new RegExp(`\\b(${DMG_TYPES})( damage equal to )(\\d+d\\d+)\\b`, 'gi'),
    (_m, type: string, mid: string, dice: string) => `${type}${mid}@Damage[${dice}[${type.toLowerCase()}]]{${dice}}`,
  );
  s = s.replace(/\b(\d+d\d+)(?= damage\b)/gi, '@Damage[$1]');
  s = s.replace(/\b(\d+) splash damage\b/gi, '@Damage[$1]{$1 splash damage}');
  // Dice durations are GM-blind rolls, not damage (matches the system packs' convention).
  s = s.replace(/\b(\d+d\d+) rounds\b/gi, '[[/gmr $1 #rounds]]{$1 rounds}');
  // AoN's extraction breaks a few measurements as "10- foot burst", so the hyphen tolerates
  // trailing space — without it those weapons keep the prose and lose the template.
  s = s.replace(
    /\b(\d+)-\s*foot\s+(burst|cone|emanation|line)(s?)\b/gi,
    (_m, dist: string, shape: string, plural: string) => {
      const tpl = `@Template[${shape.toLowerCase()}|distance:${dist}]`;
      return plural ? `${tpl}{${dist}-foot ${shape}s}` : tpl;
    },
  );
  // A radius is a burst by another name — the shape rule above has already consumed the
  // "30-foot burst radius" phrasings, so what's left here is a bare measured radius.
  s = s.replace(
    /\b(\d+)-\s*foot\s+radius\b/gi,
    (_m, dist: string) => `@Template[burst|distance:${dist}]{${dist}-foot radius}`,
  );
  return s;
}

function traitsFromBody(body: string): string[] {
  // Trait links contain their own ')', so a naive leading-paren match truncates.
  // Scan the head of the body for /Traits.aspx links and whitelist known action traits.
  const labels = [...body.slice(0, 300).matchAll(/\[([^\]]+)\]\(\/Traits\.aspx[^)]*\)/g)].map((m) =>
    m[1].toLowerCase(),
  );
  return [...new Set(labels.filter((l) => ACTION_TRAITS.has(l)))];
}

interface ParsedAction extends ActionCost {
  name: string;
  traits: string[];
  category: string | null;
  description: string;
}

/**
 * Pull the discrete activities out of a weapon's markdown. Anchor on the
 * `<actions string="…" />` glyph; the capitalized (optionally **bold**) label just
 * before it names the activity, and everything up to the next such anchor is its body.
 * Stops at the first level-2 <title> so variant sub-blocks aren't swept in.
 */
function parseActions(markdown: string): ParsedAction[] {
  const region = markdown.split(/<title\s+level="2"/)[0].replace(/<br\s*\/?>/g, '\n');
  const anchor = /(\*\*[^*\n]+?\*\*|[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,2})\s*<actions\s+string="([^"]+)"\s*\/>/g;
  const hits = [...region.matchAll(anchor)];
  const actions: ParsedAction[] = [];
  for (let i = 0; i < hits.length; i++) {
    const m = hits[i];
    const name = m[1].replace(/\*/g, '').trim();
    const cost = parseCost(m[2]);
    const bodyStart = m.index! + m[0].length;
    const bodyEnd = i + 1 < hits.length ? hits[i + 1].index! : region.length;
    const rawBody = region.slice(bodyStart, bodyEnd).trim();
    const traits = traitsFromBody(rawBody);
    const offensive = /^(launch|ram|fire|strike)/i.test(name) || traits.includes('attack');
    actions.push({
      name,
      ...cost,
      traits,
      category: offensive ? 'offensive' : null,
      description: `<p>${enrichCombat(inlineToHtml(rawBody))}</p>`,
    });
  }
  return actions;
}

const MOVE_SIEGE_WEAPON: ParsedAction = {
  name: 'Move Siege Weapon',
  actionType: 'action',
  actions: 2,
  traits: ['move'],
  category: null,
  description:
    '<p>You and the crew Stride, moving the mounted siege weapon along with you. ' +
    "The maximum distance you can move it equals the slowest crew member's Speed or the " +
    "siege weapon's listed Speed, whichever is lower.</p>",
};

function parseSpace(str: string | undefined): { long: number; wide: number; high: number } {
  if (!str) return { long: 0, wide: 0, high: 0 };
  const dim = (kw: string): number => {
    const m = str.match(new RegExp(`(\\d+)\\s*(?:feet|ft)\\s*${kw}`, 'i'));
    return m ? Number(m[1]) : 0;
  };
  return { long: dim('long'), wide: dim('wide'), high: dim('high|tall') };
}

function parsePriceGp(str: string | undefined): number {
  if (!str) return 0;
  const m = str.replace(/,/g, '').match(/(\d+)\s*gp/i);
  return m ? Number(m[1]) : 0;
}

function parseSave(v: number | string | undefined): number {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

function composeSiegeVehicle(data: WeaponData) {
  const def = data.defenses ?? {};
  const isMounted = /mounted/i.test(data.usage ?? '');
  const hasSpeed = Boolean(data.speed);

  const actions = parseActions(data.markdown ?? '');
  if (isMounted && hasSpeed) actions.push(MOVE_SIEGE_WEAPON);

  const publication = { title: data.source?.book ?? 'PF2e Trooper', license: 'ORC', remaster: true };

  const items = actions.map((a) => ({
    name: a.name,
    type: 'action',
    img: COST_IMG[String(a.actions ?? a.actionType)] ?? COST_IMG.passive,
    system: {
      actionType: { value: a.actionType },
      actions: { value: a.actions },
      category: a.category,
      description: { value: a.description },
      publication,
      rules: [],
      slug: null,
      traits: { rarity: 'common', value: a.traits },
    },
  }));

  const hp = def.hp ?? 0;
  const art = artFor(data.slug);
  const actorData = {
    name: data.name,
    type: 'vehicle',
    img: art,
    prototypeToken: {
      texture: { src: art },
      displayName: 30,
      actorLink: true,
    },
    system: {
      attributes: {
        ac: { value: def.ac ?? 0, check: 0, details: '' },
        hardness: def.hardness ?? 0,
        hp: { value: hp, max: hp, temp: 0, details: '' },
        immunities: [{ type: 'object-immunities' }],
        collisionDC: { value: 0 },
        collisionDamage: { value: '' },
        emitsSound: 'encounter',
      },
      details: {
        description: `<p>${inlineToHtml(data.summary)}</p>`,
        level: { value: data.level ?? 0 },
        price: parsePriceGp(data.price),
        crew: data.crew ?? '',
        passengers: '',
        pilotingCheck: '',
        space: parseSpace(data.space),
        speed: data.speed ?? '',
        publication,
      },
      saves: { fortitude: { value: parseSave(def.fortitudeSave), saveDetail: '' } },
      traits: {
        rarity: data.rarity ?? 'common',
        size: { value: SIZE_CODES[data.size?.[0] ?? ''] ?? (isMounted ? 'lg' : 'med') },
        value: [],
      },
    },
    flags: {
      'pf2e-trooper': {
        // Keyed 'siege-weapon' to match ReignMaker's ARMY_METADATA_FLAG convention; its
        // kingdom-map token hook keys off this flag to shrink the vehicle to one hex and swap in
        // strategyTokenImage on the strategy scene.
        'siege-weapon': {
          slug: data.slug,
          siegeWeaponCategory: data.siegeWeaponCategory ?? null,
          proficiency: data.proficiency ?? null,
          usage: data.usage ?? null,
          ammunition: data.ammunition ?? null,
          reflexSave: def.reflexSave ?? null,
          priceText: data.price ?? null,
          aonId: data.source?.aonId ?? null,
          aonUrl: data.source?.aonUrl ?? null,
          sourceBook: data.source?.book ?? null,
          sourcePage: data.source?.page ?? null,
          strategyTokenImage: art,
        },
      },
    },
  };

  return { actorData, items };
}

// The seeds read like ReignMaker's because they are: this pack was built there first, and keeping
// them verbatim means a re-drag after the move produces the same document ids.
function toPackDoc(slug: string, actorData: object, items: Array<{ name: string }>) {
  const _id = stableDocId(`reignmaker-siege:${slug}`);
  return {
    _id,
    _key: `!actors!${_id}`,
    ...actorData,
    items: items.map((item, i) => {
      const itemId = stableDocId(`reignmaker-siege-item:${slug}:${i}:${item.name}`);
      return { ...item, _id: itemId, _key: `!actors.items!${_id}.${itemId}` };
    }),
  };
}

const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const ids = new Map<string, string>();
let written = 0;
let totalActions = 0;

for (const file of files.sort()) {
  const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as WeaponData;
  const { actorData, items } = composeSiegeVehicle(data);
  const doc = toPackDoc(data.slug, actorData, items);

  if (ids.has(doc._id)) throw new Error(`stable id collision: ${data.slug} vs ${ids.get(doc._id)}`);
  ids.set(doc._id, data.slug);

  writeFileSync(join(OUT_DIR, `${data.slug}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  written++;
  totalActions += items.length;
}

if (missingArt.length > 0) {
  console.warn(
    `[SiegePack] no art in assets/siege-engines for ${missingArt.length} weapon(s), ` +
      `using the default vehicle icon: ${missingArt.join(', ')}`,
  );
}

console.log(`[SiegePack] ${written} vehicle actors (${totalActions} action items) -> packs/_source/siege-weapons`);
