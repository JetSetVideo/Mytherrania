# Wave K — verification (measured)

Every number below is a tool's literal output from this wave. Wave K is the tuning wave the user
asked for in their own words: *"the strikes that have more impact, they do more damages. You can
reduce the HPs because overall, there is too much AP and increase the cost of mana a little by 20%
or so and and improve the user interface with the statistics, put the numbers into the bars, make
them divided by squares with all over the bars and improve some of the attacks and the animations."*

**Name note.** `b559fef`/`6a964b5` are labelled "Wave J" — that wave (arena walls, symmetric maps,
AI arena digest, headless batch back end, spectator speed control) was a *second Hermes session*
working this repo, and it released all its claims in `~/Desktop/Mytherrania-comms/CHANNEL.md`
(MSG-5, 15:53 UTC) before this wave started. This wave is therefore **Wave K**, and the lane
reports it produced are `artifacts/messages-K*.md`.

## 1. Impact decides damage (the user's first ask)

`src/combat/Impact.ts` gained a bounded, monotone `impactMul` on the geometric-contact path;
`src/game/Physics.ts` widened its multiplier band and steepened the closing-speed term
(`0.85 + 0.55·min(2,|v|)`, was `0.85 + 0.15·min(2,|v|)`; `closing(0) = 0.85` unchanged, so the
SPEC P2 pin still reads exactly 0.935).

Measured by `tests/impact_balance_test.ts` (lane K-A):

| claim | target | measured |
|---|---|---|
| full-speed heavy blow ÷ the same blow standing still | ≥ 2.2× | **2.294×** (`0.935 → 2.145`) |
| a graze ÷ the same blow standing still | ≥ 0.45× | **0.507×** |
| damage against closing speed 2 → 14 m/s | monotone | **9.3 → 28.4** |

## 2. Smaller pools, same DPS × eHP invariant

`HEALTH_SCALE 1000 → 500` with `DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH` still `= 50`; the class
damage solve keeps `TARGET_POWER_INDEX = DPS × effectiveHP`.

| metric (seed 20261009, race applied) | before | after |
|---|---|---|
| health pool (Barbarian → Necromancer) | 53 250 → 39 200 | **26 625 → 19 600** |
| attack power | 680 → 1 335 | **340 → 667** |
| median decisive duel | 51.8 s | **36.7 s** (target 25–55) |
| damage per hit p20 / p50 / p80 | 662.4 / 860.0 / 1 105.2 | **402.9 / 603.6 / 824.3** |
| damage p80 ÷ p20 | 1.67 | **2.05** (target ≥ 1.9) |
| mean hits to kill | 51.3 | **36.2** (dropped) |
| mirror win rates (`tools/balance-report.ts`, 28 pairs) | 48.7–51.1 % | **49.3–50.9 %** |
| per-class field share | 39.7–55.2 % | 44.0–53.6 % |

Live seats (headless Chrome, spectate match, `snapshot().player/opponent`):
`Warrior max 30 900 / hp 30 900, attackPower 488, vitality 14`; opponent `Warrior max 37 200,
attackPower 868, vitality 26`. The base sheet is the halved one; the seat's **level growth**
(+3 %/level, from the paired session's Wave J `applyLevel`) lifts a high-level spectate seat back up
(level 20 ⇒ ×1.57), which is where a card reading `47 100 / 47 100` comes from. The halving is ×0.5
on the class sheet, not on the levelled pool.

## 3. Mana ×1.2

`SKILL_RESOURCE_COST` (parent lane): `power 20 → 24`, `defense 5 → 6`, `dash 0` (a stamina move).
Pinned by `[SPEC KK1]`, which asserts each row is exactly 20 % above the recorded pre-wave table.

## 4. The statistics bars: numbers inside, squares across

`barLabel(value, max)` → `"47 100 / 47 100 · 100%"`; `barSegments(model, BAR_SEGMENTS)` with
`BAR_SEGMENTS = 12` (divides by 2/3/4/6; ~12 px per square at the narrowest HUD track).

Live DOM read (in the probe, from the rendered card — not from the model):

```
texts:            ["47 100 / 47 100 · 100%", "192 / 192 · 100%", "220 / 230 · 96%"]
squaresPerBar:    [12, 12, 12]
fullSquares:      [12, 12, 11]
numbersInside:    true      squared: true
```

The card's widths/colours are written **through CSSOM** (`style.width`,
`style.setProperty("--bar-colour", …)`), because an inline `style="…"` attribute is blocked by the
server's `style-src 'self'` CSP — the same bug that once made the History bars render nothing.
`[SPEC KK3]` pins that as text on `Engine.#renderInspect`. `[SPEC KK2]` pins the model: a third of
the bar is 4 full squares of 12, the squares' fills sum to the bar fraction in square units, and
`barLabel` is total for `0/0`, `NaN` and `value > max`.

## 5. Better strikes and animations

`src/game/anim/Swing.ts` gained `anticipationSeconds(strike, heftMul)` (wind-up follows a
`tanh(ln(I/I_ref)/spread)` inertia term), `impactHold(base, impact) = clamp(base·(1 + 0.7·impact),
0.03, 0.32)` and `impactSettle(base, impact) = base·(1 + 0.9·impact)`; `MotionStyle` deepens the
counter-move with weapon heft.

