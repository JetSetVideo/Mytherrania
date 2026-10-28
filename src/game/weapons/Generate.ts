// Weapon generator (W06): sample a weapon inside its archetype's physical ranges, derive its
// form (geometry + mass layout), balance, inertia, grips and strike features, and name it.
// Deterministic: the same (archetype, seed) always gives the same weapon, and rollWeapon draws
// the archetype and the seed from the caller's rng, so a seeded rng gives a repeatable roll.

import type { ArchetypeId, GripMode, V3, WeaponClass, WeaponSpec } from "../../combat/contracts.ts";
import { clamp, clamp01, invLerp, lerp, rng32 } from "../../core/MathCore.ts";
import type { MetalName } from "../WeaponGen.ts";
import { METALS } from "../WeaponGen.ts";
import { ARCHETYPE_IDS, ARCHETYPES, type AxisRange } from "./Archetypes.ts";
import { strikeFeatures } from "./Features.ts";
import {
  buildForm, type FormDetails, formDetails, forwardLength, type PhysicalAxes, resolveGrips, type WeaponForm,
} from "./Form.ts";

/** Options for rollWeapon / weaponFromArchetype. Every field is optional. */
export interface RollOptions {
  /** Only roll archetypes of these classes. */
  classes?: WeaponClass[];
  /** Only roll these archetypes (intersected with `classes`). */
  archetypes?: ArchetypeId[];
  /** Force the head metal (ignored when the archetype cannot use it). */
  metal?: MetalName;
  /** Use this seed instead of drawing one from the rng. */
  seed?: number;
  /** 0..1 pull on the size latent (0 = small end of every range, 1 = large end). */
  size?: number;
}

/** A WeaponSpec as generated here: the contract fields plus the one axis the contract lacks. */
export interface GeneratedSpec extends WeaponSpec {
  /** Radial extent of the striking part from the axis, m (see Archetypes.ts). */
  headRadius: number;
}

/** Salt for the look-only stream, so look choices never shift the physical axes. */
export const FORM_SALT = 0x9e3779b9;
/** How strongly the size latent drives each axis (the rest is independent noise). */
export const SIZE_TO_MASS = 0.7;
export const SIZE_TO_HEAD = 0.6;
/** How strongly the metal's edge quality drives sharpness (the rest is the smith's luck). */
export const METAL_TO_SHARPNESS = 0.4;
/** Pull of an explicit opts.size on the size latent (keeps 25% of the roll random). */
export const SIZE_OPTION_PULL = 0.75;

/**
 * Edge quality 0..1 by metal: how keen an edge it takes and holds. Obsidian takes the keenest
 * edge known (but is brittle), hardened steel next; iron and bronze are softer; silver and
 * gold are soft decorative metals.
 */
export const METAL_EDGE_QUALITY: Record<MetalName, number> = {
  obsidian: 1, steel: 0.85, iron: 0.6, bronze: 0.5, silver: 0.35, gold: 0.2,
};
/** Relative frequency of each metal in a roll (a design parameter: gold is rare). */
export const METAL_RARITY: Record<MetalName, number> = {
  steel: 0.35, iron: 0.25, bronze: 0.15, silver: 0.1, gold: 0.05, obsidian: 0.1,
};

// --- bow physics (named base parameters) ---
/** Share of the stored draw energy (1/2 F d for a linear draw) that leaves with the arrow. */
export const BOW_EFFICIENCY = 0.7;
/** Arrow mass per newton of draw force, kg/N (~9 grains per lbf, the war-arrow rule of thumb). */
export const ARROW_MASS_PER_NEWTON = 1.3e-4;
/** Nock + raise + aim time common to every bow, s. */
export const BOW_AIM_TIME = 0.45;
/** Draw speed of a light (F_REF) bow, m/s; heavier bows draw slower as sqrt(F / F_REF). */
export const DRAW_SPEED = 1.2;
export const DRAW_FORCE_REF = 300;

function pickWeighted<T>(items: readonly T[], weights: readonly number[], u: number): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = u * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

const within = (r: AxisRange, t: number) => lerp(r.min, r.max, clamp01(t));

/** The archetypes `opts` allows (all of them when unrestricted; throws when nothing is left). */
export function candidateArchetypes(opts: RollOptions = {}): ArchetypeId[] {
  const pool = ARCHETYPE_IDS.filter((id) =>
    (!opts.classes || opts.classes.includes(ARCHETYPES[id].weaponClass)) &&
    (!opts.archetypes || opts.archetypes.includes(id))
  );
  if (pool.length === 0) throw new Error("rollWeapon: the options exclude every archetype");
  return pool;
}

/** Sampled axes + materials of one weapon (from the main stream of its seed). */
export interface SampledAxes {
  axes: PhysicalAxes;
  metal: MetalName;
  fitting: MetalName;
  ranged?: { speed: number; drawTime: number; projectileMass: number };
}

