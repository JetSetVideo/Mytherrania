# Wave Y — brief (frozen contract)

Repo `~/Desktop/Mytherrania` (Deno 2, Three.js). Read `~/.hermes/skills/software-development/mytherrania-wave/SKILL.md`
(pitfalls: the game renders `buildSkinnedHumanoid`; CSP blocks inline `style=` in innerHTML; rebuild before probing;
headless pause pitfall 19; BUILD_OUT=dist-<lane> for parallel builds). Wave X (commit 6876048) is the base: read
`docs/wave-x/*.md` for what exists (ValueTone, CreatorTweak, steel sign, PreviewScene pedestal, Agility, Influence).

User ask (voice-transcribed, decoded):
1. Heroes page: ONE random-generation button that rerolls the chosen hero globally.
2. The hero's level shown in a nice badge/button.
3. Move Duplicate / Rename / Play this hero UP into the bar on the right, pushed to the right edge.
4. Keep improving titles: centred horizontally AND vertically in their boxes.
5. A more defined design system: CSS custom properties + calc()/clamp() equations for windows, borders, backgrounds;
   metal textures (steel, bronze, copper) for frames/plates; a rocky/stone texture for some buttons; consistent everywhere.
6. Health / Stamina / Magicka (mana): besides the MAXIMUM, a POTENTIAL (the ceiling you can still recover to this match),
   lowered by enemy attacks and effects and by fatigue/overuse (spending too much, too fast, too often), so you may not
   recover fully. Visible in the HUD.
7. Empty equipment slots around the model viewer, clickable, opening a list of (future) weapons / armour pieces.
8. A weapon slot button on the creation screen showing the equipped weapon icon; click -> list of weapon icons -> change it.
9. Knees slightly outward (pushed away from the vertical symmetry axis) in the stance/idle.
10. Weapons (e.g. swords) must never be held backward; the idle pose currently holds them the wrong way.
11. All attributes (incl. agility, focus) and the new potentials are stored and fed to the AI, so it knows them.

## Lanes and ownership (DISJOINT; read anything, write only yours; no git commit; blocked -> artifacts/messages-wave-y-<lane>.md)

| lane | owns |
|---|---|
| **U — interface** | `src/ui/**`, `styles.css`, `index.html`, new `src/game/EquipmentCatalog.ts`, `tools/probe-ui-all.ts`, new `tools/probe-wave-y-ui.ts`, `tests/ui_*`, `tests/menu_*`, new `tests/wave_y_ui_test.ts`, `docs/wave-y/UI.md` |
| **P — pools + AI** | new `src/game/Potential.ts`, `src/game/Resources.ts`, `src/game/AiBrain.ts`, `src/game/AiStats.ts`, `src/game/DecisionTree.ts`, `src/game/Perception.ts`, `src/game/Strategies.ts`, `src/balance/**`, `src/engine/Engine.ts` (HUD bars + wiring + the weapon/equipment hooks U needs), tests for these, new `tests/wave_y_potential_test.ts`, `docs/wave-y/POOLS.md` |
| **A — pose + grip** | `src/game/anim/**`, `src/game/{GripStance,PalmWeapon,Skeleton,StanceAnim}.ts`, `src/combat/**`, `src/graphics/body/SkinnedHumanoid.ts`, `src/graphics/WeaponMesh.ts`, `src/graphics/weapons/**`, tests for these, new `tests/wave_y_pose_test.ts`, new `tools/probe-wave-y-pose.ts`, `docs/wave-y/POSE.md` |

## Contracts

- **C-POT (P)** `src/game/Potential.ts` pure: per pool (`health`|`mana`|`stamina`) a state
  `{ max, potential, current }` with invariant `0 <= current <= potential <= max`. `regen` refills `current` only up to
  `potential`. `potential` falls by: a share of damage taken (wounds), enemy effects (status), and FATIGUE from spending —
  amount, rate (spend per second over a window) and frequency (spends per window); potential may recover slowly (rest)
  but never above max. Export the law's constants and functions; same functions in Engine and headless MatchSim.
  Engine exposes `debugPools()` (QA) -> both seats' `{max,potential,current}` x 3.
- **C-HUD (P)** HUD bars show three layers: max (frame), potential (dim fill / hatched "lost" region from potential to max),
  current (bright). CSS classes under `.pool-*` in styles.css belong to U: P writes DOM with classes
  `pool-bar`, `pool-current`, `pool-potential`, `pool-lost` and data attributes; U styles them (metal frame). P may add
  minimal fallback styles only via `Object.assign(el.style)` widths/heights.
- **C-AI (P)** the AI's view (DecisionTree CombatView / AiBrain context / NeuralPolicy inputs if cheap) carries all 7
  attributes of both fighters and both fighters' pool potentials; at least one decision uses them (e.g. a fatigued
  opponent -> press; own stamina potential low -> pace). Profiles store all attributes (already) — verify save/load
  round-trips agility/focus.
- **C-EQ (U, P)** `src/game/EquipmentCatalog.ts` (U, pure data): slots `weapon|offhand|helmet|armor|gloves|belt|legs|boots|cape`
  (match `Characters.EquipmentSlots`), and for each slot a list `{ id, name, slot, icon, available: boolean }`; weapons
  list = the real weapon types/archetypes the game has (available: true), armour = future placeholders (available: false,
  shown greyed "coming"). Choosing a weapon writes `profile.weaponType` (existing field the engine already reads);
  equipment ids go in `profile.equip` (stored, not yet applied in combat). If the engine must re-read weaponType for the
  preview, U calls the existing `onRoll(profile)` path.
- **C-GRIP (A)** no weapon is ever held blade/head pointing backward (behind the fighter's frontal plane) in idle,
  guard, walk and the creator preview; daggers may be reversed only as Wave V's rule says. Pin as SPEC Y20.. with the
  measured blade direction per archetype per pose.
- **C-KNEE (A)** knees displaced outward from the sagittal midline in idle/guard (knee x farther from the midline than
  the hip-ankle line would put it, a few cm, mirrored), feet still planted (slide bands of tests/anim_* stay green).

SPEC numbering: U uses Y30-Y49, P Y1-Y19, A Y20-Y29. Evidence rule: numbers generated by code; screenshots in
`artifacts/qa-wave-y/<lane>/`. Gate per lane: `deno task check`, `deno lint` on your files, your tests + suites touching
your modules, a browser probe for anything visible. Parent runs the full suite and commits.
