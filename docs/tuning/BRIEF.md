# Wave K — impact-driven damage, smaller pools, pricier mana, segmented bars, better strikes (contract)

Frozen 2026-10-31 by the parent from the user's spoken brief. Lanes code against the interfaces and
targets here and may not renegotiate them. Blocked? Write `artifacts/messages-J<lane>.md` and keep working.

## 0. The decoded brief

| Spoken | Decoded | Where |
|---|---|---|
| "the strikes that have more impact, they do more damages" | damage must respond MORE strongly to impact (closing speed, mass, lever, zone) — a full-speed heavy blow must be worth much more than a standing tap | J-A (`Impact.resolveStrike`, `Physics.physicsMultiplier`) |
| "reduce the HPs because overall there is too much AP" | fewer hit points and smaller attack-power NUMBERS, with the fight shorter: the pools come down (HEALTH_SCALE 1000 → 500) and the class damage is re-solved, so one strike is a bigger share of a life bar | J-A (`Stats.ts`) |
| "increase the cost of mana a little by 20% or so" | every mana cost ×1.2 | parent (`Engine.SKILL_RESOURCE_COST`) |
| "improve the user interface with the statistics, put the numbers into the bars, make them divided by squares with all over the bars" | every stat bar carries its numbers INSIDE it and is divided into squares across its whole length | J-B (`FighterPanel`, the inspect card's bars, `styles.css`) |
| "improve some of the attacks and the animations" | attacks read better and answer the impact: anticipation, an impact hold on a heavy blow, a recoil that scales with what was hit | J-C (`anim/Swing.ts`, `Skills.ts`, `MotionStyle.ts`) |

## 1. Targets (numbers the lanes must hit and MEASURE)

### 1.1 J-A — the balance lane (`src/game/Stats.ts`, `src/game/Physics.ts`, `src/combat/Impact.ts`)

| Target | Value | How it is checked |
|---|---|---|
| Health pool | `HEALTH_SCALE = 500` (was 1000); `DAMAGE_SCALE` stays the derived `HEALTH_SCALE / FIGHT_LENGTH` | `tests/spec_test.ts` pins the derived relationship, not the literal |
| Class parity | mirrors stay inside **48–52 %** | `deno run -A tools/balance-report.ts` (report the whole matrix) |
| Fight length | median decisive duel inside **25–55 s** (it is 40–80 s today) | the harness's duration distribution |
| Impact range | `PHYSICS_MUL_MIN = 0.5`, `PHYSICS_MUL_MAX = 2.2`, and the closing-speed term steeper than today's `0.85 + 0.15·min(2, |v|)` | `PHYSICS_MUL_*` exported constants + a monotonicity test |
| Impact response | a blow at full closing speed from a heavy body must be worth **at least 2.2×** the same blow standing still, and a graze at least **0.45×** | a test that sweeps speed × mass and asserts the recorded ratio, printed |
| Damage per hit | a p80 strike must be at least **1.9×** a p20 strike (today's weapon spread makes it closer) | the harness prints the damage distribution p20/p50/p80 |
| Hits to kill | report the mean hits-to-kill per class pair before/after; it must DROP (fewer HP, chunkier hits) | harness |

Rules: `attackDamage` and `resolveStrike` stay pure; every new constant is exported and documented with its
unit; the balance solver's invariant (`TARGET_POWER_INDEX = DPS × effectiveHP`) must still hold — state the
equation in a comment; no `Math.random`; nothing in the pure modules may read the DOM or THREE.

### 1.2 J-B — the UI lane (`src/ui/FighterPanel.ts`, `src/ui/InspectOverlay.ts`, `styles.css`)

- Every bar (HUD life/mana/stamina panels AND the inspect card's bars) shows its numbers **inside the bar**:
  the current value, the maximum, and the share as a percentage — readable at 1280×800 and at 390 px.
- Every bar is **divided into squares across its whole length** (a fixed number of segments, e.g. 10 or 12 —
  state which and why), drawn as tick divisions that read as squares: the filled part must clearly show
  which squares are full and which are empty, and the squares must line up with the fill edge at any width.
- Both must survive: a value of 0, a value equal to max, a value above max, `max = 0`, a NaN input, and a
  1 px-wide bar. Nothing may clip at the four breakpoints (<=767 / 768-1023 / 1024-1439 / >=1440).
- The bar model stays PURE (`barModel` + a new `barSegments(model, segments)` returning per-square fill
  fractions 0..1 and the label text), so it is unit-tested with no DOM; the DOM layer only sets widths and
  text through CSSOM — never an inline `style="…"` attribute (the server CSP blocks those).
- `BarModel.text` must now carry the numbers the bar shows (value / max and the %), and the existing tests
  that read `text` must be updated ONLY where the format is asserted — do not weaken them.

### 1.3 J-C — the animation lane (`src/game/anim/Swing.ts`, `src/game/Skills.ts`, `src/game/anim/MotionStyle.ts`)

- Anticipation: the wind-up must scale with the weapon's mass/archetype (a hammer winds up longer than a
  dagger) — state the equation and keep the total swing inside the class attack interval.
- Impact hold: a blow that lands at speed holds its pose longer than a graze (a stated
  `hold = f(impact)`), and the hold must not change the attack rate (the repo's rule from the motion pass).
- Recoil/settle: the recovery must answer what was hit — a heavy strike settles slower, a whiff settles
  fast. Bounded, monotone in impact, never a pop (continuous at both ends).
- Improve at least three named attacks and say which (e.g. the Rogue's Shadowstep, the Barbarian's
  Skullsplitter, the Mage's Arcane Nova), each with a stated reason and a before/after pose measurement.
- Keep `tools/anim-report.ts` clean: no slide, no floor penetration, no seam, no clipping, and the
  per-joint clamp share under 25 % (the repo's rule).

## 2. Lane ownership

| Lane | Owns |
|---|---|
| J-A | `src/game/Stats.ts`, `src/game/Physics.ts`, `src/combat/Impact.ts`, `tests/impact_balance_test.ts` |
| J-B | `src/ui/FighterPanel.ts`, `src/ui/InspectOverlay.ts`, `styles.css`, `tests/bars_test.ts` |
| J-C | `src/game/anim/Swing.ts`, `src/game/Skills.ts`, `src/game/anim/MotionStyle.ts`, `tests/strike_anim_test.ts` |
| Parent | `src/engine/Engine.ts` (the mana table, the HUD wiring), `docs/SPEC.md`, `tests/spec_test.ts`, the probe, the gate, the commit |

## 3. The gate (every lane before it reports done)

1. `deno check <your files>` → 0 errors. 2. `deno test --allow-read --allow-write=artifacts tests/<your test>` → all pass.
3. `deno lint <your files>` → clean. 4. No `Math.random` in a pure module. 5. Report with the literal command
output, including the BEFORE/AFTER numbers the targets above demand — an unmeasured target is not met.

## 4. What the parent does after the lanes land

Wire the mana ×1.2, pin the new invariants in `tests/spec_test.ts`, run the gate (`deno task check`, the full
suite, lint, build), re-run `tools/probe-wave-i.ts` and `tools/frame-budget.ts` to prove nothing regressed,
photograph the new bars, and commit with the before/after numbers in the message.
