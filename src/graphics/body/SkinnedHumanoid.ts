// Skinned humanoid (lane A, R03): ONE continuous SDF-generated skin on a THREE.Skeleton, a
// drop-in for Humanoid.buildHumanoid. It implements the existing HumanoidRig interface
// (group, triangleCount, setEffect, setGrip, update) plus `soleOffset` and `meshStats`.
//
// Frames: the group origin is the SOLE PLANE of the bind pose (model y = 0), +z forward,
// +x the character's left. Bones follow Humanoid.ts's pivot tree (spine at the top) and each
// frame apply `bone.quaternion = displayRoll · R_axis(joint.angle)` — the same axis, sign
// and rest offsets as Humanoid's `pivot.rotation.set(joint.angle, 0, 0)`; displayRoll is the
// shoulders' lowered abduction and the hips' stance (0 for every other bone).

// @deno-types="@types/three"
import * as THREE from "three";
import type { HumanoidRig } from "../Humanoid.ts";
import { buildWeaponMesh } from "../WeaponMesh.ts";
import { createCelSkinnedMesh } from "../shaders/CelSkinned.ts";
import { nameSeed } from "../../game/RaceAppearance.ts";
import type { Skeleton as GameSkeleton, JointName } from "../../game/Skeleton.ts";
import type { GeneratedWeapon } from "../../game/WeaponGen.ts";
import type { Element } from "../../game/Skills.ts";
import type { Appearance } from "../../game/Characters.ts";
import { type BodySpec, type BoneId, type MeshData, type MeshStats, REGIONS, type SkinData, type Vec3 } from "./contracts.ts";
import { generateBody, type BodyMesh, type BodyTiming } from "./BodyMesh.ts";
import { computeSkinWeights, MAX_INFLUENCES, shoulderBands } from "./SkinWeights.ts";
import { boneBindRoll, boneDisplayRoll, type DetailedAnatomy } from "./Anatomy.ts";
import { applyFaceMorph, buildFaceParts } from "./FaceParts.ts";
import { paintVertices } from "../paint/Layers.ts";
import { GARMENT_REGIONS, stackFor } from "../paint/Recipes.ts";
import { applyFormShade } from "../paint/FormShade.ts";
import { formGainsFor } from "./Improvise.ts";
import { RIG_ROTATION_SIGN } from "../../game/anim/Rig.ts";
import type { WeaponSpec } from "../../combat/contracts.ts";
import { buildWeaponModel } from "../weapons/WeaponModel.ts";
import { attachHands, type HandRigApi } from "./HandRig.ts";
import { createJointHelpers, creaseBands, creaseWeights, type JointHelper, syncJointHelpers } from "./JointHelpers.ts";
import { gripModeRotation, preferredGrip } from "../../game/weapons/Generate.ts";
import { toeOutYaw } from "../../game/anim/FootTurnout.ts";
import { kneeSwivel } from "../../game/anim/KneeOut.ts";
import { GUARD_KEY, gripPitchFor } from "../../game/anim/Swing.ts";
import { gripEuler, type V3t } from "../../game/PalmWeapon.ts";
import { gripRuleOf } from "../../game/GripStance.ts";
import { applyForearmTwist, GRIP_SUPINATION, handFrameInMount } from "../../combat/RigAdapter.ts";

/** What the skinned rig adds to HumanoidRig. */
export interface SkinnedExtras {
  /**
   * Height (m) of the group origin above the lowest sole point in the CURRENT pose (0 in
   * the bind pose; negative when a pose lifts the soles). Place the rig with
   * `group.position.y = groundY + soleOffset` and the lowest sole touches the ground.
   * Refreshed by every update().
   */
  readonly soleOffset: number;
  /** World position of the current pose's lowest sole point (QA). Writes and returns `out`. */
  lowestSoleWorld(out: THREE.Vector3): THREE.Vector3;
  /** Topology of the skin (R03 proof: boundaryEdges 0, nonManifoldEdges 0, components 1). */
  readonly meshStats: MeshStats;
  readonly plan: DetailedAnatomy;
  readonly bones: ReadonlyMap<BoneId, THREE.Bone>;
  readonly skin: THREE.SkinnedMesh;
  readonly outline: THREE.SkinnedMesh;
  /** Build timings of the body (ms; 0 when served from the cache). */
  readonly timing: BodyTiming;
  /**
   * Wave W (lane H): the fingered hands (render-only; the body's mitten is cut from the render index)
   * and the elbow/knee crease helper bones. QA surfaces.
   */
  readonly hands?: HandRigApi;
  readonly jointHelpers?: readonly JointHelper[];
}

