// Skill roster: every class owns three skills — a dash, a power strike and a
// defensive stance — each with its own animation profile, elemental effect and
// combat payload. Pure data + lookups, no Three.js and no DOM.
//
// Wave S (lane S-A) adds a SECOND, larger roster on top of the three skills: each class also owns
// FIVE archetype-true POWERS (see POWERS below). A power declares its SHAPE (instant / projectile /
// cone / aura / self-buff), its element, and the two inputs it scales from — one of the caster's
// six attributes and one property of the equipped weapon — and its amplitude, cast time, mana cost
// and cooldown are DERIVED from the caster's own statistics and the weapon through the single law
// in PowerCost.ts. A power carries no hard-coded amplitude: the test recomputes every number.

import { CLASSES, createStats, type ClassName, type CombatStats } from "./Stats.ts";
import { weaponForClass, type Weapon } from "./Weapon.ts";
import type { JointName } from "./Skeleton.ts";
import {
  derivePower,
  type PowerScale,
  type PowerShape,
} from "./PowerCost.ts";

export type SkillKind = "dash" | "power" | "defense";

/** Element drives the weapon effect colour and the generated artwork. */
export type Element = "fire" | "fury" | "poison" | "shadow" | "arcane" | "necrotic" | "wind" | "holy";

export interface ElementStyle {
  core: string;      // hot centre of the effect
  edge: string;      // outer glow
  trail: string;     // motion trail / ribbon
  art: string;       // primary colour of the generated skill art
}

export const ELEMENTS: Record<Element, ElementStyle> = {
  // The `edge` colour is what the player actually sees: the shell mixes toward the
  // core only at its hottest sliver, so a pale core over a dark edge washes out to
  // white and every element looks the same. Both ends are therefore kept saturated.
  fire:     { core: "#ffe9b0", edge: "#ef5a30", trail: "#dfaa55", art: "#ef7455" },
  fury:     { core: "#ffc878", edge: "#c02f12", trail: "#ef7455", art: "#c9401f" },
  poison:   { core: "#d8ff8a", edge: "#6aa83f", trail: "#a9ce7c", art: "#82b970" },
  shadow:   { core: "#c79bff", edge: "#4a1f75", trail: "#9b72cf", art: "#9b72cf" },
  arcane:   { core: "#a6e2ff", edge: "#2f8fd8", trail: "#7fb6e0", art: "#4f8490" },
  necrotic: { core: "#aef08a", edge: "#3f8a2f", trail: "#6fae55", art: "#2f4a2a" },
  wind:     { core: "#d8f8ff", edge: "#4fc4cc", trail: "#9fd8dc", art: "#7fd4d8" },
  holy:     { core: "#fff0c0", edge: "#e8b23c", trail: "#dfaa55", art: "#f2c46b" },
};

/**
 * One animated joint track. The angle at time t is
 *   rest + amplitude * impulse(t, peak) + wobbleAmp * dampedSin(t, freq, phase)
 * clamped into the joint's own limits. `sign` lets a track pull against the rest.
 */
export interface JointTrack {
  joint: JointName;
  amplitude: number;
  peak: number;        // 0..1 position of the strongest pose within the animation
  wobbleAmp?: number;
  wobbleFreq?: number;
  wobblePhase?: number;
}

export interface SkillAnimation {
  /** Seconds the animation runs for. */
  duration: number;
  /** Fraction of the animation at which the strike lands. */
  hitAt: number;
  tracks: JointTrack[];
  /** Whole-body forward lunge in metres, applied along the facing direction. */
  lunge: number;
  /** Vertical hop in metres. */
  hop: number;
  /** How hard the weapon effect flares, 0..1 (scaled again by damage dealt). */
  effectIntensity: number;
  /**
   * Wave S: the fraction of the animation spent winding up before the release. For a Power this
   * equals the cast time over the animation's own duration (`castSeconds / duration`), so the
   * wind-up LENGTH IS the channel the power cost. Absent for the three base skills.
   */
  windupFraction?: number;
  /** Wave S: the power's declared shape, for animations that belong to a Power. Absent on a Skill. */
  shape?: PowerShape;
}

export interface SkillPayload {
  /** Multiplier applied to the weapon's damage. */
  damageMul: number;
  /** Seconds the target is stunned. */
  stun: number;
  /** Extra knockback multiplier. */
  knockbackMul: number;
  /** Fraction of damage returned as health. */
  lifesteal: number;
  /** Damage-over-time applied on hit: total damage over `dotSeconds`. */
  dot?: { total: number; seconds: number };
  /** Armour multiplier while the skill is active (defensive stances use < 1). */
  armorMul?: number;
  /** Movement-speed multiplier while active (heavy stances use < 1). */
  speedMul?: number;
  /** Attack-speed multiplier while active. */
  attackIntervalMul?: number;
}

export interface Skill {
  id: string;
  className: ClassName;
  kind: SkillKind;
  name: string;
  element: Element;
  /** Short player-facing description of what the skill does. */
  blurb: string;
  cooldown: number;
  payload: SkillPayload;
  animation: SkillAnimation;
}

/** Helper so the tables below stay readable. */
function track(joint: JointName, amplitude: number, peak: number, wobble?: [number, number, number]): JointTrack {
  return wobble
    ? { joint, amplitude, peak, wobbleAmp: wobble[0], wobbleFreq: wobble[1], wobblePhase: wobble[2] }
    : { joint, amplitude, peak };
}

