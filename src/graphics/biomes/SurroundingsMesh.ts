// SurroundingsMesh (lane S, V04): draws a Surroundings (src/world/biomes) around and below the
// arena. Built once per arena; per frame ONLY uniforms change (update), so the CPU cost is a
// handful of uniform writes and the GPU cost is <= 6 draw calls / <= 30k triangles (stats).
//
//   const mesh = buildSurroundingsMesh(surroundings, { rimRadiusAt, rimBottomY, innerRadius });
//   scene.add(mesh.group);
//   every frame: mesh.update(t, sunDirection, ambientRgb, { sunColor, zenith, horizon });
//
// `t` MUST be the same clock physics passes to surroundings.surfaceAt(x, z, t): the wave
// phases are computed from it in double precision on the CPU (Waves.wavePhasesAt) and handed
// to the shader, so the drawn water and the physical water agree.
// @deno-types="@types/three"
import * as THREE from "three";
import { createSurroundings, isBiomeSurroundings, type BiomeSurroundings } from "../../world/biomes/Biomes.ts";
import { CLOUD_DRIFT_ANGLE } from "../../world/biomes/BiomeTables.ts";
import type { Surroundings } from "../../world/biomes/contracts.ts";
import { WAVE_COUNT, wavePhasesAt } from "../../world/biomes/Waves.ts";
import { geometryTriangles } from "./BiomeGeometry.ts";
import { buildCanopy, buildClouds, buildLand, buildLiquid, buildVoid, type PartContext, type SharedUniforms } from "./BiomeParts.ts";

export { APRON_TUCK } from "./BiomeParts.ts";
import { RIM_SAMPLES } from "./BiomeShaders.ts";

/** Draw calls and triangles the surroundings may cost (docs/review/performance.md budget). */
export const SURROUNDINGS_DRAW_BUDGET = 6;
export const SURROUNDINGS_TRIANGLE_BUDGET = 30000;
/** Shader clock wrap, s: noise animation restarts once an hour (wave phases never wrap: they are exact). */
export const SHADER_TIME_WRAP = 3600;

/** An rgb triple or anything with r, g, b (THREE.Color). Linear values, light units for lights. */
export type RgbInput = readonly [number, number, number] | { r: number; g: number; b: number };

/** Optional light/sky inputs of update(). */
export interface SurroundingsLight {
  /** DirectionalLight colour x intensity (three's units). Default: unchanged. */
  sunColor?: RgbInput;
  /** Sky colours for the water's reflection (Environment zenith / horizon, linear). */
  zenith?: RgbInput;
  horizon?: RgbInput;
}

/** Build options. */
export interface SurroundingsMeshOptions {
  /** Ring outline radius at a bearing, m (Engine: (a) => ringRadiusAt(cfg, a)). Default: s.ringRadius. */
  rimRadiusAt?: (angle: number) => number;
  /** y of the ring skirt's bottom edge, m (Engine: terrainMesh.surface.skirtBottomY). Default -0.6. */
  rimBottomY?: number;
  /** Where land / cliffs start on solid-outside arenas, m (the TerrainOutside apron's outer radius). Default s.nearRadius. */
  innerRadius?: number;
  /** Ring radius, m, used only when `s` is a plain Surroundings (not from createSurroundings). Default 20. */
  ringRadius?: number;
  /** Instance-count scale 0..1 (grass, crowns are fixed by the spec; puffs, shrubs, debris, grass scale). Default 1. */
  detail?: number;
  /**
   * Sink the land's inner edge this far, m, when lane E2's flat apron still overlaps it (TerrainMesh
   * without the outsideFarRadius patch: pass APRON_TUCK = 0.12). Default 0 (apron shrunk to the field edge).
   */
  apronTuck?: number;
}

/** Per-part and total cost. */
export interface SurroundingsMeshStats {
  drawCalls: number;
  triangles: number;
  parts: { name: string; triangles: number }[];
}

/** The built surroundings. */
export interface SurroundingsMesh {
  group: THREE.Group;
  surroundings: BiomeSurroundings;
  stats: SurroundingsMeshStats;
  /** Per-frame: time (s, the physics clock), sun direction (toward the sun), ambient (AmbientLight colour x intensity). Uniform writes only. */
  update(t: number, sunDir: { x: number; y: number; z: number }, ambient: RgbInput, light?: SurroundingsLight): void;
  /** Free every geometry and material. */
  dispose(): void;
}

