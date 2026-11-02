# Wave X — lane L messages (requests for files lane L does not own)

## 1. Lane B / parent: render the foot turn-out (src/graphics/body/SkinnedHumanoid.ts)

**What.** Lane L added `Skeleton.legRoll.toeOut: Float64Array(2)` — each foot's turn-out MAGNITUDE in
rad (+ = toes outward, default `FootTurnout.TOE_OUT_RAD` = 9°, written every frame from
`AnimatorOutput.toeOut` via `skeleton.drive(angles, hipRoll, ankleRoll, toeOut)`; an undriven
skeleton rests at 9° too). The game-side model (`Rig.legFK3`, `Measure.footWorld`, the Animator's IK
ankle target) turns the foot about the **VERTICAL through the ankle** by
`yaw = FootTurnout.toeOutYaw(hipLateral[side], toeOut[side])` (sign of that hip's local x · magnitude, so
each foot turns toward its own side): sole heights and pitch are exactly unchanged, and the IK places
the ankle so the turned-out ball lands on the planted spot. Measured planted slide idle 0.0 -> 0.1 mm,
guard 0.2 -> 0.7 mm, walk 2.4 -> 2.7 mm; every existing anim/real-rig band passes.
(Rejected, measured: about the shin = outermost, walking ball slide 2.4 -> 8.4 mm; about the foot's own
up axis = innermost, the guard's lateral tilt leaked into sole pitch 0.004° -> 0.71°.)

**Where.** `SkinnedHumanoid.ts` `update()`, after the joint loop has written every bone's local
quaternion (so the ankle's parent chain is final), per ankle bone:

```ts
// imports: import { toeOutYaw } from "../../game/anim/FootTurnout.ts";
// once: const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qY = new THREE.Quaternion();
//       const hipX = [bones.get("hipL")!.position.x, bones.get("hipR")!.position.x]; // or plan.bones head[0]
for (const side of [0, 1] as const) {
  const yaw = toeOutYaw(hipX[side], sk.legRoll.toeOut[side]);
  if (yaw === 0) continue;
  const ankle = bones.get(side === 0 ? "ankleL" : "ankleR")!;
  ankle.parent!.updateWorldMatrix(true, false);
  ankle.parent!.getWorldQuaternion(qP);                 // parent's world rotation
  // local' = P⁻¹ · Ry_rig(yaw) · P · local  (a yaw about the RIG's vertical, i.e. the group's +y)
  qY.setFromAxisAngle(Y_AXIS, yaw);
  // rig-space parent rotation = group⁻¹ · parentWorld, so the yaw is about the rig's own up axis:
  const qG = rig.group.getWorldQuaternion(qW).clone().invert();
  const Prig = qG.multiply(qP);
  ankle.quaternion.premultiply(Prig.clone().invert().multiply(qY).multiply(Prig));
}
```

(`toe` bones are children of the ankle and follow.) The legacy `src/graphics/Humanoid.ts` ankle pivot
needs the same. Verify with `tests/anim_realrig_test.ts` and `tests/wave_v_pose_idle_test.ts` (they pass
today because they read the game-side model) and measure heel->toe yaw on the RENDERED sole points
(expect ~9° each side).

**Why.** Brief item 10 ("feet point a bit more outward by default"). Until this lands the numbers
are right in the game model but the screen still shows straight feet.

## 2. tools/gen-spec-tables.ts: column header `WIL`

Line 22 prints `"WIL"`; after the rename it should read `"FOC"` (the column reads `focus`). Not lane L's
file. (`grep -ri willpower src tests tools` is empty — pinned by SPEC X16 in tests/wave_x_agility_test.ts.)

## 3. tools/anim-report.ts: DONE by lane L (one token, please keep)

`footWorld(..., out.hipRoll[i], out.ankleRoll[i], out.toeOut[i])` (line 331). The harness measures
lane L's Animator; without the toe-out it measured a foot the Animator no longer plants (the IK now
places the ankle so the TURNED-OUT ball lands on the gait's target), and tests/anim_measure_test.ts
read a false slide. Not in lane L's ownership table — flagging it so the parent can accept or move it.

## 4. Noted, not lane L: `deno task check` / suite failures in other lanes' files

- `tools/probe-wave-x-ui.ts:202` TS2769 (Buffer passed to crypto.subtle.digest) — lane U. (An earlier
  `HairQaPage.ts` TS2459 was fixed by its owner during this lane.)
- `tests/spec_test.ts` SPEC LL3 and `tests/menu_creator_test.ts` expect SIX primaries on the creator
  sheet; lane U's sheet now shows seven (Agility). The pins need `=== 7` / the Agility label (U/parent).
- `tests/portraitstudio_test.ts` OA6 "PreviewScene.ts uses no Math.random" — lane B's PreviewScene.

## 5. For lane U (display only)

- `agilityFactors(agility)` takes the SHEET scale (Leveling, 1.0 at 10). For a runtime `CombatStats`
  use `agilityOf(stats)` / `effectiveAgility(stats)` (runtime + 6 − body-mass drag).
- `INFLUENCES` (src/game/Influence.ts) is ready for a read-only panel: `dir` up/down/side, `sign`,
  `weight` 0..1 (display only), `why`.
