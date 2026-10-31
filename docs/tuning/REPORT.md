# Wave K — report

**What the user asked (their words).** *"Change some of the values of the game and equations so that the
strikes that have more impact, they do more damages. You can reduce the HPs because overall, there is too
much AP and increase the cost of mana a little by 20 % or so and improve the user interface with the
statistics, put the numbers into the bars, make them divided by squares with all over the bars and improve
some of the attacks and the animations."*

**Decoded, spoken → decoded → where it landed.**

| spoken | decoded | landed in |
| --- | --- | --- |
| "the strikes that have more impact, they do more damages" | damage must be driven by the blow's impact — closing speed, mass, lever, zone — not just by the attacker's power | `src/combat/Impact.ts` (`impactMul`), `src/game/Physics.ts` (steeper closing term, band 0.5–2.2×) |
| "reduce the HPs because overall, there is too much AP" | halve the health pools, re-solve the class damage, make one hit a bigger share of a bar | `src/game/Stats.ts` (`HEALTH_SCALE 1000 → 500`, `DAMAGE_SPREAD 0.35 → 0.55`) |
| "increase the cost of mana a little by 20 % or so" | ×1.2 on the technique prices, stamina untouched | `src/engine/Engine.ts` (`SKILL_RESOURCE_COST`: power 24, defense 6, dash 0) |
| "put the numbers into the bars, make them divided by squares with all over the bars" | value / max · share drawn INSIDE every stat bar, and the bar cut into squares across its whole length | `src/ui/FighterPanel.ts`, `src/ui/InspectOverlay.ts`, `styles.css`, `Engine.#renderInspect` |
| "improve some of the attacks and the animations" | the animation must show the impact: wind-up by weapon heft, a hold that answers the blow, a recovery that answers what was hit | `src/game/anim/Swing.ts`, `src/game/anim/MotionStyle.ts`, `src/game/Skills.ts` (3 named attacks) |

**Result, measured.** A full-speed heavy blow is 2.294× the same blow standing still (was capped at 1.8×) and
a graze 0.507×. Pools and attack power are exactly ×0.5; the median decisive duel fell 51.8 s → 36.7 s, per-hit
spread p80/p20 rose 1.67 → 2.05, hits-to-kill 51.3 → 36.2, and the mirror matrix stayed inside 48–52 %
(49.3–50.9 %). Mana is ×1.2. Every bar shows `47 100 / 47 100 · 100%`-style numbers inside and 12 squares
across (12/12/11 full on the live card). Three attacks — Rogue `shadowstep`, Barbarian `skullsplitter`, Mage
`arcane-nova` — now command 71.6° / 117.5° / 106.0° of their prime joint (was 57.3° / 108.9° / 91.7°) with the
peak on the hit frame, the hold growing 0.070 → 0.119 s with impact, and the attack rate provably unchanged.

**Gate.** `deno task check` 0 errors · `deno task test` **1346 passed / 0 failed** · `deno lint` 479 files clean ·
`deno task build` 1 768 201 B · probe 0 page errors (camera angle held, cards open/swap/close, props floating 0,
seams 16/16, sparks capped) · frame budget spectate p99 **2.7 ms** (13.9 ms of headroom, 16.7 ms cadence).

**Name.** This is Wave **K**. A second Hermes session on this repo had already shipped a wave it labelled "J"
(arena walls, symmetric maps, AI arena digest, headless batch back end) and released it at 15:53 UTC, so this
wave was renamed and its sections/spec entries follow.

**Wiring.** The impact the animation answers is the press's measured closing speed, normalised on 12 m/s; the
engine passes it into `SwingDriver.begin(..., impact)` at the swing, and the animation's own answer is
`impactHold`/`impactSettle`/`anticipationSeconds`. The card's bars are written through CSSOM only — an inline
style attribute is blocked by the server CSP and was a real bug in this repo's History view.

**Not done, stated plainly.** `tools/balance-report.ts` still prints no duration/damage distribution (lane K-A
measured those with a companion script rather than restructuring a shared tool); the HUD's own squares are
covered by unit tests and CSS inspection, not by a live DOM read (the card's are read live); the frame sample
does not switch the effects governor on (`effects false` — the tool finds no `debugEffects` name), though the
probe exercises the governor directly; pools above the halved class sheet come from the paired session's
level growth, whose own bounds this wave did not audit.

Full evidence: `artifacts/tuning/VERIFICATION.md`, contract `docs/tuning/BRIEF.md`, spec §11C,
`tests/impact_balance_test.ts`, `tests/bars_test.ts`, `tests/strike_anim_test.ts`, `[SPEC H1/H2/KK1–KK3]`.
