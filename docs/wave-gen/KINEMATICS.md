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

## Audit tables: HEAD (before) -> this tree (after)

### Worst value per clip family (over 8 bodies), before → after

| family | runs | max joint Δ rad/frame | max bone Δ rad/frame | planted slide mm | lowest skin mm | forearm→torso mm | thigh→thigh mm | weapon→body mm |
|---|---|---|---|---|---|---|---|---|
| stand | 24 | 0.194 → 0.062 | 1.759 → 0.166 | 0.4 → 0.4 | -0.0 → -0.0 | 124.6 → 124.6 | 0.5 → 0.5 | 22.1 → 0.0 |
| move | 40 | 0.583 → 0.393 | 1.742 → 0.439 | 17.0 → 17.0 | -2.5 → -2.5 | 140.6 → 150.3 | 102.2 → 102.2 | 46.7 → 0.0 |
| swing | 136 | 0.732 → 0.732 | 2.600 → 0.732 | 4.3 → 4.3 | -1.1 → -1.0 | 159.1 → 183.1 | 1.6 → 1.6 | 56.1 → 56.1 |
| dash | 64 | 0.525 → 0.393 | 1.785 → 0.643 | 31.0 → 31.0 | -4.2 → -6.4 | 153.9 → 212.5 | 5.9 → 5.9 | 73.8 → 0.0 |
| cast | 64 | 0.761 → 0.761 | 1.785 → 0.805 | 5.9 → 5.9 | -4.6 → -2.9 | 148.9 → 230.1 | 5.9 → 5.9 | 46.5 → 8.8 |
| defense | 64 | 0.600 → 0.459 | 1.789 → 0.459 | 4.2 → 4.2 | -20.7 → -24.5 | 151.5 → 169.9 | 6.3 → 6.3 | 55.0 → 19.7 |
| react | 24 | 0.274 → 0.248 | 1.756 → 0.248 | 4.3 → 4.3 | -2.4 → -2.4 | 135.2 → 135.9 | 0.7 → 0.7 | 45.1 → 0.0 |
| fall:fall | 24 | 0.380 → 0.307 | 1.754 → 0.333 | 114.0 → 64.0 | -1.5 → -0.6 | 129.7 → 133.5 | 100.0 → 100.0 | 55.1 → 0.0 |
| fall:lie | 24 | 0.001 → 0.001 | 0.001 → 0.001 | 0.0 → 0.0 | -0.0 → -0.0 | 17.1 → 17.1 | 6.0 → 6.0 | 0.0 → 0.0 |
| fall:rise | 24 | 0.365 → 0.365 | 1.391 → 0.365 | 18.7 → 18.7 | -0.5 → -0.6 | 124.6 → 124.6 | 6.9 → 6.9 | 0.0 → 0.0 |

### Offending runs (any metric over its threshold: {"popRad":0.4,"slideMm":20,"floorMm":-10,"foreTorsoMm":10,"thighMm":10,"weaponMm":10})

| metric | before | after |
|---|---|---|
| pop | 331 | 78 |
| slide | 27 | 24 |
| floor | 15 | 16 |
| foreTorso | 390 | 389 |
| thigh | 16 | 16 |
| weapon | 90 | 16 |
| any | 391 / 488 | 391 / 488 |

### The 15 worst runs before, and the same runs after

