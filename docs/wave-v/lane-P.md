# Lane P (wave V) — heels on the ground in idle, a breathing torso + idle weight shift, a final symmetry step

User ask (voice): *"heels on the ground when they're standing in idle, make their torso breathe a little, move
slightly; change a bit the symmetry in the final step so that they look better."* Every number below is
printed by a tool named next to it (no hand-typed values). Nothing committed.

## 1. Heels on the ground in idle

**Measured first** (`deno run -A tools/anim-report.ts --idle`, new mode: 4 races × 3 subraces × 2 sexes ×
fresh/exhausted × 3 idle modes = 144 runs of 10 s, real skinned rigs, engine frame order, per foot per frame
after 1 s: heel and ball height, sole pitch, slide). `guard-track` = standing in guard while the rig keeps
turning to face a rival that sways ±0.06 rad over 5 s (what `Engine.#updatePose` feeds an idle fighter).

| mode | BEFORE heel max / mean mm | pitch max | heel-up share | slide mm | AFTER heel max | pitch | share | slide |
|---|---|---|---|---|---|---|---|---|
| guard-still | 1.9 / ≤1.4 | 0.00° | 0 | 0.00 | 1.70 | 0.00° | 0 | 0.31 |
| **guard-track** | **27.3 / 12.95–20.11** | **8.02°** (mean 5.7°) | **0.80–0.83** | 2.70 | **1.70** | **0.00°** | **0** | 0.31 |
| relaxed-still | 1.7 | 0.00° | 0 | 0.00 | 1.70 | 0.00° | 0 | 0.07 |

(`artifacts/anim-idle-before.json` → `artifacts/anim-idle-after.json`; ball max after 1.70 mm, floor min ≥ 0.05 mm.)
The residual 0.2–1.7 mm is the rig's standing sole depth (both heel and ball, pitch 0 — the whole sole sits
that far up), not a lift.

**Cause.** Standing still the feet were flat (≤ 1.9 mm). They lifted as soon as the rig *turned*: the legs have
no yaw joint, so lane M's ball pivot (`pivotPitch` 0.14 rad) rolls a planted foot onto its ball once the body
has turned 0.004–0.04 rad since touchdown — and an idle fighter's rig is re-aimed at the rival every frame,
so any rival motion left the heels 18–27 mm up (8°) for 80 % of idle frames, until the next step. Not the ride
height, not the ankle limits (`guard-still` was flat).

**Fix — the idle facing hold** (`Animator`, `AnimatorParams.facing*`): standing (gait.moving < 0.05, no attack /
skill / KO, grounded) the body keeps the heading its feet were planted at while the rival stays inside
±`facingSlack` 0.1 rad; past it the body re-faces (heading eases at 5/s) and every foot more than 0.006 rad off
steps in place to align (`Gait` `replantYaw`, `FootState.plantYaw`). Moving/striking, the held heading is
released at 20/s (a swing's aim yaw keeps lane M's ball pivot exactly as before). The animator outputs the
offset (`AnimatorOutput.yawOffset`) and solves the legs for it; **the engine must add it to the rig's yaw**
(`docs/wave-v/lane-P-engine-patch.py`, 3 exact-once edits). Measured re-face (test): max lag 0.093 rad, end
0.0038 rad, heels flat after the step. Walking/striking still roll heel-toe as before (no change to the gait
roll-off, swing pivot or toe-off).

**Two gait robustness fixes found on the way** (`Gait.ts`): an in-place step lands ON its predicted spot over
the last 40 % of the swing (the damped landing lagged a frame-rate-dependent distance), and a **settle**: after
0.25 s standing (speed < 0.05 m/s, |turn| < 0.05 rad/s) the re-plant thresholds halve, so a foot a swing left
near the edge of its stance tidies up. Without it the 30/60/144 Hz runs of `tests/anim_fourphase_test.ts`
diverged (one foot at 0.91 vs 1.04 of the threshold → a step at one rate only, knee 0.21 rad apart); with it
the worst joint difference is 0.0081 rad (HEAD 0.0115).

**Without the engine patch** (`--unpatched`, `artifacts/anim-idle-unpatched.json`): guard-track heel-up share
0.83 (as before) and the settle can add an occasional step (ball 54 mm = a foot in the air). Apply the patch.

## 2. Breathing + idle weight shift

* **Breath** (`Poses.BREATH_UNIT`, `Animator`): spine extension cut to 0.35 (was 1.0: a rocking, not a breath),
  abdomen counters 40 %, neck/head keep the gaze level, arms lift a hair; a skewed wave (quicker inhale, longer
  exhale, ψ = φ + 0.3 sin φ); a **chest rise**: the pelvis rides up to 2·0.0022·L lower on the exhale (never above
  the stance height — the feet stay latched); fades by (1 − moving) and to 25 % while striking / in a skill.
  Rate from the live style: NEUTRAL 0.22 Hz (was 0.25).

