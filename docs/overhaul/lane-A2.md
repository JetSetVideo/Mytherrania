# Lane A2 — Body polish (shoulder crease, hands, ears, feet), measured on the POSED skin

**Outcome.** The "cut at the top of the arm" of stocky races is gone in the poses the game shows:
0 folded triangles at the shoulders in the display pose and in the engaged half-guard for every
race (was 8–23 in half-guard), trunk skin next to the shoulder moves 11–31 mm instead of 37–99 mm,
and the ink hull no longer draws over the skin there (ork/dwarf half-guard: 115–119 → 0 px). Hands
have a palm, knuckle ridge and a solved, splayed thumb on BOTH sides (mirror-identical); ears stand
off the head on every race and elf ears are pointed and stand outside the hair cap; feet have sole
pads (vertical sole edge, wider flat contact) and a medial arch. 49/49 body tests pass (43 old + 6 new);
lane C2's `anim_realrig_test` still passes 7/7. Bodies: 8 424–9 148 triangles (budget 12 000).

## Cause of the shoulder crease (measured, not assumed)

`computeSkinWeights` gives each bone a **spherical** influence around its head (distance to the
segment clamps at the joint). Trunk skin MEDIAL to the shoulder joint (clavicle end, pectoral edge,
trapezius cap) is therefore nearer the shoulder segment than the spine line and took **~100 %
shoulder weight** (top-of-shoulder profile, ork: `wShoulder 1.00` out to 0.31 h medial of the joint).
When the arm turns about the joint, that skin **see-saws**: lowering the A-pose arm by
Δ = bind − display lifts a trunk point x medial of the joint by x·sin Δ (ork: −0.4 h → +0.17 h ≈ 4.7 cm
up), while its 0.3-weighted neighbours stay → a step/fold at the deltoid border. It scales with Δ
and shoulder width, which is why heavy races show it: Δ = 0.43–0.53 rad (ork/dwarf) vs 0.20–0.23
(human/elf). Evidence (scratch `diag.ts`, `crease3.ts`, `measure.ts`, before = HEAD weights + HEAD mesh):
- trunk skin within 0.9 h of a shoulder joint moved 87–99 mm (ork/dwarf/orkLight) vs 37–40 mm
  (human/elf) at joint angles 0; 89–141 mm in the half guard the Animator blends in when engaged
  (guard weight 0.55);
- half guard: 8–23 triangles turned inside out at the shoulder; the inverted hull then draws
  through them (front view, noon light: ork 119, dwarf 115 px of ink over skin in the shoulder window);
- display pose: no flipped triangles and 0 ink-over-skin, but thin dark cel bands appear at the
  deltopectoral front where the lifted skin faces down (ork 7 → 37 px, dwarf 1 → 34 px bind → display);
- the hull is NOT the primary cause in the display pose (0 interior ink px in the front view of
  ork/dwarf before and after); paint is not the cause for dwarves (painted vs unpainted 19 vs 20 px)
  — but see "Open issues" for ork warpaint.

**Fix — seam bands (SkinWeights.ts).** The shoulder weight is re-partitioned across the SEAM between
the limb regions (upperArm/foreArm/hand/nail) and the trunk regions (torso/neck): δ = signed geodesic
distance to the seam (Dijkstra along mesh edges, + on the limb), f = smootherstep(−τ, τ, δ),
weights = (1 − f)·W_trunk + f·W_limb, τ = max(1.5·R_deltoid, 1.5 cells). Trunk skin beyond τ never
follows the arm. τ was chosen by a sweep on the posed mesh (folds in display / half guard):
τ = 0.5 R → 0–19 / 3–29 flips (too narrow for a 0.5 rad turn; the heavy races flip), 1.0 R → 0 / 0–2, **1.5 R → 0 / 0**.
The outline-width-from-curvature fallback was therefore NOT needed (no fold left in the shown
poses) and the shader is unchanged.

### Shoulder, before → after (display pose = all joints 0; ½guard = Animator guard × 0.55)

