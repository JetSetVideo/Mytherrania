// Every INPUT variable of a match, in one list (wave J2): what a match is SET UP with, not what it
// measures (that is FightTelemetry, wave M). Built from the existing sources so it cannot drift:
//   arena     ArenaConfig.PARAMS (68 keys, 7 forge categories)
//   fighter   the FighterSpec fields of the contract, with the six primary stats split out
//             (StatName), level (SpectateGen MIN/MAX_LEVEL), gear quality, strategy, AI level, and
//             the categorical identity: race, sub-race (Races.RACES), class (Stats.CLASSES), weapon
//             (Archetypes.ARCHETYPE_IDS + the class default), birthsign (Birthsight.BIRTHSIGNS + none)
//   rules     the MatchRules switches (MatchRules.WAVE_J_RULES vs ENGINE_RULES)
//   clock     the truce and the time limit actually used (Disposition / MatchControl)
//   tunable   ParameterBounds.BOUNDS: global constants (a balance EDIT, never a match variable)
//
// `sim` says whether the headless simulator's pipeline (FighterBuild + MatchSim + the ArenaJT
// provider: walls / symmetry / spawns / digest / placeObjects) reads the variable — only those are
// worth varying in a headless batch. tests/variables_test.ts checks every `sim` flag against a scan
// of the sources, so a flag cannot claim a reader that does not exist (or miss one that does).
//
// Pure: no THREE, no DOM, no Math.random.

import { PARAMS, type ArenaCategory } from "../game/ArenaConfig.ts";
import { RACES, type StatName } from "../game/Races.ts";
import { CLASSES } from "../game/Stats.ts";
import { ARCHETYPE_IDS } from "../game/weapons/Archetypes.ts";
import { BIRTHSIGNS } from "../game/Birthsight.ts";
import { MAX_LEVEL, MIN_LEVEL, PER_STAT_CAP } from "../game/SpectateGen.ts";
import { BOUNDS } from "../game/ParameterBounds.ts";
import { ENGINE_RULES, WAVE_J_RULES } from "./MatchRules.ts";

export type VarScope = "arena" | "fighter" | "rules" | "clock" | "tunable";
export type VarKind = "number" | "int" | "bool" | "enum";

export interface VariableDef {
  /** "arena.size", "fighter.stat.strength", "fighter.race", "rules.knockbackFloor", "tunable.<id>". */
  id: string;
  scope: VarScope;
  /** Sub-group: the arena's forge category, "stats"/"build"/"identity" for a fighter, ... */
  group: string;
  kind: VarKind;
  min: number;
  max: number;
  def: number;
  /** Enum labels (index = value) for kind "enum". */
  values?: readonly string[];
  unit: string;
  note: string;
  /** One value per seat (fighter variables). */
  perSeat: boolean;
  /** Read by the headless simulator's pipeline (worth varying in a headless batch). */
  sim: boolean;
}

/** The six primary attributes (FighterSpec.allocated keys), in StatName order. */
export const STAT_NAMES: readonly StatName[] = ["vitality", "resilience", "willpower", "reflex", "strength", "intelligence"];

/**
 * Arena keys the headless pipeline reads (declared; tests/variables_test.ts verifies them against
 * the sources of src/balance + src/game/arena + ArenaConfig's generator functions):
 *   ring outline     size shape aspect rotation (ringRadiusAt)
 *   walls            walls wallHeight wallResistance wallBounce wallRule wallRule2 wallRule3 wallMix
 *                    wallCombine wallTall wallLow wallGap wallGate wallPeriod wallTowers wallArc
 *                    wallArcCentre (wallPlanFor)
 *   symmetry         symmetry symmetryOrder symmetryAxis (symmetryFor)
 *   props, spawns    objects objectSpread gliderPads (placeObjects), spawnAngle spawnDistance spawnZone
 *   outside, ground  ceiling pitDepth outsideGround outsideCollision outsideHeight ground friction wind
 *                    (the digest: ringOutFatal, outsideDrop, surface)
 * NOT read: timeLimit and roamSeconds (the clock comes from MatchControl / Disposition in BOTH
 * simulators — see the "clock" variables), and the 12 keys nobody reads (DEAD_ARENA_KEYS).
 */
