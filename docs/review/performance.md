# R13 — Performance review, from the triangle up

Lane: parent R13 review (read-only on code). Build measured: `dist/app.js` as served on
`http://127.0.0.1:8788/`: 1,259,118 B, mtime 19:31:07, sha1 `0b2a1364803f…`. This is the parent's
uncommitted rebuild on top of git `a976258`, and it was unchanged through every run. Date:
2026-10-28. Data: `docs/review/perf-data/raw/*.json`. Harness: `docs/review/perf-data/harness/`.

**Labels used below:** **MEASURED** = read from the live game by the harness (method given next to
it). **ESTIMATE** = derived from measured numbers with a stated formula or assumption. Nothing in this
file was measured on an actual phone, tablet or 4K panel: those are emulated viewports on the Mac.

---

## 0. Summary

- **Every screen size already fits a 120 Hz frame on this Mac.** MEASURED: rAF frame interval
  median 8.3–8.4 ms on all 12 runs (6 screens × 2 arenas). JS per frame 2.0–2.7 ms median at 1× CPU. GPU per frame
  0.96–3.54 ms (median, timer queries). The one exception is the **phone CPU emulation (4× throttle)**:
  JS 6.6–7.3 ms median and p95 up to 9.2 ms, with 62 of 539 frames over 12.5 ms on the 12 m arena.
  **The game is CPU-bound (JS + WebGL driver calls), not triangle-bound.**
- **Biggest single waste (MEASURED, profile):** `Engine.#applyEnvironment` creates a
  `new THREE.Fog(...)` **every frame** (`Engine.ts:475`). three.js r180 compares the fog by object
  identity (`three.module.js:17138`, `materialProperties.fog !== fog`), so it rebuilds the program
  parameters of every fog-enabled draw on every frame. `getProgram` costs 465–750 µs per frame at 1×
  CPU, which is 21–34 % of all JS. At 4× it costs 1.51–2.31 ms per frame. The fix is one line: create
  the fog once and mutate its colour and range.
- **Draw calls (MEASURED, WebGL level):** 183–259 per frame (main pass plus shadow pass). The ring
  wall alone accounts for **96 draws and 96 cloned materials** (`Engine.#buildArena`). The
  per-fighter rigid parts (head features and weapon pieces) add about 31 draws per fighter per pass.
- **Triangles (MEASURED):** 82k–106k per frame. **The two skinned bodies and their outline hulls make
  up about 75k of these**, because each body is drawn 4 times (surface + hull, main + shadow pass).
  `snapshot().polygons` reports 20,436, which counts each body only once. The 120 m arena adds a
  25k-triangle floor, drawn as a single mesh.
- **Pixels:** the measured GPU cost fits **0.85 ms + 0.307 ms per backing megapixel** on the M1 Pro
  (R² 0.96, n = 12). ESTIMATE for a base M1 (8-core GPU, half the M1 Pro's published 5.2 → 2.6
  TFLOPS): about 1.7 + 0.61·Mpx ms, so about 6.8 ms on 4K at DPR 2. That fits 60 Hz and is close to
  the edge of 120 Hz. Cap the backing pixels.

## 1. How a frame is computed (the model this review uses)

One frame runs through these stages, in order:

1. **CPU, JS:** the engine simulates, then three.js walks the scene. For every visible mesh it
   picks a shader program, uploads uniforms (matrices, bones) and issues one
   **draw call**.
2. **CPU → GPU:** WebGL → ANGLE → Metal turns the draw calls into command buffers. Each call costs
   driver time. This shows up as `(program)` and native `bindVertexArray` / `uniformMatrix4fv` in the
   profile.
3. **GPU, vertex stage:** each vertex is transformed once per draw. Skinned bodies blend 4 bone
   matrices per vertex. Inverted-hull outlines repeat the whole body. The shadow pass repeats every
   caster from the sun's point of view.
4. **Rasterisation:** each triangle becomes fragments, one per covered pixel. With MSAA 4× there are
   4 coverage samples, but the shader still runs about once per pixel.
5. **Fragment stage:** lighting, plus **16 shadow-map taps per fragment** on shadow receivers
   (three r180 `PCFSoftShadowMap`: 4 plain taps, 4 pairs mixed on x/y, and 2 × 2 corner taps).
   Blended (transparent) layers each pay this cost again.
6. **Apple GPUs are tile-based (TBDR) with hidden-surface removal (HSR).** Opaque fragments hidden
   behind other opaque fragments are never shaded, whatever the draw order. Blended layers
   (`transparent: true`) cannot be skipped. Immediate-mode GPUs (most Intel, AMD and NVIDIA laptops)
   only skip hidden fragments when the occluder was drawn first (early-z).

Cost model (CPU and GPU work in parallel, so the slower of the two sets the frame):

```
frame ≈ max( JS_sim + Σ_draws (t_draw_cpu) ,  GPU_fixed + Σ_vertices t_v + Σ_shaded_fragments t_f )
GPU (M1 Pro, measured fit) ≈ 0.850 ms + 0.307 ms × backing Mpx          (R² 0.960, 12 runs)
t_draw_cpu (measured, derived) ≈ 3.6 µs at 1× CPU, 15.6 µs at 4× CPU     (see §7)
```

How `t_draw_cpu` was derived: three's `render()` inclusive time minus `getProgram`, divided by the
GL draws per frame. Laptop 12 m: (1,663 − 750) µs / 257 draws. Phone 4× 12 m: (5,529 − 2,306) µs / 207
draws.

## 2. Method (how every number was measured)

