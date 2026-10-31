# Wave H — Ancestry hierarchy, hair physics, match telemetry (contract)

Written 2026-10-31 by the parent, from the user's spoken brief. This file is FROZEN:
lanes code against the interfaces here and may not renegotiate them. If a lane needs a
change, it writes `artifacts/messages-H<lane>.md` and keeps working on the rest.

## 0. The decoded brief (voice transcript — raw phrases kept, decode next to them)

The transcript drifts phonetically. These are the decodes this wave acts on:

| Spoken | Decoded | Where it lands |
|---|---|---|
| "the dogs, they have the two teeth on the lower … picking out" | **orks** — two lower tusks jutting out | H-A `tusk`, H-B tusks |
| "the hawks … typically only at the chin … they tend to be the boldest one" | **orks** — chin-only facial hair, the **baldest** | H-A `beard.mode="chin"`, `hair.baldChance` |
| "belchia … larger skull … they always have a bill" | **the broad-skull races (dwarf, ork)** — big skull, and **dwarves always keep a beard** | H-A `skull`, `beard.required` |
| "earth physics is bound to the size … if they are long or curly" | **hair physics**: secondary motion mass comes from hair length and curl | H-C |
| "limit the victory condition in time … 3 minutes maximum a match and then it is called a tie" | **180 s hard cap → tie**, with the stat difference recorded | H-D |
| "generative models … added to the historic and logging system so the training systems can learn" | generation block on every match record, fed to the trainers | H-D, H-F |
| "compressed at the end … most important variables … spread them out with data science … within a maximum" | bounded-time data-science pass: key variables, distances, spread, special-game flag | H-F |

Everything the brief asks for, item by item:

1. A **hierarchy** over all races and all 12 subraces, with **ratios between body parts**
   and an explicit per-metric ordering.
2. Per-ancestry **look**: elvish bluish skin darkening at joint/under-eye/under-cheek
   crossings, bluish-green to ginger elf hair, brown-to-white humans with reddish-brown
   skin and dark-to-blond curly-or-flat hair, dwarf shoulders/torso/short-big legs,
   ork purple→yellow-green skin with tusks, dwarf + ork prominent skulls.
3. **Beards/eyebrows/hair** hierarchy: dwarf biggest brows + always bearded (variation
   around the mouth), human big brows + optionally big beard, ork short brows + chin-only,
   elf long thin brows whose tips run past the face, elf long hair, no bald elves, ork
   baldest.
4. **Hair/beard/brow physics** — conditional animation from the weather and from attack
   effects that displace the hair, returning to rest by damped physical motion whose mass
   follows length and curl.
