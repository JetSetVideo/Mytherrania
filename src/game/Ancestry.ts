// The ancestry hierarchy: a race node and its 12 subrace children, each carrying a rank for
// every body-proportion metric plus the eight look specs (skin, hair, brow, beard, tusk, ears,
// skull, hair physics) AND a `face` block - 17 facial measures ranked 1..16 across ALL 16 nodes
// (chin height/length, mouth width, nose length/width, eye spacing/height/size, ear size/angle,
// brow prominence/thickness, forehead height, skull width/depth, jaw width, cheek height). It is
// the data behind "ancestry is visible, not cosmetic" (DESIGN.md item 9) and "races are numbers,
// not meshes" (item 22): every silhouette difference is a rank or a factor here, never a special
// case in the rig. The facial RATIOS and their hierarchy are turned into tables by
// src/ui/FaceHierarchy.ts; the units of each face rank live in FACE_UNITS below.
//
// Pure data + lookups: no Three.js, no DOM, no Math.random. The body rankings must be a strict
// 1..4 ordering across the 4 race nodes for each metric (rank 1 = most of the metric), so a
// race's identity is an ORDERING, not an absolute number that a later tweak could flatten; the
// face rankings are a strict 1..16 ordering across all 16 nodes (validateAncestry asserts both).
//
// Data source: artifacts/design/ancestry.json. The per-part BODY-MEASURE ratios (legToTorso,
// shoulderToHip, ...) stay owned by artifacts/design/race-genes.json / RaceGenes.ts; this module
// only names them in docs/ancestry/HIERARCHY.md and never duplicates their numbers.

import ancestryRaw from "../../artifacts/design/ancestry.json" with { type: "json" };

export type MetricName =
  | "height"
  | "thinness"
  | "legLength"
  | "armLength"
  | "shoulderWidth"
  | "torsoMass"
  | "skullProminence"
  | "browProminence"
  | "hairLength"
  | "beardCoverage"
  | "earLength"
  | "tuskProtrusion"
  | "skinDepth";

export interface SkinSpec {
  base: string; // "#rrggbb" mid-tone of the race's skin
  range: string[]; // 3-5 tones a character may be drawn in (first = most common)
  crease: string; // the darkening colour at a joint/fold crossing
  creaseStrength: number; // 0..1 how strongly the creases read
  zones: ("under-eye" | "cheek-fold" | "neck" | "joint" | "knuckle" | "brow")[];
}
export interface HairSpec {
  length: "bald" | "short" | "medium" | "long" | "verylong";
  styles: string[]; // HairStyle ids from src/game/RaceAppearance.ts
  colors: string[]; // 3-6 "#rrggbb" a character may draw from
  curl: number; // 0 straight .. 1 coiled
  density: number; // 0..1 thickness of the mass
  baldChance: number; // 0..1 per character (orks highest, elves 0)
  // 0..1 mean perceptual lightness of `colors` (#rrggbb -> Rec.709 luminance / 255). The
  // hair/beard law "elves lightest, orks darkest" is this number, ranked. OPTIONAL in the
  // type only because hand-built HairSpec literals elsewhere omit it; the JSON always
  // carries it and FaceHierarchy validates it (a missing field falls back to the palette).
  lightness?: number;
}
export interface BrowSpec {
  length: number;
  thickness: number;
  prominence: number;
  tipPastFace: number;
}
export interface BeardSpec {
  mode: "none" | "chin" | "moustache-thin" | "moustache" | "full";
  coverage: number; // 0..1 of the jaw the growth covers
  lengthMul: number; // multiplier on the beard mass
  required: boolean; // true = this ancestry always grows it
  allowed: boolean; // false = never, whatever the character says
  // 0..1 composite beard mass (coverage x lengthMul, normalised). The "dwarves fullest"
  // end of the hair/beard law is this number, ranked. Optional in the type for the same
  // reason as HairSpec.lightness; present in every JSON node and validated.
  fullness?: number;
}
export interface TuskSpec {
  count: 0 | 2 | 4;
  protrusion: number;
  direction: "up" | "out" | "down";
}
export interface EarSpec {
  lengthMul: number;
  pointed: number;
  droop: number;
}
export interface SkullSpec {
  massMul: number;
  browRidge: number;
  jawWidth: number;
}
export interface HairPhysicsSpec {
  massKg: number;
  stiffness: number;
  damp: number;
  windGain: number;
}

/**
 * The 17 facial measures the ratio hierarchy is built on. Each is stored per node as a RANK
 * 1..16 across ALL 16 ancestry nodes (rank 1 = the most of that measure), so races and
 * subraces sit in ONE ranking. Units are physical (see FACE_UNITS); the rank orders them.
 */
export type FaceMetricName =
  | "chinHeight"
  | "chinLength"
  | "mouthWidth"
  | "noseLength"
  | "noseWidth"
  | "eyeSpacing"
  | "eyeHeight"
  | "eyeSize"
  | "earSize"
  | "earAngle"
  | "browProminence"
  | "browThickness"
  | "foreheadHeight"
  | "skullWidth"
  | "skullDepth"
  | "jawWidth"
  | "cheekHeight";

