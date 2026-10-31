# Lane H-B — messages to the parent

Lane H-B makes the ancestry hierarchy visible in the 3D rig. Files touched:
`src/graphics/Humanoid.ts`, `src/graphics/body/FaceParts.ts`, `src/graphics/body/Proportions.ts`,
`tests/ancestry_look_test.ts`, plus an **additive** change to `src/graphics/shaders/CelShader.ts`
(announced here, as the brief requires).

## 1. Skin creases — route (a), per-vertex colour (no extra mesh, no doubled outline)

Every junction the brief names (neck/chest, shoulder root, elbow, wrist, hip root, knee, ankle)
plus the face fold patches (under-eye, cheek-fold, brow — gated by `Ancestry.skin.zones`) is
darkened by writing a `color` attribute on the **merged** pivot geometry. The cel shader multiplies
its base (white) by that vertex colour, so the skin tone darkens toward `skin.crease` near a
junction **inside the same mesh**. This is route (a): it adds no geometry and therefore no second
inverted-hull outline inside a pivot (DESIGN.md item 18 is respected by construction).

### CelShader.ts change (additive only)
`createCelMesh(geometry, color, specular, opts?)` gained an optional 4th argument
`{ vertexColors?: boolean }`; the cel vertex shader now carries a `vColor` varying
(`vColor = color` under `#ifdef USE_COLOR`, else `vec3(1.0)`) and the fragment shades
`celShade(baseColor * vColor, …)`. With no `opts` the behaviour is byte-for-byte the old one —
`tests/graphics_test.ts` (which calls `createCelMesh(geo, "#dfaa55")` and asserts the old
material/shader strings) still passes. This mirrors the pattern `CelSkinned.ts` already uses.

## 2. Deviations from the frozen BRIEF (named, not hidden)

- **`HumanoidRig` gained a second optional field, `look?: AncestryLook`**, alongside
  `secondaryMasses`. BRIEF 1.3 says "exactly one" field; `look` is the mechanism behind the
  queryable report the brief also asks for (item 9) — it is the look a build actually produced,
  read by `ancestryLook()`. It is optional and additive; drop it from the interface if the parent
  prefers the report to rebuild the numbers independently.
- **`HumanoidRig.secondaryMasses` is OPTIONAL** (`secondaryMasses?: THREE.Object3D[]`), not the
  required field BRIEF 1.3 states. A required field would make `body/SkinnedHumanoid.ts` (which
  returns `HumanoidRig & SkinnedExtras` and builds no such nodes) fail `deno check` — and that file
  is **not** mine to edit. The legacy `buildHumanoid` sets it (hair fall, hair tip, side locks,
  beard mass, beard tip, two brow tips, in that fixed order); the skinned rig leaves it undefined.
  The parent's 3-line `SecondaryMotion` wiring inside `Humanoid.update` should guard for undefined.
- **`src/graphics/body/Proportions.ts`**: `earScale` now comes from `Ancestry.ears.lengthMul`
  (was `RaceAppearance.earMul`). At race level the values coincide; subraces differ by ≤0.02, so the
  live ear is effectively unchanged while the hierarchy now drives it. The shared pure look helpers
  (`hairColourFor`, `isBald`, `beardModeFor`, `hairFall`, `hairLengthM`, `earLengthM`, `browDims`,
  `tuskDims`, `lookSeed`) live here so BOTH rigs read one source of truth.

## 3. Triangle count (the budget)

- **Live skinned rig** (`buildSkinnedHumanoid`, what the engine renders), per ancestry:
  human 10408, elf 11244, dwarf 10140, ork 10972, imperial 10408, nomad 10408, islander 10396,
  high 11288, wood 11244, dark 11244, mountain 10920, forge 10916, deep 10140, greenhide 11132,
  ironhide 11112, bloodfang 11036 — **all under 12 000**.
- The **legacy pivot rig** (`buildHumanoid`, used only by `Portrait.ts`) is ~31 144 triangles for every
  ancestry — that is its **pre-existing** weight (its hands clone a full loft per finger), unchanged
  by this lane; the ancestry look adds essentially nothing there because hair/beard/brow/ear/tusk
  meshes are attached directly, not merged into the counted buckets. `ancestryLook().triangleCount`
  reports the legacy build it performs; the budget assertion in `tests/ancestry_look_test.ts` is made
  against the live skinned rig.

## 4. Visual concerns for the parent to shoot and check with vision

I cannot see images, so these are the places worth a screenshot (all measured finite and in range,
but their LOOK is unverified):

1. **Crease bands.** The joint sites darken a sphere of radius ≈ `1.4–1.8 ×` the part's root radius
   around each pivot origin; the face patches are ~`0.3 ×` the skull radius. Check the band is a soft
   darkening at the crossing (not a hard blob) and that the elf's `#2f3d63` under-eye/cheek patches
   read as "bluish darkening". If the bands are too wide/narrow, the radii are the single knob
   (`crease(...)` radii in `buildHumanoid`).
2. **Hair curl/lobes.** A curled fall (ork 0.7) is wider and shorter with up to 4 side lobes; a
   straight fall (elf 0.15) is a smooth tube. Check the lobes read as a mass, not floating balls.
3. **Elf ear tip.** A cone is added for `pointed > 0.4`; verify it extends past the skull and is not
   engulfed by the hair cap (the SDF path uses a different ear builder; only the legacy/portrait rig
   uses this one). The live rig's ears come from `AnatomyParts.earNodes`.
4. **Elf brow tip.** The brow box is shifted outward by `tipPast/2`; verify the outer tip visually
   passes the skull silhouette on the legacy rig.
5. **Beard coverage.** A coverage < 1 beard's top edge sits at the mouth line (`beardTopY ===
   mouthY`), so the mouth should stay readable; check the dwarf's full beard does not bury the lower
   lip and the ork's chin growth is chin-only (not jaw-wrapping).

## 5. Test / tooling notes

- `tests/body_brush*_test.ts` referenced in the brief **does not exist** in this repo; the body/
  graphics tests that exercise these files are `body_mesh_test`, `bodyshape_test`, `body_skin_test`,
  `body_detail_test`, `body_sdf_test`, `bodygraph_test`, plus `graphics_test` and
  `raceappearance_test` — all pass.
- One real bug found and fixed while testing: a JS XOR yields a **signed** 32-bit int, so the hair
  palette and bald hashes could go negative and index the palette backwards (`colors[-k]` →
  `undefined` → a `THREE.Material: parameter 'color' has value of undefined` warning). Both hashes
  are now re-cast `>>> 0`.
