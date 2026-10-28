# Lane C2 — Motion on lane A's real skinned rig (R04 + the soles half of R03)

**Outcome.** On lane A's real rig (human / elf / dwarf / ork), driven exactly like `Engine.#updatePose` + the driven
placement block, at 60 Hz: the lowest heel / ball / toe-tip sole point over idle, walk 2.1, run 6.5, strafe 6.5,
backpedal 6.5, engaged forward 6.5, AI 4.2, turn-in-place, attack and the Reaver's Charge dash went from
**−20.87 cm → −0.18 cm** (worst over 4 races × 10 scenarios); planted-sole gap **6.97 → 0.53 cm**; planted slide per
stance **9.98 → 1.27 cm**; human walk-start `rootOffsetY` **−0.254 → −0.110 m**; run trunk lean **20.9° → 10.6°** max;
head never tilts back more than 5.4° outside skills (was 10.2°). 35/35 lane tests pass (24 old + 11 new, 7 of them on
the real rig). **No Engine.ts or Skeleton.ts patch is needed.**

## 1. Vision claims vs FK numbers (human, 60 Hz, `scratch/laneC2/vision.ts`, engaged walk 2.1 m/s and run 6.5 m/s)

| Claim | Verdict | Numbers (before = HEAD 8d53c0a, after = this lane) |
|---|---|---|
| Front knee bends forward | **Confirmed** | knee forward of its hip-ankle line on every frame, both legs |
| Trailing knee reads REVERSED | **Refuted** (FK) | trailing-leg frames (ankle ≥ 2 cm behind the hip): 137 walk / 166 run before; knee BEHIND the ankle: **0**; trailing knee − ankle (forward) min **+15.2 cm** walk, **+14.0 cm** run. Knee offset from the hip-ankle line, all legs/frames/races/scenarios: min **+4.2 cm** before, **+4.3 cm** after; never < 0. What the vision model most likely saw: the landing/trailing foot pushed 5-21 cm INTO the floor (see §2-1/2-3), which hides the foot and makes the shin read as ending in front of the knee. |
| Torso leans BACK walking forward | **Refuted for forward walk/run**, confirmed for backpedal and skills | chest (mid-hip→neck vs bind) walking forward: before +5.1° median (min −0.7° on the first frame), run +6.7° median but **+20.8° max** (acceleration lean); after walk +4.8° median / max 9.0°, run max 10.6°. Leaning back really happened in the **backpedal** (−17.8° before → −0.4° after), the **basic attack** (−15.9 → −12.3°, authored ATTACK_POSE) and **skills** (dash −22.6 → −20.9°, authored in `Skills.strikeTracks`, see §6). `+spine/+abdomen/+neck/+head` all tilt toward the face on this rig (`signs.ts`: spine 0.3 → trunk +15.2°, head +17.2°), so RIG_ROTATION_SIGN for the trunk is right and was NOT changed. |
| Head tilts back walking forward | **Confirmed (mild)** | head pitch walk −2.0° median / −4.2° min (engaged walk −1.7° median), run −6.7° min, backpedal −10.2° min. Cause: neck+head cancelled 90 % of `spine + abdomen`, but on this tree the neck hangs off the SPINE pivot, so the head's world pitch is `spine + neck + head` — the abdomen share was over-cancelled. After: walk +0.66° median (engaged +0.35°), run within [+0.5°, +6.2°], backpedal −5.4° min. |
| Arms both forward | accepted (engaged guard layer) | not engaged: corr(shoulderL, hipR − hipL) = **−0.93** walk, −0.90 run (contralateral swing) |
| 21 cm pelvis drop at walk start | **Confirmed** | engaged walk start `rootOffsetY` min **−0.254 m** before (standing −0.035) → **−0.110 m**; human mid-hip min walk 0.847 → 0.870 m, run 0.811 → 0.884 m (standing 0.925) |

The browser's soleGap observations reproduce headlessly before the fix (human, sole points): standing +0.20 cm
(browser +0.2..+0.3), run −15.7 cm, strafe −20.9 cm, backpedal −6.6 cm, AI 4.2 m/s −11.3 cm.

## 2. Root causes found (each measured, then fixed)

