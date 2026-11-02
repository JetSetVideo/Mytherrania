// Wave V lane B: joint forms (src/graphics/body/AnatomyParts.ts). The limbs waist between muscle masses
// at the elbow and knee instead of tapering as one tube; the masses are REDISTRIBUTED (each segment's
// physics volume — the hard union of its positive primitives, Hitboxes' rule — is kept); grooves are
// cutters (no positive primitive); the thigh's frontal outline (the leg-gap solve's input) is kept;
// and referenceForms rebuilds the exact pre-wave parts. The torso is pre-wave by design (see torsoNode).
import {
  armGains, armNode, boneVolumes, FOREARM_MASS_BIAS, legGains, legNode, neckNode, positiveNodes, referenceForms,
} from "../src/graphics/body/AnatomyParts.ts";
import { proportionsFor } from "../src/graphics/body/Proportions.ts";
import { boneIndex, compileSdf } from "../src/graphics/body/Sdf.ts";
import type { BodySpec, SdfNode, SdfSample, Vec3 } from "../src/graphics/body/contracts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const SPECS: BodySpec[] = [
  { race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 7, sex: "male" },
  { race: "elf", subrace: null, className: "Warrior", height: 1.75, weight: 56, seed: 7, sex: "female" },
  { race: "dwarf", subrace: null, className: "Warrior", height: 1.38, weight: 78, seed: 7, sex: "male" },
  { race: "ork", subrace: null, className: "Warrior", height: 1.98, weight: 118, seed: 7, sex: "male" },
];

Deno.test("forms: mass neutral per segment, measured the way the ragdoll measures it (positive-primitive solid)", () => {
  const sb = boneIndex("shoulderL"), eb = boneIndex("elbowL"), hb = boneIndex("hipL"), kb = boneIndex("kneeL");
  for (const spec of SPECS) {
    const P = proportionsFor(spec), step = P.cell / 2;
    const [u0, f0] = boneVolumes(armNode(P, 1, 0, { preWave: true }).node, step, [sb, eb]);
    const [u1, f1] = boneVolumes(armNode(P, 1, 0).node, step, [sb, eb]);
    const [t0, s0] = boneVolumes(legNode(P, 1, 0, { preWave: true }).node, step, [hb, kb]);
    const [t1, s1] = boneVolumes(legNode(P, 1, 0).node, step, [hb, kb]);
    const tag = `${spec.race}/${spec.sex}`;
    console.log(`  ${tag}: upper arm ${(100 * (u1 / u0 - 1)).toFixed(2)} %, forearm ${(100 * (f1 / f0 - 1)).toFixed(2)} % (bias ${FOREARM_MASS_BIAS}), thigh ${(100 * (t1 / t0 - 1)).toFixed(2)} %, shin ${(100 * (s1 / s0 - 1)).toFixed(2)} %; gains ${JSON.stringify(armGains(P))} ${JSON.stringify(legGains(P))}`);
    assert(Math.abs(u1 / u0 - 1) < 0.01, `${tag}: upper arm volume moved ${(100 * (u1 / u0 - 1)).toFixed(2)} %`);
    assert(Math.abs(f1 / (f0 * FOREARM_MASS_BIAS) - 1) < 0.015, `${tag}: forearm volume ${(100 * (f1 / f0 - 1)).toFixed(2)} % (target ${(100 * (FOREARM_MASS_BIAS - 1)).toFixed(0)} %)`);
    assert(Math.abs(t1 / t0 - 1) < 0.01, `${tag}: thigh volume moved ${(100 * (t1 / t0 - 1)).toFixed(2)} %`);
    assert(Math.abs(s1 / s0 - 1) < 0.01, `${tag}: shin volume moved ${(100 * (s1 / s0 - 1)).toFixed(2)} %`);
  }
});

