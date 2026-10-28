# Lane X2 — geometric combat in the live game (W05/W08/W09)

Lane X's collision/impact modules are now what decides every blow in `Engine.ts`: a swing starts on
the press, the blade is swept against the other body's capsules every frame, damage/knockback come
from the contact (zone, feature, angle, speed, 1H/2H, defender mass/armour/guard/footing), and the
blade **stops at the body**. The plain attack was rebuilt so it actually reaches. Nothing committed.

## What changed

| File | Change |
|---|---|
| `src/game/anim/Swing.ts` (new, pure) | Weapon swings. `SwingKind` slash / chop / thrust **derived** from the weapon's damage mix (`swingKindOf`: thrust ≥ 0.6 → thrust; blunt ≥ 0.5 or heavy 2H → chop; else slash). `SWING_SHAPES` (windup + follow-through keys, blade angle in the world's vertical plane, roll, chest lean, twist, `aimLateral`, `windowLead`; the thrust moves the hand on a straight line via `armIK`). `strikeDuration` (blade arc / lane W ω, or lane W thrust time), `swingTiming` (windup/recover give way to the cooldown, the strike is never compressed), `sampleSwing` (easeInOutCubic windup/recover, smootherstep strike = peak speed mid-strike), `swingPose` (Animator attack-layer pose, 2H mirrors the off arm), `gripPitchFor` (β = lean + θs + θe + gp), `bladePoint`, `sweetDistance`, `stepInFor` (−0.3…+0.55 m), `engageDistance`, `aimYawForLine` (bisection on the measured blade line, `AIM_PATTERN` varies the aim per swing), `SwingPlayer` (clock, strike window, `freeze` = contact hold `CONTACT_HOLD` 0.1 s then recover from the contact pose). |
| `src/combat/SwingDriver.ts` (new, pure) | Per-fighter runtime: `swingSetupFor(spec, arm)` (kind, timing source, grip mode, tip, sweet/engage, choke), `SwingDriver.begin/advance/attackPose/yaw/takeStep/gripPitch/gripRoll/chokeOffset/freeze/striking`, `skillGripPitch` (skills hold the blade in a hammer grip instead of the legacy-frame stance pitches), `weaponTip`. Polearms pressed too close **choke up** the haft (lane W's `choke` grip). |
| `src/combat/SwingRig.ts` (new, THREE) | `measureAimLine(rig, sk, setup)`: the true blade line at mid-strike (includes the shoulder display roll, ~0.15 rad of inward convergence the planar model misses). |
| `src/combat/SelfGuard.ts`, `RigAdapter.ts` (lane X files) | `SelfOptions.excludeGrip`, `ArmGuardOptions.targetBones`: the same guard can keep a blade out of the OTHER body. |
| `src/game/anim/Animator.ts` | `AnimatorInput.attackPose`: a swing curve drives the attack layer (trusted, no pop-guard lag); static `ATTACK_POSE` restored for legacy attacks. |
| `src/game/Skeleton.ts` | Hook `stopSkillAfter(seconds)`: a skill's clock freezes on contact, then the skill ends. |
| `src/engine/Engine.ts` | Lane X patch applied + X2: `#ensureWeapon` (class defaults get their archetype as a generated spec, drawn with `options.weaponSpec` + `toGeneratedWeapon`, legacy struct/profile follow it), `#armCombat` (hitboxes, tracker, ArmGuard, SwingDriver + measured aim line), body guards against the other body, `#beginSwing` (press/AI/skill), `#swingTick` (clock + step-in through the body position before the arena step; stagger in the windup cancels), `#updatePose` (attack pose + aim/twist yaw), grip from the blade angle (+ choke), `#strikeTick` (own guard → sweep → contact rewind/freeze → body guard), `#onContact`, `#resolveHit(…, contact)` (Impact: zone/feature/angle damage, impulse knockback capped at `KNOCKBACK_MAX` 4 m/s, stagger), `#engageDistance` = min(geometric engage, profile reach + body radius) for the AI view, AI skill triage, out-of-reach "attack" → "advance", and the HUD ring; no plain attack while a skill or swing runs; body-body push to `BODY_SPACING` 0.9 m (was 1.0 m = physics radii). Snapshot `combat[]`: weapon, swing (kind, sweet, engage, choke, clock), swings / skillSwings / contacts / whiffs / cancelled, outcomes, zones, knockback range, last 8 contacts (zone, side, feature, outcome, damage, knockback N·s, speed, edge/thrust alignment, Impact delivery note), self-clearance, body-guard depths. |
| `tests/anim_swing_test.ts` (12), `tests/combat_swing_test.ts` (4, real rigs) | New. No existing test was changed (none encoded the instant resolve). |

## Hit rate — before / after

**Before** (lane X's measurement, `scratch/laneX/hitrate.json`, legacy `ATTACK_POSE`, longsword fixture,
human vs ork): plain attack under the geometric gate **lands only at 0.8 m** (hand); 0/1 at 1.0–3.0 m,
while the old distance rule "hit" everything to 2.0 m. Zones of all swings: thigh 42, abdomen 17, hand 16.

**After** (`scratch/laneX2/hitrate2.ts`, engine frame order incl. ArmGuard, body guard, contact
freeze; real generated weapons, 3 seeds × 4 defenders (human/ork/dwarf/elf) × guard/block = 24 per
cell; `hitrate2-final3.log`):

| D (m) | longsword (slash, 2H) | spear (thrust, 2H) | warhammer (chop, 1H) |
|---|---|---|---|
| 0.8 | 24/24 | 24/24 | 24/24 |
| 1.0 | 24/24 | 24/24 | 24/24 |
| 1.2 | 24/24 | 24/24 | 24/24 |
| 1.4 | 24/24 | 24/24 | 24/24 |
| 1.6 | 24/24 | 24/24 | 24/24 |
| 1.8 | 24/24 | 24/24 | 14/24 (58 %) |
| 2.0 | 24/24 | 24/24 | 10/24 (42 %) |
| 2.2 | 11/24 (46 %) | 24/24 | 2/24 (8 %) |
| 2.5 | 5/24 (21 %) | 8/24 (33 %) | 0/24 |
| 3.0 | 0/24 | 0/24 | 0/24 |
| engage distance (per seed) | 1.79 / 1.81 / 1.88 | 1.93 / 1.97 / 2.18 | 1.52 / 1.55 / 1.72 |
| **AT engage, per seed** | 24/24 ×3 | 24/24 ×3 | 24/24 ×3 |
| zones (all D) | head 91, hand 46, chest 29, upperArm 9, foreArm 5, neck 4 | pelvis 64, abdomen 55, chest 41, thigh 40 | head 76, hand 39, chest 24, other 7 |

Acceptance: ≥ 80 % at every D ≤ engage (100 %), misses beyond reach (0 % at 3.0 m), engage ≤ the
last ≥ 80 % distance — met for all three. Dagger (reverse, thrust): 24/24 at 1.0–1.4 m, engage 1.17–1.20,
0 beyond 1.8. Blade into the other body OUTSIDE a contact, before → after the body guard: ≤ 17 cm → 0.0–0.3 cm
at D ≥ 1.0 (5 cm left at 0.8 m, where torsos overlap). Own blade in own body: max −0.0 cm (never inside).
Skills (24, longsword, vs ork): 79 % @0.8, 75 % @1.0, 54–58 % @1.2–1.8, 33 % @3.0 (dash lunges); zones chest/head.
Unit test `combat_swing_test`: contact at engage for human and ork, none at 3 m; blade depth during the
hold −0.2 / 3.6 / 1.7 cm (longsword / warhammer / spear) vs 9.9 / 8.1 / 11.4 cm without the freeze.

## Live browser (http://127.0.0.1:8788, Fight → Enter the ring by real clicks, truce waited, 30 s Z (KeyW) held + Space every 0.6 s)

`browser_exec` session `combat`: works, 0 JS errors, but the window is hidden — rAF never fired and
the sim ran at ~0.3–0.45× real time; `Page.captureScreenshot` timed out (60 s). Player longsword: 14
swings → 14 contacts in that run. So the numbers and shots below come from the Playwright MCP
(Metal, 121 rAF/s), same clicks/keys via CDP. Final build (BODY_SPACING 0.9):

| player weapon | swings | contacts | whiffs | cancelled (staggered) | zones | knockback N·s | rival (AI) |
|---|---|---|---|---|---|---|---|
| longsword (class default) | 22 | 19 | 0 | 3 | head 10, upperArm 6, chest 3 | 19.9–41.0 | warhammer: 39 → 34, 0 whiffs |
| spear | 21 | 16 | 0 | 5 | chest 5, pelvis 5, abdomen 5, thigh 1 | 0–0.6 | maul: 27 → 25, 0 whiffs |
| warhammer | 23 | 18 | 0 | 5 | head 6, hand 5, upperArm 3, chest 2, foreArm 2 | 1.3–12.6 | bow: 33 → 31, 1 whiff |
| dagger | 43 | 35 | 0 | 8 | abdomen 23, thigh 4, chest 4, pelvis 3 | 0–7.6 | greatsword: 37 → 31, 0 whiffs |

(rival counts include its 14 skill swings.) Console: the only error in every run is the pre-existing
`405 POST /api/telemetry/character-creation` (static server); `globalThis.__errs` stayed empty.
Body guard: deepest would-be penetration it removed 10–14 cm, deepest left 4.6–8.2 cm (max over 30 s
of pressed-together fighting). Sanity run after the last change (knockback cap): longsword 21 → 17, 0
whiffs; axe rival 35 → 28, 0 whiffs; no errors; max separation 4.1 m (was 15 m after a maul hit).

## Vision verdicts (frozen on the frame after a player contact, orbit side views)

* Before the body guard (`contact-side-right.png`): "the right fighter's sabre **passes through** the
  defender's head" (the AI's blade in its rebound/windup, outside its strike window).
