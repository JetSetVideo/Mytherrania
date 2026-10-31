# Mytherrania Data Science Log
Updated: 2026-10-10 (pass 4) | Build 572,228 B | Tests 60/60 | check 0 errors

Purpose: the memory of every hypothesis, measurement and verdict, so later passes
build on evidence instead of re-guessing. Claims without a test or screenshot are
marked UNVERIFIED.

## Test suite (deno task test) — 60/60
New this pass:
| File | Tests | What it proves |
|---|---|---|
| environment_test | 10 | sun/moon geometry, day phases, sky colour, light, cloud occlusion, fbm bounds |
| history_test | 4 | Wilson CI, descriptive stats, summary conservation laws, storage tolerance |

## Hypotheses — this pass
| ID | Hypothesis | Method | Verdict |
|---|---|---|---|
| H-sun-1 | Equinox noon at the equator → sun ≈ zenith | `solarPosition(80,12,0)` | VERIFIED (>85°) |
| H-sun-2 | Inverse: AM/PM symmetric around noon | elevation(12−h) = elevation(12+h) | VERIFIED (1e-9) |
| H-sun-3 | Higher latitude always lowers the noon sun | compare 4 places in June | **FALSIFIED**: June decl +23.4° puts the sun overhead at 23°N, so 12°N (78.6°) < 34°N (79.4°). Refined: monotonic only north of the declination (holds in December). |
| H-phase | 0h night, ~6h dawn, 12h day, ~18h dusk | `environmentAt` | VERIFIED |
| H-colour | Oppose: twilight horizon is redder than noon and midnight | R/B ratio | VERIFIED (dusk > 1.3 × noon) |
| H-light | Sun 0 at night, max at noon; moons light the night | intensity sweep | VERIFIED |
| H-cloud | Clouds over the sun dim the light, bounded [0,1] | occlusion sweep t=0..400 | VERIFIED; in-browser manifest shows occlusion drifting 0.69→0.88 over consecutive frames |
| H-hist | Every fighter appearance counts once; mirror match = 50% | conservation: Σgames = 2·matches, Σwins = matches | VERIFIED |
| H-ci | Swapping wins/losses mirrors the Wilson interval | wilson(3,10) vs wilson(7,10) | VERIFIED |
| H-csp | History bars never rendered | server CSP `style-src 'self'` blocks inline `style=` in innerHTML | CONFIRMED by code reading; fixed by setting widths through CSSOM |
| H-hp | AI HP ratio was wrong | `hp/100` while maxHealth is clamped 30–60 → AI always thought it was < 60% HP | CONFIRMED; fixed to `hp/maxHealth` |
| H-face | Faces were invisible | QA v2: heads read as black blocks. Cause: boxes buried inside the 0.18 r skull sphere (z=0.17) and lit by the dark cel bands | CONFIRMED; features now projected onto the skull surface, unlit |

## Engine state per QA screenshot (artifacts/qa-v4/manifest.json)
| Shot | Place | Hour | Phase | Sun elev | Occlusion |
|---|---|---|---|---|---|
| 03-time-dawn | Sunspire Steppe (12°N) | 6.4 | dawn | 4.2° | 0 |
| 03-time-noon | Sunspire Steppe | 12.5 | day | 68.9° | 0 |
| 03-time-dusk | Sunspire Steppe | 17.9 | dusk | −0.1° | 0 |
| 03-time-night | Sunspire Steppe | 22.5 | night | −67.4° | 0 |
| 04-greywall-dec | Greywall Keep (48°N), day 355 | 12.5 | day | 18.2° | 0 |
| 04-frostford-dec | Frostford (63°N), day 355 | 12.5 | dusk | 3.4° | 0.30 |
Result: a December noon at 63°N stays a dusk sky. That is correct behaviour (polar winter), not a bug.

## Arena balance (unchanged this pass; seed 20261009)
| Race | Balanced pairs | % |
|---|---|---|
| Human | 28/28 | 100% |
| Elf | 28/28 | 100% |
| Dwarf | 15/28 | 54% |
| Ork | 10/28 | 36% |
Open: Dwarf/Ork flat bonuses still break parity (see skill note: switch to percentage modifiers).

## Frame budget — re-measured (tools/frame-budget.ts → artifacts/frame-budget.json)
Live AI-vs-AI fight, 1440×900, headless Chrome 154, 241 frames per sample, 12,520 rig triangles:
| Sample | Engine CPU per frame mean / p95 / p99 / max | Frame cadence p50 |
|---|---|---|
| Day 12h (sun shadows on) | 1.60 / 1.9 / 2.2 / 2.3 ms | 16.7 ms (60 fps) |
| Night 23h (moon key, shadow off when dim) | 1.01 / 1.4 / 1.8 / 2.6 ms | 16.7 ms |
Budget 16.6 ms → day headroom ≈ 15 ms at p99. Caveat: this is the CPU cost of the rAF callback (simulation + draw submission). GPU execution time is NOT included, and a headless lab sample is not a real-display measurement.
Hypothesis H-shadow ("shadow pass is the main CPU cost") is SUPPORTED: night with shadows off costs about 0.6 ms less.

## Corrections to earlier entries
- The earlier "Anatomy checklist ✅" table listed parts as present in code. QA v2 showed several were not visible on screen (faces). Only screenshot-verified parts count as done.
- "Blue sky + clouds" (H4) and "ground auras" (H6) were marked PENDING before. They were not visible in QA v2 because the old skybox was built only at fight start and auras leaked. Both were rebuilt this pass; independent reviewers' verdicts are in artifacts/qa-v4/REVIEW-*.md.

## Pass 5 — fixes for reviewer B (REVIEW-B-ui.md, score 5.5/10)
| Reviewer finding | Root cause | Fix | Re-check |
|---|---|---|---|
| U6 FAIL: menu covers spectate | Spectate button never hid the menu | `hide()` before `onSpectate` | 07a/07b: no overlay, rings red during clash ✔ |
| U1: "timed" recorded for a ring-out; damage 30 vs 33.6 | Reason came from the arena rule, not the event; KO/ring-out ignored in timed/koth modes | `#endReason` from the real event; KO/ring-out ends every mode | 08: "by ring-out in 3.3s" ✔ |
| U5: loser fell to y≈−41 000 | No floor below the ring | clamp falling bodies at the valley floor | ✔ |
| U5: "You win!" in AI-vs-AI; no History button | fixed text | title names the winner + detail line (who, class, how, time, place, phase); History button | 08 ✔ |
| U3: Impact headings | 8 Impact declarations | fantasy serif stack (Cinzel/Trajan/Palatino) | 08 serif ✔ |
| U7 FAIL: no fingers / no sword / no face | face buried inside the skull; 3 floating finger boxes; flat weapon box | features projected onto the skull, catch-light iris; 4 two-segment fingers + thumb; grip/guard/pommel/steel blade/fuller | brows + eyes + sword visible; nose/lips still too small to read at 1280×800 ✘ |
| Isometric: black void, fighters overlap | void plane dark and small; no body-body collision | 260 m valley floor tinted by place; equal-mass separation | green terrain, fighters separated ✔ |
Open: faces read only partly (nose/lips sub-pixel); models still judged "toy-like" (1/10 anatomical); a hanging sword is hidden behind the body from some angles.

## Pass 6 — fixes for reviewer A (REVIEW-A-world.md, 4.5/10; it judged pass-4 shots)
| Finding | Status |
|---|---|
| E10 black void, dark title | already fixed in pass 5 (valley floor, lighter overlay) |
| E4 Frostford looks clearer than Sunspire | clouds faded out until 12% above the horizon, where gameplay cameras never look → fade now starts at 2–6% |
| E2/E3 no sun disc/moons | discs were out of frame; enlarged sun disc; new sky-aimed QA shots (03-sky-*) |
| E5 shadows ignore clouds | shadow intensity = 1 − 0.75·occlusion |
| E8 no nose/lips | darker nose (0.68–0.8 shade), red upper/lower lips, maw line |
| E9 17.9h shown as 17:53 | rounding to whole minutes |
| E7 rings always green | rings were green because the matrix freezes the sim; 07b clash shot shows red |
Round 2 dispatched to both reviewers (deleg_310fdea1). Shots must reach an "agree" from both.

## Pass 7 — round-2 verdicts and fixes
Reviewer A round 2: 6.0/10, disagree (2 PASS / 8 PARTIAL / 0 FAIL). Reviewer B round 2: 7.0/10, AGREE with reservations (4 PASS / 4 PARTIAL / 0 FAIL).
| Finding | Root cause | Fix | Evidence |
|---|---|---|---|
| Sword in the LEFT hand (B) | rig faces +z, so anatomical right is local −x; arm sides were mirrored | swap arm x sides, inward thumb | 05: sword on viewer's left = character's right ✔ |
| Shoulder offset invisible (A) | camera shifted but look-target was not → offset cancelled | shift the look-target by the same vector | 02: opponent unobstructed ✔ |
| No sharp sun disc (A) | halo saturated to white around the disc | halo ×0.4; disc drawn through thin cloud | 03-sky-sun-16h: sharp veiled disc ✔ |
| Only one moon (A) | moons rarely share a frame | calendar search → day 307 21h, 4.9° apart | 03-sky-two-moons: 2 discs ✔ |
| No iris at distance (A) | iris 0.03 m, skin-coloured | 0.05 m stylised iris + limbal ring, contrast-checked colour | 02: blue iris at fight distance ✔ |
| Title still dark (A, B) | full-screen overlay | dim only a framed centre panel | 01-title-noon: about 80% of frame undimmed ✔ |
| Rings ambiguous (B) | thin 0.12 m ring; vision passes disagree | 0.2 m ring, opacity ≥0.75; **pixel measurement** | 07a: 2 orange clusters; 07b: 1 red + 1 orange ✔ |
| Long low-sun shadows missing (A) | ±12 m shadow frustum clipped them | frustum = 12 + 6/tan(elev), max 30 m | pending round 3 |
Lesson: when two vision passes contradict each other, measure pixels (PIL colour clusters) and hand reviewers the numbers to cross-check.
Round 3 dispatched (deleg_74c33e43).

## Pass 8 — balance forensics: the reported race/class balance was meaningless
Three separate defects made every balance number in this log wrong.

**Bug 1 — race bonuses REPLACED stats instead of adding to them.**
`raceCombatBonus` returned absolute values (maxHealth 2, attackPower 0) and every caller
spread it OVER the class stats: `{...createStats(cn), ...raceCombatBonus(...)}`. So a human
or elf fighter ended up with **2 HP and 0 attack power** — mathematically unable to damage
anyone, which is why "Human 28/28 (100%)" and "Elf 28/28" looked perfect: every fight was a
draw, and draws are excluded from the denominator. Ork (36%) and Dwarf (54%) were the only
races whose bonus happened to leave survivable numbers.
Fix: `raceCombatDelta` returns additive deltas; `applyRaceBonus(base, race, subrace)` adds them
and clamps. Reflex now REDUCES attackInterval (it used to make you slower).

