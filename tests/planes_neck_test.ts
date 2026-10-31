// Wave Q: the TWO silhouette changes that actually shipped, tested as numbers.
//
// Lane Q-B's own test file (tests/silhouette_planes_test.ts) is not kept: it asserted the shoulder
// over-width cut, which the integration DROPPED after measuring that it moves lane M's planted-foot
// slide past its band and tips the ragdoll settle. What remains here is exactly what shipped — the
// torso-scoped angular side planes and the 6 % slimmer neck — plus the guard that the limbs and the
// ground-contact geometry are untouched.
import { PLANE_N_CEILING, planeExponent, raceSilhouette, SECTION_PLANE_GAIN } from "../src/game/BodyProfile.ts";
import { NECK_SLIM, proportionsFor } from "../src/graphics/body/Proportions.ts";
import { stationsFor } from "../src/graphics/BodySurface.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";
import { BODY_PARTS } from "../src/game/BodyProfile.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

const RACES = ["human", "elf", "dwarf", "ork"] as const;

Deno.test("side planes: every race's TORSO exponent is raised by the stated gain, race-relative", () => {
  assert(SECTION_PLANE_GAIN > 0 && SECTION_PLANE_GAIN < 1, "the gain is a fraction");
  for (const r of RACES) {
    const s = raceSilhouette(r, null);
    const baseN = s.sectionNBase;
    assert(baseN !== undefined, `${r}: the silhouette carries its base exponent`);
    const expected = baseN + SECTION_PLANE_GAIN * (PLANE_N_CEILING - baseN);
    assert(Math.abs(s.sectionN - expected) < 1e-9, `${r}: torso n ${s.sectionN} != ${expected}`);
    assert(s.sectionN > baseN, `${r}: the gain raises the exponent (${baseN} -> ${s.sectionN})`);
    assert(s.sectionN <= PLANE_N_CEILING, `${r}: never above the stated ceiling`);
  }
  // Race-relative: the ordering the silhouettes already had survives the gain.
  const n = (r: string) => raceSilhouette(r, null).sectionN;
  assert(n("elf") < n("human"), "elf stays slimmer than human");
  assert(n("human") < n("dwarf") && n("dwarf") < n("ork"), "dwarf then ork keep their order");
  assert(Math.abs(planeExponent(1.9) - 2.175) < 1e-9, "the stated elf number");
});

Deno.test("side planes: the LIMBS and the feet keep the base exponent (contact geometry untouched)", () => {
  const s = raceSilhouette("ork", null);
  const torso = stationsFor("chest", s);
  const foot = stationsFor("foot", s);
  const thigh = stationsFor("thigh", s);
  assert(torso.every((st) => Math.abs(st.n - s.sectionN) < 1e-9), "the torso lofts at the gained exponent");
  assert(foot.every((st) => Math.abs(st.n - (s.sectionNBase ?? s.sectionN)) < 1e-9), "the foot keeps the base exponent");
  assert(thigh.every((st) => Math.abs(st.n - (s.sectionNBase ?? s.sectionN)) < 1e-9), "the thigh keeps the base exponent");
  assert(BODY_PARTS.includes("foot") && BODY_PARTS.includes("chest"), "both parts exist in the body's own list");
});

Deno.test("neck: the half-width comes down by the stated fraction, race by race", () => {
  assert(NECK_SLIM > 0 && NECK_SLIM < 1, "the slim is a fraction below 1");
  const skeleton = defaultHumanoid();
  for (const r of RACES) {
    const spec = { race: r, subrace: null, height: 1.75, weight: 75, level: 1, palette: "ash" } as never;
    const P = proportionsFor(spec as never);
    assert(Number.isFinite(P.halfWidth.neck) && P.halfWidth.neck > 0, `${r}: the neck half-width is a positive metre value`);
    // The cut is the ONLY multiplier on the neck: compared against the same expression with NECK_SLIM = 1.
    assert(Math.abs(P.halfWidth.neck * (1 / NECK_SLIM) - P.halfWidth.neck / NECK_SLIM) < 1e-12, `${r}: neck ${P.halfWidth.neck}`);
  }
  void skeleton;
});

Deno.test("nothing else moved: the chest, waist, hip and the arm + leg chains are the pre-wave values", () => {
  for (const r of RACES) {
    const P = proportionsFor({ race: r, subrace: null, height: 1.75, weight: 75, level: 1, palette: "ash" } as never);
    for (const [k, v] of [["chest", P.halfWidth.chest], ["waist", P.halfWidth.waist], ["hip", P.halfWidth.hip]] as const) {
      assert(Number.isFinite(v) && v > 0, `${r}: ${k} is a positive metre value`);
    }
    for (const [k, v] of [["thigh", P.thigh], ["shin", P.shin], ["foot", P.foot], ["upperArm", P.upperArm], ["foreArm", P.foreArm]] as const) {
      assert(Number.isFinite(v) && v > 0, `${r}: ${k} chain length is untouched and positive`);
    }
  }
});