| body | clip | tag | offences before | severity before | severity after | max joint Δ rad/frame | max bone Δ rad/frame | planted slide mm | lowest skin mm | forearm→torso mm | thigh→thigh mm | weapon→body mm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ork | swing:spear | x | pop,foreTorso,weapon | 15.91 | 15.91 | 0.393 → 0.393 | 1.741 → 0.640 | 2.3 → 2.3 | -1.0 → -1.0 | 159.1 → 159.1 | 0.7 → 0.7 | 11.0 → 6.4 |
| ork | dash:archer-rollback | x | pop,foreTorso,weapon | 15.39 | 15.39 | 0.393 → 0.393 | 1.464 → 0.454 | 4.1 → 4.1 | -3.2 → -3.2 | 153.9 → 153.9 | 5.8 → 5.8 | 73.8 → 0.0 |
| ork | swing:greataxe | x | pop,foreTorso | 15.25 | 18.06 | 0.146 → 0.146 | 0.990 → 0.333 | 1.9 → 1.9 | -1.0 → -1.0 | 152.5 → 180.6 | 1.6 → 1.6 | 0.0 → 0.0 |
| ork | defense:necro-bone-armor | x | pop,foreTorso,weapon | 15.15 | 16.90 | 0.600 → 0.196 | 1.058 → 0.319 | 4.2 → 4.2 | -6.2 → -6.2 | 151.5 → 169.0 | 6.3 → 6.3 | 17.2 → 0.0 |
| ork | defense:assassin-vanish | x | pop,foreTorso | 15.11 | 16.99 | 0.457 → 0.202 | 1.789 → 0.339 | 4.0 → 4.0 | -0.6 → -0.9 | 151.1 → 169.9 | 6.3 → 6.3 | 4.6 → 0.0 |
| ork | defense:priest-sanctuary | x | pop,foreTorso | 15.00 | 14.73 | 0.317 → 0.238 | 1.765 → 0.402 | 4.1 → 4.1 | -0.5 → -0.9 | 150.0 → 147.3 | 6.3 → 6.3 | 0.0 → 0.0 |
| ork | swing:maul | x | pop,foreTorso | 14.97 | 18.06 | 0.146 → 0.146 | 0.989 → 0.333 | 1.6 → 1.6 | -1.0 → -1.0 | 149.7 → 180.6 | 1.5 → 1.5 | 0.0 → 0.0 |
| ork | defense:warrior-bulwark | x | pop,foreTorso | 14.94 | 14.39 | 0.279 → 0.279 | 1.029 → 0.441 | 4.0 → 4.0 | -0.5 → -0.9 | 149.4 → 143.9 | 6.3 → 6.3 | 0.0 → 0.0 |
| ork | cast:barbarian-skullsplitter | x | pop,foreTorso | 14.89 | 19.68 | 0.217 → 0.217 | 1.089 → 0.416 | 3.0 → 3.0 | -1.2 → -1.2 | 148.9 → 196.8 | 5.9 → 5.9 | 0.0 → 0.0 |
| ork | defense:archer-steady-aim | x | pop,foreTorso,weapon | 14.86 | 16.62 | 0.195 → 0.195 | 1.750 → 0.373 | 4.0 → 4.0 | -0.5 → -0.9 | 148.6 → 166.2 | 6.2 → 6.2 | 40.9 → 0.0 |
| ork | cast:archer-piercing-shot | x | pop,foreTorso,weapon | 14.86 | 20.37 | 0.248 → 0.216 | 1.109 → 0.452 | 5.9 → 5.9 | -0.6 → -0.6 | 148.6 → 203.7 | 5.7 → 5.7 | 35.4 → 0.0 |
| ork | cast:mage-arcane-nova | x | pop,foreTorso | 14.78 | 23.01 | 0.232 → 0.222 | 1.656 → 0.450 | 3.0 → 3.0 | 0.0 → -0.0 | 147.8 → 230.1 | 0.3 → 0.3 | 0.0 → 0.0 |
| ork | defense:barbarian-ironhide | x | pop,floor,foreTorso | 14.77 | 14.68 | 0.248 → 0.248 | 1.568 → 0.417 | 4.1 → 4.1 | -11.6 → -11.6 | 147.7 → 146.8 | 6.3 → 6.3 | 5.6 → 0.0 |
| ork | defense:rogue-evasion | x | pop,foreTorso,weapon | 14.76 | 14.76 | 0.242 → 0.197 | 1.710 → 0.419 | 4.0 → 4.0 | -0.5 → -0.9 | 147.6 → 147.6 | 6.3 → 6.3 | 14.6 → 0.0 |
| ork | defense:mage-mana-shield | x | pop,foreTorso | 14.76 | 14.94 | 0.249 → 0.249 | 1.052 → 0.438 | 4.0 → 4.0 | -0.5 → -0.9 | 147.6 → 149.4 | 6.2 → 6.2 | 0.0 → 0.0 |

### Balance disk: centre of mass over the support polygon (margin mm, + inside), before → after

