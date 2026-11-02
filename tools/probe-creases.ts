// Crease probe (wave W, lane H): are the elbow / knee grooves (wave V lane B: cubital fossa,
// popliteal hollow, the narrowed joint cores) pinched, holed or self-intersecting — in the bind
// skin AND on the CPU-skinned POSED skin the game draws (guard elbows ~1.45-1.7 rad, knees ~0.5)?
//
//   deno run -A tools/probe-creases.ts [--tag now] [--seeds 1,7,42] [--ref]
//
// Per body (4 races x 2 sexes x seeds) and per pose of the joint (elbow 0 / 0.8 / 1.45 / 2.0 rad,
// knee 0 / 0.5 / 1.2 rad), in a window of 0.9 head around the joint:
//   topology  the rendered skin's boundary / non-manifold edges and components (whole mesh, bind);
//   folds     triangles whose posed normal opposes the bind normal carried by their own skinning
//             transform (a triangle turned inside out = a visible pinch / dark wedge);
//   selfX     pairs of non-adjacent triangles that intersect in the posed skin (skin through skin);
//   minR      the smallest distance of a window vertex from the joint's bone axis (posed upper /
//             lower segment, min over both) divided by the joint radius: the crease collapsing
//             toward the bone reads < ~0.55;
//   inner     the same, restricted to the FLEXOR side (the cubital fossa / popliteal hollow);
//   groove    (bind field) the depth of the front (elbow) / back (knee) groove: profile along the
//             limb, max of the neighbouring radii − the radius at the groove, / joint radius.
// --ref builds the PRE-WAVE-V limb forms (AnatomyParts.referenceForms) for comparison.
// Writes artifacts/wave-w/lane-H/creases-<tag>.json and prints a table.
// @deno-types="@types/three"
import * as THREE from "three";
import type { BodySpec, Vec3 } from "../src/graphics/body/contracts.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { referenceForms } from "../src/graphics/body/AnatomyParts.ts";
import { meshStats } from "../src/graphics/body/MeshStats.ts";
import { defaultHumanoid, type JointName } from "../src/game/Skeleton.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { computeSkinWeights, shoulderBands } from "../src/graphics/body/SkinWeights.ts";
import { REGIONS } from "../src/graphics/body/contracts.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import type { Appearance } from "../src/game/Characters.ts";

const OUT = "artifacts/wave-w/lane-H";
const BASE: Record<string, { m: [number, number]; f: [number, number] }> = {
  human: { m: [1.76, 76], f: [1.66, 61] },
  elf: { m: [1.84, 66], f: [1.75, 56] },
  dwarf: { m: [1.38, 78], f: [1.32, 66] },
  ork: { m: [1.98, 118], f: [1.88, 96] },
};
export const ELBOW_POSES = [0, -0.8, -1.45, -2.0];
export const KNEE_POSES = [0, -0.5, -1.2];

type Rig = ReturnType<typeof buildSkinnedHumanoid>;
const appearanceOf = (s: BodySpec): Appearance => ({ body: "#4f8490", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#172128", eyes: "#2f6fb5", race: s.race, subrace: s.subrace, sex: s.sex ?? undefined } as Appearance);

/** CPU-skinned positions (and the skin transform of each vertex's bind normal) at `angles`. */
export function posedSkin(rig: Rig, angles: Partial<Record<JointName, number>>): { p: Float32Array; n: Float32Array } {
  const geo = rig.skin.geometry;
  const sk = defaultHumanoid();
  for (const name of sk.jointNames()) { const j = sk.joint(name); j.angle = j.target = angles[name] ?? 0; }
  rig.update(sk, 0);
  rig.group.updateMatrixWorld(true);
  const pos = geo.getAttribute("position"), nor = geo.getAttribute("normal");
  const p = new Float32Array(pos.count * 3), n = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    rig.skin.applyBoneTransform(i, v.fromBufferAttribute(pos, i));
    w.fromBufferAttribute(pos, i).addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, i), 0.002);
    rig.skin.applyBoneTransform(i, w);
    w.sub(v).normalize();
    p.set([v.x, v.y, v.z], i * 3);
    n.set([w.x, w.y, w.z], i * 3);
  }
  return { p, n };
}

