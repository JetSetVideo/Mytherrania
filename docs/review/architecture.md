# Architecture review of the overhaul's new code (R11 + R10)

Review wave, 2026-10-28, at git HEAD `a976258`. Analysis only: **no source file was edited.**
Scope: the modules the overhaul added or heavily changed, listed in §1, plus the integration seams in
`src/engine/Engine.ts`, `src/game/Skeleton.ts` and `src/physics/ArenaPhysics.ts`.
Companion file: `docs/review/new-code-vocabulary.md` (names, units, long functions, underived constants).

Every `file:line` below was read at `a976258`. Engine.ts line numbers are for its current 2,888 lines,
not the `c5b55af` snapshot that `docs/GLOSSARY.md` cites.

## 0. Commands run (real output)

| Command | Result |
|---|---|
| `deno check main.ts` | exit 0, no diagnostics |
| `deno lint` | `Checked 292 files`, exit 0 |
| `deno task audit` | `"sourceModules": 147`, `"reachableModules": 128`, 19 `unreachable`, 690 `suspiciousExports`, 0 `markers`. Exit 1, because `tools/audit.ts:86` exits 1 whenever any of those lists is non-empty. The task also rewrites `artifacts/reachability.json`. |
| `deno test --allow-read tests/mathcore_test.ts tests/world_*_test.ts tests/anim_*_test.ts tests/fx_*_test.ts tests/minimap_*_test.ts tests/ui_*_test.ts tests/paint_*_test.ts` | `ok \| 190 passed \| 0 failed (11s)` |
| `deno test --allow-read tests/body_*_test.ts tests/input_test.ts tests/moveframe_test.ts` | `ok \| 61 passed \| 0 failed (14s)` |

I also used these read-only helpers (Python, run against the source tree):
- an import-graph parser with a Tarjan cycle search;
- a brace-matching function-length counter;
- a classifier for the audit's suspicious exports. It searched each name in the module's own file, in `tests/` and in
  `tools/`.

Their outputs are quoted where they are used.

## 1. Scope and size

`docs/overhaul/BRIEF.md:97-107` lists the lanes. The table counts the files and exports in scope.
The "used by other src" column means the audit found the name in another `src/` module.
"Own-file only" means it is used only inside its own file; tests may still import it.

| Group | Files | Lines | Exports | Used by other src | Own-file only | Test-only | Dead |
|---|---|---|---|---|---|---|---|
| `src/core/MathCore.ts` | 1 | 202 | 23 | 19 | 2 | 2 | 0 |
| `src/input/*` | 3 | 293 | 19 | 12 | 7 | 0 | 0 |
| `src/world/*` | 10 | 3,037 | 129 | 65 | 57 | 4 | 3 |
| `src/game/anim/*` | 9 | 2,611 | 92 | 54 | 33 | 4 | 1 |
| `src/game/Skeleton.ts` (whole file) | 1 | 419 | 8 | 6 | 2 | 0 | 0 |
| `src/physics/ArenaPhysics.ts` (whole file) | 1 | 170 | 6 | 4 | 2 | 0 | 0 |
| `src/graphics/body/*` | 12 | 3,156 | 193 | 88 | 99 | 5 | 1 |
| `src/graphics/paint/*` | 9 | 1,735 | 114 | 64 | 43 | 5 | 2 |
| `src/graphics/fx/*` | 8 | 2,636 | 102 | 53 | 49 | 0 | 0 |
| `src/graphics/Terrain{Mesh,Paint,Outside}.ts` | 3 | 512 | 27 | 8 | 19 | 0 | 0 |
| `src/graphics/shaders/CelSkinned.ts` | 1 | 187 | 8 | 1 | 6 | 1 | 0 |
| `src/ui/{NavStack,Icons,SkillBar,Minimap}.ts` | 4 | 1,189 | 31 | 8 | 22 | 1 | 0 |
| `src/ui/minimap/*` | 5 | 1,180 | 73 | 54 | 17 | 2 | 0 |
| **Total** | **67** | **17,327** | **825** | **436** | **358** | **24** | **7** |

## 2. Layer model and the dependency graph as it is

**Target direction.** Each layer may import only from layers to its left:
**core → world/game/physics → graphics → ui → engine**. `input` sits with core: it is pure, apart from the DOM
listeners in `Input`.

Folder-level import edges among the in-scope code, with edge counts. They come from parsing every `import … from "./…ts"`.

```
engine ──► game 37, graphics 5, graphics/fx 2, graphics/body 1, graphics/shaders 1, graphics/Terrain* 1,
           ui 1, ui:Minimap 1, ui:SkillBar 1, ui/minimap 1, world 2, physics 2, input 3, core 1, audio 1
ui:Minimap ──► ui/minimap 5, game 2, core 1        ui/minimap ──► game 2, core 2      ui:SkillBar ──► ui:Icons 1
graphics/Terrain* ──► world 10, graphics/paint 4, graphics/body 2, game 1
graphics/body ──► game 12, core 4, graphics 2, graphics/paint 2, graphics/shaders 2, game/anim 1
graphics/paint ──► graphics/body 8, core 3, game 2          graphics/fx ──► game 6, core 4
game/anim ──► game 10, core 5, graphics/body 1 (▲ upward)    game ──► game/anim 1 (Skeleton → Rig)
world ──► core 6, game 3, graphics 1 (▲ upward)              physics ──► game 2, world 1
input ──► core 1
```

## 3. Imports that go the wrong way, and cycles

