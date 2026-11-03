// Hand rig (wave W, lane H): mounts the fingered hands (Hands.ts) on a skinned humanoid and poses them
// from the live grip. THREE-side glue; the geometry and the solver are pure (Hands.ts).
//
// What it does to the body:
//   * the body skin's MITTEN is cut out of the RENDERED index only (triangles of the forearm bone past
//     the wrist plane); the body mesh data, its topology stats, the anatomy plan and so the physics
//     (hitboxes, ragdoll masses, the 2 % weld floor) are untouched;
//   * each hand is a small cel mesh in a mount on the forearm bone (the body's hand was rigid on that
//     bone too), at the hand frame of the anatomy (RigAdapter.handFrameBind: d, n, w);
//   * the weapon hand closes on the weapon's handle: its line is read from the grip mount → grip →
//     weapon node chain (all children of the same forearm bone, so the forearm twist cancels) and the
//     pose is re-solved only when the grip's Euler changes (cached);
//   * the off hand stays relaxed unless its grip anchor comes within reach of the handle (a two-handed
//     hold once the anim lane brings it there): then it closes too.
// @deno-types="@types/three"
import * as THREE from "three";
import type { MeshData, Vec3 } from "./contracts.ts";
import { REGIONS } from "./contracts.ts";
import type { DetailedAnatomy } from "./Anatomy.ts";
import { HAND_PRONATION } from "./AnatomyParts.ts";
import { boneIndex } from "./Sdf.ts";
import {
  buildHandMesh, contactReport, type ContactReport, gripPose, type HandleLine, type HandMesh, type HandPose,
  handSize, type HandSize, handTriangleCount, NAIL_REGION, relaxedPose, type WristRim, writeHand,
} from "./Hands.ts";
import { createCelMesh } from "../shaders/CelShader.ts";
import { CEL_OUTLINE_WIDTH } from "../shaders/CelSkinned.ts";

/** How far (along the hand axis, × hand length) before the wrist the body skin is cut. */
export const WRIST_CUT = 0.02;
/** Ink hull width of the hand meshes: × the middle finger's radius, clamped (m). */
export const HAND_INK_PER_FINGER = 0.35;
export const HAND_INK_MIN = 0.003;
export const HAND_INK_MAX = 0.008;
/** The off hand closes on the handle only when its grip anchor is this close to the handle line (× palm half-width). */
export const OFF_HAND_REACH = 0.9;

export interface HandRigApi {
  /** Hand sizes [left, right]. */
  readonly size: [HandSize, HandSize];
  /** The weapon's handle radius at the grip (m, measured from the weapon mesh). */
  readonly handleRadius: number;
  /** Triangles of both hands. */
  readonly triangles: number;
  /** Body-skin triangles cut away (the two mittens). */
  readonly cutTriangles: number;
  /** The live pose of hand i (0 left, 1 right). */
  pose(i: 0 | 1): HandPose;
  /** The weapon handle in hand i's local frame (null: none in reach). */
  liveHandle(i: 0 | 1): HandleLine | null;
  /** Contact numbers of hand i's live pose (null when it holds nothing). */
  liveContact(i: 0 | 1): ContactReport | null;
  /** QA: the right hand's handle at `deg` to the fingers, in the hand plane, through the grip anchor. */
  handleAt(deg: number): HandleLine;
  /** QA: a fresh mesh of hand i in `pose` (hand-local). */
  meshFor(i: 0 | 1, pose: HandPose): HandMesh;
  /** Painted colours of hand i (linear RGB per vertex; flat when the body is unpainted). */
  colours(i: 0 | 1): Float32Array;
  /** Model (bind) → right-hand-local, point and normal. */
  toLocal(p: Vec3, n: Vec3): [Vec3, Vec3];
  /** The hands' surface meshes (QA). */
  readonly meshes: [THREE.Mesh, THREE.Mesh];
  /** Re-pose from the current grip (cheap when nothing changed). */
  update(): void;
}

