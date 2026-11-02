// Body mesh pipeline (lane A, R03): plan -> field (volumes + field brushes) -> Surface Nets
// -> mesh brushes (smooth) -> topology stats. Pure module: no THREE.

import type { AnatomyPlan, BodySpec, MeshData, MeshStats } from "./contracts.ts";
import { compileSdf, type BodyField } from "./Sdf.ts";
import { applyFieldBrushes, applyMeshBrushes } from "./Brushes.ts";
import { lastPolygonizeTiming, polygonizeField } from "./Polygonize.ts";
import { meshStats } from "./MeshStats.ts";
import { anatomyFor, type DetailedAnatomy } from "./Anatomy.ts";

/** Milliseconds per stage of one body build (wall clock, performance.now()). */
export interface BodyTiming { anatomyMs: number; polygonizeMs: number; sampleMs: number; meshBrushMs: number; statsMs: number; totalMs: number; corners: number }

/** A generated body: the plan, its final field, the skin mesh and its topology facts. */
export interface BodyMesh {
  plan: DetailedAnatomy;
  field: BodyField;
  mesh: MeshData;
  stats: MeshStats;
  timing: BodyTiming;
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

/** Polygonise a plan at `cell` (default: the plan's own) and apply its mesh brushes. */
export function meshPlan(plan: AnatomyPlan, cell = plan.cell): { mesh: MeshData; field: BodyField } {
  const field = skinField(plan);
  const mesh = polygonizeField(field, plan.bounds, cell);
  applyMeshBrushes(mesh, plan.strokes);
  return { mesh, field };
}

/** Build the whole body for a spec: anatomy, field, mesh, brushes, stats, with timings. */
export function generateBody(spec: BodySpec, cell?: number): BodyMesh {
  const t0 = performance.now();
  const plan = anatomyFor(spec);
  const t1 = performance.now();
  const field = skinField(plan); // wave V lane P: the rendered skin (natural asymmetry)
  const mesh = polygonizeField(field, plan.bounds, cell ?? plan.cell);
  const t2 = performance.now();
  const sampleMs = lastPolygonizeTiming.sampleMs, corners = lastPolygonizeTiming.corners;
  applyMeshBrushes(mesh, plan.strokes);
  const t3 = performance.now();
  const stats = meshStats(mesh);
  const t4 = performance.now();
  return {
    plan, field, mesh, stats,
    timing: { anatomyMs: t1 - t0, polygonizeMs: t2 - t1, sampleMs, meshBrushMs: t3 - t2, statsMs: t4 - t3, totalMs: t4 - t0, corners },
  };
}
