import type { ClassName } from "./Stats.ts";
import { BIRTHSIGNS } from "./Birthsight.ts";
import { startingStats } from "./Leveling.ts";
import type { RaceSilhouette, Sex } from "./BodyProfile.ts";
import type { GeneratorStats } from "../graphics/body/contracts.ts";
import { generatorStats } from "./StatScale.ts";

export interface Appearance {
  body: string;
  accent: string;
  height: number;
  weight: number;
  hair?: string;
  beard?: boolean;
  moustache?: boolean;
  eyes: string;
  /** Race + sub-species drive the build (height/weight/hair/beard/tusk/ears). */
  race?: string;
  subrace?: string | null;
  /**
   * The body's proportions. Left unset, the rig derives them from the race; set from
   * `randomSilhouette`, two members of one race get different bodies that still read.
   */
  silhouette?: RaceSilhouette;
  /**
   * The character's sex (lane R-A). Left unset, the body builds NEUTRAL male (the pre-wave
   * silhouette); set to "female" for the measured curves. Defaulted deterministically by the roll.
   */
  sex?: Sex;
  /**
   * Wave X: age in YEARS (Age.ts reads it relative to the race lifespan: lifeStage, greyFraction).
   * Left unset, the character reads as a young adult (greyFraction 0).
   */
  age?: number;
}

export interface CharacterProfile {
  name: string;
  race: string;
  subrace: string | null;
  className: ClassName;
  appearance: Appearance;
  palette: string;
  birthsign: string | null;
  level: number;
  allocated: Record<string, number>;
  weaponType?: string; // optional weapon override (e.g. "axe", "sword")
  equip?: EquipmentSlots;
}

export interface EquipmentSlots {
  helmet?: string;  // item id or color
  armor?: string;
  gloves?: string;
  belt?: string;
  legs?: string;
  boots?: string;
  cape?: string;
  handedness?: "one" | "two";
}

export interface NPC {
  name: string;
  className: ClassName;
  title: string;
  race: string;
  subrace: string | null;
  appearance: Appearance;
}

export const PALETTES: Record<string, { body: string; accent: string }> = {
  Ember:  { body: "#ef7455", accent: "#dfaa55" },
  Tundra: { body: "#4f8490", accent: "#b9c9c8" },
  Verdant:{ body: "#82b970", accent: "#a9ce7c" },
  Shadow: { body: "#2a2f3a", accent: "#9b72cf" },
  Bone:   { body: "#e8dcc8", accent: "#dfaa55" },
};

function defaultAlloc(race: string, subrace: string | null, className: ClassName) {
  return startingStats(className, race, subrace).allocated;
}

export const PRESETS: CharacterProfile[] = [
  { name: "Sir Aldric", race: "human", subrace: "imperial", className: "Warrior", palette: "Ember",  birthsign: "mountain", level: 1, allocated: defaultAlloc("human","imperial","Warrior"), appearance: { body: "#ef7455", accent: "#dfaa55", height: 1.8,  weight: 90, hair: "#172128", beard: true,  moustache: false, eyes: "#dfaa55" } },
  { name: "Vex",        race: "elf",   subrace: "dark",     className: "Rogue",   palette: "Verdant", birthsign: "serpent",  level: 1, allocated: defaultAlloc("elf","dark","Rogue"),       appearance: { body: "#82b970", accent: "#a9ce7c", height: 1.65, weight: 62, hair: "#172128", beard: false, moustache: false, eyes: "#a9ce7c" } },
  { name: "Merideth",   race: "human", subrace: "nomad",    className: "Mage",    palette: "Shadow",  birthsign: "moon",     level: 1, allocated: defaultAlloc("human","nomad","Mage"),      appearance: { body: "#9b72cf", accent: "#2a2f3a", height: 1.72, weight: 58, hair: "#fff3cf", beard: false, moustache: false, eyes: "#fff3cf" } },
];

