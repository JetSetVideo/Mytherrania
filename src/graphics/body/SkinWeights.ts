// Linear-blend skin weights (lane A, R03). Pure module: no THREE.
//
// Vocabulary
//   d_b      distance (m) from a vertex to bone b's segment head→tail.
//   d_min    the smallest d_b among the vertex's CANDIDATE bones (≈ the local flesh radius).
//   weight   w_b = 1 − smootherstep(0, blend, d_b − d_min), blend = SKIN_BLEND_FRACTION·d_min
//            (floored at SKIN_BLEND_MIN): the nearest bone gets 1, a bone farther by more than
//            `blend` gets 0, so a joint blends over ≈ ±1.1 flesh radii and a limb mid-shaft is
//            rigid. The top `maxInfluences` weights are kept and normalised to sum 1.
//   candidates (region-aware): a bone is a candidate only if
//     (a) it is the vertex's dominant bone (from the SDF), its parent or one of its children,
//     (b) its CLASS (the bone without its L/R suffix) is allowed for the vertex's region by
//         REGION_BONE_CLASSES — a hand vertex can only follow the elbow (forearm+hand) bone,
//         never the torso, and
//     (c) it is on the vertex's side: a left/right bone only for a vertex whose dominant bone
//         is on that side, or a central vertex on that side of x = 0.
//   The root bone is never a candidate (it is the frame, not flesh).

import { smootherstep } from "../../core/MathCore.ts";
import { REGIONS, type BoneId, type BoneSegment, type MeshData, type Region, type SkinData } from "./contracts.ts";

/** Joint blend width as a fraction of the local flesh radius d_min. */
export const SKIN_BLEND_FRACTION = 0.6;
/** Floor of the blend width (m): thin parts still blend over a couple of millimetres. */
export const SKIN_BLEND_MIN = 0.01;
/** Linear-blend skinning influences per vertex (three.js reads 4). */
export const MAX_INFLUENCES = 4;

/** Bone classes a region may follow (see module comment, rule b). */
export const REGION_BONE_CLASSES: Record<Region, readonly string[]> = {
  torso: ["spine", "abdomen", "neck", "shoulder"],
  pelvis: ["abdomen", "spine", "hip"],
  neck: ["neck", "head", "spine"],
  head: ["head", "neck"],
  face: ["head"],
  ear: ["head"],
  hair: ["head"],
  upperArm: ["shoulder", "elbow", "spine"],
  foreArm: ["elbow", "shoulder"],
  hand: ["elbow"],
  thigh: ["hip", "knee", "abdomen"],
  shin: ["knee", "hip", "ankle"],
  foot: ["ankle", "knee", "toe"],
  sole: ["ankle", "toe"],
  nail: ["elbow", "toe"],
};

/**
 * A limb-root SEAM BAND (lane A2). The distance rule above gives a limb root a spherical
 * influence around its joint, so trunk skin MEDIAL to the shoulder (clavicle end, pectoral
 * edge, trapezius cap) takes ~100 % shoulder weight and see-saws about the joint when the arm
 * turns: lowering an A-pose arm by Δ lifts a trunk point x metres medial of the joint by
 * x·sin Δ (ork 0.11 m · sin 0.43 ≈ 4.7 cm), which folds the skin into a curved slit at the top
 * of the arm. The band replaces that with an anatomical partition of unity across the SEAM
 * between the limb's regions and the trunk's regions (the deltoid's border):
 *   δ(v)    signed geodesic distance (m, along mesh edges) from v to the seam, + on the limb;
 *   f(v)    = smootherstep(−τ, τ, δ): 0 deep in the trunk, ½ on the seam, 1 down the limb;
 *   weights = (1 − f)·W_trunk + f·W_limb, where W_trunk is the vertex's distance-rule weights
 *             without the child bone (or the parent alone) and W_limb its weights without the
 *             parent (or the child alone). Trunk skin farther than τ from the seam therefore
 *             never follows the limb, and the limb's skin farther than τ never follows the trunk.
 */
export interface RootBand {
  /** Limb root bone (e.g. shoulderL). */
  child: BoneId;
  /** Trunk bone the limb hangs from (e.g. spine). */
  parent: BoneId;
  /** Regions that belong to the limb (upperArm, foreArm, hand). */
  limbRegions: readonly Region[];
  /** Regions of the trunk the seam is measured against (torso, neck). */
  trunkRegions: readonly Region[];
  /** Body half the band applies to: +1 left (+x), −1 right. */
  side: 1 | -1;
  /** τ (m): geodesic half-width of the blend on each side of the seam. */
  halfWidth: number;
}

