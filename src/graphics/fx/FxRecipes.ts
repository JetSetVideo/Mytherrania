// Skill -> effect recipe and effect intensities. PURE: no Three.js, no DOM.
//
// Every skill gets an effect. The KIND picks the recipe (which layers draw); the
// skill's own parameters (lunge speed, damage, knockback, armour, timing) set how
// big, long and bright each layer is. Nothing here is a free constant: every
// output is an equation over the skill, normalised against the whole roster's
// min..max so the strongest skill in the game reads as the strongest effect.
//
// Vocabulary:
//   layer        one drawable piece of an effect (telegraph, body trail, ...).
//   recipe       the set of layers a skill kind draws.
//   travel       signed metres the body moves along the aim line (= animation.lunge;
//                negative = backward, e.g. Rolling Shot).
//   travelTime   seconds from skill start until the body has covered
//                ARRIVAL_SHARE of its travel (read off lungeAt, not copied).
//   strikeTime   seconds from skill start to the hit frame = hitAt * duration.
//   metric_N     a metric normalised over the roster: (v - min) / (max - min) in 0..1.
//   afterglow    extra fraction of travelTime a trail stays visible after arrival.

import { lungeAt } from "../../game/AnimationCurve.ts";
import { ALL_SKILLS, ELEMENTS, type Element, type Skill, type SkillAnimation, type SkillKind } from "../../game/Skills.ts";
import type { WeaponPart } from "../../game/WeaponGen.ts";
import { clamp01, lerp, smoothstep } from "../../core/MathCore.ts";

/** One drawable piece of a skill effect. */
export type FxLayer =
  | "telegraph" // ground arrow from origin to landing point, fills over the wind-up
  | "bodyTrail" // ribbon from hips to shoulders along the travelled path
  | "afterimages" // fading ghost silhouettes left along the path
  | "speedLines" // streaks parallel to the travel direction around the body
  | "weaponTrail" // ribbon swept by the blade base..tip
  | "impactRing" // expanding ground ring at the arrival / strike point
  | "shieldArc"; // shimmering partial cylinder in front of the body

/** The layers one skill kind draws. `name` is the player-facing effect family. */
export interface FxRecipe {
  name: "charge" | "strike" | "ward";
  layers: readonly FxLayer[];
}

/**
 * Kind -> recipe. dash: telegraph + body trail + afterimages (+ speed lines, the
 * blade trail and an arrival ring); power: weapon arc trail + impact ring;
 * defense: shield shimmer arc + a bracing ring at the feet.
 */
export const FX_RECIPES: Readonly<Record<SkillKind, FxRecipe>> = {
  dash: { name: "charge", layers: ["telegraph", "bodyTrail", "afterimages", "speedLines", "weaponTrail", "impactRing"] },
  power: { name: "strike", layers: ["weaponTrail", "impactRing"] },
  defense: { name: "ward", layers: ["shieldArc", "impactRing"] },
};

/** The recipe for a skill kind. Throws for a kind with no recipe (so a new kind cannot ship without an effect). */
export function recipeForKind(kind: SkillKind): FxRecipe {
  const recipe = (FX_RECIPES as Record<string, FxRecipe | undefined>)[kind];
  if (!recipe) throw new Error(`no fx recipe for skill kind "${kind}"`);
  return recipe;
}

/** True when `recipe` draws `layer`. */
export function hasLayer(recipe: FxRecipe, layer: FxLayer): boolean {
  return recipe.layers.includes(layer);
}

// ---------------------------------------------------------------------------
// Base parameters (R08). Everything below is derived from these.
// ---------------------------------------------------------------------------