const sub = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): Vec3 => [a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]];
const crs = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Segment p0-p1 against triangle (a,b,c): true when it crosses the triangle's interior. */
function segTri(p0: Vec3, p1: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const dir: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const h = crs(dir, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det, s: Vec3 = [p0[0] - a[0], p0[1] - a[1], p0[2] - a[2]];
  const u = f * dot(s, h);
  if (u <= 1e-6 || u >= 1 - 1e-6) return false;
  const q = crs(s, e1), v = f * dot(dir, q);
  if (v <= 1e-6 || u + v >= 1 - 1e-6) return false;
  const t = f * dot(e2, q);
  return t > 1e-6 && t < 1 - 1e-6;
}

/** Distance from point x to segment a-b. */
function segDist(x: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ax: Vec3 = [x[0] - a[0], x[1] - a[1], x[2] - a[2]];
  const t = Math.max(0, Math.min(1, dot(ax, ab) / (dot(ab, ab) || 1)));
  return Math.hypot(ax[0] - t * ab[0], ax[1] - t * ab[1], ax[2] - t * ab[2]);
}

export interface JointReport { joint: string; angle: number; tris: number; folds: number; selfX: number; minR: number; inner: number }

/**
 * Metrics in a window around one joint of one side (side 0 = L, 1 = R), posed at `angle`.
 * `kind` "elbow" uses shoulder->elbow->wrist, "knee" hip->knee->ankle.
 */
export function jointReport(rig: Rig, kind: "elbow" | "knee", side: 0 | 1, angle: number): JointReport {
  const s = side === 0 ? "L" : "R";
  const jn = `${kind}${s}` as JointName;
  const posed = posedSkin(rig, { [jn]: angle });
  const geo = rig.skin.geometry;
  const bind = geo.getAttribute("position").array as Float32Array, bn = geo.getAttribute("normal").array as Float32Array;
  const idx = geo.index!.array as ArrayLike<number>;
  const plan = rig.plan, P = plan.proportions, h = P.head;
  // Posed joint chain from the bone world matrices (bind head positions moved by their bones).
  const boneWorld = (id: string, at: Vec3): Vec3 => {
    const bone = rig.bones.get(id as JointName)!, k = rig.skin.skeleton.bones.indexOf(bone);
    const m = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rig.skin.skeleton.boneInverses[k]);
    const v = new THREE.Vector3(...at).applyMatrix4(m);
    return [v.x, v.y, v.z];
  };
  let A: Vec3, J: Vec3, B: Vec3, R: number, flexDir: Vec3;
  if (kind === "elbow") {
    const a = plan.arms[side];
    A = boneWorld(`shoulder${s}`, a.shoulder); J = boneWorld(`elbow${s}`, a.elbow); B = boneWorld(`elbow${s}`, a.wrist);
    R = P.radius.upperArmDistal;
    flexDir = a.frame.f; // the fossa is on the arm's front (f) in the bind
  } else {
    const l = plan.legs[side];
    A = boneWorld(`hip${s}`, l.hip); J = boneWorld(`knee${s}`, l.knee); B = boneWorld(`knee${s}`, l.ankle);
    R = P.radius.knee;
    flexDir = [-l.frame.f[0], -l.frame.f[1], -l.frame.f[2]]; // the popliteal hollow is behind
  }
  const jBind: Vec3 = kind === "elbow" ? plan.arms[side].elbow : plan.legs[side].knee;
  const win = 0.9 * h;
  const inWin = (v: number) => Math.hypot(bind[v * 3] - jBind[0], bind[v * 3 + 1] - jBind[1], bind[v * 3 + 2] - jBind[2]) < win;
  // Window triangles (all three vertices in the window).
  const tris: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) if (inWin(idx[t * 3]) && inWin(idx[t * 3 + 1]) && inWin(idx[t * 3 + 2])) tris.push(t);
  const p = posed.p;
  let folds = 0;
  for (const t of tris) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const fn = crs(sub(p, b, p, a), sub(p, c, p, a));
    const carried: Vec3 = [posed.n[a * 3] + posed.n[b * 3] + posed.n[c * 3], posed.n[a * 3 + 1] + posed.n[b * 3 + 1] + posed.n[c * 3 + 1], posed.n[a * 3 + 2] + posed.n[b * 3 + 2] + posed.n[c * 3 + 2]];
    // Also the bind face normal must agree with the bind vertex normals (or the triangle was already odd).
    const fb = crs(sub(bind, b, bind, a), sub(bind, c, bind, a));
    const nb: Vec3 = [bn[a * 3] + bn[b * 3] + bn[c * 3], bn[a * 3 + 1] + bn[b * 3 + 1] + bn[c * 3 + 1], bn[a * 3 + 2] + bn[b * 3 + 2] + bn[c * 3 + 2]];
    if (dot(fb, nb) > 0 && dot(fn, carried) < 0) folds++;
  }
  // Self-intersections between non-adjacent window triangles.
  let selfX = 0;
  const V = (i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const boxes = tris.map((t) => {
    const vs = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map(V);
    return { t, vs, lo: [0, 1, 2].map((k) => Math.min(...vs.map((v) => v[k]))), hi: [0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k]))) };
  });
  for (let i = 0; i < boxes.length; i++) {
    const A1 = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const B1 = boxes[j];
      if (A1.hi[0] < B1.lo[0] || B1.hi[0] < A1.lo[0] || A1.hi[1] < B1.lo[1] || B1.hi[1] < A1.lo[1] || A1.hi[2] < B1.lo[2] || B1.hi[2] < A1.lo[2]) continue;
      const ia = [idx[A1.t * 3], idx[A1.t * 3 + 1], idx[A1.t * 3 + 2]], ib = [idx[B1.t * 3], idx[B1.t * 3 + 1], idx[B1.t * 3 + 2]];
      if (ia.some((x) => ib.includes(x))) continue;
      let hit = false;
      for (let e = 0; e < 3 && !hit; e++) hit = segTri(A1.vs[e], A1.vs[(e + 1) % 3], B1.vs[0], B1.vs[1], B1.vs[2]) || segTri(B1.vs[e], B1.vs[(e + 1) % 3], A1.vs[0], A1.vs[1], A1.vs[2]);
      if (hit) selfX++;
    }
  }
  // Collapse toward the bone: min distance to the posed chain, all window vertices / flexor side.
  let minR = Infinity, inner = Infinity;
  const near = new Set<number>();
  for (const t of tris) for (let k = 0; k < 3; k++) near.add(idx[t * 3 + k]);
  for (const v of near) {
    // Only the joint's own band (±0.6 R along the bind limb around the joint) — the crease itself.
    const rel: Vec3 = [bind[v * 3] - jBind[0], bind[v * 3 + 1] - jBind[1], bind[v * 3 + 2] - jBind[2]];
    const d0 = kind === "elbow" ? plan.arms[side].frame.d : plan.legs[side].frame.d;
    if (Math.abs(dot(rel, d0)) > 0.6 * R) continue;
    const x = V(v);
    const r = Math.min(segDist(x, A, J), segDist(x, J, B)) / R;
    minR = Math.min(minR, r);
    if (dot(rel, flexDir) > 0.3 * R) inner = Math.min(inner, r);
  }
  return { joint: `${kind}${s}`, angle, tris: tris.length, folds, selfX, minR: +minR.toFixed(3), inner: +inner.toFixed(3) };
}

