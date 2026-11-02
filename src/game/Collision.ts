// Wave FALL (C-FORCE, agent M): a body-on-body collision — two fighters charging (or clashing) into
// each other. Pure module: no THREE, no DOM, no Math.random. Units: kg, m, s, m/s, N·s.
//
// The law (SPEC FALL-F1..F8):
//   1. STABILITY k (dimensionless, clamped [STABILITY_MIN, STABILITY_MAX]): how firmly a body holds
//      its ground — the product of
//        strength   √(strength / STRENGTH_REF)             clamped [0.6, 1.5]   (a stiff trunk and legs)
//        agility    1 + AGILITY_GAIN·(agility − AGILITY_REF)  clamped [0.6, 1.5]  (footwork: a step to absorb)
//        level      1 + LEVEL_GAIN·(level − 1)               clamped [1, 1.5]     (experience)
//        stamina    STAMINA_FLOOR + (1 − STAMINA_FLOOR)·stamina01                 (a tired body gives way)
//        health     HP_FLOOR + (1 − HP_FLOOR)·hp01
//        guard      GUARD_BRACE when guarding (braced stance)
//        downed     1 / DOWNED_KNOCKBACK when downed (a body on the floor is pushed further)
//   2. EFFECTIVE MASS  m_eff = (body + armour + weapon mass) · k.
//   3. EXCHANGE along the contact normal n (a -> b): closing speed v_c = max(0, (v_a − v_b)·n);
//      impulse J = (1 + e)·μ·v_c with μ = m_a·m_b / (m_a + m_b) (effective masses), e = RESTITUTION;
//      Δv_a = −J/m_a·n, Δv_b = +J/m_b·n — momentum in the effective masses is conserved exactly
//      (m_a·Δv_a + m_b·Δv_b = 0) and equal inputs give mirror outputs.
//   4. RECOIL (the push each body really gets, m/s): the body's post-contact speed AWAY from the other,
//      max(0, −(v_a + Δv_a)·n) for a (and +(v_b + Δv_b)·n for b). Pushback distance = recoil / PUSH_DECAY
//      (the slide an exponentially damped velocity travels; the engine's measured slide is in the probe).
//   5. STAGGER (s) = clamp(STAGGER_PER_DV·max(0, |Δv| − STAGGER_DV0) / recover, 0, STAGGER_MAX) with
//      recover = agility·√strength·level·√stamina factors — strong, agile, seasoned, fresh bodies recover sooner.
//   6. BALANCE LOSS (0..1) = clamp((|Δv| − BALANCE_DV0) / (BALANCE_SPAN·k), 0, 1); 0 for a body already
//      downed. Fall.ts turns it into stagger / stumble / fall.
//
// Armour mass: the game has no armour ITEMS yet (equipment is a placeholder), so the armour RATING
// (Stats.armor, class/resilience + the batch gear tier) is the proxy: ARMOUR_KG_PER_POINT kg per point
// (armour 1 -> 2.5 kg padded, 4 -> 10 kg mail, 8+ -> 20+ kg plate). Weapon mass comes from the weapon spec.

import { DOWNED_KNOCKBACK } from "./Fall.ts";

/** Average Stats.strength (Impact.STRENGTH_REF): the strength factor is 1 here. */
export const STRENGTH_REF = 5.5;
/** Runtime agility at which the agility factor is 1 (CombatStats.agility, class primaries 2..9). */
export const AGILITY_REF = 5;
/** Agility factor per point of runtime agility. */
export const AGILITY_GAIN = 0.06;
/** Level factor per level above 1 (SpectateGen.MAX_LEVEL 20 -> 1.19). */
export const LEVEL_GAIN = 0.01;
/** Share of stability a fully winded body keeps (stamina 0). */
export const STAMINA_FLOOR = 0.6;
/** Share of stability a body at 0 hp keeps. */
export const HP_FLOOR = 0.85;
/** A guarding body is braced: its stability is multiplied by this. */
export const GUARD_BRACE = 1.3;
/** Stability clamp. */
export const STABILITY_MIN = 0.3, STABILITY_MAX = 3;
/** Restitution of a body-on-body contact (padded torsos and arms: mostly inelastic). */
export const RESTITUTION = 0.3;
/** Velocity decay of a pushed body's slide, 1/s (stone: ArenaPhysics 1.2 + 1/stop 0.7 = 2.63): pushback = recoil / PUSH_DECAY. */
export const PUSH_DECAY = 2.6;
/** Stagger law: Δv below STAGGER_DV0 (m/s) never staggers; STAGGER_PER_DV s per m/s above it; cap. */
export const STAGGER_DV0 = 2, STAGGER_PER_DV = 0.12, STAGGER_MAX = 1.2;
/** Balance law: Δv below BALANCE_DV0 (m/s) costs no balance; BALANCE_SPAN m/s more takes all of it (k = 1). */
export const BALANCE_DV0 = 3, BALANCE_SPAN = 6;
/** Armour-mass proxy: kg per point of Stats.armor (no armour items exist yet). */
export const ARMOUR_KG_PER_POINT = 2.5;
/** A charge: bodies in contact closing at least this fast, m/s (a walk into a standing body is a lean). */
export const CHARGE_MIN_CLOSING = 3;
/** Contact distance beyond the body spacing at which a charge still counts, m. */
export const CONTACT_SKIN = 0.08;
/** Seconds before the same pair may collide again (one charge = one exchange). */
export const COLLISION_COOLDOWN = 0.8;
/** A blade clash pushes each body toward the other at CLASH_SPEED·strength (arms driving through), m/s. */
export const CLASH_SPEED = 3;

