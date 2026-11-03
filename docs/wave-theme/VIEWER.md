# Wave THEME — lane V: viewer controls + axis gizmo (BRIEF items 2-3, contract C-VIEW)

## How to use it (Mac trackpad, mouse, touch)

Fighters → **+ New** → the 3D plate.

| gesture | effect |
|---|---|
| hover the character | cursor becomes a **grab** hand (`grabbing` while dragging) |
| click-drag (mouse, or trackpad click-and-drag / three-finger drag) | turn the figure: horizontal = yaw (free), vertical = pitch (clamped −0.45…1.15 rad, never below the floor). 0.6 rad per 100 px |
| mouse wheel / trackpad **two-finger scroll** over the character | zoom toward the cursor; the page does not scroll |
| trackpad **pinch** over the character (arrives as `wheel` + `ctrlKey`) | zoom toward the cursor, larger gain |
| wheel / scroll anywhere else (canvas off the model, the page) | the page scrolls as normal |
| **double-click** | back to the home framing (wave X pedestal law) |
| touch: one finger | turn; **two-finger pinch**: zoom about the fingers' midpoint |
| **gizmo** (top-right): click an end | look along that axis: `X` = view from +X, hollow ring = the negative end (named on hover) |

There is no automatic turntable (wave P made the preview manual), so nothing has to pause while you interact.

## Files

- `src/graphics/ViewerControls.ts` — pure camera math (no THREE/DOM): `orbit`, `zoomAt`, `clampState`, `snapTo`, `reset`,
  `wheelFactor`, `pinchFactor`, `projectNdc`, `gizmoAxes`. State = `{ yaw, pitch, distance, target }`;
  position = target + distance·(sin yaw·cos pitch, sin pitch, cos yaw·cos pitch).
- `src/graphics/AxisGizmo.ts` — the overlay: pure `gizmoLayout` / `pickAxis` / `gizmoPlacement` / `gizmoSize` + the DOM class.
- `src/graphics/PreviewScene.ts` — wiring (pointer/wheel/dblclick/touch, hover raycast, gizmo), QA hooks.
- `tests/wave_theme_viewer_test.ts` — SPEC TH20-TH39 (+ TH39b source pin), 21 tests.
- `tools/probe-wave-theme-viewer.ts` — real Chrome at 320, 390, 844x390 (touch) and 1280, 1920 (mouse).

## Design decisions

- **Zoom toward the cursor is a homothety** centred on the model point under the cursor (raycast hit; with no hit, the
  cursor ray's point at the target's depth): camera and target move toward it by the same ratio, orientation unchanged,
  so that point projects to the same pixel *exactly*. The factor is clamped first (distance 0.6 m … 1.6 × home), so a
  clamped step is still exact. The look-at target is boxed over the plinth (|x|,|z| ≤ 0.9 m, 0 ≤ y ≤ frame top); only when
  that box binds can the point drift (tested bounded, TH28).
- **Gains**: wheel `exp(deltaY·0.0015)` (a 100 px notch = ×1.16), pinch (ctrl) `exp(deltaY·0.01)`; line/page delta modes
  ×16/×400 px; one event never exceeds ×1.5. Touch pinch = spread ratio.
- **Over the model** = a raycast against the shown body (rig, or the generator stage view), visible meshes only, after a
  padded bounding-box pretest. Hover raycasts run ≤ every 50 ms from the render loop; wheel raycasts are synchronous (the
  `preventDefault` decision must be). Measured cost 6.2-6.6 ms typical, max 12 ms (skinned mesh, CPU).
- **Wheel latch (250 ms)**: a gesture keeps its first role — a page scroll that slides the model under a still cursor keeps
  scrolling; a zoom that moves the silhouette off the cursor keeps zooming. Ctrl+wheel (pinch) is re-classified each event.
- **Pinch per frame**: a touch move fires one `pointermove` per finger; zooming at the half-updated midpoint drifted the
  pinch point 3.4 px (first probe run), so pinch factors accumulate and apply once per frame → 0 px.
- **Soft pitch clamp**: after a ±Y snap (pitch ±(π/2 − 0.001)) a drag only moves back toward the band — no jump.
- **Engine drag listener**: the engine's wave-P pointer listeners on the same canvas are registered after ours; the viewer's
  `pointerdown`/`pointermove` call `stopImmediatePropagation`, so a drag turns the figure once. (The engine block is now
  redundant; parent may delete it — not my lane.) The gamepad stick still calls `orbit()`.
- **Gizmo = 2D overlay canvas** (no extra WebGL context). Size clamp(64, 20 % of the viewer width, 96) px, 8 px inset from
  the viewer's top-right. Placement (`gizmoPlacement`, pure, TH39): (1) page chrome that floats over the viewer when it
  scrolls (`.screen-nav, .viewer-gizmo-cover` — the sticky nav) pushes it down below that chrome; (2) it keeps
  **≥ 6 px** from `.equip-col, .equip-slot, .hero-plate-corner, .th-plaque, .hero-tag, .viewer-gizmo-avoid` by shrinking to
  ≥ 52 px, else (3) it keeps its size and slides left of them. Measured (r2): 1280 → 87 px, 8 px from the right edge, 28.6 px
  from the Weapon socket; 1920 → 96 px, 49.5 px gap; 320/390/844x390 → 64 px just left of the socket column (55-57 px from the
  viewer's right edge, 6.2-6.9 px from the socket). Picking is nearest-centre (a half-hidden negative ring stays clickable —
  front-most picking made −X/−Z unreachable at 390).
