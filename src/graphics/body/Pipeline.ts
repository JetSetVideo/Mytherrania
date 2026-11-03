// Wave GEN (lane P, contract C-PIPE): body generation as an explicit, inspectable pipeline.
// Pure module (no THREE, no DOM).
//
//   skeleton -> cage -> inflate -> carve -> skin -> hitboxes -> paint
//
// | stage    | output                                   | owner of the maths                          |
// |----------|------------------------------------------|---------------------------------------------|
// | skeleton | bones (solved A-pose bind) + cross-section disks + T-pose (display only) | Anatomy (B) / SkeletonDisks (K) |
// | cage     | 6-axis box per body part, per sub-race, scaled by stats | Cage.ts (P)                   |
// | inflate  | SDF volumes, clamped into the cage        | Anatomy/StatMorph (B), Cage.clampTree (P)    |
// | carve    | sculpt strokes + physique (the full plan) | Anatomy/Physique/Brushes (B)                 |
// | skin     | Surface Nets mesh + mesh brushes + weights | Polygonize (P), SkinWeights (K)             |
// | hitboxes | capsules fitted from the carved plan       | combat/Hitboxes.ts (P)                      |
// | paint    | vertex colours (+ miniature pass)          | paint/PaintStage.ts (S)                     |
//
// Honest note on the timings: `anatomyFor` solves the bones and the volumes TOGETHER (the limb
// abductions are solved against the volumes, and the cell is re-derived from a coarse count), so the
// stages are EXTRACTED from one solve: `inflate.ms` holds anatomyFor + the cage clamp, `skeleton.ms` and
// `carve.ms` only the extraction. The rest are timed separately.
//
// generateBody (BodyMesh.ts) runs the same stages without weights / hitboxes / paint, and with no
// stats its plan and mesh are byte-identical to the pre-wave pipeline (tests G3, G4).

import type { BodySpec, BoneId, BoneSegment, MeshData, MeshStats, SdfNode, SkinData, Vec3 } from "./contracts.ts";
import { anatomyFor, type DetailedAnatomy } from "./Anatomy.ts";
import { type BodyField } from "./Sdf.ts";
import { applyMeshBrushes, brushReach } from "./Brushes.ts";
import { lastPolygonizeTiming, polygonizeField } from "./Polygonize.ts";
import { meshStats } from "./MeshStats.ts";
import { skinBoundsOf, skinField } from "./BodyMesh.ts";
import { type Cage, cageFor, cageMetrics, clampTree, positivePrims } from "./Cage.ts";
import { computeSkinWeights, MAX_INFLUENCES, shoulderBands } from "./SkinWeights.ts";
import { type SkeletonDisk, skeletonDisks, tPose } from "../../game/anim/SkeletonDisks.ts";
import { hitboxCoverage, hitboxesFromPlan } from "../../combat/Hitboxes.ts";
import type { HitboxSet } from "../../combat/contracts.ts";
import { type PaintLook, paintStage } from "../paint/PaintStage.ts";

export type { Cage, SkeletonDisk };

export const STAGE_IDS = ["skeleton", "cage", "inflate", "carve", "skin", "hitboxes", "paint"] as const;
export type StageId = typeof STAGE_IDS[number];
export const STAGE_LABELS: Record<StageId, string> = {
  skeleton: "Skeleton", cage: "Cage", inflate: "Inflate", carve: "Carve", skin: "Skin", hitboxes: "Hitboxes", paint: "Paint",
};

/** One stage's record: wall time and the numbers it is judged by. */
export interface StageRecord { id: StageId; label: string; ms: number; metrics: Record<string, number>; warnings: string[] }

/** The node-and-disk skeleton: the bind bones (solved A-pose), cross-section disks, the T-pose joints (display). */
export interface SkeletonStage { bones: BoneSegment[]; disks: SkeletonDisk[]; tPose: Record<BoneId, Vec3> }

