# Wave TEX — the layered material system: colour, roughness, relief, scars, tattoos (frozen contract + swarm)

Repo `~/Desktop/Mytherrania`, base commit 19f5c8c. Read FIRST `~/.hermes/skills/software-development/mytherrania-wave/SKILL.md`
(all pitfalls; CSP; BUILD_OUT=dist-<lane>; macOS has no `timeout`; pass test lists as separate args; NO_COLOR=1 before
grepping test output). **Rule of this wave: DO NOT DELETE — EXPAND AND ADAPT.** Every existing API keeps working (the v1
`PaintStack` of `body/contracts.ts`, `paintVertices`, `PATTERNS`, `NoiseAlgebra`, `TextureRecipes`, `paintStage`,
`Miniature`, `FormShade`, the cel shaders); new capability arrives as new modules, new optional fields and adapters.
With no new layer present, every existing output is byte-identical (pinned by tests).

## The user's ask (decoded)
1. A texture system of **multiple layers** with **all operator combinations** (blend, math, mask algebra).
2. **Layers for colour, roughness (rugosity) and textures** (relief / pattern detail).
3. Characters can have **scars** and **tattoos**.
4. Built by **expert agents across domains** (video games, programming, software architecture, optimisation,
   mathematics, medicine/dermatology, art, photography, miniature painting, painting…).
5. **Tests**, and **regular screenshots from multiple settings and angles with software information** burned in.
6. Agents **communicate**, and **every picture and every piece of code is verified by at least 3 agents**.

## What exists (read these before designing)
- `src/graphics/paint/`: `Layers.ts` (v1 stack → per-vertex sRGB colour, region masks), `Blend.ts` (6 separable modes:
  normal multiply screen overlay softLight add; HSL helpers), `Patterns.ts` (solid noise stripes spots scales freckles
  gradient **warpaint** veins **tattoo**, anchored frames), `NoiseAlgebra.ts` (a JSON expression language: noise sources,
  unary/binary/shaping/CSG/smooth-CSG/domain ops, periodic tiling), `Recipes.ts`/`RecipeData.ts` (race/class/sign
  recipes), `Miniature.ts` (curvature edge highlight + cavity + chiaroscuro + weathering), `FormShade.ts`,
  `Definition.ts`, `Spread.ts`, `Relevance.ts`, `Symbols.ts`, `PaintStage.ts` (pipeline stage record).
- `src/graphics/textures/`: `TextureRecipes.ts` + `BakeTexture.ts` (tileable RGBA8 bakes from NoiseAlgebra).
- `src/graphics/shaders/CelSkinned.ts`: cel lighting, vertex colour `vPaint`, bind-pose detail (`vBind`, `uAbs`
  abs relief, skin grain, cloth weave, `uDetailGain`), `uSpecular`. `CelShader.ts`, `Ink.ts`, `ToonLambert.ts`.
- Docs: `docs/graphics/*`, `docs/wave-v/REPORT.md` (form paint), `docs/wave-x/BODY.md` (texture detail),
  `docs/wave-gen/PAINT.md` (miniature pass), `docs/wave-gen/PIPELINE.md` (paint stage), `docs/wave-theme/PROMPT.md` (UI materials).
- Mesh facts: SDF skin, ~8–10 k triangles, grid cell 22–35 mm, **no UVs**; bind-pose positions/normals available in the
  shader; per-vertex region index. Vertex resolution is too coarse for a tattoo line or a scar edge: fine marks must be
  evaluated per FRAGMENT (procedural, from bind-pose position) or baked into a texture sampled by projection.

## Target architecture (contract C-MAT, owner L)
**Channels** (`src/graphics/paint/Channels.ts`): `albedo` (linear RGB), `roughness` (0 glossy … 1 matte), `height`
(signed metres of relief, feeds a perturbed normal), `ao` (0..1 baked occlusion multiplier), `mask*` (named scalar
masks), and optional `emissive` (RGB, for runes/embers), `subsurface` (0..1 warmth for thin skin: ears, lips). Each
channel declares its range, default, neutral element and how it is stored (per-vertex attribute vs per-fragment).

**Layer v2** (`src/graphics/paint/LayerStack.ts`): a layer = `{ id, name, enabled, target: ChannelWrites, source,
mask, opacity, blend per channel, order }`; **source** = a constant, a v1 `PatternKind` (+ params), a `NoiseAlgebra`
expression, a curvature/AO/height-derived field, or a **mark** (scar/tattoo decal); **mask** = a mask expression;
**ChannelWrites** says which channels the layer writes and with which operator (a layer may darken albedo, lower
roughness and raise height at once: a scar). A **group** layer composites its children first (isolated), then blends.

**Operators** (`src/graphics/paint/Operators.ts`), all pure, total, documented with formulas:
- Colour blend — separable: normal, multiply, screen, overlay, softLight, hardLight, vividLight, linearLight,
  pinLight, hardMix, colorDodge, colorBurn, linearDodge(add), linearBurn, darken, lighten, difference, exclusion,
  subtract, divide; non-separable: hue, saturation, color, luminosity. Defined in sRGB as the reference (Photoshop/W3C
  compositing spec), optional linear-space variant.
