# Vocabulary and code review of the overhaul's new code (R10, R08)

Review wave, 2026-10-28, at git HEAD `a976258`. Analysis only: **no source file was edited.**

This file applies `docs/GLOSSARY.md` and the conventions of the earlier review (`docs/review/vocabulary.md`,
`magic-numbers.md`) to the code the overhaul added. The scope is the same as `docs/review/architecture.md` §1.
Every `file:line` was read at `a976258`. Engine.ts line numbers are for its current 2,888 lines.

**Method.**
- Function lengths come from a brace-matching scan of every in-scope file.
- Literals come from a scan for numeric literals that sit outside top-level `const NAME =` declarations and outside comments.
- Doc-comment units come from a scan of exported functions with `number` parameters whose doc comment has no unit
  token.

The literal scan found 1,352 such literals in scope. The largest counts:
- `body/AnatomyParts.ts` 248
- `paint/RecipeData.ts` 106 (data table)
- `paint/Symbols.ts` 100 (glyph geometry)
- `paint/Recipes.ts` 87
- `body/FaceParts.ts` 83
- `anim/Animator.ts` 54 (mostly the named `DEFAULT_ANIMATOR` table)
- `ui/minimap/Glyphs.ts` 52

Every candidate below was then read by hand.

Priorities as in vocabulary.md: **P1** misleads a reader or hides a bug; **P2** is unclear; **P3** is style.

---

## 1. One concept, several names (and one name, several concepts)

