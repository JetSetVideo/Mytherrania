# Wave J-B → Engine.ts: the changes the parent must make

Lane J-B could not edit `src/engine/Engine.ts`. Everything below is a **pure function that already
exists and is tested** in a lane-owned module; the engine change is the wiring. Line numbers are
from the tree on 2026-10-31 (they drift — search for the quoted code). Each item says what it fixes
and which measurement backs it (docs/arena/lane-J-B.md).

## 1. Fighter build: race constitution in the spend window, level growth

`#applySpend` (search `#applySpend(f: Fighter, spent`) clamps health to a flat 30–60 k. A fully
spent budget hits that ceiling, so every max-VIT build reads 60 000 whatever its race — the race
health identity disappears exactly at the top. Scale the window by the race:

```ts
import { raceAffinity } from "../game/Races.ts";
import { applyLevel } from "../game/Stats.ts";
// in #applySpend, replace the maxHealth clamp:
const prof = f === this.#player ? this.#playerProfile : this.#opponentProfile;
const k = raceAffinity(prof.race, prof.subrace).health;
f.stats.maxHealth = Math.max(30 * HEALTH_SCALE * k, Math.min(60 * HEALTH_SCALE * k, f.stats.maxHealth));
```

Level growth (`Stats.applyLevel`, +3 %/level on health and attack power, level 20 = ×1.57): a level
was only a point budget, points in INT/WIL move no combat stat, and the window caps the rest, so a
level-20 mage fought like a level-1 mage. In `#startFight`, after the spend (both seats, spectate or
not — every profile has a `level`):

```ts
for (const [f, prof] of [[this.#player, player], [this.#opponent, opponent]] as const) {
  f.stats = applyLevel(f.stats, prof.level ?? 1);
  f.hp = f.stats.maxHealth;
}
```

`SPEC HX1` pins the spend window (its own computation), not this — it stays green. If the parent
wants the window pinned with the race factor, add a `SPEC` pin for `FighterBuild.clampWindow`.

## 2. Resources: pass the owner

Search `this.#resources.set(f, createResources(f.stats));` (≈ line 1494):

```ts
this.#resources.set(f, createResources(f.stats, { race: profiles[i].race, subrace: profiles[i].subrace, gear: 0 }));
```

Without the context the fighter reads as a human with no gear: the lowered mana regen (1.2 /s base,
was 3 /s flat) already applies, the race orderings do not. `gear` is 0 until Items has a gear tier.

## 3. Knockback: health-relative meter and a lower floor at 0 %

In `#resolveHit` (search `defender.damagePercent += (dmg / DAMAGE_SCALE) * 0.8;`) and in the DoT tick
(search `f.damagePercent += tick * 0.8;`):

```ts
import { KNOCKBACK_PERCENT, meterGain, WAVE_J_RULES } from "../balance/MatchRules.ts";
defender.damagePercent += meterGain(WAVE_J_RULES, dmg, defender.stats.maxHealth, DAMAGE_SCALE);
```

and in the impulse (search `* (1 + defender.damagePercent / 60)`):

```ts
... * (WAVE_J_RULES.knockbackFloor + defender.damagePercent / KNOCKBACK_PERCENT) * (pay?.knockbackMul ?? 1));
```

`Fighter.knockbackPower` (the legacy no-contact path, not a J-B file) has the same `(1 + p / 60)` term
and needs the same floor. Why: with a full push at 0 %, the FIRST blow decides an open 2–5 m arena
(ring-out luck); with an absolute meter a 94 k-HP fighter that lost 3.7 % of its health reads 28 %.

## 4. Body push by mass

Search `const push = (minD - sd) / 2;` (the body-body separation): a 50/50 split lets a 70 kg fighter
walking into a 170 kg one shove it out of a closet.

```ts
const mP = this.#bodyOf(p).parts.reduce((s, q) => s + q.mass, 0), mO = this.#bodyOf(o).parts.reduce((s, q) => s + q.mass, 0);
const over = minD - sd, shareP = mO / (mP + mO);
p.body.x -= sx / sd * over * shareP; p.body.z -= sz / sd * over * shareP;
o.body.x += sx / sd * over * (1 - shareP); o.body.z += sz / sd * over * (1 - shareP);
```

## 5. The time limit: the judge instead of a plain tie

Search `if (timeLimitVerdict(this.#timeLimit, hostile).over) this.#endMatch(null, "time-limit");`:

```ts
import { judgeTimeLimit } from "../game/MatchControl.ts";
if (timeLimitVerdict(this.#timeLimit, hostile).over) {
  const w = judgeTimeLimit(p.hp / p.stats.maxHealth, o.hp / o.stats.maxHealth);
  this.#endMatch(w === 0 ? "player" : w === 1 ? "opponent" : null, "time-limit");
}
```

The record keeps `statGap`; the victory line for a judged bout should say "on points". A gap ≤ 5
points stays a tie (`JUDGE_MARGIN`).

## 6. The AI: digest features, the edge-aware tree, sensible skills, A* for both seats

Lane J-T's digest (`src/game/arena/digest.ts` `arenaDigest`) must be kept per match (`this.#digest`).

1. Features into every `CombatView` (both `#opponentAct` and `#playerAct`, search `const view: CombatView = {`):

   ```ts
   import { arenaFeatures, edgeAwareTree } from "../game/DecisionTree.ts";
   if (this.#digest) Object.assign(view, arenaFeatures(this.#digest, { x: o.body.x, z: o.body.z }, { x: p.body.x, z: p.body.z }));
   ```

   (self first, enemy second; swap for `#playerAct`).