| | BEFORE fresh | BEFORE tired | AFTER fresh | AFTER tired |
|---|---|---|---|---|
| chest (spine) pitch peak-to-peak | 2.53–3.02° | 6.53–7.79° | **0.89–1.06°** | 2.29–2.73° |
| shoulder peak-to-peak | 0.89–1.06° | 2.29–2.73° | 0.30–0.36° | 0.78–0.94° |
| period | 4.00 s | 1.82 s | **4.53–4.55 s** | **2.07–2.08 s** |

  Fade (test): breath weight×wave idle 1.00, walking 0.000, striking 0.250.
* **Idle weight shift**: the pelvis drifts sideways over the feet (rig-local x, IK keeps the soles latched),
  `idleSwayAmp` 0.011·L, quasi-periodic (0.8 sin φ + 0.2 sin 2.618φ), seeded period 6–9 s per fighter, fades in at
  1.5/s, out at 6/s when moving/striking/hit. Measured pelvis peak-to-peak **10.2–17.7 mm** (was 0), slide in idle
  ≤ 0.31 mm (the IK's soft reach, sub-mm), walking/striking 0.00 mm of sway.
* Frame-rate independent (integrated phases; 30/60/144 Hz agree, tested), no per-frame allocation (scalars and
  pre-allocated arrays only).

## 3. Final symmetry step of the generation

**Read first:** `Characters.randomProfile` → `specFromAppearance` → `Anatomy.anatomyFor` builds every left/right
part from ONE function called with side ±1 on an x-symmetric grid: **there are no independent left/right draws.**
Measured before: 50–53 primitive pairs per body, **mirror deviation 3.3e-16** (exact); field volume L/R of the arms
0.00 %, of the legs −0.05…−0.22 % (the only pre-existing asymmetry: the n-ary smooth union is evaluated left to
right, `smin(smin(trunk, legL), legR)`).

**New final step** (`Anatomy.finalSymmetryPass`, `BodyProfile.bilateralAsymmetry/pairScales`):
1. enforce the mirror (a pair whose deviation exceeds 1e-9 becomes the mirror of its mean; orientations compared
   as axes up to sign — the ears are written as a 180°-turned ellipsoid); today a measured no-op, tested to repair
   a deliberately broken pair (0.0476 → 2e-16);
2. re-apply a seeded natural asymmetry on the **skin only** (`DetailedAnatomy.skinRoot`): dominant (weapon) side —
   right for 88 % of seeds — fuller upper arm (|δ| 0.8–2 %) and pectoral/scapula (0–1.2 %); the support leg fuller
   for 70 % of seeds (thigh 0–1.2 %, shin 0–1 %, shin tapered back to 1 before the ankle); one cheek/jaw/brow 0–1.5 %.
   Girth about the bone axis (joints and lengths never move); the other side takes √(2 − (1+δ)²), so l² + r² = 2.
   Hands, feet, soles, ears and forearms untouched.

`deno run -A tools/anim-report.ts --symmetry` (`artifacts/anim-symmetry.json`, 1 600 draws + 16 sampled bodies):
right-handed share 0.879, support-leg share 0.701; mean |δ| arm 1.42 %, chest 0.61, thigh 0.60, shin 0.50, face 0.75;
skin field volume change −0.025…+0.056 % (redistribution); arm L/R volume 0.00 % → 1.21–2.39 %, legs → 0.02–1.16 %.
Mesh mirror distance (dwarf, cell 27.3 mm): physics 0.064 mm, skin 0.662 mm.

**Why the skin only (measured, the physics rule bit harder than "redistribution is free"):** applied to `plan.root`,
the combat-capsule fit swung a thrust's hand-to-torso clearance 32 → −13 mm from a 0.4 % thigh change, the
hitbox overshoot crossed its 25 % band (25.6 %), and the non-dominant forearm (−0.6 %) welded the ragdoll's
forearm segment under the 2 % floor. So `plan.root` (Hitboxes, ragdoll, abduction solves, bounds) stays the exact
mirror — byte-identical to the pre-wave tree (tested) — and the rendered skin polygonises `skinRoot`. The forearm
gain is 0 (`ASYMMETRY_GAIN.foreArm`, the draw kept so other dimensions never shift).

**This needs one patch on the surface lane's file**: `docs/wave-v/lane-P-body-patch.py` (BodyMesh.ts gains
`skinField`, `generateBody`/`meshPlan` use it; and RESTATES `tests/body_detail_test.ts` "the skin is
mirror-symmetric": physics mesh < 1 % of a cell as before, skin < 6 % — it pinned exactly what the user asked
to change). Without it bodies render mirrored as before.

## 4. Browser verification (`tools/probe-idle.ts`, new)