1. **Hip flexion clamp drives the landing foot into the floor** (run −15.7 cm). The swing leg near touchdown wanted
   > 1.2 rad of hip flexion (pelvis tilted 0.4 rad by the trunk lean + a far landing spot); the Skeleton clamps the hip
   after the IK, which swings shin + foot down and back. Fix: limit-aware IK `respectHipLimit` (height first).
2. **Pelvis tilt ate the hip range**: lean was split 0.6/0.4 onto spine/abdomen, i.e. pelvis pitch = full lean (up to
   0.4 rad with the 0.5·atan(a/g) acceleration lean at 54 m/s²). Fix: the chest (spine) takes the lean, the pelvis
   keeps `pelvisLeanShare` = 0.3 of it, `pelvisTiltMax` 0.4 → 0.2, total lean capped at `leanMax` 0.26 rad (15°),
   backward at `leanBackMax` 0.1 rad; backpedal has no steady back lean.
3. **Clamped hip abduction projected the ankle below its target** (strafe −20.9 cm): closest-point projection onto a
   roll-clamped leg plane sinks the ankle by sin ρc·ρ·sin(ρ−ρc). Fix: in-plane depth `y_p / cos ρ` (height first,
   the miss becomes lateral).
4. **Lane A binds the legs abducted (legAbduction 0.04-0.16 rad) and the rig adds hipRoll on top**; the IK ignored it
   (idle +0.2 cm, −1.4 cm at 0.3 rad roll). Fix: `LegGeometry.hipRestRoll`, total roll in the IK, `standingSoleDepth`
   with L·cos r0.
5. **Toe joint lagged under the pop guard** (planted toe tip −2.3 cm at a 0.46 rad push-off roll). Fix: the toe passes
   through with the leg; swing legs pass through ≥ `swingPassThrough` 0.7 (pop-guard lag dipped a swing foot 1.6 cm).
6. **Landing anticipation measured from the wrong body position** (drop pinned at the 0.2 L = 16 cm cap at 4.2-6.5
   m/s): the landing spot was seen from where the body is now, ~v·timeLeft = 0.65 m farther than at touchdown. Fix:
   `FootState.toGoX/Z`, the animator anticipates `land − toGo`.
7. **Hovering / permanently late swings**: a duty factor that shrinks while speeding up moved φ back into the swing
   window and the foot skimmed the floor for a whole cycle (0.3 s); short-legged fast strafes had every swing shorter
   than `minSwingTime` and locked into a late cycle. Fixes: `overdue` latch, `minStanceTime` 0.05 s, phase re-sync on a
   late touchdown, and a stride floor `λmin = min(v·T/(1−β0), S + v·T)` so every swing fits `T = 1.15·minSwingTime`.
8. **Strides ignored direction**: strafing/backpedalling used the forward stride (3.5 m at 6.5 m/s). Fix: stance
   half-angle on an ellipse (forward 0.45, back 0.3 = hip extension, lateral 0.24 = 0.8 × adduction limit); stride
   scales with it. The guard stagger now fades with `moving` (it demanded extra reach while running).
9. **Toe tip / heel of the foot model did not match lane A's foot** (2 cm toe error on steep compound poses). Fix:
   from the real bones — toe tip = toe bone TAIL inset like lane A's sole point, toe pivot height = toe bone head above
   the sole, heel = (0.16/0.75)·(tip − ankle). `legFK3` returns the toe tip; model vs rig ≤ 1 cm (tested).
10. **Skill-owned legs floated**: with the legs on the skill curve `rootOffsetY` faded to 0 and the dash pose hung
    from the bind height — lowest sole 15.6 cm above the floor mid-dash (trace t = 0.717 s). Fix: step 8 — legs the gait does not own put the lowest sole of the FINAL pose on the floor (lane A's
    `soleOffset` rule), with a lift-only guard through the handover.