| ID | P | Concept | Names in the new code (file:line) | Canonical proposal |
|---|---|---|---|---|
| N-01 | P1 | **Height of the walkable surface under (x, z)** | `ArenaState.floorAt` (ArenaPhysics.ts:29)<br>`TerrainMeshBuild.floorHeightAt` (TerrainMesh.ts:42)<br>Engine `#groundHeight` (Engine.ts:137-140, with NaN → 0)<br>local `floorY` (Engine.ts:526)<br>inline `floorAt ? floorAt(…) : 0` (Engine.ts:632, 2757)<br>`AnimatorInput.groundHeight` / `GroundHeightFn` (Animator.ts:203; FootIK.ts:133)<br>`FloorContact.floorY` (TerrainGround.ts:34)<br>`rimY` (ArenaPhysics.ts:81)<br>Distinct functions: `heightAt` (Heightfield.ts:396, the smooth bilinear field), `surfaceHeightAt` (RingSurface.ts:213) and `outsideHeightAt` (OutsideSurface.ts:182), the drawn triangles | ✅ `floorHeight(x, z)` = drawn triangles, m (what bodies stand on). ✅ `fieldHeight(x, z)` = the smooth heightfield.<br>⚠ Today props stand on the **field** (`prop.y = heightAt(…)`, Engine.ts:812) and A* uses field heights (PathFinder.ts:282-285), but bodies stand on the **mesh** (Engine.ts:506). INTEGRATION.md:38 measured mesh vs grid up to 0.5 m apart at faces. Pick one surface for all three, or name the difference. |
| N-02 | P1 | **`soleOffset` names two different quantities** | (a) `LegGeometry.soleOffset`: "ankle pivot → sole plane" (Rig.ts:131, 141), fed by Engine's `ankleY` (Engine.ts:755-756)<br>(b) `SkinnedExtras.soleOffset`: "height of the group origin above the lowest sole point in the CURRENT pose; place the rig with `group.position.y = groundY + soleOffset`" (SkinnedHumanoid.ts:33-38), read at Engine.ts:2213 | (a) ✅ `ankleHeight`. (b) ✅ `originLift`. Engine.ts:2200-2201's comment already says the second one "lifts/drops" the origin. |
| N-03 | P1 | **Height of the feet / rig origin** | `AnimatorInput.rootY` is documented as "World y the parent places the rig origin at … **(f.body.y)**" (Animator.ts:184-185). Engine passes `rootY: floor` with `floor = f.body.y − f.body.radius` (Engine.ts:1776-1779), which is the feet, not `body.y`. The same quantity is `feet` in TerrainGround.ts:63. Inside the Animator `rootY` is a different, local value (Animator.ts:443). `standingSoleDepth` / "soleDepth" (Rig.ts:185) is the rig-origin-to-sole offset. | ✅ `feetY` = `body.y − bodyRadius` (m). Fix the doc at Animator.ts:184. Rename the parameter `rigOriginY`. |
| N-04 | P1 | **Body radius and body-centre height** | `radius` (SmashPhysics.ts:16, 0.6)<br>`PLAYER_RADIUS` (Engine.ts:96, 0.5)<br>`bodyRadius` (TerrainRules.ts:60-61, def 0.5, documented as "Engine PLAYER_RADIUS: the fighter's collision circle", TerrainRules.ts:83, which is false: see V-01)<br>`BODY_CENTRE_HEIGHT` / `centreHeight` (ChargeFx.ts:50, FxDirector.ts:45)<br>`LEGACY_BODY_RADIUS` (LegacyGeometry.ts:20)<br>`agentRadius` (Engine.ts:510) | ✅ `bodyRadius` (m). One constant (architecture.md §5), passed to FX and A*. |
| N-05 | P2 | **Inscribed ring radius** | The GLOSSARY recommended `inscribedRadius` (GLOSSARY §F, *size / halfSize*). Instead the new code exports the old name:<br>`TerrainPaintOptions.ringHalf` (TerrainPaint.ts:85-86)<br>`ringHalfOf` (TerrainPaint.ts:103)<br>`terrainZoneAt(…, ringHalf)` (TerrainPaint.ts:167)<br>a local `ringHalf` (RingRelief.ts:40-46)<br>`materialAt(x, z, ringHalf)` (game/Terrain.ts:25, pre-existing). Meanwhile `TerrainBase.arenaRadius` is "ring radius at its widest point" (TerrainRules.ts:45-46) and is fed `outlineMaxRadius` (Heightfield.ts:334), yet its spec note says "half the ArenaConfig `size`" (TerrainRules.ts:75). | ✅ `inscribedRadius` (min R(θ)) and ✅ `circumscribedRadius` (max R(θ)). Fix the note at TerrainRules.ts:75. |
| N-06 | P1 | **region vs zone vs band** | *region*: an anatomical skin label (`REGIONS`, contracts.ts:40-44).<br>*zone*:<br>• the radial gameplay zones `ZONE_FIGHT/RING/OUTSIDE` (Heightfield.ts:41-43)<br>• the 14 terrain **paint** zones `TERRAIN_ZONES` (TerrainPaint.ts:51-54), which are stored in "the `region` byte of the painted MeshData" (TerrainPaint.ts:50). `label = zones.map((z) => REGIONS[z])` (TerrainPaint.ts:109) turns zone *stone* = 0 into region **"torso"**, so the layer `coat-stone` (TerrainPaint.ts:121) targets "torso".<br>*band*:<br>• the material annulus (`band = hypot/ringHalf`, game/Terrain.ts:25)<br>• `ringFeatureBand`, a width in m (TerrainRules.ts:209, 389)<br>• the p20..p80 "target band" (HeightOps.ts:98)<br>• the skin-weight `RootBand` / `shoulderBands` (SkinWeights.ts) | ✅ `region` = anatomical only. ✅ `zone` = terrain only; give `PaintLayer` a generic `labels: readonly string[]` resolved against the mesh's own label table instead of `REGIONS`. ✅ `band` = an annulus only; rename the rest to `targetRange` and `blendBand`. |
| N-07 | P2 | **The fighter's look, as a sequence of input records** | `CharacterProfile` → `Appearance` (Engine builds `app`, Engine.ts:715-727) → `BodySpec` (`specFromAppearance`, SkinnedHumanoid.ts:77) → `PaintSubject` (Recipes.ts, `subjectFromProfile`). *plan* / *anatomy*: `AnatomyPlan` (contracts.ts:162); `DetailedAnatomy extends AnatomyPlan` (Anatomy.ts:58); `anatomyFor` returns the detailed one (Anatomy.ts:179) although the contract header says `AnatomyPlan` (contracts.ts:19); `rig.plan` (SkinnedHumanoid.ts:43); `meshPlan` (BodyMesh.ts:29, dead). *spec* also names terrain placement rules: `DeliberateSpec` (TerrainFeatures.ts:153). | ✅ `BodySpec` = generator input. ✅ `anatomy` = the solved body (rename `DetailedAnatomy` → `Anatomy`, `rig.plan` → `rig.anatomy`). Keep `plan` for the SDF tree only. Call the terrain one `FeaturePlacementRules`. |
| N-08 | P2 | **skill / power / technique / defend** (GLOSSARY §D) | SkillBar.ts:2 "skill chips (powers)"<br>hints "1/2/3 or …: Dash / **Power** / **Defend**" (Engine.ts:972)<br>Menu.ts:541 `KIND_LABEL` {defense: "Defense"} and SkillBar.ts:67 `kindLabel` (capitalises the id): two label sources for the same kind<br>Engine.ts:65-66 "What each **technique** kind costs … a **defence**"<br>`SkillView.kind: string` (SkillBar.ts:26-27) and `SKILL_KIND_ICON: Record<string, …>` (Icons.ts:98) instead of the `SkillKind` type | ✅ `skill` in identifiers. One `SKILL_KIND_LABEL: Record<SkillKind, string>` ("Dash / Power / Defense") used by Menu, SkillBar and the hints. Type `kind: SkillKind`. |
| N-09 | P2 | **"ring"** | the walkable floor polygon (GLOSSARY §F) and also the impact shock-wave decal: `RingDecal` (Decals.ts), `FxIntensity.ringRadius` (FxRecipes.ts:229, 281), `slot.ring.fire` (FxDirector.ts:302) | ✅ `shockwave` for the FX. |
| N-10 | P2 | **"hash01"** | Three exported functions with one name and three signatures and outputs: Glyphs.ts:83, Noise.ts:72, HeightOps.ts:24. Plus `smin`/`smax` (Sdf.ts:142-151) and `smoothMin`/`smoothMax` (FootIK.ts:69-78), one function under two names. | One MathCore `hash01`, `smin`, `smax` (architecture.md §4) |
| N-11 | P2 | **"terrain"** in Engine | `#terrain` = the old decoration group (Engine.ts:158, `#rebuildTerrain` Engine.ts:650-656); `#terrainField` / `#terrainMesh` = the real heightfield (Engine.ts:234-236). The GLOSSARY (§F, *terrain*) already asked for `#rebuildDecor`. | ✅ `#decor` / `#rebuildDecor` |
| N-12 | P3 | **Shadowed import** | `const groundForward = Math.hypot(dir.x, dir.z) > 0.1` (Engine.ts:1686) shadows the imported function `groundForward` (Engine.ts:84) and duplicates it with another threshold (MoveFrame.ts:25 uses 1e-4) | Call the function |
| N-13 | P3 | **Pareto letters as general coefficients** | `d = PARETO_TOP_FRACTION`, `g = PARETO_TOP_SHARE` (TerrainRules.ts:351) also serve as:<br>• a climb head-room: `maxClimbTan = tan/g`, "25% head-room for the triangulation" (TerrainRules.ts:115, 397; TerrainGround.ts:49)<br>• "a step + 25%" (TerrainRules.ts:210)<br>• a blend width (TerrainRules.ts:399) | Keep the economy, but name each use: `CLIMB_HEADROOM = 1 / PARETO_TOP_SHARE`. Then a reader can see that 1.25 is a choice, not a Pareto law. |