function setRgb(target: THREE.Vector3, c: RgbInput) {
  if (Array.isArray(c)) target.set(c[0], c[1], c[2]);
  else {
    const o = c as { r: number; g: number; b: number };
    target.set(o.r, o.g, o.b);
  }
}

/** The uniforms every surroundings material shares (one write per frame updates all of them). */
export function createSharedUniforms(windAngle: number): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() },
    uSunColor: { value: new THREE.Vector3(2.1, 2.0, 1.9) },
    uAmbient: { value: new THREE.Vector3(0.9, 0.88, 0.85) },
    uZenith: { value: new THREE.Vector3(0.16, 0.4, 0.85) },
    uHorizon: { value: new THREE.Vector3(0.62, 0.79, 0.96) },
    uWindDir: { value: new THREE.Vector2(Math.cos(windAngle), Math.sin(windAngle)) },
  };
}

/** Sum draw calls (one per mesh) and triangles (instanced counts included) under `group`. */
export function measureGroup(group: THREE.Object3D): SurroundingsMeshStats {
  const parts: { name: string; triangles: number }[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible) parts.push({ name: m.name, triangles: geometryTriangles(m.geometry) });
  });
  return { drawCalls: parts.length, triangles: parts.reduce((s, p) => s + p.triangles, 0), parts };
}

/**
 * Build the meshes of a Surroundings (see the header). Draw calls by kind: water/magma 2 (surface,
 * column), meadow/hills 3 (land, grass, shrubs), clouds 4 (floor, layers, puffs, island), canopy 5
 * (crowns, trunks, floor, carpet, trunk/cliff), void 3 (abyss, island, debris). Exact triangles: stats.
 */
export function buildSurroundingsMesh(surroundings: Surroundings, opts: SurroundingsMeshOptions = {}): SurroundingsMesh {
  const s = isBiomeSurroundings(surroundings) ? surroundings : createSurroundings(surroundings.spec, null, opts.ringRadius ?? 20);
  const rimRadiusAt = opts.rimRadiusAt ?? (() => s.ringRadius);
  const rimArray = new Float32Array(RIM_SAMPLES);
  let minRim = Infinity, maxRim = 0;
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const r = rimRadiusAt((2 * Math.PI * i) / RIM_SAMPLES);
    rimArray[i] = r;
    minRim = Math.min(minRim, r);
    maxRim = Math.max(maxRim, r);
  }
  const group = new THREE.Group();
  group.name = `surroundings-${s.spec.kind}`;
  const shared = createSharedUniforms(s.spec.windAngle ?? CLOUD_DRIFT_ANGLE);
  const ctx: PartContext = {
    s, shared, group, rimRadiusAt, rimArray, minRim, maxRim,
    rimBottomY: opts.rimBottomY ?? -0.6,
    innerRadius: opts.innerRadius ?? Math.max(s.nearRadius, maxRim),
    detail: Math.max(0, Math.min(1, opts.detail ?? 1)),
    apronTuck: Math.max(0, opts.apronTuck ?? 0),
  };
  switch (s.spec.kind) {
    case "water": buildLiquid(ctx, false); break;
    case "magma": buildLiquid(ctx, true); break;
    case "meadow": case "hills": buildLand(ctx); break;
    case "clouds": buildClouds(ctx); break;
    case "canopy": buildCanopy(ctx); break;
    case "void": buildVoid(ctx); break;
  }
  const stats = measureGroup(group);
  const phases = new Float64Array(WAVE_COUNT);
  const sunDirU = shared.uSunDir.value as THREE.Vector3;
  return {
    group, surroundings: s, stats,
    update(t, sunDir, ambient, light) {
      shared.uTime.value = ((t % SHADER_TIME_WRAP) + SHADER_TIME_WRAP) % SHADER_TIME_WRAP;
      sunDirU.set(sunDir.x, sunDir.y, sunDir.z);
      if (sunDirU.lengthSq() > 0) sunDirU.normalize();
      setRgb(shared.uAmbient.value as THREE.Vector3, ambient);
      if (light?.sunColor) setRgb(shared.uSunColor.value as THREE.Vector3, light.sunColor);
      if (light?.zenith) setRgb(shared.uZenith.value as THREE.Vector3, light.zenith);
      if (light?.horizon) setRgb(shared.uHorizon.value as THREE.Vector3, light.horizon);
      if (s.waves && ctx.wavePhase) {
        wavePhasesAt(s.waves, t, phases);
        ctx.wavePhase.set(phases[0], phases[1], phases[2], phases[3]);
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
      });
      group.removeFromParent();
    },
  };
}