/** Everything the pipeline produced, stage by stage. */
export interface StagedBody {
  spec: BodySpec;
  /** One record per StageId, in STAGE_IDS order. */
  stages: StageRecord[];
  skeleton: SkeletonStage;
  cage: Cage;
  /** Inflate output: the (clamped) volumes with no sculpt strokes (`strokes: []`). */
  plan: DetailedAnatomy;
  /** Carve output: the full plan (volumes + physique + strokes) — what generateBody returns as `.plan`. */
  carved: DetailedAnatomy;
  /** The rendered skin's field (carved). */
  field: BodyField;
  mesh: MeshData;
  meshStats: MeshStats;
  /** Skin weights (absent when the caller turned them off). */
  skin?: SkinData;
  /** Capsules fitted from the carved plan (absent when turned off). */
  hitboxes?: HitboxSet;
  /** RGB per vertex from the paint stage (absent when no paint function ran). */
  paint?: Float32Array;
}

/** Extra timings generateBody reports (BodyMesh.BodyTiming). */
export interface PipelineTiming { anatomyMs: number; polygonizeMs: number; sampleMs: number; meshBrushMs: number; statsMs: number; totalMs: number; corners: number }

export interface PipelineOptions {
  /** Polygonising cell (default: the plan's own). */
  cell?: number;
  /** Compute skin weights in the skin stage (default true). */
  weights?: boolean;
  /** Fit hitboxes (default true; ~0.3 s per new plan, cached per plan object). */
  hitboxes?: boolean;
  /** Measure hitbox coverage against every `coverageStride`-th skin vertex (default 1). */
  coverageStride?: number;
  /**
   * Paint stage: default = lane S's PaintStage.paintStage (its record is used as-is); a function
   * overrides it (RGB per vertex); false skips the stage (the record carries a warning).
   */
  paint?: false | ((mesh: MeshData, spec: BodySpec) => Float32Array);
  /** Colours for the default paint stage (hair / accent / garment; PaintStage.DEFAULT_LOOK when absent). */
  look?: PaintLook;
}

const now = () => performance.now();

/** Count the positive primitives of a tree. */
function primCount(n: SdfNode): number { return positivePrims(n).length; }

/** The full staged build (module comment). */
export function generateStaged(spec: BodySpec, opts: PipelineOptions = {}): StagedBody {
  return runPipeline(spec, opts).staged;
}

