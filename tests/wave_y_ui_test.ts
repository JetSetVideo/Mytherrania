// Wave Y (lane U): the equipment catalogue (C-EQ), the weapon/slot icons, the hero reroll and its
// persistence patch, the level medallion and socket markup, and the metal/stone token system.
// Pure modules only — the browser evidence is tools/probe-wave-y-ui.ts. SPEC Y30-Y49 are lane U's pins.
function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y}, got ${x}`);
}
import { defaultWeapon, EQUIP_SIDE, EQUIP_SLOTS, equip, equipmentCatalog, equippedId, equippedWeapon, itemsFor, offhandBlocked, weaponLegalFor } from "../src/game/EquipmentCatalog.ts";
import { ARCHETYPE_IDS, ARCHETYPES, CLASS_ARCHETYPE } from "../src/game/weapons/Archetypes.ts";
import { archetypeOfChoice } from "../src/game/weapons/Loadout.ts";
import { PRESETS, type CharacterProfile } from "../src/game/Characters.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { SLOT_ICON_PATHS, WEAPON_ICON_PATHS, equipItemIcon, slotIcon, weaponIcon } from "../src/ui/EquipIcons.ts";
import { heroRecordPatch, rerollHero } from "../src/ui/HeroReroll.ts";
import { equipCaption, equipPickerHtml, equipRingHtml, equipSlotHtml, levelBadgeHtml, mulberry32 } from "../src/ui/Menu.ts";
import { phonologyFor } from "../src/game/NameGen.ts";
import { createProfile, ProfileRepo, type Store } from "../src/game/Profiles.ts";
import { createFromCharacter, libraryEntries } from "../src/game/ProfileLibrary.ts";
import { rollProfile } from "../src/ui/CreatorRoll.ts";

const hero: CharacterProfile = { ...PRESETS[0], level: 7, equip: { helmet: "helmet-iron-helm" } };

Deno.test("SPEC Y30: the catalogue has the nine sockets; weapons = every real archetype (available), the rest = future pieces (greyed)", () => {
  assertEquals([...EQUIP_SLOTS].sort(), ["armor", "belt", "boots", "cape", "gloves", "helmet", "legs", "offhand", "weapon"]);
  const cat = equipmentCatalog();
  assertEquals(cat.weapon.map((i) => i.id), [...ARCHETYPE_IDS], "weapon list = the archetypes, in menu order");
  assert(cat.weapon.every((i) => i.available && i.slot === "weapon" && i.name === ARCHETYPES[i.id as keyof typeof ARCHETYPES].label), "weapons are available, labelled by the game");
  for (const s of EQUIP_SLOTS.filter((s) => s !== "weapon")) {
    assert(cat[s].length >= 3, `${s} lists its future pieces`);
    assert(cat[s].every((i) => !i.available && i.slot === s && i.note === "coming soon"), `${s} pieces are placeholders`);
  }
  const ids = Object.values(cat).flat().map((i) => i.id);
  assertEquals(new Set(ids).size, ids.length, "ids are unique");
  // Every EquipmentSlots key of the character model has a socket (offhand + weapon added by C-EQ).
  for (const k of ["helmet", "armor", "gloves", "belt", "legs", "boots", "cape"]) assert(EQUIP_SLOTS.includes(k as never), `socket for ${k}`);
  // The viewer: five sockets on the left, four on the right, the weapon on the right.
  assertEquals(EQUIP_SLOTS.filter((s) => EQUIP_SIDE[s] === "left").length, 5);
  assertEquals(EQUIP_SIDE.weapon, "right");
});

Deno.test("SPEC Y31: equip() writes weaponType for a weapon, refuses placeholders/unknown ids, and reads legacy types", () => {
  const a = equip(hero, "weapon", "maul");
  assertEquals(a.weaponType, "maul");
  assertEquals(equippedWeapon(a), "maul");
  assert(equip(hero, "helmet", "helmet-great-helm") === hero, "a placeholder piece is refused (same object)");
  assert(equip(hero, "weapon", "lightsaber") === hero, "an unknown id is refused");
  // Legacy profile types resolve through the game's own Loadout rule.
  assertEquals(equippedWeapon({ className: "Warrior", weaponType: "sword" }), "longsword");
  for (const c of CLASSES) {
    assertEquals(equippedWeapon({ className: c, weaponType: undefined }), CLASS_ARCHETYPE[c], `${c} default`);
    assertEquals(defaultWeapon(c), archetypeOfChoice(c, undefined));
    // The game has no class restriction on weapons (weaponMenuOptions offers every archetype).
    assert(ARCHETYPE_IDS.every((id) => weaponLegalFor(c, id)), `${c} may take every archetype`);
  }
  assertEquals(equippedId(hero, "helmet"), "helmet-iron-helm");
  assertEquals(equippedId(hero, "boots"), "");
  assertEquals(equippedId({ ...hero, weaponType: "random" }, "weapon"), "random");
  assert(offhandBlocked("maul") && !offhandBlocked("dagger") && !offhandBlocked(null), "two-handed blocks the off hand");
});

Deno.test("SPEC Y32: one line icon per archetype and per socket, inside the 24-unit grid, CSP-safe", () => {
  assertEquals(Object.keys(WEAPON_ICON_PATHS).sort(), [...ARCHETYPE_IDS].sort(), "an icon for every archetype");
  assertEquals(Object.keys(SLOT_ICON_PATHS).sort(), EQUIP_SLOTS.filter((s) => s !== "weapon").sort(), "an icon for every armour socket");
  for (const [k, inner] of [...Object.entries(WEAPON_ICON_PATHS), ...Object.entries(SLOT_ICON_PATHS)]) {
    // Every absolute coordinate pair after a path command lies on the grid (with the stroke's half width).
    for (const m of inner.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
      const x = +m[1], y = +m[2];
      assert(x >= 0.5 && x <= 23.5 && y >= 0.5 && y <= 23.5, `${k}: point ${x},${y} inside the grid`);
    }
    assert(!inner.includes("style="), `${k}: no inline style`);
  }
  const s = weaponIcon("halberd", "x");
  assert(s.startsWith("<svg") && s.includes('class="icon icon-weapon icon-weapon-halberd x"') && s.includes('stroke="currentColor"'), "weapon svg wrapper");
  assert(weaponIcon("random").includes("icon-weapon-random"), "random draws a fallback glyph, never an empty svg");
  assert(slotIcon("cape").includes("icon-slot-cape") && equipItemIcon("maul").includes("icon-weapon-maul") && equipItemIcon("boots").includes("icon-slot-boots"));
  // Glyphs differ (no two archetypes share one drawing).
  const drawn = Object.values(WEAPON_ICON_PATHS);
  assertEquals(new Set(drawn).size, drawn.length, "distinct drawings");
});

Deno.test("SPEC Y33: Reroll hero is a seeded whole-hero roll that keeps the level and the equipment", () => {
  const a = rerollHero(hero, mulberry32(42)), b = rerollHero(hero, mulberry32(42));
  assertEquals(a, b, "same seed, same hero");
  assertEquals(a.level, 7, "level kept");
  assertEquals(a.equip, hero.equip, "equipment kept");
  // Everything else is the dice's own roll (rollProfile) — same seed, same fighter.
  const rolled = rollProfile(mulberry32(42)).profile;
  assertEquals({ ...a, level: rolled.level, equip: undefined }, { ...rolled, equip: undefined });
  // Over seeds: names change and follow the NEW ancestry's phonology.
  let changed = 0, phon = 0;
  for (let s = 1; s <= 40; s++) {
    const r = rerollHero(hero, mulberry32(s));
    if (r.name !== hero.name) changed++;
    const onsets = phonologyFor(r.race, r.subrace).onsets.map((o) => o.toLowerCase());
    if (onsets.some((o) => r.name.toLowerCase().startsWith(o))) phon++;
  }
  assertEquals(changed, 40, "a reroll always renames");
  assert(phon >= 36, `names speak the new phonology (${phon}/40)`);
  // A broken level reads as 1.
  assertEquals(rerollHero({ ...hero, level: NaN }, mulberry32(1)).level, 1);
});

function memStore(): Store {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

Deno.test("SPEC Y34: heroRecordPatch replaces the hero in place through ProfileRepo.update (id + record kept)", () => {
  const repo = new ProfileRepo(memStore());
  repo.add(createProfile(1, "Seed", "Warrior"));
  const saved = createFromCharacter(repo, hero, hero.name, "2026-11-02T00:00:00.000Z");
  const id = saved.profile.playerId;
  repo.recordMatch(id, true, 1234, "Warrior");
  const next = rerollHero(saved.character, mulberry32(7));
  const patch = heroRecordPatch(next);
  assert(!("playerId" in patch) && !("telemetry" in patch) && !("keybindings" in patch) && !("createdAt" in patch), "the patch never touches the identity or the record");
  repo.update(id, patch);
  const e = libraryEntries(repo).find((x) => x.profile.playerId === id)!;
  assertEquals([e.character.name, e.character.race, e.character.subrace, e.character.className, e.character.birthsign, e.character.palette, e.character.weaponType],
    [next.name, next.race, next.subrace, next.className, next.birthsign, next.palette, next.weaponType], "the stored hero IS the reroll");
  assertEquals(e.character.appearance, next.appearance, "appearance stored");
  assertEquals(e.level, saved.level, "level kept");
  assertEquals([e.wins, e.matches], [1, 1], "the record survives the reroll");
  // Undo = the same patch of the previous character.
  repo.update(id, heroRecordPatch(saved.character));
  assertEquals(libraryEntries(repo).find((x) => x.profile.playerId === id)!.character.name, hero.name, "undo restores the name");
});

Deno.test("SPEC Y35: medallion, sockets and picker markup — classes only, the viewer canvas once, 5 | 4 sockets", () => {
  const badge = levelBadgeHtml(12);
  assert(badge.includes('data-level="12"') && badge.includes("Level 12") && badge.includes("plate-copper") && badge.includes(">Lv<"), badge);
  assert(levelBadgeHtml(3, true).includes("level-badge-sm") && !levelBadgeHtml(3, true).includes(">Lv<"), "compact tab medallion");
  assert(levelBadgeHtml(-4).includes('data-level="1"') && levelBadgeHtml(NaN).includes('data-level="1"'), "bad levels read 1");
  const ring = equipRingHtml(hero);
  assertEquals(ring.match(/id="creator-preview"/g)?.length, 1, "the canvas exists once (the engine draws into it by id)");
  assertEquals(ring.match(/data-equip-slot="/g)?.length, 9);
  const left = ring.slice(ring.indexOf("equip-col-left"), ring.indexOf("equip-view"));
  assertEquals(left.match(/data-equip-slot="/g)?.length, 5);
  assert(ring.indexOf("equip-col-left") < ring.indexOf("creator-preview") && ring.indexOf("creator-preview") < ring.indexOf("equip-col-right"), "left | model | right");
  assert(equipSlotHtml(hero, "weapon").includes("icon-weapon-longsword"), "the weapon socket shows the wielded archetype (Warrior default)");
  assert(equipSlotHtml(equip(hero, "weapon", "bow"), "weapon").includes("icon-weapon-bow"), "and follows a choice");
  assert(equipSlotHtml(hero, "helmet").includes('data-filled="false"'), "a placeholder id never shows as filled");
  const wp = equipPickerHtml(hero, "weapon");
  assertEquals(wp.match(/data-equip-item="/g)?.length, ARCHETYPE_IDS.length + 1, "class default + every archetype");
  assert(!wp.includes(" disabled"), "every weapon can be chosen");
  const hp = equipPickerHtml(hero, "helmet");
  assertEquals(hp.match(/data-equip-item="/g)?.length, itemsFor("helmet").length);
  assertEquals(hp.match(/ disabled/g)?.length, itemsFor("helmet").length, "future pieces are disabled");
  for (const html of [badge, ring, wp, hp]) assert(!/style=/.test(html), "no inline style (CSP)");
  assertEquals(equipCaption(hero), "Weapon: Longsword (class default)");
  assertEquals(equipCaption(equip(hero, "weapon", "maul")), "Weapon: Maul");
});

const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
function token(name: string, vw: number): number {
  const m = css.match(new RegExp(`--${name}:clamp\\(([\\d.]+)px,calc\\(([\\d.]+)rem \\+ ([\\d.]+)vw\\),([\\d.]+)px\\)`))!;
  const [lo, rem, v, hi] = m.slice(1).map(Number);
  return Math.max(lo, Math.min(hi, rem * 16 + (v / 100) * vw));
}

Deno.test("SPEC Y36: the metal/stone tokens are named equations of the type scale, and the recipes exist", () => {
  for (const t of ["--frame-w:max(2px,calc(var(--t4) * .2))", "--frame-w-lg:max(3px,calc(var(--t3) * .22))", "--bevel:calc(var(--frame-w) * .6)", "--socket:clamp(44px,calc(var(--t3) * 2.9),64px)"]) {
    assert(css.includes(t), `token ${t}`);
  }
  for (const k of ["--metal-steel:", "--metal-bronze:", "--metal-copper:", "--stone:", "--noise-brushed:", "--noise-hammered:"]) assert(css.includes(k), k);
  for (const c of [".frame-steel{", ".frame-bronze{", ".plate-copper{", ".btn-stone{", ".pool-bar{", ".pool-current{", ".pool-potential{", ".pool-lost{"]) assert(css.includes(c), c);
  assert(/\.pool-lost\{[^}]*repeating-linear-gradient/.test(css), "the lost region is hatched");
  // The frame grows with the text and never below 2 px, at every width the suite pins.
  let prev = 0;
  for (const vw of [320, 390, 820, 1280, 1920, 2560]) {
    const fw = Math.max(2, token("t4", vw) * 0.2);
    assert(fw >= prev && fw >= 2 && fw <= 3.01, `--frame-w at ${vw}px = ${fw}`);
    prev = fw;
  }
});
