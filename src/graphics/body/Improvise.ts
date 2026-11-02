// Improvisation (wave V, lane B): the 80/20 keep-or-explore pass over the body's SHAPE parameters.
// Pure module: no THREE, no Math.random.
//
// The user's rule: "80 % you keep them or change them slightly only, and 20 % you explore". Every
// shape parameter below hangs off the anatomy hierarchy  part -> muscle -> knob  (the same tree
// AnatomyParts builds: trunk / arm / leg, then the named muscle volumes, then one knob of that
// volume). For a seed:
//   * in EACH part, exactly EXPLORE_SHARE of its knobs (round(0.2·n), picked by a seeded hash rank)
//     are EXPLORED: drawn uniformly inside the knob's own [min, max];
//   * every other knob is KEPT: 1 + KEEP_JITTER·(2u − 1) (± 3 %), clamped to the same bounds.
// So two fighters of one race differ in DETAIL (a longer biceps, a deeper elbow fossa, a sharper
// pectoral edge), not only in scale. Deterministic per (seed, knob id); left and right share the
// value (the body stays mirror-symmetric — another lane owns the symmetry pass).
//
// Mass neutrality by construction (each kind says what it may touch):
//   shape   an ellipsoid's long axis × v and both cross axes × 1/√v  -> its volume is unchanged
//   girth   one cross axis × v, the other × 1/v                       -> volume unchanged
//   place   the volume slides along its bone by (v − 1) × the segment length -> volume unchanged
//   blend   an INTERNAL muscle smooth-union width × v (never a joint the abduction solve reads)
//   depth   a bony landmark's front-to-back semi-axis × v (the knee condyles; ±10 %, the frontal
//           outline — the leg-gap solve's input — is untouched)
//   paint   a form-paint gain on one region (paint/FormShade: the groove darkening or the ridge wear) —
//           no geometry at all
//   groove  a cutter's depth (or width) × v. Cutters are subtracted: the hitbox/ragdoll fit ignores them
//           (combat/Hitboxes.positivePrimitives), so a groove never moves a mass.
// The residual (unions overlap a little more or less) is MEASURED by tests/wave_v_body_forms_test.ts.

/** Share of each part's knobs that is explored (the "20 %"). */
export const EXPLORE_SHARE = 0.2;
/** Half-width of the keep jitter: kept knobs move by at most ± this fraction (the "change slightly"). */
export const KEEP_JITTER = 0.03;

export type KnobKind = "shape" | "girth" | "place" | "blend" | "groove" | "depth" | "paint";

/** One knob of one muscle of one part. `min`/`max` bound BOTH the kept and the explored value. */
export interface ShapeKnob {
  id: string;
  part: "trunk" | "arm" | "leg";
  muscle: string;
  kind: KnobKind;
  min: number;
  max: number;
}

const k = (part: ShapeKnob["part"], muscle: string, kind: KnobKind, min: number, max: number): ShapeKnob =>
  ({ id: `${part}.${muscle}.${kind}`, part, muscle, kind, min, max });

/**
 * The knob table: 10 per limb part and 5 for the trunk (2 + 2 + 1 explored, 5 of 25 in all = exactly
 * 20 %). Bounds are stated per knob: shape/girth stay within ±18 % (a belly can be longer-and-slimmer,
 * never bigger), place within ±6 % of the segment, blend 0.65..1.35 of the internal width, groove
 * 0.5..1.6 of depth, paint 0.6..1.5 of the stated form-paint magnitude.
 */
export const SHAPE_KNOBS: readonly ShapeKnob[] = [
  // trunk: the torso GEOMETRY stays pre-wave (AnatomyParts.torsoNode says why, with numbers); the trunk
  // improvises its sternocleidomastoid blend and the PAINTED form (FormShade gains per region).
  k("trunk", "sternocleidomastoid", "blend", 0.7, 1.3),
  k("trunk", "torso", "paint", 0.6, 1.5),
  k("trunk", "torsoWear", "paint", 0.6, 1.5),
  k("trunk", "pelvis", "paint", 0.6, 1.5),
  k("trunk", "neck", "paint", 0.6, 1.5),
  // arm
  k("arm", "biceps", "shape", 0.84, 1.16),
  k("arm", "biceps", "place", 0.95, 1.05),
  k("arm", "biceps", "blend", 0.7, 1.3),
  k("arm", "triceps", "shape", 0.84, 1.16),
  k("arm", "triceps", "place", 0.95, 1.05),
  k("arm", "flexor", "shape", 0.85, 1.15),
  k("arm", "flexor", "place", 0.94, 1.06),
  k("arm", "brachioradialis", "girth", 0.88, 1.12),
  k("arm", "muscles", "blend", 0.65, 1.35),
  k("arm", "fossa", "groove", 0.5, 1.6),
  // leg
  k("leg", "condyles", "depth", 0.9, 1.1),
  k("leg", "patella", "shape", 0.85, 1.15),
  k("leg", "vastusMedialis", "shape", 0.82, 1.18),
  k("leg", "poplitealWidth", "groove", 0.8, 1.25),
  k("leg", "calfMedial", "shape", 0.84, 1.16),
  k("leg", "calfMedial", "place", 0.95, 1.05),
  k("leg", "calfLateral", "place", 0.95, 1.05),
  k("leg", "calfLateral", "girth", 0.88, 1.12),
  k("leg", "muscles", "blend", 0.65, 1.35),
  k("leg", "popliteal", "groove", 0.5, 1.6),
];

