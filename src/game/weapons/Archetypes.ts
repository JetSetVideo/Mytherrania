// Weapon archetypes (W06): the families a fighter can be handed, each described by RANGES on
// the physical axes everything else is derived from (R08). Generate.ts samples inside these
// ranges; Profile.ts turns the sampled physics into combat numbers. Nothing in this table is
// a combat number: there is no damage, crit or speed column, by design.
//
// Vocabulary (units):
//   length          overall length, butt/pommel end to tip, m.
//   mass            total mass, kg.
//   headLength      length of the striking part measured along its own centreline, m
//                   (blade from the guard to the tip; axe/mace/hammer head height along the
//                   haft; flail chain + ball; 0 for a staff or a bow).
//   sharpness       0..1 keenness of the edge or point (0 = blunt face).
//   curvature       0..1 bend of the blade (sabre, scythe), crescent of an axe bit, droop of a
//                   hammer beak, recurve of a bow limb. 0 for straight families.
//   headRadius      radial extent of the striking part from the weapon axis, m: blade
//                   half-width at the base; axe/halberd bit depth (axis -> edge); mace, flail,
//                   maul head radius; hammer face radius; staff shaft radius; arrowhead
//                   half-width for a bow.
//   balanceFraction centre of mass along +y from the main grip divided by the FORWARD length
//                   (main grip -> tip). 0 = balanced in the hand, 1 = all mass at the tip.
//   tailFraction    share of the overall length that lies BEHIND the main grip (the butt or
//                   the pommel side). Blades derive it from the hilt instead.
//
// Historical references (typical surviving / reconstructed pieces) are cited per archetype;
// ranges are deliberately a little narrower than history so every roll reads as its family.

import type { ArchetypeId, DamageKind, GripMode, GripPoint, WeaponClass } from "../../combat/contracts.ts";
import type { ClassName } from "../Stats.ts";
import type { MetalName, WeaponType } from "../WeaponGen.ts";

/** A closed interval [min, max] on one physical axis. */
export interface AxisRange {
  min: number;
  max: number;
}

/** Structural family: decides the part model (mass layout) and the mesh builder. */
export type WeaponFamily = "blade" | "polearm" | "hafted" | "flail" | "staff" | "bow";

/** Shape of the striking head (mesh + strike features). */
export type HeadStyle =
  | "blade" | "leaf" | "halberd" | "scythe" | "axe" | "flanged" | "ball" | "hammer" | "block"
  | "ferrule" | "limbs";

/** A grip the archetype offers; its position along +y is resolved by Generate from the hilt/haft. */
export interface GripTemplate {
  id: GripPoint["id"];
  /** Supported grip modes, preferred first. */
  modes: GripMode[];
}

/** The seven physical axes every archetype samples (see the vocabulary above). */
export interface ArchetypeAxes {
  length: AxisRange;
  mass: AxisRange;
  headLength: AxisRange;
  sharpness: AxisRange;
  curvature: AxisRange;
  headRadius: AxisRange;
  balanceFraction: AxisRange;
}

/** Hilt of a bladed weapon (family "blade"). */
export interface HiltBuild {
  /** Handle (grip wrap) length, m. */
  handle: AxisRange;
  /** Guard thickness along +y, m. */
  guardThickness: number;
  /** Guard half span (quillon tip to axis), m. */
  guardHalfSpan: AxisRange;
  /** Pommel length along +y, m (its MASS is solved from the balance). */
  pommelLength: number;
  /** Guard mass as a share of the total mass (rapier swept hilts are heavy). */
  guardShare: number;
  /** One cutting edge (sabre) instead of two. */
  singleEdged: boolean;
  /** Fuller groove down the flat (lightens the blade). */
  fullered: boolean;
  /** Blade bend at curvature 1, rad (sabre ~0.55: the tip sits ~0.2 m behind the line). */
  maxBend: number;
}

/** Haft of a pole/hafted/flail/staff/bow weapon. */
export interface HaftBuild {
  /** Share of the overall length behind the main grip. */
  tailFraction: number;
  /** Haft radius, m (an ash haft is 28-40 mm across). */
  shaftRadius: AxisRange;
  /** Haft mass is wood density x volume, clamped to this share of the total mass. */
  haftShare: AxisRange;
}