**Cycle search.** Tarjan over the whole `src/` import graph, counting both value and type imports, finds two
strongly connected components:
- `src/game/Birthsight.ts` ⇄ `src/game/Races.ts`. This is pre-overhaul and out of scope.
- A 10-module component: `game/AnimationCurve, AxisEnvelope, BodyGraph, BodyProfile, PartHierarchy, Skeleton,
  Skills, StanceAnim, anim/Rig, graphics/body/contracts`.

With type-only imports removed the value graph has **no** cycle. So nothing breaks at runtime, but the type
graph ties the animation lane and the body contract into the old `game/` knot.

| # | Edge (file:line) | Kind | Why it is wrong | Fix |
|---|---|---|---|---|
| A1 | `src/game/Skeleton.ts:16` → `game/anim/Rig.ts` (`JOINT_ORDER`) | value, game → its own sub-lane | The joint list belongs to the Skeleton, which defines the joints (`defaultHumanoid`, Skeleton.ts:376-393). Today the Skeleton borrows it back from the animator lane. The comment on the line ("Rig imports only TYPES from here: no runtime cycle") admits the loop. | Move `JOINT_ORDER`, `JOINT_COUNT` and `JOINT_INDEX` (Rig.ts:36-50) to a new `src/game/Joints.ts`, imported by both. Rig.ts re-exports them for one release. |
| A2 | `src/game/anim/Rig.ts:33` → `graphics/body/contracts.ts` (`BoneSegment`) | type, **game → graphics** (upward) | The animator's leg geometry (`legGeometryFromBones`, Rig.ts:222) is typed by the renderer's mesh contract. | Move `BoneSegment` and `BoneId` to `src/game/Joints.ts` (bones are skeleton data), or accept a structural `{ id; parent; head; tail }`. |
| A3 | `src/graphics/body/contracts.ts:28` → `game/Skeleton.ts` (`JointName`) | type | Closes the loop Skeleton → Rig → contracts → Skeleton. | Resolved by A1 and A2: contracts imports `JointName` from `Joints.ts`. |
| A4 | `src/world/TerrainReadability.ts:18` → `graphics/Environment.ts` | value, **world → graphics** (upward) | The module is unreachable from `main.ts` (audit) and used only by `tests/world_readability_test.ts`. It is a QA harness living in the world layer. | Move it to `tests/support/`, or inject the sun direction as a parameter. |
| A5 | `src/physics/ArenaPhysics.ts:28-29` `ArenaState.floorAt` ← `Engine.ts:506` `this.#terrainMesh.floorHeightAt` | data flow, **physics fed by a graphics product** | The floor that physics stands on is created inside `buildTerrainMesh` (TerrainMesh.ts:94). The samplers themselves are pure world code (`makeFloorSampler`, RingSurface.ts:243; `makeTerrainFloorSampler`, OutsideSurface.ts:207). Physics cannot get a terrain floor without building a THREE mesh, and ArenaPhysics.ts:28 documents the dependency as `TerrainMeshBuild.floorHeightAt`. | Add a world-level `buildArenaFloor(field, outline, opts): { ring, outside, floorHeight }`. TerrainMesh consumes it and Engine passes `floorHeight` to physics. |
| A6 | `src/world/Heightfield.ts:28`, `PathFinder.ts:23` → `game/ArenaConfig.ts`; `RingSurface.ts:20` → `game/Terrain.ts` | value, world → game (sideways) | Ring geometry (`ringRadiusAt`, `objectSize`, `insideRing`) and the material bands (`materialAt`) are world facts held in game modules. `ArenaPhysics.outline` (ArenaPhysics.ts:162) is a fourth piece of the same geometry. | Add `src/world/ArenaGeometry.ts` holding the outline, `ringRadiusAt`, `insideRing`, the inscribed radius (see §4) and the material bands. Game and physics import it. |
| A7 | `src/graphics/body/Anatomy.ts:23,245` builds `defaultHumanoid()` (value import from `game/Skeleton.ts`) | value, heavy | It builds a whole `Skeleton` (PartHierarchy, AxisEnvelope, balance, grip, face) per body, only to read each joint's `axis`. Every joint is single-axis `x` (Rig.ts:9-12). | Export a static `JOINT_AXIS: Record<JointName, "x" \| "y" \| "z">` from `Joints.ts`. |
| A8 | `graphics/body/SkinnedHumanoid.ts:26-27` → `graphics/paint/{Layers,Recipes}`, while `graphics/paint/*` → `graphics/body/contracts.ts` (8 edges) | folder-level cycle body ⇄ paint | `contracts.ts` is a shared kernel (MeshData, Region, PaintStack) but lives inside `body/`. | Split it: `src/graphics/mesh/MeshTypes.ts` (Vec3, Bounds, MeshData, MeshStats, REGIONS), `body/contracts.ts` (SDF and brush types) and `paint/contracts.ts` (PaintLayer, PaintStack, BlendMode). |
| A9 | `src/engine/Engine.ts:16` → `ui/minimap/Relief.ts` (`samplerFromGrid`) | engine → a UI sub-module | Engine reaches past the `Minimap` facade into an internal file. | Re-export `samplerFromGrid` from `Minimap.ts`, or let `Minimap.setWorld` accept a `Heightfield`-like grid. |
| A10 | `src/game/Skeleton.ts:62, 70-73` `legRoll`, written by `drive` and read by `SkinnedHumanoid.ts:289` | game object used as a mailbox | `Skeleton.drive(angles, hipRoll, ankleRoll)` stores render-only rolls that the Skeleton never reads. The Animator → rig channel goes through the gameplay object. | Pass `AnimatorOutput.hipRoll`/`ankleRoll` to `rig.update` directly, through the PresentationSystem (§6). |
| A11 | `src/graphics/body/SkinnedHumanoid.ts:28`, `src/game/anim/FootIK.ts:22` → `game/anim/Rig.ts` (`RIG_ROTATION_SIGN`) | direction OK, ownership odd | A render-sign convention lives in the animation lane. It is acceptable, but it is the second reason graphics/body depends on game/anim. | Keep it, or move it to `Joints.ts` together with A1. |

