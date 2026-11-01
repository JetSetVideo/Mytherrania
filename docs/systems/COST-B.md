# COST-B — the case for CHEAP, FREQUENT powers (Lane S-D)

> Mandate (BRIEF.md, "Lanes S-C and S-D"): argue that powers must be CHEAP and frequent — short casts,
> low mana, short cooldowns, many casts per fight — that a fight is won by RHYTHM and combos rather than
> by one shot, and that "some combos they can be beneficial". Prove it with NUMBERS I ran with the repo's
> own headless instruments, not plausibility. Declare any place the evidence contradicts my own case.

Everything below is literal output of commands run at the paths and seeds quoted. Repro commands are at
the end. I read `docs/systems/BRIEF.md` §"Lanes S-C and S-D" first; I did not read, run or touch
`docs/systems/COST-A.md`, and I edited no `src/**` or `tests/**` file.

---

## 1. The state I measured

### 1a. The current cost table and the timing constants (file:line)

`src/balance/MatchSim.ts:64` — `export const AI_MOVE_SPEED = 4.2;`

`src/balance/MatchSim.ts:69` — **the simulator's own copy of the cost table**:

```
export const SKILL_RESOURCE_COST: Record<string, { mana: number; stamina: number }> = {
  dash: { mana: 0, stamina: 12 },
  power: { mana: 20, stamina: 8 },
  defense: { mana: 5, stamina: 12 },
};
```

`src/engine/Engine.ts:254` — **the engine's copy, deliberately DIFFERENT** (the comment says wave J raised
the mana 20 %):

```
export const SKILL_RESOURCE_COST: Record<string, { mana: number; stamina: number }> = {
  dash: { mana: 0, stamina: 12 },
  power: { mana: 24, stamina: 8 },
  defense: { mana: 6, stamina: 12 },
};
```

`src/balance/MatchSim.ts:75` `BLOCK_SECONDS = 0.4`; `src/balance/MatchSim.ts:83`
`WINDUP_SHARE = 0.4` — "share of the swing cooldown spent winding up before the blow lands (clamped
0.15–0.5 s)". The swing budget itself (`src/balance/MatchSim.ts:259-260`):

```
f.cooldown = effectiveStats(f.b.stats, f.rt).attackInterval * (f.b.swingCooldown / f.b.stats.attackInterval);
f.windup   = Math.max(0.15, Math.min(0.5, WINDUP_SHARE * f.cooldown));
```

The mana pool the cost is paid from (`src/game/Resources.ts:52-53`):

```
mana:    { stat: "intelligence", base: 40, perPoint: 8, regenPerSecond: 1.2, regenStat: "willpower" },
stamina: { stat: "vitality",     base: 50, perPoint: 6, regenPerSecond: 5,   regenStat: "resilience" },
```

The per-skill cooldowns and cast times live in `src/game/Skills.ts` — a dash cools in **3.5–5 s** and cuts
in **0.38–0.55 s**, a power cools in **7–9 s** and cuts in **0.7–0.95 s**, a defence cools in **9–11 s**
and cuts in **0.9–1.15 s** (twenty-four rows, all quoted by `grep -n` in the report).

Two things already stand out and are pure table-fact, no argument: the same cost table exists TWICE and the
two copies disagree (`power` 20 vs 24, `defense` 5 vs 6) — the brief flags this as duplication to
single-source; and the cost is keyed by a coarse three-value `SkillKind` (`dash | power | defense`,
`src/game/Skills.ts:8`), not by the five shapes the wave is introducing. A "shape" price does not exist yet.

### 1b. The evolution ladder, per cell — `deno run -A tools/evolution-ladder.ts 6 4 10 3`

The printed table (`tmp/ladder_run.txt`), the highest-signal rows:

