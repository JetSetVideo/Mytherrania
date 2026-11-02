# Wave V — lane G (grip): the weapon sits IN the hand

The user: *"the angles of the weapon compared to the hand (from the palm of the hand) is not right … axes or
lances always have the blade pointing toward the top / outward from the body; only daggers can be held with the
blade going down."*

## The bug, measured (before any fix)

`tools/probe-grip.ts` (headless Chrome) pins the plain swing of every archetype at guard / wind-up apex /
contact / mid-recovery and reads the live scene graph through the new QA hook `Engine.debugGripInfo()`:

* the **hand frame** — the anatomy's own hand landmarks (`AnatomyParts.handNode`: `d` finger axis, `n` back of
  the hand, `w` across the palm toward the thumb, palm centre, grip anchor) mapped through the forearm bone's
  skinning transform (`RigAdapter.handFrameWorld`: `bone.matrixWorld · boneInverse`);
* the **weapon frame** — `weaponNode.matrixWorld` (+y grip→striking end, +z edge / a bow's back), the tip point;
* scored by the pure `PalmWeapon.gripMetrics`: angle between the handle line and the finger axis (90° = across
  the palm through the fist), angle out of the palm plane, which side of the fist the blade leaves (thumb /
  little finger), handle line → palm centre (mm), striking-end elevation / outward / forward share, the blade
  segment's clearance from the holder's body axis, the off hand's gap to the haft;
* checked against the carry rules (`GripStance.checkOrientation`).

BEFORE: on all 17 archetypes the handle ran **along the fingers**: 28° from the finger axis at guard (should be
~90°), 4–32° through most swing beats (the halberd/staff wind-ups were 68–72° but 29–50° OUT of the palm
plane, i.e. through the back of the hand); the reverse dagger left the THUMB side during its wind-up/contact (its π flip
was undone by the wrist), and the halberd/staff wind-ups pointed the end down-and-back (−31°/−73°). 0/17 passed
the rules at any beat. A side close-up confirms it (vision, full-size frame): *"the forearm and the axe handle are
roughly parallel — the handle continues the line of the forearm/fingers"*.

## Cause

1. **The wrist had no anatomy.** The skinned rig has no wrist bone: the hand is rigid on the forearm bone and the
   only "wrist" is the grip group (`rig.setGrip(pitch, roll)` = `rotation.x/z`). `SwingDriver.gripPitch` solved
   `gp = β − λ − θs − θe` (Swing.ts) to hold WHATEVER blade angle β the swing keys or the guard asked for. With the
   guard arm (forearm 46° from vertical) and `GUARD_KEY.blade = 0.35`, that is gp = 2.68 rad: 1.1 rad past the
   hammer grip (π/2 = handle at 90° to the forearm), i.e. the handle swung round until it lay along the fingers;
   the slash wind-up asked 3.6 rad (past the finger line — the blade left the little-finger side).
2. **The pitch axis ignored the hand.** The grip pitch turns about the mount's x axis (the arm plane), but the
   relaxed hand is pronated 0.6 rad (`HAND_PRONATION`): its across-palm axis `w` is 34° out of that plane, so even
   the right pitch put the handle beside the palm line and, once fixed, a correctly gripped blade leaned ~30°
   across the holder's face (guard elevation 58° instead of upright: measured in `wave_v_grip_rig_test`).
3. The no-driver fallback used `PalmWeapon.weaponFromPalm`, which puts the blade ALONG the palm normal (out of
   the back of the hand) — a model that cannot hold a handle.

## The fix

* **Hand mapping** (`PalmWeapon.gripEuler`, pure): the wrist pitch keeps its arm-plane meaning but is read as a
  deviation of the handle INSIDE the hand plane from `w`, clamped to a wrist band (radial 0.35 rad; ulnar 0.75
  rad at the carry, opened to 1.05 rad by the strike's **wrist snap** — `SwingDriver.wristSnap`, late wind-up →
  strike → first half of the recovery); the roll is a bounded forearm twist about `d` (±0.35). The handle
  direction is built in the hand frame (measured once per rig in the grip mount: `RigAdapter.handFrameInMount`,
  stored in `SwingSetup.hand` by `measureAimLine`) and converted to the grip group's Euler, so `rig.setGrip(
  drv.gripPitch(…), drv.gripRoll())` keeps working for the engine AND every harness (anim-report,
  combat_swing_test). `SwingDriver.wristPitch` is the old wanted value (unclamped).
* **Forearm supination** (`RigAdapter.applyForearmTwist`, idempotent, after `rig.update`): a gripping hand turns
  the thumb up. `SwingRig.solveGripTwist` finds per rig the smallest twist that stands the carried blade within
  10° of upright (human 0.540 rad, ork 0.940 rad — the wider-abducted arm needs more); stored on the rig
  (`gripTwistOf`) so `ArmGuard` (solve/apply rewrite elbowR) and any harness that measured the aim line keep it.
* **Reach follows the hand**: `SwingDriver.handSweetDistance` uses the blade the hand can hold (`heldBlade`) at
  every strike sample — with the planar wanted angles the spear's engage distance dropped to 0.81 m and the
  hammer missed the human at engage (measured on `combat_swing_test` before this term).
* **ArmGuard** may move the grip DOFs only ±0.2 rad from the drawn hand (`GUARD_WRIST_SLACK`); past that the
  shoulder/elbow take the correction (a free wrist re-opened the bug whenever the guard fired).
* **Carry rules as data** (`GripStance.GRIP_RULES`), enforced in `swingSetupFor` (only a reverse-allowed
  archetype may take the reverse grip) and by the wanted carry (a bow wants its limbs upright, β = 0, always).
* The fallback path (no swing driver) uses the same hand mapping (hammer grip turned by the skill stance).

## Orientation rules (generated from `GRIP_RULES`)

| archetype | class | carry at guard | reverse allowed | carry band: handle to fingers | strike snap: handle to fingers | guard bound |
|---|---|---|---|---|---|---|
| dagger | finesse | blade DOWN (reverse grip) | yes | 47°..110° | 30°..110° | elev <= -30° |
| shortsword | finesse | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| sabre | finesse | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| rapier | finesse | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| longsword | finesse | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| greatsword | balanced | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| spear | finesse | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| halberd | balanced | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| scythe | balanced | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| staff | balanced | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| axe | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| greataxe | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| mace | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| flail | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| warhammer | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| maul | heavy | striking end UP/OUT | no | 47°..110° | 30°..110° | elev >= 20° (or forward >= 0.7 above -10°) |
| bow | ranged | limbs vertical, string to the body | no | 47°..110° | 47°..110° | elev >= 70°, edge forward |

## Before / after (generated from `artifacts/qa-grip/{before,before-head,after,after-ork}/report.json`)

`BEFORE` = the working tree before the fix (first probe run); `HEAD build` = git HEAD with only the QA hook
added (the same numbers, judged with the final rule set — shows WHY each beat failed). AFTER = human/nomad;
`after-ork` = ork/ironhide, 8 archetypes. Angles in degrees.

| beat | BEFORE (working tree) rule ok | BEFORE mean / worst \|90°−handle↔fingers\| | BEFORE (HEAD build) rule ok | AFTER rule ok (human, 17) | AFTER mean / worst \|90°−handle↔fingers\| | AFTER worst out of palm ° | AFTER ork rule ok (8) |
|---|---|---|---|---|---|---|---|
| guard | 0/17 | 62 / 62.1 | 0/17 | 17/17 | 43 / 43 | 0 | 8/8 |
| windup | 0/17 | 60.9 / 86.1 | 0/17 | 17/17 | 54.3 / 60 | 9.9 | 8/8 |
| contact | 0/17 | 68.7 / 86.1 | 0/17 | 17/17 | 54.4 / 60.2 | 4.6 | 8/8 |
| recover | 0/17 | 70.7 / 81.4 | 0/17 | 17/17 | 41.4 / 43 | 2.5 | 8/8 |

Every row:

| archetype | beat | BEFORE handle↔fingers ° | BEFORE out of palm ° | BEFORE exits | BEFORE elev ° | HEAD-build rule | AFTER handle↔fingers ° | AFTER out of palm ° | AFTER exits | AFTER elev ° | AFTER line→palm mm | AFTER rule |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dagger | guard | 27.95 | 8.39 | little f. | -64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | little f. | -80.79 | 29.07 | ok |
| dagger | windup | 3.89 | 3.45 | thumb | -0.67 | FAIL (handle along the fingers (5° < 30°)) | 69.95 | 4.29 | little f. | -65.07 | 37.32 | ok |
| dagger | contact | 3.92 | 3.6 | thumb | -3.54 | FAIL (handle along the fingers (5° < 30°)) | 69.95 | 4.31 | little f. | -67.49 | 37.32 | ok |
| dagger | recover | 8.56 | 3.62 | thumb | 40.99 | FAIL (handle along the fingers (9° < 30°)) | 69.95 | 0.99 | little f. | -30.16 | 37.32 | ok |
| shortsword | guard | 27.94 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| shortsword | windup | 26.07 | 4.22 | little f. | 69.9 | FAIL (blade out of the little-finger side) | 30.02 | 9.09 | thumb | 56.75 | 19.87 | ok |
| shortsword | contact | 29.02 | 6.09 | thumb | 5.65 | FAIL (handle along the fingers (23° < 30°)) | 29.84 | 1.41 | thumb | 12.53 | 19.77 | ok |
| shortsword | recover | 19.83 | 0.36 | thumb | 44.73 | FAIL (handle along the fingers (23° < 30°)) | 47.03 | 2.36 | thumb | 73.65 | 29.07 | ok |
| sabre | guard | 27.96 | 8.4 | thumb | 64.6 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| sabre | windup | 27.3 | 4.12 | little f. | 71.79 | FAIL (blade out of the little-finger side) | 30.02 | 9.68 | thumb | 51.71 | 19.88 | ok |
| sabre | contact | 25.36 | 3.38 | thumb | 4.38 | FAIL (handle along the fingers (24° < 30°)) | 29.84 | 1.6 | thumb | 13.62 | 19.77 | ok |
| sabre | recover | 21.75 | 0.95 | thumb | 45.16 | FAIL (handle along the fingers (23° < 30°)) | 47.03 | 2.41 | thumb | 72.86 | 29.07 | ok |
| rapier | guard | 27.96 | 8.4 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| rapier | windup | 13.09 | 9.87 | thumb | -1.85 | FAIL (handle along the fingers (13° < 30°)) | 30.02 | 2.29 | thumb | 28.41 | 19.87 | ok |
| rapier | contact | 13.04 | 11.07 | thumb | -4.76 | FAIL (handle along the fingers (13° < 30°)) | 29.84 | 2.28 | thumb | 26.75 | 19.77 | ok |
| rapier | recover | 17.4 | 0.62 | thumb | 49.76 | FAIL (handle along the fingers (19° < 30°)) | 47.03 | 0.76 | thumb | 79.18 | 29.07 | ok |
| longsword | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| longsword | windup | 27.73 | 3.85 | little f. | 73.03 | FAIL (blade out of the little-finger side) | 30.02 | 9.43 | thumb | 54.18 | 19.88 | ok |
| longsword | contact | 30.65 | 6.67 | thumb | 4.52 | FAIL (handle along the fingers (28° < 30°)) | 29.84 | 1.6 | thumb | 6.55 | 19.77 | ok |
| longsword | recover | 19.71 | 0.53 | thumb | 44.9 | FAIL (handle along the fingers (22° < 30°)) | 47.03 | 2.41 | thumb | 74.8 | 29.07 | ok |
| greatsword | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.08 | ok |
| greatsword | windup | 31.11 | 2.86 | little f. | 78.94 | FAIL (blade out of the little-finger side) | 30.02 | 9.88 | thumb | 44.3 | 19.87 | ok |
| greatsword | contact | 26.81 | 3.87 | thumb | 3.25 | FAIL (handle along the fingers (27° < 30°)) | 29.84 | 1.8 | thumb | 8.89 | 19.77 | ok |
| greatsword | recover | 21.81 | 0.88 | thumb | 45.87 | FAIL (handle along the fingers (23° < 30°)) | 47.03 | 2.45 | thumb | 73.91 | 29.07 | ok |
| spear | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| spear | windup | 13.76 | 8.13 | thumb | -1.36 | FAIL (handle along the fingers (13° < 30°)) | 30.02 | 2.28 | thumb | 25.38 | 19.88 | ok |
| spear | contact | 13.05 | 11.22 | thumb | -4.77 | FAIL (handle along the fingers (13° < 30°)) | 29.84 | 2.28 | thumb | 27.01 | 19.77 | ok |
| spear | recover | 17.6 | 0.84 | thumb | 50.75 | FAIL (handle along the fingers (19° < 30°)) | 47.03 | 0.71 | thumb | 79.49 | 29.08 | ok |
| halberd | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| halberd | windup | 72.12 | 49.94 | thumb | -30.53 | FAIL (handle not through the fist; end points down and back (elev -32°)) | 30.02 | 9.88 | thumb | 39.64 | 19.88 | ok |
| halberd | contact | 24.79 | 2.58 | thumb | 3.19 | FAIL (handle along the fingers (23° < 30°)) | 29.84 | 1.8 | thumb | 12.4 | 19.77 | ok |
| halberd | recover | 22.64 | 1.47 | thumb | 46.99 | FAIL (handle along the fingers (24° < 30°)) | 47.03 | 2.43 | thumb | 73.85 | 29.06 | ok |
| scythe | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| scythe | windup | 32.03 | 2.08 | little f. | 80.65 | FAIL (blade out of the little-finger side) | 30.02 | 9.88 | thumb | 39.68 | 19.87 | ok |
| scythe | contact | 25.34 | 2.49 | thumb | 2.04 | FAIL (handle along the fingers (24° < 30°)) | 29.84 | 1.8 | thumb | 12.44 | 19.77 | ok |
| scythe | recover | 22.62 | 1.5 | thumb | 47.17 | FAIL (handle along the fingers (24° < 30°)) | 47.03 | 2.41 | thumb | 73.93 | 29.07 | ok |
| staff | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| staff | windup | 68.17 | 28.8 | thumb | -73.36 | FAIL (end points down and back (elev -76°)) | 30.02 | 0 | thumb | 10.5 | 19.88 | ok |
| staff | contact | 23.5 | 5.7 | thumb | 3.64 | FAIL (handle along the fingers (22° < 30°)) | 29.84 | 0 | thumb | 9.98 | 19.77 | ok |
| staff | recover | 19.41 | 3.14 | thumb | 44.06 | FAIL (handle along the fingers (21° < 30°)) | 47.03 | 0 | thumb | 74.28 | 29.06 | ok |
| axe | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| axe | windup | 28.26 | 3.9 | little f. | 73.61 | FAIL (blade out of the little-finger side) | 30.02 | 9.88 | thumb | 47.48 | 19.87 | ok |
| axe | contact | 23.79 | 2.8 | thumb | 5.51 | FAIL (handle along the fingers (22° < 30°)) | 29.84 | 1.6 | thumb | 14.74 | 19.77 | ok |
| axe | recover | 22.36 | 1.32 | thumb | 45.62 | FAIL (handle along the fingers (24° < 30°)) | 47.03 | 2.43 | thumb | 72.93 | 29.07 | ok |
| greataxe | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| greataxe | windup | 26.16 | 20.32 | little f. | 56.92 | FAIL (handle along the fingers (28° < 30°); blade out of the little-finger side) | 30.02 | 0 | thumb | 5.14 | 19.88 | ok |
| greataxe | contact | 25.34 | 6.83 | thumb | 3.67 | FAIL (handle along the fingers (24° < 30°)) | 29.84 | 0 | thumb | 10.4 | 19.77 | ok |
| greataxe | recover | 18.74 | 2.71 | thumb | 45.92 | FAIL (handle along the fingers (20° < 30°)) | 47.03 | 0 | thumb | 75.71 | 29.06 | ok |
| mace | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| mace | windup | 28.9 | 21.72 | little f. | 69.22 | FAIL (blade out of the little-finger side) | 30.02 | 0 | thumb | 13.58 | 19.87 | ok |
| mace | contact | 19.12 | 2.95 | thumb | 5.2 | FAIL (handle along the fingers (20° < 30°)) | 29.84 | 0 | thumb | 18.26 | 19.77 | ok |
| mace | recover | 20.02 | 3.53 | thumb | 44.3 | FAIL (handle along the fingers (21° < 30°)) | 47.03 | 0 | thumb | 73.49 | 29.08 | ok |
| flail | guard | 27.96 | 8.4 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| flail | windup | 28.44 | 21.49 | little f. | 64.41 | FAIL (blade out of the little-finger side) | 30.02 | 0 | thumb | 6.35 | 19.88 | ok |
| flail | contact | 20.47 | 3.81 | thumb | 5.23 | FAIL (handle along the fingers (21° < 30°)) | 29.84 | 0 | thumb | 12.34 | 19.77 | ok |
| flail | recover | 19.79 | 3.38 | thumb | 44.71 | FAIL (handle along the fingers (21° < 30°)) | 47.03 | 0 | thumb | 74.68 | 29.07 | ok |
| warhammer | guard | 27.96 | 8.4 | thumb | 64.6 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| warhammer | windup | 28.65 | 21.59 | little f. | 65.61 | FAIL (blade out of the little-finger side) | 30.02 | 0 | thumb | 11.61 | 19.87 | ok |
| warhammer | contact | 19.9 | 3.45 | thumb | 5.22 | FAIL (handle along the fingers (21° < 30°)) | 29.84 | 0 | thumb | 17.3 | 19.77 | ok |
| warhammer | recover | 19.87 | 3.43 | thumb | 44.59 | FAIL (handle along the fingers (21° < 30°)) | 47.03 | 0 | thumb | 73.76 | 29.07 | ok |
| maul | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°)) | 47.03 | 0 | thumb | 80.79 | 29.07 | ok |
| maul | windup | 25.99 | 20.23 | little f. | 56.45 | FAIL (handle along the fingers (28° < 30°); blade out of the little-finger side) | 30.02 | 0 | thumb | 5.46 | 19.88 | ok |
| maul | contact | 25.55 | 6.95 | thumb | 3.67 | FAIL (handle along the fingers (24° < 30°)) | 29.84 | 0 | thumb | 10.69 | 19.77 | ok |
| maul | recover | 18.72 | 2.69 | thumb | 46.06 | FAIL (handle along the fingers (20° < 30°)) | 47.03 | 0 | thumb | 75.51 | 29.07 | ok |
| bow | guard | 27.95 | 8.39 | thumb | 64.59 | FAIL (handle along the fingers (29° < 47°); bow limbs not vertical (elev 65°)) | 47.03 | 0 | thumb | 80.79 | 29.06 | ok |
| bow | windup | 13.01 | 10.63 | thumb | -1.96 | FAIL (handle along the fingers (13° < 47°)) | 86.8 | 4.56 | thumb | 75.86 | 39.67 | ok |
| bow | contact | 13.05 | 11.17 | thumb | -4.77 | FAIL (handle along the fingers (13° < 47°)) | 88.23 | 4.58 | thumb | 76.18 | 39.71 | ok |
| bow | recover | 16.9 | 0.26 | thumb | 49.57 | FAIL (handle along the fingers (18° < 47°)) | 50.58 | 0.78 | thumb | 79.95 | 30.68 | ok |

The handle line passes through the anatomical grip anchor (0.0 mm in every sample) and 27–37 mm from the palm
centre (the anchor sits at 0.45 of the hand length, the palm centre at 0.25: the handle lies across the root of
the fingers, where a fist closes).

## Visual checks (full-size frames; contact-sheet cells are too small for a reliable verdict)

| frame | verdict (vision, asked about one feature) |
|---|---|
| `artifacts/qa-grip/before-head/axe-guard-hand-side.png` | "forearm and the axe handle are roughly parallel — the handle continues the line of the forearm/fingers" |
| `artifacts/qa-grip/after/greataxe-guard-hand-side.png` | "the forearm and axe handle are crossing … the vertical handle passes through the grip across the palm; head up" |
| `artifacts/qa-grip/after/mace-guard-hand-front.png`, `mace-contact-hand-side.png` | "(a) passes through the closed fist across the palm" |
| `artifacts/qa-grip/after/dagger-guard-hand-side.png` | "handle inside the closed fist across the palm; blade points downward out of the little-finger side (reverse grip)" |
| `artifacts/qa-grip/after/warhammer-guard-front.png` | "upright, head at the top, beside the head, not crossing the face; nothing clips" |
| `artifacts/qa-grip/after/sheet-ranged.png` (bow) | "limbs vertical in every column, held at its middle in the fist" |
| `artifacts/qa-grip/after/spear-contact-hand-side.png` | "shaft passes through the closed fist; points forward and upward" |
| an intermediate build without the supination | "the axe handle runs diagonally across the upper body … the head partly obscured" (the pronation lean) |

Contact sheets (rows = archetypes; columns = guard/contact × full front / hand side close-up / hand front
close-up, orbit target = the grip point): `artifacts/qa-grip/after/sheet-{finesse,balanced,heavy,ranged}.png`,
the ork: `artifacts/qa-grip/after-ork/sheet-*.png`, before (HEAD): `artifacts/qa-grip/before-head/sheet-*.png`.
`debugView({ orbit: { …, target: "hand" } })` frames the weapon hand.

## Tests and gates

* `tests/wave_v_grip_rules_test.ts` (pure, 7): fuzzed hand mapping (2000 wanted wrists × 2 hands: unit handle,
  never past the band, never out of the palm plane beyond the twist bound, always the thumb side); the neutral
  grip = `w` exactly; Euler round trip + a plain hand reproduces the old pitch inside the band; every archetype
  has a rule and only the dagger may be reversed (a forged reverse axe is held forward); the carry at guard and
  through every frame of every archetype's swing on a planar supinated forearm; `checkOrientation` flags each
  failure it names; the pure default supination equals `HAND_PRONATION`.
* `tests/wave_v_grip_rig_test.ts` (lane A's real skinned rig, no browser, 3): all 17 archetypes × 4 beats on a
  human — through the fist, the handle line through the grip anchor (< 1 mm) and ≤ 45 mm from the palm centre,
  guard handle 45–110° to the fingers, the rules; an ork for 5 archetypes; the control: without the forearm
  supination the guard blade leans across the body (57.8° vs 82.5°) with the same in-hand angle.
* `tests/anim_swing_test.ts`: ONE line changed (not a lane-G file): the carry assertion reads
  `d.wristPitch(…)` (the wanted wrist it always pinned) because `gripPitch` now returns the hand-mapped Euler.
* Gates: `deno task check` 0 errors; `deno lint` of every lane-G file clean (the repo's one lint problem is
  `tools/probe-ui-all.ts:9` `no-import-prefix`, not lane G); `deno task test`: **1701 passed, 1 failed** —
  `anim_measure_test` "ork/ironhide thrust exhausted: hand −0.9 mm inside the torso". It is NOT lane G: the same
  measurement with every lane-G file reverted to HEAD (a copy of the working tree) fails identically (and also
  fails dwarf/mountain slide 5.62 mm, which passes with lane G). It comes from the body/anim lanes' in-progress
  work. `combat_swing_test` (engage contacts, stop-on-contact) and `combat_selfguard_test` pass.
* Clipping on anim-report's own meter (`measureSwing`, fresh, 4 races × 3 kinds), HEAD vs now: weapon–own-torso
  minimum 62.9 → 89.8 mm (no case inside); anim-report's frame loop does not apply the forearm twist (see gaps).

## Gaps (honest)

* **Two-handed off hand is not on the haft**: 225.96–484.54 mm from the handle line over 36 samples. The arm
  joints are single-axis (no adduction), so the left hand cannot reach the right arm's plane; it needs a lateral
  shoulder DOF (body/anim lanes). Unchanged by this lane.
* **Thrusts point up**: the thrust keys keep the forearm about level (Swing.ts, anim lane), so even with the snap
  the point rises 22–28° at contact (rapier/spear). A level thrust needs the hand path to drop the hand below the
  elbow (forearm ~45° down-forward) — a suggestion for the anim lane, not applied.
* The handle sits at the band's edge (47° to the fingers) at guard on every weapon: the guard arm (anim lane's
  GUARD_POSE) holds the forearm 46° from vertical, so an upright blade needs the full ulnar range. A more upright
  guard forearm would centre the handle at ~90°.
* `tools/anim-report.ts` (another lane's file) calls `rig.update` → `rig.setGrip` without the forearm
  supination; to mirror the engine add `applyForearmTwist(rig, sk.joint("elbowR").angle, gripTwistOf(rig))` after
  `rig.update` in its swing loop (one line; not applied — not a lane-G file).
* The rewind on contact lerps joint angles without the body's yaw/step between frames; with the blade now rigid
  in the fist the contact frame can sit a few cm deep for one frame (combat_swing_test: 3.5 cm, bound 5 cm).
* The flail's chain is rigid, so its ball stands up at guard like a mace head (weapon-model limitation).
* The ork elbow shows a pinched crease in side close-ups with or without the supination (body geometry).
