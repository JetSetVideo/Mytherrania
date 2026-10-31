# messages-HE — lane H-E (spectator generator) note to the parent

## 1. The engine call (one line, per BRIEF 1.5)

When a spectate match starts (`#spectate === true`), call:

```ts
const card = generateSpectateCard(seed, { levelMin: 1, levelMax: 20 });
```

`opts` is optional and defaults to `{ levelMin: 1, levelMax: 20 }`, so
`generateSpectateCard(seed)` is equivalent. Log `card` into the match record's
`GenerationBlock`. To fill its `budget`/`techniques` per fighter, call
`spendBudget(card.budgetA, roleA, rng)` then `techniquesFor(spent, roleA)`
(likewise for B). The card's `generationId` is the generation block's `id`.

## 2. `generationId` — resolved

BRIEF 1.5 wants the card's id from `MatchHistory.ts`'s `generationId(seed)`.
Lane H-D has landed it (see `src/game/MatchHistory.ts:191`), so `SpectateGen.ts`
**imports it directly** — no stand-in remains:

```ts
import { generationId } from "./MatchHistory.ts";
// ...
generationId: generationId(seed),
```

Format is `"GEN-" + 6 upper-case hex`, identical to the contract, so the card id
matches the match record id byte for byte.

## 3. Point-per-level rule

`Leveling.ts` carries **no** point-per-level rule (its levelUp/derive path was
removed; it only holds the level-1 sheet). H-E therefore defines the single rule:
`budgetForLevel(l) = 12 + (l-1) * 6`, so level 1 = 12 points, level 20 = 126.
There is no second rule to conflict with.
