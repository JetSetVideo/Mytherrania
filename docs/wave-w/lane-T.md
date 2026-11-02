# Wave W — lane T (two hands, level thrusts, guard across the palm)

The user (decoded): *"they don't feel like they're holding the weapons right"*. Three measured causes left
open by wave V (docs/wave-v/lane-G.md, gaps):

1. **The off hand never held a two-handed weapon.** The Skeleton's arm joints turn on one axis each, so the
   left arm could only MIRROR the weapon arm (`Swing.swingPose`); its fist stayed in the left arm's own
   plane, 221–505 mm from the haft on a human (583–1116 mm on an ork).
2. **Thrusts pointed up.** The wrist can turn a handle at most 60° from the hammer grip toward the forearm
   line (lane G's snap band, ulnar 1.05 rad), and the thrust's hand path kept the forearm level, so the
   point rose 24–27° above the line to the target's torso (38° on an ork); the reverse-grip dagger's
   point looked 57–61° BELOW it (a level drive, blade out of the little-finger side).
3. **The guard handle lay along the fingers' edge.** GUARD_POSE held the weapon forearm 46° from
   vertical, so an upright blade needed the whole ulnar range: 47° handle-to-fingers on every archetype.

## What changed (files)

| file | change |
|---|---|
| `src/combat/OffHand.ts` (new) | render-side two-bone IK of the left arm (shoulder ball: swing + swivel to an elbow pole; elbow hinge by bisection inside −2.6..0; forearm twist ±1.3 rad that lays the thumb axis along the haft toward the tip); haft point = the weapon's off grip, slid along the haft only when out of reach or when a fist there would sit in the torso; the fist pushed out along the torso normal, else eased back to the free arm's guard (`hold` < 1, never a pop); the weapon-arm CONVERGENCE (below); idempotent; re-closes lane H's fingered hands (`rig.hands.update()`) |
| `src/game/GripStance.ts` | `OffHandPlan`, `offHandPlan` (pure): the off grip per weapon — swords just below the main hand (`SWORD_HAND_SPACING` 0.10 m; lane W's greatsword off grip was at the pommel, −0.21), poles keep lane W's spread (spear/staff −0.5 m, halberd/scythe near the butt) with ±0.25 m slide, `holdsWithTwoHands` (bow excluded) |
| `src/combat/SwingDriver.ts` | `SwingSetup.offHand` (the plan, null for one hand / bow); reverse-grip thrusts use `REVERSE_THRUST`; the thrust path's points scaled to the arm (`handPoint`) in the styled profile |
| `src/game/anim/Swing.ts` | thrust hand path rebuilt (chamber 0.05 fwd / 0.32 below the shoulder → contact 37° down-forward at 0.97 of the reach), `handRef` (paths scale with the holder's reach), `REVERSE_THRUST` (ice-pick: cocks by the head, comes down onto the chest), `handPoint`; `GUARD_KEY.blade` 0.35 → 0.3 |
| `src/game/anim/Poses.ts` | `GUARD_POSE.elbowR` −1.45 → −0.51 (shoulder unchanged): the guard forearm runs ~10° below the horizontal |
| `src/combat/RigAdapter.ts` | `ArmGuard.apply` re-applies the weapon arm's convergence, so the clearance guards measure the arm on screen |
| `src/engine/Engine.ts` | the two-hand step after the placement (pose loop) and again after the clearance guards / a contact rewind (`#offHandAfterGuards`); `debugGripInfo` gains `offHand`, `targetTorso`, `sweet`; `debugView` orbit target `"hands"` (QA) |
| `tools/anim-report.ts` | `placeRig` mirrors the engine: forearm supination (lane G's open gap) + the two-hand step |
| `tools/probe-grip.ts` | the hold beat, aim error against a target at the sweet distance, side views, both-fists close-ups, `GRIP_SHEET=1` one sheet |
| `tests/wave_w_twohand_{fixture,offhand_test,thrust_test,guard_test}.ts` (new) | below |
| `tests/wave_v_grip_rules_test.ts` | one numeric guard: `Math.asin` clamped (the bow now stands exactly upright on the planar rig: 1 + 2e-16 → NaN) |

### Physics: which DOF lives where

RENDER-ONLY. No Skeleton joint was added or moved: the left arm's ball-joint shoulder, the forearm twist and
the weapon arm's convergence are bone rotations written after `rig.update` (as lane G's forearm
supination is). The ragdoll binds to the Skeleton's joints and takes the bones only at elimination, when
the pose stage (and this step) no longer runs; masses, volumes and joint positions are untouched
(channel MSG-12..14/20). Hit boxes are rebuilt from the bones, so the drawn off arm is the one that can be
hit (`SelfGuard` already excludes the off hand/forearm of a two-handed grip from self-clearance). The test
`render-only … idempotent` pins that no Skeleton angle changes and a second call is bit-identical.

### The convergence (broad bodies)

An ork's shoulders are 0.67 m apart for a 0.73 m arm (displayed 0.41 rad abducted): no left arm reaches a
haft held in the right arm's own plane. The weapon arm turns about an axis through its shoulder PARALLEL TO
THE BLADE — the weapon keeps its world direction and the wrist's hold, only slides toward the midline — by
the least angle the off hand needs (≤ 0.9 rad), capped where the weapon hand or the weapon (butt to tip)
would come closer to the torso capsules than it was (or 15 mm), or the blade closer to the body axis than
lane G's 110 mm + 20. Measured alternatives that failed: turning the arm about (arm × lateral) yawed the
blade line and the aim yaw went −0.13 → −0.79 rad on a dwarf (planted-foot slide 10–12 mm, band 5.6/6.8);
measuring the aim line WITH the convergence still slid the feet 6–7 mm. So `measureAimLine` measures
without it and a converged blow lands up to the convergence's slide nearer the target's centre line.

## Before / after (generated from `artifacts/qa-wave-w/*.json` by code; nothing typed by hand)

BEFORE = git HEAD (wave V) extracted to a scratch tree, measured with the same harness. Fixture =
`tests/wave_w_twohand_fixture.ts`: lane A's real skinned rig, the engine's frame order and lane M's
fresh motion style, beats guard / wind-up apex / contact / mid-hold / mid-recovery.

### 1. Off hand on the haft (fixture, the deliverable's bound: < 40 mm)

**human** — off fist to the handle line, mm, before → after

| archetype | guard | windup | contact | hold | recover |
|---|---|---|---|---|---|
| longsword | 341 → 0 | 227 → 0 | 425 → 0 | 465 → 0 | 343 → 0 |
| greatsword | 341 → 0 | 223 → 0 | 420 → 0 | 475 → 0 | 344 → 0 |
| spear | 341 → 0 | 440 → 0 | 361 → 0 | 361 → 0 | 339 → 0 |
| halberd | 341 → 0 | 221 → 0 | 413 → 0 | 489 → 0 | 345 → 0 |
| scythe | 341 → 0 | 221 → 0 | 413 → 0 | 488 → 0 | 344 → 0 |
| staff | 341 → 0 | 236 → 0 | 418 → 0 | 491 → 30 | 350 → 0 |
| greataxe | 341 → 0 | 239 → 0 | 418 → 0 | 505 → 0 | 348 → 0 |
| maul | 341 → 0 | 239 → 0 | 418 → 0 | 505 → 0 | 348 → 0 |

human: 40/40 beats under 40 mm (max 30 mm)

**ork** — off fist to the handle line, mm, before → after

| archetype | guard | windup | contact | hold | recover |
|---|---|---|---|---|---|
| longsword | 583 → 0 | 190 → 0 | 929 → 0 | 1076 → 734 | 604 → 0 |
| greatsword | 583 → 0 | 198 → 0 | 899 → 0 | 1107 → 834 | 606 → 0 |
| spear | 583 → 0 | 914 → 725 | 657 → 803 | 657 → 803 | 584 → 0 |
| halberd | 583 → 0 | 198 → 0 | 867 → 0 | 1116 → 896 | 598 → 0 |
| scythe | 583 → 0 | 198 → 0 | 867 → 0 | 1116 → 780 | 598 → 0 |
| staff | 583 → 0 | 292 → 0 | 899 → 844 | 1088 → 978 | 624 → 0 |
| greataxe | 583 → 0 | 294 → 0 | 888 → 0 | 1096 → 726 | 603 → 0 |
| maul | 583 → 0 | 294 → 0 | 888 → 0 | 1096 → 726 | 603 → 0 |

ork: 29/40 beats under 40 mm (max 978 mm)

**dwarf** — off fist to the handle line, mm, before → after

| archetype | guard | windup | contact | hold | recover |
|---|---|---|---|---|---|
| longsword | 452 → 0 | 208 → 0 | 670 → 6 | 747 → 610 | 470 → 0 |
| greatsword | 452 → 0 | 197 → 0 | 653 → 577 | 768 → 681 | 474 → 0 |
| spear | 452 → 124 | 742 → 549 | 506 → 594 | 506 → 594 | 458 → 152 |
| halberd | 452 → 0 | 193 → 0 | 648 → 576 | 797 → 707 | 477 → 1 |
| scythe | 452 → 0 | 193 → 0 | 647 → 486 | 795 → 690 | 477 → 8 |
| staff | 452 → 124 | 219 → 123 | 647 → 608 | 767 → 703 | 485 → 288 |
| greataxe | 452 → 0 | 225 → 5 | 661 → 0 | 783 → 642 | 483 → 0 |
| maul | 452 → 0 | 225 → 5 | 653 → 0 | 783 → 633 | 483 → 0 |

dwarf: 21/40 beats under 40 mm (max 707 mm)

Broad bodies at the strike beats: the haft lies out of the off arm's reach even after the convergence
(capped by the torso) — the off hand then EASES BACK to the free arm's guard (`hold` 0..1) instead of
reaching through the chest; those cells measure the released hand. See gaps.

### Thrust aim at the contact (fixture: target at the sweet distance)

| body | weapon | BEFORE tip° / line° / err° | AFTER tip° / line° / err° | AFTER hold err° | AFTER handle↔fingers° |
|---|---|---|---|---|---|
| human | spear | 24.4 / -2.3 / **26.7** | 5.3 / 10.0 / **-4.7** | -4.4 | 29.8 |
| human | rapier | 24.4 / -2.4 / **26.8** | 5.3 / 10.4 / **-5.1** | -4.8 | 29.8 |
| human | dagger | -68.4 / -8.5 / **-59.8** | -43.3 / -46.5 / **3.2** | 3.2 | 85.7 |
| ork | spear | 31.2 / -6.9 / **38.1** | 5.6 / 8.6 / **-3.0** | -2.9 | 29.8 |
| ork | rapier | 31.3 / -7.2 / **38.5** | 5.6 / 8.6 / **-3.0** | -2.8 | 29.8 |
| ork | dagger | -66.9 / -9.6 / **-57.3** | -46.4 / -42.4 / **-4.1** | -4.0 | 86.1 |
| dwarf | spear | 24.3 / -4.0 / **28.4** | 5.8 / 4.4 / **1.3** | 1.8 | 29.8 |
| dwarf | rapier | 24.4 / -4.3 / **28.7** | 5.8 / 4.4 / **1.4** | 1.8 | 29.8 |
| dwarf | dagger | -73.1 / -12.0 / **-61.0** | -46.5 / -38.1 / **-8.3** | -8.3 | 85.7 |

The line goes from the grip to the target's torso centre (mid shoulder–hip of the same body standing at
the swing's sweet distance straight ahead). Bound ±10°. The forward thrusts now come in near level from the
lower ribs and rise ~5–10° toward the torso centre; the dagger stabs ~45° down onto the chest. The wrist
stays inside lane G's snap band (handle 30–110° to the fingers) and every orientation rule passes.

Sweet / engage distances moved with the new paths (fixture): human spear 1.468/1.880 → 1.408/1.821 m,
rapier 1.427/1.840 → 1.365/1.778, dagger 0.772/1.185 → 0.675/1.088; ork spear 1.042 → 1.458 (wave V's
point rose out of the torso band). `combat_swing_test` at the engage distance: the spear used to land on
the HEAD (ork head, human head) — now ork abdomen, human chest; at 1.4 m the held blade sits −0.5 cm
from the ork's surface (was 1.0 cm deep).

### Guard: handle to the finger axis (deg), every archetype

| body | BEFORE min–max | AFTER min–max | AFTER blade elevation (forward grip) |
|---|---|---|---|
| human | 47.0–47.0 | 79.6–83.2 | 70.2–70.2 |
| ork | 47.0–47.0 | 79.6–83.2 | 70.3–70.3 |
| dwarf | 47.0–47.0 | 79.6–83.2 | 70.7–70.7 |

(bow 79.6°, the other 16 archetypes 83.2°; the dagger carries reverse at −70°; the carry blade leans 17–20°
toward the opponent as GUARD_KEY asks — wave V stood it at 80° only because the wrist could not reach.)

### 4. Lane M's meters, HEAD → after (`tools/anim-report.ts measureSwing`, 5 bodies × slash/chop/thrust × fresh/exhausted)

| body | swing | live | slide max mm | slide p95 mm | weapon guard mm | weapon strike mm | hands–torso mm | blow/cooldown |
|---|---|---|---|---|---|---|---|---|
| human/imperial | slash | fresh | 3.4 → 3.27 | 3.09 → 3.09 | 363.7 → 160.9 | 446.2 → 444.3 | 218.5 → 82.8 | 0.676 → 0.676 |
| human/imperial | slash | exhausted | 3.08 → 3.08 | 2.7 → 2.7 | 346 → 138.2 | 453.8 → 438.8 | 230.2 → 44.6 | 0.744 → 0.744 |
| human/imperial | chop | fresh | 2.88 → 2.66 | 2.86 → 2.64 | 374.7 → 327 | 285.5 → 274.9 | 218.1 → 218.1 | 0.9 → 0.9 |
| human/imperial | chop | exhausted | 3.02 → 2.78 | 2.49 → 2.49 | 356.8 → 307.7 | 277.8 → 267.1 | 230 → 223.1 | 1.011 → 1.011 |
| human/imperial | thrust | fresh | 3 → 3.1 | 2.23 → 3.02 | 373.6 → 116 | 96.1 → 38.4 | 61.9 → 5.1 | 0.522 → 0.538 |
| human/imperial | thrust | exhausted | 2.97 → 2.98 | 2.12 → 2.98 | 359.3 → 100.1 | 93.4 → 38.7 | 55 → 9.2 | 0.596 → 0.607 |
| elf/wood | slash | fresh | 2.82 → 2.82 | 2.16 → 1.88 | 415.2 → 226.6 | 489 → 504.3 | 300.9 → 154.7 | 0.636 → 0.636 |
| elf/wood | slash | exhausted | 2.87 → 2.87 | 2.84 → 2.85 | 395.1 → 205.7 | 490.6 → 502.6 | 288.6 → 120.2 | 0.698 → 0.698 |
| elf/wood | chop | fresh | 3.46 → 3.4 | 3.41 → 3.3 | 423.1 → 368.8 | 347.2 → 337.1 | 300.6 → 294.7 | 0.9 → 0.9 |
| elf/wood | chop | exhausted | 2.97 → 3.23 | 2.97 → 3.06 | 407.4 → 349.2 | 341.5 → 331.3 | 288.4 → 261.9 | 0.984 → 0.984 |
| elf/wood | thrust | fresh | 3.1 → 2.84 | 2.76 → 2.81 | 421.9 → 190.4 | 109.6 → 41.2 | 97.5 → 8.4 | 0.516 → 0.529 |
| elf/wood | thrust | exhausted | 3.16 → 3.27 | 2.85 → 2.86 | 406.2 → 171 | 145.4 → 40.2 | 108.2 → 6.2 | 0.584 → 0.59 |
| dwarf/mountain | slash | fresh | 3.7 → 4.14 | 1.63 → 1.62 | 194.3 → 69.3 | 299.6 → 273.9 | 101.2 → 15 | 0.683 → 0.683 |
| dwarf/mountain | slash | exhausted | 3.53 → 3.95 | 2.84 → 2.9 | 178.7 → 66.9 | 299.6 → 273.9 | 106.1 → 15 | 0.751 → 0.751 |
| dwarf/mountain | chop | fresh | 3.35 → 3.96 | 2.37 → 2.03 | 201.6 → 205.5 | 176.3 → 156.4 | 101.2 → 101.2 | 0.9 → 0.9 |
| dwarf/mountain | chop | exhausted | 3.35 → 3.96 | 2.11 → 3.63 | 186.1 → 199.2 | 176.1 → 156.3 | 105.9 → 105.9 | 0.989 → 0.989 |
| dwarf/mountain | thrust | fresh | 4.02 → 3.09 | 3.77 → 2.87 | 200.4 → 66.8 | 104.9 → 18.4 | 40.7 → 15 | 0.496 → 0.524 |
| dwarf/mountain | thrust | exhausted | 4.18 → 3.34 | 2.88 → 3.21 | 185 → 66.4 | 118.1 → 18.4 | 38.5 → 15 | 0.568 → 0.586 |
| ork/ironhide | slash | fresh | 4.59 → 4.97 | 3.09 → 2.99 | 350.3 → 115.8 | 411.8 → 373.3 | 143.1 → 15 | 0.725 → 0.725 |
| ork/ironhide | slash | exhausted | 4.61 → 5.03 | 3.12 → 3.13 | 328.2 → 125.7 | 402 → 364.4 | 133 → 15 | 0.8 → 0.8 |
| ork/ironhide | chop | fresh | 3.56 → 4.49 | 3.09 → 2.81 | 356.6 → 320.8 | 251.2 → 229.7 | 143.1 → 143.1 | 0.9 → 0.9 |
| ork/ironhide | chop | exhausted | 3.4 → 4.28 | 2.73 → 2.73 | 330.8 → 304.4 | 242.1 → 220.3 | 133 → 133 | 1.068 → 1.068 |
| ork/ironhide | thrust | fresh | 5.72 → 5.46 | 4.25 → 4.06 | 355.4 → 87.4 | 170.8 → 18.4 | 12.3 → 15 | 0.531 → 0.548 |
| ork/ironhide | thrust | exhausted | 5.6 → 5.29 | 4.89 → 4.6 | 333.3 → 90.8 | 168.4 → 18.1 | 4.8 → 8.6 | 0.606 → 0.618 |
| ork/greenhide | slash | fresh | 4.54 → 4.61 | 3.14 → 2.84 | 382.2 → 115.8 | 424.2 → 378.7 | 175.2 → 31 | 0.72 → 0.72 |
| ork/greenhide | slash | exhausted | 4.44 → 4.51 | 2.67 → 2.9 | 361 → 104.3 | 414.8 → 373.2 | 169 → 15 | 0.794 → 0.794 |
| ork/greenhide | chop | fresh | 3.16 → 3.17 | 2.84 → 3.16 | 369.1 → 312.3 | 240.3 → 222.8 | 174.7 → 174.7 | 0.9 → 0.9 |
| ork/greenhide | chop | exhausted | 2.93 → 2.94 | 2.69 → 2.54 | 341.3 → 292.6 | 230 → 212.3 | 168.9 → 168.9 | 1.066 → 1.066 |
| ork/greenhide | thrust | fresh | 4.88 → 4.76 | 2.97 → 3.14 | 389.7 → 96.4 | 137.1 → 18.4 | 43.1 → 18.9 | 0.536 → 0.551 |
| ork/greenhide | thrust | exhausted | 4.84 → 4.78 | 3.46 → 3.34 | 369 → 80.5 | 134.8 → 18.4 | 35.6 → 12.2 | 0.615 → 0.626 |

All inside `anim_measure_test`'s bands (slide p95 < 5, max < 5.6 / ork 6.8; hands and weapon > 0 mm from the
own torso). The hands–torso clearance falls on two-handed swings (the off hand is ON the haft in front of the
body now; 15 mm is the convergence's torso floor, CONVERGE_TORSO_CLEAR, on the weapon hand), the guard weapon clearance falls (the new guard holds the fist at
the lower chest), the thrust's strike clearance falls to 18–41 mm (a level haft passes the hip).

### 5. The live game (headless Chrome, `tools/probe-grip.ts`, human)

| archetype | beat | handle↔fingers° | off gap mm | striking-end elev° | AFTER aim err° (line to a target at the sweet distance) | rule |
|---|---|---|---|---|---|---|
| greatsword | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| greatsword | windup | 30 → 30 | 249 → 0 | 42 → 45 | – | ok → ok |
| greatsword | contact | 30 → 30 | 457 → 0 | 13 → 12 | – | ok → ok |
| greatsword | hold | 30 → 30 | 546 → 0 | -31 → -27 | – | ok → ok |
| greatsword | recover | 47 → 68 | 394 → 0 | 72 → 50 | – | ok → ok |
| spear | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| spear | windup | 30 → 30 | 488 → 0 | 29 → 29 | – | ok → ok |
| spear | contact | 30 → 30 | 407 → 0 | 34 → 5 | -6.1 | ok → ok |
| spear | hold | 30 → 30 | 407 → 0 | 34 → 5 | -5.7 | ok → ok |
| spear | recover | 47 → 76 | 381 → 20 | 79 → 67 | – | ok → ok |
| halberd | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| halberd | windup | 30 → 30 | 249 → 0 | 40 → 40 | – | ok → ok |
| halberd | contact | 30 → 30 | 457 → 0 | 13 → 13 | – | ok → ok |
| halberd | hold | 30 → 30 | 555 → 0 | -37 → -37 | – | ok → ok |
| halberd | recover | 47 → 70 | 393 → 0 | 73 → 51 | – | ok → ok |
| warhammer | guard | 47 → 83 | – → – | 81 → 70 | – | ok → ok |
| warhammer | windup | 30 → 30 | – → – | 9 → 9 | – | ok → ok |
| warhammer | contact | 30 → 30 | – → – | 15 → 17 | – | ok → ok |
| warhammer | hold | 30 → 30 | – → – | -40 → -41 | – | ok → ok |
| warhammer | recover | 47 → 67 | – → – | 73 → 49 | – | ok → ok |
| staff | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| staff | windup | 30 → 30 | 266 → 0 | 9 → 7 | – | ok → ok |
| staff | contact | 30 → 30 | 459 → 0 | 13 → 13 | – | ok → ok |
| staff | hold | 30 → 30 | 560 → 37 | -36 → -37 | – | ok → ok |
| staff | recover | 47 → 76 | 399 → 6 | 72 → 57 | – | ok → ok |
| rapier | guard | 47 → 83 | – → – | 81 → 70 | – | ok → ok |
| rapier | windup | 30 → 30 | – → – | 30 → 26 | – | ok → ok |
| rapier | contact | 30 → 30 | – → – | 34 → 5 | -6.5 | ok → ok |
| rapier | hold | 30 → 30 | – → – | 34 → 5 | -5.8 | ok → ok |
| rapier | recover | 47 → 66 | – → – | 79 → 54 | – | ok → ok |
| dagger | guard | 47 → 83 | – → – | -81 → -70 | – | ok → ok |
| dagger | windup | 70 → 30 | – → – | -64 → -31 | – | ok → ok |
| dagger | contact | 70 → 86 | – → – | -61 → -43 | 9.7 | ok → ok |
| dagger | hold | 70 → 86 | – → – | -61 → -43 | 9.9 | ok → ok |
| dagger | recover | 70 → 70 | – → – | -31 → -65 | – | ok → ok |
| longsword | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| longsword | windup | 30 → 30 | 252 → 0 | 50 → 54 | – | ok → ok |
| longsword | contact | 30 → 30 | 466 → 0 | 10 → 9 | – | ok → ok |
| longsword | hold | 30 → 30 | 532 → 0 | -24 → -21 | – | ok → ok |
| longsword | recover | 47 → 66 | 392 → 0 | 73 → 49 | – | ok → ok |
| scythe | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| scythe | windup | 30 → 30 | 249 → 0 | 40 → 40 | – | ok → ok |
| scythe | contact | 30 → 30 | 461 → 0 | 11 → 14 | – | ok → ok |
| scythe | hold | 30 → 30 | 555 → 0 | -37 → -35 | – | ok → ok |
| scythe | recover | 47 → 70 | 393 → 0 | 73 → 51 | – | ok → ok |
| greataxe | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| greataxe | windup | 30 → 30 | 269 → 0 | 6 → 6 | – | ok → ok |
| greataxe | contact | 30 → 30 | 463 → 0 | 12 → 12 | – | ok → ok |
| greataxe | hold | 30 → 30 | 574 → 0 | -45 → -45 | – | ok → ok |
| greataxe | recover | 47 → 67 | 396 → 0 | 74 → 50 | – | ok → ok |
| maul | guard | 47 → 83 | 386 → 0 | 81 → 70 | – | ok → ok |
| maul | windup | 30 → 30 | 269 → 0 | 6 → 7 | – | ok → ok |
| maul | contact | 30 → 30 | 463 → 0 | 11 → 12 | – | ok → ok |
| maul | hold | 30 → 30 | 574 → 0 | -45 → -43 | – | ok → ok |
| maul | recover | 47 → 67 | 396 → 0 | 74 → 50 | – | ok → ok |

page errors: before 0, after 0

Ork (live, `artifacts/qa-wave-w/live-after-ork/report.json`): guard handle 86° on all 5, off hand 0 mm at
guard and recovery on all, at wind-up and contact on the swords/halberd; the hold beat and the spear/staff
strike beats release (as in the fixture).
The live dagger's aim error (+10°) is against the live opponent's torso height (a shorter body than the
fixture's own); the fixture's three bodies give −8.3…+3.2°.

## Visual checks (vision, full-size frames — a contact-sheet cell is too small for a verdict)

| frame | verdict |
|---|---|
| `live-before/greatsword-guard-hand-front.png` | "only one fist is actually closed on the handle. The other hand is away from the weapon, across the chest, roughly 30–50 cm" |
| `live-after/greatsword-guard-hand-side.png` | "Two hands. Lower hand: on the handle, with fingers curled around it … no hand or arm passes through the body" |
| `live-after/greatsword-contact-hand-front.png` | "Two hands … stacked one above the other along the handle … No hand is away from the handle" (the side view hides the lower fist behind the upper one) |
| `live-after/spear-contact-hand-side.png` | "roughly level/horizontal … Two hands hold the shaft. The second hand is behind the first along the shaft … No [clipping]" |
| `live-after/rapier-contact-side.png` | "The rapier blade is level … The hand … at about hip height" |
| `live-after/dagger-contact-hand-side.png` | "reverse grip … The blade points down-forward" |
| `live-after/warhammer-guard-hand-side.png` | "The handle passes across the closed fist, roughly perpendicular to the forearm … hammer head is up" |
| `live-after-ork/halberd-guard-front.png` | "holds the polearm's brown shaft with both hands in front of its body, and the weapon is upright" |
| `live-after-ork/spear-contact-front.png` | "One hand holds the spear shaft … the other hand is bent up near the chest/belly … appears to visibly clip into the torso/side" — the RELEASED off arm at the free arm's guard (see gaps) |
| `live-after/sheet-lane-t.png` | every two-handed row: both hands on the handle/shaft in all 8 columns except one greatsword side close-up where the lower fist is hidden behind the upper one; rapier/spear level at contact; dagger blade down toward the chest |

An intermediate build left the lower hand "open, fingers straight, beside the handle": lane H's fingered
hands close on whatever handle is in reach when they update, and they updated in `setGrip`, before the off arm
arrived. `applyOffHandGrip` now calls `rig.hands?.update()` after placing the fist.

Contact sheets: `artifacts/qa-wave-w/live-{before,after,after-ork}/sheet-lane-t.png` (rows: greatsword, spear,
halberd, warhammer, staff, rapier, dagger, longsword, scythe, greataxe, maul; columns: guard/contact × front,
side, hands-side, hands-front; the close-ups orbit the point midway between both fists).

## Tests and gates

* `tests/wave_w_twohand_offhand_test.ts` (4): human, every two-handed archetype × 5 beats < 40 mm, on the haft
  (not past its ends), the weapon hand's rules pass; the control without the step > 200 mm; ork & dwarf at
  guard < 40 mm (6 swords/axes/hafted), the ork also through wind-up/contact/recovery; never a hand inside the
  own torso over 41 frames of every two-handed swing on three bodies; render-only + idempotent.
* `tests/wave_w_twohand_thrust_test.ts` (3): |aim error| ≤ 10° at contact and hold for spear/rapier/reverse
  dagger on three bodies, inside the snap band; the control (wave V's path) > 20° up / < −40° for the dagger;
  hand paths scale with the reach.
* `tests/wave_w_twohand_guard_test.ts` (2): 70–90° handle to fingers for all 17 archetypes × 3 bodies, the
  carry rules; the guard forearm below the horizontal and GUARD_KEY = GUARD_POSE.
* Gates (final tree, other lanes' work included): `deno task check` exit 0; `deno task lint` → Checked 584 files (clean);
  `NO_COLOR=1 deno task test` → ok | 1721 passed | 0 failed (3m27s); `deno task build` OK; probe-grip page errors 0
  (human and ork runs).

## Gaps (honest)

* **Broad bodies release at the strike.** Ork and dwarf: on the haft at guard/wind-up/recovery (and at
  contact for swords and axes), but the follow-through (hold) of every two-hander and the spear/staff
  thrust/chop strike beats release the off hand (fixture: ork 29/40, dwarf 21/40 beats < 40 mm; the released
  hand is 0.5–1.0 m off). Closing it needs a torso yaw / scapular protraction (no such joint; the whole-body
  yaw slides the planted feet) or a two-handed swing designed for the centre line, not the right arm's plane.
* **The released off arm can graze its own torso visually** (ork spear contact, vision): it eases to the free
  arm's GUARD_POSE, which on an ork's wide chest touches the side; the hand capsule stays outside (pinned),
  the forearm is not measured.
* **The thrust cocks with the point ~25–30° up** (wind-up apex aim error 23–33°): a lower chamber (point level
  all the way) drew the hand into the hip (−72 mm) and slid the ork's foot past the p95 band (5.27 > 5). The
  contact and hold are aimed (≤ 8.3°). The rapier/spear hand drives at hip/belly height (the elbow hinge
  cannot put the forearm below the upper arm, so a level point needs a low straight arm).
* **Converged blows land nearer the target's centre line** (the aim line is measured unconverged, see above).
* The dagger's stab is a fixed ~45° — a much shorter or taller target than the holder is up to ~10° off.
* The left forearm twist often sits at its ±1.3 rad bound (the off hand reaches far across).
* The greatsword now closes both fists together under the guard (the user's ask); lane W's off grip
  (−0.21 m, a hand-width gap) is left in the weapon data for the impact model.
* `tools/anim-report.ts`'s `measureSwing` still runs without lane H's finger hands (it builds its own rig).
