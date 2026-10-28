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
import type { BodySpec, BoneId, MeshData, MeshStats, SkinData, Vec3 } from "./contracts.ts";
import { generateBody, type BodyMesh, type BodyTiming } from "./BodyMesh.ts";
import { computeSkinWeights } from "./SkinWeights.ts";
import { boneBindRoll, boneDisplayRoll, type DetailedAnatomy } from "./Anatomy.ts";
import { applyFaceMorph, buildFaceParts } from "./FaceParts.ts";
import { paintVertices } from "../paint/Layers.ts";
import { stackFor } from "../paint/Recipes.ts";
import { RIG_ROTATION_SIGN } from "../../game/anim/Rig.ts";

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
  /**
   * The palette colour painted as the garment (tunic + breeches) so two fighters stay
   * distinguishable. Default `appearance.body`. The engine overwrites `app.body` with the
   * blended SKIN tone, so it must pass the profile's original palette colour here.
   */
  garment?: string;
}

const DEFAULT_APPEARANCE: Appearance = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 70, hair: "#172128", beard: false, moustache: false, eyes: "#172128" };

/** Body spec of an appearance (race defaults to human; seed from its colours unless given). */
export function specFromAppearance(a: Appearance, className = "Warrior", birthsign: string | null = null, seed?: number): BodySpec {
  return {
    race: a.race ?? "human", subrace: a.subrace ?? null, className,
    height: a.height, weight: a.weight, birthsign,
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
export function paintSkin(mesh: MeshData, spec: BodySpec, a: Appearance, cell: number, garment: string = a.body): Float32Array {
  return paintVertices(mesh, stackFor({
    race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
    hair: a.hair, accent: a.accent, garment, height: spec.height, vertexSpacing: cell, seed: spec.seed,
  }));
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
  const skin = computeSkinWeights(body.mesh, body.plan.bones);
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
  const root = bones.get("root")!;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList); // inverses from the bind pose (group at identity)

  // The skin: one indexed geometry, one SkinnedMesh + its ink hull on the same skeleton.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skin.skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const paint = options.paint === false ? null
    : options.paint ? options.paint(mesh) : paintSkin(mesh, bodySpec, appearance, plan.cell, options.garment ?? appearance.body);
  if (paint) geometry.setAttribute("color", new THREE.Float32BufferAttribute(paint, 3));
  geometry.computeBoundingSphere();
  const cel = createCelSkinnedMesh(geometry, skeleton, appearance.body, { vertexColors: !!paint });
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
  const weaponMesh = buildWeaponMesh(weapon, element);
  weaponMesh.group.scale.setScalar(options.weaponScale ?? 1);
  grip.add(weaponMesh.group);
  triangleCount += weaponMesh.triangleCount;

  // Per-frame data, allocated once: the display roll per bone and a scratch joint rotation.
  const display = new Map<BoneId, THREE.Quaternion>();
  for (const seg of plan.bones) display.set(seg.id, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, boneDisplayRoll(plan, seg.id)));
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

  return {
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
    setEffect(strength: number, time: number): void { weaponMesh.setEffect(strength, time); },
    setGrip(pitch: number, roll: number): void { grip.rotation.x = pitch; grip.rotation.z = roll; },
    update(sk: GameSkeleton, dt: number): void {
      sk.update(dt);
      for (const jb of jointBones) {
        // `rot` is in RIG space (sign applied); levelFeet cancels the chain's rig rotation.
        let rot = jb.sign * sk.joint(jb.id).angle;
        if (jb.level) { rot = 0; for (const up of jb.level) rot -= (RIG_ROTATION_SIGN[up] ?? 1) * sk.joint(up).angle; }
        qJoint.setFromAxisAngle(jb.axis, rot);
        jb.bone.quaternion.copy(jb.rest);
        if (jb.roll) {
          const r = jb.roll.kind === "hip" ? sk.legRoll.hip[jb.roll.side] : sk.legRoll.ankle[jb.roll.side];
          if (r !== 0) jb.bone.quaternion.multiply(qRoll.setFromAxisAngle(Z_AXIS, r));
        }
        jb.bone.quaternion.multiply(qJoint);
      }
      applyFaceMorph(face, sk.face.face());
      soleOffset = measureSoles();
    },
  };
}
