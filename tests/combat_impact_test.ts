// Lane X (W08/W09): the impact model — knockback physics, hit location, kind efficiency, armour.
import {
  effectiveWeaponMass, resolveImpact, targetEffectiveMass, ZONE_DAMAGE, ZONE_EFFECTIVE_SHARE, ZONE_EXPOSURE,
} from "../src/combat/Impact.ts";
import { sweepStrike } from "../src/combat/Sweep.ts";
import type { Contact, HitZone, ImpactInput, V3 } from "../src/combat/contracts.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { capsule, dagger, longsword, PROFILES, pose, warhammer } from "./combat_fixtures.ts";
// @deno-types="@types/three"
import * as THREE from "three";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const len = (v: V3) => Math.hypot(...v);
/** rng that always lands the blow (accuracy roll 0), mid damage roll, no crit. */
const sure = () => { const seq = [0, 0.5, 0.99]; let i = 0; return () => seq[i++ % 3]; };

function contactOn(zone: HitZone, velocity: V3, feature: Contact["feature"], local: V3, align: { edge?: number; thrust?: number } = {}): Contact {
  return {
    hitbox: capsule([0, 1.2, 0.5], [0, 1.5, 0.5], 0.12, zone), feature, point: [0, 1.3, 0.38], normal: [0, 0, -1],
    velocity, t: 0.5, edgeAlignment: align.edge ?? 1, thrustAlignment: align.thrust ?? 0, local,
  };
}
function input(contact: Contact, over: Partial<ImpactInput> = {}, defender: Partial<ImpactInput["defender"]> = {}): ImpactInput {
  return {
    contact, weapon: warhammer(), profile: PROFILES.heavy, handsUsed: 1,
    attacker: { mass: 80, strength: 6, attackPower: 10, velocity: [0, 0, 0] },
    defender: { mass: 80, armour: 0, blocking: false, balance: 0.5, velocity: [0, 0, 0], ...defender },
    rng: sure(), ...over,
  };
}
const hammerSquare = () => contactOn("chest", [0, 0, 12], "head", [0, 0.78, 0.03]);

Deno.test("impact: a two-handed war hammer square hit knocks back more than a one-handed swing", () => {
  const one = resolveImpact(input(hammerSquare(), { handsUsed: 1 }));
  const two = resolveImpact(input(hammerSquare(), { handsUsed: 2 }));
  console.log(`  1H ${len(one.knockback).toFixed(1)} N·s, 2H ${len(two.knockback).toFixed(1)} N·s`);
  console.log(`  ${two.notes.join("\n  ")}`);
  assert(len(two.knockback) > 1.15 * len(one.knockback), "2H should drive harder");
  assert(two.damage > one.damage, "more momentum, more blunt damage");
  assert(two.knockback[2] > 0 && Math.abs(two.knockback[0]) < 1e-9, "pushed straight along the blow");
});

Deno.test("impact: an 80° glancing hit knocks back less than a square one, and slides", () => {
  const a = 80 * Math.PI / 180;
  const square = resolveImpact(input(hammerSquare()));
  const glance = resolveImpact(input(contactOn("chest", [12 * Math.sin(a), 0, 12 * Math.cos(a)], "head", [0, 0.78, 0.03])));
  console.log(`  square ${len(square.knockback).toFixed(1)} N·s, 80° ${len(glance.knockback).toFixed(1)} N·s`);
  assert(len(glance.knockback) < 0.4 * len(square.knockback), "glancing blow pushed too hard");
  assert(glance.knockback[0] > 0, "the tangential slide drags the defender along the swing");
  assert(glance.stagger <= square.stagger, "stagger follows the push");
});