/** Bow-only axes. Speed and draw time are DERIVED from these (Generate.ts). */
export interface RangedBuild {
  /** Draw length, m (an English war bow drew 0.71-0.76 m: "a clothyard"). */
  drawLength: AxisRange;
  /** Peak draw force, N (45-145 lbf; Mary Rose bows are estimated at 100-185 lbf). */
  drawForce: AxisRange;
  /** Arrow mass, kg (war arrows 50-100 g). */
  arrowMass: AxisRange;
}

/** One archetype: identity, class, damage mix, grips and the axis ranges. */
export interface ArchetypeSpec {
  id: ArchetypeId;
  /** Menu label. */
  label: string;
  /** Noun used in generated names ("Curved Bronze Sabre"). */
  noun: string;
  weaponClass: WeaponClass;
  family: WeaponFamily;
  head: HeadStyle;
  hands: 1 | 1.5 | 2;
  /** How the weapon delivers damage on average (weights sum to 1). */
  mix: Record<DamageKind, number>;
  grips: GripTemplate[];
  axes: ArchetypeAxes;
  hilt?: HiltBuild;
  haft?: HaftBuild;
  ranged?: RangedBuild;
  /** Metals the head may be made of (obsidian shatters on blunt heads, so they exclude it). */
  metals: MetalName[];
  /** Relative rarity in rollWeapon (a design parameter: how often the family is handed out). */
  rollWeight: number;
  /** Closest legacy WeaponType (Weapon.ts / WeaponGen.ts) for the adapters. */
  legacyType: WeaponType;
}

const r = (min: number, max: number): AxisRange => ({ min, max });
const fixed = (v: number): AxisRange => ({ min: v, max: v });
const ALL_METALS: MetalName[] = ["steel", "iron", "bronze", "silver", "gold", "obsidian"];
const BLUNT_METALS: MetalName[] = ["steel", "iron", "bronze", "silver", "gold"];

const ONE_HAND: GripTemplate[] = [{ id: "main", modes: ["forward"] }];
const TWO_HAND: GripTemplate[] = [{ id: "main", modes: ["forward"] }, { id: "off", modes: ["forward"] }];
const POLE_GRIPS: GripTemplate[] = [...TWO_HAND, { id: "choke", modes: ["forward"] }];

/**
 * Why a dagger PREFERS the reverse ("ice-pick") grip: the strongest motion a human arm makes
 * is the downward hammer-fist drive (shoulder extensors + pectorals + dropping body weight).
 * Held reverse, that motion pushes ALONG the blade, so the force becomes a thrust that
 * penetrates instead of a sideways lever on the wrist, and the pommel locks against the thumb
 * so the blade cannot fold back on impact. Profile.ts turns this into a higher thrust share,
 * more impact and armour pierce, at a shorter reach.
 */
const DAGGER_GRIPS: GripTemplate[] = [{ id: "main", modes: ["reverse", "forward"] }];

