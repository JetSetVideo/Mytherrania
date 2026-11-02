# Wave W — lane H (hands): fingers on the handle, a warm portrait background, clean elbow creases

User (decoded): *the fighters don't hold their weapons right* (cause left by wave V: the hands are mittens, a
grip reads as a fist block); *the hero card's figure sits on a blue background* (clashes with the walnut/gold
UI); *a vision pass flagged deep creases / pinching / holes at an elbow* in the wave-V close-ups.

Every number below is tool output (tables generated from the JSON by code). Nothing committed.

## 1. Hands with fingers

### Why a separate hand mesh
The body skin is ONE Surface-Nets mesh on a 2.2–3.5 cm grid (lane A), so a hand on it can only be a mitten
(a 2 cm finger is under one cell). Adding finger volume to the anatomy would also add mass / move the
hitbox and ragdoll fit (CHANNEL MSG-12/14/20 physics rules). So the fingers are **render-only**:

* `src/graphics/body/Hands.ts` (pure, no THREE): a lofted PALM (4 rings × 8 sides + cap) and five lofted
  DIGITS (four fingers of 3 phalanges, a thumb of metacarpal + 2 phalanges; 4 rings × 6 sides + tip;
  nail plates tagged on the tips) — **158 vertices, 266 triangles per hand**, fixed topology, posed on the
  CPU (mitred rings at each joint, so a knuckle bends without the linear-blend pinch).
  * `relaxedPose` — the free hand: a light cascade curl, thumb beside the index.
  * `gripPose(size, handle)` — the weapon hand closes on the handle line given in the hand frame:
    a wrist deviation toward perpendicular to the handle (ulnar ≤ 0.65 rad, radial ≤ 0.35 rad), a wrist
    extension that puts the distal palm crease on the handle (`palmar + r` below the palm), extended
    further until the whole palm clears it by ≤ `PALM_PRESS` 4 mm (bound 0.8 rad), the palm lengthened
    so the knuckles sit just past the handle, then every phalanx flexes **until its capsule touches the
    handle** (greedy "flex until contact", bisected to 1e-3 rad), the thumb wraps the other way over the
    index/middle fingers. `contactReport` measures what is left (never assumed).