| body | idle | guard | walk mid-stance (static, single foot) | walk mid-stance (Hof mediolateral XCoM) |
|---|---|---|---|---|
| human | 65 → 65 | 50 → 50 | -44 → -44 | 105 → 105 |
| humanF | 59 → 59 | 46 → 46 | -44 → -44 | 100 → 100 |
| elf | 66 → 66 | 36 → 36 | -22 → -22 | 78 → 78 |
| elfF | 65 → 65 | 36 → 36 | -27 → -27 | 73 → 73 |
| dwarf | 47 → 47 | 72 → 72 | -99 → -100 | 166 → 166 |
| dwarfF | 54 → 52 | 68 → 69 | -85 → -85 | 166 → 165 |
| ork | 74 → 75 | 115 → 112 | -93 → -98 | 213 → 211 |
| orkF | 73 → 78 | 106 → 101 | -84 → -92 | 206 → 195 |

## Audit tables: HEAD -> HEAD + lane K's files only (isolates K from the other lanes' body changes)

### Worst value per clip family (over 8 bodies), before → after

| family | runs | max joint Δ rad/frame | max bone Δ rad/frame | planted slide mm | lowest skin mm | forearm→torso mm | thigh→thigh mm | weapon→body mm |
|---|---|---|---|---|---|---|---|---|
| stand | 24 | 0.194 → 0.062 | 1.759 → 0.166 | 0.4 → 0.4 | -0.0 → -0.0 | 124.6 → 124.6 | 0.5 → 0.5 | 22.1 → 0.0 |
| move | 40 | 0.583 → 0.393 | 1.742 → 0.439 | 17.0 → 17.0 | -2.5 → -2.5 | 140.6 → 140.6 | 102.2 → 102.2 | 46.7 → 0.0 |
| swing | 136 | 0.732 → 0.732 | 2.600 → 0.732 | 4.3 → 4.3 | -1.1 → -1.1 | 159.1 → 159.1 | 1.6 → 1.6 | 56.1 → 56.1 |
| dash | 64 | 0.525 → 0.393 | 1.785 → 0.643 | 31.0 → 31.0 | -4.2 → -4.2 | 153.9 → 212.5 | 5.9 → 5.9 | 73.8 → 0.0 |
| cast | 64 | 0.761 → 0.761 | 1.785 → 0.805 | 5.9 → 5.9 | -4.6 → -4.6 | 148.9 → 230.1 | 5.9 → 5.9 | 46.5 → 8.8 |
| defense | 64 | 0.600 → 0.462 | 1.789 → 0.462 | 4.2 → 4.2 | -20.7 → -20.7 | 151.5 → 169.9 | 6.3 → 6.3 | 55.0 → 20.2 |
| react | 24 | 0.274 → 0.248 | 1.756 → 0.248 | 4.3 → 4.3 | -2.4 → -2.4 | 135.2 → 135.9 | 0.7 → 0.7 | 45.1 → 0.0 |
| fall:fall | 24 | 0.380 → 0.307 | 1.754 → 0.333 | 114.0 → 64.0 | -1.5 → -1.5 | 129.7 → 133.5 | 100.0 → 100.0 | 55.1 → 0.0 |
| fall:lie | 24 | 0.001 → 0.001 | 0.001 → 0.001 | 0.0 → 0.0 | -0.0 → -0.0 | 17.1 → 17.1 | 6.0 → 6.0 | 0.0 → 0.0 |
| fall:rise | 24 | 0.365 → 0.365 | 1.391 → 0.365 | 18.7 → 18.7 | -0.5 → -0.5 | 124.6 → 124.6 | 6.9 → 6.9 | 0.0 → 0.0 |

### Offending runs (any metric over its threshold: {"popRad":0.4,"slideMm":20,"floorMm":-10,"foreTorsoMm":10,"thighMm":10,"weaponMm":10})

| metric | before | after |
|---|---|---|
| pop | 331 | 78 |
| slide | 27 | 24 |
| floor | 15 | 15 |
| foreTorso | 390 | 389 |
| thigh | 16 | 16 |
| weapon | 90 | 16 |
| any | 391 / 488 | 391 / 488 |

### The 15 worst runs before, and the same runs after

