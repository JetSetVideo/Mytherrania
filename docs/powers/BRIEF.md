# Wave N — navigation, strategy, invisibility, casting and combat feedback (contract)

**The user's ask, verbatim** (voice transcript; the drift is light here, the scope is not):

> "When launching a game with the spectator mode, one of the ending condition is the 300sec limit. It's an
> important indicator that the AIs probably both failed probably because of navigating the terrain and
> generating a good valid pathfinding. Therefor their AIs must be improved to make sure the AIs can
> understand how to reach their opponents. But the goal is also to have the same AIs system be able to kite
> and find strategies that allow them to hide or push the temporality. For that, we need to improve the
> classes' powers (like assassin can becaome invisible server side so the opponent cannot cheat and the AI
> must understand that the disparition of the opponent visually is probably an effect of his strategy. And a
> sound queue is played like in world of warcraft). Also the mages have an animation loading and globally
> some strong powers have longer animations to cast (with the cast bar). The cast time can be inturrepted by
> some special powers from classes or generally extended if the caster is being hit by a weapon depending on
> all the variables (angle, stamina, percentages of everything, rations for everythings. Add autoattack and
> numbers of damages popping out of the victim with their styles, colors, boldness, size, speed, birhgtness,
> hueness, etc depending on all the statistics of the combat."

**Decoded** (spoken → decoded → where it lands). Two words needed a decode; the rest is plain and its scope
is the reason this wave is five lanes.

| spoken | decoded | flag | lands in |
| --- | --- | --- | --- |
| "the 300sec limit … the AIs probably both failed … navigating the terrain and generating a good valid pathfinding" | a timeout is the AI's failure to REACH its opponent: the pathing/steering quality is at fault (A\* already exists — `src/world/PathFinder.ts`, both seats route around props) | — | lane N-A |
| "the AIs must understand how to reach their opponents" | pathing that survives blocked corners, prop clusters, walls and a MOVING target, plus a stuck-detector that re-plans instead of grinding | — | lane N-A |
| "kite and find strategies that allow them to hide or push the temporality" | an explicit STRATEGY layer: keep-away (kite), break-contact/hide, and time-stalling (push the clock) as first-class intentions with their own parameters — one vocabulary the AI, the opponent model and the report all share | — | lane N-B |
| "assassin can become invisible **server side** so the opponent cannot cheat" | invisibility is AUTHORITATIVE STATE in the simulation (not a rendered illusion): a seat's true position stays in the sim but the opponent's PERCEPTION loses it, so no client can read it out of the DOM | **FLAG**: I read "server side" as *authoritative in the simulation*, since this build has no server — the sim is the authority, and the renderer must not be the only thing hiding | lane N-C |
| "the AI must understand that the disparition of the opponent visually is probably an effect of his strategy" | the AI facing an invisible enemy must INFER it (last-known position + a probable-strategy belief), not simply freeze or cheat | — | lane N-C |
| "a sound queue is played like in world of warcraft" | a distinct, instantly recognisable cue when the vanish happens (and for cast start/interrupt), on top of the existing procedural sound set | — | lane N-C + lane N-D + parent |
| "strong powers have longer animations to cast (with the cast bar)" | a CAST system: a cast duration derived from the power, its element and the caster's stats; a cast bar; mages' heavy spells are the long end of it | — | lane N-D |
| "The cast time can be inturrepted by some special powers from classes or generally extended if the caster is being hit by a weapon depending on all the variables (angle, stamina, percentages of everything)" | interrupts (special powers cancel a cast) and PUSHBACK (being hit delays the cast, scaled by the hit's own variables: angle, the striker's stamina/damage share, both fighters' percentages) | — | lane N-D |
| "Add autoattack" | swings that happen by themselves on the attack interval when the target is in reach — the layer the AI and the player both stand on | — | lane N-E |
| "numbers of damages popping out of the victim with their styles, colors, boldness, size, speed, brightness, hueness, etc depending on all the statistics of the combat" | floating combat text whose STYLE is a pure function of the combat statistics: size/boldness/brightness/hue/rise speed/colour depending on how big the hit was, whether it crit, whether it was absorbed/resisted, which element and which weapon | — | lane N-E (model) + parent (the DOM writer) |

**What already exists — extend it, do not rebuild it.** `src/world/PathFinder.ts` (`GridPathFinder`,
`obstaclesFromProps`, `steerAlongPath`, `PathCursor`, `PathPoint`, `Steer`) with A\* routes for both seats in
`Engine` (`#botRoute`, the player seat's own route); `src/game/AiBrain.ts` (the edge-aware behaviour);
`src/game/DecisionTree.ts` (`decide`, `defaultTree`, `edgeAwareTree`, `arenaFeatures`); `src/game/Status.ts`
(control effects and who steers); `src/game/Skills.ts` (24 skills, `assassin-vanish` among them, elements
fire/fury/poison/shadow); `src/audio/AudioManager.ts` (procedural WebAudio: `playImpact`, `playStep`,
`playSkill(element)` — a new cue belongs beside those); `src/game/anim/Swing.ts` (the anticipated swing
timing the previous waves pinned); `src/game/Stats.ts` (`attackInterval`, `attackDamage`,
`criticalChance`). Wave M (in flight) adds `src/game/FightTelemetry.ts` (the live accumulator, including
`standoffMaxS`, the distance bands and the dry streaks) and `src/game/MatchReport.ts` (the strategy belief in
the opponent model) — **N must reuse M's telemetry as its evidence instrument and N-B's strategy ids must be
the ones the opponent model reports.**

House rules binding every lane: pure modules where the logic lives (no DOM, no THREE, no `Math.random` except
where the repo already seeds), TDD, comments say WHY with units, no `any` without a scoped ignore, never an
inline `style="…"` attribute (the page CSP — the previous wave lost a screen to it), a claim without a tool's
literal output is not evidence, and a bound a deliberate change makes false is re-stated from measurement.

---

## Lane N-A — `src/world/PathFinder.ts` (edit) + `src/game/NavPilot.ts` (new) + tests

`NavPilot` is the layer between a path and a body: it owns the stuck detector, the re-plan cadence, the
last-metre approach to a MOVING target, and the corner/prop-cluster escape.

```ts
export interface NavPilot { /* see the file: plan(target, from, obstacles), step(dt, self), stuckS, replans */ }
export function createNavPilot(o: { arriveM?: number; replanS?: number; stuckS?: number }): NavPilot;
export function progressToward(from: XY, to: XY, vel: XY, dt: number): number;   // how much closer we actually got
```

Requirements: a fighter pinned against a prop, a wall or a rim must escape within a bounded time (asserted on
a scripted fixture of each case); a target that moves must be re-planned at a bounded cadence and never chased
along a stale path beyond a stated distance; `progressToward` must be the detector's basis (moving is not
progress). Every bound is a named constant with units.

**Evidence:** `deno check`, the test file's count, `deno lint`, and the two-number measurement on the repo's
own headless batch (`src/balance/Batch.ts` `runBatch`, `tools/probe-batch.ts` as the template), same seed
before/after: **timeouts per 100 matches** and the **mean seconds to first contact**. If the timeout rate does
not improve, say so with both numbers.

## Lane N-B — `src/game/Strategies.ts` (new) + `tests/strategies_test.ts` (new)

The vocabulary the whole wave shares.

```ts
export type StrategyId = "brawl" | "kite" | "hide" | "stall" | "bait" | "trade";
export interface StrategyPlan { id: StrategyId; keepAwayM: number; engageBelowM: number; retreatBelowHp: number; hideAfterS: number; stallPullS: number; reason: string }
export function planFor(id: StrategyId, ctx: { hpFracSelf: number; hpFracFoe: number; timeLeftS: number; timeLimitS: number; classId: string }): StrategyPlan;
export function chooseStrategy(ctx: {...}): StrategyId;         // deterministic, stated weights
export function strategyAdvice(id: StrategyId, ctx: {...}): { move: "close" | "hold" | "flee"; useSkill: boolean; fleeTo?: XY };
```

Requirements: "push the temporality" must be expressible — a seat ahead on health with little time left can
prefer `stall`/`kite` and the plan must say so in its `reason`; a seat behind on health must not stall
forever (a switch condition, asserted); the ids must be the ids the opponent model reports (Wave M's
`probableStrategies`). Assert determinism and that every id produces a finite, in-band plan.

**Evidence:** `deno check`, tests, `deno lint`, and a printed plan per strategy for two scripted contexts
(one ahead, one behind).

## Lane N-C — `src/game/Concealment.ts` (new) + `src/game/Perception.ts` (new) + tests

Authoritative invisibility and what the other seat can know.

```ts
export interface Concealment { active: boolean; startedAtS: number; revealOnAttack: boolean; breakBelowM: number }
export function beginConcealment(o: { atS: number; breakBelowM?: number }): Concealment;
export function breakConcealment(c: Concealment, why: "attack" | "damage" | "expired" | "proximity", atS: number): Concealment;

/** What seat `viewer` believes about seat `other` this instant — never the other's true position while concealed. */
export interface Belief { lastKnown: XY | null; ageS: number; probableStrategy: StrategyId; confidence01: number; knowsPosition: boolean }
export function perceive(o: { viewer: XY; other: XY; otherConcealed: boolean; lastKnown: XY | null; sinceLastSeenS: number; memoryS: number }): Belief;
```

Requirements: the belief must be a LIE when it should be — while the other is concealed, the returned
position is the last known one and `knowsPosition` is false (a test must assert the true position is absent
from the belief); the belief decays with age and re-acquires on reveal; the AI's read of "he vanished, that is
probably a strategy" is the `probableStrategy` + `confidence01` pair (use Wave M's vocabulary if it has
landed, otherwise N-B's ids).

**Evidence:** `deno check`, tests, `deno lint`, and a printed belief series across a concealment window.

## Lane N-D — `src/game/Cast.ts` (new) + `src/ui/CastBar.ts` (new) + tests

```ts
export const CAST_MIN_S = 0.35, CAST_MAX_S = 3.2;
export interface CastSpec { skillId: string; seconds: number; interruptible: boolean; breakOnMove: boolean }
export function castSeconds(o: { base: number; willpower: number; hastePct: number; element: string; heavy: boolean }): number;
export interface CastState { spec: CastSpec; elapsedS: number; pushbackS: number; done: boolean; interruptedBy: string | null }
export function tickCast(s: CastState, dt: number): CastState;
/** Being hit delays a cast: the pushback is a bounded function of the hit's own variables. */
export function pushbackSeconds(o: { damageFracOfMax: number; angleDeg: number; stamina: number; heavy: boolean }): number;
export function interrupt(s: CastState, why: string): CastState;
export interface CastBarView { label: string; fraction: number; pushbackFraction: number; state: "cast" | "interrupted" | "done" }
export function castBarView(s: CastState): CastBarView;      // pure, DOM-free
```

Requirements: `castSeconds` is monotone in the power's `base`, falls with willpower and haste, and stays
inside `[CAST_MIN_S, CAST_MAX_S]`; `pushbackSeconds` is monotone in `damageFracOfMax` and in how front-on the
hit was (a hit from behind pushes back more), bounded, and never pushes a cast past its own cap (state the
rule in a comment with units); an interrupt ends the cast at once and says who did it; the bar view is total
(elapsed 0, elapsed > seconds, a NaN dt must be refused). The bar itself is a DOM layer written CSSOM-only,
following `src/ui/FighterPanel.ts`'s house style, with no inline style attribute.

**Evidence:** `deno check`, tests, `deno lint`, and a printed table of cast seconds × pushback for the
scripted cases, plus the bar's class names for the parent to photograph.

## Lane N-E — `src/game/AutoAttack.ts` (new) + `src/ui/CombatText.ts` (new) + tests

```ts
export interface AutoAttack { nextAtS: number; intervalS: number; lastTargetId: string | null }
export function autoAttackDue(a: AutoAttack, o: { atS: number; distanceM: number; reachM: number; stunned: boolean; casting: boolean }): boolean;
export function advanceAutoAttack(a: AutoAttack, o: { atS: number; intervalS: number }): AutoAttack;

/** The floating number's STYLE, a pure function of the combat statistics. */
export interface HitStyle { sizePx: number; weight: number; hue: number; lightness: number; riseMs: number; lifeMs: number; glyph: "crit" | "hit" | "absorbed" | "resisted" | "miss" | "immune" }
export function hitStyle(o: { damage: number; maxHealth: number; crit: boolean; absorbedFrac: number; element: string; weaponHeavy: boolean; attackerHastePct: number }): HitStyle;
export function formatHit(n: number): string;      // thousands-grouped, matching the repo's "47 100"
```

Requirements: `hitStyle` must be monotone in the hit's size (bigger hit = bigger, brighter, bolder, faster
rise) and must separate crit from normal, absorbed, resisted, miss and immune without relying on colour alone
(boldness/size/glyph carry the meaning too — a colour-blind reader must still tell them apart); hues come from
the element; every field bounded and finite; `autoAttackDue` refuses while stunned or casting and honours the
interval exactly (an interval that has not elapsed is not due).

**Evidence:** `deno check`, tests, `deno lint`, a printed style table across the hit range, and the DOM
writer's class names for the parent.

---

## Parent (only these files)

`src/engine/Engine.ts` (the pilot, the strategy, the concealment/perception, the cast system and its bar, the
autoattack, the floating text pool and the cue), `src/ui/Menu.ts` + `styles.css` (the cast bar and combat-text
styles, the Spectate screen's batch button from Wave M), `src/audio/AudioManager.ts` (the vanish / cast-start /
interrupt cues), `tools/probe-wave-n.ts` (new: a real match per claim, plus a 100-match headless timeout
measurement), `docs/SPEC.md` §11F, `docs/powers/REPORT.md`, `artifacts/powers/VERIFICATION.md`,
`artifacts/data-science.md` (new pass), the commit.

## Acceptance

1. The timeout rate and the mean time-to-first-contact are MEASURED before/after on the same seed, and the
   measurement is the AI's own (the pilot's stuck detector and re-plan cadence are named numbers).
2. Kiting, hiding and stalling exist as strategies with stated parameters, and a seat can deliberately push
   the clock — with a switch so it cannot stall forever while losing.
3. Invisibility is authoritative in the simulation, the opponent's belief provably lacks the true position,
   the AI infers a probable strategy, the model is hidden for the viewer and a cue plays.
4. Casts have a duration derived from the power and the caster's statistics, a cast bar, interruptible casts,
   and a pushback that grows with the hit's own variables.
5. Autoattack swings on the interval when in reach, and every landed number pops out of the victim styled by
   the combat statistics.
6. `deno task check` 0 errors · `deno task test` green · `deno lint` clean · `deno task build` ·
   `deno run -A tools/probe-wave-n.ts` with 0 page errors and the printed numbers.
