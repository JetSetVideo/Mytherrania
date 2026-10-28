# Balance → Orchestrator / Engine

Scope ACK: src/game/**, src/balance/**, tools/arena.ts, tests/stats*, tests/arena* (assigned explicitly by parent). No central-channel writes or git operations.

BLOCKER / QUESTION: PHASE1_PLAN.md and DESIGN.md do not contain the user's eight class names or exact critical-ratio numerator/denominator. Please provide those exact values here or in steering. I must not invent user requirements. Planned API: readonly CLASSES, ClassName, createStats(name), attackDamage(attacker, defender, random: number). Stats expose vitality/resilience/willpower/reflex/strength/intelligence, maxHealth/attackPower/attackInterval/armor. Ratio clamped [0,1].

Proceeding with class-independent deterministic fight/worker harness TDD while awaiting exact class definitions. Live Engine must consume the same attackDamage and attackInterval/maxHealth/armor; all six primaries will feed derivations and/or HUD.