// ------------------------------------------------------------------------------------------------
// Ink-hull render of the posed elbow (the game's look: an inverted hull pushed out along the normals,
// drawn black behind the cel surface). A pinched crease shows as a dark wedge where the hull pokes
// through; `inkShare` = dark pixels / figure pixels in a window around the joint.
// ------------------------------------------------------------------------------------------------
export interface HullImage { w: number; h: number; rgb: Uint8Array; inkShare: number }
export function hullRender(p: Float32Array, n: Float32Array, idx: ArrayLike<number>, centre: Vec3, dir: Vec3, half: number, size: number, ink: number, win: number): HullImage {
  const w = size, h = size;
  const nz = (a: Vec3) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] as Vec3; };
  const fwd = nz(dir), up0: Vec3 = Math.abs(fwd[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
  const right = nz(crs(up0, fwd)), up = crs(fwd, right);
  const light = nz([-0.45 * right[0] + 0.6 * up[0] + 0.66 * fwd[0], -0.45 * right[1] + 0.6 * up[1] + 0.66 * fwd[1], -0.45 * right[2] + 0.6 * up[2] + 0.66 * fwd[2]]);
  const nv = p.length / 3, scale = (h / 2) / half;
  const depth = new Float64Array(w * h).fill(-Infinity), col = new Float32Array(w * h).fill(-1);
  const proj = (x: number, y: number, z: number) => {
    const X = x - centre[0], Y = y - centre[1], Z = z - centre[2];
    return [w / 2 + (X * right[0] + Y * right[1] + Z * right[2]) * scale, h / 2 - (X * up[0] + Y * up[1] + Z * up[2]) * scale, X * fwd[0] + Y * fwd[1] + Z * fwd[2]];
  };
  const S = new Float64Array(nv * 3), Hs = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    S.set(proj(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]), i * 3);
    Hs.set(proj(p[i * 3] + n[i * 3] * ink, p[i * 3 + 1] + n[i * 3 + 1] * ink, p[i * 3 + 2] + n[i * 3 + 2] * ink), i * 3);
  }
  const raster = (V: Float64Array, back: boolean) => {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = V[a * 3], ay = V[a * 3 + 1], bx = V[b * 3], by = V[b * 3 + 1], cx = V[c * 3], cy = V[c * 3 + 1];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (back ? area <= 0 : area >= 0) continue;
      let tone = 0;
      if (!back) {
        const nn = nz([n[a * 3] + n[b * 3] + n[c * 3], n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]]);
        const ndl = dot(nn, light);
        tone = ndl < 0.05 ? 0.46 : ndl < 0.5 ? 0.72 : 1.0;
      }
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area, w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * V[a * 3 + 2] + w1 * V[b * 3 + 2] + w2 * V[c * 3 + 2], k = py * w + px;
        if (z <= depth[k]) continue;
        depth[k] = z; col[k] = tone;
      }
    }
  };
  raster(Hs, true);
  raster(S, false);
  const rgb = new Uint8Array(w * h * 3);
  let fig = 0, dark = 0;
  const r0 = win * scale;
  for (let k = 0; k < w * h; k++) {
    const v = col[k];
    const g = v < 0 ? 235 : Math.round(v * 200);
    rgb[k * 3] = v < 0 ? 238 : v === 0 ? 20 : Math.round(v * 214); rgb[k * 3 + 1] = v < 0 ? 232 : v === 0 ? 24 : Math.round(v * 168); rgb[k * 3 + 2] = v < 0 ? 220 : v === 0 ? 30 : g * 0.6;
    const px = k % w, py = Math.floor(k / w);
    if (Math.hypot(px - w / 2, py - h / 2) > r0 || v < 0) continue;
    fig++;
    if (v === 0) dark++;
  }
  return { w, h, rgb, inkShare: fig ? dark / fig : 0 };
}

