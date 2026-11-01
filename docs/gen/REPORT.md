# Wave R — report

**What you asked** (decode table + verbatim in `docs/gen/BRIEF.md`; one decode flagged): merge the title's
two buttons into one; be able to change the statistics by hand while generating; make the female a bit more
curvy and the dwarves less wide at the shoulder and fitter; keep improving the polygons and the style; fit
the hairstyles to the head and fix the collisions; give the eyes "some glue" so they pop, not square, but
painted; make the pectorals more obvious; paint the fingernails.

**The entry is one button.** Measured in a real Chrome: **1** entry button on the title, **0** Profiles
buttons anywhere, labelled *"⚔ Fighters — Roster and generator on one page — roll, override or save"*, in
the modes group so the keyboard and a screen reader reach it. The old Fight button **is** the merged entry:
it opens the Creator and the roster on that same page (the standalone profiles screen no longer exists), and
the roster now sits beside the generator — on one grid row from 820 px up, stacked at 390 px, with **no
overflow at 390/820/1280/1920**.

**You can change everything by hand.** A real click on the race card changed the fighter
**Elf · Wood Elf · Assassin → Human · Imperial · Assassin** — the dependent sub-species followed, the group
header's summary stayed honest and the stat sheet updated — through one `applyEdit` route. Roll, save and
discard all measured (save took the roster 1 → 2 rows; discard put the race back). Two of those routes were
**dead on arrival**: `applyEdit` had no case for `sex` or for the six attributes, and the attributes arrive
as the prefixed `allocated.<stat>` which its exact-name switch could never match. Both are wired now and
clamped into the game's own band (1–20, rounded) so a hand-set number can't leave a fighter unrunnable.

**The body.** A `sex` field now rides from the roll, through the profile, onto the body spec — and it had a
real gap: `specFromAppearance` wasn't copying it, so the female curve existed only in the maths and never on
screen. Fixed and pinned. The female is measurably curvier — waist/hip ratio **0.780 → 0.573** (human),
0.760 → 0.558 (elf), 0.810 → 0.594 (dwarf), 0.886 → 0.650 (ork) — with fuller hips and chest depth, while
the ankle, foot, heel and leg chain stay byte-identical, as the last two waves require. The dwarf is
**fitter** (muscle 1.090 → 1.120).

**Two asks I dropped rather than shipped broken, both with numbers:**

- **The dwarf's shoulders are unchanged.** Narrowing the shoulder joint moves the planted-foot slide:
  **5.54 mm at 0 %, 5.65 at 1 %, 6.42 at 4 %**, against a 5.6 mm band — even 1 % breaches it. The lane
  bisected this itself and dropped it; the band was not touched.
- **The pectorals are unchanged.** The depth gain was real (human +12.3 mm at the nipple line) and it breaks
  **four ragdoll tests** — `mass = body mass`, the light-foot welds, the seeding round trip and the settle —
  because a deeper chest moves the body's volume, and the ragdoll derives its segment masses from that body.
  I isolated it (with `AnatomyParts.ts` stashed: 14/14 green), dropped it, and re-stated the lane's own pin
  to the dropped state with the reason.

**Hair, eyes, nails.** The hair no longer floats or sinks: the old fall measured **12 vertices inside the
skull** and now measures **0**, with a 0.040–0.093 head-heights clearance band at three ancestries × three
seeds and the hairline above the brow everywhere. The eyes are not square any more (iris 16 → **32 edges**,
roundness 0.9745 → **0.9936**) and they have their **wet glint** (5.22 mm highlight + a 1.74 mm secondary)
plus **8 painted flecks** per iris instead of a flat disc. The nails have their own painted pass (plate
`tintHex(skin, 0.24)`, a bounded gloss at 0.3, **89.4 %** of nail-region vertices) — **but it paints the
mannequin, not your fighters**: no SDF primitive declares the `nail` region, so a generated hand has no nail
vertices yet. That is the one ask that is painted but not yet visible, and it needs a nail plate primitive
per hand.

**Verified by:** `deno task check` 0 errors · **1609 passed / 0 failed** · `deno lint` 542 files 0 problems ·
`deno task build` 1 862 651 B · the R probe (0 page errors, numbers above) · the P probe re-run
(`flat: true`, 7 panels, 16/16 headers carrying values, 0 page errors). Contract `docs/gen/BRIEF.md`;
spec §11J; evidence `artifacts/gen/VERIFICATION.md`.

**Open, plainly.** The nails show on the mannequin only. The shoulders and the pectorals are unchanged, for
measured reasons. No female fighter was driven through a whole match. And nothing here was judged by a human
eye — every claim is geometry, a count, or a real browser's DOM.
