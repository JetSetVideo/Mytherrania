# Wave H verification — measured, 2026-10-31

Gate on the integrated tree (`deno task check` 0 errors, `deno task test` 1201/1201, build 1 697 366 B,
`deno run -A tools/probe-wave-h.ts` 0 page errors). Every number below is a literal value printed by a
tool in this repo; nothing here is an estimate.

## 1. The gate

| Command | Result |
| --- | --- |
| `deno task check` | 0 errors (all of `src/`, `tools/`, `main.ts`) |
| `deno task test` | `ok | 1201 passed | 0 failed (1m34s)` |
| `deno test tests/spec_test.ts` | `ok | 28 passed | 0 failed` — 10 of them new Wave H pins |
| `deno task build` | `Built local browser bundle: 1697366 bytes` (204 modules; the ancestry JSON bundles) |
| `deno lint` | 1 error, **pre-existing on HEAD** in `tools/probe-anim.ts:10` (`no-import-prefix`, the `jsr:@std/encoding` import added by the previous commit — not this wave) |
| `deno run -A tools/probe-wave-h.ts` | 0 page errors; screenshots in `artifacts/qa-wave-h/report.json` + 3 PNGs |

## 2. Live evidence (`tools/probe-wave-h.ts`, real Chrome, `artifacts/qa-wave-h/report.json`)

### 2.1 The ancestry lore panel renders the hierarchy and changes with the race

```
panelPresent: true   elfHasSkinHairBeard: true   orkMentionsTusks: true
orkMentionsChin: true   elfMentionsThinMoustache: true   panelsDiffer: true
```

Literal excerpts from the live DOM:

- **High Elf** — `crease / under-eye, cheek-fold, neck, joint · crease strength 60%`; `verylong · curl 15% ·
  bald chance 0%`; beard `moustache-thin`; skin swatches and hair swatches filled from the palette.
- **Greenhide (ork)** — `crease / joint, knuckle, neck, brow · crease strength 40%`; `short · curl 65% ·
  bald chance 55%`; beard `chin (optional)`; tusks `2 · up`.

That is the user's own list, item for item: the elf's bluish darkening "under the eyes, under the cheeks",
the elf's thin moustache and total absence of baldness, the ork's chin-only growth and pair of tusks.

### 2.2 A spectated match is generated, logged, and shows on the card

```
Spectator card GEN-17A40B
  Level 4   30 stat points
  Level 15  96 stat points
  81 m arena   seed 2446590167
  warrior-dash · warrior-crushing-blow · warrior-bulwark · barbarian-skullsplitter · mage-arcane-nova · rogue-shadowstep · necro-bone-armor
```

Levels differ, the budgets differ, the methods unlocked by the spent stats differ, and the arena size is
drawn with them. The same card's `generation.seed` and id are written onto the match record.

### 2.3 The time limit ends a match as a TIE, with the stat gap and the generation in the log

A spectate match run with a 30 s limit (the QA floor: `resolveTimeLimit` clamps into `[30, 240]`):

```
limitApplied 30   hostileAtEnd 30.01   winner null
storedReason "time-limit"   storedTie true   resultTitle "Draw — time limit"
statGapDistance 2.086σ   dominance 0.214   damageShare 0.44
generationId GEN-8E3A8B   generationAncestry ["elf/high", "human/imperial"]
```

The bell fired exactly at the limit (30.01 s of **hostile** time — the 6 s truce is not charged), nobody was
given the win, and the stored record carries how far apart the two builds were and which generation they came
from. An earlier run at the same code produced `statGapDistance 4.85σ, dominance 0.53` on a different pair —
the number moves with the builds, which is the point of recording it.

### 2.4 The hair solver is driven by the weather, in the live game

The skinned rig the game actually renders exposes **5 movable masses** per fighter (hair fall, its lobes, the
crest, the beard). Measured displacement of the mass, with the solver's own wind input beside it:

| Regime | Wind (m/s) | Wetness | Displacement (m) |
| --- | --- | --- | --- |
| clear | 4.50 | 0.00 | **0.0731** |
| storm | 12.00 | 0.90 | 0.0749 |
| storm, 4 s later | 12.00 | 0.90 | 0.0735 (settled: within 2 % of the previous sample) |
| lull | 3.69 | 0.02 | **0.0627** |

Three facts fall out of those numbers, and they are the three the brief asked for: the mass **moves with the
wind** (0.0627 m in the calmest air, 0.0731 m at 4.5 m/s), it is **bounded and settles** (never near the 1 m
clamp; two samples 4 s apart agree), and it **holds its shape in the rain** (a 2.7× stronger wind moves it no
further, because the soaked mass is heavier and damper — the `wetness` term in the solver).

## 3. Two mismatches found by measuring instead of assuming

1. **The secondary masses were built into a rig the game does not use.** The engine renders
   `buildSkinnedHumanoid`; the movable hair/beard nodes had been attached only to `buildHumanoid`. The probe
   read `masses: 0` and the solver never ran. Fixed by returning the movable nodes from `FaceParts` through the
   skinned rig (`FaceRig.secondary` → `HumanoidRig.secondaryMasses`). The brows are deliberately NOT in that
   list: the facial morph owns their transform every frame (DESIGN.md item 12), and two writers on one node is
   the bug the animation-tensor work already hit once.
2. **A unit mismatch made every mass pin against the clamp.** `Ancestry.hairPhysics.stiffness` was written on a
   0.25–0.85 scale while the solver's own default is 120 (equilibrium offset `x = windGain · wind / k`). A 5 m/s
   breeze asked for a 7-metre displacement, so the offsets saturated at the 1 m box and the "calm vs storm"
   reading was meaningless. The 16 stiffness values were rescaled ×200 (ordering preserved, verified pairwise:
   0 violations) and `damp` set from a damping ratio of 0.5 (`c = √(k·m)`, which preserved the original damp
   ordering as well). Equilibrium displacement is now 2–7.5 cm at an 8 m/s wind.

Both were invisible in a screenshot and in a unit test; both showed up the moment the live solver's inputs and
outputs were printed side by side.

## 4. Honest gaps (not claimed as done)

- **The techniques the stats unlock are recorded and displayed, not bound to input slots.** A spectator fighter
  still presses three class skills in combat; the extras appear on the card, in the generation block and in the
  log. Binding 4–6 skill slots to the HUD is a separate change to `SkillBar`/`SkillRuntime`.
- **The spectator card's arena size is clamped** into the live arena band (`[34, 120] m`) like every other size,
  so a card drawn at 14 m plays at 34 m. The record logs the size actually used.
- **The brows have no secondary motion** (see 3.1) — they are morph-driven instead.
- **No frame-cost measurement was taken for the solver in this wave.** The probe shows it converges in 5 masses
  per fighter with no allocation in `step()` (unit-tested), but `tools/frame-budget.ts` was not re-run, so no
  before/after CPU number is claimed here.
- **The hair's look at gameplay distance was not judged by eye.** The numbers say the mass moves; whether 7 cm
  reads as "wind in the hair" at a third-person camera distance is a visual judgement nobody has made yet.
  Screenshots for that judgement are in `artifacts/qa-wave-h/`.
