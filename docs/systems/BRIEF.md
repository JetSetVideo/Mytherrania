# Wave S — right-click camera, five powers per class, a cost debate, and manlier bodies

**The ask, verbatim.**

> "using the mouse, I should be able to move the camera around in the third-person by clicking the right
> click. and I want you to for all the classes create five powers that respect the classes archetypes so the
> rogues the the assassin for example can become like invisible and he has a sprint and the mage can cast
> fireballs and do a force cone and those they affect the animation of the players they must be related to
> the weapons the statistics of the characters as all those things. the most powerful pour spell, they can
> take time to cast and the duration and power is depending on all the factors … some are like direct shots
> with a lot of power and so the cost system make it so that … in mana and you have to wait longer with
> another cast … you create agent for each class and you'll make them argue about the balance and the cost
> function associated with them. and remember that doing an action is already some cost and some combos they
> can be beneficial but not all the classes should have everything. and they have animation associated to
> that … all based on the same principle … you take the base principle … that you start with the beginning
> and you make sure it works and then you keep on working on what works. after you fixed everything and you
> make all the bases and then you go back on the processes and you create branches and conditions, and you
> make sure you use all the conditions … and there is a reason why this is like that and not like that
> because it's already somewhere else … but everything we use at least once. and fix a bit the 3D models,
> make them slightly less [slouched] and a bit more muscular with some muscles in the shoulders and the
> trapezoids, make the legs a bit closer at the junction, give them a little pack for simulating the
> genitals and make them more like manly and it depends between girls and boys. boys, they have a larger
> shoulder to hip ratio, and girls, they're more curvy. and you make sure those models fit each other and
> the hierarchy compared to those races and those sexes."

**Decoded.** FLAG marks a decode I inferred rather than heard.

