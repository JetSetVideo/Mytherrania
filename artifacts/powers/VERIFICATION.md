# Wave N — verification (measured)

Every number below is a tool's literal output. Wave N answers the ask quoted in `docs/powers/BRIEF.md`:
the 300 s time-limit reading as an AI navigation failure, kiting/hiding/stalling, the assassin's
invisibility with an AI that understands it and a cue, casting with a bar, interrupts and pushback, and
autoattack with damage numbers styled by the combat statistics.

## 1. The user's headline hypothesis — MEASURED, and it is mostly WRONG

The ask reads the 300 s ending as "both AIs failed to navigate". The navigation lane measured it on the
repo's own headless back end (100/300 matches, seed 20261031, the navigation-stress design):

| design | timeouts / 100 | mean seconds to first contact |
| --- | --- | --- |
| grid (660 solid props), before | 29.0 (87/300) | 6.847 |
| grid, after the pilot | **29.0 (87/300)** | **6.847** |
| all designs, before | 11.0 | 6.688 |
| all designs, after | 10.3 | 6.688 |

**The timeout rate does not move.** And the reason is the useful finding: in the grid batch **85 of the
87 timeouts had already traded hits** (only 2 had zero hits) — the fighters REACHED each other, fought,
and did not finish. The pilot fired ~148 escape ticks over 300 matches (~0.5/match). So the residual
timeouts are a *not-finishing* problem, not a pathing problem. The pilot's own value is proved where
navigation IS the cause: each scripted stalled fixture (pinned on a prop, a wall, a rim) frees itself
inside its bounded `ESCAPE_MAX_S = 2.0 s`.

**This is reported as a negative result, not as a fix.** The lane wrote it that way and the wave repeats
it: claiming a pathing fix for that number would have been false.

## 2. Casting, live (lane N-D + the parent's gate)

An Assassin against a Mage, driven through the engine's own press path:

```
player seat   pressed power -> assassin-execution, channel 1.830 s, NOT instant
              cast bar #cast-0: state "cast", label "assassin-execution · 1.8s", fill 31.97 %, visible
AI seat       mage-arcane-nova, channel 2.567 s
              cast bar #cast-1: state "cast", label "mage-arcane-nova · 2.6s", fill 5.79 %, visible
              pushback observed on the caster: +0.002 s at 0.633 s elapsed (the caster was hit mid-channel)
```

The model's own tables (`tests/cast_test.ts`, 16 tests): a Mage's heavy spell is 2.629 s against a
Barbarian's 1.684 s; haste 50 % shortens it to 1.753 s; the pushback table is monotone in the hit's share
of the pool AND in how front-on it was (0.0782 s at a 25 % hit square-on, 0.6253 s at a full-power hit from
behind), bounded at 0.9 s per hit and 1.5 s per cast. A **heavy technique CUTS** a channel; a plain hit
only delays it.

## 3. Concealment, live (lane N-C + the parent's wiring)

One `Vanish` press, read off the engine:

```
conceal[0].active            true          <- authoritative in the SIMULATION, not in the renderer
enemy belief knowsPosition   false         <- the anti-cheat claim: the enemy cannot read the truth
enemy confidence             0.737         <- decayed from 0.85 since the vanish
enemy probable strategy      "hide"        <- the AI INFERRED the strategy from the disappearance
enemy target                 last known place (not the true position)
rig visibility               [true, true]  <- the concealed seat was the PLAYER's own; a concealed
                                             OPPONENT's model is not drawn (that is the rule wired)
```

The belief series across a concealment window (the lane's own run): the belief holds `(10,10)` while the
true position walks `(10,10) → (26,2)`, the confidence decays 0.85 → 0.053, and the belief lapses to
`null` at the 8 s memory horizon; a reveal re-acquires at confidence 1. `perceive` is asserted never to
carry the true coordinates while concealed.

## 4. Combat feedback, live (lane N-E + the parent's pool)

Floating numbers seen in a real match, each one read off the DOM: `● 826` (size 22.76 px, weight 428,
hue 10), `● 1 202` (25.25 px, 439), `● 410` (19.61 px, 415) — class `combat-text combat-text--hit`, with
`--ct-size/--ct-weight/--ct-hue/--ct-light/--ct-rise/--ct-life` set through CSSOM (never an inline style
attribute). A heavy flow addendum: the probe's last run MISSED the numbers' ≤1.6 s window entirely
(`seen: 0`), which is exactly why the earlier three samples are quoted with their values rather than a
count.

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | 0 errors |
| `deno task test` | see the wave report |
| `deno lint` | clean |
| `deno task build` | 1 822 116 bytes |
| `deno run -A tools/probe-wave-n.ts` | the numbers above, **0 page errors** |

## 6. Harness lesson that cost two probe runs (recorded, because it will bite again)

A headless page never takes pointer lock; the engine treats a lost lock during a fight as "open the
settings panel", and `onOpen` PAUSES the match. Everything then reads frozen — a cast's elapsed time stops,
hp stops moving — and it looks exactly like a game bug. Worse, a paused fight ignores every key but
Escape, so a probe that pressed keys measured the harness, not the game. The probe now (a) resumes with
Escape until the fight clock really advances, and (b) presses techniques through an engine QA path
(`debugPress`) instead of key events. Both are recorded in the `mytherrania-wave` skill.

## 7. Open, stated plainly

- **The strategies are chosen and reported but do NOT yet steer movement.** `chooseStrategy` runs per seat
  at the bell (measured: both seats picked `bait`), and the plan is recorded for the report; the
  movement bias `strategyAdvice` implies is not wired. So "kite and hide" exists as a decision and a plan,
  not yet as behaviour.
- **The pilot is wired into the headless simulator only**, not into the live engine's steering — and its
  own measurement says the live timeout number would not move anyway (§1).
- **The autoattack runs for both seats**, which makes the player's own technique presses compete with the
  automatic swing; a press during a channel is correctly refused, but the interaction deserves a design
  pass (a press should arguably cancel the swing rather than be dropped).
- **The interrupt path is implemented and unit-tested but was not observed live** (`interruptObserved: null`
  in every probe run) — the AI mage's channel was never cut by a heavy technique in the sampling window.
- The vanish hides a concealed OPPONENT's model; a concealed PLAYER's own model stays visible (the chosen
  rule — the player must still see themselves), so the visible disappearance is only half the concept.
- `renderPortrait`'s replacement and the portrait studio are Wave O's lane, not this wave's.
