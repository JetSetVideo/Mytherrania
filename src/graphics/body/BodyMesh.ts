// Body mesh pipeline (lane A, R03): plan -> field (volumes + field brushes) -> Surface Nets
// -> mesh brushes (smooth) -> topology stats. Pure module: no THREE.

import type { AnatomyPlan, BodySpec, MeshData, MeshStats } from "./contracts.ts";
import { compileSdf, type BodyField } from "./Sdf.ts";
import { applyFieldBrushes, applyMeshBrushes } from "./Brushes.ts";
import { polygonizeField } from "./Polygonize.ts";
import type { DetailedAnatomy } from "./Anatomy.ts";
import { runPipeline, type StageRecord } from "./Pipeline.ts";

/** Milliseconds per stage of one body build (wall clock, performance.now()). */
export interface BodyTiming { anatomyMs: number; polygonizeMs: number; sampleMs: number; meshBrushMs: number; statsMs: number; totalMs: number; corners: number }

/** A generated body: the plan, its final field, the skin mesh and its topology facts. */
export interface BodyMesh {
  plan: DetailedAnatomy;
  field: BodyField;
  mesh: MeshData;
  stats: MeshStats;
  timing: BodyTiming;
  /** Wave GEN: the pipeline's stage records (Pipeline.ts; weights/hitboxes/paint skipped here). */
  stages?: StageRecord[];
}

/** The plan's final field: the compiled volumes wrapped by every field-domain stroke. */
export function bodyField(plan: AnatomyPlan): BodyField {
  return applyFieldBrushes(compileSdf(plan.root), plan.strokes);
}

/**
 * Wave V lane P: the RENDERED skin's field — the plan's skinRoot (the mirror plus the seeded natural
 * asymmetry, Anatomy.finalSymmetryPass) wrapped by the same strokes. Physics keeps bodyField (the
 * exact mirror: Hitboxes' full-field fit reads it, so the ragdoll and the combat capsules never move).
 */
export function skinField(plan: AnatomyPlan): BodyField {
  return applyFieldBrushes(compileSdf((plan as Partial<DetailedAnatomy>).skinRoot ?? plan.root), plan.strokes);
}

/**
 * The rendered skin's polygonising box: the plan's own `bounds`, or (wave X lane B) its `skinBounds` when
 * the physique sculpt stands proud of the physics body — only while the skin IS the sculpted tree (a
 * caller that swaps `skinRoot` for the physics `root` gets the physics box back).
 */
export function skinBoundsOf(plan: AnatomyPlan): AnatomyPlan["bounds"] {
  const d = plan as Partial<DetailedAnatomy>;
  return d.skinBounds && d.skinRoot && d.skinRoot !== d.root && d.physique ? d.skinBounds : plan.bounds;
}

/** Polygonise a plan at `cell` (default: the plan's own) and apply its mesh brushes. */
export function meshPlan(plan: AnatomyPlan, cell = (plan as { skinCell?: number }).skinCell ?? plan.cell): { mesh: MeshData; field: BodyField } {
  const field = skinField(plan);
  const mesh = polygonizeField(field, skinBoundsOf(plan), cell);
  applyMeshBrushes(mesh, plan.strokes);
  return { mesh, field };
}

/**
 * Build the whole body for a spec: anatomy, field, mesh, brushes, stats, with timings. Wave GEN: this is
 * the staged pipeline (Pipeline.ts) run without skin weights, hitboxes and paint; `stages` holds its
 * records. With no `spec.stats` the plan and mesh are byte-identical to the pre-wave build (G3).
 */
export function generateBody(spec: BodySpec, cell?: number): BodyMesh {
  const { staged, timing } = runPipeline(spec, { cell, weights: false, hitboxes: false, paint: false });
  return { plan: staged.carved, field: staged.field, mesh: staged.mesh, stats: staged.meshStats, timing, stages: staged.stages };
}
