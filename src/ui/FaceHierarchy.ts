// FaceHierarchy — the facial-ratio hierarchy of the 16 ancestry nodes, PURE. No DOM, no THREE,
// no Math.random. It reads the `face` block (ranks 1..16) and the hair/beard blocks from
// artifacts/design/ancestry.json via src/game/Ancestry.ts and turns them into the RATIOS and the
// ranked tables the wave-P brief asks for.
//
// The flagged contract ("use agents to debate") is realised HERE as an EXPLICIT multi-criteria
// comparison, not hidden deliberation. The criteria and their order are stated in code and
// published in the report:
//
//   Step 1 — the RAW measures. Every node ranks 17 facial measures 1..16 (Ancestry.FACE_METRICS);
//            rank 1 = the most. rankMetric() publishes the ranked table for one measure.
//   Step 2 — the AMOUNTS. Because rank 1 = most, an "amount" is (NODE_COUNT + 1 - rank): a
//            monotone transform that makes a bigger number mean more of the feature, so two
//            measures can be divided. This is the only transform applied; it is stated, not tuned.
//   Step 3 — the RATIOS. faceRatios() divides one amount by another for a stated pair (the user's
//            "ratio between the chin and the mouth", "mouth to nose", "eye to brow", ...). The
//            ratio list and its ORDER are RATIO_KEYS below.
//   Step 4 — the RANKING. rankRatio() sorts the 16 nodes by one ratio, most first: the published
//            "who has the biggest ratio" table.
//   Step 5 — the DEBATE. compare(a, b) is the adversarial pass: for one pair it states every
//            criterion in RATIO_KEYS order, gives each side's number, the sign (a minus b), and a
//            winner, so a claim about "who wins" is a row a reader can reject or accept.
//
// The hair/beard law (the same brief sentence) is the second half: hairLaw/beardLaw publish the
// ordering "elves lightest and longest, dwarves the fullest beards, humans the widest range,
// orks the barest with the highest bald chance".

import {
  ANCESTRY,
  type AncestryNode,
  FACE_METRICS,
  type FaceMetricName,
} from "../game/Ancestry.ts";

/** The number of ancestry nodes the 1..16 ranks and every ratio table are spread over. */
export const NODE_COUNT = 16;