/** The body counts as arrived once it has covered 98% of its travel (the eased tail is invisible). */
export const ARRIVAL_SHARE = 0.98;
/** Ghost silhouettes per dash, slowest..fastest skill (brief: 3-5). */
export const GHOST_COUNT_MIN = 3;
export const GHOST_COUNT_MAX = 5;
/** Speed streaks around the body, slowest..fastest dash. */
export const SPEED_LINES_MIN = 4;
export const SPEED_LINES_MAX = 10;
/** Afterglow range: the trail outlives arrival by 50%..100% of travelTime, dimmest..brightest skill. */
export const AFTERGLOW_MIN = 0.5;
export const AFTERGLOW_MAX = 1.0;
/** Ghosts fade at this share of the trail lifetime, so the echoes clear before the ribbon does. */
export const GHOST_LIFETIME_SHARE = 0.6;
/** Weapon trail lifetime as a share of strikeTime, lightest..heaviest hit. */
export const WEAPON_TRAIL_SHARE_MIN = 0.5;
export const WEAPON_TRAIL_SHARE_MAX = 1.0;
/** Brightness gain range, dimmest..brightest skill (kept <= 1: the hue must stay dominant, never wash to white). */
export const BRIGHTNESS_MIN = 0.55;
export const BRIGHTNESS_MAX = 1.0;
/** The ribbon never reaches closer to the grip than this share of the blade's tip distance (keeps it off the fist). */
export const MIN_TRAIL_BASE_SHARE = 0.35;
/** Resolution of the arrival search over lungeAt (1/200 of the animation ≈ 2.5 ms on a 0.5 s dash). */
const ARRIVAL_SEARCH_STEPS = 200;

/**
 * Body landmarks as fractions of standing height H (Drillis & Contini segment
 * proportions): hip joint 0.530 H, shoulder 0.818 H, shoulder breadth 0.259 H.
 */
export const HIP_HEIGHT_SHARE = 0.530;
export const SHOULDER_HEIGHT_SHARE = 0.818;
export const SHOULDER_BREADTH_SHARE = 0.259;

/** Metres above the SOLES for a fighter of standing height `height` (m). */
export interface BodyLandmarks {
  /** Hip joint height above the soles (m). */
  hip: number;
  /** Shoulder height above the soles (m). */
  shoulder: number;
  /** Shoulder breadth (m); the base width unit for every ground decal. */
  shoulderBreadth: number;
}

/** Landmarks for standing height `height` metres. */
export function bodyLandmarks(height: number): BodyLandmarks {
  return {
    hip: HIP_HEIGHT_SHARE * height,
    shoulder: SHOULDER_HEIGHT_SHARE * height,
    shoulderBreadth: SHOULDER_BREADTH_SHARE * height,
  };
}

/**
 * Fraction of the animation (0..1) at which the body has covered ARRIVAL_SHARE
 * of its lunge, read off `lungeAt` itself so a change to the lunge curve moves
 * the effect timing too. A skill with no lunge "arrives" at its hit frame.
 */
export function arrivalFraction(anim: SkillAnimation): number {
  if (anim.lunge === 0) return anim.hitAt;
  const goal = ARRIVAL_SHARE * Math.abs(anim.lunge);
  for (let i = 1; i <= ARRIVAL_SEARCH_STEPS; i++) {
    const t = i / ARRIVAL_SEARCH_STEPS;
    if (Math.abs(lungeAt(anim, t)) >= goal) return t;
  }
  return 1;
}

/** Raw physical metrics of one skill, in their own units. */
export interface SkillMetrics {
  /** Mean travel speed |lunge| / travelTime (m/s); 0 for a skill with no lunge. */
  speed: number;
  /** Weapon damage multiplier (x). */
  damage: number;
  /** Knockback multiplier (x). */
  knockback: number;
  /** Armour multiplier while active (x; 1 when the skill sets none). */
  armour: number;
  /** Animation's own effect intensity (0..1). */
  glow: number;
  /** Animation duration (s). */
  duration: number;
}

/** Measure one skill. */
export function skillMetrics(skill: Skill): SkillMetrics {
  const anim = skill.animation;
  const travelTime = arrivalFraction(anim) * anim.duration;
  return {
    speed: travelTime > 0 ? Math.abs(anim.lunge) / travelTime : 0,
    damage: skill.payload.damageMul,
    knockback: skill.payload.knockbackMul,
    armour: skill.payload.armorMul ?? 1,
    glow: anim.effectIntensity,
    duration: anim.duration,
  };
}

/** Closed interval of one metric over a roster. */
export interface MetricRange {
  min: number;
  max: number;
}

/** Per-metric min..max over a roster: the normalisation basis. */
export type RosterRanges = Record<keyof SkillMetrics, MetricRange>;