export interface HandRigInput {
  plan: DetailedAnatomy;
  bones: ReadonlyMap<string, THREE.Bone>;
  /** The body skin's render geometry (its index is cut here) and its bind data. */
  geometry: THREE.BufferGeometry;
  body: MeshData;
  /** The grip mount, the grip group and the weapon node (all under elbowR). */
  gripMount: THREE.Object3D;
  grip: THREE.Object3D;
  weapon: THREE.Object3D;
  /**
   * The body's ink hull. It gets its own geometry (shared skin, normals and index; its own positions):
   * near the cut the hull sinks so the thick body ink tapers out at the wrist instead of ending in a
   * black collar (see wristHullGeometry).
   */
  outline?: THREE.SkinnedMesh;
  /** Paint the hand mesh (model-space MeshData with REGIONS codes) or null for a flat colour. */
  paint: ((mesh: MeshData) => Float32Array) | null;
  flatColour: string;
}

const HAND = REGIONS.indexOf("hand"), NAIL = REGIONS.indexOf("nail");

/** The bind hand frame of arm i in model space: X = d, Y = n, Z = d × n, origin the wrist. */
export function handBasis(plan: DetailedAnatomy, i: 0 | 1): { X: Vec3; Y: Vec3; Z: Vec3; o: Vec3; thumb: 1 | -1 } {
  const F = plan.arms[i].frame, cp = Math.cos(HAND_PRONATION), sp = Math.sin(HAND_PRONATION);
  const X = F.d;
  const Y: Vec3 = [F.o[0] * cp + F.f[0] * sp, F.o[1] * cp + F.f[1] * sp, F.o[2] * cp + F.f[2] * sp];
  const w: Vec3 = [F.f[0] * cp - F.o[0] * sp, F.f[1] * cp - F.o[1] * sp, F.f[2] * cp - F.o[2] * sp];
  const Z: Vec3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  const thumb = (w[0] * Z[0] + w[1] * Z[1] + w[2] * Z[2]) >= 0 ? 1 : -1;
  return { X, Y, Z, o: plan.arms[i].wrist, thumb };
}

/**
 * Cut the mittens out of the render index. A triangle goes when ANY of its vertices belongs to the
 * forearm bone and lies past the wrist plane (x > −WRIST_CUT·hand in the hand frame). Returns the
 * rim (boundary vertices, hand-local) per side and the number of triangles removed.
 */