* After (`contactA-side.png`, head contact): "left fighter's sword: **stops at the body**; right
  fighter's sword: not touching". Measured: player blade 10 cm clear; rival 3.4 cm in → −1.6 cm after the guard.
* After (`contactB-side.png`, upper-arm contact): "no blade passes through any body, and no sword passes
  through its own holder" (vision swapped which blade touches; measured both clear: −5.4 / −20 cm).

## Commands (real output)

* `deno check main.ts` → `Check main.ts` (no diagnostics). `deno lint src` → `Checked 171 files`.
* `deno test --allow-read --allow-write=artifacts,<scratch> --allow-env $(git ls-files tests | grep _test.ts | grep -v probe_test) tests/combat_*_test.ts tests/weapons_*_test.ts tests/anim_realrig_test.ts tests/body_detail_test.ts tests/anim_swing_test.ts`
  → `ok | 878 passed | 0 failed (40s)`.
* `deno task build` → `Built local browser bundle: 1378035 bytes`.
* Harness: `deno run --config deno.json --allow-read --allow-write=<scratch> scratch/laneX2/hitrate2.ts tag=final3` (8.5 s).

## Open issues

1. **Damage balance shifted** (lane X Impact, not geometry): Warriors' armour 7.16 → 0.65 (cap), so a
   clean cut keeps ×0.39–0.48 while blunt keeps ×0.68–0.83 and blunt efficiency reaches 1.45; per-hit
   damage of a mace/maul head blow ran 10× a longsword's in one live match. Needs a calibration pass
   (normalise Impact by each weapon's clean-blow delivery, or retune ARMOUR_SCALE).
2. **Spears at body range**: pressed to 0.9–1.2 m the point meets the body at 1–4 m/s → grazes/misses
   (choke + half step back help in the harness: 1.2 m hit 5 + crit 4 of 24, but the player walking in
   cancels the step). Fix idea: hand-to-butt switch or a short "haft strike" for polearms.
3. Zones: vertical cuts on the centre line meet the **head** first; guard hands catch many long-range
   blows (realistic, but hand share 20–35 % for slashes/chops). `AIM_PATTERN` spreads it partly.
4. Skills keep lane C's curves; their hit rate is 50–58 % at 1.2–2.0 m (dash 33 % at 3 m). A skill that
   touches stops (`stopSkillAfter`) and its remaining lunge is lost.
5. Two-handed: the off arm mirrors the main arm (no IK onto the haft). Trunk twist/aim is a whole-body
   yaw (the gait re-plants feet for large twists).
6. The body guard cannot clear a blade when the two guards interlock (residual ≤ 8 cm at 0.9 m).
7. Reverse dagger: carry angle is a guess; edge alignment of slashes 0.84–0.96, thrust alignment of
   spears at range 0.57–0.99.
8. Not touched (other lane): `src/game/weapons/**`, `src/graphics/weapons/**`.
