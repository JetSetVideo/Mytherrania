// Lane X (W08/W09): the physical impact model — what a geometric contact does to the defender.
// Pure module (no THREE). Every constant below is a named base parameter with its reason; the
// derived tables (zone damage, zone effective mass) are computed from them at load.
//
// 1. Relative velocity at the contact: v_rel = v_feature − v_defender; normal speed
//    v_n = max(0, −v_rel·n) (n points out of the target); hit angle θ = acos(v_n / |v_rel|).
// 2. Effective striking mass (weapon + the arm masses behind it), at the contact's lever arm:
//    the weapon and the lumped arm masses at each gripping hand form one rigid body during the
//    few-ms contact. With M = m_w + Σm_hand, y_cm = (m_w·balance + Σ m_hand·y_hand)/M,
//    I_cm = I_grip + Σ m_hand·y_hand² − M·y_cm², lever d = y_contact − y_cm and the share s⊥ of
//    the impulse across the weapon axis:  1/m_w,eff = 1/M + s⊥²·d²/I_cm.
//    m_hand = ARM_MASS_FRACTION·m_attacker·ARM_COUPLING·√(strength/STRENGTH_REF) per hand; two
//    hands also lock the shoulder girdle in: + TWO_HAND_TRUNK_SHARE·m_attacker at the main hand.
//    The hands also resist the weapon's rotation about the grip: I_grip += WRIST_LOCK[hands] ·
//    Σm_hand · ARM_LEVER² — one wrist is a hinge, two spaced hands lock haft and forearms
//    together (this is what makes a two-handed blow land "heavier").
// 3. Effective target mass: the struck segment plus every other segment, each discounted by
//    JOINT_COUPLING per joint in between (SEGMENT_MASS_SHARE, Winter 2009 anthropometry).
// 4. Normal impulse J_n = (1 + e)·μ·v_n, μ = 1/(1/m_w,eff + 1/m_t), restitution e from the
//    armour; a cut or thrust that bites goes INTO the target and transfers less (TRANSFER).
//    Friction impulse J_t = min(FRICTION·J_n, μ·v_t) along the tangential slide. Knockback
//    vector = J_n·(−n) + J_t·t̂ — so a square blow pushes straight in, a glancing one mostly
//    slides and pushes little; then the defender's guard (BLOCK_BRACE) and footing
//    (GROUND_SHARE·balance) take their share.
// 5. Damage = attackPower × roll[min, max] × crit × ZONE_DAMAGE[zone] × Σ_kind mix·eff·armour.

import { clamp, clamp01, lerp, smoothstep } from "../core/MathCore.ts";
import type { DamageKind, HitZone, ImpactInput, ImpactResult, StrikeFeature, V3, WeaponSpec } from "./contracts.ts";

// --- base parameters -----------------------------------------------------------------------

/** One arm's share of body mass (upper arm 2.8 % + forearm 1.6 % + hand 0.6 %, Winter 2009). */
export const ARM_MASS_FRACTION = 0.05;
/** Share of an arm's mass that moves rigidly with the grip during contact (wrist/elbow give). */
export const ARM_COUPLING = 0.5;
/** Two hands brace the shoulder girdle: this share of body mass joins at the main hand. */
export const TWO_HAND_TRUNK_SHARE = 0.04;
/** Stats.strength of an average fighter (class primaries 2..9). Strength stiffens the arm: coupling × √(s/ref). */
export const STRENGTH_REF = 5.5;
/** Strength factor clamp (a feeble arm still holds the weapon; a strong one is not a wall). */
export const STRENGTH_FACTOR_RANGE: [number, number] = [0.6, 1.5];
/**
 * How firmly the hands lock the weapon's ROTATION to the arms, 0..1, per hands on the grip: one
 * wrist is nearly a hinge; two spaced hands make the haft and both forearms one lever.
 */