/** LBS-only weights of a rig's body (the pre-helper skin) — for the A/B. */
export function plainWeights(rig: Rig): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const geo = rig.skin.geometry;
  const pos = geo.getAttribute("position").array as Float32Array;
  // Rebuild the distance weights exactly as SkinnedHumanoid's cache does (the cap vertices too).
  const n = geo.getAttribute("position").count;
  const region = new Uint8Array(n), bone = new Uint8Array(n);
  const body = generateBody(rig.plan.proportions.spec);
  region.set(body.mesh.region.subarray(0, Math.min(n, body.mesh.region.length)));
  if (body.mesh.bone) bone.set(body.mesh.bone.subarray(0, Math.min(n, body.mesh.bone.length)));
  for (let v = body.mesh.region.length; v < n; v++) { region[v] = REGIONS.indexOf("foreArm"); bone[v] = 255; }
  const sk = computeSkinWeights({ positions: pos, normals: geo.getAttribute("normal").array as Float32Array, indices: new Uint32Array(0), region, bone }, rig.plan.bones, 4, {
    rootBands: shoulderBands(rig.plan.proportions.radius.deltoid, rig.plan.cell),
  });
  return sk;
}

export async function renderAB(out: string): Promise<Record<string, number>[]> {
  const { png, compose } = await import("./probe-body.ts");
  const rows: Record<string, number>[] = [];
  const imgs: { w: number; h: number; rgb: Uint8Array }[][] = [];
  for (const [race, sex] of [["human", "male"], ["dwarf", "male"], ["ork", "male"], ["elf", "female"]] as const) {
    const [height, weight] = BASE[race][sex === "male" ? "m" : "f"];
    const spec: BodySpec = { race, subrace: null, className: "Warrior", height, weight, seed: 7, sex };
    const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), appearanceOf(spec), "fire", spec, { paint: false });
    const geo = rig.skin.geometry;
    const helperIdx = geo.getAttribute("skinIndex").array.slice() as Uint16Array, helperW = geo.getAttribute("skinWeight").array.slice() as Float32Array;
    const plain = plainWeights(rig);
    const row: { w: number; h: number; rgb: Uint8Array }[] = [];
    for (const angle of [-1.45, -2.0]) {
      for (const [name, si, sw] of [["lbs", plain.skinIndex, plain.skinWeight], ["helper", helperIdx, helperW]] as const) {
        geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
        geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
        const posed = posedSkin(rig, { elbowR: angle });
        const bone = rig.bones.get("elbowR")!, k = rig.skin.skeleton.bones.indexOf(bone);
        const m = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, rig.skin.skeleton.boneInverses[k]);
        const J = new THREE.Vector3(...rig.plan.arms[1].elbow).applyMatrix4(m);
        const axis = new THREE.Vector3(1, 0, 0).transformDirection(bone.matrixWorld);
        const R = rig.plan.proportions.radius.upperArmDistal;
        const im = hullRender(posed.p, posed.n, geo.index!.array, [J.x, J.y, J.z], [axis.x, axis.y, axis.z], 4.2 * R, 220, 0.02, 1.6 * R);
        // Also the view INTO the crease (the bisector of the bend, from the flexor side).
        const up = new THREE.Vector3(...rig.plan.arms[1].shoulder).applyMatrix4(new THREE.Matrix4().multiplyMatrices(rig.bones.get("shoulderR")!.matrixWorld, rig.skin.skeleton.boneInverses[rig.skin.skeleton.bones.indexOf(rig.bones.get("shoulderR")!)])).sub(J).normalize();
        const dn = new THREE.Vector3(...rig.plan.arms[1].wrist).applyMatrix4(m).sub(J).normalize();
        const into = up.clone().add(dn).normalize();
        const im2 = hullRender(posed.p, posed.n, geo.index!.array, [J.x, J.y, J.z], [into.x, into.y, into.z], 4.2 * R, 220, 0.02, 1.6 * R);
        row.push(im, im2);
        const rep = jointReport(rig, "elbow", 1, angle);
        rows.push({ body: `${race}-${sex}` as unknown as number, angle, variant: name as unknown as number, inkSide: +im.inkShare.toFixed(3), inkInto: +im2.inkShare.toFixed(3), folds: rep.folds, selfX: rep.selfX, inner: rep.inner });
        console.log(`${race}-${sex} ${angle} ${name.padEnd(6)} ink side ${im.inkShare.toFixed(3)} into ${im2.inkShare.toFixed(3)} folds ${rep.folds} selfX ${rep.selfX} inner ${rep.inner}`);
      }
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(helperIdx, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(helperW, 4));
    imgs.push(row);
  }
  await Deno.writeFile(`${out}/creases-ab.png`, await png(compose(imgs)));
  return rows;
}

