// Combat contract: the types shared by the weapon generator (lane W), the collision and
// impact model (lane X) and the engine. Written by the parent BEFORE the lanes start.
// New fields must be OPTIONAL so every consumer keeps compiling.
//
// Frames and units:
//   WEAPON LOCAL frame: metres; +y runs along the weapon from the main grip toward the
//   striking end (blade tip / head / spear point); the main grip centre is the origin.
//   +z is the direction the primary EDGE faces (the cutting edge of a blade, the striking
//   face of a hammer/axe head); +x completes a right-handed frame (the flat of a blade).
//   The engine mounts this frame on the hand bone (HumanoidRig.weaponNode: local +y =
//   weapon axis, grip at y = 0), so lane X turns local points into world points with
//   weaponNode.matrixWorld.
//   Masses in kg, lengths in m, times in s, angles in rad, speeds in m/s.
//
// Producer signatures (lane W implements):
//   // src/game/weapons/Archetypes.ts
//   export const ARCHETYPES: Record<ArchetypeId, ArchetypeSpec>;
//   // src/game/weapons/Generate.ts
//   export function rollWeapon(rng: () => number, opts?: RollOptions): WeaponSpec;
//   export function weaponFromArchetype(id: ArchetypeId, rng: () => number, opts?: RollOptions): WeaponSpec;
//   // src/game/weapons/Profile.ts
//   export function combatProfile(spec: WeaponSpec): CombatProfile;
//   // src/game/weapons/Adapter.ts  (keeps today's consumers working)
//   export function toGeneratedWeapon(spec: WeaponSpec): GeneratedWeapon;   // src/game/WeaponGen.ts type
//   export function toLegacyWeapon(spec: WeaponSpec): Weapon;               // src/game/Weapon.ts type
//
// Lane X implements:
//   // src/combat/Hitboxes.ts
//   export function hitboxesFromPlan(plan: AnatomyPlan): HitboxSet;          // bind pose, from the SDF body
//   export function updateHitboxes(set: HitboxSet, boneWorld: (bone: string) => Float32Array | number[]): void;
//   // src/combat/Sweep.ts
//   export function sweepStrike(prev: StrikeSample, curr: StrikeSample, target: HitboxSet, weapon: WeaponSpec): Contact | null;
//   // src/combat/Impact.ts
//   export function resolveImpact(input: ImpactInput): ImpactResult;
//   // src/combat/SelfGuard.ts
//   export function selfPenetration(strike: StrikeSample, own: HitboxSet, weapon: WeaponSpec): SelfPenetration;

/** A point or direction. */
export type V3 = [number, number, number];

/** Weapon families (what the player sees in the menu). */
export type ArchetypeId =
  | "dagger" | "shortsword" | "longsword" | "greatsword" | "sabre" | "rapier"
  | "spear" | "halberd" | "axe" | "greataxe" | "mace" | "flail" | "warhammer" | "maul"
  | "staff" | "scythe" | "bow";

/** How a weapon delivers damage. A weapon has a MIX of these (weights sum to 1). */
export type DamageKind = "cut" | "thrust" | "blunt";

/** The family trade-off the user asked for (R: "small weapons crit more, miss more, lower floor;
 * axes/maces/hammers crit less, hit harder at the floor, miss less"). */
export type WeaponClass = "finesse" | "balanced" | "heavy" | "ranged";

/** How a hand holds the grip. Reverse = blade pointing down from the little-finger side
 * ("ice-pick"), which daggers favour for downward stabs. */
export type GripMode = "forward" | "reverse";

/** One place a hand can hold the weapon, along +y from the main grip (m). */
export interface GripPoint {
  id: "main" | "off" | "choke";
  /** Position along the weapon axis (m); main = 0. Two-handed weapons have an "off" point. */
  y: number;
  /** Grip modes this point supports, preferred first. */
  modes: GripMode[];
}

/**
 * A striking feature in WEAPON LOCAL space. Lane X sweeps each one between frames.
 *   edge   — a cutting edge, polyline from base to tip (curved blades have several points)
 *   point  — a thrusting tip (single point, plus the axis direction it thrusts along)
 *   head   — a blunt mass (mace/hammer/maul head, axe poll) approximated as a sphere
 *   shaft  — the haft/staff body (blunt, low damage), a segment
 */
export interface StrikeFeature {
  kind: "edge" | "point" | "head" | "shaft";
  /** Polyline (edge, shaft: >= 2 points) or a single point (point, head). */
  points: V3[];
  /** Capsule radius around the polyline/point, m (head: the head radius). */
  radius: number;
  /** For edges: unit direction the edge faces (local), per point or one for all. */
  facing?: V3;
  /** 0..1 how sharp this feature is (edges/points); 0 for head/shaft. */
  sharpness: number;
  /** Damage mix this feature delivers. */
  mix: Record<DamageKind, number>;
}