| race | tris | arm bind/disp rad | folds disp | folds ½guard | trunk move disp mm | trunk move ½guard mm | concave edges > 60° disp | top crease mm | armpit crease mm | thin-dark px front disp/ink (½guard) |
|---|---|---|---|---|---|---|---|---|---|---|
| human | 8436 → 8424 | 0.328/0.131 | 0 → 0 | 11 → 0 | 39.8 → 10.7 | 102.5 → 27.6 | 5 → 16 | 39.4 → 32.6 | 60.6 → 59.4 | 249/66 → 238/38 (260/152 → 335/7) |
| elf | 9172 → 8928 | 0.328/0.100 | 0 → 0 | 8 → 0 | 36.6 → 10.6 | 89.0 → 25.3 | 22 → 41 | 31.8 → 29.0 | 51.5 → 50.8 | 643/511 → 523/325 (1065/691 → 482/286) |
| dwarf | 9064 → 8904 | 0.841/0.317 | 0 → 0 | 16 → 0 | 88.1 → 28.2 | 111.3 → 34.4 | 10 → 6 | 36.9 → 34.8 | 56.1 → 57.1 | 34/0 → 13/0 (148/115 → 19/0) |
| ork | 9008 → 9148 | 0.734/0.308 | 1 → 0 | 23 → 0 | 98.6 → 31.1 | 140.9 → 43.3 | 7 → 6 | 56.1 → 55.2 | 72.7 → 81.3 | 37/0 → 18/0 (168/119 → 25/0) |
| dwarf light | 9080 → 9140 | 0.681/0.202 | 0 → 0 | 16 → 0 | 70.6 → 24.1 | 94.8 → 33.2 | 13 → 4 | 35.5 → 30.5 | 54.6 → 54.4 | 147/0 → 56/0 (165/86 → 51/0) |
| ork light | 9084 → 9120 | 0.684/0.235 | 0 → 0 | 14 → 0 | 87.4 → 31.5 | 123.7 → 42.3 | 14 → 8 | 48.1 → 49.3 | 67.9 → 69.4 | 73/0 → 89/0 (158/50 → 43/0) |

Definitions: *fold* = triangle within 0.9 h of a shoulder whose posed normal opposes its bind normal
carried by its vertices' blended bone matrices; *crease* = max height of a neighbour (≤ 4 rings,
≤ 2.5 cells) above a vertex's local tangent plane, top = above the joint, armpit = > 0.3 h below;
*thin-dark* = covered pixel ≥ 30 % darker than brighter pixels within 5 px on both sides (cel bands
from LBS normals, noon light (0.1, 1, 0.2), camera 14° above, 500 px/m, hull 0.035 m), "/ink" = of
those, hull drawn over skin. Specs: human 1.70 m 72 kg, elf wood 1.77/60, dwarf mountain 1.39/70,
ork ironhide 1.95/120, dwarf 1.39/45, ork 1.90/80 (Warrior, no birth sign).
Full guard / attack (`attack.ts`, same new mesh, distance rule vs bands): folds 38–63 → 0–4 (guard),
43–77 → 1–15 (attack, shoulderR −1.7: the remaining ones are the armpit at extreme flexion).
Human/elf "concave edges > 60°" rose (5 → 16, 22 → 41): the seam band shears over 2τ; none are folds.

## Hands, ears, feet (display pose; per side; before = HEAD)

| race | hand verts L/R | hand front area cm² | thumb notch front / side mm | ear verts L/R | ear stands off head mm | elf: ear top above eye / verts outside hair cap | sole verts (span) | flat bottom (side silhouette) | sole wall n_y | medial arch lift mm |
|---|---|---|---|---|---|---|---|---|---|---|
| human | 110/113 → 122/122 | 88 → 118 | 8–12 / 19–22 → 40 / 31 | 19/14 → 12/12 | 17 → 27 | — | 8 (75 %) → 8 (75 %) | 50 → 57 % | −0.72 → −0.54 | 19 → 25 |
| elf | 136/132 → 144/144 | 82 → 112 | 5–10 / 12–13 → 17 / 18 | 25/23 → 46/46 | 34 → 67 | 57 → 56 mm / 17 → 33 | 6–7 (76 %) → 8 (78 %) | 52 → 76 % | −0.65 → −0.61 | 21 → 22 |
| dwarf | 116/105 → 119/119 | 77–79 → 113 | 2–11 / 23–33 → 20 / 22 | 18/14 → 15/15 | 18 → 24 | — | 11–12 (63 %) → 12 (77 %) | 82 → 85 % | −0.70 → −0.56 | 7 → 10 |
| ork | 105/114 → 124/124 | 151–159 → 238 | 15–17 / 24–27 → 31 / 31 | 13/16 → 14/14 | 12 → 32 | — | 11–12 (70 %) → 14 (70 %) | 83 → 89 % | −0.66 → −0.49 | 11 → 17 |
| dwarf light | 126/110 → 129/129 | 69–72 → 108 | 6–12 / 22–29 → 23 / 32 | 21/20 → 16/16 | 21 → 23 | — | 11–13 (70 %) → 14 (70 %) | 81 → 83 % | −0.61 → −0.57 | 12 → 20 |
| ork light | 109/108 → 120/120 | 139–140 → 212 | 14 / 27–28 → 30 / 31 | 13/15 → 13/13 | 11 → 28 | — | 12–13 (66 %) → 15 (77 %) | 86 → 88 % | −0.69 → −0.62 | 13 → 19 |

