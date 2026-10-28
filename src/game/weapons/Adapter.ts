// Adapters (W06): keep today's consumers working while fighters move to WeaponSpec.
//   toGeneratedWeapon(spec) -> WeaponGen.GeneratedWeapon (a WeaponPart list), so WeaponMesh,
//                              EffectShader and FxDirector (bladeSpan) keep working unchanged.
//   toLegacyWeapon(spec)    -> Weapon.Weapon (name/type/weight/reach/cooldown/knockback/grip),
//                              the struct Fighter, the AI and the engine read today.
//
// Part frame: the same as the contract (+y along the weapon from the grip, +z = edge side), so
// a blade box is THIN along x and WIDE along z. Exception: the bow keeps the legacy layout
// (limbs swayed along x) because WeaponPart can only tilt about z.

import type { WeaponSpec } from "../../combat/contracts.ts";
import { clamp, clamp01, invLerp } from "../../core/MathCore.ts";
import { buildWeapon, type Weapon } from "../Weapon.ts";
import { type GeneratedWeapon, type MetalName, METALS, type WeaponPart, type WeaponType } from "../WeaponGen.ts";
import { ARCHETYPES, rosterAxisSpan } from "./Archetypes.ts";
import { axePollRadius, halberdBlade, hammerSpike, MAUL_BLOCK_RATIO } from "./Features.ts";
import { bladeHalfWidthAt, bladePointAt, WOODS } from "./Form.ts";
import { axesOfSpec, weaponForm } from "./Generate.ts";
import { combatProfile } from "./Profile.ts";

/** Body centre -> shoulder joint, m: legacy reach is measured from the body centre. */
export const SHOULDER_OFFSET = 0.18;
/**
 * Legacy reach cap for ranged weapons, m: the legacy loop treats reach as the strike distance,
 * so a 15 m bow reach would keep an archer from ever closing in. 2.8 m = the legacy bow reach.
 */
export const LEGACY_RANGED_REACH = 2.8;
/** Legacy `damage` is a display number: 10 = a per-hit mean multiplier of 1.0. */
export const LEGACY_DAMAGE_PER_UNIT = 10;
/** Boxes per curved blade in the legacy part list (WeaponPart cannot rotate about x). */
export const LEGACY_CURVE_SEGMENTS = 4;

/** Closest legacy weapon type. */
export function legacyTypeOf(spec: WeaponSpec): WeaponType {
  return ARCHETYPES[spec.archetype].legacyType;
}

/**
 * Legacy 1..10 weight from the mass, on a LOG scale across the roster's mass span (the
 * lightest dagger = 1, the heaviest maul = 10): w = 1 + 9 ln(M / Mmin) / ln(Mmax / Mmin).
 */
export function legacyWeight(mass: number): number {
  const span = rosterAxisSpan("mass");
  return clamp(1 + (9 * Math.log(mass / span.min)) / Math.log(span.max / span.min), 1, 10);
}

/** Legacy 0..1 balance (0 hilt-heavy, 1 tip-heavy) from the balance fraction over the roster span. */
export function legacyBalance(spec: WeaponSpec): number {
  const span = rosterAxisSpan("balanceFraction");
  return clamp01(invLerp(span.min, span.max, axesOfSpec(spec).balanceFraction));
}

const metalOf = (name: string | undefined): MetalName =>
  name && Object.prototype.hasOwnProperty.call(METALS, name) ? name as MetalName : "steel";

