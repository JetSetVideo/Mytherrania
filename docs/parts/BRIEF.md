# Wave Q — the faces get lids and recessed eyes, the silhouette gets angles, and the batch learns in steps

**The ask, verbatim.**

> "We keep on improving the 3D models and the different parts. So for example, the eyebrows for the head,
> they should be like pointy. All the models, they need upper and lower eyelids. and they need to have their
> eyes push a bit inside the model because now they all have … that way to open … improve the animation by
> putting a bit more angles roads on the side, the pros on board, reduce the shoulder over whites of the and
> their neck and improves slightly the and its features overall it's pretty good but you … They also need to
> improve the game mechanics and how they work together. about the generating process by batch. it needs to
> generate different cases and the to see how step-by-step we go from functioning games to the functioning
> type of games. Thank you."

**Decoded** (spoken → decoded → where it lands). FLAG marks what I inferred rather than heard.

| spoken | decoded | flag | lands in |
| --- | --- | --- | --- |
| "the eyebrows for the head, they should be like pointy" | brows become a POINTED wedge — an angled ridge that comes to a point at the outer end — instead of a round capsule | — | lane Q-A |
| "All the models, they need upper and lower eyelids" | every model gets a real UPPER and LOWER lid: a lid band over and under the eye, thick enough to read at portrait distance, with the ancestry able to vary its weight | — | lane Q-A |
| "their eyes push a bit inside the model because now they all have … that way to open" | the eyeball is RECESSED into the socket (inset behind the lid line) instead of bulging out of an open hole | — | lane Q-A |
| "putting a bit more angles roads on the side" | the side profile gets more ANGLES — flatter planes and fewer round sweeps (the "roads" are the silhouette's sweeping curves) | **FLAG** | lane Q-B |
| "the pros on board" | side planes ("pros" → planes); read together with the line above as *angular side planes* | **FLAG** | lane Q-B |
| "reduce the shoulder over whites of the … and their neck" | the shoulder OVER-WIDTH (the overhang beyond the ribcage) comes down, and the NECK gets slimmer | — | lane Q-B |
| "improves slightly the … features overall it's pretty good" | a SLIGHT refinement of the features, not a redesign | — | lane Q-A (face) + Q-B (silhouette) |
| "improve the game mechanics and how they work together" | mechanics that INTERACT: state the synergies between the systems that already exist (cast, concealment, autoattack, pushback, resources, kiting, terrain) and measure at least one synergy that the recorded numbers did not show before | — | parent |
| "the generating process by batch. it needs to generate different cases and … step-by-step … from functioning games to the functioning type of games" | the batch stops being N independent matches: it becomes a LADDER of generations — each step generates a set of different cases, scores them against stated criteria, keeps what works and carries it into the next step, so the output reads as a progression from "a game that runs" to "a type of game that works" | **FLAG**: "functioning type of games" is read as *a game archetype/type that plays well* | parent |

House rules binding every lane: pure modules where the logic lives, TDD, comments say WHY with units,
no `any` without a scoped ignore, never an inline `style="…"`, a claim without a tool's literal output is
not evidence, and a bound a deliberate change makes false is re-stated from measurement (with the reason
written where the bound lives, never deleted).

---

## Lane Q-A — the eye: pointed brows, upper and lower lids, a recessed eyeball

**Owns:** `src/graphics/body/AnatomyParts.ts`, `src/graphics/body/FaceParts.ts`,
`artifacts/design/ancestry.json` (a `lid` block and a `brow.point`-style measure per node),
`src/game/Ancestry.ts` (expose + validate them), `tests/face_parts_test.ts` (new).

**Requirements.**

1. **Pointed brows.** The brow ridge is no longer a round capsule swept across the face: it is a wedge whose
   outer end comes to a POINT (a stated taper: the ridge's radius at the inner end vs ~0 at the outer tip,
   with the tip's position stated in head heights). The ancestry's `brow.prominence`/`brow.thickness` still
   drive it, and the pointedness itself is a data field (a pointed brow on an elf is not a pointed brow on
   an ork).
2. **Upper AND lower lids.** A lid band over and under each eye, present on EVERY ancestry, with a stated
   thickness in head heights and a stated lid aperture (how far the lids open). Ancestry data varies the
   lid weight and the aperture, and the validation refuses a node without them.
3. **The eyeball is recessed.** The eyeball's centre sits BEHIND the socket's opening plane (a stated inset
   in head heights), and the lid band overlaps the eyeball so no gap shows. Assert the inset is positive and
   that the eyeball's front surface is behind the socket rim (both numbers in head heights).
4. **Slight feature refinement**: the socket, cheek and nose are adjusted only as far as the new lids and
   brows require — no redesign, and the pre-existing face tests stay green.

**Evidence required in the report:** literal `deno check`; the new test file's literal pass count; the
pre-existing face/head tests you ran (list them with pass counts, all green); literal `deno lint`; and the
printed tables: per ancestry, brow taper start/end radius and tip position; lid thickness and aperture;
eyeball inset and eyeball-front-vs-rim; plus the socket/cheek/nose numbers before and after.

## Lane Q-B — the silhouette: angular side planes, a lower shoulder overhang, a slimmer neck

**Owns:** `src/graphics/body/Proportions.ts`, `src/game/BodyProfile.ts`, `tests/silhouette_planes_test.ts` (new).

**Requirements.**

1. **Angular side planes.** The torso's side profile must read as FLAT PLANES with corners rather than one
   round sweep: expose a measure of that (e.g. the section's superellipse exponent / corner measure at named
   heights, or the ratio of the section's corner radius to its half-width) and raise it by a stated amount at
   named heights, race-relative (an elf stays slimmer than an ork, but every race gains the corners).
2. **Shoulder over-width down.** The shoulder JOINT's overhang beyond the ribcage (`SHOULDER_OVERHANG` and
   the `Math.max(...)` that sets `halfWidth.shoulderJoint`) is reduced by a stated fraction, measured as the
   shoulder's half-width at its named height, race by race (before → after).
3. **Slimmer neck.** The neck's half-width is reduced by a stated fraction, measured likewise.
4. Nothing else moves: the leg/arm chains, the build multipliers and the ground-contact geometry stay put,
   and the pre-existing body/rig/animation tests stay green — if a bound moves by more than noise, say the
   number and the reason.

**Evidence required in the report:** literal `deno check`; the new test file's literal pass count; the
pre-existing body/rig/anim tests you ran (list them with pass counts, all green); literal `deno lint`; the
printed before/after table for shoulder half-width, neck half-width and the corner/plane measure at the
named heights for at least 4 ancestries; and the `anim_measure` slide numbers if they move.

## Parent — mechanics that work together, and a batch ladder instead of a batch

**Owns:** `src/balance/Ladder.ts` (new), `tools/evolution-ladder.ts` (new), `tests/ladder_test.ts` (new),
`src/ui/BatchPanel.ts` (only if the panel must surface a ladder), `src/engine/Engine.ts`, `docs/SPEC.md`
§11I, `docs/parts/REPORT.md`, `artifacts/parts/VERIFICATION.md`, `artifacts/data-science.md`, the commit.

1. **A ladder of generations.** A pure module that runs N STEPS; each step generates a set of DIFFERENT
   cases from a stated seed rule, scores them against stated criteria (decisiveness, engagement, closeness,
   ending mix), keeps the best and carries their parameters into the next step, and returns the whole
   progression with per-step numbers and the surviving lineage. Run headless on the existing `MatchSim`/
   `Batch` machinery (`src/balance/Batch.ts`, `EvolutionHarness.ts`, `Summary.ts` are available) — no
   browser needed for the measurement.
2. **A mechanics-synergy statement + one measured change.** State which mechanics interact and how, then
   make ONE change that makes a stated pair work together better, measured before/after over a batch (the
   number that must move is named in advance).

## Acceptance

1. Every model has upper and lower lids and a recessed eyeball, the brows are pointed, and the ancestry data
   drives both — verified by numbers in head heights and by the pre-existing face tests staying green.
2. The side planes are measurably more angular, the shoulder over-width and the neck are measurably down.
3. The batch produces a LADDER: a printed progression of steps with per-step criteria and the surviving
   lineage, from a game that runs to a type of game that works.
4. One mechanics synergy is stated and measured.
5. `deno task check` 0 errors · the full suite green · `deno lint` clean · `deno task build` · a real-browser
   probe re-run for the head (the parts must not have broken the rig).
