# Wave R — verification (measured)

Every number below is a tool's literal output. The ask is in `docs/gen/BRIEF.md` (verbatim transcript +
decode table; one decode FLAGGED).

## 1. One entry, and a generator you can override (lane R-C)

`deno run -A tools/probe-wave-r.ts`, real Chrome, `artifacts/qa-wave-r/probe.json`:

```
entry      entryButtons 1 · profilesButtonsOnTitle 0 · profilesButtonsAnywhere 0
           "⚔ Fighters — Roster and generator on one page — roll, override or save"
           element BUTTON · group title/start/modes (keyboard + screen-reader reachable)
screen     activeScreen select · standaloneProfilesScreenExists false
           rosterBodyInsideSelect true · rosterPanelVisible true · generatorPanelsInSelect 7
roster     rows 1 · "1 saved" · portraitIsPngData true
override   raceChanged true · dependentSubraceFollowed true · dependentInSheetMeta true ·
           headerSummaryLive true
           before "Elf · Wood Elf · Assassin"  ->  after "Human · Imperial · Assassin"
rollAfterOverride nameChanged true
decision   save rows 1 -> 2 (grew) · discard reverted true
viewports  390x844 [] · 820x1180 [] · 1280x800 [] · 1920x1080 []   (no overflow at any width)
errors     []
```

The override is driven by a REAL CLICK on the race card and routed through `CreatorSync.applyEdit`, so the
dependent sub-species follows (wood elf → imperial) and the group header's summary stays honest. One thing
R-C states rather than hides: the dice inside a **closed** `<details>` cannot be clicked (`display: none`),
so the probe drives the always-visible preview-panel dice and opens the Race group with a real click.

## 2. The body: sex, curves, the dwarf, and the pectoral ask that was DROPPED (lane R-A)

**Kept.** A `sex` field on the profile, drawn deterministically from the seed roll (`rng() < 0.5`) and
carried onto the body spec; the female curve narrows the waist and widens the hips and the chest depth:

| race | waist/hip male → female | waist | hip | chest depth |
| --- | --- | --- | --- | --- |
| human | 0.780 → **0.573** | 0.1287 → 0.1030 | 0.1650 → 0.1799 | 0.1077 → 0.1207 |
| elf | 0.760 → **0.558** | 0.0967 → 0.0774 | 0.1273 → 0.1388 | 0.0871 → 0.0975 |
| dwarf | 0.810 → **0.594** | 0.1848 → 0.1479 | 0.2282 → 0.2488 | 0.1330 → 0.1489 |
| ork | 0.886 → **0.650** | 0.2934 → 0.2347 | 0.3313 → 0.3611 | 0.1807 → 0.2024 |

The dwarf's **muscle term went up** (1.090 → 1.120, deltoid radius 0.0933 → 0.0959 m) — fit rather than
wide. The sex curve is scoped to waist/hip/chest-depth and the pelvis depth only: the hip joint, the ankle,
the foot and the heel are **identical** male vs female (asserted in `tests/sex_wire_test.ts`).

**DROPPED, twice, with the numbers.** The dwarf's "less large of shoulders" and the "pectorals a bit more
Obvious" — both could not land:

- **Shoulder over-width:** R-A bisected its own change and measured the planted-foot slide at
  dwarf/mountain = **5.54 mm at 0 %, 5.65 mm at 1 %, 6.42 mm at 4 %, 6.42 mm at 8 %** against a 5.6 mm band.
  **Even a 1 % cut breaches it**, so the ask was dropped and the band was NOT touched.
- **Pectorals:** R-A measured a real gain (human +12.3 mm, dwarf +9.9 mm at the nipple line) and the
  integration **reverted it to neutral**, because measured, ANY depth gain (1.18 and 1.10) breaks FOUR
  ragdoll tests — `mass = body mass`, the light-foot welds, the seeding round trip and the settle — since
  the deeper chest moves the body's volume and the ragdoll derives its segment masses from that body.
  Isolation: with `AnatomyParts.ts` stashed the two ragdoll suites are **ok | 14 passed | 0 failed**; with
  the gain the same suites fail. R-A's own test now pins the dropped state with the reason.

