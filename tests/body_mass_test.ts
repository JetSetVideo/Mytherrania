// Lane S-B: the body measured — less slouch, shoulder/trapezius muscle, closer hip joints, a crotch
// pack, and the shoulder-to-hip hierarchy by race x sex. Every claim is a number in metres at a
// NAMED height, before -> after. Pure measurement on the real SDF / proportions.
//
// What SHIPPED: the slouch (the shoulder girdle squares forward over the hips) and the trapezius
// redistribution (the traps rise inward-and-up), plus the sex shoulder-to-hip hierarchy.
// What was DROPPED, with its numbers: the neck-top straighten, the hip-joint STANCE, the crotch pack
// and the deltoid mass — each moved a physical property a suite pins (the ragdoll's 2 % weld floor,
// the settled ground contact, or the planted-foot slide). The drop is asserted at the end.
import {
  CROTCH_PACK, SLOUCH_FWD_PER_HEAD, TRAP_ROOT_RISE_PER_HEAD, TRAP_ROOT_RISE_PRE_PER_HEAD,
  TRAP_TIP_RISE_PER_HEAD, TRAP_TIP_X_FRAC, neckNode, torsoNode,
} from "../src/graphics/body/AnatomyParts.ts";
import { HIP_JOINT_STANCE, proportionsFor } from "../src/graphics/body/Proportions.ts";
import { RACE_SILHOUETTE, SEX_CURVE, SEX_HIP_GAIN, SUBRACE_SILHOUETTE, type Sex } from "../src/game/BodyProfile.ts";
import { compileSdf } from "../src/graphics/body/Sdf.ts";
import type { BodySpec, SdfSample, SdfNode } from "../src/graphics/body/contracts.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

type Spec = BodySpec & { sex?: Sex };
const spec = (race: string, subrace: string | null, height: number, weight: number, sex?: Sex): Spec =>
  ({ race, subrace, className: "Warrior", height, weight, seed: 7, sex });

const RACES: [string, number, number][] = [["human", 1.7, 72], ["elf", 1.77, 60], ["dwarf", 1.39, 70], ["ork", 1.95, 120]];
const TRIANGLE_BUDGET = 12000;

/** -z (back) surface of an SDF along a ray at (x, y): bisection between an inside and an outside z. */
function backZ(node: SdfNode, x: number, y: number, zOut: number): number {
  const f = compileSdf(node), s: SdfSample = { d: 0, region: 0, bone: 0 };
  let lo = 0, hi = zOut;
  assert(f.sample(x, y, lo, s).d < 0, "the ray starts inside");
  assert(f.sample(x, y, hi, s).d > 0, "the ray ends outside");
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f.sample(x, y, mid, s).d < 0) lo = mid; else hi = mid; }
  return lo;
}

/** Top (+y) surface of an SDF along a ray at (x, z): highest y still inside. */
function topY(node: SdfNode, x: number, z: number, yIn: number, yOut: number): number {
  const f = compileSdf(node), s: SdfSample = { d: 0, region: 0, bone: 0 };
  assert(f.sample(x, yIn, z, s).d < 0, "the ray starts inside");
  assert(f.sample(x, yOut, z, s).d > 0, "the ray ends outside");
  let lo = yIn, hi = yOut;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f.sample(x, mid, z, s).d < 0) lo = mid; else hi = mid; }
  return lo;
}

Deno.test("slouch: the shoulder girdle squares FORWARD over the hips (the upper spine reads straighter)", () => {
  console.log(`slouch: SLOUCH_FWD_PER_HEAD ${SLOUCH_FWD_PER_HEAD} (girdle z = (-0.05 + fwd) · h)`);
  console.log("race   y.shoulder (m)  girdle-back z BEFORE (m)  AFTER (m)   forward (mm)");
  for (const [race, h, w] of RACES) {
    const P = proportionsFor(spec(race, null, h, w));
    const x = 0.85 * P.halfWidth.shoulderJoint, y = P.y.shoulder + 0.08 * P.head, zOut = -0.6 * P.head;
    const before = backZ(torsoNode(P, { slouchForwardPerHead: 0 }).node, x, y, zOut);
    const after = backZ(torsoNode(P).node, x, y, zOut);
    console.log(`${race.padEnd(6)} ${P.y.shoulder.toFixed(4)}       ${before.toFixed(5)}                 ${after.toFixed(5)}    ${((after - before) * 1000).toFixed(1)}`);
    assert(after > before + 1e-5, `${race}: the girdle must move FORWARD (straighter), got ${before} -> ${after} at y=${y.toFixed(4)} m`);
  }
});