export const SIM_ARENA_KEYS: ReadonlySet<string> = new Set([
  "size", "shape", "aspect", "rotation",
  "walls", "wallHeight", "wallResistance", "wallBounce", "wallRule", "wallRule2", "wallRule3", "wallMix", "wallCombine",
  "wallTall", "wallLow", "wallGap", "wallGate", "wallPeriod", "wallTowers", "wallArc", "wallArcCentre",
  "symmetry", "symmetryOrder", "symmetryAxis",
  "objects", "objectSpread", "gliderPads", "spawnAngle", "spawnDistance", "spawnZone",
  "ceiling", "pitDepth", "outsideGround", "outsideCollision", "outsideHeight", "ground", "friction", "wind",
]);

/**
 * Arena keys declared in PARAMS that NO code reads (neither simulator, nor the engine, nor the UI),
 * found by a source scan on 2026-11-01. They look like knobs but change nothing; varying them in a
 * batch would only add noise. Kept here so the inventory says so (tests re-check the scan).
 */
export const DEAD_ARENA_KEYS: ReadonlySet<string> = new Set([
  "rimHeight", "groundBlend", "platforms", "aggressionRate", "suddenDeath", "senses", "hazardRate",
  "glider", "glideSpeed", "glideSink", "updraft", "glideFuel",
]);

const ENUM_LABELS: Record<string, readonly string[]> = {
  ground: ["stone", "sand", "ice", "wood"],
  shape: ["circle", "triangle", "square", "pentagon", "hexagon", "octagon", "oval", "diamond"],
  wallRule: ["none", "low", "full", "ruin", "battlement", "gates", "half", "towers"],
  wallCombine: ["blend", "max", "min", "sectors"],
  symmetry: ["none", "mirror", "mirror2", "point", "rotational"],
};

function arenaVariables(): VariableDef[] {
  return PARAMS.map((p) => {
    const kind: VarKind = p.unit === "bool" ? "bool" : p.unit === "enum" ? "enum" : p.unit === "count" || p.unit === "segments" ? "int" : "number";
    // wallRule2/3 run from −1 ("no extra rule") to 7: nine values, the extra rule's label first.
    const labels = ENUM_LABELS[p.key] ?? (p.key === "wallRule2" || p.key === "wallRule3" ? ["(no extra rule)", ...ENUM_LABELS.wallRule] : undefined);
    return {
      id: `arena.${p.key}`, scope: "arena" as const, group: p.category as ArenaCategory, kind,
      min: p.min, max: p.max, def: p.def, ...(labels ? { values: labels } : {}),
      unit: p.unit, note: p.note, perSeat: false, sim: SIM_ARENA_KEYS.has(p.key),
    };
  });
}

function fighterVariables(): VariableDef[] {
  const races = RACES.map((r) => r.id);
  const ancestries = RACES.flatMap((r) => r.subspecies.map((s) => `${r.id}/${s.id}`));
  const weapons = ["(class default)", ...ARCHETYPE_IDS];
  const signs = ["(none)", ...BIRTHSIGNS.map((b) => b.id)];
  const f = (id: string, group: string, kind: VarKind, min: number, max: number, def: number, unit: string, note: string, values?: readonly string[]): VariableDef => ({
    id: `fighter.${id}`, scope: "fighter", group, kind, min, max, def, unit, note, perSeat: true, sim: true, ...(values ? { values } : {}),
  });
  return [
    f("level", "build", "int", MIN_LEVEL, MAX_LEVEL, Math.round((MIN_LEVEL + MAX_LEVEL) / 2), "level", "point budget (SpectateGen.budgetForLevel) and, with rules.levelGrowth, +3 %/level health and power"),
    ...STAT_NAMES.map((s) => f(`stat.${s}`, "stats", "int", 0, PER_STAT_CAP, 0, "points",
      `points allocated to ${s} on top of the class + race base (capped per stat at ${PER_STAT_CAP}; the sum is capped by the level budget)`)),
    f("gear", "build", "number", 0, 1, 0.5, "0..1", "gear quality: armour, damage multiplier, accuracy, resource regen (MatchRules.GEAR)"),
    f("strategy", "build", "enum", 0, 2, 1, "enum", "none = walk at the enemy and swing; basic = the decision tree; full = tree + edge play", ["none", "basic", "full"]),
    f("aiLevel", "build", "number", 0, 1, 0.5, "0..1", "decision quality: the re-think period 0.05 + 0.25 (1 - aiLevel) s"),
    f("race", "identity", "enum", 0, races.length - 1, 0, "enum", "race identity: mods + RaceAffinity (health, mana flow, endurance)", races),
    f("ancestry", "identity", "enum", 0, ancestries.length - 1, 0, "enum", "race + sub-race (12): the sub-race tweak and its secondary stats", ancestries),
    f("class", "identity", "enum", 0, CLASSES.length - 1, 1, "enum", "class base stats, skills and lean of the point spend", CLASSES),
    f("weapon", "identity", "enum", 0, weapons.length - 1, 0, "enum", "weapon archetype (reach, cooldown, damage mix, mass), generated per seed", weapons),
    f("birthsign", "identity", "enum", 0, signs.length - 1, 0, "enum", "birthsign: primary-stat mods + secondary stats", signs),
  ];
}

