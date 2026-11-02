// Lane A2: body polish measured on the POSED skinned mesh — the shoulder seam bands (no
// see-saw of trunk skin, no folded triangles when the arm turns), readable hands on both
// sides, visible ears (pointed for elves, outside the hair cap) and defined soles.
// @deno-types="@types/three"
import * as THREE from "three";
import { REGIONS, type BodySpec, type SkinData } from "../src/graphics/body/contracts.ts";
import { generateBody, meshPlan } from "../src/graphics/body/BodyMesh.ts";
import { BONE_IDS } from "../src/graphics/body/Sdf.ts";
import { boneClass, computeSkinWeights, REGION_BONE_CLASSES, shoulderBands } from "../src/graphics/body/SkinWeights.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { armNode, handNode, insideHairCap, THUMB_NOTCH_CELLS } from "../src/graphics/body/AnatomyParts.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName } from "../src/game/Skeleton.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }

const SPECS: Record<string, BodySpec> = {
  human: { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 },
  elf: { race: "elf", subrace: "wood", className: "Warrior", height: 1.77, weight: 60, seed: 7 },
  dwarf: { race: "dwarf", subrace: "mountain", className: "Warrior", height: 1.39, weight: 70, seed: 7 },
  ork: { race: "ork", subrace: "ironhide", className: "Warrior", height: 1.95, weight: 120, seed: 7 },
};
const appearanceOf = (s: BodySpec): Appearance => ({ body: "#4f8490", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#172128", eyes: "#2f6fb5", race: s.race, subrace: s.subrace });
/** Half the guard stance the engine blends in when the opponent is near (Animator guardIdleWeight 0.55). */
const HALF_GUARD: Partial<Record<JointName, number>> = { spine: 0.066, abdomen: 0.033, shoulderL: -0.47, shoulderR: -0.55, elbowL: -0.94, elbowR: -0.8 };

/** CPU-skinned positions of `rig` at `angles` (other joints 0) with the given weights. */
function posed(rig: ReturnType<typeof buildSkinnedHumanoid>, angles: Partial<Record<JointName, number>>, skin?: SkinData): Float32Array {
  const geo = rig.skin.geometry;
  if (skin) {
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skin.skinWeight, 4));
  }
  const sk = defaultHumanoid();
  for (const n of sk.jointNames()) { const j = sk.joint(n); j.angle = j.target = angles[n] ?? 0; }
  rig.update(sk, 0);
  rig.group.updateMatrixWorld(true);
  const pos = geo.getAttribute("position");
  const out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { rig.skin.applyBoneTransform(i, v.fromBufferAttribute(pos, i)); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  return out;
}

/** Shoulder metrics: max trunk-skin motion near the joints, and triangles turned inside out. */
function shoulderReport(rig: ReturnType<typeof buildSkinnedHumanoid>, region: Uint8Array, p: Float32Array): { trunkMove: number; folds: number } {
  const geo = rig.skin.geometry;
  const bind = geo.getAttribute("position").array as Float32Array, idx = geo.index!.array as Uint32Array;
  const h = rig.plan.proportions.head;
  const near = (v: number) => rig.plan.arms.some((a) => Math.hypot(bind[v * 3] - a.shoulder[0], bind[v * 3 + 1] - a.shoulder[1], bind[v * 3 + 2] - a.shoulder[2]) < 0.9 * h);
  let trunkMove = 0;
  for (let v = 0; v < bind.length / 3; v++) {
    const r = REGIONS[region[v]];
    if ((r === "torso" || r === "neck") && near(v)) trunkMove = Math.max(trunkMove, Math.hypot(p[v * 3] - bind[v * 3], p[v * 3 + 1] - bind[v * 3 + 1], p[v * 3 + 2] - bind[v * 3 + 2]));
  }
  // A fold: the posed face normal points against the bind normal carried by the nearest bone
  // motion (approximated by the average displacement-free rotation: compare with the bind normal
  // rotated by the shoulder's display roll is overkill — near the shoulder the skin only turns
  // ≤ 1 rad, so a posed normal opposite to the bind normal is a fold).
  let folds = 0;
  const n = (P: Float32Array, a: number, b: number, c: number) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!near(a)) continue;
    const nb = n(bind, a, b, c), np = n(p, a, b, c);
    if (nb[0] * np[0] + nb[1] * np[1] + nb[2] * np[2] < 0) folds++;
  }
  return { trunkMove, folds };
}