- Scalar ops for roughness/height/ao/masks: replace, add, subtract, multiply, divide (safe), min, max, average,
  lerp, screen, overlay, difference, power, clamp, remap, smoothstep, threshold, invert, **heightBlend** (pick the
  taller of two height layers with a soft transition — how scars and paint layer on skin).
- **Mask algebra**: and (min/product), or (max/probabilistic sum), xor, subtract, invert, feather (blur radius in mm),
  grow/shrink, from region, from curvature (convex/concave), from AO, from height, from noise expr, from a mark,
  from world direction (up-facing/down-facing), from distance to an anchor.
- **Compatibility**: v1 `BlendMode` maps 1:1; `stackFromV1(PaintStack)` builds an equivalent v2 stack;
  `paintVertices(v1)` output == the v2 evaluator's albedo for that stack (byte test).
- Algebraic laws pinned by property tests: identities (normal at alpha 0, multiply by white, screen by black, add 0),
  commutativity where it holds (multiply, screen, difference, exclusion, darken, lighten, add), non-commutativity
  documented, associativity of normal-over, range closure [0,1], no NaN on any input including 0/0 cases.

**Evaluation** (`src/graphics/paint/Evaluate.ts`): per-vertex pass writes the low-frequency channels into vertex
attributes (`color`, new `aMaterial` = roughness, height, ao, subsurface); a **fragment layer list** (scars, tattoos,
fine noise) is compiled into a fixed-size uniform block / data texture of decals evaluated in the shader from bind-pose
position (works without UVs, sticks to skin while it deforms). Budget (owner R): ≤ 16 fragment decals per body,
≤ 1 extra texture fetch per decal, preview frame ≤ +1 ms at 1280×800 on this M1, rig build ≤ +30 ms.

## Lanes (DISJOINT writes; read anything; no git commit/stash/checkout/add -A; parent commits)

| agent | domain experts it embodies | owns |
|---|---|---|
| **L** layer engine | software architect, mathematician | new `paint/{Channels,LayerStack,Operators,MaskAlgebra,Evaluate}.ts`, `paint/{Layers,Blend}.ts` (additive changes only), `body/contracts.ts` (optional fields), new `tests/wave_tex_layers_test.ts`, new `tests/wave_tex_operators_test.ts`, `docs/wave-tex/LAYERS.md` |
| **R** rendering | graphics programmer, optimisation engineer, photographer (lighting) | `src/graphics/shaders/**`, `src/graphics/BodySurface.ts`, `src/graphics/textures/**`, `src/graphics/body/SkinnedHumanoid.ts` (material wiring), new `tests/wave_tex_render_test.ts`, new `tools/bench-wave-tex.ts`, `docs/wave-tex/RENDER.md` |
| **M** marks | physician/dermatologist, tattoo artist, anatomist | new `src/graphics/paint/marks/{Scar,Tattoo,Placement,MarkLibrary}.ts`, `src/game/Characters.ts` (optional `appearance.marks`), new `tests/wave_tex_marks_test.ts`, `docs/wave-tex/MARKS.md` |
| **P** art direction | painter, miniature painter, game artist | `paint/{Recipes,RecipeData,Miniature,FormShade,Definition,Patterns,Symbols,Relevance,Spread,PaintStage}.ts` (expand), new `paint/Presets.ts`, new `tests/wave_tex_presets_test.ts`, `docs/wave-tex/ART.md` |
| **U** creator UI | game designer, UX | `src/ui/**`, `styles.css`, `index.html`, `src/graphics/PreviewScene.ts` (channel view modes), new `tests/wave_tex_ui_test.ts`, new `tools/probe-wave-tex-ui.ts`, `docs/wave-tex/UI.md` |
| **C** capture | photographer, QA tooling | new `tools/capture-wave-tex.ts`, new `src/graphics/CaptureHud.ts`, `artifacts/wave-tex/captures/**`, `docs/wave-tex/CAPTURE.md` |
| **QC** code verifier | senior reviewer, optimisation, mathematician | only `tools/verify-wave-tex-code.ts`, `docs/wave-tex/VERIFY-CODE.md`, `artifacts/wave-tex/verify-code/**` |
| **QA** art verifier | painter, miniature judge, photographer | only `tools/verify-wave-tex-art.ts`, `docs/wave-tex/VERIFY-ART.md`, `artifacts/wave-tex/verify-art/**` |
| **QD** domain verifier | physician/dermatologist, game designer | only `tools/verify-wave-tex-domain.ts`, `docs/wave-tex/VERIFY-DOMAIN.md`, `artifacts/wave-tex/verify-domain/**` |

## Contracts per lane
- **C-REND (R)**: the cel shader reads `roughness` (wider/softer specular band and rim when glossy, none when matte),
  `height` → perturbed normal (finite differences of the height field in the bind frame, amplitude bounded so the cel
  bands never invert), `ao` (multiplies the lit term), `subsurface` (warm wrap in the terminator), `emissive`; the
  fragment decal list; channel **debug views** (`albedo | roughness | height | normal | ao | marks | final`) selectable
  per material (used by U and C). Existing look identical when the new channels are neutral (pixel test in Chrome:
  0 changed pixels with neutral channels). Bench before/after: frame ms, build ms, GPU memory estimate.
