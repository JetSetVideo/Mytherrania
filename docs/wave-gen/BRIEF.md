# Wave GEN — the character generator as a staged, stat-driven pipeline (frozen contract + swarm protocol)

Repo `~/Desktop/Mytherrania`. Base commit 6a5f588 (Wave FALL). Read FIRST:
`~/.hermes/skills/software-development/mytherrania-wave/SKILL.md` (all pitfalls; the game renders
`buildSkinnedHumanoid`; added volume / moved joints break ragdoll and planted-foot bands; macOS has no `timeout`;
`BUILD_OUT=dist-<lane>` for your own build; pass test lists as separate args).

The user supplied a "master specification" for a procedural stylized character generator (WoW silhouettes +
Dragon Quest faces + Warhammer-miniature painting) and asked: compare it with what exists and improve the generator
so it has CLEAR STEPS and clean animations, hitboxes, models and textures.

## Gap analysis (parent, from the code at 6a5f588)

| Spec item | Exists | Gap this wave closes |
|---|---|---|
| SDF / metaball inflation | YES: `Sdf.ts` primitives + smooth union, `Polygonize.ts`, sculpt brushes `Brushes.ts`/`Anatomy.ts` | stages are implicit inside `generateBody`; no inspectable intermediate outputs |
| Node-and-disk skeleton along Y | bones in `Anatomy.anatomyFor` (plan.bones), solved A-pose bind | no explicit Skeleton stage / disk (cross-section) model; no T-pose inspection view |
| 6-axis bounding cage per sub-race | partial: `RaceSilhouette` width/depth/height | no ±X ±Y ±Z cage, no containment check |
| Stats 0..1000 | game stats are small (sheet ~1..20, level 1..20) | no normalised generator scale |
| Strength -> muscle volume, bone density, shoulder breadth | muscle comes from race + build + weight only | **stats do not reach the body at all** (`BodySpec` has no stats) |
| Level -> maturity, height, mass, posture | none | missing |
| Agility -> joint angle range | comment only (`Races.ts`: "agility -> wider range") | missing: limits are fixed per joint |
| Intelligence -> brow recess, hair length/density, silver | hair from ancestry + age grey (wave X) | missing |
| Sub-race posture curves (ork forward neck + trapezius, dwarf lumbar, human/elf erect) | generic `SpineCurve.ts` | missing per-race curves |
| Digit distribution per race | `Hands.ts handSize` (render-only fingers) | race differences not explicit |
| Low-poly hitbox capsules per limb | YES: `Hitboxes.hitboxesFromPlan` fitted to the SDF | no stage view, no "capsules enclose the skin" report per stage |
| Miniature painting: edge highlights, cavity shading, chiaroscuro | `paint/**` layers, `FormShade.ts`, cel shader | no curvature-driven edge highlight / cavity pass |
| QA screenshots per stage from 6 angles + dual verification | probes per wave, front/3q/side only | missing |
| UI: drag handles, neighbour-dependent clamps, live stage visualiser | steppers + race-band clamps (wave X/Y) | no drag handles, no neighbour clamps, no stage visualiser |

