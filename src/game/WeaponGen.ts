// Procedural weapon generator. A weapon is a parameter set (shaft, blade, curve,
// weight, material) from which both the combat numbers and the 3D part list are
// derived. Materials carry the colour ramp, so "gray for steel, dark gray for
// iron, bronze, gold, silver" is data, not hard-coded meshes.

import type { ClassName } from "./Stats.ts";

export type WeaponType = "axe" | "sword" | "dagger" | "staff" | "scythe" | "bow" | "mace";
export type MetalName = "steel" | "iron" | "bronze" | "gold" | "silver" | "obsidian";

export interface Metal {
  name: MetalName;
  blade: string;    // primary blade/head colour
  highlight: string; // polished edge
  dark: string;     // shadowed side / fuller
  weightBias: number; // multiplies the weapon's weight
}

export const METALS: Record<MetalName, Metal> = {
  steel:    { name: "steel",    blade: "#e3eaee", highlight: "#ffffff", dark: "#7d8b93", weightBias: 1.0 },
  iron:     { name: "iron",     blade: "#9aa3a8", highlight: "#c3cbcf", dark: "#4e565b", weightBias: 1.15 },
  bronze:   { name: "bronze",   blade: "#c98a4b", highlight: "#e8b878", dark: "#7d5327", weightBias: 1.05 },
  gold:     { name: "gold",     blade: "#f2c46b", highlight: "#fff3cf", dark: "#a37a24", weightBias: 1.25 },
  silver:   { name: "silver",   blade: "#dfe6ef", highlight: "#ffffff", dark: "#9aa8b8", weightBias: 0.95 },
  obsidian: { name: "obsidian", blade: "#3b3540", highlight: "#6b6273", dark: "#1b181f", weightBias: 0.9 },
};

export type PartKind = "shaft" | "blade" | "guard" | "pommel" | "head" | "curve" | "limb" | "string";

/** One piece of the generated mesh, positioned relative to the grip. */
export interface WeaponPart {
  kind: PartKind;
  /** Box/cylinder dimensions in metres (x = width, y = length along the weapon, z = thickness). */
  w: number;
  h: number;
  d: number;
  /** Offset along the weapon's own axis, measured from the grip. */
  y: number;
  /** Lateral bend for curved blades (offset along local z). */
  bend: number;
  /** Lateral offset along local x — a bow's arc, which must face the viewer. */
  sway?: number;
  /** Rotation about the local z axis, in radians (a bow's limbs arc outward). */
  tilt?: number;
  /** Radial placement around the weapon axis (mace flanges), in radians. */
  radial?: number;
  color: string;
  /** "box" for blades and plates, "cyl" for shafts and grips, "cone" for tips. */
  shape: "box" | "cyl" | "cone";
}

export interface WeaponParams {
  type: WeaponType;
  /** 1..10 */
  weight: number;
  /** 0..1, 0 = hilt-heavy, 1 = tip-heavy */
  balance: number;
  /** 0..1 */
  sharpness: number;
  /** Overall length scale. */
  length: number;
  /** 0..1 lateral curvature of the blade. */
  curve: number;
  /** Metal of the blade/head. */
  metal: MetalName;
  /** Metal of the guard and pommel. */
  fitting: MetalName;
  /** Handle wrap colour. */
  grip: string;
}

export interface GeneratedWeapon {
  params: WeaponParams;
  name: string;
  parts: WeaponPart[];
  damage: number;
  cooldown: number;
  reach: number;
  knockback: number;
  weight: number;
}