// ---------------------------------------------------------------------------
// Shared animation shapes. Each class then varies amplitude and timing, so the
// eight classes read differently while the maths stays in one place.
// ---------------------------------------------------------------------------

/**
 * Weapon arm drives almost every attack; the off arm counterbalances.
 * SIGN CONVENTION (from defaultHumanoid): a NEGATIVE shoulder angle raises the
 * arm forward/up (the idle attack pose is shoulderR -1.7); positive swings it
 * back. Amplitudes are therefore negated here — a positive `arm` would pin the
 * shoulder against its +0.6 limit and the weapon would barely move.
 */
function strikeTracks(peak: number, arm: number, offArm: number, torso: number): JointTrack[] {
  return [
    track("shoulderR", -arm, peak, [0.08, 3.0, 0]),
    track("elbowR", -arm * 0.5, peak),
    track("shoulderL", offArm, peak * 0.8),
    track("elbowL", offArm * 0.4, peak * 0.8),
    track("spine", torso, peak, [0.05, 2.0, 0.6]),
    track("abdomen", torso * 0.6, peak),
    track("neck", -torso * 0.4, peak),
  ];
}

function legDrive(peak: number, front: number, back: number): JointTrack[] {
  return [
    track("hipL", front, peak),
    track("hipR", back, peak),
    track("kneeL", -Math.abs(front) * 0.7, peak),
    track("kneeR", -Math.abs(back) * 0.7, peak),
    track("ankleL", -front * 0.3, peak),
    track("ankleR", -back * 0.3, peak),
  ];
}

function crouch(peak: number, depth: number): JointTrack[] {
  return [
    track("hipL", -depth, peak), track("hipR", -depth, peak),
    track("kneeL", -depth * 2.2, peak), track("kneeR", -depth * 2.2, peak),
    track("ankleL", depth * 0.9, peak), track("ankleR", depth * 0.9, peak),
    track("spine", depth * 0.5, peak), track("abdomen", depth * 0.3, peak),
  ];
}

