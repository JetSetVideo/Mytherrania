# Mytherrania overhaul — shared brief (2026-10-28)

Read this whole file before writing anything. Project root: `/Users/macmax/Desktop/Mytherrania`
(Deno 2.9 + TypeScript strict + three@0.180, bundled by `deno task build`, served on 127.0.0.1:8788).
The project is a git repo (snapshot commit `c5b55af`). Baseline: `deno task check` green,
`deno task lint` clean, `deno task test` 548/548 pass.

## The request, decoded (voice-transcribed; phonetic drift resolved)

The user plays on a **French AZERTY Mac M1** and tests mouse-first. Their ask, in their words
("…") and as requirements:

| Id | Requirement | User's words (abridged) |
|----|-------------|-------------------------|
| R01 | Every screen reached from the title menu has a **Back** button that returns to the PREVIOUS screen (a history stack), so the player can backtrack. Esc does the same. | "add a back button … the pages following they should have a back menu so I can backtrack" |
| R02 | Birth signs get **small white icons on the left** of each sign button (monochrome white line icons, not emoji). | "add some icons to the birth signs, little white icons on the left" |
| R03 | 3D bodies must look **full and complete**: one continuous skin, no cut/sliced volumes, all parts connected at generation time; the **soles of the feet sit on the ground**. | "the skins around the model … should not be cutted … all the parts are connected … the plant of the feet, not touching the ground" |
| R04 | **Animation rework**: smooth, continuous motion built on interpolation (lerp/slerp, damping, springs, easing), a real gait cycle with planted feet, blended states. | "the animation is totally wrong … use all the mathematics … like lerp function to make the animation smooth" |
| R05 | **Trails / effects** when charging or dashing, from the start position to the target, and on weapon swings; applied across all skills. | "add effects like trades [trails] when they're charging from the beginning area until … the target" |
| R06 | **Minimap drastically improved**: readable terrain, walls, props, pickups, facing, scale, fog. | "the minimap is not good enough and need to improve drastically" |
| R07 | **Map generation rules**: neighbouring areas are never too high or too low relative to each other (slope limit), EXCEPT deliberate features (hole, cliff) that are flagged as such; heights normalised; the **Pareto 80/20 distribution** governs feature sizes (80% gentle, 20% dramatic). | "adjacent area … never too high or too low … except … a hole or a cliff … normalization of percentages … the parental [Pareto] law with the 80%, 20%" |
| R08 | **Derived, not hard-coded**: most variables should be CALCULATED from a few named base parameters (top-down), with min / max / mean / median / target spread and normalisation equations; coefficients, signs and inversions explicit. | "most variables they should have calculation instead … find the minimum and the maximum … the average and median … a target spread … good equations with normalization" |
| R09 | The **powers (skills) HUD sits at the bottom, aligned horizontally**. | "the powers they are on the bottom and they are aligned horizontally" |
| R10 | **Clear vocabulary and definitions** everywhere; split/factorise functions; give functions explicit parameters instead of buried constants. | "extend definition and improve vocabulary … divide and … factorize the functions" |
| R11 | **Review agents** for optimisation, security, architecture, code and vocabulary, using up-to-date APIs. | "with all the agents … for the optimization, for the security, for the architecture, for the code, vocabulary" |
| R12 | **Pathfinding** over the generated terrain: graph of vertices/points, A*, smoothed waypoints. | "the past [path] finding you take vertices and the points" |
| R13 | **Performance from the triangle up**: count triangles/draw calls, estimate GPU cost, optimise step by step, every screen size. | "estimation from how the graphic cards … calculate … from the lowest triangle generation … for all type of screens" |
| R14 | **Movement works on AZERTY**, and the game **detects the keyboard layout** (most players are QWERTY) and labels keys accordingly. | "the moving system … doesn't work … AZERTY … I need to detect the keyboard" |
| R15 | **Procedural modelling toolkit**: components with visual attributes; more anatomy; **volume operators** (union / subtract / intersect, smooth variants); **sculpt brushes** (inflate, dig, push/pull, smooth, pinch, crease, flatten, …) each used at least once; **texture painting with layers and patterns** driven by parameters. Generate as much as possible procedurally while staying coherent. | "use more anatomy … the volumes operators … dig and … push out all the brushes … use them at least once … paint with the textures … different layers … patterns that are influenced by the parameters" |

Glossary of drift: "shumble" = rework/overhaul; "trades" = trails; "parental law" = Pareto
principle; "the past finding" = pathfinding; "AZRT" = AZERTY; "cables/boards" = keyboards;
"plant of the feet" = soles; "in and out operators" = CSG union/subtract.

## Facts the parent already verified (do not re-investigate)

- **Movement bug (R14), root cause:** `src/input/Input.ts` returns z = -1 for KeyW; `Engine.ts:1819`
  negates it (`keyZ: -move.z`) and `Engine.ts:1835` negates again (`fwd = -analog.z`), so the
  forward key walks the player AWAY from the opponent. Measured in the browser: holding Z moved
  x -2.5 -> -4.45 with the opponent at +2.5. The gamepad path is correct. `KeyQ` (the AZERTY "A" key)
  is bound to both "move left" and skill 0. **The parent fixes this; no lane touches input.**
- The arena floor is FLAT (`ExtrudeGeometry` of the outline in `Engine.#buildArena`); "hills" are
  decorative spheres (`Engine.#rebuildTerrain`). There is no heightfield and no pathfinding.
