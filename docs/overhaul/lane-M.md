# Lane M — Motion style: four-phase strikes, kinetic chain, per-race / weapon / live variation

Every fighter now moves with a **MotionStyle** built from its race, subrace, seed, body, weapon
and combat stats, modulated every frame by its live hp / stamina / mana / exhaustion. Strikes
follow **wind-up → sharp hit → hold → heavy recovery → settle**, the legs lead and the chain
follows (feet → pelvis → chest → shoulder → elbow → weapon), and every claim is a number from
`tools/anim-report.ts` (real skinned rigs, engine frame order). Nothing committed. Engine.ts is
NOT edited: `docs/overhaul/lane-M-engine-patch.py` applies the integration (8 exact-once edits;
dry run passes on the current Engine.ts, the patched file type-checks).

## Files

| File | What |
|---|---|
| `src/game/anim/MotionStyle.ts` (new, pure) | `motionStyleFor(input)`, `MotionStyle` (base / eff coefficients, `setLive`, `step(dt)` smoothing, `setLiveImmediate`, `factors`, `swingOverrun`, `jointLead`, seeded `jointAmp` / `jointJitter` / `swingAmp`, `breathPhase`), `weaponMotionFromSpec` / `weaponMotionFromLegacy`, `styleVector` / `styleDistance`. Every coefficient named with its reason; `SAFE` ranges clamp every output; inputs go through tanh / smoothstep (continuous, saturating). |
| `src/game/AnimationCurve.ts` | `strikeProgress` / `strikeSpeed` (peak speed 2 AT the contact, `p(c) = c`), `recoveryCurve` (damped overshoot +A, −0.3A, rest; Hermite pieces, C1), `hermite`, `recoveryPeakRate`, `fourPhaseImpulse` / `fourPhasePeakRate` / `styledTrackOffset` (skill curves: counter-move → accelerating strike → 1 at `hitAt` → hold → heavy recovery → settle). `impulse` / `trackOffset` unchanged. |
| `src/game/anim/Swing.ts` | `SwingTiming.hold?/settle?`, styled section: `styledSwingTiming` (strike keeps the weapon's peak speed, speed-safe floors, optional live overrun), `contactFraction`, `SwingProfile` / `newSwingProfile`, `styledKeyAt`, `sampleStyledSwing` (per-DOF chain lead), `styledLegDrive`, `SWING_DOFS` / `SWING_DOF_DEPTH`; `SwingPlayer.profile` (styled sampling, contact hold, heavy rebound + settle); `swingWindow` ends at the hold for styled timings; `swingPose(..., offArm, mirrorBias)`. Unstyled paths unchanged. |
| `src/combat/SwingDriver.ts` | `setStyle` / `setLive` / `style`, `phaseTimes()`, `legDrive()`; per press `#styledProfile`: keys scaled about the CONTACT key (reach, sweet distance, aim line unchanged), soft joint-limit keys, thrust hand path capped at 97 % reach with a chest follow-through, chain leads, speed-safe wind-up / strike / recovery floors, HEAVY recovery floor (`HEAVY_RECOVERY` 0.9) inside the cooldown. |
| `src/game/anim/Animator.ts` | `setStyle` / `setLive` / `style`; style effects: stride scale, ride (crouch) + strike leg drive (`AnimatorInput.attackDrive`), hunch (balance layer), guard drop / tuck, breathing rate/amp (integrated phase, seeded offset), arm swing × per-joint jitter, sway, head drop, styled skill tracks (four-phase envelope, chain lead with a monotonic ramp, counter-move shortened under `SKILL_SPEED_SHARE` of the joint limit). **Ball pivot** (`pivotPitch` 0.14, always on): a planted foot rolls onto its ball as the body yaws over it. |
| `src/game/anim/Scenario.ts` | `ScenarioSegment.swing` (any `SwingLike`: begin / advance / step / yaw / attackPose / legDrive, speed measured from positions like the engine), `beforeFrame` hook, `soleMin`, `peakSpeed`, `seams` (SeamTracker), `swingEnds`. |
| `src/game/anim/Measure.ts` | `FootWorld.toe*` (toe tip), `SeamTracker` (velocity jumps, cycle-wrap pose seam with sub-frame interpolation, background p95). |
| `src/game/anim/Clipping.ts` (new, pure) | Capsule / segment clearance (`capsuleClearance`, `setClearance`, `polylineClearance`, `ClearanceStat`) over Hitbox-shaped capsules. |
| `tools/anim-report.ts` (new) | `deno run -A tools/anim-report.ts [--before]` → table + `artifacts/anim-report.json` (`--before`: no style, `pivotPitch 0` = the pre-lane-M code paths → `artifacts/anim-report-before.json`). Exports `buildBody`, `styleOf`, `measureSwing`, `measureLoop`, `ClipMeter`, `styleDifferences` for tests / the next character type. |
| `tests/anim_motionstyle_test.ts` (8), `tests/anim_fourphase_test.ts` (12), `tests/anim_measure_test.ts` (3) | New. No existing test changed. |
| `docs/overhaul/lane-M-engine-patch.py` | Engine integration (below). |

## How the method maps to code

* **Four phases** (swing): wind-up Hermite ease to the cocked key (the counter-move: shoulder
  moves opposite to the strike in all three kinds); strike on `strikeProgress` — accelerating
  into the contact, peak speed at the contact time (`contactAt = windup + c·strike`, `c` from the
  geometric contact fraction), braking to rest at the follow-through; hit hold (`holdTime`, 30–160
  ms; a contact freezes `contactHold` instead); heavy recovery (`recoveryCurve`, overshoot 0–16 %
  of the travel, damped −0.3×); settle hold at guard, the aim yaw easing out over recovery +
  settle. The strike window = lead·windup … end of the hold, so damage still lands when the swing
  reads (contact inside the window: tested).
* **Skills**: `fourPhaseImpulse` replaces `impulse` for a styled fighter; the weapon shoulder
  is the chain reference and reaches its extreme ON `hitAt` (tested within 6 % of travel, never
  earlier); `Skills.ts` data and `hitAt == peak` unchanged.
* **Kinetic chain**: per DOF lead `(5 − depth)·chainLag` (+ seeded ±4 ms), ramped in over the
  wind-up so every DOF starts at guard; blade lead 0 (the contact is the blade's). Legs lead via
  `legDrive` (the pelvis sinks into the planted feet, peaking `5·chainLag` before the contact).
  Measured order (longsword, 1 kHz): legs max 0.283 s < twist 0.298 < chest 0.315 < shoulder
  0.322 < elbow 0.340 < blade 0.353 = contact 0.353.
* **Variation**: race temperament (human identity; dwarf low / short stride / heavy recovery;
  elf light / long / quick; ork deep wind-up / overshoot / swagger), subrace twists (2–6 %),
  stats (strength → depth / follow-through / overshoot; reflex → snappier strike, tighter chain;
  vitality, resilience, willpower, intelligence), body (height, bulk), weapon (inertia about the
  grip, hands, handle length, balance point, kind), per joint (seeded ±3 % amplitude, ±4 ms
  timing), live (fatigue F, injury I, low mana M, shaken S, smoothed at ln20 / 1 s).

## Before / after (artifacts/anim-report-before.json → artifacts/anim-report.json)

108 swings (4 races × 3 subraces × slash / chop / thrust × fresh / exhausted / low hp) + 72 loops
(walk 2.1 / run 6.5 m/s), engine cooldown = attack interval × weapon tempo.

| measure (worst case) | BEFORE | AFTER |
|---|---|---|
| planted-foot slide in swings, max / p95 mm | **69.3** / 43.6 (heel sweep under the swing yaw) | **5.3** / 4.4 (ork; human/elf/dwarf ≤ 4.4) |
| planted-foot slide in walk/run loops, mm | 3.5 | 4.6 (ork sway ×1.2) |
| sole under the floor, mm | 0.0 (ork sole floats 0.4 mm) | 0.0 |
| walk cycle seam (pose, consecutive wraps), ° | 0.38 | 0.45 |
| run cycle seam, ° | 0.87 | 2.04 (dwarf; quasi-periodic, see gaps) |
| swing end → idle velocity jump, °/s (240 Hz) | 55 | 96 |
| weapon vs own torso, guard / strike, mm clearance | 205 / 60 | 198 / 63 |
| hand vs own torso, mm | 4.7 | 5.7 |
| knee–knee (shin capsules) / foot–foot, mm | 51.9 / 63.1 | 49.1 / 60.5 |
| joint-limit violations | 0 | 0 |
| speed-limiter joint-frames (240 Hz, 108 swings) | 1164 | 1330 (thrust elbow at lock-out, 2H off arm) |
| recovery / strike peak weapon speed: slash, chop, thrust | 1.23–1.47, 2.27–2.99, 0.22–0.37 | 0.91–1.39, 1.24–2.54, 0.15–0.27 |
| fresh swing length / cooldown | 0.90 | 0.90 (never more) |
| tired / hurt swing length / cooldown | 0.90 | ≤ 1.15 (exhausted; see gameplay coupling) |
| phases human slash fresh (s) windup/strike/hold/recover/settle | 0.202/0.224/0/0.251/0 | 0.139/0.238/0.045/0.183/0.071 |
| … exhausted | identical to fresh | 0.180/0.249/0.061/0.248/0.125 |
| … low hp | identical to fresh | 0.147/0.238/0.048/0.214/0.096 |

### How different the styles are (styleVector RMS distance; 0.05 ≈ 5 % per coefficient)

Race means: human–elf 0.126, human–dwarf 0.293, human–ork 0.227, elf–dwarf 0.377, elf–ork 0.342,
dwarf–ork 0.256. Subraces within a race: human 0.028–0.056, elf 0.033–0.044, dwarf 0.057–0.095,
ork 0.036–0.043. Two seeds, same subrace: 0.011 (per-joint amplitude differs ≤ 6 %). Live, same
fighter: fresh–exhausted 0.745, fresh–low hp 0.677. On the real stat blocks
(`createFighter("Warrior", race, subrace)`): h-e 0.124, h-d 0.332, h-o 0.237, e-d 0.416, e-o 0.349,
d-o 0.278.

## Engine integration (`python3 docs/overhaul/lane-M-engine-patch.py`)

1. import `motionStyleFor`, `weaponMotionFromSpec`, `weaponMotionFromLegacy`, `LiveState`;
2. `#motionLive` (one reused LiveState: no per-frame allocation);
3. spawn loop, after `this.#armCombat(f, rig)`: `#applyMotionStyle(f, race, subrace, seed, height, weight)` — style from `profiles[i]`, the name seed, `animator.geometry`, `app.height/weight`, the spec (or classic weapon) and `f.stats`; `animator.setStyle` (steps the live smoothing), `drv.setStyle`;
4. `#armCombat` keeps the style on a rebuilt SwingDriver;
5. `#updatePose`: `animator.setLive(this.#liveOf(f))` before `animator.update(`, `attackDrive: drv.legDrive()` in its input;
6. `#beginSwing`: the attack state lasts windup + strike + recover + hold + settle.

Without the patch the engine runs as before (no style = today's swing and animator), except the
ball pivot, which is on for every animator (`pivotPitch: 0` disables it).

## Commands (real output)

* `deno task check` → exit 0; `deno task lint` → `Checked 420 files`.
* `NO_COLOR=1 deno task test` → `ok | 1112 passed | 0 failed (1m25s)` (1087 at start + 23 lane M + another lane's new tests).
* `deno run -A tools/anim-report.ts --before` (10.1 s), `deno run -A tools/anim-report.ts` (9.3 s).

## Honest gaps

1. **Chop recovery is faster than its strike** (recovery/strike peak 1.24–2.54): the warhammer's
   strike alone takes 0.5 s of a 0.88–0.98 s budget; the heavy floor never pushes a fresh swing
   past 90 % of the cooldown, so the remaining recovery is short. Fix = a longer chop cooldown
   (balance) or allowing the overrun. Slash 0.91–1.39 (≤ 1 only where the budget allows),
   thrust 0.15–0.27.
2. **Gameplay coupling**: a tired / hurt fighter's swing may outlast 90 % of the cooldown by
   `OVERRUN_FATIGUE·F + OVERRUN_INJURY·I` (≤ +35 % / +12 %), so the next blow waits (≤ 1.15×
   cooldown measured). Set both constants in MotionStyle.ts to 0 to keep the attack rate
   independent of the live state.
3. **Ork ball drift under the swing's whole-body yaw** 5.1–5.3 mm per stance (4.6 mm before; the
   legs have no yaw joint). The test asserts p95 < 5 mm and max < 6 mm for the ork, max < 5 mm
   for the other races. The twist DOF is therefore never scaled past its shape.
4. **Speed limiter** still clips the thrust's elbow at lock-out (IK rate is unbounded at full
   extension) and the two-handed off arm while the attack layer blends in during a short wind-up
   (1330 joint-frames over 108 swings at 240 Hz, 1164 before). Skill curves: 0 clipped (tested).
5. **Run seam**: the run is quasi-periodic (discrete lift-off / touchdown events quantised per
   frame; consecutive-wrap pose differences 0.3–2 °, before 0.7–0.9 °); the walk stays < 0.5 °.
   The wrap velocity jump (≈ 3× background) is the touchdown itself (a contact event), not a loop
   seam; not changed.
6. Swing end → idle velocity jump grew 55 → 96 °/s (the attack layer's spring fade after a
   shorter settle); still a C1 spring, no pose pop.
7. Clipping is measured against the combat capsule hitboxes (not the skin); the weapon is
   measured BEFORE ArmGuard (raw animation). Hands touch the chest capsule nowhere (≥ 5.7 mm).
8. Not browser-verified (no live capture this lane); numbers are from the headless engine-order
   harness on lane A's rigs.


## Parent integration (2026-10-31)

- `lane-M-engine-patch.py` applied (8 edits); the FighterPanel HUD edits that landed in parallel survived.
- **Heavy recovery fixed for arcs.** The lane capped the recovery inside the cooldown, so the
  recovery/strike peak weapon speed stayed 1.39 (slash) and 2.54 (chop): the hammer snapped back up
  faster than it fell. Now only the BLOW (wind-up + strike + hold) must fit 90 % of the cooldown; the
  recovery + settle are an interruptible tail: `SwingPlayer.recovering()` is true after the blow, the
  engine lets the next press start then, and `SwingDriver.begin` chains from the current pose
  (`SwingProfile.chained/from/fromWeight/fromLeg`: no snap to guard, weight and leg drive fade over the
  new wind-up). The attack rate is unchanged. Hand-path thrusts keep the old shared budget
  (`tailFree = false`): with a free tail their longer pull-back drew the ork greenhide's hand 3.7 mm
  into its chest (the report caught it; the measured test now includes ork/greenhide).
- After: recovery/strike peak speed ≤ 0.90 for every slash and chop (thrust 0.27), fresh blow ≤ 0.90
  of the cooldown, hand-torso ≥ +5.7 mm, slide max 5.22 mm (ork), soles 0 mm under the floor, 0
  limit violations. Tests: 1113 passed.
- `tools/probe-anim.ts`: contact sheets (4 sides × 6 beats) per race, pinned with
  `debugView({ swingHold: { at } })` (QA: the frozen world never advances the driver, so the hook
  refreshes its sample itself), `debugSwingInfo()`, `ANIM_POOLS` (hurt/tired) and `ANIM_WEAPON`.
  Vision: human 7, elf –, dwarf 8, ork 7, tired human 7 (guard visibly lower), ork warhammer 8;
  no clipping seen from any side. Recurring remark: the thin longsword is hard to read at distance.
- Behaviour notes: a tired/hurt blow may overrun its cooldown by up to 15 % (OVERRUN_* in
  MotionStyle.ts; set 0 to keep the attack rate independent of fatigue); the strike window's trail
  (0.25 × recover) is a few tens of ms longer with the heavier recovery.