- **C-MARK (M)**: `Scar = { kind: "incision"|"laceration"|"claw"|"puncture"|"burn"|"stitched", region, anchor (u,v on
  the region frame), length mm, width mm, angle (default along Langer's lines for that region), ageDays → stage
  inflammatory (red, raised, glossy) → proliferative (pink) → mature (pale silver, flat or atrophic, glossy), keloid
  chance by ancestry, seed }`. Channel effects: albedo (stage colour, never > ink contrast of a tattoo), roughness
  lower than skin (scar tissue is shiny), height raised (hypertrophic/keloid) or sunken (atrophic), hair follicles
  absent on the scar line (expose a mask H can read later). `Tattoo = { style: "tribal"|"runic"|"sigil"|"band"|
  "script"|"dotwork", motif from race/class/sign symbol sets (`Symbols.ts`), region, anchor, size mm, angle, ink colours
  (black/blue-black/red/ochre/woad; race-appropriate), ageYears → blur (ink migration mm) and fade, wraps around limbs
  following the surface frame, distorts with muscle (bind-pose evaluation), seed }`. Placement solver: no overlap
  beyond a threshold, avoids face features unless facial tattoo style, respects region bounds, mirror option.
  Generated defaults: by ancestry/class/age (orcs more scars and woad tattoos, dwarves clan bands, elves fine dotwork
  sigils, humans rare); appearance.marks overrides. All deterministic from the seed.
- **C-ART (P)**: presets (`Presets.ts`) of complete v2 stacks per race × sub-race and per garment type (cloth, leather,
  metal trim) built with the new channels: skin roughness by ancestry (orc leathery 0.7, elf satin 0.35, dwarf
  weathered 0.6, human 0.5 — tune by eye and justify), pores/grain as relief, garment roughness (wool matte, leather
  semi, metal glossy with edge wear), the miniature workflow mapped onto layers: basecoat → wash (cavity multiply) →
  layer → edge highlight → glaze (colour filter) → varnish (roughness). Old recipes stay; `Presets` wraps them.
- **C-UI (U)**: in the creator (Fighters → + New): a **Marks** panel (add/remove scar or tattoo, kind/style, region
  picker, drag on the 3D model to place — reuse ViewerControls raycast —, size, angle, age, ink colour, mirror), a
  **Layers** inspector (list of the active stack: toggle, opacity, blend operator per channel, reorder by drag), and a
  **channel view** switch (albedo/roughness/height/normal/ao/marks/final). Saved in `appearance.marks` /
  `appearance.layerOverrides`. Keep all layout invariants (no overflow, 44 px targets, ≥ 4.5 contrast).
- **C-CAP (C)**: `tools/capture-wave-tex.ts` renders a **capture matrix** on demand (and every READY): 4 races × 2 sexes
  × {reference, scarred+tattooed} × lighting {studio top key, rim-backlit, flat/unlit albedo, arena daylight, dusk}
  × angles {front, back, left, right, 3/4 front-left, 3/4 back-right, top, close-ups: face, forearm, back} × channel
  views; each image has a **software information HUD** burned in by `CaptureHud.ts`: git commit, build time, race/
  sub-race/sex/class, active layers + operators, marks list, channel view, light setup, camera yaw/pitch/distance/fov,
  triangle count, build ms and frame ms. Contact sheets per subject; an `index.json` for verifiers; a `diff` mode vs a
  previous run (pixel diff + changed-region boxes). Run it at the start (baseline), and after every READY.

## Verification rule (the user's "verified by at least 3")
Every READY must collect **PASS from at least three different agents** before the lane is done:
- **code**: its ring reviewer + **QC** + one more builder who uses that code;
- **pictures** (any capture sheet a READY relies on): **QA** + **QD** + the ring reviewer, each naming the sheet path
  and the region they judged. Vision verdicts must be paired with a measurement (pixel diff, contrast, luminance,
  colour distance) or a control question on a reference sheet; say when a verdict is a judgement.
Ring: **L → R → M → P → U → C → L** (each reviews the next). QC reviews all code; QA and QD review all pictures; any agent
may post FAIL with evidence. A FAIL is answered by FIX + READY. A lane is finished when its latest READY holds ≥ 3 PASS
(incl. QC, and QA + QD if it produced pictures), or after 3 rounds (open FAILs listed).

Board: `BOARD_DIR=artifacts/wave-tex deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` /
`BOARD_DIR=artifacts/wave-tex deno run -A tools/board.ts read <since> --to <ME>`. CLAIM first; L posts the final
Channel/Layer/Operator/Mask types early; M posts the Scar/Tattoo shapes early; R posts the decal uniform layout early.
While waiting `sleep 150` (max ~15). SPEC pins: L TX1-29, R TX30-39, M TX40-59, P TX60-69, U TX70-79, C TX80-89.
Evidence generated by code. Gate per lane: `deno task check`, `deno lint`, its tests + the existing tests importing its
modules; the parent runs the full suite and commits.
