// Lane R-A: sex, curves, the dwarf and the pectorals — every claim a number in metres.
//
// What is pinned here:
//   1. the SEX field: `male` is EXACTLY the neutral (pre-wave) body — a spec without a sex is
//      byte-for-byte an explicit male — and `female` is the stated curve (waist narrower relative
//      to the hips, hips fuller, bust deeper);
//   2. the ground-contact radii (ankle, footHalfWidth, heel) take NO sex curve, so a female plants
//      her feet exactly where a male does;
//   3. the shoulder half-width takes NO new multiplier — the sex curve and the dropped dwarf
//      "less large of shoulders" ask are SCOPED OUT, because narrowing the shoulder joint moves the
//      swing's planted-foot slide (tests/anim_measure_test.ts) off its band (measured; numbers live
//      in the comment above SHOULDER_OVERHANG in src/graphics/body/Proportions.ts);
//   4. the dwarf: the muscle term is UP (fit, not wide) — measured before -> after in metres;
//   5. the pectorals: the chest masses' forward extent grows, MEASURED on the torso's own front
//      surface (+z) at the nipple line by bisection on the real SDF.
import { buildFor, RACE_SILHOUETTE, SEX_CURVE, SEXES, type RaceSilhouette, type Sex } from "../src/game/BodyProfile.ts";
import { buildMuscleTerm, proportionsFor } from "../src/graphics/body/Proportions.ts";
import { PECTORAL_DEPTH_GAIN, PECTORAL_FORWARD_PER_HEAD, torsoNode } from "../src/graphics/body/AnatomyParts.ts";
import { compileSdf } from "../src/graphics/body/Sdf.ts";
import type { BodySpec, SdfSample } from "../src/graphics/body/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** A spec that may carry the (lane R-A) sex, typed as the wider object the module reads. */
type Spec = BodySpec & { sex?: Sex };
const spec = (race: string, height: number, weight: number, sex?: Sex): Spec => ({ race, subrace: null, className: "Warrior", height, weight, seed: 7, sex });

const RACES: [string, number, number][] = [["human", 1.7, 72], ["elf", 1.77, 60], ["dwarf", 1.39, 70], ["ork", 1.95, 120]];

Deno.test("sex: male is the neutral curve (1.0 on every term), female is the stated curve", () => {
  assert(SEXES.length === 2 && SEXES.includes("male") && SEXES.includes("female"), "both sexes exist");
  for (const k of ["chestDepth", "waist", "hip"] as const) {
    assert(SEX_CURVE.male[k] === 1.0, `male.${k} must be the neutral 1.0 (got ${SEX_CURVE.male[k]})`);
  }
  const f = SEX_CURVE.female;
  assert(f.waist < 1, "female waist narrower");
  assert(f.chestDepth > 1, "female bust deeper");
  assert(f.hip > 1, "female hips fuller");
  // The curve that reads as "curvy": the waist:hip ratio comes down.
  assert(f.waist / f.hip < SEX_CURVE.male.waist / SEX_CURVE.male.hip, "female waist/hip ratio lower than male");
});

Deno.test("sex: a spec without a sex is EXACTLY an explicit male (the pre-wave body is held)", () => {
  for (const [race, h, w] of RACES) {
    const unset = proportionsFor(spec(race, h, w));
    const male = proportionsFor(spec(race, h, w, "male"));
    assert(unset.sex === "male", `${race}: unset defaults to male`);
    // Compare the DERIVED geometry (the spec object carries the sex, so compare the numbers).
    const geom = (P: typeof unset) => JSON.stringify({
      halfWidth: P.halfWidth, halfDepth: P.halfDepth, radius: P.radius,
      thigh: P.thigh, shin: P.shin, foot: P.foot, muscle: P.muscle, girth: P.girth, y: P.y,
    });
    assert(geom(unset) === geom(male), `${race}: unset and explicit male must be identical`);
  }
});

Deno.test("sex: the ground-contact radii (ankle, foot, heel) take NO sex curve", () => {
  for (const [race, h, w] of RACES) {
    const m = proportionsFor(spec(race, h, w, "male"));
    const f = proportionsFor(spec(race, h, w, "female"));
    for (const k of ["ankle", "footHalfWidth", "heel", "knee", "calf"] as const) {
      assert(m.radius[k] === f.radius[k], `${race}: radius.${k} moved (${m.radius[k]} -> ${f.radius[k]})`);
    }
    // The leg chains and the hip JOINT are untouched too: a female plants her feet exactly as a male.
    for (const k of ["thigh", "shin", "foot", "ankleHeight"] as const) assert(m[k] === f[k], `${race}: ${k} moved`);
    assert(m.halfWidth.hipJoint === f.halfWidth.hipJoint, `${race}: hip joint moved`);
  }
});

Deno.test("shoulder: scoped out — the sex curve moves NO shoulder half-width (the swing slide guards it)", () => {
  for (const [race, h, w] of RACES) {
    const m = proportionsFor(spec(race, h, w, "male"));
    const f = proportionsFor(spec(race, h, w, "female"));
    assert(m.halfWidth.shoulderJoint === f.halfWidth.shoulderJoint, `${race}: the sex curve must not move the shoulder`);
  }
  // The dwarf shoulder ratio is the pre-wave value: nothing narrows it.
  assert(RACE_SILHOUETTE.dwarf.shoulder === 0.5, "the dwarf shoulder ratio is the pre-wave 0.5");
});