/** One body as the collision reads it (contract C-FORCE). */
export interface BodyState {
  /** Body mass, kg (Physics.bodyFromStats). */
  mass: number;
  /** Ground velocity, m/s (x, z). */
  velocity: [number, number];
  /** Runtime Stats.strength. */
  strength: number;
  /** Runtime Stats.agility. */
  agility: number;
  level: number;
  stamina01: number;
  hp01: number;
  /** Weapon mass, kg (WeaponSpec.mass). */
  weaponMass: number;
  /** Armour mass, kg (armourMassOf(Stats.armor) until armour items exist). */
  armourMass: number;
  guarding: boolean;
  downed: boolean;
}

/** What one side of a collision gets. */
export interface CollisionSide {
  /** Velocity change, m/s (x, z). */
  dv: [number, number];
  /** Impulse received, N·s (x, z) = effectiveMass·dv. */
  impulse: [number, number];
  /** Post-contact speed away from the other body, m/s (the push the engine applies). */
  recoil: number;
  /** Predicted slide, m = recoil / PUSH_DECAY. */
  pushback: number;
  /** Stagger, s. */
  stagger: number;
  /** Balance loss 0..1 (Fall.ts input). */
  balanceLoss: number;
  /** Stability factor k and effective mass m_eff, kg. */
  stability: number;
  effectiveMass: number;
}

export interface CollisionResult {
  /** Unit contact normal, a -> b (x, z). */
  normal: [number, number];
  /** Closing speed along the normal, m/s (>= 0). */
  closingSpeed: number;
  /** Scalar impulse J, N·s. */
  impulse: number;
  a: CollisionSide;
  b: CollisionSide;
}

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, fin(v, lo)));
const c01 = (v: number) => clamp(v, 0, 1);

/** Armour mass proxy, kg, from the armour rating (Stats.armor). */
export function armourMassOf(armor: number): number {
  return Math.max(0, fin(armor)) * ARMOUR_KG_PER_POINT;
}

/** The strength / agility / level factors (each documented in the module header). */
export function strengthFactor(strength: number): number { return clamp(Math.sqrt(Math.max(0, fin(strength, STRENGTH_REF)) / STRENGTH_REF), 0.6, 1.5); }
export function agilityFactor(agility: number): number { return clamp(1 + AGILITY_GAIN * (fin(agility, AGILITY_REF) - AGILITY_REF), 0.6, 1.5); }
export function levelFactor(level: number): number { return clamp(1 + LEVEL_GAIN * (fin(level, 1) - 1), 1, 1.5); }
const staminaFactor = (s: number) => STAMINA_FLOOR + (1 - STAMINA_FLOOR) * c01(s);
const hpFactor = (h: number) => HP_FLOOR + (1 - HP_FLOOR) * c01(h);

/** Stability k of a body (module header, step 1). */
export function stabilityOf(b: BodyState): number {
  const k = strengthFactor(b.strength) * agilityFactor(b.agility) * levelFactor(b.level) * staminaFactor(b.stamina01) * hpFactor(b.hp01)
    * (b.guarding ? GUARD_BRACE : 1) * (b.downed ? 1 / DOWNED_KNOCKBACK : 1);
  return clamp(k, STABILITY_MIN, STABILITY_MAX);
}

/** Total carried mass, kg: body + armour + weapon. */
export function carriedMass(b: BodyState): number {
  return Math.max(1, fin(b.mass, 70)) + Math.max(0, fin(b.armourMass)) + Math.max(0, fin(b.weaponMass));
}

/** Effective mass, kg (module header, step 2). */
export function effectiveMassOf(b: BodyState): number {
  return carriedMass(b) * stabilityOf(b);
}