| attack | prime joint, before → after | realized travel | clamp share |
|---|---|---|---|
| Rogue `shadowstep` | 1.00 → 1.25 rad (57.3° → 71.6°) | 59.9° → **74.9°** | 0.36 % of joint-frames |
| Barbarian `skullsplitter` | 1.90 → 2.05 rad (108.9° → 117.5°) | 122.8° → **132.3°** | 0 |
| Mage `arcane-nova` | 1.60 → 1.85 rad (91.7° → 106.0°) | 103.5° → **119.5°** | 0 |

Wind-up by weapon (strike 0.2 s): dagger 0.171 s, longsword 0.185 s, warhammer 0.193 s (monotone).
Hold by impact (base 0.07 s): 0 → 0.070, 0.5 → 0.095, 1 → 0.119 s (monotone, bounded).
The attack rate is unchanged: strike duration is identical across impacts and for all 8 class
intervals × 3 weapons × 7 impacts `windup + strike + hold ≤ COOLDOWN_SHARE · cooldown`
(worst warhammer blow 0.537 s vs 1.096 s budget). Worst per-joint clamp share over the 24 skills:
`warrior-bulwark elbowL 2.5 %` (< 25 %).

`deno run -A tools/anim-report.ts` after the change: 108 swings / 72 loops, `swingSlideMaxMm 5.22`,
`floorMinMm -0.00`, `cycleSeamMaxDeg 2.04`, `limitViolations 0`, `freshBlowOverCooldownMax 0.90`.
A diff of the regenerated `artifacts/anim-report.json` against the pre-change copy: 4 813 scalar
fields, **25 diffs — all of them `styleDifferences.*[20]` (the anticipation coefficient), the
race-pair style distances' 4th decimal and `generatedAt`; zero diffs among the 108 swings, the 72
loops and every summary metric** — i.e. at `impact = 0` the new timing is a behavioural no-op.

## 6. Gate (all literal)

| command | result |
|---|---|
| `deno task check` | 0 errors |
| `deno task test` | `ok \| 1346 passed \| 0 failed (1m46s)` |
| `deno lint` | `Checked 479 files` (0 problems) |
| `deno task build` | `1768201 bytes` (Wave I: 1 725 306) |
| `deno test tests/spec_test.ts` | `ok \| 36 passed \| 0 failed` (KK1–KK3 added) |
| `deno run -A tools/probe-wave-i.ts` | camera angle held, card hover/swap/close, bars as above, props `floating 0`, seams `16/16`, clash capped, **`errors: []`** |
| `deno run -A tools/frame-budget.ts` | spectate `cpuMs p50/p95/p99 1.8/2.4/2.7 ms`, headroom **13.9 ms** of 16.6; day p99 3.2 ms; night p99 9.8 ms; cadence p50 16.7 ms; gpu p95 9.7 ms |
| `deno run -A tools/balance-report.ts` | mirror matrix 49.3–50.9 %, 5/28 balanced pairs |

## 7. Re-pinned, and why (no bound was loosened silently)

Wave K made three pre-existing pins false, and all three were re-stated rather than deleted:

- `[SPEC H2]` asserted `HEALTH_SCALE === 1000` (after the change that is a *type* error, so
  `deno check` aborted) and a 25–160 hits-to-kill band. Now: `HEALTH_SCALE === 500`,
  `DAMAGE_SCALE === HEALTH_SCALE / FIGHT_LENGTH`, and the **measured** band 18–90 (21.5–59.0).
- `[SPEC H1]` asserted an average hit stuns 0.05–0.20 s and an "unscaled damage is absurd" ratio of
  50×; the steeper impact term raises the worst average hit to 0.218 s (~13 frames) and
  `DAMAGE_SCALE` is now exactly 50, so the band is 0.05–0.25 and the ratio 20×.
- `tests/balance_decision_test.ts` ("J-B D6") hard-coded a 45 000 pool written for
  `DAMAGE_SCALE = 100`. Now the pool is derived: `45 * HEALTH_SCALE`, so the assertion compares the
  two meter rules **at the same pool** again instead of at two different ones.

## 8. Fixed in passing (measured, not cosmetic)

`tools/frame-budget.ts` called the engine's debug hooks as extracted methods, losing their private
fields (`page.evaluate: TypeError: Cannot read properties of undefined (reading '#q')` inside
`debugSpectateCam`). Now called with the engine as `this`. Without that fix the frame measurement
could not run at all.

## 9. Open, stated honestly

- `tools/balance-report.ts` prints no duration or damage distribution; lane K-A measured those with
  a companion script on the same seed rather than restructuring the shared tool.
- The impact hold reaches the swing through `SwingDriver.begin(..., impact)`, fed with the press's
  measured closing speed normalised on 12 m/s. It is a **caller-supplied** quantity: the animation
  answers the impact it is told about, and only `Engine` knows it at the press.
- `freeCamera true, effects false`: the frame tool found my Wave-I free-camera hook but not an
  `debugEffects/debugSparks` name, so the spectate sample does not switch the effects governor on.
  The governor itself is exercised by `tools/probe-wave-i.ts` (sparks capped at 96).
- The bars' segment fills are asserted in the model and read live from the card's DOM; the **HUD**
  panel (`.fp-seg`) was verified by unit tests and CSS inspection, not by a DOM read in the probe.
- Pools above the class sheet come from the paired session's level growth; this wave did not audit
  that growth's own bounds.