if (import.meta.main) {
  const args = Deno.args;
  if (args.includes("--render")) {
    await Deno.mkdir(OUT, { recursive: true });
    const rows = await renderAB(OUT);
    await Deno.writeTextFile(`${OUT}/creases-ab.json`, JSON.stringify(rows, null, 1));
    Deno.exit(0);
  }
  const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : "now";
  const seeds = args.includes("--seeds") ? args[args.indexOf("--seeds") + 1].split(",").map(Number) : [1, 7, 42];
  const ref = args.includes("--ref");
  await Deno.mkdir(OUT, { recursive: true });
  const rows: Record<string, unknown>[] = [];
  for (const race of Object.keys(BASE)) {
    for (const sex of ["male", "female"] as const) {
      for (const seed of seeds) {
        const [height, weight] = BASE[race][sex === "male" ? "m" : "f"];
        const spec: BodySpec = { race, subrace: null, className: "Warrior", height, weight, seed, sex };
        const build = () => buildSkinnedHumanoid(generateClassWeapon("Warrior"), appearanceOf(spec), "fire", ref ? { ...spec, seed: spec.seed + 0.5 } : spec, { paint: false });
        const rig = ref ? referenceForms(build) : build();
        const st = meshStats({ positions: rig.skin.geometry.getAttribute("position").array as Float32Array, normals: rig.skin.geometry.getAttribute("normal").array as Float32Array, indices: rig.skin.geometry.index!.array as Uint32Array, region: new Uint8Array(rig.skin.geometry.getAttribute("position").count) });
        const reps: JointReport[] = [];
        for (const a of ELBOW_POSES) for (const side of [0, 1] as const) reps.push(jointReport(rig, "elbow", side, a));
        for (const a of KNEE_POSES) for (const side of [0, 1] as const) reps.push(jointReport(rig, "knee", side, a));
        const row = { id: `${race}-${sex}-${seed}`, boundary: st.boundaryEdges, nonManifold: st.nonManifoldEdges, components: st.components, reps };
        rows.push(row);
        const fmt = (k: "elbow" | "knee") => reps.filter((r) => r.joint.startsWith(k)).map((r) => `${r.joint.slice(-1)}${r.angle}:f${r.folds}/x${r.selfX}/r${r.minR}/i${r.inner}`).join(" ");
        console.log(`${row.id.padEnd(18)} topo b${st.boundaryEdges} nm${st.nonManifoldEdges} c${st.components} | ${fmt("elbow")}\n${"".padEnd(18)} | ${fmt("knee")}`);
      }
    }
  }
  await Deno.writeTextFile(`${OUT}/creases-${tag}${ref ? "-ref" : ""}.json`, JSON.stringify(rows, null, 1));
}
