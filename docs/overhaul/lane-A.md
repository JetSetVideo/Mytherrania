# Lane A — Body (R03, R15: volumes, brushes, anatomy)

**Outcome.** Every fighter body is now ONE signed-distance field, polygonised into ONE closed,
indexed skin (Surface Nets), skinned to a `THREE.Skeleton` that follows Humanoid.ts's pivot tree,
cel-shaded with a skinning-aware surface + ink hull, and painted by lane B. For every race in
RaceGenes, every sub-race, light and heavy builds: `boundaryEdges 0, nonManifoldEdges 0,
components 1, |minY| ≤ cell/2`, flat soles, 8.4k–9.3k triangles (budget 12k). 43/43 lane-A tests pass.

Nothing outside my lane was edited (contracts.ts untouched by me; the parent's `birthsign?` is used).

## Files (all new)

| File | What |
|---|---|
| `src/graphics/body/Sdf.ts` | Exact SDFs (sphere, ellipsoid bound, capsule, roundCone, roundBox, torus) with XYZ-Euler rotation about the anchor; the 6 volume ops incl. polynomial smin/smax; region/bone ownership; compiled allocation-free evaluator with exact union culling; `BONE_IDS` order. |
| `src/graphics/body/Brushes.ts` | All 10 brushes. Field domain (inflate, deflate, dig, pushPull, pinch, crease, flatten, twist, bend) as field wrappers with falloff `w = 1 − smootherstep(0, R, |p−c|)` (MathCore); mesh domain `smooth` (Taubin λ/μ, capped at |s|·w). Every equation is in the module header. |
| `src/graphics/body/Polygonize.ts` | Surface Nets: shared vertices, indexed CCW-outward quads split on the short diagonal, tetrahedral-gradient normals, reused typed-array scratch, narrow-band block skipping, **ambiguous-face resolution** (see below), `countSignChanges`. |
| `src/graphics/body/MeshStats.ts` | `meshStats` (edge-use map + union-find), `windingConflicts`, `signedVolume`, `edgeUseCounts`. |
| `src/graphics/body/Proportions.ts` | Every number of the body derived from `BodySpec` (see "Derivation"). |
| `src/graphics/body/AnatomyParts.ts` | The anatomical volumes per part (head, neck, torso, arm, leg) and their anchors. |
| `src/graphics/body/Anatomy.ts` | `anatomyFor`: assembles one smooth-unioned body, solves limb abduction, refines the cell from a measured edge count, strokes (every brush), bones, bounds. |
| `src/graphics/body/BodyMesh.ts` | Pipeline: plan → field + field brushes → polygonise → mesh brushes → stats, with timings. |
| `src/graphics/body/SkinWeights.ts` | Region-, hierarchy- and side-aware distance-to-segment weights, top-4, normalised. |
| `src/graphics/body/FaceParts.ts` | Rigid eyes/iris/pupil, eyelids, brows, lips, tusks, hair cap + fall + mohawk, beard on the head bone; `applyFaceMorph` (Humanoid's mapping). |
| `src/graphics/body/SkinnedHumanoid.ts` | `buildSkinnedHumanoid` — HumanoidRig + `soleOffset` + `meshStats`; paints with lane B. |
| `src/graphics/shaders/CelSkinned.ts` | Cel surface + inverted hull for `SkinnedMesh` (three's skinning chunks), `vPaint` vertex colours. |
| `tests/body_sdf_test.ts`, `body_brushes_test.ts`, `body_mesh_test.ts`, `body_skin_test.ts` | 11 + 10 + 16 + 6 tests. |

## Exports (exact signatures)

**Sdf.ts** — `BONE_IDS: readonly BoneId[]` (root, spine, abdomen, neck, head, shoulderL/R, elbowL/R, hipL/R, kneeL/R, ankleL/R, toeL/R) ·
`boneIndex(id: BoneId): number` · `regionIndex(r: Region): number` ·
`sdSphere(x,y,z,r)`, `sdEllipsoid(x,y,z,rx,ry,rz)`, `sdCapsule(px,py,pz,ax,ay,az,bx,by,bz,r)`, `sdRoundCone(px,py,pz,ax,ay,az,bx,by,bz,r1,r2)`, `sdRoundBox(x,y,z,hx,hy,hz,r)`, `sdTorus(x,y,z,major,minor)`: `number` ·
`smin(a,b,k)`, `smax(a,b,k)`, `combine(op: VolumeOp, a, b, k): number` ·
`interface BodyField { sample(x, y, z, out: SdfSample): SdfSample }` ·
`primitiveBounds(p: Primitive): Bounds` · `nodeBounds(node: SdfNode): Bounds` · `compileSdf(node: SdfNode): BodyField` ·
**`evaluate(node: SdfNode, p: Vec3): SdfSample`** (contract) · `primitiveDistance(p: Primitive, at: Vec3): number` ·
`fieldFromFunction(f: (p: Vec3) => SdfSample): BodyField` · `fieldToFunction(f: BodyField): (p: Vec3) => SdfSample`

**Brushes.ts** — `FIELD_BRUSHES`, `MESH_BRUSHES: readonly BrushKind[]` · `CREASE_WIDTH_FRACTION = 0.3`, `DIG_RIM_FRACTION = 0.5`, `TAUBIN_LAMBDA = 0.5`, `TAUBIN_MU = -0.53`, `SMOOTH_PASSES = 4` ·
`brushWeight(s: BrushStroke, x, y, z): number` · `applyFieldBrush(field: BodyField, st: BrushStroke): BodyField` ·
`applyFieldBrushes(field: BodyField, strokes: readonly BrushStroke[]): BodyField` · `brushReach(strokes): number` ·
`interface Adjacency { offsets: Uint32Array; list: Uint32Array }` · `vertexAdjacency(mesh: MeshData): Adjacency` ·
`smoothMesh(mesh: MeshData, st: BrushStroke, adjacency?: Adjacency): number` · `recomputeNormals(mesh: MeshData, only?: number[]): void` ·
`applyMeshBrushes(mesh: MeshData, strokes: readonly BrushStroke[]): number`

**Polygonize.ts** — `NORMAL_STEP = 0.25`, `NARROW_BAND_BLOCK = 4`, `LIPSCHITZ_SAFETY = 1.5`, `AMBIGUITY_EPSILON = 1e-3` ·
`interface PolygonizeOptions { narrowBand?: boolean; resolveAmbiguity?: boolean }` · `interface PolygonizeTiming` · `lastPolygonizeTiming` ·
**`polygonize(field: (p: Vec3) => SdfSample, bounds: Bounds, cell: number, options?: PolygonizeOptions): MeshData`** (contract + optional options) ·
`polygonizeField(field: BodyField, bounds: Bounds, cell: number, options?: PolygonizeOptions): MeshData` · `countSignChanges(field: BodyField, bounds: Bounds, cell: number): number`

**MeshStats.ts** — **`meshStats(mesh: MeshData): MeshStats`** · `edgeUseCounts(mesh): Map<number, number>` · `windingConflicts(mesh): number` · `signedVolume(mesh): number`

**Proportions.ts** — `CANON_HEADS_TALL = 7.5`, `CANON_Y`, `CANON_LEG_TO_TORSO`, `ANKLE_PER_FOOT = 0.27`, `CANON_UPPER_ARM_PER_TORSO = 0.523`, `CANON_HAND_PER_FOREARM = 0.7`, `BMI_REFERENCE = 70/1.7²`, `GIRTH_MIN/MAX = 0.8/1.35`, `MUSCLE_GAIN = 0.2`, `TRIANGLE_TARGET = 9000`, `TRIS_PER_AREA_CELL2 = 3`, `CELL_MIN/MAX = 0.012/0.035`, `SHOULDER_OVERHANG = 0.35`, `CANON_HALF_WIDTH`, `CANON_HALF_DEPTH`, `CANON_RADIUS`, `GIRTH_EXPONENT` ·
`interface BodyProportions` · `duBoisArea(weightKg, heightM): number` · `proportionsFor(spec: BodySpec): BodyProportions`

**AnatomyParts.ts** — `BLEND_FRACTION = 0.5`, `blendWidth(r1, r2): number`, `SOLE_CONTACT = 0.45`, vector helpers `add/mul/along/sum`, `prim(...)`, `op(...)`, `LimbFrame`, `limbFrame(root, abduction, side)`, `FaceAnchors`, `ArmAnchors`, `LegAnchors`, `headNode`, `neckNode`, `torsoNode`, `armNode`, `legNode`, `ellipsoidFrontZ`.

**Anatomy.ts** — `BONE_PARENT: Record<BoneId, BoneId | null>` · `MIN_GAP_CELLS = 2`, `DISPLAY_CLEARANCE_CELLS = 0.5`, `COARSE_FACTOR = 1.5`, `CELL_TOLERANCE = 0.05`, `ARM_ABDUCTION_RANGE = [0.1, 0.9]`, `LEG_ABDUCTION_RANGE = [0, 0.35]`, `ABDUCTION_STEPS = 8`, `BOUNDS_PAD_CELLS = 2`, `SOLE_FLATTEN_CELLS = 1` ·
`interface DetailedAnatomy extends AnatomyPlan { proportions; armAbduction; legAbduction; armDisplayAbduction; face: FaceAnchors; arms; legs }` ·
**`anatomyFor(spec: BodySpec): DetailedAnatomy`** · `boneBindRoll(plan, id): number` · `boneDisplayRoll(plan, id): number`

**BodyMesh.ts** — `interface BodyTiming`, `interface BodyMesh { plan; field; mesh; stats; timing }` · `bodyField(plan: AnatomyPlan): BodyField` · `meshPlan(plan, cell?)` · `generateBody(spec: BodySpec, cell?: number): BodyMesh`

**SkinWeights.ts** — `SKIN_BLEND_FRACTION = 0.6`, `SKIN_BLEND_MIN = 0.01`, `MAX_INFLUENCES = 4`, `REGION_BONE_CLASSES` · `boneClass(id)`, `boneSide(id)`, `segmentDistance(px,py,pz,a,b)` ·
**`computeSkinWeights(mesh: MeshData, bones: BoneSegment[], maxInfluences = 4): SkinData`**

**FaceParts.ts** — `interface FaceRig` · `shade(hex, k)` · `irisColour(a: Appearance)` · `buildFaceParts(head: THREE.Object3D, face: FaceAnchors, origin: Vec3, unit: number, a: Appearance): FaceRig` · `applyFaceMorph(refs: FaceRig, f): void`

**SkinnedHumanoid.ts**
```ts
export interface SkinnedExtras {
  readonly soleOffset: number;   // group origin height above the lowest sole point of the CURRENT pose (0 in bind)
  readonly meshStats: MeshStats; readonly plan: DetailedAnatomy; readonly bones: ReadonlyMap<BoneId, THREE.Bone>;
  readonly skin: THREE.SkinnedMesh; readonly outline: THREE.SkinnedMesh; readonly timing: BodyTiming;
}
export interface SkinnedHumanoidOptions {
  paint?: false | ((mesh: MeshData) => Float32Array); levelFeet?: boolean; weaponScale?: number; garment?: string;
}
export function specFromAppearance(a: Appearance, className = "Warrior", birthsign: string | null = null, seed?: number): BodySpec
export function paintSkin(mesh: MeshData, spec: BodySpec, a: Appearance, cell: number, garment: string = a.body): Float32Array
export const BODY_CACHE_SIZE = 8;
export function buildSkinnedHumanoid(weapon: GeneratedWeapon, appearance?: Appearance, element?: Element,
  spec?: BodySpec, options?: SkinnedHumanoidOptions): HumanoidRig & SkinnedExtras
```

**CelSkinned.ts** — `CEL_INK = "#172128"`, `CEL_OUTLINE_WIDTH = 0.035` · `interface CelSkinnedOptions { specular?; vertexColors?; outlineWidth? }` ·
`createCelSkinnedSurfaceMaterial(color, opts?): THREE.ShaderMaterial` · `createCelSkinnedOutlineMaterial(opts?): THREE.ShaderMaterial` ·
`interface CelSkinnedMesh { group; surface: THREE.SkinnedMesh; outline: THREE.SkinnedMesh }` ·
`createCelSkinnedMesh(geometry, skeleton: THREE.Skeleton, color, opts?): CelSkinnedMesh` · `CEL_SKINNED_SHADERS`

## How it works (the decisions that matter)

- **One surface.** Parts are combined with `smoothUnion`, `k = 0.5 × harmonic mean of the two radii` per joint, so a
  joint is a fillet, not two tubes. Ops used for real anatomy: `subtract` (navel), `smoothSubtract` (eye sockets),
  `smoothIntersect` (flat temples), `intersect` with the half-space `y ≥ 0` (soles). One outline hull for the whole skin.
- **Soles.** Heel, forefoot and toes sink `SOLE_CONTACT = 0.45` of their height below y = 0 and the root `intersect`
  cuts them flat (contact ellipse 0.84·r per volume). Grid rows straddle y = 0 at ±cell/2, so the cut plane falls
  mid-edge and the sole vertices land exactly on 0 (probe: `minY` 0 … 0.0003 m).
- **Manifold by construction.** A Surface Nets mesh edge is used by 0, 2 or 4 quads; 4 only on an ambiguous
  (checkerboard) cell face. Before meshing every ambiguous face is resolved toward the solid (outside corner nearest
  the surface set to −ε): monotone, terminates, can merge but never split components. The test builds two spheres
  kissing diagonally: raw grid → `nonManifoldEdges > 0`, resolved → 0 (the check can fail).
- **Limb spread is solved, not tuned.** Bind pose opens legs/arms until the gap between limb and body is
  ≥ max(k, 2 cells) (no smooth-union web, resolvable by the grid). Arms are then shown lower: the **display**
  abduction is the smallest angle where forearm + hand clear hips/thighs by half a cell. The bone frames carry the
  bind roll; `update` applies `displayRoll · R_x(joint.angle)`.
- **Cell from the budget.** First estimate `c = √(3·A_DuBois / 9000)`, then refined from the measured sign-change
  count at 1.5c: `c = c0·√(2·E0 / 9000)`. Result: 8 456–9 332 triangles across all builds.
- **Derivation (R08).** `h = H / headsTall`, `headsTall = 7.5 · headToBody(human)/headToBody(race)` (RaceGenes);
  hip height from `legToTorso`; thigh:shin:foot from `thighToShin`, `footToShin`; arm chain from `armToTorso`,
  gene `foreArm.y/upperArm.y`, `handToForearm`; widths = canon (head units) × gene `part.x|z` race/human × girth^e;
  girth `G = clamp(√(BMI/24.2), 0.8, 1.35)`; shoulders from `RaceSilhouette.shoulder`, muscle from
  `RaceSilhouette.muscle`, ears/underbite from `RaceAppearance.raceBuild`. Human: `headsTall` exactly 7.5 (tested).
- **Brushes used (every kind, each with a `purpose`):** inflate "kneecap (patella) prominence", deflate "lumbar
  hollow", dig "suprasternal (clavicle) notch", pushPull "brow ridge" (+ "underbite" for orks), pinch "Achilles
  tendon", crease "spinal furrow", flatten "sole contact plane" + "sacral plane", twist "forearm pronation",
  bend "toe spring", smooth "armpit (axilla) relax".
- **Skin weights.** Candidates = dominant SDF bone + parent + children, filtered by `REGION_BONE_CLASSES` and side;
  `w = 1 − smootherstep(0, 0.6·d_min, d − d_min)`; top 4, normalised. Hand → elbow bone only (tested, and a fake
  "hand vertex on the spine" still gets only its elbow).
- **Paint (lane B).** `paintSkin` = `paintVertices(mesh, stackFor({... garment, vertexSpacing: plan.cell, birthsign }))`
  → LINEAR RGB `color` attribute; surface base colour white when painted; shader reads `color` only under
  `#ifdef USE_COLOR` into `vPaint` (never redeclared). Regions are `REGIONS` indices from the SDF primitives
  (face = face mass/jaw/cheeks/brow/nose/socket walls; ear; hand; foot; sole = the cut floor only; hair/nail unused).

## Engine.ts integration patch (parent applies; anchors from the current file)

1. Line 9, replace
```ts
import { buildHumanoid, type HumanoidRig } from "../graphics/Humanoid.ts";
```
with
```ts
import type { HumanoidRig } from "../graphics/Humanoid.ts";
import { buildSkinnedHumanoid, type SkinnedExtras } from "../graphics/body/SkinnedHumanoid.ts";
```
(`buildHumanoid` has no other use in Engine.ts — grep shows only line 652.)

2. Line 119, replace `#rigs = new Map<Fighter, HumanoidRig>();` with
```ts
  #rigs = new Map<Fighter, HumanoidRig & SkinnedExtras>();
```

3. `#spawnMeshes`, line 652 (this is the only build site; `debugSetModel` → `#startFight` → `#spawnMeshes`), replace
```ts
      const rig = buildHumanoid(generateClassWeapon(f.className), app, element);
```
with
```ts
      // One continuous SDF skin (lane A). `app.body` is the blended SKIN tone, so the
      // palette colour (appearances[i].body) is painted as the garment to tell fighters apart.
      const rig = buildSkinnedHumanoid(generateClassWeapon(f.className), app, element, {
        race: profiles[i].race, subrace: profiles[i].subrace, className: f.className,
        height: app.height, weight: app.weight, seed, birthsign: profiles[i].birthsign,
      }, { garment: appearances[i].body });
```
(`seed` is the `nameSeed(profiles[i].name)` already declared at line 641.)

4. Line 2021 (after `rig.update(f.skeleton, dt)` at 1995 in the same frame, so `soleOffset` is current), replace
```ts
      rig.group.position.set(f.body.x, f.body.y + hop, f.body.z);
```
with
```ts
      // The rig origin is the bind-pose sole plane; soleOffset drops/lifts it so the lowest
      // sole of THIS pose touches the floor (body.y − radius, the floor the ragdoll uses too).
      rig.group.position.set(f.body.x, f.body.y - f.body.radius + rig.soleOffset + hop, f.body.z);
```
Parent to confirm `f.body.y − f.body.radius` is the floor for a standing fighter (`PLAYER_RADIUS = 0.5`, line 83;
the ragdoll at line 1181 uses the same expression as its floor). `debugRigInfo`/`modelBounds` keep working: bones are
named by JointName, and `Box3.setFromObject` handles SkinnedMesh.

## Commands run (real output)

```
$ deno check src/graphics/body/*.ts src/graphics/shaders/CelSkinned.ts tests/body_*_test.ts
Check src/graphics/body/Anatomy.ts … Check tests/body_skin_test.ts   (17 files)
exit=0

$ deno lint src/graphics/body/ src/graphics/shaders/CelSkinned.ts tests/body_sdf_test.ts tests/body_brushes_test.ts tests/body_mesh_test.ts tests/body_skin_test.ts
Checked 17 files
lint exit=0

$ deno test --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch tests/body_sdf_test.ts tests/body_brushes_test.ts tests/body_mesh_test.ts tests/body_skin_test.ts
running 11 tests from ./tests/body_sdf_test.ts            … all ok
running 10 tests from ./tests/body_brushes_test.ts        … all ok
running 16 tests from ./tests/body_mesh_test.ts
meshStats can FAIL: open, two-piece and non-manifold meshes are reported ... ok (479µs)
ambiguous faces: two spheres kissing diagonally are non-manifold raw, manifold resolved ... ok (7ms)
narrow-band sampling produces the SAME mesh as sampling every corner ... ok (506ms)
human light (1.7 m, 49 kg): one closed skin, soles flat on y = 0, within budget ... ok (245ms)
human heavy (1.7 m, 98 kg): … ok (324ms)   elf light (1.77 m, 53 kg): … ok (294ms)   elf heavy (1.77 m, 107 kg): … ok (300ms)
dwarf light (1.39 m, 33 kg): … ok (284ms)  dwarf heavy (1.39 m, 66 kg): … ok (253ms)
ork light (1.9 m, 61 kg): … ok (307ms)     ork heavy (1.9 m, 123 kg): … ok (283ms)
every sub-race builds a whole skin at a mid weight ... ok (3s)
anatomy uses the volume operators and EVERY brush kind, each with a purpose ... ok (137ms)
bones: root + one per Skeleton joint, Humanoid's tree, Skeleton axes, heads inside the bounds ... ok (129ms)
proportions are derived: 7.5 heads for a human, races ordered by their genes ... ok (701ms)
running 6 tests from ./tests/body_skin_test.ts
skin weights: every vertex has ≥ 1 influence, weights sum to 1, root never used ... ok (283ms)
skin weights are region-aware and side-aware (a hand never takes torso weight) ... ok (275ms)
skinned cel shaders run three's skinning chunks and read paint without redeclaring it ... ok (1ms)
skinned humanoid: HumanoidRig contract, one clean skin, painted, bones named like the pivots ... ok (259ms)
skinned humanoid follows Humanoid's joint convention and keeps the legs exactly bound ... ok (14ms)
soleOffset tracks the lowest sole point of the current pose ... ok (19ms)
ok | 43 passed | 0 failed (8s)
```
The per-body test asserts: boundaryEdges 0, nonManifoldEdges 0, components 1, |minY| ≤ cell/2, crown within
[H − 2 cells, H + cell], triangles ≤ 12 000 (= TRIANGLE_TARGET × 4/3), 0 winding conflicts, positive volume, and per
foot ≥ 5 vertices with |y| < 0.1 cell spanning ≥ 0.35 × foot length (a sole, not a point).

### Per-race mesh stats (scratch `laneA/probe.ts`, seed 7; `arm`/`disp`/`leg` = bind/display/leg abduction rad; `near0` = vertices with |y| < 0.1 cell; ms = whole body)

| race | build | H m | kg | cell m | arm / disp / leg | verts | tris | boundary | non-manifold | comps | minY | maxY | near0 | ms (anatomy/poly) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| human | light | 1.70 | 49 | 0.0228 | 0.328 / 0.100 / 0.030 | 4424 | 8844 | 0 | 0 | 1 | 0 | 1.697 | 14 | 277 (97/171) |
| human | mid | 1.70 | 70 | 0.0246 | 0.322 / 0.127 / 0.068 | 4230 | 8456 | 0 | 0 | 1 | 0.0003 | 1.696 | 15 | 241 (91/147) |
| human | heavy | 1.70 | 98 | 0.0246 | 0.444 / 0.213 / 0.118 | 4622 | 9240 | 0 | 0 | 1 | 0.0001 | 1.696 | 15 | 279 (124/153) |
| elf | light | 1.77 | 53 | 0.0216 | 0.353 / 0.100 / 0.033 | 4492 | 8980 | 0 | 0 | 1 | 0.0001 | 1.768 | 14 | 290 (120/167) |
| elf | mid | 1.77 | 76 | 0.0225 | 0.341 / 0.122 / 0.060 | 4480 | 8960 | 0 | 0 | 1 | 0.0001 | 1.767 | 13 | 317 (146/168) |
| elf | heavy | 1.77 | 107 | 0.0240 | 0.328 / 0.172 / 0.101 | 4388 | 8772 | 0 | 0 | 1 | 0 | 1.767 | 12 | 288 (131/154) |
| dwarf | light | 1.39 | 33 | 0.0219 | 0.597 / 0.180 / 0.033 | 4498 | 8992 | 0 | 0 | 1 | 0 | 1.388 | 22 | 280 (140/138) |
| dwarf | mid | 1.39 | 47 | 0.0232 | 0.706 / 0.261 / 0.085 | 4514 | 9024 | 0 | 0 | 1 | 0 | 1.387 | 26 | 266 (127/137) |
| dwarf | heavy | 1.39 | 66 | 0.0248 | 0.841 / 0.308 / 0.152 | 4434 | 8864 | 0 | 0 | 1 | 0 | 1.387 | 24 | 252 (118/132) |
| ork | light | 1.90 | 61 | 0.0301 | 0.544 / 0.183 / 0.042 | 4454 | 8904 | 0 | 0 | 1 | 0 | 1.897 | 25 | 303 (157/144) |
| ork | mid | 1.90 | 87 | 0.0314 | 0.694 / 0.272 / 0.098 | 4668 | 9332 | 0 | 0 | 1 | 0 | 1.899 | 25 | 292 (143/146) |
| ork | heavy | 1.90 | 123 | 0.0341 | 0.850 / 0.329 / 0.178 | 4498 | 8992 | 0 | 0 | 1 | 0 | 1.897 | 21 | 273 (133/138) |

All 12 rows also had 0 directed-edge winding conflicts and positive signed volume (0.041–0.241 m³). Narrow band
sampled 47k–54k of 95k–135k corners; ambiguity resolution flipped 0–7 corners per body.

### Timing (wall clock, Deno, this Mac)
- Polygonise at the default cell: **132–171 ms** per body (grid sampling dominates), anatomy (abduction solves +
  edge count + rebuild) 91–157 ms; whole cold body 241–317 ms. Full rig incl. skin weights, paint and face parts:
  268–342 ms cold (render script, last run). A cached spec (rematch, QA swap) rebuilds in ~15 ms (`body_skin_test`: 14 ms).
- Per frame: one quaternion per bone, the face morph, and 8 sole points through ≤ 7 local matrices; no allocation.

### Visual self-check (headless rasteriser, `deno run … laneA/render.ts`)
PNGs (4 tiles each: front, side, back at all joint angles 0 = display pose, then a posed side view —
stride + attack arm — through the real rig with CPU skinning `SkinnedMesh.applyBoneTransform`):
- `/Users/macmax/.hermes/cache/scratch/laneA/human.png`
- `/Users/macmax/.hermes/cache/scratch/laneA/elf.png`
- `/Users/macmax/.hermes/cache/scratch/laneA/dwarf.png`
- `/Users/macmax/.hermes/cache/scratch/laneA/ork.png`

What the numbers prove: in every tile of every race the lowest drawn row is 404 with the ground line at 405 (soles
on the ground, including the posed view placed with `soleOffset`, e.g. human −0.0298 m, ork −0.0344 m). A vision
model was also asked about cropped tiles (human front, human posed side, dwarf front): it reported one continuous
body, limbs attached, no holes, spikes or webs, feet on the ground line, dwarf arms ~10–20° from vertical in the
display pose, and continuous skin at hips/knees/shoulder/elbow in the posed view. These tiles render the skin only
(no eyes, hair or weapon) with flat shading, not the cel shader.

## Deviations from Humanoid.ts (deliberate, flag for review)
1. **Left is +x for hips too.** Humanoid puts `hipL` at −x (shoulders at +x), so its "L" leg is on the character's
   right; the contract says +x = left, and the skinned rig follows the contract. Side effect: the walk pose
   (`hipR −0.55` with `shoulderL −0.45`) becomes contralateral, which is the natural gait.
2. **Arms are not straight down at angle 0.** They show the solved display abduction (0.10–0.33 rad), from an
   A-pose bind (0.32–0.85 rad). Hanging fully vertical would push the arm through the ribcage.
3. **Proportions are anatomical (7.5 heads for humans)** instead of Humanoid's chunky rig (head ≈ 1/5.3 of height, estimated from its part heights × its group scale).
4. **Weapon at its authored size** (`weaponScale` 1). Humanoid shows it at its group scale (≈ 0.84 for 1.70 m, estimated from its part heights).
5. The per-fighter `randomSilhouette` roll in Engine is not consumed: variation comes from height, weight, race,
   sub-race and the seed (nose/jaw jitter ±8%/±5%). An optional `silhouette` on BodySpec would be a contract change.

## Not done / not verified / risks
- **Never rendered by WebGL.** The skinned cel shaders are only checked as strings and as constructed three.js
  objects. A browser capture is needed to confirm compile and look (bands, hull width, paint).
- **The Skeleton's knee is reversed**, and the rig reproduces it exactly as Humanoid does: `kneeL −0.3` (idle rest)
  swings the shin FORWARD under R_x. With the idle knees bent, the foot pitches up and the heel lifts; `soleOffset`
  drops the body so the lowest sole point touches, but the sole is not flat. `levelFeet: true` (opt-in, tested)
  keeps the feet parallel to the ground. Lane C (gait/foot IK) owns the real fix.
- Bone tree = Humanoid's (spine at the top), so a spine angle swings the legs too. `soleOffset` keeps contact, but
  lane C may want a pelvis-rooted tree (`BONE_PARENT` is the one table to change).
- Spawn cost ~0.3 s per cold body (two fighters ≈ 0.6 s at match start). It is cached by spec; a worker or
  lower `TRIANGLE_TARGET` would cut it further.
- Hands are mittens with a thumb mass; ears, nose and fingers are limited by the 2.2–3.4 cm cell. Elf ears read as
  swept lobes, not points. Linear-blend skinning will pinch the armpit at extreme shoulder raises (the mesh-domain
  smooth brush relaxes the bind fold only).
- `soleOffset` samples 4 points per foot. In the posed tests the true lowest vertex is within 2 cells of it.
- New math helpers that MathCore could adopt: `smin`/`smax` (Sdf.ts), `segmentDistance` (SkinWeights.ts),
  `duBoisArea` (Proportions.ts).
- Scratch scripts (not in the repo): `/Users/macmax/.hermes/cache/scratch/laneA/{probe,diag,render}.ts`.