export const WRIST_LOCK: Record<1 | 2, number> = { 1: 0.15, 2: 1 };
/** Lever of the arm resisting that rotation (shoulder to grip), m. */
export const ARM_LEVER = 0.6;
/** Off-hand spacing below the main grip when a weapon declares no "off" grip point, m. */
export const OFF_HAND_SPACING = 0.12;
/** Momentum passed across each joint during contact (0 = loose chain, 1 = rigid body). */
export const JOINT_COUPLING = 0.5;
/** Restitution of a blow on flesh / on full armour (metal rings back). */
export const RESTITUTION_FLESH = 0.05, RESTITUTION_ARMOUR = 0.3;
/** Share of the impulse a fully biting cut / thrust still transfers (the rest goes into the wound). */
export const TRANSFER: Record<DamageKind, number> = { cut: 0.6, thrust: 0.8, blunt: 1 };
/** Coulomb friction of steel on cloth/flesh: the tangential impulse is at most FRICTION·J_n. */
export const FRICTION = 0.35;
/** A guarding defender absorbs this share of the push (braced stance, arms in the way). */
export const BLOCK_BRACE = 0.45;
/** At balance 1 (feet planted) the ground takes this share of the push through friction. */
export const GROUND_SHARE = 0.5;
/** Velocity change (m/s) below which a blow does not stagger, and seconds per extra m/s. */
export const STAGGER_DV0 = 0.25, STAGGER_PER_DV = 0.55, STAGGER_MAX = 1.2;
/** Swing speed at which a blow is "nominal" (blunt efficiency 1), m/s. */
export const V_NOMINAL = 10;
/** Blunt efficiency clamp (momentum ratio square-rooted: energy-like growth, bounded). */
export const BLUNT_EFF_RANGE: [number, number] = [0.45, 1.45];
/** Edge alignment below which a cut cannot bite, for a dull (0) and a keen (1) edge; full bite at CUT_ALIGN_FULL. */
export const CUT_ALIGN_MIN: [number, number] = [0.5, 0.3], CUT_ALIGN_FULL = 0.85;
/** Thrust alignment: no penetration below, full above. */
export const THRUST_ALIGN_MIN = 0.55, THRUST_ALIGN_FULL = 0.93;
/** Speed (m/s) along the working direction at which an edge/point bites fully (0 bites nothing). */
export const BITE_SPEED = 4;
/** Armour: a cut uses CUT_PIERCE_SHARE of the weapon's armourPierce; an aligned thrust adds up to THRUST_PIERCE_BONUS; blunt force passes BLUNT_TRANSMIT through. */
export const CUT_PIERCE_SHARE = 0.5, THRUST_PIERCE_BONUS = 0.4, BLUNT_TRANSMIT = 0.55;
/**
 * Armour divisor gain on the 0..1 armour share: 1 / (1 + gain · share · (1 - pierce)). With
 * share = Stats.armor / 10 (Engine ARMOUR_SCALE) and gain 0.4 this equals the class model's
 * 1 / (1 + 0.04 · armor) (Stats.attackDamage).
 */
export const ARMOUR_DIVISOR_GAIN = 0.4;
/**
 * Cap on a blunt blow's damage efficiency: a two-handed square blow may do up to 15 % more than
 * a nominal one (its extra momentum mostly becomes push, not damage), bounded so the weapon's
 * DPS normalisation holds within ~15 % at the extremes.
 */
export const BLUNT_DAMAGE_EFF_MAX = 1.15;
/**
 * Mean delivery efficiency of each damage kind over the REFERENCE contact distribution (swing
 * speed 6–14 m/s, 0–52° from the normal, edge/point alignment 0.55–1, surface-weighted zones),
 * measured by /Users/macmax/.hermes/cache/scratch/balance_probe.ts over 15 melee archetypes x
 * 40 weapons x 400 contacts x 2 armours. Re-measure when the efficiency curves change.
 */
export const EXPECTED_EFFICIENCY: Record<DamageKind, number> = { cut: 0.831, thrust: 0.58, blunt: 1.023 };
/** Upper bound of a single hit's efficiency relative to the average (a perfect stab ~1/0.58). */
export const EFFICIENCY_MAX = 1.8;
/** Below this delivery efficiency (before armour) a landed blow is a graze. */
export const GRAZE_EFF = 0.35;
/** A poorly aligned blow is harder to land: accuracy × lerp(ACCURACY_FLOOR, 1, quality). */
export const ACCURACY_FLOOR = 0.75;