## 3. Hair, eyes and nails (lane R-B)

**Hair now sits on the skull** — the old fall was a single cylinder behind the head that measured **12
vertices INSIDE the skull** (min clearance −0.0112h human, −0.0101h elf, −0.0116h dwarf). After the rebuild
(VERTICAL tube segments, each axis placed behind the deepest skull point over its own y-range):

```
human/-  seed 3/8/15   nearGap 0.0400..0.0925h   inside 0   hairline 7.188h > brow 7.130h
elf/-    seed 3/8/15   nearGap 0.0400..0.0915h   inside 0   hairline 7.337h > brow 7.283h
dwarf/-  seed 3/8/15   nearGap 0.0400..0.0692h   inside 0   hairline 6.385h > brow 6.326h
```

Zero hair vertices inside the head at every ancestry and seed, the band is normalised in head heights (so
it holds at three deliberately different statures), and the hairline stays above the brow everywhere.

**Eyes pop, and are not square**: the iris disc went from 16 edges (**roundness 0.9745**) to 32
(**0.9936**), the globe stays a sphere (0.9668); a wet glint of radius **5.22 mm** at (+0.3r, +0.34r,
squash 0.7) with a 1.74 mm secondary catch-light, against a 17.40 mm globe; and the iris carries **8 painted
flecks** of 1.53 mm (0.16 × iris radius), alternating lighter/darker, placed deterministically from the seed.

**Nails — half delivered, and the gap stated.** The nail pass exists and is measured: plate
`tintHex(skin, 0.24)`, a bounded gloss band `tintHex(skin, 0.42)` at opacity 0.3, covering **89.4 %** of the
264 nail-region vertices. But **no SDF primitive declares region `"nail"`**, so the LIVE generated body
carries no nail vertices: the pass paints the mannequin and nothing else. Adding a nail plate primitive on
each hand is the wave's headline open item (a thin plate in a coarse SDF needs its own resolution work).

## 4. The parent's wires (mine)

- `specFromAppearance` did not copy the profile's sex onto the body spec, so the female curve existed only
  in the maths and **never on the rendered fighter** (lane R-A flagged this as its stated caveat).
  `BodySpec.sex` is now a field and the copy happens; `tests/sex_wire_test.ts` pins it.
- `CreatorSync.applyEdit` had **no case** for `sex` or for the six attributes, so two of the generator's
  override routes were total no-ops (lane R-C flagged this). Both are handled now — the attributes come in
  as the prefixed `allocated.<stat>`, which the exact-name switch could never match, so the prefix is
  handled before the switch and clamped into the game's own band (1..20, rounded). Measured: 4 new tests.

## 5. Gate

| command | result |
| --- | --- |
| `deno task check` | see the wave report |
| `deno test … tests/` | see the wave report |
| `deno lint` | see the wave report |
| `deno task build` | see the wave report |
| `tools/probe-wave-r.ts` | the numbers in §1, 0 page errors |
| `tools/probe-wave-p.ts` | re-run after the merge (the Creator is still one page) |

## 6. Open

- **The nails do not show on generated fighters** (no `nail` region primitive) — the one ask that is
  painted but not yet visible.
- **The dwarf's shoulders are unchanged** and **the pectorals are unchanged**: both measured to move a
  physical property (the foot slide; the ragdoll's mass and skin coverage) before they move a look.
- The `sex` override reaches the *profile* and the body; it does **not** yet reach the saved-for-the-fight
  path beyond what `specFromAppearance` sees, and no test drives a female fighter through a whole match.
- Nothing was looked at with a human eye: every claim here is geometry, counts and a real browser's DOM.