## 2. Units and definitions missing or wrong in doc comments

The BRIEF (`docs/overhaul/BRIEF.md:80-83`) asks every exported function to define its terms and units.

| File:line | Symbol | Gap |
|---|---|---|
| ArenaPhysics.ts:32 | `ArenaState.maxClimbTan` | **Wrong definition (P1)**: says "= tan(maxSlope)". The value is `tan(maxSlope) / g` (TerrainRules.ts:397), as TerrainGround.ts:49 states. |
| ArenaPhysics.ts:28 | `ArenaState.floorAt` | Defined by a graphics type ("TerrainMeshBuild.floorHeightAt") rather than by meaning. It should say "drawn floor height, m; NaN = no floor". |
| Animator.ts:184 | `AnimatorInput.rootY` | Says `f.body.y`; Engine passes `body.y − radius` (N-03) |
| FootIK.ts:93-97 | `solveTwoBone(hipY, hipZ, targetY, targetZ, …)` | No frame or unit (m, in the pelvis-local sagittal plane) |
| TrailBuffer.ts:89-93 | `fadeAlpha(age, lifetime)` | Seconds not stated |
| MapMath.ts:310-314 | `lightDirection(azimuth, altitude)` | Radians or degrees not stated |
| AnatomyParts.ts:282-283 | `armNode(P, side, abduction)` | `abduction` has no unit (rad). `side: 1 \| -1` has no sign rule (which is left?). |
| AnatomyParts.ts:14, 33 | `blendWidth`, `op` | No doc comment at all |
| Polygonize.ts:210-211 | `polygonizeField(field, bounds, cell)` | `cell` unit not stated (m) |
| TerrainPaint.ts:166-167 | `terrainZoneAt(field, x, z, role: number, ringHalf)` | `role` is a bare `number` (should be `0 \| 1 \| 2` or a `Role` type, TerrainPaint.ts:164). `ringHalf` unit missing. |
| FxShaders.ts:46-52 | `fxDensityForLuminosity` | Its doc block sits above `DENSITY_DAYLIGHT_GAIN`, so the function has no doc of its own |
| contracts.ts:10-26 | producer signatures | Stale (architecture.md §7) |
| SkillBar.ts:26-27 | `SkillView.kind: string` | Documented as a union but typed as a string |

**Good examples to copy:**
- `MoveFrame.lambdaForRiseTime` (MoveFrame.ts:42-48: equation, unit and derivation)
- `TrailBuffer.fadeAlpha`'s boundary statement (TrailBuffer.ts:89-91)
- the `TerrainRules` field docs, each "unit: equation -> reason" (TerrainRules.ts:99-218)
- `FxDirector`'s engine contract (FxDirector.ts:9-17)

## 3. Functions longer than ~80 lines, or doing two jobs

Lengths are brace-matched, from the first line of the signature to the closing brace.