/** Options of computeSkinWeights beyond the contract. */
export interface SkinWeightOptions {
  /** Limb-root seam bands applied after the distance rule (see RootBand). */
  rootBands?: readonly RootBand[];
}

/**
 * Seam half-width τ as a multiple of the deltoid radius, floored at SEAM_MIN_CELLS cells so the
 * grid always resolves the gradient. Measured on the posed mesh (lane-A2.md, ork/dwarf/human/elf,
 * display pose and a half guard): τ = 0.5 R still flips 11–29 triangles at the seam (the band
 * is too narrow for a 0.43–0.52 rad shoulder turn), 1.0 R leaves 0–2, 1.5 R leaves 0 everywhere
 * with the fewest sharp (> 60°) concave edges, while trunk skin near the joint moves 24–45 mm
 * instead of 37–141 mm with the distance rule alone.
 */
export const SHOULDER_SEAM_FRACTION = 1.5;
export const SEAM_MIN_CELLS = 1.5;

/** The two shoulder seam bands of a body (deltoid radius and cell in metres). */
export function shoulderBands(deltoidRadius: number, cell: number): RootBand[] {
  const halfWidth = Math.max(SHOULDER_SEAM_FRACTION * deltoidRadius, SEAM_MIN_CELLS * cell);
  const limbRegions: Region[] = ["upperArm", "foreArm", "hand", "nail"];
  const trunkRegions: Region[] = ["torso", "neck"];
  return [
    { child: "shoulderL", parent: "spine", limbRegions, trunkRegions, side: 1, halfWidth },
    { child: "shoulderR", parent: "spine", limbRegions, trunkRegions, side: -1, halfWidth },
  ];
}

/** Binary min-heap of (key, vertex) for the geodesic seam distance (allocation per call only). */
function geodesicFromSeam(n: number, adjOff: Uint32Array, adjList: Uint32Array, pos: Float32Array, inSet: Uint8Array, seeds: Map<number, number>, cutoff: number): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  const heapK: number[] = [], heapV: number[] = [];
  const push = (k: number, v: number) => {
    heapK.push(k); heapV.push(v);
    let i = heapK.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapK[p] <= heapK[i]) break;
      [heapK[p], heapK[i]] = [heapK[i], heapK[p]]; [heapV[p], heapV[i]] = [heapV[i], heapV[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const k = heapK[0], v = heapV[0];
    const lk = heapK.pop()!, lv = heapV.pop()!;
    if (heapK.length > 0) {
      heapK[0] = lk; heapV[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heapK.length && heapK[l] < heapK[m]) m = l;
        if (r < heapK.length && heapK[r] < heapK[m]) m = r;
        if (m === i) break;
        [heapK[m], heapK[i]] = [heapK[i], heapK[m]]; [heapV[m], heapV[i]] = [heapV[i], heapV[m]];
        i = m;
      }
    }
    return [k, v];
  };
  for (const [v, d] of seeds) { if (d < dist[v]) { dist[v] = d; push(d, v); } }
  while (heapK.length > 0) {
    const [d, v] = pop();
    if (d > dist[v] || d > cutoff) continue;
    for (let e = adjOff[v]; e < adjOff[v + 1]; e++) {
      const u = adjList[e];
      if (!inSet[u]) continue;
      const nd = d + Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]);
      if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
    }
  }
  return dist;
}

/** Vertex adjacency (CSR) of an indexed triangle mesh. */
function meshAdjacency(n: number, indices: Uint32Array): { off: Uint32Array; list: Uint32Array } {
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { deg[indices[t + e]] += 2; }
  const off = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) off[v + 1] = off[v] + deg[v];
  const fill = off.slice(0, n);
  const list = new Uint32Array(off[n]);
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + (e + 1) % 3];
      list[fill[a]++] = b; list[fill[b]++] = a;
    }
  }
  return { off, list };
}

/**
 * Apply the seam bands to finished weights in place (see RootBand). Pure; O(V log V) per band.
 * Returns how many vertices each band touched (seam band ∪ cleaned trunk/limb skin).
 */
