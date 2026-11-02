# Wave X — brief (frozen contract)

Repo: `~/Desktop/Mytherrania` (Deno 2, Three.js 0.180). Read `~/.hermes/skills/software-development/mytherrania-wave/SKILL.md`
pitfalls before touching code (the game renders `buildSkinnedHumanoid`, not `Humanoid.ts`; CSP blocks inline `style=`; etc.).

The user's ask (voice-transcribed, decoded): a 3D arena fighter for mobile + mouse/keyboard + gamepad. This wave:

1. UI-wide value colouring: positive numbers green, shading through neutral to red for negatives.
2. Some tiles centred.
3. Name generator flavoured by race/sub-race phonology.  **DONE in parent** (`src/game/NameGen.ts`).
4. Agility added as an attribute and bound to all techniques and animations.  **Plumbing DONE in parent**; bindings = lane L.
5. Willpower renamed Focus.  **DONE in parent** (repo-wide; `WIL` -> `FOC`).
6. Game logic influences "upward, downward and sideways" (attribute -> derived; ancestry/class/sign -> attribute; attribute <-> attribute).
7. Roll / reroll a character, tweak every number individually or choose parameters, model refreshes instantly within limits.
8. Viewer: a pedestal base (SAME size for every model; the camera distance derives from its radius) with a shadow under the model and the main light above.
9. Viewer box top: race + sub-race on a forged-steel sign.
10. Feet point a bit more outward by default.
11. Bodies: more deltoid (higher than the clavicle, small valley between), more visible abs, slimmer overall; a fat belly only in RARE generations, frequency Dwarves > Orks > Humans > Elves, elves practically never.
12. Male crotch bulge clearly visible.
13. Better skin textures and definition.
14. Hair grown from follicle placements on the skull, then grown, cut, braided; textured with shade variation; grey for elders.

## Already landed (commits 0a040fe, 067f3b0) — build on these, do not redo

- `StatName` = vitality | resilience | focus | reflex | strength | intelligence | **agility**; `CombatStats.agility` required.
  Class/race/sub-race agility values in `Leveling.ts` (CLASS_BASE, RACE_MODS, SUBRACE_TWEAKS), `Stats.ts` PRIMARY, `Races.ts`.
  Agility currently changes NO derived number (statDelta passes it through) — lane L binds it.
- `src/game/NameGen.ts`: `generateName(rng, race, subrace, sex): string`, `givenName`, `familyName`, `PHONOLOGY`.
- `src/game/Age.ts`: `LIFESPAN`, `lifeFraction`, `lifeStage(race, years)`, `greyFraction(race, years)` (0..~0.92),
  `ageBounds(race)`, `rollAge(rng, race)`. `Appearance.age?: number` (years; unset = young adult).
- `tools/build.ts` honours `BUILD_OUT=<dir>`: **lanes build into their own dir** (`BUILD_OUT=dist-<lane> deno task build`) and
  serve it with `serveAsset(req, "dist-<lane>")` so parallel probes never clobber `dist/`.

## Lanes and file ownership (DISJOINT — touch nothing outside your list; read anything)

| lane | owns |
|---|---|
| **L — logic** | `src/game/**` EXCEPT `NameGen.ts`, `Age.ts`, `BodyProfile.ts`, `RaceAppearance.ts`, `Characters.ts`; `src/balance/**`, `src/combat/**`, `src/physics/**`, `src/engine/Engine.ts`; `src/game/anim/**` (incl. foot turnout); tests for these; `docs/wave-x/LOGIC.md` |
| **U — UI** | `src/ui/**`, `styles.css`, `index.html`, `tools/probe-ui-all.ts`, new `tools/probe-wave-x-ui.ts`, `tests/ui_*`, new `tests/wave_x_ui_test.ts`; `docs/wave-x/UI.md` |
| **B — body + viewer** | `src/graphics/**` EXCEPT `src/graphics/body/FaceParts.ts` and new `src/graphics/body/Hair*.ts`; `src/game/BodyProfile.ts`, `src/game/RaceAppearance.ts`; tests for these; new `tools/probe-wave-x-body.ts`; `docs/wave-x/BODY.md` |
| **H — hair** | `src/graphics/body/FaceParts.ts`, new `src/graphics/body/Hair*.ts` (e.g. `HairFollicles.ts`, `HairGrowth.ts`, `HairMesh.ts`), new `tests/wave_x_hair_test.ts`, new `tools/probe-wave-x-hair.ts`; `docs/wave-x/HAIR.md` |

If you need a change in a file you do not own, write it to `artifacts/messages-wave-x-<lane>.md` (what, where, why) and work around it.
Parent integrates. Do NOT `git commit` (parent commits). Do NOT run `git add -A`/`git stash`/`git checkout` of others' files.

## Cross-lane contracts

- **C-AGI (L)**: export from `src/game/Agility.ts` a pure `agilityFactors(agility: number)` returning at least
  `{ animSpeed, moveSpeed, dodge, recovery, turnRate }` — dimensionless multipliers, 1.0 at agility 10, monotone, clamped
  (e.g. animSpeed in [0.85, 1.2]). U may display them; L wires them into MotionStyle/SwingDriver/movement/techniques.
- **C-INFL (L)**: export from `src/game/Influence.ts` a pure, data-only `INFLUENCES: readonly Influence[]` with
  `interface Influence { from: string; to: string; sign: 1 | -1; weight: number; why: string; dir: "up" | "down" | "side" }`
  ("down" = ancestry/class/sign/level -> attribute; "up" = attribute -> derived stat/animation/technique; "side" = attribute
  <-> attribute or derived <-> derived trade-offs). Every edge must be TRUE in code (a test perturbs `from` and observes `to`
  move with `sign`). U may render it as a read-only panel.
- **C-TONE (U)**: `src/ui/ValueTone.ts` pure `toneFor(value: number, o?: { neutral?: number; span?: number }): string`
  (css colour; green above neutral, red below, neutral-grey at it, smooth). Every signed delta/modifier/bonus on screen uses it.
- **C-PREVIEW (B)**: the viewer keeps its public API. B adds the pedestal (constant radius `PEDESTAL_RADIUS` exported from
  `src/graphics/PreviewScene.ts`; camera distance = f(PEDESTAL_RADIUS), not of the model's height), a contact shadow, and a key
  light from straight above. U owns the DOM sign around the viewer; B must not add DOM.
- **C-AGE (H, B, U)**: read `appearance.age` only through `Age.ts`. U adds an Age control (bounds from `ageBounds`) and the roll
  draws `rollAge`; H greys hair by `greyFraction`.
- **C-SEX**: `appearance.sex` ("male" default). B's crotch bulge is male only.

## The gate (parent runs all of it; lanes run the targeted parts)

```
deno task check   # 0 errors
deno lint         # 0 problems
NO_COLOR=1 deno test -A <your tests>   # lanes: your files only (~full suite is 4.5 min; parent runs it)
BUILD_OUT=dist-<lane> deno task build && deno run -A tools/probe-wave-x-<lane>.ts   # real Chrome evidence
```

Evidence rules: a claim needs a tool's literal output. Probe screenshots go to `artifacts/qa-wave-x/<lane>/`.
Pin new cross-module bounds in your own test file as `SPEC Xn: ...` (X1/X2 are taken by names/age; L uses X10-X29,
U X30-X49, B X50-X69, H X70-X89). Pin relationships and measured bands, not literals.
Report: your lane doc in `docs/wave-x/` with what changed, the measured numbers (generated by code, not typed), and honest gaps.