/**
 * Sample every axis inside the archetype's ranges. Correlations: one SIZE latent u drives
 * length fully, mass at SIZE_TO_MASS, head length at SIZE_TO_HEAD (longer -> heavier, longer
 * head); head radius follows the mass; the metal's density shifts the mass and its edge quality
 * the sharpness; curvature is drawn only where the range allows it (curved families).
 * Blades then fit the hilt: handle = length - blade - guard - pommel stays in the hilt range.
 */
export function sampleAxes(id: ArchetypeId, rng: () => number, opts: RollOptions = {}): SampledAxes {
  const a = ARCHETYPES[id];
  const ax = a.axes;
  const u = opts.size === undefined ? rng() : clamp01(lerp(rng(), opts.size, SIZE_OPTION_PULL));
  const metal = opts.metal && a.metals.includes(opts.metal)
    ? opts.metal
    : pickWeighted(a.metals, a.metals.map((m) => METAL_RARITY[m]), rng());
  const fitting = rng() < 0.5 ? metal : a.metals[Math.floor(rng() * a.metals.length) % a.metals.length];
  const density = METALS[metal].weightBias - 1; // gold +0.25 -> heavier, obsidian -0.1 -> lighter
  let length = within(ax.length, u);
  const massT = clamp01(SIZE_TO_MASS * u + (1 - SIZE_TO_MASS) * rng() + density);
  const mass = within(ax.mass, massT);
  const headT = clamp01(SIZE_TO_HEAD * u + (1 - SIZE_TO_HEAD) * rng());
  let headLength = within(ax.headLength, headT);
  const headRadius = within(ax.headRadius, 0.5 * massT + 0.5 * rng());
  const sharpness = within(ax.sharpness, (1 - METAL_TO_SHARPNESS) * rng() + METAL_TO_SHARPNESS * METAL_EDGE_QUALITY[metal]);
  const curvature = ax.curvature.max > ax.curvature.min ? within(ax.curvature, rng()) : ax.curvature.min;
  const balanceFraction = within(ax.balanceFraction, 0.5 * rng() + 0.5 * headT);

  if (a.hilt) {
    const fixedLen = a.hilt.guardThickness + a.hilt.pommelLength;
    const hMin = a.hilt.handle.min, hMax = a.hilt.handle.max;
    // Keep the handle in range by moving the blade (inside its range), then the length.
    if (length - fixedLen - headLength < hMin) headLength = Math.max(ax.headLength.min, length - fixedLen - hMin);
    if (length - fixedLen - headLength > hMax) headLength = Math.min(ax.headLength.max, length - fixedLen - hMax);
    length = clamp(length, headLength + fixedLen + hMin, headLength + fixedLen + hMax);
  }

  let ranged: SampledAxes["ranged"];
  if (a.ranged) {
    const r = a.ranged;
    const force = within(r.drawForce, 0.7 * u + 0.3 * rng());
    const draw = within(r.drawLength, 0.6 * u + 0.4 * rng());
    const arrow = clamp(ARROW_MASS_PER_NEWTON * force * lerp(0.85, 1.15, rng()), r.arrowMass.min, r.arrowMass.max);
    // 1/2 m v^2 = eta * 1/2 F d  ->  v = sqrt(eta F d / m)
    const speed = Math.sqrt((BOW_EFFICIENCY * force * draw) / arrow);
    const drawTime = BOW_AIM_TIME + (draw / DRAW_SPEED) * Math.sqrt(force / DRAW_FORCE_REF);
    ranged = { speed, drawTime, projectileMass: arrow };
  }
  return {
    axes: { length, mass, headLength, sharpness, curvature, headRadius, balanceFraction },
    metal, fitting, ranged,
  };
}

const METAL_WORD: Record<MetalName, string> = {
  steel: "Steel", iron: "Iron", bronze: "Bronze", silver: "Silver", gold: "Gilded", obsidian: "Obsidian",
};

/**
 * A readable name: [qualifier] material noun. The qualifier is the most distinctive axis:
 * a curved shape first, then keenness, then an extreme of mass or length (top/bottom 15%).
 */