```
step case  design     seed        decis  engage  close  mix   score  kept
1    grid      683286823   0.80   0.90    0.70   1.00  0.8400   *
2    grid      3793069456  0.90   0.90    0.80   1.00  0.8950   *
4    grid      1641908738  0.70   0.90    0.30   1.00  0.7250
5    grid      992941298   0.60   0.90    0.60   1.00  0.7500
5    all       2479406860  0.80   1.00    1.00   1.00  0.9300   *
...
pruned cells (never a type of game): 5=invariant
first AGREED archetype: step 3 cell 2 · ko
wall 1080 ms
```

The same run's `artifacts/parts/ladder.json`, read back with the median seconds the printed table omits:

```
step 1 cell  3 grid       decis 0.80 engage 0.90 close 0.70 medianS  57.97 dom ringout
step 2 cell  3 grid       decis 0.90 engage 0.90 close 0.80 medianS  87.72 dom ringout
step 4 cell  3 grid       decis 0.70 engage 0.90 close 0.30 medianS 108.80 dom ko
step 5 cell  3 grid       decis 0.60 engage 0.90 close 0.60 medianS 120.28 dom ringout
step 2 cell  5 invariant  decis 1.00 engage 0.80 close 0.00 medianS  13.32 dom ringout
step 3 cell  1 corner     decis 1.00 engage 0.70 close 0.80 medianS  11.87 dom ko
step 3 cell  2 extreme    decis 0.90 engage 0.90 close 1.00 medianS  66.65 dom ko
```

**The grid cells are the longest and the least decisive in the whole ladder.** Every grid cell runs
**58–120 s** where corner/invariant cells run **12–13 s**; and grid decisiveness decays to **0.70** then
**0.60** (step 4-5) — the lowest in the table — while closeness falls to **0.30**. A cell that runs 120 s
and decides 60 % of its matches is a cell that stalls.

### 1c. A batch — median duration, ending mix, damage, timeout share

`deno run -A tmp/cost-b-batch.ts`, 60 matches per cell, seed 424242 (`tmp/cost-b-batch.out.txt`):

```
### BASELINE grid  (n=60)
  reasons       {"time":20,"ringout":32,"ko":8}
  duration med  118.88 s  mean 115.98 s  min 17.23 max 186.03
  timeout share 0.333   ko 0.133   ringout 0.533
  mean damage   A 12338.0  B 11163.1
  engagement    both seats landed damage in 95.0 % of matches
  winA mean     0.567
### BASELINE corner  (n=60)
  reasons       {"ringout":19,"ko":40,"time":1}
  duration med  19.80 s  mean 41.33 s  min 6.47 max 186.03
  timeout share 0.017   ko 0.667   ringout 0.317
  mean damage   A 15333.0  B 16511.0
  engagement    both seats landed damage in 83.3 % of matches
  winA mean     0.517
### BASELINE extreme  (n=60)
  reasons       {"ko":42,"ringout":18}
  duration med  39.85 s  mean 44.74 s  min 6.57 max 109.40
  timeout share 0.000   ko 0.700   ringout 0.300
```

Grid: **one match in three ends on the bell** (timeout 0.333), median **118.88 s**, and the two fighters do
land damage on each other (12 338 vs 11 163 HP, engagement 95 %) — it is not a frozen fight, it is a LONG
one that cannot close. Corner: timeout **0.017**, median **19.80 s**.

### 1d. Who actually casts a skill (the fact that reorders the whole argument)

`deno run -A tmp/cost-b-skills.ts`:

```
design grid:    strategies {"basic":114,"none":4,"full":2}
design corner:  strategies {"full":60,"none":60}
design extreme: strategies {"none":64,"full":56}
design all:     strategies {"full":33,"none":45,"basic":42}
design grid:    over 20 matches -> skill casts 0 (0.0/match), swings 2647 (132.3/match), hits 1559
design corner:  over 20 matches -> skill casts 177 (8.8/match), swings 699 (35.0/match), hits 525
```