`deno run -A tools/probe-idle.ts [outDir]` — per race: an 8 s LIVE window (player seat without input stands while
the opponent's AI roams; pause cleared with Escape until `debugClock` advances), then 3 freezes with orbit
captures (front/right/back/left + two low shots) and a contact sheet. Heel estimated from the ankle/ball pivots
against the race plan's bind foot (no heel bone). BEFORE = HEAD build, AFTER = HEAD + lane P + both patches.

| LIVE, standing frames with a heel > 5 mm | BEFORE | AFTER |
|---|---|---|
| human/nomad | 76 / 104 (mean R 19.2 mm) | 11 / 96 (mean ≤ 1.3 mm) |
| elf/wood | 5 / 114 | 0 / 0 (no countable frame, see gaps) |
| dwarf/mountain | 75 / 107 (mean 12.7 mm) | 9 / 117 (mean ≤ 1.4 mm) |
| ork/ironhide | 60 / 109 (mean 12.4 mm) | 7 / 112 (mean ≤ 2.1 mm) |

0 page errors both builds. Vision on the sheets: before ork — "right heel visibly lifted, pitched onto its
ball"; after ork — "neither heel visibly lifted, both feet flat… no odd asymmetry, no clipping"; after elf —
"both feet essentially planted". Captures: `artifacts/qa-wave-v-idle/{before,after}/sheet-*.png` (+ per-view PNGs,
`report.json`).

## 5. Physics / pins (HEAD + lane P, frozen mirror so the other lanes' in-progress edits do not mix in)

* Swing slides (`anim_measure` band 5.6 / ork 6.8 mm): dwarf/mountain slash fresh 5.54 → **5.59 mm** (0.01 mm
  headroom; each of breath/sway/hip-shift/pin moved it ±0.01–0.02), ork/ironhide slash 6.68 → 6.67. Floors 0.
* All 97 anim tests green; HEAD + lane P + both patches: `deno task test` → **ok | 1680 passed | 0 failed**
  (1670 + 10 new).
* Shared working tree (other lanes mid-edit, patches NOT applied): `deno task check` exit 0; `deno task lint` 567
  files, 1 problem in `tools/probe-ui-all.ts` (UI lane, `jsr:` inline import); `NO_COLOR=1 deno task test` →
  `FAILED | 1698 passed | 4 failed`: anim_measure "ork/ironhide thrust fresh: slide p95 5.61 mm" (fails with
  lane P's files stashed too — "hand -0.4 mm inside the torso" — the grip lane's SwingDriver/SwingRig edits),
  wave_v_body_forms + anim_swing spear (pass on an immediate re-run with lane P's files: transient states of the
  other lanes' edits), wave_v_body_paint (the surface lane's own test). Both patch scripts dry-run OK on this tree.

## Files

`src/game/anim/{Animator,Gait,Poses,MotionStyle,Scenario}.ts`, `src/game/BodyProfile.ts`,
`src/graphics/body/Anatomy.ts`, `tools/anim-report.ts` (`--idle [--unpatched] [--out=]`, `--symmetry`,
`measureIdle`, `idleSweep`, `buildBody(..., sex)`), `tools/probe-idle.ts` (new),
`tests/wave_v_pose_idle_test.ts` (6), `tests/wave_v_pose_symmetry_test.ts` (4),
`docs/wave-v/lane-P-engine-patch.py`, `docs/wave-v/lane-P-body-patch.py`, this file.
`src/game/Characters.ts` untouched: the asymmetry is seeded from `BodySpec.seed` with its own salt, so no
existing roll shifts.

## Gaps (honest)

1. The heel fix needs the **engine patch** (3 lines). Unpatched, heels still lift under a swaying rival and the
   new settle can add an occasional step.
2. The asymmetry needs the **BodyMesh patch** to be visible; it is 1–2.4 % of a limb's volume (≈1 mm girth) — a
   look, deliberately subtle, and never physical.
3. dwarf/mountain swing slide sits 0.01 mm under its 5.6 mm band (the sum of tiny breath/sway/hip-shift effects;
   lane M gap 3, the ball drift under a swing's yaw, is the real cause and is untouched).
4. Browser heel is an estimate from pivots (no heel bone); frozen captures are a snapshot of the freeze instant
   (some caught mid-step: "R 56.8 mm" on human), so only the LIVE window is used as evidence. The elf AFTER live
   window had no countable frame (every sample failed the ball-down filter — floor sampled at the hip, not under
   the foot); its frozen runs show heel ≤ 3.0 mm, pitch ≤ 1.1°. The "feet" orbit shots frame the chest (the orbit
   camera targets the body centre; no foot target exists).
5. Idle slide is 0.07–0.31 mm, not exactly 0 (the IK's soft reach while the pelvis breathes and sways).
6. The working tree's full suite is affected by other lanes' in-progress edits (one run showed 6 body/ragdoll
   failures that pass a minute later with the same lane-P files); the clean evidence is the frozen mirror run.
