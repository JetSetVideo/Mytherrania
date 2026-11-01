# COST-A — the case that powers must be EXPENSIVE and IMPACTFUL

**Lane S-C of Wave S.** Mandate (BRIEF §"Lanes S-C and S-D"): argue that combat powers must be
**expensive and impactful** — long casts, high mana, long cooldowns, **few casts per fight**, each cast
**decisive** — and that *doing an action is already some cost*, so even a plain swing must pay.

The opponent brief (`docs/systems/COST-B.md`, lane S-D) argues the opposite (cheap, frequent, a fight won
by rhythm and combos). I have not read it and will not. The parent reconciles.

House rule this document obeys: **a claim without a tool's literal output is not evidence.** Everything
below is a number I ran. Where the numbers contradict the mandate, I say so (§5).

---

## 1. The instruments I measured (all headless, no browser)

| file:line | constant | value |
|---|---|---|
| `src/balance/MatchSim.ts:64` | `AI_MOVE_SPEED` | `4.2` m/s |
| `src/balance/MatchSim.ts:69-73` | `SKILL_RESOURCE_COST` | `dash {mana 0, stamina 12}` · `power {mana 20, stamina 8}` · `defense {mana 5, stamina 12}` |
| `src/balance/MatchSim.ts:75` | `BLOCK_SECONDS` | `0.4` s |
| `src/balance/MatchSim.ts:83` | `WINDUP_SHARE` | `0.4` (windup = clamp(0.4·cooldown, 0.15–0.50) s, `MatchSim.ts:260`) |
| `src/engine/Engine.ts:254-258` | `SKILL_RESOURCE_COST` | `dash {0, 12}` · `power {24, 8}` · `defense {6, 12}` — the engine's copy is 20 % dearer on mana than the simulator's ("a caster cannot chain a power skill indefinitely", `Engine.ts:251-253`) |
| `src/engine/Engine.ts:324` | `AI_MOVE_SPEED` | `4.2` m/s |

The two cost tables are **already out of sync** (power 20 vs 24, defense 5 vs 6): the single-sourcing the
BRIEF hands to lane S-A is not cosmetic — the *cheaper* copy is the one the balance instrument measures.

Current roster (`src/game/Skills.ts`): **8 classes × 3 skills = 24 skills** (`dash`/`power`/`defense`),
cooldowns in the range **3.5 s – 11 s**, animation (cast) durations in the range **0.38 s – 1.15 s**.
Mana regen is **1.2/s base** × flow × f(willpower) × gear (`src/game/Resources.ts:52`), so one `power`
at 20 mana is **≈17 s of regen**; the wave-J note in `Resources.ts:40-42` already calls this "~17 s of
regen" per power and a "20-mana power every 6.7 s" at the *old* 3/s rate.

**Cast cost today is a pay-once mana tick plus an animation lock; the real frequency gate is the
`cooldown`.** Nothing in the sim charges for a swing except an attack-interval timer.

---

## 2. The repo's own cost-of-combat instrument: the evolution ladder

