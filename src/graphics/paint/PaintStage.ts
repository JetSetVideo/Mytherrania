// Wave GEN lane S: the pipeline's PAINT stage (contract C-PAINT, called by P's Pipeline.generateStaged).
// Pure: no THREE, no DOM. It paints exactly what the live rig paints (SkinnedHumanoid.paintSkin: lane B's
// recipe stack + the wave-V form paint + the wave-GEN miniature pass) and records the stage:
//   paint    LINEAR rgb per vertex (3 floats each) — StagedBody.paint
//   record   { id: "paint", label, ms, metrics, warnings } — a StageRecord (Pipeline.ts)
// Metrics (all numbers): vertices; layers/form/miniature ms; the ridge/cavity contrast of the paint
// against its unpainted base (Miniature.miniatureMetrics), top/bottom chiaroscuro ratios, weathered share.

import type { BodySpec, MeshData } from "../body/contracts.ts";
import { formGainsFor } from "../body/Improvise.ts";
import { applyFormShade, FORM_SKIP, vertexRings } from "./FormShade.ts";
import { paintVertices } from "./Layers.ts";
import { miniatureMetrics, miniatureTerms } from "./Miniature.ts";
import { GARMENT_REGIONS, stackFor } from "./Recipes.ts";

/** The colours the stage paints with (Appearance.hair / accent / body-as-garment). */
export interface PaintLook {
  hair?: string;
  accent?: string;
  /** The garment colour (tunic + breeches); "" paints bare skin (no cloth, no weathering). */
  garment?: string;
}

/** Used when the caller has no appearance (the pipeline's own QA bodies). */
export const DEFAULT_LOOK: Required<PaintLook> = { hair: "#3a2a1e", accent: "#dfaa55", garment: "#4f6f8a" };

/** Structurally a Pipeline StageRecord with id "paint". */
export interface PaintStageRecord {
  id: "paint";
  label: string;
  ms: number;
  metrics: Record<string, number>;
  warnings: string[];
}

export interface PaintStageOptions {
  /** Miniature gain (default 1; 0 = the wave-V paint). */
  miniature?: number;
  /** Compute the contrast metrics (default true; ~1 extra curvature pass, timed separately as metricsMs). */
  metrics?: boolean;
}

/** Paint a polygonised body and record the stage. Same output as SkinnedHumanoid.paintSkin for the same colours. */
export function paintStage(mesh: MeshData, spec: BodySpec, cell: number, look: PaintLook = {}, opts: PaintStageOptions = {}): { paint: Float32Array; record: PaintStageRecord } {
  const L = { ...DEFAULT_LOOK, ...look };
  const t0 = performance.now();
  const base = paintVertices(mesh, stackFor({
    race: spec.race, subrace: spec.subrace, className: spec.className, birthsign: spec.birthsign ?? null,
    hair: L.hair, accent: L.accent, garment: L.garment, height: spec.height, vertexSpacing: cell, seed: spec.seed,
  }));
  const t1 = performance.now();
  const garment = L.garment ? GARMENT_REGIONS : [];
  const rec: { formMs?: number; miniatureMs?: number; vertices?: number } = {};
  const paint = applyFormShade(mesh, base.slice(), { cell, garment, regionGain: formGainsFor(spec.seed), miniature: opts.miniature, record: rec });
  const t2 = performance.now();
  const n = mesh.positions.length / 3;
  const metrics: Record<string, number> = {
    vertices: n, layersMs: t1 - t0, formMs: rec.formMs ?? 0, miniatureMs: rec.miniatureMs ?? 0,
  };
  const warnings: string[] = [];
  if (opts.metrics ?? true) {
    const terms = miniatureTerms(mesh, vertexRings(mesh), { cell, garment });
    const m = miniatureMetrics(mesh, base, paint, terms, FORM_SKIP, garment);
    Object.assign(metrics, {
      ridgeRatio: m.ridge, cavityRatio: m.cavity, ridgeCavityContrast: m.contrast,
      topRatio: m.top, bottomRatio: m.bottom, weatheredShare: (opts.miniature ?? 1) > 0 ? m.weathered : 0, metricsMs: performance.now() - t2,
    });
    if ((opts.miniature ?? 1) > 0 && m.contrast <= 1) warnings.push(`ridge/cavity contrast ${m.contrast.toFixed(3)} <= 1`);
  }
  let bad = 0;
  for (let i = 0; i < paint.length; i++) if (!(paint[i] >= 0 && paint[i] <= 1)) bad++;
  if (bad > 0) warnings.push(`${bad} paint channels outside 0..1`);
  return { paint, record: { id: "paint", label: "Paint", ms: t2 - t0, metrics, warnings } };
}
