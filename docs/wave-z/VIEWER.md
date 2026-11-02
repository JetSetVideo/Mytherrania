# Wave Z lane G — the viewer: stone floor and plinth, a real soft shadow, the light from above, full-card portraits

Owner: agent G. Files: `src/graphics/PreviewScene.ts`, `src/graphics/PortraitStudio.ts`, `src/graphics/shaders/CelShader.ts`
(one additive, default-off fill term), `tests/wave_z_viewer_test.ts` (SPEC Z40-Z48), `tools/probe-wave-z-viewer.ts`,
`artifacts/qa-wave-z/viewer/**`. No DOM change (lane F owns the DOM), no Engine change.

## What changed

- **One stage for both pictures** (`PreviewStage`): the plinth, the floor, the overhead key's shadow pass and the light
  written into the shared cel uniforms for one draw (restored in `finally`, also after a throw — SPEC Z47). The Creator
  turntable (`PreviewScene`) and the hero portrait (`PortraitStudio`) both draw through it, so the card picture is lit and
  grounded exactly like the turntable. Before, the portrait had no ground and was lit by whatever the cel uniforms held
  (its own THREE lights never reached the cel materials).
- **Plinth**: same `PEDESTAL_RADIUS` 0.6 m and height; the top edge is now a rounded, worn lip (lathe profile,
  `PLINTH_BEVEL` 2.2 cm) with chips knocked out of it; walls and footing are coursed slabs; the walking disc has hairline
  cracks, a foot-polished centre and a paler chipped rim besides the wave-X rings.
- **Floor**: a flagstone floor (irregular slabs from a tileable jittered Voronoi, each slab its own tint and tilt, sunk
  mortar) around the plinth at y = -0.12 m, radius 3.4 m, darkening and fading into the backdrop from 1.5 to 3.3 m, with
  ambient occlusion where the footing meets it. In the Creator it fades to the transparent canvas, in the portrait to the
  walnut backdrop.
- **Stone shading**: every stone texture carries its HEIGHT in alpha; the stone shader bumps the normal from it
  (screen-space derivatives, faded where a pixel spans many texels so the far floor does not shimmer) and, because a
  bump only moves band edges under cel bands, also modulates the albedo by the lambert change and darkens the hollows.
