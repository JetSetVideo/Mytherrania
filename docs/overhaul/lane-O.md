# Lane O — Camera occlusion (V01)

User ask: "improve the camera so that the objects between the character viewed and the camera are
made transparent". Status: **library + tests done and green; Engine integration is a ready patch
(`git apply --check` passes, patched Engine type-checks + lints clean); not yet seen in a browser.**

## Files

| File | Status | What |
|---|---|---|
| `src/graphics/occlusion/Corridor.ts` | new | Pure math: view corridors (cone eye→target point), sphere / capsule / oriented-box tests, fade easing, 4×4 Bayer threshold. No THREE. |
| `src/graphics/occlusion/FadeMaterials.ts` | new | Fade variants: alpha clone (built-in materials) or screen-door dither (ShaderMaterials + fighters), GLSL injection. |
| `src/graphics/occlusion/Occluders.ts` | new | `OccluderSystem`: register / clear / setSubject / update(camera, dt). |
| `src/graphics/occlusion/dev/allocBench.ts` | new | Dev-only bench (not imported by the game): µs/frame + GC count with a 1 MB young generation. |
| `src/game/CameraOcclusion.ts` | edited | + terrain clearance (`cameraClearance`, `CameraClearance`, …). Legacy `occlusionAlpha` / `blockDistance` kept (same results for finite inputs; now use MathCore `clamp`); existing `tests/cameraocclusion_test.ts` still passes. |
| `tests/occlusion_corridor_test.ts` | new | 12 tests (math, easing, dither, injection). |
| `tests/occlusion_occluders_test.ts` | new | 13 tests (THREE scene, no renderer). |
| `tests/occlusion_clearance_test.ts` | new | 6 tests (terrain). |
| `tests/occlusion_perf_test.ts` | new | 150-occluder timing (asserts median ≤ 0.1 ms). |
| `docs/overhaul/lane-O-engine.patch` | new | **Required** Engine.ts patch (git-apply-able). |
| `docs/overhaul/lane-O-wallmat.patch` | new | Optional, apply after the first: walls share ONE opaque material. |

## How it works

- **Subject + target points.** The subject is the fighter's rig root. From its bind-pose bound
  (feet at y 0) the system takes 3 points at 0.90 / 0.70 / 0.25 of its height (head, chest,
  knees), half-widths 0.05h / 0.13h / 0.08h (anthropometric fractions, in `DEFAULT_OCCLUSION_TUNING`).
  One **corridor** per point: a cone from the eye (radius = half the near-plane height) to the point
  (radius = body half-width), cut `0.15h` before the point (the body's front: anything past it is
  the body or behind it). So a crate hiding only the legs fades; a wall behind the fighter does not.
  Orthographic cameras (isometric, birds-eye) use parallel corridors along the view axis.
- **Tests per frame:** world bounding-sphere broad phase per corridor, then the shape: box (slab
  test in root space, padded by the cone radius), vertical capsule (segment–segment), sphere.
  Optional `precise: true` confirms with a central-ray `Raycaster` on the occluder's own meshes
  (e.g. an arch whose opening frames the fighter; tested).
- **Kinds** (`MIN_OPACITY`): prop 0.15, wall 0.15, terrain 0.25, fighter 0.35, weapon 0.35. The
  subject and everything inside it (its own weapon) never fade; roots named
  `/sky|void|water|ocean|lava|magma|surround/i` are refused at `register`.
- **Easing:** frame-rate independent `damp`; toward transparent half-life
  `0.3 s / log2(20) ≈ 0.069 s` (95 % in 0.3 s), back to opaque 0.25 s; snaps at a 0.004 gap so the
  ORIGINAL material comes back in finite time. Hysteresis: a fading occluder must clear the
  corridor by 0.15 m before it is released (no flicker on an edge). `dt` is clamped to 0.25 s.
- **Materials:** nothing is mutated. The first time a mesh fades, a variant is made ONCE per
  mesh material (lazily) and swapped in; swapped back when opacity returns to 1; reused next time.
  Shared materials of other objects are untouched (tested). If the game replaces a mesh's
  material meanwhile, the new one is adopted as the source. FX-like materials (non-normal
  blending, or transparent with depthWrite off) are never touched.