```
$ deno run -A tools/evolution-ladder.ts 6 4 10 3
LADDER  steps=6 cases=4 matches/case=10 keep=3 seed=20261031
criteria: decisiveness (w 0.35) · engagement (w 0.3) · closeness (w 0.2) · mix (w 0.15)

step case  design     seed        decis  engage  close  mix   score  kept
0    all       160458887   0.90   0.70    0.60   1.00  0.7950
0    all       1133862057  1.00   0.80    0.80   0.67  0.8500   *
0    corner    2917042930  1.00   0.80    0.80   0.67  0.8500   *
0    extreme   3525807456  0.90   0.70    1.00   1.00  0.8750   *
     -> step 0: 3 kept · type not yet · leading cluster cell 2 · ringout (1/3 agree)
1    grid      683286823   0.80   0.90    0.70   1.00  0.8400   *
1    invariant 3317668584  1.00   0.70    0.00   0.67  0.6600
1    extreme   3978272977  0.90   1.00    0.80   1.00  0.9250   *
1    all       564904388   0.80   0.90    1.00   1.00  0.9000   *
     -> step 1: 3 kept · type not yet · leading cluster cell 2 · ko (1/3 agree)
2    grid      3793069456  0.90   0.90    0.80   1.00  0.8950   *
2    invariant 4226171857  1.00   0.80    0.00   0.67  0.6900
2    random    1832734802  1.00   0.90    1.00   0.67  0.9200   *
2    all       3719923792  1.00   0.80    1.00   0.67  0.8900   *
     -> step 2: 3 kept · type not yet · leading cluster cell 4 · ringout (1/3 agree)
3    invariant 3489761987  1.00   0.60    0.00   0.67  0.6300
3    extreme   2566325875  0.90   0.90    1.00   1.00  0.9350   *
3    corner    1153457144  1.00   0.70    0.80   0.67  0.8200   *
3    extreme   1395147523  0.90   1.00    0.80   0.67  0.8750   *
     -> step 3: 3 kept · type cell 2 · ko · leading cluster cell 2 · ko (2/3 agree)
4    grid      1641908738  0.70   0.90    0.30   1.00  0.7250
4    corner    363268560   1.00   0.90    0.80   0.67  0.8800   *
4    extreme   993287460   1.00   0.80    0.20   0.67  0.7300   *
4    all       3663764074  0.80   0.90    0.60   1.00  0.8200   *
     -> step 4: 3 kept · type not yet · leading cluster cell 1 · ringout (1/3 agree)
5    extreme   621757774   1.00   1.00    0.80   0.67  0.9100   *
5    all       2479406860  0.80   1.00    1.00   1.00  0.9300   *
5    grid      992941298   0.60   0.90    0.60   1.00  0.7500
5    all       3204871247   0.80   0.70    0.60   1.00  0.7600   *
     -> step 5: 3 kept · type cell 0 · ringout · leading cluster cell 0 · ringout (2/3 agree)
pruned cells (never a type of game): 5=invariant
first AGREED archetype: step 3 cell 2 · ko
leading cluster per step: cell 2 · ringout (1/3 agree) | cell 2 · ko (1/3 agree) | cell 4 · ringout (1/3 agree) | cell 2 · ko (2/3 agree) | cell 1 · ringout (1/3 agree) | cell 0 · ringout (2/3 agree)
wall 1096 ms
```

**What the repo's own instrument says — and it favours me on *decisiveness*, not on *timeouts*.**

- **Decisiveness is high already (0.60–1.00), and it is bought by the KO.** The first *agreed* archetype
  is at **step 3, "cell 2 · ko"** — i.e. the ladder's own search says the game that survives is a
  **KO** game (a decisive blow), not a ring-out push-off. The leading cluster oscillates ringout/ko, and
  the eventual type is a KO. My mandate is *decisive casts*; the instrument names KO as the winning type.
- **The `invariant` cell is pruned** ("never a type of game", `5=invariant`): the strong-vs-weak sweep
  produces fights that are *not games*. Raw power gaps are not what the ladder rewards — a fact relevant
  to "one shot that decides": a one-shot must be earned by the cast, not by a stat differential.
- **`mix` and `closeness` are the volatile criteria.** `closeness` hits **0.00** on every `invariant`
  row (step 1, 2, 3: `close 0.00`) — lopsided fights, discarded. `mix = 1.00` appears whenever the
  three endings (ko/ringout/time) are all present.

---

## 3. A batch I ran — durations, endings, damage, timeout share

Throwaway script `tmp/cost-a-batch.ts` (does not touch `src/**`): it reproduces `runBatch`'s body, runs
each match with a `trace` to count skill casts, and summarises with the repo's `summarize()`.

```
$ deno run -A tmp/cost-a-batch.ts
=== design=random seed=777001 n=100 ===
end reasons: ringout 64 · ko 29 · time 7   (timeout share 7.0%)
duration median 63.4s  mean 72.4s  min 6.5 max 186.0
winA mean 0.480  ko share 0.290  ringout share 0.640
damage/match mean 32608.6  swings/match mean 97.7
SKILL casts 1536 => 15.36/match (median 3.5); 0-cast matches 45/100
skill hits 979 (9.79/match)  skill damage 867082 = 26.6% of all damage

=== design=random (both FULL strategy) seed=777001 n=100 ===
end reasons: ringout 80 · ko 17 · time 3   (timeout share 3.0%)
duration median 53.8s  mean 59.3s  min 6.6 max 186.0
winA mean 0.475  ko share 0.170  ringout share 0.800
damage/match mean 35189.9  swings/match mean 86.3
SKILL casts 3428 => 34.28/match (median 32); 0-cast matches 0/100
skill hits 2071 (20.71/match)  skill damage 2148349 = 61.1% of all damage

=== design=extreme seed=777002 n=100 ===
end reasons: ko 72 · ringout 26 · time 2   (timeout share 2.0%)
duration median 61.1s  mean 66.0s  min 6.4 max 186.0
winA mean 0.450  ko share 0.720  ringout share 0.260
damage/match mean 38283.8  swings/match mean 104.7
SKILL casts 1750 => 17.50/match (median 11); 0-cast matches 23/100
skill hits 1041 (10.41/match)  skill damage 1117175 = 29.2% of all damage

=== design=corner seed=777003 n=100 ===
end reasons: ringout 33 · ko 67   (timeout share 0.0%)
duration median 20.5s  mean 42.9s  min 6.4 max 166.8
winA mean 0.460  ko share 0.670  ringout share 0.330
damage/match mean 29974.0  swings/match mean 65.9
SKILL casts 926 => 9.26/match (median 3); 0-cast matches 25/100
skill hits 598 (5.98/match)  skill damage 1222632 = 40.8% of all damage
```