/** The generated weapon: physical parameters (the axes) + geometry + derived numbers. */
export interface WeaponSpec {
  id: string;                 // stable id from archetype + seed
  name: string;               // e.g. "Curved Bronze Sabre"
  archetype: ArchetypeId;
  weaponClass: WeaponClass;
  seed: number;
  // --- physical axes (the parameters everything else derives from) ---
  /** Overall length, m. */
  length: number;
  /** Total mass, kg. */
  mass: number;
  /** Centre of mass along +y from the main grip, m. */
  balance: number;
  /** Moment of inertia about the main grip, kg·m² (swing resistance). */
  inertia: number;
  /** Blade/head length along +y, m (0 for a staff). */
  headLength: number;
  /** 0..1 edge keenness. */
  sharpness: number;
  /** 0..1 blade curvature (sabre/scythe high). */
  curvature: number;
  /** Hands: 1 = one-handed, 2 = two-handed, 1.5 = hand-and-a-half (either). */
  hands: 1 | 1.5 | 2;
  grips: GripPoint[];
  features: StrikeFeature[];
  /** Material names (WeaponGen METALS) for colour; optional. */
  metal?: string;
  fitting?: string;
  /** Ranged weapons: projectile launch speed (m/s) and draw time (s). */
  ranged?: { speed: number; drawTime: number; projectileMass: number };
}

/** Numbers the combat model uses, all DERIVED from WeaponSpec (lane W, Profile.ts). */
export interface CombatProfile {
  /** Damage multipliers applied to the class attack power: a hit rolls in [min, max]. */
  minDamage: number;
  maxDamage: number;
  /** Probability a landed blow is critical, and the multiplier when it is. */
  critChance: number;
  critMultiplier: number;
  /** Probability a geometrically landed blow is a clean hit (else a graze/miss). */
  accuracy: number;
  /** Seconds between swings. */
  cooldown: number;
  /** Effective reach from the shoulder, m. */
  reach: number;
  /** Knockback scale (momentum delivered per hit, relative). */
  impact: number;
  /** 0..1 fraction of armour ignored. */
  armourPierce: number;
  /** Expected damage per second relative to the roster mean (should be ~1 for balance). */
  relativeDps: number;
}

/** A body region a hitbox belongs to; drives the location multiplier. */
export type HitZone =
  | "head" | "neck" | "chest" | "abdomen" | "pelvis"
  | "upperArm" | "foreArm" | "hand" | "thigh" | "shin" | "foot";

/** One capsule hitbox following a bone. Bind-pose segment a->b in the BONE's local frame. */
export interface Hitbox {
  zone: HitZone;
  side: "L" | "R" | "C";
  bone: string;
  a: V3;
  b: V3;
  radius: number;
  /** World-space endpoints, refreshed by updateHitboxes (mutable, reused). */
  wa: V3;
  wb: V3;
}

export interface HitboxSet { boxes: Hitbox[]; /** Total body mass, kg (target inertia). */ mass: number }

/** The weapon's pose at one instant: its local->world matrix (column-major 4x4) and time. */
export interface StrikeSample { matrix: Float32Array | number[]; time: number }

/** First contact of a swept strike against a target. */
export interface Contact {
  hitbox: Hitbox;
  feature: StrikeFeature["kind"];
  /** World contact point and unit surface normal (pointing out of the target). */
  point: V3;
  normal: V3;
  /** World velocity of the striking feature at the contact point, m/s. */
  velocity: V3;
  /** Fraction of the frame interval at first contact (0..1). */
  t: number;
  /** For edges: |cos| of the angle between edge facing and velocity (1 = clean cut). */
  edgeAlignment: number;
  /** For points: |cos| of the angle between the weapon axis and velocity (1 = clean thrust). */
  thrustAlignment: number;
}

export interface ImpactInput {
  contact: Contact;
  weapon: WeaponSpec;
  profile: CombatProfile;
  /** Hands on the weapon this swing (1 or 2): two-handed adds arm mass behind the blow. */
  handsUsed: 1 | 2;
  attacker: { mass: number; strength: number; attackPower: number; velocity: V3 };
  defender: { mass: number; armour: number; blocking: boolean; balance: number; velocity: V3 };
  rng: () => number;
}

export interface ImpactResult {
  /** "miss" = no damage (accuracy roll or graze below threshold). */
  outcome: "miss" | "graze" | "hit" | "critical";
  /** Damage in class-attack-power units (engine multiplies by its existing scale/statuses). */
  damage: number;
  /** World knockback impulse on the defender, N·s (direction from contact normal + swing). */
  knockback: V3;
  /** Stun/stagger seconds. */
  stagger: number;
  /** Explanations for the combat log / QA (e.g. "warhammer 2H swing, 62° to normal"). */
  notes: string[];
}

export interface SelfPenetration {
  /** Deepest penetration of the holder's own weapon into its own hitboxes, m (0 = clear). */
  depth: number;
  hitbox: Hitbox | null;
  /** World push-out direction for the weapon at the deepest point. */
  push: V3;
}