- **Terrain:** heightfield hills/cliffs are not faded. `CameraClearance.apply` marches the ray
  from the player's chest toward the camera; at the first point within 0.3 m of the ground the
  camera is pulled in to 0.2 m in front of it (instant, no see-through frame), or held at 1.2 m and
  lifted (0.25 m steps, ≤ 4 m) until the ray clears; eases back out with a 0.25 s half-life.
  Void (NaN height) never blocks.

### Alpha vs dither for the cel bodies / weapons — chosen: **dither**

| | alpha blend (opacity uniform) | screen-door dither (chosen) |
|---|---|---|
| Shader files to edit | CelShader, CelSkinned, WeaponMaterial (`gl_FragColor.a`) | none: the discard is injected into a CLONE's fragment source; uniforms are the source's objects (lighting stays live) |
| One-mesh skinned body | self-overlap (arm over torso, far leg) blends in triangle order unless a depth pre-pass is added (+1 draw/fighter) | depth-correct: stays in the opaque pass, depthWrite on |
| Inverted-hull ink | the back-faced hull shows THROUGH the translucent skin as a dark shell | hull discards the SAME pixels as the skin (same pattern, same uniform) → fades in lockstep |
| Sorting vs the subject | transparent pass, sorted per object | none needed |
| Shadows | unchanged | unchanged (depth pass not dithered: the fighter still casts its shadow) |
| Cost | blending | `discard` disables early-Z for the variant program only while fading; visible 4×4 stipple at DPR 1 (fine at DPR 2) and 17 levels |

Props/walls/hills keep smooth alpha (convex, FrontSide, few layers). The face parts (Lambert)
of a fading fighter get the built-in dither variant (`onBeforeCompile` + own
`customProgramCacheKey`) so the whole fighter stipples consistently.

## Exports (exact signatures)