const SKILLS: Skill[] = [
  // ---------------------------------------------------------------- Barbarian
  {
    id: "barbarian-charge", className: "Barbarian", kind: "dash", name: "Reaver's Charge", element: "fury",
    blurb: "Barrels shoulder-first into the enemy, shoving them back across the ring.",
    cooldown: 5,
    payload: { damageMul: 0.8, stun: 0.2, knockbackMul: 2.1, lifesteal: 0 },
    animation: { duration: 0.55, hitAt: 0.34, lunge: 3.2, hop: 0, effectIntensity: 0.45,
      tracks: [...strikeTracks(0.34, 1.1, -0.7, -0.35), ...legDrive(0.34, 0.75, -0.8)] },
  },
  {
    id: "barbarian-skullsplitter", className: "Barbarian", kind: "power", name: "Skullsplitter", element: "fury",
    blurb: "A two-handed overhead cleave that stuns whatever it lands on.",
    cooldown: 9,
    payload: { damageMul: 2.3, stun: 0.85, knockbackMul: 1.7, lifesteal: 0 },
    // J-C: the cleave now drives THROUGH the target — the weapon arm travels 117.5° (was 108.9°),
    // the trunk follows deeper and the body stamps down a touch harder on the hit.
    animation: { duration: 0.95, hitAt: 0.42, lunge: 1.0, hop: 0.22, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.42, 2.05, -1.25, -0.55), ...legDrive(0.42, 0.6, -0.55), track("head", -0.35, 0.42)] },
  },
  {
    id: "barbarian-ironhide", className: "Barbarian", kind: "defense", name: "Iron Hide", element: "fury",
    blurb: "Plants the feet and braces: far tougher, but slow to swing and slow to move.",
    cooldown: 11,
    payload: { damageMul: 0.35, stun: 0, knockbackMul: 0.4, lifesteal: 0, armorMul: 2.2, speedMul: 0.55, attackIntervalMul: 1.35 },
    animation: { duration: 1.1, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.3,
      tracks: [...crouch(0.3, 0.32), track("shoulderL", -1.35, 0.3), track("shoulderR", -1.35, 0.3),
        track("elbowL", -1.9, 0.3), track("elbowR", -1.9, 0.3), track("head", 0.35, 0.3)] },
  },

  // ------------------------------------------------------------------ Warrior
  {
    id: "warrior-dash", className: "Warrior", kind: "dash", name: "Shield Dash", element: "fire",
    blurb: "Steps in behind the shield and drives forward, closing the gap hard.",
    cooldown: 4.5,
    payload: { damageMul: 0.85, stun: 0.15, knockbackMul: 1.6, lifesteal: 0, armorMul: 1.4 },
    animation: { duration: 0.5, hitAt: 0.32, lunge: 2.9, hop: 0.05, effectIntensity: 0.4,
      tracks: [...strikeTracks(0.32, 0.9, -0.95, -0.3), ...legDrive(0.32, 0.7, -0.7), track("head", 0.2, 0.32)] },
  },
  {
    id: "warrior-crushing-blow", className: "Warrior", kind: "power", name: "Crushing Blow", element: "fire",
    blurb: "A full-body diagonal cut; fire runs the length of the blade and the target is stunned.",
    cooldown: 8,
    payload: { damageMul: 1.9, stun: 0.7, knockbackMul: 1.4, lifesteal: 0 },
    animation: { duration: 0.85, hitAt: 0.38, lunge: 1.1, hop: 0.1, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.38, 1.75, -0.9, -0.45), ...legDrive(0.38, 0.55, -0.5)] },
  },
  {
    id: "warrior-bulwark", className: "Warrior", kind: "defense", name: "Bulwark", element: "fire",
    blurb: "Raises the guard. Slower on the attack, but the armour boost and vitality carry the trade.",
    cooldown: 10,
    payload: { damageMul: 0.4, stun: 0, knockbackMul: 0.5, lifesteal: 0, armorMul: 2.0, speedMul: 0.6, attackIntervalMul: 1.3 },
    animation: { duration: 1.0, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.35,
      tracks: [...crouch(0.3, 0.26), track("shoulderL", -1.2, 0.3), track("shoulderR", -1.2, 0.3),
        track("elbowL", -2.0, 0.3), track("elbowR", -2.0, 0.3)] },
  },

  // -------------------------------------------------------------------- Rogue
  {
    id: "rogue-shadowstep", className: "Rogue", kind: "dash", name: "Shadowstep", element: "poison",
    blurb: "Slips sideways and reappears at the enemy's flank, blade already moving.",
    cooldown: 3.5,
    payload: { damageMul: 0.9, stun: 0.1, knockbackMul: 0.6, lifesteal: 0 },
    // J-C: the slip now LANDS a cut instead of drifting past — the weapon arm travels 71.6° (was
    // 57.3°), the off arm braces against the flank rush and the head leads the turn into the blade.
    animation: { duration: 0.4, hitAt: 0.3, lunge: 2.7, hop: 0.16, effectIntensity: 0.6,
      tracks: [...strikeTracks(0.3, 1.25, -0.65, -0.3), track("head", -0.2, 0.3), ...legDrive(0.3, 0.85, -0.8)] },
  },
  {
    id: "rogue-venom-strike", className: "Rogue", kind: "power", name: "Venom Strike", element: "poison",
    blurb: "Coats the blade and opens a vein; the wound keeps burning after the hit.",
    cooldown: 7,
    payload: { damageMul: 1.2, stun: 0.2, knockbackMul: 0.7, lifesteal: 0, dot: { total: 14, seconds: 4 } },
    animation: { duration: 0.7, hitAt: 0.36, lunge: 1.2, hop: 0, effectIntensity: 0.85,
      tracks: [...strikeTracks(0.36, 1.5, -0.6, -0.3), ...legDrive(0.36, 0.6, -0.55)] },
  },
  {
    id: "rogue-evasion", className: "Rogue", kind: "defense", name: "Evasion", element: "poison",
    blurb: "Loose stance and quick feet: harder to pin down and quicker between strikes.",
    cooldown: 9,
    payload: { damageMul: 0.45, stun: 0, knockbackMul: 0.4, lifesteal: 0, armorMul: 1.3, speedMul: 1.25, attackIntervalMul: 0.8 },
    animation: { duration: 0.9, hitAt: 0.3, lunge: 0, hop: 0.08, effectIntensity: 0.3,
      // One track per joint: crouch() already drives spine, so the loose-stance
      // wobble is added on the abdomen instead of shadowing the spine track.
      tracks: [...crouch(0.3, 0.2), track("shoulderR", -0.95, 0.3), track("elbowR", -1.25, 0.3),
        track("shoulderL", -0.5, 0.3), track("neck", -0.12, 0.3, [0.12, 2.5, 1.2]), track("head", -0.15, 0.3)] },
  },

  // ----------------------------------------------------------------- Assassin
  {
    id: "assassin-deathmark", className: "Assassin", kind: "dash", name: "Death Mark", element: "shadow",
    blurb: "Blinks through the target and marks them; the next strike bites deeper.",
    cooldown: 4,
    payload: { damageMul: 1.0, stun: 0.1, knockbackMul: 0.5, lifesteal: 0 },
    animation: { duration: 0.38, hitAt: 0.28, lunge: 3.4, hop: 0.2, effectIntensity: 0.6,
      tracks: [...strikeTracks(0.28, 1.15, -0.45, -0.2), ...legDrive(0.28, 0.85, -0.8)] },
  },
  {
    id: "assassin-execution", className: "Assassin", kind: "power", name: "Execution", element: "shadow",
    blurb: "A single committed thrust. Devastating against a wounded enemy.",
    cooldown: 8.5,
    payload: { damageMul: 2.6, stun: 0.3, knockbackMul: 1.0, lifesteal: 0.15 },
    animation: { duration: 0.75, hitAt: 0.4, lunge: 1.6, hop: 0, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.4, 1.7, -0.55, -0.35), ...legDrive(0.4, 0.65, -0.6)] },
  },
  {
    id: "assassin-vanish", className: "Assassin", kind: "defense", name: "Vanish", element: "shadow",
    blurb: "Wraps in shadow — nearly untouchable, but the stance costs reach and speed.",
    cooldown: 10,
    payload: { damageMul: 0.45, stun: 0, knockbackMul: 0.3, lifesteal: 0, armorMul: 1.8, speedMul: 0.7, attackIntervalMul: 1.15 },
    animation: { duration: 0.95, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.4,
      tracks: [...crouch(0.3, 0.28), track("shoulderL", -0.9, 0.3), track("shoulderR", -0.9, 0.3), track("head", 0.3, 0.3)] },
  },

  // --------------------------------------------------------------------- Mage
  {
    id: "mage-blink", className: "Mage", kind: "dash", name: "Blink", element: "arcane",
    blurb: "Folds space to appear a few paces away, staff already levelled.",
    cooldown: 4,
    payload: { damageMul: 0.7, stun: 0.1, knockbackMul: 0.5, lifesteal: 0 },
    animation: { duration: 0.45, hitAt: 0.3, lunge: 2.8, hop: 0.22, effectIntensity: 0.55,
      tracks: [...strikeTracks(0.3, 1.3, -0.6, -0.15), ...legDrive(0.3, 0.5, -0.5)] },
  },
  {
    id: "mage-arcane-nova", className: "Mage", kind: "power", name: "Arcane Nova", element: "arcane",
    blurb: "Detonates a ring of raw magic centred on the staff.",
    cooldown: 8,
    payload: { damageMul: 1.75, stun: 0.55, knockbackMul: 1.5, lifesteal: 0 },
    // J-C: the staff snaps out further (the arm travels 106.0°, was 91.7°); the caster is thrown a
    // touch further back and hops higher, blown off his own detonation.
    animation: { duration: 0.9, hitAt: 0.44, lunge: 0.25, hop: 0.3, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.44, 1.85, -1.7, -0.55), track("head", -0.45, 0.44, [0.06, 4.0, 0])] },
  },
  {
    id: "mage-mana-shield", className: "Mage", kind: "defense", name: "Mana Shield", element: "arcane",
    blurb: "A humming ward absorbs blows, but it slows the caster's feet.",
    cooldown: 10,
    payload: { damageMul: 0.4, stun: 0, knockbackMul: 0.4, lifesteal: 0, armorMul: 2.4, speedMul: 0.65, attackIntervalMul: 1.1 },
    animation: { duration: 1.0, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.6,
      tracks: [...crouch(0.3, 0.18), track("shoulderL", -1.5, 0.3), track("shoulderR", -1.5, 0.3),
        track("elbowL", -1.6, 0.3), track("elbowR", -1.6, 0.3)] },
  },

  // -------------------------------------------------------------- Necromancer
  {
    id: "necro-grave-step", className: "Necromancer", kind: "dash", name: "Grave Step", element: "necrotic",
    blurb: "Sinks into the ground and rises at the enemy's back.",
    cooldown: 4.5,
    payload: { damageMul: 0.8, stun: 0.15, knockbackMul: 0.6, lifesteal: 0.1 },
    animation: { duration: 0.5, hitAt: 0.32, lunge: 2.7, hop: 0.15, effectIntensity: 0.5,
      tracks: [...strikeTracks(0.32, 1.2, -0.6, -0.3), ...legDrive(0.32, 0.6, -0.6)] },
  },
  {
    id: "necro-soul-rend", className: "Necromancer", kind: "power", name: "Soul Rend", element: "necrotic",
    blurb: "Tears at the spirit as much as the body, and drinks what comes loose.",
    cooldown: 8.5,
    payload: { damageMul: 1.7, stun: 0.35, knockbackMul: 0.9, lifesteal: 0.35 },
    animation: { duration: 0.9, hitAt: 0.4, lunge: 0.8, hop: 0.1, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.4, 1.6, -1.0, -0.4), ...legDrive(0.4, 0.5, -0.5), track("head", -0.3, 0.4)] },
  },
  {
    id: "necro-bone-armor", className: "Necromancer", kind: "defense", name: "Bone Armor", element: "necrotic",
    blurb: "Plates of dead bone knit over the ribs. Heavy, but very hard to break.",
    cooldown: 11,
    payload: { damageMul: 0.35, stun: 0, knockbackMul: 0.35, lifesteal: 0.05, armorMul: 2.6, speedMul: 0.55, attackIntervalMul: 1.35 },
    animation: { duration: 1.15, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.35,
      tracks: [...crouch(0.3, 0.3), track("shoulderL", -1.1, 0.3), track("shoulderR", -1.1, 0.3)] },
  },

  // ------------------------------------------------------------------- Archer
  {
    id: "archer-rollback", className: "Archer", kind: "dash", name: "Rolling Shot", element: "wind",
    blurb: "Rolls away from the enemy and looses an arrow on the way out.",
    cooldown: 3.5,
    payload: { damageMul: 0.75, stun: 0.05, knockbackMul: 0.4, lifesteal: 0 },
    animation: { duration: 0.5, hitAt: 0.34, lunge: -2.6, hop: 0.1, effectIntensity: 0.45,
      tracks: [...strikeTracks(0.34, 0.9, -0.7, 0.3), ...legDrive(0.34, -0.6, 0.6)] },
  },
  {
    id: "archer-piercing-shot", className: "Archer", kind: "power", name: "Piercing Shot", element: "wind",
    blurb: "A drawn shot that punches through armour at long range.",
    cooldown: 7.5,
    payload: { damageMul: 1.85, stun: 0.25, knockbackMul: 1.8, lifesteal: 0 },
    animation: { duration: 0.85, hitAt: 0.5, lunge: -0.4, hop: 0, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.5, 1.5, -1.35, -0.3), track("head", -0.2, 0.5), ...legDrive(0.5, -0.25, 0.25)] },
  },
  {
    id: "archer-steady-aim", className: "Archer", kind: "defense", name: "Steady Aim", element: "wind",
    blurb: "Feet planted, breath held — every shot lands, but movement stops.",
    cooldown: 9,
    payload: { damageMul: 0.6, stun: 0, knockbackMul: 0.5, lifesteal: 0, armorMul: 1.5, speedMul: 0.4, attackIntervalMul: 0.85 },
    animation: { duration: 1.0, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.35,
      tracks: [...crouch(0.3, 0.16), track("shoulderL", -1.45, 0.3), track("shoulderR", -1.45, 0.3), track("head", -0.1, 0.3)] },
  },

  // ------------------------------------------------------------------- Priest
  {
    id: "priest-divine-step", className: "Priest", kind: "dash", name: "Divine Step", element: "holy",
    blurb: "Steps forward on a flare of light, mace leading.",
    cooldown: 4.5,
    payload: { damageMul: 0.8, stun: 0.15, knockbackMul: 1.2, lifesteal: 0.1 },
    animation: { duration: 0.5, hitAt: 0.32, lunge: 2.6, hop: 0.14, effectIntensity: 0.6,
      tracks: [...strikeTracks(0.32, 1.05, -0.85, -0.3), ...legDrive(0.32, 0.65, -0.65)] },
  },
  {
    id: "priest-smite", className: "Priest", kind: "power", name: "Smite", element: "holy",
    blurb: "Calls down a column of light that staggers the unholy.",
    cooldown: 8,
    payload: { damageMul: 1.8, stun: 0.75, knockbackMul: 1.3, lifesteal: 0 },
    animation: { duration: 0.9, hitAt: 0.42, lunge: 0.4, hop: 0.2, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.42, 1.8, -1.2, -0.5), track("head", -0.4, 0.42), ...legDrive(0.42, 0.4, -0.4)] },
  },
  {
    id: "priest-sanctuary", className: "Priest", kind: "defense", name: "Sanctuary", element: "holy",
    blurb: "A consecrated circle mends the priest while it holds the line.",
    cooldown: 11,
    payload: { damageMul: 0.35, stun: 0, knockbackMul: 0.4, lifesteal: 0.25, armorMul: 1.9, speedMul: 0.6, attackIntervalMul: 1.2 },
    animation: { duration: 1.15, hitAt: 0.3, lunge: 0, hop: 0, effectIntensity: 0.7,
      tracks: [...crouch(0.3, 0.2), track("shoulderL", -1.3, 0.3), track("shoulderR", -1.3, 0.3),
        track("elbowL", -1.7, 0.3), track("elbowR", -1.7, 0.3), track("head", 0.25, 0.3)] },
  },
];