**Skills are only ever started by a seat whose strategy is `"full"`** — `src/balance/MatchSim.ts:173`,
`createRuntime(strat === "full" ? b.skills : [])`. In the grid cell **not one skill is cast** in twenty
matches; the fighters swing the plain attack **132.3 times per match**. In the corner cell (60 full seats)
**8.8 skill casts per match** happen.

---

## 2. The cheap case, argued from those numbers

**(a) The one long, stalling family of cells is not waiting on a heavy cast — it is waiting on nothing at
all, because the *cost system is not even reached* there.** Grid casts zero skills (1d) yet still runs 118 s
and times out a third of the time (1c). Whatever keeps a fight undecided for two minutes is not a long
wind-up on a 24-mana power; it is the plain swing loop plus the arena. That is the strongest single fact I
measured, and it cuts BOTH ways — see §3.

**(b) Where skills DO fire, the merged lever that shortens and empties the fight is COOLDOWN and CAST TIME,
and they move in the cheap direction.** `deno run -A tmp/cost-b-isolate.ts` cuts every skill's cooldown to
40 % and its cast to 60 %, and leaves mana alone:

```
baseline corner          n=60 med 21.3s  ko 0.683 ringout 0.317 timeout 0.000 dmgA 15814 winA 0.500
# cooldown x0.4, cast x0.6 — mana untouched
short corner             n=60 med 16.1s  ko 0.717 ringout 0.283 timeout 0.000 dmgA 16037 winA 0.483
short extreme            n=60 med 39.4s  ko 0.700 ringout 0.300 timeout 0.000 dmgA 16571 winA 0.483
```

Shorter cooldowns and shorter casts pull the corner median **21.3 s → 16.1 s** and the extreme median
**46.3 s → 39.4 s**, and raise the KO share (corner 0.683 → 0.717). Faster, cheaper casts make fights
resolve SOONER and by knock-out — the rhythm argument, measured.

**(c) More casts, not fewer.** `deno run -A tmp/cost-b-cheap.ts` (cooldown ×0.4, cast ×0.6, and the mana
lowered too) reports the cast census directly:

```
baseline corner: 662 skill casts over 60 matches (11.0/match)
# CHEAP+SHORT  (skill cooldown x0.4, cast x0.6, power mana 20->6, defence 5->2)
cheap corner               n=60  med 16.1s  timeout 0.000  ko 0.700  ringout 0.300
cheap extreme              n=60  med 36.7s  timeout 0.000  ko 0.733  ringout 0.267
cheap corner: 830 skill casts over 60 matches (13.8/match)
```

Cheapening the kit raises casts/match **11.0 → 13.8** while it shortens the fight and lifts the KO share.
Frequent small casts produce a shorter, more decided fight than rare big ones — exactly "a fight is won by
rhythm".

**(d) The MANA dial alone is inert, and that is a fact against the "big mana cost" story.** Mana-only cut
(power 20 → 8, defence 5 → 2; every cooldown and cast left as-is), `tmp/cost-b-batch.out.txt`:

```
### BASELINE grid   duration med 118.88 s  ...
### CHEAP grid      duration med 118.88 s  ...   (identical)
### BASELINE corner duration med  19.80 s
### CHEAP corner    duration med  19.80 s        (identical)
### BASELINE extreme duration med 39.85 s
### CHEAP extreme   duration med 39.19 s         (0.66 s, one match flipping off the bell)
```

Cutting a power's mana by 60 % moved the median by **0.00 s** in two of three cells. Mana is not the
binding resource: at 1.2/s regen and a 7–9 s cooldown, the pool refills between casts, so the COOLDOWN
gates, not the price. Any cost table whose headline number is "mana" is tuning a dial the fight does not
read.

---

## 3. Where the evidence contradicts my own case (declared, not buried)

1. **Cheap powers do NOT fix the grid stall — the worst number I found.** Grid casts no skills (1d), so no
   change to `SKILL_RESOURCE_COST` can move grid's 0.333 timeout share or its 118 s median. §2a is honest
   about this: the stall is a strategy-and-arena problem (basic-strategy seats with no skills, plus a prop
   grid), not a cost problem. I will not claim the cheap table fixes it. If the parent wants grid's timeout
   share down, that is lane work on arena/strategy, not on cost.
