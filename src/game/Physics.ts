// Body physics: mass, density, momentum and what a collision actually does.
//
// A body is made of PARTS (a torso, a weapon, a shield). Parts combine: the body's
// mass is the sum of its parts' masses and its density is total mass over total
// volume, so a heavy weapon on a light frame raises the whole body's density and a
// hollow part lowers it.
//
// Collisions use momentum, not a flat damage number. The heaviest, fastest body
// hurts the slowest, thinnest one most, which falls out of the equations rather
// than being special-cased:
//
//   reduced mass   mu = m1*m2 / (m1+m2)                (equal masses -> m/2, a wall -> m1)
//   impulse        J  = mu * (1 + e) * max(0, v_a - v_d)   (e = max(e_a, e_d))
//   toughness      T  = rho * (0.4 + 0.6*armour) * sqrt(A)  (thin and light = low toughness)
//   damage         D  = IMPACT_K * J / T,  IMPACT_K = 1.15
//   wall           J_w = m * |v|;  breached iff J_w > 1.05 * R * integrity
//   fall           D_f = 0.9 * (1/2 m v^2) / T
//
// Pure module: no Three.js, no DOM.

export interface BodyPart {
  name: string;
  /** Kilograms. */
  mass: number;
  /** Cubic metres. */
  volume: number;
  /** Cross-sectional area facing the blow, square metres. */
  area: number;
}

export interface BodyMaterial {
  /** 0 = cloth, 1 = plate. Raises toughness and mass. */
  armour: number;
  /** 0..1, how much speed is kept after a bounce. Steel rings, flesh thuds. */
  restitution: number;
}

export const DEFAULT_MATERIAL: BodyMaterial = { armour: 0.35, restitution: 0.28 };

/** A composite body: several parts treated as one. */
export interface Body {
  parts: BodyPart[];
  material: BodyMaterial;
}

export function makeBody(parts: BodyPart[], material: Partial<BodyMaterial> = {}): Body {
  return { parts, material: { ...DEFAULT_MATERIAL, ...material } };
}

/** Total mass, kg. */
export function totalMass(b: Body): number {
  return b.parts.reduce((s, p) => s + p.mass, 0);
}

/** Total volume, m^3. */
export function totalVolume(b: Body): number {
  return b.parts.reduce((s, p) => s + p.volume, 0);
}

/** Cross-sectional area facing a blow, m^2. */
export function totalArea(b: Body): number {
  return b.parts.reduce((s, p) => s + p.area, 0);
}

/**
 * Density, kg/m^3. This is what makes a body "thin": two bodies of equal mass
 * differ in how much damage they take because density is mass over volume.
 */
export function density(b: Body): number {
  const v = totalVolume(b);
  return v <= 0 ? 0 : totalMass(b) / v;
}

/**
 * Toughness: how well the body shrugs off an impulse. Denser and better-armoured
 * bodies are tougher; a large, thin, lightly-armoured one is not.
 */
export function toughness(b: Body): number {
  return density(b) * (0.4 + 0.6 * b.material.armour) * Math.sqrt(Math.max(0.01, totalArea(b)));
}

/** Linear momentum, kg m/s. */
export function momentum(mass: number, speed: number): number {
  return mass * Math.abs(speed);
}

/** Reduced mass of a two-body collision. */
export function reducedMass(m1: number, m2: number): number {
  if (m1 + m2 <= 0) return 0;
  return (m1 * m2) / (m1 + m2);
}

/** Kinetic energy, joules. */
export function kineticEnergy(mass: number, speed: number): number {
  return 0.5 * mass * speed * speed;
}

export interface Impact {
  /** Momentum of the striking body, kg m/s. */
  momentum: number;
  /** Energy carried, J. */
  energy: number;
  /** Collision impulse actually transferred, N s. */
  impulse: number;
  /** Damage dealt to the defender. */
  damage: number;
  /** How far the defender is pushed, metres. */
  knockback: number;
  /** True when the defender is too tough for this blow to matter. */
  glanced: boolean;
}

export interface ImpactInput {
  attacker: Body;
  defender: Body;
  /** Speed of the attacker along the line of contact, m/s. */
  attackerSpeed: number;
  /** Speed of the defender along that line; positive means retreating. */
  defenderSpeed?: number;
  /** Scales the whole exchange, for tuning. */
  scale?: number;
  /** Extra multiplier from a weapon or a skill. */
  multiplier?: number;
}