And a second pass (`tmp/cost-a-batch.ts`, split by cast count, n=200 per cell):

```
=== random (n=200) ===
ALL: median 58.9s  ending ringout 67% ko 26% time 7%
0 casts    n= 99  median 73.3s  ending ringout 64% ko 24% time 12%
1-8 casts  n= 28  median 10.7s  ending ringout 100%
>8 casts   n= 73  median 66.7s  ending ringout 59% ko 38% time 3%

=== extreme (n=200) ===
ALL: median 53.4s  ending ko 69% ringout 30% time 2%
0 casts    n= 49  median 60.8s  ending ko 73% ringout 27%
1-8 casts  n= 49  median 7.9s  ending ringout 76% ko 24%
>8 casts   n=102  median 71.2s  ending ringout 10% ko 87% time 3%

=== corner (n=200) ===
ALL: median 20.8s  ending ringout 31% ko 69% time 1%
0 casts    n= 51  median 107.9s  ending ringout 27% ko 71% time 2%
1-8 casts  n= 94  median 11.9s  ending ringout 41% ko 59%
>8 casts   n= 55  median 47.9s  ending ko 85% ringout 15%
```

**The evidence that supports an expensive, impactful cost:**

1. **The action economy is dominated by cheap auto-attacks, not by powers.**
   `swings/match` is **97.7** (random), **104.7** (extreme), **65.9** (corner) against **9–17 skill
   casts/match**. That is a **~6:1 ratio of free attack-interval swings to paid casts.** "Doing an action
   is already some cost" is *measurably false today for a swing* — the swing pays nothing but a timer, and
   it is the action that fills the match. The mandate's answer is exactly this number: charge the swing.

2. **Fights are long and are decided by a SHOVE, not by a blow.** Median duration **58.9 s** (random) and
   **53.4 s** (extreme) against a **180 s** limit (`MATCH_TIME_LIMIT_S`, `MatchControl.ts:95`), and the ending is
   **ringout 67 %** (random) / **30 %** (extreme) / **31 %** (corner). The single most common way a fight
   ends is *pushing the opponent off the edge* — the shape of the arena, not a decisive cast. A fight that
   can only be reliably ended by the terrain is a fight no single power decided.

3. **Where powers fire, they already carry the damage — the plain swings are filler.** `skill damage` is
   **26.6 %** of all damage at low cast rates but **61.1 %** of all damage when both fighters run the full
   brain (34 casts/match). The cheap auto-attacks contribute the other ~40 % *by volume of actions* while
   the powers, though few, contribute the HP. Powers are already the impactful half; they are simply not
   gated to be rare.

4. **Zero-power fights are the grinding fights.** In the `corner` cell the 0-cast matches (both fighters
   drew the "none" brain, so no powers at all) have a **median of 107.9 s** — the longest bucket in any
   cell — and in `random` they time out **12 %** of the time. The matches that fight with *no powers* are
   the ones that drag and bell. The matches with a full brain (many casts) end in **KO 85 %** (corner
   `>8 casts`) — decisive.

---

## 4. What the numbers say the binding constraint *is not*

The mandate says "high mana". The instrument disagrees that **mana** is the gate: with the full brain the
sim cast **34 skills/match** (median 32) — including `power` at 20 mana — which a 1.2/s regen pool cannot
fund gram-for-gram, so the casts are riding the cheap `dash` (stamina) and free `defense` ticks and the
cooldown, not the mana price. Raising *mana* alone would not reduce casts; **raising the cooldown and the
cast lock would.** So the expensive cost must bite through **cooldown + cast time**, with mana as the
secondary gate that makes the heavy shapes, not the light ones, rationed.

