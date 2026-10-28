// Lane X test fixtures: WeaponSpec / CombatProfile in the contract's WEAPON LOCAL frame (+y from
// the main grip to the striking end, +z the primary edge / striking face, x the flat), built by
// hand so lane X's tests do not wait for lane W's generator. Masses, balance points and moments
// of inertia come from a two-part model (blade/head + hilt/haft as uniform rods or a point head):
//   I_grip = Σ m_i·(L_i²/12 + c_i²)   (rod of length L_i centred c_i from the grip)
//          + m_head·c_head²            (compact head)
// Not a test file itself (no `_test` suffix).
// @deno-types="@types/three"
import * as THREE from "three";
import type { CombatProfile, StrikeFeature, V3, WeaponSpec } from "../src/combat/contracts.ts";

const rod = (m: number, from: number, to: number) => m * ((to - from) ** 2 / 12 + ((from + to) / 2) ** 2);
const cm = (parts: [number, number][]) => parts.reduce((s, [m, c]) => s + m * c, 0) / parts.reduce((s, [m]) => s + m, 0);

/** A double-edged blade from y0 to tip: an edge each side (±z), a thrusting point at the tip. */
function blade(y0: number, tip: number, halfWidth: number, sharpness: number): StrikeFeature[] {
  const edge = (side: 1 | -1): StrikeFeature => ({
    kind: "edge", radius: 0.004, sharpness, facing: [0, 0, side],
    points: [[0, y0, side * halfWidth], [0, (y0 + tip) / 2, side * halfWidth * 0.7], [0, tip - 0.02, side * 0.004]],
    mix: { cut: 0.85, thrust: 0.05, blunt: 0.1 },
  });
  return [edge(1), edge(-1), { kind: "point", radius: 0.006, sharpness, points: [[0, tip, 0]], mix: { cut: 0, thrust: 1, blunt: 0 } }];
}

/** Longsword: 0.85 m blade (1.0 kg) from y 0.10, 0.45 kg hilt+pommel around y −0.08. */
export function longsword(): WeaponSpec {
  const parts: [number, number][] = [[1.0, 0.525], [0.45, -0.08]];
  return {
    id: "fixture-longsword", name: "Fixture Longsword", archetype: "longsword", weaponClass: "balanced", seed: 1,
    length: 1.15, mass: 1.45, balance: cm(parts), inertia: rod(1.0, 0.1, 0.95) + rod(0.45, -0.2, 0.04),
    headLength: 0.85, sharpness: 0.8, curvature: 0, hands: 1.5,
    grips: [{ id: "main", y: 0, modes: ["forward"] }, { id: "off", y: -0.12, modes: ["forward"] }],
    features: blade(0.1, 0.95, 0.024, 0.8),
  };
}

/** Greatsword: 1.25 m blade (1.9 kg), long two-handed grip. */
export function greatsword(): WeaponSpec {
  const parts: [number, number][] = [[1.9, 0.76], [0.8, -0.12]];
  return {
    id: "fixture-greatsword", name: "Fixture Greatsword", archetype: "greatsword", weaponClass: "heavy", seed: 2,
    length: 1.65, mass: 2.7, balance: cm(parts), inertia: rod(1.9, 0.13, 1.38) + rod(0.8, -0.3, 0.06),
    headLength: 1.25, sharpness: 0.7, curvature: 0, hands: 2,
    grips: [{ id: "main", y: 0, modes: ["forward"] }, { id: "off", y: -0.2, modes: ["forward"] }],
    features: blade(0.13, 1.38, 0.03, 0.7),
  };
}

/** Dagger: 0.25 m blade; holds forward or REVERSE (ice-pick) — the frame is the same, the hand turns it. */
export function dagger(): WeaponSpec {
  const parts: [number, number][] = [[0.22, 0.185], [0.13, -0.03]];
  return {
    id: "fixture-dagger", name: "Fixture Dagger", archetype: "dagger", weaponClass: "finesse", seed: 3,
    length: 0.38, mass: 0.35, balance: cm(parts), inertia: rod(0.22, 0.06, 0.31) + rod(0.13, -0.07, 0.01),
    headLength: 0.25, sharpness: 0.9, curvature: 0, hands: 1,
    grips: [{ id: "main", y: 0, modes: ["reverse", "forward"] }],
    features: blade(0.06, 0.31, 0.014, 0.9),
  };
}