export const SKILLS_BY_CLASS: Record<ClassName, Skill[]> = Object.fromEntries(
  CLASSES.map((c) => [c, SKILLS.filter((s) => s.className === c)]),
) as Record<ClassName, Skill[]>;

export function skillsForClass(className: ClassName): Skill[] {
  return SKILLS_BY_CLASS[className];
}

export const ALL_SKILLS: readonly Skill[] = SKILLS;

// ─────────────────────────────────────────────────────────────────────────────
// Wave S (lane S-A): FIVE POWERS PER CLASS.
//
// A power is a Skill plus a declared SHAPE and the two inputs it scales from. Every number on it
// (amplitude, castSeconds, durationSeconds, manaCost, cooldownSeconds) is produced by
// PowerCost.derivePower from the class's own statistics and its equipped weapon — nothing is typed
// by hand. The animation reuses the same joint-track helpers as the three skills above (extended,
// not replaced): a SHAPE picks the track set, and the WIND-UP length IS the cast time.
// ─────────────────────────────────────────────────────────────────────────────

/** A power: an archetype-true technique with a declared shape and a fully derived stat block. */
export interface Power {
  id: string;
  className: ClassName;
  shape: PowerShape;
  element: Element;
  name: string;
  blurb: string;
  /** The two inputs every number scales from: one attribute, one weapon property. */
  scale: PowerScale;
  /** Amplitude (damage multiplier) — PowerCost.powerOf. */
  amplitude: number;
  /** Channel length before the release, s — PowerCost.castSecondsOf. */
  castSeconds: number;
  /** How long an aura / self-buff holds, s — PowerCost.durationSecondsOf (0 for a strike). */
  durationSeconds: number;
  /** What the cast spends — PowerCost.manaCostOf. */
  manaCost: number;
  /** Seconds before another cast — PowerCost.cooldownSecondsOf. */
  cooldownSeconds: number;
  payload: SkillPayload;
  animation: SkillAnimation;
}