**Bug 2 — the arena gave both fighters one shared RNG stream, fighter A always drawing first.**
That is a position-dependent bias, so the harness was partly measuring stream order.
Fix: each fighter draws from its own stream.

**Bug 3 — all eight classes had IDENTICAL combat stats.**
`PRESETS` was `{maxHealth:45, attackPower:9, attackInterval:1, armor:4}` for all eight, so the
only difference was crit, and over half of all fights were mutual kills (draws). "Class balance"
was measuring coin flips.
Fix: combat stats are now DERIVED from each class's primary attributes (barbarian = slow tank,
assassin/archer = fast skirmishers, mage/necromancer = fragile high damage), and each class's
damage is solved so all eight share the same DPS x effective-HP product — the quantity that
decides a deterministic duel.

**Measurement (seed 20261009, 3000 fights/pair, decisive-only):**
| Stage | Balanced pairs |
|---|---|
| Before (broken bonuses, identical classes) | Human 28/28, Elf 28/28, Dwarf 15/28, Ork 10/28 — all invalid |
| Additive race deltas | 22/28, 23/28, 8/28, 16/28 |
| Distinct per-class stats | 0/28 |
| Damage solved for equal DPS x eHP | 5/28 |
| Calibration loop | in progress — see artifacts/tune.json |

**Lesson:** a balance figure is only meaningful once you have checked that (a) stat modifiers
add rather than replace, (b) the two sides are not sharing an RNG stream, and (c) the classes
are not stat-identical. Otherwise the harness reports a number that has nothing to do with balance.

### Final balance state (seed 20261009, 4000 fights/pair, decisive-only)
`tools/balance-report.ts` prints the mirror matchups, the per-class field average and the full
pair matrix, so a "48-52%" claim can be checked against what it actually means.

**Mirror matchups — the spec's literal criterion ("two bots of identical level and gear tier"):**
| Class | Win rate | Class | Win rate |
|---|---|---|---|
| Barbarian | 50.0% | Mage | 50.6% |
| Warrior | 51.1% | Necromancer | 51.0% |
| Rogue | 50.9% | Archer | 50.6% |
| Assassin | 50.5% | Priest | 50.5% |
All eight are inside 48-52%. PASS.

**Cross-class pairs: 3/28 inside the band.** The rest spread 33-67%. Per-class field average 43-58%.
Honest statement: the archetypes are soft counters, not interchangeable — an assassin beats a
necromancer about 64% of the time. Getting EVERY distinct pair inside 48-52% would require the
eight classes to have nearly identical DPS x effective-HP, i.e. to stop being distinct archetypes,
which contradicts the roster. Recorded as an open item, not a solved one.

**A rejected approach, recorded so it is not retried:** a closed-loop calibration that nudged each
class's damage toward a 50% field average drove the average to exactly 50% while producing a
rock-paper-scissors lock (many pairs at 0%/100%) and 0/28 in band — worse than no calibration (3/28).
The loop optimised the wrong objective (per-class mean, not per-pair parity). The calibration table
is therefore left at zero. The tools remain in place for a per-pair objective.

**Also needed to make a win-rate band meaningful at all:** `attackDamage` gained a per-hit damage
spread (`DAMAGE_SPREAD = 0.35`). Without it the duel is a step function — whichever class has slightly
more DPS wins essentially always — and the calibration loop oscillated between 3% and 99%.

## Pass 9 — shadow verification and reviewer round-3 outcome
**Round-3 verdicts: reviewer A AGREE (7.5/10, was 6.0), reviewer B AGREE (7.0/10).** Both independent
agents now accept the current build.

**Reviewer A caught a false claim of mine.** I had claimed "sun shadow frustum widens at low sun" in
round 2. It was not visible. Root cause found: the key light's height was clamped to
`Math.max(dir.y, 0.15)` — about 8.6° — so at a 4.2° dawn the sun was forced twice as high as reality
and every shadow was halved. The light is now placed at the true elevation (floor 0.03) at 60 m.

**H-shadow-length (verified with a 4-shot series, isometric, same arena):**
| Hour | Sun elevation | Shadow length vs character height |
|---|---|---|
| 06:36 | ~6° | 1.5-2 x |
| 12:30 | ~66° | about 0.25 x |
Confirmed by vision on 03-shadow-elev06.png vs 03-shadow-elev66.png. Note: at a 4° sun the geometric
shadow is ~23 m and the arena platform is only 12 m across, so the very longest shadows leave the
platform — a consequence of the arena size, not a shadow bug.

**CORRECTION (pass 13):** the "confirmed by vision" line above is NOT sound. Reviewer A's three
agreeing passes found the low- and high-sun frames indistinguishable, and the manifest explains why:
the dawn frame is at 7.1 deg with 48% cloud occlusion, so its 13.6 m shadow mostly leaves the 12 m
platform and is further dimmed to 64% intensity. The lighting fix is real; the claim that the
lengthening is VISIBLE on screen was an overstatement.

**Balance loop status:** the calibration now measures the same stat path the game uses (the override
applies on top of the race bonus). Earlier tuner numbers were invalid because it measured race-neutral
stats while `arena:race` applied a race bonus, so the two disagreed. Current best: see artifacts/tune.json.
Class balance is NOT yet inside 48-52% and is reported as an open item.

## Pass 10 — rigging, class skills, weapon generator, effect shaders
**Gate:** 0 type errors, 95/95 tests, lint clean (83 files), build 606 KB.

### What was added
| Layer | File | Contents |
|---|---|---|
| Skill roster | src/game/Skills.ts | 24 skills — 3 per class (dash / power / defence), each named, described, with an element and an animation profile |
| Animation maths | src/game/AnimationCurve.ts | sin/cos impulse envelope, damped oscillation, per-joint clamping, lunge, hop, damage-scaled effect |
| Weapon generator | src/game/WeaponGen.ts | parts from parameters (shaft/blade/curve/weight/metal), 6 metals, parameter-driven naming |
| Skill runtime | src/game/SkillRuntime.ts | cooldowns, stance buffs, damage-over-time, AI skill triage |
| Effect shader | src/graphics/shaders/EffectShader.ts | elemental aura + hot core on the weapon, strength from damage dealt |
| Skill artwork | src/graphics/SkillArt.ts | procedural icon per skill (chevrons / burst / shield), seeded per id |
| Rig wiring | src/game/Skeleton.ts, src/graphics/Humanoid.ts, WeaponMesh.ts | curve-driven joints, generated weapon mesh, effect shell |

### The animation equation
    angle(t) = rest + amplitude * impulse(t, peak) + wobbleAmp * dampedSin(t, freq, phase)
    impulse(t,p) = sin(pi/2 * t/p)  for t < p        <- rise
                 = cos(pi/2 * (t-p)/(1-p))  for t >= p  <- fall
Continuous at the peak, deliberately asymmetric (fast strike, longer recovery — asserted by
comparing the rise and fall areas). Every track is clamped into its joint's real limits, and a
test asserts no skill clamps on more than 25% of its samples, so the poses use their range
rather than pinning against a bound.

### Class flavour (examples, all asserted in tests)
| Class | Dash | Power | Defence |
|---|---|---|---|
| Warrior | Shield Dash (closes 2.9 m) | Crushing Blow (stun 0.7s, fire on the blade) | Bulwark (armour x2.0, speed x0.6, interval x1.3) |
| Barbarian | Reaver's Charge (knockback x2.1) | Skullsplitter (stun 0.85s, damage x2.3) | Iron Hide (armour x2.2, speed x0.55) |
| Rogue | Shadowstep | Venom Strike (14 damage over 4s) | Evasion (speed x1.25 but damage x0.45) |
| Assassin | Death Mark | Execution (x2.6, 15% lifesteal) | Vanish |
| Mage | Blink | Arcane Nova | Mana Shield (armour x2.4) |
| Necromancer | Grave Step | Soul Rend (35% lifesteal) | Bone Armor (armour x2.6) |
| Archer | Rolling Shot (retreats 2.6 m) | Piercing Shot | Steady Aim |
| Priest | Divine Step | Smite (stun 0.75s) | Sanctuary (25% lifesteal) |

### Effect strength follows the damage
`effectStrength(anim, t, damageFraction) = intensity * (0.35 + 1.15 * fraction) * impulse(t, hitAt)`
so the flare is scaled by the share of the target's MAXIMUM health the strike removed, and it
rides the animation envelope so it dies with the swing. Tests assert a graze < a solid hit < a
huge hit, that the effect fades after the strike, and that it stays bounded.

### Bugs found and fixed during this pass
1. **Rogue's Evasion never animated the weapon arm** — caught by a test that requires every skill
   to animate `shoulderR` with its peak on the hit frame.
2. **Defence skills' hit frame disagreed with their pose peak** (0.2 vs 0.3) — the guard would have
   resolved before the shield was up.
3. **`OffscreenCanvas` has no `toDataURL`**, so every generated skill icon silently returned "".
   Caught by a browser probe asserting `naturalWidth > 0` on the rendered images.
4. **The weapon effect was invisible on a bright day** — the first shell was additive-only and
   blade-sized. It is now a larger aura (1.7x blade width) plus a hot core, so it reads in daylight.
5. **The QA captures were racing the animation** — a 0.85 s swing ends before a screenshot lands.
   Added a hold-at-frame debug hook, and an orbit inspection camera because the gameplay cameras
   hide the weapon behind the player's own body.

### Evidence
- 40 skill screenshots in artifacts/qa-skills/ (4 orbit angles + one live shot per case), 0 errors.
- Vision confirmed: the Warrior's blade shows a translucent glow along it, the Mage's staff head
  emits a cyan aura, the poses are overhead strikes, and the three HUD icons are a chevron, a
  starburst and a shield.
- Probe: 3 skill icons, each ~4 KB of PNG, all loaded.

## Pass 18 — consolidated spec, dead code wired, and the balance tooling repaired

**Spec.** `docs/SPEC.md` (v2) consolidates every prompt into ids, definitions, equations, bounds
and an honest status (LIVE / TESTED / MODEL / OPEN). `docs/SPEC-tables.md` is GENERATED by
`tools/gen-spec-tables.ts`; `tests/spec_test.ts` pins the cross-module bounds (L1–L2, S1, P1–P5,
H1–H2, D1).

**Dead code removed by wiring, not deleting.** Items, Status, Ragdoll, FogOfWar and Senses had
no runtime caller. `Engine.#tickWorld` now drives them per frame; `snapshot().world2` exposes
them. `tools/probe-world.ts` (real Chrome): fog explored 0.896 → 1.0; stun observed; forced
ragdoll appeared, settled and cleared; forced coin spawned and was collected. 0 page errors.

**Five bugs found by measuring instead of assuming:**

