# Wave S — report

**What you asked** (decode table + verbatim in `docs/systems/BRIEF.md`; two decodes flagged): a right-click
third-person camera; five archetype-true powers per class tied to animations, weapons and statistics, with
cast times, mana and cooldowns; agents to argue the balance and the cost function; and bodies less slouched,
more muscled at shoulder and trapezius, closer at the hip junction, with a small crotch mass and a
shoulder-to-hip hierarchy by race and sex.

**The camera works.** Measured in a real Chrome: holding the **right button** and dragging orbits the live
third-person camera (**yaw −25.4°, pitch +4.5°** across an 8-step drag, `dragging: true` while held), the
browser's context menu is **suppressed** on the play surface, and only the left button attacks. It routes
through the *same* input path the pointer-locked mouse already used, so the camera maths, the pitch clamp and
the sensitivity stay in one place and only the gesture is new. One measurement caveat: the delta includes the
live fight's own camera motion, so the exact degrees are not a pure drag figure.

**Forty powers, one law.** Every class got five powers that fit its archetype — the assassin becomes
invisible (`assassin-vanish`) and sprints, the mage has `mage-fireball` and `mage-force-cone`, the rogue
sprints into a backstab — each declaring a **shape** (instant / projectile / cone / aura / self-buff) and
deriving its amplitude, cast time, mana, cooldown and duration from **the caster's own attributes and
equipped weapon** through `PowerCost.ts`. The test that matters fails a liar: a forged power with amplitude
42 / cast 99 s / mana 999 does not pass derivation, and raising a power's *own* attribute moves its numbers
while raising an unrelated attribute does not. Twelve **combos** and eight **exclusions** are stated, so no
class has everything — 8 classes × 5 powers, every shape, element and combo used at least once (asserted,
not printed). Animations are built on the existing `SkillAnimation` tracks with the **wind-up equal to the
cast time**, so the tell *is* the cost.

**Your "it's already somewhere else" was right.** `SKILL_RESOURCE_COST` existed twice — in `Engine.ts` and
in `MatchSim.ts`. It now lives in one place and both re-export it.

**The argument, settled by measurement rather than by rhetoric.** Two agents wrote against each other
(`docs/systems/COST-A.md` vs `COST-B.md`). S-D isolated the mana dial at runtime and measured the game's own
scoreboard: zeroing the power's mana left the weighted score **flat (0.8052 → 0.8060)**, raised closeness
0.621 → 0.717 and cut the median duration 38.25 → 31.83 s. S-C's case was correlational and says so itself,
but it won the *time* question: its batch shows casting more **lowers** the KO share (0.29 → 0.17) instead
of making fights decisive. I ruled where the evidence did: **mana down to S-D's curve, cast time up on the
heavy shapes, cooldown kept as a shape-ordered ladder** ("you have to wait longer with another cast"). Both
advocates' honest negatives are kept: the grid cells cast nothing at any price, so the 33 % timeout share
there is a **strategy/arena problem, not a cost problem**.

**The body.** Shipped: the shoulder girdle is squared forward (**5.5–7.2 mm** across four races — a
redistribution, not added volume) and the trapezius is redistributed inward and up so the torso's top over
the shoulder line rises **9.0–14.8 mm**; plus the **race × sex shoulder-to-hip hierarchy** (female 13.4 %
lower than male, ranked across all 16 ancestry nodes). Dropped with numbers, because each moved a physical
property a suite pins: **hip joints closer** (the planted-foot slide went 5.54 → 6.21 mm at a 2 % stance
change, against a 5.6 mm band), **the crotch pack** (mid-size broke the ragdoll's ground settle; only a
≤8 % copy ≈ 2 mm stayed green, which is not a pack), **deltoid mass** (ork trunk-skin travel 54 → 56–61 mm
against a 56.2 mm bound), and the **neck straighten** (pushed the forearm's weld share to 1.992 % below the
ragdoll's 2 % floor). The lane bisected every one of those itself, per the steer.

**Verified by:** `deno task check` 0 errors · **1624 passed / 0 failed** · `deno lint` 546 files 0 problems ·
`deno task build` 1 876 561 B · `tools/probe-wave-s.ts` (the numbers above, 0 page errors).

**Not done, plainly.** **The forty powers are not yet on the skill bar** — the runtime still fields each
class's three legacy skills (`skillsForClass`, `Engine.ts:1677`), so the powers are defined, derived and
tested but not yet *played*; that is the wave's headline open item and the seam is named. The reopened
questions from the argument (whether the reconciled table actually moves the KO share) need a batch run
against the runtime, not the sim's copy. And nothing here was judged by eye.

**Deferred instead of faked:** the dwarf's shoulders, the pectorals, the crotch pack, the deltoid mass and
the hip-joint stance are all still unchanged, each for a measured reason.