| ID | Function (lines) | Length | Jobs today | Proposed split (explicit parameters) |
|---|---|---|---|---|
| L-1 | `Animator.update` (Animator.ts:363-617) | 255 | Its own 9 documented steps (Animator.ts:8-17; comments at 370, 386, 403, 434, 512, 551, 568, 577, 594) | `#advanceGait(inp, h)`; `#springLayerWeights(inp, h)`; `#solveTrunk(inp, h): number` (pelvis pitch); `#solvePelvisHeight(inp, ground, h): number` (rootY); `#solveLegs(rootY, ground)`; `#driveUpperBody(trunkPitch)`; `#blendRemaining(h)`; `#placeRoot(baseRootY, legAuthority, ground)`; `#guardSoles(ground)`. Each step already reads and writes named private arrays, so the split is mechanical. Prove it with a bitwise `runScenario` golden (architecture.md §10, step 9). |
| L-2 | `buildSkinnedHumanoid` (SkinnedHumanoid.ts:124-305) | 182 | bones, skin mesh + outline, face parts, weapon mount, sole points, per-frame update closure | `buildBones(anatomy): Map<BoneId, Bone>`; `buildSkin(body, skinData, paint, garment)`; `mountWeapon(bones, weapon, anatomy, scale)`; `solePoints(bones, anatomy): SolePoint[]`; `makeRigUpdate(bones, gameSkeleton, levelFeet)` |
| L-3 | `stampDeliberate` (TerrainFeatures.ts:219-382) | 164 | 8 local predicates, then cliffs (262), holes (310), ramps (364) | `PlacementContext { g, outline, spec, taken, keepClear, rng }` + `placeCliffs(ctx)`, `placeHoles(ctx)`, `placeRamps(ctx, cliffs)` |
| L-4 | `stackFor` (Recipes.ts:131-284) | 154 | 13 numbered layer groups (comments at 144-270) | `skinLayers(tone, traits, H, s)`; `markingLayers(style, H, s)`; `hairLayers(hair)`; `signLayers(birthsign, culture)`; `classLayers(className)`; `garmentLayers(garment)`, concatenated |
| L-5 | `Gait.update` (Gait.ts:385-537) | 153 | travel filter, re-plant decision, phase advance, per-foot swing/landing, bob/sway | `#filterTravel(inp, h)`; `#needsReplant(inp)`; `#advancePhase(distance, rate)`; `#updateFoot(side, …)`; `#bobAndSway()` |
| L-6 | `polygonizeField` (Polygonize.ts:211-330) | 120 | narrow-band scan, vertex placement, quad emission | `scanNarrowBand(field, bounds, cell)`, `placeVertices(…)`, `emitQuads(…)` |
| L-7 | `drawPropGlyph` (Glyphs.ts:107-211) | 105 | one `switch` over prop kinds | `PROP_GLYPHS: Record<ArenaObject["kind"], GlyphFn>` |
| L-8 | `proportionsFor` (Proportions.ts:138-238) | 101 | race/BMI/girth, landmark heights, radii | `girthFor(spec)`, `landmarksFor(head, canon)`, `radiiFor(head, girth, muscle)` |
| L-9 | `ChargeFx` constructor (ChargeFx.ts:171-267) | 97 | telegraph, ghosts, speed lines, ring | `#buildTelegraph()`, `#buildGhosts()`, `#buildSpeedLines(rand)` |
| L-10 | `buildFaceParts` (FaceParts.ts:52-146) | 95 | eyes, lids, brows, hair cap | `buildEye(r, colours)`, `buildBrow(h, hair)`, `buildHairCap(anchors, a)` |
| L-11 | `deriveTerrainRules` (TerrainRules.ts:349-440) | 92 | one formula sheet | Acceptable: one job, documented line by line, and mirrored by `describeTerrainRules` (TerrainRules.ts:443). Keep it. |
| L-12 | `bakeRelief` (Relief.ts:192-283) | 92 | hillshade, tint, contours | `hillshade(…)`, `tint(…)`, `contours(…)` |
| L-13 | `applyFieldBrush` (Brushes.ts:75-163) | 89 | a `switch` over brush kinds | `FIELD_BRUSH_FNS: Record<BrushKind, (st, x, y, z, out) => void>` |
| L-14 | `buildRingSurface` (RingSurface.ts:98-184) | 87 | layout, vertices + colours, triangles, skirt | `ringVertices(…)`, `ringTriangles(…)`, `ringSkirt(…)` |
| L-15 | `stepArenaBody` (ArenaPhysics.ts:64-147) | 84 | **five jobs**: integrate, wall, ring floor, outside ground, props, air drag | `integrate(b, dt)`, `resolveWall(b, phys, st, prevInside, outwardSpeed)`, `resolveRingFloor(b, prev, st)`, `resolveOutside(b, prev, st): landedSpeed`, `resolveProps(b, props)`, `applyAirDrag(b, dt, AIR_DRAG_LAMBDA)` |
| L-16 | `applyRootBands` (SkinWeights.ts:173-254) | 82 | per band: classify, blend | `bandWeight(v, band)` + loop |
| L-17 | `Minimap.setWorld` (Minimap.ts:322-401) | 80 | relief bake, outside dim, perimeter, props | `#bakeRelief(world)`, `#bakeOutside(world)`, `strokePerimeter(…)` (shared with `#drawRing`, Minimap.ts:472-497), `#bakeProps(world)` |
| L-18 | `buildTerrainMesh` (TerrainMesh.ts:71-96) | 26 | **two jobs**: it builds the THREE mesh *and* returns the physics floor sampler (TerrainMesh.ts:94) | The sampler moves to `world/ArenaFloor.ts` (architecture.md A5) |
| L-19 | Engine `#updatePose` (Engine.ts:1748-1805) | 58 | pose-priority table (allocated every frame, 1757), Animator input assembly (1765-1794), face state | `animatorInputFor(f, rival, state, prev, dt, floorHeight)` (pure); `#faceStateOf(f, state)` |
| L-20 | Engine `#loop` (2006-2390), `snapshot` (2742-2887), `#startFight` (780-891), `#buildArena` (486-584), `#spawnMeshes` (693-778) | 385 / 146 / 112 / 99 / 86 | see vocabulary.md F-1, F-5, F-8, F-9; the overhaul added 86, 31, 22, 43 and 14 lines to them | The ArenaSystem / FighterPresentation / HudSystem / PlayerLocomotion extraction (architecture.md §6) |

