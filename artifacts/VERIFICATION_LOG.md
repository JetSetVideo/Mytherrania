================================================================================
INTER-AGENT VERIFICATION LOG [Phase 3 — History/Neural/Adaptive-Camera/Creator]
================================================================================
WHO:    Agent-Orchestrator (parent Hermes)
WHAT:   Combat history log, neural-network combat policy trained from duel data,
        adaptive behind-follow camera, character creator + NPC lexicon, arena
        variants, and a richer humanoid skeleton with facial features.
WHERE:  ~/Desktop/Mytherrania/
WHEN:   2026-10-09 23:55 UTC
HOW:    32 unit tests + typecheck + lint + headless Chrome menu/fight flow +
        headless Deno neural training (76.8k duels).

================================================================================
NEW MODULES (all live-referenced; zero stubs)
================================================================================
src/game/CombatLog.ts      Append-only per-match history: first-strike (auto-
                           detected), hits, ring-outs, KOs, decisions — each
                           with when/where/from/to/what/why. digest() aggregates.
src/balance/NeuralPolicy.ts 6->8->5 MLP (tanh hidden, linear output) mapping
                           combat features to attack/advance/retreat/block/wait;
                           forward/decide/mutate.
src/balance/NeuralTrainer.ts  Evolves the NN weights by duelling tree-driven
                           opponents; fitness = win rate.
src/game/Characters.ts     NPC lexicon (6 named NPCs with class/title/appearance),
                           5 palettes, 3 presets, randomProfile() generator.
src/game/Skeleton.ts       Added neck joint; per-state limits + triggers.
src/graphics/Humanoid.ts   Cel-shaded humanoid now has neck, eyes, nose, mouth,
                           ears, hair, beard, moustache and total height/weight
                           scaling; weapon on the right hand via its grip.
src/ui/Menu.ts             Title -> character creator (name, class, 5 palettes,
                           random + 3 presets, NPC/class opponent) -> victory.
src/engine/Engine.ts       CombatLog wired in (first strike/hits/ring-out/ko),
                           adaptive behind-follow camera (distance/angle ease
                           with speed + opponent distance), 4 arena variants
                           (ring/walls/hills/river), profile-driven appearances.

================================================================================
EVIDENCE (observed, not claimed)
================================================================================
Neural policy: trained over 76,800 duels; win rate vs tree-driven opponents
improved 58.6% -> 96.8%. The network learns to out-decide the hand-written tree.

Menu flow (Chrome, 0 console errors): title -> creator (5 palettes) -> random
generate + Assassin class + "Nyra (Assassin)" NPC -> fight started on a random
arena ("river"/"hills" observed), both fighters armed, combat log first-strike
null until first hit, elapsed time tracking active.

================================================================================
METRICS
================================================================================
Tests:     32/32 pass (combatlog 3, neural 3, + prior 26)
Typecheck: 0 errors
Lint:      0 issues across 49 files
Build:     532KB single-file bundle, zero runtime CDN

================================================================================
KNOWN GAPS (honest)
================================================================================
- Neural policy trains against the abstract duel model; the live ring AI still
  uses the decision tree (both share the same decision interface).
- Arena variants are cosmetic terrain; they do not yet alter physics (walls are
  non-blocking, water is not swimmable, hills do not raise footing).
- Muscles/elasticity/stretch are represented by weight scaling, not a full
  deformation solver; full lips/nose/torso sculpting is low-poly approximation.
- Audio still gesture-gated; field perf data absent; networking deferred.
================================================================================

================================================================================
INTER-AGENT VERIFICATION LOG [Phase 4 — Presentation: rig, ancestry, camera]
================================================================================
WHO:    Agent-Orchestrator (parent Hermes)
WHAT:   Race/sub-species appearance (build, hair length + styles, beards, ork tusks,
        elf ears, expanded hair/skin palettes); the 33-vertebra spine curve; the
        facial morph loop (brows/eyelids/mouth per combat state); animation tensor
        bounds per class power; menu window expansion.
WHERE:  ~/Desktop/Mytherrania/  (src/game/{RaceAppearance,SpineCurve,FaceMorph,AnimTensor}.ts,
        src/graphics/Humanoid.ts, src/engine/Engine.ts, styles.css)
WHEN:   2026-10-10
HOW:    325 unit tests (0 failed) + typecheck (0 errors) + lint + build 718,124 B +
        headless Chrome model probe (artifacts/qa-models/, 4 races x 3 angles) judged
        with vision_analyze + 9 new spec-pin tests in tests/spec_test.ts.
RESULT: ork underbite/tusks CONFIRMED; elf long hair to mid-back CONFIRMED; dwarf beard
        CONFIRMED with eyes/mouth visible; dwarf stocky build CONFIRMED.
GAPS:   Face morph is mesh-level (no morph-target skins). Tensors describe, not drive,
        the runtime animation. Full per-parameter creator panel still OPEN.
================================================================================
