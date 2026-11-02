// Lane A: skin weights (sum 1, ≥ 1 influence, region-aware), the skinned cel materials, and
// the skinned humanoid rig (HumanoidRig contract, Humanoid's joint convention, sole tracking).
// @deno-types="@types/three"
import * as THREE from "three";
import { REGIONS, type MeshData } from "../src/graphics/body/contracts.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { boneIndex, BONE_IDS } from "../src/graphics/body/Sdf.ts";
import { boneClass, computeSkinWeights, REGION_BONE_CLASSES } from "../src/graphics/body/SkinWeights.ts";
import { CEL_SKINNED_SHADERS, createCelSkinnedMesh } from "../src/graphics/shaders/CelSkinned.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { defaultHumanoid, type JointName, type Skeleton } from "../src/game/Skeleton.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }

const SPEC = { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 21 };

Deno.test("skin weights: every vertex has ≥ 1 influence, weights sum to 1, root never used", () => {
  const body = generateBody(SPEC);
  const skin = computeSkinWeights(body.mesh, body.plan.bones);
  const n = body.mesh.positions.length / 3;
  assert(skin.skinIndex.length === n * 4 && skin.skinWeight.length === n * 4, "4 slots per vertex");
  for (let v = 0; v < n; v++) {
    let sum = 0, influences = 0;
    for (let s = 0; s < 4; s++) {
      const w = skin.skinWeight[v * 4 + s];
      assert(w >= 0 && w <= 1, `weight out of range at ${v}`);
      if (w > 0) {
        influences++;
        assert(skin.skinIndex[v * 4 + s] < body.plan.bones.length, "bone index out of range");
        assert(skin.skinIndex[v * 4 + s] !== boneIndex("root"), `vertex ${v} weighted to root`);
      }
      sum += w;
    }
    assert(influences >= 1, `vertex ${v} has no influence`);
    assert(Math.abs(sum - 1) < 1e-5, `vertex ${v} weights sum to ${sum}`);
  }
});

Deno.test("skin weights are region-aware and side-aware (a hand never takes torso weight)", () => {
  const body = generateBody(SPEC);
  const skin = computeSkinWeights(body.mesh, body.plan.bones);
  const n = body.mesh.positions.length / 3;
  let hands = 0, blended = 0;
  for (let v = 0; v < n; v++) {
    const region = REGIONS[body.mesh.region[v]];
    const x = body.mesh.positions[v * 3];
    for (let s = 0; s < 4; s++) {
      if (skin.skinWeight[v * 4 + s] === 0) continue;
      const id = BONE_IDS[skin.skinIndex[v * 4 + s]];
      assert(REGION_BONE_CLASSES[region].includes(boneClass(id)), `${region} vertex ${v} takes ${id}`);
      if (region === "hand" || region === "foot" || region === "sole") {
        assert(id.endsWith(x > 0 ? "L" : "R"), `${region} vertex ${v} at x=${x.toFixed(3)} takes ${id}`);
      }
    }
    if (region === "hand") hands++;
    if (skin.skinWeight[v * 4 + 1] > 0.05) blended++;
  }
  assert(hands > 20, `only ${hands} hand vertices`);
  assert(blended > 100, `joints should blend: only ${blended} vertices have a second influence`);
  // The rule can fail: a vertex labelled "hand" sitting ON the spine still gets only its elbow.
  const fake: MeshData = {
    positions: new Float32Array(body.plan.bones[boneIndex("spine")].head), normals: new Float32Array(3),
    indices: new Uint32Array(0), region: new Uint8Array([REGIONS.indexOf("hand")]), bone: new Uint8Array([boneIndex("elbowL")]),
  };
  const fw = computeSkinWeights(fake, body.plan.bones);
  assert(fw.skinIndex[0] === boneIndex("elbowL") && fw.skinWeight[0] === 1, `hand-on-spine got ${BONE_IDS[fw.skinIndex[0]]}`);
});