/** The tuning constant that turns an impulse into hit points. */
export const IMPACT_K = 1.15;
/** Below this fraction of the defender's toughness the blow is a graze. */
export const GLANCE_RATIO = 0.08;

/**
 * Resolve a collision. Everything that makes a heavy fast body dangerous and a
 * slow thin body fragile is in here:
 *   - heavier attacker  -> more momentum, more reduced mass, more impulse
 *   - faster attacker   -> more momentum AND more energy (squared)
 *   - thin defender     -> lower toughness, so the same impulse hurts more
 *   - slow defender     -> less relative speed of its own to bleed off the blow
 */
export function resolveImpact(i: ImpactInput): Impact {
  const scale = i.scale ?? 1;
  const mult = i.multiplier ?? 1;
  const m1 = totalMass(i.attacker);
  const m2 = totalMass(i.defender);
  const rel = Math.max(0, i.attackerSpeed - (i.defenderSpeed ?? 0));
  const mu = reducedMass(m1, m2);
  // Restitution is the PAIR's: the springier of the two governs the bounce.
  const e = Math.max(i.attacker.material.restitution, i.defender.material.restitution);
  const J = mu * (1 + e) * rel;
  const T = toughness(i.defender);
  const raw = T <= 0 ? 0 : (J / T) * IMPACT_K * scale * mult;
  const damage = Math.max(0, raw);
  const t = toughness(i.defender);
  return {
    momentum: momentum(m1, rel),
    energy: kineticEnergy(m1, rel),
    impulse: J,
    damage,
    // Knockback falls out of the impulse against the defender's mass: a light body
    // is thrown, a heavy one barely shifts.
    knockback: m2 <= 0 ? 0 : (J / m2) * 0.12,
    glanced: t > 0 && J / t < GLANCE_RATIO,
  };
}

/**
 * Wall resistance. A wall has a resistance in the same units as toughness: a body
 * whose blow exceeds it damages the wall (and breaks through if it is far over),
 * otherwise the wall stops it and the body takes the rebound.
 */
export interface Wall {
  /** How hard the wall is to hurt. */
  resistance: number;
  /** Height in metres. */
  height: number;
  /** Restitution of the wall material. */
  restitution: number;
}

export interface WallHit {
  /** Did the body get through? */
  breached: boolean;
  /** Damage dealt to the wall. */
  wallDamage: number;
  /** Fraction of the wall's resistance left, 0..1. */
  wallIntegrity: number;
  /** Speed kept by the body after the collision. */
  retainedSpeed: number;
  /** Damage the body took from the rebound. */
  selfDamage: number;
}

/**
 * A heavy, fast body hurts a wall; a light slow one just bounces off it. This is
 * the "varying degrees of resistance to heavy bodies" the brief asks for.
 */
export function hitWall(body: Body, speed: number, wall: Wall, wallIntegrity = 1): WallHit {
  const m = totalMass(body);
  const J = momentum(m, speed);
  const effective = wall.resistance * Math.max(0, wallIntegrity);
  const ratio = effective <= 0 ? Infinity : J / effective;
  // Just over the wall's resistance is enough to break through; the excess is what
  // damages it. At 1.6 a charging juggernaut could not breach a default wall at all.
  const breached = ratio > 1.05;
  const wallDamage = Math.max(0, J - effective);
  const retained = breached
    // Breaking through costs speed in proportion to how much wall was in the way.
    ? Math.max(0.15, 1 - effective / Math.max(1e-6, J)) * speed
    : speed * wall.restitution;
  // The harder the wall relative to the blow, the more the body feels it.
  const selfDamage = breached ? 0 : Math.max(0, (effective - J) / Math.max(1e-6, toughness(body))) * 0.05;
  return {
    breached,
    wallDamage,
    wallIntegrity: Math.max(0, 1 - wallDamage / Math.max(1e-6, wall.resistance)),
    retainedSpeed: retained,
    selfDamage,
  };
}

/**
 * Fall damage: what a body takes landing at a speed. Scales with mass and the
 * SQUARE of the impact speed, and is resisted by toughness — so a heavy armoured
 * body takes less than a heavy thin one, and a light one takes least of all.
 */