// Rec.709 luminance of a #rrggbb, 0..255 (the same weighting the rest of the codebase uses).
const LUM = [0.2126, 0.7152, 0.0722] as const;
function luminance(hex: string): number {
  const ch = (i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return LUM[0] * ch(0) + LUM[1] * ch(1) + LUM[2] * ch(2);
}

/** rank 1 = the most, so the division-friendly "amount" is NODE_COUNT + 1 - rank (16..1). */
export function faceAmount(rank: number): number {
  return NODE_COUNT + 1 - rank;
}

/** One row of every published table: the node id and the number being ranked. */
export interface RankRow {
  /** The ancestry node id ("dwarf", "high", ...). */
  id: string;
  /** The value ranked here: a face rank (1..16) for rankMetric, a ratio for rankRatio. */
  value: number;
}

/**
 * The ranked table for one facial measure, most first (rank 1 -> rank 16). This is the raw
 * measure table: `value` is the stored rank. Ties broken by id so the order is total.
 */
export function rankMetric(metric: FaceMetricName): RankRow[] {
  return Object.values(ANCESTRY)
    .map((n) => ({ id: n.id, value: n.face[metric] }))
    .sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
}

/** Every facial ratio of one node, each a division of two amounts (see the header). */
export interface FaceRatios {
  /** chin projection against mouth width - "the ratio between the chin and the mouth". */
  chinToMouth: number;
  /** mouth width against nose width. */
  mouthToNose: number;
  /** eye spacing against brow prominence - "eye to brow". */
  eyeToBrow: number;
  /** nose length against nose width. */
  noseLengthToWidth: number;
  /** brow prominence against forehead height. */
  browToForehead: number;
  /** jaw width against cheek height. */
  jawToCheek: number;
  /** skull width against skull depth. */
  skullWidthToDepth: number;
  /** eye aperture height against eye globe size. */
  eyeHeightToSize: number;
  /** ear size against ear angle. */
  earSizeToAngle: number;
  /** chin height against chin length. */
  chinHeightToLength: number;
}

/** The ratio criteria, in the stated order every comparison and table walks. */
export const RATIO_KEYS: readonly (keyof FaceRatios)[] = [
  "chinToMouth",
  "mouthToNose",
  "eyeToBrow",
  "noseLengthToWidth",
  "browToForehead",
  "jawToCheek",
  "skullWidthToDepth",
  "eyeHeightToSize",
  "earSizeToAngle",
  "chinHeightToLength",
];

/** The plain-language meaning of each criterion (published with the comparison). */
export const RATIO_LABELS: Record<keyof FaceRatios, string> = {
  chinToMouth: "chin length / mouth width",
  mouthToNose: "mouth width / nose width",
  eyeToBrow: "eye spacing / brow prominence",
  noseLengthToWidth: "nose length / nose width",
  browToForehead: "brow prominence / forehead height",
  jawToCheek: "jaw width / cheek height",
  skullWidthToDepth: "skull width / skull depth",
  eyeHeightToSize: "eye aperture height / eye size",
  earSizeToAngle: "ear size / ear angle",
  chinHeightToLength: "chin height / chin length",
};

/** The ratios of one node, computed from its face ranks. Every denominator is >= 1, so finite. */
export function faceRatios(node: AncestryNode): FaceRatios {
  const a = (m: FaceMetricName) => faceAmount(node.face[m]);
  return {
    chinToMouth: a("chinLength") / a("mouthWidth"),
    mouthToNose: a("mouthWidth") / a("noseWidth"),
    eyeToBrow: a("eyeSpacing") / a("browProminence"),
    noseLengthToWidth: a("noseLength") / a("noseWidth"),
    browToForehead: a("browProminence") / a("foreheadHeight"),
    jawToCheek: a("jawWidth") / a("cheekHeight"),
    skullWidthToDepth: a("skullWidth") / a("skullDepth"),
    eyeHeightToSize: a("eyeHeight") / a("eyeSize"),
    earSizeToAngle: a("earSize") / a("earAngle"),
    chinHeightToLength: a("chinHeight") / a("chinLength"),
  };
}

/** The 16 nodes ranked by one ratio, biggest first - the "who has the biggest ratio" table. */
export function rankRatio(key: keyof FaceRatios): RankRow[] {
  return Object.values(ANCESTRY)
    .map((n) => ({ id: n.id, value: faceRatios(n)[key] }))
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
}

/** One criterion's outcome in a pair comparison. */
export interface CriterionRow {
  /** The criterion (a FaceRatios key). */
  criterion: keyof FaceRatios;
  /** What it divides, in words. */
  label: string;
  /** a's ratio and b's ratio. */
  a: number;
  b: number;
  /** Math.sign(a - b): 1 = a bigger, -1 = b bigger, 0 = tie. */
  sign: number;
  /** The winner of this criterion, or null on a tie. */
  winner: string | null;
}

/** The full, stated result of comparing two ancestries. */
export interface FaceComparison {
  a: string;
  b: string;
  /** The criteria, in the stated RATIO_KEYS order. */
  criteria: readonly (keyof FaceRatios)[];
  rows: CriterionRow[];
  /** Per-ancestry wins across the criteria. */
  score: { a: number; b: number; ties: number };
  /** The ancestry winning the most criteria, or null on an exact split. */
  verdict: string | null;
}

/**
 * Compare two ancestry nodes on every stated criterion and return the whole debate: each
 * criterion in RATIO_KEYS order, both numbers, the sign and the winner, then the score and the
 * verdict. Unknown ids fall back to human, exactly like compareAncestry. No hidden weighting:
 * every criterion counts once.
 */
export function compare(aId: string, bId: string): FaceComparison {
  const na = ANCESTRY[aId] ?? ANCESTRY.human;
  const nb = ANCESTRY[bId] ?? ANCESTRY.human;
  const ra = faceRatios(na), rb = faceRatios(nb);
  const rows: CriterionRow[] = RATIO_KEYS.map((c) => {
    const a = ra[c], b = rb[c];
    const sign = Math.sign(a - b);
    return {
      criterion: c,
      label: RATIO_LABELS[c],
      a,
      b,
      sign,
      winner: sign > 0 ? na.id : sign < 0 ? nb.id : null,
    };
  });
  const score = { a: 0, b: 0, ties: 0 };
  for (const r of rows) {
    if (r.sign > 0) score.a++;
    else if (r.sign < 0) score.b++;
    else score.ties++;
  }
  const verdict = score.a === score.b ? null : score.a > score.b ? na.id : nb.id;
  return { a: na.id, b: nb.id, criteria: RATIO_KEYS, rows, score, verdict };
}

// ---------------------------------------------------------------------------------------------
// The hair/beard law (the brief's second sentence).

/** Hair length tiers as a number, so "longest" is rankable (verylong = 4). */
export const HAIR_LENGTH_TIER: Record<AncestryNode["hair"]["length"], number> = {
  bald: 0,
  short: 1,
  medium: 2,
  long: 3,
  verylong: 4,
};

/** The luminance spread of a hair palette (#rrggbb max - min, 0..255) - "widest range". */
export function paletteSpread(hexes: readonly string[]): number {
  if (hexes.length === 0) return 0;
  const lums = hexes.map(luminance);
  return Math.max(...lums) - Math.min(...lums);
}

/** The mean palette lightness of a node (the authored hair.lightness, or the palette's mean). */
export function hairLightness(node: AncestryNode): number {
  if (typeof node.hair.lightness === "number") return node.hair.lightness;
  const lums = node.hair.colors.map(luminance);
  return lums.length ? lums.reduce((s, v) => s + v, 0) / lums.length / 255 : 0.5;
}

/** One row of the hair law: every number the "lightest / longest / widest" claims rest on. */
export interface HairLawRow {
  id: string;
  /** 0..1 mean palette lightness (elves highest). */
  lightness: number;
  /** 0..4 length tier (verylong = 4; elves highest). */
  lengthTier: number;
  /** The physical fall mass in kg (what the length ladder rides at stature 1.0). */
  massKg: number;
  /** 0..255 palette luminance spread (humans widest). */
  spread: number;
  /** 0..1 per-character bald chance (orks highest). */
  baldChance: number;
}

/** The hair law rows for all 16 nodes, in the node order. */
export function hairLaw(): HairLawRow[] {
  return Object.values(ANCESTRY).map((n) => ({
    id: n.id,
    lightness: hairLightness(n),
    lengthTier: HAIR_LENGTH_TIER[n.hair.length],
    massKg: n.hairPhysics.massKg,
    spread: paletteSpread(n.hair.colors),
    baldChance: n.hair.baldChance,
  }));
}

/** The hair law ranked by lightness, lightest first (the elf end of the law). */
export function hairOrder(): HairLawRow[] {
  return hairLaw().sort((a, b) => b.lightness - a.lightness || (a.id < b.id ? -1 : 1));
}

/** One row of the beard law. */
export interface BeardLawRow {
  id: string;
  /** 0..1 composite beard mass (dwarves highest). */
  fullness: number;
  /** true = the ancestry always grows a beard (every dwarf). */
  required: boolean;
  /** 0..1 of the jaw the growth covers. */
  coverage: number;
}

/** The beard law rows for all 16 nodes. */
export function beardLaw(): BeardLawRow[] {
  return Object.values(ANCESTRY).map((n) => ({
    id: n.id,
    fullness: n.beard.fullness ?? 0,
    required: n.beard.required,
    coverage: n.beard.coverage,
  }));
}

/** The beard law ranked by fullness, fullest first (the dwarf end of the law). */
export function beardOrder(): BeardLawRow[] {
  return beardLaw().sort((a, b) => b.fullness - a.fullness || (a.id < b.id ? -1 : 1));
}

/** Re-exported so a caller can walk the metric order without importing Ancestry as well. */
export { FACE_METRICS };