| # | Bug | Effect | Fix |
| --- | --- | --- | --- |
| 1 | Stun fed scaled damage | each hit stunned ~10 s after ×1000 HP | divide by `DAMAGE_SCALE` (SPEC H1) |
| 2 | Ad-hoc engine luminosity | sight pinned near its night floor (10 m) on a real afternoon | `luminosity()` smoothstep −6°…20° (SPEC L1/L2) |
| 3 | Speed read from `body.vx` | that field holds only knockback, so walking/dashing never counted | measured, smoothed velocity; relative closing speed (SPEC P5) |
| 4 | Harness ignored physics | balance numbers described a different game | harness applies `physicsMultiplier`; Barbarian then 99.7% |
| 5 | Tuner clamp + compounding | clamped damage to raw 5–14; fitted on top of the imported calibration and saved as absolute — reported 0.07% deviation while the game sat at 70/34% | scaled clamp; divide out the imported calibration; STEP 0.22 → 0.03; select by mean deviation, not pair count |

**Balance after the fixes** (seed 20261009, 4000 fights/pair, decisive-only): all eight class
field shares 49.4–50.6%; mirrors 48.7–51.1%; pairs 44–56%, **15/28** in 48–52% (17/28 at 2000
fights/pair). Per-class parity met; pairwise band not met.

**Correction to Pass 17.** It reported lint clean. `deno task lint` actually had 7
`no-explicit-any` errors in QA probe tools, two of them (`probe-ko.ts`, `probe-truce.ts`)
written that pass. Fixed with a scoped file-level ignore; lint is now clean (104 files).

## Pass 17 — body physics, wall resistance, and death as the only ending

**`src/game/Physics.ts` (new).** Bodies are composite: mass, volume and area are SUMMED
over parts, and density is total mass over total volume — so bolting a steel plate onto a
light frame raises the whole body's density, and a hollow cavity lowers it. Collisions use
momentum, not a flat number:

```
reduced mass  mu = m1*m2/(m1+m2)      equal masses -> m/2, a wall -> m1
impulse       J  = mu * (1 + e) * |dv|
toughness     T  = density * (0.4 + 0.6*armour) * sqrt(area)
damage        D  = J / T
```

Everything the brief asks for falls out of that rather than being special-cased: the
heaviest fastest body hurts the slowest thinnest one most, because mass raises J and a thin
body lowers T. Also: `fallDamage` (mass x v² / toughness), `terminalVelocity`, `hitWall`,
and `resolveImpact` returning momentum, energy, impulse, damage, knockback and a
`glanced` flag. Tests cover equal-mass/different-density defenders (a thin one takes more
than a dense one of the SAME weight), a retreating defender taking less, and knockback
throwing a light body further.

**Wall resistance.** A wall absorbs `wallResistance` N·s; a body whose momentum exceeds it
breaks through and damages it, otherwise it rebounds and keeps `wallBounce` of its speed.
`hasWalls(cfg, rng)` rolls `wallChance` (0.9, as asked), with resistance spread 900–9000 so
some walls stop a juggernaut and some do not.

**Arena size is now 2 m to 320 m** (was 40), and the field preset spans 14–120 m.

**Death is the only victory condition.** Ring-out no longer ends a match: the body falls,
takes `fallDamage` from the drop, and is placed back inside the ring. The clock and the
hill are display-only. Verified live — `winCondition: ko`, 0 non-ko endings over 20 samples,
5 frames with an active ring-out and the fight continuing.

**Physics now drives damage.** `#resolveHit` multiplies by a term built from the attacker's
and defender's mass ratio and DENSITY ratio, plus a closing-speed factor, clamped to
0.6–1.8. A fighter's physical body is derived from its attributes (`#bodyOf`), so a
barbarian is both heavier and denser than an assassin and therefore hits harder and takes
less from the same blow.

**Two bugs found by the new tests:**
1. `seededRng` returned correlated FIRST values for sequential seeds (0..499 all landed in
   0.236–0.429), so a one-draw decision — "does this arena have walls?" — came out 100%
   instead of 90%. The seed is now hashed first.
2. The wall breach threshold (ratio > 1.6) against a 2600 N·s default meant a 122 kg body
   needed 34 m/s to break through: unreachable at any realistic speed. Threshold is now
   1.05 and the default resistance 2200, so a charging juggernaut breaks through and a
   walking skirmisher does not.

**Gate:** 0 type errors, 176/176 tests (28 files), lint clean across 100 files,
build 620 461 bytes.

**Not done this pass:** the "more options, more detailed animations and statistics" part of
the brief. The ring shape still is not built as a mesh, and walls are not yet placed in the
scene — the physics and the parameter model are ready, the rendering is not.



## Pass 16 — the opening truce, identity, fog of war, and a shaped arena
**The 6-second truce (verified in a real browser).** Friendly for 3 s, neutral for 3 s,
hostile after 6. `src/game/Disposition.ts` owns the clock; the ground ring shows the
disposition (green → amber → red) and the HUD status line names it. Damage is gated in
**one** place — the top of `#resolveHit` — so the player's swing, the AI's swing and a
skill strike are all covered by a single check. The AI roams on a Lissajous path during
the truce instead of closing in.

Browser probe (`tools/probe-truce.ts`), live:
```
t=0.6s friendly canAttack=false remaining=5.4 hp=48750/48750
t=1.8s friendly canAttack=false remaining=4.2 hp=48750/48750
t=3.3s neutral  canAttack=false remaining=2.7 hp=48750/48750
t=5.8s neutral  canAttack=false remaining=0.2 hp=48750/48750
t=7.3s enemy    canAttack=true  remaining=0   hp=48715/48750   <- first damage
```
Zero damage across every sample inside the truce, and damage only after it lifts.

**Two clocks, not one.** The truce needed its own `#sinceStart`; reusing `#elapsed`
(which pauses on a winner) would have opened a rematch already hostile.

**Identity.** `src/game/Identity.ts` generates a unique id and a name per fighter
(`MY-786218 Halric of Low Water`, `MY-F2011C Aldric the Remembered`), deterministic from
a seed, with `makeRoster` guaranteeing no duplicate ids or names. Shown in the HUD and
carried in the snapshot.

**Fog of war.** `src/game/FogOfWar.ts` — a per-fighter grid with two layers: `seen`
(remembered, stays) and `visible` (cleared each frame). `reveal` accepts the same lens
the senses use, so the minimap matches perception rather than being a plain circle.
`fogAscii` dumps it for the manifest.

**Senses adapt.** `senseAdaptation(env)` mutates all five senses with light, cloud,
weather, fatigue and agitation: sight collapses at night, hearing becomes the night
sense, rain masks sound, adrenaline sharpens touch. Sight never reaches zero.

**Arena: shape, glider, solid outside ground, objects.** 15 new parameters (44 total):
`shape` (circle/triangle/square/pentagon/hexagon/octagon/oval/diamond), `aspect`,
`rotation`, `outsideGround`/`outsideCollision`/`outsideHeight`/`outsideFriction`,
`glider`/`glideSpeed`/`glideSink`/`updraft`/`glideFuel`/`gliderPads`, `objects`/
`objectSpread`. `ringRadiusAt` uses the apothem/cosine form for polygons, the polar
ellipse for the oval and the taxicab form for the diamond, so ring-out now follows the
outline rather than a fixed radius. `placeObjects` scatters props inside the shape,
clear of the spawn lane and of each other.

**Gate:** 0 type errors, 159/159 tests (26 files), lint clean across 98 files,
build 612 000 bytes.

**Not yet wired:** the ring shape does not yet build a shaped floor mesh, the glider has
no input binding, the outside ground is not yet a colliding plane in the scene, and the
fog grid is not yet fed to a minimap widget. The modules are built and tested; the
engine still renders the original circular ring.



## Pass 15 — senses, arena parameters, items, statuses, ragdoll, and the ×1000 fix
**New pure modules (all unit-tested, no Three.js, no DOM):**
- `src/game/Senses.ts` — the five senses (sight, hearing, touch, magnetism, scent) with
  per-sense ranges, gear modifiers and race traits; a helmet costs ~45% of hearing but
  only ~30% of sight. The aggro volume is a **lens, not a globe**: `lensFactor` tapers
  with elevation (`1 - flatten*|sin e|`) and stretches forward with agitation
  (`1 + forward*cos(az)*a`), with a capped `tan` term. A calm creature watches all round;
  an enraged one loses the area behind it. Sight outranges hearing by design.
- `src/game/ArenaConfig.ts` — 29 parameters in 7 forge-style categories (space, ground,
  phases, population, items, hazards, atmosphere), each with a documented range. `size`
  runs 2 m to 40 m as asked. `randomArena(rng)` is seeded and reproducible.
- `src/game/Items.ts` — coins that pop, fall and land flat; `decideDistraction` models
  breaking off a fight for a coin, and it is deliberately rare (measured 20-200 per 1000).
- `src/game/Status.ts` — stunned / hypnotised / controlled / burning / poisoned / chilled /
  blessed / hasted / slowed, with control handover to a caster and dispels by spell school.
- `src/game/Ragdoll.ts` — Verlet ragdoll with distance constraints and ground contact.

**Three bugs found while wiring the health multiplier:**
1. `applyRaceBonus` clamped to the pre-scaling absolutes (`max(30, min(60, hp))`), so every
   fighter dropped back to 60 HP the moment a race was applied — while `createStats()` alone
   tested fine. Clamps now go through the exported scale constants.
2. `Leveling.ts` had a second `deriveCombatStats` with its own unscaled `maxPotentialHealth`.
3. The damage solve pins to its floor when health scales: `damage = INDEX*interval/ehp` and
   `ehp` grows with health, so the numerator needs `HEALTH_SCALE * DAMAGE_SCALE`. With the
   wrong factor all eight classes reported damage 5000 (identical) — differentiation gone.

**Health ×1000 (as instructed):** Barbarian 53 257 HP, Mage 40 907, Assassin 40 307, with
damage 853 / 1057 / 858. Fights run 40-80 s instead of ~5 s.

**Ragdoll settle had to be measured on the centre of mass.** Per-node Verlet deltas never
decay: gravity re-injects a displacement every step and the constraints push back, so a
perfectly still body shows a constant residual (~2e-4). The settle test now watches the
centre's drift and fires under 0.3 mm/step.

**X/Y/Z axis views:** `tools/qa-axis.ts` captures 24 orthographic shots (8 classes × 3 axes)
with the model's bounding box in metres beside each. Getting a *clean* shot needed three
fixes: the HUD/hints/settings DOM had to be hidden (the HUD container had no id at all), the
opponent had to be hidden (the render loop reset `group.visible` every frame), and the arena
rim had to be clipped by the near plane so it did not hide the legs.

**Gate:** 0 type errors, 136/136 tests, lint clean across 93 files, build 608 832 bytes,
24 axis screenshots with 0 console errors.

**Not yet wired into the engine** (modules exist and are tested, but nothing imports them yet,
so they are tree-shaken out of the bundle): the roam phase, arena-config-driven sizing,
coins in the arena, statuses on hit, and the ragdoll on ring-out. The 10-second roam the brief
asks for is defined (`roamSeconds: 10`) but the fight still starts aggressive.


## Pass 14 — the bow, and an honest stop
Reviewer A round 4 flagged "the archer's bow is absent in two agreeing passes". It was right.

