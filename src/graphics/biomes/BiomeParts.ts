// Per-biome mesh parts (lane S). Each builder adds at most a few meshes to ctx.group; all share
// the lighting/time uniforms in ctx.shared (one write per frame lights and animates everything).
// @deno-types="@types/three"
import * as THREE from "three";
import { CROWN_SQUASH, type BiomeSurroundings } from "../../world/biomes/Biomes.ts";
import { hash2, SURROUND_SEGMENTS, SURROUNDINGS_EXTENT } from "../../world/biomes/BiomeTables.ts";
import { packWaveUniforms } from "../../world/biomes/Waves.ts";
import {
  CANOPY_PALETTE, cloudPalette, groundPalette, MAGMA_PALETTE, rockPalette, type Rgb3, VOID_NADIR, waterPalette,
} from "./BiomePalette.ts";
import {
  type BaseRow, instancedGeometry, polarGridGeometry, polarRadii, ringBaseGeometry, trunkGeometry, tuftGeometry,
} from "./BiomeGeometry.ts";
import {
  ABYSS_FRAGMENT, BLOB_FRAGMENT, BLOB_VERTEX, CARPET_FRAGMENT, CLOUD_FRAGMENT, CLOUD_VERTEX, GRASS_FRAGMENT, GRASS_VERTEX, GROUND_FRAGMENT,
  LIQUID_VERTEX, LIT_VERTEX, MAGMA_FRAGMENT, RIM_SAMPLES, ROCK_FRAGMENT, TRUNK_VERTEX, WATER_FRAGMENT,
} from "./BiomeShaders.ts";

/** Uniform map shared by every surroundings material. */
export type SharedUniforms = Record<string, THREE.IUniform>;

/** What every part builder needs. */
export interface PartContext {
  s: BiomeSurroundings;
  shared: SharedUniforms;
  group: THREE.Group;
  rimRadiusAt: (angle: number) => number;
  /** RIM_SAMPLES rim radii by bearing, m. */
  rimArray: Float32Array;
  minRim: number;
  maxRim: number;
  /** y of the ring skirt's bottom edge, m: solids under the ring start just above it. */
  rimBottomY: number;
  /** Where the land/cliff starts for solid-outside arenas, m. */
  innerRadius: number;
  /** 0..1 instance-count scale. */
  detail: number;
  /** How far the land's inner edge sinks under lane E2's apron, m (0 when the apron is shrunk to the field edge). */
  apronTuck: number;
  /** Written by buildLiquid: the wave phase uniform update() refreshes. */
  wavePhase?: THREE.Vector4;
}

/** Waterline radius of the rock column as a multiple of the rim: the shore foam is drawn there. */
export const WATERLINE_FLARE = 1.06;
/** Grass tufts at density 1 (4 triangles each), the band they fill beyond the rim, m, and the sparse reach. */
export const GRASS_TUFTS = 2200;
export const GRASS_BAND = 14;
export const GRASS_REACH = 40;
/** Shrubs/boulders on the far land, cloud puffs, void debris (instances at detail 1). */
export const SHRUBS = 70;
export const CLOUD_PUFFS = 70;
export const VOID_DEBRIS = 36;
/** Billow height of the cloud-sea floor, m (visual only). */
export const CLOUD_BILLOW = 5;
/** Tuck under an UNSHRUNK lane E2 apron (no z-fighting where both overlap), m: use with PartContext.apronTuck. */
export const APRON_TUCK = 0.12;

const v3 = (c: Rgb3) => new THREE.Vector3(c[0], c[1], c[2]);

/** A ShaderMaterial on the shared uniforms (+ three's fog uniforms when fog is on). */
export function biomeMaterial(ctx: PartContext, vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform>, opts: { fog?: boolean; transparent?: boolean; side?: THREE.Side; depthWrite?: boolean } = {}): THREE.ShaderMaterial {
  const fog = opts.fog ?? true;
  const uniforms: Record<string, THREE.IUniform> = { ...(fog ? THREE.UniformsUtils.clone(THREE.UniformsLib.fog) : {}), ...ctx.shared, ...extra };
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, fog,
    transparent: opts.transparent ?? false, side: opts.side ?? THREE.FrontSide, depthWrite: opts.depthWrite ?? true,
  });
}