/** War hammer: 1.4 kg head at y 0.78 (face +z), 0.8 kg haft from −0.12 to 0.75; two-handed. */
export function warhammer(): WeaponSpec {
  const parts: [number, number][] = [[1.4, 0.78], [0.8, 0.315]];
  const shaft: StrikeFeature = { kind: "shaft", radius: 0.018, sharpness: 0, points: [[0, -0.1, 0], [0, 0.72, 0]], mix: { cut: 0, thrust: 0, blunt: 1 } };
  const head: StrikeFeature = { kind: "head", radius: 0.055, sharpness: 0, facing: [0, 0, 1], points: [[0, 0.78, 0.03]], mix: { cut: 0, thrust: 0, blunt: 1 } };
  return {
    id: "fixture-warhammer", name: "Fixture War Hammer", archetype: "warhammer", weaponClass: "heavy", seed: 4,
    length: 0.92, mass: 2.2, balance: cm(parts), inertia: 1.4 * 0.78 ** 2 + rod(0.8, -0.12, 0.75),
    headLength: 0.12, sharpness: 0, curvature: 0, hands: 2,
    grips: [{ id: "main", y: 0, modes: ["forward"] }, { id: "off", y: -0.1, modes: ["forward"] }],
    features: [shaft, head],
  };
}

/** Spear: 2.0 m ash shaft, steel point at y 1.25, held 0.75 m from the butt. */
export function spear(): WeaponSpec {
  const parts: [number, number][] = [[1.4, 0.25], [0.35, 1.15]];
  return {
    id: "fixture-spear", name: "Fixture Spear", archetype: "spear", weaponClass: "finesse", seed: 5,
    length: 2.0, mass: 1.75, balance: cm(parts), inertia: rod(1.4, -0.75, 1.25) + 0.35 * 1.15 ** 2,
    headLength: 0.25, sharpness: 0.85, curvature: 0, hands: 2,
    grips: [{ id: "main", y: 0, modes: ["forward"] }, { id: "off", y: -0.5, modes: ["forward"] }],
    features: [
      { kind: "shaft", radius: 0.016, sharpness: 0, points: [[0, -0.75, 0], [0, 1.0, 0]], mix: { cut: 0, thrust: 0, blunt: 1 } },
      { kind: "point", radius: 0.006, sharpness: 0.85, points: [[0, 1.25, 0]], mix: { cut: 0, thrust: 1, blunt: 0 } },
    ],
  };
}

/** Profiles in the W07 spirit: finesse = high crit, low floor, misses more; heavy = the reverse. */
export const PROFILES: Record<"finesse" | "balanced" | "heavy", CombatProfile> = {
  finesse: { minDamage: 0.55, maxDamage: 1.25, critChance: 0.22, critMultiplier: 1.9, accuracy: 0.82, cooldown: 0.55, reach: 1.0, impact: 0.6, armourPierce: 0.35, relativeDps: 1 },
  balanced: { minDamage: 0.75, maxDamage: 1.25, critChance: 0.12, critMultiplier: 1.7, accuracy: 0.88, cooldown: 0.85, reach: 1.5, impact: 1.0, armourPierce: 0.2, relativeDps: 1 },
  heavy: { minDamage: 0.95, maxDamage: 1.45, critChance: 0.06, critMultiplier: 1.5, accuracy: 0.94, cooldown: 1.15, reach: 1.4, impact: 1.6, armourPierce: 0.1, relativeDps: 1 },
};

/** Column-major local->world matrix: rotation `angle` about unit `axis`, applied to a frame first rotated by `pre`, then translated. */
export function pose(axis: V3, angle: number, at: V3, pre?: THREE.Quaternion): number[] {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle);
  if (pre) q.multiply(pre);
  return new THREE.Matrix4().compose(new THREE.Vector3(...at), q, new THREE.Vector3(1, 1, 1)).toArray();
}

/** A capsule hitbox already in world space (bone frame = world). */
export function capsule(a: V3, b: V3, radius: number, zone: import("../src/combat/contracts.ts").HitZone = "foreArm") {
  return { zone, side: "C" as const, bone: "world", a: [...a] as V3, b: [...b] as V3, radius, wa: [...a] as V3, wb: [...b] as V3 };
}
