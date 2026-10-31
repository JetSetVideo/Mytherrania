# Wave O — report

**What you asked.** *"improve the user experiences from clicking on the main page profile button to a panel
where the user can generate a random or specified profiles or look at the list of already existing profiles
and see their models and statistics."*

**The button did something else, and the panel could not have shown models at all.** Two things had to be
fixed before the panel could exist: the title's profile area silently switched the active fighter (no panel,
no confirmation), and a **saved profile carries no appearance** — id, name, class, race, sub-species, sign,
keybindings, telemetry, and nothing to draw. So each saved record now resolves a *deterministic* look from
what it does have (name seed + race + sub-species + calling) unless it carries one, which means an old profile
gets a stable, distinct body instead of one default.

**Where / what.**

- **The panel.** The title's button reads *"≡ Profiles — models, statistics, roll or manage"* and opens a real
  screen: every saved fighter as a row with its **portrait**, its ancestry standard, its calling, its level and
  its record, the active one marked.
- **"Generate a random"** is one click: it rolls a complete fighter (Wave L's generator), saves it, and it is
  in the list at once — measured rows **1 → 2** with the new row selected. **"Generate a specified"** leaves
  for the Creator, whose own *Save as profile* button is the return path.
- **The models are real.** Each row's picture is rendered off the same rig the arena builds (`buildPreviewRig`,
  shared with the Creator's live preview) by **one** portrait studio — one WebGL context for the whole list,
  a PNG data URL per profile, cached. Measured: 2 renders + 1 cache hit for a 2-profile list, portraits
  **50 862–54 662 bytes**. The old `renderPortrait` (which drew a body the game no longer renders and burned a
  context per call) now delegates to the studio, so the Character Sheet finally shows the real fighter too.
- **The statistics are the game's.** The selected row's sheet is computed by Wave L's `creatorSheet` — the same
  `createStats → applyRaceBonus → applySecondary → applyLevel` chain the fight uses. Measured sample:
  16 rows, *Max Health 20 450 · Attack Power 636 · Attack Interval 1.13 s · Armour 5.6*.
- **Managing them works**: load (switches the active fighter — measured switching to "Hero"), duplicate,
  rename, delete. Delete refuses to remove the **last** profile (the game needs an identity), and 100 rolled
  ids produced **0 collisions**.

**Three things the probe caught that I fixed rather than shipped:** the panel's width used `96vw` and
overflowed by 5 px at 820 px; the manage buttons overflowed by 12 px at 390 px; and — the interesting one —
the way into the panel was **hidden inside a collapsed option tree** (Wave L made every group closed by
default), so the profile group is now open by default like the fight modes, with the test pin re-stated from
one open entry group to two and the reason recorded.

**Verified by:** `deno task check` 0 errors · `deno task test` green · `deno lint` clean · `deno task build`
1 834 434 B · `tools/probe-wave-o.ts` (0 page errors, no clipping at 390/820/1280/1920) · the earlier waves'
probes re-run. Contract `docs/profiles/BRIEF.md`; spec §11G; evidence
`artifacts/profiles/VERIFICATION.md`.

**Not done, plainly.** Rename goes through `prompt()` (a stopgap; a headless page gets no rename at all);
delete is a tombstone because the profile repo has no `remove()`; "Create a fighter" leaves for the Creator
rather than editing in place; and no human eye has looked at the panel — the machine only proves nothing
clips and the buttons are 40–44 px.