- **Hardware actually used:** MacBook Pro, **Apple M1 Pro** (16-core GPU, 10-core CPU, 16 GB), 120 Hz
  ProMotion display (`system_profiler`). Browser: Chromium 156 driven by the Playwright MCP, with a
  real window. WebGL renderer string: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)`.
  `EXT_disjoint_timer_query_webgl2` is available.
  - The requested `browser_exec` session `perf` turned out to be **HeadlessChrome on SwiftShader**,
    which renders the GPU work in software on the CPU (renderer string `ANGLE (Google, Vulkan 1.3.0
    (SwiftShader Device …))`, 32 rAF/s on the title screen). It is useless for GPU timing, so it was
    used only for the scene-graph mesh inventory. Every timing comes from **isolated Playwright
    contexts** (`browser.newContext`, closed after each run), so the parent's tab was not touched.
  - **M1 vs M1 Pro:** both use the same Firestorm P-cores at 3.2 GHz, so the JS numbers apply to an
    M1 as they are (ESTIMATE, ±10 %). Apple publishes 2.6 TFLOPS for the 8-core M1 GPU and 5.2
    TFLOPS for the 16-core M1 Pro, so **the GPU numbers are ×2 for a base M1** (ESTIMATE; ×2.3 for
    the 7-core MacBook Air).
- **Screens** (Playwright `viewport` + `deviceScaleFactor`; `isMobile` for phone and tablet). The
  engine caps the pixel ratio at `min(dpr, 2)` (`Engine.ts:319`), so the backing size is
  CSS × min(DPR, 2):
  - phone 375×812 @3 → 750×1624 (1.22 Mpx)
  - tablet 768×1024 @2 → 1536×2048 (3.15 Mpx)
  - laptop 1440×900 @1 → 1.30 Mpx, and @2 → 2880×1800 (5.18 Mpx)
  - **4K = 1920×1080 CSS @2 → 3840×2160 (8.29 Mpx)**. This is how a 4K panel at DPR 2 reports
    itself. A literal 3840×2160 CSS at DPR 2 would be an 8K backing store (33 Mpx) and was not run.
  - Phone CPU: `Emulation.setCPUThrottlingRate {rate: 4}` during the measurement windows only. The
    **phone GPU is not emulated**: it is still the M1 Pro's.
- **Flow per run:** load, then a real mouse click (`page.mouse.click` at the button's box centre) on
  `/Fight/` and then on `/Enter the ring/`. Then for each size:
  `engine.debugWorld({nextArena:{size}})`, press `KeyR`, wait until `snapshot().ring.size === size`,
  call `debugView({hour: 12, freeze: false})` so the sun shadow pass is on (the restart re-rolls the
  hour, and at night the shadow pass is off), and settle for 2 s. `freeze: true` was NOT used: in this
  build it also stops the AI and physics (`Engine.ts:2038`). Camera: gameplay third person. The player
  is idle and the AI is live (it approaches and fights after the truce). Arena shape, wall and props
  are random per match and are listed with each row. **LIVE_ARENA_MAX = 120** (`src/ui/Menu.ts:15`).
- **Windows:** 5 s "light" (rAF interval + JS callback duration), then 3 s "full" (GL counters + GPU
  timer queries), then 5 s CPU profile (laptop and phone 4× only).
- **Instrumentation** (`harness/inject.js`, injected with `addInitScript`; no source edits):
  - wraps `requestAnimationFrame` to measure the engine callback's CPU time and the frame interval;
  - wraps `drawElements` / `drawArrays` (+ instanced), `bindFramebuffer` (to split the shadow and main
    passes), `useProgram`, uniform calls and buffer/texture uploads;
  - tags every draw with its scene category by wrapping `renderer.renderBufferDirect`, which both the
    main and the shadow pass go through;
  - wraps every frame in `TIME_ELAPSED_EXT` queries;
  - runs an **overdraw probe**: the same view re-rendered at 320 px wide with an additive counting
    material, either with depth test off ("raw") or with the scene's real opaque depth ("tested").
- **Statistics:** median and p95 use linear-interpolated quantiles over every frame of the window.
- **Caveats:**
  1. **GPU p95 is noisy** (5.8–11 ms) and does not follow the load. It reflects GPU clock ramping and
     ANGLE/Metal timer granularity, so **use the GPU medians**. For the same reason the shadow/main
     split of the GPU time is not reliable and is not reported.
  2. `renderer.info` **excludes the shadow pass** (three r180 runs `shadowMap.render` at
     `three.module.js:16446`, before `info.reset()` at `:16452`). The draw and triangle counts here
     come from the WebGL calls.
  3. The 120 Hz vsync quantises the frame interval: 8.3 ms means "fits 120 Hz", not "costs 8.3 ms".

## 3. Results per screen and arena (MEASURED)

| Screen (CSS @ DPR) | Arena | Backing px (Mpx) | rAF dt med / p95 ms | JS/frame med / p95 ms | frames >12.5 ms / 5 s | GPU med ms | GPU p95 ms | GL draws main + shadow | GL triangles main + shadow |
|---|---|---|---|---|---|---|---|---|---|
| phone 375x812 @3 (CPU 4x) | 12 m (oval) | 750x1624 (1.22) | 8.4 / 16.7 | 7.3 / 9.2 | 62 of 539 | 1.04 | 6.3 | 133 + 75 = 207 | 43,936 + 38,071 = 82,007 |
| phone 375x812 @3 (CPU 4x) | 120 m (circle) | 750x1624 (1.22) | 8.3 / 9.3 | 6.6 / 8 | 13 of 590 | 1.32 | 8.7 | 94 + 71 = 165 | 65,682 + 37,895 = 103,577 |
| phone 375x812 @3 (CPU 1x) | 12 m (diamond) | 750x1624 (1.22) | 8.3 / 9.1 | 2.1 / 2.5 | 0 of 605 | 0.96 | 10.5 | 164 + 73 = 237 | 48,707 + 37,867 = 86,574 |
| phone 375x812 @3 (CPU 1x) | 120 m (pentagon) | 750x1624 (1.22) | 8.3 / 9.2 | 2.7 / 3.2 | 0 of 605 | 1.22 | 9.9 | 181 + 71 = 251 | 66,798 + 37,815 = 104,613 |
| tablet 768x1024 @2 | 12 m (diamond) | 1536x2048 (3.15) | 8.3 / 9.2 | 2.1 / 2.6 | 0 of 600 | 2.06 | 8.8 | 171 + 71 = 241 | 45,704 + 37,740 = 83,444 |
| tablet 768x1024 @2 | 120 m (diamond) | 1536x2048 (3.15) | 8.3 / 9.3 | 2.2 / 2.6 | 0 of 599 | 1.88 | 10.2 | 105 + 78 = 183 | 67,647 + 37,900 = 105,547 |
| laptop 1440x900 @1 | 12 m (diamond) | 1440x900 (1.30) | 8.3 / 9.2 | 2.2 / 2.6 | 0 of 603 | 1.43 | 10.7 | 186 + 72 = 258 | 44,612 + 37,827 = 82,439 |
| laptop 1440x900 @1 | 120 m (octagon) | 1440x900 (1.30) | 8.3 / 9.2 | 2 / 2.4 | 0 of 605 | 1.28 | 11.0 | 116 + 78 = 193 | 67,824 + 38,104 = 105,928 |
| laptop 1440x900 @2 | 12 m (hexagon) | 2880x1800 (5.18) | 8.3 / 9.2 | 2.2 / 2.8 | 0 of 599 | 2.19 | 5.8 | 185 + 72 = 257 | 45,782 + 37,907 = 83,689 |
| laptop 1440x900 @2 | 120 m (hexagon) | 2880x1800 (5.18) | 8.3 / 9.1 | 2.3 / 2.8 | 0 of 603 | 2.52 | 8.7 | 117 + 68 = 185 | 67,971 + 37,727 = 105,698 |
| 4K 1920x1080 @2 (3840x2160 backing) | 12 m (oval) | 3840x2160 (8.29) | 8.3 / 9.2 | 2.3 / 2.9 | 0 of 603 | 3.54 | 7.5 | 188 + 72 = 259 | 44,742 + 37,855 = 82,597 |
| 4K 1920x1080 @2 (3840x2160 backing) | 120 m (octagon) | 3840x2160 (8.29) | 8.3 / 9.2 | 2.4 / 3 | 0 of 606 | 3.27 | 8.3 | 119 + 72 = 191 | 66,146 + 37,855 = 104,001 |

How each column was measured:

- **rAF dt / JS:** 5 s light window.
- **GPU:** sum of the frame's `TIME_ELAPSED_EXT` segments, 3 s full window.
- **Draws and triangles:** WebGL-level counts averaged per frame over the full window
  (triangles = `count/3` for `TRIANGLES`).
- **All 12 arenas were walled.** How many wall segments are on screen depends on the shape and the
  camera, which explains the spread of the draw counts.

ESTIMATE, GPU on a base M1 (8-core): ×2 the measured medians. That gives phone 1.9–2.6 ms, tablet
3.8–4.1, laptop @2 4.4–5.0 and 4K 6.5–7.1 ms. A real phone GPU is weaker than both: use the fit
above, scaled by the device's FLOPS ratio.

## 4. Triangles and draw calls by category (MEASURED, laptop 1440×900 @2)

### 12 m arena (hexagon, walled)

| Category | main calls | main tris | shadow calls | shadow tris | meshes (visible) | materials | castShadow | transparent |
|---|---|---|---|---|---|---|---|---|
| body (2 skinned surfaces + ~19 head parts each) | 40 | 20,236 | 40 | 20,236 | 40 (40) | 40 | 40 | 0 |
| body-outline (skinned inverted hulls) | 2 | 17,044 | 2 | 17,044 | 2 (2) | 2 | 2 | 0 |
| weapon | 12.6 | 211 | 12.6 | 211 | 16 (12) | 14 | 12 | 4 |
| weapon-outline | 12 | 200 | 12 | 200 | 12 (12) | 12 | 12 | 0 |
| terrain-ring | 1 | 2,400 | 0 | 0 | 1 (1) | 1 | 0 | 0 |
| terrain-outside | 1 | 1,536 | 0 | 0 | 1 (1) | 1 | 0 | 0 |
| props | 5 | 216 | 5 | 216 | 5 (5) | 5 | 5 | 0 |
| wall | **96** | 1,152 | 0 | 0 | 96 (96) | **96** | 0 | **96** |
| fx | 3.5 | 117 | 0 | 0 | 28 (7) | 28 | 0 | 28 |
| sky | 1 | 2,208 | 0 | 0 | 1 (1) | 1 | 0 | 0 |
| void-plane | 1 | 2 | 0 | 0 | 1 (1) | 1 | 0 | 0 |
| aura+contact | 10 | 460 | 0 | 0 | 6 (6) | 4 | 0 | 6 |
| **total** | **185** | **45,782** | **72** | **37,907** | | | | |

### 120 m arena (LIVE_ARENA_MAX, hexagon, walled)

| Category | main calls | main tris | shadow calls | shadow tris |
|---|---|---|---|---|
| body | 40 | 20,236 | 40 | 20,236 |
| body-outline | 2 | 17,044 | 2 | 17,044 |
| weapon + weapon-outline | 24.6 | 411 | 24.6 | 411 |
| **terrain-ring** | 1 | **25,056** | 0 | 0 |
| terrain-outside | 1 | 1,728 | 0 | 0 |
| props | 0 | 0 | 1 | 36 |
| wall | 28.7 | 345 | 0 | 0 |
| fx | 4.2 | 171 | 0 | 0 |
| sky / void / aura / pickups | 15.9 | 2,980 | 0 | 0 |
| **total** | **117** | **67,971** | **68** | **37,727** |

The phone 4× and other screens show the same body, outline and shadow figures (±1 %). See
`raw/*.json` → `runs[].full.perFrame`.

Findings:

- **Bodies dominate the triangle count.** One skinned body is 8,420–8,522 triangles. It is drawn as
  a surface, as an inverted hull (the same geometry), and both again in the shadow pass. Bodies plus
  outlines come to about 74.6k of 83.7k triangles per frame (89 %) on the 12 m arena.
  `snapshot().polygons` (20,436) undercounts this by about 3.7×.
- **The outline hull is in the shadow pass.** `Engine.#spawnMeshes` sets `castShadow` on every mesh
  of the rig (`Engine.ts:751`). The shadow depth material does not expand the hull, so the hull's
  shadow is the body's shadow drawn a second time: 2 draws and 17,044 triangles (45 % of the shadow
  triangles), plus 12 weapon-outline draws.
- **The wall is 96 meshes with 96 cloned `MeshLambertMaterial`s, all `transparent: true`**, even at
  opacity 1 (`Engine.ts:535, 544`). That is 52 % of the main-pass draws on a 12 m ring, and the
  segments render as blended layers (§6).
- **Small rigid parts are expensive in draws, not triangles.** Per fighter (inventory from the live
  scene graph): 19 head-feature meshes, namely 4 spheres (812 tris), 6 circles, 6 boxes, 1 sphere
  (552) and 2 cylinders (88). The weapon is 6 cel surfaces plus 6 hulls, plus 2 grip cylinders that
  are partly hidden. MEASURED: about 31 draws per fighter per pass (body tag 40 ÷ 2 fighters,
  minus the skinned surface, plus weapon 24.6 ÷ 2), for under 2k triangles.
- **The 120 m terrain is one 25k-triangle draw**, always drawn whole: frustum culling works per
  object, and the ring is one object. The E2 note is confirmed live. MEASURED main-pass draws: the
  12 m ring is 2,400–6,192 triangles (plus 0–1,536 for the outside ground). The 120 m ring is
  **25,056 on all 6 runs** (plus 0–1,728 outside), with cell 1.00–1.42 m and a 128–129² grid
  (`snapshot().terrain`).
- **Measured per-frame driver counters** (range over all 12 runs): 57–66 `useProgram` calls,
  420–819 uniform calls, 2 texture uploads (the two bone textures), and 1.2–4.8 buffer uploads (2.8–11 KB, the fx
  trails). three keeps 31–34 programs.

## 5. Shadow pass (MEASURED + ESTIMATE)

- **Map:** one directional sun, `mapSize` 1024², `PCFSoftShadowMap` (`Engine.ts:318, 425`). The
  moon light has a 512² map but does not cast at noon (`castShadow: false` read live).
- **Frustum:** ±18.7 / ±23.3 / ±30 m, depending on sun elevation (`Engine.ts:461`), read live. A 1024
  map over 37.4–60 m gives **3.7–5.9 cm per shadow texel**.
- **Casters per frame (MEASURED):** 68–78 draws and 37.7k–38.1k triangles, almost all of it the two
  bodies with their hulls, accessories and weapon pieces.
- **Receivers:** terrain ring, terrain outside and the 2,400 m void plane (`Engine.ts:682–690`).
  Each receiver fragment pays 16 taps.
- **Shadow pass JS (`SM.render`, inclusive):** 221–229 µs per frame at 1×, 995–1,099 µs at 4×.
- **ESTIMATE, screen vs shadow resolution.** The third-person camera sits about 6.5 m from the
  player: from `Engine.ts:2311–2320`, the 5.5 m orbit at 0.5 rad pitch plus the lift and shoulder
  offsets. With the 50° vertical FOV, the view is 2·6.5·tan 25° ≈ 6.1 m tall at the fighter. That is
  about 5.6 mm per CSS pixel at 1080 px, 3.7 mm per backing pixel on the phone (1624 px tall) and
  2.8 mm on 4K (2160 px). **A 3.7–5.9 cm shadow texel therefore spans about 7–21 backing pixels on
  every screen.** The shadow is under-resolved
  everywhere, so a larger map buys nothing until the frustum is tightened to the fighters.

## 6. Pixel cost: backing pixels × layers (MEASURED overdraw probe + ESTIMATE)

| Screen | Arena | raw layers/px (all · opaque · transparent) | depth-tested layers/px (all · opaque · transparent) | wall raw / tested | void-plane coverage | est. shaded fragments/frame TBDR · IMR (M) |
|---|---|---|---|---|---|---|
| phone 375x812 @3 (CPU 4x) | 12 m | 4.35 · 3.37 · 0.98 | 2.41 · 2.06 · 0.35 | 0.59 / 0.32 | 1.00 | 1.6 · 2.9 |
| phone 375x812 @3 (CPU 4x) | 120 m | 3.39 · 3.09 · 0.30 | 2.07 · 2.01 · 0.07 | 0.05 / 0.00 | 1.00 | 1.3 · 2.5 |
| phone 375x812 @3 (CPU 1x) | 12 m | 5.69 · 4.87 · 0.82 | 2.12 · 2.01 · 0.11 | 0.74 / 0.11 | 0.94 | 1.4 · 2.6 |
| phone 375x812 @3 (CPU 1x) | 120 m | 3.19 · 3.11 · 0.08 | 2.00 · 2.00 · 0.00 | 0.00 / 0.00 | 1.00 | 1.2 · 2.4 |
| tablet 768x1024 @2 | 12 m | 5.11 · 3.46 · 1.65 | 3.29 · 2.09 · 1.20 | 1.58 / 1.18 | 1.00 | 6.9 · 10.3 |
| tablet 768x1024 @2 | 120 m | 3.40 · 3.10 · 0.30 | 2.03 · 2.01 · 0.01 | 0.24 / 0.00 | 1.00 | 3.2 · 6.4 |
| laptop 1440x900 @1 | 12 m | 5.09 · 2.63 · 2.47 | 3.98 · 1.92 · 2.05 | 2.45 / 2.05 | 0.88 | 4.0 · 5.2 |
| laptop 1440x900 @1 | 120 m | 3.19 · 3.10 · 0.09 | 2.07 · 2.03 · 0.04 | 0.06 / 0.01 | 1.00 | 1.3 · 2.7 |
| laptop 1440x900 @2 | 12 m | 4.77 · 2.92 · 1.85 | 3.30 · 1.93 · 1.37 | 1.82 / 1.36 | 0.85 | 12.3 · 17.1 |
| laptop 1440x900 @2 | 120 m | 3.21 · 3.09 · 0.12 | 2.03 · 2.00 · 0.02 | 0.08 / 0.00 | 1.00 | 5.3 · 10.5 |
| 4K 1920x1080 @2 (3840x2160 backing) | 12 m | 5.76 · 2.84 · 2.91 | 4.62 · 2.02 · 2.60 | 2.89 / 2.60 | 0.99 | 29.9 · 38.3 |
| 4K 1920x1080 @2 (3840x2160 backing) | 120 m | 3.34 · 3.06 · 0.27 | 2.00 · 2.00 · 0.00 | 0.25 / 0.00 | 1.00 | 8.3 · 16.6 |

How the probe works (MEASURED):

- **Raw mode:** each mesh's material is swapped for an additive +1/255 counter with depth test off
  and the original face culling kept.
- **Tested mode:** the counted category keeps its real depth flags, and the other opaque meshes
  write depth only, with colour masked.
- Both render the live camera view at 320 px wide. "Layers" is the mean count per pixel.

How the last column is estimated: TBDR = backing px × (opaque coverage + tested transparent layers).
IMR = backing px × tested "all" layers. Custom vertex shaders (the outline expansion, fx billboards)
are replaced by the counter, so those categories are approximate.

Findings:

- **The walls are the fill hot spot on small rings.** On 12 m rings the camera often sits at or
  beyond the wall, and the occlusion fade makes the near segments translucent. The result is 1.2–2.6
  blended wall layers per pixel on tablet, laptop and 4K. Because the wall material is always
  `transparent`, Apple's HSR cannot skip any of them. Even so, the measured GPU difference between the
  12 m and 120 m runs on the same screen is only −0.33 to +0.27 ms. On the M1 Pro the wall fill
  stays within that noise (ESTIMATE: ≤ 0.6 ms on an M1).
- **Two opaque layers on every screen in IMR order.** The sky is drawn first (`renderOrder −1`,
  `depthWrite false`, `Sky.ts:110–115`) over 100 % of the screen. The 2,400 m void plane is then
  drawn under everything at 85–100 % coverage, as a shadow receiver with 16 taps per fragment. On
  M1 (TBDR) HSR removes the hidden part. On immediate-mode GPUs (Intel, AMD and NVIDIA laptops,
  older Android) both are shaded in full.
- **Body and outline pixels are cheap:** 1–8 % of the screen.
- **Phone:** with DPR capped at 2, the canvas is 1.22 Mpx. The minimap canvas does NOT follow the
  cap: `Minimap.ts:241–259` uses the raw `devicePixelRatio`, which is 3 on phones.

## 7. JS per-frame hot spots (MEASURED, CDP `Profiler`, 200 µs sampling, 5 s in a fight)

Bundle positions were resolved to the original sources through `dist/app.js.map`
(`harness/srcmap.py`, VLQ decoder).

### Phone emulation, 4× CPU, 12 m arena

530 frames, rAF dt median 8.4 ms, JS per frame median 7.5 ms, idle 0.75 %, `(program)` 24.5 %.

| # | self ms / 5 s | µs/frame | % wall | function | original source |
|---|---|---|---|---|---|
| 1 | 687.9 | 1298 | 12.84 | `x` | `three/0.180.0/build/three.module.js:4603` (getParameters) |
| 2 | 343.3 | 648 | 6.41 | `B0` | `three/0.180.0/build/three.module.js:10616` (getProgram) |
| 3 | 223.8 | 422 | 4.18 | `yg` | `src/game/FogOfWar.ts:44` (reveal) |
| 4 | 165.2 | 312 | 3.08 | `renderBufferDirect` | `three/0.180.0/build/three.module.js:10085` |
| 5 | 134.8 | 254 | 2.52 | `lv` | `three/0.180.0/build/three.module.js:3332` (setValueM4) |
| 6 | 113.3 | 214 | 2.12 | `g` | `three/0.180.0/build/three.module.js:4823` (getProgramCacheKey) |
| 7 | 106.9 | 202 | 2 | `bindVertexArray` | native / V8 |
| 8 | 90.2 | 170 | 1.68 | `multiplyMatrices` | `three/0.180.0/build/three.core.js:8633` |
| 9 | 86.6 | 163 | 1.62 | `H8` | `three/0.180.0/build/three.module.js:10711` (setProgram) |
| 10 | 67.5 | 127 | 1.26 | `uniformMatrix4fv` | native / V8 |
| 11 | 67.4 | 127 | 1.26 | `Hm` | `three/0.180.0/build/three.module.js:10430` (projectObject) |
| 12 | 67.3 | 127 | 1.26 | `l` | `three/0.180.0/build/three.module.js:1410` (bindVertexArrayObject) |
| 13 | 55.2 | 104 | 1.03 | `v` | `three/0.180.0/build/three.module.js:5809` (renderObject) |
| 14 | 54.6 | 103 | 1.02 | `I5` | `src/game/CameraOcclusion.ts:35` (blockDistance) |
| 15 | 54 | 102 | 1.01 | `updateMatrixWorld` | `three/0.180.0/build/three.core.js:10304` |

### Laptop 1440×900 @2, 1× CPU, 12 m arena

603 frames, JS per frame median 2.2 ms, idle 65.4 %, `(program)` 6.9 %.

| # | self ms / 5 s | µs/frame | % wall | function | original source |
|---|---|---|---|---|---|
| 1 | 258.8 | 429 | 5.09 | `x` | `three.module.js:4603` (getParameters) |
| 2 | 172.8 | 287 | 3.4 | `B0` | `three.module.js:10616` (getProgram) |
| 3 | 60 | 100 | 1.18 | `renderBufferDirect` | `three.module.js:10085` |
| 4 | 43.1 | 71 | 0.85 | `yg` | `src/game/FogOfWar.ts:44` (reveal) |
| 5 | 43.1 | 71 | 0.85 | `#a` | `src/game/Skeleton.ts:310` (#stepKick) |
| 6 | 35.1 | 58 | 0.69 | `lv` | `three.module.js:3332` (setValueM4) |
| 7 | 26.5 | 44 | 0.52 | `multiplyMatrices` | `three.core.js:8633` |
| 8 | 26.1 | 43 | 0.51 | `bindVertexArray` | native / V8 |
| 9 | 22.2 | 37 | 0.44 | `#ze` | `src/engine/Engine.ts:2006` (#loop) |
| 10 | 22 | 36 | 0.43 | `Hm` | `three.module.js:10430` (projectObject) |
| 11 | 21.7 | 36 | 0.43 | `H8` | `three.module.js:10711` (setProgram) |
| 12 | 20.7 | 34 | 0.41 | `i` | `three.module.js:8866` (refreshFogUniforms) |
| 13 | 20 | 33 | 0.39 | `uniformMatrix4fv` | native / V8 |
| 14 | 19.4 | 32 | 0.38 | `Iv` | `three.module.js:3581` (setValueM4Array) |
| 15 | 18.1 | 30 | 0.36 | `#dn` | `src/engine/Engine.ts:2401` (#updateOcclusion) |

On the **120 m** arena, `FogOfWar.reveal` becomes the top self-time function: 653 µs per frame at 1×
and 1,123 µs at 4×, because the fog grid grows with the arena (`createFog(min(60, half+2),
max(0.5, half/48))` gives 96² cells, and `reveal` visits up to every cell for **both** fighters every
frame, with a `Math.acos` closure per cell).

### Inclusive time per engine function (µs per frame)

| function (inclusive) | phone 4× 12 m | phone 4× 120 m | laptop 12 m | laptop 120 m |
|---|---|---|---|---|
| `Engine.#loop` (`Engine.ts:2006`) | 7,422 | 7,196 | 2,255 | 2,239 |
| three `WebGLRenderer.render` | 5,529 | 4,385 | 1,663 | 1,172 |
| ↳ three `getProgram` (fog churn, §0) | **2,306** | **1,510** | **750** | **465** |
| ↳ three shadow `SM.render` | 995 | 1,099 | 221 | 229 |
| `Engine.#tickWorld` (`:1293`) | 491 | 1,254 | 91 | 694 |
| ↳ `FogOfWar.reveal` (`FogOfWar.ts:44`) | 422 | **1,123** | 71 | **653** |
| `Engine.#updatePose` (`:1748`) | 187 | 235 | 74 | 47 |
| `Animator.update` (`anim/Animator.ts:363`) | 148 | 178 | 67 | 45 |
| `SkinnedHumanoid` rig `update` (`body/SkinnedHumanoid.ts:276`) | 139 | 165 | 102 | 43 |
| `Engine.#drawMinimap` (20 Hz, averaged per frame) | 152 | 147 | 30 | 33 |
| `Engine.#updateOcclusion` (`:2401`, 96 walls) | 124 | 137 | 30 | 35 |
| `Engine.#opponentAct` (`:1209`) | 116 | 95 | 24 | 39 |
| `Engine.#applyEnvironment` (`:441`, every frame) | 102 | 108 | 42 | 14 |
| `Engine.#poseGate` (`:1824`) | 63 | 61 | 27 | 18 |
| `FxDirector.update` (`fx/FxDirector.ts:280`) | 62 | 69 | 18 | 19 |
| `Engine.#updateHUD` (4 Hz DOM writes) | < 37 (not in top 60) | < 39 | < 12 | < 10 |

- **Minimap:** 30–33 µs per frame at 1× is about 0.18 ms per 20 Hz draw. At 4× it is about 0.9 ms
  per draw.
- **HUD:** `#updateHUD` never reaches the top 60 inclusive functions, so the 4 Hz DOM writes are
  negligible. Style and layout costs would show under native `(program)` and cannot be attributed to
  it.

## 8. Load and match start (MEASURED, `PerformanceObserver('longtask')`)

| Event | 1× CPU (6 screen runs) | 4× CPU (`raw/coldphone4x.json`) |
|---|---|---|
| Page load main-thread task (bundle eval + `new Engine()` incl. the menu's two idle bodies) | 669–756 ms | **2,909 ms** (+131) |
| Click "Enter the ring" (new fighters built) | 91–212 ms | 614 ms (+74) |
| Restart, 12 m arena | 88–108 ms | 331 ms |
| Restart, 120 m arena (25k-triangle floor + 128² field) | 173–211 ms | 644 ms |

**Bundle:** `dist/app.js` is 1,259,118 B, or 329,276 B gzipped (`gzip -c | wc -c`). `app.js` took
6–18 ms to transfer from localhost (`resource` timing). By source-map attribution, three.js is about 44 % of the bundle
(approximate).

The `race-genes.json` literal spans 91.8 KB of the bundle, measured by string offsets in `app.js`.
Two of its keys are **not referenced anywhere in `src/`** (checked with grep): `trig`, a 57.7 KB
table, and `subraceNotes`, 4.2 KB of prose. Together they are 4.9 % of the bundle, or about 62 KB.

The "~0.3 s × 2 cold body build" from INTEGRATION.md happens **inside the page-load task**, because
the constructor builds the menu's idle fighters (`Engine.ts:401–403` → `#spawnMeshes`).

## 9. Ranked optimisation plan, from the triangle up

The ranking is by gain on the weakest target measured (phone CPU at 4×), then by how many screens it
helps. "Gain" is an ESTIMATE unless it says *measured basis* (the cost the fix removes, read in §3–§8).

Two scales are used for driver cost: the per-draw CPU cost is 3.6 µs at 1× and 15.6 µs at 4×, and
the GPU cost on the M1 Pro is 0.307 ms per Mpx (×2 on M1).

| Rank | Layer | Change | Exact place | Measured basis | Est. gain (M1 1× / phone 4×) | Risk |
|---|---|---|---|---|---|---|
| 1 | Program/state | **Create the fog once** and mutate `fog.color.setRGB(...)`, `near` and `far` every frame. Never assign a new `THREE.Fog`. | `Engine.#applyEnvironment`, `src/engine/Engine.ts:475` (`this.#scene.fog = new THREE.Fog(...)`) | `getProgram` inclusive: 465–750 µs/frame at 1×, 1,510–2,306 µs at 4×. Cause: `three.module.js:17138` | **−0.5 to −0.75 ms / −1.5 to −2.3 ms per frame** (the whole `getProgram` cost) | Very low. Verify `getProgram` disappears from the profile. |
| 2 | Frame/JS | **Fog-of-war reveal at the minimap rate, for the shown fighter only.** The fog is read only by the minimap (20 Hz), the compass (4 Hz) and the snapshot. In `reveal`, compare squared distance against r², and replace the per-cell `Math.acos` lens closure with a precomputed cosine threshold on `dot/(d·fl)`. | `Engine.#tickWorld`, `Engine.ts:1326–1333`; `reveal`, `src/game/FogOfWar.ts:44` | `reveal` self: 653 µs/frame (1×) and 1,123 µs (4×) on 120 m; 71 / 422 µs on 12 m | 120 m: **−0.6 / −1.0 ms**; 12 m: −0.07 / −0.4 ms (2×120 reveals/s → 1×20/s is −92 % of calls) | Low. The AI does not read the fog (grep: only `#drawMinimap`, `#updateCompass` and `snapshot`). |
| 3 | Mesh/draw | **One wall mesh instead of 96.** Merge the segment boxes into one `BufferGeometry` (1,152 tris) with a per-vertex `alpha` attribute that `#updateOcclusion` writes per segment. Render it opaque (`transparent: false`) while no segment fades, and blend only while one does. Stop `wallMat.clone()` per segment. | `Engine.#buildArena`, `Engine.ts:531–551`; `Engine.#updateOcclusion`, `Engine.ts:2401–2421` | 96 draws and 96 materials (12 m); wall 1.2–2.6 blended layers/px (§6); `#updateOcclusion` 30–137 µs | Draws −95 (12 m): **−0.34 ms / −0.7 ms**. GPU: HSR can skip the hidden wall when not fading (≤ 0.3 ms M1 Pro, ≤ 0.6 ms M1) | Medium: per-vertex alpha needs `onBeforeCompile` or a small custom shader |
| 4 | Pass | **Take outline hulls (body and weapon) out of the shadow pass.** Set `castShadow` only where `child.name !== "cel-outline"`. Also skip the tiny head-feature meshes (eyes, brows) in the shadow pass. | `Engine.#spawnMeshes`, `Engine.ts:751` | Shadow pass: body-outline 2 draws / 17,044 tris; weapon-outline 12 draws / 200 tris; `SM.render` 221–229 µs (1×), 995–1,099 µs (4×) | Shadow tris −45 %, shadow draws −14 (−19 %): **−0.05 / −0.2 ms** CPU, plus skinned vertex work on phone GPUs | Very low. The silhouette is identical, because the depth material ignores the hull offset. |
| 5 | Mesh/draw | **Merge rigid parts per bone.** Head features become one Lambert draw (vertex colours) plus one cel draw per fighter. The weapon becomes 1 surface plus 1 hull, using `BufferGeometryUtils.mergeGeometries` at build time. | `buildSkinnedHumanoid`, `src/graphics/body/SkinnedHumanoid.ts` (head-feature attach; `FaceParts.ts`); the weapon parts mounted on `grip` (`SkinnedHumanoid.ts:186–192`) | About 31 draws per fighter per pass for under 2k tris (§4 inventory); merged: about 4, so −27 × 2 fighters × 2 passes | About −110 draws per frame: **−0.4 ms / −1.7 ms** | Medium: per-part colours move into vertex colours; outlines are kept on the merged weapon |
| 6 | Pixel | **Pixel budget instead of a fixed DPR cap.** Use `pixelRatio = min(dpr, 2, sqrt(P_max / (cssW·cssH)))` with P_max ≈ 4 Mpx on integrated GPUs, and adapt it from the GPU timer or frame p95 (dynamic resolution). Apply the same rule in the resize handler. Cap the minimap at 2. | `Engine.ts:319` (`setPixelRatio`), resize handler `Engine.ts:386–393`; `Minimap.ts:241–259` | GPU 0.307 ms/Mpx (fit); 4K = 8.29 Mpx, laptop @2 = 5.18 Mpx | 4K: 8.29 → 4.0 Mpx = **−1.3 ms (M1 Pro) / −2.6 ms (M1)** GPU; laptop @2: −0.36 / −0.7 ms | Low. The image is slightly softer on 4K at DPR 2 (still about 1.4 px per CSS px). |
| 7 | Pixel/IMR | **Draw the sky last among opaques**, at the far plane (`gl_Position.z = gl_Position.w`, depth test on). **Draw the void plane after the terrain** (`renderOrder = 1`), and let it receive shadows only when the shadow is longer than the ring. | `Sky.ts:110–115` (`renderOrder = -1`, `depthWrite: false`); `Engine.#buildRing`, `Engine.ts:682–690` | Depth-tested opaque layers ≈ 2.0/px on every screen: sky 1.0 + void/terrain about 1.0; void-plane coverage 0.85–1.00 | IMR GPUs: about −1 opaque layer per pixel, including 16 shadow taps. **M1: about 0** (HSR already does this) | Low |
| 8 | Triangle | **Terrain budget from the camera's visible area, not the arena area** (lane E2). Tile the ring into chunks (e.g. 16×16 m) so frustum culling works per chunk. Pick each chunk's cell size from its distance to the camera, keeping 0.5 m near the fighters and coarser beyond. | `deriveTerrainRules`, `src/world/TerrainRules.ts:353–354` (`cell = max(cellSize, 2·domainHalf/(maxGridAxis−1))`); `buildRingSurface`, `src/world/RingSurface.ts`; `buildTerrainMesh`, `src/graphics/TerrainMesh.ts:71` | Ring 25,056 tris in one draw (120 m) vs 2,400–6,192 (12 m); restart 173–211 ms (1×), 644 ms (4×) | Main tris −15k to −20k on 120 m (ESTIMATE: a third-person camera sees about ¼ of a 120 m ring). GPU on M1 < 0.1 ms; it matters on phones and for the restart time. | Medium: tile seams and paint continuity |
| 9 | Triangle | **Body LOD.** Build LOD1 (about 3k tris) at body build time from the same SDF (`Polygonize` at a coarser grid). Use LOD1 for the shadow pass and the outline hull always, and for the surface when the body is under about 150 px tall. | `src/graphics/body/SkinnedHumanoid.ts` (build), `src/graphics/body/Polygonize.ts` (resolution); LOD choice in `Engine.#loop` before `render` | 8,420–8,522 tris per body × 4 skinned passes = about 68k of 83.7k tris per frame | −40k to −50k skinned tris per frame (ESTIMATE). M1: small. Phone GPUs: the largest vertex-side gain. | Medium: hull and surface must still skin with the same bones. Build time grows. |
| 10 | Pass | **Fit the shadow frustum to the fighters**: the bounding box of both bodies plus the sun's shadow length, instead of ±18.7–30 m. With 1024² that gives about 1.6 cm texels instead of 3.7–5.9 cm. Then use 512² on phones for the current sharpness. | `Engine.#configureSun` / `#applyEnvironment`, `Engine.ts:422–431, 460–463` | Texel 3.7–5.9 cm vs 3–6 mm screen pixels (§5) | Sharper shadows at the same cost. Phone: the shadow map takes ¼ of the memory and fill (ESTIMATE). | Low. Long dusk shadows need the extent term kept. |
| 11 | Pixel | **MSAA only below DPR 1.5** (`antialias: devicePixelRatio < 1.5`). At DPR 2 the 4× MSAA mostly buys resolve and bandwidth. | `Engine.ts:316` | Not measured. Needs an A/B run with the harness. | ESTIMATE 5–15 % of the GPU main pass at 4K | Low. The context must be recreated, so read the setting at startup. |
| 12 | Frame/JS | Run the environment **at 4 Hz** (or whenever the hour changes), not every frame. Reuse the sky uniforms. | `Engine.#loop` → `#applyEnvironment`, `Engine.ts:2012` | 14–42 µs/frame (1×), 102–108 µs (4×) | −0.03 / −0.1 ms | Low |
| 13 | Session | **Cold start.** (a) Build the menu's idle fighters after first paint (`requestIdleCallback`) or show a static portrait. (b) Strip `trig`, `trigNotes` and `subraceNotes` from the imported genes (a build-time trimmed JSON). (c) Move pure builders (Heightfield and terrain, SDF `Polygonize`) to a Worker for restarts. | `Engine` constructor `Engine.ts:398–405`; `src/game/RaceGenes.ts:14` import; `#startFight` → `#buildArena` / `#spawnMeshes` | Load task 669–756 ms (1×), 2,909 ms (4×); restart up to 644 ms (4×); about 62 KB of unreferenced data | Load task about −0.3 to −0.6 s at 1× (ESTIMATE: the idle-body share); −62 KB raw | Low (a, b), medium (c) |
| 14 | Frame/JS | Minimap at 10 Hz on mobile, or skip a redraw when nothing moved more than half a map pixel. | `MINIMAP_HZ`, `Engine.ts:62`; `Engine.#loop`, `:2016` | 0.18 ms per draw (1×), about 0.9 ms (4×) | −0.07 ms / −0.07 ms averaged | Low |
| — | DOM | HUD writes: **no action**. | `Engine.#updateHUD`, `:1709` | < 12 µs per frame (1×) | — | — |

**Combined ESTIMATE for items 1–5** on the phone 4× 12 m case: JS per frame goes from a 7.3 ms
median to about 7.3 − 2.3 − 0.4 − 0.7 − 0.2 − 1.7 ≈ **2 to 3 ms**, which removes the measured 62 of
539 frames over 12.5 ms. On M1 1×: about 2.2 → 0.6–1.2 ms. The gains overlap, so the low end is optimistic. GPU-side items 6, 7, 9 and 10 matter for
4K on a base M1 and for real phone GPUs.

## 10. Budgets and how to keep them (regression gate)

**Evaluator:** the harness in `docs/review/perf-data/harness/`.

1. Run `python3 gen.py` to write `run_<screen>.js` from `runner.template.js`.
2. Run each file through the Playwright MCP `browser_run_code_unsafe` with `filename=`. It saves
   `<key>.json` through a browser download.
3. Run `analyze.py` to print the tables in this file. `srcmap.py` resolves profile positions.

Proposed budgets (baseline × (1 + 10 % tolerance)). The targets are what items 1–5 should reach (ESTIMATE):

| Metric (harness field) | Baseline (this run) | Budget after fixes |
|---|---|---|
| phone 4× 12 m JS/frame median (`runs[0].light.js.med`) | 7.3 ms | ≤ 4.0 ms |
| phone 4× 12 m frames > 12.5 ms per 5 s (`light.long.dtOver12_5`) | 62 | ≤ 5 |
| GL draws main + shadow, 12 m walled | 257–259 | ≤ 120 |
| GL triangles main + shadow, 120 m | 104k–106k | ≤ 70k |
| GPU median, 4K, M1 Pro (`full.gpu.total.med`) | 3.27–3.54 ms | ≤ 2.5 ms |
| `getProgram` in the profile top 40 | present (#1–#2) | absent |
| Page-load long task, 4× | 2,909 ms | ≤ 2,000 ms |

No CI gate exists yet. The harness needs a GPU browser, and Deno tests cannot measure frames. A cheap
static gate that can run in `deno task test`: assert that `#buildArena` produces at most N wall meshes,
and that a rig's outline meshes have `castShadow === false`. Both are counts, not timings.

## 11. What was not measured, and known limits

- Real phones, tablets, Android or iOS Safari GPUs. **Only the CPU was throttled.** Base-M1 GPU
  numbers are ×2 ESTIMATES from published TFLOPS.
- MSAA on vs off, and the shadow-map size A/B: the code would need a switch or the renderer would
  have to be rebuilt, so this was not done.
- GPU p95 and the shadow-vs-main split are not trustworthy on ANGLE/Metal timer queries (§2, caveat 1).
- The fill numbers come from a 320 px-wide re-render. Custom vertex shaders (the outline expansion,
  fx billboards) are replaced by the counting material, so those categories are approximate.
- The player was idle during the windows. Skills and dashes add fx draws: measured 2.5–4.4 calls and
  75–391 triangles per frame, which is small.
- The instrumentation itself (GL wrappers, the rAF wrapper) adds a little CPU time. Light windows,
  which time only the rAF callback, and full windows differ by 0.0–0.5 ms in JS median (the full
  window is always ≥ the light one). The JS figures in §3 come from the light windows.

## 12. Files

- `docs/review/performance.md`: this report.
- `docs/review/perf-data/raw/{phone4x,phone1x,tablet,laptop1x,laptop,uhd,smoke,coldphone4x}.json`:
  every measurement quoted above. `smoke` is the 1440×900 @1 harness check run.
- `docs/review/perf-data/harness/`:
  - `inject.js`: the instrumentation;
  - `runner.template.js` + `gen.py`: one Playwright run per screen;
  - `run_coldphone.js`: load and restart long tasks at 4×;
  - `analyze.py`: the tables;
  - `srcmap.py`: the source-map resolver.
