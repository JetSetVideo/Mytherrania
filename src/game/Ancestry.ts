// The ancestry hierarchy: a race node and its 12 subrace children, each carrying a rank for
// every body-proportion metric plus the eight look specs (skin, hair, brow, beard, tusk, ears,
// skull, hair physics). It is the data behind "ancestry is visible, not cosmetic" (DESIGN.md
// item 9) and "races are numbers, not meshes" (item 22): every silhouette difference is a rank
// or a factor here, never a special case in the rig.
//
// Pure data + lookups: no Three.js, no DOM, no Math.random. The rankings must be a strict
// 1..4 ordering across the 4 race nodes for each metric (rank 1 = most of the metric), so a
// race's identity is an ORDERING, not an absolute number that a later tweak could flatten.
//
// Data source: artifacts/design/ancestry.json. The per-part BODY-MEASURE ratios (legToTorso,
// shoulderToHip, ...) stay owned by artifacts/design/race-genes.json / RaceGenes.ts; this module
// only names them in docs/ancestry/HIERARCHY.md and never duplicates their numbers.

import ancestryRaw from "../../artifacts/design/ancestry.json" with { type: "json" };

export type MetricName =
  | "height" | "thinness" | "legLength" | "armLength" | "shoulderWidth" | "torsoMass"
  | "skullProminence" | "browProminence" | "hairLength" | "beardCoverage" | "earLength"
  | "tuskProtrusion" | "skinDepth";

export interface SkinSpec {
  base: string;              // "#rrggbb" mid-tone of the race's skin
  range: string[];           // 3-5 tones a character may be drawn in (first = most common)
  crease: string;            // the darkening colour at a joint/fold crossing
  creaseStrength: number;    // 0..1 how strongly the creases read
  zones: ("under-eye" | "cheek-fold" | "neck" | "joint" | "knuckle" | "brow")[];
}
export interface HairSpec {
  length: "bald" | "short" | "medium" | "long" | "verylong";
  styles: string[];          // HairStyle ids from src/game/RaceAppearance.ts
  colors: string[];          // 3-6 "#rrggbb" a character may draw from
  curl: number;              // 0 straight .. 1 coiled
  density: number;           // 0..1 thickness of the mass
  baldChance: number;        // 0..1 per character (orks highest, elves 0)
}
export interface BrowSpec { length: number; thickness: number; prominence: number; tipPastFace: number; }
export interface BeardSpec {
  mode: "none" | "chin" | "moustache-thin" | "moustache" | "full";
  coverage: number;          // 0..1 of the jaw the growth covers
  lengthMul: number;         // multiplier on the beard mass
  required: boolean;         // true = this ancestry always grows it
  allowed: boolean;          // false = never, whatever the character says
}
export interface TuskSpec { count: 0 | 2 | 4; protrusion: number; direction: "up" | "out" | "down"; }
export interface EarSpec { lengthMul: number; pointed: number; droop: number; }
export interface SkullSpec { massMul: number; browRidge: number; jawWidth: number; }
export interface HairPhysicsSpec { massKg: number; stiffness: number; damp: number; windGain: number; }

export interface AncestryNode {
  id: string;                // "elf" | "high" | ...
  name: string;              // "Elf" | "High Elf" | ...
  race: string;              // parent race id; equals id for a race node
  parent: string | null;     // null for a race node
  ranks: Record<MetricName, number>;   // 1 = the most of this metric; 0 = unranked
  skin: SkinSpec; hair: HairSpec; brow: BrowSpec; beard: BeardSpec;
  tusk: TuskSpec; ears: EarSpec; skull: SkullSpec; hairPhysics: HairPhysicsSpec;
  lore: string;              // one sentence, in the game's voice
}

/** The JSON file's shape: the 16 nodes plus the per-race body scale the hair mass rides on. */
interface AncestryFile {
  version: number;
  units: string;
  note: string;
  statures: Record<string, number>;
  nodes: Record<string, AncestryNode>;
}

/** The order every ranking is asserted against; the 4 race nodes in a fixed walk order. */
export const RACE_IDS: readonly string[] = ["human", "elf", "dwarf", "ork"];