export function fallDamage(body: Body, impactSpeed: number, gravityScale = 1): number {
  const m = totalMass(body);
  const e = kineticEnergy(m, impactSpeed) * gravityScale;
  const t = toughness(body);
  return t <= 0 ? 0 : (e / t) * 0.9;
}

/** The attribute subset a physical body is derived from. */
export interface BodyStats {
  strength: number; vitality: number; resilience: number; reflex: number; armor: number;
}

/**
 * A fighter's physical body from its attributes. Single source of truth: the engine,
 * the spec tables and the tests all call this.
 *
 *   mass   = 42 + 3.5·STR + 1.4·VIT + 1.1·RES          kg
 *   volume = 0.055 + 0.0016·STR                        m³
 *   area   = (0.22 + 0.006·STR) + (0.15 + 0.004·REF)   m²   (torso + limbs)
 *   armour = min(1, armor / 8)
 *
 * Strength adds mass faster than volume, so strong fighters are DENSER, not just
 * heavier — which is what lets them both hit harder and shrug blows off.
 */
export function bodyFromStats(s: BodyStats): Body {
  const mass = 42 + s.strength * 3.5 + s.vitality * 1.4 + s.resilience * 1.1;
  const volume = 0.055 + s.strength * 0.0016;
  return makeBody([
    { name: "torso", mass: mass * 0.62, volume: volume * 0.62, area: 0.22 + s.strength * 0.006 },
    { name: "limbs", mass: mass * 0.38, volume: volume * 0.38, area: 0.15 + s.reflex * 0.004 },
  ], { armour: Math.min(1, s.armor / 8), restitution: 0.24 });
}

/**
 * The damage multiplier a blow gets from the two bodies' physics, clamped so
 * physics shapes a fight without deciding it on its own.
 *
 *   physicsMul = clamp( (0.55 + 0.30·(m_a/m_d) + 0.25·(ρ_a/ρ_d)) · closing , 0.6, 1.8 )
 *   closing    = 0.85 + 0.15·min(2, |v_a|)
 *
 * Equal bodies standing still give 1.10·0.85 = 0.935.
 */
export const PHYSICS_MUL_MIN = 0.6;
export const PHYSICS_MUL_MAX = 1.8;
export function physicsMultiplier(attacker: Body, defender: Body, attackerSpeed: number): number {
  const massRatio = totalMass(attacker) / Math.max(1e-6, totalMass(defender));
  const densRatio = density(attacker) / Math.max(1e-6, density(defender));
  const closing = 0.85 + 0.15 * Math.min(2, Math.abs(attackerSpeed));
  const raw = (0.55 + 0.3 * massRatio + 0.25 * densRatio) * closing;
  return Math.max(PHYSICS_MUL_MIN, Math.min(PHYSICS_MUL_MAX, raw));
}

/**
 * Closing speed along the attacker→defender axis n̂ (unit vector), m/s, floored at 0:
 *   v_close = max(0, (v_a − v_d) · n̂)
 * Pure so the engine and the tests share it.
 */
export function closingSpeed(vax: number, vaz: number, vdx: number, vdz: number, nx: number, nz: number): number {
  return Math.max(0, (vax - vdx) * nx + (vaz - vdz) * nz);
}

/** Standard reference bodies, so tests and the engine share one definition. */
export const REFERENCE_BODIES = {
  /** A lean, light fighter: fast but fragile. */
  skirmisher: makeBody(
    [
      { name: "torso", mass: 34, volume: 0.052, area: 0.22 },
      { name: "limbs", mass: 16, volume: 0.021, area: 0.14 },
      { name: "dagger", mass: 0.6, volume: 0.0004, area: 0.012 },
    ],
    { armour: 0.15, restitution: 0.34 },
  ),
  /** A heavy armoured fighter: slow, but very hard to hurt. */
  juggernaut: makeBody(
    [
      { name: "torso", mass: 62, volume: 0.078, area: 0.34 },
      { name: "limbs", mass: 26, volume: 0.028, area: 0.19 },
      { name: "plate", mass: 28, volume: 0.0035, area: 0.30 },
      { name: "greataxe", mass: 6.5, volume: 0.004, area: 0.05 },
    ],
    { armour: 0.85, restitution: 0.18 },
  ),
  /** A wall: effectively infinite mass, so reduced mass is just the body's. */
  wall: makeBody([{ name: "wall", mass: 1e6, volume: 1e3, area: 4 }], { armour: 1, restitution: 0.3 }),
} as const;