Deno.test("skinned cel shaders run three's skinning chunks and read paint without redeclaring it", () => {
  for (const src of [CEL_SKINNED_SHADERS.surfaceVertex, CEL_SKINNED_SHADERS.outlineVertex]) {
    for (const chunk of ["skinning_pars_vertex", "skinbase_vertex", "skinnormal_vertex", "skinning_vertex", "beginnormal_vertex", "begin_vertex"]) {
      assert(src.includes(`#include <${chunk}>`), `missing ${chunk}`);
    }
  }
  assert(!/attribute\s+vec3\s+color/.test(CEL_SKINNED_SHADERS.surfaceVertex), "color must not be redeclared");
  assert(/#ifdef USE_COLOR[\s\S]*vPaint = color/.test(CEL_SKINNED_SHADERS.surfaceVertex), "paint varying under USE_COLOR");
  assert(CEL_SKINNED_SHADERS.surfaceFragment.includes("celShade(baseColor * vPaint,"), "paint multiplies the base colour (before the shared cel lighting)");
  assert(CEL_SKINNED_SHADERS.surfaceFragment.includes("celShadow(") || CEL_SKINNED_SHADERS.surfaceFragment.includes("uShadowMap"), "skinned bodies receive the key light's shadow (G10)");
  // A two-bone skeleton binds both meshes; a painted geometry gets a white base.
  const b0 = new THREE.Bone(), b1 = new THREE.Bone();
  b0.add(b1); b1.position.y = 1; b0.updateMatrixWorld(true);
  const skel = new THREE.Skeleton([b0, b1]);
  const geo = new THREE.BoxGeometry(0.2, 1, 0.2);
  const count = geo.getAttribute("position").count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(0.5), 3));
  const cel = createCelSkinnedMesh(geo, skel, "#ff0000");
  assert(cel.surface.skeleton === skel && cel.outline.skeleton === skel, "both meshes share the skeleton");
  assert((cel.surface.material as THREE.ShaderMaterial).vertexColors === true, "painted surface uses vertex colours");
  assert((cel.surface.material as THREE.ShaderMaterial).uniforms.baseColor.value.getHex() === 0xffffff, "painted base is white");
  assert((cel.outline.material as THREE.ShaderMaterial).side === THREE.BackSide, "outline is an inverted hull");
});

const APPEARANCE: Appearance = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 72, hair: "#172128", eyes: "#2f6fb5", race: "human", subrace: null };

/** Pose every joint at `angles` (rest elsewhere = 0) and push it through the rig without easing. */
function pose(rig: ReturnType<typeof buildSkinnedHumanoid>, sk: Skeleton, angles: Partial<Record<JointName, number>>): void {
  for (const name of sk.jointNames()) { const j = sk.joint(name); j.angle = j.target = angles[name] ?? 0; }
  rig.update(sk, 0);
  rig.group.updateMatrixWorld(true);
}

/** Skinned (CPU) positions of every vertex in group space. */
function skinned(rig: ReturnType<typeof buildSkinnedHumanoid>): Float32Array {
  const pos = rig.skin.geometry.getAttribute("position");
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    rig.skin.applyBoneTransform(i, v.fromBufferAttribute(pos, i));
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}

Deno.test("skinned humanoid: HumanoidRig contract, one clean skin, painted, bones named like the pivots", () => {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), APPEARANCE, "fire", SPEC);
  assert(rig.group instanceof THREE.Group && typeof rig.update === "function" && typeof rig.setGrip === "function" && typeof rig.setEffect === "function", "HumanoidRig shape");
  const s = rig.meshStats;
  assert(s.boundaryEdges === 0 && s.nonManifoldEdges === 0 && s.components === 1, JSON.stringify(s));
  assert(rig.triangleCount > s.triangles, "triangleCount includes face parts and weapon");
  for (const name of defaultHumanoid().jointNames()) assert(rig.group.getObjectByName(name) instanceof THREE.Bone, `bone ${name}`);
  const color = rig.skin.geometry.getAttribute("color");
  assert(!!color && color.itemSize === 3 && color.count === rig.skin.geometry.getAttribute("position").count, "painted skin");
  assert(Math.abs(rig.soleOffset) < rig.plan.cell, `bind soleOffset ${rig.soleOffset}`);
  assert(rig.group.getObjectByName("grip") !== undefined, "weapon grip mounted");
  rig.setGrip(0.4, -0.2);
  const grip = rig.group.getObjectByName("grip")!;
  assert(Math.abs(grip.rotation.x - 0.4) < 1e-12 && Math.abs(grip.rotation.z + 0.2) < 1e-12, "setGrip drives the grip like Humanoid");
});