## 4. Magic numbers in the new code that are not derived

BRIEF.md:22, 81-83 (R08) asks for constants derived from named bases, with the equation in a comment.
**D** = derivable; **N** = a free parameter that needs a name; **A** = art, name it only.
Values marked "(hand)" are arithmetic on the cited literals.

| ID | File:line | Value | Meaning | D? | Proposed derivation |
|---|---|---|---|---|---|
| MN-1 | ArenaPhysics.ts:81, 89; Engine.ts:539 | 0.98 | Rim inset as a fraction of R(θ) | D | It scales with arena size: 0.12 m at R = 6, 1.2 m at R = 60 (hand). Use `inset = bodyRadius / 5`, which gives exactly today's 0.12 m at the 12 m default arena (0.6/5 = 0.02·6) and stays constant in metres. |
| MN-2 | ArenaPhysics.ts:105, 117 | `?? 0.35` | Step-height fallback | D | `TERRAIN_BASE_DEFAULTS.stepHeight`. The base itself (TerrainRules.ts:78, "roughly knee height for the 0.5 m-radius fighter body") ≈ 0.2·H (0.35/1.7 = 0.206, hand). |
| MN-3 | ArenaPhysics.ts:118 (new), 122 | −0.5 m/s | Least speed that counts as a landing | D | v = √(2·g·h_min). With g = 24 and h_min = 5 mm, that is √0.24 = 0.49 m/s (hand). Name `LANDING_MIN_DROP = 0.005 m`. |
| MN-4 | Engine.ts:1782 | 0.02 m | "grounded" tolerance passed to the Animator | D | One frame of free fall at the slowest frame you support: ½·g·Δt² = ½·24·(1/24)² = 0.0208 m (hand). Name `GROUNDED_TOLERANCE`. |
| MN-5 | Engine.ts:1787 and 2219 | 0.6 | Balance-tilt gain, written twice; the Animator compensates with one copy and the rig applies the other | N | `BALANCE_TILT_GAIN`, one constant |
| MN-6 | Engine.ts:2090, 2382 (0.25); 1792 (0.2); Gait.ts:143 (0.05) | m/s | "Moving" thresholds | D | `MOVING_SPEED = 0.04·MOVE_SPEED` = 0.26 m/s (hand), used everywhere. Keep Gait's 0.05 as `stillSpeed` only if it is a different concept (filter noise), and say so. |
| MN-7 | Engine.ts:2383 | `1.8 + 0.18·v` | Footstep cadence, a line fitted through two human cadences (comment at 2379-2380) | D | Already derived inside the Gait (stride from `strideAtRest`, `strideGain`, Gait.ts:117-118). Trigger the sound on the rising edge of `AnimatorOutput.footPlant` and delete the line. |
| MN-8 | Engine.ts:805; RingRelief.ts:46 | `min(2.5, 0.4·ringHalf)` | Duel spawn half-separation | D | magic-numbers.md M-A7: (ℓ_max + 2r)/2 + 0.5 = 2.5. One `duelSpawnPoints`. |
| MN-9 | Engine.ts:755 | `?? 0.08` m | Ankle-height fallback | D | `ANKLE_PER_FOOT · footLength` (Proportions.ts:46: 0.27 · 0.26 m = 0.07 m, hand), or throw: the bone always exists |
| MN-10 | Engine.ts:119 | `riseTime: 0.12` s | Walk rise time (to 95%) | N | Name it with its reason, or tie it to the reaction-time base T7 (magic-numbers.md §0): 0.12 ≈ 0.5·t_r |
| MN-11 | MoveFrame.ts:81 | 0.05, 0.1 | Floors on `surfaceSlip` and `responsiveness` | D | `MIN_SLIP = min(surface.stop) / stone.stop` from the surface table; name `MIN_RESPONSIVENESS` |
| MN-12 | Gait.ts:116 | `gravity: 9.81` | Gait's g (Froude, run bob, accel lean) | N | Physics uses 24 (ArenaPhysics.ts:15). Use `GRAVITY`, or name `GAIT_REFERENCE_GRAVITY` with its reason (architecture.md §5). |
| MN-13 | Gait.ts:502; Animator.ts:451 | 1.25 | Landing reach factor, written twice | N | `LANDING_REACH_FACTOR`, exported by Gait |
| MN-14 | Animator.ts:505 | 1.2 | Inverted-pendulum head-room on the pelvis drop rate. It is documented in the `maxDropRate` doc (AnimatorParams), but the literal is in the code. | N | Add it to `AnimatorParams` (`dropRatePendulumGain`) |
| MN-15 | Animator.ts:326 | `smoothTime: 0.1` | Balance-layer weight spring | N | Every other layer's smooth time is a param (`smoothAir`…`smoothBreath`, Animator.ts:165-171). Add `smoothBalance`. |
| MN-16 | Animator.ts:371 | 4 /s | Stance (guard) damping rate | D | `stanceLambda = lambdaFromHalfLife(0.17 s)` (ln2/4 = 0.173 s, hand), in `AnimatorParams` |
| MN-17 | Gait.ts:224 | `0.05·L` | Run-bob cap | N | `runBobMax` in `GaitParams` |
| MN-18 | Rig.ts:170, 249, 262, 265 | 0.6, 0.05, 0.16/0.75, 0.3, 0.04/0.75 | Foot proportions (toe, minimum ball, heel) | D | Derive them from the body canon (Proportions.ts:46 `ANKLE_PER_FOOT`, :85 `heel 0.16`). The 0.16 in 0.16/0.75 matches `CANON_RADIUS.heel`, but nothing ties the two together. |
| MN-19 | Rig.ts:204-211; LegacyGeometry.ts:5-12 | 0.14, 0.22, 0.8·0.22, 0.07, 0.04, 0.36, 0.24, 70 | Legacy pivot rig constants, copied from Humanoid.ts (the module comment says so) | D | Export them once from Humanoid.ts, or retire the legacy path (it is test-only, architecture.md §7) |
| MN-20 | FxDirector.ts:43, 104, 162; FxRecipes.ts:242; ChargeFx.ts:96 | 1.7 m | Default standing height ×5 | D | `BODY_HEIGHT`. Paint uses 1.75 (Recipes.ts:51) and the mannequin 1.8 (Mannequin.ts:68). |
| MN-21 | ChargeFx.ts:50 | `BODY_CENTRE_HEIGHT = 0.6` | Body centre above the soles | D | `= body.radius`, passed by the engine through the existing `centreHeight` (FxDirector.ts:45) |
| MN-22 | TerrainRules.ts:83 | `bodyRadius` def 0.5 | Terrain base copied from the misnamed `PLAYER_RADIUS` | D | 0.6 = r = H/3 (magic-numbers.md T2). It drives `fairPadRadius` (TerrainRules.ts:424). |
| MN-23 | TerrainRules.ts (`fighterReach` spec, TERRAIN_BASE_SPECS) | 1.9 | "mean of the Weapon.ts TYPE_BASE reaches … × 1.02", computed by hand in the note | D | Compute it at import from the weapon table, as `FxRecipes.rosterRanges` does from `ALL_SKILLS` (FxRecipes.ts:174-189) |
| MN-24 | RingSurface.ts:85 | 24, 768 | Outline segment quantum and cap | D | Derive the cap from `TERRAIN_TRIANGLE_BUDGET` (OutsideSurface.ts:28, 6000) and the ring count, not a separate 768 |
| MN-25 | RingSurface.ts:124, 127, 128 | 0.85–1.15, 0.55, 0.6 | Height shade, hole shade, cliff grey | A/D | Hole and cliff values can come from `TERRAIN_VERTEX_BOUNDS` (TerrainPaint.ts:64, luminance floor 0.025). Name the rest. |
| MN-26 | Minimap.ts:375, 383, 385 vs 485, 488, 491-492, 495 | 1.9 / 1.0 / 0.8 vs 1.6 / 0.75 / 0.8; dash 5 / 3.5 | The perimeter drawn twice with different widths | A | One `PERIMETER_STYLE` + `strokePerimeter` (architecture.md §4) |
| MN-27 | Minimap.ts:393 | `?? 0.6` | Unknown-prop radius fallback | N | Name it (`UNKNOWN_PROP_RADIUS`); do not reuse the body radius by coincidence |
| MN-28 | Engine.ts:1327, 1689 | 60 m | Fog / sight cap | D | magic-numbers.md M-P2 / M-A14: one `FOG_REVEAL_MAX` = R_circ + r |
| MN-29 | ChargeFx.ts:231 | `0.9 + 0.6·rand()` | Speed-line radius, in shoulder breadths | N | `SPEED_LINE_RADIUS = [0.9, 1.5]` |
| MN-30 | FaceParts.ts:39, 63 | luminance 0.55 / 0.04, distance 0.5; emissive 0.45 | Eye-colour fallback rule and face emissive | D/A | Use the paint lane's bounds (`paint/Relevance.ts` `INK_BOUNDS` / `SKIN_BOUNDS`) for "too dark / too light" instead of a second rule. Name the emissive. |
| MN-31 | Anatomy.ts:149-170 | 0.25h, 0.05h, 0.45·foot, 0.6·foot, 0.5h, 0.35h, 0.24h, 0.9h, 0.28h, 0.3h, 0.12h, 0.06h, 0.4h, 0.08h | Sculpt-brush plan (R15) | D (already scaled by the head height h) | The coefficients are inline in `out.push` calls. Move them to a `BRUSH_PLAN` table `{ kind, anchor, radiusPerHead, strengthPerHead, purpose }`, the way Proportions.ts:37-86 does for the canon. |
| MN-32 | AnatomyParts.ts:122-126, 196-204 | 0.035h, 0.32·earH, 0.06h, 0.02h, 0.47h, −0.06h, 0.88, 0.62h, 0.16h, 0.12h, 0.13h, 0.2h, 0.05h, 0.1h, 0.3h, 0.14h | Head, ear and face geometry | D (scaled by h) | A `CANON_HEAD` table next to `CANON_Y` / `CANON_RADIUS` (Proportions.ts:37, 82). 248 literals sit in this file. |
| MN-33 | TerrainPaint.ts:117 | 7919 | Layer seed stride (a prime) | A | `LAYER_SEED_STRIDE` |
| MN-34 | Glyphs.ts:126, 133 | `0.72 + 0.32·hash`, 6 lobes, 0.42 / 0.58 | Rock-glyph outline | A | Name them in the glyph table (L-7) |

