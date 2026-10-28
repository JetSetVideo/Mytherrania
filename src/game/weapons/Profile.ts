// Combat profile (W07): every combat number of a weapon DERIVED from its physical axes (R08),
// then normalised so all weapons deal the same expected damage per second. The trade-offs the
// user asked for change the SHAPE of the damage distribution, never its mean:
//
//   finesse (dagger, swords, spear): sharp, light, point/edge -> high crit chance and crit
//            multiplier, wide damage spread (low floor), fast, but they must land precisely
//            (lower accuracy).
//   heavy   (axe, mace, flail, hammer, maul): blunt mass -> few crits, narrow spread, slow, and
//            a near-miss still connects (high accuracy); after normalisation each hit is big,
//            so BOTH their floor and ceiling sit above the finesse ones.
//
// Named base parameters (all SI):
//   ARM_PIVOT       0.5 m      effective swing pivot behind the hand (elbow/shoulder blend)
//   ARM_INERTIA     0.15 kg m2 forearm + hand about that pivot (2 kg at ~0.27 m)
//   SWING_WORK      60 / 95 J  work one arm / both arms + torso put into a swing
//   OMEGA_MAX       24 rad/s   fastest a human limb rotates (throwing motion)
//   SWING_ARC       2.0 rad    arc of a full cut (~115 deg)
//   THRUST_FORCE    160/240 N  mean push of a one / two-handed thrust over THRUST_DISTANCE
//   REACTION_TIME   0.3 s      read + commit, common to every weapon
//
// Equations (b = balance, I = inertia about the grip, M = mass, r = ARM_PIVOT):
//   I_pivot   = I + 2 r M b + M r^2                         (parallel axis to the pivot)
//   omega     = min(OMEGA_MAX, sqrt(2 W / (I_pivot + ARM_INERTIA)))
//   t_swing   = 2 SWING_ARC / omega                         (uniform acceleration from rest)
//   t_thrust  = sqrt(2 d (M + ARM_MASS) / F)
//   t_strike  = (cut + blunt) t_swing + thrust t_thrust
//   cooldown  = REACTION_TIME + (1 + RECOVERY_RATIO) t_strike
//   momentum  = (cut + blunt) M omega (r + b) + thrust (M + drive) 2d / t_thrust
//               (M omega (r + b) is exactly the impulse a pivoted body delivers when it
//                strikes at its centre of percussion: no jar at the hands)
//   P (precision)   = sharpness (thrust + 0.6 cut (1 + 0.35 curvature))     a keen point finds gaps
//   Q (quickness)   = 1 - smoothstep(0.1, 0.5, t_strike)
//   critChance      = 0.03 + 0.32 (0.7 P + 0.3 Q)
//   critMultiplier  = 1.25 + 1.15 P
//   D (demand)      = thrust + 0.65 cut + 0.15 blunt       a point must land square, a head need not
//   F_m, F_r        = smoothstep of the striking mass and the contact radius
//   accuracy        = 0.70 + 0.27 clamp01(0.55 (1 - D) + 0.25 F_m + 0.2 F_r - 0.15 C_len)
//                     (bow: F_m = smoothstep(40, 70, arrow speed), C_len = 0)
//   armourPierce    = min(0.6, 0.6 thrust sharpness + 0.5 blunt smoothstep(500, 5000, pressure)),
//                     pressure = momentum (head mass / M) / (pi r_contact^2)
//   reach           = arm (0.62 one hand, 0.5 two) + farthest striking y (reverse grip: 25% of it);
//                     bow: arrow speed x FLIGHT_WINDOW
//   impact          = momentum / MOMENTUM_REF (bow: arrow mass x speed)
//   phi (finesse)   = 0.65 P + 0.35 (1 - smoothstep(0.3, 3, M));  w = 0.12 + 0.48 phi
//   NORMALISE: k = TARGET_DPS cooldown / ((1 + critChance (critMultiplier - 1)) accuracy)
//              minDamage = k (1 - w), maxDamage = k (1 + w)
//   => mean([min,max]) (1 + cc (cm - 1)) accuracy / cooldown = TARGET_DPS for EVERY weapon.

import type { CombatProfile, DamageKind, GripMode, WeaponSpec } from "../../combat/contracts.ts";
import { clamp, clamp01, lerp, smoothstep } from "../../core/MathCore.ts";
import { ARCHETYPES } from "./Archetypes.ts";
import { axesOfSpec, preferredGrip, weaponForm } from "./Generate.ts";