/** Every archetype. Ranges cite typical historical pieces (see each comment). */
export const ARCHETYPES: Record<ArchetypeId, ArchetypeSpec> = {
  // Rondel / quillon daggers 0.3-0.5 m, 0.25-0.5 kg; Fairbairn-Sykes 0.29 m 0.25 kg;
  // a jambiya is curved. Balance sits at the guard. The quillons span >= 7 cm (look only:
  // the guard's width is 6 px at 7 m, the dagger's one readable feature besides its size).
  dagger: {
    id: "dagger", label: "Dagger", noun: "Dagger", weaponClass: "finesse", family: "blade",
    head: "blade", hands: 1, mix: { cut: 0.4, thrust: 0.6, blunt: 0 }, grips: DAGGER_GRIPS,
    axes: {
      length: r(0.27, 0.46), mass: r(0.2, 0.5), headLength: r(0.14, 0.3), sharpness: r(0.75, 1),
      curvature: r(0, 0.35), headRadius: r(0.012, 0.024), balanceFraction: r(0.05, 0.3),
    },
    hilt: {
      handle: r(0.085, 0.13), guardThickness: 0.012, guardHalfSpan: r(0.035, 0.055), pommelLength: 0.025,
      guardShare: 0.1, singleEdged: false, fullered: false, maxBend: 0.5,
    },
    metals: ALL_METALS, rollWeight: 1.2, legacyType: "dagger",
  },
  // Roman gladius: Pompeii type 0.6-0.75 m overall, blade 0.45-0.5 m, ~1 kg; Mainz type
  // blade 0.5-0.55 m, up to 1.2 kg. Point-heavy thrusting blade, small hilt.
  shortsword: {
    id: "shortsword", label: "Short sword", noun: "Shortsword", weaponClass: "finesse", family: "blade",
    head: "blade", hands: 1, mix: { cut: 0.45, thrust: 0.55, blunt: 0 }, grips: ONE_HAND,
    axes: {
      length: r(0.6, 0.78), mass: r(0.7, 1.2), headLength: r(0.45, 0.6), sharpness: r(0.7, 0.95),
      curvature: fixed(0), headRadius: r(0.022, 0.03), balanceFraction: r(0.1, 0.3),
    },
    hilt: {
      handle: r(0.09, 0.12), guardThickness: 0.02, guardHalfSpan: r(0.04, 0.06), pommelLength: 0.035,
      guardShare: 0.1, singleEdged: false, fullered: true, maxBend: 0,
    },
    metals: ALL_METALS, rollWeight: 1, legacyType: "sword",
  },
  // Arming / hand-and-a-half sword, Oakeshott XVIIIa: 1.05-1.25 m, 1.1-1.6 kg, blade
  // 0.8-0.95 m, point of balance 0.1-0.15 m from the guard.
  longsword: {
    id: "longsword", label: "Longsword", noun: "Longsword", weaponClass: "finesse", family: "blade",
    head: "blade", hands: 1.5, mix: { cut: 0.55, thrust: 0.45, blunt: 0 }, grips: TWO_HAND,
    axes: {
      length: r(1.05, 1.28), mass: r(1.1, 1.7), headLength: r(0.78, 0.96), sharpness: r(0.7, 0.92),
      curvature: fixed(0), headRadius: r(0.02, 0.027), balanceFraction: r(0.08, 0.24),
    },
    hilt: {
      handle: r(0.2, 0.27), guardThickness: 0.022, guardHalfSpan: r(0.1, 0.13), pommelLength: 0.045,
      guardShare: 0.1, singleEdged: false, fullered: true, maxBend: 0,
    },
    metals: ALL_METALS, rollWeight: 1, legacyType: "sword",
  },
  // Zweihander / montante: 1.4-1.8 m, 2-3.2 kg, blade 1.0-1.3 m, long grip + ricasso.
  greatsword: {
    id: "greatsword", label: "Greatsword", noun: "Greatsword", weaponClass: "balanced", family: "blade",
    head: "blade", hands: 2, mix: { cut: 0.65, thrust: 0.35, blunt: 0 }, grips: TWO_HAND,
    axes: {
      length: r(1.35, 1.72), mass: r(2, 3.2), headLength: r(0.95, 1.25), sharpness: r(0.6, 0.85),
      curvature: fixed(0), headRadius: r(0.025, 0.034), balanceFraction: r(0.1, 0.3),
    },
    hilt: {
      handle: r(0.3, 0.42), guardThickness: 0.03, guardHalfSpan: r(0.15, 0.22), pommelLength: 0.055,
      guardShare: 0.1, singleEdged: false, fullered: true, maxBend: 0,
    },
    metals: ALL_METALS, rollWeight: 0.6, legacyType: "sword",
  },
  // 1796 Light Cavalry Sabre: blade 0.83 m, ~1.0 kg; Persian shamshir 0.85-1.0 m, ~1 kg.
  // Curved, single-edged, blade-heavy for draw cuts.
  sabre: {
    id: "sabre", label: "Sabre", noun: "Sabre", weaponClass: "finesse", family: "blade",
    head: "blade", hands: 1, mix: { cut: 0.75, thrust: 0.25, blunt: 0 }, grips: ONE_HAND,
    axes: {
      length: r(0.86, 1.05), mass: r(0.8, 1.3), headLength: r(0.7, 0.88), sharpness: r(0.75, 0.95),
      curvature: r(0.35, 0.85), headRadius: r(0.015, 0.022), balanceFraction: r(0.12, 0.34),
    },
    hilt: {
      handle: r(0.1, 0.13), guardThickness: 0.02, guardHalfSpan: r(0.05, 0.08), pommelLength: 0.035,
      guardShare: 0.1, singleEdged: true, fullered: true, maxBend: 0.55,
    },
    metals: ALL_METALS, rollWeight: 0.8, legacyType: "sword",
  },
  // Rapier: 1.1-1.3 m, 1.0-1.4 kg, narrow 0.95-1.1 m blade (a rapier is mostly blade: the
  // length is what tells it from an arming sword at a distance), heavy swept hilt so the
  // point of balance is 0.05-0.1 m past the guard.
  rapier: {
    id: "rapier", label: "Rapier", noun: "Rapier", weaponClass: "finesse", family: "blade",
    head: "blade", hands: 1, mix: { cut: 0.15, thrust: 0.85, blunt: 0 }, grips: ONE_HAND,
    axes: {
      length: r(1.1, 1.3), mass: r(1, 1.45), headLength: r(0.95, 1.1), sharpness: r(0.8, 1),
      curvature: fixed(0), headRadius: r(0.01, 0.015), balanceFraction: r(0.03, 0.16),
    },
    hilt: {
      handle: r(0.1, 0.13), guardThickness: 0.03, guardHalfSpan: r(0.08, 0.12), pommelLength: 0.04,
      guardShare: 0.22, singleEdged: false, fullered: false, maxBend: 0,
    },
    metals: ALL_METALS, rollWeight: 0.6, legacyType: "sword",
  },
  // Infantry spear 2-2.5 m (Greek dory 2-3 m), 1.4-2.4 kg, leaf head 0.2-0.35 m.
  // Held mid-shaft: the front hand is the main grip, the rear hand ~0.5 m behind.
  spear: {
    id: "spear", label: "Spear", noun: "Spear", weaponClass: "finesse", family: "polearm",
    head: "leaf", hands: 2, mix: { cut: 0.12, thrust: 0.88, blunt: 0 }, grips: POLE_GRIPS,
    axes: {
      length: r(1.8, 2.5), mass: r(1.4, 2.4), headLength: r(0.18, 0.34), sharpness: r(0.7, 0.95),
      curvature: fixed(0), headRadius: r(0.022, 0.04), balanceFraction: r(0.1, 0.34),
    },
    haft: { tailFraction: 0.4, shaftRadius: r(0.014, 0.018), haftShare: r(0.45, 0.8) },
    metals: ALL_METALS, rollWeight: 1, legacyType: "staff",
  },
  // Swiss halberd: 1.8-2.4 m, 2.5-3.5 kg; axe blade + top spike + back fluke (0.35-0.55 m).
  halberd: {
    id: "halberd", label: "Halberd", noun: "Halberd", weaponClass: "balanced", family: "polearm",
    head: "halberd", hands: 2, mix: { cut: 0.5, thrust: 0.3, blunt: 0.2 }, grips: POLE_GRIPS,
    axes: {
      length: r(1.8, 2.4), mass: r(2.4, 3.4), headLength: r(0.35, 0.55), sharpness: r(0.6, 0.85),
      curvature: r(0, 0.3), headRadius: r(0.11, 0.18), balanceFraction: r(0.38, 0.66),
    },
    haft: { tailFraction: 0.15, shaftRadius: r(0.015, 0.019), haftShare: r(0.3, 0.6) },
    metals: ALL_METALS, rollWeight: 0.6, legacyType: "axe",
  },
  // Viking hand axe: 0.6-0.9 m haft, 0.8-1.6 kg (head 0.4-0.9 kg). Bearded bits are drawn and
  // collided at 0.16-0.27 m along the edge, 0.13-0.2 m deep: the broad (Mammen / "skeggox")
  // end of the type and beyond it, a stylised game proportion (bit ~1/3 of the haft). At the
  // historical 0.1-0.2 m the bit is a 12 x 7 px blob at 7 m and reads as a hammer (lane W2).
  axe: {
    id: "axe", label: "Axe", noun: "Axe", weaponClass: "heavy", family: "hafted",
    head: "axe", hands: 1, mix: { cut: 0.75, thrust: 0, blunt: 0.25 }, grips: ONE_HAND,
    axes: {
      length: r(0.55, 0.85), mass: r(0.9, 1.7), headLength: r(0.16, 0.27), sharpness: r(0.55, 0.85),
      curvature: r(0.1, 0.6), headRadius: r(0.13, 0.2), balanceFraction: r(0.5, 0.84),
    },
    haft: { tailFraction: 0.1, shaftRadius: r(0.014, 0.017), haftShare: r(0.15, 0.45) },
    metals: ALL_METALS, rollWeight: 1, legacyType: "axe",
  },
  // Dane axe: 1.2-1.7 m haft, 1.5-3 kg, crescent bit 0.24-0.36 m along the edge, 0.18-0.26 m
  // deep (the broad end of the type, stylised: the bit must dwarf the hand axe's, lane W2).
  greataxe: {
    id: "greataxe", label: "Greataxe", noun: "Greataxe", weaponClass: "heavy", family: "hafted",
    head: "axe", hands: 2, mix: { cut: 0.8, thrust: 0, blunt: 0.2 }, grips: POLE_GRIPS,
    axes: {
      length: r(1.2, 1.65), mass: r(1.8, 3), headLength: r(0.24, 0.36), sharpness: r(0.55, 0.8),
      curvature: r(0.2, 0.75), headRadius: r(0.18, 0.26), balanceFraction: r(0.5, 0.82),
    },
    haft: { tailFraction: 0.12, shaftRadius: r(0.016, 0.02), haftShare: r(0.2, 0.5) },
    metals: ALL_METALS, rollWeight: 0.7, legacyType: "axe",
  },
  // Gothic flanged mace: ~0.6 m, 1.2-1.6 kg (range 0.5-0.8 m, 1-2 kg), head 0.08-0.15 m.
  mace: {
    id: "mace", label: "Mace", noun: "Mace", weaponClass: "heavy", family: "hafted",
    head: "flanged", hands: 1, mix: { cut: 0.1, thrust: 0, blunt: 0.9 }, grips: ONE_HAND,
    axes: {
      length: r(0.5, 0.8), mass: r(1, 2), headLength: r(0.08, 0.15), sharpness: r(0.05, 0.3),
      curvature: fixed(0), headRadius: r(0.035, 0.065), balanceFraction: r(0.55, 0.86),
    },
    haft: { tailFraction: 0.12, shaftRadius: r(0.013, 0.016), haftShare: r(0.15, 0.45) },
    metals: BLUNT_METALS, rollWeight: 0.9, legacyType: "mace",
  },
  // Military flail: handle 0.5-0.6 m, chain 0.15-0.3 m, spiked ball 0.5-1 kg.
  flail: {
    id: "flail", label: "Flail", noun: "Flail", weaponClass: "heavy", family: "flail",
    head: "ball", hands: 1, mix: { cut: 0, thrust: 0.15, blunt: 0.85 }, grips: ONE_HAND,
    axes: {
      length: r(0.75, 1.15), mass: r(1.2, 2.2), headLength: r(0.2, 0.4), sharpness: r(0.05, 0.25),
      curvature: fixed(0), headRadius: r(0.035, 0.06), balanceFraction: r(0.5, 0.86),
    },
    haft: { tailFraction: 0.1, shaftRadius: r(0.014, 0.017), haftShare: r(0.15, 0.4) },
    metals: BLUNT_METALS, rollWeight: 0.5, legacyType: "mace",
  },
  // Horseman's hammer / bec de corbin (short): 0.6-1.0 m, 1-2 kg, a SMALL hard face
  // (radius 18-30 mm) backed by a spike.
  warhammer: {
    id: "warhammer", label: "War hammer", noun: "Warhammer", weaponClass: "heavy", family: "hafted",
    head: "hammer", hands: 1, mix: { cut: 0, thrust: 0.35, blunt: 0.65 }, grips: ONE_HAND,
    axes: {
      length: r(0.6, 1), mass: r(1, 2), headLength: r(0.06, 0.11), sharpness: r(0.1, 0.4),
      curvature: r(0, 0.4), headRadius: r(0.018, 0.03), balanceFraction: r(0.45, 0.8),
    },
    haft: { tailFraction: 0.12, shaftRadius: r(0.013, 0.016), haftShare: r(0.15, 0.45) },
    metals: BLUNT_METALS, rollWeight: 0.7, legacyType: "mace",
  },
  // Maul / lead sledge: 0.9-1.3 m, 3-5 kg, a block head.
  maul: {
    id: "maul", label: "Maul", noun: "Maul", weaponClass: "heavy", family: "hafted",
    head: "block", hands: 2, mix: { cut: 0, thrust: 0, blunt: 1 }, grips: POLE_GRIPS,
    axes: {
      length: r(0.9, 1.3), mass: r(3, 5), headLength: r(0.1, 0.16), sharpness: r(0, 0.08),
      curvature: fixed(0), headRadius: r(0.045, 0.07), balanceFraction: r(0.6, 0.9),
    },
    haft: { tailFraction: 0.12, shaftRadius: r(0.017, 0.021), haftShare: r(0.15, 0.4) },
    metals: BLUNT_METALS, rollWeight: 0.5, legacyType: "mace",
  },
  // Quarterstaff: 1.8-2.7 m historically (shortened here to 1.6-2.1 m for the arena),
  // 1.2-2.2 kg hardwood, iron-shod ends. Held near the middle.
  staff: {
    id: "staff", label: "Staff", noun: "Staff", weaponClass: "balanced", family: "staff",
    head: "ferrule", hands: 2, mix: { cut: 0, thrust: 0.1, blunt: 0.9 }, grips: POLE_GRIPS,
    axes: {
      length: r(1.6, 2.1), mass: r(1.2, 2.2), headLength: fixed(0), sharpness: fixed(0),
      curvature: fixed(0), headRadius: r(0.014, 0.02), balanceFraction: r(0.04, 0.2),
    },
    haft: { tailFraction: 0.42, shaftRadius: r(0.014, 0.02), haftShare: r(0.8, 0.9) },
    metals: BLUNT_METALS, rollWeight: 0.7, legacyType: "staff",
  },
  // War scythe: 1.5-2.0 m snath, 2-3.2 kg, blade 0.45-0.75 m along its curve.
  scythe: {
    id: "scythe", label: "Scythe", noun: "Scythe", weaponClass: "balanced", family: "polearm",
    head: "scythe", hands: 2, mix: { cut: 0.85, thrust: 0.15, blunt: 0 }, grips: POLE_GRIPS,
    axes: {
      length: r(1.5, 2), mass: r(2, 3.2), headLength: r(0.45, 0.75), sharpness: r(0.65, 0.9),
      curvature: r(0.6, 1), headRadius: r(0.025, 0.045), balanceFraction: r(0.36, 0.72),
    },
    haft: { tailFraction: 0.15, shaftRadius: r(0.015, 0.019), haftShare: r(0.3, 0.6) },
    metals: ALL_METALS, rollWeight: 0.4, legacyType: "scythe",
  },
  // English war bow 1.8-2.0 m, 0.7-1 kg, 80-150 lbf (356-667 N) drawn 0.71-0.76 m;
  // Asiatic composite recurves 1.2-1.4 m. The grip is the riser at the middle.
  bow: {
    id: "bow", label: "Bow", noun: "Bow", weaponClass: "ranged", family: "bow",
    head: "limbs", hands: 2, mix: { cut: 0, thrust: 1, blunt: 0 }, grips: TWO_HAND,
    axes: {
      length: r(1.2, 1.9), mass: r(0.6, 1.2), headLength: fixed(0), sharpness: r(0.6, 0.95),
      curvature: r(0.1, 0.7), headRadius: r(0.006, 0.018), balanceFraction: r(-0.03, 0.03),
    },
    haft: { tailFraction: 0.5, shaftRadius: r(0.012, 0.016), haftShare: r(0.6, 0.8) },
    ranged: { drawLength: r(0.6, 0.75), drawForce: r(200, 650), arrowMass: r(0.04, 0.1) },
    metals: ["steel", "iron", "bronze", "silver", "gold"], rollWeight: 0.8, legacyType: "bow",
  },
};