/** The drawn values for one seed: value per knob id, and which ids were explored. */
export interface Improvisation {
  seed: number;
  values: Readonly<Record<string, number>>;
  explored: readonly string[];
}

/** FNV-1a of a string, then a 32-bit avalanche mixed with the seed: a stable hash in [0, 1). */
export function knobHash(seed: number, id: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The 80/20 pass for `seed` over `knobs` (default SHAPE_KNOBS). Deterministic; see the module comment. */
export function improvise(seed: number, knobs: readonly ShapeKnob[] = SHAPE_KNOBS): Improvisation {
  const values: Record<string, number> = {};
  const explored: string[] = [];
  const parts = [...new Set(knobs.map((kn) => kn.part))];
  for (const part of parts) {
    const own = knobs.filter((kn) => kn.part === part);
    const n = Math.round(EXPLORE_SHARE * own.length);
    // Rank this part's knobs by a seeded hash; the first n are explored.
    const ranked = [...own].sort((a, b) => knobHash(seed, a.id, 1) - knobHash(seed, b.id, 1) || (a.id < b.id ? -1 : 1));
    const pick = new Set(ranked.slice(0, n).map((kn) => kn.id));
    for (const kn of own) {
      const u = knobHash(seed, kn.id, 2);
      if (pick.has(kn.id)) {
        values[kn.id] = kn.min + u * (kn.max - kn.min);
        explored.push(kn.id);
      } else {
        values[kn.id] = clamp(1 + KEEP_JITTER * (2 * u - 1), kn.min, kn.max);
      }
    }
  }
  return { seed, values, explored };
}

const CACHE = new Map<number, Improvisation>();
/** Cached improvisation of a seed (the anatomy solve calls the part builders dozens of times). */
export function improvisationFor(seed: number): Improvisation {
  let hit = CACHE.get(seed);
  if (!hit) {
    hit = improvise(seed);
    CACHE.set(seed, hit);
    if (CACHE.size > 64) CACHE.delete(CACHE.keys().next().value!);
  }
  return hit;
}

/** A knob's value (1 when the knob is unknown, so a renamed knob degrades to the base shape). */
export function knob(imp: Improvisation, id: string): number {
  return imp.values[id] ?? 1;
}

/** Ellipsoid semi-axes [x, y(long), z] reshaped by a `shape` value v: long × v, cross × 1/√v (volume kept). */
export function reshapeLong(size: [number, number, number], v: number): [number, number, number] {
  const s = 1 / Math.sqrt(v);
  return [size[0] * s, size[1] * v, size[2] * s];
}

/**
 * Ellipsoid semi-axes reshaped by a `shape` value v WITHOUT touching x: long (y) × v, depth (z) × 1/v
 * (volume kept). Used where the medial-lateral extent is another solver's input (the thigh).
 */
export function reshapeDepth(size: [number, number, number], v: number): [number, number, number] {
  return [size[0], size[1] * v, size[2] / v];
}

/** Ellipsoid semi-axes reshaped by a `girth` value v: x × v, z × 1/v (volume kept). */
export function reshapeGirth(size: [number, number, number], v: number): [number, number, number] {
  return [size[0] * v, size[1], size[2] / v];
}

/**
 * The trunk's seeded FORM-PAINT gains (the "paint" knobs) as FormShade.regionGain: the torso's groove
 * darkening and ridge wear, the pelvis and the neck (both terms). Gains stay inside the knobs' bounds,
 * so the paint never exceeds 1.5 × its stated magnitude (still under one cel band step).
 */
export function formGainsFor(seed: number): Record<string, { cavity: number; ridge: number }> {
  const imp = improvisationFor(seed);
  const v = (id: string) => knob(imp, id);
  return {
    torso: { cavity: v("trunk.torso.paint"), ridge: v("trunk.torsoWear.paint") },
    pelvis: { cavity: v("trunk.pelvis.paint"), ridge: v("trunk.pelvis.paint") },
    neck: { cavity: v("trunk.neck.paint"), ridge: v("trunk.neck.paint") },
  };
}