`src/graphics/occlusion/Occluders.ts`
```ts
export type OccluderKind = "prop" | "wall" | "terrain" | "fighter" | "weapon";
export type OccluderShape = "sphere" | "box" | "capsule";
export const MIN_OPACITY: Readonly<Record<OccluderKind, number>>;
export const DEFAULT_SHAPE: Readonly<Record<OccluderKind, OccluderShape>>;   // fighter capsule, weapon sphere, else box
export const DEFAULT_STYLE: Readonly<Record<OccluderKind, FadeStyle>>;       // fighter/weapon dither, else alpha
export const NEVER_FADE_NAME: RegExp;
export interface OccluderSpec { kind: OccluderKind; shape?: OccluderShape; dynamic?: boolean; minOpacity?: number; style?: FadeStyle; precise?: boolean; radius?: number }
export interface OcclusionTuning { fadeInHalfLife; fadeOutHalfLife; snap; pointHeights: readonly number[]; pointRadii: readonly number[]; subjectDepthPerHeight; releaseMargin; maxDt; capsuleRadiusPerHeight; defaultEyeRadius }  // all number unless noted
export const DEFAULT_OCCLUSION_TUNING: Readonly<OcclusionTuning>;
export interface OcclusionStats { registered; narrowTests; blocked; fading; variantsCreated; rays }   // numbers
export class OccluderSystem {
  constructor(tuning?: Partial<OcclusionTuning>);
  readonly tuning: OcclusionTuning; readonly stats: OcclusionStats; get size(): number;
  register(root: THREE.Object3D, spec: OccluderSpec): boolean;   // false: sky/void/water name or nothing fadeable
  unregister(root: THREE.Object3D): boolean;                     // restores materials, frees variants
  clear(kinds?: readonly OccluderKind[]): void;
  setSubject(root: THREE.Object3D | null): void;                 // cheap when unchanged
  opacityOf(root: THREE.Object3D): number; isBlocked(root: THREE.Object3D): boolean;
  update(camera: THREE.Camera, dt: number): void;                // per frame, before render; allocation-free
  dispose(): void;
}
```
`src/graphics/occlusion/FadeMaterials.ts`
```ts
export type FadeStyle = "alpha" | "dither";
export const OCCLUSION_OPACITY_UNIFORM = "uOcclusionOpacity";
export const OCCLUSION_DITHER_GLSL: string; export const OCCLUSION_DITHER_DISCARD: string;
export function injectOcclusionDither(fragmentShader: string): string | null;
export interface FadeLevel { readonly opacity: number }
export interface FadeVariant { readonly material: THREE.Material; readonly source: THREE.Material; readonly style: FadeStyle; setOpacity(level: FadeLevel): void; syncFromSource(): void; dispose(): void }
export function isFadeVariant(m: THREE.Material): boolean;
export function isUnfadeable(m: THREE.Material): boolean;
export function createFadeVariant(source: THREE.Material, style: FadeStyle): FadeVariant | null;
```
`src/graphics/occlusion/Corridor.ts`
```ts
export class Corridor { ex; ey; ez; dx; dy; dz; length; tEnd; eyeRadius; targetRadius; radiusAt(t: number): number }
export const CORRIDOR_IN: { EYE: 0; TARGET: 3; EYE_RADIUS: 6; TARGET_RADIUS: 7; DEPTH: 8; LENGTH: 9 };
export function loadCorridor(c: Corridor, b: Float64Array): Corridor;
export function setCorridor(c: Corridor, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, eyeRadius: number, targetRadius: number, subjectDepth: number): Corridor;
export function corridorParamOf(c: Corridor, px: number, py: number, pz: number): number;
export interface SphereBound { wcx; wcy; wcz; wr; margin }  export interface CapsuleBound { ax; ay; az; bx; by; bz; cr; margin }
export interface BoxBound extends SphereBound { lcx; lcy; lcz; lhx; lhy; lhz; sx; sy; sz; readonly inv: { readonly elements: ArrayLike<number> } }
export function sphereBlocksCorridor(c: Corridor, s: SphereBound): boolean;
export function capsuleBlocksCorridor(c: Corridor, k: CapsuleBound): boolean;
export function boxBlocksCorridor(c: Corridor, b: BoxBound): boolean;
export const SEG: { P1: 0; Q1: 3; P2: 6; Q2: 9; S: 12; T: 13; DIST2: 14; LENGTH: 15 };
export function closestSegmentSegment(buf: Float64Array): void;
export const SLAB: { S: 0; Q: 3; HALF: 6; PAD: 9; LENGTH: 12 };
export function segmentHitsLocalBox(buf: Float64Array): boolean;
export const FADE_IN_SETTLE_TIME = 0.3, FADE_SETTLE_FRACTION = 0.95, FADE_OUT_HALF_LIFE = 0.25, FADE_SNAP = 0.004;
export const FADE_IN_HALF_LIFE: number;   // 0.3 / log2(20)
export function stepOpacity(current: number, target: number, dt: number, inHalfLife?: number, outHalfLife?: number, snap?: number): number;
export interface FadeState { opacity: number; targetOpacity: number }
export interface FadeTiming { fadeInHalfLife: number; fadeOutHalfLife: number; snap: number; dt: number }
export function stepFade(state: FadeState, timing: FadeTiming): void;
export function bayer4Threshold(x: number, y: number): number; export function ditherCoverage(opacity: number): number;
```
`src/game/CameraOcclusion.ts` (additions)
```ts
export interface Vec3Like { x: number; y: number; z: number }
export type HeightSampler = (x: number, z: number) => number;            // NaN = void
export interface ClearanceOptions { groundClearance; sampleStep; refineIterations; backoff; minDistance; maxLift; liftStep; startOffset }  // numbers
export const DEFAULT_CLEARANCE: Readonly<ClearanceOptions>;              // 0.3, 0.2, 6, 0.2, 1.2, 4, 0.25, 0.4
export interface ClearanceResult { x; y; z; fraction; lift; blocked: boolean }
export function createClearanceResult(): ClearanceResult;
export function firstGroundHit(ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, length: number, heightAt: HeightSampler, opts?: ClearanceOptions): number;
export function cameraClearance(cam: Vec3Like, target: Vec3Like, heightAt: HeightSampler, out?: ClearanceResult, opts?: ClearanceOptions): ClearanceResult;
export const CLEARANCE_RELEASE_HALF_LIFE = 0.25;
export function smoothClearance(current: number, target: number, tighter: boolean, dt: number, halfLife?: number): number;
export class CameraClearance { fraction: number; lift: number; readonly raw: ClearanceResult; readonly options: ClearanceOptions;
  constructor(options?: ClearanceOptions); apply(cam: Vec3Like, target: Vec3Like, heightAt: HeightSampler, dt: number): boolean; reset(): void }
// unchanged: occlusionAlpha(...), blockDistance(...)
```
No new MathCore helper is required (`stepFade` writes `damp` out inline on purpose, see Findings 2).