export const ARM_PIVOT = 0.5;
export const ARM_INERTIA = 0.15;
export const SWING_WORK_ONE_HAND = 60;
export const SWING_WORK_TWO_HANDS = 95;
export const OMEGA_MAX = 24;
export const SWING_ARC = 2.0;
export const THRUST_FORCE_ONE_HAND = 160;
export const THRUST_FORCE_TWO_HANDS = 240;
export const THRUST_DISTANCE = 0.45;
/** Forearm + hand mass that travels with a thrust, kg. */
export const ARM_MASS = 2.0;
export const REACTION_TIME = 0.3;
/** The return stroke takes this share of the strike time. */
export const RECOVERY_RATIO = 1.0;
/** Momentum normaliser for `impact`, kg m/s: an arming sword, 1.1 kg x 12.5 rad/s x 0.65 m ~ 9. */
export const MOMENTUM_REF = 9;
/** Shoulder -> main grip with the arm extended, m (upper arm 0.3 + forearm 0.27 + half hand 0.05). */
export const ARM_REACH_ONE_HAND = 0.62;
/** Two hands on the weapon keep the lead arm bent, m. */
export const ARM_REACH_TWO_HANDS = 0.5;
/** Arrow flight time a target cannot react to (human reaction ~0.25 s): the bow's reach window. */
export const FLIGHT_WINDOW = 0.25;
/** Expected damage per second, in class-attack-power units, every weapon is normalised to. */
export const TARGET_DPS = 1;
/**
 * The class attack interval the targets were set for (Stats.ts: attackInterval = 1.0 s for the
 * baseline class). Engine: interval = stats.attackInterval * profile.cooldown / BASELINE_INTERVAL.
 */
export const BASELINE_INTERVAL = 1.0;

/**
 * Reverse (ice-pick) grip: the downward stab is a thrust (REVERSE_THRUST_SHARE), driven by the
 * stronger shoulder-extension motion (REVERSE_FORCE_GAIN), with part of the forearm coupled
 * through the locked wrist (REVERSE_DRIVE_MASS, kg); the point lands about a fist beyond the
 * hand, so only REVERSE_REACH_SHARE of the blade adds reach.
 */
export const REVERSE_THRUST_SHARE = 0.85;
export const REVERSE_FORCE_GAIN = 1.4;
export const REVERSE_DRIVE_MASS = 0.5;
export const REVERSE_REACH_SHARE = 0.25;

export const CRIT_CHANCE_MIN = 0.03;
export const CRIT_CHANCE_MAX = 0.35;
export const CRIT_MULT_MIN = 1.25;
export const CRIT_MULT_MAX = 2.4;
export const ACCURACY_MIN = 0.7;
export const ACCURACY_MAX = 0.97;
export const SPREAD_MIN = 0.12;
export const SPREAD_MAX = 0.6;
export const ARMOUR_PIERCE_MAX = 0.6;
/** Head-momentum pressure (N s / m^2) where blunt force starts / fully works through plate. */
export const PRESSURE_LOW = 500;
export const PRESSURE_HIGH = 5000;
/** Arrow speeds (m/s) between which a bow goes from unforgiving to fully forgiving. */
export const RANGED_SPEED_LOW = 40;
export const RANGED_SPEED_HIGH = 70;
/** Contact radius that makes a head fully forgiving, m (a forearm is ~0.04 m in radius). */
export const CONTACT_REF = 0.07;

/** The intermediate physical quantities behind a profile (for QA and the combat log). */
export interface ProfileTerms {
  grip: GripMode;
  mix: Record<DamageKind, number>;
  handsUsed: 1 | 2;
  pivotInertia: number;
  /** Angular speed at the end of a swing, rad/s. */
  omega: number;
  swingTime: number;
  thrustTime: number;
  strikeTime: number;
  /** Momentum delivered per strike, kg m/s. */
  momentum: number;
  /** Mass of the striking part (blade / head / ball), kg. */
  strikeMass: number;
  contactRadius: number;
  precision: number;
  quickness: number;
  demand: number;
  finesse: number;
  /** Half-width of the damage spread around the per-hit mean (0.12..0.6). */
  spread: number;
  /** The normalisation scale k (per-hit mean multiplier). */
  scale: number;
}

/** Strike mass: the FORE part of the mass model (blade, head, ball, top ferrule, upper limb). */
function strikeMassOf(spec: WeaponSpec): number {
  const form = weaponForm(spec);
  const fore = form.parts.find((p) =>
    p.name === "blade" || p.name === "head" || p.name === "ball" || p.name === "ferrule-top" || p.name === "limb-upper"
  );
  return fore?.mass ?? spec.mass / 2;
}