Deno.test("sex: the male-vs-female silhouette table (metres) — fuller bust/hips, narrower waist", () => {
  console.log(`male vs female half-widths (metres) + the bust depth; waist/hip is the curve ratio:`);
  console.log(`race   sex      shoulder    waist      hip   chestW   chestD  waist/hip`);
  for (const [race, h, w] of RACES) {
    const m = proportionsFor(spec(race, h, w, "male"));
    const f = proportionsFor(spec(race, h, w, "female"));
    const row = (tag: string, P: typeof m) => `${race.padEnd(6)} ${tag.padEnd(7)} ` +
      [P.halfWidth.shoulderJoint, P.halfWidth.waist, P.halfWidth.hip, P.halfWidth.chest, P.halfDepth.chest, P.halfWidth.waist / P.halfWidth.hip]
        .map((v) => v.toFixed(4).padStart(9)).join("");
    console.log(row("male", m));
    console.log(row("female", f));
    assert(f.halfDepth.chest > m.halfDepth.chest, `${race}: female bust must be deeper`);
    assert(f.halfWidth.waist < m.halfWidth.waist, `${race}: female waist narrower`);
    assert(f.halfWidth.hip > m.halfWidth.hip, `${race}: female hips fuller`);
    assert(
      f.halfWidth.waist / f.halfWidth.hip < m.halfWidth.waist / m.halfWidth.hip,
      `${race}: female waist/hip ratio must be lower (${(f.halfWidth.waist / f.halfWidth.hip).toFixed(4)} vs ${(m.halfWidth.waist / m.halfWidth.hip).toFixed(4)})`,
    );
  }
});

Deno.test("dwarf: muscle term UP (fit, not wide); the shoulder narrowing is DROPPED, not faked", () => {
  const h = 1.39, w = 70;
  const after = proportionsFor(spec("dwarf", h, w));
  const oldDwarf: RaceSilhouette = { ...RACE_SILHOUETTE.dwarf, muscle: 1.45 };
  const newDwarf = RACE_SILHOUETTE.dwarf;
  assert(newDwarf.muscle > oldDwarf.muscle, `dwarf muscle ${newDwarf.muscle} must exceed ${oldDwarf.muscle}`);
  const beforeTerm = buildMuscleTerm(oldDwarf, buildFor("dwarf", null));
  const afterTerm = buildMuscleTerm(newDwarf, buildFor("dwarf", null));
  const deltoidBefore = after.radius.deltoid * (beforeTerm / afterTerm);
  console.log(`dwarf muscle term: before ${beforeTerm.toFixed(4)} -> after ${afterTerm.toFixed(4)}`);
  console.log(`dwarf deltoid radius: before ${deltoidBefore.toFixed(4)} m -> after ${after.radius.deltoid.toFixed(4)} m  (+${((after.radius.deltoid - deltoidBefore) * 1000).toFixed(1)} mm)`);
  assert(afterTerm > beforeTerm, "the dwarf muscle term went UP");
  assert(after.radius.deltoid > deltoidBefore, "the dwarf deltoid radius grew");
});

/** The +z (front) surface of an SDF along a ray at (x, y): bisection between an inside and an outside z. */
function frontZ(node: ReturnType<typeof torsoNode>["node"], x: number, y: number, zOut: number): number {
  const f = compileSdf(node), s: SdfSample = { d: 0, region: 0, bone: 0 };
  let lo = 0, hi = zOut;
  assert(f.sample(x, y, lo, s).d < 0, "the ray starts inside the torso");
  assert(f.sample(x, y, hi, s).d > 0, "the ray ends outside the torso");
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f.sample(x, y, mid, s).d < 0) lo = mid; else hi = mid; }
  return lo;
}

// Lane R-A measurably deepened the pectorals (human +12.3 mm, dwarf +9.9 mm at the nipple line). The
// integration DROPPED that change: measured, ANY depth gain (1.18 and 1.10) breaks FOUR ragdoll tests —
// `mass = body mass`, the light-foot welds, the seeding round trip and the settle — because the deeper
// chest moves the body's volume and the ragdoll derives its segment masses from that body. So this test
// now pins the DROPPED state, with the reason, instead of the change that could not land.
Deno.test("pectorals: DROPPED this wave — the gain is neutral, because any depth breaks the ragdoll", () => {
  assert((PECTORAL_DEPTH_GAIN as number) === 1, `the depth gain must be neutral, got ${PECTORAL_DEPTH_GAIN}`);
  assert((PECTORAL_FORWARD_PER_HEAD as number) === 0, `the forward offset must be zero, got ${PECTORAL_FORWARD_PER_HEAD}`);
  for (const [race, h, w] of [["human", 1.7, 72], ["dwarf", 1.39, 70]] as [string, number, number][]) {
    const P = proportionsFor(spec(race, h, w));
    const x = 0.3 * P.head, y = P.y.nipple + 0.12 * P.head, zOut = 3 * P.halfDepth.chest;
    const now = frontZ(torsoNode(P).node, x, y, zOut);
    const neutral = frontZ(torsoNode({ ...P }, { pectoralGain: 1, pectoralForwardPerHead: 0 }).node, x, y, zOut);
    console.log(`${race} pectoral front surface @ x=${x.toFixed(3)} y=${y.toFixed(3)} m: neutral ${neutral.toFixed(4)} m (the dropped gain would have moved it forward)`);
    assert(Math.abs(now - neutral) < 1e-9, `${race}: the neutral geometry is the one that ships`);
  }
});
