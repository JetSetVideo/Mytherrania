# Wave L — report

**What you asked (your words).** *"improve the components on the pages from the main page to the panel before
launching a game. The Races and sub races should have icons (like etendards. The character generator should
show the model and its statistics after clicking on a random dice icon button purple rocky style and refresh
the Creator step. Options should be visually in their closed tress tha[t]…"*

**Decoded** (full table in `docs/creation/BRIEF.md`): "étendards" = a heraldic standard per race **and** per
sub-species; the dice = a purple, rocky stone button with a dice icon that rolls a fighter and shows **the
model and the statistics**, refreshing the whole Creator step; "closed trees" = the options live in collapsed
disclosure groups. **One flag:** your last sentence is cut off in the transcript — I read it as "options in
their closed trees" and nothing else, and that is the only thing in this wave I inferred rather than heard.

**What changed, and where you'll see it.**

- **Every race and sub-species flies its own standard.** `src/ui/RaceBanners.ts` draws 16 distinct banners
  (a charge per race — elf laurel/star, human crown/sun, dwarf hammer/anvil, ork tusk/skull — plus a heraldic
  cadency mark per sub-species, chosen deterministically from its id). They appear as the race cards' glyph
  and on each sub-species chip.
- **The dice.** The plain "Random" button became `dice-btn dice-btn-rocky`: purple, stone-faced (measured
  122×48 px, border `#a06cd5` violet, background `#2a2338`, a three-step inset bevel), with a dice icon.
- **The model and the statistics.** A new `src/graphics/PreviewScene.ts` stands a **live turntable rig** on
  the Creator's preview canvas, built through the same path the arena uses — so the figure you see is the
  fighter the match will build (measured: 10 896 triangles, and the rig's build key changed from
  `Sir Aldric|human|imperial|Warrior` to `Ash|…|sword` after one click). Beside it, a stat sheet computed by
  the game's own maths (measured sample: Max Health 24 375, Attack Power 374 ≈ 314 a blow, interval 1.08 s,
  armour 4, plus the six attributes and the six modifier rows).
- **One click refreshes the whole step**, not just the name: race box, sub-species chips, lore, class table,
  techniques, weapon table, palettes, star sign, secondary rows, the sheet and the model.
- **Options are closed trees.** 18 groups, **1 open** on arrival (the title's entry paths, which must never
  hide), each header showing its option count, the open set remembered across reloads.

**Why it is wired this way.** The engine owns the renderer, so it owns the model: `Menu` rolls the fighter
and hands it to `Engine` through an `onRoll` hook, and the engine draws it only while its canvas is on
screen — the fight's frame budget is untouched (spectate p99 **3.8 ms** of 16.6, measured).

**Two things this wave broke and fixed, and one it broke and left.** The menu rewrite silently broke the
Wave H ancestry lore panel — the race cards became boxes wrapping the toggle button, so a click on the box no
longer selected the race, and the lore panel kept showing the previous ancestry. The probe caught it (three
false claims), the delegated handler now resolves a box click through its own toggle (which also makes the
whole card one target), and all six lore claims are true again. The sheet screen's portrait still draws the
older body builder; the Creator now shows the real one, and the sheet was left as the previous wave's
evidence rather than quietly changed.

**Verified by:** `deno task check` 0 errors · `deno task test` **1388 passed / 0 failed** · `deno lint`
488 files clean · `deno task build` 1 782 828 B · `tools/probe-wave-l.ts` (0 page errors; no clipping at
390/820/1280/1920) · `tools/probe-wave-h.ts` and `tools/probe-wave-i.ts` re-run green · `frame-budget.ts`
with the second context live. Full numbers: `artifacts/creation/VERIFICATION.md`; contract
`docs/creation/BRIEF.md`; spec §11D; pins `[SPEC LL1–LL4]`.

**To see it:** open http://127.0.0.1:8788/ → click **⚔ Fight** → the Create screen opens on **Ancestry**
with four banner cards → the left-hand **Preview** panel shows the fighter turning → click the purple
**dice** button: the name, the bloodline, the calling, the weapon, the sign, the sheet and the model all
change at once. Every other group on the page is a closed header you can click open.

**Not judged by eye.** Everything above is geometry and colour read by a machine. Nobody has looked at
whether the banners read at 22 px or whether the rocky button reads as stone — that's your call, and it is
the one thing the numbers cannot answer.