/** Add a mesh to the group (shader-displaced/instanced meshes are never frustum-culled on their rest bounds). */
export function addPart(ctx: PartContext, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, renderOrder = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `surroundings-${name}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.group.add(mesh);
  return mesh;
}

/** The solid under/around the ring: rock column, floating island, giant trunk or cliff. */
function addBase(ctx: PartContext, rows: BaseRow[], topY: number, light: Rgb3, dark: Rgb3, glow?: { y: number; color: Rgb3; strength: number }) {
  const geometry = ringBaseGeometry(rows, 96, ctx.rimRadiusAt, topY, light, dark, ctx.s.spec.seed);
  const material = biomeMaterial(ctx, LIT_VERTEX, ROCK_FRAGMENT, {
    uGlowColor: { value: v3(glow?.color ?? [0, 0, 0]) }, uGlowY: { value: glow?.y ?? 0 }, uGlow: { value: glow?.strength ?? 0 },
  });
  addPart(ctx, "base", geometry, material);
}

/** Floating-island cone under the ring (clouds, void). */
function islandRows(R: number): BaseRow[] {
  return [
    { scale: 0.995, drop: 0, jitter: 0 }, { scale: 0.92, drop: 0.12 * R, jitter: 0.8 }, { scale: 0.7, drop: 0.35 * R, jitter: 1.2 },
    { scale: 0.42, drop: 0.6 * R, jitter: 1.2 }, { scale: 0.15, drop: 0.85 * R, jitter: 0.8 }, { scale: 0, drop: 0.95 * R, jitter: 0 },
  ];
}

/** Water or magma: Gerstner surface (shared train), rock column with the shore at WATERLINE_FLARE. */
export function buildLiquid(ctx: PartContext, magma: boolean) {
  const { s } = ctx;
  const train = s.waves;
  if (!train) return;
  let fadeEnd = 60;
  for (const w of train.waves) if (Number.isFinite(w.fadeEnd)) fadeEnd = Math.max(fadeEnd, w.fadeEnd);
  const radii = polarRadii(0.9 * ctx.minRim, Math.min(fadeEnd, SURROUNDINGS_EXTENT), SURROUNDINGS_EXTENT, SURROUND_SEGMENTS);
  const geometry = polarGridGeometry(radii, SURROUND_SEGMENTS);
  const packed = packWaveUniforms(train);
  ctx.wavePhase = new THREE.Vector4();
  const shore = new Float32Array(RIM_SAMPLES);
  for (let i = 0; i < RIM_SAMPLES; i++) shore[i] = ctx.rimArray[i] * WATERLINE_FLARE;
  const common = {
    uSurfaceY: { value: s.spec.surfaceDrop }, uWaveA: { value: packed.a }, uWaveB: { value: packed.b }, uWavePhase: { value: ctx.wavePhase },
    uRimRadius: { value: shore },
  };
  let material: THREE.ShaderMaterial;
  if (magma) {
    material = biomeMaterial(ctx, LIQUID_VERTEX, MAGMA_FRAGMENT, {
      ...common, uCrust: { value: v3(MAGMA_PALETTE.crust) }, uLava: { value: v3(MAGMA_PALETTE.lava) }, uHot: { value: v3(MAGMA_PALETTE.hot) },
    });
  } else {
    const p = waterPalette(s.spec);
    material = biomeMaterial(ctx, LIQUID_VERTEX, WATER_FRAGMENT, {
      ...common, uDeep: { value: v3(p.deep) }, uShallow: { value: v3(p.shallow) }, uFoam: { value: v3(p.foam) },
      uAgitation: { value: train.agitation }, uIce: { value: p.ice },
    });
  }
  addPart(ctx, magma ? "magma" : "water", geometry, material);
  const top = ctx.rimBottomY + 0.05, depth = Math.max(0.5, top - s.spec.surfaceDrop);
  const rock = rockPalette(s.spec);
  addBase(ctx, [
    { scale: 0.995, drop: 0, jitter: 0 }, { scale: 1.015, drop: 0.35 * depth, jitter: 0.5 }, { scale: 1.04, drop: 0.8 * depth, jitter: 0.6 },
    { scale: WATERLINE_FLARE, drop: depth, jitter: 0.3 }, { scale: 1.09, drop: depth + 4, jitter: 0.5 },
  ], top, rock.light, rock.dark, magma ? { y: s.spec.surfaceDrop, color: MAGMA_PALETTE.lava, strength: 0.9 } : undefined);
}

/** Meadow / hills: far relief continuing the outside ground, grass tufts near the ring, shrubs or boulders. */
export function buildLand(ctx: PartContext) {
  const { s } = ctx;
  const pal = groundPalette(s.spec);
  const inner = ctx.innerRadius;
  const radii = polarRadii(inner, 400, SURROUNDINGS_EXTENT, 96);
  const height = (x: number, z: number) => {
    const y = s.surfaceAt(x, z, 0);
    return y - ctx.apronTuck * Math.max(0, 1 - (Math.hypot(x, z) - inner) / 20);
  };
  const ground = polarGridGeometry(radii, 96, height);
  addPart(ctx, "land", ground, biomeMaterial(ctx, LIT_VERTEX, GROUND_FRAGMENT, { uBase: { value: v3(pal.base) }, uAlt: { value: v3(pal.alt) }, uRock: { value: v3(pal.rock) } }));
  // Grass: most tufts in the GRASS_BAND beyond the rim, a sparse tail to GRASS_REACH.
  const want = Math.round(GRASS_TUFTS * pal.grassDensity * ctx.detail);
  const data = new Float32Array(want * 4);
  let n = 0;
  const seed = s.spec.seed ^ 0x2545f491;
  for (let i = 0; n < want && i < want * 3; i++) {
    const a = 2 * Math.PI * hash2(i, 1, seed), u = hash2(i, 2, seed);
    const rim = ctx.rimRadiusAt(a) + 0.5;
    const r = rim + (u < 0.8 ? GRASS_BAND * Math.pow(u / 0.8, 1.4) : GRASS_BAND + (GRASS_REACH - GRASS_BAND) * ((u - 0.8) / 0.2));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = s.surfaceAt(x, z, 0);
    if (!Number.isFinite(y)) continue;
    const slope = Math.hypot(s.surfaceAt(x + 0.5, z, 0) - y, s.surfaceAt(x, z + 0.5, 0) - y) / 0.5;
    if (!(slope < 0.9)) continue;
    const scale = (s.spec.variant === "dry" ? 0.5 : 0.35) + 0.4 * hash2(i, 3, seed);
    data.set([x, y - 0.03, z, scale], n * 4);
    n++;
  }
  const tuft = instancedGeometry(tuftGeometry(4), "aOffset", data, n);
  addPart(ctx, "grass", tuft, biomeMaterial(ctx, GRASS_VERTEX, GRASS_FRAGMENT, {
    uGrassBase: { value: v3(pal.grassBase) }, uGrassTip: { value: v3(pal.grassTip) }, uWind: { value: s.spec.agitation ?? 0 },
  }, { side: THREE.DoubleSide }));
  // Shrubs (lush/heath) or boulders (dry/snow) on the far land.
  const count = Math.round(SHRUBS * ctx.detail), blobs = new Float32Array(count * 4);
  const bush = pal.shrubs === "bush";
  const squash = bush ? 0.75 : 0.55;
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * hash2(i, 11, seed), r = Math.max(inner + 4, ctx.maxRim + 12) + 240 * Math.pow(hash2(i, 12, seed), 1.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, radius = (bush ? 0.8 : 0.6) + 1.6 * hash2(i, 13, seed);
    blobs.set([x, z, radius, s.surfaceAt(x, z, 0) + radius * squash * (bush ? 1.6 : 1.2)], i * 4);
  }
  addBlobs(ctx, "shrubs", blobs, count, 1, { squash, lump: bush ? 0.4 : 0.25, sway: bush ? 0.015 : 0, a: scaleRgb(pal.shrub, 0.7), b: scaleRgb(pal.shrub, 1.3), wrap: bush ? 0.4 : 0.1, underside: 0.4 });
}

function scaleRgb(c: Rgb3, k: number): Rgb3 {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Instanced lumpy blobs (crowns, puffs, shrubs, debris). detail 1 = 80 triangles, 0 = 20. */
function addBlobs(ctx: PartContext, name: string, data: Float32Array, count: number, detail: number, look: { squash: number; lump: number; sway: number; a: Rgb3; b: Rgb3; wrap: number; underside: number; softEdge?: number }) {
  const geometry = instancedGeometry(new THREE.IcosahedronGeometry(1, detail), "aBlob", data, count);
  const soft = look.softEdge ?? 0;
  addPart(ctx, name, geometry, biomeMaterial(ctx, BLOB_VERTEX, BLOB_FRAGMENT, {
    uSquash: { value: look.squash }, uLump: { value: look.lump }, uSway: { value: look.sway },
    uColorA: { value: v3(look.a) }, uColorB: { value: v3(look.b) }, uWrap: { value: look.wrap }, uUnderside: { value: look.underside },
    uSoftEdge: { value: soft },
  }, soft > 0 ? { transparent: true, depthWrite: false } : {}), soft > 0 ? 3 : 0);
}

/** Cloud sea: a billowed opaque floor, a translucent drifting wisp layer, cumulus heads, the floating island. */
export function buildClouds(ctx: PartContext) {
  const { s } = ctx;
  const pal = cloudPalette(s.spec);
  const [top, floorY] = s.cloudLayers;
  const cloudUniforms = (opaque: number, cover: number) => ({
    uLit: { value: v3(pal.lit) }, uShade: { value: v3(pal.shade) }, uCover: { value: cover }, uTop: { value: top }, uOpaque: { value: opaque },
  });
  const floor = polarGridGeometry(polarRadii(0.9 * ctx.minRim, 150, SURROUNDINGS_EXTENT, 96), 96);
  floor.translate(0, floorY, 0);
  addPart(ctx, "cloud-floor", floor, biomeMaterial(ctx, CLOUD_VERTEX, CLOUD_FRAGMENT, { ...cloudUniforms(1, pal.cover), uBillow: { value: CLOUD_BILLOW } }));
  const wisps = polarGridGeometry(polarRadii(0.9 * ctx.minRim, 0, SURROUNDINGS_EXTENT, 64, 1.25), 64);
  wisps.translate(0, top + 1.5, 0);
  addPart(ctx, "cloud-wisps", wisps, biomeMaterial(ctx, LIT_VERTEX, CLOUD_FRAGMENT, cloudUniforms(0, pal.cover * 0.6), { transparent: true, depthWrite: false, side: THREE.DoubleSide }), 2);
  const count = Math.round(CLOUD_PUFFS * ctx.detail), data = new Float32Array(count * 4), seed = s.spec.seed ^ 0x1b873593;
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * hash2(i, 21, seed), r = ctx.maxRim * 1.25 + 380 * Math.pow(hash2(i, 22, seed), 1.6);
    const radius = 6 + 12 * hash2(i, 23, seed);
    // Cumulus heads rising out of the sea: tops 0.6..1.5 radii above the floor.
    data.set([Math.cos(a) * r, Math.sin(a) * r, radius, floorY + radius * (0.6 + 0.9 * hash2(i, 24, seed))], i * 4);
  }
  addBlobs(ctx, "cloud-puffs", data, count, 1, {
    squash: 0.85, lump: 0.5, sway: 0, a: pal.shade, b: pal.lit, wrap: 1.5, underside: 0.2, softEdge: 0.35,
  });
  const rock = rockPalette(s.spec);
  addBase(ctx, islandRows(s.ringRadius), ctx.rimBottomY + 0.05, rock.light, rock.dark);
}

/** Tree tops: instanced crowns + trunks, the dark forest floor, the far canopy carpet, and the trunk/cliff. */
export function buildCanopy(ctx: PartContext) {
  const { s } = ctx;
  const P = CANOPY_PALETTE;
  addBlobs(ctx, "crowns", s.crowns.subarray(0, s.crownCount * 4), s.crownCount, 1, {
    squash: CROWN_SQUASH, lump: 0.35, sway: 0.02, a: P.leafDark, b: P.leafLight, wrap: 0.35, underside: 0.55,
  });
  const trunks = instancedGeometry(trunkGeometry(5), "aBlob", s.crowns.subarray(0, s.crownCount * 4), s.crownCount);
  addPart(ctx, "trunks", trunks, biomeMaterial(ctx, TRUNK_VERTEX, BLOB_FRAGMENT, {
    uGroundY: { value: s.groundY }, uSquash: { value: CROWN_SQUASH }, uColorA: { value: v3(scaleRgb(P.bark, 0.6)) }, uColorB: { value: v3(P.bark) },
    uWrap: { value: 0.2 }, uUnderside: { value: 0.7 },
  }));
  const [, zoneOuter] = s.crownZone;
  const floorRadii = polarRadii(0.3 * ctx.minRim, 0, zoneOuter + 60, 64, 1.25);
  const floor = polarGridGeometry(floorRadii, 64, () => s.groundY, (_x, _z, out, o) => out.fill(0.45, o, o + 3));
  addPart(ctx, "forest-floor", floor, biomeMaterial(ctx, LIT_VERTEX, GROUND_FRAGMENT, {
    uBase: { value: v3(P.floor) }, uAlt: { value: v3(scaleRgb(P.floor, 1.8)) }, uRock: { value: v3(P.floor) },
  }));
  const carpet = polarGridGeometry(polarRadii(zoneOuter - 6, 400, SURROUNDINGS_EXTENT, 96), 96, () => s.carpetY);
  addPart(ctx, "carpet", carpet, biomeMaterial(ctx, LIT_VERTEX, CARPET_FRAGMENT, { uColorA: { value: v3(P.leafDark) }, uColorB: { value: v3(P.leafLight) } }));
  const rock = rockPalette(s.spec);
  if (s.spec.outsideGround) {
    const top = s.edgeY + 0.02, depth = Math.max(1, top - s.groundY), r0 = ctx.innerRadius;
    addBase(ctx, [
      { scale: 1, radius: r0, drop: 0, jitter: 0 }, { scale: 1, radius: r0 + 1.5, drop: 0.3 * depth, jitter: 1.2 },
      { scale: 1, radius: r0 + 3, drop: 0.7 * depth, jitter: 1.5 }, { scale: 1, radius: r0 + 4.5, drop: depth, jitter: 1 },
    ], top, rock.light, rock.dark);
  } else {
    const top = ctx.rimBottomY + 0.05, depth = Math.max(4, top - s.groundY), R = s.ringRadius;
    addBase(ctx, [
      { scale: 0.995, drop: 0, jitter: 0 }, { scale: 0.86, drop: 0.1 * R, jitter: 0.6 }, { scale: 0.55, drop: 0.3 * R, jitter: 0.8 },
      { scale: 0.42, drop: Math.max(0.3 * R + 1, depth - 6), jitter: 0.6 }, { scale: 0.62, drop: depth, jitter: 1.2 },
    ], top, rock.light, rock.dark);
  }
}

/** The void: a dark abyss bowl, the floating island and drifting debris for depth cues. */
export function buildVoid(ctx: PartContext) {
  const { s } = ctx;
  const bowl = new THREE.SphereGeometry(SURROUNDINGS_EXTENT * 0.8, 32, 8, 0, 2 * Math.PI, Math.PI / 2, Math.PI / 2);
  bowl.setAttribute("color", new THREE.BufferAttribute(new Float32Array(bowl.attributes.position.count * 3).fill(1), 3));
  addPart(ctx, "abyss", bowl, biomeMaterial(ctx, LIT_VERTEX, ABYSS_FRAGMENT, { uNadir: { value: v3(VOID_NADIR) }, uCentre: { value: new THREE.Vector3(0, 0, 0) } }, { fog: false, side: THREE.BackSide }), -1);
  const rock = rockPalette(s.spec);
  addBase(ctx, islandRows(s.ringRadius), ctx.rimBottomY + 0.05, rock.light, rock.dark);
  const count = Math.round(VOID_DEBRIS * ctx.detail), data = new Float32Array(count * 4), seed = s.spec.seed ^ 0x68e31da4;
  for (let i = 0; i < count; i++) {
    // Floating rock islets: big and near enough to read as depth cues (things hang in nothing here).
    const a = 2 * Math.PI * hash2(i, 31, seed), r = ctx.maxRim * 1.2 + 90 * hash2(i, 32, seed);
    data.set([Math.cos(a) * r, Math.sin(a) * r, 3 + 7 * hash2(i, 33, seed), -2 - 70 * Math.pow(hash2(i, 34, seed), 1.3)], i * 4);
  }
  addBlobs(ctx, "debris", data, count, 1, { squash: 0.75, lump: 0.45, sway: 0, a: rock.dark, b: rock.light, wrap: 0.1, underside: 0.6 });
}