/** The 13 body-proportion axes a node is ranked on. */
export const METRICS: readonly MetricName[] = [
  "height", "thinness", "legLength", "armLength", "shoulderWidth", "torsoMass",
  "skullProminence", "browProminence", "hairLength", "beardCoverage", "earLength",
  "tuskProtrusion", "skinDepth",
];

const RAW = ancestryRaw as unknown as AncestryFile;

/** Every race and every subrace, keyed by id: 4 race nodes + 12 subrace nodes. */
export const ANCESTRY: Record<string, AncestryNode> = RAW.nodes;

/** Race id -> body stature (metres at the race's own scale); the hair mass scales with its cube. */
export const STATURES: Record<string, number> = RAW.statures;

/**
 * The subrace node merged over its race node (missing subrace -> the race node). Never null.
 * A subrace is only accepted when it really belongs to the race, so a foreign or misspelled
 * subrace id falls back to the race's own node instead of borrowing another race's look.
 */
export function ancestryOf(raceId: string, subraceId: string | null): AncestryNode {
  let race = ANCESTRY[raceId] ?? ANCESTRY.human;
  // Accept a subrace id passed in the race slot by climbing to its parent race.
  if (race.parent !== null) race = ANCESTRY[race.race] ?? ANCESTRY.human;
  if (!subraceId) return race;
  const sub = ANCESTRY[subraceId];
  if (!sub || sub.parent === null || sub.race !== race.id) return race;
  return merge(race, sub);
}

/** Field-by-field merge so a subrace only needs to state what it changes; every block is complete today. */
function merge(race: AncestryNode, sub: AncestryNode): AncestryNode {
  return {
    id: sub.id,
    name: sub.name,
    race: sub.race,
    parent: sub.parent,
    ranks: { ...race.ranks, ...sub.ranks },
    skin: { ...race.skin, ...sub.skin },
    hair: { ...race.hair, ...sub.hair, styles: [...sub.hair.styles], colors: [...sub.hair.colors] },
    brow: { ...race.brow, ...sub.brow },
    beard: { ...race.beard, ...sub.beard },
    tusk: { ...race.tusk, ...sub.tusk },
    ears: { ...race.ears, ...sub.ears },
    skull: { ...race.skull, ...sub.skull },
    hairPhysics: { ...race.hairPhysics, ...sub.hairPhysics },
    lore: sub.lore ?? race.lore,
  };
}

/** The 4 race nodes ordered by a metric, most first (rank 1 first). */
export function rankOf(metric: MetricName): { id: string; rank: number }[] {
  return RACE_IDS
    .map((id) => ({ id, rank: ANCESTRY[id].ranks[metric] }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * For every metric, the sign of a minus b (race-level ordering): 1 = a has more, -1 = less,
 * 0 = equal. "More" is the SMALLER rank number, so the sign is `rankB - rankA`.
 */
export function compareAncestry(a: string, b: string): Record<MetricName, number> {
  const na = ANCESTRY[a] ?? ANCESTRY.human;
  const nb = ANCESTRY[b] ?? ANCESTRY.human;
  const out = {} as Record<MetricName, number>;
  for (const m of METRICS) out[m] = Math.sign(nb.ranks[m] - na.ranks[m]) || 0;
  return out;
}

/** A deterministic [0,1) hash of a seed: same seed -> same value, no Math.random. */
function hashSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h / 0x100000000;
}

/** How much a curled mass is heavier than a straight one of the same length (curl 1 -> +50%). */
const CURL_MASS_GAIN = 0.5;
/** Peak per-character mass jitter from the seed, so two characters differ by at most +/-8%. */
const SEED_JITTER = 0.08;

/**
 * A character's hair mass in kg: the node's massKg is quoted at stature 1.0, so it is scaled by
 * the race's body volume (stature^3, a shorter body carries a shorter, lighter fall), lifted by
 * curl (a coiled mass holds more air and settles heavier), and jittered by the seed. The seed
 * only ever multiplies, so the ordering between ancestries never flips on a lucky roll.
 */
export function hairMassKg(raceId: string, subraceId: string | null, seed: number): number {
  const node = ancestryOf(raceId, subraceId);
  const stature = STATURES[node.race] ?? 1;
  const jitter = 1 + SEED_JITTER * (hashSeed(seed) * 2 - 1);
  return node.hairPhysics.massKg * stature ** 3 * (1 + CURL_MASS_GAIN * node.hair.curl) * jitter;
}