export function applyRootBands(mesh: MeshData, bones: BoneSegment[], skin: SkinData, bands: readonly RootBand[]): number[] {
  const n = mesh.positions.length / 3;
  if (n === 0 || bands.length === 0) return bands.map(() => 0);
  const { off, list } = meshAdjacency(n, mesh.indices);
  const index = new Map<BoneId, number>(bones.map((b, i) => [b.id, i]));
  const touched: number[] = [];
  const wv = new Float64Array(bones.length);
  for (const band of bands) {
    const child = index.get(band.child), parent = index.get(band.parent);
    if (child === undefined || parent === undefined) { touched.push(0); continue; }
    // The limb chain: the child bone and every bone below it (shoulder → elbow).
    const inLimb = new Uint8Array(bones.length);
    inLimb[child] = 1;
    for (let changed = true; changed;) {
      changed = false;
      bones.forEach((b, i) => { const p = b.parent ? index.get(b.parent) : undefined; if (!inLimb[i] && p !== undefined && inLimb[p]) { inLimb[i] = 1; changed = true; } });
    }
    const limbSet = new Uint8Array(n), trunkSet = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      const region = REGIONS[mesh.region[v]];
      const x = mesh.positions[v * 3];
      const dom = mesh.bone ? mesh.bone[v] : -1;
      const domSide = dom >= 0 && dom < bones.length ? boneSide(bones[dom].id) : 0;
      const side = domSide !== 0 ? domSide : (x >= 0 ? 1 : -1);
      if (side !== band.side) continue;
      if (band.limbRegions.includes(region)) limbSet[v] = 1;
      else if (band.trunkRegions.includes(region)) trunkSet[v] = 1;
    }
    // Seeds: both ends of every limb–trunk edge, at half the edge length (the seam is mid-edge).
    const limbSeeds = new Map<number, number>(), trunkSeeds = new Map<number, number>();
    for (let v = 0; v < n; v++) {
      if (!limbSet[v]) continue;
      for (let e = off[v]; e < off[v + 1]; e++) {
        const u = list[e];
        if (!trunkSet[u]) continue;
        const half = 0.5 * Math.hypot(mesh.positions[u * 3] - mesh.positions[v * 3], mesh.positions[u * 3 + 1] - mesh.positions[v * 3 + 1], mesh.positions[u * 3 + 2] - mesh.positions[v * 3 + 2]);
        limbSeeds.set(v, Math.min(limbSeeds.get(v) ?? Infinity, half));
        trunkSeeds.set(u, Math.min(trunkSeeds.get(u) ?? Infinity, half));
      }
    }
    const tau = band.halfWidth;
    const dLimb = geodesicFromSeam(n, off, list, mesh.positions, limbSet, limbSeeds, 2 * tau);
    const dTrunk = geodesicFromSeam(n, off, list, mesh.positions, trunkSet, trunkSeeds, 2 * tau);
    let count = 0;
    for (let v = 0; v < n; v++) {
      if (!limbSet[v] && !trunkSet[v]) continue;
      const delta = limbSet[v] ? dLimb[v] : -dTrunk[v]; // ±Infinity when out of reach
      // A region that may not follow the other side of the seam stays wholly on its own side
      // (forearm/hand never take the spine, the neck never takes the shoulder).
      const allowed = REGION_BONE_CLASSES[REGIONS[mesh.region[v]]];
      const f = limbSet[v] && !allowed.includes(boneClass(band.parent)) ? 1
        : trunkSet[v] && !allowed.includes(boneClass(band.child)) ? 0
        : smootherstep(-tau, tau, delta);
      // Split the current weights into the trunk part (bones outside the limb chain) and the
      // limb part (bones of the chain); an empty part falls back to the parent / the child.
      wv.fill(0);
      let tSum = 0, lSum = 0;
      for (let s = 0; s < 4; s++) {
        const w = skin.skinWeight[v * 4 + s];
        if (w > 0) wv[skin.skinIndex[v * 4 + s]] += w;
      }
      for (let b = 0; b < bones.length; b++) { if (inLimb[b]) lSum += wv[b]; else tSum += wv[b]; }
      const out = new Map<number, number>();
      const addPart = (scale: number, limb: number, sum: number, fallback: number) => {
        if (scale <= 0) return;
        if (sum <= 1e-9) { out.set(fallback, (out.get(fallback) ?? 0) + scale); return; }
        for (let b = 0; b < bones.length; b++) if (inLimb[b] === limb && wv[b] > 0) out.set(b, (out.get(b) ?? 0) + scale * wv[b] / sum);
      };
      addPart(1 - f, 0, tSum, parent);
      addPart(f, 1, lSum, child);
      const top = [...out].filter(([, w]) => w > 1e-6).sort((p, q) => q[1] - p[1]).slice(0, 4);
      const total = top.reduce((acc, [, w]) => acc + w, 0);
      for (let s = 0; s < 4; s++) {
        skin.skinIndex[v * 4 + s] = s < top.length ? top[s][0] : 0;
        skin.skinWeight[v * 4 + s] = s < top.length ? top[s][1] / total : 0;
      }
      count++;
    }
    touched.push(count);
  }
  return touched;
}