/** The legacy part list in the contract frame (see header). */
export function legacyParts(spec: WeaponSpec): WeaponPart[] {
  const a = ARCHETYPES[spec.archetype];
  const form = weaponForm(spec);
  const axes = axesOfSpec(spec);
  const metal = METALS[metalOf(spec.metal)];
  const fitting = METALS[metalOf(spec.fitting)];
  const wood = WOODS[form.details.wood];
  const wrap = form.details.wrap;
  const sr = form.details.shaftRadius;
  const H = spec.headLength, R = axes.headRadius;
  const parts: WeaponPart[] = [];
  const add = (p: Omit<WeaponPart, "bend"> & { bend?: number }) => parts.push({ bend: 0, ...p });
  const shaft = (y0: number, y1: number, color = wood) =>
    add({ kind: "shaft", w: 2 * sr, h: y1 - y0, d: 2 * sr, y: (y0 + y1) / 2, color, shape: "cyl" });

  if (a.family === "blade") {
    add({ kind: "shaft", w: 0.032, h: form.handleLength, d: 0.032, y: form.shaftBottomY + form.handleLength / 2, color: wrap, shape: "cyl" });
    add({ kind: "guard", w: 0.03, h: form.guardThickness, d: 2 * form.details.guardHalfSpan, y: form.guardY + form.guardThickness / 2, color: fitting.blade, shape: "box" });
    add({ kind: "pommel", w: 2 * form.pommelRadius, h: 2 * form.pommelRadius, d: 2 * form.pommelRadius, y: form.pommelY, color: fitting.blade, shape: "box" });
    const n = Math.abs(form.bladeTurn) > 1e-4 ? LEGACY_CURVE_SEGMENTS : 1;
    const body = form.bladeLength * 0.88;
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s0 = (body * i) / n, s1 = (body * (i + 1)) / n;
      bladePointAt(form, (s0 + s1) / 2, c);
      const w = 2 * bladeHalfWidthAt(form, (s0 + s1) / 2);
      add({ kind: "blade", w: form.bladeThickness, h: s1 - s0, d: w, y: c[1], bend: c[2], color: metal.blade, shape: "box" });
    }
    if (form.fullered) add({ kind: "curve", w: form.bladeThickness * 1.15, h: body * 0.7, d: R * 0.4, y: form.bladeBaseY + body * 0.4, color: metal.dark, shape: "box" });
    bladePointAt(form, form.bladeLength * 0.94, c);
    add({ kind: "blade", w: 2 * bladeHalfWidthAt(form, body), h: form.bladeLength * 0.12, d: form.bladeThickness, y: c[1], bend: c[2], color: metal.highlight, shape: "cone" });
    return parts;
  }
  if (a.family === "bow") {
    // Legacy layout (see WeaponGen bow): limbs arc out along x and face the viewer.
    const half = spec.length / 2, gripX = form.braceHeight;
    const limbLen = Math.hypot(gripX, half), tilt = Math.atan2(gripX, half);
    for (const sign of [1, -1]) {
      add({ kind: "limb", w: 0.04, h: limbLen, d: 0.05, y: (sign * half) / 2, sway: gripX / 2, tilt: sign * tilt, color: wood, shape: "box" });
    }
    add({ kind: "head", w: 0.06, h: 0.2, d: 0.07, y: 0, sway: gripX, color: wrap, shape: "box" });
    add({ kind: "string", w: 0.008, h: spec.length, d: 0.008, y: 0, sway: 0, color: "#f6efd8", shape: "cyl" });
    return parts;
  }
  if (a.family === "staff") {
    shaft(-form.tail, form.forward);
    for (const y of [form.forward - 0.04, -form.tail + 0.04]) {
      add({ kind: "head", w: 2.5 * sr, h: 0.08, d: 2.5 * sr, y, color: metal.blade, shape: "cyl" });
    }
    return parts;
  }
  if (a.family === "flail") {
    shaft(-form.tail, form.shaftTopY);
    const ballY = form.headCentreY;
    add({ kind: "shaft", w: 0.012, h: Math.max(0.01, ballY - R - form.shaftTopY), d: 0.012, y: (form.shaftTopY + ballY - R) / 2, color: metal.dark, shape: "cyl" });
    add({ kind: "head", w: 2 * R, h: 2 * R, d: 2 * R, y: ballY, color: metal.blade, shape: "box" });
    return parts;
  }
  shaft(-form.tail, a.head === "leaf" ? form.forward - H + 0.05 : form.shaftTopY);
  const hy = form.headCentreY;
  switch (a.head) {
    case "leaf":
      add({ kind: "head", w: 2 * R, h: H, d: 2 * R, y: form.forward - H / 2, color: metal.blade, shape: "cone" });
      break;
    case "halberd": {
      const { height: bladeH, centreY: cy } = halberdBlade(form.forward, H);
      add({ kind: "head", w: 0.012, h: bladeH, d: R, y: cy, bend: R / 2, color: metal.blade, shape: "box" });
      add({ kind: "head", w: 0.03, h: 0.45 * H, d: 0.03, y: form.forward - 0.225 * H, color: metal.highlight, shape: "cone" });
      add({ kind: "head", w: 0.012, h: 0.3 * bladeH, d: 0.6 * R, y: cy, bend: -0.3 * R, color: metal.dark, shape: "box" });
      break;
    }
    case "scythe": {
      const c: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < LEGACY_CURVE_SEGMENTS; i++) {
        const s = (form.bladeLength * (i + 0.5)) / LEGACY_CURVE_SEGMENTS;
        bladePointAt(form, s, c);
        add({ kind: "blade", w: form.bladeThickness, h: form.bladeLength / LEGACY_CURVE_SEGMENTS, d: 2 * bladeHalfWidthAt(form, s), y: c[1], bend: c[2], color: metal.blade, shape: "box" });
      }
      break;
    }
    case "axe": {
      add({ kind: "head", w: 0.014, h: H, d: R, y: hy - 0.1 * H, bend: R / 2, color: metal.blade, shape: "box" });
      const poll = axePollRadius(H);
      add({ kind: "head", w: 2 * poll, h: 2 * poll, d: 2 * poll, y: hy, bend: -(sr + poll), color: metal.dark, shape: "box" });
      break;
    }
    case "flanged":
      add({ kind: "head", w: 1.2 * R, h: H, d: 1.2 * R, y: hy, color: metal.blade, shape: "box" });
      for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        add({ kind: "head", w: x ? 0.8 * R : 0.012, h: H * 0.9, d: z ? 0.8 * R : 0.012, y: hy, sway: x * 0.6 * R, bend: z * 0.6 * R, color: metal.highlight, shape: "box" });
      }
      break;
    case "hammer": {
      const spike = hammerSpike(R, spec.curvature);
      add({ kind: "head", w: 2 * R, h: H, d: sr + 0.035 + spike.length, y: hy, bend: (0.035 - spike.length) / 2, color: metal.blade, shape: "box" });
      break;
    }
    default: // block (maul)
      add({ kind: "head", w: 2 * R, h: H, d: 2 * MAUL_BLOCK_RATIO * R, y: hy, color: metal.blade, shape: "box" });
  }
  return parts;
}