2. Walk the edge-aware tree: `new Brain(mode, personality, policy, edgeAwareTree(this.#engageDistance(f)))`
   where brains are built, and `f.tree = edgeAwareTree(this.#engageDistance(f))` for brain-less
   fighters (rebuild when the weapon changes: its distance thresholds follow the fighter's reach).
   Without features it decides exactly like `defaultTree()` (test `J-B D1`), so this is safe before
   the digest is wired. With them it fixes a measured defect of the default tree: `nearEdge` (edge
   within 1.5 m) is TRUE everywhere in an arena under ~3 m across, so two default-tree bots in a
   closet only block/retreat — in the first sample batch (walk-off guard on) 15/15 of the 2 m grid
   matches ended on time at 100 % health each; without the guard they walk off instead.
3. Filter the skill pick (search `const pick = chooseAiSkill(`):

   ```ts
   import { sensibleSkill } from "../game/AiBrain.ts";
   if (pick >= 0 && !sensibleSkill(rt.skills[pick], view)) pick = -1; // make `pick` a let
   ```

   `chooseAiSkill` treats every "dash" as a gap-closer, but the Archer's dash IS "Rolling Shot"
   (lunge −2.6 m, backward): a live AI archer rolls AWAY every 3.5 s. Near an open edge it rolls
   itself out (the largest single source of strong-vs-weak losses under the engine's rules).
   `SkillRuntime.chooseAiSkill` itself (not a J-B file) should learn the lunge sign.
4. The spectate player seat walks straight (`#playerAct` uses `dirX: dx / dist`), the opponent seat
   uses A* (`#aiHeading`). Use `#aiHeading(p, o.body.x, o.body.z, dt)` for the player seat too: the
   headless sim measured bodies pinned on props without it.
5. A walk-off guard (refuse an AI step past an OPEN rim) belongs with the edge-aware tree only. On the
   default tree it turns the `nearEdge → retreat` branch into standing at the rim forever (basic vs
   basic, open 8–25 m: self walk-offs 28 → 3 of 600, but time-outs 13 → 228).

## 7. Spectator speed: `MatchControl.stepTime` is NOT wired

`grep -rn stepTime src` finds only its definition. The loop takes `dt = min(getDelta, 0.1)`. Wire:

```ts
import { stepTime } from "../game/MatchControl.ts";
const real = this.#paused ? 0 : Math.min(this.#clock.getDelta(), 0.1);
const sim = stepTime(real, this.#speedId);           // × timeScale, clamped to 0.25 s
const n = Math.max(1, Math.ceil(sim / (1 / 60)));      // sub-step: the sweep/ragdoll need small dt
for (let i = 0; i < n; i++) this.#stepFight(sim / n);  // the fight half of #loop, factored out
```

Rendering, the HUD and the camera keep the real `dt`. `#speedId` comes from the spectator UI (the
`SPEEDS` table already has half … eight).

## 8. Record the full conditions of every live match

In `#recordMatch` (≈ line 4192), also build the frozen contract record and keep a ring buffer:

```ts
import type { MatchConditions, MatchOutcome, MatchRecord as ArenaRecord } from "../game/arena/contracts.ts";
const conditions: MatchConditions = {
  version: 1, seed: this.#matchSeed, codeHash: BUILD_CODE_HASH /* tools/batch.ts codeHash() at build time */,
  simulator: "engine", arena: this.#arena, walls: this.#wallPlan, symmetry: this.#symmetry, digest: this.#digest,
  fighters: [specOf(this.#player, this.#playerProfile), specOf(this.#opponent, this.#opponentProfile)],
  timeScale: resolveSpeed(this.#speedId).timeScale, design: this.#batchDesign ?? "live",
};
const outcome: MatchOutcome = { winner, reason, duration: this.#elapsed, hpLeft, hpFracLeft, damageDealt, hits, swings, wallHits: this.#wallHits, edgeTime };
this.#arenaRecords.push({ conditions, outcome }); // cap ~200
```

`specOf` fills `FighterSpec` from the profile (race, subrace, className, birthsign, level, allocated,
weapon `{ type, seed: matchSeed, quality: 0 }`, strategy `"basic"` for the tree / `"full"` with the
edge tree, aiLevel `this.#arena.aiLevel`, `stats: f.stats`). `MatchOutcome.reason` maps
`ko/ringout/time-limit/forfeit` → `ko/ringout/time/draw`. Expose `debugArenaRecords()`.

## 9. A batch hook for a browser runner

```ts
/** QA/batch: play one match from a MatchConditions object; resolves with its record. */
async runConditions(c: MatchConditions, speedId: SpeedId = "eight"): Promise<ArenaRecord> {
  this.#arenaOverride = { ...c.arena };              // exact config (QA override keeps its size)
  this.#batchDesign = c.design;
  this.#speedId = speedId;
  const [a, b] = c.fighters.map(profileFromSpec);    // race/subrace/class/birthsign/level/allocated/weapon
  this.#spectate = true;
  this.#startFight(a, b);                            // + seed the arena/weapon rng from c.seed
  await new Promise<void>((done) => { const t = setInterval(() => { if (this.#decided) { clearInterval(t); done(); } }, 100); });
  return this.#arenaRecords.at(-1)!;
}
```

A probe (`tools/probe-batch.ts`, parent-owned) then streams `artifacts/batch/records.jsonl`
conditions into `__MYTHERRANIA__.engine.runConditions(...)` and writes the engine's records beside
the headless ones, so `Summary.summarize` compares the two simulators cell by cell (the sim's
fidelity check). Seeding: `#startFight` uses `Date.now()`/`Math.random()` for the arena rng, spawn
jitter and the match seed — `runConditions` must route `c.seed` into all three or replays differ.