| body | clip | tag | offences before | severity before | severity after | max joint Δ rad/frame | max bone Δ rad/frame | planted slide mm | lowest skin mm | forearm→torso mm | thigh→thigh mm | weapon→body mm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ork | swing:spear | x | pop,foreTorso,weapon | 15.91 | 15.91 | 0.393 → 0.393 | 1.741 → 0.640 | 2.3 → 2.3 | -1.0 → -1.0 | 159.1 → 159.1 | 0.7 → 0.7 | 11.0 → 6.4 |
| ork | dash:archer-rollback | x | pop,foreTorso,weapon | 15.39 | 15.39 | 0.393 → 0.393 | 1.464 → 0.454 | 4.1 → 4.1 | -3.2 → -3.2 | 153.9 → 153.9 | 5.8 → 5.8 | 73.8 → 0.0 |
| ork | swing:greataxe | x | pop,foreTorso | 15.25 | 15.25 | 0.146 → 0.146 | 0.990 → 0.333 | 1.9 → 1.9 | -1.0 → -1.0 | 152.5 → 152.5 | 1.6 → 1.6 | 0.0 → 0.0 |
| ork | defense:necro-bone-armor | x | pop,foreTorso,weapon | 15.15 | 16.90 | 0.600 → 0.196 | 1.058 → 0.319 | 4.2 → 4.2 | -6.2 → -6.2 | 151.5 → 169.0 | 6.3 → 6.3 | 17.2 → 0.0 |
| ork | defense:assassin-vanish | x | pop,foreTorso | 15.11 | 16.99 | 0.457 → 0.202 | 1.789 → 0.339 | 4.0 → 4.0 | -0.6 → -0.6 | 151.1 → 169.9 | 6.3 → 6.3 | 4.6 → 0.0 |
| ork | defense:priest-sanctuary | x | pop,foreTorso | 15.00 | 14.73 | 0.317 → 0.238 | 1.765 → 0.402 | 4.1 → 4.1 | -0.5 → -0.5 | 150.0 → 147.3 | 6.3 → 6.3 | 0.0 → 0.0 |
| ork | swing:maul | x | pop,foreTorso | 14.97 | 14.97 | 0.146 → 0.146 | 0.989 → 0.333 | 1.6 → 1.6 | -1.0 → -1.0 | 149.7 → 149.7 | 1.5 → 1.5 | 0.0 → 0.0 |
| ork | defense:warrior-bulwark | x | pop,foreTorso | 14.94 | 14.39 | 0.279 → 0.279 | 1.029 → 0.441 | 4.0 → 4.0 | -0.5 → -0.5 | 149.4 → 143.9 | 6.3 → 6.3 | 0.0 → 0.0 |
| ork | cast:barbarian-skullsplitter | x | pop,foreTorso | 14.89 | 19.68 | 0.217 → 0.217 | 1.089 → 0.416 | 3.0 → 3.0 | -1.2 → -1.2 | 148.9 → 196.8 | 5.9 → 5.9 | 0.0 → 0.0 |
| ork | defense:archer-steady-aim | x | pop,foreTorso,weapon | 14.86 | 16.62 | 0.195 → 0.195 | 1.750 → 0.373 | 4.0 → 4.0 | -0.5 → -0.5 | 148.6 → 166.2 | 6.2 → 6.2 | 40.9 → 0.0 |
| ork | cast:archer-piercing-shot | x | pop,foreTorso,weapon | 14.86 | 20.37 | 0.248 → 0.216 | 1.109 → 0.452 | 5.9 → 5.9 | -0.6 → -0.6 | 148.6 → 203.7 | 5.7 → 5.7 | 35.4 → 0.0 |
| ork | cast:mage-arcane-nova | x | pop,foreTorso | 14.78 | 23.01 | 0.232 → 0.222 | 1.656 → 0.450 | 3.0 → 3.0 | 0.0 → 0.0 | 147.8 → 230.1 | 0.3 → 0.3 | 0.0 → 0.0 |
| ork | defense:barbarian-ironhide | x | pop,floor,foreTorso | 14.77 | 14.68 | 0.248 → 0.248 | 1.568 → 0.417 | 4.1 → 4.1 | -11.6 → -11.6 | 147.7 → 146.8 | 6.3 → 6.3 | 5.6 → 0.0 |
| ork | defense:rogue-evasion | x | pop,foreTorso,weapon | 14.76 | 14.76 | 0.242 → 0.197 | 1.710 → 0.419 | 4.0 → 4.0 | -0.5 → -0.5 | 147.6 → 147.6 | 6.3 → 6.3 | 14.6 → 0.0 |
| ork | defense:mage-mana-shield | x | pop,foreTorso | 14.76 | 14.94 | 0.249 → 0.249 | 1.052 → 0.438 | 4.0 → 4.0 | -0.5 → -0.5 | 147.6 → 149.4 | 6.2 → 6.2 | 0.0 → 0.0 |