Deliberate deviations from the spec (parent's decision, keep them):
- **Bind pose stays the solved A-pose** (skinning, ragdoll and every rig test depend on it). The Skeleton stage is
  DISPLAYED in T-pose (arms horizontal, digits at minimal divergence) as an inspection pose.
- **Game stats are not rescaled.** `StatScale.ts` maps the game's sheet/level values onto the generator's 0..1000
  scale; the generator reads only the 0..1000 view.
- **Stat morphs are render-only and bounded.** The physics body (`Physics.bodyFromStats`), joint positions that plant
  the feet / swing the arm, and the ragdoll stay as they are unless a lane MEASURES that a change keeps the slide,
  ragdoll and hitbox bands green. Hitboxes are refitted from the final plan (they follow the visible body).
- **Absent stats = today's body, byte-identical.** The reference stat values map to zero morph.

## The pipeline (contract C-PIPE, owner P)

`src/graphics/body/Pipeline.ts` (pure, no THREE): `generateStaged(spec: BodySpec): StagedBody` and
`generateBody(spec)` keeps its signature (it calls the pipeline and returns the final stage's data).

```ts
type StageId = "skeleton" | "cage" | "inflate" | "carve" | "skin" | "hitboxes" | "paint";
interface StageRecord { id: StageId; label: string; ms: number; metrics: Record<string, number>; warnings: string[] }
interface StagedBody {
  stages: StageRecord[];                 // in order, one per StageId
  skeleton: SkeletonStage;               // bones (A-pose bind) + disks + tPose (display) — owner B
  cage: Cage;                            // six half-extents per body part, model space — owner P
  plan: DetailedAnatomy;                 // inflate output (primitives inside the cage) — owner B
  carved: DetailedAnatomy;               // after muscle carving / landmarks — owner B
  mesh: MeshData; skin: SkinData;        // polygonized + skin weights — owner P / K
  hitboxes: HitboxSet;                   // capsules fitted from the carved plan — owner P
  paint?: Float32Array;                  // vertex colours — owner S
}
interface Cage { parts: Record<string, { centre: Vec3; neg: Vec3; pos: Vec3 }> }  // -X,-Y,-Z and +X,+Y,+Z extents
interface SkeletonStage { bones: BoneSegment[]; disks: { bone: BoneId; at: Vec3; normal: Vec3; rx: number; rz: number }[]; tPose: Record<BoneId, Vec3> }
```

`BodySpec.stats?: { strength: number; agility: number; intelligence: number; level: number }` (0..1000, optional).
`src/game/StatScale.ts` (P): `generatorStats(profile | CombatStats + level): {strength, agility, intelligence, level}`
with the reference fighter -> `STAT_REFERENCE` (500 each unless measured otherwise) and monotone, clamped maps.

## Lanes (DISJOINT writes; read anything; no git commit/stash/checkout/add -A; Engine.ts is P's)

| agent | owns |
|---|---|
| **P — architect + mathematician** | new `src/graphics/body/Pipeline.ts`, new `src/graphics/body/Cage.ts`, new `src/game/StatScale.ts`, `src/graphics/body/{BodyMesh,Sdf,Polygonize,MeshStats,contracts}.ts`, `src/combat/Hitboxes.ts`, `src/engine/Engine.ts` (pass stats into the body spec), `src/game/Characters.ts`, new `tests/wave_gen_pipeline_test.ts`, `docs/wave-gen/PIPELINE.md` |
| **B — biologist + sculptor** | `src/graphics/body/{Anatomy,AnatomyParts,Proportions,Physique,Brushes,Improvise,Hands,HandRig}.ts`, `src/game/{BodyProfile,SpineCurve,RaceAppearance}.ts`, new `src/graphics/body/StatMorph.ts`, new `tests/wave_gen_anatomy_test.ts`, `docs/wave-gen/ANATOMY.md` |
| **K — animator + kinematics** | `src/game/anim/**`, `src/game/{Skeleton,StanceAnim,AnimationCurve}.ts`, `src/graphics/body/{SkinnedHumanoid,SkinWeights,JointHelpers}.ts`, `src/physics/ragdoll/**`, new `tests/wave_gen_kinematics_test.ts`, new `tools/audit-animations.ts`, `docs/wave-gen/KINEMATICS.md` |
| **S — painter + shader + hair** | `src/graphics/paint/**`, `src/graphics/textures/**`, `src/graphics/shaders/**`, `src/graphics/BodySurface.ts`, `src/graphics/body/{FaceParts,HairFollicles,HairGrowth,HairMesh,HairShade}.ts`, new `tests/wave_gen_paint_test.ts`, `docs/wave-gen/PAINT.md` |
| **U — UI/UX + constraints** | `src/ui/**`, `styles.css`, `index.html`, `src/graphics/{PreviewScene,PortraitStudio}.ts`, new `tests/wave_gen_ui_test.ts`, new `tools/probe-wave-gen-ui.ts`, `docs/wave-gen/UI.md` |
| **Q1 — geometric verifier** | only `tools/verify-wave-gen-geo.ts`, `docs/wave-gen/VERIFY-GEO.md`, `artifacts/wave-gen/verify-geo/**` |
| **Q2 — visual verifier** | only `tools/capture-wave-gen.ts`, `docs/wave-gen/VERIFY-VISUAL.md`, `artifacts/wave-gen/verify-visual/**` |

## Contracts per lane
- **C-MORPH (B)** `StatMorph.ts` pure: `statMorph(stats, race, subrace, sex): Morph` — multipliers / offsets the
  inflate+carve stages read: strength -> muscle-group volumes (pectoralis, deltoid, latissimus, trapezius, quadriceps,
  biceps, calf) and a bone-density/shoulder-breadth term; level -> maturity (small height/mass/stance gravitas term,
  bounded); intelligence -> brow recess (a few mm). Morph at `STAT_REFERENCE` = identity. Sub-race posture curves:
  ork forward neck + trapezius dominance, dwarf lumbar curve, human/elf erect (minimal deviation). Race digit
  distribution (elf slender/long, then human, dwarf, ork thicker knuckles / broader palm). Every term bounded; volume
  added only where B measures the ragdoll/slide/hitbox tests stay green.
- **C-CAGE (P)** `Cage.ts`: per sub-race and per part a 6-axis cage scaled by stats; the inflate stage clamps primitive
  extents into it; metric `cageViolationMm` (must be 0 after inflate) and `cageFill` (how much of the cage the body
  occupies).
- **C-AGI (K)** agility (0..1000) widens joint limits within a bounded envelope (`agilityLimits(limits, agility)`;
  identity at reference); the Animator idle stance keeps the centre of mass over the support polygon ("balance disk":
  report the margin); an animation audit (`tools/audit-animations.ts`) over every clip the game plays (idle, walk,
  strafe, swing per archetype, block, cast, shove, stagger, fall, lie, rise) x 4 races: pose pops (max joint delta per
  frame), planted-foot slide, floor penetration, self-intersection of limb capsules, weapon-through-body; fix the
  worst offenders; numbers before/after.
- **C-PAINT (S)** a miniature-style pass: curvature-driven edge highlight + cavity darkening (computed from the mesh,
  pure), top-down chiaroscuro gradient, subtle weathering on garments; intelligence -> hair length, follicle density and
  a shift toward silver/white (bounded, on top of age grey); a `paint` stage record with timing.
- **C-STAGE-UI (U)** the creator gets a **stage scrubber** (Skeleton -> Cage -> Inflate -> Carve -> Skin -> Hitboxes ->
  Paint) that renders each stage in the preview (skeleton as bones+disks in T-pose, cage as wire boxes, hitboxes as
  translucent capsules), with each stage's ms + metrics; **drag handles**: dragging horizontally on a number scrubs it
  (pointer + touch), clamped by **neighbour-dependent rules** (e.g. waist <= hips and <= shoulders, head within a band of
  the height, limb length within the race band) defined in a pure `src/ui/Constraints.ts` with tests; the generator
  shows the 0..1000 stat view (strength, agility, intelligence, level) with the morph updating live.

## QA (dual verification)
- **Q1** (geometry, Deno + Chrome): for 4 races x 2 sexes x 3 stat profiles (min/reference/max): mesh watertight /
  manifold edges, degenerate triangles, left/right symmetry deviation, cage containment, hitbox capsules enclose the
  skin (coverage %) and do not exceed it by more than a band, skin weights sum to 1, triangle budget, morph identity at
  reference, monotonicity of each stat's morph, pipeline determinism; plus the K audit numbers re-measured independently.
- **Q2** (visual): captures EVERY stage from the 6 principal axes (+X -X +Y -Y +Z -Z) for 4 races x 2 sexes (and
  min/max strength) into contact sheets under `artifacts/wave-gen/verify-visual/`, then inspects them with the vision
  tool (`vision_analyze`) for clipping, asymmetry, style inconsistency, floating parts; every visual FAIL must name the
  sheet and the region. Q2 also checks the UI stage scrubber at 390 and 1280 px.

## Swarm protocol
Board: `BOARD_DIR=artifacts/wave-gen deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` /
`BOARD_DIR=artifacts/wave-gen deno run -A tools/board.ts read <since> --to <ME>`.
CLAIM at start; post interface decisions early (P posts the final `StagedBody` / `BodySpec.stats` shape within the
first work chunk; B, K, S, U code against the brief until then). READY = reproduce commands + numbers.
Ring reviews: **P reviews B, B reviews K, K reviews S, S reviews U, U reviews P**. Q1 and Q2 verify EVERY READY. A lane is
done when its ring reviewer AND both Q1 and Q2 posted PASS on its latest READY, or after 3 rounds (open FAILs listed).
While waiting: `sleep 150` foreground (max ~15). SPEC pins: P G1-G19, B G20-G39, K G40-G59, S G60-G69, U G70-G79.
Evidence generated by code. Gate: `deno task check`, `deno lint`, your tests + the existing tests that import your
modules; the parent runs the full suite and commits.