Deno.test("skinned humanoid follows Humanoid's joint convention and keeps the legs exactly bound", () => {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), APPEARANCE, "fire", SPEC);
  const sk = defaultHumanoid();
  const bind = rig.skin.geometry.getAttribute("position").array as Float32Array;
  // Wave X: the default stance turns each foot OUT (FootTurnout, 9°). The joint-convention check
  // is about the hinge angles, so it runs with the turn-out off; the turn-out itself is checked below.
  const toeOut = Float64Array.from(sk.legRoll.toeOut);
  sk.legRoll.toeOut.fill(0);
  pose(rig, sk, {});
  const rest = skinned(rig);
  // All angles 0: legs stay exactly in the bind pose (no display roll on the legs).
  let legMax = 0;
  for (let i = 0; i < rest.length / 3; i++) {
    if (bind[i * 3 + 1] > rig.plan.proportions.y.knee) continue;
    legMax = Math.max(legMax, Math.hypot(rest[i * 3] - bind[i * 3], rest[i * 3 + 1] - bind[i * 3 + 1], rest[i * 3 + 2] - bind[i * 3 + 2]));
  }
  assert(legMax < 1e-4, `legs moved ${legMax} m at zero angles`);
  // With the default turn-out the feet DO move (and only below the ankle-ish region: the knees stay).
  sk.legRoll.toeOut.set(toeOut);
  pose(rig, sk, {});
  const turned = skinned(rig);
  let footMax = 0, kneeMax = 0;
  for (let i = 0; i < turned.length / 3; i++) {
    const d = Math.hypot(turned[i * 3] - bind[i * 3], turned[i * 3 + 1] - bind[i * 3 + 1], turned[i * 3 + 2] - bind[i * 3 + 2]);
    if (bind[i * 3 + 1] < rig.plan.proportions.y.knee * 0.25) footMax = Math.max(footMax, d);
    else if (bind[i * 3 + 1] < rig.plan.proportions.y.knee && bind[i * 3 + 1] > rig.plan.proportions.y.knee * 0.8) kneeMax = Math.max(kneeMax, d);
  }
  assert(footMax > 0.01, `the default turn-out moves the toes (${footMax} m)`);
  assert(kneeMax < 1e-4, `the turn-out leaves the knees bound (${kneeMax} m)`);
  sk.legRoll.toeOut.fill(0);
  // Shoulder flexion −1.7 rad (the attack pose) swings the right hand FORWARD (+z), as in Humanoid.
  const handR = rig.plan.arms[1].palm;
  pose(rig, sk, { shoulderR: -1.7 });
  const attack = skinned(rig);
  let near = -1, best = Infinity;
  for (let i = 0; i < bind.length / 3; i++) {
    const d = Math.hypot(bind[i * 3] - handR[0], bind[i * 3 + 1] - handR[1], bind[i * 3 + 2] - handR[2]);
    if (d < best) { best = d; near = i; }
  }
  assert(attack[near * 3 + 2] > handR[2] + 0.4, `hand z ${attack[near * 3 + 2]} should be far forward of ${handR[2]}`);
  assert(attack[near * 3 + 1] > handR[1] + 0.3, "and raised");
});

Deno.test("soleOffset tracks the lowest sole point of the current pose", () => {
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), APPEARANCE, "fire", SPEC);
  const sk = defaultHumanoid();
  for (const angles of [{}, { kneeL: -0.3, kneeR: -0.3 }, { hipL: 0.55, hipR: -0.55, kneeL: -0.5, kneeR: -0.5, ankleL: -0.2, ankleR: -0.2 }] as Partial<Record<JointName, number>>[]) {
    pose(rig, sk, angles);
    const p = skinned(rig);
    let minY = Infinity;
    for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
    // soleOffset = −(lowest sole sample); the true lowest vertex may sit up to ~2 cells lower (a rim).
    assert(Math.abs(-rig.soleOffset - minY) < 2 * rig.plan.cell, `pose ${JSON.stringify(angles)}: soleOffset ${rig.soleOffset.toFixed(4)} vs lowest vertex ${minY.toFixed(4)}`);
  }
  // levelFeet keeps the sole flat in a bent-knee pose: the heel and toe sole samples at equal height.
  const level = buildSkinnedHumanoid(generateClassWeapon("Warrior"), APPEARANCE, "fire", SPEC, { levelFeet: true });
  pose(level, sk, { kneeL: -0.3, kneeR: -0.3 });
  const p = skinned(level);
  const heel = level.plan.legs[0].heelBack, toe = level.plan.legs[0].toeTip;
  const bind = level.skin.geometry.getAttribute("position").array as Float32Array;
  const nearest = (q: number[]) => {
    let k = 0, b = Infinity;
    for (let i = 0; i < bind.length / 3; i++) { const d = Math.hypot(bind[i * 3] - q[0], bind[i * 3 + 1] - 0, bind[i * 3 + 2] - q[2]); if (d < b) { b = d; k = i; } }
    return k;
  };
  const hy = p[nearest(heel) * 3 + 1], ty = p[nearest(toe) * 3 + 1];
  assert(Math.abs(hy - ty) < 0.02, `levelFeet: heel ${hy.toFixed(4)} vs toe ${ty.toFixed(4)}`);
});
