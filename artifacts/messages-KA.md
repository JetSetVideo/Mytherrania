# messages-JA — lane J-A (impact-driven damage, smaller pools)

To the parent. Two pins in `tests/spec_test.ts` (parent-owned — I did NOT edit it) are made
FALSE by lane J-A's `HEALTH_SCALE = 500`. Exact measured numbers, so you can re-pin them:

## SPEC H2 (line 137–147) — breaks two ways
- **Line 138 `assert(HEALTH_SCALE === 1000, ...)`** is now a type error and a false claim:
  `HEALTH_SCALE` is **500** (`DAMAGE_SCALE = 50`, still `HEALTH_SCALE / FIGHT_LENGTH`).
  This is what aborts `deno task check` and `deno task test` (the whole suite fails to type-check).
- **Line 146 hits band 25–160**: with the new pools the range is **21.5 … 59.0** (was inside 160;
  the low end now dips to 21.5 for the sharpest pairs because damage is chunkier). Suggest band
  **20–70** (or re-derive).

## SPEC H1 (line 121–135) — the "absurd stun" ratio assert
- **Line 132 `stunDuration(dmg,1.2,0) > stun * 50`** is now EXACTLY false: it simplifies to
  `DAMAGE_SCALE > 50`, and `DAMAGE_SCALE` is now exactly **50** (`HEALTH_SCALE 500 / FIGHT_LENGTH 10`).
  It fires for the very first pair (Barbarian→Barbarian, stun 0.107 s). Suggest `>= stun * 50`, or
  compare against a fixed constant instead of `DAMAGE_SCALE / 10`.
- **Line 131 stun band 0.05–0.20** currently *passes on the first pair* but is borderline and would
  ALSO fail once 132 is fixed: the max stun is now **~0.203–0.218 s** (Mage→Mage 0.2027,
  Necromancer→Mage 0.2184) because the steeper closing term multiplies the stun-driving damage by
  1.40×. Suggest band **0.05–0.25**.

## Not broken
- SPEC P2/P3/P4/P5 still pass unchanged (equal bodies at rest are still exactly 0.935; the closing
  term still saturates at |v| = 2). HX1 (level band) still passes — it reads `HEALTH_SCALE` and
  `DAMAGE_SCALE` constants, so it adapted.
- No other module fails `deno task check`; the only type error is `spec_test.ts:138`.

## THIRD pin broken — tests/balance_decision_test.ts:100 (not mine, not in the lane table)
`J-B D6: the judge at the bell, the knockback meter and floor` now fails:
`error: 45 k pool: engine 14.4 vs relative 7.2`. The test hardcodes a **45 000** pool and compares
`meterGain(ENGINE_RULES, 900, 45000, DAMAGE_SCALE)` with the relative rule; it was written for
`DAMAGE_SCALE = 100`. With `HEALTH_SCALE = 500`, `DAMAGE_SCALE = 50`, so the engine term is exactly
half (14.4 vs the 7.2 the relative rule already produced). Fix is the test owner's: use the live
`HEALTH_SCALE`-derived pool (`createStats("Barbarian").maxHealth`) or the current `DAMAGE_SCALE`
instead of the literal 45 000. (Confirmed mine: with my three source files stashed at HEAD this test
and `strike_anim_test.ts` both pass — 13 passed.)

I own only `src/game/Stats.ts`, `src/game/Physics.ts`, `src/combat/Impact.ts`,
`tests/impact_balance_test.ts`; everything else is yours to re-pin.