11. **Ankle roll applied in the wrong order by SkinnedHumanoid.update** (`rest·Rz(roll)·Rx(pitch)` for the ankle too):
    on the 0.15 rad-abducted ork the planted ball slid 2.09 cm per stance. The counter-roll must be innermost (Euler
    XYZ, what lane C's model and the legacy rig assume): `Rz(r)·Rx(φ)·[Rx(−φ)·Rz(−r)] = I`. After: 0.34 cm.
12. Last line: step 9 sole guard — the root is lifted if any heel/ball/toe tip of the final pose is below the ground
    under it (one-frame transients hover instead of sinking).

## 3. Before / after (worst over human, elf, dwarf, ork; `scratch/laneC2/report.ts`; sole points = lane A's 8 points; skin = lowest CPU-skinned foot vertex)

| scenario | min sole pt [cm] | min skin [cm] | max planted gap [cm] | max slide/stance [cm] | min knee fwd [cm] | trunk [min,max] ° | min head ° |
|---|---|---|---|---|---|---|---|
| idle | 0.06 → −0.00 | 0.06 → −0.00 | 1.02 → 0.00 | 0.03 → 0.00 | 9.0 → 9.0 | [−1.2,0] → [−1.2,0] | 0 → 0 |
| walk 2.1 | −3.16 → −0.18 | −2.97 → −0.22 | 1.53 → 0.18 | 3.11 → 0.34 | 8.4 → 6.6 | [−0.7,10.5] → [−0.7,9.9] | −4.4 → 0.5 |
| run 6.5 | −15.74 → −0.18 | −15.14 → −0.23 | 2.50 → 0.18 | 4.42 → 0.27 | 4.3 → 4.5 | [−0.7,20.9] → [−0.7,10.6] | −6.7 → 0.5 |
| strafe 6.5 | −20.87 → −0.10 | −20.85 → −0.06 | 6.97 → 0.10 | 3.49 → 1.27 | 4.3 → 6.4 | [3.6,4.5] → same | −2.6 → −1.6 |
| backpedal 6.5 | −6.57 → −0.09 | −6.78 → −0.03 | 0.97 → 0.53 | 5.03 → 0.37 | 4.3 → 4.3 | [−17.8,3.5] → [−0.4,4.5] | −10.2 → −5.4 |
| fwd engaged 6.5 | −14.08 → −0.09 | −13.75 → −0.23 | 2.54 → 0.09 | 4.83 → 0.20 | 4.3 → 4.5 | [3.8,21.5] → [3.8,11.9] | −2.4 → −1.5 |
| AI 4.2 engaged | −12.29 → −0.13 | −11.75 → −0.23 | 2.27 → 0.13 | 4.58 → 0.30 | 4.2 → 4.9 | [3.8,19.3] → [3.8,12.7] | −2.4 → −1.5 |
| turn 2 rad/s | −0.90 → −0.00 | −0.87 → −0.00 | 1.75 → 0.00 | 9.98 → 0.03 | 8.5 → 8.5 | [−1.2,1.1] → same | 0 → −0.5 |
| attack | 0.04 → −0.00 | 0.05 → −0.00 | 0.99 → 0.00 | 1.14 → 0.00 | 9.4 → 10.0 | [−15.9,3.5] → [−12.3,3.5] | −3.6 → −3.6 |
| dash (skill) | −3.53 → −0.18 | −3.50 → −1.00 | 1.03 → 0.18 | 1.84 → 0.43 | 4.5 → 4.5 | [−22.6,3.6] → [−20.9,3.6] | −12.8 → −11.7 |

Pelvis (e), human mid-hip above the floor (standing 0.925 m): walk min 0.847 → 0.870, run 0.811 → 0.884, strafe
0.814 → 0.886, backpedal 0.811 → 0.852; `rootOffsetY` min walk −0.186 → −0.146, run −0.263 → −0.115. Other races
after (standing / walk min / run min): elf 0.953/0.903/0.910, dwarf 0.816/0.779/0.784, ork 0.973/0.923/0.928.
Full per-race stats (min/p5/median/mean/p95/max): `scratch/laneC2/before-<race>.txt`, `after-<race>.txt`.

## 4. Files changed (only lane C2 files; `SkinnedHumanoid.ts` only inside `update()`)

- `src/game/anim/FootIK.ts`
  - `export interface LegJointLimits { hipMin: number; hipMax: number; kneeMin: number; kneeMax: number }`
  - `export function respectHipLimit(targetY: number, targetZ: number, chain: TwoBoneChain, lim: LegJointLimits, ik: TwoBoneResult): boolean`
  - `solveLegInPelvis(dx, dy, dz, pelvisR, footPitch, groundPitch, chain, rollMin, rollMax, out, ik = IK, limits?: LegJointLimits, restRoll = 0): LegSolution` — roll window is the TOTAL plane roll; `out.roll = total − restRoll`; height-first depth; residual = lateral miss.
  - `LegSolution.limited: boolean` (hip limit re-solve happened).
- `src/game/anim/Rig.ts`
  - `LegGeometry` + `hipRestRoll?: readonly [number, number]`, `toeForward?: number`, `toePivotHeight?: number`
  - `export function hipRestRollOf(g: LegGeometry, side: Side): number`, `export function toeForwardOf(g: LegGeometry): number`
  - `LegFK3.toe: Float64Array` (toe-tip sole point); `legFK3` applies `hipRoll + hipRestRoll`.
  - `standingSoleDepth`: `(thigh + shin)·cos(hipRestRoll)`; `legGeometryFromBones` derives heelBack, hipRestRoll [L, R], toeForward, toePivotHeight from the bones (signature unchanged).
- `src/game/anim/Gait.ts`
  - `GaitParams` + `maxStanceAngleLateral` 0.24, `maxStanceAngleBack` 0.3, `minStanceTime` 0.05, `swingTimeMargin` 1.15
  - `export function stanceAngleFor(p: GaitParams, lateral: number, back = 0): number`
  - `gaitShape(speed, leg, p?, out?, slopePitch = 0, lateral = 0, back = 0): GaitShape` (direction-scaled stride + stride floor)
  - `GaitInput.hipShift?: number`; `FootState` + `overdue`, `toGoX`, `toGoZ`, `stanceTime`; touchdown phase re-sync.
- `src/game/anim/Animator.ts` (`AnimatorInput`/`AnimatorOutput` unchanged)
  - `AnimatorParams` + `pelvisLeanShare` 0.3, `leanMax` 0.26, `leanBackMax` 0.1, `swingPassThrough` 0.7; `pelvisTiltMax` 0.4 → 0.2.
  - chest-led lean, head cancels the chest only, toe pass-through, hip/knee-limited IK with rest roll, hip-shifted rest
    spots, `toGo` landing anticipation, guard stagger fades with motion, step 8 (skill-owned legs grounded by the lowest
    sole of the final pose) and step 9 (lift-only sole guard). Still no per-frame allocation.
- `src/graphics/body/SkinnedHumanoid.ts` — `update()` body only: hip `rest·Rz(roll)·Rx(pitch)` (unchanged), ankle now
  `rest·Rx(pitch)·Rz(roll)`. Applied with `patch`; lane A2's concurrent edits (import + `cachedBody`) are intact.
- Tests: `tests/anim_realrig_test.ts` (new, 7 tests on lane A's real rig, all 4 races: invariants (a)-(e), model-vs-rig
  foot geometry, ankle-roll order); `tests/anim_footik_test.ts` +2 (`respectHipLimit`, height-first roll clamp);
  `tests/anim_gait_test.ts` +2 (direction strides + swing-time floor; keyboard start: no hovering swing, phase re-sync).
  Run against the untouched HEAD tree, 6 of the 7 real-rig tests FAIL (only (c) passes — knees were never reversed).

## 5. Engine.ts / Skeleton.ts

**No patch required.** The animator's inputs/outputs and the engine's placement block are unchanged; the new
behaviour lives in the animator and in `SkinnedHumanoid.update`. `deno check src/engine/Engine.ts` → exit 0.

## 6. Commands (real output)

```
$ deno check src/game/anim/*.ts src/graphics/body/SkinnedHumanoid.ts tests/anim_*_test.ts   -> check exit=0
$ deno lint src/game/anim/ tests/anim_*_test.ts (5 files)                                     -> Checked 14 files
$ deno test --allow-read --allow-write=/Users/macmax/.hermes/cache/scratch tests/anim_*_test.ts
running 7 tests from ./tests/anim_animator_test.ts ... 4 ... anim_blend ... 9 ... anim_footik ... 8 ... anim_gait ... 7 ... anim_realrig
real rig (a): no heel, ball or toe tip sinks more than 1 cm — every race, every scenario ... ok (1s)
real rig (b): planted soles within 1 cm of the ground, planted balls slide <= 2 cm per stance ... ok
real rig (c): knees always bend forward (never behind the hip-ankle line), both legs, every frame ... ok
real rig (d): the chest leans forward 0..15° walking and running; the head stays within ±8° ... ok
real rig (e): no spurious crouch — the pelvis stays within its dip budget of the standing height ... ok
real rig: Rig.legFK3 (ball, heel, toe tip) matches lane A's sole points within 1 cm for compound poses ... ok
real rig: hip roll + ankle counter-roll keep a flat sole level on a pitched leg (ankle roll innermost) ... ok
ok | 35 passed | 0 failed (1s)
```
Harness (scratch, not in the repo): `/Users/macmax/.hermes/cache/scratch/laneC2/` — `harness.ts` (Engine-exact drive +
world metrics), `report.ts`, `trace.ts`, `vision.ts`, `drop.ts`, `lat.ts`, `modelcheck.ts`, `static.ts`, `signs.ts`,
`render.ts`. Because lane A2 edited `src/graphics/body` concurrently (its tree was briefly broken: `earNodes is not
defined`), the harness ran on frozen mirrors: `base/src` = git 8d53c0a (BEFORE), `head/src` = 8d53c0a + this lane's
anim files + the `update()` change (AFTER). The repo tests above ran on the LIVE tree (with A2's edits).

## 7. Renders (side view, character faces left, legs tinted L red / R blue, 4 frames = one gait cycle at t ≥ 1.6 s)

- `/Users/macmax/.hermes/cache/scratch/laneC2/walk_before.png`, `walk_after.png` (human, walk 2.1 m/s)
- `/Users/macmax/.hermes/cache/scratch/laneC2/run_before.png`, `run_after.png` (human, run 6.5 m/s)

Numbers per tile (`render-before.txt` / `render-after.txt`; ground row 405): walk before lowest skin +0.15..+0.17 cm,
head −2.0..−2.2°, trunk 5.0..5.3°; walk after lowest skin 0.00..+0.02 cm, head +0.6..+0.7°, trunk 4.8..5.0°, knees
11.4..26.7 cm forward. Run before: one tile −0.30 cm (row 405) and two airborne tiles, head −2.6..−3.5°; run after:
contact tiles +0.01/+0.03 cm, flight tiles +8.6/+11.4 cm, head +0.6..+0.8°. Steady-state walking was already close
before; the defects live in starts, high speeds, strafes, backpedals and skills (§3). Not viewed by me (no vision).

## 8. Open issues / risks

1. **Skill curves lean the chest BACK** at the strike (`Skills.strikeTracks`: `spine = torso < 0`, e.g. Reaver's
   Charge −0.35 rad while lunging forward) and `ATTACK_POSE` (spine −0.2). Measured −20.9° / −12.3°. If the authors
   meant "lean into the strike", flip the sign of `torso` in strikeTracks (not my file) — a design call for the parent.
2. During a skill that owns the legs the feet follow the curve and **skate** with the 3.2 m lunge (inherent); the
   skinned foot can dip 1.0 cm while the sole points stay at −0.18 cm (rounded skin below the inset sole points).
3. Hip flexion is still capped at 1.2 rad by the Skeleton: at a sprint landing the step lands short instead of
   sinking (`LegSolution.limited`, foot not claimed planted). Widening the hip window in `defaultHumanoid` would help.
4. Backpedal/strafe from a standstill at 54 m/s² dips the pelvis ~0.11 L for a few frames (test budget 0.12 L);
   strafe planted slide up to 1.6 cm (dwarf). No foot yaw, no spine twist (lane C issue 5 stands).
5. The sole guard (step 9) can hover a planted foot by the deficit on a transient frame (measured planted gap ≤ 0.53 cm).
6. The heel/toe ratios in `legGeometryFromBones` encode lane A's foot (heel 0.25·foot behind the ankle, sole insets
   0.09/0.04·foot). If lane A2 changes the foot, the model-vs-rig test (`anim_realrig_test.ts`) will catch it.
7. `tests/anim_realrig_test.ts` imports the live `src/graphics/body/*`; if lane A2's tree is mid-edit it fails for
   their reason, not this lane's.
8. Not run: the browser, any build, whole-tree `deno task check/test`.