/** Every archetype id, in menu order (light to heavy, then reach, then ranged). */
export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "dagger", "shortsword", "sabre", "rapier", "longsword", "greatsword", "spear", "halberd",
  "scythe", "staff", "axe", "greataxe", "mace", "flail", "warhammer", "maul", "bow",
];

/** Archetype ids grouped by weapon class. */
export function archetypesOfClass(weaponClass: WeaponClass): ArchetypeId[] {
  return ARCHETYPE_IDS.filter((id) => ARCHETYPES[id].weaponClass === weaponClass);
}

/** The archetype a character class carries by default (mirrors Weapon.ts CLASS_SPECS). */
export const CLASS_ARCHETYPE: Record<ClassName, ArchetypeId> = {
  Barbarian: "greataxe", Warrior: "longsword", Rogue: "dagger", Assassin: "dagger",
  Mage: "staff", Necromancer: "scythe", Archer: "bow", Priest: "mace",
};

/** True when `v` is a known archetype id (menu values, saved profiles). */
export function isArchetypeId(v: unknown): v is ArchetypeId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ARCHETYPES, v);
}

/** The extreme of an axis over the whole roster (used to normalise legacy 1..10 scales). */
export function rosterAxisSpan(axis: keyof ArchetypeAxes): AxisRange {
  let min = Infinity, max = -Infinity;
  for (const id of ARCHETYPE_IDS) {
    min = Math.min(min, ARCHETYPES[id].axes[axis].min);
    max = Math.max(max, ARCHETYPES[id].axes[axis].max);
  }
  return { min, max };
}