The bow went through **five** attempts and still does not read unambiguously as a bow in the QA
screenshots. What is definitely fixed along the way:
- Limbs were 0.035 m wide and dark, so they read as an empty hand -> now 0.085 m and the bright metal.
- The effect shell was wrapping the limbs AND the riser, drawing a 0.44 m translucent bubble over the
  grip — the "hexagonal shield" the reviewer kept seeing. A bow now gets **no** shell at all, because
  its riser is too small for an aura that does not just hide the silhouette. A bow's elemental effect
  belongs on the projectile, which does not exist yet.
- The geometry was wrong: limbs swayed so the tips flared PAST the grip. It is now constructed
  properly — `half = 0.45 * L` from grip to tip, `gripX = 0.28` of bulge, limb length
  `hypot(gripX, half)`, tilt `atan2(gripX, half)`, and a straight string between the two tips. A test
  asserts opposite limb tilts and the presence of the string and riser.

**Honest result:** after all of that, the reviewer still reads it as "a blocky brown frame and a
straight dark vertical element" — not a bow. The geometry is right and the occlusion is gone, but at
the QA camera distance a low-poly bow is a thin flat object and it does not read. This is left OPEN,
not claimed as fixed. The next honest step is an arrow/nock effect and a thicker silhouette, not more
reshaping of the same thin limbs.

**Also corrected in this pass:** `tools/measure-shadow.ts` exists and decodes PNGs in a headless
browser, but its two attempted measurements were confounded (walls and valley counted as shadow;
dawn frames too dim for the floor test, giving impossible >100% denominators). It is left in the repo
with its numbers explicitly marked as NOT evidence.

## Pass 13 — round-4 reviewer A, and a correction to my own shadow claim
**Reviewer A round 4: AGREE, 7.0/10 (2 PASS / 1 PARTIAL / 1 FAIL).**

**It is right and I was wrong about the long low-sun shadows.** I claimed in pass 9 that the 4-shot
series proved shadows lengthen from ~0.25x character height at a 66 deg sun to 1.5-2x at 6 deg. That
claim rested on a single vision pass and does not survive checking:
- The manifest shows `03-shadow-elev06` is at **7.1 deg elevation with 48% cloud occlusion**, in the
  `river` arena. A 7.1 deg sun casts `1.7 / tan(7.1) = 13.6 m` of shadow, and the arena platform is
  only 12 m across — so most of the shadow leaves the platform before it is drawn.
- Cloud occlusion additionally dims it: `shadow.intensity = 1 - 0.75 * 0.48 = 0.64`.
- What remains on the platform is a short contact shadow, which is exactly what reviewer A reported
  across three agreeing passes. The round-3 open item was therefore still open, and my "verified"
  note was an overstatement.
**Honest statement:** the light direction does follow the true sun elevation (that fix is real and the
code is unambiguous), but the arena is too small to show a long shadow at low sun, so the feature
does not READ as long shadows on screen. Making it read needs a shadow-receiving surface beyond the
platform (the valley floor), not a lighting change.

**Pixel measurement attempted and abandoned as confounded.** `tools/measure-shadow.ts` decodes the
PNG in a headless browser and counts dark, low-saturation pixels near tan floor pixels. First pass
(any dark pixel) gave a monotonic 24.3% -> 12.9% as the sun rose, but the bounding box covered the
whole frame, so it was counting the walls and the valley too. Second pass (shadow only near floor)
gave impossible numbers — 229% and 378% "of floor pixels" at dawn — because at 7 deg the floor is too
dim to satisfy the tan-floor test, so the denominator collapsed. The tool is left in the repo but its
numbers are NOT evidence for or against the claim. A clean measurement needs a fixed reference frame
(same arena, occlusion forced to 0, the character at a known position), which is not what these
screenshots are.