export function cutMittens(geometry: THREE.BufferGeometry, body: MeshData, plan: DetailedAnatomy): { rims: [WristRim, WristRim]; removed: number } {
  const P = body.positions, idx = (geometry.index!.array as ArrayLike<number>);
  const nv = P.length / 3, H = plan.proportions.hand;
  const side = new Int8Array(nv).fill(-1);
  const local = new Float32Array(nv * 3);
  for (const i of [0, 1] as const) {
    const B = handBasis(plan, i), bi = boneIndex(i === 0 ? "elbowL" : "elbowR");
    for (let v = 0; v < nv; v++) {
      if (!body.bone || body.bone[v] !== bi) continue;
      const rx = P[v * 3] - B.o[0], ry = P[v * 3 + 1] - B.o[1], rz = P[v * 3 + 2] - B.o[2];
      const x = rx * B.X[0] + ry * B.X[1] + rz * B.X[2];
      local[v * 3] = x;
      local[v * 3 + 1] = rx * B.Y[0] + ry * B.Y[1] + rz * B.Y[2];
      local[v * 3 + 2] = rx * B.Z[0] + ry * B.Z[1] + rz * B.Z[2];
      if (x > -WRIST_CUT * H) side[v] = i;
    }
  }
  const kept: number[] = [];
  let removed = 0; // net: cut triangles minus the rim caps added back
  for (let t = 0; t < idx.length; t += 3) {
    if (side[idx[t]] >= 0 || side[idx[t + 1]] >= 0 || side[idx[t + 2]] >= 0) { removed++; continue; }
    kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  // Boundary half-edges of the kept index (directed edges whose reverse is absent): the rims.
  const directed = new Set<number>();
  for (let t = 0; t < kept.length; t += 3) for (let k = 0; k < 3; k++) directed.add(kept[t + k] * nv + kept[t + (k + 1) % 3]);
  const rimVerts: [Set<number>, Set<number>] = [new Set(), new Set()];
  const rimEdges: [number, number][][] = [[], []];
  const nearestArm = (v: number): 0 | 1 => {
    const d0 = Math.hypot(P[v * 3] - plan.arms[0].wrist[0], P[v * 3 + 1] - plan.arms[0].wrist[1], P[v * 3 + 2] - plan.arms[0].wrist[2]);
    const d1 = Math.hypot(P[v * 3] - plan.arms[1].wrist[0], P[v * 3 + 1] - plan.arms[1].wrist[1], P[v * 3 + 2] - plan.arms[1].wrist[2]);
    return d0 < d1 ? 0 : 1;
  };
  for (const e of directed) {
    const a = Math.floor(e / nv), b = e % nv;
    if (directed.has(b * nv + a)) continue;
    const i = nearestArm(a);
    rimVerts[i].add(a); rimVerts[i].add(b);
    rimEdges[i].push([a, b]);
  }
  // Cap each rim with a fan from one of its own vertices (triangle (b, a, pivot) per half-edge a→b keeps
  // the winding): the render mesh stays closed, so no gap at the wrist shows the inside of the forearm.
  // No vertex is added — every attribute keeps the body's vertex count (harnesses re-skin it by index).
  // The cap lies inside the hand's palm tube, so its fan shape is never seen.
  const caps: number[] = [];
  for (const i of [0, 1] as const) {
    if (rimEdges[i].length < 3) continue;
    const pivot = rimEdges[i][0][0];
    for (const [a, b] of rimEdges[i]) if (a !== pivot && b !== pivot) caps.push(b, a, pivot);
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([...kept, ...caps]), 1));
  removed -= caps.length / 3;
  const rims = ([0, 1] as const).map((i) => {
    const B = handBasis(plan, i);
    const pts = [...rimVerts[i]].map((v) => {
      const rx = P[v * 3] - B.o[0], ry = P[v * 3 + 1] - B.o[1], rz = P[v * 3 + 2] - B.o[2];
      return [rx * B.X[0] + ry * B.X[1] + rz * B.X[2], rx * B.Y[0] + ry * B.Y[1] + rz * B.Y[2], rx * B.Z[0] + ry * B.Z[1] + rz * B.Z[2]];
    });
    if (pts.length === 0) {
      const w = plan.proportions.radius.wrist;
      return { xMin: -WRIST_CUT * H, xMax: 0, cy: 0, cz: 0, ay: [w, w] as [number, number], az: w };
    }
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    return {
      xMin: Math.min(...pts.map((p) => p[0])), xMax: Math.max(...pts.map((p) => p[0])), cy, cz,
      ay: [Math.max(...pts.map((p) => cy - p[1])), Math.max(...pts.map((p) => p[1] - cy))] as [number, number],
      az: Math.max(...pts.map((p) => Math.abs(p[2] - cz))),
    };
  }) as [WristRim, WristRim];
  return { rims, removed };
}

/**
 * The handle radius of a weapon node at its grip (the weapon frame's y = 0): the largest radial
 * distance where a mesh edge crosses y = 0, among those under 3 cm (a rod has no vertex at the grip,
 * only rings at its ends, so vertices alone miss it). The grip wrap (the hafts' WRAP_SCALE) counts.
 */