/** Side-view (anterior + posterior) width of a limb field along its bone, by bisection from the axis. */
function sideWidths(node: SdfNode, root: Vec3, d: Vec3, f: Vec3, length: number, maxR: number, step: number): { s: number[]; w: number[] } {
  const F = compileSdf(node), smp: SdfSample = { d: 0, region: 0, bone: 0 };
  const exit = (p: Vec3, e: Vec3) => {
    let lo = 0, hi = maxR;
    if (F.sample(p[0], p[1], p[2], smp).d > 0) return 0;
    for (let r = step / 3; r < maxR; r += step / 3) if (F.sample(p[0] + e[0] * r, p[1] + e[1] * r, p[2] + e[2] * r, smp).d > 0) { hi = r; break; } else lo = r;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (F.sample(p[0] + e[0] * m, p[1] + e[1] * m, p[2] + e[2] * m, smp).d > 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  };
  const out = { s: [] as number[], w: [] as number[] };
  for (let s = 0.05 * length; s <= length; s += step / 2) {
    const p: Vec3 = [root[0] + d[0] * s, root[1] + d[1] * s, root[2] + d[2] * s];
    out.s.push(s);
    out.w.push(exit(p, f) + exit(p, [-f[0], -f[1], -f[2]]));
  }
  return out;
}
/** (smaller neighbouring belly peak − narrowest width at the joint) / narrowest width. */
function waist(p: { s: number[]; w: number[] }, sj: number, L1: number, L2: number): number {
  let neck = Infinity, a = -Infinity, b = -Infinity;
  p.s.forEach((s, i) => {
    if (s >= sj - 0.15 * L1 && s <= sj + 0.15 * L2) neck = Math.min(neck, p.w[i]);
    if (s >= sj - 0.75 * L1 && s <= sj - 0.1 * L1) a = Math.max(a, p.w[i]);
    if (s >= sj + 0.1 * L2 && s <= sj + 0.6 * L2) b = Math.max(b, p.w[i]);
  });
  return (Math.min(a, b) - neck) / neck;
}

Deno.test("forms: the elbow and the knee WAIST between muscle masses (side silhouette), the pre-wave tube barely did", () => {
  for (const spec of SPECS) {
    const P = proportionsFor(spec), c = P.cell, tag = `${spec.race}/${spec.sex}`;
    const arm = (pre: boolean) => {
      const { node, anchors } = armNode(P, 1, 0.3, { preWave: pre });
      return waist(sideWidths(node, anchors.shoulder, anchors.frame.d, anchors.frame.f, P.upperArm + P.foreArm, 3 * P.radius.deltoid, c), P.upperArm, P.upperArm, P.foreArm);
    };
    const leg = (pre: boolean) => {
      const { node, anchors } = legNode(P, 1, 0.05, { preWave: pre });
      const L = Math.hypot(anchors.ankle[0] - anchors.hip[0], anchors.ankle[1] - anchors.hip[1]);
      const T = Math.hypot(anchors.knee[0] - anchors.hip[0], anchors.knee[1] - anchors.hip[1]);
      return waist(sideWidths(node, anchors.hip, anchors.frame.d, anchors.frame.f, L, 3 * P.radius.thighTop, c), T, T, L - T);
    };
    const [a0, a1, l0, l1] = [arm(true), arm(false), leg(true), leg(false)];
    console.log(`  ${tag}: elbow waist ${a0.toFixed(3)} -> ${a1.toFixed(3)}, knee waist ${l0.toFixed(3)} -> ${l1.toFixed(3)}`);
    assert(a1 >= 0.15 && a1 > a0 + 0.1, `${tag}: elbow waist ${a0.toFixed(3)} -> ${a1.toFixed(3)}`);
    assert(l1 > l0 + 0.01, `${tag}: knee waist ${l0.toFixed(3)} -> ${l1.toFixed(3)}`);
  }
});

Deno.test("forms: grooves are cutters (no mass), blend widths are varied, the thigh's frontal outline is the pre-wave one", () => {
  const P = proportionsFor(SPECS[0]);
  const ids = (n: SdfNode) => positiveNodes(n).map((x) => (x as { primitive: { id: string } }).primitive.id);
  const arm = armNode(P, 1, 0.3).node, leg = legNode(P, 1, 0.05).node;
  assert(!ids(arm).includes("cubitalFossaL") && JSON.stringify(arm).includes("cubitalFossaL"), "the cubital fossa is a cutter");
  assert(!ids(leg).includes("poplitealL") && JSON.stringify(leg).includes("poplitealL"), "the popliteal hollow is a cutter");
  for (const id of ["bicepsTendonL", "olecranonL", "flexorL"]) assert(ids(arm).includes(id), `arm has ${id}`);
  for (const id of ["vastusMedialisL", "calfL", "calfLateralL"]) assert(ids(leg).includes(id), `leg has ${id}`);
  const ks = (n: SdfNode, out: Set<string> = new Set()) => { if (n.type === "op") { if (n.op === "smoothUnion") out.add(n.k.toFixed(5)); n.children.forEach((c) => ks(c, out)); } return out; };
  const pre = ks(armNode(P, 1, 0.3, { preWave: true }).node).size + ks(legNode(P, 1, 0.05, { preWave: true }).node).size;
  const post = ks(arm).size + ks(leg).size;
  assert(post >= pre + 3, `distinct limb blend widths ${pre} -> ${post}`);
  // The leg-gap solve probes the midplane between the thighs from below the crotch to the knee.
  const a = compileSdf(legNode(P, 1, 0.07).node), b = compileSdf(legNode(P, 1, 0.07, { preWave: true }).node), s: SdfSample = { d: 0, region: 0, bone: 0 };
  // The solve reads min over the probes of max(dLeft, dRight) — on the midplane both legs are mirror
  // images, so that is the min of one leg's distance: it must not move (< 1 µm; the anatomy-level
  // seed test in wave_v_body_improvise_test.ts pins the solved joints themselves).
  let minA = Infinity, minB = Infinity, worst = 0;
  for (let y = P.y.crotch - 0.35 * P.head; y > P.y.knee; y -= P.cell) {
    for (let z = -0.3 * P.head; z <= 0.3 * P.head; z += 0.5 * P.cell) {
      const da = a.sample(0, y, z, s).d, db = b.sample(0, y, z, s).d;
      minA = Math.min(minA, da); minB = Math.min(minB, db); worst = Math.max(worst, Math.abs(da - db));
    }
  }
  console.log(`  leg-gap probes: min distance ${(minB * 1000).toFixed(3)} -> ${(minA * 1000).toFixed(3)} mm; largest probe change ${(worst * 1000).toFixed(3)} mm (the vastus medialis, front)`);
  assert(Math.abs(minA - minB) < 1e-6, `the leg-gap solve's binding distance moved ${minB} -> ${minA}`);
  assert(worst < 0.001, `a midplane probe moved ${(worst * 1000).toFixed(2)} mm`);
});

Deno.test("forms: referenceForms rebuilds the exact pre-wave parts (the anatomy's cell refinement can count on them)", () => {
  for (const spec of SPECS) {
    const P = proportionsFor(spec);
    const same = (a: unknown, b: unknown, what: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${spec.race}: ${what} differs under referenceForms`);
    referenceForms(() => {
      same(armNode(P, 1, 0.3).node, armNode(P, 1, 0.3, { preWave: true }).node, "arm");
      same(legNode(P, -1, 0.05).node, legNode(P, -1, 0.05, { preWave: true }).node, "leg");
    });
    assert(JSON.stringify(armNode(P, 1, 0.3).node) !== JSON.stringify(armNode(P, 1, 0.3, { preWave: true }).node), "outside it the new forms build");
    // The torso is pre-wave by design (AnatomyParts.torsoNode); the neck's seeded blend is the only trunk geometry knob.
    assert(JSON.stringify(referenceForms(() => neckNode(P))) !== "", "the neck builds under referenceForms");
  }
});