/** The caster's own loadout: the class's statistics and its equipped weapon. */
function loadoutFor(className: ClassName): { stats: CombatStats; weapon: Weapon } {
  return { stats: createStats(className), weapon: weaponForClass(className) };
}

/** Per-shape animation flourishes, so a shape reads before the numbers do. */
const SHAPE_LUNGE: Record<PowerShape, number> = { instant: 1.4, projectile: 0.2, cone: 0.3, aura: 0, "self-buff": 0 };
const SHAPE_HOP: Record<PowerShape, number> = { instant: 0, projectile: 0, cone: 0.1, aura: 0, "self-buff": 0.08 };
const SHAPE_INTENSITY: Record<PowerShape, number> = { instant: 0.9, projectile: 1.0, cone: 1.0, aura: 0.6, "self-buff": 0.7 };

/**
 * The joint tracks for a shape, built on the SAME helpers the skills use (strikeTracks, legDrive,
 * crouch). Each shape drives a distinct set, and no joint is driven twice (the later track would
 * shadow the first).
 */
function shapeTracks(shape: PowerShape, peak: number): JointTrack[] {
  switch (shape) {
    case "instant":
      return [...strikeTracks(peak, 1.6, -0.7, -0.35), ...legDrive(peak, 0.6, -0.55)];
    case "projectile":
      return [...strikeTracks(peak, 1.45, -1.1, -0.25), ...legDrive(peak, 0.35, -0.35), track("head", -0.2, peak)];
    case "cone":
      return [...strikeTracks(peak, 1.9, -1.3, -0.5), ...legDrive(peak, 0.5, -0.5), track("head", -0.35, peak)];
    case "aura":
      // A ward: sink and raise both arms; crouch() already drives spine/abdomen and the legs, so the
      // arms, head come from their own tracks (never a second track on the same joint).
      return [...crouch(peak, 0.24),
        track("shoulderR", -1.4, peak), track("shoulderL", -1.4, peak),
        track("elbowR", -1.7, peak), track("elbowL", -1.7, peak), track("head", 0.3, peak)];
    case "self-buff":
      return [...crouch(peak, 0.18),
        track("shoulderR", -1.2, peak), track("shoulderL", -1.2, peak),
        track("elbowR", -1.5, peak), track("elbowL", -1.5, peak), track("neck", -0.15, peak)];
  }
}