/** Radius within which a near-miss still connects, m (see header). */
function contactRadiusOf(spec: WeaponSpec, headRadius: number): number {
  const a = ARCHETYPES[spec.archetype];
  if (a.head === "axe") return 0.5 * spec.headLength;
  if (a.head === "halberd") return 0.5 * 0.55 * spec.headLength;
  let head = 0;
  for (const f of spec.features) if (f.kind === "head") head = Math.max(head, f.radius);
  return a.mix.blunt >= 0.5 && head > 0 ? head : headRadius;
}

/** Derive every intermediate term of the profile for a grip mode (default: the preferred one). */
export function profileTerms(spec: WeaponSpec, grip: GripMode = preferredGrip(spec)): ProfileTerms {
  const a = ARCHETYPES[spec.archetype];
  const axes = axesOfSpec(spec);
  const reverse = grip === "reverse";
  const base = a.mix;
  const mix: Record<DamageKind, number> = reverse
    ? { thrust: Math.max(base.thrust, REVERSE_THRUST_SHARE), cut: 0, blunt: 0 }
    : { ...base };
  if (reverse) {
    const rest = 1 - mix.thrust, other = base.cut + base.blunt || 1;
    mix.cut = (rest * base.cut) / other;
    mix.blunt = (rest * base.blunt) / other;
  }
  const handsUsed: 1 | 2 = spec.hands >= 1.5 ? 2 : 1;
  const M = spec.mass, b = spec.balance, r = ARM_PIVOT;
  const pivotInertia = spec.inertia + 2 * r * M * b + M * r * r;
  const work = handsUsed === 2 ? SWING_WORK_TWO_HANDS : SWING_WORK_ONE_HAND;
  const omega = Math.min(OMEGA_MAX, Math.sqrt((2 * work) / (pivotInertia + ARM_INERTIA)));
  const swingTime = (2 * SWING_ARC) / omega;
  const force = (handsUsed === 2 ? THRUST_FORCE_TWO_HANDS : THRUST_FORCE_ONE_HAND) * (reverse ? REVERSE_FORCE_GAIN : 1);
  const thrustTime = Math.sqrt((2 * THRUST_DISTANCE * (M + ARM_MASS)) / force);
  const swingShare = mix.cut + mix.blunt;
  const strikeTime = swingShare * swingTime + mix.thrust * thrustTime;
  const drive = reverse ? REVERSE_DRIVE_MASS : 0;
  let momentum = swingShare * M * omega * (r + b) + mix.thrust * (M + drive) * ((2 * THRUST_DISTANCE) / thrustTime);
  let quickness = 1 - smoothstep(0.1, 0.5, strikeTime);
  if (spec.ranged) {
    momentum = spec.ranged.projectileMass * spec.ranged.speed;
    quickness = 1 - smoothstep(0.1, 0.5, 10 / spec.ranged.speed); // flight time over 10 m
  }
  const strikeMass = strikeMassOf(spec);
  const contactRadius = contactRadiusOf(spec, axes.headRadius);
  const precision = clamp01(spec.sharpness * (mix.thrust + 0.6 * mix.cut * (1 + 0.35 * spec.curvature)));
  const demand = mix.thrust + 0.65 * mix.cut + 0.15 * mix.blunt;
  const lightness = 1 - smoothstep(0.3, 3, M);
  const finesse = 0.65 * precision + 0.35 * lightness;
  const spread = lerp(SPREAD_MIN, SPREAD_MAX, finesse);
  return {
    grip, mix, handsUsed, pivotInertia, omega, swingTime, thrustTime, strikeTime, momentum, strikeMass,
    contactRadius, precision, quickness, demand, finesse, spread, scale: 0,
  };
}