const TYPE_BASE: Record<WeaponType, { damage: number; cooldown: number; reach: number; knockback: number; shaft: number; blade: number; bladeW: number }> = {
  axe:    { damage: 13, cooldown: 1.15, reach: 1.9, knockback: 1.3, shaft: 0.95, blade: 0.45, bladeW: 0.34 },
  sword:  { damage: 10, cooldown: 0.85, reach: 1.7, knockback: 1.0, shaft: 0.24, blade: 0.95, bladeW: 0.085 },
  dagger: { damage: 7,  cooldown: 0.45, reach: 1.1, knockback: 0.7, shaft: 0.16, blade: 0.40, bladeW: 0.055 },
  staff:  { damage: 9,  cooldown: 0.95, reach: 2.1, knockback: 0.9, shaft: 1.55, blade: 0.0,  bladeW: 0.0 },
  scythe: { damage: 11, cooldown: 1.05, reach: 1.9, knockback: 1.2, shaft: 1.35, blade: 0.62, bladeW: 0.12 },
  bow:    { damage: 8,  cooldown: 0.75, reach: 2.8, knockback: 0.8, shaft: 0.0,  blade: 0.0,  bladeW: 0.0 },
  mace:   { damage: 11, cooldown: 0.95, reach: 1.5, knockback: 1.1, shaft: 0.85, blade: 0.0,  bladeW: 0.0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Build the part list and the combat numbers from the parameters. */
export function generateWeapon(params: WeaponParams): GeneratedWeapon {
  const base = TYPE_BASE[params.type];
  const metal = METALS[params.metal];
  const fitting = METALS[params.fitting];
  const w = clamp(params.weight * metal.weightBias, 1, 10);
  const b = clamp(params.balance, 0, 1);
  const s = clamp(params.sharpness, 0, 1);
  const L = clamp(params.length, 0.6, 1.6);
  const curve = clamp(params.curve, 0, 1);

  const parts: WeaponPart[] = [];
  const shaftLen = base.shaft * L;
  const bladeLen = base.blade * L;

  if (shaftLen > 0) {
    parts.push({ kind: "shaft", w: 0.045, h: shaftLen, d: 0.045, y: shaftLen / 2, bend: 0, color: params.grip, shape: "cyl" });
  }
  if (params.type === "bow") {
    // Constructed geometrically so it actually reads as a bow: the string is a
    // straight line at x = 0 between two tips, the grip bulges out to gripX, and
    // each limb is a rotated bar running from the grip to its tip. Earlier attempts
    // swayed the limbs the wrong way, so the tips flared past the grip and the whole
    // thing read as a straight stick.
    const half = 0.45 * L;                                  // grip to tip, vertically
    const gripX = 0.28;                                     // how far the grip bulges
    const limbLen = Math.hypot(gripX, half);                // grip -> tip
    const limbTilt = Math.atan2(gripX, half);               // angle of that bar
    const cx = gripX / 2, cy = half / 2;                    // limb centre
    parts.push({ kind: "limb", w: 0.085, h: limbLen, d: 0.1, y: cy, bend: 0, sway: cx, tilt: limbTilt, color: metal.blade, shape: "box" });
    parts.push({ kind: "limb", w: 0.085, h: limbLen, d: 0.1, y: -cy, bend: 0, sway: cx, tilt: -limbTilt, color: metal.blade, shape: "box" });
    parts.push({ kind: "limb", w: 0.03, h: limbLen * 0.8, d: 0.03, y: cy, bend: 0, sway: cx, tilt: limbTilt, color: metal.highlight, shape: "box" });
    parts.push({ kind: "limb", w: 0.03, h: limbLen * 0.8, d: 0.03, y: -cy, bend: 0, sway: cx, tilt: -limbTilt, color: metal.highlight, shape: "box" });
    parts.push({ kind: "head", w: 0.1, h: 0.36, d: 0.13, y: 0, bend: 0, sway: gripX, color: metal.blade, shape: "box" }); // riser at the grip
    parts.push({ kind: "string", w: 0.016, h: half * 2, d: 0.016, y: 0, bend: 0, sway: 0, color: "#f6efd8", shape: "cyl" }); // tip to tip
  }
  if (params.type === "staff") {
    parts.push({ kind: "head", w: 0.14, h: 0.2, d: 0.14, y: shaftLen + 0.1, bend: 0, color: metal.blade, shape: "cone" });
  }
  if (params.type === "mace") {
    parts.push({ kind: "head", w: 0.26, h: 0.3, d: 0.26, y: shaftLen + 0.14, bend: 0, color: metal.blade, shape: "box" });
    for (let i = 0; i < 6; i++) {
      parts.push({
        kind: "head", w: 0.06, h: 0.16, d: 0.06, y: shaftLen + 0.14, bend: 0,
        radial: (i / 6) * Math.PI * 2, color: metal.highlight, shape: "cone",
      });
    }
  }
  if (params.type === "axe") {
    parts.push({ kind: "head", w: 0.42, h: 0.34, d: 0.06, y: shaftLen, bend: curve * 0.1, color: metal.blade, shape: "box" });
    parts.push({ kind: "head", w: 0.12, h: 0.2, d: 0.05, y: shaftLen, bend: 0, color: metal.highlight, shape: "cone" });
  }
  if (params.type === "scythe") {
    parts.push({ kind: "blade", w: 0.1, h: bladeLen, d: 0.05, y: shaftLen, bend: curve * 0.55 + 0.2, color: metal.blade, shape: "box" });
  }
  if (params.type === "sword" || params.type === "dagger") {
    // Guard, grip and pommel are the same for both, then the blade itself.
    parts.push({ kind: "guard", w: params.type === "sword" ? 0.3 : 0.16, h: 0.04, d: 0.06, y: 0.02, bend: 0, color: fitting.blade, shape: "box" });
    parts.push({ kind: "pommel", w: 0.05, h: 0.05, d: 0.05, y: -0.06, bend: 0, color: fitting.blade, shape: "box" });
    parts.push({ kind: "blade", w: base.bladeW * L, h: bladeLen, d: 0.02, y: shaftLen + bladeLen / 2, bend: 0, color: metal.blade, shape: "box" });
    // Fuller groove down the middle of the blade.
    parts.push({ kind: "curve", w: base.bladeW * 0.22, h: bladeLen * 0.85, d: 0.024, y: shaftLen + bladeLen / 2, bend: 0, color: metal.dark, shape: "box" });
    // Tip: a cone that leans with the curve parameter.
    parts.push({ kind: "blade", w: base.bladeW * L * 0.9, h: 0.14 * L, d: 0.02, y: shaftLen + bladeLen + 0.06 * L, bend: curve * 0.12, color: metal.highlight, shape: "cone" });
  }

  const damage = Math.round(base.damage * (0.72 + s * 0.55) * (0.85 + w * 0.045));
  const cooldown = base.cooldown * (0.6 + w * 0.07);
  const reach = base.reach * (0.82 + b * 0.4) * (0.85 + L * 0.15);
  const knockback = base.knockback * (0.5 + w * 0.09);

  return {
    params,
    name: weaponName(params),
    parts,
    damage, cooldown, reach, knockback, weight: w,
  };
}

const TYPE_NOUN: Record<WeaponType, string> = {
  axe: "Axe", sword: "Sword", dagger: "Dagger", staff: "Staff", scythe: "Scythe", bow: "Bow", mace: "Mace",
};
const METAL_ADJ: Record<MetalName, string> = {
  steel: "Steel", iron: "Iron", bronze: "Bronze", gold: "Gilded", silver: "Silver", obsidian: "Obsidian",
};

/** Name from the parameters, so two generated weapons read differently. */
export function weaponName(p: WeaponParams): string {
  const adj = METAL_ADJ[p.metal];
  const size = p.length > 1.15 ? "Great " : p.length < 0.8 ? "Short " : "";
  const curved = p.curve > 0.55 && (p.type === "sword" || p.type === "scythe") ? "Curved " : "";
  return `${adj} ${size}${curved}${TYPE_NOUN[p.type]}`;
}

/** The class loadout expressed as generator parameters. */
export const CLASS_WEAPON_PARAMS: Record<ClassName, WeaponParams> = {
  Barbarian:   { type: "axe",    weight: 9, balance: 0.70, sharpness: 0.55, length: 1.25, curve: 0.2, metal: "iron",     fitting: "iron",     grip: "#4a2f1b" },
  Warrior:     { type: "sword",  weight: 6, balance: 0.50, sharpness: 0.70, length: 1.10, curve: 0.15, metal: "steel",   fitting: "bronze",   grip: "#5a3b22" },
  Rogue:       { type: "dagger", weight: 2, balance: 0.30, sharpness: 0.90, length: 0.95, curve: 0.35, metal: "steel",   fitting: "silver",   grip: "#2f3a2a" },
  Assassin:    { type: "dagger", weight: 1, balance: 0.20, sharpness: 1.00, length: 0.80, curve: 0.60, metal: "obsidian", fitting: "silver",  grip: "#1b181f" },
  Mage:        { type: "staff",  weight: 4, balance: 0.50, sharpness: 0.30, length: 1.35, curve: 0.0,  metal: "silver",   fitting: "gold",    grip: "#3a2f4a" },
  Necromancer: { type: "scythe", weight: 7, balance: 0.80, sharpness: 0.45, length: 1.30, curve: 0.85, metal: "iron",     fitting: "obsidian", grip: "#2a2f26" },
  Archer:      { type: "bow",    weight: 3, balance: 0.40, sharpness: 0.40, length: 1.15, curve: 0.5,  metal: "bronze",   fitting: "bronze",   grip: "#5a3b22" },
  Priest:      { type: "mace",   weight: 6, balance: 0.60, sharpness: 0.50, length: 1.05, curve: 0.0,  metal: "gold",     fitting: "gold",     grip: "#4a3a20" },
};

export function generateClassWeapon(className: ClassName): GeneratedWeapon {
  return generateWeapon(CLASS_WEAPON_PARAMS[className]);
}