export function weaponName(id: ArchetypeId, axes: PhysicalAxes, metal: MetalName, details: FormDetails): string {
  const a = ARCHETYPES[id];
  const t = (k: keyof PhysicalAxes) => {
    const r = a.axes[k as keyof typeof a.axes];
    return r.max > r.min ? invLerp(r.min, r.max, axes[k]) : 0.5;
  };
  const wooden = a.family === "bow" || a.family === "staff";
  const material = wooden ? details.wood[0].toUpperCase() + details.wood.slice(1) : METAL_WORD[metal];
  let noun = a.noun;
  if (id === "bow") noun = axes.length >= 1.7 ? "Longbow" : axes.length <= 1.4 ? "Shortbow" : "Bow";
  const q: string[] = [];
  if (id === "sabre" || id === "dagger") { if (axes.curvature > 0.2 && t("curvature") > 0.6) q.push("Curved"); }
  if (id === "axe" || id === "greataxe") q.push(axes.curvature > 0.45 ? "Crescent" : axes.curvature < 0.25 ? "Bearded" : "");
  if (id === "scythe" && t("curvature") > 0.75) q.push("Reaping");
  if (id === "warhammer" && axes.curvature > 0.25) q.push("Beaked");
  if (id === "bow" && axes.curvature > 0.5) q.push("Recurve");
  if (id === "staff") q.push("Ironshod");
  if (axes.sharpness >= 0.92) q.push("Keen");
  if (t("mass") > 0.85) q.push("Heavy");
  if (t("length") > 0.85) q.push("Long");
  if (t("mass") < 0.15) q.push("Light");
  if (t("length") < 0.15) q.push("Short");
  const qualifier = q.find((w) => w !== "");
  return `${qualifier ? qualifier + " " : ""}${material} ${noun}`;
}

/** Build a weapon from an archetype and a seed (the canonical, reproducible entry point). */
export function weaponFromSeed(id: ArchetypeId, seed: number, opts: RollOptions = {}): GeneratedSpec {
  const a = ARCHETYPES[id];
  const s = seed >>> 0;
  const sampled = sampleAxes(id, rng32(s), opts);
  const details = formDetails(id, sampled.axes, rng32((s ^ FORM_SALT) >>> 0));
  const form = buildForm(id, sampled.axes, details);
  const spec: GeneratedSpec = {
    id: `${id}-${s.toString(36)}`,
    name: weaponName(id, sampled.axes, sampled.metal, details),
    archetype: id,
    weaponClass: a.weaponClass,
    seed: s,
    length: sampled.axes.length,
    mass: sampled.axes.mass,
    balance: form.balance,
    inertia: form.inertia,
    headLength: sampled.axes.headLength,
    sharpness: sampled.axes.sharpness,
    curvature: sampled.axes.curvature,
    hands: a.hands,
    grips: resolveGrips(id, form),
    features: strikeFeatures(id, sampled.axes, form),
    metal: sampled.metal,
    fitting: sampled.fitting,
    headRadius: sampled.axes.headRadius,
  };
  if (sampled.ranged) spec.ranged = sampled.ranged;
  return spec;
}

/** Draw a 32-bit seed from an rng. */
export function drawSeed(rng: () => number): number {
  return Math.floor(rng() * 4294967296) >>> 0;
}

/** Contract: a weapon of one archetype; the seed comes from `opts.seed` or the rng. */
export function weaponFromArchetype(id: ArchetypeId, rng: () => number, opts: RollOptions = {}): GeneratedSpec {
  return weaponFromSeed(id, opts.seed ?? drawSeed(rng), opts);
}

/** Contract: a random weapon; the archetype is drawn by rollWeight among the allowed ones. */
export function rollWeapon(rng: () => number, opts: RollOptions = {}): GeneratedSpec {
  const pool = candidateArchetypes(opts);
  const id = pickWeighted(pool, pool.map((p) => ARCHETYPES[p].rollWeight), rng());
  return weaponFromArchetype(id, rng, opts);
}

/**
 * The axes of an existing spec. `headRadius` is not a contract field: generated specs carry
 * it; a hand-built spec falls back to the middle of the archetype's range.
 */
export function axesOfSpec(spec: WeaponSpec): PhysicalAxes {
  const range = ARCHETYPES[spec.archetype].axes.headRadius;
  const headRadius = (spec as Partial<GeneratedSpec>).headRadius ?? (range.min + range.max) / 2;
  const axes: PhysicalAxes = {
    length: spec.length, mass: spec.mass, headLength: spec.headLength, sharpness: spec.sharpness,
    curvature: spec.curvature, headRadius, balanceFraction: 0,
  };
  axes.balanceFraction = spec.balance / forwardLength(spec.archetype, axes);
  return axes;
}

/** Re-derive the form of a spec (the mesh uses this; same seed -> same look details). */
export function weaponForm(spec: WeaponSpec): WeaponForm {
  const axes = axesOfSpec(spec);
  return buildForm(spec.archetype, axes, formDetails(spec.archetype, axes, rng32((spec.seed ^ FORM_SALT) >>> 0)));
}

/** The grip mode the weapon prefers at its main grip (dagger: "reverse"). */
export function preferredGrip(spec: WeaponSpec): GripMode {
  return spec.grips.find((g) => g.id === "main")?.modes[0] ?? "forward";
}

/**
 * Local rotation (Euler XYZ, rad) to apply to the weapon node for a grip mode. Reverse =
 * half a turn about the local z axis: the blade points down out of the little-finger side and
 * the edge still faces +z (outward), the classic edge-out ice-pick grip.
 */
export function gripModeRotation(mode: GripMode): V3 {
  return mode === "reverse" ? [0, 0, Math.PI] : [0, 0, 0];
}
