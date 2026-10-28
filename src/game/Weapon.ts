import type { ClassName } from "./Stats.ts";

export type WeaponType = "axe" | "sword" | "dagger" | "staff" | "scythe" | "bow" | "mace";

export interface Grip {
  x: number; y: number; z: number;   // position offset from the fighter's hand
  rx: number; ry: number; rz: number; // Euler rotation (radians)
  scale: number;                      // length multiplier for the mesh
}

export interface Weapon {
  name: string;
  type: WeaponType;
  weight: number;    // 1..10: heavier = slower swing, more knockback
  balance: number;   // 0..1: 0 hilt-heavy, 1 tip-heavy (more reach/damage)
  sharpness: number; // 0..1: sharper = more damage
  damage: number;
  cooldown: number;
  reach: number;
  knockback: number;
  color: string;
  grip: Grip;
}

interface BaseSpec { name: string; type: WeaponType; weight: number; balance: number; sharpness: number; color: string }

const CLASS_SPECS: Record<ClassName, BaseSpec> = {
  Barbarian:  { name: "Greataxe",     type: "axe",    weight: 9, balance: 0.70, sharpness: 0.55, color: "#ef7455" },
  Warrior:    { name: "Longsword",    type: "sword",  weight: 6, balance: 0.50, sharpness: 0.70, color: "#dfaa55" },
  Rogue:      { name: "Twin Daggers", type: "dagger", weight: 2, balance: 0.30, sharpness: 0.90, color: "#82b970" },
  Assassin:   { name: "Hidden Blade", type: "dagger", weight: 1, balance: 0.20, sharpness: 1.00, color: "#a9ce7c" },
  Mage:       { name: "Warped Staff", type: "staff",  weight: 4, balance: 0.50, sharpness: 0.30, color: "#9b72cf" },
  Necromancer:{ name: "Bone Scythe",  type: "scythe", weight: 7, balance: 0.80, sharpness: 0.45, color: "#4f8490" },
  Archer:     { name: "Longbow",      type: "bow",    weight: 3, balance: 0.40, sharpness: 0.40, color: "#a9ce7c" },
  Priest:     { name: "War Mace",     type: "mace",   weight: 6, balance: 0.60, sharpness: 0.50, color: "#fff3cf" },
};

// Base combat numbers per weapon type; physical properties modulate them.
const TYPE_BASE: Record<WeaponType, { damage: number; cooldown: number; reach: number; knockback: number }> = {
  axe:    { damage: 13, cooldown: 1.15, reach: 1.9, knockback: 1.3 },
  sword:  { damage: 10, cooldown: 0.85, reach: 1.7, knockback: 1.0 },
  dagger: { damage: 7,  cooldown: 0.45, reach: 1.1, knockback: 0.7 },
  staff:  { damage: 9,  cooldown: 0.95, reach: 2.1, knockback: 0.9 },
  scythe: { damage: 11, cooldown: 1.05, reach: 1.9, knockback: 1.2 },
  bow:    { damage: 8,  cooldown: 0.75, reach: 2.8, knockback: 0.8 },
  mace:   { damage: 11, cooldown: 0.95, reach: 1.5, knockback: 1.1 },
};

// Weapon physical properties derive the combat stats and the 3D grip.
export function buildWeapon(type: WeaponType, weight: number, balance: number, sharpness: number, name: string, color: string): Weapon {
  const base = TYPE_BASE[type];
  const w = Math.max(1, Math.min(10, weight));
  const b = Math.max(0, Math.min(1, balance));
  const s = Math.max(0, Math.min(1, sharpness));
  return {
    name, type, weight: w, balance: b, sharpness: s, color,
    damage: Math.round(base.damage * (0.72 + s * 0.55) * (0.85 + w * 0.045)),
    cooldown: base.cooldown * (0.6 + w * 0.07),
    reach: base.reach * (0.82 + b * 0.4),
    knockback: base.knockback * (0.5 + w * 0.09),
    grip: gripFor(type, base.reach * (0.82 + b * 0.4)),
  };
}

// Grip transform varies by weapon type; balance shifts the hand toward the hilt
// so a tip-heavy weapon extends further forward from the same hand position.
function gripFor(type: WeaponType, reach: number): Grip {
  const z = reach * 0.45;
  switch (type) {
    case "axe":   return { x: 0, y: 0.35, z, rx: -0.5, ry: 0, rz: 0,    scale: reach };
    case "sword": return { x: 0, y: 0.05, z, rx: 0,   ry: 0, rz: 0,    scale: reach };
    case "dagger":return { x: 0, y: -0.1, z: reach * 0.3, rx: 0.35, ry: 0, rz: 0, scale: reach };
    case "staff": return { x: 0, y: 0.55, z: reach * 0.15, rx: 0.12, ry: 0, rz: 0.12, scale: reach };
    case "scythe":return { x: 0, y: 0.12, z, rx: 0.2, ry: 0.6, rz: 0,  scale: reach };
    case "bow":   return { x: 0, y: 0.02, z: reach * 0.3, rx: 0, ry: 0, rz: 1.57, scale: reach };
    case "mace":  return { x: 0, y: 0.32, z, rx: -0.4, ry: 0, rz: 0,   scale: reach };
  }
}

export function weaponForClass(className: ClassName): Weapon {
  const spec = CLASS_SPECS[className];
  return buildWeapon(spec.type, spec.weight, spec.balance, spec.sharpness, spec.name, spec.color);
}

export function buildWeaponByName(typeName: string): Weapon {
  const t = TYPE_BASE[typeName as WeaponType];
  if (!t) return weaponForClass("Warrior"); // fallback
  return buildWeapon(typeName as WeaponType, 5, 0.5, 0.6, typeName, "#dfaa55");
}