/** Min..max of every metric over `skills` (default: the whole roster). */
export function rosterRanges(skills: readonly Skill[] = ALL_SKILLS): RosterRanges {
  const keys: (keyof SkillMetrics)[] = ["speed", "damage", "knockback", "armour", "glow", "duration"];
  const out = {} as RosterRanges;
  for (const k of keys) out[k] = { min: Infinity, max: -Infinity };
  for (const s of skills) {
    const m = skillMetrics(s);
    for (const k of keys) {
      out[k].min = Math.min(out[k].min, m[k]);
      out[k].max = Math.max(out[k].max, m[k]);
    }
  }
  return out;
}

/** The roster's ranges, measured once at module load (the roster is static data). */
export const ROSTER_RANGES: RosterRanges = rosterRanges();

/** Normalise `v` into 0..1 over `range`; 0.5 when the range is degenerate (one value). */
export function normalised(v: number, range: MetricRange): number {
  return range.max > range.min ? clamp01((v - range.min) / (range.max - range.min)) : 0.5;
}

/** Everything an effect needs to size itself for one skill. Lengths in metres, times in seconds. */
export interface FxIntensity {
  recipe: FxRecipe;
  element: Element;
  /** Roster-normalised metrics, 0..1. */
  speedN: number;
  damageN: number;
  knockbackN: number;
  armourN: number;
  glowN: number;
  /** Colour gain on every layer: lerp(BRIGHTNESS_MIN, BRIGHTNESS_MAX, max(glowN, damageN)). */
  brightness: number;
  /** Signed travel along the aim line (m) = animation.lunge. */
  travel: number;
  /** Seconds to arrival = arrivalFraction * duration. */
  travelTime: number;
  /** Seconds to the hit frame = hitAt * duration. */
  strikeTime: number;
  /** Seconds the telegraph takes to fill origin -> landing (= strikeTime: it lands with the hit). */
  windUp: number;
  /** Body-trail lifetime = travelTime * (1 + afterglow), afterglow = lerp(AFTERGLOW_MIN, AFTERGLOW_MAX, glowN). */
  trailLifetime: number;
  /** Weapon-trail lifetime = strikeTime * lerp(WEAPON_TRAIL_SHARE_MIN, WEAPON_TRAIL_SHARE_MAX, damageN). */
  weaponTrailLifetime: number;
  /** Ghost silhouettes = round(lerp(GHOST_COUNT_MIN, GHOST_COUNT_MAX, speedN)). */
  ghostCount: number;
  /** Ghost lifetime = trailLifetime * GHOST_LIFETIME_SHARE. */
  ghostLifetime: number;
  /** Speed streaks = round(lerp(SPEED_LINES_MIN, SPEED_LINES_MAX, speedN)). */
  speedLineCount: number;
  /** Telegraph width = shoulderBreadth * lerp(0.8, 1.4, (damageN + knockbackN) / 2). */
  telegraphWidth: number;
  /** Final ring radius (m), per kind — see fxIntensity. */
  ringRadius: number;
  /** Ring expansion time = recovery time = (1 - hitAt) * duration. */
  ringDuration: number;
  /** Shield opacity = lerp(0.35, 0.8, armourN). */
  shieldOpacity: number;
  /** Shield radius = shoulderBreadth * lerp(1.6, 2.2, armourN) (in front of the body). */
  shieldRadius: number;
}

/**
 * Size every layer of `skill`'s effect for a fighter of standing height
 * `height` metres. All outputs are equations over the skill (see FxIntensity).
 */