### Balance disk: centre of mass over the support polygon (margin mm, + inside), before → after

| body | idle | guard | walk mid-stance (static, single foot) | walk mid-stance (Hof mediolateral XCoM) |
|---|---|---|---|---|
| human | 65 → 65 | 50 → 50 | -44 → -44 | 105 → 105 |
| humanF | 59 → 59 | 46 → 46 | -44 → -44 | 100 → 100 |
| elf | 66 → 66 | 36 → 36 | -22 → -22 | 78 → 78 |
| elfF | 65 → 65 | 36 → 36 | -27 → -27 | 73 → 73 |
| dwarf | 47 → 47 | 72 → 72 | -99 → -99 | 166 → 166 |
| dwarfF | 54 → 54 | 68 → 68 | -85 → -85 | 166 → 166 |
| ork | 74 → 74 | 115 → 115 | -93 → -96 | 213 → 213 |
| orkF | 73 → 73 | 106 → 106 | -84 → -91 | 206 → 193 |

## Agility: limit windows and the envelope the clips reach (anim-agility.json)

Total travel of the limit table (sum of max - min, rad): agility 0 27.11 · 500 30 · 1000 33.6

| joint | window @0 | window @500 | window @1000 | reached @0 (all clips, worst body) | reached @500 | reached @1000 |
|---|---|---|---|---|---|---|
| spine | -0.54..0.54 | -0.60..0.60 | -0.69..0.69 | -0.52..0.54 | -0.53..0.60 | -0.53..0.61 |
| abdomen | -0.45..0.45 | -0.50..0.50 | -0.57..0.57 | -0.45..0.45 | -0.50..0.45 | -0.50..0.45 |
| neck | -0.45..0.45 | -0.50..0.50 | -0.57..0.57 | -0.36..0.23 | -0.37..0.23 | -0.37..0.23 |
| head | -0.45..0.45 | -0.50..0.50 | -0.57..0.57 | -0.45..0.36 | -0.47..0.36 | -0.47..0.36 |
| shoulderL | -2.16..0.54 | -2.40..0.60 | -2.76..0.69 | -2.12..0.52 | -2.36..0.58 | -2.71..0.67 |
| shoulderR | -2.16..0.54 | -2.40..0.60 | -2.76..0.69 | -2.12..0.54 | -2.36..0.60 | -2.71..0.69 |
| elbowL | -2.37..0.00 | -2.60..0.00 | -2.70..0.00 | -2.31..0.00 | -2.31..0.00 | -2.31..0.00 |
| elbowR | -2.37..0.00 | -2.60..0.00 | -2.70..0.00 | -2.31..0.00 | -2.31..0.00 | -2.31..0.00 |
| hipL | -1.08..1.08 | -1.20..1.20 | -1.38..1.38 | -0.60..1.88 | -0.60..1.88 | -0.60..1.88 |
| hipR | -1.08..1.08 | -1.20..1.20 | -1.38..1.38 | -0.82..1.41 | -0.82..1.41 | -0.82..1.41 |
| kneeL | -2.19..0.00 | -2.40..0.00 | -2.60..0.00 | -2.19..-0.01 | -2.28..-0.04 | -2.25..-0.04 |
| kneeR | -2.19..0.00 | -2.40..0.00 | -2.60..0.00 | -2.19..-0.16 | -2.28..-0.16 | -2.26..-0.16 |
| ankleL | -0.72..0.54 | -0.80..0.60 | -0.92..0.69 | -0.72..0.54 | -0.79..0.60 | -0.90..0.69 |
| ankleR | -0.72..0.54 | -0.80..0.60 | -0.92..0.69 | -0.72..0.54 | -0.80..0.60 | -0.92..0.66 |
| toeL | -0.63..0.36 | -0.70..0.40 | -0.81..0.46 | -0.63..0.36 | -0.70..0.36 | -0.81..0.33 |
| toeR | -0.63..0.36 | -0.70..0.40 | -0.81..0.46 | -0.63..0.26 | -0.70..0.20 | -0.81..0.24 |

Reached envelope summed over joints (rad): agility 0 26.615 · 500 27.855 · 1000 29.281