Pre-existing and not caused by the overhaul, listed for completeness: `src/physics/ArenaPhysics.ts:9-10` → game.

## 4. Duplicated maths that should use MathCore (or one shared helper)

MathCore (`src/core/MathCore.ts:16-193`) is imported by 27 files under `src/` (`grep -rln core/MathCore src`).
One of them is Engine.ts, which imports only `wrapAngle` (Engine.ts:13).

| Pattern | Copies (file:line) | Factor into |
|---|---|---|
| **Integer hash → [0, 1)**: three exported functions all named `hash01`, each with its own signature and mixing constants | `ui/minimap/Glyphs.ts:83` `hash01(x, z, i)`; `graphics/paint/Noise.ts:60, 72` `hashCell` / `hash01(seed, ix, iy, iz, salt)`; `world/HeightOps.ts:24` `hash01(ix, iz, salt)` | `MathCore.hash32(seed, a, b, c)` + `hash01`. Changing a hash changes every seeded output, so migrate each caller with a golden test (§10, step 11). |
| **Polynomial smooth min/max** (the same Quilez function, written in two algebraically equal forms) | `graphics/body/Sdf.ts:142-151` `smin` / `smax`; `game/anim/FootIK.ts:69-78` `smoothMin` / `smoothMax` | `MathCore.smin` / `smax` |
| Local `lerp` | `graphics/paint/Noise.ts:85` `mix` (the comment says it keeps the inner loop monomorphic); `world/HeightOps.ts:43-44` (bilinear); `world/Heightfield.ts:404`; `graphics/TerrainPaint.ts:194` (×3 channels) | `lerp`. Add `bilerp(a, b, c, d, u, v)` for HeightOps and Heightfield. |
| Inline smoothstep `t²(3 − 2t)` | `world/HeightOps.ts:40`; `game/anim/Gait.ts:508` | `smoothstep(0, 1, t)` |
| Inline exponential damping | `game/Skeleton.ts:252` `1 − exp(−14·dt)` (pre-existing; the overhaul's `drive` path bypasses it); `game/anim/Animator.ts:688` `1 − exp(−skillMaskLambda·h)`; `physics/ArenaPhysics.ts:143` `exp(−1.2·dt)` | `damp` |
| Local `clamp` | `game/Skeleton.ts:336-338` (pre-existing function, now also called by the new `drive` code at Skeleton.ts:206) | `MathCore.clamp` |
| Inline `max(lo, min(hi, v))` (36 regex matches in scope; Sdf.ts:128 and Brushes.ts:134 are not clamps) | e.g. `paint/Blend.ts:83, 155, 156, 172, 178`; `paint/Layers.ts:60`; `paint/Noise.ts:194`; `paint/Recipes.ts:105, 119`; `paint/Symbols.ts:117`; `body/Sdf.ts:84`; `body/SkinWeights.ts:270, 289`; `body/Brushes.ts:153`; `body/AnatomyParts.ts:56, 97, 120`; `body/Anatomy.ts:185`; `fx/FxShaders.ts:52`; `anim/Poses.ts:61`; `anim/Scenario.ts:102`; `ui/Minimap.ts:661`; `world/Heightfield.ts:439-440`; `world/PathFinder.ts:277-278`; `TerrainPaint.ts:245, 247, 262-263` | `clamp` / `clamp01` |
| Easing curves outside MathCore | `ui/minimap/MapMath.ts:416` `easeOutQuad`; `graphics/fx/FxRecipes.ts:289` `easeOutCubic`. Meanwhile `MathCore.easeInOutCubic` (MathCore.ts:54) is test-only. | Put all three easings in MathCore |
| Rate from a time | `input/MoveFrame.ts:46-48` `lambdaForRiseTime` (ln 20 / t95), next to `MathCore.lambdaFromHalfLife` (MathCore.ts:70) | Move it to MathCore |
| Pareto "vital few" fraction 0.2 | `MathCore.ts:184` (`topShare(…, topFraction = 0.2)` default) and `world/TerrainRules.ts:25` `PARETO_TOP_FRACTION` | Export `PARETO_TOP_FRACTION` from MathCore, beside `PARETO_80_20_ALPHA` (MathCore.ts:172) |
| Median by sort | `world/RingRelief.ts:166` `Float64Array.from(noise).sort()[count >> 1]` | `quantileSorted` / `summarize` |
| Rec. 709 luminance `0.2126 R + 0.7152 G + 0.0722 B` | `paint/Blend.ts:95-96` `relativeLuminance` (canonical); `TerrainPaint.ts:189, 195`; `body/FaceParts.ts:37`; `world/TerrainReadability.ts:122` (more digits); `graphics/Humanoid.ts:436` (old rig) | `relativeLuminance` |
| sRGB hex mix | `paint/Blend.ts:177` `mixHexSrgb` (dead export); `game/RaceAppearance.ts:84` `mixHex` (the one Engine uses) | Keep one |
| Nearest grid node | `world/Heightfield.ts:438-442` `nearestNode`; `world/PathFinder.ts:275-280` `#nearest` (the same three lines) | `nearestNode` |
| Node → world position | `world/Heightfield.ts:445-452` `nodeX` / `nodeZ` (dead); `world/PathFinder.ts:282-285` `#point` | Use `nodeX` / `nodeZ`, or delete them |
| **Inscribed ring radius** (min R(θ) over 16 bearings) | `engine/Engine.ts:644-648` `#ringHalf`; `world/RingRelief.ts:44-45`; `graphics/TerrainPaint.ts:103-107` `ringHalfOf`. Its counterpart `outlineMaxRadius` samples 64 bearings (`world/Heightfield.ts:176-178`). | `inscribedRadius(outline, samples)` in `world/ArenaGeometry.ts`, computed once per match |
| **Duel spawn rule** `s = min(2.5, 0.4·ringHalf)` | `engine/Engine.ts:804-806`; `world/RingRelief.ts:46` `duelSpawnPoints`. The test at `tests/world_ring_test.ts:71` asserts they "mirror the engine". | Engine calls `duelSpawnPoints` |
| Yaw toward the rival `atan2(dx, dz)` | `engine/Engine.ts:1772, 2207, 2216`; normalised again at 2074-2076 | `#facingYaw(f)` |
| Ground forward | `engine/Engine.ts:1686`: a local boolean `groundForward` that shadows the imported `MoveFrame.groundForward` (Engine.ts:84), with threshold 0.1 against MoveFrame.ts:25's 1e-4 | Call `groundForward(dir.x, dir.z, fallback)` |
| Perimeter stroke | `ui/Minimap.ts:371-387` (bake: widths ×1.9 / ×1.0 / ×0.8, dash 5 / 3.5) vs `ui/Minimap.ts:482-497` (`#drawRing`: ×1.6 / ×0.75 / ×0.8, dash 5 / 3.5) | `strokePerimeter(ctx, walled, unit, PERIMETER_STYLE)` |
| KO pose data | `game/Skeleton.ts:409-414` and `game/anim/Poses.ts:34-38`: the same 12 numbers | One table. Poses.ts imports it, or Skeleton reads `KO_POSE`. |
| Gait "landing cap" factor 1.25 | `game/anim/Gait.ts:502`; `game/anim/Animator.ts:451` (the comment there calls it "the gait's landing cap") | `LANDING_REACH_FACTOR`, exported by Gait |
| Anthropometric landmark tables | Three copies of Drillis & Contini: `paint/Patterns.ts:41` `LANDMARK_HEIGHT`; `paint/Mannequin.ts:14` `STATURE`; `fx/FxRecipes.ts:96-98` `*_SHARE` (0.818 / 0.530 / 0.259). A fourth, different canon: `body/Proportions.ts:37` `CANON_Y` (Loomis head units: shoulder 6.0/7.5 = 0.80, hip joint 3.9/7.5 = 0.52). | One `Anthropometry.ts`. Pick one canon, or derive the stature fractions from `CANON_Y`. |

## 5. Shared constants defined twice (or more)

| Quantity | Definitions (file:line) | Consequence | One source |
|---|---|---|---|
| **Body (collision) radius** | `physics/SmashPhysics.ts:16` `radius: 0.6` (the real one)<br>`engine/Engine.ts:96` `PLAYER_RADIUS = 0.5`<br>`world/TerrainRules.ts:60, 83` `bodyRadius` def 0.5 ("Engine PLAYER_RADIUS: the fighter's collision circle")<br>`graphics/Portrait.ts:9` 0.5<br>`game/anim/LegacyGeometry.ts:20` `LEGACY_BODY_RADIUS = 0.6`<br>`graphics/Humanoid.ts:59` local `BODY_RADIUS = 0.6`<br>`graphics/fx/ChargeFx.ts:50` `BODY_CENTRE_HEIGHT = 0.6` | `PLAYER_RADIUS` only sets a spawn height (vocabulary.md V-01). It also reaches A* as `agentRadius` (Engine.ts:509-510), so the path clearance is 0.1 m tighter than the 0.6 m body. Terrain derives `fairPadRadius = bodyRadius + cell` (TerrainRules.ts:424) from 0.5. FX assumes 0.6 on its own and never reads `body.radius`. | `BODY_RADIUS` in `src/core/Tuning.ts`, derived r = H/3 (magic-numbers.md T2). Engine passes `body.radius` to FX (`FxFighterSetup.centreHeight`, FxDirector.ts:45). |
| **Step height** | `world/TerrainRules.ts:78` def 0.35; `physics/ArenaPhysics.ts:105, 117` `st.stepHeight ?? 0.35` | Two defaults that drift apart silently | `TERRAIN_BASE_DEFAULTS.stepHeight` |
| **Gravity** | `physics/ArenaPhysics.ts:15` `ARENA_GRAVITY = 24`; `game/anim/Gait.ts:116` `gravity: 9.81`; `game/Ragdoll.ts:95` `GRAVITY = 22` (pre-existing) | The gait's walk/run blend (Froude, Gait.ts:203-205), the run bob `g·flight²/8` (Gait.ts:224) and the acceleration lean `atan(a/g)` (Animator.ts:413) assume Earth gravity, while bodies fall at 24 m/s². | One `GRAVITY`. If the gait should *look* Earth-like, keep 9.81 as a named `GAIT_REFERENCE_GRAVITY` with that reason. |
| **Fighter height** | `graphics/fx/FxDirector.ts:43, 104, 162`, `fx/FxRecipes.ts:242`, `fx/ChargeFx.ts:96`: default 1.7<br>`graphics/body/SkinnedHumanoid.ts:74` `DEFAULT_APPEARANCE.height` 1.7<br>`graphics/body/Proportions.ts:52` `BMI_REFERENCE = 70/(1.7·1.7)`<br>`graphics/paint/Recipes.ts:51` `BASE_STATURE = 1.75`<br>`graphics/paint/Mannequin.ts:68` default 1.8<br>magic-numbers.md T1 (ragdoll) 1.8 | Three different heights for the reference human | `BODY_HEIGHT` (one value); defaults read it |
| Rim inset 0.98·R | `physics/ArenaPhysics.ts:81, 89`; `engine/Engine.ts:539` | Scale-dependent: 0.12 m on a 6 m ring, 1.2 m on a 60 m ring (hand) | `rimRadius(θ) = R(θ) − WALL_INSET` in metres |
| "Moving" speed | `Engine.ts:2090` 0.25; `Engine.ts:2382` 0.25; `Engine.ts:1792` 0.2; `Gait.ts:143` `stillSpeed` 0.05 | Four thresholds for one state | One `MOVING_SPEED` |
| Balance tilt gain | `Engine.ts:1787` `bal * 0.6` (Animator input); `Engine.ts:2219` `balTilt * 0.6` (rig) | Must stay equal, or the IK compensates for a roll the rig never applies | `BALANCE_TILT_GAIN` |
| Sight / fog cap 60 m | `Engine.ts:1327`; `Engine.ts:1689` | Pre-existing M-P2, now copied into the minimap path | `FOG_REVEAL_MAX` |
| Skill letter keys | `Engine.ts:107-113` `SKILL_KEYS` + `SKILL_LETTER_CODES` (KeyQ/E/F twice) vs `input/Input.ts:18` `MOVE_KEYS` | Bindings are split between engine and input | `src/input/Bindings.ts` |

## 6. Engine.ts growth and what should leave it

**Measured.**
- `git show c5b55af:src/engine/Engine.ts | wc -l` gives 2,574 lines; HEAD has 2,888.
- `git diff --numstat c5b55af HEAD`: `460  146`.
- Import lines: 49 → 63.
- Lines matching a private-field declaration (`#name:` or `#name =`): 103 → 121.

`git blame c5b55af..HEAD` attributes 462 lines to the overhaul:

| Method (current lines) | New or changed lines | What is new |
|---|---|---|
| `#loop` (2006-2390, **385 lines**; it was about 345) | 86 | Minimap timer; camera-relative walk (2064-2094); rig placement from `AnimatorOutput` (2200-2219); FX update (2222-2223); footstep cadence (2378-2387) |
| fields, imports, top level | 103 | `#rigs`, `#animators`, `#animPrev`, `#groundHeight`, `#fx`, `#terrainField`, `#terrainMesh`, `#pathFinder`, `#aiPath`, `#aiSteer`, `#aiHeadingOut`, `#minimap*`, `#layout`, `#skillBar`, … |
| `#buildArena` (486-584) | 43 | Terrain mesh + physics floor + pathfinder (493-525), rim range for walls (539) |
| `#updatePose` (1748-1805) | 34 | Animator input assembly + `skeleton.drive` (1765-1794) |
| `snapshot` (2742-2887, 146 lines) | 31 | terrain / animation / minimap / FX diagnostics |
| `#drawMinimap` (1666-1696) | 30 | Fills `MinimapView` from fighters, rigs, camera, fog |
| `#startFight` (780-891) | 22 | Terrain generation with fair spots, prop y on terrain |
| `#updateHUD` | 20 | `SkillBar` views |
| `#aiHeading` (1193-1207) | 15 | A* route + steering |
| `#spawnMeshes` (693-778) | 14 | Skinned body, Animator, FX attach |

Engine now holds 14 new collaborators and wires each of them by hand. Its seam surface is about 35 imported
symbols from new modules (Engine.ts:10-17, 28-29, 84-89). The wiring falls into four cohesive clusters, each with
its own state and a narrow interface.

1. **`ArenaSystem`** (`src/engine/ArenaSystem.ts`): world, physics floor, pathfinder.
   - **Owns:** `#terrainField`, `#terrainMesh`, `#arenaState.{floorAt, stepHeight, maxClimbTan, outsideFollowsTerrain}`,
     `#pathFinder`, `#aiPath`, `#aiSteer`, `#aiHeadingOut`, the inscribed radius, and the spawn points.
   - **API:**
     - `build(cfg, rng, spectate): { spawns }`
     - `floorHeight(x, z)` (finite, replaces `#groundHeight`, Engine.ts:137-140)
     - `inscribedRadius`
     - `heading(f, tx, tz, dt, out)` (replaces `#aiHeading`, 1193-1207)
     - `rimRange()`
     - `info()` (snapshot terrain block, 2750-2760)
   - **Moves out of Engine:** 137-140, 234-245, 493-526 and 539, 644-648, 803-812, 1193-1207, 2750-2760.
   - **Keeps in Engine:** wall and prop meshes, until they move too.
2. **`FighterPresentation`** (`src/engine/FighterPresentation.ts`): rigs, animators, FX, auras.
   - **Owns:** `#rigs`, `#animators`, `#animPrev`, `#fx`, `#auras`.
   - **API:**
     - `spawn(f, profile, appearance, element, weapon)` (693-778)
     - `animate(f, rival, animState, dt, floorHeight)`. This is the Animator branch of `#updatePose`, 1765-1794, built on a
       pure, testable `animatorInputFor(…)`.
     - `place(f, rival, hop)` (2200-2223)
     - `beginSkill`, `impact` and `endSkill` (forward to FX: 1048, 1072, 1101)
     - `cost()`, `clear()`
   - Engine stops reading `rig.plan.bones` to build Animators (Engine.ts:755-756). A factory
     `animatorForRig(rig, limits)` hides the bone ids and the `?? 0.08` fallback.
3. **`HudSystem`** (`src/engine/HudSystem.ts`): minimap, skill bar, hints.
   - **Owns:** `#minimap`, `#minimapView`, `#minimapDir`, `#minimapTimer`, `#skillBar` and its view objects, `#layout`.
   - **Moves out of Engine:** `#drawMinimap` (1666-1696), the skill part of `#updateHUD`, `#renderHints` (967-974), `#buildHUD`.
4. **`PlayerLocomotion`** (`src/engine/PlayerLocomotion.ts`).
   - **Owns:** `PLAYER_WALK` (Engine.ts:119), `#walkVelocity`, `#cameraForward`, and the intent → velocity block
     (2064-2094).
   - **API:** `step(input, pad, camera, surface, dt): { vx, vz, moving }`.
   - Footsteps (2378-2387) should be driven by `AnimatorOutput.footPlant` (Animator.ts, `AnimatorOutput`), not by the
     parallel cadence line `1.8 + 0.18·v`. That is a behaviour change (§10, step 11).

Also move the QA `snapshot` (146 lines) into `src/engine/QaSnapshot.ts` as a function of the systems' `info()` objects.
Together these clusters account for roughly 300 to 400 of Engine's lines (by hand from the ranges above). The
pre-overhaul splits F-1…F-9 in `docs/review/vocabulary.md` still apply on top of this.

## 7. Dead and test-only exports introduced by the overhaul

The audit lists 690 suspicious exports in total, and 389 in scope. A suspicious export is one whose name appears in no other `src/` module,
`main.ts` or `tools/arena.ts` (tools/audit.ts:36-46). I sorted the 389 in-scope names into four groups:

- **Dead (7)**: no reference anywhere, in the module itself, `tests/` or `tools/`.
  - `world/Heightfield.ts:430` `slopeAt`, `:445` `nodeX`, `:450` `nodeZ`
  - `game/anim/Rig.ts:106` `clampToLimits`
  - `graphics/paint/Patterns.ts:382` `samplePattern`
  - `graphics/paint/Blend.ts:177` `mixHexSrgb`
  - `graphics/body/BodyMesh.ts:29` `meshPlan`
- **Test-only (24)**: referenced only from `tests/`.
  - `MathCore` `easeInOutCubic`, `dampAngle`
  - `anim/LegacyGeometry` `legacyLegGeometryFor`
  - `anim/Rig` `newLegFK`
  - `anim/Scenario` `derivedSpeedBound`, `runScenario`
  - `body/Brushes` `FIELD_BRUSHES`, `MESH_BRUSHES`
  - `body/MeshStats` `windingConflicts`, `signedVolume`
  - `body/Sdf` `fieldToFunction`
  - `paint/Blend` `compositeChannel`
  - `paint/Mannequin` `mannequinMesh`
  - `paint/Patterns` `PATTERN_KINDS`
  - `paint/Relevance` `insideBounds`, `relevanceReport`
  - `shaders/CelSkinned` `CEL_SKINNED_SHADERS`
  - `ui/Icons` `ICON_NAMES`
  - `ui/minimap/MapMath` `mapToWorld`, `isNiceNumber`
  - `world/Heightfield` `circleOutline`, `flatHeightfield`
  - `world/PathFinder` `findPath`
  - `world/TerrainReadability` `noonSuns`
- **Own-file only (358)**: exported but used only inside their own module. Some of them are also imported by
  tests. The largest counts:
  - `body/AnatomyParts.ts` 28
  - `fx/FxRecipes.ts` 26
  - `body/Proportions.ts` 17
  - `TerrainPaint.ts` 15
  - `paint/Recipes.ts` 14
  - `ui/Minimap.ts` 13
  - `world/TerrainReadability.ts` 11
  - `world/TerrainRules.ts` 11
  - `body/Brushes.ts` 11
  - `body/SkinWeights.ts` 11
- **Tools-only:** none.

**Unreachable modules in scope** (audit `unreachable`). These are test harnesses shipped under `src/`:
- `src/world/TerrainReadability.ts`, used by `tests/world_readability_test.ts`
- `src/game/anim/Scenario.ts`, used by `tests/anim_animator_test.ts`
- `src/game/anim/Measure.ts`, used only by Scenario.ts:15
- `src/game/anim/LegacyGeometry.ts`, used by `tests/anim_{animator,gait,footik}_test.ts`. It copies buildHumanoid's equations
  (LegacyGeometry.ts:5-12).
- `src/graphics/paint/Mannequin.ts`, used by `tests/paint_{layers,recipes}_test.ts`

**Stale contract.** The producer signatures in `graphics/body/contracts.ts:10-26` have drifted from the code:
- `anatomyFor` returns `DetailedAnatomy` (Anatomy.ts:179), not `AnatomyPlan`.
- `polygonize`, `computeSkinWeights` and `paintVertices` gained options parameters (Polygonize.ts:99,
  SkinWeights.ts:280, Layers.ts:50).

**Recommendation.**
1. Delete the 7 dead exports.
2. Move the 5 harness modules to `tests/support/`.
3. For own-file-only names that a test needs, prefer testing through the public function. Otherwise keep the export and
   tag it `/** @internal exported for tests */`.
4. Teach `tools/audit.ts` to read `tests/` as a separate "test-only" class, so the 690 becomes an actionable list.

## 8. Public API surface per module (what Engine and the other layers actually use)

| Module | Entry points used outside the module (from imports) |
|---|---|
| `core/MathCore` | `clamp, clamp01, lerp, smoothstep, smootherstep, damp, lambdaFromHalfLife, lerpAngle, wrapAngle, springStep/Spring, summarize/Summary, normalizeMinMax, topShare, paretoSample, PARETO_80_20_ALPHA, rng32` |
| `input/*` | `Input` (`MoveAxes`, `axes`); `MoveFrame.groundForward / worldDirection / stepVelocity / MoveTuning / GroundDir`; `KeyboardLayout.LayoutDetector / detectFromBrowser / keyLabel / movementLabel / Layout` |
| `world/*` → Engine | `generateArenaTerrain, heightAt, outlineFromArena, Heightfield` (Engine.ts:87); `GridPathFinder, obstaclesFromProps, steerAlongPath, PathCursor, PathPoint, Steer` (Engine.ts:88); `settleOnFloor` (via ArenaPhysics.ts:12) |
| `graphics/Terrain*` → Engine | `buildTerrainMesh, TerrainMeshBuild` (Engine.ts:89) |
| `game/anim` → Engine | `Animator` (Engine.ts:11); `legGeometryFromBones, limitTableFrom` (Engine.ts:12). `RIG_ROTATION_SIGN` is used by graphics/body and FootIK. |
| `graphics/body` → Engine | `buildSkinnedHumanoid, SkinnedExtras` (Engine.ts:10) |
| `graphics/fx` → Engine | `FxDirector` (Engine.ts:28); `FX_DENSITY, fxDensityForLuminosity` (Engine.ts:29) |
| `ui/*` → Engine | `Minimap, createMinimapView` (Engine.ts:15); `samplerFromGrid` (Engine.ts:16, see A9); `SkillBar, SkillView` (Engine.ts:17) |
| `physics/ArenaPhysics` → Engine | `edgeDistance, outline, stepArenaBody, ArenaState` (Engine.ts:5) |
| `game/Skeleton` (new surface) | `drive(angles, hipRoll?, ankleRoll?)`, `isDriven()`, `legRoll` |

The ratio of exports to externally used names is about 2:1 (825 : 436). The real surfaces are small. FxDirector is
the model to follow: one object, with its contract documented in its header (FxDirector.ts:9-17).

## 9. Proposed target structure

```
src/
  core/      MathCore.ts (+ hash32/hash01, smin/smax, easeOut*, lambdaForRiseTime, PARETO_TOP_FRACTION)
             Tuning.ts (BODY_HEIGHT, BODY_RADIUS, GRAVITY, MOVING_SPEED … — the magic-numbers.md §0 bases)
  input/     Input.ts, KeyboardLayout.ts, MoveFrame.ts, Bindings.ts (MOVE_KEYS + SKILL_KEYS + SKILL_LETTER_CODES)
  world/     ArenaGeometry.ts (ringRadiusAt, insideRing, outline, inscribedRadius, objectSize, material bands)
             Heightfield.ts, HeightOps.ts, TerrainRules.ts, TerrainFeatures.ts, RingRelief.ts,
             RingSurface.ts, OutsideSurface.ts, ArenaFloor.ts (floor samplers, no THREE), TerrainGround.ts,
             PathFinder.ts
  physics/   SmashPhysics.ts, ArenaPhysics.ts (floor from world/ArenaFloor)
  game/      Joints.ts (JOINT_ORDER/INDEX/AXIS, JointName, BoneId, BoneSegment, RIG_ROTATION_SIGN)
             Skeleton.ts (no anim import), anim/ (Animator split into steps; no graphics import)
  graphics/  mesh/MeshTypes.ts, body/, paint/ (own contracts.ts), fx/, terrain/{TerrainMesh,TerrainPaint,
             TerrainOutside}.ts, shaders/
  ui/        Minimap.ts (facade re-exports samplerFromGrid) + minimap/, SkillBar.ts, Icons.ts, NavStack.ts,
             SkillLabels.ts (one KIND_LABEL)
  engine/    Engine.ts (orchestration), ArenaSystem.ts, FighterPresentation.ts, HudSystem.ts,
             PlayerLocomotion.ts, QaSnapshot.ts
tests/support/  Scenario.ts, Measure.ts, LegacyGeometry.ts, TerrainReadability.ts, Mannequin.ts
```

**Allowed imports.**
- core ← nothing.
- input ← core.
- world ← core.
- physics ← core, world.
- game ← core, world.
- graphics ← core, world, game.
- ui ← core, game, world (types only).
- engine ← everything.

A test can enforce this: run the audit's `edges` through a layer table and fail on an upward edge.

## 10. Refactor order (each step behaviour-preserving and testable on its own)

Run the gate below after every step.

**Gate:**
- `deno check main.ts`
- `deno lint`
- the 251 lane tests from §0 (190 + 61)
- `deno task audit`: compare the counts, not the exit code

Steps 1-10 change no numbers. Step 11 collects the deliberate behaviour changes.

| Step | Change | Proof it preserves behaviour |
|---|---|---|
| 1 | Add a layer test: parse the audit `edges` and assert no upward edge outside an allow-list that today contains A1, A2, A4, A6 and A9. | The new test passes on HEAD. Each later step deletes one allow-list entry. |
| 2 | Create `game/Joints.ts` (JOINT_ORDER/COUNT/INDEX, `JOINT_AXIS`, `BoneId`, `BoneSegment`, `RIG_ROTATION_SIGN`). Re-export from Rig.ts and contracts.ts. Skeleton.ts:16 and Anatomy.ts:245 switch to it. | The Tarjan check shows the 10-module SCC gone. anim and body tests stay green. Anatomy bone axes are identical (all `"x"`). |
| 3 | Split `contracts.ts` into mesh, body and paint contract files. Re-export from the old path. | Type-only. `deno check`. |
| 4 | MathCore additions with **identical arithmetic**: `smin/smax` (Sdf and FootIK delegate), `easeOutQuad/easeOutCubic`, `lambdaForRiseTime`, `PARETO_TOP_FRACTION`. Swap inline `max(lo, min(hi, v))` for `clamp`, `mix` for `lerp`, and the smoothstep at HeightOps.ts:40 and Gait.ts:508. | Unit tests per helper. The FootIK and Sdf tests pass. smin and smoothMin are algebraically equal, so compare them with a 1e-12 tolerance. |
| 5 | Name the equal-valued duplicates: `BODY_RADIUS = 0.6` (SmashPhysics, LegacyGeometry, ChargeFx, Humanoid); `RIM_INSET = 0.98`; `BALANCE_TILT_GAIN = 0.6`; `FOG_REVEAL_MAX = 60`; `LANDING_REACH_FACTOR = 1.25`; the stepHeight fallback from `TERRAIN_BASE_DEFAULTS`; one `KO_POSE`; one reference height for FX defaults (1.7). **Do not touch `PLAYER_RADIUS` here.** | Every value is unchanged, so every test is unchanged. |
| 6 | Add `world/ArenaGeometry.inscribedRadius` and use it in Engine `#ringHalf`, RingRelief.ts:44 and TerrainPaint.ts:103. Engine calls `duelSpawnPoints` (non-spectate). PathFinder `#nearest` → `nearestNode`. | `tests/world_ring_test.ts:71` (−2.4) and the path tests. The spawn coordinates are equal by construction. |
| 7 | Add `world/ArenaFloor.ts`: the floor sampler built without THREE. `buildTerrainMesh` consumes it, and Engine feeds physics from it. | `tests/world_ground_test.ts` and `world_mesh_test.ts`. Assert `floorHeight(x, z) === mesh.floorHeightAt(x, z)` on a grid of probes. |
| 8 | Extract `ArenaSystem`, then `FighterPresentation` (with a pure `animatorInputFor`), then `HudSystem`, then `PlayerLocomotion`, then `QaSnapshot`. One PR each. | Unit-test each pure function (`animatorInputFor` with a given body/rival/state equals today's literal). Browser QA re-runs the INTEGRATION.md R04/R07 checks (soleGap, spawns level). Not executed here. |
| 9 | Split `Animator.update` along its own nine documented steps (Animator.ts:370-617), then `stampDeliberate`, `stackFor`, `buildSkinnedHumanoid`, `stepArenaBody` and `Minimap.setWorld`. See new-code-vocabulary.md §3. | Golden comparison: record `AnimatorOutput.angles` over a `runScenario` run (and heightfield stats / paint stacks for a few seeds) before the split, and assert bitwise equality after it. |
| 10 | Delete the 7 dead exports. Move the 5 harness modules to `tests/support/`. Un-export own-file-only names that no test uses. | The audit's `unreachable` drops by 5 and `suspiciousExports` drops. `deno task test`. |
| 11 | **Deliberate behaviour changes, each its own PR, with the QA and balance harnesses re-run:**<br>• `PLAYER_RADIUS` / TerrainRules `bodyRadius` / A* `agentRadius` → `BODY_RADIUS` (V-01)<br>• gait gravity → `GRAVITY` (or a named reference g)<br>• one hash in MathCore (re-baseline seeded goldens)<br>• footsteps from `footPlant`<br>• one `MOVING_SPEED`<br>• props and A* on the drawn floor, or a documented field, height (new-code-vocabulary.md §1) | Each changes numbers by design. The before/after numbers go in INTEGRATION.md. |

## Not done / not verified

- No browser, server or build was run, so the Engine extraction (step 8) has not been exercised.
- The Tarjan cycle check and the folder edge counts come from my own regex import parser, not from `deno info`.
  `deno info` would be authoritative if anyone needs confirmation.
- I did not read every line of the 17,327 in-scope lines. `AnatomyParts.ts`, `FaceParts.ts`, `Patterns.ts`,
  `RecipeData.ts` and `Symbols.ts` were sampled through the literal scan in new-code-vocabulary.md §4, not read in full.
- Behaviour claims about gravity (§5) are read from code, not measured in a running game.