Deno.test("shoulder seam bands: trunk skin stays put and nothing folds when stocky arms turn (the old rule fails)", () => {
  for (const name of ["ork", "dwarf"]) {
    const spec = SPECS[name];
    const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), appearanceOf(spec), "fire", spec, { paint: false });
    const body = generateBody(spec);
    const h = rig.plan.proportions.head;
    for (const [pose, angles] of [["display", {}], ["half guard", HALF_GUARD]] as const) {
      const r = shoulderReport(rig, body.mesh.region, posed(rig, angles));
      assert(r.trunkMove < 0.2 * h, `${name} ${pose}: trunk skin near the shoulder moved ${(r.trunkMove * 1000).toFixed(0)} mm (h = ${(h * 1000).toFixed(0)} mm)`);
      assert(r.folds === 0, `${name} ${pose}: ${r.folds} folded triangles at the shoulder`);
    }
    // Control: the distance rule alone see-saws the trunk with the arm (> 0.25 h) — the check can fail.
    const old = shoulderReport(rig, body.mesh.region, posed(rig, {}, computeSkinWeights(body.mesh, body.plan.bones)));
    assert(old.trunkMove > 0.25 * h, `${name}: the distance rule should move the trunk (got ${(old.trunkMove * 1000).toFixed(0)} mm)`);
  }
});

Deno.test("seam-band weights stay a region-aware partition of unity", () => {
  const body = generateBody(SPECS.ork);
  const skin = computeSkinWeights(body.mesh, body.plan.bones, 4, { rootBands: shoulderBands(body.plan.proportions.radius.deltoid, body.plan.cell) });
  const n = body.mesh.positions.length / 3;
  let blended = 0;
  for (let v = 0; v < n; v++) {
    let sum = 0, hasSpine = false, hasShoulder = false;
    for (let s = 0; s < 4; s++) {
      const w = skin.skinWeight[v * 4 + s];
      if (w <= 0) continue;
      sum += w;
      const id = BONE_IDS[skin.skinIndex[v * 4 + s]];
      assert(REGION_BONE_CLASSES[REGIONS[body.mesh.region[v]]].includes(boneClass(id)), `${REGIONS[body.mesh.region[v]]} vertex ${v} takes ${id}`);
      if (id === "spine") hasSpine = true;
      if (id.startsWith("shoulder")) hasShoulder = true;
    }
    assert(Math.abs(sum - 1) < 1e-5, `vertex ${v} sums to ${sum}`);
    if (hasSpine && hasShoulder) blended++;
  }
  assert(blended > 50, `the seam should blend spine and shoulder over a band: ${blended} vertices`);
});

Deno.test("hands: palm, knuckles and a thumb that clears the fingers, mirror-identical on both sides", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const plan = anatomyFor(spec);
    const P = plan.proportions;
    for (const side of [1, -1] as const) {
      const arm = armNode(P, side, plan.armAbduction);
      const hand = handNode(P, side, arm.anchors.wrist, arm.anchors.frame);
      assert(hand.notch >= THUMB_NOTCH_CELLS * P.cell - 1e-9, `${name} ${side}: thumb notch ${(hand.notch * 1000).toFixed(0)} mm < ${THUMB_NOTCH_CELLS} cells`);
      assert(hand.halfW >= 1.5 * P.cell - 1e-9 && hand.halfT >= 0.6 * P.cell - 1e-9, `${name}: palm ${hand.halfW} × ${hand.halfT} below the grid floor`);
    }
    const body = generateBody(spec);
    const pos = body.mesh.positions;
    let left = 0, right = 0;
    for (let v = 0; v < pos.length / 3; v++) if (REGIONS[body.mesh.region[v]] === "hand") { if (pos[v * 3] > 0) left++; else right++; }
    assert(left >= 80 && left === right, `${name}: hand vertices L ${left} R ${right}`);
  }
});