**Where R08 was met, as models for the rest:**
- `TerrainRules` (bases with min/max/default/unit/reason, TerrainRules.ts:74-86; every derived rule printed by
  `describeTerrainRules`, TerrainRules.ts:443)
- `FxRecipes.ROSTER_RANGES`, computed from the skill roster (FxRecipes.ts:174-189)
- `SkillBar.SWEEP_STEPS`, with its resolution argument (SkillBar.ts:44-49)
- `MoveFrame.lambdaForRiseTime` (MoveFrame.ts:42-48)
- the `Proportions` canon tables (Proportions.ts:30-86)
- `Engine.#aiHeading`'s re-plan period `2·cell / AI_MOVE_SPEED` and arrive radius `cell/2` (Engine.ts:1199, 1204)

## 5. Terms to add to the GLOSSARY

These are used by the new code and absent from `docs/GLOSSARY.md`:
- *heightfield*, *cell*, *node*
- *rNorm* (TerrainFeatures.ts:39)
- *fair spot / fair pad / fair centre* (RingRelief.ts, TerrainRules.ts:185-187)
- *deliberate / flagged feature* (hole, cliff, ramp; TerrainFeatures.ts:28-31)
- *slope limit* (`maxNeighbourDelta`)
- *gait phase, stance / swing, plant, duty factor, Froude number, ride height* (Gait.ts, Animator.ts)
- *pelvis drop*
- *sole gap* (Engine snapshot, Engine.ts:2862)
- *leg authority*
- *chip* and *sweep* (SkillBar.ts:4-11)
- *bake* (Minimap static layer)
- *telegraph, afterimage (ghost), shield arc, shockwave* (fx)
- *coat / layer / stack / blend mode* (paint)
- *SDF, volume operator, brush stroke* (contracts.ts)