function rulesVariables(): VariableDef[] {
  return (Object.keys(WAVE_J_RULES) as (keyof typeof WAVE_J_RULES)[]).map((k) => {
    const v = WAVE_J_RULES[k], e = ENGINE_RULES[k];
    const isBool = typeof v === "boolean", isNum = typeof v === "number";
    return {
      id: `rules.${k}`, scope: "rules" as const, group: "rules", kind: isBool ? "bool" as const : isNum ? "number" as const : "enum" as const,
      min: isNum ? Math.min(Number(v), Number(e)) : 0, max: isNum ? Math.max(Number(v), Number(e)) : 1,
      def: isBool ? (v ? 1 : 0) : isNum ? Number(v) : 1,
      ...(typeof v === "string" ? { values: [String(e), String(v)] } : {}),
      unit: isBool ? "bool" : isNum ? "x" : "enum",
      note: `wave J ${String(v)} / engine-before ${String(e)} (a rule SET switch: compared by ablation, not per match)`,
      perSeat: false, sim: true,
    };
  });
}

function clockVariables(): VariableDef[] {
  return [
    { id: "clock.truce", scope: "clock", group: "clock", kind: "number", min: 0, max: 120, def: 6, unit: "s", note: "opening truce (Disposition.truceSeconds); arena.roamSeconds is overwritten with it in the record", perSeat: false, sim: true },
    { id: "clock.timeLimit", scope: "clock", group: "clock", kind: "number", min: 0, max: 600, def: 180, unit: "s", note: "hostile seconds before the bell (MatchControl.resolveTimeLimit); arena.timeLimit is overwritten with it in the record", perSeat: false, sim: true },
  ];
}

function tunableVariables(): VariableDef[] {
  return BOUNDS.map((b) => ({
    id: `tunable.${b.id}`, scope: "tunable" as const, group: b.category, kind: "number" as const,
    min: b.min, max: b.max, def: b.min, unit: b.unit, note: b.note, perSeat: false, sim: false,
  }));
}

/** The whole inventory, in a stable order: arena, fighter, clock, rules, tunable. */
export const VARIABLES: readonly VariableDef[] = [...arenaVariables(), ...fighterVariables(), ...clockVariables(), ...rulesVariables(), ...tunableVariables()];

export const VARIABLE_BY_ID: ReadonlyMap<string, VariableDef> = new Map(VARIABLES.map((v) => [v.id, v]));

/**
 * The variables a headless batch varies one by one (designs "vars-extreme" / "vars-grid"): every
 * sim-read arena and fighter variable. Rules are compared by ablation, the clock is fixed by the
 * game, tunables are constants, and dead keys change nothing.
 */
export const BATCH_VARIABLES: readonly VariableDef[] = VARIABLES.filter((v) => v.sim && (v.scope === "arena" || v.scope === "fighter"));

/** The value of `v` at normalised position u (0 = min, 1 = max); ints/enums round, bools threshold. */
export function valueAt(v: VariableDef, u: number): number {
  const t = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0;
  const x = v.min + t * (v.max - v.min);
  return v.kind === "number" ? x : v.kind === "bool" ? (t >= 0.5 ? 1 : 0) : Math.round(x);
}
