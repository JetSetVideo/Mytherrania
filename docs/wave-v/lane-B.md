# Wave V — lane B (body surface): joint forms, the 80/20 improvisation, form paint

Owner files: `src/graphics/body/{AnatomyParts,Improvise,SkinnedHumanoid}.ts`, `src/graphics/paint/{FormShade,Recipes}.ts`,
`tests/wave_v_body_{improvise,forms,paint}_test.ts`, `tools/probe-body.ts`. Requests to other lanes:
`docs/wave-v/lane-B-requests.md` (+ the mechanical `docs/wave-v/lane-B-anatomy-patch.py`). Not committed.

## How it was measured (all numbers below are tool output, tables generated from the JSON by code)

`deno run -A tools/probe-body.ts --tag before|after` runs the real pipeline (anatomyFor → field → Surface
Nets → the game's paint) for 4 races × 2 sexes (Warrior, seed 7) and writes
`artifacts/wave-v/lane-B/<tag>/metrics.json` + a cel-shaded sheet per body (software rasteriser: 3 cel
bands, depth-edge ink; rows = painted front/side/back/¾, grey shape, grey close-ups of shoulder, elbow
lateral/front/back, knee ¾/side/back, upper back). BEFORE = the probe run on a `git archive HEAD` copy;
AFTER = the working tree (it also contains lane P's in-progress `Anatomy.ts` symmetry pass, which only
changes `skinRoot`, not what these meters read). `--compare` puts them side by side; `--browser` captures
the real game (Chrome, CelSkinned shader + ink hull) per race.

Meters: **waist** at a joint = (smaller neighbouring belly peak − narrowest width at the joint) / narrowest
width, on the front (lateral+medial) and side (anterior+posterior) silhouettes of the limb, rays bisected
on the field — 0 means one tube tapering through the joint. **Bellies** = local width maxima with ≥ ½ cell
prominence. **Concave share** = vertices with smoothed mean curvature H < −2 /m (valleys, creases). **Entropy**
= bits of the H histogram (more curvature regimes). **Blend k** = every smoothUnion width in the plan.
**Texture**: luminance of the painted vertex colours; RMS gradient (1/m) and "band jumps" (edges whose
luminance jumps > 0.08, a cel-band-sized step = the noise-mush meter) on REGION-INTERIOR edges only.
**Physics**: the solved abductions (moved joint = broken ragdoll/slide pins), and per-bone volume of the
hard union of POSITIVE primitives — exactly what `Hitboxes.fitPlan` and so the ragdoll's segment masses
read — next to the rendered field's volume.

## BEFORE → AFTER

| body | elbow waist front / side | knee waist front / side | limb bellies arm F/S, leg F/S | concave share arm / leg / trunk (%) | curvature entropy arm / leg (bits) | distinct blend k / cv(k) | neck→shoulder concavity |
|---|---|---|---|---|---|---|---|
| human-male | 0.055/0.030 → **0.091/0.346** | 0.057/0.024 → **0.059/0.046** | 1/0, 0/1 → 1/1, 0/1 | 2.6/1.1/10.3 → 3.3/1.1/10.4 | 1.56/1.43 → 1.62/1.41 | 19/29 0.56 → 24/41 0.62 | 0.0929 → 0.0929 |
| human-female | 0.078/0.049 → **0.116/0.280** | 0.063/0.044 → **0.063/0.050** | 1/0, 0/1 → 1/1, 0/1 | 2.4/1.7/9.3 → 2.4/1.9/9.1 | 1.65/1.54 → 1.71/1.63 | 19/29 0.52 → 24/41 0.59 | 0.0944 → 0.0944 |
| elf-male | 0.022/0.000 → **0.068/0.379** | 0.010/0.008 → **0.000/0.018** | 0/0, 0/1 → 1/1, 0/1 | 2.2/0.6/13.4 → 1.9/1.8/15.0 | 1.97/1.45 → 1.93/1.49 | 19/29 0.53 → 24/41 0.60 | 0.1027 → 0.1028 |
| elf-female | 0.023/0.001 → **0.069/0.379** | 0.008/0.008 → **0.008/0.009** | 0/0, 0/1 → 1/1, 0/1 | 4.0/1.8/13.9 → 3.2/1.8/12.0 | 2.17/1.60 → 2.26/1.51 | 19/29 0.50 → 23/41 0.58 | 0.1030 → 0.1030 |
| dwarf-male | 0.016/0.000 → **0.019/0.284** | 0.000/0.018 → **0.000/0.158** | 1/0, 0/0 → 1/1, 0/1 | 2.4/2.4/8.8 → 3.3/3.8/7.2 | 1.33/1.45 → 1.64/1.63 | 19/29 0.64 → 24/41 0.68 | 0.0442 → 0.0443 |
| dwarf-female | 0.028/0.007 → **0.036/0.303** | 0.000/0.019 → **0.000/0.151** | 1/0, 0/0 → 1/1, 0/1 | 0.6/2.9/7.2 → 1.0/3.7/7.2 | 1.43/1.60 → 1.73/1.64 | 19/29 0.61 → 24/41 0.65 | 0.0474 → 0.0475 |
| ork-male | 0.043/0.033 → **0.073/0.439** | 0.142/0.164 → **0.189/0.346** | 1/1, 1/1 → 1/1, 1/1 | 2.0/1.8/8.6 → 5.5/3.0/8.6 | 1.28/1.10 → 1.69/1.10 | 19/29 0.63 → 23/41 0.67 | 0.0407 → 0.0407 |
| ork-female | 0.052/0.040 → **0.084/0.419** | 0.137/0.162 → **0.190/0.332** | 1/1, 1/1 → 1/1, 1/1 | 1.3/1.6/6.1 → 3.7/3.0/6.1 | 1.22/1.07 → 1.54/1.24 | 18/29 0.59 → 23/41 0.64 | 0.0435 → 0.0435 |

| body | texture arm: interior rms gradient (1/m) / std / interior band-jump % | leg | trunk | neck+face |
|---|---|---|---|---|
| human-male | 0.49/0.011/0.62 → **1.11**/0.025/1.23 | 0.31/0.149/0.00 → **0.36**/0.151/0.00 | 0.41/0.008/0.00 → **0.85**/0.020/0.38 | 2.25/0.016/3.83 → **2.25**/0.020/3.83 |
| human-female | 1.39/0.012/0.61 → **0.68**/0.021/0.66 | 0.34/0.151/0.00 → **0.40**/0.153/0.07 | 0.44/0.008/0.00 → **0.73**/0.018/0.28 | 1.33/0.013/2.20 → **1.33**/0.018/2.20 |
| elf-male | 0.74/0.011/0.26 → **0.63**/0.019/0.00 | 0.38/0.201/0.00 → **0.46**/0.204/0.10 | 0.46/0.008/0.00 → **1.11**/0.027/1.31 | 1.03/0.011/1.22 → **1.09**/0.014/1.45 |
| elf-female | 0.87/0.011/0.42 → **0.83**/0.027/0.21 | 0.39/0.203/0.00 → **0.46**/0.205/0.17 | 0.50/0.008/0.00 → **1.01**/0.025/0.95 | 1.10/0.013/1.12 → **0.99**/0.014/0.00 |
| dwarf-male | 0.88/0.016/1.76 → **1.24**/0.026/2.36 | 0.33/0.100/0.00 → **1.46**/0.103/0.00 | 0.39/0.008/0.00 → **0.55**/0.017/0.07 | 0.45/0.015/0.00 → **0.58**/0.021/0.00 |
| dwarf-female | 0.71/0.014/0.68 → **0.89**/0.017/1.52 | 0.35/0.101/0.00 → **0.51**/0.105/0.03 | 0.41/0.008/0.00 → **0.52**/0.015/0.25 | 0.54/0.011/0.00 → **1.14**/0.018/3.60 |
| ork-male | 1.06/0.029/1.87 → **1.23**/0.037/2.97 | 0.74/0.088/0.23 → **0.74**/0.091/0.48 | 0.28/0.008/0.00 → **0.42**/0.018/0.04 | 0.59/0.025/0.00 → **0.59**/0.039/0.00 |
| ork-female | 1.06/0.029/1.17 → **1.21**/0.034/2.41 | 0.75/0.089/0.46 → **0.78**/0.093/0.56 | 0.28/0.008/0.00 → **0.38**/0.016/0.19 | 0.78/0.025/0.00 → **0.78**/0.035/0.00 |

| body | cell (m) | arm / leg / display abduction (rad) | solid (physics) volume L: upperArm, forearm, thigh, shin | field (rendered) volume Δ%: upperArm, forearm, thigh, shin | triangles |
|---|---|---|---|---|---|
| human-male | 0.02531 | 0.3219/0.0697/0.1277 (same) | 3.160→3.112, 2.367→2.510, 7.435→7.442, 2.408→2.353 | -0.8, +4.6, +1.5, -4.1 | 8480 → 8544 |
| human-female | 0.02365 | 0.2969/0.0670/0.1200 (same) | 2.444→2.433, 1.897→2.025, 5.574→5.568, 1.858→1.858 | -2.3, +2.8, +0.0, -2.1 | 8524 → 8548 |
| elf-male | 0.02271 → 0.02286 | 0.3187/0.0396/0.1000 → 0.3219/0.0410/0.1000 | 2.007→2.002, 1.542→1.674, 4.632→4.629, 1.646→1.664 | +0.6, +6.7, +2.3, -5.9 | 9068 → 8956 |
| elf-female | 0.02171 | 0.3281/0.0396/0.1000 (same) | 1.653→1.627, 1.264→1.359, 3.595→3.595, 1.394→1.390 | +2.6, +5.8, +0.1, -3.0 | 9052 → 9040 |
| dwarf-male | 0.02576 → 0.02590 | 0.9000/0.2051/0.3406 → 0.9000/0.2051/0.3438 | 5.423→5.436, 3.836→4.015, 11.573→11.641, 3.144→3.121 | -1.4, +2.0, -0.3, +0.7 | 8940 → 8992 |
| dwarf-female | 0.02439 → 0.02442 | 0.7969/0.2010/0.2606 (same) | 4.470→4.425, 3.117→3.301, 8.965→9.010, 2.651→2.637 | -0.9, +2.6, -0.2, -1.7 | 9120 → 9160 |
| ork-male | 0.03500 | 0.9000/0.1914/0.4031 (same) | 18.631→18.703, 15.212→16.062, 36.031→36.085, 14.362→14.434 | -0.9, +2.0, +0.4, -1.3 | 10592 → 10720 |
| ork-female | 0.03500 | 0.8031/0.1818/0.3554 (same) | 14.814→14.796, 12.010→12.752, 26.390→26.535, 11.739→11.757 | -1.2, +2.9, +1.1, -2.9 | 9356 → 9444 |


Read: the elbow side-view waist goes from ~0 (a tube) to 0.28-0.44 on every body, the knee side waist
rises most on the heavy races (dwarf 0.02 → 0.15-0.16, ork 0.16 → 0.33-0.35); every arm now has a belly in
both silhouettes. Distinct blend widths 19 → 23-24 (cv 0.5-0.64 → 0.58-0.68). The trunk's GEOMETRY is
unchanged on purpose (neck→shoulder concavity identical; see "dropped"), its detail is painted: trunk
interior gradient ×1.3-2.4. Physics: in the whole-body probe (0.75-cell voxels, ownership shared with the
trunk) the solid volume moves upper arm −1.6…+0.4 %, thigh −0.1…+0.6 %, shin −2.3…+1.1 %, forearm +4.7…+8.5 %
(+6 % BY DESIGN, below); the unit test measures each part alone at ½ cell and pins ±1 % (forearm ±1.5 %
around +6 %). Abductions
are bit-identical on 6 of 8 bodies; the elf male and the dwarf male move one bisection step because the
anatomy re-derives their grid cell from the surface (request R1 makes that exact).

The unit tests' own printout (½-cell voxels, the same 4 races): upper arm −0.02…+0.18 %, forearm +5.8…+6.1 %
(target +6 %), thigh −0.01…+0.16 %, shin −0.18…+0.02 %; elbow side waist 0.000/0.005/0.000/0.052 →
0.332/0.295/0.335/0.454, knee 0.029/0.009/0.030/0.171 → 0.042/0.024/0.188/0.376 (human/elf/dwarf/ork);
form paint on the human: arms 0.54 → 1.11 /m with band jumps 0.61 → 1.23 %, legs 0.31 → 0.36 /m (0 → 0 %),
trunk 0.41 → 0.85 /m (0 → 0.38 %).

## Images

* Side by side (left BEFORE, right AFTER), one per body: `artifacts/wave-v/lane-B/compare/<race>-<sex>.png`
  (human/elf/dwarf/ork × male/female). Separate sheets: `artifacts/wave-v/lane-B/{before,after}/*.png`.
* In-game captures (real Chrome): `artifacts/wave-v/lane-B/browser/<race>-{front,side,back,close34,arm,armBack}.png`,
  HEAD build `browser-before/`, paired `browser-compare/`. Caveat: the HEAD build's debug camera has no
  `target: "hand"` and other lanes changed the pose/weapon, so only front/side/back/close34 frame alike.
* Vision review (the agent's own, by the vision tool, on the compare sheets): "joints read as muscle forms"
  BEFORE 3/10 → AFTER 6-7/10 (human female 7, ork male 7, dwarf male 6, elf female 7); remaining remarks:
  some lumpy bellies, stair-stepped contours (the 2-3.5 cm grid), the fossa/popliteal hollows outlined by
  the software renderer's depth ink (the game's ink hull draws silhouettes only). In game at play distance a
  human arm is ~10-20 px wide: the forms read in the 2 m close (dwarf close34: "deltoid, biceps/triceps
  bulges, elbow narrowing, forearm taper, pectoral edges, more form-following shading") and barely at 4 m.

## What changed

**Joint forms (AnatomyParts.armNode / legNode, the existing part hierarchy).**
* Arm: the upper-arm core tube narrows into the elbow (`UPPER_ARM_DISTAL_CORE` 0.95); biceps and triceps
  bellies carry the volume (gain solved, depth-only so the medial-lateral extent — an abduction-solve input —
  is kept) and the biceps ends in a TENDON capsule into the crease; the round elbow BALL becomes an
  epicondyle bar (wide, shallow) plus an OLECRANON point; the forearm gets a FLEXOR mass (medial-front)
  beside the brachioradialis; the CUBITAL FOSSA is a cutter in front of the elbow, the tendon crosses it.
* Leg: the knee ball becomes femoral CONDYLES (same frontal outline, flatter front-back); the VASTUS
  MEDIALIS teardrop sits above the knee (front-medial); the calf splits into MEDIAL (lower, bigger) and
  LATERAL (higher) gastrocnemius heads; the POPLITEAL hollow is a cutter behind the knee. The thigh keeps
  its pre-wave medial extent and blend (the leg-gap solve binds at its top; measured min probe distance
  28.913 mm before and after).
* Varied blends: muscle unions at `MUSCLE_K_ARM` 0.24·R / `MUSCLE_K_LEG` 0.22·R (pre-wave 0.35 / 0.30 for
  everything), the biceps with its own seeded width.
* Mass neutrality BY CONSTRUCTION: `armGains` / `legGains` solve (secant, cached per body) the belly gains
  so each segment's positive-primitive volume equals the pre-wave part's — the ragdoll's own measure.
  `FOREARM_MASS_BIAS` 1.06: at 1.00 the capsule fit covered the offset flexor less tightly than the old
  ball and the default Warrior's forearm fell to 1.93 % of the body, under the 2 % weld floor (elbow
  welded, three ragdoll pins red); with 1.06 it is 2.19 % (L) / 2.23 % (R) (HEAD: 2.06 / 2.09 %). Robustness: `THUMB_TIP_MIN_CELLS` 0.7 (a 0.56-cell
  thumb tip broke off as its own component on the slim elf hand when the cell moved 0.1 mm).
* `referenceForms(fn)` builds the exact pre-wave parts (tested equal), for request R1.

**The 80/20 improvisation (Improvise.ts).** 25 knobs on the hierarchy part → muscle → knob (arm 10, leg 10,
trunk 5). Per seed, in EACH part exactly round(0.2·n) knobs (ranked by a seeded FNV/avalanche hash) are
EXPLORED uniformly in their own [min, max]; the rest are KEPT at 1 ± 3 %. Kinds and why each is mass-safe:
shape (long × v, cross × 1/√v), girth (x × v, z / v), depth (front-back only), place (along the bone),
blend (an internal muscle width, never a joint the solves read), groove (a cutter), paint (a FormShade gain,
no geometry). Left and right share values. The arm/leg gain solve runs per seed, so the residual volume
error is re-closed for every improvised body. Tested: shares (200 seeds), bounds, kept-band, explored span
> 60 % of each range, determinism, volume-kept reshapes, detail differs by seed, and the solved joints
are identical across seeds for the fixed-cell races (human, ork).

**Form paint (paint/FormShade.ts, applied in SkinnedHumanoid.paintSkin).** Smoothed (2 rings) mean
curvature in grid units: grooves multiply by up to 1 − 0.22 (cavity), bony points/tight convex forms lift
toward white by 0.10 (skin) or 0.16 (garment = worn cloth). Face, ears, hair, nails and soles are skipped
(the face's sub-cell features painted a speckle: neck+face band jumps 3.8 → 11 % when included). The trunk's
seeded gains come from the "paint" knobs (0.6-1.5). Recipes.ts exports `GARMENT_REGIONS` (same list).

## Dropped / not done (with the numbers)

* **Torso geometry** — DROPPED, the torso is exactly pre-wave. Tried: a sharper pectoral blend, a 0.07·h
  scapula blend (moved the human arm abduction one bisection step), nested clavicle/trapezius unions
  (dwarf half-guard trunk skin 40.4 → 41.9 mm vs its 41.5 mm bound), a nested pectoral union (nodeBounds
  padding moved the grid's z origin: dwarf heel contact span 70 → 56 % of the foot, pin 60 %), seeded
  pectoral reshapes, and finally pure cutters (infra-pectoral fold, sternal furrow, navel shift): the ork's
  thrust hand went 0.9-9.7 mm inside its torso capsule, the ork overshoot 25.4 % (pin < 25 %), the default
  Warrior's throw 3 did not settle in 3 s. Cause: Hitboxes fits a band of the real field around the
  primitives, so even cutters at the chest surface move the chest capsules (request R3).
* **Deltoid / lats** — not touched (lane S-B's seam-band measurement stands; the lat sits on the arm solve).
* **Garment hem darkening** — DROPPED: the garment edge is a region seam, grid-quantised into stair-steps;
  darkening it outlined every step ("blocky cutout at the nape" in the vision review).

## Gaps (honest)

* The cell coupling: without request R1 the elf male (cell 0.02271 → 0.02286) and the dwarf male (display
  abduction 0.3406 → 0.3438) differ from HEAD; for elves the cell also varies by seed (6 values in seeds 1-8).
  All suites are green today, but any lane's surface change can flip a grid-phase pin until R1 lands.
* The grid (TRIANGLE_TARGET 9000, 2.3-3.5 cm cells) is the ceiling: grooves under ~2 cells only reach the
  NORMALS and the paint. The knee waist on the slim human/elf stays small (0.04-0.05 front/side).
* Painted arm gradient went DOWN on 3 bodies (human female 1.39 → 0.68, elf male 0.74 → 0.63, elf female
  0.87 → 0.83 /m): their pre-wave arm "gradient" came from the vein/definition noise layers sampled on the
  old vertices; the new detail is smoother. Legs gain least (thigh is cloth, shin is one long form).
* Field (rendered) volume is not pinned: forearm +2…+7 % (the bias plus the flatter elbow), knee −2…−6 % on
  slim bodies (the flatter condyles), while the PHYSICS volume (positive primitives) is pinned.
* The in-game check is qualitative (screenshots + the vision tool); the software renders are the
  measured ones. No phone/low-tier GPU was exercised; triangles rose by ≤ 1.3 % (ork 10592 → 10720),
  inside the mesh tests' budget.

## Gates (this tree, other lanes' work included)

`deno task check` → 0 type errors (567 files). `deno task lint` → 1 problem, in `tools/probe-ui-all.ts`
(the UI lane's `jsr:` import), lane B's files lint clean (`deno lint` on them: Checked 30 files).
`NO_COLOR=1 deno task test` → `ok | 1702 passed | 0 failed (3m0s)`. `deno task build` → 1938922 bytes.
