# Wave GEN — lane K (animator + kinematics): C-AGI

Agility-scaled joint limits, the balance disk, the Skeleton stage's node-and-disk skeleton and T-pose, and an
animation audit of every clip the game plays on the real skinned rigs, with the worst offenders fixed.
Every number in the tables below is generated from the JSONs by
`deno run -A tools/audit-animations.ts --write-doc` (this narrative is `docs/wave-gen/kinematics-notes.md`;
SPEC G57 fails when the tables drift from the JSONs).

## Reproduce

```
deno run -A tools/audit-animations.ts --out artifacts/wave-gen/anim-audit-after.json         # this tree (~75 s)
# before = HEAD 6a5f588 (git archive to a scratch dir; copy tools/audit-animations.ts + src/game/anim/{BalanceDisk,AgilityLimits}.ts in):
#   deno run -A tools/audit-animations.ts --out <repo>/artifacts/wave-gen/anim-audit-before.json
# K only = the same scratch + lane K's files (Skeleton, anim/{Animator,AgilityLimits,BalanceDisk,SkeletonDisks},
#   combat/{SelfGuard,OffHand}, body/SkinnedHumanoid):  --out artifacts/wave-gen/anim-audit-after-k-only.json
deno run -A tools/audit-animations.ts --agility-report                                         # anim-agility.json
deno run -A tools/audit-animations.ts --write-doc                                              # this file
deno run -A tools/audit-animations.ts --bodies ork --clips swing:spear --trace                 # per-frame pops/slides
deno test -A tests/wave_gen_kinematics_test.ts                                                 # SPEC G40-G59
```

## The audit (tools/audit-animations.ts)