**Reviewer A's other findings:**
- Fight-start framing: PASS (opponent's head, both shoulders, chest and both arms now visible).
- Dawn sun high in frame: ACCEPTED as a camera-pitch consequence, no longer a defect.
- Archer's bow absent: CONFIRMED as a real visibility bug — the limbs were 0.035 m wide and read as
  an empty hand. Thickened to 0.06 m with a riser block and a brighter string.
- "The effect is a ground ring, not a weapon aura": the ground ring is the separate STATE aura. Later
  crops show the weapon effect clearly (the Mage's staff reads "pale, icy cyan-white"), so this was
  the reviewer looking at the wrong element rather than a missing effect.

## Pass 11 — round-3 verdict acted on, framing corrected
**Reviewer A round 3: AGREE, 7.5/10 (PASS 6 / PARTIAL 4 / FAIL 0).** Its one "not delivered" item was
the long low-sun shadows — judged on screenshots taken BEFORE the light-height fix, so that finding
is stale; the 4-shot shadow series (pass 9) verifies shadows lengthen from about 0.25x character
height at 66 deg to 1.5-2x at 6 deg.

Two real framing problems remained, and one was my own regression:

1. **Fight-start occlusion.** In pass 7 I "fixed" the shoulder camera by offsetting BOTH the camera
   and its aim point by the same vector. That is a pure translation, so the player stayed dead
   centre. Worse, geometry shows a sideways offset cannot separate the two fighters at all while the
   camera aims along the line joining them: with a 1.45 m offset and the aim at the midpoint, the
   player lands only 0.48 m off the aim axis, well inside their own 5 deg angular radius.
   Fix: raise the camera 1.55 m above the shoulder line and aim 55% of the way to the opponent, so it
   looks OVER the player. Verified: the opponent went from "head only visible" to head, shoulders,
   upper chest and one arm visible.
   Still open: the opponent's legs remain behind the player. Fully separating them needs a near
   top-down camera, which would change the game's feel; recorded as a deliberate trade-off.

2. **The dawn sun looks high in the sky.** Not a sun-position bug: the third-person camera pitches
   down about 24 deg, which puts the true horizon at the very top of the frame, so a sun at 4 deg
   elevation still renders near the top. Lowering the pitch to 0.26 moved the horizon to mid-frame
   but broke the fight framing, so the pitch was restored to 0.42. The honest statement is that the
   camera framing trades sky against readability; the sun's direction itself matches
   `Environment.solarPosition` and is asserted in tests.

## Pass 12 — round-4 reviewer B acted on
**Reviewer B round 4: AGREE, 7.5/10 (2 PASS / 3 PARTIAL / 0 FAIL).** Its three partial items were all real:

1. **The weapon arm barely moved — a sign error, and the biggest find of the pass.**
   `strikeTracks` used a POSITIVE shoulder amplitude, but the rig's convention is that a negative
   shoulder angle raises the arm (the idle attack pose is `shoulderR: -1.7`; the shoulder's own limit
   is `-2.4..0.6`). So every swing pinned the shoulder against its +0.6 maximum for roughly 80% of
   the animation — the weapon drifted slightly BACKWARD instead of chopping. Fixed by negating the
   amplitude (and the off-hand elbow, which had the same inversion).
   Why the test suite missed it: the clamp assertion averaged over every joint in the skill, so one
   joint pinned for 80% of the swing was diluted to ~10% overall. The test is now PER JOINT, and a
   new test requires the weapon arm to travel a real distance — over 40 degrees for a dash or stance
   and over 74 degrees for a power strike. Four skills failed that new test on the first run.
2. **`player.pose` read "idle" during a strike.** `setPose` assigned `this.pose = pose` BEFORE its
   early return, so the engine's per-frame pose update overwrote the skill's ownership. The skeleton
   now reports a dedicated `"skill"` pose and refuses to be clobbered while a skill is playing.
3. **Effects saturated to white, so elements were indistinguishable.** The hot core was added at full
   strength over the element colour. The core now contributes only through a high power, so the hue
   dominates: verified the Mage's staff reads "pale, icy cyan-white, clearly not white/orange".
4. **The Barbarian's greataxe read as flat orange/tan, not metal.** The cel shader had no specular
   term at all. Added a specular highlight driven by a per-material `uSpecular` (metal parts only;
   grip and string stay matte). Verified: the axe head now reads "grey/silver metal with a bright
   specular highlight... not flat orange or tan".
5. Also fixed: Rogue's Evasion drove the same joint twice (the second track silently shadowed the
   first). A new test forbids duplicate joint tracks in any skill.

Gate: 0 type errors, 99/99 tests, lint clean, build 607 KB.

---

## Pass 20 — Adaptive AI, telemetry, weapon/balance/camera animation layer (2026-10-10)
Gate: 0 type errors | 246/246 tests | lint clean 124 files | build 692,317 B.

The user asked for AI that differ by name and adapt from wins/losses, a telemetry
layer feeding min/max/avg/median to the models, varied win conditions, an instant-
battle corpus, and an animation/physics pass (sword orientation, hand/fist
constraints, camera occlusion, balance recovery). Built as pure modules first
(TDD), wired into the engine second, verified in a live headless-Chrome probe.

### New pure modules (all unit-tested)
| Module | Tests | What it proves |
|---|---|---|
| game/AiStats.ts | 9 | per-AI identity (stable id+name from a seed), Telemetry fold (min/max/mean/median/sd), distance-travelled, distance-to-enemy, dealt/prevented/missed damage, altitude/x/z axes, 80/50/20% hp threshold snapshots, fastest-kill, peak 5s damage window, favourite technique; the digest never emits NaN even when a body leaves the world |
| game/AiBrain.ts | 5 | a win makes the brain bolder (aggression up, cowardice down, neural trust up), a loss more cautious, all inside declared bounds; applyPersonality rewrites distance thresholds without mutating the base tree; tree mode ignores the network |
| game/WinConditions.ts | 6 | death always wins (either fighter, double-KO = draw), rolled params in bounds and reproducible, the roll spreads across ko/sudden-death/endurance/domination, endurance resolves at the bell, domination at the ratio, sudden-death arms after its deadline |
| game/Balance.ts | 6 | a harder hit displaces further; strength/health speed recovery, armour slows it; impact side flips the sway; the damped sinusoid decays to rest and the analytic form matches; a big hit staggers, a huge hit knocks down (STAGGER_OFFSET < KNOCKDOWN_OFFSET) |
| game/GripStance.ts | 7 | rest grip points the blade up (not at the ground), thrust levels it forward, guard lifts it near-vertical (<0.2 rad of upright), defense->guard and thrust->thrust, consecutive swings alternate the arc plane, the solver eases without snapping, the fist closes for a strike |
| game/CameraOcclusion.ts | 6 | a wall hugging the character fades near-transparent, a far wall stays opaque, alpha rises monotonically with distance, blockDistance detects a wall on the camera line and ignores off-axis / behind-camera / zero-length geometry |
| balance/BattleCorpus.ts | 6 | one record per fight with a decided winner path, reproducible from a seed, exploration spreads ending reasons, match-ups span classes/races/arena sizes/conditions, axisCoords normalises every axis to 0..1 |

### Live probe (tools/probe-ai.ts, headless Chrome, Metal ANGLE) — ALL PASS
AI-vs-AI spectate, walled 18m arena. Measured from the engine snapshot:
- Both fighters have a unique AI id + generated name (Yorick the Patient AI-A2194D,
  Tova the Quiet AI-7DA910) and a live adaptive brain.
- Telemetry accumulates: Yorick travelled 333.27 m, Tova 275.45 m; distance-to-enemy
  avg ~5.9 m; dealt max 991/1786, dealt avg 338/494; prevented avg 331/386; hp
  threshold crossings (80/50/20%) recorded per fighter.
- Weapon grip alternates with the technique: thrust pitch -1.345, swing -0.836,
  rest -0.35; fist 0.85 at rest, 1.0 on a strike.
- Brains adapt on the result: after the first fight the winner's personality moved
  (aggression 0.3->0.35, cowardice 0.3->0.25, neuralTrust 0.4->0.45) and the
  loser's the other way.

### Instant-battle corpus (tools/battle-corpus.ts)
`deno run -A tools/battle-corpus.ts 500 3 0.65`: 500 headless fights, endings
ko=248 / domination=97 / sudden-death=92 / endurance=63 (50% KO), duration median
63.9 s, all 8 classes sampled, per-class win rates and per-fight 6-axis coords
written to artifacts/battle-corpus.json for multidimensional plotting.

### Two real bugs found by the probes and fixed at the source
1. **NaN position through the wall-reset.** `probe-ai.ts` forced a walled arena with
   `shape: "square"` (a string). `ArenaConfig.shape` is a numeric INDEX everywhere
   else; `shapeOf` did `Math.round(cfg.shape)` = NaN -> undefined shape ->
   `ringRadiusAt` NaN -> the wall rebound wrote NaN into `body.x/z`. Fixed
   `shapeOf` to clamp any non-finite/out-of-range index to a valid shape
   (regression test: `shapeOf` never undefined, `ringRadiusAt` never NaN for
   NaN/Infinity/-3/99). The probe now passes the numeric index.
2. **Telemetry NaN-poisoning.** `fold()` and the Telemetry recorders now drop
   non-finite samples (a body that left the world is a physics event, not a data
   point), so the digest stays finite for the models even when the physics breaks.

### Honest gaps (not done this pass)
- **Hand/fist IK is approximate.** The grip pitch/roll/fist drive the weapon and a
  single fist-closure scalar; there is no two-point IK forcing each finger bone to
  wrap the handle, and the LEFT hand does not yet mirror the constraint. The user
  asked for full palm-normal + grip-tangent tracking per finger — that is open.
- **Bezier/Fourier trajectory solvers** for attack paths are NOT implemented; the
  swing arc switches plane per the GripStance cycle but the path itself is the
  existing AnimationCurve impulse, not a Bezier control-point or Fourier-series
  solve. OPEN.
- **Anatomical mesh topology** (pectoral/scapular split, quads-dominant edge loops,
  muscle-bulge morphs, 360-deg deform check) is NOT done — the rig is the existing
  procedural cylinders/spheres. OPEN.
- **4D space-time / camera raycast sphere-cast**: the occlusion fade uses a 2D
  ground-plane corridor (blockDistance), not a 3D sphere-cast frustum; walls fade
  but props/terrain between camera and character do not. OPEN.
- The neural policy (balance/NeuralPolicy.ts) is reachable through the brain's
  neuralTrust but is not yet TRAINED on the new corpus; the corpus is written but
  no trainer consumes it yet. OPEN.

---

## Pass 21 — Else-reduction, MMR leaderboard, selection tables, balance plates, palm-weapon (2026-10-10)
Gate: 0 type errors | 271/271 tests | lint clean 134 files | build 704,229 B | 0 dead functions.

The user asked for: fewer `else`, an MMR leaderboard with four AI types and clickable
profiles, a table-based selection screen showing each class's attacks, a three-level
balance-plate system, coherent stance-transition animation, and a palm-driven weapon
constraint. Built pure modules first (TDD), wired into the engine, verified live.

### Else reduction (60 -> 45, -25%)
- Engine action dispatch (2 sites) -> `AiBrain.executeAction` data table: each
  Decision maps to a movement vector [toward, strafe] + optional block/attack, no
  if/else chain. Engine else 32 -> 22.
- `NeuralTrainer` + `EvolutionHarness` duel loops: DIST_DELTA table + one shared
  `apply(act, side)` helper (was two mirrored if/else blocks each).
- `#updatePose`: pose priority as an ordered `[cond, pose]` table + `.find`, not an
  else chain. Total else 60 -> 45 across src/.

### MMR leaderboard (game/Ranking.ts, 6 tests)
- Elo: `expectedScore = 1/(1+10^((b-a)/400))`, K=32; an upset moves more than an
  expected win (tested). Four archetypes (berserker/tactician/duelist/sentinel),
  each a distinct personality, rotate onto bots each match. The king is rank 1.
- Engine registers bots on the ladder at fight start, records MMR at fight end.
  `Engine.leaderboardView()` exposes placement/MMR/record/archetype + king flag.
- History page renders the AI Leaderboard (even before any recorded match), the king
  wears a crown, and clicking a row opens a floating profile card (rank, MMR, peak,
  W-L, win rate, style). Verified live: board renders, 1 king, profile opens.

### Selection screen (ui/Menu.ts)
- Class and weapon dropdowns -> pick-tables (8 class rows with their default weapon,
  8 weapon rows). Selecting a class renders its 3 techniques (dash/power/defense)
  as cards with name, element, blurb and payload stats. Verified live: 8 rows, no
  dropdowns, Warrior shows Shield Dash/Crushing Blow/Bulwark, Mage shows
  Blink/Arcane Nova/Mana Shield.

### Balance plates (game/BalancePlates.ts, 7 tests)
- Three plates (feet/ground, pelvis, shoulder) -> a mass-weighted composite balance
  point. The ground support radius grows as the feet spread and shrinks on a slope;
  a wider stance lowers the balance point toward the ground. A knee force-plate
  takes hits. Instability (|offset|/supportRadius) drives stance:
  standing -> staggered -> kneeling -> fallen (thresholds ordered, tested).

### Stance transitions (game/StanceAnim.ts, 7 tests)
- Keyframed start/peak/end per joint with sin/cos easing (continuous at the peak,
  zero velocity at both ends — tested). Canonical transitions cover
  standing->kneeling->fallen->standing and stagger; a stance chain is coherent
  (one move's end = the next's start, tested). StanceAnimator plays them as
  sub-animations over their duration; the skeleton ticks it in update().

### Palm-weapon constraint (game/PalmWeapon.ts, 5 tests)
- `weaponFromPalm`: the blade tip runs along the palm normal — palm up -> weapon
  vertical, palm tilted -> weapon tilts (tested). `palmIsUp` decides the vertical
  case live in the engine. `armChainPose` (law of cosines) gives the elbow bend for
  a palm target; `solveElbow` is the two-point IK. The skeleton's setGripStance
  drives the right elbow from these so the fist/palm/elbow/shoulder stay coherent.

### Two-hand separation
- clampHandSeparation + MAX_HAND_SEPARATION were written but had no live consumer
  (no two-handed weapon path yet) — removed to honour zero-dead-code. The model is
  recorded here for when a two-handed weapon is added.

### Live verification
- tools/probe-ai.ts: ALL PASS (brains live, telemetry accumulates, grip alternates).
- tools/probe-ui.ts + probe-leaderboard.ts: selection tables + skills, leaderboard
  renders with a king, profile card opens. Screenshots in artifacts/qa-ui/.

---

## Pass 22 — Responsive UI, high-responsiveness input, profiles, race hero, secondary stats, telemetry (2026-10-10)
Gate: 0 type errors | 294/294 tests | lint clean 144 files | build 712,016 B | 0 dead functions.

The user asked for: high-responsiveness input (analog vector + APM turn tightening +
camera-relative movement), a fluid 4-breakpoint UI with no clipped borders, profile
selection (Player_ID), a race hero box with sub-species nested and a birth-sign delta
preview, and a character-creation telemetry payload.

### New pure modules (all unit-tested, 23 tests)
| Module | Tests | What it proves |
|---|---|---|
| game/SecondaryStats.ts | 6 | race->primary / sub-species->secondary (crit/haste/mastery/physResist/magicResist/versatility); combineSecondary stacks both layers; formatDelta renders +5%/-2%/—; secondaryPreview returns one labelled row per stat |
| game/InputVector.ts | 7 | keyboard drives the vector with no controller; the stick wins past the dead zone; diagonal clamped to unit length; the vector rotates into camera space by yaw; APM rises with activity and decays; turn radius tightens with APM (bounded by TURN_MIN); movementStep applies speed*dt*tightening |
| game/Profiles.ts | 5 | a fresh profile has a stable Player_ID + default keybindings + empty telemetry; the repo adds/selects/persists across a reload; update patches character state (id immutable); recordMatch accumulates wins/losses/damage/favourite; a corrupt store loads empty |
| game/CreationTelemetry.ts | 5 | the event carries every parameter + schema v1; secondary = combineSecondary(subrace, sign); null layers -> zero deltas; isValidEvent accepts well-formed and rejects malformed; serializes to JSON for sendBeacon |

### Responsive UI (styles.css)
- 4 breakpoints: mobile <768, tablet 768-1023, laptop 1024-1439, desktop/ultrawide
  >=1440, plus a tall-narrow portrait rule (min-aspect-ratio 3/4).
- Menu root fully fluid: `max-width:min(760px,96vw)`, `max-height:94vh`, clamp()
  gaps/padding, no fixed outer border; `overflow-x:hidden` so nothing clips.
- Settings button repositioned per breakpoint (smaller on mobile) — reachable at
  every ratio. Verified live: scrollW == clientW, menu inside bounds, settings
  visible at all four viewports (390/820/1280/1920).

### Race hero + sub-species + birth-sign preview (ui/Menu.ts)
- The selected race NAME in a centered hero box, flanked by a Primary stat column
  (6 core stats) and a Secondary column (6 percentage deltas).
- Sub-species nested under their parent race ("Sub-species of Elf").
- Birth-sign preview box shows the sign's name, lore, and the live delta comparison
  (Critical Strike +2%, Haste +1%, Mastery +3%, Magic Resistance +2% …) updating on
  every sub-species / sign click. Vision-confirmed.

### Profiles + input + telemetry (engine wiring)
- ProfileRepo (localStorage) seeds a default "Hero/Warrior" profile; the title
  screen shows a profile chip per saved profile; clicking loads the character state
  into the creator (onProfile -> #applyProfile).
- Movement loop: analog input vector (keyboard OR controller left stick via
  #pollGamepad) + ApmTracker; APM tightens the per-frame step so fast play turns on
  the spot. Camera-relative via toCameraSpace.
- onStart ships the character-creation event (race/sub/species/birthsign/profile/
  primary+secondary) to /api/telemetry/character-creation via sendBeacon.

### Live verification (tools/probe-ui2.ts, probe-preview.ts) — ALL PASS
- 4 viewports: no overflow, settings accessible, profile chip present.
- Race hero: name box, 6 primary rows, sub-species nested, 6 secondary rows.
- Birth-sign preview: box + 6 delta rows, non-zero values. Screenshots in artifacts/qa-ui2/.

### Honest gaps
- The secondary stats are preview-only in the creator: they are NOT yet folded into
  combat (attackDamage/crit/resist formulas read only the primary stats). Wiring
  crit/haste/resist into Stats.attackDamage is the next pass.
- The telemetry endpoint is a path constant; there is no backend server in this
  project, so sendBeacon posts to a 404 unless one is attached. The payload shape
  and sink are correct and tested; the server is out of scope.
- Controller input requires a physical gamepad (none in the headless probe); the
  analog merge + dead zone is unit-tested but not live-verified with real hardware.

### Reviewer reservations (pass 22) — all fixed
Reviewer verdict AGREE-WITH-RESERVATIONS (23/23 module tests green) with three findings:
1. **ProfileRepo.recordMatch had no live caller** (profile telemetry dead in production).
   FIXED: the engine now calls `recordMatch` at fight end for the active profile
   (wins/losses/damage/favourite class), non-spectate only.
2. **camYaw=0 made camera-space rotation moot.** FIXED: the input vector is rotated by
   the camera's live orbit yaw (`toCameraSpace(analog, this.#orbitYaw)`) before the
   opponent-frame projection, so movement is genuinely camera-relative.
3. **Settings button restyled only for mobile.** FIXED: added per-breakpoint sizing
   (tablet top/right, desktop 48px) so it stays reachable at every ratio.
After fixes: 0 type errors, 294/294 tests, build 712,234 B, probe-ai ALL PASS,
0 dead functions.

---

## Pass 23 — 3D model separation, race appearance, spine, face morph, animation tensors (2026-10-10)

### What was built
| Module | Purpose |
| --- | --- |
| `src/game/RaceAppearance.ts` | Race + sub-species build: height/weight multipliers, hair length tier, permitted styles, beard, ork underbite, ear length; expanded `HAIR_COLORS` (10) and `SKIN_TONES` (10); `raceBuild`, `seededPick`. |
| `src/game/SpineCurve.ts` | The 33 vertebrae in four curves (cervical lordosis 7, thoracic kyphosis 12, lumbar lordosis 5, sacral 5); `spineColumn`, `spineOffset`, `smoothSpine`. |
| `src/game/FaceMorph.ts` | Eyebrow/eyelid/mouth poses per combat state (idle/attack/hit/block/ko); `clampFace`, `blendFace`, `FaceMorph` (smooth blend, not a snap). |
| `src/game/AnimTensor.ts` | Per-power animation envelope: joint min/max angles, sin/cos/tan extrema, max angular velocity, travel, prime joint. |

### Engine / rig wiring
- `#spawnMeshes` passes `race`/`subrace` from the profile into the appearance, so the rig builds
  the right body/hair/beard/tusks/ears. `debugSetModel` swaps ancestry for a capture.
- Torso bows along the spine curve (`spineOffset(0.62)`) with a 7-segment back ridge.
- `setFaceState` is driven from `#updatePose`, so the face follows the parent animation state.
- Neck lengthened (torso top and head raised) to open a visible gap so a beard hangs in the open
  instead of inside the torso volume.
- `debugView` gained a `clean` mode: hides the overlay, the other fighter and arena walls, and an
  `orbit` inspection camera that takes priority over the gameplay cameras for model shots.

### Measured / observed (vision_analyze on artifacts/qa-models/)
| Race | Angle | Observed |
| --- | --- | --- |
| ork | front | Underbite confirmed: two white tusks rise from the lower jaw past the mouth line; broad, top-heavy build. |
| elf | back | Long dark hair confirmed: "a single large mass … hangs straight down the back, tapering to a rounded end around the mid-back … reads as long, straight, dark hair." |
| elf | front/side | Long pointed ear confirmed. |
| dwarf | front | Beard confirmed: black mass around the jaw/chin, eyes and mouth still visible; short, broad, barrel torso. |

### Geometry findings (recorded so they are not rediscovered)
- **A hair fall or beard inside the torso volume is invisible.** The torso radius is `≈ r × 2.11`
  (0.38·weightScale vs head `0.18·weightScale`), so any hair/beard below the head centre with
  `|z| < 2.11 r` is occluded by the torso from every angle. The long-hair fall therefore drapes at
  `z ≈ −2.35 r` and the beard hangs in the neck gap.
- **Camera angles in the model probe are character-relative.** The player faces +X, so "back" is
  the −X side (`yaw = −π/2`); a world-relative yaw shoots the side of the head and misses the hair.
- **The orbit inspection camera must outrank the gameplay cameras**, or the "third" branch wins the
  if/else chain and the orbit is never applied.

### Gate (pass 23)
- 0 type errors · **324 tests** (0 failed) · lint clean 155 files · build **719,028 B** · 0 dead
  exports (functions, test-only, constants).
- New spec pins in `tests/spec_test.ts`: `R1` (race builds), `SS1` (secondary stacks additively),
  `SP1` (33 vertebrae, adjacent curves meet at 0), `F1` (face poses clamped), `T1` (tensors
  finite/bounded), `AI3` (upset > expected win), `AN1` (stance key start/peak/end, continuous).
- New module tests: `raceappearance_test` (7), `spinecurve_test` (6), `facemorph_test` (5),
  `animtensor_test` (5).
- New tool `tools/rig-report.ts`: prints every power's sin/cos/tan envelope (class, kind, prime
  joint, travel°, max angular velocity, per-axis extrema) and the reference bodies. Sample:
  Barbarian power → `shoulderR`, 108.5° travel, cos [−0.32, 1.00], sin [−1.00, 0.00].
- `HAIR_COLORS` / `SKIN_TONES` are now live: hair is drawn from the expanded palette and the skin
  tone blends the race tint 40% toward a palette entry, both seeded by the character's name, so
  two members of one race are not the same flat colour. Observed: ork skin reads olive-green.
- `smoothSpine` is now live: the back ridge samples the smoothed 33-vertebra column.
- `else` count: **48** in `src/` (engine 23). Up 3 from 45 — the new modules added none; the drift
  is in the engine's pre-existing rematch block, not the new code.

### Honest gaps
- The facial morph deforms the face **reference meshes** (brows/eyelids/mouth) — there are no
  morph-target skins yet, so the effect is mesh-level, not a full skin blend.
- The animation tensor module **describes** the envelope; the runtime still plays the existing
  `AnimationCurve`, so the tensors are an inspection/verification layer, not yet a driver.
- Menu windows were widened and given internal scroll; a full per-parameter creator panel for
  every arena parameter is still OPEN.

---

## Pass 24 — body surface, cylinder connections, secondary→combat bridge (2026-10-10)

### What changed
| Area | Change |
| --- | --- |
| `src/graphics/Humanoid.ts` | Body parts are now capsules/ellipsoids (`seg()`: a capsule when `h ≥ 2r`, else an ellipsoid — a capsule cannot be shorter than its own diameter), every articulation carries a radius-matched blend ball, and all body geometry is **merged per pivot** via `BufferGeometryUtils.mergeGeometries`, so each pivot emits ONE surface + ONE ink outline. |
| `src/graphics/shaders/CelShader.ts` | New `createCelSurface` — a cel surface with **no** ink outline, used for the spine ridge so the back reads as a contour instead of a row of outlined boxes. |
| `src/game/SecondaryStats.ts` | New `applySecondary` + `SECONDARY_BRIDGE`: the character sheet's secondaries now feed the combat equations. |
| `src/game/Fighter.ts` | `createFighter` applies the bridge, so every live fighter carries its ancestry into damage/speed/armour/crit. |
| `src/balance/ArenaHarness.ts` | Prices in a representative sub-species/birthsign pair, so the harness and the live build run the same game. |

### Why the body read as "a stack of tubes" (root cause)
The cel outline is an inverted hull **per mesh**. With one mesh per primitive, every junction showed
two overlapping contours. Merging the geometry per pivot removes every *internal* seam; the
remaining doubled line at a limb root is inherent (the arm must move independently of the torso).

### Measured / observed (vision_analyze, artifacts/qa-models/)
- Torso: "a single continuous rounded volume with one clean outline around it" (previously a belt
  line and doubled rims).
- Arms and legs are now visible and emerge with rounded shoulder/hip domes (before, the fixed
  shoulder offset `±0.44` did not scale with body width, so heavy races buried their arms inside
  the torso — a real bug).
- Ork skin reads olive-green from the expanded `SKIN_TONES` blend; dwarf beard and ork tusks still
  confirmed.
- Honest residue: a doubled ink line remains where a limb root meets the torso, because the limb is
  a separate pivot's mesh. Accepted and recorded in DESIGN.md item 18.

### Balance A/B of the secondary bridge (seed 20261009, 1500/pair, race "all")
| | Human | Elf | Dwarf | Ork |
| --- | --- | --- | --- | --- |
| without the bridge | 4/28 | 3/28 | 1/28 | 2/28 |
| with the bridge | 6/28 | 3/28 | 2/28 | 1/28 |

The bridge is balance-neutral (the added modifiers are ancestry-driven and apply to every class the
same way). The low pairwise counts are pre-existing at this sample size, not a regression.

### Gate (pass 24)
- 0 type errors · **325 tests** (0 failed) · lint clean 155 files · build **724,976 B** · 0 dead
  exports (functions, test-only, constants).
- New spec pin `[SPEC SS2]`: secondary stats feed the combat equations (power/armour/interval/crit),
  and no ancestry is a true no-op.

### Still OPEN (unchanged by this pass)
Win-condition variety in the live engine (the module exists and the corpus uses it, but matches
still end only by KO); feeding the battle corpus into `NeuralTrainer`; glider; two-handed weapons;
stat allocation; skill selection; keybinding rebind UI; a telemetry backend; the spring-damper
impulse absorption and the 4D Bezier/Fourier trajectory solvers from the Principal-Engineer spec.

---

## Pass 25 — sculpted body overhaul: lofts, shape equations, race silhouettes (2026-10-10)

### The model changed from primitives to swept surfaces
| Module | What it is |
| --- | --- |
| `src/game/ShapeEquations.ts` | The maths: superellipse sections, taper, muscle bulges, waist pinch, directional lobes, smoothstep blends, angular constraints, and `maxCorner` (the right-angle check). |
| `src/game/BodyProfile.ts` | Per-race silhouette parameters, every part's shape, the COMPLETE state x joint scale table (9 states x 16 joints), constraint resolution, and bounded random variation. |
| `src/graphics/Loft.ts` | The builder: samples a section per station, stitches rings, dome-caps both ends, and blends two sections into a connector. |
| `src/graphics/BodySurface.ts` | Turns a race's numbers into geometry per part, plus the material properties and the surface sampler the silhouette checks read. |

No part is a box, sphere or cylinder any more. A section is a superellipse (n in
[1.75, 2.45] — never a circle, never a square) modulated by directional lobes, so a
chest has pectorals and a spine groove and a calf has a calf.

### Two real bugs found and fixed
1. **The feet were underground.** The rig's chain was 2.03 units tall but the engine
   places the rig origin at the body centre (0.6 above the ground), so the sole landed
   at y = -0.29 and the legs were buried in the floor — which is why every capture read
   as a crouch. The rig now computes its own scale and offset:
   `scale = height / (legDrop + crownRise)`, `spineY = legDrop - 0.6 / scale`.
   Measured after: min y = 0.004–0.014 for all four races (feet on the ground).
2. **The shoulder/hip offsets did not scale with body width**, so a wide race's arms
   were swallowed by its own torso. They now come from the silhouette.

### Measured (tools/probe-rig.ts, artifacts/qa-models/)
- Part extents (metres, chest): elf 0.38 x 0.34, human 0.52 x 0.46, dwarf 0.82 x 0.69,
  ork 0.88 x 0.74 — the elf is the narrowest and the ork the widest, as the brief asks.
- The constraint list resolves all 16 joints for all 9 states, `allValid=true`.
- Feet on the ground for all four races.

### Gate (pass 25)
- 0 type errors · **340 tests** (0 failed) · lint clean 161 files · build **733,539 B** ·
  0 dead exports (functions, test-only, constants).
- New `tests/bodyshape_test.ts` (15 tests): sections never corner (bound 0.6 rad, vs a
  right angle at 1.571), no section is a plain circle, the operator chain multiplies as
  its equation says, the state x joint table is complete, a heavy race articulates less,
  random silhouettes stay inside their race's band and still score, and the cross-race
  extents order correctly.
- New tool `tools/probe-rig.ts`: rig bounding box, pivot world positions and mesh count
  per race, plus the extents and the constraint lists.

### Honest gaps (this pass)
- The visual silhouette still reads softer than the numbers imply: the muscle lobes are
  ~20% amplitude, which is visible in the section data but subtle at gameplay distance.
  Raising them is a one-line change per part.
- The captured "idle" pose still shows bent knees — that is the game's fighting stance,
  not a rig fault; the pose pin in `debugView({pose})` is overwritten by the per-frame
  skeleton update, so it does not hold.
- Textures, UV-driven mapping, reflection and absorption were NOT done this pass. The
  loft carries UVs and `PART_MATERIALS` carries specular/absorb, and the specular now
  reaches the cel shader per pivot, but there is no texture map yet.
- The state constraints are resolved and reported, but the live animation clamp still
  uses the joint's static limits — wiring `constraintList` into the per-frame clamp is
  the next step.

---

## Pass 26 — UI overhaul: the interface as a tree, colour-coded panels (2026-10-10)

### The hierarchy is now data, not markup
`src/ui/UiTree.ts` declares the whole interface: screens -> panels -> groups -> controls.
Every control carries its own key, hint (WHY), `when`, `owner` and `weight`, and every
panel carries a colour code from DESIGN.md's palette. `Menu.#wireTabs` renders the panel
tabs FROM the tree, so the hierarchy has one source of truth.

Measured (`tools/probe-ui2.ts`): **5 screens, 12 panels, 29 groups, 40 controls**.

### The window and the panels
- The menu root went from `min(880px, 97vw)` to **`min(1400px, 96vw)`** (creator) and
  **`min(1500px, 97vw)`** (history), with `padding: clamp(18px, 2.4vw, 40px)`. Measured
  at 390/820/1280/1920 px: no overflow at any width.
- The creator is split into **five colour-coded panels** — Ancestry (grass), Calling
  (sand), Star sign (violet), Opponent (ocean), Arena (positive) — reached through a
  generated tab bar. Each panel has a colour dot, a left colour rule, and its own
  one-line hint.
- A screen header (`h2` + hint) now says what each screen is for.
- The star-sign panel is new: a birthsign table wired to `#refreshSecondary`, so picking
  a sign updates the secondary-stat rows live.

### Verified visually (artifacts/qa-ui/select-mage.png, vision_analyze)
"a tabbed, single-screen layout where the active panel is shown in full while the other
panels remain accessible as tabs … five tabs … the active panel has a green dot … and a
green vertical left rule … the main content area spans nearly the full width."

### Gate (pass 26)
- 0 type errors · **345 tests** (0 failed) · lint clean 163 files · build **744,046 B** ·
  0 dead exports (functions, test-only, constants).
- New `tests/uitree_test.ts` (5 tests): unique keys, every control has a full path and a
  hint, the tree is deep enough (>=5 screens / >=10 panels / >=20 groups / >=30 controls),
  the creator has exactly five panels with distinct colour codes, and importance is
  declared with the essential controls always reachable.
- New tool `tools/probe-ui2.ts` section: compares every tree key against the live DOM.

### Honest state of the tree
The probe reports **30 declared keys that are NOT yet in the markup**: the history
filters (`filter-*`, `history-summary`, `history-list`), the auto-train button
(`btn-train`), the resource panels (`sheet-pools`, `sheet-costs`), the pickup controls
(`pickup-rate`, `pickup-kinds`), the win-condition and wall-resistance controls, and the
victory/leaderboard keys that are generated at runtime rather than in the template. The
tree is the TARGET hierarchy; the DOM implements part of it. The probe prints the list
rather than failing, so the gap stays visible.

### Not done this pass (asked for, not built)
- History filters (the panel exists in the tree; the controls are not in the markup).
- Automatic training matches and a spectate speed control.
- Mana and stamina as third/fourth pools, and the reduced-max-health match length
  (the `match-length` select is rendered but not yet read by the engine).
- Map pickups / power-ups with attributes and interactions.
- Deeper neural-net thresholds and the pass-a-threshold equations.

## Pass 27 — Wave H: the ancestry hierarchy, hair physics, match telemetry and corpus data science (2026-10-31)

Gate: 0 type errors | **1201/1201 tests** (144 files) | lint 1 error, pre-existing on HEAD
(`tools/probe-anim.ts:10`, the `jsr:@std/encoding` import added by the previous commit) |
build 1 697 366 B | `tools/probe-wave-h.ts` in real Chrome: 0 page errors.

The prompt asked for a hierarchy over every subrace with body-part ratios, a per-ancestry look, hair
that reacts to weather and strikes with mass bound to its size, generations logged for the trainers, a
three-minute match limit that ends as a tie with the stat difference recorded, History highlights, a
generated spectator match with a stat budget, and a bounded data-science pass. Built as seven parallel
lanes with disjoint file ownership against a frozen contract (`docs/ancestry/BRIEF.md`), integrated and
measured by the parent. Evidence: `artifacts/ancestry/VERIFICATION.md`.

### What is new
| Area | Module | What it is |
| --- | --- | --- |
|Ancestry|`src/game/Ancestry.ts` + `artifacts/design/ancestry.json`|16 nodes (4 races + 12 subraces), 13 ranked metrics each, and a complete look spec (skin base/range/crease + zones, hair length/styles/colours/curl/density/baldChance, brow, beard mode, tusks, ears, skull, hair physics)|
|Hair physics|`src/game/anim/SecondaryMotion.ts`|a damped spring per movable mass: `a = (windGain·wind_body·flutter − HEAD_DRAG·v_head)/m − (k/m)x − (c/m)v`, semi-implicit at a 1/200 s sub-step, `dt` clamped to `MAX_STEP_SECONDS`|
|Spectator generation|`src/game/SpectateGen.ts`|random levels, a budget spent by calling, techniques from the spent stats, an arena size — one seed, one card|
|Match telemetry|`MatchControl.ts`, `WinConditions.ts`, `MatchHistory.ts`|`MATCH_TIME_LIMIT_S = 180` (clamped [30, 240]), `timeLimitVerdict` (a tie, never a win), `StatGap`, `GenerationBlock`, `highlights`|
|Corpus maths|`src/balance/CorpusMath.ts`, `tools/data-science.ts`|six key variables, z-scores, Euclidean + diagonal-covariance Mahalanobis, PCA by power iteration, plain AND robust (median+MAD) outlier flags, k-NN placement|
|UI|`src/ui/HistoryView.ts` + `Menu.ts`/`UiTree.ts`|history sort orders (`fastest`, `biggest-gap`, `widest-margin`, `generation`), row badges, the highlights strip, the spectator card panel, and an ancestry lore panel that reads the hierarchy|

### Measured live (`tools/probe-wave-h.ts`, `artifacts/qa-wave-h/report.json`)
- **The ancestry panel reads the hierarchy** and differs race to race. Live DOM, high elf: `crease /
  under-eye, cheek-fold, neck, joint · crease strength 60%`, `verylong · curl 15% · bald chance 0%`, beard
  `moustache-thin`. Greenhide ork: `joint, knuckle, neck, brow · 40%`, `short · curl 65% · bald chance 55%`,
  beard `chin (optional)`, tusks `2 · up`.
- **A generated spectator card**: `GEN-17A40B`, level 4 with 30 stat points against level 15 with 96, an
  81 m arena, and seven techniques unlocked from the spent stats.
- **The bell is a tie**: hostile time 30.01 s at a 30 s limit, `winner null`, stored `reason "time-limit"`,
  `tie true`, `statGap 2.09σ`, `dominance 0.21`, `generation GEN-8E3A8B`, ancestry `["elf/high",
  "human/imperial"]`, result screen `Draw — time limit`. (An earlier run on different builds: `4.85σ`,
  `dominance 0.53`.)
- **Hair physics, in the game**: 5 movable masses per fighter. Wind 4.50 m/s dry → 7.31 cm; wind 12.00 m/s
  soaked (wetness 0.90) → 7.49 cm, settling to 7.35 cm within 4 s; wind 3.69 m/s → 6.27 cm. The mass moves
  with the wind, settles, and a soaked mass resists a 2.7× stronger wind.

### Two mismatches found by printing the live inputs and outputs side by side
1. **The movable hair masses were attached to the wrong rig.** The engine renders
   `buildSkinnedHumanoid`; the nodes had been added only to `buildHumanoid`, so `masses` read 0 and the
   solver never ran. Now returned through `FaceRig.secondary` → `HumanoidRig.secondaryMasses`.
2. **A unit mismatch pinned every mass against the clamp.** `hairPhysics.stiffness` was on a 0.25–0.85
   scale while the solver's default is 120 and equilibrium is `x = windGain·wind/k`, so a 5 m/s breeze
   asked for a 7 m displacement and the offsets saturated at the 1 m box. The 16 stiffness values were
   rescaled ×200 and `damp` set from a 0.5 damping ratio (`c = √(k·m)`); both orderings were verified
   pairwise before and after (0 violations), and equilibrium displacement is now 2–7.5 cm at 8 m/s.

Neither was visible in a screenshot or in a unit test — the first needed the live object graph, the second
needed the solver's own input printed next to its output.

### Honest gaps
The stat-unlocked techniques beyond a class's three are recorded, shown on the card and logged, but not yet
bound to HUD input slots; the brows are morph-driven rather than solver-driven (two writers on one node is
the bug the tensor work already hit); the spectator card's size is clamped into the live arena band; no
frame-cost measurement of the solver was taken this wave; the hair's 6–7 cm was not judged by eye at
gameplay distance.

## Pass 28 — Wave I: the spectator camera, the inspect overlay, terrain fill, clash sparks and the 60 FPS guard (2026-10-31)

Gate: 0 type errors | **1276/1276 tests** | lint clean (449 files) | build 1 725 306 B |
`tools/probe-wave-i.ts` in real Chrome: **0 page errors**, five claims measured.

The prompt: a spectator camera whose angle the user sets and KEEPS, a custom cursor with a trailing blob,
clicking a fighter to float their stat sheet beside them (and clicking another fighter or a map object to
change it, a click away to close it), a fix for props floating above the map, another generation layer that
closes the seams where a surface meets the terrain and is coloured by the ground it stands on, particles
where two weapons collide, and the 60 FPS budget protected. Built as five parallel lanes against a frozen
contract (`docs/spectator/BRIEF.md`), integrated and measured by the parent. Evidence:
`artifacts/spectator/VERIFICATION.md`.

### What is new
| Area | Module | What it is |
| --- | --- | --- |
|Spectator camera|`src/game/SpectatorCamera.ts`|absolute yaw/pitch/dist state with `orbitCamera(state, 0, 0, …) === state` (the no-op identity the complaint needed), four presets, wrapping yaw, clamped pitch/distance, a localStorage round trip|
|Inspect overlay|`src/ui/InspectOverlay.ts`|fighter and object cards, flip-then-clamp anchoring, nearest-wins picking, and a frame-rate-independent blob that trails the reticle|
|Ground fill|`src/graphics/GroundFill.ts`|`footHeight`/`seatingY` (the footprint's high point), `materialUnder` (the ground's own material), `skirtFor` (a 4-ring apron, `6 × segments` triangles)|
|Prop anchoring|`src/graphics/props/PropModels.ts`|`propBaseOffset` — every model is centred on its own origin, so the base needs its own bounding-box offset|
|Clash|`src/combat/Clash.ts` + `src/graphics/fx/ClashSparks.ts`|exact segment-segment closest approach, a speed gate, a repeat cooldown, and a fixed 96-spark pool (12 per burst, 192 triangles, 2 draw calls)|
|Frame budget|`src/game/FrameBudget.ts` + `tools/frame-budget.ts`|an EMA-plus-hysteresis effects governor and a measured day/night/**spectate** budget with real GPU timing|

### Measured live (`artifacts/qa-wave-i/report.json`)
- **The camera holds its angle**: drag 0 → 0.72 yaw / 0.35 → 0.53 pitch, then 2.5 s idle reads back the
  identical numbers; presets `duel/broadcast/topdown/lowangle` apply; cycling reaches follow-a.
- **Cursor + cards**: present, follows, blob trails and settles within 1 px; hover `fighter:0` → "Sir
  Aldric", 17 rows, 3 bars, badges `["GEN-53AB8C","AI"]`; clicking the other fighter swaps to "Ser Vail";
  clicking a rock opens its card; clicking empty ground closes it.
- **Props**: 16-prop arena — **15 would have floated under the old placement, 0 do**, worst floating 0 m,
  `baseOffsets` per kind (pillar 1.60, arch 1.85, rock 0.4831 …), 16 aprons = 1920 triangles coloured from
  the ground itself (8 wood, 4 stone, 4 sand), worst seam 1.42 m and **16/16 covered**.
- **Clash**: 24 sparks on the first burst, capped at 96 over 41 bursts, 325 spawned / 251 refused, 48
  events of which 8 came from real AI-vs-AI blade contact.
- **Frame**: CPU p99 3.5 ms, headroom 13.1 ms of 16.6, cadence 16.7 ms; the governor stayed at scale 1.00.
  Lane I-E's own tool: day p99 5.2, night 4.4, spectate 4.8 ms CPU with GPU p95 9.35–9.96 ms and a real
  GPU timer available.

### Three defects the measurements caught
1. **Every prop model is centred on its own origin** (a constant float of half its height — measured per
   kind), and the base was placed from the terrain height under the CENTRE, so on a slope it was buried
   uphill and hovering downhill at once.
2. **The apron's depth cap stopped short of the ground**: 0.6 m default against a 1.81 m hillside fall —
   the fill left exactly the seam it existed to close (now the cap is the footprint's own fall plus margin;
   16/16 seams covered).
3. **Pointer lock rejects its promise** in Chrome when the document is not focused; unhandled, that was 4
   page errors per probe run. Swallowed deliberately now.

### Honest gaps
The inspect card is read-only. The clash threshold (0.35 m) was chosen, not tuned by eye (natural clashes
run ~8 per match). The frame numbers are a headless lab sample — cadence there is a vsync artefact, though
the CPU and GPU times are real. `floating: 0` bounds the seating error at the SAMPLED rim, not between
samples. Wave H's stat-unlocked techniques still are not bound to HUD slots.

## Pass 29 — Wave K: what "reduce the HPs, there is too much AP" costs, and what it buys (2026-10-31)

The ask was qualitative — *"the strikes that have more impact, they do more damages… reduce the HPs…
increase the cost of mana a little by 20 % or so"* — so the pass is a before/after on one seed
(20261009) with the same harness on both sides.

| metric | before | after | note |
| --- | --- | --- | --- |
| health pool (Barbarian → Necromancer) | 53 250 → 39 200 | 26 625 → 19 600 | exactly ×0.5, as asked |
| attack power | 680 → 1 335 | 340 → 667 | ×0.5, so the time-to-kill ratio held |
| median decisive duel | 51.8 s | 36.7 s | inside the brief's 25–55 s |
| damage p20 / p50 / p80 | 662.4 / 860.0 / 1 105.2 | 402.9 / 603.6 / 824.3 | p80/p20 1.67 → 2.05 |
| mean hits to kill | 51.3 | 36.2 | the pools fall faster than the hits |
| mirror win rates | 48.7–51.1 % | 49.3–50.9 % | 5/28 "balanced" pairs, same as before |
| full-speed blow vs standing | 1.8× (capped) | 2.294× | the impact term, not the pool |

**Lessons recorded.**

1. **Halving both sides preserves the win-rate band but not the texture.** Pool and attack power both
   moved ×0.5, so DPS × eHP — the quantity the class solve targets — is unchanged and the mirror
   matrix barely moves (48.7–51.1 → 49.3–50.9). What DID change is the felt texture: p80/p20 rose
   1.67 → 2.05 and hits-to-kill fell 51.3 → 36.2, i.e. individual swings now decide more. A balance
   band is not evidence that the game feels different; the spread is.
2. **The steeper impact term is what actually delivers "more impact = more damage".** Raising the
   closing-speed coefficient (0.15 → 0.55) plus a bounded `impactMul` gave the 2.294× the brief
   demanded; widening the pool reduction alone would have changed nothing about impact response.
3. **Pin the measured band, not the round number.** `[SPEC H2]` asserted `HEALTH_SCALE === 1000`,
   which after this change is not a false assertion but a *type error* — the whole `deno task check`
   aborted before a single test ran. Cross-module pins must assert the RELATIONSHIP
   (`DAMAGE_SCALE === HEALTH_SCALE / FIGHT_LENGTH`) plus a measured band, so a deliberate change
   fails informatively instead of breaking the build. Both H1 and H2 were re-stated from measurement
   and the changes are listed in `artifacts/tuning/VERIFICATION.md` §7; the third casualty
   (`tests/balance_decision_test.ts`'s hard-coded 45 000 pool) now derives its pool from the constant.
4. **A shared tool that calls class methods as extracted functions is a measurement that will
   silently stop measuring.** `tools/frame-budget.ts` passed each debug hook to `page.evaluate` as a
   bare function, so `debugSpectateCam` lost its private fields and threw reading `#q` — the frame
   measurement could not run at all until it was called with the engine as `this`. The probe's own
   p99 of 15.4 ms was its DOM/screenshot load, not the game: with the tool working again, spectate
   p99 is 2.7 ms with 13.9 ms of headroom and a 16.7 ms cadence.
5. **Two sessions on one repo need one wave-number authority.** Both this session and the paired one
   called their work "Wave J"; the paired session's had already shipped, so this wave was renumbered
   K, its lane reports renamed `artifacts/messages-K*.md`, and its brief/spec sections renamed with
   it. Nothing in the code depended on the label, but the docs would have pointed at the wrong wave.

## Pass 30 — Wave L: heraldry, a rolled fighter you can see, and what a UI rewrite breaks elsewhere

The ask was design work ("improve the components … races and sub-races should have icons like étendards …
a purple rocky dice button … options in closed trees"), so this pass records what was MEASURED and, more
usefully, the two failure modes a UI rewrite of shared markup produces in this repo.

| claim | measured |
| --- | --- |
| distinct standards | 16 (4 races + 12 sub-species), all distinct as strings, 0 duplicates; cadency from an FNV-1a hash of the sub-species id |
| on-screen standards | race boxes 4/4 carrying one, sub-species chips 12/12 |
| dice button | 122 x 48 px, border `#a06cd5`, background `#2a2338`, 3 box-shadow steps, dice icon present |
| the model follows one roll | build key `Sir Aldric\|human\|imperial\|Warrior` -> `Ash\|...\|sword`, 10 896 triangles, live |
| the sheet is the game's maths | Max Health 24 375 = `applyRaceBonus(createStats(...))` + `applySecondary`, within 2 % of the live pool |
| closed trees | 18 groups, 1 open on arrival (`title/start/modes`), every header counts its options |
| frame budget with a second WebGL context live | spectate p99 3.8 ms of 16.6 (headroom 12.8) |
| full gate | 1388 passed / 0 failed, lint 488 files, build 1 782 828 B |

**Lessons recorded.**

1. **A UI rewrite of shared markup silently invalidates the PROBES of earlier waves, and only the probes
   catch it.** Wave L moved `data-race-box` from the race toggle button to a wrapper card, so the delegated
   click no longer resolved to a `.race-toggle`; the Wave H ancestry lore panel then showed the *previous*
   race's lore and three of that wave's six claims went false (panelsDiffer, orkMentionsChin,
   elfMentionsThinMoustache). The unit suite stayed green throughout — 1384 tests — because no test clicked
   a card. Lesson: when a wave rewrites markup that an earlier wave's probe drives by SELECTOR, re-run those
   probes before committing, and treat their booleans as part of the gate.
2. **A delegated click handler must accept every node its own markup actually exposes.** The fix was not to
   move the attribute back but to make the box resolve through its own toggle, so the whole card is one
   target — which is also the better interaction. A clickable wrapper around a button is a trap unless the
   handler is told about it.
3. **The stall the user describes is a MEASUREMENT before it is a behaviour.** "They move but they don't
   really move, they don't serve each other" is not rateable by eye across thousands of matches, so Wave M
   names it (`standoffMaxS`, `dryStreak.maxS`, the distance bands) before touching the decision tree.
4. **A live model is cheaper than a portrait here, and more honest.** The offscreen one-shot portrait
   (`renderPortrait`) still draws the OLD `buildHumanoid` body — a picture of a fighter the game no longer
   renders. Standing the real skinned rig on a small canvas costs one context and 3.8 ms p99 in spectate,
   and it cannot drift from the arena because it runs the same build path.
5. **Machine-read colour is not taste.** The dice button's stone treatment was verified as three shadow
   steps and the right violet border; whether it *looks* like struck stone is a judgement no test in this
   repo can make, and the wave says so rather than implying it was judged.