5. **Generative models** pick generations (variation inside a race's band) and those are
   **logged** into the history so training can learn from played matches.
6. **Time limit**: 180 s cap (configurable to 240 s), a cap hit is a **tie**.
7. **Stat-difference** at match end, logged with the match so a fight's dominance margin
   is known, and surfaceable in the History UI (fastest match, biggest discrepancy).
8. **Spectator** mode: random level + arena + a **stat point budget**, with the techniques
   a fighter can use **influenced by its stats**.
9. **Data science**: compress records to the most informative variables, compute distances
   and spread, flag "special" games, all inside a bounded runtime.

## 1. Frozen interfaces

### 1.1 `src/game/Ancestry.ts` (new, owned by H-A)

```ts
export type MetricName =
  | "height" | "thinness" | "legLength" | "armLength" | "shoulderWidth" | "torsoMass"
  | "skullProminence" | "browProminence" | "hairLength" | "beardCoverage" | "earLength"
  | "tuskProtrusion" | "skinDepth";

export interface SkinSpec {
  base: string;              // "#rrggbb" mid-tone of the race's skin
  range: string[];           // 3-5 tones a character may be drawn in (first = most common)
  crease: string;            // the darkening colour at a joint/fold crossing
  creaseStrength: number;    // 0..1 how strongly the creases read
  zones: ("under-eye" | "cheek-fold" | "neck" | "joint" | "knuckle" | "brow")[];
}
export interface HairSpec {
  length: "bald" | "short" | "medium" | "long" | "verylong";
  styles: string[];          // HairStyle ids from src/game/RaceAppearance.ts
  colors: string[];          // 3-6 "#rrggbb" a character may draw from
  curl: number;              // 0 straight .. 1 coiled
  density: number;           // 0..1 thickness of the mass
  baldChance: number;        // 0..1 per character (orks highest, elves 0)
}
export interface BrowSpec { length: number; thickness: number; prominence: number; tipPastFace: number; }
export interface BeardSpec {
  mode: "none" | "chin" | "moustache-thin" | "moustache" | "full";
  coverage: number;          // 0..1 of the jaw the growth covers
  lengthMul: number;         // multiplier on the beard mass
  required: boolean;         // true = this ancestry always grows it
  allowed: boolean;          // false = never, whatever the character says
}
export interface TuskSpec { count: 0 | 2 | 4; protrusion: number; direction: "up" | "out" | "down"; }
export interface EarSpec { lengthMul: number; pointed: number; droop: number; }
export interface SkullSpec { massMul: number; browRidge: number; jawWidth: number; }
export interface HairPhysicsSpec { massKg: number; stiffness: number; damp: number; windGain: number; }

export interface AncestryNode {
  id: string;                // "elf" | "high" | ...
  name: string;              // "Elf" | "High Elf" | ...
  race: string;              // parent race id; equals id for a race node
  parent: string | null;     // null for a race node
  ranks: Record<MetricName, number>;   // 1 = the most of this metric; 0 = unranked
  skin: SkinSpec; hair: HairSpec; brow: BrowSpec; beard: BeardSpec;
  tusk: TuskSpec; ears: EarSpec; skull: SkullSpec; hairPhysics: HairPhysicsSpec;
  lore: string;              // one sentence, in the game's voice
}

/** Every race and every subrace, keyed by id: 4 race nodes + 12 subrace nodes. */
export const ANCESTRY: Record<string, AncestryNode>;

/** The subrace node merged over its race node (missing subrace -> the race node). Never null. */
export function ancestryOf(raceId: string, subraceId: string | null): AncestryNode;

/** The 4 race nodes ordered by a metric, most first. */
export function rankOf(metric: MetricName): { id: string; rank: number }[];

/** For every metric, the sign of a minus b (race-level ordering): 1 = a has more, -1 = less, 0 = equal. */
export function compareAncestry(a: string, b: string): Record<MetricName, number>;

/** A character's hair/beard mass in kg: length and curl from the ancestry, jittered by the seed. */
export function hairMassKg(raceId: string, subraceId: string | null, seed: number): number;
```

Data source: **`artifacts/design/ancestry.json`** (new, owned by H-A), imported with
`import ancestryRaw from "../../artifacts/design/ancestry.json" with { type: "json" }`.
Every node is COMPLETE: all 13 metrics ranked, all 8 spec blocks present. Ranks must be a
strict ordering (1..4) across the 4 race nodes for each metric, with ties impossible: rank
1 = most.

### 1.2 `src/game/anim/SecondaryMotion.ts` (new, owned by H-C)

```ts
import type { HairPhysicsSpec } from "../Ancestry.ts";

/** One displaced secondary mass (a hair fall, a beard, a brow tip). */
export interface SecondaryState { offset: [number, number, number]; vel: [number, number, number]; }

export interface SecondaryInputs {
  /** Wind in the world's frame, m/s, from the climate's wind vector. */
  wind: readonly [number, number, number];
  /** The head's world velocity, m/s (swing and lunge impulses ride in here). */
  headVel: readonly [number, number, number];
  /** The character's facing yaw, rad, so wind is expressed in body space. */
  yaw: number;
  /** 0..1 how wet/heavy the mass is (rain makes it sag and react less). */
  wetness: number;
}

export class SecondaryMotion {
  constructor(spec: HairPhysicsSpec, count: number, seed: number);
  /** Integrate one step. dt clamped to MAX_STEP (0.25 s); never NaN, never unbounded. */
  step(dt: number, inputs: SecondaryInputs): void;
  /** The offset for mass i, in body-local metres. */
  offset(i: number): readonly [number, number, number];
  /** Total displacement magnitude across masses, for tests and the debug HUD. */
  magnitude(): number;
  /** True once every mass is inside 1 mm of rest. */
  resting(): boolean;
}
```

Rules C is held to, all testable: the motion is a damped spring (`a = -k·x - c·v + force/m`),
a wind impulse grows with `windGain` and falls with `wetness`, a big `headVel` displaces more
than a small one, the same seed reproduces the same trajectory, the step is frame-rate
independent (the same simulated time in 1 step or 10 gives offsets within 1 %), a violent
input never leaves a 1 m box, and stepping to rest converges (`resting()`), never oscillating
forever. Cost must be O(count): no allocation inside `step`.

### 1.3 Rig surface for the secondary masses (H-B honours this shape)

`HumanoidRig` gains exactly one field:

```ts
secondaryMasses: THREE.Object3D[];   // the nodes a SecondaryMotion drives: hair fall, tip,
                                     // side locks, beard, brow tips. Order is fixed at build time.
```

H-B creates the nodes and returns them; the parent wires `SecondaryMotion` to them inside
`Humanoid.update` (a 3-line integration the parent owns, so the two lanes do not touch the
same lines).

### 1.4 Match records (H-D owns the types, the parent wires the engine)

```ts
// src/game/MatchControl.ts
export const MATCH_TIME_LIMIT_S = 180;        // the brief's "3 minutes maximum"
export const MATCH_TIME_LIMIT_MAX_S = 240;    // hard ceiling for a configured limit
export function resolveTimeLimit(configured?: number): number;   // clamped into [30, 240], default 180

// src/game/WinConditions.ts
export type WinConditionKind = "ko" | "sudden-death" | "first-blood" | "endurance" | "domination" | "time-limit";
/** The cap: at or past the limit with nobody KO'd, nobody wins. */
export function timeLimitVerdict(limitS: number, hostileTime: number): WinVerdict;   // { over, winner: null, reason: "time-limit" }

// src/game/MatchHistory.ts
export interface StatGap {
  /** Per-stat difference (fighter 1 minus fighter 0), in each stat's own units. */
  raw: { vitality: number; resilience: number; willpower: number; reflex: number; strength: number; intelligence: number };
  /** Per-stat difference in pooled standard deviations (0 anywhere both are equal). */
  z: Record<string, number>;
  /** Euclidean length of `z` — THE scalar "how far apart were these two builds". */
  distance: number;
  /** |dealt0 - dealt1| / max(1, dealt0 + dealt1): 0 even, 1 one-sided. */
  damageShare: number;
  /** 0..1 composite dominance of the winner (0 = a coin flip, 1 = a rout). */
  dominance: number;
}
export interface GenerationBlock {
  seed: number;            // the match's generation seed
  id: string;              // stable short id, e.g. "GEN-4F2A19"
  arena: string;           // the generated arena's name/shape
  budget: number;          // the stat point budget the generator spent
  techniques: string[];    // the technique ids the stats unlocked
  ancestry: [string, string];  // "race/subrace" per fighter
}
// FighterRecord gains: stats (already there), level (already there), ancestry (string),
// generationSeed (number).
// MatchRecord gains: limitS: number; tie: boolean; statGap: StatGap; generation: GenerationBlock;
//   margin: number;   // = statGap.dominance, hoisted for the UI
export function statGapOf(a: FighterRecord, b: FighterRecord, dealtA: number, dealtB: number): StatGap;
export function generationId(seed: number): string;      // "GEN-" + 6 hex, stable
/** History highlights the menu shows: the fastest decided match, the widest stat gap, the ties. */
export function highlights(list: MatchRecord[]): {
  fastest: MatchRecord | null; widestGap: MatchRecord | null; tieCount: number; timeoutCount: number;
};
```

Back-compat: `parseHistory` must keep accepting old records with no `statGap`/`generation`
(they are optional on read, filled with a zero gap and a `"GEN-LEGACY"` id), so a player's
existing 500-match history still loads.

### 1.5 Spectator generation (H-E owns it)

```ts
// src/game/SpectateGen.ts (new)
export interface SpecRow {
  level: number;                 // 1..20
  budget: number;                // stat points the generator may spend
  spent: Record<StatName, number>;
  techniques: string[];          // technique ids unlocked by the spent stats
  arenaSize: number;             // m
  seed: number;
}
export interface SpectateCard {
  seed: number; levelA: number; levelB: number; budgetA: number; budgetB: number;
  arenaSize: number; generationId: string;
}
/** The point budget a level is worth, and the level a budget implies (inverse pair, tested). */
export function budgetForLevel(level: number): number;
export function levelForBudget(budget: number): number;
export function generateSpectateCard(seed: number, opts?: { levelMin?: number; levelMax?: number }): SpectateCard;
/** Spend a budget on the six primaries, biased by the role, never over budget, never negative. */
export function spendBudget(budget: number, role: ClassName, rng: () => number): Record<StatName, number>;
/** The techniques those stats unlock (stat thresholds -> skill ids, at least 3, at most 6). */
export function techniquesFor(spent: Record<StatName, number>, className: string): string[];
```

### 1.6 Data science (H-F owns it)

```ts
// src/balance/CorpusMath.ts (new)
export interface KeyVars { duration: number; gapDistance: number; dominance: number; damageShare: number; pace: number; spread: number; }
export function keyVars(rec: MatchRecord): KeyVars;
/** z-score standardisation over the corpus; zero-variance columns -> 0, never NaN. */
export function standardise(rows: KeyVars[]): { rows: Record<keyof KeyVars, number>[]; mean: Record<keyof KeyVars, number>; sd: Record<keyof KeyVars, number> };
export function euclidean(a: Record<string, number>, b: Record<string, number>): number;
/** Mahalanobis distance with a diagonal covariance: per-column sd, so scale never dominates. */
export function mahalanobis(a: Record<string, number>, b: Record<string, number>, sd: Record<string, number>): number;
/** Descriptive spread of every key variable: n, min, p20, median, p80, max, mean, sd. */
export function spreadOf(rows: KeyVars[]): Record<keyof KeyVars, { n: number; min: number; p20: number; median: number; p80: number; max: number; mean: number; sd: number }>;
/** The outlier flag: a match far from the corpus centre on ANY key variable. */
export function specialGames(rows: KeyVars[], z = 3): { index: number; key: keyof KeyVars; z: number }[];
```

`tools/data-science.ts` (new, H-F) writes `artifacts/data-science-pass.json`, prints a
human-readable table, and MUST finish a 5 000-record corpus in under 10 s of wall clock
(measured and printed by the tool itself).

## 2. Lane ownership (no lane edits another lane's files)

| Lane | Owns | Deliverable |
|---|---|---|
| H-A | `artifacts/design/ancestry.json`, `src/game/Ancestry.ts`, `tests/ancestry_test.ts`, `docs/ancestry/HIERARCHY.md` | the hierarchy + data + module |
| H-B | `src/graphics/Humanoid.ts`, `src/graphics/body/FaceParts.ts`, `src/graphics/body/Proportions.ts`, `tests/ancestry_look_test.ts` | the look: skin creases, hair colours/curls, brows, beards, tusks, ears, skull |
| H-C | `src/game/anim/SecondaryMotion.ts`, `src/game/Skeleton.ts`, `tests/secondarymotion_test.ts` | hair/beard/brow physics |
| H-D | `src/game/WinConditions.ts`, `src/game/MatchHistory.ts`, `src/game/MatchControl.ts`, `tests/matchlimit_test.ts` | time limit, tie, stat gap, generation block, highlights |
| H-E | `src/game/SpectateGen.ts`, `tests/spectategen_test.ts` | spectator generation: level, budget, techniques, arena |
| H-F | `src/balance/CorpusMath.ts`, `tools/data-science.ts`, `tests/corpusmath_test.ts` | the bounded data-science pass |
| H-G | `src/ui/Menu.ts`, `src/ui/UiTree.ts`, `styles.css`, `tests/historyui_test.ts` | history highlights/sorts, spectator panel, ancestry lore panel |
| Parent | `src/engine/Engine.ts`, `docs/SPEC.md`, `tests/spec_test.ts`, this file | wiring, gate, browser evidence, commit |

## 3. The gate (every lane before it reports done)

1. `deno check <the files you touched>` → 0 errors.
2. `deno test --allow-read --allow-write=artifacts tests/<your test>` → all pass.
3. `deno lint <your files>` → clean (no `any` without a scoped ignore).
4. No `Math.random()` in a pure module: seed it.
5. Report WHO WHAT WHERE WHEN WHY HOW with the literal command output, not a summary of it.
   A claim without the command's output is not evidence.