/** Build options. */
export interface SkinnedHumanoidOptions {
  /**
   * Skin paint: per-vertex LINEAR RGB. Default: lane B's recipe for the spec
   * (`paintSkin`). `false` keeps the flat palette colour; a function overrides the recipe.
   */
  paint?: false | ((mesh: MeshData) => Float32Array);
  /**
   * Keep each foot parallel to the ground by replacing the ankle angle with −(spine +
   * abdomen + hip + knee). Off by default (exact Humanoid behaviour); lane C's foot IK owns
   * planting in the long run.
   */
  levelFeet?: boolean;
  /** Weapon scale (1 = its authored size in metres). */
  weaponScale?: number;
  /** A generated weapon (W06): drawn with the cel WeaponModel (real edges) instead of part boxes. */
  weaponSpec?: WeaponSpec;
  /**
   * The palette colour painted as the garment (tunic + breeches) so two fighters stay
   * distinguishable. Default `appearance.body`. The engine overwrites `app.body` with the
   * blended SKIN tone, so it must pass the profile's original palette colour here.
   */
  garment?: string;
  /**
   * Wave Y: the rig STANDS ON ITS OWN (the Creator preview, the portrait studio: buildPreviewRig) — nobody
   * runs the combat grip or the Animator on it. Then update() (a) applies the engine's weapon carry until a
   * caller takes the grip (setGrip), and (b) applies the knee-out (KneeOut.ts) on an undriven Skeleton too.
   * Off by default: a bare rig (tests, the ragdoll fixtures) keeps the plain Skeleton pose — the forearm
   * supination and the leg swivel are render-side bone edits the hinge-only ragdoll cannot seed from.
   */
  restPose?: boolean;
}

const DEFAULT_APPEARANCE: Appearance = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 70, hair: "#172128", beard: false, moustache: false, eyes: "#172128" };

/** Body spec of an appearance (race defaults to human; seed from its colours unless given). */
export function specFromAppearance(a: Appearance, className = "Warrior", birthsign: string | null = null, seed?: number): BodySpec {
  return {
    race: a.race ?? "human", subrace: a.subrace ?? null, className,
    height: a.height, weight: a.weight, birthsign,
    // Wave R: the sex rides from the profile's appearance onto the spec, which is the ONLY way the
    // female curve reaches the rendered body (lane R-A's stated caveat, closed here).
    sex: a.sex ?? null,
    seed: seed ?? nameSeed(`${a.race ?? "human"}|${a.subrace ?? ""}|${a.body}|${a.hair ?? ""}|${a.eyes}`),
  };
}

/**
 * Lane B's paint recipe for a generated body: race/sub-race/class/birth-sign layers, the
 * hair and accent colours, and the palette colour `Appearance.body` as the GARMENT (tunic +
 * breeches) — the equivalent of `subjectFromProfile(profile, { garment: true })`, so the two
 * fighters stay told apart by their palette. Patterns are clamped to the mesh's vertex
 * spacing (the polygoniser cell). Returns LINEAR RGB, 3 floats per vertex.
 */
export function paintSkin(mesh: MeshData, spec: BodySpec, a: Appearance, cell: number, garment: string = a.body, formShade = true): Float32Array {
  const rgb = paintVertices(mesh, stackFor({
    race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
    hair: a.hair, accent: a.accent, garment, height: spec.height, vertexSpacing: cell, seed: spec.seed,
  }));
  // Wave V (lane B): paint that follows the sculpted forms (grooves darker, bony points and worn cloth
  // paler) so the muscle forms read under the cel bands. See paint/FormShade.ts.
  return formShade ? applyFormShade(mesh, rgb, { cell, garment: garment ? GARMENT_REGIONS : [], regionGain: formGainsFor(spec.seed) }) : rgb;
}

/** Bodies already generated, keyed by spec (pure data; each rig still gets its own geometry). */
const BODY_CACHE = new Map<string, { body: BodyMesh; skin: SkinData }>();
/** How many generated bodies the cache keeps (two fighters + rematches + QA swaps). */
export const BODY_CACHE_SIZE = 8;