/** Expected damage per second of a profile: mean x crit factor x accuracy / cooldown. */
export function expectedDps(p: Pick<CombatProfile, "minDamage" | "maxDamage" | "critChance" | "critMultiplier" | "accuracy" | "cooldown">): number {
  const mean = (p.minDamage + p.maxDamage) / 2;
  return (mean * (1 + p.critChance * (p.critMultiplier - 1)) * p.accuracy) / p.cooldown;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Contract: the combat numbers of a weapon (optionally for a non-preferred grip mode). */
export function combatProfile(spec: WeaponSpec, grip: GripMode = preferredGrip(spec)): CombatProfile {
  const t = profileTerms(spec, grip);
  const cooldown = spec.ranged
    ? spec.ranged.drawTime + REACTION_TIME
    : REACTION_TIME + (1 + RECOVERY_RATIO) * t.strikeTime;
  const critChance = CRIT_CHANCE_MIN + (CRIT_CHANCE_MAX - CRIT_CHANCE_MIN) * (0.7 * t.precision + 0.3 * t.quickness);
  const critMultiplier = CRIT_MULT_MIN + (CRIT_MULT_MAX - CRIT_MULT_MIN) * t.precision;
  // Forgiveness: melee = striking mass (a heavy head carries through a graze); ranged = arrow
  // speed (a fast, flat arrow leaves the target less time to move). A long bow is steadier, so
  // the long-lever penalty is melee only.
  const massForgive = spec.ranged
    ? smoothstep(RANGED_SPEED_LOW, RANGED_SPEED_HIGH, spec.ranged.speed)
    : smoothstep(0.3, 3, t.strikeMass);
  const radiusForgive = smoothstep(0, CONTACT_REF, t.contactRadius);
  const lengthPenalty = spec.ranged ? 0 : smoothstep(1.2, 2.6, spec.length);
  const accuracy = ACCURACY_MIN + (ACCURACY_MAX - ACCURACY_MIN) *
    clamp01(0.55 * (1 - t.demand) + 0.25 * massForgive + 0.2 * radiusForgive - 0.15 * lengthPenalty);
  // Reach from the shoulder: arm + the farthest striking point along +y.
  let tipY = 0;
  for (const f of spec.features) {
    if (f.kind === "shaft") continue;
    for (const p of f.points) tipY = Math.max(tipY, p[1] + (f.kind === "head" ? f.radius : 0));
  }
  const arm = t.handsUsed === 2 ? ARM_REACH_TWO_HANDS : ARM_REACH_ONE_HAND;
  const reach = spec.ranged
    ? spec.ranged.speed * FLIGHT_WINDOW
    : arm + (grip === "reverse" ? REVERSE_REACH_SHARE : 1) * tipY;
  // Armour pierce: a keen point slips through gaps; a small hard face concentrates the HEAD's
  // share of the momentum (a wooden haft spreads the rest), pressure in N s / m^2.
  const headMomentum = t.momentum * clamp01(t.strikeMass / spec.mass);
  const pressure = headMomentum / (Math.PI * Math.max(0.005, t.contactRadius) ** 2);
  const armourPierce = clamp(
    0.6 * t.mix.thrust * spec.sharpness + 0.5 * t.mix.blunt * smoothstep(PRESSURE_LOW, PRESSURE_HIGH, pressure),
    0, ARMOUR_PIERCE_MAX,
  );
  // Normalise: one scale per weapon AFTER the trade-offs, so the mean DPS is TARGET_DPS.
  const critFactor = 1 + critChance * (critMultiplier - 1);
  const k = (TARGET_DPS * cooldown) / (critFactor * accuracy);
  t.scale = k;
  const profile: CombatProfile = {
    minDamage: round4(k * (1 - t.spread)),
    maxDamage: round4(k * (1 + t.spread)),
    critChance: round4(critChance),
    critMultiplier: round4(critMultiplier),
    accuracy: round4(accuracy),
    cooldown: round4(cooldown),
    reach: round4(reach),
    impact: round4(t.momentum / MOMENTUM_REF),
    armourPierce: round4(armourPierce),
    relativeDps: 0,
  };
  profile.relativeDps = round4(expectedDps(profile) / TARGET_DPS);
  return profile;
}

/** Outcome of one strike resolved from three uniform rolls in [0, 1). */
export interface StrikeRoll {
  outcome: "miss" | "hit" | "critical";
  /** Damage multiplier on the class attack power (0 on a miss). */
  multiplier: number;
}

/** Resolve a strike: accuracy roll, then crit roll, then the damage roll inside [min, max]. */
export function strikeFromRolls(p: CombatProfile, accuracyRoll: number, critRoll: number, damageRoll: number): StrikeRoll {
  if (accuracyRoll >= p.accuracy) return { outcome: "miss", multiplier: 0 };
  const base = lerp(p.minDamage, p.maxDamage, clamp01(damageRoll));
  return critRoll < p.critChance
    ? { outcome: "critical", multiplier: base * p.critMultiplier }
    : { outcome: "hit", multiplier: base };
}

/** Resolve a strike with an rng (three draws, in the order accuracy, crit, damage). */
export function rollStrike(p: CombatProfile, rng: () => number): StrikeRoll {
  const a = rng(), c = rng(), d = rng();
  return strikeFromRolls(p, a, c, d);
}