export const NPCS: NPC[] = [
  { name: "Gromm the Unyielding",  className: "Barbarian",  title: "Champion of the North", race: "ork",   subrace: "ironhide", appearance: { body: "#ef7455", accent: "#dfaa55", height: 2.0, weight: 130, hair: "#dfaa55", beard: true, moustache: true, eyes: "#172128" } },
  { name: "Ser Vail",              className: "Warrior",    title: "Shield of the Realm",   race: "human", subrace: "imperial", appearance: { body: "#dfaa55", accent: "#172128", height: 1.85, weight: 95, hair: "#172128", beard: true, moustache: false, eyes: "#dfaa55" } },
  { name: "Nyra",                  className: "Assassin",   title: "The Silent Knife",      race: "elf",   subrace: "dark",     appearance: { body: "#2a2f3a", accent: "#a9ce7c", height: 1.6, weight: 52, hair: "#172128", beard: false, moustache: false, eyes: "#a9ce7c" } },
  { name: "Thistle",               className: "Archer",     title: "Warden of the Grove",   race: "elf",   subrace: "wood",     appearance: { body: "#a9ce7c", accent: "#82b970", height: 1.68, weight: 60, hair: "#82b970", beard: false, moustache: false, eyes: "#172128" } },
  { name: "Morrigan",              className: "Necromancer",title: "Keeper of Bones",       race: "human", subrace: "islander", appearance: { body: "#4f8490", accent: "#172128", height: 1.75, weight: 55, hair: "#e8dcc8", beard: false, moustache: false, eyes: "#4f8490" } },
  { name: "High Priestess Eira",   className: "Priest",     title: "Voice of the Dawn",     race: "dwarf", subrace: "forge",    appearance: { body: "#fff3cf", accent: "#dfaa55", height: 1.7, weight: 64, hair: "#fff3cf", beard: false, moustache: false, eyes: "#172128" } },
];

export function randomProfile(rng: () => number): CharacterProfile {
  const names = ["Ash","Bramble","Cinder","Dusk","Ember","Fenn","Gale","Hollow","Iris","Juniper","Kestrel","Lumen"];
  const classes: ClassName[] = ["Barbarian","Warrior","Rogue","Assassin","Mage","Necromancer","Archer","Priest"];
  const paletteNames = Object.keys(PALETTES);
  const palette = paletteNames[Math.floor(rng() * paletteNames.length)];
  const p = PALETTES[palette];
  const race = ["human","elf","dwarf","ork"][Math.floor(rng() * 4)];
  const signs = BIRTHSIGNS.map(s => s.id);
  const cn = classes[Math.floor(rng() * classes.length)];
  return {
    name: names[Math.floor(rng() * names.length)],
    race, subrace: null, className: cn, palette,
    birthsign: signs[Math.floor(rng() * signs.length)],
    level: 1, allocated: defaultAlloc(race, null, cn),
    appearance: {
      body: p.body, accent: p.accent,
      height: 1.5 + rng() * 0.6, weight: 50 + rng() * 90,
      hair: ["#172128","#fff3cf","#dfaa55","#ef7455"][Math.floor(rng() * 4)],
      beard: rng() < 0.3, moustache: rng() < 0.25,
      eyes: ["#dfaa55","#4f8490","#ef7455","#172128"][Math.floor(rng() * 4)],
      // Lane R-A: the sex is a deterministic draw from the SAME seeded roll (never Math.random),
      // so a given seed always yields the same sex — and an unset sex still builds neutral male.
      sex: rng() < 0.5 ? "male" : "female",
    },
  };
}
/**
 * Wave GEN (P): the body generator's 0..1000 stat view of a profile (StatScale.generatorStats: the
 * sheet's strength / agility / intelligence and the level). This is what rides on BodySpec.stats from
 * the Creator preview (PreviewScene.buildPreviewRig) and the arena (Engine.#spawnMeshes); a profile at
 * the reference sheet and level 1 maps to STAT_REFERENCE (the identity morph).
 */
export function profileBodyStats(profile: Pick<CharacterProfile, "className" | "race" | "subrace" | "allocated" | "level">): GeneratorStats {
  return generatorStats(profile);
}
