// Skill roster: every class owns three skills — a dash, a power strike and a
// defensive stance — each with its own animation profile, elemental effect and
// combat payload. Pure data + lookups, no Three.js and no DOM.

import { CLASSES, type ClassName } from "./Stats.ts";
import type { JointName } from "./Skeleton.ts";

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
    animation: { duration: 0.95, hitAt: 0.42, lunge: 0.9, hop: 0.18, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.42, 1.9, -1.1, -0.5), ...legDrive(0.42, 0.5, -0.45), track("head", -0.3, 0.42)] },
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
    animation: { duration: 0.4, hitAt: 0.3, lunge: 2.6, hop: 0.12, effectIntensity: 0.5,
      tracks: [...strikeTracks(0.3, 1.0, -0.5, -0.25), ...legDrive(0.3, 0.8, -0.75)] },
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
    animation: { duration: 0.9, hitAt: 0.44, lunge: 0.2, hop: 0.25, effectIntensity: 1.0,
      tracks: [...strikeTracks(0.44, 1.6, -1.5, -0.55), track("head", -0.45, 0.44, [0.06, 4.0, 0])] },
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