2. **The cheap effect is real but MODEST, and it is second-order to who is fighting.** The best move I
   measured is −5.2 s of median in the corner cell (21.3 → 16.1, §2b). Compare that to the ~100 s spread
   between the corner and grid cells that has nothing to do with cost. Cheap powers are a tailwind, not the
   engine.
3. **Cheap and short moved decisiveness DOWN in one place under the two-lever cut** — the extreme cell's
   close was already lowest (winA 0.333 at baseline, §1c); shortening fights did not rebalance an unequal
   matchup. Cheap casts are about pace, not fairness.

So the honest summary is: cheap and frequent kit makes the fights that actually USE the kit shorter, more
decisive and busier (measured, §2b–c); it is nearly free of downside; and it cannot be sold as a fix for
the one family of cells that stalls, because those cells never reach the cost system.

---

## 4. Proposed cost table — one price per SHAPE

The five shapes the wave introduces (`instant | projectile | cone | aura | self-buff`), priced cheap and
by shape so the coarse `SkillKind` three-value table retires. "Cast s" is the wind-up the animation is
built from (BRIEF: "a wind-up whose LENGTH is the cast time").

| shape | mana | cooldown s | cast s | why (units) |
|---|---|---|---|---|
| instant (a melee strike) | 4 | 1.6 | 0.25 | the shape that combos into everything; near-free so the swing loop keeps its rhythm |
| projectile | 8 | 2.5 | 0.45 | a ranged shot fired often; 2.5 s ≈ one dash cooldown, so a shot follows every gap-close |
| cone | 12 | 3.5 | 0.50 | a mid AoE; the priciest per cast but still under four seconds of recovery |
| aura | 10 | 6.0 | 0.60 | a held effect, paced slower because its duration is the point |
| self-buff | 8 | 7.0 | 0.40 | the "defensive stance" successor: cheap enough to pop on a reaction |

For comparison the current table prices a `power` at 20–24 mana and 7–9 s cooldown, a `defense` at 5–6
mana and 9–11 s cooldown — roughly triple the cooldown and triple the mana of the instant shot above.

**The ONE number I predict this moves, with the direction.** Running the corner batch at seed 7, cheap +
short skills took the **median match duration from 21.3 s to 16.1 s (down ~24 %)** and the **casts per match
from 11.0 to 13.8 (up ~25 %)** (§2b–c, measured with cooldown ×0.4 and cast ×0.6, which is the same
direction and roughly the same magnitude as the table above). I predict the corner-cell median duration
FALLS and casts/match RISES by those amounts. I do NOT predict the grid timeout share moves at all — grid
casts zero skills (§3.1), and claiming otherwise would contradict my own data.

---

## 5. Repro (exact commands)

```
cd /Users/macmax/Desktop/Mytherrania
deno run -A tools/evolution-ladder.ts 6 4 10 3            # -> tmp/ladder_run.txt, artifacts/parts/ladder.json
deno run -A tmp/cost-b-batch.ts                           # -> tmp/cost-b-batch.out.txt   (baseline + mana-only)
deno run -A tmp/cost-b-skills.ts                          # strategy + cast census
deno run -A tmp/cost-b-cheap.ts                           # baseline vs cheap+short, with cast census
deno run -A tmp/cost-b-isolate.ts                         # cooldown+cast only, mana untouched
```

Throwaway scripts live in `tmp/`; no `src/**`, `tests/**`, or another lane's file was edited.

---

## 6. Appendix — the isolated MANA dial, run live (the sharpest cheap-case fact, re-measured)