Bodies: human, elf (wood), dwarf (mountain), ork (ironhide) x male/female (8 rigs, `buildSkinnedHumanoid`).
Clips (55 per body, 61 measured groups): idle, guard, block, walk 2.1 m/s, run 6.5, strafe 6.5, backpedal 6.5,
turn (orbiting rival); one swing per weapon archetype (17, the archetype's own weapon and lane M style); every skill
(8 dash, 8 power = "cast", 8 defense); shove (brace/impact/recoil), stagger, stumble; falls back/front/side, each
measured as `fall` (stagger + falling), `lie` (down) and `rise` (rising + 1 s after). Non-swing clips carry the
two-handed longsword (the off hand and the convergence are exercised).

Frame order = the engine's (`Engine.#swingTick` -> `#updatePose` -> rig loop -> `#strikeTick`), 60 Hz:
SwingDriver.advance/takeStep -> Animator.update -> bodyShift -> Skeleton.drive(.., wideLimits) -> rig.update ->
forearm supination -> grip (swing wrist blended with the skill stance) -> placement (`rotation.set(0, yaw, roll)`,
`applyRootTilt`) -> two-hand grip (not while a fall owns the body) -> `settleOnFloor` -> ArmGuard + off-hand re-seat.
The rival stands still at the swing's sweet distance and no contact is resolved (a whiff plays the full curve).

Meters: joint pop (largest Skeleton angle change per frame), bone pop (largest LOCAL rotation of any rig bone per
frame, so render-side edits count), planted-ball slide within a stance (`AnimatorOutput.feet[i].planted`), lowest
skin point (every 6th vertex, linear-blend skinned, after the settle), forearm/hand capsules into chest/abdomen/pelvis
and thigh into thigh (the fitted combat capsules, `Hitboxes.hitboxesFromPlan`, beyond the same body's standing idle
with a one-handed carry), the weapon's features into the holder's own capsules after the engine's ArmGuard
(`SelfGuard.selfPenetration`). Pop bound 0.4 rad/frame: just above the Animator's own joint-speed limit
(0.393 rad/frame for every body), which the fastest strikes reach by design.

Q1's independent baseline (board Z-19, own driver, every vertex) agrees on the fall slide and the strafe knee pop;
it notes the stride-6 skin meter can hide a millimetre or two of a walking sole sink (Q1 reads every vertex).

## Fixes (each measured by the audit; worst first)

1. **Two-handed off arm flicker** (the bone-pop column: walk, guard, every skill and fall with a
   longsword/greatsword/polearm). Three causes, three fixes:
   - `combat/SelfGuard.gripExcluded` counted a hand-and-a-half weapon (longsword, hands 1.5) as ONE-handed while
     `Profile.profileTerms` and `SwingDriver` hold it with two hands (`hands >= 1.5`): the engine's ArmGuard pushed the
     blade out of the off hand holding it, every frame (the weapon column of `move`/`stand`). Now the same rule.
   - `combat/OffHand`: the weapon arm's convergence (a constrained bisection) and the off hand's grip weight
     (reach / torso thresholds) jumped between frames; both are rate-limited on the rig's frame clock
     (`CONVERGE_RATE` 12 rad/s, `HOLD_RATE` 5/s) and the drawn off arm may turn at most `OFF_ARM_RATE` 20 rad/s
     from what was drawn last frame (the IK's elbow plane / forearm twist flips near a singular reach).
   - `SkinnedHumanoid`: a frame clock (`rig.frameClock`, n/dt + the left arm and weapon shoulder as drawn last
     frame); when an override stops (a fall takes the body) the arm eases back at `ARM_RELEASE_RATE` instead of
     snapping (the `fall:fall` / `fall:rise` bone-pop rows).
   The body outranks continuity: when the lagging arm / convergence would put a fist or the blade into the torso
   where the solved pose did not, the limiter gives back just enough of the lag (lane M's pinned "hand never inside the
   torso" in tests/anim_measure_test.ts failed without this, Q1 Z-41). That is why some skills and dashes keep a
   residual weapon-shoulder pop (the bone-pop column): the torso constraint itself jumps there.
   A rig without a ticking clock (bare test rigs, `dt = 0` captures) keeps the exact pre-wave behaviour; the wave W
   two-hand pins (off hand within 40 mm of the haft, broad bodies included) stay green.
2. **Feet sliding through a fall's buckle** (the `fall:fall` slide row). The fall's contact latches were body-relative and M's fall
   pushes the body (0.3 m/s), so a "latched" foot travelled with it. `Animator.#fallFrame` now takes the body's own
   travel out of the latches each frame (world-fixed contacts). What remains (see tables) is the keyed buckle
   re-posing the two legs differently than the snapshot stance (one root translation cannot hold both feet).
3. **Balance disk**: the centre of mass (volume-weighted fitted capsules) projected on the floor against the convex
   hull of the loaded soles (heel in/out, ball in/out, toe tip). Idle and guard are judged on their double-support
   frames (a re-plant step is a walk, not a stance): every body is inside with a positive margin, so no stance needed
   a fix. A walking mid-stance has the CoM outside the single stance foot by construction (walking is a controlled
   fall); its stability measure is Hof's mediolateral XCoM margin, positive for all 8 bodies.

## Agility (C-AGI)

`src/game/anim/AgilityLimits.ts agilityLimits(limits, agility)`: each side of every joint window scales about the
joint's rest by k = 1 + 0.15·t (t = (agility − 500)/500 ≥ 0) or 1 + 0.10·t (t < 0), bounded by `ANATOMICAL_CAP`;
the elbow/knee hyperextension stops never move; identity (same numbers) at 500 or an absent agility.
Wiring: `Skeleton.setAgility(a)` / `defaultHumanoid(a)` rewrite the limit table the Animator and the SwingDriver copy
at construction (the engine must call it before `new Animator(...)` and `#armCombat`: asked of P, board Z-13).

## Skeleton stage (for P's `SkeletonStage`)

`src/game/anim/SkeletonDisks.ts`: `skeletonDisks(plan)` = one cross-section ellipse per bone head (pelvis, waist,
chest, neck, skull base, shoulder, elbow, hip, knee, ankle, toe) + skull centre, wrists, palms, balls of the feet,
radii straight from `plan.proportions`; `tPose(plan)` = bone heads with each arm straightened along ±x at shoulder
height (lengths kept, trunk/legs untouched; digits are render-only so the mitten sits at minimal divergence);
`tPoseBones` / `tPoseDisks` for the stage view. The bind pose stays the solved A-pose.

## Open issues (measured, not fixed this wave)

- **Forearm into torso with two-handed weapons** (the dominant offender count in the tables). The weapon arm's
  convergence turns the arm about an axis through the shoulder parallel to the blade, which swings the ELBOW into
  the belly (human guard with a longsword: the right elbow joint sits at the abdomen capsule's front surface); the off forearm crosses
  the chest at two-handed windups. Constraining the convergence by the forearm (tried: forearm capsules in
  `torsoClear`, then with a `0.06 m` contact band) breaks wave W's pinned deliverable — broad bodies (ork/dwarf) must
  keep the off hand on the haft at guard (`tests/wave_w_twohand_offhand_test.ts`). Needs a different carry (haft held
  further out / a shoulder adduction DOF), i.e. a design decision across lanes.
- **Thigh through thigh in fast strafes** (6.5 m/s): the gait's lateral stance sweep crosses the feet in the frontal
  plane (no crossover offset); and the side fall's keyed legs cross.
- **Spear/staff swings**: the swing curve drives the butt / haft through the own thighs and pelvis (raw 100+ mm),
  the ArmGuard corrects most of it; a thrust's convergence axis degenerates (blade along the arm), so a residual
  shoulder pop remains there. A rate limit on the ArmGuard correction was tried and reverted (it let the ork's staff
  sink much deeper into the pelvis: measured with `--clips swing:staff`, not kept).
- **Floor** values that differ between "this tree" and "K only" come from the other lanes' body changes (B's
  race posture), not from lane K (the K-only table shows no floor regression).
