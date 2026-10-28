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
export function computeSkinWeights(mesh: MeshData, bones: BoneSegment[], maxInfluences = MAX_INFLUENCES): SkinData {
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
