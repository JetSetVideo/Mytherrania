# H-C → parent: SecondaryMotion lands; Ancestry.ts import deferred (structural type)

Written 2026-10-31 by lane H-C.

## Status: done, gate green

`src/game/anim/SecondaryMotion.ts` and `tests/secondarymotion_test.ts` are in and pass
`deno check` / `deno lint` / `deno test` (11 tests). No change was made to
`src/game/Skeleton.ts` — per BRIEF §1.3 the parent does the 3-line wiring inside
`Humanoid.update`, so H-C needed no hook there.

## The one open item: HairPhysicsSpec

BRIEF §1.2 wants `import type { HairPhysicsSpec } from "../Ancestry.ts"`. At the time H-C
wrote the module, `src/game/Ancestry.ts` did not exist yet, so a real import would have
broken `deno check` for this lane. Following the lane instruction, the module consumes the
spec STRUCTURALLY:

```ts
constructor(spec: { massKg: number; stiffness: number; damp: number; windGain: number }, count, seed)
```

The test file defines the same shape as a local `type Spec`. Nothing is exported from
`SecondaryMotion.ts` under the name `HairPhysicsSpec`, so there is no clash with H-A.

## Action for the parent (optional, cosmetic)

Once `src/game/Ancestry.ts` exports `HairPhysicsSpec`, either leave the structural parameter
as-is (it is structurally identical and assigns cleanly) or switch the constructor line to:

```ts
import type { HairPhysicsSpec } from "../Ancestry.ts";
constructor(spec: HairPhysicsSpec, count: number, seed: number) { ... }
```

No behavioural change either way. If H-A’s spec gains fields beyond the frozen four, update
the structural parameter (and the test `Spec`) to match.