// --- derived tables ------------------------------------------------------------------------

/** Segment masses as a share of body mass (Winter 2009; head+neck 8.1 % split 6.9 / 1.2). */
export const SEGMENT_MASS_SHARE: Record<HitZone, number> = {
  head: 0.069, neck: 0.012, chest: 0.216, abdomen: 0.139, pelvis: 0.142,
  upperArm: 0.028, foreArm: 0.016, hand: 0.006, thigh: 0.1, shin: 0.0465, foot: 0.0145,
};
/** The segment chain: each zone's proximal neighbour (toward the pelvis). */
const PARENT: Record<HitZone, HitZone | null> = {
  pelvis: null, abdomen: "pelvis", chest: "abdomen", neck: "chest", head: "neck",
  upperArm: "chest", foreArm: "upperArm", hand: "foreArm", thigh: "pelvis", shin: "thigh", foot: "shin",
};
/** Bilateral segments (two of each in the body). */
const PAIRED = new Set<HitZone>(["upperArm", "foreArm", "hand", "thigh", "shin", "foot"]);

/** Joints between two zones along the chain; the other side's limb counts via the trunk. */
function hops(a: HitZone, b: HitZone, sameSide: boolean): number {
  const path = (z: HitZone) => { const out: HitZone[] = []; for (let c: HitZone | null = z; c; c = PARENT[c]) out.push(c); return out; };
  const pa = path(a), pb = path(b);
  if (!sameSide && PAIRED.has(a) && PAIRED.has(b)) {
    // Different sides: up to the trunk on one side, down the other.
    const trunk = (p: HitZone[]) => p.findIndex((z) => !PAIRED.has(z));
    const ia = trunk(pa), ib = trunk(pb);
    return ia + ib + hops(pa[ia], pb[ib], true);
  }
  for (let i = 0; i < pa.length; i++) { const j = pb.indexOf(pa[i]); if (j >= 0) return i + j; }
  return pa.length + pb.length;
}

/**
 * Share of body mass an impulse on `zone` meets during the contact:
 *   Σ_segments share_s · JOINT_COUPLING^(joints between zone and s)   (both sides of paired limbs).
 * Derived once: pelvis ≈ 0.43, chest ≈ 0.41, head ≈ 0.18, hand ≈ 0.04.
 */
export const ZONE_EFFECTIVE_SHARE: Record<HitZone, number> = (() => {
  const zones = Object.keys(SEGMENT_MASS_SHARE) as HitZone[];
  const out = {} as Record<HitZone, number>;
  for (const z of zones) {
    let m = 0;
    for (const s of zones) {
      if (PAIRED.has(s)) {
        m += SEGMENT_MASS_SHARE[s] * JOINT_COUPLING ** hops(z, s, true);
        m += SEGMENT_MASS_SHARE[s] * JOINT_COUPLING ** hops(z, s, false);
      } else m += SEGMENT_MASS_SHARE[s] * JOINT_COUPLING ** hops(z, s, true);
    }
    out[z] = m;
  }
  return out;
})();

/** Body surface each zone exposes (rule-of-nines shares, both sides of a paired zone summed; Σ = 1). */
export const ZONE_EXPOSURE: Record<HitZone, number> = {
  head: 0.07, neck: 0.02, chest: 0.14, abdomen: 0.11, pelvis: 0.09,
  upperArm: 0.08, foreArm: 0.06, hand: 0.05, thigh: 0.18, shin: 0.13, foot: 0.07,
};
/**
 * What is at stake under the skin, 0..1: brain 1; airway/carotid/spine 0.85; heart/lungs 0.6;
 * liver/gut 0.45; iliac vessels/hip 0.3; femoral artery 0.2; brachial artery 0.15; shin/forearm
 * bones 0.1; hands/feet 0.05.
 */