export function measureHandleRadius(weapon: THREE.Object3D): number {
  weapon.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(weapon.matrixWorld).invert();
  const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let r = 0;
  weapon.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const index = mesh.geometry.index;
    const tri = index ? index.count : pos.count;
    const at = (k: number) => (index ? index.getX(k) : k);
    m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let t = 0; t + 2 < tri; t += 3) {
      for (let e = 0; e < 3; e++) {
        a.fromBufferAttribute(pos, at(t + e)).applyMatrix4(m);
        b.fromBufferAttribute(pos, at(t + (e + 1) % 3)).applyMatrix4(m);
        if ((a.y > 0) === (b.y > 0) || Math.abs(a.y - b.y) < 1e-9) continue;
        const s = a.y / (a.y - b.y);
        const rr = Math.hypot(a.x + (b.x - a.x) * s, a.z + (b.z - a.z) * s);
        if (rr < 0.03) r = Math.max(r, rr);
      }
    }
  });
  // The weapon node's own scale (weaponScale) multiplies the radius.
  return (r || 0.015) * weapon.scale.y;
}

/** Over how far up the forearm (× the wrist radius) the body's ink tapers to nothing at the cut. */
export const HULL_TURN = 1.6;

/**
 * The hull geometry of the cut body: the render geometry's skin, normals and index by reference, and
 * its own positions — over the last HULL_TURN wrist radii before each rim the vertices sink along their
 * normal by up to the body's ink width (CEL_OUTLINE_WIDTH), so the outline the shader pushes back out
 * TAPERS to the skin at the wrist. The forearm's thick ink then hands over to the hand's thin ink
 * instead of ending in a black collar (the open end of the inflated forearm).
 */
export function wristHullGeometry(geometry: THREE.BufferGeometry, body: MeshData, plan: DetailedAnatomy, rims: [WristRim, WristRim]): THREE.BufferGeometry {
  const hull = new THREE.BufferGeometry();
  for (const [name, at] of Object.entries(geometry.attributes)) if (name !== "position") hull.setAttribute(name, at);
  hull.setIndex(geometry.index);
  const src = geometry.getAttribute("position").array as Float32Array, N = geometry.getAttribute("normal").array as Float32Array;
  const Pos = src.slice();
  const P = body.positions, nv = P.length / 3, w = plan.proportions.radius.wrist;
  for (const i of [0, 1] as const) {
    const B = handBasis(plan, i), bi = boneIndex(i === 0 ? "elbowL" : "elbowR"), rim = rims[i];
    const x0 = rim.xMin - HULL_TURN * w, x1 = rim.xMin;
    for (let v = 0; v < nv; v++) {
      if (!body.bone || body.bone[v] !== bi) continue;
      const x = (P[v * 3] - B.o[0]) * B.X[0] + (P[v * 3 + 1] - B.o[1]) * B.X[1] + (P[v * 3 + 2] - B.o[2]) * B.X[2];
      if (x <= x0) continue;
      const t = Math.min(1, (x - x0) / (x1 - x0)), f = t * t * (3 - 2 * t);
      for (let d = 0; d < 3; d++) Pos[v * 3 + d] = src[v * 3 + d] - N[v * 3 + d] * CEL_OUTLINE_WIDTH * f;
    }
  }
  hull.setAttribute("position", new THREE.BufferAttribute(Pos, 3));
  hull.boundingSphere = geometry.boundingSphere;
  return hull;
}