/** How fast a body shakes off a jolt (step 5): agility · √strength · level · √stamina. */
export function recoverFactor(b: BodyState): number {
  return agilityFactor(b.agility) * Math.sqrt(strengthFactor(b.strength)) * levelFactor(b.level) * Math.sqrt(staminaFactor(b.stamina01));
}

/** Stagger seconds for a velocity change |Δv| (step 5). */
export function staggerFor(dv: number, recover: number): number {
  return clamp((STAGGER_PER_DV * Math.max(0, fin(dv) - STAGGER_DV0)) / Math.max(0.1, fin(recover, 1)), 0, STAGGER_MAX);
}

/** Balance loss for a velocity change |Δv| at stability k (step 6). */
export function balanceLossFor(dv: number, stability: number, downed = false): number {
  if (downed) return 0;
  return c01((fin(dv) - BALANCE_DV0) / (BALANCE_SPAN * Math.max(STABILITY_MIN, fin(stability, 1))));
}

/**
 * Resolve one body-on-body contact (contract C-FORCE). `normal` is the direction from a to b (x, z);
 * absent, the relative velocity's direction (a stable +x when both are at rest). Deterministic and
 * total: every output finite for any input.
 */
export function resolveCollision(a: BodyState, b: BodyState, normal?: [number, number]): CollisionResult {
  let nx = fin(normal?.[0] ?? NaN, NaN), nz = fin(normal?.[1] ?? NaN, NaN);
  const vax = fin(a.velocity?.[0]), vaz = fin(a.velocity?.[1]), vbx = fin(b.velocity?.[0]), vbz = fin(b.velocity?.[1]);
  if (!Number.isFinite(nx) || !Number.isFinite(nz) || Math.hypot(nx, nz) < 1e-9) { nx = vax - vbx; nz = vaz - vbz; }
  const nl = Math.hypot(nx, nz);
  if (nl < 1e-9) { nx = 1; nz = 0; } else { nx /= nl; nz /= nl; }
  const ka = stabilityOf(a), kb = stabilityOf(b);
  const ma = carriedMass(a) * ka, mb = carriedMass(b) * kb;
  const vc = Math.max(0, (vax - vbx) * nx + (vaz - vbz) * nz);
  const mu = (ma * mb) / (ma + mb);
  const J = (1 + RESTITUTION) * mu * vc;
  const dva = J / ma, dvb = J / mb;
  const side = (s: BodyState, k: number, m: number, dv: number, sign: number, vx: number, vz: number): CollisionSide => {
    const dx = sign * dv * nx, dz = sign * dv * nz;
    // Speed away from the other body after the contact (a moves away along −n, b along +n).
    const recoil = Math.max(0, sign * ((vx + dx) * nx + (vz + dz) * nz));
    return {
      dv: [dx, dz], impulse: [m * dx, m * dz], recoil, pushback: recoil / PUSH_DECAY,
      stagger: staggerFor(dv, recoverFactor(s)), balanceLoss: balanceLossFor(dv, k, s.downed),
      stability: k, effectiveMass: m,
    };
  };
  return {
    normal: [nx, nz], closingSpeed: vc, impulse: J,
    a: side(a, ka, ma, dva, -1, vax, vaz),
    b: side(b, kb, mb, dvb, 1, vbx, vbz),
  };
}

/** Balance loss of a blow's knockback (m/s of push) on a body (Impact knockback -> Fall input). */
export const HIT_BALANCE_DV0 = 4.5, HIT_BALANCE_SPAN = 6;
export function hitBalanceLoss(knockSpeed: number, b: BodyState): number {
  if (b.downed) return 0;
  return c01((fin(knockSpeed) - HIT_BALANCE_DV0) / (HIT_BALANCE_SPAN * stabilityOf(b)));
}

/** Each body must be closing at least this fast for a mutual charge, m/s (a walk into a standing body is a lean). */
export const CHARGE_EACH_MIN = 0.5;
/** One body alone closing this fast (a dash / lunge into a standing body) is a charge too, m/s. */
export const DASH_CHARGE = 6;
/**
 * A charge: in contact (centre distance <= spacing + CONTACT_SKIN), closing at least CHARGE_MIN_CLOSING
 * in total, and BOTH bodies closing (each >= CHARGE_EACH_MIN) — or one body alone at DASH_CHARGE.
 * `approachA` / `approachB` are each body's own speed toward the other, m/s.
 */
export function isCharge(distance: number, spacing: number, approachA: number, approachB: number): boolean {
  if (!(fin(distance, Infinity) <= spacing + CONTACT_SKIN)) return false;
  const a = fin(approachA), b = fin(approachB);
  if (a + b < CHARGE_MIN_CLOSING) return false;
  return Math.min(a, b) >= CHARGE_EACH_MIN || Math.max(a, b) >= DASH_CHARGE;
}