- **Hero card portraits stay static** (PortraitStudio images, unchanged): a live viewer per card costs a WebGL context and a
  full rig each, and browsers cap ~16 contexts; the + New plate is the one live viewer. `PortraitStudio.ts` not modified.
- CSP: no markup strings; the gizmo is `createElement` + CSSOM (`Object.assign(el.style, …)`).

## DOM / classes (for lane T)

- `canvas.viewer-gizmo[data-gizmo="1"][role=img]`, sibling right after `#creator-preview` in `.equip-view`;
  `.viewer-gizmo-hot` while an end is hovered. Inline: position/left/top/width/height/z-index 3 (written by the viewer).
- `#creator-preview.viewer-grab` / `.viewer-grabbing`, `data-viewer-cursor="grab|grabbing|"`, inline `cursor`,
  `touch-action: none`.
- Add `.viewer-gizmo-avoid` to any plate element the gizmo must keep ≥ 6 px clear of, `.viewer-gizmo-cover` to page chrome
  that floats over the viewer (the gizmo moves below it).

## QA hooks (`globalThis.__MYTHERRANIA_PREVIEW__`, QA only)

- `debugView()` → `{ yaw, pitch, distance, target[3], position[3] (camera world), fov (deg, vertical), aspect, dir (unit view
  direction), home, userMoved, over, dragging, pointers, cursor, limits, stats{drags, wheelZooms, wheelPassed, pinchSteps,
  resets, snaps, lastPickMs, maxPickMs} }`.
- `debugGizmo()` → `{ rect{left,top,width,height,x,y,w,h}, ends[], endsById{"+X":{x,y,colour,depth},…}, labels, hot,
  className }` — **all in client (viewport) css px**.
- `debugPick(clientX, clientY)` → model hit `[x,y,z]` or null; `debugProject([x,y,z])` → client px.
- `orbit(dx,dy)`, `zoomAtClient(factor, clientX, clientY)`, `snapView("+X"|…)`, `resetView()`.

## Measurements (`deno run -A tools/probe-wave-theme-viewer.ts`, artifacts/qa-wave-theme/viewer/report.json)

Round 1 numbers (r2 changed only the gizmo placement; gizmo sizes in the r2 bullet above):

| vp | input | drag 120,40 px → dYaw/dPitch | wheel ×6 (−120): dist, max drift | ctrl+wheel ×8 (−8): dist, drift | touch pinch 40→140 px: ratio, drift | gizmo px (r1) | snaps |
|---|---|---|---|---|---|---|---|
| 320 | touch | 1-finger 100 px → 0.600 | 5.81→1.97 m, 0.18 px | →3.06 m, 0.08 px | 0.286, 0 px | 56 | 6/6 dot 1.000 |
| 390 | touch | 0.600 | 5.91→2.01, 0.18 px | →3.12, 0.08 px | 0.286, 0 px | 56 | 6/6 |
| 844x390 | touch | 0.600 | 5.48→1.86, 0.19 px | →2.89, 0.08 px | 0.286, 0 px | 52 | 6/6 |
| 1280 | mouse | 0.720 / −0.240 | 5.58→1.89, 0.08 px | →2.94, 0.03 px | — | 87 | 6/6 |
| 1920 | mouse | 0.720 / −0.237 (floor) | 5.65→1.92, 0.07 px | →2.98, 0.03 px | — | 96 | 6/6 |

Every viewport: page scroll unchanged while zooming/pinching over the model; wheel on the canvas off the model and beside the
viewer scrolls the menu (`.menu-screen` scrollTop +120) and does not zoom; zoom-out stops at distMax; double-click restores
home exactly; hover cursor `grab` on / `default` off, `grabbing` mid-drag; every gizmo end is the top element at its point
(also with the viewer scrolled under the sticky nav: gizmo top 71/71/88/104 px vs nav bottom 63/64/81/96 at 320/390/1280/1920;
the nav is not sticky at 844x390), nothing overlapping, ≥ 6 px from every socket; 0 page errors, 0 CSP violations. (Drift > 0 in the browser is the idle breathing between
the probe's pick and the event; the math itself is exact, TH24.)

Screenshots: `plate-<vp>.png`, `home-<vp>.png`, `zoom-out-<vp>.png`, `snap-X|Y-<vp>.png`, `gizmo-home|snapX|snapY-<vp>.png`,
`touch-pinch-<vp>.png`.

## Not proven / open

- Real macOS trackpad hardware is simulated: pinch = CDP `mouseWheel` with modifiers=ctrl, scroll = `mouseWheel`; Safari
  `gesturestart` events are not handled (Safari also sends ctrl+wheel for pinch since 2021).
- The −Y snap looks up from under the floor; the floor/pedestal undersides may hide the model (it is a direction view).
- Hover raycast ~6 ms on a skinned body (CPU); throttled to 20 Hz.
- (Q Z-21, non-blocking) At 844x390 with the viewer scrolled to centre, the top ~5 px of the gizmo sit above the visible top of
  the `.menu-screen` scroll box (the +Y disc is clipped ~3 px; all ends stay clickable). Fix idea: add the nearest overflow
  ancestor's visible top as a `cover` in `AxisGizmo.update` (gizmo top ≥ clip top + 2 px). Not done after PASS to keep the
  verified build.

## Swarm record

Board artifacts/wave-theme/BOARD.md: V CLAIM Z-3, classes Z-6, READY r1 Z-9 (Q FAIL Z-12: sticky nav over the gizmo at
844x390; T FAIL Z-13: gizmo touching the Weapon socket), FIX Z-15 + READY r2 Z-16 → T PASS Z-19, Q PASS Z-20. V reviewed T:
PASS Z-11 (r1), PASS Z-18 (r2).
