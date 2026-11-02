// Wave V lane P: the FINAL symmetry step of the generation (Anatomy.finalSymmetryPass with
// BodyProfile.bilateralAsymmetry): the generated body is an exact mirror before the step, the PHYSICS
// tree stays that mirror after it, and the rendered skin carries a small, seeded, area-preserving,
// natural asymmetry (a dominant arm, a support leg, one fuller cheek) with the joints untouched.
import { anatomyFor, finalSymmetryPass, MIRROR_TOLERANCE, pairDeviations } from "../src/graphics/body/Anatomy.ts";
import {
  ASYMMETRY_GAIN, ASYMMETRY_MAX, bilateralAsymmetry, pairScales, RIGHT_HANDED_SHARE,
} from "../src/game/BodyProfile.ts";
import type { BodySpec, Primitive, SdfNode } from "../src/graphics/body/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const spec = (race: string, height: number, weight: number, sex: "male" | "female", seed = 7) =>
  ({ race, subrace: null, className: "Warrior", height, weight, seed, sex }) as BodySpec;
const prims = (n: SdfNode, out = new Map<string, Primitive>()) => {
  if (n.type === "primitive") out.set(n.primitive.id, n.primitive); else n.children.forEach((c) => prims(c, out));
  return out;
};

Deno.test("symmetry step: the raw body is already a mirror; the PHYSICS tree is untouched; the bones never move", () => {
  for (const [race, h, w, sex] of [["human", 1.7, 72, "male"], ["elf", 1.77, 60, "female"], ["dwarf", 1.39, 70, "female"], ["ork", 1.95, 120, "male"]] as const) {
    const raw = anatomyFor(spec(race, h, w, sex), { symmetryPass: false }), after = anatomyFor(spec(race, h, w, sex));
    const devs = pairDeviations(raw.root), worst = Math.max(...devs.map((d) => d.dev));
    console.log(`${race} ${sex}: ${devs.length} left/right pairs, mirror deviation before ${worst.toExponential(2)}, scaled ${after.symmetry.scaled}, dominant ${after.symmetry.asymmetry?.dominant}`);
    assert(devs.length >= 40 && worst <= MIRROR_TOLERANCE, `${race}: pairs ${devs.length}, deviation ${worst}`);
    assert(JSON.stringify(after.root) === JSON.stringify(raw.root), `${race}: the physics tree changed`);
    assert(JSON.stringify(after.bones) === JSON.stringify(raw.bones), `${race}: a bone moved`);
    assert(after.armAbduction === raw.armAbduction && after.legAbduction === raw.legAbduction, `${race}: the solved abductions changed`);
    assert(after.skinRoot !== after.root && after.symmetry.scaled > 0, `${race}: no asymmetry on the skin`);
  }
});

Deno.test("symmetry step: seeded natural asymmetry — bounded, deterministic, a dominant (weapon) arm, area-preserving pairs", () => {
  const N = 4000;
  let right = 0;
  for (let k = 0; k < N; k++) {
    const a = bilateralAsymmetry(17 + 7919 * k), b = bilateralAsymmetry(17 + 7919 * k);
    assert(JSON.stringify(a) === JSON.stringify(b), "deterministic per seed");
    if (a.dominant === "R") right++;
    for (const key of ["arm", "foreArm", "chest", "thigh", "shin", "face"] as const) assert(Math.abs(a[key]) <= ASYMMETRY_MAX + 1e-12, `${key} ${a[key]}`);
    // The dominant side's arm is the fuller one (δ > 0 = left fuller).
    assert(Math.sign(a.arm) === (a.dominant === "L" ? 1 : -1) && Math.abs(a.arm) >= 0.008, `arm ${a.arm} vs dominant ${a.dominant}`);
    assert(ASYMMETRY_GAIN.foreArm !== 0 || a.foreArm === 0, "the forearm pair stays a mirror (the ragdoll's 2 % weld floor)");
  }
  const share = right / N;
  console.log(`right-handed share ${share.toFixed(3)} (target ${RIGHT_HANDED_SHARE})`);
  assert(Math.abs(share - RIGHT_HANDED_SHARE) < 0.03, `right-handed share ${share}`);
  for (const d of [0.02, -0.013, 0.004, 0]) {
    const [l, r] = pairScales(d);
    assert(Math.abs(l * l + r * r - 2) < 1e-12, `pair ${d}: ${l}² + ${r}² ≠ 2`);
    assert(d === 0 ? l === 1 && r === 1 : (d > 0) === (l > r), `pair ${d}: the wrong side is fuller`);
  }
});

Deno.test("symmetry step: the skin's dominant upper arm is fuller by exactly 1+|δ|; hands, feet and soles stay exact mirrors", () => {
  const plan = anatomyFor(spec("human", 1.7, 72, "male", 11));
  const a = plan.symmetry.asymmetry!;
  const base = prims(plan.root), skin = prims(plan.skinRoot);
  const domArm = a.dominant === "L" ? "upperArmL" : "upperArmR", offArm = a.dominant === "L" ? "upperArmR" : "upperArmL";
  const k = skin.get(domArm)!.r / base.get(domArm)!.r, ko = skin.get(offArm)!.r / base.get(offArm)!.r;
  console.log(`seed 11: dominant ${a.dominant}, arm δ ${(100 * a.arm).toFixed(2)} %, upper-arm radius ×${k.toFixed(4)} / ×${ko.toFixed(4)}`);
  assert(Math.abs(k - (1 + Math.abs(a.arm))) < 1e-9 && Math.abs(k * k + ko * ko - 2) < 1e-9, `arm scales ${k} / ${ko}`);
  for (const [id, p] of base) {
    if (!/(L|R)$/.test(id)) continue;
    if (p.region === "hand" || p.region === "foot" || p.region === "sole" || p.region === "ear" || p.region === "foreArm") {
      assert(JSON.stringify(skin.get(id)) === JSON.stringify(p), `${id} (${p.region}) changed`);
    }
  }
  // The shin keeps its exact ankle end (the taper): the shin cone's distal radius is untouched.
  for (const s of ["L", "R"]) assert(skin.get(`shin${s}`)!.r2 === base.get(`shin${s}`)!.r2, `shin${s} ankle radius changed`);
});

Deno.test("symmetry step: a non-mirrored pair is made a mirror before the asymmetry (the enforcement works)", () => {
  const plan = anatomyFor(spec("human", 1.7, 72, "male"), { symmetryPass: false });
  // Break one pair on purpose: the left biceps 5 % fatter and 4 mm forward.
  const broken = JSON.parse(JSON.stringify(plan.root)) as SdfNode;
  const bl = prims(broken).get("bicepsL")!;
  bl.r *= 1.05; if (bl.size) bl.size = [bl.size[0] * 1.05, bl.size[1] * 1.05, bl.size[2] * 1.05]; bl.a = [bl.a[0], bl.a[1], bl.a[2] + 0.004];
  const out = finalSymmetryPass(broken, plan.bones, null);
  const after = pairDeviations(out.mirrored);
  console.log(`broken pair: deviation before ${out.record.mirrorDeviationBefore.toFixed(4)}, after ${Math.max(...after.map((d) => d.dev)).toExponential(2)}`);
  assert(out.record.mirrorDeviationBefore > 0.01, "the break should be measured");
  assert(Math.max(...after.map((d) => d.dev)) <= 1e-12, "the mirror should be enforced");
});