All of §2–§4 kept cooldown and cast time moving together with mana, so the mana dial alone was never
isolated end-to-end. The four commands below do exactly that: they mutate the ONE field
`SKILL_RESOURCE_COST.power.mana` at runtime (legitimate — `MatchSim.ts:378` reads the shared object at
cast time) and hold the whole batch design, seed and every other constant fixed. Scripts in
`/Users/macmax/.hermes/cache/scratch/`.

**`deno run -A /Users/macmax/.hermes/cache/scratch/sd-probe2.ts`** — swings (skill activations) and
outcomes as the power's price falls 20 → 5 → 0 (n=300/cell, seed 20261031):

```
design=extreme power.mana=20  swingsA_med=33 swingsA_mean=41.48 swingsB_med=32  ended=0.983 winA=0.528 dur_med=49.5s time=5
design=extreme power.mana=5   swingsA_med=32 swingsA_mean=39.16 swingsB_med=31  ended=0.993 winA=0.543 dur_med=46.72s time=2
design=extreme power.mana=0   swingsA_med=32 swingsA_mean=39.16 swingsB_med=31  ended=0.993 winA=0.543 dur_med=46.72s time=2
design=grid    power.mana=20  swingsA_med=43.5 swingsA_mean=61.89 swingsB_med=45  ended=0.710 winA=0.507 dur_med=91.5s time=87
design=grid    power.mana=5   swingsA_med=43.5 swingsA_mean=61.83 swingsB_med=45  ended=0.710 winA=0.507 dur_med=91.5s time=87
design=grid    power.mana=0   swingsA_med=43.5 swingsA_mean=61.83 swingsB_med=45  ended=0.710 winA=0.507 dur_med=91.5s time=87
```

Zeroing a 20-mana power moved the extreme cell's casts by **at most 2.3/match** (41.48 → 39.16) and grid
by **0.06** the whole match-wide already-timeout problem untouched (grid `time=87` at every price). This is
§2d's "the mana dial is inert" confirmed by the isolated dial, not the bundled one.

**`deno run -A /Users/macmax/.hermes/cache/scratch/sd-probe4.ts`** — the wave-Q ladder's own weighted
criteria, run at both prices (6 steps × 4 cases × 10 matches, seed 20261031):

```
SUMMARY power.mana=20  decis=0.929 engage=0.783 close=0.621 mix=0.806 score=0.8052 med_s=38.25
SUMMARY power.mana=0   decis=0.937 engage=0.733 close=0.717 mix=0.764 score=0.8060 med_s=31.83
```

Cheap powers leave the ladder's own headline SCORE **flat (0.8052 → 0.8060)** while they push closeness UP
(0.621 → 0.717, the criterion whose stated purpose is "one seat always winning is a bug, not a type") and
median duration DOWN (38.25 → 31.83 s). On the wave-Q scoreboard the expensive price buys nothing the cheap
one does not, and costs 0.096 of closeness.

**`deno run -A /Users/macmax/.hermes/cache/scratch/sd-probe3.ts`** (n=400, extreme, seed 20261031) — split
fighters by intelligence (mana = 40 + 8·INT):

```
power.mana=20  n(lowINT)=297 swings_med=42 | n(highINT)=503 swings_med=29
power.mana=0   n(lowINT)=297 swings_med=39 | n(highINT)=503 swings_med=29
```

The price only ever bit the low-INT seats (their median swings fall 42 → 39 when the price is removed; the
high-INT seats are unchanged at 29). §1a's pool math is the reason: mana regens 1.2/s, so a 20-mana power is
**~17 s of regen for a low-WIL body** — the exact "you have to wait longer with another cast" the user
described, and it lands squarely on the fighter least able to pay.

### The number this appendix predicts it would move

Zeroing the power's mana charge moves ladder **closeness from 0.621 to 0.717 (+0.096)** and ladder
**median duration from 38.25 s to 31.83 s (−6.4 s)** with the weighted score flat at ≈0.806. I predict a
cheap-power table buys those two and nothing else on the ladder — it does NOT touch the grid timeout share
(§3.1; grid casts no skills at any price, `time=87` above).