Deno.test("impact: a heavier defender moves less (Δv = J / m), and stagger follows Δv", () => {
  const light = resolveImpact(input(hammerSquare(), { handsUsed: 2 }, { mass: 60 }));
  const heavy = resolveImpact(input(hammerSquare(), { handsUsed: 2 }, { mass: 130 }));
  console.log(`  60 kg: Δv ${(len(light.knockback) / 60).toFixed(2)} m/s, stagger ${light.stagger.toFixed(2)} s; 130 kg: Δv ${(len(heavy.knockback) / 130).toFixed(2)} m/s, stagger ${heavy.stagger.toFixed(2)} s`);
  assert(len(heavy.knockback) / 130 < len(light.knockback) / 60, "heavy defender should move less");
  assert(heavy.stagger < light.stagger, `stagger ${heavy.stagger} vs ${light.stagger}`);
  // Guard and footing take their share.
  const braced = resolveImpact(input(hammerSquare(), {}, { blocking: true, balance: 1 }));
  assert(len(braced.knockback) < 0.5 * len(resolveImpact(input(hammerSquare(), {}, { balance: 0 })).knockback), "brace + planted feet");
});

Deno.test("impact: reverse-grip dagger stab down the blade — thrustAlignment ~1, pierces armour better than a cut", () => {
  const knife = dagger();
  const reverse = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const stab = sweepStrike({ matrix: pose([1, 0, 0], 0, [0, 1.5, 0], reverse), time: 0 }, { matrix: pose([1, 0, 0], 0, [0, 1.5 - 8 / 60, 0], reverse), time: 1 / 60 },
    { mass: 70, boxes: [capsule([-0.15, 1.05, 0], [0.15, 1.05, 0], 0.05, "chest")] }, knife)!;
  assert(stab && stab.feature === "point" && stab.thrustAlignment > 0.99, `stab ${stab?.feature} ${stab?.thrustAlignment}`);
  const at = (armour: number, c: Contact) => resolveImpact({ ...input(c, { weapon: knife, profile: PROFILES.finesse }), defender: { mass: 80, armour, blocking: false, balance: 0.5, velocity: [0, 0, 0] } }).damage;
  const stabRatio = at(0.6, stab) / at(0, stab);
  const cut = contactOn("chest", [0, 0, 8], "edge", [0, 0.2, 0.012], { edge: 1 });
  const cutRatio = at(0.6, cut) / at(0, cut);
  console.log(`  armour 0.6 keeps ${(100 * stabRatio).toFixed(0)} % of a stab, ${(100 * cutRatio).toFixed(0)} % of a cut`);
  // Armour follows ONE law for every weapon (Impact ARMOUR_DIVISOR_GAIN: the class model's
  // 1 / (1 + 0.04 armor), at most ~21 % off), so the gap between a stab and a cut is a few points,
  // not the 25+ points of the pre-balance model (which let a mace out-damage a sword 10x live).
  assert(stabRatio > 0.85 && stabRatio > cutRatio + 0.03, "an aligned thrust must pierce armour better than a cut");
});

Deno.test("impact: zone multipliers ordered head > neck > chest > abdomen > limbs > hands/feet, surface mean 1", () => {
  const z = ZONE_DAMAGE;
  const limbs: HitZone[] = ["upperArm", "foreArm", "thigh", "shin"], ends: HitZone[] = ["hand", "foot"];
  assert(z.head > z.neck && z.neck > z.chest && z.chest > z.abdomen, "trunk order");
  for (const l of limbs) assert(z.abdomen > z[l] && ends.every((e) => z[l] > z[e]), `limb ${l}`);
  const mean = (Object.keys(z) as HitZone[]).reduce((s, k) => s + ZONE_EXPOSURE[k] * z[k], 0);
  assert(Math.abs(mean - 1) < 1e-12, `exposure-weighted mean ${mean}`);
  console.log("  ZONE_DAMAGE", Object.entries(z).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));
  console.log("  ZONE_EFFECTIVE_SHARE", Object.entries(ZONE_EFFECTIVE_SHARE).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", "));
  // A head hit does more than a hand hit with everything else equal.
  const at = (zone: HitZone) => resolveImpact(input(contactOn(zone, [0, 0, 12], "head", [0, 0.78, 0.03]))).damage;
  assert(at("head") > at("chest") && at("chest") > at("hand"), "location damage");
});