| spoken | decoded | flag | lands in |
| --- | --- | --- | --- |
| "move the camera around in the third-person by clicking the right click" | holding the RIGHT mouse button and dragging orbits the third-person camera; the context menu is suppressed on the play surface; a left click still attacks | — | parent |
| "for all the classes create five powers that respect the classes archetypes" | every class gets exactly FIVE powers whose effects match its archetype (the assassin becomes invisible and has a sprint; the mage throws a fireball and a force cone; …) | — | lane S-A |
| "they must be related to the weapons the statistics of the characters" | a power's power/duration/cost is a function of the caster's OWN statistics and of the equipped weapon — no power carries a hard-coded amplitude | — | lane S-A |
| "the most powerful spell, they can take time to cast and the duration and power is depending on all the factors" | cast time, duration and amplitude all derive from stated inputs (the six attributes, the weapon's weight/reach, the element) through one shared law | — | lane S-A |
| "some are like direct shots with a lot of power" | a power declares a SHAPE: instant strike / projectile / cone / aura / self-buff — the shape drives the animation and the cost | — | lane S-A |
| "the cost system … in mana and you have to wait longer with another cast" | mana cost + cooldown, both derived (not typed per power), with a longer cooldown for the heavier shapes | — | lane S-A |
| "doing an action is already some cost" | acting at all costs something: the wave's rule is that no power is free, and a physical action (a swing) has its own stamina cost | — | lane S-A |
| "some combos they can be beneficial but not all the classes should have everything" | a stated COMBO table (a power that follows another gets a bonus) and an explicit EXCLUSION table (which class must NOT have which shape), so every class's five are distinct | — | lane S-A |
| "they have animation associated to that … all based on the same principle" | one animation principle for every cast: a wind-up whose LENGTH is the cast time, a release, and a return — the existing `SkillAnimation`/`JointTrack` data is the base, extended, not replaced | — | lane S-A |
| "create agent for each class and you'll make them argue about the balance and the cost function" | TWO advocates argue the cost function in writing, each with a stated mandate and its own file, and the parent reconciles them in the spec — an explicit argument, not hidden deliberation | **FLAG**: realised as two opposing written briefs + a reconciliation, since agents cannot truly debate live | lanes S-C / S-D |
| "there is a reason why this is like that and not like that because it's already somewhere else" | check for DUPLICATION first and single-source it. Known: `SKILL_RESOURCE_COST` exists in BOTH `src/engine/Engine.ts:254` and `src/balance/MatchSim.ts:69` | — | lane S-A |
| "everything we use at least once" | every new enum member, shape, element and combo must be exercised by at least one power or one test — a stated coverage list | — | lane S-A |
| "make them slightly less [slouched] and a bit more muscular with some muscles in the shoulders and the trapezoids" | less slouch (a straighter upper spine), more shoulder/trapezius mass — measured in metres | **FLAG**: "less AV" read as *less slouched/hunched* | lane S-B |
| "make the legs a bit closer at the junction" | the hip joints move inward by a stated amount (measured as the stance width) | — | lane S-B |
| "give them a little pack for simulating the genitals" | a small, tasteful CROTCH MASS on the body (a stated ellipsoid, its own size per sex) — geometry only, no explicit content | — | lane S-B |
| "more like manly … boys larger shoulder to hip ratio, girls more curvy" | the shoulder-to-hip RATIO differs by sex by a stated amount, on top of wave R's female curve, and across every race | — | lane S-B |
| "make sure those models fit each other and the hierarchy compared to those races and those sexes" | the ancestry × sex hierarchy is stated as a ranked table (shoulder-to-hip per race per sex), computed from the data | — | lane S-B |

House rules: pure modules where the logic lives, TDD, comments say WHY with units, no `any` without a scoped
ignore, never an inline `style="…"`, a claim without a tool's literal output is not evidence, and a bound a
deliberate change makes false is re-stated from measurement with the reason written where the bound lives.

**Two hard lessons this repo already paid for, binding every lane here:** the ground-contact geometry
(ankle, foot, heel, leg chain) is SHARED with the planted-foot slide band (`tests/anim_measure_test.ts`,
5.6 mm non-ork / 6.8 mm ork) and the ragdoll's mass and skin coverage — do NOT put a new multiplier there,
and if a test moves, paste the number and stop. `PECTORAL_DEPTH_GAIN` is pinned to neutral on purpose.

---

## Lane S-A — the powers

**Owns:** `src/game/Skills.ts`, `src/game/PowerCost.ts` (new, pure), `src/game/ComboTable.ts` (new, pure),
`src/engine/Engine.ts` (ONLY the `SKILL_RESOURCE_COST` export, replaced by a re-export), `tests/powers_test.ts` (new).

1. **Five powers per class**, ten classes, each mapped to its archetype, each declaring: shape (instant /
   projectile / cone / aura / self-buff), element, the six-attribute and weapon inputs it scales from, a cast
   time, a duration, a mana cost, a cooldown — and an ANIMATION built from the existing `SkillAnimation`
   tracks (extended, not replaced).
2. **One law, not fifty numbers:** `PowerCost.ts` exports the pure functions that derive the power, the cast
   time, the cost and the cooldown from stated inputs (`powerOf`, `castSecondsOf`, `manaCostOf`,
   `cooldownSecondsOf`, plus the shape's own base row). Every power in `Skills.ts` must be derived through
   those — assert it, don't trust it.
3. **Single-source the resource cost:** the duplicated `SKILL_RESOURCE_COST` is defined once and re-exported.
4. **Combos and exclusions:** `ComboTable.ts` states which power following which earns a bonus, and which
   (class, shape) pairs are forbidden — every class's five are distinct, and "not all classes have
   everything" is a TESTED property.
5. **Coverage:** every shape, element and combo entry is used at least once; the test prints the coverage
   table.

**Evidence:** literal `deno check`; the new tests' pass counts; the pre-existing skills/balance tests you ran
(list with counts); `deno lint`; the printed 10×5 power table (shape, element, cast s, duration s, mana,
cooldown s, and which stat/weapon input it scales from); the coverage table; and the combo/exclusion table.

## Lane S-B — the body

**Owns:** `src/graphics/body/AnatomyParts.ts`, `src/graphics/body/Proportions.ts`,
`src/game/BodyProfile.ts`, `tests/body_mass_test.ts` (new).

1. **Less slouch, more shoulder and trapezius**: a stated reduction of the upper-spine lean and a stated
   increase in deltoid + trapezius mass, measured in metres at named heights.
2. **Legs closer at the junction**: the hip joints move inward by a stated amount (stance width, metres).
3. **A crotch mass**: a small ellipsoid with its own size per sex — geometry only, stated in head heights.
   This must NOT touch the leg chain or the ground contact.
4. **The sex hierarchy**: shoulder-to-hip ratio by sex by a stated amount across all four races, plus the
   ranked ancestry × sex table computed from the data.
5. **Hold every existing invariant**: `bulky` stays the neutral 1.0 build, the ground-contact radii take no
   new multiplier, the rig stays under 12 000 triangles, and `tests/anim_measure_test.ts` and the ragdoll
   suites must be GREEN when you finish. If a bound moves, paste the number and STOP.

**Evidence:** literal `deno check`; the new test's pass count; `deno test` on the body/rig/ragdoll/anim suites
(list with counts, all green); `deno lint`; the printed before → after tables (slouch, trapezius, hip-joint
stance, crotch mass, shoulder-to-hip by race × sex) and the triangle counts.

## Lanes S-C and S-D — the argument (two opposite briefs, two files)

**S-C owns `docs/systems/COST-A.md`** — argue that powers must be EXPENSIVE and impactful: long casts, high
mana, long cooldowns, few casts per fight, each cast decisive.
**S-D owns `docs/systems/COST-B.md`** — argue that powers must be CHEAP and frequent: short casts, low mana,
short cooldowns, many casts per fight, that a fight is won by rhythm and combos rather than by one shot.

Both must: read `src/game/Skills.ts` and the balance instruments that already exist (`src/balance/MatchSim.ts`
with its own copy of the cost table, `Batch.ts`, `Summary.ts`, `Ladder.ts`, `tools/evolution-ladder.ts`), and
**argue with NUMBERS they measured** — run batches (headless, no browser needed) and quote the literal output
(durations, ending mix, damage, timeout share). Each file ends with a concrete proposed cost table (mana,
cooldown, cast seconds per shape) and the specific number it would move.

Neither may edit `src/**` or the other's file. The parent reconciles both in `docs/SPEC.md` §11K and states
which side won where, and why.

## Parent

`src/engine/Engine.ts` (right-click orbit; the cost re-export; the powers wired to the engine's own cast/aim
path), `tools/probe-wave-s.ts` (new), `docs/SPEC.md` §11K, `docs/systems/REPORT.md`,
`artifacts/systems/VERIFICATION.md`, `artifacts/data-science.md`, the gate, the commit.

## Acceptance

1. Right-drag orbits the third-person camera, the context menu does not appear on the play surface, and a
   left click still attacks.
2. Ten classes × five powers, each archetype-true, each derived from statistics and the weapon through one
   law, each with a cast time, a mana cost, a cooldown and an animation; combos and exclusions stated and
   tested; the duplicated cost table single-sourced; every shape/element/combo used at least once.
3. Two written arguments about the cost function, each with measured numbers and a proposed table; the
   reconciliation states which side won where.
4. The bodies are measurably less slouched, more muscled at the shoulder and trapezius, with closer hip
   joints, a stated crotch mass, and a shoulder-to-hip hierarchy by race × sex.
5. `deno task check` 0 errors · the full suite green (including the anim and ragdoll suites) · `deno lint`
   clean · `deno task build` · a real-browser probe for the camera and the cast.