/** Contract: the legacy GeneratedWeapon (part list + display numbers) of a spec. */
export function toGeneratedWeapon(spec: WeaponSpec): GeneratedWeapon {
  const profile = combatProfile(spec);
  const form = weaponForm(spec);
  const weight = legacyWeight(spec.mass);
  return {
    params: {
      type: legacyTypeOf(spec),
      weight,
      balance: legacyBalance(spec),
      sharpness: spec.sharpness,
      length: clamp(spec.length, 0.6, 1.6),
      curve: spec.curvature,
      metal: metalOf(spec.metal),
      fitting: metalOf(spec.fitting),
      grip: form.details.wrap,
    },
    name: spec.name,
    parts: legacyParts(spec),
    damage: Math.round(LEGACY_DAMAGE_PER_UNIT * (profile.minDamage + profile.maxDamage) / 2),
    cooldown: profile.cooldown,
    reach: legacyReach(spec, profile.reach),
    knockback: profile.impact,
    weight,
  };
}

/** Legacy reach (from the body centre): profile reach + SHOULDER_OFFSET; bows capped. */
export function legacyReach(spec: WeaponSpec, profileReach: number): number {
  return spec.ranged ? Math.min(profileReach, LEGACY_RANGED_REACH) : profileReach + SHOULDER_OFFSET;
}

/** Contract: the legacy Weapon struct (Fighter/AI/engine) of a spec. */
export function toLegacyWeapon(spec: WeaponSpec): Weapon {
  const profile = combatProfile(spec);
  const metal = METALS[metalOf(spec.metal)];
  const w = buildWeapon(legacyTypeOf(spec), legacyWeight(spec.mass), legacyBalance(spec), spec.sharpness, spec.name, metal.blade);
  w.damage = Math.round(LEGACY_DAMAGE_PER_UNIT * (profile.minDamage + profile.maxDamage) / 2);
  w.cooldown = profile.cooldown;
  w.reach = legacyReach(spec, profile.reach);
  w.knockback = profile.impact;
  return w;
}