## Engine.ts integration

Apply: `git apply docs/overhaul/lane-O-engine.patch` (then optionally `docs/overhaul/lane-O-wallmat.patch`).
Both pass `git apply --check` against the current tree. Hunks (anchor → change), all self-contained:

1. Import: `import { blockDistance, occlusionAlpha } from "../game/CameraOcclusion.ts";` →
   `import { CameraClearance } from "../game/CameraOcclusion.ts";` + `import { OccluderSystem } from "../graphics/occlusion/Occluders.ts";`
2. Fields: drop `#occlusion = new Map<THREE.Mesh, number>()`; add `#occluders = new OccluderSystem()`,
   `#clearance = new CameraClearance()`, `#clearanceAim = new THREE.Vector3()` (`#wallMeshes` stays: QA clean capture).
3. `#buildArena`: after `if (this.#arenaMesh) this.#scene.remove(this.#arenaMesh);` →
   `this.#occluders.clear(["wall", "prop"]); this.#clearance.reset();`; drop `this.#occlusion.clear();`;
   wall loop: `this.#occlusion.set(seg, 1);` → after `g.add(seg);` `this.#occluders.register(seg, { kind: "wall" });`;
   props: after `` m.name = `prop-${p.kind}`; g.add(m); `` → `this.#occluders.register(m, { kind: "prop" });`
4. `#rebuildTerrain`: `this.#occluders.clear(["terrain"]);` after the remove; after each `g.add(hill);` →
   `this.#occluders.register(hill, { kind: "terrain" });` (decorative hills only exist without a heightfield).
5. `#spawnMeshes`: first line `this.#occluders.clear(["fighter", "weapon"]);`; after `this.#rigs.set(f, rig);` →
   `this.#occluders.register(rig.weaponNode, { kind: "weapon" }); this.#occluders.register(rig.group, { kind: "fighter" });`
6. Third-person branch, right after its `cam.position.set(…);` (before `cam.lookAt`):
   ```ts
   const floorAt = this.#arenaState.floorAt;
   if (floorAt) {
     this.#clearanceAim.set(p.body.x, p.body.y + 0.9, p.body.z);
     this.#clearance.apply(cam.position, this.#clearanceAim, floorAt, dt);
   }
   ```
7. `this.#updateOcclusion(cam);` → `this.#updateOcclusion(cam, dt);` and the method body becomes:
   ```ts
   #updateOcclusion(cam: THREE.Camera, dt: number): void {
     const rig = this.#rigs.get(this.#player);
     const firstPerson = this.#firstPerson && this.#activeCamera === "third";
     this.#occluders.setSubject(rig && !firstPerson ? rig.group : null);
     this.#occluders.update(cam, dt);
   }
   ```
8. `dispose()`: add `this.#occluders.dispose();`.
9. Optional (`lane-O-wallmat.patch`): wall material without `transparent: true, opacity: 1` and shared
   (`wallMat` instead of `wallMat.clone()`): 96 opaque segments instead of 96 always-transparent clones.

**Subject choice:** the third-person rig always orbits `p = this.#player` (AI-driven in spectate).
The old code used `#opponent` in spectate; with full occlusion that would fade `p` permanently
(it stands between the camera and the opponent). One line to change if the parent disagrees.