/** A node's face block: every FaceMetricName -> its rank 1..16 (rank 1 = the most). */
export type FaceSpec = Record<FaceMetricName, number>;

export interface AncestryNode {
  id: string; // "elf" | "high" | ...
  name: string; // "Elf" | "High Elf" | ...
  race: string; // parent race id; equals id for a race node
  parent: string | null; // null for a race node
  ranks: Record<MetricName, number>; // 1 = the most of this metric; 0 = unranked
  face: FaceSpec; // 1 = the most of that facial measure, ranked over all 16 nodes
  skin: SkinSpec;
  hair: HairSpec;
  brow: BrowSpec;
  beard: BeardSpec;
  tusk: TuskSpec;
  ears: EarSpec;
  skull: SkullSpec;
  hairPhysics: HairPhysicsSpec;
  lore: string; // one sentence, in the game's voice
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
  "height",
  "thinness",
  "legLength",
  "armLength",
  "shoulderWidth",
  "torsoMass",
  "skullProminence",
  "browProminence",
  "hairLength",
  "beardCoverage",
  "earLength",
  "tuskProtrusion",
  "skinDepth",
];

/** The 17 facial measures a node is ranked on, in the order the ranked table is published. */
export const FACE_METRICS: readonly FaceMetricName[] = [
  "chinHeight",
  "chinLength",
  "mouthWidth",
  "noseLength",
  "noseWidth",
  "eyeSpacing",
  "eyeHeight",
  "eyeSize",
  "earSize",
  "earAngle",
  "browProminence",
  "browThickness",
  "foreheadHeight",
  "skullWidth",
  "skullDepth",
  "jawWidth",
  "cheekHeight",
];

/**
 * The unit each facial RANK orders (why each is a physical quantity, not a bare number). The
 * JSON stores the rank 1..16; these strings state what is being ranked so the table reads with
 * units. mm on the game's base skull; earAngle in degrees. Rank 1 = the most of the measure.
 */
export const FACE_UNITS: Record<FaceMetricName, string> = {
  chinHeight: "mm - vertical chin block below the mouth line",
  chinLength: "mm - forward projection of the chin past the lower lip",
  mouthWidth: "mm - mouth corner to corner",
  noseLength: "mm - bridge (nasion) to tip",
  noseWidth: "mm - widest alar span",
  eyeSpacing: "mm - pupil centre to pupil centre",
  eyeHeight: "mm - visible palpebral aperture height",
  eyeSize: "mm - globe diameter",
  earSize: "mm - helix tip to lobe",
  earAngle: "deg - lift of the ear off the skull",
  browProminence: "mm - forward projection of the brow ridge",
  browThickness: "mm - vertical thickness of the brow band",
  foreheadHeight: "mm - hairline to the brow ridge",
  skullWidth: "mm - biparietal (widest) width",
  skullDepth: "mm - glabella to inion",
  jawWidth: "mm - bigonial (jaw corner) width",
  cheekHeight: "mm - zygomatic (cheekbone) prominence height",
};

const RAW = ancestryRaw as unknown as AncestryFile;

/**
 * Validate the new face block and the extended hair/beard fields against the frozen contract:
 * every one of the 16 nodes carries every face metric as an integer in [1,16], each metric is a
 * strict permutation of {1..16} across the 16 nodes (no tie, no zero), and every node states a
 * finite hair.lightness and beard.fullness in [0,1]. Returns the list of problems; empty = OK.
 * Pure, read-only, no throw on import: FaceHierarchy and the tests call it and assert zero.
 */
export function validateAncestry(): string[] {
  const problems: string[] = [];
  const ids = Object.keys(ANCESTRY);
  for (const id of ids) {
    const n = ANCESTRY[id];
    for (const m of FACE_METRICS) {
      const r = n.face?.[m];
      if (!Number.isInteger(r) || r < 1 || r > 16) {
        problems.push(`${id}.face.${m} = ${r} must be an integer 1..16`);
      }
    }
    const l = n.hair.lightness;
    if (typeof l !== "number" || !Number.isFinite(l) || l < 0 || l > 1) {
      problems.push(`${id}.hair.lightness = ${l} must be 0..1`);
    }
    const f = n.beard.fullness;
    if (typeof f !== "number" || !Number.isFinite(f) || f < 0 || f > 1) {
      problems.push(`${id}.beard.fullness = ${f} must be 0..1`);
    }
  }
  for (const m of FACE_METRICS) {
    const ranks = ids.map((id) => ANCESTRY[id].face[m]);
    if (new Set(ranks).size !== 16) {
      problems.push(`face metric ${m} is not a strict 1..16 permutation across the 16 nodes`);
    }
  }
  return problems;
}

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
    face: { ...race.face, ...sub.face },
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