Deno.test("impact: cutting with the flat is a graze; finesse misses more than heavy; poor alignment lowers the hit chance", () => {
  const sword = longsword();
  const clean = resolveImpact(input(contactOn("chest", [0, 0, 10], "edge", [0, 0.6, 0.02], { edge: 1 }), { weapon: sword, profile: PROFILES.balanced }));
  const flat = resolveImpact(input(contactOn("chest", [0, 0, 10], "edge", [0, 0.6, 0.02], { edge: 0.05 }), { weapon: sword, profile: PROFILES.balanced }));
  assert(clean.outcome === "hit" && flat.outcome === "graze", `${clean.outcome} / ${flat.outcome}`);
  assert(flat.damage < 0.4 * clean.damage, `flat ${flat.damage} vs edge ${clean.damage}`);
  const misses = (profile: typeof PROFILES.heavy, edge: number) => {
    const rng = rng32(7);
    let m = 0;
    for (let i = 0; i < 4000; i++) if (resolveImpact(input(contactOn("chest", [0, 0, 10], "edge", [0, 0.6, 0.02], { edge }), { weapon: sword, profile, rng })).outcome === "miss") m++;
    return m / 4000;
  };
  const fin = misses(PROFILES.finesse, 1), hvy = misses(PROFILES.heavy, 1), sloppy = misses(PROFILES.finesse, 0.2);
  console.log(`  miss rate finesse ${(100 * fin).toFixed(1)} %, heavy ${(100 * hvy).toFixed(1)} %, finesse off-edge ${(100 * sloppy).toFixed(1)} %`);
  assert(fin > hvy + 0.05 && sloppy > fin + 0.05, "miss ordering");
});

Deno.test("impact: lever arm and hands — effective mass grows toward the grip and with a second hand; masses derived", () => {
  const h = warhammer();
  assert(effectiveWeaponMass(h, 0.78, 2, 80, 6) > effectiveWeaponMass(h, 0.78, 1, 80, 6), "second hand");
  assert(effectiveWeaponMass(h, 0.3, 1, 80, 6) > 2 * effectiveWeaponMass(h, 0.78, 1, 80, 6), "a blow near the combined centre of mass meets far more mass than one at the head");
  assert(effectiveWeaponMass(h, 0.78, 1, 80, 9) > effectiveWeaponMass(h, 0.78, 1, 80, 3), "strength stiffens the arm");
  assert(targetEffectiveMass("pelvis", 80) > targetEffectiveMass("head", 80) && targetEffectiveMass("head", 80) > targetEffectiveMass("hand", 80), "target mass by zone");
});

Deno.test("impact: every output finite for degenerate inputs", () => {
  const bad: Contact = { ...hammerSquare(), velocity: [NaN, Infinity, 0], normal: [0, 0, 0], local: undefined };
  const cases: ImpactInput[] = [
    input(bad),
    input(hammerSquare(), { attacker: { mass: 0, strength: NaN, attackPower: NaN, velocity: [0, 0, 0] } }, { mass: 0, armour: NaN, balance: NaN }),
    input(hammerSquare(), { weapon: { ...warhammer(), features: [], mass: 0, inertia: 0, balance: NaN }, rng: () => NaN }),
    input({ ...hammerSquare(), velocity: [0, 0, 0] }),
    input({ ...hammerSquare(), feature: "point", thrustAlignment: NaN, edgeAlignment: NaN }, { profile: { ...PROFILES.heavy, accuracy: NaN, minDamage: NaN } }),
  ];
  for (const c of cases) {
    const r = resolveImpact(c);
    assert([r.damage, r.stagger, ...r.knockback].every(Number.isFinite), `non-finite: ${JSON.stringify(r)}`);
    assert(r.damage >= 0 && r.stagger >= 0, "non-negative");
  }
});