**Shader patches: none.** CelShader / CelSkinned / WeaponMaterial are untouched; the dither is
injected into clones. `tests/occlusion_occluders_test.ts` builds every one of those materials and
checks the variant compiles its source with the discard and shares the uniforms.

## Verification (real output)

```
$ deno test --allow-read tests/occlusion_corridor_test.ts tests/occlusion_occluders_test.ts tests/occlusion_clearance_test.ts tests/occlusion_perf_test.ts tests/cameraocclusion_test.ts
occlusion update, 150 occluders, 10000 frames (camera step included): mean 7.8 us, median 7.7 us, p90 8.3 us per frame; max blocked 3, max fading 3, narrow tests/frame (sampled) 0.5, variants created 5 (allocation: see src/graphics/occlusion/dev/allocBench.ts)
ok | 38 passed | 0 failed (287ms)
$ deno run --allow-read --allow-run src/graphics/occlusion/dev/allocBench.ts
150 occluders, 200000 frames: 7.73 us/frame; GCs inside the window: 3 (whole run: 29, 1 MB young generation)
$ deno lint src/graphics/occlusion src/game/CameraOcclusion.ts tests/occlusion_*_test.ts   -> Checked 9 files
$ deno check src/graphics/occlusion/*.ts src/graphics/occlusion/dev/allocBench.ts src/game/CameraOcclusion.ts tests/occlusion_*_test.ts tests/cameraocclusion_test.ts   -> no errors
patched Engine.ts (scratch copy of the tree): deno check src/engine/Engine.ts -> no errors; deno lint -> clean
$ git apply --check docs/overhaul/lane-O-engine.patch   -> OK
```
Budget ≤ 0.1 ms/frame for ~150 occluders: **met, ~0.008 ms** (Deno 2.9.7, this Apple-silicon Mac, no renderer). Before the
allocation fixes the same scene produced 94 GCs in the window (≈370 B/frame); after: 3 (sampling
attributes the residue to JIT tier-up and the final console.log).

Required tests → where: squarely-between fades to 95 % within 0.3 s (`a pillar squarely between…`);
beside / behind (incl. a wall right at the fighter's back) stay opaque; legs-only stump fades and is
proven to be the knee corridor; 30/60/144 Hz equal to 1e-9 after 0.5 s (mid-release); shared material
untouched and restored; `cameraClearance` puts the camera in front of a hill with a clear ray.

## Findings in existing code

1. **The old wall fade could never show transparency.** A wall material first rendered while
   `transparent === false` compiles with `#define OPAQUE` (`diffuseColor.a = 1.0`); toggling
   `transparent` later does not recompile (three r180 `setProgram` only rebuilds on
   `material.version`). The variants here are transparent from their first compile.
2. **TS constructor parameter properties make double field stores allocate** (V8 15.0 / Deno 2.9.7,
   measured: a class with `constructor(readonly a, readonly b)` + numeric fields → 198 scavenges vs 0
   per 12.8 M stores). Also: doubles passed to/returned from non-inlined calls are boxed. The hot
   path here therefore takes objects/Float64Arrays only. Elsewhere in `src/` only
   `src/game/anim/Measure.ts` uses parameter properties — worth a look if it is per-frame (R13).

## Not done / risks

- **Not seen in a browser** (no build allowed): stipple look at DPR 1, wall alpha look, and the
  first-fade shader compile hitch (one new program per variant kind, a few ms once) are unverified.
  Pre-warming would need the variants on hidden meshes before `renderer.compile`.
- Corridor tests are bound-based: boxes are padded conservatively at corners; weapons use a sphere
  (a long blade's sphere is loose → may fade a frame early). `precise` exists but costs CPU
  skinning on skinned meshes — keep it off for fighters.
- Subject points come from the bind-pose bound: a fighter lying down (KO) keeps the standing points.
- First person: no subject → everything eases opaque (deliberate).
- Conflicts: lane R may edit the same wall loop (`#buildArena`); the register line just needs to
  follow `g.add(seg)`. Lane S decor that can block the view (tree tops, rocks) should be registered
  as `prop`; water/lava/cloud surfaces must keep names matching `NEVER_FADE_NAME`.
- Nothing committed.