Each needs the definition, the unit and the canonical word in the GLOSSARY's format, following N-01…N-13.

## 6. Top 15 fixes, in priority order

| # | Fix | Why first | Evidence |
|---|---|---|---|
| 1 | **One body radius.** Replace `PLAYER_RADIUS` 0.5, the TerrainRules `bodyRadius` default 0.5, `BODY_CENTRE_HEIGHT` and the copies with one `BODY_RADIUS` = 0.6. Pass it to A* and FX. | The A* clearance is 0.1 m tighter than the body. The terrain fair pads are sized for a body that does not exist. FX silently assumes 0.6. This is a gameplay change (architecture.md §10, step 11). | Engine.ts:96, 509-510; TerrainRules.ts:60, 83, 424; ChargeFx.ts:50; SmashPhysics.ts:16 |
| 2 | **Split `soleOffset`** into `ankleHeight` (LegGeometry) and `originLift` (SkinnedExtras). **Fix `AnimatorInput.rootY`'s doc** (it is the feet, not `body.y`). | These names sit exactly on the R03/R04 soles-on-the-floor path, where a misread is a sink or a float | Rig.ts:131, 141; SkinnedHumanoid.ts:33-38; Animator.ts:184; Engine.ts:755-756, 1776-1779, 2213 |
| 3 | **Floor vocabulary:** `floorHeight` (drawn) vs `fieldHeight` (smooth). Then decide which one props, A* and the minimap use. | Bodies and props stand on different surfaces, up to 0.5 m apart at faces | N-01; Engine.ts:506, 812; PathFinder.ts:282-285; INTEGRATION.md:38 |
| 4 | Correct `ArenaState.maxClimbTan`'s doc (`tan(maxSlope)/g`, not `tan(maxSlope)`). Name `CLIMB_HEADROOM`. | A wrong formula in the physics contract | ArenaPhysics.ts:32; TerrainRules.ts:115, 397; TerrainGround.ts:49 |
| 5 | **Gravity:** the gait's 9.81 vs physics' 24. Pick one, or name the reference g. | The run bob and the walk/run blend are computed for a different world than the one bodies fall in | Gait.ts:116, 203-205, 224; Animator.ts:413; ArenaPhysics.ts:15 |
| 6 | **`ringHalf` → `inscribedRadius`** in the new public APIs, and one helper instead of three loops. Fix the `arenaRadius` note. | The GLOSSARY already chose the word, and the overhaul exported the old one | TerrainPaint.ts:85-86, 103-107, 167; RingRelief.ts:40-46; Engine.ts:644-648; TerrainRules.ts:45-46, 75 |
| 7 | **Terrain paint must not borrow body `REGIONS`** (zone *stone* = region "torso") | Invisible today, a trap for anyone who debugs paint | TerrainPaint.ts:50-54, 109, 121 |
| 8 | **region / zone / band**, one meaning each (N-06) | Three subsystems overload them | Heightfield.ts:41-43; TerrainPaint.ts:51; contracts.ts:40; Terrain.ts:25; TerrainRules.ts:209; HeightOps.ts:98 |
| 9 | **Skill labels:** one `SKILL_KIND_LABEL` ("Dash / Power / Defense"); type `kind: SkillKind`; drop "powers" and "Defend" | The user-visible hint disagrees with the Menu and the SkillBar | SkillBar.ts:2, 26-27, 67; Engine.ts:65-66, 972; Menu.ts:541; Icons.ts:98 |
| 10 | **One `hash01`, one `smin`** in MathCore; remove the same-named exports | Three functions share one name with different outputs, and one function has two names | Glyphs.ts:83; Noise.ts:60, 72; HeightOps.ts:24; Sdf.ts:142-151; FootIK.ts:69-78 |
| 11 | **Split `Animator.update`** (255 lines) along its 9 steps; then L-2…L-5 | It is the largest new function, and its steps are already documented | Animator.ts:363-617 |
| 12 | Engine naming: `#terrain` → `#decor`; drop the shadowing `groundForward` local; add a `#facingYaw(f)` helper (4 copies) | Three easy misreads inside the integration seam | Engine.ts:158, 234-236, 650-656, 1686, 84, 1772, 2074-2076, 2207, 2216 |
| 13 | **One record per stage of the look pipeline**: `BodySpec` → `anatomy` (rename `DetailedAnatomy` / `rig.plan`); delete `meshPlan`; fix the contract header | The plan / anatomy / spec drift | contracts.ts:19, 162; Anatomy.ts:58, 179; SkinnedHumanoid.ts:43, 77; BodyMesh.ts:29 |
| 14 | **Units in doc comments** for the §2 list; type `role` | BRIEF rule 4 | §2 table |
| 15 | **Name the underived literals in the integration seam first**: MN-1…MN-9, MN-13, MN-20, MN-21. Then move the anatomy tables (MN-31, MN-32) into canon tables. | The seam literals couple lanes that must agree, so a lone edit desyncs them. The anatomy literals are scale-free already. | §4 |

## Not done / not verified

- I did not run the game, a server or a build. No fix was applied.
- The literal and units scans are heuristics. Every row above was read by hand, but rows outside the tables may exist.
  The unit token list treats words like *fraction* or *index* as units.
- `AnatomyParts.ts`, `FaceParts.ts`, `RecipeData.ts`, `Symbols.ts` and `Patterns.ts` were sampled, not read line by line.
  The R15 art tables in RecipeData and Symbols are treated as data, not magic numbers.
- The derivation values marked "(hand)" are arithmetic, not measurements.