- Bodies are built per pivot from lofted parts (`src/graphics/Humanoid.ts`, `Loft.ts`, `BodySurface.ts`,
  `Stitch.ts`) and joined by socket spheres; each pivot is its own mesh + inverted-hull outline.
  The cel shader (`src/graphics/shaders/CelShader.ts`) is a `ShaderMaterial` with NO skinning support.
- Poses are discrete (`Skeleton.setPose("idle"|"walk"|"attack"|"hit"|"ko"|"skill")`), joint angles
  ease toward targets in `Skeleton.update(dt)`; there is no gait cycle and no foot IK.
  The rig group is placed at `body.y` (body centre, 0.6 m), not at the feet.
- Only the sheet and digest screens have a Back button, and it jumps to the title, not the previous
  screen. The creator ("Create your fighter") has none. Birth signs render emoji (🐍⛰🔥🌙⚡🕳).
- The skill HUD (`#hud-skills`) is rebuilt with `innerHTML` every 0.25 s by `Engine.#updateHUD`.
- The minimap (`Engine.#drawMinimap`) is a 132 px canvas: fog cells, the outline, two dots.

## Landed foundation — USE it, don't redo it

`src/core/MathCore.ts` (tested, `tests/mathcore_test.ts`): `clamp, clamp01, lerp, invLerp, remap,
smoothstep, smootherstep, easeInOutCubic, damp(current,target,lambda,dt), lambdaFromHalfLife,
wrapAngle, lerpAngle, dampAngle, Spring + springStep(s,target,smoothTime,dt), Summary +
summarize(values), quantileSorted, normalizeMinMax, PARETO_80_20_ALPHA, paretoSample(rng,xm,alpha,cap),
topShare(values,topFraction), rng32(seed)`. Use these instead of re-deriving them. If you need a
new shared math helper, put it in YOUR lane's files and list it in your handoff; the parent decides
whether it moves into MathCore.

## Rules for every lane

1. **Own only your files.** Create NEW files in your lane's folders. Never edit a file another lane
   owns, and never edit these shared files (the parent integrates them serially):
   `src/engine/Engine.ts`, `src/graphics/Humanoid.ts`, `src/input/*`, `main.ts`, `deno.json`,
   `index.html`, existing `tests/*` (except lane G, which owns `src/ui/Menu.ts` + `styles.css`).
   When integration needs a change in a shared file, write the exact code to paste (with the
   anchor lines) in your handoff file.
2. **Write early, write often.** First file on disk within ~10 tool calls; no more than ~5
   reads/searches in a row without writing; each write <= ~20k characters.
3. **Code style:** TypeScript strict, `noUnusedLocals`, `noUnusedParameters`. Import three as
   `// @deno-types="@types/three"` then `import * as THREE from "three";`. Use `globalThis`, never
   `window`. No network, no CDN, no external assets. CSP is `default-src 'self'; style-src 'self'`:
   no inline `style=""` strings — drive dynamic values with `el.style.setProperty("--x", v)`.
   Pure logic (no THREE, no DOM) goes in its own module so it can be unit-tested in Deno.
4. **Vocabulary (R10):** every exported function and type gets a doc comment that DEFINES its terms
   and units (metres, seconds, radians, 1/s). Name things for what they mean (`soleHeight`, not
   `h2`). Constants that can be derived must be derived from named base parameters, with the
   equation in the comment (R08). No magic numbers without a one-line reason.
5. **Hot paths allocate nothing per frame** (reuse typed arrays/vectors). Count triangles you emit.
6. **Tests:** put tests in `tests/<lane-file>_test.ts`. Run ONLY your own files:
   `cd /Users/macmax/Desktop/Mytherrania && deno check <your files> && deno test --allow-read <your tests>`.
   Other lanes are writing concurrently, so the whole-tree `deno task check` may be red for reasons
   that are not yours — do not chase those. If a shell command is denied, do not retry it: write
   the test anyway and report "not executed". Quote REAL command output only; never invent numbers.
7. Do not run `deno task build`, do not start or stop servers, do not touch port 8788.
8. **Handoff:** finish by writing `docs/overhaul/lane-<LETTER>.md` with: files created; every export
   with its exact signature; the integration patch for shared files (anchor + code); the commands
   you ran with their real output; what is NOT done or not verified; risks.

## Lanes

| Lane | Requirements | Owns (new files only unless stated) |
|------|--------------|-------------------------------------|
| A Body | R03, R15 (volumes, brushes, anatomy) | `src/graphics/body/**`, `src/graphics/shaders/CelSkinned.ts`, `tests/body_*_test.ts` |
| B Paint | R15 (texture layers, patterns) | `src/graphics/paint/**`, `tests/paint_*_test.ts` |
| C Motion | R04 (gait, foot IK, blending) | `src/game/anim/**`, `tests/anim_*_test.ts` |
| D Trails | R05 | `src/graphics/fx/**`, `tests/fx_*_test.ts` |
| E Terrain | R07, R08, R12 | `src/world/**`, `src/graphics/TerrainMesh.ts`, `tests/world_*_test.ts` |
| F Minimap | R06 | `src/ui/Minimap.ts`, `src/ui/minimap/**`, `tests/minimap_*_test.ts` |
| G Menu/HUD | R01, R02, R09 | `src/ui/Menu.ts` (edit), `styles.css` (edit), `src/ui/Icons.ts`, `src/ui/SkillBar.ts`, `src/ui/NavStack.ts`, `tests/ui_*_test.ts` |
| H Vocabulary | R08, R10 | `docs/GLOSSARY.md`, `docs/review/**` (read-only on code) |
| Parent | R14, R11, R13, integration | everything shared |

Contract for lanes A and B: `src/graphics/body/contracts.ts` (written by the parent before dispatch).