/** A power spec: the archetype choices only. Every number is derived in buildPower. */
interface PowerSpec {
  id: string;
  className: ClassName;
  shape: PowerShape;
  element: Element;
  name: string;
  blurb: string;
  scale: PowerScale;
  /** Buff/DoT payload a power's archetype adds on top of the derived strike. */
  extra?: Partial<SkillPayload>;
}

const POWER_SPECS: PowerSpec[] = [
  // ------------------------------------------------------------------ Barbarian (body, no missile)
  { id: "barbarian-cleave", className: "Barbarian", shape: "instant", element: "fury", name: "Cleave", scale: { attribute: "strength", weapon: "weight" },
    blurb: "A wide greataxe chop that splits whatever stands in the arc." },
  { id: "barbarian-skull-crush", className: "Barbarian", shape: "cone", element: "fury", name: "Skull Crush", scale: { attribute: "strength", weapon: "damage" },
    blurb: "A full overhead smash that shatters a cone of everything ahead." },
  { id: "barbarian-blood-roar", className: "Barbarian", shape: "self-buff", element: "fury", name: "Blood Roar", scale: { attribute: "vitality", weapon: "weight" },
    blurb: "Roars himself into a frenzy: faster swings and a longer stride.", extra: { speedMul: 1.15, attackIntervalMul: 0.85 } },
  { id: "barbarian-war-stomp", className: "Barbarian", shape: "aura", element: "fury", name: "War Stomp", scale: { attribute: "vitality", weapon: "knockback" },
    blurb: "Stamps the ground; the shock rings out and braces him against the reply.", extra: { armorMul: 1.4 } },
  { id: "barbarian-reaver-gore", className: "Barbarian", shape: "instant", element: "poison", name: "Reaver Gore", scale: { attribute: "strength", weapon: "sharpness" },
    blurb: "A rusty spike driven low and twisted — the wound festers.", extra: { dot: { total: 12, seconds: 4 } } },

  // -------------------------------------------------------------------- Warrior (shield, no missile)
  { id: "warrior-crushing-blow", className: "Warrior", shape: "instant", element: "fire", name: "Crushing Blow", scale: { attribute: "strength", weapon: "damage" },
    blurb: "A diagonal longsword cut, fire running the length of the blade." },
  { id: "warrior-shield-bash", className: "Warrior", shape: "cone", element: "fire", name: "Shield Bash", scale: { attribute: "strength", weapon: "weight" },
    blurb: "Drives the shield into a wedge of enemies and staggers the front rank." },
  { id: "warrior-defensive-stance", className: "Warrior", shape: "self-buff", element: "fire", name: "Defensive Stance", scale: { attribute: "resilience", weapon: "balance" },
    blurb: "Digs in: armour up, but every swing and every step is slower.", extra: { armorMul: 1.5, speedMul: 0.75, attackIntervalMul: 1.2 } },
  { id: "warrior-battle-standard", className: "Warrior", shape: "aura", element: "holy", name: "Battle Standard", scale: { attribute: "resilience", weapon: "reach" },
    blurb: "Plants the banner; the ground around it hardens the line.", extra: { armorMul: 1.6, speedMul: 0.9 } },
  { id: "warrior-whirlwind", className: "Warrior", shape: "cone", element: "wind", name: "Whirlwind", scale: { attribute: "reflex", weapon: "balance" },
    blurb: "Spins the blade through the whole arc, catching everyone around him." },

  // --------------------------------------------------------------------------- Rogue (no aura)
  { id: "rogue-backstab", className: "Rogue", shape: "instant", element: "poison", name: "Backstab", scale: { attribute: "reflex", weapon: "sharpness" },
    blurb: "A dagger driven between the ribs from behind the guard." },
  { id: "rogue-sprint", className: "Rogue", shape: "self-buff", element: "wind", name: "Sprint", scale: { attribute: "reflex", weapon: "weight" },
    blurb: "A burst of footspeed to cross the ring before the enemy turns.", extra: { speedMul: 1.6, attackIntervalMul: 0.9 } },
  { id: "rogue-throw-knife", className: "Rogue", shape: "projectile", element: "poison", name: "Throw Knife", scale: { attribute: "reflex", weapon: "balance" },
    blurb: "A balanced blade flicked across the gap to open the fight at range." },
  { id: "rogue-eviscerate", className: "Rogue", shape: "instant", element: "poison", name: "Eviscerate", scale: { attribute: "reflex", weapon: "damage" },
    blurb: "A raking double cut that leaves the wound bleeding.", extra: { dot: { total: 16, seconds: 4 } } },
  { id: "rogue-fan-of-knives", className: "Rogue", shape: "cone", element: "wind", name: "Fan of Knives", scale: { attribute: "reflex", weapon: "reach" },
    blurb: "Sprays a fan of blades across everything in front of him." },

  // ------------------------------------------------------------------------ Assassin (no aura)
  { id: "assassin-vanish", className: "Assassin", shape: "self-buff", element: "shadow", name: "Vanish", scale: { attribute: "reflex", weapon: "weight" },
    blurb: "Wraps in shadow and slips out of sight — the concealment is the engine's own.", extra: { armorMul: 1.3, speedMul: 1.1 } },
  { id: "assassin-sprint", className: "Assassin", shape: "self-buff", element: "wind", name: "Shadow Sprint", scale: { attribute: "reflex", weapon: "weight" },
    blurb: "A silent run along the dark: a longer stride and quicker hands.", extra: { speedMul: 1.7, attackIntervalMul: 0.85 } },
  { id: "assassin-mark-and-execute", className: "Assassin", shape: "instant", element: "shadow", name: "Mark and Execute", scale: { attribute: "strength", weapon: "sharpness" },
    blurb: "A committed thrust into the marked throat; the kill feeds him.", extra: { lifesteal: 0.15 } },
  { id: "assassin-shadow-bolt", className: "Assassin", shape: "projectile", element: "shadow", name: "Shadow Bolt", scale: { attribute: "intelligence", weapon: "balance" },
    blurb: "A dart of pure shadow cast across the ring." },
  { id: "assassin-killing-spree", className: "Assassin", shape: "cone", element: "fury", name: "Killing Spree", scale: { attribute: "reflex", weapon: "reach" },
    blurb: "A blur of blades that cuts through a wedge of the front line." },

  // ---------------------------------------------------------------------------- Mage (no instant)
  { id: "mage-fireball", className: "Mage", shape: "projectile", element: "fire", name: "Fireball", scale: { attribute: "intelligence", weapon: "damage" },
    blurb: "Hurls a roiling ball of flame that bursts on contact." },
  { id: "mage-force-cone", className: "Mage", shape: "cone", element: "arcane", name: "Force Cone", scale: { attribute: "intelligence", weapon: "reach" },
    blurb: "A widening cone of raw force that shoves everything out of the staff's arc." },
  { id: "mage-frostbolt", className: "Mage", shape: "projectile", element: "arcane", name: "Frostbolt", scale: { attribute: "intelligence", weapon: "balance" },
    blurb: "A shard of ice that slows whatever it stitches." },
  { id: "mage-mana-ward", className: "Mage", shape: "aura", element: "arcane", name: "Mana Ward", scale: { attribute: "willpower", weapon: "balance" },
    blurb: "A humming ward around the caster that eats incoming blows.", extra: { armorMul: 1.7, speedMul: 0.85 } },
  { id: "mage-arcane-surge", className: "Mage", shape: "self-buff", element: "arcane", name: "Arcane Surge", scale: { attribute: "willpower", weapon: "sharpness" },
    blurb: "Floods the channel with power: quicker casts and a quicker step.", extra: { attackIntervalMul: 0.8, speedMul: 1.1 } },

  // --------------------------------------------------------------------- Necromancer (no instant)
  { id: "necro-soul-bolt", className: "Necromancer", shape: "projectile", element: "necrotic", name: "Soul Bolt", scale: { attribute: "intelligence", weapon: "damage" },
    blurb: "A bolt of torn spirit that drinks what it loosens.", extra: { lifesteal: 0.2 } },
  { id: "necro-plague-cloud", className: "Necromancer", shape: "aura", element: "poison", name: "Plague Cloud", scale: { attribute: "willpower", weapon: "knockback" },
    blurb: "A lingering cloud of rot that clings to a patch of ground.", extra: { armorMul: 1.3 } },
  { id: "necro-bone-armor-buff", className: "Necromancer", shape: "self-buff", element: "necrotic", name: "Bone Armor", scale: { attribute: "resilience", weapon: "weight" },
    blurb: "Plates of dead bone knit over the ribs — heavy, but very hard to break.", extra: { armorMul: 1.9, speedMul: 0.8 } },
  { id: "necro-death-pulse", className: "Necromancer", shape: "cone", element: "necrotic", name: "Death Pulse", scale: { attribute: "willpower", weapon: "reach" },
    blurb: "A wave of necrotic force rolls out in a cone, withering the living." },
  { id: "necro-grave-splinter", className: "Necromancer", shape: "projectile", element: "necrotic", name: "Grave Splinter", scale: { attribute: "intelligence", weapon: "sharpness" },
    blurb: "A shard of grave-bone fired at range; the gash drinks a little life.", extra: { lifesteal: 0.15 } },

  // ------------------------------------------------------------------------------ Archer (no aura)
  { id: "archer-piercing-shot", className: "Archer", shape: "projectile", element: "wind", name: "Piercing Shot", scale: { attribute: "reflex", weapon: "damage" },
    blurb: "A drawn arrow that punches through armour at long range." },
  { id: "archer-multishot", className: "Archer", shape: "cone", element: "wind", name: "Multishot", scale: { attribute: "reflex", weapon: "reach" },
    blurb: "Looses a spread of arrows across everything in front of him." },
  { id: "archer-hawk-eye", className: "Archer", shape: "self-buff", element: "wind", name: "Hawk Eye", scale: { attribute: "reflex", weapon: "balance" },
    blurb: "Steadies the aim: a faster draw and a keener eye.", extra: { attackIntervalMul: 0.8 } },
  { id: "archer-snare-arrow", className: "Archer", shape: "projectile", element: "poison", name: "Snare Arrow", scale: { attribute: "reflex", weapon: "sharpness" },
    blurb: "A barbed arrow that pins the target to the spot." },
  { id: "archer-quick-draw", className: "Archer", shape: "instant", element: "wind", name: "Quick Draw", scale: { attribute: "reflex", weapon: "weight" },
    blurb: "A snap shot at point-blank from the hip." },

  // ----------------------------------------------------------------------------- Priest (no instant)
  { id: "priest-sanctuary", className: "Priest", shape: "aura", element: "holy", name: "Sanctuary", scale: { attribute: "willpower", weapon: "balance" },
    blurb: "A consecrated circle that mends the priest while it holds the line.", extra: { armorMul: 1.7, speedMul: 0.9 } },
  { id: "priest-holy-nova", className: "Priest", shape: "cone", element: "holy", name: "Holy Nova", scale: { attribute: "intelligence", weapon: "reach" },
    blurb: "A burst of light rolls out in a cone, staggering the unholy." },
  { id: "priest-divine-favor", className: "Priest", shape: "self-buff", element: "holy", name: "Divine Favor", scale: { attribute: "willpower", weapon: "weight" },
    blurb: "A mantle of faith that turns aside the next blows.", extra: { armorMul: 1.5 } },
  { id: "priest-smite-bolt", className: "Priest", shape: "projectile", element: "holy", name: "Smite Bolt", scale: { attribute: "intelligence", weapon: "damage" },
    blurb: "A lance of holy light cast across the ring." },
  { id: "priest-consecrate", className: "Priest", shape: "aura", element: "holy", name: "Consecrate", scale: { attribute: "willpower", weapon: "knockback" },
    blurb: "Hallows the ground; the holy fire sears whoever stands in it.", extra: { armorMul: 1.4 } },
];