export function attachHands(inp: HandRigInput): HandRigApi & { mounts: [THREE.Object3D, THREE.Object3D] } {
  const { plan, bones } = inp;
  const { rims, removed } = cutMittens(inp.geometry, inp.body, plan);
  if (inp.outline) inp.outline.geometry = wristHullGeometry(inp.geometry, inp.body, plan, rims);
  const P = plan.proportions;
  const sizes = ([0, 1] as const).map((i) => handSize({
    hand: P.hand, palmHalfWidth: P.radius.palmHalfWidth, palmHalfThickness: P.radius.palmHalfThickness,
    wrist: P.radius.wrist, thumb: handBasis(plan, i).thumb, rim: rims[i],
    // Wave GEN lane B: the race's digit distribution (StatMorph.RACE_DIGITS).
    ...(plan.morph ? { digits: plan.morph.digits } : {}),
  })) as [HandSize, HandSize];
  const handleRadius = measureHandleRadius(inp.weapon);
  const mounts: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const handMeshes: HandMesh[] = [];
  const poses: HandPose[] = [];
  const colourSets: Float32Array[] = [];
  const toModel: THREE.Matrix4[] = [];
  for (const i of [0, 1] as const) {
    const B = handBasis(plan, i);
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(...B.X), new THREE.Vector3(...B.Y), new THREE.Vector3(...B.Z)).setPosition(...B.o);
    toModel.push(M);
    const bone = bones.get(i === 0 ? "elbowL" : "elbowR")!;
    bone.updateMatrixWorld(true);
    // Mount local = (bone bind world)⁻¹ · M. The rig group is at the identity when this runs.
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(M);
    const mount = new THREE.Object3D();
    mount.name = `hand-mount-${i === 0 ? "L" : "R"}`;
    local.decompose(mount.position, mount.quaternion, mount.scale);
    bone.add(mount);
    mounts.push(mount);
    const pose = relaxedPose(sizes[i]);
    const hm = buildHandMesh(sizes[i], pose);
    handMeshes.push(hm);
    poses.push(pose);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(hm.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(hm.normals, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(hm.indices, 1));
    // Paint in model space (bind, relaxed) so position-based patterns line up with the body's.
    const nv = hm.part.length;
    let colours: Float32Array;
    if (inp.paint) {
      const mp = new Float32Array(nv * 3), mn = new Float32Array(nv * 3), v = new THREE.Vector3();
      const nm = new THREE.Matrix3().setFromMatrix4(M);
      for (let k = 0; k < nv; k++) {
        v.fromArray(hm.positions, k * 3).applyMatrix4(M); mp.set([v.x, v.y, v.z], k * 3);
        v.fromArray(hm.normals, k * 3).applyMatrix3(nm).normalize(); mn.set([v.x, v.y, v.z], k * 3);
      }
      const region = new Uint8Array(nv);
      for (let k = 0; k < nv; k++) region[k] = hm.kind[k] === NAIL_REGION ? NAIL : HAND;
      colours = inp.paint({ positions: mp, normals: mn, indices: hm.indices, region });
    } else {
      const c = new THREE.Color(inp.flatColour);
      colours = new Float32Array(nv * 3);
      for (let k = 0; k < nv; k++) colours.set([c.r, c.g, c.b], k * 3);
    }
    colourSets.push(colours);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    geo.computeBoundingSphere();
    geos.push(geo);
    // A hand-sized ink line: the body's 3.5 cm hull would swallow 1 cm fingers in black.
    const ink = Math.max(HAND_INK_MIN, Math.min(HAND_INK_MAX, HAND_INK_PER_FINGER * sizes[i].fingerR[1]));
    const cel = createCelMesh(geo, "#ffffff", 0, { vertexColors: true, outlineWidth: ink });
    cel.name = `hand-${i === 0 ? "L" : "R"}`;
    cel.traverse((o) => { o.frustumCulled = false; });
    mount.add(cel);
    meshes.push(cel.children[0] as THREE.Mesh);
  }

  // The weapon handle in a hand's local frame.
  const mRel = new THREE.Matrix4(), mTmp = new THREE.Matrix4();
  const pA = new THREE.Vector3(), pB = new THREE.Vector3();
  /** Matrix of `node` relative to the rig root group, from LOCAL matrices (no world update needed). */
  const groupMatrix = (node: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 => {
    out.identity();
    const chain: THREE.Object3D[] = [];
    for (let n: THREE.Object3D | null = node; n && n.name !== "skinned-humanoid"; n = n.parent) chain.unshift(n);
    for (const n of chain) { n.updateMatrix(); out.multiply(n.matrix); }
    return out;
  };
  const handleIn = (i: 0 | 1): HandleLine => {
    if (i === 1) {
      // Mount and grip-mount are siblings on elbowR: mount⁻¹ · gripMount · grip · weapon.
      mounts[1].updateMatrix(); inp.gripMount.updateMatrix(); inp.grip.updateMatrix(); inp.weapon.updateMatrix();
      mRel.copy(mounts[1].matrix).invert().multiply(inp.gripMount.matrix).multiply(inp.grip.matrix).multiply(inp.weapon.matrix);
    } else {
      groupMatrix(mounts[0], mTmp);
      groupMatrix(inp.weapon, mRel);
      mRel.premultiply(mTmp.invert());
    }
    pA.set(0, 0, 0).applyMatrix4(mRel);
    pB.set(0, 1, 0).applyMatrix4(mRel).sub(pA).normalize();
    return { p: [pA.x, pA.y, pA.z], u: [pB.x, pB.y, pB.z], r: handleRadius };
  };
  const inReach = (i: 0 | 1, h: HandleLine): boolean => {
    const S = sizes[i], g: Vec3 = [0.45 * S.H, 0, 0];
    const rel: Vec3 = [g[0] - h.p[0], g[1] - h.p[1], g[2] - h.p[2]];
    const t = rel[0] * h.u[0] + rel[1] * h.u[1] + rel[2] * h.u[2];
    const d = Math.hypot(rel[0] - t * h.u[0], rel[1] - t * h.u[1], rel[2] - t * h.u[2]);
    return d <= (i === 1 ? 1.5 : OFF_HAND_REACH) * S.halfW + h.r;
  };
  const live: (HandleLine | null)[] = [null, null];
  const keys = ["", ""];
  const writePose = (i: 0 | 1, pose: HandPose) => {
    poses[i] = pose;
    writeHand(sizes[i], pose, handMeshes[i]);
    (geos[i].getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geos[i].getAttribute("normal") as THREE.BufferAttribute).needsUpdate = true;
  };
  const update = (): void => {
    for (const i of [0, 1] as const) {
      const h = handleIn(i);
      const ok = inReach(i, h);
      const key = ok ? h.p.map((x) => x.toFixed(4)).join(",") + "|" + h.u.map((x) => x.toFixed(3)).join(",") : "relaxed";
      if (key === keys[i]) continue;
      keys[i] = key;
      live[i] = ok ? h : null;
      writePose(i, ok ? gripPose(sizes[i], h) : relaxedPose(sizes[i]));
    }
  };
  update();
  const api: HandRigApi & { mounts: [THREE.Object3D, THREE.Object3D] } = {
    size: sizes,
    handleRadius,
    triangles: 2 * handTriangleCount(),
    cutTriangles: removed,
    mounts: mounts as [THREE.Object3D, THREE.Object3D],
    meshes: meshes as [THREE.Mesh, THREE.Mesh],
    pose: (i) => poses[i],
    liveHandle: (i) => live[i],
    liveContact: (i) => live[i] ? contactReport(sizes[i], poses[i], live[i]!, handMeshes[i]) : null,
    handleAt(deg: number): HandleLine {
      const S = sizes[1], a = (deg * Math.PI) / 180;
      return { p: [0.45 * S.H, 0, 0], u: [Math.cos(a), 0, S.thumb * Math.sin(a)], r: handleRadius };
    },
    meshFor: (i, pose) => buildHandMesh(sizes[i], pose),
    colours: (i) => colourSets[i],
    toLocal(p: Vec3, n: Vec3): [Vec3, Vec3] {
      const B = handBasis(plan, 1);
      const r: Vec3 = [p[0] - B.o[0], p[1] - B.o[1], p[2] - B.o[2]];
      const dt = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return [[dt(r, B.X), dt(r, B.Y), dt(r, B.Z)], [dt(n, B.X), dt(n, B.Y), dt(n, B.Z)]];
    },
    update,
  };
  return api;
}