Deno.test("trapezius: the traps rise over the shoulder line (redistribution, no radius gain)", () => {
  console.log(`trapezius: tip x frac ${TRAP_TIP_X_FRAC} of the shoulder half-width; rise root ${TRAP_ROOT_RISE_PRE_PER_HEAD} -> ${TRAP_ROOT_RISE_PER_HEAD} h, tip -> ${TRAP_TIP_RISE_PER_HEAD} h`);
  console.log("race   trap-top y BEFORE (m)  AFTER (m)   rise (mm)");
  for (const [race, h, w] of RACES) {
    const P = proportionsFor(spec(race, null, h, w));
    const xProbe = 0.5 * TRAP_TIP_X_FRAC * P.halfWidth.shoulderJoint, z = -0.11 * P.head;
    const yIn = P.y.shoulder, yOut = P.y.neckBase + 0.5 * P.head;
    const before = topY(torsoNode(P, { trapeziusPreWave: true }).node, xProbe, z, yIn, yOut);
    const after = topY(torsoNode(P).node, xProbe, z, yIn, yOut);
    console.log(`${race.padEnd(6)} ${before.toFixed(5)}              ${after.toFixed(5)}    ${((after - before) * 1000).toFixed(1)}`);
    assert(after > before + 1e-5, `${race}: the trap top must rise, got ${before} -> ${after} at y=${P.y.shoulder.toFixed(4)} m`);
  }
});