/** Build a power: every number derived from the class's stats and weapon, the animation from shape. */
function buildPower(s: PowerSpec): Power {
  const { stats, weapon } = loadoutFor(s.className);
  const d = derivePower({ shape: s.shape, element: s.element, scale: s.scale, stats, weapon });
  // The wind-up IS the channel: the animation runs the cast time plus a fixed release-and-return
  // tail (0.3 s), so the strike lands at castSeconds / duration — always inside (0, 1).
  const duration = d.castSeconds + 0.3;
  const hitAt = d.castSeconds / duration;
  const payload: SkillPayload = {
    damageMul: d.amplitude,
    stun: d.stun,
    knockbackMul: d.knockbackMul,
    lifesteal: 0,
    ...s.extra,
  };
  return {
    id: s.id,
    className: s.className,
    shape: s.shape,
    element: s.element,
    name: s.name,
    blurb: s.blurb,
    scale: s.scale,
    amplitude: d.amplitude,
    castSeconds: d.castSeconds,
    durationSeconds: d.durationSeconds,
    manaCost: d.manaCost,
    cooldownSeconds: d.cooldownSeconds,
    payload,
    animation: {
      duration,
      hitAt,
      tracks: shapeTracks(s.shape, hitAt),
      lunge: SHAPE_LUNGE[s.shape],
      hop: SHAPE_HOP[s.shape],
      effectIntensity: SHAPE_INTENSITY[s.shape],
      windupFraction: hitAt,
      shape: s.shape,
    },
  };
}

export const POWERS: Power[] = POWER_SPECS.map(buildPower);

export const POWERS_BY_CLASS: Record<ClassName, Power[]> = Object.fromEntries(
  CLASSES.map((c) => [c, POWERS.filter((p) => p.className === c)]),
) as Record<ClassName, Power[]>;

export function powersForClass(className: ClassName): Power[] {
  return POWERS_BY_CLASS[className];
}

export const ALL_POWERS: readonly Power[] = POWERS;
