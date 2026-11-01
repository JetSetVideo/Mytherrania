# Wave R — one entry to the generator, curves, nails, eyes that pop, and a dwarf who is fit not wide

**The ask, verbatim.**

> "Keep on improving the generator, the profile system. so right now there are two buttons, the hero warrior
> buttons and the profiles button and they should be merged together on the page and I should have the
> possibility to generate and during the generation I should have the ability to basically change the
> statistic manually pour exemple change de race manually or those type of things. and I want you to keep on
> improving the character generator to make the female a bit more curvy and to make the dwarves a bit less
> large of shoulders and have a bigger fit and keep on improving the polygons and the style of the
> characters, you know, the drawings. and it's going the right way, but it needs to be improved a bit, like
> the hairstyles and how they fit with the head, the collision systems and the faces and the eyes. Give some
> glue to the eyes to make them pop, don't make them square, you know, make them like painted, but with like
> the dates and stuff and yeah, keep on improving being made the some of the most like the pectorals a bit
> more Obvious and paint the nails on the fingers and keep on improving everything."

**Decoded** (spoken → decoded → where it lands). FLAG marks what I inferred.

| spoken | decoded | flag | lands in |
| --- | --- | --- | --- |
| "two buttons, the hero warrior buttons and the profiles button … merged together on the page" | ONE entry on the title: a single **Fighters** button that opens the roster AND the generator on one page (the profiles panel and the Creator's doorway are no longer two buttons) | — | lane R-C |
| "during the generation … change the statistic manually … change de race manually" | the generator is a GENERATE + OVERRIDE flow: after the dice, every parameter (race, sub-species, class, weapon, sign, the six attributes, height/weight, name) is editable in place, with the dice as one button among the fields and an explicit save/discard | — | lane R-C |
| "make the female a bit more curvy" | a SEX field on the character with a female build: narrower shoulders, a narrower waist relative to the hips, a fuller chest and hips — measurable in metres, and *slight* ("a bit") | — | lane R-A |
| "make the dwarves a bit less large of shoulders and have a bigger fit" | dwarf shoulders NARROWER and the dwarf FITTED (more muscular, less barrel): shoulder half-width down, muscle term up, on the dwarf rows and sub-species | — | lane R-A |
| "the pectorals a bit more Obvious" | the pectoral masses gain depth (a stated increase in their SDF radius/offset), measured on the torso's front surface | — | lane R-A |
| "keep on improving the polygons and the style … the drawings" | triangles go to the budget only where they buy silhouette (no budget increase without a measured reason), and the painted stack gains definition where the new anatomy is | — | lanes R-A + R-B |
| "the hairstyles and how they fit with the head … the collision systems" | a hairstyle must SIT on the skull: the fall is fitted to the head's own surface (no floating cap, no hair inside the skull, no hair through the brow), asserted as a distance to the head surface; the beard/crest follow | — | lane R-B |
| "Give some glue to the eyes to make them pop, don't make them square … make them like painted … with like the dates and stuff" | the eye gets a WET GLINT (a specular highlight that reads as moisture), the globe is ROUND (not a faceted square), and the iris/pupil are PAINTED with fine marks (a fleck/ring texture) rather than a flat disc | **FLAG**: "the dates" is a mis-hearing — I read it as *fine painted marks (freckles/flecks)* on the iris | lane R-B |
| "paint the nails on the fingers" | the nails exist in the paint regions but carry no distinct paint: give them their own painted pass (lighter, glossier, a stated colour relation to the skin) | — | lane R-B |
| "keep on improving everything" | no redesigns: every change is a stated number before → after, with the triangle budget and the existing tests held | — | all |

House rules binding every lane: pure modules where the logic lives, TDD, comments say WHY with units,
no `any` without a scoped ignore, never an inline `style="…"` (the CSP blocks it), a claim without a tool's
literal output is not evidence, and a bound a deliberate change makes false is re-stated from measurement
with the reason written where the bound lives — never deleted. **Two lanes must not both edit
`src/graphics/body/Proportions.ts`**: R-A owns it; R-B asks R-A's file for nothing and works through
`FaceParts.ts`, `paint/**` and the ancestry data.

---

## Lane R-A — sex, curves, the dwarf, and the pectorals

**Owns:** `src/game/Characters.ts` (the `sex` field), `src/game/BodyProfile.ts`,
`src/graphics/body/Proportions.ts`, `src/graphics/body/AnatomyParts.ts`,
`src/graphics/paint/Recipes.ts` (only the definition pass for the new anatomy), `tests/sexbuild_test.ts` (new).

1. **A SEX field** (male/female) on the character profile and the body spec, defaulted deterministically by
   the roll (not `Math.random`), carried through `proportionsFor` and saved with the profile.
2. **Female curves**: shoulders narrower, waist narrower relative to the hips, chest and hips fuller — each a
   stated multiplier, measured in metres against the male body of the same race/height/weight (before →
   after for at least human, elf, dwarf, ork).
3. **The dwarf**: shoulder half-width down by a stated fraction; the muscle term UP so the dwarf is fit
   rather than wide (measured: shoulder half-width and the deltoid/chest radii before → after).
4. **The pectorals**: the chest masses gain depth, measured on the torso's front surface at the nipple line
   (a computed offset in metres) — "a bit more obvious", not a redesign.
5. Hold the wave-P/Q invariants: the fit/bulky/heavy builds keep `bulky` as the neutral 1.0 reference, the
   ground-contact geometry (ankle/foot/heel) stays out of every new multiplier, and the triangle budget is
   not raised.

**Evidence:** literal `deno check`; the new test's pass count; the pre-existing body/rig tests you ran (list
with counts, all green); `deno lint`; the printed male-vs-female table (4 races), the dwarf before/after
table, and the pectoral depth in metres; plus the anim_measure slide numbers if they move (paste them).