---

## 5. Where the numbers CONTRADICT my brief — declared, as required

An argument that hides a contradicting measurement is not evidence. Two of mine cut against me:

- **Forcing both fighters to the cast-rich "full" brain SHORTENED fights (63.4 → 53.8 s median) and CUT
  timeouts (7 % → 3 %), but it also LOWERED the KO share (0.290 → 0.170) and RAISED ringout (0.64 →
  0.80).** More casting, in that run, made fights end *faster but by shove-off*, not by the decisive KO I
  want. The honest reading: raw cast *frequency* is not the lever I claimed — *decisiveness per cast* is.
- **The bucket split is NOT monotone in cast count.** In `extreme`, the `>8 casts` bucket has a *longer*
  median (71.2 s) than the `0 casts` bucket (60.8 s). So "more casts → shorter fight" is false in that
  cell, and the `1-8 casts` bucket is contaminated by fast ring-outs (a match that ends in 8 s cannot
  accrue casts — the causation runs backwards).

**And a structural limit on all of the above:** in the simulator, skill usage is bound to the same
`strategy` knob that also controls the movement/edge brain (`MatchSim.ts:173`, `createRuntime(strat ===
"full" ? b.skills : [])`). **I cannot isolate the cost variable with the existing instrument** — every
"more casting" comparison also moved flanking, edge-play and walk-off guard. My §3 comparisons are
*correlational*; I mark them as such and do not dress them up as a controlled experiment.

So my case rests not on "cheap = slow" (disproven above) but on the two facts that *do* hold: **the action
economy is 6:1 free swings to paid casts**, and **the modal ending is a ring-out, not a KO**. An
expensive, impactful cost is the lever that converts the second into the first — fewer, decisive casts.

---

## 6. Proposed cost table (EXPENSIVE + IMPACTFUL)

Per shape. "cast s" is the animation/cast lock (= the new `castSecondsOf`), "mana" the pool cost, "cd s"
the cooldown. Target: **3–6 casts per fighter per fight**, each cast a decisive event.

| shape | mana | cooldown s | cast s | rationale (measured against §3) |
|---|---|---|---|---|
| **instant** | 30 | 8 | 0.45 | the cheapest shape, but still ~25 s of base regen; short lock so it is the "poking" cast |
| **projectile** | 45 | 12 | 0.9 | ranged, so it reaches without a swing; priced above instant to cover the reach it buys |
| **cone** | 50 | 14 | 1.2 | hits multiple/one at reach; the anti-swing clear-out |
| **aura** | 40 | 16 | 1.5 | persistent effect; long lock, long cooldown — a commitment, not a rotation tick |
| **self-buff** | 35 | 20 | 1.8 | the longest cooldown; a stance you hold, so it must be scarce and earned |

Everything here is above the current table's `power` (20 mana) and well above the current cooldowns
(3.5–11 s) and cast locks (0.38–1.15 s). Combined with the **per-swing stamina cost** the brief demands
("doing an action is already some cost"), the ~86–104 free swings/match must shrink or pay.

**The ONE number I predict this moves, and its direction:** the **KO share** (`ko.mean`) in a mixed
`random`-cell batch — currently **0.290** (`deno run -A tmp/cost-a-batch.ts`, seed 777001, n=100) —
predicted **UP**, because expensive-but-decisive casts replace the 97.7 free swings that today end in a
ring-out push (`ringout share 0.640`) with a small number of casts that end the fight outright. Secondary,
same run: median duration **down** from **63.4 s**. *This is a prediction, not a measurement;* the
instrument cannot yet isolate the cost variable (§5), so it must be verified by a lane that can edit
`src/**` and re-run `deno run -A tools/evolution-ladder.ts` plus the batch above.

---

*Measured with:* `deno run -A tools/evolution-ladder.ts 6 4 10 3` · `deno run -A tmp/cost-a-batch.ts`
(script under `tmp/`, no `src/**` touched) · `grep -n` on `src/balance/MatchSim.ts`, `src/engine/Engine.ts`,
`src/game/Skills.ts`, `src/game/Resources.ts`, `src/game/MatchControl.ts`.
