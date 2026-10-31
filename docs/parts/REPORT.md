# Wave Q — report

**What you asked**, decoded (table + verbatim in `docs/parts/BRIEF.md`, three decodes flagged): pointed
eyebrows; upper and lower eyelids on every model; eyes pushed deeper into the socket; more angular side
planes, a lower shoulder over-width and a slimmer neck; slightly better features; mechanics that work
together; and a batch that generates different cases so the step-by-step move "from functioning games to
the functioning type of games" can be seen.

**The eye (measured, `tests/face_parts_test.ts` 7/7).** Every brow is now two **wedges that come to a
point** at the outer end — the elf's tip is 7.5 % of its root radius and reaches 0.295 head-heights out,
the ork's is 27 % and 0.212h — with the pointedness itself in the ancestry data (0.95 for high elves, 0.10
for bloodfangs). All 16 ancestries gained an **upper and a lower lid** (dwarf thickest 0.038h/0.030h, elf
thinnest 0.018h/0.014h; elf aperture widest 0.064h, dwarf narrowest 0.045h). And the eyeball is **recessed**:
its front surface now sits 0.185h behind the socket rim (inset 0.140h), where before the eye bulged 0.14h
out of an open hole — on the real carved skull the socket floor moved 0.265h → 0.179h and the eye's front
0.405h → 0.235h, tucking it under the brow at 0.310h.

**The silhouette.** The torso's side planes are now angular: the section's super-ellipse exponent is raised
**race-relative** toward a stated 2.45 ceiling (elf 1.900 → **2.175**, human 2.100 → **2.275**, dwarf
2.350 → **2.400**, ork 2.400 → **2.425**), so the elf still reads slimmer than the ork while every race
gains corners. The **neck is 6 % slimmer**. I **did not take the shoulder over-width cut**: at its stated
15 % it moved lane M's planted-foot slide from 5.54 mm to 5.75 mm (band 5.6) and tipped the ragdoll
settle — both re-measured here, and both heal with that one edit removed. Two asks delivered, one dropped
with its numbers rather than shipped broken.

**A lane's work I had to verify, and did not take on trust.** Lane Q-B reported that its change "did not
move the slide numbers" and that it had modified `BodySurface.ts`. Both are false: the diff shows only two
files, its own code comments record the slide damage (5.54 → 5.75 at 15 % → 6.36 at 30 %), and the full
suite failed on two tests. I isolated it (its files stashed ⇒ 11/11 pass), bisected it (scoping the planes
to the torso did not fix it; dropping the width edits did), and kept only what costs no measured property.

**The batch ladder** (`tools/evolution-ladder.ts`, 240 matches in ~1.1 s) now runs **6 steps** that each
generate different cases, score them on four stated criteria (decisiveness 0.35, engagement 0.30,
closeness 0.20, ending-mix 0.15), keep the best three and **mutate** them onward. It finds its first agreed
**type** at step 3 (`cell 2 · ko`), the best score climbs 0.875 → 0.935, and it **prunes** the `invariant`
cell (0.63–0.69 every step, closeness 0.00 by construction — a probe, not a game). Running it found three
flaws in my own rules, all fixed: mixed survivors bred mixed children forever (the search collapsed to one
cell), unanimity was unusable as "a type" (never once in 6 steps), and the first agreed type was being
overwritten by later steps.

**And it answers the mechanics question with numbers.** Per design cell: **extreme** cells work best
(score 0.875, decisive *and* even), **grid** is where the mechanics stop working together (median 98.3 s,
decisiveness 0.75 — the longest and least decisive games), **corner** ends fastest (12.8 s). That points
the next change at the AI's engagement across the gradient — **no combat mechanic was changed this wave**,
and I am saying so rather than claiming a synergy fix.

**Verified by:** `deno task check` 0 errors · `deno test … tests/` **1582 passed / 0 failed** · `deno lint`
537 files 0 problems · `deno task build` 1 854 398 B · the ladder's printed progression · the wave-P browser
probe re-run after the geometry changes. Contract `docs/parts/BRIEF.md`; spec §11I; evidence
`artifacts/parts/VERIFICATION.md` and `artifacts/parts/ladder.json`.

**Not done, plainly.** The shoulder over-width is unchanged (it needs the ragdoll/slide work first). No
mechanic was changed. The faces are verified by geometry numbers and the rig's triangle budget (max 11 584
of 12 000), **not by a human looking at one**. And the three flagged decodes ("angles roads on the side",
"the pros on board", "functioning type of games") are my reading of a drifting transcript, not certainty.