## Lane R-B — hair that sits on the head, painted eyes with a glint, and nails

**Owns:** `src/graphics/body/FaceParts.ts`, `src/graphics/paint/Recipes.ts` (eye + nail passes only),
`src/graphics/paint/Layers.ts` if a layer kind is needed, `tests/hair_eyes_nails_test.ts` (new).

1. **Hair fits the head**: for every ancestry and at least 3 seeds, the hair's fall sits ON the skull — a
   stated clearance band (never inside the skull, never floating off it by more than a stated gap), and the
   hair does not cross the brow line. Assert with numbers derived from the head's own surface, not a
   screenshot. Give the styles a fit parameter if they need one, and say what it is in head heights.
2. **Eyes that pop**: the globe stays ROUND (assert its cross-section is not faceted — a stated roundness
   measure), a WET GLINT highlight is painted on it, and the iris gains fine PAINTED marks (a fleck/ring
   texture with stated density and size in mm on the eye's own scale) instead of a flat disc.
3. **Nails**: a painted pass of their own — a stated colour relation to the skin (the paint stacks' existing
   `shadeHex`/`tintHex` helpers), a gloss, and a size/position assertion that the nail region actually
   receives it (measured as the share of nail-region texels the pass covers).

**Evidence:** literal `deno check`; the new test's pass count; the pre-existing paint/face tests you ran
(list with counts, all green); `deno lint`; the printed clearance/gap table for 3 ancestries × 3 seeds; the
roundness, glint and iris-fleck numbers; and the nail coverage share.

## Lane R-C — one entry, and a generator you can override

**Owns:** `src/ui/Menu.ts`, `src/ui/UiTree.ts`, `src/ui/ProfilePanel.ts` (layout only), `styles.css`,
`tools/probe-wave-r.ts` (new), `tests/menu_entry_test.ts` (new).

1. **One button.** The title's `[data-action="profiles"]` (≡ Profiles) and `[data-action="start"]` (⚔ Fight)
   become ONE entry that opens the roster **and** the generator on one page — the profiles panel and the
   Creator are the same screen, with the roster on it and the generate/override controls beside it. Keep a
   keyboard- and screen-reader-reachable path to the fight start (the modes group), and say in the report
   what the old Fight button now does.
2. **Generate + override.** After a roll, every parameter is editable in place: race, sub-species, class,
   weapon, birthsign, the six attributes, height, weight, sex (once R-A lands), name — through the existing
   tree groups, with the dice button present among them and the save/discard decision explicit. An override
   must go through `CreatorSync.applyEdit` so the dependent parameters synchronise; if a control writes
   directly instead, route it — that was wave P's open item.
3. **The probe must measure it**: one entry on the title, the roster visible on the same screen as the
   generator, an override applied by a real click changing the profile (race changed by hand), a roll after
   the override, the save/discard decision, no clipping at 390/820/1280/1920 px, and 0 page errors.

**Evidence:** literal `deno check`; the new test's pass count; the pre-existing menu/UI tests you ran (list
with counts, all green); `deno lint`; the probe's printed JSON (the numbers above) and the four viewports.

## Parent

`src/engine/Engine.ts` (the merged entry's wiring, the override→applyEdit route, the sex field's roll),
`tools/probe-wave-r.ts` (run, not written by the parent), `docs/SPEC.md` §11J, `docs/gen/REPORT.md`,
`artifacts/gen/VERIFICATION.md`, `artifacts/data-science.md`, the gate, the commit.

## Acceptance

1. One entry to the generator on the title, with the roster and the generator on the same page.
2. Every parameter is manually overridable after a roll, and an override synchronises its dependents.
3. Female is measurably more curvy; the dwarf is measurably narrower at the shoulder and fitter; the
   pectorals are measurably deeper; the nails and the eyes are measurably painted; the hair measurably sits
   on the head — each with before → after numbers.
4. `deno task check` 0 errors · the full suite green · `deno lint` clean · `deno task build` · the R probe
   green and the wave-P probe re-run green.