export const ZONE_VITALITY: Record<HitZone, number> = {
  head: 1, neck: 0.85, chest: 0.6, abdomen: 0.45, pelvis: 0.3,
  thigh: 0.2, upperArm: 0.15, shin: 0.1, foreArm: 0.1, hand: 0.05, foot: 0.05,
};
/** How strongly vitality raises damage before normalisation (raw = 1 + VITAL_GAIN·vitality). */
export const VITAL_GAIN = 1.5;
/**
 * Location damage multiplier: raw_z = 1 + VITAL_GAIN·vitality_z, normalised so the
 * exposure-weighted mean is exactly 1 (a blow landing anywhere on the surface at random keeps
 * the class balance): ZONE_DAMAGE_z = raw_z / Σ_k exposure_k·raw_k.
 */
export const ZONE_DAMAGE: Record<HitZone, number> = (() => {
  const zones = Object.keys(ZONE_VITALITY) as HitZone[];
  const raw = (z: HitZone) => 1 + VITAL_GAIN * ZONE_VITALITY[z];
  const mean = zones.reduce((s, z) => s + ZONE_EXPOSURE[z] * raw(z), 0);
  return Object.fromEntries(zones.map((z) => [z, raw(z) / mean])) as Record<HitZone, number>;
})();

// --- helpers -------------------------------------------------------------------------------

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const v3 = (v: V3 | undefined): V3 => [fin(v?.[0] ?? 0), fin(v?.[1] ?? 0), fin(v?.[2] ?? 0)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Lumped arm mass behind one gripping hand, kg (see module comment, step 2). */
export function handMass(attackerMass: number, strength: number): number {
  const s = clamp(Math.sqrt(Math.max(0, fin(strength, STRENGTH_REF)) / STRENGTH_REF), STRENGTH_FACTOR_RANGE[0], STRENGTH_FACTOR_RANGE[1]);
  return ARM_MASS_FRACTION * Math.max(0, fin(attackerMass)) * ARM_COUPLING * s;
}

/**
 * Effective mass (kg) of the weapon-and-arms body for an impulse at `yContact` (m along +y from
 * the main grip) whose direction makes share `across` (0..1, |sin| to the weapon axis) across it.
 */
export function effectiveWeaponMass(weapon: WeaponSpec, yContact: number, handsUsed: 1 | 2, attackerMass: number, strength: number, across = 1): number {
  const mw = Math.max(0.05, fin(weapon.mass, 1));
  const hand = handMass(attackerMass, strength);
  const masses: [number, number][] = [[hand + (handsUsed === 2 ? TWO_HAND_TRUNK_SHARE * Math.max(0, fin(attackerMass)) : 0), 0]];
  if (handsUsed === 2) masses.push([hand, weapon.grips?.find((g) => g.id === "off")?.y ?? -OFF_HAND_SPACING]);
  const M = mw + masses.reduce((sum, [m]) => sum + m, 0);
  const yCm = (mw * fin(weapon.balance) + masses.reduce((s, [m, y]) => s + m * y, 0)) / M;
  // I about the grip must at least hold the weapon's own mass at its balance point (point mass).
  const armMass = masses.reduce((s, [m]) => s + m, 0);
  const iGrip = Math.max(fin(weapon.inertia), mw * fin(weapon.balance) ** 2) + masses.reduce((s, [m, y]) => s + m * y * y, 0)
    + WRIST_LOCK[handsUsed] * armMass * ARM_LEVER * ARM_LEVER;
  const iCm = Math.max(1e-4, iGrip - M * yCm * yCm);
  const d = fin(yContact) - yCm, s = clamp01(fin(across, 1));
  return 1 / (1 / M + (s * s * d * d) / iCm);
}

/** Effective target mass (kg) for an impulse on a zone of a body of `mass` kg. */
export function targetEffectiveMass(zone: HitZone, mass: number): number {
  return Math.max(1, fin(mass, 70)) * (ZONE_EFFECTIVE_SHARE[zone] ?? 0.4);
}

/** The striking feature of a contact (by index when given, else the first of its kind). */
function featureOf(input: ImpactInput): StrikeFeature | null {
  const f = input.weapon.features ?? [];
  const i = input.contact.featureIndex;
  if (i !== undefined && f[i]) return f[i];
  return f.find((x) => x.kind === input.contact.feature) ?? null;
}

/** Weapon-local y of the contact: Contact.local when present, else the feature's centroid. */
function contactY(input: ImpactInput, feature: StrikeFeature | null): number {
  if (input.contact.local) return fin(input.contact.local[1]);
  if (!feature || feature.points.length === 0) return fin(input.weapon.balance);
  return feature.points.reduce((s, p) => s + p[1], 0) / feature.points.length;
}

// --- the model -----------------------------------------------------------------------------

/**
 * Contract entry point (module comment). Deterministic for a given rng; every output finite for
 * any input (NaN/zero masses, zero velocity, missing feature).
 */
export function resolveImpact(input: ImpactInput): ImpactResult {
  const { contact, weapon, profile, attacker, defender } = input;
  const rng = input.rng;
  const notes: string[] = [];
  const zone = contact.hitbox.zone;
  const feature = featureOf(input);
  const mix = feature?.mix ?? { cut: 0, thrust: 0, blunt: 1 };
  const mixSum = Math.max(1e-9, fin(mix.cut) + fin(mix.thrust) + fin(mix.blunt));
  const w = { cut: fin(mix.cut) / mixSum, thrust: fin(mix.thrust) / mixSum, blunt: fin(mix.blunt) / mixSum };
  const handsUsed: 1 | 2 = input.handsUsed === 2 ? 2 : 1;

  // 1. Kinematics at the contact.
  let n = v3(contact.normal);
  const vRel: V3 = v3(contact.velocity);
  const vd = v3(defender.velocity);
  vRel[0] -= vd[0]; vRel[1] -= vd[1]; vRel[2] -= vd[2];
  const speed = norm(vRel);
  if (norm(n) < 1e-9) n = speed > 1e-9 ? [-vRel[0] / speed, -vRel[1] / speed, -vRel[2] / speed] : [0, 0, 1];
  else { const l = norm(n); n = [n[0] / l, n[1] / l, n[2] / l]; }
  const vn = Math.max(0, -dot(vRel, n));
  const vt: V3 = [vRel[0] + n[0] * vn, vRel[1] + n[1] * vn, vRel[2] + n[2] * vn]; // slide along the surface
  const vtLen = norm(vt);
  const angle = speed > 1e-9 ? Math.acos(clamp(vn / speed, 0, 1)) : 0;

  // 2–3. Masses. The impulse runs along n; its share across the weapon axis needs the axis,
  // which the contract does not carry: thrusts (point) push along the axis, everything else across.
  const across = contact.feature === "point" ? Math.sqrt(Math.max(0, 1 - fin(contact.thrustAlignment) ** 2)) : 1;
  const y = contactY(input, feature);
  const mW = effectiveWeaponMass(weapon, y, handsUsed, attacker.mass, attacker.strength, across);
  const mT = targetEffectiveMass(zone, defender.mass);
  const mu = 1 / (1 / mW + 1 / mT);

  // Kind efficiencies (0..1): how well this contact delivers each kind of damage.
  const keen = clamp01(fin(feature?.sharpness ?? weapon.sharpness));
  const cutMin = lerp(CUT_ALIGN_MIN[0], CUT_ALIGN_MIN[1], keen);
  const bite = (v: number) => smoothstep(0, BITE_SPEED, v);
  const edgeA = clamp01(fin(contact.edgeAlignment)), thrustA = clamp01(fin(contact.thrustAlignment));
  const effCut = smoothstep(cutMin, CUT_ALIGN_FULL, edgeA) * bite(vn);
  const effThrust = smoothstep(THRUST_ALIGN_MIN, THRUST_ALIGN_FULL, thrustA) * bite(speed * thrustA);

  // 4. Impulse.
  const armour = clamp01(fin(defender.armour));
  const e = lerp(RESTITUTION_FLESH, RESTITUTION_ARMOUR, armour);
  const transfer = w.cut * (1 - (1 - TRANSFER.cut) * effCut) + w.thrust * (1 - (1 - TRANSFER.thrust) * effThrust) + w.blunt;
  const Jn = (1 + e) * mu * vn * transfer;
  const Jt = Math.min(FRICTION * Jn, mu * vtLen);
  const tHat: V3 = vtLen > 1e-9 ? [vt[0] / vtLen, vt[1] / vtLen, vt[2] / vtLen] : [0, 0, 0];
  const guard = defender.blocking ? 1 - BLOCK_BRACE : 1;
  const footing = 1 - GROUND_SHARE * clamp01(fin(defender.balance));
  const k = guard * footing;
  let knockback: V3 = [(-n[0] * Jn + tHat[0] * Jt) * k, (-n[1] * Jn + tHat[1] * Jt) * k, (-n[2] * Jn + tHat[2] * Jt) * k];

  // Blunt efficiency: this blow's momentum against the same weapon's one-handed square blow at
  // V_NOMINAL on the same spot — speed, angle and the second hand count; the weapon's own mass
  // does not (lane W's profile already prices it).
  const jNominal = (1 + e) * (1 / (1 / effectiveWeaponMass(weapon, y, 1, attacker.mass, attacker.strength, 1) + 1 / mT)) * V_NOMINAL;
  const effBlunt = clamp(Math.sqrt(Jn / Math.max(1e-9, jNominal)), BLUNT_EFF_RANGE[0], BLUNT_EFF_RANGE[1]) * (vn > 0 ? 1 : 0);

  // 5. Damage.
  const pierce = clamp01(fin(profile.armourPierce));
  const armourCut = 1 - armour * (1 - CUT_PIERCE_SHARE * pierce);
  const armourThrust = 1 - armour * (1 - clamp01(pierce + THRUST_PIERCE_BONUS * thrustA * thrustA));
  const armourBlunt = 1 - armour * (1 - BLUNT_TRANSMIT);
  const delivery = w.cut * effCut + w.thrust * effThrust + w.blunt * Math.min(1, effBlunt);
  // Physical kind factor of THIS contact (armour by kind, as above) — kept for the notes.
  const kindFactor = w.cut * effCut * armourCut + w.thrust * effThrust * armourThrust + w.blunt * effBlunt * armourBlunt;
  // Damage factor, BALANCED: the contact's physics decides how good this blow is relative to a
  // perfect blow with the SAME weapon on the SAME armour (efficiency <= 1, a blunt blow up to
  // BLUNT_DAMAGE_EFF_MAX — a two-handed square blow keeps most of its extra momentum as push), and one armour
  // law for every weapon scales the result:
  //   efficiency = kindDamage(eff capped) / kindIdeal(eff = 1, thrust aligned)
  //   armourMul  = 1 / (1 + ARMOUR_DIVISOR_GAIN · armour · (1 - armourPierce))
  // With armour = Stats.armor / 10 this is the class model's 1 / (1 + 0.04 · armor), so the
  // per-weapon DPS normalisation (lane W) and class balance hold in expectation, while angle,
  // edge bite, thrust alignment and the zone still shape each hit. (Before this, a clean cut
  // kept ~0.4x through a Warrior's armour and a 2H blunt blow up to ~1.0x: a mace head-blow
  // did 10x a longsword's in a live fight.)
  const kindDamage = w.cut * effCut * armourCut + w.thrust * effThrust * armourThrust + w.blunt * Math.min(BLUNT_DAMAGE_EFF_MAX, effBlunt) * armourBlunt;
  const armourThrustIdeal = 1 - armour * (1 - clamp01(pierce + THRUST_PIERCE_BONUS));
  // Normalise by the AVERAGE contact of each kind (EXPECTED_EFFICIENCY), not a perfect one: a cut
  // needs its edge aligned and a thrust its point, a blunt head needs neither, so measured against
  // perfection blades lost ~20 % and thrusts ~40 % of their DPS to ordinary contacts. Relative to
  // the average, a clean cut or a true stab still beats a sloppy one (up to EFFICIENCY_MAX).
  const kindExpected = w.cut * EXPECTED_EFFICIENCY.cut * armourCut + w.thrust * EXPECTED_EFFICIENCY.thrust * armourThrustIdeal
    + w.blunt * EXPECTED_EFFICIENCY.blunt * armourBlunt;
  const efficiency = kindExpected > 1e-9 ? clamp(kindDamage / kindExpected, 0, EFFICIENCY_MAX) : 0;
  // An aligned, biting thrust finds the gaps: the weapon's pierce plus a bonus for this hit.
  const pierceHit = clamp01(pierce + THRUST_PIERCE_BONUS * w.thrust * effThrust * thrustA * thrustA);
  const armourMul = 1 / (1 + ARMOUR_DIVISOR_GAIN * armour * (1 - pierceHit));
  const damageFactor = efficiency * armourMul;
  const quality = w.cut * edgeA + w.thrust * thrustA + w.blunt;
  const pHit = clamp01(fin(profile.accuracy, 0.9)) * lerp(ACCURACY_FLOOR, 1, clamp01(quality));
  const rAcc = rng(), rRoll = rng(), rCrit = rng();
  const zoneMul = ZONE_DAMAGE[zone] ?? 1;
  const roll = lerp(fin(profile.minDamage, 1), fin(profile.maxDamage, 1), clamp01(rRoll));
  const kindName = handsUsed === 2 ? "2H" : "1H";
  notes.push(`${weapon.archetype} ${kindName} ${contact.feature} on ${contact.hitbox.side}${zone}: ${(angle * 180 / Math.PI).toFixed(0)}° from the normal, v_n ${vn.toFixed(1)} m/s`);
  notes.push(`m_w,eff ${mW.toFixed(2)} kg (lever ${y.toFixed(2)} m) vs m_t ${mT.toFixed(1)} kg → J_n ${Jn.toFixed(1)} N·s, J_t ${Jt.toFixed(1)} N·s, e ${e.toFixed(2)}`);
  notes.push(`delivery cut ${effCut.toFixed(2)} thrust ${effThrust.toFixed(2)} blunt ${effBlunt.toFixed(2)}; armour ${armour.toFixed(2)} → physical ×${kindFactor.toFixed(2)}, damage ×${damageFactor.toFixed(2)} (efficiency ${efficiency.toFixed(2)}); zone ×${zoneMul.toFixed(2)}`);

  let outcome: ImpactResult["outcome"];
  let damage: number;
  if (!(rAcc < pHit)) {
    outcome = "miss"; damage = 0; knockback = [0, 0, 0];
    notes.push(`miss: roll ${rAcc.toFixed(2)} ≥ p ${pHit.toFixed(2)} (accuracy ${fin(profile.accuracy).toFixed(2)}, quality ${quality.toFixed(2)})`);
  } else if (delivery < GRAZE_EFF) {
    outcome = "graze";
    damage = Math.max(0, fin(attacker.attackPower)) * roll * zoneMul * damageFactor;
    notes.push(`graze: delivery ${delivery.toFixed(2)} < ${GRAZE_EFF}`);
  } else {
    const crit = rCrit < clamp01(fin(profile.critChance));
    outcome = crit ? "critical" : "hit";
    damage = Math.max(0, fin(attacker.attackPower)) * roll * (crit ? Math.max(1, fin(profile.critMultiplier, 1)) : 1) * zoneMul * damageFactor;
  }
  const dv = norm(knockback) / Math.max(1, fin(defender.mass, 70));
  const stagger = outcome === "miss" ? 0 : clamp((dv - STAGGER_DV0) * STAGGER_PER_DV, 0, STAGGER_MAX);
  notes.push(`${outcome}: damage ${damage.toFixed(2)}, knockback ${norm(knockback).toFixed(1)} N·s (Δv ${dv.toFixed(2)} m/s), stagger ${stagger.toFixed(2)} s`);
  return { outcome, damage: fin(damage), knockback: [fin(knockback[0]), fin(knockback[1]), fin(knockback[2])], stagger: fin(stagger), notes };
}
