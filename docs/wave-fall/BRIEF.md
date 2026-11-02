# Wave FALL — forces, collisions, falls (frozen contract, swarm protocol)

Repo `~/Desktop/Mytherrania`. Read `~/.hermes/skills/software-development/mytherrania-wave/SKILL.md` first (pitfalls
14 sub-stepping, 16 pin relationships, 19 headless pause, 20 channels, 23 aim yaw = planted-foot slide, the
balance-noise lessons, macOS has no `timeout`). Base: Wave Z (commit 911a59a). Ring-outs end ~65 % of matches
(docs/wave-y/POOLS.md) — any change near edges moves balance a lot: MEASURE before/after.

## The user's ask (voice-transcribed, decoded)
1. **Forces / charge collisions.** When two fighters charge (or swing) into each other at the same time, play an
   interaction animation (a shove/clash: both brace, collide, recoil) and push them apart. How far each one is pushed
   and how fast it recovers depends on weight (body + armour/weapon), level, weapon, and all the statistics: the
   stronger and the more agile fighter is pushed back less and recovers sooner.
2. **Falls.** A fighter pushed hard, pushed off a ledge/step/drop, or walking BACKWARD over an edge/obstacle may
   stumble and FALL: a falling animation, lying on the floor, then getting up automatically. Recovery (get-up) time
   depends on armour weight, body weight, agility, health %, stamina.
3. **Downed penalty.** While on the ground: takes more damage, more crits, and is more subject to some powers
   (e.g. longer control/status durations, more knockback from pushes).
4. **AI + information.** The AI knows about falls (strike a downed enemy, avoid backing toward edges when unbalanced,
   time its own get-up / guard) and the match telemetry STORES every collision and fall: who, cause, pose/phase, the
   forces, duration, outcome — so the AI can be judged and improved from records (MatchHistory/MatchReport/batch).

## Lanes (DISJOINT writes; read anything; no git commit/stash/checkout/add -A)

| agent | owns |
|---|---|
| **M — mechanics** | new `src/game/Collision.ts`, new `src/game/Fall.ts` (pure), `src/game/{Fighter,Physics,RingOut,Status,FightTelemetry,MatchReport,MatchHistory,AiBrain,DecisionTree,Strategies,Perception,Influence,Balance,Terrain}.ts`, `src/combat/{Impact,contracts}.ts`, `src/physics/{ArenaPhysics,SmashPhysics,WallCollision}.ts`, `src/balance/**`, `src/engine/Engine.ts`, `src/ui/CombatText.ts`, `src/ui/FighterPanel.ts` (a "DOWN" state chip only), tests for these, new `tests/wave_fall_mech_test.ts`, new `tools/probe-wave-fall-mech.ts`, `docs/wave-fall/MECHANICS.md` |
| **A — animation** | `src/game/anim/**`, `src/game/{Skeleton,StanceAnim,AnimationCurve}.ts`, `src/physics/ragdoll/**`, `src/graphics/body/SkinnedHumanoid.ts`, tests for these, new `tests/wave_fall_anim_test.ts`, new `tools/probe-wave-fall-anim.ts`, `docs/wave-fall/ANIMATION.md` |
| **V — verifier** | writes only `tools/verify-wave-fall.ts`, `docs/wave-fall/VERIFY.md`, `artifacts/wave-fall/verify/**` |

## Contracts
- **C-FORCE (M)** `Collision.ts` pure: `resolveCollision(a: BodyState, b: BodyState): CollisionResult` where
  `BodyState = { mass, velocity:[x,z], strength, agility, level, stamina01, hp01, weaponMass, armourMass, guarding, downed }`
  and the result gives each fighter an impulse/velocity change, a pushback distance, a `stagger` time and a fall chance
  input (a "balance loss" 0..1). Momentum-conserving exchange with a stat-weighted effective mass: more mass, strength,
  agility, level -> less pushed and shorter stagger. Symmetric inputs -> symmetric outputs; deterministic.
- **C-FALL (M)** `Fall.ts` pure state machine per fighter:
  `type FallPhase = "stand"|"stagger"|"stumble"|"falling"|"down"|"rising"`;
  `interface FallState { phase; t: number; duration: number; dir: [number, number] /* fall direction, world xz */;
  cause: "collision"|"hit"|"edge"|"backstep"|"ledge"|"exhaustion"|null; pose: "back"|"front"|"side" }`.
  Triggers: balance loss from a collision/hit over a threshold, a backward step whose rear foot finds a drop/edge/
  obstacle (use the terrain/arena probes), being pushed off a ledge (a height drop > a step within the arena), very low
  stamina. Get-up time law: `riseSeconds(armourMass, bodyMass, agility, hp01, stamina01)` (monotone: heavier/ wounded/
  tired -> slower; agile -> faster; clamped e.g. 0.8-3.5 s). The edge rule: ring-out stays the rule when the body is
  really outside; a fighter at the brink who is NOT outside may teeter (stumble) and recover or fall (agility/stamina).
  Downed penalty constants exported: `DOWNED_DAMAGE_TAKEN`, `DOWNED_CRIT_BONUS`, `DOWNED_STATUS_DURATION`,
  `DOWNED_KNOCKBACK` (pin relationships + measured bands, not literals).
- **C-ANIM (A)** the Animator input gains `fall?: { phase: FallPhase; t01: number; dir: [number,number]; pose }` and
  `shove?: { phase: "brace"|"impact"|"recoil"; t01: number; dir: [number,number]; magnitude01: number }` (A adds these
  optional fields to `AnimatorInput`; M fills them in Engine.#updatePose). A animates: shove (brace lean in, impact,
  recoil steps back preserving foot contacts), stagger (arms flail, back-step), stumble, fall (backward/forward/side,
  body to the ground — A may hand the fall to the ragdoll and blend back), lying, rising (a get-up sequence ending in
  guard). Root/hip height must hit the floor (no floating, no sinking: measure).
- **C-AI/C-LOG (M)** CombatView carries both fighters' FallState + recent collision; decisions use them. Telemetry
  records `{ t, kind: "collision"|"fall"|"rise", who, cause, phase, forces/impulses, pushback, duration, hp01, stamina01,
  outcome }` into the fight record (MatchHistory/MatchReport) and the batch summary aggregates them (falls per match,
  mean down time, damage taken while down, causes histogram).

## Swarm protocol
Board: `BOARD_DIR=artifacts/wave-fall deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` and
`... read <since> --to <ME>`. CLAIM at start; READY with reproduce commands + numbers; **M reviews A, A reviews M**;
**V** verifies every READY independently (own Deno + Chrome measurements: collisions of equal vs unequal fighters,
fall triggers fire, get-up times follow the law's monotonicity, root height on the floor during down, downed penalty
applied, telemetry records present, AI hits downed enemies more than standing ones, balance before/after, 0 page
errors, full suite). A lane is done when its reviewer AND V posted PASS on its latest READY (or after 3 rounds, open
FAILs listed). While waiting: `sleep 150` foreground. SPEC pins: M F1-F29, A F30-F49. Evidence generated by code;
screenshots under `artifacts/qa-wave-fall/<lane>/`.