- **Real soft shadow**: the overhead key's 1024² depth map (unchanged, back faces, slope offset) is read on the stone by a
  PCSS-style lookup: a 12-tap blocker search, then a 16-tap rotated spiral whose radius grows with the blocker's height
  (`SHADOW_PENUMBRA_PER_M` 0.045, a ~2.6° sun): crisp at the soles, soft from the head. The painted contact blob stays.
  The body keeps the shared hard 3x3 PCF (the arena's shader, untouched).
- **Light**: key `PREVIEW_KEY_DIR` [0.03, 1, 0.16] = elevation 80.8° (was 76.3°), still a little in front. New **face fill**:
  a soft unbanded warm light from the viewer's side, 12° above the horizon, following the camera
  (`PREVIEW_FACE_FILL`, CelShader `uFillDir`/`uFillColor`). Its default colour is black, so every other scene (the arena)
  adds exactly 0 (SPEC Z41).
- **Why not exactly vertical (S asked, Z-25)**: the key is 9.2° off the zenith, toward the front. At 0° every face,
  chest and front of the plinth wall would get n·l ≈ 0 and fall into the darkest band (wave X already measured dark
  faces at 13.7° off), and the shadow would collapse to the soles' outline, which reads as "no shadow" from the default
  pitch (skill pitfall 26: a large front component throws the shadow behind the feet instead). 9.2° keeps the shadow a
  pool round the feet, slightly behind, and keeps faces in the first lit band with the fill on top.
- **Framing**: unchanged law (distance from `PEDESTAL_RADIUS` and the fov, SPEC Z43). The portrait uses the same rule:
  `portraitFraming` solves a camera pitched 0.1 rad down so that the frame top (4.2·R = 2.52 m, the tallest standing fighter
  + raised blade) lands at 10 % of the image height and the soles (plinth top) at 70 %; a model above the frame top is
  framed by its own top. A 1.8 m figure's crown lands at ~26 %, a 2.2 m ork's at ~17 % — the LV badge corner is free.
- **Foot reserve (+ New plate, r3)**: lane F floats the name/tags band (`.hero-plate-foot`, an opaque-ish scrim) over the
  BOTTOM of the Creator canvas — exactly where the wave-X framing put the plinth (soles at ~92 % of the height), so the
  feet, plinth and shadow were hidden. `previewFraming(..., footReserve)` grows the frame downward by that share (the
  frame top stays 4.2·R, the distance stays one number for every race, SPEC Z49); `PreviewScene.resize()` reads it from
  `data-foot-reserve` on the canvas if present, else measures F's band (geometry reads only, every 20 frames).
  Public API unchanged.
- **Portrait output** (agreed with F, board Z-6/Z-8/Z-11): with no option the studio renders a **3:4 opaque JPEG** of
  560 CSS px (F's widest plate) x min(2, devicePixelRatio) — 560x747 at DPR 1, **1120x1493 at DPR 2**
  (`portraitPixelSize`). The floor
  under the name band is dimmed further (`PORTRAIT_FLOOR_FAR_DIM`). Existing callers are unchanged:
  `new PortraitStudio()` (Engine) gets the card picture, `new PortraitStudio({ size })` stays a square, new `width/height`,
  `type`, `quality` options; `renderPortrait(profile)` keeps its signature and a PNG (the sheet's `<img>` in Menu accepts only `data:image/png`): a
  300x400 picture of the same stage and framing.
  The data URL stays under `portraits[playerId]`.
- **Bug found and fixed on the way**: a painted `scene.background` (the portrait's walnut texture) is drawn into the
  shadow map by the depth pass and reads back as blockers everywhere (a "light rectangle" on the floor). The stage hides
  the background for the depth pass only (SPEC Z47 checks the order).
- QA surface: `PreviewScene.debugLightVector()`, `PortraitStudio.debugInfo()` (size, type, last draw+encode ms).

## How it is measured (tools/probe-wave-z-viewer.ts)

Real Chrome (Metal ANGLE, DPR 2). Before = HEAD extracted with `git archive HEAD | tar -x -C <scratch>` and built there
(skill pitfall 24). For every race x sex: the canvas is read back right after a render (no preserveDrawingBuffer);
the rig the page shows is rebuilt in Deno (`buildPreviewRig`, pure) and ray-cast from the page's own camera to find
the face pixels (nose bridge + both cheeks), the visible plinth/floor points, and the shadow's expected footprint.

- face luminance: mean 0.2126R+0.7152G+0.0722B (0-255, x alpha) in 3x3-px windows at the three face points, front view.
- floor visible: canvas alpha (>200) at the floor points (r 0.9-2.2 m) the camera sees.
- light from above: plinth TOP (normal up) brighter than its camera-facing WALL (normal level).
- shadow present: near-feet/rim luminance ratio < 0.8 (cast + contact) and a cast-only darkening on the plinth top.
- cast in the light's direction: from the side, the cast-only dark set (shadow on minus off > 6) overlaps the rig
  projected ALONG the key better (IoU) than the rig projected straight down.
- portrait: render ms per profile, image size/type, zone luminance (badge corner top-left 30% x 14%, name band = bottom
  30%), face luminance through the studio's camera, crown/sole positions.
- timing: `--timing <scratch>` bundles both trees' PreviewScene + PortraitStudio into bare pages (no engine loop) and
  interleaves them for 8 rounds (a busy machine drifts between separate runs).

Commands:

```
BUILD_OUT=dist-viewer deno task build
deno run -A tools/probe-wave-z-viewer.ts --dist dist-viewer --tree . --tag after
S=~/.hermes/cache/scratch/wz-head; mkdir -p $S && git archive HEAD | tar -x -C $S && (cd $S && BUILD_OUT=dist-viewer deno task build)
deno run -A tools/probe-wave-z-viewer.ts --dist $S/dist-viewer --tree $S --tag before
deno run -A tools/probe-wave-z-viewer.ts --timing $S
deno run -A tools/probe-wave-z-viewer.ts --doc        # regenerates the tables below
deno test --allow-read --allow-env tests/wave_z_viewer_test.ts
```

Screenshots: `artifacts/qa-wave-z/viewer/{before,after}-preview-<race>-<sex>-{front,side}.png` (element screenshots of
`#creator-preview`, i.e. with whatever DOM lane F lays over it) and `{before,after}-portrait-<race>-<sex>.{png,jpg}`.

## Measurements

<!-- GENERATED:BEGIN -->
Generated by `deno run -A tools/probe-wave-z-viewer.ts --doc` from artifacts/qa-wave-z/viewer/report-before.json, report-after.json, timing.json.

### Preview (Creator viewer), real Chrome, DPR 2

| race | sex | face lum before | face lum after | floor visible b/a | top > wall b/a | near/rim b/a | cast IoU along light / straight down (after) | shadow present b/a |
|---|---|---|---|---|---|---|---|---|
| human | male | 165.92 | 182.58 | no / yes | no / yes | 0.669 / 0.682 | 0.548 / 0.27 | yes / yes |
| human | female | 164.12 | 185.17 | no / yes | no / yes | 0.69 / 0.694 | 0.545 / 0.25 | yes / yes |
| elf | male | 181.92 | 202.95 | no / yes | no / yes | 0.712 / 0.699 | 0.516 / 0.243 | yes / yes |
| elf | female | 190.86 | 213.89 | no / yes | no / yes | 0.68 / 0.699 | 0.486 / 0.224 | yes / yes |
| dwarf | male | 135.04 | 156.57 | no / yes | no / yes | 0.731 / 0.715 | 0.697 / 0.29 | yes / yes |
| dwarf | female | 133.95 | 155.21 | no / yes | no / yes | 0.74 / 0.702 | 0.691 / 0.258 | yes / yes |
| ork | male | 116.95 | 128.45 | no / yes | no / yes | 0.706 / 0.734 | 0.74 / 0.234 | yes / yes |
| ork | female | 131.52 | 148.65 | no / yes | no / yes | 0.733 / 0.731 | 0.757 / 0.242 | yes / yes |

| summary | before | after |
|---|---|---|
| shadowPresent | 8/8 | 8/8 |
| castAlongLight | 8/8 | 8/8 |
| floorVisible | 0/8 | 8/8 |
| topBrighterThanWall | 0/8 | 8/8 |
| faceLumMean | 152.54 | 171.68 |
| faceLumMin | 116.95 | 128.45 |
| contactRatioMean | 0.71 | 0.71 |
| onOffMedianMax | — | 0.684 |
| feetRimMedianMax | — | 0.749 |
| frameMsMean | 4.51 | 6.36 |
| page errors | 0 | 0 |

### Portrait (PortraitStudio, default options)

| race | sex | before size | after size | face lum b/a | badge zone lum b/a | name band lum b/a | head top % (after) | soles % (after) |
|---|---|---|---|---|---|---|---|---|
| human | male | 256x256 image/png | 1120x1493 image/jpeg | 155.17 / 161.57 | 23.6 / 23.8 | 39 / 41.9 | 27.61 | 70 |
| human | female | 256x256 image/png | 1120x1493 image/jpeg | 148.5 / 158.23 | 23.6 / 23.8 | 39.1 / 41.9 | 27.6 | 70 |
| elf | male | 256x256 image/png | 1120x1493 image/jpeg | 173.17 / 183.75 | 23.6 / 23.8 | 38.8 / 41.8 | 27.5 | 70 |
| elf | female | 256x256 image/png | 1120x1493 image/jpeg | 174.23 / 184.35 | 23.6 / 23.8 | 39.1 / 41.9 | 27.5 | 70 |
| dwarf | male | 256x256 image/png | 1120x1493 image/jpeg | 135.69 / 151.32 | 23.6 / 23.8 | 41 / 41.9 | 27.13 | 70 |
| dwarf | female | 256x256 image/png | 1120x1493 image/jpeg | 139.71 / 155.72 | 23.6 / 23.8 | 40.9 / 41.9 | 27.13 | 70 |
| ork | male | 256x256 image/png | 1120x1493 image/jpeg | 120.47 / 127.97 | 23.6 / 23.8 | 41.9 / 41.9 | 27.62 | 70 |
| ork | female | 256x256 image/png | 1120x1493 image/jpeg | 129.28 / 133.53 | 23.6 / 23.8 | 41.8 / 41.9 | 27.61 | 70 |

| summary | before | after |
|---|---|---|
| renderMsMean | 730.51 | 730.1 |
| drawEncodeMsMean | — | 65.8 |
| faceLumMean | 147.03 | 157.06 |
| nameBandMean | 40.2 | 41.89 |
| badgeMean | 23.6 | 23.8 |
| bytesMean | 85351 | 169900 |

### Paired timing (both trees bundled into bare pages, interleaved 8 rounds; medians)

| measure | before | after |
|---|---|---|
| preview frame ms (shadow + main pass + 1-px read-back, 480x640 css @ DPR 2, ork) | 3.69 | 4.19 |
| portrait ms per new profile (rig build + draw + encode) | 730.45 | 731.75 |
| page errors | 0 | |
<!-- GENERATED:END -->

Timing variance: the preview's per-frame cost did not change measurably. Three paired `--timing` runs on the same
preview code gave before/after medians 5.37/5.65, 5.72/5.29 and 3.69/4.19 ms (the machine was shared with three
other agents' Chrome probes); the table above is the latest run. The stone's soft shadow is 28 extra shadow-map taps per
stone pixel; the body's shading is unchanged.

## Review history

- r1 (Z-24) -> S PASS (Z-25) with a correction (the IoU range in the READY text; fixed in Z-27).
- r1/r2 -> V FAIL (Z-28): "shadow beside the feet much weaker than HEAD" on V's meter (page screenshot, linear median,
  ring r 0.16-0.32 m vs both off, 820x1180). Root causes, measured: (1) the stone's umbra kept 10 % of the key plus the
  full fill — now the key is removed entirely in the umbra (as celShade's bands do) and the fill is halved; reading the
  canvas directly, on/off is then 0.446 vs HEAD 0.449 (`~/.hermes/cache/scratch/wz/variants.ts`); (2) V's screenshot
  passes THROUGH lane F's scrim (`pointer-events:none`, so `elementFromPoint` still returns the canvas), which lay over
  the plinth: with the scrim hidden V's own meter read on/off 0.357-0.483; with the foot reserve (r3) and the scrim
  visible, V's unmodified script reads feet/rim 0.338-0.686 and on/off 0.238-0.515 over 5 random rolls (thresholds
  0.85 / 0.90; HEAD 0.29-0.46 / 0.25-0.43).

- r1/r2 -> F FAIL (Z-31, confirmed by S Z-33 at full resolution): pure-white horizontal streaks (min RGB >= 235, runs
  >= 12 px) on the plinth's front wall in every portrait (117 px, `y1106 x528-588`, ...) — the iron bands' full
  SPECULAR_METAL highlight clipped to white from the portrait's low camera. Fix: dull forged iron (`IRON_SPECULAR` 0.18);
  F's counter (`~/.hermes/cache/scratch/white.ts`) then reads 0 white px, 0 runs on all portraits.

## Honest gaps

- The body still takes the shared HARD 3x3 shadow (the arena's shader); only the stone gets the soft penumbra.
- With the key 80.8° up, a standing figure's cast shadow lies mostly under itself: the probe proves its direction on
  the side view (IoU), but at the default three-quarter view it reads as a pool round the feet, not a long silhouette.
- Face luminance rises with the fill but the face stays in the overhead key's shade band by design; the fill is
  unbanded, so faces look slightly softer than the cel-banded body.
- The portrait's total cost is dominated by building the rig (~0.5-0.8 s per new profile, same before/after); the draw
  + JPEG encode at 960x1280 is the `drawEncodeMsMean` row. Engine renders a portrait for EVERY hero row on each refresh
  (cached per build key) — an Engine change (lazy, selected hero only) would remove the first-open cost; not mine.
- The probe's profiles share PRESETS[0]'s height (the race only changes the build), so the composition row shows one
  height per race; SPEC Z44 pins 1.8 m and 2.2 m figures numerically.