/** Mean distance (m) from each vertex's mirror image (x -> -x) to the nearest vertex of the mesh. */
function meanMirrorDistance(pos: Float32Array, c: number): number {
  const n = pos.length / 3;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;
  for (let v = 0; v < n; v++) { const k = key(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(v); }
  let sum = 0;
  for (let v = 0; v < n; v++) {
    const x = -pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let best = c;
    const [i, j, k] = [Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      for (const u of grid.get(`${i + a},${j + b},${k + d}`) ?? []) best = Math.min(best, Math.hypot(pos[u * 3] - x, pos[u * 3 + 1] - y, pos[u * 3 + 2] - z));
    }
    sum += best;
  }
  return sum / n;
}

Deno.test("the skin is mirror-symmetric (left and right limbs are built and sampled alike)", () => {
  // Wave V lane P RESTATED this pin (it asserted the rendered skin is an exact mirror, which the
  // user asked to change): the PHYSICS body — plan.root, what the hitboxes and the ragdoll read —
  // keeps the pre-wave bound (< 1 % of a cell), and the RENDERED skin carries the seeded natural
  // asymmetry of Anatomy.finalSymmetryPass, bounded: measured 0.662 mm (2.4 % of the dwarf's 27.3 mm cell)
  // for seed 7; the bound is 6 % of a cell.
  const body = generateBody(SPECS.dwarf);
  const c = body.plan.cell;
  const physicsPlan: typeof body.plan = { ...body.plan, skinRoot: body.plan.root };
  const physics = meshPlan(physicsPlan).mesh;
  const phys = meanMirrorDistance(physics.positions, c), skin = meanMirrorDistance(body.mesh.positions, c);
  console.log(`mirror distance: physics ${(phys * 1000).toFixed(3)} mm, skin ${(skin * 1000).toFixed(3)} mm (cell ${(c * 1000).toFixed(1)} mm)`);
  assert(phys < 0.01 * c, `physics mean mirror distance ${(phys * 1000).toFixed(3)} mm`);
  assert(skin < 0.06 * c, `skin mean mirror distance ${(skin * 1000).toFixed(3)} mm`);
});

Deno.test("ears survive the grid on every race; elf ears are pointed and stand outside the hair cap", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const body = generateBody(spec);
    const pos = body.mesh.positions, n = pos.length / 3, P = body.plan.proportions, c = body.plan.cell;
    const face = body.plan.face;
    let ear = 0, outside = 0, top = -Infinity, earX = 0;
    let headX = 0;
    for (let v = 0; v < n; v++) {
      const r = REGIONS[body.mesh.region[v]];
      if (pos[v * 3] <= 0) continue;
      if ((r === "head" || r === "face") && Math.abs(pos[v * 3 + 1] - face.ear[0][1]) < c) headX = Math.max(headX, pos[v * 3]);
      if (r !== "ear") continue;
      ear++;
      earX = Math.max(earX, pos[v * 3]);
      top = Math.max(top, pos[v * 3 + 1]);
      if (pos[v * 3 + 1] > P.y.eye && !insideHairCap([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], face.skullCentre, face.skullRadii, 0)) outside++;
    }
    assert(ear >= 8, `${name}: only ${ear} ear vertices per side`);
    assert(earX - headX >= 0.5 * c, `${name}: the ear stands ${((earX - headX) * 1000).toFixed(0)} mm off the head (cell ${(c * 1000).toFixed(0)} mm)`);
    if (name === "elf") {
      assert(top - P.y.eye > 0.15 * P.head, `elf ear tip only ${((top - P.y.eye) * 1000).toFixed(0)} mm above the eye`);
      assert(outside >= 10, `elf ear: ${outside} vertices above the eye outside the hair cap`);
    }
  }
});

Deno.test("feet: sole pads give a flat, wide contact and an edge; the medial arch lifts", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const body = generateBody(spec);
    const pos = body.mesh.positions, n = pos.length / 3, P = body.plan.proportions, c = body.plan.cell;
    const leg = body.plan.legs[0], fw = P.radius.footHalfWidth;
    let contact = 0, zMin = Infinity, zMax = -Infinity, wall = 0, archMin = Infinity;
    for (let v = 0; v < n; v++) {
      if (pos[v * 3] <= 0 || pos[v * 3 + 1] > P.y.ankle) continue;
      const r = REGIONS[body.mesh.region[v]];
      if (Math.abs(pos[v * 3 + 1]) < 0.1 * c) { contact++; zMin = Math.min(zMin, pos[v * 3 + 2]); zMax = Math.max(zMax, pos[v * 3 + 2]); }
      if (r === "sole" && pos[v * 3 + 1] > 0.2 * c) wall++;
      const t = (pos[v * 3 + 2] - leg.heelBack[2]) / P.foot;
      if (t > 0.35 && t < 0.6 && pos[v * 3] < leg.ankle[0] - 0.5 * fw) archMin = Math.min(archMin, pos[v * 3 + 1]);
    }
    assert(contact >= 6 && zMax - zMin >= 0.6 * P.foot, `${name}: ${contact} sole vertices over ${((zMax - zMin) / P.foot * 100).toFixed(0)}% of the foot`);
    assert(wall >= 6, `${name}: only ${wall} sole-edge vertices above the floor`);
    assert(archMin > 0.25 * c, `${name}: the medial arch sits ${(archMin * 1000).toFixed(0)} mm off the ground`);
  }
});