*notch* = deepest point of the hand silhouette's convex-hull deficiency (1000 px/m, hand triangles
only) — a stump has ~0, a mitten with a thumb has ≥ ~1 cell; HEAD values were L/R-asymmetric.
*stands off head* = max ear x minus the head/face half-width at the same height. *flat bottom* = share
of the foot's side-silhouette columns whose lowest point is within 0.15 cell of the floor. *sole wall
n_y* = mean normal y of foot vertices 0.05–0.6 cell above the floor (0 = vertical wall = crisp edge,
−1 = facing down). *arch lift* = lowest medial-half vertex over 35–60 % of the foot length.

## Timing (this Mac, best of 3, `timing.ts` / `wtime.ts`)
Body (anatomy + polygonise + brushes): HEAD 248–315 ms → now 270–328 ms (human 248→270, elf 315→318,
dwarf 267→304, ork 291→320). Skin weights with seam bands 3.3–7.5 ms (distance rule alone 1.5–2.7 ms).
Cold full rig (weights, paint, face, weapon): HEAD 251–302 ms → now 262–321 ms. Cached rebuild unchanged.

## Files changed (all in lane A's ownership)
| File | Change |
|---|---|
| `src/graphics/body/SkinWeights.ts` | `RootBand`, `SkinWeightOptions`, `SHOULDER_SEAM_FRACTION = 1.5`, `SEAM_MIN_CELLS = 1.5`, `shoulderBands(deltoidRadius, cell)`, `applyRootBands(mesh, bones, skin, bands): number[]`; `computeSkinWeights(mesh, bones, maxInfluences = 4, options: SkinWeightOptions = {})` (4th param optional — contract unchanged). |
| `src/graphics/body/SkinnedHumanoid.ts` | `cachedBody` only (patch): weights with `shoulderBands(...)`. `update()` / `sign:` / `roll:` untouched (lane C2's edits in the working tree are theirs). |
| `src/graphics/body/AnatomyParts.ts` | `cross`, `unit`, `eulerXYZFromBasis(X, Y, Z): Vec3`; ears: `EAR_*`, `POINTED_EAR_MUL`, `MIN_PLATE_CELLS`, `HAIR_CAP_SCALE/POLAR/TILT`, `insideHairCap(p, skullCentre, skullRadii, margin)`, `earNodes(P, skullCentre, skullRadii, headSurface)`; hands: `HAND_PRONATION`, `FINGER_CURL`, `THUMB_SPLAY`, `THUMB_NOTCH_CELLS`, `PALM_PER_WRIST`, `PALM_MIN_HALF_CELLS`, `interface HandParts`, `handNode(P, side, wrist, frame): HandParts`; feet: `SOLE_PAD_HALF_HEIGHT_CELLS`, `ARCH_LIFT`, sole pads (region `sole`), big toe, arch `smoothSubtract`. `headNode` measures the head surface (compiled skull+face field) for the ears. |
| `src/graphics/body/Anatomy.ts` | Forearm twist strength × side (a twist about a mirrored axis must turn the other way); polygonising box mirror-symmetric in x (corners at ±(i + ½)·cell) → L/R limbs identical (mean mirror distance 0.02–0.09 mm). |
| `src/graphics/body/FaceParts.ts` | Hair cap uses the shared `HAIR_CAP_*` constants (no visual change). |
| `tests/body_detail_test.ts` (new) | 6 tests: seam bands on the posed ork/dwarf (trunk move < 0.2 h, 0 folds in display and half guard, and the distance rule FAILS the same check), band weights stay a region-aware partition of unity, hands (solved thumb notch ≥ 1.4 cells, palm floors, L = R vertex counts), mirror symmetry, ears (≥ 8 verts, ≥ ½ cell off the head; elf tip > 0.15 h above the eye, ≥ 10 verts outside the hair cap), feet (contact ≥ 60 % of the length, sole-edge verts, medial arch > ¼ cell). |

No shared file needs a change: the engine already builds every fighter through `buildSkinnedHumanoid`.

## Commands (real output)
```
$ deno check src/graphics/body/*.ts src/graphics/shaders/CelSkinned.ts tests/body_*_test.ts   → exit 0
$ deno lint src/graphics/body/ src/graphics/shaders/CelSkinned.ts tests/body_detail_test.ts …  → Checked 16 files
$ deno test --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch tests/body_*_test.ts
… shoulder seam bands: trunk skin stays put and nothing folds when stocky arms turn (the old rule fails) ... ok (1s)
seam-band weights stay a region-aware partition of unity ... ok (348ms)
hands: palm, knuckles and a thumb that clears the fingers, mirror-identical on both sides ... ok (1s)
the skin is mirror-symmetric (left and right limbs are built and sampled alike) ... ok (288ms)
ears survive the grid on every race; elf ears are pointed and stand outside the hair cap ... ok (1s)
feet: sole pads give a flat, wide contact and an edge; the medial arch lifts ... ok (1s)
… ok | 49 passed | 0 failed (14s)
$ deno test --allow-read --allow-write=… tests/anim_realrig_test.ts   (lane C2's, run read-only)
ok | 7 passed | 0 failed (1s)
```
The new partition-of-unity test failed once during development (`neck vertex 378 takes shoulderR`)
and drove a fix: a region that may not follow the other side of the seam stays on its own side.

## Visual self-check (headless, `scratch/laneA2/render.ts`; cel bands from LBS normals + ink hull + paint, noon, DISPLAY pose)
Each PNG: front, side, back, 3/4 (camera 8° above) + close-ups head 3/4, free (left) hand front and side, feet side.
- before: `/Users/macmax/.hermes/cache/scratch/laneA2/before-{human,elf,dwarf,ork}.png` (HEAD mesh + HEAD weights)
- after: `/Users/macmax/.hermes/cache/scratch/laneA2/after-{human,elf,dwarf,ork}.png`
- shoulder crops (front/3-4, bind/display/half guard): `before-<race>-<pose>-<view>-cel.png`; hand silhouettes `after-<race>-hand{L,R}-{front,side}.png`.
Numbers from the full-body tiles (covered px, ink drawn over skin): front ork 46 413/123 → 47 313/140,
dwarf 24 928/230 → 25 329/191, human 22 390/310 → 22 872/271, elf 18 604/590 → 19 009/524 — whole-body
ink-over-skin is dominated by legitimate overlaps (arm over torso, jaw over neck), so the shoulder
window numbers above are the ones that isolate the defect. I cannot view images; nothing here claims a look.

## Open issues / not verified
- **Ork warpaint (lane B) is a second, larger source of dark curved lines at the top of the arm.** Orks
  (`warpaint 0.9`) with ANY birth sign get warpaint bands on `upperArm` + `foreArm`: shoulder-window
  thin-dark px, front, display pose: no sign 23 → serpent 219, mountain 243, moon 244, storm 582,
  flame 664, void 1 605 (unpainted 23) (`paintcheck.ts`). Dwarf/human sign tattoos add 0. If the QA ork
  had a birth sign, part of "the cut" is paint. Suggested lane-B change: start ork arm warpaint below
  the deltoid (e.g. `foreArm` only) or fade it out within ~1 deltoid radius of the seam.
- Not rendered in WebGL; the headless renderer is orthographic with my emulation of CelSkinned's
  bands/hull. Browser QA must re-run the ork/dwarf front crops.
- Deltopectoral groove: a shallow concavity exists in the BIND mesh too; at noon its walls sit at the
  cel threshold (n·l ≈ 0.25–0.28) so a short dark dash can remain (ork 18, orkLight 89 px in the window).
- Attack pose (shoulder −1.7 rad): 1–15 armpit folds remain (were 43–77); hull-width-from-curvature
  was not implemented because no fold remains in display/guard.
- Hands are mittens with a thumb (fingers are sub-cell). Elf/dwarf thumb notch ≈ 0.8 cell in
  projection (17–23 mm) though the 3-D gap is solved to ≥ 1.4 cells.
- Human/dwarf ears are small by anatomy (12–16 verts); only elf ears are pointed (π from earMul;
  RaceAppearance has no ear-shape gene for orks). The elf tip's last centimetres are thinner than the grid resolves; the polygonised ear reaches 56 mm above the eye line.
- Sole edge: the wall normal only improves −0.72 → −0.49…−0.62; one cell is the limit of a crisp edge.
- Cell refinement re-derives from the edge count, so the new parts nudge cells (elf 21.5 → 22.0 mm)
  and triangle counts (−244…+140).

Scratch (not in the repo): `/Users/macmax/.hermes/cache/scratch/laneA2/{lib,cel,measure,diag,crease2,crease3,parts,render,attack,paintcheck,symmetry,timing,wtime}.ts`
(`*_head.ts` = same scripts against a `git archive HEAD` copy for the before numbers);
JSON: `metrics-before.json`, `metrics-after.json`, `metrics-tau{old,0.5,0.75,1.0,1.5}.json`, `parts-{before,after}.txt`.
