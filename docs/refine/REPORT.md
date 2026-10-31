# Wave P — report

**What you asked**, decoded (the full table with the verbatim transcript is in `docs/refine/BRIEF.md`):
keep refining the last wave — centre and align the menus, give them clearer structure; stop making the user
click from panel to panel by showing each group's **main values** and opening it only for the detail; frame
the 3D viewer from the character's **own maximum height** and let the user **turn it by hand** (mouse,
finger, joystick); let a rolled fighter be **edited**, then **saved or not** as a decision, with its
**generation seed** kept so the network and the id system still recognise the same idea; synchronise what an
edit drags along; make the **ink outline subtle and angle-dependent** with a real **manga** shading equation;
build **facial ratios** into ranked hierarchies across the ancestry; make the bodies **bulkier and
cartoonish, with anatomy and painted definition**; and fix the **bow** (its tip must close around the
arrow), the **sword's guard**, and the **materials**.

**Where / what.**

- **The Creator is one page.** The panel tabs are gone: all six panels are visible together, in a
  responsive column grid, and every group header now carries the group's **current values** — measured in a
  real browser: 6 panels, 0 hidden, **16 of 16 headers with a real summary** ("Human — 3 sub-species", "VIT 9
  · RES 10 · WIL 10 · REF 10 · STR 10 · INT 12", …). A click opens the group for the details; nothing
  switches panel.
- **The viewer fits everyone.** The camera distance is now *derived* from the character's own measured
  bounding box: `distance = (height/2 + 0.22 m) / tan(fov/2)`, clamped 1.5–6 m, looking at 55 % of the
  height (measured: 2.339 m → 4.035 m, 2.390 m → 4.110 m — the law checks out to the millimetre). The same
  law replaced the portrait studio's fixed 0.82 m stand-off, which cropped tall fighters in the list too.
- **Turning is yours.** The turntable is gone: drag with the mouse or a finger (one pointer path), or push
  the gamepad stick — one `orbit()` call, pitch clamped, and **no self-rotation** (measured: yaw unchanged
  after 900 ms idle, moved by a 120 px drag).
- **Roll → edit → decide.** A roll fills the Creator; you edit it there; saving is your call. The roll's
  **generation seed** is recorded, shown on the sheet, and stamped on the saved profile (measured:
  seed 20261031 recorded and printed), so the same idea is reproducible and findable while the profile id
  stays the identity. A re-roll from a given seed is deterministic.
- **The ink and the manga.** The outline stopped being a fixed 0.035 extrusion: it is now a **law** — strength
  falls off with both the light's angle and the surface's angle to the camera, faces suppress it, the width
  is bounded with a far fade — and the shading is a stated **manga ramp** (3 flat bands, hard terminator, a
  separate shade tone). Printed tables in the verification; **17 shader programs, 0 broken**.
- **Faces and ancestry.** Every one of the 16 ancestry nodes gained **17 ranked facial measures** (units in
  the data) and the ratios between them — chin-to-mouth, mouth-to-nose, eye-to-brow, nose, brow-to-forehead
  and more — ranked across the whole tree and printed as tables. Dwarf-kind leads chin length, brow
  prominence and chin-to-mouth (mountain 2.600 vs elf 1.000); orks lead mouth width; elf-kind leads nose
  length and forehead height. The hair/beard law: elves lightest and longest, dwarves always bearded and
  fullest, humans the widest range, orks barest.
- **Bodies.** Three builds — **fit / bulky / heavy** — with measurable radii and muscle/fat terms, mapped
  across every ancestry (orks and some humans heavy, elves fit or bulky, dwarves bulky), skeletons carrying
  anatomy and the paint gaining a definition pass. Measured on a 1.70 m human: chest **+27.9 mm (+20.4 %)**,
  waist **+38.6 %**. The default body is unchanged by design — only the extremes moved.
- **Weapons.** The bow's limb tip is now **capped and closed**, with an 11 mm channel that an 8 mm string
  enters (the string is held **11.5–11.8 mm inside** across four seeds — no through-hole, no floating
  arrow). The sword's **guard/grip/blade junction** is rebuilt with stated overlaps instead of a floating
  chevron. Materials are per-weapon: metal blades metallic (roughness 0.18), wood/bone/stone/chitin as their
  own materials, with the spec (reach/damage/cooldown) unchanged and re-derived in-test.

**Verified by:** `deno task check` 0 errors · `deno lint` 531 files, 0 problems · `deno task build`
1 852 470 B · the full suite (see the gate log) · `tools/probe-wave-p.ts` (0 page errors; the numbers in
§1–5 of the verification) · probes H, I and O re-run after the menu restructure. Contract
`docs/refine/BRIEF.md`; spec §11H; evidence `artifacts/refine/VERIFICATION.md`.

**Two things I would not take on trust, both recorded in the verification.** A lane reported a failing test
as pre-existing; it is not — the wave moved it, so I re-stated that bound from measurement (5.00 → 5.6 mm
for non-orks, the heaviest dwarf at 5.54 mm, with the reason written where the bound lives, the ork band
untouched). And my own first check wrongly declared every lane file missing — my own concurrent `git stash`
had them stashed at that instant; everything is present.

**Not done, plainly.** The synchronisation rule is **proven but not routed through the editor's controls**
(`applyEdit` passes its tests; the palette chips still set the tone directly). "Debate the ratios" became a
stated multi-criteria comparison printed as tables — no LLM deliberates at runtime. Nothing was tried **on a
phone**, and **no gamepad was attached** during the probe (the path is wired and the stick is polled). The
bow, the sword and the materials were verified by geometry numbers and a shader compile rather than by
looking at a rendered weapon in a fighter's hand. And showing every panel makes the Creator page long — if
that proves annoying, the next step is a section-by-section scroll.