Deno.test("sex hierarchy: the shoulder-to-hip ratio is larger for boys, by a stated amount, across all races", () => {
  console.log(`sex hip gain: SEX_HIP_GAIN female ${SEX_HIP_GAIN.female} on top of SEX_CURVE.female.hip ${SEX_CURVE.female.hip} (male ${SEX_CURVE.male.hip})`);
  console.log("rank  ancestry  sex     shoulder (m)  hip (m)   shoulder/hip  vs male");
  const anc: [string, string | null, number, number][] = [
    ["human", null, 1.7, 72], ["imperial", "imperial", 1.7, 68], ["islander", "islander", 1.7, 80],
    ["elf", null, 1.77, 60], ["high", "high", 1.77, 58],
    ["dwarf", null, 1.39, 70], ["mountain", "mountain", 1.39, 74],
    ["ork", null, 1.95, 120], ["ironhide", "ironhide", 1.95, 128],
  ];
  const subRaceOf: Record<string, string> = { imperial: "human", islander: "human", high: "elf", mountain: "dwarf", ironhide: "ork" };
  const rows: { ancestry: string; sex: Sex; ratio: number; sh: number; hip: number }[] = [];
  for (const [raceOrSub, sub, h, w] of anc) {
    const race = sub ? subRaceOf[sub] : raceOrSub;
    for (const sex of ["male", "female"] as const) {
      const P = proportionsFor(spec(race, sub, h, w, sex));
      rows.push({ ancestry: sub ?? race, sex, ratio: P.halfWidth.shoulderJoint / P.halfWidth.hip, sh: P.halfWidth.shoulderJoint, hip: P.halfWidth.hip });
    }
  }
  for (const name of new Set(rows.map((r) => r.ancestry))) {
    const m = rows.find((r) => r.ancestry === name && r.sex === "male")!, f = rows.find((r) => r.ancestry === name && r.sex === "female")!;
    assert(m.ratio > f.ratio + 1e-6, `${name}: male shoulder/hip ${m.ratio.toFixed(4)} must exceed female ${f.ratio.toFixed(4)}`);
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  const maleRef: Record<string, number> = {};
  for (const r of rows) if (r.sex === "male") maleRef[r.ancestry] = r.ratio;
  rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(4)}  ${r.ancestry.padEnd(9)} ${r.sex.padEnd(7)} ${r.sh.toFixed(4)}       ${r.hip.toFixed(4)}   ${r.ratio.toFixed(4)}       ${r.sex === "female" ? (100 * (1 - r.ratio / maleRef[r.ancestry])).toFixed(1) + "% lower" : "(ref)"}`);
  });
  // The four races are all represented and the male ratio leads in every one.
  for (const race of ["human", "elf", "dwarf", "ork"]) {
    const m = rows.find((r) => r.ancestry === race && r.sex === "male")!, f = rows.find((r) => r.ancestry === race && r.sex === "female")!;
    assert(m.ratio > f.ratio, `${race}: male ratio leads`);
  }
  assert(RACE_SILHOUETTE.dwarf.shoulder === 0.5, "the dwarf shoulder ratio is still the pre-wave 0.5");
  assert(Object.keys(SUBRACE_SILHOUETTE).length > 0, "subraces are covered too");
});

Deno.test("invariants: bulky neutral, the sex leaves the ground contact + hip joint, and the triangle budget holds", () => {
  const HUMAN: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 };
  const bulky = proportionsFor(HUMAN, "bulky"), heavy = proportionsFor(HUMAN, "heavy");
  assert(bulky.buildRow.shoulder === 1.0 && bulky.buildRow.chest === 1.0 && bulky.buildRow.muscle === 1.0, "bulky is the neutral 1.0 on every build term");
  assert(heavy.halfWidth.chest > bulky.halfWidth.chest, "the build still scales the chest");
  for (const [race, h, w] of RACES) {
    const m = proportionsFor(spec(race, null, h, w, "male")), f = proportionsFor(spec(race, null, h, w, "female"));
    for (const k of ["ankle", "footHalfWidth", "heel"] as const) assert(m.radius[k] === f.radius[k], `${race}: radius.${k} moved by sex`);
    for (const k of ["thigh", "shin", "foot", "ankleHeight"] as const) assert(m[k] === f[k], `${race}: leg chain ${k} moved by sex`);
    assert(m.halfWidth.hipJoint === f.halfWidth.hipJoint, `${race}: the hip JOINT moved by sex`);
    assert(f.halfWidth.hip > m.halfWidth.hip, `${race}: the female hip is wider (curve + gain)`);
  }
  console.log("ancestry   triangles  (< 12000)");
  const all: [string, string | null, number][] = [["human", null, 1.7], ["imperial", "imperial", 1.7], ["nomad", "nomad", 1.7], ["islander", "islander", 1.7], ["elf", null, 1.77], ["high", "high", 1.77], ["wood", "wood", 1.77], ["dark", "dark", 1.77], ["dwarf", null, 1.39], ["mountain", "mountain", 1.39], ["forge", "forge", 1.39], ["deep", "deep", 1.39], ["ork", null, 1.9], ["greenhide", "greenhide", 1.9], ["ironhide", "ironhide", 1.9], ["bloodfang", "bloodfang", 1.9]];
  for (const [race, sub, h] of all) {
    const b = generateBody({ race, subrace: sub, className: "Warrior", height: h, weight: Math.round(24 * h * h), seed: 11 });
    console.log(`${(sub ?? race).padEnd(10)} ${String(b.stats.triangles).padStart(6)}`);
    assert(b.stats.triangles <= TRIANGLE_BUDGET, `${sub ?? race}: ${b.stats.triangles} triangles over ${TRIANGLE_BUDGET}`);
    assert(b.stats.components === 1, `${sub ?? race}: the skin is one piece (got ${b.stats.components})`);
  }
});

Deno.test("DROPPED asks, with numbers: the hip-joint stance, the crotch pack, the neck straighten, the deltoid", () => {
  // 1. Hip-joint STANCE — DROPPED (the planted-foot slide has no headroom).
  console.log(`DROPPED hip-joint stance: HIP_JOINT_STANCE ${HIP_JOINT_STANCE} (1 = pre-wave). Measured slide dwarf/mountain slash fresh: pre 5.54 mm, stance 0.98 -> 6.21 mm, 0.9 -> 9.19 mm (band 5.6).`);
  assert(HIP_JOINT_STANCE === 1, "the stance is the pre-wave 1.0 (dropped)");
  // 2. Crotch pack — DROPPED (only a <=8 % copy stayed green: ~2 mm, not a pack).
  const human = proportionsFor(spec("human", null, 1.7, 72));
  console.log(`DROPPED crotch pack: designed male ${(CROTCH_PACK.male.w * 2 * human.head * 1000).toFixed(0)} x ${(CROTCH_PACK.male.h * 2 * human.head * 1000).toFixed(0)} mm, female ${(CROTCH_PACK.female.w * 2 * human.head * 1000).toFixed(0)} x ${(CROTCH_PACK.female.h * 2 * human.head * 1000).toFixed(0)} mm; mid-size broke RAGDOLL GROUND (settle within 3 s), a <=8 % copy (~2 mm) stayed green — not a pack.`);
  assert(CROTCH_PACK.male.w > 0 && JSON.stringify(CROTCH_PACK.male) !== JSON.stringify(CROTCH_PACK.female), "the per-sex pack size is stated");
  // 3. Neck-top straighten — DROPPED (the forearm falls below the ragdoll 2 % weld floor).
  console.log("DROPPED neck straighten: moving the neck top back by 0.02·h moved elbowL 2.034 % -> 1.992 % of the body (2 % weld floor) -> 'welded light leaves: ...elbowL...'; even a 0.1·h move flips it. The slouch rides the shoulder girdle instead.");
  // 4. Deltoid mass — DROPPED (the shoulder seam has 2 mm of headroom).
  console.log("DROPPED deltoid mass: the ork half-guard trunk-skin travel is 54 mm against a 56.2 mm bound; any deltoid growth (lateral/along-arm/depth, or a bigger radius.deltoid) measured 56-61 mm, or split the elf mesh into 3 components. The shoulder mass rides the TRAPEZIUS redistribution instead.");
  assert(neckNode(human).type === "op", "the neck still builds and is unchanged (no straighten)");
  assert(TRAP_TIP_X_FRAC < 0.75 && TRAP_ROOT_RISE_PER_HEAD > TRAP_ROOT_RISE_PRE_PER_HEAD, "the trap redistribution (inward + up) is what shipped");
});