function cachedBody(spec: BodySpec): { body: BodyMesh; skin: SkinData; cached: boolean } {
  const key = JSON.stringify(spec);
  const hit = BODY_CACHE.get(key);
  if (hit) { BODY_CACHE.delete(key); BODY_CACHE.set(key, hit); return { ...hit, cached: true }; }
  const body = generateBody(spec);
  // Shoulder seam bands (lane A2): trunk skin medial to the shoulder no longer see-saws with the arm.
  const skin = computeSkinWeights(body.mesh, body.plan.bones, MAX_INFLUENCES, {
    rootBands: shoulderBands(body.plan.proportions.radius.deltoid, body.plan.cell),
  });
  BODY_CACHE.set(key, { body, skin });
  while (BODY_CACHE.size > BODY_CACHE_SIZE) BODY_CACHE.delete(BODY_CACHE.keys().next().value!);
  return { body, skin, cached: false };
}

const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A point on a sole, stored in its bone's BIND frame so the current pose can move it. */
interface SolePoint { chain: THREE.Bone[]; local: THREE.Vector3 }

/** Build the skinned, cel-shaded humanoid (see the module comment). */
export function buildSkinnedHumanoid(
  weapon: GeneratedWeapon,
  appearance: Appearance = DEFAULT_APPEARANCE,
  element: Element = "fire",
  spec?: BodySpec,
  options: SkinnedHumanoidOptions = {},
): HumanoidRig & SkinnedExtras {
  const bodySpec = spec ?? specFromAppearance(appearance);
  const { body, skin, cached } = cachedBody(bodySpec);
  const { plan, mesh } = body;
  const group = new THREE.Group();
  group.name = "skinned-humanoid";

  // Bones: world rest rotation W_b = W_parent · Rz(bindRoll_b); local position = W_parent⁻¹ (head_b − head_parent).
  const bones = new Map<BoneId, THREE.Bone>();
  const worldRest = new Map<BoneId, THREE.Quaternion>();
  const boneList: THREE.Bone[] = [];
  for (const seg of plan.bones) {
    const bone = new THREE.Bone();
    bone.name = seg.id;
    const roll = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, boneBindRoll(plan, seg.id));
    const parentQ = seg.parent ? worldRest.get(seg.parent)! : new THREE.Quaternion();
    const parentHead = seg.parent ? plan.bones.find((b) => b.id === seg.parent)!.head : [0, 0, 0] as Vec3;
    const offset = new THREE.Vector3(seg.head[0] - parentHead[0], seg.head[1] - parentHead[1], seg.head[2] - parentHead[2]);
    bone.position.copy(offset.applyQuaternion(parentQ.clone().invert()));
    bone.quaternion.copy(roll);
    worldRest.set(seg.id, parentQ.clone().multiply(roll));
    if (seg.parent) bones.get(seg.parent)!.add(bone); else group.add(bone);
    bones.set(seg.id, bone);
    boneList.push(bone);
  }
  // Per-frame data, allocated once: the display roll per bone (also the crease helpers' rest).
  const display = new Map<BoneId, THREE.Quaternion>();
  for (const seg of plan.bones) display.set(seg.id, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, boneDisplayRoll(plan, seg.id)));
  // Wave W (lane H): half-angle helper bones at the elbows and knees (render-only, JointHelpers.ts).
  const helpers = createJointHelpers(plan, bones, boneList, worldRest, display);
  const root = bones.get("root")!;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList); // inverses from the bind pose (group at identity)
  const crease = creaseWeights(skin.skinIndex, skin.skinWeight, helpers, mesh.positions, creaseBands(plan, helpers));

  // The skin: one indexed geometry, one SkinnedMesh + its ink hull on the same skeleton.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(crease.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(crease.skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const paint = options.paint === false ? null
    : options.paint ? options.paint(mesh) : paintSkin(mesh, bodySpec, appearance, plan.cell, options.garment ?? appearance.body);
  // Wave W (lane H): the hands are painted with the same recipe (no form shade: sub-cell curvature).
  const handPaint = options.paint === undefined
    ? (m: MeshData) => paintSkin(m, bodySpec, appearance, plan.cell, options.garment ?? appearance.body, false)
    : null;
  if (paint) geometry.setAttribute("color", new THREE.Float32BufferAttribute(paint, 3));
  geometry.computeBoundingSphere();
  // Wave X lane B: the sub-grid surface detail (CelSkinned BODY_DETAIL_GLSL): per vertex, garment vs skin
  // and the trunk (where the abs may show); the abs band comes from the physique sculpt's record.
  const garmentOn = !!paint && !!(options.garment ?? appearance.body);
  const surf = new Float32Array((mesh.positions.length / 3) * 2);
  for (let v = 0; v < mesh.region.length; v++) {
    const r = REGIONS[mesh.region[v]];
    surf[v * 2] = garmentOn && (GARMENT_REGIONS as readonly string[]).includes(r) ? 1 : 0;
    surf[v * 2 + 1] = r === "torso" || r === "pelvis" ? 1 : 0;
  }
  geometry.setAttribute("aSurface", new THREE.Float32BufferAttribute(surf, 2));
  const cel = createCelSkinnedMesh(geometry, skeleton, appearance.body, { vertexColors: !!paint, detail: true });
  const abs = plan.physique?.abs;
  if (abs) (cel.surface.material as THREE.ShaderMaterial).uniforms.uAbs.value.set(abs.yTop, abs.yBottom, abs.halfWidth, abs.frontZ);
  group.add(cel.group);
  let triangleCount = mesh.indices.length / 3;

  // Rigid parts on the head bone (its world rest rotation is the identity).
  const headBone = bones.get("head")!;
  const headSeg = plan.bones.find((b) => b.id === "head")!;
  const face = buildFaceParts(headBone, plan.face, headSeg.head, plan.proportions.head, appearance);
  triangleCount += face.triangleCount;

  // Weapon on the right forearm bone, at the grip point, in a mount that undoes the arm's
  // display roll so the grip frame matches Humanoid's (world-aligned with the arm at rest).
  const elbowR = bones.get("elbowR")!;
  const elbowSeg = plan.bones.find((b) => b.id === "elbowR")!;
  const gripAt = plan.arms[1].grip;
  const mount = new THREE.Group();
  mount.name = "grip-mount";
  mount.position.set(gripAt[0] - elbowSeg.head[0], gripAt[1] - elbowSeg.head[1], gripAt[2] - elbowSeg.head[2])
    .applyQuaternion(worldRest.get("elbowR")!.clone().invert());
  mount.rotation.z = -boneDisplayRoll(plan, "shoulderR");
  elbowR.add(mount);
  const grip = new THREE.Group();
  grip.name = "grip";
  grip.rotation.x = -0.35; // Humanoid's rest grip: blade up with a slight forward cant
  mount.add(grip);
  const weaponMesh = options.weaponSpec ? buildWeaponModel(options.weaponSpec, { element }) : buildWeaponMesh(weapon, element);
  // Generated weapons: the preferred grip (a dagger's reverse "ice-pick" grip) rotates the
  // weapon frame itself, so strike features (weapon-local) rotate with the mesh.
  if (options.weaponSpec) weaponMesh.group.rotation.set(...gripModeRotation(preferredGrip(options.weaponSpec)));
  weaponMesh.group.scale.setScalar(options.weaponScale ?? 1);
  grip.add(weaponMesh.group);
  triangleCount += weaponMesh.triangleCount;

  // Wave W (lane H): fingered hands. The body's mitten leaves the RENDER index (the body mesh, its
  // stats and the physics keep it); each hand is posed on the CPU from the live grip (HandRig.ts).
  const hands = attachHands({
    plan, bones, geometry, body: mesh, gripMount: mount, grip, weapon: weaponMesh.group,
    paint: handPaint, flatColour: appearance.body, outline: cel.outline,
  });
  triangleCount += hands.triangles - hands.cutTriangles;
  // levelFeet: each ankle's leg chain, precomputed so the frame loop builds no strings.
  const LEVEL_CHAIN: Partial<Record<JointName, JointName[]>> = {
    ankleL: ["spine", "abdomen", "hipL", "kneeL"], ankleR: ["spine", "abdomen", "hipR", "kneeR"],
  };
  const jointBones = plan.bones.filter((b) => b.id !== "root").map((b) => ({
    id: b.id as JointName, bone: bones.get(b.id)!, rest: display.get(b.id)!,
    axis: b.axis === "x" ? X_AXIS : b.axis === "y" ? Y_AXIS : Z_AXIS,
    level: options.levelFeet ? LEVEL_CHAIN[b.id as JointName] ?? null : null,
    // Skeleton -> rig sign (lane C, RIG_ROTATION_SIGN): hip/knee are -1 so "hip > 0 = thigh
    // forward" and "knee < 0 = shin back" render as written instead of mirrored.
    sign: RIG_ROTATION_SIGN[b.id as JointName] ?? 1,
    // Hip abduction / ankle counter-roll from the Animator (Skeleton.legRoll), applied about
    // the bone's Z outermost (hip Euler order ZYX), index 0 = left, 1 = right.
    roll: b.id === "hipL" ? { kind: "hip" as const, side: 0 } : b.id === "hipR" ? { kind: "hip" as const, side: 1 }
      : b.id === "ankleL" ? { kind: "ankle" as const, side: 0 } : b.id === "ankleR" ? { kind: "ankle" as const, side: 1 } : null,
  }));
  const qJoint = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();

  // Sole points: heel, ball (inner/outer) and toe tip of each foot, in their bone's bind frame.
  const chainOf = (id: BoneId): THREE.Bone[] => {
    const out: THREE.Bone[] = [];
    for (let b: THREE.Object3D | null = bones.get(id)!; b && b !== group; b = b.parent) out.unshift(b as THREE.Bone);
    return out;
  };
  const soles: SolePoint[] = [];
  for (const [i, leg] of plan.legs.entries()) {
    const s = i === 0 ? "L" : "R";
    const w = plan.proportions.radius.footHalfWidth;
    const pts: [BoneId, Vec3][] = [
      [`ankle${s}` as BoneId, [leg.ankle[0], 0, leg.heelBack[2] + 0.3 * plan.proportions.foot * 0.3]],
      [`ankle${s}` as BoneId, [leg.ball[0] + w * 0.7, 0, leg.ball[2]]],
      [`ankle${s}` as BoneId, [leg.ball[0] - w * 0.7, 0, leg.ball[2]]],
      [`toe${s}` as BoneId, [leg.toeTip[0], 0, leg.toeTip[2] - 0.04 * plan.proportions.foot]],
    ];
    for (const [bone, p] of pts) {
      const inv = new THREE.Matrix4().copy(bones.get(bone)!.matrixWorld).invert();
      soles.push({ chain: chainOf(bone), local: new THREE.Vector3(...p).applyMatrix4(inv) });
    }
  }
  const chainM = new THREE.Matrix4(), tmpV = new THREE.Vector3();
  /** The lowest sole point of the current pose in GROUP space (refreshed by measureSoles). */
  const lowestSole = new THREE.Vector3();
  const measureSoles = (): number => {
    let minY = Infinity;
    for (const sp of soles) {
      chainM.identity();
      for (const b of sp.chain) { b.updateMatrix(); chainM.multiply(b.matrix); }
      tmpV.copy(sp.local).applyMatrix4(chainM);
      if (tmpV.y < minY) { minY = tmpV.y; lowestSole.copy(tmpV); }
    }
    return -minY;
  };
  let soleOffset = measureSoles();
  const toeBones = ([[0, "ankleL", "hipL"], [1, "ankleR", "hipR"]] as const).map(([side, a, h]) => ({
    side, bone: bones.get(a)!, lateral: bones.get(h)!.position.x,
  }));
  const qToeG = new THREE.Quaternion(), qToeP = new THREE.Quaternion(), qToeY = new THREE.Quaternion();
  // Wave Y: the knee-out swivel (KneeOut.ts) per leg: hip, knee and ankle bones, and the hip's outward sign in the rig.
  const kneeLegs = ([[0, "hipL", "kneeL", "ankleL"], [1, "hipR", "kneeR", "ankleR"]] as const).map(([side, h, k, a]) => ({
    side, hip: bones.get(h)!, knee: bones.get(k)!, ankle: bones.get(a)!, out: bones.get(h)!.position.x < 0 ? -1 : 1,
  }));
  const kH = new THREE.Vector3(), kK = new THREE.Vector3(), kA = new THREE.Vector3(), kAx = new THREE.Vector3(), kU = new THREE.Vector3();
  const kO = new THREE.Vector3(), qKA = new THREE.Quaternion(), qKR = new THREE.Quaternion(), qKP = new THREE.Quaternion();
  /** Swivel each leg about its hip->ankle line so the knee sits `legRoll.kneeOut` of the leg outward; the foot keeps its world rotation. */
  const applyKneeOut = (sk: GameSkeleton): void => {
    const share = sk.legRoll.kneeOut;
    if (!share) return;
    for (const L of kneeLegs) {
      if (!(share[L.side] > 0)) continue;
      L.hip.updateWorldMatrix(true, true);
      L.hip.getWorldPosition(kH); L.knee.getWorldPosition(kK); L.ankle.getWorldPosition(kA);
      const legLen = kK.distanceTo(kH) + kA.distanceTo(kK);
      kAx.copy(kA).sub(kH).normalize();
      kU.copy(kK).sub(kH);
      kU.addScaledVector(kAx, -kU.dot(kAx));
      const s = kneeSwivel(share[L.side], legLen, kU.length());
      if (s === 0) continue;
      // Outward = the hip's own side of the rig (+x left), in the world.
      group.getWorldQuaternion(qKP);
      kO.set(L.out, 0, 0).applyQuaternion(qKP);
      const sign = kO.dot(kU.clone().crossVectors(kAx, kU)) >= 0 ? 1 : -1;
      L.ankle.getWorldQuaternion(qKA); // the foot's planted world rotation, kept
      qKR.setFromAxisAngle(kAx, sign * s);
      L.hip.parent!.getWorldQuaternion(qKP);
      // local' = P⁻¹·R·P·local: the world rotation R about an axis through the hip joint (the bone origin).
      L.hip.quaternion.premultiply(qKP.clone().invert().multiply(qKR).multiply(qKP));
      L.hip.updateWorldMatrix(false, true);
      L.knee.getWorldQuaternion(qKP);
      L.ankle.quaternion.copy(qKP.invert().multiply(qKA));
      L.ankle.updateWorldMatrix(false, true);
    }
  };

  // Wave Y: the rig's OWN carry (options.restPose). The engine sets the grip every frame (forearm supination + the swing
  // driver's wrist laid across the palm: SwingDriver.gripEulerOf); a surface that only calls update()
  // (the Creator preview, the portrait studio) used to show the build-time grip — rotation.x = −0.35
  // about the MOUNT's x with a pronated hand — which stood the blade up and BACK over the shoulder
  // (forward share −0.56, the tip 34-48 cm behind the grip) and the handle out of the palm. Until a caller
  // takes the grip (setGrip), a restPose rig's update() applies the engine's carry: the same supination, the same carry
  // wrist (Swing.gripPitchFor at GUARD_KEY.blade, a reverse dagger's blade down, a bow's limbs upright)
  // and the archetype's wrist band — so every surface holds the weapon the way the arena holds it.
  const carryRule = gripRuleOf(options.weaponSpec?.archetype);
  const carryReverse = options.weaponSpec ? preferredGrip(options.weaponSpec) === "reverse" : false;
  const carryBlade = carryReverse ? GUARD_KEY.blade + Math.PI : carryRule.carry === "upright-bow" ? 0 : GUARD_KEY.blade;
  let gripTaken = false, carryHand: [V3t, V3t, V3t] | null = null;
  const carryEuler: [number, number] = [0, 0];

  const rig: HumanoidRig & SkinnedExtras = {
    group,
    triangleCount,
    weaponNode: weaponMesh.group,
    get soleOffset() { return soleOffset; },
    /** World position of the lowest sole point (QA: compare with the floor under THAT point). */
    lowestSoleWorld(out: THREE.Vector3): THREE.Vector3 {
      group.updateMatrixWorld();
      return out.copy(lowestSole).applyMatrix4(group.matrixWorld);
    },
    meshStats: body.stats,
    plan,
    bones,
    skin: cel.surface,
    outline: cel.outline,
    timing: cached ? { anatomyMs: 0, polygonizeMs: 0, sampleMs: 0, meshBrushMs: 0, statsMs: 0, totalMs: 0, corners: 0 } : body.timing,
    hands,
    jointHelpers: helpers,
    // Wave H: the movable hair/beard masses, so the engine's SecondaryMotion can drive them with
    // the weather's wind and the head's own motion. Empty when the ancestry has no such mass.
    secondaryMasses: face.secondary,
    setEffect(strength: number, time: number): void { weaponMesh.setEffect(strength, time); },
    setGrip(pitch: number, roll: number): void {
      gripTaken = true; // the caller owns the grip from now on (wave Y: update() stops applying the rest carry)
      grip.rotation.x = pitch; grip.rotation.z = roll;
      // The joints are final by now (twist/guard ran): re-read the creases, re-close the hands.
      syncJointHelpers(helpers);
      hands.update();
    },
    update(sk: GameSkeleton, dt: number): void {
      sk.update(dt);
      for (const jb of jointBones) {
        // `rot` is in RIG space (sign applied); levelFeet cancels the chain's rig rotation.
        let rot = jb.sign * sk.joint(jb.id).angle;
        if (jb.level) { rot = 0; for (const up of jb.level) rot -= (RIG_ROTATION_SIGN[up] ?? 1) * sk.joint(up).angle; }
        qJoint.setFromAxisAngle(jb.axis, rot);
        jb.bone.quaternion.copy(jb.rest);
        if (jb.roll) {
          // Hip: abduction OUTERMOST (Euler ZYX, rest·Rz(roll)·Rx(pitch)). Ankle: counter-roll
          // INNERMOST (Euler XYZ, rest·Rx(pitch)·Rz(roll)) — the order that keeps a flat sole level
          // exactly: Rz(r)·Rx(φ)·[Rx(-φ)·Rz(-r)] = I (lane C2 measured ~2 cm planted-ball drift
          // on a 0.15 rad-abducted ork with the ankle roll applied outermost).
          const r = jb.roll.kind === "hip" ? sk.legRoll.hip[jb.roll.side] : sk.legRoll.ankle[jb.roll.side];
          if (jb.roll.kind === "hip") {
            if (r !== 0) jb.bone.quaternion.multiply(qRoll.setFromAxisAngle(Z_AXIS, r));
            jb.bone.quaternion.multiply(qJoint);
          } else {
            jb.bone.quaternion.multiply(qJoint);
            if (r !== 0) jb.bone.quaternion.multiply(qRoll.setFromAxisAngle(Z_AXIS, r));
          }
        } else {
          jb.bone.quaternion.multiply(qJoint);
        }
      }
      // Wave X: each foot turns OUT about the rig's vertical through its ankle (lane L's
      // FootTurnout; the game-side IK already plants the turned ball). local' = P⁻¹·Ry·P·local with
      // P the knee's rotation in RIG space, so the yaw is about the rig's up axis, not the shin.
      for (const t of toeBones) {
        const yaw = toeOutYaw(t.lateral, sk.legRoll.toeOut?.[t.side] ?? 0);
        if (yaw === 0) continue;
        t.bone.parent!.updateWorldMatrix(true, false);
        group.getWorldQuaternion(qToeG).invert();
        t.bone.parent!.getWorldQuaternion(qToeP);
        qToeG.multiply(qToeP); // P (rig space)
        qToeY.setFromAxisAngle(Y_AXIS, yaw);
        qToeP.copy(qToeG).invert().multiply(qToeY).multiply(qToeG);
        t.bone.quaternion.premultiply(qToeP);
      }
      // The knee-out rides the Animator's stance (a driven Skeleton) or a rig that stands on its own.
      if (sk.isDriven() || options.restPose) applyKneeOut(sk);
      if (options.restPose && !gripTaken) {
        applyForearmTwist(rig, sk.joint("elbowR").angle, GRIP_SUPINATION);
        carryHand ??= handFrameInMount(rig);
        const pitch = gripPitchFor(carryBlade, sk.joint("spine").angle, sk.joint("shoulderR").angle, sk.joint("elbowR").angle, carryReverse);
        gripEuler(carryHand, pitch, 0, carryRule.band, carryEuler);
        grip.rotation.x = carryEuler[0]; grip.rotation.z = carryEuler[1];
      }
      applyFaceMorph(face, sk.face.face());
      soleOffset = measureSoles();
      syncJointHelpers(helpers);
      hands.update();
    },
  };
  return rig;
}