/** "shoulderL" -> "shoulder"; central bones are their own class. */
export function boneClass(id: BoneId): string {
  return /[LR]$/.test(id) ? id.slice(0, -1) : id;
}
/** +1 for a left bone, −1 right, 0 central. */
export function boneSide(id: BoneId): 1 | -1 | 0 {
  return id.endsWith("L") ? 1 : id.endsWith("R") ? -1 : 0;
}

/** Distance (m) from point p to the segment a→b. */
export function segmentDistance(px: number, py: number, pz: number, a: readonly number[], b: readonly number[]): number {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const qx = px - a[0], qy = py - a[1], qz = pz - a[2];
  const bb = bx * bx + by * by + bz * bz;
  const t = bb > 1e-18 ? Math.max(0, Math.min(1, (qx * bx + qy * by + qz * bz) / bb)) : 0;
  const dx = qx - bx * t, dy = qy - by * t, dz = qz - bz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Contract entry point: skin weights for every vertex of `mesh` against `bones` (indices
 * into `bones`, which must be in BONE_IDS order when `mesh.bone` is present). Every vertex
 * gets ≥ 1 influence and its weights sum to 1.
 */
export function computeSkinWeights(mesh: MeshData, bones: BoneSegment[], maxInfluences = MAX_INFLUENCES, options: SkinWeightOptions = {}): SkinData {
  const skin = distanceWeights(mesh, bones, maxInfluences);
  if (options.rootBands && options.rootBands.length > 0) applyRootBands(mesh, bones, skin, options.rootBands);
  return skin;
}

/** The distance rule of the module comment (no seam bands). */
function distanceWeights(mesh: MeshData, bones: BoneSegment[], maxInfluences: number): SkinData {
  const n = mesh.positions.length / 3;
  const k = Math.max(1, Math.min(MAX_INFLUENCES, maxInfluences));
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const index = new Map<BoneId, number>(bones.map((b, i) => [b.id, i]));
  const children = bones.map(() => [] as number[]);
  bones.forEach((b, i) => { if (b.parent && index.has(b.parent)) children[index.get(b.parent)!].push(i); });
  const parentOf = bones.map((b) => (b.parent && index.has(b.parent) ? index.get(b.parent)! : -1));
  const cls = bones.map((b) => boneClass(b.id));
  const side = bones.map((b) => boneSide(b.id));
  const isRoot = bones.map((b) => b.id === "root");

  const cand: number[] = [];
  const dist: number[] = [];
  const w: number[] = [];
  for (let v = 0; v < n; v++) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    const region = REGIONS[mesh.region[v]] ?? "torso";
    const allowed = REGION_BONE_CLASSES[region];
    // Dominant bone: from the SDF when present, else the nearest non-root bone.
    let dom = mesh.bone ? mesh.bone[v] : -1;
    if (dom < 0 || dom >= bones.length || isRoot[dom]) {
      let best = Infinity;
      for (let b = 0; b < bones.length; b++) {
        if (isRoot[b]) continue;
        const d = segmentDistance(x, y, z, bones[b].head, bones[b].tail);
        if (d < best) { best = d; dom = b; }
      }
    }
    const vSide = side[dom] !== 0 ? side[dom] : (x >= 0 ? 1 : -1);
    cand.length = 0;
    const consider = (b: number): void => {
      if (b < 0 || isRoot[b] || cand.includes(b)) return;
      if (!allowed.includes(cls[b])) return;
      if (side[b] !== 0 && side[b] !== vSide) return;
      cand.push(b);
    };
    consider(dom);
    consider(parentOf[dom]);
    for (const c of children[dom]) consider(c);
    if (cand.length === 0) cand.push(dom); // the dominant bone always qualifies as a fallback
    dist.length = 0;
    let dMin = Infinity;
    for (const b of cand) {
      const d = segmentDistance(x, y, z, bones[b].head, bones[b].tail);
      dist.push(d);
      if (d < dMin) dMin = d;
    }
    const blend = Math.max(SKIN_BLEND_MIN, SKIN_BLEND_FRACTION * dMin);
    w.length = 0;
    for (let i = 0; i < cand.length; i++) w.push(1 - smootherstep(0, blend, dist[i] - dMin));
    // Top-k by weight (insertion order breaks ties toward the dominant bone).
    const order = cand.map((_, i) => i).sort((a, b) => w[b] - w[a]).slice(0, k);
    let total = 0;
    for (const i of order) total += w[i];
    for (let s = 0; s < 4; s++) {
      if (s < order.length && total > 0 && w[order[s]] > 0) {
        skinIndex[v * 4 + s] = cand[order[s]];
        skinWeight[v * 4 + s] = w[order[s]] / total;
      }
    }
    if (total <= 0) { skinIndex[v * 4] = dom; skinWeight[v * 4] = 1; }
  }
  return { skinIndex, skinWeight };
}
