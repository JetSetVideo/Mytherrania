# Phase 1 execution plan
Owner: Agent-Orchestrator (parent Hermes). Implementers: Engine-Architect, Graphics-CelShading/Audio-Acoustics, Balance-ArenaHarness. Independent reviewers sign actual checks, not simulated roles.
Scope: runnable root loop first, terrain island, player box/training dummy, physical input, typography/settings, cel+outline, synthesized audio, eight class stats, worker arena.
Deferred without stubs: networking, 12 biomes, Maslow AI, advanced animation/weather, inventory/progression.
Interpretations: no runtime CDN/network dependency; Three.js bundled locally (explicit dependency), Deno toolchain packages build-only. KeyboardEvent.code KeyW is physical AZERTY Z and KeyA is AZERTY Q; do not map KeyZ to forward on QWERTY. CriticalChance ratio clamped [0,1] with bounded denominator. Stun=damage*impact*1.5**wallBounces; document unit scaling.
G1 manifest/build/root boot. G2 wired gameplay/stats/audio. G3 worker Monte Carlo 10000 independent fights per unordered class pair, held-out seeds, 48-52% pairwise target; no manufactured mirror outcomes or coin-toss winners. G4 typecheck/lint/tests/static reachability, honest browser coverage. G5 four cameras and 375/768/1440 captures; CPU submission, rAF, GPU distinguished; <=16.6ms budget, no invented allocation claims. G6 actual independent reviews + parent reproduction/source hashes.
Requirement ids: FR-001 manifests/server/local bundle; FR-002 main/Engine; FR-003 physical keyboard/settings; FR-004 eight class Stats; FR-005 worker ArenaHarness; FR-006 GLSL cel/outline; FR-007 audio; FR-008 smash impacts; SC-001 frame budget; SC-002 pairwise balance; SC-003 active reachability/no stubs; SC-004 dual review.
Architecture: main.ts -> src/engine/Engine.ts -> src/graphics/shaders/CelShader.ts, src/audio/AudioManager.ts, src/game/Stats.ts, src/physics/SmashPhysics.ts, src/input/Input.ts. tools/arena.ts -> src/balance/ArenaHarness.ts -> workers and Stats. Shared pure combat, if created, must be used in engine. No networking implementation in phase1.

## Phases after 1 (each landed on a working layer, per Gall's Law)

**Phase 2 — world systems.** Races/subraces/birthsigns; three skills per class with procedural
sin/cos rig animation and generated weapons; five senses + magnetism; statuses; ragdoll; items;
fog of war; shaped arenas with walls, outside ground and props; physics-driven damage; the truce.
All LIVE and gated.

**Phase 3 — data and opponents.** Adaptive AI profiles with named identities and four archetypes;
per-fight telemetry digests (min/max/avg/median, distances, damage dealt/prevented/missed,
technique share, altitude/xyz, 80/50/20%/last-hit thresholds); instant headless battle corpus;
Elo leaderboard with a king and clickable per-AI cards. Balance field-wide to 49.4–50.6%.

**Phase 4 — presentation.** Stance-transition sub-animations; palm-driven grip; facial morph
loop; animation tensor bounds; camera occlusion fade; balance plates and recovery; the 33-vertebra
spine curve; race/sub-species appearance (hair, beards, tusks, ears); responsive UI at four
breakpoints; selection pick-tables; race hero + birthsign preview; Player_ID profiles.

**Still OPEN** (recorded so they cannot be forgotten): win-condition variety; feeding the battle
corpus into `NeuralTrainer`; glider input/render/physics; two-handed weapons; stat allocation;
player skill selection; keybinding rebind UI; a telemetry backend; low-sun shadow verification;
controller input on real hardware.