/** Shared runner (generateBody calls it with weights / hitboxes / paint off). */
export function runPipeline(spec: BodySpec, opts: PipelineOptions = {}): { staged: StagedBody; timing: PipelineTiming } {
  const rec: Partial<Record<StageId, StageRecord>> = {};
  const put = (id: StageId, ms: number, metrics: Record<string, number>, warnings: string[] = []) => {
    rec[id] = { id, label: STAGE_LABELS[id], ms, metrics, warnings };
  };
  const t0 = now();

  // ── inflate (solve): bones + volumes + sculpt, one solve (module comment) ─────────────────────
  const solved = anatomyFor(spec);
  const tSolve = now();

  // ── skeleton ──────────────────────────────────────────────────────────────────────────────────
  const disks = skeletonDisks(solved);
  const skeleton: SkeletonStage = { bones: solved.bones, disks, tPose: tPose(solved) };
  const tSkel = now();
  put("skeleton", tSkel - tSolve, {
    bones: solved.bones.length, disks: disks.length,
    armAbductionDeg: solved.armAbduction * 180 / Math.PI, legAbductionDeg: solved.legAbduction * 180 / Math.PI,
    headJointY: skeleton.tPose.head?.[1] ?? 0,
  });

  // ── cage ──────────────────────────────────────────────────────────────────────────────────────
  const cage = cageFor(solved, spec);
  const tCage = now();
  const roomMm = Object.values(cage.parts).reduce((s, p) => s + p.pos[0] + p.neg[0], 0) / Object.keys(cage.parts).length * 1000;
  put("cage", tCage - tSkel, { parts: Object.keys(cage.parts).length, meanWidthMm: roomMm });

  // ── inflate (clamp into the cage) ─────────────────────────────────────────────────────────────
  // The rendered skin (carved = skinRoot, and lane B's pre-cutter skinInflated) and B's optional stat hit
  // tree are clamped; the physics `root` IS the reference envelope and is never touched.
  const skinC = clampTree(solved.skinRoot, cage);
  const inflated = (solved as Partial<DetailedAnatomy>).skinInflated;
  const inflC = inflated && inflated !== solved.skinRoot ? clampTree(inflated, cage) : null;
  const hitC = solved.hitRoot ? clampTree(solved.hitRoot, cage) : null;
  const changed = skinC.node !== solved.skinRoot || (inflC !== null && inflC.node !== inflated) || (hitC !== null && hitC.node !== solved.hitRoot);
  const carved: DetailedAnatomy = changed
    ? {
      ...solved, skinRoot: skinC.node,
      ...(inflated !== undefined ? { skinInflated: inflC ? inflC.node : skinC.node } : {}),
      ...(hitC ? { hitRoot: hitC.node } : {}),
    }
    : solved;
  // Inflate view: the skin before the carve (B's skinInflated when present) with no sculpt strokes.
  const inflateView: DetailedAnatomy = { ...carved, skinRoot: (carved as Partial<DetailedAnatomy>).skinInflated ?? carved.skinRoot, strokes: [] };
  const after = cageMetrics(carved.skinRoot, cage);
  const afterHit = carved.hitRoot ? cageMetrics(carved.hitRoot, cage) : null;
  const tInflate = now();
  const inflateWarn: string[] = [];
  const afterInfl = (carved as Partial<DetailedAnatomy>).skinInflated ? cageMetrics((carved as DetailedAnatomy).skinInflated, cage) : null;
  const violation = Math.max(after.cageViolationMm, afterHit?.cageViolationMm ?? 0, afterInfl?.cageViolationMm ?? 0);
  if (violation > 0) inflateWarn.push(`cage violation ${violation.toFixed(2)} mm after the clamp (a segment outside its part)`);
  for (const m of [...skinC.moved, ...(inflC?.moved ?? []), ...(hitC?.moved ?? [])]) {
    if (m.shiftMm >= 1) inflateWarn.push(`${m.id} slid ${m.shiftMm.toFixed(1)} mm into its cage part (morph placed it outside)`);
  }
  put("inflate", (tSolve - t0) + (tInflate - tCage), {
    primitives: primCount(carved.skinRoot), clampedPrimitives: skinC.clamped + (inflC?.clamped ?? 0) + (hitC?.clamped ?? 0),
    cageViolationBeforeMm: Math.max(skinC.before, inflC?.before ?? 0, hitC?.before ?? 0) * 1000,
    cageViolationMm: violation, cageFill: after.cageFill, cageFillMin: after.cageFillMin,
    solveMs: tSolve - t0, cell: carved.cell,
  }, inflateWarn);

  // ── carve (extracted: the sculpt strokes + physique are part of the solve) ────────────────────
  const tCarve = now();
  const phys = carved.physique as unknown as Record<string, unknown> | null;
  put("carve", tCarve - tInflate, {
    strokes: carved.strokes.length, strokeReachMm: brushReach(carved.strokes) * 1000,
    physiqueParts: phys ? Object.values(phys).filter((v) => v !== null && v !== undefined && v !== false).length : 0,
    skinDiffersFromPhysics: carved.skinRoot === carved.root ? 0 : 1,
  });

  // ── skin ──────────────────────────────────────────────────────────────────────────────────────
  const field = skinField(carved);
  // Lane B may give the rendered skin its own (coarser) cell for the triangle budget (`skinCell`, whole
  // cells of it tile skinBounds); absent = the plan's cell, exactly as before.
  const skinCell = opts.cell ?? (carved as { skinCell?: number }).skinCell ?? carved.cell;
  const mesh = polygonizeField(field, skinBoundsOf(carved), skinCell);
  const tPoly = now();
  const sampleMs = lastPolygonizeTiming.sampleMs, corners = lastPolygonizeTiming.corners;
  applyMeshBrushes(mesh, carved.strokes);
  const tBrush = now();
  const stats = meshStats(mesh);
  const tStats = now();
  let skin: SkinData | undefined;
  let weightErr = 0;
  if (opts.weights !== false) {
    skin = computeSkinWeights(mesh, carved.bones, MAX_INFLUENCES, {
      rootBands: shoulderBands(carved.proportions.radius.deltoid, carved.cell),
    });
    for (let v = 0; v < skin.skinWeight.length / 4; v++) {
      const s = skin.skinWeight[4 * v] + skin.skinWeight[4 * v + 1] + skin.skinWeight[4 * v + 2] + skin.skinWeight[4 * v + 3];
      weightErr = Math.max(weightErr, Math.abs(1 - s));
    }
  }
  const tSkin = now();
  const skinWarn: string[] = [];
  if (stats.boundaryEdges > 0 || stats.nonManifoldEdges > 0 || stats.components !== 1) {
    skinWarn.push(`skin not closed: ${stats.boundaryEdges} boundary, ${stats.nonManifoldEdges} non-manifold, ${stats.components} components`);
  }
  put("skin", tSkin - tCarve, {
    vertices: stats.vertices, triangles: stats.triangles, boundaryEdges: stats.boundaryEdges,
    nonManifoldEdges: stats.nonManifoldEdges, components: stats.components,
    polygonizeMs: tPoly - tCarve, sampleMs, meshBrushMs: tBrush - tPoly, weightsMs: tSkin - tStats,
    weightSumMaxErr: weightErr, corners, cell: skinCell,
  }, skinWarn);

  // ── hitboxes ──────────────────────────────────────────────────────────────────────────────────
  let hitboxes: HitboxSet | undefined;
  if (opts.hitboxes !== false) {
    const th = now();
    hitboxes = hitboxesFromPlan(carved, { mass: spec.weight });
    const tFit = now();
    const cov = hitboxCoverage(hitboxes, mesh.positions, field, opts.coverageStride ?? 1);
    const tCov = now();
    put("hitboxes", tCov - th, {
      capsules: hitboxes.boxes.length, fitMs: tFit - th, coveragePct: cov.coveragePct, coverageStrictPct: cov.coverageStrictPct,
      uncoveredMaxMm: cov.uncoveredMaxMm, overshootP95Mm: cov.overshootP95Mm, overshootMaxMm: cov.overshootMaxMm,
      fromStatTree: carved.hitRoot ? 1 : 0,
    });
  } else put("hitboxes", 0, {}, ["skipped (option hitboxes: false)"]);

  // ── paint ─────────────────────────────────────────────────────────────────────────────────────
  let paint: Float32Array | undefined;
  if (typeof opts.paint === "function") {
    const tp = now();
    paint = opts.paint(mesh, spec);
    put("paint", now() - tp, { vertices: paint.length / 3 });
  } else if (opts.paint === false) {
    put("paint", 0, {}, ["skipped (option paint: false)"]);
  } else {
    const out = paintStage(mesh, spec, carved.cell, opts.look ?? {});
    paint = out.paint;
    rec.paint = { ...out.record, id: "paint", label: STAGE_LABELS.paint, warnings: [...out.record.warnings] };
  }

  const stages = STAGE_IDS.map((id) => rec[id]!);
  return {
    staged: { spec, stages, skeleton, cage, plan: inflateView, carved, field, mesh, meshStats: stats, skin, hitboxes, paint },
    timing: {
      anatomyMs: (tSolve - t0) + (tInflate - tCage), polygonizeMs: tPoly - tCarve, sampleMs, meshBrushMs: tBrush - tPoly,
      statsMs: tStats - tBrush, totalMs: tStats - t0, corners,
    },
  };
}

/** A stage record by id. */
export function stageOf(body: Pick<StagedBody, "stages">, id: StageId): StageRecord {
  return body.stages.find((s) => s.id === id)!;
}