export function fxIntensity(skill: Skill, height = 1.7, ranges: RosterRanges = ROSTER_RANGES): FxIntensity {
  const anim = skill.animation;
  const m = skillMetrics(skill);
  const speedN = normalised(m.speed, ranges.speed);
  const damageN = normalised(m.damage, ranges.damage);
  const knockbackN = normalised(m.knockback, ranges.knockback);
  const armourN = normalised(m.armour, ranges.armour);
  const glowN = normalised(m.glow, ranges.glow);
  const body = bodyLandmarks(height);
  const travelTime = arrivalFraction(anim) * anim.duration;
  const strikeTime = anim.hitAt * anim.duration;
  const afterglow = lerp(AFTERGLOW_MIN, AFTERGLOW_MAX, glowN);
  const trailLifetime = Math.max(travelTime, strikeTime) * (1 + afterglow);
  // Ring radius per kind, in shoulder breadths: a dash's arrival ring grows with
  // knockback (it shoves), a power strike's with damage, a ward's with armour.
  const ringBreadths = skill.kind === "dash"
    ? lerp(1.5, 3.0, knockbackN)
    : skill.kind === "power"
    ? lerp(1.5, 4.0, damageN)
    : lerp(1.5, 2.5, armourN);
  return {
    recipe: recipeForKind(skill.kind),
    element: skill.element,
    speedN,
    damageN,
    knockbackN,
    armourN,
    glowN,
    brightness: lerp(BRIGHTNESS_MIN, BRIGHTNESS_MAX, Math.max(glowN, damageN)),
    travel: anim.lunge,
    travelTime,
    strikeTime,
    windUp: strikeTime,
    trailLifetime,
    weaponTrailLifetime: strikeTime * lerp(WEAPON_TRAIL_SHARE_MIN, WEAPON_TRAIL_SHARE_MAX, damageN),
    ghostCount: Math.round(lerp(GHOST_COUNT_MIN, GHOST_COUNT_MAX, speedN)),
    ghostLifetime: trailLifetime * GHOST_LIFETIME_SHARE,
    speedLineCount: Math.round(lerp(SPEED_LINES_MIN, SPEED_LINES_MAX, speedN)),
    telegraphWidth: body.shoulderBreadth * lerp(0.8, 1.4, (damageN + knockbackN) / 2),
    ringRadius: body.shoulderBreadth * ringBreadths,
    ringDuration: (1 - anim.hitAt) * anim.duration,
    shieldOpacity: lerp(0.35, 0.8, armourN),
    shieldRadius: body.shoulderBreadth * lerp(1.6, 2.2, armourN),
  };
}

/** Cubic ease-out on t in [0, 1]: fast start, gentle settle (1 - (1 - t)^3). Clamped. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/**
 * Opacity envelope of a layer that rises over `rise` seconds after `start`, holds,
 * and falls over `fall` seconds after `stop` (stop = Infinity while held):
 *   smoothstep(start, start + rise, now) * (1 - smoothstep(stop, stop + fall, now))
 */
export function envelope(now: number, start: number, rise: number, stop: number, fall: number): number {
  const up = rise > 0 ? smoothstep(start, start + rise, now) : (now >= start ? 1 : 0);
  const down = stop === Infinity ? 0 : fall > 0 ? smoothstep(stop, stop + fall, now) : (now >= stop ? 1 : 0);
  return up * (1 - down);
}

/** Three colours of an element's trail. Hex strings straight from ELEMENTS. */
export interface TrailPalette {
  /** Saturated outer colour: what the player sees in daylight (normal blend). */
  edge: string;
  /** Ribbon body tint (ElementStyle.trail). */
  body: string;
  /** Hot centre; only its hottest sliver is mixed in (additive core). */
  core: string;
}

/** The trail palette of an element. */
export function trailPalette(element: Element): TrailPalette {
  const s = ELEMENTS[element];
  return { edge: s.edge, body: s.trail, core: s.core };
}

/** Where the trail ribbon sits along a weapon's own +y axis, metres from the grip. */
export interface BladeSpan {
  /** Inner edge (edge 0) of the weapon trail. */
  base: number;
  /** Outer edge (edge 1) = the farthest striking point. */
  tip: number;
}

/**
 * The span a weapon trail should sweep, from the generator's part list (parts
 * are centred at `y` with length `h` along the weapon axis). Striking parts
 * (blade/head) first; otherwise every part except a bow's limbs/string; the base
 * is pushed out to MIN_TRAIL_BASE_SHARE of the tip so the ribbon never sweeps the fist.
 */
export function bladeSpan(parts: readonly WeaponPart[]): BladeSpan {
  let pick = parts.filter((p) => p.kind === "blade" || p.kind === "head");
  if (pick.length === 0) pick = parts.filter((p) => p.kind !== "string");
  if (pick.length === 0) return { base: 0.3, tip: 1 }; // empty weapon: a 1 m stick (cannot happen with WeaponGen)
  let base = Infinity, tip = -Infinity;
  for (const p of pick) {
    base = Math.min(base, p.y - p.h / 2);
    tip = Math.max(tip, p.y + p.h / 2);
  }
  return { base: Math.max(base, tip * MIN_TRAIL_BASE_SHARE), tip };
}