* `src/graphics/body/HandRig.ts` (THREE glue): cuts the mitten out of the **render index only** (triangles
  of the forearm bone past the wrist plane), caps each rim with a fan from its own vertices (closed render
  mesh, no vertex added), mounts each hand on its forearm bone at the anatomy's hand frame
  (`RigAdapter.handFrameBind`'s d, n, w), reads the weapon's handle line from the grip-mount → grip →
  weapon chain (all children of the same forearm bone, so the forearm twist cancels) and its radius from
  the weapon mesh (edges crossing the grip plane: hafts 15.5–18.2 mm with the wrap, hilts 14.1–16.3 mm),
  re-poses on every `setGrip` (cached on the grip's Euler; 0.18 ms per solve+write measured in Deno).
  The OFF hand closes on the handle too when its grip anchor comes within 0.9 palm half-width + r of the
  handle line — **with lane T's in-progress off-hand the human's spear is now held by both fists**
  (off hand 23–30 mm from the shaft in the browser); the dwarf's off hand is 129 mm off, so it stays open.
* Paint: the same recipe as the body (`paintSkin`, no form shade) on the hand's own vertices, so nails get
  their own painted plate (MSG-13's open item: the generated hand had no nail vertices).
* Ink: the hand's outline is 0.35 × finger radius (3–8 mm); the body's 3.5 cm hull would drown 1 cm fingers
  in black (seen in the first browser pass). The body hull gets its own positions near the cut
  (`wristHullGeometry`): it sinks by the ink width over the last 1.6 wrist radii so the thick forearm ink
  tapers out at the wrist instead of ending in a lip.
* Width: the rendered palm is capped at max(1.2 wrist, 1.15 × the weapons' `HAND_HALF_WIDTH`) — the wave-V
  ork mitten was wider than the grips and clipped the longsword's cross-guard.
* Physics: untouched by construction — the anatomy plan, the body mesh DATA (`rig.meshStats`, 0 boundary
  edges), hitboxes and ragdoll read the mitten as before; only the render index changes (test pins it).

### Contact, measured at lane G's guard grip (handle 47° to the fingers) — `tests/wave_w_hand_fingers_test.ts` printout

Real skinned rigs (seed 7), `rig.setGrip(2.4537, −0.3138)`; gap = capsule surface to handle surface, mm,
index/middle/ring/little/thumb (0 = touching, negative = pressing in):

| rig | gaps i/m/r/l/thumb (mm) | middle-finger wrap | palm vs handle | wrist tilt / deviation (rad) |
|---|---|---|---|---|
| human/axe | 0/0/0/0/3.64 | 167.4° | −3.24 mm | 0.531 / −0.65 |
| human/dagger (reverse) | 0/0/0/0/6.07 | 175.2° | −3.05 mm | 0.507 / −0.65 |
| human/longsword | 0/0/0/0/0.88 | 163° | −3.36 mm | 0.546 / −0.65 |
| human/spear | 0/0/0/0/−0.34 | 153.6° | −3.63 mm | 0.579 / −0.65 |
| elf/axe | 0/0/0/0/10.02 | 203.5° | −3 mm | 0.41 / −0.65 |
| elf/dagger | 0/0/0/0/12.38 | 215.5° | −3.96 mm | 0.367 / −0.65 |
| elf/longsword | 0/0/0/0/8.85 | 197.6° | −3.08 mm | 0.424 / −0.65 |
| elf/spear | 0/0/0/0/4.2 | 181.8° | −3.18 mm | 0.477 / −0.65 |
| dwarf/axe | 0/0/0/0/−11.73 | 120.2° | −9.76 mm | 0.8 / −0.634 |
| dwarf/dagger | 0/0/0/0/−10.33 | 123.2° | −8.36 mm | 0.8 / −0.634 |
| dwarf/longsword | 0/0/0/0/−12.56 | 118.5° | −10.59 mm | 0.8 / −0.634 |
| dwarf/spear | 0/0/0/0/−14.5 | 114.6° | −12.53 mm | 0.8 / −0.634 |
| ork/axe | −0.16/0/0/0/−1.86 | 136.9° | −3.39 mm | 0.762 / −0.594 |
| ork/dagger | 0/0/0/0/0 | 141.1° | −3.34 mm | 0.742 / −0.594 |
| ork/longsword | −0.29/0/0/0/−3.29 | 134.4° | −3.42 mm | 0.774 / −0.594 |
| ork/spear | −0.54/0/0/0/−6.54 | 132° | −3.64 mm | 0.8 / −0.594 |

**Before (wave-V mitten): no fingers — the handle runs through a block** (`hands/*.png` row 1). Mesh gaps
(nearest hand vertex to the handle, the hexagonal tube's flats sit inside the capsule): 1.1–3.7 mm on the
fingers at 47° (`artifacts/wave-w/lane-H/hands/report.json`, `tools/probe-hands.ts`, also 30°/70°/90° per
race × sex × weapon). At 70° and 90° every finger touches (0 mm on all 32 rigs), the palm clears to within
1.3–4.0 mm, the middle finger wraps 108–207° (dwarf lowest).

**Strike frames (handle 30° to the fingers)**: lane G's wrist snap turns the handle about the GRIP point,
so the handle line passes 4 cm from the wrist; no hand can hold it there. With the deviation at its bound
the fingers still touch (0 to −5.4 mm), but the handle runs into the palm (human −13…−18 mm, elf −6…−11,
dwarf/ork −28…−33 mm) and the thumb 10–21 mm into the handle for those few frames (report.json rows
`deg: 30`). Request for the grip lane below.

### Visual (real Chrome, `tools/probe-hands-browser.ts`, same cameras before/after)
* Side by side per race: `artifacts/wave-w/lane-H/compare-{human,elf,dwarf,ork}.png` (left BEFORE = HEAD
  build, right AFTER; rows axe / dagger (reverse) / longsword / spear; columns side / front (palm) / back).
  Singles: `browser-{before,after}/<race>-<weapon>-{side,front,back}.png`.
* Offline close-ups (software rasteriser shared with probe-body): `hands/<race>-<sex>-<weapon>.png`, rows =
  mitten at 47°, fingers at 47°, fingers at 90°; columns = along the handle / palm side / back of the hand.
* Vision (this lane's own checks, the vision tool on the sheets): human BEFORE 3/10 → AFTER 6/10 ("AFTER
  clearly adds individual fingers wrapped around the handles in all rows/views"); dwarf before 3–4/10 →
  after 7–8/10 on axe/dagger/longsword; elf after 6–7/10; ork after 6–7/10 on axe/dagger. Front crop:
  "four fingers visible curled across the handle … reads as a fist around the handle", 7/10. Remaining
  remarks: blocky fingers (6-sided tubes), thumb often hidden from the side, a 2–4 px ink line at the wrist
  where the forearm meets the hand (before: 1–2 px crease), the dwarf's open OFF hand near the spear shaft
  (lane T's placement, 129 mm off: not in reach, stays relaxed), ork/elf back views partly occluded by the
  body at that camera.

## 2. Portrait / preview background

`src/graphics/PortraitBackdrop.ts` (pure): a dark warm vignette from the UI's own tokens — leather centre
`#4a2f1b`, `--u-walnut` #2a1c12 toward the frame, `--u-walnut-deep` #170f09 in the corners, a 14 % `--u-gold`
glow low behind the shoulders. `PortraitStudio` clears to the deep walnut and draws it as the scene
background (a 64² sRGB DataTexture, rows uploaded bottom-up). `PreviewScene` (the creator's transparent
turntable over its panel) keeps its transparency; its foot disc is the walnut instead of `#172128`.

Measured (`tools/probe-portrait.ts`, real Chrome, real clicks: start → + New → dice → Save → hero card;
the card's `<img>` PNG read back through a canvas):

| image | where | BEFORE RGB | AFTER RGB |
|---|---|---|---|
| hero portrait | 4 corners | [23, 33, 40] (blue leads red by 17) | **[23, 15, 9]** |
| hero portrait | top / left edge centre | [23, 33, 40] | [40, 26, 17] |
| creator preview (element screenshot) | top corners | [15, 10, 6] | [15, 10, 6] |
| creator preview | bottom corners | [161, 127, 65] / [231, 202, 124] | [13, 8, 5] / [13, 8, 5] |

Images: `artifacts/wave-w/lane-H/portrait-{before,after}/{hero-card,hero-portrait,creator-preview,page}.png`.
Vision: before "navy portrait background clashes with the warm dark-brown/gold UI"; after "the portrait
background fits the warm/dark-brown UI, not blue; the figure remains readable against it".

## 3. Elbow / knee creases

**Measured first** (`tools/probe-creases.ts`): 4 races × 2 sexes × seeds 1/7/42 = 24 bodies, both sides; the
CPU-skinned POSED render skin at elbow 0 / 0.8 / 1.45 (guard) / 2.0 rad and knee 0 / 0.5 / 1.2 rad; in a
0.9-head window: triangles whose posed normal opposes the bind normal carried by their own skinning
transform (folds), intersecting non-adjacent triangle pairs (self-x), and the smallest distance of the
joint band's flexor-side skin from the bone axis / joint radius (`inner`; a collapsing crease reads low).
The bind skin itself is clean: **0 boundary edges, 0 non-manifold edges, 1 component on every body, before
and after** — no hole. The pinch is a POSE defect: linear blending averages R(0) and R(θ) across a narrow
band (the chord, not the arc); wave V's narrowed cores + cubital fossa deepened it (pre-wave-V forms, same
probe `--ref`, seed 7: inner 0.36–0.63 at the guard; wave V: 0.33–0.39).

**Fix (render-only, `src/graphics/body/JointHelpers.ts`)**: one helper bone per elbow/knee, a child of the
upper bone sitting on the joint, turned every frame by HALF the joint's hinge angle (read from the bone's
quaternion, so a forearm twist or an ArmGuard rewrite is followed); over a band of ±1.8 joint radii the
upper/lower weights become the quadratic Bernstein blend (1−s)², 2s(1−s), s² of the rotations 0, θ/2, θ —
the skin bends along a smooth arc. The game skeleton, the anatomy, hitboxes and ragdoll never see it.

| joint | bend (rad) | inner flesh / joint radius, min–max BEFORE → AFTER | folded triangles sum (worst joint) BEFORE → AFTER | self-intersecting pairs sum BEFORE → AFTER |
|---|---|---|---|---|
| elbow | 0 | 0.813–1.047 → **0.813–1.047** | 0 (0) → **0 (0)** | 0 → 0 |
| elbow | -0.8 | 0.587–0.723 → **0.665–0.893** | 220 (13) → **0 (0)** | 2 → 0 |
| elbow | -1.45 | 0.29–0.389 → **0.482–0.683** | 536 (31) → **0 (0)** | 0 → 0 |
| elbow | -2.0 | 0.083–0.221 → **0.317–0.496** | 887 (43) → **168 (20)** | 1767 → 2216 |
| knee | 0 | 0.847–1.022 → **0.847–1.022** | 0 (0) → **0 (0)** | 0 → 0 |
| knee | -0.5 | 0.713–0.926 → **0.768–0.952** | 0 (0) → **0 (0)** | 0 → 0 |
| knee | -1.2 | 0.411–0.59 → **0.587–0.743** | 200 (16) → **10 (3)** | 0 → 0 |

Band width chosen by measurement (seed 7, right elbow at the guard, ink-hull render): ±0.6 R → more folds
(ork 141); ±0.9 R → ork 118 folds, 62 self-x; ±1.4 R → ork 23 / 68; **±1.8 R → 0 folds, 0 self-x on all four**;
±2.4 R → 0 folds but the inner flesh drops again. A/B ink-hull renders (plain weights vs helpers, side view
and the view INTO the crease, 83° and 115°): `artifacts/wave-w/lane-H/creases-ab.png`, numbers in
`creases-ab.json`; vision: plain = "dark wedge/pinch, jagged intersecting ink lines and a small hole", helpers
= "a smooth dark crescent crease … cleaner"; caveat: "slightly rubbery at 115° on the stocky bodies".

**Waists kept**: the anatomy fields are untouched, so the wave-V waists are bit-identical (`tools/probe-body.ts`,
HEAD vs now, `waists-{before,after}.json`): human-male elbow F/S 0.091/0.346 → 0.091/0.346, knee 0.059/0.046 →
same; elf-male 0.067/0.324; dwarf-male 0.025/0.313, knee 0.000/0.162; ork-male 0.073/0.439, knee 0.189/0.346
(all 8 bodies equal before/after).

## Tests (new)
* `tests/wave_w_hand_fingers_test.ts` (4): five digits × 3 segments, topology (only the buried ends open: 8 +
  5 × 6 boundary edges, 0 non-manifold), nail plates on 5 tips, triangle cost; the guard grip on 4 races × 4
  weapons (every finger within 1.5 mm of the handle surface and curled, wrap ≥ 110°, palm ≥ −8 mm, dwarf −14
  stated); the square-grip channel (no joint inside the handle, wrap ≥ 170°, a thinner handle closes
  tighter); the mitten leaves only the render index (body data intact, no forearm vertex past the cut, every
  render edge used twice = no hole, hands under their forearm bones).
* `tests/wave_w_hand_portrait_test.ts` (2): backdrop corners walnut and never blue (control: `#172128` reads
  blue), centre lighter; the studio clears to the walnut and draws the backdrop texture, rows flipped right.
* `tests/wave_w_hand_creases_test.ts` (1): inner flesh ≥ 0.45 at the guard / ≥ 0.42 at 1.7 rad, 0 folds and 0
  self-x at the guard, knees ≥ 0.45 at 1.2 rad, the helper is exactly half the hinge and sits on its joint at
  rest; control: plain weights on the ork elbow give inner 0.347, 30 folds (the check can fail).

## Gates (this tree, other lanes' work included)
`deno task check` → 0 errors · `deno task lint` → Checked 584 files, 0 problems (an earlier run's 18 problems
were lane T's scratch `tools/_lt_*.ts`, since removed) · `NO_COLOR=1 deno task test` → **ok | 1721 passed | 0 failed (3m28s)** ·
`deno task build` → 1970867 bytes · browser probes: 0 page errors.
Triangle budget (`ancestry_look_test`, 12 000): islander 11936 → **11888** (two hands 532 tris − the two
mittens' 556 + caps), every ancestry still under.

## Requests / engine patch
No engine change is needed (the hands pose from `rig.setGrip`, which the engine calls every frame after the
forearm twist). **Request to the grip lane (T)**: the wrist snap turns the handle about the GRIP POINT down to
30° from the fingers, which puts the handle line 4 cm from the wrist — no hand can hold that, and the
rendered palm then runs 13–33 mm into the handle for those frames (dwarf/ork worst). Pivoting the snap about the
WRIST (or keeping ≥ 45° handle-to-fingers) would let the fist follow.

## Gaps (honest)
* Dwarf (short, thick hand): the wrist extension reaches its 0.8 rad bound at the guard; the handle presses
  8–13 mm into the palm heel and the thumb 10–15 mm into the handle/fingers; wrap only 115–123°.
* Thumb: touches on the human (0–6 mm), floats 4–12 mm off on the elf, presses in on dwarf/ork.
* Strike frames (30°): see the request above.
* Fingers are 6-sided tubes (the 12 000-triangle budget allows ~270 per hand); they read blocky in
  close-ups; no finger bones in the game skeleton (the curl is solved per pose on the CPU, 0.18 ms).
* Elbow at 2.0 rad (beyond the guard): self-intersections (inner flesh overlapping) rose 1767 → 2216 while folds
  fell 887 → 168; the vision pass calls the bent stocky arms "slightly rubbery" at 115°.
* Hand colour is the body recipe on the hand's own vertices (patterns line up approximately at the wrist).
* The off hand grips only when the anim lane brings it within reach; otherwise relaxed.
